# TankApp Betrieb — systemd, Backup, Alarme, Fehlersuche

> Stand: 18.09.2026 · App-Version 0.53.0 — alles, was nach der Ersteinrichtung
> wiederkehrt. Ersteinrichtung selbst: [INSTALL.md](INSTALL.md).
> Neu seit 0.52.0: Der InfluxDB-Cron rotiert seine Wochenstände (acht Stände,
> O34), und die Sicherung nennt das Roharchiv als bewusste Entscheidung —
> beide im Abschnitt
> [NAS InfluxDB Backup](#nas-influxdb-backup). Der Server misst sich selbst
> (`X-Process-Time`, `performance` in `/api/v1/health`); Budget und Bedeutung
> stehen in [QUALITAET.md](QUALITAET.md#selbstmessung-des-servers-seit-0520).
> Davor neu seit 0.48.0: Die Prognose-Veröffentlichung ist aufgeteilt (eine Datei je
> Station, `current.json` als Index, O22 Maßnahme d) — die Größen-Grenzen
> gelten der einzelnen Datei, eine fehlende Stations-Datei meldet
> `reason: "incomplete"`. Davor neu seit 0.47.0: Backup-Alterung wird
> überwacht (Alarm `backup_stale`, `backup` im Health-Payload),
> `ops/nas/backup.sh` behält zusätzlich sechs Monatsstände, und der Server
> antwortet mit HTTP/1.1 (O23, O24, O33 — Batch 4 des
> [Optimierungs-Befunds](archiv/OPTIMIERUNGS-BEFUND-2026-09-18.md)).
> Seit 0.46.0: Fenster-Meldungen über den ntfy-Kanal (O29) mit
> dokumentierter Push-Modus-Entscheidung (O42, `TANKAPP_NTFY_MODE`),
> Plausibilitätsgrenzen für Live-Preise samt Zähler und Alarm
> `price_implausible` (O35).
> Mit klickbarem Inhaltsverzeichnis.

## Inhaltsverzeichnis

- [Pi: Collector + Uploader](#pi-collector--uploader)
  - [Repo auf Pi bringen](#repo-auf-pi-bringen)
  - [RAM-Puffer tmpfs](#ram-puffer-tmpfs)
  - [Private Dateien](#private-dateien)
  - [systemd Collector](#systemd-collector)
  - [systemd Uploader](#systemd-uploader)
  - [Betrieb & Kontrolle](#betrieb--kontrolle)
  - [Heartbeat B3.11](#heartbeat-b311)
- [NAS: InfluxDB](#nas-influxdb)
  - [Bestehende Instanz nutzen](#bestehende-instanz-nutzen)
  - [Neue Instanz per Docker](#neue-instanz-per-docker)
  - [Secrets auf Pi](#secrets-auf-pi)
- [NAS: App-Dienst nas-up](#nas-app-dienst-nas-up)
  - [Vorab preflight](#vorab-preflight)
  - [Start](#start)
  - [Unraid Ablauf](#unraid-ablauf)
  - [Portwechsel](#portwechsel)
  - [Was automatisch läuft](#was-automatisch-läuft)
  - [GUI-Responsivität: Straßen-Distanzen ohne Netz-Blockade (seit 0.24.0)](#gui-responsivität-straßen-distanzen-ohne-netz-blockade-seit-0240)
  - [Modell-Lauf beobachten](#modell-lauf-beobachten)
  - [12-Uhr-Bodenkante beobachten (B30, seit 0.51.0)](#12-uhr-bodenkante-beobachten-b30-seit-0510)
  - [Regime-Kalender (B0, seit 0.56.0)](#regime-kalender-b0-seit-0560)
  - [Größe der Veröffentlichung (O22, seit 0.44.0)](#größe-der-veröffentlichung-o22-seit-0440)
  - [Wann erscheinen die Anker-Zeilen im Scoreboard?](#wann-erscheinen-die-anker-zeilen-im-scoreboard)
  - [Lauf manuell anstoßen](#lauf-manuell-anstoßen)
  - [Fehlgeschlagener Lauf: Ursache statt Raten](#fehlgeschlagener-lauf-ursache-statt-raten)
  - [Modell-Lauf beschleunigen](#modell-lauf-beschleunigen)
  - [Ressourcen während Phase B messen (B11)](#ressourcen-während-phase-b-messen-b11)
- [Zugriff im LAN: was lesbar ist (O39, seit 0.50.0)](#zugriff-im-lan-was-lesbar-ist-o39-seit-0500)
- [Backup & Wiederherstellung](#backup--wiederherstellung)
  - [Pi Sicherung](#pi-sicherung)
  - [NAS InfluxDB Backup](#nas-influxdb-backup)
  - [NAS Laufzeitdaten (runtime/) Backup](#nas-laufzeitdaten-runtime-backup)
- [System-Alarme lesen](#system-alarme-lesen)
  - [Alarm-Zustellung über ntfy (B4)](#alarm-zustellung-über-ntfy-b4)
  - [Webhook Pi → NAS (B8, seit 0.38.0)](#webhook-pi--nas-b8-seit-0380)
  - [System-Alarme und GUI-Neuentwurf (seit 0.35.0)](#system-alarme-und-gui-neuentwurf-seit-0350)
  - [Version und Build-Hash prüfen](#version-und-build-hash-prüfen)
- [Fehlersuche](#fehlersuche)
  - [Collector Störungsfälle](#collector-störungsfälle)
  - [Preislücke nachholen (Polling-Ausfall / beschädigtes polling.json)](#preislücke-nachholen-polling-ausfall--beschädigtes-pollingjson)
  - [Legacy-Punkte ohne `station_id` (Namens-Zwillinge)](#legacy-punkte-ohne-station_id-namens-zwillinge)
  - [Uploader Störungsfälle](#uploader-störungsfälle)
  - [parameter error Diagnose](#parameter-error-diagnose)
  - [NAS Python GLIBC Fehler](#nas-python-glibc-fehler)
- [M1 Abnahme 14 Tage](#m1-abnahme-14-tage)

## Pi: Collector + Uploader

### Repo auf Pi bringen

```bash
sudo apt update && sudo apt install -y git python3
git clone https://github.com/kollb/TankApp.git ~/TankApp
cd ~/TankApp
```

### RAM-Puffer tmpfs

```bash
sudo mkdir -p /dev/shm/tankapp
echo 'tmpfs  /dev/shm/tankapp  tmpfs  defaults,noatime,size=32M,mode=0755  0  0' | sudo tee -a /etc/fstab
sudo mount /dev/shm/tankapp
sudo chown pi:pi /dev/shm/tankapp
# Optional stabiler mit uid/gid:
# tmpfs  /dev/shm/tankapp  tmpfs  defaults,noatime,size=32M,uid=pi,gid=pi  0  0
```

32 MiB: ~0,6 MB/Tag, 7 Tage Ringpuffer.

### Private Dateien

Repo kommt von GitHub, zwei Dateien sind gitignored und müssen manuell per scp:

```powershell
scp "data\analysis\stations\polling.json" pi@<pi-ip>:~/TankApp/data/analysis/stations/
scp "data\apikey.txt" pi@<pi-ip>:~/TankApp/data/
```

Alternative ohne Key-Datei: Key in systemd-Umgebung.

### systemd Collector

```bash
sudo tee /etc/systemd/system/tankapp-collector.service > /dev/null <<'UNIT'
[Unit]
Description=TankApp M1 Preis-Collector
After=network-online.target time-sync.target
Wants=network-online.target
[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/TankApp
Environment=TANKAPP_POLL_DIR=/dev/shm/tankapp
ExecStart=/usr/bin/python3 /home/pi/TankApp/data-tools/collect_prices.py
Restart=always
RestartSec=30
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now tankapp-collector
chmod 600 ~/TankApp/data/apikey.txt
```

Nach Unit-Änderung: `sudo systemctl restart tankapp-collector`

### systemd Uploader

```bash
sudo install -d -m 0750 -o pi -g pi /etc/tankapp
sudo tee /etc/tankapp/env > /dev/null <<'ENV'
TANKAPP_INFLUX_URL=http://192.168.178.61:8086
TANKAPP_INFLUX_ORG=gtwrlab
TANKAPP_INFLUX_BUCKET=tankapp
TANKAPP_INFLUX_TOKEN=<Token>
TANKAPP_POLL_DIR=/dev/shm/tankapp
TANKAPP_NAS_WEBHOOK_URL=http://192.168.178.61:1355
TANKAPP_NAS_WEBHOOK_TOKEN=<gleiches Secret wie TANKAPP_WEBHOOK_TOKEN auf dem NAS>
ENV
sudo chmod 600 /etc/tankapp/env

sudo tee /etc/systemd/system/tankapp-uploader.service > /dev/null <<'UNIT'
[Unit]
Description=TankApp M1 InfluxDB-Uploader
After=network-online.target time-sync.target
Wants=network-online.target
[Service]
Type=notify
User=pi
WorkingDirectory=/home/pi/TankApp
EnvironmentFile=/etc/tankapp/env
ExecStart=/usr/bin/python3 /home/pi/TankApp/data-tools/upload_influx.py
Restart=always
RestartSec=10
WatchdogSec=30
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now tankapp-uploader
```

Type=notify: READY=1, WATCHDOG=1 alle 10s. NAS-Ausfall ist kein Fehlerzustand.

### Betrieb & Kontrolle

```bash
systemctl status tankapp-collector
journalctl -u tankapp-collector -f
ls -la /dev/shm/tankapp/
tail -f /dev/shm/tankapp/$(date +%F).jsonl
cat /dev/shm/tankapp/meta/heartbeat.json
cat /dev/shm/tankapp/meta/synced_until

systemctl status tankapp-uploader
journalctl -u tankapp-uploader -f

# Datenvolumen NAS (UUID-getaggte Statuspunkte):
docker exec <influx-container> influx query \
  'from(bucket: "tankapp") |> range(start: -24h)
    |> filter(fn: (r) => r._measurement == "prices" and r._field == "status")
    |> filter(fn: (r) => exists r.station_id)
    |> group(columns: ["city", "station_id", "station"]) |> count()'

# Collector Herzschlag prüfen:
docker exec <influx-container> influx query \
  'from(bucket: "tankapp") |> range(start: -7d)
    |> filter(fn: (r) => r._measurement == "collector_status")
    |> sort(columns: ["_time"], desc: true) |> limit(n: 5)'
```

### Heartbeat B3.11

Collector schreibt `meta/heartbeat.json` nach jedem Poll (tmpfs-Nutzung, älteste Datei, poll_count). Uploader liest alle 60s und schreibt `collector_status` nach InfluxDB. NAS zeigt in `/api/v1/collector/status` (System-Tab) und `/api/v1/health` (nur lokale Quellen, ohne Influx-Query).

- Frisch = ≤15 Min.
- `dry-run` zeigt Heartbeat-Zeile
- Auch ohne Preis-Zeilen wird Heartbeat übertragen
- **Ohne InfluxDB:** Collector POSTet den Herzschlag direkt ans NAS (`TANKAPP_NAS_URL` oder `TANKAPP_NAS_HEARTBEAT_URL` setzen, Base-URL oder `…/api/v1/collector/heartbeat`). Das NAS legt ihn unter `runtime/collector/heartbeat.json` ab und `GET /api/v1/collector/status` wertet es als Fallback-Quelle `source: "nas"` aus. Siehe [API.md → Collector Heartbeat (POST)](API.md#collector-heartbeat-post-b311).

## NAS: InfluxDB

### Bestehende Instanz nutzen

Wenn InfluxDB bereits läuft (z. B. `smarthome` Bucket vorhanden), **keine zweite Instanz**, nur eigenes Bucket + Token:

```bash
docker ps | grep -i influx
docker exec Influxdb influx config set-token <ADMIN-TOKEN>
docker exec Influxdb influx bucket create --org gtwrlab --name tankapp --retention 43800h
docker exec Influxdb influx auth create --org gtwrlab --read-bucket tankapp --write-bucket tankapp --description "tankapp-uploader (Pi)"
docker exec Influxdb influx bucket list --org gtwrlab
docker exec Influxdb influx auth list --org gtwrlab
```

Token gehört auf Pi nach `/etc/tankapp/env`, nie ins Repo. Alternativ per Web-UI: Load Data → Buckets → Create, Security → API Tokens → Custom (Read+Write points).

### Neue Instanz per Docker

```bash
git clone https://github.com/kollb/TankApp.git ~/TankApp
cd ~/TankApp/ops/nas/influxdb
cp .env.example .env && nano .env  # Token: openssl rand -hex 16
docker compose up -d
docker compose exec influxdb influx ping
```

Port 8086 nur lokales Netz, nie ins Internet.

### Secrets auf Pi

Siehe oben `/etc/tankapp/env`.

## NAS: App-Dienst nas-up

### Vorab preflight

```bash
bash ops/nas/preflight.sh
```

Prüft polling.json, influx.env (4 Keys, nicht localhost), netrc, Python Version, glibc.

### Start

Auf NAS im Checkout:

```bash
python3 tankapp.py nas-up
# Browser: http://<NAS>:1355
```

Benötigt:

1. Aktives `data/analysis/stations/polling.json` vom Pi nach Aktivierung
2. `data/influx.env` mit Lesezugang (Nur-Lese-Token, URL = NAS-LAN-Adresse:8086, nicht localhost)
3. Archivzugang privat als `data/_netrc` oder `~/.netrc` (nicht Collector-Key). Ohne ihn startet Live-GUI trotzdem, aber keine Modelle.

Optional, für die Ereignis-Pipeline (Uploader-Webhook, siehe `docs/ARCHITEKTUR.md`):
`TANKAPP_WEBHOOK_TOKEN=<Secret>` exportieren, bevor `nas-up` das Compose-Projekt
baut/aktualisiert; denselben Wert auf dem Pi als `TANKAPP_NAS_WEBHOOK_TOKEN`
hinterlegen. Ohne Token bleibt der Trigger-Endpoint deaktiviert und die Jobs
laufen rein intervallbasiert weiter.

Optional, für Alarme auf dem Handy (B4): `TANKAPP_NTFY_URL=<URL inklusive Topic>`
exportieren — siehe [Alarm-Zustellung über ntfy](#alarm-zustellung-über-ntfy-b4).
Ohne die Variable werden keine Nachrichten verschickt.

Mit anderen Pfaden:

```bash
python3 tankapp.py nas-up --archive-dir /srv/tankapp/archive --runtime-dir /srv/tankapp/runtime --polling /privater/pfad/polling.json --influx-env /privater/pfad/influx.env --netrc /privater/pfad/netrc
```

Ohne Optionen: Archiv `data/raw`, Runtime `data/runtime` im Checkout, nicht im Container.

Start und Updates bleiben derselbe Befehl, merkt sich Pfade in `data/nas-settings.json`, baut Image neu. Nach Austausch privater Dateien wiederholen (read-only bind mount).

Nur Heimnetz/VPN, keine Portfreigabe ins Internet, TLS via NAS Reverse Proxy.

### Unraid Ablauf

1. Compose-Plugin installieren (z. B. Compose Manager Plus)
2. Repo nach `/mnt/user/appdata/tankapp` klonen (SSD-Share)
3. Grundsatz: große Dateien HDD, kleine/häufige SSD:

| Pfad | Pool | Inhalt |
|---|---|---|
| `/mnt/user/appdata/tankapp` | SSD | Code + private Konfiguration + Runtime (`data/runtime`: Jobs, Modelle, Selektion, Archiv-Sync-Status) |
| `/mnt/user/data/tankapp` | HDD | nur Roharchiv (nationale Tagesdateien, mehrere GB) |

Archivverzeichnis legt `nas-up` an und übergibt an Container-User (99:100). Selbst vorangelegte Verzeichnisse müssen `chown -R 99:100` gehören.

```bash
chown 99:100 data/influx.env data/_netrc && chmod 600 data/influx.env data/_netrc
cd /mnt/user/appdata/tankapp
python3 tankapp.py nas-up --uid 99 --gid 100 --archive-dir /mnt/user/data/tankapp
```

Nur `--archive-dir`, kein `--runtime-dir`: Runtime bleibt auf SSD, HDD nur Roharchiv.

4. Browser: `http://<NAS>:1355`

- Autostart: `restart: unless-stopped`
- Kein sudo nötig auf Unraid
- Docker-Verzeichnis bei kleinem Flash-Stick verlegen: Settings → Docker → Docker Directory → `/mnt/user/docker`
- InfluxDB bleibt unverändert, nur eigenes Bucket
- Unraid Web-UI Port 80 unberührt

### Portwechsel

`nas-up` merkt sich Port in `data/nas-settings.json`. Wer alten Port 8080 hatte: `python3 tankapp.py nas-up --port 1355`

### Was automatisch läuft

| Aufgabe | Zeitplanung |
|---|---|
| GUI + Nur-Lese-API | Preise alle 30s neu lesen, Anzeige ≤30 Min alter offener Preise, kein extra Tankerkönig-Request |
| Archiv | Bei Start, danach stündlich, bis gestern, Lücken nachholen, vollständig → überspringen ohne HDD Wake |
| Modelle | Bei Start, danach täglich, bei Fehler stündlich, unabhängig vom Archiv |
| Selektion | Bei Start, danach täglich, nach Modell best-effort, publiziert nach `runtime/selection/current.json` |
| Settlement | Bei Start, danach alle 30 min: rechnet Advice-Snapshots nach Fensterende + 30 min Lag gegen *beobachtete* Preise ab (`runtime/feedback/store.json`), setzt fällige Episoden auf `due` |
| Alarm-Zustellung (B4) | Alle 5 min `severity: error`-Alarme prüfen, nur Zustandswechsel senden; zusätzlich Fenster-Meldungen je Episode (O29, Ruhezeit 22–7 Uhr) — nur mit `TANKAPP_NTFY_URL` → [ntfy](#alarm-zustellung-über-ntfy-b4) |
| Veröffentlichung | Erst nach fertiger Berechnung atomar ersetzen, alte Ergebnisse bei Fehlern behalten |
| Neustart | Docker restart unless-stopped, startet mit Docker, holt nach |

Keinen zusätzlichen cron einrichten, gebündelter Dienst übernimmt Zeitplanung. Bereits eingerichtete history-sync/model cron deaktivieren. history-sync bleibt als Einzelwerkzeug.

Archivumfang Standard 365 Tage, für 730: `--history-days 730`. Genug Speicher (nationale Tagesdateien). Modelle verwenden kleineren Ausschnitt (42 Tage Training, 120 Tage Export).

Modellumfang: zunächst e10, bei Bedarf `--model-fuels e10,e5,diesel`.

### GUI-Responsivität: Straßen-Distanzen ohne Netz-Blockade (seit 0.24.0)

Die km-Angaben der Stationen (und die Umweg-Ökonomie in „Rechnet sich
der Umweg?“) nutzen OSRM-Straßen-Routing. Seit 0.24.0 macht der
Request-Pfad **kein** Netzwerk dafür: Der Server liest nur den lokalen
Routen-Cache (`runtime/road_route_cache.json`); unbekannte
Anker→Station-Paare zeigen vorübergehend die Luftlinie
(`dist_mode: "air"`), und die fehlenden Routen holt ein
Hintergrund-Thread (Debounce je Anker, hartes Wanduhr-Budget 20 s,
5-min-Cooldown bei Fehlschlag). Der nächste Request nutzt die neuen
Einträge automatisch (Datei-mtime entwerten das Metadata-Memo).

Davor lief je Request je Anker eine Live-Anfrage an den OSRM-Server —
bei wackeligem Internet/DNS am NAS hängen solche Calls (die
DNS-Auflösung kennt keinen Socket-Timeout) und ketteten die gesamte API:
gemessen `/health` 54 s, `/stations` 67 s. Jetzt antworten alle
Endpunkte (auch der Docker-Healthcheck-`/health`) in Millisekunden,
unabhängig von der Internetlage.

Gleiches Muster für die **Preise**: Im Steady-State antwortet
`/stations` sofort aus dem Cache, der InfluxDB-Read (2-Tage-Fenster)
läuft im Hintergrund (Single-Flight je Kraftstoff, 30-s-Intervalt wie
vorher); der Server warmt alle drei Kraftstoffe beim Start im
Hintergrund vor. Die Antwortzeit hängt damit auch nicht mehr an der
InfluxDB-Latenz der NAS-HDD.

Knöpfe (beide via Aufrufumgebung an `python3 tankapp.py nas-up`):

- `TANKAPP_OSRM=1` (Default): Straßen-Distanzen via OSRM. `0` =
  keinerlei Netz, immer Luftlinie.
- `TANKAPP_OSRM_URL`: eigener OSRM-Server. **Empfohlen**: NAS-Docker,
  LAN-only, kein Drittanbieter-Demo-Server (der Default
  `router.project-osrm.org` bekommt sonst die Anker-Koordinaten):

  ```
  docker run -d --name osrm --restart unless-stopped -p 5000:5000 \
    -v /pfad/zu/germany-latest.osrm:/data/germany-latest.osrm \
    osrm/osrm-backend osrm-routed --algorithm mld /data/germany-latest.osrm
  # danach einmal:
  TANKAPP_OSRM_URL=http://<NAS-Adresse>:5000 python3 tankapp.py nas-up
  ```

Nach dem ersten erfolgreichen Fetch sind die Distanzen „road“ und
bleiben gecacht; bleibt das Netz aus, bleibt es ehrlich „air“ — nie
erfundene Werte.

### Modell-Lauf beobachten

„Läuft …“ ohne Fortschritt ist die häufigste Frage beim ersten Modell-Lauf.
Vier Stellen, an denen derselbe Fortschritt steht (B5/B6):

1. **GUI → System-Tab**: Job-Karte zeigt Phase (`InfluxDB-Export`,
   `Archiv aufbereiten`, `Modelle fitten + Backtest`, `Selektion (δ̂)`,
   `Veröffentlichen`), Schritt `x/y`, aktuelles Label (Station), Balken,
   Laufzeit und Restschätzung. Während eines Laufs wird `/api/v1/health`
   alle 15 s statt 60 s gepollt.
2. **Statusdatei** (Maschine): `data/runtime/jobs/models.progress.json` —
   Phase, Schritt, Prozent, `eta_s`. Sie existiert nur während eines Laufs.
3. **Log**: als Dateien unter `data/runtime/` — `jobs/models.log`
   (Fortschritt, letzte 500 Zeilen, auch ohne Docker-Zugriff lesbar) und
   `logs/models.log` (voller Worker-stdout). `docker logs` zeigt **keine**
   Job-Fortschrittzeilen: der Worker läuft als Subprozess, dessen stdout
   nach `runtime/logs/<job>.log` geht (Befund 13.09.2026).
4. **Log im GUI/per API** (B6): System-Tab → „Job-Log“ (Umschalter
   Archiv-Sync / Modell-Update / Selektion / Beleg-Verarbeitung, 100–500
   Zeilen, alle 15 s neu, solange ein Job läuft) bzw.
   `GET /api/v1/jobs/<job>/log?lines=200`. Der Sprung direkt dorthin geht
   über das Log-Symbol in der jeweiligen Job-Karte.

```bash
# Fortschritt live
tail -f data/runtime/jobs/models.log
# voller Worker-Output (Tracebacks, Zwischenergebnisse)
tail -f data/runtime/logs/models.log
# Status auf einen Blick
cat data/runtime/jobs/models.progress.json
# Log per API (ohne Terminal auf dem NAS)
curl -s "http://<nas>:1355/api/v1/jobs/models/log?lines=200" | jq -r '.lines[]'
```

Typische Dauer nach der Beschleunigung (B5): **~14 s je Station** statt
rund 3 Minuten; 10 Stationen auf 4 Kernen damit unter einer Minute.

### 12-Uhr-Bodenkante beobachten (B30, seit 0.51.0)

Beobachtungs-Panels (Heatmap), Selektion und Kalibrierung zählen nur
Beobachtungen **ab** `price_law_local` — dem Zeitpunkt, seit dem die
12-Uhr-Regel gilt. Der Lauf schreibt den Anteil Vorsgesetzliches in den
Publikations-Index, damit das nicht behauptet, sondern gelesen wird:

```bash
python -c "import json; d=json.load(open('runtime/engine/current.json'));\
print(json.dumps(d.get('law_quality'), indent=2, ensure_ascii=False))"
```

`law_quality` nennt `law_floor` (UTC), `points_total`, `points_before_law`,
`gapfill_events_before_law` (wie viel Vorsgesetzliches die Archiv-Auffüllung
nachgezogen hat) und `by_fuel`. Erwartung im Dauerbetrieb: beide Zähler **0** —
die Fenster beginnen heute hinter dem Gesetz. Steigt `points_before_law`, ist
entweder `price_law_local` verschoben (Rechtswechsel) oder der Nachzug holt
alte Tage herein; beides ist dann sichtbar statt still. Dasselbe Feld steht im
Fehler-Fall in `runtime/engine/last-attempt.json`.

| Variable | Wirkung |
|---|---|
| `TANKAPP_PRICE_LAW_LOCAL` | Kante als lokaler Zeitpunkt, z. B. `2026-04-01T12:00` (Default aus `engine/config.py`). Bei Gesetzeswechsel hier ändern — kein Code-Fassen. |
| `TANKAPP_LAW_FLOOR` | `0`/`false`/`off`/`no` schaltet die Bodenkante ab: Heatmap, Selektion und Fit mischen dann bewusst Vor- und Nach-Gesetz-Daten. Nur für Gegenmessungen; die GUI sagt, dass gemischt ist. |

### Regime-Kalender (B0, seit 0.56.0)

Ein Regime-Wechsel ist ein datierter Eingriff ins Preisniveau — der Tankrabatt
ab 01.10.2026 (−17 ct/L), sein Ende zum 01.01.2027, im Archiv der Mai-Juni-
Rabatt 2026 ([Befund Teil 5](BEFUND-UX-MATH-2026-09-19.md#teil-5-regime-wechsel--tankrabatt-und-spritpreisdeckel)).
Seit 0.56.0 kennt der Modell-Lauf diese Termine als **Kalender**, der wie
`price_law_local` durchgereicht wird (`Settings.regimes` →
`engine.config.Config.regimes`). **Gerechnet wird damit noch nichts:** Fit und
Prognose sind bitgleich zu 0.55.2; der Backtest zählt die Kanten im Fenster
(`regime_breaks_in_window`) und markiert jede Zeile und jeden Fold, deren
Fenster eine Kante überspannt (`regime_break_spanned`). Kennzahlen über eine
Kante sind als Modellgüte nicht lesbar — sie werden ausgewiesen, nicht
ausgeschlossen (`metrics_break_free` zeigt den Rest). Details:
[ENGINE.md](ENGINE.md#messgrundlagen-b0-seit-0560).

| Variable | Wirkung |
|---|---|
| `TANKAPP_REGIMES` | **leer/nicht gesetzt:** die vier bekannten Termine aus `app/regimes.py::DEFAULT_REGIMES` (01.05.2026 −17, 01.07.2026 +17, 01.10.2026 −17 angekündigt, 01.01.2027 +17 angekündigt; alle Sorten). **`0`/`off`/`none`:** kein Kalender (Gegenmessung ohne Marker). **JSON-Liste** `[{"announced_local": "2026-10-01T00:00", "kind": "tax_step", "fuel": null, "announced_value": -17.0, "status": "announced", "source": "…"}]` oder **Pfad einer `.json`-Datei** mit einer solchen Liste: genau diese Einträge — die nächste Maßnahme ist ein Eintrag, kein Code-Fassen. Ein bloßer ISO-String je Eintrag ist die Kurzform (`tax_step`, alle Sorten). |

Erlaubte Werte: `kind` ∈ `tax_step`/`price_cap`, `fuel` ∈ `E5`/`E10`/`DIESEL`
oder `null` (alle), `status` ∈ `announced`/`detected`/`in_force`/`unknown`,
`announced_value` in ct/L brutto mit Vorzeichen (Richtung der Kante) oder
`null`. Unbekannte Felder, unbekannte Sorten und mehrdeutige Wanduhrzeiten
(Zeitumstellung) werden **abgelehnt**: Ein kaputter Kalender bricht den
Modell-Lauf mit Grund ab (`Settings.from_env` → `ValueError`), statt ohne
Marker weiterzulaufen — genau das unmarkierte Übergangsfenster ist der
Fehler, vor dem Befund §5.7 warnt. Bis zum 01.10.2026 liegt keine Kante im
21-Tage-Backtest-Fenster: `regime_breaks_in_window.count` ist 0 und keine
Kennzahl ändert sich. Der Spritpreisdeckel ist **kein** eigener Eintrag,
solange seine Ausgestaltung offen ist (A15) — bekannt ist nur das
Rabatt-Ende.

Kontrolle nach dem Lauf: je Station steht `regime_breaks_in_window` in der
Veröffentlichung (`runtime/engine/forecasts/*.json`, [API.md](API.md#forecast-messfelder-b0-seit-0560)),
dazu `ar_shrink_events`, `pit` und `pava_pool_stats`.

### Größe der Veröffentlichung (O22, seit 0.44.0)

Die Prognosen-Veröffentlichung unter `data/runtime/engine/` ist das, was der
Modell-Lauf für die GUI schreibt; die App liest ausschließlich dort. Seit
0.49.0 ist sie **aufgeteilt** (O22 Maßnahme d): `current.json` ist ein kleiner
Index mit Zeigern (`layout: "split-forecast-files"`), und jede
Stations-Prognose liegt in einer eigenen Datei unter `forecasts/`
(`<uuid>.<kraftstoff>.json`). `app/data.py::publication()` fügt Index und
Stations-Dateien zur gewohnten Form zusammen — die Endpunkte liefern dieselbe
Struktur wie vorher. Der Grund für die Aufteilung: Mit der zweiten Stadt wuchs
die Monolith-Datei auf 13,5 MB und fiel über das Leselimit, obwohl kompakt
geschrieben und gerundet — die App zeigte „keine Prognose“, während der Job
Erfolg meldete. Die Klippe ist eine Eigenschaft der *einzelnen* Datei; die
Aufteilung entfernt sie. Der Index ist der Commit-Zeiger: Der Lauf schreibt
erst die Stations-Dateien, dann den Index; verwaiste Stations-Dateien werden
best-effort abgeräumt. Die Größe meldet der Lauf im Job-Log
(`models: Veröffentlichung 13,5 MB gesamt: 20 Stations-Dateien plus Index,
größte Datei 0,7 MB (Leselimit 10,0 MB je Datei).`).

Zwei Grenzen, beide in `app/data.py` — sie gelten seit der Aufteilung der
**einzelnen Datei**, nicht der Summe:

| Grenze | Wert | Wirkung |
|---|---|---|
| `PUBLICATION_BUDGET_BYTES` | 6 MB | Warnung `publication_large`, wenn eine Datei darüber liegt (heute praktisch unerreichbar: eine Stations-Datei ist ~0,7 MB) |
| `READ_JSON_MAX_BYTES` | 10 MB | `read_json` **verweigert** das Lesen (Speicherschutz): Fehler `publication_unreadable` mit `reason: "too_large"`; eine fehlende Stations-Datei meldet `reason: "incomplete"` (die übrigen Prognosen bleiben verfügbar) |

```bash
# Größe der Veröffentlichung gesamt und je Datei (ohne Parse)
du -sh data/runtime/engine/current.json data/runtime/engine/forecasts
du -h data/runtime/engine/forecasts/*.json | sort -h | tail -3
# Lesbarkeit + Kernfelder: der Index muss parsebar sein und .failures enthalten
jq -e .failures data/runtime/engine/current.json > /dev/null && echo ok
# Zeiger zählen und prüfen, dass jede Stations-Datei existiert
jq -r '.forecasts[].file' data/runtime/engine/current.json | while read -r f; do test -f "data/runtime/engine/$f" || echo "fehlt: $f"; done
# Größe + Alarm-Lage aus dem Betrieb heraus (ohne Terminal auf dem NAS)
curl -s "http://<nas>:1355/api/v1/health" | jq '.publication, (.alarms[] | select(.code | startswith("publication")))'
```

Größe wächst weiter mit Stationen × Kraftstoffen — jetzt aber als Summe
vieler kleiner Dateien, ohne Klippe. Wer aufräumen will: **weniger
Kraftstoffe/Stationen** im Polling-Set (`data/analysis/stations/polling.json`
→ [STATIONEN-TAUSCH.md](STATIONEN-TAUSCH.md)) oder **weniger
`bootstrap_samples`** (`nas_up.ini`, Modell-Lauf wird dadurch langsamer und
die Intervalle ungenauer). Die Grenzen selbst hochzusetzen ist **keine**
Lösung: `READ_JSON_MAX_BYTES` schützt den Container-Speicher vor einer
einzelnen JSON-Datei.

### Wann erscheinen die Anker-Zeilen im Scoreboard?

Das Scoreboard („Entscheidungs-Scoreboard · Out-of-Sample“) und die
Regel-Ergebnis-Kachel füllen sich erst, wenn zwei Dinge zusammenkommen:

1. **Der Modell-Job ist einmal erfolgreich durchgelaufen** (siehe oben:
   Phase „Modelle fitten + Backtest“).
2. **Es liegt genug echte Preishistorie vor.** Der Backtest bewertet tägliche
   Anker-Entscheidungen (Tages-Anker, Standard 12:00, `TANKAPP_DECISION_HOUR`)
   rollierend über die letzten 7 Tage je Station. Ist
   eine Station erst seit wenigen Tagen im Polling-Set, liefert sie noch keine
   auswertbaren Entscheidungszeilen — das ist Ehrlichkeit (§14), kein Fehler.

Solange beides nicht erfüllt ist, zeigt die GUI ausdrücklich „Noch keine
Tages-Entscheidungen“ statt erfundener Zahlen. Ein einzelner verpasster Tag
(Polling-Ausfall) kostet dabei nur diesen einen Eval-Tag; das Nachholen des
Archivs beschreibt „Preislücke nachholen“ weiter oben.

### Lauf manuell anstoßen

Drei Wege, alle ohne Neustart des Dienstes:

**1. Knopf im GUI** (System-Tab, grünes ▶ in der Job-Karte) — der
direkteste Weg. Ohne Passwort, weil er nur im NAS-Webauftritt wirkt und nur,
wenn der Dienst Jobs fährt. Der Scheduler antwortet ehrlich: „Gestartet“,
„Läuft bereits“ oder „Gerade erst gelaufen — in 37 s erneut möglich“.
Abschalten (z. B. wenn die GUI aus dem Internet erreichbar ist):
`TANKAPP_GUI_JOB_START=0` in `ops/nas/app/compose.yml` (Umgebung des
App-Dienstes), danach `python3 tankapp.py nas-up`. Wege 2 und 3 bleiben.

**2 und 3. Kommandozeile** — für Scripts, SSH und den Pi:

```bash
# a) Webhook — nur für models und selection. Der Scheduler entscheidet über
#    Debounce (models 15 min, selection 60 min) und Idempotenz.
curl -fsS -X POST http://<nas>:1355/api/v1/jobs/trigger \
  -H "Authorization: Bearer $TANKAPP_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"job":"models"}'
# Antwort {"status":"queued","job":"models"} heißt geweckt, nicht gelaufen:
# Der Scheduler prüft Debounce und Datenstand selbst (docs/API.md).

# b) Direkt im Container — startet sofort und umgeht Debounce/Idempotenz.
docker exec tankapp-app python3 -m app.worker models
# Exit-Code 0 = Erfolg, 2 = fehlgeschlagen (wie vom Scheduler gewertet).
```

Ohne konfiguriertes `TANKAPP_WEBHOOK_TOKEN` oder ohne Job-Betrieb
(`tankapp.py nas-up --jobs`) existiert der Webhook-Endpunkt nicht (404).
Weg 3 schreibt Status und Log genau wie ein planmäßiger Lauf und ist damit
auch die beste Probe, wenn ein Lauf nachts fehlgeschlagen ist.

### Fehlgeschlagener Lauf: Ursache statt Raten

Steht auf einer Job-Karte „Fehlgeschlagen“ (bzw. `state: failed` in
`runtime/jobs/<job>.json`), nennt dieselbe Karte die **Ursache** in einem
Satz — z. B. `ValueError: zu wenig Historie für current.json`. Der Text wird
vor dem Rausgeben bereinigt (`app/errors.py`): Pfade bleiben nur als
Dateiname, Token, Passwörter und lange Schlüssel-Blobs verschwinden.
Derselbe Satz steht an vier Stellen:

| Wo | Fundstelle |
|---|---|
| GUI | System-Tab → Job-Karte, Zeile „Ursache:“ |
| API | `GET /api/v1/health` → `jobs.<job>.error_detail` |
| Statusdatei | `data/runtime/jobs/<job>.json` → `error_detail` |
| Log | `data/runtime/jobs/<job>.log`, Zeile „Fehler: …“ (auch im GUI-Logpanel) |

Häufige Ursachen: zu wenig/lückenhaftes Archiv (`insufficient_history`,
`archive_incomplete`), fehlende Rechenpakete (`dependencies_missing`, im
NAS-Image nicht zu erwarten), fehlende Konfiguration (`waiting`, keine
Störung) — sonst `job_failed` mit der bereinigten Ausnahme.

**Zwei Sonderzustände (0.21.0):** „Abgebrochen“ (`state: aborted`) statt eines
ewigen „Läuft …“ — hart beendete Läufe (Container-Recreate, SIGTERM) werden
als Abbruch verbucht und im Log als „abgebrochen in Phase …“ erklärt; die
letzte gute Publikation bleibt unangetastet. „Unvollständig“ (`state: partial`)
löst keinen Stundentakt mehr aus: strukturelle Ursachen wie
`some_models_unavailable` oder `insufficient_history` verschieben den nächsten
Versuch auf das reguläre Intervall des Jobs (`models`: 1×/Tag), damit keine 24
erfolglosen Läufe pro Tag anfallen.

### Modell-Lauf beschleunigen

Zwei Stellschrauben, beide ohne Änderung der Ergebnisse:

| Hebel | Wirkung |
|---|---|
| `TANKAPP_MODEL_WORKERS` | Prozesse für Fit/Prognose/Backtest. `0` (Default) = automatisch, maximal 8 und begrenzt durch Prozess-Affinität sowie Docker-/cgroup-CPU-Quota; `1` = seriell. Ein positiver Wert ist eine bewusste Betreiber-Vorgabe (max. 64). Stationen und Horizonte sind unabhängig. Ohne nutzbaren Prozess-Pool rechnet die App automatisch seriell weiter. |
| `TANKAPP_CITY_SUBDIVS` | Bundesländer für den gepoolten Feiertags-Dummy, z. B. `Frankfurt:HE;Gütersloh:NW`. Ohne Wert bleibt der Dummy bewusst null. `nas-up` reicht den Wert über Compose in den App-Container durch. |
| Tages-Cache des Backtests (B17, 0.22.0) | Der 21-Tage-Backtest hängt nur vom lokalen Endtag und den Daten davor ab; `runtime/engine/backtest-cache/` hält je Station eine JSON-Datei mit Fingerabdruck (Config + Inhalts-Hash der ganzen Reihe bis Endtag + Bibliotheksversionen). Zweiter Lauf am selben Tag: Backtest aus dem Cache, Log „Backtest: n aus Tages-Cache, m neu gerechnet“; jede Änderung in der Vergangenheit (Archiv, Lückenfüllung) rechnet neu. Jede Prognose trägt `backtest_cached` und `backtest_computed_at`. `TANKAPP_BACKTEST_CACHE=0` schaltet ihn aus; das Verzeichnis darf jederzeit gelöscht werden (nächster Lauf rechnet). |
| Engine-Fix der 12-Uhr-Projektion | Vor B5 baute die Projektion je Rasterpunkt ein `pd.Timestamp` (≈8 Mio. Boxing-Operationen pro 7-Tage-Prognose). Jetzt vektorisiert: 24-h-Prognose 12,4 s → 0,8 s, 7-Tage 82 s → 4,9 s, Backtest 44 s → 6,4 s — **bitgleich** zu vorher (geprüft gegen die alte Implementierung). |

**Seit 0.26.0 (Laufzeit-Batch 4):** Je Kraftstoff bleibt ein Prozess-Pool über
24-h-Fit, Mehrtage-Horizonte und Backtest stehen; vorher wurden zwei Pools
aufgebaut. Der eigenständige Modell-Worker ist single-threaded, deshalb nutzt
der Pool auf dem Linux-NAS explizit `fork` statt des Python-3.14-Defaults
`forkserver`. An die Worker gehen nur sechs fachlich gelesene Rasterspalten
statt aller neun. Die Automatik bestimmt CPUs über `os.process_cpu_count()`
(bzw. Affinität auf Python 3.11/3.12) und `cpu.max`/cgroup-v1-Quota — **nicht**
über `nproc`, das wegen `OMP_NUM_THREADS=1` irreführend 1 meldet.

Der Backtest-Cache hat deshalb Schema 2: Sein Fingerabdruck umfasst Index,
Preis, Beobachtungs-/Antwortmasken, Status-Herkunft, Quelle und
Beobachtungszeit, also genau alle von Fit und Backtest gelesenen Eingaben.
Alte Schema-1-Dateien werden nach dem Update einmal verfehlt (erster Lauf
kalt), danach greifen Treffer wie bisher.

```bash
# NAS: vier Prozesse und die Bundesländer der Städte explizit setzen
TANKAPP_MODEL_WORKERS=4 \
TANKAPP_CITY_SUBDIVS="Frankfurt:HE;Gütersloh:NW" \
python3 tankapp.py nas-up
```

Archiv und Polling sind dieselben Marktdaten über zwei Bezugswege. Historie kann Modellstart tragen, keine 3-Monats-Wartepflicht. Standardtraining letzte 42 Tage, Archiv nur vor Live-Beginn. Nach 90 vollständigen Live-Tagen mit 95% Abdeckung je UUID/Kraftstoff auf Polling-only umstellbar. NAS-Roharchiv bleibt bestehen.

### Ressourcen während Phase B messen (B11)

**Erledigt in 0.26.1.** `TANKAPP_MODEL_WORKERS` startet 4 Worker × pandas,
`ops/nas/app/compose.yml` setzt `shm_size: 256m`, der Host hat 4,2 Gi
verfügbar — der Abgleich auf der Zielhardware (NAS `Tower`, Container
`tankapp-web-app-1`) sagt: **passt, keine Änderung.**

**Strenger Kaltlauf 13.09.2026** (Stand 0.25.1, vor Batch 4;
`ops/nas/b11-cold-run.sh`, 25 Stichproben à 5 s, 17:36:21–17:39:16 local).
Cache vorher gelöscht und verifiziert (Mount
`/mnt/user/appdata/TankApp/data/runtime`). Job-Log: „Backtest: 0 aus
Tages-Cache, 19 neu gerechnet“. 20 Stationen, e10, Dauer **2,6 min**,
Endzustand `partial (some_models_unavailable)`.

| Größe | Wert | Folge |
|---|---|---|
| Python-Prozesse | max **2** gezählt | Sammler matchte `cmdline` gegen `python*` — Forkserver-Kinder (`/usr/local/bin/python…`) fielen durch. Gegenprobe: CPUS 381 % ≈ 4 Worker. Der Sammler zählt seit 0.26.1 cmdline **und** `/proc/pid/comm`. Seit 0.26.0 ist die Startmethode `fork`, Forkserver entfällt. |
| Container-Speicher | max **1031 MiB (1,0 GiB)**, MEM % 6,6 | Peak am Ende von Phase B; Leerlauf ~110 MiB |
| Host verfügbar | min **4212 MiB (4,1 GiB)**, Swap 0 | Weit über ~500 MiB |
| CPUS | max **381 %** (Phase B 248–381 %) | Pool mit ~4 Workern |
| `/dev/shm` | max **1 MiB** / 256 MiB | `shm_size: 256m` bleibt |

Ein früherer Lauf desselben Tags (14:26–14:29, 1029 MiB / 370 %) war **kein**
Kaltlauf („9 aus Tages-Cache, 10 neu gerechnet“, 2,1 min) — am Peak ändert das
nichts. Zahlen: [TODO.md](../TODO.md#b11-kaltlauf-13092026). Die
**Nachher-Dauer von 0.26.0** (ein Pool, `fork`, Cache-Schema 2) ist eine
eigene Messung nach dem Deploy — sie hält B11 nicht offen. Leerlaufwerte
aus `docker stats` (220–280 MiB, 7–10 PIDs) bleiben ungeeignet: Sie entstehen,
bevor der Prozess-Pool steht.

Gemessen wird **während Phase B** — der Phase „Modelle fitten + Backtest“, im
Job-Log an den Zeilen `Modelle fitten + Backtest n/m` zu erkennen. Zwei
Stellen, an denen das Protokoll beim ersten Messlauf (13.09.2026)
scheiterte und jetzt korrigiert ist: `ps` fehlt im Image
(`python:3.14-slim`), und ohne `ps` liefert auch `docker top` keine
Ausgabe — die Prozessliste kommt über einen `/proc`-Scan per `docker exec`
(macht der Sammler selbst). Und Fortschrittszeilen stehen **nie** auf
Container-stdout: der Scheduler startet den Worker als Subprozess, dessen
stdout nach `runtime/logs/models.log` geht, der Progress schreibt nach
`runtime/jobs/models.log` — die Phase also immer aus dem Job-Log auf dem
Host ablesen (`docker logs` zeigt beides nicht).

**Welches Fenster? Warm und kalt sind seit B17 (0.22.0) zweierlei.** Der
Tages-Cache des Backtests gilt für den ganzen lokalen Tag: sein Fingerabdruck
enthält den letzten vollständigen Tag (`end_local`, siehe
`app/model_jobs.py::_backtest` und `app/backtest_cache.py::fingerprint`) — die
Reihe wird dort hart abgeschnitten, untertägige Polls ändern ihn nicht.
Seit 0.26.0 verwirft Cache-Schema 2 alte Schema-1-Dateien einmalig — der
erste Lauf nach dem Update ist automatisch kalt.

| Lauf | Backtest | Phase B | Wann |
|---|---|---|---|
| **Kalt** | 21-Tage-Backtest je Station neu | **~2,6 min** Gesamt (13.09.2026 nach B15/B16, Stand 0.25.1; vor den Hebeln 9,4 min am 12.09.) | erster Lauf des lokalen Tages, oder erster Lauf nach Schema-Sprung |
| **Warm** | „n aus Tages-Cache, m neu gerechnet“ | ~40 s (13.09.2026: 11:22:28 → 11:23:07; Warm-Gesamt 1,4–1,7 min) | jeder weitere Lauf am selben Tag |

Weil `models` nach B18 (0.21.0) nur 1×/Tag läuft
(`INTERVALS["models"] = 86400`), ist **jeder Planlauf ein Kaltlauf** — warm
werden nur zusätzliche Läufe am selben Tag (ein Container-Recreate startet
sofort, s. u.). Wiederholungsmessung im **Kaltlauf**: längeres Fenster und
zugleich der Speicher-Worst-Case. Kalt erzwingen — im Container liegt das
Datenverzeichnis unter `/data`, auf dem Host dort, wohin `tankapp.py nas-up`
es gemappt hat:

```bash
# einmalig: Cache leeren (darf jederzeit gelöscht werden)
docker exec tankapp-web-app-1 sh -c 'rm -rf /data/runtime/engine/backtest-cache'
# oder dauerhaft: TANKAPP_BACKTEST_CACHE=0 in ops/nas/app/compose.yml
```

**Nicht von Hand tippen, sondern samplen.** Im Warm-Lauf dauert Phase B nur
~40 s — da kommt der zweite Befehl zu spät. `ops/nas/measure-phase-b.sh`
schreibt alle 5 s eine Zeile und rechnet am Ende selbst zusammen:

```bash
# Aufruf: Container, Intervall, Dauer in Sekunden (0 = bis Strg-C)
ops/nas/measure-phase-b.sh tankapp-web-app-1 5 0
# Sammler starten → Modell-Lauf auslösen → nach „beendet:“ Strg-C
```

Wer es doch von Hand macht (Kaltlauf, ~3 min Fenster — ein Durchgang genügt):

```bash
tail -n 5 data/runtime/jobs/models.log             # Phase B läuft? (nur dort)
docker exec tankapp-web-app-1 sh -c 'n=0; for d in /proc/[0-9]*; do \
  c=$(tr "\0" " " < "$d/cmdline" 2>/dev/null); m=$(cat "$d/comm" 2>/dev/null); \
  case "$c $m" in *python*) n=$((n+1));; esac; done; echo $n'  # Python-Prozesse (kein ps im Image)
docker stats --no-stream tankapp-web-app-1         # MEM USAGE / MEM % / CPUS
docker exec tankapp-web-app-1 df -h /dev/shm       # shm_size: 256m — wie voll?
free -h                                            # Host verfügbar
```

Fünf Zahlen, mehr braucht die Entscheidung nicht:

| Größe | Woher | Entscheidet |
|---|---|---|
| Anzahl Python-Prozesse | `/proc`-Scan per `docker exec` (cmdline **und** `comm`; kein `ps` im Image, `docker top` liefert nichts) | ob der Pool wirklich mit 4 Workern läuft (Gegenprobe zu `TANKAPP_MODEL_WORKERS=1`, B23). Seit 0.26.0 explizites `fork`, also kein zusätzlicher Forkserver |
| `MEM USAGE` des Containers | `docker stats` | ob 4 × pandas in 4,2 Gi verfügbarem Host-Speicher passen |
| `MEM %` + `free -h` verfügbar | `docker stats`, `free -h` | ob Swap/OOM droht (Swap ist 0) |
| `CPUS` | `docker stats` | ob 4 Worker ~400 % erreichen oder sich behindern |
| `/dev/shm` belegt | `df -h /dev/shm` **im Container** | ob 256 MiB reichen — der Speicherwert des Containers beantwortet das nicht |

Erwartet wird **keine** Beschleunigung — B11 ist ein Abgleich, kein Hebel:
Durchsatz kommt aus B15/B16 (0.20.0) und B17 (0.22.0). `shm_size` bleibt
256m.

**Wiederholung in einem Schritt:** `ops/nas/b11-cold-run.sh` (nach
`python3 tankapp.py nas-up` ausführen): wartet auf den sofortigen
Recreate-Lauf, löscht den Cache und **verifiziert** die Löschung (inkl.
Mount-Quellen-Prüfung von `/data/runtime`), sampelt mit dem Sammler,
triggert den Lauf per `docker exec … python -m app.worker models` (umgeht
Debounce) und schreibt alles — Stichproben, Auswertung, Job-Log-Ende,
`models.json` und die Kaltlauf-Prüfung — in eine Datei
`b11-cold-<stempel>/report.txt`. Nach 0.26.0 verfehlt Cache-Schema 2 alte
Dateien ohnehin einmal (im Log müssen 0 Treffer stehen).

**Achtung Messfalle (12.09.2026):** `nproc` meldet im Container `1`, weil das
Image `OMP_NUM_THREADS=1` setzt. Kerne immer über die Affinität bestimmen:

```bash
docker exec tankapp-web-app-1 python -c \
  "import os; print(os.cpu_count(), os.process_cpu_count(), len(os.sched_getaffinity(0)))"
```

Und: `nas-up` niemals während eines Laufs — es ruft `compose up -d --build
--force-recreate` und tötet den Job (B24, zwei Vorfälle am 12.09.2026). Seit
0.21.0 warnt `nas-up` vorher; die Messung ist trotzdem futsch, wenn der Lauf
mitten in Phase B stirbt.

## Zugriff im LAN: was lesbar ist (O39, seit 0.50.0)

Die App hat **kein Login, keine Sitzung und keine Nutzer:innen** — das ist die
Rahmenbedingung des Projekts (Pi ↔ NAS ↔ Browser im eigenen Netz). Bis 0.49.0
war die Folge dieser Entscheidung allerdings nirgends aufgeschrieben: Der
Server bindet `0.0.0.0:1355` (`app/server.py`), und damit konnte **jeder
Rechner im LAN** — ein Gast im Gast-WLAN, ein kompromittiertes Gerät, ein
neugieriger Router-Dienst — den persönlichen Datenbestand lesen:

| Route | Was drinsteht |
|---|---|
| `GET /api/v1/fills` · `/api/v1/fills.csv` | alle Tankvorgänge mit Zeit, Ort, Preis, Menge |
| `GET /api/v1/fills/summary` | Monats-/Jahresbilanz derselben Belege |
| `GET /api/v1/advice/diary` | Prognose-Tagebuch (wann welche Empfehlung galt) |
| `GET /api/v1/profiles` | Fahrzeug-/Haushaltsprofile (Tankmenge, Verbrauch, Zeitwert) |
| `GET /api/v1/episodes` | offene und verstrichene Tankfenster |
| `GET /api/v1/overview` | Alltags-Aggregat — bündelt Belege und Episoden |

Dazu kommt indirekt der Wohnort: Das Polling-Set (`data/analysis/stations/
polling.json`) nennt die Anker-Koordinaten, und die Karte im GUI zeigt sie.

Markt- und Modelldaten (`health`, `stations`, `series`, `forecast`, `heatmap`,
`selection`, `stats/summary`, `collector/status`) enthalten nichts
Persönliches und bleiben ohne Secret lesbar — sonst wäre die Ferndiagnose
(`curl` vom anderen Rechner) nicht mehr möglich.

### Entscheidung: offen bleiben oder Secret setzen

Beides ist vertretbar, aber es soll eine **Entscheidung** sein:

- **Offen (Default, `TANKAPP_READ_TOKEN` nicht gesetzt):** alles wie bisher.
  Sinnvoll, solange das LAN nur aus eigenen Geräten besteht und kein
  Gast-WLAN am selben Netz hängt. `/api/v1/health` sagt dann
  `personal_data.read_protected: false`.
- **Secret setzen:** `TANKAPP_READ_TOKEN=<Secret>` in
  `/etc/tankapp/env` (NAS) bzw. in der Compose-Umgebung exportieren, bevor
  `nas-up` das Projekt baut. Danach antworten die Routen der Tabelle oben nur
  noch mit `Authorization: Bearer <Secret>`; ohne Secret kommt `401` mit
  `error_code: "unauthorized"` (Markt- und Modelldaten bleiben offen). Derselbe
  Mechanismus wie beim Uploader-Webhook (`TANKAPP_WEBHOOK_TOKEN`), nur in die
  andere Richtung — kein Login, kein Ablaufdatum, keine Konten.

```bash
# Ohne Secret: offen (Default)
curl -s -o /dev/null -w '%{http_code}\n' http://<nas>:1355/api/v1/fills      # 200
# Mit gesetztem TANKAPP_READ_TOKEN:
curl -s -o /dev/null -w '%{http_code}\n' http://<nas>:1355/api/v1/fills      # 401
curl -s -H "Authorization: Bearer $TANKAPP_READ_TOKEN" \
  http://<nas>:1355/api/v1/fills | head -c 120                              # Belege
```

Die GUI braucht dasselbe Secret: Bereich **System → Persönliche Daten im
Netz**, Feld „Lese-Token“. Der Wert liegt gerätelokal im `localStorage`
desselben Browsers (wie die übrigen Einstellungen) und wird als
`Authorization`-Header mitgeschickt — er steht nie in einer URL, also auch
nicht in Logs. Ohne eingetragenes Token zeigen die persönlichen Bereiche
„Zugang gesperrt …“ statt leerer Listen.

**Was bewusst nicht geschützt ist:** die Schreib-Endpunkte
(`POST /api/v1/fills`, `POST /api/v1/episodes/{id}/intent`, Profile, Job-Start).
Sie haben ihr eigenes Budget (429 ab 20 Schreibvorgängen je Minute und
Client), und ein zweites Secret würde gegen die benannte Gefahr — Mitlesen im
LAN — nichts ändern. Wer auch das Schreiben absperren will, braucht ein
Reverse Proxy mit Auth vor dem Port; das ist dann eine andere Rahmenbedingung.

## Backup & Wiederherstellung

### Pi Sicherung

Code liegt auf GitHub, aber gitignored Dateien existieren nur auf Pi, müssen ins Backup (z. B. smart_backup.sh):

| Was | Pfad | Inhalt |
|---|---|---|
| API-Key | `~/TankApp/data/apikey.txt` | Tankerkönig-Key chmod 600 |
| Polling-Set | `~/TankApp/data/analysis/stations/polling.json` | 10 UUIDs + private Koordinaten |
| systemd-Unit | `/etc/systemd/system/tankapp-collector.service` | Custom Unit |
| systemd-Unit | `/etc/systemd/system/tankapp-uploader.service` | Uploader |
| InfluxDB-Zugang | `/etc/tankapp/env` | URL/Org/Bucket/Token chmod 600 |
| tmpfs-Zeile | `/etc/fstab` | RAM-Puffer |
| Heartbeat | `/dev/shm/tankapp/meta/heartbeat.json` | Wird neu erzeugt, nicht kritisch |

Bewusst NICHT sichern: `/dev/shm/tankapp/*.jsonl` (7-Tage Ringpuffer im RAM, Historie liegt in InfluxDB).

Minimal-Snippet:

```bash
mkdir -p "$TARGET/tankapp"
cp ~/TankApp/data/apikey.txt "$TARGET/tankapp/apikey.txt"
cp ~/TankApp/data/analysis/stations/polling.json "$TARGET/tankapp/polling.json"
cp /etc/systemd/system/tankapp-collector.service "$TARGET/tankapp/" 2>/dev/null
cp /etc/systemd/system/tankapp-uploader.service "$TARGET/tankapp/" 2>/dev/null
cp /etc/tankapp/env "$TARGET/tankapp/env" 2>/dev/null && chmod 600 "$TARGET/tankapp/env"
```

Restore: Repo klonen, Dateien zurückkopieren, Units nach `/etc/systemd/system/`, `/etc/tankapp/env` mit `chown pi:pi` + `chmod 600`, tmpfs-Zeile ergänzen, `systemctl enable --now tankapp-collector tankapp-uploader`. Key `pi:pi` chmod 600. Für RAM-Puffer `uid=pi,gid=pi` Variante praktisch.

### NAS InfluxDB Backup

Ringpuffer auf Pi bewusst nicht sichern. Wöchentliches Tar-Backup des InfluxDB-Volumes per cron auf NAS — **mit Rotation** (O34, seit 0.52.0):

```cron
0 3 * * 0 cd $HOME/TankApp/ops/nas/influxdb && docker run --rm \
    -v tankapp_influxdb_data:/data -v $PWD/backup:/backup alpine \
    sh -c 'tar czf /backup/influxdb-$(date +\%F).tar.gz -C /data . \
           && find /backup -maxdepth 1 -name "influxdb-*.tar.gz" -mtime +56 -delete'
```

**Aufbewahrung (O34):** acht Wochenstände (56 Tage), dann löscht der Cron die
ältesten. Begründung, nicht Gewohnheit: Jeder Wochen-Snapshot enthält die
**ganze** Historie — der jüngste ist damit fast immer der Restore-Punkt, und
ein acht Wochen alter Stand unterscheidet sich vom heutigen nur um acht Wochen
Preise. Ältere Stände braucht man für den Fall, dass das Volume beschädigt oder
still verstümmelt ist; dafür reichen acht Wochen Rückblick, während 52 Kopien
desselben Bestands pro Jahr nur Platz fressen. Eine Monatsstufe wie beim
Laufzeit-Backup (unten) ist hier bewusst **nicht** eingebaut: Dort schützt sie
vor einem langsam zerstörenden Fehler in der **persönlichen Bilanz**, die es
nirgends sonst gibt. Preise dagegen sind entweder live gepollt (dann liegt der
Wert im jüngsten Stand) oder aus dem Archiv nachladbar (unten).

Wer die Zeile in eine `crontab` übernimmt, schreibt sie als **eine** Zeile
(cron kennt kein `\`-Zeilenende); die Umbrüche oben sind nur Lesbarkeit.

Restore:

```bash
docker run --rm -v tankapp_influxdb_data:/data -v $PWD/backup:/backup alpine \
    tar xzf /backup/influxdb-<datum>.tar.gz -C /data
docker compose up -d
```

Org/Bucket/Token sind im Volume enthalten.

**Was bewusst in keiner Sicherung liegt (O34):** das **Roharchiv**
(`--archive-dir`, die nationalen MTS-K-Tagesdateien auf der HDD, mehrere GB).
Es ist die Trainingsgrundlage, aber per `history-sync` regenerierbar: Der Job
lädt fehlende Tagesdateien beim Anbieter nach
([Preislücke nachholen](#preislücke-nachholen-polling-ausfall--beschädigtes-pollingjson)),
mit 0,4 s Pause je Datei (`data-tools/fetch_history.py --delay`). Ein
vollständiger Wiederaufbau des Default-Bestands (ein Jahr, zwei Dateien je Tag
≈ 730 Downloads) kostet damit ~5 Minuten Pause plus Download-Zeit — kein
Bestand, für den man eine zweite Kopie pflegen muss. Nicht regenerierbar sind
dagegen die **live gepollten** Preise im InfluxDB-Volume (oben) und die
persönliche Bilanz in `runtime/` (unten); beide haben deshalb eine Sicherung.

### NAS Laufzeitdaten (runtime/) Backup

Das InfluxDB-Volume sichert die **Preise** — nicht die persönliche Tank-Bilanz.
Die liegt in `runtime/` (Feedback-Store, Selektion, Job-Stände) und wird bisher
nicht gesichert. Ein NAS-Disk-Crash wäre der Verlust der Bilanz. Täglich sichern:

```cron
30 3 * * * TANKAPP_RUNTIME_DIR=/data/runtime TANKAPP_BACKUP_DIR=/pfad/zu/backup $HOME/TankApp/ops/nas/backup.sh
```

`TANKAPP_RUNTIME_DIR` ist das in `compose.yml` gemountete `runtime/`-Verzeichnis
(siehe `tankapp.py nas-up`), `TANKAPP_BACKUP_DIR` das vorhandene Backup-Ziel.

**Aufbewahrung (O33, seit 0.47.0):** 14 Tagesstände
(`TANKAPP_BACKUP_KEEP_DAYS`) **plus 6 Monatsstände**
(`TANKAPP_BACKUP_KEEP_MONTHLY`, `tankapp-runtime-monthly-<JJJJ-MM>.tar.gz`).
Die zweite Stufe ist keine Spielerei: 14 Tage sind kürzer als die Zeit, die ein
langsam zerstörender Fehler braucht, um aufzufallen — ein Wallet-Bug oder eine
stille Größen-Grenze hat dann alle guten Tagesstände überschrieben, bevor
jemand hinschaut. Ein Monatsstand ist der Stand, zu dem man zurück kann. Die
Tages-Rotation nimmt die Monatsstände ausdrücklich aus.

**Die App prüft das Alter mit (O33):** `backup.sh` kann still ausfallen —
NAS-Update, Pfad umbenannt, Volume ausgehängt — und vor 0.47.0 merkte das
nichts. Seit 0.47.0 meldet `GET /api/v1/health` → `backup` Alter und Anzahl der
Tagesstände, und ab **36 Stunden** ohne neues Tar schlägt Alarm `backup_stale`
(warn) an. Gezählt werden die Tagesstände, nicht die Monatsstände: Ein
Monatsstand ist bis zu 31 Tage alt, ohne dass etwas fehlt, und würde einen
toten Cron einen Monat lang überdecken.

Dazu muss die App das Ziel sehen können — im Container ist es das nicht von
allein. `tankapp.py nas-up` hängt die Erweiterung `ops/nas/app/compose.backup.yml`
automatisch an, wenn `TANKAPP_BACKUP_DIR` in seiner Umgebung gesetzt ist; das
Ziel wird **read-only** nach `/backup` gemountet (die App prüft nur Alter und
Anzahl, sie schreibt nie in das Backup):

```bash
TANKAPP_BACKUP_DIR=/pfad/zu/backup python tankapp.py nas-up
# Gegenprobe: /api/v1/health → "backup": {"configured": true, "age_hours": …}
```

Ohne die Variable bleibt `backup.configured: false` — kein Alarm (die App weiß
nicht, ob anderswo gesichert wird), aber sichtbar im Health-Payload statt
still. Ein **konfiguriertes, aber nicht erreichbares** Ziel ist dagegen ein
Alarm (`reason: "directory_missing"`): Genau dann wäre ein Backup
verschwunden, ohne dass es jemand merkt.

**Zweites Ziel — ausdrückliche Entscheidung.** `TANKAPP_BACKUP_DIR` liegt
üblicherweise auf demselben NAS wie die Daten: Ein NAS-Ausfall nimmt Daten
**und** Sicherung mit, und die einzigen unersetzbaren Bestände — die
Tank-Bilanz (`runtime/feedback/store.json`) und die privaten
Anker-Koordinaten im Polling-Set — hätten keine zweite Kopie. Stand
17.09.2026 ist die Entscheidung: **ein Ziel auf dem NAS plus eine Kopie der
unersetzbaren Bestände außerhalb des Geräts.** Konkret heißt das

* Laufzeitdaten täglich ins NAS-Backup-Ziel (dieses Skript), und
* `GET /api/v1/fills.csv` (die Bilanz) sowie `polling.json` (Koordinaten)
  regelmäßig auf ein zweites Gerät — derselbe Ort, an dem auch
  [die Pi-Dateien](#pi-sicherung) landen.

Wer es bei einem Gerät belassen will, trifft das bewusst und schreibt es hier
her: Ein einzelnes Ziel schützt vor gelöschten oder zerlegten Dateien, nicht
vor einem toten NAS. Ein zweites automatisches Ziel (rsync des Backup-Ordners
auf ein anderes Gerät) ist offen und steht im
[Todo](../TODO.md#b-technisch-backend-datenhaltung-betrieb-qualität).

Restore (durchgespielt, nicht nur aufgeschrieben):

```bash
# App stoppen, damit der Store nicht während des Kopierens geschrieben wird.
docker compose -f ops/nas/app/compose.yml stop app
mkdir -p /data/runtime
tar xzf tankapp-runtime-<datum>.tar.gz -C /data/runtime
docker compose -f ops/nas/app/compose.yml start app
# Gegenprobe: Wallet-Zähler in der GUI und GET /api/v1/fills zeigen den alten Stand.
```

Danach einmal `GET /api/v1/health` prüfen: `app` = `online`, kein Alarm
`store_too_large`. Preise kommen aus InfluxDB (separates Backup) und bleiben
vom runtime-Restore unberührt.

### Schema-Version des Feedback-Stores (B2)

Der Feedback-Store (`runtime/feedback/store.json`) trägt ein
`schema_version`-Feld. Beim Laden wird ein Altbestand automatisch auf die
aktuelle Version migriert (je Versionssprung eine eigene Funktion in
`app/feedback.py`), der nächste Schreibvorgang sichert die migrierte Fassung —
Ältere Stores **brechen nicht mehr still**. Ein Store aus einer *neueren*
App-Version wird bewusst mit Fehler abgelehnt (503, `StoreSchemaTooNew`),
nie still als leer behandelt: Erst das App-Update, kein Überschreiben. Beim
Restore alter Backups ist deshalb kein Handanlegen nötig — einbinden und die
App migrieren lassen.

Aktuelle Version: **4** (0.44.0, O1). Der Sprung 3 → 4 ergänzt je Beleg
`clock_hour_source` — und ist eine **Auszeichnung, keine Umschrift**: Die
Uhrzeit eines Belegs wird seit 0.44.0 serverseitig aus `tanked_at` in
Europe/Berlin abgeleitet (`"beleg"` = GUI hat `clock_hour` selbst geschickt,
`"abgeleitet"` = aus dem Zeitstempel, `"default"` = 12 Uhr, weil der Beleg
keinen Zeitstempel trägt). Alte Belege werden **nicht** still umgeschrieben:
Ein Bestand aus Version 3 behält seine 12-Uhr-Werte, trägt danach aber
`"default"` als Herkunft, und die Statistik nennt die Anzahl
(`wh_default_n` in `GET /api/v1/stats/summary`). Wer sein Tankzeit-Profil neu
auf echte Uhrzeiten stellen will, löscht den Altbestand bewusst (Backup vorher:
`GET /api/v1/fills.csv`) — ein Restore des Backups migriert danach auf Version 4.

## System-Alarme lesen

`GET /api/v1/health` fasst die vorhandenen Zustandsprüfungen zu einem
`alarms[]`-Block zusammen (`app/alarms.py`). Bewusst **ohne** neue Netz- oder
InfluxDB-Zugriffe, damit der Docker-Healthcheck im 3–5-s-Budget bleibt. Die GUI
zeigt daraus einen Punkt im Header aller Tabs: **rot** bei `severity: "error"`,
**gelb** bei `"warn"`, grün ohne Alarm; der Tooltip listet die Meldungen im
Klartext.

| `code` | Schwere | Bedeutung | Erste Aktion |
|---|---|---|---|
| `polling_missing` | error | gemeinsames Polling-Set fehlt | `data/analysis/stations/polling.json` vom Pi bereitstellen → [INSTALL.md](INSTALL.md#private-dateien) |
| `polling_invalid` | error | Polling-Set ungültig (Format, leere/doppelte Sets) | Set prüfen und neu aufbauen → [STATIONEN-TAUSCH.md](STATIONEN-TAUSCH.md) |
| `collector_no_heartbeat` | error | noch kein Herzschlag des Pi auf dem NAS | Uploader + Heartbeat prüfen → [Heartbeat B3.11](#heartbeat-b311) |
| `collector_stale` | warn | Herzschlag älter als 15 min — Preise können eingefroren sein | `systemctl status tankapp-collector tankapp-uploader` auf dem Pi |
| `job_failed` (mit `job`) | error | NAS-Job `archive`, `models`, `selection` oder `settlement` ist fehlgeschlagen | Ursache im Job-Log → [Fehlgeschlagener Lauf](#fehlgeschlagener-lauf-ursache-statt-raten) |
| `job_partial` (mit `job`) | warn | Lauf unvollständig: mindestens eine Station ohne neues Modell (`state: partial`) | Nichts tun — nächster Versuch im regulären Intervall, nicht stündlich |
| `job_aborted` (mit `job`) | warn | Lauf hart beendet, z. B. Container-Neustart (`state: aborted`) | Nichts tun — letzte Ergebnisse bleiben erhalten; nächster Versuch folgt |
| `store_too_large` | error | persönlicher Feedback-Store über der Größen-Grenze — neue Belege werden abgelehnt | Restore/Retention → [NAS Laufzeitdaten](#nas-laufzeitdaten-runtime-backup) |
| `store_growing` | warn | Store über 80 % der Grenze | 90-Tage-Retention prüfen, Bilanz sichern: `GET /api/v1/fills.csv` |
| `publication_unreadable` | error | Veröffentlichung der Prognosen über dem Leselimit oder nicht parsebar — GUI zeigt überall „keine Prognose“ | Größe und Lesbarkeit prüfen → [Größe der Veröffentlichung](#größe-der-veröffentlichung-o22-seit-0440) |
| `publication_large` | warn | Veröffentlichung über 6 MB, aber noch lesbar — Puffer zum Leselimit schrumpft | Stationen/Kraftstoffe oder `bootstrap_samples` prüfen → [Größe der Veröffentlichung](#größe-der-veröffentlichung-o22-seit-0440) |
| `price_implausible` | warn | mindestens ein Live-Preis der letzten 24 h außerhalb 0,40–5,00 €/L — als Beobachtung gekennzeichnet, nicht als Preis veröffentlicht (O35) | Zähler im Health-Payload (`price_implausible.count_24h`); bei Dauerbetrieb die Preisquelle prüfen |
| `backup_stale` | warn | letztes Laufzeit-Backup älter als 36 h, Ziel leer oder nicht erreichbar (O33) | Cron-Eintrag, Mount und `TANKAPP_BACKUP_DIR` prüfen → [NAS Laufzeitdaten](#nas-laufzeitdaten-runtime-backup) |

Ein Alarm ist eine **Zusammenfassung**, keine neue Prüfung: Dieselbe Information
steht auch in den Fach-Endpunkten (`/api/v1/collector/status`,
`/api/v1/jobs/<job>/log`, `/api/v1/stats/summary`, `publication` im
`/health`-Payload). Wer nur einen einzigen Check im Haushalt laufen lassen will,
pollt `/health` und schaut auf `alarms`.

### Alarm-Zustellung über ntfy (B4)

Wer die GUI nicht offen hat, bekommt Alarme mit `severity: "error"` auf das
Handy: `app/notify.py` prüft im eigenen Takt (5 min) die Alarm-Lage und schickt
**Zustandswechsel** an einen einzigen ntfy-Endpunkt. `severity: "warn"` wird
bewusst nicht gepusht — Warnungen bleiben im Header-Punkt, sonst ist das Handy
nach einem Tag nur noch laut.

Einrichten (ein Wert, sonst nichts):

```bash
# Auf dem NAS, bevor `nas-up` das Compose-Projekt aktualisiert:
export TANKAPP_NTFY_URL="https://ntfy.sh/tankapp-<zufälliger-name>"
python3 tankapp.py nas-up
# Handy: ntfy-App installieren, dasselbe Topic abonnieren.
```

Seit 0.46.0 meldet sich zusätzlich das **empfohlene Tankfenster** über
denselben Kanal (O29): eine Meldung, wenn ein Fenster mit ausreichender
Sicherheit aufgeht, eine, wenn die Empfehlung auf ein anderes Fenster
kippt, und eine Abschlussmeldung, wenn das Fenster ungenutzt verstreicht.
Entdupliziert über die Episoden-Kennung, nachts still (Ruhezeit 22–7 Uhr
Europe/Berlin — gilt nur für Fenster-Meldungen, Alarme kommen rund um die
Uhr). Was diese Meldungen dürfen, entscheidet der **Push-Modus** (O42):

| Modus | Einrichtung | Fenster-Meldung trägt |
|---|---|---|
| `public` (Default) | `TANKAPP_NTFY_URL` zeigt auf einen fremden/öffentlichen Dienst (z. B. ntfy.sh) | neutralen Satz — keine Preise, keine Stationen |
| `lan` | `TANKAPP_NTFY_MODE=lan` + eigener ntfy-Server im LAN | Station, Fensterzeit und erwarteten Preis — nie Koordinaten oder Pfade |

Der Default ist bewusst der zurückhaltende: Die Webhook-URL ist ein
Bearer-Secret, und schon die Zeitpunkte der Meldungen sind Metadaten über
das eigene Tankverhalten. Wer Details will, hostet ntfy selbst und sagt es
der App ausdrücklich. Der gewählte Modus steht in `/api/v1/health` →
`notify.mode`; beide Payload-Regeln sind getestet
(`tests/test_o29_window_push.py`).

**Rotation der URL:** Die URL (inklusive Topic) ist der einzige
Geheimnisträger des Kanals. Sie rotiert durch Themenwechsel: neues Topic
anlegen, `TANKAPP_NTFY_URL` in der NAS-Umgebung ändern, `nas-up`, das neue
Topic auf dem Handy abonnieren — der Zustand in
`runtime/notify/windows.json` bleibt dabei gültig, nur `state.json`-Codes
gelten nach dem Neustart als neu gemeldet. Wer die URL in eine Datei legt
(z. B. eine `.env` neben `ops/nas/app/compose.yml`), setzt die Rechte auf
`600`; in der App selbst erscheint die URL nie (weder im Payload noch im
GUI, Logs laufen durch `app/errors.redact`).

**Alarm-Meldungen** senden weiterhin nur, was auch im GUI-Tooltip steht,
plus App-Version — stabile Codes und ihre deutschen Klartexte, keine Preise,
keine Tankstellen, keine Koordinaten, keine Pfade, keine Zugangsdaten:

```json
{"title": "TankApp: 2 Alarme",
 "message": "collector_no_heartbeat — Noch kein Collector-Herzschlag des Pi auf dem NAS.\npolling_missing — Das gemeinsame Polling-Set ist ungültig oder fehlt — keine Stationen verfügbar.\n(TankApp 0.15.0)",
 "priority": 4, "tags": ["warning"]}
```

Das Topic steht in der URL, nicht im Payload; `priority: 4` = Ton/Vibration.
`ntfy.sh`-Topics sind öffentlich lesbar, sobald jemand den Namen kennt —
deshalb ein zufälliger Topic-Name oder ein eigener ntfy-Server im LAN.

| Situation | Nachricht |
|---|---|
| ein Fehler-Code kommt neu dazu | eine Meldung mit allen dann offenen Codes |
| ein Code hält seit 6 h an | **eine** Erinnerung, danach Ruhe |
| alle Fehler sind weg | einmal „wieder betriebsbereit“ (`priority: 2`) |
| einzelne Codes verschwinden, andere bleiben | nichts — der Zustand wird still nachgezogen |
| eine Warnung kommt oder geht | nichts |

Zustellung fehlgeschlagen? Dann steht eine bereinigte Zeile (ohne URL, ohne
Secret) im App-Log, der Zustand bleibt unverändert, der nächste Tick versucht
es erneut:

```bash
cat data/runtime/notify/state.json                                  # was ist gemeldet
docker compose -f ops/nas/app/compose.yml logs --tail 50 app | grep ntfy
curl -s http://nas:1355/api/v1/health | jq '.alarms, .notify'        # konfiguriert? offene Codes?
curl -s -X POST -d "Test-Nachricht vom NAS" "$TANKAPP_NTFY_URL"      # Handy muss klingeln
```

Ohne `TANKAPP_NTFY_URL` läuft alles wie vorher: Alarme stehen in `/health` und
im Header-Punkt, es wird nichts verschickt.

**Im System-Tab sichtbar (0.16.0):** Die Kachel „Alarm-Zustellung · Push aufs
Handy“ (zwischen Collector-Status und API-Explorer) zeigt, ob ein Endpunkt
konfiguriert ist, welche Error-Codes als gemeldet gelten sowie „Zuletzt
gemeldet“ und „Zuletzt Entwarnung“ in Berliner Zeit. Die Webhook-URL erscheint
dort bewusst nicht — sie ist der einzige Geheimnisträger. Ohne
`TANKAPP_NTFY_URL` steht dort die Tatsache („Alarme stehen nur hier in der
GUI“), kein Fehler.

### Webhook Pi → NAS (B8, seit 0.38.0)

`POST /api/v1/jobs/trigger` wird
quittiert und bei Bedarf wiederholt. Bleibt die Quittierung aus (NAS kurz
offline, Neustart), merkt sich der Uploader den Trigger und versucht ihn
erneut — 30 s, 60 s, … höchstens alle 15 Min. Nach 2 h gibt er auf; ab dann
ist der Intervaljob wieder allein zuständig („aufgegeben“ statt endlosem
Wiederholen). Sichtbar ist der Zustand im System-Bereich (Zeile „Trigger
Pi → NAS“ in den Collector-Details) und in `GET /api/v1/collector/status`
als Feld `webhook`:

| Wert | Bedeutung |
|---|---|
| `queued` | Quittiert — der NAS-Job ist vorgemerkt |
| `debounced` | Quittiert — gedrosselt, ein Lauf steht kurz bevor |
| `duplicate` | Quittiert — derselbe Datenstand lief schon |
| `retry_wait` | Antwort steht aus, nächster Versuch ist vorgemerkt |
| `abandoned` | Nach 2 h ohne Quittierung aufgegeben |
| `rejected` / `http_403` | Dauerhaft: unbekannter Job oder falsches Token — nicht wiederholt (`TANKAPP_NAS_WEBHOOK_TOKEN` auf Pi und NAS vergleichen) |

Ohne eingerichtetes Ziel (`TANKAPP_NAS_WEBHOOK_URL`) meldet der Uploader
keine Webhook-Felder — die GUI sagt dann „keine Angabe“ statt „in Ordnung“.

### System-Alarme und GUI-Neuentwurf (seit 0.35.0)

Betriebs-Entscheidung zu Checkliste [2.4](archiv/UMSETZUNG-GUI-NEUENTWURF-2026-09-14.md): Das
GUI-Neuentwurf-Konzept ([UI-NEUENTWURF.md](UI-NEUENTWURF.md) §11,
Entscheidung 14.9.) streicht **Preis-Erinnerungen, Preis-Alarme und Push
ersatzlos**. Damit ist gemeint, dass die App keine Preis-Mitteilungen mehr
versendet — **der System-Alarmweg bleibt davon unberührt** und unverändert
aktiv. Die zwei Welten bleiben getrennt:

| Pfad | Komponenten | Was sie melden | Stand |
|---|---|---|---|
| System-Alarme (Betrieb) | `app/alarms.py`, `app/notify.py` (B4) | Collector, Läufe, Store, Heartbeat — der Zustand der Maschine | **Unverändert**: `alarms[]` in `/health`, Header-Punkt, Kachel im System-Tab, ntfy-Zustandswechsel bei `severity: "error"` (dieses Kapitel) |
| Fenster-Meldungen (Empfehlung) | `app/notify.py` (O29, seit 0.46.0) | empfohlenes Fenster offen / geändert / ungenutzt verstrichen — dieselbe Empfehlung, die die GUI zeigt | **aktiv**, sobald `TANKAPP_NTFY_URL` gesetzt ist; Datentiefe nach Push-Modus → [ntfy](#alarm-zustellung-über-ntfy-b4) |
| Preis-Erinnerungen / Preis-Alarme | — | hätte auf Preis-Chancen hingewiesen („Jetzt 4 ct unter Tagesmedian“) | **existiert nicht** — §11 streicht sie ersatzlos; die Fenster-Meldung (O29) ist die Empfehlung, kein Preis-Ticker |

Folgen für den Betrieb:

- `TANKAPP_NTFY_URL` bedeutet **System-Alarme plus Fenster-Meldungen**
  (0.46.0, O29) — aber keine Preis-Ticker: Live-Preis-Nachrichten ohne
  Empfehlung kommen nicht, und sie kommen auch nicht, es sei denn,
  Mitteilungen kommen nach §11 als eigener, explizit einzuschaltender
  Baustein zurück.
- Störungen erscheinen in der neuen GUI **nur als Anzeige**: Header-Punkt plus
  Klartext im System-Tab mit Erster Aktion — kein Push, kein Ton (§11).
- Die bestehenden Alarm-Einträge (Tabelle oben) gelten **unverändert**; es wird
  nichts migriert, umbenannt oder stillgelegt. `app/alarms.py` und
  `app/notify.py` bleiben wie gehabt Teil des Betriebs.

### Version und Build-Hash prüfen

`GET /api/v1/health` liefert `version` (z. B. `0.11.0`, gepflegt in
`app/version.py`) und `commit` (Kurzhash des Checkouts). Beide Werte stehen auch
im GUI-Footer. Bei drei Oberflächen — NAS-GUI, RP2-Proxy/Fallback, Collector auf
dem Pi — ist das die Antwort auf „was läuft hier eigentlich?“:

```bash
curl -s http://<NAS>:1355/api/v1/health |
  python3 -c 'import json,sys; h=json.load(sys.stdin); print(h["version"], h["commit"], [a["code"] for a in h["alarms"]])'
```

Im Docker-Image ist `commit` `null`, solange `TANKAPP_BUILD_COMMIT` nicht
gesetzt ist — das Image enthält weder `.git` noch `git` (`app/version.py` liest
die Variable beim Import und ruft sonst `git`). `ops/nas/app/compose.yml` reicht
sie als Build-Argument durch, also genügt
`TANKAPP_BUILD_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build`.
Wer den Hash nicht setzt, betreibt trotzdem einen funktionsfähigen Stand — nur
sagt `/health` dann nicht, welcher. Die RP2-Fallback-GUI trägt einen
eigenen Template-Hash-Marker → [RP2.md](RP2.md#template-updates). Änderungen je
Version: [CHANGELOG](../CHANGELOG.md).

### 404-Wand und Absturz auf `<RP2-IP>:8000` (Fallback-Modus, seit 0.49.1)

Symptom aus dem Betrieb vom 17.09.2026: Am Pi füllt sich die Browser-Konsole
mit `404` (`stats/summary`, `fills`, `fills/summary`, `selection`, `heatmap`,
`forecast`, `advice/diary`, `collector/status`, `jobs/models`, `log`) und
`400` (`series` mit `hours=24`/`168`), dazu
`Uncaught TypeError … (reading 'includes')` und eine weiße Seite.

Das ist kein Serverfehler, sondern die Grenze der beiden Antwortflächen: Die
RP2-Fallback-GUI beantwortet genau sieben Pfade (`health`, `stations`,
`forecasts`, `decide`, `series`, `nas-check` und die Oberfläche selbst) und
liefert für alles andere bewusst `404` — sie hat nur den Live-Puffer des Pi.
`/api/v1/series` ist zudem eine andere Reihe als die NAS-Ausführung (Parameter
`station` statt `station_id`/`hours`, Tagesverlauf 06–24 Uhr aus dem Puffer,
siehe [RP2.md](RP2.md#fallback-api-und-umschaltzeiten)).

Zu prüfen ist nur, welche Oberfläche dort ausgeliefert wird:

```bash
curl -s http://<RP2-IP>:8000/ | head -3          # v4-Vorlage („FALLBACK · RP2“) oder SPA?
curl -s http://<RP2-IP>:8000/api/v1/health | python3 -m json.tool | head -20
grep -o 'tankapp-fallback-gui [^>]*' rp2/templates/index.html   # Template-Marker
```

- **Eigene v4-Vorlage:** Nur der Fallback-Teil der Konsole ist erwartbar; die
  SPA-404s dürfen nicht auftreten.
- **Gebaute NAS-GUI (`TEMPLATE_DIR` auf `web/dist`):** Die 404s und der
  `series`-Fehler sind erwartbar. Seit **0.49.1** trägt die
  Stations-Antwort des Fallbacks `cities` und je Zeile `observed_at`
  (RP2 v4.3), und die App behandelt Antworten ohne `cities`/`stations` als
  „kein Payload“ statt abzustürzen — mit einem Update auf beiden Seiten ist
  die weiße Seite weg (Empfehlungen, Heatmaps und Belege bleiben NAS-Sache).

### GUI-Update und Offline-Queue (B10, seit 0.38.0)

Die installierte GUI ist eine PWA (`/sw.js`). Seit 0.38.0 trägt die App-Shell
die **App-Version**: `web/vite.config.ts` liest `app/version.py` und stempelt
sie in `web/dist/sw.js` (Cache-Name `tankapp-shell-<version>`). Bleibt der
Platzhalter stehen, bricht der Build ab — eine ausgelieferte Shell ohne Version
wäre genau die stille Lüge, die B10 beseitigt hat.

- Ein neuer Service Worker **wartet** (`skipWaiting` erst auf Anforderung). Die
  Ansicht zeigt dann „Neue Version verfügbar — diese Ansicht läuft noch auf X“
  mit „Jetzt neu laden“ / „Später“ (still für die Sitzung, nicht für immer).
- Die Version der laufenden Ansicht ist beim Build eingebrannt; der Footer
  nennt weiterhin die Server-Version. Weichen sie ab, sagt es der Hinweis —
  statt einer Zahl, die nur der Server kennt.
- **Offline-Queue für Belege und Vorsätze:** Reißt die Verbindung ab oder
  antwortet der Server mit 502/503/504, merkt die GUI den Schreibvorgang lokal
  vor (`localStorage`, Schlüssel `tankapp.offline.queue.v1`) und reicht ihn beim
  nächsten Kontakt nach — bei App-Start und beim `online`-Ereignis. Sichtbar
  als Zeile über den Tabs („… sind lokal vorgemerkt und gehen raus, sobald die
  Verbindung steht“). Ablage in `localStorage` statt IndexedDB: winzige
  JSON-Objekte, kein Binärinhalt, keine Transaktionen nötig (Abweichung vom
  Konzept §5.4, in [LUECKEN.md](LUECKEN.md) vermerkt).
  - Ober­grenzen: 50 Einträge, älter als 7 Tage wird verworfen (die Ansicht
    sagt das nicht als Fehler, sondern lässt die Zeile verschwinden).
  - Beleg-`id` und `tanked_at` entstehen **beim Tanken**, nicht beim
    Nachreichen; der Server ist über `id` idempotent — ein doppelt gesendeter
    Beleg landet nicht zweimal im Ledger.
  - Nur 4xx (Ablehnung: Liter außerhalb der Grenzen, fremde Station) wird
    sofort gemeldet und **nicht** nachgereicht. 500 ist ein Programmfehler und
    wird ebenfalls gemeldet, nicht wiederholt.
  - Profile, Storno und Jobstart laufen nicht über die Queue — sie sind
    Entscheidungen, keine Datenerfassung im Funkloch.

## Fehlersuche

### Collector Störungsfälle

| Log-Meldung | Bedeutung / Aktion |
|---|---|
| `HTTP 429` | API-Limit (1/5min) — wartet 60s |
| `no prices` | Station meldet keine Preise; Alarm erst nach **7 Kalendertagen** ohne Daten (nicht nach 7 Polls) |
| `Fenster zu … schlafe` | normal 00–06 Uhr |
| `parameter error` | ids ODER apikey leer — siehe Diagnose unten |
| `Key existiert nicht` | Key unbekannt/deaktiviert → tankerkoenig.de prüfen |
| `nicht im korrekten Format` | polling.json enthält kaputte UUIDs |
| `⚠ … UUIDs haben kein gültiges Format` | Collector überspringt kaputte UUIDs → polling.json neu erzeugen |
| `⚠ API-Key sieht nicht nach einer UUID aus` | apikey.txt enthält mehr als nackten Key → nur 36 Zeichen |
| `⚠ Proxy-Umgebung gesetzt` | http_proxy/https_proxy gesetzt, kann Aufruf verfälschen |
| `Puffer … nicht beschreibbar` / PermissionError 13 | /dev/shm/tankapp gehört root, Dienst pi → `sudo chown pi:pi /dev/shm/tankapp` |
| Dienst startet nicht | `journalctl -u tankapp-collector -n 50`; meist fehlt polling.json oder Key |

### Preislücke nachholen (Polling-Ausfall / beschädigtes polling.json)

Es gibt zwei getrennte Datenwege, und nur einer lässt sich nachträglich auffüllen:

**Live-Ansicht („Heute im Überblick“)** liest direkt aus InfluxDB — also nur die
echten Polls des Pi. Ein wegen eines Ausfalls verpasster Poll lässt sich dort
**nicht** nachträglich einspielen; die Lücke bleibt in der Live-Kurve, bis das
Polling wieder normal läuft. Wichtig ist allein, das Polling-Set zu reparieren
(polling.json neu aus der geprüften Vorlage aufbauen und mit
`python3 -m json.tool data/analysis/stations/polling.json` prüfen), damit die
nächsten Polls wieder ankommen.

**Archiv & Modell** sind ein zweiter Weg mit denselben Marktdaten: Das
Tankerkönig-Archiv (MTS-K) hält die Tagesdateien unabhängig vom eigenen Polling.
Ein verpasster Tag wird beim nächsten Archiv-Sync automatisch nachgeladen:

```bash
# Lückenprüfung erzwingen — holt fehlende Tagesdateien bis gestern nach:
python3 tankapp.py history-sync --archive-dir /pfad/zum/archiv --force

# Nur einen bestimmten Zeitraum nachholen:
python3 tankapp.py history-sync --archive-dir /pfad/zum/archiv --since 2026-09-10
```

Der nächste Modell-Lauf nutzt die nachgeladene Historie für Training und
Backtest (Anker-Entscheidungszeilen im Scoreboard). Das Nachladen schreibt
**nicht** in InfluxDB — die Live-Kurve bleibt unverändert.

### Polling-Lücken werden automatisch aus dem Archiv geschlossen

Der Modell-Job erkennt geschlossene Lücken im Live-Export (Soll-Takt × 3,
mindestens 15 Minuten — z. B. gestern 12–13 Uhr) und füllt sie mit echten
Archiv-Ereignissen (`app/gapfill.py`, Phase „gapfill“ im Job-Log):

- Nur **geschlossene** Lücken (beide Ränder beobachtet), nur **vergangene
  Tage**, nur innerhalb des Polling-Fensters (die Nacht ist Sammelpause,
  keine Lücke). Die offene Flanke am Datenrand und Lücken von heute bleiben
  Live-Sache.
- Archiv-Zeilen tragen `source=history` und verlieren im Engine-Dedup gegen
  jeden Live-Poll desselben Zeitpunkts — Live hat immer Vorrang.
- Ergebnis steht in der Publikation als `gapfill_quality`
  (`gaps_detected`/`gaps_filled`/`gap_events`/`gap_days`/`missing_days`).
- Scheitert die Füllung, läuft das Training mit den Lücken weiter (ehrlich
  als `{"skipped": true}` vermerkt) statt ganz auszufallen.

Voraussetzung ist ein gefülltes Archiv (stündlicher `archive`-Job). Fehlt
ein Archivtag, zählt er als `missing_days` — es wird nichts interpoliert.

### Legacy-Punkte ohne `station_id` (Namens-Zwillinge)

Der Uploader schreibt seit 09/2026 `station_id`-UUID-Tags. Ältere InfluxDB-Punkte
tragen nur `city` + `station` (Anzeigename) — zwei Stationen mit gleichem Namen
sind daraus **nicht** trennbar. Der Exporter rät deshalb keine UUIDs, sondern
bricht mit einer Erklärung ab:

```text
Influx-Station 'Frankfurt'/'Aral Tankstelle': mehrdeutig. Legacy-Punkt ohne
station_id; UUIDs werden nicht geraten. Uploader auf UUID-Tags aktualisieren,
Original-JSONL bei Bedarf nachliefern und mit --uuid-only exportieren …
```

Vorgehen (nur lesend, kein Ack-Reset, kein Löschen alter Serien):

1. Code auf Pi und NAS aktuell halten (`git pull`), dann **nur** den Uploader neu
   starten: `sudo systemctl restart tankapp-uploader`. Collector, Pi-Zeitzone und
   Reboot-Verhalten unverändert lassen.
2. Nächsten erfolgreichen Poll abwarten (06–24 Uhr, je Stadtset ~10 min) und dann
   ausschließlich die eindeutigen Punkte exportieren:

```bash
python3 data-tools/export_influx.py --env-file data/influx.env --uuid-only
```

3. Alte Namensserien bleiben unangetastet; sie sind als Legacy gekennzeichnet und
   ersetzen keinen Live-Gütenachweis.

Eine **optionale** Nachlieferung alter JSONL-Sicherungen (Replay) ist nur mit
belegter ursprünglicher Zeitzone zulässig und steht vollständig im Archiv:
[archiv/STATIONS-UUID-MIGRATION.md](archiv/STATIONS-UUID-MIGRATION.md) —
`upload_influx.py --replay --replay-timezone …`, erst im Dry-Run; bei
`TIME_OFFSET_MISSING` keine Uhrzeit raten.

**Nie:** einen Namenszwilling aus `polling.json` entfernen, um alte Punkte
umzudeuten. Das ändert die Bedeutung der Historie, nicht die Daten. Diagnose
am PC: [ENGINE.md](ENGINE.md) (Tabelle „Stationsname mehrdeutig“).

### Uploader Störungsfälle

| Log-Meldung | Bedeutung |
|---|---|
| `NAS nicht erreichbar` | NAS aus oder falsche URL — Backoff 60s→15min, Puffer läuft weiter |
| `HTTP 401` | Token fehlt/falsch — InfluxDB UI prüfen |
| `HTTP 403` | keine Schreibberechtigung — Token neu mit --write-bucket |
| `HTTP 404` | Org/Bucket existiert nicht — Org/Bucket prüfen |
| `HTTP 400` | Line Protocol abgelehnt — sollte nicht vorkommen |
| `⚠ PUFFER ÜBERFÜLLT` | älteste unsynced Zeile ≥6 Tage — NAS-Ausfall zu lang, FIFO Verlust |
| `⚠ Stationsnamen nicht verfügbar` | polling.json fehlt — station-Tag enthält UUID statt Name |
| `⇡ Collector-Herzschlag → InfluxDB` | **B3.11** Heartbeat erfolgreich übertragen |

### parameter error Diagnose

API antwortet `ok=false` mit `parameter error` nur wenn ids oder apikey leer/fehlend ankommen (falscher Key ergibt „Key existiert nicht…“, kaputte UUID „…nicht im korrekten Format“). Collector sendet immer beide Parameter — also nacheinander prüfen:

```bash
python3 - <<'PY'
import json
p = json.load(open("/home/pi/TankApp/data/analysis/stations/polling.json"))
s = next(iter(p["sets"].values()))
print("label:", s.get("label"))
print("batch:", s.get("batch"))
PY

python3 - <<'PY'
from pathlib import Path
k = Path("/home/pi/TankApp/data/apikey.txt").read_text().strip().splitlines()
print("Zeilen:", len(k), "| Länge von Zeile 1:", len(k[0]) if k else 0)
PY

systemctl status tankapp-collector | head -3
sudo systemctl restart tankapp-collector

curl -s "https://creativecommons.tankerkoenig.de/json/prices.php?ids=<uuid1>,<uuid2>&apikey=<KEY>"

env | grep -i proxy
sudo systemctl show tankapp-collector -p Environment
```

Häufigster Fall: Dienst lief noch mit alter Unit/altem Key (erst restart) oder apikey.txt war leer bzw. Platzhalter.

### NAS Python GLIBC Fehler

Symptom beim Start, noch vor TankApp-Ausgabe — `git pull` läuft durch:

```
ImportError: /lib64/libm.so.6: version `GLIBC_2.44' not found (required by
/usr/lib64/python3.12/lib-dynload/math.cpython-312-x86_64-linux-gnu.so)
```

Kein TankApp-Fehler. Python wurde für anderes System gebaut (neuere glibc) und kann eigene Standardbibliothek nicht laden — schon `import math` scheitert. Mit solchem Python bricht jedes Python-Programm ab.

Prüfen:

```bash
python3 -c "import math"
ldd --version
which -a python3
```

Abhilfe: python3 verwenden, das zur glibc des NAS passt. Auf Unraid gehören python3-Pakete in für installierte Unraid-Version vorgesehene Quellen (klassisch NerdTools; bei Unraid 7 gepflegte Nachfolge-Repos oder un-get) — nie Pakete aus slackware64-current oder anderer Distribution. Bereits installiertes fremdes Paket vorher mit `removepkg` entfernen (auf Unraid zusätzlich prüfen, ob es in `/boot/extra` liegt). TankApp braucht nur Python ≥3.9 mit Standardbibliothek.

Ausdrücklich nicht versuchen: glibc von Hand aktualisieren/downgraden/neu bauen — legt gesamtes NAS lahm.

`bash ops/nas/preflight.sh` prüft Version und ob python3 Standardbibliothek laden kann, meldet diesen Fall eigenständig.

### `reportAllChanges`/`startTime` in der Browser-Konsole

Symptom (gemeldet am 18.09.2026):

```
Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')
    at et.reportAllChanges (<anonymous>:2:19429)
    at <anonymous>:2:13070
    …
    at n.timeout (<anonymous>:2:5652)
```

**Kein TankApp-Fehler.** Der Stack besteht nur aus `<anonymous>`-Frames ohne
App-Bezug, und die Byte-Offsets sind identisch mit dem bekannten Fehler der
`web-vitals`-Kopie, die **Chrome DevTools** selbst in die Seite injiziert
(GoogleChrome/web-vitals #792, angular/angular #70464 — beide mit genau
`:2:19429` und `n.timeout (:2:5652)`). Er tritt bevorzugt bei Navigationen mit
offenem DevTools-Panel auf, unabhängig davon, welche App läuft.

TankApp kann ihn nicht verursachen: Die Oberfläche lädt kein `web-vitals`,
keine Analytik und keine Fremdskripte (`app/server.py` setzt
`Content-Security-Policy: script-src 'self'`; im Markup stehen nur
`/theme-boot.js` und das eigene Vite-Bundle).

Prüfen lässt sich das in zwei Schritten:

```bash
# 1. DevTools zu (oder Inkognito-Fenster ohne Erweiterungen) → Fehler weg?
# 2. Seite laden und im Network-Panel nach fremden Skripten suchen:
curl -s http://<NAS>:1355/ | grep -o '<script[^>]*>'
```

Erscheint der Fehler auch ohne DevTools und ohne Erweiterungen, ist der
Initiator im Panel „Sources“ zu benennen — dann erst lohnt ein Ticket, und der
Stack gehört vollständig mitgeschickt. Andere Konsolen-Meldungen mit
`<anonymous>`-Frames aus `VM…`-Skripten sind nach derselben Regel zu
behandeln: ohne App-Frame (`assets/…-<hash>.js`) nicht die App.

## Speichermanagement (Pi shm + NAS SSD/HDD)

Siehe ausführlich [SPEICHER.md](SPEICHER.md) — Kurzfassung:

- **Pi `/dev/shm/tankapp`**: Ringpuffer 7 Tage, ~0,6 MB/Tag. Seit 13.09.2026 löscht der Collector Dateien, die vollständig vor `meta/synced_until` liegen (vom Uploader bestätigt) und älter als gestern sind — RAM sinkt auf ~1–2 Tage. Bei NAS-Ausfall weiter bis 7 Tage (FIFO). „Braucht es das alles? Nach Influx-Upload löschbar?“ → Ja, nach Ack, 1 Tag Rest bleibt.

- **NAS persistent**: Nicht nur Influx. `runtime/` (Jobs, `engine/current.json`, `selection/current.json`, `feedback/store.json`, Training-Cache) auf SSD, Roharchiv auf HDD, private Configs (`polling.json`, `influx.env`, `netrc`) auf SSD read-only. Influx selbst: `prices` + `collector_status`.

- **3,38 GB auf `/mnt/user/appdata` (SSD)**: Influx-Volume + Runtime. Auf HDD verschieben würde bedeuten: HDD wacht alle 30 s auf (Stations-Poll, Health, Overview-Tageskurve, Heatmap). Spindown wäre aus. Deshalb **Influx auf SSD lassen**, Archiv auf HDD (State liegt auf SSD, damit HDD nur bei Bedarf wacht).

- **SSD sparen**: Retention von 5 Jahren (43800h) auf 1 Jahr (8760h) kürzen (`docker exec tankapp-influxdb influx bucket update --org gtwrlab --name tankapp --retention 8760h`), Backups (`ops/nas/backup.sh` + Influx-Tar) auf HDD legen, `runtime/backtest-cache/` darf jederzeit gelöscht werden, optional `data-tools/prune_influx.py --older-than-days 365` für Delete-API.

Details, Befehle und HDD-Spindown-Checkliste: [SPEICHER.md](SPEICHER.md).

## M1 Abnahme 14 Tage

M1 erfüllt, wenn Collector+Ringpuffer+Uploader 14 Tage durchgelaufen und:

1. Datenlücken <2% (pro Station/Tag ~216 Polls erwartet, 14 Tage ~3000, ≥~2940 Punkte)
2. Ack-Protokoll fehlerfrei: keine verlorene Zeile, keine Duplikate — `meta/synced_until` stets ≥ zweit-neueste Pufferzeile, Punktezahl in InfluxDB stimmt mit Stations-Snapshots überein

Beide Dienste 14 Tage unbeaufsichtigt laufen lassen; wöchentlich Betrieb & Kontrolle durchgehen und Backup prüfen.
