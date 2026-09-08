# Sofort starten: Archiv-Warmstart, Polling und weitere Städte

Stand: 08.09.2026. **Strategie und erster implementierter Baustein**, nicht die
Abnahme einer fertigen Tankempfehlung.

## 1. Die Entscheidung

**Nicht drei Monate auf Daten warten.** Das laufende Polling bleibt an.
Die bereits über GitLab bezogenen Tankerkönig-Daten liefern die Vorgeschichte
für Stationsauswahl, Tages-/Wochenmuster und erste Modellvergleiche auf dem PC.
Polling liefert die aktuellen Preise und die zukünftigen echten Kontrollwerte.

Das sind **nicht „Tankerkönig versus eigene Preise“**, sondern dieselben
Marktpreise über zwei Bezugswege:

| Bezugsweg | Nutzen | Einschränkung |
|---|---|---|
| GitLab-Archiv bis gestern, Stations- und Preisdateien | Sofortiger Warmstart, lange Vergleiche, neue Städte/Stationen | Verzögert; vorhandene M2-CSVs sind bereits gerastert/rekonstruiert und haben keinen verlässlichen Öffnungsstatus. |
| Tankerkönig-API → Pi-Polling → InfluxDB | Aktueller Preis/Status und fortlaufende Beobachtungen | Erst seit tatsächlichem Polling vorhanden; Ausfälle bleiben sichtbar. |

`source=history` beziehungsweise `source=influxdb` beschreibt im Engine-CSV den
**Bezugsweg**, keinen zweiten Anbieter. `station_id`/UUID und Kraftstoff sind
die fachliche Identität; Stationsnamen sind keine Schlüssel. Unterschiedliche
Stadtlabels für dieselbe UUID werden im neuen Bootstrap nicht still verdoppelt,
sondern zur Korrektur gemeldet.

### Was ist sofort möglich?

- **Live-Preise: jetzt**, soweit das Polling frische Antworten liefert.
- **Erste unkalibrierte Prognosen: jetzt mit ausreichender Archivhistorie.**
  Die Engine verlangt standardmäßig mindestens 28 nutzbare Trainingstage und
  verwendet höchstens die letzten 42 Kalendertage. 90 Archivtage sind ein
  sinnvoller Startbestand; 42 Trainingstage + 21 Backtesttage benötigen einen
  entsprechend langen zusammenhängenden Zeitraum, nicht 90 Tage neues Polling.
- **Belastbare „jetzt/warten/woanders“-Empfehlungen:** erst nach Modellvergleich,
  Prüfung gegen frische Live-Beobachtungen, Kalibrierung und Kostenprüfung.
  Dafür gibt es keinen ehrlichen garantierten Termin und keine automatische
  Freigabe allein wegen „drei Monate alt“.

Mehr PC-Rechenleistung beschleunigt Fits und Backtests. Sie ersetzt keine
unbeobachteten Live-Tage, hilft aber, die schon vorhandene Historie sofort zu nutzen.

## 2. Jetzt implementiert: `engine bootstrap`

Der Befehl erzeugt eine **abgeleitete CSV** und einen JSON-Übergangsbericht.
Er schreibt weder in InfluxDB noch in das aktive Polling-Set; Originaldateien
bleiben erhalten. Der Collector läuft unabhängig weiter.

### Regel pro Station und Kraftstoff

1. Ohne Polling: vorhandene Historie verwenden (`history_only`).
2. Mit Polling: Archiv nur **vor dem ersten Live-Verfügbarkeitsrasterpunkt**,
   danach ausschließlich Polling (`bootstrap`). Beide Abschnitte bilden eine
   Trainingsreihe. Selbst ein späterer Archivpreis im selben 5-Minuten-Bucket
   darf einen Live-Status `closed`/`no prices` nicht ersetzen.
3. Nach **90 vollständigen lokalen Tagen** im jüngsten 90-Tage-Fenster, mit
   **mindestens 95 % verwertbaren tatsächlichen Antworten an jedem Tag**, und
   frischer letzter verwertbarer Antwort: Archivzeilen ganz aus dieser
   abgeleiteten Datei ausschließen (`live_only`).
4. Der laufende, noch unvollständige Tag zählt nicht. Maßgeblich ist das
   konfigurierte Polling-Fenster (Default 06–24 Uhr, Europe/Berlin), nicht 24/7.
   Sommer-/Winterzeit wird über lokale Kalendertage berücksichtigt.

Eine verwertbare Antwort ist `open` mit gültigem Preis für den Kraftstoff oder
`closed` mit bekanntem Status. Ein geschlossener Betrieb ist kein
Collector-Ausfall. `no prices`, unbekannter Status, ungültige Preise und
Forward-Fill zählen **nicht** als erfolgreiche Preis-/Statusabdeckung. Eine
nur geschlossene Station kann damit eine vollständige Statushistorie haben,
aber trotzdem kein fitbares Preismodell — das prüft weiterhin die Engine.

