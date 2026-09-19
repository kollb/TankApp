# Engine-Referenz — optionale Modellwerkstatt

> Stand: 12.09.2026 · App-Version 0.11.0. Werkstatt-Referenz für `engine/` —
> **keine Installations-Checkliste**. Einrichtung: [INSTALL.md](INSTALL.md),
> Betrieb: [BETRIEB.md](BETRIEB.md), Methodik im Überblick:
> [ANALYSE.md](ANALYSE.md). Früher lag diese Datei als `engine/README.md` neben
> dem Code; Dokumentation hat jetzt einen Ort (`docs/`).

## Inhaltsverzeichnis

- [Bezugsweg-Regel](#bezugsweg-regel-für-die-entwicklung)
- [12-Uhr-Regel](#12-uhr-regel-preiserhöhungen-nur-um-1200-uhr)
- [Schlüssel-Übersicht](#welcher-schlüssel-wird-wofür-verwendet)
- [HTTP 401](#bereits-eingerichtet-aber-http-401)
- [RPi schreibt, PC scheitert](#rpi-schreibt-erfolgreich-aber-der-pc-scheitert-beim-lesen)
- [Browser-Abfrage](#browser-abfrage-funktioniert--anderes-projekt-schreibt-erfolgreich)
- [Preis-Zwillinge](#preis-zwillinge)
- [PowerShell & Python](#1-powershell-und-python-vorbereiten)
- [Softwaretests](#2-optionale-softwaretests-ohne-daten--schlüssel--nas)
- [Echte Daten wählen](#3-echte-daten-auswählen--a-oder-b)
- [Datenqualität & Backtest](#4-datenqualität-und-backtest-auf-dem-pc)
- [Modell fitten](#5-modell-fitten-und-prognose-erzeugen)
- [Messgrundlagen B0](#messgrundlagen-b0-seit-0560)
- [Häufige Probleme](#6-häufige-probleme-am-windows-pc)
- [Collector am PC prüfen](#7-optional-collector-am-pc-mit-dataapikeytxt-prüfen)
- [Noch offen M3](#noch-offen-in-m3)

---


**Keine Installations-Checkliste.** Der einzige Einstieg und die Reihenfolge
stehen in [INSTALL.md](INSTALL.md): Gütersloh sammeln, Live-GUI anbinden,
NAS-Archiv parallel füllen, danach automatische Berechnung/Empfehlungen.

Der gebündelte NAS-App-Dienst führt Archivabruf, Aufbereitung und Fits aus. Der Windows-PC
kann optional schneller rechnen; dafür vorhandenes Python 3.11+ verwenden,
**keine neue venv erforderlich**. Für `tankapp.py add-city` und `history-sync`
sind auch die untenstehenden Python-Pakete nicht nötig.

## Bezugsweg-Regel für die Entwicklung

`engine bootstrap` erzeugt eine abgeleitete CSV samt `.policy.json` aus vorhandenen
Archiv- und Influx-CSV-Dateien. Ein Datenanbieter, zwei Bezugswege. Archiv nur
vor dem ersten Live-Verfügbarkeitsbucket; danach Polling, ohne Archiv-Reparatur
von Live-Lücken oder Öffnungsstatus-Sperren. Unbekannter Archivstatus bleibt unbekannt.
Nach standardmäßig 90 vollständigen lokalen Tagen mit täglich mindestens 95 %
verwertbaren Antworten und frischer letzter Antwort entfällt die Archiv-Vorgeschichte
je UUID/Kraftstoff aus der abgeleiteten Datei. `--polling` berücksichtigt die
Kadenz des gemeinsamen Stadtplans; bei abweichendem Collector-Intervall oder
explizitem Ein-Stadt-Collector `--expected-poll-minutes` passend angeben.
Das Modell verwendet standardmäßig nur die letzten 42 Tage. **Das NAS-Roharchiv
und sein Sync laufen unabhängig davon weiter**, auch für ein Jahr oder mehr.

Die M2-CSVs können bereits rückwärts beschriftete Median-Buckets und Fortschreibungen
enthalten. Bootstrap macht daraus keinen zeitgenauen Live-Replay. Der NAS-Dienst
verwendet deshalb `app/history.py`: rohe Änderungsereignisse mit exakten,
offsetbehafteten Zeitstempeln, Änderungsflags und Löschsperren, keine M2-Median-
Buckets. Der Rohbestand wird nicht gelöscht. `app/refresh.py` bündelt Export,
Bootstrap, Fits, retrospektiven Backtest und atomare Veröffentlichung; diese
kann mit `python tankapp.py refresh-models` auch optional lokal angestoßen werden.
Out-of-sample-Kalibrierung, Betriebs-Replay und echte Güteabnahme bleiben offen.
`decision_ready=false` und `calibrated=false` bleiben deshalb richtig.

Entwicklerbeispiel (kein täglicher Bedienablauf):

```powershell
py -3 -m pip install -r engine/requirements.txt
py -3 -m engine bootstrap --data "data/ready/*_hist.csv*" data/engine/influx_e10.csv.gz --polling data/analysis/stations/polling.json
```

Zielsystem ist das **Linux-NAS** (und jedes Linux/PC-Entwicklungssystem):
dort lauten dieselben Befehle `python3` mit Schrägstrichen —

```bash
python3 -m pip install -r engine/requirements.txt
python3 -m engine bootstrap --data "data/ready/*_hist.csv*" data/engine/influx_e10.csv.gz --polling data/analysis/stations/polling.json
```

Die weiteren `py -3`-Befehle dieses Dokuments sind Windows-PC-Schreibweise
(optionaler schneller Rechenweg); jede Zeile läuft auf Linux als
`python3 <dieselbe Aufrufzeile>` ohne `py -3`-Prefix.

Ohne Live-Export nur die vorhandenen Archiv-CSVs angeben. Zum Nachweis von 90
Tagen mindestens diesen Zeitraum exportieren; der Exporter-Default von 70 Tagen
reicht dafür nicht. Beispielsweise mit `--since` einen Zeitpunkt 120 Tage vor
jetzt wählen. Exporte sind nicht der dauerhafte Archivspeicher: der liegt auf dem NAS.

## 12-Uhr-Regel: Preiserhöhungen nur um 12:00 Uhr

Seit 2026-04-01 dürfen Tankstellen in Deutschland den Preis nur um 12:00 Uhr
erhöhen; Senkungen sind jederzeit möglich (`price_law_local` in der
`Config`). Die Engine überträgt das auf drei Ebenen:

1. **Strukturmodell:** Neben den Harmonischen und Wochentags-Dummies trägt ein
   Mittags-Schritt („nach 12:00 Uhr, ab Gesetzesbeginn“) das eigene
   Nachmittag-Niveau direkt ab. Die Harmonischen müssen den täglichen
   Sprung dadurch nicht mehr als glatte Kurve nachzeichnen — eine Prognose
   zeigt deshalb keinen unrechtmäßigen intraday-Anstieg mehr.
2. **Prognose-Projektion:** Median und jede Bootstrap-Path werden je Segment
   [12:00 Uhr, nächste 12:00 Uhr) auf *nicht-steigend* projiziert
   (Pool-adjacent-violators). Der erlaubte Sprung liegt exakt an der
   Segmentgrenze und bleibt erhalten; Segmente, die vor dem Gesetzesbeginn
   begannen (z. B. in alten Backtests), werden nicht projiziert. NaN bleibt
   NaN — über Lücken hinweg wird nicht gekoppelt.
3. **Datenqualität statt stiller Korrektur:** Beobachtete Anstiege von
   mindestens 1 ct, deren 5-Minuten-Intervall keinen erlaubten 12:00-Uhr-Punkt
   enthält, werden im Fit als `law_rise_outside_noon` gezählt und im
   Backtest-Report ausgewiesen. Solche Punkte sind mögliche Datenartefakte
   (z. B. gemeldete Zwischenstände) oder Regelverstöße; sie verbleiben im
   Modell und werden nicht still gelöscht.

<details>
<summary>Entwicklerdiagnose und manuelle Einzelwerkzeuge — nur bei Bedarf</summary>

## Welcher Schlüssel wird wofür verwendet?

| Was du am PC machen willst | Zugangsdaten |
|---|---|
| Automatisierte Tests ausführen | **Keine**; die Tests verwenden temporäre Testdaten und kontaktieren das NAS nicht. |
| Vorhandene Analyse-CSVs prüfen / backtesten / fitten | **Keine**; die Dateien liegen bereits auf deinem PC. |
| Aktuelle Preise mit dem Collector abfragen | **`data\apikey.txt`**: vorhandener Tankerkönig-Schlüssel, wird automatisch gelesen (§7). |
| Live-Historie aus InfluxDB exportieren | **Separater InfluxDB-Lese-Token**. Empfohlen: vier Konfigurationswerte in `data\influx.env`, mit `--env-file` laden (§3B). Für diesen PC-Ablauf keine zweite Token-Datei verwenden. |

**`data\apikey.txt` nicht mit einem InfluxDB-Token überschreiben.** Es sind zwei
verschiedene Zugänge. Schlüsseldateien bleiben privat; `data\` ist gitignored.
Die Schlüssel nicht in Chat, Git oder ausgeschriebene Terminal-Befehle kopieren.

## Bereits eingerichtet, aber HTTP 401?

**Bei `--env-file data/influx.env` bleiben.** Ein 401 ist eine Antwort eines
HTTP-Dienstes, keine fehlende lokale Datei. Der Zugriff wird verweigert: möglich
sind ein falscher/deaktivierter Token, fehlendes Leserecht, die falsche
Organisation/Instanz oder ein vorgeschalteter Proxy. Ein zwischenzeitlicher
Timeout ist ein zusätzlicher Transportfehler; bloßes Wiederholen oder Wechseln
zwischen `python` und `python.exe` löst die Berechtigung nicht.

Unter §3B steht der genaue Klickpfad zum **neuen InfluxDB-Lese-Token** und der
kurze Test `--check-connection`, der Health und Bucket-Zugriff getrennt prüft.
`data/influx-token.txt`, `$env:TANKAPP_INFLUX_TOKEN` und `Get-Content data/apikey.txt`
werden für diesen Ablauf **nicht benötigt**. Die Engine bekommt weder den
Tankerkönig-Key noch das Passwort deiner Browser-Anmeldung.

## RPi schreibt erfolgreich, aber der PC scheitert beim Lesen?

Das ist kein Widerspruch: Der RPi-**Uploader** benutzt `POST /api/v2/write`,
der PC-**Exporter** `POST /api/v2/query`. Ein InfluxDB-Token kann für denselben
Bucket nur Schreibrechte haben. Die Datenansicht im Browser verwendet zudem
die Rechte deiner Browser-Anmeldung, nicht zwingend diesen API-Token.
Gemeint ist hier `TANKAPP_INFLUX_TOKEN` des Uploaders; der Tankerkönig-Key des
Collectors ist ein anderer Zugang.

**Bei einem Netz-/Lesefehler den Token aber nicht erneut blind wechseln.**
`/health` ist ein eigener GET ohne Token. Sein Erfolg beweist, dass dieser
Aufruf klappt, nicht dass auch der POST und dessen komplette Antwort ankommen.
Der Windows-PC kann andere Proxy-/VPN-/Netzfilter-Einstellungen nutzen als der Pi.
Vergleiche URL, Organisation und Bucket lokal mit der Uploader-Konfiguration,
ohne deren Inhalte oder Schlüssel zu posten.

Der aktualisierte Verbindungstest zeigt deshalb zusätzlich den von `urllib`
vorgesehenen HTTP-Weg sowie bei Fehlern **Phase, HTTP-Status, Fehlerklasse,
`errno` und gegebenenfalls `winerror`**. Rohe Fehlermeldungen, Proxy-Adressen und
Zugangsdaten bleiben ausgeblendet. Details und ein gezielter Proxy-Vergleich
stehen in §3B; zunächst denselben Standard-Test mit unverändertem Token ausführen.

## Browser-Abfrage funktioniert / anderes Projekt schreibt erfolgreich

Eine Data-Explorer-Antwort mit `prices`, den numerischen Feldern `e10`, `e5`,
`diesel` und einem getrennten String-Feld `status=open` passt zum vorhandenen
Datenmodell. Mehrere Tabellen sind bei `limit(n: 1)` normal: Das Limit gilt
**pro Serie/Tabelle**, nicht einmal über alle Kraftstoffe zusammen.

Der Authorization-Header bleibt bei beiden Operationen **`Authorization: Token …`**.
Der Unterschied liegt in Ziel und Datenformat:

| Zweck | Endpunkt | Content-Type / Inhalt |
|---|---|---|
| Schreiben, wie im RPi-/Smarthome-Projekt | `/api/v2/write?org=…&bucket=…&precision=s` | `text/plain`, Influx Line Protocol |
| Lesen für TankApp | `/api/v2/query?org=…` | `application/vnd.flux`, Flux-Abfrage als UTF-8-Text; Antwort CSV |

In `data/influx.env` bleibt **nur die Basisadresse** bei `TANKAPP_INFLUX_URL`;
keine vollständige `/api/v2/write?...`-URL hineinkopieren. Der Bucket `tankapp`
steht bei Leseabfragen im Flux-Code. Rechte für `smarthome` gelten nicht automatisch
auch für `tankapp` – bei einem Verbindungs-Reset den Token trotzdem nicht blind tauschen.

Der Exporter verwendet jetzt den
[dokumentierten Flux-Textmodus](https://docs.influxdata.com/influxdb/v2/query-data/execute-queries/influx-api/)
und im Verbindungstest dieselbe einfache Abfrage wie im Data Explorer:
`from` → `range` → `filter` → `limit(n: 1)`. Die bisherige JSON-Form mit
Dialekt-Einstellungen ist ebenfalls Bestandteil der API; die Vereinfachung ist
**ein gezielter Kompatibilitätstest**, kein Beweis für die Ursache von WinError 10054.
Es sind keine neue Schlüsseldatei, andere Berechtigungen oder Änderungen am NAS nötig.

## Preis-Zwillinge

Optionale Analyse, keine Installationsaufgabe: `engine compare-stations` vergleicht
originale UUID-getrennte Historien, nicht Stationsnamen oder einzelne aktuelle Preise.
Mit vorhandenen Engine-Paketen beispielsweise:

```powershell
py -3 -m engine compare-stations --data "data/ready/*.csv*" --polling data/analysis/stations/polling.json --poll-city Frankfurt --brand ARAL
```

Ausgabe: `results/engine/price_twins/report.md` und `report.json`. Seit 0.51.0
zählt der Vergleich nur Beobachtungen ab der 12-Uhr-Bodenkante (`--law-date`,
Default `price_law_local`; `--ignore-law-floor` mischt bewusst für eine
Gegenmessung) — Report und Konsole nennen Kante und ausgeblendete Punkte.
Zu kurze oder lückenhafte gemeinsame Historie ist kein Beleg für Preisgleichheit. Bei
unterschiedlichen Preisverläufen beide Stationen vorerst behalten. Eine mögliche
Redundanz ist ein Prüfhinweis, keine automatische Ausschlussentscheidung; auch
Nutzbarkeit und Standort zählen.

Nach manueller Prüfung kann `run_pipeline.py` mit `--exclude-uuid` und einem
**separaten** `--out-stations` einen Ersatzvorschlag aus bestehenden Kandidaten
berechnen. Die bisherigen Routing-/Kostenparameter beibehalten; `--skip-select`
nur bei passenden, unveränderten Scores/Metadaten. Dafür gelten zusätzlich die
Pakete aus `analysis/requirements.txt`. Ohne separates Ziel wird der Ausschluss
abgelehnt. Keine Kandidaten erfinden oder Grenzen lockern, um das Set aufzufüllen.

**Nicht als Reparatur vermischter Influx-Namensserien aktivieren.** Erst die
[UUID-Identität klären](archiv/STATIONS-UUID-MIGRATION.md); Vergleich und Vorschlag migrieren
keine Daten. Alte Daten oder Ack-Dateien nicht löschen/zurücksetzen. Der gebündelte
Aktivierungsbefehl `tankapp.py activate-polling` ist ausdrücklich nur für die
Addition neuer Stadtsets gedacht und weist Änderungen bestehender Sets ab.

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
oder beim Aufruf gezielt z. B. `py -3.11` statt `py -3` verwenden.

Vorhandenes Python verwenden; eine freiwillige bestehende Umgebung darf bleiben.
Für Softwareentwicklung (nicht den normalen Betrieb) die Testpakete installieren:

```powershell
py -3 -m pip install -r requirements-dev.txt
```

Keine `Activate.ps1`, keine Änderung der ExecutionPolicy. Bei Paketkonflikten
nicht mit `--break-system-packages` erzwingen; das verwendete Python prüfen.

## 2. Optionale Softwaretests (ohne Daten / Schlüssel / NAS)

```powershell
py -3 -m pytest -q
py -3 -m ruff check engine data-tools/export_influx.py tests
py -3 -m ruff format --check engine data-tools/export_influx.py tests
```

Erwartet: Tests erfolgreich, Lint/Formatprüfung ohne Fehler. Die Fixtures werden
nur in temporären Testverzeichnissen erzeugt, nicht im Live-Puffer oder Bucket.
**Grüne Softwaretests sind noch kein Gütenachweis deiner Preisprognosen.**

## 3. Echte Daten auswählen – A oder B

Für die folgenden Auswertungen brauchst du das **aktive Polling-Set aus M2**
auf dem PC. Es wird nicht mit Git heruntergeladen, weil es private Daten enthält:

```powershell
Test-Path .\data\analysis\stations\polling.json
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

#### Bei HTTP 401: den richtigen Token erzeugen und prüfen

1. **Die bestehende InfluxDB auf dem NAS** im Browser öffnen (Adresse oben),
   nicht die Tankerkönig-Webseite und nicht die NAS-Verwaltungsoberfläche.
   Mit deinem vorhandenen InfluxDB-Benutzer anmelden. Eine erfolgreiche
   Browser-Anmeldung ersetzt **keinen API-Token**.
2. In InfluxDB die **bestehende Organisation `gtwrlab`** wählen und unter
   **Data / Load Data → Buckets** prüfen, dass dort `tankapp` vorhanden ist.
   Falls Namen abweichen, die tatsächlichen Namen in `data/influx.env` verwenden.
   **Keine neue Organisation/DB anlegen, keine bestehende Installation zurücksetzen.**
3. **Data / Load Data → API Tokens → Generate API Token** öffnen. Je nach
   UI-Version heißt der passende Typ **Custom API Token** oder **Read/Write Token**.
4. Beschreibung z. B. `TankApp-PC-Lesen`; im Bereich **Read / Lesen** ausschließlich
   den vorhandenen Bucket **`tankapp`** auswählen. **Write / Schreiben leer lassen.**
   Kein All-Access-/Admin-Token nötig. Ein nur zum Schreiben berechtigter
   Uploader-Token reicht zum Exportieren nicht unbedingt aus.
5. **Generate / Save** klicken und sofort den **vollständigen Token-Wert** kopieren
   und privat sichern. Nicht seine ID, Beschreibung, Benutzername oder Passwort.
   Bei neueren Versionen lässt sich der volle Wert später nicht erneut anzeigen;
   wenn du ihn nicht mehr hast, einen neuen Lese-Token erzeugen.
6. In **`data/influx.env` nur den Wert hinter `TANKAPP_INFLUX_TOKEN=`** ersetzen,
   Datei speichern und den Verbindungstest unten starten. In dieses Feld kommt
   weder der Tankerkönig-Key noch die gesamte Konfigurationsdatei.

**Collector und die bisherigen Zugangsdaten bleiben unverändert.**
Für den PC einen eigenen Lese-Token erstellen, nicht den laufenden Dienst
mit dem PC-Token umkonfigurieren. Die Stations-ID-Migration aktualisiert nur den
Uploader-Code und verwendet beim Replay dessen vorhandenen Schreibzugang. Anleitung des Herstellers:
[InfluxDB-API-Token anlegen](https://docs.influxdata.com/influxdb/v2/admin/tokens/create-token/).

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

#### Erst Verbindung prüfen – noch keinen 70-Tage-Export starten

Nach dem Aktualisieren des Repository-Stands im TankApp-Ordner **diesen einen
Aufruf** verwenden. `python` funktioniert bei dir bereits; für den reinen Exporter
reicht Python 3.9+ mit Standardbibliothek:

```powershell
python .\data-tools\export_influx.py --env-file .\data\influx.env --check-connection --timeout 15
```

Der Test braucht
weder `polling.json` noch Trainingsdaten, schreibt keine Exportdatei und gibt
keine Token-Inhalte aus. Er prüft nacheinander:

| Schritt | Bedeutung bei Erfolg / Vorgehen bei Fehler |
|---|---|
| **1/3 Konfiguration** | Datei/Format ist plausibel. Das ist **noch keine** erfolgreiche Authentifizierung. Platzhalter durch den vollständigen Token-Wert ersetzen. |
| **2/3 InfluxDB /health** | Der Dienst meldet sich bereit; dieser Request enthält **keinen Token**. Bei Fehler: URL/Port, InfluxDB-Version, NAS/VPN/Proxy prüfen. Ein Health-401 sagt noch nichts über die Token-Rechte aus. |
| **3/3 Bucket-Lesezugriff** | Eine echte begrenzte Flux-Abfrage wurde akzeptiert. Ein 401/403 **hier**: Token aus der richtigen Instanz, vollständiger Wert, Organisation und Read-Recht für `tankapp` prüfen; Schritte 1–6 oben. |

Erwartet am Ende: **`3/3 Lesezugriff: OK`** und **`Verbindungstest erfolgreich`**.
Die Probe fragt nur die letzte Stunde des `prices`-Measurements ab und liefert
höchstens eine Zeile **je Serie/Tabelle**, wie die funktionierende Browser-Abfrage.
Numerische Kraftstofftabellen und die separate String-Statustabelle sind erlaubt;
Preise werden nicht im Diagnoseprotokoll ausgegeben. Bei mehr als 4096 Ergebniszeilen
bricht der Test mit einem Größenhinweis ab. Auch ein leerer Zeitraum kann lesbar sein;
ein entsprechender Hinweis ist **kein Nachweis**, dass der Collector gerade Daten liefert.
Es werden keine Token-/Organisationslisten mit zusätzlichen Adminrechten abgefragt.

#### Abbruch eingrenzen, statt den Token immer wieder zu wechseln

Die Ausgabe `HTTP-Weg: …` beschreibt die Einstellungen, die Python/`urllib`
für den Zielhost vorfindet. Unter Windows können diese auch aus den
System-/Registry-Proxy-Einstellungen stammen. **Das ist ein Hinweis auf den
vorgesehenen Weg, kein Beweis für einen Proxy-Fehler.** Transparente Filter oder
Firewalls lassen sich dadurch nicht ausschließen.

| Zusatz in der Fehlermeldung | Aussage / nächster Schritt |
|---|---|
| `Phase=POST senden / HTTP-Header empfangen; HTTP=unbekannt` | Der POST hat noch keinen auswertbaren HTTP-Status geliefert. Nicht als falschen Key interpretieren; Fehlerklasse/Code beachten. |
| `Phase=CSV-Antwort lesen; HTTP=200` | Der Server hat eine HTTP-200-Antwort begonnen, der Abbruch liegt danach beim Lesen. Noch kein vollständiger Query-Erfolg; Stream-/Verbindungsproblem untersuchen statt blind den Token zu tauschen. |
| `ConnectionResetError` oder `winerror=10054` | Verbindung wurde zurückgesetzt. NAS, Proxy oder andere Zwischenstation kommen als Ursache infrage; der Code allein benennt den Verursacher nicht. |
| `ConnectionAbortedError` oder `winerror=10053` | Verbindung wurde abgebrochen. Windows-Netzfilter/Sicherheitssoftware, Netzwerk und NAS kontrollieren; nicht pauschal Schutzfunktionen deaktivieren. |
| `RemoteDisconnected` / `BrokenPipeError` | Gegenstelle/Verbindung wurde geschlossen, ohne den Austausch regulär abzuschließen. |
| HTTP 401/403 | Eine echte Antwort verweigert Zugriff. Hier sind Token-Rechte, Organisation/Bucket/Instanz oder Proxy-Zugriff zu prüfen. |
| Unbekannter Netz-/Lesefehler | Die sicheren Typ-/Code-/Phasenangaben weitergeben. Die alte pauschale Meldung „Netz-/Proxyfehler“ reichte nicht zur Ursachenzuordnung. |

Bei einer Zeitüberschreitung nennt die Ausgabe den betroffenen Schritt. Bei
tatsächlich langsamer Verbindung kann `--timeout 60` helfen; **mehr Timeout
behebt keinen 401 oder Verbindungs-Reset**. Keine Portfreigabe ins Internet und
keine pauschale Proxy-/TLS-Abschaltung vornehmen.

**Nur wenn ein Proxy vorgesehen ist und direkter NAS-Zugriff im eigenen LAN
zulässig ist:** ein kontrollierter Vergleich mit **denselben vier Werten in
`data/influx.env`**, ohne Key-Wechsel:

```powershell
python .\data-tools\export_influx.py --env-file .\data\influx.env --check-connection --timeout 15 --no-proxy
```

`--no-proxy` gilt nur für diesen Aufruf, verändert keine Windows-/Umgebungs-
Einstellungen und lässt die TLS-Zertifikatsprüfung sowie den Redirect-Schutz
aktiv. Nicht zum Umgehen verbindlicher Netzrichtlinien verwenden. Klappt nur
der direkte Test, spricht das für den unterschiedlichen Proxy-Weg; bei gleichem
Fehler nicht wahllos weitere Varianten ausprobieren, sondern die Diagnosezeilen
vergleichen. Für einen anschließend bewusst direkten Export denselben Schalter
auch beim Export mitgeben.

Wenn der Test weiterhin fehlschlägt, nur seine **Status-/Fehlerzeilen** zur
Fehlersuche weitergeben, **nicht den Inhalt von `influx.env` oder Schlüsseldateien**.
Wenn insbesondere die Browser-Abfrage funktioniert, der PC aber weiterhin mit
10054 vor den HTTP-Headern scheitert, beim nächsten Versuch zeitgleich die
InfluxDB-/Container-Logs auf dem NAS prüfen. Ein passender Fehler/Neustart hilft
bei der Zuordnung; fehlende Logzeilen beweisen bei deaktivierten Zugriffslogs
nicht, dass der Request das NAS nie erreicht hat. Keine vollständigen Token- oder
Header-Dumps veröffentlichen. Der Browser verwendet zudem seine eigene Anmeldung.
Die NAS-Verbindung/Berechtigung muss auf deinem PC geprüft werden; erfolgreiche
Softwaretests im Repository prüfen nicht deinen echten NAS-Token.

**Mit `--env-file` zählt nur diese Datei.** Falsch gesetzte `TANKAPP_INFLUX_…`-Werte
in der PowerShell-Sitzung werden ignoriert; fehlende Werte werden nicht ergänzt.
Deshalb jetzt keine weiteren `$env:…`-/`Get-Content`-Varianten ausprobieren.
Der Exporter führt die Datei nicht als Code aus. Der technische Umgebungsvariablen-
Modus bleibt für bestehende Aufrufe erhalten, ist aber **nicht Teil dieses PC-Ablaufs**.

#### Erst nach erfolgreichem Zugriff: eigentlichen Export starten

```powershell
py -3 .\data-tools\export_influx.py --env-file .\data\influx.env
Test-Path .\data\engine\influx_e10.csv.gz
```

Bei einem Fehler hier anhalten. Eine alte Exportdatei kann weiterhin existieren;
`Test-Path : True` allein beweist deshalb keinen erfolgreichen neuen Export.
Nach Erfolg meldet das Skript die exportierten Zeilen und gültigen Preise.

Optional mit festem Zeitraum (`--until` ist **exklusiv**, Datumsgrenzen ohne
Offset sind Berliner Ortszeit); das `--env-file` auch hier mitgeben:

```powershell
py -3 .\data-tools\export_influx.py --env-file .\data\influx.env --since 2026-07-01 --until 2026-09-07
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
- **Nur ein einzelner InfluxDB-Token:** seinen Wert hinter `TANKAPP_INFLUX_TOKEN=`
  in `data/influx.env` eintragen. Für diesen Ablauf keine zweite Token-Datei anlegen.
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

`--dry-run` bleibt eine reine Query-Vorschau ohne Netzwerk und ohne
Authentifizierung. Zur Diagnose der Verbindung **`--check-connection`** verwenden;
die beiden Schalter sind unterschiedliche Modi und nicht kombinierbar.

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
Neue Uploader-Punkte enthalten den **`station_id`-Tag**. Dieser wird direkt mit
dem ausgewählten Polling-Set abgeglichen; der Anzeigename `station` bleibt erhalten.
Nur alte Punkte ohne UUID benötigen die Namenszuordnung. **Unbekannte/mehrdeutige
Legacy-Namen führen zum Abbruch**, nicht zu geratenen IDs.

Bei `Aral Tankstelle: mehrdeutig` und unterschiedlichen Preisverläufen im Vergleich:
[Stations-UUID-Anleitung](archiv/STATIONS-UUID-MIGRATION.md) durchführen. Danach bewusst nur
UUID-getaggte Punkte lesen:

```powershell
python .\data-tools\export_influx.py --env-file .\data\influx.env --uuid-only
```

Das filtert alte Namensserien aus dem Export, **löscht sie aber nicht**. Für frühere
Daten sind Original-JSONL oder bereits UUID-getrennte Historien nötig. Ein bloßes
Entfernen einer Station aus `polling.json` repariert alte Namensserien nicht.

## 4. Datenqualität und Backtest auf dem PC

Im **selben PowerShell-Fenster** weiterarbeiten. `$Daten` enthält die gewählte
Dateiliste aus §3; `@Daten` übergibt ihre Einträge als einzelne Argumente an Python.
Nach einem Terminal-Neustart zuerst wieder in den TankApp-Ordner gehen und eine
der passenden `$Daten = @(...)`-Zeilen ausführen.

```powershell
# Funktioniert auch mit wenigen Live-Tagen
py -3 -m engine inspect --data @Daten --polling .\data\analysis\stations\polling.json

# Qualitätsbericht ansehen
Get-Content .\results\engine\quality.json -Encoding UTF8

# Anschließend täglich rollierend prüfen, nicht zufällig Training/Test mischen
py -3 -m engine backtest --data @Daten --polling .\data\analysis\stations\polling.json --days 21

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
([Datenformate](DATENWERKZEUGE.md#datenformate)), nicht die M2-Dateien überschreiben.
Das erzeugt **keine zusätzlichen echten Polls**. Exakt überlappende Live-Statuszeilen
haben Vorrang. Mehrdeutige/nicht existente lokale Sommerzeit-Zeitstempel werden
verworfen und gezählt, nicht erfunden.

`Exit 0` bedeutet **nicht „M3 bestanden“**. Der Backtest bewertet den folgenden
lokalen Tag im Poll-Fenster 06–24 Uhr auf gemeinsamer Datenbasis mit der saisonalen
Naiven. Engine-Forward-Fill wird nicht als Testbeobachtung gezählt. MASE nutzt nur
die saisonale Fehlerskala aus dem Training und ist bei konstanten Reihen undefiniert.
Zusätzlich bewertet der Report die **Mehrtage-Horizonte** (+3 d/+7 d: 24-h-Fenster
am Horizontbeginn, `horizons`) und das **Rolling-PICP 7 d je Station** mit
Konfidenz-Badge (grün ≥ 93 %, gelb ≥ 90 %, rot < 90 %, nominal 95 %;
weniger als 72 Punkte im Fenster = keine Aussage) — Grundlage des Güte-Gates
in der Entscheidung (Konzept §3.3.3/§3.4/§4.4).

**Zeitumstellung im Prüfzeitraum (H5):** Ein Zeitraum kann 23-h- und 25-h-Tage
enthalten (Frühjahr/Herbst). Sie bleiben im Backtest — ausgeschlossen oder auf
24 h gerechnet wird nichts, damit Kennzahlen und Fold-Zahl vergleichbar
bleiben. Stattdessen wird jeder solche Tag ausgewiesen: je Fold `dst_day` und
`local_day_hours`, im `report.json` der Block `dst` (`days`, `day_hours`,
`folds`, `folds_scored`, `anchors_missing_nat`, `anchors_outside_series`,
`mase_none_reasons`), im `report.md` der Abschnitt „Zeitumstellung (DST)“. Die
saisonale MASE-Skala verliert an diesen Tagen ihre 02:xx-Vortagesanker
(lokal nicht existent bzw. doppeldeutig → `NaT`); die Zahl steht als
`anchors_missing_nat` im Bericht, statt die Stichprobe still zu verkleinern.
Weil das Poll-Fenster 06–24 Uhr die 02:xx-Stunden nicht enthält, ändert das die
Kennzahlen im Regelfall nicht. Bleibt eine Skala trotzdem leer, ist
`mase: null` mit `mase_none_reason` (`no_scored_points`, `naive_scale_undefined`)
statt eines stillen Nullwerts ausgewiesen.

**Feiertags-Dummy (§3.2):** Mit `--city-subdivs "Frankfurt:HE;Gütersloh:NW"`
bekommt das Strukturmodell den gepoolten Feiertags-Dummy je Bundesland
(Paket `holidays` aus `engine/requirements.txt`); ohne Angabe trägt der
Dummy null. Der Koeffizient wird aus bis zu 365 Tagen geschätzt
(`holiday_pool_days`), nicht aus dem 42-Tage-Fenster.

**Gate-Metriken (Schwellen, Issue 47):** MASE und PICP95 bleiben; ergänzt um
asymmetrischen Pinball-Loss τ=0,75 — Unterschätzung des Preises (tatsächlich
teurer als prognostiziert, also Warten in eine Erhöhung) wird 3× so stark
bestraft wie Überschätzung. Kriterien in `report.json`/`report.md`:
`mase_24h_below_0_95` (MASE < 0,95), `pinball50_better_than_naive`,
`pinball_asym_better_than_naive` (τ=0,75 besser als saisonale Naive),
`picp95_between_90_and_98` (PICP 95 % ∈ [90, 98] %).

**Abdeckung vs. Reaktionszeit (Issue 46):** Der Residuen-Tagesblock-Bootstrap
zieht neuere Tagesblöcke exponentiell höher gewichtet (Default-Halbwertszeit
14 Tage, `--bootstrap-ew-half-life`; `0` = uniform). Das 42-Tage-Fenster wird
nicht pauschal verdoppelt. Zum Vergleich drei Backtests mit denselben Daten:

```powershell
# 42 Tage, exponentiell gewichtet (Default, empfohlen)
py -3 -m engine backtest --data @Daten --polling .\data\analysis\stations\polling.json --days 21 --out .\results\engine\backtest-42d-ew
# 42 Tage, uniform (Vergleich)
py -3 -m engine backtest --data @Daten --polling .\data\analysis\stations\polling.json --days 21 --bootstrap-ew-half-life 0 --out .\results\engine\backtest-42d-uniform
# 84 Tage, uniform (Trägheits-Vergleich; braucht 105+ Tage Historie)
py -3 -m engine backtest --data @Daten --polling .\data\analysis\stations\polling.json --days 21 --train-days 84 --min-train-days 28 --bootstrap-ew-half-life 0 --out .\results\engine\backtest-84d-uniform
```

Vergleiche `pinball_asym_ct` und `mase` je Variante: 42d-EW sollte nach
Preiswechseln schneller aufholen als 42d-uniform und weniger träge sein als 84d.

**Übergangsregel: 90 vs. 42 Tage Live-Input (offene Konzeptentscheidung):**
`live_only_days` (`bootstrap`, Default 90) entscheidet, ab wann das Archiv aus
dem Modell-Input fällt — sie liegt **nicht** im M7-Pfad (das Kalibrierungs-Gate
zählt abgeschlossene Empfehlungen, nicht Tage). Eine Senkung ist deshalb keine
Zeitersparnis für M7, sondern ein Eingriff in die Trainingsdatenmenge: Ab
Handover trainiert der Fit nur noch auf Live-Polling, sein Fenster ist
`train_days` (Default 42), die harte Untergrenze `min_train_days` (28,
`engine/models.py::fit`). Wer senken will, misst es auf **live-only**
exportierten Daten — zwei Backtests, dieselben Tage:

```powershell
# Status quo: 42-Tage-Fenster (entspricht live_only_days = 90)
py -3 -m engine backtest --data @LiveOnly --polling .\data\analysis\stations\polling.json --days 21 --train-days 42 --min-train-days 28 --out .\results\engine\handover-42d
# Untergrenze: 28-Tage-Fenster (entspricht einer Handover-Schwelle von 28)
py -3 -m engine backtest --data @LiveOnly --polling .\data\analysis\stations\polling.json --days 21 --train-days 28 --min-train-days 28 --out .\results\engine\handover-28d
```

**Entscheidungsregel:** Nur wenn die 28-Tage-Variante in `report.json` weiterhin
`mase_24h_below_0_95` **und** `picp95_between_90_and_98` erfüllt und ihr
`pinball_asym_ct` nicht über dem der 42-Tage-Variante liegt, ist eine Senkung
vertretbar — und dann auf höchstens `train_days`, nie darunter: Bei 28 Tagen
liegt der Fit exakt auf `min_train_days`, ein einziger Tag ohne Daten (Umbau,
Collector-Ausfall) lässt ihn mit `ValueError` scheitern, während bei 90 Tagen 62
Tage Puffer bleiben. Bleibt die Messung aus oder ist sie knapp, gilt der Default
90. Der Offline-Vergleich bildet nur die Datenmenge ab, nicht die
Abdeckungssicherheit: 28 Tage × ≥ 95 % Tagesabdeckung sind dünner belegt als 90.

## 5. Modell fitten und Prognose erzeugen

Nach ausreichender Datenprüfung, weiterhin mit derselben Dateiliste:

```powershell
py -3 -m engine fit --data @Daten --polling .\data\analysis\stations\polling.json --out .\data\models\forecast.json

# Nur nach erfolgreichem Fit: Inference aus dem gespeicherten Modell, ohne Netzwerk / Refit
py -3 -m engine forecast --model .\data\models\forecast.json --hours 24

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
und einen exponentiell gewichteten Residuen-Tagesblock-Bootstrap (neuere Tage
höheres Ziehgewicht, Halbwertszeit 14 Tage, `interval_method:
residual_day_bootstrap_ew_uncalibrated`). q.025/.10/.50/.90/.975 sind
zunächst **unkalibrierte Intervalle**, keine ACI-Erfolgswahrscheinlichkeiten.
Seit B2 kann ein neuer Fit eine *zuvor* abgenommene PIT-Kurve tragen;
`decision_ready` bleibt davon unabhängig immer M7-Sache. Ohne gültige frühere
Kurve oder bei ausgeschaltetem B2-Schalter bleibt `calibrated: false`. Preise
werden höchstens 30 Minuten fortgeschrieben, geschlossene/veraltete Preise
nicht gefittet.

## Messgrundlagen (B0, seit 0.56.0)

> Dieser Abschnitt ist gegen 0.56.0 geschrieben; die übrigen Abschnitte dieser
> Datei stehen auf 0.11.0 (siehe [README.md](README.md#nicht-gegen-die-aktuelle-version-geprüft)).

Batch B0 des [UX/Mathe-Befunds](BEFUND-UX-MATH-2026-09-19.md#b0--messgrundlagen-unsichtbar-bitgleich)
macht sichtbar, was die Engine bis 0.55.2 stumm tat, und legt die Datenbasis
für die Kalibrierungsschicht (B2). **Keine Prognosezahl ändert sich:**
`tests/test_b0_invariance.py` vergleicht Fit, Prognose (beide Kerne, Ensemble,
gemeinsame und unabhängige Ziehung) und Backtest-Kennzahlen Bit für Bit gegen
`tests/fixtures/b0_invariance.json`, das vor der ersten B0-Änderung erzeugt
wurde. Wer den Fit absichtlich ändert, erzeugt die Fixture neu und schreibt in
den Commit, warum — die Fixture ist der Zeuge, nicht die Behauptung.

### Zähler im Modell-Artefakt (`engine fit`)

Je Modell in `data/models/forecast.json` (Schema 2, nur ergänzt):

| Feld | Inhalt |
|---|---|
| `ar_shrink_events` | Zahl der ×0,9-Schritte des Stabilitätsnetzes im Haupt-AR(2) (`AR_SHRINK_FACTOR` 0,9, `AR_STABILITY_RADIUS` 0,98, höchstens `AR_SHRINK_MAX_STEPS` 100). 0 = Yule-Walker war stabil. Vor B0 geschah das Stauchen stumm. |
| `ar_state_reset` | `true`, wenn die letzten zwei Residuen am Cutoff nicht endlich waren und der AR-Zustand auf 0 gesetzt wurde — der Nachlauf startet dann aus dem Nichts. |
| `ar_detail.harmonic_ar2` / `ar_detail.profile_ar2` | Je Kern: `shrink_events`, `fallback` (`null` = echter Fit, sonst `too_few_points`, `too_few_triples`, `zero_variance`, `not_stabilised`), `triples` (zusammenhängende Tripel der Yule-Walker-Schätzung), `root_radius_raw`/`root_radius` (größter Wurzelbetrag vor/nach dem Stauchen), `shrink_factor`, `stability_radius`, `state_reset`. |
| `ensemble.weight_spread` | Ensemble-Gewichtsstreuung (Befund M4): dieselben inversen MASE-Gewichte wie `ensemble.weights`, aber je 288-Slot-Block (ein Tag auf dem 5-Minuten-Raster) des 14-Tage-Validierungsfensters — `harmonic_per_block`, `std`, `min`/`max`/`range`, `blocks_favouring` (`harmonic_ar2`/`profile_ar2`/`tie`, Unentschieden bei < 0,005 Abstand zu 0,5). Reine Diagnose; `weights` bleiben die des Gesamtfensters. |

`pava_pool_stats` ist **kein** Artefakt-Feld, sondern eine Prognose-Diagnose:
`predict(model, hours, diagnostics={})` füllt das übergebene Dict; die
Prognose ist mit und ohne Dict identisch (Test). `engine forecast` schreibt sie
je Prognose in `data/engine/forecast.json`, die App veröffentlicht sie je
Station. Inhalt: je 12-Uhr-Segment ab Gesetzesbeginn (`segments[]`:
`segment_start_local`, `points`, je Kern `pools`/`pooled_points`/
`max_pool_size`/`max_shift_ct`, dazu `paths` mit `paths_changed_fraction`/
`points_changed_fraction`/`max_shift_ct` und `quantiles_points_changed` je
Quantilspalte) und `totals` über alle Segmente. Ein Pool ist eine Folge von
Punkten, die die 12-Uhr-Projektion (PAVA) auf einen gemeinsamen Wert gezogen
hat; bereits gleiche Nachbarn zählen nicht.

### Backtest-Bericht (`engine backtest`)

Neu in `report.json` (und als Abschnitt „Messgrundlagen (B0)“ in `report.md`):

- `model_kind`, `shared_draws` — **was gemessen wurde.** Default bleibt der
  Stand vor 0.56.0: `harmonic_ar2` mit unabhängiger Tagesblock-Ziehung. Die
  App veröffentlicht aber `ensemble` mit gemeinsamer Ziehung (A10/A11). Der
  Backtest maß also bis heute nicht das, was der Nutzer sieht — B0 macht den
  Unterschied benennbar (`--kind ensemble --shared-draws`), das Umschalten des
  Defaults ist eine Messentscheidung für B3 ([LUECKEN.md](LUECKEN.md#bewusst-offen-backlog-mit-grund)).
- `pit` — PIT-Paare als Histogramm je Station und Horizont (`24h`, `72h`,
  `168h`), jeweils `all` und `break_free`. PIT = Mittelrang der Beobachtung
  unter den Bootstrap-Pfaden, `(#Pfade < y + ½ · #Pfade = y) / #endliche Pfade`;
  40 Klassen, `coverage[q]` für q ∈ {0,025, 0,1, 0,5, 0,9, 0,975},
  `interval_95` (Anteil in (0,025; 0,975]) und `mean`. Kalibriert wäre das
  Histogramm flach und `coverage[q] = q`. Die Rohpaare stehen je Zeile in
  `predictions.csv.gz` (Spalte `pit`) — das ist der Trainingsstoff von B2.
- `regime_breaks_in_window` — deklarierte Regime-Kanten (`Config.regimes`,
  CLI `--regime-break 2026-10-01T00:00`, mehrfach möglich; in der App
  `TANKAPP_REGIMES`, [BETRIEB.md](BETRIEB.md#regime-kalender-b0-seit-0560)): `declared`
  und `in_window` mit Datum (`announced_local`/`at_utc`), Art (`kind`), Sorte,
  Betrag (`announced_value`, ct/L, Vorzeichen = Richtung), `status` und
  `source`; `count`, `folds_spanning`/`points_spanning` und
  `metrics_break_free`. **Politik `flagged_not_excluded`:** markiert und
  gezählt, nichts ausgeschlossen — Kennzahlen über eine Kante sind als
  Modellgüte nicht interpretierbar (Befund §5.4.3), aber sie verschwinden
  nicht stillschweigend.
- `ar_shrink` — über alle bewerteten Folds: `folds_shrunk`,
  `shrink_events_total`, `folds_state_reset`, `fallbacks` je Grund. Je Fold
  stehen `ar_shrink_events`, `ar_fallback`, `ar_state_reset`,
  `training_start`, `regime_break_spanned` und `regime_breaks`.

`predictions.csv.gz` trägt neben `pit` die Spalten `regime_break_spanned`
(Kante zwischen Trainingsbeginn und Bewertungszeitpunkt) und `horizon_hours`:
`0` sind die klassischen 24-h-Zeilen, `72`/`168` die bewerteten Mehrtage-Fenster,
die die CLI seit 0.56.0 **zusätzlich** schreibt. Wer die Datei selbst
auswertet, filtert auf `horizon_hours == 0`, sonst mischt er drei Horizonte.
`run_backtest()` liefert ohne `horizon_rows=True` weiterhin nur die 24-h-Zeilen.

Der Regime-Kalender wird wie `price_law_local` **durchgereicht, nicht
verrechnet:** Fit und Prognose ignorieren ihn in 0.56.0; Dummy, Kante und
Warmstart sind R1–R3 des Befunds und kommen mit eigenem Schalter. Ein leerer
Kalender (Engine-Default) ist bitgleich zu 0.55.2.

### Referenzmessung vor B2/B3 (Rezept, noch nicht gelaufen)

Der Befund verlangt PICP/Brier/MASE **je Station vor jeder Änderung** als
Vergleichsbasis. In der Entwicklungsumgebung liegen keine NAS-Daten; die
Messung gehört auf den PC mit dem Export aus §3 und wird in der
Erledigt-Zeile des Befunds (B0-Status) und in [LUECKEN.md](LUECKEN.md)
festgehalten — **nicht** hier vorab mit erfundenen Zahlen.

```powershell
# Dieselben 21 Tage, zwei Läufe je Datenbestand: das bisher Gemessene und das Veröffentlichte.
py -3 -m engine backtest --data @Daten --polling .\data\analysis\stations\polling.json --days 21 --regime-break 2026-10-01T00:00 --regime-break 2027-01-01T00:00 --out .\results\engine\ref-harmonic
py -3 -m engine backtest --data @Daten --polling .\data\analysis\stations\polling.json --days 21 --kind ensemble --shared-draws --regime-break 2026-10-01T00:00 --regime-break 2027-01-01T00:00 --out .\results\engine\ref-ensemble
```

Festzuhalten je Lauf und Station (`report.json → stations[]`): `picp95_pct`,
`mase` (mit `mase_points`), `pinball_asym_ct`; aus `pit → stations[]`
`horizons.24h.all.interval_95` und `coverage`; dazu global `model_kind`,
`shared_draws`, `regime_breaks_in_window.count` und `ar_shrink`. Liegt eine
Kante im Fenster, gilt zusätzlich `metrics_break_free`. **Brier je Station
gibt es im Backtest nicht** — der Brier-Score misst abgerechnete
Empfehlungen und kommt aus dem Advice-Ledger (`app/feedback.py::
compute_advice_stats`, `/api/v1/stats/summary`), global je P-Quelle; eine
Stations-Aufteilung wäre ein eigener Schritt und bei ~1 Empfehlung/Tag lange
nicht belastbar. Das steht so im Befund-Status, statt es zu behaupten.

## PIT-Rekalibrierung (B2, seit 0.57.0)

B2 kalibriert nicht den Punktpfad, sondern die **empirische Verteilung der
24-h-Bootstrap-Pfade**. Ein Rolling-Origin-Backtest liefert für jede 24-h-Wahrheit den
PIT-Mittelrang `u = F_roh(y)`. Aus den früheren, out-of-sample PITs lernt PAVA
eine monotone empirische CDF `H`; für jede Pfadspalte werden die Draw-Ränge mit
`H⁻¹` umgelegt. So gilt `F_kalibriert(y) = H(F_roh(y))`, während Rangordnung
und gemeinsame Draw-Kopplung erhalten bleiben. Anschließend gilt die
12-Uhr-Projektion erneut — eine bessere marginale Kalibrierung darf nie eine
Rechtsregel verletzen.

Der Kandidat wird **station-, sorten-, Modellkern- und Ziehungsmodusgenau**
gespeichert (`model_kind`, `shared_draws`). Er nimmt nur 24-h-PITs ohne
`regime_break_spanned`; frühere zwei Drittel der Backtest-Origins trainieren
die Kurve, das letzte Drittel nimmt sie ab. Die Abnahme veröffentlicht
`raw_coverage`/`calibrated_coverage` für die Quantilniveaus 2,5 %, 10 %,
50 %, 90 % und 97,5 %, Zielbänder, `raw_picp95`/`calibrated_picp95` und das explizite
`picp_release_gate`. Eine Station wird nur akzeptiert, wenn alle
Quantil-Abdeckungen im Holdout-Band liegen und PICP95 gegenüber roh höchstens
**2 Prozentpunkte** sinkt. Fehlende Roh-PITs, zu kleine oder nicht zeitlich
trennbare Stichproben sind ein benannter unkalibrierter Zustand, nie ein
stilles Akzeptieren.

Die Veröffentlichung arbeitet absichtlich mit einem Lauf Verzögerung: Ein
akzeptierter Kandidat aus dem *vorigen* Backtest kann beim jetzigen Fit aktiv
werden; der aktuelle Backtest schreibt nur `calibration_candidate` für den
nächsten Lauf. `calibration` ist daher die tatsächlich angewandte Hülle,
`calibrated` ihr validierter Modellzustand und nicht die M7-Freigabe. Schema-2-
Modelle bleiben lesbar, gelten aber ausdrücklich als unkalibriert; neue
Artefakte sind Schema 3. Der Tages-Cache ist Schema 4, damit Kurven nie bei
anderem Kern oder anderem Shared-Draw-Modus wiederverwendet werden.

`TANKAPP_CALIBRATION=0` ist die A/B-Gegenprobe: Kandidaten und Messfelder
werden weiter erzeugt, Pfade bleiben aber roh. Standard ist `1`. Zusätzlich
blockiert der deklarierte Regime-Kalender jede Aktivierung vom Kanten-Tag bis
45 lokale Kalendertage danach (bei der Kante 01.10.2026: einschließlich
15.11.); die Hülle meldet dann `status: "regime_blackout"`. So kann eine vor
der Kante akzeptierte Kurve nicht über den Bruch hinweg veröffentlicht werden.
Die Labor-Kachel „PIT-Rekalibrierung der Prognose“ zeigt aktive Kurve und
24-h-Kandidat; sie zeigt außerdem den getrennten Allzeit-Ledger-Brier für
`raw` und `pit_24h`. Alt-Snapshots bleiben eine explizite dritte Gruppe
`unknown`; der Vergleich ist zeitgetrennt, kein Kausalbeweis. 72-/168-h-Pfade
bleiben ohne ihren eigenen Holdout-Kandidaten bewusst roh. Die Kachel ist vom
Ledger-M7-Gate getrennt.

## 6. Häufige Probleme am Windows-PC

| Meldung / Situation | Was du tun solltest |
|---|---|
| `py` nicht gefunden / Python <3.11 | Aktuelles Python samt Launcher installieren; PowerShell neu öffnen. Bei mehreren Versionen die gewünschte beim Aufruf von Python ausdrücklich auswählen. |
| `python.exe` / Modul `engine` nicht gefunden | Repository-Wurzel und aktuellen Code-Stand prüfen; §1 ausführen. Dasselbe Python für Paketinstallation und Ausführung verwenden. |
| `Activate.ps1` wird blockiert | Keine ExecutionPolicy ändern. Die Anleitung braucht keine Aktivierung. |
| `polling.json` fehlt | Originales aktives M2-Set auf den PC kopieren. Private Dateien kommen nicht mit Git. |
| Keine Dateien für `data/ready/*.csv*` | Aufbereitete Historie bereitstellen oder erfolgreich exportieren und `$Daten` auf die tatsächlich vorhandenen Dateien umstellen. |
| Fehlende ausgewählte UUIDs | CSV-Zeitraum und gewähltes Polling-Set abgleichen; bei mehreren Sets gezielt `--poll-city Frankfurt` (oder tatsächlichen Set-Namen) ergänzen. |
| `$Daten` ist leer / neue PowerShell geöffnet | Eine passende Dateiliste aus §3 erneut setzen. Für den Export weiterhin nur `--env-file data/influx.env` verwenden; keine Sitzungsvariablen nötig. |
| NAS nicht erreichbar | `Test-NetConnection` prüfen; Netz/VPN/Adresse kontrollieren. Für Variante A ist das NAS nicht nötig. |
| `Invalid header value` / Token enthält Konfigurationszeilen | Ganze `NAME=WERT`-Datei mit `--env-file data/influx.env` laden, nicht mit `Get-Content -Raw` als Token. Siehe Fehlerfall in §3B. |
| `--env-file` / `--check-connection` nicht erkannt | Repository auf den aktuellen Stand bringen; ältere Exporter kannten diese Schalter noch nicht. |
| Konfigurationsdatei, Zeile … | Nur die vier dokumentierten Namen verwenden; UTF-8, doppelte Einträge und Anführungszeichen prüfen. Keine PowerShell-Befehle, keine reine Token-Datei. |
| Influx HTTP 401/403 bei Schritt 3 oder Export | Vollständigen neuen API-Token aus der richtigen InfluxDB-Instanz und Organisation verwenden, Read-Recht für `tankapp` setzen. Kein Token-ID/Name/Passwort/Tankerkönig-Key. Genauer Klickpfad in §3B. |
| Health HTTP 401/404 oder anderer Dienst erkannt | Schritt 2 hat noch keinen Token gesendet. URL/Port/InfluxDB-Version und vorgeschalteten Proxy prüfen, nicht andere Schlüsseldateien durchprobieren. |
| Netz-/Lesefehler, obwohl der RPi schreibt | Schreib- und Lesezugriff sowie Rechner-/Proxy-Weg unterscheiden. Phase, HTTP-Status, Fehlerklasse und `errno`/`winerror` aus dem neuen Check beachten; Token zunächst unverändert lassen. |
| Timeout, DNS-, Verbindungs- oder TLS-Fehler | Betroffenen Schritt beachten und Verbindung/Dienst prüfen. Ein sporadischer Timeout erklärt nicht gleichzeitig wiederkehrende HTTP 401. |
| Influx HTTP 404 / keine Zeilen | Organisation, Bucket und Zeitraum prüfen. Eine alte Exportdatei ist kein Nachweis, dass der neue Lauf erfolgreich war. |
| Stationsname mehrdeutig | Nicht als Preis-Zwilling löschen. Uploader auf UUID-Tags aktualisieren, Original-JSONL aus einer Sicherung nachliefern, danach `--uuid-only` exportieren: [Ablauf](archiv/STATIONS-UUID-MIGRATION.md). |
| Replay: `TIME_OFFSET_MISSING` | Ursprüngliche Collector-Zeitzone auf dem RPi klären; anschließend ausdrücklich `--replay-timezone` im Dry-Run und tatsächlichen Replay verwenden. [Ablauf §3a](archiv/STATIONS-UUID-MIGRATION.md). Keine feste Uhrzeit/Quelle in der Sicherung umschreiben. |
| Replay-Prüfung: JSONL-Zeile abgelehnt | Gemeint ist die Preisdatei unter `$BACKUP/poll`, nicht die Stationsliste. Neue Fehlercodes mit Feldursache: [Replay-Prüfung](archiv/STATIONS-UUID-MIGRATION.md). Kein `source` umschreiben, keine Zeile/Ack-Datei löschen. |
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
Test-Path .\data\analysis\stations\polling.json

# Nur in dieser PC-Sitzung: eine eventuell gesetzte Variable würde die Datei übersteuern
Remove-Item Env:\TANKERKOENIG_API_KEY -ErrorAction SilentlyContinue

# Separater Testpuffer, nie der produktive Pi-/Uploader-Puffer
py -3 .\data-tools\collect_prices.py --once --out .\data\pc-test-poll
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
2. CUSUM-Sprungtage, gesonderte MASE <0,80 an sprungfreien Tagen.
3. Out-of-sample-Intervallkalibrierung / ACI nach ausreichender Live-Historie.
4. Echt-Daten-Abnahme: MASE <0,95 gesamt, Pinball (τ=0,5 und asym τ=0,75)
   besser als Naive, PICP 95 % zwischen 90–98 %. Keine alten Demo-Messwerte
   übernehmen.

*(Geschlossen 11.09.2026: gepoolter Feiertags-Dummy je Bundesland und
Sprung-Hazard im Strukturmodell (§3.2); Hampel-Filter (§3.1);
Mehrtage-Backtests +3 d/+7 d und Rolling-PICP 7 d mit Badge (§3.3.3/§3.4);
NAS-Job Backtest 21 d statt 7 d.)*

</details>
