import csv
import datetime as dt
import gzip
import json
import threading
import urllib.error
import urllib.request
from dataclasses import replace

import pytest

from app.config import Settings
from app.data import LiveData, metadata
from app.history import convert_day, open_csv, prepare_archive
from app.server import Handler, make_server

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
THIRD = "00000000-0000-0000-0000-000000000003"
NOW = dt.datetime(2026, 9, 8, 10, tzinfo=dt.timezone.utc)


@pytest.fixture
def app_settings(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "batch": [UID],
                        "stations": [
                            {
                                "uuid": UID,
                                "name": "Station One",
                                "lat": 50.1,
                                "lon": 8.6,
                                "maps": "javascript:evil",
                            }
                        ],
                    },
                    "Gütersloh": {
                        "label": "Gütersloh",
                        "batch": [OTHER],
                        "stations": [{"uuid": OTHER, "name": "Station Two"}],
                    },
                }
            }
        )
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\nTANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=never-expose-me\n"
    )
    static = tmp_path / "web"
    static.mkdir()
    (static / "index.html").write_text("<html>TankApp test shell</html>")
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
        static=static,
    )


def raw(status="open", value="1.729", age=5, uid=UID, city="Frankfurt"):
    return {
        "_time": (NOW - dt.timedelta(minutes=age)).isoformat(),
        "city": city,
        "station_id": uid,
        "station": "Station",
        "status": status,
        "e10": value,
    }


def test_live_uses_uuid_status_and_only_selected_stations(app_settings):
    queries = []

    def query(cfg, text):
        queries.append(text)
        return [raw()]

    live = LiveData(app_settings, query=query, clock=lambda: NOW)
    data = live.stations()
    one, two = data["stations"]
    assert one["station_id"] == UID and one["price"] == 1.729
    assert one["fresh"] and one["maps_url"].startswith("https://www.google.com/maps/")
    assert two["station_id"] == OTHER and two["price"] is None
    assert data["cities"] == ["Frankfurt", "Gütersloh"]
    assert data["decision_ready"] is False
    assert "exists r.station_id" in queries[0] and "tail(n: 1)" in queries[0]
    assert "never-expose-me" not in json.dumps(data)
    assert "anchor" not in json.dumps(data)


@pytest.mark.parametrize(
    "status,value,age",
    [
        ("closed", "1.729", 5),
        ("no prices", "", 5),
        ("open", "false", 5),
        ("open", "", 5),
        ("open", "1.729", 31),
        ("open", "nan", 5),
    ],
)
def test_bad_or_stale_prices_never_rank(app_settings, status, value, age):
    live = LiveData(
        app_settings, query=lambda *_: [raw(status, value, age)], clock=lambda: NOW
    )
    data = live.stations()
    assert data["fresh_prices"] == 0
    assert all(item["price"] is None for item in data["stations"])


def test_cache_rechecks_age_and_failure_does_not_publish_partial_result(
    app_settings, monkeypatch
):
    clock = [NOW]
    monotonic = [1000]
    monkeypatch.setattr("app.data.time.monotonic", lambda: monotonic[0])

    def query(*_):
        yield raw()
        if monotonic[0] > 1000:
            raise ValueError("never-expose-me")

    live = LiveData(app_settings, query=query, clock=lambda: clock[0])
    assert live.stations()["fresh_prices"] == 1
    clock[0] += dt.timedelta(minutes=26)
    assert (
        live.stations()["fresh_prices"] == 0
    )  # cached payload is not automatically fresh
    clock[0] = NOW
    monotonic[0] += 31
    data = live.stations()
    assert data["connection_error"] == "influx_read_failed"
    assert data["fresh_prices"] == 0
    assert data["stations"][0]["last_price"] == 1.729
    assert "never-expose-me" not in json.dumps(data)