95 % täglich und 90 Tage sind **konservative betriebliche Standardwerte**, keine
statistisch bewiesene Prognosegüte. Anpassbar mit `--min-daily-coverage` und
`--live-only-days`. Die Frischegrenze ist die Engine-Grenze von 30 Minuten,
bezogen auf den letzten erwarteten Polling-Rasterpunkt; die Nachtpause gilt
nicht als Ausfall.

**Wichtig: Das Standardmodell nutzt nur 42 Tage.** Wenn diese vollständig im
Polling-Zeitraum liegen, besteht sein Training schon vor Tag 90 praktisch nur
noch aus Polling-Daten. Die 90-Tage-Regel entfernt zusätzlich die ältere
Archiv-Vorgeschichte aus dem Bootstrap-Datensatz. Sie ist keine Wartefrist
für den ersten Fit. Die Archivdateien bleiben für Forschung und neue Stationen
aufbewahrt; sie werden nicht gelöscht.

### Lücken und Rückfall

Die Regel wird bei jedem Aufruf neu geprüft, nicht dauerhaft als Schalter
festgeschrieben. Eine junge Station in Gütersloh kann `bootstrap` bleiben,
während eine ältere Station bereits `live_only` erreicht.

Bei schlechter Abdeckung oder veraltetem Export lautet der Modus wieder
`bootstrap`. **Das bedeutet nicht, dass Archivpreise Live-Lücken reparieren:**
Die Grenze am ersten Live-Punkt bleibt bestehen. Alte, verzögerte Preise dürfen
keine Öffnungsstatus-Sperre aufheben oder als aktuelle Antworten erscheinen.
Bei langem Ausfall kann deshalb trotz vorhandenen Archivs ein Fit scheitern.
Ein expliziter, gekennzeichneter Reparaturpfad ist ein weiterer Arbeitsschritt,
kein heimlicher Fallback. Bestehende Modellartefakte werden bei fehlgeschlagenem
Fit nicht ersetzt; die Prognose meldet veraltete Modelle/Daten.

### Aussagekraft historischer Tests

`ingest_history.py` wurde für M2-Stationsselektion gebaut: Es bildet unter
anderem Medianwerte in rückwärts beschrifteten Zeit-Buckets und kann Preise
fortschreiben. Das lässt sich durch späteres Zusammenführen nicht rückgängig
machen. Ein 06:00-M2-Bucket ist daher **nicht automatisch ein um 06:00 live
bekannter Preis**. Archiv-Ergebnisse dienen zunächst der retrospektiven
Modellprüfung, nicht als Beweis eines damals ausführbaren Handels-/Tankentscheids.

Der Übergangsbericht setzt deshalb ausdrücklich
`historical_backtest_is_operational_replay=false`, `calibrated=false` und
`decision_ready=false`. Ein ereignisgenauer Archivadapter mit UTC-Offsets,
Preisänderungs-/Entfernungsflags und getrennter Verfügbarkeitszeit ist vor einer
seriösen zeitgenauen Abnahme erforderlich. Kein Schönrechnen durch dichteres
Raster oder als Beobachtung gezählte Rekonstruktionen.

## 3. Windows-PC: bestehende Dateien direkt nutzen

Voraussetzung: die [M3-Python-Umgebung](../engine/README.md) ist installiert,
die privaten M2-Dateien und das aktive `polling.json` liegen auf deinem PC.
Für den Bootstrap selbst ist kein neuer Schlüssel und kein Download nötig.

### Einmaliger Start ohne Live-Export

```powershell
.\.venv-m3\Scripts\python.exe -m engine bootstrap --data "data/ready/*_hist.csv*" --polling docs/analysis/stations/polling.json
```

### Mit laufend aktualisiertem Live-Export

Den vorhandenen InfluxDB-Lesezugang verwenden. **120 Tage explizit exportieren:**
der bisherige Exporter-Default ist 70 Tage; damit wäre die 90-Tage-Prüfung nie
vollständig. Ein Export ab einem Datum vor Polling-Start ist zulässig.

```powershell
$Since = (Get-Date).AddDays(-120).ToString('yyyy-MM-dd')
.\.venv-m3\Scripts\python.exe data-tools/export_influx.py --env-file data/influx.env --polling docs/analysis/stations/polling.json --fuel e10 --uuid-only --since $Since --out data/engine/influx_e10.csv.gz
# Nur nach erfolgreichem Export fortfahren.
.\.venv-m3\Scripts\python.exe -m engine bootstrap --data "data/ready/*_hist.csv*" data/engine/influx_e10.csv.gz --polling docs/analysis/stations/polling.json
```

