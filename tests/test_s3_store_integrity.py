"""S3: Defekte Ledger-/Profil-Stores sind ein Zustand, kein leeres Blatt.

Befund S3 (P0): Ein unlesbarer/ungültiger ``store.json`` wurde still als
leerer Store gelesen — der nächste Schreibvorgang (Tankbeleg, Intent,
Settlement) hat dann den defekten Bestand durch eine neue Datei mit nur
diesem Eintrag ersetzt. Stiller Datenverlust.

Der Vertrag jetzt:

* „Datei fehlt“ (Erststart) und „Datei existiert, ist aber defekt“ werden
  getrennt. Defekt heißt ``StoreCorrupted``/``ProfileStoreCorrupted``.
* Alle Writes schlagen mit demselben Fehler fehl — kein Überschreiben.
* Der Defekt bleibt am Ort (reproduzierbar) und liegt zusätzlich
  unverändert als Quarantäne-Kopie samt Report (Zeitstempel, Größe,
  SHA-256, Ursache) ab.
* Die API antwortet 503 mit ``store_corrupted``/``profiles_corrupted``
  und bietet an, was zur Wiederherstellung da ist (Quarantäne-Kopien,
  neueste Laufzeit-Sicherung).
* Der Settlement-Job verbucht ``store_corrupted`` statt generischem Fehler.
"""

import datetime as dt
import hashlib
import json
import os
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

import app.server
from app.config import Settings
from app.data import LiveData
from app.feedback import (
    FEEDBACK_SCHEMA_VERSION,
    StoreCorrupted,
    StoreTooLarge,
    load_store,
    record_fill,
    store_recovery_options,
)
from app.profiles import (
    ProfileStoreCorrupted,
    create_profile,
    load_store as load_profiles,
    profiles_path,
    profiles_quarantine_dir,
    profiles_recovery_options,
)
from app.settlement import run_settlement_job

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


def _store_path(settings) -> Path:
    from app.feedback import feedback_path

    path = feedback_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _valid_store() -> dict:
    return {
        "schema_version": FEEDBACK_SCHEMA_VERSION,
        "episodes": [],
        "fills": [],
        "settlements": [],
        "audit": [],
    }


def _corrupt(settings, raw: bytes | str) -> Path:
    """Schreibt den Defekt — und behält die Bytes für Vergleichszwecke."""
    path = _store_path(settings)
    data = raw.encode("utf-8") if isinstance(raw, str) else raw
    path.write_bytes(data)
    return path


# ---------------------------------------------------------------------------
# Laden: Erststart vs. Defekt
# ---------------------------------------------------------------------------


def test_missing_file_is_first_start_not_defect(settings_with_station):
    """Ohne Datei bleibt „leer“ rechtens — Erststart, kein Zustand."""
    store = load_store(settings_with_station)
    assert store["schema_version"] == FEEDBACK_SCHEMA_VERSION
    assert store["episodes"] == []


def test_unreadable_bytes_are_corrupted(settings_with_station):
    """Binär-Müll statt JSON — Defekt, kein leerer Store."""
    _corrupt(settings_with_station, b"\x00\x01\x02\xffgarbage")
    with pytest.raises(StoreCorrupted):
        load_store(settings_with_station)


def test_invalid_json_is_corrupted(settings_with_station):
    """Lesbarer Text, aber kein JSON — Defekt."""
    _corrupt(settings_with_station, "{das ist kein json")
    with pytest.raises(StoreCorrupted):
        load_store(settings_with_station)


def test_non_dict_json_is_corrupted(settings_with_station):
    """Gültiges JSON, das kein Store ist (Liste) — Defekt."""
    _corrupt(settings_with_station, json.dumps([1, 2, 3]))
    with pytest.raises(StoreCorrupted):
        load_store(settings_with_station)


def test_dict_without_episodes_is_corrupted(settings_with_station):
    """JSON-Objekt ohne Store-Struktur — Defekt, kein „anderer“ Store."""
    _corrupt(settings_with_station, json.dumps({"schema_version": 1, "other": 1}))
    with pytest.raises(StoreCorrupted):
        load_store(settings_with_station)


