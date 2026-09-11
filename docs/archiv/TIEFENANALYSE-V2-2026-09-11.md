# TankApp – V2 Analyse: Ist das Beschriebene auch *richtig* umgesetzt? Was fehlt unabhängig vom Konzept?

> **Archiviert — Tiefenanalyse V2 vom 11.09.2026 (Prüfstrang 2: Korrektheit +
> was unabhängig vom Konzept fehlt).** Befundstand vor App-Version 0.10.0; die
> abgeleiteten Aufgaben stehen in [../../TODO.md](../../TODO.md) (Abschnitte E–H).
> Archiv-Übersicht: [README.md](README.md).

> 2026-09-11 · Commit 440402e + Live-Code Review · Ergänzung zu `TIEFENANALYSE.md` + `Prüfstand.md`

**Kurzantwort:** Nein. Es fehlt nicht nur die im Konzept als „bewusst offen“ markierte P-Seite, sondern auch innerhalb des als „fertig“ markierten Teils ist einiges *falsch* bzw. unvollständig. Und unabhängig vom Konzept fehlen für einen echten 24/7-Produktbetrieb noch ganze Kategorien (Security/Multi-User/Privacy/Observability).

---

## 1. Engine – beschrieben vs. wirklich korrekt?

### Was korrekt ist (und gut)
- **Raster & FF:** `engine/data.py::prepare_series` 5-min Raster, FF ≤30min via `cfg.ffill_minutes`, Staleness-Maske `available`, `closed`/`no prices` stoppen FF – exakt Konzept §3.1 Schritt 1+2.
- **Status-Barriere:** `normalize_observations` behält defekte Preise als Barriere, `observed` vs `response_observed` getrennt, `status_known` Flag – verhindert dass Engine geschlossene Preise fittet.
- **M1 Struktur:** `models.py::features` 1.+2. Harmonische + DoW 1-6 + 12-Uhr Schritt `after_law & hour>=12` – Huber-IRLS 30 Runden, Skala 1.4826·MAD, Gewicht min(1,1.345·scale/|r|) – robust gegen Ausreißer. Trainingsfenster 42d, min 28d, `min_slot_days=7` Support-Gate.
- **M2 AR2:** `fit_ar2` nur über kontige Triple `sliding_window_view`, Shrink 0.9 bis Pole <0.98 – stabil bei Lücken, keine instabilen ARs.
- **12-Uhr Regel:** `isotonic_decreasing` PAVA L2-Projektion, vektorisiert `_segment_bounds` statt Timestamp-Boxing (8 Mio Boxing vorher), Median+alle Bootstrap-Pfade je [12:00,nächste 12:00) projiziert, NaN bleibt NaN, Segmente vor Gesetzesbeginn unverändert, `law_rise_outside_noon` ≥1ct gezählt – beste Stelle im Repo.
- **Bootstrap:** `exp_block_weights` Alter a: 0.5^(a/HW) normiert, `predict` zieht Tagesblöcke mit EW HW14d, B=2000, Quantile .025/.10/.50/.90/.975 – Issue 46 korrekt umgesetzt.
- **Backtest:** `backtest.py::run_backtest` past-only, shared cutoff `last_complete_day`, `scheduled` Filter Poll-Fenster, `observed` & `naive` gemeinsamer Support, `comparison_coverage_pct>=85`, `response_coverage_pct>=85`, `status_known` & `source==influxdb` Gate – kein Leakage, `decision_row` 08:00 Anker p08 letzter beobachteter Preis vor 08:00, Kurve ct vs Anker, `p=None` ehrlich null (kein erfundenes P-Modell). Pinball sym+asym τ=0.75 korrekt `pinball_loss`.
- **Selektion:** `selection.py` LOO-Baseline via sort+argsort, Median je Zeitpunkt ohne eigenen Preis (verhindert Self-Masking), `daily_median_series`, `weighted_median` mit Mittelung bei exakt 0.5, `exp_weights` HW7d für δ̂, `cusum_break` MAD aus Differenzen (Wechsel kontaminiert nur eine Diff), Schwelle h=2.0, BH-FDR `_benjamini_hochberg` korrekt `p*n/rank` + `minimum.accumulate`, AV-Score renormiert über endliche Stunden, Composite-Score 0.40·z(-level)+0.25·z(AV)+0.15·z(R²)-0.10·z(vol)-0.10·z(rank_std) – exakt Konzept §2, `n_boot=2000` fest (Gutachten F2 Blocker bei B=200 bereits gefixt).

