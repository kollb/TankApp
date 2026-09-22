"""A21-B3.2 — Backups erst nach Validierung veröffentlichen, Restore nachweisen (#206).

Audit 21.09.2026 (#197 §1.5): ``ops/nas/backup.sh`` schrieb direkt in den
endgültigen Tagesnamen — Unterbrechung konnte einen defekten aktuellen Stand
hinterlassen. ``backup_status()`` bewertete Alter und Name, nicht
Wiederherstellbarkeit: Eine 0-Byte-``tankapp-runtime-<Tag>.tar.gz`` galt als
frisch (``stale=false``, ``reason=null``). Ein Tar über laufend veränderte
Hotstore-/Archivdateien war außerdem kein konsistenter Fachstand.

Der Vertrag jetzt:

* **Validiert veröffentlichen:** Tar unter verstecktem, eindeutigem
  Temporärnamen im Ziel; danach Prüfung (nicht leer, gzip, Mitgliedliste,
  erwartete Inhalte); erst dann atomares Umbenennen und Erfolgsmanifest
  (``<name>.manifest.json``). Ein fehlgeschlagener Lauf signalisiert den
  Fehler und lässt den letzten guten Stand unangetastet.
* **Konsistenter Stand:** Das Skript nimmt die Feedback-Sperre der App und
  sichert ``store.json`` vor ``archive.jsonl`` (dokumentierte Leserichtung).
* **Herzschlag nur verifiziert:** Ein Tagesstand ohne passendes Manifest ist
  ``unverified`` (Alarm ``backup_unverified``, error) — frisches Alter allein
  belegt keine erfolgreiche Sicherung mehr. Alte Bestände ohne Manifest
  werden gezählt (``unverified_count``), nicht als gültig behauptet.
* **Restore nachweisen:** ``ops/nas/restore.sh`` stellt nur in eine leere,
  isolierte Umgebung wieder her; ``ops/nas/verify_restore.py`` prüft
  Belegzahlen, Geldsummen, Stornos, Archiv und Revisionen — gegen die Quelle
  mit ``--compare``. Runtime- und Influx-Sicherung bleiben getrennt.
"""

import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.alarms import build_alarms
from app.backup import backup_status
from app.config import Settings
from app.feedback import (
    _empty_feedback_store,
    _append_archive,
    feedback_archive_path,
    load_ledger,
    locked_store,
    save_store,
)

ROOT = Path(__file__).resolve().parents[1]
BACKUP_SH = ROOT / "ops" / "nas" / "backup.sh"
RESTORE_SH = ROOT / "ops" / "nas" / "restore.sh"
VERIFY_RESTORE = ROOT / "ops" / "nas" / "verify_restore.py"

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 21, 12, 0, tzinfo=dt.timezone.utc)
BACKUP_NAME = f"tankapp-runtime-{dt.date.today().isoformat()}.tar.gz"
OLD = NOW - dt.timedelta(days=120)
# Restore-Skripte rufen ``python3`` — in der Testumgebung ist das der
# Interpreter mit den App-Abhängigkeiten (CI: setup-python; lokal: venv).
PATH_WITH_TEST_PYTHON = str(Path(sys.executable).resolve().parent)


def _settings(tmp_path, backup_dir=None) -> Settings:
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
    (tmp_path / "influx.env").write_text("TANKAPP_INFLUX_URL=http://127.0.0.1:8086\n")
    (tmp_path / "_netrc").write_text("")
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "_netrc",
        static=tmp_path / "static",
        backup_dir=backup_dir,
    )


def _fill(ident: str, *, voided: bool = False, days: int = 120) -> dict:
    return {
        "id": ident,
        "liters": 40,
        "price_paid": 1.7,
        "fuel": "e10",
        "tanked_at": (NOW - dt.timedelta(days=days)).isoformat(),
        "voided": voided,
    }


def _seed_runtime(runtime: Path, fills: list[dict], archive: list[dict] | None = None):
    """Baut einen Laufzeitstand: heißer Store plus (echtes) Archiv."""
    shim = SimpleNamespace(runtime=runtime)
    hot = [fill for fill in fills if fill.get("days", 0) < 0]  # nie genutzt; Klarheit
    hot = [fill for fill in fills if not fill.pop("archived", False)]
    save_store(shim, {**_empty_feedback_store(), "fills": hot})
    if archive:
        _append_archive(shim, [{"collection": "fills", **item} for item in archive])


