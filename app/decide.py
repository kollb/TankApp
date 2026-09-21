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
import json
import math
import statistics
from pathlib import Path
from typing import Any

from .data import haversine_km, metadata, publication
from . import metrics
from .feedback import (
    WH_MIN_FILLS,
    compute_advice_stats,
    compute_wallet_stats,
    load_ledger,
    record_snapshot,
)
from .pside import (
    THETA_CT,
    expected_saving,
    expected_window_min_price,
    p_better,
    p_lohnt,
    window_p_details,
)
from .route import (
    AUTO_TIME_VALUE_RULE,
    CIRCUITY,
    _auto_time_value,
    _berlin_hour,
    _parse_float,
    net_economics,
)
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

# B1-Fix: Frische-Schwelle nicht mehr hardcodiert 15 min, sondern aus
# polling.json abgeleitet (2× erwartete Poll-Periode). Fallback 15 min.
FRESH_PRICE_FALLBACK_MINUTES = 15.0
FRESH_PRICE_POLL_MULTIPLIER = 2.0

try:
    from zoneinfo import ZoneInfo

    BERLIN_TZ = ZoneInfo("Europe/Berlin")
except Exception:  # pragma: no cover
    BERLIN_TZ = dt.timezone.utc


def _fresh_threshold_minutes(settings) -> float:
    """Leitet die Frische-Schwelle aus polling.json ab (B1-Fix).

    Erwartete Poll-Periode = len(sets) * request_interval_seconds / 60.
    Frisch = < multiplier * Periode. Fallback 15 min wenn Datei fehlt
    oder unlesbar. Begrenzt auf [5, 30] min – nie 0, nie Stunde.
    """
    try:
        path = Path(getattr(settings, "polling", ""))
        if not path.is_file():
            return FRESH_PRICE_FALLBACK_MINUTES
        raw = json.loads(path.read_text(encoding="utf-8"))
        sets = raw.get("sets") if isinstance(raw, dict) else None
        if not isinstance(sets, dict) or not sets:
            return FRESH_PRICE_FALLBACK_MINUTES
        interval = raw.get("request_interval_seconds", 300)
        try:
            interval_f = float(interval)
        except (TypeError, ValueError):
            interval_f = 300.0
        expected = len(sets) * interval_f / 60.0
        if not math.isfinite(expected) or expected <= 0:
            return FRESH_PRICE_FALLBACK_MINUTES
        threshold = expected * FRESH_PRICE_POLL_MULTIPLIER
        # Clamp
        return max(5.0, min(30.0, threshold))
    except Exception:
        return FRESH_PRICE_FALLBACK_MINUTES


def _is_price_fresh(station: dict[str, Any], threshold_minutes: float) -> bool:
    """Ist der Live-Preis dieser Station frisch (< threshold)?"""
    if station.get("price") is None:
        return False
    age = station.get("age_minutes")
    if age is None:
        # Kein Alter → als frisch werten (Server liefert gerade, aber ohne
        # age Feld – konservativ frisch, damit nicht unnötig verrauscht).
        return True
    try:
        age_f = float(age)
    except (TypeError, ValueError):
        return False
    return age_f <= threshold_minutes


# A21-B1.4: Zentrale Aktionsverwendbarkeit (Issue 201). Ein bestandenes,
# **historisches** M7-Gate ersetzt keine aktuelle Evidenz: Eine prädiktive
# Handlung wird nur freigegeben, wenn die gesamte Kette trägt —
#   frisch (Preis) → Station nutzbar → Prognose/Horizont → Herkunft →
#   Pfade → statistisches Gate → zulässige Handlung (M7).
# Die Codes sind der API-/UI-Vertrag (``blocking_reasons``), stabil und
# maschinenlesbar; die Tupelreihenfolge ist die Priorität, in der der erste
# Sperrgrund ``reason_short`` trägt. Bewusst **kein** Kriterium: „PIT
# active“ — eine rohe Veröffentlichung ist freigebbar, nur die Herkunft
# (``origin``) muss bekannt und das Modell aktuell sein.
ACTION_BLOCKING_REASONS = (
    "price_missing",
    "price_stale",
    "station_unusable",
    "data_stale",
    "forecast_missing",
    "forecast_expired",
    "origin_unknown",
    "paths_missing",
    "paths_invalid",
    "quality_missing",
    "quality_gate",
    "m7_pending",
)

# Menschliche Sperrgrund-Texte — dieselbe Sprache wie die Tabelle (§4.5).
_BLOCK_REASON_TEXT = {
    "price_missing": (
        "Kein aktueller Preis für diese Station — ohne Anker keine Empfehlung."
    ),
    "price_stale": (
        "Der Preis dieser Station ist nicht mehr frisch — "
        "Empfehlungen brauchen aktuelle Preise."
    ),
    "station_unusable": (
        "Diese Station hat derzeit geschlossen oder ist nicht nutzbar."
    ),
    "data_stale": (
        "Die Prognose beruht auf veralteten Eingangsdaten — keine Handlungsempfehlung."
    ),
    "forecast_missing": ("Keine Prognose verfügbar — Empfehlung erst mit Modelldaten."),
    "forecast_expired": (
        "Der Prognosezeitraum ist abgelaufen — "
        "Empfehlung erst mit dem nächsten Modell-Lauf."
    ),
    "origin_unknown": (
        "Die Prognose nennt keinen Datenstand — Herkunft unbekannt, keine Freigabe."
    ),
    "paths_missing": (
        "Die Prognoseverteilung fehlt — ohne sie keine belastbare Empfehlung."
    ),
    "paths_invalid": (
        "Die Prognoseverteilung enthält ungültige Werte — keine belastbare Empfehlung."
    ),
    "quality_missing": (
        "Keine ausreichende Güteinfo (7-Tage-Intervallquote) — "
        "nicht belegt ist keine Aussage."
    ),
    "quality_gate": (
        "Keine klare Empfehlung — Prognose derzeit unsicher "
        "(7-Tage-Intervallquote außerhalb Toleranz). Tank nach Bedarf."
    ),
    "m7_pending": (
        "Kalibrierung steht noch aus: Preismeldungen sind unverfälscht, "
        "Empfehlungen aber noch nicht freigegeben."
    ),
}

