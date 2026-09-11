# TankApp – Tiefe Analyse Konzept ↔ API ↔ Engine ↔ GUI

> **Archiviert — Tiefenanalyse vom 11.09.2026 (Prüfstrang 1: Konzept ↔ Code).**
> Die Befunde beziehen sich auf den Stand vor App-Version 0.10.0. Die
> priorisierte Arbeitsliste daraus ist [../../TODO.md](../../TODO.md); erledigte
> Punkte sind dort entfernt. Änderungen seitdem: [../../CHANGELOG.md](../../CHANGELOG.md).
> Archiv-Übersicht: [README.md](README.md).

> Datum: 2026-09-11 · Branch `arena/01a08eeb-tankapp` (aus `main` 440402e) · Basis: Prüfstand 10.09.2026 + LUECKEN.md + Live-Code-Review

## 0. Methode

1. **Docs-ToDo sammeln:** `KONZEPT.md` §0-14 Roadmap M1-M7, `LUECKEN.md` „B5 geschlossen / bewusst offen“, `Prüfstand.md` §0-7, `API.md` Endpunkt-Tabelle, `ANALYSE.md` Hampel etc., `ARCHITEKTUR.md` Event-Pipeline, `Gutachten.md` F2/F5.
2. **Code gegen Doku halten:** `app/server.py` Router, `app/data.py` LiveData, `app/decide.py` F1-F3, `app/feedback.py` Dual-Ledger, `app/route.py` Umweg, `app/thresholds.py` M7, `engine/models.py` M1-M3, `engine/data.py` Aufbereitung, `web/src/Dashboard.tsx` Alltag/Werkstatt, `web/src/data.ts` Client-Logik.
3. **Kein Mock-Test:** Es gibt keine Demo-Preise in Live-Pfaden (bestätigt Prüfstand §2). `engine/data.py:69` wirft bei `demo|synthetic|sample`, `upload_influx.py` weist `source:demo` ab.

---

## 1. Was die Docs selbst als ToDo führen

### LUECKEN.md (Stand 10.09.2026) – selbst als „fertig nach B5“ geführt
- Job-Fortschritt, Beschleunigung, Rate-Limit, Deprecation, `latest_by`, `dedicated`, M7-Vorschlag, `refuel_elsewhere` Trefferquote → laut LUECKEN fertig.
- **Bewusst offen (mit guter Begründung):** ACI §3.3, M3-Zweitmodell/Ensemble, Push, Top-3-Fenster-Trefferquote, w(h)-Rückkopplung, Markenrabatte, `lat/lon` freie Umkreissuche, Offline-Queue, E5↔E10 Ranking, OpenAPI, Feedback-Store DB statt JSON, Kampagnen-Quote 6/2/2, Laplace vs Beta-Binomial.

### Prüfstand.md – ergänzt LUECKEN um echte Abweichungen
Der Prüfstand nennt 3 Kernprobleme:
1. **Wahrscheinlichkeiten des Decision Layers ≠ Konzept** – LUECKEN führt §4.1-4.3 als „fertig“, ist aber nur €-Seite fertig.
2. **Schreibpfade unvalidiert** – Ledger vergiftbar + erfundener Preis 1,70 €/L.
3. **Betriebsmechanik:** GUI frisst Tageskontingent, Feedback-Store >10 MB wird still geleert.

Plus P1-P3 Fehlerliste (siehe §6 unten) – alle noch im aktuellen Code vorhanden (grep 11.09.2026).

---

## 2. Konzept-Abdeckung §0-14

