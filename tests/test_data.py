import numpy as np
import pandas as pd
import pytest

from engine.config import Config
from engine.data import (
    load_observations,
    normalize_observations,
    parse_times,
    prepare_series,
)


def raw(times, prices, statuses=None):
    frame = pd.DataFrame(
        {
            "timestamp": times,
            "price": prices,
            "station_id": "station-1",
            "city": "Test",
            "fuel": "E10",
        }
    )
    if statuses is not None:
        frame["status"] = statuses
    return frame


def prepared(frame, cfg):
    rows, _ = normalize_observations(frame, cfg)
    return prepare_series(rows, cfg)[0].frame


def test_berlin_legacy_and_utc_offsets(cfg):
    values = pd.Series(
        [
            "2026-07-01 06:00:00",
            "2026-07-01T06:00:00+02:00",
            "2026-07-01T04:00:00Z",
            "2026-01-01 06:00:00",
        ]
    )
    result = parse_times(values, cfg.timezone)
    assert result.iloc[:3].nunique() == 1
    assert result.iloc[3].hour == 5


def test_ambiguous_and_nonexistent_dst_times_are_not_invented(cfg):
    values = pd.Series(
        [
            "2026-10-25 02:30:00",
            "2026-03-29 02:30:00",
            "2026-10-25T02:30:00+02:00",
            "2026-10-25T02:30:00+01:00",
        ]
    )
    result = parse_times(values, cfg.timezone)
    assert result.iloc[:2].isna().all()
    assert result.iloc[3] - result.iloc[2] == pd.Timedelta(hours=1)


def test_polls_become_available_after_not_before_observation(cfg):
    data = prepared(
        raw(["2026-07-01T06:03:00Z", "2026-07-01T06:12:00Z"], [1.7, 1.8]), cfg
    )
    assert data.index.min() == pd.Timestamp("2026-07-01T06:05:00Z")
    assert data.loc["2026-07-01T06:10:00Z", "price"] == 1.7
    assert data.loc["2026-07-01T06:15:00Z", "price"] == 1.8


def test_fill_expires_at_30_minutes(cfg):
    data = prepared(
        raw(["2026-07-01T06:00:00Z", "2026-07-01T06:45:00Z"], [1.7, 1.8]), cfg
    )
    assert data.loc["2026-07-01T06:30:00Z", "price"] == 1.7
    assert np.isnan(data.loc["2026-07-01T06:35:00Z", "price"])
    assert data.observed.sum() == 2


@pytest.mark.parametrize(
    "status,price",
    [
        ("closed", 1.6),
        ("no prices", None),
        ("open", None),
        ("open", False),
        ("open", True),
        ("open", 0),
    ],
)
def test_missing_and_closed_state_is_a_fill_barrier(cfg, status, price):
    data = prepared(
        raw(
            ["2026-07-01T06:00:00Z", "2026-07-01T06:05:00Z", "2026-07-01T06:20:00Z"],
            [1.7, price, 1.8],
            ["open", status, "open"],
        ),
        cfg,
    )
    assert data.iloc[1:4].price.isna().all()
    assert data.iloc[-1].price == 1.8


def test_last_row_of_bucket_not_last_non_null_price(cfg):
    data = prepared(
        raw(
            ["2026-07-01T06:01:00Z", "2026-07-01T06:03:00Z"],
            [1.7, None],
            ["open", "closed"],
        ),
        cfg,
    )
    assert len(data) == 1
    assert pd.isna(data.iloc[0].price)
    assert data.iloc[0].status == "closed"


def test_duplicate_live_status_wins_regardless_of_file_order(cfg):
    data = raw(["2026-07-01T06:00:00Z"] * 2, [None, 1.7], ["closed", None])
    data["source"] = ["influxdb", "history"]
    first, quality = normalize_observations(data, cfg)
    second, _ = normalize_observations(data.iloc[::-1], cfg)
    assert quality["duplicates_removed"] == 1
    assert first.iloc[0].status == second.iloc[0].status == "closed"


def test_legacy_unknown_status_reported_and_invalid_prices_counted(cfg):
    data = raw(["2026-07-01T06:00:00Z", "2026-07-01T06:05:00Z"], [1.7, None])
    rows, quality = normalize_observations(data, cfg)
    assert quality["rows_without_status"] == 2
    assert quality["invalid_open_prices"] == 1
    assert not rows.status_known.any()


def test_marked_demo_data_refused(cfg):
    data = raw(["2026-07-01T06:00:00Z"], [1.7])
    data["source"] = "demo"
    with pytest.raises(ValueError, match="Demo"):
        normalize_observations(data, cfg)


def test_missing_schema_and_missing_station_are_not_synthesized(cfg, tmp_path):
    path = tmp_path / "input.csv"
    raw(["2026-07-01T06:00:00Z"], [1.7]).to_csv(path, index=False)
    with pytest.raises(ValueError, match="Keine Daten"):
        load_observations([path], cfg, station_ids={"does-not-exist"})
    with pytest.raises(ValueError, match="CSV-Spalten"):
        normalize_observations(pd.DataFrame({"price": [1.7]}), cfg)


def test_loading_gzip_preserves_null_prices_and_fuel_filter(cfg, tmp_path):
    path = tmp_path / "prices.csv.gz"
    data = raw(
        ["2026-07-01T06:00:00Z", "2026-07-01T06:05:00Z", "2026-07-01T06:10:00Z"],
        [None, "false", "1.7"],
        ["closed", "open", "open"],
    )
    data.loc[2, "fuel"] = "DIESEL"
    data.to_csv(path, index=False)
    rows, quality = load_observations([path], cfg)
    assert len(rows) == 2
    assert rows.price.isna().all()
    assert quality["invalid_open_prices"] == 1


@pytest.mark.parametrize(
    "kwargs",
    [
        {"step_minutes": 30},
        {"ffill_minutes": 31},
        {"min_train_days": 3},
        {"poll_start": 24},
        {"seed": -1},
    ],
)
def test_invalid_configuration_rejected(kwargs):
    with pytest.raises(ValueError):
        Config(**kwargs)
