"""O34 — Historie und Archiv haben keine Aufbewahrungsregel.

Vor 0.52.0 schrieb der InfluxDB-Cron wöchentlich ``influxdb-<datum>.tar.gz``
nach ``ops/nas/influxdb/backup/`` — ohne Rotation (anders als
``ops/nas/backup.sh``, das seit 0.47.0 Tages- und Monatsstände kappt). Jeder
Wochen-Snapshot enthält die ganze Historie: nach einem Jahr 52 Kopien
desselben Bestands. Das Roharchiv (``--archive-dir``) kam dagegen in keiner
Sicherung vor — weder als „wird mitgesichert" noch als „bewusst nicht".

Batch-Check: Der InfluxDB-Cron rotiert (``find … -mtime +N -delete`` im
Befehl), und [BETRIEB.md](../docs/BETRIEB.md) nennt die Archiv-Entscheidung
mit Begründung.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BETRIEB = ROOT / "docs" / "BETRIEB.md"


def _influx_backup_block() -> str:
    """Der Cron-Befehl des InfluxDB-Backups aus der Betriebs-Doku."""
    text = BETRIEB.read_text(encoding="utf-8")
    start = text.index("### NAS InfluxDB Backup")
    end = text.index("Restore:", start)
    return text[start:end]


def test_influx_cron_rotiert_die_wochenstaende():
    """Batch-Check: ``find … -mtime +N -delete`` steht im Befehl."""
    block = _influx_backup_block()
    match = re.search(
        r"find /backup -maxdepth 1 -name \"influxdb-\*\.tar\.gz\" -mtime \+(\d+) -delete",
        block,
    )
    assert match, "der InfluxDB-Cron rotiert nicht"
    keep_days = int(match.group(1))
    # Wöchentliche Stände: 56 Tage sind acht Kopien — Rotation, kein
    # Voll-Verlust („+0" oder „+7" hieße entweder alles oder nichts behalten).
    assert 28 <= keep_days <= 365, f"Aufbewahrung {keep_days} Tage ist unplausibel"
    # Und die Rotation läuft nur, wenn das Tar geschrieben wurde (&&).
    assert "tar czf /backup/influxdb-" in block
    assert "&& find" in block.replace("\n           ", " ") or "&& \\\n" in block


def test_aufbewahrung_ist_begruendet():
    """Nicht nur eine Zahl, sondern warum sie da steht."""
    text = BETRIEB.read_text(encoding="utf-8")
    assert "**Aufbewahrung (O34):**" in text
    assert "ganze** Historie" in text, (
        "die Begründung muss sagen, dass jeder Stand die ganze Historie enthält"
    )


def test_archiv_entscheidung_steht_in_der_doku():
    """Batch-Check: Das Roharchiv ist eine Entscheidung, keine Lücke."""
    text = BETRIEB.read_text(encoding="utf-8")
    assert "Was bewusst in keiner Sicherung liegt (O34)" in text
    assert "regenerierbar" in text
    # Die Begründung nennt den Weg zurück und was er kostet.
    assert "history-sync" in text
    assert "--delay" in text
    # Und sie grenzt ab, was eben **nicht** regenerierbar ist.
    assert "live gepollten" in text
    assert "runtime/" in text


def test_laufzeit_backup_behaelt_seine_zwei_stufen():
    """Regression: Die O33-Regel (14 Tage + 6 Monate) bleibt bestehen."""
    script = (ROOT / "ops/nas/backup.sh").read_text(encoding="utf-8")
    assert "TANKAPP_BACKUP_KEEP_DAYS:-14" in script
    assert "TANKAPP_BACKUP_KEEP_MONTHLY:-6" in script
    # Zwei getrennte Bestände, zwei getrennte Regeln: Das Laufzeit-Skript
    # fasst die InfluxDB-Tars nicht an (andere Datei, andere Begründung).
    assert "influxdb-" not in script, (
        "das Laufzeit-Skript darf nicht in den InfluxDB-Bestand greifen"
    )
    assert "tankapp-runtime-" not in _influx_backup_block()
