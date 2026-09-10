"""Read-only live data and public projections. No price API calls, no demo fallback."""

import datetime as dt
import json
import math
import os
import threading
import time
from typing import Any

import export_influx as influx
from polling_plan import validate_sets

UTC = dt.timezone.utc
FUELS = {"e10", "e5", "diesel"}

try:
    from zoneinfo import ZoneInfo

    BERLIN_TZ = ZoneInfo("Europe/Berlin")
except Exception:  # pragma: no cover
    BERLIN_TZ = UTC


_ROUTE_LOCK = threading.Lock()


def haversine_km(lat1, lon1, lat2, lon2):
    """Luftlinie als Fallback, wenn keine Straßenroute vorliegt."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    inner = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    )
    return 6371.0 * 2 * math.asin(math.sqrt(inner))


def driving_km(anchor, targets, cache_path):
    """Fahrstrecke Anker → Stationen (OSRM). Cache-Treffer ohne Netz.

    targets: list[(lat, lon)]. Rückgabe: list[(km, 'road'|'air')].
    'air' nur wenn der Router ausfällt — dann Luftlinie, nie erfunden.
    Der Anker bleibt intern; nur abgeleitete Kilometer verlassen die Funktion.
    """
    if not targets:
        return []
    air = [(round(haversine_km(*anchor, lat, lon), 1), "air") for lat, lon in targets]
    if os.environ.get("TANKAPP_OSRM", "1") in {"0", "off", "false"}:
        return air
    try:
        from road_route import RoadRouter
    except ImportError:
        return air
    with _ROUTE_LOCK:
        router = RoadRouter(
            mode="driving",
            cache_path=cache_path,
            timeout=4,
            quiet=True,
            circuity=1.0,
        )
        routes = router.routes_from(
            anchor[0], anchor[1], list(targets), want_duration=False
        )
        out = []
        for i, (lat, lon) in enumerate(targets):
            km, _ = routes[i]
            key = f"car|{anchor[0]:.5f},{anchor[1]:.5f}|{lat:.5f},{lon:.5f}"
            kind = "road" if key in router.cache else "air"
            if kind == "air":
                km = haversine_km(*anchor, lat, lon)
            out.append((round(float(km), 1), kind))
        return out


def read_json(path, default=None):
    try:
        if path.stat().st_size > 10_000_000:
            return default
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return default


def metadata(settings):
    payload = read_json(settings.polling)
    if payload is None:
        return {}, "polling_missing"
    try:
        groups = validate_sets(payload)
    except (ValueError, TypeError, KeyError):
        return {}, "polling_invalid"
    stations = {}
    pending = []
    cache_path = getattr(settings, "runtime", None)
    cache_file = (cache_path / "road_route_cache.json") if cache_path else None
    for key, group in groups.items():
        city = group.get("label") or key
        anchor = group.get("anchor")
        if anchor is None:
            lat0, lon0 = group.get("lat"), group.get("lon")
            if (
                type(lat0) in (int, float)
                and type(lon0) in (int, float)
                and math.isfinite(lat0)
                and math.isfinite(lon0)
            ):
                anchor = [lat0, lon0]
        anchor_ok = (
            isinstance(anchor, list)
            and len(anchor) == 2
            and all(type(value) in (int, float) for value in anchor)
            and all(math.isfinite(value) for value in anchor)
            and 47 <= anchor[0] <= 56
            and 5 <= anchor[1] <= 16
        )
        details = {item["uuid"]: item for item in group.get("stations", [])}
        for uid in group.get("batch") or list(details):
            item = details.get(uid, {})
            lat, lon = item.get("lat"), item.get("lon")
            coordinates = (
                type(lat) in (float, int)
                and type(lon) in (float, int)
                and math.isfinite(lat)
                and math.isfinite(lon)
                and -90 <= lat <= 90
                and -180 <= lon <= 180
            )
            identity = (city, uid)
            stations[identity] = {
                "station_id": uid,
                "city": city,
                "name": item.get("name") or uid,
                "brand": item.get("brand") or "",
                "lat": lat if coordinates else None,
                "lon": lon if coordinates else None,
                "dist_km": None,
                "dist_mode": None,
                "maps_url": f"https://www.google.com/maps/dir/?api=1&destination={lat},{lon}&travelmode=driving"
                if coordinates
                else None,
            }
            if anchor_ok and coordinates:
                pending.append((identity, (lat, lon), tuple(anchor)))
    by_anchor = {}
    for identity, coords, anchor in pending:
        by_anchor.setdefault(anchor, []).append((identity, coords))
    for anchor, items in by_anchor.items():
        distances = driving_km(anchor, [coords for _, coords in items], cache_file)
        for (identity, _), (km, kind) in zip(items, distances):
            stations[identity]["dist_km"] = km
            stations[identity]["dist_mode"] = kind
    return stations, None


def public_job(settings, name):
    raw = read_json(settings.runtime / "jobs" / f"{name}.json", {})
    if not isinstance(raw, dict):
        raw = {}
    payload = {
        key: raw.get(key)
        for key in (
            "state",
            "started_at",
            "finished_at",
            "last_success_at",
            "next_run_at",
            # Issue 50: Datenstand des letzten erfolgreichen
            # Webhook-Triggerlaufs (Epochensekunden) — Idempotenz-Anker.
            "data_watermark",
            "error_code",
        )
    }
    # Fortschritt nur für *laufende* Jobs (app/progress.py): „Läuft …“ ohne
    # „wo?“ ist bei einem 20-Minuten-Modelllauf genau die Lücke, die der
    # System-Status schließen soll.
    if raw.get("state") == "running":
        try:
            from .progress import read_progress

            payload["progress"] = read_progress(settings, name)
        except Exception:
            payload["progress"] = None
    return payload


def publication(settings):
    raw = read_json(settings.runtime / "engine/current.json", {})
    return raw if isinstance(raw, dict) else {}


def selection_publication(settings):
    raw = read_json(settings.runtime / "selection/current.json", {})
    return raw if isinstance(raw, dict) else {}


class LiveData:
    """Bounded cache, re-evaluate age on EVERY request; never call statusless last(price)."""

    def __init__(self, settings, query=None, clock=None):
        self.settings = settings
        self.query = query or influx.query_rows
        self.clock = clock or (lambda: dt.datetime.now(UTC))
        self.lock = threading.Lock()
        self.cache = {}
        self.jobs_enabled = False
        self.job_errors = {}
        # stats_summary liest die Engine-Veröffentlichung über diesen Provider,
        # damit kein circular import entsteht (data ↔ stats_summary).
        try:
            from .stats_summary import set_publication_provider

            set_publication_provider(lambda: publication(self.settings))
        except Exception:
            pass

    def _load(self, fuel, metas):
        key = (fuel, tuple(sorted(metas)))
        now = self.clock()
        with self.lock:
            cached = self.cache.get(key)
            if cached and time.monotonic() - cached[0] < 30:
                return cached[1:]
            previous = cached[1] if cached else {}
            rows, error = {}, None
            if not self.settings.influx_env.is_file():
                error = "influx_not_configured"
            else:
                try:
                    cfg = influx.load_config(self.settings.influx_env, timeout=10)
                    cfg.validate()
                    lookup = influx.station_lookup(self.settings.polling)
                    selected = influx.selected_uuid_sets(lookup)
                    query = influx.flux_query(
                        cfg.bucket,
                        fuel,
                        now - dt.timedelta(days=2),
                        now,
                        sorted(selected),
                        selected,
                    )
                    query += '  |> group(columns: ["city", "station_id"])\n  |> sort(columns: ["_time"])\n  |> tail(n: 1)\n'
                    seen, kept = 0, 0
                    for raw in self.query(cfg, query):
                        # Einzelne defekte Zeilen überspringen, statt alle
                        # Stationen auf influx_read_failed zu setzen. Werden
                        # aber ALLE gelieferten Zeilen verworfen, ist das kein
                        # Teilerfolg, sondern ein expliziter Lesefehler (kein
                        # stilles Leer-Ergebnis bei Totalausfall).
                        seen += 1
                        try:
                            if not raw.get("station_id"):
                                raise ValueError("UUID required")
                            row = influx.normalized_row(raw, lookup, fuel)
                            stamp = influx.instant(row["timestamp"])
                            if not now - dt.timedelta(days=2) <= stamp <= now:
                                raise ValueError("Timestamp outside query")
                            identity = (row["city"], row["station_id"])
                            if identity not in metas:
                                raise ValueError("Unselected station")
                            rows[identity] = row
                            kept += 1
                        except (ValueError, KeyError, TypeError):
                            continue
                    if seen and not kept:
                        error = "influx_read_failed"
                except (ValueError, OSError, KeyError, TypeError):
                    error = "influx_read_failed"
            if error:
                rows = previous
            self.cache = {k: v for k, v in self.cache.items() if k[1] == key[1]}
            self.cache[key] = (time.monotonic(), rows, error)
            return rows, error

    def stations(self, fuel="e10", city=None):
        if fuel not in FUELS:
            raise ValueError("invalid_fuel")
        metas, problem = metadata(self.settings)
        cities = list(dict.fromkeys(city_name for city_name, _ in metas))
        if city and city not in cities:
            raise ValueError("unknown_city")
        rows, error = ({}, problem) if problem else self._load(fuel, metas)
        now = self.clock()
        result = []
        for identity, meta in metas.items():
            if city and meta["city"] != city:
                continue
            row = rows.get(identity)
            age = (
                (now - influx.instant(row["timestamp"])).total_seconds() / 60
                if row
                else None
            )
            fresh = error is None and age is not None and 0 <= age <= 30
            status = row["status"] if row else "unknown"
            price = float(row["price"]) if row and row["price"] else None
            result.append(
                {
                    **meta,
                    "fuel": fuel,
                    "status": status,
                    "observed_at": row["timestamp"] if row else None,
                    "age_minutes": round(age, 2) if age is not None else None,
                    "fresh": fresh,
                    "last_price": price,
                    "price": price if fresh and status == "open" else None,
                }
            )
        result.sort(
            key=lambda row: (row["price"] is None, row["price"] or 0, row["name"])
        )
        return {
            "generated_at": now.isoformat(),
            "cities": cities,
            "fuel": fuel,
            "city": city,
            "source": "influxdb",
            "connection_error": error,
            "stations": result,
            "fresh_prices": sum(row["price"] is not None for row in result),
            "decision_ready": False,
            "calibrated": False,
        }

    def series(self, uid, city, fuel, hours=24):
        if fuel not in FUELS or not 1 <= hours <= 168:
            raise ValueError("invalid_query")
        metas, problem = metadata(self.settings)
        if (city, uid) not in metas:
            raise ValueError("unknown_station")
        if problem or not self.settings.influx_env.is_file():
            return {"points": [], "error_code": problem or "influx_not_configured"}
        now = self.clock()
        try:
            cfg = influx.load_config(self.settings.influx_env, timeout=10)
            cfg.validate()
            lookup = influx.station_lookup(self.settings.polling)
            query = influx.flux_query(
                cfg.bucket,
                fuel,
                now - dt.timedelta(hours=hours),
                now,
                [city],
                {city: [uid]},
            )
            points = []
            for raw in self.query(cfg, query):
                if raw.get("station_id") != uid or raw.get("city") != city:
                    raise ValueError("Wrong identity")
                row = influx.normalized_row(raw, lookup, fuel)
                stamp = influx.instant(row["timestamp"])
                if not now - dt.timedelta(hours=hours) <= stamp <= now:
                    raise ValueError("Wrong time")
                points.append(
                    {
                        "timestamp": stamp.isoformat(),
                        "status": row["status"],
                        "price": float(row["price"]) if row["price"] else None,
                    }
                )
                if len(points) > 20_000:
                    raise ValueError("Too many points")
            return {
                "points": sorted(points, key=lambda p: p["timestamp"]),
                "error_code": None,
            }
        except (ValueError, OSError, KeyError, TypeError):
            return {"points": [], "error_code": "influx_read_failed"}

    def trigger_info(self):
        """Issue 50: Webhook-Trigger-Statistik des Schedulers (Prozesslebenszeit).

        Ohne anhängenden Scheduler (z. B. reine Read-Only-Instanzen) bleibt
        das Feld leer — die intervallo-basierten Jobs ändern dadurch nichts.
        """
        scheduler = getattr(self, "scheduler", None)
        if scheduler is None:
            return {}
        with scheduler.lock:
            return {
                name: {
                    "triggers": scheduler.trigger_counts.get(name, 0),
                    "last_trigger_skip": scheduler.trigger_skips.get(name),
                }
                for name in ("models", "selection")
            }

    def health(self):
        job_errors = self.job_errors.copy()
        trigger_stats = self.trigger_info()
        metas, problem = metadata(self.settings)
        archive = read_json(
            self.settings.runtime / "jobs" / "archive-sync" / "state.json", None
        )
        if not isinstance(archive, dict):
            archive = read_json(self.settings.archive / ".sync/state.json", {})
        if not isinstance(archive, dict):
            archive = {}
        bundle = publication(self.settings)
        sel = selection_publication(self.settings)
        # Collector status without network: /health is polled by the Docker
        # HEALTHCHECK (3–5 s budget) and must not depend on InfluxDB response
        # times. Full details (incl. InfluxDB) live in /api/v1/collector/status.
        try:
            from .collector_status import build_collector_status

            collector = build_collector_status(
                self.settings, None, self.clock, allow_influx=False
            )
        except BaseException:
            collector = {
                "available": False,
                "error_code": "collector_check_failed",
                "generated_at": self.clock().isoformat(),
            }
        if problem:
            collector["polling_error"] = problem

        # Selection count: support both old flat and new by_fuel formats.
        # Count all ranked stations (not top_global, which is capped at 10/fuel),
        # so /health and /api/v1/selection agree.
        sel_count = 0
        if isinstance(sel, dict):
            if "by_fuel" in sel:
                for fuel_data in sel.get("by_fuel", {}).values():
                    if not isinstance(fuel_data, dict):
                        continue
                    cities = fuel_data.get("cities") or []
                    if cities:
                        sel_count += sum(len(c.get("stations", [])) for c in cities)
                    else:
                        sel_count += len(fuel_data.get("top_global", []))
            else:
                sel_count = sel.get("count", 0)

        return {
            "app": "online",
            "generated_at": self.clock().isoformat(),
            "polling_error": problem,
            "station_count": len(metas),
            "influx_configured": self.settings.influx_env.is_file(),
            "archive_configured": self.settings.netrc.is_file()
            and self.settings.netrc.stat().st_size > 0,
            "jobs_enabled": self.jobs_enabled,
            "archive": {
                key: archive.get(key)
                for key in (
                    "archive_since",
                    "requested_until",
                    "status",
                    "missing_files",
                    "last_complete_until",
                )
            },
            "jobs": {
                name: {
                    **public_job(self.settings, name),
                    **(
                        {"state": "failed", "error_code": job_errors[name]}
                        if name in job_errors
                        else {}
                    ),
                    # Issue 50: Trigger-Zählung/Sprung-Grund nur für die
                    # inferenz-baren Jobs (models/selection) vorhanden.
                    **trigger_stats.get(name, {}),
                }
                for name in ("archive", "models", "selection", "settlement")
            },
            "models": {
                "published_at": bundle.get("published_at"),
                "count": len(bundle.get("forecasts", [])),
                "calibrated": False,
                "decision_ready": False,
            },
            "selection": {
                "published_at": sel.get("generated_at")
                if isinstance(sel, dict)
                else None,
                "fuels": sel.get("fuels", []) if isinstance(sel, dict) else [],
                "count": sel_count,
                "error_code": None if sel else "selection_not_available",
            },
            "collector": collector,
        }

    def forecast(self, uid, city, fuel):
        metas, _ = metadata(self.settings)
        if fuel not in FUELS or (city, uid) not in metas:
            raise ValueError("unknown_station")
        bundle = publication(self.settings)
        for row in bundle.get("forecasts", []):
            if (
                row.get("station_id"),
                row.get("city"),
                row.get("fuel", "").lower(),
            ) != (uid, city, fuel):
                continue
            origin = influx.instant(row["origin"])
            age = (self.clock() - origin).total_seconds() / 3600
            return {
                **row,
                "stale": age < 0 or age > 24,
                "model_age_hours": max(0, age),
                "published_at": bundle.get("published_at"),
                "calibrated": False,
                "decision_ready": False,
            }
        return {
            "points": [],
            "error_code": "model_not_available",
            "calibrated": False,
            "decision_ready": False,
        }

    def last_forecasts(self):
        """Gibt alle letzten Prognosen für den RP2-Cache zurück."""
        bundle = publication(self.settings)
        forecasts = bundle.get("forecasts", [])

        valid_forecasts = []
        for row in forecasts:
            if not all(
                k in row for k in ["station_id", "city", "fuel", "origin", "points"]
            ):
                continue
            slim = {k: v for k, v in row.items() if k not in ("points_3d", "points_7d")}
            valid_forecasts.append(slim)

        return {
            "generated_at": bundle.get("published_at"),
            "forecasts": valid_forecasts,
            "count": len(valid_forecasts),
            "calibrated": False,
            "decision_ready": False,
        }

    def heatmap(self, city, fuel="e10", kind="level", weeks=6, station_id=None):
        """Heatmaps DoW×Stunde: Niveau (Median) + Cheap-Probability."""
        if fuel not in FUELS:
            raise ValueError("invalid_fuel")
        if kind not in ("level", "probability"):
            raise ValueError("invalid_kind")
        if not 1 <= weeks <= 12:
            raise ValueError("invalid_weeks")
        metas, problem = metadata(self.settings)
        if problem:
            return {"error_code": problem, "days": [], "hours": [], "matrix": []}
        cities = list(dict.fromkeys(c for c, _ in metas))
        if city not in cities:
            raise ValueError("unknown_city")
        if station_id and (city, station_id) not in metas:
            raise ValueError("unknown_station")

        now = self.clock()
        start = now - dt.timedelta(days=weeks * 7)

        if not self.settings.influx_env.is_file():
            return {
                "error_code": "influx_not_configured",
                "days": [],
                "hours": [],
                "matrix": [],
            }

        try:
            cfg = influx.load_config(self.settings.influx_env, timeout=10)
            cfg.validate()
            lookup = influx.station_lookup(self.settings.polling)
            city_stations = [sid for (c, sid) in metas if c == city]
            if not city_stations:
                raise ValueError("unknown_city")
            query = influx.flux_query(
                cfg.bucket,
                fuel,
                start,
                now,
                [city],
                {city: city_stations},
            )
            points = []
            for raw in self.query(cfg, query):
                if raw.get("city") != city:
                    continue
                try:
                    row = influx.normalized_row(raw, lookup, fuel)
                except Exception:
                    continue
                stamp = influx.instant(row["timestamp"])
                if not start <= stamp <= now:
                    continue
                if row["status"] != "open" or not row["price"]:
                    continue
                try:
                    price_val = float(row["price"])
                except Exception:
                    continue
                points.append(
                    {
                        "timestamp": stamp,
                        "station_id": row["station_id"],
                        "price": price_val,
                    }
                )
                if len(points) > 200_000:
                    raise ValueError("Too many points")
        except ValueError as e:
            if str(e) == "Too many points":
                return {
                    "error_code": "too_many_points",
                    "days": [],
                    "hours": [],
                    "matrix": [],
                }
            return {
                "error_code": "influx_read_failed",
                "days": [],
                "hours": [],
                "matrix": [],
            }
        except Exception:
            return {
                "error_code": "influx_read_failed",
                "days": [],
                "hours": [],
                "matrix": [],
            }

        from .heatmap import build_heatmap

        result = build_heatmap(points, kind=kind, station_id=station_id)

        return {
            "generated_at": now.isoformat(),
            "city": city,
            "fuel": fuel,
            "kind": kind,
            "weeks": weeks,
            "station_id": station_id,
            "days": result["days"],
            "hours": result["hours"],
            "matrix": result["matrix"],
            "points": result["points"],
            "stations": result["stations"],
            "error_code": None,
        }

    def selection(self, fuel="e10", city=None):
        """Meine Stationen mit δ̂ — Ranking, Bootstrap-KI, AV-Score, billigste Stunde."""
        if fuel not in FUELS:
            raise ValueError("invalid_fuel")
        metas, problem = metadata(self.settings)
        if problem:
            return {"error_code": problem, "stations": [], "count": 0}
        cities = list(dict.fromkeys(c for c, _ in metas))
        if city and city not in cities:
            raise ValueError("unknown_city")

        try:
            from .selection import read_selection

            data = read_selection(self.settings)
        except Exception:
            return {"error_code": "selection_read_failed", "stations": [], "count": 0}

        # data kann entweder by_fuel Struktur oder flache Liste sein
        if "by_fuel" in data:
            fuel_data = data["by_fuel"].get(fuel, {})
            # fuel_data enthält cities und top_global
            if city:
                # Finde Stadt
                city_entry = next(
                    (c for c in fuel_data.get("cities", []) if c.get("city") == city),
                    None,
                )
                if city_entry:
                    stations = city_entry.get("stations", [])
                else:
                    stations = []
            else:
                # Alle Städte zusammen oder top_global
                stations = []
                for c in fuel_data.get("cities", []):
                    stations.extend(c.get("stations", []))
                # Sortiere nach rank
                stations = sorted(stations, key=lambda x: x.get("rank", 999))
            return {
                "generated_at": data.get("generated_at")
                or fuel_data.get("generated_at"),
                "fuel": fuel,
                "city": city,
                "cities": [c.get("city") for c in fuel_data.get("cities", [])],
                "count": len(stations),
                "total_count": len(stations),
                "stations": stations,
                "top_global": fuel_data.get("top_global", [])[:10],
                "error_code": None,
                "calibrated": False,
                "decision_ready": False,
            }
        else:
            # Fallback altes Format
            stations = data.get("stations", [])
            filtered = [
                s
                for s in stations
                if s.get("fuel", "").lower() == fuel.lower()
                and (city is None or s.get("city") == city)
            ]
            return {
                "generated_at": data.get("generated_at"),
                "fuel": fuel,
                "city": city,
                "cities": data.get("cities", []),
                "count": len(filtered),
                "total_count": data.get("count", 0),
                "stations": sorted(filtered, key=lambda x: x.get("rank", 999)),
                "error_code": data.get("error_code"),
                "calibrated": False,
                "decision_ready": False,
            }

    def collector_status(self):
        """Pi/tmpfs Livestatus — Collector-Herzschlag ans NAS."""
        try:
            from .collector_status import build_collector_status

            return build_collector_status(self.settings, self.query, self.clock)
        except Exception:
            return {"available": False, "error_code": "collector_check_failed"}

    def route_evaluate(self, params: dict):
        """Serverseitige Umweg-Ökonomie."""
        try:
            from .route import evaluate_route

            return evaluate_route(self, params)
        except ValueError as e:
            raise e
        except Exception:
            return {"error_code": "route_evaluate_failed"}

    def decide(self, params: dict):
        """Entscheidungs-API — GET /api/v1/decide (Konzept §4, §11.1)."""
        try:
            from .decide import evaluate_decide

            return evaluate_decide(self, params)
        except ValueError as e:
            raise e
        except Exception:
            return {"error_code": "decide_failed"}

    def episodes(self, status: str | None = None):
        """Liefert Episoden (z. B. ?status=due für Due-Prompt beim Öffnen)."""
        try:
            from .feedback import load_store

            store = load_store(self.settings)
            episodes = store.get("episodes", [])
            if status:
                filtered = [e for e in episodes if e.get("status") == status]
            else:
                filtered = episodes
            return {
                "generated_at": self.clock().isoformat(),
                "count": len(filtered),
                "episodes": filtered,
                "error_code": None,
            }
        except Exception:
            return {"error_code": "episodes_read_failed", "episodes": [], "count": 0}

    def set_intent(self, episode_id: str, intent: str):
        """Setzt den Intent einer Episode (wait, navigate, refuel_now, dismiss)."""
        try:
            from .feedback import set_intent

            res = set_intent(self.settings, episode_id, intent, clock=self.clock)
            return res
        except Exception:
            return {"error_code": "set_intent_failed"}

    def record_fill(self, fill_data: dict):
        """Registriert einen Tankbeleg (Wallet-Ledger)."""
        try:
            from .feedback import record_fill

            return record_fill(self.settings, fill_data, clock=self.clock)
        except Exception:
            return {"error_code": "record_fill_failed"}

    def stats_summary(self, params: dict):
        """Drei-Schichten-Statistik: Markt-Backtest, Live-Advice, Wallet."""
        try:
            from .stats_summary import evaluate_stats_summary

            return evaluate_stats_summary(self, params)
        except Exception:
            return {"error_code": "stats_summary_failed"}

    def day_series(self, station_id: str, day: str):
        """Tageskurve für das Stations-Labor im Statistik-Bereich.

        Quelle ist die Engine-Veröffentlichung (runtime/engine/current.json).
        Wenn keine Engine-Daten vorhanden sind, wird ein leeres Array
        zurückgegeben — keine Demo-Daten, keine erfundenen Punkte.
        """
        try:
            metas, _ = metadata(self.settings)
            # Bestimme die Stadt der Station aus den Metadaten
            city_for_station = None
            for (city, uid), _meta in metas.items():
                if uid == station_id:
                    city_for_station = city
                    break

            if not city_for_station:
                return {
                    "ok": False,
                    "station_id": station_id,
                    "day": day,
                    "points": [],
                    "error_code": "unknown_station",
                }

            bundle = publication(self.settings)
            points: list[dict[str, Any]] = []
            for row in bundle.get("forecasts", []) or []:
                if row.get("station_id") != station_id:
                    continue
                if row.get("city") != city_for_station:
                    continue
                forecast_points = row.get("points") or []
                try:
                    target_date = dt.date.fromisoformat(day)
                except Exception:
                    return {
                        "ok": False,
                        "station_id": station_id,
                        "day": day,
                        "points": [],
                        "error_code": "invalid_day",
                    }
                for fp in forecast_points:
                    try:
                        ts = dt.datetime.fromisoformat(
                            str(fp.get("timestamp", "")).replace("Z", "+00:00")
                        )
                    except Exception:
                        continue
                    local_date = (
                        ts.astimezone(BERLIN_TZ).date() if ts.tzinfo else ts.date()
                    )
                    if local_date != target_date:
                        continue
                    q50 = fp.get("q50")
                    if q50 is None:
                        continue
                    # €/L → ct/L
                    ct_value = round(float(q50) * 100.0, 1)
                    points.append(
                        {
                            "h": ts.astimezone(BERLIN_TZ).hour
                            if ts.tzinfo
                            else ts.hour,
                            "ct": ct_value,
                            "open": True,
                        }
                    )
                if points:
                    break

            return {
                "ok": True,
                "station_id": station_id,
                "day": day,
                "points": points,
                "source": "engine" if points else None,
            }
        except Exception:
            return {
                "ok": False,
                "station_id": station_id,
                "day": day,
                "points": [],
            }