def test_stat_failure_is_fail_closed(settings_with_station, monkeypatch):
    """Sogar das ``stat`` schlägt fehl (Rechte/Dateisystem): fail-closed.

    „Fehlt“ von „defekt“ lässt sich hier nicht trennen — ein leeres Blatt
    wäre der stille Datenverlust.
    """
    from pathlib import Path as RealPath

    path = _corrupt(settings_with_station, b"defekt")
    real_stat = RealPath.stat

    def boom(self, *args, **kwargs):
        if self == path:
            raise PermissionError(13, "Permission denied")
        return real_stat(self, *args, **kwargs)

    monkeypatch.setattr(RealPath, "stat", boom)
    with pytest.raises(StoreCorrupted):
        load_store(settings_with_station)


def test_oversized_store_is_too_large(settings_with_station):
    """Größen-Grenze bleibt ein eigener Zustand (Retention-Prüfstand §3.5)."""
    store = _valid_store()
    store["audit"] = [{"note": "x" * 1000}] * 12_000  # weit über 10 MB
    _corrupt(settings_with_station, json.dumps(store))
    with pytest.raises(StoreTooLarge):
        load_store(settings_with_station)


# ---------------------------------------------------------------------------
# Quarantäne: Kopie statt Verschieben, Report mit Nachweis
# ---------------------------------------------------------------------------


def test_defect_is_quarantined_not_moved(settings_with_station):
    """Original bleibt am Ort; die Quarantäne trägt identische Bytes + Report."""
    defective = b'{"kaputt": '
    path = _corrupt(settings_with_station, defective)
    with pytest.raises(StoreCorrupted):
        load_store(settings_with_station)

    # Der Bestand wurde weder bewegt noch geändert.
    assert path.exists()
    assert path.read_bytes() == defective

    quarantine = settings_with_station.runtime / "feedback" / "quarantine"
    copies = [p for p in quarantine.glob("store-*.json") if ".report." not in p.name]
    reports = list(quarantine.glob("store-*.report.json"))
    assert len(copies) == 1 and len(reports) == 1
    assert copies[0].read_bytes() == defective
    report = json.loads(reports[0].read_text(encoding="utf-8"))
    assert report["source"] == str(path)
    assert report["size_bytes"] == len(defective)
    assert report["sha256"] == hashlib.sha256(defective).hexdigest()
    assert "at" in report and report["error"]


def test_recovery_options_offer_quarantine_and_name_backup_absence(
    settings_with_station,
):
    """Nach dem Defekt weiß die App, was zur Wiederherstellung da ist."""
    _corrupt(settings_with_station, b"kaputt")
    with pytest.raises(StoreCorrupted):
        load_store(settings_with_station)

    options = store_recovery_options(settings_with_station)
    assert options["quarantine"], "die Quarantäne-Kopie fehlt im Angebot"
    for entry in options["quarantine"]:
        # Relativ zum Laufzeitverzeichnis — kein absoluter Pfad im Payload.
        assert not os.path.isabs(entry)
        assert entry.endswith(".json")
        assert ".report." not in entry
        assert (settings_with_station.runtime / entry).is_file()
    # Ohne eingerichtetes Backup-Ziel ist ehrlich „kein Backup“.
    assert options["backup"] is None


# ---------------------------------------------------------------------------
# Writes: fail-closed, kein Überschreiben des Defekts
# ---------------------------------------------------------------------------


def test_writes_fail_closed_while_defect(settings_with_station):
    """Beleg schreiben mit defektem Store: Fehler statt leiser Neuerstellung."""
    defective = b'{"episodes": ['
    path = _corrupt(settings_with_station, defective)
    fill = {
        "station_id": UID,
        "liters": 35.0,
        "price_paid": 1.719,
        "fuel": "e10",
        "tanked_at": NOW.isoformat(),
        "source": "manuell",
    }
    with pytest.raises(StoreCorrupted):
        record_fill(settings_with_station, fill, live_data=None, clock=lambda: NOW)

    # Der Defekt steht unverändert weiter — kein leeres Blatt darüber.
    assert path.read_bytes() == defective


