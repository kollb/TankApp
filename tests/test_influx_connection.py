"""Connection diagnostics use synthetic HTTP responses, never the user's NAS."""

import http.client
import io
import json
import socket
import ssl
import urllib.error

import pytest


HEALTH = json.dumps(
    {"name": "influxdb", "status": "pass", "version": "v2.7.12"}
).encode()
CSV = (
    b"#datatype,string,long,dateTime:RFC3339\n"
    b"#default,_result,,\n"
    b",result,table,_time\n"
    b",,0,2026-09-07T16:00:00Z\n"
)


def response(body, content_type="application/json", extra_length=0):
    class Socket:
        def makefile(self, *args):
            return io.BytesIO(
                (
                    "HTTP/1.1 200 OK\r\n"
                    f"Content-Length: {len(body) + extra_length}\r\n"
                    f"Content-Type: {content_type}\r\n\r\n"
                ).encode()
                + body
            )

    result = http.client.HTTPResponse(Socket())
    result.begin()
    return result


@pytest.fixture
def check_args(tmp_path):
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086/influx\n"
        "TANKAPP_INFLUX_ORG=test-org\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\n"
        "TANKAPP_INFLUX_TOKEN=not-a-real-token\n",
        encoding="utf-8",
    )
    return ["--env-file", str(env), "--check-connection", "--timeout", "15"]


def attach_server(exporter, monkeypatch, health, query):
    calls = []

    class Opener:
        def open(self, request, timeout):
            calls.append(request)
            assert timeout == 15
            if len(calls) == 1:
                assert request.full_url == "http://nas:8086/influx/health"
                assert request.method == "GET"
                assert request.get_header("Authorization") is None
                return health(request)
            assert len(calls) == 2, "The check must not start a 70-day export"
            assert request.method == "POST"
            assert (
                request.full_url == "http://nas:8086/influx/api/v2/query?org=test-org"
            )
            assert request.get_header("Authorization") == "Token not-a-real-token"
            return query(request)

    monkeypatch.setattr(exporter.urllib.request, "build_opener", lambda *args: Opener())
    return calls


@pytest.mark.parametrize("body", [CSV, b""])
def test_check_needs_no_polling_set_and_does_not_write_exports(
    exporter, check_args, monkeypatch, tmp_path, capsys, body
):
    seen_query = []

    def query(request):
        payload = json.loads(request.data)
        seen_query.append(payload["query"])
        return response(body, "application/csv; charset=utf-8")

    calls = attach_server(
        exporter, monkeypatch, lambda request: response(HEALTH), query
    )
    monkeypatch.setenv("TANKAPP_INFLUX_TOKEN", "wrong session\r\nnot-a-real-token")

    def forbidden(*args, **kwargs):
        raise AssertionError(
            "The connection check must not load a polling set or export data"
        )

    monkeypatch.setattr(exporter, "station_lookup", forbidden)
    monkeypatch.setattr(exporter, "export_prices", forbidden)
    previous = tmp_path / "previous.csv"
    previous.write_text("last good export", encoding="utf-8")
    before = set(tmp_path.iterdir())
    assert (
        exporter.main(
            [
                *check_args,
                "--polling",
                str(tmp_path / "missing.json"),
                "--out",
                str(previous),
            ]
        )
        == 0
    )
    assert len(calls) == 2
    assert 'from(bucket: "tankapp")' in seen_query[0]
    assert "range(start: -1h)" in seen_query[0]
    assert seen_query[0].count("limit(n: 1)") == 2
    assert 'keep(columns: ["_time"])' in seen_query[0]
    assert "buckets()" not in seen_query[0] and "to(" not in seen_query[0]
    assert set(tmp_path.iterdir()) == before
    assert previous.read_text(encoding="utf-8") == "last good export"
    captured = capsys.readouterr()
    assert "1/3 Konfiguration: OK" in captured.out
    assert "2/3 InfluxDB: bereit" in captured.out
    assert "3/3 Lesezugriff: OK" in captured.out
    assert ("keine prices-Punkte" in captured.out) == (body == b"")
    assert "not-a-real-token" not in captured.out + captured.err


@pytest.mark.parametrize("code", [401, 403, 404, 503, 302])
def test_health_http_failure_never_sends_token_or_starts_query(
    exporter, check_args, monkeypatch, capsys, code
):
    def fail(request):
        raise urllib.error.HTTPError(
            request.full_url,
            code,
            "not-a-real-token",
            {},
            io.BytesIO(b"not-a-real-token"),
        )

    calls = attach_server(
        exporter, monkeypatch, fail, lambda request: response(CSV, "application/csv")
    )
    assert exporter.main(check_args) == 1
    assert len(calls) == 1
    captured = capsys.readouterr()
    assert f"Health-Endpunkt HTTP {code}" in captured.err
    assert "noch nicht geprüft" in captured.err
    assert "not-a-real-token" not in captured.out + captured.err


