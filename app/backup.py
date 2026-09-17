"""O33 — Backup-Alterung ist ein Zustand, kein Blindflug.

``ops/nas/backup.sh`` sichert die Laufzeitdaten (persönliche Tank-Bilanz,
Selektion, Job-Stände) täglich als ``tankapp-runtime-<JJJJ-MM-TT>.tar.gz``.
Vor 0.47.0 wusste die App nichts davon: Starb der Cron — NAS-Update, Pfad
umbenannt, Volume ausgehängt —, meldete nichts, und der Verlust fiel erst beim
Restore auf. Der Alarm-Katalog kannte ``collector_stale``, ``job_failed``,
``store_too_large`` und ``stations_dead``, aber keinen Code für das Backup
(docs/OPTIMIERUNGS-BEFUND.md O33).

Dieses Modul liefert den Zustand dafür: **nur** ``stat`` über das Backup-Ziel,
kein Netz und kein InfluxDB — dieselbe Regel wie der übrige Health-Block
(3–5-s-Budget des Docker-Healthchecks).

Zwei Grenzen, bewusst gezogen:

* Ohne ``TANKAPP_BACKUP_DIR`` ist die Überwachung **nicht eingerichtet** und
  schlägt nicht an. Die App kann nicht wissen, ob anderswo gesichert wird
  (NAS-Snapshot, zweites Skript) — aber der Zustand steht in
  ``/api/v1/health`` → ``backup.configured``, er verschwindet also nicht.
* Gezählt werden die **Tages**-Backups, nicht die Monatsstände
  (``tankapp-runtime-monthly-*``). Ein Monatsstand ist bis zu 31 Tage alt,
  ohne dass etwas fehlt — er würde einen toten Cron einen Monat lang
  überdecken.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

UTC = dt.timezone.utc

# Dateinamen aus ops/nas/backup.sh: tankapp-runtime-<JJJJ-MM-TT>.tar.gz
BACKUP_PREFIX = "tankapp-runtime-"
BACKUP_SUFFIX = ".tar.gz"
# Monatsstände desselben Skripts (Aufbewahrung über die Tages-Rotation hinaus).
BACKUP_MONTHLY_PREFIX = "tankapp-runtime-monthly-"
# 36 Stunden: Der Cron läuft täglich, darf also einmal ausfallen oder zwei
# Stunden verspätet sein, ohne Alarm — aber nicht zwei Nächte hintereinander.
BACKUP_STALE_HOURS = 36.0


def _hours(value: float | None) -> str:
    """Stunden in de-DE — der Alarm nennt das Alter, nicht nur den Code."""
    if value is None:
        return "unbekanntem Alter"
    return f"{value:.1f} Stunden".replace(".", ",")


def _daily_files(directory: Path) -> list[Path]:
    """Tages-Backups im Ziel, ohne Monatsstände (siehe Modul-Docstring)."""
    try:
        entries = list(directory.iterdir())
    except (OSError, ValueError):
        return []
    return [
        path
        for path in entries
        if path.is_file()
        and path.name.startswith(BACKUP_PREFIX)
        and path.name.endswith(BACKUP_SUFFIX)
        and not path.name.startswith(BACKUP_MONTHLY_PREFIX)
    ]


def _count(directory: Path, prefix: str) -> int:
    try:
        return sum(
            1
            for path in directory.iterdir()
            if path.is_file() and path.name.startswith(prefix)
        )
    except (OSError, ValueError):
        return 0


def backup_status(settings, clock=None) -> dict[str, Any]:
    """Alter des neuesten Laufzeit-Backups — ``stat`` über das Backup-Ziel.

    Rückgabe:

    ``configured``      ``TANKAPP_BACKUP_DIR`` ist gesetzt **und** das
                        Verzeichnis existiert (sonst kann die App nichts sehen).
    ``count``           Tages-Backups im Ziel, ``monthly_count`` Monatsstände.
    ``newest_at``       Zeitstempel des neuesten Tages-Backups (UTC, ISO).
    ``age_hours``       Alter in Stunden, ``None`` ohne Backup.
    ``stale``           ``True`` ab :data:`BACKUP_STALE_HOURS` **oder** ohne
                        Tages-Backup im eingerichteten Ziel.
    ``reason``          ``None`` · ``"not_configured"`` · ``"directory_missing"``
                        · ``"no_backup"`` · ``"stale"``.

    Ein nicht eingerichtetes Ziel ist **kein** Alarm (die App weiß nicht, ob
    anderswo gesichert wird), aber ``configured: false`` steht im Health-Payload
    — unsichtbar ist es damit nicht.
    """
    now = (clock or (lambda: dt.datetime.now(UTC)))()
    status: dict[str, Any] = {
        "configured": False,
        "dir": None,
        "count": 0,
        "monthly_count": 0,
        "newest_at": None,
        "age_hours": None,
        "stale_hours": BACKUP_STALE_HOURS,
        "stale": False,
        "reason": "not_configured",
    }
    configured = getattr(settings, "backup_dir", None)
    if not configured:
        return status
    directory = Path(configured)
    status["dir"] = str(directory)
    if not directory.is_dir():
        # Ziel konfiguriert, aber nicht erreichbar (Mount fehlt, Pfad
        # umbenannt): Genau dann wäre ein Backup still verschwunden.
        status["reason"] = "directory_missing"
        status["stale"] = True
        return status

    status["configured"] = True
    status["monthly_count"] = _count(directory, BACKUP_MONTHLY_PREFIX)
    files = _daily_files(directory)
    status["count"] = len(files)
    if not files:
        status["reason"] = "no_backup"
        status["stale"] = True
        return status

    newest = max(files, key=lambda path: path.stat().st_mtime)
    stamp = dt.datetime.fromtimestamp(newest.stat().st_mtime, UTC)
    age_hours = (now - stamp).total_seconds() / 3600
    status["newest_at"] = stamp.isoformat()
    # Ein Zeitstempel in der Zukunft (Uhren-Versatz, Restore mit -p) ist kein
    # negatives Alter — ehrlich bleibt „frisch“.
    status["age_hours"] = round(max(0.0, age_hours), 1)
    if status["age_hours"] > BACKUP_STALE_HOURS:
        status["reason"] = "stale"
        status["stale"] = True
        return status
    status["reason"] = None
    return status


def stale_message(status: dict[str, Any]) -> str:
    """Klartext für den Alarm ``backup_stale`` — Grund und Folge in einem Satz."""
    reason = status.get("reason")
    if reason == "directory_missing":
        return (
            "Das Backup-Ziel der Laufzeitdaten ist nicht erreichbar — es wird "
            "gerade nichts gesichert. Cron-Eintrag, Mount und "
            "TANKAPP_BACKUP_DIR prüfen (docs/BETRIEB.md, "
            "„NAS Laufzeitdaten (runtime/) Backup“)."
        )
    if reason == "no_backup":
        return (
            "Im Backup-Ziel liegt kein Laufzeit-Backup — die Tank-Bilanz hätte "
            "keine Sicherung. Cron-Eintrag für ops/nas/backup.sh prüfen "
            "(docs/BETRIEB.md)."
        )
    return (
        f"Das letzte Laufzeit-Backup ist {_hours(status.get('age_hours'))} alt "
        f"(Grenze {_hours(status.get('stale_hours'))}) — der tägliche Cron hat "
        "mindestens einen Lauf verpasst. Ohne frisches Backup ist die "
        "Tank-Bilanz ungeschützt (docs/BETRIEB.md)."
    )
