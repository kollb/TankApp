# Gleiche Stationsnamen sauber trennen – RPi und Windows-PC

## Schnellweg: jetzt weiterarbeiten, alten Replay vorerst weglassen

Wenn `TIME_OFFSET_MISSING` die Nachlieferung blockiert und der ursprüngliche
Zeitbezug nicht durchgehend geklärt ist, **keinen pauschalen UTC-/Berlin-Replay
starten**. Für den M3-Einstieg ist diese Nachlieferung optional: Die vorhandenen
UUID-getrennten M2-Historien können das Training abdecken, neue Live-Punkte werden
bereits eindeutig mit `station_id` gespeichert.

**Voraussetzung:** Der Code mit UUID-Tags ist auf PC und RPi aktualisiert und die
Originaldaten sind bereits gesichert (§1–2). Die Sicherung behalten; nichts löschen.

**1. Auf dem RPi nur den Uploader neu starten:**

```bash
sudo systemctl restart tankapp-uploader
```

Den Collector und die Pi-Zeitzone unverändert lassen, den Pi nicht rebooten.
Der Uploader läuft mit dem neuen Code und schreibt neue/unbestätigte Punkte mit
UUID. Seine bestehende Ack-Logik bleibt erhalten.

**2. Auf dem Windows-PC exportieren:**

```powershell
python .\data-tools\export_influx.py --env-file .\data\influx.env --uuid-only
```

Sind noch keine UUID-Punkte vorhanden, den nächsten erfolgreichen Collector-Poll
und dessen Upload abwarten: im normalen 06–24-Uhr-Fenster etwa alle fünf Minuten,
bei zwei Stadtsets etwa alle zehn Minuten je Stadt; außerhalb des Fensters
erst beim nächsten Start. Bei einem leeren Export bleibt
eine eventuell ältere Exportdatei erhalten – daher die Erfolgsmeldung prüfen.

**3. Erst nach erfolgreichem Export: mit der bestehenden M2-Historie prüfen:**

```powershell
py -3 -m engine inspect --data "data/ready/*.csv*" data/engine/influx_e10.csv.gz --polling .\docs\analysis\stations\polling.json
```

**Grenze dieses Kurzwegs:** Alte Namensserien und die zeitlich noch nicht sicher
zugeordneten Sicherungszeilen werden nicht nachträglich repariert oder neu
hochgeladen. Der Export enthält nur vorhandene UUID-getaggte Punkte. Die
Sicherung bleibt für eine spätere belegte Nachlieferung erhalten. Das ist ein
sicherer Weiterarbeitsweg, **keine Behauptung einer vollständigen Altdatenmigration**.
Die alte M2-Historie bleibt als rekonstruierte Historie gekennzeichnet und ersetzt
keinen Live-Gütenachweis.

Die folgenden ausführlichen Abschnitte sind für die Ersteinrichtung bzw. die
**spätere optionale** Nachlieferung. Für den Kurzweg jetzt nicht bei §3a weiter
mit Zeitzonen experimentieren.

## Entscheidung nach dem Preisvergleich

Wenn der Bericht **„Unterschiedliche Preisverläufe“** meldet, eine Station nicht
als Preis-Zwilling ausschließen. Gleiche Namen sind kein Beleg für gleiche Preise.
Das aktive Polling-Set zunächst **unverändert lassen**; insbesondere keine Aral
löschen, nur damit die bisherige Namenszuordnung scheinbar eindeutig wird.

Der alte Uploader speicherte `prices` nur mit den Tags `city` und `station`
(Anzeigename). Gleicher Name + Stadt + Zeit kann deshalb dieselbe Influx-Punktidentität
bezeichnen. Die ursprünglichen Stationswerte sind daraus nicht sicher trennbar.

Der aktualisierte Uploader ergänzt **`station_id=<MTS-K-UUID>`**. `city`,
`station`, Kraftstofffelder und Zeitstempel bleiben erhalten. Neue Punkte mit
verschiedenen UUIDs sind auch bei identischen Namen getrennt. Der Exporter benutzt
vorhandene UUID-Tags vorrangig; er rät keine fehlenden IDs.