# Gültigkeitsfenster einer Freigabe — dieselbe 24-h-Altersgrenze wie die
# Anzeigeprüfung des Pi (``rp2.fallback_gui.forecast_valid_for_display``).
FORECAST_MAX_AGE_HOURS = 24
# O4: Unter dieser Fallzahl ist das Rolling-PICP-Badge keine Aussage.
QUALITY_MIN_DAYS = 3


def _has_future_point(points: list[dict[str, Any]], now: dt.datetime) -> bool:
    for point in points or []:
        stamp = _parse_ts(point.get("timestamp"))
        if stamp is not None and stamp > now:
            return True
    return False


def _paths_reason(draws_24h: Any) -> str | None:
    """``paths_missing``/``paths_invalid``/None — Pfade = veröffentlichte Draws.

    Die Minima sind die Simulationspfade der Fensterminima (2-D: Block ×
    Ziehung). Fehlende Pfade sind **kein** Freigabegrund mehr (Issue 201:
    „fehlende Pfade → Median-Potenzial trotzdem prädiktive Aktion“ war der
    Bug) — nichtendliche Werte sind ein eigener Sperrgrund statt einer
    stillen ``None`` in der Prozent-Rechnung.
    """
    minima = draws_24h.get("minima") if isinstance(draws_24h, dict) else None
    if not minima:
        return "paths_missing"
    for block in minima:
        entries = block if isinstance(block, (list, tuple)) else [block]
        if not entries:
            return "paths_invalid"
        for value in entries:
            try:
                number = float(value)
            except (TypeError, ValueError):
                return "paths_invalid"
            if not math.isfinite(number):
                return "paths_invalid"
    return None


def _action_blocking_reasons(
    station: dict[str, Any],
    forecast_data: dict[str, Any],
    *,
    fresh_threshold_minutes: float,
    now: dt.datetime,
) -> list[str]:
    """A21-B1.4: Trägt die **aktuelle** Evidenz eine prädiktive Handlung?

    Zentrale Verwendbarkeitsprüfung für jede Handlungsausgabe — auch aus
    Caches und Wiederkehr-Pfaden. Preis- und Potenzialanzeige bleiben davon
    unberührt (Ankerpreis darf der ``last_price``-Fallback sein, die
    Fenster zeigen ihr Median-Potenzial) — nur die **Freigabe** hängt an
    dieser Kette. Ohne Prognose sind die Folgeprüfungen subsumiert; die
    Rückgabe ist in ``ACTION_BLOCKING_REASONS``-Reihenfolge sortiert.
    """
    found: set[str] = set()
    # 1 — frisch: Nur ein frischer Live-Preis trägt die Freigabe. ``price``
    #     ist bereits ``None``, sobald die Beobachtung alt oder die Station
    #     geschlossen ist (``stations()``) — mit ``last_price`` ist der Preis
    #     also *vorhanden, aber alt*.
    if station.get("price") is None:
        if station.get("last_price") is None:
            found.add("price_missing")
        else:
            found.add("price_stale")
    elif not _is_price_fresh(station, fresh_threshold_minutes):
        found.add("price_stale")
    # 2 — Station nutzbar: geschlossene Stationen empfehlen nichts.
    if (station.get("status") or "open") != "open":
        found.add("station_unusable")
    points = forecast_data.get("points") or []
    if not forecast_data or not points:
        found.add("forecast_missing")
        return [r for r in ACTION_BLOCKING_REASONS if r in found]
    # 3 — Prognose/Horizont: gültiger Zeitraum und frische Eingangsdaten.
    if forecast_data.get("stale_data_at_origin") is True:
        found.add("data_stale")
    origin = _parse_ts(forecast_data.get("origin"))
    if origin is None:
        # 4 — Herkunft: ohne bekannten Datenstand ist nichts belegt.
        found.add("origin_unknown")
    else:
        age = now - origin
        if not dt.timedelta(0) <= age <= dt.timedelta(hours=FORECAST_MAX_AGE_HOURS):
            found.add("forecast_expired")
    if not _has_future_point(points, now):
        found.add("forecast_expired")
    # 5 — Pfade: die veröffentlichte Verteilung muss da und reell sein.
    paths = _paths_reason(forecast_data.get("draws_24h"))
    if paths:
        found.add(paths)
    # 6 — statistisches Gate: nicht belegt ist keine Aussage (O4), rot ist
    #     eine aktive Sperre — „kein roter PICP“ ist keine positive Güte.
    rolling = (forecast_data.get("rolling_picp_7d") or {}).get("current") or {}
    badge = rolling.get("badge") if isinstance(rolling, dict) else None
    days = rolling.get("n_days") if isinstance(rolling, dict) else None
    if badge not in ("green", "yellow", "red"):
        found.add("quality_missing")
    else:
        try:
            enough_days = days is not None and int(days) >= QUALITY_MIN_DAYS
        except (TypeError, ValueError):
            enough_days = False
        if not enough_days:
            found.add("quality_missing")
        elif badge == "red":
            found.add("quality_gate")
    return [r for r in ACTION_BLOCKING_REASONS if r in found]


