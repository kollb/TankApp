"""Serverseitige Umweg-Ökonomie — /api/v1/route/evaluate.

K = d·(c/100)·p + (d/v)·z  (Konzept §10)

- d = Umweg gesamt (Hin+Rück) in km, c = Verbrauch L/100km, p = Preis €/L, v = km/h, z = €/h Zeitwert
- Trip-Modi:
  dedicated = Extrafahrt von zuhause: Hin+Rück vollständig
  onroute   = nur Mehrweg gegenüber nächster Station

Zeitwert-Automatik: 0 = Auto (16 €/h Peak 16:30–20:00, sonst 10 €/h), wie im Frontend.

Eingabe params dict aus Query:
  station_id, city, fuel, liters, detour_km, consumption, speed_kmh,
  value_of_time, when (ISO-Zeitstempel, „HH:MM“ oder Stunde 0–23),
  mode (onroute|dedicated), ref_station_id,
  price/target_price/alt_price (Ziel explizit), ref_price (Referenz explizit)

detour_km ohne Angabe: aus den Anker-Distanzen (dist_km, OSRM-Cache) abgeleitet —
  onroute: max(0, dist(Ziel) − dist(Referenz)), dedicated: dist(Ziel) als Einweg.
  Fehlt dist_km, so 0 (siehe Antwortfeld detour_km_source: query|derived|zero).

Ausgabe: delta_ct, gross_eur, fuel_eur, time_eur, net_eur, critical_ct, worth_it,
z_used, z_auto, is_peak, detour_km_source, ref_station_name, etc.
"""

import datetime as dt
import math

from .data import metadata

FUELS = {"e10", "e5", "diesel"}


def _parse_float(v, default=None):
    if v is None:
        return default
    try:
        f = float(v)
        if math.isfinite(f):
            return f
    except Exception:
        pass
    return default


def _berlin_hour(when_str: str | None) -> float | None:
    """Parst ISO-Zeitstempel, „HH:MM[:SS]“ (Berlin) oder Dezimalstunde.

    Rückgabe: Stunde als float 0–24 oder None, wenn nichts parsebar.
    """
    if when_str is None:
        return None
    text = str(when_str).strip()
    if not text:
        return None
    # Reine Stundenangabe (Dezimal oder Ganzzahl)
    try:
        h = float(text)
        if 0 <= h < 24:
            return h
        return None
    except ValueError:
        pass
    # Versuche ISO-Zeitstempel (mit Datum)
    try:
        ts = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            # Naive als Berlin interpretieren
            try:
                from zoneinfo import ZoneInfo

                ts = ts.replace(tzinfo=ZoneInfo("Europe/Berlin"))
            except Exception:
                ts = ts.replace(tzinfo=dt.timezone.utc)
        try:
            from zoneinfo import ZoneInfo

            berlin = ts.astimezone(ZoneInfo("Europe/Berlin"))
        except Exception:
            berlin = ts
        return berlin.hour + berlin.minute / 60.0
    except ValueError:
        pass
    # Nur Uhrzeit: „HH:MM“ oder „HH:MM:SS“ (als Berlin-Zeit)
    parts = text.split(":")
    if len(parts) in (2, 3):
        try:
            hour, minute = int(parts[0]), int(parts[1])
            if 0 <= hour <= 23 and 0 <= minute <= 59:
                return hour + minute / 60.0
        except ValueError:
            pass
    return None


def _auto_time_value(hour: float | None):
    if hour is None:
        # Default offpeak wenn unbekannt
        return 10.0, False
    is_peak = 16.5 <= hour <= 20.0
    return (16.0 if is_peak else 10.0), is_peak