Falls noch kein einziger passender Live-Punkt exportiert werden kann, zunächst
nur den Historienbefehl verwenden, keine leere Datei oder Demo erzeugen.
Den bestehenden Export-/UUID-Zugang bei Problemen nach
[engine/README.md](../engine/README.md) prüfen, nicht parallel einen neuen
produktiven PC-Collector starten.

Ausgaben:

- `data/engine/bootstrap.csv.gz` — Eingang für die bestehenden M3-Befehle;
- `data/engine/bootstrap.csv.gz.policy.json` — Modus, Tage, schlechteste
  Tagesabdeckung, Frische und verwendete Zeilenzahlen **je Station**.

Die Defaults gelten für E10; für E5/Diesel entsprechend `--fuel` und getrennte
Ausgabepfade verwenden. Nicht `data/engine/*.csv*` als Eingabe verwenden, weil
sonst die eigene Bootstrap-Ausgabe erneut eingelesen würde. Ausgabe auf einer
Eingabedatei wird abgewiesen. Ohne `--at` gilt jetzt als exklusiver Cutoff;
für reproduzierbare historische Läufe einen ISO-Zeitpunkt mit Offset angeben.

Anschließend die vorhandene Engine benutzen, jeden Schritt nur bei erfolgreichem
Vorgänger ausführen:

```powershell
.\.venv-m3\Scripts\python.exe -m engine inspect --data data/engine/bootstrap.csv.gz
.\.venv-m3\Scripts\python.exe -m engine backtest --data data/engine/bootstrap.csv.gz --days 21
.\.venv-m3\Scripts\python.exe -m engine fit --data data/engine/bootstrap.csv.gz
.\.venv-m3\Scripts\python.exe -m engine forecast
```

Der letzte Befehl liefert weiterhin einen **unkalibrierten Ausblick ab dem
Fit-Cutoff**, keine fertige Alltagsempfehlung. Historie bis gestern ist kein
aktueller Nowcast. Die Übergangswahl geschieht beim Bootstrap automatisch;
**zeitgesteuerter Export, Aufrufkette und Veröffentlichung sind noch nicht
implementiert**. Die obigen Befehle sind der prüfbare Zwischenstand, nicht der
gewünschte dauerhafte Bedienaufwand.

## 4. Gütersloh aufnehmen — ja, ohne neue Modellarchitektur

### Was du einmalig festlegen musst

- Einen sinnvollen Anker in Gütersloh: tatsächlicher Startpunkt/regelmäßiges Ziel,
  nicht automatisch Stadtmitte. Koordinaten nur lokal hinterlegen.
- Ob Gütersloh regelmäßig gebraucht wird oder nur gelegentlich. Das beeinflusst
  später das aktive Polling-Budget und die Stadtauswahl, nicht die UUID-Identität.

In `analysis/config.local.json` die bisherigen Einträge **behalten** und ergänzen:

- `home`: Schlüssel `Gütersloh` mit `[Breitengrad, Längengrad]` des eigenen Ankers;
- `subdiv`: Schlüssel `Gütersloh` mit `NW` (Nordrhein-Westfalen).

Keine echten Koordinaten in Git. Das Bundesland wirkt heute in M2 bei der
Feiertagsbehandlung; zusätzliche M3-Feiertagseffekte sind noch offen.

### Was heute schon geht

Mit der bestehenden **M2-Umgebung** neu ingestieren/selektieren, damit der neue
Anker wirklich in den Daten und Bewertungen enthalten ist. Bereits vorhandene
bundesweite Rohdaten müssen nicht erneut geladen werden:

```powershell
.\.venv\Scripts\python.exe data-tools/run_pipeline.py --skip-fetch --poll-city "Gütersloh" --out-stations docs/analysis/stations-guetersloh
```

`--skip-fetch` nur bei vorhandenen vollständigen Roh- und Stationsdateien
verwenden; sonst weglassen, dann wird der eingerichtete GitLab-Zugang genutzt.
Bei veralteter Stationsliste zuerst mit `fetch_history.py --stations-latest`
und dem vorhandenen netrc-Zugang aktualisieren. Die Pipeline lädt die Liste
bisher automatisch nur, wenn noch keine vorhanden ist.

**Nicht `--skip-ingest`/`--skip-select` verwenden**, wenn Gütersloh neu hinzukommt.
Routing-/Radius-/Kostenparameter aus deinem bisherigen Lauf beibehalten;
gegebenenfalls dieselben `--router osrm`-Optionen ergänzen.

