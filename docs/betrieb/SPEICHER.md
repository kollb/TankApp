# TankApp Speichermanagement — Pi shm und NAS SSD/HDD

> Stand: 21.09.2026 · App-Version 0.65.0 (Messwerte und Unraid-Pfade: 13.09.2026) — beantwortet die Fragen aus dem Betrieb: „Braucht es das tmpfs alles? Nach Influx-Upload löschbar?“ und „Alles persistent nur in Influx? Tankapp/Influx 3,38 GB auf SSD — irgendwann auf HDD verschieben, aber Spindown?“ Seit A21-B1.1 gilt für „Nach Influx-Upload löschbar?“ der Dateibestätigungs-Nachweis statt eines Zeitstempels; bewusste FIFO-Verluste sind getrennt gezählt.

## Inhaltsverzeichnis

- [1) Pi: `/dev/shm/tankapp` (tmpfs)](#1-pi-devshmtankapp-tmpfs)
  - [Was liegt dort?](#was-liegt-dort)
  - [Braucht es das alles?](#braucht-es-das-alles)
  - [Was passiert bei 7+ Tagen NAS-Ausfall?](#was-passiert-bei-7-tagen-nas-ausfall)
  - [Und der Prognose-Cache des RP2?](#und-der-prognose-cache-des-rp2)
- [2) NAS: Was ist persistent und wo liegt es?](#2-nas-was-ist-persistent-und-wo-liegt-es)
  - [Warum Influx auf SSD bleiben sollte](#warum-influx-auf-ssd-bleiben-sollte)
  - [Wenn Influx doch auf HDD soll](#wenn-influx-doch-auf-hdd-soll)
  - [Feedback-Store und -Archiv: zwei Dateien, ein Vertrag (A21-B3.1)](#feedback-store-und--archiv-zwei-dateien-ein-vertrag-a21-b31)
- [4) Checkliste für den Betreiber](#4-checkliste-für-den-betreiber)
- [5) Offene Punkte](#5-offene-punkte)

## 1) Pi: `/dev/shm/tankapp` (tmpfs)

### Was liegt dort?

- `YYYY-MM-DD.jsonl` — ein Snapshot je Poll (06–24 Uhr, alle 5 min pro Request-Budget, Round-Robin über Stadtsets). Bei 10 Stationen ~2,5 kB/Poll → ~0,6 MB/Tag, bei mehreren Städten proportional mehr.
- `meta/heartbeat.json` — letzter Poll, tmpfs-Auslastung, älteste Datei, poll_count, unbestätigter Bestand und bewusste FIFO-Verluste (A21-B1.1).
- `meta/synced_until` — Ack des Uploaders (JSON Schema v2): Byte-Cursor je Tagesdatei plus `prefix_sha256` des bestätigten Präfixes und `fetched_at_max` (nur Messgröße, nie Commit-Position). Die Invariante: Der Cursor ist stets ein **lückenlos bestätigtes Dateipräfix** in Datei-/Offsetordnung (A21-B1.1).
- `meta/quarantine/` — isolierte beschädigte Pufferzeilen (A21-B1.2), eine Datei je Vorfall, benannt nach Quelldatei und Byte-Offsets.
- `meta/fifo_losses.jsonl` — Protokoll bewusster FIFO-Verluste nach der Aufbewahrungsgrenze (A21-B1.1).

### Braucht es das alles?

Der Ringpuffer ist **Wiederholungs- und Ausfallpuffer**: Ist das NAS länger offline, hält er die letzten 7 Tage im RAM, damit nichts auf die SD geschrieben werden muss (SD-Schonung). Ist das NAS wieder da, schiebt der Uploader alles nach, was der Byte-Cursor noch nicht lückenlos bestätigt hat — Ereigniszeiten (auch bei Uhr-Rücksprung oder spät angehängten älteren Zeilen) sind dafür keine Position.

**Nach Influx-Upload löschbar? Ja — mit Dateibestätigung.**

- `collect_prices.py:ring_prune()` löscht eine Datei nur vorzeitig, wenn der v2-Cursor des Uploaders **die ganze Datei** bestätigt (`cursors[datum] ≥ Dateigröße`) und ihr Datum älter als gestern ist. Ein `fetched_at_max`-Zeitstempel allein ist ausdrücklich **kein** Bestätigungs­nachweis (A21-B1.1); alte v1-Acks ohne Cursor gelten als unbestätigt.
- Gestern bleibt bewusst 1 Tag für manuelle Kontrolle im Puffer, selbst wenn bestätigt.
- Ergebnis: Bei stabilem NAS liegt nur noch ~1–2 Tage im tmpfs (0,6–1,2 MB statt 4,2 MB), bei NAS-Ausfall weiter bis 7 Tage (FIFO).

```python
# Logik in collect_prices.py
# - acked = v2-Cursor(der Datei) >= Dateigröße   # Dateibestätigung, nicht Datum
# - acked and file_date < today-1        → löschen (bestätigt)
# - file_date < today-(RING_DAYS-1)      → löschen (FIFO-Überlaufschutz, auch
#                                          unbestätigt — bewusster Verlust)
```

Damit ist die Antwort: **Nein, alles muss nicht 7 Tage im RAM liegen.** Nach erfolgreichem Upload kann es weg, 1 Tag Rest bleibt für Debug/Replay. Wer noch mehr sparen will: `RING_DAYS=3` setzen und `size=16M` in `/etc/fstab` reicht bei 10 Stationen immer noch.

### Was passiert bei 7+ Tagen NAS-Ausfall?

`ring_prune` verwirft nach `RING_DAYS` (Default 7) auch **unbestätigte** Dateien — diese Polls sind dann dauerhaft weg (kein Nachholen aus RAM). Das ist der bewussten FIFO-Grenze geschuldet und wird getrennt vom erfolgreichen Sync gezählt: jeder Verlust landet in `meta/fifo_losses.jsonl`, die Summen (`fifo_dropped_files`, `fifo_dropped_lines`) und der unbestätigte Bestand (`unacked_files`, `oldest_unacked_age_days`) stehen im Herzschlag (`meta/heartbeat.json`) und damit im System-Bereich. Das Tankerkönig-Archiv (national, Tagesdateien) wird beim nächsten Archiv-Sync nachgeholt, enthält aber nicht die eigenen 5-Minuten-Polls. Für geplanten Langausfall: `size=` vergrößern und `RING_DAYS` erhöhen.

### Und der Prognose-Cache des RP2?

`/tmp/tankapp_cache` (Env `CACHE_DIR`) liegt bewusst **nicht** auf der SD-Karte
und wird auch nicht dorthin gespiegelt: Der Cacher fragt alle 5 Minuten ab, ein
Spiegel würde also laufend schreiben — mehr Verschleiß als Nutzen für einen
Puffer, der nach einem Neustart in wenigen Minuten wieder gefüllt ist
(Entscheidung G4, Version 0.29.0; Details in [RP2.md](RP2.md#wartung-logs-journal-sd-karte)).
Nach einem Pi-Reboot ist der Cache leer, und die Fallback-GUI sagt das auch:
`CACHE_REBOOT_HINT` („Nach einem Neustart ist der Prognose-Puffer leer …“) steht
im F1-Bereich, im Prognose-Raster und in der API-Fehlermeldung; die Startzeile
`boot_state_note()` protokolliert denselben Zustand in `cache.log`.

## 2) NAS: Was ist persistent und wo liegt es?

Auf Unraid typisch:

| Pfad im Host | Pool | Inhalt | Größe heute | Zugriffshäufigkeit |
|---|---|---|---|---|
| `/mnt/user/appdata/tankapp` (Code + `data/runtime`) | **SSD** | `runtime/jobs/*.json`, `runtime/jobs/*.log` (500 Zeilen), `runtime/engine/current.json` (Prognosen), `runtime/selection/current.json`, `runtime/feedback/store.json` (Belege, Episoden, Wallet), `runtime/collector/heartbeat.json`, `runtime/training/*.csv.gz`, `runtime/backtest-cache/`, `runtime/archive-cache/`, `data/nas-settings.json` | klein (10–200 MB) | sehr häufig (jede API-Anfrage liest `current.json`, Jobs schreiben Logs) |
| Docker Volume `tankapp_influxdb_data` | **SSD** (unter `/mnt/user/appdata` bzw. Docker-Default) | InfluxDB Bucket `tankapp`: Measurement `prices` (pro Station 1 Punkt/5 min, bis zu 3 Fuel-Felder) + `collector_status` | **3,38 GB** gemessen | **sehr häufig**: `/api/v1/stations` alle 30 s (letzte 2 Tage), `/api/v1/health` alle 60 s (Collector-Status), `/api/v1/overview` alle 30 s (Tageskurve 24 h), Heatmap bis 12 Wochen (84 Tage) on-the-fly, Modell-Export letzte 120 Tage täglich |
| `/mnt/user/data/tankapp` (`--archive-dir`) | **HDD** | Roharchiv nationale Tagesdateien (mehrere GB, 365 Tage Standard) | groß (GB) | **selten**: bei Start + stündlich `history-sync` (State liegt auf SSD, damit HDD im Sleep bleiben kann), sowie beim täglichen Modell-Lauf (liest Archiv, wenn Live-Abdeckung < 90 Tage) |
| `polling.json`, `influx.env`, `netrc` | SSD (bind-mount read-only) | private Konfiguration | winzig | nur beim Start |

**Also: Nein, nicht alles persistent nur in Influx.** Influx hält nur die Live-Preise und den Collector-Herzschlag. Die persönliche Bilanz (Belege), Prognosen, Selektion, Job-Stände und das Roharchiv liegen außerhalb.

### Warum Influx auf SSD bleiben sollte

Influx wird **alle 30 s** gelesen (Stationspreise, Tagesstreifen, Health). Läge das Volume auf HDD, würde die HDD alle 30 s aufwachen — Spindown wäre praktisch aus, Verschleiß und Strom hoch. Deshalb:

- **Influx → SSD** (aktuell richtig)
- **Archiv → HDD** (aktuell richtig, State auf SSD verhindert Wecken ohne Bedarf)
- **Runtime → SSD** (klein, häufig)

Wer SSD-Platz sparen muss:

1. **Retention kürzen**: Standard 5 Jahre (43800 h) → 1 Jahr (8760 h) oder 180 Tage (4320 h). Die alten Preise sind über das Tankerkönig-Archiv rekonstruierbar (Tagesauflösung, nicht 5-min, aber für Modelle reicht es nach 90 Tagen Live-Polling).  
   ```bash
   # bestehendes Bucket ändern (im Influx-Container)
   docker exec tankapp-influxdb influx bucket update --org gtwrlab --name tankapp --retention 8760h
   # oder per API: DELETE /api/v2/delete mit start/stop
   ```
   In `ops/nas/influxdb/docker-compose.yml` ist die Retention nur beim **ersten** Start wirksam (`DOCKER_INFLUXDB_INIT_RETENTION`). Danach via CLI ändern.

2. **Backups auf HDD**: `ops/nas/backup.sh` (runtime) und Influx-Tar-Backup bereits auf HDD legen, nicht auf SSD. Cron-Ziel auf `/mnt/user/data/...` setzen.

3. **Cache leeren**: `runtime/backtest-cache/` darf jederzeit gelöscht werden (nächster Lauf rechnet neu). `runtime/archive-cache/` ebenfalls.

4. **Prune statt Downsampling**: `data-tools/prune_influx.py --older-than-days 365` löscht alte Punkte über die Influx-Delete-API (`--dry-run` zeigt vorher, was ginge; Default 365 Tage), ohne das Volume zu bewegen — die HDD bleibt schlafend, nur die SSD wird kleiner. Aufruf und Grenzen: [BETRIEB.md](BETRIEB.md#speichermanagement-pi-shm--nas-ssdhdd). Ein echtes Downsampling (stündliche Mittelwerte ab 120 Tagen) bleibt **nicht** gebaut: Der Modell-Export nutzt die letzten 120 Tage roh, ältere Daten gehen bei Bedarf aus dem Archiv nach.

### Wenn Influx doch auf HDD soll

Technisch möglich, aber Spindown-Ziel dann aufgeben:

- In `ops/nas/influxdb/docker-compose.yml` Volume auf HDD legen: `source: /mnt/user/data/tankapp/influxdb` → `target: /var/lib/influxdb2`
- Oder Docker-Directory generell auf HDD (Unraid Settings → Docker → Docker Directory → `/mnt/user/data/docker`) — betrifft dann alle Container.
- Folge: HDD wacht alle 30 s auf. Wer das will, sollte in Unraid den Spindown für dieses Array deaktivieren oder ein SSD-Cache-Pool mit `prefer` nutzen (Influx bleibt auf SSD, wird aber bei Bedarf auf HDD ausgelagert).

Empfehlung: **Influx auf SSD lassen**, Retention auf 1 Jahr kürzen, Backups auf HDD. So bleibt die 3,38 GB stabil statt wachsend, und die HDD kann schlafen.

### Feedback-Store und -Archiv: zwei Dateien, ein Vertrag (A21-B3.1)

Die persönliche Tank-Bilanz ist bewusst **keine** Datenbank, sondern zwei
Dateien unter `runtime/feedback/`:

- `store.json` — der heiße Bestand (90-Tage-Fenster), atomar geschrieben
  (temporäre Datei + Umbenennen), Größe über `FEEDBACK_MAX_BYTES` (10 MB)
  überwacht.
- `archive.jsonl` — was die tägliche Retention aus dem Store auslagert
  (eine JSON-Zeile je Beleg/Episode/Settlement, mit Sammlungs- und
  Schema-Stempel). Wächst nur langsam (~1–2 MB je Jahr); Allzeitbilanz und
  M7 rechnen über Store **plus** Archiv.

Der Übergang zwischen beiden ist ein Publikationsvertrag, kein
Nebenprodukt der Implementierung: Die Retention ersetzt das Archiv **atomar
und zuerst** (fertige Datei umbenennen — Leser sehen niemals eine halbe
Zeile), danach erst den Store ohne die ausgelagerten Belege. Leser (Decide,
Overview, Summary) lesen umgekehrt: erst den Store, dann das Archiv. Damit
geht am Übergang kein Beleg verloren und keines wird doppelt gezählt; ein
Abbruch dazwischen ist harmlos (heiß gewinnt, der nächste Lauf erkennt die
Identität wieder). Das Backup (`ops/nas/backup.sh`) hält dieselbe Reihenfolge
ein und nimmt dazu die Sperrdatei des Stores — siehe unten.

Fehlerverträge: Beide Dateien sind fail-closed — fehlend (Erststart) ist
gesund und leer, unlesbar/beschädigt ist `store_corrupted` bzw.
`archive_corrupted` mit Quarantäne-Kopie, zu neu (Schema-Stempel) verlangt
ein App-Update. Details und Wiederherstellung:
[BETRIEB.md](BETRIEB.md#feedback-archiv-und-ledger-integrität-a21-b31).

## 4) Checkliste für den Betreiber

- [ ] Pi: `collect_prices.py` aktualisieren (`git pull`), Dienst neu starten — ab dann weniger tmpfs.
- [ ] NAS: Influx-Retention prüfen und ggf. auf 1 Jahr setzen (siehe oben).
- [ ] Backups: `TANKAPP_BACKUP_DIR` auf HDD legen, nicht auf SSD.
- [ ] Bei Platzmangel: `runtime/backtest-cache/` löschen, `docker system prune` für alte Images.
- [ ] HDD-Spindown: `archive` bleibt auf HDD, `runtime` und Influx auf SSD — so wacht HDD nur stündlich + beim Modell-Lauf auf.

## 5) Offene Punkte

- **Pruning:** `data-tools/prune_influx.py` liegt im Repo (Delete API, `--older-than-days`, `--dry-run`) — der Kurzaufruf steht in [BETRIEB.md](BETRIEB.md#speichermanagement-pi-shm--nas-ssdhdd).
- Influx auf HDD mit SSD-Cache (bcache) — komplex, nur wenn die SSD wirklich knapp wird; entschieden ist „Influx bleibt auf SSD“ (siehe oben).
- Downsampling alter Punkte (stündliche Mittelwerte) — bewusst nicht gebaut, siehe Punkt 4.
