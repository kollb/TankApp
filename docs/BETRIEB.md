# TankApp Betrieb — systemd, Backup, Fehlersuche

> Stand: 09.09.2026 — Konsolidiert aus INSTALL.md <details>-Block, collector/uploader Details, Unraid, Störungsfälle.
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
- [Backup & Wiederherstellung](#backup--wiederherstellung)
  - [Pi Sicherung](#pi-sicherung)
  - [NAS InfluxDB Backup](#nas-influxdb-backup)
- [Fehlersuche](#fehlersuche)
  - [Collector Störungsfälle](#collector-störungsfälle)
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
scp "docs\analysis\stations\polling.json" pi@<pi-ip>:~/TankApp/docs/analysis/stations/
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

1. Aktives `docs/analysis/stations/polling.json` vom Pi nach Aktivierung
2. `data/influx.env` mit Lesezugang (Nur-Lese-Token, URL = NAS-LAN-Adresse:8086, nicht localhost)
3. Archivzugang privat als `data/_netrc` oder `~/.netrc` (nicht Collector-Key). Ohne ihn startet Live-GUI trotzdem, aber keine Modelle.

Optional, für die Ereignis-Pipeline (Uploader-Webhook, siehe `docs/ARCHITEKTUR.md`):
`TANKAPP_WEBHOOK_TOKEN=<Secret>` exportieren, bevor `nas-up` das Compose-Projekt
baut/aktualisiert; denselben Wert auf dem Pi als `TANKAPP_NAS_WEBHOOK_TOKEN`
hinterlegen. Ohne Token bleibt der Trigger-Endpoint deaktiviert und die Jobs
laufen rein intervallbasiert weiter.

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
| Veröffentlichung | Erst nach fertiger Berechnung atomar ersetzen, alte Ergebnisse bei Fehlern behalten |
| Neustart | Docker restart unless-stopped, startet mit Docker, holt nach |

Keinen zusätzlichen cron einrichten, gebündelter Dienst übernimmt Zeitplanung. Bereits eingerichtete history-sync/model cron deaktivieren. history-sync bleibt als Einzelwerkzeug.

Archivumfang Standard 365 Tage, für 730: `--history-days 730`. Genug Speicher (nationale Tagesdateien). Modelle verwenden kleineren Ausschnitt (42 Tage Training, 120 Tage Export).

Modellumfang: zunächst e10, bei Bedarf `--model-fuels e10,e5,diesel`.

Archiv und Polling sind dieselben Marktdaten über zwei Bezugswege. Historie kann Modellstart tragen, keine 3-Monats-Wartepflicht. Standardtraining letzte 42 Tage, Archiv nur vor Live-Beginn. Nach 90 vollständigen Live-Tagen mit 95% Abdeckung je UUID/Kraftstoff auf Polling-only umstellbar. NAS-Roharchiv bleibt bestehen.

## Backup & Wiederherstellung

### Pi Sicherung

Code liegt auf GitHub, aber gitignored Dateien existieren nur auf Pi, müssen ins Backup (z. B. smart_backup.sh):

| Was | Pfad | Inhalt |
|---|---|---|
| API-Key | `~/TankApp/data/apikey.txt` | Tankerkönig-Key chmod 600 |
| Polling-Set | `~/TankApp/docs/analysis/stations/polling.json` | 10 UUIDs + private Koordinaten |
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
cp ~/TankApp/docs/analysis/stations/polling.json "$TARGET/tankapp/polling.json"
cp /etc/systemd/system/tankapp-collector.service "$TARGET/tankapp/" 2>/dev/null
cp /etc/systemd/system/tankapp-uploader.service "$TARGET/tankapp/" 2>/dev/null
cp /etc/tankapp/env "$TARGET/tankapp/env" 2>/dev/null && chmod 600 "$TARGET/tankapp/env"
```

Restore: Repo klonen, Dateien zurückkopieren, Units nach `/etc/systemd/system/`, `/etc/tankapp/env` mit `chown pi:pi` + `chmod 600`, tmpfs-Zeile ergänzen, `systemctl enable --now tankapp-collector tankapp-uploader`. Key `pi:pi` chmod 600. Für RAM-Puffer `uid=pi,gid=pi` Variante praktisch.

### NAS InfluxDB Backup

Ringpuffer auf Pi bewusst nicht sichern. Wöchentliches Tar-Backup des InfluxDB-Volumes per cron auf NAS:

```cron
0 3 * * 0 cd $HOME/TankApp/ops/nas/influxdb && docker run --rm \
    -v tankapp_influxdb_data:/data -v $PWD/backup:/backup alpine \
    tar czf /backup/influxdb-$(date +\%F).tar.gz -C /data .
```

Restore:

```bash
docker run --rm -v tankapp_influxdb_data:/data -v $PWD/backup:/backup alpine \
    tar xzf /backup/influxdb-<datum>.tar.gz -C /data
docker compose up -d
```

Org/Bucket/Token sind im Volume enthalten.

## Fehlersuche

### Collector Störungsfälle

| Log-Meldung | Bedeutung / Aktion |
|---|---|
| `HTTP 429` | API-Limit (1/5min) — wartet 60s |
| `no prices` | Station meldet keine Preise; nach 7 Polls (~35min) Alarm |
| `Fenster zu … schlafe` | normal 00–06 Uhr |
| `parameter error` | ids ODER apikey leer — siehe Diagnose unten |
| `Key existiert nicht` | Key unbekannt/deaktiviert → tankerkoenig.de prüfen |
| `nicht im korrekten Format` | polling.json enthält kaputte UUIDs |
| `⚠ … UUIDs haben kein gültiges Format` | Collector überspringt kaputte UUIDs → polling.json neu erzeugen |
| `⚠ API-Key sieht nicht nach einer UUID aus` | apikey.txt enthält mehr als nackten Key → nur 36 Zeichen |
| `⚠ Proxy-Umgebung gesetzt` | http_proxy/https_proxy gesetzt, kann Aufruf verfälschen |
| `Puffer … nicht beschreibbar` / PermissionError 13 | /dev/shm/tankapp gehört root, Dienst pi → `sudo chown pi:pi /dev/shm/tankapp` |
| Dienst startet nicht | `journalctl -u tankapp-collector -n 50`; meist fehlt polling.json oder Key |

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
p = json.load(open("/home/pi/TankApp/docs/analysis/stations/polling.json"))
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

## M1 Abnahme 14 Tage

M1 erfüllt, wenn Collector+Ringpuffer+Uploader 14 Tage durchgelaufen und:

1. Datenlücken <2% (pro Station/Tag ~216 Polls erwartet, 14 Tage ~3000, ≥~2940 Punkte)
2. Ack-Protokoll fehlerfrei: keine verlorene Zeile, keine Duplikate — `meta/synced_until` stets ≥ zweit-neueste Pufferzeile, Punktezahl in InfluxDB stimmt mit Stations-Snapshots überein

Beide Dienste 14 Tage unbeaufsichtigt laufen lassen; wöchentlich Betrieb & Kontrolle durchgehen und Backup prüfen.
