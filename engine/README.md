# M3 am Windows-PC testen – PowerShell-Anleitung

Du kannst **Tests, Datenprüfung, Backtests und Modell-Fits vollständig auf deinem
Windows-PC** ausführen. Mit den vorhandenen M2-CSV-Dateien brauchst du dafür
weder NAS-Zugriff noch einen API-Schlüssel. Der Export der Live-Daten aus InfluxDB
ist eine zusätzliche Möglichkeit, kein Pflichtschritt für den lokalen Einstieg.

**Collector und Uploader auf dem Pi laufen unverändert weiter.** Auf dem PC wird
für M3 kein weiterer Uploader gestartet, keine InfluxDB installiert und nichts
am Bucket oder an den Ack-Dateien geändert. Kein WSL, Docker oder SSH erforderlich.

M3 ist weiterhin ein erster, **unkalibrierter** Durchstich, keine fertige
Entscheidungs-App. Die beiden GUI-Samples bleiben die Homepage-Basis
([Übernahmeregeln](../sample/README.md)); diese Anleitung startet die M3-Werkzeuge,
nicht die spätere Homepage.

## Welcher Schlüssel wird wofür verwendet?

| Was du am PC machen willst | Zugangsdaten |
|---|---|
| Automatisierte Tests ausführen | **Keine**; die Tests verwenden temporäre Testdaten und kontaktieren das NAS nicht. |
| Vorhandene Analyse-CSVs prüfen / backtesten / fitten | **Keine**; die Dateien liegen bereits auf deinem PC. |
| Aktuelle Preise mit dem Collector abfragen | **`data\apikey.txt`**: vorhandener Tankerkönig-Schlüssel, wird automatisch gelesen (§7). |
| Live-Historie aus InfluxDB exportieren | **Separater InfluxDB-Lese-Token**. Empfohlen: vier Konfigurationswerte in `data\influx.env`, mit `--env-file` laden (§3B). Eine reine Token-Datei bleibt als Alternative möglich. |

