# TankApp API — Endpunkte & Spezifikation

> Stand: 09.09.2026 — B3 & B4 Endpunkte enthalten, serverseitig, keine Demo-Fallbacks.

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
- [Route Evaluate (B3.12)](#route-evaluate-b312)
- [Fehlercodes](#fehlercodes)
- [Beispiele](#beispiele)

## Auth & Limits

- Anonym: 60/min, 10 000/Tag (via NAS Reverse Proxy, falls eingerichtet)
- Header `X-Api-Key`: 300/min, 50 000/Tag
- JSON/UTF-8, Zeiten Europe/Berlin angezeigt, UTC gespeichert, `Cache-Control: no-store`
- Schreib-Endpunkte:
  - `POST /api/v1/collector/heartbeat` (Collector-Herzschlag, B3.11)
  - `POST /api/v1/episodes` bzw. `POST /api/v1/recommendations/{id}/outcome` (Nutzer-Intents, B4)
  - `POST /api/v1/fills` (Persönliche Tankbelege für Wallet-Ledger, B4)
- Nicht implementierte Schreib-Endpunkte → 501 (außer RP2 Fallback lokal)

## Übersicht

| Endpunkt | Neu | Aufgabe |
|---|---|---|
| `GET /api/v1/decide?city=...&fuel=...&liters=40` | **B4** | Handlungsempfehlung + 3-Wege-Vergleich + Snapshot-Emission |
| `GET /api/v1/episodes?status=due` | **B4** | Offene / fällige Episoden für Due-Prompts |
| `POST /api/v1/episodes` | **B4** | Nutzer-Intent setzen (`wait`, `navigate`, `dismiss`) |
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
| `GET /api/v1/route/evaluate?...` | **B3.12** | Umweg-Ökonomie serverseitig |

## Decide (B4 Primär)

`GET /api/v1/decide?city=Frankfurt&fuel=e10&liters=40&value_of_time=12` (auch als `/v1/decide` erreichbar)

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

Ermittelt automatisch den Compliance-Grad (`followed`, `partial`, `ignored`, `unrelated`) per Zeitstempel-Matching (`tanked_at` vs. Emit-/Fensterzeiten mit 45-min- bzw. −30/+60-min-Slack) und die realisierte Ersparnis im Vergleich zu sofortigem Tanken.

## Stats Summary (B4 3 Schichten)

`GET /api/v1/stats/summary?city=Frankfurt&fuel=e10` (auch als `/v1/stats/summary` erreichbar)

Liefert die 3 strikt getrennten Schichten gemäß Konzept §5.5:
1. **Schicht A (Markt-Labor Backtest)**: 7 Tage Out-of-Sample Evaluation (`daysEval` aus der Engine-Publikation, `daysTrain` dito) mit echten 08:00-Entscheidungszeilen je Stationstag (`evalRows`: μ/s/best/predHour + Erwartungskurve, Anker = letzter Preis ≤ 08:00, Wahrheit = realisierte offene Preise). Server-Scores spiegeln exakt die Frontend-Formeln (`rowOutcome`/`scoreRows`, Default ε = 1,0 ct, 40 L). `p` ist null, solange die Engine kein P-Modell hat; `calibration`/`models`/`p8Series`/`scan` sind ehrlich leer.
2. **Schicht B (Live-Advice Ledger)**: Gesettelte Live-Snapshots mit Trefferquoten für Warten/Jetzt, Brier-Score (30d, nur über Snapshots mit gespeicherter P-Schätzung) und Kalibrierungs-Bins. `void`-Settlements zählen weder zu n noch zu Brier (`n_void`, `n_brier` werden ausgewiesen).
3. **Schicht C (Wallet Ledger)**: Persönliche Füllungen, Befolgungsgrad und Netto-Ersparnis.
4. **Güte-Kacheln**: Nur `picp_95` ist echt (Median aus der Engine-Publikation). `top3_hit_rate`, `mase_sprungfrei` und `cusum_drift` sind null/`unknown` (Konzept §6, offen) — die Gesamt-MASE als „sprungfrei“ zu etikettieren wäre Etikettenschwindel.


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
    "models": {"state": "success", ...},
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
- `ci_lo`, `ci_hi`: 95% KI aus Tages-Block-Bootstrap B=200 (Seed 42)
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
- Alle anderen POST/PUT/DELETE/PATCH auf dem Server: `501` (Nur-Lese-Vertrag)

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

## Fehlercodes

Siehe `web/src/data.ts` messages:

- polling_missing, polling_invalid
- influx_not_configured, influx_read_failed
- archive_not_configured, archive_incomplete
- insufficient_history, some_models_unavailable, model_not_available
- dependencies_missing, job_start_failed, job_failed
- selection_not_available, selection_failed
- collector_no_heartbeat, collector_check_failed
- too_many_points, invalid_query, not_found
- unknown_station (404), unknown_city (404), invalid_fuel, invalid_liters, invalid_consumption, invalid_speed, invalid_when, invalid_value_of_time, invalid_mode, invalid_detour (400)
- price_not_available, decide_failed, backtest_not_available
- episode_not_found (404), episodes_read_failed, set_intent_failed, record_fill_failed, settlement_failed, stats_summary_failed
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
```
