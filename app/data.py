"""Read-only live data and public projections. No price API calls, no demo fallback."""

import datetime as dt
import json
import math
import threading
import time

import export_influx as influx
from polling_plan import validate_sets

UTC = dt.timezone.utc
FUELS = {"e10", "e5", "diesel"}


def haversine_km(lat1, lon1, lat2, lon2):
    """Luftlinie für das Entfernungs-Bubble; kein Routing, keine Dritt-API."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    inner = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    )
    return 6371.0 * 2 * math.asin(math.sqrt(inner))


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
    for key, group in groups.items():
        city = group.get("label") or key
        # The set anchor is a private home position (add-city); only derived
        # distances leave the server, never the coordinates themselves.
        anchor = group.get("anchor")
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
            # Rebuild links, never trust arbitrary URLs from a config file.
            stations[(city, uid)] = {
                "station_id": uid,
                "city": city,
                "name": item.get("name") or uid,
                "brand": item.get("brand") or "",
                "lat": lat if coordinates else None,
                "lon": lon if coordinates else None,
                "dist_km": round(haversine_km(anchor[0], anchor[1], lat, lon), 1)
                if anchor_ok and coordinates
                else None,
                "maps_url": f"https://www.google.com/maps/dir/?api=1&destination={lat},{lon}"
                if coordinates
                else None,
            }
    return stations, None


def public_job(settings, name):
    raw = read_json(settings.runtime / "jobs" / f"{name}.json", {})
    if not isinstance(raw, dict):
        raw = {}
    return {
        key: raw.get(key)
        for key in (
            "state",
            "started_at",
            "finished_at",
            "last_success_at",
            "next_run_at",
            "error_code",
        )
    }


def publication(settings):
    raw = read_json(settings.runtime / "engine/current.json", {})
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
                    for raw in self.query(cfg, query):
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
                except (ValueError, OSError, KeyError, TypeError):
                    # A partial/failed query must not become a new successful snapshot.
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

    def health(self):
        job_errors = self.job_errors.copy()
        metas, problem = metadata(self.settings)
        # NAS worker keeps state/lock on the SSD runtime (Unraid HDD stays
        # asleep); manual history-sync uses <archive>/.sync. Prefer the
        # worker location so /health and System show the real sync state
        # without waking the archive disk on every request.
        archive = read_json(
            self.settings.runtime / "jobs" / "archive-sync" / "state.json", None
        )
        if not isinstance(archive, dict):
            archive = read_json(self.settings.archive / ".sync/state.json", {})
        if not isinstance(archive, dict):
            archive = {}
        bundle = publication(self.settings)
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
                }
                for name in ("archive", "models")
            },
            "models": {
                "published_at": bundle.get("published_at"),
                "count": len(bundle.get("forecasts", [])),
                "calibrated": False,
                "decision_ready": False,
            },
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

        # Filtere nur gültige Prognosen
        valid_forecasts = []
        for row in forecasts:
            if not all(
                k in row for k in ["station_id", "city", "fuel", "origin", "points"]
            ):
                continue
            valid_forecasts.append(row)

        return {
            "generated_at": bundle.get("published_at"),
            "forecasts": valid_forecasts,
            "count": len(valid_forecasts),
            "calibrated": False,
            "decision_ready": False,
        }
