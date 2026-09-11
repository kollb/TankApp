# Datenwerkzeuge — Referenz, keine Installationskette

# Datenwerkzeuge — Referenz, keine Installationskette

## Inhaltsverzeichnis

- [Gebündelte Befehle](#datenwerkzeuge--referenz-keine-installationskette)
- [Interne Einzelprogramme](#interne-einzelprogramme)
- [Datenformate](#datenformate)
- [Optionale vertiefte Stationsanalyse](#optionale-vertiefte-stationsanalyse)

---



**[Einziger Installationseinstieg: docs/INSTALL.md](../docs/INSTALL.md).**
Nicht alle Skripte nacheinander ausführen. Der normale Einstieg sind die
gebündelten Befehle aus `tankapp.py`, mit vorhandener Python-Standardbibliothek:

| Befehl | Gerät | Erledigt gemeinsam |
|---|---|---|
| `tankapp.py add-city` | am einfachsten Pi; NAS/PC möglich | Anker lokal erfassen, Stationsliste nutzen/holen, neues Stadtset vorbereiten, alte Sets erhalten. Kein Preisdownload nötig. |
| `tankapp.py activate-polling` | Pi, `sudo` | Vorige Auswahl sichern, validierten Vorschlag übernehmen, Collector/Uploader neu starten; Rückfall bei Restartfehler. |
| `tankapp.py history-sync` | NAS | Ein Jahr Preis-/Stationsarchiv initial laden, vorhandene Dateien überspringen, alle fehlenden Tage nachholen; für cron/Start-Aufgabe. |
| `data-tools/swap_stations.py` | NAS/PC/Pi | Tote oder sortenlose Stationen aus dem aktiven Polling-Set 1:1 tauschen; Fehler-UUIDs aus `engine/current.json`, Ersatz aus `discover_stations`-Kandidaten; schreibt nur den Vorschlag. Anleitung: [STATIONEN-TAUSCH.md](../docs/STATIONEN-TAUSCH.md). |

Windows ruft `py -3 tankapp.py …` auf, Pi/NAS `python3 tankapp.py …`.
Keine PC-venv und keine pip-Pakete für diese Abläufe. Schlüssel bleiben in den
vorhandenen privaten Dateien; nicht als Befehlsargument in cron hinterlegen.

## Interne Einzelprogramme

| Programm | Aufgabe |
|---|---|
| `collect_prices.py` | Ein Collector für alle Stadtsets, Round-Robin, ein Request-Budget, persistenter Zeitplan, JSONL-Puffer. |
| `polling_plan.py` | Gemeinsame Validierung, atomare JSON-Ausgaben, Prozesssperre und Request-Zeitplan. |
| `upload_influx.py` | Pi-Puffer nach InfluxDB auf dem NAS, UUID-Tags und bestehendes Ack-Verfahren. |
| `fetch_history.py` | HTTP-Tagesdownload, gzip, Wiederholung und atomare `.part`-Übernahme. NAS-Zeitplanung bevorzugt über den Sync-Wrapper, nicht nur `--since yesterday`. |
| `discover_stations.py` | Vorläufige Auswahl aus Stationsmetadaten, ohne lange Preishistorie. |
| `ingest_history.py` | M2-Aufbereitung; gerasterte Daten sind nicht automatisch zeitgenaue Live-Beobachtungen. |
| `run_pipeline.py` | Optionale vertiefte Historien-/Stationsanalyse, kein Installationsbeginn mehr. Schützt Sets anderer Städte vor Überschreiben. |
| `export_influx.py` | Nur lesender Live-Export, bestehender Lesezugang über `--env-file`; keine InfluxDB-Einrichtung. |
| `road_route.py` | Routing für die vertiefte Umweg-/Kostenbewertung. |

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
[INSTALL.md](../docs/INSTALL.md); Download-Optionen zeigt `fetch_history.py --help`.

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
[KONZEPT.md](../docs/KONZEPT.md). `analysis/config.local.json` enthält Anker und
Bundesländer; diese private Datei nicht durch eine Beispielkonfiguration ersetzen.

- `analysis/station_selection.py --help`: Raster, Coverage-Gate (Default 85 %),
  Netto-Vorteil, Tankmenge, Zeit-/Spritkosten und Routing. Bei gerasterten M2-CSVs
  das Analyse-Raster passend wählen, etwa `--step-min 30`; fehlende Beobachtungen
  nicht durch beliebig lange Fortschreibung als Qualitätsnachweis ersetzen.
- `analysis/window_analysis.py --help`: Polling-Fenster auf vorhandenen Daten prüfen.
- Ausgaben bleiben lokal: `results/station_scores_<fuel>.csv`,
  `docs/analysis/report_top10.md` und `docs/analysis/figures/`.
- Preis-Zwillinge und explizite Ersatzvorschläge: [Engine-Referenz](../engine/README.md#preis-zwillinge).
  Ein Vorschlag ändert nicht das aktive Set und repariert keine Namenskollisionen.

Spezialfälle nur bei Bedarf: [UUID-Migration](../docs/STATIONS-UUID.md) und
[Engine-Diagnose](../engine/README.md).