def _action_valid_until(
    station: dict[str, Any],
    forecast_data: dict[str, Any],
    *,
    fresh_threshold_minutes: float,
    now: dt.datetime,
) -> str:
    """Ende der Freigabe-Gültigkeit (ISO) — min(Preisfrische, Modellalter)."""
    bounds: list[dt.datetime] = []
    age = station.get("age_minutes")
    try:
        age_f = float(age) if age is not None else None
    except (TypeError, ValueError):
        age_f = None
    if age_f is not None:
        remaining = max(0.0, fresh_threshold_minutes - age_f)
        bounds.append(now + dt.timedelta(minutes=remaining))
    origin = _parse_ts(forecast_data.get("origin"))
    if origin is not None:
        bounds.append(origin + dt.timedelta(hours=FORECAST_MAX_AGE_HOURS))
    if not bounds:
        bounds.append(now + dt.timedelta(minutes=fresh_threshold_minutes))
    return min(bounds).isoformat()


def release_still_valid(decide_res: dict[str, Any] | None, now: dt.datetime) -> bool:
    """A21-B1.4: Darf eine gecachte Freigabe noch gezeigt werden?

    Eine freigegebene Aktion trägt ``valid_until``; abgelaufen darf sie aus
    **keinem** Cache erneut erscheinen (Overview-Cache-Hit, Übergabe,
    Wiederkehr). ``no_advice`` ohne ``valid_until`` altert nicht — eine
    Ablehnung ist zeitunabhängig gültig. Unlesbare Gültigkeit wird als
    abgelaufen gewertet (fail-safe, im Zweifel neu berechnen).
    """
    if not isinstance(decide_res, dict):
        return True
    raw = decide_res.get("valid_until")
    if not raw:
        return True
    until = _parse_ts(raw)
    if until is None:
        return False
    return now < until


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
) -> dict[str, Any] | None:
    """F3 probability including the comparable, baseline-normalized display value."""
    if not draws or not window_start:
        return None
    minima = draws.get("minima")
    if not minima:
        return None
    return window_p_details(minima, _block_for_window(draws, window_start))


def _format_window_item(
    w: dict[str, Any],
    draws: dict[str, Any] | None,
    anchor: float | None,
    liters: float,
) -> dict[str, Any]:
    """Formatiert ein Fenster für windows_today / windows_week mit M3-Konsistenz."""
    minima = draws.get("minima") if draws else None
    block_idx = _block_for_window(draws, w["start"]) if draws else None
    saving_draws = (
        expected_saving(minima, block_idx, anchor, liters)
        if minima and block_idx is not None and anchor is not None
        else None
    )
    saving_median = (
        round(max(0.0, (anchor - w["expected_price"]) * liters), 2)
        if anchor is not None
        else None
    )
    min_price = (
        expected_window_min_price(minima, block_idx)
        if minima and block_idx is not None
        else None
    )
    p_info = _window_p_value(draws, w["start"]) if draws else None
    return {
        "start": w["start"],
        "end": w["end"],
        "expected_price": w["expected_price"],
        "expected_min_price": min_price,
        "expected_saving_eur": (
            saving_draws if saving_draws is not None else saving_median
        ),
        "expected_saving_median_eur": saving_median,
        "p": (p_info or {}).get("normalized"),
        "p_raw": (p_info or {}).get("raw"),
        "p_competitors": (p_info or {}).get("competitors"),
        "p_baseline": (p_info or {}).get("baseline"),
        "wh_weight": w.get("wh_weight"),
    }


def _wh_weight(
    profile: list[Any] | None,
    start: Any,
    end: Any,
) -> float | None:
    """Mean receipt availability of a window from a 24h or 7×24 profile.

    The 24-vector path remains for old callers/tests. New decision windows use
    local weekday + hour from their ISO timestamps, so Saturday 10:00 is not
    accidentally scored with Monday's commuter weight (O2).
    """
    if not profile or start is None or end is None:
        return None
    is_weekday = len(profile) == 7 and all(
        isinstance(day, list) and len(day) == 24 for day in profile
    )
    if is_weekday:
        start_stamp, end_stamp = _parse_ts(start), _parse_ts(end)
        if start_stamp is None or end_stamp is None:
            return None
        if end_stamp <= start_stamp:
            end_stamp = start_stamp + dt.timedelta(minutes=15)
        total, count = 0.0, 0
        stamp = start_stamp
        while stamp < end_stamp:
            local = stamp.astimezone(BERLIN_TZ)
            total += float(profile[local.weekday()][local.hour])
            count += 1
            stamp += dt.timedelta(minutes=15)
        return round(total / count, 6) if count else None
    if len(profile) != 24:
        return None
    try:
        start_hour, end_hour = float(start), float(end)
    except (TypeError, ValueError):
        return None
    if end_hour <= start_hour:
        end_hour = start_hour + 0.25
    total, count = 0.0, 0
    hour = start_hour
    while hour < end_hour - 1e-9:
        total += float(profile[int(hour) % 24])
        count += 1
        hour += 0.25
    return round(total / count, 6) if count else None


def _rank_windows(
    windows: list[dict[str, Any]],
    wh_hours: list[float] | None = None,
    anchor: float | None = None,
) -> list[dict[str, Any]]:
    """Reihenfolge der F3-Fenster: Preis — ab ≥ 8 Füllungen gewichtet (A9).

    Ohne persönliches Profil bleibt es bei der reinen Preisreihenfolge
    (bitgleich zur Version vor 0.31.0). Mit Profil zählt die **erwartet
    realisierte** Ersparnis: ``w̄(Fenster) · (Referenz − erwarteter Preis)``.
    Ein 3-Uhr-Fenster, in dem der Nutzer nie tankt, steht damit hinter einem
    geringfügig teureren Feierabend-Fenster. Referenz ist der Ankerpreis,
    fehlt er, das teuerste Fenster der Auswahl.
    """
    if not windows:
        return windows
    for window in windows:
        window["wh_weight"] = _wh_weight(
            wh_hours, window.get("start"), window.get("end")
        )
    if not wh_hours:
        windows.sort(key=lambda w: (w["expected_price"], w["start"]))
        return windows

    reference = (
        float(anchor)
        if anchor is not None
        else max(float(w["expected_price"]) for w in windows)
    )

    def score(window: dict[str, Any]) -> float:
        weight = window.get("wh_weight") or 0.0
        return weight * max(0.0, reference - float(window["expected_price"]))

    windows.sort(
        key=lambda w: (
            -score(w),
            float(w["expected_price"]),
            str(w.get("start") or ""),
        )
    )
    return windows