| § | Anforderung | Implementiert? | Abweichung |
|---|---|---|---|
| **0.1-0.3** | 3 Fragen F1-F3, 2 Modi Alltag/Werkstatt, eine Zahl | ✅ Alltag/Werkstatt Tabs, Ampelkarte, 3 Zeilen | – |
| **0.4** | Ehrlichkeits-Gate: P erst ab Brier<0.25, n≥100, sonst `no_advice`, `p_correct:null` | ✅ hart in `decide.py:565-589` + `feedback.py:802` | Aber Gate vergleicht n_total vs n_brier (Prüfstand §3.6) |
| **1** | Tankerkönig Collector, 1R/5min, 429-Backoff, tmpfs 7d, Archiv≥1J | ✅ `collect_prices.py`, `tankapp.py history-sync` | **Bug:** `no prices` Alarm nach 7 Polls (35 min) statt 7 Tagen `collect_prices.py:611-616` |
| **2** | Selektion δ̂ LOO-Median + EW-Median HWZ7d + CUSUM + B=2000 Bootstrap HWZ14d + BH-FDR + AV + harm.Regression + Score 0.4/0.25/0.15/0.1/0.1 | ✅ `engine/selection.py`, `app/selection.py`, `ANALYSE.md` | GUI sortiert nach δ̂-Score, Konzept verlangt Sortierung nach Empfehlungsstärke (F2-Netto jetzt). Quote 6/2/2 nur offline |
| **3.1** | Aufbereitung 5-min Raster, FF≤30min, closed≠Beobachtung | ✅ `engine/data.py::prepare_series` | **Fehlt:** Hampel-Filter (1h, Median±5MAD) – in `ANALYSE.md:139` als Schritt 3 gelistet, Code nirgends |
| **3.2** | M1 harmonisch 2 Ordn. + DoW + Huber-IRLS 42d, M2 AR2 Yule-Walker, 12-Uhr-Regel | ✅ M1+M2 + 12-Uhr Projektion via PAVA `models.py:noon_law_projection` bitgleich beschleunigt | **Fehlt:** gepoolter Feiertags-Dummy je BL (HE/BY/NW), Zeit-seit-letztem-Sprung Feature, M3 UCM/Holt-Winters + Ensemble |
| **3.3** | Bootstrap B=500 → q10/q90, q025/q975, unkalibriert markiert | ✅ `predict()` EW-Block-Bootstrap B=2000 HWZ14d | **Fehlt bewusst:** ACI erst nach 4 Wochen Live, Rolling-PICP Badge je Station fehlt |
| **3.4** | Horizonte 24h + 3d/7d, Backtest 21d rolling | ⚠️ 24h/3d/7d Horizonte werden gerechnet, Backtest-Metriken MAE/MASE/Pinball sym+asym τ=0.75 vorhanden | NAS-Job fährt nur 7d `refresh.py:244`, 21d Gate nie aus Auto-Lauf erfüllbar |
| **4.1 F1** | Jetzt/Warten: p_min, t*, Δ, **P_besser = P(min_p(t) ≤ p_jetzt-θ) aus Bootstrap-Draws**, θ=1ct, Tabelle 2€/70% grün, 1€/60% gelb, <1€ jetzt, <50% jetzt | ⚠️ **€-Seite exakt** in `decide.py:_table_action` + `thresholds.py`, `latest_by` schneidet Fenster + `horizon_cut` | **P-Seite falsch:** `p = action_track_record(store,"wait")` = historische Trefferquote Laplace `(hits+5)/(n+10)`, kein Bezug zur konkreten Prognoseverteilung. θ nur im Settlement, nicht in Entscheidung |
| **4.2 F2** | Hier/Woanders: gemeinsame Ziehung über Stationen, **P_lohnt = P(netto>0)** je Zeile, kritisch Δp* | ❌ `alternatives` liefert gross/netto/detour/worth_it, aber **kein `p_lohnt`**. `elsewhere_p` ist wieder Ledger-Quote. Artefakt `current.json` enthält nur marginale Quantile `HORIZON_COLUMNS = q025…q975`, keine Pfade → gemeinsame Ziehung prinzipiell unmöglich |
| **4.3 F3** | Heute/später: 3 beste Fenster mit Median + **P(Fenster ≤ ±6h Umfeld)** + Ersparnis vs jetzt | ⚠️ `windows_today` 2h-Blöcke echte ISO-Stempel, `windows_week` billigster Punkt je Tag Top3 | **Fehlt:** P(Fenster schlägt Umfeld) und Ersparnis vs jetzt je Fenster nur implizit via anchor, `windows_week` kein 30-min Fenster |
| **4.4/4.5** | Keine klare Empfehlung bei PICP rot oder P∈[40,60] oder Badge low, Reihenfolge Güte-Gate→F2→F1→F3, alle Schwellen in Config | ⚠️ Grauzone P∈[40,60] mit `GRAY_MIN_N=20`, F2 vor F1, Schwellen in `thresholds.py` ✅ | **Fehlt:** PICP-Gate und Badge-Prüfung als Vorstufe, `route.py:340` hardcodiert `worth_it = net>=1.5` statt `active_thresholds()["elsewhere_net_eur"]` → divergiert bei M7 auto-apply |
| **5.1** | Brier-Score, Reliability 10 Bins | ✅ `feedback.py:compute_advice_stats` Brier + 10 Bins | Label `brier_30d`/`last_30d` sind Allzeit-Zahlen, kein Zeitfilter (Prüfstand §3.6) |
| **5.2-5.4** | Zwei Ledger: Advice-Ledger kollabiert 30min, Settlement nach Fenster+30min Lag gegen beobachtete Preise (pending/void), Wallet-Ledger Fills mit Slack-Matching, Episode statt Decide-Call | ✅ Dual-Ledger, Collapse-Regel `_same_advice`, Settlement `_realized_min` mit Slack -30/+60, void Gründe | **Bugs:** Fill-Endpunkt erfindet Preis (siehe §6.1), jeder Fill schließt Episode auch bei `unrelated` (Prüfstand §3.2), `trip_mode`+`latest_by` gehen im Store verloren (Prüfstand §3.7), keine Retention → Store wächst bei jedem `/decide` alle 30s |
| **5.5** | Drei Schichten A Markt-Labor 08:00 Backtest, B Live-Advice, C Wallet, M7 Nachzug, Güte-Kacheln nur picp_95 echt | ✅ `stats_summary.py` liefert 3 Schichten, `thresholds.py` M7 Vorschlag, quality_metrics top3/mase_sprungfrei null | w(h)-Rückkopplung erst ab ≥8 Fills korrekt (geschrumpft gegen Default), aber Selektion nutzt es noch nicht |
| **6** | Produkt-KPIs: Brier<0.20, Warten>70%, Jetzt>85%, Ø Ersparnis>1€, Top3>60%, Regret>0.55 | ⚠️ Brier/Treffer/Regret fertig, Top3 offen (Engine liefert je Tag nur eine Prognosestunde) | Top3 Hit Rate bleibt null |
| **7** | Polling 06-24 fix, 216 R/Tag | ✅ | – |
| **8.1 Alltag** | ≤3 primäre Zahlen, Ampel + Alternativen + Tagesstreifen + What-If + Maps Deep-Link + Due-Prompt + Offline SW | ✅ `Dashboard.tsx` Alltag: Ampel, F2, F3, Streifen 06-24, Slider Liter/Verbrauch/Tempo/Zeitwert/Mode, Due-Prompt Banner, Offline-Banner, Maps | **2 erfundene Preise:** `useState(1.689)` Fill-Dialog Vorbelegung + `~{bestPrice||1.649}` Button verspricht 1,649€ obwohl danach „Kein Preis bekannt“ (Prüfstand §1.6) |
| **8.2 Werkstatt** | Regel/ε-Slider, Scoreboard 3 Schichten, Kalibrierung, Stations-Labor, Fan-Chart, Heatmaps, Meine Stationen, System, API-Explorer | ✅ alle 9 Sektionen vorhanden, ε-Scan, Fan 80/95% Bänder, Heatmaps, Selection, Collector, Jobs mit Fortschritt | Paarvergleich als eigene Werkstatt-Sektion fehlt (lebt als Alltags-Panel + Server-Endpunkt), Sortierung Meine Stationen nach δ̂ statt Empfehlungsstärke, M4 Kriterien Lighthouse/≤3 Zahlen nirgends gemessen |
| **9** | Pi tmpfs, Uploader Ack, NAS Influx+Archiv+Jobs, Ressourcen | ✅ `ARCHITEKTUR.md` + `BETRIEB.md` systemd Units, 32M tmpfs | – |
| **10** | Umweg K=d(c/100)p+(d/v)z, Zeitwert peak/offpeak, onroute/dedicated, OSRM Cache, E5 Äquivalenz 1,015 | ✅ `route.py` + `data.ts::detourEconomics` + OSRM Cache `road_route_cache.json` | **3 Umweg-Konventionen:** decide Luftlinie×1.3 `CIRCUITY`, GUI Luftlinie×1.0, API Doku „einfache Mehrweg-Distanz“ vs Code-Doc „Hin+Rück“. Nur Doku konsistent |
| **11 API** | `GET /v1/decide` primär + Intent/Fills/Episodes/Stats + Detail-Endpunkte + Rate-Limit + Deprecation | ✅ siehe §3 | Fehler siehe §3 |
| **12** | P0/P1/P2 Lückenliste | ✅ großteils abgedeckt | P1 Markenrabatte, P2 Push offen bewusst |
| **13 M1-M7** | M1 Collector 14d <2% Lücken, M2 Selektion q<0.05 quotiert, M3 MASE<0.95/<0.80 sprungfrei + Pinball<Naive + PICP90-98, M4 PWA ≤3 Zahlen Lighthouse>90, M5 TankPuls OpenAPI+Tests, M6 Boosting, M7 Kalibrierung Brier<0.25 n≥100 | M1/M2/M4 weitgehend, M3 ohne Echt-Abnahme, M5 ohne OpenAPI, M7 Vorschlag fertig auto-apply aus | – |
| **14** | Ehrliche Grenzen: keine Demo-Zahlen, keine erfundenen Sicherheiten | ✅ durchgängig `calibrated=false`, `decision_ready=false`, `error_code` statt Exception, keine Credentials im Log | Aber Fill 1.70€ und GUI 1.649€ brechen §0.4 |