**Prüfung und Export sind nur lesend.** Der laufende Uploader und die ausdrücklich
angeforderte Nachlieferung schreiben Punkte, löschen aber keine alten Serien.
Kein Ablauf setzt den Ack zurück.
Private Konfigurationen/Schlüssel nicht posten. Beide GUI-Vorlagen bleiben unverändert.

## 1. Code auf PC und RPi aktualisieren

Den aktuellen freigegebenen Code mit `station_id`, `--replay` und `--uuid-only`
auf dem Pi und dem verwendeten Export-Rechner bereitstellen. Ein alter Feature-
Branch ist dafür nicht mehr erforderlich. Die Rollen und die Installation stehen
in [INSTALL.md](INSTALL.md); der PC ist kein Pflichtgerät.

Zuerst `git status --short` ansehen. Bei eigenen Änderungen, Konflikten oder
Git-Fehlern anhalten; kein `reset --hard`, keine privaten Daten löschen und nicht
für diese Migration den Branch wechseln. Die laufenden Dienste müssen für das
Code-Update noch nicht gestoppt werden.

Die Beispiele unten verwenden die bisherigen Standardpfade:
`/dev/shm/tankapp`, `~/TankApp` und `/etc/tankapp/env`. Bei abweichender Installation
die tatsächlichen Pfade aus deiner bestehenden Einrichtung verwenden.
**Den Pi jetzt nicht neu starten:** der ursprüngliche JSONL-Puffer liegt im RAM.

## 2. Auf dem RPi Rohdaten sichern und den aktualisierten Uploader starten

Nur den **Uploader kurz stoppen**, nicht den Collector. Währenddessen eine
private Kopie des JSONL-Puffers und des aktuellen Polling-Sets erstellen. So kann
der alte Uploader nach der Sicherung keine weiteren Punkte nur mit Namen bestätigen.
Der Collector sammelt weiter; sein API-Key und sein Intervall bleiben unverändert.

Im selben SSH-Fenster:

```bash
BACKUP="$HOME/tankapp-uuid-backup-$(date -u +%Y%m%dT%H%M%SZ)"
(
  set -eu
  umask 077
  sudo systemctl stop tankapp-uploader
  trap 'sudo systemctl start tankapp-uploader' EXIT
  mkdir -p "$BACKUP/poll"
  cp /dev/shm/tankapp/*.jsonl "$BACKUP/poll/"
  cp docs/analysis/stations/polling.json "$BACKUP/polling.json"
  if [ -d /dev/shm/tankapp/meta ]; then
    cp -a /dev/shm/tankapp/meta "$BACKUP/poll/meta"
  fi
)
printf 'Sicherung: %s\n' "$BACKUP"
sudo systemctl status tankapp-uploader --no-pager
```

Der `trap` startet den Uploader auch bei einem Kopierfehler wieder. Ein Fehler
beim Sichern darf deshalb **nicht** als erfolgreiche Sicherung interpretiert werden;
die Ausgabe prüfen und erst nach erfolgreicher Kopie weitermachen. Ab diesem
Uploader-Start bekommen neue bzw. noch unbestätigte Punkte automatisch UUID-Tags.

`BACKUP` gilt im aktuellen SSH-Fenster. Nach einem neuen Login die Variable
auf den oben ausgegebenen existierenden Ordner setzen. Die Kopie behalten;
sie enthält private Stationsinformationen. Der originale Ack und alle Quelldateien
bleiben an ihrem Platz.

## 3. Gesicherte JSONL-Dateien prüfen – noch nichts nachschreiben

```bash
cd ~/TankApp
REPLAY_TIME_ARGS=()
python3 data-tools/upload_influx.py --replay --dry-run --poll-dir "$BACKUP/poll" --poll-json "$BACKUP/polling.json" "${REPLAY_TIME_ARGS[@]}"
```

**Zwei unterschiedliche Dateien, zwei unterschiedliche Zwecke:**