**`data\apikey.txt` nicht mit einem InfluxDB-Token überschreiben.** Es sind zwei
verschiedene Zugänge. Schlüsseldateien bleiben privat; `data\` ist gitignored.
Die Schlüssel nicht in Chat, Git oder ausgeschriebene Terminal-Befehle kopieren.

## 1. PowerShell und Python vorbereiten

Öffne **PowerShell im TankApp-Ordner** (z. B. über das Terminal von VS Code).
Alle folgenden Befehle laufen dort, nicht im Unterordner `engine`:

```powershell
Get-Location
Test-Path .\engine\requirements.txt
py -3 --version
```

`Test-Path` muss `True` liefern. Python muss **3.11 oder neuer** sein.
Falls `py` fehlt, Python mit Python-Launcher installieren und PowerShell neu öffnen.
Falls `py -3` eine ältere Version auswählt, eine aktuelle Version installieren
oder beim folgenden Anlegen gezielt z. B. `py -3.11` statt `py -3` verwenden.

Eigene Umgebung für M3 anlegen; die bisherige M2-Umgebung `.venv` bleibt erhalten:

```powershell
py -3 -m venv .venv-m3
.\.venv-m3\Scripts\python.exe --version
.\.venv-m3\Scripts\python.exe -m pip install -r requirements-dev.txt
```

Auch die zweite Versionsausgabe muss mindestens 3.11 sein. Eine bereits passende
`.venv-m3` kannst du weiterverwenden; dann den ersten Befehl auslassen.
`.venv-m3\` ist gitignored. `requirements-dev.txt` installiert die Engine und die
Testwerkzeuge; die benötigten Windows-Zeitzonendaten (`tzdata`) kommen über pandas mit.

**Keine Aktivierung nötig:** Wir rufen `python.exe` direkt aus dieser Umgebung auf.
Dadurch musst du weder `Activate.ps1` ausführen noch die PowerShell-ExecutionPolicy
ändern. Bei Installationsfehlern erst deren Ursache beheben, nicht mit den
nächsten Schritten fortfahren.

## 2. Zuerst die automatisierten Tests (ohne Daten / Schlüssel / NAS)

```powershell
.\.venv-m3\Scripts\python.exe -m pytest -q
.\.venv-m3\Scripts\python.exe -m ruff check engine data-tools/export_influx.py tests
.\.venv-m3\Scripts\python.exe -m ruff format --check engine data-tools/export_influx.py tests
```

Erwartet: Tests erfolgreich, Lint/Formatprüfung ohne Fehler. Die Fixtures werden
nur in temporären Testverzeichnissen erzeugt, nicht im Live-Puffer oder Bucket.
**Grüne Softwaretests sind noch kein Gütenachweis deiner Preisprognosen.**

## 3. Echte Daten auswählen – A oder B

Für die folgenden Auswertungen brauchst du das **aktive Polling-Set aus M2**
auf dem PC. Es wird nicht mit Git heruntergeladen, weil es private Daten enthält:

```powershell
Test-Path .\docs\analysis\stations\polling.json
```

Erwartet: `True`. Falls es fehlt, deine vorhandene Originaldatei an diesen Ort
kopieren; den laufenden Collector dafür nicht neu konfigurieren. Mit `--polling`
werden genau die ausgewählten UUIDs geprüft. Fehlende Stationen werden nicht
still aus der Auswertung ausgeschlossen.

### A. Vorhandene M2-Historie auf dem PC – empfohlener Einstieg

Wenn deine aufbereiteten CSV-Dateien noch unter `data\ready\` liegen, kannst du
**direkt ohne API-Key und ohne InfluxDB-Verbindung** weitermachen:

```powershell
Get-ChildItem .\data\ready\*.csv* | Select-Object Name, Length
$Daten = @('data/ready/*.csv*')
```

Es müssen tatsächliche `.csv`/`.csv.gz`-Dateien im Analyse-Schema vorhanden sein,
nicht nur rohe Tankerkönig-Tagesdateien oder der JSONL-Puffer des Collectors.
Wenn sie woanders liegen, den Pfad in `$Daten` entsprechend anpassen.
Die Engine löst das Muster `*.csv*` selbst auf.

**Jetzt mit §4 fortfahren.** Abschnitt B ist nur nötig, wenn du zusätzlich oder
stattdessen die laufende InfluxDB-Historie verwenden willst.

### B. Optional: Live-Historie vom NAS auf den Windows-PC exportieren

Der PC muss das NAS erreichen können (im selben Netz oder über eine bereits
vorhandene VPN-Verbindung). Die folgende Adresse entspricht der bestehenden
Installation; falls dein NAS anders erreichbar ist, hier und in der URL anpassen:

```powershell
Test-NetConnection -ComputerName 192.168.178.61 -Port 8086
```

Erwartet: `TcpTestSucceeded : True`. Den Port nicht dafür ins Internet freigeben.

**Einmalig:** In der InfluxDB-Weboberfläche unter API Tokens ein eigenes Custom-Token
mit **Leserecht nur für den Bucket `tankapp`** anlegen. Kein Admin-Token, kein
Schreibrecht. Das laufende Uploader-Token und `/etc/tankapp/env` auf dem Pi bleiben
unverändert. Es muss ein **InfluxDB-Token** sein, nicht der Tankerkönig-Key.

#### Empfohlen: komplette Konfiguration als Datei laden

Die vier Werte gehören zusammen in eine eigene private Datei **`data\influx.env`**.
Nicht die Collector-Datei `data\apikey.txt` dafür verwenden oder überschreiben:

```powershell
New-Item -ItemType Directory -Force -Path .\data | Out-Null
notepad .\data\influx.env
```

Diesen Aufbau als **Klartext / UTF-8** speichern (auch UTF-8 mit BOM ist erlaubt).
Nur den Platzhalter für den Token durch deinen tatsächlichen InfluxDB-Lese-Token
ersetzen; NAS-Adresse/Org/Bucket gegebenenfalls anpassen:

```dotenv
TANKAPP_INFLUX_URL=http://192.168.178.61:8086
TANKAPP_INFLUX_ORG=gtwrlab
TANKAPP_INFLUX_BUCKET=tankapp
TANKAPP_INFLUX_TOKEN=<DEIN-INFLUXDB-LESE-TOKEN>
```

Vier `NAME=WERT`-Zeilen, keine PowerShell-Befehle (`$env:`), kein `Token `-Präfix,
keine Markdown-Links mit `[]()` um die URL. Die Datei muss `influx.env` heißen,
nicht `influx.env.txt`. Leere Zeilen, ganze Kommentarzeilen mit `#` und passende
äußere Anführungszeichen sind erlaubt. Keine weiteren Variablen/Inline-Kommentare
hineinkopieren. Die Datei ist über `data\` gitignored; privat halten, nicht teilen.

Nach dem Aktualisieren des Exporters kannst du direkt starten:

```powershell
# Optional: eine versehentlich mit dem gesamten Dateiinhalt befüllte Variable entfernen
Remove-Item Env:\TANKAPP_INFLUX_TOKEN -ErrorAction SilentlyContinue

