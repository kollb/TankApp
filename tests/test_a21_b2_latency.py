"""A21-B2.1 — Request-Timing, Spans und Proxyweiterleitung.

Audit 21.09.2026 (Befund §3.5): Der Timer startete **vor** dem Warten auf die
nächste Keep-Alive-Anfrage. In der Gegenprobe brauchte ein Health-Aufruf
1,8 ms, sein ``X-Process-Time`` meldete nach 300 ms Clientpause aber 301,7 ms
— dieselbe Zahl floss in die Routenstatistik, und der Pi reichte den Header
gar nicht durch. Damit war nicht entscheidbar, ob eine 2,00-s-Antwort an
Influx, am Ledger, am Bootstrap, an der Sperre oder am Proxy hing.

Dieser Test hält den Messvertrag fest:

* Clientleerlauf erscheint **nicht** in ``X-Process-Time`` und nicht in
  ``performance*`` von ``/health`` — er steht als eigener Span ``idle`` im
  ``Server-Timing``,
* ``X-Request-ID`` korreliert direkte und durchgereichte Antworten,
* Spans sind eine feste, begrenzte Namensliste; IDs, Token und Stationsdaten
  tauchen in keinem Label auf,
* eine eingespiele Verzögerung landet im richtigen Span (History, Advice,
  Snapshot),
* der Pi nennt NAS-Zeit, Pi-Zeit und Proxywartezeit getrennt.

Absichtlich **keine** absoluten Millisekunden-Asserts auf die Gesamtdauer
(langsame CI-Runner): Geprüft wird die Zuordnung, nicht die Geschwindigkeit.
"""

from __future__ import annotations

import datetime as dt
import http.client
import json
import re
import socket
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import app.decide as decide_module
import app.feedback as feedback_module
import app.metrics as metrics
from app.config import Settings
from app.data import LiveData
from app.server import make_server
from test_rp2_fallback import default_poll_lines, start_fallback_server

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 18, 12, 0, tzinfo=dt.timezone.utc)
SPAN_ENTRY = re.compile(r"([A-Za-z_][A-Za-z0-9_]*);dur=([0-9.]+)")


@pytest.fixture(autouse=True)
def _frisches_fenster():
    """Das Latenzfenster ist prozess-global — je Test leer starten."""
    metrics.reset()
    yield
    metrics.reset()


@pytest.fixture
def settings(tmp_path):
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
                                "name": "Station Alpha",
                                "lat": 50.1,
                                "lon": 8.6,
                            }
                        ],
                    }
                }
            }
        )
    )
    # Vollständige Influx-Konfiguration: Die Verlaufsabfrage (``series``)
    # validiert sie, sonst endet der Pfad vor dem Span mit
    # ``influx_read_failed`` und der Test prüfte nichts.
    (tmp_path / "influx.env").write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n"
    )
    (tmp_path / "_netrc").write_text("")
    return Settings(
        data=tmp_path,
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "_netrc",
        static=tmp_path / "static",
    )


class _DelayQuery:
    """Influx-Ersatz: zählt Aufrufe und kann je Aufruf künstlich warten."""

    def __init__(self):
        self.calls = 0
        self.delay_s = 0.0

    def __call__(self, *_args, **_kwargs):
        self.calls += 1
        if self.delay_s:
            time.sleep(self.delay_s)
        return iter([])


@pytest.fixture
def query():
    return _DelayQuery()