| Datei / Argument | Inhalt | Was beim Replay geprüft wird |
|---|---|---|
| `$BACKUP/polling.json` / `--poll-json` | Stationsliste und Auswahlmetadaten. `source=run_pipeline.py …` ist hier richtig. | Namen werden daraus gelesen. Ankerkoordinaten und der Generator-`source` sind nicht die Live-Snapshot-Prüfung. |
| `$BACKUP/poll/YYYY-MM-DD.jsonl` / `--poll-dir` | Eine vollständige Preisabfrage je Zeile mit `fetched_at`, `source`, `city`, UUID-indiziertem `prices`. | Diese Preiszeilen werden streng geprüft. „2026-09-07.jsonl, Zeile 1“ bezieht sich **nicht** auf `polling.json`. |

Bei einer Replay-Fehlermeldung nicht `source` oder Koordinaten in der Stationsliste
ändern. Keine kompletten Polling-Dateien mit privaten Ankern oder Rohpreisdateien
zur Fehlersuche posten. Anonymisierte Koordinaten in einer Nachricht müssen für
diesen Fehler nicht durch echte Werte ersetzt werden.

Erwartet: Anzahl Original-Snapshots/UUID-Punkte sowie einige Line-Protocol-Zeilen.
Bei gleichnamigen Stationen müssen darin **verschiedene `station_id=`-Werte**
stehen. Die Vorschau braucht keinen Token, sendet nichts und liest/schreibt
keine Ack-Datei. Die Ausgabe enthält Preise/Stationsdaten, aber keine API-Schlüssel.

Der Replay-Modus prüft **alle Eingaben vor dem ersten Write**. Er stoppt bei
kaputten Zeilen, Demo-/unbekannten Quellen, ungültigen UUIDs, fehlendem UTC-Offset
**ohne ausdrücklich bestätigte Replay-Zeitzone**, nicht endlichen Preisen oder
widersprüchlichen Werten für dieselbe UUID/Zeit. Er ergänzt keine geratenen
Zeitstempel oder Preise. Wird eine Quelldatei beim
Lesen verändert, wird ebenfalls abgebrochen.

### Wenn die Prüfung stoppt: den konkreten Fehlercode ansehen

Die aktualisierte Ausgabe enthält Dateiname, Zeile, gegebenenfalls die **Nummer**
des Stationseintrags und einen festen Fehlercode. Keine rohen Feldwerte, Preise,
UUIDs, Koordinaten oder Bibliotheks-Fehlertexte werden in der Fehlermeldung ausgegeben.
Die Validierung wird nicht umgangen; noch keine Replay-Punkte wurden geschrieben.

| Fehlercode | Bedeutung / nächster Schritt |
|---|---|
| `JSON_INVALID` / `SNAPSHOT_OBJECT` | Zeile ist kein vollständiges Snapshot-JSON-Objekt. Richtige JSONL-Sicherung prüfen, nicht die Stationsliste verwenden. |
| `SOURCE_DEMO` | Die Preiszeile ist ausdrücklich ein Demo-Poll. Nicht als Echtpreis importieren und nicht einfach auf `source=tankerkoenig-prices.php` umschreiben. |
| `SOURCE_MISSING` / `SOURCE_UNKNOWN` | Der Preis-Snapshot trägt nicht die bekannte Live-Kennung. Collector-Version und ursprüngliches Format klären; keine Herkunft erfinden. Das Generatorfeld in `polling.json` ist davon unabhängig. |
| `TIME_MISSING_OR_INVALID` | `fetched_at` fehlt oder ist kein gültiger ISO-Zeitstempel. Originalformat prüfen. |
| `TIME_OFFSET_MISSING` | Älterer Zeitstempel ohne UTC-Offset. Ursprüngliche Collector-Zeitzone klären, dann **§3a** mit `--replay-timezone` verwenden; nicht die Originaldatei ändern. |
| `TIME_LOCAL_NONEXISTENT` / `TIME_LOCAL_AMBIGUOUS` | Die gewählte Zeitzone liefert für diese lokale Uhrzeit keinen bzw. zwei mögliche UTC-Zeitpunkte. Ohne ursprünglichen Offset nicht zuverlässig zuordnen; keine automatische Sommerzeit-Korrektur. |
| `REPLAY_TIMEZONE_INVALID` | Unbekannter/nicht installierter IANA-Zonenname. Expliziten historischen Namen wie `Europe/Berlin` oder `UTC` verwenden, nicht `localtime` oder einen geratenen festen Offset. |
| `CITY_INVALID` / `PRICES_OBJECT` | Preis-Snapshot passt nicht zum erwarteten Objektformat. |
| `STATION_UUID_INVALID` / `STATION_STATUS_INVALID` | Der genannte Stationseintrag enthält keine kanonische UUID oder keinen gültigen Status. Keine Station durch ihren Namen ersetzen. |
| `PRICE_NONFINITE` | Ungültiger numerischer Preis; nicht durch einen erfundenen Wert ersetzen. |
| `CONFLICTING_OBSERVATION` | Zwei Originalzeilen widersprechen sich für dieselbe UUID/Zeit. Herkunft prüfen, nicht willkürlich eine auswählen. |
| `ENCODING_UTF8` | Die Preisdatei kann nicht als UTF-8 gelesen werden. Sicherung/ursprüngliche Kodierung klären; Originaldatei nicht überschreiben. |

