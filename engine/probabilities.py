"""P-Seite des Decision Layers: Bootstrap-Draws → Fenster-Verteilung (Konzept §4).

Der Modell-Worker reduziert die vollen Bootstrap-Pfade hier auf die kompakten
Größen, die der Decision Layer zur Laufzeit braucht:

- Fenster-Minima je Draw (Grundlage von ``P_besser`` und der F3-Fenster-P),
- Nowcast-Draws (``paths[:, 0]`` — Verteilung des aktuellen Preisniveaus,
  Grundlage von ``P_lohnt``).

Die eigentlichen Wahrscheinlichkeiten (relative Häufigkeiten über dieselben
Draws) rechnet ``app/pside.py`` ohne Numerik-Abhängigkeit aus — der
Live-API-Pfad bleibt frei von numpy/pandas.

Alle Größen sind relative Häufigkeiten über dieselben B Draws; NaN bedeutet
„Punkt/Block nicht gestützt“ (keine definierte Wahrscheinlichkeit). Die
gemeinsame Ziehung über Stationen (§4.2) ist noch nicht umgesetzt —
``P_lohnt`` rechnet mit unabhängigen Nowcast-Draws (dokumentierte Abweichung
in LUECKEN.md).
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

# Konzept §4: B = 500 Draws für die relativen Häufigkeiten des Decision Layers.
DECISION_DRAWS = 500
# 2-h-Fenster (entspricht app/decide.py::_today_windows).
BLOCK_MINUTES = 120


def block_ids(
    index: pd.DatetimeIndex, timezone: str, minutes: int = BLOCK_MINUTES
) -> np.ndarray:
    """Chronologischer Block-Index je Zeitpunkt (lokale Zeit, 2-h-Raster).

    ``np.unique`` sortiert die Grenzen, ``return_inverse`` liefert für jeden
    Zeitpunkt den Index in diese sortierte Folge — Block 0 ist also der
    früheste. Identisch für Teilraster, solange sie dieselben
    Block-Grenzen berühren (wie bei ``predict`` dokumentiert).
    """
    local = index.tz_convert(timezone)
    keys = local.normalize() if minutes >= 1440 else local.floor(f"{minutes}min")
    _, ids = np.unique(keys, return_inverse=True)
    return ids


def block_starts(
    index: pd.DatetimeIndex, timezone: str, minutes: int = BLOCK_MINUTES
) -> pd.DatetimeIndex:
    """Eindeutige Block-Anfänge in chronologischer Reihenfolge (UTC)."""
    if len(index) == 0:
        return pd.DatetimeIndex([], tz="UTC")
    local = index.tz_convert(timezone)
    keys = local.normalize() if minutes >= 1440 else local.floor(f"{minutes}min")
    stamps = pd.DatetimeIndex(np.unique(keys)).tz_convert("UTC")
    return stamps


def block_minima(paths: np.ndarray, ids: np.ndarray) -> np.ndarray:
    """``(B, n_blocks)`` Minimum je Draw und Block; NaN für leere Blöcke.

    NaN an ungestützten Punkten (``predict(..., return_paths=True)``) bleibt
    NaN: ``np.nanmin`` ignoriert sie, ein Block ohne einen einzigen
    gestützten Punkt wird ganz NaN — „P=0“ und „keine Aussage“ bleiben
    unterscheidbar.
    """
    if len(ids) == 0 or paths.shape[0] == 0:
        return np.full((paths.shape[0], 0), np.nan)
    n_blocks = int(ids.max()) + 1
    out = np.full((paths.shape[0], n_blocks), np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # All-NaN → NaN
        for block in range(n_blocks):
            mask = ids == block
            if mask.any():
                out[:, block] = np.nanmin(paths[:, mask], axis=1)
    return out


def nowcast_draws(paths: np.ndarray) -> np.ndarray:
    """``paths[:, 0]`` — Verteilung des aktuellen Preisniveaus (Nowcast, §4.2)."""
    if paths.shape[1] == 0:
        return np.full(paths.shape[0], np.nan)
    return paths[:, 0]
