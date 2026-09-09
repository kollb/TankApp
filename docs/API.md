# TankApp API — Nur-Lese Endpunkte

> Stand: 10.09.2026 — B3 Endpunkte enthalten, serverseitig, keine Demo-Fallbacks.

## Inhaltsverzeichnis

- [Auth & Limits](#auth--limits)
- [Übersicht](#übersicht)
- [Health](#health)
- [Stations](#stations)
- [Series](#series)
- [Forecast](#forecast)
- [Last Forecasts (RP2)](#last-forecasts-rp2)
- [Heatmap (B3.9)](#heatmap-b39)
- [Selection / Meine Stationen (B3.10)](#selection--meine-stationen-b310)
- [Collector Status (B3.11)](#collector-status-b311)
- [Route Evaluate (B3.12)](#route-evaluate-b312)
- [Fehlercodes](#fehlercodes)
- [Beispiele](#beispiele)

## Auth & Limits

- Anonym: 60/min, 10 000/Tag (via NAS Reverse Proxy, falls eingerichtet)
- Header `X-Api-Key`: 300/min, 50 000/Tag
- JSON/UTF-8, Zeiten Europe/Berlin angezeigt, UTC gespeichert, `Cache-Control: no-store`
- Keine Schreib-Endpunkte in dieser Lieferung (außer RP2 Fallback lokal)

## Übersicht

| Endpunkt | Neu | Aufgabe |
|---|---|---|
| `GET /api/v1/health` | erweitert | App online, Jobs, Archiv, Modelle, Selektion, Collector |
| `GET /api/v1/stations?fuel=e10&city=...` |  | Aktuelle Preise, frisch ≤30 Min |
| `GET /api/v1/series?city=...&station_id=...&fuel=...&hours=24` |  | Verlauf 1–168h |
| `GET /api/v1/forecast?city=...&station_id=...&fuel=...` |  | Modell-Ausblick 24h + 3d/7d |
| `GET /api/v1/last_forecasts` |  | Für RP2-Cache, nur 24h Horizonte |
| `GET /api/v1/heatmap?city=...&fuel=...&kind=...&weeks=6&station_id=...` | **B3.9** | DoW×Stunde Niveau + Cheap-Prob |
| `GET /api/v1/selection?fuel=...&city=...` | **B3.10** | Meine Stationen mit δ̂ |
| `GET /api/v1/stations/selection` | Alias | Gleich wie selection |
| `GET /api/v1/collector/status` | **B3.11** | Pi/tmpfs Livestatus |
| `GET /api/v1/route/evaluate?...` | **B3.12** | Umweg-Ökonomie serverseitig |

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
    "last_poll_at": "2026-09-10T14:12:03+02:00",
    "age_minutes": 2.5,
    "fresh": true,
    "tmpfs_used_bytes": 1234567,
    "tmpfs_total_bytes": 33554432,
    "oldest_age_days": 6.2,
    "influx": {"available": true, "last_heartbeat_at": "...", "fields": {"poll_count": 1234}}
  }
}
```

Collector frisch = Herzschlag ≤15 Min.

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
  - `probability`: Cheap-Probability P(p ≤ Stadtmedian) in % je Zelle
- `weeks`: 1–12, Default 6 (Median 6 Wochen)
- `station_id`: optional, wenn gesetzt nur diese Station, sonst Stadt-Median

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
- Berechnung: aus InfluxDB letzte N Wochen, nur offene Preise, Stadtmedian je Timestamp für probability

Fehler:

- `influx_not_configured`, `influx_read_failed`, `too_many_points` (>200k), `polling_missing`, `unknown_city`, `unknown_station`, `invalid_query`

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
- `ci_lo`, `ci_hi`: 95% KI aus Tages-Block-Bootstrap B=200
- `p_value`: einseitig H0: δ≥0, `q_value`: Benjamini-Hochberg FDR, `significant`: q<0.05
- `avail`: AV-Score = Σ w_h·P(Top-3|h), w = Pendlerprofil Mo–Fr 06–09/16–20
- `best_hour`: billigste Stunde (Medianpreis minimal), z. B. 19.5 = 19:30
- `vol_ct`: 1.4826·MAD(Δ) Volatilität
- `rank_std`: Std täglicher Mittelränge
- `coverage`: Anteil nutzbarer Preise
- `dist_km`, `dist_mode`, `maps_url`: aus polling.json + OSRM Cache

Artefakt fehlt auf dem NAS bis ersten Modell-Job: `selection_not_available` → Frontend zeigt Hinweis, keine erfundenen Rankings.

Quelle: `runtime/training/*.csv.gz` (aus InfluxDB + Archiv), Job `selection` täglich, auch nach Modell-Job best-effort.

## Collector Status (B3.11)

`GET /api/v1/collector/status`

Liefert Pi/tmpfs Livestatus (Collector-Herzschlag ans NAS).

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

- `available`: true wenn Influx-Punkt oder lokales heartbeat.json vorhanden
- `fresh`: Herzschlag ≤15 Min
- tmpfs: belegte Bytes, gesamt, frei, älteste Datei Alter
- `local`: nur vorhanden wenn NAS selbst Pi ist oder TANKAPP_POLL_DIR gesetzt (Tests)
- Fehler: `influx_not_configured`, `collector_no_heartbeat`, `collector_check_failed`

Frontend: System-Tab → Pi/tmpfs Livestatus.

Collector schreibt `meta/heartbeat.json` nach jedem Poll, Uploader schreibt `collector_status` Measurement alle 60s.

## Route Evaluate (B3.12)

`GET /api/v1/route/evaluate?city=Frankfurt&fuel=e10&station_id=uuid&ref_station_id=uuid&liters=40&detour_km=3&consumption=7&speed=45&value_of_time=12&when=2026-09-10T18:00:00+02:00&mode=onroute`

- `city`: optional, für Stadtmedian als Referenz
- `fuel`: e10|e5|diesel
- `station_id`: Ziel-Station (Alternative)
- `ref_station_id`: Referenz-Station (z. B. aktuell ausgewählte), optional — falls fehlt, Stadtmedian frischer Preise als Referenz
- `liters`: Tankmenge 5–100, Default 40
- `detour_km`: einfache Mehrweg-Distanz km (für onroute) oder einfache Entfernung für dedicated, Default 0 (versucht aus dist_km Differenz zu berechnen)
- `consumption`: L/100km 3–20, Default 7
- `speed`: km/h 10–130, Default 45
- `value_of_time`: €/h 0–100, Default auto (0 = auto)
- `when`: ISO Zeit oder Stunde 0–23 für Zeitwert-Automatik, Default jetzt
- `mode`: onroute|dedicated, Default onroute
  - onroute: nur Mehrweg zählt (einmalig)
  - dedicated: Extrafahrt Hin+Rück (doppelt)
- `alt_price`, `ref_price`: optional explizit für Tests, sonst live Preise

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
  "delta_ct": 4.0,
  "gross_eur": 1.6,
  "detour_km_oneway": 3.0,
  "detour_km_total": 3.0,
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
  "consumption": 7.0,
  "speed_kmh": 45.0,
  "liters": 40.0,
  "generated_at": "2026-09-10T14:00:00Z"
}
```

Formel: K = d·(c/100)·p + (d/v)·z, brutto = (p_ref − p_alt)·L, netto = brutto − K, kritisch Δp* = K/L

Verdict: worth ab 1.50€ netto, borderline ab 0.50€, sonst not_worth

Zeitwert-Automatik: 0 = auto, sonst explizit. Auto: Peak 16:30–20:00 = 16€/h, sonst 10€/h (Berlin Zeit).

UI rechnet lokal (schnell), kann optional Server-Endpunkt zur Validierung nutzen (Button „Server prüfen“).

Fehler: `invalid_fuel`, `unknown_city`, `unknown_station`, `no_stations`, `no_prices`, `invalid_query`

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

Alle Endpunkte liefern `error_code` statt Exception-Text, nie Tokens.

## Beispiele

```bash
curl -s http://nas:1355/api/v1/health | jq
curl -s "http://nas:1355/api/v1/stations?fuel=e10&city=Frankfurt" | jq
curl -s "http://nas:1355/api/v1/heatmap?city=Frankfurt&fuel=e10&kind=probability&weeks=6" | jq
curl -s "http://nas:1355/api/v1/selection?fuel=e10&city=Frankfurt" | jq
curl -s http://nas:1355/api/v1/collector/status | jq
curl -s "http://nas:1355/api/v1/route/evaluate?city=Frankfurt&fuel=e10&detour_km=3&liters=40" | jq
```
