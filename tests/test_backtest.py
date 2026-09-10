import numpy as np
import pandas as pd
from pandas.testing import assert_frame_equal

from engine.backtest import markdown_report, metrics, run_backtest
from engine.config import Config
from engine.data import normalize_observations, prepare_series


def test_rolling_backtest_uses_only_actual_common_prices(series, cfg):
    report, rows = run_backtest([series], cfg, days=2, until="2026-08-01")
    assert report["metrics"]["points"] == 2 * 216
    assert rows.groupby("origin").size().tolist() == [216, 216]
    assert all(
        fold["training_end_exclusive"] == fold["origin"] for fold in report["folds"]
    )
    assert (
        pd.to_datetime(rows.timestamp, utc=True)
        >= pd.to_datetime(rows.origin, utc=True)
    ).all()
    assert (
        report["m3_complete"]
        is report["calibrated"]
        is report["decision_ready"]
        is False
    )
    assert report["criteria"]["at_least_21_complete_test_days_per_station"] is False
    assert report["criteria"]["mase_jump_free_below_0_80"] is None
    assert "nicht abgenommen" in markdown_report(report)


def test_filled_prices_are_not_test_truth(series, cfg):
    series.frame.loc[
        series.frame.index >= pd.Timestamp("2026-07-30T12:00:00Z"), "observed"
    ] = False
    report, rows = run_backtest([series], cfg, days=1, until="2026-07-31")
    assert report["metrics"]["points"] == 8 * 12
    assert (
        pd.to_datetime(rows.timestamp, utc=True) < pd.Timestamp("2026-07-30T12:00:00Z")
    ).all()


def test_leakage_future_change_alters_truth_not_first_fold_predictions(
    observations, cfg
):
    raw = observations()
    data, _ = normalize_observations(raw, cfg)
    _, before = run_backtest(prepare_series(data, cfg), cfg, days=2, until="2026-08-01")
    raw.loc[
        pd.to_datetime(raw.timestamp, utc=True) >= pd.Timestamp("2026-07-29T22:00:00Z"),
        "price",
    ] = 3.0
    data, _ = normalize_observations(raw, cfg)
    _, after = run_backtest(prepare_series(data, cfg), cfg, days=2, until="2026-08-01")
    columns = [
        "q025",
        "q10",
        "q50",
        "q90",
        "q975",
        "naive",
        "mase_scale",
        "origin",
        "timestamp",
    ]
    assert_frame_equal(before.iloc[:216][columns], after.iloc[:216][columns])
    assert not before.iloc[:216].actual.equals(after.iloc[:216].actual)


def test_zero_denominator_and_empty_report_are_not_zero_error():
    result = metrics(pd.DataFrame())
    assert result["mase"] is result["picp95_pct"] is None
    result = metrics(
        pd.DataFrame(
            {
                "actual": [1.7],
                "q50": [1.71],
                "naive": [1.7],
                "q025": [1.6],
                "q975": [1.8],
                "mase_scale": [np.nan],
            }
        )
    )
    assert result["mase"] is None and result["mase_points"] == 0
    assert result["mae_ct"] > 0


def test_missing_days_are_reported_not_backfilled(series, cfg):
    report, rows = run_backtest([series], cfg, days=1, until="2026-08-10")
    assert rows.empty
    assert report["folds"][0]["response_coverage_pct"] == 0
    assert not report["criteria"]["at_least_21_complete_test_days_per_station"]


def test_short_training_records_skip_reason(observations, cfg):
    normalized, _ = normalize_observations(observations(days=3), cfg)
    report, rows = run_backtest(
        prepare_series(normalized, cfg), cfg, days=2, until="2026-07-04"
    )
    assert rows.empty
    assert all(fold["status"] == "skipped" for fold in report["folds"])
    assert "mindestens" in markdown_report(report)


def test_calendar_day_backtest_handles_dst(observations):
    cfg = Config(
        train_days=14,
        min_train_days=7,
        min_slot_days=2,
        bootstrap_samples=100,
        poll_start=0,
    )
    raw = observations(days=35, start="2026-03-01")
    raw["status"] = "open"
    normalized, _ = normalize_observations(raw, cfg)
    report, _ = run_backtest(
        prepare_series(normalized, cfg), cfg, days=1, until="2026-03-30"
    )
    assert report["folds"][0]["target_points"] == 23 * 12
    assert report["metrics"]["points"] == 23 * 12


def test_reconstructed_history_never_passes_live_evidence_gate(observations, cfg):
    raw = observations().drop(columns=["status", "source"])
    normalized, _ = normalize_observations(raw, cfg)
    report, rows = run_backtest(
        prepare_series(normalized, cfg), cfg, days=1, until="2026-08-01"
    )
    assert not rows.empty
    assert report["test_sources"] == ["history"]
    assert report["criteria"]["all_test_prices_have_live_status"] is False
    assert not report["m3_complete"]


def test_decision_rows_evaluate_8am_rule_against_realized_prices(series, cfg):
    """08:00-Zeilen: Mitternachts-Fit als Erwartung, offene Preise als Wahrheit."""
    from engine.backtest import DECISION_HOUR

    report, _ = run_backtest([series], cfg, days=2, until="2026-08-01")
    decision = report["decision"]
    assert decision["decision_hour"] == DECISION_HOUR == 8
    assert decision["days_evaluated"] == 2
    assert decision["days_skipped"] == 0
    assert len(decision["rows"]) == 2
    for row in decision["rows"]:
        assert row["station_id"] == series.station_id
        assert set(row) >= {"day", "cls", "mu", "p", "s", "best", "predHour"}
        assert isinstance(row["mu"], float)
        assert isinstance(row["s"], float)
        assert row["best"] == round(max(row["s"], 0.0), 2)
        assert row["p"] is None  # kein P-Modell: ehrlich null
        assert 8.0 < row["predHour"] <= 24.0


def test_decision_row_skips_days_without_anchor_or_realization(cfg):
    """Tage ohne Anker/Erwartung/Realisierung werden übersprungen, nicht erfunden."""
    import pandas as pd

    from engine.backtest import decision_row

    target = pd.date_range(
        "2026-07-31 00:00", "2026-08-01 00:00", freq="10min", inclusive="left", tz="UTC"
    )
    local_origin = pd.Timestamp("2026-07-31", tz=cfg.timezone)
    # Nur Preise nach 08:00 UTC (= 10:00 Berlin): kein 08:00-Anker.
    truth = pd.DataFrame(
        {"price": [1.70] * len(target), "observed": [True] * len(target)}, index=target
    )
    truth.loc[target <= pd.Timestamp("2026-07-31 06:00", tz="UTC"), "observed"] = False
    forecast = pd.DataFrame({"q50": [1.65] * len(target)}, index=target)
    assert decision_row(truth, forecast, target, local_origin, cfg.timezone) is None
