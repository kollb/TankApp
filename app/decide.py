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
import math
import statistics
from typing import Any

from .data import haversine_km, metadata, publication
from .feedback import (
    compute_advice_stats,
    compute_wallet_stats,
    load_store,
    record_snapshot,
)
from .pside import THETA_CT, p_better, p_lohnt, window_p
from .route import CIRCUITY, _auto_time_value, _berlin_hour, _parse_float
from .thresholds import DEFAULT_THRESHOLDS, active_thresholds

FUELS = {"e10", "e5", "diesel"}

# A2 (F3 „Tank bei ¼ — kann ich warten?“): Reserve als Literzahl, nicht als
# feste km-Zahl — dieselbe Restmenge ist beim Benziner (6 l/100 km) deutlich
# mehr Reichweite als im SUV (10 l/100 km). Faustwert: ~5 l Reserve entspricht
# der typischen Reserveanzeige; daraus wird mit dem persönlichen Verbrauch die
# Reserve-Reichweite. „empty“ = Rest ≤ Reserve → Warten wird blockiert,
# „low“ = Rest ≤ 2 × Reserve → ehrlicher Hinweis, Fenster bleibt machbar.
TANK_RESERVE_LITERS = 5.0
TANK_CAPACITY_DEFAULT_L = 50.0
TANK_PERCENT_MIN, TANK_PERCENT_MAX = 0.0, 100.0
TANK_CAPACITY_MIN, TANK_CAPACITY_MAX = 20.0, 120.0
RANGE_KM_MAX = 1500.0

try:
    from zoneinfo import ZoneInfo

    BERLIN_TZ = ZoneInfo("Europe/Berlin")
except Exception:  # pragma: no cover
    BERLIN_TZ = dt.timezone.utc


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
    return value if math.isfinite(value) and value > 0 else None


def _parse_deadline(value: Any) -> dt.datetime | None:
    """Spätestmöglicher Tankzeitpunkt ``latest_by`` (Konzept §4.1/§4.3/§11.1).

    ISO-Zeitstempel (mit Zone) oder naive ISO-Zeit — naive wird als
    Europe/Berlin gelesen, weil die App Zeiten lokal anzeigt und UTC
    speichert. ``None`` bei leerem Wert, ``False`` bei Müll (Aufrufer
    antwortet dann mit 400 statt still zu ignorieren).
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        stamp = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return False  # type: ignore[return-value]
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=BERLIN_TZ)
    return stamp


def _floor_2h(stamp: dt.datetime) -> dt.datetime:
    """Blockbeginn eines 2-h-Fensters (Berlin), sekundengenau gefloort."""
    local = stamp.astimezone(BERLIN_TZ).replace(minute=0, second=0, microsecond=0)
    return local.replace(hour=(local.hour // 2) * 2)


def _block_for_window(draws: dict[str, Any], window_start: str) -> int | None:
    """Index des veröffentlichten Blocks zu einem Fensterbeginn.

    Blockanfänge liegen als UTC-ISO vor; der Vergleich erfolgt über den
    gefloorten Zeitpunkt selbst (nicht über String-Gleichheit), damit
    Zeitzonen-Schreibweisen keine Rolle spielen.
    """
    stamp = _parse_ts(window_start)
    if stamp is None:
        return None
    target = _floor_2h(stamp).astimezone(dt.timezone.utc)
    for index, block in enumerate(draws.get("blocks", []) or []):
        if _parse_ts(block.get("start")) == target:
            return index
    return None


def _p_besser_value(
    draws: dict[str, Any] | None, window_start: str | None, anchor: float | None
) -> float | None:
    """F1: ``P(min über Fenster ≤ p_jetzt − θ)`` aus den veröffentlichten Draws."""
    if not draws or not window_start or anchor is None:
        return None
    minima = draws.get("minima")
    if not minima:
        return None
    return p_better(minima, _block_for_window(draws, window_start), anchor, THETA_CT)


def _window_p_value(
    draws: dict[str, Any] | None, window_start: str | None
) -> float | None:
    """F3: ``P(Fenster ≤ Minimum im ±6-h-Umfeld)`` aus den Draws."""
    if not draws or not window_start:
        return None
    minima = draws.get("minima")
    if not minima:
        return None
    return window_p(minima, _block_for_window(draws, window_start))


def _today_windows(
    points: list[dict[str, Any]],
    clock_now: dt.datetime,
    latest_by: dt.datetime | None = None,
) -> list[dict[str, Any]]:
    """2-h-Blöcke (Berlin) des Heute-Forecasts, billigste zuerst.

    Fenstergrenzen sind echte Prognose-Zeitstempel (ISO), keine erfundenen
    Stunden. Nur Blöcke, die noch nicht vollständig vergangen sind — und mit
    ``latest_by`` nur Blöcke, die vollständig vor dem spätesten akzeptablen
    Tankzeitpunkt enden (Konzept §4.3: Fenster ⊆ [jetzt, T_max]).
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
        if latest_by is not None and end > latest_by:
            continue  # Block endet nach dem spätesten Tankzeitpunkt
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


