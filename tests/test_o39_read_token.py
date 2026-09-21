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

A21-B1.3 (Ergänzung): Belege werden nicht nur über GET gelesen. Die
Idempotenz-Rückgabe von ``record_fill`` (``POST /api/v1/fills`` und der B4-
Alias ``POST /api/v1/recommendations/<id>/outcome``) und die idempotente
Storno-Rückgabe von ``void_fill`` (``DELETE /api/v1/fills/<id>``) liefern
denselben Vollbeleg und stehen unter demselben Guard. Hier gilt: Negativtest
je Beleg-Alias (fehlendes und falsches Token → 401, kein Beleg, kein
State-Change), direkt und über den Pi-Proxy, dazu Positivtests mit gültigem
Token; Budget/429 und der Betrieb ohne Read-Token bleiben erhalten.
"""

import datetime as dt
import http.client
import importlib.util
import json
import sys
import threading
from pathlib import Path

import pytest

import app.server as app_server
from app.config import Settings
from app.data import LiveData
from app.server import PERSONAL_READ_ROUTES, _is_personal_read, make_server

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


# ---------------------------------------------------------------------------
# A21-B1.3 — Beleg-Aliasse: kein Lesebypass über Outcome oder Storno
# ---------------------------------------------------------------------------

FILL = {
    "station_id": UID,
    "fuel": "e10",
    "liters": 42.5,
    "price_paid": 1.69,
    "price_source": "manuell",
}


@pytest.fixture(autouse=True)
def _freies_schreibbudget():
    """Isoliert das B5-Schreib-Budget (20/min teilen sich alle Tests pro IP)."""
    app_server._WRITE_HITS.clear()
    yield
    app_server._WRITE_HITS.clear()


def _request(port: int, method: str, path: str, payload=None, token: str | None = None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    try:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        data = response.read()
        return response.status, dict(response.getheaders()), data
    finally:
        conn.close()


def _beleg_anlegen(port: int) -> str:
    """Legt einen Beleg mit Token an und liefert dessen ID."""
    status, _headers, body = _request(
        port, "POST", "/api/v1/fills", dict(FILL), token=SECRET
    )
    assert status == 200
    return json.loads(body)["id"]


def _store(port: int) -> list:
    status, _headers, body = _request(port, "GET", "/api/v1/fills", token=SECRET)
    assert status == 200
    return json.loads(body)["fills"]


def test_outcome_alias_kein_vollbeleg_mehr_ohne_token(guarded_server):
    """Repro A21-B1.3: bekannte Beleg-ID ohne Token → 200 + Vollbeleg (war)."""
    fill_id = _beleg_anlegen(guarded_server)
    before = _store(guarded_server)
    for token in (None, "falsch"):
        status, headers, body = _request(
            guarded_server,
            "POST",
            f"/api/v1/recommendations/{fill_id}/outcome",
            {"id": fill_id},
            token=token,
        )
        assert status == 401
        assert json.loads(body) == {"error_code": "unauthorized"}
        assert headers.get("WWW-Authenticate", "").startswith("Bearer")
    assert _store(guarded_server) == before  # kein State-Change


def test_outcome_alias_bucht_ohne_token_nichts(guarded_server):
    before = _store(guarded_server)
    status, _headers, body = _request(
        guarded_server,
        "POST",
        "/api/v1/recommendations/rec_1/outcome",
        {**FILL, "id": "fill_neu"},
        token=None,
    )
    assert status == 401
    assert json.loads(body) == {"error_code": "unauthorized"}
    assert _store(guarded_server) == before


def test_outcome_fehlerpfad_bleibt_hinter_dem_guard(guarded_server):
    """Auch ein ungültiger Payload wird erst nach dem Guard gesehen (401 ≠ 400)."""
    status, _headers, body = _request(
        guarded_server,
        "POST",
        "/api/v1/recommendations/rec_1/outcome",
        {"station_id": "nope"},
        token=None,
    )
    assert status == 401
    assert json.loads(body) == {"error_code": "unauthorized"}


def test_storno_ohne_token_kein_beleg_kein_state_change(guarded_server):
    fill_id = _beleg_anlegen(guarded_server)
    for token in (None, "falsch"):
        status, _headers, body = _request(
            guarded_server, "DELETE", f"/api/v1/fills/{fill_id}", token=token
        )
        assert status == 401
        assert json.loads(body) == {"error_code": "unauthorized"}
    (fill,) = _store(guarded_server)
    assert not fill.get("voided")  # Storno hat nicht gezogen
    status, _headers, body = _request(
        guarded_server, "DELETE", f"/api/v1/fills/{fill_id}", token=SECRET
    )
    assert status == 200
    assert json.loads(body)["voided"] is True


@pytest.mark.parametrize(
    "case",
    [
        "GET /api/v1/fills",
        "GET /api/v1/fills/summary",
        "GET /api/v1/fills.csv",
        "GET /api/v1/fills/{id}",
        # Idempotenz-Retry mit bekannter ID — der klassische Lesebypass.
        "POST /api/v1/fills",
        "POST /api/v1/recommendations/{id}/outcome",
        # Storno ist idempotent und antwortet mit dem Vollbeleg.
        "DELETE /api/v1/fills/{id}",
    ],
)
def test_negativtest_deckt_jeden_beleg_alias_ab(guarded_server, case):
    """Abnahme A21-B1.3: JEDEr Beleg-Alias — 401, kein Beleg, kein State-Change."""
    fill_id = _beleg_anlegen(guarded_server)
    before = _store(guarded_server)
    method, path = case.split(" ", 1)
    path = path.format(id=fill_id)
    payload = {"id": fill_id, **FILL} if method == "POST" else None
    for token in (None, "falsch"):
        status, headers, body = _request(
            guarded_server, method, path, payload, token=token
        )
        assert status == 401
        assert json.loads(body) == {"error_code": "unauthorized"}
        assert headers.get("WWW-Authenticate", "").startswith("Bearer")
    assert _store(guarded_server) == before


def test_mit_token_bleiben_beleg_alias_legitim(guarded_server):
    fill_id = _beleg_anlegen(guarded_server)
    # Idempotenz-Retry und Alias-Retry liefern mit Token weiter den Vollbeleg.
    status, _headers, body = _request(
        guarded_server,
        "POST",
        "/api/v1/fills",
        {"id": fill_id, **FILL},
        token=SECRET,
    )
    assert status == 200
    assert json.loads(body)["id"] == fill_id
    status, _headers, body = _request(
        guarded_server,
        "POST",
        f"/api/v1/recommendations/{fill_id}/outcome",
        {"id": fill_id},
        token=SECRET,
    )
    assert status == 200
    assert json.loads(body)["id"] == fill_id


def test_ohne_read_token_bleibt_outcome_alias_offen(open_server):
    """Abnahme A21-B1.3: Betrieb ohne Read-Token bleibt unverändert erhalten."""
    status, _headers, body = _request(
        open_server,
        "POST",
        "/api/v1/recommendations/rec_1/outcome",
        dict(FILL),
    )
    assert status == 200
    assert json.loads(body)["id"]


def test_schreibbudget_gilt_fort_auf_dem_alias(guarded_server, monkeypatch):
    """Abnahme A21-B1.3: Budget/429 bleibt erhalten — auch auf dem Alias."""
    monkeypatch.setattr(app_server, "WRITE_BUDGET_PER_MINUTE", 1)
    status, _headers, _body = _request(
        guarded_server,
        "POST",
        "/api/v1/recommendations/rec_1/outcome",
        dict(FILL),
        token=SECRET,
    )
    assert status == 200
    status, headers, body = _request(
        guarded_server,
        "POST",
        "/api/v1/recommendations/rec_2/outcome",
        dict(FILL),
        token=SECRET,
    )
    assert status == 429
    assert json.loads(body) == {"error_code": "write_rate_limited"}
    assert headers.get("Retry-After") == "60"
    # Ohne Token gewinnt der Leseschutz — 401 vor 429, wie bei /fills.
    status, _headers, body = _request(
        guarded_server,
        "POST",
        "/api/v1/recommendations/rec_3/outcome",
        dict(FILL),
    )
    assert status == 401


def test_beleg_muster_stehen_zentral():
    """Ratchet (A21-B1.3): Neue Beleg-Aliasse gehören in die zentrale Musterliste."""
    assert _is_personal_read("/api/v1/recommendations/rec_1/outcome")
    assert _is_personal_read("/api/v1/fills/fill_1")  # Detail + Storno
    assert not _is_personal_read("/api/v1/recommendations/rec_1")
    assert not _is_personal_read("/api/v1/stations")


def _load_rp2():
    path = Path(__file__).resolve().parents[1] / "rp2" / "fallback_gui.py"
    spec = importlib.util.spec_from_file_location("tankapp_rp2_o39", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def pi_proxy(guarded_server, tmp_path, monkeypatch):
    """Pi-Fallback-GUI als echter Proxy vor dem guarded NAS (B4-Schreibpfad).

    Die NAS-Bereitschaft hat eigene Tests (``test_rp2_fallback``) — hier gilt
    der Vertrag „Authorization wird durchgereicht, 401/200 bleiben stehen“.
    """
    rp2 = _load_rp2()
    monkeypatch.setattr(rp2.NasState, "_probe", lambda self: (True, None))
    (tmp_path / "templates").mkdir()
    ctx = rp2.Context(
        poll_dir=tmp_path / "poll",
        cache_file=tmp_path / "cache.json",
        meta_candidates=[tmp_path / "polling.json"],
        template_dir=tmp_path / "templates",
        nas_base=f"http://127.0.0.1:{guarded_server}",
    )
    assert ctx.nas.is_online()
    httpd = rp2.make_server(ctx, "127.0.0.1", 0)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_port
    finally:
        httpd.shutdown()
        thread.join(timeout=5)


def test_pi_proxy_ohne_und_mit_falschem_token_kein_beleg(pi_proxy, guarded_server):
    """Abnahme A21-B1.3: Pi-Proxy ändert am Guard nichts — 401 ohne Daten."""
    fill_id = _beleg_anlegen(guarded_server)
    before = _store(guarded_server)
    for token in (None, "falsch"):
        status, headers, body = _request(
            pi_proxy,
            "POST",
            f"/api/v1/recommendations/{fill_id}/outcome",
            {"id": fill_id, **FILL},
            token=token,
        )
        assert status == 401
        assert json.loads(body) == {"error_code": "unauthorized"}
        assert headers.get("WWW-Authenticate", "").startswith("Bearer")
    assert _store(guarded_server) == before


def test_pi_proxy_mit_token_reicht_den_beleg_durch(pi_proxy):
    status, _headers, body = _request(
        pi_proxy,
        "POST",
        "/api/v1/recommendations/rec_1/outcome",
        dict(FILL),
        token=SECRET,
    )
    assert status == 200
    assert json.loads(body)["id"]


def test_pi_proxy_tragt_denselben_leseschutz_wie_direkt(pi_proxy):
    status, _headers, _body = _request(pi_proxy, "GET", "/api/v1/fills")
    assert status == 401
    status, _headers, body = _request(pi_proxy, "GET", "/api/v1/fills", token=SECRET)
    assert status == 200
    assert "fills" in json.loads(body)


def test_exposition_steht_in_der_betriebsdoku():
    """Batch-Check (a): Die Entscheidung ist benannt, nicht übersehen."""
    from app.config import ROOT

    text = (ROOT / "docs/betrieb/BETRIEB.md").read_text(encoding="utf-8")
    assert "TANKAPP_READ_TOKEN" in text
    # Was lesbar ist, für wen, in welchem Netz — die drei Fragen des Befunds.
    for needle in ("0.0.0.0", "Gast-WLAN", "Belege"):
        assert needle in text