---

## 3. API – Spec vs Implementierung

### Implementiert und live verifiziert (Prüfstand §1.5 + eigener Check)
`GET /api/v1/health`, `stations`, `series`, `forecast`, `last_forecasts`, `heatmap` B3.9, `selection` B3.10 (+Alias), `collector/status` B3.11, `route/evaluate` B3.12, `decide` B4, `episodes?status=due`, `stats/summary`, `day`, `POST collector/heartbeat`, `POST jobs/trigger` Issue50 (Debounce 15min/1h + Idempotenz watermark → `runtime/jobs/<job>.json data_watermark`), `POST episodes/{id}/intent`, `POST fills`, `POST recommendations/{id}/outcome` Alias, Rate-Limit 60/300 + Tageskontingent + `X-RateLimit-*` + 429 `Retry-After`, Deprecation Header `Deprecation:true Sunset Link` auf `stations/day/route/evaluate`, 501 HTML statt JSON bei unbekannten POST.

### Fehler / Inkonsistenzen
- **API.md listet `POST /api/v1/episodes` als Schreib-Endpunkt** (Übersicht + Auth) – Server antwortet 501. Es existiert nur `POST /api/v1/episodes/{id}/intent`. 501 liefert HTML `send_error` statt JSON `error_code` – widerspricht eigener Regel „Alle Endpunkte liefern error_code“.
- **Konzept §11.1 `lat`/`lon` Pflicht für `/v1/decide`** – Parameter werden still ignoriert, kein 400, keine Standortwahl. LUECKEN kennt als offen, API.md schweigt.
- **`route/evaluate` `worth_it` Hardcode:** `app/route.py:340 worth_it = net_eur >= 1.5` statt `active_thresholds()["elsewhere_net_eur"]` → divergiert bei `TANKAPP_M7_AUTO_APPLY=1`.
- **Detour-Quelle uneinheitlich:** `detour_km_source` query|derived|derived_anchor|zero korrekt ausgewiesen, aber GUI schiebt Luftlinie×1.0 als `detour_km` in Server-Check, während `decide` Luftlinie×1.3 nutzt. Doku sagt „einfache Mehrweg-Distanz“, Modul-Doc „d=Hin+Rück“ – Verwirrung.
- **Rate-Limit Tageskontingent zu klein für GUI:** Rechnung Prüfstand §3.3: stations 30s + decide 30s + due 30s + route 30s + stats 60s + health 60s (15s während Job) + dayStrip 300s ≈ 10.2 Req/min ≈ 14.700/Tag pro Tab, aber `rate_limit_anon_per_day=10_000` → Tab nach ~16h auf 429 Rest des Tages. `Retry-After` minutes-based suggeriert 60s, braucht aber bis 24h. `X-Api-Key` für eigene GUI unerreichbar (kein Fetch sendet Header, keine Einstellung). Bucket `self._buckets` ohne Eviction → Speicherleck bei öffentlicher Exposition.
- **Fehlercodes sauber:** `unknown_station` 404, `unknown_city` 404, `invalid_*` 400, `price_not_available`, `episode_not_found` 404, `rate_limited` 429, `payload_too_large` 413, `invalid_json` 400 – aber Fill/Intent fangen jede Exception und antworten 200 mit `error_code: record_fill_failed` statt 4xx (Prüfstand §3.1).

