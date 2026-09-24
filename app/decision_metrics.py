"""Verfügbarkeit der Entscheidung messen (M5).

Die Freigabekette (A21-B1.4) ist streng und sinnvoll — aber ohne Messung
ist unklar, ob sie ein wirksamer Sicherheitsmechanismus oder praktisch
ein Dauer-Blocker ist. Dieses Modul zählt deshalb jede
Decide-Antwort in einem rollierenden Fenster (wie ``app/metrics.py``):

* Anteil ``decision_ready = true`` (tatsächliche Verfügbarkeit),
* Sperrgründe nach Häufigkeit (Engpassanalyse),
* Anteil je Kraftstoff und Uhrzeit (systematische Schwächen),
* Anteil M7- vs. Technik-Sperren (Produktreife vs. Betriebsstörung).

Keine Persistenz, keine Infrastruktur: ein ``deque``-Fenster und eine
Zusammenfassung für ``/api/v1/health``. Sperrdauern je Grund ergeben
sich aus der Zeitreihe aufeinanderfolgender Fenster (Betrieb wertet
``generated_at``-Stempel aus); das Modul hält dafür die letzte
Änderung je Grund vor.

Nur Standardbibliothek.
"""

from __future__ import annotations

import datetime as dt
import threading
from collections import Counter, deque
from typing import Any

# Fenster über die letzten Decide-Antworten. Bei GUI-Polls (30–60 s)
# sind 500 Antworten mehrere Stunden Betrieb — lang genug für stabile
# Anteile, kurz genug, um eine behobene Störung nicht mitzuschleppen.
WINDOW = 500

# Technik-Sperren (Betriebsstörung) vs. M7-Sperre (Produktreife, A5).
# ``model_not_released`` und ``regime_check_pending`` sind bewusste
# Freigabe-Sperren und zählen zur Produktreife, nicht zum Betrieb.
M7_CODES = frozenset({"m7_pending", "model_not_released"})
TECHNICAL_CODES = frozenset(
    {
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
        "regime_check_pending",
        "tank_full",
        "what_if_only",
    }
)

_SAMPLES: deque[dict[str, Any]] = deque(maxlen=WINDOW)
_LOCK = threading.Lock()
# Letzter Wechsel je Sperrgrund (ISO-Stempel) — Grundlage für
# Sperrdauern im Betrieb (M5-Tabelle, Spalte „Sperrdauer je Grund“).
_LAST_CHANGE: dict[str, str] = {}
_LAST_SEEN: set[str] = set()


def reset() -> None:
    """Fenster und Wechselstempel leeren — für Tests und Mess-Neustart."""
    with _LOCK:
        _SAMPLES.clear()
        _LAST_CHANGE.clear()
        _LAST_SEEN.clear()


def observe_decision(
    *,
    decision_ready: bool,
    blocking_reasons: list[str] | tuple[str, ...] | None = None,
    station_id: str | None = None,
    fuel: str | None = None,
    at: dt.datetime | None = None,
) -> None:
    """Eine Decide-Antwort vermerken (bereit, Gründe, Kontext).

    ``station_id`` wird nur als Zähler je Station geführt (kein Name,
    keine Koordinaten); ``fuel`` normiert auf klein. Unbekannte Codes
    werden mitgezählt, aber nie in die M7/Technik-Trennung gezwungen.
    """
    reasons = [str(code) for code in (blocking_reasons or []) if str(code)]
    stamp = at or dt.datetime.now(dt.timezone.utc)
    try:
        hour = stamp.astimezone(dt.timezone.utc).hour
    except Exception:
        hour = None
    entry = {
        "at": stamp.isoformat(),
        "ready": bool(decision_ready),
        "reasons": reasons,
        "station_id": str(station_id) if station_id else None,
        "fuel": str(fuel or "").strip().lower() or None,
        "hour": hour,
    }
    with _LOCK:
        _SAMPLES.append(entry)
        current = set(reasons)
        changed = (current - _LAST_SEEN) | (_LAST_SEEN - current)
        for code in changed:
            _LAST_CHANGE[code] = entry["at"]
        _LAST_SEEN.clear()
        _LAST_SEEN.update(current)


def _share(part: int, total: int) -> float | None:
    if total <= 0:
        return None
    return round(part / total, 4)


def summary() -> dict[str, Any]:
    """Verfügbarkeits-Blick für ``/api/v1/health`` — JSON, ohne I/O.

    ``count`` steht immer dabei: Ein Anteil aus drei Antworten ist keine
    Aussage, und ohne Fallzahl wäre er eine (O37-Regel).
    """
    with _LOCK:
        samples = list(_SAMPLES)
        last_change = dict(_LAST_CHANGE)
    total = len(samples)
    ready = sum(1 for entry in samples if entry["ready"])
    reason_counts: Counter[str] = Counter()
    for entry in samples:
        for code in entry["reasons"]:
            reason_counts[code] += 1
    m7_blocked = sum(
        1 for entry in samples if any(code in M7_CODES for code in entry["reasons"])
    )
    tech_blocked = sum(
        1
        for entry in samples
        if any(code in TECHNICAL_CODES for code in entry["reasons"])
    )
    by_fuel: Counter[str] = Counter()
    ready_by_fuel: Counter[str] = Counter()
    for entry in samples:
        fuel = entry["fuel"] or "unknown"
        by_fuel[fuel] += 1
        if entry["ready"]:
            ready_by_fuel[fuel] += 1
    by_hour: Counter[int] = Counter()
    for entry in samples:
        if entry["hour"] is not None:
            by_hour[int(entry["hour"])] += 1
    by_station: Counter[str] = Counter()
    for entry in samples:
        if entry["station_id"]:
            by_station[str(entry["station_id"])] += 1
    return {
        "window": WINDOW,
        "count": total,
        "ready_count": ready,
        "ready_share": _share(ready, total),
        "by_reason": [
            {
                "code": code,
                "count": count,
                "share": _share(count, total),
                "last_change": last_change.get(code),
            }
            for code, count in reason_counts.most_common()
        ],
        "m7_blocked_count": m7_blocked,
        "m7_blocked_share": _share(m7_blocked, total),
        "technical_blocked_count": tech_blocked,
        "technical_blocked_share": _share(tech_blocked, total),
        "by_fuel": [
            {
                "fuel": fuel,
                "count": count,
                "ready_count": ready_by_fuel.get(fuel, 0),
                "ready_share": _share(ready_by_fuel.get(fuel, 0), count),
            }
            for fuel, count in sorted(by_fuel.items())
        ],
        "by_hour": [
            {"hour": hour, "count": count} for hour, count in sorted(by_hour.items())
        ],
        "stations_observed": len(by_station),
    }
