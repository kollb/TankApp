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


def test_draw_roundtrip_probability_scopes_and_neighbours():
    import datetime as dt

    from app.decide import (
        _draws_for_window,
        _format_window_item,
        _overlapping_windows,
        _sliding_draws,
    )
    from app.model_jobs import _draws
    from engine.config import Config

    index = pd.date_range("2026-09-16T08:00Z", periods=144, freq="5min")
    data = np.tile(np.linspace(1.9, 1.5, len(index)), (4, 1))
    data[0, :24] = np.nan
    payload = _draws(index, data, Config(), sliding=True)
    decoded = _sliding_draws(payload)
    starts, expected = sliding_block_minima(index, data, "Europe/Berlin")
    assert decoded is not None
    assert len(decoded["blocks"]) == len(starts)
    np.testing.assert_allclose(
        np.array(decoded["minima"], dtype=float),
        expected,
        atol=0.000051,
        equal_nan=True,
    )
    points = [
        {"timestamp": t.isoformat(), "q50": float(data[1, i])}
        for i, t in enumerate(index)
    ]
    now = index[0].to_pydatetime()
    windows = _overlapping_windows(
        points, now, None, decoded, today_only=True, wh_hours=None, anchor=None
    )
    window = windows[0]
    item = _format_window_item(window, payload, 2.0, 40)
    assert item["draw_scope"] == "whole_published_block"
    block_idx = list(starts).index(pd.Timestamp(window["_block_start"]))
    assert item["p_competitors"] == min(block_idx, 6) + min(
        len(starts) - 1 - block_idx, 6
    )
    truncated = dict(
        window,
        start=(
            dt.datetime.fromisoformat(window["start"]) + dt.timedelta(minutes=5)
        ).isoformat(),
    )
    assert _draws_for_window(truncated, payload)[2] == "partial_without_suffix_artifact"
    deadline = dt.datetime.fromisoformat(window["end"]) - dt.timedelta(minutes=5)
    assert (
        _draws_for_window(window, payload, deadline)[2]
        == "partial_without_prefix_artifact"
    )
    assert _format_window_item(truncated, payload, 2.0, 40)["p"] is None


def test_corrupt_sliding_draws_fail_closed():
    from app.decide import _sliding_draws
    from app.model_jobs import _draws
    from engine.config import Config

    index = pd.date_range("2026-09-16T08:00Z", periods=48, freq="5min")
    payload = _draws(index, np.ones((2, 48)), Config(), sliding=True)
    payload["sliding"]["minima_b64"] = "not base64"
    assert _sliding_draws(payload) is None
    payload["sliding"]["rows"] = 5000000
    assert _sliding_draws(payload) is None


def test_sliding_context_is_a_separate_gate_cohort():
    import datetime as dt

    from app.feedback import select_gate_cohort
    from app.gate_context import gate_context_key, statistical_gate_context

    forecast = {
        "model_kind": "profile_ar2",
        "day_pair": True,
        "draws_24h": {"shared": True},
    }
    when = dt.datetime(2026, 9, 21, tzinfo=dt.timezone.utc)
    old = statistical_gate_context(forecast, "e10", when, [])
    forecast["draws_24h"]["sliding"] = {"version": 1}
    new = statistical_gate_context(forecast, "e10", when, [])
    assert old["decision_contract"] != new["decision_contract"]
    historical = {
        "gate_cohorts": [{"context_key": gate_context_key(old), "calibrated": True}]
    }
    assert select_gate_cohort(historical, old)["calibrated"] is True
    assert select_gate_cohort(historical, new)["calibrated"] is False


def test_settlement_uses_exact_sliding_range(monkeypatch):
    import datetime as dt

    from app import feedback

    captured = []

    def realized(_live, _station, _city, _fuel, start, end, _now):
        captured.append((start, end))
        return 1.5

    monkeypatch.setattr(feedback, "_realized_min", realized)
    start = dt.datetime(2026, 9, 21, 9, tzinfo=dt.timezone.utc)
    end = start + dt.timedelta(minutes=115)
    now = end + dt.timedelta(hours=3)
    snap = {
        "id": "s",
        "action": "wait",
        "station_id": "station",
        "city": "Frankfurt",
        "fuel": "e10",
        "price_now": 1.8,
        "window_start": start.isoformat(),
        "window_end": end.isoformat(),
    }
    store = {"settlements": []}
    result = feedback._settle_one_snapshot(
        store, {"id": "ep"}, snap, now, now.isoformat()
    )
    assert captured == [(start, end)]
    assert result["p_realized"] == 1.5
    assert result["outcome"] == "win"
