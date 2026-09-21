#!/usr/bin/env bash
# TankApp: Restore eines Laufzeit-Backups in eine ISOLIERTE, LEERE Umgebung (A21-B3.2).
#
# Usage:
#   ops/nas/restore.sh <tankapp-runtime-<JJJJ-MM-TT>.tar.gz> <leeres Zielverzeichnis> \
#       [--compare <Quell-runtime-Verzeichnis>]
#
# Dieses Skript stellt NUR die Laufzeitdaten (runtime/) wieder her — das
# InfluxDB-Volume (Preise) ist ein getrenntes Backup (docs/betrieb/BETRIEB.md
# → "NAS InfluxDB Backup"). Ein echter Influx-Restore gehört ausschließlich
# in einen isolierten Betriebsnachweis und wird NIEMALS auf Produktionsdaten
# zurückgespielt.
#
# Schutzregeln (A21-B3.2):
#   - Das Ziel muss leer sein (oder noch nicht existieren): Restore läuft
#     nie über eine laufende Produktion oder einen Bestand, der noch gebraucht
#     wird. Niemand überschreibt versehentlich das Live-Laufwerk.
#   - Das Tar wird VOR dem Auspacken geprüft (gzip-Integrität) — ein
#     abgebrochenes oder leeres Backup hinterlässt kein halbes Ziel.
#   - Nach dem Auspacken verifiziert ops/nas/verify_restore.py den fachlichen
#     Stand (Belegzahlen, Summen, Stornos, Archiv, Revisionen) — gegen die
#     Quelle, wenn --compare gegeben ist. Ohne python3 endet der Lauf mit
#     Exit-Code 3 und dem Hinweis, wie die Verifikation nachzuholen ist.
#
# Danach: App mit TANKAPP_RUNTIME_DIR=<Ziel> starten oder das verifizierte
# Ziel bewusst an den Produktionsort verschieben.

set -euo pipefail

usage() {
    echo "Usage: $0 <tankapp-runtime-<datum>.tar.gz> <leeres Zielverzeichnis> [--compare <Quell-runtime>]" >&2
    exit 2
}

[ $# -ge 2 ] || usage
TAR="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
TARGET="$2"
COMPARE=""
if [ "${3:-}" = "--compare" ]; then
    [ $# -ge 4 ] || usage
    COMPARE="$(cd "$(dirname "$4")" && pwd)/$(basename "$4")"
elif [ $# -gt 2 ]; then
    usage
fi

fail() {
    echo "restore.sh: FEHLER: $*" >&2
    exit 1
}

[ -f "$TAR" ] || fail "Backup $TAR existiert nicht."
[ -s "$TAR" ] || fail "Backup $TAR ist leer — kein Restore aus einer leeren Datei."
gzip -t "$TAR" || fail "Backup besteht die gzip-Integritätsprüfung nicht (abgebrochen oder beschädigt)."

if [ -e "$TARGET" ]; then
    [ -d "$TARGET" ] || fail "Ziel $TARGET ist kein Verzeichnis."
    if [ -n "$(ls -A "$TARGET")" ]; then
        fail "Ziel $TARGET ist nicht leer — Restore nur in eine isolierte, leere Umgebung (nie über Produktionsdaten)."
    fi
else
    mkdir -p "$TARGET"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
tar xzf "$TAR" -C "$TARGET"

echo "Wiederhergestellt nach: $TARGET"
if command -v python3 >/dev/null 2>&1; then
    if [ -n "$COMPARE" ]; then
        python3 "$SCRIPT_DIR/verify_restore.py" --runtime "$TARGET" --compare "$COMPARE"
    else
        python3 "$SCRIPT_DIR/verify_restore.py" --runtime "$TARGET"
    fi
else
    echo "restore.sh: WARNUNG: python3 fehlt — fachliche Verifikation übersprungen." >&2
    echo "Nachholen (Repository mit App-Abhängigkeiten): python3 ops/nas/verify_restore.py --runtime $TARGET" >&2
    exit 3
fi
echo "Restore verifiziert: $TARGET"
