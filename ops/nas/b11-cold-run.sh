#!/usr/bin/env bash
# B11: strenger Kaltlauf-Beleg auf der Zielhardware — alles in eine Datei.
#
# Ablauf (auf dem NAS-Host, im Checkout):
#   python3 tankapp.py nas-up          # erst das
#   ops/nas/b11-cold-run.sh            # dann dieses Skript
#
# Was das Skript macht:
#   1. wartet auf den sofortigen Modell-Lauf des neuen Containers
#      (Container-Recreate startet den ersten Lauf sofort — TODO, Batch 2)
#   2. löscht den Backtest-Tages-Cache und **verifiziert** die Löschung
#      (Befund 13.09.2026: „9 aus Tages-Cache“ trotz Lösch-Befehl —
#      deshalb Verifikation statt Vertrauen; zusätzlich wird die
#      Mount-Quelle von /data/runtime gegen nas-settings.json geprüft)
#   3. startet den B11-Sammler (ops/nas/measure-phase-b.sh, 5-s-Takt)
#   4. triggert den Modell-Lauf direkt im Container — umgeht Debounce,
#      schreibt Status + Job-Log wie ein planmäßiger Lauf
#   5. wartet auf „beendet:“, stoppt den Sammler
#   6. schreibt EINE Datei: b11-cold-<stempel>/report.txt mit
#      Verifikation, Stichproben, Auswertung, Job-Log-Ende, Worker-stdout,
#      models.json und der Kaltlauf-Prüfung (muss „0 aus Tages-Cache“ sagen)
#
# Dauer ~15–25 min (Recreate-Lauf + Kaltlauf ~9 min) — Terminal offen
# lassen. Nicht mittig Strg-C: der Lauf läuft im Container weiter (gut
# für den Lauf, der Report bleibt unvollständig). Danach report.txt
# nachgeben; Ergebnis in TODO.md bei B11 eintragen.

set -u

CONTAINER="${1:-tankapp-web-app-1}"
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAS_SETTINGS="$REPO_ROOT/data/nas-settings.json"

RUNTIME_DIR=$(python3 -c \
  "import json; print(json.load(open('$NAS_SETTINGS'))['runtime_dir'])" 2>/dev/null || true)
[ -n "${RUNTIME_DIR:-}" ] || RUNTIME_DIR="$REPO_ROOT/data/runtime"
CACHE_DIR="$RUNTIME_DIR/engine/backtest-cache"
JOB_LOG="$RUNTIME_DIR/jobs/models.log"
STATE_JSON="$RUNTIME_DIR/jobs/models.json"

STAMP=$(date +%Y%m%d-%H%M%S)
OUTDIR="./b11-cold-$STAMP"
mkdir -p "$OUTDIR/samples" || exit 1
REPORT="$OUTDIR/report.txt"

say() { printf '%s\n' "$*" | tee -a "$REPORT"; }

job_state() {
  python3 - "$STATE_JSON" <<'PY' 2>/dev/null || true
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("state", ""))
except Exception:
    pass
PY
}

worker_alive() { # 1, wenn ein `python -m app.worker …` im Container läuft
  # (kein ps/pgrep im Image — /proc-Scan, s. measure-phase-b.sh;
  # [a]-Klammer, damit der Scan sich selbst nicht trifft)
  docker exec "$CONTAINER" sh -c '
      for d in /proc/[0-9]*; do
          c=$(tr "\0" " " < "$d/cmdline" 2>/dev/null)
          case "$c" in
              *[a]pp.worker*) echo 1; exit 0 ;;
          esac
      done
      echo 0' 2>/dev/null
}

say "== B11-Kaltlauf-Beleg — $(date -Iseconds)"
say "Host: $(hostname) · Container: $CONTAINER · Runtime: $RUNTIME_DIR"
say "Commit: $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unbekannt)"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -Fxq "$CONTAINER"; then
  say "FEHLER: Container $CONTAINER läuft nicht — erst python3 tankapp.py nas-up ausführen."
  exit 1
fi

