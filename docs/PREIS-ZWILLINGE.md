# Preis-Zwillinge prüfen und ein Ersatz-Set vorschlagen (Windows)

**Ziel:** Wenn zwei Stationen über längere Zeit praktisch dieselben E10-Preise
liefern, nur einen sinnvoll nutzbaren Vertreter auswählen und den Platz mit
einem anderen geeigneten Kandidaten besetzen. Nicht pauschal eine Station je Marke.

Die folgenden Schritte sind **zunächst eine Prüfung und ein Vorschlag**. Sie
ändern weder den Collector noch den aktiven Polling-Ordner oder die InfluxDB.
Keine API-Schlüssel und keine InfluxDB-Verbindung für den Preisvergleich nötig.

## 1. Vorbereitung

PowerShell im TankApp-Ordner öffnen und den aktuellen Repository-Stand verwenden.
Python 3.11+ und die M3-Umgebung werden wie im [Engine-README](../engine/README.md)
eingerichtet. Wenn `.venv-m3` noch fehlt:

```powershell
py -3 -m venv .venv-m3
.\.venv-m3\Scripts\python.exe -m pip install -r engine\requirements.txt
```

Benötigt werden:

- **Originale, UUID-getrennte M2-Historien** als Analyse-CSV/CSV.gz in `data\ready\`.
  Nicht die bereits unter einem gemeinsamen Stationsnamen vermischte Influx-Serie.
- Dein aktuelles privates `docs\analysis\stations\polling.json`, inklusive
  Stationsmetadaten (`uuid`, `name`, `brand`). Diese Datei kommt nicht mit Git.

```powershell
Get-ChildItem .\data\ready\*.csv* | Select-Object Name, Length
Test-Path .\docs\analysis\stations\polling.json
```

## 2. Die Aral-Stationen vergleichen

```powershell
.\.venv-m3\Scripts\python.exe -m engine compare-stations --data "data/ready/*.csv*" --polling .\docs\analysis\stations\polling.json --poll-city Frankfurt --brand ARAL
notepad .\results\engine\price_twins\report.md
```

`Frankfurt` bei Bedarf durch deinen tatsächlichen Kampagnen-/Set-Namen ersetzen.
Für eine andere Marke `--brand` ändern; ohne `--brand` werden alle Paare innerhalb
jeder gewählten Kampagne geprüft. Für Diesel/E5 zusätzlich `--fuel DIESEL` / `E5`.
Die entsprechende Sorte muss in den Dateien enthalten sein.

Der Bericht nennt **beide UUIDs**, Namen, vorhandene Entfernungsangaben und:

- gemeinsame Vergleichspunkte und qualifizierende Tage;
- Anteil nahezu gleicher Preise und mittlere/P95/maximale absolute Differenz in ct/L;
- bekannte Statusunterschiede, die gegen das Weglassen einer Station sprechen;
- gegebenenfalls den näheren Kandidaten **laut bisherigem Polling-Set**.

Daneben liegt `report.json` für die vollständige maschinenlesbare Auswertung.
Kein Polling-Set wird dabei verändert.

### Wann meldet der Vergleich mögliche Preis-Zwillinge?

Konservative Startwerte, keine Garantie für die Zukunft:

- mindestens **28 Tage** mit jeweils mindestens **12 gemeinsamen Eingangszeilen**;
- mindestens **90 % Überlappung** relativ zur größeren beobachteten Preisreihe;
- mindestens **99 %** der gemeinsamen Preise unterscheiden sich höchstens um
  **0,1 ct/L** (= 0,001 €/L);
- **keine bekannten Statuskonflikte** auf gemeinsamen Status-Beobachtungen.

Verglichen wird 06–24 Uhr im 5-Minuten-Verfügbarkeitsraster. Von der Engine
zusätzlich fortgeschriebene Werte zählen **nicht** als neue Vergleichspunkte.
Die M2-Dateien können ihrerseits bereits grob gerasterte/rekonstruierte Stände
enthalten; kurze Unterschiede und Öffnungszeiten bleiben dann unbekannt.

| Ergebnis | Konsequenz |
|---|---|
| **Mögliche Preis-Zwillinge – manuell prüfen** | Kandidat für nur einen Vertreter. Öffnungszeiten, Lage und tatsächlich gefahrene Wege zusätzlich prüfen. |
| Unterschiedliche Preisverläufe | Nicht allein aufgrund gleicher Marke oder gleichen Namens ausschließen. |
| Status/Verfügbarkeit unterscheiden sich | Beide können trotz gleicher Preise unterschiedlichen praktischen Nutzen haben. |
| Zu wenig gemeinsame Daten | Kein Nachweis für Redundanz. Mehr/besser überlappende Historie nötig, nicht anhand eines einzelnen gleichen Preises entscheiden. |

Der näher gelegene Kandidat ist nur ein Hinweis, **keine automatische
Handlungsempfehlung**. Bei unbekannten Öffnungszeiten oder unterschiedlicher
Alltagsroute darf nicht allein die Entfernung entscheiden.

## 3. Nach Prüfung eine UUID ausschließen und Ersatz vorschlagen

Erst wenn du anhand des Berichts **und der Nutzbarkeit** einen Vertreter gewählt
hast: die UUID der anderen Station aus dem Bericht übernehmen (keinen API-Key).

```powershell
$Ausgeschlossen = Read-Host 'UUID der Station, die nicht mehr ins Polling-Set soll'
```

Nimm deinen bisherigen erfolgreichen Pipeline-Befehl mit **denselben Anker-,
Routing-, Nähe- und Auswahlparametern**. Ergänze `--exclude-uuid` und einen
**separaten Ausgabeordner**. Beispiel mit den Parametern aus der Installationsanleitung:

```powershell
.\.venv\Scripts\python.exe .\data-tools\run_pipeline.py --router osrm --skip-fetch --skip-ingest --skip-select --near-km 5 --near-n 3 --leader-max-km 10 --exclude-uuid $Ausgeschlossen --out-stations docs/analysis/stations-vorschlag
```

Hier wird die bisherige **M2-Umgebung `.venv`** verwendet, nicht die reine
M3-Umgebung. Falls deine bisherigen Parameter abweichen, diese beibehalten.
`--skip-select` ist nur zulässig, wenn Scores und Metadaten noch zu Anker/Routing
passen; bei einer Staleness-Meldung nicht darüber hinweggehen, sondern die
Selektion mit den passenden Parametern erneut rechnen. OSRM nutzt wie bisher
den Routingdienst; es wird kein zusätzlicher Tankerkönig-Preispoll gestartet.

Die Pipeline entfernt diese UUID **vor** der Kandidatenwahl. Der nächste
zulässige Kandidat rückt nach; Entfernungsgrenzen, Marken-/Abstandsregeln und
Netto-Kriterien bleiben bestehen. Sind nicht genug geeignete Kandidaten übrig,
bleibt das Set ehrlich kleiner statt den ausgeschlossenen Zwilling wieder einzubauen.
Unbekannte UUIDs führen zum Abbruch. Mehrere Ausschlüsse sind mit wiederholtem
`--exclude-uuid` möglich; sie gelten für diesen Aufruf und werden im Vorschlag protokolliert.

**Ohne separates `--out-stations` wird der Ausschluss-Aufruf abgelehnt**, damit
er nicht den üblichen aktiven Ordner `docs/analysis/stations` überschreibt.

Vorschlag ansehen:

```powershell
$vorschlag = Get-Content .\docs\analysis\stations-vorschlag\polling.json -Raw -Encoding UTF8 | ConvertFrom-Json
$vorschlag.sets.Frankfurt.stations | Select-Object uuid, name, group, dist_km, net_per_fill_eur
```

Die neue Station wird nicht erfunden, sondern kommt aus deinen vorhandenen
`station_scores_e10.csv`-Kandidaten. Der Ausschluss ist bewusst manuell, kein
unbeaufsichtigter Filter aller Preis-Zwillinge. Wenn der Ersatz erneut redundant
sein könnte, den Vergleich mit dem **Vorschlags-Set** wiederholen, gegebenenfalls
ohne Markenfilter. Die Übereinstimmung eines Paars ist keine transitive Garantie
für weitere Stationen.

## 4. Noch nicht als Reparatur der alten Influx-Daten aktivieren

**Den Vorschlag nicht einfach auf den Pi kopieren, um den Exportfehler verschwinden
zu lassen.** Die derzeitige Namensserie `city=Frankfurt, station=Aral Tankstelle`
kann bereits Werte mehrerer UUIDs enthalten. Wird im Polling-Set nur noch eine
Aral geführt, könnte die alte Serie anschließend fälschlich dieser UUID zugeordnet
werden. Preisähnlichkeit in der M2-Historie beweist nicht die Identität jedes späteren
Live-Punkts.

Vor der Live-Übernahme muss die Datenspeicherung eindeutig nach **Stations-UUID**
erfolgen. Bereits vermischte Punkte lassen sich nur mit ursprünglichen
UUID-getrennten Quellen (z. B. noch vorhandenen Collector-JSONL-Dateien) zuverlässig
rekonstruieren, nicht durch Umbenennen oder Löschen eines Polling-Eintrags.
**Vergleich und Vorschlagsfunktion selbst migrieren keine Influx-Daten.**
Dafür gibt es jetzt einen [eigenen Ablauf für UUID-Tags und JSONL-Nachlieferung](STATIONS-UUID.md).
Alte Daten und Ack-Dateien nicht löschen/zurücksetzen. Zeigt der Vergleich
unterschiedliche Preisverläufe, beide Stationen zunächst behalten und stattdessen
diese Identitätsumstellung durchführen.

Für den nächsten Schritt reichen die Ergebnis-Kategorie und die UUIDs aus dem
Vergleich sowie der Ersatzvorschlag. Keine Schlüsseldateien, vollständigen
Polling-Dateien mit Heimkoordinaten oder großen Rohdaten in den Chat stellen.
