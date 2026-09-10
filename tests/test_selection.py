"""engine.selection: FDR-Signifikanz (B=2000) und EW-δ̂/Strukturbruch."""

import inspect

import numpy as np
import pandas as pd
import pytest

from engine.config import Config
from engine.selection import (
    SelectionConfig,
    _benjamini_hochberg,
    analyse_city_light,
)


def test_selection_default_b_is_2000():
    assert SelectionConfig().n_boot == 2000
    assert Config().bootstrap_samples == 2000


def test_nas_jobs_fix_b_at_2000():
    import app.refresh as refresh
    import app.selection as selection
    import app.worker as worker

    assert "n_boot=2000" in inspect.getsource(worker.execute)
    assert "n_boot=200" not in inspect.getsource(worker.execute).replace(
        "n_boot=2000", ""
    )
    assert "n_boot=2000" in inspect.getsource(refresh.refresh)
    # Default über die Signatur prüfen (nicht über __defaults__: die
    # Parameterreihenfolge darf sich ändern, B=2000 darf es nicht).
    assert (
        inspect.signature(selection.build_selection).parameters["n_boot"].default
        == 2000
    )


def test_bh_q_unreachable_at_b200_reachable_at_b2000():
    # Strengster Fall: eine Alternative, zehn H0-wahr (q ≈ p_min * m).
    m = 11
    p200 = np.ones(m)
    p200[0] = 1 / (200 + 1)
    p2000 = np.ones(m)
    p2000[0] = 1 / (2000 + 1)
    q200 = _benjamini_hochberg(p200)
    q2000 = _benjamini_hochberg(p2000)
    assert float(q200.min()) > 0.05
    assert float(q2000.min()) < 0.05


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