---

## 4. Engine – Konzept vs Code

**Fertig M1+M2+Bootstrap:**
- 5-min Raster, FF ≤30min, Staleness-Maske, closed nicht in Modellierung `engine/data.py:prepare_series` ✅
- Huber-IRLS harmonisch 1.+2. + DoW-Dummies + 12-Uhr Schritt `models.py:features` ✅
- AR2 Yule-Walker nur über kontige Triple, Shrink bis stabil `fit_ar2` ✅
- 12-Uhr Regel: Struktur + Median + alle Bootstrap-Pfade je [12:00, nächste 12:00) PAVA projiziert, `law_rise_outside_noon` gezählt statt gelöscht ✅
- EW-Tagesblock-Bootstrap B=2000 HWZ14d `exp_block_weights` ✅
- Backtest Kriterien MASE, Pinball sym τ=0.5 + asym τ=0.75 3× Strafe, PICP ✅ gemessen, `mase_jump_free_below_0_80=None` bewusst (kein Ad-hoc Label)

**Fehlt / abweichend:**
- **Hampel-Filter** (1h, Median±5MAD) §3.1 Schritt3 – in `ANALYSE.md:139` gelistet, Code nirgends.
- **Feiertags-Dummy** gepoolt je BL – `features()` hat nur Harmonik+DoW+12Uhr.
- **Zeit-seit-Sprung Feature** – fehlt.
- **M3 Zweitmodell** UCM/Holt-Winters + saisonale Naive Benchmark + inverse-MASE Ensemble – fehlt, begründet als „erst nach Abnahme“.
- **ACI** §3.3 – fehlt bewusst erst nach 4 Wochen Live, korrekt als unkalibriert gekennzeichnet.
- **Rolling-PICP Badge** je Station 7d als Konfidenz-Badge §3.3.3 – fehlt, nur Backtest-Aggregat.
- **Mehrtage-Backtests** +3d/+7d – Horizonte werden gerechnet (72h/168h), Backtests offen.
- **NAS-Job 7d statt 21d** – `refresh.py:244 ("backtest", identity, 7)` → 21d Gate nie aus Auto-Lauf erfüllbar, nur `python -m engine backtest --days 21` prüft.

