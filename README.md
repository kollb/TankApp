# TankApp

**GUI öffnen → passende Tankstelle und Zeitpunkt sehen → tanken.**
Kein tägliches CSV-Kopieren, kein manuelles Modelltraining, keine erfundenen
Preise.

> Stand: 12.09.2026 · Version **0.17.0** · Änderungen: [CHANGELOG.md](CHANGELOG.md) ·
> nächste Aufgaben: [TODO.md](TODO.md) · Arbeitsregeln: [AGENTS.md](AGENTS.md)

## Dokumentation: ein Ordner, ein Index

**→ [docs/README.md](docs/README.md)** ist das Inhaltsverzeichnis der gesamten
Dokumentation („Ich will … → Dokument“). Alles liegt in `docs/`, Historisches in
[`docs/archiv/`](docs/archiv/README.md). Daneben gibt es keine Modul-READMEs mehr.

| Am häufigsten gebraucht | Dokument |
|---|---|
| Einrichten (Pi → NAS → Browser) | [docs/INSTALL.md](docs/INSTALL.md) |
| Dauerbetrieb: systemd, Backup, Alarme, Fehlersuche | [docs/BETRIEB.md](docs/BETRIEB.md) |
| Endpunkte, Fehlercodes, Beispiele | [docs/API.md](docs/API.md) |
| Wie Selektion, Modelle und Heatmaps rechnen | [docs/ANALYSE.md](docs/ANALYSE.md) |
| Warum Pi/NAS/Browser/RP2 so zusammenspielen | [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) |
| Regeln für Nutzertexte (Tonfall, Einheiten, Zitate) | [docs/MICROCOPY.md](docs/MICROCOPY.md) |
| Fachliches Zielbild (drei Fragen, Decision Layer) | [docs/KONZEPT.md](docs/KONZEPT.md) |
| Konzept ↔ Stand: was offen ist und warum | [docs/LUECKEN.md](docs/LUECKEN.md) |

## Was die App beantwortet

An der Säule, in ≤ 5 Sekunden, drei Fragen:

| Frage | Antwort der App |
|---|---|
| **F1 — Jetzt oder warten?** | Ampel, Zeitfenster, €-Differenz, `p_besser` |
| **F2 — Hier oder woanders?** | Netto-€ nach Umweg (Sprit + Zeit), Alternativen |
| **F3 — Heute oder später?** | Top-3-Fenster der nächsten Tage |

Drei Tabs: **Alltag** (Entscheidungs-Kompass, ≤ 3 primäre Zahlen),
**Werkstatt** (Scoreboard, Fan-Chart, Heatmaps, Meine Stationen), **System**
(Konfiguration, Archiv, Jobs, Collector, Alarme, Checkliste, Beleg-Export).

**Ehrlichkeits-Regel (Konzept §0.4):** Ohne echte Daten zeigt die App einen
Einrichtungszustand — keine Demo-Preise, keine „82 % sicher“ vor der
Kalibrierung. Bis M7 erreicht ist, bleiben `calibrated=false` und
`decision_ready=false`.

## Geräte-Rollen

| Gerät | Aufgabe |
|---|---|
| **Pi / RP2** | Collector für alle Städte (06–24 Uhr, 1 Request/5 min), RAM-Puffer `/dev/shm/tankapp` (7 Tage), Heartbeat, Upload zum NAS. Läuft unabhängig weiter. Optional: Port 8000 als 24/7-Zugang mit NAS-Proxy und Fallback-GUI. |
| **NAS** | Tankerkönig-Archiv, InfluxDB, automatische Aufbereitung/Fits/Selektion, API und Web-GUI auf Port 1355, `runtime/` (Feedback-Store, Jobs, Publikationen). |
| **PC / Handy** | GUI im Browser. PC optional für Einrichtung oder schnellere Rechenläufe — kein Dauerbetrieb, keine Pflicht-venv. |

## Stand der Umsetzung

