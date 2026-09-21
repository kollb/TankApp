"""A21-B3.1 — Archivkorruption und Hotstore-/Archiv-Handover (#205).

Audit 21.09.2026 (#197 §1.5): ``load_archive_records()`` übersprang kaputte
JSON-Zeilen und behandelte manche Lesefehler wie ein leeres Archiv. Eine
gültige archivierte Füllung plus eine abgeschnittene JSON-Füllung ergab
**einen** gelesenen Beleg und keinen Fehler — die Allzeitbilanz und M7
wirkten vollständig. Zusätzlich konnte das parallele Lesen von Store und
Archiv während der Retention keinen gemeinsamen Snapshot garantieren.

Der Vertrag jetzt (``app/feedback.py``):

* **Fehlend** (Erststart) bleibt leer und gesund; **unlesbar** (OSError),
  **defekt** (UTF-8, JSON, Struktur — auch Tail-Teilwrite) und **unbekanntes
  Schema** sind ``ArchiveCorrupted`` mit Quarantäne-Kopie und Report;
  **zu neu** ist ``StoreSchemaTooNew``. Keine Teilansicht: eine Bilanz ohne
  die beschädigten Belege wäre eine scheinbar vollständige.
* Das Archiv wird **atomar** veröffentlicht (``os.replace``) und **vor** dem
  Store geschrieben; Leser lesen Store zuerst, dann Archiv — damit geht am
  Übergabepunkt kein Beleg verloren und keiner wird doppelt gezählt.
  Wiederanlauf nach Unterbrechung dedupliziert über die Identität.
* Decide, Overview, Summary, Fills-Summary, Health und der Settlement-Job
  melden denselben benannten Zustand (``archive_corrupted``) statt stiller
  Teilbilanzen; der heiße Store bleibt unangetastet.
"""

import datetime as dt
import json
import threading
import time
import urllib.error
import urllib.request
from types import SimpleNamespace

import pytest

import app.server
from app.config import Settings
from app.data import LiveData
from app.feedback import (
    FEEDBACK_SCHEMA_VERSION,
    ArchiveCorrupted,
    StoreSchemaTooNew,
    _append_archive,
    archive_corruption_status,
    feedback_archive_path,
    load_archive_records,
    load_ledger,
    locked_store,
    record_fill,
)
from app.settlement import run_settlement_job

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 21, 12, 0, tzinfo=dt.timezone.utc)
OLD = NOW - dt.timedelta(days=120)


# ---------------------------------------------------------------------------
# Fünf Zustände des Archivs — getrennt diagnostiziert
# ---------------------------------------------------------------------------


def _settings(tmp_path) -> SimpleNamespace:
    """Minimal-Settings: die Archivfunktionen brauchen nur ``runtime``."""
    return SimpleNamespace(runtime=tmp_path)


def _line(item: dict) -> str:
    return json.dumps(item, ensure_ascii=False)


def _fill(ident: str, *, voided: bool = False, days: int = 120) -> dict:
    return {
        "collection": "fills",
        "id": ident,
        "liters": 40,
        "price_paid": 1.7,
        "fuel": "e10",
        "tanked_at": (NOW - dt.timedelta(days=days)).isoformat(),
        "voided": voided,
    }


def test_repro_zwei_zeilen_liefert_fehler_statt_teilbilanz(tmp_path):
    """Der Repro aus dem Audit: eine gültige + eine abgeschnittene Zeile.

    Vorher: ein Beleg gelesen, kein Korruptionsfehler. Jetzt: klarer
    Fehler — niemals eine vermeintliche Vollbilanz ohne den verlorenen
    Beleg.
    """
    settings = _settings(tmp_path)
    path = feedback_archive_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    defective = (
        _line(_fill("valid")) + "\n" + '{"collection":"fills","id":"lost","liters":40\n'
    )
    path.write_text(defective, encoding="utf-8")

    with pytest.raises(ArchiveCorrupted) as raised:
        load_archive_records(settings)

    assert "Zeile 2" in str(raised.value)
    # Das Original bleibt unverändert — kein blindes Überschreiben.
    assert path.read_text(encoding="utf-8") == defective
    # Der Defekt liegt zusätzlich in der Quarantäne, mit Report.
    quarantine = path.parent / "quarantine"
    copies = list(quarantine.glob("archive-*.jsonl"))
    assert len(copies) == 1 and copies[0].read_text(encoding="utf-8") == defective
    report = json.loads(
        (
            quarantine
            / "archive-*.report.json".replace(
                "*", copies[0].name.split("-")[1].split(".")[0]
            )
        ).read_text()
    )
    assert report["sha256"] and report["error"]


