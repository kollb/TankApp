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
    isotonic_decreasing,
    noon_law_projection,
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
    # Teilraster == Ausschnitt des Vollrasters, wenn der Schnitt ganze
    # Segmente der 12-Uhr-Regel überdeckt (PAV-Pools koppeln nur innerhalb
    # eines Segments). [144:288] ist exakt das Nachmittagssegment (lokale
    # 12:00–23:55 Uhr) und damit ein legaler Schnitt.
    segment = 144
    partial = predict(model, index=full.index[segment:])
    assert_frame_equal(full.iloc[segment:], partial)


def test_forecast_before_cutoff_rejected(series, cfg):
    model = fit(series, "2026-08-01", cfg)
    with pytest.raises(ValueError, match="Prognoseraster"):
        predict(
            model, index=pd.date_range("2026-07-31", periods=5, freq="5min", tz="UTC")
        )


def test_isotonic_decreasing_pooling():
    # Non-increasing input is unchanged.
    descending = np.array([1.5, 1.4, 1.4, 1.2, 1.0])
    np.testing.assert_array_equal(isotonic_decreasing(descending), descending)
    # A rising run is pooled with its left neighbours into a flat block:
    # the pool value is the weighted mean of the merged run.
    out = isotonic_decreasing(np.array([1.0, 1.0, 1.2, 1.2, 1.0, 0.9]))
    assert np.all(np.diff(out) <= 1e-12)
    np.testing.assert_allclose(out, [1.1, 1.1, 1.1, 1.1, 1.0, 0.9])
    # NaNs stay NaN and act as a barrier (no bridging across gaps).
    out_nan = isotonic_decreasing(np.array([1.0, np.nan, 1.1, 0.9]))
    assert np.isnan(out_nan[1]) and out_nan[2] == 1.1 and out_nan[3] == 0.9


def test_features_include_noon_step(cfg):
    index = pd.date_range("2026-08-01T06:00:00+02:00", periods=288, freq="5min")
    x = features(index, cfg)
    assert x.shape == (288, 12)
    step = x[:, -1]
    # Before the law started the step is 0 even in the afternoon.
    pre = features(
        pd.date_range("2026-03-01T06:00:00+01:00", periods=288, freq="5min"), cfg
    )
    assert np.all(pre[:, -1] == 0)
    # After the law: 0 before 12:00, 1 from 12:00 on.
    local = index.tz_convert(cfg.timezone)
    expected = np.asarray(local.hour >= 12, dtype=float)
    np.testing.assert_array_equal(step, expected)


def test_noon_law_projection_flattens_illegal_afternoon_rise(cfg):
    index = pd.date_range("2026-08-01T00:00:00+02:00", periods=2 * 288, freq="5min")
    values = np.full(len(index), 1.0)
    local = index.tz_convert(cfg.timezone)
    rise_start = index.get_loc(pd.Timestamp("2026-08-01T14:00:00+02:00"))
    rise_end = index.get_loc(pd.Timestamp("2026-08-01T15:00:00+02:00"))
    values[rise_start:rise_end] = 1.05  # illegal: rise after 12:00
    projected = noon_law_projection(values, index, cfg)
    assert not np.allclose(projected, values)
    # The whole segment [12:00 08-01, 12:00 08-02) must end up non-increasing.
    seg_start = index.get_loc(pd.Timestamp("2026-08-01T12:00:00+02:00"))
    seg_end = index.get_loc(pd.Timestamp("2026-08-02T12:00:00+02:00"))
    seg = projected[seg_start:seg_end]
    assert np.all(np.diff(seg) <= 1e-12)
    _ = local


def test_noon_law_projection_keeps_legal_noon_jump_and_pre_law(cfg):
    # A jump exactly at 12:00 is legal and must survive the projection.
    index = pd.date_range("2026-08-01T06:00:00+02:00", periods=288, freq="5min")
    values = np.full(len(index), 1.0)
    noon = index.get_loc(pd.Timestamp("2026-08-01T12:00:00+02:00"))
    values[noon:] = 1.04
    projected = noon_law_projection(values, index, cfg)
    assert projected[noon] == 1.04
    assert projected[noon - 1] == 1.0
    # Pre-law history is left completely untouched (no structural claim).
    pre = pd.date_range("2026-03-01T06:00:00+01:00", periods=288, freq="5min")
    rising = np.linspace(1.0, 1.2, 288)
    np.testing.assert_array_equal(noon_law_projection(rising, pre, cfg), rising)