# Vorschau: keine Verbindung / Authentifizierung, aber polling.json muss vorhanden sein
.\.venv-m3\Scripts\python.exe .\data-tools\export_influx.py --env-file .\data\influx.env --dry-run

# Tatsächlicher Export: standardmäßig letzte 70 Tage, E10
.\.venv-m3\Scripts\python.exe .\data-tools\export_influx.py --env-file .\data\influx.env
Test-Path .\data\engine\influx_e10.csv.gz
```

**Mit `--env-file` zählt nur diese Datei.** Alte oder falsch gesetzte
`TANKAPP_INFLUX_…`-Variablen im PowerShell-Fenster werden ignoriert; fehlende Werte
werden nicht daraus ergänzt. Der Exporter liest die Datei bei jedem Aufruf neu,
führt ihren Inhalt aber niemals als Code aus. Keine Aktivierung oder
Session-Konfiguration erforderlich. **Ohne `--env-file`** gilt weiterhin die
Umgebungsvariablen-Variante unten; es wird keine Datei automatisch gesucht.

Bei einem Fehler hier anhalten. Eine alte Exportdatei kann weiterhin existieren;
`Test-Path : True` allein beweist deshalb keinen erfolgreichen neuen Export.
Nach Erfolg meldet das Skript die exportierten Zeilen und gültigen Preise.

Optional mit festem Zeitraum (`--until` ist **exklusiv**, Datumsgrenzen ohne
Offset sind Berliner Ortszeit); das `--env-file` auch hier mitgeben:

```powershell
.\.venv-m3\Scripts\python.exe .\data-tools\export_influx.py --env-file .\data\influx.env --since 2026-07-01 --until 2026-09-07
```

#### Fehlerfall: `Invalid header value` nach `Get-Content -Raw`

Wenn die Datei mehrere Zeilen wie `TANKAPP_INFLUX_URL=…`, `…_ORG=…`,
`…_BUCKET=…`, `…_TOKEN=…` enthält, ist sie eine **Konfigurationsdatei**, kein einzelner
Token. `Get-Content -Raw` liest den gesamten Inhalt; `.Trim()` entfernt nur
Leerzeichen/Zeilenumbrüche an den Rändern, nicht die inneren Zeilenumbrüche.
Die ganze Datei landet dann fälschlich im Authorization-Header.

- **Vier Konfigurationszeilen:** wie oben in `data\influx.env` speichern und
  mit `--env-file .\data\influx.env` laden. Nicht per `Get-Content -Raw` in
  `$env:TANKAPP_INFLUX_TOKEN` schreiben.
- **Nur ein einzelner InfluxDB-Token:** dafür funktioniert die alternative
  Token-Datei unten. Keine `TANKAPP_INFLUX_…=`-Zeilen hineinschreiben.
- **`data\apikey.txt`:** ist für den Tankerkönig-Collector vorgesehen. Falls dort
  versehentlich die Influx-Konfiguration gespeichert wurde, diese in einer eigenen
  Datei ablegen und für den Collector wieder dessen tatsächlichen Schlüssel
  bereitstellen. Ein Tankerkönig-Key authentifiziert nicht bei InfluxDB.

Der aktualisierte Exporter erkennt mehrzeilige/ungültige Token **vor dem
HTTP-Aufruf**, nennt den passenden Dateimodus und gibt den Token-Inhalt dabei
nicht aus. Auch rohe Header-/Kodierungsfehler der HTTP-Bibliothek werden nicht
mehr ungefiltert ins Terminal geschrieben.

**Falls eine ältere Fehlermeldung einen echten Schlüssel vollständig angezeigt
hat und er in Chat, Log oder Screenshot geteilt wurde:** den betroffenen Schlüssel
beim jeweiligen Dienst ersetzen. Auch Linkziele in formatierten Fehlertexten
prüfen: geschwärzter sichtbarer Text allein entfernt einen Token dort nicht.
Keine ungeschwärzten Fehlertexte mit Tokens posten.

#### Alternative: bestehende Datei mit nur einem Token weiterverwenden

Wenn `data\influx-token.txt` **ausschließlich den InfluxDB-Token in einer Zeile**
enthält, kannst du bei der bisherigen Methode bleiben. Nicht beide Dateiformate
mischen. Die folgenden Variablen in jedem neuen PowerShell-Fenster setzen:

```powershell
$env:TANKAPP_INFLUX_URL = 'http://192.168.178.61:8086'
$env:TANKAPP_INFLUX_ORG = 'gtwrlab'
$env:TANKAPP_INFLUX_BUCKET = 'tankapp'
$env:TANKAPP_INFLUX_TOKEN = ([string](Get-Content -LiteralPath .\data\influx-token.txt -Raw -ErrorAction Stop)).Trim()
if ([string]::IsNullOrWhiteSpace($env:TANKAPP_INFLUX_TOKEN)) { throw 'data\influx-token.txt ist leer.' }

