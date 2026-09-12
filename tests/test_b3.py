import datetime as dt
import json
import re

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


def test_heatmap_probability_column_basis_shows_weekday_effect(b3_settings):
    """B12: ohne Station gegen den Median *derselben Stunde* rechnen.

    Montag ist durchgehend 6 ct günstiger als Freitag; zur selben Stunde bleibt
    der Abstand aber unter dem Gesamtmedian — den zeigt nur die Spalten-Basis.
    """
    # Montag 2026-09-07 und Freitag 2026-09-04, 18 und 12 Uhr Berlin (UTC+2).
    rows = [
        (dt.datetime(2026, 9, 7, 16, 0, tzinfo=dt.timezone.utc), UID, 1.70),
        (dt.datetime(2026, 9, 7, 16, 0, tzinfo=dt.timezone.utc), OTHER, 1.72),
        (dt.datetime(2026, 9, 7, 10, 0, tzinfo=dt.timezone.utc), UID, 1.78),
        (dt.datetime(2026, 9, 7, 10, 0, tzinfo=dt.timezone.utc), OTHER, 1.80),
        (dt.datetime(2026, 9, 4, 16, 0, tzinfo=dt.timezone.utc), UID, 1.76),
        (dt.datetime(2026, 9, 4, 16, 0, tzinfo=dt.timezone.utc), OTHER, 1.78),
        (dt.datetime(2026, 9, 4, 10, 0, tzinfo=dt.timezone.utc), UID, 1.84),
        (dt.datetime(2026, 9, 4, 10, 0, tzinfo=dt.timezone.utc), OTHER, 1.86),
    ]

    def query(cfg, flux):
        yield from (
            {
                "_time": ts.isoformat(),
                "city": "Frankfurt",
                "station_id": uid,
                "station": "Station",
                "status": "open",
                "e10": str(price),
            }
            for ts, uid, price in rows
        )

    live = LiveData(b3_settings, query=query, clock=lambda: NOW)

    # Gesamtmedian (1,78): Montag und Freitag sind um 18 Uhr beide „grün“ —
    # der Wochentags-Abstand ist aus der Ansicht nicht abzulesen.
    overall = live.heatmap("Frankfurt", "e10", "probability", weeks=2, basis="overall")
    assert overall["error_code"] is None
    assert overall["basis"] == "overall"
    assert overall["matrix"][0][18] == 100.0  # Mo 18 Uhr
    assert overall["matrix"][4][18] == 100.0  # Fr 18 Uhr (1,78 ≤ 1,78 zählt)
    assert overall["matrix"][0][12] == 50.0  # Mo 12 Uhr

    # Spalten-Basis: Median derselben Stunde → Mo bleibt grün, Fr wird rot.
    hour = live.heatmap("Frankfurt", "e10", "probability", weeks=2, basis="hour")
    assert hour["error_code"] is None
    assert hour["basis"] == "hour"
    assert hour["matrix"][0][18] == 100.0  # Mo 18 Uhr unter 1,74
    assert hour["matrix"][4][18] == 0.0  # Fr 18 Uhr über 1,74
    assert hour["matrix"][0][12] == 100.0  # Mo 12 Uhr unter 1,82
    assert hour["matrix"][4][12] == 0.0  # Fr 12 Uhr über 1,82

    # Das Niveau (kind=level) ist von der Basis unabhängig.
    level_overall = live.heatmap(
        "Frankfurt", "e10", "level", weeks=2, station_id=None, basis="overall"
    )
    level_hour = live.heatmap(
        "Frankfurt", "e10", "level", weeks=2, station_id=None, basis="hour"
    )
    assert level_hour["matrix"] == level_overall["matrix"]

    # Mit Station vergleicht die Heatmap ohnehin je Zelle — Basis wirkt nicht.
    with_station_overall = live.heatmap(
        "Frankfurt", "e10", "probability", weeks=2, station_id=UID, basis="overall"
    )
    with_station_hour = live.heatmap(
        "Frankfurt", "e10", "probability", weeks=2, station_id=UID, basis="hour"
    )
    assert with_station_hour["matrix"] == with_station_overall["matrix"]
    assert with_station_hour["matrix"][0][18] == 100.0  # 1,70 ≤ Zellenmedian 1,71


