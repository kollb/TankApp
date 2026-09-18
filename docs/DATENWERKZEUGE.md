# Datenwerkzeuge — Referenz, keine Installationskette

> Stand: 17.09.2026 · App-Version 0.49.5. Nachschlagewerk für `data-tools/`
> und `analysis/`; der Ablauf steht in [INSTALL.md](INSTALL.md), der
> Dauerbetrieb in [BETRIEB.md](BETRIEB.md). Neu: der
> [12-Uhr-Regel-Check](#12-uhr-regel-check).

## Inhaltsverzeichnis

- [Interne Einzelprogramme](#interne-einzelprogramme)
- [Datenformate](#datenformate)
- [Optionale vertiefte Stationsanalyse](#optionale-vertiefte-stationsanalyse)
- [12-Uhr-Regel-Check](#12-uhr-regel-check)

## Interne Einzelprogramme

| Programm | Aufgabe |
|---|---|
| `collect_prices.py` | Ein Collector für alle Stadtsets, Round-Robin, ein Request-Budget, persistenter Zeitplan, JSONL-Puffer. |
| `polling_plan.py` | Gemeinsame Validierung, atomare JSON-Ausgaben, Prozesssperre und Request-Zeitplan. |
| `upload_influx.py` | Pi-Puffer nach InfluxDB auf dem NAS, UUID-Tags und bestehendes Ack-Verfahren. Weckt danach optional die NAS-Jobs (`POST /api/v1/jobs/trigger`, Issue 50): Die Antwort ist die Quittierung; bleibt sie aus, wird der Trigger mit Backoff (30 s … 15 min, höchstens 2 h) wiederholt und der Zustand über den Herzschlag gemeldet (B8, 0.38.0) — Details in [BETRIEB.md](BETRIEB.md#webhook-pi--nas-b8-seit-0380). |
| `fetch_history.py` | HTTP-Tagesdownload, gzip, Wiederholung und atomare `.part`-Übernahme. NAS-Zeitplanung bevorzugt über den Sync-Wrapper, nicht nur `--since yesterday`. |
| `discover_stations.py` | Vorläufige Auswahl aus Stationsmetadaten, ohne lange Preishistorie. |
| `ingest_history.py` | M2-Aufbereitung; gerasterte Daten sind nicht automatisch zeitgenaue Live-Beobachtungen. |
| `run_pipeline.py` | Optionale vertiefte Historien-/Stationsanalyse, kein Installationsbeginn mehr. Schützt Sets anderer Städte vor Überschreiben. |
| `export_influx.py` | Nur lesender Live-Export, bestehender Lesezugang über `--env-file`; keine InfluxDB-Einrichtung. |
| `road_route.py` | Routing für die vertiefte Umweg-/Kostenbewertung. |
| `swap_stations.py` | Tote oder ungeeignete Stationen 1:1 tauschen: liest die Modell-Fehler, sucht Ersatz aus der Kandidaten-CSV, validiert das ganze Set und schreibt **nur** den Vorschlag — Ablauf in [STATIONEN-TAUSCH.md](STATIONEN-TAUSCH.md). |
| `prune_influx.py` | InfluxDB verkleinern (Delete API per Zeitfenster oder Retention kürzen), damit die SSD nicht mit der 5-Jahre-Retention wächst — Hintergrund in [SPEICHER.md](SPEICHER.md). |

Archiv und Polling kommen beide von Tankerkönig. Ein Modell kann die jüngsten
Polling-Daten allein verwenden, während das NAS trotzdem ein langes Archiv für
neue Städte, Vergleiche und Forschung erhält.

## Datenformate

Das NAS-Archiv enthält Tagesdateien als CSV oder CSV.gz:

```text
prices/YYYY/MM/YYYY-MM-DD-prices.csv.gz
  date,station_uuid,diesel,e5,e10,dieselchange,e5change,e10change
stations/YYYY/MM/YYYY-MM-DD-stations.csv.gz
  uuid,name,brand,street,house_number,post_code,city,latitude,longitude
```

Preisdateien sind Änderungsprotokolle, keine regelmäßigen Polling-Snapshots.
Original-Zeitstempel mit UTC-Offset und Änderungsflags aufbewahren; ein dichteres
Raster liefert keine zusätzlichen Beobachtungen. Unbekannter Öffnungsstatus
ist kein belegtes `open`. Der laufende NAS-Sync steht ausschließlich in
[INSTALL.md](INSTALL.md); Download-Optionen zeigt `fetch_history.py --help`.

Aufbereitete Analyse-CSVs verwenden folgendes Schema:

| Spalten | Verwendung |
|---|---|
| `timestamp`, `station_id`, `city`, `fuel`, `price` | Pflicht für die Engine; UUID, Stadtlabel, E5/E10/DIESEL, EUR/L. Zeitstempel möglichst mit UTC-Offset. |
| `station_name`, `brand`, `lat`, `lon` | Zusätzlich für die M2-Stationsselektion; Koordinaten in WGS84. |
| `status`, `source` | Optional; belegten Status und Bezugsweg erhalten. `history` und `influxdb` bezeichnen Bezugswege desselben Anbieters. |

## Optionale vertiefte Stationsanalyse

Nicht der Beginn der Installation: Für eine neue Stadt zuerst `tankapp.py add-city`
verwenden. Die historische Optimierung kann später auf dem NAS oder optional am
PC erfolgen. Dafür gelten `analysis/requirements.txt` und die Methodik in
[KONZEPT.md](KONZEPT.md). `analysis/config.local.json` enthält Anker und
Bundesländer; diese private Datei nicht durch eine Beispielkonfiguration ersetzen.

- `analysis/station_selection.py --help`: Raster, Coverage-Gate (Default 85 %),
  Netto-Vorteil, Tankmenge, Zeit-/Spritkosten und Routing. Bei gerasterten M2-CSVs
  das Analyse-Raster passend wählen, etwa `--step-min 30`; fehlende Beobachtungen
  nicht durch beliebig lange Fortschreibung als Qualitätsnachweis ersetzen.
- `analysis/window_analysis.py --help`: Polling-Fenster auf vorhandenen Daten prüfen.
- Ausgaben bleiben lokal: `results/station_scores_<fuel>.csv`,
  `data/analysis/report_top10.md` und `data/analysis/figures/`.
- Preis-Zwillinge und explizite Ersatzvorschläge: [Engine-Referenz](ENGINE.md#preis-zwillinge).
  Ein Vorschlag ändert nicht das aktive Set und repariert keine Namenskollisionen.

Spezialfälle nur bei Bedarf: [UUID-Migration](archiv/STATIONS-UUID-MIGRATION.md) und
[Engine-Diagnose](ENGINE.md).

## 12-Uhr-Regel-Check

`analysis/noon_rule_check.py --data <csv> --fuel E10` (seit 0.49.3).
Beantwortet auf dem echten Bestand die Frage, die am 17.09.2026 die
Tages-Panels in Zweifel zog: **Zeigen die beobachteten Preise überhaupt die
12-Uhr-Regel** (Erhöhung nur um 12:00, seit 2026-04-01 Gesetz,
`engine/config.py: price_law_local`) — oder trägt der Bestand noch das
Vorgesetzes-Muster, aus dem dann Zahlen wie „Günstigste Stunde 20–22 Uhr“
stammen?

### Welche Datenquelle?

Entscheidend ist die Ziel-Frage **vor/nach dem Gesetz** — und Influx allein
kann sie mit Ständen vor der UUID-Migration nicht beantworten:

- **Influx-Export** (`export_influx.py`) umfasst sicher nur die **UUID-Ära**:
  Der Uploader schreibt `station_id`-Tags erst seit der Migration
  (ca. 07.–09.09.2026,
  [STATIONS-UUID-MIGRATION](archiv/STATIONS-UUID-MIGRATION.md)). Ältere
  Legacy-Punkte tragen nur den Stationsnamen; steht der mehrfach im aktiven
  Polling-Set (Namenszwilling wie „Aral Tankstelle“), bricht der Export
  bewusst ab — „mehrdeutig“, UUIDs werden nicht geraten, und weder darf ein
  Namenszwilling entfernt noch ein Punkt umgedeutet werden.
  `--uuid-only` exportiert sauber die UUID-Ära — das ist alles NACH dem
  Gesetz, der „vor“-Block bleibt also leer.
- **Archiv-M2-CSVs** (`data/ready/…` aus `ingest_history.py` /
  `run_pipeline.py`) tragen die Stations-UUID aus den Tankerkönig-Metadaten
  und reichen über den 01.04.2026 hinaus zurück — **das ist die Quelle für
  den Vorher/Nachher-Kontrast**. Fehlt der Zeitraum, aus den Rohdumps
  nachziehen (reine Standardbibliothek, kein venv nötig):

```bash
# Aus dem Repo-Wurzellauf: --raw nutzt automatisch data/raw/prices
# (find mit -name "*-prices.csv*" zeigt, dass es gefüllt ist); der Anker
# steht notfalls direkt am Aufruf, wenn analysis/config.local.json fehlt.
# Zeitraum vor den Gesetzesbeginn legen:
python data-tools/ingest_history.py \
    --since 2026-03-01 --out data/ready-noon --fuel e10 \
    --anchor "Frankfurt:50.11,8.68"
.venv-analysis/bin/python analysis/noon_rule_check.py \
    --data data/ready-noon/*.csv* --fuel E10
```

Der Ingest liest jeden Tagesdump mit reiner Standardbibliothek — für ein
halbes Jahr regionaler Bestand ist das ein Lauf auf Minuten, keiner auf
Sekunden. Fehlt der Raw-Baum doch, sagt der Fehlertext selbst, dass erst
`data-tools/fetch_history.py` laufen muss.

### Aufruf auf dem Daten-Host (NAS)

Drei Schritte; der Check braucht nur numpy/pandas, **keine** volle
Analyse-Werkstatt (matplotlib/holidays/engine werden nicht importiert):

```bash
cd /mnt/user/appdata/TankApp   # Repo-/appdata-Wurzel, dort liegen data/…

# 1) Export mit dem Influx-Lesezugang aus data/influx.env.
#    --since vor dem Gesetzesbeginn ansetzen, sonst fehlt der
#    Vorher/Nachher-Kontrast (Default deckt nur ~70 Tage ab — alles danach).
python data-tools/export_influx.py --fuel e10 \
    --env-file data/influx.env --since 2026-03-01 --out data/export_e10.csv

# 2) Analyse-Pakete einmalig (fehlen sie, sagt das Skript genau das).
python3 -m venv .venv-analysis
.venv-analysis/bin/pip install -r analysis/requirements.txt

# 3) Der Check — Konsole + data/analysis/report_noon_rule.md.
.venv-analysis/bin/python analysis/noon_rule_check.py \
    --data data/export_e10.csv --fuel E10
```

Ohne venv geht alternativ `python3 -m pip install --user -r
analysis/requirements.txt`; oder den Export auf den PC kopieren und dort
auswerten (die Analyse ist laut [INSTALL.md](INSTALL.md) ohnehin
NAS-oder-PC).

### Was gezählt wird

Vier Zählungen, getrennt nach Zeitraum vor/nach `--law-date`:

1. Anstiege ≥ Schwelle (Default 1 ct, wie die Engine) — am 12-Uhr-Punkt
   (± `--noon-tol-min`) vs. außerhalb; Intervalle über `--max-gap-min`
   sind nicht bewertbar (der Sprung könnte legal in der Lücke liegen) und
   werden separat ausgewiesen statt als Verstoß gezählt.
2. Stunde des Tagestiefs je Stationstag (Gates `--min-obs`/`--min-hours`,
   sonst misst man Polling-Lücken statt Preismuster).
3. Stunde des Tageshochs, gleiche Gates.
4. Medianer Sprung über die 12-Uhr-Kante (letzte Beobachtung davor →
   erste danach).

Erwartung unter der Regel: Anstiege konzentrieren sich auf den
12-Uhr-Punkt, das Tagestief wandert in den Block 6–12, das Hoch in
12–18, die Kante ist deutlich positiv (≈ Mittagssprung). Bleibt das
Abend-Tief stehen, stammen die Tages-Panels aus alten Mustern — dann ist
die Lektüre der App-Statistiken zu korrigieren, nicht das Panel.

Kein Modell, kein Schätzen; Ausgabe Konsole +
`data/analysis/report_noon_rule.md` (`--report`). Eingabe sind dieselben
CSVs wie für die Selektion (export via `data-tools/export_influx.py`).