# TankApp Betrieb — systemd, Backup, Alarme, Fehlersuche

> Stand: 12.09.2026 · App-Version 0.10.1 — alles, was nach der Ersteinrichtung
> wiederkehrt. Ersteinrichtung selbst: [INSTALL.md](INSTALL.md).
> Neu seit 0.10.0: aggregierter Alarm-Block in `/health` (roter/gelber Punkt im
> GUI-Header), `runtime/`-Backup per `ops/nas/backup.sh`, Version + Commit-Hash
> in `/health` und im GUI-Footer, Beleg-Storno und CSV-Export der Tankbelege.
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
  - [Modell-Lauf beobachten](#modell-lauf-beobachten)
  - [Wann erscheinen die 08:00-Zeilen im Scoreboard?](#wann-erscheinen-die-0800-zeilen-im-scoreboard)
  - [Lauf manuell anstoßen](#lauf-manuell-anstoßen)
  - [Fehlgeschlagener Lauf: Ursache statt Raten](#fehlgeschlagener-lauf-ursache-statt-raten)
  - [Modell-Lauf beschleunigen](#modell-lauf-beschleunigen)
- [Backup & Wiederherstellung](#backup--wiederherstellung)
  - [Pi Sicherung](#pi-sicherung)
  - [NAS InfluxDB Backup](#nas-influxdb-backup)
  - [NAS Laufzeitdaten (runtime/) Backup](#nas-laufzeitdaten-runtime-backup)
- [System-Alarme lesen](#system-alarme-lesen)
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
3. **Log**: `docker logs -f tankapp-app` bzw. `journalctl -u tankapp -f`
   **und** zusätzlich als Datei `data/runtime/jobs/models.log`
   (letzte 500 Zeilen, auch ohne Docker-Zugriff lesbar).
4. **Log im GUI/per API** (B6): System-Tab → „Job-Log“ (Umschalter
   Archiv-Sync / Modell-Update / Selektion / Beleg-Verarbeitung, 100–500
   Zeilen, alle 15 s neu, solange ein Job läuft) bzw.
   `GET /api/v1/jobs/<job>/log?lines=200`. Der Sprung direkt dorthin geht
   über das Log-Symbol in der jeweiligen Job-Karte.

```bash
# Fortschritt live
docker logs -f tankapp-app | grep models
# oder ohne Docker
tail -f data/runtime/jobs/models.log
# Status auf einen Blick
cat data/runtime/jobs/models.progress.json
# Log per API (ohne Terminal auf dem NAS)
curl -s "http://<nas>:1355/api/v1/jobs/models/log?lines=200" | jq -r '.lines[]'
```

Typische Dauer nach der Beschleunigung (B5): **~14 s je Station** statt
rund 3 Minuten; 10 Stationen auf 4 Kernen damit unter einer Minute.

### Wann erscheinen die 08:00-Zeilen im Scoreboard?

Das Scoreboard („Entscheidungs-Scoreboard · Out-of-Sample“) und die
Regel-Ergebnis-Kachel füllen sich erst, wenn zwei Dinge zusammenkommen:

1. **Der Modell-Job ist einmal erfolgreich durchgelaufen** (siehe oben:
   Phase „Modelle fitten + Backtest“).
2. **Es liegt genug echte Preishistorie vor.** Der Backtest bewertet tägliche
   08:00-Entscheidungen rollierend über die letzten 7 Tage je Station. Ist
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

### Modell-Lauf beschleunigen

Zwei Stellschrauben, beide ohne Änderung der Ergebnisse:

| Hebel | Wirkung |
|---|---|
| `TANKAPP_MODEL_WORKERS` | Prozesse für Fit/Prognose/Backtest. `0` (Default) = automatisch, maximal 8 (bzw. CPU-Kerne); `1` = seriell. Stationen und Horizonte sind unabhängig — der Lauf ist „peinlich parallel“. Ohne nutzbaren Prozess-Pool rechnet die App automatisch seriell weiter. |
| `TANKAPP_CITY_SUBDIVS` | Bundesländer für den gepoolten Feiertags-Dummy, z. B. `Frankfurt:HE;Gütersloh:NW`. Ohne Wert bleibt der Dummy bewusst null. `nas-up` reicht den Wert über Compose in den App-Container durch. |
| Engine-Fix der 12-Uhr-Projektion | Vor B5 baute die Projektion je Rasterpunkt ein `pd.Timestamp` (≈8 Mio. Boxing-Operationen pro 7-Tage-Prognose). Jetzt vektorisiert: 24-h-Prognose 12,4 s → 0,8 s, 7-Tage 82 s → 4,9 s, Backtest 44 s → 6,4 s — **bitgleich** zu vorher (geprüft gegen die alte Implementierung). |

```bash
# NAS: vier Prozesse und die Bundesländer der Städte explizit setzen
TANKAPP_MODEL_WORKERS=4 \
TANKAPP_CITY_SUBDIVS="Frankfurt:HE;Gütersloh:NW" \
python3 tankapp.py nas-up
```

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

### NAS Laufzeitdaten (runtime/) Backup

Das InfluxDB-Volume sichert die **Preise** — nicht die persönliche Tank-Bilanz.
Die liegt in `runtime/` (Feedback-Store, Selektion, Job-Stände) und wird bisher
nicht gesichert. Ein NAS-Disk-Crash wäre der Verlust der Bilanz. Täglich sichern:

```cron
30 3 * * * TANKAPP_RUNTIME_DIR=/data/runtime TANKAPP_BACKUP_DIR=/pfad/zu/backup $HOME/TankApp/ops/nas/backup.sh
```

`TANKAPP_RUNTIME_DIR` ist das in `compose.yml` gemountete `runtime/`-Verzeichnis
(siehe `tankapp.py nas-up`), `TANKAPP_BACKUP_DIR` das vorhandene Backup-Ziel.
Das Skript erzeugt `tankapp-runtime-<datum>.tar.gz` und behält 14 Tage
(`TANKAPP_BACKUP_KEEP_DAYS` anpassbar).

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

## System-Alarme lesen

`GET /api/v1/health` fasst die vorhandenen Zustandsprüfungen zu einem
`alarms[]`-Block zusammen (`app/alarms.py`). Bewusst **ohne** neue Netz- oder
InfluxDB-Zugriffe, damit der Docker-Healthcheck im 3–5-s-Budget bleibt. Die GUI
zeigt daraus einen Punkt im Header aller Tabs: **rot** bei `severity: "error"`,
**gelb** bei `"warn"`, grün ohne Alarm; der Tooltip listet die Meldungen im
Klartext.

| `code` | Schwere | Bedeutung | Erste Aktion |
|---|---|---|---|
| `polling_missing` | error | gemeinsames Polling-Set fehlt | `docs/analysis/stations/polling.json` vom Pi bereitstellen → [INSTALL.md](INSTALL.md#private-dateien) |
| `polling_invalid` | error | Polling-Set ungültig (Format, leere/doppelte Sets) | Set prüfen und neu aufbauen → [STATIONEN-TAUSCH.md](STATIONEN-TAUSCH.md) |
| `collector_no_heartbeat` | error | noch kein Herzschlag des Pi auf dem NAS | Uploader + Heartbeat prüfen → [Heartbeat B3.11](#heartbeat-b311) |
| `collector_stale` | warn | Herzschlag älter als 15 min — Preise können eingefroren sein | `systemctl status tankapp-collector tankapp-uploader` auf dem Pi |
| `job_failed` (mit `job`) | error | NAS-Job `archive`, `models`, `selection` oder `settlement` ist fehlgeschlagen | Ursache im Job-Log → [Fehlgeschlagener Lauf](#fehlgeschlagener-lauf-ursache-statt-raten) |
| `store_too_large` | error | persönlicher Feedback-Store über der Größen-Grenze — neue Belege werden abgelehnt | Restore/Retention → [NAS Laufzeitdaten](#nas-laufzeitdaten-runtime-backup) |
| `store_growing` | warn | Store über 80 % der Grenze | 90-Tage-Retention prüfen, Bilanz sichern: `GET /api/v1/fills.csv` |

Ein Alarm ist eine **Zusammenfassung**, keine neue Prüfung: Dieselbe Information
steht auch in den Fach-Endpunkten (`/api/v1/collector/status`,
`/api/v1/jobs/<job>/log`, `/api/v1/stats/summary`). Wer nur einen einzigen Check
im Haushalt laufen lassen will, pollt `/health` und schaut auf `alarms`.

Offen (siehe [TODO B4/B8](../TODO.md)): optionale Benachrichtigung per ntfy und
Webhook-Retry Pi → NAS — heute ist `POST /api/v1/jobs/trigger` Fire-and-Forget.

### Version und Build-Hash prüfen

`GET /api/v1/health` liefert `version` (z. B. `0.10.1`, gepflegt in
`app/version.py`) und `commit` (Kurzhash des Checkouts). Beide Werte stehen auch
im GUI-Footer. Bei drei Oberflächen — NAS-GUI, RP2-Proxy/Fallback, Collector auf
dem Pi — ist das die Antwort auf „was läuft hier eigentlich?“:

```bash
curl -s http://<NAS>:1355/api/v1/health |
  python3 -c 'import json,sys; h=json.load(sys.stdin); print(h["version"], h["commit"], [a["code"] for a in h["alarms"]])'
```

Im Docker-Image ist `commit` `null`, weil das Image kein `.git` enthält; bei
Bedarf `TANKAPP_BUILD_COMMIT=<hash>` als Umgebung für den Container setzen
(`app/version.py` liest sie beim Import). Die RP2-Fallback-GUI trägt einen
eigenen Template-Hash-Marker → [RP2.md](RP2.md#template-updates). Änderungen je
Version: [CHANGELOG](../CHANGELOG.md).

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

**Live-Ansicht („Heute im Überblick")** liest direkt aus InfluxDB — also nur die
echten Polls des Pi. Ein wegen eines Ausfalls verpasster Poll lässt sich dort
**nicht** nachträglich einspielen; die Lücke bleibt in der Live-Kurve, bis das
Polling wieder normal läuft. Wichtig ist allein, das Polling-Set zu reparieren
(polling.json neu aus der geprüften Vorlage aufbauen und mit
`python3 -m json.tool docs/analysis/stations/polling.json` prüfen), damit die
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
Backtest (08:00-Entscheidungszeilen im Scoreboard). Das Nachladen schreibt
**nicht** in InfluxDB — die Live-Kurve bleibt unverändert.

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