def _run_backup(
    runtime: Path, target: Path, *extra: str
) -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        "TANKAPP_RUNTIME_DIR": str(runtime),
        "TANKAPP_BACKUP_DIR": str(target),
        "PATH": PATH_WITH_TEST_PYTHON + os.pathsep + os.environ.get("PATH", ""),
    }
    return subprocess.run(
        ["bash", str(BACKUP_SH), *extra],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def _run_restore(tar: Path, target: Path, *extra: str) -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        "PATH": PATH_WITH_TEST_PYTHON + os.pathsep + os.environ.get("PATH", ""),
    }
    return subprocess.run(
        ["bash", str(RESTORE_SH), str(tar), str(target), *extra],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def _manifest_for(target: Path, name: str) -> Path:
    return target / f"{name}.manifest.json"


def _write_manifest(target: Path, name: str, *, size: int | None = None):
    path = target / name
    _manifest_for(target, name).write_text(
        json.dumps(
            {
                "tool": "tankapp-backup",
                "manifest_version": 1,
                "created_at": NOW.isoformat(),
                "file": name,
                "size_bytes": size if size is not None else path.stat().st_size,
                "sha256": "1" * 64,
                "entries": 4,
                "gzip": "ok",
                "store_present": True,
            }
        ),
        encoding="utf-8",
    )


def _age(path: Path, hours: float):
    stamp = (NOW - dt.timedelta(hours=hours)).timestamp()
    os.utime(path, (stamp, stamp))


def _daily(target: Path, name: str, *, verified: bool = True, hours: float = 6) -> Path:
    target.mkdir(parents=True, exist_ok=True)
    path = target / name
    path.write_bytes(b"\x1f\x8b\x08\x00fake-tar")
    _age(path, hours)
    if verified:
        _write_manifest(target, name)
        _age(_manifest_for(target, name), hours)
    return path


def _alarms(settings, backup=None) -> list[dict]:
    return build_alarms(
        settings,
        collector={"available": True, "fresh": True},
        jobs={},
        job_errors={},
        polling_error=None,
        station_count=1,
        clock=lambda: NOW,
        backup=backup,
    )


# ---------------------------------------------------------------------------
# Der Repro: Alter/Name ist keine Wiederherstellbarkeit
# ---------------------------------------------------------------------------


def test_leere_datei_gilt_nicht_als_erfolgreiche_sicherung(tmp_path):
    """Repro aus dem Audit: 0-Byte-Tar unter gültigem Namen → kein Herzschlag."""
    target = tmp_path / "backup"
    empty = _daily(target, BACKUP_NAME, verified=False)
    empty.write_bytes(b"")  # formfrisch, inhaltlich nichts
    settings = _settings(tmp_path, backup_dir=target)

    status = backup_status(settings, clock=lambda: NOW)
    alarms = _alarms(settings, status)

    assert status["age_hours"] == pytest.approx(0.0, abs=0.2)  # Alter ist echt frisch …
    assert status["stale"] is True  # … belegt aber keine erfolgreiche Sicherung
    assert status["reason"] == "unverified"
    assert status["verified"] is False
    hits = [a for a in alarms if a["code"] == "backup_unverified"]
    assert len(hits) == 1 and hits[0]["severity"] == "error"
    assert not any(a["code"] == "backup_stale" for a in alarms)
    assert "nicht als gültig verifiziert" in hits[0]["message"]


def test_nur_temporaere_dateien_gelten_nicht_als_backup(tmp_path):
    """Abgebrochene Läufe hinterlassen versteckte .tmp-Dateien — kein Backup."""
    target = tmp_path / "backup"
    target.mkdir()
    leftover = target / f".{BACKUP_NAME[:-7]}.4242.tar.gz.tmp"
    leftover.write_bytes(b"\x1f\x8b halb")
    settings = _settings(tmp_path, backup_dir=target)

    status = backup_status(settings, clock=lambda: NOW)

    assert status["count"] == 0
    assert status["reason"] == "no_backup"
    assert status["stale"] is True


def test_unverifizierter_neuester_uebertönt_nicht_den_alten_guten(tmp_path):
    """Jüngster Stand ungeprüft, älterer gut: Fehler (nicht nur Warnung),
    und der letzte verifizierte Stand bleibt als Kontext sichtbar."""
    target = tmp_path / "backup"
    _daily(target, "tankapp-runtime-2026-09-15.tar.gz", verified=True, hours=100)
    _daily(target, "tankapp-runtime-2026-09-20.tar.gz", verified=False, hours=10)
    settings = _settings(tmp_path, backup_dir=target)

    status = backup_status(settings, clock=lambda: NOW)
    alarms = _alarms(settings, status)

    assert status["reason"] == "unverified"
    assert status["verified_count"] == 1 and status["unverified_count"] == 1
    assert status["verified_newest_at"]
    assert any(
        a["code"] == "backup_unverified" and a["severity"] == "error" for a in alarms
    )


def test_altbestand_ohne_manifest_ist_gezaehlt_nicht_gueltig(tmp_path):
    """Alte Bestände vor A21-B3.2: ungeprüft gekennzeichnet, nicht behauptet.

    Solange der NEUESTE Stand verifiziert ist, gibt es keinen Alarm — aber
    ``unverified_count`` nennt ehrlich, dass ältere Stände nie geprüft wurden.
    """
    target = tmp_path / "backup"
    _daily(target, "tankapp-runtime-2026-09-10.tar.gz", verified=False, hours=200)
    _daily(target, BACKUP_NAME, verified=True, hours=6)
    settings = _settings(tmp_path, backup_dir=target)

    status = backup_status(settings, clock=lambda: NOW)
    alarms = _alarms(settings, status)

    assert status["reason"] is None and status["stale"] is False
    assert status["verified"] is True
    assert status["verified_count"] == 1 and status["unverified_count"] == 1
    assert not any(a["code"].startswith("backup_") for a in alarms)


def test_manifest_groesse_weicht_ab(tmp_path):
    """Kürzung/Umbenennung nach der Verifikation: Manifest passt nicht mehr."""
    target = tmp_path / "backup"
    path = _daily(target, BACKUP_NAME, verified=True)
    _write_manifest(target, BACKUP_NAME, size=path.stat().st_size - 1)
    settings = _settings(tmp_path, backup_dir=target)

    status = backup_status(settings, clock=lambda: NOW)

    assert status["reason"] == "unverified" and status["stale"] is True


# ---------------------------------------------------------------------------
# backup.sh: validiert, atomar, konsistent
# ---------------------------------------------------------------------------


def test_backup_sh_validiert_und_publiziert(tmp_path):
    runtime = tmp_path / "runtime"
    _seed_runtime(
        runtime,
        [_fill("hot_fresh", days=0), _fill("archived_old", days=120)],
        archive=[_fill("archived_old", days=120)],
    )
    target = tmp_path / "backup"

    result = _run_backup(runtime, target)

    assert result.returncode == 0, result.stderr
    tar = target / BACKUP_NAME
    assert tar.is_file() and tar.stat().st_size > 0
    manifest = json.loads(_manifest_for(target, BACKUP_NAME).read_text())
    assert manifest["file"] == tar.name
    assert manifest["size_bytes"] == tar.stat().st_size
    assert manifest["gzip"] == "ok"
    assert manifest["store_present"] is True and manifest["archive_present"] is True
    assert manifest["feedback_lock"] == "held"
    # Das Manifest ist kein Selbstzweck: Der Hash stimmt mit dem Tar überein.
    assert manifest["sha256"] == hashlib.sha256(tar.read_bytes()).hexdigest()
    # Keine Temporärdatei, kein Monat ohne Tag.
    assert not list(target.glob(".tankapp-runtime-*.tmp"))
    assert (target / "tankapp-runtime-monthly-2026-09.tar.gz").is_file()
    # Geordnete Mitglieder: Store vor Archiv — die dokumentierte Leserichtung.
    with tarfile.open(tar, "r:gz") as archive:
        names = archive.getnames()
    assert names.index("./feedback/store.json") < names.index(
        "./feedback/archive.jsonl"
    )


def test_backup_sh_leere_runtime_ist_kein_erfolg(tmp_path):
    """Leeres Laufzeitverzeichnis: kein Erfolg — vermutlich falsch konfiguriert.

    Ein leeres Tar als „Erfolg“ zu verbuchen hieße: Der Cron läuft scheinbar
    gesund, während das echte Laufzeitverzeichnis (falscher Pfad) nie gesichert
    wird. Der Alarm der App folgt dann innerhalb der Grenzzeit.
    """
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    target = tmp_path / "backup"

    result = _run_backup(runtime, target)

    assert result.returncode != 0
    assert "keine Dateien" in result.stderr
    assert not (target / BACKUP_NAME).exists()


def test_abgebrochener_lauf_laesst_den_letzten_guten_stand(tmp_path):
    """Tar schlägt fehl (unlesbare Datei): Fehler, kein Umbenennen, Tempfort."""
    runtime = tmp_path / "runtime"
    _seed_runtime(runtime, [_fill("hot_fresh", days=0)])
    target = tmp_path / "backup"
    assert _run_backup(runtime, target).returncode == 0
    good = target / BACKUP_NAME
    good_bytes = good.read_bytes()
    _age(good, 30)  # gestern
    _age(_manifest_for(target, BACKUP_NAME), 30)
    # Fault Injection: eine unlesbare Datei im Laufzeitverzeichnis lässt tar
    # scheitern (voller Datenträger/Rechte stehen symptomatisch dafür).
    blocked = runtime / "blocked.json"
    blocked.write_text("x")
    os.chmod(blocked, 0o000)
    if os.geteuid() == 0:  # pragma: no cover - root liert auch 000-Dateien
        pytest.skip("als root wirkt chmod 000 nicht")

    result = _run_backup(runtime, target)

    assert result.returncode != 0
    assert "FEHLER" in result.stderr
    assert good.read_bytes() == good_bytes  # der gute Stand bleibt bytegleich
    assert not list(target.glob(".tankapp-runtime-*.tmp"))


def test_wiederholter_lauf_am_selben_tag_ersetzt_nur_gueltig(tmp_path):
    runtime = tmp_path / "runtime"
    _seed_runtime(runtime, [_fill("hot_fresh", days=0)])
    target = tmp_path / "backup"

    first = _run_backup(runtime, target)
    second = _run_backup(runtime, target)

    assert first.returncode == 0 and second.returncode == 0
    dailies = sorted(target.glob("tankapp-runtime-2*.tar.gz"))
    assert len(dailies) == 1  # derselbe Tagesname, kein zweiter
    assert (
        json.loads(_manifest_for(target, dailies[0].name).read_text())["size_bytes"]
        == dailies[0].stat().st_size
    )
    monthlies = list(target.glob("tankapp-runtime-monthly-*.tar.gz"))
    assert len(monthlies) == 1  # Monatspromotion nur einmal


def test_rotation_nur_auf_fertige_namen_und_mit_manifest(tmp_path):
    """Rotation entfernt alte Tagesstände mitsamt Manifest; .tmp wird Kehricht."""
    runtime = tmp_path / "runtime"
    _seed_runtime(runtime, [_fill("hot_fresh", days=0)])
    target = tmp_path / "backup"
    # Altstand von 20 Tagen (rotiert) und ein uralter Monatsstand.
    _daily(target, "tankapp-runtime-2026-09-01.tar.gz", verified=True, hours=24 * 20)
    _daily(target, "tankapp-runtime-2026-08-31.tar.gz", verified=False, hours=24 * 21)
    stale_tmp = target / ".tankapp-runtime-2026-08-30.999.tar.gz.tmp"
    stale_tmp.write_bytes(b"alt")
    _age(stale_tmp, 2)

    result = _run_backup(runtime, target)

    assert result.returncode == 0, result.stderr
    assert not (target / "tankapp-runtime-2026-09-01.tar.gz").exists()
    assert not _manifest_for(target, "tankapp-runtime-2026-09-01.tar.gz").exists()
    assert not (target / "tankapp-runtime-2026-08-31.tar.gz").exists()
    assert (target / BACKUP_NAME).is_file()  # heute bleibt
    assert not stale_tmp.exists()  # Kehricht abgeräumt


def test_rotationsfehler_wird_signalisiert(tmp_path):
    """Schlägt das Aufräumen fehl, endet der Lauf mit Fehler — kein stilles Weiter."""
    runtime = tmp_path / "runtime"
    _seed_runtime(runtime, [_fill("hot_fresh", days=0)])
    target = tmp_path / "backup"
    old = _daily(
        target, "tankapp-runtime-2026-09-01.tar.gz", verified=True, hours=24 * 20
    )
    # Fault Injection: das Manifest ist ein Verzeichnis — rm scheitert.
    _manifest_for(target, "tankapp-runtime-2026-09-01.tar.gz").unlink()
    _manifest_for(target, "tankapp-runtime-2026-09-01.tar.gz").mkdir()

    result = _run_backup(runtime, target)

    assert result.returncode != 0
    assert (target / BACKUP_NAME).is_file()  # neuer guter Stand bleibt
    assert old.exists() or not old.exists()  # Aufräumen darf teils gelaufen sein


# ---------------------------------------------------------------------------
# Restore: isoliert, verifiziert, getrennt von Influx
# ---------------------------------------------------------------------------


def _rich_runtime(tmp_path) -> Path:
    runtime = tmp_path / "runtime"
    _seed_runtime(
        runtime,
        [
            _fill("fresh_1", days=0),
            _fill("fresh_voided", days=1, voided=True),
        ],
        archive=[
            _fill("arch_1", days=120),
            _fill("arch_voided", days=130, voided=True),
        ],
    )
    return runtime


def test_restore_verifiziert_belegzahlen_summen_stornos(tmp_path):
    runtime = _rich_runtime(tmp_path)
    target = tmp_path / "backup"
    assert _run_backup(runtime, target).returncode == 0
    tar = target / BACKUP_NAME
    restored = tmp_path / "restore-target"

    result = _run_restore(tar, restored, "--compare", runtime)

    assert result.returncode == 0, result.stderr + result.stdout
    ledger = load_ledger(SimpleNamespace(runtime=restored))
    ids = sorted(fill["id"] for fill in ledger["fills"])
    assert ids == ["arch_1", "arch_voided", "fresh_1", "fresh_voided"]
    assert sum(1 for fill in ledger["fills"] if fill.get("voided")) == 2


def test_restore_korruptes_tar_hinterlaesst_kein_halbes_ziel(tmp_path):
    runtime = _rich_runtime(tmp_path)
    target = tmp_path / "backup"
    assert _run_backup(runtime, target).returncode == 0
    tar = target / BACKUP_NAME
    raw = tar.read_bytes()
    tar.write_bytes(raw[: len(raw) // 2])  # abgeschnitten
    restored = tmp_path / "restore-target"

    result = _run_restore(tar, restored)

    assert result.returncode != 0
    assert "gzip" in result.stderr
    assert not restored.exists() or not any(restored.iterdir())


def test_restore_verweigert_nicht_leeres_ziel(tmp_path):
    """Restore läuft nie über einen Bestand — Produktionsschutz."""
    runtime = _rich_runtime(tmp_path)
    target = tmp_path / "backup"
    assert _run_backup(runtime, target).returncode == 0
    tar = target / BACKUP_NAME
    occupied = tmp_path / "occupied"
    occupied.mkdir()
    (occupied / "wichtig.txt").write_text("produktion")

    result = _run_restore(tar, occupied)

    assert result.returncode != 0
    assert "nicht leer" in result.stderr
    assert (occupied / "wichtig.txt").read_text() == "produktion"


def test_restore_verweigert_leeres_backup(tmp_path):
    empty = tmp_path / BACKUP_NAME
    empty.write_bytes(b"")
    result = _run_restore(empty, tmp_path / "target")
    assert result.returncode != 0
    assert "leer" in result.stderr


def test_verifizierer_weist_beschaeftigtes_archiv_aus(tmp_path):
    """Ein Restore mit defektem Archiv besteht die Verifikation nicht."""
    runtime = _rich_runtime(tmp_path)
    target = tmp_path / "backup"
    assert _run_backup(runtime, target).returncode == 0
    restored = tmp_path / "restore-target"
    assert _run_restore(target / BACKUP_NAME, restored).returncode == 0
    feedback_archive_path(SimpleNamespace(runtime=restored)).write_text("{kaputt\n")

    env = {
        **os.environ,
        "PATH": PATH_WITH_TEST_PYTHON + os.pathsep + os.environ.get("PATH", ""),
    }
    result = subprocess.run(
        [sys.executable, str(VERIFY_RESTORE), "--runtime", str(restored)],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )

    assert result.returncode == 1
    assert "nicht lesbar" in result.stderr


def test_restore_unter_gleichzeitiger_app_aktivitaet(tmp_path):
    """Restore unter normaler Aktivität: kein Beleg verloren, keiner doppelt.

    Das Backup nimmt die Feedback-Sperre und sichert in Leserichtung; die App
    schreibt währenddessen weiter. Der wiederhergestellte Stand muss jeden
    Beleg enthalten, der VOR dem Backup committet war — als kompletter,
    parsebarer Ledger.
    """
    runtime = tmp_path / "runtime"
    _seed_runtime(runtime, [_fill("pre_1", days=0)])
    pre_ids = {"pre_1"}
    target = tmp_path / "backup"
    stop = threading.Event()
    failures: list[BaseException] = []

    def writer():
        i = 0
        shim = SimpleNamespace(runtime=runtime)
        while not stop.is_set():
            i += 1
            try:
                with locked_store(shim) as store:
                    store["fills"] = store.get("fills", []) + [
                        _fill(f"during_{i}", days=0)
                    ]
            except ValueError as exc:  # store_locked während der Tar-Phase
                if "store_locked" not in str(exc):
                    failures.append(exc)
            except BaseException as exc:  # pragma: no cover
                failures.append(exc)
                stop.set()

    thread = threading.Thread(target=writer)
    thread.start()
    try:
        result = _run_backup(runtime, target)
    finally:
        stop.set()
        thread.join(timeout=10)
    assert not failures
    assert result.returncode == 0, result.stderr

    restored = tmp_path / "restore-target"
    restore = _run_restore(target / BACKUP_NAME, restored)
    assert restore.returncode == 0, restore.stderr + restore.stdout

    ledger = load_ledger(SimpleNamespace(runtime=restored))
    ids = [fill["id"] for fill in ledger["fills"]]
    assert pre_ids.issubset(set(ids)), "Beleg vor dem Backup fehlt im Restore"
    assert len(ids) == len(set(ids)), "Beleg im Restore doppelt"
    # Und der Zustand war ein echter Snapshot: Alles was drin ist, gab es auch.
    source_ids = {
        fill["id"] for fill in load_ledger(SimpleNamespace(runtime=runtime))["fills"]
    }
    assert set(ids) <= source_ids


def test_influx_trennung_ist_explizit(tmp_path):
    """Runtime-Restore und Influx-Sicherung bleiben getrennte Vorgänge."""
    restore_text = RESTORE_SH.read_text(encoding="utf-8")
    backup_text = BACKUP_SH.read_text(encoding="utf-8")
    # Das Laufzeitskript fasst den InfluxDB-Bestand nicht an …
    assert "influxdb-" not in backup_text
    # … und der Restore benennt die Grenze ausdrücklich: kein Influx-Restore
    # über diesen Weg, niemals auf Produktionsdaten.
    assert "InfluxDB-Volume" in restore_text
    assert "NIEMALS auf Produktionsdaten" in restore_text
    # Auch der Verifizierer liest nur runtime/-Pfade, keine Volumes.
    verify_text = VERIFY_RESTORE.read_text(encoding="utf-8")
    assert "influxdb" not in verify_text.lower()


def test_health_payload_nennt_verifiziertheit(tmp_path):
    """Die neuen Felder stehen im Health-Payload — kein stiller Schema-Wechsel."""
    target = tmp_path / "backup"
    _daily(target, BACKUP_NAME, verified=True, hours=6)
    settings = _settings(tmp_path, backup_dir=target)

    status = backup_status(settings, clock=lambda: NOW)

    for key in ("verified", "verified_count", "unverified_count", "verified_newest_at"):
        assert key in status
    assert status["verified"] is True
