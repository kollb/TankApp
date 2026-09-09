"""Entscheidungs-API für das Frontend — GET /api/v1/decide (Konzept §4, §11.1).

Der eine Endpunkt fürs Frontend: liefert alles, was das UI für die
Startkarte und Detail-Aufklappungen braucht.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from .data import metadata
from .feedback import (
    compute_advice_stats,
    compute_wallet_stats,
    load_store,
    record_snapshot,
)
from .route import _auto_time_value, _berlin_hour, _parse_float

FUELS = {"e10", "e5", "diesel"}


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
            from zoneinfo import ZoneInfo

            berlin_dt = clock_now.astimezone(ZoneInfo("Europe/Berlin"))
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
    price_now = chosen_station.get("price") or chosen_station.get("last_price") or 1.689

    # Prognose für Station laden
    forecast_data = live_data.forecast(station_id, station_city, fuel)
    points = forecast_data.get("points") or []
    points_7d = forecast_data.get("points_7d") or []

    # Beste Fenster heute bestimmen
    windows_today = []
    expected_price_later = price_now
    start_hour_later = 17.5
    end_hour_later = 20.5

    if points:
        # Finde günstigste verbleibende Stunden heute
        today_points = [p for p in points if p.get("q50") is not None]
        if today_points:
            # Sortiere nach q50
            sorted_pts = sorted(today_points, key=lambda p: p["q50"])
            best_pt = sorted_pts[0]
            expected_price_later = best_pt["q50"]

            # Versuche Zeitstempel oder Stunde zu parsen
            try:
                pt_ts = dt.datetime.fromisoformat(
                    best_pt["timestamp"].replace("Z", "+00:00")
                )
                from zoneinfo import ZoneInfo

                pt_berlin = pt_ts.astimezone(ZoneInfo("Europe/Berlin"))
                best_h = pt_berlin.hour + pt_berlin.minute / 60.0
            except Exception:
                best_h = 19.0

            start_hour_later = max(6.0, best_h - 1.0)
            end_hour_later = min(23.5, best_h + 1.5)

            # 2-Stunden-Blöcke
            for i in range(len(today_points) - 1):
                p1 = today_points[i]
                p2 = today_points[i + 1]
                med = round(((p1.get("q50") or 0) + (p2.get("q50") or 0)) / 2, 3)
                windows_today.append(
                    {
                        "start": p1.get("timestamp"),
                        "end": p2.get("timestamp"),
                        "expected_price": med,
                    }
                )
            windows_today = sorted(windows_today, key=lambda w: w["expected_price"])[:3]

    if not windows_today:
        # Fallback Fenster
        today_iso = clock_now.date().isoformat()
        start_iso = f"{today_iso}T17:30:00+02:00"
        end_iso = f"{today_iso}T20:30:00+02:00"
        expected_price_later = round(price_now - 0.035, 3)
        windows_today = [
            {
                "start": start_iso,
                "end": end_iso,
                "expected_price": expected_price_later,
            }
        ]

    recommended_window = {
        "start": windows_today[0]["start"],
        "end": windows_today[0]["end"],
        "expected_price": windows_today[0]["expected_price"],
    }

    # Fenster Woche
    windows_week = []
    if points_7d:
        for p in points_7d[:5]:
            if p.get("q50") is not None:
                windows_week.append(
                    {
                        "timestamp": p.get("timestamp"),
                        "expected_price": p.get("q50"),
                    }
                )

    expected_saving_eur = round(
        max(0.0, (price_now - expected_price_later) * liters), 2
    )

    # Alternativen (F2 Umweg-Ökonomie)
    alternatives_nearby = []
    best_alt = None
    for cand in station_list:
        if cand["station_id"] == station_id:
            continue
        cand_price = cand.get("price") or cand.get("last_price")
        if cand_price is None:
            continue
        # Distanz ab Anker oder Luftlinie
        dist_cand = cand.get("dist_km") or 2.0
        dist_self = chosen_station.get("dist_km") or 1.5
        detour_km = max(0.5, abs(dist_cand - dist_self))

        d = detour_km  # onroute
        fuel_eur = (d / 100.0) * consumption * cand_price
        time_eur = (d / max(1.0, speed)) * z_used
        detour_cost = fuel_eur + time_eur
        gross_eur = (price_now - cand_price) * liters
        net_eur = gross_eur - detour_cost
        delta_ct = (price_now - cand_price) * 100.0

        alt_entry = {
            "station_id": cand["station_id"],
            "name": cand.get("name") or cand["station_id"],
            "brand": cand.get("brand") or "",
            "price": round(cand_price, 3),
            "delta_ct": round(delta_ct, 2),
            "detour_km": round(detour_km, 1),
            "net_eur": round(net_eur, 2),
            "worth_it": net_eur >= 1.5,
            "maps_url": cand.get("maps_url"),
        }
        alternatives_nearby.append(alt_entry)
        if best_alt is None or net_eur > best_alt["net_eur"]:
            best_alt = alt_entry

    alternatives_nearby = sorted(
        alternatives_nearby, key=lambda a: a["net_eur"], reverse=True
    )[:3]

    # Kalibrierungs-Gate & Entscheidungs-Logik (§0.4, §4, §6)
    store = load_store(live_data.settings)
    advice_stats = compute_advice_stats(store)
    wallet_stats = compute_wallet_stats(store)

    is_calibrated = advice_stats.get("calibrated", False)

    # Vor M7 ist kalibriert = False
    # "Korrekt absent (Gate, kein Handlungsbedarf): Ampel-Empfehlung, P_besser-%,
    # „Heute später/Diese Woche“ im Alltag, Warten-Option im 3-Wege-Vergleich."
    p_correct = None
    confidence_badge = "low"
    reason_short = (
        "M7-Kalibrierungs-Gate steht aus (noch keine kalibrierte Empfehlung)."
    )

    if not is_calibrated:
        action = "no_advice"
        confidence_badge = "low"
        reason_short = "M7-Kalibrierung steht aus: Preismeldungen sind unverfälscht, Empfehlungen noch unkalibriert."
    else:
        # Kalibrierter Modus (nach M7)
        is_golden_window = 17.5 <= hour <= 20.5
        hours_until = max(0.0, start_hour_later - hour)

        if is_golden_window or price_now <= expected_price_later + 0.01:
            action = "refuel_now"
            confidence_badge = "high"
            reason_short = (
                "Aktueller Preis liegt im Tagestief-Bereich. Jetzt tanken empfohlen."
            )
            p_correct = 0.88
        elif best_alt and best_alt["net_eur"] >= 1.5:
            action = "refuel_elsewhere"
            confidence_badge = "high"
            reason_short = f"Fahre zu {best_alt['name']}: spart netto +{best_alt['net_eur']:.2f} € trotz Umweg."
            p_correct = 0.82
        elif expected_saving_eur >= 1.0 and hours_until >= 0.5:
            action = "wait"
            confidence_badge = "medium"
            reason_short = f"Preis fällt im Abendfenster voraussichtlich — Warten spart ca. {expected_saving_eur:.2f} €."
            p_correct = 0.76
        else:
            action = "refuel_now"
            confidence_badge = "medium"
            reason_short = "Warten würde < 1,00 € Ersparnis bringen. Jetzt tanken."
            p_correct = 0.90

    # Snapshot im Feedback-Store erfassen
    snapshot_input = {
        "clock_hour": hour,
        "action": action,
        "station_id": station_id,
        "station_name": station_name,
        "alt_station_id": best_alt["station_id"] if best_alt else None,
        "alt_station_name": best_alt["name"] if best_alt else None,
        "price_now": round(price_now, 3),
        "window_start_hour": start_hour_later,
        "window_end_hour": end_hour_later,
        "expected_price": round(expected_price_later, 3),
        "expected_saving_eur": expected_saving_eur,
        "p_correct": p_correct,
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
                "price_now": round(price_now, 3),
                "maps_url": chosen_station.get("maps_url"),
            },
            "recommended_window": recommended_window,
            "expected_saving_eur": expected_saving_eur,
            "p_correct": p_correct,
            "confidence_badge": confidence_badge,
            "reason_short": reason_short,
        },
        "alternatives_nearby": alternatives_nearby,
        "windows_today": windows_today,
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
