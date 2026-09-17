"""O24 — Der Server spricht HTTP/1.1, Anfragen teilen sich eine Verbindung.

Vor 0.47.0 setzte ``app/server.py`` kein ``protocol_version``; damit galt der
Default von ``BaseHTTPRequestHandler`` — HTTP/1.0, jede Antwort schließt die
Verbindung. Die GUI lädt je Ansicht mehrere Ressourcen, und jede zahlte einen
neuen TCP-Handshake. Auf dem Pi macht es die Fallback-GUI längst richtig
(``rp2/fallback_gui.py``).

Batch-Check: ``protocol_version == "HTTP/1.1"``, jede Antwort trägt
``Content-Length``, und zwei aufeinanderfolgende Anfragen laufen über
**dieselbe** Verbindung (``curl -sv --http1.1 … /health /health`` zeigt
„Re-using existing connection“).

HTTP/1.1 verlangt außerdem, dass kein ungelesener Request-Body im Strom
bleibt: Die Fälle hier prüfen die Pfade, die antworten, ohne den Body zu
brauchen (429 Schreib-Budget, 413 zu groß, chunked, 501 PATCH) — sie müssen
die Verbindung beenden statt sie verdorben offen zu lassen.
"""

import datetime as dt
import http.client
import json
import threading
import urllib.parse

import pytest

import app.server as server_module
from app.config import Settings
from app.data import LiveData
from app.server import Handler, make_server

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 17, 12, 0, tzinfo=dt.timezone.utc)


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
                        "stations": [{"uuid": UID, "name": "Station Alpha"}],
                    }
                }
            }
        )
    )
    (tmp_path / "influx.env").write_text("INFLUX_URL=http://127.0.0.1:8086\n")
    (tmp_path / "_netrc").write_text("")
    return Settings(
        data=tmp_path,
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "_netrc",
        static=tmp_path / "static",
    )