### Was beschrieben, aber falsch / unvollständig
- **Hampel-Filter §3.1 Schritt3:** In `ANALYSE.md:139` als Aufbereitung gelistet, Code nirgends – offene API-Artefakte (z.B. 0.001€ Sprünge) können AR und Huber verzerren.
- **Feiertags-Dummy:** Konzept §3.2 X = DoW + gepoolter Feiertags-Dummy je BL (HE/BY/NW). `features()` hat nur Harmonik+DoW+12Uhr. Bei 0-1 Feiertag je 6-Wochen-Fenster wäre Dummy unidentifizierbar – Konzept fordert gepoolt über Kalenderjahr, fehlt komplett → Feiertage (z.B. Allerheiligen BY/NW, Dreikönig BY) werden als normale Tage gefittet.
- **Zeit-seit-letztem-Sprung Feature:** Konzept §3.2 X enthält Zeit seit Sprung – fehlt, M2 fängt nur Persistenz, nicht Sprung-Hazard.
- **M3 Zweitmodell + Ensemble:** `PENDING` Liste in `backtest.py` korrekt als offen markiert, aber LUECKEN.md führt §3 als „fertig (unkalibriert gekennzeichnet)“. Tatsächlich fehlt UCM/Holt-Winters + inverse-MASE Gewichte.
- **Rolling-PICP Badge §3.3.3:** 7-Tage Rolling-PICP je Station als Konfidenz-Badge grün/gelb/rot – existiert nur als Backtest-Aggregat `picp95_pct`, nicht live.
- **Backtest 21d Gate:** `refresh.py:244` fährt nur 7d, Kriterium `at_least_21_complete_test_days_per_station` kann aus Auto-Lauf nie erfüllt werden – nur manueller `python -m engine backtest --days 21`.
- **Mehrtage-Horizonte:** +3d/+7d Punkte werden gerechnet (`points_3d/7d`), aber Backtest dafür offen – keine Güte.
- **Preis-Zwillinge:** `compare-stations` existiert, aber keine automatische Warnung bei identischen Verläufen (nur optional).

### Korrektheits-Risiken (nicht nur „fehlt“)
- `seasonal_scale` MASE-Denominator nutzt `price.reindex(previous)` mit `previous = (local-1d).tz_localize(..., ambiguous=NaT)` – bei DST-Lücken NaT → Skala evtl. None → MASE undefiniert, korrekt als None markiert, aber im NAS-Job als „—“ angezeigt.
- `prepare_series` `group.drop_duplicates("available_at", keep="last")` – bei doppelten Events am selben Slot gewinnt letzte Zeile, korrekt (explicit live status wins), aber bei Legacy-History ohne Offset kann `parse_times` NaT liefern und Tag verloren gehen – gezählt als `invalid_or_ambiguous_timestamps`, aber nicht repariert.
- `exp_block_weights` bei n_blocks=0 → None → uniform, korrekt, aber bei sehr kurzer Historie (<10 Tage) `cusum_break` liefert False,0 – EW-Median dann trotzdem auf wenig Daten.

---

## 2. Backend – beschrieben vs. wirklich korrekt?

