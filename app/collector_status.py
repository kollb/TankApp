"""Pi/tmpfs Livestatus — Collector-Herzschlag ans NAS.

Der Collector schreibt alle Polls in /dev/shm/tankapp/*.jsonl und pflegt
meta/heartbeat.json. Der Uploader schreibt zusätzlich einen Punkt
`collector_status` in InfluxDB. Das NAS liest den letzten Punkt aus
InfluxDB und zeigt ihn im System-Bereich.

Quellen (in dieser Reihenfolge):
  1. InfluxDB Measurement `collector_status` (primär, nur /api/v1/collector/status)
  2. `runtime/collector/heartbeat.json` — vom Collector per
     POST /api/v1/collector/heartbeat abgelegt (Fallback ohne InfluxDB)
  3. lokales `meta/heartbeat.json` (NAS selbst Pi / TANKAPP_POLL_DIR)

/api/v1/health nutzt nur die lokalen Quellen 2+3 (kein Netzwerk), damit der
Docker-Healthcheck nicht von InfluxDB-Antwortzeiten abhängt.

Falls keine Quelle einen Punkt liefert, wird ein expliziter Hinweis
zurückgegeben, statt einen Status zu erfinden.
"""

import datetime as dt
import json
import os
from pathlib import Path

UTC = dt.timezone.utc


def read_json(path, default=None):
    try:
        if path.stat().st_size > 10_000_000:
            return default
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return default


def local_heartbeat(poll_dir: Path):
    """Liest meta/heartbeat.json aus dem lokalen tmpfs-Puffer (für Tests oder wenn NAS selbst Pi ist)."""
    hb_path = poll_dir / "meta" / "heartbeat.json"
    data = read_json(hb_path, None)
    if not isinstance(data, dict):
        return None
    return data


def collector_status_from_influx(settings, query_func, clock):
    """Query latest collector_status measurement from InfluxDB."""
    try:
        import export_influx as influx

        if not settings.influx_env.is_file():
            return {"error_code": "influx_not_configured", "available": False}

        cfg = influx.load_config(settings.influx_env, timeout=10)
        cfg.validate()

        now = clock()
        flux = (
            f'from(bucket: "{cfg.bucket}")\n'
            f"  |> range(start: -7d)\n"
            f'  |> filter(fn: (r) => r["_measurement"] == "collector_status")\n'
            f'  |> sort(columns: ["_time"], desc: true)\n'
            # Long-Format: jedes Feld eine Zeile — 50 deckt den jüngsten Punkt
            # (~10 Felder) plus Vorgänger sicher ab.
            f"  |> limit(n: 50)\n"
        )
        rows = list(query_func(cfg, flux))
        if not rows:
            return {"error_code": "collector_no_heartbeat", "available": False}

        latest = None
        latest_time = None
        for raw in rows:
            t_str = raw.get("_time") or raw.get("timestamp") or raw.get("time")
            if not t_str:
                continue
            try:
                ts = dt.datetime.fromisoformat(t_str.replace("Z", "+00:00"))
            except Exception:
                continue
            if latest_time is None or ts > latest_time:
                latest_time = ts
                latest = raw

        if latest is None:
            grouped = {}
            for raw in rows:
                t = raw.get("_time")
                if not t:
                    continue
                grouped.setdefault(t, {}).update(raw)
            if grouped:
                latest_t = sorted(grouped.keys())[-1]
                latest = grouped[latest_t]
                try:
                    latest_time = dt.datetime.fromisoformat(
                        latest_t.replace("Z", "+00:00")
                    )
                except Exception:
                    latest_time = now
            else:
                return {"error_code": "collector_no_heartbeat", "available": False}

        fields = {}
        for raw in rows:
            raw_t = raw.get("_time")
            if raw_t:
                try:
                    rt = dt.datetime.fromisoformat(raw_t.replace("Z", "+00:00"))
                    if abs((rt - latest_time).total_seconds()) > 5:
                        continue
                except Exception:
                    pass
            f = raw.get("_field")
            v = raw.get("_value")
            if f and v is not None:
                fields[f] = v
            for k in (
                "last_poll_at",
                "tmpfs_used_bytes",
                "tmpfs_free_bytes",
                "tmpfs_total_bytes",
                "oldest_age_days",
                "poll_count",
                "host",
                "city",
            ):
                if k in raw:
                    fields[k] = raw[k]

        for k, v in latest.items():
            if k not in ("_time", "_field", "_value", "_measurement"):
                fields.setdefault(k, v)

        age_minutes = (now - latest_time).total_seconds() / 60 if latest_time else None

        return {
            "available": True,
            "last_heartbeat_at": latest_time.isoformat() if latest_time else None,
            "age_minutes": round(age_minutes, 1) if age_minutes is not None else None,
            "fresh": age_minutes is not None and age_minutes <= 15,
            "fields": fields,
            "raw_time": latest_time.isoformat() if latest_time else None,
        }

    except Exception as e:
        result = {
            "error_code": "influx_read_failed",
            "available": False,
            "detail": type(e).__name__,
        }
        # ExportError trägt eine bewusst credential-freie Meldung (HTTP-Status,
        # CSV-Format, Netz-Ursache). Andere, unerwartete Fehler geben nur den
        # Typnamen weiter — nie eine Rohmeldung, die Zugangsdaten enthalten könnte.
        if isinstance(e, influx.ExportError):
            result["message"] = str(e)
        return result


