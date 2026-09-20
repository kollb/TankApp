"""O39 — Das Ledger ist im LAN nicht mehr still für alle lesbar.

``app/server.py`` bindet ``0.0.0.0:1355``: Jeder Rechner im Netz konnte die
eigenen Tankvorgänge (Zeit, Ort, Preis, Menge), die Monatsbilanz, das
Prognose-Tagebuch und die Profile lesen. Gegen die Rahmenbedingung „kein
Login“ ist das abgewogen akzeptierbar — aber es war eine **Nebenwirkung** der
Bind-Entscheidung, keine dokumentierte.

Batch-Check: Die Exposition ist in ``docs/betrieb/BETRIEB.md`` benannt, und mit
gesetztem ``TANKAPP_READ_TOKEN`` antwortet ``GET /api/v1/fills`` ohne Secret
mit 401 — ohne die Variable bleibt alles unverändert offen. Markt- und
Modelldaten sind nie betroffen.
"""

import datetime as dt
import http.client
import json
import threading

import pytest

from app.config import Settings
from app.data import LiveData
from app.server import PERSONAL_READ_ROUTES, make_server

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 17, 12, 0, tzinfo=dt.timezone.utc)
SECRET = "geheim-lese-token"


def _settings(tmp_path, read_token: str = "") -> Settings:
    tmp_path.mkdir(parents=True, exist_ok=True)
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
        read_token=read_token,
    )


@pytest.fixture
def open_server(tmp_path):
    """Server **ohne** Read-Token — der Bestand muss unverändert offen bleiben."""
    settings = _settings(tmp_path / "open")
    live = LiveData(settings, query=lambda *args, **kwargs: [], clock=lambda: NOW)
    httpd = make_server(settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_port
    finally:
        httpd.shutdown()
        thread.join(timeout=5)


@pytest.fixture
def guarded_server(tmp_path):
    """Server **mit** Read-Token — persönliche Routen nur mit Secret."""
    settings = _settings(tmp_path / "guarded", read_token=SECRET)
    live = LiveData(settings, query=lambda *args, **kwargs: [], clock=lambda: NOW)
    httpd = make_server(settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_port
    finally:
        httpd.shutdown()
        thread.join(timeout=5)


def _get(port: int, path: str, token: str | None = None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    try:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        conn.request("GET", path, headers=headers)
        response = conn.getresponse()
        body = response.read()
        return response.status, dict(response.getheaders()), body
    finally:
        conn.close()


def test_ohne_variable_bleibt_das_ledger_offen(open_server):
    """Kein Secret konfiguriert → unverändert offen (kein Verhaltenssprung)."""
    status, _headers, body = _get(open_server, "/api/v1/fills")
    assert status == 200
    assert "fills" in json.loads(body)


def test_mit_token_antwortet_fills_ohne_secret_401(guarded_server):
    status, headers, body = _get(guarded_server, "/api/v1/fills")
    assert status == 401
    assert json.loads(body) == {"error_code": "unauthorized"}
    # 401 muss sagen, welches Schema fehlt — sonst rät der Client.
    assert headers.get("WWW-Authenticate", "").startswith("Bearer")


def test_mit_secret_kommt_das_ledger_durch(guarded_server):
    status, _headers, body = _get(guarded_server, "/api/v1/fills", token=SECRET)
    assert status == 200
    assert "fills" in json.loads(body)


def test_falsches_secret_bleibt_draussen(guarded_server):
    status, _headers, _body = _get(guarded_server, "/api/v1/fills", token="falsch")
    assert status == 401


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/fills",
        "/api/v1/fills.csv",
        "/api/v1/fills/summary",
        "/api/v1/advice/diary",
        "/api/v1/profiles",
        "/api/v1/episodes",
        # /overview bündelt Belege + Episoden: ohne Schutz wäre er die Umgehung.
        "/api/v1/overview",
        "/api/v1/stats/summary",
        "/api/v1/decide",
    ],
)
def test_jede_persoenliche_route_ist_geschuetzt(guarded_server, path):
    assert _get(guarded_server, path)[0] == 401


def test_csv_export_traegt_denselben_schutz(guarded_server):
    status, _headers, _body = _get(guarded_server, "/api/v1/fills.csv", token=SECRET)
    assert status == 200


@pytest.mark.parametrize(
    "path",
    ["/api/v1/health", "/api/v1/stations", "/api/v1/selection", "/api/v1/heatmap"],
)
def test_markt_und_modelldaten_bleiben_offen(guarded_server, path):
    """Kein Secret für Daten ohne Personenbezug — sonst bricht die Diagnose."""
    status, _headers, _body = _get(guarded_server, path)
    assert status != 401


def test_health_nennt_die_entscheidung(guarded_server, open_server):
    _status, _headers, body = _get(guarded_server, "/api/v1/health")
    assert json.loads(body)["personal_data"]["read_protected"] is True
    _status, _headers, body = _get(open_server, "/api/v1/health")
    assert json.loads(body)["personal_data"]["read_protected"] is False


def test_route_liste_ist_der_dokumentierte_umfang():
    """Ratchet: Der geschützte Umfang ändert sich nicht unbeabsichtigt."""
    assert "/api/v1/fills" in PERSONAL_READ_ROUTES
    assert "/api/v1/health" not in PERSONAL_READ_ROUTES
    assert "/api/v1/stations" not in PERSONAL_READ_ROUTES


def test_umgebungsvariable_wird_gelesen(monkeypatch):
    monkeypatch.setenv("TANKAPP_READ_TOKEN", f"  {SECRET}  ")
    assert Settings.from_env().read_token == SECRET

    monkeypatch.setenv("TANKAPP_READ_TOKEN", "")
    assert Settings.from_env().read_token == ""


def test_exposition_steht_in_der_betriebsdoku():
    """Batch-Check (a): Die Entscheidung ist benannt, nicht übersehen."""
    from app.config import ROOT

    text = (ROOT / "docs/betrieb/BETRIEB.md").read_text(encoding="utf-8")
    assert "TANKAPP_READ_TOKEN" in text
    # Was lesbar ist, für wen, in welchem Netz — die drei Fragen des Befunds.
    for needle in ("0.0.0.0", "Gast-WLAN", "Belege"):
        assert needle in text
