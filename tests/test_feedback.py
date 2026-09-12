"""B2 + B5 — Feedback-Store: Schema-Version/Migration und Schreib-Härtung.

B2: ``store.json`` trägt ``schema_version``; Altbestände ohne Feld gelten als
Version 1 und werden beim Laden migriert — der nächste Feldsprung bricht
nicht mehr still. Ein Store aus einer *neueren* Version ist ein harter
Fehler statt stiller Reset.

B5 (Rest nach 0.12.0): ``tanked_at`` nur im Plausibilitätsfenster,
Freitext-Caps für ``station_name``/``source``, und ein Schreib-Budget
ausschließlich für die Ledger-Endpunkte (GET bleibt frei — GUI-Polling).
"""

import datetime as dt
import json
import threading
import urllib.error
import urllib.request

import pytest

import app.server
from app.config import Settings
from app.data import LiveData
from app.feedback import (
    FEEDBACK_RETENTION_DAYS,
    FEEDBACK_SCHEMA_VERSION,
    MAX_SOURCE_CHARS,
    MAX_STATION_NAME_CHARS,
    StoreSchemaTooNew,
    load_store,
    migrate_store,
    record_fill,
)

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 12, 12, 0, tzinfo=dt.timezone.utc)


@pytest.fixture
def settings_with_station(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "anchor": [50.11, 8.68],
                        "batch": [UID],
                        "stations": [
                            {
                                "uuid": UID,
                                "name": "Station Alpha",
                                "brand": "ARAL",
                                "lat": 50.12,
                                "lon": 8.69,
                            }
                        ],
                    }
                }
            }
        )
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n"
    )
    static = tmp_path / "web"
    static.mkdir()
    (static / "index.html").write_text("<html>test</html>")
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
        static=static,
    )


def old_store() -> dict:
    """Ein Store im Stand 0.10/0.11/0.12: kein ``schema_version``, kein ``audit``."""
    return {
        "episodes": [
            {
                "id": "ep_old0000001",
                "opened_at": "2026-08-01T10:00:00+00:00",
                "closed_at": "2026-08-01T18:30:00+00:00",
                "status": "resolved",
                "intent": "wait",
                "first_snapshot": {
                    "id": "snap_old00001",
                    "emitted_at": "2026-08-01T12:00:00+00:00",
                    "action": "wait",
                    "city": "Frankfurt",
                    "station_id": UID,
                    "price_now": 1.719,
                },
                "last_snapshot": {
                    "id": "snap_old00001",
                    "emitted_at": "2026-08-01T12:00:00+00:00",
                    "action": "wait",
                    "city": "Frankfurt",
                    "station_id": UID,
                    "price_now": 1.719,
                },
                "snapshots": [
                    {
                        "id": "snap_old00001",
                        "emitted_at": "2026-08-01T12:00:00+00:00",
                        "action": "wait",
                        "city": "Frankfurt",
                        "station_id": UID,
                        "price_now": 1.719,
                    }
                ],
            }
        ],
        "fills": [
            {
                "id": "fill_old00001",
                "episode_id": "ep_old0000001",
                "station_id": UID,
                "station_name": "Station Alpha",
                "tanked_at": "2026-08-01T17:40:00+00:00",
                "clock_hour": 17.5,
                "liters": 41.2,
                "price_paid": 1.689,
                "fuel": "e10",
                "compliance": "followed",
                "saved_vs_always_now_eur": 0.9,
            }
        ],
        "settlements": [
            {
                "snapshot_id": "snap_old00001",
                "episode_id": "ep_old0000001",
                "settled_at": "2026-08-01T21:00:00+00:00",
                "p_emit": 1.719,
                "p_realized": 1.702,
                "outcome": "win",
                "regret_eur": 0.0,
            }
        ],
    }


# --- B2: Schema-Version & Migration ---------------------------------------


def test_fresh_store_carries_schema_version(settings_with_station):
    settings = settings_with_station
    fill = record_fill(
        settings,
        {"station_id": UID, "liters": 40, "price_paid": 1.7},
        clock=lambda: NOW,
    )
    # Datei wurde geschrieben und trägt die Version.
    raw = json.loads(
        (settings.runtime / "feedback" / "store.json").read_text(encoding="utf-8")
    )
    assert raw["schema_version"] == FEEDBACK_SCHEMA_VERSION
    assert raw["fills"][0]["id"] == fill["id"]


def test_old_0_10_store_is_migrated_and_survives(settings_with_station):
    """Der DoD-Fall: alter 0.10-Store → neuer Code, ohne Datenverlust."""
    settings = settings_with_station
    path = settings.runtime / "feedback" / "store.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(old_store()), encoding="utf-8")

    store = load_store(settings)
    assert store["schema_version"] == FEEDBACK_SCHEMA_VERSION
    assert len(store["episodes"]) == 1 and len(store["settlements"]) == 1
    assert store["audit"] == []  # Migration ergänzt die A3-Spur als leer
    assert store["fills"][0]["voided"] is False

    # Weiterarbeiten auf dem migrierten Bestand: neuer Beleg bucht sauber.
    fill = record_fill(
        settings,
        {"station_id": UID, "liters": 42, "price_paid": 1.65},
        clock=lambda: NOW,
    )
    assert fill["station_id"] == UID

    # Nach dem Schreiben steht die Version in der Datei, Altbestand bleibt.
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["schema_version"] == FEEDBACK_SCHEMA_VERSION
    assert {f["id"] for f in raw["fills"]} == {"fill_old00001", fill["id"]}


