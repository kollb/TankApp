"""Real local HTTP round trips, not a real InfluxDB or access to the user's NAS."""

import csv
import datetime as dt
import gzip
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


# One row per series, including both numeric fuel tables and a string status
# table, like the Data Explorer's limit(n: 1) response. Prices are test fixtures.
SERIES_CSV = """#datatype,string,long,string,string,double,dateTime:RFC3339,string,string
#default,_result,,,,,,,
,result,table,_measurement,_field,_value,_time,city,station
,,0,prices,diesel,1.5,2026-09-07T06:00:00Z,Testmarkt,Teststation
,,1,prices,e10,1.6,2026-09-07T06:00:00Z,Testmarkt,Teststation
,,2,prices,e5,1.7,2026-09-07T06:00:00Z,Testmarkt,Teststation

#datatype,string,long,string,string,string,dateTime:RFC3339,string,string
#default,_result,,,,,,,
,result,table,_measurement,_field,_value,_time,city,station
,,3,prices,status,open,2026-09-07T06:00:00Z,Testmarkt,Teststation
""".encode()

UUID_PIVOT_CSV = """,result,table,_time,city,station,station_id,status,e10
,,0,2026-09-07T06:00:00Z,Testmarkt,Aral Test,station-1,open,1.6
,,1,2026-09-07T06:00:00Z,Testmarkt,Aral Test,station-2,open,1.8
""".encode()


PIVOT_CSV = """,result,table,_time,city,station,status,e10
,,0,2026-09-07T06:00:00Z,Testmarkt,Teststation,open,1.6
,,0,2026-09-07T06:05:00Z,Testmarkt,Teststation,closed,
,,0,2026-09-07T06:10:00Z,Testmarkt,Teststation,open,
""".encode()


@pytest.fixture
def http_endpoint():
    requests = []

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass  # no request/credential dumps, even in test logs

        def do_GET(self):
            requests.append(("GET", self.path, dict(self.headers), b""))
            body = json.dumps(
                {"name": "influxdb", "status": "pass", "version": "2.7.12"}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            requests.append(("POST", self.path, dict(self.headers), body))
            if self.headers.get("Content-Type") != "application/vnd.flux":
                self.send_error(415)  # enforce the simpler, documented wire format
                return
            if b"exists r.station_id" in body:
                data = UUID_PIVOT_CSV
            else:
                data = PIVOT_CSV if b"pivot(" in body else SERIES_CSV
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for offset in range(0, len(data), 23):
                chunk = data[offset : offset + 23]
                self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()

    server = ThreadingHTTPServer(("0.0.0.0", 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive()


def test_connection_uses_the_working_browser_query_as_plain_flux(
    exporter, http_endpoint, capsys
):
    url, requests = http_endpoint
    cfg = exporter.InfluxConfig(
        url, "test org", "tankapp", "not-a-real-token", no_proxy=True
    )
    exporter.check_connection(cfg)
    assert len(requests) == 2
    assert requests[0][0:2] == ("GET", "/health")
    assert "Authorization" not in requests[0][2]
    method, path, headers, body = requests[1]
    assert (method, path) == ("POST", "/api/v2/query?org=test+org")
    assert headers["Authorization"] == "Token not-a-real-token"
    assert headers["Content-Type"] == "application/vnd.flux"
    assert headers["Accept"] == "application/csv"
    assert body.decode() == (
        'from(bucket: "tankapp")\n'
        "  |> range(start: -1h)\n"
        '  |> filter(fn: (r) => r._measurement == "prices")\n'
        "  |> limit(n: 1)\n"
    )
    output = capsys.readouterr()
    assert "3/3 Lesezugriff: OK" in output.out
    assert "not-a-real-token" not in output.out + output.err
    assert "Teststation" not in output.out


def test_export_reads_plain_flux_stream_without_custom_json_dialect(
    exporter, http_endpoint, tmp_path
):
    url, requests = http_endpoint
    cfg = exporter.InfluxConfig(
        url, "test org", "tankapp", "not-a-real-token", no_proxy=True
    )
    lookup = {("Testmarkt", "Teststation"): {"station-1": {"name": "Teststation"}}}
    out = tmp_path / "prices.csv.gz"
    summary = exporter.export_prices(
        cfg,
        dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc),
        dt.datetime(2026, 9, 8, tzinfo=dt.timezone.utc),
        lookup,
        "e10",
        out,
    )
    assert summary["rows"] == 3 and summary["open_prices"] == 1
    with gzip.open(out, "rt", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert [row["price"] for row in rows] == ["1.600", "", ""]
    assert [row["status"] for row in rows] == ["open", "closed", "open"]
    assert len(requests) == 1 and requests[0][0] == "POST"
    assert requests[0][2]["Content-Type"] == "application/vnd.flux"
    assert requests[0][3].startswith(b'from(bucket: "tankapp")\n')
    assert b"pivot(" in requests[0][3] and b'"dialect"' not in requests[0][3]


def test_uuid_export_keeps_two_equal_names_distinct_over_http(
    exporter, http_endpoint, tmp_path
):
    url, requests = http_endpoint
    cfg = exporter.InfluxConfig(
        url, "test org", "tankapp", "not-a-real-token", no_proxy=True
    )
    meta = {"station-1": {"name": "Aral Test"}, "station-2": {"name": "Aral Test"}}
    lookup = {
        ("Testmarkt", "Aral Test"): meta,
        ("Testmarkt", "station-1"): {"station-1": meta["station-1"]},
        ("Testmarkt", "station-2"): {"station-2": meta["station-2"]},
    }
    out = tmp_path / "uuid.csv"
    summary = exporter.export_prices(
        cfg,
        dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc),
        dt.datetime(2026, 9, 8, tzinfo=dt.timezone.utc),
        lookup,
        "e10",
        out,
        uuid_only=True,
    )
    assert summary["identity_mode"] == "uuid_only" and summary["rows"] == 2
    with out.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert [(row["station_id"], row["price"]) for row in rows] == [
        ("station-1", "1.600"),
        ("station-2", "1.800"),
    ]
    assert b"exists r.station_id" in requests[0][3]
