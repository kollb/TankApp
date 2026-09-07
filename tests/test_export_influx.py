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


@pytest.fixture
def influx_env_file(tmp_path):
    path = tmp_path / "influx.env"
    # Deliberately fictitious credential; no production secrets in fixtures.
    path.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\n"
        "TANKAPP_INFLUX_ORG=test-org\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\n"
        "TANKAPP_INFLUX_TOKEN=not-a-real-token\n",
        encoding="utf-8",
    )
    return path


@pytest.mark.parametrize(
    "token",
    [
        "TANKAPP_INFLUX_URL=http://nas:8086\r\nTANKAPP_INFLUX_TOKEN=not-a-real-token",
        "TANKAPP_INFLUX_TOKEN=not-a-real-token",
        "Token not-a-real-token",
        "not-a-real-token\n",
        "not-a-real-token\r",
        "not-a-real-token\t",
        "not-a-real-token\x00",
        "not-a-real-token\x7f",
        "\ufeffnot-a-real-token",
        "not-a-real-token\x03",
        "not-a-real-tokené",
    ],
)
def test_malformed_token_rejected_before_http_without_echo(
    exporter, monkeypatch, token
):
    def forbidden(*args, **kwargs):
        raise AssertionError("Malformed credentials must never reach HTTP")

    monkeypatch.setattr(exporter.urllib.request, "build_opener", forbidden)
    cfg = exporter.InfluxConfig("http://nas:8086", "org", "tankapp", token)
    with pytest.raises(exporter.ExportError, match="einzelnen Token") as error:
        list(exporter.query_rows(cfg, "query"))
    assert "--env-file" in str(error.value)
    assert "not-a-real-token" not in str(error.value)
    assert "not-a-real-token" not in repr(cfg)


def test_main_multiline_token_does_not_echo_or_replace_export(
    exporter, polling, influx_env_file, tmp_path, monkeypatch, capsys
):
    contents = influx_env_file.read_text(encoding="utf-8")
    for name, value in exporter.read_env_file(influx_env_file).items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("TANKAPP_INFLUX_TOKEN", contents)
    out = tmp_path / "prices.csv"
    out.write_text("last good export", encoding="utf-8")

    def forbidden(*args, **kwargs):
        raise AssertionError("No HTTP request for a multiline token")

    monkeypatch.setattr(exporter.urllib.request, "build_opener", forbidden)
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
                str(out),
            ]
        )
        == 1
    )
    captured = capsys.readouterr()
    assert "not-a-real-token" not in captured.out + captured.err
    assert "--env-file" in captured.err
    assert out.read_text(encoding="utf-8") == "last good export"


@pytest.mark.parametrize("stage", ["request", "open"])
@pytest.mark.parametrize("kind", ["value", "encoding", "http"])
def test_http_library_errors_never_echo_token(exporter, monkeypatch, stage, kind):
    import http.client

    def fail(*args, **kwargs):
        if kind == "encoding":
            raise UnicodeEncodeError(
                "ascii", "not-a-real-token", 0, 1, "header rejected"
            )
        if kind == "http":
            raise http.client.InvalidURL("Invalid URL: not-a-real-token")
        raise ValueError("Invalid header value b'Token not-a-real-token'")

    if stage == "request":
        monkeypatch.setattr(exporter.urllib.request, "Request", fail)
    else:

        class Opener:
            open = staticmethod(fail)

        monkeypatch.setattr(
            exporter.urllib.request, "build_opener", lambda *args: Opener()
        )
    with pytest.raises(exporter.ExportError, match="HTTP-Anfrage/Antwort") as error:
        list(exporter.query_rows(config(exporter), "query"))
    assert "not-a-real-token" not in str(error.value)
    assert error.value.__suppress_context__


@pytest.mark.parametrize(
    "url",
    [
        "http://nas:not-a-real-token",
        "http://[not-a-real-token",
        "http://nas:8086\r\nnot-a-real-token",
        "http://nas:0",
    ],
)
def test_malformed_url_errors_are_safe(exporter, url):
    with pytest.raises(exporter.ExportError, match="TANKAPP_INFLUX_URL") as error:
        exporter.InfluxConfig(url, "org", "tankapp", "valid-test-token").validate()
    assert "not-a-real-token" not in str(error.value)


