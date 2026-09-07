import copy
import json

import numpy as np
import pandas as pd
import pytest
from pandas.testing import assert_frame_equal

from engine.data import normalize_observations, prepare_series
from engine.models import (
    features,
    fit,
    fit_ar2,
    predict,
    seasonal_scale,
    utc_time,
    validate_model,
)
from engine.storage import json_safe, write_json


def test_harmonic_fit_ar_stability_and_non_crossing_quantiles(series, cfg):
    model = fit(series, "2026-08-01", cfg)
    phi = model["ar_phi"]
    assert np.max(np.abs(np.roots([1, -phi[0], -phi[1]]))) < 0.98
    forecast = predict(model)
    assert len(forecast) == 288
    quantiles = forecast.loc[forecast.supported, ["q025", "q10", "q50", "q90", "q975"]]
    assert np.all(np.diff(quantiles.to_numpy(), axis=1) >= 0)
    assert not forecast.loc[
        forecast.index.tz_convert(cfg.timezone).hour < 6, "supported"
    ].any()
    assert model["calibrated"] is model["decision_ready"] is False


def test_no_future_leakage_in_fit(observations, cfg):
    raw = observations()
    first, _ = normalize_observations(raw, cfg)
    original = fit(prepare_series(first, cfg)[0], "2026-08-01", cfg)
    raw.loc[
        pd.to_datetime(raw.timestamp, utc=True) >= utc_time("2026-08-01"), "price"
    ] = 3.1
    changed, _ = normalize_observations(raw, cfg)
    modified = fit(prepare_series(changed, cfg)[0], "2026-08-01", cfg)
    assert json_safe(original) == json_safe(modified)
    assert_frame_equal(predict(original), predict(modified))


def test_price_after_cutoff_not_shifted_back_into_training(observations, cfg):
    raw = observations(days=20)
    raw.loc[len(raw)] = {
        **raw.iloc[-1].to_dict(),
        "timestamp": "2026-07-21T00:00:01+02:00",
        "price": 4.5,
    }
    normalized, _ = normalize_observations(raw, cfg)
    model = fit(prepare_series(normalized, cfg)[0], "2026-07-21", cfg)
    assert utc_time(model["last_observation"]) < utc_time(model["origin"])
    assert np.max(predict(model).q50) < 2.0


def test_stale_end_resets_ar_state(series, cfg):
    cutoff = utc_time("2026-08-01")
    series.frame.loc[series.frame.index >= cutoff - pd.Timedelta(hours=2), "price"] = (
        np.nan
    )
    model = fit(series, cutoff, cfg)
    np.testing.assert_array_equal(model["ar_state"], [0, 0])


def test_ar_does_not_bridge_gaps_or_fit_short_data():
    residual = np.tile([1.0, np.nan, 1.0, np.nan], 100)
    np.testing.assert_array_equal(fit_ar2(residual), [0, 0])
    np.testing.assert_array_equal(fit_ar2(np.array([1.0])), [0, 0])


def test_artifact_round_trip_is_deterministic(series, cfg, tmp_path):
    model = fit(series, "2026-08-01", cfg)
    path = tmp_path / "model.json"
    write_json(path, model)
    text = path.read_text()
    assert "NaN" not in text and "Infinity" not in text
    restored = json.loads(text)
    assert_frame_equal(predict(model, 72), predict(restored, 72))
    assert not list(tmp_path.glob("*.tmp"))


def test_failed_atomic_write_preserves_last_good_artifact(tmp_path):
    path = tmp_path / "model.json"
    write_json(path, {"ok": 1})
    with pytest.raises(TypeError):
        write_json(path, {"not_serializable": object()})
    assert json.loads(path.read_text()) == {"ok": 1}
    assert len(list(tmp_path.iterdir())) == 1


@pytest.mark.parametrize(
    "key,value",
    [
        ("schema_version", 999),
        ("beta", [0]),
        ("ar_phi", [2, 1]),
        ("calibrated", True),
        ("residual_blocks", [[0]]),
        ("naive_profile", [0]),
    ],
)
def test_invalid_or_misleading_artifacts_rejected(series, cfg, key, value):
    model = json_safe(fit(series, "2026-08-01", cfg))
    model[key] = value
    with pytest.raises(ValueError):
        validate_model(model)


def test_future_or_inconsistent_training_metadata_rejected(series, cfg):
    model = json_safe(fit(series, "2026-08-01", cfg))
    changed = copy.deepcopy(model)
    changed["last_observation"] = "2030-01-01T00:00:00Z"
    with pytest.raises(ValueError, match="Beobachtung"):
        validate_model(changed)
    model["training_end_exclusive"] = "2030-01-01T00:00:00Z"
    with pytest.raises(ValueError, match="Cutoff"):
        validate_model(model)


def test_short_history_does_not_generate_a_dummy_forecast(observations, cfg):
    rows, _ = normalize_observations(observations(days=3), cfg)
    with pytest.raises(ValueError, match="mindestens"):
        fit(prepare_series(rows, cfg)[0], "2026-07-04", cfg)


def test_constant_seasonal_scale_is_undefined(cfg):
    index = pd.date_range("2026-07-01", periods=5 * 288, freq="5min", tz="UTC")
    assert seasonal_scale(pd.Series(1.7, index=index), cfg) is None


def test_local_clock_features_survive_dst(cfg):
    times = pd.DatetimeIndex(["2026-03-28T06:00:00+00:00", "2026-03-29T05:00:00+00:00"])
    x = features(times, cfg)
    np.testing.assert_allclose(x[0, :5], x[1, :5])


def test_sparse_forecast_grid_advances_ar_from_origin(series, cfg):
    model = fit(series, "2026-08-01", cfg)
    full = predict(model)
    partial = predict(model, index=full.index[75:100])
    assert_frame_equal(full.iloc[75:100], partial)


def test_forecast_before_cutoff_rejected(series, cfg):
    model = fit(series, "2026-08-01", cfg)
    with pytest.raises(ValueError, match="Prognoseraster"):
        predict(
            model, index=pd.date_range("2026-07-31", periods=5, freq="5min", tz="UTC")
        )


@pytest.mark.parametrize("value", ["2026-03-29T02:30:00", "2026-10-25T02:30:00"])
def test_ambiguous_cli_cutoff_is_an_actionable_value_error(value):
    with pytest.raises(ValueError, match="UTC-Offset"):
        utc_time(value)


def test_fit_at_night_handles_dst_gap_in_previous_day(observations, cfg):
    raw = observations(days=35, start="2026-03-01")
    raw["status"] = "open"
    rows, _ = normalize_observations(raw, cfg)
    model = fit(prepare_series(rows, cfg)[0], "2026-03-30T02:30:00+02:00", cfg)
    assert predict(model).q50.notna().all()