@pytest.mark.parametrize(
    "body",
    [
        b"<html>not-a-real-token</html>",
        b'{"name":"not-a-real-token","status":"pass"}',
        b'{"name":"influxdb","status":"fail","message":"not-a-real-token"}',
        b'{"name":"influxdb","status":"pass","version":"1.8.10"}',
        b'{"name":"influxdb","status":"pass","version":"3.1.0"}',
        b"[]",
        b"\xffnot-a-real-token",
        b"x" * 65537,
    ],
)
def test_wrong_or_unready_service_does_not_receive_credentials(
    exporter, check_args, monkeypatch, capsys, body
):
    calls = attach_server(
        exporter,
        monkeypatch,
        lambda request: response(body),
        lambda request: response(CSV, "application/csv"),
    )
    assert exporter.main(check_args) == 1
    assert len(calls) == 1
    captured = capsys.readouterr()
    assert "not-a-real-token" not in captured.out + captured.err
    assert "3/3" not in captured.out


def test_partial_health_response_cannot_be_success(
    exporter, check_args, monkeypatch, capsys
):
    calls = attach_server(
        exporter,
        monkeypatch,
        lambda request: response(HEALTH, extra_length=20),
        lambda request: response(CSV, "application/csv"),
    )
    assert exporter.main(check_args) == 1
    assert len(calls) == 1
    assert "unvollständig" in capsys.readouterr().err


@pytest.mark.parametrize(
    "code,expected",
    [
        (401, "Leseberechtigung"),
        (403, "Leserecht"),
        (404, "Org/Bucket"),
        (400, "Flux-Unterstützung"),
        (407, "Proxy"),
        (429, "Server ausgelastet"),
    ],
)
def test_query_auth_failure_is_not_a_network_failure(
    exporter, check_args, monkeypatch, capsys, code, expected
):
    def fail(request):
        raise urllib.error.HTTPError(
            request.full_url,
            code,
            "not-a-real-token",
            {},
            io.BytesIO(b"not-a-real-token"),
        )

    calls = attach_server(exporter, monkeypatch, lambda request: response(HEALTH), fail)
    assert exporter.main(check_args) == 1
    assert len(calls) == 2
    captured = capsys.readouterr()
    assert "2/3 InfluxDB: bereit" in captured.out
    assert f"InfluxDB HTTP {code}" in captured.err
    assert expected in captured.err
    assert "3/3 Lesezugriff: OK" not in captured.out
    assert "not-a-real-token" not in captured.out + captured.err


@pytest.mark.parametrize("stage", ["health", "query"])
@pytest.mark.parametrize(
    "error,expected",
    [
        (TimeoutError("not-a-real-token"), "Zeitüberschreitung"),
        (
            urllib.error.URLError(socket.timeout("not-a-real-token")),
            "Zeitüberschreitung",
        ),
        (
            urllib.error.URLError(ConnectionRefusedError("not-a-real-token")),
            "Verbindung abgelehnt",
        ),
        (
            urllib.error.URLError(socket.gaierror("not-a-real-token")),
            "Hostname nicht auflösbar",
        ),
        (
            urllib.error.URLError(ssl.SSLCertVerificationError("not-a-real-token")),
            "TLS-Zertifikat",
        ),
        (urllib.error.URLError(ssl.SSLError("not-a-real-token")), "TLS-Verbindung"),
        (urllib.error.URLError("not-a-real-token"), "Netz-/Lesefehler"),
    ],
)
def test_transport_failures_are_classified_without_exception_contents(
    exporter, check_args, monkeypatch, capsys, stage, error, expected
):
    def fail(request):
        raise error

    attach_server(
        exporter,
        monkeypatch,
        fail if stage == "health" else lambda request: response(HEALTH),
        fail if stage == "query" else lambda request: response(CSV, "application/csv"),
    )
    assert exporter.main(check_args) == 1
    captured = capsys.readouterr()
    assert expected in captured.err
    assert ("Health-Endpunkt" if stage == "health" else "Flux-Query") in captured.err
    assert "not-a-real-token" not in captured.out + captured.err