**Gutachten-Befunde:** F2 B=200 Hürde bereits gefixt B=2000, F5 EW-Median + CUSUM bereits implementiert `delta_ew_ct`/`break_flag`, asym Pinball bereits, Event-Pipeline Webhook bereits – alle Gutachten-Punkte bis auf DB-Trennung erledigt.

---

## 5. GUI – Konzept vs Implementierung

**Basis:** `sample/good gui` → Alltag, `sample/good statistic gui` → Werkstatt – laut `sample/README.md` + `AGENTS.md` ausdrücklich erhalten und als gestalterische Basis übernommen, nicht gelöscht.

**Alltag (Dashboard.tsx daily):**
- Ampelkarte `refuel_now/wait/refuel_elsewhere/no_advice`, Badge calibrated, Reason, Fenster heute/Woche, Alternativen Top3, Tagesstreifen 06-24 mit Jetzt-Marker, What-If Slider Liter/Verbrauch/Tempo/Zeitwert/Mode, Stadt/Fuel Umschalter, E5 Banner 1,015, Due-Prompt Banner mit 3 Taps, Dual-Ledger Advice vs Wallet getrennt, Maps Deep-Link, Offline-Banner, Datenstand `clockLabel`, Service Worker `public/sw.js` SWR 30min, manifest ✅
- **Bugs:** `useState(1.689)` Vorbelegung Fill-Dialog + `~{euro(bestPrice||1.649,3)}` Button verspricht 1,649€ wenn kein Preis bekannt, `handleConfirmRecommendedFill` verweigert dann aber – Verstoß §0.4. `postIntent`/`postFill` schlucken Netzwerkfehler und melden „✓ Füllung verbucht!“ auch bei 429/offline (Prüfstand §1.6).