def test_future_and_legacy_or_foreign_uuid_rows_are_rejected(app_settings):
    for row in [raw(age=-1), {**raw(), "station_id": ""}, raw(uid=OTHER)]:
        live = LiveData(app_settings, query=lambda *_: [row], clock=lambda: NOW)
        data = live.stations()
        assert data["connection_error"] == "influx_read_failed"
        assert data["fresh_prices"] == 0


def test_single_bad_row_does_not_hide_good_stations(app_settings):
    # Hybrid: Eine defekte Zeile neben einer guten verwirft nur die defekte —
    # Totalausfall gibt es nur, wenn ALLE Zeilen unbrauchbar sind.
    bad = raw(uid=THIRD)  # fremde UUID, nicht im Polling-Set
    live = LiveData(app_settings, query=lambda *_: [bad, raw()], clock=lambda: NOW)
    data = live.stations()
    assert data["connection_error"] is None
    assert data["fresh_prices"] == 1
    one = next(s for s in data["stations"] if s["station_id"] == UID)
    assert one["price"] == 1.729 and one["fresh"]
    assert all(s["station_id"] != THIRD for s in data["stations"])


def test_missing_setup_is_explicit_and_does_not_call_network(app_settings):
    settings = replace(app_settings, polling=app_settings.data / "missing.json")
    live = LiveData(settings, query=lambda *_: pytest.fail("network"))
    data = live.stations()
    assert data["connection_error"] == "polling_missing" and not data["stations"]
    assert live.health()["app"] == "online"
    settings = replace(app_settings, influx_env=app_settings.data / "missing.env")
    live = LiveData(settings, query=lambda *_: pytest.fail("network"))
    assert live.stations()["connection_error"] == "influx_not_configured"


def test_anchor_distance_is_derived_but_never_exposed(tmp_path):
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
                            {"uuid": UID, "name": "Nah", "lat": 50.12, "lon": 8.69},
                            {"uuid": OTHER, "name": "Ohne Koordinaten"},
                        ],
                    },
                    "Gütersloh": {
                        "label": "Gütersloh",
                        "batch": [THIRD],
                        "stations": [
                            {"uuid": THIRD, "name": "Weit", "lat": 51.9, "lon": 8.4}
                        ],
                    },
                }
            }
        )
    )
    settings = Settings(data=tmp_path / "data", polling=polling)
    metas, error = metadata(settings)
    assert error is None
    near = metas[("Frankfurt", UID)]["dist_km"]
    assert 1.0 < near < 2.0
    assert metas[("Frankfurt", UID)]["dist_mode"] == "air"
    # No coordinates or no anchor: no distance, never an invented one.
    assert metas[("Frankfurt", OTHER)]["dist_km"] is None
    assert metas[("Gütersloh", THIRD)]["dist_km"] is None
    # The private anchor coordinates themselves never enter a public payload.
    assert "anchor" not in json.dumps(list(metas.values()))


def test_discover_format_anchor_lat_lon_also_derives_distances(tmp_path):
    """discover_stations schreibt lat/lon auf Set-Ebene; add-city nutzt 'anchor'.

    Beide bezeichnen denselben privaten Referenzpunkt — beide liefern
    Entfernungen, sonst würde dieselbe Stadt je nach Herkunft des Sets
    mit oder ohne km-Badge angezeigt (z. B. Frankfurt ohne Gütersloh).
    """
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Gütersloh": {
                        "label": "Gütersloh",
                        "anchor": [51.9, 8.4],
                        "batch": [UID],
                        "stations": [
                            {"uuid": UID, "name": "A", "lat": 51.91, "lon": 8.41}
                        ],
                    },
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "lat": 50.11,
                        "lon": 8.68,
                        "radius_km": 25,
                        "batch": [OTHER],
                        "stations": [
                            {"uuid": OTHER, "name": "B", "lat": 50.12, "lon": 8.69}
                        ],
                    },
                }
            }
        )
    )
    metas, error = metadata(Settings(data=tmp_path / "data", polling=polling))
    assert error is None
    assert 0.5 < metas[("Gütersloh", UID)]["dist_km"] < 2.0
    assert 0.5 < metas[("Frankfurt", OTHER)]["dist_km"] < 2.0
    # Der Referenzpunkt selbst bleibt privat, auch im discover-Format.
    payload = json.dumps(list(metas.values()))
    assert "50.11" not in payload and "8.68" not in payload


