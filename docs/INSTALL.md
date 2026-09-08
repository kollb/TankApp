# TankApp einrichten — vom Polling zur GUI

**Das ist der einzige Installationseinstieg.** Stand: 08.09.2026.
Die anderen Dokumente sind Nachschlagewerke, keine nacheinander auszuführenden
Checklisten. Tests, Backtests und Stationslabore sind **keine Pflichtschritte für dich**.

## Ziel und Rollen

```text
Tankerkönig live ──→ Pi: gemeinsamer Collector + RAM-Puffer ──→ NAS: InfluxDB
Tankerkönig-Archiv ─────────────────────────────────────────→ NAS: Preis-/Stationsdateien
                                                            ↓
                                                   Aufbereitung + Modelle
                                                            ↓
                                                   NAS: API + Web-GUI
                                                            ↓
                                                    Handy / PC: Browser
```

- **Pi:** 24/7 sammeln und hochladen, keine Jahresarchive herunterladen oder Modelle fitten.
- **NAS:** dauerhafter Daten- und App-Server. Archivabruf, Lückennachholung,
  InfluxDB, automatische Fits, API und GUI. Eine bestehende InfluxDB
  weiterverwenden; keine zweite Instanz anlegen.
- **PC:** optional einrichten oder Rechenläufe beschleunigen. Für den Alltag nur
  ein Browser. **Keine verpflichtende venv, kein tägliches Kopieren aufs NAS.**
- **Wenn das NAS aus ist:** keine NAS-Jobs und keine dort gehostete GUI.
  Der Pi sammelt weiter; der bestehende RAM-Puffer überbrückt bis zu sieben Tage,
  aber keinen Pi-Neustart/Stromverlust. Archivdateien werden beim nächsten
  NAS-Lauf nachgeholt. Das ersetzt keine verlorenen Live-Statusbeobachtungen.

## Die verbindliche Reihenfolge

| Schritt | Ergebnis für dich | Heute ausführbar? |
|---|---|---|
| **1. Gütersloh mitpolling starten** | Beide Städte sammeln Live-Daten, ohne Preis-Historienanalyse abzuwarten. | Ja: Vorbereitung + Aktivierung unten. |
| **2. NAS-App starten** | Echte Preise, Stadt/Kraftstoff wählen, Status und Datenalter sehen. | Implementiert: `nas-up` unten. Keine erfundene Warteempfehlung. |
| **Parallel: NAS-Archiv aufbauen** | Ein Jahr oder mehr Vorgeschichte, fehlende Tage nachholen. | Im App-Dienst enthalten; blockiert Live-Preise nicht. |
| **3. Automatische Berechnung** | Aufbereitung, Fits, Prüfwerte und Veröffentlichung; letzte gute Ergebnisse bei Fehlern behalten. | Im App-Dienst enthalten, zunächst ausdrücklich unkalibriert. |
| **4. Empfehlungen in derselben GUI** | Jetzt / warten / woanders mit nachvollziehbarem Netto-Vorteil. | Nach Echt-Datenprüfung und Kalibrierung, nicht nach einer pauschalen 90-Tage-Frist. |

**Für deine bestehende Installation gilt:** Pi-Collector, Uploader und InfluxDB
nicht neu installieren. Zuerst denselben aktuellen TankApp-Code auf den verwendeten
Geräten bereitstellen. Die gebündelten Einrichtungsbefehle brauchen auf dem jeweiligen Gerät nur
Python 3.11+ und die Standardbibliothek, **keine pip-/venv-Einrichtung**.
Auf dem NAS wird zusätzlich Docker mit Compose v2 benötigt; das App-Image
installiert seine Rechenpakete und baut die GUI selbst.
Die Aktivierung ist für die bestehenden Standard-systemd-Dienste vorgesehen;
abweichende Startpfade oder ein festes `--poll-city` werden nicht heimlich geändert.

## Jetzt: Gütersloh aufnehmen

Am einfachsten **direkt auf dem Pi im TankApp-Ordner**, damit keine Dateien
zwischen PC und Pi hin- und herkopiert werden müssen:

```bash
python3 tankapp.py add-city
sudo python3 tankapp.py activate-polling
```

**Was du einmalig angibst:** den tatsächlichen Gütersloher Anker als Breitengrad
und Längengrad (Dezimalpunkt). Liegt er bereits in `analysis/config.local.json`,
wird nicht erneut gefragt. Koordinaten bleiben lokal. Bei Gütersloh wird `NW`
für Nordrhein-Westfalen ergänzt. Frankfurt bleibt unverändert.

**Was der erste Befehl erledigt:** vorhandene Stationsliste verwenden oder über
den bereits eingerichteten Archivzugang die neueste laden; nahe Stationen im
5-km-Radius auswählen, nach Marke/Standort entzerren, alle bisherigen Stadtsets
beibehalten und einen gemeinsamen Vorschlag schreiben. **Kein Preis-Jahresdownload,
keine M2-/M3-Analyse nötig.** Vorläufige Auswahl nach Nähe/Markenvielfalt, noch
keine Aussage „diese Station ist die billigste“. Stationsliste und spätere Live-
Antworten müssen tatsächliche Verfügbarkeit/Kraftstoffe bestätigen.

