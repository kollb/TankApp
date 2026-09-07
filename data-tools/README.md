# data-tools/ – Datenbezug für die TankApp

Werkzeuge, um die **Historie** (Tankerkönig-Datenrepo, eine CSV pro Tag) zu holen und in das
Analyse-Schema zu überführen — ohne das 100-GB-Repo zu clonen.
**Aktueller nächster Schritt:** [M3 am Windows-PC testen – PowerShell-Anleitung](../engine/README.md).
Mit vorhandenen M2-CSVs direkt ohne NAS/API-Key starten; Live-Export nur optional.
`data\apikey.txt` gehört zum Collector. Für InfluxDB die vier `TANKAPP_INFLUX_…`-Werte
inklusive separatem Lese-Token in `data\influx.env` speichern und mit
`--env-file data/influx.env` laden. Eine solche Konfigurationsdatei ist **kein**
einzelner Token; nicht komplett per `Get-Content -Raw` in die Token-Variable schreiben.
Zuerst `python data-tools/export_influx.py --env-file data/influx.env --check-connection --timeout 15`
verwenden: Health und Bucket-Leserecht werden ohne Export und ohne Polling-Set geprüft.
Bei Fehlern zeigt die Diagnose HTTP-Phase/-Status und Fehlerklasse/-nummern, ohne
Token-/Proxy-Inhalte. Erfolgreiches Schreiben vom RPi beweist weder Leserechte noch
einen identischen HTTP-Weg am PC; ein optionaler Direktvergleich ist im Engine-README erklärt.

**Ausführliche Anleitung inkl. Größen-/Zeitrechnung und Fehlerbildern: [`docs/DATEN-BEZUG.md`](../docs/DATEN-BEZUG.md).**
**Erstinstallation & 24/7-Betrieb (Collector auf dem Raspberry Pi, systemd, Key): [`docs/INSTALL.md`](../docs/INSTALL.md).**


**Doppelte Preisverläufe:** [Vergleich und Ersatzvorschlag unter Windows](../docs/PREIS-ZWILLINGE.md).
Nach Prüfung eine Station mit `run_pipeline.py --exclude-uuid …` ausschließen;
`--out-stations` muss dafür auf einen separaten Vorschlagsordner zeigen.
Die bisherige Auswahl füllt den Platz mit dem nächsten geeigneten Kandidaten.

