# TankApp — ToDo (Stand 17.09.2026, App-Version 0.49.5)

> **Rahmenbedingung:** Die App läuft ausschließlich im eigenen LAN (Pi ↔ NAS ↔
> Browser). **Usermanagement, Login und Auth sind explizit nicht nötig** und
> werden in dieser Liste bewusst *nicht* aufgeführt. Rate-Limiting und
> Input-Validierung bleiben trotzdem drin — sie schützen vor Fehlbedienung,
> Doppelgeräten im Haushalt und defekten Clients, nicht vor Angreifern.
>
> **Aufbau:** oben noch offen · Mitte erledigt · unten Messwerte, Bewusst-nicht,
> Reihenfolge.
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
> in der Mitte** — sie sind im [CHANGELOG](CHANGELOG.md) und in
> [docs/LUECKEN.md](docs/LUECKEN.md#umgesetzt-seit-der-prüfung-am-10092026)
> nachvollziehbar; die IDs (A3, B4, …) bleiben dort stabil.

---

## A. Fachlich (Produkt & Domäne)

*Keine offenen Punkte.* A9 (w(h)-Rückkopplung), A10 (Zweitmodell/Ensemble),
A11 (gemeinsame Bootstrap-Ziehung), A12 (Lebenszyklus) und A13
(Preis-Zwillinge) sind abgenommen — die vollständigen Nachweise stehen in der
Erledigt-Tabelle unten und im [CHANGELOG](CHANGELOG.md).

---

## B. Technisch (Backend, Datenhaltung, Betrieb, Qualität)

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| B25 | C | **Zweites automatisches Backup-Ziel (O33-Rest)** | Seit 0.47.0 meldet die App die Backup-Alterung (`backup_stale`, 36 h) und `ops/nas/backup.sh` behält 14 Tages- plus 6 Monatsstände — aber das Ziel liegt auf demselben Gerät wie die Daten: Ein NAS-Ausfall nimmt Daten **und** Sicherung mit. Die unersetzbaren Bestände (Tank-Bilanz, Polling-Set mit den Anker-Koordinaten) haben keine zweite automatische Kopie. DoD: rsync/Cron des Backup-Ordners auf ein zweites Gerät oder Datenträger, plus ein Alarm, wenn **auch** die Zweitkopie altert (Muster aus `app/backup.py`). Entscheidung und Zwischenstand: [BETRIEB.md](docs/BETRIEB.md#nas-laufzeitdaten-runtime-backup). |
| B22 | D | **Zahlen-ändernde Hebel: `bootstrap_samples` und Nacht-Raster** | Entscheidung, kein Gratishebel. 2000→500 Ziehungen halbiert die Backtest-Zeit, verschiebt aber Kennzahlen (MASE/PICP/MPIW/MAE). Zweiter Hebel: `predict(hours=72/168)` rechnet das volle 5-Minuten-Raster inkl. Nacht, obwohl der Collector nur 06–24 Uhr pollt. Ändert `points_3d`/`points_7d` — erst entscheiden, ob die GUI die Nachtstunden braucht. Nach B15–B17 vermutlich überflüssig; ausdrücklich **nicht** als Laufzeit-Hebel einplanen. |

---

## C. GUI / UX

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| C12 | D | **Desktop: zweispaltiger Inhalt je Bereich** | U3 (0.41.0) hat das Geräte-Raster gebracht (Bottom-Nav mobil, Seitenleiste desktop), der Inhalt bleibt aber einspaltig; [UI-NEUENTWURF](docs/UI-NEUENTWURF.md) §13 sieht auf großen Viewports zwei Spalten vor (Hauptinhalt + Nebeninformationen). Sobald angefasst: je Bereich die zweite Spalte, geprüft ab ~1280 px. |

C1–C11 sind geschlossen, der UX-Befund U1–U8 ist in **0.41.0** umgesetzt
(Erledigt-Tabelle unten); das Protokoll liegt als
[archiv/GUI-UX-BEFUND.md](docs/archiv/GUI-UX-BEFUND.md) mit Erledigt-Vermerk.
Der Text-Befund
[docs/TEXT-BEFUND.md](docs/TEXT-BEFUND.md) (T1–T13) war die Vorlage für 0.39.0.
C12 ist der ehrliche Rest aus U3: nicht Teil der U-DoDs, die dort messbar
waren, sondern die letzte offene Zusage des §13-Rasters.

---

## D. Code-Wartbarkeit (Voraussetzung für C-Features)

*Keine offenen Punkte.* D1 (Views-Schnitt), D2/D3 (e2e + Property-Tests) und D4
(Qualitäts-Gates) sind erledigt.

---

## F. App-Texte & UX-Sprache (Prüfstrang 2)

*Keine offenen Punkte.* F3 (Typografie/Microcopy) ist mit
[MICROCOPY.md](docs/MICROCOPY.md) und dem Ratchet `web/src/microcopy.test.ts`
geschlossen.

---

## G. Storage-Management: rp2/Pi & NAS (Prüfstrang 2)

*Keine offenen Punkte.* G4 ist eine **Entscheidung** (0.29.0): der Cache bleibt
bewusst flüchtig, `boot_state_note()` erklärt es in der GUI, und die Doku nennt
die Folge (erster Lauf nach einem Reboot ist kalt).

---

## H. Mathematik (Prüfstrang 2)

Kurzantwort: **kein Rechenfehler gefunden**. Die offenen mathematischen Punkte sind **Konsistenz und dokumentierte Ausbauten**, keine Bugs. A9–A11 (w(h), M3-Ensemble, gemeinsame Bootstrap-Ziehung) bleiben die fachlichen D-Items.

*Keine offenen Punkte.* H3 (Schwellen-Hysterese, 0.31.0) und H5 (DST-Kante,
0.29.0) sind erledigt; H1/H2/H4 waren davor geschlossen.

---

## Erledigt — hier gestrichen, im CHANGELOG nachvollziehbar

IDs bleiben stabil, damit Commits, Tests und Code-Kommentare weiterhin lesbar
sind. Vollständig erledigt und aus den Tabellen oben entfernt:

| Version | Punkte |
|---|---|
| 0.49.1 (17.09.2026) | **Zwei Abstürze aus dem Produktionsbetrieb vom 17.09.2026 (Abend), O44 des [Optimierungs-Befunds](docs/OPTIMIERUNGS-BEFUND.md#o44--zwei-abstürze-aus-dem-produktionsbetrieb-fremde-antwortformen-brechen-die-seite):** (1) `app/pside.py::_supported` hielt `None` (aus `null` in der publizierten Draw-Datei) für einen Messwert und warf beim Sortieren `TypeError: '<' not supported between instances of 'float' and 'NoneType'` — `decide` scheiterte, die GUI zeigte nur `decide_failed`; jetzt zählt `None` wie `NaN` („keine Aussage“), und `app/data.py` meldet jede unerwartete Decide-Ursache bereinigt als `detail` bis in die Oberfläche. (2) Der Fehlerpayload ließ `web/src/views/Stationen.tsx` an `decide.alternatives_nearby.find` abstürzen (Bereich „Stationen“ zusätzlich zur fehlenden Empfehlung); der Vergleich liest jetzt `?? []`. (3) Im Fallback-Modus (`<RP2-IP>:8000`) brach die Seite mit `Cannot read properties of undefined (reading 'includes')` weiß ab: `rp2/fallback_gui.py::_api_stations` lieferte kein `cities`, die SPA liest es zur Ortswahl; die Antwort trägt jetzt `cities`, je Zeile `observed_at` und `calibrated/decision_ready: false`, `_api_series` akzeptiert `station_id`; die App filtert fremde Payloads über `usableStations()` und meldet „Antwort kommt vom Pi-Fallback“. Nachweis: 982 Pytest (neu `tests/test_o44_null_draws.py`, +3 in `test_rp2_fallback.py`), 1097 Vitest (neu `pi-fallback.test.tsx`, +2 in `data.test.ts`), Ruff, Build. |
| 0.49.0 (17.09.2026) | **Zwei Produktionsbefunde vom 17.09.2026:** (1) Die Selektion lieferte „0 Stationen — Stadt-Bestwert 0 %“, weil `_to_matrix` (engine/selection.py) Roh-Zeitstempel gegen das 5-Minuten-Raster reindexte — echte Fetch-Zeiten (Collector-Latenz) und Archiv-Ereignisse fallen dabei fast alle heraus, während der Trainingspfad mit `ceil` snappt und dieselben Daten 20 Prognosen trug. Jetzt snappt die Selektion identisch zum Trainingspfad (ceil + letzte Beobachtung je Bucket, gespiegelt in analysis/), die Diagnose zeigt kleine Bestwerte mit Nachkommastelle; Regressionstests mit Latenz, Versatz-Invarianz und Archiv+Live. (2) Die Veröffentlichung wuchs mit der zweiten Stadt (20 Stationen) auf 13,5 MB über das 10-MB-Leselimit — O22-Maßnahme (d) umgesetzt: eine Datei je Station unter `runtime/engine/forecasts/`, `current.json` wird kleiner Index mit Zeigern, `publication()` fügt zur gewohnten Form (Leser unverändert), Alt-Artefakte bleiben lesbar, `publication_status` prüft je Datei und kennt den neuen Grund `incomplete`. Tests: 3 Selektions-Regressionen, 4 Split-Fälle in test_o22_publication_size.py, Job-Tests auf den Index+Zeiger-Pfad umgestellt. |
| 0.48.0 (17.09.2026) | **Batch 5 des [Optimierungs-Befunds](docs/OPTIMIERUNGS-BEFUND.md#10-batches-priorität-und-check) (O2/O3, O7–O15, O43):** Die Fenster-Sterne tragen Rohwert, Vergleichszahl und normierte Basisrate; Gleichstände zählen in P, Settlement und Statistik einheitlich 0,5. Belege unterscheiden striktes Fenster und Kulanz, rechnen Woanders-Umwege mit derselben Nettoformel wie die Entscheidung und nutzen ohne `tanked_at` die Serverzeit. Eine 7×24-Prior-/Beleg-Personalisierung dient Entscheidung und Selektion ab erstem Beleg. Forecasts nennen Support-Tage (dünne Slots sind im Band markiert), die Heatmap nimmt LOO-Mediane, Strecken/16:30-Zeitwert sind benannt und die doppelte Labor-Basis entfällt. Nachweis: 966 Pytest, 1090 Vitest, Ruff, Build. |
| 0.44.0 (16.09.2026) | **Batch 1 des [Optimierungs-Befunds](docs/OPTIMIERUNGS-BEFUND.md#10-batches-priorität-und-check) (O1 + O22, beide P0):** **O1** `record_fill` las die Tankuhrzeit aus einem Feld, das die GUI nie sendet, und fiel auf 12 Uhr zurück — jeder GUI-Beleg landete im w(h)-Histogramm bei 12, und ab dem achten Beleg stand die Personalisierung der Fensterreihenfolge auf der Mittagsspitze der Engine-Projektion. Jetzt wird `clock_hour` serverseitig aus `tanked_at` in Europe/Berlin abgeleitet (`clock_hour_from_fill`, Zeitstempel gewinnt gegen widersprechende Angabe), je Beleg steht `clock_hour_source` ∈ `beleg`·`abgeleitet`·`default`, Feedback-Store Schema 3 → 4 zeichnet Altbestände aus statt sie umzuschreiben, und `compute_wallet_stats` nennt die Zusammensetzung (`wh_clock_sources`/`wh_measured_n`/`wh_default_n`) bis in `/v1/decide` → `personalization` und den GUI-Satz „3 Belege ohne Zeitstempel zählen als 12 Uhr.“ **O22** `data/runtime/engine/current.json` wuchs mit `indent=2` und voller Präzision über das 10-MB-Leselimit von `read_json`, das still `{}` zurückgab — ab rund fünf Stationen zeigte die App überall „keine Prognose“, während jeder Job Erfolg meldete. Umgesetzt sind die Maßnahmen (a)–(c): kompakt schreiben (`write_json(indent=None)`, Byte-Größe als Rückgabe), Preise/Quantile auf 4 Dezimalen runden (`PUBLICATION_DECIMALS` in `app/model_jobs.py`), laut werden — `read_json_checked` unterscheidet `missing`·`too_large`·`invalid`, `publication_status()` meldet Größe/Lesbarkeit ohne Parse, `/api/v1/health` trägt den `publication`-Block, Alarme `publication_large` (warn, > 6 MB) und `publication_unreadable` (error, > 10 MB oder ungültig) mit Grund, Größe im Job-Log. Messung elf Stationen (Produktionsparameter): 22,40 MB → **7,28 MB**. Maßnahme (d) (Aufteilen je Kraftstoff/Station) bleibt offen begründet in [LUECKEN.md](docs/LUECKEN.md#bewusst-offen-backlog-mit-grund). Tests: neu `tests/test_o1_clock_hour.py` (15), `tests/test_o22_publication_size.py` (9), ein Echtlauf-Fall in `tests/test_app_jobs.py`, drei Fälle in `web/src/data.test.ts`. Doku: [API.md](docs/API.md), [BETRIEB.md](docs/BETRIEB.md#größe-der-veröffentlichung-o22-seit-0440), [MICROCOPY.md](docs/MICROCOPY.md#4b-bereich-jetzt-feste-muster-0340). Lokal grün: 832 pytest, 1067 vitest, ruff, build; E2E hier nicht lauffähig (Chromium in der Sandbox nicht installierbar). |
| 0.43.2 (16.09.2026) | **Vier Nutzerbefunde + Mobil-Robustheit:** Der Lernstand-Satz stand doppelt auf der grauen Karte (die zweite Zeile ist weg, `views/Jetzt.test.tsx` zählt genau eins); der Tagesstreifen in „Heute im Blick“ zog die Zahlen mit der Balkenhöhe nach unten und ließ sie auf 390 px aus der Zelle laufen (feste 12-px-Balkenspur, Spaltenzahl 5·10·19, Ratchet + Geometrie-Messung); die Karte zentrierte anders als der Radar (beide über `mapCenter()`, Zuhause → Referenzstation → erste Station, €-Pins unverändert); und die App war mobil nicht robust (Kopfzeile 748 px in 209 px Fenster → `flex-wrap` + Wortmarke mobil aus + `sm:sticky`; „Stationen“ 2 px zu breit → `truncate`; Belegliste brauchte 560 px → mobil Karte, ab `sm` Tabelle aus derselben Quelle `web/src/fills.ts`; Preis-Zwillinge und Schwellen mobil entzerrt; JSON/Log brechen mobil um; Heatmap-Matrix als einzige bewusst schiebbare Fläche mit Ansage). Dazu: `/?tab=ich` zeigte „Noch keine Belege“, weil der Verlauf nur im Overview-Poll für Jetzt/Stationen/Woche mitkam — die Liste liest `GET /api/v1/fills` jetzt selbst. Neu: `web/e2e/mobile.spec.ts` misst die Zusagen (kein Querlauf, nichts aus dem Bild, keine Zelle über der Box, schiebbare Kästen als Gegenprobe) über alle Bereiche, Ich-Unterseiten, Labor-Abschnitte und Dialoge. Dazu die Dependabot-Gruppe #110/#104/#75 (ruff 0.16.7, React/Vite/lucide, numpy-Untergrenze interpreterabhängig, weil 2.5 Requires-Python ≥ 3.12 hat). Lokal grün: 1064 Vitest, 806 Pytest, Ruff, Build. |
| 0.43.1 (16.09.2026) | **Prüfbericht PR #121 archiviert und die Reste geschlossen:** [archiv/REVIEW-NEUE-GUI-FALLBACK-2026-09-15.md](docs/archiv/REVIEW-NEUE-GUI-FALLBACK-2026-09-15.md) enthält den Wortlaut der Tiefenanalyse (Prüfstand 0.37.0) mit §9 als Erledigt-Nachweis je Befund (B1–B12/M1/M8 + Demo-Stack → 0.37.2, E2E ohne Mocks → 0.38.0, Bundle → 0.41.0); dazu der `windowStars`-Vertrag (Kommentar + Test, 35-%-Schnitt trennt nur die Sterne), die `/api/v1/series`-Abgrenzung und drei veraltete RP2-Doku-Stellen (v3 → v4, „Bestes Fenster“ mit Tag, „NAS prüfen“ ohne Emoji) sowie der Testname `test_template_is_the_v4_gui_…`. Dazu der **letzte offene Punkt aus §5 (100-L-Tank):** `PROFILE_BOUNDS` (10–100 L) war toter Code — die Slider in „Ich → Fahrzeug“ und die Was-wäre-wenn-Zeile in „Jetzt“ kappten weiter bei 80 L; jetzt ziehen beide ihre Grenzen aus `PROFILE_BOUNDS` (eine Quelle mit `app/profiles.py`), MICROCOPY/API nennen 10–100 L. Dazu der **M1-Nachweis:** der Chip „nur offene“ war gebaut, aber ungeprüft (die Testnennung zeigte auf eine Datei ohne Filter-Fall) — die Sichtbarkeits-Regeln liegen jetzt als `atlasMatchesFilter` in `web/src/stations.ts` und sind in `web/src/stations.test.ts` festgehalten. Keine offenen Audit-Punkte; Betriebs-Themen stehen in [LUECKEN.md](docs/LUECKEN.md). Lokal grün: 1053 Vitest, 806 Pytest, Ruff, Build. |
| 0.43.0 (16.09.2026) | **GUI-Text-Befund V3–V5 umgesetzt** (Abschluss von PR #125): **V3 (P2)** Mitteilungs-Register mit Rang (`components/Notices.tsx` `reduceNotices` + `components/NoticesView.tsx`): Störung > Zustand > Hinweis > Erfolg, höchste Stufe gewinnt, Gleichrangige per „ · “ aneinandergereiht, **ein** Block über dem Inhalt, Dauer 6 s (Störungen bleiben), Handlungs-Knopf aus der gewinnenden Meldung — die acht gestapelten Banner der Root sind ersetzt; **V4 (P3)** Worte statt Zeichen: `✓ ✗ ✎ ✕ ★ ▼ ●` raus als Textersatz (Tagebuch-Endergebnis „richtig/daneben/unentschieden“ statt ✓/✗, Chips „Jetzt tanken/Warten/Woanders tanken“, Filter „nur offene/alle Stationen“, Due-Knöpfe „Ja, wie empfohlen/Anders buchen/Noch nicht“, lucide-Check dekorativ im Einrichtungs-Assistent) + Symbol-Ratchet (Regel 11); **V5 (P3)** eine Form je Größe: `euroPerHour`, `kilometersPerHour`/`kilometersPerHourSpeech`, `timeSpanLabel` in `data.ts`, Queue-Alter über `ageWord` („vor 3 Stunden“ statt „2 h“); Prognose-Horizont behält „+N Tage“ + Einheiten-Ratchet (Regel 12). Lokal grün: 1044 Vitest, Pytest, Ruff; E2E hier nicht lauffähig (Chromium-Download gesperrt). |
| 0.42.0 (16.09.2026) | **GUI-Text-Befund T1–T8 + V1–V2 umgesetzt** (Befund: PR #125, Regeln in [MICROCOPY.md](docs/MICROCOPY.md)): **T1/T2 (P0)** Anrede raus und Ratchet dafür (`microcopy.test.ts` + `test_rp2_fallback.py`), `🔄` in der Fallback-GUI entfernt; **T6 (P0)** Datei-/Endpunkt-Namen nur noch im Bereich „System“ (§6 mit Ausnahme §4d, Widerspruch aufgelöst) + Ratchet; **T4 (P1)** km/Prozent/Cent/Komma über die `data.ts`-Formatter, `format-convention.test.ts` verbietet `toFixed` und `€` im Quelltext; **T7 (P2)** englische Zustände übersetzt, Abkürzungen ausgeschrieben, Fehlercode hinter Klartext; **T8 (P2)** `components/FreshnessLine.tsx` in allen fünf Bereichen (vier lokale Ton-Tabellen gelöscht), „ohne Stand“, `freshCountLabel()`, zwei Retry-Formen, Tabelle in §5a; **T5 (P3)** Dubletten nach `data.ts`, Ratchet gegen zweimal eingetragene Sätze; **V1 (P2)** `chartTheme.ts` mit `DARK_CHART`/`LIGHT_CHART` — 64 feste Hexwerte ersetzt, Achsentext im hellen Thema von 2,4:1 auf AA, `a11y.test.ts` prüft beide Paletten; **V2 (P2)** Erklärungen aus `title=` in den sichtbaren Text, §4e + Ratchet (≤ 80 Zeichen, ein Satz). Lokal grün: 928 Vitest, 804 Pytest, Ruff; E2E hier nicht lauffähig (Chromium-Download gesperrt). |
| 0.41.1 (16.09.2026) | **Folge-PR #130: alle fünf roten CI-Checks repariert.** Lighthouse-CLS grün (0,47/0,83/0,49 → 0,00/0,00/0,03): Erst-Paint-Gate (Ansicht rendert erst mit Shell-Daten, Bereichs-Antwort **und** View-Chunk — kein Skeleton→Inhalt-Tausch im Sichtbaren), `scrollbar-gutter: stable` (Gutter reserviert, Viewport-Breite konstant), Chunk-Prefetch parallel zum Gate (Code-Splitting bleibt). Performance 0,97–0,98, Barrierefreiheit/Best Practices/SEO je 1,0; Messwerte in [QUALITAET.md](docs/QUALITAET.md). Dazu: mobile E2E-Emulation (`hasTouch` statt `isMobile`) + Overflow-Fixes (AppHeader, Stationen, System, Sheets, Karte), Demo-Suite-Nachtkante + Daten-Race, `ruff format` für `tests/test_quality_gates.py`. Lokal grün: 36/36 + 8/8 E2E, 718 Vitest, 801 Pytest, Ruff. |
| 0.41.0 (16.09.2026) | **GUI-UX-Befund U1–U8 umgesetzt** (Vermessung gegen [UI-NEUENTWURF.md](docs/UI-NEUENTWURF.md), Protokoll: [archiv/GUI-UX-BEFUND.md](docs/archiv/GUI-UX-BEFUND.md)): **U2 (P0)** Tagesstreifen mobil lesbar (390-px-Test in `views/Jetzt.test.tsx`), **U7 (P0)** Lighthouse misst drei echte Zustände (Einstieg, `?tab=labor`, leerer Setup-Server Port 1356), Byte-/CLS-Budgets scharf, Code-Splitting pro Bereich (`views/*` als eigene Chunks), **U1 (P1)** Fließtext/Zahlen ≥ 12 px und rem statt px (Typografie-Ratchet in `a11y.test.ts`), **U6 (P1)** alle Flächen über `panel` + Radius-Rampe (`components/ui.tsx`, Ratchet gegen wilde `rounded-`-Klassen), **U3 (P1)** Geräte-Raster: Bottom-Nav mobil (6 Bereiche, ≥ 44 px) / Seitenleiste desktop (`components/AppNav.tsx`), Glossar aus der Hauptnavigation in den Labor-Kopf, Kopfzeile eine Zeile — offen bleibt C12 (zweispaltiger Inhalt desktop), **U4 (P2)** Bereichs-Routing in der URL (`?tab=…&section=…`, Browser-Zurück werkt, `routing.test.ts`), **U5 (P2)** Erklär-Treppe: Ebene 1 öffnet überall das Sheet am Wirkungsort, `labReturn`-Buchhaltung entfernt (Rückweg ist das Browser-Zurück), **U8 (P2)** Props-Drilling aufgelöst: `state/overview.tsx` (OverviewContext), Labor 41 → 4 Props, System 32 → 1 Prop, Dashboard 2 201 → 564 Zeilen, Labor-Modell und System-Terminal als Bereichszustand in den Views. Dazu archiviert: GUI-UX-BEFUND mit Erledigt-Vermerk. |
| 0.40.0 (15.09.2026) | **Ablehnungen im Tagebuch sind eine Zeile mit Grund (kein TODO-Punkt, Betriebsbefund):** `_same_advice` kollabiert `no_advice` zeitunabhängig (eine Zeile je Episode; eine Bestätigung schreibt den Store nicht neu, damit das ETag von `/overview` gültig bleibt — B7), die Entscheidungstabelle gibt ihren Ablehnungsgrund maschinenlesbar zurück (`quality_gate`/`no_anchor`/`no_forecast`/`no_window`/`gray_zone`) und der Snapshot speichert ihn als `decline_reason` — vor der M7-Freigabe nennt die Grauzone keine Zahl (`GRAY_ZONE_REASON_GATE_SAFE`). Der Snapshot trägt `station_name`, das Tagebuch gruppiert gleiche Zeilen (`groupDiaryEntries`, „3×“/„mehrfach“) und zeigt die Zeitspanne. Feedback-Store-Schema 3 mit Migration für `snapshots`, `first_snapshot` und `last_snapshot`. Tests: `test_b4.py` (4-Tupel-Gates, Ablehnung vor M7, Kollaps, Tagebuch mit Grund), `test_feedback.py` (Migration 2→3), `lab.test.ts` (Gruppierung, Anzahl, Ablehnungssatz). |
| 0.39.0 (15.09.2026) | **Text-Befund T1–T13 umgesetzt** (Lektorats-Befund gegen [MICROCOPY.md](docs/MICROCOPY.md)): T1 Wochenlinie in einer Richtung (höchster Balken = günstigster Tag, Test in `views/Woche.test.tsx`), T2 Feedback-Kanal mit Ton (`components/FeedbackBanner.tsx`: ok/warn/error, keine `✓`/`!`-Präfixe, keine Ausrufezeichen), T3 zwei Tankmengen benannt (10–80 L Rechnung / 5–100 L Beleg) und Fehlertext an das Verhalten gekoppelt, T4 „A gegen B“ unterscheidet eine und beide Seiten, T5 Tagebuch-Filter auf die §4c-Worte (`DIARY_FILTERS`), T6 ein Name je Größe (Preis-Abstand, Mehrkosten zum perfekten Timing, Perfektes Timing (Orakel), Günstig-Chance, Alles ok), T7 ausgemusterte Wörter ersetzt (Backtest, Kennzahlen der Engine, Zurück, Beleg), T8 deutsche Primärlabel (Stoßzeit/Nebenzeit, außerhalb der Stichprobe, kein `LIVE`-Badge), T9 Pfade nur noch im System-Bereich (§6 präzisiert, `polling_missing` verweist statt zu doppeln), T10 Anrede-Regel in §1 geklärt und die vier Stellen formuliert, T11 Wort-Familien festgezogen (Beleg, Ersparnis ohne Vorzeichen, Alter über `ageWord`, Einheit „L“), T12 Frage/Antwort aus einer Quelle und Doppelungen aufgelöst, T13 Kleinschliff (16 Einzelfunde inkl. `percentLabel` im Diagramm-Tooltip und Emoji-freie Fallback-GUI). Ratchets erweitert: `microcopy.test.ts` (Wortliste, Synonyme, §4c-Worte, Ausrufezeichen), `format-convention.test.ts` (LabCharts-Tooltip), `components/FeedbackBanner.test.tsx` neu. |
| 0.38.0 (15.09.2026) | **E2E ohne Mocks, Webhook-Quittierung (B8), App-Version + Offline-Queue (B10):** eigene Playwright-Suite `web/e2e/demo.spec.ts` + `web/playwright.demo.config.ts` gegen den echten Demo-Stack (Port 1357, `ops/quality/demo_server.py --rebuild`), ohne `page.route`, in der CI als eigener Schritt; der Server-Teil der Zusage läuft ohne Browser als `tests/test_e2e_demo.py` (Overview → Tageskurve, ETag→304, Health). Der Uploader quittiert den NAS-Trigger, wiederholt mit Backoff (30 s … 15 min, höchstens 2 h), gibt danach auf (Intervaljob bleibt Rückfallebene) und meldet den Zustand als `webhook_*` im Herzschlag → `/api/v1/collector/status → webhook` und GUI-Zeile „Trigger Pi → NAS“. Die App-Shell trägt die App-Version (Vite-Stempel, Platzhalter bricht den Build ab), ein wartender Service Worker macht das Update sichtbar; Offline-Queue für Belege/Vorsätze (`localStorage` statt IndexedDB, ausgewiesen; idempotent über die Beleg-`id`). Tests: `test_b8_webhook.py` (10), `test_e2e_demo.py` (3), `offline-queue.test.ts` (11), `service-worker.test.ts` (5), `UpdateBanner.test.tsx` (3). |
| 0.37.2 (15.09.2026) | **Sanity-Check-Fixes (Audit B1–B12 + M1/M8, keine TODO-IDs):** B1 NaN→null in `last_forecasts`/`forecast`/`day` (JSON-Sanitizer + `cache_forecasts`-Validierung + Integrationstest), B2 `timeInputToBerlinIso`-Vorzeichen (Sommer −4 h / Winter −2 h) + Mitternachts-Rollfall, B3 Fallback-F1-Fenster in Ortszeit, B4 Proxy-Write-Forwarding (`POST`/`PUT`/`DELETE`/`PATCH` → NAS, offline 503-JSON statt 501), B5 System-Frische je Datenart (`model` 24 h statt 180 min), B6 `hourRangeLabel` für Fenster < 1 h, B7 „Bestes Fenster“ benennt den echten Tag (Fallback + NAS), B8 Fallback-F2-Frischegate, B9 `freshCount` kraftstofffilternd, B10 `--line`→`--border`, B11 Mitternachtszelle (19 Zellen, NAS↔Pi-Parität), B12 Template-Kommentar v4, Zeitbombe `weekWindowSummary` (fester Referenzzeit), Demo-Stack `make_query`-Stations-Filter, Liter-Grenze auf 100 vereinheitlicht (Profil/Share ↔ Beleg/Pi), Fallback 4.1 (inkl. M8 `role="img"`+`aria-label` im Tagesstreifen). Offen begründet in [LUECKEN.md](docs/LUECKEN.md): E2E ohne Mocks (Playwright-Browser in der Sandbox nicht installierbar), PWA/Service-Worker (B10/C8) — beide mit 0.38.0 nachgeholt. |
| 0.32.0 (13.09.2026) | **A12/A13/C7 abgenommen und geschlossen:** Lebenszyklus (vier Zustände, Ranking-Ausschluss inkl. nie gelieferter Stationen, `TANKAPP_DEAD_AFTER_DAYS`, Alarme) mit korrigierter Kontingent-Wahrheit (weiter gepollt bis zum bestätigten Tausch); Preis-Zwillinge (Schwellen wie `compare-stations`, Artefakt + Alarm + System-Tabelle, nie auto-apply); Glossar-Tab mit 10 Begriffen und gültigen Doku-Ankern (neue ANALYSE-Abschnitte MASE/PICP/Brier/ε/Regret/Lebenszyklus/Zwillinge). Dazu **F3-Rest** (Footer-Vokabular) und **H3-Abgleich** (war 0.31.0). Tests: `tests/test_lifecycle_twins.py` (16), `tests/test_glossary.py` (3), `web/src/glossary.test.ts` (8). |
| 0.31.0 (13.09.2026) | **A9/A10/A11 + D4 + H3:** w(h)-Rückkopplung ab 8 Belegen gewichtet die F3-Fenster; Zweitmodell `profile_ar2` + invers-MASE-Ensemble (`TANKAPP_MODEL_KIND`, Messung 2,53 → 1,93 ct/L MAE); gemeinsame Bootstrap-Ziehung über Stationen (`shared_day_uniforms`, `TANKAPP_SHARED_DRAWS=0` als Gegenprobe); Qualitäts-Gates als eigener Workflow `.github/workflows/quality.yml` (Lighthouse ≥ 0,7, Lastprobe 25 RPS, Budgets); Schwellen-Hysterese mit 2-σ-Rauschband und Mindestabstand (Begründung auch fürs Nicht-Ändern). Offen bleibt die Echt-Daten-Abnahme — begründet in [LUECKEN.md](docs/LUECKEN.md#bewusst-offen-backlog-mit-grund). |
| 0.30.0 (13.09.2026) | **Karte repariert + Anker sichtbar:** CSP `img-src` gibt `https://*.tile.openstreetmap.org` frei (Kacheln wurden komplett blockiert, Karte blieb leer); `/api/v1/stations` liefert stadtweise gefiltert `anchors` (`anchors_by_city`, Stations-Records bleiben ankerfrei), die Karte zeichnet den Anker als Pin und das Radar zentriert auf ihn (Ringe = km ab Anker); Vergleichsstation-Pin heißt „Vergleich“ statt „0,00 €“ plus Erklärtext unter der Karte und Anker-Detailkarte. Tests: `test_app.py` (Ankers/Felder/CSP), `StationMap.test.tsx`, Microcopy-/Format-Ratchets. |
| 0.28.0 (13.09.2026) | **C3 Karten-/Umgebungsansicht:** OSM-Live-Karte mit Server-Netto-€-Pins (`verdict`/`detour_km_est`) und Vektor-Luftlinien-Radar als Fallback ohne Netz oder bei Kachelfehlern. |
| 0.29.0 (13.09.2026) | **Batch 6 — Bedienung:** C5 (Touch-Ziele ≥ 44 px bei grober Zeigerart, Kontrast AA für die gedämpften Töne, Beleg ohne Maus via Formular/Enter und Fokus/Escape im Anpassen-Panel, Karten-Pins per Tastatur) und C8-Rest (Install-/„Zum Homescreen“-Hinweis inkl. iOS-Handgriff und 30-Tage-Snooze, Manifest `orientation: any`, Querformat-Layout, Pull-to-Refresh nur während Karten-/Slider-Gesten). **Batch 7 — Kanten:** G4 entschieden (Cache bleibt bewusst flüchtig, `boot_state_note()` + `CACHE_REBOOT_HINT`, Doku), H5 (DST-Tage im Backtest ausgewiesen: `local_day_hours`/`dst_transition_days`, Fold-Felder, `dst`-Block, Markdown-Abschnitt, `mase_none_reason`, `dstLabel()` in der Werkstatt). Tests: `web/src/a11y.test.ts` (17), `data.test.ts` (3), `test_data.py`, `test_models.py`, `test_backtest.py`, `test_rp2_cache.py`, `test_rp2_fallback.py` |
| 0.27.0 (13.09.2026) | **Batch 1 — Alltag: eine Handlung:** F4 Intent-Leiste gewichtet die Empfehlung primär, kompatible Intents sekundär und widersprechende Handlung zurückgenommen mit Erklär-Tooltip; C8-Teil Sticky-Aktions-Chip („Jetzt tanken“ / „Warten bis …“ / empfohlene Navigation) ohne neue Fläche oder API. Install-Prompt, Landscape und Pull-to-Refresh waren zu diesem Zeitpunkt offen (mit 0.29.0 nachgeholt). |
| 0.26.1 (13.09.2026) | **B11 abgeschlossen:** strenger Kaltlauf auf der Zielhardware (Stand 0.25.1, 17:36–17:39 local, 0/19 Cache, **2,6 min**, MEM **1031 MiB**, CPU **381 %**, Host min **4212 MiB**, shm **1 MiB**). Vier Worker und `shm_size: 256m` bleiben. Sammler zählt Python-Prozesse über `cmdline` und `/proc/pid/comm`. **A8** (Markenrabatte ohne Daten) aus der offenen Liste gestrichen. TODO umgebaut: oben offen, Mitte erledigt, unten der Rest. Die Nachher-Dauer von 0.26.0 bleibt eine eigene Messung nach dem Deploy — sie hält B11 nicht offen. |
| 0.26.0 (13.09.2026) | **Laufzeit-Batch 4 (Code):** B19 ein Pool/`fork`/schlanke Initargs; B20 leere Horizonte, kompakte Payloads, echte Abschlussreihenfolge, sofortiger serieller Fortschritt und monotone Prozentabbildung; B23 Affinität + cgroup-Quota. **B11:** vorhandene Zielhardwarewerte in BETRIEB eingeordnet (1,0 GiB Container-Peak, Host min 4,1 GiB verfügbar, shm 1 MiB, CPU 370 % ⇒ 4 Worker und 256 MiB shm bleiben); strenger 0.26.0-Kaltlauf und Nachher-Dauer bleiben bis zum Deploy offen. |
| 0.25.1 (13.09.2026) | **Fehlerursache im Job-Log** (`app/progress.py::note(…, sticky=False)`, `app/refresh.py`): Grund eines Fit-Fehlers (`insufficient_or_invalid_training_data`, `missing_history`, `horizon_or_backtest_failed`) steht jetzt in `runtime/jobs/models.log` statt nur auf Container-stdout. **Ehrlicher Fortschrittszähler** (`app/progress.py::retotal`): entfallene Folgetasks einer ausgefallenen Station werden aus der Gesamtzahl herausgerechnet („77/80“ → korrigiert auf 77, mit Log-Zeilen „1 Station ohne Modell — 3 Folgetasks entfallen“), bei mehreren Kraftstoffen läuft der Zähler über alle hinweg. **B11** (Doku-Teil): Messprotokoll in [docs/BETRIEB.md](docs/BETRIEB.md#ressourcen-während-phase-b-messen-b11) auf den **Kaltlauf** umgestellt (`end_local` = letzter vollständiger Tag ⇒ jeder Planlauf ist kalt, ~9 min Phase B; warm nur bei Zusatzläufen am selben Tag, ~40 s) plus Sammler `ops/nas/measure-phase-b.sh` (5-s-Takt, fünf Zahlen inkl. `/dev/shm`). Kein Batch-4-Anteil (B19/B20-Rest/B23 unverändert offen). Tests in `tests/test_app_jobs.py` |
| 0.25.0 (13.09.2026) | **B21** Ursache von „e10: 0 Stationen“ gefunden und behoben: das Coverage-Gate der Selektion maß gegen das volle 24-h-Raster (77,5 % Maximalwert bei 06–24-Polling, 4,8 % im Archiv-Betrieb) und schloss damit jede Station aus — Gate misst jetzt im Polling-Fenster und relativ zum Stadt-Bestwert (`engine/selection.py::scheduled_mask`/`coverage_gate`), Artefakt weist `coverage_window`/`coverage_reference`/`coverage_threshold`/`no_delta` aus, Städte ohne Ranking bleiben als Diagnose mit `reason`. **B11** (Lock-Teil): `locked_store` 5 s + `store_locked` als 503 statt 400 `invalid_query`. Bitgleich, wo das Gate nicht bindet. |
| 0.24.0 (13.09.2026) | **C4** Einstellungen-Tab zentral: alle Defaults an einem Ort (Kraftstoff, Stadt, Liter-Default, Verbrauch, Zeitwert manuell/auto, Tempo, Fahrtcharakter, Tankgröße) statt verteilt über die Panels; Alltag zeigt die aktiven Werte read-only mit Verlinkung; Kopfzeile behält Stadt/Kraftstoff/Profil als Schnellwahl derselben Werte. Dazu: aktive Entscheidungsschwellen als read-only-Tabelle aus `/api/v1/stats/summary → thresholds` (inkl. M7-Nachzug-Status/Stichprobe/Begründung) und Dark/Light-Umschaltung (Default „Dunkles Slate“ = Design-Basis; „Hell (Slate)“ = helle Variante derselben Token-Skala nach der Fallback-GUI-Light-Palette, gerätelokal, Bootstrap vor dem ersten Paint). Tests: `web/src/settings.test.tsx`, e2e `app.spec.ts`/`horizons.spec.ts` |
| 0.23.0 (12.09.2026) | **A1** Fahrzeug-/Haushaltsprofile ohne Login (`app/profiles.py`: serverseitiger Store `runtime/profiles/profiles.json` mit Schema-Version, Endpunkte GET/POST/PUT/DELETE/activate unter `/api/v1/profiles`, dieselben Grenzen wie die GUI-Slider, höchstens 8 Profile; GUI: Profil-Umschalter im Header + Verwaltungs-Dialog, Sync in beide Richtungen, localStorage als Offline-Fallback offen ausgewiesen), **A2** Tankstand/Restreichweite als F3-Eingabe (`decide` mit `tank_percent`/`tank_capacity_l`/`range_km` → `tank`-Block; Reserve = 5 l ÷ Verbrauch; `empty` blockiert das Warten → `refuel_now` mit „Warten riskant…“, Ledger bekommt die angezeigte Aktion + `tank_state`; GUI-Karte in „1 · Empfehlung“), **A4** Monats-/Jahresbilanz in der Werkstatt (`compute_wallet_balance` + `GET /api/v1/fills/summary`: Monate/Jahre in Europe/Berlin, Ø €/Tankung, Baseline „immer sofort getankt“, `n_without_date` ehrlich ausgewiesen; Panel in der Werkstatt), **C2** Stamm-Stationen pinnen (Stern, Pin-Reihenfolge, max. 8, localStorage) + Suche über Name/Marke + Markenfilter + Sortierung Preis/Distanz/Netto-€ (Füllung) inkl. Beleg-Erfassung mit Pinned zuerst. Tests: `test_profiles.py`, `test_decide_tank.py`, `test_wallet_balance.py`, `web/src/features.test.ts` |
| 0.22.0 (12.09.2026) | **B17** 21-Tage-Backtest je lokalem Endtag gecacht (`app/backtest_cache.py`: eine JSON-Datei je Station unter `runtime/engine/backtest-cache/`, Fingerabdruck = Stations-Identität + Endtag + Testtage + `Config.to_dict()` + Inhalts-Hash der gesamten Preisreihe bis Endtag + Engine-/Cache-Schema + numpy/pandas-Version; `TANKAPP_BACKTEST_CACHE=0` = aus), Ausweis `backtest_cached`/`backtest_computed_at` je Prognose, Log „Backtest: n aus Tages-Cache, m neu gerechnet“; `run_backtest(strict_end=…)` schneidet die Reihe hart am Testende ab (vorher wurden +3-d/+7-d-Fenster der letzten Folds gegen den laufenden Tag bewertet — neues Feld `days_beyond_test_end`); toter Cutoff-Fit im Backtest-Task entfernt (B20 Punkt 1). Tests in `tests/test_backtest_cache.py` und `tests/test_app_jobs.py` |
| 0.21.0 (12.09.2026) | **B18** dauerhafte von flüchtigen Fehlern getrennt (`app/worker.py::is_transient_error`; strukturelle Codes `some_models_unavailable`, `insufficient_history`, `archive_not_configured`, `influx_not_configured`, `selection_not_available` setzen den nächsten Versuch auf `INTERVALS[name]` statt stündlich, flüchtige behalten 3600 s; `Scheduler.next_delay` und `finish()` folgen derselben Regel), **B24** hart beendete Läufe werden `aborted` statt ewig `running` (SIGTERM-Handler schreibt `state: aborted` mit `aborted_at`/`aborted_phase`, `_mark_prior_aborted` verbucht liegengebliebene `running`-Vorgänger beim nächsten Start, `nas-up` warnt vor Recreate bei aktivem Modell-Lauf), Sichtbarkeit: `public_job` exportiert `aborted_at`/`aborted_phase`, Job-Karte „Abgebrochen“, Warn-Alarme `job_partial`/`job_aborted`, Klartext `messages["aborted"]`. Tests in `tests/test_app_jobs.py` (Backoff, `next_delay`, SIGTERM→`aborted`, Vorher-Running→`aborted`, NAS-Warnung) |
| 0.20.0 (12.09.2026) | **B15** Bootstrap-Pfade vor der 12-Uhr-Projektion je Segment dedupliziert (`engine/models.py::project_paths`, `np.unique(…, axis=0, return_inverse=True)`, NaN als Stellvertreter kodiert damit identische Ziehungen mit gleichem NaN-Muster zusammenfallen), **B16** `fit()` von String- und Aggregator-Overhead befreit (a+c Residuen-Tagesblöcke als (Tag, Slot)-Index-Zuweisung mit `pd.factorize`-Tagesschlüssel, b Feiertagsmaske über `searchsorted` auf int64-Tageswerte in `engine/holidays.py`, d Naiv-Profil über stabilen Sortierindex + `searchsorted`, e `law_rise_outside_noon` vektorisiert — alles bitgleich; die Huber-Normalgleichungen bleiben aus). Bitgleichheits-Tests in `tests/test_models.py` (`project_paths` vs. skalare Referenz, `_residual_blocks` vs. `pivot_table`, `_naive_profile` vs. `groupby`, `holiday_flags` vs. Set-Mitgliedschaft). NAS-Gegenmessung aus dem Job-Log steht noch aus |
| 0.19.0 (12.09.2026) | **B7** (Rest) Alltags-Aggregat `GET /api/v1/overview` (`DataApi.overview()`: `decide` + `fills` + `stats/summary` + due-Episoden + 24-h-Tageskurve in einer Antwort, Einzelrouten bleiben unverändert; unbekannte Station entlädt nur `day`) — der Alltagstabs läuft damit auf einer Anfrage statt sechs Parallel-Polls; dazu `useResource` ohne Abbruch (Refresh reih ein Reload ein statt laufende Requests umzuwerfen), Fehlerbanner erst nach zwei aufeinanderfolgenden Fehlversuchen, solange Daten angezeigt werden (`resourceErrorVisible`), und Revalidierung per ETag/304: `data_version()` aus Datei-Stats + 60-s-Uhrzeit-Fenster, `If-None-Match` → 304 ohne Compute, Antwort-Cache je (Datenstand, Parameter) — ein Refresh kostet damit fast immer Millisekunden; **D1** (Rest) Views-Schnitt: `views/Daily.tsx` / `views/Statistics.tsx` / `views/System.tsx` mit typisierten Props (Zustand bleibt in `Dashboard`, ~4 700 → ~1 600 Zeilen) + `components/JobCard.tsx`; **C9** (Rest) ct/L-€/L-Wahl je Panel durchgezogen, Uhrzeiten auf Europe/Berlin geprüft, Anführungszeichen über den F3-Ratchet. Bewusst offen: `route/evaluate` bleibt ein eigener Poll (Ausklinken ist Follow-up) |
| 0.18.0 (12.09.2026) | **C11** Datenreichweite in den übrigen Panels: `/api/v1/series` liefert `range_from`/`range_to`/`n_points` (nur Punkte **mit** Preis — geschlossene Meldungen sind Beobachtungen, kein Bestand), `/api/v1/forecast` reicht die Fit-Reichweite aus dem Modell durch (`training_start`/`last_observation`/`training_points`/`training_days`, neu in `app/refresh.py` publiziert), `/api/v1/selection` die Ranking-Reichweite je Kraftstoff (neu in `engine/selection.py` berechnet, je Stadt und aggregiert). Frontend: `dataReachLabel` in `data.ts` + `components/DataReach.tsx` — dieselbe Zeile und Beschriftung wie in der Heatmap, kein Rendern ohne Angaben. Tests: drei in `test_app.py`, einer in `test_b3.py`, vier in `components/states.test.tsx` |
| 0.17.0 (12.09.2026) | **C6** (Rest) einheitliche Zustände: Skeletons (`components/Skeleton.tsx` — `SkeletonPanel`/`SkeletonChart`/`SkeletonRows`, nur beim ersten Laden, `role="status"`+`aria-busy`) in acht Panels, „Datenstand älter als X“-Banner (`components/DataAge.tsx` + `STALE_AFTER_MINUTES`/`freshness`/`ageLabel`/`dataAgeNote` in `data.ts`: Preise 30 min, Modell 180 min, Selektion 36 h, doppelte Schwelle = roter Ton, kein Banner ohne bekannten Stand) über Tab-Inhalt, Modell-Ausblick, Heatmap und Ranking, Fehler in Tabellenzellen (`components/CellError.tsx`, Leerstand vs. Fehler getrennt) im Scoreboard und bei den Tages-Entscheidungen; Tests `data-age.test.ts` + `components/states.test.tsx`, beide Ratchets erweitert |
| 0.16.0 (12.09.2026) | **B4** (Rest) Alarm-Zustellung im System-Tab sichtbar (Kachel „Alarm-Zustellung · Push aufs Handy“: Badge, Klartextsatz, offene Codes als Chips, „Zuletzt gemeldet“/„Zuletzt Entwarnung“; Texte als reine Funktionen `notifyTone`/`notifyStatusLine`/`notifyLastLine` in `web/src/data.ts` mit `notify.test.ts`; serverseitig nur ein neues Feld `notify.last_sent_at`), **B14** `docs/analysis/` → `data/analysis/` (Default in `app/config.py`, `tankapp.py`, allen `data-tools/`-CLIs, `analysis/*`, `ops/nas/preflight.sh`, RP2-Suchpfaden und der Doku; alter Pfad bleibt gültig, solange nur er existiert, mit Hinweis je Prozess — kein stiller Umzug; `tests/test_analysis_path.py`), **F3** (Rest) Microcopy-Regelwerk `docs/MICROCOPY.md` + Ratchet `microcopy.test.ts` + Zitate vereinheitlicht |
| 0.15.0 (12.09.2026) | **F2** Deutsche Primär-Labels in der Werkstatt („Wahrscheinlichkeit für günstig“, „Ampel-Stärke“, „Preis-Abstand“, „Prüfzeitraum“, „Ø Mehrkosten“, „q-Wert“, „95-%-KI“, „Billigste Stunde“, „Sprungfreie Tage · MASE“, „Drift-Status · CUSUM“, `aria-label` „Rückmeldung nach Fensterende“), Fachwort/Formel jeweils im Tooltip; **D3** Property-Tests Umweg-Ökonomie (fast-check gegen `detourEconomics`/`detourVerdict` in `web/src/data.ts`: Identität Netto = Brutto − Sprit − Zeit, Monotonie in Litern/km/Verbrauch/Geschwindigkeit/Zeitwert, Break-even `criticalCtPerL` exakt, Grenzfälle `z=0`/`d=0`/`liters→∞`/`v≤0`, `worth_it`-Schwellen inkl. exakter Kanten), **B4** ntfy-Zustellung für `severity: error` (`app/notify.py`, ein Webhook `TANKAPP_NTFY_URL`, Zustandswechsel statt Dauerschleife, `/health` → `notify`) — GUI-Anzeige bleibt offen, **C6** (Teil) gemeinsamer Fehler-Zustand `LoadError` in sechs Panels, **C9** (Rest) alle Anzeigen auf den Formatter-Satz umgestellt + `format-convention.test.ts` als Ratchet, **F3** (Teil) Tageszahlen ausgeschrieben, **D1** (Teil) geteilte UI-Bausteine (`components/ui.tsx`: `panel`/`Empty`/`Badge`/`Metric` + Render-Test) |
| 0.13.0 (12.09.2026) | **B2** Schema-Version + Migration des Feedback-Stores (Versionsfeld, Migration je Sprung, Test „alter 0.10-Store → neuer Code“, Doku in BETRIEB.md), **B5** Schreib-Härtung: `tanked_at`-Plausibilitätsfenster (sonst 1970/2100 im Ledger), Freitext-Caps für `station_name`/`source`, getrenntes Schreib-Budget (20/min je Client, nur Ledger-Endpunkte — GET bleibt frei), **A6** Share-URL beim Start lesen + Teilen-Knopf, **B7** (Teil) gzip für JSON + `max-age=900` für `heatmap`/`last_forecasts`, **C5** (Teil) Fokus-Ring ohne `outline-none`-Überschreibung + Charts `aria-describedby`, **D1** (Teil) `PrecisionSlider`/`HeatmapGrid`/`ApiExplorer` nach `components/` ausgelagert |
| 0.11.0 (12.09.2026) | **B12** Heatmap-Basis umschaltbar (`basis=hour` = Median derselben Stunde; API-Default `overall`), **B13** Build-Commit im Image (Doku nachgezogen), **E3** Beleg-Grenzen vor dem Roundtrip, **E4** Buchung nur mit gewählter Station, **E5** Wochen-Select 4/6/12, **E6** Slider 0,5/1 L/0,5 + Begleitfeld, **E7** API-Explorer „day“ nur mit Station, **G2** RP2-Journal-Cap (Drop-in + `--vacuum-size`) |
| 0.10.0 (12.09.2026) | **A3** Beleg-Storno, **A6** CSV-Export, **A7** M7-Fortschritts-Kachel, **B1** `runtime/`-Backup, **B4** Alarm-Block + GUI-Punkt, **B6/H1** Umweg server-only (`detour_km_est`, `dist_mode`, `verdict`/`worth_it` + Schwellen `elsewhere_net_eur`/`elsewhere_borderline_eur` M7-tunebar; GUI ohne `haversineKm*CIRCUITY`/1,50-0,50-Konstanten), **B9** Version/Commit + CHANGELOG, **C1** Einrichtungs-Checkliste, **C5** (zwei A11y-Fixes), **C10** Heatmap-Tages-Zusammenfassung, **D2** e2e-Spec decide→intent→fill→due, **E2** Komma-Eingabe, **F1** Tab „Werkstatt“, **G1** `cache.log`-Cap, **G3** Datenverlust-Fenster benannt (docs/ARCHITEKTUR.md), Doku-Umbau `docs/` mit Index + Archiv (`docs/archiv/`) + Link-Test |

Alle ehemals teilweise offenen Punkte (F3-Rest) sind mit 0.32.0 geschlossen.

## E. Funktional & Eingabe — verifiziert, kein offener Task

Alle Schreibpfade existieren und sind mit der GUI verdrahtet: `POST /fills`
(Validierung 5–100 L, 0,40–5,00 €/L; seit 0.11.0 prüft die GUI dieselben
Grenzen **vor** dem Roundtrip und bucht ohne gewählte Station gar nicht erst,
E3/E4), `POST /episodes/{id}/intent`, `POST /jobs/{job}/run`,
`POST /collector/heartbeat`, `POST /jobs/trigger` (HMAC). E2 in 0.10.0,
E3–E7 in 0.11.0. F5 (Fehlertexte sachlich-deutsch, keine Demo-Reste) ist
geprüft, kein Task.

Quick Wins 0.10 (14/14) und 0.11 (7/7) sind im CHANGELOG der jeweiligen
Version.

## B11-Kaltlauf 13.09.2026

Strenger Kaltlauf auf der Zielhardware (NAS `Tower`, Container
`tankapp-web-app-1`, Stand **0.25.1**). Cache gelöscht und verifiziert.
Job-Log „Backtest: 0 aus Tages-Cache, 19 neu gerechnet“. 20 Stationen, e10,
Endzustand `partial (some_models_unavailable)`, Dauer **2,6 min**
(17:36:21–17:39:16 local, `ops/nas/b11-cold-run.sh`, 25 Stichproben à 5 s).

| Größe | Wert |
|---|---|
| Python-Prozesse | max 2 gezählt (`cmdline` `python*` — Forkserver-Kinder fielen durch; Gegenprobe CPU 381 % ≈ 4 Worker). Sammler zählt seit 0.26.1 cmdline **und** `comm`. |
| Container-Speicher | max **1031 MiB (1,0 GiB)**, MEM % 6,6 |
| Host verfügbar | min **4212 MiB (4,1 GiB)**, Swap 0 |
| CPUS | max **381 %** (Phase B 248–381 %) |
| `/dev/shm` | max **1 MiB** / 256 MiB → `shm_size: 256m` bleibt |

Früherer Lauf desselben Tags (14:26–14:29): 1029 MiB / 370 %, **kein**
Kaltlauf (9/10 Cache, 2,1 min). Protokoll:
[docs/BETRIEB.md](docs/BETRIEB.md#ressourcen-während-phase-b-messen-b11).
Die Nachher-Dauer von **0.26.0** (ein Pool, `fork`, Cache-Schema 2) ist eine
eigene Messung nach dem Deploy.

## Laufzeit des Modell-Laufs — Befund und Messwerte vom 12.09.2026 (B15–B24; B15+B16 umgesetzt in 0.20.0, B18+B24 umgesetzt in 0.21.0, B17 umgesetzt in 0.22.0, B21 geklärt und umgesetzt in 0.25.0)

Hardware (12.09.2026): NAS `Tower`, J5040, **4** Kerne, Host 15 Gi /
**4,2 Gi verfügbar**, Swap 0, kein Pinning/Quota/Speicher-Limit.
`nproc` im Container lügt (`OMP_NUM_THREADS=1` → 1); Kerne über Affinität.

| Batch | Inhalt | Version | NAS-Dauer |
|---|---|---|---|
| 0 | B21 Coverage-Gate, B11 Lock 503 | 0.25.0 | Selektion 0,05 s → 1,5 s |
| 1 | B15/B16 bitgleich | 0.20.0 | 10,3 min → **2,6 min kalt** / 1,4–1,7 min warm (13.09., 0.25.1) |
| 2 | B18 1×/Tag, B24 Abbruch | 0.21.0 | keine Rechenzeit |
| 3 | B17 Tages-Cache | 0.22.0 | Warm Phase B ~40 s |
| 4 | B19 ein Pool/`fork`, B20 tot/ehrlich, B23 Quota | 0.26.0 | Nachher-Dauer nach Deploy |
| 5 | B22 Entscheidung | — | nicht als Hebel |

B20 Punkt 3 (drei Fits zusammenlegen) war bewusst nicht Teil von Batch 4
und bleibt **nicht geplant**.

## Bewusst NICHT in dieser Liste

- **Login, Benutzerkonten, Rollen, Mandanten, OAuth/SSO** — LAN-only per Vorgabe.
- **DSGVO-Löschkonzept, Daten-Portabilität für Fremdnutzer, Consent-Management** — keine Fremddaten.
- **i18n über Deutsch hinaus** — Zielgruppe ist ein deutschsprachiger Haushalt.
- **Öffentliche Skalierung** (CDN, Multi-Instanz, Loadbalancer) — ein NAS, ein Haushalt.
- **A8 Markenrabatte/Karten** (`--brand-rebate`) — ohne echte Rabattdaten nicht kalibrierbar; 2–4 ct würden das Ranking umdrehen. Bleibt in [docs/LUECKEN.md](docs/LUECKEN.md) begründet offen, kein Arbeitspunkt.

## Reihenfolge-Empfehlung

1. **Die offenen Zeilen sind abgearbeitet** (C3 0.28.0, C5/C8/G4 0.29.0,
   D4/H3 0.31.0, C7/A12/A13 0.32.0, E2E/B8/B10 0.38.0). In der Liste steht
   damit nur noch **B22** als Produktentscheidung; alles andere braucht echte
   Betriebsdaten und ist in [LUECKEN.md](docs/LUECKEN.md#bewusst-offen-backlog-mit-grund)
   mit Status geführt. Neue Panels und die Profil-Verwaltung landen weiter in
   `views/`/`components/` statt in `Dashboard.tsx` (D1, 0.19.0).
2. **B7-Follow-up entschieden (0.31.0)**: `route/evaluate` **bleibt** ein
   eigener Abruf. Messung mit D4: 1,5 ms gegenüber ~230 ms für einen kalten
   `/overview` (0,6 %) — bündeln würde die Routen-Parameter in den
   ETag-Schlüssel des Overviews ziehen und den Antwort-Cache aller Geräte
   entwerten, für weniger als eine Bildschirmaktualisierung Ersparnis.
   Zahlen und Gegenprobe in [docs/QUALITAET.md](docs/QUALITAET.md#b7-rest-routeevaluate-bleibt-ein-eigener-abruf).
3. **Kein P0 mehr offen** — der Heatmap-P0 vom 12.09. ist mit 0.14.0
   geschlossen, B2 (Schema-Version) seit 0.13.0, und aus dem
   [Optimierungs-Befund](docs/OPTIMIERUNGS-BEFUND.md#10-batches-priorität-und-check)
   ist Batch 1 (O1 + O22) mit 0.44.0 erledigt; Batch 2 (O3/O7/O23/O26) ist der
   nächste. Der Store-Feldsprung von O1 (Schema 4, `clock_hour_source`) zeigt
   den Weg: Migrationsfunktion nach `app/feedback.py::_STORE_MIGRATIONS` plus
   `FEEDBACK_SCHEMA_VERSION` anheben — Altbestände kennzeichnen, nie still
   umschreiben.
4. **D-Items erst nach Live-Daten** (M7-Termin, Engine-Ausbau) — sie
   stehen begründet in [docs/LUECKEN.md](docs/LUECKEN.md#bewusst-offen-backlog-mit-grund).
5. **Laufzeit-Bündel ist Code-seitig durch.** Batch 1 **B15/B16** 0.20.0,
   Batch 2 **B18+B24** 0.21.0, Batch 3 **B17** 0.22.0, Batch 0 **B21** +
   B11-Lock 0.25.0, Batch 4 **B19/B20/B23** 0.26.0. **B11** Ressourcen-Abgleich
   mit 0.26.1 geschlossen (Kaltlauf 2,6 min / 1,0 GiB). B22 bleibt nur eine
   Produktentscheidung. Die Nachher-Dauer von 0.26.0 (Cache-Schema 2, erster
   Lauf nach Deploy ist kalt) steht noch aus — Protokoll in
   [docs/BETRIEB.md](docs/BETRIEB.md#ressourcen-während-phase-b-messen-b11).
   Plan mit Aufwand und Begründung:
   [B — Laufzeit des Modell-Laufs](#laufzeit-des-modell-laufs--befund-und-messwerte-vom-12092026-b15b24-b15b16-umgesetzt-in-0200-b18b24-umgesetzt-in-0210-b17-umgesetzt-in-0220-b21-geklärt-und-umgesetzt-in-0250).