Der zweite Befehl sichert die alte Auswahl, übernimmt den Vorschlag und startet
Collector und Uploader neu. Bei fehlgeschlagenem Neustart wird die vorige Auswahl
zurückgespielt. Keine Datenbankänderung, kein Ack-Reset. Geänderte/entfernte alte
Stadtsets werden auf diesem Additionspfad abgewiesen. Ein erfolgreicher Dienststart
ist noch kein Nachweis erfolgreicher API-Antworten.

**Request-Budget:** ein gemeinsamer Collector, höchstens zehn UUIDs pro Request,
standardmäßig ein Request alle fünf Minuten. Mit Frankfurt + Gütersloh wird
**jede Stadt etwa alle zehn Minuten** abgefragt. Die erste echte Abfrage nach
Start ohne gespeicherten Zeitplan wartet vorsichtshalber fünf Minuten. Der
Zeitplan bleibt bei Prozessneustarts erhalten, solange der Puffer besteht;
429/Fehler erlauben keinen sofortigen zusätzlichen Request. Nicht parallel
mit demselben Key auf dem PC oder in einem zweiten Puffer pollen.

Im Collector-/Uploader-Log bzw. InfluxDB prüfen, dass beide Stadtlabels ankommen.
Die 90-Tage-Prüfung der Engine berücksichtigt mit `--polling` die gemeinsame
Kadenz; zehnminütige Abfragen sind nicht automatisch 50 % Ausfall.

<details>
<summary>Nur falls die Vorbereitung lieber am PC oder mit der NAS-Stationsliste stattfinden soll</summary>

Windows verwendet einfach `py -3 tankapp.py add-city`; keine venv erforderlich.
`--stations <Datei.csv.gz>` erlaubt die vorhandene Stationsliste auf einer NAS-
Freigabe. Alternativ zeigt `--archive-dir <Verzeichnis>` auf das NAS-Archiv.
Wenn kein Archivzugang auf dem Pi eingerichtet ist, ist das der Weg ohne einen
zusätzlichen Zugang auf dem Pi. Danach nur `data/setup/polling.json` auf den Pi
an denselben relativen Ort übertragen und dort den Aktivierungsbefehl ausführen.
Für die Preis-GUI genügen die Stationsmetadaten im gemeinsamen Polling-Set;
private Anker werden nicht an den Browser übertragen.

Andere Stadt: `--city Name`; Radius/Anzahl nur bei Bedarf mit `--radius`/`--size`.
Die Standard-Aktivierung erwartet `tankapp-collector` und `tankapp-uploader` als
laufende systemd-Dienste. Bei Sonderkonfiguration sicher abbrechen statt Dienste
oder Dateipfade zu erraten. Der Vorschlag ist kein Deployment des Programm-Codes.

</details>

## Danach auf dem NAS: ein App-Dienst für GUI, Archiv und Berechnung

**Einmalig bereitstellen**, auf dem NAS im aktuellen TankApp-Checkout:

1. Das **aktive gemeinsame** `docs/analysis/stations/polling.json` vom Pi,
   nach dessen Aktivierung — nicht den alten Frankfurt-Stand. Bei späteren
   Änderungen dieselbe Datei erneut bereitstellen und `nas-up` wiederholen.
2. `data/influx.env` mit dem vorhandenen InfluxDB-Lesezugang. Format siehe
   technische Referenz unten: `TANKAPP_INFLUX_URL`, `TANKAPP_INFLUX_ORG`,
   `TANKAPP_INFLUX_BUCKET`, `TANKAPP_INFLUX_TOKEN`. Möglichst eigenen
   **Nur-Lese-Token** für denselben Bucket nutzen; den Pi-Schreibzugang nicht ändern.
   Die URL muss aus dem Container erreichbar sein, z. B. die NAS-LAN-Adresse
   mit Port 8086 — **nicht `localhost`**.
3. Den vorhandenen Tankerkönig-Archivzugang privat als `data/_netrc` oder
   `~/.netrc` für den ausführenden NAS-Benutzer. Das ist **nicht** der
   Collector-API-Key. Keine Zugangsdaten in Git, Befehlszeilen oder Chat.
   Ohne Archivzugang kann die Live-GUI trotzdem starten.

Dann auf dem NAS:

```bash
python3 tankapp.py nas-up
```

Danach im Browser **`http://<NAS-Adresse>:8080`** öffnen. Das NAS braucht Docker
mit Compose v2 und beim ersten Build Internetzugang. Auf dem PC/Handy braucht
es weder Node noch Python-Pakete. Bestehende InfluxDB, Collector und Uploader
werden von diesem Befehl **nicht neu installiert oder verändert**.

Andere Speicher-/Konfigurationspfade beim ersten Aufruf angeben, beispielsweise:

```bash
python3 tankapp.py nas-up --archive-dir /srv/tankapp/archive --runtime-dir /srv/tankapp/runtime --polling /privater/pfad/polling.json --influx-env /privater/pfad/influx.env --netrc /privater/pfad/netrc
```

Das sind **Beispielpfade**, keine zusätzlich anzulegenden Pflichtverzeichnisse.
Ohne Optionen liegen Archiv und Laufdaten dauerhaft unter `data/raw` und
`data/runtime` im NAS-Checkout, nicht im flüchtigen Container-Dateisystem.
Der ausführende Benutzer benötigt Docker-Zugriff, Lesezugriff auf die privaten
Dateien und Schreibzugriff auf Archiv/Laufdaten. Neu angelegte Ausgabeordner
bekommen bei `sudo` den ursprünglichen Benutzer; vorhandene NAS-ACLs werden
nicht rekursiv verändert. Private Dateien nur für diesen Benutzer lesbar halten.