@pytest.fixture
def server(settings):
    """Echter Server auf einem freien Port — derselbe Pfad wie im Betrieb."""
    live = LiveData(settings, query=lambda *args, **kwargs: [], clock=lambda: NOW)
    httpd = make_server(settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_port
    finally:
        httpd.shutdown()
        thread.join(timeout=5)


def _connection(port: int) -> http.client.HTTPConnection:
    return http.client.HTTPConnection("127.0.0.1", port, timeout=15)


def test_handler_spricht_http11_und_hat_ein_idle_timeout():
    """Batch-Check: HTTP/1.1 statt Default, und offene Verbindungen enden."""
    assert Handler.protocol_version == "HTTP/1.1"
    # Keep-Alive belegt je Verbindung einen Thread — ohne Timeout bliebe ein
    # vergessenes Tab ewig stehen.
    assert Handler.timeout and Handler.timeout > 0


def test_zwei_anfragen_teilen_sich_eine_verbindung(server):
    """Batch-Check: die zweite Anfrage läuft über dieselbe Verbindung."""
    conn = _connection(server)
    try:
        conn.request("GET", "/api/v1/health")
        first = conn.getresponse()
        assert first.version == 11, "Antwort kam nicht als HTTP/1.1"
        assert first.status == 200
        assert first.will_close is False, (
            "Verbindung wurde nach der Antwort geschlossen"
        )
        first.read()

        # Derselbe Socket, zweite Anfrage — unter HTTP/1.0 wäre hier Schluss.
        conn.request("GET", "/api/v1/health")
        second = conn.getresponse()
        assert second.status == 200
        assert json.loads(second.read())["version"], "zweite Antwort ohne Inhalt"
    finally:
        conn.close()


def test_alle_antworten_tragen_content_length(server):
    """Keep-Alive braucht eine korrekte Länge auf jedem Pfad."""
    query = urllib.parse.urlencode(
        {"city": "Frankfurt", "fuel": "e10", "liters": 40, "consumption": 7.2}
    )
    paths = [
        "/api/v1/health",
        "/api/v1/stations?fuel=e10",
        f"/api/v1/overview?{query}",
        "/api/v1/fills.csv",
        "/api/v1/gibt-es-nicht",
        "/assets/gibt-es-nicht.js",
    ]
    conn = _connection(server)
    try:
        for path in paths:
            conn.request("GET", path)
            response = conn.getresponse()
            body = response.read()
            length = response.getheader("Content-Length")
            assert length is not None, f"{path}: kein Content-Length"
            assert int(length) == len(body), f"{path}: Länge passt nicht zum Body"
    finally:
        conn.close()


def test_head_antwort_hat_laenge_aber_keinen_body(server):
    """HEAD darf die Verbindung nicht mit einem Body verwirren."""
    conn = _connection(server)
    try:
        conn.request("HEAD", "/api/v1/health")
        response = conn.getresponse()
        body = response.read()
        assert response.status == 200
        assert body == b""
        assert int(response.getheader("Content-Length") or 0) > 0
        conn.request("GET", "/api/v1/health")
        assert conn.getresponse().status == 200
    finally:
        conn.close()


def test_post_haelt_die_verbindung_offen(server):
    """Ein gelesener Body lässt die Verbindung nutzbar."""
    body = json.dumps({"liters": 40, "price_paid": 1.7}).encode()
    conn = _connection(server)
    try:
        conn.request(
            "POST",
            "/api/v1/gibt-es-nicht",
            body=body,
            headers={"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        assert response.status == 501
        assert json.loads(response.read())["error_code"] == "not_implemented"

        conn.request("GET", "/api/v1/health")
        assert conn.getresponse().status == 200, "Verbindung nach POST unbrauchbar"
    finally:
        conn.close()


def test_fehlerhafte_bodys_behalten_ihre_fehlercodes(server):
    """Die Codes aus HTTP/1.0-Zeiten gelten weiter (keine stille Änderung)."""
    conn = _connection(server)
    try:
        conn.request(
            "POST",
            "/api/v1/fills",
            body=b"{ kein json",
            headers={"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        assert response.status == 400
        assert json.loads(response.read())["error_code"] == "invalid_json"

        conn.request(
            "POST",
            "/api/v1/fills",
            body=b"[1,2,3]",
            headers={"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        assert response.status == 400
        assert json.loads(response.read())["error_code"] == "invalid_query"
    finally:
        conn.close()


def test_zu_grosser_body_antwortet_413_und_beendet_die_verbindung(server):
    """Ohne Lesen des Bodys: 413 plus ``Connection: close`` statt Müll im Strom."""
    conn = _connection(server)
    try:
        conn.putrequest("POST", "/api/v1/fills")
        conn.putheader("Content-Type", "application/json")
        conn.putheader(
            "Content-Length", str(server_module.Handler.MAX_REQUEST_BODY + 1)
        )
        conn.endheaders()
        response = conn.getresponse()
        assert response.status == 413
        assert json.loads(response.read())["error_code"] == "payload_too_large"
        assert (response.getheader("Connection") or "").lower() == "close"
        assert response.will_close is True
    finally:
        conn.close()


def test_chunked_body_wird_abgelehnt_und_beendet_die_verbindung(server):
    """Ohne bekannte Länge ist kein sauberes Keep-Alive möglich — Schluss."""
    conn = _connection(server)
    try:
        conn.putrequest("POST", "/api/v1/fills")
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Transfer-Encoding", "chunked")
        conn.endheaders()
        response = conn.getresponse()
        assert response.status == 400
        assert json.loads(response.read())["error_code"] == "invalid_request"
        assert response.will_close is True
    finally:
        conn.close()


def test_schreib_budget_beendet_die_verbindung_sauber(server, monkeypatch):
    """429 antwortet, ohne den Body zu lesen — die Verbindung muss zu sein."""
    monkeypatch.setattr(server_module, "_write_budget_left", lambda client: False)
    conn = _connection(server)
    try:
        conn.request(
            "POST",
            "/api/v1/fills",
            body=json.dumps({"liters": 40, "price_paid": 1.7}).encode(),
            headers={"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        assert response.status == 429
        assert json.loads(response.read())["error_code"] == "write_rate_limited"
        assert (response.getheader("Connection") or "").lower() == "close"
    finally:
        conn.close()


def test_patch_mit_body_verdirbt_die_verbindung_nicht(server):
    """PATCH ist nicht implementiert, der Body wird trotzdem abgeräumt."""
    conn = _connection(server)
    try:
        conn.request(
            "PATCH",
            "/api/v1/fills/abc",
            body=json.dumps({"liters": 1}).encode(),
            headers={"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        assert response.status == 501
        assert json.loads(response.read())["error_code"] == "not_implemented"

        conn.request("GET", "/api/v1/health")
        assert conn.getresponse().status == 200, "Verbindung nach PATCH unbrauchbar"
    finally:
        conn.close()