### Was korrekt ist
- **LiveData:** Bounded Cache 30s, re-evaluiert age bei jedem Request `currentPrice` via `performance.now()` nicht wall-clock, `age` 0-30min frisch + `status==open` + `price!=null`, `fresh_prices` Zähler, kein `last(price)` ohne Status, `read_json` size>10MB → default verhindert OOM, einzelne defekte Influx-Zeilen werden geskippt, nur wenn alle defekt → `influx_read_failed`, kein Token/Anker in Payload (`never-expose-me` Test).
- **Metadata:** `validate_sets`, Anchor privat, `driving_km` OSRM Cache `road_route_cache.json` mit Lock `_ROUTE_LOCK`, Fallback Luftlinie, `maps_url` nur wenn Koordinaten vorhanden, keine Anker-Koordinaten in public JSON.
- **Health:** `/health` nur lokale Quellen `build_collector_status(allow_influx=False)` damit Docker HEALTHCHECK 3-5s nicht an Influx hängt – volle Details in `/collector/status`.
- **Collector-Status:** Quellen-Reihenfolge Influx → `runtime/collector/heartbeat.json` → lokal `meta/heartbeat.json`, `fresh` ≤15min, tmpfs via `disk_usage`, älteste Datei via `stat().st_mtime`, atomar tmp+rename.
- **Jobs:** `Scheduler` Wake-Event + Watermark, Debounce 15min/1h, Idempotenz `data_watermark` in `jobs/<name>.json`, `triggers`/`last_trigger_skip`, atomare Veröffentlichung `write_json` + alte Artefakte bleiben bei Fehler, `progress.py` Phasen Schritt x/y pct eta_s, Log 500 Zeilen + Journal.
- **Settlement:** `_realized_min` billigster beobachteter offener Preis im Fenster + Slack -30/+60, `pending` wenn Fenster+Lag nicht vorüber, `void` Gründe `no_advice/no_emit_price/legacy_no_window/beyond_series_range/no_alt_station/no_realized_price`, Theta 1ct, liters fallback, `regret_eur` nur bei loss, Job alle 30min.
- **Rate-Limit:** Fingerprint SHA256[:16], `hmac.compare_digest` für Webhook + Keys, `X-RateLimit-*` Header, 429 + `Retry-After`, anon 60/min keyed 300/min.
- **Server:** `SimpleHTTPRequestHandler` Threading, `nosniff`, `no-referrer`, `no-store`, CSP `default-src self`, Pfad-Traversal blockiert `part.startswith(".")` + `\x00` + `is_relative_to`, `allow_nan=False`, keine Secrets in Antwort/Log.

### Was beschrieben, aber falsch
- **Fill-Endpunkt:** `record_fill` `liters=float(...40.0)` `price_paid=float(...1.70)` – Default erfindet Preis, keine Range, keine Station-Existenz, keine Fuel-Check, keine `tanked_at` Zukunfts-Check, fängt Exception → 200 mit `error_code` statt 4xx. Konzept §11.2 verlangt Nowcast bei fehlendem `price_paid`.
- **Episode-Schluss:** Jeder Fill `resolved` auch bei `compliance=unrelated` – killt Due-Prompt und M7-n. Sollte nur `followed/partial` (evtl `ignored` an Emit-Station) schließen.
- **Route worth_it Hardcode:** `route.py:340` `net>=1.5` statt `active_thresholds()["elsewhere_net_eur"]` – divergiert bei `M7_AUTO_APPLY=1`.
- **Feedback-Store:** `read_json` >10MB → default → leere Episoden, danach `locked_store` schreibt zurück → Historie weg ohne Fehler. Keine Retention, Snapshot bei jedem `/decide` alle 30s → wächst schnell. `trip_mode`+`latest_by` in `snapshot_input` aber nicht in fester Feldliste → verloren.
- **Brier/30d Labels:** `compute_advice_stats` filtert nie nach Zeit, nennt aber `brier_30d`, `decide.py` tauscht in `last_30d_hits` – Allzeit statt 30d. Gate `calibrated = n>=100 and brier<0.25` vergleicht Gesamt n mit n_brier.
- **Rate-Limit Tagesbudget:** GUI 10.2 Req/min → 14.7k/Tag > 10k anon, `Retry-After` minutes-based suggeriert 60s, braucht 24h, kein Eviction LRU, Key für eigene GUI unerreichbar.
- **Collector Alarm:** 7 Polls =35min statt 7 Tage `collect_prices.py:611-616`.
- **API Doku:** `POST /api/v1/episodes` dokumentiert aber 501, 501 HTML statt JSON, `lat/lon` Pflicht still ignoriert.
- **Cache-Control:** `no-store` auf allen Antworten auch Vite-Assets mit Hash – bricht Asset-Caching, schadet Lighthouse.
- **Preflight:** Stationszahl zählt JSON-Keys nicht Stationen.

### Korrektheits-Risiken
- `locked_store` 50 Versuche ×0.05s =2.5s mit File-Lock `collector_lock` – bei NAS HDD Sleep kann Lock länger dauern → `ValueError` nach 50 Versuchen, dann 503.
- `metadata` `driving_km` mit `TANKAPP_OSRM=0` → Luftlinie, aber `dist_mode` bleibt „air“ – UI zeigt „Luftlinie“ korrekt, aber `route/evaluate` derived vs derived_anchor Logik unterscheidet nicht zwischen „kein OSRM“ und „keine Koordinaten“.
- `decide.py` Anker fallback Frankfurt hardcodiert bei fehlender city – Settlement rechnet gegen falsche Stadt still.

---

## 3. GUI – beschrieben vs. wirklich korrekt?

