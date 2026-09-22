"""P-Seite des Workers: engine/probabilities.py (Konzept §4.1–4.3).

Die Draw-Reduktion (2-h-Block-Minima + Nowcast) muss deterministisch,
chronologisch und NaN-sauber sein: „P = 0“ (alle Draws unter der Schwelle)
ist etwas anderes als „keine Aussage“ (ungestützter Block → NaN).
"""

import numpy as np
import pandas as pd

from engine.probabilities import (
    BLOCK_MINUTES,
    block_ids,
    block_minima,
    block_starts,
    nowcast_draws,
)


def _index(hours=24, start="2026-08-01T00:00", tz="Europe/Berlin"):
    return pd.date_range(start, periods=hours * 12, freq="5min", tz=tz)


def test_block_ids_are_chronological_two_hour_grid():
    index = _index(6)  # 6 h → 3 Blöcke à 2 h
    ids = block_ids(index, "Europe/Berlin", BLOCK_MINUTES)
    assert ids.shape == (len(index),)
    assert int(ids.min()) == 0 and int(ids.max()) == 2
    # Der erste Zeitpunkt gehört zu Block 0, der letzte zu Block 2.
    assert ids[0] == 0
    assert ids[-1] == 2
    # Innerhalb eines 2-h-Blocks ist der Index konstant.
    assert np.all(ids[0:23] == 0)  # 00:00–01:55


def test_block_starts_match_blocks_and_are_utc():
    index = _index(6)
    ids = block_ids(index, "Europe/Berlin", BLOCK_MINUTES)
    starts = block_starts(index, "Europe/Berlin", BLOCK_MINUTES)
    assert len(starts) == int(ids.max()) + 1
    # Europe/Berlin am 01.08.2026 ist UTC+2 → 00:00 lokal = 22:00 UTC.
    assert starts[0].isoformat() == "2026-07-31T22:00:00+00:00"
    assert str(starts.tz) == "UTC"


def test_block_ids_empty_input():
    ids = block_ids(pd.DatetimeIndex([], tz="Europe/Berlin"), "Europe/Berlin")
    assert ids.size == 0
    starts = block_starts(pd.DatetimeIndex([], tz="Europe/Berlin"), "Europe/Berlin")
    assert len(starts) == 0


def test_dst_spring_and_autumn_keep_utc_identity_and_both_folds():
    """23-/25-hour forecasts never use ambiguous local ``floor`` values."""
    for start in ("2026-03-28T22:00:00Z", "2026-10-24T22:00:00Z"):
        index = pd.date_range(start, periods=25 * 12, freq="5min", tz="UTC")
        ids = block_ids(index, "Europe/Berlin", BLOCK_MINUTES)
        starts = block_starts(index, "Europe/Berlin", BLOCK_MINUTES)
        assert ids.shape == (len(index),)
        assert np.all(np.diff(ids) >= 0)
        assert len(starts) == int(ids.max()) + 1
        assert starts.is_monotonic_increasing
        assert str(starts.tz) == "UTC"

    autumn = pd.date_range("2026-10-25T00:00:00Z", periods=25, freq="5min", tz="UTC")
    autumn_ids = block_ids(autumn, "Europe/Berlin", BLOCK_MINUTES)
    # 02:00 CEST and 02:00 CET are distinct UTC blocks, not a merged hour.
    assert autumn_ids[0] != autumn_ids[-1]
    assert len(block_starts(autumn, "Europe/Berlin", BLOCK_MINUTES)) == 2


def test_block_minima_shape_nan_semantics_and_values():
    # 3 Blöcke à 2 Zeitpunkte: Block 0 = [1, 3], Block 1 = [2, 1], Block 2 = [5, 9].
    paths = np.array([[1.0, 3.0, 2.0, 1.0, 5.0, 9.0]])
    ids = np.array([0, 0, 1, 1, 2, 2])
    minima = block_minima(paths, ids)
    assert minima.shape == (1, 3)
    np.testing.assert_allclose(minima, [[1.0, 1.0, 5.0]])


def test_block_minima_nan_block_stays_nan_not_zero():
    # Block 1 ist komplett NaN → NaN (keine Aussage), nicht 0.
    paths = np.array([[1.0, 2.0, np.nan, np.nan]])
    ids = np.array([0, 0, 1, 1])
    minima = block_minima(paths, ids)
    np.testing.assert_allclose(minima[0], [1.0, np.nan])


def test_block_minima_ignores_nan_within_supported_block():
    paths = np.array([[3.0, np.nan, 1.5, 2.0]])
    ids = np.array([0, 0, 0, 0])
    minima = block_minima(paths, ids)
    np.testing.assert_allclose(minima[0], [1.5])


def test_block_minima_empty_input():
    minima = block_minima(np.empty((0, 0)), np.array([], dtype=int))
    assert minima.shape == (0, 0)
    minima = block_minima(np.empty((3, 0)), np.array([], dtype=int))
    assert minima.shape == (3, 0)


def test_nowcast_draws_first_column_and_empty_columns():
    paths = np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])
    np.testing.assert_allclose(nowcast_draws(paths), [1.0, 3.0, 5.0])
    empty = nowcast_draws(np.empty((3, 0)))
    assert empty.shape == (3,)
    assert np.isnan(empty).all()
