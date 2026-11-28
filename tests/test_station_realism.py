"""P3: Schließzeit-Puffer und Preis-Stabilität der Stationen."""

import datetime as dt

from app.decide import _alternatives
from app.station_realism import (
    closing_buffer_status,
    effective_price,
    price_stability,
    stability_discount_eur,
)
from app.thresholds import DEFAULT_THRESHOLDS

NOW = dt.datetime(2026, 11, 28, 17, 0, tzinfo=dt.timezone.utc)


def test_closing_in_ten_minutes_with_twelve_minute_travel_is_flagged():
    closes = NOW + dt.timedelta(minutes=10)
    status = closing_buffer_status(closes, NOW, travel_min=12.0)
    assert status["status"] == "closing_soon"
    assert status["required_min"] == 27.0


def test_enough_opening_time_is_ok_and_missing_data_is_unknown():
    assert (
        closing_buffer_status(NOW + dt.timedelta(minutes=60), NOW, 12.0)["status"]
        == "ok"
    )
    assert closing_buffer_status(None, NOW, 12.0)["status"] == "unknown"
    assert (
        closing_buffer_status(NOW + dt.timedelta(minutes=60), NOW, None)["status"]
        == "unknown"
    )


def _station(sid, price, closes_at=None):
    row = {
        "station_id": sid,
        "name": sid,
        "brand": "",
        "price": price,
        "age_minutes": 2,
        "dist_km": 1.0,
        "maps_url": None,
    }
    if closes_at is not None:
        row["closes_at"] = closes_at
    return row


def test_closing_soon_station_is_never_top_recommendation():
    chosen = _station("ref", 1.85)
    closing = _station(
        "closing", 1.60, closes_at=(NOW + dt.timedelta(minutes=10)).isoformat()
    )
    normal = _station("normal", 1.70)
    alts, best = _alternatives(
        [chosen, closing, normal],
        chosen,
        anchor=1.85,
        liters=40.0,
        consumption=7.0,
        speed=5.0,  # ~12 min Anfahrt bei kurzem Umweg
        z_used=10.0,
        th=DEFAULT_THRESHOLDS,
        mode="onroute",
        home=None,
        nowcasts=None,
        now=NOW,
    )
    by_id = {a["station_id"]: a for a in alts}
    assert by_id["closing"]["closing_soon"] is True
    assert by_id["closing"]["closing"]["status"] == "closing_soon"
    assert by_id["closing"]["worth_it"] is False
    assert best is not None and best["station_id"] == "normal"
    # Herabgestuft: die schließende Station steht nach allen offenen.
    assert alts[-1]["station_id"] == "closing"


def test_without_closing_time_nothing_is_filtered():
    chosen = _station("ref", 1.85)
    cheap = _station("cheap", 1.60)
    alts, best = _alternatives(
        [chosen, cheap],
        chosen,
        1.85,
        40.0,
        7.0,
        5.0,
        10.0,
        DEFAULT_THRESHOLDS,
        "onroute",
        None,
        None,
        now=NOW,
    )
    assert alts and alts[0]["closing"]["status"] == "unknown"
    assert best is not None and best["station_id"] == "cheap"


def _series(minutes_low, minutes_high, cycles):
    """Preis-Verlauf: abwechselnd Tief- und Hochphasen (Minuten je Phase)."""
    points, t = [], NOW
    for _ in range(cycles):
        for price, length in ((1.60, minutes_low), (1.80, minutes_high)):
            steps = max(1, int(length // 5))
            for _ in range(steps):
                points.append((t, price))
                t += dt.timedelta(minutes=5)
    return points


def test_flickering_station_gets_small_discount_stable_does_not():
    flicker = price_stability(_series(minutes_low=5, minutes_high=5, cycles=12))
    stable = price_stability(_series(minutes_low=60, minutes_high=60, cycles=8))
    assert flicker["status"] == "measured" and stable["status"] == "measured"
    assert flicker["flicker_share"] > 0.8
    assert stable["held_share"] == 1.0
    assert stable["flicker_share"] == 0.0

    d_flicker = stability_discount_eur(flicker)
    d_stable = stability_discount_eur(stable)
    assert 0.0 < d_flicker <= 0.01
    assert d_stable == 0.0
    assert effective_price(1.70, flicker) > 1.70
    assert effective_price(1.70, stable) == 1.70


def test_short_history_is_insufficient_and_unpenalised():
    stab = price_stability(_series(minutes_low=60, minutes_high=60, cycles=1))
    assert stab["status"] == "insufficient"
    assert stability_discount_eur(stab) == 0.0
    assert stability_discount_eur(None) == 0.0