@pytest.fixture
def server(settings, query):
    live = LiveData(settings, query=query, clock=lambda: NOW)
    httpd = make_server(settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_port
    finally:
        httpd.shutdown()
        thread.join(timeout=5)


def _get(port: int, path: str, headers: dict | None = None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    try:
        conn.request("GET", path, headers=headers or {})
        response = conn.getresponse()
        body = response.read()
        return response.status, dict(response.getheaders()), body
    finally:
        conn.close()


def _spans(headers: dict) -> dict[str, float]:
    """``Server-Timing`` als {Name: Millisekunden} — ohne ``desc``-Rauschen."""
    raw = headers.get("Server-Timing") or ""
    return {name: float(value) for name, value in SPAN_ENTRY.findall(raw)}


OVERVIEW = (
    f"/api/v1/overview?city=Frankfurt&fuel=e10&station_id={UID}"
    "&liters=40&consumption=7&speed_kmh=40&mode=onroute"
)


# ---------------------------------------------------------------------------
# Keep-Alive: Clientleerlauf ist keine Bearbeitungszeit
# ---------------------------------------------------------------------------


def _read_one_response(sock) -> tuple[int, dict, bytes]:
    response = http.client.HTTPResponse(sock)
    response.begin()
    body = response.read()
    return response.status, dict(response.getheaders()), body


def _request_bytes(path: str) -> bytes:
    return (
        f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n"
    ).encode()


def test_keepalive_pause_ist_idle_span_und_keine_bearbeitungszeit(server):
    """Batch-Check: 400 ms Clientpause tauchen in keiner Zahl als Arbeit auf.

    Auf einer Verbindung, zwei Anfragen, dazwischen schläft der Client. Der
    zweite Response trägt die Pause als ``idle`` (Nachweis, dass sie gemessen
    wurde) — aber ``X-Process-Time`` und die Routenstatistik bleiben klein.
    """
    sock = socket.create_connection(("127.0.0.1", server), timeout=15)
    pause_s = 0.4
    try:
        sock.sendall(_request_bytes("/api/v1/health"))
        _status, _headers, _body = _read_one_response(sock)

        time.sleep(pause_s)
        sock.sendall(_request_bytes("/api/v1/health"))
        status, headers, _body = _read_one_response(sock)
    finally:
        sock.close()

    assert status == 200
    process_time = float(headers["X-Process-Time"])
    # Die Pause ist größer als die gesamte Bearbeitung — kein knapper,
    # maschinenabhängiger Grenzwert, sondern die halbe Pause.
    assert process_time < pause_s / 2, (
        f"Clientleerlauf steckt in X-Process-Time ({process_time:.3f}s)"
    )
    spans = _spans(headers)
    assert spans.get("idle", 0.0) >= pause_s * 1000 * 0.75, (
        "die Pause ist nicht als idle-Span ausgewiesen"
    )
    assert spans.get("total", 0.0) <= process_time * 1000 + 1.0
    # Und die Statistik sieht dieselbe Zahl: kein Ausreißer über der Pause.
    # (``slowest_route``/``by_route`` nennen erst ab ``MIN_SAMPLES_PER_ROUTE``
    # Antworten je Route einen p95 — bei zwei Anfragen wäre das Rauschen.)
    # ``observe()`` läuft im Handler-Thread nach der Antwort: unter Last
    # (z. B. parallele Suite via pytest-xdist) kann die Buchhaltung noch
    # fehlen, während der Client schon prüft — kurz einwirken lassen wie
    # beim Status/Send-Test unten; die Gleichheiten bleiben hart.
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        summary = metrics.summary()
        if summary["requests"] >= 2:
            break
        time.sleep(0.02)
    summary = metrics.summary()
    assert summary["requests"] == 2
    assert summary["max_ms"] < pause_s * 1000 / 2
    assert summary["by_status"].get("2xx", 0) >= 2


def test_antworten_zaehlen_status_und_send_getrennt(server):
    """200/404/2xx zählen im Fenster; der Versand hat eine eigene Zahl (B2.1)."""
    _get(server, "/api/v1/health")
    _get(server, "/api/v1/gibt-es-nicht")
    # `observe()` läuft im Handler-Thread nach der Antwort: unter Last kann die
    # Buchhaltung noch fehlen, wenn der Client schon liest. Kurz einwirken lassen
    # (wie beim Keep-alive-Test), die Gleichheiten bleiben hart.
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        summary = metrics.summary()
        if summary["requests"] >= 2 and summary["send_count"] >= 1:
            break
        time.sleep(0.02)
    summary = metrics.summary()
    assert summary["requests"] == 2
    assert summary["by_status"].get("2xx") == 1
    assert summary["by_status"].get("4xx") == 1
    assert summary["send_count"] >= 1


def test_keepalive_timeout_ohne_antwort_zaehlt_nicht_als_route(server):
    """Eine Verbindung, die ohne Anfrage endet, gewinnt keine Route (B2.1)."""
    sock = socket.create_connection(("127.0.0.1", server), timeout=15)
    sock.close()  # Client verschwindet, ohne zu fragen
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if metrics.summary()["keep_alive_timeouts"] >= 1:
            break
        time.sleep(0.02)
    summary = metrics.summary()
    assert summary["keep_alive_timeouts"] >= 1
    assert summary["p95_ms"] is None, "ohne Antwort darf kein p95 entstehen"


# ---------------------------------------------------------------------------
# Request-ID und Spans
# ---------------------------------------------------------------------------


def test_request_id_wird_uebernommen_oder_erzeugt(server):
    """Gültige ID des Clients wird gespiegelt, ungültige ersetzt (B2.1)."""
    _status, headers, _body = _get(
        server, "/api/v1/health", {"X-Request-ID": "pi-7f3a-42"}
    )
    assert headers["X-Request-ID"] == "pi-7f3a-42"

    # Zu lang (Header-Injektion über Zeilenumbruch ist schon auf
    # Clientseite verboten): der Wert wird verworfen, nicht gekürzt.
    sock = socket.create_connection(("127.0.0.1", server), timeout=10)
    try:
        sock.sendall(
            b"GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\n"
            b"X-Request-ID: " + b"a" * 100 + b"\r\nConnection: close\r\n\r\n"
        )
        _status, headers, _body = _read_one_response(sock)
    finally:
        sock.close()
    generated = headers["X-Request-ID"]
    assert generated != "a" * 100
    assert re.fullmatch(r"[0-9a-f]{16}", generated), generated


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("pi-7f3a-42", "pi-7f3a-42"),
        ("Browser_1.2:3-4", "Browser_1.2:3-4"),
        ("x" * 64, "x" * 64),
        ("x" * 65, None),
        ("böse", None),
        ("mit leerzeichen", None),
        ("", None),
        (None, None),
    ],
)
def test_request_id_whitelist(raw, expected):
    """Nur der erlaubte Zeichenvorrat kommt in den Antwortkopf (B2.1)."""
    assert metrics.sanitize_request_id(raw) == expected