Nach dem Code-Update denselben `--replay --dry-run`-Befehl oben erneut ausführen
und nur die neue **Fehlerzeile mit Code** weitergeben. Bis zur Klärung keinen
Replay ohne `--dry-run` starten, keine Zeile löschen und keinen Ack zurücksetzen.
Der normal laufende, aktualisierte Uploader kann weiter neue UUID-Punkte sammeln.

Bei einer möglicherweise während des Kopierens unvollständigen letzten Zeile:
neue Sicherung anlegen und erneut prüfen. Nicht den laufenden Puffer oder dessen
Ack zum Erzwingen eines Erfolgs bearbeiten. Wenn keine ursprünglichen JSONL-Dateien
mehr vorhanden sind, §4 überspringen und mit §5 nur die neuen UUID-Punkte lesen.
Ältere, nur nach Namen zusammengefallene Daten sind ohne Originalquelle nicht
rückwirkend zuverlässig rekonstruierbar.

## 3a. Alte Preiszeitstempel ohne Offset kontrolliert nachliefern

`TIME_OFFSET_MISSING` bedeutet: Der Zeitstempel ist lesbar, aber sein UTC-Bezug
fehlt. Ältere Collector-Versionen speicherten die **System-Lokalzeit** ohne Offset.
**Frankfurt als Tankort beweist nicht die Zeitzone des Pi/Collectors.**

### Zuerst die ursprüngliche Zeitzone klären

Auf dem **RPi**, nicht am Windows-PC:

```bash
timedatectl show -p Timezone --value
```

Das zeigt die **heutige Systemzeitzone**. Sie darf nur dann für die Sicherung
verwendet werden, wenn sie während der damaligen Erfassung ebenfalls galt und
der Collector keine eigene `TZ`-Vorgabe hatte. Bei einer späteren Änderung nicht
automatisch den heutigen Wert übernehmen.

Falls unklar ist, ob der laufende Dienst `TZ` separat setzt, zeigt dieser
**nur lesende** Check ausschließlich die Zeitzoneninformation, nicht die übrige
Prozessumgebung oder API-Keys:

```bash
PID="$(systemctl show tankapp-collector -p MainPID --value)"
sudo python3 - "$PID" <<'PY'
from pathlib import Path
from zoneinfo import ZoneInfo
import sys
try:
    pid = int(sys.argv[1])
    if pid <= 0:
        raise ValueError
    entries = (Path('/proc') / str(pid) / 'environ').read_bytes().split(b'\0')
    value = next((item[3:] for item in entries if item.startswith(b'TZ=')), None)
    if value is None:
        print('Collector: keine TZ-Variable; Systemzeitzone maßgeblich (sofern damals unverändert).')
    else:
        try:
            zone = ZoneInfo(value.decode('utf-8').removeprefix(':'))
            if zone.key in ('localtime', 'posixrules'):
                raise ValueError
            print('Collector-TZ: ' + zone.key)
        except Exception:
            print('Collector: eigene TZ-Vorgabe, nicht als benannte Zone erkannt; Originalkonfiguration privat prüfen.')
except Exception:
    print('Collector-Prozess nicht lesbar/aktiv; ursprüngliche Zeitzone anderweitig klären.')
PY
```