### Was korrekt ist
- **Alltag:** Ampelkarte `primary.action`, `reason_short`, `p_correct`, Badge, `alternatives_nearby` sortiert nach `net_eur`, `windows_today` 2h-Blöcke echte ISO, `windows_week` Top3 Tage, Tagesstreifen 06-24 mit `berlinHour` (Intl.DateTimeFormat Europe/Berlin, nicht Browser TZ), `currentPrice` guard online+fresh+open+age≤30+finite, `segments` schließt Lücken bei closed/missing, hält letzten offenen Preis als Treppenstufe, `gapBands` + `compressedAxis` staucht Nachtlücken auf max 40min, `detourEconomics` K=d(c/100)p+(d/v)z mit mode dedicated doppelt, `autoTimeValue` Peak 16:30-20:00 16€/h sonst 10€/h, `berlinHour` DST-sicher, `useResource` AbortController 20s Timeout + `no-store`, `usePreference` localStorage mit valid-Check, Offline-Banner `navigator.onLine`, Datenstand `clockLabel`, PWA `manifest.json` + `sw.js` SWR 30min, Register nur Prod nicht WebDriver.
- **Werkstatt:** 1 Regel+ε-Slider Was-wäre-wenn (Produktion bleibt kalibrierte Tabelle), 2 Scoreboard out-of-sample 08:00 Zeilen `rowOutcome`/`scoreRows` Formeln server-spiegel, 3 Kalibrierung `CalibChart` + Live-Punkte ab n≥20, 4 Stations-Labor Tag-Chips `wait` grün `now` rot, Tageskurve ct vs Anker + Histogramm Saves mit μ/ε Markern, 5 Heatmaps `HeatmapGrid` Level/Probability, 6 Meine Stationen δ̂ Tabelle mit KI/q/AV/best_hour, 7 System Jobs + Fortschritt Balken ETA + Trigger-Watermark, 8 Pi/tmpfs Livestatus, 9 API-Explorer.
- **Tests:** `data.test.ts` 26 Unit-Tests (fresh guard, segments, gapBands, compressedAxis, haversine, autoTicks), `e2e/app.spec.ts` honest setup + city/fuel never mix + closures never win, `horizons.spec.ts` (vermutlich 24h/3d/7d Tabs).

### Was beschrieben, aber falsch
- **Erfundene Preise:** `Dashboard.tsx:548 useState(1.689)` Vorbelegung + `1273 ~{euro(bestPrice||1.649,3)}` verspricht 1,649€ wenn kein Preis bekannt, danach „Kein Preis bekannt“ – Verstoß §0.4 „fehlende als fehlend zeigen“.
- **Erfolgsmeldung bei Fehler:** `postIntent`/`postFill` catch → `error_code: request_failed`, Aufrufer setzen trotzdem „✓ Füllung verbucht!“ – bei 429/offline glaubt Nutzer Beleg gespeichert.
- **Detour-Faktor Mismatch:** `decide._alternatives` Luftlinie×1.3 `CIRCUITY`, GUI `detourEconomics` ×1.0, schiebt dann ×1.0 als `detour_km` in Server-Check – Server rechnet ×1.0 vs ×1.3 unterschiedlich, netto 30% zu optimistisch.
- **Sortierung Meine Stationen:** Konzept §2/§8.2 Nr.7 verlangt nach Empfehlungsstärke (F2-Netto jetzt), geliefert nach statistischem Score – für Werkstatt ok, aber Konzept nicht erfüllt.
- **M4 Kriterien:** „≤3 primäre Zahlen“ gestalterisch erreicht, aber nirgends gemessen, Lighthouse >90 kein CI-Job.
- **Paarvergleich:** Als eigene Werkstatt-Sektion beschrieben, lebt nur als Alltags-Panel + Server-Endpunkt – in LUECKEN als „teilweise“ korrekt vermerkt.
- **Brier/30d Labels:** GUI zeigt „Brier-Score 30d: 0.14“ obwohl Allzeit.