def test_server_timing_nennt_total_und_haelt_namensliste_ein(server):
    _status, headers, _body = _get(server, "/api/v1/health")
    names = set(_spans(headers))
    assert "total" in names
    assert names <= set(metrics.SPANS), f"unbekannter Span {names - set(metrics.SPANS)}"


def test_unbekannte_spans_werden_verworfen():
    """Der Sammler ist eine Whitelist — ein Token wird kein Metrikname."""
    spans = metrics.RequestSpans("abc")
    spans.add("Bearer geheim", 1.0)
    spans.add("total", 0.01)
    assert spans.ids() == ["total"]
    assert "geheim" not in spans.header_value()


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/api/v1/health", "/api/v1/health"),
        ("/api/v1/fills/9f1c0d2e-1111-2222-3333-444455556666", "/api/v1/fills/*"),
        ("/api/v1/recommendations/abc123/outcome", "/api/v1/recommendations/*/*"),
        ("/api/v1/jobs/models/log", "/api/v1/jobs/*/*"),
        ("/api/v1/raten/geheim", "/api/v1/*"),
        ("/assets/index-9f8c1.js", "static"),
    ],
)
def test_route_labels_sind_begrenzt(path, expected):
    """Ein ratender Client erzeugt keine neuen Metriknamen (B2.1)."""
    from app.server import _METRIC_KNOWN_ROUTES, _METRIC_ROUTE_PREFIXES

    label = metrics.route_label(
        path, known=_METRIC_KNOWN_ROUTES, prefixes=_METRIC_ROUTE_PREFIXES
    )
    assert label == expected
    assert len(label) <= metrics.MAX_LABEL_CHARS


def test_overview_antwort_enthaelt_keine_station_in_metriklabels(server):
    """Der Messvertrag trägt keine Stations-/Beleginhalte (B2.1)."""
    _status, headers, _body = _get(server, OVERVIEW)
    raw = headers.get("Server-Timing", "") + headers.get("X-Request-ID", "")
    assert UID not in raw


# ---------------------------------------------------------------------------
# Verzögerungen landen im richtigen Span
# ---------------------------------------------------------------------------


def test_influx_verzoegerung_landet_im_history_span(server, query):
    """Eingespritzte DB-Wartezeit wird dem History-Span zugeordnet.

    Ein Request, kein Aufwärmen: Der Overview-Speicher ist je Test leer, die
    7-Tage-Kurve wird also wirklich gerechnet. Die Verzögerung steht vor dem
    Request, damit die Zuordnung nicht von Cachezufällen abhängt.
    """
    query.delay_s = 0.15
    _status, headers, _body = _get(server, OVERVIEW)
    spans = _spans(headers)
    assert spans.get("history", 0.0) >= 100.0, (
        f"DB-Wartezeit nicht im history-Span: {spans}"
    )
    assert spans["total"] >= spans["history"]
    # Und sie wird nicht der Statistik zugeschrieben.
    assert spans.get("advice", 0.0) < 100.0


