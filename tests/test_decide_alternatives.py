"""Top-5 response contract for server-priced station alternatives."""

import datetime as dt

from app.decide import _alternatives


NOW = dt.datetime(2026, 11, 27, 12, 0, tzinfo=dt.timezone.utc)


def station(station_id, price, *, age=1, last_price=None, status="open"):
    return {
        "station_id": station_id,
        "name": station_id,
        "brand": "Test",
        "price": price,
        "last_price": last_price,
        "age_minutes": age,
        "status": status,
        # Identical coordinates make the route cost zero, so the expected
        # order is solely the server's net-euro ranking.
        "lat": 50.0,
        "lon": 8.0,
    }


def test_alternatives_returns_five_best_plus_reference_and_keeps_stale_flagged():
    reference = station("reference", 1.80)
    candidates = [station(f"fresh-{index}", 1.70 + index / 100) for index in range(5)]
    # Existing eligibility includes a known last price; freshness is explicit
    # in the payload, so the UI can distinguish it from a current observation.
    candidates.append(station("stale", None, age=45, last_price=1.60, status="closed"))

    alternatives, best = _alternatives(
        [reference, *candidates],
        reference,
        anchor=1.80,
        liters=40,
        consumption=7,
        speed=45,
        z_used=0,
        th={},
        nowcasts=None,
        fresh_threshold_minutes=15,
    )

    assert len(alternatives) == 5
    assert [row["station_id"] for row in alternatives] == [
        "stale",
        "fresh-0",
        "fresh-1",
        "fresh-2",
        "fresh-3",
    ]
    assert [row["net_eur"] for row in alternatives] == sorted(
        (row["net_eur"] for row in alternatives), reverse=True
    )
    assert alternatives[0]["price_fresh"] is False
    assert alternatives[0]["ref_price_fresh"] is True
    assert alternatives[0]["economics"]["reference_price"] == 1.80
    # The best is still computed across every eligible candidate; it is also
    # the first (highest-net) entry in the capped response.
    assert best == alternatives[0]
    assert "fresh-4" not in {row["station_id"] for row in alternatives}


def test_last_price_reference_is_explicitly_not_fresh():
    reference = station("reference", None, age=45, last_price=1.80, status="closed")
    candidate = station("candidate", 1.70)

    alternatives, _ = _alternatives(
        [reference, candidate],
        reference,
        anchor=1.80,
        liters=40,
        consumption=7,
        speed=45,
        z_used=0,
        th={},
        nowcasts=None,
        fresh_threshold_minutes=15,
    )

    assert len(alternatives) == 1
    assert alternatives[0]["price_fresh"] is True
    assert alternatives[0]["ref_price_fresh"] is False