def _week_windows(
    points_7d: list[dict[str, Any]],
    clock_now: dt.datetime,
    latest_by: dt.datetime | None = None,
) -> list[dict[str, Any]]:
    """2-h-Blöcke (Berlin) über den 7-Tage-Horizont, billigste zuerst.

    Dieselbe Blockstruktur wie ``_today_windows`` — F3 zeigt über die ganze
    Woche echte Fenster (nicht nur den billigsten Punkt je Tag, Prüfstand
    §1.4). Nur Blöcke, die noch nicht vollständig vergangen sind, und mit
    ``latest_by`` nur Blöcke, die vor dem spätesten Tankzeitpunkt enden.
    """
    blocks: dict[tuple, list[tuple[dt.datetime, float]]] = {}
    for point in points_7d:
        stamp = _parse_ts(point.get("timestamp"))
        q50 = _q50(point)
        if stamp is None or q50 is None:
            continue
        berlin = stamp.astimezone(BERLIN_TZ)
        key = (berlin.date().isoformat(), int(berlin.hour // 2))
        blocks.setdefault(key, []).append((stamp, q50))
    windows = []
    for (_day, _block), entries in blocks.items():
        entries.sort(key=lambda e: e[0])
        start = entries[0][0]
        end = entries[-1][0]
        if end <= clock_now:
            continue  # Block vollständig vergangen
        if latest_by is not None and end > latest_by:
            continue  # Block endet nach dem spätesten Tankzeitpunkt
        median = round(statistics.median(q for _, q in entries), 3)
        windows.append(
            {
                "start": start.isoformat(),
                "end": end.isoformat(),
                "expected_price": median,
            }
        )
    windows.sort(key=lambda w: w["expected_price"])
    return windows[:3]


def _coords(station: dict[str, Any]) -> tuple[float, float] | None:
    lat, lon = station.get("lat"), station.get("lon")
    if (
        type(lat) in (int, float)
        and type(lon) in (int, float)
        and math.isfinite(lat)
        and math.isfinite(lon)
    ):
        return (float(lat), float(lon))
    return None


def _de_km(km: float) -> str:
    """Kilometer deutsch formatiert (ganzzahlig, Punkt als Tausendertrennzeichen)."""
    return f"{km:,.0f}".replace(",", ".")


def tank_context(
    tank_percent: float | None,
    tank_capacity_l: float | None,
    range_km_input: float | None,
    consumption: float,
) -> dict[str, Any] | None:
    """A2: Restreichweite und Warte-Risiko aus der Tankstand-Eingabe (F3).

    Eingabe ist entweder ``range_km`` (Rest-km direkt, z. B. aus dem
    Bordcomputer) oder ``tank_percent`` (Füllstand, der über Tankgröße und
    Verbrauch in Reichweite übersetzt wird). Ohne eine der beiden Angaben
    liefert die Funktion ``None`` — die App sagt dann nichts über den
    Tankstand statt etwas zu raten.

    ``state``:
    - ``empty``: Rest ≤ Reserve-Reichweite → Warten wird als riskant benannt
      und blockiert die Warte-Empfehlung („Reserve reicht ~X km“).
    - ``low``: Rest ≤ 2 × Reserve → Hinweis, Fenster bleibt machbar.
    - ``ok``: kein Tankstand-Hinweis.
    """
    if range_km_input is not None:
        range_km = float(range_km_input)
        source = "input"
    elif tank_percent is not None:
        capacity = (
            tank_capacity_l if tank_capacity_l is not None else TANK_CAPACITY_DEFAULT_L
        )
        range_km = (
            capacity * (float(tank_percent) / 100.0) / max(0.1, consumption) * 100.0
        )
        source = "computed"
    else:
        return None

    reserve_km = TANK_RESERVE_LITERS / max(0.1, consumption) * 100.0
    if range_km <= reserve_km:
        state = "empty"
    elif range_km <= 2.0 * reserve_km:
        state = "low"
    else:
        state = "ok"

    message = None
    if state == "empty":
        message = (
            f"Warten riskant: Der Tankrest reicht für etwa {_de_km(range_km)} km — "
            f"das ist Reservebereich (unter ~{_de_km(reserve_km)} km bei "
            f"{_de_km(consumption)} l/100 km). Tank jetzt, nicht auf das Fenster warten."
        )
    elif state == "low":
        message = (
            f"Tankstand knapp: Der Rest reicht für etwa {_de_km(range_km)} km. "
            "Das Fenster ist machbar, solange du bis dahin nicht deutlich mehr fährst."
        )

    return {
        "input": source,
        "tank_percent": tank_percent,
        "tank_capacity_l": tank_capacity_l,
        "range_km": round(range_km, 1),
        "reserve_range_km": round(reserve_km, 1),
        "state": state,
        "blocks_wait": state == "empty",
        "message": message,
    }


def _detour_km(
    chosen: dict[str, Any],
    cand: dict[str, Any],
    mode: str = "onroute",
    home: tuple[float, float] | None = None,
) -> tuple[float, str]:
    """Umweg-Streckenlänge je Fahrtmodus (km, **einseitig**).

    - ``onroute`` (Default, Alltagsfall §10): nur der Mehrweg gegenüber der
      Vergleichsstation — Luftlinie zwischen den Stationskoordinaten × 1,3
      (gleiche Umweg-Konvention wie data-tools/road_route.py). Fallback
      Anker-Distanz-Differenz (Dreiecksungleichungs-Schranke, kann 0 sein).
    - ``dedicated`` (Extrafahrt): die einfache Strecke ab Zuhause; ohne
      ``home``-Koordinate die Anker-Distanz aus dem Polling-Set (der Anker
      ist der Heimatstandort). Die Aufrufer verdoppeln sie für Hin+Rück.

    Rückgabe: ``(km, quelle)``. ``quelle`` ist nie verschwiegen — sie sagt,
    ob gerechnet oder geschätzt wurde.
    """
    if mode == "dedicated":
        home_coords = home
        cand_coords = _coords(cand)
        if home_coords and cand_coords:
            km = haversine_km(
                home_coords[0], home_coords[1], cand_coords[0], cand_coords[1]
            )
            return round(km * CIRCUITY, 2), "home_haversine"
        dist = cand.get("dist_km")
        if type(dist) in (int, float) and math.isfinite(dist) and dist >= 0:
            return round(float(dist), 2), "anchor_dist"
        return 0.0, "unknown"

    from_coords, to_coords = _coords(chosen), _coords(cand)
    if from_coords and to_coords:
        km = haversine_km(from_coords[0], from_coords[1], to_coords[0], to_coords[1])
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
    th: dict[str, float],
    mode: str = "onroute",
    home: tuple[float, float] | None = None,
    nowcasts: dict[str, list[float]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """F2-Liste: Netto-€ je Alternative (Konzept §4.2, Umweg-Ökonomie §10).

    ``mode``: ``onroute`` zählt nur den Mehrweg gegenüber der
    Vergleichsstation, ``dedicated`` den vollen Hin+Rückweg ab Zuhause
    (Konzept §10 „Betriebsmodi“).

    Mit ``nowcasts`` (Station → Nowcast-Draws) wird je Zeile zusätzlich
    ``p_lohnt = P(netto > 0)`` aus den Draws ausgewiesen (§4.2 — die
    „kritische Zusatzinformation“). Ohne Draws bleibt ``p_lohnt`` None.
    """
    alternatives = []
    best = None
    ref_nowcast = nowcasts.get(chosen_station["station_id"]) if nowcasts else None
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
        detour_km, detour_source = _detour_km(chosen_station, cand, mode, home)
        # onroute: der Mehrweg fällt einmal an. dedicated: Hin + Rück.
        total_km = detour_km * (2.0 if mode == "dedicated" else 1.0)
        fuel_eur = (total_km / 100.0) * consumption * cand_price
        time_eur = (total_km / max(1.0, speed)) * z_used
        detour_cost = fuel_eur + time_eur
        gross_eur = (anchor - cand_price) * liters
        net_eur = gross_eur - detour_cost
        alt_nowcast = nowcasts.get(cand["station_id"]) if nowcasts else None
        # H1/B6: Verdict aus denselben Schwellen wie route.py — server ist einzige Quelle.
        worth_th = th.get("elsewhere_net_eur", 1.5)
        borderline_th = th.get("elsewhere_borderline_eur", 0.5)
        if net_eur >= worth_th:
            verdict = "worth"
        elif net_eur >= borderline_th:
            verdict = "borderline"
        else:
            verdict = "not_worth"
        entry = {
            "station_id": cand["station_id"],
            "name": cand.get("name") or cand["station_id"],
            "brand": cand.get("brand") or "",
            "price": round(cand_price, 3),
            "delta_ct": round((anchor - cand_price) * 100.0, 2),
            "detour_km": round(total_km, 2),
            "detour_km_est": round(total_km, 2),
            "detour_mode": detour_source,
            "dist_mode": detour_source,
            "trip_mode": mode,
            "fuel_cost_eur": round(fuel_eur, 2),
            "time_cost_eur": round(time_eur, 2),
            "detour_cost_eur": round(detour_cost, 2),
            "gross_eur": round(gross_eur, 2),
            "net_eur": round(net_eur, 2),
            "critical_delta_ct": round(
                (detour_cost / liters * 100.0) if liters else 0.0, 2
            ),
            "worth_it": net_eur >= worth_th,
            "verdict": verdict,
            "p_lohnt": p_lohnt(
                ref_nowcast,
                alt_nowcast,
                liters,
                total_km,
                consumption,
                speed,
                z_used,
            )
            if ref_nowcast and alt_nowcast
            else None,
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
    p_besser: float | None = None,
    th: dict[str, float] | None = None,
    no_window_reason: str | None = None,
    quality_gate: str | None = None,
) -> tuple[str, str, str]:
    """€/P-Entscheidungstabelle (Konzept §4.1, §4.2, §4.4, Auswertung §4.5).

    Gibt (action, confidence_badge, reason_short) zurück. Die Aktion wird
    immer in den Advice-Ledger geschrieben (Shadow-Betrieb ab Tag 1);
    angezeigt wird sie erst nach dem M7-Gate.

    Auswertungsreihenfolge (§4.5): Schritt 1 ist das **Güte-Gate** —
    ``quality_gate`` ist gesetzt, wenn der Rolling-PICP der Station rot ist
    (Konzept §3.3.3/§4.4: „Keine klare Empfehlung — tank nach Bedarf“).
    Dann läuft keine F1/F2-Empfehlung, egal wie gut die €-Seite aussieht:
    eine unzuverlässige Intervallqualität rechtfertigt keine Präzision.

    Die Prozent-Gates rechnen mit der **Prognoseverteilung**, nicht mit einer
    Ledger-Trefferquote: ``p_besser`` (§4.1) und, am F2-Zweig,
    ``best_alt["p_lohnt"]`` (§4.2). Ist die Verteilung nicht verfügbar
    (``None``), entfallen die Prozent-Gates — dann entscheidet allein die
    €-Seite, ehrlich statt einer geratenen Zahl.

    Alle Schwellen kommen aus ``th`` (Konzept §4.5: „Alle Schwellen liegen in
    einer Config“; M7 zieht sie an gemessene Trefferquoten nach, §13).
    """
    th = th or DEFAULT_THRESHOLDS
    # Güte-Gate (§4.5 Schritt 1, §4.4): Rot im Rolling-PICP → keine Ampel,
    # kein Prozentwert, keine €-Rechnung als Empfehlung.
    if quality_gate is not None:
        return (
            "no_advice",
            "low",
            "Keine klare Empfehlung — Prognose derzeit unsicher "
            "(7-Tage-Intervallquote außerhalb Toleranz). Tank nach Bedarf.",
        )
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
            no_window_reason
            or "Keine Prognose verfügbar — Empfehlung erst mit Modelldaten.",
        )
    # F2 zuerst (§4.5 Schritt 2): Alternative bei netto ≥ Schwelle und
    # P_lohnt ≥ Schwelle (ohne Draws entfällt nur das Prozent-Gate).
    alt_p = best_alt.get("p_lohnt") if best_alt is not None else None
    if (
        best_alt is not None
        and best_alt["net_eur"] >= th["elsewhere_net_eur"]
        and (alt_p is None or alt_p >= th["elsewhere_p"])
    ):
        badge = "high" if alt_p is not None and alt_p >= 0.7 else "medium"
        return (
            "refuel_elsewhere",
            badge,
            f"Fahre zu {best_alt['name']}: spart netto +{best_alt['net_eur']:.2f} € trotz Umweg.",
        )
    # Grauzone (§4.4): P_besser in [40, 60] % → kein Advice. Kein Kaltstart-
    # Schutz nötig: die Verteilung liefert P_besser direkt, ohne Stichprobe.
    if (
        p_besser is not None
        and 0.40 <= p_besser <= 0.60
        and expected_saving_eur >= th["now_eur"]
    ):
        return (
            "no_advice",
            "low",
            f"Warte-Signal zu unsicher (P ≈ {p_besser * 100:.0f} %) — kein Advice, Preise bleiben unverfälscht.",
        )
    # F1 (§4.1). Ohne Verteilungs-P kann die grüne Ampel („≥ 70 %“) nicht
    # belegt werden → dann höchstens „gelb“ (ehrlich statt geraten).
    if expected_saving_eur >= th["wait_eur_high"] and (
        p_besser is None or p_besser >= th["wait_p_high"]
    ):
        badge = "high" if p_besser is not None else "medium"
        return (
            "wait",
            badge,
            f"Preis fällt im Fenster voraussichtlich — Warten spart ca. {expected_saving_eur:.2f} €.",
        )
    if expected_saving_eur >= th["wait_eur_mid"] and (
        p_besser is None or p_besser >= th["wait_p_mid"]
    ):
        return (
            "wait",
            "medium",
            f"Eher warten: Fenster spart voraussichtlich ca. {expected_saving_eur:.2f} €.",
        )
    if p_besser is not None and p_besser < th["now_p"]:
        return (
            "refuel_now",
            "low",
            "Warte-Empfehlung zu unsicher (P < 50 %) — jetzt tanken.",
        )
    if expected_saving_eur < th["now_eur"]:
        return (
            "refuel_now",
            "medium",
            f"Warten brächte < {th['now_eur']:.2f} € Ersparnis — jetzt tanken.",
        )
    # Fallback (€-Gates ohne belastbares P): Ersparnis ≥ Schwelle → warten.
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

    # Konzept §10: Fahrtmodus. onroute = tanken ohnehin unterwegs (nur der
    # Mehrweg zählt, Default), dedicated = Extrafahrt ab Zuhause.
    mode = str(params.get("mode") or params.get("trip_mode") or "onroute").lower()
    if mode not in ("onroute", "dedicated"):
        raise ValueError("invalid_mode")
    home = None
    home_lat = _parse_float(params.get("home_lat"), None)
    home_lon = _parse_float(params.get("home_lon"), None)
    if home_lat is not None or home_lon is not None:
        if (
            home_lat is None
            or home_lon is None
            or not (47.0 <= home_lat <= 56.0 and 5.0 <= home_lon <= 16.0)
        ):
            raise ValueError("invalid_home")
        home = (home_lat, home_lon)

    # Konzept §4.1/§4.3/§11.1: spätestmöglicher Tankzeitpunkt.
    latest_by_raw = params.get("latest_by")
    latest_by = _parse_deadline(latest_by_raw)
    if latest_by is False:
        raise ValueError("invalid_latest_by")
    if latest_by is not None and latest_by.tzinfo is None:
        latest_by = latest_by.replace(tzinfo=BERLIN_TZ)

    # A2: Tankstand für F3 — Füllstand in Prozent (mit Tankgröße) oder
    # Rest-km direkt. Fehlt beides, bleibt tank None (keine Tankstand-Aussage).
    tank_percent = _parse_float(params.get("tank_percent"), None)
    if tank_percent is not None and not (
        TANK_PERCENT_MIN <= tank_percent <= TANK_PERCENT_MAX
    ):
        raise ValueError("invalid_tank")
    tank_capacity = _parse_float(params.get("tank_capacity_l"), None)
    if tank_capacity is not None and not (
        TANK_CAPACITY_MIN <= tank_capacity <= TANK_CAPACITY_MAX
    ):
        raise ValueError("invalid_tank")
    range_km_input = _parse_float(params.get("range_km"), None)
    if range_km_input is not None and not (0.0 <= range_km_input <= RANGE_KM_MAX):
        raise ValueError("invalid_tank")
    tank = tank_context(tank_percent, tank_capacity, range_km_input, consumption)

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
    station_city = chosen_station.get("city") or city
    if not station_city:
        # Die Station stammt aus dem Polling-Set (metadata) — city muss also
        # gesetzt sein. Ohne Stadt wäre die spätere Abrechnung gegen eine
        # geratene Stadt gelaufen (vorher still „Frankfurt", Prüfstand §3.8).
        return {"error_code": "unknown_city"}

    # Ankerpreis: frisch > zuletzt beobachtet > unbekannt (None — nie erfunden).
    anchor = chosen_station.get("price")
    if anchor is None:
        anchor = chosen_station.get("last_price")

    # Prognosen laden — einmal die Veröffentlichung lesen, damit Draws und
    # Nowcasts aller Stationen für P_besser/P_lohnt/F3-P da sind, ohne je
    # Alternative erneut die Datei zu parsen.
    bundle = publication(live_data.settings)
    forecasts = [
        row
        for row in bundle.get("forecasts", [])
        if row.get("fuel", "").lower() == fuel
    ]
    by_station = {row.get("station_id"): row for row in forecasts}
    forecast_data = by_station.get(station_id) or {}
    points = forecast_data.get("points") or []
    points_7d = forecast_data.get("points_7d") or []
    draws_24h = forecast_data.get("draws_24h") or {}
    draws_7d = forecast_data.get("draws_7d") or {}
    nowcasts: dict[str, list[float]] = {
        row.get("station_id"): (row.get("draws_24h") or {}).get("nowcast")
        for row in forecasts
        if (row.get("draws_24h") or {}).get("nowcast")
    }

    # Beste Fenster heute und über die Woche (echte 2-h-Blöcke).
    # latest_by schneidet den Horizont ab (Konzept §4.3: Fenster ⊆ [jetzt, T_max]).
    windows_today = _today_windows(points, clock_now, latest_by)
    windows_week = _week_windows(points_7d, clock_now, latest_by)
    # „Es gäbe Prognosen, aber keins mehr vor deinem spätesten Zeitpunkt“ —
    # das ist eine andere Aussage als „keine Prognose vorhanden“.
    horizon_cut = bool(latest_by is not None and not windows_today and bool(points))

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

    # M7-Schwellen (§13): Startwerte, optional an gemessene Trefferquoten
    # nachgezogen (nur wenn der Betreiber auto-apply gesetzt hat).
    auto_apply = bool(getattr(live_data.settings, "m7_auto_apply", False))

    # Ledger lesen: Tabellen-Qualität + interne P-Schätzung je Aktion.
    store = load_store(live_data.settings)
    advice_stats = compute_advice_stats(store, now=clock_now)
    wallet_stats = compute_wallet_stats(store, now=clock_now)
    is_calibrated = advice_stats.get("calibrated", False)

    thresholds, tuning = active_thresholds(advice_stats, auto_apply=auto_apply)

    # Alternativen (F2 Umweg-Ökonomie) — nur mit Ankerpreis rechenbar.
    if anchor is not None:
        alternatives_nearby, best_alt = _alternatives(
            station_list,
            chosen_station,
            anchor,
            liters,
            consumption,
            speed,
            z_used,
            thresholds,
            mode,
            home,
            nowcasts,
        )
    else:
        alternatives_nearby, best_alt = [], None

    # P-Seite aus der Prognoseverteilung (Konzept §4.1–4.3), nicht aus der
    # Ledger-Grundrate. p_besser = P(min über Fenster ≤ p_jetzt − θ), θ = 1 ct.
    # Ohne Draws bleibt p None — dann entscheidet die €-Seite ohne Prozent-Gate.
    rec_start = recommended_window["start"] if recommended_window else None
    p_better_own = _p_besser_value(draws_24h, rec_start, anchor)
    alt_draws = (
        by_station.get(best_alt["station_id"], {}).get("draws_24h")
        if best_alt
        else None
    )
    p_better_alt = _p_besser_value(alt_draws, rec_start, anchor)

    no_window_reason = (
        "Kein Fenster mehr vor deinem spätesten Tankzeitpunkt "
        f"({latest_by.astimezone(BERLIN_TZ).strftime('%d.%m. %H:%M')} Uhr) — "
        "tank jetzt nach Bedarf."
        if horizon_cut
        else None
    )
    # Güte-Gate (§4.5 Schritt 1): Rolling-PICP 7 d der ausgewählten Station
    # (Konzept §3.3.3). Nur „red“ greift; ohne veröffentlichte Zahl bleibt
    # das Gate ehrlich aus — nicht belegt ist keine Aussage.
    rolling = (forecast_data.get("rolling_picp_7d") or {}).get("current") or {}
    rolling_badge = rolling.get("badge")
    quality_gate = "picp" if rolling_badge == "red" else None
    table_action, badge, reason = _table_action(
        anchor,
        expected_price_later,
        expected_saving_eur,
        best_alt,
        p_better_own,
        thresholds,
        no_window_reason,
        quality_gate,
    )
    # A2: Physik vor Fenster. Sagt die Tabelle „warten“, der Tank ist aber im
    # Reservebereich, gewinnt der Tankstand — „bestes Fenster morgen“ wäre
    # hier eine gefährliche Antwort. Die Tabelle selbst bleibt unangetastet
    # (Güte-Gate, Shadow-Messung); nur die angezeigte Aktion kippt, und der
    # Ledger bekommt die Aktion, die wirklich angezeigt wurde — sonst würde
    # ein befolgtes „jetzt tanken (Reserve)“ später als „ignoriert“ zählen.
    if tank is not None and tank["blocks_wait"] and table_action == "wait":
        action_base = "refuel_now"
        badge = "high"  # Physik, keine Modellobschätzung
        reason = tank["message"]
    else:
        action_base = table_action
    # Die P, die zum Settlement-Ereignis passt (§5.2): wait → P(min ≤ p−θ),
    # refuel_now → 1 − P(min ≤ p−θ), refuel_elsewhere → P(Alt-Fenster ≤ p−θ).
    if action_base == "wait":
        p_decision = p_better_own
    elif action_base == "refuel_now":
        p_decision = None if p_better_own is None else round(1.0 - p_better_own, 4)
    elif action_base == "refuel_elsewhere":
        p_decision = p_better_alt
    else:
        p_decision = None

    # M7-Gate (§0.4): Vor der Kalibrierung keine Handlungsempfehlung und
    # kein P_besser anzeigen — der Ledger misst die Tabelle trotzdem (Shadow).
    # F2-P_lohnt und F3-Fenster-P sind Informationswerte aus der Verteilung
    # (§4.2/§4.3) und hängen nicht am Kalibrierungs-Gate. Die Tankstand-
    # Warnung (A2) ist Physik und erscheint unabhängig davon als eigener Block.
    if is_calibrated:
        action = action_base
        p_correct = p_decision
        confidence_badge = badge
        reason_short = reason
    else:
        action = "no_advice"
        p_correct = None
        confidence_badge = "low"
        # Das Güte-Gate ist Auswertungsschritt 1 (§4.5) und bleibt auch vor
        # der M7-Freigabe die konkretere Warnung.  Sonst würde der allgemeine
        # Kalibrierungstext den neuen roten PICP-Befund vollständig verdecken.
        reason_short = (
            reason
            if quality_gate is not None
            else (
                "Kalibrierung steht noch aus: Preismeldungen sind unverfälscht, "
                "Empfehlungen aber noch nicht freigegeben."
            )
        )

    # Snapshot im Feedback-Store erfassen (Tabellen-Aktion + Fenster-ISO).
    # p_besser ist die Verteilungs-P, die Brier gegen das Settlement misst —
    # dieselbe Zahl, die nach dem M7-Gate im UI erscheint.
    snapshot_input = {
        "clock_hour": hour,
        "action": action_base,
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
        "p_besser": p_decision,
        "liters_assumed": liters,
        "fuel": fuel,
        "trip_mode": mode,
        "latest_by": latest_by.isoformat() if latest_by is not None else None,
        # A2: Tankstand-Zustand zum Entscheidungszeitpunkt — nur
        # Informationsträger (Auswertung „Deadline-Druck × Reserve“),
        # die Kollabierung hängt weiter nur an Aktion/Station/Fenster.
        "tank_state": tank.get("state") if tank else None,
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
                "expected_saving_eur": round(
                    max(0.0, (anchor - w["expected_price"]) * liters), 2
                )
                if anchor is not None
                else None,
                "p": _window_p_value(draws_24h, w["start"]),
            }
            for w in windows_today
        ],
        "windows_week": [
            {
                "start": w["start"],
                "end": w["end"],
                "expected_price": w["expected_price"],
                "expected_saving_eur": round(
                    max(0.0, (anchor - w["expected_price"]) * liters), 2
                )
                if anchor is not None
                else None,
                "p": _window_p_value(draws_7d, w["start"]),
            }
            for w in windows_week
        ],
        "episode": {
            "id": ep.get("id"),
            "status": ep.get("status"),
            "intent": ep.get("intent"),
            "opened_at": ep.get("opened_at"),
        },
        # A2: Tankstand-Bewertung als eigener Block — die GUI zeigt ihn
        # unabhängig von der Ampel (Physik, kein Modellwert). ``None``,
        # wenn keine Tankstand-Eingabe vorliegt.
        "tank": tank,
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
        # Engine-Qualität der ausgewählten Station (Konzept §3.3.3):
        # Rolling-PICP 7 d aus dem 21-Tage-Backtest. „gate“ ist gesetzt,
        # wenn das Güte-Gate (§4.4/§4.5 Schritt 1) die Empfehlung blockiert.
        "quality": {
            "rolling_picp_7d_pct": rolling.get("picp_pct"),
            "rolling_picp_7d_points": rolling.get("points"),
            "rolling_picp_7d_badge": rolling_badge,
            "rolling_picp_7d_as_of": rolling.get("day"),
            "rolling_picp_window_days": 7,
            "rolling_picp_nominal_pct": 95.0,
            "gate": quality_gate,
        },
        "context": {
            "fuel": fuel,
            "city": station_city,
            "liters": liters,
            "consumption_l_100km": consumption,
            "speed_kmh": speed,
            "value_of_time_eur_h": z_used,
            "z_auto": z_auto,
            "is_peak": is_peak,
            "trip_mode": mode,
            "home_used": home is not None,
            # Konzept §4.1/§4.3: Horizont [jetzt, latest_by].
            "latest_by": latest_by.isoformat() if latest_by is not None else None,
            "horizon_cut": horizon_cut,
        },
        "thresholds": {
            "active": thresholds,
            "auto_apply": bool(auto_apply),
            "tuning": {
                "changed": tuning.get("changed", False),
                "reasons": tuning.get("reasons", []),
                "sample": tuning.get("sample", {}),
                "targets": tuning.get("targets", {}),
                "min_n": tuning.get("min_n"),
            },
        },
        "debug": {
            "forecast_url": f"/api/v1/forecast?city={station_city}&station_id={station_id}&fuel={fuel}",
            "fitted_at": forecast_data.get("origin"),
        },
        "error_code": None,
    }