**Werkstatt (statistics):**
- Sektionen: 1 Regel+ε-Slider, 2 Scoreboard out-of-sample + Live daneben, 3 Kalibrierung Reliability + Live-Punkte ab n≥20, 4 Stations-Labor Tag-für-Tag mit Verlauf + Histogramm + ε-Scan, 5 Heatmaps Level/Probability DoW×Stunde, 6 Meine Stationen δ̂ Ranking mit KI/q/AV/best_hour, 7 System Jobs + Fortschritt `JobCard` Phase x/y Balken ETA, 8 Pi/tmpfs Livestatus, 9 API-Explorer ✅
- **Abweichungen:** Paarvergleich nicht als eigene Werkstatt-Sektion (lebt als Alltags-Panel + Server-Endpunkt, in LUECKEN als „teilweise“ vermerkt), Sortierung Meine Stationen nach δ̂-Score statt Empfehlungsstärke, Güte-Kacheln Top3/MASE/CUSUM null/unknown korrekt, aber Hinweise `calibrationHint`/`brierHint` mit ETA Datum.

**System/Architektur:**
- `Dashboard.tsx:569-718` Poll-Intervalle 30s/60s/300s, `healthInterval` 60s → 15s während Job ✅
- PWA: `manifest.json`, `sw.js` Cache-First letzte `/decide` + SWR Werkstatt, Register nur Prod nicht WebDriver ✅
- M4 Hartkriterien „≤3 primäre Zahlen“ gestalterisch erreicht, aber nirgends gemessen, Lighthouse >90 kein CI-Job.

---

## 6. Gefundene Fehler nach Wirkung (aus Prüfstand + verifiziert)

### P1 – kritisch, ledger- / geldrelevant
1. **Fill-Endpunkt erfindet 1,70€/L und validiert nichts** `app/feedback.py:410-411` `liters=float(...40.0)` `price_paid=float(...1.70)` Keine Bereichsprüfung, keine Stationsprüfung, keine Fuel-Prüfung. Live verifizierbar: `POST /api/v1/fills {"station_id":"custom","liters":40}` → 200 mit 1.7. `liters:-5 price:0` → 200. Konzept §11.2 verlangt „fehlt price_paid → Nowcast/Poll zur tanked_at“, sonst `400 price_not_available`. Fix: `price_paid` fehlt → Nowcast suchen, sonst 400; liters 5-100, price 0.40-5.00, fuel∈{e10,e5,diesel}, station_id∈Polling-Set sonst `unknown_station`, Fehler als 4xx nicht 200.
2. **Jeder Beleg schließt Episode, auch `unrelated`** `feedback.py:446-448` `if ep and status!="expired": status=resolved` Compliance ignoriert. `unrelated` killt Due-Prompt und M7-n. Nur `followed/partial` (ggf `ignored` an Emit-Station) darf schließen.
3. **Rate-Limit Kontingent zu klein + Key unerreichbar** (siehe §3) + `self._buckets` ohne Eviction → langsamer Speicherfresser.
4. **`no prices` Alarm nach 35min statt 7 Tagen** `collect_prices.py:611-616` zählt Polls `stale_no_price>=7` bei 5min Kadenz =35min, Zähler reset bei open/closed.

