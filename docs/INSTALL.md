# Installation & Betrieb (Erstinstallation)

Diese Anleitung sagt **was wo läuft** und mit **welchen Kommandos**.
Stand 07.09.2026: Collector/Uploader befüllen laut Betreiber InfluxDB; M2
gilt vorläufig als erledigt. **Weiter mit M3 am Windows-PC:**
[PowerShell-Anleitung](../engine/README.md) bzw. Phase D (§4) unten.
API/Homepage folgen mit beiden vorhandenen GUIs als Basis (Konzept §8/§13).

**Wenn Collector/InfluxDB und M2 schon laufen, Phasen A–C nicht erneut einrichten.**
Mit den vorhandenen Analyse-CSVs kannst du M3 direkt am PC testen; ein
InfluxDB-Export ist optional und benötigt einen eigenen Lese-Token.

## 0. Kurzantwort: Was läuft wo?

| Baustein | Gerät | Status |
|---|---|---|
| Analyse/Pipeline (Historie holen, Stationen auswählen) | **PC (Windows)** — Einmal-/Werkstatt-Läufe | ✅ fertig |
| **M1 Collector** (Preise pollt, JSONL-Ringpuffer) | **Raspberry Pi** — 24/7 | ✅ fertig (`data-tools/collect_prices.py`) |
| Kurzzeit-Puffer (7 Tage) | **Pi: RAM** (`/dev/shm/tankapp`, tmpfs → SD-Schonung) | ✅ über Ringpuffer gelöst |
| **M1 Uploader** (JSONL → InfluxDB, Ack-Protokoll) | **Pi** — systemd (`tankapp-uploader.service`) | `data-tools/upload_influx.py`, Phase C; neue Punkte zusätzlich mit `station_id`-Tag. Bestehende Installationen: [UUID-Umstellung](STATIONS-UUID.md). |
| Langzeit-Speicher (InfluxDB) | **NAS** (192.168.178.61, Org `gtwrlab`, Bucket `tankapp`) | ✅ läuft (Bucket/Token: Phase C §3.1) |
| M3-Tests / Fits / Backtests | **Windows-PC** (NAS alternativ möglich) | PowerShell-Ablauf in Phase D / `engine/README.md`; noch unkalibriert |
| Homepage / API | Pi | Geplant; beide GUI-Vorlagen bleiben erhalten |

**Faustregel:** Der Collector gehört auf den Pi. Er läuft 24/7, braucht
keine SD-Schreibzugriffe (Puffer im RAM) und nur ~40–60 MiB — reine
Python-Standardbibliothek, kein `pip install`. Das NAS wird in Phase C
(§3) eingerichtet: InfluxDB per Docker; der Uploader — zweite systemd-
Service auf demselben Pi — schiebt den Ringpuffer dorthin (idempotent,
überbrückt NAS-Ausfall bis 7 Tage). Der PC bleibt die „Werkstatt" für
Einmal-Analysen und läuft **nicht** dauernd mit (~50–90 W Leerlauf vs.
Pi ~3 W).

