"""O33 — Backup-Alterung wird sichtbar, Aufbewahrung passt zur Fehlererkennung.

Drei Lagen, die vorher zusammenkamen: Stirbt der Cron (NAS-Update, Pfad
umbenannt, Volume ausgehängt), meldet nichts. Bei 14 Tagen Rotation ist jeder
Stand älter als zwei Wochen weg — ein Fehler, der langsam zerstört, hat alle
guten Sicherungen überschrieben, bevor ihn jemand bemerkt. Und ein NAS-Ausfall
nimmt Daten **und** Sicherung mit.

Batch-Check: Ein 40 Stunden altes ``tankapp-runtime-*.tar.gz`` ergibt
``backup_stale`` (warn); mit frischem Tar bleibt der Alarm aus; zweites
Backup-Ziel und Aufbewahrungsregel stehen in [BETRIEB.md](../docs/BETRIEB.md).
"""

import datetime as dt
import json
import os
from pathlib import Path

import pytest

from app.alarms import build_alarms
from app.backup import BACKUP_STALE_HOURS, backup_status
from app.config import Settings
from app.data import LiveData

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 17, 12, 0, tzinfo=dt.timezone.utc)
ROOT = Path(__file__).resolve().parents[1]


def _settings(tmp_path, backup_dir=None) -> Settings:
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
        backup_dir=backup_dir,
    )


def _backup(directory: Path, name: str, age_hours: float) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_bytes(b"\x1f\x8b\x08\x00fake-tar")
    stamp = (NOW - dt.timedelta(hours=age_hours)).timestamp()
    os.utime(path, (stamp, stamp))
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


def test_altes_backup_wird_gelb(tmp_path):
    """Batch-Check: 40 Stunden ohne neues Tar → ``backup_stale`` (warn)."""
    target = tmp_path / "backup"
    _backup(target, "tankapp-runtime-2026-09-15.tar.gz", 40)
    settings = _settings(tmp_path, backup_dir=target)

    status = backup_status(settings, clock=lambda: NOW)
    alarms = _alarms(settings, status)

    assert status["stale"] is True
    assert status["reason"] == "stale"
    assert status["age_hours"] == pytest.approx(40.0, abs=0.2)
    hits = [a for a in alarms if a["code"] == "backup_stale"]
    assert len(hits) == 1
    assert hits[0]["severity"] == "warn"
    assert "40,0 Stunden" in hits[0]["message"]
    assert str(BACKUP_STALE_HOURS).replace(".", ",") in hits[0]["message"]


def test_frisches_backup_bleibt_still(tmp_path):
    """Batch-Check: mit frischem Tar kein Alarm — sonst ist der Alarm Taubheit."""
    target = tmp_path / "backup"
    _backup(target, "tankapp-runtime-2026-09-17.tar.gz", 6)
    settings = _settings(tmp_path, backup_dir=target)

    status = backup_status(settings, clock=lambda: NOW)
    alarms = _alarms(settings, status)

    assert status["stale"] is False
    assert status["reason"] is None
    assert status["count"] == 1
    assert status["age_hours"] == pytest.approx(6.0, abs=0.2)
    assert not any(a["code"] == "backup_stale" for a in alarms)


def test_leeres_backup_ziel_ist_auch_ein_alter_zustand(tmp_path):
    """Ziel eingerichtet, aber kein Tar: der Cron lief nie (oder nicht mehr)."""
    target = tmp_path / "backup"
    target.mkdir()
    settings = _settings(tmp_path, backup_dir=target)

    status = backup_status(settings, clock=lambda: NOW)
    alarms = _alarms(settings, status)

    assert status["reason"] == "no_backup"
    assert status["stale"] is True
    assert any(a["code"] == "backup_stale" for a in alarms)