| Skript | Zweck |
|---|---|
| **`run_pipeline.py`** | **Alles in einem Befehl:** fetch → ingest → Selektion → `polling.json`. Lädt fehlende Tage nach (idempotent), sichert die Stationsliste, ingesiet mit `--resample 30 --density 60 --fuel e10`, selektiert alle Städte aus `config.local.json` und baut das Polling-Set für eine Stadt (Default Frankfurt). Auswahl nach **NETTO-Vorteil**, nicht blankem Preis: die N billigsten in der Nähe (`--near-km`, Default 4) plus die Leader, deren **Umweg sich nach Sprit+Zeit NETTO lohnt** (Netto €/Füll > 0), nur innerhalb `--leader-max-km` (Default 12 Straßen-km mit `--router osrm`); weiter entfernte Stationen werden gar nicht gepollt. Max. 2 je Marke. Ausgabe u. a. `docs/analysis/stations/polling.json` (gitignored). Windows: `py -3 data-tools\run_pipeline.py` — netrc wird automatisch unter `data/_netrc` gefunden. |
| `fetch_history.py` | Tagesdateien per HTTP (raw-Endpoint) laden: fortsetzbar, idempotent, gzip, Backoff. `--dry-run` zeigt Größe + Zeitprojektion. |
| `discover_stations.py` | **Schritt 1**: Tankstellen je Ort finden (25-km-Radius über `config.local.json`-Anker), Zwillinge je Marke zusammenfassen, Polling-Set (max. 10 UUIDs = 1 Request) nach Marke/Präferenz wählen, Eignung aus der Historie prüfen (`--check-history`). Erzeugt `report.md`, `*_kandidaten.csv`, `polling.json`. Braucht nur die 10-MB-Tagesliste, keine Preisdateien. |
| `ingest_history.py` | Rohhistorie → `data/ready/<kampagne>_hist.csv(.gz)` im Schema `analysis/README.md` (Radiusfilter, long-Format, Fortschreibung, Raster, QA-Bericht). |
| `road_route.py` | **Echte Straßen-km + Fahrzeit via OSRM/OpenStreetMap** (kostenlos, ohne Key): Table-API-Batch je Anker, Cache `results/road_route_cache.json`, automatischer Fallback auf Luftlinie. Direkt testen: `python3 data-tools/road_route.py 50.07,8.65 50.08,8.64`. Wird von `run_pipeline.py`/`station_selection.py` über `--router osrm` genutzt (Default: Luftlinie `--router haversine`). Eigener Server statt öffentlichem Demo-Server: `--osrm-url http://nas:5000` (Docker `osrm/osrm-backend`, läuft offline). |
| `collect_prices.py` | **M1 Collector (live):** pollt die 10 Stationen aus `docs/analysis/stations/polling.json` über die Tankerkönig-`prices.php` (1 Request / 5 min, Fenster 06–24 Uhr), schreibt JSONL in einen 7-Tage-Ringpuffer (`data/poll/`, Pi: `/dev/shm/tankapp`). `fetched_at` mit UTC-Offset gespeichert (§9.3 „UTC speichern“), Anzeige/Dateiname in Lokalzeit. Statusfälle nach §1.2 (`false` = Sorte nicht geführt → weglassen, nie 0; `closed`/`no prices` ohne Preis), 429-Backoff. Key: `--api-key` / Umgebungsvariable `TANKERKOENIG_API_KEY` / `data/apikey.txt`. **Dauerbetrieb:** `python3 data-tools/collect_prices.py`; Offline-Tests ausschließlich mit separatem `--out data/test-poll` ausführen; nie Demo-Snapshots in den Live-Puffer schreiben. |
| `upload_influx.py` | **M1 Uploader (live):** schiebt die unsynced JSONL-Zeilen des Ringpuffers per Line-Protocol nach InfluxDB 2.x auf dem NAS (Measurement `prices`, Tags `city`/`station`, Feld `status` + Preise je geführter Sorte — `false`/`0` nie als 0.000, §1.2). **Ack-Protokoll §9.1:** `meta/synced_until` erst nach erfolgreichem Write weiter → idempotent, NAS-Ausfall bis 7 Tage Puffertiefe überbrückt (Überlauf-Alarm ab 6 Tagen, Backoff 60 s→15 min, klare Fehlermeldungen 401/403/404/400). systemd `tankapp-uploader.service` (Type=notify, WatchdogSec=30, sd_notify per Standardbibliothek). Konfiguration: `TANKAPP_INFLUX_URL`/`_ORG`/`_BUCKET`/`_TOKEN` + `TANKAPP_POLL_DIR` (Pi: `/etc/tankapp/env`, chmod 600). **Test:** `--dry-run` (zeigt Zeilen, sendet nichts), `--once` (ein Zyklus, Exit 0/1). NAS-Seite: `ops/nas/influxdb/` (Docker, Retention 5 Jahre) — Anleitung: [`INSTALL.md` Phase C](../docs/INSTALL.md). |
| `export_influx.py` | **M3, nur lesend:** vorhandenes `prices`-Measurement im TankApp-Bucket per Flux-Text-POST (`/api/v2/query`, `application/vnd.flux`, kein Line-Protocol-Write) in CSV/CSV.gz exportieren; Status bleibt erhalten, Namen werden über das aktive `polling.json` auf UUIDs abgebildet. Unbekannte/mehrdeutige Namen und unvollständige Downloads brechen sicher ab. Ein reines Lese-Token genügt. Konfiguration über `--env-file data/influx.env` (vier `NAME=WERT`-Zeilen, ersetzt Prozessumgebung) oder die bisherigen Umgebungsvariablen. Ungültige Token/Header führen zu Fehlermeldungen ohne Token-Inhalt. `--check-connection` prüft Health ohne Token und Bucket-Leserecht per begrenzter Query, ohne Export/Polling-Set. `--dry-run` dagegen nur Vorschau ohne Netz/Token. Anleitung: [`engine/README.md`](../engine/README.md). |

Die Datenwerkzeuge selbst verwenden **nur Standardbibliothek** (Export: Python ≥ 3.9).
Für lokale Datumsgrenzen benötigt der Export IANA-Zeitzonendaten; unter Windows
bringt das Engine-Setup `tzdata` mit. Ohne diese Daten explizite ISO-Zeitstempel
mit UTC-Offset für `--since/--until` verwenden. Die aufgerufene Selektion und
die neue Engine haben eigene Python-Abhängigkeiten.
`data/` ist gitignored: Rohdaten und Ready-CSVs verlassen den Rechner nie, Zugangsdaten liegen in `~/.netrc`
(chmod 600) oder `/etc/tankapp/env` — **nie** im Repo, nie in der Shell-History.

Windows: `py -3` statt `python3`, Pfade mit `\`; PowerShell-Kochrezept:
[`docs/DATEN-BEZUG.md` Kapitel 11.1](../docs/DATEN-BEZUG.md).

```bash
python3 data-tools/discover_stations.py --config analysis/config.local.json \
    --stations data/raw/stations --poll-size 10 --out docs/analysis/stations   # 0) WEN beobachten
python3 data-tools/fetch_history.py --since 2025-01-01 --dry-run       # 1) Größe & Dauer ansehen
python3 data-tools/fetch_history.py --stations-latest                   # 2) Metadaten (eine Datei)
python3 data-tools/fetch_history.py --since 2026-07-08 --until 2026-09-05   # 3) Kurz-Historie laden
python3 data-tools/ingest_history.py --config analysis/config.local.json --stations data/raw/stations \
    --radius 25 --resample 30 --density 60 --city campaign --qa data/ready/QA.md   # 4) aufbereiten
python3 analysis/station_selection.py --data data/ready/*.csv* --fuel E10 --step-min 30  # 5) selektieren
```