> Übergangslösung, bevor ein Pi vorhanden ist: der Collector läuft auch
> auf dem Windows-PC (Puffer dann unter `data\poll\` auf der Platte).
> Ein Rechner, der nachts aus ist, verpasst Polls — für den ersten
> Live-Test ist es aber völlig ausreichend.

---

## 1. Phase A — Werkstatt auf dem PC (einmalig)

Ziel: das Polling-Set (`polling.json`) erzeugen, das der Collector
hinterher braucht.

### 1.1 Voraussetzungen

```powershell
py -3 --version        # Auf dem PC 3.11+ für M3; der Pi-Collector bleibt bei seiner bisherigen Version
```

Analyse-Abhängigkeiten (nur für die Pipeline, nicht für den Collector):

```powershell
cd "G:\Meine Ablage\dev\TankApp"
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r analysis\requirements.txt
```

### 1.2 Anker & Tagesliste

- Heimkoordinaten in `analysis\config.local.json`
  (Vorlage: `analysis\config.local.example.json`).
  Koordinaten nur in dieser privaten Datei eintragen, nicht im Repository dokumentieren.
- Historische Tagesliste holen (Anleitung: `docs/DATEN-BEZUG.md`,
  Windows-Kapitel 11.1).

### 1.3 Pipeline laufen lassen

```powershell
.\.venv\Scripts\python.exe .\data-tools\run_pipeline.py --router osrm --skip-fetch --skip-ingest --near-km 5 --near-n 3 --leader-max-km 10
```

Ergebnis (gitignored, enthält private Koordinaten):
`docs\analysis\stations\polling.json` mit den 10 Polling-Stationen je Stadt.

### 1.4 Tankerkönig-API-Key auf dem PC

**Vorhandene `data\apikey.txt` weiterverwenden, nicht überschreiben.**
Der Collector liest sie automatisch. Es ist der Tankerkönig-Key für aktuelle
Preise, kein InfluxDB-Token; M3 mit vorhandenen CSV-Dateien braucht ihn nicht.

```powershell
Test-Path .\data\apikey.txt
```

Falls noch kein Key vorhanden ist: auf <https://www.tankerkoenig.de/> registrieren
und die private Datei in Notepad anlegen:

```powershell
New-Item -ItemType Directory -Force -Path .\data | Out-Null
notepad .\data\apikey.txt
```

Nur den echten Key als eine Zeile speichern, UTF-8 ohne BOM, keine
Anführungszeichen. Keine Dummy-UUID über eine bestehende Schlüsseldatei schreiben
und den Inhalt nicht im Terminal ausgeben. `data\` ist gitignored.
Die Suchreihenfolge bleibt `--api-key` → `TANKERKOENIG_API_KEY` → Datei.

### 1.5 Optionaler Collector-Einzeltest auf dem PC

**Nicht für die M3-Backtests nötig.** Wenn der Pi denselben Key nutzt,
seinen Collector für diesen optionalen Einzeltest pausieren: mindestens
300 Sekunden nach dem letzten Pi-Request warten und nach dem PC-Test wieder
mindestens 300 Sekunden bis zum nächsten Request einhalten. Keinen zweiten
Dauer-Collector daneben starten. Für normale M3-Läufe bleibt der Pi unverändert an.

```powershell
# Nur diese PC-Sitzung: vorhandene Umgebungsvariable würde die Datei übersteuern
Remove-Item Env:\TANKERKOENIG_API_KEY -ErrorAction SilentlyContinue
py -3 .\data-tools\collect_prices.py --once --out .\data\pc-test-poll
```

Bei mehreren Polling-Sets `--poll-city Frankfurt` bzw. den tatsächlichen
Set-Schlüssel ergänzen. Bei Erfolg: Preistabelle und `Poll ok: …` mit JSONL-Datei
im **separaten** `data\pc-test-poll\`. Der produktive Uploader darf dieses
Verzeichnis nicht einlesen. `false` wird nicht als Preis 0 geschrieben;
`closed`/`no prices` bleiben ohne Preis. Bei API-Fehlern kann auch `--once`
wiederholen; bei Bedarf mit Strg+C abbrechen.

Ein Poll liefert keine mehrwöchige Trainingshistorie. Die M3-Schritte in Phase D
verwenden die vorhandenen Analyse-CSVs oder einen InfluxDB-Export, nicht diesen
JSONL-Testpuffer. Weitere Windows-Details: [M3-Anleitung §7](../engine/README.md).

---

## 2. Phase B — Collector auf dem Raspberry Pi (24/7)

Getestet mit Raspberry Pi OS (Lite reicht), Python 3.9+ ist vorinstalliert.

### 2.1 Repo auf den Pi bringen

```bash
# auf dem Pi
sudo apt update && sudo apt install -y git python3
git clone https://github.com/kollb/TankApp.git ~/TankApp
cd ~/TankApp
```

### 2.2 Die zwei privaten Dateien auf den Pi kopieren

Repo + Code kommen von GitHub — zwei Dateien sind gitignored und müssen
**manuell** vom PC auf den Pi (z. B. per `scp`/Freigabe):

```powershell
# vom Windows-PC aus:
scp "docs\analysis\stations\polling.json" pi@<pi-ip>:~/TankApp/docs/analysis/stations/
scp "data\apikey.txt" pi@<pi-ip>:~/TankApp/data/
```

Alternative ohne Key-Datei: Key in die systemd-Umgebung (2.4).

### 2.3 RAM-Puffer (tmpfs) — SD-Karte schonen

```bash
# Puffer-Verzeichnis im RAM anlegen und beim Booten mounten
sudo mkdir -p /dev/shm/tankapp
echo 'tmpfs  /dev/shm/tankapp  tmpfs  defaults,noatime,size=32M,mode=0755  0  0' | sudo tee -a /etc/fstab
sudo mount /dev/shm/tankapp
```

> ⚠️ **Eigentümer!** Das Verzeichnis gehört nach `sudo mkdir -p` dem User
> `root`, der Dienst läuft aber als `pi` → beim Schreiben kommt
> `PermissionError: [Errno 13] Permission denied`. Eigentümer korrigieren:
>
> ```bash
> sudo chown pi:pi /dev/shm/tankapp        # Dienst-User = pi
> ```
>
> Der Collector prüft die Schreibbarkeit jetzt beim Start und meldet das
> klar („Puffer … nicht beschreibbar“), statt beim ersten Poll abzustürzen.

32 MiB reichen weit: ~0,6 MB JSONL pro Tag, Ringpuffer hält 7 Tage.
SD-Härtung zusätzlich (optional, Konzept §9.3): `vm.swappiness=10`.

### 2.4 systemd-Dienst (startet automatisch, startet bei Absturz neu)

```bash
sudo tee /etc/systemd/system/tankapp-collector.service > /dev/null <<'UNIT'
[Unit]
Description=TankApp M1 Preis-Collector (Tankerkoenig)
After=network-online.target time-sync.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/TankApp
# API-Key alternativ hier statt data/apikey.txt (Datei mit chmod 600 bevorzugen):
# Environment=TANKERKOENIG_API_KEY=00000000-0000-0000-0000-000000000000
Environment=TANKAPP_POLL_DIR=/dev/shm/tankapp
ExecStart=/usr/bin/python3 /home/pi/TankApp/data-tools/collect_prices.py
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now tankapp-collector
```

> ⚠️ **Wichtig:** `daemon-reload` + `enable --now` starten einen bereits
> laufenden Dienst **nicht neu**. Nach jeder Änderung an der Unit (z. B.
> `TANKAPP_POLL_DIR`) oder an `polling.json`/`apikey.txt` deshalb:
>
> ```bash
> sudo systemctl restart tankapp-collector
> ```

Key als Datei sicherer als in der Unit:

```bash
chmod 600 ~/TankApp/data/apikey.txt
```

### 2.5 Betrieb & Kontrolle

```bash
systemctl status tankapp-collector     # läuft er?
journalctl -u tankapp-collector -f     # Live-Log (Polls alle 5 min, 06–24 Uhr)
ls -la /dev/shm/tankapp/               # Snapshots: YYYY-MM-DD.jsonl
tail -f /dev/shm/tankapp/$(date +%F).jsonl
```

Außerhalb des Fensters (00–06 Uhr) schläft der Collector und loggt das;
er pollt automatisch wieder ab 06 Uhr. Manueller Testpoll:

```bash
python3 data-tools/collect_prices.py --once --out /dev/shm/tankapp
python3 data-tools/collect_prices.py --demo --once --out data/test-poll  # isoliert, nie hochladen
```

Aktualisieren, wenn sich das Polling-Set ändert (neue `polling.json`
nach `scp`):

```bash
sudo systemctl restart tankapp-collector
```

Code aktualisieren: `git pull` im Repo, dann ebenfalls Restart.

### 2.6 Störungsfälle

| Log-Meldung | Bedeutung / Aktion |
|---|---|
| `HTTP 429` | API-Limit (1 Request/5 min) — Collector wartet automatisch 60 s und wiederholt |
| `no prices` (Station) | Station meldet gerade keine Preise; nach **7 Polls** (~35 min) Alarm im Log → Station prüfen (Urlaub/Baustelle) |
| `Fenster zu … schlafe` | normal zwischen 00 und 06 Uhr |
| `parameter error` | **ids ODER apikey kamen leer bei der API an** — siehe Fehlerdiagnose unten |
| `Key existiert nicht oder ist deaktiviert` | Key in `data/apikey.txt` unbekannt/nicht aktiviert → bei tankerkoenig.de prüfen |
| `eine oder mehrere Tankstellen-IDs nicht im korrekten Format` | `polling.json` enthält UUIDs außerhalb des Formats `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `⚠ … UUIDs haben kein gültiges UUID-Format` | Collector hat beim Start kaputte UUIDs erkannt und übersprungen → `polling.json` neu erzeugen |
| `⚠ API-Key sieht nicht nach einer UUID aus` | `apikey.txt` enthält mehr als den nackten Key (Label/Kommentar?) → nur den 36-Zeichen-Key in eine Zeile |
| `⚠ Proxy-Umgebung gesetzt` | `http_proxy`/`https_proxy` ist gesetzt; ein Proxy kann den API-Aufruf verfälschen (s. u.) |
| `Puffer … nicht beschreibbar` / `PermissionError: [Errno 13]` | `/dev/shm/tankapp` gehört `root`, Dienst läuft als `pi` → `sudo chown pi:pi /dev/shm/tankapp` (s. 2.3) |
| Dienst startet nicht | `journalctl -u tankapp-collector -n 50`; meist fehlt `polling.json` (2.2) oder der Key |

### 2.7 Fehlerdiagnose „parameter error“

Die Tankerkönig-API antwortet `ok=false` mit `parameter error` **nur**, wenn
`ids` oder `apikey` **leer/fehlend** ankommen (ein falscher Key ergibt
„Key existiert nicht…“, eine kaputte UUID „…nicht im korrekten Format“).
Der Collector sendet immer beide Parameter — also nacheinander prüfen:

```bash
# 1) Was steht wirklich im Polling-Set?
python3 - <<'PY'
import json
p = json.load(open("/home/pi/TankApp/docs/analysis/stations/polling.json"))
s = next(iter(p["sets"].values()))
print("label:", s.get("label"))
print("batch:", s.get("batch"))
PY

# 2) Enthält apikey.txt GENAU eine Zeile mit dem 36-Zeichen-Key?
#    (zeigt nur Zeilenanzahl und Länge, niemals den Key)
python3 - <<'PY'
from pathlib import Path
k = Path("/home/pi/TankApp/data/apikey.txt").read_text().strip().splitlines()
print("Zeilen:", len(k), "| Länge von Zeile 1:", len(k[0]) if k else 0)
PY

# 3) Läuft der Dienst noch mit der ALTEN Konfiguration? (Unit geändert → neu starten)
systemctl status tankapp-collector | head -3
sudo systemctl restart tankapp-collector

# 4) Direkter API-Test mit dem echten Key (rohe Antwort ansehen):
#    IDs aus Schritt 1, Key aus apikey.txt einsetzen.
curl -s "https://creativecommons.tankerkoenig.de/json/prices.php?ids=<uuid1>,<uuid2>&apikey=<KEY>"
#    -> {"ok":true,…}                alles gut, Problem lag an alter Konfiguration
#    -> {"ok":false,"message":"parameter error"}            ids oder apikey leer
#    -> {"ok":false,"message":"Key existiert nicht …"}      Key falsch/inaktiv
#    -> {"ok":false,"message":"… nicht im korrekten Format"} UUID kaputt

# 5) Proxy? urllib nutzt http_proxy/https_proxy — ein Filter-/Tunnel-Proxy
#    kann den Query-String verstümmeln.
env | grep -i proxy
sudo systemctl show tankapp-collector -p Environment
```

Häufigster Fall in der Praxis: Der Dienst lief noch mit der **alten** Unit/
dem **alten** Key (siehe 2.4: erst `systemctl restart`!) oder `apikey.txt`
war leer bzw. enthielt nur den Platzhalter aus dem Beispiel.

### 2.8 Sicherung & Wiederherstellung des Pi

Der Code liegt auf GitHub, aber **einige Dateien sind gitignored** und
existieren nur auf dem Pi. Sie müssen ins Pi-Backup (z. B.
`smart_backup.sh` aufs NAS) aufgenommen werden, sonst sind Collector
**und Uploader** nach einem Restore lahm:

| Was | Pfad | Inhalt |
|---|---|---|
| API-Key | `~/TankApp/data/apikey.txt` | privater Tankerkönig-Key (chmod 600) |
| Polling-Set | `~/TankApp/docs/analysis/stations/polling.json` | die 10 UUIDs + private Koordinaten |
| systemd-Unit | `/etc/systemd/system/tankapp-collector.service` | Custom-Unit (Environment) |
| systemd-Unit | `/etc/systemd/system/tankapp-uploader.service` | Uploader-Service (Phase C) |
| InfluxDB-Zugang | `/etc/tankapp/env` | Uploader-URL/Org/Bucket/**Token** (chmod 600) |
| tmpfs-Zeile | `/etc/fstab` (Zeile `/dev/shm/tankapp`) | RAM-Puffer-Mount |

**Bewusst NICHT sichern:** `/dev/shm/tankapp/*.jsonl` — das ist der 7-Tage-
Ringpuffer im RAM, er wird nach einem Neustart ohnehin neu aufgebaut. Die
Langzeit-Historie liegt in der InfluxDB auf dem NAS (der Uploader liefert
sie in Echtzeit nach).

Minimal-Snippet fürs Backup-Skript:

```bash
mkdir -p "$TARGET/tankapp"
cp ~/TankApp/data/apikey.txt "$TARGET/tankapp/apikey.txt"
cp ~/TankApp/docs/analysis/stations/polling.json "$TARGET/tankapp/polling.json"
cp /etc/systemd/system/tankapp-collector.service "$TARGET/tankapp/" 2>/dev/null
cp /etc/systemd/system/tankapp-uploader.service "$TARGET/tankapp/" 2>/dev/null
cp /etc/tankapp/env "$TARGET/tankapp/env" 2>/dev/null && chmod 600 "$TARGET/tankapp/env"
```

Beim Restore: Repo klonen (`git clone`/`git pull`), die Dateien
zurückkopieren, beide Units nach `/etc/systemd/system/` legen,
`/etc/tankapp/env` mit `chown pi:pi` + `chmod 600` anlegen, tmpfs-Zeile in
`/etc/fstab` ergänzen und `systemctl enable --now tankapp-collector`.
Den Uploader erst starten, wenn `upload_influx.py` im Repo liegt
(nach dem PR-Merge) UND `/etc/tankapp/env` existiert:
`systemctl enable --now tankapp-uploader`.
Der Key gehört `pi:pi` mit `chmod 600`. Für den RAM-Puffer ist die
`uid=pi,gid=pi`-Variante praktisch, dann entfällt das `chown` nach jedem
Boot:

```
tmpfs  /dev/shm/tankapp  tmpfs  defaults,noatime,size=32M,uid=pi,gid=pi  0  0
```

---

## 3. Phase C — NAS + Uploader (InfluxDB)

Der Collector bleibt unverändert. Neuer Baustein: der **Uploader** läuft als
zweite systemd-Service **auf demselben Pi** (Konzept §9.1). Er liest dieselben
JSONL-Zeilen aus dem Ringpuffer, schiebt die noch nicht bestätigten Zeilen an
die InfluxDB auf dem NAS und schiebt das Ack
(`<puffer>/meta/synced_until`) **erst nach erfolgreichem Write** weiter.
NAS-Ausfall wird so bis zur 7-Tage-Ringpuffertiefe überbrückt (Überlauf FIFO
+ Alarm ab 6 Tagen); neu gesendete Zeilen sind harmlos, weil InfluxDB-Punkte
ihre Identität (Measurement+Tags+Timestamp) mitbringen (idempotent, §1.2).

### 3.1 InfluxDB auf dem NAS (einmalig)

**InfluxDB läuft bereits** auf dem NAS (192.168.178.61, Org `gtwrlab`,
u. a. mit dem `smarthome`-Bucket). Deshalb: **keine zweite Instanz**
aufsetzen, TankApp bekommt nur ein **eigenes Bucket** + **eigenes
Least-Privilege-Token** in der bestehenden Instanz — das `smarthome`-Bucket
bleibt unberührt (der Uploader schreibt mit Precision `ns` nur ins eigene
Bucket; die bestehende Writer-Konfiguration ändert sich nicht).

```bash
# Auf dem NAS. Zuerst den Container-Namen herausfinden:
docker ps | grep -i influx
# (hier: Influxdb — Groß-/Kleinschreibung zählt!)

# WICHTIG: Die CLI IM Container hat kein Token gespeichert — ohne das
# Admin-Token der bestehenden InfluxDB kommt "401 Unauthorized" (bei
# "failed to lookup org …"). Admin-Token heraussuchen: .env der
# bestehenden Instanz (INFLUXDB_ADMIN_TOKEN bzw.
# DOCKER_INFLUXDB_INIT_ADMIN_TOKEN) oder Web-UI (http://192.168.178.61:8086
# → Security → API-Tokens). Einmalig speichern:
docker exec Influxdb influx config set-token <ADMIN-TOKEN>

# Bucket + Token für TankApp:
docker exec Influxdb influx bucket create \
    --org gtwrlab --name tankapp --retention 43800h     # ≈ 5 Jahre
docker exec Influxdb influx auth create \
    --org gtwrlab --read-bucket tankapp --write-bucket tankapp \
    --description "tankapp-uploader (Pi)"

# Check:
docker exec Influxdb influx bucket list --org gtwrlab
docker exec Influxdb influx auth list --org gtwrlab
# → das ausgegebene NEUE Token gehört auf den Pi nach /etc/tankapp/env
#   (§3.2), nie ins Repo.
```

> Wer das Admin-Token nicht in der CLI speichern will: jedem Befehl
> `--token <ADMIN-TOKEN>` anhängen. Admin-Token vergessen? Mit dem
> Admin-USER (Passwort) in der Web-UI anmelden und dort ein neues Token
> anlegen — die bestehenden Daten bleiben dabei unberührt.

**Alternativ komplett per Web-UI (ohne CLI):**

1. http://192.168.178.61:8086 — mit dem Admin-User (Passwort) anmelden.
2. **Load Data → Buckets → Create Bucket** (ältere UI: „Data“):
   Name `tankapp`, Organisation `gtwrlab`, Retention `43800h` (≈ 5 Jahre).
3. **Security → API Tokens → Create Token** (ältere UI: „Users & Tokens“):
   Name `tankapp-uploader (Pi)`, Typ **Custom**, Ablauf **Never Expires**,
   Organisation `gtwrlab`; Berechtigung hinzufügen: Bucket `tankapp` →
   **Read buckets** + **Write points** → Generate Token.
4. **Token sofort kopieren** (nur einmalig angezeigt!) → gehört in
   `/etc/tankapp/env` auf dem Pi (§3.2).

> `docker compose exec <service> influx …` (oder `docker-compose exec …` bei
> Compose v1) ginge auch, aber nur, wenn Compose installiert ist — auf
> Synology-NAS oft nicht. Plain `docker exec` funktioniert immer.

> Die InfluxDB-Web-UI (http://192.168.178.61:8086) dient nur der Diagnose —
> der Pi nutzt sie nie, er schreibt ausschließlich mit dem Uploader-Token.
> Port 8086 nur im lokalen Netz, nie ins Internet weiterleiten.

**Falls auf dem NAS noch gar keine InfluxDB läuft:** eigene Instanz
per Docker (legt dieselben Namen `gtwrlab`/`tankapp` an, 43800 h ≈ 5 Jahre
Retention, Healthcheck):

```bash
git clone https://github.com/kollb/TankApp.git ~/TankApp
cd ~/TankApp/ops/nas/influxdb
cp .env.example .env && nano .env        # Token: openssl rand -hex 16
docker compose up -d
docker compose exec influxdb influx ping
```

(Ist der Befehl `docker compose` auf dem NAS nicht vorhanden — Synology —:
`docker-compose` (v1) verwenden oder das Compose-Plugin installieren.)

### 3.2 Secrets auf dem Pi (einmalig)

```bash
sudo install -d -m 0750 -o pi -g pi /etc/tankapp
sudo tee /etc/tankapp/env > /dev/null <<'ENV'
TANKAPP_INFLUX_URL=http://192.168.178.61:8086
TANKAPP_INFLUX_ORG=gtwrlab
TANKAPP_INFLUX_BUCKET=tankapp
TANKAPP_INFLUX_TOKEN=<Token aus 3.1>
TANKAPP_POLL_DIR=/dev/shm/tankapp
ENV
sudo chmod 600 /etc/tankapp/env
```

### 3.3 Uploader testen (Pi)

```bash
cd ~/TankApp
set -a; . /etc/tankapp/env; set +a      # Env laden — wichtig, sonst laufen die
                                        # Tests gegen das leere data/poll statt
                                        # gegen /dev/shm/tankapp (TANKAPP_POLL_DIR)
python3 data-tools/upload_influx.py --dry-run   # Line Protocol zeigen, nichts senden
python3 data-tools/upload_influx.py --once      # ein voller Zyklus: Ping + Upload + Ack
```

Erwartet: `Ping …: ok (HTTP 204)` und `⇡ N Zeile(n) (M Punkte) → InfluxDB
(synced until …)`. Zweites `--once`: `0 unsynced Zeilen` bzw. kein zweiter
POST. Fehlerpfade (Exit-Code 1, **Ack bleibt stehen, nichts geht verloren**):

| Log-Meldung | Bedeutung / Aktion |
|---|---|
| `NAS nicht erreichbar …` | NAS aus oder falsche `TANKAPP_INFLUX_URL` — Uploader wartet (Backoff 60 s → 15 min), der Puffer läuft weiter |
| `HTTP 401 — Token fehlt/falsch` | In der InfluxDB-UI Token-Status/Rechte prüfen; keine Token-Listen oder Schlüsselwerte posten |
| `HTTP 403 — keine Schreibberechtigung` | Token neu anlegen mit `--write-bucket tankapp` (3.1) |
| `HTTP 404 — Org/Bucket existiert nicht` | `TANKAPP_INFLUX_ORG`/`_BUCKET` gegen NAS prüfen (`influx org list`, `influx bucket list`) |
| `HTTP 400 — Line Protocol abgelehnt` | Fehlertext im Log — sollte nicht vorkommen, dann hier melden |
| `⚠ PUFFER ÜBERFÜLLT …` | älteste unsynced Zeile ≥ 6 Tage — NAS-Ausfall zu lang, älteste Daten gehen FIFO verloren (Ringtiefe 7 Tage) |
| `⚠ Stationsnamen nicht verfügbar` | `polling.json` fehlt auf dem Pi (2.2) — station-Tag enthält dann die UUID statt des Namens |

### 3.4 systemd-Service (mit Watchdog)

```bash
sudo tee /etc/systemd/system/tankapp-uploader.service > /dev/null <<'UNIT'
[Unit]
Description=TankApp M1 InfluxDB-Uploader (JSONL-Ringpuffer → NAS)
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

`Type=notify`: der Uploader meldet `READY=1` beim Start und `WATCHDOG=1`
alle 10 s (per sd_notify, reine Standardbibliothek); bei `WatchdogSec=30`
startet systemd den Dienst neu, wenn er hängt. Ein NAS-Ausfall ist **kein**
Fehlerzustand der Service — sie pingt weiter und schiebt nach, sobald der
NAS zurück ist. Nach jeder Änderung an `EnvironmentFile`/Unit:
`sudo systemctl restart tankapp-uploader`.

### 3.5 Betrieb & Kontrolle

```bash
systemctl status tankapp-uploader
journalctl -u tankapp-uploader -f       # Ping alle 60 s, Upload bei neuen Zeilen
cat /dev/shm/tankapp/meta/synced_until  # Ack-Stand (letzte übertragene Zeile)

# Datenvolumen auf dem NAS (erwartet: ~215–216 Status-Punkte je gepollter Station/Tag,
# Fenster 06–24 Uhr / 5 min). <name> = Container-Name (docker ps | grep -i influx):
docker exec <name> influx query \
  'from(bucket: "tankapp") |> range(start: -24h)
    |> filter(fn: (r) => r._measurement == "prices" and r._field == "status")
    |> filter(fn: (r) => exists r.station_id)
    |> group(columns: ["city", "station_id", "station"]) |> count()'
```

Der Zähler betrachtet nur UUID-getaggte Statuspunkte, nicht die alten
Namensserien. Bei Namenskollisionen zuerst [UUID-Tags/Nachlieferung](STATIONS-UUID.md)
herstellen; alte und neue Serien nicht doppelt als unterschiedliche Polls zählen.

**Lücken-Check (Abnahme, 14 Tage, Lücken < 2 %):** pro Station und Tag sind
~216 Polls zu erwarten (18 h / 5 min); über 14 Tage ~3 000 — Lücken < 2 %
bedeuten ≥ ~2 940 Punkte pro Station. Abweichungen im `journalctl`-Log des
Collectors suchen (429s, Fenster, Key).

### 3.6 Backup (NAS)

Der Ringpuffer auf dem Pi wird **bewusst nicht** gesichert (7-Tage-Fenster
im RAM; die Langzeit-Historie liegt ab jetzt in InfluxDB). Wöchentliches
Tar-Backup des InfluxDB-Volumes per cron auf dem NAS:

```cron
0 3 * * 0 cd $HOME/TankApp/ops/nas/influxdb && docker run --rm \
    -v tankapp_influxdb_data:/data -v $PWD/backup:/backup alpine \
    tar czf /backup/influxdb-$(date +\%F).tar.gz -C /data .
```

Restore: neues leeres Volume anlegen, dann

```bash
docker run --rm -v tankapp_influxdb_data:/data -v $PWD/backup:/backup alpine \
    tar xzf /backup/influxdb-<datum>.tar.gz -C /data
```

danach `docker compose up -d` (Org/Bucket/Token sind im Volume enthalten).

### 3.7 M1-Abnahme: 14 Tage Live-Betrieb

Konzept §13: M1 ist erfüllt, wenn **Collector + Ringpuffer + Uploader
14 Tage** durchgelaufen sind und

1. **Datenlücken < 2 %** (Lücken-Check in §3.5),
2. **Ack-Protokoll fehlerfrei**: keine verlorene Zeile, keine Duplikate —
   `meta/synced_until` ist stets ≥ dem Zeitstempel der zweit-neuesten
   Pufferzeile (nur die allerneuste darf noch offen sein), und die
   Punktezahl in InfluxDB stimmt mit der Anzahl der Stations-Snapshots im
   Puffer überein (eine JSONL-Pollzeile enthält bis zu zehn Stationen, nicht
   nur einen Influx-Punkt).

Beide Dienste 14 Tage unbeaufsichtigt laufen lassen; wöchentlich §3.5
durchgehen und das Backup (§3.6) prüfen.

---

## 4. Phase D — M3 am Windows-PC testen

**Hier weitermachen, wenn M1/M2 bereits laufen.** Keine neue InfluxDB und kein
Uploader auf dem PC nötig. Collector, Secrets und Ack-Dateien auf Pi/NAS
unverändert lassen. Bei mehrdeutigen Stationsnamen einmalig den Uploader-Code
nach der [UUID-Anleitung](STATIONS-UUID.md) aktualisieren und bei Bedarf aus
Original-JSONL nachliefern; dazu keine neue Datenbank anlegen.

**Vollständige Schritt-für-Schritt-Anleitung für PowerShell:**
[`engine/README.md`](../engine/README.md)

1. Im lokalen TankApp-Ordner Python 3.11+ und die separate Umgebung `.venv-m3`
   einrichten. Keine Aktivierung / ExecutionPolicy-Änderung nötig; M2 behält `.venv`.
2. Automatisierte Tests starten – ohne Zugangsdaten, ohne NAS.
3. Das aktive private `docs\analysis\stations\polling.json` und die
   aufbereiteten CSV-Dateien aus `data\ready\` auf dem PC verwenden.
4. Datenqualität prüfen, dann mit ausreichender Historie backtesten, fitten und
   Prognosen als lokale JSON-Dateien erzeugen. **Dafür ist kein API-Key erforderlich.**
5. Optional Live-Daten vom NAS ergänzen: vier `TANKAPP_INFLUX_…=…`-Zeilen
   (URL, Org, Bucket, separater InfluxDB-Lese-Token) in `data\influx.env` speichern;
   Export mit `--env-file data/influx.env`. Nicht die ganze Datei in eine
   Token-Variable laden. `data\apikey.txt` bleibt für Tankerkönig. Der Export ist
   nur lesend. Zuerst `--check-connection --timeout 15` mit demselben `--env-file`
   ausführen. Die Anleitung zeigt die konkrete Token-Anlage in der InfluxDB-UI und
   trennt Health-/Netzfehler von einem verweigerten Bucket-Lesezugriff. Keine
   zusätzlichen Token-Dateien/Sitzungsvariablen für diesen PC-Ablauf nötig.

Nach dem Setup beispielsweise direkt mit deinen vorhandenen M2-Dateien:

```powershell
.\.venv-m3\Scripts\python.exe -m engine inspect --data "data/ready/*.csv*" --polling .\docs\analysis\stations\polling.json
.\.venv-m3\Scripts\python.exe -m engine backtest --data "data/ready/*.csv*" --polling .\docs\analysis\stations\polling.json --days 21
notepad .\results\engine\backtest\report.md
```

Bei einem Fehler erst die Diagnose beheben; ein älterer Bericht kann noch
vorhanden sein. Die vollständige Anleitung beschreibt auch die Variante mit
InfluxDB und gemischten Eingangsdateien. Export, CSVs, Berichte und Modelle
bleiben lokal/gitignored. M3 ist nicht abgenommen: Ensemble/ACI und der
Echt-Daten-Gütenachweis stehen noch aus.

Beide GUI-Verzeichnisse bleiben die Basis der späteren Homepage; am PC werden
hier nur die Engine-Werkzeuge getestet, nicht die Prototypen umgestaltet.

## 5. Befehlsübersicht

| Zweck | Kommando | Gerät |
|---|---|---|
| Isolierter Offline-Test | `py -3 data-tools\collect_prices.py --demo --once --out data\test-poll` (nie hochladen) | Windows-PC |
| Optionaler echter Poll + Tabelle | `py -3 data-tools\collect_prices.py --once --out data\pc-test-poll` (Request-Abstand mit Pi beachten, §1.5) | Windows-PC |
| Dauerbetrieb (Vordergrund) | `python3 data-tools/collect_prices.py` | Pi |
| Puffer-Verzeichnis setzen | `TANKAPP_POLL_DIR=/dev/shm/tankapp …` (oder `--out`) | Pi |
| Fenster/Intervall ändern | `--window-start 6 --window-end 24 --interval 300` | Pi |
| Uploader: was gesendet WÜRDE | `python3 data-tools/upload_influx.py --dry-run` | Pi |
| Uploader: ein Upload-Zyklus | `python3 data-tools/upload_influx.py --once` | Pi |
| Collector-Service starten/stoppen | `sudo systemctl start/stop/restart tankapp-collector` | Pi |
| Uploader-Service starten/stoppen | `sudo systemctl start/stop/restart tankapp-uploader` | Pi |
| Log ansehen | `journalctl -u tankapp-collector -f` / `-u tankapp-uploader` | Pi |
| InfluxDB-Check (Ping + Daten) | `docker exec <name> influx ping` / `influx query …` (siehe §3.5) | NAS |
| Pipeline (Polling-Set bauen) | `.\.venv\Scripts\python.exe data-tools\run_pipeline.py --router osrm --skip-fetch --skip-ingest --near-km 5 --near-n 3 --leader-max-km 10` | Windows-PC |
| InfluxDB-Verbindung / Leserecht | `.\.venv-m3\Scripts\python.exe data-tools\export_influx.py --env-file data/influx.env --check-connection --timeout 15` (kein Polling-Set, keine Exportdatei) | Windows-PC |
| InfluxDB-Export für M3 | `.\.venv-m3\Scripts\python.exe data-tools\export_influx.py --env-file data/influx.env` (vier Konfigurationswerte: Engine-Anleitung §3B) | Windows-PC |
| M3-Datenqualität mit vorhandener Historie | `.\.venv-m3\Scripts\python.exe -m engine inspect --data "data/ready/*.csv*" --polling docs/analysis/stations/polling.json` | Windows-PC |
| M3-Softwaretests | `.\.venv-m3\Scripts\python.exe -m pytest -q` (kein Key / NAS nötig) | Windows-PC |