def test_fehlendes_archiv_ist_erststart_und_gesund(tmp_path):
    """„Archiv fehlt erstmals“ ist kein Defekt — leer und ohne Quarantäne."""
    settings = _settings(tmp_path)

    records = load_archive_records(settings)

    assert records == {"episodes": [], "fills": [], "settlements": []}
    assert not (tmp_path / "feedback" / "quarantine").exists()
    assert archive_corruption_status(settings)["corrupted"] is False


def test_unlesbares_archiv_ist_nicht_dasselbe_wie_fehlend(tmp_path):
    """Rechte-/I/O-Fehler: diagnostiziert, nicht als leeres Archiv ausgegeben."""
    settings = _settings(tmp_path)
    # Ein Verzeichnis am Dateiplatz: read_bytes schlägt mit OSError fehl,
    # ohne das Dateisystem oder den Testlaufner fälschen zu müssen.
    feedback_archive_path(settings).mkdir(parents=True)

    with pytest.raises(ArchiveCorrupted) as raised:
        load_archive_records(settings)

    assert "unlesbar" in str(raised.value)


def test_defektes_utf8_ist_ein_benannter_fehler(tmp_path):
    settings = _settings(tmp_path)
    path = feedback_archive_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'{"collection":"fills","id":"\xff\xfe"}\n')

    with pytest.raises(ArchiveCorrupted):
        load_archive_records(settings)


@pytest.mark.parametrize(
    "line",
    [
        "[1, 2, 3]",  # kein Objekt
        '{"id": "x"}',  # keine collection
        '{"collection": "wallet", "id": "x"}',  # unbekannte collection
        '{"collection": "fills", "schema_version": "neu", "id": "x"}',  # kaputter Stempel
    ],
)
def test_unbekanntes_schema_ist_negativ_getestet(tmp_path, line):
    settings = _settings(tmp_path)
    path = feedback_archive_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(line + "\n", encoding="utf-8")

    with pytest.raises(ArchiveCorrupted):
        load_archive_records(settings)


def test_zu_neues_archiv_verlangt_app_update(tmp_path):
    """Stempel einer neueren App-Version: kein Defekt, kein Überschreiben."""
    settings = _settings(tmp_path)
    path = feedback_archive_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        _line({"collection": "fills", "schema_version": 99, "id": "x"}) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(StoreSchemaTooNew) as raised:
        load_archive_records(settings)

    assert "App aktualisieren" in str(raised.value)
    # Kein Quarantäne-Eintrag: nichts ist beschädigt.
    assert not list((path.parent / "quarantine").glob("archive-*"))


