# TankApp einrichten — vom Polling zur GUI

**Das ist der einzige Installationseinstieg.** Stand: 09.09.2026.  
Andere Dokumente sind Nachschlagewerke, keine nacheinander auszuführenden Checklisten.  
**[Alle Dokumente im Überblick → README.md](README.md)** mit klickbarem Inhaltsverzeichnis.

## Inhaltsverzeichnis

- [Ziel und Rollen](#ziel-und-rollen)
- [Verbindliche Reihenfolge](#verbindliche-reihenfolge)
- [Schritt 1: Gütersloh mitpollen](#schritt-1-gütersloh-mitpollen)
  - [Auf dem Pi (empfohlen)](#auf-dem-pi-empfohlen)
  - [Alternative PC/NAS Vorbereitung](#alternative-pcnas-vorbereitung)
- [Schritt 2: NAS-App starten](#schritt-2-nas-app-starten)
  - [Private Dateien](#private-dateien)
  - [Preflight](#preflight)
  - [Start nas-up](#start-nas-up)
  - [Unraid Ablauf](#unraid-ablauf)
  - [Portwechsel](#portwechsel)
- [Was danach automatisch läuft](#was-danach-automatisch-läuft)
- [Was du in der GUI siehst](#was-du-in-der-gui-siehst)
- [B3 Neue Features](#b3-neue-features)
- [Nächste Schritte](#nächste-schritte)

## Ziel und Rollen

```text
Tankerkönig live ──→ Pi: Collector + RAM-Puffer (/dev/shm/tankapp) ──→ NAS: InfluxDB
Tankerkönig-Archiv ───────────────────────────────────────────────→ NAS: Roharchiv
                                                                  ↓
                                                         Modelle + Selektion
                                                                  ↓
                                                         NAS: API + Web-GUI (1355)
                                                                  ↓
                                                          Handy/PC: Browser
Pi → NAS: collector_status (Herzschlag) via InfluxDB
```

- **Pi:** 24/7 sammeln und hochladen, keine Jahresarchive oder Modelle fitten. Schreibt `meta/heartbeat.json` für Livestatus (B3.11).
- **NAS:** dauerhafter Daten- und App-Server. Archivabruf, Lückennachholung, InfluxDB, automatische Fits, Selektion (B3.10), Heatmaps (B3.9), Route-Evaluate (B3.12), API und GUI.
- **PC:** optional einrichten oder Rechenläufe beschleunigen. Für Alltag nur Browser. Keine verpflichtende venv, kein tägliches Kopieren.
- **Wenn NAS aus ist:** keine NAS-Jobs und keine dort gehostete GUI. Pi sammelt weiter; RAM-Puffer überbrückt bis zu 7 Tage, aber keinen Pi-Neustart. Archiv wird beim nächsten NAS-Lauf nachgeholt.

Details: [ARCHITEKTUR.md](ARCHITEKTUR.md) und [BETRIEB.md](BETRIEB.md)

## Verbindliche Reihenfolge

| Schritt | Ergebnis | Heute ausführbar? |
|---|---|---|
| **1. Gütersloh mitpollen** | Beide Städte sammeln Live-Daten, ohne Preis-Historienanalyse | Ja: Vorbereitung + Aktivierung unten |
| **2. NAS-App starten** | Echte Preise, Stadt/Kraftstoff wählen, Status und Datenalter sehen | Ja: `nas-up` unten, keine erfundene Warteempfehlung |
| **Parallel: NAS-Archiv** | Ein Jahr oder mehr Vorgeschichte, fehlende Tage nachholen | Im App-Dienst enthalten, blockiert Live-Preise nicht |
| **3. Automatische Berechnung** | Aufbereitung, Fits, Selektion, Prüfwerte, Veröffentlichung; letzte gute Ergebnisse bei Fehlern behalten | Im App-Dienst enthalten, zunächst unkalibriert |
| **4. Empfehlungen in derselben GUI** | Jetzt/warten/woanders mit Netto-Vorteil, Heatmaps, Meine Stationen, Collector-Status, Route-Evaluate | Nach Echt-Datenprüfung und Kalibrierung |

Für bestehende Installation: Pi-Collector, Uploader und InfluxDB nicht neu installieren. Zuerst aktuellen TankApp-Code auf Geräten bereitstellen. Gebündelte Befehle brauchen nur Python 3.11+ und Standardbibliothek, keine pip/venv. Auf NAS zusätzlich Docker mit Compose v2 (Unraid: zuerst Compose-Plugin). App-Image installiert Rechenpakete und baut GUI selbst. Aktivierung für Standard-systemd-Dienste vorgesehen; abweichende Startpfade oder festes `--poll-city` werden nicht heimlich geändert.

## Schritt 1: Gütersloh mitpollen

### Auf dem Pi (empfohlen)

Am einfachsten direkt auf dem Pi im TankApp-Ordner, damit keine Dateien kopiert werden:

```bash
python3 tankapp.py add-city
sudo python3 tankapp.py activate-polling
```

**Was du einmalig angibst:** tatsächlichen Gütersloher Anker als Breitengrad/Längengrad (Dezimalpunkt). Liegt er bereits in `analysis/config.local.json`, wird nicht erneut gefragt. Koordinaten bleiben lokal. Bei Gütersloh wird `NW` für Nordrhein-Westfalen ergänzt. Frankfurt bleibt unverändert.

**Was der erste Befehl erledigt:** vorhandene Stationsliste verwenden oder über bereits eingerichteten Archivzugang neueste laden; nahe Stationen 5km Radius wählen, nach Marke/Standort entzerren, alle bisherigen Stadtsets beibehalten und gemeinsamen Vorschlag schreiben. Kein Preis-Jahresdownload, keine M2/M3 Analyse nötig. Vorläufige Auswahl nach Nähe/Markenvielfalt, noch keine Aussage „billigste“. Stationsliste und spätere Live-Antworten müssen Verfügbarkeit/Kraftstoffe bestätigen.

Zweiter Befehl sichert alte Auswahl, übernimmt Vorschlag und startet Collector/Uploader neu. Bei fehlgeschlagenem Neustart wird vorige Auswahl zurückgespielt. Keine DB-Änderung, kein Ack-Reset. Geänderte/entfernte alte Stadtsets werden auf Additionspfad abgewiesen. Erfolgreicher Dienststart ist noch kein Nachweis erfolgreicher API-Antworten.

**Request-Budget:** ein gemeinsamer Collector, höchstens 10 UUIDs pro Request, Standard 1 Request alle 5 Min. Mit Frankfurt+Gütersloh wird jede Stadt etwa alle 10 Min. abgefragt. Erste echte Abfrage nach Start ohne gespeicherten Zeitplan wartet 5 Min. Zeitplan bleibt bei Neustarts erhalten solange Puffer besteht; 429/Fehler erlauben keinen sofortigen zusätzlichen Request. Nicht parallel mit selbem Key auf PC oder zweitem Puffer pollen.

Im Collector-/Uploader-Log bzw. InfluxDB prüfen, dass beide Stadtlabels ankommen. 90-Tage-Prüfung der Engine berücksichtigt mit `--polling` gemeinsame Kadenz; 10-min Abfragen sind nicht automatisch 50% Ausfall.

### Alternative PC/NAS Vorbereitung

Falls Vorbereitung lieber am PC oder mit NAS-Stationsliste:

Windows: `py -3 tankapp.py add-city`; keine venv. `--stations <Datei.csv.gz>` erlaubt vorhandene Stationsliste auf NAS-Freigabe. Alternativ `--archive-dir <Verzeichnis>` auf NAS-Archiv. Wenn kein Archivzugang auf Pi, ist das Weg ohne zusätzlichen Zugang auf Pi. Danach nur `data/setup/polling.json` auf Pi an selben relativen Ort übertragen und dort Aktivierungsbefehl ausführen. Für Preis-GUI genügen Stationsmetadaten im gemeinsamen Polling-Set; private Anker werden nicht an Browser übertragen.

Andere Stadt: `--city Name`; Radius/Anzahl nur bei Bedarf mit `--radius`/`--size`. Standard-Aktivierung erwartet `tankapp-collector` und `tankapp-uploader` als laufende systemd-Dienste. Bei Sonderkonfiguration sicher abbrechen statt Dienste/Dateipfade zu erraten. Vorschlag ist kein Deployment des Codes.

Details: [BETRIEB.md](BETRIEB.md) Abschnitt Pi.

## Schritt 2: NAS-App starten

### Private Dateien

Einmalig bereitstellen, auf NAS im aktuellen Checkout:

1. Aktives gemeinsame `docs/analysis/stations/polling.json` vom Pi nach Aktivierung — nicht alten Frankfurt-Stand. Bei späteren Änderungen erneut bereitstellen und `nas-up` wiederholen.
2. `data/influx.env` mit vorhandenem InfluxDB-Lesezugang. Format: `TANKAPP_INFLUX_URL`, `TANKAPP_INFLUX_ORG`, `TANKAPP_INFLUX_BUCKET`, `TANKAPP_INFLUX_TOKEN`. Möglichst eigenen Nur-Lese-Token für selben Bucket nutzen; Pi-Schreibzugang nicht ändern. URL muss aus Container erreichbar sein, z. B. NAS-LAN-Adresse mit Port 8086 — **nicht localhost**.
3. Vorhandenen Tankerkönig-Archivzugang privat als `data/_netrc` oder `~/.netrc` für ausführenden NAS-Benutzer. Das ist nicht Collector-API-Key. Keine Zugangsdaten in Git, Befehlszeilen oder Chat. Ohne Archivzugang kann Live-GUI trotzdem starten.

### Preflight

Vorab prüfen, was fehlt (liest keine Token):

```bash
bash ops/nas/preflight.sh
```

### Start nas-up

Dann auf NAS:

```bash
python3 tankapp.py nas-up
```

Danach Browser `http://<NAS-Adresse>:1355` öffnen. NAS braucht Docker mit Compose v2 und beim ersten Build Internet. Auf PC/Handy weder Node noch Python-Pakete. Bestehende InfluxDB, Collector und Uploader werden nicht neu installiert/verändert.

Andere Pfade beim ersten Aufruf:

```bash
python3 tankapp.py nas-up --archive-dir /srv/tankapp/archive --runtime-dir /srv/tankapp/runtime --polling /privater/pfad/polling.json --influx-env /privater/pfad/influx.env --netrc /privater/pfad/netrc
```

Das sind Beispielpfade, keine Pflichtverzeichnisse. Ohne Optionen liegen Archiv und Laufdaten dauerhaft unter `data/raw` und `data/runtime` im Checkout, nicht im flüchtigen Container. Ausführender Benutzer braucht Docker-Zugriff, Lesezugriff auf private Dateien und Schreibzugriff auf Archiv/Laufdaten. Neu angelegte Ausgabeordner bekommen bei sudo ursprünglichen Benutzer; vorhandene NAS-ACLs nicht rekursiv verändert. Private Dateien nur für diesen Benutzer lesbar halten.

**Start und spätere Updates bleiben derselbe Befehl:** `python3 tankapp.py nas-up`. Merkt sich Pfade/Optionen in privater `data/nas-settings.json`, baut aktuelles App-Image und startet neu. Code selbst vorher aktualisieren. Auch nach Austausch privater Konfigurationsdateien wiederholen, weil Dateien read-only eingebunden sind. Zugangsdaten kommen nicht ins Image.

**Nur Heimnetz/VPN:** App hat bewusst noch keine Benutzeranmeldung. Keine ungeschützte Portfreigabe ins Internet. Für TLS vorhandenen privaten NAS-Reverse-Proxy verwenden; API bleibt unter selber Browser-Adresse.

### Unraid Ablauf

Ein Unraid-NAS wie jedes Docker-NAS, Pi-Teil (systemd) unberührt. Zusätzlich:

1. Compose-Plugin installieren: Unraid bringt Docker, aber Compose v2 nicht im Standard — einmalig Plugin aus Community Apps (z. B. „Compose Manager Plus“).
2. Repo nach `/mnt/user/appdata/tankapp` klonen (SSD-Share):

```bash
git clone https://github.com/kollb/TankApp.git /mnt/user/appdata/tankapp
```

Grundsatz: große Dateien HDD, kleine/häufige SSD — HDD (Sleep) soll selten geweckt werden:

| Pfad | Pool | Inhalt |
|---|---|---|
| `/mnt/user/appdata/tankapp` | SSD | Code + private Konfiguration + Runtime (`data/runtime`: Jobs, Modelle, Selektion, Archiv-Sync) |
| `/mnt/user/data/tankapp` | HDD | nur Roharchiv (nationale Tagesdateien, ein Jahr mehrere GB) |

Archivverzeichnis legt `nas-up` an und übergibt an Container-User (99:100). Selbst vorangelegte Verzeichnisse müssen `chown -R 99:100` gehören.

3. Private Dateien wie oben bereitstellen unter `/mnt/user/appdata/tankapp/` und lesbar machen:

```bash
chown 99:100 data/influx.env data/_netrc && chmod 600 data/influx.env data/_netrc
cd /mnt/user/appdata/tankapp
python3 tankapp.py nas-up --uid 99 --gid 100 --archive-dir /mnt/user/data/tankapp
```

Nur `--archive-dir`, kein `--runtime-dir`: Runtime bleibt auf SSD, HDD nur Roharchiv.

4. Browser: `http://<NAS-Adresse>:1355`

Warum `--uid 99 --gid 100`: Unraid-Shares stehen unter `nobody:users` (99:100), Container auf Unraid laufen üblicherweise mit diesem User. Ohne Flags erbt Container ausführenden Benutzer (oft root) — funktioniert, erzeugt aber root-eigene Dateien, die Unraids Rechte-Tools zurücksetzen.

Weitere Hinweise in [BETRIEB.md](BETRIEB.md) Unraid Abschnitt.

### Portwechsel

`nas-up` merkt sich Port in `data/nas-settings.json`. Wer alten Port 8080 hatte: einmal `python3 tankapp.py nas-up --port 1355` oder Eintrag ändern.

## Was danach automatisch läuft

| Aufgabe | Zeitplanung und Verhalten |
|---|---|
| GUI + Nur-Lese-API | Gemeinsamer Dienst, Preise alle 30s neu lesen, Anzeige ≤30 Min alter offener Preise, keine zusätzlichen Tankerkönig-Requests |
| Archiv | Bei App-/NAS-Start, danach stündlich, Preis-/Stationsdateien bis gestern, fehlende Tage nachholen, vollständig → überspringen ohne Archiv anzufassen (State in Runtime, HDD bleibt Sleep) |
| Modelle | Bei Start, danach täglich nach erfolgreichem Lauf, bei Fehler stündlich erneut, unabhängig vom Archiv; optionaler Uploader-Webhook (Issue 50, Setup in [BETRIEB.md](BETRIEB.md)) weckt den Lauf nach sicherem InfluxDB-Write — Debounce + Idempotenz entscheidet der Scheduler, ohne Webhook bleibt alles intervallbasiert |
| Selektion | Bei Start, danach täglich, nach Modell best-effort, publiziert nach `runtime/selection/current.json` (B3.10) |
| Veröffentlichung | Erst nach fertiger Berechnung atomar ersetzen, teilweise erneuerte Stationen kennzeichnen alte Ergebnisse, ohne erfolgreichen Fit bleibt letzter brauchbarer Stand |
| Neustart | Docker `restart: unless-stopped`, startet mit Docker, holt nach |

Keinen zusätzlichen cron einrichten. Gebündelter App-Dienst übernimmt Zeitplanung. Bereits eingerichtete history-sync/Modell cron deaktivieren, nicht zusätzlich laufen lassen. history-sync bleibt als Einzelwerkzeug für Installationen ohne App-Dienst.

Archivumfang Standard 365 Tage, für 730 beim `nas-up` Aufruf `--history-days 730` ergänzen. Ein Jahr keine Obergrenze/Löschfrist: gespeicherter Beginn wird nicht nach vorn verschoben, ältere Rohdateien bleiben erhalten. Genug NAS-Speicher einplanen — nationales Tagesarchiv, nicht nur kleines Stationsset. Modelle verwenden kleineren abgeleiteten Ausschnitt.

Modellumfang zunächst e10, bei Bedarf `--model-fuels e10,e5,diesel` ergänzen. Live-GUI unterstützt alle drei Kraftstoffe unabhängig. Kette liest InfluxDB, verarbeitet rohe Archiv-Änderungsereignisse mit exakten Zeitstempeln, erzeugt gemeinsamen Trainingsbestand, fittet/publiziert 24h Ausblick und 7-Tage retrospektiven Backtest. Kein zeitgetreuer Betriebs-Replay und kein Kalibrierungsnachweis.

Archiv und Polling sind dieselben Tankerkönig-Marktdaten über zwei Bezugswege. Historie kann Modellstart tragen, keine 3-monatige Wartepflicht. Standardtraining letzte 42 Tage, Archiv nur vor Beginn Live-Beobachtungen; repariert danach keine Live-Lücken oder Schließungen. Nach 90 vollständigen Live-Tagen mit ausreichender Polling-Abdeckung kann je Station/Kraftstoff auf Polling-only umgestellt werden. Statistik zeigt Fortschritt und verwendete Regel. NAS-Roharchiv und Sync bleiben bestehen.

## Was du in der GUI siehst

- **Alltag:** Stadt/Kraftstoff, günstigster aktuell gemeldeter offener Preis, Datenalter, Tankmenge, reiner Preisvergleich und Route bei gültigen Koordinaten. Stadt, Kraftstoff, Tankmenge merkt sich Browser. Keine Tankbuchung, keine als netto ausgegebene Umweg-Ersparnis. Neu B3.12: Button „Server prüfen“ für serverseitige Umweg-Ökonomie.
- **Statistik:** tatsächlicher Preisverlauf mit Lücken, Modell-Ausblick und Backtestwerte samt Datenbasis. Fehlende/alte Modelle sichtbar markiert. Neu B3.9: Heatmaps DoW×Stunde Niveau + Cheap-Probability. Neu B3.10: Meine Stationen mit δ̂ Ranking, Bootstrap-KI, AV-Score, billigste Stunde.
- **System:** Konfiguration, Archiv-Lücken, Job-Ergebnisse und letzte Veröffentlichung. Fehlende Zugangsdaten ergeben ehrlichen Einrichtungszustand, keine Demo-Preise. Neu B3.11: Pi/tmpfs Livestatus (Collector-Herzschlag ans NAS) mit tmpfs-Nutzung, ältester Datei, Poll Count. Neu Issue 50: bei Modell-/Selektions-Jobs Datenstand des letzten Webhook-Triggerlaufs und Trigger-Statistik (Debounce/Idempotenz) sichtbar.

Einmalige Echt-Daten-Abnahme: Nach Start im Alltag beide Städte und gewünschten Kraftstoff prüfen: plausible Stationen, aktuelle Zeitstempel, echte Preise. Unter System müssen Lesezugang und nach erstem Abruf Archiv-/Job-Stände passen. Laufender Container allein bestätigt das nicht. NAS-Auszeiten und Pi-Puffergrenze stehen bei Rollen oben.

Stand dieser Lieferung: GUI, API, App-Start, Archiv-Zeitplanung, Modellveröffentlichung, Selektion, Heatmaps, Collector-Status, Route-Evaluate sind implementiert und softwaregetestet. GitHub CI hat Python-Tests, Frontend-Unit-Tests, Browsertests, GUI-Build, Docker-Image-Build bestanden. Betrieb mit privaten Daten auf NAS noch nicht abgenommen. Zweitmodell/Ensemble, weitere Modellbausteine, echte Güteprüfung und Out-of-sample-Kalibrierung bleiben offen; deshalb weiterhin `calibrated=false` / `decision_ready=false`. Noch kein belastbares „bis 18 Uhr warten“, keine erfundenen Wahrscheinlichkeiten oder garantierten Ersparnisse.

Details Betrieb: [BETRIEB.md](BETRIEB.md)  
API Details: [API.md](API.md)  
Analyse: [ANALYSE.md](ANALYSE.md)

## B3 Neue Features

- **B3.9 Heatmaps DoW×Stunde:** `GET /api/v1/heatmap?city=...&fuel=...&kind=level|probability&weeks=6&station_id=...` — Niveau Median + Cheap-Probability P(p ≤ Stadtmedian), Berlin Zeit, echte InfluxDB Punkte letzte N Wochen. GUI Tab Werkstatt → Heatmaps.
- **B3.10 Meine Stationen mit δ̂:** `GET /api/v1/selection?fuel=...&city=...` — Ranking, Bootstrap-KI, AV-Score, billigste Stunde, Volatilität, Coverage, Signifikanz q<0.05. Artefakt `runtime/selection/current.json`, Job `selection` täglich. GUI Tab Werkstatt → Meine Stationen, System → Artefakte.
- **B3.11 Pi/tmpfs Livestatus:** Collector schreibt `meta/heartbeat.json` (tmpfs Nutzung, älteste Datei, poll_count), Uploader schreibt `collector_status` Measurement nach InfluxDB alle 60s. `GET /api/v1/collector/status` und `/api/v1/health` (Feld collector). GUI Tab System → Pi/tmpfs Livestatus.
- **B3.12 Route Evaluate serverseitig:** `GET /api/v1/route/evaluate?city=...&fuel=...&station_id=...&ref_station_id=...&liters=40&detour_km=3&consumption=7&speed=45&value_of_time=12&when=...&mode=onroute` — K = d·(c/100)·p + (d/v)·z, brutto/netto, kritisch Δp*, worth_it, z_used peak/offpeak Auto. UI rechnet lokal, kann optional Server validieren (Button „Server prüfen“).

## Nächste Schritte

1. Gütersloh mitpollen (dieses Dokument oben)
2. NAS-App starten (dieses Dokument oben)
3. RP2 Fallback einrichten (optional, 24/7): [RP2.md](RP2.md)
4. Nach einigen Tagen: Heatmaps und Meine Stationen in Werkstatt prüfen
5. Collector-Status im System-Tab prüfen
6. Route-Evaluate im Alltag testen (lokal + Server)

Technische Referenz (systemd, Backup, Fehlersuche, InfluxDB, Unraid Details) ist bewusst aus diesem Dokument herausgezogen → [BETRIEB.md](BETRIEB.md) — dort mit eigenem Inhaltsverzeichnis.
