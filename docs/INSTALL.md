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
| Dienst startet nicht | `journalctl -u tankapp-collector -n 50`; meist fehlt `polling.json` (2.2) oder der Key |

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