**Start und spätere Updates bleiben derselbe Befehl:** `python3 tankapp.py nas-up`.
Er merkt sich Pfade/Optionen in der privaten `data/nas-settings.json`, baut das
aktuelle App-Image und startet es neu. Der Code selbst muss vorher aktualisiert
werden. Auch nach Austausch privater Konfigurationsdateien diesen Befehl wiederholen,
weil die Dateien schreibgeschützt eingebunden sind. Zugangsdaten kommen nicht ins Image.

**Nur Heimnetz/VPN:** Die App hat bewusst noch keine Benutzeranmeldung. Keine
ungeschützte Portfreigabe ins Internet. Für TLS einen vorhandenen privaten
NAS-Reverse-Proxy verwenden; die API bleibt unter derselben Browser-Adresse.

### Was danach automatisch läuft

| Aufgabe | Zeitplanung und Verhalten |
|---|---|
| **GUI + Nur-Lese-API** | Ein gemeinsamer Dienst. Preise alle 30 Sekunden neu lesen; Anzeige höchstens 30 Minuten alter, offener Preisbeobachtungen. Keine zusätzlichen Tankerkönig-Live-Requests. |
| **Archiv** | Bei App-/NAS-Start, danach stündlich. Preis- und Stationsdateien bis gestern; alle fehlenden Tage seit gespeichertem Beginn nachladen. |
| **Modelle** | Bei App-/NAS-Start, danach täglich nach erfolgreichem Lauf. Bei fehlenden Daten/Fehlern stündlich erneut versuchen. Läuft unabhängig vom Archivabruf. |
| **Veröffentlichung** | Erst nach fertiger Berechnung atomar ersetzen. Teilweise erneuerte Stationen kennzeichnen alte Ergebnisse; ohne erfolgreichen Fit bleibt der letzte brauchbare Stand erhalten. |
| **Neustart** | Docker `restart: unless-stopped`; startet mit Docker auf dem NAS, sofern nicht ausdrücklich gestoppt. Zeitplanung braucht keinen PC und holt nach dem Start nach. |

**Keinen zusätzlichen cron-Job einrichten.** Der gebündelte App-Dienst übernimmt
jetzt die früher separat beschriebene NAS-Zeitplanung. Bereits eingerichtete
`history-sync`-/Modell-cron-Jobs einmal deaktivieren, nicht zusätzlich laufen lassen.
`history-sync` bleibt als Einzelwerkzeug für Installationen ohne App-Dienst erhalten.
Prozesssperren schützen vor überlappenden Läufen.

**Archivumfang:** standardmäßig **365 Tage**, für zwei Jahre beim `nas-up`-Aufruf
`--history-days 730` ergänzen. Ein Jahr ist keine Obergrenze und keine Löschfrist:
der gespeicherte Beginn wird bei Folgeläufen nicht nach vorne verschoben,
ältere Rohdateien bleiben erhalten. Genügend NAS-Speicher einplanen — es ist das
nationale Tagesarchiv, nicht nur das kleine Stationsset. Modelle verwenden einen
kleineren, abgeleiteten Ausschnitt; der komplette Bestand wird nicht jedes Mal gefittet.

Abgebrochene Downloads werden über temporäre Dateien fortgesetzt/neu versucht;
vorhandene nichtleere Tagesdateien werden übersprungen. 404, leere Dateien und
Zugriffsfehler lassen den Bestand unvollständig. Der Systembereich zeigt Lücken
und letzten vollständigen Tag. **Dateivollständigkeit ist noch keine fachliche
Preisqualitätsprüfung oder Integritätsprüfung bereits vorhandener Altdateien.**

**Modellumfang:** zunächst E10; bei Bedarf `--model-fuels e10,e5,diesel` ergänzen.
Die Live-GUI unterstützt alle drei Kraftstoffe unabhängig davon. Die Kette liest
InfluxDB, verarbeitet rohe Archiv-Änderungsereignisse mit exakten Zeitstempeln,
erzeugt den gemeinsamen Trainingsbestand, fittet/publiziert den 24-Stunden-Ausblick
und berechnet einen siebentägigen retrospektiven Backtest. Das ist **kein
zeitgetreuer Betriebs-Replay und kein Kalibrierungsnachweis**.

Archiv und Polling sind **dieselben Tankerkönig-Marktdaten über zwei Bezugswege**.
Historie kann den Modellstart tragen; es gibt **keine dreimonatige Wartepflicht**.
Standardtraining: letzte 42 Tage, Archiv nur vor Beginn der Live-Beobachtungen;
es repariert danach keine Live-Lücken oder beobachteten Schließungen.
Nach 90 vollständigen Live-Tagen mit ausreichender tatsächlicher Polling-Abdeckung
kann je Station/Kraftstoff auf Polling-only umgestellt werden. Die Statistik zeigt
Fortschritt und verwendete Regel. **Das NAS-Roharchiv und sein Sync bleiben bestehen.**

### Was du in der GUI siehst — und was noch nicht freigegeben ist

- **Alltag:** Stadt/Kraftstoff, günstigster aktuell gemeldeter offener Preis,
  Datenalter, Tankmenge, reiner Preisvergleich und Route bei gültigen Koordinaten.
  Stadt, Kraftstoff und Tankmenge merkt sich der Browser. Keine Tankbuchung,
  keine als netto ausgegebene Umweg-Ersparnis.
