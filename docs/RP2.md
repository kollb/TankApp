# RP2 Fallback-GUI + NAS-Proxy — Konsolidierte Anleitung

> Stand: 09.09.2026 — Konsolidiert aus `rp2/README.md` + `rp2/ANLEITUNG.md`, mit klickbarem Inhaltsverzeichnis.
> Originale bleiben in `rp2/`, diese Datei ist die kanonische Doku im `docs/`-Ordner.

## Inhaltsverzeichnis

- [Ziel](#ziel)
- [Übersicht](#übersicht)
- [Voraussetzungen](#voraussetzungen)
- [Schritt 1: NAS aktualisieren](#schritt-1-nas-aktualisieren)
- [Schritt 2: Code auf RP2 holen](#schritt-2-code-auf-rp2-holen)
- [Schritt 3: NAS-IP konfigurieren](#schritt-3-nas-ip-konfigurieren)
- [Schritt 4: Abhängigkeiten](#schritt-4-abhängigkeiten)
- [Schritt 5: Services einrichten](#schritt-5-services-einrichten)
- [Testen](#testen)
- [Funktionen](#funktionen)
- [Konfiguration](#konfiguration)
- [Fehlersuche](#fehlersuche)
- [Prognose-Qualität](#prognose-qualität)
- [Nutzung](#nutzung)
- [Updates & Changelog](#updates--changelog)

## Ziel

24/7 Verfügbarkeit über **eine Adresse** — den RP2 (Port 8000). NAS online → RP2 leitet transparent zur vollen NAS-GUI weiter. NAS offline → dieselbe Adresse zeigt Fallback-GUI (Live-Preise + gecachte Prognosen).

```text
Browser ──► http://<RP2-IP>:8000
                 │
                 ├─ NAS online  ──► transparenter Proxy: volle NAS-GUI + Live-API
                 │                   (inkl. /api/v1/heatmap, selection, collector/status, route/evaluate)
                 └─ NAS offline ──► Fallback-GUI:
                     • Live-Preise aus /dev/shm/tankapp (echte Datenalter)
                     • Stationennamen/Marken/Koordinaten aus polling.json
                     • gecachte Prognosen (F1/F2/F3) aus /tmp/tankapp_cache
                     • Heartbeat aus meta/heartbeat.json (Collector-Livestatus)
```

## Übersicht

| Komponente | Gerät | Aufgabe |
|---|---|---|
| Collector + Uploader | RP2 | Sammelt Live-Preise, uploadet zu NAS, schreibt heartbeat.json + collector_status |
| Prognose-Berechnung | NAS | Berechnet Prognosen täglich nach Mitternacht + Selektion |
| Vollwertige GUI | NAS (über RP2-Proxy) | Zeigt alles (wenn online) — erreichbar unter `<RP2-IP>:8000` und `<NAS-IP>:1355` |
| Fallback-GUI | RP2 | Zeigt Live-Preise + gecachte Prognosen (24/7), inkl. Dark Mode |
| Forecast Cache | RP2 | Lädt Prognosen vom NAS und cached sie |

Ergebnis:

- ✅ F2 (Hier oder woanders?): Immer verfügbar (Live-Preise aus RP2-Puffer)
- ✅ F1 (Jetzt oder warten?): Verfügbar mit gecachten Prognosen (max 24h alt)
- ✅ F3 (Heute oder später?): Verfügbar mit gecachten Prognosen
- ✅ Eine Adresse: `http://<RP2-IP>:8000` zeigt automatisch NAS- oder Fallback-GUI
- ✅ **B3.11**: Collector-Herzschlag im Fallback sichtbar (tmpfs-Nutzung, älteste Datei)

## Voraussetzungen

### NAS

- Private Konfiguration vorhanden (`polling.json`, `data/influx.env`, für Prognosen `data/_netrc`) — Prüfung: `bash ops/nas/preflight.sh`
- TankApp bereits mit `python3 tankapp.py nas-up` gestartet (inkl. neuer Endpunkte heatmap/selection/collector/route)
- NAS läuft mindestens 6h/Tag
- Port 1355 erreichbar

### RP2

- Python 3.11+ (nur Standardbibliothek)
- RP2 läuft 24/7
- Collector + Uploader aktiv (`tankapp-collector`, `tankapp-uploader`)
- `/dev/shm/tankapp` als tmpfs gemountet
- `polling.json` unter `~/TankApp/docs/analysis/stations/polling.json` — ohne fehlen Namen/Marken/Navigation (UUID wird angezeigt)
- Neu B3: `meta/heartbeat.json` wird automatisch vom Collector gepflegt

## Schritt 1: NAS aktualisieren

API-Endpunkte `/api/v1/last_forecasts`, `/api/v1/heatmap`, `/api/v1/selection`, `/api/v1/collector/status`, `/api/v1/route/evaluate` müssen auf NAS laufen.

#### Private Dateien bereitstellen

| Datei auf NAS | Pflicht? | Woher |
|---|---|---|
| `docs/analysis/stations/polling.json` | ja | vom Pi (aktives Set nach activate-polling) |
| `data/influx.env` | ja | selbst anlegen: InfluxDB-Nur-Lese-Zugang |
| `data/_netrc` | für Prognosen | vorhandener Tankerkönig-Archivzugang |

`data/apikey.txt` gehört nicht aufs NAS — das ist Collector-Key des Pi.

#### Vorab prüfen

```bash
cd /mnt/user/appdata/tankapp
git pull
bash ops/nas/preflight.sh
```

#### Starten

```bash
python3 tankapp.py nas-up
# Unraid: python3 tankapp.py nas-up --uid 99 --gid 100 --archive-dir /mnt/user/data/tankapp
```

Prüfen:

```bash
curl -s http://localhost:1355/api/v1/last_forecasts | head -c 300
curl -s http://localhost:1355/api/v1/heatmap?city=Frankfurt&fuel=e10&kind=level&weeks=2 | head -c 300
curl -s http://localhost:1355/api/v1/selection?fuel=e10 | head -c 300
curl -s http://localhost:1355/api/v1/collector/status | head -c 300
curl -s "http://localhost:1355/api/v1/route/evaluate?city=Frankfurt&fuel=e10&detour_km=3&liters=40" | head -c 300
```

`count: 0` am Anfang normal — bis Archiv/Modelle durchgelaufen. Ohne `_netrc` bleibt count dauerhaft 0.

## Schritt 2: Code auf RP2 holen

```bash
git clone https://github.com/kollb/TankApp.git ~/TankApp   # nur beim ersten Mal
cd ~/TankApp && git pull
```

Alternativ per scp: `scp -r ~/TankApp/rp2 pi@<RP2-IP>:~/TankApp/`

## Schritt 3: NAS-IP konfigurieren

Kein `sed` in Quelldateien! IP als Umgebungsvariable, sonst überschreibt `git pull`.

Skripte lesen `NAS_IP` (optional `NAS_PORT`, Standard 1355).

Schnelltest:

```bash
NAS_IP=192.168.178.50 python3 ~/TankApp/rp2/cache_forecasts.py
```

Fehlt `NAS_IP`, beendet sich Skript sofort mit klarer Meldung.

## Schritt 4: Abhängigkeiten

Es sind keine zu installieren. Beide Skripte nutzen ausschließlich Python-Standardbibliothek (`http.server`, `urllib`). Kein flask, requests, pip.

```bash
python3 --version   # 3.11+ erwartet
```

## Schritt 5: Services einrichten

```bash
sudo cp ~/TankApp/rp2/tankapp-forecast-cache.service /etc/systemd/system/
sudo cp ~/TankApp/rp2/tankapp-fallback-gui.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### NAS-IP als Drop-in

Drop-in liegt außerhalb Git und überlebt Updates:

```bash
sudo systemctl edit tankapp-forecast-cache
# [Service]
# Environment=NAS_IP=192.168.178.50

sudo systemctl edit tankapp-fallback-gui
# [Service]
# Environment=NAS_IP=192.168.178.50
```

### Starten

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tankapp-forecast-cache
sudo systemctl enable --now tankapp-fallback-gui
```

### Benutzer prüfen

Service-Dateien nutzen `User=pi` und `/home/pi/TankApp/rp2`. Heißt Benutzer anders (z. B. `bkoll`):

```bash
whoami
sudo sed -i "s|User=pi|User=$(whoami)|; s|/home/pi/|$HOME/|g" \
  /etc/systemd/system/tankapp-forecast-cache.service \
  /etc/systemd/system/tankapp-fallback-gui.service
sudo systemctl daemon-reload
sudo systemctl restart tankapp-forecast-cache tankapp-fallback-gui
```

### Status prüfen

```bash
systemctl status tankapp-forecast-cache
systemctl status tankapp-fallback-gui
journalctl -u tankapp-forecast-cache -n 30
```

## Testen

### Cache prüfen

```bash
cat /tmp/tankapp_cache/last_forecasts.json | python3 -m json.tool | head -20
cat /dev/shm/tankapp/meta/heartbeat.json | python3 -m json.tool
```

### Browser (immer dieselbe Adresse)

```
http://<RP2-IP>:8000
```

- NAS online: vollwertige NAS-GUI (React, Live-Charts, System-Panel, Heatmaps, Meine Stationen, Collector-Status, Route-Evaluate) — RP2 proxyst transparent
- NAS offline: Fallback-GUI (Markierung „FALLBACK · RP2“) mit Status-Pills, E10/E5/Diesel, Tankgröße, günstigste Station, F1/F3 aus Cache, Stationentabelle, Prognose-Sparklines, Dark-Mode, Heartbeat

### NAS offline testen

```bash
# NAS temporär stoppen
docker stop tankapp
# → Fallback-GUI erscheint ab nächstem Request unter <RP2-IP>:8000
# Fallback erzwingen auch bei NAS online: http://<RP2-IP>:8000/?fallback=1
```

### NAS wieder online

```bash
docker start tankapp
# → innerhalb ~15s oder nach Klick „🔄 NAS prüfen“ bzw. curl http://<RP2-IP>:8000/api/v1/nas-check wieder volle NAS-GUI
```

## Funktionen

| Funktion | NAS Online (proxied) | NAS Offline (Fallback) | Datenqualität |
|---|---|---|---|
| Vollständige NAS-GUI | ✅ unter `<RP2-IP>:8000` | ❌ reduziert | Optimal |
| Live-Preise | ✅ Live | ✅ aus Puffer, echte Datenalter | Optimal |
| F2 (Günstigste Station) | ✅ Voll | ✅ + Ersparnis je Liter & Tank | Optimal |
| F1 (Jetzt/warten?) | ✅ exakt | ✅ vereinfachte Quantil-Logik | Gut (max 24h alt) |
| F3 (Heute/später?) | ✅ exakt | ✅ Top-3-Fenster aus Cache | Gut |
| Heatmaps DoW×Stunde | ✅ **B3.9** via `/api/v1/heatmap` | ❌ braucht InfluxDB | Optimal (NAS) |
| Meine Stationen δ̂ | ✅ **B3.10** via `/api/v1/selection` | ❌ braucht Training | Optimal (NAS) |
| Collector Livestatus | ✅ **B3.11** via `/api/v1/collector/status` | ✅ aus heartbeat.json | Optimal |
| Route Evaluate | ✅ **B3.12** via `/api/v1/route/evaluate` | ✅ lokal im Fallback | Gut |

Fallback-Entscheidung arbeitet ehrlich: aus quantilierten Punkten (q025…q975)
werden **Preis-Score** (0–100 % auf Basis des historischen Quantils,
Gleichverteilungs-Annahme, Formfehler bis ~8,4 Prozentpunkte) und erwartete
Ersparnis geschätzt. Der Fallback nennt das bewusst **nicht**
„Wahrscheinlichkeit“ — die kalibrierte Posterior-Wahrscheinlichkeit (M7)
liefert ausschließlich das NAS; dort bleibt die Bezeichnung unverändert.

## Konfiguration

| Variable | Default | Bedeutung |
|---|---|---|
| `NAS_IP` | – | NAS-Adresse; ohne Wert immer Fallback |
| `NAS_PORT` | `1355` | NAS-Port |
| `NAS_HEALTH_URL` | – | komplette Health-URL (überschreibt IP/Port) |
| `FALLBACK_GUI_PORT` | `8000` | Port RP2-GUI |
| `POLL_DIR` | `/dev/shm/tankapp` | Collector-Ringpuffer |
| `CACHE_DIR` | `/tmp/tankapp_cache` | Prognose-Cache |
| `STATION_META` | – | Pfad zu polling.json (sonst Standardorte) |
| `FORCE_FALLBACK` | – | `1` = Proxy deaktiviert, immer Fallback |

polling.json Suche (erste Treffer):

1. `STATION_META` Env
2. `~/TankApp/docs/analysis/stations/polling.json`
3. `<Repo>/docs/analysis/stations/polling.json`

Ohne polling.json fehlen Namen/Marken/Navigation — UUID wird angezeigt. Datei liegt beim Collector bereits auf Pi.

## Fehlersuche

### Cache funktioniert nicht

```bash
cat /tmp/tankapp_cache/cache.log
python3 ~/TankApp/rp2/cache_forecasts.py
```

Mögliche Ursachen: NAS_IP falsch, NAS liefert count 0 (noch keine Prognosen, meist fehlt data/_netrc), NAS nicht erreichbar, Port falsch.

### GUI zeigt keine Stationen

```bash
ls -la /dev/shm/tankapp/
tail -n 1 /dev/shm/tankapp/$(date +%F).jsonl | python3 -m json.tool
cat /dev/shm/tankapp/meta/heartbeat.json
```

Ursachen: Collector läuft nicht, Polling-Set leer, nachts (00–06) pollt Collector nicht — letzte Zeile von gestern wird angezeigt.

### UUIDs statt Namen

```bash
ls -la ~/TankApp/docs/analysis/stations/polling.json
```

Ursache: polling.json fehlt/korrupt. JSONL enthält nur UUID+Preis, Namen/Marken/Koordinaten liefert polling.json. Neu kopieren, dann `sudo systemctl restart tankapp-fallback-gui`.

### Fallback statt NAS, obwohl NAS online

```bash
curl -s http://<RP2-IP>:8000/api/v1/nas-check
curl -s http://<NAS-IP>:1355/api/v1/health
```

Ursachen: NAS_IP falsch/leer, FORCE_FALLBACK=1, ?fallback=1 in URL, NAS antwortet nicht mit `{"app":"online"}`.

### Port 8000 belegt

```bash
ss -tulnp | grep 8000
# Port ändern per Drop-in:
# sudo systemctl edit tankapp-fallback-gui
# [Service]
# Environment=FALLBACK_GUI_PORT=8080
```

## Prognose-Qualität

- Maximales Alter 24h (wenn NAS um 00:01 offline)
- Typisch 6–12h (wenn NAS tagsüber läuft)
- Aktualisierung alle 5 Min.

Sind 24h alte Prognosen brauchbar? Ja — Preise ändern sich meist langsam über Tag, schnell bei Sprüngen. Für F1/F3 sind 24h alte Prognosen deutlich besser als gar keine.

## Nutzung

### Alltag

1. Immer dieselbe Adresse: `http://<RP2-IP>:8000`
2. Wenn NAS online: automatisch vollwertige NAS-GUI (proxied)
3. Wenn NAS offline: automatisch Fallback mit Live-Preisen + gecachten Prognosen + Heartbeat
4. Fallback erzwingen: `http://<RP2-IP>:8000/?fallback=1`

Für beste Ergebnisse: NAS mindestens 1× täglich starten (06:00–24:00), Prognosen werden um Mitternacht berechnet.

### B3 Features im Alltag

- Heatmaps: Tab Statistik → Heatmaps, wähle Niveau/Probability
- Meine Stationen: Tab Statistik → Meine Stationen, sortiert nach Score, δ̂ mit KI
- Collector Status: Tab System → Pi/tmpfs Livestatus
- Route Evaluate: Tab Alltag → Rechnet sich der Umweg? → Server prüfen Button

## Updates & Changelog

Dependabot öffnet montags automatisch Update-PRs (Python, npm, CI-Actions, Docker-Basisimages via `.github/dependabot.yml`).

1. Watch → Custom → Pull requests anhaken
2. CI-Ampel abwarten (engine, web, nas-image grün), Patch/Minor mergen, Major Release-Notes prüfen
3. Nach Merge ausrollen:

```bash
# NAS
cd /mnt/user/appdata/tankapp
git pull
python3 tankapp.py nas-up

# RP2 (nur bei geändertem RP2-Code)
cd ~/TankApp
git pull
sudo systemctl restart tankapp-forecast-cache tankapp-fallback-gui
```

Wenn nach Update etwas klemmt: `git log --oneline -5`, `git revert <commit>`, `python3 tankapp.py nas-up`

### Changelog

| Version | Datum | Änderungen |
|---|---|---|
| 2.1 | 09.09.2026 | **B3**: NAS-Proxy leitet auch neue Endpunkte heatmap/selection/collector/route weiter. Fallback zeigt Heartbeat (tmpfs-Nutzung). |
| 2.0 | 09.09.2026 | NAS-Proxy: Port 8000 zeigt bei NAS online volle NAS-GUI, Fallback sonst. Namen/Marken/Navigation aus polling.json. Neue Fallback-GUI: Dark/Light, E10/E5/Diesel, Datenalter, Tankgröße, F1/F3 aus Quantil-Prognosen, Sparklines, Auto-Refresh, NAS prüfen. JSON-API: health/stations/forecasts/decide/nas-check. Template-Update per Hash. |
| 1.1 | 09.09.2026 | NAS-IP über Env statt fest im Code; nur Standardbibliothek; atomarer Cache-Write |
| 1.0 | 08.09.2026 | Initial: RP2 Fallback-GUI mit F1/F2/F3 |

Support: Logs prüfen (`journalctl -u tankapp-forecast-cache -f`), Cache prüfen (`cat /tmp/tankapp_cache/last_forecasts.json`), NAS-GUI prüfen (`http://<NAS-IP>:1355`), Heartbeat prüfen (`cat /dev/shm/tankapp/meta/heartbeat.json`).

Viel Erfolg! Mit dieser Lösung tankst du immer günstig – egal ob NAS online ist oder nicht! 🚀💰
