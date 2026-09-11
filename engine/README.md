# Engine-Referenz — optionale Modellwerkstatt

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
- [Häufige Probleme](#6-häufige-probleme-am-windows-pc)
- [Noch offen M3](#noch-offen-in-m3)

---


**Keine Installations-Checkliste.** Der einzige Einstieg und die Reihenfolge
stehen in [INSTALL.md](../docs/INSTALL.md): Gütersloh sammeln, Live-GUI anbinden,
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
py -3 -m engine bootstrap --data "data/ready/*_hist.csv*" data/engine/influx_e10.csv.gz --polling docs/analysis/stations/polling.json
```

Ohne Live-Export nur die vorhandenen Archiv-CSVs angeben. Zum Nachweis von 90
Tagen mindestens diesen Zeitraum exportieren; der Exporter-Default von 70 Tagen
reicht dafür nicht. Beispielsweise mit `--since` einen Zeitpunkt 120 Tage vor
jetzt wählen. Exporte sind nicht der dauerhafte Archivspeicher: der liegt auf dem NAS.

## 12-Uhr-Regel: Preiserhöhungen nur um 12:00 Uhr

Seit 2026-04-01 dürfen Tankstellen in Deutschland den Preis nur um 12:00 Uhr
erhöhen; Senkungen sind jederzeit möglich (`price_law_local` in der
`Config`). Die Engine überträgt das auf drei Ebenen:

1. **Strukturmodell:** Neben den Harmonischen und Wochentags-Dummies trägt ein
   Mittags-Schritt („nach 12:00 Uhr, ab Gesetzesbeginn") das eigene
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
py -3 -m engine compare-stations --data "data/ready/*.csv*" --polling docs/analysis/stations/polling.json --poll-city Frankfurt --brand ARAL
```

Ausgabe: `results/engine/price_twins/report.md` und `report.json`. Zu kurze oder
lückenhafte gemeinsame Historie ist kein Beleg für Preisgleichheit. Bei
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
[UUID-Identität klären](../docs/STATIONS-UUID.md); Vergleich und Vorschlag migrieren
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
[Stations-UUID-Anleitung](../docs/STATIONS-UUID.md) durchführen. Danach bewusst nur
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
py -3 -m engine inspect --data @Daten --polling .\docs\analysis\stations\polling.json

# Qualitätsbericht ansehen
Get-Content .\results\engine\quality.json -Encoding UTF8

# Anschließend täglich rollierend prüfen, nicht zufällig Training/Test mischen
py -3 -m engine backtest --data @Daten --polling .\docs\analysis\stations\polling.json --days 21

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
([Datenformate](../data-tools/README.md#datenformate)), nicht die M2-Dateien überschreiben.
Das erzeugt **keine zusätzlichen echten Polls**. Exakt überlappende Live-Statuszeilen
haben Vorrang. Mehrdeutige/nicht existente lokale Sommerzeit-Zeitstempel werden
verworfen und gezählt, nicht erfunden.

`Exit 0` bedeutet **nicht „M3 bestanden“**. Der Backtest bewertet den folgenden
lokalen Tag im Poll-Fenster 06–24 Uhr auf gemeinsamer Datenbasis mit der saisonalen
Naiven. Engine-Forward-Fill wird nicht als Testbeobachtung gezählt. MASE nutzt nur
die saisonale Fehlerskala aus dem Training und ist bei konstanten Reihen undefiniert.
Ein exakter Einzelpunkt-Test bei +24 h und weitere Horizonte sind gesondert offen.

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
py -3 -m engine backtest --data @Daten --polling .\docs\analysis\stations\polling.json --days 21 --out .\results\engine\backtest-42d-ew
# 42 Tage, uniform (Vergleich)
py -3 -m engine backtest --data @Daten --polling .\docs\analysis\stations\polling.json --days 21 --bootstrap-ew-half-life 0 --out .\results\engine\backtest-42d-uniform
# 84 Tage, uniform (Trägheits-Vergleich; braucht 105+ Tage Historie)
py -3 -m engine backtest --data @Daten --polling .\docs\analysis\stations\polling.json --days 21 --train-days 84 --min-train-days 28 --bootstrap-ew-half-life 0 --out .\results\engine\backtest-84d-uniform
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
py -3 -m engine backtest --data @LiveOnly --polling .\docs\analysis\stations\polling.json --days 21 --train-days 42 --min-train-days 28 --out .\results\engine\handover-42d
# Untergrenze: 28-Tage-Fenster (entspricht einer Handover-Schwelle von 28)
py -3 -m engine backtest --data @LiveOnly --polling .\docs\analysis\stations\polling.json --days 21 --train-days 28 --min-train-days 28 --out .\results\engine\handover-28d
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
py -3 -m engine fit --data @Daten --polling .\docs\analysis\stations\polling.json --out .\data\models\forecast.json

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
**unkalibrierte Intervalle**, keine ACI-Erfolgswahrscheinlichkeiten.
`calibrated: false` und `decision_ready: false` bleiben gesetzt. Preise werden
höchstens 30 Minuten fortgeschrieben, geschlossene/veraltete Preise nicht gefittet.

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
| Stationsname mehrdeutig | Nicht als Preis-Zwilling löschen. Uploader auf UUID-Tags aktualisieren, Original-JSONL aus einer Sicherung nachliefern, danach `--uuid-only` exportieren: [Ablauf](../docs/STATIONS-UUID.md). |
| Replay: `TIME_OFFSET_MISSING` | Ursprüngliche Collector-Zeitzone auf dem RPi klären; anschließend ausdrücklich `--replay-timezone` im Dry-Run und tatsächlichen Replay verwenden. [Ablauf §3a](../docs/STATIONS-UUID.md). Keine feste Uhrzeit/Quelle in der Sicherung umschreiben. |
| Replay-Prüfung: JSONL-Zeile abgelehnt | Gemeint ist die Preisdatei unter `$BACKUP/poll`, nicht die Stationsliste. Neue Fehlercodes mit Feldursache: [Replay-Prüfung](../docs/STATIONS-UUID.md). Kein `source` umschreiben, keine Zeile/Ack-Datei löschen. |
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
2. Gepoolte Feiertagseffekte und Sprungzustand im Strukturmodell.
3. CUSUM-Sprungtage, gesonderte MASE <0,80 an sprungfreien Tagen.
4. Out-of-sample-Intervallkalibrierung / ACI nach ausreichender Live-Historie.
5. Echt-Daten-Abnahme: MASE <0,95 gesamt, Pinball (τ=0,5 und asym τ=0,75)
   besser als Naive, PICP 95 % zwischen 90–98 %. Keine alten Demo-Messwerte
   übernehmen.

</details>
