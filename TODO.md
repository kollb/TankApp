# TankApp — ToDo (Stand 12.09.2026, App-Version 0.16.0)

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
> **Quellen:** [docs/LUECKEN.md](docs/LUECKEN.md) (Konzept ↔ Stand) und die
> Prüfberichte im [Archiv](docs/archiv/README.md) —
> [Prüfstand 10.09.](docs/archiv/PRUEFSTAND-2026-09-10.md),
> [Tiefenanalyse V1](docs/archiv/TIEFENANALYSE-2026-09-11.md)/
> [V2](docs/archiv/TIEFENANALYSE-V2-2026-09-11.md)/
> [V3-GUI](docs/archiv/TIEFENANALYSE-V3-GUI-2026-09-11.md),
> [Gutachten](docs/archiv/GUTACHTEN-2026-09-10.md).
> Diese Liste ist die priorisierte Arbeitsliste daraus. **Erledigte Punkte stehen
> hier nicht mehr** — sie sind im [CHANGELOG](CHANGELOG.md) und in
> [docs/LUECKEN.md](docs/LUECKEN.md#umgesetzt-seit-der-prüfung-am-10092026)
> nachvollziehbar; die IDs (A3, B4, …) bleiben dort stabil.

---

## A. Fachlich (Produkt & Domäne)

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| A1 | P1 | **Fahrzeug-/Haushaltsprofile ohne Login** | Verbrauch, Zeitwert, Tankmenge, Kraftstoffart liegen heute im `localStorage` pro Browser → Handy ≠ PC, zweites Fahrzeug (Diesel vs. Benziner) unmöglich. Ziel: Profil-Umschalter im Header, serverseitig gespeichert (pro Haushalt, kein Account), GUI-Felder lesen daraus. |
| A2 | P1 | **Tankstand / Restreichweite als Eingabe für F3** | Konzept-F3 („Tank bei ¼, kann ich warten?“) hat keinen Tankstand-Input. Ziel: Fuellstand-Angabe (≈ Füllstand oder Rest-km), App sagt ehrlich „Warten riskant, Reserve reicht ~40 km“ statt nur „bestes Fenster morgen“. |
| A4 | P1 | **Jahres-/Monatsbilanz in der Werkstatt** | Konzept §12 P2: „Wallet-Ledger im Alltag, **Jahresbilanz in der Werkstatt**“. Heute nur Summen-Kacheln im Alltag. Ziel: Verlaufsliste der Fills, Monats-/Jahressumme, Ø €/Tankung, Vergleich gegen „immer sofort getankt“-Baseline (Regret-Ratio ist vorhanden, nur nicht persönlich aufbereitet). |
| A8 | D | **Markenrabatte/Karten** (`--brand-rebate`) | 2–4 ct können das F2-Ranking umdrehen. Erst sinnvoll, sobald echte Rabattdaten vorliegen; bis dahin soll die GUI im Ranking anzeigen „rechnet ohne Rabattprogramme“ (Transparenz-Hinweis). |
| A9 | D | **w(h)-Rückkopplung anschließen** | Persönliches Zeitprofil (`wallet.wh_hours`) wird berechnet, fließt aber nicht in „billigste Stunde“/F3 ein (Konzept §5.5). Ab ≥8 Füllungen aktivieren, vorher Default — mit UI-Hinweis ab wann personalisiert. |
| A10 | D | **M3-Zweitmodell/Ensemble + Echt-Daten-Abnahme** | Hampel-Filter, Feiertags-/Sprung-Features, Mehrtage- und 21-Tage-Backtest sowie Rolling-PICP sind seit PR #69 implementiert und testgedeckt. Offen bleiben das unabhängige Zweitmodell mit inverse-MASE-Ensemble und die Abnahme aller M3-Kriterien auf echten Live-Daten. |
| A11 | D | **Gemeinsame Bootstrap-Ziehung für `p_lohnt`** | Konzept §4.2: Marktgleichlauf darf nicht wegkorreliert werden. Braucht stationsübergreifenden Resampling-Schritt (gleicher Tagesblock je Ziehung) — eigener Arbeitsschritt, in LUECKEN begründet offen. |
| A12 | P2 | **Station-Lebenszyklus & Zustandsehrlichkeit** | „führt E10 nicht“ vs. „temporär geschlossen“ vs. „keine Daten seit n Tagen“ wird in der GUI nicht unterschieden. Tote Stationen (`no prices` > 7 Kalendertage) sollen automatisch aus Ranking/Polling-Set fallen (konfigurierbar), nicht dauerhaft Kontingent kosten. |
| A13 | P2 | **Preis-Zwillinge: automatische Warnung** | Identische Preisverläufe zweier Stationen (Doppel-Source/Franchise) werden nur manuell per `compare-stations` gefunden. Ziel: Warnung im Selektions-Artefakt + System-Tab. |

---

## B. Technisch (Backend, Datenhaltung, Betrieb, Qualität)

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| B7 | P1 | **HTTP-Effizienz: Poll-Bündelung** *(gzip + Cache-Schichten sind drin, 0.13.0)* | Erledigt: `Content-Encoding: gzip` für JSON (ab 512 B), `heatmap`/`last_forecasts` mit `public, max-age=900` (Hash-Assets waren schon `immutable`). Offen ist der teure Rest: GUI pollt 8+ Ressourcen (~14.700 Req/Tag, Zählerstand aus V2-Analyse) — Ziel: ein Aggregat-Endpunkt `/api/v1/overview` für den Alltag statt Einzelpolls; separat entscheiden, ob sich Poll-Bündelung lohnt. |
| B8 | P2 | **Webhook-Retry Pi → NAS** | `POST /jobs/trigger` ist Fire-and-Forget: NAS kurz offline → Watermark verloren, läuft nur noch intervallbasiert, ohne Hinweis. Ziel: Retry mit Backoff + Quittierung, Status im Collector-Status sichtbar. |
| B10 | P2 | **Service-Worker: Versionierung & Update-Anzeige** | Cache-Namen sind fix `…-v1`; ein GUI-Update signalisiert dem Nutzer nichts, und die Offline-Queue aus dem Konzept (§5.4, IndexedDB) fehlt. Ziel: SW-Version im Build bumsen, „Neue Version — neu laden?“-Banner, Offline-Queue für Fill/Intent mit sichtbarem „wird gesendet, sobald online“-Zustand. |
| B11 | P2 | **Ressourcen-Abgleich Modell-Worker** | `TANKAPP_MODEL_WORKERS` bis 8 Prozesse × pandas vs. `shm_size: 256m` in [ops/nas/app/compose.yml](ops/nas/app/compose.yml) — nicht getestet; bei NAS-HDD werden außerdem File-Locks (`locked_store`, 50×0,05 s) knapp. Ziel: Lauf mit Max-Workern auf Zielhardware + Doku-Werte, Lock-Timeout erhöhen bzw. klare 503-Meldung. |

---

## C. GUI / UX

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| C2 | P1 | **Stamm-Stationen pinnen + Suche/Filter/Sortierung** | „Meine Stationen“ lebt nur in der Werkstatt; im Alltag will der Nutzer seine 2–3 Stammstationen oben sehen. Liste bei 20+ Stationen (Frankfurt-Radius) ohne Suche/Markenfilter/Sortierung (Preis, Distanz, Netto-€). Lokal speicherbar, kein Account nötig. |
| C3 | P2 | **Karten-/Umgebungsansicht für F2** | „Hier oder woanders?“ als Karte mit Netto-€-Pins. OSM-Tiles brauchen Internet (im LAN okay, wenn NAS/Handy online); Alternativen: statische Tile-Region oder reduzierte Luftlinien-Übersicht. |
| C4 | P2 | **Einstellungen-Tab zentral** | Verbrauch, Zeitwert (manuell/auto), Liter-Default, Kraftstoff, Stadt liegen verteilt in Panels. Ziel: ein Tab „Einstellungen“: alle Defaults inkl. aktiver Schwellen-Tabelle (read-only aus `/api/v1/stats/summary → thresholds`), Dark/Light-Umschaltung (Fallback-GUI kann dunkel, NAS-GUI nur dunkles Slate). |
| C5 | P2 | **Barrierefreiheit-Runde, Rest** *(Fokus-Ring + Charts-Textfassungen sind drin, 0.13.0)* | Erledigt: Ampel-Chip mit Symbol (▲/▼/●/→) und Slider mit `aria-valuetext` (0.10.0); Fokus-Ring durchgängig (die `outline-none`-Überschreibungen an den 0.11-Eingabefeldern sind entfernt) und alle Charts `role="img"` **mit** `aria-describedby`-Textfassung (0.13.0), `prefers-reduced-motion` war schon in `styles.css`. Offen: Touch-Targets ≥ 44 px, Kontraste AA prüfen, komplette Bedienung per Tastatur (Beleg buchen ohne Maus). |
| C6 | P2 | **Einheitliche Leer-/Lade-/Fehler-Zustände** *(Heatmap-Reichweite 0.14.0, gemeinsamer Fehler-Zustand 0.15.0)* | Erledigt: Das Heatmap-Panel nennt Bestand und Reichweite (`range_from`/`range_to` → „12.345 Preise von 18 Stationen · Di 08.09. 05:10 – Sa 12.09. 07:55 Uhr“) und erklärt, wenn das Fenster größer ist als der Bestand („fehlende Tage, kein Datenverlust“). Seit 0.15.0 gibt es außerdem **einen** gemeinsamen Fehler-Zustand: `components/LoadError.tsx` (Klartext aus `problem(error_code)`, Rohcode darunter, `Erneut laden`-Knopf, `role="alert"`, schmale Variante für Inline-Boxen) ist in sechs Panels verdrahtet — Empfehlung im Alltag, Tagesverlauf, Tankbelege, Preisverlauf, Modell-Ausblick, Collector-Status. Offen: Skeletons statt Spinner/Text-Mix, „Datenstand älter als X“-Banner konsistent, Reichweiten-Zeile für die übrigen Panels, und die Fehler-Zustände in den Tabellen-Zellen (Entscheidungs-Scoreboard, Tages-Entscheidungen) nutzen noch eigene Texte. |
| C7 | P2 | **Hilfe/Glossar-Layer** | δ̂, MASE, PICP, Brier, ε, Regret — Werkstatt-Begriffe ohne Erklärung in der App. Ziel: i-Tooltips + eine kurze „Was heißt das?“-Seite (kann auf docs/ANALYSE.md-Anker verweisen), Begriffe konsistent zur Doku. |
| C8 | P2 | **Mobile-Feinschliff & PWA** | Sticky-Aktions-Chip im Alltag („Jetzt tanken / Warten bis …“ beim Scrollen sichtbar), Install-/„Zum Homescreen“-Hinweis (manifest ist da, Prompt fehlt), Landscape-Layout der Tageskurve prüfen, Pull-to-Refresh dort unterdrücken, wo er mit Karten-/Slider-Gesten kollidiert. |
| C9 | P2 | **Formatierungs-Konventionen** *(Formatter-Satz + alle Anzeigen umgestellt, 0.14.0/0.15.0)* | Erledigt: `euroPerLiter` (3 Stellen), `centPerLiter` (1 Stelle), `euroToCentPerLiter`, `percentLabel`, `countLabel`, `hourRangeLabel` plus `hourBucketLabel`/`hourRunsLabel` in `web/src/data.ts`, vitest-geschützt; die Heatmap nutzt sie durchgängig („2,219 €/L“ statt „2.219“, „100 %“ statt „100%“). Seit 0.15.0 sind auch die übrigen Anzeigen umgestellt: alle 21 `toFixed`-Stellen in `Dashboard.tsx` (PICP, δ̂, Bootstrap-KI, q-Wert, Ampel-Stärke, MASE, CUSUM, tmpfs, ε-`aria-valuetext`) plus die Standard-Formatierer in `LineChart`/`LabCharts` nutzen `euro`/`percentLabel`/`centPerLiter`; `format-convention.test.ts` zählt die verbleibenden Stellen je Datei (SVG-Koordinaten und die beiden Preis-Eingabefelder, die mit `commaToDot` normalisieren) und meldet jede neue. Offen: ct/L und €/L **inhaltlich** gemischt (mal Cent, mal Euro für dieselbe Größe — Entscheidung je Panel), Uhrzeiten überall auf Europe/Berlin prüfen, Anführungszeichen vereinheitlichen (F3). |

---

## D. Code-Wartbarkeit (Voraussetzung für C-Features)

| # | Prio | Fehlt | Details |
|---|---|---|---|
| D1 | P1 | **`Dashboard.tsx` zerlegen — zweiter Schnitt** *(Bausteine + UI-Grundlagen sind raus, 0.13.0/0.15.0)* | Erledigt: `PrecisionSlider`, `HeatmapGrid`, `ApiExplorer` (0.13.0), dazu `LoadError` (C6, 0.15.0) und seit 0.15.0 **die geteilten UI-Bausteine** in `web/src/components/ui.tsx` — `panel` (Karten-Klasse), `Empty`, `Badge`, `Metric` inkl. Render-Test (`ui.test.tsx`); `Dashboard.tsx` steht damit bei 4 098 Zeilen. `HeatmapGrid` zeigt seit 0.14.0 den Zielzuschnitt: Rechnung als reine Funktionen in `data.ts`, Komponente rendert nur, Render-Test daneben. Offen: der eigentliche Views-Schnitt (`views/Daily.tsx`, `views/Statistics.tsx`, `views/System.tsx`) — die drei Tabs teilen sich heute ~100 `useState`/`useResource`-Aufrufe in **einer** Komponente, der Schnitt braucht also erst eine Entscheidung, ob der gemeinsame Zustand per Props oder per Context wandert; außerdem `JobCard` (~200 Zeilen) auslagern. Sonst kollidiert jede C-Arbeit mit Merge- und Review-Kosten. |
| D4 | P2 | **Qualitäts-Gates in CI: Lighthouse + Last** | M4-Kriterium „Lighthouse > 90“ nie gemessen; kein Last-Test, ob das GUI-Polling (B7) unter dem Rate-Limit bleibt. Ziel: Lighthouse-CI-Job mit Budget, kleiner K6-/Autocannon-Pfadtest gegen den Docker-Stack. |

---

## E. Funktional & Eingabe (Prüfstrang 2: „Funktioniert der Kern, kann man eingeben?“)

Vorab — **verifiziert funktionsfähig** (kein Task, zur Einordnung): Alle Schreibpfade
existieren und sind mit der GUI verdrahtet: `POST /fills` (Validierung 5–100 L,
0,40–5,00 €/L, unbekannte Station → `unknown_station`, Nowcast-Zufall — seit
0.11.0 prüft die GUI dieselben Grenzen **vor** dem Roundtrip und bucht ohne
gewählte Station gar nicht erst, E3/E4),
`POST /episodes/{id}/intent`, `POST /jobs/{job}/run` (Startknopf), `POST /collector/heartbeat`,
`POST /jobs/trigger` (HMAC). Server-Statuscodes 4xx, GUI prüft `error_code` vor
Erfolgsmeldung. Fallback-GUI (rp2): Liter-Eingabe geclampt 5–100 und persistent.

Die Prüfpunkte dieses Abschnitts (E1–E7) sind abgearbeitet — E2 in 0.10.0,
E3/E4/E5/E6/E7 in 0.11.0; nachvollziehbar im
[CHANGELOG](CHANGELOG.md#0110--2026-09-12). Neue Eingabefehler hier bitte mit
demselben Muster melden: Befund, Grenze, Definition of Done.

## F. App-Texte & UX-Sprache (Prüfstrang 2)

| # | Prio | Befund | ToDo |
|---|---|---|---|
| F3 | P2 | **Typografie** *(Regelwerk + Zitate erledigt, 0.16.0)* | Erledigt: [docs/MICROCOPY.md](docs/MICROCOPY.md) — eine Seite, verlinkt aus `docs/README.md`, Repo-`README` und `AGENTS.md`: Tonfall, `„…“`-Zitate, Sonderzeichen, **Regel Niveaus in €/L, Differenzen in ct/L**, Uhrzeiten Europe/Berlin, Benennungen, Leer-/Lade-/Fehlermuster, „was nie im Text steht“; Ratchet `web/src/microcopy.test.ts` (paarige `„…“`, kein `”`, keine HTML-Entities) plus einmalige Bereinigung der gemischten Zitate in Doku und CHANGELOG. Offen: die **inhaltliche** ct/L-€/L-Wahl je Panel tatsächlich durchziehen (C9-Rest) und die Fachlabel-vs.-Hook-Zeilen im Footer an das Regelwerk angleichen. |
| F4 | P2 | **Intent-Leiste zeigt immer alle 4 CTAs** („Ich warte / Navigieren / Jetzt tanken / Verwerfen“) — bei Aktion `refuel_now` ist „Ich warte“ als gleichrangiger CTA irritierend; bei `wait` ist „Jetzt tanken“ irritierend. | Empfohlene Aktion als primären Button, kompatible Intents sekundär, widersprechende Intent mit Erklär-Tooltip (Logik ändert nichts, nur Sichtbarkeit/Gewichtung). |
| F5 | P2 | **Sonst sauber geprüft:** Fehlertexte in `web/src/data.ts` (`messages`) durchgehend sachlich-deutsch ohne erfundene Inhalte ✓; Fallback-GUI-Texte konsistent ✓; keine Demo-/Lorem-Reste ✓; Ladezustände einheitlich formuliert („… wird geladen/berechnet“). | Kein Task — als Referenz in das F3-Regelwerk übernehmen. |

## G. Storage-Management: rp2/Pi & NAS (Prüfstrang 2)

| # | Prio | Befund | ToDo |
|---|---|---|---|
| G4 | P2 | **`/tmp/tankapp_cache` überlebt keinen Reboot** → Fallback-GUI zeigt nach Pi-Neustart bis zum ersten erfolgreichen Fetch „keine Prognose“. Ehrlich, aber unerwartet. | Wie geht man damit um? |

## H. Mathematik (Prüfstrang 2: „muss mathematisch was getan werden?“)

Kurzantwort: **kein Rechenfehler gefunden** — Formeln (Umweg-`K`, Netto-€, `p_besser`/`p_lohnt` aus Draws, Settlement gegen beobachtete Minima, PAVA/12-Uhr ist bekannt sauber). Die offenen mathematischen Punkte sind **Konsistenz und dokumentierte Ausbauten**, keine Bugs:

| # | Prio | Befund | ToDo |
|---|---|---|---|
| H3 | D | **M7-Tuning-Regler ohne Oszillationsschutz dokumentiert:** Schwellen-Vorschlag begrenzt Schritte, aber Zusammenspiel von Schrittweite, Mindest-Abstand zwischen Anpassungen und n-Basis (n ≥ 25) ist nicht als Regel festgeschrieben — bei kleinen Stichproben können Schwellen pendeln. | Kurze Methodik-Notiz + Hysterese (nur ändern, wenn \|Δ\| > Rauschband) in `app/thresholds.py` + Test „stabile Schwellen bei Rauschdaten“. |
| H4 | D | **Weiterhin offen (bereits gelistet, hier qualifiziert):** M3-Zweitmodell/Ensemble, gemeinsame Bootstrap-Ziehung über Stationen (§4.2) und w(h)-Rückkopplung ab ≥8 Füllungen. | Bleiben A9–A11 mit Datenbedarf; Reihenfolge nach M7-Fortschritt (A7). |
| H5 | P2 | **DST-Kante `seasonal_scale`:** bei Zeitumstellung kann der Vortages-Anker `NaT` liefern → MASE `None` an ~2 Tagen/Jahr (korrekt als None, kein falsches Ergebnis). | Backtest soll DST-Tage explizit behandeln (ausschließen oder 23/25-h-Tage normalisieren) + Randnotiz in docs/ENGINE.md, statt stillem `None`. |

---

## Quick Wins (jeweils ≤ ½ Tag, ohne Architektur-Abhängigkeit)

> Status: **14 von 14 umgesetzt** (Version 0.10.0). **B6/H1**
> (Umweg: Server als einzige Quelle von Strecke und Schwellen) ist jetzt drin:
> Server liefert `detour_km_est`, `dist_mode`, `verdict`/`worth_it` + Schwellen,
> GUI rechnet nicht selbst (kein `haversineKm*CIRCUITY`, keine 1,50/0,50-Konstanten).

1. ✅ **A3** Storno-Flag für Fills (`DELETE /fills/{id}` → `voided`, Audit-Zeile) + Button im Wallet.
2. ✅ **A6** CSV-Export `GET /api/v1/fills.csv` + Download-Link im System-Tab.
3. ✅ **B1** Eine Zeile Backup-Skript für `runtime/` + Restore-Absatz in BETRIEB.md.
4. ✅ **B4** `alarms[]`-Array in `/health` (nur Aggregation vorhandener Prüfungen) + roter Punkt im Header.
5. ✅ **B6/H1** Umweg: Server liefert `detour_km_est` **und** `verdict`/Schwellen; GUI-Eigenrechnung raus (0.10.0).
6. ✅ **B9** Version/Commit in `/health` + Footer-Anzeige.
7. ✅ **C1** Einrichtungs-Checkliste als Daten-getriebene Karte (Status kommt aus vorhandenen Endpunkten).
8. ✅ **C5** Zwei schnelle A11y-Fixes: Ampel-Chip mit Symbol (▲/▼/●) statt nur Farbe, Slider-`aria-valuetext` in €.
9. ✅ **D2** Eine Playwright-Spec „decide → intent → fill → due“ mit Mocks — schützt alle V3-Fixes.
10. ✅ **A7** Fortschritts-Kachel „M7: n/100 Settlements, Brier x (Ziel < 0,25)“ — Daten liegen in `/stats/summary` schon vor.
11. ✅ **E2** Komma-Eingabe: `inputMode="decimal"` + `,`→`.`-Normalisierung im Beleg-Dialog.
12. ✅ **G1** `cache.log`-Cap (20 Zeilen Code) — stoppt unbegrenztes Wachstum auf dem RP2.
13. ✅ **F1** Tab-Label „Statistik“ → „Werkstatt“ (inkl. Sekundär-Texte) — eine Zeile Code + Terminologie-Commit.
14. ✅ **C10** Tages-Zeilen + Fazit-Satz unter der Heatmap — reines Frontend, die 7×24-Matrix liegt bereits vor.

---

## Quick Wins 0.11 – Kandidaten (jeweils ≤ ½ Tag, ohne Architektur-Abhängigkeit)

> Status: **7 von 7 umgesetzt** (Version 0.11.0). Es waren die kleinen
> Ehrlichkeits-/Bedienbarkeits-Fixes nach 0.10.0 — alle ohne Architektur-Umbau,
> alle testbar. Die Nachfolger stehen unter der Liste.

1. ✅ **B13** Build-Commit im Docker-Image: `tankapp.py nas-up` setzt `TANKAPP_BUILD_COMMIT=$(git rev-parse --short=12 HEAD)` als Build-Arg + Env, `compose.yml` + `Dockerfile` übernehmen es, `/health` liefert `commit` nicht mehr null (0.11).
2. ✅ **E3/E4** Beleg-Eingabe ehrlich: Grenzen (5–100 L / 0,40–5,00 €/L) stehen gemeinsam in `web/src/data.ts::FILL_LIMITS`, geprüft wird vor dem Roundtrip direkt am Feld; „Beleg buchen“ ist ohne gewählte Station deaktiviert + Hinweis „Station wählen“ (0.11). Statt `min`/`max`/`step`-Attributen am Komma-Textfeld (E2) wirken die Grenzen im Code — Attribute ohne Effekt an einem Textfeld wären die größere Lüge.
3. ✅ **E5** `heatmapWeeks` wählbar: Wochen-Select 4/6/12 neben „Heatmap Art“, `setHeatmapWeeks` verdrahtet, Default 6 Wochen, `weeks=` bleibt URL-Param (0.11).
4. ✅ **E6** Slider-Präzision: Verbrauch `step=0.5`, Liter `step=1`, Zeitwert `step=0.5` — jeweils mit Begleit-Zahlenfeld (6,3 L/100 km wählbar), `aria-valuetext` in €/h bleibt (0.11).
5. ✅ **B12** Cheap-Prob ohne Station: `basis=hour` rechnet gegen den Median derselben Stunde (Spalten-Basis), GUI-Default ohne Station, Umschalter + Begründung in `docs/ANALYSE.md`; API-Default `overall` unverändert (0.11).
6. ✅ **G2** Journal-Wachstum rp2: Drop-in `rp2/journald.conf.d/50-tankapp-journal.conf` (`SystemMaxUse=50M`) + `journalctl --vacuum-size=50M` als Wartungsschritt, Anleitung in `docs/RP2.md` (0.11).
7. ✅ **E7** API-Explorer „day (Beispiel)“: erscheint nur bei gewählter Station, sonst grauer, deaktivierter Knopf mit Hinweis „erst Station wählen“ (0.11).

**Kandidaten 0.13 — Ergebnis der Kalibrierung (Befunde gegen den Code geprüft),
umgesetzt in 0.13.0; der Rest der Liste bleibt stehen:**

1. ✅ **A6 (Rest)** Share-URL: `?city=…&fuel=…&station_id=…&liters=…` wird beim
   Start in die Preferences übernommen; zusätzlich setzt der Teilen-Knopf die
   aktuelle Sicht in die Adresszeile und kopiert sie. Seit 0.11 zwingend auch
   für `heatmapWeeks`/`heatmapBasis` — beides ist inzwischen echte Preference,
   ohne Übernahme würde eine geteilte Ansicht falsch wiederhergestellt (0.13).
2. ⚠️→✅ **C5** — der 0.11-Kandidat „zwei CSS-Zeilen“ war **falsch**: Fokus-Ring
   (`:focus-visible`) und `prefers-reduced-motion` standen schon in
   `styles.css`; der echte Rest war, dass `outline-none`-Klassen den Ring an
   genau den Feldern überschrieben, die 0.11 angefasst hat — plus Charts mit
   `aria-describedby`-Textfassung (0.13). Übrig bleiben 44 px/AA/Tastatur.
3. ✅ **F2 (kleinster Schnitt)** Deutsche Primär-Labels für die
   Jargon-Stellen in der Werkstatt: „Wahrscheinlichkeit für günstig“ statt
   „Cheap-Probability P(p ≤ Median)“, „Ampel-Stärke“ statt „AV-Score“,
   „Preis-Abstand“ statt „δ̂ Ranking“, „Prüfzeitraum“ statt „Out-of-Sample“,
   „Ø Mehrkosten“ statt „Ø Regret“; Fachwort und Formel stehen jetzt im
   `title`/Tooltip (0.15).
4. ✅ **C9** Formatierungs-Satz in `data.ts` (€/L drei Nachkommastellen,
   ct/L eine, Uhrzeiten immer Europe/Berlin) plus vitest-Test gegen Mischnutzung:
   `euroPerLiter`, `centPerLiter`, `percentLabel`, `countLabel`, `hourRangeLabel`
   sind gebaut und getestet (0.14), Heatmap **und** alle übrigen Anzeigen
   (Dashboard, LineChart, LabCharts) nutzen sie, `format-convention.test.ts`
   hält neue `toFixed`-Anzeigen auf (0.15). Übrig: ct/L-€/L-Wahl je Panel und
   Uhrzeiten-Check (F3).
5. ✅ **C6 (kleinster Schnitt)** Gemeinsamer Fehler-Zustand pro Panel:
   `components/LoadError.tsx` mit `problem(error_code)`-Klartext, Rohcode und
   `Erneut laden`-Knopf (ein gemeinsamer Refresh-Zähler), verdrahtet in sechs
   Panels, Render-Test daneben (0.15). Übrig: Skeletons, Datenstand-Banner,
   Reichweiten-Zeile.
6. ✅ **D3** Property-Tests für die Umweg-Ökonomie (`K = d·(c/100)·p +
   (d/v)·z`): `web/src/data.property.test.ts` (fast-check, 300 Läufe je
   Eigenschaft, fester Seed) prüft Identität Netto = Brutto − Sprit − Zeit,
   Monotonie in Litern/km/Verbrauch/Geschwindigkeit/Zeitwert, Break-even
   `criticalCtPerL`, Grenzfälle `z = 0`, `d = 0`, `liters→∞`, `v ≤ 0` und die
   `worth_it`-Schwellen inkl. exakter Kanten (0.15). Reine Tests, kein
   Produktcode — schützt die 0.10.0-Umstellung auf Server-only-Strecke.

---

## Erledigt — hier gestrichen, im CHANGELOG nachvollziehbar

IDs bleiben stabil, damit Commits, Tests und Code-Kommentare weiterhin lesbar
sind. Vollständig erledigt und aus den Tabellen oben entfernt:

| Version | Punkte |
|---|---|
| 0.16.0 (12.09.2026) | **B4** (Rest) Alarm-Zustellung im System-Tab sichtbar (Kachel „Alarm-Zustellung · Push aufs Handy“: Badge, Klartextsatz, offene Codes als Chips, „Zuletzt gemeldet“/„Zuletzt Entwarnung“; Texte als reine Funktionen `notifyTone`/`notifyStatusLine`/`notifyLastLine` in `web/src/data.ts` mit `notify.test.ts`; serverseitig nur ein neues Feld `notify.last_sent_at`), **B14** `docs/analysis/` → `data/analysis/` (Default in `app/config.py`, `tankapp.py`, allen `data-tools/`-CLIs, `analysis/*`, `ops/nas/preflight.sh`, RP2-Suchpfaden und der Doku; alter Pfad bleibt gültig, solange nur er existiert, mit Hinweis je Prozess — kein stiller Umzug; `tests/test_analysis_path.py`), **F3** (Rest) Microcopy-Regelwerk `docs/MICROCOPY.md` + Ratchet `microcopy.test.ts` + Zitate vereinheitlicht |
| 0.15.0 (12.09.2026) | **F2** Deutsche Primär-Labels in der Werkstatt („Wahrscheinlichkeit für günstig“, „Ampel-Stärke“, „Preis-Abstand“, „Prüfzeitraum“, „Ø Mehrkosten“, „q-Wert“, „95-%-KI“, „Billigste Stunde“, „Sprungfreie Tage · MASE“, „Drift-Status · CUSUM“, `aria-label` „Rückmeldung nach Fensterende“), Fachwort/Formel jeweils im Tooltip; **D3** Property-Tests Umweg-Ökonomie (fast-check gegen `detourEconomics`/`detourVerdict` in `web/src/data.ts`: Identität Netto = Brutto − Sprit − Zeit, Monotonie in Litern/km/Verbrauch/Geschwindigkeit/Zeitwert, Break-even `criticalCtPerL` exakt, Grenzfälle `z=0`/`d=0`/`liters→∞`/`v≤0`, `worth_it`-Schwellen inkl. exakter Kanten), **B4** ntfy-Zustellung für `severity: error` (`app/notify.py`, ein Webhook `TANKAPP_NTFY_URL`, Zustandswechsel statt Dauerschleife, `/health` → `notify`) — GUI-Anzeige bleibt offen, **C6** (Teil) gemeinsamer Fehler-Zustand `LoadError` in sechs Panels, **C9** (Rest) alle Anzeigen auf den Formatter-Satz umgestellt + `format-convention.test.ts` als Ratchet, **F3** (Teil) Tageszahlen ausgeschrieben, **D1** (Teil) geteilte UI-Bausteine (`components/ui.tsx`: `panel`/`Empty`/`Badge`/`Metric` + Render-Test) |
| 0.13.0 (12.09.2026) | **B2** Schema-Version + Migration des Feedback-Stores (Versionsfeld, Migration je Sprung, Test „alter 0.10-Store → neuer Code“, Doku in BETRIEB.md), **B5** Schreib-Härtung: `tanked_at`-Plausibilitätsfenster (sonst 1970/2100 im Ledger), Freitext-Caps für `station_name`/`source`, getrenntes Schreib-Budget (20/min je Client, nur Ledger-Endpunkte — GET bleibt frei), **A6** Share-URL beim Start lesen + Teilen-Knopf, **B7** (Teil) gzip für JSON + `max-age=900` für `heatmap`/`last_forecasts`, **C5** (Teil) Fokus-Ring ohne `outline-none`-Überschreibung + Charts `aria-describedby`, **D1** (Teil) `PrecisionSlider`/`HeatmapGrid`/`ApiExplorer` nach `components/` ausgelagert |
| 0.11.0 (12.09.2026) | **B12** Heatmap-Basis umschaltbar (`basis=hour` = Median derselben Stunde; API-Default `overall`), **B13** Build-Commit im Image (Doku nachgezogen), **E3** Beleg-Grenzen vor dem Roundtrip, **E4** Buchung nur mit gewählter Station, **E5** Wochen-Select 4/6/12, **E6** Slider 0,5/1 L/0,5 + Begleitfeld, **E7** API-Explorer „day“ nur mit Station, **G2** RP2-Journal-Cap (Drop-in + `--vacuum-size`) |
| 0.10.0 (12.09.2026) | **A3** Beleg-Storno, **A6** CSV-Export, **A7** M7-Fortschritts-Kachel, **B1** `runtime/`-Backup, **B4** Alarm-Block + GUI-Punkt, **B6/H1** Umweg server-only (`detour_km_est`, `dist_mode`, `verdict`/`worth_it` + Schwellen `elsewhere_net_eur`/`elsewhere_borderline_eur` M7-tunebar; GUI ohne `haversineKm*CIRCUITY`/1,50-0,50-Konstanten), **B9** Version/Commit + CHANGELOG, **C1** Einrichtungs-Checkliste, **C5** (zwei A11y-Fixes), **C10** Heatmap-Tages-Zusammenfassung, **D2** e2e-Spec decide→intent→fill→due, **E2** Komma-Eingabe, **F1** Tab „Werkstatt“, **G1** `cache.log`-Cap, **G3** Datenverlust-Fenster benannt (docs/ARCHITEKTUR.md), Doku-Umbau `docs/` mit Index + Archiv (`docs/archiv/`) + Link-Test |

Teilweise erledigt und mit reduziertem Scope oben stehen geblieben: **B7**
(Overview-Endpunkt + Poll-Bündelung offen), **C5** (44 px, AA, Tastatur offen),
**C6** (Rest: Skeletons, Datenstand-Banner, Reichweiten-Zeile), **C9** (Rest:
ct/L-€/L-Wahl je Panel), **D1** (Views noch in einer Datei), **F3** (Rest:
Regelwerk steht, Anwendung auf Footer/Panels offen).

## Bewusst NICHT in dieser Liste

- **Login, Benutzerkonten, Rollen, Mandanten, OAuth/SSO** — LAN-only per Vorgabe.
- **DSGVO-Löschkonzept, Daten-Portabilität für Fremdnutzer, Consent-Management** — keine Fremddaten.
- **i18n über Deutsch hinaus** — Zielgruppe ist ein deutschsprachiger Haushalt.
- **Öffentliche Skalierung** (CDN, Multi-Instanz, Loadbalancer) — ein NAS, ein Haushalt.

## Reihenfolge-Empfehlung

1. **D1 fertigstellen, bevor ein größeres C-Feature anfängt** (C2/C4/C6) —
   die Bausteine sind seit 0.13.0 in `components/`; der Views-Schnitt
   (`views/Daily.tsx` …) ist der, der Merge- und Review-Kosten wirklich senkt.
2. **B7-Rest separat entscheiden** (`/api/v1/overview` + Poll-Bündelung) —
   der messbare Teil (gzip, Cache-Schichten) ist mit 0.13.0 drin; der Rest
   ist Architektur-Aufwand und lohnt erst mit einer Messung der echten Last.
3. **Kein P0 mehr offen** — der Heatmap-P0 vom 12.09. ist mit 0.14.0
   geschlossen, B2 (Schema-Version) seit 0.13.0;
   der nächste Store-Feldsprung braucht nur eine Migrationsfunktion nach
   `app/feedback.py::_STORE_MIGRATIONS` und ein Anheben von
   `FEEDBACK_SCHEMA_VERSION`.
4. **D-Items erst nach Live-Daten** (M7-Termin, Rabatte, Engine-Ausbau) — sie
   stehen begründet in [docs/LUECKEN.md](docs/LUECKEN.md#bewusst-offen-backlog-mit-grund).