def test_driving_distance_uses_osrm_not_air(tmp_path, monkeypatch):
    monkeypatch.setenv("TANKAPP_OSRM", "1")

    def fake_driving(anchor, targets, cache_path):
        assert anchor == (50.11, 8.68)
        assert cache_path.name == "road_route_cache.json"
        return [(3.4, "road") for _ in targets]

    monkeypatch.setattr("app.data.driving_km", fake_driving)
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
                            {"uuid": UID, "name": "Nah", "lat": 50.12, "lon": 8.69}
                        ],
                    }
                }
            }
        )
    )
    metas, error = metadata(Settings(data=tmp_path / "data", polling=polling))
    assert error is None
    assert metas[("Frankfurt", UID)]["dist_km"] == 3.4
    assert metas[("Frankfurt", UID)]["dist_mode"] == "road"
    assert "50.11" not in json.dumps(list(metas.values()))


def test_invalid_anchor_is_ignored_instead_of_guessing(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "anchor": [0, 0],
                        "batch": [UID],
                        "stations": [
                            {"uuid": UID, "name": "Nah", "lat": 50.12, "lon": 8.69}
                        ],
                    }
                }
            }
        )
    )
    metas, error = metadata(Settings(data=tmp_path / "data", polling=polling))
    assert error is None and metas[("Frankfurt", UID)]["dist_km"] is None


def test_series_does_not_forward_fill_closed_or_missing_fuel(app_settings):
    live = LiveData(
        app_settings,
        query=lambda *_: [raw(age=20), raw("closed", age=10), raw(value="", age=5)],
        clock=lambda: NOW,
    )
    points = live.series(UID, "Frankfurt", "e10")["points"]
    assert [point["price"] for point in points] == [1.729, None, None]
    with pytest.raises(ValueError):
        live.series("not-selected", "Frankfurt", "e10")
    with pytest.raises(ValueError):
        live.series(UID, "Frankfurt", "e10", 999)


def test_forecast_never_releases_calibration_from_artifact_flags(app_settings):
    path = app_settings.runtime / "engine/current.json"
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {
                "forecasts": [
                    {
                        "station_id": UID,
                        "city": "Frankfurt",
                        "fuel": "E10",
                        "origin": (NOW - dt.timedelta(days=2)).isoformat(),
                        "points": [],
                        "decision_ready": True,
                        "calibrated": True,
                    }
                ]
            }
        )
    )
    live = LiveData(app_settings, clock=lambda: NOW)
    forecast = live.forecast(UID, "Frankfurt", "e10")
    assert forecast["stale"] is True
    assert forecast["calibrated"] is False and forecast["decision_ready"] is False


def test_http_client_disconnect_stays_silent(app_settings):
    # Browser-Reload mitten in der Antwort: erst ConnectionReset, dann
    # BrokenPipe bei der Fehlerantwort — beides ohne Traceback schlucken.
    data = LiveData(app_settings, query=lambda *_: [raw()], clock=lambda: NOW)

    class Disconnecting:
        def __init__(self):
            self.calls = 0

        def write(self, chunk):
            self.calls += 1
            if self.calls == 1:
                raise ConnectionResetError(104, "Connection reset by peer")
            raise BrokenPipeError(32, "Broken pipe")

    handler = Handler.__new__(Handler)
    handler.command = "GET"
    handler.path = "/api/v1/stations?fuel=e10"
    handler.requestline = "GET /api/v1/stations?fuel=e10 HTTP/1.1"
    handler.request_version = "HTTP/1.1"
    handler._headers_buffer = []
    handler.data = data
    handler.wfile = Disconnecting()
    handler.do_GET()


