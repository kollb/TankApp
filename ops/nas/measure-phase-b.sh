#!/usr/bin/env bash
# B11: Ressourcen des Modell-Laufs während Phase B messen.
#
# Warum ein Skript und nicht vier Befehle von Hand: Seit B17 (Tages-Cache,
# 0.22.0) dauert Phase B im Warm-Lauf nur noch ~40 s und im Kaltlauf ~2,6 min
# (gemessen 13.09.2026 nach B15/B16; vor den Hebeln 9,4 min am 12.09.).
# Von Hand getippt erwischt man entweder das falsche Fenster oder gar keins.
# Der Sammler schreibt alle 5 s eine Zeile und rechnet am Ende die fünf Zahlen
# aus, die B11 entscheidet.
#
# Verwendung (auf dem NAS-Host, nicht im Container):
#
#   ops/nas/measure-phase-b.sh                     # Container tankapp-web-app-1, 5 s, bis Strg-C
#   ops/nas/measure-phase-b.sh tankapp-web-app-1 3 900
#   OUTDIR=/tmp/b11 ops/nas/measure-phase-b.sh
#
# Ablauf: Skript starten, Modell-Lauf auslösen (oder auf den Planlauf warten),
# nach „beendet: …“ im Job-Log Strg-C. Wärmstens empfohlen für den **Kaltlauf**
# (erster Lauf des lokalen Tages) — das ist der Speicher-Worst-Case.
#
# B11 ist mit 0.25.2 erledigt (Kaltlauf 13.09.2026: 1,0 GiB / 4,1 GiB /
# shm 1 MiB / 381 %). Das Skript bleibt die Wiederholungsmessung.
#
# Stand 13.09.2026 (erster Messlauf): zwei Proben lieferten nichts und sind
# gefixt — (1) `docker top` zeigt ohne `ps` im Image (python:3.14-slim) gar
# keine Prozesse, die Python-Zählung läuft jetzt per /proc-Scan über
# `docker exec`; (2) Fortschrittszeilen stehen nie auf Container-stdout
# (Worker-Subprozess: stdout → runtime/logs/<job>.log), die Phase kommt jetzt
# aus dem Job-Log auf dem Host ($RUNTIME/jobs/models.log).

set -u

CONTAINER="${1:-tankapp-web-app-1}"
INTERVAL="${2:-5}"
DURATION="${3:-0}"
OUTDIR="${OUTDIR:-./b11-$(date +%Y%m%d-%H%M%S)}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker nicht gefunden — das Skript läuft auf dem NAS-Host, nicht im Container." >&2
  exit 1
fi
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -Fxq "$CONTAINER"; then
  echo "Container „$CONTAINER“ läuft nicht. Namen prüfen: docker ps --format '{{.Names}}'" >&2
  exit 1
fi

# Job-Log des Modell-Laufs auf dem Host. Fortschrittszeilen stehen dort,
# nicht auf Container-stdout: der Scheduler startet den Worker als
# Subprozess mit stdout → runtime/logs/<job>.log, der Progress schreibt
# nach runtime/jobs/<job>.log (app/server.py::Scheduler.run_once).
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RUNTIME_DIR=$(python3 -c \
  "import json; print(json.load(open('${REPO_ROOT}/data/nas-settings.json'))['runtime_dir'])" \
  2>/dev/null || true)
JOB_LOG=""
for cand in "${RUNTIME_DIR:-}/jobs/models.log" "$REPO_ROOT/data/runtime/jobs/models.log"; do
  if [ -n "$cand" ] && [ -f "$cand" ]; then
    JOB_LOG="$cand"
    break
  fi
done

mkdir -p "$OUTDIR" || exit 1
RAW="$OUTDIR/samples.tsv"
TAB=$'\t'
printf 'zeit\tphase\tspeicher_mib\tspeicher_proz\tcpu_proz\tpython_prozesse\thost_verfuegbar_mib\tshm_belegt_mib\n' >"$RAW"

to_mib() { # "312.5MiB" / "1.203GiB" -> MiB (ganzzahlig)
  awk -v v="$1" 'BEGIN{
    if (v ~ /GiB$/)  { gsub(/GiB$/,"",v);  printf "%.0f", v*1024 }
    else if (v ~ /MiB$/) { gsub(/MiB$/,"",v); printf "%.0f", v }
    else if (v ~ /KiB$/) { gsub(/KiB$/,"",v); printf "%.0f", v/1024 }
    else if (v ~ /B$/)   { gsub(/B$/,"",v);   printf "%.0f", v/1048576 }
    else printf "0"
  }'
}

current_phase() { # letzte Job-Log-Zeile -> Phase (oder "-")
  if [ -z "$JOB_LOG" ]; then
    printf -- "-"
    return
  fi
  local phase
  phase=$(tail -n 20 "$JOB_LOG" 2>/dev/null |
    grep -oE 'InfluxDB-Export|Live-Abdeckung|Archiv aufbereiten|Bootstrap & Trainingsdaten|Modelle fitten|Selektion \(|\(δ̂\)|Veröffentlichen|beendet:' |
    tail -n 1 |
    sed -e 's/Selektion (/Selektion/' -e 's/(δ̂)/δ/' -e 's/beendet:/fertig/')
  printf '%s' "${phase:--}"
}

