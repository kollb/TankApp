import json

import pandas as pd
import pytest

from engine.bootstrap import bootstrap
from engine.cli import main
from engine.data import load_observations, normalize_observations, prepare_series


def normalized(raw, cfg):
    return normalize_observations(raw, cfg)[0]


def test_history_only_can_start_today_without_polling(observations, cfg):
    history = observations(days=35).drop(columns="status").assign(source="history")
    result, report = bootstrap(normalized(history, cfg), cfg, "2026-08-05")
    assert len(result) == len(history)
    assert result.status.isna().all()
    assert report["stations"][0]["mode"] == "history_only"
    assert report["decision_ready"] is False


def test_handover_keeps_archive_prefix_but_never_repairs_live_barriers(
    observations, cfg
):
    history = observations(days=2).drop(columns="status").assign(source="history")
    live = observations(days=2).iloc[[360, 361, 380]].copy()
    live.loc[live.index[0], "timestamp"] = "2026-07-02T06:00:01+02:00"
    live.loc[live.index[1], "timestamp"] = "2026-07-02T06:04:00+02:00"
    live.loc[live.index[1], "status"] = "closed"
    result, report = bootstrap(
        normalized(pd.concat([history, live]), cfg), cfg, "2026-07-03"
    )
    boundary = pd.Timestamp("2026-07-02T06:05:00+02:00")
    assert result.loc[result.source.eq("history"), "timestamp"].max() < boundary
    assert report["stations"][0]["mode"] == "bootstrap"
    series = prepare_series(normalized(result, cfg), cfg)[0].frame
    assert series.loc[boundary, "status"] == "closed"
    assert pd.isna(series.loc[boundary + pd.Timedelta(minutes=40), "price"])
    assert not report["stations"][0]["fresh_live"]


def test_90_good_days_switch_only_mature_station(observations, cfg):
    live = observations(days=90, start="2026-06-01")
    new_station = live.iloc[-288:].assign(station_id="new", city="Gütersloh")
    history = observations(days=10, start="2026-05-01").assign(source="history")
    history_new = history.assign(station_id="new", city="Gütersloh")
    result, report = bootstrap(
        normalized(pd.concat([history, history_new, live, new_station]), cfg),
        cfg,
        "2026-08-30",
    )
    by_id = {item["station_id"]: item for item in report["stations"]}
    assert by_id["station-1"]["mode"] == "live_only"
    assert by_id["station-1"]["good_complete_live_days"] == 90
    assert by_id["new"]["mode"] == "bootstrap"
    assert by_id["new"]["good_complete_live_days"] == 1
    assert (
        not result.loc[result.station_id.eq("station-1"), "source"].eq("history").any()
    )
    assert result.loc[result.station_id.eq("new"), "source"].eq("history").any()


@pytest.mark.parametrize("problem", ["missing", "no prices", "invalid", "unknown"])
def test_one_bad_day_blocks_switch_even_after_90_calendar_days(
    observations, cfg, problem
):
    raw = observations(days=90, start="2026-06-01")
    day = raw.timestamp.str.startswith("2026-07-01")
    if problem == "missing":
        raw = raw.loc[~day]
    elif problem == "no prices":
        raw.loc[day, "status"] = "no prices"
    elif problem == "invalid":
        raw.loc[day, "price"] = 0
    else:
        raw.loc[day, "status"] = None
    _, report = bootstrap(normalized(raw, cfg), cfg, "2026-08-30")
    item = report["stations"][0]
    assert item["mode"] == "bootstrap"
    assert item["good_complete_live_days"] == 89
    assert item["worst_daily_coverage"] == 0


def test_cutoff_does_not_use_future_data_and_partial_day_does_not_count(
    observations, cfg
):
    raw = observations(days=95, start="2026-06-01")
    early, report = bootstrap(normalized(raw, cfg), cfg, "2026-08-29T12:00+02:00")
    assert report["stations"][0]["mode"] == "bootstrap"
    assert report["stations"][0]["good_complete_live_days"] == 89
    assert early.timestamp.max() < pd.Timestamp("2026-08-29T12:00+02:00")
    truncated = raw.loc[
        pd.to_datetime(raw.timestamp, utc=True)
        < early.timestamp.max() + pd.Timedelta(seconds=1)
    ]
    same, same_report = bootstrap(
        normalized(truncated, cfg), cfg, "2026-08-29T12:00+02:00"
    )
    pd.testing.assert_frame_equal(
        early.reset_index(drop=True), same.reset_index(drop=True)
    )
    assert report == same_report