def test_advice_verzoegerung_landet_im_advice_span(server, monkeypatch):
    """Eingespritzte Statistikzeit wird dem Advice-Span zugeordnet."""
    # A21-B2.2: Die Statistik entsteht im gemeinsamen Lesezustand, also wird
    # dort die Wartezeit eingespiegelt (app.feedback.compute_advice_stats).
    original = feedback_module.compute_advice_stats

    def slow(*args, **kwargs):
        time.sleep(0.12)
        return original(*args, **kwargs)

    monkeypatch.setattr(feedback_module, "compute_advice_stats", slow)
    _status, headers, _body = _get(server, OVERVIEW)
    spans = _spans(headers)
    assert spans.get("advice", 0.0) >= 100.0
    assert spans.get("wallet", 0.0) < 100.0


def test_snapshot_verzoegerung_landet_im_snapshot_span(server, monkeypatch):
    """Eingespritzte Sperr-/Schreibzeit wird dem Snapshot-Span zugeordnet."""
    original = decide_module.record_snapshot

    def slow(*args, **kwargs):
        time.sleep(0.12)
        return original(*args, **kwargs)

    monkeypatch.setattr(decide_module, "record_snapshot", slow)
    _status, headers, _body = _get(server, OVERVIEW)
    spans = _spans(headers)
    assert spans.get("snapshot", 0.0) >= 100.0


# ---------------------------------------------------------------------------
# Der Pi trennt seine Zeit von der NAS
# ---------------------------------------------------------------------------


def test_pi_proxy_trennt_pi_nas_und_proxyzeit(tmp_path):
    """Der Pi reicht NAS-Diagnose durch und misst seine Wartezeit separat."""
    seen: dict[str, str] = {}

    # Minimaler NAS-Ersatz mit künstlicher Wartezeit und Diagnoseheadern.

    class NasHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def do_GET(self):
            seen["request_id"] = self.headers.get("X-Request-ID")
            if self.path.startswith("/api/v1/stations"):
                # Die Bereitschaftsprobe des Pi verlangt eine fachlich
                # gültige Stationsliste (``stations_ready``), sonst gilt die
                # NAS als degradiert und der Proxy wird nie benutzt.
                body = json.dumps({"stations": [], "cities": []}).encode()
            else:
                time.sleep(0.15)
                body = json.dumps({"app": "online"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Process-Time", "0.150000")
            self.send_header(
                "Server-Timing",
                'history;dur=120.000;desc="price history query", total;dur=150.000',
            )
            self.send_header("X-Request-ID", self.headers.get("X-Request-ID") or "nas")
            self.end_headers()
            self.wfile.write(body)

    nas = ThreadingHTTPServer(("127.0.0.1", 0), NasHandler)
    threading.Thread(target=nas.serve_forever, daemon=True).start()
    nas_base = f"http://127.0.0.1:{nas.server_port}"
    try:
        server, _ = start_fallback_server(
            tmp_path, poll_lines=default_poll_lines(), nas_base=nas_base
        )
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            request = urllib.request.Request(
                base + "/api/v1/health", headers={"X-Request-ID": "browser-1"}
            )
            with urllib.request.urlopen(request, timeout=10) as resp:
                resp.read()
                headers = dict(resp.headers)
        finally:
            server.shutdown()
            server.server_close()
    finally:
        nas.shutdown()
        nas.server_close()

    # Dieselbe ID auf beiden Seiten — korrelierbar.
    assert seen["request_id"] == "browser-1"
    assert headers["X-Request-ID"] == "browser-1"
    # NAS-Zeit unverändert und separat benannt.
    assert headers["X-TankApp-NAS-Process-Time"] == "0.150000"
    # Der NAS-Header fährt unverändert mit (unabhängig prüfbar), die Spans
    # erscheinen zusätzlich mit Präfix ``nas_`` im Server-Timing des Pi.
    assert headers["X-TankApp-NAS-Server-Timing"].startswith("history;dur=120.000")
    spans = _spans(headers)
    assert spans["pi_proxy"] >= 100.0
    assert spans["pi_total"] >= spans["pi_proxy"]
    assert spans["nas_history"] == 120.0
    assert float(headers["X-Process-Time"]) < 5.0