def test_nicht_erreichbares_ziel_sagt_es_statt_zu_schweigen(tmp_path):
    """Mount fehlt oder Pfad umbenannt: genau dann wäre ein Backup still weg."""
    settings = _settings(tmp_path, backup_dir=tmp_path / "gibt-es-nicht")

    status = backup_status(settings, clock=lambda: NOW)
    alarms = _alarms(settings, status)

    assert status["configured"] is False
    assert status["reason"] == "directory_missing"
    assert status["stale"] is True
    assert any(a["code"] == "backup_stale" for a in alarms)


def test_ohne_konfiguration_gibt_es_keinen_alarm_aber_einen_zustand(tmp_path):
    """Kein ``TANKAPP_BACKUP_DIR``: kein Alarm — aber sichtbar ``configured``."""
    settings = _settings(tmp_path)

    status = backup_status(settings, clock=lambda: NOW)

    assert status == {
        **status,
        "configured": False,
        "stale": False,
        "reason": "not_configured",
        "count": 0,
        "age_hours": None,
    }
    assert not any(a["code"] == "backup_stale" for a in _alarms(settings, status))


def test_monatsstand_zaehlt_nicht_als_herzschlag(tmp_path):
    """Ein Monatsstand ist bis zu 31 Tage alt, ohne dass etwas fehlt.

    Würde er zählen, deckte er einen toten Cron bis zu einem Monat lang zu —
    die Altersprüfung zählt deshalb nur die Tagesstände.
    """
    target = tmp_path / "backup"
    _backup(target, "tankapp-runtime-monthly-2026-09.tar.gz", 2)
    settings = _settings(tmp_path, backup_dir=target)

    status = backup_status(settings, clock=lambda: NOW)

    assert status["monthly_count"] == 1
    assert status["count"] == 0
    assert status["reason"] == "no_backup"
    assert status["stale"] is True


def test_health_nennt_den_backup_stand(tmp_path):
    """Der Zustand steht im Health-Payload, nicht nur im Alarm."""
    target = tmp_path / "backup"
    _backup(target, "tankapp-runtime-2026-09-15.tar.gz", 40)
    settings = _settings(tmp_path, backup_dir=target)
    live = LiveData(settings, query=lambda *a, **k: [], clock=lambda: NOW)

    payload = live.health()

    assert payload["backup"]["configured"] is True
    assert payload["backup"]["age_hours"] == pytest.approx(40.0, abs=0.2)
    assert payload["backup"]["newest_at"]
    assert any(a["code"] == "backup_stale" for a in payload["alarms"])


def test_aufbewahrungsregel_steht_im_skript_und_in_der_doku():
    """14 Tagesstände plus 6 Monatsstände — und die Doku nennt beides.

    Die zweite Stufe ist der Punkt: Ohne Monatsstand hat ein langsam
    zerstörender Fehler alle guten Sicherungen überschrieben, bevor ihn
    jemand bemerkt (O33 Lage b).
    """
    script = (ROOT / "ops/nas/backup.sh").read_text(encoding="utf-8")
    # Tages-Rotation nimmt Monatsstände ausdrücklich aus.
    assert "! -name 'tankapp-runtime-monthly-*.tar.gz'" in script
    assert "TANKAPP_BACKUP_KEEP_MONTHLY:-6" in script

    betrieb = (ROOT / "docs/BETRIEB.md").read_text(encoding="utf-8")
    assert "backup_stale" in betrieb
    assert "Monatsstände" in betrieb
    # Zweites Ziel als ausdrückliche Entscheidung, nicht als Nebenwirkung.
    assert "Zweites Ziel" in betrieb


def test_container_mount_ist_dokumentiert_und_read_only():
    """Die App sieht das Ziel nur, wenn es gemountet ist — read-only."""
    override = (ROOT / "ops/nas/app/compose.backup.yml").read_text(encoding="utf-8")
    assert "target: /backup" in override
    assert "read_only: true" in override

    compose = (ROOT / "ops/nas/app/compose.yml").read_text(encoding="utf-8")
    assert "TANKAPP_BACKUP_DIR" in compose

    nas = (ROOT / "app/nas.py").read_text(encoding="utf-8")
    assert "compose.backup.yml" in nas