def test_night_is_not_an_outage_but_stale_export_is(observations, cfg):
    raw = normalized(observations(days=90, start="2026-06-01"), cfg)
    _, night = bootstrap(raw, cfg, "2026-08-30T05:00+02:00")
    assert night["stations"][0]["mode"] == "live_only"
    _, stale = bootstrap(raw, cfg, "2026-08-30T08:00+02:00")
    assert stale["stations"][0]["good_complete_live_days"] == 90
    assert stale["stations"][0]["mode"] == "bootstrap"
    assert (
        stale["stations"][0]["reason"]
        == "latest-live-response-missing-invalid-or-stale"
    )


@pytest.mark.parametrize("start", ["2026-03-25", "2026-10-22"])
def test_complete_local_days_across_dst(start, observations, cfg):
    begin = pd.Timestamp(start, tz="Europe/Berlin")
    end = begin + pd.DateOffset(days=7)
    grid = pd.date_range(begin, end, freq="5min", inclusive="left")
    raw = observations(days=8).iloc[: len(grid)].copy()
    raw["timestamp"] = grid.astype(str)
    raw["status"] = "open"
    _, report = bootstrap(normalized(raw, cfg), cfg, end, live_only_days=7)
    assert report["stations"][0]["good_complete_live_days"] == 7
    assert report["stations"][0]["mode"] == "live_only"


def test_city_is_not_a_second_physical_identity(observations, cfg):
    raw = observations(days=2)
    raw.loc[0, "city"] = "Other label"
    with pytest.raises(ValueError, match="Stadtlabels"):
        bootstrap(normalized(raw, cfg), cfg, "2026-07-03")


def test_cli_roundtrip_unknown_status_and_protected_input(observations, tmp_path, cfg):
    path = tmp_path / "history.csv"
    observations(days=35).drop(columns="status").assign(source="history").to_csv(
        path, index=False
    )
    original = path.read_bytes()
    out = tmp_path / "bootstrap.csv.gz"
    args = ["bootstrap", "--data", str(path), "--at", "2026-08-05"]
    assert main([*args, "--out", str(path)]) == 1
    assert path.read_bytes() == original
    assert main([*args, "--out", str(out)]) == 0
    first = out.read_bytes()
    assert main([*args, "--out", str(out), "--min-daily-coverage", "nan"]) == 1
    assert out.read_bytes() == first
    report = json.loads((tmp_path / "bootstrap.csv.gz.policy.json").read_text())
    assert report["stations"][0]["mode"] == "history_only"
    reloaded, _ = load_observations([out], cfg)
    assert not reloaded.status_known.any()
    assert main(["fit", "--data", str(out), "--out", str(tmp_path / "model.json")]) == 0


def test_selected_station_only_in_future_fails_without_output(observations, tmp_path):
    raw = pd.concat(
        [
            observations(days=2),
            observations(days=2, start="2026-08-01").assign(station_id="new"),
        ]
    )
    data = tmp_path / "data.csv"
    raw.to_csv(data, index=False)
    polling = tmp_path / "polling.json"
    polling.write_text(json.dumps({"sets": {"Test": {"batch": ["station-1", "new"]}}}))
    out = tmp_path / "bootstrap.csv"
    assert (
        main(
            [
                "bootstrap",
                "--data",
                str(data),
                "--polling",
                str(polling),
                "--at",
                "2026-07-03",
                "--out",
                str(out),
            ]
        )
        == 1
    )
    assert not out.exists()


def test_two_city_ten_minute_cadence_is_not_a_fifty_percent_outage(observations, cfg):
    raw = observations(days=90, start="2026-06-01").iloc[::2]
    data = normalized(raw, cfg)
    _, default = bootstrap(data, cfg, "2026-08-30")
    assert default["stations"][0]["mode"] == "bootstrap"
    _, report = bootstrap(data, cfg, "2026-08-30", expected_poll_minutes=10)
    assert report["stations"][0]["mode"] == "live_only"
    assert report["stations"][0]["expected_poll_minutes"] == 10