def test_settlement_job_reports_store_corrupted(settings_with_station):
    """Der Job verbucht den benannten Code — der Takt verschiebt den Versuch."""
    _corrupt(settings_with_station, b"kaputt")
    result = run_settlement_job(settings_with_station)
    assert result == {"state": "failed", "error_code": "store_corrupted"}


# ---------------------------------------------------------------------------
# Profil-Store: gleicher Vertrag
# ---------------------------------------------------------------------------


def test_profiles_invalid_json_is_corrupted_and_quarantined(settings_with_station):
    path = profiles_path(settings_with_station)
    path.write_bytes(b"defekt]")
    with pytest.raises(ProfileStoreCorrupted):
        load_profiles(settings_with_station)

    assert path.read_bytes() == b"defekt]"  # Original bleibt
    quarantine = profiles_quarantine_dir(settings_with_station)
    copies = [p for p in quarantine.glob("profiles-*.json") if ".report." not in p.name]
    assert len(copies) == 1
    assert copies[0].read_bytes() == b"defekt]"
    assert list(quarantine.glob("profiles-*.report.json"))

    options = profiles_recovery_options(settings_with_station)
    assert options["quarantine"] and all(
        not os.path.isabs(p) for p in options["quarantine"]
    )


def test_profiles_writes_fail_closed_while_defect(settings_with_station):
    path = profiles_path(settings_with_station)
    path.write_bytes(b"defekt]")
    with pytest.raises(ProfileStoreCorrupted):
        create_profile(settings_with_station, {"name": "Tank A"}, clock=lambda: NOW)
    assert path.read_bytes() == b"defekt]"


# ---------------------------------------------------------------------------
# API: 503 mit Code + Rettungsangebot statt 500/leerer Liste
# ---------------------------------------------------------------------------


def _serve(settings, live):
    import app.server as server

    app.server._WRITE_HITS.clear()
    httpd = server.make_server(settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, thread, f"http://127.0.0.1:{httpd.server_port}"


def _post(url, payload):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return (
                response.status,
                json.loads(response.read().decode("utf-8")),
                dict(response.headers),
            )
    except urllib.error.HTTPError as error:
        return (
            error.code,
            json.loads(error.read().decode("utf-8")),
            dict(error.headers),
        )


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


def test_api_writes_and_reads_report_store_corrupted(settings_with_station):
    """Jeder Ledger-Pfad (lesen UND schreiben) zeigt den Zustand an — 503."""
    defective = b'{"fills": [kaputt'
    path = _corrupt(settings_with_station, defective)
    live = LiveData(settings_with_station, query=lambda *_: [], clock=lambda: NOW)
    httpd, thread, base = _serve(settings_with_station, live)
    try:
        # Schreiben (Beleg) — 503 mit Code, Quarantäne und Backup-Abfrage.
        status, body, _ = _post(
            base + "/api/v1/fills",
            {
                "station_id": UID,
                "liters": 35.0,
                "price_paid": 1.719,
                "fuel": "e10",
                "source": "manuell",
            },
        )
        assert status == 503
        assert body["error_code"] == "store_corrupted"
        assert body["quarantine"], "das Rettungsangebot fehlt"
        assert "backup" in body
        # Der Defekt wurde nicht über den API-Schreibversuch ersetzt.
        assert path.read_bytes() == defective

        # Lesen (Belege) — der Zustand steht im Body (GET antwortet mit 200
        # und trägt den Code; nur Schreib-/Profil-Endpunkte mappen auf
        # Status). Eine leere Liste ohne Code wäre das stille Alibi.
        status, body = _get(base + "/api/v1/fills")
        assert status == 200
        assert body["error_code"] == "store_corrupted"
        assert body["fills"] == [] and body["count"] == 0
        assert body["quarantine"]

        # Ein ungeschädigter Endpunkt bleibt erreichbar — der Zustand ist
        # auf den Store beschränkt, nicht auf den ganzen Server.
        status, _ = _get(base + "/api/v1/health")
        assert status == 200
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)