### P2 – ledger-integrität / statistik-irreführung
5. **Feedback-Store >10MB wird still geleert** `app/data.py:78-83` `if size>10M: return default` → `load_store` liefert leere Episoden/Fills/Settlements, `locked_store` schreibt zurück → Historie weg ohne Fehler. Keine Retention, `record_snapshot` bei jedem `/decide` alle 30s. Fix: `store_too_large` Fehler statt Default, Rotation 90d + Archiv, Schreibdrossel Snapshot nur bei Wechsel oder ≥30min.
6. **„30 Tage“ Kennzahlen sind Allzeit** `compute_advice_stats` + `compute_wallet_stats` filtern nie nach Zeit, nennen aber `brier_30d`/`last_30d_hits`/`fills_30d`. Konzept §5.2 30-Tage Bilanz, §5.5 Aggregation 7/30d. Wochensaison alter Zahlen überdeckt Regimewechsel. Gate `calibrated=n>=100 and brier<0.25` vergleicht Gesamt n mit n_brier (nur Snapshots mit p) – bei n=100, n_brier=3 öffnet Gate wegen 3 Fällen.
7. **Konzepteigene Felder verloren** `evaluate_decide` schreibt `trip_mode`+`latest_by` in `snapshot_input` `decide.py:601-627`, `record_snapshot` baut Snapshot aus fester Feldliste `feedback.py:206-230` – beide landen nie im Store → spätere Auswertung Deadline/Dedicated unmöglich.
8. **P-Seite fehlt konzeptionell** (schon §2) – P_besser/P_lohnt aus Verteilung fehlt, nur Ledger-Quote. Engine liefert keine Pfade.

### P3 – klein, aber ehrlichkeits-relevant
- `ops/nas/preflight.sh:31-35` Stationszahl `sum(len(v) for v in sets.values())` zählt JSON-Schlüssel nicht Stationen → „6 Stationen“ statt 10.
- `app/server.py:247` `Cache-Control: no-store` auf allen Antworten auch Vite-Assets mit Content-Hash → verhindert Asset-Caching, bremst Lighthouse M4.
- `python -m engine.cli` Stillstand-Null-Exit, korrekt `python -m engine`.
- `ANALYSE.md:139` Hampel als Schritt 3 ohne „Ziel“.
- `decide.py:475` + `feedback.py:580` fallback Stadt hardcodiert „Frankfurt“ – Snapshot ohne city rechnet gegen falsche Stadt.
- Engine-Doku `py -3` + Backslash – Ziel Linux NAS.
- `docs/API.md` 501 HTML statt JSON, `POST /api/v1/episodes` Doku-Fehler.

---

## 7. Was fehlt (konzeptseitig)

**Bewusst offen mit guter Begründung (LUECKEN.md):** ACI, Zweitmodell/Ensemble, Push ntfy/Telegram (Trigger vorbereitet), Top3-Fenster-Trefferquote (braucht Fensterstruktur im Backtest), w(h)-Rückkopplung Selektion/F3 (erst ≥8 Fills), Markenrabatte, freie Umkreissuche `lat/lon` (braucht eigenes Kontingent), Offline-Queue IndexedDB, E5↔E10 Ranking (Faktor 1,015 Näherung), OpenAPI (API.md ist verbindlich bis zweite Verbraucherin), DB statt JSON (Retention erster Handlungsbedarf), Quote 6/2/2 auf NAS, Beta-Binomial vs Laplace.

**Nicht bewusst offen, aber offen:**
- P_besser aus Prognoseverteilung §4.1, P_lohnt gemeinsame Ziehung §4.2, F3 P(Fenster schlägt ±6h) §4.3, Güte-Gate Rolling-PICP je Station §3.3.3/§4.4/§4.5 Schritt1, Produkt-KPI Top3 §6, Standortwahl lat/lon §11.1, Offline-Queue §5.4, CI für M4 Lighthouse/≤3 Zahlen + e2e für decide/fills/intent (Playwright vorhanden `web/e2e/*.spec.ts` mockt nur stations/series/forecast).

**Für Betrieb nötig (nicht im Konzept):** Auth/Rollen für Schreib-Endpunkte (Fills/Intents an keinen Nutzer gebunden – zweiter Nutzer schreibt in selbes Wallet/Episode/M7-Gate), Poll-Bündelung oder gebündelter `/v1/decide` statt 6 Ressourcen, Bucket LRU+Sweep.

---

## 8. Positiv – was auffällig gut ist

