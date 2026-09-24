"""Regimeüberwachung operationalisieren (Priorität 6.4).

Die 12-Uhr-Regel erlaubt Preiserhöhungen nur um 12:00 Uhr; der Fit
zählt beobachtete Anstiege ≥ 1 ct außerhalb dieses Fensters als
``law_rise_outside_noon`` (``engine/models.py::fit``). Einzelne
Verletzungen sind Datenrauschen — **gehäufte** Verletzungen deuten auf
einen Regime-Bruch (Steuer, Deckel, geänderte Regel) oder einen
systematischen Datenfehler hin und dürfen nicht still in Empfehlungen
einfließen.

Stufen (eine Quelle für Health-Alarm und Freigabekette):

* ``ok`` — keine auffällige Häufung.
* ``warn`` — Warnung in ``/api/v1/health`` (Datenqualitätswarnung),
  Empfehlungen bleiben möglich, Regimezustand ist zu prüfen.
* ``blocked`` — die Freigabekette sperrt mit ``regime_check_pending``,
  bis der Regimezustand bestätigt ist.

Schwellen sind konservativ gewählt und als Konstanten prüfbar; sie
lösen keine automatische Regime-Umschreibung aus (A14 bleibt
menschliche Abnahme).

Nur Standardbibliothek.
"""

from __future__ import annotations

from typing import Any

# Warnung ab so vielen betroffenen Stationen in einer Veröffentlichung
# (je Station ≥ 1 Verletzung) — ein einzelner Ausreißer warnt nicht.
WARN_STATIONS = 2
# Sperre ab so vielen betroffenen Stationen — dann ist es kein
# Einzelfall mehr, sondern Markt oder Pipeline.
BLOCK_STATIONS = 5
# Sperre ab so vielen Verletzungen an einer einzelnen Station — dann
# trägt deren Prognose keine Empfehlung, auch wenn der Rest ruhig ist.
BLOCK_SINGLE_STATION_RISES = 10


def station_rises(forecast: Any) -> int:
    """Verletzungen einer Veröffentlichungszeile (robust gegen Müll)."""
    if not isinstance(forecast, dict):
        return 0
    try:
        value = int(forecast.get("law_rise_outside_noon") or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, value)


def evaluate_publication(forecasts: Any) -> dict[str, Any]:
    """Globale Einordnung einer Veröffentlichung (Health/Alarm).

    Rückgabe: ``status`` (``ok``/``warn``/``blocked``), Zähler und die
    betroffenen Stations-IDs (IDs, keine Namen — Health ist unpersönlich).
    """
    rows = forecasts if isinstance(forecasts, list) else []
    affected: list[str] = []
    total = 0
    worst = 0
    for row in rows:
        rises = station_rises(row)
        total += rises
        worst = max(worst, rises)
        if rises > 0 and isinstance(row, dict) and row.get("station_id"):
            affected.append(str(row["station_id"]))
    affected_sorted = sorted(set(affected))
    if len(affected_sorted) >= BLOCK_STATIONS or worst >= BLOCK_SINGLE_STATION_RISES:
        status = "blocked"
    elif len(affected_sorted) >= WARN_STATIONS:
        status = "warn"
    else:
        status = "ok"
    return {
        "status": status,
        "stations_affected": len(affected_sorted),
        "stations_total": len(rows),
        "rises_total": total,
        "rises_worst_station": worst,
        "affected_station_ids": affected_sorted,
        "thresholds": {
            "warn_stations": WARN_STATIONS,
            "block_stations": BLOCK_STATIONS,
            "block_single_station_rises": BLOCK_SINGLE_STATION_RISES,
        },
    }


def station_blocked(forecast: Any) -> bool:
    """Trägt diese Station eine Empfehlung (Freigabekette)?

    Nur die Einzelstations-Schwelle sperrt hier — die globale Häufung
    (``BLOCK_STATIONS``) wertet der Betrieb über Health/Alarm aus und
    bestätigt den Regimezustand (A14), statt jede Station einzeln zu
    sperren.
    """
    return station_rises(forecast) >= BLOCK_SINGLE_STATION_RISES
