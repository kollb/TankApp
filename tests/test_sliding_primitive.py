"""The sliding-window engine primitive does not change publication contracts."""

import numpy as np
import pandas as pd
import pytest

from engine.probabilities import sliding_block_minima


def test_midday_valley_is_not_split():
    index = pd.date_range("2026-09-16T08:00Z", periods=72, freq="5min")
    local = index.tz_convert("Europe/Berlin")
    low = (local.hour == 11) & (local.minute >= 30) | (local.hour == 12) & (
        local.minute < 30
    )
    paths = np.where(low, 1.5, 1.8)[None, :]
    starts, minima = sliding_block_minima(index, paths, "Europe/Berlin")
    at_eleven = list(starts).index(pd.Timestamp("2026-09-16T09:00Z"))
    assert minima[0, at_eleven] == 1.5
    assert (
        index[
            (index >= starts[at_eleven])
            & (index < starts[at_eleven] + pd.Timedelta(hours=2))
        ][
            low[
                (index >= starts[at_eleven])
                & (index < starts[at_eleven] + pd.Timedelta(hours=2))
            ]
        ].size
        == 12
    )


def test_autumn_fold_distinguishes_both_hours_and_nan():
    index = pd.date_range("2026-10-24T23:00Z", periods=60, freq="5min")
    paths = np.vstack([np.arange(60, dtype=float), np.full(60, np.nan)])
    starts, minima = sliding_block_minima(index, paths, "Europe/Berlin")
    repeated = [
        stamp for stamp in starts if stamp.tz_convert("Europe/Berlin").hour == 2
    ]
    assert len(repeated) == 2 and repeated[0] != repeated[1]
    assert np.isnan(minima[1]).all()
    assert minima.shape == (2, len(starts))


def test_incomplete_grid_is_rejected_and_partial_end_excluded():
    index = pd.date_range("2026-09-16T08:00Z", periods=35, freq="5min")
    starts, _ = sliding_block_minima(index, np.ones((1, 35)), "Europe/Berlin")
    assert list(starts) == [index[0]]
    with pytest.raises(ValueError, match="regular"):
        sliding_block_minima(index.delete(3), np.ones((1, 34)), "Europe/Berlin")
