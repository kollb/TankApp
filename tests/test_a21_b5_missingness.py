"""A21-B5.2 (#212): Missingness-Messung, Policy-Baselines und Ablation.

Abnahme: NaN-Residuen→0 bleibt Default (12-Uhr-Integrität), ist aber
messbar (effective_draws/null_fill_share je Zeitpunkt) und gegen die beiden
ehrlichen Baselines (kein Release bei zu wenig Support / kohärente
Blockauswahl) paarweise bei gleichem Seed reproduzierbar vergleichbar.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from engine.config import Config
from engine.data import PriceSeries
from engine.models import fit, fill_residual_draws, predict

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "tankapp_ablation_missingness", ROOT / "data-tools/ablation_missingness.py"
)
ablation = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ablation)


def test_fill_residual_draws_zero_fill_is_default_and_measures():
    drawn = np.array(
        [
            [1.0, np.nan, 3.0],
            [np.nan, np.nan, np.nan],
            [4.0, 5.0, 6.0],
        ]
    )
    filled, info = fill_residual_draws(drawn)
    assert info["policy"] == "zero_fill"
    np.testing.assert_allclose(filled, [[1.0, 0.0, 3.0], [0, 0, 0], [4, 5, 6]])
    np.testing.assert_array_equal(info["effective_draws"], [2, 1, 2])
    np.testing.assert_allclose(info["null_fill_share"], [1 / 3, 2 / 3, 1 / 3])
    # Default-Schwelle: mind. die Hälfte der 3 Draws (aufgerundet = 2).
    assert info["min_effective_draws"] == 2
    np.testing.assert_array_equal(info["release_ok"], [True, False, True])


def test_fill_residual_draws_coherent_block_drops_whole_days():
    drawn = np.array(
        [
            [1.0, np.nan, 3.0],
            [np.nan, np.nan, np.nan],
            [4.0, 5.0, 6.0],
        ]
    )
    filled, info = fill_residual_draws(drawn, policy="coherent_block")
    # Zeilen 0/1 haben Lücken → als Ganzes reine Struktur (0); Zeile 2 bleibt
    # unangetastet — nie ein halb echter, halb gefüllter Tag.
    np.testing.assert_allclose(filled, [[0, 0, 0], [0, 0, 0], [4, 5, 6]])
    # Die Messung zeigt die Lücken weiter ungeschönt.
    np.testing.assert_array_equal(info["effective_draws"], [2, 1, 2])


def test_fill_residual_draws_no_release_flags_thin_support():
    drawn = np.array([[1.0, np.nan, 3.0], [4.0, 5.0, 6.0], [7.0, 8.0, 9.0]])
    _, info = fill_residual_draws(drawn, policy="no_release", min_effective_draws=3)
    np.testing.assert_array_equal(info["release_ok"], [True, False, True])
    _, wide = fill_residual_draws(drawn, policy="no_release", min_effective_draws=1)
    assert wide["release_ok"].all()


def test_fill_residual_draws_rejects_unknown_policy_and_shape():
    with pytest.raises(ValueError, match="Unbekannte Missingness-Policy"):
        fill_residual_draws(np.zeros((2, 2)), policy="egal")
    with pytest.raises(ValueError, match="n_samples, n_slots"):
        fill_residual_draws(np.zeros(4))


@pytest.fixture(scope="module")
def fitted():
    """Kleiner deterministischer Fit + unveränderte Residuen-Blöcke."""
    cfg = Config(
        train_days=32,
        min_train_days=28,
        bootstrap_samples=100,
        seed=11,
        price_law_local="2020-01-01T00:00",
    )
    series = ablation.synthetic_series(start="2026-05-01T00:00", days=36, seed=11)
    origin = series.index[32 * 288]
    model = fit(
        PriceSeries(
            city="Ablation",
            station_id="synthetic-1",
            station_name="Synthetisch",
            fuel="E10",
            frame=ablation.price_series_frame(series),
        ),
        origin,
        cfg,
    )
    return model, np.asarray(model["residual_blocks"], dtype=float)


def test_predict_policies_are_identical_without_gaps(fitted):
    model, blocks = fitted
    # Randtage des Trainingsfensters sind real teilweise unbelegt (erster/
    # letzter Tag) — echte Lücken gibt es ohne Korruption nicht.
    assert blocks.shape == (33, 288)
    base = predict(model, 24, kind="profile_ar2")
    default = predict(model, 24, kind="profile_ar2", missingness_policy="zero_fill")
    pd.testing.assert_frame_equal(base, default)
    for policy in ("coherent_block", "no_release"):
        same = predict(model, 24, kind="profile_ar2", missingness_policy=policy)
        pd.testing.assert_frame_equal(base, same)
    # Nur die Rand-Imputation der unbelegten Slots — keine systematischen
    # Lücken; die Default-Schwelle wird dort nicht ausgelöst.
    assert base["null_fill_share"].max() < 0.1
    assert base["effective_draws"].min() > 50


def test_predict_measures_fills_and_no_release_blocks_thin_points(fitted):
    model, blocks = fitted
    mask = np.zeros(blocks.shape, dtype=bool)
    mask[::3, 0:72] = True  # jede 3. Zeile: Nachtslots 00:00–06:00
    corrupted = ablation.apply_gaps(model, mask)

    quiet: dict = {}
    released = predict(
        corrupted,
        24,
        kind="profile_ar2",
        missingness_policy="zero_fill",
        diagnostics=quiet,
    )
    bad = released["null_fill_share"] > 0
    assert bool(bad.any()), "Ablation muss messbare Imputationen erzeugen"
    assert (released.loc[bad, "effective_draws"] < 100).all()
    # zero_fill (Default) veröffentlicht weiter — Verhalten wie bisher.
    assert released.loc[bad, "q50"].notna().all()
    assert quiet["missingness"]["policy"] == "zero_fill"
    assert quiet["missingness"]["null_fill_share_max"] > 0
    assert quiet["missingness"]["release_ok_all"] is True

    blocked = predict(
        corrupted,
        24,
        kind="profile_ar2",
        missingness_policy="no_release",
        min_effective_draws=100,
    )
    # Baseline „kein Release": Punkte mit auch nur einer Nullimputation sind
    # ehrlich nicht freigegeben (NaN statt imputierter Scheinschärfe).
    assert blocked.loc[bad, "q50"].isna().all()
    assert blocked.loc[~bad, "q50"].notna().all()


def test_predict_coherent_block_diverges_on_partial_days(fitted):
    model, blocks = fitted
    mask = np.zeros(blocks.shape, dtype=bool)
    mask[::3, 36:48] = True  # halb belegte Tage: nur Mittagsslots fehlen
    corrupted = ablation.apply_gaps(model, mask)
    per_cell = predict(
        corrupted, 24, kind="profile_ar2", missingness_policy="zero_fill"
    )
    coherent = predict(
        corrupted, 24, kind="profile_ar2", missingness_policy="coherent_block"
    )
    quantile_cols = ["q025", "q10", "q50", "q90", "q975"]
    assert not np.allclose(
        per_cell[quantile_cols].to_numpy(),
        coherent[quantile_cols].to_numpy(),
        equal_nan=True,
    )


def test_ablation_runs_are_paired_and_reproducible(tmp_path):
    kw = dict(
        seed=7,
        history_days=32,
        bootstrap_samples=100,
        hours=24,
        scenarios=("clean", "isolated_slots", "nas_catchup"),
        policies=("zero_fill", "coherent_block", "no_release"),
    )
    rows_a = ablation.run_ablation(**kw)
    rows_b = ablation.run_ablation(**kw)
    assert len(rows_a) == 9
    csv_a, md_a = ablation.write_report(rows_a, tmp_path / "a", seed=7)
    csv_b, md_b = ablation.write_report(rows_b, tmp_path / "b", seed=7)
    # Gleicher Seed → byte-identischer Bericht (reproduzierbares Messartefakt).
    assert csv_a.read_bytes() == csv_b.read_bytes()
    assert md_a.read_bytes() == md_b.read_bytes()
    text = md_a.read_text(encoding="utf-8")
    for needle in ("isolated_slots", "nas_catchup", "zero_fill", "no_release"):
        assert needle in text
    # clean/zero_fill ist die Referenz: nur Rand-Imputationen der unbelegten
    # Trainingsrandtage; jede echte Lücke misst streng darüber.
    clean = next(r for r in rows_a if r["scenario"] == "clean")
    assert clean["null_fill_share_max"] < 0.1
    gapped = next(
        r
        for r in rows_a
        if r["scenario"] == "isolated_slots" and r["policy"] == "zero_fill"
    )
    assert gapped["null_fill_share_max"] > clean["null_fill_share_max"]
    assert gapped["effective_draws_min"] < clean["effective_draws_min"]
