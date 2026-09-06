# analysis/ – Schritt 1: Tankstellen-Selektion

Mathematische Auswahl der (z. B. 10) besten Tankstellen aus historischen
Preisdaten. Details zur Methodik: `docs/KONZEPT.md` §3.

## Erwartetes Datenformat (historische Daten der 3 Städte)

Eine CSV je Stadt (oder eine große gemeinsame Datei), Spalten:

| Spalte | Typ | Beispiel | Anmerkung |
|---|---|---|---|
| `timestamp` | ISO-8601 | `2026-07-01 06:05:00` | lokale Zeit; Raster beliebig (wird auf 5 min aggregiert) |
| `station_id` | string | `AU-03` | stabil & eindeutig (z. B. MTS-K-ID) |
| `station_name` | string | `JET Auerbach Bahnhofstraße` | |
| `brand` | string | `JET` | |
| `city` | string | `Auerbach` | Trennung der 3 Städte läuft über diese Spalte |
| `lat`, `lon` | float | `52.4012, 13.0511` | WGS84 |
| `fuel` | string | `E10` | `E5` · `E10` · `DIESEL` |
| `price` | float | `1.629` | EUR/L |
| `status` | string *(optional)* | `open` | `open`/`closed` — geschlossene Zeiten werden maskiert |

## Ausführen

```bash
pip install -r analysis/requirements.txt

# Sobald echte Daten da sind:
python3 analysis/station_selection.py \
    --data data/raw/stadt1.csv data/raw/stadt2.csv data/raw/stadt3.csv \
    --fuel E10 --top 10 --tank-volume 40 --fills-per-week 1.2

# Solange noch keine echten Daten da sind (Demo-Ersatz, deterministisch):
python3 analysis/generate_demo_data.py --days 56 --out data/demo
python3 analysis/station_selection.py --data data/demo/*.csv --fuel E10 --top 10

# Zusatz: empirische Antwort auf "reicht Polling 08–24 Uhr?" (Fenster-Analyse):
python3 analysis/window_analysis.py --data data/demo/*.csv --fuel E10
#   → docs/analysis/report_window.md + figures/window_minhours.png
```

## Ausgaben

- `results/station_scores_<fuel>.csv` – alle Kennzahlen je Station
- `docs/analysis/report_top10.md` – Auswahlbericht inkl. Signifikanzen (BH-FDR),
  Konfidenzintervallen, bester Uhrzeit je Station, Euro-Ersparnis
- `docs/analysis/figures/` – Intraday-Zykluskurven, Stations-Heatmaps, Top-N

## Wichtige Parameter

| Flag | Default | Bedeutung |
|---|---|---|
| `--top` | 10 | Anzahl ausgewählter Stationen (global) |
| `--tank-volume` | 40 | getankte Liter pro Füllung (Fahrzeug-Frage, s. KONZEPT.md §7) |
| `--fills-per-week` | 1.2 | Tankhäufigkeit |
| `--min-coverage` | 0.85 | Datenqualitäts-Gate je Station |
| `--boot` | 2000 | Bootstrap-Wiederholungen für KI/p-Werte |
| `--home` | Stations-Schwerpunkt | Referenzpunkt je Stadt: `"Auerbach:52.40,13.05;…"` — steuert die Umweg-Entfernungen |
| `--consumption` / `--value-of-time` / `--avg-speed` | 7.0 / 12.0 / 50 | Fahrzeug-Ökonomie (L/100km, €/h, km/h) |
| `--trip-mode` | `onroute` | `onroute` = nur Mehrweg ggü. nächster Station · `dedicated` = Extrafahrt (strenger, Zeitwert meist dominant) |
| `--rank-by` | `net` | Ranking: `net` = Netto-Ersparnis nach Umweg · `score` = Statistik-Composite |

**Umweg-Beispiel:** `python3 analysis/station_selection.py --data data/demo/*.csv --home "Auerbach:52.401,13.051;Lindenberg:51.340,12.370;Neuental:50.980,11.030" --consumption 6.5 --value-of-time 10`