**Implementiert und softwaregetestet:** Mehrstadt-Polling, Live-GUI mit
Alltag/Werkstatt/System, Nur-Lese-API mit Rate-Limit, gebündelter NAS-Dienst
(`nas-up`) mit Archiv-Nachholung, Modell-Läufen (prozessparallel), Selektion,
Heatmaps (Zeitraum und Vergleichs-Basis wählbar), Collector-Status, Decision
Layer (`/api/v1/decide` inkl. `latest_by` und Fahrtmodus), Job-Fortschritt,
Advice-/Wallet-Ledger mit Beleg-Storno und CSV-Export, Alarm-Block,
Backup-Skript, Versionsanzeige, RP2-Proxy/Fallback.

**Nicht gleichbedeutend mit Deployment oder geprüfter Modellgüte:** Auf den
eigenen Geräten noch nicht abgenommen. Prognosen sind unkalibriert und nicht
entscheidungsbereit; echte aktuelle Preise sind davon unabhängig nutzbar. Offen
sind u. a. Zweitmodell/Ensemble, gemeinsame Bootstrap-Ziehung über Stationen,
Kalibrierungs-Loop M7, ACI — jeweils mit Grund in
[docs/LUECKEN.md](docs/LUECKEN.md) und als Aufgabe in [TODO.md](TODO.md).

## Repo-Struktur

```text
app/          NAS-App: HTTP-Server, Decision Layer, Ledger, Jobs, Alarme, Heatmaps
engine/       Modellwerkstatt: Aufbereitung, Strukturmodell + AR(2), Bootstrap, Backtest
data-tools/   Collector, Uploader, Archiv-Sync, Stations-Entdeckung, Tausch, Export
analysis/     Offline-Stationsselektion (δ̂) und Polling-Fenster-Analyse
web/          GUI (Vite/React/Tailwind) inkl. Unit- und Playwright-Tests
rp2/          Fallback-GUI + Prognose-Cache für den Pi/RP2 (nur Standardbibliothek)
sample/       beide GUI-Prototypen — gestalterische Basis, bleiben unverändert
ops/nas/      Docker-Compose, Dockerfile, preflight.sh, backup.sh, InfluxDB-Setup
tests/        Pytest für app/, engine/, data-tools/, rp2/, Betrieb
docs/         gesamte Dokumentation (Index: docs/README.md), docs/archiv/ = historisch
data/analysis/  gitignored: lokale Ausgaben der Selektion inkl. aktivem polling.json
```

## Entwicklung & Tests

Softwaretests sind Entwicklerprüfungen, keine Installationspflicht. Windows mit
vorhandenem Python 3.11+, ohne neue venv:

```powershell
py -3 -m pip install -r requirements-dev.txt
py -3 -m pytest -q
```

Frontend (nur Entwicklung, Node 22):

```bash
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
npx --prefix web playwright install chromium
npm --prefix web run test:e2e
```

Vor jedem Commit den CI-Spiegel aus `.github/workflows/tests.yml` lokal fahren
(ruff check, ruff format --check, pytest, web test/build) — Details und
Reihenfolge in [AGENTS.md](AGENTS.md).

Lokale Vorschau nach dem Build: `python tankapp.py serve` (Hintergrundaufgaben
nur mit `--jobs`). Browsertests starten einen eigenen Server, sofern auf Port
1355 keiner läuft.

## Daten, Privates, Lizenz

Preisdaten: MTS-K via tankerkoenig.de (**CC BY 4.0**). Polling-Fenster 06–24 Uhr,
Token-Bucket 1 Request/300 s.

Private Konfiguration, Rohdaten, Berichte und Modelle bleiben **außerhalb von
Git**: `config.local.json`, `data/analysis/` (inkl. `polling.json`),
`data/influx.env`, `data/_netrc`, `data/apikey.txt`, `runtime/`. Die
Verzeichnisse `sample/good gui` und `sample/good statistic gui` bleiben
erhalten ([docs/GUI-VORLAGEN.md](docs/GUI-VORLAGEN.md)).