- **Statistik:** tatsächlicher Preisverlauf mit Lücken, Modell-Ausblick und
  Backtestwerte samt Datenbasis. Fehlende/alte Modelle sind sichtbar markiert.
- **System:** Konfiguration, Archiv-Lücken, Job-Ergebnisse und letzte Veröffentlichung.
  Fehlende Zugangsdaten ergeben einen ehrlichen Einrichtungszustand, keine Demo-Preise.

**Einmalige Echt-Daten-Abnahme:** Nach dem Start im Alltag beide Städte und den
gewünschten Kraftstoff prüfen: plausible Stationen, aktuelle Zeitstempel, echte
Preise. Unter System müssen der Lesezugang und nach dem ersten Abruf die
Archiv-/Job-Stände passen. Ein laufender Container allein bestätigt das nicht.
NAS-Auszeiten und Pi-Puffergrenze stehen bei den Rollen oben.

**Stand dieser Lieferung:** GUI, API, App-Start, Archiv-Zeitplanung und
Modellveröffentlichung sind implementiert und softwaregetestet. Der Docker-Build
und der Betrieb mit deinen privaten Daten auf deinem NAS sind hier noch nicht
abgenommen. Zweitmodell/Ensemble, weitere Modellbausteine, echte Güteprüfung und
Out-of-sample-Kalibrierung bleiben offen; deshalb weiterhin
`calibrated=false` / `decision_ready=false`. Noch kein belastbares „bis 18 Uhr
warten“, keine erfundenen Wahrscheinlichkeiten oder garantierten Ersparnisse.

---

<details>
<summary>Technische Referenz: nur bei Erstinstallation von Pi/InfluxDB oder einer konkreten Störung öffnen</summary>

Die folgenden Service-/Backup-Details sind für eine noch nicht eingerichtete
Basis oder die Fehlersuche. Sie sind **nicht** nach den obigen Schritten erneut
abzuarbeiten. Bestehende Dienste, Buckets und Secrets weiterverwenden.

## 2. Technische Referenz — Collector auf dem Raspberry Pi (24/7)

Raspberry Pi OS (Lite reicht). Für den gebündelten Launcher Python 3.11+
verwenden; auf älteren Images zuerst die Python-Version prüfen.

### 2.1 Repo auf den Pi bringen

```bash
# auf dem Pi
sudo apt update && sudo apt install -y git python3
git clone https://github.com/kollb/TankApp.git ~/TankApp
cd ~/TankApp
```

### 2.2 Die zwei privaten Dateien auf den Pi kopieren

Repo + Code kommen von GitHub — zwei Dateien sind gitignored und müssen
**manuell** vom PC auf den Pi (z. B. per `scp`/Freigabe):

```powershell
# vom Windows-PC aus:
scp "docs\analysis\stations\polling.json" pi@<pi-ip>:~/TankApp/docs/analysis/stations/
scp "data\apikey.txt" pi@<pi-ip>:~/TankApp/data/
```

Alternative ohne Key-Datei: Key in die systemd-Umgebung (2.4).

### 2.3 RAM-Puffer (tmpfs) — SD-Karte schonen

```bash
# Puffer-Verzeichnis im RAM anlegen und beim Booten mounten
sudo mkdir -p /dev/shm/tankapp
echo 'tmpfs  /dev/shm/tankapp  tmpfs  defaults,noatime,size=32M,mode=0755  0  0' | sudo tee -a /etc/fstab
sudo mount /dev/shm/tankapp
```

> ⚠️ **Eigentümer!** Das Verzeichnis gehört nach `sudo mkdir -p` dem User
> `root`, der Dienst läuft aber als `pi` → beim Schreiben kommt
> `PermissionError: [Errno 13] Permission denied`. Eigentümer korrigieren:
>
> ```bash
> sudo chown pi:pi /dev/shm/tankapp        # Dienst-User = pi
> ```
>
> Der Collector prüft die Schreibbarkeit jetzt beim Start und meldet das
> klar („Puffer … nicht beschreibbar“), statt beim ersten Poll abzustürzen.

32 MiB reichen weit: ~0,6 MB JSONL pro Tag, Ringpuffer hält 7 Tage.
SD-Härtung zusätzlich (optional, Konzept §9.3): `vm.swappiness=10`.

### 2.4 systemd-Dienst (startet automatisch, startet bei Absturz neu)

```bash
sudo tee /etc/systemd/system/tankapp-collector.service > /dev/null <<'UNIT'
[Unit]
Description=TankApp M1 Preis-Collector (Tankerkoenig)
After=network-online.target time-sync.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/TankApp
# API-Key alternativ hier statt data/apikey.txt (Datei mit chmod 600 bevorzugen):
# Environment=TANKERKOENIG_API_KEY=00000000-0000-0000-0000-000000000000
Environment=TANKAPP_POLL_DIR=/dev/shm/tankapp
ExecStart=/usr/bin/python3 /home/pi/TankApp/data-tools/collect_prices.py
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now tankapp-collector
```

> ⚠️ **Wichtig:** `daemon-reload` + `enable --now` starten einen bereits
> laufenden Dienst **nicht neu**. Nach jeder Änderung an der Unit (z. B.
> `TANKAPP_POLL_DIR`) oder an `polling.json`/`apikey.txt` deshalb:
>
> ```bash
> sudo systemctl restart tankapp-collector
> ```

