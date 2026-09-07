# M3 – Prognose-Werkstatt mit echten Daten

**Erster M3-Durchstich, noch keine M3-Abnahme.** Collector und Uploader bleiben
unverändert in Betrieb. Der neue Export liest InfluxDB nur; Fits und Backtests
laufen separat auf **NAS oder PC**, nicht im laufenden Pi-Collector.

## Was implementiert ist

- InfluxDB 2.x → CSV/CSV.gz, mit Status und UUID-Zuordnung über `polling.json`.
- 5-Minuten-Raster, höchstens 30 Minuten Forward-Fill; `closed`, `no prices`
  und eine fehlende Sorte stoppen die Fortschreibung. Kein Backfill aus der Zukunft.
- UTC intern, Tagesform/Wochentag und Backtest-Cutoff in `Europe/Berlin`.
- Robuste harmonische Regression (zwei Harmonische, Wochentags-Dummies)
  plus stabiler AR(2)-Residuen-Nachlauf; saisonale Naive als Benchmark.
- **Unkalibrierter** Residuen-Tagesblock-Bootstrap: q.025/.10/.50/.90/.975.
  Unbeobachtete Tageszeiten werden nicht als belastbare Prognose ausgegeben.
- Täglicher Rolling-Origin-Backtest, MAE/RMSE/MASE, sMAPE, Pinball τ=.5,
  PICP/MPIW 95 %, Stations- und Tagesdiagnosen.
- Versionierte, atomar geschriebene JSON-Modelle; Inference ohne Refit, Netzwerk
  oder ausführbare Pickle-Dateien. Ausgabe enthält Datenstand und Staleness.

Die **beiden GUI-Samples bleiben die Homepage-Basis** ([Leitplanken](../sample/README.md)).
Diese Engine ersetzt schrittweise deren simulierte Datenlogik, nicht deren Gestaltung.

## 1. Einrichtung auf NAS/PC

Python **3.11+** für die Engine; der Export selbst braucht nur Python **3.9+**
und Standardbibliothek. Die Collector-Installation auf dem Pi muss nicht geändert werden.
Alle Befehle ab Repository-Wurzel:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r engine/requirements.txt
```

Windows/PowerShell: `py -3 -m venv .venv`, danach
`.\.venv\Scripts\Activate.ps1`. Ohne Aktivierung stattdessen
`.\.venv\Scripts\python.exe` verwenden. `tzdata` wird für Windows über pandas installiert.

## 2. InfluxDB nur lesen

Das **originale, aktive** `docs/analysis/stations/polling.json` lokal auf NAS/PC
bereitstellen (wie bisher privat/gitignored). Bei mehreren Sets optional
`--poll-city Frankfurt` verwenden.

Ein eigenes Token mit **Leserecht nur für den TankApp-Bucket** in der InfluxDB-Web-UI
anlegen. Kein Admin-Token und kein Schreibrecht nötig. Konfiguration in einer
privaten Datei außerhalb des Repos, z. B. `~/.config/tankapp/read.env` (chmod 600),
mit denselben Variablennamen wie beim Uploader:

```dotenv
TANKAPP_INFLUX_URL=http://<NAS-IP>:8086
TANKAPP_INFLUX_ORG=gtwrlab
TANKAPP_INFLUX_BUCKET=tankapp
TANKAPP_INFLUX_TOKEN=<NUR-LESE-TOKEN>
```

Nicht die laufende `/etc/tankapp/env` auf dem Pi überschreiben. Token nicht in
CLI-Argumente, Git oder Chat kopieren. Auf Linux die private Datei laden:

```bash
set -a; . "$HOME/.config/tankapp/read.env"; set +a

# Ohne Netzwerk/Token: Umfang und erste Flux-Query prüfen
python data-tools/export_influx.py --dry-run

# Default: letzte 70 Tage bis jetzt, E10, eine Query pro 24-h-Teilfenster
python data-tools/export_influx.py
# → data/engine/influx_e10.csv.gz

