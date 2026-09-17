"""O2/O3 — one weekday-aware, gradually shrunk receipt availability profile."""

import inspect
from pathlib import Path

import numpy as np
import pytest
import pandas as pd

from app.decide import _wh_weight
from engine.personalization import default_weekday_profile, weekday_profile
from engine.selection import SelectionConfig, analyse_city_light


def _one_cell(day: int, hour: int):
    result = [[0.0 for _ in range(24)] for _ in range(7)]
    result[day][hour] = 1.0
    return result


def test_default_profile_is_normalized_and_explicitly_weekday_aware():
    profile = default_weekday_profile()
    assert len(profile) == 7 and all(len(day) == 24 for day in profile)
    assert np.sum(profile) == 1.0
    # Monday commuter hours share Monday's 1/7 mass; Sunday is uniform.
    assert profile[0][18] == 1 / (7 * 7)
    assert profile[6][10] == 1 / (7 * 24)
    assert profile[0][10] == 0.0


def test_first_receipt_shrinks_profile_without_the_old_eight_fill_cliff():
    fill = {"tanked_at": "2026-09-14T18:10:00+02:00", "clock_hour": 18}
    profile = weekday_profile([fill])
    default = default_weekday_profile()
    assert profile["source"] == "shrunk_receipts"
    assert profile["n_fills"] == 1
    assert profile["weights"][0][18] > default[0][18]
    assert np.sum(profile["weights"]) == pytest.approx(1.0)
    # Monday evening and Saturday morning receipts produce distinct weekday
    # window weights—not merely the same collapsed hour histogram.
    sat = weekday_profile([{"tanked_at": "2026-09-12T10:10:00+02:00"}])
    assert _wh_weight(
        profile["weights"], "2026-09-14T18:00:00+02:00", "2026-09-14T19:00:00+02:00"
    ) > _wh_weight(
        profile["weights"], "2026-09-12T10:00:00+02:00", "2026-09-12T11:00:00+02:00"
    )
    assert _wh_weight(
        sat["weights"], "2026-09-12T10:00:00+02:00", "2026-09-12T11:00:00+02:00"
    ) > _wh_weight(
        sat["weights"], "2026-09-14T18:00:00+02:00", "2026-09-14T19:00:00+02:00"
    )


def _selection_frame():
    index = pd.date_range("2026-09-07", periods=14 * 24, freq="h", tz="Europe/Berlin")
    frames = []
    for sid in ("a", "b", "c", "d"):
        price = np.full(len(index), 1.70)
        monday_evening = (index.dayofweek == 0) & (index.hour == 18)
        saturday_morning = (index.dayofweek == 5) & (index.hour == 10)
        if sid == "a":
            price[monday_evening] = 1.50
            price[saturday_morning] = 2.00  # rank 4, so not Top-3
        elif sid == "b":
            price[monday_evening] = 2.00
            price[saturday_morning] = 1.50
        elif sid == "c":
            price[:] = 1.60
        else:
            price[:] = 1.65
        frames.append(
            pd.DataFrame(
                {
                    "timestamp": index,
                    "station_id": sid,
                    "city": "Test",
                    "fuel": "E10",
                    "price": price,
                    "status": "open",
                    "source": "influxdb",
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


def test_selection_availability_uses_the_same_weekday_profile():
    df = _selection_frame()
    cfg = SelectionConfig(
        n_boot=10,
        step_min=60,
        ffill_minutes=60,
        min_coverage=0,
        poll_start=0,
        poll_end=24,
        dead_after_days=None,
        user_time_weights=_one_cell(0, 18),
        time_profile_source="receipt_test",
    )
    monday = analyse_city_light(df, "Test", cfg, np.random.default_rng(3), {})
    cfg_saturday = SelectionConfig(
        **{**cfg.__dict__, "user_time_weights": _one_cell(5, 10)}
    )
    saturday = analyse_city_light(
        df, "Test", cfg_saturday, np.random.default_rng(3), {}
    )
    mon_avail = {row["station_id"]: row["avail"] for row in monday["stations"]}
    sat_avail = {row["station_id"]: row["avail"] for row in saturday["stations"]}
    assert mon_avail["a"] > mon_avail["b"]
    assert sat_avail["b"] > sat_avail["a"]
    assert monday["availability_profile"]["source"] == "receipt_test"


def test_default_weight_formula_has_only_one_owner():
    """Ratchet: no second commuter-vector literal in production/analysis code."""
    import engine.selection as selection

    for module, source in (
        (selection, inspect.getsource(selection)),
        ("analysis", Path("analysis/station_selection.py").read_text()),
    ):
        assert "w[[6, 7, 8, 16, 17, 18, 19]]" not in source
        assert "default_weekday_profile" in source