def test_env_file_accepts_windows_bom_crlf_quotes_and_padding(exporter, tmp_path):
    path = tmp_path / "influx.env"
    path.write_bytes(
        b"\xef\xbb\xbf"
        + (
            "# local configuration\r\n\r\n"
            'TANKAPP_INFLUX_URL = "http://nas:8086"\r\n'
            "TANKAPP_INFLUX_ORG='test-org'\r\n"
            "TANKAPP_INFLUX_BUCKET = tankapp\r\n"
            'TANKAPP_INFLUX_TOKEN="not-a-real-token=="\r\n'
        ).encode("utf-8")
    )
    cfg = exporter.load_config(path, timeout=10)
    cfg.validate()
    assert (cfg.url, cfg.org, cfg.bucket, cfg.token, cfg.timeout) == (
        "http://nas:8086",
        "test-org",
        "tankapp",
        "not-a-real-token==",
        10,
    )


def test_explicit_file_replaces_stale_environment_without_mutation(
    exporter, influx_env_file, monkeypatch
):
    for name in exporter.INFLUX_KEYS:
        monkeypatch.setenv(name, "stale environment\r\nnot-a-real-token")
    cfg = exporter.load_config(influx_env_file)
    cfg.validate()
    assert cfg.url == "http://nas:8086"
    assert cfg.token == "not-a-real-token"
    assert exporter.os.environ["TANKAPP_INFLUX_TOKEN"].startswith("stale environment")


def test_missing_file_values_do_not_fall_back_to_process_environment(
    exporter, tmp_path, monkeypatch
):
    path = tmp_path / "partial.env"
    path.write_text("TANKAPP_INFLUX_BUCKET=tankapp\n", encoding="utf-8")
    monkeypatch.setenv("TANKAPP_INFLUX_TOKEN", "not-a-real-token")
    cfg = exporter.load_config(path)
    assert cfg.url == cfg.org == cfg.token == ""
    with pytest.raises(exporter.ExportError):
        cfg.validate()


def test_existing_environment_mode_is_unchanged(exporter, monkeypatch):
    monkeypatch.setenv("TANKAPP_INFLUX_URL", "http://nas:8086")
    monkeypatch.setenv("TANKAPP_INFLUX_ORG", "test-org")
    monkeypatch.setenv("TANKAPP_INFLUX_TOKEN", "not-a-real-token==")
    monkeypatch.delenv("TANKAPP_INFLUX_BUCKET", raising=False)
    cfg = exporter.load_config(None)
    cfg.validate()
    assert cfg.bucket == "tankapp"
    assert cfg.token == "not-a-real-token=="


@pytest.mark.parametrize(
    "text",
    [
        "not-a-real-token",  # a token-only file isn't an env file
        "$env:TANKAPP_INFLUX_TOKEN='not-a-real-token'",  # no PowerShell execution
        "TANKAPP_INFLUX_TOKEN='not-a-real-token",  # unclosed quotes
        "TANKAPP_INFLUX_TOKEN=not-a-real-token\nTANKAPP_INFLUX_TOKEN=other",
        "TANKAPP_INFLUX_TYPO=not-a-real-token",  # unknown keys must not silently fall back
    ],
)
def test_env_syntax_errors_report_only_line_number(exporter, tmp_path, text):
    path = tmp_path / "invalid.env"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(exporter.ExportError, match="Zeile") as error:
        exporter.load_config(path)
    assert "not-a-real-token" not in str(error.value)


def test_env_file_never_expands_other_variables(exporter, tmp_path, monkeypatch):
    path = tmp_path / "literal.env"
    path.write_text("TANKAPP_INFLUX_TOKEN=${OTHER_SECRET}\n", encoding="utf-8")
    monkeypatch.setenv("OTHER_SECRET", "not-a-real-token")
    assert exporter.load_config(path).token == "${OTHER_SECRET}"


