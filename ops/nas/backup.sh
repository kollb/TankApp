#!/usr/bin/env bash
# TankApp NAS-Backup der Laufzeitdaten (runtime/) — B1, Aufbewahrung O33,
# validierte Veröffentlichung + Restore-Nachweis A21-B3.2 (#206).
#
# Sichert die App-Laufzeitdaten, die bisher NICHT im Backup waren: persönliche
# Tank-Bilanz (feedback/store.json + feedback/archive.jsonl), Selektion,
# Job-Stände. Der InfluxDB-Volume-Backup (Preise) ist davon getrennt, siehe
# docs/betrieb/BETRIEB.md → "Backup & Wiederherstellung".
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
# A21-B3.2 — Veröffentlichung nur nach Validierung:
#   1. Tar läuft unter einem versteckten, eindeutigen temporären Namen
#      (.tankapp-runtime-<Tag>.<PID>.tar.gz.tmp) IM Zielverzeichnis — ein
#      Abbruch (voller Datenträger, kill) hinterlässt nie eine unvollständige
#      Datei unter dem endgültigen Namen.
#   2. Danach Validierung: nicht leer, gzip-Integrität, Mitgliedliste, und
#      store.json ist enthalten, wenn es ihn im Laufzeitverzeichnis gab.
#   3. Erst danach atomarer Abschluss (mv = rename(2) im selben Dateisystem)
#      und Schreiben des Erfolgs-Manifests (<name>.manifest.json) mit Größe,
#      SHA-256 und Mitgliederzahl. Die App (app/backup.py) liest nur dieses
#      günstige Manifest — sie prüft nicht jeden Tar im Requestpfad.
#   4. Ein konsistenter Ledgerstand: Das Skript nimmt die Sperrdatei des
#      Feedback-Stores (flock, dieselbe Datei wie die App) und sichert
#      store.json vor archive.jsonl — dieselbe Reihenfolge, die auch die
#      Leser der App einhalten (Vertrag: docs/betrieb/BETRIEB.md →
#      "Feedback-Archiv und Ledger-Integrität").
# Ein fehlgeschlagener Lauf beendet sich mit klarer Meldung und Exit-Code != 0
# und lässt den letzten guten Stand unangetastet — der Alarm backup_stale
# (bzw. backup_unverified) der App zeigt den Ausfall dann innerhalb der
# Grenzzeit an.
#
# Die App überwacht das Alter und die Verifiziertheit der Tagesstände (Alarm
# `backup_stale`/`backup_unverified` in GET /api/v1/health, Grenze 36 Stunden)
# — dazu muss TANKAPP_BACKUP_DIR auch im Container gesetzt und das Ziel
# gemountet sein (ops/nas/app/compose.yml).

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
# Versteckt (Punktpräfix), prozess-eindeutig (PID), mit .tmp-Suffix: zählt
# nicht als Backup (App wie Rotation filtern auf den endgültigen Namen) und
# kollidiert nicht mit einem parallelen Lauf.
TMP="$BACKUP_DIR/.tankapp-runtime-$STAMP.$$.tar.gz.tmp"
MANIFEST="$BACKUP_DIR/tankapp-runtime-$STAMP.tar.gz.manifest.json"
# Wartezeit auf die Feedback-Sperre (Sekunden). Die App hält sie nur Sekunden
# (Store schreiben); wer länger wartet, wartet auf ein echtes Problem.
LOCK_WAIT="${TANKAPP_BACKUP_LOCK_WAIT:-120}"

fail() {
    echo "backup.sh: FEHLER: $*" >&2
    exit 1
}