Die aktuelle Prozessumgebung ist ebenfalls nur ein Hinweis, kein historischer
Nachweis nach Konfigurationsänderungen. Bei Unsicherheit zunächst nur die
Zeitzonen-Ausgaben und die Information, ob diese Einstellung geändert wurde,
weitergeben; **keine vollständige Prozessumgebung oder Sicherung posten**.

### Danach ausdrücklich wählen, weiterhin nur Dry-Run

**Erst wenn die ursprüngliche Zone bestätigt ist.** Zum Beispiel `Europe/Berlin`,
wenn der alte Collector tatsächlich in dieser Zone lief; `UTC`, wenn er UTC
benutzte. Nicht zwischen beiden ausprobieren, um einen Fehler verschwinden zu lassen.

```bash
read -r -p "Bestätigte ursprüngliche Collector-Zeitzone (IANA-Name): " REPLAY_TZ
REPLAY_TIME_ARGS=(--replay-timezone "$REPLAY_TZ")
python3 data-tools/upload_influx.py --replay --dry-run --poll-dir "$BACKUP/poll" --poll-json "$BACKUP/polling.json" "${REPLAY_TIME_ARGS[@]}"
```

Der Zusatz gilt **nur** für Snapshot-Zeiten ohne Offset. Vorhandene `Z`-/Offset-
Zeitstempel bleiben maßgeblich. Die Zuordnung erfolgt im Speicher nach den
Zeitzonenregeln des jeweiligen Datums (Winter/Sommer), nicht mit dem heutigen
festen Offset. Die Originaldateien und Ack-Dateien werden nicht verändert.
Mehrdeutige oder nicht existente Uhrzeiten an Zeitumstellungen bleiben Fehler.
Wenn die Sicherung mehrere ursprüngliche Zeitzonen mischt, erst deren Zeiträume
belegen und getrennt behandeln; keine pauschale Zone über alles legen.

Bei Erfolg nennt die Vorschau die ausdrücklich gewählte Zone und die Anzahl
zugeordneter alter Snapshots. Danach **im selben SSH-Fenster** mit §4 fortfahren:
Die dort verwendete Argumentliste übernimmt dieselbe bestätigte Zone.
`REPLAY_TIME_ARGS` vor dem tatsächlichen Replay nicht wieder leeren. Nach einem
neuen Login `BACKUP` und gegebenenfalls die bestätigte Zeitzonen-Argumentliste
wieder setzen. Ohne `--replay-timezone` bleibt der alte strikte Abbruch bestehen.

**Für künftige Aufzeichnungen:** Der aktuelle Collector speichert Offsets. Ein
Git-Update ersetzt jedoch nicht den Code eines bereits laufenden Python-Prozesses.
Falls neue Originalzeilen weiterhin keinen Offset tragen, ist später ein
kontrollierter Collector-Neustart nötig; dabei mindestens 300 Sekunden Abstand
zwischen Tankerkönig-Requests einhalten. Ein Neustart verändert die alte Sicherung
nicht. Weder Pi-Zeitzone noch `source`/Zeitstempel in der Sicherung als Reparatur umschreiben.

## 4. Geprüfte Sicherung mit dem vorhandenen RPi-Schreibzugang nachliefern

**Erst nach erfolgreicher Vorschau.** Das ist ein bewusster Write ins bestehende
`prices`-Measurement, mit ursprünglichen Zeitstempeln und zusätzlicher UUID.
Dafür wird der bereits funktionierende **Schreib-Token des RPi-Uploaders** aus
`/etc/tankapp/env` verwendet – nicht der PC-Lese-Token und nicht der Tankerkönig-Key.
Den Token nicht auf die Kommandozeile kopieren und die Env-Datei nicht ausgeben.

Im selben SSH-Fenster (Repository-Ordner und `BACKUP` wie oben):

```bash
sudo systemd-run --wait --pipe --collect -p "User=$(id -un)" -p EnvironmentFile=/etc/tankapp/env /usr/bin/python3 "$PWD/data-tools/upload_influx.py" --replay --poll-dir "$BACKUP/poll" --poll-json "$BACKUP/polling.json" "${REPLAY_TIME_ARGS[@]}"
```

