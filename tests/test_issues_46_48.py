"""Issue 46–48 (Gutachten): EW-Tagesblock-Bootstrap, asym. Pinball, EW-δ̂/F5."""

import numpy as np
import pandas as pd
import pytest

from engine.backtest import (
    PINBALL_TAU_ASYM,
    markdown_report,
    metrics,
    pinball_loss,
    run_backtest,
)
from engine.config import Config
from engine.models import exp_block_weights
from engine.selection import (
    SelectionConfig,
    _day_block_bootstrap,
    analyse_city_light,
    cusum_break,
    daily_median_series,
    exp_weights,
    weighted_median,
)


# --- Issue 46: exponentiell gewichteter Tagesblock-Bootstrap ---


def test_exp_weights_none_is_uniform_and_sum_is_one():
    assert exp_weights(10, None) is None
    assert exp_weights(10, 0) is None
    assert exp_weights(10, -3) is None
    assert exp_weights(0, 14.0) is None
    weights = exp_weights(42, 14.0)
    assert weights is not None
    assert len(weights) == 42
    assert weights.sum() == pytest.approx(1.0)
    # Neueste Blöcke (hinten) wiegen am stärksten, monoton steigend.
    assert bool(np.all(np.diff(weights) > 0))
    # Halbwertszeit: Gewicht halbiert sich je 14 Tage Alter.
    assert weights[-1] / weights[-15] == pytest.approx(2.0)
    # 5 Wochen alter Block wiegt noch ~18 % eines aktuellen Blocks.
    assert weights[0] / weights[-1] == pytest.approx(0.5 ** (41 / 14.0))
    # Letzte 5 Tage dominieren die ersten 5 Tage deutlich.
    assert weights[-5:].sum() > 5 * weights[:5].sum()


def test_models_and_selection_weights_agree():
    for n, half_life in ((1, 14.0), (7, 7.0), (42, 14.0), (84, 14.0)):
        a = exp_block_weights(n, half_life)
        b = exp_weights(n, half_life)
        np.testing.assert_allclose(a, b)


def test_config_default_is_ew_and_uniform_is_selectable():
    assert Config().bootstrap_ew_half_life_days == 14.0
    assert Config(bootstrap_ew_half_life_days=None).bootstrap_ew_half_life_days is None
    with pytest.raises(ValueError, match="half_life"):
        Config(bootstrap_ew_half_life_days=0.5)
    with pytest.raises(ValueError, match="half_life"):
        Config(bootstrap_ew_half_life_days=400)


def test_ew_bootstrap_reacts_faster_after_regime_shift():
    """Synthetischer Regimewechsel: EW-Bootstrap liegt näher am neuen Regime."""
    rng = np.random.default_rng(7)
    days = np.repeat(np.arange(42), 24)
    noise = rng.normal(0, 0.2, len(days))
    delta = np.where(days < 21, noise, -5.0 + noise)
    boots_uniform, _ = _day_block_bootstrap(
        delta, days.astype(float), 500, np.random.default_rng(11), None
    )
    boots_ew, _ = _day_block_bootstrap(
        delta, days.astype(float), 500, np.random.default_rng(11), 14.0
    )
    mean_uniform = float(np.median(boots_uniform))
    mean_ew = float(np.median(boots_ew))
    # Uniform mischt beide Regime (~-2,5), EW liegt näher bei -5.
    assert mean_uniform == pytest.approx(-2.5, abs=0.6)
    assert mean_ew < mean_uniform
    assert abs(mean_ew - (-5.0)) < abs(mean_uniform - (-5.0))


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


# --- Issue 48 (F5): Strukturbruch / EWMA für δ̂ ---


def test_weighted_median_falls_back_to_classic_median():
    values = np.array([1.0, 2.0, 3.0, 100.0])
    assert weighted_median(values, None) == pytest.approx(2.5)
    assert weighted_median(values, np.ones(4)) == pytest.approx(2.5)
    # Hohes Gewicht auf dem Ausreißer zieht den EW-Median nach oben.
    assert weighted_median(values, np.array([1.0, 1.0, 1.0, 10.0])) == pytest.approx(
        100.0
    )
    assert np.isnan(weighted_median(np.array([np.nan]), None))
    # Falsche Gewichtslänge: Fallback auf klassischen Median statt Crash.
    assert weighted_median(values, np.ones(3)) == pytest.approx(2.5)


def test_daily_median_series_is_chronological():
    delta = np.array([1.0, 2.0, 3.0, 4.0])
    keys, medians = daily_median_series(delta, np.array([5.0, 3.0, 5.0, 3.0]))
    np.testing.assert_array_equal(keys, [3.0, 5.0])
    np.testing.assert_allclose(medians, [3.0, 2.0])


