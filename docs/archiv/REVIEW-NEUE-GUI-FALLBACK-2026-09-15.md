# Sanity-Check + tiefe Analyse: neue GUI (web/) & neuer Fallback (rp2/fallback_gui.py)

> **Archiviert am 16.09.2026 · App-Version 0.43.1.** Prüfbericht aus
> [PR #121](https://github.com/kollb/TankApp/pull/121) (vorgelegt am 15.09.2026,
> Prüfstand `main` @ `9f33b84` = 0.37.0). Der Wortlaut der Prüfung steht
> unverändert hier (Archiv-Regel) — die Umsetzung ist am Ende in §9 verzeichnet.
> **Nachfolger:** [../LUECKEN.md](../LUECKEN.md) (offene Produktpunkte),
> [../RP2.md](../RP2.md) (Fallback/Proxy im Betrieb), [../BETRIEB.md](../BETRIEB.md)
> und [../../CHANGELOG.md](../../CHANGELOG.md) (Änderungen je Version).

## Inhalt

- [Wortlaut der Prüfung](#0-methode) (Abschnitte 0–8)
- [9. Erledigt-Nachweis (Nachtrag 16.09.2026)](#9-erledigt-nachweis-nachtrag-16092026)

Stand: Branch `arena/01a0a13b-tankapp` = `main` @ `9f33b84` (0.37.0), 14.09.2026.
Scope: React-GUI nach `docs/UI-NEUENTWURF.md` (Phasen 1–4) + Fallback-GUI v4.0 nach
`docs/UMSETZUNG-FALLBACK-GUI-V2.md` + die dazugehörige Server-/Engine-Koppelung.

## 0. Methode

- **Code-Lektüre** aller relevanten Dateien: `web/src` (now/week/stations/system/lab/
  data/strip/Dashboard + Views), `rp2/fallback_gui.py` (komplett, 2613 Zeilen),
  `rp2/cache_forecasts.py`, `app/server.py`, `app/data.py` (health, last_forecasts,
  forecast, day_series, overview), `app/decide.py`, `engine/models.py`, `ops/quality/*`,
  die drei Neuentwurf-/Umsetzungs-Docs.
- **CI-Spiegel** (lokal ausgeführt): `ruff check` ✓, `ruff format --check` ✓,
  `pytest -q` → **758 passed** ✓, `npm --prefix web test` → **544 passed** ✓,
  `npm --prefix web run build` (tsc + vite) ✓.
- **Runtime-Tests**: Demo-Stack (`ops/quality/demo_server.py`, echte Engine-Publikation
  mit 70 Tagen synthetischer Historie) auf :1355; RP2-Fallback mit `FORCE_FALLBACK=1`
  auf :8000/:8001, mit echtem JSONL-Puffer (48 Zeilen, 6 Stationen) und echtem
  Prognose-Cache; alle Fallback-Endpunkte angefragt; Proxy-Modus gegen die Demo-NAS;
  Template-Check (Marker, JS-Syntax via `node --check`, CSS-Variablen).
- **Nicht verifizierbar in dieser Sandbox**: Playwright-e2e (Browser-Download blockiert,
  kein Chromium), Docker-Image-Job, echtes Pi-Hardware-Verhalten, visuelle Screenshots.

## 1. Gesamturteil

**Macht der Aufbau Sinn? Ja — und zwar deutlich über dem üblichen Niveau.**

- Web: Reine Logik in eigenen Modulen (`now.ts`, `week.ts`, `stations.ts`, `system.ts`,
  `lab.ts`, `strip.ts`) ohne DOM, Views rendern nur — mit 544 Unit-Tests. Eine einzige
  `/api/v1/overview`-Anfrage für Jetzt/Stationen/Woche (statt sechs Parallel-Polls),
  ETag/304-Revalidierung, 20-s-Timeout, „zwei Fehlpolls bevor ein Fehler sichtbar wird",
  lazy Polling pro Tab, einheitliche Formatter- und Frische-Schwellen. Die Ehrlichkeits-
  Regeln (Stufen A/B/C, „—" statt erfundener Zahlen, „Bisher ≠ Erwartet") sind nicht
  nur dokumentiert, sondern im Code durchgesetzt. Design-Doc und Implementierung
  stimmen sehr dicht überein (Reihenfolge ①–④, ⌘K, Radar-Fallback, Intent-Schleife,
  Erklär-Treppe mit Labor-Sprung).
- Fallback: Klug konzipiert — ein Snapshot pro GUI-Zyklus (5-s-TTL, Lock), GET-only
  JSON-API, Template-Update per SHA-Marker mit `.old`-Backup (verifiziert), atomarer
  Cache-Write in `cache_forecasts.py`, Antwort-Karte zuerst. Die Architektur trägt.

**Aber:** Es gibt vier echte funktionale Mängel (davon zwei schwerwiegend) und eine Reihe
von Parität/Lücken zwischen den beiden Oberflächen — plus ein strukturelles
Test-Problem, das erklärt, warum all das nicht aufgefallen ist (s. §4).

## 2. Befunde — Bugs (alle reproduziert)

### B1 · P1 — NaN bricht `/api/v1/last_forecasts`, `/api/v1/forecast` und `/api/v1/day`

Die Engine publiziert Quantil-Punkte **bewusst mit NaN** = „Punkt nicht gestützt"
(`engine/models.py::predict`, dokumentiert). Der Server serialisiert alle JSON-Antworten
mit `json.dumps(..., allow_nan=False)` (`app/server.py::json`). `forecast()`,
`last_forecasts()` und `day_series()` geben die Punkte ungefiltert weiter → ValueError →
der Catch-all in `serve_get` antwortet **400 `{"error_code": "invalid_query"}`**.

Reproduktion (Demo-Stack, echter Engine-Lauf): Pro Station sind **420 von 1440**
Quantil-Werten NaN (29 %). Ergebnis:

| Endpunkt | Ergebnis | Betroffen |
|---|---|---|
| `GET /api/v1/last_forecasts` | 400 `invalid_query` | **RP2-Cache kann nie befüllt werden** → `cache_forecasts.py` loggt „Status 400" und schreibt nichts → Fallback-F1 („Jetzt oder warten"), Fenster, Werkstatt-Sparklines und Prognose-Frische sind tot; die Fallback-GUI meldet „Prognose-Cache fehlt (NAS war nie erreichbar?)" — **falsche Fehldiagnose**, die NAS ist gesund |
| `GET /api/v1/forecast` | 400 `invalid_query` | NAS-GUI → Labor, Abschnitt 1 „Was sagt die App eigentlich vorher?" zeigt einen Fehler, sobald eine Station einen ungestützten Punkt hat (in den ersten Wochen des Betriebs sehr wahrscheinlich) |
| `GET /api/v1/day` | 400 `invalid_query` | Stations-Labor Tageskurve |

Warum die Tests das verfehlen: Die Python-Fixturen und die e2e-Mocks enthalten kein NaN
(e2e mockt `/api/v1/forecast` per `page.route` mit sauberen Zahlen — `e2e/horizons.spec.ts:173`).

**Fix-Vorschlag:** Quantil-Werte in `forecast()`/`last_forecasts()`/`day_series()` (oder
zentral vor der Serialisierung) von NaN nach `None` übersetzen — die Konsumenten können
`null` bereits (Fallback `point_stats()` springt über NaN/None-Punkte, GUI-Sparklines
filtern `Number.isFinite`). Zusätzlich: `cache_forecasts.py` sollte die Payload
validieren (`"forecasts"`-Liste prüfen), statt jedes Dict zu cachen.

### B2 · P1 — `timeInputToBerlinIso()` hat das falsche Vorzeichen: „Spätestens tanken" ist 2–4 h verschoben

`web/src/now.ts:69` wandelt die Wall-Clock-Zeit aus `<input type="time">` in einen
ISO-UTC-Stempel für den Decide-Parameter `latest_by` um. Die Offset-Berechnung misst
korrekt, addiert ihn aber statt ihn zu subtrahieren: `return new Date(wallAsUtc + offsetMs)`
→ das Ergebnis ist um **2× die UTC-Offset** verschoben (Sommerzeit: +4 h, Winterzeit: +2 h).

Reproduktion (Node, Logik 1:1 aus `now.ts`), Eingabe `10:00` am 14.09.2026 (CEST, +2):

```
eingabe 10:00 -> 2026-09-14T12:00:00Z -> Berlin-Wallclock: 14:00   (sollte 10:00)
Winter (14.12.): 10:00 -> 12:00 Berlin
```

Auswirkung: Der Was-wäre-wenn-Parameter `latest_by` ist falsch → der Server schneidet
Fenster an der falschen Grenze (Fenster, die vor der echten Grenze enden, werden mitgezählt
— oder umgekehrt). Die Annahmen-Zeile zeigt zusätzlich die **falsche Zeit zurück**
(`latestByLabel` rendert den verschobenen Stempel: „bis 14:00 Uhr", wo „10:00" gemeint
war) — der Nutzer sieht also einen Bestätigungsfehler. Die Funktion hat **keinen einzigen
Test** (544 Tests, `now.test.ts` deckt sie nicht ab). Fix: `- offsetMs` statt `+ offsetMs`
+ zwei Tz-Tests (Sommer/Winter, auch „00:00").

### B3 · P1 — Fallback-F1: Zeit in der Antwort-Satz in UTC statt Ortszeit

`rp2/fallback_gui.py::summarize_forecast` baut `time`/`date` per `ts.strftime("%H:%M")`
aus den Cache-Punkten. Die Punkte sind **UTC** (Engine-Index ist tz-aware UTC,
`app/model_jobs.py::_records` → `stamp.isoformat()`).

Reproduktion (Fallback mit echtem Cache, 14.09.2026 20:31 UTC = 22:31 CEST):

```
recommendation: wait
REASON: Prognose rechnet bis 19:25 Uhr mit ~1.665 € (Preis-Score 90 % …)
best_at (ISO): 2026-09-15T19:25:00+00:00   → in Berlin: 21:25
```

Die Antwort-Karte zeigt also „bis 19:25 Uhr", während der darunterliegende Chip denselben
Fenster-Zeitpunkt korrekt als „Morgen · 21:25" rendert (`relDay(w.at)` mit
`timeZone: Europe/Berlin`) — **widersprüchlich auf derselben Karte**. Auch `windows[].time`
und `.date` im API-Contract sind UTC. Fix: in `summarize_forecast` vor dem `strftime` auf
`Europe/Berlin` konvertieren (die Funktion `local_tz()` existiert schon) — oder `time`/
`date` weglassen und nur den ISO-`at` weiterreichen, den die GUI ohnehin korrekt rendert.

### B4 · P1 — Proxy ist nur GET/HEAD: Alle Schreibaktionen über die Pi-Adresse schlagen mit 501 fehl

`fallback_gui.py` definiert nur `do_GET`/`do_HEAD`. Bei NAS-online leitet Port 8000
korrekt weiter (verifiziert: `GET /` und `/api/v1/health` → `X-TankApp-Proxy: nas`,
200), aber:

```
POST /api/v1/fills      → 501 „Unsupported method" (rohe Python-HTML-Fehlerseite)
PUT  /api/v1/profiles   → 501
(DELETE/PATCH analog)
```

`docs/RP2.md:52` verspricht „NAS online → RP2 leitet **transparent** zur **vollen**
NAS-GUI weiter" — in Wahrheit ist die GUI über die Pi-Adresse nur **read-only**: Beleg
buchen, Intent melden (M7-Feedback!), Job starten, Profil anlegen/ändern/löschen, Beleg
stornieren — alles 501. Vor PR #119/112 war die Pi-Adresse ohnehin Fallback-only, heute
ist sie laut Doku ein gleichwertiger Einstiegspunkt, und die neue GUI macht Schreiben
zentraler (Intents, Schnellerfassung). Bestehende Lücke (seit Proxy 2.0, v3.0: „keine
Proxy-Änderung"), aber **niedokumentiert** und jetzt relevant. Fix: `do_POST/PUT/DELETE/
PATCH` wie `do_GET` forwarden (Body durchreichen, `Content-Length` setzen) + Doku-Zeile
entweder korrigieren oder die Einschränkung dokumentieren.

### B5 · P2 — `systemFreshness` wertet Modelle/Ranking mit der Preis-Schwelle ab → System-Fußzeile fast immer rot

`web/src/system.ts::systemFreshness` prüft **alle vier** Zeitstempel (Health, Collector,
**Modelle**, **Selection**) mit `freshness(s, "prices", …)` — Schwellen 30 min (stale) /
60 min (old). Aber: `INTERVALS` in `app/worker.py`: **models: 86400 s (täglich)**,
**selection: 86400 s (täglich)**. In einem gesunden System ist `models.published_at`
also meist 3–24 h alt und `selection.generated_at` ein Tag alt → `worst = old` →
Fusszeile-Ton **`bad` (rot)** — direkt unter dem (korrekten) Overall-Badge „Alles ok".
Die vorhandenen Tests (`system.test.ts:264`) üben nur `healthAt`/`collectorAt` — genau die
beiden, die mit „prices" richtig sind. Fix: je Stempel den passenden `DataKind`
(collector→`prices`, models→`model`, selection→`selection`) — und prüfen, ob „stale"
bei Tages-Jobs überhaupt der passende Ton ist (Design-Frage, aber rot ist eindeutig falsch).

### B6 · P2 — Fenster unter einer Stunde rendert „22–22 Uhr"

`hourRangeLabel` (`data.ts:2458`) floor-t beide Stunden. Die Engine-Fenster haben
5-Minuten-Granularität — ein Fenster 22:00–22:55 liefert `from=22, to=22` →
**„Warten bis 22–22 Uhr"** als Verdict-Headline (reproduziert mit dem echten
`overview`-Payload der Demo: Fenster 20:00–20:55 UTC = 22:00–22:55 CEST). Der
Mitternacht-Fall ist via Test auf „22–02 Uhr" fixiert (OK, aber auch nicht schön).
Fix: bei `from === to` entweder das Ende auf Stundenende anzeigen („22 Uhr (bis 22:55)")
oder ceil des Endes — mit Test.

### B7 · P2 — Fallback-Fakt „Bestes Fenster **heute**" zeigt einen morgendlichen Punkt-Zeitstempel von *morgen*

Template (Antwort-Karte): `waitWindow = (decide.windows || [])[0]` — das ist das beste
Fenster der **nächsten 24 h** aus `summarize_forecast`. Der Fakt-Box-Label heißt
„Bestes Fenster heute", der Wert ist `clockOf(waitWindow.at)` (ein Punkt-Zeitstempel,
kein Bereich wie bei NAS `hourRangeLabel`). Repro: `windows[0]` = 15.09.2026 19:25 UTC
= **morgen** 21:25 CEST — steht also als „21:25" unter „Bestes Fenster heute". Der
Chip daneben sagt korrekt „Morgen". Doku (RP2.md 4.0) behauptet: „dieselben drei Fakten
… wie in der NAS-GUI" — stimmt für Label und Reihenfolge, aber die Semantik differiert
(Punkt statt Bereich; 24 h statt heute). Milderer Zwilling auf der NAS-Seite:
`nowFacts` nimmt `windows_today[0] ?? primary.recommended_window` — das Fallback-Objekt
kann ebenso morgen liegen, während das Label „heute" sagt.

### B8 · P2 — Fallback-F2 „günstigste Station" ohne Freshness-Gate

`_api_decide` sortiert offene Stationen **rein nach Preis**, egal wie alt die Meldungen
sind (Puffer hält 2 Tage). Die NAS-Logik nullt veraltete Preise, bevor sie die günstigste
sucht (`currentPrice` + Frische-Fenster). Resultat: nach 30 h Collector-Ausfall zeigt der
Pi „Jetzt hier: X — günstigste" auf Basis gestriger Preise, während die NAS-GUI denselben
Preis gar nicht mehr als „frisch" verbucht (Station fällt aus dem Ranking). Die
Einzeldaten liegen vor (`row.fresh`, `age_minutes`), das Fact „Frische Preise" zählt sie
auch — die Entscheidung selbst ignoriert sie. Entweder Gate anwenden (mindestens:
Antwort auf „grau/herabgestuft" kippen, wenn keine frische Meldung im Set ist) oder die
Abweichung in der Doku als bewusste Entscheidung verankern.

### B9 · P3 — Fallback-Fakt „Frische Preise" ignoriert den Kraftstoff-Filter

`freshCount = rows.filter(row => row.fresh).length` zählt **alle** frischen Stationen
(Station-Report ist kraftstoff-übergreifend frisch). In einem Mixed-Set (6 Stationen,
3 davon führen kein Diesel) zeigt die Diesel-Ansicht „Frische Preise: 6" — im
Stations-Abschnitt steht korrekt „6 Stationen · 3 mit Diesel-Preis". Fix: zählen nur
Stationen mit `isNum(s[state.fuel])`.

### B10 · P3 — CSS: `var(--line)` ist nie definiert

`.fact { border: 1px solid var(--line); }` (Template, Antwort-Karte) — definiert ist nur
`--border`. Deklaration wird verworfen → die drei Fact-Boxen haben in **beiden** Themes
keine Umrandung (verifiziert am gerenderten HTML: `--line:` kommt nie vor).

### B11 · P3 — Mitternachts-Meldung geht verloren / Streifen-Parität

- NAS-Streifen (`buildStripCells`, `strip.ts`): 18 Zellen, Stunden 6…23. Eine Meldung um
  00:10 (berlin `hour === 0` bzw. Intl-„24") fällt durch den Filter `hour >= 6 &&
  hour <= 24` → **stille Datenverlust** (Mitternacht existiert im Streifen nicht).
- Fallback-Streifen: 19 Zellen, 06…**24**, wobei Zelle „24" nur durch die
  `local.date() == tomorrow && hour == 0`-Regel befüllt würde — mit Polling-Fenster
  06–24 h also praktisch immer leer (kommentiert: „bleibt im Normalbetrieb leer").
- Gleicher Begriff („Tagesstreifen 06–24"), zwei unterschiedliche Darstellungen
  (18 vs. 19 Zellen). Fallback-Doku erlaubt „schlanker", aber „nicht anderes erzählen" —
  das fehlt hier um eine Zelle.

### B12 · P4 — Template-Kommentar sagt noch „v3"

`rp2/fallback_gui.py:1280` (HTML-Kommentar im Template): „TankApp Fallback-GUI v3",
`VERSION = "4.0"`, Marker `v4.0`. Nur in der Page-Source sichtbar — Kosmetik.

## 3. Fehlende Punkte / Abweichungen zum Konzept

| # | Punkt | Bewertung |
|---|---|---|
| M1 | Design §5.2 verspricht Filter-Chips `[E10] [offen] [Marke]` — umgesetzt: Suche (⌘K ✓), Marke ✓, Kraftstoff global im Header ✓, **„offen"-Chip fehlt** (Stationen ohne frischen Preis werden mit „—" + nach hinten sortiert angezeigt) | gering — Absicht prüfen, sonst Chip ergänzen |
| M2 | Schreiben über die Pi-Adresse (siehe B4) | siehe B4 |
| M3 | „Tank reicht bis Do" (Design-Skizze Fakt 3) ist auf „Ja/Nein + Reichweite km" reduziert | **bewusste, dokumentierte** Ehrlichkeits-Entscheidung (UMSETZUNG 2.1) — korrekt so |
| M4 | Stadt-Median in der Bilanz | ehrlich „noch nicht messbar" (Ih.tsx) — korrekt so |
| M5 | OSM-Kartenkacheln brauchen Internet (App läuft „ausschließlich im eigenen LAN") | Radar-Luftlinien-Fallback existiert und springt bei `tileerror`/offline automatisch an — gut gelöst |
| M6 | Beleg/Intent-Pflege auf dem Pi | by design NAS-only, in Doku verankert (F4) — OK, solange B4 die GET-Seite nicht kaputt macht |
| M7 | PWA/Offline auf NAS | kein Service Worker; als LAN-App vertretbar, aber der Fallback-Gedanke (Ausfall → andere Oberfläche) gilt nur, wenn die Pi-Adresse überhaupt bekannt ist — InstallHint-Komponente existiert, Doku-Begriff fehlt im GUI |
| M8 | Barrierefreiheit | `aria-`/`role` durchgehend gut; Tagesstreifen-Zellen sind `div` mit `title` — Werte nur per Maus-Hover, keine Tastatur-/Screenreader-Semantik (kein `role="img"`+`aria-label` pro Zelle) |

## 4. Test-Lage: die strukturelle Lücke

Die Unit-Ebene ist stark (544 web, 758 python, Property-Tests, Formattierungs-Ratchet,
DOM-Smoke-Tests für das Fallback-Template). Die **Integrationsebene ist blind**:

1. **e2e mockt nahezu alles**: `e2e/*.spec.ts` legen `page.route` über `/api/v1/overview`,
   `/decide`, `/series`, `/forecast`, `/fills`, `/health`, … — die 16/16 Browser-Tests
   beweisen also Rendering-Logik, **nicht** Server↔GUI-Integration. Genau deshalb sehen
   sie B1 (NaN), B3 (UTC) und den Demo-Defekt #2 unten nicht.
2. **Der Demo-Stack kann selbst keine Tageskurve liefern**: `demo_data.make_query`
   ignoriert den Stations-Filter aus dem Flux-Query-Text und liefert alle Stationen;
   `LiveData.series()` verifiziert die Identität Zeile für Zeile → `ValueError("Wrong
   identity")` → `influx_read_failed`. Folge: `/api/v1/series`, die `day`-Sektion des
   `overview`-Payloads und damit **„Heute im Blick" im neuen „Jetzt"-Bereich ist im
   Demo-Stack immer leer** (verifiziert: 0 Punkte). Die „Sichtprüfung 7.1" konnte den
   Tagesstreifen mit Zellen also gar nicht gesehen haben.
3. **Die Publikation im Demo-Stack enthält NaN** (B1) → Labor-Abschnitt 1 und
   `last_forecasts` fallen im Demo immer aus — auch das „gemessen", nur dass Lighthouse
   die gebrochene Ansicht als fertigen Frame misst.
4. `cache_forecasts.py` validiert die Payload nicht (speichert jedes Dict); in
   Kombination mit B1 landet permanent **kein** Cache auf dem Pi, und die Fallback-
   Meldung deutet auf das falsche Problem („NAS nie erreichbar?").

Konkret fehlende Testfälle (alle würden einen der oben gefundenen Fehler gefangen haben):
`timeInputToBerlinIso` (Sommer/Winter/Mitternacht), eine Publikation mit NaN über
`last_forecasts`/`forecast`/`day` (Integration), `systemFreshness` mit `modelsAt`/
`selectionAt`, Fallback-`decide`-Reason mit nicht-UTC-freiem Zeitstempel, Proxy-POST-
Forward, `hourRangeLabel` bei `from === to`.

## 5. Default-Werte & Grenzen (geprüft, konsistent?)

| Wert | GUI (localStorage) | Server (Profil) | Pi-Fallback | Beleg-Form |
|---|---|---|---|---|
| Tankmenge (L) | **40** (10–80) | **40** (10–80) ✓ | 40 (5–100) | 5–100 |
| Verbrauch | 7 L/100 km (4–15) | 7 ✓ | – | – |
| Zeitwert €/h | 12 (0–30; Auto: 10 / 16 Peak 16:30–20:00) | 12 ✓ | – | – |
| Tempo | 45 km/h (25–80) | 45 ✓ | – | – |
| Tankgröße | 50 L (20–120) | 50 ✓ | – | – |
| Füllstand | null (keine Angabe = keine Aussage) ✓ | – | – | – |
| Heatmap | 6 Wochen, „probability", Basis „hour" | – | – | – |
| Labor-ε | 1,0 (lokal, nur Spielplatz) | – | – | – |
| Theme | dark (light verfügbar) | – | dark/light im Template | – |

Konsistenz ist gut — **eine** echte Inkonsistenz: Ein Fahrzeug mit 100-L-Tank
(Transporter/Diesel) kann einen Beleg über 100 L buchen (`FILL_LIMITS.liters.max = 100`),
die Profil-Tankmenge aber nur bis 80 L setzen (`PROFILE_BOUNDS.liters.max = 80`) — die
Was-wäre-wenn-Liter (10–80) decken dann den Buchungs-Realisierbereich nicht ab. Grenzwerte
einheitlich festlegen (Beleg vs. Profil).
Fallback-Defaults: `FRESH_MINUTES = 30`, Snapshot-TTL 5 s, NAS-Probe 30 s/2 s Timeout,
`SNAPSHOT_DAYS_BACK = 2` (→ Basis für B8), Proxy-Body-Limit 32 MiB.
NAS-Frische-Schwellen: Preise 30 min / Modell 180 min / Selection 36 h — überall dort
konsistent verwendet, **außer** `systemFreshness` (B5).

## 6. Weitere (kleine) Beobachtungen

- Health-Payload = 2022 Byte (gemessen) — die RP2-Probe liest 4096 Byte und `json.loads`
  den Rest: aktueller Zustand unkritisch, und die Probe behandelt ein nicht-parsebares
  Body als „online" (`not data` → True), was Truncation toleriert. Trotzdem: bei
  Wachstum des Health-Payloads (mehr Alarms, längere Fehler-Strings) ist das ein
  Bruchpunkt — Probe auf `Content-Length`/komplettes Body lesen auslagern.
- `compareStationsPair` hat eine unerreichbare `else if (deltaCt === null)`-Ast
  (nach der ersten Prüfung können beide Preise nicht null sein) — toter Zweig.
- Build-Warnung: 530 kB Chunk ohne Code-Splitting — im LAN unkritisch, aber `tsc && vite
  build` brummt bei jedem Build.
- `weekDays`-Sterne-Schwellen (75/55/35) und `wordFromPercent` (75/55) unterscheiden sich
  um die 35-h-Klasse — beabsichtigt (Stern ≠ Wortstufe), aber im Labor-Text „Sicherheit"
  ist die Zuordnung 3-Sterne/„ziemlich sicher" nur zufällig deckungsgleich; ein
  einzeiliger Kommentar/Tabellen-Verweis würde genügen.
- `useResource`: „Refresh bricht nie ab" + queued reload + ETag — sauber implementiert,
  inkl. Test. Kein Befund.
- Fallback-Log: korrekt (Request, 501, Template-Backup). `install_default_template`
  arbeitet wie dokumentiert (Marker+SHA, `.old`-Backup) — verifiziert.
- `app/decide.py::_parse_deadline` akzeptiert naive ISO als Europe/Berlin — robust,
  deckt aber B2 nicht ab (der Client schickt bewusst „aware", nur falsch).

## 7. Empfehlungen (priorisiert)

1. **B1 fixen** (NaN→None in `forecast`/`last_forecasts`/`day_series` + Validierung in
   `cache_forecasts.py`) + Integrationstest mit NaN-Publikation. Blockt sonst die
   gesamte Fallback-F1-Story in jedem System, das noch lernt.
2. **B2 fixen** (`- offsetMs`) + zwei Tz-Tests. Blockt den Was-wäre-wenn-Pfad „Spätestens
   tanken" (falsche Empfehlung + falsche Bestätigung im UI).
3. **B3 fixen** (Ortszeit in `summarize_forecast`) — eine `astimezone(local_tz())`-Zeile.
4. **B4 entscheiden**: entweder Proxy-Schreibmethoden nachrüsten (und testen) oder Doku
   auf „NAS online: read-only über Pi" korrigieren. Empfehlung: nachrüsten (der Aufwand
   ist ein `do_POST`-Zwilling von `do_GET`).
5. **B5–B7 fixen** (Frische-Kinds, `hourRangeLabel`-Degeneration, Fakt-2-Semantik/Label
   — am saubersten: Fallback-Fakt 2 nur bei `relDay(at) === "Heute"` mit dem Label
   „heute" befüllen, sonst „Nächstes Fenster" + relDay).
6. **Demo-Stack reparieren** (`make_query` muss den Stations-Filter aus dem Flux-Text
   honorieren) — sonst bleibt „Heute im Blick" in allen Qualitäts- und Sichtprüfungen
   unsichtbar.
7. **Eine e2e ohne Mocks** gegen den echten (Demo-)Server: `overview` → Jetzt-Karte mit
   Tagesstreifen inkl. Zellen; plus `last_forecasts`-Prozess-Test (NaN).
8. B8–B12 + M1/M8 in einem Polish-Commit; Doku (RP2.md API-Tabelle: `series`-Parameter
   `station` statt `station_id`, Payload anders als NAS `/series` — „gleiche
   Daten-Semantik" ist nur im loosesten Sinne zutreffend) an die Realität anpassen.

## 8. Fazit

- **Aufbau: Sinnvoll**, konsequent durchdacht, Doku und Code weitgehend deckungsgleich;
  die Ehrlichkeits-Architektur (Stufen, „—", Frische) ist das Rückgrat und funktioniert.
- **Implementierung: überwiegend korrekt**, aber **4 Mängel vor Freigabe beheben**
  (B1, B2, B3, B4) — alle vier reproduziert, keiner von den bestehenden Tests gefangen.
- **Größtes strukturelles Risiko**: Das Test-Netz kann Server-Defekte nicht sehen
  (mockte e2e + defekter Demo-Stack + NaN-freie Fixturen). Das ist die eigentliche
  Ursache, warum „alles grün" und „F1 tot / latest_by falsch" gleichzeitig wahr sind.

## 9. Erledigt-Nachweis (Nachtrag 16.09.2026)

Nachtrag der Umsetzung — die Abschnitte 0–8 oben bleiben im Wortlaut der Prüfung.
Alle vier P1-Befunde, die P2/P3-Liste und die strukturelle Test-Lücke sind im
Code; hier steht, wo. Verifiziert am 16.09.2026 (App 0.43.1) mit
`ruff check`, `ruff format --check`, 806 pytest, 1047 Vitest und
`npm --prefix web run build`. Die Browser-Suiten liefen hier nicht — der
Chromium-Download ist in der Sandbox gesperrt (so auch in
[../LUECKEN.md](../LUECKEN.md)); sie gehören zur CI
(`.github/workflows/tests.yml`, `test:e2e` und `test:e2e:demo`).

### 9.1 Befunde → Umsetzung

| Befund | Version | Code | Test |
|---|---|---|---|
| B1 (NaN → 400) | 0.37.2 | `app/server.py::_sanitize_for_json` (NaN/±inf → `null`, zentral vor der Serialisierung), `app/data.py::day_series` (ungestützter Punkt ist kein Preis), `rp2/cache_forecasts.py` (validiert die `forecasts`-Liste, benennt die Ursache) | `tests/test_app.py::test_nan_quantile_points_do_not_break_public_endpoints`, `tests/test_rp2_cache.py` |
| B2 (`latest_by` verschoben) | 0.37.2 | `web/src/now.ts::timeInputToBerlinIso` (`− offsetMs`, Normalisierung der Mitternachts-Probe) | `web/src/now.test.ts` (Sommer, Winter, 00:00, Rundreise, ungültig) |
| B3 (F1 in UTC) | 0.37.2 | `rp2/fallback_gui.py::summarize_forecast` (`astimezone(local_tz())` für `time`/`date`; der ISO-Stempel `at` bleibt UTC) | `tests/test_rp2_fallback.py` (Sommer-/Winterzeit) |
| B4 (Proxy nur GET/HEAD) | 0.37.2 | `do_POST`/`do_PUT`/`do_DELETE`/`do_PATCH` + `_handle_write`/`_read_body`: Body und `Content-Type` werden durchgereicht, Deckel 32 MiB → 413, NAS offline → `503`-JSON statt 501 | `tests/test_rp2_fallback.py` (Forwarding, 503 ohne NAS) |
| B5 (Fußzeile fast immer rot) | 0.37.2 | `web/src/system.ts::systemFreshness` wertet je Stempel die passende Art (`prices`/`model`/`selection`); `STALE_AFTER_MINUTES.model` = 24 h statt 180 min | `web/src/system.test.ts` (Modelle-/Selektions-Stempel) |
| B6 („22–22 Uhr“) | 0.37.2 | `web/src/data.ts::hourRangeLabel`: Minuten, wenn ein Ende in der Stunde liegt („22:00–22:55 Uhr“), entartetes Null-Fenster als „22 Uhr“ | `web/src/data.test.ts` |
| B7 („heute“ zeigte auf morgen) | 0.37.2 | Fallback: `dayWord()` am Fenster („heute“/„morgen“/Datum); NAS: `nowFacts` nennt den Tag im Wert | `tests/test_rp2_fallback.py`, `web/src/now.test.ts` |
| B8 (F2 ohne Frische-Gate) | 0.37.2 | `f2` trägt `fresh`/`age_minutes`/`fresh_in_set`/`oldest_age_minutes`; ohne frische Meldung kippt die Antwort-Karte auf „Preis-Momentaufnahme“ (grau, ohne „warten“-Look) | `tests/test_rp2_fallback.py` |
| B9 (Fakt zählte ohne Kraftstoff) | 0.37.2 | Template: `row.fresh && isNum(row.price)` | `tests/test_rp2_fallback.py` |
| B10 (`var(--line)`) | 0.37.2 | `.fact` → `var(--border)` | Template-Regression |
| B11 (Mitternacht/18 vs. 19 Zellen) | 0.37.2 | 19 Zellen in beiden Oberflächen, Zelle „24“ trägt die Mitternachtsmeldung | `web/src/strip.test.ts`, Template-Test |
| B12 (Kommentar „v3“) | 0.37.2 | Template-Kommentar „TankApp Fallback-GUI v4“ | Testname mitgezogen (0.43.1) |
| M1 („offen“-Chip) | 0.37.2 | Filter „nur offene“ in `web/src/views/Stationen.tsx` | `web/src/views/Stationen.test.tsx` |
| M8 (Streifen nur per Hover) | 0.37.2 | Streifenzellen mit `role="img"` + `aria-label` (NAS und Fallback) | `web/src/strip.test.ts`, `web/e2e/demo.spec.ts` |
| §4.2 Demo-Stack ohne Tageskurve | 0.37.2 | `ops/quality/demo_data.py::make_query` honoriert Stations-Filter und Zeitfenster | `tests/test_e2e_demo.py`, `tests/test_data.py` |
| §4.1 e2e mockte alles | 0.38.0 | `web/e2e/demo.spec.ts` + `playwright.demo.config.ts` (kein `page.route`), Server-Hälfte `tests/test_e2e_demo.py`, eigener CI-Schritt | `.github/workflows/tests.yml` |
| §5 Grenzen (100-L-Tank) | 0.37.2 (Server) · 0.43.1 (GUI) | Profil-Tankmenge 10–100 L (`app/profiles.py::FIELD_BOUNDS`; Beleg und Pi kannten 5–100 L bereits). Nachgezogen in 0.43.1: Die GUI-Slider und die Was-wäre-wenn-Zeile kappten weiter bei 80 L und `PROFILE_BOUNDS` war toter Code — jetzt ziehen beide Stellen ihre Grenzen daraus | `tests/test_profiles.py` (100 L → 200, 101 L → 400), `web/src/settings.test.tsx`, `web/src/views/Jetzt.test.tsx` |
| §6 Health-Probe | 0.37.2 | RP2 liest das vollständige Body (bis 128 KiB) statt der ersten 4096 Byte | `tests/test_rp2_fallback.py` |
| §6 toter Zweig | 0.37.2 | `compareStationsPair` ohne unerreichbaren `deltaCt === null`-Ast | `web/src/stations.test.ts` |
| §6 Bundle-Warnung | 0.41.0 | Code-Splitting je Bereich (U7); der Build vom 16.09.2026 ist ohne Chunk-Warnhinweis — größter Chunk 251 kB / 81 kB gzip | `npm run build`, D4-Gate in `ops/quality/gates.py` |

### 9.2 Bewusst anders als vorgeschlagen

- **B8:** Der Fallback nimmt veraltete Meldungen nicht aus dem Vergleich,
  sondern zeigt sie mit ihrem Alter und kippt die Antwort-Karte — so bleibt der
  Notbetrieb nützlich, ohne eine Empfehlung zu behaupten. Festgehalten in
  [../RP2.md](../RP2.md) (Changelog 4.1).
- **B11/M1:** Der NAS-Streifen führt die Stunde 24 als eigene Zelle (19 Zellen,
  Parität zum Fallback); die Stunden 1–5 bleiben außerhalb des 06–24-Fensters.
- **M7:** PWA-Shell, Update-Anzeige und Offline-Queue sind seit 0.38.0 gebaut.
  Die Pi-Adresse als zweiter Einstieg bleibt Betriebsdoku
  ([../RP2.md](../RP2.md)) — die NAS-GUI kennt die RP2-Adresse nicht.

### 9.3 Kleinigkeiten aus §5/§6, geschlossen mit 0.43.1

- §5 (100-L-Tank): Der Server erlaubte seit 0.37.2 Profil-Tankmengen bis
  100 L, die GUI kappte sie aber weiter bei 80 L (`views/Settings.tsx`,
  `views/Jetzt.tsx`), und `PROFILE_BOUNDS` war nie importiert. Beide Stellen
  nehmen ihre Grenzen jetzt aus `PROFILE_BOUNDS`; MICROCOPY und API nennen
  10–100 L. Tests: `web/src/settings.test.tsx`,
  `web/src/views/Jetzt.test.tsx`, `tests/test_profiles.py`.
- `windowStars`-Kommentar präzisiert: Die 35–55-%-Klasse hat keine eigene
  Wortstufe (sie unterscheidet sich von `wordFromPercent` nur dort) — jetzt
  im Code benannt und in `web/src/week.test.ts` festgehalten.
- [../RP2.md](../RP2.md): `/api/v1/series` ist gegen das NAS-`/api/v1/series`
  abgegrenzt (Parameter `station` statt `station_id`, Stundenraster 06–24 Uhr
  aus dem Puffer statt Rohreihe 1–168 h).
- Der Template-Test hieß noch `test_template_is_the_v3_gui_…` — auf v4
  nachgezogen (Nachtrag zu B12).
