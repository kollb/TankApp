# TankApp — ToDo aus der Tiefenanalyse (11.09.2026, zwei Prüfstränge)

> **Rahmenbedingung:** Die App läuft ausschließlich im eigenen LAN (Pi ↔ NAS ↔
> Browser). **Usermanagement, Login und Auth sind explizit nicht nötig** und
> werden in dieser Liste bewusst *nicht* aufgeführt. Rate-Limiting und
> Input-Validierung bleiben trotzdem drin — sie schützen vor Fehlbedienung,
> Doppelgeräten im Haushalt und defekten Clients, nicht vor Angreifern.
>
> **Prioritäten:**
> - **P0** = riskiert falsche Zahlen oder Datenverlust → als Nächstes
> - **P1** = wichtig für den echten 24/7-Dauerbetrieb
> - **P2** = Komfort, Ausbau, Feinschliff
> - **D**  = braucht echte Live-Daten oder eine Produktentscheidung (kein reines Code-Task)
>
> **Quellen:** [docs/LUECKEN.md](docs/LUECKEN.md), [docs/Prüfstand.md](docs/Prüfstand.md),
> [docs/TIEFENANALYSE.md](docs/TIEFENANALYSE.md), [docs/TIEFENANALYSE_V2.md](docs/TIEFENANALYSE_V2.md),
> [docs/TIEFENANALYSE_V3_GUI.md](docs/TIEFENANALYSE_V3_GUI.md), [docs/Gutachten.md](docs/Gutachten.md)
> — diese ToDo ist die priorisierte Arbeitsliste daraus; erledigte Punkte dort
> sind hier nicht mehr enthalten.

---

## A. Fachlich (Produkt & Domäne)

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| A1 | P1 | **Fahrzeug-/Haushaltsprofile ohne Login** | Verbrauch, Zeitwert, Tankmenge, Kraftstoffart liegen heute im `localStorage` pro Browser → Handy ≠ PC, zweites Fahrzeug (Diesel vs. Benziner) unmöglich. Ziel: Profil-Umschalter im Header, serverseitig gespeichert (pro Haushalt, kein Account), GUI-Felder lesen daraus. |
| A2 | P1 | **Tankstand / Restreichweite als Eingabe für F3** | Konzept-F3 („Tank bei ¼, kann ich warten?") hat keinen Tankstand-Input. Ziel: Fuellstand-Angabe (≈ Füllstand oder Rest-km), App sagt ehrlich „Warten riskant, Reserve reicht ~40 km" statt nur „bestes Fenster morgen". |
| A3 | P0 | **Beleg-Korrektur/Storno fehlt komplett** | `DELETE /api/v1/fills` ist 501, kein Edit im Store. Ein falsch gebuchter Beleg verzerrt Wallet, w(h)-Profil und Statistik für immer. Ziel: Beleg korrigieren/stornieren (mit Storno-Flag statt Löschen, Audit-Spur), Button im Wallet-Verlauf. |
| A4 | P1 | **Jahres-/Monatsbilanz in der Werkstatt** | Konzept §12 P2: „Wallet-Ledger im Alltag, **Jahresbilanz in der Werkstatt**". Heute nur Summen-Kacheln im Alltag. Ziel: Verlaufsliste der Fills, Monats-/Jahressumme, Ø €/Tankung, Vergleich gegen „immer sofort getankt"-Baseline (Regret-Ratio ist vorhanden, nur nicht persönlich aufbereitet). |
| A5 | P1 | **Benachrichtigung ohne Account** | Konzept §12 P2 lieferbar LAN-tauglich: ntfy/Telegram-URL oder Browser-Notification bei „Preis X ct unter Tagesmedian" / „billigstes Fenster beginnt in 15 min". Trigger aus dem Decision Layer sind vorbereitet, aber ungetestet und nicht konfigurierbar. Ziel: Schwelle je Station/Fuel einstellbar, Versand via ntfy (kein Drittanbieter-Account nötig, eigener ntfy-Prozess auf dem NAS möglich). |
| A6 | P1 | **Export & Share eigener Daten** | Kein CSV/JSON-Export von Fills/Wallet/Preisverläufen, keine Share-URL (`?city=…&fuel=…&station_id=…&liters=…`) zum Bookmarken oder im Haushalt weitergeben. Ziel: Download-Button im System-/Statistik-Tab + URL-Parameter, die die GUI beim Öffnen übernimmt. |
| A7 | D | **Kalibrierung M7 „Inbetriebnahme"** | `p_correct` bleibt bis ≥100 abgeschlossene Settlements und Brier < 0,25 gesperrt — richtig so, aber es fehlt die **Checkliste/Anzeige**, wie weit der Weg ist („37/100 Settlements, Brier 0,31"). Ziel: Fortschritts-Kachel im System-Tab + Doku, was beim Freischalten zu prüfen ist. |
| A8 | D | **Markenrabatte/Karten** (`--brand-rebate`) | 2–4 ct können das F2-Ranking umdrehen. Erst sinnvoll, sobald echte Rabattdaten vorliegen; bis dahin soll die GUI im Ranking anzeigen „rechnet ohne Rabattprogramme" (Transparenz-Hinweis). |
| A9 | D | **w(h)-Rückkopplung anschließen** | Persönliches Zeitprofil (`wallet.wh_hours`) wird berechnet, fließt aber nicht in „billigste Stunde"/F3 ein (Konzept §5.5). Ab ≥8 Füllungen aktivieren, vorher Default — mit UI-Hinweis ab wann personalisiert. |
| A10 | D | **Engine-Ausbau nach Konzept §3** | Hampel-Filter (§3.1), gepoolter Feiertags-Dummy je Bundesland, Zeit-seit-letztem-Sprung-Feature, M3-Zweitmodell/Ensemble, Mehrtage-Backtests (+3/+7 d), 21-Tage-Backtest im Auto-Lauf, Rolling-PICP als Live-Badge je Station. Alles dokumentiert offen; erst nach echter Datenabnahme kalibrierbar. |
| A11 | D | **Gemeinsame Bootstrap-Ziehung für `p_lohnt`** | Konzept §4.2: Marktgleichlauf darf nicht wegkorreliert werden. Braucht stationsübergreifenden Resampling-Schritt (gleicher Tagesblock je Ziehung) — eigener Arbeitsschritt, in LUECKEN begründet offen. |
| A12 | P2 | **Station-Lebenszyklus & Zustandsehrlichkeit** | „führt E10 nicht" vs. „temporär geschlossen" vs. „keine Daten seit n Tagen" wird in der GUI nicht unterschieden. Tote Stationen (`no prices` > 7 Kalendertage) sollen automatisch aus Ranking/Polling-Set fallen (konfigurierbar), nicht dauerhaft Kontingent kosten. |
| A13 | P2 | **Preis-Zwillinge: automatische Warnung** | Identische Preisverläufe zweier Stationen (Doppel-Source/Franchise) werden nur manuell per `compare-stations` gefunden. Ziel: Warnung im Selektions-Artefakt + System-Tab. |

