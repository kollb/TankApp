"""Bundeslandspezifische Feiertage für den gepoolten Feiertags-Dummy (Konzept §3.2).

Der `holidays`-Paket-Import bleibt optional: fehlt das Paket (oder das
Bundesland), liefert die Funktion eine Null-Maske mit einer ehrlichen
``source``-Kennung — der Dummy trägt dann null, es wird kein Effekt
erfunden. Die Selektion (``analysis/station_selection.py``) nutzt dieselbe
Konvention.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

try:
    import holidays as _holidays
except ImportError:  # pragma: no cover - Abhängigkeit ist optional
    _holidays = None

_CACHE: dict[tuple[str, int, int], frozenset[pd.Timestamp]] = {}


def _holiday_days(subdiv: str, first: int, last: int) -> frozenset[pd.Timestamp] | None:
    """Feiertags-Daten (ohne Uhrzeit) für ein Bundesland; ``None`` = unbekannt."""
    key = (subdiv.upper(), int(first), int(last))
    if key in _CACHE:
        return _CACHE[key]
    if _holidays is None:
        return None
    try:
        calendar = _holidays.Germany(
            subdiv=subdiv.upper(), years=range(first, last + 1)
        )
    except (NotImplementedError, KeyError, TypeError, ValueError):
        return None
    days = frozenset(pd.Timestamp(date).normalize() for date in calendar.keys())
    _CACHE[key] = days
    return days


def holiday_flags(
    index: pd.DatetimeIndex,
    subdiv: str | None,
    timezone: str = "Europe/Berlin",
) -> tuple[np.ndarray, str]:
    """0/1-Maske je Rasterpunkt: 1, wenn der lokale Kalendertag ein Feiertag ist.

    ``subdiv`` ist das ISO-3166-2:DE-Kürzel des Bundeslands (z. B. ``"HE"``);
    ``timezone`` die Anzeigezeitzone der Station (Default Europe/Berlin).
    Rückgabe ``(flags, source)``:

    - ``("holidays:HE", ...)`` — reale Feiertage aus dem Paket;
    - ``("none", ...)`` — kein Dummy beitragsfähig (kein Subdiv, Paket fehlt
      oder unbekanntes Bundesland). Die Null-Maske ist dann bewusst Teil
      des Features, damit das Artefakt-Schema überall identisch bleibt.
    """
    zeros = np.zeros(len(index), dtype=float)
    if not subdiv:
        return zeros, "none"
    subdiv = subdiv.strip().upper()
    if _holidays is None:
        return zeros, "none"
    local = index.tz_convert(timezone).tz_localize(None)
    years = (int(local.year.min()), int(local.year.max()))
    days = _holiday_days(subdiv, *years)
    if days is None:
        return zeros, "none"
    # B16(b): Feiertagszugehörigkeit über sortierte int64-Tageswerte und
    # ``searchsorted`` statt Timestamp-Iteration je Rasterpunkt — dieselbe
    # 0/1-Maske, bitgleich.
    if days:
        day_values = np.sort(
            np.asarray([day.to_datetime64() for day in days], dtype="datetime64[ns]")
        ).astype("int64")
        local_values = local.normalize().as_unit("ns").asi8
        found = np.searchsorted(day_values, local_values)
        found = np.minimum(found, len(day_values) - 1)
        flags = np.asarray(day_values[found] == local_values, dtype=float)
    else:
        flags = zeros.copy()
    return flags, f"holidays:{subdiv}"


# P4: Feiertage und Brückentage für die Wochenansicht (Hessen / DE).
# Brückentag = Freitag nach einem Donnerstag-Feiertag bzw. Montag vor einem
# Dienstag-Feiertag. Die Regel ist eine Faustregel für Hinweise, kein Gesetz.
BRIDGE_HINT_DAYS = 7


def _holiday_names(
    subdiv: str, first: int, last: int
) -> dict[pd.Timestamp, str] | None:
    """Feiertage mit Bezeichnung (ohne Uhrzeit); ``None`` = nicht verfügbar."""
    if _holidays is None:
        return None
    try:
        calendar = _holidays.Germany(
            subdiv=subdiv.upper(), years=range(first, last + 1)
        )
    except (NotImplementedError, KeyError, TypeError, ValueError):
        return None
    return {
        pd.Timestamp(date).normalize(): str(name) for date, name in calendar.items()
    }


def calendar_hints(
    today: pd.Timestamp,
    subdiv: str | None = "HE",
    timezone: str = "Europe/Berlin",
    days: int = BRIDGE_HINT_DAYS,
) -> dict:
    """Feiertage und Brückentage in den nächsten ``days`` Kalendertagen.

    ``today`` ist der lokale Startzeitpunkt. Ohne Paket oder Bundesland liefert
    die Funktion eine leere Liste mit ``source="none"`` — kein erfundener Tag.
    Rückgabe: ``{"source", "subdiv", "items": [{"date", "kind", "name"}]}``,
    ``kind`` ist ``holiday`` oder ``bridge``.
    """
    empty = {"source": "none", "subdiv": None, "items": []}
    if not subdiv or _holidays is None:
        return empty
    subdiv = subdiv.strip().upper()
    local = pd.Timestamp(today)
    if local.tzinfo is not None:
        local = local.tz_convert(timezone).tz_localize(None)
    start = local.normalize()
    names = _holiday_names(subdiv, start.year - 1, start.year + 1)
    if names is None:
        return empty
    items: list[dict[str, Any]] = []
    for offset in range(days):
        day = start + pd.Timedelta(days=offset)
        if day in names:
            items.append(
                {
                    "date": day.strftime("%Y-%m-%d"),
                    "kind": "holiday",
                    "name": names[day],
                }
            )
            continue
        before = day - pd.Timedelta(days=1)
        after = day + pd.Timedelta(days=1)
        if day.dayofweek == 4 and before in names and before.dayofweek == 3:
            items.append(
                {
                    "date": day.strftime("%Y-%m-%d"),
                    "kind": "bridge",
                    "name": names[before],
                }
            )
        elif day.dayofweek == 0 and after in names and after.dayofweek == 1:
            items.append(
                {
                    "date": day.strftime("%Y-%m-%d"),
                    "kind": "bridge",
                    "name": names[after],
                }
            )
    return {"source": f"holidays:{subdiv}", "subdiv": subdiv, "items": items}