# Gegenprobe zum Befund 13.09.2026: was sieht der Container unter /data/runtime?
MOUNT_SRC=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data/runtime"}}{{.Source}}{{end}}{{end}}' "$CONTAINER" 2>/dev/null)
say "Mount /data/runtime ← ${MOUNT_SRC:-?}"
if [ -n "$MOUNT_SRC" ] && [ "$MOUNT_SRC" != "$RUNTIME_DIR" ]; then
  say "WARNUNG: Mount-Quelle ($MOUNT_SRC) != runtime_dir aus $NAS_SETTINGS ($RUNTIME_DIR) — Cache-Pfad prüfen!"
fi

# -- 1) allfälliger Lauf abwarten -------------------------------------------
STARTED_AT=$(docker inspect --format '{{.State.StartedAt}}' "$CONTAINER" 2>/dev/null)
AGE=$(python3 -c \
  "import datetime, sys
t = datetime.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
print(int((datetime.datetime.now(datetime.timezone.utc) - t).total_seconds()))" \
  "$STARTED_AT" 2>/dev/null || echo -1)

wait_until_done() { # ≤20 min warten, bis kein Worker mehr läuft
  local deadline=$(( $(date +%s) + 1200 ))
  while [ "$(job_state)" = "running" ] && [ "$(worker_alive)" = "1" ] \
      && [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 15
  done
  local st; st=$(job_state)
  if [ "$st" = "running" ] && [ "$(worker_alive)" = "1" ]; then
    say "FEHLER: Lauf läuft seit >20 min — Abbruch, später neu versuchen."
    return 1
  fi
  say "   Lauf beendet (state: ${st:-?})."
  return 0
}

if [ "$AGE" -gt 0 ] && [ "$AGE" -le 240 ]; then
  say "1) Container frisch (Alter ${AGE}s) — warte auf den sofortigen Modell-Lauf (≤3 min) …"
  deadline=$(( $(date +%s) + 180 ))
  seen=0
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ "$(job_state)" = "running" ] && [ "$(worker_alive)" = "1" ]; then
      say "   Modell-Lauf läuft — warte auf Ende (≤20 min) …"
      wait_until_done && seen=1
      break
    fi
    sleep 5
  done
  [ "$seen" = "1" ] || say "   Kein sofortiger Lauf nach 3 min (unüblich nach Recreate) — Fortsetzung mit eigenem Lauf."
else
  say "1) Container nicht frisch (Alter ${AGE}s) — warte nur, falls gerade ein Lauf läuft …"
  if [ "$(job_state)" = "running" ] && [ "$(worker_alive)" = "1" ]; then
    wait_until_done || exit 1
  else
    say "   Kein Lauf in Gang."
  fi
fi

# -- 2) Cache löschen und verifizieren ---------------------------------------
say "2) Backtest-Cache löschen und verifizieren: $CACHE_DIR"
if [ -d "$CACHE_DIR" ]; then
  say "   Bevorstand:"
  ls -l --time-style=full-iso "$CACHE_DIR" | sed 's/^/   /' | tee -a "$REPORT"
else
  say "   (Verzeichnis existiert noch nicht — ok)"
fi
rm -rf "$CACHE_DIR"
if [ -e "$CACHE_DIR" ]; then
  say "FEHLER: $CACHE_DIR existiert nach rm -rf weiterhin — Abbruch (keine Messung ohne verifizierten Leerzustand)."
  exit 1
fi
say "   Verifiziert: Verzeichnis ist weg."

# -- 3) Sammler starten -------------------------------------------------------
say "3) Sammler starten (5-s-Takt) …"
OUTDIR="$OUTDIR/samples" bash "$REPO_ROOT/ops/nas/measure-phase-b.sh" "$CONTAINER" 5 0 \
  >"$OUTDIR/samples/sampler.out" 2>&1 &
SAMPLER_PID=$!
sleep 3
if ! kill -0 "$SAMPLER_PID" 2>/dev/null; then
  say "FEHLER: Sammler ist sofort gestorben:"
  cat "$OUTDIR/samples/sampler.out" >> "$REPORT"
  exit 1
fi
say "   Sammler läuft (PID $SAMPLER_PID), Stichproben nach $OUTDIR/samples/samples.tsv"

# -- 4) Lauf triggern ---------------------------------------------------------
say "4) Modell-Lauf triggern (docker exec, umgeht Debounce; $(date -Iseconds)) …"
if [ "$(job_state)" = "running" ] && [ "$(worker_alive)" = "1" ]; then
  say "FEHLER: Ein Lauf ist gerade in Gang (Scheduler?) — Skript neu ausführen."
  kill -INT "$SAMPLER_PID" 2>/dev/null
  exit 1
fi
docker exec "$CONTAINER" python -m app.worker models >"$OUTDIR/worker-stdout.log" 2>&1 &
WORKER_PID=$!
sleep 2
if ! kill -0 "$WORKER_PID" 2>/dev/null; then
  say "FEHLER: Worker ist sofort gestorben:"
  cat "$OUTDIR/worker-stdout.log" >> "$REPORT"
  kill -INT "$SAMPLER_PID" 2>/dev/null
  exit 1
fi

# -- 5) auf Ende warten -------------------------------------------------------
say "5) Warten auf „beendet:“ (Kaltlauf ~9 min) — Live-Zeilen aus $JOB_LOG:"
last=""
while kill -0 "$WORKER_PID" 2>/dev/null; do
  line=$(tail -n 1 "$JOB_LOG" 2>/dev/null)
  if [ -n "$line" ] && [ "$line" != "$last" ]; then
    say "   ${line:0:150}"
    last="$line"
  fi
  sleep 5
done
wait "$WORKER_PID"
WORKER_CODE=$?
say "   Worker beendet (Exit-Code $WORKER_CODE)."

# Sammler stoppen (SIGINT → summarise → exit 0)
kill -INT "$SAMPLER_PID" 2>/dev/null
deadline=$(( $(date +%s) + 20 ))
while kill -0 "$SAMPLER_PID" 2>/dev/null && [ "$(date +%s)" -lt "$deadline" ]; do
  sleep 1
done
if kill -0 "$SAMPLER_PID" 2>/dev/null; then
  kill -TERM "$SAMPLER_PID" 2>/dev/null
fi
wait "$SAMPLER_PID" 2>/dev/null

# -- 6) Report ----------------------------------------------------------------
say "6) Report zusammenstellen …"
{
  echo
  echo "=================================================================="
  echo "Stichproben (TSV: zeit phase speicher_mib speicher_proz cpu_proz"
  echo "python_prozesse host_verfuegbar_mib shm_belegt_mib)"
  echo "=================================================================="
  cat "$OUTDIR/samples/samples.tsv" 2>/dev/null
  echo
  echo "=================================================================="
  echo "Auswertung (Sammler)"
  echo "=================================================================="
  sed -n '/=== B11 — Auswertung/,$p' "$OUTDIR/samples/sampler.out" 2>/dev/null
  echo
  echo "=================================================================="
  echo "Job-Log (letzte 40 Zeilen)"
  echo "=================================================================="
  tail -n 40 "$JOB_LOG" 2>/dev/null
  echo
  echo "=================================================================="
  echo "Worker-stdout (letzte 20 Zeilen)"
  echo "=================================================================="
  tail -n 20 "$OUTDIR/worker-stdout.log" 2>/dev/null
  echo
  echo "=================================================================="
  echo "models.json (Endzustand)"
  echo "=================================================================="
  cat "$STATE_JSON" 2>/dev/null
  echo
  echo "=================================================================="
  echo "Kaltlauf-Prüfung"
  echo "=================================================================="
  BT=$(grep -o 'Backtest: [0-9]* aus Tages-Cache, [0-9]* neu gerechnet' "$JOB_LOG" 2>/dev/null | tail -n 1)
  echo "Log-Zeile: ${BT:-nicht gefunden}"
  case "$BT" in
    "Backtest: 0 aus Tages-Cache"*)
      echo "ERGEBNIS: KALT — 0 aus Tages-Cache, Beleg gültig." ;;
    *)
      echo "ERGEBNIS: NICHT KALT (oder Zeile fehlt) —siehe Befund 13.09.2026, TODO B11." ;;
  esac
  tail -n 1 "$JOB_LOG" 2>/dev/null | grep -o 'beendet:.*' | sed 's/^/Endzeile: /'
} >> "$REPORT"

say "Auswertung auf einen Blick:"
tail -n 16 "$OUTDIR/samples/sampler.out" 2>/dev/null | tee -a "$REPORT"
say "Fertig. Report-Datei (die hierher zu geben ist): $REPORT"