Key als Datei sicherer als in der Unit:

```bash
chmod 600 ~/TankApp/data/apikey.txt
```

### 2.5 Betrieb & Kontrolle

```bash
systemctl status tankapp-collector     # läuft er?
journalctl -u tankapp-collector -f     # Live-Log (Polls alle 5 min, 06–24 Uhr)
ls -la /dev/shm/tankapp/               # Snapshots: YYYY-MM-DD.jsonl
tail -f /dev/shm/tankapp/$(date +%F).jsonl
```

Außerhalb des Fensters (00–06 Uhr) schläft der Collector und loggt das;
er pollt automatisch wieder ab 06 Uhr. Manueller Testpoll:

```bash
python3 data-tools/collect_prices.py --once --out /dev/shm/tankapp
python3 data-tools/collect_prices.py --demo --once --out data/test-poll  # isoliert, nie hochladen
```

Aktualisieren, wenn sich das Polling-Set ändert (neue `polling.json`
nach `scp`):

```bash
sudo systemctl restart tankapp-collector
```

Code aktualisieren: `git pull` im Repo, dann ebenfalls Restart.

### 2.6 Störungsfälle

| Log-Meldung | Bedeutung / Aktion |
|---|---|
| `HTTP 429` | API-Limit (1 Request/5 min) — Collector wartet automatisch 60 s und wiederholt |
| `no prices` (Station) | Station meldet gerade keine Preise; nach **7 Polls** (~35 min) Alarm im Log → Station prüfen (Urlaub/Baustelle) |
| `Fenster zu … schlafe` | normal zwischen 00 und 06 Uhr |
| `parameter error` | **ids ODER apikey kamen leer bei der API an** — siehe Fehlerdiagnose unten |
| `Key existiert nicht oder ist deaktiviert` | Key in `data/apikey.txt` unbekannt/nicht aktiviert → bei tankerkoenig.de prüfen |
| `eine oder mehrere Tankstellen-IDs nicht im korrekten Format` | `polling.json` enthält UUIDs außerhalb des Formats `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `⚠ … UUIDs haben kein gültiges UUID-Format` | Collector hat beim Start kaputte UUIDs erkannt und übersprungen → `polling.json` neu erzeugen |
| `⚠ API-Key sieht nicht nach einer UUID aus` | `apikey.txt` enthält mehr als den nackten Key (Label/Kommentar?) → nur den 36-Zeichen-Key in eine Zeile |
| `⚠ Proxy-Umgebung gesetzt` | `http_proxy`/`https_proxy` ist gesetzt; ein Proxy kann den API-Aufruf verfälschen (s. u.) |
| `Puffer … nicht beschreibbar` / `PermissionError: [Errno 13]` | `/dev/shm/tankapp` gehört `root`, Dienst läuft als `pi` → `sudo chown pi:pi /dev/shm/tankapp` (s. 2.3) |
| Dienst startet nicht | `journalctl -u tankapp-collector -n 50`; meist fehlt `polling.json` (2.2) oder der Key |

### 2.7 Fehlerdiagnose „parameter error“

Die Tankerkönig-API antwortet `ok=false` mit `parameter error` **nur**, wenn
`ids` oder `apikey` **leer/fehlend** ankommen (ein falscher Key ergibt
„Key existiert nicht…“, eine kaputte UUID „…nicht im korrekten Format“).
Der Collector sendet immer beide Parameter — also nacheinander prüfen:

```bash
# 1) Was steht wirklich im Polling-Set?
python3 - <<'PY'
import json
p = json.load(open("/home/pi/TankApp/docs/analysis/stations/polling.json"))
s = next(iter(p["sets"].values()))
print("label:", s.get("label"))
print("batch:", s.get("batch"))
PY

# 2) Enthält apikey.txt GENAU eine Zeile mit dem 36-Zeichen-Key?
#    (zeigt nur Zeilenanzahl und Länge, niemals den Key)
python3 - <<'PY'
from pathlib import Path
k = Path("/home/pi/TankApp/data/apikey.txt").read_text().strip().splitlines()
print("Zeilen:", len(k), "| Länge von Zeile 1:", len(k[0]) if k else 0)
PY

# 3) Läuft der Dienst noch mit der ALTEN Konfiguration? (Unit geändert → neu starten)
systemctl status tankapp-collector | head -3
sudo systemctl restart tankapp-collector

# 4) Direkter API-Test mit dem echten Key (rohe Antwort ansehen):
#    IDs aus Schritt 1, Key aus apikey.txt einsetzen.
curl -s "https://creativecommons.tankerkoenig.de/json/prices.php?ids=<uuid1>,<uuid2>&apikey=<KEY>"
#    -> {"ok":true,…}                alles gut, Problem lag an alter Konfiguration
#    -> {"ok":false,"message":"parameter error"}            ids oder apikey leer
#    -> {"ok":false,"message":"Key existiert nicht …"}      Key falsch/inaktiv
#    -> {"ok":false,"message":"… nicht im korrekten Format"} UUID kaputt

