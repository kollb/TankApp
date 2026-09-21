# Qualitäts-Gates (Lighthouse + Last)

> Stand: 18.09.2026 · App-Version **0.53.0** · Zuständig: `.github/workflows/quality.yml`

Zwei Dinge, die kein Unit-Test sieht, entscheiden im Alltag über „fühlt sich
gut an“ oder „hängt“: **wie schnell das GUI wirklich lädt** (M4-Kriterium
„Lighthouse > 90“) und **ob das Polling unter Last trägt** (B7: ein Aggregat
statt sechs Einzelabrufe). Beides wird seit D4 (0.31.0) gemessen — gegen
denselben Demo-Stack, damit die Zahlen vergleichbar bleiben. Dazu kommt seit
0.38.0 die **Suite ohne Mocks**: dieselbe Oberfläche, dieselben Antworten, aber
im echten Browser gegen die echte App (Abschnitt
[E2E ohne Mocks](#e2e-ohne-mocks-seit-0380)).

## Inhaltsverzeichnis

- [Was gemessen wird](#was-gemessen-wird)
- [Der Demo-Stack](#der-demo-stack)
- [E2E ohne Mocks (seit 0.38.0)](#e2e-ohne-mocks-seit-0380)
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
| Lighthouse | `@lhci/cli` (Chrome aus dem Playwright-Cache) | Drei GUI-Zustände: gefüllter Einstieg („Jetzt“), Labor (`?tab=labor`) und Einrichtungszustand (leerer Server), je 3 Läufe | eigener Workflow `quality.yml`: auf Abruf, sonntags 04:17 UTC, und bei PRs, die `web/`, `app/`, `engine/` oder `ops/quality/` anfassen |
| Lastpfad | `node web/load/overview.mjs` (keine Abhängigkeit) | `GET /api/v1/overview` — 8 Clients, 30 s, gemischt aus Volllesen und `If-None-Match`-Revalidierung | derselbe Workflow |

Warum ein **eigener** Workflow und nicht Teil von `tests.yml`: Der in
[AGENTS.md](../../AGENTS.md) festgeschriebene CI-Spiegel muss lokal ohne
Chrome-Download lauffähig bleiben. Die Gates sind teuer (Minuten), der Spiegel
ist schnell (Sekunden) — beides vermischt man nicht.

---

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
Die Bereiche laden als eigene Chunks (`React.lazy` je View), damit der
Einstieg das Labor und die Karte nicht mitschleppt.

---

## E2E ohne Mocks (seit 0.38.0)

Die Playwright-Suite in `web/e2e/` mockt jeden API-Pfad (`page.route`). Sie
beweist, dass das GUI mit **erwarteten** Antworten richtig rendert — nicht, dass
der Server diese Antworten liefert. Genau diese Lücke hat der Sanity-Check vom
15.09. sichtbar gemacht: NaN brach `/last_forecasts` (B1), der Fallback zeigte
UTC-Fenster (B3), der Demo-Stack lieferte keine Tageskurve. Kein gemockter Test
konnte das sehen.

Die zweite Suite tut dasselbe ohne Mocks, gegen den echten Demo-Stack:

| | |
|---|---|
| Spec | `web/e2e/demo.spec.ts` (kein `page.route`) |
| Config | `web/playwright.demo.config.ts` — eigenes `webServer`-Kommando mit `ops/quality/demo_server.py --rebuild`, Port **1357**, Desktop 1440 px + Mobil 390 px |
| Aufruf | `npm --prefix web run test:e2e:demo` |
| Läuft in | `.github/workflows/tests.yml` (web-Job) **nach** der gemockten Suite — nicht in `quality.yml`, weil sie Sekunden braucht und zum CI-Spiegel gehört |
| Zusagen | overview → „Jetzt“ mit „Heute im Blick“ (19 Zellen, Berliner Zeit), Stationenliste, `If-None-Match` → 304 beim Aktualisieren, keine `role="alert"`; dazu Server-Vertrag ohne Browser in `tests/test_e2e_demo.py` |
| Ratchet | `tests/test_quality_gates.py::test_e2e_demo_suite_ist_keine_mock_suite` — prüft, dass die Suite mockfrei bleibt und Config, Skript und CI-Schritt zusammenpassen |
| Laufzeit | 6 Tests (3 Fälle × Desktop/Mobil) in **13,3 s** im ersten grünen CI-Lauf (Demo-Aufbau inklusive) |

Der Browser-Teil braucht Chromium: im Normalfall
`npx --prefix web playwright install chromium` (lädt von `cdn.playwright.dev`).
Ist der Download gesperrt (Sandkasten ohne Netzzugang zu diesem CDN), lässt
sich ein Chromium aus dem npm-Registry-Paket `@sparticuz/chromium` verwenden —
der Weg ist am 18.09.2026 gelaufen und liefert beide Suiten grün:

```bash
# 1. Chromium für Serverless + Puppeteer (npm-Registry ist erreichbar):
mkdir -p /tmp/chrome && cd /tmp/chrome && npm init -y
npm i @sparticuz/chromium puppeteer-core
node -e "import('@sparticuz/chromium').then(c => c.default.executablePath()).then(console.log)"
# → /tmp/chromium (entpackt sich selbst; AL2023 kennt nur 3 Pflicht-Bibliotheken)

# 2. NSS/NSPR für den Start nachlegen (Debian hat sie in keinem Paket dabei):
python3 -m venv /tmp/brotlivenv && /tmp/brotlivenv/bin/pip install brotli
/tmp/brotlivenv/bin/python -c "
import brotli, tarfile, io
raw = brotli.decompress(open('/tmp/chrome/node_modules/@sparticuz/chromium/bin/al2023.tar.br','rb').read())
tarfile.open(fileobj=io.BytesIO(raw)).extractall('/tmp/chromium-libs')"

# 3. Die beiden Suiten starten (jeweils aus web/):
#    Alltagssuite, gemockt — gegen einen LEEREN Server (TANKAPP_DATA_DIR leer):
TANKAPP_DATA_DIR=/tmp/empty-data .venv/bin/python tankapp.py serve --host 127.0.0.1 --port 1359 &
TANKAPP_TEST_URL=http://127.0.0.1:1359 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chromium \
  LD_LIBRARY_PATH=/tmp/chromium-libs/lib npx playwright test        # 38 grün
#    Demo-/Mobil-Suite: Start über web/playwright.demo.local.config.ts (gitignored),
#    der Demo-Server kommt aus dem webServer-Block der Demo-Config:
LD_LIBRARY_PATH=/tmp/chromium-libs/lib npx playwright test \
  --config playwright.demo.local.config.ts                          # 25 grün, 11 skipped
```

**Nicht** mit dem Demo-Server gegen die gemockte Suite fahren: Sechs ihrer Fälle
prüfen den Leerzustand („Erst Stationen einrichten, dann der Atlas“) und scheitern dann an
den Demo-Daten — das sieht nach einem Regressionsfehler aus, ist aber der
falsche Server. Deshalb liegt der Server-Teil der Zusage zusätzlich als
Python-Test daneben, der überall läuft.

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
2. **Nicht alle Bereiche im Gate.** Gemessen werden der gefüllte Einstieg,
   das Labor und der Einrichtungszustand (U7). Die übrigen Bereiche (Woche,
   Stationen, Ich, System) folgen, sobald das M4-Ziel (> 0,90) steht — sie
   laden als eigene Chunks, ein eigener Lauf je Bereich ist damit billig.
3. **Kein Docker-Stack.** Gegen `ops/nas/app/compose.yml` ist der Lastpfad
   noch nicht gelaufen — die Compose-Variante braucht eine InfluxDB mit
   Inhalt. Bis dahin gilt der Demo-Stack als Referenz.
