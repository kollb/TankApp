"""B3 — Day-Pair-Bootstrap und publizierter Kern profile_ar2."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.config import Settings
from engine.config import Config
from engine.models import (
    DAY_PAIR_SALT,
    SHARED_DRAW_SALT,
    _day_pair_starts,
    draw_day_blocks,
    fit,
    predict,
    shared_day_uniforms,
)


def test_day_pair_off_zieht_tage_unabhaengig():
    cfg = Config(seed=7, bootstrap_samples=200)
    rng = np.random.default_rng(cfg.seed)
    draws = draw_day_blocks(
        n_forecast_days=3,
        n_blocks=10,
        n_samples=200,
        block_weights=None,
        shared_draws=False,
        day_pair=False,
        cfg=cfg,
        hours=72,
        rng=rng,
    )
    assert draws.shape == (200, 3)
    # Unabhängige Tage: Differenz ist nicht fest 1.
    assert not np.all(draws[:, 1] == draws[:, 0] + 1)


def test_day_pair_zieht_aufeinanderfolgende_bloecke():
    cfg = Config(seed=7, bootstrap_samples=200)
    rng = np.random.default_rng(cfg.seed)
    draws = draw_day_blocks(
        n_forecast_days=3,
        n_blocks=10,
        n_samples=200,
        block_weights=None,
        shared_draws=False,
        day_pair=True,
        cfg=cfg,
        hours=72,
        rng=rng,
    )
    assert np.all(draws[:, 1] == draws[:, 0] + 1)
    # Dritter Tag ist der Rest und unabhängig vom Paar.
    assert not np.all(draws[:, 2] == draws[:, 1] + 1)


def test_day_pair_shared_ableitbar():
    cfg = Config(seed=5, bootstrap_samples=100)
    rng_a = np.random.default_rng(0)
    rng_b = np.random.default_rng(99)
    a = draw_day_blocks(
        n_forecast_days=2,
        n_blocks=8,
        n_samples=100,
        block_weights=None,
        shared_draws=True,
        day_pair=True,
        cfg=cfg,
        hours=48,
        rng=rng_a,
    )
    b = draw_day_blocks(
        n_forecast_days=2,
        n_blocks=8,
        n_samples=100,
        block_weights=None,
        shared_draws=True,
        day_pair=True,
        cfg=cfg,
        hours=48,
        rng=rng_b,
    )
    np.testing.assert_array_equal(a, b)
    assert not np.array_equal(
        shared_day_uniforms(cfg, 48, 0, salt=DAY_PAIR_SALT),
        shared_day_uniforms(cfg, 48, 0, salt=SHARED_DRAW_SALT),
    )


def test_regime_kante_nimmt_paar_heraus():
    dates = np.array(["2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01"])
    starts = _day_pair_starts(4, dates, {"2026-07-31"})
    assert starts.tolist() == [0, 2]


def test_predict_day_pair_aus_ist_bitgleich(series, cfg):
    origin = series.frame.index.max().floor("5min") + pd.Timedelta(minutes=5)
    model = fit(series, origin, cfg)
    off = predict(model, hours=72, return_paths=True, day_pair=False)
    default = predict(model, hours=72, return_paths=True)
    np.testing.assert_array_equal(off[0]["q50"].to_numpy(), default[0]["q50"].to_numpy())
    np.testing.assert_array_equal(off[1], default[1])


def test_day_pair_hebt_tagesminima_korrelation(series, cfg):
    origin = series.frame.index.max().floor("5min") + pd.Timedelta(minutes=5)
    model = fit(series, origin, cfg)
    # Starke Tagesniveaus in den Residuen: aufeinanderfolgende Trainingstage
    # teilen ein ähnliches Niveau — genau das, was unabhängige Ziehungen
    # zerreißen.
    blocks = np.asarray(model["residual_blocks"], dtype=float)
    n = len(blocks)
    for i in range(n):
        # Paare (0,1), (2,3), … teilen dasselbe Niveau.
        blocks[i] = (i // 2) * 0.05
    model = dict(model)
    model["residual_blocks"] = blocks
    model["profile_blocks"] = blocks

    def day_min_corr(day_pair: bool) -> float:
        frame, paths = predict(
            model, hours=72, return_paths=True, day_pair=day_pair, shared_draws=False
        )
        days = frame.index.tz_convert("Europe/Berlin").strftime("%Y-%m-%d")
        unique = np.unique(days)
        assert len(unique) >= 2
        a = np.nanmin(paths[:, days == unique[0]], axis=1)
        b = np.nanmin(paths[:, days == unique[1]], axis=1)
        mask = np.isfinite(a) & np.isfinite(b)
        return float(np.corrcoef(a[mask], b[mask])[0, 1])

    independent = day_min_corr(False)
    paired = day_min_corr(True)
    assert paired > independent + 0.2
    assert paired > 0.5


def test_settings_defaults_sind_profile_ar2_und_day_pair(monkeypatch, tmp_path):
    monkeypatch.setenv("TANKAPP_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("TANKAPP_MODEL_KIND", raising=False)
    monkeypatch.delenv("TANKAPP_DAYPAIR", raising=False)
    settings = Settings.from_env()
    assert settings.model_kind == "profile_ar2"
    assert settings.day_pair is True
    monkeypatch.setenv("TANKAPP_DAYPAIR", "0")
    monkeypatch.setenv("TANKAPP_MODEL_KIND", "ensemble")
    settings = Settings.from_env()
    assert settings.day_pair is False
    assert settings.model_kind == "ensemble"


def test_ensemble_artefakt_zeigt_horizont_gewichte_als_folgepunkt(series, cfg):
    origin = series.frame.index.max().floor("5min") + pd.Timedelta(minutes=5)
    model = fit(series, origin, cfg)
    hw = model["ensemble"]["horizon_weights"]
    assert hw["status"] == "not_estimated"
    assert hw["24h"] is None and hw["72h"] is None and hw["168h"] is None
