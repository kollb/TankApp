# TankApp — ToDo (Stand 13.09.2026, App-Version 0.32.0)

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

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| A9 | D | **w(h)-Rückkopplung anschließen** *(Erledigt in 0.31.0)* | Erledigt (0.31.0): ab **8 Belegen** (`app/feedback.py::WH_MIN_FILLS`) gewichtet `app/decide.py::_wh_weight()` die F3-Fenster — günstige Fenster zu Stunden, die du nie tankst, rutschen nach hinten; darunter bleibt die preisliche Reihenfolge und die Tagesansicht sagt warum („Noch nach Preis sortiert (5 Belege von 8) — es fehlen 3“). "Echt-Daten-Abnahme" offen: die Reihenfolge ist erst mit echten Belegen im Betrieb bewertbar (§5.5). |
| A10 | D | **M3-Zweitmodell/Ensemble + Echt-Daten-Abnahme** *(Ensemble erledigt in 0.31.0)* | Erledigt (0.31.0): Zweitmodell **profile_ar2** (Tagesprofil je 5-Minuten-Slot als Median statt Sinusform) und inverse-MASE-Ensemble (Konzept §3.2 M3) in `engine/models.py`, Schalter `TANKAPP_MODEL_KIND`. Messung (Demo-Daten, 6 Stationen, 72-h-Holdout): MAE **2,53 → 1,93 ct/L** (−24 %), 6/6 Stationen besser. **Offen bleibt die Echt-Daten-Abnahme** aller M3-Kriterien auf Live-Daten (§3.2) und die Gewichte aus dem Rolling-Origin-Backtest statt aus dem Validierungsfenster ([LUECKEN.md](docs/LUECKEN.md) — das One-Step-Fenster trennt die Modelle nur schwach: 0,51/0,49). |
| A11 | D | **Gemeinsame Bootstrap-Ziehung für `p_lohnt`** *(Erledigt in 0.31.0)* | Erledigt (0.31.0): alle Stationen eines Laufs ziehen aus **denselben** Zufallszahlen je (Horizont, Tagesposition) — `engine/models.py::shared_day_uniforms`, je Station über die eigene Blockverteilung abgebildet (`blocks_from_uniform`, comonotone Kopplung); ausgewiesen als `draws_24h.shared`/`draws_7d.shared`, Gegenprobe `TANKAPP_SHARED_DRAWS=0`. Messung: bei **einem** Lauf mit gleicher Config koppelte die alte Ziehung schon zufällig (Korrelation 0,995 vs. 0,992); bei ungleichen Trainingsfenstern (erhaltene Prognosen) steigt sie 0,545 → 0,588, Streuung der Nowcast-Differenz 1,40 → 1,13 ct/L. Details: [ANALYSE.md](docs/ANALYSE.md#wahrscheinlichkeiten-aus-der-prognoseverteilung-p-seite). |
| A12 | P2 | **Station-Lebenszyklus & Zustandsehrlichkeit** *(Erledigt in 0.32.0)* | Erledigt (0.32.0): vier Zustände je (Station, Kraftstoff), tote fallen vor dem Coverage-Gate aus dem Ranking (auch ohne einzige Rasterzelle), Schwelle `TANKAPP_DEAD_AFTER_DAYS` (Default 7, 0 = aus), Alarme `stations_dead`/`stations_lifecycle`, GUI unterscheidet alle Zustände. Polling-Set bleibt bewusst stabil (Tausch nur mit Bestätigung, [ANALYSE.md](docs/ANALYSE.md#lebenszyklus-der-stationen)); die Kontingent-Behauptung war falsch und ist korrigiert. |
| A13 | P2 | **Preis-Zwillinge: automatische Warnung** *(Erledigt in 0.32.0)* | Erledigt (0.32.0): `_detect_price_twins` mit den `compare-stations`-Schwellen (28 Tage × ≥12 Punkte, ≥90 % Überlappung, ≥99 % ≤0,1 ct/L), Warnung im Artefakt (`price_twins`, `auto_apply: false`), Alarm `price_twins` und Tabelle im System-Tab. Nie automatische Entfernung. |

---

## B. Technisch (Backend, Datenhaltung, Betrieb, Qualität)

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| B8 | P2 | **Webhook-Retry Pi → NAS** | `POST /jobs/trigger` ist Fire-and-Forget: NAS kurz offline → Watermark verloren, läuft nur noch intervallbasiert, ohne Hinweis. Ziel: Retry mit Backoff + Quittierung, Status im Collector-Status sichtbar. |
| B10 | P2 | **Service-Worker: Versionierung & Update-Anzeige** | Cache-Namen sind fix `…-v1`; ein GUI-Update signalisiert dem Nutzer nichts, und die Offline-Queue aus dem Konzept (§5.4, IndexedDB) fehlt. Ziel: SW-Version im Build bumsen, „Neue Version — neu laden?“-Banner, Offline-Queue für Fill/Intent mit sichtbarem „wird gesendet, sobald online“-Zustand. |
| B22 | D | **Zahlen-ändernde Hebel: `bootstrap_samples` und Nacht-Raster** | Entscheidung, kein Gratishebel. 2000→500 Ziehungen halbiert die Backtest-Zeit, verschiebt aber Kennzahlen (MASE/PICP/MPIW/MAE). Zweiter Hebel: `predict(hours=72/168)` rechnet das volle 5-Minuten-Raster inkl. Nacht, obwohl der Collector nur 06–24 Uhr pollt. Ändert `points_3d`/`points_7d` — erst entscheiden, ob die GUI die Nachtstunden braucht. Nach B15–B17 vermutlich überflüssig; ausdrücklich **nicht** als Laufzeit-Hebel einplanen. |

---

## C. GUI / UX

| # | Prio | Fehlt | Warum es zählt / Definition of Done |
|---|---|---|---|
| C3 | P2 | **Karten-/Umgebungsansicht für F2** *(Erledigt in 0.28.0)* | Erledigt (0.28.0): OSM-Live-Kartenansicht mit Server-Netto-€-Pins (`verdict`/`detour_km_est`) & Vektor-Luftlinien-Radar-Fallback bei fehlendem Netz oder Kachelfehlern. |
| C5 | P2 | **Barrierefreiheit-Runde, Rest** *(Erledigt in 0.29.0)* | Erledigt (0.29.0): Touch-Ziele ≥ 44 px nur bei grober Zeigerart (`pointer: coarse`, auch Karten-Zoom und Pins), Kontraste der gedämpften Töne auf AA angehoben (`slate-500`/`slate-600`, dunkel `#8598b0`/`#8295ad`, hell `#55677c`, nachgerechnet in `web/src/a11y.test.ts`), Beleg ohne Maus (Schnellerfassung als Formular mit Enter, Anpassen-Panel mit Fokus/Escape, Radar-Pins per Tab/Enter). Früher: Ampel-Chip mit Symbol, Slider-`aria-valuetext` (0.10.0), Fokus-Ring + Charts-Textfassungen (0.13.0). |
| C7 | P2 | **Hilfe/Glossar-Layer** *(Erledigt in 0.32.0)* | Erledigt (0.32.0): „Was heißt das?“-Tab mit 10 Begriffen (δ̂, MASE, PICP, Brier, ε, Regret, q, AV, Lebenszyklus, Zwillinge), i-Tooltips in Werkstatt/System, jeder Eintrag mit gültigem `docs/ANALYSE.md`-Anker (eigene Abschnitte + Konsistenztests in `tests/test_glossary.py`). |
| C8 | P2 | **Mobile-Feinschliff & PWA (Rest)** *(Erledigt in 0.29.0)* | Erledigt (0.29.0): Install-/„Zum Homescreen“-Hinweis (`components/InstallHint.tsx`: `beforeinstallprompt` bzw. iOS-Handgriff, „Nicht jetzt“ = 30 Tage still, Manifest `orientation: any`), Querformat-Layout (Tagline/Einleitung aus, flachere Abstände, Tageskurve als zwei Neuner-Reihen), Pull-to-Refresh nur während Karten-/Slider-Berührung gesperrt (`ptr-off`). Früher: Sticky-Aktions-Chip (0.27.0). |

---

## D. Code-Wartbarkeit (Voraussetzung für C-Features)

| # | Prio | Fehlt | Details |
|---|---|---|---|
| D4 | P2 | **Qualitäts-Gates in CI: Lighthouse + Last** *(Erledigt in 0.31.0)* | Erledigt (0.31.0): eigener Workflow `.github/workflows/quality.yml` (auf Abruf, sonntags, bei PRs an `web/`/`app/`/`engine/`), Lighthouse-CI mit Budgets gegen zwei GUI-Zustände und ein abhängigkeitsfreier Lastpfad (`web/load/overview.mjs`) gegen das B7-Aggregat inkl. ETag-Revalidierung; beide laufen gegen den neuen Demo-Stack `ops/quality/` (echte App, injizierte Preisabfrage, echte Engine-Publikation). Messwerte, Budgets und die B7-Rest-Entscheidung stehen in [docs/QUALITAET.md](docs/QUALITAET.md). Offen: Lighthouse-Erstdurchlauf (Performance-Ebene deshalb warnend). |

---

## F. App-Texte & UX-Sprache (Prüfstrang 2)

| # | Prio | Befund | ToDo |
|---|---|---|---|
| F3 | P2 | **Typografie** *(Erledigt in 0.32.0)* | Erledigt: [docs/MICROCOPY.md](docs/MICROCOPY.md) und Ratchet `web/src/microcopy.test.ts` (0.16.0), ct/L-€/L-Wahl je Panel (0.19.0), Footer-Vokabular („Abfrage höchstens alle 5 Minuten“, „Polling-Fenster“ statt Jargon, 0.32.0). |

---

## G. Storage-Management: rp2/Pi & NAS (Prüfstrang 2)

| # | Prio | Befund | ToDo |
|---|---|---|---|
| G4 | P2 | **`/tmp/tankapp_cache` überlebt keinen Reboot** *(entschieden in 0.29.0)* | Entscheidung (13.09.2026): Der Cache bleibt im flüchtigen `/tmp` — eine Spiegelung auf die SD-Karte würde bei jedem Abruf (alle 5 min) schreiben und mehr Verschleiß kosten, als ein leerer Puffer nach dem Reboot wert ist. Umsetzung: `boot_state_note()` schreibt den Zustand beim Start in `cache.log`/`systemctl status`, `CACHE_REBOOT_HINT` erklärt ihn in F1, im Prognose-Raster und in der API-Fehlermeldung; die Entscheidung steht in [docs/RP2.md](docs/RP2.md#wartung-logs-journal-sd-karte) und [docs/SPEICHER.md](docs/SPEICHER.md). |

---

## H. Mathematik (Prüfstrang 2)

Kurzantwort: **kein Rechenfehler gefunden**. Die offenen mathematischen Punkte sind **Konsistenz und dokumentierte Ausbauten**, keine Bugs. A9–A11 (w(h), M3-Ensemble, gemeinsame Bootstrap-Ziehung) bleiben die fachlichen D-Items.

| # | Prio | Befund | ToDo |
|---|---|---|---|
| H3 | D | **M7-Tuning-Regler ohne Oszillationsschutz dokumentiert** *(Erledigt in 0.31.0, TODO-Abgleich in 0.32.0)* | Erledigt (0.31.0): Methodik-Notiz + 2-σ-Rauschband + Totband in `app/thresholds.py`, Begründung auch fürs Nicht-Ändern, Tests in `tests/test_b5.py` (Rauschband, Totband, stabile Schwellen). Das TODO lag einen Release zurück. |
| H5 | P2 | **DST-Kante `seasonal_scale`** *(erledigt in 0.29.0)* | Erledigt (0.29.0): DST-Tage werden **ausgewiesen statt ausgeschlossen** — `local_day_hours`/`dst_transition_days` (engine/data.py), je Fold `dst_day`/`local_day_hours`, `report.json`-Block `dst` (Tage, Stunden, Folds, `anchors_missing_nat`, `anchors_outside_series`, `mase_none_reasons`), `report.md`-Abschnitt „Zeitumstellung (DST)“, Randnotiz in [docs/ENGINE.md](docs/ENGINE.md), `mase_none_reason` statt stillem `None`, Anzeige in der Werkstatt (`dstLabel()`). |

---

## Erledigt — hier gestrichen, im CHANGELOG nachvollziehbar

IDs bleiben stabil, damit Commits, Tests und Code-Kommentare weiterhin lesbar
sind. Vollständig erledigt und aus den Tabellen oben entfernt:

| Version | Punkte |
|---|---|
| 0.37.2 (15.09.2026) | **Sanity-Check-Fixes (Audit B1–B12 + M1/M8, keine TODO-IDs):** B1 NaN→null in `last_forecasts`/`forecast`/`day` (JSON-Sanitizer + `cache_forecasts`-Validierung + Integrationstest), B2 `timeInputToBerlinIso`-Vorzeichen (Sommer −4 h / Winter −2 h) + Mitternachts-Rollfall, B3 Fallback-F1-Fenster in Ortszeit, B4 Proxy-Write-Forwarding (`POST`/`PUT`/`DELETE`/`PATCH` → NAS, offline 503-JSON statt 501), B5 System-Frische je Datenart (`model` 24 h statt 180 min), B6 `hourRangeLabel` für Fenster < 1 h, B7 „Bestes Fenster“ benennt den echten Tag (Fallback + NAS), B8 Fallback-F2-Frischegate, B9 `freshCount` kraftstofffilternd, B10 `--line`→`--border`, B11 Mitternachtszelle (19 Zellen, NAS↔Pi-Parität), B12 Template-Kommentar v4, Zeitbombe `weekWindowSummary` (fester Referenzzeit), Demo-Stack `make_query`-Stations-Filter, Liter-Grenze auf 100 vereinheitlicht (Profil/Share ↔ Beleg/Pi), Fallback 4.1 (inkl. M8 `role="img"`+`aria-label` im Tagesstreifen). Offen begründet in [LUECKEN.md](docs/LUECKEN.md): E2E ohne Mocks (Playwright-Browser in der Sandbox nicht installierbar), PWA/Service-Worker (B10/C8 bleiben). |
| 0.32.0 (13.09.2026) | **A12/A13/C7 abgenommen und geschlossen:** Lebenszyklus (vier Zustände, Ranking-Ausschluss inkl. nie gelieferter Stationen, `TANKAPP_DEAD_AFTER_DAYS`, Alarme) mit korrigierter Kontingent-Wahrheit (weiter gepollt bis zum bestätigten Tausch); Preis-Zwillinge (Schwellen wie `compare-stations`, Artefakt + Alarm + System-Tabelle, nie auto-apply); Glossar-Tab mit 10 Begriffen und gültigen Doku-Ankern (neue ANALYSE-Abschnitte MASE/PICP/Brier/ε/Regret/Lebenszyklus/Zwillinge). Dazu **F3-Rest** (Footer-Vokabular) und **H3-Abgleich** (war 0.31.0). Tests: `tests/test_lifecycle_twins.py` (16), `tests/test_glossary.py` (3), `web/src/glossary.test.ts` (8). |
| 0.30.0 (13.09.2026) | **Karte repariert + Anker sichtbar:** CSP `img-src` gibt `https://*.tile.openstreetmap.org` frei (Kacheln wurden komplett blockiert, Karte blieb leer); `/api/v1/stations` liefert stadtweise gefiltert `anchors` (`anchors_by_city`, Stations-Records bleiben ankerfrei), die Karte zeichnet den Anker als Pin und das Radar zentriert auf ihn (Ringe = km ab Anker); Vergleichsstation-Pin heißt „Vergleich“ statt „0,00 €“ plus Erklärtext unter der Karte und Anker-Detailkarte. Tests: `test_app.py` (Ankers/Felder/CSP), `StationMap.test.tsx`, Microcopy-/Format-Ratchets. |
| 0.29.0 (13.09.2026) | **Batch 6 — Bedienung:** C5 (Touch-Ziele ≥ 44 px bei grober Zeigerart, Kontrast AA für die gedämpften Töne, Beleg ohne Maus via Formular/Enter und Fokus/Escape im Anpassen-Panel, Karten-Pins per Tastatur) und C8-Rest (Install-/„Zum Homescreen“-Hinweis inkl. iOS-Handgriff und 30-Tage-Snooze, Manifest `orientation: any`, Querformat-Layout, Pull-to-Refresh nur während Karten-/Slider-Gesten). **Batch 7 — Kanten:** G4 entschieden (Cache bleibt bewusst flüchtig, `boot_state_note()` + `CACHE_REBOOT_HINT`, Doku), H5 (DST-Tage im Backtest ausgewiesen: `local_day_hours`/`dst_transition_days`, Fold-Felder, `dst`-Block, Markdown-Abschnitt, `mase_none_reason`, `dstLabel()` in der Werkstatt). Tests: `web/src/a11y.test.ts` (17), `data.test.ts` (3), `test_data.py`, `test_models.py`, `test_backtest.py`, `test_rp2_cache.py`, `test_rp2_fallback.py` |
| 0.27.0 (13.09.2026) | **Batch 1 — Alltag: eine Handlung:** F4 Intent-Leiste gewichtet die Empfehlung primär, kompatible Intents sekundär und widersprechende Handlung zurückgenommen mit Erklär-Tooltip; C8-Teil Sticky-Aktions-Chip („Jetzt tanken“ / „Warten bis …“ / empfohlene Navigation) ohne neue Fläche oder API. Install-Prompt, Landscape und Pull-to-Refresh bleiben offen. |
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

1. **Alle C-Punkte sind geschlossen** (C3 Karte 0.28.0, C5/C8 Bedienung
   0.29.0, C7 Glossar 0.32.0) — als nächstes bleiben B8 (Webhook-Retry
   Pi → NAS) oder B10 (Service-Worker-Update + Offline-Queue). D1 ist
   mit 0.19.0 erledigt
   (Views-Schnitt + `JobCard`), neue Panels und die Profil-Verwaltung
   landen in `views/`/`components/` statt in `Dashboard.tsx`.
2. **B7-Follow-up entschieden (0.31.0)**: `route/evaluate` **bleibt** ein
   eigener Abruf. Messung mit D4: 1,5 ms gegenüber ~230 ms für einen kalten
   `/overview` (0,6 %) — bündeln würde die Routen-Parameter in den
   ETag-Schlüssel des Overviews ziehen und den Antwort-Cache aller Geräte
   entwerten, für weniger als eine Bildschirmaktualisierung Ersparnis.
   Zahlen und Gegenprobe in [docs/QUALITAET.md](docs/QUALITAET.md#b7-rest-routeevaluate-bleibt-ein-eigener-abruf).
3. **Kein P0 mehr offen** — der Heatmap-P0 vom 12.09. ist mit 0.14.0
   geschlossen, B2 (Schema-Version) seit 0.13.0;
   der nächste Store-Feldsprung braucht nur eine Migrationsfunktion nach
   `app/feedback.py::_STORE_MIGRATIONS` und ein Anheben von
   `FEEDBACK_SCHEMA_VERSION`.
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
