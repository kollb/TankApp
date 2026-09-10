# TankApp Architektur — Pi ↔ NAS ↔ Browser

> Stand: 09.09.2026 — Extrahiert aus KONZEPT.md §9 und INSTALL.md, konsolidiert für B3.

## Inhaltsverzeichnis

- [Zielbild](#zielbild)
- [Rollen & Datenfluss](#rollen--datenfluss)
- [Pi: Collector + tmpfs + Heartbeat](#pi-collector--tmpfs--heartbeat)
- [Uploader: Ack + Heartbeat](#uploader-ack--heartbeat)
- [Ereignis-Pipeline: Webhook statt reinem Polling](#ereignis-pipeline-webhook-statt-reinem-polling)
- [NAS: InfluxDB + Archiv + Modelle + Selektion](#nas-influxdb--archiv--modelle--selektion)
- [Ressourcen & SD-Härtung](#ressourcen--sd-härtung)
- [Hardware-Bewertung](#hardware-bewertung)
- [Verweise](#verweise)

## Zielbild

```text
Tankerkönig prices.php → Pi: Collector/RAM/Uploader → NAS: InfluxDB
Tankerkönig Archiv ────────────────────────────────→ NAS: Preise + Stationen (≥1 Jahr)
                                                    │
                          NAS: Aufbereitung/Fits → API + vorhandene Web-GUI
                                                    │
                                                Handy/PC: Browser
```

Produktprinzip: Aus Prognose-Quantilen wird eine Entscheidung mit Kalibrierungsangabe — „Warte bis 18–20 Uhr (+4 ct ≈ 1,60 €) — 82% sicher“. Fan-Charts, Heatmaps, Konfidenzbänder sind Begründung auf Nachfrage (Werkstatt-Modus).

## Rollen & Datenfluss

| Aufgabe | Gerät | Begründung |
|---|---|---|
| Collector (1 Req/5min, Städte Round-Robin, 06–24) | **Pi** | 24/7 Bereitschaft |
| Kurzzeit-Puffer | **Pi: tmpfs** `/dev/shm/tankapp` | RAM statt SD → SD-Schonung |
| Heartbeat | **Pi: tmpfs** `meta/heartbeat.json` → InfluxDB `collector_status` | **B3.11** Livestatus ans NAS |
| Langzeit-Speicher | **NAS: InfluxDB (Docker)** | Plattenplatz, Retention 5 Jahre |
| Hosting API + Web-GUI | **NAS** | Gemeinsamer Daten-/App-Server |
| Archiv für Engine | **NAS: komprimierte Tagesdateien, ≥1 Jahr** | Automatischer Sync stündlich |
| Engine-Fits, Backtests, ACI, Decision-Kalibrierung, Selektion | **NAS (oder PC per WOL)** | Pi bleibt Collector/Uploader |
| Episode-/Snapshot-/Fill-Log | NAS Tabelle | Advice-Settlement getrennt von Wallet |

Ablauf Collector: append JSON-Zeilen an `/dev/shm/tankapp/YYYY-MM-DD.jsonl`; Ringpuffer 7 Tage; Uploader pingt TCP 8086 alle 60s, Batch-Transfer, Ack via `meta/synced_until`, idempotent. Jeder Punkt enthält `station_id` UUID-Tag; `station` bleibt Anzeigename. Replay ist explizit.

NAS-Ausfall: 7 Tage Puffertiefe (Urlaubssicher), bei Überlauf FIFO + Alarm ab 6 Tagen.

## Pi: Collector + tmpfs + Heartbeat

### tmpfs Mount

```bash
sudo mkdir -p /dev/shm/tankapp
echo 'tmpfs  /dev/shm/tankapp  tmpfs  defaults,noatime,size=32M,mode=0755  0  0' | sudo tee -a /etc/fstab
sudo mount /dev/shm/tankapp
sudo chown pi:pi /dev/shm/tankapp
```

32 MiB reichen: ~0,6 MB JSONL/Tag, Ringpuffer 7 Tage.

### Heartbeat (B3.11)

Collector schreibt nach jedem Poll `meta/heartbeat.json`:

```json
{
  "last_poll_at": "2026-09-10T14:12:03+02:00",
  "city": "Frankfurt",
  "poll_count": 1234,
  "tmpfs": {"total_bytes": 33554432, "used_bytes": 1234567, "free_bytes": 32319865},
  "oldest_file": {"name": "2026-09-03.jsonl", "age_days": 6.2},
  "ring_days": 7,
  "generated_at": "2026-09-10T14:12:03+02:00"
}
```

- `last_poll_at` = `fetched_at` des letzten Snapshots
- tmpfs via `shutil.disk_usage`
- älteste Datei via `stat().st_mtime`
- atomar via tmp+rename, best-effort (darf Collector nicht stoppen)

### systemd Collector

```ini
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
```

Key als Datei `data/apikey.txt` chmod 600 sicherer als Env.

## Uploader: Ack + Heartbeat

Uploader läuft als zweite Service auf demselben Pi:

- Liest unsynced Zeilen hinter `meta/synced_until`
- Schiebt nach InfluxDB, schiebt Ack erst nach 2xx weiter
- Backoff 60s → 15min
- systemd Type=notify + WatchdogSec=30

**Neu B3.11:** Liest `meta/heartbeat.json` alle 60s und schreibt Measurement `collector_status`:

```
collector_status,host=pi,city=Frankfurt last_poll_at="2026-09-10T14:12:03+02:00",tmpfs_used_bytes=1234567i,tmpfs_total_bytes=33554432i,oldest_age_days=6.2,poll_count=1234i <ns>
```

- `dry-run` zeigt Heartbeat-Zeile mit an
- Auch ohne Preis-Zeilen wird Heartbeat übertragen (falls vorhanden)
- NAS liest letzten Punkt via `/api/v1/collector/status`

### systemd Uploader

```ini
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
```

Env `/etc/tankapp/env` chmod 600:

```
TANKAPP_INFLUX_URL=http://192.168.178.61:8086
TANKAPP_INFLUX_ORG=gtwrlab
TANKAPP_INFLUX_BUCKET=tankapp
TANKAPP_INFLUX_TOKEN=<Token>
TANKAPP_POLL_DIR=/dev/shm/tankapp
TANKAPP_NAS_WEBHOOK_URL=http://192.168.178.61:1355
TANKAPP_NAS_WEBHOOK_TOKEN=<gleiches Secret wie TANKAPP_WEBHOOK_TOKEN auf dem NAS>
```

## Ereignis-Pipeline: Webhook statt reinem Polling

Race-Condition-Problem: Der Uploader schreibt in 5-Minuten-Abständen in die
InfluxDB, der Modell-Job lief aber rein cron-artig nach festem Intervall —
der Lauf konnte damit starten, bevor die frischen Daten sicher geschrieben
waren, oder tagelang trotz Datenfluss nicht.

**Ablauf (Issue 50):**

1. Uploader schreibt Punkte in die InfluxDB und **erst danach** (nach Ack)
   sendet er Fire-and-Forget `POST /api/v1/jobs/trigger` an die NAS-App:
   `{"job": "models", "watermark": <Epochensekunden des neuesten Snapshots>}`,
   Auth via `Authorization: Bearer <TANKAPP_NAS_WEBHOOK_TOKEN>`.
2. Der NAS-Scheduler weckt die Job-Schleife (`models`/`selection`) sofort,
   entscheidet aber selbst per Debounce (Mindestabstand 15 min für `models`,
   1 h für `selection`) und **Idempotenz**: Die Watermark wird bei Erfolg im
   Job-Status (`runtime/jobs/<name>.json → data_watermark`) verankert; ein
   Trigger mit gleichem Datenstand wird übersprungen, statt doppelt zu
   trainieren. Älter als das Job-Intervall → Lauf trotzdem (Fenster bleiben
   am aktuellen Tag verankert).
3. Gemeinsames Secret: Uploader und NAS müssen dasselbe Secret kennen
   (`TANKAPP_NAS_WEBHOOK_TOKEN` auf dem Pi, `TANKAPP_WEBHOOK_TOKEN` in der
   NAS-App-Umgebung). Ohne Secret bleibt der Endpoint 404 (bewusst
   unsichtbar), ohne Webhook bleibt alles beim intervallo-basierten Betrieb —
   die Pipeline degradiert graceful, es gibt keine neue harte Abhängigkeit.

**Separation of Concerns bleibt gewahrt:** Der Uploader meldet nur „Daten
liegen sicher in der InfluxDB“. Ob/wann der Inferenz-Job läuft, entscheidet
allein der NAS-Scheduler; gerechnet wird weiterhin nur im Worker
(`app.worker`), der nur abgeschlossene Ergebnisse veröffentlicht. Mehrere
Trigger während eines Laufs werden zusammengeführt (jeweils nur der neueste
Watermark bleibt gemerkt).

## NAS: InfluxDB + Archiv + Modelle + Selektion

### InfluxDB

- Bucket `tankapp`, Retention 5 Jahre (43800h)
- Least-Privilege Token: read+write nur für diesen Bucket
- URL aus Container erreichbar: NAS-LAN-Adresse, nicht localhost

### Archiv

- `tankapp.py history-sync` bei Start und stündlich, lädt Preis-/Stations-Tagesdateien bis gestern, holt Lücken nach
- State/Sperre in Runtime (SSD), damit HDD im Sleep bleiben kann
- Umfang Standard 365 Tage, via `--history-days 730` erweiterbar

### Modelle

- Bei Start, danach täglich (Webhook-Triggern beschleunigt, siehe [Ereignis-Pipeline](#ereignis-pipeline-webhook-statt-reinem-polling)), bei Fehler stündlich
- Liest InfluxDB, verarbeitet rohe Archiv-Änderungsereignisse mit exakten Zeitstempeln, erzeugt Trainingsbestand, fittet 24h-Ausblick + 3d/7d Horizonte, 7-Tage Backtest
- Veröffentlichung atomar nach `runtime/engine/current.json`, alte Ergebnisse bleiben bei Fehler erhalten
- `calibrated=false`, `decision_ready=false` bis M7

### Selektion (B3.10)

- Job `selection` täglich, nach Modell-Job best-effort
- Liest `runtime/training/*.csv.gz` (oder `exports/influx_*.csv.gz`)
- Berechnet δ̂ = Median(p_i − LOO-Median), Tages-Block-Bootstrap B=2000 → 95%-KI, p-Wert, Benjamini-Hochberg q, AV-Score = Σ w_h·P(Top-3|h), billigste Stunde, Volatilität, Rang-Stabilität
- Publiziert nach `runtime/selection/current.json`
- API `/api/v1/selection` liefert „Meine Stationen“

### Heatmaps (B3.9)

- Kein eigener Job, On-the-fly aus InfluxDB letzte N Wochen (1–12)
- DoW×Stunde: Niveau = Median €/L je Zelle; Cheap-Probability: mit Station = P(Station ≤ Zellen-Stadtmedian), ohne Station = P(Preis ≤ Gesamtmedian des Fensters)
- Berlin-Zeitzone, nur offene Preise

### Route Evaluate (B3.12)

- Kein externer Routing-Call, nur Ökonomie: K = d·(c/100)·p + (d/v)·z
- Vergleicht Referenz (Stadtmedian oder explizite Station) gegen Ziel-Station
- detour_km ohne Angabe: aus dist_km abgeleitet (onroute: dist(ziel)−dist(ref), dedicated: dist(ziel))
- Liefert brutto/netto, kritisch Δp*, worth_it, z_used/z_auto/is_peak (peak 16:30–20:00 = 16€/h, sonst 10€/h)

### Collector-Status in /health (B3.11)

- `/api/v1/health` zeigt den Collector-Status **nur aus lokalen Quellen** (NAS-Heartbeat-File, lokales tmpfs) — keine InfluxDB-Query, damit der Docker-Healthcheck (3–5 s) nicht an Influx-Antwortzeiten scheitert
- Volle Details inkl. Influx-Felder: `GET /api/v1/collector/status` (GUI-System-Tab)

## Ressourcen & SD-Härtung

| Posten | Bedarf |
|---|---|
| Collector+Uploader | ~40–60 MiB RSS |
| API/Web-GUI | läuft auf NAS |
| tmpfs-Ringpuffer | ≤32 MiB |
| JSONL | ~2,5 kB/Poll → 0,6 MB/Tag |
| InfluxDB | bis zu 2160 Snapshots/Tag (10 Stationen ×216 Polls), je Snapshot 1 Punkt mit bis zu 3 Preisfeldern |

SD-Härtung:

```
tmpfs  /dev/shm/tankapp  tmpfs  defaults,noatime,size=32M,mode=0755  0  0
vm.swappiness=10
vm.vfs_cache_pressure=50
```

log2ram/journald-Limits, noatime, systemd Watchdog, NTP Pflicht (UTC speichern, Berlin nur Frontend).

## Hardware-Bewertung

| Kandidat | Eignung | Urteil |
|---|---|---|
| NAS: Pentium Silver J5040, 16GB | InfluxDB-Ingest Last ~0, RAM 1–2GB, Docker, alle Fits | ✅ Empfehlung |
| PC: Ryzen 7 5700X, 32GB, RX 9070 XT | 20× überdimensioniert, Idle 50–90W vs NAS 10–15W | ❌ Dauerbetrieb, optional WOL |
| Pi 4 | Collector/Uploader, kein Fitten | ✅ Collector |

## Verweise

- [Installation](INSTALL.md) — verbindlicher Ablauf
- [Betrieb](BETRIEB.md) — systemd, Backup, Fehlersuche
- [API](API.md) — Endpunkte inkl. B3
- [Konzept](KONZEPT.md) — fachliches Zielbild
