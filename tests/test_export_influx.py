import csv
import datetime as dt
import gzip
import io
import json
import urllib.error

import pytest


@pytest.fixture
def polling(tmp_path):
    path = tmp_path / "polling.json"
    path.write_text(
        json.dumps(
            {
                "sets": {
                    "Testmarkt": {
                        "label": "Testmarkt",
                        "batch": ["station-1"],
                        "stations": [
                            {
                                "uuid": "station-1",
                                "name": "JET, Straße 1",
                                "brand": "JET",
                            }
                        ],
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    return path


def point(**changes):
    return {
        "_time": "2026-07-01T06:00:00Z",
        "city": "Testmarkt",
        "station": "JET, Straße 1",
        "status": "open",
        "e10": "1.709",
        **changes,
    }


def config(exporter):
    return exporter.InfluxConfig(
        "http://nas:8086", "test-org", "tankapp", "not-a-real-token"
    )


def test_station_name_and_uuid_join_to_same_stable_id(exporter, polling):
    lookup = exporter.station_lookup(polling)
    row = exporter.normalized_row(point(), lookup, "e10")
    fallback = exporter.normalized_row(point(station="station-1"), lookup, "e10")
    assert row == fallback
    assert row["station_id"] == "station-1"
    assert row["price"] == "1.709"
    assert row["source"] == "influxdb"
    assert "lat" in row and row["lat"] == ""


@pytest.mark.parametrize(
    "status,price",
    [
        ("closed", "1.709"),
        ("no prices", ""),
        ("open", "false"),
        ("open", "true"),
        ("open", "NaN"),
        ("open", "0"),
        ("open", ""),
    ],
)
def test_closed_and_unavailable_fuel_are_preserved_without_price(
    exporter, polling, status, price
):
    row = exporter.normalized_row(
        point(status=status, e10=price), exporter.station_lookup(polling), "e10"
    )
    assert row["price"] == ""
    assert row["status"] == status


def test_ambiguous_name_fails_instead_of_guessing_uuid(exporter, polling):
    payload = json.loads(polling.read_text())
    payload["sets"]["Testmarkt"]["batch"].append("station-2")
    payload["sets"]["Testmarkt"]["stations"].append(
        {"uuid": "station-2", "name": "JET, Straße 1"}
    )
    polling.write_text(json.dumps(payload))
    with pytest.raises(ValueError, match="mehrdeutig"):
        exporter.normalized_row(point(), exporter.station_lookup(polling), "e10")


def test_unknown_station_fails(exporter, polling):
    with pytest.raises(ValueError, match="nicht in polling.json"):
        exporter.normalized_row(
            point(station="unknown"), exporter.station_lookup(polling), "e10"
        )


def test_annotated_csv_multiple_tables_and_status_only_rows(exporter):
    text = """#datatype,string,long,dateTime:RFC3339,string,string,string,double
#group,false,false,false,true,true,false,false
#default,_result,,,,,,
,result,table,_time,city,station,status,e10
,,0,2026-07-01T06:00:00Z,Testmarkt,"JET, Straße 1",open,1.709

#datatype,string,long,dateTime:RFC3339,string,string,string
#group,false,false,false,true,true,false
#default,_result,,,,,
,result,table,_time,city,station,status
,,1,2026-07-01T06:05:00Z,Testmarkt,station-1,closed
"""
    rows = list(exporter.parse_flux_csv(io.StringIO(text)))
    assert len(rows) == 2
    assert rows[0]["station"] == "JET, Straße 1"
    assert "e10" not in rows[1]


@pytest.mark.parametrize(
    "text",
    [
        ",error,reference\n,secret-message,123\n",
        "not,flux\na,b\n",
        ",_time,city,station\n,a,b,c\n",
    ],
)
def test_csv_errors_do_not_become_empty_success(exporter, text):
    with pytest.raises(ValueError):
        list(exporter.parse_flux_csv(io.StringIO(text)))


def test_readonly_flux_and_literal_escaping(exporter):
    start = exporter.instant("2026-07-01")
    stop = exporter.instant("2026-07-02")
    query = exporter.flux_query('tank"app', "e10", start, stop, ['Town"Name'])
    assert 'from(bucket: "tank\\"app")' in query
    assert '"Town\\"Name"' in query
    assert "|> pivot(" in query and "status" in query
    assert "to(" not in query and "delete" not in query
    assert start.hour == 22 and start.day == 30


def test_daily_windows_non_overlapping_and_dst_range(exporter):
    start, stop = exporter.instant("2026-03-29"), exporter.instant("2026-03-30")
    windows = list(exporter.time_windows(start, stop))
    assert len(windows) == 1
    assert stop - start == dt.timedelta(hours=23)
    windows = list(exporter.time_windows(start, stop + dt.timedelta(days=2)))
    assert all(left[1] == right[0] for left, right in zip(windows, windows[1:]))
    with pytest.raises(ValueError):
        list(exporter.time_windows(stop, start))
    with pytest.raises(ValueError, match="UTC-Offset"):
        exporter.instant("2026-10-25T02:30:00")


def test_atomic_gzip_export_and_no_partial_overwrite(
    exporter, polling, tmp_path, monkeypatch
):
    out = tmp_path / "export.csv.gz"
    lookup = exporter.station_lookup(polling)
    monkeypatch.setattr(exporter, "query_rows", lambda cfg, query: iter([point()]))
    result = exporter.export_prices(
        config(exporter),
        exporter.instant("2026-07-01"),
        exporter.instant("2026-07-02"),
        lookup,
        "e10",
        out,
    )
    assert result["rows"] == result["open_prices"] == 1
    with gzip.open(out, "rt", encoding="utf-8") as handle:
        assert list(csv.DictReader(handle))[0]["station_id"] == "station-1"
    original = out.read_bytes()

    def failing(cfg, query):
        yield point()
        raise ValueError("Late Flux error")

    monkeypatch.setattr(exporter, "query_rows", failing)
    with pytest.raises(ValueError, match="Late Flux"):
        exporter.export_prices(
            config(exporter),
            exporter.instant("2026-07-01"),
            exporter.instant("2026-07-02"),
            lookup,
            "e10",
            out,
        )
    assert original == out.read_bytes()
    assert not list(tmp_path.glob("*.tmp"))


def test_empty_export_preserves_old_file(exporter, polling, tmp_path, monkeypatch):
    out = tmp_path / "export.csv"
    out.write_text("last good file")
    monkeypatch.setattr(exporter, "query_rows", lambda cfg, query: iter([]))
    with pytest.raises(ValueError, match="Keine InfluxDB-Daten"):
        exporter.export_prices(
            config(exporter),
            exporter.instant("2026-07-01"),
            exporter.instant("2026-07-02"),
            exporter.station_lookup(polling),
            "e10",
            out,
        )
    assert out.read_text() == "last good file"


def test_dry_run_needs_no_token_and_never_calls_network(
    exporter, polling, tmp_path, monkeypatch, capsys
):
    def forbidden(*args, **kwargs):
        raise AssertionError("network is forbidden")

    monkeypatch.setattr(exporter.urllib.request, "build_opener", forbidden)
    monkeypatch.delenv("TANKAPP_INFLUX_TOKEN", raising=False)
    output = tmp_path / "nothing.csv"
    assert (
        exporter.main(
            [
                "--polling",
                str(polling),
                "--since",
                "2026-07-01",
                "--until",
                "2026-07-02",
                "--out",
                str(output),
                "--dry-run",
            ]
        )
        == 0
    )
    assert not output.exists()
    assert "Nur lesend" in capsys.readouterr().out


def test_http_auth_error_does_not_echo_credentials(exporter, monkeypatch):
    class FakeOpener:
        def open(self, request, timeout):
            assert request.method == "POST"
            assert request.full_url == "http://nas:8086/api/v2/query?org=test-org"
            assert request.get_header("Authorization") == "Token not-a-real-token"
            raise urllib.error.HTTPError(
                request.full_url,
                403,
                "not-a-real-token",
                {},
                io.BytesIO(b"echo: not-a-real-token"),
            )

    monkeypatch.setattr(
        exporter.urllib.request, "build_opener", lambda *args: FakeOpener()
    )
    with pytest.raises(ValueError, match="Leserecht") as error:
        list(exporter.query_rows(config(exporter), 'from(bucket: "tankapp")'))
    assert "not-a-real-token" not in str(error.value)
    assert "not-a-real-token" not in repr(config(exporter))
    assert (
        exporter.NoRedirect().redirect_request(None, None, 302, "", {}, "http://other")
        is None
    )


@pytest.mark.parametrize(
    "url",
    ["ftp://nas", "http://user:password@nas", "http://nas/?token=secret", "nas:8086"],
)
def test_url_rejects_credentials_and_non_http(exporter, url):
    with pytest.raises(ValueError, match="URL"):
        exporter.InfluxConfig(url, "org", "bucket", "not-a-real-token").validate()


def test_csv_default_values_are_applied(exporter):
    text = "#default,,Testmarkt,station-1,open,\n_time,unused,city,station,status,e10\n2026-07-01T06:00:00Z,,,,,1.709\n"
    row = list(exporter.parse_flux_csv(io.StringIO(text)))[0]
    assert (row["city"], row["station"], row["status"]) == (
        "Testmarkt",
        "station-1",
        "open",
    )


@pytest.mark.parametrize("truncate", [False, True])
def test_real_http_response_stream_and_early_eof(exporter, monkeypatch, truncate):
    import http.client

    payload = (
        b",_time,city,station,status,e10\n"
        b",2026-07-01T06:00:00Z,Testmarkt,station-1,open,1.709\n"
    )
    length = len(payload) + (100 if truncate else 0)

    class Socket:
        def makefile(self, *args):
            return io.BytesIO(
                f"HTTP/1.1 200 OK\r\nContent-Length: {length}\r\n\r\n".encode()
                + payload
            )

    class Opener:
        def open(self, request, timeout):
            response = http.client.HTTPResponse(Socket())
            response.begin()
            return response

    monkeypatch.setattr(exporter.urllib.request, "build_opener", lambda *args: Opener())
    if truncate:
        with pytest.raises(ValueError, match="Unvollständige HTTP"):
            list(exporter.query_rows(config(exporter), "query"))
    else:
        assert list(exporter.query_rows(config(exporter), "query"))[0]["e10"] == "1.709"


def test_export_cannot_overwrite_a_polling_json(exporter, polling):
    with pytest.raises(ValueError, match="Exportziel"):
        exporter.export_prices(
            config(exporter),
            exporter.instant("2026-07-01"),
            exporter.instant("2026-07-02"),
            exporter.station_lookup(polling),
            "e10",
            polling,
        )
    assert "sets" in json.loads(polling.read_text())