Ergebnis: separate `docs/analysis/stations-guetersloh/polling.json` und ein
Stationsbericht. Das Frankfurter Set bleibt erhalten. Neu ist ein Schutz:
Ein Stadtlauf bricht ab, wenn sein Ausgabeziel bereits ein Set anderer Städte
enthält; das alte Set wird nicht ersetzt. Selektionsberichte aller Städte können
neu berechnet werden, der aktive Collector wird dadurch nicht umkonfiguriert.

Gütersloh sofort historisch vorbereiten:

```powershell
.\.venv-m3\Scripts\python.exe -m engine bootstrap --data "data/ready/*_hist.csv*" --polling docs/analysis/stations-guetersloh/polling.json --out data/engine/guetersloh.csv.gz
.\.venv-m3\Scripts\python.exe -m engine inspect --data data/engine/guetersloh.csv.gz --out results/engine/guetersloh-quality.json
```

### Was für paralleles Live-Polling noch fehlt

Der Collector kann aktuell **ein Stadtset je Prozess** abfragen. Er verteilt
nicht automatisch mehrere Stadtsets auf gemeinsame API-Requests. Deshalb nicht
einfach Gütersloh auf den Pi kopieren und den bisherigen Dienst verdrängen oder
zwei unkoordinierte Collector-Prozesse mit demselben Key starten.

Nächster Baustein: ein zentraler Scheduler mit UUID-Deduplizierung, Batches bis
10 UUIDs, gemeinsamem Request-Abstand/Backoff entsprechend den Bedingungen des
bestehenden API-Zugangs, unverwechselbarer Stadt-/Stationszuordnung und sicherer
Puffer-/Ack-Verarbeitung. Dann Frankfurt **und** Gütersloh über einen Collector
betreiben. UUIDs mehrerer Region-Kontexte werden einmal gepollt, Entfernungen und
Empfehlungen aber je Anker gerechnet. Kein Vermischen der Preisniveaus beider
Städte und keine Empfehlung, allein zum Sparen zwischen Städten zu fahren.

## 5. Nächste Implementierungsschritte — priorisiert

| Reihenfolge | Paket | Fertig, wenn … |
|---|---|---|
| **Jetzt umgesetzt** | Bootstrap, konservative Bezugsweg-Grenze, 90-Tage-Prüfung je UUID/Kraftstoff, Übergangsbericht, Schutz bestehender Stadtsets | Automatisierte Tests einschließlich unbekanntem Status, Lücken, Cutoffs, Zeitumstellung und jungem Zweitstandort bestehen. Echt-Daten-Lauf noch erforderlich. |
| **1** | Ereignisgenauer Archivadapter aus vorhandenen Rohdaten; Stationsmetadaten aktualisieren | Zeitstempel/Offsets und Entfernungsflags bleiben erhalten; kein Future-Leak durch M2-Bucket-Mediane; rekonstruierte Zustände zählen nicht als echte Poll-Antwort. |
| **2** | Ein Update-Befehl mit privater Konfiguration: inkrementeller Archivabruf bei Bedarf → UUID-Live-Export → Bootstrap → Qualität → Fit/Backtest → Prognose | Einmal starten, bei Fehlern letzte gute Veröffentlichung behalten, Frische/Fehler klar melden; anschließend Windows-Aufgabenplanung oder NAS-Timer. Historienabruf aussetzen, wenn alle benötigten Reihen live-only sind; bei neuen Stationen wieder zulassen. |
| **3** | Gütersloh und Mehrstadt-Polling | Ein API-Budget/Scheduler, getrennte Ankerbewertungen, keine Überschreibung Frankfurts; getestete Upload-/Export-Zuordnung. Nur Anker und gewünschte Städte einmal vom Nutzer nötig. |
| **4** | M3-Echt-Datenvergleich und Kalibrierung | Archiv-Warmstart gegen saisonale Naive; eingefrorene Prognosen anschließend gegen echte zukünftige Polls auswerten. MASE/MAE, Intervalldeckung/-breite und tatsächlichen Netto-Tanknutzen je Station/Stadt prüfen; keine pauschale Freigabe nach 90 Tagen. |
| **5** | Entscheidungs-API und vorhandene Homepage verbinden | Frischer Preis, geeignete Station, sinnvolles Zeitfenster und Netto-Vorteil; bei Unsicherheit ehrlich keine belastbare Warteempfehlung. Gestaltung aus `sample/good gui` und `sample/good statistic gui` erhalten. |

Zielbedienung: **Stadt/Route, Tankbedarf — Empfehlung ansehen — tanken.**
Kein tägliches CSV-Kopieren oder Modellparameter-Tuning. Der PC dient jetzt der
schnellen Rechenwerkstatt; der spätere automatische Betrieb gehört auf ein
verlässlich laufendes NAS, während der Pi unabhängig weiter sammelt.
