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
    # O4: Fallzahl sind Tage — 2 Tage im Fenster heißt keine Aussage.
    assert rolling[0]["current"]["n_days"] == 2
    assert rolling[0]["current"]["badge"] is None
    text = markdown_report(report)
    assert "nicht abgenommen" in text
    assert "Mehrtage-Horizonte" in text
    assert "Rolling-PICP 7 Tage" in text


@pytest.mark.parametrize(
    "picp,n_days,expected",
    [
        (95.0, 3, "green"),
        (93.0, 7, "green"),
        (92.99, 7, "yellow"),
        (90.0, 3, "yellow"),
        (89.99, 7, "red"),
        # O4: Fallzahl sind Tage — unter 3 Tagen keine Aussage, egal wie
        # viele 5-Minuten-Punkte dahinterstehen.
        (100.0, 2, None),
        (None, 7, None),
    ],
)
def test_rolling_picp_badge_thresholds(picp, n_days, expected):
    assert picp_badge(picp, n_days) == expected


@pytest.mark.parametrize(
    "prev,picp,expected",
    [
        # O4-Hysterese: 1,5 pp jenseits der Schwelle. Grün hält 92,9
        # (roh gelb) ebenso wie 90,0 (roh gelb); erst unter 91,5 kippt es.
        ("green", 92.9, "green"),
        ("green", 91.5, "green"),
        ("green", 91.49, "yellow"),
        # ... und Rot braucht den Sprung unter 88,5 (90 − 1,5).
        ("green", 88.5, "yellow"),
        ("green", 88.49, "red"),
        # Gelb klebt in beide Richtungen: hoch erst ab 94,5, runter erst
        # unter 88,5.
        ("yellow", 94.5, "green"),
        ("yellow", 94.49, "yellow"),
        ("yellow", 88.5, "yellow"),
        ("yellow", 88.49, "red"),
        # Rot erholt sich erst ab 91,5 (gelb) bzw. 94,5 (grün) — erreichbar,
        # kein Latch: keine permanente §4.4-Blockade durch eine alte Zahl.
        ("red", 91.5, "yellow"),
        ("red", 91.49, "red"),
        ("red", 94.5, "green"),
        ("red", 94.49, "yellow"),
    ],
)
def test_rolling_picp_badge_hysteresis(prev, picp, expected):
    assert picp_badge(picp, 7, prev) == expected


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


def test_empty_multi_day_windows_skip_predict(observations, cfg, monkeypatch):
    """B20/2: Ohne Wahrheit kein teures +3-d/+7-d-predict rechnen."""
    import engine.backtest as backtest

    # Daten enden exakt am Backtest-Ende: Der 24-h-Fold ist vollständig, beide
    # Mehrtage-Fenster liegen aber hinter der letzten Beobachtung.
    normalized, _ = normalize_observations(observations(days=31), cfg)
    item = prepare_series(normalized, cfg)[0]
    actual_predict = backtest.predict
    calls = []

    def tracking_predict(model, *args, **kwargs):
        calls.append(kwargs.get("index"))
        return actual_predict(model, *args, **kwargs)

    monkeypatch.setattr(backtest, "predict", tracking_predict)
    report, rows = run_backtest([item], cfg, days=1, until="2026-08-01")
    assert not rows.empty
    assert len(calls) == 1  # nur der normale 24-h-Fold, nicht +72/+168 h
    assert report["horizons"]["72h"]["days_no_common_observations"] == 1
    assert report["horizons"]["168h"]["days_no_common_observations"] == 1


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


# H5: DST-Tage werden ausgewiesen (gekennzeichnet), nicht ausgeschlossen und
# nicht stillschweigend zu "nicht bestimmbar".
def _dst_observations(observations):
    """Reihe über die Frühjahrs-Umstellung 2026-03-29 (23-h-Tag)."""
    raw = observations(days=35, start="2026-03-15")
    return raw


def test_backtest_flags_dst_day_without_changing_the_fold_count(observations, cfg):
    raw = _dst_observations(observations)
    data, _ = normalize_observations(raw, cfg)
    report, _ = run_backtest(
        prepare_series(data, cfg), cfg, days=21, until="2026-04-05"
    )

    dst = report["dst"]
    assert dst["timezone"] == cfg.timezone
    assert dst["policy"] == "flagged_not_excluded"
    assert dst["days"] == ["2026-03-29"]
    assert dst["day_hours"] == {"2026-03-29": 23.0}
    assert dst["folds"] == 1
    assert dst["folds_scored"] == 1
    # Die betroffenen 02:xx-Slots des Folgetags haben keinen Wanduhr-Anker.
    assert dst["anchors_missing_nat"] >= 12
    # Die Umstellung macht die Skala nicht undefinierbar — MASE bleibt eine Zahl.
    assert report["metrics"]["mase"] is not None
    assert report["metrics"]["mase_none_reason"] is None
    assert dst["mase_none_reasons"] == []

    # Genau ein Fold trägt die Kennzeichnung, die übrigen bleiben 24-h-Tage.
    flagged = [fold for fold in report["folds"] if fold["dst_day"]]
    assert len(flagged) == 1
    assert flagged[0]["local_day"] == "2026-03-29"
    assert flagged[0]["local_day_hours"] == 23.0
    assert all(
        fold["local_day_hours"] == 24.0
        for fold in report["folds"]
        if not fold["dst_day"]
    )

    # Die fehlenden Anker liegen nicht am Umstellungstag selbst, sondern am
    # Folgetag: der 02:xx-Slot des 30.03. zeigt auf den 29.03. zurück, an dem
    # es diese Wanduhr-Zeit nicht gibt. Alle Fits mit diesem Fenster zählen mit.
    per_fold = [fold.get("mase_scale_anchors_nat") or 0 for fold in report["folds"]]
    assert sum(per_fold) == dst["anchors_missing_nat"] >= 12
    assert any(count >= 12 for count in per_fold)
    assert per_fold[0] == 0  # erster Fold: Fenster endet vor der Umstellung


def test_backtest_reports_dst_section_in_markdown(observations, cfg):
    raw = _dst_observations(observations)
    data, _ = normalize_observations(raw, cfg)
    report, _ = run_backtest(
        prepare_series(data, cfg), cfg, days=21, until="2026-04-05"
    )
    text = markdown_report(report)
    assert "## Zeitumstellung (DST)" in text
    assert "2026-03-29" in text
    assert "Vortages-Anker ohne Wanduhr-Zeitpunkt (DST)" in text


def test_backtest_without_dst_in_window_says_so(series, cfg):
    report, _ = run_backtest([series], cfg, days=2, until="2026-08-01")
    assert report["dst"]["days"] == []
    assert report["dst"]["folds"] == 0
    assert report["dst"]["anchors_missing_nat"] == 0
    assert all(fold["dst_day"] is False for fold in report["folds"])


def test_mase_none_names_its_reason_instead_of_silent_none():
    empty = metrics(pd.DataFrame())
    assert empty["mase"] is None and empty["mase_none_reason"] == "no_scored_points"
    rows = pd.DataFrame(
        {
            "actual": [1.70],
            "q50": [1.72],
            "naive": [1.70],
            "q025": [1.60],
            "q975": [1.80],
            "mase_scale": [np.nan],
        }
    )
    undefined = metrics(rows)
    assert undefined["mase"] is None
    assert undefined["mase_none_reason"] == "naive_scale_undefined"
