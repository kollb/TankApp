"""Datenqualität der Veröffentlichung messen (M3/M5).

M3 fordert eine explizite Kennzahl: **Anteil der Vorhersagen, die auf
interpolierten, fortgeschriebenen oder lückenhaften Daten basieren**.
Die Veröffentlichung trägt dafür je Station:

* ``support_days``/``supported`` je Prognosepunkt (dünne Stütze),
* ``stale_data_at_origin`` (veraltete Eingangsdaten am Cutoff),
* ``data_age_minutes_at_origin`` (Alter der letzten Beobachtung),
* ``n_days``/``n_points`` (Trainingsbasis des Fits).

Dieses Modul fasst sie zu einer Health-Kennzahl zusammen — ohne
Influx, ohne Parse über das Leselimit hinaus (liest nur das bereits
geparste Bundle). Klassen (M3: Güte getrennt nach Datenqualität):

* ``voll`` — frische Herkunft, volle Stütze.
* ``lueckig`` — veraltete Herkunft oder Punkte ohne Stütze.
* ``duenn`` — schmale Trainingsbasis (``n_days`` unter der Schwelle).

Nur Standardbibliothek.
"""

from __future__ import annotations

from typing import Any

# Unter so vielen Trainingstagen gilt eine Prognose als „dünn“ —
# dieselbe Größenordnung wie die harte Fit-Untergrenze (28 d,
# ``engine/models.py::fit``), mit Puffer für einen Ausfalltag.
THIN_TRAIN_DAYS = 35


def classify_forecast(row: Any) -> str:
    """Datenqualitätsklasse einer Veröffentlichungszeile."""
    if not isinstance(row, dict):
        return "lueckig"
    try:
        n_days = row.get("n_days")
        n_days_f = float(n_days) if n_days is not None else None
    except (TypeError, ValueError):
        n_days_f = None
    if n_days_f is not None and n_days_f < THIN_TRAIN_DAYS:
        return "duenn"
    if row.get("stale_data_at_origin") is True:
        return "lueckig"
    points = row.get("points") or []
    if isinstance(points, list) and points:
        for point in points:
            if isinstance(point, dict) and point.get("supported") is False:
                return "lueckig"
    return "voll"


def exposure(forecasts: Any) -> dict[str, Any]:
    """Exposition der Veröffentlichung (Anteile je Klasse).

    ``l ueckig_oder_duenn_share`` ist die M3-Kennzahl: Anteil der
    Stationen, deren Prognose auf lückenhaften oder dünnen Daten
    beruht. ``stations_*`` nennen Fallzahlen, damit ein Anteil aus
    zwei Stationen nicht wie eine Quote aus zwanzig aussieht.
    """
    rows = forecasts if isinstance(forecasts, list) else []
    counts = {"voll": 0, "lueckig": 0, "duenn": 0}
    stale_origins = 0
    unsupported_points = 0
    unsupported_stations = 0
    for row in rows:
        counts[classify_forecast(row)] += 1
        if isinstance(row, dict) and row.get("stale_data_at_origin") is True:
            stale_origins += 1
        points = row.get("points") if isinstance(row, dict) else None
        if isinstance(points, list) and points:
            bad = sum(
                1
                for point in points
                if isinstance(point, dict) and point.get("supported") is False
            )
            if bad:
                unsupported_stations += 1
                unsupported_points += bad
    total = len(rows)
    weak = counts["lueckig"] + counts["duenn"]
    return {
        "stations_total": total,
        "stations_voll": counts["voll"],
        "stations_lueckig": counts["lueckig"],
        "stations_duenn": counts["duenn"],
        "weak_share": (round(weak / total, 4) if total else None),
        "stale_origin_stations": stale_origins,
        "unsupported_point_stations": unsupported_stations,
        "unsupported_points": unsupported_points,
        "thin_train_days": THIN_TRAIN_DAYS,
    }
