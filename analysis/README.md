# analysis/ – Schritt 1: Tankstellen-Selektion

Mathematische Auswahl der (z. B. 10) besten Tankstellen aus historischen
Preisdaten. Details zur Methodik: `docs/KONZEPT.md` §2.
M2 gilt nach Betreiber-Rückmeldung vorläufig als abgeschlossen; diese Werkzeuge
bleiben für Re-Selektion und Nachprüfung mit echter Historie erhalten.

## Erwartetes Datenformat (historische Daten der 3 Städte)

Eine CSV je Stadt (oder eine große gemeinsame Datei), Spalten:

| Spalte | Typ | Beispiel | Anmerkung |
|---|---|---|---|
| `timestamp` | ISO-8601 | `2026-07-01T06:05:00+02:00` | Offset bevorzugt; alte Historie in lokaler Zeit, Raster beliebig (wird auf 5 min aggregiert) |
| `station_id` | string | `<MTS-K-UUID>` | stabil & eindeutig (z. B. MTS-K-ID) |
| `station_name` | string | `Stationsname` | |
| `brand` | string | `JET` | |
| `city` | string | `Frankfurt` | Trennung der 3 Städte läuft über diese Spalte |
| `lat`, `lon` | float | `52.4012, 13.0511` | WGS84 |
| `fuel` | string | `E10` | `E5` · `E10` · `DIESEL` |
| `price` | float | `1.629` | EUR/L |
| `status` | string *(optional)* | `open` | `open`/`closed` — geschlossene Zeiten werden maskiert |

## Wer wird beobachtet (vor allen Datenfragen)

`data-tools/discover_stations.py` erzeugt aus der einen Tagesliste des Datenrepos (≈10 MB,
keine Preisdaten nötig) je Ort: Kandidatenliste (25 km um die Anker aus dieser Config),
Polling-Set mit max. 10 UUIDs (= 1 Request, `prices.php`-Bündelung) und den Statistik-Pool
für δ̂/Baseline. Anker + Bundesländer kommen aus `analysis/config.local.json` (`home`/`subdiv`)
— dieselbe Datei, die auch Ingest und Selektion lesen.

## Woher die Historie kommt

Empfohlener Weg: **nicht** das Tankerkönig-Datenrepo (100 GB) clonen, sondern Tagesdateien per
HTTP holen und nur den eigenen Radius behalten — Anleitung + Größen-/Zeitrechnung:
[`docs/DATEN-BEZUG.md`](../docs/DATEN-BEZUG.md), Werkzeuge in [`data-tools/`](../data-tools/README.md).

Wichtig für übernommene Historie: sie enthält nur **Preisänderungen** (~28/Station/Tag), keine
5-min-Reihe. Deshalb beim Selektionslauf `--step-min 30` setzen (Raster), oder im Ingest
`--density 5` (lückenlose Stand-Zeilen, ~8× Datei) — sonst fällt jede Station durchs
85-%-Coverage-Gate. `to_matrix()` füllt Lücken inzwischen automatisch bis zur dreifachen
Median-Kadenz (`--ffill-minutes` überschreibbar), und Städte ohne ≥2 Stationen werden
übersprungen statt abzustürzen (`--city campaign` im Ingest gruppiert Umland + Stadt zu einem Markt).

## Ausführen

```bash
pip install -r analysis/requirements.txt

# 1) Lokale Privatdaten anlegen (gitignored!) — Straße/Nr. NIE ins Repo:
cp analysis/config.local.example.json analysis/config.local.json
#    → "home" mit Koordinaten füllen (einmal per Geocoding; Stadt reicht als
#      Label, z. B. "Frankfurt"), "subdiv" mit Bundesland, z. B. "HE".

# 2) Bei Bedarf erneut selektieren (Dateien/aktive Kampagnen lokal anpassen):
python3 analysis/station_selection.py \
    --data data/ready/*.csv* \
    --fuel E10 --top 10 --step-min 30 --tank-volume 40 --fills-per-week 1.2 \
    --config analysis/config.local.json

# Optional: Poll-Fenster auf echter Historie überprüfen
python3 analysis/window_analysis.py --data data/ready/*.csv* --fuel E10
# → lokaler Fensterbericht und Abbildung
```