def _today_windows(
    points: list[dict[str, Any]],
    clock_now: dt.datetime,
    latest_by: dt.datetime | None = None,
    wh_hours: list[float] | None = None,
    anchor: float | None = None,
) -> list[dict[str, Any]]:
    """2-h-Blöcke (Berlin) des Heute-Forecasts, billigste zuerst.

    Fenstergrenzen sind echte Prognose-Zeitstempel (ISO), keine erfundenen
    Stunden. Nur Blöcke, die noch nicht vollständig vergangen sind — und mit
    ``latest_by`` nur Blöcke, die vollständig vor dem spätesten akzeptablen
    Tankzeitpunkt enden (Konzept §4.3: Fenster ⊆ [jetzt, T_max]).

    ``wh_hours`` (persönliches Tankzeit-Profil, A9) gewichtet die Reihenfolge;
    ohne Profil zählt allein der Preis.
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
    return _rank_windows(windows, wh_hours=wh_hours, anchor=anchor)[:3]


def _week_windows(
    points_7d: list[dict[str, Any]],
    clock_now: dt.datetime,
    latest_by: dt.datetime | None = None,
    wh_hours: list[float] | None = None,
    anchor: float | None = None,
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
    return _rank_windows(windows, wh_hours=wh_hours, anchor=anchor)[:3]


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

    - ``onroute`` (Default): an estimated station-to-station detour from
      aerial distance × 1.3; anchor-distance differences stay named estimates.
    - ``dedicated``: the road distance from the configured anchor is accepted
      only when metadata says ``dist_mode=road``. Coordinates and aerial
      anchor distances are estimates, never labelled road.

    Rückgabe: ``(km, quelle)`` with ``road``, ``estimated_*`` or
    ``unavailable``. The caller must show this provenance (O14).
    """
    if mode == "dedicated":
        home_coords = home
        cand_coords = _coords(cand)
        if home_coords and cand_coords:
            km = haversine_km(
                home_coords[0], home_coords[1], cand_coords[0], cand_coords[1]
            )
            return round(km * CIRCUITY, 2), "estimated_air_circuity"
        dist = cand.get("dist_km")
        if type(dist) in (int, float) and math.isfinite(dist) and dist >= 0:
            if cand.get("dist_mode") == "road":
                return round(float(dist), 2), "road"
            return round(float(dist) * CIRCUITY, 2), "estimated_anchor_air_circuity"
        return 0.0, "unavailable"

    from_coords, to_coords = _coords(chosen), _coords(cand)
    if from_coords and to_coords:
        km = haversine_km(from_coords[0], from_coords[1], to_coords[0], to_coords[1])
        return round(km * CIRCUITY, 2), "estimated_air_circuity"
    dist_cand = cand.get("dist_km")
    dist_self = chosen.get("dist_km")
    if isinstance(dist_cand, (int, float)) and isinstance(dist_self, (int, float)):
        return round(
            max(0.0, abs(dist_cand - dist_self)), 2
        ), "estimated_anchor_difference"
    return 0.0, "unavailable"


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
    fresh_threshold_minutes: float = FRESH_PRICE_FALLBACK_MINUTES,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """F2-Liste: Netto-€ je Alternative (Konzept §4.2, Umweg-Ökonomie §10).

    ``mode``: ``onroute`` zählt nur den Mehrweg gegenüber der
    Vergleichsstation, ``dedicated`` den vollen Hin+Rückweg ab Zuhause
    (Konzept §10 „Betriebsmodi“).

    Mit ``nowcasts`` (Station → Nowcast-Draws) wird je Zeile zusätzlich
    ``p_lohnt = P(netto > 0)`` aus den Draws ausgewiesen (§4.2 — die
    „kritische Zusatzinformation“). Ohne Draws bleibt ``p_lohnt`` None.
    Frische (< threshold) → Konstante, stale → Draws (M5, beidseitig).
    """

    alternatives = []
    best = None
    ref_nowcast = nowcasts.get(chosen_station["station_id"]) if nowcasts else None

    # M5 beidseitig: frische Live-Preise als Konstante, nur stale Seite trägt Draws.
    is_ref_fresh = _is_price_fresh(chosen_station, fresh_threshold_minutes)
    ref_price_cond = anchor if is_ref_fresh else None

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
        economics = net_economics(
            anchor, cand_price, liters, total_km, consumption, speed, z_used
        )
        fuel_eur = economics["fuel_eur"]
        time_eur = economics["time_eur"]
        detour_cost = economics["detour_cost_eur"]
        gross_eur = economics["gross_eur"]
        net_eur = economics["net_eur"]
        alt_nowcast = nowcasts.get(cand["station_id"]) if nowcasts else None

        is_alt_fresh = _is_price_fresh(cand, fresh_threshold_minutes)
        alt_price_cond = cand_price if is_alt_fresh else None

        # H1/B6: Verdict aus denselben Schwellen wie route.py — server ist einzige Quelle.
        worth_th = th.get("elsewhere_net_eur", 1.5)
        borderline_th = th.get("elsewhere_borderline_eur", 0.5)
        if net_eur >= worth_th:
            verdict = "worth"
        elif net_eur >= borderline_th:
            verdict = "borderline"
        else:
            verdict = "not_worth"

        # p_lohnt beidseitig konditioniert: frisch→Konstante, stale→Draws,
        # beide frisch→deterministisch.
        p_lohnt_val = None
        if (ref_nowcast is not None or ref_price_cond is not None) and (
            alt_nowcast is not None or alt_price_cond is not None
        ):
            p_lohnt_val = p_lohnt(
                ref_nowcast,
                alt_nowcast,
                liters,
                total_km,
                consumption,
                speed,
                z_used,
                ref_price=ref_price_cond,
                alt_price=alt_price_cond,
            )
        elif ref_price_cond is not None and alt_price_cond is not None:
            p_lohnt_val = p_lohnt(
                ref_nowcast,
                alt_nowcast,
                liters,
                total_km,
                consumption,
                speed,
                z_used,
                ref_price=ref_price_cond,
                alt_price=alt_price_cond,
            )

        entry = {
            "station_id": cand["station_id"],
            "name": cand.get("name") or cand["station_id"],
            "brand": cand.get("brand") or "",
            "price": round(cand_price, 3),
            "delta_ct": round((anchor - cand_price) * 100.0, 2),
            "detour_km": round(total_km, 2),
            "detour_km_est": round(total_km, 2),
            "detour_km_source": detour_source,
            "detour_mode": mode,
            "dist_mode": cand.get("dist_mode"),
            "trip_mode": mode,
            "fuel_cost_eur": round(fuel_eur, 2),
            "time_cost_eur": round(time_eur, 2),
            "detour_cost_eur": round(detour_cost, 2),
            "gross_eur": round(gross_eur, 2),
            "net_eur": round(net_eur, 2),
            "critical_delta_ct": round(economics["critical_delta_ct"], 2),
            "economics": {
                "reference_price": round(anchor, 4),
                "liters_assumed": liters,
                "detour_km_total_est": total_km,
                "consumption_l_100km": consumption,
                "speed_kmh": speed,
                "time_value_eur_h": z_used,
            },
            "worth_it": net_eur >= worth_th,
            "verdict": verdict,
            "p_lohnt": p_lohnt_val,
            "maps_url": cand.get("maps_url"),
            "price_fresh": is_alt_fresh,
            "ref_price_fresh": is_ref_fresh,
        }
        alternatives.append(entry)
        if best is None or net_eur > best["net_eur"]:
            best = entry
    alternatives.sort(key=lambda a: a["net_eur"], reverse=True)
    return alternatives[:3], best