def test_missing_oversized_or_non_utf8_env_files_fail_safely(exporter, tmp_path):
    path = tmp_path / "influx.env"
    with pytest.raises(exporter.ExportError, match="nicht lesbar"):
        exporter.load_config(path)
    path.write_bytes(b"x" * (exporter.MAX_ENV_BYTES + 1))
    with pytest.raises(exporter.ExportError, match="zu groß"):
        exporter.load_config(path)
    path.write_bytes(b"TANKAPP_INFLUX_TOKEN=not-a-real-token\xff")
    with pytest.raises(exporter.ExportError, match="UTF-8") as error:
        exporter.load_config(path)
    assert "not-a-real-token" not in str(error.value)


def test_main_exports_with_env_file_ignoring_bad_token_variable(
    exporter, polling, influx_env_file, tmp_path, monkeypatch, capsys
):
    monkeypatch.setenv("TANKAPP_INFLUX_TOKEN", "full file contents\r\nnot-a-real-token")
    seen = []

    def query_rows(cfg, query):
        cfg.validate()
        seen.append(cfg)
        return iter([point()])

    monkeypatch.setattr(exporter, "query_rows", query_rows)
    out = tmp_path / "export.csv"
    assert (
        exporter.main(
            [
                "--env-file",
                str(influx_env_file),
                "--polling",
                str(polling),
                "--since",
                "2026-07-01",
                "--until",
                "2026-07-02",
                "--out",
                str(out),
            ]
        )
        == 0
    )
    assert len(seen) == 1 and seen[0].token == "not-a-real-token"
    assert "influxdb" in out.read_text(encoding="utf-8")
    captured = capsys.readouterr()
    assert "not-a-real-token" not in captured.out + captured.err


def test_env_file_dry_run_needs_no_token_or_network(
    exporter, polling, tmp_path, monkeypatch, capsys
):
    path = tmp_path / "preview.env"
    path.write_text("TANKAPP_INFLUX_BUCKET=preview-bucket\n", encoding="utf-8")

    def forbidden(*args, **kwargs):
        raise AssertionError("dry-run must not use the network")

    monkeypatch.setattr(exporter.urllib.request, "build_opener", forbidden)
    assert (
        exporter.main(
            [
                "--env-file",
                str(path),
                "--polling",
                str(polling),
                "--dry-run",
            ]
        )
        == 0
    )
    assert 'from(bucket: "preview-bucket")' in capsys.readouterr().out


def test_cli_does_not_echo_unexpected_library_error_details(
    exporter, polling, influx_env_file, monkeypatch, capsys
):
    def failing(*args, **kwargs):
        raise ValueError("Library error containing not-a-real-token")

    monkeypatch.setattr(exporter, "export_prices", failing)
    assert (
        exporter.main(
            [
                "--env-file",
                str(influx_env_file),
                "--polling",
                str(polling),
            ]
        )
        == 1
    )
    captured = capsys.readouterr()
    assert "not-a-real-token" not in captured.out + captured.err
    assert "Detailinhalte" in captured.err


def test_env_file_cannot_be_the_export_target(exporter, polling, influx_env_file):
    assert (
        exporter.main(
            [
                "--env-file",
                str(influx_env_file),
                "--polling",
                str(polling),
                "--out",
                str(influx_env_file),
            ]
        )
        == 1
    )
    assert exporter.load_config(influx_env_file).token == "not-a-real-token"


def test_explicit_station_id_resolves_identical_names(exporter, polling):
    payload = json.loads(polling.read_text())
    payload["sets"]["Testmarkt"]["batch"].append("station-2")
    payload["sets"]["Testmarkt"]["stations"].append(
        {"uuid": "station-2", "name": "JET, Straße 1"}
    )
    polling.write_text(json.dumps(payload))
    lookup = exporter.station_lookup(polling)
    a = exporter.normalized_row(
        point(station_id="station-1", e10="1.709"), lookup, "e10"
    )
    b = exporter.normalized_row(
        point(station_id="station-2", e10="1.809"), lookup, "e10"
    )
    assert a["station_id"] == "station-1" and b["station_id"] == "station-2"
    assert a["price"] == "1.709" and b["price"] == "1.809"
    with pytest.raises(exporter.ExportError, match="Legacy-Punkt"):
        exporter.normalized_row(point(), lookup, "e10")