### Korrektheits-Risiken
- `LineChart` SVG bei 7 Tagen ≈2000 Punkte: Linie vollständig, Punkte/Hitflächen ausgedünnt `step=ceil(total/800)` – gut, aber Tooltip `xFmt` default Berlin, bei `xDomain` festem Fenster werden Ticks in Lücken gefiltert `insideGap` – kann bei gestauchter Achse Ticks verlieren.
- `useResource` `receivedAt=performance.now()` monoton, `elapsed=(now-receivedAt)/60000` – korrekt gegen Browser-Uhr, aber `performance.now()` reset bei Reload → `elapsed` nach Reload 0 obwohl Daten alt – `currentPrice` prüft zusätzlich `age_minutes` aus Server, also ok, aber `fresh` Badge kurz falsch grün.
- `handleConfirmRecommendedFill` nutzt `expected_price ?? price_now ?? bestPrice` – wenn `expected_price` null (kein Fenster) aber `price_now` vorhanden, wird `price_now` als `price_paid` gebucht – fälschlich als Ersparnis vs immer-sofort.

---

## 4. Unabhängig vom Beschriebenen – was fehlt für echten Produktbetrieb?

### Security & Privacy
- **Keine Nutzer-Isolation:** Fills/Intents/Episodes liegen in einer Datei `runtime/feedback/store.json` ohne User-ID – zweiter Handy-Tab / zweiter Nutzer schreibt ins selbe Wallet, selbe Episode, selbes M7-Gate. Keine Auth, kein `X-Api-Key` für POST, keine CSRF.
- **Kein Input-Hardening:** `station_name` aus Fill wird ohne Escaping in JSON gespeichert und im Dashboard gerendert – potentiell XSS wenn jemand `station_name: "<img onerror=...>"` postet (React escaped, aber `last_fill` etc. als any). `tanked_at` Zukunft / Vergangenheit ohne Limit (z.B. 1970 oder 2100) – verzerrt w(h) Profil.
- **Keine Verschlüsselung at-rest:** Feedback-Store enthält persönliche Tankhistorie unverschlüsselt auf NAS.
- **Keine DSGVO:** `lat/lon` Anker privat, aber `home_lat/home_lon` Query-Param wird in `context.home_used` geloggt (nur bool), jedoch `snapshot_input.latest_by` enthält Deadline – personenbezogen, kein Löschkonzept, keine Retention.
- **Rate-Limit nur IP + Key:** Kein Limit für POST `/fills`/`/intent` pro IP – anonym kann Ledger fluten (DoS + Bilanz fälschen).

### Zuverlässigkeit & Betrieb
- **Kein Backup/Restore Feedback:** Pi-Backup-Snippet in BETRIEB.md sichert nur `apikey.txt`+`polling.json`+Units, nicht `runtime/feedback/store.json` – persönliche Bilanz geht bei NAS-Disk-Crash verloren.
- **Kein Schema-Migration:** Feedback-Store `store.json` hat kein `schema_version` – bei Feldänderung (z.B. `trip_mode` künftig) brechen alte Stores.
- **Kein Monitoring/Alerting:** Collector-Status vorhanden, aber kein externer Watchdog (Uptime-Kuma erwähnt, nicht eingerichtet), kein ntfy/Telegram bei `no prices` >7d, `collector_no_heartbeat`, `job_failed`, `store_too_large`.
- **Kein Disk-Full Handling:** `write_json` atomar via tmp+rename, aber bei voller Disk bleibt alter Stand erhalten – kein Alarm, GUI zeigt alten Stand als aktuell.
- **Kein Retry für Webhook:** Uploader `POST /jobs/trigger` Fire-and-Forget, bei NAS kurz offline geht Watermark verloren – läuft dann nur intervallbasiert, aber ohne Hinweis.

### Datenqualität & Drift
- **Kein CUSUM Alarm in API:** `break_flag`/`break_stat` in Selektion vorhanden, aber nicht in `/health` oder `/selection` als Alarm – Betreiberwechsel bleibt manuelle Prüfung.
- **Kein Station-Lifecycle:** `no prices` nach 7 Tagen Alarm geplant, aber 35min Bug + kein automatisches Deaktivieren – tote Stationen bleiben im Polling-Set und kosten Kontingent.
- **Kein Fuel-Verfügbarkeit:** Wenn Station E10 nicht führt (`false`), wird kein Punkt geschrieben – korrekt, aber GUI zeigt dann „Kein Kraftstoffpreis“ ohne Hinweis „führt E10 nicht“ vs „temporär geschlossen“.