# Alternativ expliziter Zeitraum; --until ist EXKLUSIV
python data-tools/export_influx.py --since 2026-07-01 --until 2026-09-07
```

Unter PowerShell die vier Variablen als `$env:TANKAPP_INFLUX_…` aus einer lokalen
Secret-Konfiguration bereitstellen; Export- und Engine-Befehle bleiben gleich.
Mit `--fuel diesel` bzw. `--fuel e5` exportieren, dann in der Engine
`--fuel DIESEL` bzw. `--fuel E5` setzen. Die Standarddatei heißt entsprechend
`influx_diesel.csv.gz` / `influx_e5.csv.gz`.

**Sicherheits- und Schemaeigenschaften:**

- Nur `POST /api/v2/query`; keine Writes, Deletes, Bucket-Änderungen oder ACKs.
- Explizite Zeitintervalle, Streaming-CSV; geschlossene/fehlende Preise bleiben
  als Statuszeilen erhalten, niemals als Preis `0.000`.
- Eine leere oder fehlgeschlagene Abfrage ersetzt **nicht** den letzten guten Export.
  Fehler nach einem Teil-Download hinterlassen keine scheinbar vollständige Datei.
- Tokens nur im Authorization-Header; keine Weitergabe bei HTTP-Redirects.
- Der bestehende Uploader verwendet **Stationsnamen** im Tag `station`, keine UUIDs.
  Der Export löst `(city, station)` über das Polling-Set auf; UUID-Tags werden auch erkannt.
  **Unbekannte/mehrdeutige Namen führen zum Abbruch**, nicht zu geratenen IDs.
  Bei gleichnamigen Stationen im selben Markt ist die alte Influx-Serie bereits
  nicht eindeutig; Original-Polling-Set/Writer-Schema prüfen. Der Export repariert
  oder verändert vorhandene Serien bewusst nicht.

## 3. Erst Datenqualität ansehen

Das funktioniert auch mit wenigen Live-Tagen:

```bash
python -m engine inspect --data data/engine/influx_e10.csv.gz \
  --polling docs/analysis/stations/polling.json
```

`results/engine/quality.json` zeigt u. a. Tage mit offenen Preisen,
Beobachtungs-/Fortschreibungszahlen, Poll-Abdeckung, ungültige Preise,
Zeitzonenprobleme und unbekannte Öffnungsstatus. Fehlende gewählte Stationen
werden nicht stillschweigend aus der Auswertung entfernt.

**Wenn die Live-Serie erst gerade begonnen hat:** weiter sammeln; die Engine
meldet fehlende Historie statt Demo-Prognosen zu erzeugen. Vorhandene M2-Historie
im Analyse-CSV-Schema kann zusätzlich als Trainingseingang dienen:

```bash
python -m engine inspect --data "data/ready/*.csv*" data/engine/influx_e10.csv.gz \
  --polling docs/analysis/stations/polling.json
```

Bei exakt überlappenden Zeitstempeln haben Live-Statuszeilen Vorrang. Alte
Selektionsdateien (`--resample 30 --density 60`) sind **kein** dichtes Live-Raster.
Für dichteres Training die vorhandenen Rohdateien bei Bedarf erneut mit
`ingest_history.py --resample 0 --density 5` in ein **separates** lokales
Verzeichnis einlesen ([Datenbezug](../docs/DATEN-BEZUG.md)); das erzeugt
rekonstruierte Preisstände, **keine** zusätzlichen echten Polls/Öffnungszeiten.
In historischen Dateien fehlen oft Status und UTC-Offset. Dann ist `open`
nur eine Annahme; mehrdeutige/nicht existente lokale Sommerzeit-Zeitstempel
werden verworfen und gezählt. Das ist kein Ersatz für einen Live-Nachweis.

## 4. Rolling-Backtest

```bash
python -m engine backtest --data data/engine/influx_e10.csv.gz \
  --polling docs/analysis/stations/polling.json --days 21