def test_http_serves_gui_and_read_only_api_but_never_secrets(app_settings):
    data = LiveData(app_settings, query=lambda *_: [raw()], clock=lambda: NOW)
    server = make_server(app_settings, "127.0.0.1", 0, data)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(base + "/") as response:
            assert b"TankApp test shell" in response.read()
            assert response.headers["Cache-Control"] == "no-store"
        with urllib.request.urlopen(base + "/api/v1/stations?fuel=e10") as response:
            assert json.load(response)["fresh_prices"] == 1
        for path in [
            "/data/influx.env",
            "/.env",
            "/%2e%2e/influx.env",
            "/api/v1/unknown",
            "/assets/",
        ]:
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base + path)
            assert error.value.code == 404
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(base + "/api/v1/stations?fuel=invalid")
        assert error.value.code == 400
        with urllib.request.urlopen(
            urllib.request.Request(base + "/", method="HEAD")
        ) as response:
            assert response.read() == b""
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(
                urllib.request.Request(
                    base + "/api/v1/restart", data=b"{}", method="POST"
                )
            )
        assert error.value.code == 501
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_health_prefers_nas_worker_archive_state_with_legacy_fallback(app_settings):
    worker_state = app_settings.runtime / "jobs" / "archive-sync" / "state.json"
    worker_state.parent.mkdir(parents=True)
    worker_state.write_text(
        json.dumps(
            {
                "archive_since": "2025-09-09",
                "requested_until": "2026-09-08",
                "status": "complete",
                "missing_files": 0,
                "last_complete_until": "2026-09-08",
            }
        )
    )
    live = LiveData(app_settings, query=lambda *_: [], clock=lambda: NOW)
    assert live.health()["archive"]["last_complete_until"] == "2026-09-08"
    worker_state.unlink()
    legacy = app_settings.archive / ".sync" / "state.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text(
        json.dumps(
            {
                "archive_since": "2024-01-01",
                "requested_until": "2026-09-08",
                "status": "incomplete",
                "missing_files": 5,
                "last_complete_until": None,
            }
        )
    )
    assert live.health()["archive"]["missing_files"] == 5


# ---------------------------------------------------------------------------
# Archiv-Aufbereitung (app.history)
# ---------------------------------------------------------------------------


HEADER = "date,station_uuid,e10,e10change\n"
META = {UID: {"city": "Frankfurt", "name": "Station"}}


def test_archive_keeps_offsets_exact_events_and_removal_barriers(tmp_path):
    source = tmp_path / "prices.csv"
    source.write_text(
        HEADER
        + f"2026-10-25 02:03:07+02:00,{UID},1.7,1\n"
        + f"2026-10-25 02:03:07+01:00,{UID},1.8,1\n"
        + f"2026-10-25 03:05:00+01:00,{UID},1.8,0\n"
        + f"2026-10-25 03:07:00+01:00,{UID},0,2\n"
        + f"2026-10-25 04:02:00+01:00,{UID},1.6,3\n"
    )
    output = tmp_path / "normalized.csv.gz"
    stats = convert_day(source, output, META, ("e10",))
    with open_csv(output) as file:
        rows = list(csv.DictReader(file))
    assert len(rows) == 4  # flag 0 is not an additional price observation
    assert rows[0]["timestamp"] == "2026-10-25T00:03:07+00:00"
    assert rows[1]["timestamp"] == "2026-10-25T01:03:07+00:00"
    assert rows[0]["status"] == ""  # do not invent opening status
    assert rows[2]["status"] == "no prices" and rows[2]["price"] == ""
    assert rows[3]["price"] == "1.6"
    assert stats["barriers"] == 1


