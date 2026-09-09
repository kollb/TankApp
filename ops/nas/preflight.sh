#!/usr/bin/env bash
# Prueft VOR "python3 tankapp.py nas-up", ob die privaten Konfigurationsdateien
# auf dem NAS liegen. Liest keine Geheimnisse aus und gibt keine Token aus.
#
#   cd /mnt/user/appdata/tankapp && bash ops/nas/preflight.sh

set -u
cd "$(dirname "$0")/../.." || exit 1

ok=0
fail=0
warn=0

say_ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; ok=$((ok+1)); }
say_fail() { printf '  \033[31mFEHLT\033[0m %s\n' "$1"; fail=$((fail+1)); }
say_warn() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; warn=$((warn+1)); }

echo
echo "TankApp NAS-Preflight  ($(pwd))"
echo "======================================================"
echo
echo "PFLICHT - ohne diese bricht nas-up ab:"

# 1) polling.json (gitignored, kommt vom Pi)
POLL="docs/analysis/stations/polling.json"
if [ -f "$POLL" ]; then
  if python3 -c "import json,sys; json.load(open('$POLL',encoding='utf-8-sig'))" 2>/dev/null; then
    n=$(python3 -c "
import json
d=json.load(open('$POLL',encoding='utf-8-sig'))
s=d.get('sets',d) if isinstance(d,dict) else d
print(sum(len(v) for v in s.values()) if isinstance(s,dict) else len(s))
" 2>/dev/null || echo "?")
    say_ok "$POLL  ($n Stationen)"
  else
    say_fail "$POLL  ist kein gueltiges JSON"
  fi
else
  say_fail "$POLL  -> vom Pi kopieren (aktives Set nach activate-polling!)"
fi

# 2) influx.env (gitignored, Lese-Token)
ENVF="data/influx.env"
if [ -f "$ENVF" ]; then
  missing=""
  for key in TANKAPP_INFLUX_URL TANKAPP_INFLUX_ORG TANKAPP_INFLUX_BUCKET TANKAPP_INFLUX_TOKEN; do
    grep -q "^${key}=" "$ENVF" || missing="$missing $key"
  done
  if [ -n "$missing" ]; then
    say_fail "$ENVF  -> fehlende Schluessel:$missing"
  else
    url=$(grep '^TANKAPP_INFLUX_URL=' "$ENVF" | cut -d= -f2-)
    case "$url" in
      *localhost*|*127.0.0.1*|*::1*)
        say_fail "$ENVF  -> URL ist '$url'; aus dem Container nicht erreichbar. NAS-LAN-IP:8086 verwenden." ;;
      *) say_ok "$ENVF  (URL $url)" ;;
    esac
    if grep -qE '^TANKAPP_INFLUX_TOKEN=(<.*>)?$' "$ENVF"; then
      say_fail "$ENVF  -> TANKAPP_INFLUX_TOKEN ist leer oder ein Platzhalter"
    fi
    perm=$(stat -c '%a' "$ENVF" 2>/dev/null || echo "")
    [ "$perm" = "600" ] || say_warn "$ENVF  Rechte $perm (empfohlen: chmod 600)"
  fi
else
  say_fail "$ENVF  -> anlegen mit InfluxDB-Nur-Lese-Zugang (4 Schluessel)"
fi

echo
echo "OPTIONAL - ohne diese startet die Live-GUI, aber ohne Archiv/Prognosen:"

# 3) netrc (Tankerkoenig-ARCHIV-Zugang, nicht der Collector-Key)
found_netrc=""
for c in data/_netrc data/.netrc _netrc .netrc "$HOME/.netrc" "$HOME/_netrc"; do
  [ -f "$c" ] && { found_netrc="$c"; break; }
done
if [ -n "$found_netrc" ]; then
  perm=$(stat -c '%a' "$found_netrc" 2>/dev/null || echo "")
  say_ok "netrc gefunden: $found_netrc"
  [ "$perm" = "600" ] || say_warn "$found_netrc  Rechte $perm (empfohlen: chmod 600)"
else
  say_warn "kein netrc  -> Tankerkoenig-ARCHIV-Zugang (NICHT der Collector-API-Key)."
  printf '        Ohne ihn: keine Historie -> keine Modelle -> last_forecasts bleibt leer.\n'
fi

# 4) Was hier NICHT hingehoert
if [ -f data/apikey.txt ]; then
  say_warn "data/apikey.txt liegt auf dem NAS - wird hier nicht gebraucht (nur Pi/Collector)."
fi

echo
echo "UMGEBUNG:"
command -v docker >/dev/null 2>&1 && say_ok "docker vorhanden" || say_fail "docker fehlt"
if docker compose version >/dev/null 2>&1; then
  say_ok "docker compose v2 vorhanden"
else
  say_fail "docker compose v2 fehlt (Unraid: Compose-Plugin aus Community Apps)"
fi
pv=$(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null || echo "")
if [ -n "$pv" ]; then
  # Version reicht nicht: ein Python von einem fremden System (z. B. neuere
  # glibc) scheitert schon an "import math" mit einem GLIBC-Fehler, obwohl
  # die Versionsnummer oben problemlos ausgegeben wird.
  if python3 -c "import math" >/dev/null 2>&1; then
    say_ok "python3 $pv"
  else
    say_fail "python3 $pv laedt die eigene Standardbibliothek nicht (python3 -c 'import math' schlaegt fehl, z. B. GLIBC-Fehler): Python passt nicht zur NAS-glibc -> docs/INSTALL.md, 'Stoerungsfall NAS: unpassendes Python'"
  fi
else
  say_fail "python3 fehlt"
fi

echo
echo "======================================================"
if [ "$fail" -gt 0 ]; then
  printf 'Ergebnis: \033[31m%d Problem(e)\033[0m, %d Warnung(en). nas-up wuerde abbrechen.\n' "$fail" "$warn"
  exit 1
fi
printf 'Ergebnis: \033[32malles Pflichtnoetige da\033[0m (%d ok, %d Warnung(en)).\n' "$ok" "$warn"
echo "Naechster Schritt: python3 tankapp.py nas-up"
exit 0
