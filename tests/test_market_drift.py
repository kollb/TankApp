"""P1: Mehr-Tages-Marktdrift getrennt vom Intraday-Profil."""

import numpy as np
import pandas as pd

from engine.data import normalize_observations, prepare_series
from engine.models import (
    MARKET_DRIFT_CAP_EUR_PER_DAY,
    fit,
    market_drift,
    predict,
    validate_model,
)


def _trend_frame(days: int, slope_per_day: float, start="2026-07-01"):
    """Konstantes Tagesprofil plus linearer Tagesanstieg (1,5 ct/Tag)."""
    index = pd.date_range(start, periods=days * 288, freq="5min", tz="Europe/Berlin")
    hour = np.asarray(index.hour + index.minute / 60)
    day = np.arange(len(index)) / 288
    price = 1.70 + 0.04 * np.cos(hour * 2 * np.pi / 24) + slope_per_day * day
    return pd.DataFrame(
        {
            "timestamp": index.astype(str),
            "city": "Testmarkt",
            "station_id": "station-1",
            "station_name": "Teststation",
            "fuel": "E10",
            "price": price,
            "status": np.where(hour >= 6, "open", "closed"),
            "source": "influxdb",
        }
    )


def _series(frame, cfg):
    normalized, _ = normalize_observations(frame, cfg)
    return prepare_series(normalized, cfg)[0]


def test_drift_detects_upward_trend_and_is_capped(cfg):
    frame = _trend_frame(14, 0.015 / 1.0)  # 1,5 ct je Tag
    series = _series(frame, cfg)
    origin = pd.Timestamp("2026-07-14 10:00", tz="Europe/Berlin")
    drift = market_drift(series.frame.price, origin, cfg)
    assert drift["method"] == "theil_sen"
    assert drift["n_days"] == 5
    assert 0.0 < drift["eur_per_day"] <= MARKET_DRIFT_CAP_EUR_PER_DAY
    assert drift["raw_eur_per_day"] > 0.012


def test_drift_is_zero_without_completed_days(cfg):
    frame = _trend_frame(14, 0.015)
    series = _series(frame, cfg)
    origin = pd.Timestamp("2026-07-01 00:00", tz="Europe/Berlin")
    assert market_drift(series.frame.price, origin, cfg)["eur_per_day"] == 0.0


def test_forecast_tomorrow_not_below_todays_level_in_uptrend(cfg):
    """Vorgabe P1: konstantes Tagesprofil, +1,5 ct/Tag über die letzten 5 Tage.

    Ohne Drift läge die Prognose für morgen unter dem beobachteten Niveau des
    Vortags (Mittelwert-Rückfall der Struktur); mit Drift und Niveau-Lücke nicht.
    """
    index = pd.date_range(
        "2026-07-01", periods=14 * 288, freq="5min", tz="Europe/Berlin"
    )
    t_days = np.arange(len(index)) / 288
    price = 1.70 + 0.015 * np.clip(
        t_days - 9.0, 0.0, None
    )  # Rampe in den letzten 5 Tagen
    frame = pd.DataFrame(
        {
            "timestamp": index.astype(str),
            "city": "Testmarkt",
            "station_id": "station-1",
            "station_name": "Teststation",
            "fuel": "E10",
            "price": price,
            "status": "open",
            "source": "influxdb",
        }
    )
    series = _series(frame, cfg)
    origin = pd.Timestamp("2026-07-14 10:00", tz="Europe/Berlin")
    model = fit(series, origin, cfg)
    validate_model(model)
    assert model["market_drift"]["eur_per_day"] > 0

    horizon = pd.date_range(origin, periods=288 * 2, freq="5min")
    with_drift = predict(model, hours=48, index=horizon, kind="profile_ar2")
    flat = dict(
        model,
        market_drift={**model["market_drift"], "eur_per_day": 0.0, "level_gap_eur": {}},
    )
    without = predict(flat, hours=48, index=horizon, kind="profile_ar2")

    tz = "Europe/Berlin"
    tomorrow = origin.tz_convert(tz).normalize() + pd.Timedelta(days=1)
    window = (with_drift.index >= tomorrow) & (
        with_drift.index < tomorrow + pd.Timedelta(days=1)
    )
    tomorrow_drift = with_drift.loc[window, "q50"].dropna()
    tomorrow_flat = without.loc[window, "q50"].reindex(tomorrow_drift.index)
    # Beobachtetes Niveau des letzten abgeschlossenen Tages (13. Juli).
    yesterday = series.frame.price.dropna()
    yesterday = yesterday[
        (
            yesterday.index.tz_convert(tz).normalize()
            == origin.tz_convert(tz).normalize() - pd.Timedelta(days=1)
        )
    ]
    today_level = float(yesterday.median())

    assert tomorrow_drift.mean() > tomorrow_flat.mean()
    assert (tomorrow_drift.to_numpy() >= tomorrow_flat.to_numpy() - 1e-9).all()
    assert tomorrow_drift.mean() >= today_level
    assert tomorrow_flat.mean() < today_level  # ohne Drift wäre es gefallen


def test_anchor_segment_is_unchanged_by_drift(cfg):
    frame = _trend_frame(14, 0.015)
    series = _series(frame, cfg)
    origin = pd.Timestamp("2026-07-14 10:00", tz="Europe/Berlin")
    model = fit(series, origin, cfg)
    index = pd.date_range(origin, periods=24, freq="5min")  # 10:00 bis 12:00
    with_drift = predict(model, hours=2, index=index, kind="profile_ar2")
    flat = dict(model, market_drift={**model["market_drift"], "eur_per_day": 0.0})
    without = predict(flat, hours=2, index=index, kind="profile_ar2")
    np.testing.assert_allclose(
        with_drift["q50"].to_numpy(), without["q50"].to_numpy(), equal_nan=True
    )


def test_drift_ignores_data_after_cutoff(cfg):
    """PIT: Preise nach dem Cutoff dürfen die Drift nicht beeinflussen."""
    frame = _trend_frame(14, 0.015)
    origin = pd.Timestamp("2026-07-14 10:00", tz="Europe/Berlin")
    past = _series(frame, cfg)
    spoiled = frame.copy()
    later = pd.to_datetime(spoiled["timestamp"]) >= origin
    spoiled.loc[later, "price"] = 3.0
    future = _series(spoiled, cfg)
    assert market_drift(past.frame.price, origin, cfg) == market_drift(
        future.frame.price, origin, cfg
    )