# §0.4 verbietet vor der Kalibrierung nicht nur die Empfehlung, sondern auch
# jeden Prozentwert. Die Grauzone nennt ihre Zahl deshalb erst nach der
# Freigabe — der Befund bleibt („unentschieden“), die Zahl kommt später.
GRAY_ZONE_REASON_GATE_SAFE = (
    "Preislage unentschieden — weder Warten noch Sofort-Tanken hat einen "
    "Vorsprung. Die App rät nicht."
)


def _eur(value: float) -> str:
    """Betrag in de-DE (MICROCOPY §3) — 2,09 € statt 2.09 €."""
    return f"{value:.2f}".replace(".", ",")


def _wait_saving_clause(saving_eur: float, saving_median_eur: float | None) -> str:
    """€-Teil des Warten-Grunds — mit benannter Basis (O45).

    Zwei verschiedene Größen tragen denselben Namen „Ersparnis“:
    ``saving_eur`` rechnet gegen den Median der **Fensterminima**
    (``app.pside.expected_saving`` — dieselbe Größe, gegen die das
    Settlement den beobachteten Mindestpreis im Fenster abrechnet),
    ``saving_median_eur`` gegen den Median des Fensterpreises
    (``expected_price``, die Zahl, die die Karte als „erwartet“ zeigt).

    Ohne die Basis im Satz standen beide nebeneinander: „erwartet ~2,221 €/L“
    neben „2,09 € Ersparnis für 55 L“ — die 2,09 € gehören aber zu 2,191 €/L,
    der Medianpreis trägt nur 0,44 €. Der Satz benennt deshalb beide, sobald
    sie auseinanderfallen (ohne Draws sind sie identisch, dann bleibt die
    kurze Fassung).
    """
    if saving_median_eur is None or abs(saving_median_eur - saving_eur) < 0.005:
        return f"bis zu {_eur(saving_eur)} €"
    if saving_median_eur <= 0.0:
        return (
            f"im günstigsten Moment bis zu {_eur(saving_eur)} €, "
            "im Mittel kein Vorsprung gegenüber jetzt"
        )
    return (
        f"im günstigsten Moment bis zu {_eur(saving_eur)} €, "
        f"im Mittel {_eur(saving_median_eur)} €"
    )


def _gate_safe_reason(reason_code: str | None, reason: str) -> str:
    """Der Tabellengrund, wie er **vor** der M7-Freigabe gezeigt werden darf.

    Nur der Grauzonen-Text trägt eine Zahl (``P ≈ 52 %``) und wird ersetzt;
    alle anderen Ablehnungsgründe der Tabelle sind bereits ohne Zahl
    formuliert und werden unverändert durchgereicht.
    """
    if reason_code == "gray_zone":
        return GRAY_ZONE_REASON_GATE_SAFE
    return reason