def test_cusum_flags_level_shift_but_not_stable_series():
    # Stabile Reihen: höchstens vereinzelte Fehlalarme (konservative Schwelle).
    false_alarms = sum(
        cusum_break(np.random.default_rng(seed).normal(0, 0.3, 42))[0]
        for seed in range(20)
    )
    assert false_alarms <= 2
    # Niveauwechsel (5 ct bei σ=0,3) wird zuverlässig erkannt.
    for seed in range(5):
        shifted = np.concatenate(
            [
                np.random.default_rng(seed).normal(0, 0.3, 21),
                np.random.default_rng(1000 + seed).normal(-5, 0.3, 21),
            ]
        )
        flag, stat = cusum_break(shifted)
        assert flag is True
        assert stat > 2.0
    # Zu kurz oder konstant: ehrlich kein Flag, kein Crash.
    assert cusum_break(np.array([1.0, 2.0])) == (False, 0.0)
    assert cusum_break(np.full(20, 1.5)) == (False, 0.0)


def test_ew_median_reacts_faster_than_classic_after_21_days():
    """Backtest-Idee F5: Regimewechsel nach 21 Tagen, 42 Tage Fenster."""
    rng = np.random.default_rng(9)
    days = np.repeat(np.arange(42), 24)
    noise = rng.normal(0, 0.2, len(days))
    delta = np.where(days < 21, noise, -5.0 + noise)
    classic = float(np.nanmedian(delta))
    _, day_meds = daily_median_series(delta, days.astype(float))
    ew = weighted_median(day_meds, exp_weights(len(day_meds), 7.0))
    # Klassischer Median mischt beide Regime (~-2,5 → ~21 Tage blind).
    assert classic == pytest.approx(-2.5, abs=0.5)
    # EW-Median (HWZ 7 Tage) liegt deutlich näher am neuen Regime (-5).
    assert abs(ew - (-5.0)) < abs(classic - (-5.0))
    assert ew < -3.5
    assert cusum_break(day_meds)[0] is True


def test_selection_reports_ew_delta_and_break_flag():
    """Integration: 4 Stationen, eine mit Preissenkung nach 21 Tagen."""
    index = pd.date_range("2026-06-01", periods=42 * 24, freq="h", tz="UTC")
    rng = np.random.default_rng(5)
    frames = []
    for position, sid in enumerate(["a", "b", "c", "d"]):
        price = 1.70 + rng.normal(0, 0.002, len(index))
        if sid == "a":
            price[21 * 24 :] -= 0.05
        frames.append(
            pd.DataFrame(
                {
                    "timestamp": index,
                    "station_id": sid,
                    "city": "Teststadt",
                    "fuel": "E10",
                    "price": price,
                    "status": "open",
                    "source": "influxdb",
                }
            )
        )
    df = pd.concat(frames, ignore_index=True)
    cfg = SelectionConfig(n_boot=200, step_min=60)
    result = analyse_city_light(df, "Teststadt", cfg, np.random.default_rng(42), {})
    assert result is not None
    by_id = {row["station_id"]: row for row in result["stations"]}
    shifted = by_id["a"]
    for key in (
        "delta_ct",
        "delta_ew_ct",
        "delta_recent5_ct",
        "delta_days",
        "break_flag",
        "break_stat",
        "saving_ew_per_fill_eur",
    ):
        assert key in shifted, key
    # Klassisch gemischt (~-2,5 ct), EW näher am neuen Regime (~-5 ct).
    assert shifted["delta_ct"] == pytest.approx(-2.5, abs=1.0)
    assert shifted["delta_ew_ct"] < shifted["delta_ct"]
    assert abs(shifted["delta_ew_ct"] - (-5.0)) < abs(shifted["delta_ct"] - (-5.0))
    assert shifted["delta_recent5_ct"] == pytest.approx(-5.0, abs=1.0)
    assert shifted["break_flag"] is True
    # Unveränderte Stationen ohne Bruch.
    assert by_id["b"]["break_flag"] is False


def test_analysis_module_mirrors_ew_helpers(monkeypatch):
    try:
        import analysis.station_selection as analysis
    except ImportError:
        # CI installiert kein matplotlib: Plot-Backend stubben, um die
        # reinen Numpy-Helfer des gespiegelten Analyse-Moduls zu prüfen.
        import sys
        import types

        stub = types.ModuleType("matplotlib")
        stub.use = lambda *args, **kwargs: None
        monkeypatch.setitem(sys.modules, "matplotlib", stub)
        monkeypatch.setitem(
            sys.modules, "matplotlib.pyplot", types.ModuleType("matplotlib.pyplot")
        )
        import analysis.station_selection as analysis
    assert analysis.Config().boot_ew_half_life_days == 14.0
    assert analysis.Config().delta_ew_half_life_days == 7.0
    assert analysis.exp_weights(4, 7.0).sum() == pytest.approx(1.0)
    assert analysis.weighted_median(np.array([1.0, 2.0, 3.0]), None) == pytest.approx(
        2.0
    )
    rng = np.random.default_rng(2)
    delta = np.concatenate([rng.normal(0, 0.2, 240), rng.normal(-5, 0.2, 240)])
    days = np.repeat(np.arange(20), 24).astype(float)
    boots_uniform, _ = analysis.day_block_bootstrap(
        delta, days, 300, np.random.default_rng(1), None
    )
    boots_ew, _ = analysis.day_block_bootstrap(
        delta, days, 300, np.random.default_rng(1), 14.0
    )
    assert float(np.median(boots_ew)) < float(np.median(boots_uniform))