---

## B. Technisch (Backend, Datenhaltung, Betrieb, Qualität)

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| B1 | P0 | **Backup der App-Laufzeitdaten** | [docs/BETRIEB.md](docs/BETRIEB.md) sichert Pi-Keys und das InfluxDB-Volume — **nicht** `runtime/` (Feedback-Store = persönliche Tank-Bilanz, Selektion, Job-Stände). NAS-Disk-Crash = Bilanz weg. Ziel: täglicher Tar/Snapshot in bestehendes Backup + dokumentierter, durchgespielter Restore. |
| B2 | P0 | **Schema-Version & Migration des Feedback-Stores** | `store.json` hat kein `schema_version`; die nächste Feldänderung bricht alte Stores still. Ziel: Versionsfeld + Migrations-Funktionen je Versionssprung, Test „alter Store → neue Version". |
| B3 | P1 | **Persistenz-Entscheidung: JSON → SQLite** | Gutachten-Empfehlung (ACID). Im Ein-Haushalt-Betrieb funktioniert JSON, aber sobald A3 (Storno) und A4 (Verlauf) kommen, wird ein JSON-Rewrite pro Schreibzugriff zum Risiko. Ziel: Entscheidung fällen und festnageln (SQLite nahe dem jetzigen Schema reicht; kein PostgreSQL nötig). |
| B4 | P1 | **Aggregierter System-Alarm (ein Block in `/health` + GUI-Badge)** | Heartbeat fehlt, `no prices` > Schwelle, Job 2× fehlgeschlagen, Store-Größe, freier Festplattenplatz, CUSUM-`break_flag` — heute über sieben Endpunkte verteilt und niemand schaut aktiv. Ziel: `alarms[]` in `/api/v1/health`, roter/grüner Punkt im Header aller Tabs, optional ntfy-Versand (siehe A5). |
| B5 | P1 | **POST-/Schreib-Endpunkte gegen Flut härten** | Rate-Limit deckt GET gut ab, aber `POST /fills`/`/intent` können von einem defekten Client das Ledger fluten. Zusätzlich Plausibilitätsgrenzen serverseitig: `tanked_at` nur plausibles Fenster (nicht 1970/2100), Liter/Preis Obergrenzen, Stringlängen. Kein Auth — einfache IP-/Minuten-Drossel reicht. |
| B6 | P1 | **Luftlinien-/Umweg-Faktor vereinheitlichen** | Server rechnet in `/decide` Luftlinie × 1,3 (`CIRCUITY`), die GUI rechnet lokal × 1,0 und schickt das an `/route/evaluate` → „Server prüfen" kann eine als lohnend angezeigte Alternative für unlohnend erklären. Ziel: Server liefert `detour_km_est` + `dist_mode` pro Alternative; die GUI zeigt exakt diese Zahl, keine eigene Schätzung. |
| B7 | P1 | **HTTP-Effizienz: gzip, getrenntes Caching, Poll-Bündelung** | `no-store` auf allem, keine Kompression, GUI pollt 8+ Ressourcen (~14.700 Req/Tag > 10.000er Anonym-Budget, Zählerstand aus V2-Analyse vor den B5-Fixes — jetzt mit LRU gemildert, aber strukturell ungelöst). Ziel: `Content-Encoding: gzip`; Hash-Assets `immutable`; semi-statische Endpunkte (heatmap, last_forecasts) 15–120 min cachebar; ein Aggregat-Endpunkt `/api/v1/overview` für den Alltag statt Einzelpolls. |
| B8 | P2 | **Webhook-Retry Pi → NAS** | `POST /jobs/trigger` ist Fire-and-Forget: NAS kurz offline → Watermark verloren, läuft nur noch intervallbasiert, ohne Hinweis. Ziel: Retry mit Backoff + Quittierung, Status im Collector-Status sichtbar. |
| B9 | P2 | **Versionierung & Nachverfolgbarkeit** | Keine App-Version/kein Commit-Hash in `/health`, kein `CHANGELOG.md`. Bei Pi/NAS/Fallback-GUI (3 Oberflächen!) weiß man im Fehlerfall nicht, was wo läuft. Ziel: Version + Build-Hash in `/health`, Anzeige im Footer, kurzes CHANGELOG ab jetzt. |
| B10 | P2 | **Service-Worker: Versionierung & Update-Anzeige** | Cache-Namen sind fix `…-v1`; ein GUI-Update signalisiert dem Nutzer nichts, und die Offline-Queue aus dem Konzept (§5.4, IndexedDB) fehlt. Ziel: SW-Version im Build bumsen, „Neue Version — neu laden?"-Banner, Offline-Queue für Fill/Intent mit sichtbarem „wird gesendet, sobald online"-Zustand. |
| B11 | P2 | **Ressourcen-Abgleich Modell-Worker** | `TANKAPP_MODEL_WORKERS` bis 8 Prozesse × pandas vs. `shm_size: 256m` in [ops/nas/app/compose.yml](ops/nas/app/compose.yml) — nicht getestet; bei NAS-HDD werden außerdem File-Locks (`locked_store`, 50×0,05 s) knapp. Ziel: Lauf mit Max-Workern auf Zielhardware + Doku-Werte, Lock-Timeout erhöhen bzw. klare 503-Meldung. |
| B12 | D | **OpenAPI-Spezifikation** | M5-Fertig-Kriterium des Konzepts; bis dahin ist docs/API.md verbindlich. Lohnt erst mit zweitem API-Konsumenten (z. B. Home Assistant, eigene ntfy-Brücke) — dann aus `app/server.py` generieren, in CI pinnen. |