def _table_action(
    anchor: float | None,
    expected_price_later: float | None,
    expected_saving_eur: float,
    best_alt: dict[str, Any] | None,
    p_besser: float | None = None,
    th: dict[str, float] | None = None,
    no_window_reason: str | None = None,
    quality_gate: str | None = None,
    *,
    saving_median_eur: float | None = None,
) -> tuple[str, str, str, str | None]:
    """€/P-Entscheidungstabelle (Konzept §4.1, §4.2, §4.4, Auswertung §4.5).

    Gibt (action, confidence_badge, reason_short, reason_code) zurück. Die
    Aktion wird immer in den Advice-Ledger geschrieben (Shadow-Betrieb ab
    Tag 1); angezeigt wird sie erst nach dem M7-Gate. Der ``reason_code``
    benennt die **Ablehnung** maschinenlesbar (``quality_gate``,
    ``no_anchor``, ``no_forecast``, ``no_window``, ``gray_zone``) — die GUI
    braucht ihn, um den Grund einer „keine Empfehlung“ auch nach dem
    Grau-Zustand noch benennen zu können (Tagebuch); für Handlungs-
    empfehlungen ist er ``None``.

    Auswertungsreihenfolge (§4.5): Schritt 1 ist das **Güte-Gate** —
    ``quality_gate`` ist gesetzt, wenn der Rolling-PICP der Station rot ist
    (Konzept §3.3.3/§4.4: „Keine klare Empfehlung — tank nach Bedarf“).
    Dann läuft keine F1/F2-Empfehlung, egal wie gut die €-Seite aussieht:
    eine unzuverlässige Intervallqualität rechtfertigt keine Präzision.

    Die Prozent-Gates rechnen mit der **Prognoseverteilung**, nicht mit einer
    Ledger-Trefferquote: ``p_besser`` (§4.1) und, am F2-Zweig,
    ``best_alt[\"p_lohnt\"]`` (§4.2). Ist die Verteilung nicht verfügbar
    (``None``), entfallen die Prozent-Gates — dann entscheidet allein die
    €-Seite, ehrlich statt einer geratenen Zahl.

    Alle Schwellen kommen aus ``th`` (Konzept §4.5: „Alle Schwellen liegen in
    einer Config“; M7 zieht sie an gemessene Trefferquoten nach, §13).

    ``saving_median_eur`` ist die Medianpreis-Ersparnis zum selben Fenster
    (O45): Die €-Gates rechnen mit ``expected_saving_eur`` (Fensterminima,
    passend zu ``p_besser`` und zum Settlement), der Satz nennt aber beide
    Basen, sobald sie auseinanderfallen — sonst liest sich die Empfehlung
    neben dem angezeigten Medianpreis wie ein Widerspruch.
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
            "quality_gate",
        )
    if anchor is None:
        return (
            "no_advice",
            "low",
            "Kein aktueller Preis für diese Station — ohne Anker keine Empfehlung.",
            "no_anchor",
        )
    if expected_price_later is None:
        return (
            "no_advice",
            "low",
            no_window_reason
            or "Keine Prognose verfügbar — Empfehlung erst mit Modelldaten.",
            "no_window" if no_window_reason else "no_forecast",
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
            None,
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
            "gray_zone",
        )
    # F1 (§4.1). Ohne Verteilungs-P kann die grüne Ampel („≥ 70 %“) nicht
    # belegt werden → dann höchstens „gelb“ (ehrlich statt geraten).
    saving_clause = _wait_saving_clause(expected_saving_eur, saving_median_eur)
    if expected_saving_eur >= th["wait_eur_high"] and (
        p_besser is None or p_besser >= th["wait_p_high"]
    ):
        badge = "high" if p_besser is not None else "medium"
        return (
            "wait",
            badge,
            f"Preis fällt im Fenster voraussichtlich — Warten spart {saving_clause}.",
            None,
        )
    if expected_saving_eur >= th["wait_eur_mid"] and (
        p_besser is None or p_besser >= th["wait_p_mid"]
    ):
        return (
            "wait",
            "medium",
            f"Eher warten: Fenster spart voraussichtlich {saving_clause}.",
            None,
        )
    if p_besser is not None and p_besser < th["now_p"]:
        return (
            "refuel_now",
            "low",
            "Warte-Empfehlung zu unsicher (P < 50 %) — jetzt tanken.",
            None,
        )
    if expected_saving_eur < th["now_eur"]:
        return (
            "refuel_now",
            "medium",
            f"Warten brächte < {_eur(th['now_eur'])} € Ersparnis — jetzt tanken.",
            None,
        )
    # Fallback (€-Gates ohne belastbares P): Ersparnis ≥ Schwelle → warten.
    return (
        "wait",
        "medium",
        f"Eher warten: Fenster spart voraussichtlich {saving_clause}.",
        None,
    )


def _forecast_calibration_state(forecast: dict[str, Any]) -> str:
    """B2: Nur eine valide aktive Hülle darf den Ledger als PIT-Lauf markieren."""
    if not forecast:
        return "unknown"
    try:
        from engine.calibration import calibration_active

        if calibration_active(forecast.get("calibration")):
            return "pit_24h"
    except Exception:
        # Ein fehlerhaftes/älteres Artefakt darf keine A/B-Seite beanspruchen.
        pass
    return "raw"


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
        # geratene Stadt gelaufen (vorher still „Frankfurt\", Prüfstand §3.8).
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

    # O2/O3: The receipt profile is weekday-aware and starts carefully with
    # the first usable receipt (eight fills are prior strength, not a cliff).
    with metrics.measure("ledger"):
        store = load_ledger(live_data.settings)
    with metrics.measure("wallet"):
        wallet_stats = compute_wallet_stats(store, now=clock_now)
    wh_weekday = wallet_stats.get("wh_weekday") or None
    wh_personalized = bool(wallet_stats.get("wh_personalized"))
    wh_n = int(wallet_stats.get("wh_n") or 0)
    wh_min_fills = int(wallet_stats.get("wh_min_fills") or WH_MIN_FILLS)
    # O1: Herkunft der Tankuhrzeiten. ``default``-Belege (ohne Zeitstempel)
    # zählen die erfundene 12-Uhr-Projektion der Engine ins Profil — die
    # Antwort sagt das, statt es als Messung auszugeben.
    wh_measured_n = int(wallet_stats.get("wh_measured_n") or 0)
    wh_default_n = int(wallet_stats.get("wh_default_n") or 0)
    wh_profile = wh_weekday if wh_personalized else None

    # Beste Fenster heute und über die Woche (echte 2-h-Blöcke).
    # latest_by schneidet den Horizont ab (Konzept §4.3: Fenster ⊆ [jetzt, T_max]).
    windows_today = _today_windows(
        points, clock_now, latest_by, wh_hours=wh_profile, anchor=anchor
    )
    windows_week = _week_windows(
        points_7d, clock_now, latest_by, wh_hours=wh_profile, anchor=anchor
    )
    # „Es gäbe Prognosen, aber keins mehr vor deinem spätesten Zeitpunkt“ —
    # das ist eine andere Aussage als „keine Prognose vorhanden“.
    horizon_cut = bool(latest_by is not None and not windows_today and bool(points))

    if windows_today:
        rec_start = windows_today[0]["start"]
        expected_price_later = windows_today[0]["expected_price"]
        start_hour_later = windows_today[0]["start_hour"]
        end_hour_later = windows_today[0]["end_hour"]
        rec_block_idx = _block_for_window(draws_24h, rec_start)
        min_draws = draws_24h.get("minima") if draws_24h else None
        expected_min_price_later = expected_window_min_price(min_draws, rec_block_idx)
        saving_from_draws = (
            expected_saving(min_draws, rec_block_idx, anchor, liters)
            if min_draws and rec_block_idx is not None and anchor is not None
            else None
        )
        recommended_window = {
            "start": rec_start,
            "end": windows_today[0]["end"],
            "expected_price": expected_price_later,
            "expected_min_price": expected_min_price_later,
        }
    else:
        # Kein erfundenes Fenster: ohne Prognose keine Empfehlung.
        recommended_window = None
        expected_price_later = None
        expected_min_price_later = None
        start_hour_later = None
        end_hour_later = None
        saving_from_draws = None

    if anchor is not None and expected_price_later is not None:
        expected_saving_median_eur = round(
            max(0.0, (anchor - expected_price_later) * liters), 2
        )
    else:
        expected_saving_median_eur = 0.0

    if saving_from_draws is not None:
        expected_saving_eur = saving_from_draws
    else:
        expected_saving_eur = expected_saving_median_eur

    # M7-Schwellen (§13): Startwerte, optional an gemessene Trefferquoten
    # nachgezogen (nur wenn der Betreiber auto-apply gesetzt hat).
    auto_apply = bool(getattr(live_data.settings, "m7_auto_apply", False))

    # Ledger lesen: Tabellen-Qualität + interne P-Schätzung je Aktion
    # (der Store und die Wallet-Kennzahlen stehen schon oben, A9).
    with metrics.measure("advice"):
        advice_stats = compute_advice_stats(store, now=clock_now)
    is_calibrated = advice_stats.get("calibrated", False)

    thresholds, tuning = active_thresholds(advice_stats, auto_apply=auto_apply)

    # Alternativen (F2 Umweg-Ökonomie) — nur mit Ankerpreis rechenbar.
    fresh_threshold = _fresh_threshold_minutes(live_data.settings)
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
            fresh_threshold_minutes=fresh_threshold,
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
    table_action, badge, reason, reason_code = _table_action(
        anchor,
        expected_price_later,
        expected_saving_eur,
        best_alt,
        p_better_own,
        thresholds,
        no_window_reason,
        quality_gate,
        saving_median_eur=expected_saving_median_eur,
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

    # A21-B1.4: Freigabekette (Issue 201) — ein bestandenes, historisches
    # M7-Gate ersetzt keine aktuelle Evidenz. Die zentrale Verwendbarkeits-
    # prüfung geht **jeder** Handlungsausgabe voran; erst wenn die Kette frei
    # und M7 bestanden ist, erscheint die Tabelle (oder der A2-Physik-Kipp)
    # als Handlung. Der Ledger misst die Tabelle weiter im Shadow-Betrieb
    # (``action_base``), auch wenn die Anzeige gesperrt ist.
    chain_reasons = _action_blocking_reasons(
        chosen_station,
        forecast_data,
        fresh_threshold_minutes=fresh_threshold,
        now=clock_now,
    )
    blocking_reasons = list(chain_reasons)
    if not is_calibrated:
        blocking_reasons.append("m7_pending")
    if blocking_reasons:
        action = "no_advice"
        p_correct = None
        confidence_badge = "low"
        # Drei Fälle — vorher waren es zwei (§4.5, Konzept §4.4):
        #   * Die **Evidenzkette** überstimmt eine Tabellen-Aktion (oder den
        #     A2-Physik-Kipp): ihr erster Sperrgrund führt den Text — auch
        #     wenn die Tabelle aus dem last_price-Fallback heraus „warten“
        #     gerechnet hätte (kein Median-Potenzial als Handlung).
        #   * Die **Tabelle** hat abgelehnt: Ihr Grund ist die stabile
        #     Aussage über die Datenlage (an ihrem Text hängen Kollapsregel
        #     und Schreibverzicht des Ledgers, B7) — er bleibt sichtbar,
        #     sonst sagt die App nur noch „Kalibrierung steht aus“ und
        #     verschweigt, warum sie nichts vorschlägt. Die weiteren
        #     Sperrgründe stehen maschinenlesbar in ``blocking_reasons``.
        #   * Nur M7 fehlt und die Tabelle hätte empfohlen: der
        #     Kalibrierungs-Hinweis. Eine Empfehlung ohne Freigabe als
        #     „Grund“ zu zeigen, wäre die Empfehlung selbst.
        if chain_reasons and action_base != "no_advice":
            reason_short = _BLOCK_REASON_TEXT[chain_reasons[0]]
        elif action_base == "no_advice":
            reason_short = _gate_safe_reason(reason_code, reason)
        else:
            reason_short = _BLOCK_REASON_TEXT["m7_pending"]
    else:
        action = action_base
        p_correct = p_decision
        confidence_badge = badge
        reason_short = reason
    # Bereitschaft ↔ Handlung: genau die freigegebene Aktion ist „ready“ —
    # nie ein Widerspruch zwischen beiden Feldern (API-/UI-/Failover-Vertrag).
    decision_ready = action != "no_advice"
    valid_until = (
        _action_valid_until(
            chosen_station,
            forecast_data,
            fresh_threshold_minutes=fresh_threshold,
            now=clock_now,
        )
        if decision_ready
        else None
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
        # A settlement needs the original benchmark and route assumption;
        # keeping the displayed alternative alone made net saving unknowable.
        "elsewhere_economics": best_alt.get("economics")
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
        "expected_min_price": round(expected_min_price_later, 3)
        if expected_min_price_later is not None
        else None,
        "expected_saving_eur": expected_saving_eur,
        "expected_saving_median_eur": expected_saving_median_eur,
        # Der Grund einer Ablehnung wandert mit ins Ledger: Das Tagebuch
        # zeigt damit je Zeile, **warum** nichts empfohlen wurde, statt nur
        # „keine Empfehlung“ zu wiederholen. Für Empfehlungen ist das Feld
        # leer (dort zählt das Settlement).
        "decline_reason": reason_short if action_base == "no_advice" else None,
        "p_besser": p_decision,
        # B2 A/B: Der Advice-Snapshot hält die beim Emit wirklich veröffentlichte
        # 24-h-Verteilung fest. Ohne Forecast bleibt die Messgruppe unbekannt,
        # statt einen alten Ledger-Eintrag nachträglich „roh\" zu nennen.
        "forecast_calibration_state": _forecast_calibration_state(forecast_data),
        "liters_assumed": liters,
        "fuel": fuel,
        "trip_mode": mode,
        "latest_by": latest_by.isoformat() if latest_by is not None else None,
        # A2: Tankstand-Zustand zum Entscheidungszeitpunkt — nur
        # Informationsträger (Auswertung „Deadline-Druck × Reserve“),
        # die Kollabierung hängt weiter nur an Aktion/Station/Fenster.
        "tank_state": tank.get("state") if tank else None,
    }

    # A21-B2.1: Snapshot-Log/Sperre als eigener Span — er wartet auf die
    # Store-Sperre und darf nicht als Rechenzeit der Entscheidung gelesen
    # werden.
    with metrics.measure("snapshot"):
        _, ep = record_snapshot(
            live_data.settings, snapshot_input, clock=live_data.clock
        )

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
            "expected_saving_median_eur": expected_saving_median_eur,
            "p_correct": p_correct,
            "confidence_badge": confidence_badge,
            "reason_short": reason_short,
        },
        "alternatives_nearby": alternatives_nearby,
        "windows_today": [
            _format_window_item(w, draws_24h, anchor, liters) for w in windows_today
        ],
        "windows_week": [
            _format_window_item(w, draws_7d, anchor, liters) for w in windows_week
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
        # A9: Wirkt das persönliche Tankzeit-Profil w(h) auf die
        # Fensterreihenfolge? Erst ab ``min_fills`` Füllungen — die GUI sagt
        # daraus, wie viele Belege noch fehlen (Konzept §5.5 Schicht C).
        "personalization": {
            "active": wh_personalized,
            "n_fills": wh_n,
            "min_fills": wh_min_fills,
            "missing_fills": max(0, wh_min_fills - wh_n),
            # O1: Belege mit gemessener/rekonstruierter Tankzeit und Belege,
            # deren Stunde mangels Zeitstempel die erfundene 12 ist.
            "measured_fills": wh_measured_n,
            "default_fills": wh_default_n,
        },
        "calibrated": is_calibrated,
        # A21-B1.4: Bereitschaft = freigegebene Handlung; die maschinenlesbaren
        # Sperrgründe und die Gültigkeitsgrenze der Freigabe stehen daneben
        # (API-/UI-Vertrag, Issue 201).
        "decision_ready": decision_ready,
        "blocking_reasons": blocking_reasons,
        "valid_until": valid_until,
        # Engine-Qualität der ausgewählten Station (Konzept §3.3.3):
        # Rolling-PICP 7 d aus dem 21-Tage-Backtest. „gate“ ist gesetzt,
        # wenn das Güte-Gate (§4.4/§4.5 Schritt 1) die Empfehlung blockiert.
        "quality": {
            "rolling_picp_7d_pct": rolling.get("picp_pct"),
            "rolling_picp_7d_points": rolling.get("points"),
            # O4: Fallzahl der Kennzahl in Tagen (Tage mit bewerteten
            # Punkten); unter 3 Tagen ist das Badge keine Aussage.
            "rolling_picp_7d_days": rolling.get("n_days"),
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
            "time_value_rule": AUTO_TIME_VALUE_RULE
            if z_auto
            else "Manuell gesetzter Zeitwert.",
            "trip_mode": mode,
            "home_used": home is not None,
            # Konzept §4.1/§4.3: Horizont [jetzt, latest_by].
            "latest_by": latest_by.isoformat() if latest_by is not None else None,
            "horizon_cut": horizon_cut,
            "fresh_threshold_minutes": fresh_threshold,
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
