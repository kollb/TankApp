# Qualitäts-Gates (Lighthouse + Last)

> Stand: 28.11.2026 · App-Version **0.79.0** · Zuständig: `.github/workflows/quality.yml`

Zwei Dinge, die kein Unit-Test sieht, entscheiden im Alltag über „fühlt sich
gut an“ oder „hängt“: **wie schnell das GUI wirklich lädt** (M4-Kriterium
„Lighthouse > 90“) und **ob das Polling unter Last trägt** (B7: ein Aggregat
statt sechs Einzelabrufe). Beides wird seit D4 (0.31.0) gemessen — gegen
denselben Demo-Stack, damit die Zahlen vergleichbar bleiben. Die
Browserprüfungen trennen eine gemockte Alltagssuite von Live-Tests gegen echte
Serverantworten (siehe [Browser-Integration](#browser-integration-gemockt-und-ohne-mocks)).

## Inhaltsverzeichnis

- [Was gemessen wird](#was-gemessen-wird)
- [Frontend-Unit-Tests (Vitest)](#frontend-unit-tests-vitest)
- [Der Demo-Stack](#der-demo-stack)
- [Browser-Integration: gemockt und ohne Mocks](#browser-integration-gemockt-und-ohne-mocks)
- [Selbstmessung des Servers (seit 0.52.0)](#selbstmessung-des-servers-seit-0520)
- [Lokal ausführen](#lokal-ausführen)
- [Budgets](#budgets)
- [Messwerte](#messwerte)
- [B7-Rest: `route/evaluate` bleibt ein eigener Abruf](#b7-rest-routeevaluate-bleibt-ein-eigener-abruf)
- [Offen](#offen)

---

## Was gemessen wird

| Gate | Werkzeug | Gegenstand | Wann |
|---|---|---|---|
| Frontend-Unit-Tests | Vitest (`npm --prefix web run test`) | Aktive API-, Routing-, Entscheidungs-, Profil-, Formatter-, Glossar- und Barrierefreiheits-Verträge | `tests.yml`, web-Job vor Build und Browserprüfungen |
| Lighthouse | `@lhci/cli` (Chrome aus dem Playwright-Cache) | Drei GUI-Zustände: gefüllter Einstieg („Jetzt“), Labor (`?tab=labor`) und Einrichtungszustand (leerer Server), je 3 Läufe | eigener Workflow `quality.yml`: auf Abruf, sonntags 04:17 UTC, und bei PRs, die `web/`, `app/`, `engine/` oder `ops/quality/` anfassen |
| Lastpfad | `node web/load/overview.mjs` (keine Abhängigkeit) | `GET /api/v1/overview` — 8 Clients, 30 s, gemischt aus Volllesen und `If-None-Match`-Revalidierung | derselbe Workflow |

Warum ein **eigener** Workflow und nicht Teil von `tests.yml`: Der in
[AGENTS.md](../../AGENTS.md) festgeschriebene CI-Spiegel muss lokal ohne
Chrome-Download lauffähig bleiben. Die Gates sind teuer (Minuten), der Spiegel
ist schnell (Sekunden) — beides vermischt man nicht.

---

## Frontend-Unit-Tests (Vitest)

`npm --prefix web run test` läuft ohne Backend und ohne Browser. Beim Audit am
28.11.2026 wurden die Specs mit dem Importgraph der aktuellen Shell und den
Feature-Modulen abgeglichen. **38 verwaiste Specs** importierten entfernte
Module (`src/data.ts`, `src/views/*`, `src/state/overview.tsx`) oder
UI-Komponenten, die nicht mehr erreichbar sind. Sie wurden nicht durch
Kompatibilitätsdateien reaktiviert. Noch lebende Zusagen sind in aktuelle Tests
überführt: ETag-/Token-Cache (`api/client.test.ts`), Routing samt Browser-
History, Profil- und Filterpräferenzen, gesperrte Entscheidungen,
Stationsreferenz, Formatierung, Kontrast, Theme-Bootstrap, Glossar,
lokale Tankstand- und Profilbearbeitung sowie die retrybare Beleg-Outbox. Es gibt keine Tests mehr für nicht importierte
Legacy-Views oder doppelte Outbox-Implementierungen.

Lokaler Lauf am 28.11.2026: **15 Testdateien, 77 Tests bestanden**. Die Suite
läuft ohne Backend und Browser; sie ist keine E2E-Abnahme. Browserprüfungen
bleiben getrennte CI-Gates (siehe unten).

## Der Demo-Stack

Lighthouse gegen ein leeres GUI messen hieße: leere Panels, `error_code`
statt Antwort, keine Zahlen. Und ein Lastpfad gegen einen Server ohne Daten
misst nur den Rahmen. Also gibt es `ops/quality/`:

| Datei | Aufgabe |
|---|---|
| `ops/quality/demo_data.py` | Baut einen synthetischen Datenbestand: Polling-Set mit sechs Demo-Stationen (Koordinaten + Anker), eine Engine-Publikation aus einem echten Fit (24 h/7 d inkl. Bootstrap-Draws) und Preiszeilen in InfluxDB-Form. Fester Samen, kein Netz, keine echten Preise. |
| `ops/quality/demo_server.py` | Startet die **echte** App (`app.server.make_server`) mit injizierter Preisabfrage statt InfluxDB. Kein zweiter Server, kein Nachbau des Decision Layers. |

Die Preise teilen einen gemeinsamen Tages-Marktfaktor — ohne Gleichlauf wäre
die gemeinsame Bootstrap-Ziehung (A11) im Lastpfad wirkungslos.

Seit U7 (0.41.0) misst Lighthouse **drei** Zustände statt zweimal denselben
Startschirm: den gefüllten Einstieg auf dem Demo-Stack, den Labor-Bereich
über das Bereichs-Routing (`?tab=labor`, GUI-UX-BEFUND U4) und den
Einrichtungszustand auf einem zweiten, leeren Server (Port 1356). Die alte
zweite URL `?tab=statistik` zeigte nie einen eigenen Bereich — „Statistik“
ist seit dem Neuentwurf abgeschafft, beide Läufe sahen denselben Bildschirm.
Die aktuelle `AppShell` importiert die Feature-Seiten statisch; die frühere
Zusage `React.lazy` je View und eigene Bereichs-Chunks gilt daher nicht mehr.
Das Lighthouse-Gate misst die ausgelieferten Zustände, verspricht kein
Route-Code-Splitting.

---

## Browser-Integration: gemockt und ohne Mocks

Die Browserprüfungen sind bewusst getrennt. Die Alltagssuite
`web/e2e/app.spec.ts` verwendet `web/e2e/mockApi.ts` und routet die
`/api/v1/*`-Antworten. Sie prüft Verhalten der heutigen Shell unter
kontrollierten Antworten, nicht den Vertrag zum Server. Die Live-Suite lässt
die API unangetastet und fährt gegen den echten Demo-Stack beziehungsweise
den echten NAS/Pi-Failover-Handler. Sie deckt damit die Integrationslücke ab,
die ein reiner `page.route`-Test nicht sehen kann.

### Gemockte Alltagssuite

| | |
|---|---|
| Specs | `web/e2e/app.spec.ts` und `web/e2e/mockApi.ts` |
| Config / Aufruf | `web/playwright.config.ts` · `npm --prefix web run test:e2e` |
| Zusagen | Aktuelle Routen, Alias und Browser-History; Zuordnung einer gesperrten Entscheidung ohne Handlung oder Ersparnis; Profil-/Kraftstoff- und Filterpräferenzen; Labor-Bin-Vertrag; mobile Navigation und Überlauf; ETag-Cache mit 200/304. |
| Letzter lokaler Lauf | 14 Fälle über Desktop und Mobil: **12 bestanden, 2 viewport-bedingt übersprungen**. |

### E2E ohne Mocks (seit 0.38.0)

Der historische Abschnittsanker bleibt für Release-Notizen erhalten; aktuell
umfasst die Live-Suite die folgenden Demo-, Responsive- und Failover-Specs.

#### Live-Demo und Failover ohne Mocks

| | |
|---|---|
| Specs | `web/e2e/demo.spec.ts`, `web/e2e/mobile.spec.ts` und `web/e2e/failover.spec.ts`; keine `page.route`-Mocks. |
| Config | `web/playwright.demo.config.ts` startet `ops/quality/demo_server.py --rebuild` auf Port **1357**; Projekte 1440 × 1050, 390 × 844 und 320 × 720. |
| Aufruf | `npm --prefix web run test:e2e:demo` |
| Läuft in | `.github/workflows/tests.yml` (web-Job) nach der gemockten Suite; der Demo-Stack gehört zum CI-Spiegel, nicht zum langsameren `quality.yml`-Workflow. |
| Zusagen | Live-Entscheidung; ohne Stadt- und Stationsfilter bleibt der Tag ehrlich leer (`day: null`, „Noch kein Tagesverlauf vorhanden.“); echte Stationsnamen; `If-None-Match` → 304; Pi/NAS-Vertrag; Beleg-Outbox reiht einen retrybaren 503 ein und synchronisiert nach NAS-Rückkehr genau einmal. Die 400-Abweisung ohne Queue ist im Vitest-Regressionstest abgedeckt. `tests/test_e2e_demo.py` prüft separat die echte stationsbezogene Tageskurve samt Server-ETag. |
| Ratchet | `tests/test_quality_gates.py::test_e2e_demo_suite_ist_keine_mock_suite` hält Mockfreiheit, aktuellen Leerzustand und Demo-Config/CI-Verdrahtung fest. |
| Letzter lokaler Lauf | 24 Fälle: **20 bestanden, 4 projektbedingt übersprungen** (28.11.2026, ca. 23 s). |

**Responsive Zusagen der aktuellen Shell.** `web/e2e/mobile.spec.ts` prüft
im echten Demo-Stack bei 390 px und 320 px:

- Übersicht, Stationen, Labor, System, Einstellungen und Glossar ohne
  horizontalen Überlauf auf Dokumentebene.
- Alle drei Einstellungen-Unterbereiche ebenfalls ohne Überlauf.
- Das mobile Bereiche-Blatt schließt auf Escape und gibt den Fokus an den
  Menü-Auslöser zurück.

Die alte „Jetzt/Woche“-Abnahme mit `#jetzt-headline`, Microcopy-Streichlisten
und Legacy-View-Tests ist nicht mehr Teil dieser Suite; dafür gibt es keine
Kompatibilitäts-Views.

Der Browser-Teil braucht Chromium: `cd web && npx playwright install chromium`
(lädt von `cdn.playwright.dev`). Ist der Download gesperrt, lässt sich ein
Chromium aus dem npm-Registry-Paket `@sparticuz/chromium` verwenden:

```bash
# 1. Chromium für Serverless + Puppeteer (npm-Registry ist erreichbar):
mkdir -p /tmp/chrome && cd /tmp/chrome && npm init -y
npm i @sparticuz/chromium puppeteer-core
node -e "import('@sparticuz/chromium').then(c => c.default.executablePath()).then(console.log)"
# → /tmp/chromium

# 2. NSS/NSPR für den Start nachlegen:
python3 -m venv /tmp/brotlivenv && /tmp/brotlivenv/bin/pip install brotli
/tmp/brotlivenv/bin/python -c "
import brotli, tarfile, io
raw = brotli.decompress(open('/tmp/chrome/node_modules/@sparticuz/chromium/bin/al2023.tar.br','rb').read())
tarfile.open(fileobj=io.BytesIO(raw)).extractall('/tmp/chromium-libs')"

# 3. Einmal aus dem Repository-Root bauen, dann aus web/ testen:
npm --prefix web run build
cd web
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chromium \
  LD_LIBRARY_PATH=/tmp/chromium-libs/lib npm run test:e2e       # 12 bestanden, 2 übersprungen
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chromium \
  LD_LIBRARY_PATH=/tmp/chromium-libs/lib npm run test:e2e:demo  # 20 bestanden, 4 übersprungen
```

Die Alltagssuite wird von `playwright.config.ts` mit dem normalen Testserver
versorgt und stubbt ausschließlich die API. Die Live-Suite startet ihren
Demo-Server selbst. Der Browser zeigt bei der Übersicht ohne Stadt-/Stationsfilter bewusst
`day: null`; der separate Serververtrag in `tests/test_e2e_demo.py` fragt mit
einer konkreten Station ab und prüft eine gefüllte Tageskurve samt Ortszeit.
Das sind unterschiedliche, beabsichtigte Verträge — kein widersprüchlicher
Teststand.

---

## Selbstmessung des Servers (seit 0.52.0)

Bis 0.51.0 entstanden alle Latenzzahlen dieses Dokuments durch Handmessung —
in einer Sandkiste oder im Last-Workflow. Auf dem NAS lief dieselbe App ohne
Äquivalent: Niemand sah, dass eine Antwort 900 ms braucht, weil die
Veröffentlichung gewachsen ist (O22), ein Parse zurückgekommen ist (O23) oder
eine Sperre im Lesepfad sitzt (O26). Seit 0.52.0 misst der Server sich selbst,
mit zwei billigen Feldern und ohne neue Infrastruktur:

| Feld | Wo | Was es sagt |
|---|---|---|
| `X-Process-Time` | Header **jeder** Antwort (auch 304, 404, statisch) | Bearbeitungszeit dieser Antwort in Sekunden (`0.004182`) — dieselbe Konvention wie gunicorn/nginx. Sichtbar in den DevTools und in `curl -D -`. |
| `performance` | `GET /api/v1/health` | p95, Maximum und langsamste Route über die letzten **200** Antworten (`app/metrics.py`), je Route ab fünf Antworten, dazu `budget_ms` aus der Tabelle unten |
| `performance.store_lock` | `GET /api/v1/health` | Akquisen und Wartezeit der Feedback-Store-Sperre (O26). Ein steigender Zähler ohne Schreibvorgänge heißt: ein Lesepfad nimmt wieder die Sperre. |
| `publication.parse_ms` / `parsed_at` | `GET /api/v1/health` | Dauer des letzten Pars **dieses** Datenstands (O23 macht ihn selten — wenn er teuer wird, steht es hier). `null` heißt „für den aktuellen Stand hat noch niemand geparst“, nie „0 ms“. |
| `Server-Timing` | Header **jeder** Antwort (seit 0.65.0, A21-B2.1) | Benannte Abschnitte derselben Antwort: `history`, `ledger`, `advice`, `wallet`, `stats`, `snapshot`, `publication`, `serialize`, `gzip`, `total` — und `idle` (Clientpause **vor** der Anfrage, ausdrücklich außerhalb von `total`). Feste Namensliste (`app/metrics.py::SPANS`), keine Token, keine Stations-IDs. |
| `X-Request-ID` | Header **jeder** Antwort (seit 0.65.0, A21-B2.1) | Korrelations-ID derselben Anfrage: vom Client übernommen, wenn sie dem Zeichenvorrat `[A-Za-z0-9._:-]{1,64}` genügt, sonst zufällig erzeugt. Der Pi reicht sie an die NAS durch; zusammen mit `X-TankApp-NAS-Process-Time` und `X-TankApp-NAS-Server-Timing` unterscheidet sie Pi-Zeit, Wartezeit und NAS-Zeit. |

```bash
curl -sD - -o /dev/null localhost:1355/api/v1/health | grep -i x-process-time
curl -s localhost:1355/api/v1/health \
  | jq '{performance, publication: {bytes: .publication.bytes, parse_ms: .publication.parse_ms}}'
```

**Budget:** p95 einer API-Antwort im LAN ≤ **300 ms**. Die Zahl steht als
`REQUEST_BUDGET_MS` in `app/metrics.py` und fährt in jedem Health-Payload mit
(`performance.budget_ms`) — ein Budget, das nur in der Doku steht, alarmiert
niemanden. `tests/test_o37_server_metrics.py` hält Header, Payload und Doku
zusammen. Das Last-Budget für `/overview` (≤ 1000 ms p95, Tabelle unten)
bleibt daneben stehen: Es misst den Aggregat-Pfad unter 8 Clients, nicht die
einzelne Antwort im Leerlauf.

**Abgrenzung:** Das ist kein Monitoring. Es gibt keinen Export, keine
Historie über den Prozess-Lebenszeitraum hinaus und keinen Alarm auf
`performance` — die Alarme bleiben beim Alarm-Katalog in
[BETRIEB.md](../betrieb/BETRIEB.md). Die Messung beantwortet eine Frage: „Warum hängt
das gerade?“ — und zwar auf dem Gerät, auf dem es hängt.

### Keep-Alive-Pause ist keine Bearbeitungszeit (A21-B2.1, 21.09.2026)

Der Audit vom 21.09.2026 fand die Messung an der falschen Stelle: Der Timer
startete vor dem blockierenden Lesen der **nächsten** Keep-Alive-Anfrage. In
der Gegenprobe auf einer Verbindung, zwei `/api/v1/health`-Aufrufe mit 300 ms
Clientpause dazwischen: echte Bearbeitung **1,8 ms**, gemeldeter
`X-Process-Time` **301,7 ms** — die Pause floss zusätzlich in den p95 der
Route. Wer damit eine 2,00-s-Antwort erklären wollte, sah nur, dass irgendwo
300 ms steckten.

Seit 0.65.0 beginnt die Messung mit dem **Eingang der Requestzeile**
(`_TrackedReader` stempelt die erste Zeile des Requests). Die Pause davor steht
als eigener Span `idle` im `Server-Timing` — sichtbar, aber nicht in `total`
und nicht in `X-Process-Time`. `tests/test_a21_b2_latency.py` hält die
Gegenprobe fest: 400 ms Clientpause, danach `X-Process-Time < 200 ms`,
`idle ≥ 300 ms`, `performance.max_ms < 200 ms`. Der Test prüft bewusst
Verhältnisse, keine absoluten Millisekunden — ein langsamer CI-Läufer darf
ihn nicht rot machen.

Dazu getrennt gemessen und in `/health` ausgewiesen: `performance.by_status`
(200/304/4xx/5xx ohne Doppelzählung), `performance.send_p95_ms` /
`send_max_ms` (Socket-Schreibvorgang **nach** dem Antwortkopf),
`performance.keep_alive_timeouts` (Verbindungen, die ohne Anfrage endeten —
gezählt, aber keiner Route als Latenz zugeschrieben) und `performance.spans`
(die erlaubte Namensliste).

---

## Lokal ausführen

```bash
python -m pip install -r requirements-dev.txt   # bzw. in die venv
npm --prefix web ci && npm --prefix web run build

# 1) Demo-Stack (bleibt laufen, „bereit auf …“ erscheint nach ~10 s)
python3 ops/quality/demo_server.py --data-dir /tmp/tankapp-demo \
    --static web/dist --port 1355 --host 127.0.0.1

# 2) Lastpfad
node web/load/overview.mjs http://127.0.0.1:1355 20 8

# 3) Lighthouse (einmalig: npx playwright install chromium)
export CHROME_PATH="$(cd web && node -e "console.log(require('playwright').chromium.executablePath())")"
npx --yes @lhci/cli@0.15.x autorun --config=web/lighthouserc.json
```

Der Server läuft in Schritt 1 **außerhalb** von Lighthouse-CI (auch in der
CI: eigener Workflow-Schritt mit Bereitschaftsschleife auf `/api/v1/health`).
Früher startete LHCI ihn selbst und wartete auf „bereit auf“; auf dem
CI-Läufer dauert der Demo-Aufbau länger als LHCI wartet, und der Lauf brach
**ohne Bericht** ab — ein rotes Gate ohne jeden Befund, das Schlimmste aus
beiden Welten. Chrome bekommt `--no-sandbox` (`collect.settings.chromeFlags`),
sonst startet es als Dienst nicht.

Der Lastpfad bricht mit Exit-Code 1 ab, wenn ein Budget verletzt ist, und
schreibt seinen Bericht als JSON nach stdout.

---

## Budgets

| Größe | Budget | Ebene | Begründung |
|---|---|---|---|
| p95 Latenz `/overview` | ≤ 1000 ms | Fehler | Ab ~1 s wirkt ein Refresh im Alltag wie „hängt“. |
| p95 einer API-Antwort (Server-Selbstmessung) | ≤ 300 ms | Warnung | O37: `X-Process-Time` bzw. `performance.p95_ms` in `/api/v1/health` — die einzelne Antwort im Leerlauf, gemessen auf dem Gerät selbst. Über 300 ms ist eine Antwort nicht mehr „sofort“; das Last-Budget oben (8 Clients) bleibt separat. |
| p99 Latenz `/overview` | ≤ 2000 ms | Fehler | Einzelne Treffer nach einem Modell-Lauf oder Job-Start sind erklärbar — aber nicht doppelt so lang wie p95. |
| Fehlerhafte Antworten | 0 (alles 2xx/3xx) | Fehler | Die App hat kein API-Rate-Limit mehr (0.12.0); 429 darf es im Normalbetrieb nicht geben. |
| 304-Anteil der Revalidierungen | ≥ 20 % | Fehler | B7 trägt nur, wenn `If-None-Match` auch unter Last greift. Sonst zahlt jeder Refresh die volle Berechnung. |
| Lighthouse Barrierefreiheit | ≥ 0,90 | Fehler | C5-Runde (0.29.0) war die Abnahme; das Gate verhindert Rückfälle. |
| Lighthouse Best Practices | ≥ 0,90 | Fehler | Konsolen-Fehler, CSP-Löcher, veraltete APIs. |
| Lighthouse SEO | ≥ 0,80 | Fehler | LAN-App: Sichtbarkeit ist zweitrangig, kaputte Metadaten wären trotzdem ein Fehler. |
| Lighthouse Performance | ≥ 0,80 | **Warnung** | M4 verlangt > 0,90. Solange keine einzige Messung vorliegt, wäre ein hartes Budget ein erfundenes Gate — die erste CI-Messung entscheidet über das Nachziehen (siehe [Offen](#offen)). |
| Übertragungsvolumen | ≤ 1,5 MB | **Fehler** | U7: scharf statt Warnung — seit dem Code-Splitting pro Bereich (0.41.0) lädt der Einstieg nur noch seinen eigenen Chunk; wer das Volumen treibt, fällt auf. |
| LCP | ≤ 2500 ms | Warnung | Auf CI-Maschinen streuend; dient dem Trend, nicht dem Bestehen. |
| CLS | ≤ 0,1 | **Fehler** | U7: Layout-Sprünge sind sichtbar und messbar stabil — ein Rückfall ist ein Fehler, kein Trend. |

---

## Messwerte

**Lastpfad** — 8 Clients, 20 s, Demo-Stack mit sechs Stationen (895 Abrufe):

| Kennzahl | Wert |
|---|---|
| Durchsatz | **≈ 45 Abrufe/s** (8 Clients × ~6,7/s — ein Vielfaches eines Haushalts) |
| p50 / p95 | **3 ms / 8 ms** |
| p99 / max | **≈ 1,4 s / 2,3 s** — das ist der planmäßige Neurechnen-Takt: der ETag hängt am 60-s-Datenstandfenster (B7), der erste Abruf nach dem Fensterwechsel rechnet Decide + Summary neu |
| Kalt (`/overview`, neue Parameter) | **≈ 230 ms** |
| 304-Anteil | **≈ 87 %** der Revalidierungen |
| HTTP-Fehler | keine |

Einordnung: Ein einzelnes GUI pollt im Minutentakt, ein Haushalt mit drei
Geräten also ~0,05 Abrufe/s. Der Lastpfad fährt das Tausendfache — die
Reserve ist groß, der Regler ist nicht die Last, sondern der 60-s-Takt.

**Overview-Lesepfad nach der Entkopplung (A21-B2.2, 21.09.2026)** —
`ops/quality/bench_overview.py`, Sandkasten, synthetischer Ledger,
`OPENBLAS_NUM_THREADS=1`; „vorher“ aus dem Audit `c485744`, je Stufe der
Median aus drei **ungecachten** Aufrufen einer Messung:

| Ledger | vorher (ungecacht) | nachher ungecacht | nachher Speichertreffer |
|---|---|---|---|
| leer | 10,9 ms | 11,3 ms | 11,4 ms |
| 160 Settlements / 20 Tagesblöcke | 377,6 ms | 188,7 ms | 11,1 ms |
| 800 / 100 | 1 820,4 ms | 875,1 ms | 13,2 ms |
| 1 600 / 200 | 3 596,3 ms | 1 745,6 ms | 16,0 ms |

Der ungecachte Pfad halbiert sich, weil Advice- und Wallet-Statistik nicht
mehr zweimal je Anfrage entstehen (Decide und Stats-Summary teilen einen
Lesezustand); der Speichertreffer lässt nur noch die serielle Kette
(Tagesband → Entscheidungstabelle → Belege → fällige Episoden) übrig. Diese
Zahlen sind eine Sandkastenmessung, **keine** NAS-Abnahme — p95 ≤ 300 ms auf
der Zielhardware bleibt Issue #214. Die Regressionstests prüfen deshalb
Aufrufzahlen und Ergebnisidentität, keine Millisekunden.

### Ablagen an der Datenabhängigkeit (A21-B2.3, 21.09.2026)

Drei Änderungen, alle gegen Auditbefunde (§3.5) und alle mit Regressionstest
(`tests/test_a21_b2_deps.py`):

* **Verlauf am Preisstand, nicht an den Parametern.** `prices_version()`
  (Herzschläge, Polling-Set, 60-s-Uhrfenster) schlüsselt die Ablage von
  `/api/v1/series` und des Tagesbandes. Ein Liter-, Tank- oder Zeitwertwechsel
  kostet damit keine neue Influx-Query (vorher: 3,76 s); ein neuer
  Collector-Poll oder ein neues Uhrfenster liest sofort neu. Fehler verfallen
  nach 5 s, parallele identische Misses erzeugen eine Query, die Ablage ist
  auf zwölf Einträge begrenzt und verdrängt den ältesten gezielt.
* **Antwort-Ablage mit gezielter Verdrängung.** Der ETag-Cache von
  `/overview` warf bei 64 Einträgen alles weg (auch den gerade gültigen
  Stand); jetzt ist er eine LRU mit derselben Obergrenze.
* **Dateistempel mit Inode und Inhaltsabdruck.** `int(mtime):Größe` konnte
  zwei Stände derselben Sekunde bei gleicher Größe nicht unterscheiden
  (Reproduktion im Test). Der Stempel ist jetzt
  `Gerät:Inode:mtime_ns:Größe:crc32`; die App ersetzt ihre Bestände atomar,
  der Inode fängt das ohne Inhaltlesen ab. *Kosten/Grenze:* je Aufruf wird
  höchstens 64 KiB gelesen (darüber Kopf und Ende zu je 16 KiB) — das ist
  bewusst begrenzt, statt den ganzen Bestand je Request zu hashen; die
  Grenze hält ein Test fest.

Die Messung dieser Änderungen ist wieder der Sandkasten
(`ops/quality/bench_overview.py`) — kein Docker, kein NAS, kein Pi. Die
Abnahme auf der Zielhardware (p95 ≤ 300 ms, `Server-Timing` am echten Pfad)
bleibt Issue #214.

**Lighthouse** (0.41.1, Desktop-Preset, je 3 Läufe, lokaler Demo-Stack):

| Zustand | Performance | Barrierefreiheit | Best Practices | SEO | CLS | LCP |
|---|---|---|---|---|---|---|
| Gefüllter Einstieg („Jetzt“) | **0,98** | **1,0** | **1,0** | **1,0** | **0,00** | ≈ 1,0 s |
| Labor (`?tab=labor`) | **0,97** | **1,0** | **1,0** | **1,0** | **0,00** | ≈ 1,2 s |
| Einrichtungszustand (leerer Server) | **0,98** | **1,0** | **1,0** | **1,0** | **0,03** | ≈ 1,0 s |

Übertragungsvolumen je Seite ≤ 0,67 MB (Budget ≤ 1,5 MB). Dass CLS auf allen
drei Zuständen bei ≈ 0 liegt, ist kein Zufall, sondern der Erst-Paint-Gate
(0.41.1): Die Ansicht rendert erst, wenn Shell-Daten **und** das View-Modul
des Bereichs da sind — es gibt im Sichtbaren keinen Tausch „Skeleton →
Inhalt“ mehr, und `scrollbar-gutter: stable` hält die Viewport-Breite über
alle Zustände gleich (siehe CHANGELOG 0.41.1).

---

## B7-Rest: `route/evaluate` bleibt ein eigener Abruf

Entschieden mit der Messung von oben (D4 sagt ausdrücklich: erst messen, dann
entscheiden):

| Pfad | Dauer (Demo-Stack) |
|---|---|
| `/api/v1/overview`, kalt | ≈ 230 ms |
| `/api/v1/route/evaluate` | ≈ 1,5 ms — **0,6 %** eines kalten Overviews |

Bündeln würde ~1,5 ms je Refresh sparen und dafür die Routen-Parameter
(Fahrtmodus, Heimat-Koordinaten, Station) in den ETag-Schlüssel des Overviews
ziehen: Jede Änderung daran entwertet den Antwort-Cache für **alle** Geräte,
und der Overview wird von Panels bezahlt, die gar keine Route zeigen. Der
eigene Abruf kostet dagegen fast nichts und fällt nur an, wenn überhaupt eine
Route im Spiel ist. Deshalb: **lassen**, wie es ist. Das Last-Gate kann mit
`TANKAPP_LOAD_QUERY=/api/v1/route/evaluate?…` auf den Pfad gerichtet werden,
wenn sich die Rahmenbedingungen ändern.

---

## Offen

1. **Lighthouse-Erstdurchlauf — erledigt (0.41.1).** Die erste Messung liegt
   vor (Tabelle oben): Performance 0,97–0,98, das M4-Ziel (> 0,90) ist auf
   allen drei gemessenen Zuständen erreicht. Die Ebene bleibt dennoch
   **warnend**, bis der Workflow-Lauf auf dem CI-Runner dieselben Zahlen
   zeigt — der lokale Lauf misst gegen einen anderen Chromium-Stack
   (SwiftShader). Bestätigt die CI die Werte, wird das Budget auf
   `error`/≥ 0,90 nachgezogen.
2. **Nicht alle aktuellen Bereiche im Lighthouse-Gate.** Gemessen werden der
   gefüllte Einstieg, das Labor und der Einrichtungszustand (U7). Für
   Stationen, System, Einstellungen und Glossar gibt es noch keine eigenen
   Lighthouse-Läufe; der Frontend-Browsercheck auf Layout und Funktion ersetzt
   diese Performance-Messung nicht.
3. **Kein Docker-Stack.** Gegen `ops/nas/app/compose.yml` ist der Lastpfad
   noch nicht gelaufen — die Compose-Variante braucht eine InfluxDB mit
   Inhalt. Bis dahin gilt der Demo-Stack als Referenz.