cleanup() {
    [ -n "${TMP:-}" ] && rm -f "$TMP"
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"

# --- 0) Parallele Cronläufe serialisieren ---------------------------------
# Zwei Läufe im selben Ziel würden sich sonst bei Aufräumung und Rotation
# ins Gehege kommen. Ohne flock (nicht jedes NAS hat util-linux im PATH)
# läuft es weiter — die eindeutigen Tempnamen + Validierung + atomares
# Umbenennen halten auch dann jeden endgültigen Namen gültig.
if command -v flock >/dev/null 2>&1; then
    exec 9>"$BACKUP_DIR/.backup.lock"
    flock -w "$((LOCK_WAIT * 5))" 9 || fail "Ein anderer Backup-Lauf hält das Ziel fest (Timeout ${LOCK_WAIT}s*5)."
fi

# Abgebrochene Läufe hinterlassen versteckte .tmp-Dateien. Sie sind inert
# (kein Backup, keine Rotation), aber Müll — unter der Sperre ist Aufräumen
# sicher. Nur Dateien älter als eine Stunde, um einem gerade laufenden
# Prozess (der die Sperre hält, wir also nicht) nicht wegzugreifen.
find "$BACKUP_DIR" -maxdepth 1 -name '.tankapp-runtime-*.tar.gz.tmp' -mmin +60 -delete 2>/dev/null || true
find "$BACKUP_DIR" -maxdepth 1 -name '*.manifest.json.tmp' -mmin +60 -delete 2>/dev/null || true

# --- 1) Konsistenter Laufzeitstand -----------------------------------------
# Reihenfolge der Mitglieder: store.json VOR archive.jsonl — zusammen mit der
# atomaren Publikation der App ist das Tar damit ein konsistenter Ledgerstand,
# selbst wenn die Sperrdatei nicht genommen werden kann. Temporärdateien
# (*.tmp der atomaren Schreiber) werden ausgelassen: Sie sind niemals gültiger
# Inhalt, und eine zwischen Listing und Lesen umbenannte (verschwundene)
# Temp-Datei würde das Tar sonst fehlschlagen lassen.
HAS_STORE=0
HAS_ARCHIVE=0
[ -f "$RUNTIME_DIR/feedback/store.json" ] && HAS_STORE=1
[ -f "$RUNTIME_DIR/feedback/archive.jsonl" ] && HAS_ARCHIVE=1

LOCK_STATE="no_store"
if [ "$HAS_STORE" = 1 ] && command -v flock >/dev/null 2>&1; then
    FEEDBACK_LOCK="$RUNTIME_DIR/feedback/.collector.lock"
    # Dieselbe Sperrdatei, die die App nimmt (polling_plan.collector_lock):
    # Solange wir sie halten, kann keine Retention den Store/das Archiv
    # verschieben — Listing und Tar sehen denselben Stand.
    # Achtung: ``exec 8>… 2>/dev/null`` in einem Guss würde die Umleitung von
    # stderr PERMANENT machen (exec ohne Kommando hält Umleitungen in der
    # Shell) — jeder spätere Fehler wäre stumm. Die Gruppierung begrenzt die
    # Fehler-Unterdrückung auf den Öffnungsversuch, fd 8 bleibt geöffnet.
    if { exec 8>"$FEEDBACK_LOCK"; } 2>/dev/null; then
        if flock -w "$LOCK_WAIT" 8; then
            LOCK_STATE="held"
        else
            fail "Feedback-Sperre nicht erhalten (Timeout ${LOCK_WAIT}s) — kein konsistenter Snapshot möglich. App-Zustand prüfen."
        fi
    else
        # Schreibrechte auf das Sperrverzeichnis fehlen: weiter mit der
        # geordneten Mitgliederliste (dokumentierter Lese-Vertrag), aber
        # sichtbar melden.
        echo "backup.sh: Warnung: Feedback-Sperre nicht öffnbar — sichere in dokumentierter Lesereihenfolge (store.json vor archive.jsonl)." >&2
        LOCK_STATE="unavailable"
    fi
fi

MEMBER_LIST="$(mktemp)"
trap 'rm -f "$MEMBER_LIST"; cleanup' EXIT
{
    if [ "$HAS_STORE" = 1 ]; then printf '%s\0' './feedback/store.json'; fi
    if [ "$HAS_ARCHIVE" = 1 ]; then printf '%s\0' './feedback/archive.jsonl'; fi
    (
        cd "$RUNTIME_DIR" && find . -mindepth 1 \
            \( -path './feedback/store.json' -o -path './feedback/archive.jsonl' \) -prune -o \
            ! -name '*.tmp' -print0
    )
} > "$MEMBER_LIST"
[ -s "$MEMBER_LIST" ] || fail "Laufzeitverzeichnis enthält keine Dateien — TANKAPP_RUNTIME_DIR prüfen. Keine leere Sicherung als Erfolg."

# --no-recursion: Die Mitgliederliste enthält bereits jede Datei (find), und
# Verzeichniseinträge würden sonst ihre Inhalte ein ZWEITES Mal in das Tar
# schreiben — die geordnete Liste wäre Schall und Rauch.
tar --null --no-recursion -czf "$TMP" -C "$RUNTIME_DIR" -T "$MEMBER_LIST" \
    || fail "Tar konnte den Laufzeitstand nicht lesen (Rechte, Datenträger, gelöschte Datei?). Keine Veröffentlichung."

if [ "$LOCK_STATE" = "held" ]; then
    flock -u 8
    exec 8>&-
fi

# --- 2) Validierung VOR der Veröffentlichung -------------------------------
[ -s "$TMP" ] || fail "Tar ist leer (0 Bytes) — keine Veröffentlichung."
gzip -t "$TMP" || fail "gzip-Integritätsprüfung fehlgeschlagen."
ENTRIES="$(tar -tzf "$TMP" | wc -l | tr -d ' ')"
[ "$ENTRIES" -gt 0 ] || fail "Tar enthält keine Mitglieder."
if [ "$HAS_STORE" = 1 ]; then
    tar -tzf "$TMP" | grep -qx './feedback/store.json' \
        || fail "Tar enthält feedback/store.json nicht — Laufzeitverzeichnis prüfen."
fi
if [ "$HAS_ARCHIVE" = 1 ]; then
    tar -tzf "$TMP" | grep -qx './feedback/archive.jsonl' \
        || fail "Tar enthält feedback/archive.jsonl nicht — Laufzeitverzeichnis prüfen."
fi
SIZE="$(wc -c < "$TMP" | tr -d ' ')"
SHA256="$(sha256sum "$TMP" 2>/dev/null | awk '{print $1}' || true)"
[ -n "$SHA256" ] || SHA256="$(shasum -a 256 "$TMP" 2>/dev/null | awk '{print $1}' || true)"
[ -n "$SHA256" ] || SHA256="$(openssl dgst -sha256 "$TMP" 2>/dev/null | awk '{print $NF}' || true)"
[ -n "$SHA256" ] || fail "Kein SHA-256-Werkzeug gefunden (sha256sum/shasum/openssl)."

# --- 3) Atomarer Abschluss + Erfolgsmanifest --------------------------------
[ ! -e "$DAILY" ] || [ -f "$DAILY" ] || fail "$DAILY existiert und ist keine Datei — Ziel aufräumen."
mv -f "$TMP" "$DAILY"

CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\n' \
    "{" \
    "  \"tool\": \"tankapp-backup\"," \
    "  \"manifest_version\": 1," \
    "  \"created_at\": \"$CREATED_AT\"," \
    "  \"file\": \"$(basename "$DAILY")\"," \
    "  \"size_bytes\": $SIZE," \
    "  \"sha256\": \"$SHA256\"," \
    "  \"entries\": $ENTRIES," \
    "  \"gzip\": \"ok\"," \
    "  \"store_present\": $( [ "$HAS_STORE" = 1 ] && echo true || echo false )," \
    "  \"archive_present\": $( [ "$HAS_ARCHIVE" = 1 ] && echo true || echo false )," \
    "  \"feedback_lock\": \"$LOCK_STATE\"" \
    "}" > "$MANIFEST.tmp"
mv -f "$MANIFEST.tmp" "$MANIFEST"

# Monatsstand: der erste (validierte) Lauf eines Monats bleibt liegen
# (unabhängig von der Tages-Rotation). cp -p erhält die Zeitstempel, damit
# die Altersprüfung der App und ein späterer Restore denselben Stand sehen.
if [ ! -e "$MONTHLY" ]; then
    cp -p "$DAILY" "$MONTHLY"
    printf '%s\n' \
        "{" \
        "  \"tool\": \"tankapp-backup\"," \
        "  \"manifest_version\": 1," \
        "  \"created_at\": \"$CREATED_AT\"," \
        "  \"file\": \"$(basename "$MONTHLY")\"," \
        "  \"size_bytes\": $SIZE," \
        "  \"sha256\": \"$SHA256\"," \
        "  \"entries\": $ENTRIES," \
        "  \"gzip\": \"ok\"," \
        "  \"store_present\": $( [ "$HAS_STORE" = 1 ] && echo true || echo false )," \
        "  \"archive_present\": $( [ "$HAS_ARCHIVE" = 1 ] && echo true || echo false )," \
        "  \"feedback_lock\": \"$LOCK_STATE\"," \
        "  \"promoted_from\": \"$(basename "$DAILY")\"" \
        "}" > "$MONTHLY.manifest.json.tmp"
    mv -f "$MONTHLY.manifest.json.tmp" "$MONTHLY.manifest.json"
fi

# --- 4) Rotation: nur abgeschlossene gültige Namen --------------------------
# Monatsstände ausdrücklich ausnehmen — sonst frisst die 14-Tage-Regel auch
# sie, und die alte Monatsrotation wäre nur Dekoration. Manifests werden mit
# ihrem Tar zusammen entfernt (ein Manifest ohne Tar wäre ein Gesundsignal
# ohne Beweis).
find "$BACKUP_DIR" -maxdepth 1 -name 'tankapp-runtime-*.tar.gz' \
    ! -name 'tankapp-runtime-monthly-*.tar.gz' -mtime +"$KEEP_DAYS" -print0 |
    while IFS= read -r -d '' old; do
        rm -f "$old" "$old.manifest.json"
    done

# Rotation Monatsstände: die ältesten entfernen, die letzten KEEP_MONTHLY bleiben.
# sortiert nach Name (=JJJJ-MM), also chronologisch.
find "$BACKUP_DIR" -maxdepth 1 -name 'tankapp-runtime-monthly-*.tar.gz' | sort |
    head -n -"$KEEP_MONTHLY" | while read -r old; do
        rm -f "$old" "$old.manifest.json"
    done

echo "Laufzeitdaten gesichert: $DAILY (Tagesstände: $KEEP_DAYS, Monatsstände: $KEEP_MONTHLY, Mitglieder: $ENTRIES, Verifikation: gzip ok, SHA-256 im Manifest)."
