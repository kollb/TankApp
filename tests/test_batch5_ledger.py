"""Batch 5 ledger invariants: ties, receipt windows, net detours and server time."""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.feedback import (
    compute_advice_stats,
    estimate_p,
    record_fill,
    record_snapshot,
    window_settlement_kind,
)
from app.route import net_economics

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 16, 12, 0, tzinfo=dt.timezone.utc)


@pytest.fixture
def settings(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "anchor": [50.11, 8.68],
                        "batch": [UID],
                        "stations": [
                            {
                                "uuid": UID,
                                "name": "Station Alpha",
                                "lat": 50.12,
                                "lon": 8.69,
                            }
                        ],
                    }
                }
            }
        )
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\nTANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n"
    )
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
    )


def _wait_episode():
    return {
        "last_snapshot": {
            "action": "wait",
            "station_id": UID,
            "window_start": "2026-09-16T17:00:00+02:00",
            "window_end": "2026-09-16T19:00:00+02:00",
        }
    }


def test_window_receipt_distinguishes_strict_from_grace_and_quality():
    """O8: grace stays auditable but cannot become a strict followed signal."""
    from app.feedback import classify_compliance

    ep = _wait_episode()
    exact = "2026-09-16T18:00:00+02:00"
    grace = "2026-09-16T19:30:00+02:00"
    assert window_settlement_kind(ep, UID, exact) == "im_fenster"
    assert window_settlement_kind(ep, UID, grace) == "kulanz"
    assert classify_compliance(ep, 18.0, UID, exact) == "followed"
    assert classify_compliance(ep, 19.5, UID, grace) == "partial"


def test_ties_are_half_credit_in_rate_brier_reliability_and_action_estimate():
    """O7: one tie convention reaches every ledger aggregate."""
    snapshots = [
        {
            "id": "wait",
            "action": "wait",
            "p_correct": 0.5,
            "p_source": "verteilung",
            "emitted_at": NOW.isoformat(),
        },
        {
            "id": "now",
            "action": "refuel_now",
            "p_correct": 0.5,
            "p_source": "verteilung",
            "emitted_at": NOW.isoformat(),
        },
        {
            "id": "else",
            "action": "refuel_elsewhere",
            "p_correct": 0.5,
            "p_source": "verteilung",
            "emitted_at": NOW.isoformat(),
        },
    ]
    store = {
        "episodes": [{"id": "ep", "snapshots": snapshots}],
        "settlements": [
            {"snapshot_id": row["id"], "outcome": "tie", "settled_at": NOW.isoformat()}
            for row in snapshots
        ],
    }
    stats = compute_advice_stats(store, now=NOW)
    assert (
        stats["hit_rate"]
        == stats["hit_wait"]
        == stats["hit_now"]
        == stats["hit_elsewhere"]
        == 0.5
    )
    assert stats["brier_30d"] == 0.0
    assert stats["reliability"][5]["empirical_hit_rate"] == 0.5
    assert all(
        estimate_p(store, action) == 0.5
        for action in ("wait", "refuel_now", "refuel_elsewhere")
    )


def test_elsewhere_receipt_net_uses_snapshot_estimate_or_explicit_actual_distance(
    settings,
):
    """O9: receipt price/litres are actual; distance provenance never pretends."""
    economics = {
        "reference_price": 1.7,
        "liters_assumed": 40,
        "detour_km_total_est": 2.0,
        "consumption_l_100km": 7.0,
        "speed_kmh": 45.0,
        "time_value_eur_h": 10.0,
    }
    record_snapshot(
        settings,
        {
            "action": "refuel_elsewhere",
            "city": "Frankfurt",
            "station_id": "reference",
            "alt_station_id": UID,
            "price_now": 1.7,
            "elsewhere_economics": economics,
        },
        clock=lambda: NOW,
    )
    estimated = record_fill(
        settings,
        {"id": "estimated", "station_id": UID, "liters": 40, "price_paid": 1.6},
        clock=lambda: NOW,
    )
    expected = net_economics(1.7, 1.6, 40, 2.0, 7.0, 45.0, 10.0)["net_eur"]
    assert estimated["elsewhere_net_eur"] == round(expected, 2)
    assert (
        estimated["elsewhere_net_provenance"]["distance_source"] == "estimated_snapshot"
    )

    # A new decision makes a new episode after the prior receipt resolved it.
    record_snapshot(
        settings,
        {
            "action": "refuel_elsewhere",
            "city": "Frankfurt",
            "station_id": "reference",
            "alt_station_id": UID,
            "price_now": 1.7,
            "elsewhere_economics": economics,
        },
        clock=lambda: NOW + dt.timedelta(hours=1),
    )
    actual = record_fill(
        settings,
        {
            "id": "actual",
            "station_id": UID,
            "liters": 40,
            "price_paid": 1.6,
            "actual_detour_km_total": 4.0,
        },
        clock=lambda: NOW + dt.timedelta(hours=1),
    )
    expected_actual = net_economics(1.7, 1.6, 40, 4.0, 7.0, 45.0, 10.0)["net_eur"]
    assert actual["elsewhere_net_eur"] == round(expected_actual, 2)
    assert actual["elsewhere_net_provenance"]["distance_source"] == "actual_receipt"
    assert actual["elsewhere_net_provenance"]["detour_km_total"] == 4.0


def test_timestamp_free_fill_exposes_server_time_source(settings):
    """O43: the server clock—not an invented noon slot—is the persisted origin."""
    fill = record_fill(
        settings,
        {"id": "server-clock", "station_id": UID, "liters": 40, "price_paid": 1.7},
        clock=lambda: NOW,
    )
    assert fill["clock_hour"] == 14  # 12:00 UTC = 14:00 Europe/Berlin in September
    assert fill["clock_hour_source"] == "server"