@pytest.mark.parametrize(
    "body,content_type",
    [
        (b"", "text/html"),
        (CSV, ""),
        (b",error,reference\n,not-a-real-token,1\n", "application/csv"),
        (b",result,table,_time\n,,0,not-a-real-token\n", "application/csv"),
        (CSV + b",,0,2026-09-07T16:01:00Z\n", "application/csv"),
    ],
)
def test_bad_query_response_never_becomes_success(
    exporter, check_args, monkeypatch, capsys, body, content_type
):
    attach_server(
        exporter,
        monkeypatch,
        lambda request: response(HEALTH),
        lambda request: response(body, content_type),
    )
    assert exporter.main(check_args) == 1
    captured = capsys.readouterr()
    assert "3/3 Lesezugriff: OK" not in captured.out
    assert "not-a-real-token" not in captured.out + captured.err


def test_check_and_dry_run_are_mutually_exclusive(exporter):
    with pytest.raises(SystemExit) as error:
        exporter.main(["--check-connection", "--dry-run"])
    assert error.value.code == 2


@pytest.mark.parametrize(
    "token", ["<DEIN-INFLUXDB-LESE-TOKEN>", "<NUR-LESE-TOKEN>", "<Secret>", "<SECRET>"]
)
def test_known_placeholders_fail_before_network(exporter, token, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("No network for a known placeholder")

    monkeypatch.setattr(exporter.urllib.request, "build_opener", forbidden)
    cfg = exporter.InfluxConfig("http://nas:8086", "org", "tankapp", token)
    with pytest.raises(exporter.ExportError, match="Platzhalter"):
        exporter.check_connection(cfg)


def windows_socket_error(code):
    # Construct generic OSError as can be wrapped by urllib on Windows.
    error = OSError(0, "not-a-real-token")
    error.errno = code
    error.winerror = code
    return error


@pytest.mark.parametrize(
    "code,expected",
    [
        (10054, "Verbindung zurückgesetzt"),
        (10053, "Verbindung abgebrochen"),
        (10061, "Verbindung abgelehnt"),
        (10060, "Zeitüberschreitung"),
    ],
)
@pytest.mark.parametrize("during_read", [False, True])
def test_windows_error_codes_and_http_phase_are_visible_but_secrets_are_not(
    exporter, check_args, monkeypatch, capsys, code, expected, during_read
):
    def fail(*args, **kwargs):
        raise urllib.error.URLError(windows_socket_error(code))

    def query(request):
        if not during_read:
            return fail()
        result = response(CSV, "application/csv")
        result.read1 = fail
        return result

    attach_server(exporter, monkeypatch, lambda request: response(HEALTH), query)
    assert exporter.main(check_args) == 1
    captured = capsys.readouterr()
    assert expected in captured.err
    assert f"errno={code}" in captured.err
    assert f"winerror={code}" in captured.err
    assert "Typ=URLError/OSError" in captured.err
    if during_read:
        assert "Phase=CSV-Antwort lesen" in captured.err
        assert "HTTP=200" in captured.err
    else:
        assert "Phase=POST senden / HTTP-Header empfangen" in captured.err
        assert "HTTP=unbekannt" in captured.err
    assert "not-a-real-token" not in captured.out + captured.err


@pytest.mark.parametrize(
    "error,kind",
    [
        (ConnectionResetError(104, "not-a-real-token"), "ConnectionResetError"),
        (ConnectionAbortedError(103, "not-a-real-token"), "ConnectionAbortedError"),
        (BrokenPipeError(32, "not-a-real-token"), "BrokenPipeError"),
        (http.client.RemoteDisconnected("not-a-real-token"), "RemoteDisconnected"),
    ],
)
def test_native_connection_errors_are_not_misreported_as_bad_credentials(
    exporter, check_args, monkeypatch, capsys, error, kind
):
    def fail(request):
        raise error

    attach_server(exporter, monkeypatch, lambda request: response(HEALTH), fail)
    assert exporter.main(check_args) == 1
    captured = capsys.readouterr()
    assert f"Typ={kind}" in captured.err
    assert "HTTP=unbekannt" in captured.err
    assert "HTTP 401" not in captured.err
    assert "not-a-real-token" not in captured.out + captured.err


def test_unknown_error_details_do_not_echo_messages_or_arbitrary_fields(exporter):
    error = OSError("not-a-real-token")
    error.errno = "not-a-real-token"
    error.winerror = 999999999999999999999999
    result = str(
        exporter.network_error(
            urllib.error.URLError(error), "Flux-Query", "CSV lesen", 200
        )
    )
    assert "Typ=URLError/OSError" in result
    assert "HTTP=200" in result
    assert "not-a-real-token" not in result
    assert "winerror=" not in result
    assert "errno=" not in result
    result = str(
        exporter.network_error(urllib.error.URLError("not-a-real-token"), "Flux-Query")
    )
    assert "Typ=URLError/Textursache" in result
    assert "not-a-real-token" not in result


@pytest.mark.parametrize(
    "configured,bypass,expected",
    [
        (False, False, "kein passender Proxy"),
        (True, False, "Proxy laut urllib vorgesehen"),
        (True, True, "NAS laut Bypass-Regel direkt"),
    ],
)
def test_proxy_diagnostic_reports_intent_never_proxy_credentials(
    exporter, monkeypatch, configured, bypass, expected
):
    proxies = (
        {"http": "http://user:not-a-real-token@proxy.invalid:3128"}
        if configured
        else {}
    )
    monkeypatch.setattr(exporter.urllib.request, "getproxies", lambda: proxies)
    seen = []

    def check_bypass(host):
        seen.append(host)
        return bypass

    monkeypatch.setattr(exporter.urllib.request, "proxy_bypass", check_bypass)
    cfg = exporter.InfluxConfig(
        "http://nas:8086/influx", "org", "tankapp", "not-a-real-token"
    )
    output = exporter.proxy_diagnostic(cfg)
    assert expected in output
    assert seen == (["nas:8086"] if configured else [])
    assert "not-a-real-token" not in output
    assert "proxy.invalid" not in output


def test_proxy_config_read_failure_does_not_stop_check_or_echo_secrets(
    exporter, monkeypatch
):
    def failing():
        raise OSError("not-a-real-token")

    monkeypatch.setattr(exporter.urllib.request, "getproxies", failing)
    cfg = exporter.InfluxConfig("http://nas:8086", "org", "tankapp", "not-a-real-token")
    output = exporter.proxy_diagnostic(cfg)
    assert "nicht bestimmbar" in output
    assert "not-a-real-token" not in output


def test_no_proxy_opener_is_explicit_and_retains_redirect_protection(
    exporter, monkeypatch
):
    handlers = []
    monkeypatch.setattr(
        exporter.urllib.request, "build_opener", lambda *args: handlers.extend(args)
    )
    monkeypatch.setenv("http_proxy", "http://user:not-a-real-token@proxy.invalid:3128")
    before = dict(exporter.os.environ)
    cfg = exporter.InfluxConfig(
        "http://nas:8086", "org", "tankapp", "not-a-real-token", no_proxy=True
    )
    exporter.http_opener(cfg)
    assert any(isinstance(handler, exporter.NoRedirect) for handler in handlers)
    proxy_handlers = [
        handler
        for handler in handlers
        if isinstance(handler, exporter.urllib.request.ProxyHandler)
    ]
    assert len(proxy_handlers) == 1 and proxy_handlers[0].proxies == {}
    assert not any(
        isinstance(handler, exporter.urllib.request.HTTPSHandler)
        for handler in handlers
    )
    assert exporter.os.environ == before
    assert "direkt angefordert" in exporter.proxy_diagnostic(cfg)


def test_no_proxy_flag_applies_to_both_health_and_query(
    exporter, check_args, monkeypatch, capsys
):
    calls = []

    class Opener:
        def open(self, request, timeout):
            calls.append(request)
            if request.method == "GET":
                assert request.get_header("Authorization") is None
                return response(HEALTH)
            assert request.method == "POST"
            assert request.get_header("Authorization") == "Token not-a-real-token"
            return response(CSV, "application/csv")

    def build(*handlers):
        assert any(isinstance(handler, exporter.NoRedirect) for handler in handlers)
        assert any(
            isinstance(handler, exporter.urllib.request.ProxyHandler)
            and handler.proxies == {}
            for handler in handlers
        )
        return Opener()

    monkeypatch.setattr(exporter.urllib.request, "build_opener", build)
    assert exporter.main([*check_args, "--no-proxy"]) == 0
    assert len(calls) == 2
    captured = capsys.readouterr()
    assert "direkt angefordert" in captured.out
    assert "not-a-real-token" not in captured.out + captured.err


@pytest.mark.parametrize("body", [CSV, b""])
def test_chunked_flux_responses_are_fully_read(exporter, check_args, monkeypatch, body):
    def query(request):
        # Multiple small chunks, as an actual Influx streaming endpoint may emit.
        chunks = [body[i : i + 7] for i in range(0, len(body), 7)]
        framed = b"".join(
            f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n" for chunk in chunks
        )
        wire = (
            b"HTTP/1.1 200 OK\r\nContent-Type: application/csv\r\n"
            b"Transfer-Encoding: chunked\r\n\r\n" + framed + b"0\r\n\r\n"
        )

        class Socket:
            def makefile(self, *args):
                return io.BytesIO(wire)

        result = http.client.HTTPResponse(Socket())
        result.begin()
        return result

    attach_server(exporter, monkeypatch, lambda request: response(HEALTH), query)
    assert exporter.main(check_args) == 0
