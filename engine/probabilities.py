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
gemeinsame Ziehung über Stationen (§4.2, A11) ist umgesetzt: Die Tages-Blöcke
werden stationsübergreifend gemeinsam gezogen
(``shared_day_uniforms``/``blocks_from_uniform``), und die Veröffentlichung
weist je Draw-Block ``shared`` aus (``app/model_jobs.py::_draws``) —
``TANKAPP_SHARED_DRAWS=0`` stellt die alte, unabhängige Ziehung für
Gegenmessungen wieder her.
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from .timeblocks import block_key_utc

# Konzept §4: B = 500 Draws für die relativen Häufigkeiten des Decision Layers.
DECISION_DRAWS = 500
# 2-h-Fenster (entspricht app/decide.py::_today_windows).
BLOCK_MINUTES = 120


def _block_keys(
    index: pd.DatetimeIndex, timezone_name: str, minutes: int
) -> pd.DatetimeIndex:
    """Canonical UTC block key for every sample, in sample order."""
    if len(index) == 0:
        return pd.DatetimeIndex([], tz="UTC")
    if index.tz is None:
        raise ValueError("block compression requires a timezone-aware index")
    return pd.DatetimeIndex(
        [
            block_key_utc(stamp.to_pydatetime(), timezone_name, minutes)
            for stamp in index
        ]
    ).tz_convert("UTC")


def block_ids(
    index: pd.DatetimeIndex, timezone: str, minutes: int = BLOCK_MINUTES
) -> np.ndarray:
    """Chronological block ID for each timestamp, DST-safe and UTC-identical.

    Blocks are local wall-clock calendar blocks, but their identity is the UTC
    instant of the applicable boundary. The two 02:00 occurrences in autumn
    therefore get different IDs; a missing 02:00 in spring is represented by
    the transition instant instead of an exception or a silently removed slot.
    """
    keys = _block_keys(index, timezone, minutes)
    ids, _ = pd.factorize(keys, sort=True)
    return ids


def block_starts(
    index: pd.DatetimeIndex, timezone: str, minutes: int = BLOCK_MINUTES
) -> pd.DatetimeIndex:
    """Canonical, unique block starts in chronological UTC order."""
    keys = _block_keys(index, timezone, minutes)
    if len(keys) == 0:
        return pd.DatetimeIndex([], tz="UTC")
    return pd.DatetimeIndex(sorted(set(keys))).tz_convert("UTC")


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