# In dieser Variante ausdrücklich ohne --env-file
.\.venv-m3\Scripts\python.exe .\data-tools\export_influx.py
```

Hier lädt **PowerShell** die Token-Datei. Der Exporter liest anschließend die vier
Umgebungsvariablen. Der Token-Inhalt steht nicht im eingegebenen Befehl oder in
der Shell-History. `--dry-run` ist auch hier nur eine Query-Vorschau, kein Nachweis,
dass URL, Token und Berechtigungen für den echten Export bereits korrekt sind.

Für §4 **eine** Datenvariante wählen – nur Dateien aufnehmen, die existieren:

```powershell
# Nur der Live-Export
$Daten = @('data/engine/influx_e10.csv.gz')
```

Oder, wenn die Live-Serie noch jung ist und deine M2-Dateien vorhanden sind:

```powershell
# M2-Historie plus Live-Export
$Daten = @('data/ready/*.csv*', 'data/engine/influx_e10.csv.gz')
```

Der Export verwendet ausschließlich `POST /api/v2/query`, keine Writes/Deletes.
Leere Abfragen oder Teil-Downloads ersetzen nicht den letzten guten Export.
`closed`, `no prices` und fehlende Sorten bleiben Statuszeilen, niemals Preis 0.
Der bestehende `station`-Tag enthält Namen: `(city, station)` wird über das
Original-Polling-Set auf UUIDs aufgelöst. **Unbekannte/mehrdeutige Namen führen zum
Abbruch**; bestehende mehrdeutige Serien werden nicht geraten oder verändert.

## 4. Datenqualität und Backtest auf dem PC

Im **selben PowerShell-Fenster** weiterarbeiten. `$Daten` enthält die gewählte
Dateiliste aus §3; `@Daten` übergibt ihre Einträge als einzelne Argumente an Python.
Nach einem Terminal-Neustart zuerst wieder in den TankApp-Ordner gehen und eine
der passenden `$Daten = @(...)`-Zeilen ausführen.

```powershell
# Funktioniert auch mit wenigen Live-Tagen
.\.venv-m3\Scripts\python.exe -m engine inspect --data @Daten --polling .\docs\analysis\stations\polling.json