def test_noon_law_projection_keeps_nan_and_short_input(cfg):
    index = pd.date_range("2026-08-01T12:00:00+02:00", periods=10, freq="5min")
    values = np.array([1.0, np.nan, 1.1, 1.2, 1.0, np.nan, 0.9, 0.8, np.nan, 0.7])
    projected = noon_law_projection(values, index, cfg)
    assert np.isnan(projected[1]) and np.isnan(projected[5]) and np.isnan(projected[8])
    # Inner rise 1.1 → 1.2 is pooled; the NaN gap is a barrier (Lücken
    # bleiben Lücken: keine Kopplung über unbekannte Intervalle hinweg).
    np.testing.assert_allclose(projected[2:4], [1.15, 1.15])
    for run in (projected[2:5], projected[6:8], projected[9:10]):
        assert np.all(np.diff(run) <= 1e-12)
    np.testing.assert_array_equal(
        noon_law_projection(np.array([1.0]), index[:1], cfg), [1.0]
    )


def _noon_step_observations(violate_day=None):
    """Deterministische 12-Uhr-Struktur: Tagesabfall + erlaubter 12-Uhr-Sprung.

    ``violate_day`` injiziert an einem Tag einen unerlaubten Anstieg um 15:00.
    """
    index = pd.date_range("2026-07-01T00:00:00+02:00", periods=35 * 288, freq="5min")
    hour = np.asarray(index.hour + index.minute / 60)
    price = 1.70 - 0.02 * hour / 24 + np.where(hour >= 12, 0.03, 0.0)
    if violate_day is not None:
        day = index.date == violate_day
        afternoon = np.asarray(index.hour >= 15, dtype=day.dtype)
        price = price + np.where(day & afternoon, 0.02, 0.0)
    return pd.DataFrame(
        {
            "timestamp": index.astype(str),
            "city": "Testmarkt",
            "station_id": "station-1",
            "station_name": "Teststation",
            "fuel": "E10",
            "price": np.round(price, 3),
            "status": "open",
            "source": "influxdb",
        }
    )


def test_legal_noon_rises_are_not_flagged_as_irregular(cfg):
    rows, _ = normalize_observations(_noon_step_observations(), cfg)
    model = fit(prepare_series(rows, cfg)[0], "2026-08-01", cfg)
    assert model["law_rise_outside_noon"] == 0
    forecast = predict(model)
    values = forecast["harmonic_ar2"].to_numpy()
    local = forecast.index.tz_convert(cfg.timezone)
    for segment in (local.hour < 12, local.hour >= 12):
        part = values[np.asarray(segment)]
        part = part[np.isfinite(part)]
        assert np.all(np.diff(part) <= 1e-9)
    quantiles = forecast.loc[forecast.supported, ["q025", "q50", "q975"]].to_numpy()
    assert np.all(np.diff(quantiles, axis=1) >= 0)


def test_non_noon_rise_is_counted_and_forecast_stays_legal(cfg):
    rows, _ = normalize_observations(
        _noon_step_observations(violate_day=pd.Timestamp("2026-07-20").date()), cfg
    )
    model = fit(prepare_series(rows, cfg)[0], "2026-08-01", cfg)
    # Der injizierte 15:00-Anstieg ist der einzige illegale Sprung: der
    # Rückfall um Mitternacht ist eine Senkung (immer erlaubt).
    assert model["law_rise_outside_noon"] == 1
    forecast = predict(model)
    values = forecast["harmonic_ar2"].to_numpy()
    local = forecast.index.tz_convert(cfg.timezone)
    for segment in (local.hour < 12, local.hour >= 12):
        part = values[np.asarray(segment)]
        part = part[np.isfinite(part)]
        assert np.all(np.diff(part) <= 1e-9)


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
