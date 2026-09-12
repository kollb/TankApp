"""Bundeslandspezifische Feiertage für den gepoolten Feiertags-Dummy (Konzept §3.2).

Der `holidays`-Paket-Import bleibt optional: fehlt das Paket (oder das
Bundesland), liefert die Funktion eine Null-Maske mit einer ehrlichen
``source``-Kennung — der Dummy trägt dann null, es wird kein Effekt
erfunden. Die Selektion (``analysis/station_selection.py``) nutzt dieselbe
Konvention.
"""

from __future__ import annotations

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