# Qualitätsbericht ansehen
Get-Content .\results\engine\quality.json -Encoding UTF8

# Anschließend täglich rollierend prüfen, nicht zufällig Training/Test mischen
.\.venv-m3\Scripts\python.exe -m engine backtest --data @Daten --polling .\docs\analysis\stations\polling.json --days 21

# Direkt nach dem Backtest: 0 = berechnet, 1 = Eingabefehler, 2 = keine Vergleichspunkte
$LASTEXITCODE

# Bericht im Editor öffnen (oder report.md in VS Code ansehen)
notepad .\results\engine\backtest\report.md
```

- `quality.json`: Tage mit nutzbaren Preisen, Abdeckung, Datenquellen,
  Fortschreibungen, ungültige Zeitstempel/Preise und unbekannte Öffnungsstatus.
- `results\engine\backtest\report.md`: Messwerte, Kriterien und offene Punkte.
- Daneben: `report.json` mit allen Stationstagen/Skip-Gründen und
  `predictions.csv.gz` mit den einzelnen Out-of-sample-Vergleichen.

**Noch zu wenig Historie?** Ein Fit benötigt mindestens 28 nutzbare Tage mit
ausreichend offenen Preisen; das Trainingsfenster umfasst 42 Tage. Für 21 Prüf-Tage
mit jeweils vollem Training mindestens **63 Tage** bereitstellen. Ein Export der
letzten 70 Tage erzeugt keine fehlende Vergangenheit, wenn InfluxDB erst seit
Kurzem gefüllt wird. Weiter sammeln oder vorhandene Historie ergänzen, nicht die
Mindesttage zum Erzwingen eines Erfolgs herabsetzen.

Alte M2-Dateien (`--resample 30 --density 60`) sind kein dichtes Live-Raster.
Rekonstruierte Stand-Zeilen und fehlende Öffnungsstatus bleiben Einschränkungen;
`open` ist bei Historie ohne Status nur eine Annahme. Bei Bedarf vorhandene
Rohdateien separat mit `ingest_history.py --resample 0 --density 5` aufbereiten
([Datenbezug](../docs/DATEN-BEZUG.md)), nicht die M2-Dateien überschreiben.
Das erzeugt **keine zusätzlichen echten Polls**. Exakt überlappende Live-Statuszeilen
haben Vorrang. Mehrdeutige/nicht existente lokale Sommerzeit-Zeitstempel werden
verworfen und gezählt, nicht erfunden.

`Exit 0` bedeutet **nicht „M3 bestanden“**. Der Backtest bewertet den folgenden
lokalen Tag im Poll-Fenster 06–24 Uhr auf gemeinsamer Datenbasis mit der saisonalen
Naiven. Engine-Forward-Fill wird nicht als Testbeobachtung gezählt. MASE nutzt nur
die saisonale Fehlerskala aus dem Training und ist bei konstanten Reihen undefiniert.
Ein exakter Einzelpunkt-Test bei +24 h und weitere Horizonte sind gesondert offen.

## 5. Modell fitten und Prognose erzeugen

Nach ausreichender Datenprüfung, weiterhin mit derselben Dateiliste:

```powershell
.\.venv-m3\Scripts\python.exe -m engine fit --data @Daten --polling .\docs\analysis\stations\polling.json --out .\data\models\forecast.json

# Nur nach erfolgreichem Fit: Inference aus dem gespeicherten Modell, ohne Netzwerk / Refit
.\.venv-m3\Scripts\python.exe -m engine forecast --model .\data\models\forecast.json --hours 24

