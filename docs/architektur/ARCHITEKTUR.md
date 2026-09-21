# TankApp Architektur — Pi ↔ NAS ↔ Browser ↔ RP2

> Stand: 21.09.2026 · App-Version 0.64.0 (Ack-Vertrag A21-B1.1 nachgezogen) — extrahiert aus [KONZEPT.md](../produkt/KONZEPT.md) §9
> und [INSTALL.md](../betrieb/INSTALL.md), ergänzt um RP2-Zugang, Alarm-Aggregation und die
> benannten Datenverlust-Fenster. Betrieb/Handgriffe: [BETRIEB.md](../betrieb/BETRIEB.md).

## Inhaltsverzeichnis

- [Zielbild](#zielbild)
- [Rollen & Datenfluss](#rollen--datenfluss)
- [Pi: Collector + tmpfs + Heartbeat](#pi-collector--tmpfs--heartbeat)
  - [tmpfs Mount](#tmpfs-mount)
  - [Heartbeat (B3.11)](#heartbeat-b311)
  - [systemd Collector](#systemd-collector)
- [Uploader: Ack + Heartbeat](#uploader-ack--heartbeat)
  - [systemd Uploader](#systemd-uploader)
- [Ereignis-Pipeline: Webhook statt reinem Polling](#ereignis-pipeline-webhook-statt-reinem-polling)
- [NAS: InfluxDB + Archiv + Modelle + Selektion](#nas-influxdb--archiv--modelle--selektion)
  - [InfluxDB](#influxdb)
  - [Archiv](#archiv)
  - [Modelle](#modelle)
  - [Selektion (B3.10)](#selektion-b310)
  - [Heatmaps (B3.9)](#heatmaps-b39)
  - [Route Evaluate (B3.12)](#route-evaluate-b312)
  - [Collector-Status in /health (B3.11)](#collector-status-in-health-b311)
  - [Zustands-Bündelung: `alarms[]` und Version (B4/B9)](#zustands-bündelung-alarms-und-version-b4b9)
- [Browser: PWA-Shell, Cache und Offline-Queue (seit 0.38.0)](#browser-pwa-shell-cache-und-offline-queue-seit-0380)
- [Ressourcen & SD-Härtung](#ressourcen--sd-härtung)
- [Hardware-Bewertung](#hardware-bewertung)
- [Verweise](#verweise)

## Zielbild

```text
Tankerkönig prices.php → Pi: Collector/RAM/Uploader → NAS: InfluxDB
Tankerkönig Archiv ────────────────────────────────→ NAS: Preise + Stationen (≥1 Jahr)
                                                    │
                          NAS: Aufbereitung/Fits → API + Web-GUI (1355)
                                                    │
                        Handy/PC: Browser ←─────────┤
                                                    │
Pi/RP2: Port 8000 ── NAS online → Proxy ────────────┘
                  └─ NAS offline → Fallback-GUI (Live-Preise + Cache)
```

Produktprinzip: Aus Prognose-Quantilen wird eine Entscheidung mit Kalibrierungsangabe — „Warte bis 18–20 Uhr (+4 ct ≈ 1,60 €) — 82% sicher“. Fan-Charts, Heatmaps, Konfidenzbänder sind Begründung auf Nachfrage (Werkstatt-Modus).

## Rollen & Datenfluss

| Aufgabe | Gerät | Begründung |
|---|---|---|
| Collector (1 Req/5min, Städte Round-Robin, 06–24) | **Pi** | 24/7 Bereitschaft |
| Kurzzeit-Puffer | **Pi: tmpfs** `/dev/shm/tankapp` | RAM statt SD → SD-Schonung |
| Heartbeat | **Pi: tmpfs** `meta/heartbeat.json` → InfluxDB `collector_status` | **B3.11** Livestatus ans NAS |
| Langzeit-Speicher | **NAS: InfluxDB (Docker)** | Plattenplatz, Retention 1–5 Jahre (Default 5 Jahre, SSD-Tipp 1 Jahr, siehe SPEICHER.md) |
| Hosting API + Web-GUI | **NAS** | Gemeinsamer Daten-/App-Server |
| Archiv für Engine | **NAS: komprimierte Tagesdateien, ≥1 Jahr** | Automatischer Sync stündlich |
| Engine-Fits, Backtests, ACI, Decision-Kalibrierung, Selektion | **NAS (oder PC per WOL)** | Pi bleibt Collector/Uploader |
| Episode-/Snapshot-/Fill-Log | NAS Tabelle | Advice-Settlement getrennt von Wallet |
| 24/7-Zugang + Ausfall-GUI | **RP2/Pi: Port 8000** | proxyt das NAS, zeigt sonst Live-Preise + gecachte Prognosen → [RP2.md](../betrieb/RP2.md) |
| Alarm-Aggregation | **NAS: `/api/v1/health`** | ein `alarms[]`-Block statt sieben Endpunkte, ohne zusätzliche Netz-/Influx-Zugriffe |

Ablauf Collector: append JSON-Zeilen an `/dev/shm/tankapp/YYYY-MM-DD.jsonl`; Ringpuffer 7 Tage (aber seit A21-B1.1: Dateien mit vollständig bestätigtem Byte-Präfix in `meta/synced_until` werden nach Ack und 1 Tag Puffer gelöscht, RAM sinkt auf ~1–2 Tage — siehe [SPEICHER.md](../betrieb/SPEICHER.md) 4.1). Uploader pingt TCP 8086 alle 60s, Batch-Transfer, Ack via `meta/synced_until` als lückenlos bestätigtes Dateipräfix (Schema v2, Ereigniszeiten sind nie Commit-Position), idempotent. Jeder Punkt enthält `station_id` UUID-Tag; `station` bleibt Anzeigename. Replay ist explizit.

**Datenverlust-Fenster (explizit, TODO G3):** Der Ringpuffer behält
`RING_DAYS = 7` Tage. Ist das NAS **länger** offline, verwirft `ring_prune`
Snapshots, die nie hochgeladen wurden — diese Polls sind dann dauerhaft weg
(kein Nachholen aus dem RAM-Puffer; das Tankerkönig-**Archiv** ist ein zweiter,
unabhängiger Weg und wird beim nächsten Lauf nachgeholt, enthält aber nicht die
eigenen 5-Minuten-Polls). Bei geplantem NAS-Ausfall über 7 Tage den Puffer
vorher vergrößern: 32 MiB tmpfs ≈ 0,6 MB JSONL/Tag bei 10 Stationen, d. h. ein
Vielfaches an Tagen ist ohne SD-Schreiblast möglich — `size=` in `/etc/fstab`
anpassen und `RING_DAYS` erhöhen. Alarm: ab 6 Tagen (`oldest_age_days`).

Ebenfalls flüchtig: `/tmp/tankapp_cache` des RP2 überlebt keinen Reboot — die
Fallback-GUI zeigt dann bis zum ersten erfolgreichen Fetch ehrlich „keine
Prognose“ (TODO G4).

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

- Liest unbestätigte Zeilen hinter dem Byte-Cursor in `meta/synced_until` (Schema v2)
- Schiebt nach InfluxDB, schiebt Ack erst nach 2xx weiter — und dann nur als lückenlos verkettetes Dateipräfix; im Zweifel wird erneut gesendet
- Beschädigte vollständige Zeilen gehen nach `meta/quarantine/` statt den Lauf zu brechen oder still zu verlieren (A21-B1.2)
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
   sendet er `POST /api/v1/jobs/trigger` an die NAS-App:
   `{"job": "models", "watermark": <Epochensekunden des neuesten Snapshots>}`,
   Auth via `Authorization: Bearer <TANKAPP_NAS_WEBHOOK_TOKEN>`. Die Antwort
   (B8) ist die Quittierung: kommt sie nicht, wiederholt der Uploader mit
   Backoff (30 s … 15 min, höchstens 2 h) und meldet den Zustand mit dem
   Herzschlag — der Intervaljob bleibt die Rückfallebene.
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

- Bucket `tankapp`, Retention 5 Jahre (43800h) beim ersten Start, danach per `influx bucket update --retention 8760h` kürzbar — SSD-Tipp 1 Jahr, Details in [SPEICHER.md](../betrieb/SPEICHER.md)
- Least-Privilege Token: read+write nur für diesen Bucket
- URL aus Container erreichbar: NAS-LAN-Adresse, nicht localhost

### Archiv

- `tankapp.py history-sync` bei Start und stündlich, lädt Preis-/Stations-Tagesdateien bis gestern, holt Lücken nach
- State/Sperre in Runtime (SSD), damit HDD im Sleep bleiben kann
- Umfang Standard 365 Tage, via `--history-days 730` erweiterbar

### Modelle

- Bei Start, danach täglich (Webhook-Triggern beschleunigt, siehe [Ereignis-Pipeline](#ereignis-pipeline-webhook-statt-reinem-polling)), bei Fehler stündlich
- Liest InfluxDB, verarbeitet rohe Archiv-Änderungsereignisse mit exakten Zeitstempeln, erzeugt Trainingsbestand, fittet 24-h-Ausblick + 3d/7d Horizonte, **21-Tage-Rolling-Origin-Backtest** (seit 11.09.2026, davor 7 Tage) plus Mehrtage-Horizonte
- Prozessparallel über `TANKAPP_MODEL_WORKERS` (Default automatisch aus Affinität + cgroup-Quota, serieller Rückfall); seit 0.26.0 ein expliziter `fork`-Pool je Kraftstoff über Fit und Folgeaufgaben, schlanke 6-Spalten-Worker-Sicht; Ergebnisse in stabiler Reihenfolge und bitgleich zum seriellen Lauf
- Fortschritt je Phase/Schritt in `runtime/jobs/<job>.progress.json` + `runtime/jobs/<job>.log` (500 Zeilen) → `/health` `progress` und System-Tab
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
- DoW×Stunde: Niveau = Median €/L je Zelle; Cheap-Probability: mit Station = P(Station ≤ Zellen-Stadtmedian), ohne Station je nach `basis` = P(Preis ≤ Gesamtmedian des Fensters) oder P(Preis ≤ Median **derselben Stunde**) — B12, GUI-Default ohne Station ist die Stunden-Basis
- Berlin-Zeitzone, nur offene Preise

### Route Evaluate (B3.12)

- Kein externer Routing-Call, nur Ökonomie: K = d·(c/100)·p + (d/v)·z
- Vergleicht Referenz (Stadtmedian oder explizite Station) gegen Ziel-Station
- detour_km ohne Angabe: aus dist_km abgeleitet (onroute: dist(ziel)−dist(ref), dedicated: dist(ziel))
- Liefert brutto/netto, kritisch Δp*, worth_it, z_used/z_auto/is_peak (peak 16:30–20:00 = 16€/h, sonst 10€/h)

### Collector-Status in /health (B3.11)

- `/api/v1/health` zeigt den Collector-Status **nur aus lokalen Quellen** (NAS-Heartbeat-File, lokales tmpfs) — keine InfluxDB-Query, damit der Docker-Healthcheck (3–5 s) nicht an Influx-Antwortzeiten scheitert
- Volle Details inkl. Influx-Felder: `GET /api/v1/collector/status` (GUI-System-Tab)

### Straßen-Distanzen in der API (seit 0.24.0)

- Der Request-Pfad macht **kein** OSRM-Netzwerk: `dist_km`/`dist_mode` kommen nur aus dem lokalen Routen-Cache (`runtime/road_route_cache.json`); unbekannte Anker→Station-Paare liefern sofort Luftlinie (`"air"`, nie erfunden)
- Fehlende Routen holt ein Daemon-Thread im Hintergrund: Debounce je Anker, hartes Wanduhr-Budget 20 s (Socket-Timeout begrenzt nicht die DNS-Auflösung — darum die Wanduhr), 5-min-Cooldown bei Fehlschlag, Datei-IO serialisiert. Der nächste Request nutzt die Einträge über die Datei-mtime
- `metadata()` ist memoisiert (Datei-Stats von `polling.json` + Routen-Cache, 30-s-Backstop): Wiederholte Requests zahlen eine Dict-Kopie statt Re-Parse
- Konfiguration: `TANKAPP_OSRM` (1 = Default, 0 = kein Netz) und `TANKAPP_OSRM_URL` (eigener OSRM-Server, empfohlen: NAS-Docker, LAN-only). Vorher: je Request je Anker Live-OSRM-Calls — bei Internet-/DNS-Problemen am NAS 54–67 s Antwortzeit auf **allen** Endpunkten inkl. `/health`

### Stations-Preise: Stale-While-Revalidate (seit 0.24.0)

- Im Steady-State antwortet `/api/v1/stations` (und alles darauf Basierende) **sofort** aus dem Cache; der InfluxDB-Read (2-Tage-Fenster, `tail(n: 1)` je Station) läuft im Hintergrund — Single-Flight je Kraftstoff (Daemon-Thread), 30-s-Intervall wie vorher
- Freshness-Semantik unverändert: `fresh`/`age_minutes` hängen am Beobachtungszeitstempel (je Request neu bewertet), nicht am Cache-Alter; fehlerhafter Read behält den bekannten Stand + meldet `influx_read_failed` (sichtbar, sobald der Hintergrund-Read gescheitert ist)
- Erst-Ladung je Stations-Menge bleibt synchron (einmalig); der Server warmt alle drei Kraftstoffe beim Start im Hintergrund vor (`LiveData.prewarm()`), damit der erste GUI-Request danach in der Praxis nie wartet
- Wirkung: Antwortzeit von `/stations` ist von der InfluxDB-Latenz (NAS-HDD, mehrere Sekunden) entkoppelt

### Zustands-Bündelung: `alarms[]` und Version (B4/B9)

- `alarms[]` fasst die vorhandenen Prüfungen zusammen (Polling-Set, Herzschlag,
  Job-Fehler, Store-Größe) — **keine** neuen Zugriffe, damit das
  Healthcheck-Budget hält. Codes und Aktionen:
  [BETRIEB.md](../betrieb/BETRIEB.md#system-alarme-lesen).
- `version` (aus `app/version.py`) und `commit` (Checkout bzw.
  `TANKAPP_BUILD_COMMIT`) beantworten bei drei Oberflächen — NAS-GUI,
  RP2-Proxy/Fallback, Collector auf dem Pi — die Frage „welcher Stand läuft wo?“.
  Im Docker-Image ist `commit` `null` (kein `.git` im Image).

## Browser: PWA-Shell, Cache und Offline-Queue (seit 0.38.0)

Das GUI ist eine PWA; der Service Worker (`web/public/sw.js`, im Build nach
`web/dist/sw.js` gestempelt) sitzt zwischen Browser und NAS:

- **Zwei Caches.** `tankapp-shell-<App-Version>` hält die Shell (`/`,
  `manifest.json`, `icon.svg` beim Install) plus die statischen Assets, die beim
  ersten Laden anfallen — Dokumente unter anderen Pfaden werden nicht abgelegt.
  `tankapp-api-v1` hält GET-Antworten unter `/api/` mit einem
  `x-tankapp-cached-at`-Stempel: ausgeliefert wird der letzte Stand höchstens
  **30 Minuten** (stale-while-revalidate), danach entscheidet das Netz, und ohne
  Netz bleibt nur der alte Stand — die GUI zeigt das Alter, sie erfindet keine
  Preise.
- **Update statt Austausch.** Die Shell trägt die App-Version; der neue Worker
  ruft **kein** `skipWaiting()`, sondern wartet. Die Ansicht fragt die Version
  ab und zeigt „Neue Version verfügbar“; „Jetzt neu laden“ fordert die Übernahme
  an. Damit ist sichtbar, welcher Stand läuft.
- **Schreiben.** Belege und Vorsätze landen ohne Verbindung in einer Queue
  (`localStorage`, siehe [LUECKEN.md](../planung/LUECKEN.md) zur bewussten Abweichung von
  IndexedDB) und gehen nach, sobald die Verbindung steht. Die Beleg-`id`
  entsteht beim Tanken, der Server ist darüber idempotent; 4xx wird gemeldet,
  nicht wiederholt. Betrieb und Fehlersuche:
  [BETRIEB.md](../betrieb/BETRIEB.md#gui-update-und-offline-queue-b10-seit-0380).

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

- [Installation](../betrieb/INSTALL.md) — verbindlicher Ablauf
- [Betrieb](../betrieb/BETRIEB.md) — systemd, Backup, Alarme, Fehlersuche
- [RP2](../betrieb/RP2.md) — 24/7-Zugang, Proxy und Fallback-GUI
- [API](../referenz/API.md) — Endpunkte inkl. `/health` mit `alarms[]`
- [Analyse](../referenz/ANALYSE.md) — Selektion, Modelle, Heatmaps, P-Seite
- [Konzept](../produkt/KONZEPT.md) — fachliches Zielbild
- [Lücken-Check](../planung/LUECKEN.md) — was vom Konzept offen ist und warum
