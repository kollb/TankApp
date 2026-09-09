"""Causal event adapter for raw archive files, separate from M2 bucket medians.

No interpolation, bucket-flooring, invented opening status or additional polls.
Event timestamps require their original offset. Archive availability (next day)
is NOT the same as event time; retrospective tests remain labelled accordingly.
"""

import csv
import datetime as dt
import gzip
import hashlib
import json
import math
import os
import tempfile
from pathlib import Path

from tankapp import date_files
from polling_plan import atomic_json

COLUMNS = (
    "timestamp",
    "station_id",
    "city",
    "station_name",
    "fuel",
    "price",
    "status",
    "source",
)


def open_csv(path):
    return (
        gzip.open(path, "rt", encoding="utf-8-sig", newline="")
        if path.suffix == ".gz"
        else path.open(encoding="utf-8-sig", newline="")
    )


def event_time(value):
    try:
        stamp = dt.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            return None
        return stamp.astimezone(dt.timezone.utc)
    except (ValueError, AttributeError):
        return None


def event_price(value):
    try:
        price = float(value)
        if price > 50:
            price /= 1000 if price > 500 else 100
        return price if math.isfinite(price) and 0.4 <= price <= 5 else None
    except (ValueError, TypeError):
        return None


def convert_day(source: Path, destination: Path, stations: dict, fuels: tuple):
    """UUID -> metadata. Removal/invalid changed price emits a fill-stopping barrier."""
    stats = {"events": 0, "barriers": 0, "invalid_timestamps": 0, "invalid_flags": 0}
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=destination.parent, suffix=".tmp")
    os.close(fd)
    try:
        with (
            open_csv(source) as source_file,
            gzip.open(temporary, "wt", encoding="utf-8", newline="") as output,
        ):
            reader = csv.DictReader(source_file)
            required = {
                "date",
                "station_uuid",
                *fuels,
                *(fuel + "change" for fuel in fuels),
            }
            if not required <= set(reader.fieldnames or []):
                raise ValueError(
                    "Archiv-Spalten fehlen; Rohdateien statt M2-CSVs erforderlich."
                )
            writer = csv.DictWriter(output, fieldnames=COLUMNS)
            writer.writeheader()
            for raw in reader:
                uid = raw.get("station_uuid", "").strip()
                if uid not in stations:
                    continue
                stamp = event_time(raw.get("date"))
                if stamp is None:
                    stats["invalid_timestamps"] += 1
                    continue
                for fuel in fuels:
                    flag = (raw.get(fuel + "change") or "").strip()
                    if flag == "0":
                        continue
                    price = event_price(raw.get(fuel)) if flag in ("1", "3") else None
                    if flag not in ("1", "2", "3"):
                        stats["invalid_flags"] += 1
                    if price is None:
                        stats["barriers"] += 1
                    writer.writerow(
                        {
                            "timestamp": stamp.isoformat(),
                            "station_id": uid,
                            "city": stations[uid]["city"],
                            "station_name": stations[uid]["name"],
                            "fuel": fuel.upper(),
                            "price": price if price is not None else "",
                            "status": "no prices" if flag == "2" else "",
                            "source": "history",
                        }
                    )
                    stats["events"] += 1
        os.replace(temporary, destination)
        return stats
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def prepare_archive(archive, metas, fuels, start, stop, cache):
    """Cache selected events by raw-file mtime/size and selection; keep national archive intact."""
    stations = {uid: meta for (_, uid), meta in metas.items()}
    fingerprint = hashlib.sha256(
        json.dumps([stations, fuels], sort_keys=True).encode()
    ).hexdigest()[:20]
    directory = cache / fingerprint
    files = date_files(archive, "prices")
    results, quality = (
        [],
        {
            "missing_days": 0,
            "events": 0,
            "barriers": 0,
            "invalid_timestamps": 0,
            "invalid_flags": 0,
        },
    )
    total = (stop - start).days
    converted, cached = 0, 0
    day = start
    while day < stop:
        source = files.get(day)
        if source is None:
            quality["missing_days"] += 1
            day += dt.timedelta(days=1)
            continue
        destination = directory / f"{day}.csv.gz"
        manifest = directory / f"{day}.json"
        stat = source.stat()
        signature = [str(source.resolve()), stat.st_size, stat.st_mtime_ns, 1]
        try:
            prior = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            prior = {}
        if not destination.is_file() or prior.get("signature") != signature:
            stats = convert_day(source, destination, stations, fuels)
            prior = {"signature": signature, "quality": stats}
            atomic_json(manifest, prior)
            converted += 1
            print(
                f"models: Archiv {day} aufbereitet "
                f"({converted + cached}/{total} Tage, "
                f"{stats['events']} Ereignisse)",
                flush=True,
            )
        else:
            cached += 1
        for key, value in prior["quality"].items():
            quality[key] += value
        results.append(destination)
        day += dt.timedelta(days=1)
    if total:
        print(
            f"models: Archiv-Cache: {converted} Tage aufbereitet, "
            f"{cached} aus Cache, {quality['missing_days']} fehlend",
            flush=True,
        )
    return results, quality
