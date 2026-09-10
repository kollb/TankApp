"""Entscheidungs-API für das Frontend — GET /api/v1/decide (Konzept §4, §11.1).

Der eine Endpunkt fürs Frontend: liefert alles, was das UI für die
Startkarte und Detail-Aufklappungen braucht.

Grundsätze:
- Kein erfundener Ankerpreis: Ohne frischen/letzten Preis gibt es keine
  Ersparnis-Rechnung (expected_saving 0, keine Alternativen, action no_advice).
- Kein erfundenes Fenster: Ohne Prognose gibt es keine Fenster
  (windows_today leer, recommended_window null).
- Die €/P-Entscheidungstabelle folgt Konzept §4.1/§4.2/§4.4. Der Advice-Ledger
  misst die Tabellen-Qualität ab Tag 1 (Shadow-Betrieb); angezeigt wird die
  Empfehlung erst nach dem M7-Gate (Konzept §0.4).
"""

from __future__ import annotations

import datetime as dt
import statistics
from typing import Any

from .data import haversine_km, metadata
from .feedback import (
    action_track_record,
    compute_advice_stats,
    compute_wallet_stats,
    load_store,
    record_snapshot,
)
from .route import CIRCUITY, _auto_time_value, _berlin_hour, _parse_float

FUELS = {"e10", "e5", "diesel"}

try:
    from zoneinfo import ZoneInfo

    BERLIN_TZ = ZoneInfo("Europe/Berlin")
except Exception:  # pragma: no cover
    BERLIN_TZ = dt.timezone.utc

# Mindest-Stichprobe, ab der die Grauzone (§4.4, P in [40, 60] %) greift.
# Mit n = 0 ist p = 0,5 nur das uninformative Prior — die Grauzone darf den
# Kaltstart nicht fangen, sonst öffnet sich das M7-Gate nie.
GRAY_MIN_N = 20


def _parse_ts(value: Any) -> dt.datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=dt.timezone.utc)
    return stamp


def _q50(point: dict[str, Any]) -> float | None:
    try:
        value = float(point.get("q50"))
    except (TypeError, ValueError):
        return None
    import math

    return value if math.isfinite(value) and value > 0 else None