## Ausgaben (lokal, gitignored)

Die früher eingecheckten Demo-Berichte und -Abbildungen wurden entfernt.
Berichte mit echten Daten lokal archivieren, nicht die Beispielzahlen als
M2-Nachweis verwenden.

- `results/station_scores_<fuel>.csv` – alle Kennzahlen je Station
- `docs/analysis/report_top10.md` – Auswahlbericht inkl. Signifikanzen (BH-FDR),
  Konfidenzintervallen, bester Uhrzeit je Station, Euro-Ersparnis
- `docs/analysis/figures/` – Intraday-Zykluskurven, Stations-Heatmaps, Top-N

## Wichtige Parameter

| Flag | Default | Bedeutung |
|---|---|---|
| `--top` | 10 | Anzahl ausgewählter Stationen (global) |
| `--tank-volume` | 40 | getankte Liter pro Füllung (Fahrzeug-Frage, s. KONZEPT.md §10) |
| `--fills-per-week` | 1.2 | Tankhäufigkeit |
| `--min-coverage` | 0.85 | Datenqualitäts-Gate je Station |
| `--boot` | 2000 | Bootstrap-Wiederholungen für KI/p-Werte |
| `--step-min` | 5 | Analyse-Raster in Minuten — **30 für Tankerkönig-Historie** (Änderungsdaten), 5 für eigene Collector-Daten |
| `--ffill-minutes` | auto | Horizont „Preis gilt noch": 30 min bei dichten Daten, sonst max(180, 3×Medianabstand) |
| `--config` | leer | Lokale, **gitignorierte** JSON-Datei (`config.local.json`) mit Privatdaten: `{"home": {"Frankfurt": [lat, lon]}, "subdiv": {"Frankfurt": "HE"}}` — empfohlener Weg statt CLI-Flags, damit Adresse/Koordinaten nie im Repo oder in der Shell-History landen |
| `--home` | Stations-Schwerpunkt | Referenzpunkt je Stadt (Koordinaten — **bevorzugt aus `--config`**, nicht als Kommandozeilen-Flag) |
| `--subdiv` | leer | Bundesland je Stadt für Feiertage: `"Frankfurt:HE;Muenchen:BY;Koeln:NW"` — Feiertage werden dann aus AV & Tagesform ausgeschlossen (Paket `holidays`; Unterschiede z. B. Allerheiligen: BY/NW ja, HE nein) |
| `--consumption` / `--value-of-time` / `--avg-speed` | 7.0 / 12.0 / 50 | Fahrzeug-Ökonomie (L/100km, €/h, km/h) |
| `--trip-mode` | `onroute` | `onroute` = nur Mehrweg ggü. nächster Station · `dedicated` = Extrafahrt (strenger, Zeitwert meist dominant) |
| `--rank-by` | `net` | Ranking: `net` = Netto-Ersparnis nach Umweg · `score` = Statistik-Composite |

**Umweg-Beispiel:** `python3 analysis/station_selection.py --data data/ready/*.csv* --config analysis/config.local.json --consumption 6.5 --value-of-time 10`

**Kraftstoff:** Pipeline läuft standardmäßig auf **E10** (primärer
Kraftstoff). Diesel/E5 werden vom Collector mitgespeichert (gleiche
API-Antwort) und sind als Nowcast verfügbar; eine eigene Diesel-Selektion/
Prognose läuft mit `--fuel DIESEL` auf denselben Daten (zweiter Lauf,
kostenlos).

**Danach:** [M3-Prognose und Backtest](../engine/README.md) verwenden die
Live-Serie aus InfluxDB; zusätzliche Historie nur mit ausgewiesenen
Qualitäts-/Öffnungsstatus-Grenzen.