count_python_procs() { # Python-Prozesse im Container, ohne ps im Image
  # `docker top` braucht `ps` im Container — python:3.14-slim hat es nicht,
  # `docker top` liefert also keine Ausgabe (Befund 13.09.2026). /proc ist
  # für den Container-User lesbar (alle Prozesse laufen als derselbe User).
  # Erwartet in Phase B: 1 Master + 4 Worker + Forkserver + Resource-Tracker,
  # zusätzlich bis zu 1 Healthcheck-`python -c` (alle 30 s).
  # cmdline *und* comm: `python*` allein verfehlt Forkserver-Kinder, deren
  # argv mit `/usr/local/bin/python` beginnt (Kaltlauf 13.09.2026: max 2).
  docker exec "$CONTAINER" sh -c '
      n=0
      for d in /proc/[0-9]*; do
          c=$(tr "\0" " " < "$d/cmdline" 2>/dev/null)
          m=$(cat "$d/comm" 2>/dev/null)
          case "$c $m" in
              *python*) n=$((n+1)) ;;
          esac
      done
      echo "$n"' 2>/dev/null
}

finished=0
summarise() {
  [ "$finished" = "1" ] && return
  finished=1
  echo
  echo "=== B11 — Auswertung ($(awk 'END{print NR-1}' "$RAW") Stichproben) ==="
  awk -F'\t' 'NR>1 {
      n++
      if ($3+0 > mem)  mem  = $3+0
      if ($4+0 > mp)   mp   = $4+0
      if ($5+0 > cpu)  cpu  = $5+0
      if ($6+0 > proc) proc = $6+0
      if (n==1 || $7+0 < avail) avail = $7+0
      if ($8+0 > shm)    shm  = $8+0
      if ($2 != "-") ph[$2]++
    }
    END {
      if (!n) { print "keine Stichprobe — Skript zu früh beendet?"; exit 1 }
      printf "Python-Prozesse      max %d    (1 Master + 4 Worker; forkserver bringt\n                              Forkserver + Resource-Tracker zusätzlich)\n", proc
      printf "Container-Speicher   max %.0f MiB (%.1f GiB), MEM %% max %.1f\n", mem, mem/1024, mp
      printf "Container-CPU        max %.0f %%\n", cpu
      printf "Host verfügbar       min %.0f MiB (%.1f GiB)\n", avail, avail/1024
      printf "/dev/shm belegt      max %.0f MiB (Limit 256 MiB)\n", shm
      printf "Phasen in den Stichproben:"
      for (p in ph) printf " %s (%d)", p, ph[p]
      printf "\n"
    }' "$RAW"
  echo
  echo "Rohdaten: $RAW"
  echo "Einordnung: 4 Worker × ~150 MB Privat-Speicher ≈ 0,6 GB; der Host hat"
  echo "4,2 Gi verfügbar und Swap 0. Kritisch wird es unter ~500 MiB verfügbar."
  echo "B11-Werte (0.25.2): Peak 1,0 GiB, Host min 4,1 GiB, shm 1 MiB, CPUS 381 %."
}
# Wichtig: ein Handler allein beendet das Skript nicht — ohne das ``exit``
# liefe die Schleife nach Strg-C einfach weiter.
on_signal() {
  summarise
  exit 0
}

trap on_signal INT TERM
trap summarise EXIT

echo "B11-Sammler: Container $CONTAINER, alle ${INTERVAL}s, Ausgabe $RAW"
if [ -n "$JOB_LOG" ]; then
  echo "Phase aus: $JOB_LOG"
else
  echo "Achtung: Job-Log nicht gefunden — Phasenspalte bleibt „-“ (Pfad in data/nas-settings.json prüfen)."
fi
echo "Modell-Lauf jetzt auslösen; nach „beendet:“ Strg-C drücken."
start=$(date +%s)
while :; do
  now=$(date +%s)
  if [ "$DURATION" -gt 0 ] && [ $((now - start)) -ge "$DURATION" ]; then
    break
  fi
  # docker stats --no-stream ist ein Ein-Zeilen-Schnappschuss (kein Stream).
  line=$(docker stats --no-stream --format '{{.MemUsage}}|{{.MemPerc}}|{{.CPUPerc}}' "$CONTAINER" 2>/dev/null)
  if [ -n "$line" ]; then
    mem_used=${line%%|*}
    mem_used=${mem_used%% /*}
    rest=${line#*|}
    mem_perc=${rest%%|*}
    cpu_perc=${rest##*|}
    mem_mib=$(to_mib "$mem_used")
    procs=$(count_python_procs)
    avail=$(free -m 2>/dev/null | awk '/^Mem:/{print ($7 != "" ? $7 : $4)}')
    # shm_size: 256m (compose.yml) — Speicher des Containers allein beantwortet
    # die shm-Frage nicht; Python legt dort u. a. Semaphoren an.
    shm=$(docker exec "$CONTAINER" df -Pm /dev/shm 2>/dev/null | awk 'NR==2{print $3}')
    phase=$(current_phase)
    row="$(date -Iseconds)$TAB${phase:--}$TAB${mem_mib}$TAB${mem_perc%\%}$TAB${cpu_perc%\%}$TAB${procs:-0}$TAB${avail:-0}$TAB${shm:-0}"
    printf '%s\n' "$row" | tee -a "$RAW"
  else
    echo "$(date -Iseconds): Container verschwunden — Abbruch." | tee -a "$RAW" >&2
    break
  fi
  sleep "$INTERVAL"
done
summarise