- **Ehrlichkeits-Regel ist Code, nicht Prosa:** `calibrated=False`, `decision_ready=False`, leere Listen/`error_code` statt Hochrechnungen an ~15 Stellen, Tests `test_stats_summary_no_demo_data`, `test_day_series_no_demo_data` erzwingen.
- Engine verweigert Demo-Eingänge aktiv `engine/data.py:69`, markiert `mase_jump_free_below_0_80=None` statt Ad-hoc Label.
- Idempotenz überall: Influx Dedup fester Timestamp, Fill-id, Webhook Watermark Debounce, pending vs void Settlement.
- Fortschritt/Log NAS-Jobs ohne Credentials, atomare Veröffentlichung, alte Artefakte bleiben bei Fehler.
- LUECKEN.md ist für genannte Punkte akkurat, nur §4/§6 zu optimistisch.
- `sample/` GUIs bewusst erhalten als Design-Basis, nicht an Produktion angeschlossen – `web/`+`app/` ist Produkt.

---

## 9. Empfohlene Reihenfolge (aus Prüfstand §7 aktualisiert)

1. **P1 Schreibpfad dicht:** Fill-Validierung + Nowcast statt 1.70, 4xx Status, compliance-Bedingung fürs Resolve, worth_it aus thresholds Config. ½ Tag + Tests.
2. **Ledger-Integrität:** Retention/Rotation 90d + `store_too_large` Fehler statt Silent-Reset, Schreibdrossel Snapshots (nur bei Wechsel oder ≥30min). ½ Tag.
3. **GUI-Kontingent:** Poll-Bündelung (z.B. `/v1/decide` liefert bereits alles, stations/route/evaluate/dayStrip können entfallen) oder eigener Key via Same-Origin Cookie, `Retry-After` korrekt (Tages-Reset), Bucket LRU. ½ Tag.
4. **Doku-Schnellkorrektur:** API.md `POST /v1/episodes` → `POST /v1/episodes/{id}/intent`, 501 → JSON, lat/lon Status klar als „offen“, ANALYSE.md Hampel als „offen“, LUECKEN §4.1-4.3 von „fertig“ auf „Regel fertig, Wahrscheinlichkeiten abweichend“. ¼ Tag.
5. **Alarm-Semantik:** `no prices` auf Tage (7×288 Polls oder Kalendertage) umstellen. ¼ Tag.
6. **P-Seite bauen (M5-M6 Projekt):** Bootstrap-Pfade im Worker speichern oder im Artefakt `forecasts[].draws` (z.B. 500×288) veröffentlichen → `p_besser` je Fall aus Verteilung, `p_lohnt` gemeinsame Ziehung über Stationen, `rolling_picp` je Station als Gate, F3 je Fenster ±6h Vergleich. Das ist der einzige Punkt, der Produktkern „Entscheidung mit Kalibrierungsangabe“ von netter Historienstatistik unterscheidet.

---

## 10. Fazit

- **Konzept → Engine:** M1+M2+12-Uhr+Bootstrap fertig, M3 bewusst zurückgestellt – sauber.
- **Konzept → API:** Breit umgesetzt (health, stations, series, forecast, last_forecasts, heatmap, selection, collector/status, route/evaluate, decide, episodes, stats/summary, day, heartbeat, jobs/trigger) + Schutz Rate-Limit/Deprecation, aber Schreibpfade und P-Seite abweichend.
- **Konzept → GUI:** Alltag/Werkstatt vollständig nach beiden Prototypen, PWA offline, Due-Prompt, Dual-Ledger getrennt – aber 2 erfundene Preise und Erfolgsmeldung bei fehlgeschlagenem POST.
- **Gesamturteil Prüfstand bleibt:** „bemerkenswert weit und bemerkenswert ehrlich, keine Demo-Preise in Live-Pfaden, substanzielle Probleme nicht Mock, sondern Wahrscheinlichkeiten ≠ Konzept, Schreibpfade unvalidiert, Betriebsmechanik Kontingent/Store.“

Nächster Schritt sollte P1-Fixes sein, danach bewusste Entscheidung ob P-Seite aus Verteilung (echtes M7) gebaut wird oder LUECKEN ehrlich auf „Regel fertig, P=Ledger-Quote“ gestellt wird.

> **Nachtrag 11.09.2026:** Die Entscheidung ist gefallen — die P-Seite wurde
> aus der Prognoseverteilung gebaut (§4.1–4.3: `p_besser`/`p_lohnt`/
> F3-Fenster-P aus veröffentlichten Draws). Offen bleibt nur die *gemeinsame*
> Ziehung über Stationen (§4.2); siehe [LUECKEN.md](../LUECKEN.md).
