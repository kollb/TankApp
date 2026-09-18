"""O26 — Jeder Decide-Poll nahm die Schreibsperre des persönlichen Speichers.

Vor 0.52.0 nahm ``record_snapshot`` bei **jedem** Aufruf ``locked_store`` —
Thread-Sperre plus Dateisperre — und entschied erst danach, ob überhaupt
geschrieben wird (``_same_advice``). ``GET /api/v1/decide`` löst am Ende der
Auswertung einen Snapshot aus, und die GUI pollt ``/decide``: Ein reiner
Lesepfad belegte damit die exklusive Sperre auf dem persönlichen Speicher.
Trifft das mit dem Schreibpfad zusammen (Beleg buchen, während die GUI
pollt), wartet der Beleg hinter einer Abfrage, die nichts schreibt.

Batch-Check: ``GET /decide`` erhöht den Sperren-Zähler des Stores nicht, und
ein Beleg wird während laufender Polls ohne messbare Wartezeit gebucht.
Gegenprobe: Ein Poll, der die Entscheidung **ändert**, nimmt die Sperre
weiter — der Vorblick darf keinen Schreibvorgang verschlucken.
"""

import datetime as dt
import http.client
import json
import threading
import time
import urllib.parse

import pytest

import app.feedback as feedback
from app.config import Settings
from app.data import LiveData
from app.feedback import EPISODE_MAX_HOURS, lock_stats, record_fill, record_snapshot
from app.server import make_server

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 18, 12, 0, tzinfo=dt.timezone.utc)
DECIDE = "/api/v1/decide?" + urllib.parse.urlencode(
    {"city": "Frankfurt", "fuel": "e10"}
)


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
    """Echter Server auf freiem Port — derselbe Pfad wie im Betrieb."""
    live = LiveData(settings, query=lambda *args, **kwargs: [], clock=lambda: NOW)
    httpd = make_server(settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_port
    finally:
        httpd.shutdown()
        thread.join(timeout=5)


def _get(port: int, path: str) -> int:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    try:
        conn.request("GET", path)
        response = conn.getresponse()
        response.read()
        return response.status
    finally:
        conn.close()


def test_decide_poll_nimmt_keine_store_sperre(server, settings):
    """Erster Poll legt die Episode an, jeder weitere bestätigt nur (O26)."""
    assert _get(server, DECIDE) == 200
    assert feedback.load_store(settings)["episodes"], "erster Poll legt Episode an"

    before = lock_stats()["acquired"]
    for _ in range(5):
        assert _get(server, DECIDE) == 200

    assert lock_stats()["acquired"] == before, (
        "fünf Decide-Polls dürfen keine Store-Sperre nehmen"
    )
    # Und es ist wirklich nichts geschrieben worden: Ein Snapshot je Episode.
    assert len(feedback.load_store(settings)["episodes"][0]["snapshots"]) == 1


def test_geaenderte_entscheidung_nimmt_die_sperre_weiter(settings):
    """Gegenprobe: Der Vorblick darf keinen Schreibvorgang verschlucken."""
    snap = {"action": "wait", "station_id": UID, "station_name": "Station Alpha"}
    record_snapshot(settings, snap, clock=lambda: NOW)
    before = lock_stats()["acquired"]

    # Dieselbe Entscheidung → Bestätigung, keine Sperre, keine neue Zeile.
    record_snapshot(settings, snap, clock=lambda: NOW)
    assert lock_stats()["acquired"] == before

    # Andere Station → neue Zeile im Ledger, also Sperre.
    record_snapshot(
        settings, {**snap, "station_id": "andere-station"}, clock=lambda: NOW
    )
    assert lock_stats()["acquired"] == before + 1
    assert len(feedback.load_store(settings)["episodes"][0]["snapshots"]) == 2


def test_ablaufende_episode_wird_trotz_vorblick_geschlossen(settings):
    """Die Ablauffrist ist eine Änderung — der Vorblick muss sie durchlassen."""
    opened = NOW - dt.timedelta(hours=EPISODE_MAX_HOURS + 1)
    snap = {"action": "no_advice", "station_id": UID}
    record_snapshot(settings, snap, clock=lambda: opened)
    record_snapshot(settings, snap, clock=lambda: NOW)
    statuses = [ep["status"] for ep in feedback.load_store(settings)["episodes"]]
    assert "expired" in statuses


def test_beleg_wird_waehrend_laufender_polls_ohne_wartezeit_gebucht(settings):
    """Batch-Check: Der Schreibpfad wartet nicht hinter Polls, die nichts schreiben."""
    snap = {"action": "wait", "station_id": UID, "station_name": "Station Alpha"}
    record_snapshot(settings, snap, clock=lambda: NOW)

    stop = threading.Event()
    polls = {"count": 0}

    def poll_loop():
        while not stop.is_set():
            record_snapshot(settings, snap, clock=lambda: NOW)
            polls["count"] += 1

    poller = threading.Thread(target=poll_loop, daemon=True)
    poller.start()
    before = lock_stats()["acquired"]
    started = time.monotonic()
    try:
        result = record_fill(
            settings,
            {
                "liters": 42.0,
                "price_paid": 1.699,
                "fuel": "e10",
                "station_id": UID,
                "price_source": "manuell",
            },
            clock=lambda: NOW,
        )
        elapsed = time.monotonic() - started
    finally:
        stop.set()
        poller.join(timeout=5)

    assert result.get("liters") == 42.0
    assert polls["count"] > 0, "der Poll-Thread muss tatsächlich gelaufen sein"
    # Genau eine Sperre: die des Belegs — die Polls haben keine genommen.
    assert lock_stats()["acquired"] == before + 1
    assert elapsed < 1.0, f"Beleg wartete {elapsed:.2f} s hinter den Polls"
