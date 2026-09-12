import numpy as np
import pandas as pd
import pytest
from pandas.testing import assert_frame_equal

from engine.backtest import (
    PINBALL_TAU_ASYM,
    markdown_report,
    metrics,
    picp_badge,
    pinball_loss,
    run_backtest,
)
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
    assert set(report["horizons"]) == {"72h", "168h"}
    assert report["horizons"]["72h"]["days_evaluated"] > 0
    rolling = report["rolling_picp_7d"]
    assert len(rolling) == 1
    assert len(rolling[0]["days"]) == 2
    assert rolling[0]["current"] == rolling[0]["days"][-1]
    assert rolling[0]["current"]["points"] == 2 * 216
    text = markdown_report(report)
    assert "nicht abgenommen" in text
    assert "Mehrtage-Horizonte" in text
    assert "Rolling-PICP 7 Tage" in text


@pytest.mark.parametrize(
    "picp,points,expected",
    [
        (95.0, 72, "green"),
        (93.0, 72, "green"),
        (92.99, 72, "yellow"),
        (90.0, 72, "yellow"),
        (89.99, 72, "red"),
        (100.0, 71, None),
        (None, 999, None),
    ],
)
def test_rolling_picp_badge_thresholds(picp, points, expected):
    assert picp_badge(picp, points) == expected


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


def test_decision_rows_evaluate_anchor_rule_against_realized_prices(series, cfg):
    """Anker-Zeilen: Mitternachts-Fit als Erwartung, offene Preise als Wahrheit.

    Default-Anker ist 12:00 (12-Uhr-Regel: Anhebungen nur mittags) — der
    hypothetische Entscheid weiß dann, ob es heute teurer wurde.
    """
    from engine.backtest import DECISION_HOUR

    report, _ = run_backtest([series], cfg, days=2, until="2026-08-01")
    decision = report["decision"]
    assert decision["decision_hour"] == DECISION_HOUR == 12
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
        assert 12.0 < row["predHour"] <= 24.0


def test_decision_hour_is_configurable(series, cfg):
    """Der Schicht-A-Anker folgt cfg.decision_hour (TANKAPP_DECISION_HOUR)."""
    from dataclasses import replace

    morning = replace(cfg, decision_hour=8)
    report, _ = run_backtest([series], morning, days=2, until="2026-08-01")
    decision = report["decision"]
    assert decision["decision_hour"] == 8
    assert decision["days_evaluated"] == 2
    for row in decision["rows"]:
        assert 8.0 < row["predHour"] <= 24.0


def test_decision_row_skips_days_without_anchor_or_realization(cfg):
    """Tage ohne Anker/Erwartung/Realisierung werden übersprungen, nicht erfunden."""
    import pandas as pd

    from engine.backtest import decision_row

    target = pd.date_range(
        "2026-07-31 00:00", "2026-08-01 00:00", freq="10min", inclusive="left", tz="UTC"
    )
    local_origin = pd.Timestamp("2026-07-31", tz=cfg.timezone)
    # Nur Preise nach 10:00 UTC (= 12:00 Berlin): kein 12:00-Anker.
    truth = pd.DataFrame(
        {"price": [1.70] * len(target), "observed": [True] * len(target)}, index=target
    )
    truth.loc[target <= pd.Timestamp("2026-07-31 10:00", tz="UTC"), "observed"] = False
    forecast = pd.DataFrame({"q50": [1.65] * len(target)}, index=target)
    assert decision_row(truth, forecast, target, local_origin, cfg.timezone) is None


# --- Issue 47: asymmetrischer Pinball-Loss ---


def test_pinball_tau_is_documented_075():
    assert PINBALL_TAU_ASYM == 0.75


def test_pinball_loss_symmetry_and_3x_ratio():
    # τ=0,5: symmetrisch 0,5·|Fehler|.
    np.testing.assert_allclose(
        pinball_loss([1.7, 1.8], [1.75, 1.75], tau=0.5), [0.025, 0.025]
    )
    # τ=0,75: Unterschätzung (actual > q) kostet 0,75·e, Überschätzung 0,25·|e|.
    assert float(pinball_loss([1.80], [1.70])[0]) == pytest.approx(0.075)
    assert float(pinball_loss([1.70], [1.80])[0]) == pytest.approx(0.025)
    assert float(pinball_loss([1.80], [1.70])[0]) / float(
        pinball_loss([1.70], [1.80])[0]
    ) == pytest.approx(3.0)


def test_metrics_reports_asym_pinball_and_empty_is_none():
    empty = metrics(pd.DataFrame())
    assert empty["pinball_asym_ct"] is None
    assert empty["naive_pinball_asym_ct"] is None
    rows = pd.DataFrame(
        {
            "actual": [1.70, 1.80],
            "q50": [1.72, 1.78],
            "naive": [1.70, 1.70],
            "q025": [1.60, 1.60],
            "q975": [1.90, 1.90],
            "mase_scale": [0.01, 0.01],
        }
    )
    result = metrics(rows)
    # Punkt 1: Überschätzung 2 ct → 0,25·2 = 0,5; Punkt 2: Unterschätzung
    # 2 ct → 0,75·2 = 1,5; Mittel = 1,0 ct.
    assert result["pinball_asym_ct"] == pytest.approx(1.0)
    assert result["pinball50_ct"] == pytest.approx(1.0)
    # Naive: 0 ct + Unterschätzung 10 ct → (0 + 7,5)/2 = 3,75 ct.
    assert result["naive_pinball_asym_ct"] == pytest.approx(3.75)


def test_backtest_report_has_asym_criterion_and_threshold(series, cfg):
    report, _ = run_backtest([series], cfg, days=2, until="2026-08-01")
    assert report["pinball_asym_tau"] == 0.75
    assert "pinball_asym_better_than_naive" in report["criteria"]
    assert report["criteria"]["pinball_asym_better_than_naive"] in (True, False)
    # MASE/PICP95 bleiben daneben bestehen.
    assert "mase_24h_below_0_95" in report["criteria"]
    assert "picp95_between_90_and_98" in report["criteria"]
    text = markdown_report(report)
    assert "τ=0,75 asym" in text
    assert "pinball_asym_better_than_naive" in text
