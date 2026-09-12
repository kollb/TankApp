# TankApp — ToDo (Stand 12.09.2026, App-Version 0.10.2)

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
| A2 | P1 | **Tankstand / Restreichweite als Eingabe für F3** | Konzept-F3 („Tank bei ¼, kann ich warten?") hat keinen Tankstand-Input. Ziel: Fuellstand-Angabe (≈ Füllstand oder Rest-km), App sagt ehrlich „Warten riskant, Reserve reicht ~40 km" statt nur „bestes Fenster morgen". |
| A4 | P1 | **Jahres-/Monatsbilanz in der Werkstatt** | Konzept §12 P2: „Wallet-Ledger im Alltag, **Jahresbilanz in der Werkstatt**". Heute nur Summen-Kacheln im Alltag. Ziel: Verlaufsliste der Fills, Monats-/Jahressumme, Ø €/Tankung, Vergleich gegen „immer sofort getankt"-Baseline (Regret-Ratio ist vorhanden, nur nicht persönlich aufbereitet). |
| A6 | P2 | **Share-URL für die eigene Sicht** *(CSV-Export ist fertig, 0.10.0)* | `GET /api/v1/fills.csv` + Download im System-Tab sind da. Offen: URL-Parameter (`?city=…&fuel=…&station_id=…&liters=…`), die die GUI beim Öffnen übernimmt — zum Bookmarken und im Haushalt weitergeben. Kein JSON-Export der Preisverläufe nötig (liest ohnehin niemand). |
| A8 | D | **Markenrabatte/Karten** (`--brand-rebate`) | 2–4 ct können das F2-Ranking umdrehen. Erst sinnvoll, sobald echte Rabattdaten vorliegen; bis dahin soll die GUI im Ranking anzeigen „rechnet ohne Rabattprogramme" (Transparenz-Hinweis). |
| A9 | D | **w(h)-Rückkopplung anschließen** | Persönliches Zeitprofil (`wallet.wh_hours`) wird berechnet, fließt aber nicht in „billigste Stunde"/F3 ein (Konzept §5.5). Ab ≥8 Füllungen aktivieren, vorher Default — mit UI-Hinweis ab wann personalisiert. |
| A10 | D | **M3-Zweitmodell/Ensemble + Echt-Daten-Abnahme** | Hampel-Filter, Feiertags-/Sprung-Features, Mehrtage- und 21-Tage-Backtest sowie Rolling-PICP sind seit PR #69 implementiert und testgedeckt. Offen bleiben das unabhängige Zweitmodell mit inverse-MASE-Ensemble und die Abnahme aller M3-Kriterien auf echten Live-Daten. |
| A11 | D | **Gemeinsame Bootstrap-Ziehung für `p_lohnt`** | Konzept §4.2: Marktgleichlauf darf nicht wegkorreliert werden. Braucht stationsübergreifenden Resampling-Schritt (gleicher Tagesblock je Ziehung) — eigener Arbeitsschritt, in LUECKEN begründet offen. |
| A12 | P2 | **Station-Lebenszyklus & Zustandsehrlichkeit** | „führt E10 nicht" vs. „temporär geschlossen" vs. „keine Daten seit n Tagen" wird in der GUI nicht unterschieden. Tote Stationen (`no prices` > 7 Kalendertage) sollen automatisch aus Ranking/Polling-Set fallen (konfigurierbar), nicht dauerhaft Kontingent kosten. |
| A13 | P2 | **Preis-Zwillinge: automatische Warnung** | Identische Preisverläufe zweier Stationen (Doppel-Source/Franchise) werden nur manuell per `compare-stations` gefunden. Ziel: Warnung im Selektions-Artefakt + System-Tab. |

---

## B. Technisch (Backend, Datenhaltung, Betrieb, Qualität)

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| B2 | P0 | **Schema-Version & Migration des Feedback-Stores** | `store.json` hat kein `schema_version`; die nächste Feldänderung bricht alte Stores still. Ziel: Versionsfeld + Migrations-Funktionen je Versionssprung, Test „alter Store → neue Version". |
| B4 | P2 | **Alarm-Zustellung** *(Aggregation ist fertig, 0.10.0)* | `alarms[]` in `/api/v1/health` + roter/gelber Punkt im Header sind da ([docs/BETRIEB.md](docs/BETRIEB.md#system-alarme-lesen)). Offen: jemand **schaut** nur hin, wenn die GUI offen ist. Ziel: optionaler ntfy-Versand bei `severity: error` (ein Webhook, kein Auth-Ausbau), konfigurierbar per `TANKAPP_NTFY_URL`, aus Datenschutzgründen ohne Preis-/Stationsdetails im Text. |
| B5 | P1 | **POST-/Schreib-Endpunkte gegen Flut härten** | Rate-Limit deckt GET gut ab, aber `POST /fills`/`/intent` können von einem defekten Client das Ledger fluten. Zusätzlich Plausibilitätsgrenzen serverseitig: `tanked_at` nur plausibles Fenster (nicht 1970/2100), Liter/Preis Obergrenzen, Stringlängen. Kein Auth — einfache IP-/Minuten-Drossel reicht. |
| B7 | P1 | **HTTP-Effizienz: gzip, getrenntes Caching, Poll-Bündelung** | `no-store` auf allem, keine Kompression, GUI pollt 8+ Ressourcen (~14.700 Req/Tag > 10.000er Anonym-Budget, Zählerstand aus V2-Analyse vor den B5-Fixes — jetzt mit LRU gemildert, aber strukturell ungelöst). Ziel: `Content-Encoding: gzip`; Hash-Assets `immutable`; semi-statische Endpunkte (heatmap, last_forecasts) 15–120 min cachebar; ein Aggregat-Endpunkt `/api/v1/overview` für den Alltag statt Einzelpolls. |
| B8 | P2 | **Webhook-Retry Pi → NAS** | `POST /jobs/trigger` ist Fire-and-Forget: NAS kurz offline → Watermark verloren, läuft nur noch intervallbasiert, ohne Hinweis. Ziel: Retry mit Backoff + Quittierung, Status im Collector-Status sichtbar. |
| B10 | P2 | **Service-Worker: Versionierung & Update-Anzeige** | Cache-Namen sind fix `…-v1`; ein GUI-Update signalisiert dem Nutzer nichts, und die Offline-Queue aus dem Konzept (§5.4, IndexedDB) fehlt. Ziel: SW-Version im Build bumsen, „Neue Version — neu laden?"-Banner, Offline-Queue für Fill/Intent mit sichtbarem „wird gesendet, sobald online"-Zustand. |
| B11 | P2 | **Ressourcen-Abgleich Modell-Worker** | `TANKAPP_MODEL_WORKERS` bis 8 Prozesse × pandas vs. `shm_size: 256m` in [ops/nas/app/compose.yml](ops/nas/app/compose.yml) — nicht getestet; bei NAS-HDD werden außerdem File-Locks (`locked_store`, 50×0,05 s) knapp. Ziel: Lauf mit Max-Workern auf Zielhardware + Doku-Werte, Lock-Timeout erhöhen bzw. klare 503-Meldung. |
| B13 | P2 | **Build-Commit fehlt im Docker-Image:** `/health` liefert `commit: null`, weil das Image kein `.git` enthält — B9 zeigt also auf dem NAS nur die Version, nicht den Stand. | `tankapp.py nas-up` setzt `TANKAPP_BUILD_COMMIT=$(git rev-parse --short=12 HEAD)` als Build-Arg bzw. Compose-Environment (`app/version.py` liest die Variable bereits). Test: `/health` → `commit` nicht null nach `nas-up`. |
| B14 | P2 | **`docs/analysis/` ist ein Datenverzeichnis im Doku-Ordner:** gitignored, enthält das aktive `polling.json`, Berichte und Abbildungen (`app/config.py`, `data-tools/*`, `analysis/*` lesen/schreiben dorthin) — nach dem Doku-Umbau die letzte „wo liegt was?“-Unklarheit. | Umzug nach `data/analysis/` (privat, gitignored wie der Rest von `data/`): Default in `app/config.py`, CLI-Defaults in `data-tools/`, Doku. Übergangsweise beide Pfade akzeptieren und beim Fund des alten Pfads einen klaren Hinweis loggen; kein stiller Umzug privater Daten. |
| B12 | P2 | **Cheap-Prob ohne Station: Basis überstrahlt den Wochentag** | `app/heatmap.py` vergleicht bei `kind=probability` **ohne** `station_id` jede Zelle gegen den Gesamtmedian **aller** Zellen des Zeitraums. Weil der Tagesgang (nachts/abends billig, Mittag teuer) viel größer ist als der Wochentags-Effekt, werden Abendzellen fast immer grün und Mittagszellen fast immer rot — egal welcher Wochentag. Die Frage „an welchem *Wochentag* ist es billig?“ ist aus dieser Ansicht so nicht ablesbar (mit `station_id` funktioniert es, weil dort Station gegen Stadt im selben Slot verglichen wird). Ziel: ohne Station optional gegen den Median **derselben Stunde** (Spalten-Basis) rechnen, damit der Tagesgang herausgerechnet ist und die Zeilen (Wochentage) fair vergleichbar bleiben; Umschalter/Modus + kurze Begründung in [docs/ANALYSE.md](docs/ANALYSE.md). |

---

## C. GUI / UX

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| C2 | P1 | **Stamm-Stationen pinnen + Suche/Filter/Sortierung** | „Meine Stationen" lebt nur in der Werkstatt; im Alltag will der Nutzer seine 2–3 Stammstationen oben sehen. Liste bei 20+ Stationen (Frankfurt-Radius) ohne Suche/Markenfilter/Sortierung (Preis, Distanz, Netto-€). Lokal speicherbar, kein Account nötig. |
| C3 | P2 | **Karten-/Umgebungsansicht für F2** | „Hier oder woanders?" als Karte mit Netto-€-Pins. OSM-Tiles brauchen Internet (im LAN okay, wenn NAS/Handy online); Alternativen: statische Tile-Region oder reduzierte Luftlinien-Übersicht. |
| C4 | P2 | **Einstellungen-Tab zentral** | Verbrauch, Zeitwert (manuell/auto), Liter-Default, Kraftstoff, Stadt liegen verteilt in Panels. Ziel: ein Tab „Einstellungen": alle Defaults inkl. aktiver Schwellen-Tabelle (read-only aus `/api/v1/stats/summary → thresholds`), Dark/Light-Umschaltung (Fallback-GUI kann dunkel, NAS-GUI nur dunkles Slate). |
| C5 | P2 | **Barrierefreiheit-Runde, Rest** *(zwei Fixes sind drin, 0.10.0)* | Erledigt: Ampel-Chip mit Symbol (▲/▼/●/→), Slider mit `aria-valuetext`. Offen: Charts `role="img"` **mit** `aria-describedby` (heute nur `aria-label`), sichtbarer Fokus-Ring durchgängig, komplette Bedienung per Tastatur (Beleg buchen ohne Maus), `prefers-reduced-motion`, Touch-Targets ≥ 44 px, Kontraste AA prüfen. |
| C6 | P2 | **Einheitliche Leer-/Lade-/Fehler-Zustände** | Panels unterscheiden sich (Spinner vs. Text vs. nichts). Ziel: Skeletons, `Retry`-Button mit `error_code`-Text (Problem-Mapping existiert in `data.ts`), „Datenstand älter als X"-Banner konsistent, Anzeige „Reichweite der Daten" (z. B. Heatmap: 6 Wochen) je Panel. |
| C7 | P2 | **Hilfe/Glossar-Layer** | δ̂, MASE, PICP, Brier, ε, Regret — Werkstatt-Begriffe ohne Erklärung in der App. Ziel: i-Tooltips + eine kurze „Was heißt das?"-Seite (kann auf docs/ANALYSE.md-Anker verweisen), Begriffe konsistent zur Doku. |
| C8 | P2 | **Mobile-Feinschliff & PWA** | Sticky-Aktions-Chip im Alltag („Jetzt tanken / Warten bis …" beim Scrollen sichtbar), Install-/„Zum Homescreen"-Hinweis (manifest ist da, Prompt fehlt), Landscape-Layout der Tageskurve prüfen, Pull-to-Refresh dort unterdrücken, wo er mit Karten-/Slider-Gesten kollidiert. |
| C9 | P2 | **Formatierungs-Konventionen** | Durchgängig de-DE: ct/L vs €/L nicht mischen (beides vorkommend), einheitliche Rundung (3 Nachkommastellen €/L, 1 Nachkommastelle ct), Uhrzeiten „18–20 Uhr" überall in Europe/Berlin. Kleiner ESLint-/Test-geschützter Formatter-Satz in `data.ts`. |

---

## D. Code-Wartbarkeit (Voraussetzung für C-Features)

| # | Prio | Fehlt | Details |
|---|---|---|---|
| D1 | P1 | **`Dashboard.tsx` zerlegen (3 415 Zeilen in einer Datei)** | Tab-weise Module (`views/Daily.tsx`, `views/Statistics.tsx`, `views/System.tsx`) + geteilte UI-Bausteine (Panel, Metric, Badge, EmptyState). Sonst kollidiert jede C-Arbeit mit Merge- und Review-Kosten. |
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
| E3 | P1 | **GUI-Validierung deckt Server-Regeln nicht ab:** `customLiters`/`customPrice` haben **keine min/max-Attribute**; GUI prüft nur `> 0`, Server verlangt 5–100 L / 0,40–5,00 €/L → Eingaben wie 101 L oder 9,99 € scheitern erst nach Server-Roundtrip mit Fachfehler. | `min`/`max`/`step` am Input + gleiche Grenzen clientseitig prüfen, Fehlermeldung direkt am Feld. |
| E4 | P1 | **Beleg ohne Station wählbar:** Bei nicht ausgewählter Station sendet `handleCustomFill` `station_id: "custom"` → Server lehnt mit `unknown_station` ab. Der Nutzer kann den Fehler nicht selbst beheben. | Stations-Auswahl im Beleg-Dialog oder Button deaktivieren + Hinweis „Station wählen". |
| E5 | P1 | **`heatmapWeeks` ohne Eingabeweg:** GUI sendet `weeks=` an `/api/v1/heatmap`, die Preference existiert, aber `setHeatmapWeeks` hat 0 Aufrufe → Zeitraum ist fest verdrahtet, kein Umschalten möglich. | Wochen-Select (4/6/12) neben „Heatmap Art" oder Parameter aufräumen. |
| E6 | P2 | **Slider ohne Präzision/Direkteingabe:** Verbrauch `step=1` (6,3 L/100 unwählbar — beeinflusst jede Umweg-Rechnung), Liter `step=5`, Zeitwert `step=1`; kein Begleit-Zahlenfeld, kein `aria-valuetext` in Währung. | `step=0.5` beim Verbrauch, optional number-Begleitfeld, `aria-valuetext` (zählt zu C5). |
| E7 | P2 | **API-Explorer „day (Beispiel)":** `identity` leer ⇒ Aufruf mit leerem `station_id` → nur Fehleranzeige. | Label dynamisch: Beispiel nur anbieten, wenn eine Station gewählt ist; sonst grau + Hinweis. |

## F. App-Texte & UX-Sprache (Prüfstrang 2)

| # | Prio | Befund | ToDo |
|---|---|---|---|
| F2 | P1 | **Anglizismen/Fachjargon in Labels:** „Cheap-Probability P(p ≤ Median)", „AV-Score", „δ̂ Ranking", „Out-of-Sample", „Regret", „Badge" intern. | Deutsche Kurzformen als Primärtext („Wahrscheinlichkeit für günstig", „Ampel-Stärke"), Formel/Fachwort ins Tooltip (→ C7 Glossar). |
| F3 | P2 | **Typografie uneinheitlich:** Anführungszeichen gemischt („warten“ vs. gerade '"'), „Brier-Score 30d" statt „30 Tage"; ct/L und €/L wechseln ohne Regel; Footer/Microcopy teils englische Hook-Zeilen („Nachvollziehen statt blind vertrauen." ✓ gut) vs. Fachlabels. | Microcopy-Regelwerk (eine Seite, in docs/README verlinkt): Einheiten, Zitate, Zahlenformate, Tonfall „ehrlich, knapp, handlungsleitend". |
| F4 | P2 | **Intent-Leiste zeigt immer alle 4 CTAs** („Ich warte / Navigieren / Jetzt tanken / Verwerfen") — bei Aktion `refuel_now` ist „Ich warte" als gleichrangiger CTA irritierend; bei `wait` ist „Jetzt tanken" irritierend. | Empfohlene Aktion als primären Button, kompatible Intents sekundär, widersprechende Intent mit Erklär-Tooltip (Logik ändert nichts, nur Sichtbarkeit/Gewichtung). |
| F5 | P2 | **Sonst sauber geprüft:** Fehlertexte in `web/src/data.ts` (`messages`) durchgehend sachlich-deutsch ohne erfundene Inhalte ✓; Fallback-GUI-Texte konsistent ✓; keine Demo-/Lorem-Reste ✓; Ladezustände einheitlich formuliert („… wird geladen/berechnet"). | Kein Task — als Referenz in das F3-Regelwerk übernehmen. |

## G. Storage-Management: rp2/Pi & NAS (Prüfstrang 2)

| # | Prio | Befund | ToDo |
|---|---|---|---|
| G2 | P2 | **Journal-Wachstum der rp2-Dienste nicht begrenzt/dokumentiert:** `fallback_gui` + `cache_forecasts` loggen nach journald; auf der SD ohne Caps wächst das Journal monatelang. | In ANLEITUNG: `SystemMaxUse=50M` für die Units oder `journalctl --vacuum-size` als Wartungsschritt; optional Drop-in-Beispiel beilegen. |
| G4 | P2 | **`/tmp/tankapp_cache` überlebt keinen Reboot** → Fallback-GUI zeigt nach Pi-Neustart bis zum ersten erfolgreichen Fetch „keine Prognose". Ehrlich, aber unerwartet. | Wie geht man damit um? |

## H. Mathematik (Prüfstrang 2: „muss mathematisch was getan werden?")

Kurzantwort: **kein Rechenfehler gefunden** — Formeln (Umweg-`K`, Netto-€, `p_besser`/`p_lohnt` aus Draws, Settlement gegen beobachtete Minima, PAVA/12-Uhr ist bekannt sauber). Die offenen mathematischen Punkte sind **Konsistenz und dokumentierte Ausbauten**, keine Bugs:

| # | Prio | Befund | ToDo |
|---|---|---|---|
| H3 | D | **M7-Tuning-Regler ohne Oszillationsschutz dokumentiert:** Schwellen-Vorschlag begrenzt Schritte, aber Zusammenspiel von Schrittweite, Mindest-Abstand zwischen Anpassungen und n-Basis (n ≥ 25) ist nicht als Regel festgeschrieben — bei kleinen Stichproben können Schwellen pendeln. | Kurze Methodik-Notiz + Hysterese (nur ändern, wenn \|Δ\| > Rauschband) in `app/thresholds.py` + Test „stabile Schwellen bei Rauschdaten". |
| H4 | D | **Weiterhin offen (bereits gelistet, hier qualifiziert):** M3-Zweitmodell/Ensemble, gemeinsame Bootstrap-Ziehung über Stationen (§4.2) und w(h)-Rückkopplung ab ≥8 Füllungen. | Bleiben A9–A11 mit Datenbedarf; Reihenfolge nach M7-Fortschritt (A7). |
| H5 | P2 | **DST-Kante `seasonal_scale`:** bei Zeitumstellung kann der Vortages-Anker `NaT` liefern → MASE `None` an ~2 Tagen/Jahr (korrekt als None, kein falsches Ergebnis). | Backtest soll DST-Tage explizit behandeln (ausschließen oder 23/25-h-Tage normalisieren) + Randnotiz in docs/ENGINE.md, statt stillem `None`. |

---

## Quick Wins (jeweils ≤ ½ Tag, ohne Architektur-Abhängigkeit)

> Status: **14 von 14 umgesetzt** (Version 0.10.1 → 0.10.2). **B6/H1**
> (Umweg: Server als einzige Quelle von Strecke und Schwellen) ist jetzt drin:
> Server liefert `detour_km_est`, `dist_mode`, `verdict`/`worth_it` + Schwellen,
> GUI rechnet nicht selbst (kein `haversineKm*CIRCUITY`, keine 1,50/0,50-Konstanten).

1. ✅ **A3** Storno-Flag für Fills (`DELETE /fills/{id}` → `voided`, Audit-Zeile) + Button im Wallet.
2. ✅ **A6** CSV-Export `GET /api/v1/fills.csv` + Download-Link im System-Tab.
3. ✅ **B1** Eine Zeile Backup-Skript für `runtime/` + Restore-Absatz in BETRIEB.md.
4. ✅ **B4** `alarms[]`-Array in `/health` (nur Aggregation vorhandener Prüfungen) + roter Punkt im Header.
5. ✅ **B6/H1** Umweg: Server liefert `detour_km_est` **und** `verdict`/Schwellen; GUI-Eigenrechnung raus (0.10.2).
6. ✅ **B9** Version/Commit in `/health` + Footer-Anzeige.
7. ✅ **C1** Einrichtungs-Checkliste als Daten-getriebene Karte (Status kommt aus vorhandenen Endpunkten).
8. ✅ **C5** Zwei schnelle A11y-Fixes: Ampel-Chip mit Symbol (▲/▼/●) statt nur Farbe, Slider-`aria-valuetext` in €.
9. ✅ **D2** Eine Playwright-Spec „decide → intent → fill → due" mit Mocks — schützt alle V3-Fixes.
10. ✅ **A7** Fortschritts-Kachel „M7: n/100 Settlements, Brier x (Ziel < 0,25)" — Daten liegen in `/stats/summary` schon vor.
11. ✅ **E2** Komma-Eingabe: `inputMode="decimal"` + `,`→`.`-Normalisierung im Beleg-Dialog.
12. ✅ **G1** `cache.log`-Cap (20 Zeilen Code) — stoppt unbegrenztes Wachstum auf dem RP2.
13. ✅ **F1** Tab-Label „Statistik" → „Werkstatt" (inkl. Sekundär-Texte) — eine Zeile Code + Terminologie-Commit.
14. ✅ **C10** Tages-Zeilen + Fazit-Satz unter der Heatmap — reines Frontend, die 7×24-Matrix liegt bereits vor.

---

## Erledigt — hier gestrichen, im CHANGELOG nachvollziehbar

IDs bleiben stabil, damit Commits, Tests und Code-Kommentare weiterhin lesbar
sind. Vollständig erledigt und aus den Tabellen oben entfernt:

| Version | Punkte |
|---|---|
| 0.10.0 (11.09.2026) | **A3** Beleg-Storno, **A6** CSV-Export, **A7** M7-Fortschritts-Kachel, **B1** `runtime/`-Backup, **B4** Alarm-Block + GUI-Punkt, **B9** Version/Commit + CHANGELOG, **C1** Einrichtungs-Checkliste, **C5** (zwei A11y-Fixes), **C10** Heatmap-Tages-Zusammenfassung, **D2** e2e-Spec decide→intent→fill→due, **E2** Komma-Eingabe, **F1** Tab „Werkstatt“, **G1** `cache.log`-Cap, **G3** Datenverlust-Fenster benannt (docs/ARCHITEKTUR.md) |
| 0.10.1 (12.09.2026) | Doku-Umbau: ein Ordner `docs/` mit Index, Historisches in `docs/archiv/`, Modul-READMEs eingezogen, Dokumente auf Stand 0.10.x gebracht, Link-Test auf alle Dokumente erweitert |
| 0.10.2 (12.09.2026) | **B6/H1** Umweg: Server liefert `detour_km_est`, `dist_mode`, `verdict`/`worth_it` + Schwellen (`thresholds.active.elsewhere_net_eur`/`elsewhere_borderline_eur` M7-tunebar); GUI zeigt ausschließlich Server-Werte, `data.ts`-Konstanten und `haversineKm*CIRCUITY`-Eigenrechnung entfernt |

Teilweise erledigt und mit reduziertem Scope oben stehen geblieben: **A6**
(Share-URL offen), **B4** (ntfy-Zustellung offen), **C5** (Rest der
A11y-Runde offen).

## Bewusst NICHT in dieser Liste

- **Login, Benutzerkonten, Rollen, Mandanten, OAuth/SSO** — LAN-only per Vorgabe.
- **DSGVO-Löschkonzept, Daten-Portabilität für Fremdnutzer, Consent-Management** — keine Fremddaten.
- **i18n über Deutsch hinaus** — Zielgruppe ist ein deutschsprachiger Haushalt.
- **Öffentliche Skalierung** (CDN, Multi-Instanz, Loadbalancer) — ein NAS, ein Haushalt.

## Reihenfolge-Empfehlung

1. **B2 (Schema-Version + Migration des Feedback-Stores)** — letzter offener
   P0-Punkt: schützt die persönliche Bilanz, bevor echte Daten anwachsen.
   Storno (A3), Backup (B1) und Komma-Eingabe (E2) sind seit 0.10.0 drin.
2. **B7** (gzip, getrenntes Caching, Poll-Bündelung → API-Last unter das
   Anonym-Budget) — seit **B6/H1** (0.10.2) ist die Umweg-Ökonomie
   server-einheitlich (`detour_km_est` + `verdict`/Schwellen vom Server).
3. **B5** (Schreib-Endpunkte gegen Flut härten) und **B12** (Cheap-Prob-Basis
   ohne Station) — beide klein, beide ehrlichkeitsrelevant.
4. **D1 direkt vor dem ersten größeren C-Feature** (`Dashboard.tsx` zerlegen) —
   sonst verdoppelt sich der Aufwand.
5. **D-Items erst nach Live-Daten** (M7-Termin, Rabatte, Engine-Ausbau) — sie
   stehen begründet in [docs/LUECKEN.md](docs/LUECKEN.md#bewusst-offen-backlog-mit-grund).