# Ausgabe ansehen
Get-Content .\data\engine\forecast.json -Encoding UTF8
```

Alles bleibt lokal auf dem PC; es gibt noch kein automatisches Deployment auf
Pi/NAS. Fehlgeschlagene Fits ersetzen das letzte gültige Modell nicht. Die Prognose
beginnt am **Fit-Cutoff**, nicht stillschweigend bei „jetzt“. Modelle älter als 24 h
und bereits am Cutoff veraltete Eingangsdaten werden gekennzeichnet.

Optional: Backtest-Ende mit `--until 2026-09-07`, Fit-Cutoff mit
`--at 2026-09-07T00:00:00+02:00` festlegen. Die Beispieltermine durch den gewünschten
Zeitraum ersetzen. `--hours 72` / `168` liefert nur vorläufige Mehrtage-Ausblicke.

Die JSON-Artefakte enthalten robuste Tagesform/Wochentags-Dummies, AR(2)-Nachlauf
und einen Residuen-Tagesblock-Bootstrap. q.025/.10/.50/.90/.975 sind
**unkalibrierte Intervalle**, keine ACI-Erfolgswahrscheinlichkeiten.
`calibrated: false` und `decision_ready: false` bleiben gesetzt. Preise werden
höchstens 30 Minuten fortgeschrieben, geschlossene/veraltete Preise nicht gefittet.

## 6. Häufige Probleme am Windows-PC

| Meldung / Situation | Was du tun solltest |
|---|---|
| `py` nicht gefunden / Python <3.11 | Aktuelles Python samt Launcher installieren; PowerShell neu öffnen. Bei mehreren Versionen die gewünschte beim Anlegen von `.venv-m3` ausdrücklich auswählen. |
| `python.exe` / Modul `engine` nicht gefunden | Repository-Wurzel und aktuellen Code-Stand prüfen; §1 ausführen. Nicht den globalen Interpreter statt `.venv-m3\Scripts\python.exe` verwenden. |
| `Activate.ps1` wird blockiert | Keine ExecutionPolicy ändern. Die Anleitung braucht keine Aktivierung. |
| `polling.json` fehlt | Originales aktives M2-Set auf den PC kopieren. Private Dateien kommen nicht mit Git. |
| Keine Dateien für `data/ready/*.csv*` | Aufbereitete Historie bereitstellen oder erfolgreich exportieren und `$Daten` auf die tatsächlich vorhandenen Dateien umstellen. |
| Fehlende ausgewählte UUIDs | CSV-Zeitraum und gewähltes Polling-Set abgleichen; bei mehreren Sets gezielt `--poll-city Frankfurt` (oder tatsächlichen Set-Namen) ergänzen. |
| `$Daten` ist leer / neue PowerShell geöffnet | Eine passende Dateiliste aus §3 erneut setzen. Beim Export `--env-file` mitgeben oder in der alternativen Variante die vier Influx-Variablen laden. |
| NAS nicht erreichbar | `Test-NetConnection` prüfen; Netz/VPN/Adresse kontrollieren. Für Variante A ist das NAS nicht nötig. |
| `Invalid header value` / Token enthält Konfigurationszeilen | Ganze `NAME=WERT`-Datei mit `--env-file data/influx.env` laden, nicht mit `Get-Content -Raw` als Token. Siehe Fehlerfall in §3B. |
| `--env-file` nicht erkannt | Repository auf den aktuellen Stand bringen; der alte Exporter kannte diesen Schalter noch nicht. |
| Konfigurationsdatei, Zeile … | Nur die vier dokumentierten Namen verwenden; UTF-8, doppelte Einträge und Anführungszeichen prüfen. Keine PowerShell-Befehle, keine reine Token-Datei. |
| Influx HTTP 401/403 | Separaten InfluxDB-Lese-Token und Bucket-Recht prüfen, **nicht** den Tankerkönig-Key verwenden. |
| Influx HTTP 404 / keine Zeilen | Organisation, Bucket und Zeitraum prüfen. Eine alte Exportdatei ist kein Nachweis, dass der neue Lauf erfolgreich war. |
| Stationsname mehrdeutig | Original-Polling-Set/Writer-Schema prüfen. Gleichnamige Stationen im alten Influx-Schema lassen sich nicht zuverlässig rückwirkend trennen. |
| Zu wenig Training / Exit 2 | QA und Skip-Gründe lesen, mehr Historie bereitstellen; keine Demo-Daten als Ersatz einspeisen. |

Für Diesel/E5 beim Export `--fuel diesel` / `--fuel e5` zusätzlich setzen
(bei der Dateivariante weiterhin mit `--env-file`). Danach die
entsprechende Datei (`influx_diesel.csv.gz` / `influx_e5.csv.gz`) in `$Daten`
aufnehmen und bei `inspect`, `backtest` und `fit` `--fuel DIESEL` / `--fuel E5`
ergänzen. Vorhandene Historie muss ebenfalls diese Sorte enthalten.

## 7. Optional: Collector am PC mit `data\apikey.txt` prüfen

**Kein notwendiger M3-Schritt.** Für einen einzelnen Test der Tankerkönig-Anbindung
kannst du deine vorhandene Schlüsseldatei unverändert verwenden. Sie enthält
nur den Tankerkönig-Key in einer Zeile (UTF-8 ohne BOM, keine Anführungszeichen).
Den Inhalt nicht im Terminal ausgeben.

Wenn der Pi denselben Key verwendet, seinen Collector für diesen **optionalen**
Einzeltest pausieren: mindestens **300 Sekunden nach dem letzten Pi-Request**
warten, dann den PC-Test durchführen und wieder mindestens 300 Sekunden bis zum
nächsten Request einhalten. Keinen zweiten Dauer-Collector daneben starten.
Für die normalen M3-Schritte oben bleibt der Pi unverändert in Betrieb.

```powershell
Test-Path .\data\apikey.txt
Test-Path .\docs\analysis\stations\polling.json

# Nur in dieser PC-Sitzung: eine eventuell gesetzte Variable würde die Datei übersteuern
Remove-Item Env:\TANKERKOENIG_API_KEY -ErrorAction SilentlyContinue

# Separater Testpuffer, nie der produktive Pi-/Uploader-Puffer
.\.venv-m3\Scripts\python.exe .\data-tools\collect_prices.py --once --out .\data\pc-test-poll
```

Beide `Test-Path`-Abfragen müssen `True` sein. Bei mehreren Polling-Sets
`--poll-city Frankfurt` bzw. den tatsächlichen Set-Schlüssel ergänzen.
Erfolg: eine Preistabelle, `Poll ok: …` und eine JSONL-Datei in `data\pc-test-poll\`;
der Collector beendet sich nach einem erfolgreichen Poll. Bei API-Fehlern kann
auch `--once` erneut versuchen; bei Bedarf mit **Strg+C** abbrechen.

Der produktive Uploader darf diesen Testpuffer nicht einlesen. Ein einzelner
Snapshot ist außerdem noch keine Trainingshistorie; die M3-Engine liest die
Analyse-CSVs aus §3, nicht direkt diese JSONL-Datei.

## Noch offen in M3

1. Zweitmodell (ETS/Local-Level) und inverse-MASE-Ensemble aus vorangehenden Tests.
2. Gepoolte Feiertagseffekte und Sprungzustand im Strukturmodell.
3. CUSUM-Sprungtage, gesonderte MASE <0,80 an sprungfreien Tagen.
4. Out-of-sample-Intervallkalibrierung / ACI nach ausreichender Live-Historie.
5. Echt-Daten-Abnahme: MASE <0,95 gesamt, Pinball besser als Naive,
   PICP 95 % zwischen 90–98 %. Keine alten Demo-Messwerte übernehmen.
