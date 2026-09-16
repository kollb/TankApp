"""E2E ohne Mocks: der echte Server gegen echte Antworten (LUECKEN „Bewusst offen“).

Warum diese Datei: Die Browser-Suite mockt jeden ``/api/v1/*``-Pfad
(``page.route``) und beweist damit Rendering-Logik, nicht die Integration
Server ↔ GUI. Genau dort fielen B1 (NaN brach ``/last_forecasts``), B3 (UTC
statt Ortszeit) und der defekte Demo-Stack in den Sanity-Check statt in die CI.

Diese Datei ist die **server-seitige Hälfte** dieser Lücke: Sie startet den
echten HTTP-Server aus ``app.server`` gegen den Demo-Datenbestand
(``ops/quality/demo_data.py``) und prüft die Verträge, auf die sich die
Browser-Spec ``web/e2e/demo.spec.ts`` stützt — Alltagsaggregat, Tageskurve,
Revalidierung. Die Browser-Hälfte prüft danach, dass dieselben Zahlen im DOM
ankommen; sie läuft im CI (dort ist Chromium installierbar).

Kein Mock, keine Attrappe: derselbe ``make_server``-Pfad wie im Betrieb,
nur mit injizierter Preisabfrage statt InfluxDB.
"""

import datetime as dt
import json
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

ROOT = Path(__file__).resolve().parents[1]
CITY = "Demostadt"
FUEL = "e10"
BERLIN = ZoneInfo("Europe/Berlin")


def _demo_data():
    """Importiert das Demo-Modul (liegt außerhalb der Pakete)."""
    sys.path.insert(0, str(ROOT / "ops/quality"))
    try:
        import demo_data
    finally:
        sys.path.remove(str(ROOT / "ops/quality"))
    return demo_data


@pytest.fixture(scope="module")
def demo_data():
    return _demo_data()


@pytest.fixture(scope="module")
def demo_server(tmp_path_factory, demo_data):
    """Echter Server auf einem freien Port mit dem Demo-Bestand.

    Der Bestand wird **einmal** je Modul gebaut (Engine-Fit, Publikation,
    Preiszeilen) — der Aufbau ist der teuerste Teil dieses Tests.
    """
    from app.config import Settings
    from app.data import LiveData
    from app.server import make_server

    data_dir = tmp_path_factory.mktemp("demo")
    built = demo_data.build(data_dir, days=45)
    settings = Settings(
        data=data_dir,
        archive=data_dir / "archive",
        polling=data_dir / "setup/polling.json",
        influx_env=data_dir / "influx.env",
        netrc=data_dir / "_netrc",
        static=ROOT / "web/dist",
    )
    live = LiveData(
        settings,
        query=demo_data.make_query(built["observations"], built["prices"]),
        clock=lambda: dt.datetime.now(dt.timezone.utc),
    )
    server = make_server(settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        yield base
    finally:
        server.shutdown()
        thread.join(timeout=5)


def _get(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as exc:  # 304 kommt hierüber zurück
        return exc.code, dict(exc.headers), exc.read()


def test_overview_liefert_entscheidung_und_gefüllte_tageskurve(demo_server, demo_data):
    """Der Alltagspfad: eine Anfrage, echte Entscheidung, Zellen mit Preisen.

    Der Browser-Test (``web/e2e/demo.spec.ts``) sieht genau diese Antwort als
    DOM. Fällt hier etwas aus — NaN, leere Tageskurve, falscher Fehlercode —,
    ist der GUI-Test nicht mehr die erste Stelle, die es merkt.
    """
    station_id = demo_data.STATIONS[0][0]
    url = (
        f"{demo_server}/api/v1/overview?city={CITY}&fuel={FUEL}"
        f"&liters=40&consumption=7.2&station_id={station_id}"
    )
    status, _headers, body = _get(url)
    assert status == 200
    payload = json.loads(body)
    assert payload["error_code"] is None

    decide = payload["decide"]
    assert decide["error_code"] is None
    primary = decide["primary"]
    # Die Station stammt aus dem Demo-Set — kein erfundener Name, kein null.
    assert primary["station"]["name"] in {
        name for _uuid, name, *_ in demo_data.STATIONS
    }
    assert isinstance(primary["station"]["price_now"], float)
    assert 1.0 < primary["station"]["price_now"] < 3.0
    # Ehrlichkeits-Regel (§0.4): ohne Kalibrierung keine Empfehlung.
    assert decide["decision_ready"] is False
    assert primary["action"] == "no_advice"
    assert primary["p_correct"] is None

    day = payload["day"]
    assert day is not None and day["points"], (
        "Tageskurve leer (Heute im Blick bliebe leer)"
    )
    assert day["error_code"] is None
    assert day["range_from"] and day["range_to"]
    prices = [point["price"] for point in day["points"] if point["price"] is not None]
    assert len(prices) >= 6
    assert all(isinstance(price, float) for price in prices), (
        "NaN/None-Preis in der Tageskurve"
    )
    # Die Stundenwerte liegen im Polling-Fenster 06–24 Uhr **Ortszeit** (B3):
    # eine in UTC geschnittene Kurve würde hier Stunden vor 6 Uhr zeigen.
    hours = {
        dt.datetime.fromisoformat(point["timestamp"]).astimezone(BERLIN).hour
        for point in day["points"]
        if point["price"] is not None
    }
    assert len(hours) >= 6, hours
    assert all(hour >= 6 or hour == 0 for hour in hours), hours
    assert payload["stats_summary"]["error_code"] is None


def test_overview_revalidiert_mit_echtem_etag(demo_server):
    """B7 ohne Mock: Der echte Server antwortet auf ``If-None-Match`` mit 304.

    Der gemockte Browser-Test kann das nicht zeigen — dort kommt die Antwort
    aus ``page.route``. Hier läuft die Revalidierung gegen ``data_version()``:
    Der zweite Aufruf derselben Ansicht ist eine **Bestätigung** derselben
    Entscheidung, schreibt den Ledger also nicht neu. Genau davon hängt die
    Revalidierung ab — ``data_version`` liest den mtime-Wert des Stores; ein
    Schreiben pro Aufruf würde jedes ETag schon beim Ausliefern entwerten.
    """
    url = f"{demo_server}/api/v1/overview?city={CITY}&fuel={FUEL}"
    # Der **erste** Aufruf legt die Entscheidung an — das ist eine echte
    # Änderung. Danach ist der Datenstand stabil; deshalb erst warm werden,
    # dann das ETag holen und revalidieren (nicht auf die Reihenfolge der
    # Testfunktionen verlassen).
    status, _headers, _body = _get(url)
    assert status == 200
    status, headers, _body = _get(url)
    assert status == 200
    etag = headers.get("ETag")
    assert etag, "kein ETag — Antwort-Cache und Revalidierung wären wirkungslos"

    status, headers, body = _get(url, headers={"If-None-Match": etag})
    assert status == 304, f"Revalidierung fehlt (HTTP {status} statt 304)"
    assert body == b"", "304 darf keinen Body tragen"


def test_health_ohne_erfundene_werte(demo_server):
    """``/health`` bleibt ehrlich: Version, Alarme ja — Preise nein."""
    status, _headers, body = _get(f"{demo_server}/api/v1/health")
    assert status == 200
    health = json.loads(body)
    assert health["app"] == "online"
    assert health["version"] and health["commit"]
    assert health["station_count"] == 6
    assert isinstance(health["alarms"], list)
    # Kein Collector auf dem Demo-Server: der Alarm steht da, statt zu fehlen.
    assert any(alarm["code"] == "collector_no_heartbeat" for alarm in health["alarms"])
