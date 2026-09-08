# Datenwerkzeuge — Referenz, keine Installationskette

**[Einziger Installationseinstieg: docs/INSTALL.md](../docs/INSTALL.md).**
Nicht alle Skripte nacheinander ausführen. Der normale Einstieg sind die
gebündelten Befehle aus `tankapp.py`, mit vorhandener Python-Standardbibliothek:

| Befehl | Gerät | Erledigt gemeinsam |
|---|---|---|
| `tankapp.py add-city` | am einfachsten Pi; NAS/PC möglich | Anker lokal erfassen, Stationsliste nutzen/holen, neues Stadtset vorbereiten, alte Sets erhalten. Kein Preisdownload nötig. |
| `tankapp.py activate-polling` | Pi, `sudo` | Vorige Auswahl sichern, validierten Vorschlag übernehmen, Collector/Uploader neu starten; Rückfall bei Restartfehler. |
| `tankapp.py history-sync` | NAS | Ein Jahr Preis-/Stationsarchiv initial laden, vorhandene Dateien überspringen, alle fehlenden Tage nachholen; für cron/Start-Aufgabe. |

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

Spezialfälle nur bei Bedarf: [UUID-Migration](../docs/STATIONS-UUID.md),
[Preis-Zwillinge](../docs/PREIS-ZWILLINGE.md),
[HTTP-/Datenformatdetails](../docs/DATEN-BEZUG.md),
[Engine-Diagnose](../engine/README.md).