def test_heatmap_rejects_unknown_basis(b3_settings):
    live = LiveData(b3_settings, query=lambda *_: [], clock=lambda: NOW)
    with pytest.raises(ValueError, match="invalid_basis"):
        live.heatmap("Frankfurt", "e10", "probability", weeks=2, basis="gesamt")


def test_heatmap_endpoint_accepts_basis_param(b3_settings):
    """Der API-Pfad reicht `basis` durch — die GUI schaltet ihn um (B12)."""
    seen = {}

    def query(cfg, flux):
        seen["called"] = True
        yield raw_price(NOW - dt.timedelta(days=1, hours=2), UID, "Frankfurt", 1.60)

    live = LiveData(b3_settings, query=query, clock=lambda: NOW)
    server = make_server(b3_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(
            base
            + "/api/v1/heatmap?city=Frankfurt&fuel=e10&kind=probability&weeks=2&basis=hour"
        ) as r:
            data = json.load(r)
        assert data["basis"] == "hour"
        assert data["error_code"] is None
        try:
            urllib.request.urlopen(
                base
                + "/api/v1/heatmap?city=Frankfurt&fuel=e10&kind=probability&weeks=2&basis=quatsch"
            )
            assert False, "sollte 400 sein"
        except urllib.error.HTTPError as e:
            assert e.code == 400
            assert json.load(e)["error_code"] == "invalid_basis"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


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


def test_collector_status_reads_influx_without_price_schema(b3_settings, monkeypatch):
    """Regression B3.11: Der Produktions-Leseweg verlangt kein Preis-Schema.

    Ohne injizierte query-Funktion liest collector_status über query_any
    (PROBE_COLUMNS) — die echte Influx-Antwort besteht aus _field/_value-Zeilen
    ohne station/status und würde über das Preis-Schema als „Unerwartetes
    InfluxDB-CSV-Format" scheitern (influx_read_failed/ExportError), obwohl der
    Pi fleißig liefert.
    """
    import http.client
    import io

    import export_influx as influx

    payload = (
        "#datatype,string,long,dateTime:RFC3339,dateTime:RFC3339,dateTime:RFC3339,string,string,string,string,string\n"
        "#group,false,false,true,true,false,true,true,true,false,false\n"
        "#default,_result,,,,,,,,,\n"
        ",result,table,_start,_stop,_time,_measurement,host,city,_field,_value\n"
        f",,0,2026-09-05T00:00:00Z,2026-09-12T00:00:00Z,{(NOW - dt.timedelta(minutes=1)).isoformat()},collector_status,pi,Frankfurt,last_poll_at,{NOW.isoformat()}\n"
    ).encode()

    class Socket:
        def makefile(self, *args):
            return io.BytesIO(
                b"HTTP/1.1 200 OK\r\n"
                b"Content-Type: text/csv; charset=utf-8\r\n"
                + f"Content-Length: {len(payload)}\r\n".encode()
                + b"\r\n"
                + payload
            )

    class Opener:
        def open(self, request, timeout):
            response = http.client.HTTPResponse(Socket())
            response.begin()
            return response

    # app.data nutzt dasselbe export_influx-Modul → der Produktionspfad
    # query_any → query_raw → query_rows(PROBE_COLUMNS) läuft gegen diese Antwort.
    monkeypatch.setattr(influx.urllib.request, "build_opener", lambda *args: Opener())

    live = LiveData(b3_settings, clock=lambda: NOW)
    status = live.collector_status()
    assert status["available"] is True
    assert status["source"] == "influx"
    assert status["fresh"] is True
    assert status["last_poll_at"] == NOW.isoformat()


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


# ---------------------------------------------------------------------------
# Regressionstests zu den B3-Fixes (Heartbeat, Health ohne Netzwerk,
# Route-Evaluate when/detour/alt_price, Selection dist_km + Count)
# ---------------------------------------------------------------------------


def _post_heartbeat(base, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        base + "/api/v1/collector/heartbeat",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, json.load(r)


def test_heartbeat_last_poll_only_succeeds(b3_settings):
    """Nur last_poll (ohne timestamp) darf kein 503/KeyError werfen."""
    live = LiveData(b3_settings, query=lambda *_: [], clock=lambda: NOW)
    server = make_server(b3_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        status, body = _post_heartbeat(
            base, {"last_poll": "2026-09-09T14:00:00+00:00", "city": "Frankfurt"}
        )
        assert status == 200
        assert body["status"] == "ok"
        assert body["received_at"] == "2026-09-09T14:00:00+00:00"
        stored = json.loads(
            (b3_settings.runtime / "collector" / "heartbeat.json").read_text()
        )
        assert stored["timestamp"] == "2026-09-09T14:00:00+00:00"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_heartbeat_malformed_content_length_gets_400(b3_settings):
    """Malformed Content-Length -> HTTP 400 statt connection drop."""
    import socket

    live = LiveData(b3_settings, query=lambda *_: [], clock=lambda: NOW)
    server = make_server(b3_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_port = server.server_port
    try:
        s = socket.create_connection(("127.0.0.1", base_port), timeout=5)
        s.sendall(
            b"POST /api/v1/collector/heartbeat HTTP/1.1\r\n"
            b"Host: x\r\nContent-Length: abc\r\n\r\n"
        )
        # Komplette HTTP-Antwort lesen (Body kann in 2. Segment ankommen)
        s.settimeout(2.0)
        response = b""
        try:
            response += s.recv(400)
        except socket.timeout:
            pass
        while True:
            head, _, _ = response.partition(b"\r\n\r\n")
            match = re.search(rb"Content-Length: (\d+)", head)
            if not match or len(response) >= len(head) + 4 + int(match.group(1)):
                break
            try:
                chunk = s.recv(400)
            except socket.timeout:
                break
            if not chunk:
                break
            response += chunk
        s.close()
        assert response, "Server hat die Verbindung ohne Antwort getrennt"
        head, _, body = response.partition(b"\r\n\r\n")
        assert b"400" in head.split(b"\r\n")[0]
        assert b"invalid_request" in body
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_health_does_not_query_influx(b3_settings):
    """/health darf kein Netzwerk mehr auslösen (Docker-Healthcheck 3–5 s)."""

    def fail_network(*_):
        raise AssertionError("health muss ohne Netzwerk-Query funktionieren")

    live = LiveData(b3_settings, query=fail_network, clock=lambda: NOW)
    health = live.health()
    assert health["app"] == "online"
    assert health["collector"]["influx"]["error_code"] == "influx_not_queried"
    # Dedizierter Endpunkt fragt dagegen weiter InfluxDB ab
    live2 = LiveData(
        b3_settings,
        query=lambda cfg, flux: iter(
            [
                {
                    "_time": (NOW - dt.timedelta(minutes=1)).isoformat(),
                    "_field": "last_poll_at",
                    "_value": NOW.isoformat(),
                }
            ]
        ),
        clock=lambda: NOW,
    )
    status = live2.collector_status()
    assert status["available"] is True
    assert status["source"] == "influx"


def test_collector_status_falls_back_to_nas_file(b3_settings):
    """Ohne Influx-Punkt liefert das per POST abgelegte File den Status."""
    nas_path = b3_settings.runtime / "collector" / "heartbeat.json"
    nas_path.parent.mkdir(parents=True, exist_ok=True)
    nas_path.write_text(
        json.dumps(
            {
                "timestamp": (NOW - dt.timedelta(minutes=3)).isoformat(),
                "city": "Frankfurt",
                "open_count": 2,
                "total_count": 2,
                "tmpfs_used_mb": 10.0,
                "tmpfs_total_mb": 100.0,
                "oldest_file_age_days": 1.5,
            }
        )
    )

    def fail_network(*_):
        raise AssertionError(
            "collector/status ohne Influx-Punkt darf failen, aber File nutzen"
        )

    live = LiveData(b3_settings, query=fail_network, clock=lambda: NOW)
    status = live.collector_status()
    assert status["available"] is True
    assert status["source"] == "nas"
    assert status["fresh"] is True
    assert status["tmpfs_used_bytes"] == 10_000_000
    assert status["oldest_age_days"] == 1.5
    assert status["city"] == "Frankfurt"

    # health nutzt dieselbe Datei ohne Netzwerk
    health = live.health()
    assert health["collector"]["available"] is True
    assert health["collector"]["source"] == "nas"


def test_route_when_hhmm_and_peak(b3_settings):
    def query(cfg, flux):
        yield raw_price(NOW - dt.timedelta(minutes=5), UID, "Frankfurt", 1.60)
        yield raw_price(NOW - dt.timedelta(minutes=5), OTHER, "Frankfurt", 1.70)

    live = LiveData(b3_settings, query=query, clock=lambda: NOW)
    base_params = {
        "city": "Frankfurt",
        "station_id": UID,
        "ref_price": "1.70",
        "detour_km": "2",
        "value_of_time": "0",
    }
    peak = live.route_evaluate({**base_params, "when": "18:00"})
    assert peak["z_used"] == 16.0
    assert peak["is_peak"] is True
    assert peak["z_auto"] is True
    assert peak["when_hour"] == 18.0

    offpeak = live.route_evaluate({**base_params, "when": "10:30"})
    assert offpeak["z_used"] == 10.0
    assert offpeak["is_peak"] is False
    assert offpeak["when_hour"] == 10.5

    iso = live.route_evaluate({**base_params, "when": "2026-09-09T19:00:00+02:00"})
    assert iso["z_used"] == 16.0

    explicit = live.route_evaluate({**base_params, "value_of_time": "12"})
    assert explicit["z_used"] == 12.0
    assert explicit["z_auto"] is False

    try:
        live.route_evaluate({**base_params, "when": "garbage"})
        raise AssertionError("ungültiges when muss ValueError werfen")
    except ValueError:
        pass


def test_route_derived_detour_from_dist_km(b3_settings, monkeypatch):
    """Ohne detour_km: aus den Stationskoordinaten ableiten (Luftlinie × 1,3).

    |dist(Ziel) − dist(Referenz)| wäre nur eine Dreiecksungleichungs-Schranke
    (0 bei gleicher Anker-Entfernung trotz km-Weite) — die Luftlinie zwischen
    den Stationen × 1,3 ist die bessere Näherung (Konvention road_route.py).
    """
    monkeypatch.setenv("TANKAPP_OSRM", "0")

    def query(cfg, flux):
        yield raw_price(NOW - dt.timedelta(minutes=5), UID, "Frankfurt", 1.60)
        yield raw_price(NOW - dt.timedelta(minutes=5), OTHER, "Frankfurt", 1.70)

    live = LiveData(b3_settings, query=query, clock=lambda: NOW)
    from app.data import haversine_km

    anchor = (50.11, 8.68)
    dist_uid = haversine_km(*anchor, 50.12, 8.69)
    dist_other = haversine_km(*anchor, 50.13, 8.70)
    assert dist_other > dist_uid  # OTHER liegt weiter vom Anker entfernt

    # onroute: Mehrweg = Luftlinie(Referenz, Ziel) × 1,3
    onroute = live.route_evaluate(
        {
            "city": "Frankfurt",
            "station_id": OTHER,
            "ref_station_id": UID,
            "detour_km": None,
            "mode": "onroute",
        }
    )
    assert onroute["detour_km_source"] == "derived"
    expected = haversine_km(50.12, 8.69, 50.13, 8.70) * 1.3
    assert abs(onroute["detour_km_oneway"] - expected) < 0.05
    assert onroute["ref_station_name"] == "Station One"

    # dedicated: Einweg = dist(Ziel) ab Anker, gesamt = ×2
    dedicated = live.route_evaluate(
        {"city": "Frankfurt", "station_id": OTHER, "mode": "dedicated"}
    )
    assert dedicated["detour_km_source"] == "derived"
    assert abs(dedicated["detour_km_oneway"] - round(dist_other, 1)) < 0.05
    assert dedicated["detour_km_total"] == round(dedicated["detour_km_oneway"] * 2, 2)


def test_route_alt_price_param(b3_settings):
    def query(cfg, flux):
        yield raw_price(NOW - dt.timedelta(minutes=5), UID, "Frankfurt", 1.60)

    live = LiveData(b3_settings, query=query, clock=lambda: NOW)
    result = live.route_evaluate(
        {
            "city": "Frankfurt",
            "fuel": "e10",
            "alt_price": "1.55",
            "ref_price": "1.66",
            "detour_km": "5",
        }
    )
    assert result["target_price"] == 1.55
    assert result["gross_eur"] == round((1.66 - 1.55) * 40.0, 2)


def _by_fuel_artifact(n_stations):
    stations = []
    for i in range(n_stations):
        stations.append(
            {
                "station_id": f"station-{i}",
                "city": "Frankfurt",
                "name": f"S{i}",
                "delta_ct": -float(i),
                "rank": i + 1,
                "score": 10.0 - i,
                "dist_km": round(1.0 + i * 0.3, 1),
                "dist_mode": "air",
                "maps_url": f"https://maps.example/{i}",
            }
        )
    return {
        "generated_at": NOW.isoformat(),
        "fuels": ["e10"],
        "by_fuel": {
            "e10": {
                "generated_at": NOW.isoformat(),
                "fuel": "E10",
                "cities": [{"city": "Frankfurt", "stations": stations}],
                "top_global": stations[:10],
            }
        },
    }


def test_selection_counts_all_stations_not_top_global(b3_settings):
    """Count = alle gerankten Stationen (top_global ist auf 10 gekappt)."""
    sel_path = b3_settings.runtime / "selection" / "current.json"
    sel_path.parent.mkdir(parents=True, exist_ok=True)
    sel_path.write_text(json.dumps(_by_fuel_artifact(12)))

    live = LiveData(b3_settings, query=lambda *_: [], clock=lambda: NOW)
    sel = live.selection("e10", "Frankfurt")
    assert sel["count"] == 12
    assert sel["stations"][0]["dist_km"] == 1.0
    assert sel["stations"][0]["maps_url"] == "https://maps.example/0"

    health = live.health()
    assert health["selection"]["count"] == 12


def test_health_reports_version_and_alarms(b3_settings):
    """B9/B4: /health trägt Version, Commit und einen aggregierten alarms[]-Block."""

    def fail_network(*_):
        raise AssertionError("health muss ohne Netzwerk-Query funktionieren")

    live = LiveData(b3_settings, query=fail_network, clock=lambda: NOW)
    health = live.health()

    # B9: Version ist gesetzt (Fallback None nur in Docker ohne .git möglich).
    assert "version" in health
    assert isinstance(health["version"], str) or health["version"] is None
    assert "commit" in health

    # B4: Alarme als Liste — ohne Collector-Herzschlag mindestens dieser eine.
    assert isinstance(health["alarms"], list)
    codes = {a["code"] for a in health["alarms"]}
    assert "collector_no_heartbeat" in codes
    for alarm in health["alarms"]:
        assert alarm["severity"] in ("error", "warn")
        assert alarm["message"]


def test_health_alarm_for_failed_job(b3_settings):
    """B4: ein fehlgeschlagener NAS-Job erscheint als Alarm in /health."""
    live = LiveData(b3_settings, query=lambda *_: [], clock=lambda: NOW)
    live.job_errors = {"models": "job_start_failed"}
    health = live.health()
    failed = [a for a in health["alarms"] if a["code"] == "job_failed"]
    assert failed, health["alarms"]
    assert failed[0]["job"] == "models"
