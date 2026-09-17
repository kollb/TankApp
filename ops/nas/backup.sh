#!/usr/bin/env bash
# TankApp NAS-Backup der Laufzeitdaten (runtime/) — B1, Aufbewahrung O33.
#
# Sichert die App-Laufzeitdaten, die bisher NICHT im Backup waren: persönliche
# Tank-Bilanz (feedback/store.json), Selektion, Job-Stände. Der InfluxDB-Volume-
# Backup (Preise) ist davon getrennt, siehe docs/BETRIEB.md → "Backup & Wiederherstellung".
#
# Aufruf (cron, täglich):
#   TANKAPP_RUNTIME_DIR=/pfad/zu/runtime TANKAPP_BACKUP_DIR=/pfad/zu/backup ops/nas/backup.sh
#
# Behältdaten (runtime/) werden als Tar mit Tagesstempel gesichert:
#   - 14 Tagesstände (TANKAPP_BACKUP_KEEP_DAYS),
#   - zusätzlich 6 Monatsstände (TANKAPP_BACKUP_KEEP_MONTHLY).
# Die zweite Stufe ist keine Spielerei (O33): Ein Fehler, der langsam zerstört
# (Wallet-Bug, stille Größen-Grenze), hat alle 14 Tagesstände längst
# überschrieben, bevor ihn jemand bemerkt — ohne Monatsstand gibt es dann
# keinen guten Stand mehr, zu dem man zurück könnte.
#
# Die App überwacht das Alter der Tagesstände (Alarm `backup_stale` in
# GET /api/v1/health, Grenze 36 Stunden) — dazu muss TANKAPP_BACKUP_DIR auch
# im Container gesetzt und das Ziel gemountet sein (ops/nas/app/compose.yml).

set -euo pipefail

: "${TANKAPP_RUNTIME_DIR:?Setze TANKAPP_RUNTIME_DIR (das in compose.yml gemountete runtime/-Verzeichnis)}"
: "${TANKAPP_BACKUP_DIR:?Setze TANKAPP_BACKUP_DIR (Zielverzeichnis, z. B. das vorhandene NAS-Backup)}"

RUNTIME_DIR="$(cd "$TANKAPP_RUNTIME_DIR" && pwd)"
BACKUP_DIR="$TANKAPP_BACKUP_DIR"
STAMP="$(date +%F)"
MONTH="$(date +%Y-%m)"
KEEP_DAYS="${TANKAPP_BACKUP_KEEP_DAYS:-14}"
KEEP_MONTHLY="${TANKAPP_BACKUP_KEEP_MONTHLY:-6}"
DAILY="$BACKUP_DIR/tankapp-runtime-$STAMP.tar.gz"
MONTHLY="$BACKUP_DIR/tankapp-runtime-monthly-$MONTH.tar.gz"

mkdir -p "$BACKUP_DIR"

tar czf "$DAILY" -C "$RUNTIME_DIR" .

# Monatsstand: der erste Lauf eines Monats bleibt liegen (unabhängig von der
# Tages-Rotation). -p erhält die Zeitstempel, damit die Altersprüfung der App
# und ein späterer Restore denselben Stand sehen.
if [ ! -e "$MONTHLY" ]; then
    cp -p "$DAILY" "$MONTHLY"
fi

# Rotation Tagesstände: Monatsstände ausdrücklich ausnehmen — sonst frisst die
# 14-Tage-Regel auch sie, und die alte Monatsrotation wäre nur Dekoration.
find "$BACKUP_DIR" -maxdepth 1 -name 'tankapp-runtime-*.tar.gz' \
    ! -name 'tankapp-runtime-monthly-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

# Rotation Monatsstände: die ältesten entfernen, die letzten KEEP_MONTHLY bleiben.
# sortiert nach Name (=JJJJ-MM), also chronologisch.
find "$BACKUP_DIR" -maxdepth 1 -name 'tankapp-runtime-monthly-*.tar.gz' | sort |
    head -n -"$KEEP_MONTHLY" | while read -r old; do rm -f "$old"; done

echo "Laufzeitdaten gesichert: $DAILY (Tagesstände: $KEEP_DAYS, Monatsstände: $KEEP_MONTHLY)"
