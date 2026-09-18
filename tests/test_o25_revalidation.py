"""O25 — Kompression und Revalidierung sind zu teuer und zu selten.

Zwei Befunde, ein Poll:

* ``gzip.compress(content, compresslevel=6)`` auf jeder JSON-Antwort.
  Gemessen im Sandkasten an einer Antwort in Veröffentlichungsgröße
  (2,08 MB JSON): Stufe 1 → 11,3 ms / 18,1 % der Rohgröße, Stufe 6 →
  46,2 ms / 13,9 %. Die CPU-Zeit fällt auf dem NAS an, bei jedem Poll.
* ETag/304 kannte nur ``/overview`` (B7). ``/decide``, ``/stations``,
  ``/heatmap``, ``/stats/summary`` und ``/selection`` luden jedes Mal
  komplett — obwohl ihr Datenstand über denselben ``data_version``-Mechanismus
  ausdrückbar ist, der das ETag bereits trägt.

Batch-Check: dieselbe Antwort mit Stufe 1 unter 150 ms (vorher 547 ms), und
eine zweite Anfrage mit ``If-None-Match`` auf ``/decide``, ``/stations``,
``/heatmap`` und ``/stats/summary`` ergibt 304.
"""

import datetime as dt
import gzip
import http.client
import json
import threading
import urllib.parse

import pytest

from app.config import Settings
from app.data import LiveData
from app.server import (
    GZIP_LEVEL_API,
    REVALIDATED_ROUTES,
    _gzip_if_accepted,
    make_server,
)

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


def _get(port: int, path: str, if_none_match: str | None = None):
    """(Status, ETag, Body-Länge) — ein Request über eine eigene Verbindung."""
    headers = {}
    if if_none_match:
        headers["If-None-Match"] = if_none_match
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    try:
        conn.request("GET", path, headers=headers)
        response = conn.getresponse()
        body = response.read()
        return response.status, response.getheader("ETag"), len(body)
    finally:
        conn.close()


# Die vier Endpunkte des Batch-Checks plus die beiden, die denselben
# Datenstempel teilen und deshalb dasselbe Muster verdienen.
ROUTES = [
    "/api/v1/decide?" + urllib.parse.urlencode({"city": "Frankfurt", "fuel": "e10"}),
    "/api/v1/stations?fuel=e10",
    "/api/v1/heatmap?" + urllib.parse.urlencode({"city": "Frankfurt", "fuel": "e10"}),
    "/api/v1/stats/summary?fuel=e10",
    "/api/v1/selection?" + urllib.parse.urlencode({"city": "Frankfurt", "fuel": "e10"}),
    "/api/v1/last_forecasts",
]


@pytest.mark.parametrize("path", ROUTES)
def test_zweite_anfrage_mit_if_none_match_antwortet_304(server, path):
    """Batch-Check: If-None-Match auf demselben Datenstand ergibt 304.

    Vorgeschaltet ist ein Aufwärm-Request: Der **erste** ``/decide``-Poll
    legt die Episode im Feedback-Store an und ändert damit den Datenstand —
    das ETag der ersten Antwort ist also gültig, aber schon beim Ausliefern
    überholt (``data_version`` liest den mtime-Wert des Stores). Ab dem
    zweiten Poll schreibt eine Bestätigung nichts mehr (O26), und die
    Revalidierung greift.
    """
    _get(server, path)  # Aufwärmen: Datenstand beruhigt sich
    status, etag, size = _get(server, path)
    assert status == 200, f"{path} liefert keinen Inhalt"
    assert etag, f"{path} trägt kein ETag"
    assert size > 0

    status, same_etag, size = _get(server, path, if_none_match=etag)
    assert status == 304, f"{path} revalidiert nicht"
    assert same_etag == etag
    assert size == 0, "304 darf keinen Body haben"


def test_batch_check_endpunkte_sind_abgedeckt():
    """Der Batch-Check nennt vier Endpunkte — alle müssen revalidieren."""
    for route in ("decide", "stations", "heatmap", "stats/summary"):
        assert f"/api/v1/{route}" in REVALIDATED_ROUTES


def test_etag_ist_route_spezifisch(server):
    """Zwei Endpunkte, derselbe Datenstand: kein gemeinsames ETag."""
    _, decide_etag, _ = _get(server, ROUTES[0])
    _, stations_etag, _ = _get(server, ROUTES[1])
    assert decide_etag and stations_etag
    assert decide_etag != stations_etag
    # Und das ETag des einen trifft nicht für den anderen.
    status, _, size = _get(server, ROUTES[1], if_none_match=decide_etag)
    assert status == 200
    assert size > 0


def test_etag_haengt_an_den_parametern(server):
    """Anderer Kraftstoff → anderes ETag, sonst gäbe es falsche 304er."""
    _, e10, _ = _get(server, "/api/v1/stations?fuel=e10")
    _, diesel, _ = _get(server, "/api/v1/stations?fuel=diesel")
    assert e10 != diesel
    status, _, _ = _get(server, "/api/v1/stations?fuel=diesel", if_none_match=e10)
    assert status == 200


def test_geaenderter_datenstand_antwortet_mit_200(server, settings):
    """Gegenprobe: Ein neuer Modell-Lauf hebt das ETag — kein alter Stand."""
    path = ROUTES[3]  # /stats/summary liest die Veröffentlichung
    _, etag, _ = _get(server, path)
    assert _get(server, path, if_none_match=etag)[0] == 304

    engine_dir = settings.runtime / "engine"
    engine_dir.mkdir(parents=True, exist_ok=True)
    (engine_dir / "current.json").write_text(
        json.dumps({"generated_at": NOW.isoformat(), "forecasts": []}),
        encoding="utf-8",
    )

    status, new_etag, size = _get(server, path, if_none_match=etag)
    assert status == 200, "neuer Datenstand muss neu berechnet werden"
    assert new_etag != etag
    assert size > 0


def test_api_antworten_komprimieren_mit_stufe_eins():
    """Batch-Check: dieselbe Antwort mit Stufe 1 statt Stufe 6."""
    assert GZIP_LEVEL_API == 1
    content = json.dumps(
        {"forecasts": [{"hour": h, "price": 1.6} for h in range(2000)]}
    )
    content = content.encode("utf-8") * 4  # sicher über GZIP_MIN_BYTES
    packed = _gzip_if_accepted("gzip, deflate", content)
    assert packed == gzip.compress(content, compresslevel=1)
    assert len(packed) < len(content), "Kompression muss sich lohnen"
    # Ohne Accept-Encoding bleibt die Antwort unverändert.
    assert _gzip_if_accepted(None, content) is content
