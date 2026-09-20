# RP2 Fallback-GUI + NAS-Proxy

> Stand: 20.09.2026 · App-Version 0.61.0 · RP2-Fallback v5.0 — **die** Anleitung
> für den 24/7-Zugang über den Pi/RP2. Die alten Einzeldateien
> (`rp2/README.md`, `rp2/ANLEITUNG.md`, `rp2/AENDERUNGEN.md`, Mockup-Vergleich)
> liegen im [Archiv](../archiv/README.md); neben dem RP2-Code liegt bewusst keine
> eigene Doku mehr.

## Inhaltsverzeichnis

- [Ziel](#ziel)
- [Übersicht](#übersicht)
  - [Dateien im `rp2/`-Ordner](#dateien-im-rp2-ordner)
- [Voraussetzungen](#voraussetzungen)
  - [NAS](#nas)
  - [RP2](#rp2)
- [Schritt 1: NAS aktualisieren](#schritt-1-nas-aktualisieren)
- [Schritt 2: Code auf RP2 holen](#schritt-2-code-auf-rp2-holen)
- [Schritt 3: NAS-IP konfigurieren](#schritt-3-nas-ip-konfigurieren)
- [Schritt 4: Abhängigkeiten](#schritt-4-abhängigkeiten)
- [Schritt 5: Services einrichten](#schritt-5-services-einrichten)
  - [NAS-IP als Drop-in](#nas-ip-als-drop-in)
  - [Starten](#starten)
  - [Benutzer prüfen](#benutzer-prüfen)
  - [Status prüfen](#status-prüfen)
  - [Journal-Größe begrenzen (SD-Karte schonen)](#journal-größe-begrenzen-sd-karte-schonen)
- [Testen](#testen)
  - [Cache prüfen](#cache-prüfen)
  - [Browser (immer dieselbe Adresse)](#browser-immer-dieselbe-adresse)
  - [NAS offline testen](#nas-offline-testen)
  - [NAS wieder online](#nas-wieder-online)
  - [Fallback-API und Umschaltzeiten](#fallback-api-und-umschaltzeiten)
- [Funktionen](#funktionen)
- [Konfiguration](#konfiguration)
- [Fehlersuche](#fehlersuche)
  - [Cache funktioniert nicht](#cache-funktioniert-nicht)
  - [GUI zeigt keine Stationen](#gui-zeigt-keine-stationen)
  - [UUIDs statt Namen](#uuids-statt-namen)
  - [Fallback statt NAS, obwohl NAS online](#fallback-statt-nas-obwohl-nas-online)
  - [Port 8000 belegt](#port-8000-belegt)
- [Template-Updates](#template-updates)
- [Wartung: Logs, Journal, SD-Karte](#wartung-logs-journal-sd-karte)
- [Prognose-Qualität](#prognose-qualität)
- [Nutzung](#nutzung)
  - [Alltag](#alltag)
  - [B3 Features im Alltag](#b3-features-im-alltag)
- [Updates & Changelog](#updates--changelog)
  - [Changelog](#release-nachweise)

## Ziel

Zugang über **eine Adresse** (keine Verfügbarkeitsgarantie) — den RP2 (Port 8000). NAS bereit → RP2 leitet neue Seitenaufrufe zur vollen NAS-GUI weiter — **inklusive der Schreibaktionen** (`POST`/`PUT`/`DELETE`/`PATCH`: Beleg buchen, Intent melden, Profil anlegen/ändern/löschen); Body und `Content-Type` werden durchgereicht. NAS nicht bereit → ein neuer Seitenaufruf zeigt Fallback-GUI (Live-Preise + gecachte Prognosen); dort gibt es keine Schreibendpunkte, eine Schreibaktion antwortet mit einer ehrlichen 503-JSON („NAS nicht bereit — …“), nicht mit einer 501-Fehlerseite.

```text
Browser ──► http://<RP2-IP>:8000
                 │
                 ├─ NAS online  ──► transparenter Proxy: volle NAS-GUI + Live-API
                 │                   (inkl. /api/v1/heatmap, selection, collector/status, route/evaluate)
                 └─ NAS offline ──► Fallback-GUI:
                     • Live-Preise aus /dev/shm/tankapp (echte Datenalter)
                     • Stationennamen/Marken/Koordinaten aus polling.json
                     • beschreibende Prognose-Quantile (keine Aktionen) aus /tmp/tankapp_cache
                     • Heartbeat aus meta/heartbeat.json (Collector-Livestatus)
```

> Alternativvorschlag aus dem [Gutachten](../archiv/GUTACHTEN-2026-09-10.md) (10.09.2026), ein
> PyQt6-Desktop-Widget als Fallback zu betreiben, wurde geprüft und **nicht
> übernommen**: Der browserbasierte Fallback braucht auf dem RP2 keine
> GUI-Runtime und bleibt Konzept (Bewertung: Gutachten-Nachtrag).

## Übersicht

| Komponente | Gerät | Aufgabe |
|---|---|---|
| Collector + Uploader | RP2 | Sammelt Live-Preise, uploadet zu NAS, schreibt heartbeat.json + collector_status |
| Prognose-Berechnung | NAS | Berechnet Prognosen täglich nach Mitternacht + Selektion |
| Vollwertige GUI | NAS (über RP2-Proxy) | Zeigt alles (wenn online) — erreichbar unter `<RP2-IP>:8000` und `<NAS-IP>:1355` |
| Fallback-GUI | RP2 | Zeigt Live-Preise + gecachte Prognosen (24/7), inkl. Dark Mode |
| Forecast Cache | RP2 | Lädt Prognosen vom NAS und cached sie |

Ergebnis:

- Preisvergleich aus dem lokalen Puffer; keine Garantie für frische Preise.
- Kein eigener Pi-Decision-Layer: F1/F3 und persönliche Stations-/Fensterwahl
  bleiben beim NAS. Der Pi zeigt Preisabstände, keine Nettoersparnis.
- Eine Adresse: neue Aufrufe wählen anhand der Readiness die Oberfläche;
  offene Tabs behalten ihren API-Vertrag (siehe unten).

### Dateien im `rp2/`-Ordner

```text
rp2/
├── fallback_gui.py                  # Webserver: NAS-Proxy + Fallback-GUI (Port 8000)
├── cache_forecasts.py               # lädt /api/v1/last_forecasts vom NAS (alle 5 min)
├── tankapp-fallback-gui.service     # systemd-Unit für die GUI
├── tankapp-forecast-cache.service   # systemd-Unit für den Cache
├── journald.conf.d/                 # Drop-in-Beispiel: Journal-Cap 50M (G2)
└── templates/index.html             # wird beim Start selbst erzeugt (gitignored)
```

Dokumentation liegt ausschließlich in `docs/` — diese Datei. Die alten
RP2-Anleitungen und die HTML-Mockups von 2026-09-08 sind im
[Archiv](../archiv/README.md#bestand-und-nachfolger).

## Voraussetzungen

### NAS

- Private Konfiguration vorhanden (`polling.json`, `data/influx.env`, für Prognosen `data/_netrc`) — Prüfung: `bash ops/nas/preflight.sh`
- TankApp bereits mit `python3 tankapp.py nas-up` gestartet (inkl. neuer Endpunkte heatmap/selection/collector/route)
- NAS läuft mindestens 6h/Tag
- Port 1355 erreichbar

### RP2

- Python 3.11+ (nur Standardbibliothek)
- RP2 läuft 24/7
- Collector + Uploader aktiv (`tankapp-collector`, `tankapp-uploader`)
- `/dev/shm/tankapp` als tmpfs gemountet
- `polling.json` unter `~/TankApp/data/analysis/stations/polling.json` — ohne fehlen Namen/Marken/Navigation (UUID wird angezeigt)
- Neu B3: `meta/heartbeat.json` wird automatisch vom Collector gepflegt

## Schritt 1: NAS aktualisieren

API-Endpunkte `/api/v1/last_forecasts`, `/api/v1/heatmap`, `/api/v1/selection`, `/api/v1/collector/status`, `/api/v1/route/evaluate` müssen auf NAS laufen.

#### Private Dateien bereitstellen

| Datei auf NAS | Pflicht? | Woher |
|---|---|---|
| `data/analysis/stations/polling.json` | ja | vom Pi (aktives Set nach activate-polling) |
| `data/influx.env` | ja | selbst anlegen: InfluxDB-Nur-Lese-Zugang |
| `data/_netrc` | für Prognosen | vorhandener Tankerkönig-Archivzugang |

`data/apikey.txt` gehört nicht aufs NAS — das ist Collector-Key des Pi.

#### Vorab prüfen

```bash
cd /mnt/user/appdata/tankapp
git pull
bash ops/nas/preflight.sh
```

#### Starten

```bash
python3 tankapp.py nas-up
# Unraid: python3 tankapp.py nas-up --uid 99 --gid 100 --archive-dir /mnt/user/data/tankapp
```

Prüfen:

```bash
curl -s http://localhost:1355/api/v1/last_forecasts | head -c 300
curl -s http://localhost:1355/api/v1/heatmap?city=Frankfurt&fuel=e10&kind=level&weeks=2 | head -c 300
curl -s http://localhost:1355/api/v1/selection?fuel=e10 | head -c 300
curl -s http://localhost:1355/api/v1/collector/status | head -c 300
curl -s "http://localhost:1355/api/v1/route/evaluate?city=Frankfurt&fuel=e10&detour_km=3&liters=40" | head -c 300
```

`count: 0` am Anfang normal — bis Archiv/Modelle durchgelaufen. Ohne `_netrc` bleibt count dauerhaft 0.

## Schritt 2: Code auf RP2 holen

```bash
git clone https://github.com/kollb/TankApp.git ~/TankApp   # nur beim ersten Mal
cd ~/TankApp && git pull
```

Alternativ per scp: `scp -r ~/TankApp/rp2 pi@<RP2-IP>:~/TankApp/`

## Schritt 3: NAS-IP konfigurieren

Kein `sed` in Quelldateien! IP als Umgebungsvariable, sonst überschreibt `git pull`.

Skripte lesen `NAS_IP` (optional `NAS_PORT`, Standard 1355).

Schnelltest:

```bash
NAS_IP=192.168.178.50 python3 ~/TankApp/rp2/cache_forecasts.py
```

Fehlt `NAS_IP`, beendet sich Skript sofort mit klarer Meldung.

## Schritt 4: Abhängigkeiten

Es sind keine zu installieren. Beide Skripte nutzen ausschließlich Python-Standardbibliothek (`http.server`, `urllib`). Kein flask, requests, pip.

```bash
python3 --version   # 3.11+ erwartet
```

## Schritt 5: Services einrichten

```bash
sudo cp ~/TankApp/rp2/tankapp-forecast-cache.service /etc/systemd/system/
sudo cp ~/TankApp/rp2/tankapp-fallback-gui.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### NAS-IP als Drop-in

Drop-in liegt außerhalb Git und überlebt Updates:

```bash
sudo systemctl edit tankapp-forecast-cache
# [Service]
# Environment=NAS_IP=192.168.178.50

sudo systemctl edit tankapp-fallback-gui
# [Service]
# Environment=NAS_IP=192.168.178.50
```

### Starten

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tankapp-forecast-cache
sudo systemctl enable --now tankapp-fallback-gui
```

### Benutzer prüfen

Service-Dateien nutzen `User=pi` und `/home/pi/TankApp/rp2`. Heißt Benutzer anders (z. B. `bkoll`):

```bash
whoami
sudo sed -i "s|User=pi|User=$(whoami)|; s|/home/pi/|$HOME/|g" \
  /etc/systemd/system/tankapp-forecast-cache.service \
  /etc/systemd/system/tankapp-fallback-gui.service
sudo systemctl daemon-reload
sudo systemctl restart tankapp-forecast-cache tankapp-fallback-gui
```

### Status prüfen

```bash
systemctl status tankapp-forecast-cache
systemctl status tankapp-fallback-gui
journalctl -u tankapp-forecast-cache -n 30
```

### Journal-Größe begrenzen (SD-Karte schonen)

Beide Dienste loggen nach journald. Ohne Begrenzung wächst das Journal auf der
SD-Karte mit — über Monate, unbemerkt, bis die Karte voll ist. Seit 0.11.0 ist
dafür ein Drop-in im Repo beigelegt (TODO G2).

journald kennt **kein Cap je Unit**; `SystemMaxUse` gilt für das Journal des
ganzen Systems. Auf einem RP2, der nur TankApp sammelt, ist genau das gemeint.
Installiert wird der Wert nach `/etc/systemd/` — außerhalb des Git-Ordners,
dahin bringt `git pull` also nichts und dort übersteht er auch Updates:

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
sudo cp ~/TankApp/rp2/journald.conf.d/50-tankapp-journal.conf \
  /etc/systemd/journald.conf.d/
sudo systemctl restart systemd-journald
journalctl --disk-usage          # sollte dauerhaft ≤ 50M bleiben
```

Wer nichts installieren will, räumt regelmäßig auf — z. B. als Wartungsauftrag
einmal im Monat (der RP2 hat keinen Cron-Dienst von TankApp):

```bash
sudo journalctl --vacuum-size=50M
```

Größenangaben schreibt journald ohne Leerzeichen (`50M`, nicht `50 M`) — mit
Leerzeichen wird der Wert stillschweigend ignoriert. Geprüft wird deshalb mit
`journalctl --disk-usage` und nicht an der Unit: ein Cap je Dienst existiert
nicht, `SystemMaxUse` ist eine Einstellung des Journals.

## Testen

### Cache prüfen

```bash
cat /tmp/tankapp_cache/last_forecasts.json | python3 -m json.tool | head -20
cat /dev/shm/tankapp/meta/heartbeat.json | python3 -m json.tool
```

### Browser (immer dieselbe Adresse)

```
http://<RP2-IP>:8000
```

- NAS bereit: vollständige NAS-GUI. Bei späterem Ausfall bleibt der Tab
  erhalten; nur Stationen/Preise haben einen kompatiblen lokalen Ersatz.
  Persönliche Eingaben bleiben im Tab, vorgemerkte Belege in IndexedDB.
- NAS nicht bereit: Fallback-GUI v5 („FALLBACK · RP2“), nur Preisvergleich,
  Tagesstreifen und Stationsliste. Ein veralteter ausgewählter Preis heißt
  „Preis-Momentaufnahme“, selbst wenn eine andere Station frisch meldet.
  Drei Fakten: „Jetzt hier“ · „Fensterentscheidung — nur auf dem NAS“ ·
  „Frische Preise“. Werkstatt: beschreibende Quantile mit Gültigkeitshinweis,
  Rohdaten und Pufferstatus. Keine Tank-/Warteaktion, kein bestes Fenster.
- Kraftstoff, Ort, Tankmenge (10–100 L), Sortierung und Darstellung bleiben
  lokale Präferenzen. Ein Pi-Tab pollt weiterhin seinen Pi-Vertrag und lädt
  bei NAS-Wiederkehr **nicht automatisch** neu. „NAS bereit — Ansicht öffnen“
  ist der ausdrückliche Wechsel; auch der noch fokussierte Tankmengenwert
  wird vorher gesichert. Bei Speicherfehler bleibt die Ansicht stehen.
- NAS und Pi müssen gemeinsam aktualisiert werden; die Modusbindung gilt
  für die Oberflächen ab 0.61.0 / RP2 v5, nicht rückwirkend für alte Tabs.

### NAS offline testen

```bash
# NAS temporär stoppen
docker stop tankapp
# → Fallback-GUI erscheint ab nächstem Request unter <RP2-IP>:8000
# Fallback erzwingen auch bei NAS online: http://<RP2-IP>:8000/?fallback=1
```

### NAS wieder online

```bash
docker start tankapp
# → zwei erfolgreiche Readiness-Prüfungen bestätigen die Rückkehr; danach ist der ausdrückliche Ansichtswechsel möglich
```

### Fallback-API und Umschaltzeiten

Im Fallback-Modus beantwortet der RP2 dieselben Pfade selbst (JSON, nur lesend):

| Pfad auf `<RP2-IP>:8000` | Inhalt |
|---|---|
| `/` | Fallback-GUI (HTML) bzw. proxyste NAS-GUI |
| `/?fallback=1` | Fallback erzwingen, auch bei erreichbarem NAS |
| `/api/v1/health` | Status: NAS, Preise, Prognosen, Metadaten, Collector |
| `/api/v1/stations?fuel=e10` | alle Stationen mit Preisen und echtem Datenalter |
| `/api/v1/forecasts?fuel=e10` | gecachte Prognosen + 24-h-Zusammenfassung |
| `/api/v1/decide?fuel=e10&liters=40` | Preisvergleich; `action=no_advice`, `decision_ready=false`, keine Fenster |
| `/api/v1/series?station=<uuid>&fuel=e10` | Tagesverlauf 06–24 Uhr einer Station aus dem Puffer (je Stunde die letzte offene Meldung, `null` ohne Meldung; dazu `min`/`max`/`now`) |
| `/api/v1/nas-check` | NAS sofort neu prüfen (auch im Proxy-Modus) |

**Versionierter Modus pro Tab (kein globales Modus-Cookie):**

- Pi-HTML sendet `X-TankApp-UI: pi-v1`: alle API-Antworten bleiben lokal,
  auch nach NAS-Rückkehr. `nas-check` bleibt immer ein Pi-Steuerendpunkt.
- NAS-HTML sendet bei Lese-Polls `X-TankApp-UI: nas-v1`: NAS-Antworten bleiben NAS-Schema.
  Bei Ausfall liefert nur `/stations` lokale Preise; alle anderen APIs
  antworten retryfähig mit 503 statt einem fremden Schema. Insbesondere
  `/series`, `/health`, `/decide` sind **nicht** schema-kompatibel.
- Ein unbekannter Lese-Vertrag erhält 409. Requests ohne Vertrag behalten die
  automatische Auswahl (CLI/Altclients). Antworten nennen
  `X-TankApp-Contract`, lokale Antworten sind `no-store`; `Vary` trennt
  `X-TankApp-UI` und `X-Force-Fallback`.
- NAS-Tabs wechseln bei Rückkehr ohne Reload zur NAS-API zurück. Schon beim
  ersten Abruffehler oder lokalen Stationsersatz bleiben alte Aktionen
  gesperrt. Der erkannte Wiederkontakt stößt den Outbox-Flush an, zusätzlich
  zu Mount, Browser-`online` und 30-s-Takt. Leases, Backoff und `Retry-After`
  werden nicht umgangen. Ungesendete Formularwerte werden nicht neu gemountet.
- `/?fallback=1`, `X-Force-Fallback: 1` und `FORCE_FALLBACK=1` erzwingen
  lokalen Betrieb. Schreibaktionen bleiben ausschließlich beim NAS; der Pi
  ist kein zweiter Ledger-Schreiber und wiederholt keine Proxy-Schreibanfrage.

**Readiness statt bloßer Erreichbarkeit:** `/health` muss HTTP 200 mit
parsebarem Objekt und `app=online` liefern; zusätzlich muss `/stations?fuel=e10`
HTTP 200 mit dem Stationsvertrag ohne `connection_error`/`error_code` liefern. Das ist technische Bereitschaft
für Preise, **keine** Modell-/M7-Freigabe und kein Beweis für jede persönliche
API. Ein Fehler einer tatsächlich benutzten Fach-API degradiert sofort.
Fehlendes Content-Length ist erlaubt (Chunked/Close-Framing); ungültige,
übergroße oder abgeschnittene Antworten werden verworfen. Pro Probe gilt
2 MiB, pro Proxy-Antwort 32 MiB; vollständige Prüfung vor Antwortbeginn.
Ein Abbruch beim Senden an den Browser führt nie zu einer zweiten Antwort.
401/403/429 samt Auth-/Retry-Headern werden nicht als Offline kaschiert.
Vollständig empfangene Schreibantworten bleiben auch bei 5xx erhalten:
`store_corrupted` darf nicht in einen anonymen Transportfehler verwandelt
werden, sonst verliert die Outbox aus Batch 1 ihren Ablehnungsgrund.

`health.failover` und `nas-check.failover` nennen Zustand und Nutzertext:

| Zustand | Bedeutung |
|---|---|
| `nas_ready` | Health und Stationsvertrag geprüft; NAS nutzbar |
| `nas_degraded` | Health erreichbar, Fach-API oder laufender Proxy fehlgeschlagen; lokale Preise bleiben |
| `pi_prices_only` | NAS nicht bereit und kein qualitäts-/zeitvalidierter Prognosecache; keine Aktionen |
| `pi_forecast_valid` | Mindestens eine Cache-Reihe ist für die Anzeige gültig; weiterhin keine Aktionen |
| `recovering` | Erstes positives Signal nach Ausfall; zweite Bestätigung steht aus |

`data_state` benennt unabhängig davon den lokalen Datenstand. Gültige
Prognoseanzeige verlangt Generation und Ursprung innerhalb der letzten 24 h,
keinen Zukunftsursprung, ggf. noch nicht abgelaufenes `valid_until`,
`calibrated=true`, `stale_data_at_origin=false`, grünen Rolling-PICP und
wohlgeordnete, endliche Quantile für die Zukunft. Fehlende Belege sind nicht
grün. Ein historischer Cache bleibt so beschriftet sichtbar, aber liefert
weder Wahrscheinlichkeiten noch Aktionsfreigaben. Frische und Qualität jeder
Station bleiben separat zu beachten; ein gültiger Eintrag gibt andere nicht frei.

**Zeitverhalten:** 15 s Online-TTL, 30 s Offline-TTL, 2 s je Health-/Fachprobe,
15 s Proxy-Timeout und 60 s Pi-UI-Poll sind Konfigurationswerte, **keine
garantierte Umschaltzeit**. Bei erstmaligem Start reicht eine vollständige
erfolgreiche Probe. Nach Ausfall braucht es zwei erfolgreiche Proben mit
mindestens 2 s Abstand; parallele Prüfungen teilen eine Probe. Ein neuerer
Proxyfehler schlägt ein älteres Probe-Ergebnis. Read-Timeouts sind keine
End-to-End-Frist; Browser, Datenmenge und Netz beeinflussen die Dauer.
`last_check` ist der tatsächliche Prüfzeitpunkt, nicht die Zeit des Lesens.

Softwaretests (auf dem PC/NAS, nicht auf dem RP2 nötig):

```bash
python3 -m pytest tests/test_rp2_fallback.py tests/test_rp2_cache.py -q
```

## Funktionen

| Funktion | NAS bereit (Proxy) | Pi-Fallback |
|---|---|---|
| Live-Preise | NAS-Bestand | Lokaler Puffer, echtes Alter je Station |
| Preisvergleich | mit NAS-Randbedingungen | Nur beobachtete Preisabstände, keine Fahrt-/Tankempfehlung |
| F1/F3 | Nur gemäß NAS-Qualitäts- und Profilgates | Keine Aktions- oder Fensterfreigabe |
| Prognosekurven | NAS-Publikation | Beschreibende Quantile; historischer/ungeprüfter Cache gekennzeichnet |
| Heatmaps, Selektion, Route Evaluate | NAS-API | Keine entsprechenden lokalen Endpunkte |
| Collector-Livestatus | `/api/v1/collector/status` | Nur Preis-/Cache-/Metadatenstatus im lokalen Health |

Zwei Randquantile und ein Median bestimmen keine Verteilung der
Fensterminima und keine allgemeine CDF-Fehlerschranke. Der Pi schätzt daher
weder „Preis-Score“ noch erwartete Nettoersparnis. Insbesondere liefert die
symmetrische Spanne 1,60–1,80 €/L bei aktuell 1,70 €/L **keine** gesicherte
Ersparnis von 1 € für 40 L. Die NAS-Medianersparnis ist separat im
[API-Vertrag](../referenz/API.md#decide-b4-primär) beschrieben.

Der **Tagesstreifen** kommt aus dem Collector-Puffer selbst: je Stunde die
letzte **offene** Meldung für den gewählten Kraftstoff, Ortszeit. Stunden ohne
Meldung bleiben leer („Leere Stunden hatten keine offene Meldung — nichts wird
erfunden“). Die Zelle „24“ ist die Mitternachtsstunde (00:00–00:59 des
Folgetags); der Collector pollt bis 24 Uhr, sie ist im Normalbetrieb leer.
Grün/rot markieren unteres bzw. oberes Preisdrittel des Tages an dieser
Station — keine Aussage über morgen.

## Konfiguration

| Variable | Default | Bedeutung |
|---|---|---|
| `NAS_IP` | – | NAS-Adresse; ohne Wert immer Fallback |
| `NAS_PORT` | `1355` | NAS-Port |
| `NAS_HEALTH_URL` | – | komplette Health-URL (überschreibt IP/Port) |
| `FALLBACK_GUI_PORT` | `8000` | Port RP2-GUI |
| `POLL_DIR` | `/dev/shm/tankapp` | Collector-Ringpuffer |
| `CACHE_DIR` | `/tmp/tankapp_cache` | Prognose-Cache — bewusst flüchtig, wird **nicht** auf die SD-Karte gespiegelt (G4) |
| `STATION_META` | – | Pfad zu polling.json (sonst Standardorte) |
| `FORCE_FALLBACK` | – | `1` = Proxy deaktiviert, immer Fallback |

polling.json Suche (erste Treffer):

1. `STATION_META` Env
2. `~/TankApp/data/analysis/stations/polling.json`
3. `<Repo>/data/analysis/stations/polling.json`

Ohne polling.json fehlen Namen/Marken/Navigation — UUID wird angezeigt. Datei liegt beim Collector bereits auf Pi.

## Fehlersuche

### Cache funktioniert nicht

```bash
cat /tmp/tankapp_cache/cache.log
systemctl show tankapp-forecast-cache -p Environment   # kommt NAS_IP wirklich an?
NAS_IP=192.168.178.50 python3 ~/TankApp/rp2/cache_forecasts.py   # manuell, im Vordergrund
```

Mögliche Ursachen: `NAS_IP` fehlt oder ist falsch (Drop-in nicht geladen,
`daemon-reload` vergessen), NAS liefert `count: 0` (noch keine Prognosen — meist
fehlt `data/_netrc`, Gegenprobe `bash ops/nas/preflight.sh`), NAS nicht
erreichbar (Firewall), Port falsch.

### GUI zeigt keine Stationen

```bash
ls -la /dev/shm/tankapp/
tail -n 1 /dev/shm/tankapp/$(date +%F).jsonl | python3 -m json.tool
cat /dev/shm/tankapp/meta/heartbeat.json
```

Ursachen: Collector läuft nicht, Polling-Set leer, nachts (00–06) pollt Collector nicht — letzte Zeile von gestern wird angezeigt.

### UUIDs statt Namen

```bash
ls -la ~/TankApp/data/analysis/stations/polling.json
```

Ursache: polling.json fehlt/korrupt. JSONL enthält nur UUID+Preis, Namen/Marken/Koordinaten liefert polling.json. Neu kopieren, dann `sudo systemctl restart tankapp-fallback-gui`.

### Fallback statt NAS, obwohl NAS online

```bash
curl -s http://<RP2-IP>:8000/api/v1/nas-check
curl -s http://<NAS-IP>:1355/api/v1/health
```

Ursachen: NAS_IP falsch/leer, erzwungener oder tabgebundener Pi-Modus, ungültiger Health-Body, Fach-API nicht bereit oder Rückkehr noch nicht bestätigt. `nas-check` nennt den Zustand; ein bereites NAS wechselt einen Pi-Tab erst auf ausdrücklichen Klick.

### Port 8000 belegt

```bash
ss -tulnp | grep 8000
# Port ändern per Drop-in:
# sudo systemctl edit tankapp-fallback-gui
# [Service]
# Environment=FALLBACK_GUI_PORT=8080
```

## Template-Updates

Die Fallback-GUI erzeugt ihre HTML-Vorlage beim Start selbst
(`rp2/templates/index.html`, gitignored) und versieht sie mit einem
Inhalts-Hash-Marker:

```html
<!-- tankapp-fallback-gui v2.x sha:… -->
```

Ändert sich das Template im Repo, wird die alte Datei beim nächsten Service-Start
nach `index.html.old` gesichert und die neue installiert. **Lokale Anpassungen
unterhalb des Markers überleben**, solange sie den aktuellen Marker tragen.
Update-Workflow:

```bash
cd ~/TankApp && git pull
sudo systemctl restart tankapp-fallback-gui
grep -o "tankapp-fallback-gui [^>]*" rp2/templates/index.html   # Marker = neuer Stand?
```

## Wartung: Logs, Journal, SD-Karte

Der RP2 läuft auf einer SD-Karte; Schreibzugriffe sind deshalb begrenzt.

| Quelle | Verhalten | Wartung |
|---|---|---|
| `/tmp/tankapp_cache/cache.log` | Ring-Cap **1 MB** (`CACHE_LOG_MAX_BYTES`): wird die Grenze überschritten, bleibt nur die jüngere Hälfte plus Markierungszeile | keine — wächst nicht mehr unbegrenzt (Fix G1, Version 0.10.0) |
| `/tmp/tankapp_cache/last_forecasts.json` | atomar überschrieben, feste Größe | keine |
| `/dev/shm/tankapp/*.jsonl` | Ringpuffer im RAM, `RING_DAYS=7` | keine SD-Schreiblast; Inhalt liegt zusätzlich in InfluxDB |
| journald (`tankapp-fallback-gui`, `tankapp-forecast-cache`) | `SystemMaxUse=50M` + `SystemMaxFileSize=10M` durch das Drop-in [rp2/journald.conf.d/50-tankapp-journal.conf](../../rp2/journald.conf.d/50-tankapp-journal.conf) | Einmal installieren (siehe [Journal-Größe begrenzen](#journal-größe-begrenzen-sd-karte-schonen)); Zwischendurch `journalctl --vacuum-size=50M` (Fix G2, Version 0.11.0) |
| `/tmp/tankapp_cache` nach Reboot | `/tmp` ist flüchtig → bis zum ersten erfolgreichen Fetch zeigt der Fallback ehrlich „keine Prognose“ (`CACHE_REBOOT_HINT`) | **entschieden (G4, 0.29.0): bleibt so** — der häufigere SD-Schreibzugriff wäre teurer als ein in Minuten wieder gefüllter Puffer; die Startzeile von `cache_forecasts.py` (`boot_state_note()`) nennt den Zustand in `cache.log` und `systemctl status`. Preise aus `/dev/shm` sind nach tmpfs-Mount ebenfalls erst nach dem nächsten Poll da |

**G4-Entscheidung (13.09.2026, Version 0.29.0):** Der Prognose-Cache bleibt im
flüchtigen `/tmp`. Ein Persistieren auf die SD-Karte würde bei jedem Abruf (alle
5 Minuten) schreiben — der Preis dafür ist höher als der Nutzen eines Puffers,
der nach einem Neustart in wenigen Minuten wieder gefüllt ist. Statt zu
spiegeln, erklärt die Oberfläche den Zustand: `CACHE_REBOOT_HINT` im
Preisvergleich, im Prognose-Raster und in der API-Fehlermeldung, dazu
`boot_state_note()` beim Start des Cachers.

Datenverlust-Fenster: Der RAM-Puffer überbrückt **7 Tage** NAS-Ausfall
(`RING_DAYS=7`); ist das NAS länger offline, verwirft `ring_prune` noch nicht
hochgeladene Snapshots. Bei geplantem langen NAS-Ausfall den Puffer vorher
vergrößern (tmpfs-Größe gegen 15 Polls/Tag/Station rechnen) — siehe
[ARCHITEKTUR.md](../architektur/ARCHITEKTUR.md#ressourcen--sd-härtung).

## Prognose-Qualität

Ein Abruf alle 5 Minuten macht eine alte Publikation nicht neu. Der Cache
kann beliebig alt werden; für „gültige Prognosedaten“ gelten die oben genannten
Zeit-/Qualitätsprüfungen. Auch ein grüner Cache enthält keine validierten
persönlichen Randbedingungen und gibt auf dem Pi keine Aktion frei.

## Nutzung

### Alltag

1. Immer dieselbe Adresse: `http://<RP2-IP>:8000`
2. Bei neuem Aufruf und bereitem NAS: vollständige NAS-GUI (Proxy); offene Pi-Tabs wechseln ausdrücklich
3. Wenn NAS offline: automatisch Fallback mit Live-Preisen + gecachten Prognosen + Heartbeat
4. Fallback erzwingen: `http://<RP2-IP>:8000/?fallback=1`

Für beste Ergebnisse: NAS mindestens 1× täglich starten (06:00–24:00), Prognosen werden um Mitternacht berechnet.

### B3 Features im Alltag

- Heatmaps: Tab Werkstatt → Heatmaps, wähle Niveau/Probability, Zeitraum (4/6/12 Wochen) und — ohne Station — die Vergleichsbasis (B12)
- Meine Stationen: Tab Werkstatt → Meine Stationen, sortiert nach Score, δ̂ mit KI
- Collector Status: Tab System → Pi/tmpfs Livestatus
- Route Evaluate: Tab Alltag → Rechnet sich der Umweg? → Server prüfen Button

## Updates & Changelog

Dependabot öffnet montags automatisch Update-PRs (Python, npm, CI-Actions, Docker-Basisimages via `.github/dependabot.yml`).

1. Watch → Custom → Pull requests anhaken
2. CI-Ampel abwarten (engine, web, nas-image grün), Patch/Minor mergen, Major Release-Notes prüfen
3. Nach Merge ausrollen:

```bash
# NAS
cd /mnt/user/appdata/tankapp
git pull
python3 tankapp.py nas-up

# RP2 (nur bei geändertem RP2-Code)
cd ~/TankApp
git pull
sudo systemctl restart tankapp-forecast-cache tankapp-fallback-gui
```

Wenn nach Update etwas klemmt: `git log --oneline -5`, `git revert <commit>`, `python3 tankapp.py nas-up`

### Release-Nachweise

Änderungen werden ausschließlich in der [Release-Historie](../releases/CHANGELOG.md)
gepflegt. Maßgeblich für den laufenden Dienst sind die Funktionen und
Betriebsanweisungen dieses Dokuments, nicht frühere Template-Iterationen.

Support: Logs prüfen (`journalctl -u tankapp-forecast-cache -f`), Cache prüfen (`cat /tmp/tankapp_cache/last_forecasts.json`), NAS-GUI prüfen (`http://<NAS-IP>:1355`), Heartbeat prüfen (`cat /dev/shm/tankapp/meta/heartbeat.json`), Version/Commit des NAS (`GET /api/v1/health` → `version`, `commit`, siehe [BETRIEB.md](BETRIEB.md#version-und-build-hash-prüfen)). Die RP2-Template-Version steht im Marker der erzeugten `templates/index.html`.