# 5) Proxy? urllib nutzt http_proxy/https_proxy — ein Filter-/Tunnel-Proxy
#    kann den Query-String verstümmeln.
env | grep -i proxy
sudo systemctl show tankapp-collector -p Environment
```

Häufigster Fall in der Praxis: Der Dienst lief noch mit der **alten** Unit/
dem **alten** Key (siehe 2.4: erst `systemctl restart`!) oder `apikey.txt`
war leer bzw. enthielt nur den Platzhalter aus dem Beispiel.

### 2.8 Sicherung & Wiederherstellung des Pi

Der Code liegt auf GitHub, aber **einige Dateien sind gitignored** und
existieren nur auf dem Pi. Sie müssen ins Pi-Backup (z. B.
`smart_backup.sh` aufs NAS) aufgenommen werden, sonst sind Collector
**und Uploader** nach einem Restore lahm:

| Was | Pfad | Inhalt |
|---|---|---|
| API-Key | `~/TankApp/data/apikey.txt` | privater Tankerkönig-Key (chmod 600) |
| Polling-Set | `~/TankApp/docs/analysis/stations/polling.json` | die 10 UUIDs + private Koordinaten |
| systemd-Unit | `/etc/systemd/system/tankapp-collector.service` | Custom-Unit (Environment) |
| systemd-Unit | `/etc/systemd/system/tankapp-uploader.service` | Uploader-Service (Phase C) |
| InfluxDB-Zugang | `/etc/tankapp/env` | Uploader-URL/Org/Bucket/**Token** (chmod 600) |
| tmpfs-Zeile | `/etc/fstab` (Zeile `/dev/shm/tankapp`) | RAM-Puffer-Mount |

**Bewusst NICHT sichern:** `/dev/shm/tankapp/*.jsonl` — das ist der 7-Tage-
Ringpuffer im RAM, er wird nach einem Neustart ohnehin neu aufgebaut. Die
Langzeit-Historie liegt in der InfluxDB auf dem NAS (der Uploader liefert
sie in Echtzeit nach).

Minimal-Snippet fürs Backup-Skript:

```bash
mkdir -p "$TARGET/tankapp"
cp ~/TankApp/data/apikey.txt "$TARGET/tankapp/apikey.txt"
cp ~/TankApp/docs/analysis/stations/polling.json "$TARGET/tankapp/polling.json"
cp /etc/systemd/system/tankapp-collector.service "$TARGET/tankapp/" 2>/dev/null
cp /etc/systemd/system/tankapp-uploader.service "$TARGET/tankapp/" 2>/dev/null
cp /etc/tankapp/env "$TARGET/tankapp/env" 2>/dev/null && chmod 600 "$TARGET/tankapp/env"
```

Beim Restore: Repo klonen (`git clone`/`git pull`), die Dateien
zurückkopieren, beide Units nach `/etc/systemd/system/` legen,
`/etc/tankapp/env` mit `chown pi:pi` + `chmod 600` anlegen, tmpfs-Zeile in
`/etc/fstab` ergänzen und `systemctl enable --now tankapp-collector`.
Den Uploader erst starten, wenn `upload_influx.py` im Repo liegt
(nach dem PR-Merge) UND `/etc/tankapp/env` existiert:
`systemctl enable --now tankapp-uploader`.
Der Key gehört `pi:pi` mit `chmod 600`. Für den RAM-Puffer ist die
`uid=pi,gid=pi`-Variante praktisch, dann entfällt das `chown` nach jedem
Boot:

```
tmpfs  /dev/shm/tankapp  tmpfs  defaults,noatime,size=32M,uid=pi,gid=pi  0  0
```

---

## 3. Technische Referenz — NAS + Uploader (InfluxDB)

Der Collector bleibt unverändert. Neuer Baustein: der **Uploader** läuft als
zweite systemd-Service **auf demselben Pi** (Konzept §9.1). Er liest dieselben
JSONL-Zeilen aus dem Ringpuffer, schiebt die noch nicht bestätigten Zeilen an
die InfluxDB auf dem NAS und schiebt das Ack
(`<puffer>/meta/synced_until`) **erst nach erfolgreichem Write** weiter.
NAS-Ausfall wird so bis zur 7-Tage-Ringpuffertiefe überbrückt (Überlauf FIFO
+ Alarm ab 6 Tagen); neu gesendete Zeilen sind harmlos, weil InfluxDB-Punkte
ihre Identität (Measurement+Tags+Timestamp) mitbringen (idempotent, §1.2).

### 3.1 InfluxDB auf dem NAS (einmalig)

**InfluxDB läuft bereits** auf dem NAS (192.168.178.61, Org `gtwrlab`,
u. a. mit dem `smarthome`-Bucket). Deshalb: **keine zweite Instanz**
aufsetzen, TankApp bekommt nur ein **eigenes Bucket** + **eigenes
Least-Privilege-Token** in der bestehenden Instanz — das `smarthome`-Bucket
bleibt unberührt (der Uploader schreibt mit Precision `ns` nur ins eigene
Bucket; die bestehende Writer-Konfiguration ändert sich nicht).

```bash
# Auf dem NAS. Zuerst den Container-Namen herausfinden:
docker ps | grep -i influx
# (hier: Influxdb — Groß-/Kleinschreibung zählt!)

# WICHTIG: Die CLI IM Container hat kein Token gespeichert — ohne das
# Admin-Token der bestehenden InfluxDB kommt "401 Unauthorized" (bei
# "failed to lookup org …"). Admin-Token heraussuchen: .env der
# bestehenden Instanz (INFLUXDB_ADMIN_TOKEN bzw.
# DOCKER_INFLUXDB_INIT_ADMIN_TOKEN) oder Web-UI (http://192.168.178.61:8086
# → Security → API-Tokens). Einmalig speichern:
docker exec Influxdb influx config set-token <ADMIN-TOKEN>

# Bucket + Token für TankApp:
docker exec Influxdb influx bucket create \
    --org gtwrlab --name tankapp --retention 43800h     # ≈ 5 Jahre
docker exec Influxdb influx auth create \
    --org gtwrlab --read-bucket tankapp --write-bucket tankapp \
    --description "tankapp-uploader (Pi)"

# Check:
docker exec Influxdb influx bucket list --org gtwrlab
docker exec Influxdb influx auth list --org gtwrlab
# → das ausgegebene NEUE Token gehört auf den Pi nach /etc/tankapp/env
#   (§3.2), nie ins Repo.
```

> Wer das Admin-Token nicht in der CLI speichern will: jedem Befehl
> `--token <ADMIN-TOKEN>` anhängen. Admin-Token vergessen? Mit dem
> Admin-USER (Passwort) in der Web-UI anmelden und dort ein neues Token
> anlegen — die bestehenden Daten bleiben dabei unberührt.

**Alternativ komplett per Web-UI (ohne CLI):**

1. http://192.168.178.61:8086 — mit dem Admin-User (Passwort) anmelden.
2. **Load Data → Buckets → Create Bucket** (ältere UI: „Data“):
   Name `tankapp`, Organisation `gtwrlab`, Retention `43800h` (≈ 5 Jahre).
3. **Security → API Tokens → Create Token** (ältere UI: „Users & Tokens“):
   Name `tankapp-uploader (Pi)`, Typ **Custom**, Ablauf **Never Expires**,
   Organisation `gtwrlab`; Berechtigung hinzufügen: Bucket `tankapp` →
   **Read buckets** + **Write points** → Generate Token.
4. **Token sofort kopieren** (nur einmalig angezeigt!) → gehört in
   `/etc/tankapp/env` auf dem Pi (§3.2).

> `docker compose exec <service> influx …` (oder `docker-compose exec …` bei
> Compose v1) ginge auch, aber nur, wenn Compose installiert ist — auf
> Synology-NAS oft nicht. Plain `docker exec` funktioniert immer.

> Die InfluxDB-Web-UI (http://192.168.178.61:8086) dient nur der Diagnose —
> der Pi nutzt sie nie, er schreibt ausschließlich mit dem Uploader-Token.
> Port 8086 nur im lokalen Netz, nie ins Internet weiterleiten.

**Falls auf dem NAS noch gar keine InfluxDB läuft:** eigene Instanz
per Docker (legt dieselben Namen `gtwrlab`/`tankapp` an, 43800 h ≈ 5 Jahre
Retention, Healthcheck):

```bash
git clone https://github.com/kollb/TankApp.git ~/TankApp
cd ~/TankApp/ops/nas/influxdb
cp .env.example .env && nano .env        # Token: openssl rand -hex 16
docker compose up -d
docker compose exec influxdb influx ping
```

(Ist der Befehl `docker compose` auf dem NAS nicht vorhanden — Synology —:
`docker-compose` (v1) verwenden oder das Compose-Plugin installieren.)

### 3.2 Secrets auf dem Pi (einmalig)

```bash
sudo install -d -m 0750 -o pi -g pi /etc/tankapp
sudo tee /etc/tankapp/env > /dev/null <<'ENV'
TANKAPP_INFLUX_URL=http://192.168.178.61:8086
TANKAPP_INFLUX_ORG=gtwrlab
TANKAPP_INFLUX_BUCKET=tankapp
TANKAPP_INFLUX_TOKEN=<Token aus 3.1>
TANKAPP_POLL_DIR=/dev/shm/tankapp
ENV
sudo chmod 600 /etc/tankapp/env
```

### 3.3 Uploader testen (Pi)

```bash
cd ~/TankApp
set -a; . /etc/tankapp/env; set +a      # Env laden — wichtig, sonst laufen die
                                        # Tests gegen das leere data/poll statt
                                        # gegen /dev/shm/tankapp (TANKAPP_POLL_DIR)
python3 data-tools/upload_influx.py --dry-run   # Line Protocol zeigen, nichts senden
python3 data-tools/upload_influx.py --once      # ein voller Zyklus: Ping + Upload + Ack
```

Erwartet: `Ping …: ok (HTTP 204)` und `⇡ N Zeile(n) (M Punkte) → InfluxDB
(synced until …)`. Zweites `--once`: `0 unsynced Zeilen` bzw. kein zweiter
POST. Fehlerpfade (Exit-Code 1, **Ack bleibt stehen, nichts geht verloren**):

| Log-Meldung | Bedeutung / Aktion |
|---|---|
| `NAS nicht erreichbar …` | NAS aus oder falsche `TANKAPP_INFLUX_URL` — Uploader wartet (Backoff 60 s → 15 min), der Puffer läuft weiter |
| `HTTP 401 — Token fehlt/falsch` | In der InfluxDB-UI Token-Status/Rechte prüfen; keine Token-Listen oder Schlüsselwerte posten |
| `HTTP 403 — keine Schreibberechtigung` | Token neu anlegen mit `--write-bucket tankapp` (3.1) |
| `HTTP 404 — Org/Bucket existiert nicht` | `TANKAPP_INFLUX_ORG`/`_BUCKET` gegen NAS prüfen (`influx org list`, `influx bucket list`) |
| `HTTP 400 — Line Protocol abgelehnt` | Fehlertext im Log — sollte nicht vorkommen, dann hier melden |
| `⚠ PUFFER ÜBERFÜLLT …` | älteste unsynced Zeile ≥ 6 Tage — NAS-Ausfall zu lang, älteste Daten gehen FIFO verloren (Ringtiefe 7 Tage) |
| `⚠ Stationsnamen nicht verfügbar` | `polling.json` fehlt auf dem Pi (2.2) — station-Tag enthält dann die UUID statt des Namens |

### 3.4 systemd-Service (mit Watchdog)

```bash
sudo tee /etc/systemd/system/tankapp-uploader.service > /dev/null <<'UNIT'
[Unit]
Description=TankApp M1 InfluxDB-Uploader (JSONL-Ringpuffer → NAS)
After=network-online.target time-sync.target
Wants=network-online.target

[Service]
Type=notify
User=pi
WorkingDirectory=/home/pi/TankApp
EnvironmentFile=/etc/tankapp/env
ExecStart=/usr/bin/python3 /home/pi/TankApp/data-tools/upload_influx.py
Restart=always
RestartSec=10
WatchdogSec=30

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now tankapp-uploader
```

`Type=notify`: der Uploader meldet `READY=1` beim Start und `WATCHDOG=1`
alle 10 s (per sd_notify, reine Standardbibliothek); bei `WatchdogSec=30`
startet systemd den Dienst neu, wenn er hängt. Ein NAS-Ausfall ist **kein**
Fehlerzustand der Service — sie pingt weiter und schiebt nach, sobald der
NAS zurück ist. Nach jeder Änderung an `EnvironmentFile`/Unit:
`sudo systemctl restart tankapp-uploader`.

### 3.5 Betrieb & Kontrolle

```bash
systemctl status tankapp-uploader
journalctl -u tankapp-uploader -f       # Ping alle 60 s, Upload bei neuen Zeilen
cat /dev/shm/tankapp/meta/synced_until  # Ack-Stand (letzte übertragene Zeile)

# Datenvolumen auf dem NAS (erwartet: ~215–216 Status-Punkte je gepollter Station/Tag,
# Fenster 06–24 Uhr / 5 min). <name> = Container-Name (docker ps | grep -i influx):
docker exec <name> influx query \
  'from(bucket: "tankapp") |> range(start: -24h)
    |> filter(fn: (r) => r._measurement == "prices" and r._field == "status")
    |> filter(fn: (r) => exists r.station_id)
    |> group(columns: ["city", "station_id", "station"]) |> count()'
```

Der Zähler betrachtet nur UUID-getaggte Statuspunkte, nicht die alten
Namensserien. Bei Namenskollisionen zuerst [UUID-Tags/Nachlieferung](STATIONS-UUID.md)
herstellen; alte und neue Serien nicht doppelt als unterschiedliche Polls zählen.

**Lücken-Check (Abnahme, 14 Tage, Lücken < 2 %):** pro Station und Tag sind
~216 Polls zu erwarten (18 h / 5 min); über 14 Tage ~3 000 — Lücken < 2 %
bedeuten ≥ ~2 940 Punkte pro Station. Abweichungen im `journalctl`-Log des
Collectors suchen (429s, Fenster, Key).

### 3.6 Backup (NAS)

Der Ringpuffer auf dem Pi wird **bewusst nicht** gesichert (7-Tage-Fenster
im RAM; die Langzeit-Historie liegt ab jetzt in InfluxDB). Wöchentliches
Tar-Backup des InfluxDB-Volumes per cron auf dem NAS:

```cron
0 3 * * 0 cd $HOME/TankApp/ops/nas/influxdb && docker run --rm \
    -v tankapp_influxdb_data:/data -v $PWD/backup:/backup alpine \
    tar czf /backup/influxdb-$(date +\%F).tar.gz -C /data .
```

Restore: neues leeres Volume anlegen, dann

```bash
docker run --rm -v tankapp_influxdb_data:/data -v $PWD/backup:/backup alpine \
    tar xzf /backup/influxdb-<datum>.tar.gz -C /data
```

danach `docker compose up -d` (Org/Bucket/Token sind im Volume enthalten).

### 3.7 M1-Abnahme: 14 Tage Live-Betrieb

Konzept §13: M1 ist erfüllt, wenn **Collector + Ringpuffer + Uploader
14 Tage** durchgelaufen sind und

1. **Datenlücken < 2 %** (Lücken-Check in §3.5),
2. **Ack-Protokoll fehlerfrei**: keine verlorene Zeile, keine Duplikate —
   `meta/synced_until` ist stets ≥ dem Zeitstempel der zweit-neuesten
   Pufferzeile (nur die allerneuste darf noch offen sein), und die
   Punktezahl in InfluxDB stimmt mit der Anzahl der Stations-Snapshots im
   Puffer überein (eine JSONL-Pollzeile enthält bis zu zehn Stationen, nicht
   nur einen Influx-Punkt).

Beide Dienste 14 Tage unbeaufsichtigt laufen lassen; wöchentlich §3.5
durchgehen und das Backup (§3.6) prüfen.

---


</details>