def test_naive_times_and_invalid_changed_prices_are_not_silently_reconstructed(
    tmp_path,
):
    source = tmp_path / "prices.csv"
    source.write_text(
        HEADER
        + f"2026-09-01 06:03:00,{UID},1.7,1\n"
        + f"2026-09-01 06:04:00+02:00,{UID},NaN,1\n"
        + f"2026-09-01 06:05:00+02:00,{UID},1.7,unknown\n"
    )
    output = tmp_path / "normalized.csv.gz"
    stats = convert_day(source, output, META, ("e10",))
    assert stats == {
        "events": 2,
        "barriers": 2,
        "invalid_timestamps": 1,
        "invalid_flags": 1,
    }
    with open_csv(output) as file:
        assert all(row["price"] == "" for row in csv.DictReader(file))


def test_archive_cache_skips_unchanged_raw_days_and_invalidates_on_selection(
    tmp_path, monkeypatch
):
    import app.history as history

    raw = tmp_path / "archive/prices/2026/09/2026-09-01-prices.csv.gz"
    raw.parent.mkdir(parents=True)
    with gzip.open(raw, "wt") as file:
        file.write(HEADER + f"2026-09-01 06:03:00+02:00,{UID},1.7,1\n")
    original = raw.read_bytes()
    metas = {("Frankfurt", UID): META[UID]}
    start, stop = dt.date(2026, 9, 1), dt.date(2026, 9, 3)
    cache = tmp_path / "cache"
    paths, quality = prepare_archive(
        tmp_path / "archive", metas, ("e10",), start, stop, cache
    )
    assert len(paths) == 1 and quality["missing_days"] == 1
    real = history.convert_day
    monkeypatch.setattr(
        history,
        "convert_day",
        lambda *a: (_ for _ in ()).throw(AssertionError("cached day reprocessed")),
    )
    assert (
        prepare_archive(tmp_path / "archive", metas, ("e10",), start, stop, cache)[0]
        == paths
    )
    monkeypatch.setattr(history, "convert_day", real)
    moved = {("Gütersloh", UID): {"city": "Gütersloh", "name": "Station"}}
    new_paths, _ = prepare_archive(
        tmp_path / "archive", moved, ("e10",), start, stop, cache
    )
    assert new_paths != paths
    assert raw.read_bytes() == original


def test_hashed_assets_are_immutable_cacheable(app_settings):
    """Content-hashierte Vite-Assets dürfen cachen — no-store nur fürs Übrige.

    Regression: ``Cache-Control: no-store`` auf ALLEN Antworten (auch auf die
    content-hashierten Assets) verhinderte Asset-Caching und stand dem
    Lighthouse-Ziel aus §13 M4 im Weg (Prüfstand §3.8).
    """
    assets = app_settings.static / "assets"
    assets.mkdir()
    (assets / "index-abc123.js").write_text("console.log('hi')")
    data = LiveData(app_settings, query=lambda *_: [raw()], clock=lambda: NOW)
    server = make_server(app_settings, "127.0.0.1", 0, data)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(base + "/assets/index-abc123.js") as response:
            assert response.headers["Cache-Control"] == (
                "public, max-age=31536000, immutable"
            )
        with urllib.request.urlopen(base + "/") as response:
            assert response.headers["Cache-Control"] == "no-store"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_501_is_json_not_html(app_settings):
    """Unbekannte Schreib-Endpunkte liefern JSON mit error_code statt HTML.

    Vorher antwortete ``send_error(501)`` mit HTML — das widersprach der
    eigenen Regel „Alle Endpunkte liefern error_code" (Prüfstand §1.5).
    """
    data = LiveData(app_settings, query=lambda *_: [raw()], clock=lambda: NOW)
    server = make_server(app_settings, "127.0.0.1", 0, data)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        for method in ("POST", "PUT", "DELETE", "PATCH"):
            req = urllib.request.Request(
                base + "/api/v1/restart", data=b"{}", method=method
            )
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(req)
            assert error.value.code == 501
            assert error.value.headers["Content-Type"].startswith("application/json")
            assert json.loads(error.value.read()) == {"error_code": "not_implemented"}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
