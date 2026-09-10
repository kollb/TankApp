# TankApp — Prüfstand: Konzept ↔ API ↔ Engine ↔ GUI ↔ Live-Daten

> Geprüft am 10.09.2026 auf Branch `arena/01a08cad-tankapp` (Commit `378947a`).
> Methode: Dokuabgleich (KONZEPT/API/ARCHITEKTUR/LUECKEN/ANALYSE/RP2) gegen Code,
> vollständige Prüfläufe, Live-Probe gegen eine gestartete Instanz der NAS-App.
> Dieses Blatt ergänzt [LUECKEN.md](LUECKEN.md): LUECKEN listet die *selbst erkannten*
> offenen Punkte; hier stehen die Abweichungen, die **nicht** in LUECKEN stehen.

## 0. Ausgeführte Prüfungen (Ergebnis)

| Prüfung | Ergebnis |
|---|---|
| `python -m ruff check app tankapp.py data-tools/… engine tests` | ✅ All checks passed |
| `python -m ruff format --check …` | ✅ 56 files already formatted |
| `python -m pytest -q` | ✅ **455 passed** (123 s), 1 Harmlos-Warning (`Mean of empty slice` in `tests/test_selection.py`) |
| `npm --prefix web run typecheck` (`tsc --noEmit`) | ✅ fehlerfrei |
| `npm --prefix web test` (vitest) | ✅ 26 passed |
| `npm --prefix web run build` (vite) | ✅ 302 kB JS / 43 kB CSS |
| Live-Probe: App mit 3-Stationen-`polling.json`, ohne InfluxDB, ohne Engine-Artefakte | ✅ alle Endpunkte antworten, ehrliche Leer-/Fehlerzustände |
| Rate-Limit live geprüft (65 × `/api/v1/health`) | ✅ 60 frei, danach `429` + `Retry-After` |
| Deprecation-Header live geprüft (`/api/v1/stations`) | ✅ `Deprecation: true`, `Sunset`, `Link: rel="successor-version"` |
| Playwright-e2e | ⚠️ nicht ausgeführt (Chromium-Download); **und**: sie testen `decide`/`fills`/`intent` gar nicht (siehe §6) |

**Gesamturteil:** Das Projekt ist bemerkenswert weit und bemerkenswert ehrlich.
Konzept, API, Engine und GUI bilden einen durchgängigen Live-Pfad
(Tankerkönig → Pi → InfluxDB → NAS-Jobs → API → React-GUI), die Prüfstraße ist grün,
und es gibt **keine Demo-Preise in den Live-Pfaden**. Die substantiellen Probleme liegen
nicht in „Mock-Daten", sondern an drei anderen Stellen:

1. Die **Wahrscheinlichkeiten des Decision Layers sind nicht die aus dem Konzept**
   (§4.1/§4.2 verlangen Bootstrap-Ziehungen; geliefert wird eine Ledger-Trefferquote,
   für F2 fehlt sie ganz) — `LUECKEN.md` führt das als „fertig".
2. Die **Schreibpfade der API sind unvalidiert** und können die Ledger, in denen die
   App ihre eigene Güte misst, vergiften (inklusive eines erfundenen Preises 1,70 €/L).
3. **Betriebsmechanik**: Die GUI verbraucht ihr eigenes anonymes Tageskontingent in
   ~16 h, und ein zu großer Feedback-Store wird stillschweigend geleert.

---

## 1. Schicht für Schicht: implementiert vs. Konzept

### 1.1 Datenquellen & Collector (Konzept §1, §7) — ✅ fertig, ein Zähler-Fehler

| Punkt | Ort | Stand |
|---|---|---|
| `prices.php`, 1 Req/300 s hart, 429-Backoff | `data-tools/collect_prices.py:65-67` | ✅ |
| `false` ≠ 0 (Sorte nicht geführt → kein Punkt) | `collect_prices.py` Mapping | ✅ |
| `closed`/`no prices` als Status, nicht als Preis | `collect_prices.py:185`, `upload_influx.py:202` | ✅ |
| Poll-Fenster 06–24 Default, überschreibbar | `--window-start/--window-end`, `engine/config.py poll_start/poll_end` | ✅ |
| tmpfs-Ringpuffer 7 d, FIFO-Prune | `collect_prices.py:64,237` | ✅ |
| Heartbeat (B3.11) | `collect_prices.py:314`, `upload_influx.py:220-281` | ✅ |
| InfluxDB-Ziel, Idempotenz über festen Zeitstempel | `upload_influx.py:296-312` | ✅ |
| Stationsmast 1×/Tag aus `list.php` | `data-tools/discover_stations.py:144` | ✅ (offliner-fähig über gespeicherte Antwort) |
| Archiv-Sync ≥ 1 Jahr, Lücken nachholen | `tankapp.py history-sync`, `app/worker.py archive` | ✅ |
| Lizenz-Hinweis CC BY 4.0 | `web/src/Dashboard.tsx:3034` | ✅ |
| **„`no prices` nach 7 Tagen → Alarm"** | `collect_prices.py:611-616` | ❌ **zählt Polls, nicht Tage** → Alarm nach 35 min statt 7 Tagen (siehe §3.4) |

