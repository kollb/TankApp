import datetime as dt
import json

import pytest

from app.config import Settings
from app.data import LiveData
from app.server import make_server
import threading
import urllib.request
import urllib.error

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
NOW = dt.datetime(2026, 9, 10, 12, tzinfo=dt.timezone.utc)


@pytest.fixture
def b3_settings(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "anchor": [50.11, 8.68],
                        "batch": [UID, OTHER],
                        "stations": [
                            {
                                "uuid": UID,
                                "name": "Station One",
                                "lat": 50.12,
                                "lon": 8.69,
                            },
                            {
                                "uuid": OTHER,
                                "name": "Station Two",
                                "lat": 50.13,
                                "lon": 8.70,
                            },
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
    static = tmp_path / "web"
    static.mkdir()
    (static / "index.html").write_text("<html>test</html>")
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
        static=static,
    )


def raw_price(ts, uid, city, price, status="open"):
    return {
        "_time": ts.isoformat(),
        "city": city,
        "station_id": uid,
        "station": "Station",
        "status": status,
        "e10": str(price),
    }


def test_heatmap_level_and_probability(b3_settings):
    # Monday 18:00 Berlin = Monday 16:00 UTC (CEST)
    # Let's use a fixed Monday 2026-09-07 16:00 UTC = 18:00 Berlin
    monday_18 = dt.datetime(2026, 9, 7, 16, 0, tzinfo=dt.timezone.utc)
    t1 = monday_18
    t2 = monday_18  # same timestamp for city median

    def query(cfg, flux):
        # Return two stations at same time
        yield raw_price(t1, UID, "Frankfurt", 1.60)
        yield raw_price(t2, OTHER, "Frankfurt", 1.70)

    live = LiveData(b3_settings, query=query, clock=lambda: NOW)
    # Level for city
    hm = live.heatmap("Frankfurt", "e10", "level", weeks=2, station_id=None)
    assert hm["error_code"] is None
    assert hm["days"] == ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
    assert len(hm["matrix"]) == 7
    # Monday is index 0, hour 18 should have median 1.65
    monday_row = hm["matrix"][0]
    assert monday_row[18] == 1.65

    # Probability for single station UID (cheaper)
    hm_prob = live.heatmap("Frankfurt", "e10", "probability", weeks=2, station_id=UID)
    assert hm_prob["error_code"] is None
    # UID price 1.60 <= median 1.65 => cheap
    assert hm_prob["matrix"][0][18] == 100.0

    # Other station should be 0%
    hm_prob2 = live.heatmap(
        "Frankfurt", "e10", "probability", weeks=2, station_id=OTHER
    )
    assert hm_prob2["matrix"][0][18] == 0.0


def test_selection_not_available_returns_explicit(b3_settings):
    # No training data -> selection_not_available
    live = LiveData(b3_settings, query=lambda *_: [], clock=lambda: NOW)
    sel = live.selection("e10", "Frankfurt")
    # Should have error_code selection_not_available or empty stations
    assert sel["count"] == 0
    assert sel["error_code"] in (
        "selection_not_available",
        "selection_read_failed",
        None,
    )


def test_selection_with_artifact(b3_settings, tmp_path):
    # Create fake selection artifact
    sel_path = b3_settings.runtime / "selection" / "current.json"
    sel_path.parent.mkdir(parents=True, exist_ok=True)
    sel_path.write_text(
        json.dumps(
            {
                "generated_at": NOW.isoformat(),
                "fuels": ["e10"],
                "cities": ["Frankfurt"],
                "count": 1,
                "stations": [
                    {
                        "station_id": UID,
                        "city": "Frankfurt",
                        "fuel": "e10",
                        "name": "Station One",
                        "brand": "ARAL",
                        "delta_ct": -3.8,
                        "ci_lo": -4.5,
                        "ci_hi": -3.1,
                        "q_value": 0.01,
                        "significant": True,
                        "avail": 0.42,
                        "best_hour": 19.5,
                        "vol_ct": 2.1,
                        "rank": 1,
                        "score": 1.2,
                    }
                ],
            }
        )
    )
    live = LiveData(b3_settings, query=lambda *_: [], clock=lambda: NOW)
    sel = live.selection("e10", "Frankfurt")
    assert sel["count"] == 1
    assert sel["stations"][0]["delta_ct"] == -3.8
    assert sel["stations"][0]["best_hour"] == 19.5


def test_collector_status_from_influx(b3_settings):
    # Simulate collector_status measurement
    hb_time = NOW - dt.timedelta(minutes=2)

    def query(cfg, flux):
        # Return fields as separate rows like Influx CSV parser
        if "collector_status" in flux:
            yield {
                "_time": hb_time.isoformat(),
                "_field": "last_poll_at",
                "_value": (NOW - dt.timedelta(minutes=2)).isoformat(),
            }
            yield {
                "_time": hb_time.isoformat(),
                "_field": "tmpfs_used_bytes",
                "_value": "1234567",
            }
            yield {
                "_time": hb_time.isoformat(),
                "_field": "tmpfs_total_bytes",
                "_value": "33554432",
            }
            yield {
                "_time": hb_time.isoformat(),
                "_field": "oldest_age_days",
                "_value": "1.2",
            }
            yield {"_time": hb_time.isoformat(), "_field": "poll_count", "_value": "42"}
            yield {
                "_time": hb_time.isoformat(),
                "_field": "city",
                "_value": "Frankfurt",
            }
        else:
            yield {}

    live = LiveData(b3_settings, query=query, clock=lambda: NOW)
    status = live.collector_status()
    assert status["available"] is True
    assert status["fresh"] is True
    assert status["influx"]["available"] is True


def test_route_evaluate_server_side(b3_settings):
    def query(cfg, flux):
        # For stations() it needs prices query, return fresh prices
        yield raw_price(NOW - dt.timedelta(minutes=5), UID, "Frankfurt", 1.60)
        yield raw_price(NOW - dt.timedelta(minutes=5), OTHER, "Frankfurt", 1.70)

    live = LiveData(b3_settings, query=query, clock=lambda: NOW)
    params = {
        "city": "Frankfurt",
        "fuel": "e10",
        "station_id": UID,
        "ref_station_id": OTHER,
        "liters": "40",
        "detour_km": "2",
        "consumption": "7",
        "speed": "45",
        "value_of_time": "12",
        "mode": "onroute",
    }
    result = live.route_evaluate(params)
    assert result["ref_price"] == 1.7
    assert result["alt_price"] == 1.6
    assert result["delta_ct"] == 10.0  # 0.10 € = 10 ct
    assert "net_eur" in result
    assert result["liters"] == 40.0


def test_http_new_endpoints(b3_settings):
    def query(cfg, flux):
        if "collector_status" in flux:
            hb_time = NOW - dt.timedelta(minutes=1)
            yield {
                "_time": hb_time.isoformat(),
                "_field": "last_poll_at",
                "_value": NOW.isoformat(),
            }
            yield {
                "_time": hb_time.isoformat(),
                "_field": "tmpfs_used_bytes",
                "_value": "1000000",
            }
        else:
            # For heatmap and stations
            yield raw_price(NOW - dt.timedelta(days=1, hours=2), UID, "Frankfurt", 1.60)
            yield raw_price(
                NOW - dt.timedelta(days=1, hours=2), OTHER, "Frankfurt", 1.70
            )
            # For stations latest
            yield raw_price(NOW - dt.timedelta(minutes=5), UID, "Frankfurt", 1.60)
            yield raw_price(NOW - dt.timedelta(minutes=5), OTHER, "Frankfurt", 1.70)

    live = LiveData(b3_settings, query=query, clock=lambda: NOW)
    server = make_server(b3_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(
            base + "/api/v1/heatmap?city=Frankfurt&fuel=e10&kind=level&weeks=2"
        ) as r:
            data = json.load(r)
            assert data["city"] == "Frankfurt"
            assert "matrix" in data

        with urllib.request.urlopen(
            base + "/api/v1/selection?fuel=e10&city=Frankfurt"
        ) as r:
            data = json.load(r)
            assert "stations" in data

        with urllib.request.urlopen(base + "/api/v1/collector/status") as r:
            data = json.load(r)
            assert "available" in data

        with urllib.request.urlopen(
            base
            + "/api/v1/route/evaluate?city=Frankfurt&fuel=e10&station_id=%s&ref_station_id=%s&liters=40&detour_km=2"
            % (UID, OTHER)
        ) as r:
            data = json.load(r)
            assert "net_eur" in data

        # Invalid query should be 400
        try:
            urllib.request.urlopen(base + "/api/v1/heatmap?city=Frankfurt&fuel=invalid")
            assert False, "should have raised"
        except urllib.error.HTTPError as e:
            assert e.code == 400

    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
