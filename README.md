# TankApp

**Ziel: GUI öffnen → passende Tankstelle und Zeitpunkt sehen → tanken.**
Kein tägliches CSV-Kopieren, kein manuelles Modelltraining.

## Inhaltsverzeichnis (klickbar)

- [Ein Einstieg, eine Reihenfolge](#ein-einstieg-eine-reihenfolge)
- [Geräte-Rollen](#geräte-rollen)
- [Stand B3](#stand-b3)
- [Stand B5 — Konzept-Lücken geschlossen](#stand-b5--konzept-lücken-geschlossen)
- [Dokumentation](#dokumentation)
- [Entwicklung & Tests](#entwicklung--tests)

## Ein Einstieg, eine Reihenfolge

**[Installation und nächster Schritt → docs/INSTALL.md](docs/INSTALL.md)**  
**[Alle Dokumente im Überblick → docs/README.md](docs/README.md)** mit klickbarem Inhaltsverzeichnis

1. **Gütersloh ins gemeinsame Polling aufnehmen.** Frankfurt läuft weiter.
2. **NAS-App mit echten Live-Preisen starten.** Nicht auf fertige Prognosen warten.
3. **Parallel das NAS-Archiv automatisch aufbauen:** ein Jahr oder mehr Tankerkönig-Historie, fehlende Tage nachholen.
4. **NAS-App berechnet und veröffentlicht automatisch**, danach geprüfte Empfehlungen in derselben GUI ergänzen.

## Geräte-Rollen

| Gerät | Aufgabe im Endzustand |
|---|---|
| **Pi** | Collector für alle Städte, RAM-Puffer, Heartbeat, Upload zum NAS; läuft unabhängig weiter. |
| **NAS** | Tankerkönig-Archiv, InfluxDB, automatische Aufbereitung/Fits/Selektion, API und Web-GUI (inkl. Heatmaps, Meine Stationen, Collector-Status, Route-Evaluate). |
| **PC / Handy** | GUI im Browser. PC optional zur Einrichtung oder für schnellere Rechenläufe; kein Dauerbetrieb und keine verpflichtende venv. |

## Stand B3

**Stand 09.09.2026:** B3 — Mittel (neue Backend-Aggregate + Endpunkte) implementiert:

- **B3.9 Heatmaps DoW×Stunde** (Niveau + Cheap-Probability) → `GET /api/v1/heatmap`, GUI Statistik → Heatmaps
- **B3.10 Meine Stationen mit δ̂** (Ranking, Bootstrap-KI, AV-Score, billigste Stunde) → `GET /api/v1/selection`, Artefakt `runtime/selection/current.json`, Job `selection`
- **B3.11 Pi/tmpfs-Livestatus** (Collector-Herzschlag ans NAS) → Collector schreibt `meta/heartbeat.json`, Uploader `collector_status` Measurement, `GET /api/v1/collector/status`, GUI System → Pi/tmpfs Livestatus
- **B3.12 /v1/route/evaluate serverseitig** (optional, UI rechnet lokal) → `GET /api/v1/route/evaluate`, Button „Server prüfen“ im Alltag

Gemeinsames Mehrstadt-Polling, Live-GUI mit Alltag/Statistik/System, Nur-Lese-API und gebündelter NAS-App-Dienst sind implementiert. Ein Start über `python3 tankapp.py nas-up` übernimmt GUI, Archiv-Nachholung und automatische Modellberechnung/-veröffentlichung + Selektion. Bestehende InfluxDB weiterverwenden; Ablauf und private Konfiguration stehen ausschließlich in der Installationsanleitung.

**Nicht gleichbedeutend mit Deployment oder geprüfter Modellgüte:** Auf deinen Geräten noch nicht aktiviert/abgenommen. Ohne private Daten zeigt GUI Einrichtungszustand, keine Beispielpreise. Prognosen bleiben unkalibriert und nicht entscheidungsbereit; aktuelle echte Preise sind davon unabhängig nutzbar.

## Stand B5 — Konzept-Lücken geschlossen

**Stand 10.09.2026:** Der Abgleich des [Konzepts](docs/KONZEPT.md) mit dem Code
steht in **[docs/LUECKEN.md](docs/LUECKEN.md)**. Geschlossen wurden:

- **Job-Fortschritt statt „Läuft …“**: Phasen, Schritt x/y, Balken und
  Restschätzung im System-Tab, in `runtime/jobs/<job>.progress.json` und in
  `runtime/jobs/<job>.log` (auch ohne Docker lesbar).
- **Modell-Lauf ~17× schneller und mehrkernig**: vektorisierte
  12-Uhr-Regel-Projektion (bitgleiche Ergebnisse) plus Prozessparallelität
  (`TANKAPP_MODEL_WORKERS`, Default automatisch, serieller Rückfall).
- **API-Schutz**: 60/min anonym, 300/min mit `X-Api-Key`, `X-RateLimit-*`,
  `429` (Konzept §11).
- **Deprecation-Header** auf den alten Alltags-Routen (§11.3).
- **`latest_by`** in `/api/v1/decide` („bis wann muss ich getankt haben?“)
  und **Fahrtmodus** `onroute`/`dedicated` mit Heimatkoordinate (§10).
- **M7-Schwellen-Nachzug** aus dem Advice-Ledger (Vorschlag, abschaltbar).

## Dokumentation

- **[Dokumentations-Index](docs/README.md)** — klickbares Inhaltsverzeichnis, alle Dokumente nach Aufgabe
- **[Installation](docs/INSTALL.md)** — verbindlicher Betriebsplan, mit TOC, ohne 600 Zeilen Technik-Details
- **[Architektur](docs/ARCHITEKTUR.md)** — Pi↔NAS↔Browser, Rollen, Datenfluss, Heartbeat, Ressourcen
- **[API](docs/API.md)** — alle Endpunkte inkl. B3, mit Beispielen
- **[Betrieb](docs/BETRIEB.md)** — systemd, Backup, Fehlersuche, InfluxDB, Unraid, aus INSTALL.md konsolidiert
- **[Analyse](docs/ANALYSE.md)** — Selektion, Modelle, Heatmaps, Umweg-Ökonomie
- **[Lücken-Check](docs/LUECKEN.md)** — Konzept gegen Stand, offene Punkte mit Grund
- **[Prüfstand](docs/Prüfstand.md)** — unabhängige Prüfung Konzept ↔ API ↔ Engine ↔ GUI ↔ Live-Daten (10.09.2026)
- **[Gutachten](docs/Gutachten.md)** — gutachterliche Stellungnahme zur Methodik (Bewertung: [To-Do](docs/TODO.md) Abschnitt B)
- **[To-Do](docs/TODO.md)** — Aufgaben aus Gutachten, Prüfstand und Doku-Abgleich
- **[Konzept](docs/KONZEPT.md)** — fachliches Zielbild, Decision Layer, mit TOC
- **[RP2 Fallback + Proxy](docs/RP2.md)** — konsolidiert aus rp2/README + ANLEITUNG, 24/7 Zugang über Pi Port 8000
- **[Stations-UUID](docs/STATIONS-UUID.md)** — gleiche Namen trennen, mit TOC
- [Engine-Referenz](engine/README.md): Modellwerkstatt, Datenqualität, 12-Uhr-Regel
- [Werkzeugübersicht](data-tools/README.md): interne Einzelprogramme
- [GUI-Basis](sample/README.md): beide vorhandenen Oberflächen erhalten
- Spezialdiagnosen: [UUID-Umstellung](docs/STATIONS-UUID.md), [Preis-Zwillinge](engine/README.md#preis-zwillinge)
- RP2 Originale: [rp2/README.md](rp2/README.md), [rp2/ANLEITUNG.md](rp2/ANLEITUNG.md), [Changelog](rp2/AENDERUNGEN.md)

Alte verstreute Anleitungen wurden konsolidiert: INSTALL.md enthält nur verbindlichen Ablauf, Technik-Details → BETRIEB.md, Analyse → ANALYSE.md, API → API.md, Architektur → ARCHITEKTUR.md, RP2 → RP2.md. Keine Demo-Daten oder GUI-Vorlagen gelöscht.

## Entwicklung & Tests

Softwaretests sind Entwicklerprüfungen, keine Installationspflicht. Windows mit vorhandenem Python 3.11+, ohne neue venv:

```powershell
py -3 -m pip install -r requirements-dev.txt
py -3 -m pytest -q
```

Frontend-Prüfungen (nur Entwicklung, Node 22):

```bash
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
npx --prefix web playwright install chromium
npm --prefix web run test:e2e
```

Für lokale Vorschau nach Build: `python tankapp.py serve`; nur mit `--jobs` werden Hintergrundaufgaben eingeschaltet. Browsertests starten eigenen Server, sofern auf Port 1355 keiner läuft. `app/requirements.txt` enthält Pakete für optionale lokale Modellläufe; im NAS-Image bereits installiert.

Private Konfiguration, Rohdaten, Berichte und Modelle bleiben außerhalb von Git. Verzeichnisse `sample/good gui` und `sample/good statistic gui` bleiben erhalten.