---

## C. GUI / UX

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| C1 | P1 | **Onboarding-/Einrichtungs-Checkliste** | Ohne private Daten zeigt die GUI den Einrichtungszustand — aber als Flachtext. Ziel: geführte Karte „1) Polling-Set ✓/✗ 2) Collector-Heartbeat 3) InfluxDB 4) erster Modell-Lauf 5) erste Empfehlung", jede Zeile mit direktem Fix-Hinweis (Link zu docs/INSTALL.md-Anker). |
| C2 | P1 | **Stamm-Stationen pinnen + Suche/Filter/Sortierung** | „Meine Stationen" lebt nur in der Werkstatt; im Alltag will der Nutzer seine 2–3 Stammstationen oben sehen. Liste bei 20+ Stationen (Frankfurt-Radius) ohne Suche/Markenfilter/Sortierung (Preis, Distanz, Netto-€). Lokal speicherbar, kein Account nötig. |
| C3 | P2 | **Karten-/Umgebungsansicht für F2** | „Hier oder woanders?" als Karte mit Netto-€-Pins. OSM-Tiles brauchen Internet (im LAN okay, wenn NAS/Handy online); Alternativen: statische Tile-Region oder reduzierte Luftlinien-Übersicht. |
| C4 | P2 | **Einstellungen-Tab zentral** | Verbrauch, Zeitwert (manuell/auto), Liter-Default, Kraftstoff, Stadt liegen verteilt in Panels. Ziel: ein Tab „Einstellungen": alle Defaults inkl. aktiver Schwellen-Tabelle (read-only aus `/api/v1/stats/summary → thresholds`), Dark/Light-Umschaltung (Fallback-GUI kann dunkel, NAS-GUI nur dunkles Slate). |
| C5 | P2 | **Barrierefreiheit-Runde** | Konkret: emerald/rose-Farbcodierung ist **Rot-Grün** — zusätzlich Symbol/Text; Charts `role="img"` mit `aria-describedby`; Slider `aria-valuetext` in €; sichtbarer Fokus-Ring; komplette Bedienung per Tastatur (Fill buchen ohne Maus); `prefers-reduced-motion`; Touch-Targets ≥ 44 px; Kontraste AA prüfen. |
| C6 | P2 | **Einheitliche Leer-/Lade-/Fehler-Zustände** | Panels unterscheiden sich (Spinner vs. Text vs. nichts). Ziel: Skeletons, `Retry`-Button mit `error_code`-Text (Problem-Mapping existiert in `data.ts`), „Datenstand älter als X"-Banner konsistent, Anzeige „Reichweite der Daten" (z. B. Heatmap: 6 Wochen) je Panel. |
| C7 | P2 | **Hilfe/Glossar-Layer** | δ̂, MASE, PICP, Brier, ε, Regret — Werkstatt-Begriffe ohne Erklärung in der App. Ziel: i-Tooltips + eine kurze „Was heißt das?"-Seite (kann auf docs/ANALYSE.md-Anker verweisen), Begriffe konsistent zur Doku. |
| C8 | P2 | **Mobile-Feinschliff & PWA** | Sticky-Aktions-Chip im Alltag („Jetzt tanken / Warten bis …" beim Scrollen sichtbar), Install-/„Zum Homescreen"-Hinweis (manifest ist da, Prompt fehlt), Landscape-Layout der Tageskurve prüfen, Pull-to-Refresh dort unterdrücken, wo er mit Karten-/Slider-Gesten kollidiert. |
| C9 | P2 | **Formatierungs-Konventionen** | Durchgängig de-DE: ct/L vs €/L nicht mischen (beides vorkommend), einheitliche Rundung (3 Nachkommastellen €/L, 1 Nachkommastelle ct), Uhrzeiten „18–20 Uhr" überall in Europe/Berlin. Kleiner ESLint-/Test-geschützter Formatter-Satz in `data.ts`. |

---

## D. Code-Wartbarkeit (Voraussetzung für C-Features)

| # | Prio | Fehlt | Details |
|---|---|---|---|
| D1 | P1 | **`Dashboard.tsx` zerlegen (3 415 Zeilen in einer Datei)** | Tab-weise Module (`views/Daily.tsx`, `views/Statistics.tsx`, `views/System.tsx`) + geteilte UI-Bausteine (Panel, Metric, Badge, EmptyState). Sonst kollidiert jede C-Arbeit mit Merge- und Review-Kosten. |
| D2 | P1 | **e2e-Abdeckung der Entscheidungs-Flows** | Jetzige Playwright-Specs mocken nur `stations`/`series`/`forecast`. Fehlt: `decide`-Mock → Intent „Ich warte" → Due-Prompt → Fill buchen → Fehlerfall 429/Offline (Erfolgsmeldung darf nur bei Erfolg — V3-Fix ist drin, aber ungesichert). |
| D3 | P2 | **Property-Tests Umweg-Ökonomie** | `K = d·(c/100)·p + (d/v)·z`: Monotonie in Litern, Grenzfälle `z=0`, `d=0`, `liters→∞` mit fast-check abstecken (Schwellen-`worth_it`-Logik inklusive). |
| D4 | P2 | **Qualitäts-Gates in CI: Lighthouse + Last** | M4-Kriterium „Lighthouse > 90" nie gemessen; kein Last-Test, ob das GUI-Polling (B7) unter dem Rate-Limit bleibt. Ziel: Lighthouse-CI-Job mit Budget, kleiner K6-/Autocannon-Pfadtest gegen den Docker-Stack. |

---

## E. Funktional & Eingabe (Prüfstrang 2: „Funktioniert der Kern, kann man eingeben?")

Vorab — **verifiziert funktionsfähig** (kein Task, zur Einordnung): Alle Schreibpfade
existieren und sind mit der GUI verdrahtet: `POST /fills` (Validierung 5–100 L,
0,40–5,00 €/L, unbekannte Station → `unknown_station`, Nowcast-Zufall),
`POST /episodes/{id}/intent`, `POST /jobs/{job}/run` (Startknopf), `POST /collector/heartbeat`,
`POST /jobs/trigger` (HMAC). Server-Statuscodes 4xx, GUI prüft `error_code` vor
Erfolgsmeldung. Fallback-GUI (rp2): Liter-Eingabe geclampt 5–100 und persistent.

| # | Prio | Fehlt / falsch | Definition of Done |
|---|---|---|---|
| E1 | **P0** | **Toter Block „Paar-Ökonomie" im Stations-Labor:** `pairEco`/`pairDailyNets` werden berechnet, aber **nirgends gerendert**; die drei Steuerungs-State-Setter (`setPairAltId`, `setPairDetourKm`, `setPairPeak`) haben **0 Aufrufe** — keine Eingabemöglichkeit. Zusätzlich §0.4-Verstoß: `refPrice: selectedPrice \|\| 1.70`, `altPrice: … \|\| (selectedPrice - 0.04 \|\| 1.66)` → **erfundene Preise**, exakt die Kategorie, die V3 im Hero behoben hat. | Entscheiden: Panel mit echten Controls fertig bauen (Vergleichsstation-Select, Umweg-km, Peak-Schalter, Preise nur aus echten Meldungen) **oder** den Block samt States entfernen. Kein dritter Zustand. |
| E2 | **P0** | **Komma-Dezimalzahlen nicht eingebbar:** Beleg-Dialog nutzt `type="number"` ohne `inputMode="decimal"`; deutsche Mobil-Tastaturen liefern `1,689` → `Number("1,689") = NaN` → generische Fehlermeldung, ohne Hinweis warum. Der Hauptbeleg der App scheitert an der Tastatur. | `inputMode="decimal"`, Wert als String state, `,`→`.`-Normalisierung, Sofort-Validierung mit Klartext („Preis wie an der Säule, z. B. 1,629"). Unit-Test in `data.test.ts`. |
| E3 | P1 | **GUI-Validierung deckt Server-Regeln nicht ab:** `customLiters`/`customPrice` haben **keine min/max-Attribute**; GUI prüft nur `> 0`, Server verlangt 5–100 L / 0,40–5,00 €/L → Eingaben wie 101 L oder 9,99 € scheitern erst nach Server-Roundtrip mit Fachfehler. | `min`/`max`/`step` am Input + gleiche Grenzen clientseitig prüfen, Fehlermeldung direkt am Feld. |
| E4 | P1 | **Beleg ohne Station wählbar:** Bei nicht ausgewählter Station sendet `handleCustomFill` `station_id: "custom"` → Server lehnt mit `unknown_station` ab. Der Nutzer kann den Fehler nicht selbst beheben. | Stations-Auswahl im Beleg-Dialog oder Button deaktivieren + Hinweis „Station wählen". |
| E5 | P1 | **`heatmapWeeks` ohne Eingabeweg:** GUI sendet `weeks=` an `/api/v1/heatmap`, die Preference existiert, aber `setHeatmapWeeks` hat 0 Aufrufe → Zeitraum ist fest verdrahtet, kein Umschalten möglich. | Wochen-Select (4/6/12) neben „Heatmap Art" oder Parameter aufräumen. |
| E6 | P2 | **Slider ohne Präzision/Direkteingabe:** Verbrauch `step=1` (6,3 L/100 unwählbar — beeinflusst jede Umweg-Rechnung), Liter `step=5`, Zeitwert `step=1`; kein Begleit-Zahlenfeld, kein `aria-valuetext` in Währung. | `step=0.5` beim Verbrauch, optional number-Begleitfeld, `aria-valuetext` (zählt zu C5). |
| E7 | P2 | **API-Explorer „day (Beispiel)":** `identity` leer ⇒ Aufruf mit leerem `station_id` → nur Fehleranzeige. | Label dynamisch: Beispiel nur anbieten, wenn eine Station gewählt ist; sonst grau + Hinweis. |

## F. App-Texte & UX-Sprache (Prüfstrang 2)

| # | Prio | Befund | ToDo |
|---|---|---|---|
| F1 | P1 | **Begriffs-Wirrwarr:** Tab heißt „Statistik", Seitenkicker „Werkstatt / Statistik", Konzept/Doku sprechen von „Werkstatt"; Tooltip-Text nennt den internen Doku-Begriff „Prüfstand" („wähle einen bewerteten Tag im Prüfstand"). | Ein Nutzer-Vokabular festlegen (Empfehlung: Alltag / **Werkstatt** / System) und UI + Doku drauf ziehen; „Prüfstand" aus Nutzertexten streichen. |
| F2 | P1 | **Anglizismen/Fachjargon in Labels:** „Cheap-Probability P(p ≤ Median)", „AV-Score", „δ̂ Ranking", „Out-of-Sample", „Regret", „Badge" intern. | Deutsche Kurzformen als Primärtext („Wahrscheinlichkeit für günstig", „Ampel-Stärke"), Formel/Fachwort ins Tooltip (→ C7 Glossar). |
| F3 | P2 | **Typografie uneinheitlich:** Anführungszeichen gemischt („warten“ vs. gerade '"'), „Brier-Score 30d" statt „30 Tage"; ct/L und €/L wechseln ohne Regel; Footer/Microcopy teils englische Hook-Zeilen („Nachvollziehen statt blind vertrauen." ✓ gut) vs. Fachlabels. | Microcopy-Regelwerk (eine Seite, in docs/README verlinkt): Einheiten, Zitate, Zahlenformate, Tonfall „ehrlich, knapp, handlungsleitend". |
| F4 | P2 | **Intent-Leiste zeigt immer alle 4 CTAs** („Ich warte / Navigieren / Jetzt tanken / Verwerfen") — bei Aktion `refuel_now` ist „Ich warte" als gleichrangiger CTA irritierend; bei `wait` ist „Jetzt tanken" irritierend. | Empfohlene Aktion als primären Button, kompatible Intents sekundär, widersprechende Intent mit Erklär-Tooltip (Logik ändert nichts, nur Sichtbarkeit/Gewichtung). |
| F5 | P2 | **Sonst sauber geprüft:** Fehlertexte in `web/src/data.ts` (`messages`) durchgehend sachlich-deutsch ohne erfundene Inhalte ✓; Fallback-GUI-Texte konsistent ✓; keine Demo-/Lorem-Reste ✓; Ladezustände einheitlich formuliert („… wird geladen/berechnet"). | Kein Task — als Referenz in das F3-Regelwerk übernehmen. |

## G. Storage-Management: rp2/Pi & NAS (Prüfstrang 2)

| # | Prio | Befund | ToDo |
|---|---|---|---|
| G1 | **P1** | **`rp2/cache_forecasts.py` wächst unbegrenzt:** `cache.log` wird alle 5 min angehängt, **kein Rotate/Cap** — auf dem RP2 dauerhaft wachsend (je nach OS-Layout liegt `/tmp` auf der SD-Karte → zusätzlich SD-Wear durch 288 Schreibzugriffe/Tag). | Größen-Cap (z. B. 1 MB Ring: bei Überschreiten ältere Hälfte verwerfen) oder auf journald/stdout umstellen; in rp2/ANLEITUNG vermerken. Unit-Test auf Cap-Verhalten. |
| G2 | P2 | **Journal-Wachstum der rp2-Dienste nicht begrenzt/dokumentiert:** `fallback_gui` + `cache_forecasts` loggen nach journald; auf der SD ohne Caps wächst das Journal monatelang. | In ANLEITUNG: `SystemMaxUse=50M` für die Units oder `journalctl --vacuum-size` als Wartungsschritt; optional Drop-in-Beispiel beilegen. |
| G3 | P2 | **Datenverlust-Fenster ist implizit:** Ringpuffer behält 7 Tage (`RING_DAYS=7`); ist der NAS > 7 Tage offline, verwirft `ring_prune` noch nicht hochgeladene Snapshots — der Verlust ist nirgends benannt. | Fenster in docs/ARCHITEKTUR.md/BETRIEB.md nennen + Empfehlung: bei geplantem NAS-Ausfall Puffer lokal vergrößern (tmpfs-Größe vs. 15 Polls/Tag/Station beispielhaft rechnen). |
| G4 | P2 | **`/tmp/tankapp_cache` überlebt keinen Reboot** → Fallback-GUI zeigt nach Pi-Neustart bis zum ersten erfolgreichen Fetch „keine Prognose". Ehrlich, aber unerwartet. | Ein Satz in rp2/ANLEITUNG; kein Code-Zwang. |
| G5 | ✓ | **NAS-Seite geprüft, in Ordnung:** Influx-Bucket-Retention 43 800 h (5 J.) dokumentiert; Feedback-Store 90-Tage-Retention + Archiv (seit 11.09.); Job-Logs 500 Zeilen; Docker `json-file` 5m × 2; Container ohne root, `no-new-privileges`, `cap_drop: ALL`; tmpfs-Heartbeat (used/total MB, älteste Datei) fließt zur NAS. | Kein Task. Verbleibende Punkte dazu: `runtime/`-Gesamtgröße ins Monitoring (→ B4) und Backup (→ B1). |

## H. Mathematik (Prüfstrang 2: „muss mathematisch was getan werden?")

Kurzantwort: **kein Rechenfehler gefunden** — Formeln (Umweg-`K`, Netto-€, `p_besser`/`p_lohnt` aus Draws, Settlement gegen beobachtete Minima, PAVA/12-Uhr ist bekannt sauber). Die offenen mathematischen Punkte sind **Konsistenz und dokumentierte Ausbauten**, keine Bugs:

| # | Prio | Befund | ToDo |
|---|---|---|---|
| H1 | **P1** | **Umweg-Schwellen sind doppelt gepflegt:** GUI `detourEconomics` kodiert hart `netEur ≥ 1,5 / ≥ 0,5`; Server nutzt `active_thresholds()["elsewhere_net_eur"]` (verändert sich mit M7-Tuning). Dieselbe B6-Divergenz wie Circuitity ×1,0 (GUI) vs ×1,3 (Server) — zusammen ein Formel-Konsistenz-Problem: „Server prüfen" kann das Gegenteil der GUI-Badge sagen. | Server liefert `verdict`/`worth_it` + Schwellen in der Antwort; GUI zeigt ausschließlich das; `data.ts`-Konstanten entfernen. (Mit B6 zusammenführen.) |
| H2 | P1 | **Platzhalterpreise in `pairEco`** (1,70 / −0,04 / 1,66): macht jede dahinter liegende Rechnung mathematisch falsch angezeigt — redundant zu E1, weil dort die Lösung (bauen oder löschen) festgelegt wird. | Siehe E1. |
| H3 | D | **M7-Tuning-Regler ohne Oszillationsschutz dokumentiert:** Schwellen-Vorschlag begrenzt Schritte, aber Zusammenspiel von Schrittweite, Mindest-Abstand zwischen Anpassungen und n-Basis (n ≥ 25) ist nicht als Regel festgeschrieben — bei kleinen Stichproben können Schwellen pendeln. | Kurze Methodik-Notiz + Hysterese (nur ändern, wenn \|Δ\| > Rauschband) in `app/thresholds.py` + Test „stabile Schwellen bei Rauschdaten". |
| H4 | D | **Weiterhin offen (bereits gelistet, hier qualifiziert):** Hampel-Filter, Feiertags-Dummy je Bundesland, Zeitsprung-Hazard, M3-Ensemble, Mehrtage-Backtests, 21-Tage-Gate im Auto-Lauf, Rolling-PICP live, gemeinsame Bootstrap-Ziehung über Stationen (§4.2), w(h)-Rückkopplung ≥ 8 Füllungen. | Bleiben A9–A11 mit Datenbedarf; Reihenfolge nach M7-Fortschritt (A7). |
| H5 | P2 | **DST-Kante `seasonal_scale`:** bei Zeitumstellung kann der Vortages-Anker `NaT` liefern → MASE `None` an ~2 Tagen/Jahr (korrekt als None, kein falsches Ergebnis). | Backtest soll DST-Tage explizit behandeln (ausschließen oder 23/25-h-Tage normalisieren) + Randnotiz in engine/README, statt stillem `None`. |
| H6 | P2 | **Magic Numbers in Auswertungen:** `pairDailyNets` startet bei `i = 42` (Warm-up) ohne Kommentar/Config; Scoreboard-Formeln sind Tests gedeckt, die Zahl aber nicht benannt. | Konstante benennen + Herkunft (42-Tage-Trainingsfenster) kommentieren; in D3-Property-Tests mit aufnehmen. |

---

## Quick Wins (jeweils ≤ ½ Tag, ohne Architektur-Abhängigkeit)

1. **A3** Storno-Flag für Fills (`DELETE /fills/{id}` → `voided`, Audit-Zeile) + Button im Wallet.
2. **A6** CSV-Export `GET /api/v1/fills.csv` + Download-Link im System-Tab.
3. **B1** Eine Zeile Backup-Skript für `runtime/` + Restore-Absatz in BETRIEB.md.
4. **B4** `alarms[]`-Array in `/health` (nur Aggregation vorhandener Prüfungen) + roter Punkt im Header.
5. **B6/H1** Umweg: Server liefert `detour_km_est` **und** `verdict`/Schwellen; GUI-Eigenrechnung raus.
6. **B9** Version/Commit in `/health` + Footer-Anzeige.
7. **C1** Einrichtungs-Checkliste als Daten-getriebene Karte (Status kommt aus vorhandenen Endpunkten).
8. **C5** Zwei schnelle A11y-Fixes: Ampel-Chip mit Symbol (▲/▼/●) statt nur Farbe, Slider-`aria-valuetext` in €.
9. **D2** Eine Playwright-Spec „decide → intent → fill → due" mit Mocks — schützt alle V3-Fixes.
10. **A7** Fortschritts-Kachel „M7: n/100 Settlements, Brier x (Ziel < 0,25)" — Daten liegen in `/stats/summary` schon vor.
11. **E1** `pairEco`-Block löschen (wenn nicht sofort fertig gebaut) — entfernt toten Code **und** den letzten erfundenen-Preis-Verstoß.
12. **E2** Komma-Eingabe: `inputMode="decimal"` + `,`→`.`-Normalisierung im Beleg-Dialog.
13. **G1** `cache.log`-Cap (20 Zeilen Code) — stoppt unbegrenztes Wachstum auf dem RP2.
14. **F1** Tab-Label „Statistik" → „Werkstatt" (inkl. Sekundär-Texte) — eine Zeile Code + Terminologie-Commit.
15. **H6** `i = 42` benennen — fünf Minuten, rechtfertigt sich beim nächsten Lesen.

---

## Bewusst NICHT in dieser Liste

- **Login, Benutzerkonten, Rollen, Mandanten, OAuth/SSO** — LAN-only per Vorgabe.
- **DSGVO-Löschkonzept, Daten-Portabilität für Fremdnutzer, Consent-Management** — keine Fremddaten.
- **i18n über Deutsch hinaus** — Zielgruppe ist ein deutschsprachiger Haushalt.
- **Öffentliche Skalierung** (CDN, Multi-Instanz, Loadbalancer) — ein NAS, ein Haushalt.

## Reihenfolge-Empfehlung

1. **P0 zuerst:** A3 (Storno), B1 (Backup), B2 (Schema-Version) — schützt die persönliche Bilanz, bevor echte Daten anwachsen.
2. **P0 aus Prüfstrang 2 sofort danach:** E1 (toten Block + erfundene Preise entfernen/fertig bauen) und E2 (Komma-Eingabe) — beides betrifft den Alltags-Hauptweg des Produkts.
3. **Dann B6/H1 + B7** (Entscheidungs-Zahlen intern widerspruchsfrei und API-Last gesenkt) und **C1** (Inbetriebnahme führbar machen).
4. **D1 direkt vor dem ersten größeren C-Feature** — sonst verdoppelt sich der Aufwand.
5. **D-Items erst nach Live-Daten** (M7-Termin, Rabatte, Engine-Ausbau) — sie stehen begründet in docs/LUECKEN.md.