def _today_windows(
    points: list[dict[str, Any]], clock_now: dt.datetime
) -> list[dict[str, Any]]:
    """2-h-Blöcke (Berlin) des Heute-Forecasts, billigste zuerst.

    Fenstergrenzen sind echte Prognose-Zeitstempel (ISO), keine erfundenen
    Stunden. Nur Blöcke, die noch nicht vollständig vergangen sind.
    """
    blocks: dict[tuple, list[tuple[dt.datetime, float]]] = {}
    for point in points:
        stamp = _parse_ts(point.get("timestamp"))
        q50 = _q50(point)
        if stamp is None or q50 is None:
            continue
        berlin = stamp.astimezone(BERLIN_TZ)
        key = (berlin.date().isoformat(), int(berlin.hour // 2))
        blocks.setdefault(key, []).append((stamp, q50))
    today_key = clock_now.astimezone(BERLIN_TZ).date().isoformat()
    windows = []
    for (day, _block), entries in blocks.items():
        if day != today_key:
            continue
        entries.sort(key=lambda e: e[0])
        end = entries[-1][0]
        if end <= clock_now:
            continue  # Block vollständig vergangen
        start = entries[0][0]
        median = round(statistics.median(q for _, q in entries), 3)
        start_berlin = start.astimezone(BERLIN_TZ)
        end_berlin = end.astimezone(BERLIN_TZ)
        windows.append(
            {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "expected_price": median,
                "start_hour": round(start_berlin.hour + start_berlin.minute / 60.0, 2),
                "end_hour": round(end_berlin.hour + end_berlin.minute / 60.0, 2),
            }
        )
    windows.sort(key=lambda w: w["expected_price"])
    return windows[:3]


def _week_windows(points_7d: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Je Kalendertag (Berlin) der billigste Prognose-Punkt, Top 3 Tage."""
    per_day: dict[str, dict[str, Any]] = {}
    for point in points_7d:
        stamp = _parse_ts(point.get("timestamp"))
        q50 = _q50(point)
        if stamp is None or q50 is None:
            continue
        day = stamp.astimezone(BERLIN_TZ).date().isoformat()
        current = per_day.get(day)
        if current is None or q50 < current["expected_price"]:
            per_day[day] = {"timestamp": stamp.isoformat(), "expected_price": q50}
    days = sorted(per_day.values(), key=lambda d: d["expected_price"])
    return days[:3]


def _detour_km(chosen: dict[str, Any], cand: dict[str, Any]) -> tuple[float, str]:
    """Onroute-Mehrweg zwischen zwei Stationen (km, einseitig).

    Primär Luftlinie zwischen den Stationskoordinaten × 1,3 (gleiche
    Umweg-Konvention wie data-tools/road_route.py). Fallback Anker-Distanz-
    Differenz (Dreiecksungleichungs-Schranke, kann 0 sein).
    """
    coords = []
    for station in (chosen, cand):
        lat, lon = station.get("lat"), station.get("lon")
        import math

        if (
            type(lat) in (int, float)
            and type(lon) in (int, float)
            and math.isfinite(lat)
            and math.isfinite(lon)
        ):
            coords.append((float(lat), float(lon)))
        else:
            coords.append(None)
    if coords[0] and coords[1]:
        km = haversine_km(coords[0][0], coords[0][1], coords[1][0], coords[1][1])
        return round(km * CIRCUITY, 2), "haversine"
    dist_cand = cand.get("dist_km")
    dist_self = chosen.get("dist_km")
    if isinstance(dist_cand, (int, float)) and isinstance(dist_self, (int, float)):
        return round(max(0.0, abs(dist_cand - dist_self)), 2), "anchor_diff"
    return 0.0, "unknown"


def _alternatives(
    station_list: list[dict[str, Any]],
    chosen_station: dict[str, Any],
    anchor: float,
    liters: float,
    consumption: float,
    speed: float,
    z_used: float,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    alternatives = []
    best = None
    for cand in station_list:
        if cand["station_id"] == chosen_station["station_id"]:
            continue
        cand_price = (
            cand.get("price")
            if cand.get("price") is not None
            else cand.get("last_price")
        )
        if cand_price is None:
            continue
        detour_km, detour_mode = _detour_km(chosen_station, cand)
        fuel_eur = (detour_km / 100.0) * consumption * cand_price
        time_eur = (detour_km / max(1.0, speed)) * z_used
        detour_cost = fuel_eur + time_eur
        gross_eur = (anchor - cand_price) * liters
        net_eur = gross_eur - detour_cost
        entry = {
            "station_id": cand["station_id"],
            "name": cand.get("name") or cand["station_id"],
            "brand": cand.get("brand") or "",
            "price": round(cand_price, 3),
            "delta_ct": round((anchor - cand_price) * 100.0, 2),
            "detour_km": detour_km,
            "detour_mode": detour_mode,
            "net_eur": round(net_eur, 2),
            "worth_it": net_eur >= 1.5,
            "maps_url": cand.get("maps_url"),
        }
        alternatives.append(entry)
        if best is None or net_eur > best["net_eur"]:
            best = entry
    alternatives.sort(key=lambda a: a["net_eur"], reverse=True)
    return alternatives[:3], best


def _table_action(
    anchor: float | None,
    expected_price_later: float | None,
    expected_saving_eur: float,
    best_alt: dict[str, Any] | None,
    track_wait: dict[str, Any],
    track_now: dict[str, Any],
    track_else: dict[str, Any],
) -> tuple[str, str, str]:
    """€/P-Entscheidungstabelle (Konzept §4.1, §4.2, §4.4).

    Gibt (action, confidence_badge, reason_short) zurück. Die Aktion wird
    immer in den Advice-Ledger geschrieben (Shadow-Betrieb ab Tag 1);
    angezeigt wird sie erst nach dem M7-Gate.
    """
    if anchor is None:
        return (
            "no_advice",
            "low",
            "Kein aktueller Preis für diese Station — ohne Anker keine Empfehlung.",
        )
    if expected_price_later is None:
        return (
            "no_advice",
            "low",
            "Keine Prognose verfügbar — Empfehlung erst mit Modelldaten.",
        )
    p_wait, n_wait = track_wait["p"], track_wait["n"]
    p_else = track_else["p"]
    # F2 zuerst (§4.2): Alternative nur bei netto ≥ 1,50 € und Plausibilität.
    if best_alt is not None and best_alt["net_eur"] >= 1.5 and p_else >= 0.5:
        badge = "high" if p_else >= 0.7 else "medium"
        return (
            "refuel_elsewhere",
            badge,
            f"Fahre zu {best_alt['name']}: spart netto +{best_alt['net_eur']:.2f} € trotz Umweg.",
        )
    # Grauzone (§4.4): P in [40, 60] % → kein Advice. Nur bei belastbarer
    # Stichprobe (Kaltstart-Schutz, siehe GRAY_MIN_N).
    if n_wait >= GRAY_MIN_N and 0.40 <= p_wait <= 0.60 and expected_saving_eur >= 1.0:
        return (
            "no_advice",
            "low",
            f"Warte-Signal zu unsicher (P ≈ {p_wait * 100:.0f} %) — kein Advice, Preise bleiben unverfälscht.",
        )
    # F1 (§4.1).
    if expected_saving_eur >= 2.0 and p_wait >= 0.7:
        return (
            "wait",
            "high",
            f"Preis fällt im Fenster voraussichtlich — Warten spart ca. {expected_saving_eur:.2f} €.",
        )
    if expected_saving_eur >= 1.0 and p_wait >= 0.6:
        return (
            "wait",
            "medium",
            f"Eher warten: Fenster spart voraussichtlich ca. {expected_saving_eur:.2f} €.",
        )
    if p_wait < 0.5 and n_wait >= GRAY_MIN_N:
        return (
            "refuel_now",
            "low",
            "Warte-Empfehlung zu unsicher (P < 50 %) — jetzt tanken.",
        )
    if expected_saving_eur < 1.0:
        return (
            "refuel_now",
            "medium",
            "Warten brächte < 1,00 € Ersparnis — jetzt tanken.",
        )
    # Kaltstart-Fallback (€-Gates ohne belastbares P): Ersparnis ≥ 1 € → warten.
    return (
        "wait",
        "medium",
        f"Eher warten: Fenster spart voraussichtlich ca. {expected_saving_eur:.2f} €.",
    )


def evaluate_decide(live_data, params: dict[str, Any]) -> dict[str, Any]:
    fuel = (params.get("fuel") or "e10").lower()
    if fuel not in FUELS:
        raise ValueError("invalid_fuel")

    liters = _parse_float(params.get("liters"), 40.0)
    if liters is None or not (5.0 <= liters <= 100.0):
        raise ValueError("invalid_liters")

    consumption = _parse_float(params.get("consumption"), 7.0)
    if not (3.0 <= consumption <= 20.0):
        raise ValueError("invalid_consumption")

    speed = _parse_float(params.get("speed_kmh") or params.get("speed"), 45.0)
    if not (10.0 <= speed <= 130.0):
        raise ValueError("invalid_speed")

    when_raw = params.get("when")
    hour = _berlin_hour(when_raw)
    if when_raw is not None and str(when_raw).strip() and hour is None:
        raise ValueError("invalid_when")

    clock_now = live_data.clock()
    if hour is None:
        try:
            berlin_dt = clock_now.astimezone(BERLIN_TZ)
            hour = berlin_dt.hour + berlin_dt.minute / 60.0
        except Exception:
            hour = clock_now.hour + clock_now.minute / 60.0

    vot_raw = params.get("value_of_time") or params.get("z")
    vot = _parse_float(vot_raw, None)
    z_auto = vot is None or vot == 0
    if z_auto:
        z_used, is_peak = _auto_time_value(hour)
    else:
        if not (0.0 <= vot <= 100.0):
            raise ValueError("invalid_value_of_time")
        z_used = vot
        _, is_peak = _auto_time_value(hour)

    city = params.get("city")
    station_id = params.get("station_id")

    metas, problem = metadata(live_data.settings)
    if problem:
        return {"error_code": problem}

    # Stationen & Preise
    stations_data = live_data.stations(fuel=fuel, city=city)
    station_list = stations_data.get("stations", [])
    if not station_list:
        return {"error_code": "unknown_station" if station_id else "unknown_city"}

    # Zielstation auswählen
    chosen_station = None
    if station_id:
        for s in station_list:
            if s["station_id"] == station_id:
                chosen_station = s
                break
        if not chosen_station:
            raise ValueError("unknown_station")
    else:
        # Günstigste frische Station oder erste
        fresh = [s for s in station_list if s.get("price") is not None]
        if fresh:
            chosen_station = min(fresh, key=lambda s: s["price"])
        else:
            chosen_station = station_list[0]

    station_id = chosen_station["station_id"]
    station_name = chosen_station.get("name") or station_id
    station_city = chosen_station.get("city") or city or "Frankfurt"

    # Ankerpreis: frisch > zuletzt beobachtet > unbekannt (None — nie erfunden).
    anchor = chosen_station.get("price")
    if anchor is None:
        anchor = chosen_station.get("last_price")

    # Prognose für Station laden
    forecast_data = live_data.forecast(station_id, station_city, fuel)
    points = forecast_data.get("points") or []
    points_7d = forecast_data.get("points_7d") or []

    # Beste Fenster heute (echte 2-h-Blöcke) und billigste Folgetage.
    windows_today = _today_windows(points, clock_now)
    windows_week = _week_windows(points_7d)

    if windows_today:
        recommended_window = {
            "start": windows_today[0]["start"],
            "end": windows_today[0]["end"],
            "expected_price": windows_today[0]["expected_price"],
        }
        expected_price_later = windows_today[0]["expected_price"]
        start_hour_later = windows_today[0]["start_hour"]
        end_hour_later = windows_today[0]["end_hour"]
    else:
        # Kein erfundenes Fenster: ohne Prognose keine Empfehlung.
        recommended_window = None
        expected_price_later = None
        start_hour_later = None
        end_hour_later = None

    if anchor is not None and expected_price_later is not None:
        expected_saving_eur = round(
            max(0.0, (anchor - expected_price_later) * liters), 2
        )
    else:
        expected_saving_eur = 0.0

    # Alternativen (F2 Umweg-Ökonomie) — nur mit Ankerpreis rechenbar.
    if anchor is not None:
        alternatives_nearby, best_alt = _alternatives(
            station_list, chosen_station, anchor, liters, consumption, speed, z_used
        )
    else:
        alternatives_nearby, best_alt = [], None

    # Ledger lesen: Tabellen-Qualität + interne P-Schätzung je Aktion.
    store = load_store(live_data.settings)
    advice_stats = compute_advice_stats(store)
    wallet_stats = compute_wallet_stats(store)
    is_calibrated = advice_stats.get("calibrated", False)

    track_wait = action_track_record(store, "wait")
    track_now = action_track_record(store, "refuel_now")
    track_else = action_track_record(store, "refuel_elsewhere")

    table_action, badge, reason = _table_action(
        anchor,
        expected_price_later,
        expected_saving_eur,
        best_alt,
        track_wait,
        track_now,
        track_else,
    )
    p_internal = {
        "wait": track_wait["p"],
        "refuel_now": track_now["p"],
        "refuel_elsewhere": track_else["p"],
    }.get(table_action)

    # M7-Gate (§0.4): Vor der Kalibrierung keine Handlungsempfehlung und
    # kein P anzeigen — der Ledger misst die Tabelle trotzdem (Shadow).
    if is_calibrated:
        action = table_action
        p_correct = p_internal
        confidence_badge = badge
        reason_short = reason
    else:
        action = "no_advice"
        p_correct = None
        confidence_badge = "low"
        reason_short = (
            "M7-Kalibrierung steht aus: Preismeldungen sind unverfälscht, "
            "Empfehlungen noch unkalibriert."
        )

    # Snapshot im Feedback-Store erfassen (Tabellen-Aktion + Fenster-ISO).
    snapshot_input = {
        "clock_hour": hour,
        "action": table_action,
        "city": station_city,
        "station_id": station_id,
        "station_name": station_name,
        "alt_station_id": best_alt["station_id"]
        if table_action == "refuel_elsewhere" and best_alt
        else None,
        "alt_station_name": best_alt["name"]
        if table_action == "refuel_elsewhere" and best_alt
        else None,
        "price_now": round(anchor, 3) if anchor is not None else None,
        "window_start": recommended_window["start"] if recommended_window else None,
        "window_end": recommended_window["end"] if recommended_window else None,
        "window_start_hour": start_hour_later,
        "window_end_hour": end_hour_later,
        "expected_price": round(expected_price_later, 3)
        if expected_price_later is not None
        else None,
        "expected_saving_eur": expected_saving_eur,
        "liters_assumed": liters,
        "fuel": fuel,
    }

    _, ep = record_snapshot(live_data.settings, snapshot_input, clock=live_data.clock)

    return {
        "primary": {
            "action": action,
            "station": {
                "id": station_id,
                "name": station_name,
                "brand": chosen_station.get("brand") or "",
                "price_now": round(anchor, 3) if anchor is not None else None,
                "maps_url": chosen_station.get("maps_url"),
            },
            "recommended_window": recommended_window,
            "expected_saving_eur": expected_saving_eur,
            "p_correct": p_correct,
            "confidence_badge": confidence_badge,
            "reason_short": reason_short,
        },
        "alternatives_nearby": alternatives_nearby,
        "windows_today": [
            {
                "start": w["start"],
                "end": w["end"],
                "expected_price": w["expected_price"],
            }
            for w in windows_today
        ],
        "windows_week": windows_week,
        "episode": {
            "id": ep.get("id"),
            "status": ep.get("status"),
            "intent": ep.get("intent"),
            "opened_at": ep.get("opened_at"),
        },
        "personal_stats": {
            "advice": {
                "last_30d_hits": advice_stats.get("wins", 0),
                "last_30d_total": advice_stats.get("n", 0),
                "hit_rate": advice_stats.get("hit_rate"),
                "brier_30d": advice_stats.get("brier_30d"),
            },
            "wallet": {
                "fills_30d": wallet_stats.get("n_fills", 0),
                "followed": wallet_stats.get("followed", 0),
                "saved_eur_30d": wallet_stats.get("saved_eur", 0.0),
            },
        },
        "calibrated": is_calibrated,
        "decision_ready": False,
        "debug": {
            "forecast_url": f"/api/v1/forecast?city={station_city}&station_id={station_id}&fuel={fuel}",
            "fitted_at": forecast_data.get("origin"),
        },
        "error_code": None,
    }
