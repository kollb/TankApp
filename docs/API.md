# TankApp API — Endpunkte & Spezifikation

> Stand: 10.09.2026 — B3 & B4 Endpunkte + Ereignis-Pipeline (`POST /api/v1/jobs/trigger`, Issue 50) enthalten, serverseitig, keine Demo-Fallbacks.

## Inhaltsverzeichnis

- [Auth & Limits](#auth--limits)
- [Übersicht](#übersicht)
- [Decide (B4 Primär)](#decide-b4-primär)
- [Episodes & Intent (B4)](#episodes--intent-b4)
- [Fills (B4 Belege)](#fills-b4-belege)
- [Stats Summary (B4 3 Schichten)](#stats-summary-b4-3-schichten)
- [Health](#health)
- [Stations](#stations)
- [Series](#series)
- [Forecast](#forecast)
- [Last Forecasts (RP2)](#last-forecasts-rp2)
- [Heatmap (B3.9)](#heatmap-b39)
- [Selection / Meine Stationen (B3.10)](#selection--meine-stationen-b310)
- [Collector Status (B3.11)](#collector-status-b311)
- [Collector Heartbeat (POST, B3.11)](#collector-heartbeat-post-b311)
- [Jobs Trigger (POST, Issue 50)](#jobs-trigger-post-issue-50)
- [Route Evaluate (B3.12)](#route-evaluate-b312)
- [Deprecation alter Alltags-Routen (B5)](#deprecation-alter-alltags-routen-b5-konzept-113)
- [Fehlercodes](#fehlercodes)
- [Beispiele](#beispiele)

## Auth & Limits

- Anonym: 60/min, 10 000/Tag
- Header `X-Api-Key`: 300/min, 50 000/Tag

Der Zähler läuft **in der App** (Konzept §11): jede Antwort trägt
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` und
`X-RateLimit-Policy` (`anon` | `keyed`). Bei Überschreitung: `429` mit
`Retry-After` und `{"error_code": "rate_limited"}`. Grenzen je Deployment
konfigurierbar über `TANKAPP_RATE_ANON_PER_MIN` (Default 60),
`TANKAPP_RATE_KEY_PER_MIN` (300), `TANKAPP_RATE_ANON_PER_DAY` (10 000),
`TANKAPP_RATE_KEY_PER_DAY` (50 000). Schlüssel kommen ausschließlich aus
`TANKAPP_API_KEYS` (kommagetrennt) — nie ins Image, nie ins Repo.
- JSON/UTF-8, Zeiten Europe/Berlin angezeigt, UTC gespeichert, `Cache-Control: no-store`
- Schreib-Endpunkte:
  - `POST /api/v1/collector/heartbeat` (Collector-Herzschlag, B3.11)
  - `POST /api/v1/jobs/trigger` (Uploader-Webhook, Issue 50; nur mit konfiguriertem `TANKAPP_WEBHOOK_TOKEN`, Auth per `Authorization: Bearer <Token>`)
  - `POST /api/v1/episodes/{episode_id}/intent` (Nutzer-Intent setzen, B4) bzw. `POST /api/v1/recommendations/{id}/outcome` (Alias, schreibt ein Fill gegen den letzten Snapshot)
  - `POST /api/v1/fills` (Persönliche Tankbelege für Wallet-Ledger, B4)
- Nicht implementierte Schreib-Endpunkte → `501` mit JSON `{"error_code": "not_implemented"}` (außer RP2 Fallback lokal)

## Übersicht

| Endpunkt | Neu | Aufgabe |
|---|---|---|
| `GET /api/v1/decide?city=...&fuel=...&liters=40` | **B4** | Handlungsempfehlung + 3-Wege-Vergleich + Snapshot-Emission |
| `GET /api/v1/episodes?status=due` | **B4** | Offene / fällige Episoden für Due-Prompts |
| `POST /api/v1/episodes/{episode_id}/intent` | **B4** | Nutzer-Intent setzen (`wait`, `navigate`, `dismiss`) |
| `POST /api/v1/fills` | **B4** | Echten Tankbeleg erfassen (Wallet-Ledger) |
| `GET /api/v1/stats/summary?city=...&fuel=...` | **B4** | 3 Schichten (Markt-Labor, Live-Advice, Wallet) + Güte-Kacheln |
| `GET /api/v1/health` | erweitert | App online, Jobs (inkl. `settlement`), Archiv, Modelle, Selektion, Collector |
| `GET /api/v1/stations?fuel=e10&city=...` |  | Aktuelle Preise, frisch ≤30 Min |
| `GET /api/v1/series?city=...&station_id=...&fuel=...&hours=24` |  | Verlauf 1–168h |
| `GET /api/v1/forecast?city=...&station_id=...&fuel=...` |  | Modell-Ausblick 24h + 3d/7d |
| `GET /api/v1/last_forecasts` |  | Für RP2-Cache, nur 24h Horizonte |
| `GET /api/v1/heatmap?city=...&fuel=...&kind=...&weeks=6&station_id=...` | **B3.9** | DoW×Stunde Niveau + Cheap-Prob |
| `GET /api/v1/selection?fuel=...&city=...` | **B3.10** | Meine Stationen mit δ̂ |
| `GET /api/v1/collector/status` | **B3.11** | Pi/tmpfs Livestatus (Influx → NAS-File → lokal) |
| `POST /api/v1/collector/heartbeat` | **B3.11** | Collector-Herzschlag ans NAS (ohne InfluxDB) |
| `POST /api/v1/jobs/trigger` | **Issue 50** | Uploader-Webhook: Inferenz-Job nach sicherem InfluxDB-Write (Debounce + Idempotenz) |
| `GET /api/v1/jobs/{job}/log?lines=200` | **B6** | Letzte Zeilen von `runtime/jobs/{job}.log` — dieselbe Datei wie `tail -f` auf dem NAS |
| `POST /api/v1/jobs/{job}/run` | **B6** | Startknopf des GUI: Job jetzt ausführen (ohne Passwort; nur bei laufendem Job-Betrieb, abschaltbar per `TANKAPP_GUI_JOB_START=0`) |
| `GET /api/v1/route/evaluate?...` | **B3.12** | Umweg-Ökonomie serverseitig |

## Decide (B4 Primär)

`GET /api/v1/decide?city=Frankfurt&fuel=e10&liters=40&value_of_time=12` (auch als `/v1/decide` erreichbar)

Parameter (Ergänzung zu B4, Konzept §11.1):

| Parameter | Bedeutung |
|---|---|
| `latest_by` | ISO-Zeit (naiv = Europe/Berlin); spätester akzeptabler Tankzeitpunkt. Fenster (`windows_today`/`windows_week`) und die F1-Entscheidung enden spätestens hier (§4.1 H, §4.3 T_max). Unlesbar → `400 invalid_latest_by`. |
| `mode` | `onroute` (Default, nur Mehrweg gegenüber der Vergleichsstation) oder `dedicated` (Extrafahrt ab Zuhause: Hin + Rück, §10) |
| `home_lat`, `home_lon` | Heimatkoordinate für `mode=dedicated`; ohne Angabe nutzt die App die Ankerdistanz aus dem Polling-Set. Ungültig → `400 invalid_home`. |
| `value_of_time`, `consumption`, `speed` | wie B4; der verwendete Zeitwert steht in `context` |

Antwort (Ergänzung): `context` enthält `trip_mode`, `home_used`, `latest_by`,
`horizon_cut`, `liters`, `consumption_l_100km`, `speed_kmh`,
`value_of_time_eur_h`, `z_auto`, `is_peak`. `thresholds` zeigt die aktiven
Entscheidungsschwellen und den M7-Vorschlag (siehe
[Stats Summary](#stats-summary-b4-3-schichten)). Liegt kein Fenster mehr vor
`latest_by`, lautet die Aktion `no_advice` mit dem Hinweis auf den
spätesten Tankzeitpunkt.

Ermittelt die primäre Handlungsempfehlung nach der €/P-Entscheidungstabelle (Konzept §4.1/§4.2/§4.4, Auswertungsreihenfolge §4.5: F2 → F1 → Grauzone):
- `refuel_now`: Warten brächte < 1,00 € Ersparnis, oder P(Warten) < 50 %
- `wait`: Fenster-Ersparnis ≥ 2 € bei P ≥ 70 % (grün) bzw. ≥ 1 € bei P ≥ 60 % (gelb)
- `refuel_elsewhere`: Alternative spart netto ≥ 1,50 € trotz Umweg (P ≥ 50 %)
- `no_advice`: kein Ankerpreis, keine Prognose, Grauzone P ∈ [40, 60] % — oder M7-Gate steht aus

M7-Gate (§0.4): Vor der Kalibrierung (n < 100 oder Brier ≥ 0,25) antwortet `primary.action` immer mit `no_advice` und `p_correct: null`. Der Advice-Ledger misst die Tabellen-Aktion trotzdem ab Tag 1 (Shadow-Betrieb mit interner, Laplace-geglätteter P-Schätzung), damit sich das Gate je öffnen kann.

Ehrlichkeits-Regeln: Ohne frischen/letzten Preis ist `station.price_now` null (kein erfundener Anker, keine Ersparnis-Rechnung). Ohne Prognose sind `windows_today` leer und `recommended_window` null (kein erfundenes Fenster). Fenstergrenzen sind echte Prognose-Zeitstempel (ISO) aus 2-h-Blöcken; `windows_week` enthält je Kalendertag den billigsten Punkt (Top 3). Alternativen nutzen die Luftlinie zwischen den Stationskoordinaten × 1,3 (`detour_mode: haversine`, Fallback `anchor_diff`).

Emittiert automatisch einen Advice-Snapshot im Persistent Store (mit 30-Minuten-Collapse zur Vermeidung von Dubletten). Das Settlement erfolgt durch den Worker-Job gegen *beobachtete* Preise nach Fensterende + 30 min Lag; ohne beobachtete Preise bleibt der Snapshot `pending`, nicht bewertbare Snapshots werden `void` (zählen weder zu n noch zu Brier).

## Episodes & Intent (B4)

`GET /api/v1/episodes?status=due`

Liefert fällige Episoden nach Fensterende für den Due-Prompt Banner in der GUI.

`POST /api/v1/episodes/{episode_id}/intent`

Setzt die Nutzer-Absicht (`wait` | `navigate` | `refuel_now` | `dismiss`):
```json
{
  "intent": "wait"
}
```

Unbekannte Episoden-IDs liefern strikt `404 episode_not_found` (kein stilles Umschreiben einer anderen Episode).

## Fills (B4 Belege)

`POST /api/v1/fills`

Erfasst einen echten Tankbeleg im persönlichen Wallet-Ledger:
```json
{
  "station_id": "uuid",
  "station_name": "Aral Hauptstr.",
  "liters": 40.0,
  "price_paid": 1.689,
  "fuel": "e10",
  "source": "prompt",
  "episode_id": "ep_123456"
}
```

Der Endpunkt **validiert** (§11.2): `liters` 5–100, `price_paid` 0,40–5,00 €/L,
`fuel` ∈ {e10, e5, diesel}, `station_id` ∈ Polling-Set. Fehlt `price_paid`,
wird der Nowcast-Preis der Station zur Tankzeit gesucht; ohne bestimmbaren
Preis antwortet der Server `400 price_not_available` — es wird **kein**
erfundener Default-Preis verbucht. Fehler kommen als 4xx/503
(`invalid_liters`/`invalid_price`/`invalid_fuel`/`price_not_available` → 400,
`unknown_station` → 404, `store_too_large` → 503), nicht mehr als
`200 {"error_code": …}`.

Ermittelt automatisch den Compliance-Grad (`followed`, `partial`, `ignored`, `unrelated`) per Zeitstempel-Matching (`tanked_at` vs. Emit-/Fensterzeiten mit 45-min- bzw. −30/+60-min-Slack) und die realisierte Ersparnis im Vergleich zu sofortigem Tanken. Die offene Advice-Folge wird nur durch einen Beleg geschlossen, der die Empfehlung betrifft (`followed`/`partial` bzw. `ignored` an der Emit-Station) — ein fachlich fremder Beleg beendet die Folge nicht.

## Stats Summary (B4 3 Schichten)

`GET /api/v1/stats/summary?city=Frankfurt&fuel=e10` (auch als `/v1/stats/summary` erreichbar)

Liefert die 3 strikt getrennten Schichten gemäß Konzept §5.5:
1. **Schicht A (Markt-Labor Backtest)**: 7 Tage Out-of-Sample Evaluation (`daysEval` aus der Engine-Publikation, `daysTrain` dito) mit echten 08:00-Entscheidungszeilen je Stationstag (`evalRows`: μ/s/best/predHour + Erwartungskurve, Anker = letzter Preis ≤ 08:00, Wahrheit = realisierte offene Preise). Server-Scores spiegeln exakt die Frontend-Formeln (`rowOutcome`/`scoreRows`, Default ε = 1,0 ct, 40 L). `p` ist null, solange die Engine kein P-Modell hat; `calibration`/`models`/`p8Series`/`scan` sind ehrlich leer.
2. **Schicht B (Live-Advice Ledger)**: Gesettelte Live-Snapshots mit Trefferquoten für Warten/Jetzt, Brier-Score (30d, nur über Snapshots mit gespeicherter P-Schätzung) und Kalibrierungs-Bins. `void`-Settlements zählen weder zu n noch zu Brier (`n_void`, `n_brier` werden ausgewiesen). Das M7-Gate ist ein **Zähl-Gate** (§0.4): `calibrated` gilt ab `min_recommendations` (= 100, `app.feedback.M7_MIN_RECOMMENDATIONS`) abgeschlossenen Empfehlungen und `brier_30d` < `brier_threshold` (= 0,25, `M7_BRIER_THRESHOLD`); beide Schwellen werden mitgeliefert, damit die GUI keinen eigenen Nenner erfindet. `gate_status` unterscheidet „steht aus (n < 100)“, „nicht messbar“ (n reicht, aber kein Snapshot trägt eine P-Schätzung), „nicht erreicht“ (Brier ≥ Schwelle) und „kalibriert“. Die 90-Tage-Übergangsregel (Punkt 6) ist **kein** Bestandteil dieses Gates.
3. **Schicht C (Wallet Ledger)**: Persönliche Füllungen, Befolgungsgrad und Netto-Ersparnis.
4. **M7-Schwellen-Nachzug** (Konzept §5.5 Schicht B Schritt 4, §13 M7): `threshold_tuning` liefert `targets` (Trefferquote WARTEN 70 %, JETZT 85 %, WOANDERS 60 %), die `sample`-Größen je Aktion, `reasons` und den `thresholds`-Vorschlag; `thresholds` sind die **aktiven** Schwellen der Entscheidungstabelle. Nachgezogen wird erst ab `min_n` = 25 ausgespielten Empfehlungen je Aktion; wirksam wird der Vorschlag nur mit `TANKAPP_M7_AUTO_APPLY=1` (Default aus — die Produktion entscheidet weiterhin mit der kalibrierten Tabelle, §8.2 Nr. 1).
5. **Güte-Kacheln**: Nur `picp_95` ist echt (Median aus der Engine-Publikation). `top3_hit_rate`, `mase_sprungfrei` und `cusum_drift` sind null/`unknown` (Konzept §6, offen) — die Gesamt-MASE als „sprungfrei“ zu etikettieren wäre Etikettenschwindel.
6. **`live_phase` (bewertete Live-Tage der Übergangsregel)**: gezählt aus den publizierten Bootstrap-Policies (`runtime/engine/current.json` → `policies`), nicht aus dem Browserdatum: `good_complete_days` (schwächste Station/Kraftstoff), `best_complete_days`, `required_complete_days` (Engine-Schwelle `live_only_days`, Default 90), `days_missing`, `min_daily_coverage`, `stations`, `live_only_stations`, `as_of` (Datenstand des Modell-Laufs), `complete`. Ohne Veröffentlichung oder bei uneinheitlichen Schwellen ist das Feld `null` — die GUI zeigt dann „noch keine Live-Abdeckungsdaten“ statt eines erfundenen Countdowns (§0.4). Achtung: Die Tageszahl ist die Übergangsregel (Archiv → Polling), **nicht** das M7-Gate; dieses bleibt „Brier < 0,25 bei ≥ 100 abgeschlossenen Empfehlungen“ (Punkt 2). Beide Freigaben haben deshalb in der GUI eigene Kacheln und eigene Nenner: `live_only_days` (Engine-Schwelle, `engine/cli.py --live-only-days`, Default 90) für die Datenhygiene, `min_recommendations` für M7 — bei ~1 Empfehlung/Tag wären 100 Settlements ~100 Tage, M7 soll aber nach ~4 Wochen Live-Betrieb schaltbar sein (Konzept §13). Das Stationsdetail `data_policy` je Prognose (`GET /api/v1/forecast`) bleibt unverändert.


## Health

`GET /api/v1/health`

Antwort:

```json
{
  "app": "online",
  "generated_at": "2026-09-10T14:00:00+02:00",
  "polling_error": null,
  "station_count": 20,
  "influx_configured": true,
  "archive_configured": true,
  "jobs_enabled": true,
  "archive": {"archive_since": "2025-09-09", "last_complete_until": "2026-09-09", "missing_files": 0, "status": "complete"},
  "jobs": {
    "archive": {"state": "success", "last_success_at": "...", "next_run_at": "..."},
    "models": {"state": "success", "last_success_at": "...", "next_run_at": "...", "data_watermark": "1757584800", "triggers": 12, "last_trigger_skip": "debounced"},
    "selection": {"state": "success", ...}
  },
  "models": {"published_at": "...", "count": 20, "calibrated": false, "decision_ready": false},
  "selection": {"published_at": "...", "count": 20},
  "collector": {
    "available": true,
    "source": "nas",
    "last_poll_at": "2026-09-10T14:12:03+02:00",
    "age_minutes": 2.5,
    "fresh": true,
    "tmpfs_used_bytes": 1234567,
    "tmpfs_total_bytes": 33554432,
    "oldest_age_days": 6.2,
    "influx": {"available": false, "error_code": "influx_not_queried"}
  }
}
```

**Job-Fortschritt** (B5): Läuft ein Job (`state: "running"`), liefert
`progress` Phase, Schritt `x/y`, aktuelles Label, Prozent, Laufzeit und
Restschätzung — der System-Tab zeigt daraus Balken und Text. Nach dem Lauf
(oder ohne Lebenszeichen seit 6 h) ist `progress` wieder `null`, damit die
GUI kein „Läuft …“ konserviert.

```json
{"state": "running", "phase": "fit", "phase_label": "Modelle fitten + Backtest",
 "step": 7, "total": 22, "label": "Frankfurt – Aral Hauptstr.", "pct": 31.8,
 "elapsed_s": 421.5, "eta_s": 902.0, "updated_at": "2026-09-10T15:02:11+00:00"}
```

Job-Felder: `data_watermark` = Datenstand (Epochensekunden) des letzten erfolgreichen Webhook-Triggerlaufs, `null` solange kein Webhook eingetroffen ist (Issue 50, Idempotenz-Anker); `triggers` / `last_trigger_skip` = Webhook-Trigger-Statistik des laufenden App-Prozesses (nur `models`/`selection`, siehe [Jobs Trigger](#jobs-trigger-post-issue-50)).

Collector frisch = Herzschlag ≤15 Min. **Wichtig:** `/health` evaluiert den Collector nur aus lokalen Quellen (NAS-Heartbeat-File, lokales tmpfs) und fragt InfluxDB **nicht** ab — der Docker-Healthcheck (3–5 s Budget) darf nicht an InfluxDB-Antwortzeiten scheitern. Volle Details (inkl. Influx-Felder wie `poll_count`) liefert `GET /api/v1/collector/status`, den der GUI-System-Tab nutzt.

## Stations

`GET /api/v1/stations?fuel=e10&city=Frankfurt`

- `fuel`: e10|e5|diesel
- `city`: optional Filter

Antwort sortiert nach Preis (frisch zuerst):

```json
{
  "generated_at": "...",
  "cities": ["Frankfurt", "Gütersloh"],
  "fuel": "e10",
  "city": "Frankfurt",
  "stations": [
    {
      "station_id": "uuid",
      "city": "Frankfurt",
      "name": "Aral ...",
      "brand": "ARAL",
      "lat": 50.1, "lon": 8.6,
      "dist_km": 1.2, "dist_mode": "road|air",
      "maps_url": "https://www.google.com/maps/dir/?api=1&destination=...",
      "status": "open|closed|no prices|unknown",
      "observed_at": "...",
      "age_minutes": 5.2,
      "fresh": true,
      "last_price": 1.729,
      "price": 1.729
    }
  ],
  "fresh_prices": 8,
  "decision_ready": false,
  "calibrated": false
}
```

`price` nur wenn fresh (≤30 Min) und open, sonst null. `last_price` immer letzte Meldung.

## Series

`GET /api/v1/series?city=Frankfurt&station_id=uuid&fuel=e10&hours=24`

- `hours`: 1–168

Antwort:

```json
{"points": [{"timestamp": "...", "status": "open", "price": 1.729}, ...], "error_code": null}
```

Geschlossen/fehlend trennt Linie, offener Preis bleibt als Stufe stehen.

## Forecast

`GET /api/v1/forecast?city=Frankfurt&station_id=uuid&fuel=e10`

Liefert letzten publizierten Ausblick:

```json
{
  "station_id": "uuid",
  "city": "Frankfurt",
  "fuel": "e10",
  "origin": "2026-09-10T00:00:00Z",
  "points": [{"timestamp": "...", "q025": 1.6, "q10": 1.65, "q50": 1.7, "q90": 1.75, "q975": 1.8, "supported": true}, ...],
  "points_3d": [...],
  "points_7d": [...],
  "metrics": {"points": 1234, "mae_ct": 1.2, "mase": 0.85, "picp95_pct": 94.5},
  "stale": false,
  "calibrated": false,
  "decision_ready": false
}
```

`stale` wenn Alter >24h. Bänder projiziert auf 12-Uhr-Regel (Erhöhungen nur 12:00).

## Last Forecasts (RP2)

`GET /api/v1/last_forecasts`

Für RP2 Fallback-GUI Cache, nur 24h Horizonte (ohne 3d/7d):

```json
{"generated_at": "...", "count": 20, "forecasts": [{"station_id": "...", "city": "...", "fuel": "e10", "origin": "...", "points": [...]}, ...]}
```

## Heatmap (B3.9)

`GET /api/v1/heatmap?city=Frankfurt&fuel=e10&kind=probability&weeks=6&station_id=uuid`

- `city`: Pflicht
- `fuel`: e10|e5|diesel, Default e10
- `kind`: level|probability, Default level
  - `level`: Median €/L je (Wochentag, Stunde)
  - `probability`: Cheap-Probability in % je Zelle:
    - mit `station_id`: P(Station ≤ Stadtmedian **der Zelle**) — teilt den Preis der Station mit dem Median aller Stationen des gleichen (DoW, Stunde)
    - ohne `station_id`: P(Preis ≤ **Gesamtmedian des Zeitfensters**) — Anteil der offenen Preise der Stadt, die unter dem Gesamtmedian liegen
- `weeks`: 1–12, Default 6
- `station_id`: optional, wenn gesetzt nur diese Station, sonst Stadt

Antwort:

```json
{
  "generated_at": "...",
  "city": "Frankfurt",
  "fuel": "e10",
  "kind": "probability",
  "weeks": 6,
  "station_id": "uuid",
  "days": ["Mo","Di","Mi","Do","Fr","Sa","So"],
  "hours": [0,1,2,...,23],
  "matrix": [
    [null, null, ..., 45.2, 78.1],
    ...
  ],
  "points": 12345,
  "stations": 10,
  "error_code": null
}
```

- Matrix 7×24, Zeilen Mo–So, Spalten 0–23 Uhr (Europe/Berlin)
- level: Werte €/L (z. B. 1.689) oder null
- probability: Werte 0–100 % (z. B. 73.5) oder null
- `points`: Anzahl berücksichtigter offener Preise
- Berechnung: aus InfluxDB letzte N Wochen, nur offene Preise; Berlin-Zeit je Zelle

Fehler:

- `influx_not_configured`, `influx_read_failed`, `too_many_points` (>200k), `polling_missing`, `polling_invalid`, `invalid_query` (u. a. bei unbekannter Stadt/Station, ungültigem fuel/kind/weeks)

Frontend: Tab Statistik → Heatmaps, Umschalter Niveau/Probability, Wochen-Wahl.

## Selection / Meine Stationen (B3.10)

`GET /api/v1/selection?fuel=e10&city=Frankfurt`

- `fuel`: e10|e5|diesel
- `city`: optional Filter

Antwort:

```json
{
  "generated_at": "2026-09-10T02:00:00Z",
  "fuel": "e10",
  "city": "Frankfurt",
  "cities": ["Frankfurt", "Gütersloh"],
  "count": 10,
  "total_count": 20,
  "stations": [
    {
      "rank": 1,
      "station_id": "uuid",
      "city": "Frankfurt",
      "fuel": "e10",
      "name": "Aral ...",
      "brand": "ARAL",
      "coverage": 0.97,
      "delta_ct": -3.8,
      "ci_lo": -4.5,
      "ci_hi": -3.1,
      "p_value": 0.001,
      "q_value": 0.005,
      "significant": true,
      "avail": 0.42,
      "best_hour": 19.5,
      "vol_ct": 2.1,
      "rank_std": 1.3,
      "dist_km": 1.2,
      "dist_mode": "road",
      "maps_url": "...",
      "score": 1.23
    }
  ],
  "error_code": null,
  "calibrated": false,
  "decision_ready": false
}
```

Felder:

- `delta_ct` (δ̂): Median(p_i − LOO-Stadtmedian) ct/L, negativ = günstiger
- `delta_ew_ct`: EW-Median über Tages-δ̂ (Halbwertszeit 7 Tage, F5 — reagiert bei
  Betreiber-/Strategiewechsel schneller als der 42-Tage-Median; Ranking-Grundlage),
  `delta_recent5_ct`: Median der letzten 5 Tage, `delta_days`: Anzahl Tages-δ̂,
  `break_flag`/`break_stat`: retrospektiver CUSUM-Changepoint (Schwelle h=2,0)
- `ci_lo`, `ci_hi`: 95% KI aus exponentiell gewichtetem Tages-Block-Bootstrap B=2000
  (Seed 42, neuere Tage höheres Ziehgewicht, Halbwertszeit 14 Tage)
- `p_value`: einseitig H0: δ≥0 (small = signifikant günstiger), `q_value`: Benjamini-Hochberg FDR, `significant`: q<0.05
- `avail`: AV-Score = Σ w_h·P(Top-3|h); w = Pendlerprofil Mo–Fr 06–09/16–20 (Gewicht 5/7, Wochenende gleichmäßig 2/7)
- `best_hour`: günstigste Stunde aus robuster harmonischer Regression auf δ (2. Ordnung, Huber-IRLS), z. B. 19.5 = 19:30
- `vol_ct`: 1.4826·MAD(Δ) Volatilität
- `rank_std`: Std täglicher Mittelränge
- `coverage`: Anteil nutzbarer Preise
- `dist_km`, `dist_mode`, `maps_url`: aus polling.json + OSRM-Cache (`air` = Luftlinie-Fallback)

`count` = Anzahl aller gerankten Stationen des Kraftstoffs (nicht `top_global`, das ist auf 10 gekappt). `/api/v1/health` und `/api/v1/selection` zeigen dieselbe Zahl.

Artefakt fehlt auf dem NAS bis ersten Modell-Job: `selection_not_available` → Frontend zeigt Hinweis, keine erfundenen Rankings.

Quelle: `runtime/training/*.csv.gz` (aus InfluxDB + Archiv), Job `selection` täglich, auch nach Modell-Job best-effort.

## Collector Status (B3.11)

`GET /api/v1/collector/status`

Liefert Pi/tmpfs Livestatus (Collector-Herzschlag ans NAS).

Quellen in dieser Reihenfolge (`source`): `influx` (Measurement `collector_status`) → `nas` (File `runtime/collector/heartbeat.json`, vom Collector per POST abgelegt) → `local` (`meta/heartbeat.json`, nur wenn NAS selbst Pi ist bzw. `TANKAPP_POLL_DIR`). `influx.fields` enthält die letzten Influx-Felder (u. a. `poll_count`).

Antwort:

```json
{
  "generated_at": "2026-09-10T14:13:00+02:00",
  "available": true,
  "last_poll_at": "2026-09-10T14:12:03+02:00",
  "age_minutes": 1.2,
  "fresh": true,
  "tmpfs_used_bytes": 1234567,
  "tmpfs_total_bytes": 33554432,
  "tmpfs_free_bytes": 32319865,
  "oldest_age_days": 6.2,
  "influx": {
    "available": true,
    "last_heartbeat_at": "2026-09-10T14:12:30Z",
    "age_minutes": 0.5,
    "fresh": true,
    "fields": {
      "last_poll_at": "2026-09-10T14:12:03+02:00",
      "tmpfs_used_bytes": 1234567,
      "tmpfs_total_bytes": 33554432,
      "oldest_age_days": 6.2,
      "poll_count": 1234,
      "city": "Frankfurt"
    }
  },
  "local": {
    "last_poll_at": "2026-09-10T14:12:03+02:00",
    "city": "Frankfurt",
    "poll_count": 1234,
    "tmpfs": {"total_bytes": 33554432, "used_bytes": 1234567, "free_bytes": 32319865},
    "oldest_file": {"name": "2026-09-03.jsonl", "age_days": 6.2}
  }
}
```

- `available`: true wenn Influx-Punkt, NAS-Heartbeat-File oder lokales heartbeat.json vorhanden
- `fresh`: Herzschlag ≤15 Min
- tmpfs: belegte Bytes, gesamt, frei, älteste Datei Alter
- `nas`: Herzschlag-File des NAS (siehe POST-Endpunkt unten), `local`: nur wenn NAS selbst Pi ist oder TANKAPP_POLL_DIR gesetzt (Tests)
- Fehler: `influx_not_configured`, `collector_no_heartbeat`, `collector_check_failed`, `influx_read_failed`

Frontend: System-Tab → Pi/tmpfs Livestatus (holt diesen Endpunkt; `/api/v1/health` enthält denselben Status **ohne** Influx-Query, damit der Docker-Healthcheck nicht von InfluxDB-Antwortzeiten abhängt).

Collector schreibt `meta/heartbeat.json` nach jedem Poll, Uploader schreibt `collector_status` Measurement alle 60s.

## Collector Heartbeat (POST, B3.11)

`POST /api/v1/collector/heartbeat` — optionaler, InfluxDB-freier Weg: Der Collector POSTet den Herzschlag direkt ans NAS (`TANKAPP_NAS_URL` oder `TANKAPP_NAS_HEARTBEAT_URL` setzen; Base-URL oder volle Endpunkt-URL).

- Erlaubte Felder (Übriges wird verworfen): `timestamp`, `last_poll`, `city`, `open_count`, `total_count`, `tmpfs_used_mb`, `tmpfs_total_mb`, `oldest_file_age_days`, `poll_interval_s`
- `timestamp` fehlt → `last_poll` wird übernommen; fehlt auch → Server-Zeit (UTC)
- Antwort: `{"status": "ok", "received_at": "…"}` (200); Fehler: `400 invalid_json` / `400 invalid_request` (u. a. defekter Content-Length) / `413 payload_too_large` (>10 kB) / `503 server_error`
- Das File liegt unter `runtime/collector/heartbeat.json` und wird von `GET /api/v1/collector/status` als Fallback-Quelle `nas` ausgewertet (ohne InfluxDB)
- Alle anderen POST/PUT/DELETE/PATCH auf dem Server: `501` (Nur-Lese-Vertrag, ausgenommen die oben gelisteten Schreib-Endpunkte)

## Jobs Trigger (POST, Issue 50)

`POST /api/v1/jobs/trigger` — Uploader-Webhook der Ereignis-Pipeline (Detaillierung: `ARCHITEKTUR.md`, Abschnitt „Ereignis-Pipeline: Webhook statt reinem Polling“). Der Uploader sendet ihn Fire-and-Forget **nach dem sicheren InfluxDB-Write**; der NAS-Scheduler entscheidet allein, ob ein Lauf startet (Separation of Concerns).

```bash
curl -s -X POST http://nas:1355/api/v1/jobs/trigger \
  -H "Authorization: Bearer <TANKAPP_WEBHOOK_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"job": "models", "watermark": 1757584800}'
```

- Body: `{"job": "models"|"selection", "watermark": <Epochensekunden>}` — `watermark` optional (Datenstand des sicheren Writes)
- Auth: `Authorization: Bearer <TANKAPP_WEBHOOK_TOKEN>` — derselbe Secret, den der Uploader auf dem Pi als `TANKAPP_NAS_WEBHOOK_TOKEN` sendet; verglichen per `hmac.compare_digest` (kein Timing-Leak)
- Ohne konfiguriertes `TANKAPP_WEBHOOK_TOKEN` oder ohne laufenden Job-Betrieb (`--jobs`) existiert der Endpoint bewusst nicht: `404 not_found`
- Fehler: `403 unauthorized` (Token fehlt/stimmt nicht), `400 invalid_query` (Job außerhalb `models`/`selection` oder `watermark` keine Zahl)
- Erfolg: `200 {"status": "queued", "job": "models"}` — der Trigger ist nur vorgemerkt; die Job-Schleife wird aufgeweckt und entscheidet:
  - **Debounce:** Mindestabstand 15 min für `models`, 1 h für `selection` → Übersprung `debounced`
  - **Idempotenz:** gleiche `watermark` wie beim letzten erfolgreichen Lauf (verankert in `runtime/jobs/<job>.json → data_watermark`, sichtbar in `GET /api/v1/health`) und letzter Erfolg jünger als das Job-Intervall → Übersprung `duplicate`; letzter Erfolg älter als das Job-Intervall → Lauf trotzdem (Prognosefenster bleiben am aktuellen Tag verankert)
- Mehrere Trigger während eines Laufs werden zusammengeführt (nur die neueste `watermark` bleibt gemerkt); fehlschlägt der Webhook beim Uploader, läuft alles unverändert intervallbasiert weiter (keine neue harte Abhängigkeit)

## Job starten (POST, B6 — Startknopf)

`POST /api/v1/jobs/{job}/run` — der Startknopf der Job-Karten im System-Tab.
**Bewusst ohne Passwort**: Er wirkt nur im selben NAS-Webauftritt und nur,
wenn der Dienst überhaupt Jobs fährt (`tankapp.py nas-up` / `serve --jobs`).
Wer ihn abschalten will: `TANKAPP_GUI_JOB_START=0` in der Compose-Umgebung —
dann antwortet der Endpunkt `404 not_found` (wie der Webhook ohne Secret).

```bash
curl -s -X POST http://nas:1355/api/v1/jobs/models/run -H 'Content-Type: application/json' -d '{}'
```

- `{job}`: `archive`, `models`, `selection`, `settlement`; anderes → `404 not_found`
- Der Body wird ignoriert — der Ablauf entscheidet, nicht der Aufrufer
- Antworten (immer `200`, solange der Endpunkt existiert):
  - `{"status": "queued", "job": "models"}` — vorgemerkt, der Lauf startet sofort
  - `{"status": "running", "job": "models"}` — läuft bereits; kein zweiter Start
  - `{"status": "debounced", "job": "models", "retry_after": 37}` — vor weniger
    als 60 s gestartet; `retry_after` in Sekunden
- Unterschied zum Webhook (`POST /api/v1/jobs/trigger`): der Knopf ist ein
  **Wille**, keine „neue Daten liegen bereit“-Meldung. Er überspringt deshalb
  Debounce (15 min/1 h) und Idempotenz — sonst wäre genau der Fall blockiert,
  für den er gedacht ist: nach einer Korrektur den Fehlschlag sofort nachholen.
  Zwei Grenzen bleiben: nie zwei Läufe desselben Jobs gleichzeitig, und
  mindestens 60 s Abstand (Schutz gegen Dauergeklicke).
- Rate-Limit gilt auch hier (60/min anonym, 300/min mit Key) → `429 rate_limited`

## Job-Log (GET, B6)

`GET /api/v1/jobs/{job}/log?lines=200` — liefert die letzten Zeilen des
Job-Logs, das `app/progress.py` je Job fortschreibt
(`tail -f data/runtime/jobs/<job>.log` zeigt dieselben Zeilen).

```bash
curl -s "http://nas:1355/api/v1/jobs/models/log?lines=200" | jq
```

- `{job}`: nur `archive`, `models`, `selection`, `settlement`; alles andere →
  `404 not_found` (keine beliebigen Pfade, kein Directory-Listing)
- `lines`: 1–500, Standard 200; keine Zahl → `400 invalid_query`
- Antwort: `{"job": "models", "available": true, "count": 200, "total": 300,
  "lines": ["2026-09-11T06:10:00Z models: [31 %] …", …], "updated_at": "…",
  "error_code": null}`
- Fehlt die Datei (noch kein Lauf): `200` mit
  `{"available": false, "count": 0, "lines": [], "error_code": "log_missing"}`
  — kein 500, damit die GUI einen ehrlichen Leerzustand zeigen kann
- Jede Zeile wird beim Auslesen bereinigt (`app/errors.redact`): absolute
  Pfade werden auf den Dateinamen gekürzt, `token=…`/`password=…`/`Bearer …`,
  URL-Zugangsdaten und lange Schlüssel-Blobs entfernt
- Die **Ursache** eines Fehlschlags steht zusätzlich als ein Satz im Status:
  `GET /api/v1/health → jobs.<job>.error_detail` (z. B.
  `"ValueError: zu wenig Historie für current.json"`), geschrieben von
  `app/worker.py` bei `state: failed`

## Route Evaluate (B3.12)

`GET /api/v1/route/evaluate?city=Frankfurt&fuel=e10&station_id=uuid&ref_station_id=uuid&liters=40&detour_km=3&consumption=7&speed=45&value_of_time=12&when=2026-09-10T18:00:00+02:00&mode=onroute`

- `city`: optional, für Stadtmedian als Referenz
- `fuel`: e10|e5|diesel, Default e10
- `station_id`: Ziel-Station (Alternative)
- `ref_station_id`: Referenz-Station (z. B. aktuell ausgewählte), optional — falls fehlt, Stadtmedian frischer Preise als Referenz
- `liters`: Tankmenge 5–100, Default 40
- `detour_km`: einfache Mehrweg-Distanz km (onroute) bzw. einfache Entfernung (dedicated). **Ohne Angabe abgeleitet:** onroute = Luftlinie(Referenz, Ziel) × 1,3 (gleiche Umweg-Konvention wie `data-tools/road_route.py`), dedicated = Anker-Distanz zum Ziel; Fallback Anker-Differenz, dann 0 (Quelle in Antwortfeld `detour_km_source`: `query` | `derived` | `derived_anchor` | `zero`). Die reine Anker-Differenz |dist(Ziel) − dist(Ref)| wäre nur eine Dreiecksungleichungs-Schranke (0 bei gleicher Anker-Entfernung trotz km-Weite).
- `consumption`: L/100km 3–20, Default 7
- `speed`: km/h 10–130, Default 45
- `value_of_time`: €/h 0–100, 0/entfällt = Auto
- `when`: ISO-Zeitstempel, `HH:MM[:SS]` (Berlin) oder Stunde 0–23 (Dezimal) — nur für die Zeitwert-Automatik relevant; fehlt → offpeak
- `mode`: onroute|dedicated, Default onroute
  - onroute: nur Mehrweg zählt (einmalig)
  - dedicated: Extrafahrt Hin+Rück (doppelt)
- `price`/`target_price`/`alt_price`: Ziel-Preis explizit (Was-wäre-wenn) — **explizite Preise haben immer Vorrang vor Live-Preisen**, sonst Live-Preis (frisch > zuletzt beobachtet)
- `ref_price`: Referenz-Preis explizit, sonst Live-Preis der Referenzstation, sonst Stadtmedian frischer Preise. Ohne jeden bestimmbaren Referenzpreis: `price_not_available` (kein erfundener +5-ct-Referenzpreis)

Antwort:

```json
{
  "city": "Frankfurt",
  "fuel": "e10",
  "station_id": "uuid-ziel",
  "station_name": "Shell ...",
  "ref_station_id": "uuid-ref",
  "ref_station_name": "Aral ...",
  "ref_price": 1.729,
  "alt_price": 1.689,
  "target_price": 1.689,
  "delta_ct": 4.0,
  "gross_eur": 1.6,
  "detour_km_oneway": 3.0,
  "detour_km_total": 3.0,
  "detour_km_source": "query",
  "mode": "onroute",
  "fuel_cost_eur": 0.35,
  "time_cost_eur": 0.8,
  "detour_cost_eur": 1.15,
  "net_eur": 0.45,
  "critical_delta_ct": 2.88,
  "worth_it": false,
  "verdict": "borderline",
  "z_used": 12.0,
  "z_auto": true,
  "is_peak": false,
  "consumption_l_100km": 7.0,
  "speed_kmh": 45.0,
  "liters": 40.0,
  "generated_at": "2026-09-10T14:00:00Z"
}
```

`alt_price` = `target_price` (die günstigere Station, zu der gefahren wird); `ref_price` ist die teurere Referenz. `z_auto=true` wenn `value_of_time` 0/fehlte. Preis-Herkunft in `target_price_source`/`ref_price_source` (`query` | `live` | `live_stale` | `city_min` | `city_median`).

Formel: K = d·(c/100)·p + (d/v)·z, brutto = (p_ref − p_alt)·L, netto = brutto − K, kritisch Δp* = K/L

Verdict: worth ab 1.50€ netto, borderline ab 0.50€, sonst not_worth

Zeitwert-Automatik: 0/fehlend = auto, sonst explizit. Auto: Peak 16:30–20:00 = 16€/h, sonst 10€/h (Berlin Zeit). Die GUI sendet `when=<jetzt>` mit, damit Server- und lokale Rechnung dieselbe Zeit verwenden.

UI rechnet lokal (schnell), kann optional Server-Endpunkt zur Validierung nutzen (Button „Server prüfen“).

Fehler: `invalid_fuel`, `invalid_liters`, `invalid_detour`, `invalid_consumption`, `invalid_speed`, `invalid_mode`, `invalid_value_of_time`, `invalid_when`, `unknown_station`, `price_not_available`, `polling_missing`, `polling_invalid`, `route_evaluate_failed`

## Deprecation alter Alltags-Routen (B5, Konzept §11.3)

Sobald `/api/v1/decide` alle Alltags-Fälle abdeckt, markiert die App die
alten Alltags-Routen mit RFC-8594-Headern:

| Route | Header | Nachfolger |
|---|---|---|
| `GET /api/v1/stations` | `Deprecation: true`, `Sunset`, `Link` | `/api/v1/decide` |
| `GET /api/v1/day` | dto. | `/api/v1/decide` (Fenster „Heute später“) |
| `GET /api/v1/route/evaluate` | dto. | `/api/v1/decide` (`alternatives_nearby`) |

Werkstatt-Routen (`series`, `forecast`, `heatmap`, `selection`,
`collector/status`, `health`) bleiben bewusst unmarkiert — sie sind Analyse,
nicht Alltag.

## Fehlercodes

Zusätzlich zu den bekannten Codes: `rate_limited` (429, Konzept §11),
`invalid_latest_by`, `invalid_mode`, `invalid_home` (400, `/api/v1/decide`).

Siehe `web/src/data.ts` messages:

- polling_missing, polling_invalid
- influx_not_configured, influx_read_failed
- archive_not_configured, archive_incomplete
- insufficient_history, some_models_unavailable, model_not_available
- dependencies_missing, job_start_failed, job_failed
- selection_not_available, selection_failed
- collector_no_heartbeat, collector_check_failed
- too_many_points, invalid_query, not_found
- unknown_station (404), unknown_city (404), invalid_fuel, invalid_liters, invalid_price, invalid_consumption, invalid_speed, invalid_when, invalid_value_of_time, invalid_mode, invalid_detour (400)
- price_not_available (400 beim Fill), decide_failed, backtest_not_available
- episode_not_found (404), episodes_read_failed, set_intent_failed, record_fill_failed, settlement_failed, stats_summary_failed
- store_too_large (503), not_implemented (501)
- unauthorized (403, nur `POST /api/v1/jobs/trigger` ohne oder mit falschem Bearer-Token)
- payload_too_large (413), invalid_json, invalid_request, server_error

Alle Endpunkte liefern `error_code` statt Exception-Text, nie Tokens. Unbekannte Stationen/Städte liefern 404 mit spezifischem Code (kein pauschales `invalid_query`).

## Beispiele

```bash
curl -s http://nas:1355/api/v1/health | jq
curl -s "http://nas:1355/api/v1/stations?fuel=e10&city=Frankfurt" | jq
curl -s "http://nas:1355/api/v1/heatmap?city=Frankfurt&fuel=e10&kind=probability&weeks=6" | jq
curl -s "http://nas:1355/api/v1/selection?fuel=e10&city=Frankfurt" | jq
curl -s http://nas:1355/api/v1/collector/status | jq
curl -s "http://nas:1355/api/v1/route/evaluate?city=Frankfurt&fuel=e10&detour_km=3&liters=40" | jq
curl -s -X POST http://nas:1355/api/v1/jobs/trigger -H "Authorization: Bearer <TANKAPP_WEBHOOK_TOKEN>" -H "Content-Type: application/json" -d '{"job":"models","watermark":1757584800}' | jq
```