### 1.2 Selektion (Konzept §2) — ✅ substantially fertig, eine Sortier-Abweichung

`engine/selection.py::analyse_city_light` + `app/selection.py::build_selection`
(NAS-Job, täglich, Artefakt `runtime/selection/current.json`, API `/api/v1/selection`):

umgesetzt sind alle sechs Komponenten des Konzepts — LOO-Median-δ̂, exponentiell
gewichteter Tages-EW-Median (HWZ 7 d, `delta_ew_half_life_days`), CUSUM-Bruchflag,
Tages-Block-Bootstrap (B = 2000, HWZ 14 d), Benjamini-Hochberg-q, AV-Score über das
Tankzeitprofil, harmonische Regression (1.+2.), Volatilität, Rang-Stabilität,
Coverage-Gate 0,85 (`min_coverage`), Composite-Score exakt wie §2
(0,40 Niveau-EW-Median · 0,25 AV · 0,15 Tagesschwankung/R² − 0,10 Volatilität −
0,10 Rang-Streuung, `engine/selection.py:474-482`) und Split-Half-Spearman als
Antwort auf den Selektions-Bias (§12 P0).

Abweichung: Konzept §2 (letzter Absatz) und §8.2 Nr. 7 verlangen „Meine Stationen"
**sortiert nach aktueller Empfehlungsstärke (F2-Netto jetzt)**, δ̂ nur im Detail.
Geliefert wird nach statistischem `score` sortiert, δ̂/KI/q/AV in der Liste sichtbar
(`web/src/Dashboard.tsx:2791-2833`, Überschrift „δ̂ Ranking"). Für die Werkstatt ist das
sachlich fine — es ist dort ja ein Analyse-Werkzeug — aber die Konzeptstelle ist
damit nicht erfüllt und sollte nachgezogen werden (Dokument *oder* Sortierung).

Kampagnen-Quote 6/2/2 existiert nur in der Offline-Pipeline
(`analysis/station_selection.py`), auf dem NAS gilt „top_global = 10 je Kraftstoff".

### 1.3 Engine (Konzept §3) — ⚠️ M1+M2+Bootstrap fertig, der Rest fehlt deliberate

| Konzept | Code | Stand |
|---|---|---|
| 5-min-Raster, FFill ≤ 30 min, Staleness-Maske | `engine/data.py::prepare_series` | ✅ |
| closed-Segmente fließen nicht in die Modellierung | `valid = fresh & status=="open" & price.notna()` | ✅ |
| **Hampel-Filter (1 h, Median ± 5·MAD)** | — | ❌ ** nirgends implementiert** (dokumentiert in `docs/ANALYSE.md:139` als Schritt 3 der Aufbereitung) |
| robuste harmonische Regression + DoW, Huber-IRLS, rollierend 42 d, täglicher Refit | `engine/models.py::fit/huber_fit` | ✅ |
| **gepoolter Feiertags-Dummy je Bundesland** | — | ❌ fehlt (`features()` hat nur Harmonik + DoW + 12-Uhr-Sprung) |
| **Zeit-seit-letztem-Preissprung als Feature** | — | ❌ fehlt |
| AR(2) Yule-Walker | `fit_ar2` | ✅ |
| 12-Uhr-Regel: Projektion von Median **und** allen Bootstrap-Pfaden, `law_rise_outside_noon` Gezählt statt korrigiert | `noon_law_projection`, `predict` | ✅ |
| Residual-Tagesblock-Bootstrap, EW-Gewichte (HWZ 14 d), B = 2000, Quantile .025/.10/.50/.90/.975 | `predict` | ✅ |
| **Intervallkalibrierung ACI (§3.3)** | — | ❌ fehlt, **dokumentiert berechtigt** (erst nach 4 Wochen Live) |
| **7-Tage-Rolling-PICP je Station als Konfidenz-Badge (§3.3.3)** | — | ❌ fehlt; PICP existiert nur als Backtest-Aggregat |
| Zweitmodell UnobservedComponents/Holt-Winters + Ensemble (M3) | — | ❌ fehlt, dokumentiert |
| Abnahmekriterien (MASE, Pinball sym+asym, PICP) | `engine/backtest.py::metrics/criteria` | ✅ gemessen; `mase_jump_free_below_0_80 = None` (bewusst, §3.2 Kriterium 2 offen) |
| Rolling-Origin-Backtest 21 d | `run_backtest(days=…)` | ⚠️ **NAS-Job fährt nur 7 Tage** (`app/refresh.py:244 ("backtest", identity, 7)`), das 21-Tage-Gate kann aus dem automatischen Lauf also nie erfüllt werden — nur `python -m engine backtest --days 21` prüft es |
| Mehrtage-Backtests (+3 d/+7 d) | — | ❌ offen (dokumentiert); Horizonte selbst werden gerechnet (72 h/168 h) |
| `calibrated`/`decision_ready` auf `false` verdrahtet | überall | ✅ korrekt so (§0.4) |

### 1.4 Decision Layer (Konzept §4) — ⚠️ die Kernidee ist anders gebaut

Das ist die gewichtigste Abweichung im ganzen Repo. `LUECKEN.md` führt
„4.1–4.3 F1/F2/F3 inkl. Fenster-Top-3 → fertig (B4) + `latest_by` (B5)".
Formal stimmt die Tabelle, inhaltlich ist die Wahrscheinlichkeitsseite nicht die des Konzepts:

| Konzept verlangt | Code liefert |
|---|---|
| §4.1 `P_besser = P( min_{t∈Fenster} p(t) ≤ p_jetzt − θ )` **aus den Bootstrap-Draws**, θ = 1 ct | `p = action_track_record(store, "wait")["p"]` = **historische Trefferquote derselben Aktion** mit Laplace-Glättung (`(hits + 10·0,5)/(n + 10)`, `app/feedback.py:139-180`). Kein Bezug zur konkreten Prognoseverteilung. θ wird nur im **Settlement** benutzt (`THETA_CT`, `feedback.py:591`), nicht in der Entscheidung. |
| §4.2 `P_lohnt = P(netto > 0)` aus **gemeinsamer** Ziehung über Stationen, pro Alternativ-Zeile | ❌ **existiert gar nicht.** `app/decide.py::_alternatives` liefert `gross/netto/detour_cost/worth_it/kritische Δp`, aber kein `p_lohnt`. Die im Konzept als „kritische Zusatzinformation" bezeichnete Zahl fehlt; die F2-Zweig-Entscheidung nutzt stattdessen dieselbe Ledger-Quote (`elsewhere_p`). |
| §4.3 F3 pro Fenster: Median-Preis, **P(Fenster ≤ Alternative im ±6-h-Umfeld)**, erwartete Ersparnis vs. jetzt | Nur `expected_price` (`_today_windows`, `_week_windows`). Die beiden anderen Angaben je Fenster fehlen; `windows_week` ist der billigste Punkt je Tag, kein 30-min-Fenster. |
| §4.5 Auswertungsreihenfolge: **1. Güte-Gate, 2. F2, 3. F1, 4. F3** | `_table_action` prüft F2 zuerst, dann Grauzone, dann F1. Das **Güte-Gate PICP** (§4.4 Auslöser 1) und der Badge-Auslöser („low" in beiden Fenster-Alternativen) sind nicht implementiert — nur P ∈ [40,60] %, und zusätzlich mit einer `n ≥ 20`-Hürde (`GRAY_MIN_N`). |
| §4.1 Tabelle als *per-Fall*-Regel | Die €-Seite ist exakt wie im Konzept (2,00/1,00/0,50 €, §4.1) und liegt sauber in einer Config (`app/thresholds.py`) ✅ |

Konsequenz, wenn das M7-Gate das erste Mal öffnet: die App zeigt dann „82 % sicher",
meint aber „in den letzten 100 gesettelten Fällen waren 82 % der Warte-Empfehlungen
richtig". Das ist eine *kalibrierbare* Aussage (Brier funktioniert darauf), aber es ist
nicht die Konzept-Aussage „für **diesen** Fall, bei **dieser** Prognoseverteilung".
Architektonisch additionally: die Engine publiziert nur marginale Quantile
(`HORIZON_COLUMNS = timestamp,q025,q10,q50,q90,q975`, `app/model_jobs.py:35`),
**keine Pfade**. Damit ist der §4.2-Weg (gemeinsame Ziehung über Stationen) mit den
heutigen Artefakten prinzipiell nicht berechenbar. Either Pfade/Draws im Artefakt
oder die Probability-Berechnung wandert in den Worker, wo sie liegt.

**Positiv und wichtig:** das M7-Gate wird hart durchgesetzt — vor der Kalibrierung
ist `primary.action` immer `no_advice`, `p_correct` immer `null`
(`app/decide.py:565-589`), die Tabellen-Aktion läuft nur als Shadow in den Ledger.
Kein erfundener Ankerpreis, kein erfundenes Fenster, `latest_by` schneidet Fenster
wirklich ab und meldet `horizon_cut` statt eines Gratis-„no_advice". Genau das war §0.4.

### 1.5 API (Konzept §11) — ✅ breit umgesetzt, drei echte Fehler

Implementiert und live verifiziert: `health`, `stations`, `series`, `forecast`,
`last_forecasts`, `heatmap`, `selection` (+ Alias), `collector/status`,
`route/evaluate`, `decide`, `episodes?status=`, `stats/summary`, `day`
sowie `POST` für `collector/heartbeat`, `jobs/trigger`, `episodes/{id}/intent`,
`fills`, `recommendations/{id}/outcome` (Alias). `PUT/DELETE/PATCH` → 501,
unbekannte Pfade → 404, Pfad-Traversal und Directory-Listing zu, CSP/nosniff/no-store,
Rate-Limit + `X-Api-Key`, `Deprecation`/`Sunset`/`Link`, Fehler als `error_code` statt
Traceback, `allow_nan=False`, keine Zugangsdaten in Antworten oder Logs.

Fehler:

* **`POST /api/v1/episodes` ist in `docs/API.md` (Übersicht *und* „Auth & Limits")
  als Schreib-Endpunkt dokumentiert — der Server antwortet 501.** Tatsächlich existiert
  nur `POST /api/v1/episodes/{id}/intent`. Zusätzlich liefert die 501-Antwort **HTML**
  (`send_error`) statt JSON — widerspricht dem eigenen Satz „Alle Endpunkte liefern
  `error_code` statt Exception-Text".
* **Konzept §11.1 verlangt `lat`/`lon` als Pflichtparameter von `/v1/decide`.**
  Die Parameter werden still ignoriert (kein 400, keine Standortwahl). LUECKEN
  kennt das als offenen Punkt, API.md schweigt es, und die Konzept-Tabelle steht
  unverändert als „Pflicht" im Dokument.
* **`app/route.py:340` hartcodiert `worth_it = net_eur >= 1.5`** statt
  `active_thresholds(...)["elsewhere_net_eur"]`. Damit stimmt die Schwelle von
  `/api/v1/route/evaluate` nicht mit der von `/api/v1/decide` überein, sobald M7
  nachzieht (`TANKAPP_M7_AUTO_APPLY=1`) — genau das, was §4.5 („alle Schwellen in
  einer Config") verhindern will.
* Nebenbefund: drei verschiedene Umweg-Konventionen für dieselbe Größe —
  `decide._alternatives` rechnet Luftlinie × 1,3 (`CIRCUITY`), die GUI-Panel
  „Rechnet sich der Umweg?" rechnen Luftlinie × 1,0 (`data.ts::detourEconomics`)
  und schieben diesen Wert als `detour_km` in den Server, während dort die
  Modul-Dokzeile „d = Umweg gesamt (Hin+Rück)" sagt, API.md aber „einfache
  Mehrweg-Distanz". Nur die Doku ist konsistent; die GUI zerrt den Wert 30 % zu
  niedrig in den Server-Check.

### 1.6 GUI (Konzept §8, M4) — ✅ beide Modi vorhanden, zwei echte Mängel

Vorhanden und live verdrahtet (alle Daten über `/api/v1/*`, kein Seed, kein Simulator):
Alltag (Ampelkarte, F2-Alternativen, Fenster heute/Woche, Tagesstreifen 06–24,
What-If-Regler Liter/Verbrauch/Tempo/Zeitwert/Fahrtcharakter, Stadt-/Kraftstoff-
Umschalter, E5-Äquivalenz-Banner, Due-Prompt, zwei getrennte Ledger, Maps-Deep-Link,
Offline-Banner, Datenstand), Werkstatt (Entscheidungs-Regel + ε-Slider, Scoreboard,
Kalibrierung/Reliability, Stations-Labor mit Horizont-Tabs, Fan-Chart mit 80/95-%-
Bändern, Heatmaps, Meine Stationen, System-Status inkl. Job-Fortschritt, API-Explorer),
PWA (manifest, Service Worker mit SWR + 30-min-Altersgrenze, Register nur in Prod und
nicht für WebDriver).

Mängel:

1. **Zwei erfundene Preise in der Oberfläche.** `Dashboard.tsx:548`
   `useState(1.689)` als Vorbelegung des „ Anders"-Fill-Dialogs und
   `Dashboard.tsx:1273` `✓ Ja, wie empfohlen (~{euro(bestPrice || 1.649, 3)} €/L)`.
   Der zweite Fall ist der kritische: ist kein Preis bekannt, **verspricht der Button
   „~1,649 €/L"**, `handleConfirmRecommendedFill` verweigert dann aber mit
   „Kein Preis bekannt". Restbestände der Prototyp-Demo — und ein Verstoß gegen §0.4
   („fehlende Daten als fehlend zeigen"), nicht gegen §5.4 (Vorbelegung aus Nowcast).
2. **Ergebnislose POSTs melden Erfolg.** `postIntent`/`postFill`
   (`data.ts:568-602`) schlucken Netzwerkfehler (`{error_code: "request_failed"}`),
   und die Aufrufer setzen danach unbedingt
   „✓ Füllung im Wallet-Ledger verbucht!". Bei 429, Netzwerkabbruch oder
   Serverfehler glaubt der Nutzer, sein Beleg sei gespeichert.
3. Konzept M4 „Startbildschirm ≤ 3 primäre Zahlen" ist gestalterisch erreicht,
   aber nirgends gemessen — ebenso „Lighthouse > 90": **kein CI-Job dafür**.
4. `sample/good statistic gui`-Paarvergleich lebt als Alltags-Panel + Server-Endpunkt,
   nicht als eigene Werkstatt-Sektion (in LUECKEN als „teilweise" vermerkt, stimmt).

---

## 2. Live-Daten vs. Mock-Daten — Inventur

**Befund: In allen Live-Pfaden stechen echte Daten. Es gibt einen eingebauten
Hart-Schutzz gegen Nachladen von Demo, und die wenigen harten Zahlen sind
UI-Vorbelegungen bzw. ein Server-Default (unten).**

| Baustein | Datenherkunft | Demo-Rest? |
|---|---|---|
| `data-tools/collect_prices.py` | echte `prices.php`-Aufrufe (`API_URL:62`) | ⚠️ `--demo` existiert, aber: explizit benannt, ohne Key nur mit Flag, und `source: "demo"` wird im **Uploader abgewiesen** (`upload_influx.py:578,643` `SOURCE_DEMO`) → kann nicht in den Live-Bucket gelangen |
| `data-tools/upload_influx.py` | tmpfs-JSONL → InfluxDB `/api/v2/write` + Heartbeat + Webhook | ❌ keine |
| `app/data.py` (Preise/Serien/Heatmap) | InfluxDB-Flux-Query, 30-s-Cache, `age`- und `status`-Prüfung, bei Lesefehler alte Rows + `connection_error` | ❌ keine — Doku-Zeile 1: „No price API calls, no demo fallback" stimmt |
| `app/refresh.py` / Engine | Influx-Export + `runtime/training/*.csv.gz`, Archiv-Ereignisse, sonst `waiting` | ❌ keine; `engine/data.py:69` **wirft**, wenn `source` `demo|synthetic|sample` enthält |
| `app/selection.py` | Trainingsbestand, sonst `selection_not_available` | ❌ keine |
| `app/stats_summary.py` | Engine-Publikation + Feedback-Store; nicht Bildbare Felder = `null` | ❌ keine (API.md: „nur `picp_95` ist echt", Rest `null`/`unknown` — stimmt mit Code überein) |
| `app/decide.py` | Stationspreise + publizierte Prognose + Ledger | ⚠️ **P_besser kommt nicht aus der Verteilung** (§1.4) — kein Mock, aber eine andere Größe als versprochen |
| `app/feedback.py` | JSON-Store auf dem NAS | ❌ kein Mock — **aber ein erfundener Defaultpreis 1,70 €/L** (`:411`, siehe §3.1) |
| `rp2/fallback_gui.py` | RP2-tmpfs-Snapshots, `polling.json`, `heartbeat.json`, gecachte NAS-Prognosen; „Preis-Score" statt Wahrscheinlichkeit, offengelegt | ❌ keine harten Preise im Template verifiziert |
| `rp2/mockups/*.html` | statische Design-Mockups | ✅ absichtlich Mockup (nicht ausgeliefert) |
| `sample/good gui`, `sample/good statistic gui` | Next.js/PostgreSQL-Prototypen mit Seed-/Simulator-Logik | ⚠️ bewusst erhalten als Design-Basis (`sample/README.md`, AGENTS.md). **Nicht** an die Produktion angeschlossen; `web/`+`app/` sind die Produktversion |
| `analysis/`, `data-tools/run_pipeline.py` | Offline-Werkstatt; synthetische Berichte wurden entfernt | ❌ keine |
| `web/e2e/*.spec.ts` | `page.route(...).fulfill(...)`-Fixtures | ✅ Test-Double, korrekt (nur Tests) |
| `tests/**` | tmp-Fixtures | ✅ Test-Double, korrekt |

Kurz: **„Ist noch Mock drin?" → In der laufenden App nein.** Die einzigen harten
Zahlen, die ein Nutzer je zu sehen bekommen kann, sind die zwei GUI-Vorbelegungen
(1,689 / 1,649 €) und der Fill-Default 1,70 €; `sample/` und die e2e-Fixtures sind
Deko bzw. Testmaterial und klar als solche markiert.

---

## 3. Gefundene Fehler (nach Wirkung sortiert)

### 3.1 P1 — Fill-Endpunkt erfindet 1,70 €/L und validiert nichts

`app/feedback.py:405-415`:

```python
liters      = float(fill_data.get("liters", 40.0))
price_paid  = float(fill_data.get("price_paid", 1.70))   # <- erfundener Preis
```

Keine Bereichsprüfung, keine Stationsprüfung, keine Kraftstoffprüfung. Live verifiziert:

```
POST /api/v1/fills {"station_id":"custom","liters":40,"fuel":"e10"}
 → 200 {…, "station_id": "custom", "price_paid": 1.7, "liters": 40.0}

POST /api/v1/fills {"liters":-5,"price_paid":0.0}
 → 200 {…, "liters": -5.0, "price_paid": 0.0, "saved_vs_always_now_eur": -0.0}
```

Warum das im Konzept schwer wiegt: Das Wallet-Ledger ist die *einzige* Stelle, an der
die App behauptet, dem Nutzer Geld gespart zu haben (§5.2, §6 KPI „Ø realisierte
Ersparnis/Empfehlung > 1,00 €"), und Fills ab n ≥ 8 formen das Tankzeitprofil w(h),
das zurück in Selektion und F3-Fenster-Gewichtung soll (§5.5 Schicht C). Anonym
setzbare, unvalidierte Belege bedeuten: jeder, der die API sieht, kann Bilanz und
Profil formen. §11.2 verlangt ausdrücklich „fehlt `price_paid`, setzt der Server den
Nowcast/Poll der Station zur `tanked_at`" — das ist nicht implementiert, ein Default
ist billiger. Empfohlene Korrektur: `price_paid` fehlt → Nowcast-Preis suchen, ohne
einen → `400 price_not_available`; `liters` 5–100, `price_paid` 0,40–5,00,
`fuel` ∈ {e10,e5,diesel}, `station_id` ∈ Polling-Set (sonst `unknown_station`),
Fehler als 4xx, nicht als `200 {"error_code":"record_fill_failed"}`
(`app/data.py:785-792` fängt *jede* Exception und wird in `server.py:542-549` mit 200
beantwortet — `{"liters":"abc"}` wurde live mit HTTP 200 quittiert).

### 3.2 P1 — Jeder Beleg schließt die offene Episode, auch ein fachlich fremder

`app/feedback.py:446-448`:

```python
if ep and ep.get("status") != "expired":
    ep["status"] = "resolved"
```

`compliance` wird ignoriert. Ein `unrelated`-Fill (Tanken ohne App, §5.4: „Kein
Treffer in 72 h → Fill ist unrelated") beendet damit die laufende Advice-Folge,
killt den Due-Prompt und verkürzt die Snapshot-Folge, die dem M7-Gate die n gibt.
Konzeptgemäß darf nur `followed`/`partial` (und allenfalls `ignored` an der
Emit-Station) die Folge schließen. Kein Test deckt das ab (in
`tests/test_b4.py:229-261` wird nur die Idempotenz geprüft).

### 3.3 P1 — Rate-Limit-Kontingent der GUI ist zu klein, und der Schlüssel ist unerreichbar

Rechenweg aus den Poll-Intervallen (`web/src/Dashboard.tsx:569-718`):
stations 30 s, decide 30 s, due 30 s, route/evaluate 30 s, stats 60 s, health 60 s
(15 s während eines Job-Laufs), dayStrip 300 s ⇒ ≈ **10,2 Anfragen/min ≈ 14 700/Tag**
pro offenem Tab — bei `rate_limit_anon_per_day = 10_000` (`app/config.py`).
Ein dauerhaft geöffneter Handy-Tab ist also nach ~16 h den Rest des Tages auf 429.
Dazu passend antwortet `Retry-After` minutes-based (`app/ratelimit.py:120`), als
könne der Client in 60 s weitermachen; der Tageszähler braucht bis zu 24 h.
Der Keyed-Tier (300/min, 50 000/Tag) ist für die GUI praktisch unerreichbar, weil
kein Fetch `X-Api-Key` mitsendet und es dafür keine Einstellung gibt.
Außerdem: `self._buckets` ist ein dict nach Peer-Adresse **ohne Eviction** — als
öffentlich exponierte API (§12 P1) ein langsamer Speicherfresser.
Fix-Richtung: Long-Polling/SSE oder ein gebündelter Endpunkt statt 6 Ressourcen,
Tagesgrenze hoch oder GUI-interner Key via Same-Origin-Cookie/Header, LRU + Sweep.

### 3.4 P1 — `no prices`-Alarm nach 35 Minuten statt nach 7 Tagen

`data-tools/collect_prices.py:611-616` zählt die Kommentarzeile „nach 7 Tagen" als
**Polls**: `stale_no_price[uid] >= 7` bei 5-min-Kadenz = 35 min. Ein Zapfhahn, der
morgens um 6 Uhr noch keine Preise liefert, löst damit jeden Tag Alarme aus
(und der Zähler verpufft, weil er bei jedem `open`/`closed` zurückgesetzt wird).
Auf 7 × 288 Polls (bzw. explizit `no_prices_days`-Zählung über Kalendertage)
stellen, sonst ist §1.2 nicht erfüllt und der Alarm nur Rauschen.

### 3.5 P2 — Zu großer Feedback-Store wird stillschweigend geleert

`app/data.py:78-83` (von `feedback.load_store` mitbenutzt):

```python
if path.stat().st_size > 10_000_000:
    return default          # → load_store liefert {episodes:[], fills:[], settlements:[]}
```

`locked_store` schreibt danach zurück ⇒ ab 10 MB sind Advice-Historie, Brier-Grundlage
und Wallet **weg**, ohne Fehler. Verschärfend: `record_snapshot` läuft bei *jedem*
`/api/v1/decide` (GUI: alle 30 s) und es gibt **keine Retention** für
Episodes/Snapshots/Settlements. Fix: expliziter `store_too_large`-Fehler statt
Default-Rückfall, Kappung/Rotation (z. B. 90 Tage + Parquet/JSONL-Archiv), und
Schreibdrossel (Snapshot nur bei echtem Wechsel oder ≥ 30 min, nicht bei jedem GET).

### 3.6 P2 — „30 Tage"-Kennzahlen sind Allzeit-Zahlen

`compute_advice_stats` (`app/feedback.py:700-833`) und `compute_wallet_stats` filtern
**nie nach Zeit**, nennen die Ergebnisse aber `brier_30d`; `app/decide.py:655-663`
tauscht sie in `last_30d_hits` / `last_30d_total` / `fills_30d` / `saved_eur_30d`, und
`Dashboard.tsx:1650` schreibt wörtlich „Brier-Score 30d:". §5.2 zeigt dem Nutzer eine
30-Tage-Bilanz als *Vertrauensbeweis*, §5.5 verlangt „Aggregation 7/30 Tage". Eine
Wochensaison alter Zahlen überdeckt einen Regimewechsel. Fix: Fenster wirklich
schneiden (und optional zusätzlich allzeit ausweisen).

Nebenbefund: Das Gate `calibrated = n >= 100 and brier_30d < 0.25` vergleicht die
Gesamtzahl `n` mit dem Brier über `n_brier` (nur Snapshots mit gespeicherter
P-Schätzung). Bei `n = 100, n_brier = 3` öffnet das Gate wegen dreier Fälle.
§0.4 meint „100 **abgeschlossene Empfehlungen**" *derselben* Grundgesamtheit.

### 3.7 P2 — Konzepteigene Felder gehen auf dem Weg in den Store verloren

`evaluate_decide` schreibt `trip_mode` und `latest_by` in `snapshot_input`
(`app/decide.py:601-627`), `record_snapshot` baut das Snapshot-Objekt aber aus einer
festen Feldliste (`app/feedback.py:206-230`) — beide Werte landen nie im Store.
Für die spätere Auswertung (Wurde unter einem Deadline-Druck empfohlen? Dedicated-
Fahrt?) sind sie damit verloren; das Matching in `classify_compliance` kann sie auch
nicht nutzen.

### 3.8 P3 — Kleinigkeiten

* `ops/nas/preflight.sh:31-35`: Stationszahl wird als `sum(len(v) for v in sets.values())`
  berechnet — das zählt **JSON-Schlüssel je Set** (label/anchor/batch/stations/…), nicht
  Stationen. Ausgabe „(6 Stationen)" statt 10.
* `app/server.py:247` sendet `Cache-Control: no-store` auf **allen** Antworten, auch auf
  die content-hashierten Vite-Assets — verhindert Asset-Caching und steht dem
  Lighthouse-Ziel aus §13 M4 im Weg; der Service Worker holt das nur teilweise zurück.
* `python -m engine.cli …` ist ein Stillstand-Null-Exit (`engine/cli.py` hat keinen
  `__main__`-Block); korrekt ist `python -m engine`. Einzelfehler in der Doku wäre es
  nicht, aber die Hürde ist vermeidbar.
* `docs/ANALYSE.md:139` listet den Hampel-Filter als Aufbereitungsschritt 3,
  ohne „Ziel"; er existiert nicht.
* `app/decide.py:475` und `app/feedback.py:580` fallbacken die Stadt auf das
  Hartcodierte `"Frankfurt"`. Bei einem Snapshot ohne `city` rechnet das Settlement
  gegen eine andere Stadt — still.
* Engine-Doku (`engine/README.md`) verwendet durchgängig `py -3` und Backslash-Pfade;
  Zielsystem ist das Linux-NAS.

---

## 4. Was fehlt (gegenüber dem Zielbild), knapp sortiert

**Konzeptseitig offen, aber dokumentiert** (Widerspruch nur in LUECKEN.md, die diese
Punkte als „fertig" führt: §4.1–4.3):

1. P_besser aus der Prognoseverteilung (§4.1) — heute Ledger-Grundrate.
2. P_lohnt aus gemeinsamer Ziehung (§4.2) — fehlt völlig; setzt Veröffentlichung von
   Bootstrap-Pfaden (oder Entscheidung im Worker) voraus.
3. F3 je Fenster: P(Fenster schlägt ±6-h-Umfeld) und Ersparnis vs. jetzt (§4.3).
4. Güte-Gate als Vorstufe aller Ratschläge: Rolling-PICP je Station +
   Badge-Prüfung (§3.3.3, §4.4, §4.5 Schritt 1).
5. Produkt-KPI Top-3-Fenster-Trefferquote (§6) — Engine liefert je Tag nur eine
   Entscheidungsstunde; braucht Fensterstruktur im Backtest.
6. §11.1 Standortwahl `lat`/`lon` (und damit freie Umkreissuche).
7. Offline-Queue für Intent/Fill (IndexedDB, §5.4) — `postIntent`/`postFill`
   verlieren POSTs kommentarlos; das hängt mit §3.1/3.2 zusammen: eine Queue ohne
   Server-Validierung wiederholt nur die giftigen Payloads.
8. ACI, Zweitmodell/Ensemble, Mehrtage-Backtests, Markenrabatte, w(h)-Rückkopplung,
   Push — alle bewusst zurückgestellt, Begründungen sind gut.

**Nicht im Konzept, aber für den Betrieb nötig:**

9. CI für die M4-Hartkriterien (Lighthouse, „≤ 3 primäre Zahlen") und für
   Browser-Tests der B4-Flows.
10. Auth/Rollenschiene für die Schreib-Endpunkte: Fills/Intents sind an keinen
    Nutzer gebunden; ein zweiter Nutzer schreibt in dasselbe Wallet und in dieselbe
    Episode (und damit in dasselbe M7-Gate).

---

## 5. Was auffällig gut ist (und gehalten hat)

* **Ehrlichkeits-Regel ist Code, nicht Prosa**: `calibrated=False`,
  `decision_ready=False`, leere Listen/`error_code` statt Hochrechnungen — an ~15
  Stellen konsistent durchgehalten und durch Tests erzwungen
  (`test_stats_summary_no_demo_data`, `test_day_series_no_demo_data`).
* Engine verweigert Demo-/Synthetikeingänge aktiv (`engine/data.py:69`) und markiert
  `mase_jump_free_below_0_80` als `None`, statt mit einem Ad-hoc-Sprunglabel zu
  schummeln (`engine/backtest.py:264`).
* Saubere Idempotenz-Ideen überall: Influx-Dedup über festen Zeitstempel,
  Fill-`id`, Webhook-Watermark mit Debounce, `pending` vs. `void` im Settlement statt
  Raten.
* Fortschritt/Log der NAS-Jobs ohne Credentials, atomare Veröffentlichung,
  alte Artefakte bleiben bei Fehlern stehen.
* Die LUECKEN.md ist — für die Punkte, die sie nennt — akkurat. Man kann sie als
  Arbeitsgrundlage benutzen; sie ist nur an §4 und §6 zu optimistisch.

---

## 6. Test- und Doku-Abdeckung

| Bereich | Python | Web |
|---|---|---|
| Collector/Uploader/Polling | `test_data.py`, `test_export_influx.py`, `test_influx_*`, `test_polling_exclusions.py` | – |
| Engine/Backtest/Bootstrap/Selektion | `test_backtest.py`, `test_models.py`, `test_bootstrap.py`, `test_selection.py`, `test_station_comparison.py` | – |
| API + Jobs + B5-Schutz | `test_app.py`, `test_app_jobs.py`, `test_model_jobs.py`, `test_operations.py`, `test_b5.py` (Rate-Limit, Deprecation, `latest_by`, Fahrtmodus, Tuning) | – |
| Decision Layer/Fills | `test_b4.py` (11 Tests) | ⚠️ **kein e2e** für `decide`, `fills`, `intent`, Due-Prompt — `app.spec.ts`/`horizons.spec.ts` mocken nur `stations`/`series`/`forecast` |
| Rechenlogik der GUI | – | `src/data.test.ts` (26) |
| RP2 | `test_rp2_fallback.py` | – |
| Lighthouse / M4-Kriterien | ❌ nirgends | ❌ kein Job |

Lücken im Verhalten, die ich vermissen würde: Fill-Validierung (3.1), Episode-
Schluss bei `unrelated` (3.2), Store-Größenfall (3.5), Tagesfenster der Statistik
(3.6), verlorene Snapshot-Felder (3.7).

---

## 7. Empfohlene Reihenfolge

1. **P1-Schreibpfad dicht machen:** Fill-Validierung + Nowcast-Preis statt 1,70,
   4xx-Status, `compliance`-Bedingung fürs Resolve, `worth_it` aus der Schwellen-Config.
   (½ Tag, incl. Tests.)
2. **Ledger-Integrität:** Retention/Rotation + `store_too_large`-Fehler statt
   Silent-Reset, Schreibdrossel für Snapshots. (½ Tag)
3. **GUI-Kontingent:** Poll-Bündelung oder Key für die eigene App, `Retry-After`
   korrekt, Bucket-Eviction. (½ Tag)
4. **Doku-Schnellkorrektur:** API.md `POST /v1/episodes` streichen bzw. auf
   `/intent` stellen, 501 → JSON, `lat`/`lon`-Status in §11.1 klar als „offen",
   `docs/ANALYSE.md` Hampel als „offen" markieren, LUECKEN-Eintrag §4.1–4.3 von
   „fertig" auf „Regel fertig, Wahrscheinlichkeiten abweichend" stellen. (¼ Tag)
5. **Alarm-Semantik:** `no prices` auf Tage umstellen. (¼ Tag)
6. **Die P-Seite bauen, die das Konzept verspricht:** Pfade (oder Draw-Berechnung im
   Worker) veröffentlichen → `p_besser`/`p_lohnt` je Fall; `rolling_picp` je Station
   als Gate vor §4.1/§4.2; F3 je Fenster mit ±6-h-Vergleich. Das ist der einzige
   Punkt auf dieser Liste, der ein echtes M5-M6-Projekt ist — und der einzige, der
   den Produktkern („Entscheidung mit Kalibrierungsangabe") von einer netten
   Historienstatistik unterscheidet.
