import copy
import json

import numpy as np
import pandas as pd
import pytest
from pandas.testing import assert_frame_equal

from engine.data import normalize_observations, prepare_series
from engine.holidays import _holiday_days, holiday_flags
from engine.selection import (
    cusum_break,
    daily_median_series,
    exp_weights,
    weighted_median,
)
from engine.models import (
    _naive_profile,
    _residual_blocks,
    features,
    fit,
    fit_ar2,
    isotonic_decreasing,
    jump_age_hours,
    noon_law_projection,
    predict,
    project_paths,
    seasonal_scale,
    slots,
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


def test_jump_age_resets_to_unknown_across_missing_prices():
    index = pd.date_range("2026-07-01", periods=7, freq="1h", tz="UTC")
    price = pd.Series([1.70, 1.72, 1.72, np.nan, 1.72, 1.75, 1.75], index=index)

    np.testing.assert_allclose(
        jump_age_hours(price),
        [168.0, 0.0, 1.0, 168.0, 168.0, 0.0, 1.0],
    )


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


def test_holiday_flags_use_local_day_and_degrade_without_subdivision(cfg):
    times = pd.date_range("2026-10-02 12:00", periods=3, freq="D", tz=cfg.timezone)
    flags, source = holiday_flags(times, "HE", cfg.timezone)
    np.testing.assert_array_equal(flags, [0.0, 1.0, 0.0])
    assert source == "holidays:HE"  # 03.10.: bundesweiter Feiertag

    flags, source = holiday_flags(times, None, cfg.timezone)
    np.testing.assert_array_equal(flags, np.zeros(3))
    assert source == "none"


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


def test_predict_return_paths_matches_classic_and_masks_unsupported(series, cfg):
    """P-Seite (Konzept §4): ``return_paths=True`` liefert die volle Verteilung.

    Das klassische Ergebnis ist identisch; die Pfade haben Shape
    (B, Zeitpunkte) und sind an ungestützten Punkten NaN — damit kann der
    Decision Layer „P = 0“ von „keine Aussage“ unterscheiden.
    """
    model = fit(series, "2026-08-01", cfg)
    classic = predict(model)
    result, paths = predict(model, return_paths=True)
    assert_frame_equal(result, classic)
    assert paths.shape == (cfg.bootstrap_samples, len(classic))
    supported = classic["supported"].to_numpy()
    # Der Median der Pfade reproduziert q50 an gestützten Punkten.
    q50 = np.nanquantile(paths[:, supported], 0.5, axis=0)
    np.testing.assert_allclose(
        q50, classic.loc[supported, "q50"].to_numpy(), rtol=1e-9, atol=1e-9
    )
    # Ungestützte Punkte (hier: Nachtstunden) sind in den Pfaden NaN.
    if not supported.all():
        assert np.isnan(paths[:, ~supported]).all()


def test_predict_return_paths_index_subset_matches(series, cfg):
    model = fit(series, "2026-08-01", cfg)
    full, full_paths = predict(model, return_paths=True)
    segment = full.index[144:]
    partial, partial_paths = predict(model, index=segment, return_paths=True)
    assert_frame_equal(partial, full.loc[segment])
    np.testing.assert_allclose(
        partial_paths, full_paths[:, 144:], rtol=1e-9, atol=1e-9, equal_nan=True
    )


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


# --- B15/B16: Laufzeit-Optimierungen (bitgleich gegen die frühere Implementierung)


def test_project_paths_dedup_is_bitwise_identical(cfg):
    """B15: Deduplizierte 12-Uhr-Projektion == skalare Projektion je Pfad.

    Referenz ist die frühere Implementierung (Projektion jedes einzelnen
    Pfads). Die deduplizierte Fassung muss exakt identisch sein — auch mit
    NaN-Lücken als Barriere, ganzen NaN-Zeilen und Zeilen, die sich je
    Segment wiederholen (dort greift die Deduplizierung).
    """
    for index in (
        # Mitternachts-Origin (Backtest-Folds): zwei volle 12-Uhr-Segmente.
        pd.date_range("2026-08-01T00:00:00+02:00", periods=2 * 288, freq="5min"),
        # Tages-Origin 14:45 (Live): ein angefangenes plus ein weiteres Segment.
        pd.date_range("2026-08-01T14:45:00+02:00", periods=288, freq="5min"),
    ):
        rng = np.random.default_rng(7)
        templates = []
        for shift in (0.0, 0.01, 0.02):
            row = 1.70 + shift - 0.001 * np.arange(len(index))
            row[140:150] += 0.02  # unerlaubter Nachmittagsanstieg → PAVA arbeitet
            row[60:70] = np.nan  # Lücke als Barriere
            templates.append(row)
        rows = np.stack([templates[rng.integers(0, 3)] for _ in range(120)])
        rows[::6] = np.nan  # ganze NaN-Zeilen: NaN != NaN in np.unique
        reference = np.stack(
            [noon_law_projection(rows[s], index, cfg) for s in range(len(rows))]
        )
        np.testing.assert_array_equal(project_paths(rows, index, cfg), reference)


def test_residual_blocks_match_pivot_reference(cfg):
    """B16(a+c): factorize/Index-Zuweisung == pivot_table(aggfunc="median")."""
    index = pd.date_range(
        "2026-07-18", "2026-08-01", freq="5min", inclusive="left", tz="UTC"
    )
    rng = np.random.default_rng(3)
    residual = rng.normal(0, 0.01, len(index))
    residual[::37] = np.nan
    blocks = _residual_blocks(index, residual, cfg)
    reference = (
        pd.DataFrame(
            {
                "day": index.tz_convert(cfg.timezone).strftime("%Y-%m-%d"),
                "slot": slots(index, cfg),
                "error": residual,
            }
        )
        .pivot_table(index="day", columns="slot", values="error", aggfunc="median")
        .reindex(columns=range(288))
        .to_numpy()
    )
    np.testing.assert_array_equal(blocks, reference)


def test_naive_profile_matches_groupby_reference(cfg):
    """B16(d): searchsorted-letzter-Wert == groupby(…).agg(lambda g: g.iloc[-1])."""
    # Vortag plus Anbruch des Folgetags: Slots kommen teils doppelt vor.
    index = pd.date_range(
        "2026-08-01T00:00:00+02:00",
        "2026-08-02T14:45:00+02:00",
        freq="5min",
        inclusive="left",
    )
    rng = np.random.default_rng(5)
    values = rng.normal(1.7, 0.01, len(index))
    values[::13] = np.nan
    recent = pd.Series(values, index=index)
    naive = _naive_profile(recent, cfg)
    reference = (
        pd.Series(recent.to_numpy(), index=slots(recent.index, cfg))
        .groupby(level=0)
        .agg(lambda group: group.iloc[-1])
        .reindex(range(288))
        .to_numpy()
    )
    np.testing.assert_array_equal(naive, reference)


def test_holiday_flags_searchsorted_matches_set_membership(cfg):
    """B16(b): searchsorted-Feiertagsmaske == Set-Mitgliedschaft je Tag."""
    for subdiv, start in (
        ("HE", "2026-09-20"),
        ("BY", "2025-12-20"),
        ("NW", "2026-04-25"),
    ):
        index = pd.date_range(start, periods=40 * 288, freq="5min", tz=cfg.timezone)
        flags, source = holiday_flags(index, subdiv, cfg.timezone)
        local = index.tz_convert(cfg.timezone).tz_localize(None)
        years = (int(local.year.min()), int(local.year.max()))
        days = _holiday_days(subdiv, *years)
        if days is None:
            assert source == "none"
            continue
        reference = np.asarray([d in days for d in local.normalize()], dtype=float)
        np.testing.assert_array_equal(flags, reference)
        assert source == f"holidays:{subdiv}"
