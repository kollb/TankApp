#!/usr/bin/env bash
# TankApp NAS-Backup der Laufzeitdaten (runtime/) — B1.
#
# Sichert die App-Laufzeitdaten, die bisher NICHT im Backup waren: persönliche
# Tank-Bilanz (feedback/store.json), Selektion, Job-Stände. Der InfluxDB-Volume-
# Backup (Preise) ist davon getrennt, siehe docs/BETRIEB.md → "Backup & Wiederherstellung".
#
# Aufruf (cron, täglich):
#   TANKAPP_RUNTIME_DIR=/pfad/zu/runtime TANKAPP_BACKUP_DIR=/pfad/zu/backup ops/nas/backup.sh
#
# Behältdaten (runtime/) werden als Tar mit Tagesstempel + 14-Tage-Rotation gesichert.

set -euo pipefail

: "${TANKAPP_RUNTIME_DIR:?Setze TANKAPP_RUNTIME_DIR (das in compose.yml gemountete runtime/-Verzeichnis)}"
: "${TANKAPP_BACKUP_DIR:?Setze TANKAPP_BACKUP_DIR (Zielverzeichnis, z. B. das vorhandene NAS-Backup)}"

RUNTIME_DIR="$(cd "$TANKAPP_RUNTIME_DIR" && pwd)"
BACKUP_DIR="$TANKAPP_BACKUP_DIR"
STAMP="$(date +%F)"
KEEP_DAYS="${TANKAPP_BACKUP_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

tar czf "$BACKUP_DIR/tankapp-runtime-$STAMP.tar.gz" -C "$RUNTIME_DIR" .

# Rotation: ältere Tages-Snapshots entfernen (nur tankapp-runtime-*.tar.gz).
find "$BACKUP_DIR" -maxdepth 1 -name 'tankapp-runtime-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "Laufzeitdaten gesichert: $BACKUP_DIR/tankapp-runtime-$STAMP.tar.gz"
