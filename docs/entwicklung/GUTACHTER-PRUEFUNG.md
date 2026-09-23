# Gutachter-Prüfung — Robustheit von Texten, GUI und statistischem Modell

> Stand: 23.09.2026 · App-Version **0.68.1** · Repository-Commit `69bff95` (`main`)
>
> Dieses Dokument ist die **selbstständige Prüfgrundlage** für eine externe
> Gutachterprüfung. Es ist bewusst als eine Datei geschrieben: Alle
> behaupteten Regeln, Muster, Parameter, Schwellen, Testnamen und
> Messergebnisse stehen hier vollständig — es verweist nicht auf andere
> Dateien, um Inhalt nachzuschlagen. Wo Code- oder Testdateien benannt
> werden, dient das allein der Ortung im Repository (Abschnitt 4 und die
> Prüflisten); die fachliche Norm selbst steht hier im Volltext.
>
> Geprüft wird die Robustheit von drei Bereichen der TankApp:
> (1) den Nutzertexten, (2) der GUI, (3) dem statistischen Modell.

## Inhaltsverzeichnis

- [1. Zweck und Prüfumfang](#1-zweck-und-prüfumfang)
- [2. Systemüberblick](#2-systemüberblick)
- [3. Die drei Prüffelder: Behauptung, Grundlage, Beleg](#3-die-drei-prüffelder-behauptung-grundlage-beleg)
- [4. Reproduzierbares Prüfverfahren](#4-reproduzierbares-prüfverfahren)
- [5. Prüffeld 1 — Nutzertexte (Regelwerk im Volltext)](#5-prüffeld-1--nutzertexte-regelwerk-im-volltext)
- [6. Prüffeld 2 — GUI](#6-prüffeld-2--gui)
- [7. Prüffeld 3 — Statistisches Modell](#7-prüffeld-3--statistisches-modell)
- [8. Testsituation: Was bereits arretiert ist](#8-testsituation-was-bereits-arretiert-ist)
- [9. Ehrliche Grenzen: Was die grüne Suite nicht beweist](#9-ehrliche-grenzen-was-die-grüne-suite-nicht-beweist)
- [10. Befundprotokoll für den Gutachter](#10-befundprotokoll-für-den-gutachter)
- [11. Anhang: Parameter, Schwellen, Abkürzungen](#11-anhang-parameter-schwellen-abkürzungen)

## 1. Zweck und Prüfumfang

### 1.1 Die drei Robustheitsbehauptungen

Die Prüfung soll bestätigen, dass die TankApp in drei Bereichen robust ist:

| Prüffeld | Behauptung (zu prüfen) | Norm (steht in diesem Dokument) |
|---|---|---|
| **Texte** | Jede dem Nutzer sichtbare Zeile (Web-GUI, Fallback-GUI, Fehlertexte, Push-Texte) folgt einem einzigen Regelwerk, enthält keine erfundenen Zahlen, keine falschen Einheiten und keine internen Pfade — und das Regelwerk steht im Code, nicht nur in der Doku | Volltext des Text-Regelwerks: [Kapitel 5.2](#52-das-text-regelwerk-im-volltext) |
| **GUI** | Die Oberfläche ist in allen Daten- und Fehlerzuständen (leer, lädt, veraltet, Fehler, offline, nicht entscheidungsbereit) auf allen Zielbreiten (320/390/1440 px) und über Tastatur/Screenreader robust, ohne Layoutbrüche und innerhalb definierter Performance-Budgets | GUI-Regeln, Zustände, Zusagen und Budgets: [Kapitel 6](#6-prüffeld-2--gui) |
| **Statistisches Modell** | Die Modellkette (Aufbereitung → Fit → Backtest → Veröffentlichung → Entscheidung) ist selbstkonsistent und ehrlich: Kalibrierung nur dort, wo sie auf Out-of-sample-Evidenz steht; keine Handlung ohne vollständige Evidenzkette (fail-closed); Prognose- und Backtestpfad identisch; jede Zahlenänderung gegen Invaranz-Fixtures arretiert | Methodik, Gates, Kalibrierung und Freigabekette: [Kapitel 7](#7-prüffeld-3--statistisches-modell) |

### 1.2 Was ausdrücklich nicht geprüft wird

Folgende Nachweise sind **bewusst außerhalb** dieses Prüfumfangs und in der
App als ausstehend geführt. Sie dürfen nicht aus grünen Tests abgeleitet
werden (Volltext: [Kapitel 9](#9-ehrliche-grenzen-was-die-grüne-suite-nicht-beweist)):

- **Betriebsabnahme auf Zielhardware** (NAS im LAN): p95 ≤ 300 ms der
  Kern-Endpunkte im realen Betrieb, Pollkadenz, RPO/RTO. Messrezept und
  Messlatte stehen in diesem Dokument (Kapitel 9), der Messlauf nicht.
- **Modellgüte auf echtem Bestand**: Güte je Station/Horizont auf realen
  Daten, Produktfreigabe (M7-Gate) auf abgerechneten echten Empfehlungen
  (braucht Wochen/Monate Betrieb), Out-of-sample-Replay der
  *veröffentlichten* Kurve.
- **Saison-/Regime-Abnahme**: Erster Regel-Winter nach der 12-Uhr-Regel,
  Rechtslage-Veränderungen.
- **Öffentlicher Betrieb und Mehrbenutzersystem**: Die App ist für einen
  deutschsprachigen Haushalt im eigenen LAN konzipiert; öffentliche
  Bereitstellung ist kein freigegebener Betriebsmodus.

### 1.3 Die Arbeitsweise des Repos — warum der Gutachter so vorfindet, was er prüft

Das Repository arbeitet seit Monaten im Zyklus **Befund → Fix →
Arretierungs-Test → datierter Bericht im Archiv**. Für den Gutachter heißt
das: frühere Befunde (alle in den Kapiteln 5.5, 6.8, 7.5 zusammengefasst)
sind ein gültiger Ausgangspunkt, um die Arretierung zu prüfen — nicht als
Behauptung „alles behoben“, sondern als Prüfliste. Konkret:

- **Externe Zweitmeinung vom 10.09.2026 zur Statistik** (Gutachten mit
  Befunden F1/F2/F5 und Repo-Nachtrag, was übernommen wurde): F2 (bei
  B=200 Bootstrap-Ziehungen war das Signifikanz-Gate mit 11 Stationen
  mathematisch unlösbar) führte auf B=2000; F1 (Prozentanzeige) war im
  geprüften Code nicht reproduzierbar; F5 (Regime-Blindheit des Medians)
  wurde mit EW-Median und CUSUM-Bruchflag umgesetzt.
- **Interne Tiefenanalyse vom 23.09.2026 in drei Runden** (GUI-Logik,
  GUI-Texte, Mathe/Statistik): alle Befunde (Runde 1: A1–A8, B1–B3;
  Runde 2: N1–N3; Runde 3: F1–F13) sind bis App-Version 0.68.1 und PR #222
  (Commit `69bff95`) behoben und mit Tests arretiert.
- **NAS-/Pi-Prüfung vom 20.09.2026**: getrennte Zählung reproduzierter
  Integrationsfehler (im Code korrigiert) und offener Nachweise (stehen in
  Kapitel 9).

## 2. Systemüberblick

### 2.1 Geräte und Rollen

| Komponente | Rolle | Relevant für |
|---|---|---|
| Raspberry Pi (Collector) | Holt Tankerkönig-Preise (06:00–24:00 Uhr, gemeinsames Budget: 1 Request / 300 s je Stadtset, Round-Robin über mehrere Stadtsets), RAM-Ringpuffer, Upload mit Ack und Wiederholung; optional NAS-Proxy mit lesender Fallback-GUI (Port 8000) | Datenquelle, Fallback-Texte |
| NAS | Archiv, InfluxDB, Aufbereitung, Modell-Fits, Backtests, Decision Layer, API und Web-GUI (Port 1355); persönliche Belege und Jobzustände in `runtime/` | Alle drei Prüffelder |
| Browser (PC/Handy) | React-GUI, PWA mit Service-Worker, Offline-Queue (IndexedDB); der PC ist kein notwendiger Dauerdienst | Texte, GUI |
| RP2-Fallback | Eigene, **lesende** Betriebsoberfläche am Pi; kein Decision Layer, keine Aktionsfreigabe | Texte (feste Muster) |

Preisdaten stammen von MTS-K über Tankerkönig (Lizenz CC BY 4.0). Schlüssel,
private Konfiguration, Rohdaten und Modelle liegen außerhalb des Repos.

### 2.2 Daten- und Entscheidungspfad

```text
Tankerkönig (CC BY 4.0)
  → Collector (Pi, 06–24 Uhr, 1 Request/300 s je Stadtset)
  → JSONL-RAM-Puffer → Upload (Ack + Wiederholung)
  → NAS: InfluxDB (Live) + Tankerkönig-Archiv (getrennt, archival)
  → Aufbereitung (app/history.py: rohe Änderungsereignisse, exakte, offsetbehaftete Zeitstempel, Änderungsflags, Löschsperren)
  → Modell-Fit (engine/: Strukturmodell + AR(2) + 12-Uhr-Projektion + Bootstrap)
  → atomare Veröffentlichung (app/refresh.py)
  → Decision Layer (app/decide.py + app/thresholds.py + Gates)
  → API /api/v1 → Web-GUI (web/) und RP2-Fallback (rp2/)
```

Der NAS-Roharchiv-Sync läuft unabhängig vom Modell-Fenster weiter (auch über
ein Jahr hinaus); das Modell verwendet standardmäßig nur die letzten 42 Tage.

### 2.3 Drei getrennte Beweisebenen

Drei Ebenen werden in der App **nicht** zu einer Kennzahl zusammengerechnet:

1. **Markt-Labor** — Preisreihe und Rolling-Origin-Backtest: wie eine Regel
   auf dem Markt abgeschnitten hätte.
2. **Live-Advice** — gespeicherte und gegen Preise abgerechnete
   Empfehlungen: Brier, Trefferquote und Regret der ausgegebenen Advice.
3. **Wallet** — tatsächliche Tankbelege: persönliche Bilanz und Befolgung.

Ein Intent („Ich warte“) ist kein Tankbeleg. Ein erfolgreicher
Advice-Snapshot ist kein Nachweis persönlicher Ersparnis. Belegdaten dürfen
nicht die Güte des Marktmodells vortäuschen.

### 2.4 Die drei Produktfragen

| Frage | Bedeutung | Entscheidung |
|---|---|---|
| **F1: Jetzt oder warten?** | Tankzeitpunkt, Fenster, finanzieller Unterschied | `refuel_now` / `wait` / `no_advice` |
| **F2: Hier oder woanders?** | Vorteil nach zusätzlichem Sprit- und Zeitaufwand | `refuel_elsewhere` (netto, nach Umwegkosten) |
| **F3: Heute oder später?** | Veröffentlichte Fenster bis zum notwendigen Tankzeitpunkt | Fensterliste mit Vorlauf |

Die Darstellungsreihenfolge ist **Antwort → Begründung → Beweis**: zuerst
eine klare Aussage mit handlungsrelevanten Zahlen, dann Datenalter, Quelle,
Bedingungen und relevante Unsicherheit, dann der gezielte Sprung in Labor,
Diagramm oder Rohdaten.

### 2.5 Ehrlichkeits-Regel und Freigabekette

Ohne Daten: Einrichtung oder ein begründeter Leerzustand, keine Demo-Preise.
Ohne belastbare Kalibrierung: keine als sicher verkaufte Empfehlung.
Beobachtete Preise, geschätzte Preise und persönliche Belege sind getrennte
Quellen; Alter, Unsicherheit und fehlende Daten werden sichtbar benannt.
Softwaretests ersetzen weder echte Messungen noch Betriebsabnahmen.

Die technische Größe `forecast.calibrated` bezeichnet **nur** die technische
24-h-PIT-Kalibrierung. Eine Produktfreigabe (`decision_ready`) erfordert
zusätzlich:

1. das **M7-Ledger-Gate** auf abgerechneten echten Advice-Snapshots
   (Kapitel 7.2.5), und
2. die vollständige **Evidenzkette** — jedes Glied muss aktuell intakt sein:
   - **frischer Preis**: Preis ohne frischen Nachweis bleibt gesperrt
     (`price_stale`); ein `last_price`-Fallback darf eine Preisspanne
     zeigen, aber keine Aktion begründen,
   - **offene Station** (geschlossene Stationen sind `station_unusable`),
   - **frische Herkunft** (Provenienz der Prognose),
   - **gültiger Prognosezeitraum**: höchstens 24 h altes Modell mit
     Zukunfts-Punkten,
   - **vollständige endliche Pfade** (keine `null`/`nan` in den
     entscheidungsrelevanten Pfaden),
   - **veröffentlichte Güte** (mindestens 3 Tage).

Jedes gebrochene Glied steht maschinenlesbar als `blocking_reasons` im
API-Vertrag. Ohne die erforderliche Evidenz bleibt `decision_ready = false`
— die App zeigt trotzdem aktuelle Preise und nennt den Sperrgrund, statt
eine Empfehlung zu erfinden. Eine freigegebene Handlung ist befristet
(`valid_until`); ein Cache darf abgelaufene Aktionen nicht erneut zeigen.

## 3. Die drei Prüffelder: Behauptung, Grundlage, Beleg

| Prüffeld | Norm (Kapitel in diesem Dokument) | Automatischer Beleg (Tests, Kapitel 8) |
|---|---|---|
| Texte | Kapitel 5.2 (Regelwerk im Volltext: Tonfall, Typografie, Zahlen/Einheiten, Benennungen, Fallback-Muster, Push-Regeln, Zustände, Verbote) | Web: `microcopy.test.ts`, `format-convention.test.ts`, `a11y.test.ts`, `chartAlt.test.ts`, `fills.test.ts`, `Notices.test.ts`, `states.test.tsx`; Python: `test_rp2_fallback.py`, `test_notify.py`, `test_o29_window_push.py`, `test_glossary.py` |
| GUI | Kapitel 6 (Navigation, Bereiche, Zustandsrobustheit, Barrierefreiheit, Browser-Suiten, Performance-Budgets) | Browser: E2E mit Mocks + E2E ohne Mocks gegen den Demo-Stack (Desktop 1440, Mobil 390, Schmal 320 px); Python: `test_e2e_demo.py`, `test_quality_gates.py`, `test_o37_server_metrics.py`, `test_a21_b2_latency.py`; Qualität: Lighthouse- und Last-Gates |
| Statistisches Modell | Kapitel 7 (Aufbereitung, Strukturmodell, AR(2), 12-Uhr-Regel, Bootstrap, Backtest-Gates, PIT-Kalibrierung, M7-Gate, Freigabekette, Invaranz-Fixtures) | Python: `test_b0_invariance.py`, `test_b2_calibration.py`, `test_b3_daypair.py`, `test_a11_shared_draws.py`, `test_a10_ensemble.py`, `test_backtest.py`, `test_bootstrap.py`, `test_models.py`, `test_pside.py`, `test_probabilities.py`, `test_o21_score_parity.py`, `test_a21_b4_contracts.py`, `test_a21_b5_gate_context.py`, `test_a21_b5_replay.py`; Fixtures: `tests/fixtures/b0_invariance.json`, `tests/fixtures/score_parity.json` |

## 4. Reproduzierbares Prüfverfahren

### 4.1 Umgebung

| Voraussetzung | Wert | Hinweis |
|---|---|---|
| Python | 3.11 oder 3.12 | 3.12 ist die Linie des NAS-Images, 3.11 die des Pi-Collectors; die CI testet beide, damit „grün getestet“ und „ausgeliefert“ dasselbe Interpreter-Linie sind |
| Node.js | 22 | identisch mit dem NAS-Image |
| Repository-Stand | Commit `69bff958fcb9d26fed0e4f8dc453bd193cf1fae2` von `main` | der Stand, auf dem alle Ergebnisse dieses Dokuments gemessen sind |
| Netz | npm-Registry erreichbar | für `npm ci` und Playwright-Chromium (Ausnahme unten) |

Aufbau:

```bash
git clone https://github.com/kollb/TankApp.git && cd TankApp
git checkout 69bff958fcb9d26fed0e4f8dc453bd193cf1fae2

python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt

npm --prefix web ci
npx --prefix web playwright install chromium
```

**Abgeschottete Umgebungen** (der Playwright-Browser-Download ist nicht
erreichbar): Die Browser-Suite läuft auch mit einem Chromium, das aus der
npm-Registry-Paket `@sparticuz/chromium` entpackt wird (zusätzlich
NSS/NSPR-Bibliotheken aus dem selben Paket entpacken und `LD_LIBRARY_PATH`
setzen). Die Playwright-Konfiguration liest die Umgebungsvariablen
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` und `LD_LIBRARY_PATH`; diese Variante ist
am 23.09.2026 gegen beide Browser-Suiten grün gelaufen.

### 4.2 Der vollständige Prüfspiegel (CI-Spiegel)

Die definierte Prüfsequenz — dieselbe Reihenfolge und Kommandozeile wie in
der CI:

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
| `npm --prefix web run test:e2e` (Browser mit Mocks, Desktop 1440 + Mobil 390 px) | **38 bestanden** (~36 s) |
| `npm --prefix web run test:e2e:demo` (Browser ohne Mocks gegen den Demo-Stack) | **52 bestanden, 17 übersprungen** (Desktop 1440, Mobil 390, Schmal 320 px; Übersprünge = mobil-spezifische Zusagen, die im Desktop-Projekt bewusst skippen; ~2 min inkl. Demo-Aufbau mit echten Engine-Fits) |

Abweichende Zahlen bei identischem Commit sind ein Befund (Umfeld,
Paketversionen) — nicht still hinnehmen, sondern im
[Befundprotokoll](#10-befundprotokoll-für-den-gutachter) mit Umgebungsstand
melden.

### 4.3 Was die CI zusätzlich prüft

- **Engine-Job auf Python 3.11 und 3.12**: getesteter Interpreter muss
  ausgeliefertem entsprechen (das NAS-Image läuft auf 3.12, der Pi-Collector
  auf 3.11).
- **Suite im NAS-Docker-Image**: Das tatsächlich ausgelieferte
  Docker-Image führt dieselbe Python-Testsuite aus — „getestet wird, was
  läuft“, nicht nur ein CI-Runner. Der Build vergibt den Commit-Hash ins
  Image, damit `/api/v1/health` den eigenen Stand benennen kann.
- **Qualitäts-Workflow** (Lighthouse + Lastpfad, eigener Workflow): läuft
  auf jede Änderung, die `web/`, `app/`, `engine/` oder die
  Qualitäts-Demo-Aufbauten betrifft, und zusätzlich sonntags 04:17 UTC.
  Budgets und Messwerte: [Kapitel 6.6](#66-performance--und-qualitätsgates).

### 4.4 Demo-Stack für die manuelle Prüfung

Der Demo-Stack startet die **echte** App (`app.server.make_server`) mit
injizierter Preisabfrage statt InfluxDB und einer echten Engine-Publikation
aus einem realen Fit (sechs Demo-Stationen, fester Daten-Samen, kein
Netzwerk, keine echten Preise):

```bash
.venv/bin/python ops/quality/demo_server.py --data-dir /tmp/tankapp-demo \
    --static web/dist --port 1355 --host 0.0.0.0
```

Danach: `http://<host>:1355` im Browser. Erwartet: Bereich „Jetzt“ mit
Empfehlung, drei Fakten, „Heute im Blick“ (19 Stunden-Zellen, Berliner
Zeit), Frische-Fußzeile; „Stationen“ mit Atlas, Karte und Vergleich;
„Woche“ mit veröffentlichten Fenstern; „Labor“ mit acht gefüllten
Parameterkarten, PIT-Kachel und Tagebuch; „System“ mit vier Bausteinen und
Diagnose-Export (JSON ohne Tokens).

Zusätzliche API-Proben (jederzeit, kein Browser nötig):

```bash
curl -sD - -o /dev/null http://127.0.0.1:1355/api/v1/health | grep -iE "x-process-time|server-timing|x-request-id"
curl -s http://127.0.0.1:1355/api/v1/health | python3 -m json.tool | grep -E '"version"|"commit"|"performance"|"publication"'
ETAG=$(curl -sD - -o /dev/null http://127.0.0.1:1355/api/v1/overview | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')
curl -s -o /dev/null -w "%{http_code}\n" -H "If-None-Match: $ETAG" http://127.0.0.1:1355/api/v1/overview   # erwartet: 304
curl -s http://127.0.0.1:1355/api/v1/forecast | python3 -c "import json,sys; d=json.load(sys.stdin); print(sorted(d.keys()))"
```

Erwartet: Header `X-Process-Time`, `Server-Timing` (benannte Spans, `idle`
außerhalb `total`) und `X-Request-ID` in jeder Antwort; `version 0.68.1`
mit Commit-Hash im Health-Payload; ETag-Revalidierung antwortet **304**;
der Forecast-Payload trägt die Modell-Parameterfelder (`beta`, `ar_phi`,
`ar_detail`, `pava_pool_stats`, `pit`, `ensemble`, `bootstrap_samples`,
`law_*`) — der Payload-Vertrag der acht Labor-Karten.

### 4.5 Was „bestanden“ heißt: Abnahmekriterien

Ein Prüffeld gilt für den Gutachter als **verifiziert**, wenn:

1. **Konsistenz:** Die in diesem Dokument übernommene Norm und der Code
   weisen denselben Wert/dieselbe Regel aus (Schwellen, Muster,
   Feldnamen) — eine Abweichung ist ein Befund. Die Prüflisten in
   Kapitel 5–7 nennen je Feld die zu abzugleichenden Paare.
2. **Automatik:** Der komplette Prüfspiegel (Kapitel 4.2) ist am geprüften
   Commit grün, und die genannten Arretierungs-Tests (Ratchets,
   Invaranz-Fixtures, Paritäts-Fixtures) sind Teil dieser Suite.
3. **Manueller Walkthrough:** Die Prüflisten in Kapitel 5–7 zeigen keine
   Abweichung vom jeweiligen Regelwerk.
4. **Ehrlichkeit:** Die Grenzen aus [Kapitel 9](#9-ehrliche-grenzen-was-die-grüne-suite-nicht-beweist)
   sind in der App sichtbar benannt (fail-closed-Zustände, Sperrgründe,
   „nicht messbar“) — die App verkauft nichts als belegt, was nur
   synthetisch geprüft ist.

## 5. Prüffeld 1 — Nutzertexte (Regelwerk im Volltext)

### 5.1 Was „robust“ hier bedeutet

Robustheit der Texte heißt: (a) ein Text folgt **dem** Regelwerk — nicht je
Panel neu erfunden; (b) jede Zahl im Text kommt aus einer belegbaren Quelle
und läuft durch dieselben Formatter wie die Darstellung; (c) fehlende Daten
erzeugen keine Zahlen (Leerzeichen, Begründung, niemals Demo-Werte);
(d) Fehler- und Erfolgsmeldungen tragen den richtigen Ton und die richtige
ARIA-Rolle; (e) das Regelwerk und der Code können nicht ohne Test-Schaden
auseinanderlaufen (Ratchet).

Das Regelwerk gilt für jede dem Nutzer sichtbare Zeile: Web-GUI
(`web/src/**`), Fallback-GUI (`rp2/fallback_gui.py`), Fehlertexte
(`app/**`), Push-Texte (`app/notify.py`) und jede neue Textzeile.

### 5.2 Das Text-Regelwerk im Volltext

#### 5.2.1 Tonfall

**Ehrlich, knapp, handlungsleitend** — in dieser Reihenfolge.

| Regel | Ja | Nein |
|---|---|---|
| Handlung zuerst, Begründung danach | „Jetzt tanken — 4 ct unter Tagesmedian.“ | „Der Tagesmedian liegt über dem aktuellen Preis, daher …“ |
| Keine Sicherheit behaupten, die nicht gemessen ist | „Noch nicht kalibriert — bis dahin zählen nur aktuelle Preise.“ | „82 % sicher“ vor der Abnahme |
| Kein Tadel an den Nutzer | „Getankte Liter außerhalb 5–100 L.“ | „Ungültige Eingabe!“ |
| Deutsch als Primärlabel, Fachwort im Tooltip | „Günstig-Chance“, `title="Fachwort: Cheap-Probability"` | „Cheap-Probability“ als sichtbares Label |
| Kein Ausrufezeichen, kein Emoji im Fließtext | „Collector meldet seit 2 Stunden nichts.“ | „Achtung!! ⚠️“ |
| Kein `✓`/`!`-Präfix — der Ton steht im Icon und in der Farbe | Banner rose mit Warnzeichen: „Speichern fehlgeschlagen: …“ | grünes Häkchen vor „! Speichern fehlgeschlagen“ |
| Zustände benennen, nicht bewerten | „Noch kein Lauf“ | „Leider noch nichts da“ |
| Possessiv erlaubt, direkte Anrede und Imperativ nicht | „Beleg in deiner Bilanz verbucht.“ · „Wer vor 18:00 Uhr tanken muss, …“ | „Du hast deinen Beleg gespeichert.“ · „Fahr nur hin, wenn …“ |
| Fragen nur im Fällig-Prompt | „Gerade getankt?“ (Fenster vorbei) | „Hast du getankt?“ als Dauertext |

Anrede: „Sie“/„Du“ als Anrede bleibt draußen; der Possessiv („deine
Bilanz“) ist die etablierte Form und bleibt. Fragen stehen nur dort, wo die
App auf ein Ereignis antwortet (Fällig-Prompt, Erfassungs-Formular) —
sonst Aussagesatz. Fehler sind keine Erfolge: Jede Rückmeldung einer
Aktion trägt ihren Ton — `ok` (grün, `role="status"`), `warn` (amber,
`role="status"`), `error` (rose, `role="alert"`); Einschübe schreibt die
App durchgehend mit „—“.

#### 5.2.2 Anführungszeichen und Sonderzeichen

| Zeichen | Verwendung | Beispiel |
|---|---|---|
| `„…“` | **jedes** Zitat, jeder zitierte Label- oder Job-Name im Fließtext | Job „Modell-Update“ starten |
| `'…'` / `"…"` | nie in Nutzertext (nur im Code) | — |
| `—` (Geviertstrich, mit Leerzeichen) | Einschub, Gegenüberstellung | „Warten — 3 ct Ersparnis erwartet“ |
| `–` (Halbgeviertstrich) | Bereiche ohne Wortpaar | „18–20 Uhr“, „5–100 L“ |
| `×` | Malzeichen | „1,015 × E10-Preis“ |
| `…` (ein Zeichen) | Auslassung, Ladezustand | „Läuft …“ |
| `·` | Trenner zwischen gleichrangigen Angaben | „12.345 Preise · 18 Stationen“ |
| `≤ ≥ ≈ ±` | mit geschütztem Sinn, immer mit Leerzeichen | „≤ 5 Sekunden“ |

**Kein Zeichen als Textersatz:** `✓`, `✗`, `✎`, `✕`, `★`, `▼`, `●` stehen
nie als Bedeutungsträger (ein Screenreader liest sie als „Häkchen“,
„Stern“). Das **Wort** steht im Text („richtig“, „daneben“,
„unentschieden“, „Jetzt tanken“, „Warten“, „Woanders tanken“); tragende
Zeichen sind durch Icons ersetzt, die dekorativ bleiben (`aria-hidden`).
Erlaubt bleiben Formel- und Fließzeichen (`→` als Richtung, `·`, `—`, `–`,
`×`, `…`). Typografische Zeichen stehen direkt im Quelltext (UTF-8), keine
HTML-Entities.

#### 5.2.3 Zahlen, Einheiten, Zeiten

Formatiert wird **ausschließlich** über die Funktionen in `web/src/data.ts`;
`toFixed` in Anzeigen ist verboten (wird als Ratchet gemeldet).

| Größe | Funktion | Darstellung |
|---|---|---|
| Preis je Liter | `euroPerLiter` | `1,749 €/L` (3 Nachkommastellen) |
| Preis**differenz** je Liter | `centPerLiter` | `4,2 ct/L` (1 Nachkommastelle) |
| Geldbetrag gesamt | `euro` | `62,45` (2 Nachkommastellen) + „€“ im Label |
| Prozent | `percentLabel` | `93 %` (Leerzeichen vor „%“) |
| Strecke | `kilometersLabel` | `12 km` · `2,4 km` (eine Nachkommastelle nur beim Umweg) |
| Tempo | `kilometersPerHour` | `50 km/h` (Langform nur als Screenreader-Text) |
| Zeitraum (Rückblick) | `timeSpanLabel` | `24 Stunden` · `3 Tage` · `7 Tage` |
| Horizont (Blick nach vorn) | — | `+3 Tage` · `+7 Tage` — das „+“ unterscheidet Prognose vom Rückblick |
| Zeitwert | `euroPerHour` | `16 €/h` |
| Schwelle/Maßzahl ohne Einheit | `deNumber` | `0,80` (Komma, nie `0.80`) |
| Stückzahl | `countLabel` | `12.345` |
| Stundenbereich | `hourRangeLabel` | `18–20 Uhr` |
| Zeitpunkt | `timeLabel` / `epochLabel` | `12.09., 08:00` |

**Zwei Größen, zwei Spannen:** *Tankmenge* ist die Rechengröße aus Profil
und „Jetzt“ — **10–100 L**, ganze Liter, Schritt 1. *Getankte Liter* ist der
gebuchte Vorgang im Beleg — **5–100 L**, Schritt 0,5. Beide tragen die
Einheit `L`, niemals ausgeschrieben „Liter“ neben einer Zahl. Wird eine
Eingabe gerundet, zeigt das Feld den gerundeten Wert zurück, statt still zu
runden.

**Regel ct/L vs. €/L:** *Niveaus* stehen in €/L, *Unterschiede* in ct/L.
Ein Panel mischt beides nur, wenn es Niveau **und** Differenz zeigt — dann
steht das Niveau zuerst. Beispiel: „1,749 €/L · 4,2 ct/L unter
Tagesmedian“.

**Herkunft einer Uhrzeit:** Die App nennt eine Uhrzeit nur, wenn sie einen
Beleg dafür hat. Fehlt dem Beleg der Zeitstempel, ist seine Stunde die
erfundene 12-Uhr-Projektion der Engine — und der Satz sagt das („1 Beleg
ohne Zeitstempel zählt als 12 Uhr.“). Nie stillschweigend als eigene
Tankzeit ausgeben, nie „Standardzeit“ oder „Default“ schreiben.

**Zeitzone:** Jede angezeigte Uhrzeit ist Europe/Berlin, auch wenn die API
UTC liefert. Dezimaltrennzeichen ist immer das Komma (`de-DE`),
Tausendertrennzeichen der Punkt; Eingabefelder akzeptieren beides, zeigen
aber Komma.

#### 5.2.4 Benennungen (verbindlich)

| Gemeint | Wort in der App |
|---|---|
| die Bereiche der App | **Jetzt** (Einstieg), **Stationen**, **Woche**, **Ich**, **Labor**, **System** (und **Glossar**) — nicht „Statistik“, nicht „Prüfstand“ |
| eine Tankstelle | **Station** |
| ein gebuchter Tankvorgang | **Beleg** — nicht „Fill“, „Buchung“, „Füllung“, „Tankbeleg“ (auch nicht als Überschrift) |
| die Rechengröße für Tankvolumen | **Tankmenge** (10–100 L); im Beleg heißt dieselbe Spalte **Liter** (5–100 L) |
| der Preis-Vorteil | **Ersparnis** — Betrag **ohne** Vorzeichen, die Richtung steht im Wort: „1,60 € günstiger“, „0,80 € teurer“ |
| das Alter eines Standes | über `ageLabel`/`ageWord`: „vor 12 Minuten“ — nie „vor 12 Min.“ |
| δ̂ | **Preis-Abstand** (nicht „Hauspreis-Abstand“) |
| Regret | **Mehrkosten zum perfekten Timing** (nicht „Entscheidungsverlust“) |
| Orakel-Bestwert | **Perfektes Timing (Orakel)** |
| Heatmap-Modus Anteil | **Günstig-Chance** (Fachwort „Cheap-Probability“ nur im Tooltip) |
| Tageszeit des Zeitwerts | **Stoßzeit** / **Nebenzeit** (nicht „Peak“/„offpeak“) |
| Gesamtfarbe des Systems | **Alles ok** · **Hinweise** · **Störungen** · **Unbekannt** — nicht „OK“ |
| Kennzahlen des Engine-Laufs | **Kennzahlen der Engine** / **Schwellen der Engine** — „Statistik“ ist ausgemustert |
| der Nachrechnungs-Lauf | **Backtest** — „Prüfstand“ ist ausgemustert |
| Rückweg aus dem Labor | Knopf **Zurück** + Zeile `Zurück zu: <Bereich> · <Anlass>` — nie „Zurück zum Alltag“ |
| Nachschlage-Seite | **Glossar** |
| Tankstand zurücknehmen | **Keine Angabe** — in „Jetzt“ wie in „Woche“ |
| Prognoselauf auf dem NAS | **Modell-Update** |
| Preisdaten-Abholung auf dem Pi | **Collector** |
| Zeitfenster mit günstigem Preis | **Fenster** |
| Ampel-Aussage | **Empfehlung** (nicht „Signal“) |

Fachbegriffe (δ̂, MASE, PICP, Brier, ε, Regret) bleiben der Werkstatt
(Labor) vorbehalten und stehen dort im Tooltip hinter einem deutschen
Label. Der Alltag kommt ohne sie aus. „Set“ ist Betriebssprache: Auf den
Alltagsschirmen (Jetzt, Stationen, Ich) steht statt „Spanne im Set“
**„Günstigste bis teuerste“**, statt „Keine Station im Set“
**„Noch keine Station eingerichtet“**.

#### 5.2.5 Fallback-GUI: feste Muster

Die Fallback-GUI am Pi (versionierter Marker `tankapp-fallback-gui v5.0`)
trägt **feste** Muster — nicht neu formulieren, nur wiederverwenden:

| Stelle | Muster |
|---|---|
| Preisvergleich | `Aktueller Preisvergleich` bzw. `Preis-Momentaufnahme — gewählter Preis veraltet`; nie Tank-/Warteaktion |
| Ohne Aktionsfreigabe | `Nur Preisvergleich — Tank- und Warteentscheidungen benötigen die geprüfte NAS-Entscheidung und das persönliche Profil.` |
| Antwort-Karte leer | `Noch kein frischer Preis.` + „Der Status oben zeigt, wo es hängt“ |
| Kicker der Antwort-Karte | `<KRAFTSTOFF> · <ORT | ALLE ORTE> · STAND <HH:MM> UHR` |
| Fenster | `Keine Fensterentscheidung` · `Prognosedaten stehen in der Werkstatt; Entscheidungen bleiben beim NAS.` |
| F2-Chip | `„Hier oder woanders“: 2. = <Station> · <Preis> €/L` |
| Tagesstreifen-Caption | `Grün = unteres Preisdrittel dieses Tages an dieser Station, rot = oberes Drittel. Leere Stunden hatten keine offene Meldung — nichts wird erfunden.` |
| Tagesstreifen leer | `Heute liegt noch keine offene Meldung für <KRAFTSTOFF> an dieser Station vor — das Polling-Fenster ist 06–24 Uhr.` |
| Kraftstoff fehlt an der Station | `<Kraftstoff> nicht geführt` (grau, kursiv; nicht „nicht verfügbar“) |
| Station ohne offene Meldung | `geschlossen` bzw. `keine Preise` — der API-Code steht nur im `title` der Werkstatt-Zeile |
| Abstand zur günstigsten | Delta-Chip `beste` / `+<x> ct` (ct/L für Unterschiede, €/L für Niveaus) |
| Sortierung | Knöpfe `Preis` · `Nähe` · `Aktuell`, darunter `Sortierung wirkt auf die Liste, nicht auf den Preisvergleich.` |
| Ansicht | `Alltag` · `Werkstatt`; Datenstatus-Karte `Woher die Daten kommen` |
| Sticky-Chip | `Günstigste <Preis> €/L · <erste drei Wörter des Namens> …` |
| Cache-Qualität | `Gültige Prognosedaten — keine Fensterentscheidung` bzw. `Historischer Cache — Qualität oder Gültigkeit nicht bestätigt` |
| Ehrlichkeits-Zeile | `Quantile sind keine kalibrierte Wahrscheinlichkeit und keine erwartete Nettoersparnis.` |
| NAS-Prüfung | `NAS bereit — Ansicht öffnen` · `NAS kehrt zurück` · `NAS eingeschränkt` · `NAS offline`; kein automatischer Reload |
| Ladefehler | `Daten konnten nicht geladen werden (<HTTP-Code>) — die Anzeige bleibt stehen, der nächste Versuch läuft automatisch.` |
| Drei Fakten der Antwort-Karte | `Jetzt hier` · `Fensterentscheidung` · `Frische Preise` — in dieser Reihenfolge |
| Frische-Fußzeile | `Preise <4 min> alt · Prognose <35 min> alt` — `—` statt „gerade eben“, wenn ein Stand fehlt |
| Fakt ohne Fenster | `—` mit Grund `nur auf dem NAS` |

#### 5.2.6 Push-Texte: Alarme und Fenster-Meldungen

Push-Texte entstehen serverseitig (`app/notify.py`); gelten dieselben
Regeln wie für die GUI. Zwei Meldungsarten, zwei Datentiefen:

| Art | Inhalt | Wann |
|---|---|---|
| Alarm (`severity: error`) | nur Code, deutscher Klartext, App-Version — **nie** Preise, Stationen, Pfade | Zustandswechsel, Erinnerung nach 6 h, „wieder betriebsbereit“ |
| Fenster „offen“ | Modus `public`: neutraler Satz ohne Details · Modus `lan`: Station, Fensterzeit, erwarteter Preis | genau einmal je Episode beim Öffnen (Verteilungs-P ≥ Schwelle) |
| Fenster „geändert“ | dieselbe Regel wie „offen“ | Empfehlung kippt auf ein anderes Fenster |
| Fenster „verstrichen“ | neutraler Satz (`public`) bzw. Fensterzeit und Station (`lan`) | Fenster schließt ohne Beleg — nur, wenn es vorher gemeldet war |

Koordinaten, Pfade und Links stehen in **keinem** Modus. Die Ruhezeit
(22–7 Uhr, Europe/Berlin) gilt nur für Fenster-Meldungen; Alarme kommen
rund um die Uhr.

#### 5.2.7 Zustände: leer, lädt, Fehler — Wortlaut je Zustand

Ein Panel erfindet keinen eigenen Fehlertext: Klartexte stehen zentral in
`messages` in `web/src/data.ts`, je `error_code` genau einer.

| Zustand | Baustein/Regel | Wortlaut |
|---|---|---|
| lädt, Daten vom Server | `Skeleton*` mit `role="status"` + `aria-busy` (Label nur für Screenreader) | „<Sache> wird geladen“ — z. B. „Preise werden geladen“ |
| lädt, App rechnet selbst | dito | „<Sache> wird berechnet“ — z. B. „Empfehlung wird berechnet“ |
| lädt (Aktualisierung) | **nichts** | vorhandene Zahlen bleiben stehen — ein Poll darf die Ansicht nicht leeren |
| Knopf während des Schreibens | — | „<Sache> wird <Partizip>“ — z. B. „Beleg wird verbucht“ |
| Wiederholen (allgemein) | `LoadError`, `CellError` | `Erneut laden` |
| Wiederholen (Bereich nennt die Sache) | — | „<Sache> neu laden“ — z. B. „Tagebuch neu laden“ |
| Datenstand veraltet | `DataAge` (`dataAgeNote`) | nur wenn die Schwelle reißt (Preise 30 min, Modell 24 h = 1440 min, Selektion 36 h; doppelt = roter Ton); bei unbekanntem Stand: **kein** Banner |
| leer, weil noch nichts da | `Empty` | „Noch kein/e <Sache>.“ + was fehlt; kein Alarm-Ton, kein „Erneut laden“ |
| leer, weil bewusst nichts | `Empty` | Grund nennen, nicht entschuldigen: „Fehlende Tage, kein Datenverlust.“ |
| Fehler (Panel) | `LoadError` | `problem(error_code)` als Klartext, Rohcode darunter, Knopf „Erneut laden“ |
| Fehler (Tabelle) | `CellError` | gleiche Sprache als Tabellenzeile über volle Breite |
| keine Zahl bestimmbar | — | „—“ (Geviertstrich) — nie `0`, nie leer |
| Job abgebrochen | `JobCard` | „Der Lauf wurde abgebrochen (z. B. durch einen Container-Neustart). Letzte Ergebnisse bleiben erhalten.“ |
| Job unvollständig | `JobCard` | „Einige Stationen haben noch kein neues Modell. Vorige Ergebnisse sind gekennzeichnet.“ |
| Frische-Zeile | `FreshnessLine` | „Preise vor 4 Minuten · Prognose vor 35 Minuten · <Ort>“ (Alter in Worten über `ageLabel`) |
| Stand fehlt | — | „<Sache> ohne Stand“ — z. B. „Prognose ohne Stand“ |

**Meldungs-Regel (ein Register, ein Rang):** Ränge `error` > `warn` >
`hint` > `success`; höchste Rangstufe gewinnt, gleichrangige Meldungen
werden mit „ · “ aneinandergereiht (nie gestapelt), die gemeinsame Dauer
ist **6 s** — nur `error` bleibt stehen. Icons sind dekorativ
(`aria-hidden`), der Text trägt die Information.

**Ein Zustand, eine Zahl:** Wenn ein Text eine Automatik beschreibt, nennt
er den Wert **dieser** Automatik — nicht den gerade gerechneten. Ein
Hinweis, der einen nicht aktiven Zustand beschreibt, sagt das im
Konjunktiv („gerade wären das …“), statt ihn im Präsens zu behaupten.

#### 5.2.8 Tooltips

Ein `title=` erscheint nur mit Maus oder Tastaturfokus — auf dem Telefon
und für Screenreader-Nutzer:innen fällt er ganz weg. Deshalb: Die Erklärung
steht im sichtbaren Text; der Tooltip bleibt kurz (≤ 80 Zeichen, ein
Satzelement) und ergänzt nur; das Fachwort im Tooltip ist erlaubt
(`title="Fachwort: Peak"`); die Herkunft darf im Tooltip stehen
(`title="Quelle: /api/v1/fills.csv"`); ein deaktivierter Knopf sagt
sichtbar, warum.

#### 5.2.9 Was nie im Text steht

- **Erfundene Zahlen.** Keine Demo-Preise, keine Platzhalter-Prozentwerte,
  keine „ca.“-Werte ohne Rechnung dahinter.
- **Pfade, Tokens, URLs, Koordinaten.** Auch nicht in Alarm-Pushes.
  **Einzige Ausnahme:** der Bereich „System“ in seinen Einrichtungs- und
  Diagnose-Texten — dort braucht ein Betreiber Datei- und Endpunkt-Namen
  (z. B. `/sw.js`, `/api/v1`, `polling.json`). Ein Vorgang wird **einmal**
  beschrieben; Vergleiche mit früheren GUI-Ständen gehören in die Doku, nie
  in den Text.
- **Interne Ausnahmen:** Serverfehler werden zentral bereinigt, bevor sie
  irgendwo erscheinen.
- **Englische Hook-Zeilen** als Marketing. Registriert sind (und nur
  diese): „Dein Tank-Kompass. Ohne Rätselraten.“ (Kopfzeile) und
  „Keine Demo-Preise. Keine erfundene Sicherheit.“ (Fußzeile). Ein
  englisches Wort ohne deutsche Erklärung (etwa ein `LIVE`-Badge) steht
  nirgends.

#### 5.2.10 Belegmaske und Diagramm-Beschreibungen

| Stelle | Muster/Regel |
|---|---|
| Live-Preis an der Belegmaske | „Jetzt an der Station: 1,719 €/L, gemeldet vor 3 Minuten.“ — Niveau in €/L, Alter in Worten. Ohne belegbares Alter endet der Satz nach dem Preis; ohne frischen Preis steht gar nichts da |
| Abweichung der Eingabe | „Deine Eingabe liegt 3,0 ct/L über dem gemeldeten Preis — gebucht wird, was du eingibst.“ — Differenz in ct/L, Richtung `über`/`unter`, Schwelle 1,0 ct/L. Der Halbsatz nach dem Gedankenstrich bleibt: die App korrigiert den Beleg nicht |
| Prognosepreis im Altbestand | Altbestand ohne gezahlten Preis trägt „Prognosepreis — kein gezahlter Preis“; die Bilanz zählt ihn aus: „Ohne Prognosepreis: +2,00 € (1 Beleg zählt nicht mit).“ |
| Textalternative eines Diagramms | Ein Satz mit **Werten**, nicht mit Reihennamen: „Liniendiagramm. Erwarteter Preis fällt von 1,780 €/L auf 1,710 €/L, Tief 1,690 €/L.“ — gebaut aus denselben Punkten, die gezeichnet werden |
| Diagramm ohne Daten | „Liniendiagramm ohne Werte.“ — nie eine gerundete Null, nie „0,000 €/L“ |
| `aria-label` eines Diagramms | benennt **dieses** Diagramm, nicht die Gattung: „Prognose-Fächer“ · „Versprochen gegen eingetroffen“ · „Tageskurve der Backtest-Zeile“. „Diagramm“ allein ist verboten |

Die Textalternative nennt Tief und Hoch nur, wenn sie **nicht** die
Endpunkte sind, und beschreibt nie die Farbe (geholfen wird damit genau
dem nicht, der die Beschreibung liest); gezählt werden stattdessen die
Seiten und die Ausreißer mit Namen.

#### 5.2.11 Feste Sätze der Hauptbereiche (Auszug, normativ)

| Stelle | Muster |
|---|---|
| Ausgänge der Ampel-Karte „Jetzt“ | `Jetzt tanken` (grün) · `Warten bis 18–20 Uhr` (grün, mit Uhr) · `Woanders tanken · <Station>` (blau) · `Keine klare Empfehlung` (grau) |
| Ersparniszeile | `Erwartet <4,0> ct/L günstiger ≈ <1,60> €` — ct/L und € kommen aus **derselben** Basis (Medianpreis des Fensters); trägt nur das Fensterminimum einen Vorsprung, steht `Im günstigsten Moment ≈ <2,09> € günstiger` statt einer Zahl, die der Fensterpreis nicht trägt |
| Sicherheitssatz (Stufe A) | `bei 40 L · ziemlich sicher (82 %)` — auf Stufe A kommt das **Wort aus dem Prozentwert** (Schwellen 75/55) |
| Stufe C | `Keine klare Empfehlung` + `Das Modell lernt noch — <n> von 100 abgeschlossenen Empfehlungen. Die Preise unten sind gemessen.` — `n` ist der M7-Gate-Schnitt (`gate_n`, Vertragskohorte), **nicht** das 30-Tage-Fenster |
| Drei Fakten | `Jetzt hier` · `Bestes Fenster heute` · `Tank reicht?` — immer dieselben drei, immer diese Reihenfolge |
| Brutto/netto-Trennung bei „Woanders tanken“ | `Das Prozent misst die reine Preisdifferenz (brutto); der €-Betrag rechnet Umweg und Zeit ab (netto).` — Pflichtsatz, weil Karten-Prozent und €-Betrag zwei verschiedene Ereignisse messen |
| Warte-Grund (Server) | `Preis fällt im Fenster voraussichtlich — Warten spart im günstigsten Moment bis zu <2,09> €, im Mittel <0,44> €.` — Beträge in de-DE |
| Fällig-Prompt | Ein-Tipp-Beleg nennt den gebuchten Live-Preis: `Ja, wie empfohlen (<1,719> €/L)`; ohne Live-Preis: `Ja, wie empfohlen (Preis unbekannt)` — gebucht wird nie der Prognose-Median |
| Labor-Tagebuch: Ergebnis-Worte | `richtig` · `daneben` · `unentschieden` · `nicht bewertbar` — nie „Treffer“, nie „Fehler“, nie „Gleichstand“; die Filter-Chips tragen dieselben Worte |
| Labor: Void-Grund | `Kein Vergleichspreis — Grund: <Klartext>.` |
| Labor: Ablehnung mit Grund | `Kein Vergleichspreis — die App hatte hier keine Empfehlung: <Grund>.` — die Grauzone nennt vor der M7-Freigabe **keine Zahl** |
| Labor: Trefferquote | `Versprochen waren die genannten Sicherheiten — eingetroffen sind <x> % davon.`; ohne Fälle: `Noch keine abgeschlossene Empfehlung …` |
| Labor: Maßzahl ohne Messwerte | `noch keine Vergleichspunkte — der Roll-Backtest füllt sie.` |
| Labor: Prinzip-Skizze ohne eigene Daten | `Prinzip-Skizze — nicht deine Daten.` |
| System: Titel | `Einmal einrichten. Weiterlaufen lassen.` |
| System: vier Bausteine | `Collector (Pi)` · `Datenbank (NAS)` · `Modelle` · `App` — je eine Zeile, Ton grün/gelb/rot/grau |
| System: Outbox | Überschrift `Offline-Queue (Outbox)` + Badge `<n> offen`/`leer`; Endzustände `abgelehnt` · `abgelaufen` mit Fehlercode und Alter, nie still verworfen; „Nichts ist verloren; die Einträge liegen im Browser.“ |
| Hinweis unter der Fensterliste | `Reihenfolge nach deinen Tankzeiten (<12> Belege) — günstige Fenster zu Stunden ohne eigenen Tankvorgang stehen weiter hinten.` + `Noch nach Preis sortiert (<3> Belege von <8>) — ab <8> Belegen ordnet die App die Fenster nach deinen Tankzeiten, es fehlen <5>.` + (falls Belege ohne Zeitstempel) `<n> Belege ohne Zeitstempel zählen als 12 Uhr.` |

### 5.3 Automatisierte Ratchets (wer gegen das Regelwerk verstößt, bricht CI)

| Test (Datei im Repository) | Was er arretiert |
|---|---|
| `web/src/microcopy.test.ts` | Paarige `„…“`, keine HTML-Entities, keine ausgemusterten Wörter/Synonyme aus 5.2.4, Ergebnis-Worte gegen die Labor-Definition, keine Ausrufezeichen, keine `✓`/`!`-Präfixe, keine technischen Pfade außerhalb des System-Bereichs, keine Abkürzungen ohne Langform, kein doppelt eingetragener Satz, ein Wortlaut je Zustand (5.2.7), keine Erklärung im Tooltip (5.2.8), keine Symbolsprache (5.2.2), keine Einheiten-Langform/`ggü.`/`Min.` in Views, keine Anrede-Formen („du“, „dir“, „dich“, Höflichkeitsformen) |
| `web/src/format-convention.test.ts` | Kein `toFixed` in Anzeigen, kein rohes `€`/`€/L` im Quelltext — Zahlen laufen nur über die Formatter (5.2.3) |
| `web/src/a11y.test.ts` | Kontrast AA für **beide** Diagrammpaletten; O40-Block: Diagramme tragen Textalternative mit Werten (5.2.10), `aria-label` benennt das konkrete Diagramm |
| `web/src/chartAlt.test.ts` | Textalternativen: Werte statt Reihennamen, keine Farbe-Beschreibung, Tief/Hoch nur wenn nicht Endpunkt, „Liniendiagramm ohne Werte.“ bei Leerstand |
| `web/src/fills.test.ts` + `web/src/views/Ich.test.tsx` | Belegmaske (5.2.10): Live-Preissatz mit belegbarem Alter, Abweichung in ct/L mit Richtung, „gebucht wird, was du eingibst“ |
| `components/Notices.test.ts` | Meldungs-Rang, eine Meldung, eine Dauer (5.2.7) |
| `components/FeedbackBanner.test.tsx` | Ton der Rückmeldung (`ok`/`warn`/`error` mit Rolle) |
| `components/states.test.tsx` | Skeleton, Banner, Tabellen-Fehler gegen echtes Markup |
| `web/src/data-age.test.ts` | Schwellen und Wortform der Datenstand-Sätze (Preise 30 min, Modell 1440 min, 2× = roter Ton) |
| `tests/test_rp2_fallback.py` | Dieselbe Wort- und Zahlenkonvention für die Fallback-GUI (Python), inkl. der festen Muster aus 5.2.5 |
| `tests/test_notify.py`, `tests/test_o29_window_push.py` | Push-Texte (5.2.6): keine Pfade/Tokens/Koordinaten, Ruhezeit, zwei Modi, einmal je Episode |
| `tests/test_glossary.py` | Glossar existiert und trägt die Fachbegriffe der Laborkarten |

**Ratchet-Regel:** Neue Komponente mit Nutzertext? In die Dateilisten der
Ratchets eintragen, sonst prüft sie niemand. Der Gutachter kann das als
Strukturprüfung verlangen: Existiert Nutzertext, existiert der
Ratchet-Eintrag?

### 5.4 Manuelle Prüfliste (Texte)

Bezugspunkte im Demo-Stack (Kapitel 4.4) — Abweichung vom Regelwerk = Befund:

1. **Leerzustände** (zweiter, leerer Server): „Noch kein/e <Sache>.“ + was
   fehlt; kein Alarm-Ton, kein „Erneut laden“.
2. **Fehlerzustände:** `LoadError` zeigt den Fehler-Klartext, Rohcode
   darunter, Knopf „Erneut laden“ — je `error_code` genau ein Klartext.
3. **Frische-Fußzeile:** „Preise vor 4 Minuten · Prognose vor 35 Minuten ·
   <Ort>“ — Alter in Worten, niemals „vor 4 Min.“
4. **Keine Zahl bestimmbar:** „—“ (Geviertstrich) — nie 0, nie leer.
5. **Ampel-Karte „Jetzt“:** Ausgänge nur `Jetzt tanken` / `Warten bis …` /
   `Woanders tanken · <Station>` / `Keine klare Empfehlung`;
   Sicherheitssatz auf Stufe A trägt das Wort aus dem Prozentwert
   (Schwellen 75/55); Stufe C nennt den M7-Lernstand (`gate_n`) und dass
   die Preise gemessen sind — keine Prozentzahl.
6. **Woanders-Karte:** der Trennsatz „Das Prozent misst die reine
   Preisdifferenz (brutto); der €-Betrag rechnet Umweg und Zeit ab
   (netto).“ muss stehen (Befund B1, 23.09.2026).
7. **Labor-Tagebuch:** Ergebnis-Worte nur `richtig` · `daneben` ·
   `unentschieden` · `nicht bewertbar`; Void-Gründe als Klartext;
   Mehrfach-Bestätigung bleibt eine Zeile.
8. **System:** Gesamtfarbe nur `Alles ok` · `Hinweise` · `Störungen` ·
   `Unbekannt`; Pfade/Endpunkte erscheinen **nur** hier (und im
   Diagnose-Export ohne Tokens); Outbox mit sichtbaren Endzuständen
   `abgelehnt`/`abgelaufen`.
9. **Fallback-GUI** (falls vorhanden): die festen Muster aus 5.2.5
   wortgleich (Marker `tankapp-fallback-gui v5.0`).
10. **Push-Texte** (nur mit aktivem Push-Ziel prüfbar, sonst Code-Lektüre
    von `app/notify.py` + die Python-Tests): kein Pfad, kein Token, keine
    Koordinaten, Ruhezeit nur für Fenster-Meldungen.

### 5.5 Historische Befunde (Prüfliste für die Arretierung)

| Befund | Inhalt | Status | Arretierung |
|---|---|---|---|
| Lektorat 15.09.2026 (archivierter Befund) | Komplettes Text-Lektorat; Regelwerk daraus in die MICROCOPY-Norm überführt | umgesetzt | MICROCOPY-Ratchets (5.3) |
| A3 (Runde 1, 23.09.2026) | Lernfortschritt mischte 30-Tage-Ledger und Gate-Kohorte; Trefferzeile mischte Zählvariablen („2 von 4 trafen zu (63 %)“ — beides jeweils richtig, im selben Satz mathematisch unverträglich) | behoben (PR #220) | `m7Progress` liest `gate_n`; Trefferzahl mit halben Ties konsistent zur `hit_rate`-Klammer |
| B1 (Runde 1) | „spart netto +X %“ versprach netto; das angezeigte Prozent maß **brutto** (Ereignis ohne Umwegkosten) | behoben (PR #220) | Trennsatz brutto/netto in der Woanders-Karte (Prüfliste 6) |
| B2 (Runde 1) | „Warte-Empfehlung zu unsicher (P < 50 %)“ — Schwellwert fest verdrahtet, obwohl die aktive Schwelle reguliert wird | behoben (PR #220) | Zahl wird aus der aktiven Schwelle interpoliert |
| B3 (Runde 1) | Regelwerk-Drift: Text-Norm nannte Modell-Frische 180 min, Code 1440 min; tote Stufe-B-Texte | behoben (PR #220) | Norm auf 1440 min; Stufe B entfernt (A5) |
| F2, F7, F8, F10, F11, F12, F13 (Runde 3) | Fachbegriffe („B=2000 Blöcke“ statt „Ziehungen“), irreführende Labels („Regel-Ergebnis 31,35 € / Orakel 32,45 €“ suggerierte Kosten, war Ersparnis), MASE-Namenskollision (One-Step vs 24h-Fenster), Stabilität vs CUSUM als Widerspruch verkauft, dünne Heatmap-Referenz (50 % bei n=2) | behoben (PR #222, Commit `69bff95`) | Label-/Satz-Fixes in `web/src/views/labor/Modell.tsx`, `Guete.tsx`, `web/src/lab.ts` — im Demo-Stack ablesbar |

## 6. Prüffeld 2 — GUI

### 6.1 Was „robust“ hier bedeutet

Robustheit der GUI heißt: (a) jede Kombination aus Datenzustand und
Gerätebreite rendert ohne Bruch; (b) Ladevorgänge flackern nicht (Polling
leert keine Ansicht); (c) die Tastatur- und Screenreader-Pfade sind gleich
wertig; (d) Performance-Budgets gelten als Test, nicht als Wunsch; (e)
Server und GUI spielen zusammen — geprüft gegen den echten Server, nicht
nur gegen Mocks.

### 6.2 Aufbau und Regeln

**Navigation 3+1:**

```text
Jetzt
Woche
Stationen
Mehr / Studio
├── Labor
├── Ich
├── System
└── Glossar
```

Mobil öffnet „Mehr“ ein nicht-modales Auswahlblatt; Escape schließt es,
der Fokus springt beim Öffnen auf die aktive Zeile; der aktive
Studio-Bereich ist am Mehr-Eintrag markiert. Auf dem Desktop stehen diese
Einträge in einer Studio-Gruppe der Seitenleiste. Bestehende URLs bleiben
erreichbar (`?tab=labor` u. a.); die Navigation darf keine Inhalte
verstecken, die nur über einen alten Haupttab erreichbar waren. Alarm-Pille
und Update-Banner bleiben global.

**Bereiche und ihre Verantwortung:**

| Bereich | Verantwortung | Abgrenzung |
|---|---|---|
| Jetzt | Empfehlung, drei Fakten, „Heute im Blick“, Umweg-Rechnung | keine zweite vollständige Stationsliste |
| Woche | Veröffentlichte Fenster für die nächsten Tage | Mehrtage-Bänder nicht als PIT-kalibriert ausgeben |
| Stationen | Polling-Set, Karte, Vergleich, Stationsdetails | Tagesverlauf im Detail statt unbeschrifteter Mini-Linie in jeder Zeile |
| Labor | Modell, Güte, Kalibrierung, Heatmaps, Begründungen (vier Sub-Tabs: Überblick, Modell & Parameter, Güte & Kalibrierung, Daten & Rohdaten) | Markt-Labor und Live-Advice nicht mit persönlicher Bilanz vermengen |
| Ich | Fahrzeug, Profile, Tankstand, Belege, Bilanz | ein Intent ist kein Beleg |
| System | Konfiguration, Jobs, Archiv, Collector, Alarme, Outbox, Export | interne Pfade und Betriebsbegriffe bleiben hier, nicht in Alltagskarten |
| Glossar | Begriffe mit verständlicher Kurz- und Langform | Fachwörter erst erklären, dann vertiefen |

**Antwort, Begründung, Beweis:** 1. Antwort — eine klare Aussage mit
handlungsrelevanten Zahlen; 2. Begründung — Datenalter, Quelle,
Bedingungen, relevante Unsicherheit; 3. Beweis — gezielter Sprung in
Labor, Diagramm oder Rohdaten. Fenster-Vorteil („bis zu“) und
Median-Erwartung sind verschiedene Größen; die GUI darf sie weder
sprachlich noch rechnerisch austauschen. Prognosekalibrierung und
Produktfreigabe bleiben getrennt sichtbar.

**Technik:** Jeder Bereich lädt als eigenes Lazy-Chunk (`React.lazy`) —
der Einstieg zieht nicht das Labor und nicht die Karte mit. PWA:
Service-Worker unter `/sw.js`; die Shell trägt die App-Version; Belege und
Vorsätze warten offline in der Queue (IndexedDB) und gehen raus, sobald
die Verbindung steht. Die Gestaltung übernimmt die gestalterische Basis
der geschützten Prototypen im Ordner `sample/` („good gui“, „good
statistic gui“) — die Design-Basis, nicht eine Datenquelle.

**Bewusste Umfangsgrenzen (nicht gebaut, keine offenen Defekte):**
kein öffentlicher Betrieb und keine Benutzerverwaltung, kein
Preis-Ticker, keine Markenrabatte/E5-E10-Verbrauchsfaktoren ohne echte
Fahrzeugdaten, keine freie Standortsuche (kuratiertes Polling-Set), keine
Top-3-Trefferquote über nicht veröffentlichte Kandidatenfenster,
keine OpenAPI-Spezifikation (die Markdown-API bleibt der Vertrag).

### 6.3 Zustandsrobustheit (Datenwahrheit)

Jeder Zustand ist ein bezeichneter Baustein — ein Panel erfindet keinen
eigenen:

| Zustand | Baustein/Regel | Abnahme |
|---|---|---|
| Einrichtung | `Empty` + nächste Schritte | „Einrichten in drei Schritten“ auf leerem Server |
| lädt (erstes Mal) | `Skeleton*` mit `role="status"` + `aria-busy` | Platzhalter, keine falsche „keine Preise“-Behauptung |
| lädt (Aktualisierung) | **nichts** | vorhandene Zahlen bleiben stehen (kein Flackern im Poll-Takt) |
| veraltet | `DataAge` (`dataAgeNote`) | Schwellen: Preis 30 min, Modell 24 h (1440 min), Selektion 36 h; doppelt = roter Ton; unbekannter Stand = kein Banner |
| Fehler (Panel/Tabelle) | `LoadError` / `CellError` | Klartext + Rohcode + „Erneut laden“; ein HTTP-200-Fehlerkörper ist keine gültige Summary |
| nicht entscheidungsbereit | — | reine Preise, keine erfundene Empfehlung oder Sicherheitsquote; `blocking_reasons` sichtbar |
| offline | Outbox (IndexedDB) | offene Einträge mit 30-s-Nachreich-Takt, sichtbare Endzustände `rejected`/`expired` (nicht still verworfen), Export (JSON/CSV) und Entfernung in „System“ → Diagnose |
| Job abgebrochen/unvollständig | `JobCard` | Zustand benennen, letzte Ergebnisse bleiben |

### 6.4 Barrierefreiheit und mobile Zusagen

| Zusage | Nachweis |
|---|---|
| Kontrast AA — auch für beide Diagrammpaletten | `web/src/a11y.test.ts` |
| Fokusführung, Tastaturbedienung, aktive Navigation sind testbare Zusagen | Browser-Suite + manuelle Prüfliste (6.7, Punkt 9) |
| Diagramme: Textalternative **mit Werten**, `aria-label` benennt das konkrete Diagramm | `chartAlt.test.ts` + O40-Block in `a11y.test.ts` |
| Auf 390 px dürfen Stationskarten und Tabellen keinen unnötigen horizontalen Seiten-Scroll erzeugen | `web/e2e/mobile.spec.ts` (Breiten 320/390, Demo-Suite) |
| Die Scrolltiefen-Grenze von 1,5 Viewports gilt für den „Jetzt“-Abschnitt bei 390 × 844 (nicht für die gesamte Seite inkl. globalem Kopf) | `web/e2e/mobile.spec.ts` |
| Lange Modellbezeichner brechen innerhalb ihrer Breite um (nicht gekürzt, nicht abgeschnitten), bei 320 und 390 px auch mit einem absichtlich überlangen Bezeichner | geometrischer Browsertest (Demo-Suite) |
| Erst-Paint-Gate: die Ansicht rendert erst, wenn Shell-Daten **und** View-Modul da sind → im Sichtbaren kein „Skeleton → Inhalt“-Tausch, CLS ≈ 0 | Lighthouse-Messwerte (6.6) |
| Die Matrix (Heatmap) ist auf dem Mobilgerät die eine bewusst schiebbare Fläche; die Lesehilfe steht darunter („Die Matrix ist breit: seitlich schieben zeigt alle 24 Stunden.“) | `mobile.spec.ts` („bewusst scrollbare Kästen“) |

### 6.5 Browser-Tests: zwei Suiten, zwei Beweise

| Suite | Beweist | Aufruf |
|---|---|---|
| **Mit Mocks** (Specs unter `web/e2e/`, ohne demo/mobile/failover) | Die GUI rendert mit **erwarteten** Antworten korrekt — inkl. aller Leer-/Fehlerzustände; Desktop 1440 px + Mobil 390 px | `npm --prefix web run test:e2e` |
| **Ohne Mocks** (`demo.spec.ts`, `mobile.spec.ts`, `failover.spec.ts` gegen den Demo-Stack auf Port 1357) | Server und GUI **zusammenspielen**: overview → „Jetzt“ mit „Heute im Blick“ (19 Zellen, Berliner Zeit), Stationsliste, `If-None-Match` → 304 beim Aktualisieren, keine `role="alert"`; Mobil-Ratchet (kein Querlauf) auf echten Antworten; Failover mit echten Browser-Handlern | `npm --prefix web run test:e2e:demo` |

Daneben: `tests/test_e2e_demo.py` (Serververtrag ohne Browser) und der
Ratchet `tests/test_quality_gates.py::test_e2e_demo_suite_ist_keine_mock_suite`
— die Demo-Suite darf nicht still wieder zu einer Mock-Suite werden.

**Warum das wichtig ist:** Die Lücke „Mock passt, echter Server nicht“ hat
schon reale Defekte ausgelassen (NaN brach einen Prognose-Endpunkt,
UTC-Fenster statt Ortszeit in der Fallback-GUI, kein Tagesverlauf im
Demo-Stack) — seitdem gehört die zweite Suite zum Prüfspiegel.

### 6.6 Performance- und Qualitätsgates

Gemessen gegen denselben Demo-Stack (feste Daten, reale App):

| Gate | Budget | Ebene | Letzter dokumentierter Messwert |
|---|---|---|---|
| Lighthouse Barrierefreiheit / Best Practices / SEO | ≥ 0,90 / ≥ 0,90 / ≥ 0,80 | Fehler | 1,0 / 1,0 / 1,0 (drei Zustände, Stand 0.41.1) |
| Lighthouse Performance | ≥ 0,80 (Produktziel > 0,90) | Warnung | 0,97–0,98 lokal; CI-Bestätigung noch offen (anderer Chromium-Stack) |
| CLS | ≤ 0,1 | Fehler | 0,00–0,03 |
| Übertragungsvolumen | ≤ 1,5 MB | Fehler | ≤ 0,67 MB je Seite |
| LCP | ≤ 2500 ms | Warnung | ≈ 1,0–1,2 s (CI-Maschinen streuen; dient dem Trend) |
| p95 `/api/v1/overview` (Last, 8 Clients, 30 s) | ≤ 1000 ms | Fehler | 8 ms (p50 3 ms, 895 Abrufe; p99 ≈ 1,4 s = planmäßiger Neurechnen-Takt am 60-s-ETag-Fenster) |
| p95 einer API-Antwort (Server-Selbstmessung) | ≤ 300 ms (LAN) | Warnung | Budget als Konstante `REQUEST_BUDGET_MS` in `app/metrics.py`, fährt in jedem Health-Payload mit; Zielhardware-Nachweis offen (Kapitel 9) |
| Fehlerhafte Antworten (Last) | 0 (alles 2xx/3xx) | Fehler | keine |
| 304-Anteil der Revalidierungen | ≥ 20 % | Fehler | ≈ 87 % |

Gemessen werden drei GUI-Zustände (gefüllter Einstieg „Jetzt“, Labor,
Einrichtungszustand auf leerem Server), je 3 Läufe, auf PRs, die die
betroffenen Ordner anfassen, und sonntags 04:17 UTC.

**Server-Selbstmessung** (seit 0.52.0/0.65.0): jede Antwort trägt
`X-Process-Time` (Bearbeitungszeit in Sekunden, Konvention wie
gunicorn/nginx), `Server-Timing` mit fester Namensliste (`history`,
`ledger`, `advice`, `wallet`, `stats`, `snapshot`, `publication`,
`serialize`, `gzip`, `total` — und `idle`, die Clientpause **vor** der
Anfrage, ausdrücklich außerhalb von `total`), und `X-Request-ID`
(Korrelations-ID; vom Client übernommen, wenn sie dem Zeichenvorrat
`[A-Za-z0-9._:-]{1,64}` genügt, sonst zufällig). `GET /api/v1/health`
meldet zusätzlich p95/Max/langsamste Route über die letzten 200 Antworten
(je Route ab fünf Antworten), das Budget, `performance.store_lock`
(Akquisition/Wartezeit der Feedback-Store-Sperre — ein steigender Zähler
ohne Schreibvorgänge heißt: ein Lesepfad nimmt wieder die Sperre) und die
Dauer des letzten Pars des Datenstands (`null` heißt „noch niemand
geparst“, nie „0 ms“). Die Messung beginnt an der **Requestzeile** — ein
Audit fand, dass zuvor die Keep-Alive-Pause davor mitgemessen wurde
(Gegenprobe: 400 ms Clientpause, danach `X-Process-Time < 200 ms`,
`idle ≥ 300 ms`; arretiert in `tests/test_a21_b2_latency.py` und
`tests/test_o37_server_metrics.py`).

**Abgrenzung:** Das ist kein Monitoring — kein Export, keine Historie über
den Prozess-Lebenszeitraum hinaus, kein Alarm. Die Messung beantwortet
eine Frage: „Warum hängt das gerade?“ — auf dem Gerät, auf dem es hängt.

### 6.7 Manuelle Prüfliste (GUI)

Im Demo-Stack (Kapitel 4.4) und auf leerem Server:

1. **Navigation**: 3+1 auf 1440 px (Studio-Gruppe in Seitenleiste) und
   390 px (Mehr-Blatt, Escape, Fokus); alte URLs `?tab=labor` u. a. bleiben
   erreichbar; Alarm-Pille und Update-Banner global.
2. **Jetzt**: drei Fakten immer in gleicher Reihenfolge (`Jetzt hier` ·
   `Bestes Fenster heute` · `Tank reicht?`); Tagesstreifen mit Legende
   und Farbskala, die ihren Bezugszeitraum nennt („Farbskala der letzten
   7 Tage: grün bis …, rot ab …“); ohne Empfehlung keine Prozentzahl,
   keine Ampel.
3. **Stationen**: Atlas-Spalte „Netto“ — der Server-Nettowert zeigt
   empfohlene Stationen als Ersparnis (Befund A1: Vorzeichen und
   Sortierung waren invertiert), Standard-Sortierung „Netto“ absteigend
   nach dem Server-Wert; der Stationsvergleich und der Atlas zeigen
   dieselbe Richtung derselben Zahl.
4. **Woche**: veröffentlichte Fenster; Mehrtage-Bänder (72/168 h) sind
   **nicht** als PIT-kalibriert beschriftet.
5. **Labor**: acht Parameterkarten (Struktur, AR(2), Bootstrap,
   12-Uhr-Projektion, Ensemble, Selektion, Schwellen, Regime) tragen
   Payload-Werte (nicht „Kein … im Payload“ — Befund N1);
   Spielplatz-Zeiten als `HH:MM` (Befund F1: „22.67:00“);
   „B=… Ziehungen (Samples, nicht Blöcke)“; Ensemble-Titel „inverse
   MASE, global“ bei `horizon_weights: not_estimated`; Backtest-Bilanz
   „Ersparnis Regel / Orakel (obere Schranke)“; Beta-Intervall-Karte der
   Trefferquote.
6. **Ich**: Belegmaske mit Live-Preissatz und Abweichung (ct/L,
   Richtung); Tankstand „Keine Angabe“; physische Menge vs. What-if
   getrennt (What-if ist hypothetisch und sperrt reale Aktionen).
7. **System**: vier Bausteine (Collector, Datenbank, Modelle, App) mit
   Ton grün/gelb/rot/grau; Gesamtfarbe; Coverage-Gate; Diagnose-Export
   als Datei — JSON enthält Version, Zustand, Coverage, letzte
   Log-Zeilen, **keine Tokens**; Outbox-Karte mit Zähler und Export.
8. **Browser-Konsole**: keine Fehler, keine `role="alert"` im
   Normalzustand (Demo-Suite-Zusage).
9. **Tastatur-Test**: komplette Navigation und alle Dialoge ohne Maus;
   Screenreader: Skeleton-Label nur für Screenreader, Diagramme tragen
   Wert-Textalternative.

### 6.8 Historische Befunde (Prüfliste für die Arretierung)

| Befund | Inhalt | Status |
|---|---|---|
| A1 (Runde 1, 23.09.2026) | Stations-Atlas: Server-`net_eur` mit falscher Vorzeichen-Konvention angezeigt **und** sortiert — empfohlene Stationen rot/teuer („+2,50 € netto“ als Mehrpreis) und nach unten; die Tests trugen die Inversion mit | behoben (PR #220): `netCostEur`/`sortAtlasRows` einheitlich (negativ = günstiger), Server-Wert wird gedreht statt gemischt, Tests tragen die echte Konvention |
| A4 (Runde 1) | „Tagesmedian“ bei gerader Stichprobe war der **obere** Median (zweiter Mittelwert), nicht der Median — bei 18 Öffnungsstunden der Normalfall | behoben (PR #220): Mittelwert der beiden mittleren Stunden-Minima |
| A5 (Runde 1) | Stufe B („Empfehlung ohne Prozent“) war strukturell unerreichbar (nicht kalibriert ⇒ Sperrgrund ⇒ `no_advice` ⇒ Stufe C); die Stufe-B-Texte waren toter Code | behoben (PR #220): Stufe entfernt, `NowStage = "A" \| "C"`, Regelwerk nachgezogen |
| A8 (Runde 1) | TS/Python-Parität der Labor-Scores in Randfällen (`n_p = 0` → GUI 0 statt Server `null`) | behoben (PR #220): `scoreRows` weist `null` wie der Server aus |
| N1/N1a–N1e (Runde 2) | Acht Labor-Karten lasen Payload-Felder, die der Server nie trug (→ „Kein … im Payload“); GUI las falsche Schlüssel (`root_modulus` statt `root_radius`, `pit.n` statt `pit.horizons["24h"].all.n` u. a.); Demo-Stack baute Zeilen ohne Diagnosefelder; mobil 320/390 px: JSON-Dump-Block (~930 px, umbruchlos) und nicht brechender 34-Zeichen-Token | behoben (0.68.1): ein gemeinsamer Helfer liest die Modell-Parameter aus **einer** Quelle (Betrieb und Demo), die GUI liest die echten Schlüssel und zeigt für Fehlende ehrlich „-“, kompakte benannte Summary statt JSON-Dump, `overflow-wrap:anywhere`; Unit-Fixtures halten die echte Payload-Form fest |
| N2 (Runde 2) | Demo-Stack fuhr einen anderen statistischen Vertrag als der Betrieb (`harmonic_ar2` statt `profile_ar2` + gemeinsame Ziehung + Day-Pair) — der Modellvertrag löste zu „unbekannt“ auf | behoben (0.68.1): Demo-Lauf rechnet mit dem Betriebsvertrag, arretiert im Test `test_demo_stack_liefert_publikation_und_frische_preise` |
| F1, F9 (Runde 3) | Spielplatz-Zeit „22.67:00“ (Zahl statt Uhrzeit); Delta-Achse ohne Format → ct/L-Werte als „3,00 €-3,00 €0“ | behoben (PR #222, Commit `69bff95`): `formatHour`, `fmt={centPerLiter}` |
| Frühere GUI-Befunde 08.–15.09.2026 (archiviert) | UX-Prüfungen und Neuentwurf-Runden; die daraus gültigen Regeln stehen in 6.2–6.4 | umgesetzt |

## 7. Prüffeld 3 — Statistisches Modell

### 7.1 Was „robust“ hier bedeutet

Robustheit des Modells heißt: (a) **Selbstkonsistenz** — Backtest und
Veröffentlichung bewerten denselben Modellpfad (Kern, Ziehstrategie,
Day-Pair); (b) **Ehrlichkeit** — unkalibriert heißt unkalibriert,
`calibrated` ist ein technischer Zustand und keine Produktfreigabe,
fehlende Evidenz erzeugt `null`/Sperrgrund statt Zahl; (c)
**Reproduzierbarkeit** — jede Prognose ist reine Funktion ihrer Eingaben
(bitgleiche Invaranz-Fixtures); (d) **Validierung** — Auswertungslogik
gegen Out-of-sample-Holdout (zeitlich getrennt), nicht gegen
Trainingsdaten; (e) **Regelkonformität** — die 12-Uhr-Preisschutz-Regel
(seit 2026-04-01: Erhöhungen nur um 12:00 Uhr) wird exakt abgebildet,
nicht nachgeglättet.

### 7.2 Architektur der Modellkette

#### 7.2.1 Aufbereitung (`app/history.py`, `engine/`)

- **Rohe Änderungsereignisse** mit exakten, offsetbehafteten
  Zeitstempeln, Änderungsflags und Löschsperren — keine Median-Buckets,
  die Zeitstrukturen verstecken. Der Rohbestand wird nicht gelöscht;
  Archiv und Live-Polling sind zwei Bezugswege, das Archiv ersetzt keine
  verlorenen eigenen Poll-Snapshots.
- **Causaler Hampel-Filter** mit getrennter Datenqualitätsdiagnostik:
  `price_raw` bleibt ungefiltert — ein entfernter Punkt ist zählbar.
  Ehrliche Grenze: Der Filter entfernt den ersten Poll eines echten
  Sprungs (ein FFill-Bucket) — Trainingspreise starten bestätigte Sprünge
  einen Bucket später.
- **Datenqualität statt stiller Korrektur:** Beobachtete Anstiege ≥ 1 ct,
  deren 5-Minuten-Intervall keinen erlaubten 12:00-Uhr-Punkt enthält,
  werden als `law_rise_outside_noon` **gezählt und im Backtest-Report
  ausgewiesen, nicht gelöscht** (mögliche Datenartefakte oder
  Regelverstöße; sie verbleiben im Modell).
- **Zeitblöcke:** `engine.timeblocks.block_key_utc` bildet die lokale
  Kalendergrenze auf einen UTC-Identitätsstempel ab — Mitternacht, der
  23-h-Frühlingstag, der 25-h-Herbsttag und beide Herbst-Folds bleiben
  chronologisch unterscheidbar (24-/72-/168-h-Indizes). Teilschluss nach
  `now`: echte Restblock-Minima je Draw (`suffix_minima`, platzsparend
  als Delta-Matrix serialisiert), kein Präfix-Artefakt — für einen
  Deadline-Schnitt, der kein Evidenz-Präfix trägt, setzt die API die P
  auf `null` und nennt die fehlende Evidenz; alte Veröffentlichungen
  bleiben als `legacy_whole_block` markiert und werden nicht
  rückwirkend als exakte Suffixe ausgegeben.
- **Mehrdeutige Sommerzeit-Zeitstempel** werden verworfen und gezählt,
  nicht erfunden. `closed`, `no prices` und fehlende Sorten bleiben
  Statuszeilen, niemals Preis 0.

#### 7.2.2 Strukturmodell + AR(2) (`engine/models.py`)

| Baustein | Verfahren | Robustheitsmerkmal |
|---|---|---|
| Strukturmodell | Robuste Regression (Huber-IRLS): 1.+2. Harmonische, Wochentags-Dummies, Mittags-Schritt („nach 12:00 Uhr, ab Gesetzesbeginn“), Feiertags-Dummy je Bundesland (gepoolt, aus bis zu 365 Tagen geschätzt — nicht aus dem 42-Tage-Fenster) | Ausreißer-robust statt OLS; der tägliche 12-Uhr-Sprung wird direkt getragen, die Harmonischen müssen ihn nicht als glatte Kurve nachzeichnen |
| AR(2)-Nachlauf | Yule-Walker + Stabilitätsnetz: wenn der größte Polradius > 0,98, werden beide Koeffizienten × 0,9 gestaucht, max. 100 Schritte; nicht stabilisierbar = benannter Fallback (`too_few_points`, `too_few_triples`, `zero_variance`, `not_stabilised`) | **Geprüft statt stumm**: `ar_shrink_events`, `ar_state_reset`, `ar_detail` je Kern im Modell-Artefakt und im Backtest-Report (`ar_shrink`) |
| 12-Uhr-Projektion | PAVA (Pool-Adjacent-Violators) je Segment [12:00, nächste 12:00) **plus deklarierte Regime-Kanten** auf nicht-steigend — für den Median **und** jede Bootstrap-Pfad; der erlaubte Sprung an der Segmentgrenze bleibt erhalten; NaN bleibt NaN (keine Koppelung über Lücken); Segmente vor dem Gesetzesbeginn werden nicht projiziert | Isotone L2-Projektion: die Rechtsregel ist exakt erfüllt, keine Heuristik; Diagnose `pava_pool_stats` (Pools, gepoolte Punkte, max. Pool-Größe, max. Verschiebung in ct, geänderte Pfade/Quantilen) |
| Residuen-Bootstrap | Exponentiell gewichteter **Tagesblock-Bootstrap** (Halbwertszeit 14 Tage, neuere Tage höheres Ziehgewicht; `0` = uniform), B = 2000 im Betrieb (200 im Demo-Stack) | Nichtparametrisch: Intraday-Abhängigkeit bleibt erhalten; die Gewichtung ist gegen Trägheit bei Preiswechseln ablatiert (42d-EW vs 42d-uniform vs 84d-uniform im Backtest) |
| Gemeinsame Ziehung | Dieselben Tages-Indizes für alle Stationen (mit Salz für bitgleiche Reproduktion) | Stationen-Abhängigkeit bleibt im Intervall; arretiert in `tests/test_a11_shared_draws.py` |
| Day-Pair | Benachbarte Trainingstage werden als Paar gezogen; deklarierte Kanten werden respektiert; ohne zulässige Paare Fallback auf unabhängige Tage | Trainingstag-Abhängigkeit; arretiert in `tests/test_b3_daypair.py` |
| Ensemble | Inverse MASE-Gewichte aus **lokaler** Eine-Schritt-Validation (14-Tage-Fenster, `ensemble_detail`); `weight_spread` je 288-Slot-Block als reine Diagnose | Die Gewichte sind keine Parameter-Aussage; horizontabhängige Gewichte sind **nicht geschätzt** und als `not_estimated` ausgewiesen — eine alternative Mischung darf nicht allein aus historischen Texten als aktiver Default gelten |
| Kernen | `profile_ar2` (App-Default **und** Backtest), `harmonic_ar2` und `ensemble` als explizite Alternativen | **Backtest und Veröffentlichung bewerten denselben Pfad** — die frühere Abweichung (Backtest-Kern ≠ veröffentlichter Kern) ist behoben |

#### 7.2.3 Auswertungslogik: Backtest (`engine/backtest.py`)

- **Strict-End-Schnitt / Rolling Origin:** Der Bericht ist eine reine
  Funktion der Vergangenheit — jeder Tag wird auf Basis der Daten vorher
  ausgewertet (21 Prüftage im NAS-Job, Poll-Fenster 06–24 Uhr, gemeinsame
  Datenbasis mit der saisonalen Naive; Engine-Forward-Fill wird nicht als
  Testbeobachtung gezählt).
- **Horizont-Vertrag:** `horizon_hours` ist der **Vorlauf des
  Zieltags** (0 = klassisches Tagesfenster `[origin, +24 h)` — die live
  veröffentlichte, 24-h-rekalibrierte Prognose; 72/168 = dieselben
  24-h-Fenster am Anfang des +3-d- bzw. +7-d-Horizonts). Vorlauf und
  Fensterlänge sind bewusst zwei benannte Größen — seit ein
  verwechseltes `== 24`-Filter an dieser Stelle genau null Zeilen traf
  und die 24-h-Rekalibrierung still totgelegt war.
- **Gates (Schwellen):** `mase_24h_below_0_95` (MASE < 0,95 gegenüber der
  saisonalen Naive; MASE nutzt nur die saisonale Fehlerskala aus dem
  Training und ist bei konstanten Reihen undefiniert → `mase: null` mit
  `mase_none_reason`), `pinball50_better_than_naive` (τ = 0,5),
  `pinball_asym_better_than_naive` (asymmetrisch τ = 0,75 —
  Unterschätzung des Preises, also Warten in eine Erhöhung, wird **3×**
  so stark bestraft wie Überschätzung), `picp95_between_90_and_98`
  (PICP 95 % ∈ [90, 98] %).
- **Rolling-PICP 7 d je Station:** Tagesquoten-Mittel (ein Tag = eine
  Stimme) mit Konfidenz-Badge (grün ≥ 93 %, gelb ≥ 90 %, rot < 90 %,
  nominal 95 %; weniger als 72 Punkte im Fenster = keine Aussage) —
  Grundlage des Güte-Gates der Entscheidung.
- **PIT-Paare:** Als Histogramm je Station und Horizont (24h/72h/168h,
  `all` und `break_free`): PIT = Mittelrang der Beobachtung unter den
  Bootstrap-Pfaden, 0,5-Credit bei Ties, 40 Klassen. Kalibriert wäre das
  Histogramm flach und `coverage[q] = q`. Die Rohpaare stehen je Zeile
  in `predictions.csv.gz` (Spalte `pit`).
- **DST-Tage:** bleiben im Backtest (nichts ausgeschlossen, nichts auf
  24 h gerechnet, damit Kennzahlen und Fold-Zahl vergleichbar bleiben);
  jeder solche Tag ist ausgewiesen (`dst_day`, `local_day_hours`; im
  Bericht der Block `dst` mit `anchors_missing_nat` — die saisonale
  Skala verliert an 23-/25-h-Tagen ihre 02:xx-Vortagesanker, die Zahl
  steht im Bericht, statt die Stichprobe still zu verkleinern; da das
  Poll-Fenster 06–24 Uhr diese Stunden nicht enthält, ändert das die
  Kennzahlen im Regelfall nicht).
- **Regime-Kanten:** Politik `flagged_not_excluded` — markiert und
  gezählt (`regime_breaks_in_window` mit Art, Betrag, Status, Quelle,
  `count`, `folds_spanning`/`points_spanning`); Kennzahlen über eine
  Kante sind als Modellgüte nicht interpretierbar und zusätzlich als
  `metrics_break_free` ausgewiesen — nichts verschwindet stillschweigend.

#### 7.2.4 Kalibrierung (`engine/calibration.py`)

Die PIT-Rekalibrierung korrigiert die **empirische Verteilung** der
24-h-Bootstrap-Pfade, nicht den Punktpfad:

1. Der Rolling-Origin-Backtest liefert je 24-h-Wahrheit den
   PIT-Mittelrang `u = F_roh(y)`.
2. Aus den **früheren zwei Dritteln** der Backtest-Origins
   (out-of-sample) lernt PAVA eine monotone empirische CDF `H`; für jede
   Pfadspalte werden die Draw-Ränge mit `H⁻¹` umgelegt — so gilt
   `F_kalibriert(y) = H(F_roh(y))`, während Rangordnung und gemeinsame
   Draw-Kopplung erhalten bleiben. Das **letzte Drittel** nimmt ab.
3. **Akzeptanz:** Eine Station wird nur angenommen, wenn alle
   Quantil-Abdeckungen (2,5/10/50/90/97,5 %) im Holdout-Band liegen
   **und** PICP95 gegenüber roh höchstens **2 Prozentpunkte** sinkt.
   Veröffentlicht werden `raw_coverage`/`calibrated_coverage`,
   Zielbänder, `raw_picp95`/`calibrated_picp95` und das explizite
   `picp_release_gate`.
4. **Provenienz und Verzögerung:** Der Kandidat wird station-, sorten-,
   kern- und ziehungsmodusgenau gespeichert (Fingerprint
   `kind/shared/day_pair` — invertiert sicher) und nimmt nur 24-h-PITs
   ohne `regime_break_spanned`. Die Veröffentlichung arbeitet
   **mit einem Lauf Verzögerung**: ein akzeptierter Kandidat aus dem
   *vorigen* Backtest kann beim jetzigen Fit aktiv werden; der aktuelle
   Backtest schreibt nur `calibration_candidate`. `calibration` ist die
   tatsächlich angewandte Hülle, `calibrated` ihr validierter
   Modellzustand — **nicht** die M7-Freigabe.
5. **Regime-Blackout:** Der deklarierte Regime-Kalender blockiert jede
   Aktivierung vom Kanten-Tag bis **45 lokale Kalendertage** danach
   (Hülle meldet `status: "regime_blackout"`) — eine vor der Kante
   akzeptierte Kurve kann nicht über den Bruch hinweg veröffentlicht
   werden.
6. **Niemals still akzeptieren:** Fehlende Roh-PITs, zu kleine oder nicht
   zeitlich trennbare Stichproben sind ein benannter unkalibrierter
   Zustand.
7. **Grenzen:** 72-/168-h-Pfade bleiben ohne ihren eigenen
   Holdout-Kandidaten bewusst roh. A/B-Gegenprobe: `TANKAPP_CALIBRATION=0`
   (Kandidaten und Messfelder werden weiter erzeugt, Pfade bleiben roh).
   Die Kalibrierung darf nie eine Rechtsregel verletzen: die 12-Uhr-
   Projektion gilt nach der Umlage erneut.

#### 7.2.5 Entscheidungsschicht, M7-Gate und Freigabekette (`app/`)

- **Gates getrennt:** `calibrated` (technische 24-h-PIT-Kalibrierung) ist
  **keine** Produktfreigabe. `decision_ready` braucht zusätzlich das
  **M7-Ledger-Gate** auf abgerechneten echten Advice-Snapshots und die
  vollständige Evidenzkette (Kapitel 2.5).
- **M7-Gate (`app/feedback.py`):** Zähl-Gate über der Verteilungs-P-
  Kohorte mit diesen Regeln:
  - `gate_n ≥ 100` (Konstante `M7_MIN_RECOMMENDATIONS`) — die
    Grundgesamtheit ist die **Vertragskohorte über die gesamte
    Lernzeit**, nicht das 30-Tage-Fenster;
  - **Brier** gegen **zwei naive Referenzen**, Leave-One-Out-berechnet
    (Basis- und Klima-Referenz) — das Gate vergleicht keinen Punkt-Brier
    gegen einen festen Wert, sondern prüft, ob die App ihren
    Informationsvorsprung gegenüber trivialen Vorhersagen belegt;
  - die Unsicherheit wird als **Block-Bootstrap-KI über Tagesblöcke**
    mit Kish-ESS (statt Tick-Zahl) gebildet — ein systematischer Versatz
    (+10 pp) darf nicht „kalibriert“ durchgehen;
  - **Bias und Reliability-Steigung werden gemeinsam** block-resamplt
    geprüft (Skill und Kalibrierung sind getrennte Aussagen);
  - vor der M7-Freigabe nennt die Grauzone **keine Zahl**;
  - seit 0.68.0 bindet die Freigabe an **Vertragskohorten** (Kraftstoff,
    Modellvertrag ohne Fit-ID, Kalibrierungsmodus, Entscheidungsvertrag,
    bestätigter Regime-Zustand) — ein Vertragswechsel startet die
    Statistik neu (Trade-off: sauber statt gepoolt; strenge Kohorten
    brauchen bis n ≥ 100 je Kohorte real Wochen/Monate);
  - der Schwellen-Nachzug darf **keine Prozent-Gates** verändern, um
    Güte künstlich passend zu machen.
- **Ledger-Technik (`app/feedback.py`):** Episoden bündeln Empfehlungen
  bis zur Buchung oder zum Verfall; wiederholtes Öffnen darf die
  Gütemessung nicht vervielfachen (Snapshots werden zusammengefasst);
  Settlement bewertet gegen die Preisgeschichte auch **ohne** Tankbeleg
  (mit doc-beschriebenem Kulanzschlitz); sequentieller
  Schrumpfungs-Schätzer `estimate_p` (expanding window); tie-Credit;
  Storno mit Audit-Spur.
- **Schwellen-Nachzug (`app/thresholds.py`):** Deterministischer
  Regulator aus dem Ledger: Rauschband ± 2 SE, Deadbands
  (`MIN_P_DEADBAND = 0.02`, `MIN_EUR_DEADBAND = 0.05 €`),
  Schrittbegrenzung (`MAX_P_STEP = 0.10`), Ziel-Trefferquote
  `hit_elsewhere` 60 % (darunter steigt nur die Netto-Schwelle der
  Umweg-Empfehlung, `elsewhere_p` bleibt Kalibrierungssache). Startwerte:
  `now_p = 0.50` (fix), `elsewhere_net_eur = 1,50 €`, `elsewhere_p = 0.50`,
  `elsewhere_borderline_eur = 0,50 €` (untere Grenze der Grauzone).
- **Getrennte €- und P-Semantik:**
  - `saving_eur` (pfadbasiert, „bis zu“, aus den Fensterminima) ≠
    `saving_median_eur` („erwartet“, Vergleich zum Minimum der
    Median-Kurve); die primäre Antwort und die Fensterlisten verwenden
    dieselbe Semantik;
  - `expected_saving` = **Median der Draw-Fensterminima**
    (`app/pside.py`, benannte Basis) — Konsistenz mit der Abrechnung;
    ct/L und € im Text kommen aus derselben Basis;
  - `p_besser` (brutto: P(Alt-Fenster-Minimum ≤ Ankerpreis − 1 ct),
    ohne Umwegkosten) ≠ `p_lohnt` (netto, gemeinsame Draws);
  - der Nutzenvertrag (`app/benefit.py`) benennt jede Basis:
    Median-Potenzial ≠ arithmetische Erwartung, `strategy_utility =
    None` beim Emit, Oracle-Untergrenze getrennt.
- **Restzeit und Mengen:** Ein Fenster ist die Menge der Prognosepunkte
  in `[now, latest_by]`; vergangene Punkte und Starts dürfen weder
  Medianpreis noch Ranking, P, Potenzial oder Strategie beeinflussen;
  `latest_by` ist ein inklusiver Grenzpunkt; der abgeschnittene
  Median-Spareffekt ist ein mögliches Upside, **weder** arithmetische
  Erwartung **noch** Garantie. Die angefragten Liter sind nicht
  automatisch die verfügbare Tankmenge: im physischen Modus wird mit der
  freien Kapazität gerechnet (55 L Anfrage bei 25 % in einem 55-L-Tank
  bedeuten 41,25 L); `what_if` darf 55 L als Szenario zeigen, ist
  ausdrücklich hypothetisch und sperrt eine reale Aktion.
- **Umweg-Ökonomie (`app/route.py`, eine ökonomische Quelle für alle
  Pfade):** Brutto = Δp · L; K = d·(c/100)·p + (d/v)·z (zusätzlicher Weg
  d in km, Verbrauch c in L/100 km, Preis p, Geschwindigkeit v,
  Zeitwert z in €/h); Netto = Brutto − K; kritische Preisdifferenz = K/L.
  Bei einer Extrafahrt zählt Hin- und Rückweg, bei `onroute` nur der
  zusätzliche Weg; Sprit- und Zeitanteil bleiben unterscheidbar, der
  eingesetzte Zeitwert wird ausgewiesen.
- **Ledger-Integrität:** Stores sind **fail-closed** (ein überschriebener
  bzw. beschädigter Store erzeugt einen Alarm, keine Stille — Test
  `tests/test_s3_store_integrity.py`); Archivzeilen gehören zur
  Jahres-/Allzeitbilanz und zur M7-Grundgesamtheit; 90-Tage-Retention
  lagert in ein Archiv aus, das mitgelesen wird.
- **TS/Python-Parität:** `tests/fixtures/score_parity.json` hält die
  Score-Rechnung der Labor-Seite (Python `app/stats_summary.py` ↔ TS
  `web/src/data.ts`) inklusive `null`-Ränder und Einheiten-Verhältnis
  fest — Test `tests/test_o21_score_parity.py`.

### 7.3 Invaranz- und Paritäts-Fixtures (die „Zeugen“)

| Fixture | Test | Was sie arretiert |
|---|---|---|
| `tests/fixtures/b0_invariance.json` | `tests/test_b0_invariance.py` | Fit, Prognose (beide Kerne, Ensemble, gemeinsame **und** unabhängige Ziehung) und Backtest-Kennzahlen **bitgleich** gegen den Stand vor der Messgrundlagen-Änderung B0. Wer den Fit absichtlich ändert, erzeugt die Fixture neu **und** schreibt im Commit, warum — die Fixture ist der Zeuge, nicht die Behauptung. |
| `tests/fixtures/score_parity.json` | `tests/test_o21_score_parity.py` | Gleiche Einheiten im Verhältnis (O21-Fix) und `null`-Parität TS ↔ Python in der Labor-Bewertung |
| Salz-Draws | `tests/test_a11_shared_draws.py` | Bitgleiche Reproduktion der gemeinsamen Ziehung |
| B0-Zähler | `tests/test_b0_counters.py`, `tests/test_b0_app.py` | Die Audit-Felder (`ar_shrink_events`, `ar_state_reset`, `ar_detail`, `ensemble.weight_spread`, `pava_pool_stats`) sind vorhanden und konsistent; `predict(model, hours, diagnostics={})` füllt die PAVA-Diagnose, mit und ohne Dict ist die Prognose identisch |

### 7.4 Manuelle/statistische Prüfliste (Modell)

**A. Selbstkonsistenz (Demo-Stack + Code-Lektüre):**

1. `model_kind`/`shared_draws`/`day_pair` in der Veröffentlichung
   (`/api/v1/forecast`) sind `profile_ar2`/`true`/`true` — derselbe
   Vertrag wie der NAS-Lauf; die acht Labor-Karten tragen die Werte aus
   derselben Zeile (arretiert im Test
   `test_demo_stack_liefert_publikation_und_frische_preise`).
2. `backtest_model_kind` und veröffentlichter Kern müssen zusammenpassen;
   bekannte offene Stelle: der Ensemble-Kern (Harmonik) im Backtest
   versus `profile_ar2` in der Veröffentlichung — sie ist im
   Projektstand als offene Arbeit benannt. Der Gutachter prüft, dass sie
   **benannt** bleibt, und bewertet sie als bekannte offene Arbeit,
   nicht als stillen Regelbruch.
3. Backtest-Report (Rezept unten): `model_kind`, `shared_draws`,
   `day_pair` benennen den gemessenen Pfad; `pit` je Station/Horizont;
   `ar_shrink` über alle Folds; DST-Block bei Zeitumstellung;
   Regime-Blöcke bei Kanten.

**B. Ehrlichkeit (Demo-Stack):**

4. `calibrated` ist sichtbar getrennt von `decision_ready`; ohne
   M7-Daten steht „Das Modell lernt noch — n von 100 … Die Preise unten
   sind gemessen.“ (Stufe C) — keine Prozentzahl.
5. 72-/168-h-Bänder tragen **keine** Kalibrierungsbeschriftung.
6. Kalibrierungs-Kachel (Labor): aktive Kurve und 24-h-Kandidat
   getrennt; `insufficient_pit`/`regime_blackout` als Zustände lesbar;
   Ledger-Brier für `raw` und `pit_24h` getrennt (zeitgetrennt, kein
   Kausalbeweis).
7. Fehlende Evidenz → `null`/Sperrgrund: `blocking_reasons` im
   Decide-Payload; `price_stale` sperrt Aktionen, zeigt aber die
   Preisspanne.

**C. Reproduzierbarkeit (optional, mit vorhandenen Engine-Daten):**

```bash
# Datenqualität (ohne Training)
python -m engine inspect --data <CSV-Dateien> --polling <polling.json>
# Rolling-Backtest, 21 Prüftage; Exit 0 = berechnet, 1 = Eingabefehler, 2 = keine Vergleichspunkte
python -m engine backtest --data <CSV-Dateien> --polling <polling.json> --days 21
# Fit (mindestens 28 nutzbare Tage; Trainingsfenster 42 Tage)
python -m engine fit --data <CSV-Dateien> --polling <polling.json> --out <forecast.json>
# Inference aus dem gespeicherten Modell, ohne Refit
python -m engine forecast --model <forecast.json> --hours 24
```

Zwei identische Backtests auf denselben Daten liefern **bitgleiche**
Kennzahlen; `forecast` rechnet deterministisch aus dem gespeicherten
Modell. Ein fehlgeschlagener Fit ersetzt das letzte gültige Modell
nicht; die Prognose beginnt am Fit-Cutoff, nicht stillschweigend bei
„jetzt“; Modelle älter als 24 h und am Cutoff veraltete Eingangsdaten
werden gekennzeichnet. `TANKAPP_CALIBRATION=0` liefert identische
Roh-Pfade bei weiter vorhandenen Kandidaten/Messfeldern (A/B-Vertrag).

**D. Walk-forward-Abnahme (Replay-Harness):**

Der Harness fährt die **unveränderte Produktionskette** (Aufbereitung →
Fit → Tagesblock-Bootstrap → PIT-Kandidatur → finale 12-Uhr-Projektion →
atomare Veröffentlichung → Decide) über Folds (je lokaler Tag und
Ursprungsstunde, auch 23-/25-h-Tage) mit strikt vor dem Ursprung
geschnittenen Dateneingängen (kein Blick in die Zukunft) gegen
**vorab festgelegte** Akzeptanzmargen; ein negatives Ergebnis ist
zulässig und ändert nichts automatisch. **Ehrlicher Stand:** Die Rolle
`synthetic` (Ersatzbestand) sichert die Regression, ist aber **kein**
Abnahmebeweis. Der einmalige Freigabelauf mit einem äußeren, zeitlich
unangetasteten Abnahmeset (Rolle `acceptance`) steht noch aus — bis
dahin sind alle Replay-Zahlen Entwicklungsstand (Kapitel 9).

### 7.5 Historische Befunde (Prüfliste für die Arretierung)

| Befund | Inhalt | Status |
|---|---|---|
| Externes Gutachten 10.09.2026 (archiviert) | Statistische Methodik: F2 — bei B=200 Ziehungen war das FDR-Gate mit 11 Stationen mathematisch unlösbar (kleinstmöglicher q-Wert ≈ 0,055 > 0,05): die App hätte nie eine Empfehlung abgeben können; F1 — vermuteter Prozent-Darstellungsbug; F5 — Median war 21 Tage „blind“ nach Regimewechsel | F2: behoben (B=2000 fest in der Selektion), F1: im geprüften Code nicht reproduzierbar (alle Anzeigen rechnen × 100), F5: umgesetzt (EW-Median `delta_ew_ct`, HWZ 7 d, CUSUM-Bruchflag) — mit Nachtrag, der jeden Punkt gegen den Code prüft |
| NAS-/Pi-Prüfung 20.09.2026 (M1/M6, archiviert) | M1: Der Horizont-Filter der Kalibrierung vertauschte Vorlauf und Fensterlänge — die 24-h-Rekalibrierung lief nie (ein `== 24`-Filter traf null Zeilen); M6: Abdeckungsbänder wurden aus Tick-Zahlen statt aus Kish-ESS gebildet; Provenienz-Fingerprint fehlte | im Code korrigiert (0.62.0); der Betriebsnachweis auf NAS-Daten bleibt offen (Kapitel 9) |
| R1 „Mathe/Statistik: geprüft und entlastet“ (23.09.2026) | Zeilenweise Lektüre der Kernpfade: Strukturmodell, AR(2)-Stabilisierung, Holiday-Pooling, Ensemblemischung, Day-Pair/Shared-Draw, Missingness-Policy, PIT-Midrank, PAVA-Holdout, Rolling-PICP, Strict-End-Schnitt, `expected_saving`, physischer Modus, H3-Regulator, Score-Parität, Nutzenvertrag, Ledger-Schrumpfung, Umweg-Ökonomie — **keine Rechenfehler gefunden** | Stand: entlastet; Runde 2 bestätigte die Kernpfade erneut |
| R3 (23.09.2026, F1–F13) | Labor-Karten: falsch formatierte Zeiten („22.67:00“), Fachbegriffs-Fehler („B=2000 Blöcke“), falsche Zuordnungen (holiday_beta, PIT-Größe), unvollständige Sätze („nur an 12:00 darf er steigen“ unterschlägt Regime-Kanten), irreführende Titel/Labels („Gewichte je Horizont“ bei `not_estimated`; „Regel-Ergebnis/Orakel“ als Kosten verkauft), MASE-Namenskollision (One-Step vs 24h-Fenster), „stabil ja“ neben CUSUM-Bruchflag, dünne Heatmap-Referenz (50 % bei n=2) | Darstellung/Labels behoben (PR #222, Commit `69bff95`); offen gebliebene Punkte des Befunds: MASE-Label-Trennung (1step vs 24h) und Fensterbilanz-Text (episodes vs recommendations) — sind im Befund als offene Punkte benannt |

## 8. Testsituation: Was bereits arretiert ist

### 8.1 Das Ratchet-Prinzip

Die Testsuite ist keine Momentaufnahme, sondern **Arretierung**: Jede
frühere Befund-Fix-Paarung hat ihren Test, der das korrekte Verhalten
festhält. Regressions-Tests prüfen dabei bewusst **Verhältnisse und
Konventionen** statt absoluter Werte (z. B. `X-Process-Time < 200 ms`
nach 400 ms Clientpause), damit sie nicht durch einen langsameren Läufer
rot werden. Ein roter Test bei Code-Änderung ist ein Befund, kein Zufall —
und ein Test, der das **Falsche** arretiert (die Befunde A1 und N1 zeigten
beides), ist Teil des Befunds und wird mit dem Fix umgezogen.

### 8.2 Übersicht der Arretierung je Prüffeld

| Prüffeld | Python (1530 Tests am 23.09.2026) | Web (1250 Tests am 23.09.2026) | Browser |
|---|---|---|---|
| Texte | `test_rp2_fallback.py`, `test_notify.py`, `test_o29_window_push.py`, `test_glossary.py`, `test_operations.py` (jeder lokale Doku-Link und jeder Anker existiert), `test_o28_comment_runtime_truth.py` (Kommentare behaupten nichts Falsches) | `microcopy.test.ts`, `format-convention.test.ts`, `a11y.test.ts`, `chartAlt.test.ts`, `fills.test.ts`, `Notices.test.ts`, `FeedbackBanner.test.tsx`, `states.test.tsx`, `data-age.test.ts` | — |
| GUI | `test_e2e_demo.py` (Serververtrag ohne Browser), `test_quality_gates.py` (Demo-Suite bleibt mockfrei; Demo-Vertrag N2), `test_o22_publication_size.py` … `test_o39_read_token.py` (Serververträge je Befund), `test_s3_store_integrity.py`, `test_a21_b2_readstate.py`, `test_a21_b2_latency.py` | View-Tests je Bereich (u. a. `stations.test.ts`, Now-Tests, `Labor.test.tsx` mit echter Payload-Form) | `web/e2e/*` mit Mocks (Desktop+Mobil), `demo.spec.ts` + `mobile.spec.ts` + `failover.spec.ts` ohne Mocks (1440/390/320 px) |
| Modell | `test_b0_invariance.py` (Bitgleichheit), `test_b2_calibration.py`, `test_b3_daypair.py`, `test_a11_shared_draws.py`, `test_a10_ensemble.py`, `test_backtest.py`, `test_bootstrap.py`, `test_models.py`, `test_selection.py`, `test_probabilities.py`, `test_pside.py`, `test_o21_score_parity.py`, `test_o44_null_draws.py`, `test_o45_saving_basis.py`, `test_a21_b4_contracts.py` (DST/Restfenster), `test_a21_b5_gate_context.py` (Kohorten), `test_a21_b5_missingness.py`, `test_a21_b5_replay.py` (Harness), `test_decide_tank.py` (Mengen), `test_o4_picp_days.py`, `test_o5_p_source.py`, `test_o6_gate_interval.py` | `lab.ts`-Tests (Beta-Quantil-Intervall: Lanczos-betacf + Bisektion), `scoreRows`-Parität | — |
| Qualität | `test_quality_gates.py`, `test_o37_server_metrics.py` | Build (TypeScript + Vite) | Lighthouse + Last (eigener Qualitäts-Workflow) |

### 8.3 CI-Struktur

| Workflow | Inhalt | Wann |
|---|---|---|
| `tests.yml` | Prüfspiegel: engine-Job auf Python 3.11 **und** 3.12, web-Job auf Node 22 (Vitest, Build, Playwright mit Mocks, Playwright ohne Mocks), **Suite im NAS-Docker-Image** (derselbe Interpreter, dieselben Paketversionen wie ausgeliefert) | jeder Push/PR |
| `quality.yml` | Lighthouse (3 Zustände × 3 Läufe) + Lastpfad gegen den Demo-Stack | PRs auf `web/`/`app/`/`engine/`/`ops/quality/`, sonntags 04:17 UTC |

Der Abgleich „getestet = ausgeliefert“ ist für die Robustheitsfrage
zentral: „Grün getestet“ bedeutet, dass **derselbe** Stand im
**ausgelieferten** Image geprüft wurde — nicht nur, dass ein Runner grün
war. Bei Rot hängt die Kurzfassung des Fehlers als PR-Annotation, nicht
nur im Log.

## 9. Ehrliche Grenzen: Was die grüne Suite nicht beweist

Dieses Kapitel ist Teil der Prüfaufgabe: Der Gutachter soll prüfen, dass
die App **über genau diese Grenzen hinweg ehrlich ist** (sichtbar benannt,
fail-closed, keine verkaufte Sicherheit). Die Grenzen selbst sind in der
App als ausstehende Nachweise geführt.

| Bereich | Was nicht bewiesen ist | Was die App stattdessen tut |
|---|---|---|
| M7-Produktfreigabe | Keine ausreichend abgerechneten **echten** Advice, keine bestandenen Brier-/Reliability-Gates über Betriebszeit; strenge Vertragskohorten starten die Statistik neu (bis n ≥ 100 je Kohorte vergehen real Wochen/Monate) | `decision_ready = false`, Stufe C („Das Modell lernt noch — n von 100 … Die Preise unten sind gemessen.“), `blocking_reasons` maschinenlesbar |
| Kalibrierung der **veröffentlichten** Kurve | Out-of-sample-Replay der publizierten Kurve braucht Betriebshistorie; der Kalibrierungsnachweis läuft auf dem zeitgetrennten PIT-Holdout des Backtests | `calibration` ist die tatsächlich angewandte Hülle, `calibrated` ist nur technischer Zustand; 72/168 h roh; Regime-Blackout 45 Tage |
| Modellgüte auf echtem Bestand | Vergleich je Station/Horizont auf realen Daten (inkl. alternativer Kerne); Backtest-Gates gelten nur für den geprüften Bestand | Report benennt Messwerte **und** Kriterien getrennt; `mase: null` mit Grund statt stummer Null |
| NAS/Pi-Betriebsabnahme | p95 ≤ 300 ms im realen LAN, Pollkadenz, RPO/RTO, Stromausfall, Watchdog, Cache-Mount — gemessen ist nichts; der Audit-Befund „Overview p95 2,00 s“ war die einzige bekannte Messung, der Lesepfad ist seither entkoppelt/gecacht (Sandkasten-Messung, keine NAS-Abnahme) | Messlatte und Messrezept stehen fest (siehe unten); der Server misst sich selbst (`performance`, `X-Process-Time`) — als Antwort auf „warum hängt das gerade“, nicht als Abnahme |
| Missingness-Policy | Die Ablation ist reproduzierbar, aber synthetisch (Einzelrealisierung, PICP unter Nominal) — kein Policy-Wechsel ohne robusten Nachweis über echte Lückenmuster | Default `zero_fill` (12-Uhr-Integrität) bleibt; fehlende Residuen werden je Zeitpunkt gemessen (`fill_residual_draws`) |
| Hampel-Filter | Entfernt den ersten Poll eines echten Sprungs (FFill-Bucket) — Trainingspreise starten bestätigte Sprünge einen Bucket später | `price_raw` bleibt ungefiltert; die Diagnostik ist ausgewiesen |
| Replay-Freigabe | Einmaliger Freigabelauf mit äußerem, zeitlich unangetastetem Abnahmeset (Rolle `acceptance`) noch nicht gelaufen | Alle Replay-Zahlen werden als Entwicklungsstand benannt; `synthetic` = Regression |
| Backup/Restore | Datenbankkonsistente Influx-Sicherung, Restore-Nachweis mit Produktionsdaten im Feld, RPO/RTO-Stopuhr | Runtime-Backups sind validiert veröffentlicht (Erfolgsmanifest), der Restore läuft mit Verifizierer gegen die Quelle |
| Saison/Regime | Erster Regel-Winter nach der 12-Uhr-Regel; Rechtslage-Veränderungen | Die Juli-Generalprobe (Frankfurt, E10 und Diesel) ist **gemessen**; Simulationen werden nicht als Live-Messung verbucht |
| Persönliche Rückkopplung | `w(h)` (Stundenprofil) braucht ≥ 8 Füllungen | Default bis dahin; Belegdaten vortäuschen keine Marktmodell-Güte |
| Kampagnenquote | 6/2/2 nur offline | Bedarf am realen Mehrstadtbetrieb messen, nicht als NAS-Funktion behaupten |
| Ensemble-Gewichte | Horizontgewichte nicht geschätzt | Als `not_estimated` ausgewiesen; keine unbelegte zweite Mischung |

**Die vorab festgelegte Messlatte der Betriebsabnahme** (für den
nachholenden Messlauf; vor dem Lauf festgelegt, nicht danach):

| Strecke | Ziel |
|---|---|
| Latenz Kern-Endpunkte (`/api/v1/health`, `/api/v1/overview`, `/api/v1/decide`) | p95 ≤ 300 ms im LAN |
| Pollkadenz Sammler | 300 s je Stadtset, Fenster 06:00–24:00, Toleranz 20 % |
| RPO (Backup) | ≤ 30 min |
| RTO (Restore) | ≤ 240 min |
| Restore-Verifikation | fachlich bestanden (Verifizierer gegen die Quelle) |

**Konsequenz für die Gutachterstellung:** Die Robustheitsbehauptung
„Texte, GUI und statistisches Modell sind robust“ gilt auf der
**Software-Ebene** am geprüften Commit — Code, Verträge, Tests,
fail-closed-Verhalten. Aussagen über Live-Datenqualität und
Betriebsrobustheit sind beschränkt auf die vorliegenden Messrezepte und
ausstehende Messungen. Jede Stellungnahme, die darüber hinausgeht, wäre
eine Behauptung ohne Nachweis — und damit gegen die Ehrlichkeits-Regel
der App selbst (Kapitel 2.5).

## 10. Befundprotokoll für den Gutachter

### 10.1 Format je Befund

| Feld | Inhalt |
|---|---|
| ID | Bereich + Nummer: `T1` (Texte), `G1` (GUI), `M1` (Modell) — fortlaufend je Befundbericht |
| Prüffeld | Texte / GUI / Modell (oder „Grenzen“, falls eine ehrliche Beschränkung fehlt) |
| Schwere | **hoch** = direkte Nutzerschädigung oder falsche Aussage (Vorbild: A1 — Atlas zeigte empfohlene Stationen als teuer); **mittel** = falsche Grundgesamtheit, gemischte Zählvariablen, veraltete Berechnungsgrundlage (Vorbild: A2/A3/N2); **niedrig** = tote Pfade, Docstring-/Label-Drift, Randfall-Parität (Vorbild: A5/B3/F1) |
| Fundstelle | `datei:zeile` bzw. Bereich + Panel der GUI; bei Server: Endpunkt + Feld |
| Behauptung | Was der Code/Der Text behauptet (erwartet) |
| Beobachtung | Was tatsächlich passiert (ist) — mit Reproduktion |
| Reproduktion | Schritt für Schritt: Commit, Befehl, Demo-Stack-Zustand, Viewport |
| Beleg | Screenshot, curl-Ausgabe, Testlauf-Log |
| Betroffener Test | Welcher Test (falls einer) das Verhalten arretiert — ein Test, der das Falsche arretiert, ist Teil des Befunds und muss mit dem Fix umgezogen werden (Muster: A1 — die Tests trugen die Inversion) |

### 10.2 Arbeitsweise des Repos (Erwartung an den Umgang)

1. Der Befund wird als GitHub-Issue/-PR an das Repository `kollb/TankApp`
   eingereicht.
2. Der Fix erfolgt mit **gleichem Commit** wie die Korrektur des
   arretierenden Tests (Befund → Fix → Ratchet, Kapitel 1.3).
3. Ein datierter Befundbericht mit Stand, Status und Nachfolger-Verweis
   gehört in das Archiv-Verzeichnis des Repos; gültige Regeln werden in
   das zuständige Fachdokument des Repos übernommen.
4. Bei einem App-Release werden die Versionskonstante und die
   Release-Historie gemeinsam gepflegt; rein redaktionelle Änderungen
   sind kein App-Release.

Für den Gutachter: Es gibt keinen separaten Bugtracker außerhalb von
GitHub; die Archive im Repository sind die lückenlose Historie der Befunde
seit 08.09.2026.

### 10.3 Abgabepaket (empfohlen)

- Befundbericht als Markdown (Format 10.1) — bevorzugt direkt als PR in
  das Archiv-Verzeichnis.
- Nachvollziehbarkeit: Commit-Hash, Umgebung (Python/Node-Versionen, OS),
  Zeitstempel der Testläufe, ausgeführte Kommandos.
- Abgrenzung: reproduzierter Befund vs. offener Nachweis (wie die
  NAS-/Pi-Prüfung vom 20.09.2026 es vorbildlich trennt).

## 11. Anhang: Parameter, Schwellen, Abkürzungen

### 11.1 Kernparameter und Schwellen (mit Fundstelle im Code)

| Parameter | Wert | Fundstelle |
|---|---|---|
| Trainingsfenster / harte Untergrenze | 42 Tage / 28 Tage (`min_train_days`) | `engine/models.py` (`fit`) |
| Live-only-Handover | 90 Tage (Archiv fällt aus dem Modell-Input; nicht im M7-Pfad) | `engine bootstrap` (`live_only_days`) |
| Bootstrap-Ziehungen B | 2000 Betrieb / 200 Demo | `engine/models.py`, `ops/quality/demo_data.py` |
| EW-Halbwertszeit Bootstrap / δ̂ | 14 Tage / 7 Tage | `engine/backtest.py`, `engine/selection.py` |
| AR(2)-Stabilitätsnetz | × 0,9, Radius 0,98, max. 100 Schritte | `engine/models.py` (`AR_SHRINK_FACTOR`, `AR_STABILITY_RADIUS`, `AR_SHRINK_MAX_STEPS`) |
| Backtest-Gates | MASE < 0,95 · Pinball τ=0,5 besser als Naive · Pinball τ=0,75 (3× Strafe) besser als Naive · PICP 95 % ∈ [90, 98] % | `engine/backtest.py` (Kriterien in `report.json`) |
| Rolling-PICP-Badge | grün ≥ 93 % / gelb ≥ 90 % / rot < 90 % (nominal 95 %; < 72 Punkte = keine Aussage) | `engine/backtest.py` |
| Kalibrierung | 2/3 Trainings- / 1/3 Holdout-Origins; Quantil-Bänder + PICP95-Regression ≤ 2 pp; Provenienz-Fingerprint; ein Lauf Verzögerung; Regime-Blackout 45 lokale Tage; Gitter 0,25 pp (401 Levels) | `engine/calibration.py` |
| M7-Gate | n ≥ 100 je Vertragskohorte; Brier gegen LOO-Basis- und Klima-Referenz mit Block-Bootstrap-KI (Kish-ESS); Bias + Steigung gemeinsam | `app/feedback.py` (`M7_MIN_RECOMMENDATIONS`) |
| Schwellen-Startwerte | `now_p` 0,50 (fix) · `elsewhere_net_eur` 1,50 € · `elsewhere_p` 0,50 · `elsewhere_borderline_eur` 0,50 € · Ziel-Trefferquote `elsewhere` 60 % | `app/thresholds.py` (`DEFAULT_THRESHOLDS`, `TARGETS`) |
| Schwellen-Regulator | Rauschband ± 2 SE · Deadbands 0,02 (P) / 0,05 € · max. Schritt 0,10 (P) · nur €-/Zeit-Schwellen | `app/thresholds.py` |
| Freigabekette | frischer Preis (< 30 min) · offene Station · frische Herkunft · Modell ≤ 24 h mit Zukunfts-Punkten · vollständige endliche Pfade · veröffentlichte Güte ≥ 3 Tage → sonst `blocking_reasons`; Handlung mit `valid_until` | `app/decide.py` |
| Polling | 06:00–24:00 Uhr, 1 Request / 300 s je Stadtset (gemeinsames Budget, Round-Robin) | `data-tools/collect_prices.py` |
| Daten-Frische-Schwellen (GUI) | Preis 30 min · Modell 24 h (1440 min) · Selektion 36 h; doppelt = roter Ton | `web/src/data.ts` (`dataAgeNote`) |
| Performance-Budgets | p95 API-Antwort LAN ≤ 300 ms (`REQUEST_BUDGET_MS`) · p95 `/overview` Last ≤ 1000 ms · 304 ≥ 20 % · Lighthouse a11y/bp/seo ≥ 0,90/0,90/0,80, CLS ≤ 0,1, Volumen ≤ 1,5 MB | `app/metrics.py`, Qualitäts-Workflow |
| Betriebsabnahme (Messlatte) | p95 ≤ 300 ms LAN · Poll 300 s ± 20 % · RPO ≤ 30 min · RTO ≤ 240 min · Restore fachlich verifiziert | `data-tools/ops_acceptance.py` (`ACCEPTANCE_TARGETS`) |
| 12-Uhr-Regel | Preiserhöhungen nur um 12:00 Uhr (seit 2026-04-01); PAVA je [12:00, 12:00)-Segment + Regime-Kanten; Verletzungen gezählt (`law_rise_outside_noon`), nicht gelöscht | `engine/models.py` |
| Tankmenge / Beleg-Liter | Rechengröße 10–100 L (ganze Liter, Schritt 1) / gebuchter Vorgang 5–100 L (Schritt 0,5) | `app/profiles.py`, `web/src/data.ts` (`FILL_LIMITS`) |
| Umweg-Ökonomie | Brutto = Δp · L · K = d·(c/100)·p + (d/v)·z · Netto = Brutto − K · kritische Differenz = K/L | `app/route.py` (`net_economics`) |
| Selektion (δ̂) | LOO-Median + EW-Median (HWZ 7 d) + CUSUM (h = 2,0); Bootstrap-KI B=2000, FDR Benjamini-Hochberg q < 0,05; Coverage ≥ 85 % relativ zum Stadt-Bestwert im Poll-Fenster; AV-Score, Tagesform, Risiko | `engine/selection.py` |
| Preisfortschreibung | höchstens 30 Minuten; geschlossene/veraltete Preise werden nicht gefittet | `engine/models.py` |

### 11.2 Abkürzungen und IDs

| Bezeichnung | Bedeutung |
|---|---|
| ADR | Architecture Decision Record (Entscheidungsakten im Repository) |
| PIT | Probability Integral Transform — Kalibrierungsmaß über Mittelränge (0,5-Credit bei Ties) |
| PICP 95 % | Anteil der Outcomes im 95 %-Intervall; nominal 95 %, Zielband 90–98 % |
| MASE | Mean Absolute Scaled Error gegenüber saisonaler Naive (< 1 = besser) |
| Pinball τ | Quantil-Verlust; τ = 0,75 bestraft Unterschätzung (Warten in eine Erhöhung) 3× stärker |
| PAVA | Pool Adjacent Violators — isotone Regression (L2-Projektion) |
| EW | Exponentiell gewichtet (Halbwertszeit-basiert) |
| M7 | Produktfreigabe-Gate auf abgerechneten echten Advice (Brier/Reliability, n ≥ 100 je Kohorte) |
| H3 | Schwellen-Regulator (Name aus der Befundserie, kein Modell) |
| A21-B* | Befund-/Batch-Serie der NAS-/Pi-Prüfung (20.09.2026): B1.4 = Freigabekette, B2 = Server-Selbstmessung, B3 = Archiv/Backup, B4 = Zeitblöcke/Restfenster, B5 = Kohorten/Missingness/Replay/Betriebsabnahme |
| O* (O1…O45) | Befundserien der GUI-/Tiefenanalysen (u. a. O45 = Ersparnis-Basis, O37 = Server-Metrik, O40 = Diagramm-Textalternativen, O21 = Score-Einheiten, O26 = Lesepfad-Sperre) |
| N* (N1, N2, N3) | Befunde der Runde 2 (23.09.2026): Labor-Payload, Demo-Vertrag, Versionsstempel |
| A1–A8, B1–B3 | Befunde der Runde 1 (23.09.2026): GUI-Logik / GUI-Texte |
| F1–F13 | Befunde der Runde 3 (23.09.2026): Labor-Karten, Spielplatz, PIT, Güte |
| B0 | Messgrundlagen-Batch (Audit-Felder, bitgleiche Invaranz-Fixture) |
| B2/B3 | PIT-Rekalibrierung / Day-Pair-Blöcke (Engine-Batches) |
| δ̂ | Preis-Abstand der Station zur Umgebung (Leave-One-Out-Median + EW-Median + CUSUM) |
| Ratchet | Test, der einmal korrigiertes Verhalten für immer arretiert |
| FDR | False Discovery Rate (Benjamini-Hochberg) |
| LOO | Leave-One-Out (eigene Station nicht in der Baseline) |
| Kish-ESS | Effektive Stichprobengröße für korrelierte Ziehungen |

### 11.3 Eigenständigkeit

Dieses Dokument ist vollständig ohne jeden weiteren Zugriff lesbar: jede
Regel, jeder Parameter, jede Schwelle, jedes Wortlaut-Muster und jeder
Testname, die für die Prüfung gebraucht werden, stehen in diesem
Dokument selbst. Der hier zitierte Code-Stand ist der Commit `69bff95` von
`main`; alle in den Prüflisten benannten Code- und Testdateien dienen der
Ortung im Repository, nicht als Inhalt.
