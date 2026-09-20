"""O37 — Der Server misst sich selbst nicht.

Vor 0.52.0 nutzte ``app/server.py`` ``time.monotonic()`` ausschließlich für
Trigger-Abstände und Budgets. Es gab keine Antwortzeiten im Health-Payload,
keinen ``X-Process-Time``-Header und kein Parse-Zeit-Feld; die einzigen
Latenzzahlen des Projekts entstanden durch Handmessung in einer Sandkiste.
Genau die Sorte Problem, die O23 (Healthcheck parst alles), O25 (gzip Stufe 6)
und O26 (Sperre im Lesepfad) beschrieben, kommt ohne Messung wieder: Niemand
sieht, dass eine Antwort 900 ms braucht, weil eine Datei gewachsen ist.

Batch-Check: Antworten tragen ``X-Process-Time``, ``/api/v1/health`` nennt
Parse-Dauer und Publikationsgröße, und das Budget steht in
[docs/entwicklung/QUALITAET.md](../docs/entwicklung/QUALITAET.md).
"""

import datetime as dt
import http.client
import json
import threading

import pytest

import app.data as data_mod
import app.metrics as metrics
from app.config import Settings
from app.data import LiveData, publication_status
from app.server import make_server

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 18, 12, 0, tzinfo=dt.timezone.utc)


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
    live = LiveData(settings, query=lambda *args, **kwargs: [], clock=lambda: NOW)
    httpd = make_server(settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_port
    finally:
        httpd.shutdown()
        thread.join(timeout=5)


@pytest.fixture(autouse=True)
def _frisches_fenster():
    metrics.reset()
    yield
    metrics.reset()


def _get(port: int, path: str, headers: dict | None = None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    try:
        conn.request("GET", path, headers=headers or {})
        response = conn.getresponse()
        body = response.read()
        return response.status, dict(response.getheaders()), body
    finally:
        conn.close()


def _publication(settings, name: str = "current.json") -> None:
    engine_dir = settings.runtime / "engine"
    engine_dir.mkdir(parents=True, exist_ok=True)
    (engine_dir / name).write_text(
        json.dumps({"published_at": NOW.isoformat(), "forecasts": []}), encoding="utf-8"
    )


@pytest.mark.parametrize(
    "path",
    ["/api/v1/health", "/api/v1/stations?fuel=e10", "/api/v1/gibt-es-nicht"],
)
def test_jede_antwort_traegt_x_process_time(server, path):
    """Batch-Check: ein Header je Antwort — auch bei Fehlern."""
    status, headers, _body = _get(server, path)
    assert status in (200, 404)
    raw = headers.get("X-Process-Time")
    assert raw, f"{path} antwortet ohne X-Process-Time"
    assert float(raw) >= 0.0, "Bearbeitungszeit darf nicht negativ sein"


def test_auch_304_traegt_die_bearbeitungszeit(server, settings):
    """Revalidierung ist die billigste Antwort — gemessen wird sie trotzdem."""
    path = "/api/v1/stats/summary?fuel=e10"
    _get(server, path)
    _status, headers, _body = _get(server, path)
    etag = headers.get("ETag")
    assert etag
    status, headers, _body = _get(server, path, {"If-None-Match": etag})
    assert status == 304
    assert float(headers["X-Process-Time"]) >= 0.0


def test_health_nennt_parse_dauer_und_publikationsgroesse(server, settings):
    """Batch-Check: Parse-Dauer und Größe stehen im Health-Payload."""
    _publication(settings)
    status, _headers, body = _get(server, "/api/v1/health")
    assert status == 200
    payload = json.loads(body)
    publication = payload["publication"]
    assert publication["bytes"] > 0, "Publikationsgröße fehlt"
    assert publication["budget_bytes"] > 0
    assert isinstance(publication["parse_ms"], (int, float)), (
        "Parse-Dauer fehlt — health() parst die Veröffentlichung selbst"
    )
    assert publication["parse_ms"] >= 0.0
    assert publication["parsed_at"], "Zeitpunkt des Pars fehlt"


def test_parse_dauer_gehoert_zum_datenstand(settings):
    """Gegenprobe: Keine alte Zahl als aktuelle — vor dem Parse steht None."""
    _publication(settings)
    data_mod.clear_publication_cache()
    status = publication_status(settings)
    assert status["reason"] is None
    assert status["parse_ms"] is None, "ohne Parse darf keine Dauer dastehen"
    assert status["parsed_at"] is None

    data_mod.publication(settings)  # parst
    measured = publication_status(settings)
    assert isinstance(measured["parse_ms"], (int, float))


def test_health_zeigt_latenzfenster_und_sperrenzaehler(server):
    """Das Fenster fasst zusammen, was der Header je Antwort sagt (O37/O26)."""
    for _ in range(6):  # ab fünf Antworten je Route nennt summary() einen p95
        _get(server, "/api/v1/health")
    status, _headers, body = _get(server, "/api/v1/health")
    assert status == 200
    performance = json.loads(body)["performance"]
    assert performance["count"] >= 6
    assert performance["window"] == metrics.WINDOW
    assert isinstance(performance["p95_ms"], (int, float))
    assert isinstance(performance["max_ms"], (int, float))
    assert performance["budget_ms"] == metrics.REQUEST_BUDGET_MS
    assert "/api/v1/health" in performance["by_route"]
    # O26: Der Sperren-Zähler des persönlichen Speichers ist sichtbar.
    assert performance["store_lock"]["acquired"] >= 0
    assert performance["store_lock"]["wait_ms"] >= 0.0


def test_budget_steht_in_qualitaetsdoku():
    """Batch-Check: Das Budget steht in docs/entwicklung/QUALITAET.md — mit derselben Zahl."""
    from pathlib import Path

    text = (
        Path(__file__).resolve().parents[1] / "docs/entwicklung/QUALITAET.md"
    ).read_text(encoding="utf-8")
    assert "X-Process-Time" in text, "QUALITAET.md nennt den Messwert nicht"
    assert str(int(metrics.REQUEST_BUDGET_MS)) in text, (
        "das p95-Budget aus app/metrics.py steht nicht in QUALITAET.md"
    )