```

Bei Bedarf dieselbe erweiterte `--data`-Liste wie oben verwenden.
Default: bis zur letzten vollständigen lokalen Kalendergrenze; alternativ
`--until 2026-09-07` (Mitternacht Berlin, exklusiv).

Pro Station/Tag wird **neu und ausschließlich mit Daten vor dem Cutoff** gefittet.
Trainingsfenster: 42 Tage, mindestens 28 nutzbare Tage und ausreichend offene
Punkte. Für 21 Prüf-Tage mit jeweils vollem Training mindestens **63 Tage**
Historie bereitstellen; kürzere Fenster werden sichtbar ausgewiesen. Die
Mindesttage nicht herabsetzen, um eine Abnahme zu erzwingen.

Ausgaben in `results/engine/backtest/`:

- `report.md` – lesbare Messwerte, Kriterien und offene Punkte.
- `report.json` – QA, alle Stations-/Tagesergebnisse, Lücken, Quellen und Skip-Gründe.
- `predictions.csv.gz` – zeitgestempelte Out-of-sample-Prognosen und Vergleichspreise.

Bewertet wird der folgende lokale Tag **innerhalb 06–24 Uhr** (anpassbar mit
`--poll-start/--poll-end`); keine exakte Einzelpunkt-Messung bei +24 h.
Modell und Naive werden nur auf ihrer **gemeinsamen** Datenbasis verglichen;
deren Abdeckung wird separat ausgewiesen. Engine-Forward-Fill zählt nicht als
Testbeobachtung. Historische Stand-Zeilen bleiben als solche gekennzeichnet.
MASE verwendet ausschließlich die saisonale Fehlerskala aus dem jeweiligen
Training; bei einer konstanten Reihe ist MASE **undefiniert**, nicht 0.

`Exit 0` bedeutet „Bericht erfolgreich berechnet“, **nicht** „M3 bestanden“.
Keine auswertbaren Punkte: Exit 2 mit Diagnosebericht. Ungültiger Eingang: Exit 1.

## 5. Fit und Inference getrennt

```bash
# Rechenarbeit auf NAS/PC; Cutoff standardmäßig letzter Rasterpunkt + 5 min
python -m engine fit --data data/engine/influx_e10.csv.gz \
  --polling docs/analysis/stations/polling.json --out data/models/forecast.json

# Optional reproduzierbarer Cutoff: --at 2026-09-07T00:00:00+02:00
# Ohne neue Fits / ohne Zugriff auf InfluxDB:
python -m engine forecast --model data/models/forecast.json --hours 24
# → data/engine/forecast.json
```

Die Prognose beginnt am **Fit-Cutoff**, nicht stillschweigend bei „jetzt“.
Alte Modelle (>24 h) und bereits am Cutoff veraltete Daten werden gekennzeichnet.
Für den Pi werden später nur die Artefakte verteilt; ein automatischer
Deployment-/Nowcast-Dienst ist noch nicht Bestandteil dieses Durchstichs.

`--hours 72` / `168` erzeugt vorläufige Ausblicke; dafür ist hier **kein**
Mehrtage-Gütenachweis implementiert. q.025–q.975 sind Bootstrap-Intervalle,
**nicht ACI** und keine kalibrierten Erfolgswahrscheinlichkeiten. Alle
Ausgaben behalten `calibrated: false` und `decision_ready: false`.

## Noch offen in M3

1. Zweitmeinung (ETS/Local-Level), inverse-MASE-Ensemble aus vorangehenden Tests.
2. Gepoolte Feiertagseffekte und Sprungzustand im Strukturmodell.
3. CUSUM-Sprungtage, gesonderte MASE <0,80 an sprungfreien Tagen.
4. Out-of-sample-Intervallkalibrierung / ACI nach ausreichender Live-Historie.
5. Echt-Daten-Abnahme: MASE <0,95 gesamt, Pinball besser als Naive,
   PICP 95 % zwischen 90–98 %. Keine historischen Demo-Messwerte übernehmen.

## Tests

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m ruff check engine data-tools/export_influx.py tests
```

Die Tests erzeugen ausschließlich kleine deterministische Fixtures in temporären
Verzeichnissen; kein Netzwerk zum NAS, kein Live-Bucket, keine produktiven Secrets.