def nas_heartbeat(settings):
    """Liest das vom Collector per POST abgelegte Herzschlag-File (ohne InfluxDB)."""
    data = read_json(settings.runtime / "collector" / "heartbeat.json", None)
    if not isinstance(data, dict) or not data:
        return None
    out = {
        "timestamp": data.get("timestamp") or data.get("last_poll"),
        "city": data.get("city"),
        "open_count": data.get("open_count"),
        "total_count": data.get("total_count"),
        "poll_interval_s": data.get("poll_interval_s"),
    }
    for src, dst in (
        ("tmpfs_used_mb", "tmpfs_used_bytes"),
        ("tmpfs_total_mb", "tmpfs_total_bytes"),
    ):
        value = data.get(src)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            out[dst] = int(value * 1_000_000)
    age = data.get("oldest_file_age_days")
    if isinstance(age, (int, float)) and not isinstance(age, bool):
        out["oldest_age_days"] = age
    if not out["timestamp"]:
        return None
    return out


def _age_minutes(ts_raw: str, clock) -> float | None:
    try:
        stamp = dt.datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=UTC)
        return round((clock() - stamp).total_seconds() / 60, 1)
    except Exception:
        return None


def build_collector_status(settings, query_func, clock, allow_influx=True):
    """Combine Influx heartbeat, NAS heartbeat file and local tmpfs.

    allow_influx=False (verwendet /api/v1/health): keine Netzwerk-Queries,
    nur lokale Quellen — der Healthcheck muss ohne InfluxDB-Antwortzeiten
    funktionieren (Docker HEALTHCHECK hat 3–5 s Budget).
    """
    if allow_influx:
        try:
            influx_part = collector_status_from_influx(settings, query_func, clock)
        except Exception:
            influx_part = {"available": False, "error_code": "influx_read_failed"}
    else:
        influx_part = {
            "available": False,
            "error_code": "influx_not_queried",
            "detail": "nur /api/v1/collector/status fragt InfluxDB ab",
        }

    poll_dir_env = os.environ.get("TANKAPP_POLL_DIR")
    local = None
    try:
        if poll_dir_env:
            local = local_heartbeat(Path(poll_dir_env))
        else:
            for cand in [
                settings.data / "poll",
                settings.runtime / "poll",
                Path("/dev/shm/tankapp"),
            ]:
                if cand.is_dir():
                    local = local_heartbeat(cand)
                    if local:
                        break
    except Exception:
        local = None

    try:
        nas = nas_heartbeat(settings)
    except Exception:
        nas = None

    result = {
        "generated_at": clock().isoformat(),
        "influx": influx_part,
        "local": local,
        "nas": nas,
        "available": bool(
            influx_part.get("available", False)
            or (local is not None)
            or (nas is not None)
        ),
    }

    if influx_part.get("available"):
        result["source"] = "influx"
        result["last_poll_at"] = influx_part.get("fields", {}).get(
            "last_poll_at"
        ) or influx_part.get("last_heartbeat_at")
        result["age_minutes"] = influx_part.get("age_minutes")
        result["fresh"] = influx_part.get("fresh")
        result["tmpfs_used_bytes"] = influx_part.get("fields", {}).get(
            "tmpfs_used_bytes"
        )
        result["tmpfs_total_bytes"] = influx_part.get("fields", {}).get(
            "tmpfs_total_bytes"
        )
        result["tmpfs_free_bytes"] = influx_part.get("fields", {}).get(
            "tmpfs_free_bytes"
        )
        result["oldest_age_days"] = influx_part.get("fields", {}).get("oldest_age_days")
    elif nas:
        result["source"] = "nas"
        result["last_poll_at"] = nas["timestamp"]
        age = _age_minutes(nas["timestamp"], clock)
        result["age_minutes"] = age
        result["fresh"] = age is not None and age <= 15
        result["tmpfs_used_bytes"] = nas.get("tmpfs_used_bytes")
        result["tmpfs_total_bytes"] = nas.get("tmpfs_total_bytes")
        result["tmpfs_free_bytes"] = None
        result["oldest_age_days"] = nas.get("oldest_age_days")
        result["city"] = nas.get("city")
        result["open_count"] = nas.get("open_count")
        result["total_count"] = nas.get("total_count")
    elif local:
        result["source"] = "local"
        result["last_poll_at"] = local.get("last_poll_at")
        try:
            lp = dt.datetime.fromisoformat(
                local.get("last_poll_at", "").replace("Z", "+00:00")
            )
            age = (clock() - lp).total_seconds() / 60
            result["age_minutes"] = round(age, 1)
            result["fresh"] = age <= 15
        except Exception:
            result["age_minutes"] = None
            result["fresh"] = False
        tmpfs = local.get("tmpfs", {})
        result["tmpfs_used_bytes"] = tmpfs.get("used_bytes")
        result["tmpfs_total_bytes"] = tmpfs.get("total_bytes")
        result["tmpfs_free_bytes"] = tmpfs.get("free_bytes")
        result["oldest_age_days"] = local.get("oldest_file", {}).get("age_days")

    return result