### UX & Produkt
- **Keine Kartenansicht:** Nur Liste + Entfernung km, keine OSM/Leaflet Karte – für F2 „Hier oder woanders?“ wäre Karte mit Netto-€ Pin erwartet.
- **Keine Suche/Filter:** Kein Brand-Filter, kein Name-Suche, kein Sort nach Distanz/Preis/Netto – bei 20+ Stationen unübersichtlich.
- **Keine Favoriten/Meine Stationen Alltag:** „Meine Stationen“ nur Werkstatt, Alltag zeigt günstigste frische – Nutzer will aber 2-3 Stamm-Stationen pinnen.
- **Kein Onboarding:** Ersteinrichtung zeigt „Noch kein frischer Preis“ + „Polling-Set fehlt“ – aber kein Wizard für `polling.json` Upload oder Key-Check.
- **Keine Barrierefreiheit:** `aria-pressed` vorhanden, aber Charts `role=img` ohne `aria-describedby`, Slider ohne `aria-valuetext` €-Wert.
- **Kein Dark/Light Toggle:** RP2 Fallback hat Dark-Mode, NAS-GUI nur dunkles Slate – Konzept erwähnt nicht, aber Nutzer erwartet.
- **Kein Export/Share:** Keine CSV-Export Preise, keine Share-URL für Empfehlung (z.B. `?city=...&station_id=...&liters=...`).

### Performance & Skalierung
- **Keine Pagination/Virtualisierung:** `stations` 20 Stationen ok, aber bei 100+ (Frankfurt 25km Radius 100+ Stationen) Liste + Tabelle ohne Virtualisierung → DOM groß.
- **Kein API Caching:** `no-store` überall, auch für `heatmap` 6 Wochen 200k Punkte – jedes Tab-Wechsel lädt neu, obwohl 2h Cache ok wäre.
- **Kein Kompression:** `json.dumps` ohne gzip, kein `Content-Encoding` – bei `last_forecasts` 20×288 Punkte ~50kB → ok, aber `heatmap` Matrix 7×24 + points 200k → groß.
- **Kein Worker-Pool Limit:** `TANKAPP_MODEL_WORKERS` max 8, aber `shm_size:256m` in compose – bei 8 Prozessen + pandas 3.0 kann shm knapp werden.

### Tests & CI
- **Kein e2e für B4:** `app.spec.ts`/`horizons.spec.ts` mocken nur `stations`/`series`/`forecast`, nicht `decide`/`fills`/`intent`/Due-Prompt – kritische Flows ungetestet.
- **Kein Load-Test:** Rate-Limiter 10k/Tag, aber kein Test ob GUI 14.7k/Tag wirklich 429 triggert.
- **Kein Property-Test:** Detour-Formel `K=d(c/100)p+(d/v)z` nicht mit Hypothesis getestet (z.B. `worth_it` monoton in `liters`).
- **Kein Lighthouse CI:** M4 Kriterium >90 nicht gemessen.

---

## 5. Fazit V2

- **Beschrieben & korrekt:** Collector/Uploader/Influx/Archiv, M1+M2+12-Uhr+PAVA+EW-Bootstrap+Backtest past-only+Selektion δ̂/B=2000/BH/AV/harm., Alltag/Werkstatt Tabs, Fan/Heatmaps/Selection/Collector/Route, Event-Pipeline Webhook Debounce/Idempotenz, Ehrlichkeits-Gate `calibrated=false`.
- **Beschrieben, aber falsch:** P_besser/P_lohnt aus Verteilung fehlt (Ledger-Quote), `worth_it` Hardcode, Fill 1.70€ Default, Episode-Schluss `unrelated`, `trip_mode`/`latest_by` Verlust, Brier 30d Label, Store >10MB Silent-Reset, no-prices 35min, `lat/lon` ignoriert, 501 HTML, Cache-Control Assets, Preflight Zählung, GUI 1.689/1.649 erfundene Preise + Erfolgsmeldung bei Fehler + Detour Faktor Mismatch.
- **Unabhängig fehlend:** Nutzer-Isolation/Auth für POST, XSS/Injection Hardening, Backup/Retention/Migration Feedback, Monitoring/Alerting, Kartenansicht, Suche/Favoriten/Onboarding/A11y/Export, Pagination/Caching/Kompression, e2e für B4 + Load + Lighthouse.

**Empfehlung:** Erst P1 dicht (Fill-Validierung + Nowcast, Episode-Schluss, worth_it Config, no-prices Tage, Store Retention + Fehler statt Default, Rate-Limit Tagesbudget + LRU), dann entscheiden ob P-Seite aus Verteilung gebaut wird (echtes M7) oder Doku ehrlich auf „P=Ledger-Quote“ gestellt wird – sonst bleibt Produktkern „82% sicher“ eine Historien-Quote, nicht die versprochene Prognose-Wahrscheinlichkeit.