`systemd-run` startet einen einmaligen Prozess und lädt die bestehende private
Umgebung, ohne deren Inhalt als Shell-Code auszuführen oder den Token im Befehl
zu speichern. Er verändert die laufende Uploader-Unit nicht.

Erwartet: bestätigte Batches und am Ende **`Replay erfolgreich`**. Der Vorgang:

- liest auch bereits bestätigte Originalzeilen aus der **Sicherung**;
- schreibt in Batches von höchstens 1000 Punkten;
- verändert **keinen** Ack, auch nicht bei Fehlern;
- löscht keine alten Namensserien; Ziel ist der in der bestehenden Uploader-
  Umgebung konfigurierte Bucket (hier `tankapp`, nicht die Einstellungen eines
  anderen Smarthome-Projekts übernehmen);
- ist mit **derselben Sicherung, demselben Polling-Metadaten-Snapshot und derselben
  gegebenenfalls gewählten ursprünglichen Zeitzone** wiederholbar: dieselben Tags/Zeitstempel adressieren dieselben UUID-Punkte.

Der normale Uploader kann parallel weiterlaufen; Replay fasst seinen Ack nicht
an. Stationsnamen/Metadaten während dieser Migration nicht umbenennen, damit die
vollständigen Tags bei Wiederholung gleich bleiben. Bei einem Fehler können
bereits bestätigte Batches vorhanden sein: Fehler beheben und denselben Replay
wiederholen, nicht den Ack löschen. Der Uploader soll unabhängig davon weiterlaufen.

## 5. Auf dem Windows-PC nur die eindeutigen UUID-Punkte exportieren

Das bisherige private `data\influx.env` mit dem PC-Lese-Token und das unveränderte
aktive `docs\analysis\stations\polling.json` verwenden:

```powershell
python .\data-tools\export_influx.py --env-file .\data\influx.env --uuid-only
```

`--uuid-only` nimmt ausschließlich Punkte mit `station_id` für die ausgewählten
UUIDs der jeweiligen Stadt auf. Alte Punkte ohne UUID werden **bewusst nicht
exportiert**, nicht aus InfluxDB gelöscht. Dadurch wird auch nach einer späteren
Stationsauswahl keine alte vermischte Namensserie einem verbleibenden Kandidaten
zugeschrieben.

Erwartet: ein erfolgreicher Export nach `data\engine\influx_e10.csv.gz` mit getrennten
`station_id`-Werten für beide Arals. Ohne Nachlieferung enthält er nur die Daten
seit dem aktualisierten Uploader-Start. Ein leerer Export ersetzt nicht die letzte
gültige Datei; dann prüfen, ob bereits ein neuer Poll hochgeladen wurde.

Der Export ohne `--uuid-only` bleibt aus Kompatibilitätsgründen möglich, stoppt
aber weiterhin bei mehrdeutigen alten Namen. **Für diesen Migrationsfall deshalb
`--uuid-only` beibehalten.** `--check-connection` prüft nur den Zugriff, nicht diese
Datenzuordnung; es ist kein Ersatz für den tatsächlichen UUID-Export.

## 6. Erst danach Datenqualität und M3 weiter prüfen

Der Live-Export enthält möglicherweise nur wenige Tage. Deine ursprünglichen
M2-CSV-Dateien haben weiterhin die getrennten UUIDs und können das Training ergänzen:

```powershell
py -3 -m engine inspect --data "data/ready/*.csv*" data/engine/influx_e10.csv.gz --polling .\docs\analysis\stations\polling.json
```

Bei ausreichender Historie folgt der Backtest nach [Engine-Anleitung](../engine/README.md).
Fehlende Originalzeiträume, rekonstruierte M2-Raster und unbekannte Öffnungszeiten
bleiben Qualitätsgrenzen. Diese Migration ist **keine M3-Güteabnahme**.

**Kurz:** Beide unterschiedlichen Arals behalten → Uploader-Code aktualisieren →
Originalpuffer sichern → aktualisierten Uploader starten → Sicherung prüfen und
gezielt nachliefern → auf dem PC `--uuid-only` exportieren. Keine neue InfluxDB,
keine gelöschten Serien, kein zurückgesetzter Ack.