def test_unknown_explicit_id_never_falls_back_to_name(exporter, polling):
    with pytest.raises(exporter.ExportError, match="Kein Namens-Fallback"):
        exporter.normalized_row(
            point(station_id="unknown-uuid"), exporter.station_lookup(polling), "e10"
        )
    row = exporter.normalized_row(
        point(station_id="station-1", station="renamed label"),
        exporter.station_lookup(polling),
        "e10",
    )
    assert row["station_id"] == "station-1"


def test_uuid_only_query_preserves_id_and_filters_per_city(exporter):
    q = exporter.flux_query(
        "tankapp",
        "e10",
        exporter.instant("2026-09-07"),
        exporter.instant("2026-09-08"),
        ["A", "B"],
        {"A": ["uuid-a"], "B": ["uuid-b"]},
    )
    assert "exists r.station_id" in q
    assert 'r.city == "A" and contains(value: r.station_id, set: ["uuid-a"])' in q
    assert 'r.city == "B" and contains(value: r.station_id, set: ["uuid-b"])' in q
    assert '"station_id"' in q.split("keep(columns:")[1]


def test_uuid_csv_header_and_status_survive_parser(exporter):
    text = ",_time,city,station,station_id,status,e10\n,2026-09-07T06:00:00Z,Testmarkt,label,station-1,closed,\n"
    rows = list(exporter.parse_flux_csv(io.StringIO(text)))
    assert rows[0]["station_id"] == "station-1"
    assert rows[0]["status"] == "closed"


def test_uuid_only_export_refuses_legacy_and_preserves_last_file(
    exporter, polling, tmp_path, monkeypatch
):
    out = tmp_path / "prices.csv"
    out.write_text("old valid export")
    monkeypatch.setattr(exporter, "query_rows", lambda cfg, query: iter([point()]))
    with pytest.raises(exporter.ExportError, match="ohne station_id"):
        exporter.export_prices(
            config(exporter),
            exporter.instant("2026-07-01"),
            exporter.instant("2026-07-02"),
            exporter.station_lookup(polling),
            "e10",
            out,
            uuid_only=True,
        )
    assert out.read_text() == "old valid export"


def test_uuid_only_export_has_actionable_empty_result(
    exporter, polling, tmp_path, monkeypatch
):
    monkeypatch.setattr(exporter, "query_rows", lambda cfg, query: iter([]))
    with pytest.raises(exporter.ExportError, match="JSONL-Replay"):
        exporter.export_prices(
            config(exporter),
            exporter.instant("2026-07-01"),
            exporter.instant("2026-07-02"),
            exporter.station_lookup(polling),
            "e10",
            tmp_path / "nothing.csv",
            uuid_only=True,
        )


def test_uuid_only_export_and_dry_run(
    exporter, polling, influx_env_file, tmp_path, monkeypatch, capsys
):
    seen = []

    def query(cfg, text):
        seen.append(text)
        return iter([point(station_id="station-1")])

    monkeypatch.setattr(exporter, "query_rows", query)
    out = tmp_path / "prices.csv"
    args = [
        "--env-file",
        str(influx_env_file),
        "--polling",
        str(polling),
        "--since",
        "2026-07-01",
        "--until",
        "2026-07-02",
        "--uuid-only",
        "--out",
        str(out),
    ]
    assert exporter.main(args) == 0
    assert "exists r.station_id" in seen[0]
    assert "station-1" in out.read_text()
    assert "UUID-Modus" in capsys.readouterr().out
    assert exporter.main([*args, "--dry-run"]) == 0
    assert "exists r.station_id" in capsys.readouterr().out


def test_uuid_alias_like_another_name_still_uses_exact_id(exporter):
    lookup = {
        ("Testmarkt", "station-1"): {
            "station-1": {"name": "Real station"},
            "station-2": {"name": "station-1"},
        }
    }
    row = exporter.normalized_row(point(station_id="station-1"), lookup, "e10")
    assert row["station_id"] == "station-1" and row["station_name"] == "Real station"


def test_uuid_mode_not_confused_with_connection_check(exporter):
    with pytest.raises(SystemExit) as error:
        exporter.main(["--check-connection", "--uuid-only"])
    assert error.value.code == 2
