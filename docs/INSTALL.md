# Installation & Betrieb (Erstinstallation)

Diese Anleitung sagt **was wo läuft** und mit **welchen Kommandos**.
Stand: M1 (Live-Collector) ist fertig; Influx-Uploader und API/PWA
folgen später (Roadmap im Konzept §13).

## 0. Kurzantwort: Was läuft wo?

| Baustein | Gerät | Status |
|---|---|---|
| Analyse/Pipeline (Historie holen, Stationen auswählen) | **PC (Windows)** — Einmal-/Werkstatt-Läufe | ✅ fertig |
| **M1 Collector** (Preise pollt, JSONL-Ringpuffer) | **Raspberry Pi** — 24/7 | ✅ fertig (`data-tools/collect_prices.py`) |
| Kurzzeit-Puffer (7 Tage) | **Pi: RAM** (`/dev/shm/tankapp`, tmpfs → SD-Schonung) | ✅ über Ringpuffer gelöst |
| Langzeit-Speicher (InfluxDB), Uploader, Engine-Fits, API | **NAS** | ⏜ folgt später |

**Faustregel:** Der Collector gehört auf den Pi. Er läuft 24/7, braucht
keine SD-Schreibzugriffe (Puffer im RAM) und nur ~40–60 MiB — reine
Python-Standardbibliothek, kein `pip install`. Das NAS wird erst ab
M2 (Uploader/InfluxDB) angefasst. Der PC bleibt die „Werkstatt" für
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
py -3 --version        # Python 3.9+ reicht
```

Analyse-Abhängigkeiten (nur für die Pipeline, nicht für den Collector):

```powershell
cd "G:\Meine Ablage\dev\TankApp"
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r analysis\requirements.txt
```

### 1.2 Anker & Tagesliste

- Heankoordinaten in `analysis\config.local.json`
  (Vorlage: `analysis\config.local.example.json`), z. B.
  `"home": {"Frankfurt": [50.11738, 8.63657]}`.
- Historische Tagesliste holen (Anleitung: `docs/DATEN-BEZUG.md`,
  Windows-Kapitel 11.1).

### 1.3 Pipeline laufen lassen

```powershell
py -3 data-tools\run_pipeline.py --router osrm --skip-fetch --skip-ingest `
    --near-km 5 --near-n 3 --leader-max-km 10
```

Ergebnis (gitignored, enthält private Koordinaten):
`docs\analysis\stations\polling.json` mit den 10 Polling-Stationen je Stadt.

### 1.4 Tankerkönig-API-Key (kostenlos)

Registrieren auf <https://www.tankerkoenig.de/> (Menü „API"), Key
kommt per Mail. Er wird **nicht** eingecheckt. Drei Möglichkeiten
(Reihenfolge der Suche: `--api-key` → Umgebungsvariable → Datei):

```powershell
# Möglichkeit 1: Datei im Repo (bereits gitignored)
"00000000-0000-0000-0000-000000000000" | Out-File -Encoding ascii data\apikey.txt

# Möglichkeit 2: Umgebungsvariable (PowerShell-Profil)
$env:TANKERKOENIG_API_KEY = "00000000-0000-0000-0000-000000000000"
```

### 1.5 Ersttest auf dem PC — ganz ohne Key

```powershell
py -3 data-tools\collect_prices.py --demo --once
```

Gibt eine Tabelle „billigste zuerst" mit simulierten Preisen aus und
schreibt einen Test-Snapshot nach `data\poll\`. Gegen die echte API:

```powershell
py -3 data-tools\collect_prices.py --once
```

Bei Erfolg: `Poll ok: 10/10 offen → 2026-…jsonl`. Die drei API-Statusfälle
werden korrekt behandelt (Konzept §1.2): `false` = Sorte nicht geführt
(wird weggelassen, nie als 0 geschrieben), `closed`/`no prices` ohne Preis.

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
python3 data-tools/collect_prices.py --demo --once   # ohne Key/Netz
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
#    (zeigt nur Länge + Anfangszeichen, nicht den ganzen Key)
python3 - <<'PY'
from pathlib import Path
k = Path("/home/pi/TankApp/data/apikey.txt").read_text().strip().splitlines()
print("Zeilen:", len(k), "| Zeile 1:", repr(k[0]) if k else "(leer)")
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

---

## 3. Phase C — NAS (später, nicht Teil von M1)

Folgt mit dem Influx-Uploader (Konzept §9.1): NAS bekommt
`influxdb:2` per Docker (Retention 5 Jahre), der Pi-Uploader pingt
TCP 8086, schiebt unbestätigte JSONL-Zeilen nach und merkt sich
`meta.synced_until` — idempotent, damit ein NAS-Ausfall bis zur
7-Tage-Puffertiefe überbrückt wird. **Jetzt noch nichts auf dem NAS
eingerichtet.** Der Ringpuffer auf dem Pi läuft unabhängig davon und
sammelt schon die Historie.

---

## 4. Befehlsübersicht

| Zweck | Kommando | Gerät |
|---|---|---|
| Demo-Test ohne Key | `python3 data-tools/collect_prices.py --demo --once` | PC/Pi |
| Ein echter Poll + Tabelle | `python3 data-tools/collect_prices.py --once` | PC/Pi |
| Dauerbetrieb (Vordergrund) | `python3 data-tools/collect_prices.py` | Pi |
| Puffer-Verzeichnis setzen | `TANKAPP_POLL_DIR=/dev/shm/tankapp …` (oder `--out`) | Pi |
| Fenster/Intervall ändern | `--window-start 6 --window-end 24 --interval 300` | Pi |
| Pipeline (Polling-Set bauen) | `py -3 data-tools/run_pipeline.py --router osrm --skip-fetch --skip-ingest --near-km 5 --near-n 3 --leader-max-km 10` | PC |
| Dienst starten/stoppen | `sudo systemctl start/stop/restart tankapp-collector` | Pi |
| Log ansehen | `journalctl -u tankapp-collector -f` | Pi |
