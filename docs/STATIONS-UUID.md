# Gleiche Stationsnamen sauber trennen – RPi und Windows-PC

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

**Die folgenden Befehle ändern erst bei der ausdrücklich gestarteten Nachlieferung
die InfluxDB.** Sie löschen keine alten Serien und setzen keinen Ack zurück.
Private Konfigurationen/Schlüssel nicht posten. Beide GUI-Vorlagen bleiben unverändert.

## 1. Code auf PC und RPi aktualisieren

Auf beiden Rechnern den Stand mit `station_id`, `--replay` und `--uuid-only`
übernehmen. Aktueller Arbeitsbranch dieser Änderung: `arena/01a07be6-tankapp`.

Zuerst `git status --short` ansehen. Bei eigenen Änderungen, Konflikten oder
Git-Fehlern anhalten; kein `reset --hard`, keine privaten Daten löschen.
Die laufenden Dienste müssen für das Git-Update noch nicht gestoppt werden.

**Windows/PowerShell**, im TankApp-Ordner:

```powershell
git status --short
git fetch origin
git switch arena/01a07be6-tankapp
git pull --ff-only origin arena/01a07be6-tankapp
```

**RPi/SSH**, als Benutzer des bisherigen TankApp-Checkouts (im Standard-Setup `pi`):

```bash
cd ~/TankApp
git status --short
git fetch origin
git switch arena/01a07be6-tankapp
git pull --ff-only origin arena/01a07be6-tankapp
```

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
python3 data-tools/upload_influx.py --replay --dry-run --poll-dir "$BACKUP/poll" --poll-json "$BACKUP/polling.json"
```

Erwartet: Anzahl Original-Snapshots/UUID-Punkte sowie einige Line-Protocol-Zeilen.
Bei gleichnamigen Stationen müssen darin **verschiedene `station_id=`-Werte**
stehen. Die Vorschau braucht keinen Token, sendet nichts und liest/schreibt
keine Ack-Datei. Die Ausgabe enthält Preise/Stationsdaten, aber keine API-Schlüssel.

Der Replay-Modus prüft **alle Eingaben vor dem ersten Write**. Er stoppt bei
kaputten Zeilen, Demo-/unbekannten Quellen, ungültigen UUIDs, fehlendem UTC-Offset,
nicht endlichen Preisen oder widersprüchlichen Werten für dieselbe UUID/Zeit.
Er ergänzt keine geratenen Zeitstempel oder Preise. Wird eine Quelldatei beim
Lesen verändert, wird ebenfalls abgebrochen.

Bei einer möglicherweise während des Kopierens unvollständigen letzten Zeile:
neue Sicherung anlegen und erneut prüfen. Nicht den laufenden Puffer oder dessen
Ack zum Erzwingen eines Erfolgs bearbeiten. Wenn keine ursprünglichen JSONL-Dateien
mehr vorhanden sind, §4 überspringen und mit §5 nur die neuen UUID-Punkte lesen.
Ältere, nur nach Namen zusammengefallene Daten sind ohne Originalquelle nicht
rückwirkend zuverlässig rekonstruierbar.

## 4. Geprüfte Sicherung mit dem vorhandenen RPi-Schreibzugang nachliefern

**Erst nach erfolgreicher Vorschau.** Das ist ein bewusster Write ins bestehende
`prices`-Measurement, mit ursprünglichen Zeitstempeln und zusätzlicher UUID.
Dafür wird der bereits funktionierende **Schreib-Token des RPi-Uploaders** aus
`/etc/tankapp/env` verwendet – nicht der PC-Lese-Token und nicht der Tankerkönig-Key.
Den Token nicht auf die Kommandozeile kopieren und die Env-Datei nicht ausgeben.

Im selben SSH-Fenster (Repository-Ordner und `BACKUP` wie oben):

```bash
sudo systemd-run --wait --pipe --collect -p "User=$(id -un)" -p EnvironmentFile=/etc/tankapp/env /usr/bin/python3 "$PWD/data-tools/upload_influx.py" --replay --poll-dir "$BACKUP/poll" --poll-json "$BACKUP/polling.json"
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
- ist mit **derselben Sicherung und demselben Polling-Metadaten-Snapshot**
  wiederholbar: dieselben Tags/Zeitstempel adressieren dieselben UUID-Punkte.

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
.\.venv-m3\Scripts\python.exe -m engine inspect --data "data/ready/*.csv*" data/engine/influx_e10.csv.gz --polling .\docs\analysis\stations\polling.json
```

Bei ausreichender Historie folgt der Backtest nach [Engine-Anleitung](../engine/README.md).
Fehlende Originalzeiträume, rekonstruierte M2-Raster und unbekannte Öffnungszeiten
bleiben Qualitätsgrenzen. Diese Migration ist **keine M3-Güteabnahme**.

**Kurz:** Beide unterschiedlichen Arals behalten → Uploader-Code aktualisieren →
Originalpuffer sichern → aktualisierten Uploader starten → Sicherung prüfen und
gezielt nachliefern → auf dem PC `--uuid-only` exportieren. Keine neue InfluxDB,
keine gelöschten Serien, kein zurückgesetzter Ack.