def evaluate_route(live_data, params: dict):
    # Params aus Query
    station_id = params.get("station_id")
    city = params.get("city")
    fuel = (params.get("fuel") or "e10").lower()
    if fuel not in FUELS:
        raise ValueError("invalid_fuel")

    liters = _parse_float(params.get("liters"), 40.0)
    if liters is None or not (5 <= liters <= 100):
        raise ValueError("invalid_liters")

    consumption = _parse_float(params.get("consumption"), 7.0)
    if not (3 <= consumption <= 20):
        raise ValueError("invalid_consumption")

    speed = _parse_float(params.get("speed_kmh") or params.get("speed"), 45.0)
    if not (10 <= speed <= 130):
        raise ValueError("invalid_speed")

    mode = (params.get("mode") or params.get("trip_mode") or "onroute").lower()
    if mode not in ("onroute", "dedicated"):
        raise ValueError("invalid_mode")

    when_raw = params.get("when")
    hour = _berlin_hour(when_raw)
    if when_raw is not None and str(when_raw).strip() and hour is None:
        raise ValueError("invalid_when")
    vot_raw = params.get("value_of_time") or params.get("z")
    vot = _parse_float(vot_raw, None)
    z_auto = vot is None or vot == 0
    if z_auto:
        z_used, is_peak = _auto_time_value(hour)
    else:
        if not (0 <= vot <= 100):
            raise ValueError("invalid_value_of_time")
        z_used = vot
        _, is_peak = _auto_time_value(hour)

    # Stationen-Metadaten
    metas, problem = metadata(live_data.settings)
    if problem:
        return {"error_code": problem}

    # Zielstation
    target_meta = None
    target_price = _parse_float(
        params.get("price") or params.get("target_price") or params.get("alt_price"),
        None,
    )

    if station_id:
        # Finde Meta
        for (c, sid), meta in metas.items():
            if sid == station_id and (city is None or c == city):
                target_meta = meta
                city = c
                break
        if not target_meta:
            raise ValueError("unknown_station")
        # Versuche aktuellen Preis aus LiveData
        try:
            stations_data = live_data.stations(fuel=fuel, city=city)
            for s in stations_data.get("stations", []):
                if s["station_id"] == station_id:
                    if s.get("price") is not None:
                        target_price = s["price"]
                    elif s.get("last_price") is not None:
                        target_price = s["last_price"]
                    break
        except Exception:
            pass
    else:
        # Kein station_id: nimm erste Stadt falls nicht angegeben
        if not city:
            city = next((c for c, _ in metas), None)

    if target_price is None:
        # Fallback: nimm günstigsten Preis der Stadt als Ziel? Dann kein Vergleich
        # Besser: Fehler wenn kein Preis bekannt, außer ref_price gegeben
        target_price = _parse_float(params.get("ref_price"), None)
        if target_price is None:
            # Versuche aus stations_data günstigsten zu nehmen
            try:
                stations_data = live_data.stations(fuel=fuel, city=city)
                fresh = [
                    s
                    for s in stations_data.get("stations", [])
                    if s.get("price") is not None
                ]
                if fresh:
                    target_price = min(s["price"] for s in fresh)
            except Exception:
                pass

    if target_price is None:
        return {"error_code": "price_not_available"}

    # Referenzstation + Referenzpreis
    ref_station_id = params.get("ref_station_id") or params.get("ref_id")
    ref_meta = None
    if ref_station_id:
        for (c, sid), meta in metas.items():
            if sid == ref_station_id:
                ref_meta = meta
                break
    ref_price = _parse_float(params.get("ref_price"), None)
    if ref_price is None and ref_meta is not None:
        try:
            stations_data = live_data.stations(fuel=fuel, city=ref_meta["city"])
            for s in stations_data.get("stations", []):
                if s["station_id"] == ref_station_id and s.get("price") is not None:
                    ref_price = s["price"]
                    break
        except Exception:
            pass
    if ref_price is None:
        # Default: teuerste oder median? Für Umweg-Rechnung: Referenz = aktuelle Station (teurer)
        # Wenn target billiger sein soll, ist ref > target. Wir nehmen median der Stadt als ref wenn möglich
        try:
            stations_data = live_data.stations(fuel=fuel, city=city)
            prices = [
                s["price"]
                for s in stations_data.get("stations", [])
                if s.get("price") is not None
            ]
            if prices:
                prices_sorted = sorted(prices)
                # Median als Referenz
                n = len(prices_sorted)
                median = (
                    prices_sorted[n // 2]
                    if n % 2 == 1
                    else (prices_sorted[n // 2 - 1] + prices_sorted[n // 2]) / 2
                )
                ref_price = median
            else:
                ref_price = target_price + 0.05  # 5ct mehr als Ziel als Annahme
        except Exception:
            ref_price = target_price + 0.05

    # Umweg: explizit per Query, sonst aus den Anker-Distanzen abgeleitet
    detour_km = _parse_float(params.get("detour_km") or params.get("km"), None)
    detour_source = "query" if detour_km is not None else None
    if detour_km is None:
        target_dist = target_meta.get("dist_km") if target_meta else None
        target_dist_ok = (
            isinstance(target_dist, (int, float))
            and not isinstance(target_dist, bool)
            and math.isfinite(target_dist)
            and target_dist >= 0
        )
        if target_dist_ok:
            if mode == "dedicated":
                # Extrafahrt ab Anker (Zuhause): Einweg = Distanz zur Zielstation
                detour_km = float(target_dist)
            else:
                ref_dist = ref_meta.get("dist_km") if ref_meta else None
                ref_dist_ok = (
                    isinstance(ref_dist, (int, float))
                    and not isinstance(ref_dist, bool)
                    and math.isfinite(ref_dist)
                    and ref_dist >= 0
                )
                detour_km = max(
                    0.0, float(target_dist) - (float(ref_dist) if ref_dist_ok else 0.0)
                )
            detour_source = "derived"
    if detour_km is None:
        detour_km = 0.0
        detour_source = "zero"
    if not (0 <= detour_km <= 100):
        raise ValueError("invalid_detour")

    # Berechnung: K = d·(c/100)·p + (d/v)·z, brutto = (p_ref - p_alt)·L
    d = detour_km * (2 if mode == "dedicated" else 1)  # Gesamt-Umweg
    fuel_eur = (d / 100.0) * consumption * target_price
    time_eur = (d / max(1.0, speed)) * z_used
    detour_cost = fuel_eur + time_eur
    gross_eur = (ref_price - target_price) * liters
    net_eur = gross_eur - detour_cost
    critical_ct = (detour_cost / liters * 100) if liters else 0.0
    delta_ct = (ref_price - target_price) * 100

    worth_it = net_eur >= 1.5
    borderline = 0.5 <= net_eur < 1.5

    verdict = "worth" if worth_it else "borderline" if borderline else "not_worth"

    return {
        "generated_at": live_data.clock().isoformat(),
        "city": city,
        "fuel": fuel,
        "station_id": station_id,
        "ref_station_id": ref_station_id,
        "station_name": target_meta.get("name") if target_meta else None,
        "ref_station_name": ref_meta.get("name") if ref_meta else None,
        "target_price": round(target_price, 3),
        "alt_price": round(target_price, 3),
        "ref_price": round(ref_price, 3),
        "delta_ct": round(delta_ct, 2),
        "liters": liters,
        "detour_km_oneway": round(detour_km, 3),
        "detour_km_total": round(d, 2),
        "detour_km_source": detour_source,
        "mode": mode,
        "consumption_l_100km": consumption,
        "speed_kmh": speed,
        "value_of_time_eur_h": z_used,
        "z_used": z_used,
        "z_auto": z_auto,
        "is_peak": is_peak,
        "when_hour": hour,
        "fuel_cost_eur": round(fuel_eur, 2),
        "time_cost_eur": round(time_eur, 2),
        "detour_cost_eur": round(detour_cost, 2),
        "gross_eur": round(gross_eur, 2),
        "net_eur": round(net_eur, 2),
        "critical_delta_ct": round(critical_ct, 2),
        "worth_it": worth_it,
        "verdict": verdict,
        "error_code": None,
    }