def test_store_from_newer_version_is_rejected_not_wiped(settings_with_station):
    settings = settings_with_station
    path = settings.runtime / "feedback" / "store.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = old_store()
    raw["schema_version"] = FEEDBACK_SCHEMA_VERSION + 7
    original = json.dumps(raw)
    path.write_text(original, encoding="utf-8")

    with pytest.raises(StoreSchemaTooNew):
        load_store(settings)
    # Auch der Schreibpfad darf den Store nicht still überschreiben.
    live = LiveData(settings, query=lambda *_: [], clock=lambda: NOW)
    res = live.record_fill({"station_id": UID, "liters": 40, "price_paid": 1.7})
    assert res.get("error_code")  # 503-Familie, kein Erfolg
    assert path.read_text(encoding="utf-8") == original


def test_migrate_is_idempotent_and_tolerates_garbage_version():
    base = old_store()
    once = migrate_store(base)
    assert once["schema_version"] == FEEDBACK_SCHEMA_VERSION
    twice = migrate_store(dict(once))
    assert twice == once
    # Kaputtes Versionsfeld → wie Version 1 behandelt (Migrationen sind idempotent).
    garbage = migrate_store({**old_store(), "schema_version": "kaputt"})
    assert garbage["schema_version"] == FEEDBACK_SCHEMA_VERSION
    assert garbage["audit"] == []


# --- B5: tanked_at-Fenster, String-Caps ------------------------------------


def _fill(settings, **overrides):
    payload = {"station_id": UID, "liters": 40, "price_paid": 1.7, **overrides}
    return record_fill(settings, payload, clock=lambda: NOW)


def test_tanked_at_defaults_to_now_without_entry(settings_with_station):
    fill = _fill(settings_with_station)
    assert fill["tanked_at"] == NOW.isoformat()


def test_tanked_at_is_rejected_outside_plausible_window(settings_with_station):
    settings = settings_with_station
    far_future = dt.datetime(2100, 1, 1, tzinfo=dt.timezone.utc).isoformat()
    far_past = (NOW - dt.timedelta(days=FEEDBACK_RETENTION_DAYS + 1)).isoformat()
    for bad in (far_future, far_past, "nicht-ein-datum", "1970-01-01T00:00:00Z"):
        with pytest.raises(ValueError, match="invalid_tanked_at"):
            _fill(settings, tanked_at=bad)
    # Nichts davon durfte ins Ledger.
    assert load_store(settings)["fills"] == []


def test_tanked_at_inside_window_is_normalized(settings_with_station):
    settings = settings_with_station
    yesterday = (NOW - dt.timedelta(days=1)).isoformat()
    fill = _fill(settings, tanked_at=yesterday)
    assert fill["tanked_at"].startswith("2026-09-11T12:00:00+00:00")
    # Uhrversatz-Toleranz: 10 Minuten Zukunft ist okay, 2 Tage nicht.
    soon = (NOW + dt.timedelta(minutes=10)).isoformat()
    assert _fill(settings, tanked_at=soon)["tanked_at"].startswith("2026-09-12")


def test_free_text_fields_are_capped(settings_with_station):
    settings = settings_with_station
    fill = _fill(
        settings,
        station_name="X" * 10_000,
        source="Y" * 10_000,
    )
    assert len(fill["station_name"]) == MAX_STATION_NAME_CHARS
    assert len(fill["source"]) == MAX_SOURCE_CHARS
    # Fehlende Felder behalten ihre Defaults.
    plain = _fill(settings)
    assert plain["source"] == "manual"
    assert plain["station_name"] == ""


# --- B5: getrenntes Schreib-Budget (nur Ledger-Endpunkte) -------------------


def _serve(settings, live):
    server = app.server.make_server(settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, f"http://127.0.0.1:{server.server_port}"


def _post(url, payload):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.load(response), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, json.load(exc), dict(exc.headers)


def _delete(url):
    request = urllib.request.Request(url, method="DELETE")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.load(response), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, json.load(exc), dict(exc.headers)


def test_write_budget_blocks_flood_but_never_reads(settings_with_station):
    """GET bleibt unbegrenzt (0.12.0) — die Ledger-Schreibpfade haben ein Budget."""
    app.server._WRITE_HITS.clear()
    settings = settings_with_station
    live = LiveData(settings, query=lambda *_: [], clock=lambda: NOW)
    server, thread, base = _serve(settings, live)
    try:
        # Unvalidierte Müll-Belege: 400er, aber jede Anfrage zählt aufs Budget.
        codes = set()
        for _ in range(app.server.WRITE_BUDGET_PER_MINUTE):
            status, body, _ = _post(base + "/api/v1/fills", {"station_id": "nope"})
            codes.add(status)
        assert codes == {404}
        status, body, headers = _post(base + "/api/v1/fills", {"station_id": "nope"})
        assert status == 429
        assert body["error_code"] == "write_rate_limited"
        assert headers.get("Retry-After") == "60"
        # Auch Intent und DELETE teilen sich dasselbe Budget.
        status, body, _ = _post(
            base + "/api/v1/episodes/ep_x/intent", {"intent": "wait"}
        )
        assert status == 429 and body["error_code"] == "write_rate_limited"
        status, body, _ = _delete(base + "/api/v1/fills/irgendwas")
        assert status == 429 and body["error_code"] == "write_rate_limited"
        # GET — hier Health — bleibt trotz erschöpftem Budget frei.
        with urllib.request.urlopen(base + "/api/v1/health", timeout=10) as response:
            assert response.status == 200
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