def test_quarantaene_ist_inhaltsdedupliziert(tmp_path):
    """Jeder Leseversuch diagnostiziert neu — die Kopie wird nur einmal gelegt.

    Sonst füllte ein defektes Archiv bei jedem Decide-Poll die Quarantäne
    mit identischen Bytes.
    """
    settings = _settings(tmp_path)
    path = feedback_archive_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{oops\n", encoding="utf-8")

    for _ in range(3):
        with pytest.raises(ArchiveCorrupted):
            load_archive_records(settings)

    copies = list((path.parent / "quarantine").glob("archive-*.jsonl"))
    assert len(copies) == 1
    report = json.loads(
        (path.parent / "quarantine" / f"{copies[0].stem}.report.json").read_text()
    )
    assert report["occurrences"] == 3
    assert report["first_seen"]


def test_health_status_hebt_nach_restore_auf(tmp_path):
    """Health vergleicht Bytes, nicht Zeitstempel: Restore hebt den Alarm.

    Der Report existiert weiter, aber der wiederhergestellte Bestand hat
    andere Bytes — der Alarm muss gehen, sonst wäre er nach jeder Reparatur
    ein Fehlalarm.
    """
    settings = _settings(tmp_path)
    path = feedback_archive_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{oops\n", encoding="utf-8")
    with pytest.raises(ArchiveCorrupted):
        load_archive_records(settings)

    assert archive_corruption_status(settings)["corrupted"] is True

    path.write_text(_line(_fill("restored")) + "\n", encoding="utf-8")
    status = archive_corruption_status(settings)
    assert status["corrupted"] is False


def test_health_status_bleibt_billig_ohne_vorfall(tmp_path):
    """Ohne Quarantäne-Report wird das Archiv nicht gelesen."""
    settings = _settings(tmp_path)
    feedback_archive_path(settings).parent.mkdir(parents=True, exist_ok=True)
    feedback_archive_path(settings).write_text(_line(_fill("ok")) + "\n")

    assert archive_corruption_status(settings)["corrupted"] is False


# ---------------------------------------------------------------------------
# Altbestand: >90-Tage-Bilanzen bleiben erhalten
# ---------------------------------------------------------------------------


def test_altbestand_ohne_stempel_laedt_weiterhin(tmp_path):
    """Zeilen aus Versionen ≤ 7 (ohne Stempel) laden unverändert — inkl. Migration."""
    settings = _settings(tmp_path)
    path = feedback_archive_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Altformat wie es die Retention vor A21-B3.1 schrieb — ohne Stempel,
    # dafür mit allen fachlichen Feldern (Storno, Geldsumme, Identität).
    path.write_text(
        "\n".join(
            [
                _line(
                    {
                        "collection": "fills",
                        "id": "alt_fill",
                        "liters": 40,
                        "price_paid": 1.7,
                        "tanked_at": OLD.isoformat(),
                        "voided": True,
                    }
                ),
                _line(
                    {
                        "collection": "settlements",
                        "snapshot_id": "snap_alt",
                        "settled_at": OLD.isoformat(),
                        "outcome": "win",
                    }
                ),
                "",
            ]
        ),
        encoding="utf-8",
    )

    records = load_archive_records(settings)

    assert [fill["id"] for fill in records["fills"]] == ["alt_fill"]
    assert records["fills"][0]["voided"] is True  # Storno bleibt Beleg
    assert [settlement["snapshot_id"] for settlement in records["settlements"]] == [
        "snap_alt"
    ]


def test_archiv_erneht_die_datenrevision(tmp_path):
    """Die Retention-Auslagerung ist ein neuer Datenstand (ETag/Lesezustand)."""
    from app.data import data_version

    settings = _full_settings(tmp_path)
    before = data_version(settings, lambda: NOW)
    _append_archive(settings, [_fill("neu")])
    assert data_version(settings, lambda: NOW) != before


# ---------------------------------------------------------------------------
# Handover: atomare Publikation, Wiederanlauf, Parallelität
# ---------------------------------------------------------------------------


def test_append_schreibt_atomar_und_gestempelt(tmp_path):
    settings = _settings(tmp_path)
    _append_archive(settings, [_fill("a"), _fill("b")])

    path = feedback_archive_path(settings)
    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["schema_version"] == FEEDBACK_SCHEMA_VERSION
    # Kein temporärer Rest — der nächste Lauf (und der Restore) sieht nur
    # die fertige Datei.
    assert not [p for p in path.parent.iterdir() if p.name.startswith(".archive")]


def test_append_unterscheidet_sammlungen_und_identitaeten(tmp_path):
    """Settlement-Identität ist ``snapshot_id``, Füllungs-/Episoden-Identität ``id``."""
    settings = _settings(tmp_path)
    _append_archive(
        settings,
        [
            _fill("f1"),
            _fill("f1"),  # dieselbe Identität nochmals: letzte Fassung gewinnt
            {
                "collection": "settlements",
                "snapshot_id": "s1",
                "settled_at": OLD.isoformat(),
            },
        ],
    )
    lines = feedback_archive_path(settings).read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    assert json.loads(lines[1])["snapshot_id"] == "s1"


def test_append_verweigert_beschaeftigtes_archiv(tmp_path):
    """Korruption wird nicht fortgeschrieben — auch nicht vom eigenen Writer."""
    settings = _settings(tmp_path)
    path = feedback_archive_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    defective = '{"collection":"fills","id":"x"'  # abgeschnittene Zeile
    path.write_text(defective + "\n", encoding="utf-8")

    with pytest.raises(ArchiveCorrupted):
        _append_archive(settings, [_fill("y")])

    assert path.read_text(encoding="utf-8") == defective + "\n"


def test_wiederanlauf_nach_unterbrechung_verliert_nichts(tmp_path, monkeypatch):
    """Abbruch zwischen Archiv- und Store-Speicherung: nichts Committetes geht verloren.

    Die Retention archiviert zuerst (atomar), danach erst den Store. Stirbt
    der Prozess dazwischen, steht der ausgelagerte Beleg im Archiv **und**
    noch im unveränderten heißen Bestand — der Merge sieht ihn genau einmal
    (heiß gewinnt). Der Beleg des abgebrochenen Schreibvorgangs selbst ist
    nicht persistiert; der Aufrufer hat den Fehler erhalten. Der nächste
    Lauf archiviert denselben Beleg erneut, ohne eine Dublette zu hinterlassen.
    """
    settings = _settings(tmp_path)
    from app import feedback

    aged = {
        "id": "fill_aged",
        "liters": 40,
        "price_paid": 1.7,
        "fuel": "e10",
        "tanked_at": OLD.isoformat(),
        "voided": False,
    }
    first = {
        "id": "fill_first",
        "liters": 20,
        "price_paid": 1.8,
        "fuel": "e10",
        "tanked_at": NOW.isoformat(),
        "voided": False,
    }
    retry = {
        "id": "fill_retry",
        "liters": 20,
        "price_paid": 1.8,
        "fuel": "e10",
        "tanked_at": NOW.isoformat(),
        "voided": False,
    }

    # Erster Lauf: Archiv schreiben gelingt, Store-Speicherung bricht ab —
    # der Beleg dieses Schreibvorgangs (`first`) wird nicht persistiert,
    # der Aufrufer hat den Fehler erhalten.
    def crash(settings_, store):
        raise RuntimeError("Abbruch nach Archiv-Publikation")

    monkeypatch.setattr(feedback, "save_store", crash)
    with pytest.raises(RuntimeError):
        with locked_store(settings) as store:
            store["fills"] = [aged, first]

    # Der bereits committete Bestand bleibt vollständig: aged liegt
    # archiviert, der abgebrochene Schreibversuch hat nichts zerstört.
    ledger = load_ledger(settings)
    assert [fill["id"] for fill in ledger["fills"]] == ["fill_aged"]

    # Wiederanlauf: derselbe Beleg wird erneut ausgelagert (er stand noch im
    # abgebrochenen Store) — keine Dublette im Archiv, der neue Beleg landet.
    monkeypatch.undo()
    with locked_store(settings) as store:
        store["fills"] = [aged, retry]

    lines = feedback_archive_path(settings).read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["id"] == "fill_aged"
    ledger = load_ledger(settings)
    assert sorted(fill["id"] for fill in ledger["fills"]) == ["fill_aged", "fill_retry"]


def test_parallelitaet_am_uebergabepunkt_verliert_und_verdoppelt_nichts(tmp_path):
    """Paralleles Lesen während der Retention: vollständiger Ledger, jede Observation.

    Schreibreihenfolge (Archiv zuerst, atomar) + Leserichtung (Store zuerst,
    dann Archiv) garantieren: Jeder Lesevorgang sieht **jeden** jemals
    committeten Beleg — keine Mischung unvereinbarer Revisionen.
    """
    settings = _settings(tmp_path)
    expected: list[str] = []
    stop = threading.Event()
    errors: list[Exception] = []

    def writer():
        i = 0
        while not stop.is_set():
            i += 1
            fill = {
                "id": f"fill_{i}",
                "liters": 40,
                "price_paid": 1.7,
                "fuel": "e10",
                "tanked_at": (NOW - dt.timedelta(days=200)).isoformat(),
                "voided": False,
            }
            try:
                with locked_store(settings) as store:
                    store["fills"] = [fill]
                # Erst nach dem Commit gilt der Beleg als erwartet — ein
                # Leser darf ihn davor noch nicht sehen müssen.
                expected.append(fill["id"])
            except Exception as exc:  # pragma: no cover - Fehlschlag ist Testfehler
                errors.append(exc)
                stop.set()

    def reader():
        while not stop.is_set():
            try:
                # Vor dem Lesen merken, was bereits committet ist: Jeder
                # Lesevorgang muss mindestens diesen Stand sehen. (Belege,
                # die während des Lesens dazukommen, darf er zeigen, er
                # muss sie aber nicht mehr sehen.)
                committed = expected_snapshot()
                ledger = load_ledger(settings)
                seen = [fill["id"] for fill in ledger["fills"]]
                missing = [ident for ident in committed if ident not in seen]
                if missing:  # pragma: no cover
                    errors.append(AssertionError(f"Beleg verloren: {missing}"))
                    stop.set()
                    return
                if len(seen) != len(set(seen)):  # pragma: no cover
                    errors.append(AssertionError(f"Beleg doppelt: {seen}"))
                    stop.set()
                    return
            except Exception as exc:  # pragma: no cover
                errors.append(exc)
                stop.set()
                return

    def expected_snapshot() -> list[str]:
        return list(expected)

    threads = [threading.Thread(target=writer)] + [
        threading.Thread(target=reader) for _ in range(3)
    ]
    for thread in threads:
        thread.start()
    time.sleep(1.0)
    stop.set()
    for thread in threads:
        thread.join(timeout=10)

    assert not errors
    # Endzustand: vollständiger Ledger ohne Dubletten.
    ledger = load_ledger(settings)
    seen = [fill["id"] for fill in ledger["fills"]]
    assert sorted(seen) == sorted(set(seen)) == sorted(expected)


# ---------------------------------------------------------------------------
# Konsistenz über die API: Decide, Summary, Fills/Export, Health, Backup
# ---------------------------------------------------------------------------


def _full_settings(tmp_path) -> Settings:
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


def _corrupt_archive(settings) -> None:
    path = feedback_archive_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        _line(_fill("valid")) + "\n" + '{"collection":"fills","id":"lost"\n',
        encoding="utf-8",
    )


def _live(settings) -> LiveData:
    from app import read_state

    read_state.clear_cache()
    return LiveData(settings, query=lambda *a, **k: [], clock=lambda: NOW)


def test_endpunkte_melden_denselben_zustand(tmp_path):
    """Decide, Overview, Summary und Fills-Summary: ein Code, kein Blatt."""
    settings = _full_settings(tmp_path)
    _corrupt_archive(settings)
    live = _live(settings)

    decide = live.decide({"city": "Frankfurt", "fuel": "e10", "station_id": UID})
    assert decide["error_code"] == "archive_corrupted"
    assert decide["quarantine"], "Rettungsangebot fehlt"

    overview = live.overview({"city": "Frankfurt", "fuel": "e10"})
    codes = {
        entry["component"]: entry["error_code"] for entry in overview["partial_errors"]
    }
    assert codes.get("decide") == "archive_corrupted"
    assert codes.get("stats_summary") == "archive_corrupted"
    assert overview["data_version"], "Datenstand bleibt ehrlich"

    summary = live.stats_summary({"city": "Frankfurt", "fuel": "e10"})
    assert summary["error_code"] == "archive_corrupted"

    fills_summary = live.fills_summary()
    assert fills_summary["error_code"] == "archive_corrupted"


def test_heisse_belege_bleiben_lesbar_und_health_alarmiert(tmp_path):
    """Der Zustand ist auf das Archiv beschränkt: Fills (heiß) bleiben nutzbar.

    Der Health-Alarm folgt der ersten Diagnose (ein Ledger-Lesevorgang
    schreibt den Quarantäne-Report; ``/overview`` pollt ohnehin laufend) —
    danach bleibt er ohne Gesundlügen bis zur Wiederherstellung stehen.
    """
    settings = _full_settings(tmp_path)
    _corrupt_archive(settings)
    live = _live(settings)

    # Erst eine Diagnose (wie im Betrieb: der nächste Overview-Poll) …
    assert (
        live.decide({"city": "Frankfurt", "fuel": "e10", "station_id": UID})[
            "error_code"
        ]
        == "archive_corrupted"
    )

    # … dann bleibt der unbeschädigte Teil nutzbar und Health nennt den Zustand.
    fills = live.fills()
    assert fills["error_code"] is None  # heißer Store ist gesund

    health = live.health()
    alarms = [a for a in health["alarms"] if a["code"] == "archive_corrupted"]
    assert alarms and alarms[0]["severity"] == "error"
    assert alarms[0]["quarantine"]


def test_settlement_job_meldet_archiv_defekt(tmp_path):
    """Der Job verbucht den benannten Code, wenn die Retention das Archiv nicht fort schreiben kann."""
    from app import feedback

    settings = _full_settings(tmp_path)
    aged = {
        "id": "fill_aged",
        "liters": 40,
        "price_paid": 1.7,
        "fuel": "e10",
        "tanked_at": OLD.isoformat(),
        "voided": False,
    }
    feedback.save_store(settings, {**feedback._empty_feedback_store(), "fills": [aged]})
    _corrupt_archive(settings)

    result = run_settlement_job(settings)

    assert result == {"state": "failed", "error_code": "archive_corrupted"}


def test_schreibpfad_mit_retention_schlaegt_benannt_fehl(tmp_path):
    """Beleg schreiben, wenn die Retention das defekte Archiv fortsetzen müsste.

    Der Schreibversuch kehrt mit ``archive_corrupted`` (503) zurück — der
    heiße Bestand bleibt unverändert, der Beleg geht nicht verloren.
    """
    settings = _full_settings(tmp_path)
    aged = {
        "id": "fill_aged",
        "liters": 40,
        "price_paid": 1.7,
        "fuel": "e10",
        "tanked_at": OLD.isoformat(),
        "voided": False,
    }
    from app import feedback

    feedback.save_store(settings, {**feedback._empty_feedback_store(), "fills": [aged]})
    _corrupt_archive(settings)

    with pytest.raises(ArchiveCorrupted):
        record_fill(
            settings,
            {
                "station_id": UID,
                "liters": 35.0,
                "price_paid": 1.719,
                "fuel": "e10",
                "tanked_at": NOW.isoformat(),
                "source": "manuell",
            },
            live_data=None,
            clock=lambda: NOW,
        )

    # Der heiße Bestand wurde nicht über den fehlgeschlagenen Versuch
    # ersetzt: der alte Beleg steht weiterhin, der neue nicht halb drin.
    store = feedback.load_store(settings)
    assert [fill["id"] for fill in store["fills"]] == ["fill_aged"]


def test_api_status_und_error_code(tmp_path):
    """GET antwortet 200 + Code, POST mit gesperrter Retention 503 — wie beim Store."""
    settings = _full_settings(tmp_path)
    aged = {
        "id": "fill_aged",
        "liters": 40,
        "price_paid": 1.7,
        "fuel": "e10",
        "tanked_at": OLD.isoformat(),
        "voided": False,
    }
    from app import feedback

    feedback.save_store(settings, {**feedback._empty_feedback_store(), "fills": [aged]})
    _corrupt_archive(settings)
    live = _live(settings)
    httpd = app.server.make_server(settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{httpd.server_port}"
    try:
        # GET /overview: 200 mit Teilfehler-Code statt 500.
        with urllib.request.urlopen(
            base + "/api/v1/overview?city=Frankfurt&fuel=e10", timeout=20
        ) as response:
            assert response.status == 200
            body = json.loads(response.read().decode("utf-8"))
        codes = {e["component"]: e["error_code"] for e in body["partial_errors"]}
        assert codes.get("decide") == "archive_corrupted"

        # POST /fills (Retention müsste ins defekte Archiv): 503, wiederholbar.
        request = urllib.request.Request(
            base + "/api/v1/fills",
            data=json.dumps(
                {
                    "station_id": UID,
                    "liters": 35.0,
                    "price_paid": 1.719,
                    "fuel": "e10",
                    "tanked_at": NOW.isoformat(),
                    "source": "manuell",
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(request, timeout=20)
        assert raised.value.code == 503
        assert (
            json.loads(raised.value.read().decode("utf-8"))["error_code"]
            == "archive_corrupted"
        )

        # Health bleibt erreichbar und nennt den Zustand.
        with urllib.request.urlopen(base + "/api/v1/health", timeout=20) as response:
            health = json.loads(response.read().decode("utf-8"))
        assert any(a["code"] == "archive_corrupted" for a in health["alarms"])
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)
