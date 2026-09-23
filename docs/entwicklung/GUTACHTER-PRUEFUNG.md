# Gutachter-Prüfung — Robustheit von Texten, GUI und statistischem Modell

> Stand: 23.09.2026 · App-Version **0.68.1** · Repository-Commit `69bff95` (`main`)
>
> Dieses Dokument ist die **Prüfgrundlage** für eine externe Gutachterprüfung:
> Es definiert den Prüfumfang (Robustheit der Nutzertexte, der GUI und des
> statistischen Modells), liefert ein reproduzierbares Prüfverfahren mit
> Abnahmekriterien, weist jede Behauptung ihrer normativen Grundlage, dem Code
> und den automatisierten Belegen zu und benennt ausdrücklich, was eine grüne
> Testsuite **nicht** beweist. Es ist kein fertiges Gutachten, sondern das
> Material, aus dem der Gutachter eines erstellen kann.

## Inhaltsverzeichnis

- [1. Zweck und Prüfumfang](#1-zweck-und-prüfumfang)
- [2. Systemüberblick für die Prüfung](#2-systemüberblick-für-die-prüfung)
- [3. Die drei Prüffelder: Behauptung, Grundlage, Beleg](#3-die-drei-prüffelder-behauptung-grundlage-beleg)
- [4. Reproduzierbares Prüfverfahren](#4-reproduzierbares-prüfverfahren)
- [5. Prüffeld 1 — Nutzertexte](#5-prüffeld-1--nutzertexte)
- [6. Prüffeld 2 — GUI](#6-prüffeld-2--gui)
- [7. Prüffeld 3 — Statistisches Modell](#7-prüffeld-3--statistisches-modell)
- [8. Testsituation: Was bereits arretiert ist](#8-testsituation-was-bereits-arretiert-ist)
- [9. Ehrliche Grenzen: Was die grüne Suite nicht beweist](#9-ehrliche-grenzen-was-die-grüne-suite-nicht-beweist)
- [10. Befundprotokoll für den Gutachter](#10-befundprotokoll-für-den-gutachter)
- [11. Anhang: Dateikarte, Parameter, Abkürzungen](#11-anhang-dateikarte-parameter-abkürzungen)

## 1. Zweck und Prüfumfang

### 1.1 Die drei Robustheitsbehauptungen

Die Prüfung soll bestätigen, dass die TankApp in drei Bereichen robust ist:

| Prüffeld | Behauptung (zu prüfen) | Maßstab |
|---|---|---|
| **Texte** | Jede dem Nutzer sichtbare Zeile (Web-GUI, Fallback-GUI, Fehlertexte, Push-Texte) folgt einem einzigen Regelwerk, enthält keine erfundenen Zahlen, keine falschen Einheiten und keine internen Pfade — und das Regelwerk steht im Code, nicht nur in der Doku | [Microcopy-Regelwerk](../produkt/MICROCOPY.md) |
| **GUI** | Die Oberfläche ist in allen Daten- und Fehlerzuständen (leer, lädt, veraltet, Fehler, offline, nicht entscheidungsbereit) auf allen Zielbreiten (320/390/1440 px) und über Tastatur/Screenreader robust, ohne Layoutbrüche und innerhalb definierter Performance-Budgets | [UI-Dokument](../produkt/UI.md) + [Qualitäts-Gates](../entwicklung/QUALITAET.md) |
| **Statistisches Modell** | Die Modellkette (Aufbereitung → Fit → Backtest → Veröffentlichung → Entscheidung) ist selbstkonsistent und ehrlich: Kalibrierung nur dort, wo sie auf Out-of-sample-Evidenz steht; keine Handlung ohne vollständige Evidenzkette (fail-closed); Prognose- und Backtestpfad identisch; jede Zahlenänderung gegen Invaranz-Fixtures arretiert | [Engine-Referenz](../referenz/ENGINE.md) + [ADR 0003](../adr/0003-MODELL-UND-FREIGABE.md) |

### 1.2 Was ausdrücklich nicht geprüft wird

Folgende Nachweise sind **bewusst außerhalb** dieses Prüfumfangs und in
[Projektstand](../planung/LUECKEN.md) als ausstehend geführt. Sie dürfen nicht
aus grünen Tests abgeleitet werden:

- **Betriebsabnahme auf Zielhardware** (NAS/LAN): p95 ≤ 300 ms der
  Kern-Endpunkte im realen Betrieb, Pollkadenz, RPO/RTO — Messrezept und
  -latte liegen vor ([Betriebsabnahme](../betrieb/BETRIEBSABNAHME.md)), der
  Lauf nicht.
- **Modellgüte auf echtem Bestand**: Güte je Station/Horizont auf realen
  Daten, M7-Gate auf abgerechneten echten Empfehlungen (braucht Wochen/Monate
  Betrieb), Out-of-sample-Replay der *veröffentlichten* Kurve.
- **Saison-/Regime-Abnahme**: Erster Regel-Winter nach der 12-Uhr-Regel,
  Rechtslage-Veränderungen (Regime-Plan, offen).
- **Datenschutz-/Rechtsabnahme** und **öffentlicher Betrieb**: Die App ist für
  einen deutschsprachigen Haushalt im eigenen LAN konzipiert
  ([ADR 0002](../adr/README.md)).

Die Gutachterstellung dazu steht in [Kapitel 9](#9-ehrliche-grenzen-was-die-grüne-suite-nicht-beweist).

### 1.3 Arbeitsweise des Repos — warum der Gutachter so vorfindet, was er prüft

Das Repository arbeitet seit Monaten im Zyklus **Befund → Fix →
Arretierungs-Test → datierter Bericht im Archiv**. Drei Beispiele, die der
Gutachter selbst nachvollziehen kann:

- Externe Zweitmeinung vom 10.09.2026 zur Statistik
  ([Gutachten, archiviert](../archiv/GUTACHTEN-2026-09-10.md)) mit
  Repo-Nachtrag, was übernommen wurde.
- Interne Tiefenanalyse vom 23.09.2026 in drei Runden: GUI-Logik, GUI-Texte
  und Mathe ([Runde 1](../archiv/BEFUND-GUI-TEXTE-STATISTIK-2026-09-23.md),
  [Runde 2](../archiv/BEFUND-GUI-MATHE-R2-2026-09-23.md),
  [Runde 3](../archiv/BEFUND-PARAMETERSCHRANK-R3-2026-09-23.md)) — alle
  Befunde (A1–A8, B1–B3, N1–N3, F1–F13) sind bis App-Version 0.68.1 und
  PR #222 (Commit `69bff95`) behoben und mit Tests arretiert.
- NAS-/Pi-Befund vom 20.09.2026
  ([archiviert](../archiv/BEFUND-TANKAPP-NAS-PI-2026-09-20.md)) mit
  getrennter Zählung reproduzierter Fehler und offener Nachweise.

Für den Gutachter bedeutet das: Fundstellen aus früheren Befunden sind ein
gültiger Ausgangspunkt, um die Arretierung zu prüfen — nicht als Behauptung
„alles behoben“, sondern als Prüfliste.

## 2. Systemüberblick für die Prüfung

### 2.1 Geräte und Rollen

| Komponente | Rolle | Relevant für |
|---|---|---|
| Raspberry Pi (Collector) | Holt Tankerkönig-Preise (06:00–24:00 Uhr, gemeinsames Budget: 1 Request / 300 s je Stadtset), RAM-Ringpuffer, Upload mit Ack/Wiederholung; optional NAS-Proxy mit lesender Fallback-GUI (Port 8000) | Datenquelle, Fallback-Texte |
| NAS | Archiv, InfluxDB, Aufbereitung, Modell-Fits, Backtests, Decision Layer, API und Web-GUI (Port 1355); persönliche Belege und Jobzustände in `runtime/` | Alle drei Prüffelder |
| Browser (PC/Handy) | React-GUI, PWA mit Service-Worker, Offline-Queue (IndexedDB) | Texte, GUI |
| RP2-Fallback | Eigene, **lesende** Betriebsoberfläche am Pi; kein Decision Layer, keine Aktionsfreigabe | Texte (feste Muster) |

### 2.2 Daten- und Entscheidungspfad

```text
Tankerkönig (CC BY 4.0)
  → Collector (Pi, 06–24 Uhr, 1 Request/300 s)
  → JSONL-RAM-Puffer → Upload (Ack + Wiederholung)
  → NAS: InfluxDB (Live) + Tankerkönig-Archiv (getrennt)
  → Aufbereitung (app/history.py: rohe Änderungsereignisse, exakte Zeitstempel)
  → Modell-Fit (engine/: Strukturmodell + AR(2) + 12-Uhr-Projektion + Bootstrap)
  → atomare Veröffentlichung (app/refresh.py)
  → Decision Layer (app/decide.py + app/thresholds.py + Gates)
  → API /api/v1 → Web-GUI (web/) und RP2-Fallback (rp2/)
```

Drei getrennte Beweisebenen werden in der App **nicht** zu einer Kennzahl
zusammengerechnet ([Konzept](../produkt/KONZEPT.md)):

1. **Markt-Labor** — Prognose und Rolling-Origin-Backtest (wie eine Regel auf
   dem Markt abgeschnitten hätte).
2. **Live-Advice** — gespeicherte Empfehlungen gegen Preise abgerechnet
   (Brier, Trefferquote, Regret der ausgegebenen Advice).
3. **Wallet** — tatsächliche Tankbelege (persönliche Bilanz, Befolgung).

### 2.3 Die drei Produktfragen

| Frage | Bedeutung | Entscheidung |
|---|---|---|
| **F1: Jetzt oder warten?** | Tankzeitpunkt, Fenster, finanzieller Unterschied | `refuel_now` / `wait` / `no_advice` |
| **F2: Hier oder woanders?** | Vorteil nach zusätzlichem Sprit- und Zeitaufwand | `refuel_elsewhere` (netto, nach Umwegkosten) |
| **F3: Heute oder später?** | Veröffentlichte Fenster bis zum notwendigen Tankzeitpunkt | Fensterliste mit Vorlauf |

Eine Handlung wird nur freigegeben, wenn die **Freigabekette** vollständig ist
(ADR 0003, 0.64.0): frischer Preis, offene Station, frische Herkunft,
höchstens 24 h altes Modell mit Zukunfts-Punkten, vollständige endliche
Pfade, veröffentlichte Güte (≥ 3 Tage). Jedes gebrochene Glied steht
maschinenlesbar als `blocking_reasons` im API-Vertrag; eine freigegebene
Handlung trägt ein Gültigkeitsende (`valid_until`). Ohne Evidenz steht
`decision_ready = false` — die App zeigt dann trotzdem aktuelle Preise und
nennt den Sperrgrund, statt eine Empfehlung zu erfinden.

## 3. Die drei Prüffelder: Behauptung, Grundlage, Beleg

| Prüffeld | Normative Grundlage (Doku) | Normative Grundlage (Code) | Automatisierter Beleg |
|---|---|---|---|
| Texte | [MICROCOPY](../produkt/MICROCOPY.md) (Tonfall, Typografie, Zahlen/Einheiten, Benennungen, Zustände, Verbote) | `web/src/data.ts` (einzige Formatter), `rp2/fallback_gui.py` (versionierte Muster, Marker `tankapp-fallback-gui v5.0`), `app/notify.py` (Push), `app/errors.py` (Fehlerbereinigung) | `web/src/microcopy.test.ts`, `web/src/format-convention.test.ts`, `web/src/a11y.test.ts`, `web/src/chartAlt.test.ts`, `web/src/fills.test.ts`, `components/Notices.test.ts`, `components/states.test.tsx`; Python: `tests/test_rp2_fallback.py`, `tests/test_notify.py`, `tests/test_o29_window_push.py`, `tests/test_glossary.py`, `tests/test_operations.py` (Doku-Links) |
| GUI | [UI](../produkt/UI.md) (Navigation 3+1, Bereiche, Zustände, Barrierefreiheit), [GUI-Vorlagen](../produkt/GUI-VORLAGEN.md) (Design-Basis aus `sample/`), [ADR 0002](../adr/README.md) (Umfang), [Qualität](../entwicklung/QUALITAET.md) (Budgets) | `web/src/views/*` (Lazy-Chunks je Bereich), `components/` (Zustandsbausteine), `app/server.py` + `app/metrics.py` (Selbstmessung, ETag/304) | Browser: `web/e2e/*` mit Mocks + `web/e2e/demo.spec.ts` + `mobile.spec.ts` + `failover.spec.ts` **ohne** Mocks gegen den Demo-Stack; Python: `tests/test_e2e_demo.py`, `tests/test_o22_publication_size.py` … `tests/test_o39_read_token.py` (Serververträge); Qualität: Lighthouse- und Last-Gates in `.github/workflows/quality.yml` |
| Statistisches Modell | [Engine-Referenz](../referenz/ENGINE.md) (Fit, Backtest, Kalibrierung, Messrezepte), [Analyse](../referenz/ANALYSE.md) (Selektion, Heatmaps, P-Seite), [Replay](../referenz/REPLAY.md) (Walk-forward-Abnahme), [Missingness](../referenz/MISSINGNESS.md), [ADR 0003](../adr/0003-MODELL-UND-FREIGABE.md) | `engine/` (models, backtest, calibration, bootstrap, selection, probabilities), `app/decide.py`, `app/thresholds.py`, `app/feedback.py` (M7-Gate, Ledger), `app/pside.py`, `app/gate_context.py` | Python: `tests/test_b0_invariance.py` (Bitgleichheit gegen Fixture), `tests/test_b2_calibration.py`, `tests/test_b3_daypair.py`, `tests/test_a11_shared_draws.py`, `tests/test_a10_ensemble.py`, `tests/test_backtest.py`, `tests/test_bootstrap.py`, `tests/test_models.py`, `tests/test_pside.py`, `tests/test_probabilities.py`, `tests/test_o21_score_parity.py` (TS/Python-Parität), `tests/test_a21_*` (Verträge); Fixtures: `tests/fixtures/b0_invariance.json`, `tests/fixtures/score_parity.json` |

Die Details je Prüffeld: [Kapitel 5](#5-prüffeld-1--nutzertexte),
[Kapitel 6](#6-prüffeld-2--gui), [Kapitel 7](#7-prüffeld-3--statistisches-modell).

## 4. Reproduzierbares Prüfverfahren

### 4.1 Umgebung

| Voraussetzung | Wert | Hinweis |
|---|---|---|
| Python | 3.11 oder 3.12 | 3.12 ist die Linie des NAS-Images, 3.11 die des Pi-Collectors; CI testet beide ([CI-Workflow](../../.github/workflows/tests.yml), O27-Build-Parität) |
| Node.js | 22 | identisch mit dem NAS-Image (`NODE_VERSION`) |
| Repository | Commit `69bff95` von `main` | `git checkout 69bff958fcb9d26fed0e4f8dc453bd193cf1fae2` |
| Netz | npm-Registry erreichbar | Für `npm ci` und Playwright-Chromium (siehe unten) |

Aufbau:

```bash
git clone https://github.com/kollb/TankApp.git && cd TankApp
git checkout 69bff958fcb9d26fed0e4f8dc453bd193cf1fae2

python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt

npm --prefix web ci
npx --prefix web playwright install chromium
```

**Abgeschottete Umgebungen** (Playwright-CDN nicht erreichbar): Die Browser-
Suite läuft auch mit einem Chromium aus der npm-Registry — der Weg ist in
[Qualität](../entwicklung/QUALITAET.md) dokumentiert (`@sparticuz/chromium`
plus NSS/NSPR-Extraktion, die Konfiguration liest
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` und `LD_LIBRARY_PATH`).

### 4.2 Der vollständige CI-Spiegel

Der CI-Spiegel aus [AGENTS.md](../../AGENTS.md) ist die definierte
Prüfsequenz — dieselbe Reihenfolge und dieselbe Kommandozeile wie in der CI:

```bash
python -m ruff check app tankapp.py data-tools/polling_plan.py data-tools/collect_prices.py engine data-tools/export_influx.py data-tools/upload_influx.py tests
python -m ruff format --check app tankapp.py data-tools/polling_plan.py engine data-tools/export_influx.py tests
python -m pytest -q
npm --prefix web test && npm --prefix web run build
npm --prefix web run test:e2e
npm --prefix web run test:e2e:demo
```

**Erwartetes Ergebnis** (Bezugspunkt: Ausführung dieser Prüfgrundlage am
23.09.2026 im Commit `69bff95`, Python 3.11.2, Node 22.22.3):

| Prüfung | Ergebnis am 23.09.2026 |
|---|---|
| `ruff check` | All checks passed |
| `ruff format --check` | 157 files already formatted |
| `pytest -q` | **1530 bestanden**, 0 Fehler (~8 min) |
| `npm --prefix web test` (Vitest) | **1250 bestanden** |
| `npm --prefix web run build` (TypeScript + Vite) | grün, Einstieg ≈ 0,29 MB JS (gzip ≈ 93 kB) |
| `npm --prefix web run test:e2e` (Browser mit Mocks, Desktop + Mobil) | **38 bestanden** (~36 s) |
| `npm --prefix web run test:e2e:demo` (Browser ohne Mocks gegen Demo-Stack) | **52 bestanden, 17 übersprungen** (Desktop 1440 px, Mobil 390 px, Schmal 320 px; Übersprünge = mobil-spezifische Zusagen, die im Desktop-Projekt bewusst skippen; ~2 min inkl. Demo-Aufbau mit echten Engine-Fits) |

Abweichende Zahlen bei identischem Commit sind ein Befund (Umfeld,
Paketversionen) — nicht still hinnehmen, sondern im
[Befundprotokoll](#10-befundprotokoll-für-den-gutachter) mit Umgebungsstand
melden.

### 4.3 Die CI-Workflow und was sie zusätzlich prüfen

- [tests.yml](../../.github/workflows/tests.yml): obiger Spiegel — engine-Job
  auf Python 3.11 **und** 3.12 (Build-Parität O27: getesteter Interpreter =
  ausgelieferter), web-Job auf Node 22, danach **Suite im NAS-Docker-Image**
  (das ausgelieferte Image führt dieselbe Python-Suite aus: „getestet wird,
  was läuft“).
- [quality.yml](../../.github/workflows/quality.yml): Lighthouse (drei
  GUI-Zustände, je 3 Läufe) und Lastpfad (`/api/v1/overview`, 8 Clients)
  gegen den Demo-Stack — auf PRs, die `web/`, `app/`, `engine/` oder
  `ops/quality/` anfassen, und sonntags 04:17 UTC. Budgets und Messwerte:
  [Qualität](../entwicklung/QUALITAET.md).

### 4.4 Demo-Stack für die manuelle Prüfung

Der Demo-Stack startet die **echte** App (`app.server.make_server`) mit
injizierter Preisabfrage statt InfluxDB und einer echten Engine-Publikation
aus einem realen Fit — feste Daten, deterministisch:

```bash
.venv/bin/python ops/quality/demo_server.py --data-dir /tmp/tankapp-demo \
    --static web/dist --port 1355 --host 0.0.0.0
```

Danach: `http://<host>:1355` im Browser. Erwartet (sechs Demo-Stationen,
ein Anker): Bereich „Jetzt“ mit Empfehlung, drei Fakten, „Heute im Blick“
(19 Stunden-Zellen, Berliner Zeit), Frische-Fußzeile; Bereich „Stationen“
mit Atlas, Karte und Vergleich; „Woche“ mit veröffentlichten Fenstern;
„Labor“ mit acht gefüllten Parameterkarten, PIT-Kachel und Tagebuch;
„System“ mit vier Bausteinen und Diagnose-Export (JSON ohne Tokens).

Zusätzliche API-Proben (jederzeit, kein Browser nötig):

```bash
curl -sD - -o /dev/null http://127.0.0.1:1355/api/v1/health | grep -iE "x-process-time|server-timing|x-request-id"
curl -s http://127.0.0.1:1355/api/v1/health | python3 -m json.tool | grep -E '"version"|"commit"|"performance"|"publication"'
ETAG=$(curl -sD - -o /dev/null http://127.0.0.1:1355/api/v1/overview | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')
curl -s -o /dev/null -w "%{http_code}\n" -H "If-None-Match: $ETAG" http://127.0.0.1:1355/api/v1/overview   # erwartet: 304
curl -s http://127.0.0.1:1355/api/v1/forecast | python3 -c "import json,sys; d=json.load(sys.stdin); print(sorted(d.keys()))"
```

Erwartet: Header `X-Process-Time`, `Server-Timing` (benannte Spans, `idle`
außerhalb `total`) und `X-Request-ID` in jeder Antwort; `version 0.68.1` mit
Commit-Hash im Health-Payload; ETag-Revalidierung antwortet **304**; der
Forecast-Payload trägt die Modell-Parameterfelder (`beta`, `ar_phi`,
`ar_detail`, `pava_pool_stats`, `pit`, `ensemble`, `bootstrap_samples`,
`law_*`) — der Payload-Vertrag der acht Labor-Karten (Befund N1, 0.68.1).

### 4.5 Was „bestanden“ heißt: Abnahmekriterien

Ein Prüffeld gilt für den Gutachter als **verifiziert**, wenn:

1. **Konsistenz:** normative Grundlage (Doku) und Code weisen denselben
   Wert/dieselbe Regel aus (Schwellen, Muster, Feldnamen) — Abweichungen
   sind Befund (Stichproben: Kapitel 5–7 nennen je Feld die zu
   abzugleichenden Paare).
2. **Automatik:** der komplette CI-Spiegel (§4.2) ist am geprüften Commit
   grün, und die genannten Arretierungs-Tests (Ratchets, Invaranz-Fixtures,
   Paritäts-Fixtures) sind Teil dieser Suite.
3. **Manueller Walkthrough:** die Prüflisten in Kapitel 5–7 zeigen keine
   Abweichung vom jeweiligen Regelwerk.
4. **Ehrlichkeit:** die Grenzen aus [Kapitel 9](#9-ehrliche-grenzen-was-die-grüne-suite-nicht-beweist)
   sind in der App sichtbar benannt (fail-closed-Zustände, Sperrgründe,
   „nicht messbar“) — die App verkauft nichts als belegt, was nur synthetisch
   geprüft ist.

## 5. Prüffeld 1 — Nutzertexte

### 5.1 Was „robust“ hier bedeutet

Robustheit der Texte heißt: (a) ein Text folgt **dem** Regelwerk — nicht je
Panel neu erfunden; (b) jede Zahl im Text kommt aus einer belegbaren Quelle
und läuft durch dieselben Formatter wie die Darstellung; (c) fehlende Daten
erzeugen keine Zahlen (Leerzeichen, Begründung, niemals Demo-Werte);
(d) Fehler- und Erfolgsmeldungen tragen den richtigen Ton und die richtige
ARIA-Rolle; (e) das Regelwerk und der Code können nicht ohne Test-Schaden
auseinanderlaufen (Ratchet).

### 5.2 Die normative Grundlage

[MICROCOPY](../produkt/MICROCOPY.md) ist die einzige verbindliche Textquelle
und gilt für `web/src/**`, `rp2/fallback_gui.py`, die Fehlertexte in
`app/**` und die Push-Texte in `app/notify.py`. Die Kernregeln:

| Regel | Inhalt | Beispiel |
|---|---|---|
| Tonfall | Ehrlich, knapp, handlungsleitend; Handlung zuerst, Begründung danach; kein Tadel; keine imperative Anrede; kein Ausrufezeichen/Emoji | „Jetzt tanken — 4 ct unter Tagesmedian.“ |
| Zitate | `„…“` für jedes Zitat und jeden zitierten Namen; keine HTML-Entities | Job „Modell-Update“ starten |
| Zahlen/Einheiten | **ausschließlich** über die Formatter in `web/src/data.ts`; Niveau in €/L, Differenz in ct/L, Beträge in €, de-DE-Komma, Europe/Berlin | `1,749 €/L`, `4,2 ct/L`, `62,45` |
| Benennungen | Feste Wörter (Station, Beleg, Fenster, Ersparnis, Günstig-Chance …); Fachbegriffe (δ̂, MASE, PICP) nur im Labor mit Tooltip | nicht „Fill“, nicht „Signal“ |
| Zustände | leer, lädt, veraltet, Fehler: je Zustand genau eine Formulierung; „—“ statt 0 oder leer; `error` = `role="alert"`, `warn`/`hint`/`success` = `role="status"` | „Noch kein Lauf.“, „Erneut laden“ |
| Meldungs-Regel | eine Rangstufe (error > warn > hint > success), gleichrangig mit „ · “ gereiht, 6 s Dauer, nur `error` bleibt | `components/Notices.tsx` |
| Verbote | keine erfundenen Zahlen, keine Pfade/Tokens/URLs/Koordinaten (Ausnahme: Bereich „System“ für Betriebsbegriffe), keine englischen Hook-Zeilen, keine Symbolsprache (`✓ ★ ▼ …`) als Textersatz | — |
| Ein Zustand, eine Zahl | Ein Text über eine Automatik nennt den Wert **dieser** Automatik, nicht den gerade gerechneten | „Auto (12 €/h)“ zeigt den Auto-Wert |
| Tooltips | ergänzen, ersetzen keine Erklärung; ≤ 80 Zeichen, ein Satz | Erklärung steht im sichtbaren Text |

Dazu: Die Fallback-GUI trägt **feste, versionierte Muster** (Marker
`tankapp-fallback-gui v5.0`) — nicht neu formulieren, nur wiederverwenden;
die Muster stehen als Tabelle in [MICROCOPY §4a](../produkt/MICROCOPY.md).
Push-Texte (§4f) unterscheiden Alarm (nie Preise/Pfade) und
Fenster-Meldungen (Modus `public`/`lan`), Ruhezeit 22–7 Uhr gilt nur für
Fenster-Meldungen.

### 5.3 Automatisierte Ratchets (wer gegen das Regelwerk verstößt, bricht CI)

| Test (Datei) | Was er arretiert |
|---|---|
| `web/src/microcopy.test.ts` | Paarige `„…“`, keine HTML-Entities, keine ausgemusterten Wörter/Synonyme aus MICROCOPY §4, Ergebnis-Worte gegen `lab.ts`, keine Ausrufezeichen, keine `✓`/`!`-Präfixe, keine technischen Pfade außerhalb des System-Bereichs, keine Abkürzungen ohne Langform, kein doppelt eingetragener Satz, ein Wortlaut je Zustand, keine Erklärung im Tooltip, keine Symbolsprache, keine Einheiten-Langform/`ggü.`/`Min.` in Views |
| `web/src/format-convention.test.ts` | Kein `toFixed` in Anzeigen, kein rohes `€`/`€/L` im Quelltext — Zahlen laufen nur über die Formatter |
| `web/src/a11y.test.ts` | Kontrast AA für **beide** Diagrammpaletten; O40-Block: Diagramme tragen Textalternative mit Werten, `aria-label` benennt das konkrete Diagramm |
| `web/src/chartAlt.test.ts` | Textalternativen: Werte statt Reihennamen, keine Farbe-Beschreibung, Tief/Hoch nur wenn nicht Endpunkt, „Liniendiagramm ohne Werte.“ bei Leerstand |
| `web/src/fills.test.ts` + `web/src/views/Ich.test.tsx` | Belegmaske: Live-Preissatz mit belegbarem Alter, Abweichung in ct/L mit Richtung, „gebucht wird, was du eingibst“ — die App korrigiert den Beleg nicht |
| `components/Notices.test.ts` | Meldungs-Rang, eine Meldung, eine Dauer (§5b) |
| `components/FeedbackBanner.test.tsx` | Ton der Rückmeldung (`ok`/`warn`/`error` mit Rolle) |
| `components/states.test.tsx` | Skeleton, Banner, Tabellen-Fehler gegen echtes Markup |
| `tests/test_rp2_fallback.py` | Dieselbe Wort- und Zahlenkonvention für die Fallback-GUI (Python) |
| `tests/test_notify.py`, `tests/test_o29_window_push.py` | Push-Texte: keine Pfade/Tokens/Koordinaten, Ruhezeit, zwei Modi, einmal je Episode |
| `tests/test_glossary.py` | Glossar existiert und trägt die Fachbegriffe der Laborkarten |
| `tests/test_operations.py` | Jeder lokale Doku-Link und jeder Anker existiert — Doku und App-Texte können nicht still brechen |

**Ratchet-Regel** (MICROCOPY §7): Neue Komponente mit Nutzertext? In die
Dateilisten der Ratchets eintragen, sonst prüft sie niemand. Der Gutachter
kann das als Strukturprüfung verlangen: Existiert Nutzertext, existiert der
Ratchet-Eintrag?

### 5.4 Manuelle Prüfliste (Texte)

Bezugspunkte im Demo-Stack (§4.4) — Abweichung vom Regelwerk = Befund:

1. **Leerzustände** (zweiter, leerer Server, z. B. Port 1356): „Noch
   kein/e <Sache>.“ + was fehlt; kein Alarm-Ton, kein „Erneut laden“.
2. **Fehlerzustände**: `LoadError` zeigt `problem(error_code)` als
   Klartext, Rohcode darunter, Knopf „Erneut laden“ — je `error_code`
   genau ein Klartext aus `messages` in `web/src/data.ts`.
3. **Frische-Fußzeile**: „Preise vor 4 Minuten · Prognose vor 35 Minuten ·
   <Ort>“ — Alter in Worten (`ageLabel`), niemals „vor 4 Min.“
4. **Keine Zahl bestimmbar**: „—“ (Geviertstrich) — nie 0, nie leer.
5. **Ampel-Karte „Jetzt“**: Ausgänge nur `Jetzt tanken` / `Warten bis …` /
   `Woanders tanken · <Station>` / `Keine klare Empfehlung`; Sicherheitssatz
   auf Stufe A trägt das Wort aus dem Prozentwert (Schwellen 75/55);
   Stufe C nennt den M7-Lernstand (`gate_n`) und dass die Preise gemessen
   sind — keine Prozentzahl.
6. **Woanders-Karte**: der Trennsatz „Das Prozent misst die reine
   Preisdifferenz (brutto); der €-Betrag rechnet Umweg und Zeit ab
   (netto).“ muss stehen (Befund B1, 23.09.2026) — Karten-Prozent und
   €-Betrag sind zwei verschiedene Ereignisse.
7. **Labor-Tagebuch**: Ergebnis-Worte nur `richtig` · `daneben` ·
   `unentschieden` · `nicht bewertbar`; Void-Gründe als Klartext;
   Mehrfach-Bestätigung bleibt eine Zeile.
8. **System**: Gesamtfarbe nur `Alles ok` · `Hinweise` · `Störungen` ·
   `Unbekannt`; Pfade/Endpunkte erscheinen **nur** hier (und in Diagnose-
   Export ohne Tokens); Outbox mit sichtbaren Endzuständen `abgelehnt`/
   `abgelaufen`.
9. **Push-Texte** (nur mit aktivem Push-Ziel prüfbar, sonst Code-Lektüre
   `app/notify.py` + die beiden Python-Tests): kein Pfad, kein Token, keine
   Koordinaten.

### 5.5 Historische Befunde (Prüfliste für die Arretierung)

| Befund | Inhalt | Status | Arretierung |
|---|---|---|---|
| TEXT-BEFUND 15.09.2026 (archiviert) | Komplettes Lektorat; Regelwerk daraus in MICROCOPY überführt | umgesetzt | MICROCOPY-Ratchets |
| A3 (Runde 1, 23.09.) | Lernfortschritt mischte 30-Tage-Ledger und Gate-Kohorte; Trefferzeile mischte Zählvariablen | behoben (PR #220) | `m7Progress` liest `gate_n`; halbe Ties konsistent zur `hit_rate`-Klammer |
| B1–B3 (Runde 1) | „spart netto +X %“ brutto/netto-Verwechslung; fest verdrahteter P<50 %-Text; Regelwerk-Drift (180 vs 1440 min) | behoben (PR #220) | Trennsatz (Prüfliste 6), Schwellwert aus `th["now_p"]` interpoliert, MICROCOPY auf 1440 min |
| F2, F7, F8, F10, F11, F12, F13 (Runde 3) | Fachbegriffe („B=2000 Blöcke“), irreführende Labels („Regel-Ergebnis“ statt „Ersparnis“), MASE-Namenskollision, Stabilität vs CUSUM, dünne Heatmap-Referenz | behoben (PR #222, `69bff95`) | `web/src/views/labor/Modell.tsx`, `Guete.tsx`, `web/src/lab.ts` — im Demo-Stack ablesbar |

## 6. Prüffeld 2 — GUI

### 6.1 Was „robust“ hier bedeutet

Robustheit der GUI heißt: (a) jede Kombination aus Datenzustand und
Gerätebreite rendert ohne Bruch; (b) Ladevorgänge flackern nicht (Polling
leert keine Ansicht); (c) die Tastatur- und Screenreader-Pfade sind gleich
wertig; (d) Performance-Budgets gelten als Test, nicht als Wunsch; (e)
Server und GUI spielen zusammen — geprüft gegen den echten Server, nicht
nur gegen Mocks.

### 6.2 Aufbau und normative Grundlage

- Navigation **3+1**: `Jetzt` · `Woche` · `Stationen` + `Mehr`/Studio-Gruppe
  (`Labor`, `Ich`, `System`, `Glossar`). Mobile: nicht-modales Auswahlblatt,
  Escape schließt, Fokus auf aktive Zeile. Details: [UI](../produkt/UI.md).
- Jeder Bereich lädt als eigenes Lazy-Chunk (`React.lazy`) — der Einstieg
  zieht nicht das Labor und nicht die Karte mit.
- Design-Basis: die geschützten Prototypen in `sample/` („good gui“,
  „good statistic gui“) — Übernahmeregeln in [GUI-VORLAGEN](../produkt/GUI-VORLAGEN.md).
- Umfangsgrenzen (bewusst nicht gebaut): [ADR 0002](../adr/README.md) —
  z. B. kein öffentlicher Betrieb, kein Preis-Ticker, keine freie
  Standortsuche.

### 6.3 Zustandsrobustheit (Datenwahrheit)

Jeder Zustand ist ein bezeichneter Baustein — ein Panel erfindet keinen
eigenen:

| Zustand | Baustein/Regel | Abnahme |
|---|---|---|
| Einrichtung | `Empty` + nächste Schritte | „Einrichten in drei Schritten“ auf leerem Server |
| lädt (erstes Mal) | `Skeleton*` mit `role="status"` + `aria-busy` | Platzhalter, keine falsche „keine Preise“-Behauptung |
| lädt (Aktualisierung) | **nichts** | Vorhandene Zahlen bleiben stehen (kein Flackern im Poll-Takt) |
| veraltet | `DataAge` (`dataAgeNote`) | Schwellen: Preis 30 min, Modell 24 h (1440 min), Selektion 36 h; doppelt = roter Ton; unbekannter Stand = kein Banner |
| Fehler (Panel/Tabelle) | `LoadError` / `CellError` | Klartext + Rohcode + „Erneut laden“; HTTP-200-Fehlerkörper ist keine gültige Summary |
| nicht entscheidungsbereit | — | Reine Preise, keine erfundene Empfehlung oder Sicherheitsquote; `blocking_reasons` sichtbar |
| offline | Outbox (IndexedDB) | Offene Einträge, 30-s-Nachreich-Takt, sichtbare Endzustände `rejected`/`expired`, Export (JSON/CSV), „nichts wird still verworfen“ |
| Job abgebrochen/unvollständig | `JobCard` | Zustand benennen, letzte Ergebnisse bleiben |

### 6.4 Barrierefreiheit und mobile Zusagen

| Zusage | Nachweis |
|---|---|
| Kontrast AA — auch für beide Diagrammpaletten | `web/src/a11y.test.ts` |
| Fokusführung, Tastaturbedienung, aktive Navigation | [UI](../produkt/UI.md) „Änderungen abnehmen“; Browser-Suite |
| Diagramme: Textalternative **mit Werten**, `aria-label` je Diagramm | `chartAlt.test.ts` + O40-Block in `a11y.test.ts` |
| Kein unnötiger horizontaler Seiten-Scroll bei 390 px (Stationskarten, Tabellen) | `web/e2e/mobile.spec.ts` (Breiten 320/390, Demo-Suite) |
| Scrolltiefe „Jetzt“-Abschnitt ≤ 1,5 Viewports bei 390 × 844 | `web/e2e/mobile.spec.ts` |
| Lange Modellbezeichner brechen um (nicht weg), bei 320 und 390 px auch mit absichtlich überlangem Bezeichner | geometrischer Browsertest (Demo-Suite), UI „Labor-Unterbereiche“ |
| Erst-Paint-Gate: Ansicht rendert erst mit Shell-Daten **und** View-Modul → CLS ≈ 0 | Lighthouse-Messwerte (Qualität), CHANGELOG 0.41.1 |
| PWA: Service-Worker unter `/sw.js`, Belege warten offline in Queue | UI §4d (System), `tests/test_o31_recap.py` u. a. |

### 6.5 Browser-Tests: zwei Suiten, zwei Beweise

| Suite | Beweist | Aufruf |
|---|---|---|
| **Mit Mocks** (`web/e2e/*`, `testIgnore` demo/mobile/failover) | Die GUI rendert mit **erwarteten** Antworten korrekt — inkl. aller Leer-/Fehlerzustände; Desktop 1440 px + Mobil 390 px | `npm --prefix web run test:e2e` |
| **Ohne Mocks** (`demo.spec.ts`, `mobile.spec.ts`, `failover.spec.ts` gegen den Demo-Stack, Port 1357) | Server und GUI **zusammenspielen**: overview → „Jetzt“ mit „Heute im Blick“ (19 Zellen, Berliner Zeit), Stationsliste, `If-None-Match` → 304, keine `role="alert"`; Mobil-Ratchet (kein Querlauf) auf echten Antworten; Failover mit echten Browser-Handlern | `npm --prefix web run test:e2e:demo` |

Zusätzlich: `tests/test_e2e_demo.py` (Serververtrag
ohne Browser) und der Ratchet
`tests/test_quality_gates.py::test_e2e_demo_suite_ist_keine_mock_suite` —
die Demo-Suite darf nicht still wieder zu einer Mock-Suite werden.

**Warum das wichtig ist:** Die Lücke „Mock passt, echter Server nicht“ hat
schon reale Defekte ausgelassen (NaN brach `/last_forecasts`, UTC-Fenster in
der Fallback-GUI) — seitdem gehört die zweite Suite zum CI-Spiegel.

### 6.6 Performance- und Qualitätsgates

Gemessen gegen denselben Demo-Stack (vergleiche [Qualität](../entwicklung/QUALITAET.md)):

| Gate | Budget | Ebene | Letzter dokumentierter Messwert |
|---|---|---|---|
| Lighthouse Barrierefreiheit / Best Practices / SEO | ≥ 0,90 / ≥ 0,90 / ≥ 0,80 | Fehler | 1,0 / 1,0 / 1,0 (drei Zustände, 0.41.1) |
| Lighthouse Performance | ≥ 0,80 (Ziel M4 > 0,90) | Warnung | 0,97–0,98 lokal; CI-Bestätigung offen |
| CLS | ≤ 0,1 | Fehler | 0,00–0,03 |
| Übertragungsvolumen | ≤ 1,5 MB | Fehler | ≤ 0,67 MB je Seite |
| LCP | ≤ 2500 ms | Warnung | ≈ 1,0–1,2 s |
| p95 `/api/v1/overview` (Last, 8 Clients) | ≤ 1000 ms | Fehler | 8 ms (p50 3 ms, 895 Abrufe) |
| p95 einer API-Antwort (Server-Selbstmessung) | ≤ 300 ms (LAN) | Warnung | Budget als `REQUEST_BUDGET_MS` in `app/metrics.py`, fährt in jedem Health-Payload; Zielhardware-Nachweis offen (§9) |
| Fehlerhafte Antworten (Last) | 0 (alles 2xx/3xx) | Fehler | keine |
| 304-Anteil der Revalidierungen | ≥ 20 % | Fehler | ≈ 87 % |

Server-Selbstmessung (seit 0.52.0/0.65.0): jede Antwort trägt
`X-Process-Time` (Beginn an der Requestzeile — Client-Idle steht als Span
`idle` **außerhalb** von `total`, Befund A21-B2.1), `Server-Timing` mit
fester Namensliste (`history`, `ledger`, `advice`, `wallet`, `stats`,
`snapshot`, `publication`, `serialize`, `gzip`, `total`, `idle`) und
`X-Request-ID`; `/api/v1/health` meldet p95/Max/Route plus
`performance.store_lock` (O26). Arretiert von `tests/test_o37_server_metrics.py`
und `tests/test_a21_b2_latency.py` (Gegenprobe: 400 ms Clientpause,
`X-Process-Time < 200 ms`, `idle ≥ 300 ms`).

### 6.7 Manuelle Prüfliste (GUI)

Im Demo-Stack (§4.4) und auf leerem Server:

1. **Navigation**: 3+1 auf 1440 px (Studio-Gruppe in Seitenleiste) und
   390 px (Mehr-Blatt, Escape, Fokus); alte URLs `?tab=labor` u. a. bleiben
   erreichbar; Alarm-Pille und Update-Banner global.
2. **Jetzt**: drei Fakten immer in gleicher Reihenfolge (`Jetzt hier` ·
   `Bestes Fenster heute` · `Tank reicht?`); Tagesstreifen mit Legende und
   Farbskala, die ihren Bezugszeitraum nennt; ohne Empfehlung keine
   Prozentzahl, keine Ampel.
3. **Stationen**: Atlas-Spalte „Netto“ — Server-`net_eur` zeigt empfohlene
   Stationen als Ersparnis (Befund A1: Vorzeichen und Sortierung
   invertiert), Standard-Sortierung nach Netto absteigend; Vergleich
   `compareStationsPair` und Atlas zeigen dieselbe Richtung derselben Zahl.
4. **Woche**: veröffentlichte Fenster; Mehrtage-Bänder (72/168 h) sind
   **nicht** als PIT-kalibriert beschriftet.
5. **Labor**: acht Parameterkarten tragen Payload-Werte (nicht „Kein … im
   Payload“ — Befund N1); Spielplatz-Zeiten als `HH:MM` (Befund F1:
   „22.67:00“); „B=… Ziehungen (Samples, nicht Blöcke)“; Ensemble-Titel
   „inverse MASE, global“ bei `horizon_weights: not_estimated`;
   Backtest-Bilanz „Ersparnis Regel / Orakel (obere Schranke)“.
6. **Ich**: Belegmaske mit Live-Preissatz und Abweichung (ct/L, Richtung);
   Tankstand „Keine Angabe“; Physisch vs What-if getrennt.
7. **System**: vier Bausteine (Collector, Datenbank, Modelle, App) mit
   Ton grün/gelb/rot/grau; Diagnose-Export als Datei — JSON enthält
   Version, Zustand, Coverage, Log-Zeilen, **keine Tokens**; Outbox-Karte.
8. **Browser-Konsole**: keine Fehler, keine `role="alert"` im Normalzustand
   (Demo-Suite-Zusage).
9. **Tastatur-Test**: komplette Navigation und alle Dialoge ohne Maus;
   Screenreader: Skeleton-Label nur für Screenreader, Diagramme tragen
   Wert-Textalternative.

### 6.8 Historische Befunde (Prüfliste für die Arretierung)

| Befund | Inhalt | Status |
|---|---|---|
| A1 (Runde 1) | Stations-Atlas: Server-`net_eur` mit falscher Vorzeichen-Konvention angezeigt **und** sortiert — empfohlene Stationen rot/teuer und nach unten | behoben (PR #220): `netCostEur`/`sortAtlasRows` einheitlich, Tests tragen die echte Konvention |
| A4 (Runde 1) | „Tagesmedian“ bei gerader Stichprobe = oberer Rand, kein Median | behoben (PR #220): Mittelwert der beiden mittleren Stunden-Minima |
| A5 (Runde 1) | Stufe B („Empfehlung ohne Prozent“) strukturell unerreichbar, Texte tot | behoben (PR #220): Stufe entfernt, `NowStage = "A" \| "C"`, MICROCOPY nachgezogen |
| A8 (Runde 1) | TS/Python-Parität der Labor-Scores in Randfällen (`n_p = 0`) | behoben (PR #220): `scoreRows` weist `null` wie der Server aus |
| N1/N1a–N1e (Runde 2) | Acht Labor-Karten lasen Payload-Felder, die der Server nie trug; GUI las falsche Schlüssel; Demo-Stack baute Zeilen ohne Diagnosefelder; mobil 320/390 px: JSON-Dump-Block und nicht brechender 34-Zeichen-Token | behoben (0.68.1): gemeinsamer Helfer `app.model_jobs.model_parameter_fields`, echte Schlüssel, kompakte Summary, `overflow-wrap:anywhere` |
| N2 (Runde 2) | Demo-Stack fuhr einen anderen statistischen Vertrag als der Betrieb (`harmonic_ar2` statt `profile_ar2+shared+day_pair`) | behoben (0.68.1): Demo-Lauf im Betriebsvertrag, arretiert in `tests/test_quality_gates.py` |
| F1, F9 (Runde 3) | Spielplatz-Zeit „22.67:00“; DeltaBars ohne `fmt` → ct/L-Werte als Euro | behoben (PR #222, `69bff95`): `formatHour`, `fmt={centPerLiter}` |
| GUI-UX/TIEFENANALYSE/Doku-Befunde 08.–15.09.2026 (archiviert) | Frühere Runden — gültige Regeln in [UI](../produkt/UI.md) und [MICROCOPY](../produkt/MICROCOPY.md) überführt | umgesetzt |

## 7. Prüffeld 3 — Statistisches Modell

### 7.1 Was „robust“ hier bedeutet

Robustheit des Modells heißt: (a) **Selfkonsistenz** — Backtest und
Veröffentlichung bewerten denselben Modellpfad (Kern, Ziehstrategie,
Day-Pair); (b) **Ehrlichkeit** — unkalibriert heißt unkalibriert,
`calibrated` ist ein technischer Zustand und keine Produktfreigabe,
fehlende Evidenz erzeugt `null`/Sperrgrund statt Zahl; (c) **Reproduzier-
barkeit** — jede Prognose ist reine Funktion ihrer Eingaben (bitgleiche
Invaranz-Fixtures); (d) **Validierung** — Auswertungslogik gegen
Out-of-sample-Holdout (zeitlich getrennt), nicht gegen Trainingsdaten;
(e) **Regelkonformität** — die 12-Uhr-Preisschutz-Regel (seit 2026-04-01:
Erhöhungen nur um 12:00 Uhr) wird exakt abgebildet, nicht nachgeglättet.

### 7.2 Architektur der Modellkette

#### 7.2.1 Aufbereitung (`app/history.py`, `engine/`)

- Rohe Änderungsereignisse mit exakten, offsetbehafteten Zeitstempeln und
  Änderungsflags — keine Median-Buckets, die Zeitstrukturen verstecken.
- Causaler Hampel-Filter mit getrennter Datenqualitätsdiagnostik:
  `price_raw` bleibt ungefiltert — entfernter Punkt ist zählbar
  (Befund M2). Ehrliche Grenze: der Filter entfernt den ersten Poll eines
  echten Sprungs (FFill-Bucket), Trainingspreise starten bestätigte
  Sprünge einen Bucket später.
- Datenqualität statt stiller Korrektur: beobachtete Anstiege ≥ 1 ct ohne
  erlaubten 12:00-Uhr-Punkt im Intervall werden als `law_rise_outside_noon`
  **geprüft und ausgewiesen, nicht gelöscht**.
- Zeitblöcke: `engine.timeblocks.block_key_utc` bildet die lokale
  Kalendergrenze auf einen UTC-Identitätsstempel ab — Mitternacht, der
  23-h-Frühlingstag, der 25-h-Herbsttag und beide Herbst-Folds bleiben
  chronologisch unterscheidbar (24/72/168-h-Indizes). Teilschluss nach
  `now`: echte Restblock-Minima je Draw (`suffix_minima`), kein
  Präfix-Artefakt — für einen Deadline-Schnitt, der kein Evidenz-Präfix
  trägt, setzt die API die P auf `null` und nennt die fehlende Evidenz;
  alte Veröffentlichungen bleiben als `legacy_whole_block` markiert.

#### 7.2.2 Strukturmodell + AR(2) (`engine/models.py`)

| Baustein | Verfahren | Robustheitsmerkmal |
|---|---|---|
| Strukturmodell | Robuste Regression (Huber-IRLS): 1.+2. Harmonische, Wochentags-Dummies, Mittags-Schritt („nach 12:00 Uhr, ab Gesetzesbeginn“), Feiertags-Dummy je Bundesland (gepoolt, aus bis zu 365 Tagen geschätzt, `holiday_pool_days`) | Ausreißer-robust statt OLS; der tägliche 12-Uhr-Sprung wird direkt getragen, Harmonische glätten ihn nicht nach |
| AR(2)-Nachlauf | Yule-Walker + Stabilitätsnetz: bei Wurzelradius > 0,98 beide Koeffizienten × 0,9, max. 100 Schritte; nicht stabilisierbar = benannter Fallback (`too_few_points`, `zero_variance`, `not_stabilised` …) | **Geprüft statt stumm**: `ar_shrink_events`, `ar_state_reset`, `ar_detail` je Kern im Modell-Artefakt und im Backtest-Report (`ar_shrink`) |
| 12-Uhr-Projektion | PAVA (Pool-Adjacent-Violators) je Segment [12:00, nächste 12:00) auf nicht-steigend — für Median **und** jede Bootstrap-Pfad; der erlaubte Sprung an der Segmentgrenze bleibt; NaN bleibt NaN (keine Koppelung über Lücken) | Isotone L2-Projektion: die Rechtsregel ist exakt erfüllt, keine Heuristik; Diagnose `pava_pool_stats` (Pools, max. Verschiebung, geänderte Pfade) |
| Residuen-Bootstrap | Exponentiell gewichteter **Tagesblock-Bootstrap** (Halbwertszeit 14 Tage, neuere Tage höheres Ziehgewicht), B = 2000 im Betrieb (200 im Demo) | Nichtparametrisch: Intraday-Abhängigkeit bleibt erhalten; Gewichtung gegen Trägheit bei Preiswechseln (Ablation in ENGINE „Abdeckung vs. Reaktionszeit“) |
| Gemeinsame Ziehung | Dieselben Tages-Indizes für alle Stationen (Salz für bitgleiche Reproduktion, Befund A11) | Stationen-Abhängigkeit bleibt im Intervall; Test `tests/test_a11_shared_draws.py` |
| Day-Pair | Benachbarte Trainingstage werden als Paar gezogen, deklarierte Kanten respektiert, ohne zulässige Paare Fallback auf unabhängige Tage | Trainingstag-Abhängigkeit; Test `tests/test_b3_daypair.py` |
| Ensemble | Inverse MASE-Gewichte aus **lokaler** Eine-Schritt-Validation (14 Tage, `ensemble_detail`); `weight_spread` je 288-Slot-Block als Diagnose | Ensemble-Gewichte sind keine Parameter-Aussage; horizontabhängige Gewichte sind **nicht geschätzt** und als `not_estimated` ausgewiesen |
| Kernen | `profile_ar2` (App-Default und Backtest), `harmonic_ar2`, `ensemble` als explizite Alternativen | **Backtest und Veröffentlichung bewerten denselben Pfad** — die frühere Abweichung ist behoben (LUECKEN „Implementierter Stand“) |

#### 7.2.3 Auswertungslogik: Backtest (`engine/backtest.py`)

- **Strict-End-Schnitt / Rolling Origin:** Der Bericht ist eine reine
  Funktion der Vergangenheit — jeder Tag wird auf Basis der Daten vorher
  ausgewertet (21 Prüftage im NAS-Job, Poll-Fenster 06–24 Uhr).
- **Horizont-Vertrag (M1):** `horizon_hours` ist der **Vorlauf des
  Zieltags** (0 = klassisches Tagesfenster, 72/168 = dieselben 24-h-
  Fenster am +3-d-/+7-d-Horizont) — bewusst zwei benannte Größen
  (Vorlauf vs Fensterlänge), seit ein verwechseltes `== 24`-Filter die
  24-h-Rekalibrierung still totgelegt hat.
- **Gates (Schwellen):** `mase_24h_below_0_95` (MASE < 0,95 gegenüber der
  saisonalen Naive auf gemeinsamer Datenbasis), `pinball50_better_than_naive`,
  `pinball_asym_better_than_naive` (asymmetrisch τ = 0,75 — Unterschätzung
  des Preises, also Warten in eine Erhöhung, wird **3×** bestraft),
  `picp95_between_90_and_98` (PICP 95 % ∈ [90, 98] %).
- **Rolling-PICP 7 d je Station:** Tagesquoten-Mittel (ein Tag = eine
  Stimme, O4) mit Konfidenz-Badge (grün ≥ 93 %, gelb ≥ 90 %, rot < 90 %,
  nominal 95 %; < 72 Punkte = keine Aussage) — Grundlage des Güte-Gates
  der Entscheidung.
- **DST-Tage:** bleiben im Backtest (nichts ausgeschlossen, nichts auf 24 h
  gerechnet); jeder solche Tag ist ausgewiesen (`dst_day`,
  `anchors_missing_nat` — fehlende 02:xx-Anker stehen, statt die Stichprobe
  still zu verkleinern); leere Skala = `mase: null` mit
  `mase_none_reason`, kein stummer Nullwert.
- **Regime-Kanten:** `flagged_not_excluded` — markiert und gezählt
  (`regime_breaks_in_window`), Kennzahlen über eine Kante sind zusätzlich
  als `metrics_break_free` ausgewiesen; nichts verschwindet still.

#### 7.2.4 Kalibrierung (`engine/calibration.py`, B2)

PIT-Rekalibrierung korrigiert die **empirische Verteilung** der
24-h-Bootstrap-Pfade, nicht den Punktpfad:

1. Rolling-Origin-Backtest liefert je 24-h-Wahrheit den PIT-Mittelrang
   `u = F_roh(y)` (0,5-Credit bei Ties, 401-Level-Gitter = 0,25 pp).
2. Aus den **früheren zwei Dritteln** der Backtest-Origins (out-of-sample)
   lernt PAVA eine monotone empirische CDF `H`; das **letzte Drittel**
   nimmt ab: alle Quantil-Abdeckungen (2,5/10/50/90/97,5 %) im
   Holdout-Band **und** PICP95 gegenüber roh höchstens **2 pp** schlechter.
3. Kandidat wird station-, sorten-, kern- und ziehungsmodusgenau
   gespeichert (Provenienz-Fingerprint `kind/shared/day_pair`) und aktiviert
   **mit einem Lauf Verzögerung** — die aktuell angewandte Hülle steht als
   `calibration`, der aktuelle Backtest schreibt nur `calibration_candidate`.
4. **Regime-Blackout:** deklarierte Kante blockiert jede Aktivierung vom
   Kanten-Tag bis 45 lokale Kalendertage danach (`status: "regime_blackout"`).
5. Fehlende Roh-PITs, zu kleine oder nicht zeitlich trennbare Stichproben
   sind ein benannter unkalibrierter Zustand — nie ein stilles Akzeptieren.
6. A/B-Gegenprobe: `TANKAPP_CALIBRATION=0` (Kandidaten und Messfelder
   weiter, Pfade roh). 72-/168-h-Pfade bleiben bewusst roh.

Arretierung: `tests/test_b2_calibration.py` (u. a. Zeittrennung, Gate,
Provenienz) und `tests/test_b0_pit_regime.py`.

#### 7.2.5 Entscheidungsschicht und Freigabekette (`app/`)

- **Gates getrennt:** `calibrated` (technische 24-h-PIT-Kalibrierung) ist
  **keine** Produktfreigabe. `decision_ready` braucht zusätzlich das
  **M7-Ledger-Gate** auf abgerechneten echten Advice-Snapshots und die
  vollständige Evidenzkette (Kapitel 2.3). ADR 0003.
- **M7-Gate (`app/feedback.py`):** Zähl-Gate über der Verteilungs-P-
  Kohorte: `gate_n ≥ 100` (`M7_MIN_RECOMMENDATIONS`), Brier gegen zwei
  naive Referenzen (LOO-berechnet: Basis- und Klima-Referenz) mit
  Block-Bootstrap-KI (Tagesblöcke, Kish-ESS statt Tick-Zahl, O6),
  Bias und Reliability-Steigung **gemeinsam** block-resamptem geprüft (M5).
  Vor der M7-Freigabe nennt die Grauzone **keine Zahl**
  (`GRAY_ZONE_REASON_GATE_SAFE`). Seit 0.68.0 (A21-B5.1) bindet die
  Freigabe an **Vertragskohorten** (Kraftstoff, Modellvertrag,
  Kalibrierungsmodus, Entscheidungsvertrag, Regime-Zustand) — ein
  Vertragswechsel startet die Statistik neu (Trade-off: sauber statt
  gepoolt).
- **Schwellen-Nachzug (`app/thresholds.py`, H3):** Deterministischer
  Regulator aus dem Ledger (Rauschband ± 2 SE, Deadbands, Schrittbegrenzung,
  Ziel-Trefferquote `hit_elsewhere` 60 %) — er verändert Geld-, Zeit- und
  Umwegschwellen, **nie** Prozent-Gates, um Güte künstlich passend zu
  machen. `now_p` ist fix bei 0,50.
- **Getrennte €- und P-Semantik:** `saving_eur` (pfadbasiert, „bis zu“,
  Fensterminima) ≠ `saving_median_eur` („erwartet“, Median-Kurve);
  `p_besser` (brutto, ohne Umwegkosten) ≠ `p_lohnt` (netto, gemeinsame
  Draws); `expected_saving` = Median der Draw-Fensterminima
  (`app/pside.py`, benannte Basis — Test `tests/test_pside.py`,
  O45: `tests/test_o45_saving_basis.py`); der Nutzenvertrag
  (`app/benefit.py`) benennt jede Basis: Median-Potenzial ≠ arithmetische
  Erwartung, `strategy_utility = None` beim Emit, Oracle-Untergrenke
  getrennt.
- **Mengen:** physische freie Kapazität vs. `what_if` (hypothetisch,
  sperrt reale Aktionen) — `tests/test_decide_tank.py`.
- **Ledger-Integrität:** Stores sind fail-closed (Überschreiben
  beschädigter Stores = Alarm, NP1/S3 — `tests/test_s3_store_integrity.py`);
  Archivzeilen gehören zur Jahres-/Allzeitbilanz und zur M7-Grundgesamt-
  heit (F3); Storno mit Audit-Spur; Settlement ohne Tankbeleg gegen
  Preisgeschichte (Kulanzschlitz doc-beschrieben).
- **TS/Python-Parität:** `tests/fixtures/score_parity.json` hält die
  Score-Rechnung der Labor-Seite (Python `app/stats_summary.py` ↔ TS
  `web/src/data.ts`) inkl. `null`-Ränder fest — Test `tests/test_o21_score_parity.py`.

### 7.3 Invaranz- und Paritäts-Fixtures (die „Zeugen“)

| Fixture | Test | Was sie arretiert |
|---|---|---|
| `tests/fixtures/b0_invariance.json` | `tests/test_b0_invariance.py` | Fit, Prognose (beide Kerne, Ensemble, gemeinsame **und** unabhängige Ziehung) und Backtest-Kennzahlen **bitgleich** gegen den Stand vor der B0-Messgrundlagen-Änderung. Wer den Fit absichtlich ändert, erzeugt die Fixture neu **und** schreibt im Commit, warum — die Fixture ist der Zeuge, nicht die Behauptung. |
| `tests/fixtures/score_parity.json` | `tests/test_o21_score_parity.py` | Gleiche Einheiten im Verhältnis (O21-Fix) und `null`-Parität TS ↔ Python in der Labor-Bewertung |
| Salz-Draws | `tests/test_a11_shared_draws.py` | Bitgleiche Reproduktion der gemeinsamen Ziehung (0.57, A11/B3) |
| B0-Zähler | `tests/test_b0_counters.py`, `tests/test_b0_app.py` | Die Audit-Felder (`ar_shrink_events`, `ar_state_reset`, `ar_detail`, `ensemble.weight_spread`, `pava_pool_stats`) sind vorhanden und konsistent |

### 7.4 Manuelle/statistische Prüfliste (Modell)

**A. Selbstkonsistenz (Demo-Stack + Code-Lektüre):**

1. `model_kind`/`shared_draws`/`day_pair` in der Veröffentlichung
   (`/api/v1/forecast`) sind `profile_ar2`/`true`/`true` — derselbe
   Vertrag wie der NAS-Lauf; die acht Labor-Karten tragen die Werte aus
   derselben Zeile (Befund N1/N2 arretiert:
   `tests/test_quality_gates.py::test_demo_stack_liefert_publikation_und_frische_preise`).
2. `backtest_model_kind` und veröffentlichter Kern müssen zusammenpassen
   (offene bekannte Stelle: Ensemble-Harmonik-Kern — siehe
   [Projektstand](../planung/LUECKEN.md) „Offene Arbeit“; der Gutachter
   prüft die Benennung, nicht still zu).
3. Backtest-Report (auf beliebigen vorhandenen Daten, Rezept
   [ENGINE](../referenz/ENGINE.md) §4): `model_kind`, `shared_draws`,
   `day_pair` benennen den gemessenen Pfad; `pit` je Station/Horizont;
   `ar_shrink` über alle Folds; DST-Block bei Zeitumstellung.

**B. Ehrlichkeit (Demo-Stack):**

4. `calibrated` ist sichtbar getrennt von `decision_ready`; ohne M7-Daten
   steht „Das Modell lernt noch — n von 100 … Die Preise unten sind
   gemessen.“ (Stufe C) — keine Prozentzahl.
5. 72-/168-h-Bänder tragen **keine** Kalibrierungsbeschriftung (Woche:
   „Mehrtagebänder nicht als PIT-kalibriert ausgeben“).
6. Kalibrierungs-Kachel (Labor): aktive Kurve und 24-h-Kandidat getrennt;
   `insufficient_pit`/`regime_blackout` als Zustände lesbar; Ledger-Brier
   für `raw` und `pit_24h` getrennt (zeitgetrennt, kein Kausalbeweis).
7. Fehlende Evidenz → `null`/Sperrgrund: `blocking_reasons` im Decide-
   Payload; `price_stale` sperrt Aktionen, zeigt aber die Preisspanne.

**C. Reproduzierbarkeit (mit vorhandenen Engine-Daten, optional):**

8. `python -m engine backtest --data … --polling … --days 21` zweimal
   → bitgleiche Kennzahlen (gleiche Daten, gleicher Seed);
   `python -m engine fit … && python -m engine forecast …` deterministisch
   aus dem gespeicherten Modell (kein Refit).
9. `TANKAPP_CALIBRATION=0` → identische Roh-Pfade, Kandidaten/Messfelder
   weiter vorhanden (A/B-Vertrag).

**D. Walk-forward-Abnahme (Replay-Harness):**

10. [Replay](../referenz/REPLAY.md): der Harness fährt die **unveränderte
    Produktionskette** (Aufbereitung → Fit → Bootstrap → PIT-Kandidatur →
    finale Projektion → Veröffentlichung → Decide) über Folds mit
    strikt vor dem Ursprung geschnittenen Dateneingängen gegen
    **vorab festgelegte** Akzeptanzmargen; ein negatives Ergebnis ist
    zulässig und ändert nichts automatisch. **Ehrlicher Stand:** Die
    Rolle `synthetic` ist Regression, **kein** Abnahmebeweis; der einmalige
    Freigabelauf mit äußerem, zeitlich unangetastetem Abnahmeset
    (Rolle `acceptance`) steht offen — bis dahin sind alle Replay-Zahlen
    Entwicklungsstand ([Projektstand](../planung/LUECKEN.md)).

### 7.5 Historische Befunde (Prüfliste für die Arretierung)

| Befund | Inhalt | Status |
|---|---|---|
| Gutachten 10.09.2026 (extern, [archiviert](../archiv/GUTACHTEN-2026-09-10.md)) | F2: B=200 machte das FDR-Gate bei 11 Stationen mathematisch unlösbar (q_min ≈ 0,055 > 0,05) → B=2000 zwingend; F1: Prozentanzeige; F5: Regime-Blindheit des Medians → EW-Median + CUSUM | F2 behoben (B=2000 fest), F1 nicht reproduzierbar, F5 implementiert (`delta_ew_ct`, `break_flag`) — Nachtrag mit Code-Prüfung im Archiv |
| NAS-/Pi-Befund 20.09.2026 (M1/M6, [archiviert](../archiv/BEFUND-TANKAPP-NAS-PI-2026-09-20.md)) | M1: Horizont-Filter vertauschte Vorlauf und Fensterlänge → 24-h-Rekalibrierung lief nie; M6: Kish-ESS statt Tick-Zahl, Provenienz-Fingerprint | im Code korrigiert (0.62.0); Betriebsnachweis offen |
| R1 „C — Mathe/Statistik: geprüft und entlastet“ (23.09.2026) | Zeilenweise Lektüre: `models.py`, `calibration.py`, `backtest.py`, `bootstrap.py`, `pside.py`, `thresholds.py`, `stats_summary.py`, `benefit.py`, `feedback.py`, `route.py` — **keine Rechenfehler** gefunden | Stand: entlastet; R2 bestätigt die Kernpfade erneut |
| R3 (23.09.2026, F1–F13) | Labor-Karten: fachlich unvollständige Sätze, falsche Zuordnungen (holiday_beta, PIT-Größe), irreführende Labels (Orakel < Regel?), MASE-Namenskollision, Stabilität vs CUSUM | Darstellung/Labels behoben (PR #222); offen: MASE-Label-Trennung (1step vs 24h) und Fensterbilanz-Text (episodes vs recommendations) — siehe „Offene Punkte“ des Befunds |

## 8. Testsituation: Was bereits arretiert ist

### 8.1 Das Ratchet-Prinzip

Die Testsuite ist keine Momentaufnahme, sondern **Arretierung**: Jede
frühere Befund-Fix-Paarung hat ihren Test, der das korrekte Verhalten
festhält. Regressions-Tests prüfen dabei bewusst **Verhältnisse und
Konventionen** statt absoluter Werte (z. B. `X-Process-Time < 200 ms`
nach 400 ms Clientpause), damit sie nicht durch einen langsameren Läufer
rot werden. Ein roter Test bei Code-Änderung ist ein Befund, kein Zufall.

### 8.2 Übersicht der Arretierung je Prüffeld

| Prüffeld | Python (1530 Tests am 23.09.2026) | Web (1250 Tests am 23.09.2026) | Browser |
|---|---|---|---|
| Texte | `test_rp2_fallback.py`, `test_notify.py`, `test_o29_window_push.py`, `test_glossary.py`, `test_operations.py` (Doku-Links), `test_o28_comment_runtime_truth.py` (Kommentare behaupten nichts Falsches) | `microcopy.test.ts`, `format-convention.test.ts`, `a11y.test.ts`, `chartAlt.test.ts`, `fills.test.ts`, `Notices.test.ts`, `FeedbackBanner.test.tsx`, `states.test.tsx`, `data-age.test.ts` | — |
| GUI | `test_e2e_demo.py` (Serververtrag), `test_quality_gates.py` (Demo-Suite bleibt mockfrei; Demo-Vertrag N2), `test_o22_publication_size.py` … `test_o39_read_token.py` (Serververträge je Befund), `test_s3_store_integrity.py`, `test_a21_b2_readstate.py`, `test_a21_b2_latency.py` | View-Tests je Bereich (u. a. `stations.test.ts`, `now.ts`-Tests, `Labor.test.tsx` mit echter Payload-Form) | `web/e2e/*` mit Mocks (Desktop+Mobil), `demo.spec.ts` + `mobile.spec.ts` + `failover.spec.ts` ohne Mocks (1440/390/320 px) |
| Modell | `test_b0_invariance.py` (Bitgleichheit), `test_b2_calibration.py`, `test_b3_daypair.py`, `test_a11_shared_draws.py`, `test_a10_ensemble.py`, `test_backtest.py`, `test_bootstrap.py`, `test_models.py`, `test_selection.py`, `test_probabilities.py`, `test_pside.py`, `test_o21_score_parity.py`, `test_o44_null_draws.py`, `test_o45_saving_basis.py`, `test_a21_b4_contracts.py` (DST/Restfenster), `test_a21_b5_gate_context.py` (Kohorten), `test_a21_b5_missingness.py`, `test_a21_b5_replay.py` (Harness) | `lab.ts`-Tests (Beta-Quantil-Intervall: Lanczos-betacf + Bisektion), `scoreRows`-Parität | — |
| Qualität | `test_quality_gates.py`, `test_o37_server_metrics.py` | Build (TypeScript + Vite) | Lighthouse + Last: `.github/workflows/quality.yml` |

### 8.3 CI-Struktur

| Workflow | Inhalt | Wann |
|---|---|---|
| [tests.yml](../../.github/workflows/tests.yml) | CI-Spiegel: engine (Python 3.11 **und** 3.12), web (Node 22, Vitest, Build, Playwright mit Mocks, Playwright ohne Mocks), **Suite im NAS-Docker-Image** (O27: derselbe Interpreter, dieselben Paketversionen wie ausgeliefert) | jeder Push/PR |
| [quality.yml](../../.github/workflows/quality.yml) | Lighthouse (3 Zustände × 3 Läufe) + Lastpfad gegen Demo-Stack | PRs auf `web/`/`app/`/`engine/`/`ops/quality/`, sonntags 04:17 UTC |

Der O27-Abgleich ist für die Robustheitsfrage zentral: „Grün getestet“
bedeutet, dass **derselbe** Stand im **ausgelieferten** Image geprüft wurde —
nicht nur, dass ein Runner grün war. Bei Rot hängt die Kurzfassung des
Fehlers als PR-Annotation (nicht nur im Log).

## 9. Ehrliche Grenzen: Was die grüne Suite nicht beweist

Dieses Kapitel ist Teil der Prüfaufgabe: Der Gutachter soll prüfen, dass die
App **über genau diese Grenzen hinweg ehrlich ist** (sichtbar benannt,
fail-closed, keine verkaufte Sicherheit). Die Grenzen selbst sind in
[Projektstand](../planung/LUECKEN.md) als ausstehende Nachweise geführt.

| Bereich | Was nicht bewiesen ist | Was die App stattdessen tut |
|---|---|---|
| M7-Produktfreigabe | Keine ausreichend abgerechneten **echten** Advice, keine bestandenen Brier-/Reliability-Gates über Betriebszeit; strenge Vertragskohorten starten die Statistik neu (bis n ≥ 100 je Kohorte vergehen real Wochen/Monate) | `decision_ready = false`, Stufe C („Das Modell lernt noch — n von 100 … Die Preise unten sind gemessen.“), `blocking_reasons` maschinenlesbar |
| Kalibrierung der **veröffentlichten** Kurve | Out-of-sample-Replay der publizierten Kurve braucht Betriebshistorie; der Kalibrierungsnachweis läuft auf dem zeitgetrennten PIT-Holdout des Backtests | `calibration` ist die tatsächlich angewandte Hülle, `calibrated` ist nur technischer Zustand; 72/168 h roh; Regime-Blackout 45 Tage |
| Modellgüte auf echtem Bestand | Vergleich je Station/Horizont auf realen Daten (inkl. alternativer Kerne); Backtest-Gates nur auf dem geprüften Bestand | Report benennt Messwerte **und** Kriterien getrennt; `mase: null` mit Grund statt stummer Null |
| NAS/Pi-Betriebsabnahme | p95 ≤ 300 ms im realen LAN, Pollkadenz, RPO/RTO, Stromausfall, Watchdog, Cache-Mount — gemessen ist nichts; der Audit-Befund „Overview p95 2,00 s“ war die einzige bekannte Messung und der Pfad ist seither entkoppelt/gecacht (Sandkasten-Messung, keine NAS-Abnahme) | Messlatte, -rezept und Tooling liegen vor ([Betriebsabnahme](../betrieb/BETRIEBSABNAHME.md), `data-tools/ops_acceptance.py`); Server misst sich selbst (`performance`, `X-Process-Time`) — als Antwort auf „warum hängt das gerade“, nicht als Abnahme |
| Missingness-Policy | Ablation reproduzierbar, aber synthetisch (Einzelrealisierung, PICP unter Nominal) — kein Policy-Wechsel ohne robusten Nachweis über echte Lückenmuster | Default `zero_fill` (12-Uhr-Integrität) bleibt; je Zeitpunkt gemessen (`fill_residual_draws`), [Missingness](../referenz/MISSINGNESS.md) |
| Hampel-Filter | Entfernt den ersten Poll eines echten Sprungs (FFill-Bucket) — Trainingspreise starten bestätigte Sprünge einen Bucket später | `price_raw` bleibt ungefiltert; Diagnostik ausgewiesen |
| Replay-Freigabe | Einmaliger Freigabelauf mit äußerem, zeitlich unangetastetem Abnahmeset (Rolle `acceptance`) noch nicht gelaufen | Alle Replay-Zahlen werden als Entwicklungsstand benannt; `synthetic` = Regression |
| Backup/Restore | Datenbankskonsistente Influx-Sicherung, Restore-Nachweis mit Produktionsdaten im Feld, RPO/RTO-Stopuhr | Runtime-Backups validiert veröffentlicht (Erfolgsmanifest), Restore per `ops/nas/restore.sh` + Verifizierer (A21-B3.2) |
| Saison/Regime | Erster Regel-Winter nach der 12-Uhr-Regel; Rechtslage-Veränderungen | Juli-Generalprobe A16 ist **gemessen** (Regime-Plan); Simulationen werden nicht als Live-Messung verbucht |
| Persönliche Rückkopplung | `w(h)` braucht ≥ 8 Füllungen | Default bis dahin; Belegdaten vortäuschen keine Marktmodell-Güte |
| Kampagnenquote | 6/2/2 nur offline | Bedarf am realen Mehrstadtbetrieb zu messen, nicht als NAS-Funktion behauptet |

**Konsequenz für die Gutachterstellung:** Die Robustheitsbehauptung
„Texte, GUI und statistisches Modell sind robust“ gilt auf der
**Software-Ebene** am geprüften Commit — Code, Verträge, Tests, fail-closed-
Verhalten. Aussagen über Live-Datenqualität und Betriebsrobustheit sind
beschränkt auf die vorliegenden Messrezepte und ausstehende Messungen.
Jede Stellungnahme, die darüber hinausgeht, wäre eine Behauptung ohne
Nachweis — und damit gegen die Ehrlichkeits-Regel der App selbst
([Konzept](../produkt/KONZEPT.md)).

## 10. Befundprotokoll für den Gutachter

### 10.1 Format je Befund

| Feld | Inhalt |
|---|---|
| ID | Bereich + Nummer: `T1` (Texte), `G1` (GUI), `M1` (Modell) — fortlaufend je Befundbericht |
| Prüffeld | Texte / GUI / Modell (oder „Grenzen“, falls eine ehrliche Beschränkung fehlt) |
| Schwere | **hoch** = direkte Nutzerschädigung oder falsche Aussage (Vorbild: A1 — Atlas zeigte empfohlene Stationen als teuer); **mittel** = falsche Grundgesamtheit, gemischte Zählvariablen, veraltete Berechnungsgrundlage (Vorbild: A2/A3/N2); **niedrig** = tote Pfade, Docstring-/Label-Drift, Randfall-Parität (Vorbild: A5/B3/F1) |
| Fundstelle | `datei:zeile` bzw. Bereich + Panel der GUI; bei Server: Endpunkt + Feld |
| Behauptung | Was der Code/Doku/Text behauptet (erwartet) |
| Beobachtung | Was tatsächlich passiert (ist) — mit Reproduktion |
| Reproduktion | Schrittfrei: Commit, Befehl, Demo-Stack-Zustand, Viewport |
| Beleg | Screenshot, curl-Ausgabe, Testlauf-Log |
| Betroffener Test | Welcher Test (falls einer) das Verhalten arretiert — ein Test, der das Falsche arretiert, ist Teil des Befunds und muss mit dem Fix umgezogen werden (Muster: A1 — die Tests trugen die Inversion, `stations.test.ts`) |

### 10.2 Arbeitsweise des Repos (Erwartung an den Umgang)

1. Befund wird als GitHub-Issue/-PR an `kollb/TankApp` eingereicht.
2. Fix erfolgt mit **gleichem Commit** wie die Korrektur des arretierenden
   Tests (Befund → Fix → Ratchet, siehe Kapitel 1.3).
3. Datierter Befundbericht mit Stand, Status und Nachfolger-Verweis in
   `docs/archiv/` (Konvention: [Dokumentationspflege](../entwicklung/DOKUMENTATION.md)),
   gültige Regeln werden in das zuständige Fachdokument übernommen.
4. App-Release: `app/version.py` und [CHANGELOG](../releases/CHANGELOG.md)
   gemeinsam pflegen.

Für den Gutachter: Es gibt keinen separaten „Bugtracker“ außerhalb von
GitHub; die Archive in `docs/archiv/` sind die lückenlose Historie der
Befunde seit 08.09.2026 (Index: [Archiv-README](../archiv/README.md)).

### 10.3 Abgabepaket (empfohlen)

- Befundbericht als Markdown (oberes Format) — bevorzugt direkt in
  `docs/archiv/` als PR.
- Nachvollziehbarkeit: Commit-Hash, Umgebung (Python/Node-Versionen, OS),
  Zeitstempel der Testläufe, ausgeführte Kommandos.
- Abgrenzung: reproduzierter Befund vs. offener Nachweis (wie
  [NAS-/Pi-Befund](../archiv/BEFUND-TANKAPP-NAS-PI-2026-09-20.md) es
  vorbildlich trennt).

## 11. Anhang: Dateikarte, Parameter, Abkürzungen

### 11.1 Dateikarte je Prüffeld

**Texte**

| Datei | Rolle |
|---|---|
| `docs/produkt/MICROCOPY.md` | Das verbindliche Regelwerk (normativ) |
| `web/src/data.ts` | Einzige Zahlen-Formatter + zentrale `messages` (Fehler-Klartexte) |
| `web/src/microcopy.test.ts`, `web/src/format-convention.test.ts` | Ratchets (normativ) |
| `rp2/fallback_gui.py` | Fallback-GUI mit festen Mustern (Marker `tankapp-fallback-gui v5.0`) |
| `app/notify.py` | Push-Texte (serverseitig) |
| `app/errors.py` | Fehlerbereinigung vor jedem Auftritt |

**GUI**

| Datei | Rolle |
|---|---|
| `docs/produkt/UI.md` | Navigation, Bereiche, Zustände, Zusagen (normativ) |
| `web/src/views/*.tsx` + `web/src/views/labor/*.tsx` | Bereiche (Lazy-Chunks) |
| `web/src/now.ts`, `week.ts`, `stations.ts`, `lab.ts`, `system.ts`, `fills.ts`, `strip.ts` | Bereichslogik inkl. Arretierungstests |
| `web/src/components/*.tsx` | Zustandsbausteine (Skeleton, DataAge, LoadError, Notices, JobCard, FreshnessLine, FeedbackBanner) |
| `web/e2e/*.spec.ts` | Browser-Suites (mit Mocks; `demo`/`mobile`/`failover` ohne) |
| `app/server.py`, `app/metrics.py` | HTTP-Schicht, ETag/304, Selbstmessung |
| `ops/quality/demo_server.py`, `ops/quality/demo_data.py` | Demo-Stack (echte App, injizierte Preise, echter Fit) |
| `.github/workflows/quality.yml`, `web/lighthouserc.json`, `web/load/overview.mjs` | Qualitäts-Gates |

**Statistisches Modell**

| Datei | Rolle |
|---|---|
| `docs/referenz/ENGINE.md` | Fit, Backtest, Kalibrierung, Messrezepte (normativ) |
| `engine/models.py` | Strukturmodell, AR(2), 12-Uhr-Projektion, Bootstrap, Ensemble |
| `engine/backtest.py` | Rolling-Origin-Backtest, Gates, PIT, DST, Regime |
| `engine/calibration.py` | PIT-Rekalibrierung (PAVA auf CDF, Holdout-Gate, Blackout) |
| `engine/bootstrap.py`, `engine/probabilities.py`, `engine/selection.py`, `engine/timeblocks.py` | Draws, P-Seite, Selektion (δ̂, FDR), Zeitblöcke |
| `app/decide.py` | Decision Layer, Freigabekette, Fenster, `latest_by` |
| `app/thresholds.py` | H3-Regulator (nur €-/Zeit-Schwellen) |
| `app/feedback.py` | Ledger, M7-Gate, Settlement, Brier-Referenzen |
| `app/pside.py`, `app/benefit.py`, `app/quantity.py`, `app/route.py` | P-Semantik, Nutzenvertrag, Mengen, Umweg-Ökonomie (eine ökonomische Quelle, O9) |
| `app/refresh.py`, `app/model_jobs.py` | Modell-Jobs, atomare Veröffentlichung, Parameter-Payload (eine Quelle: `model_parameter_fields`) |
| `app/gate_context.py`, `app/replay.py` | Vertragskohorten, Replay-Harness |
| `tests/fixtures/b0_invariance.json`, `tests/fixtures/score_parity.json` | Invaranz- und Paritäts-Zeugen |

### 11.2 Kernparameter und Schwellen (mit Fundstelle)

| Parameter | Wert | Fundstelle |
|---|---|---|
| Trainingsfenster / harte Untergrenze | 42 Tage / 28 Tage (`min_train_days`) | `engine/models.py` (`fit`), [ENGINE](../referenz/ENGINE.md) |
| Live-only-Handover | 90 Tage (Archiv fällt aus Modell-Input) | `engine bootstrap` (`live_only_days`), [ENGINE](../referenz/ENGINE.md) |
| Bootstrap-Ziehungen B | 2000 Betrieb / 200 Demo | `engine/models.py`, `ops/quality/demo_data.py` |
| EW-Halbwertszeit Bootstrap / δ̂ | 14 Tage / 7 Tage | `engine/backtest.py`, `engine/selection.py` |
| AR(2)-Stabilitätsnetz | × 0,9, Radius 0,98, max. 100 Schritte | `engine/models.py` (`AR_SHRINK_*`) |
| Backtest-Gates | MASE < 0,95 · Pinball τ=0,5 besser als Naive · Pinball τ=0,75 (3× Strafe) besser als Naive · PICP 95 % ∈ [90, 98] % | `engine/backtest.py` (Kriterien in `report.json`) |
| Rolling-PICP-Badge | grün ≥ 93 % / gelb ≥ 90 % / rot < 90 % (nominal 95 %; < 72 Punkte = keine Aussage) | `engine/backtest.py`, [ENGINE](../referenz/ENGINE.md) |
| Kalibrierung | 2/3 Trainings- / 1/3 Holdout-Origins; Quantil-Bänder + PICP95-Regression ≤ 2 pp; Provenienz-Fingerprint; ein Lauf Verzögerung; Regime-Blackout 45 lokale Tage; Gitter 0,25 pp (401 Levels) | `engine/calibration.py`, [ADR 0003](../adr/0003-MODELL-UND-FREIGABE.md) |
| M7-Gate | n ≥ 100 je Vertragskohorte; Brier gegen LOO-Basis- und Klima-Referenz mit Block-Bootstrap-KI (Kish-ESS); Bias + Steigung gemeinsam | `app/feedback.py` (`M7_MIN_RECOMMENDATIONS`, O5/O6) |
| Schwellen-Startwerte | `now_p` 0,50 (fix) · `elsewhere_net_eur` 1,50 € · `elsewhere_p` 0,50 · Ziel-Trefferquote `elsewhere` 60 % | `app/thresholds.py` (`DEFAULT_THRESHOLDS`, `TARGETS`) |
| Freigabekette | frischer Preis (< 30 min) · offene Station · frische Herkunft · Modell ≤ 24 h mit Zukunfts-Punkten · vollständige endliche Pfade · veröffentlichte Güte ≥ 3 Tage → sonst `blocking_reasons`; Handlung mit `valid_until` | `app/decide.py`, [ADR 0003](../adr/0003-MODELL-UND-FREIGABE.md) |
| Polling | 06:00–24:00 Uhr, 1 Request / 300 s je Stadtset (gemeinsames Budget, Round-Robin) | `data-tools/collect_prices.py`, [Konzept](../produkt/KONZEPT.md) |
| Daten-Frische-Schwellen (GUI) | Preis 30 min · Modell 24 h (1440 min) · Selektion 36 h; doppelt = roter Ton | `web/src/data.ts` (`dataAgeNote`), [MICROCOPY](../produkt/MICROCOPY.md) |
| Performance-Budgets | p95 API-Antwort LAN ≤ 300 ms (`REQUEST_BUDGET_MS`) · p95 `/overview` Last ≤ 1000 ms · 304 ≥ 20 % · Lighthouse a11y/bp/seo ≥ 0,90/0,90/0,80, CLS ≤ 0,1, Volumen ≤ 1,5 MB | `app/metrics.py`, `.github/workflows/quality.yml`, [Qualität](../entwicklung/QUALITAET.md) |
| Betriebsabnahme (Messlatte) | p95 ≤ 300 ms LAN · Poll 300 s ± 20 % · RPO ≤ 30 min · RTO ≤ 240 min | `data-tools/ops_acceptance.py` (`ACCEPTANCE_TARGETS`), [Betriebsabnahme](../betrieb/BETRIEBSABNAHME.md) |
| 12-Uhr-Regel | Preiserhöhungen nur um 12:00 Uhr (seit 2026-04-01); PAVA je [12:00, 12:00)-Segment + Regime-Kanten; Verletzungen gezählt (`law_rise_outside_noon`), nicht gelöscht | `engine/models.py`, [ENGINE](../referenz/ENGINE.md) |
| Tankmenge / Beleg-Liter | Rechengröße 10–100 L (ganze Liter) / gebuchter Vorgang 5–100 L (Schritt 0,5) | `app/profiles.py`, `web/src/data.ts` (`FILL_LIMITS`), [MICROCOPY](../produkt/MICROCOPY.md) |
| Umweg-Ökonomie | Brutto = Δp · L · K = d·(c/100)·p + (d/v)·z · Netto = Brutto − K · kritische Differenz = K/L | `app/route.py` (`net_economics`), [Konzept](../produkt/KONZEPT.md) |

### 11.3 Abkürzungen und IDs

| Bezeichnung | Bedeutung |
|---|---|
| ADR | Architecture Decision Record (Entscheidungsakten unter `docs/adr/`) |
| PIT | Probability Integral Transform — Kalibrierungsmaß über Mittelränge (0,5-Credit bei Ties) |
| PICP 95 % | Anteil der Outcomes im 95 %-Intervalle; nominal 95 %, Zielband 90–98 % |
| MASE | Mean Absolute Scaled Error gegenüber saisonaler Naive (< 1 = besser) |
| Pinball τ | Quantil-Verlust; τ = 0,75 bestraft Unterschätzung (Warten in eine Erhöhung) 3× stärker |
| PAVA | Pool Adjacent Violators — isotone Regression (L2-Projektion) |
| EW | Exponentiell gewichtet (Halbwertszeit-basiert) |
| M7 | Produktfreigabe-Gate auf abgerechneten echten Advice (Brier/Reliability, n ≥ 100 je Kohorte) |
| H3 | Schwellen-Regulator (Namen der Befundserie, nicht ein Modell) |
| A21-B* | Befund-/Batch-Serie des NAS-/Pi-Audits (20.09.2026); B1.4 = Freigabekette, B2 = Selbstmessung, B4 = Zeitblöcke/Restfenster, B5 = Kohorten/Missingness/Replay/Betriebsabnahme |
| O* (O1…O45) | Befundserien der GUI/Tiefenanalysen (z. B. O45 = Ersparnis-Basis, O37 = Server-Metrik, O40 = Diagramm-Textalternativen) |
| N* (N1, N2, N3) | Befunde der Runde 2 (23.09.2026): Labor-Payload, Demo-Vertrag, Versionsstempel |
| A1–A8, B1–B3 | Befunde der Runde 1 (23.09.2026): GUI-Logik / GUI-Texte |
| F1–F13 | Befunde der Runde 3 (23.09.2026): Labor-Karten, Spielplatz, PIT, Güte |
| B0 | Messgrundlagen-Batch (Audit-Felder, bitgleiche Invaranz-Fixture) |
| B2/B3 | PIT-Rekalibrierung / Day-Pair-Blöcke (Engine-Batches) |
| O9/O21/O45 | Eine ökonomische Quelle für Umweg / gleiche Einheiten im Score-Verhältnis / ct/L und € aus derselben Ersparnis-Basis |
| δ̂ | Preis-Abstand der Station zur Umgebung (Leave-One-Out-Median + EW-Median + CUSUM) |
| Ratchet | Test, der einmal korrigiertes Verhalten für immer arretiert |

### 11.4 Verweisliste

**Normativ (Prüfgrundlage):**
[Concept](../produkt/KONZEPT.md) · [UI](../produkt/UI.md) ·
[Microcopy](../produkt/MICROCOPY.md) · [GUI-Vorlagen](../produkt/GUI-VORLAGEN.md) ·
[Architektur](../architektur/ARCHITEKTUR.md) · [ADRs](../adr/README.md) ·
[Engine](../referenz/ENGINE.md) · [Analyse](../referenz/ANALYSE.md) ·
[API](../referenz/API.md) · [Replay](../referenz/REPLAY.md) ·
[Missingness](../referenz/MISSINGNESS.md) · [Datenwerkzeuge](../referenz/DATENWERKZEUGE.md) ·
[Installation](../betrieb/INSTALL.md) · [Betrieb](../betrieb/BETRIEB.md) ·
[Betriebsabnahme](../betrieb/BETRIEBSABNAHME.md) · [RP2](../betrieb/RP2.md) ·
[Qualität](../entwicklung/QUALITAET.md) · [Prüfstände](../entwicklung/PRUEFSTAENDE.md) ·
[Dokumentationspflege](../entwicklung/DOKUMENTATION.md) ·
[Projektstand](../planung/LUECKEN.md) · [TODO](../planung/TODO.md)

**Historische Belege (Stichtagsberichte, nicht für heute gültig):**
[Gutachten 10.09.2026](../archiv/GUTACHTEN-2026-09-10.md) ·
[Befund GUI/Texte/Statistik 23.09.2026](../archiv/BEFUND-GUI-TEXTE-STATISTIK-2026-09-23.md) ·
[Befund R2 23.09.2026](../archiv/BEFUND-GUI-MATHE-R2-2026-09-23.md) ·
[Befund R3 23.09.2026](../archiv/BEFUND-PARAMETERSCHRANK-R3-2026-09-23.md) ·
[NAS-/Pi-Befund 20.09.2026](../archiv/BEFUND-TANKAPP-NAS-PI-2026-09-20.md) ·
[Archiv-Index](../archiv/README.md) · [Release-Historie](../releases/CHANGELOG.md)

**Technik (Root und CI):**
[README](../../README.md) · [CONTRIBUTING](../../CONTRIBUTING.md) ·
[AGENTS](../../AGENTS.md) · [tests.yml](../../.github/workflows/tests.yml) ·
[quality.yml](../../.github/workflows/quality.yml)
