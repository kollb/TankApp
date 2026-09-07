#!/usr/bin/env python3
"""Read-only InfluxDB 2.x export for M3. No writes, deletes or collector ACKs.

The existing uploader uses city + station NAME as tags. polling.json is needed
for an unambiguous join back to the historical UUIDs. Collisions are errors,
never guessed matches. Only Python >= 3.9's standard library is required.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import http.client
import io
import json
import math
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
COLUMNS = [
    "timestamp",
    "station_id",
    "station_name",
    "brand",
    "city",
    "lat",
    "lon",
    "fuel",
    "price",
    "status",
    "source",
]
UTC = dt.timezone.utc


@dataclass(frozen=True)
class InfluxConfig:
    url: str
    org: str
    bucket: str
    token: str = field(repr=False)
    timeout: int = 60

    def validate(self):
        parsed = urllib.parse.urlsplit(self.url)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "TANKAPP_INFLUX_URL: http(s)-Adresse ohne Zugangsdaten/Query erforderlich."
            )
        if not self.org or not self.bucket or not self.token:
            raise ValueError(
                "TANKAPP_INFLUX_ORG, _BUCKET und _TOKEN setzen (nur Lese-Token nötig)."
            )
        if not 1 <= self.timeout <= 600:
            raise ValueError("Timeout muss zwischen 1 und 600 Sekunden liegen.")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the Authorization header to an unexpected host.
        return None


def instant(value: str, timezone: str = "Europe/Berlin") -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        zone = ZoneInfo(timezone)
        first, second = (
            parsed.replace(tzinfo=zone, fold=0),
            parsed.replace(tzinfo=zone, fold=1),
        )
        if first.utcoffset() != second.utcoffset():
            raise ValueError(
                "Mehrdeutige/nicht existente lokale Zeit; UTC-Offset explizit angeben."
            )
        parsed = first
    return parsed.astimezone(UTC)


def time_windows(start: dt.datetime, stop: dt.datetime):
    if start >= stop:
        raise ValueError("--since muss vor --until liegen (until ist exklusiv).")
    while start < stop:
        end = min(start + dt.timedelta(days=1), stop)
        yield start, end
        start = end


def station_lookup(path: Path, city: str | None = None) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    lookup: dict[tuple[str, str], dict[str, dict]] = {}
    for key, stset in (payload.get("sets") or {}).items():
        label = stset.get("label") or key
        if city and city not in (key, label):
            continue
        batch = set(stset.get("batch") or [])
        for station in stset.get("stations", []):
            uid = station.get("uuid")
            if not uid or (batch and uid not in batch):
                continue
            for alias in {uid, station.get("name") or uid}:
                lookup.setdefault((label, alias), {})[uid] = station
        # Old/minimal polling sets may contain UUIDs without metadata.
        for uid in batch:
            lookup.setdefault((label, uid), {}).setdefault(
                uid, {"uuid": uid, "name": uid}
            )
    if not lookup:
        raise ValueError("Keine Stationen in polling.json / für die gewählte Stadt.")
    return lookup


def flux_query(
    bucket: str, fuel: str, start: dt.datetime, stop: dt.datetime, cities: list[str]
) -> str:
    if fuel not in ("e5", "e10", "diesel"):
        raise ValueError("Kraftstoff muss e5, e10 oder diesel sein.")

    # json.dumps produces valid Flux string literals, including escaped quotes.
    def quote(value):
        return json.dumps(value, ensure_ascii=False)

    return (
        f"from(bucket: {quote(bucket)})\n"
        f"  |> range(start: time(v: {quote(start.isoformat())}), stop: time(v: {quote(stop.isoformat())}))\n"
        '  |> filter(fn: (r) => r._measurement == "prices")\n'
        f"  |> filter(fn: (r) => contains(value: r.city, set: {quote(sorted(cities))}))\n"
        f'  |> filter(fn: (r) => r._field == "status" or r._field == {quote(fuel)})\n'
        '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n'
        f'  |> keep(columns: ["_time", "city", "station", "status", {quote(fuel)}])\n'
        '  |> sort(columns: ["_time"])\n'
    )


def query_rows(cfg: InfluxConfig, query: str):
    cfg.validate()
    url = (
        cfg.url.rstrip("/")
        + "/api/v2/query?"
        + urllib.parse.urlencode({"org": cfg.org})
    )
    body = json.dumps(
        {
            "query": query,
            "type": "flux",
            "dialect": {
                "header": True,
                "delimiter": ",",
                "annotations": ["datatype", "group", "default"],
            },
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Token {cfg.token}",
            "Accept": "application/csv",
            "Content-Type": "application/json",
            "User-Agent": "TankApp-ReadOnly-Export/1.0",
        },
    )
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=cfg.timeout) as response:
            text = io.TextIOWrapper(response, encoding="utf-8-sig", newline="")
            try:
                yield from parse_flux_csv(text)
                # HTTPResponse.read1 (used by TextIOWrapper) can accept an early
                # EOF without raising IncompleteRead. Check Content-Length too.
                if getattr(response, "length", None) not in (None, 0):
                    raise ValueError(
                        "Unvollständige HTTP-Antwort; Export bleibt unverändert."
                    )
            finally:
                text.close()
    except urllib.error.HTTPError as exc:
        hints = {
            401: "Token fehlt/falsch",
            403: "Token braucht Leserecht für den TankApp-Bucket",
            404: "Org/Bucket/InfluxDB-2.x-URL prüfen",
            429: "Server ausgelastet; später erneut exportieren",
        }
        # No response body / URL / token in logs (a proxy may echo credentials).
        raise ValueError(
            f"InfluxDB HTTP {exc.code}: " + hints.get(exc.code, "Query/Server prüfen")
        ) from None
    except http.client.IncompleteRead:
        raise ValueError(
            "Unvollständige HTTP-Antwort; Export bleibt unverändert."
        ) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ValueError(
            "InfluxDB nicht erreichbar / Zeitüberschreitung; URL, Netz und NAS prüfen."
        ) from None


def parse_flux_csv(handle):
    header = None
    defaults = []
    for row in csv.reader(handle):
        if row and row[0] == "#default":
            defaults = row
            continue
        if not row or not any(row) or row[0].startswith("#"):
            continue
        if "error" in row and "reference" in row:
            raise ValueError(
                "InfluxDB meldet einen Flux-Query-Fehler; kein Export übernommen."
            )
        if "_time" in row and "station" in row:
            header = row
            if not {"_time", "city", "station", "status"}.issubset(header):
                raise ValueError(
                    "InfluxDB-Schema unvollständig: _time/city/station/status erforderlich."
                )
            continue
        if header is None or len(row) != len(header):
            raise ValueError(
                "Unerwartetes InfluxDB-CSV-Format; kein Export übernommen."
            )
        values = [
            value or (defaults[i] if i < len(defaults) and i else "")
            for i, value in enumerate(row)
        ]
        yield dict(zip(header, values))


def normalized_row(row: dict, lookup: dict, fuel: str) -> dict:
    city, tag = row.get("city", ""), row.get("station", "")
    matches = lookup.get((city, tag), {})
    if len(matches) != 1:
        reason = "mehrdeutig" if matches else "nicht in polling.json"
        raise ValueError(
            f"Influx-Station {city!r}/{tag!r}: {reason}. "
            "Originales Polling-Set prüfen; UUIDs werden nicht geraten. "
            "Gleichnamige Stationen sind im bisherigen Influx-Schema nicht trennbar."
        )
    uid, meta = next(iter(matches.items()))
    timestamp = instant(row["_time"])
    status = row.get("status", "").strip().lower() or "no prices"
    raw = row.get(fuel, "").strip()
    price = ""
    if status == "open" and raw.lower() not in ("", "false", "true", "null"):
        try:
            number = float(raw)
        except ValueError:
            raise ValueError(
                "Nichtnumerischer Preis in InfluxDB; Export abgebrochen."
            ) from None
        if math.isfinite(number) and 0.4 <= number <= 5.0:
            price = f"{number:.3f}"
    return {
        "timestamp": timestamp.isoformat(),
        "station_id": uid,
        "station_name": meta.get("name") or uid,
        "brand": meta.get("brand", ""),
        "city": city,
        "lat": meta.get("lat", ""),
        "lon": meta.get("lon", ""),
        "fuel": fuel.upper(),
        "price": price,
        "status": status,
        "source": "influxdb",
    }


def export_prices(
    cfg: InfluxConfig,
    start: dt.datetime,
    stop: dt.datetime,
    lookup: dict,
    fuel: str,
    output: Path,
) -> dict:
    cfg.validate()
    if not output.name.endswith((".csv", ".csv.gz")):
        raise ValueError(
            "Exportziel muss .csv oder .csv.gz sein, keine Konfigurations-/Pufferdatei."
        )
    windows = list(time_windows(start, stop))
    cities = sorted({city for city, _ in lookup})
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(
        dir=output.parent, prefix=f".{output.name}.", suffix=".tmp"
    )
    os.close(fd)
    summary = {
        "rows": 0,
        "open_prices": 0,
        "queries": len(windows),
        "source": "influxdb",
    }
    try:
        opener = gzip.open if output.suffix == ".gz" else open
        with opener(name, "wt", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=COLUMNS)
            writer.writeheader()
            for lower, upper in windows:
                query = flux_query(cfg.bucket, fuel, lower, upper, cities)
                for raw in query_rows(cfg, query):
                    row = normalized_row(raw, lookup, fuel)
                    if not lower <= instant(row["timestamp"]) < upper:
                        raise ValueError(
                            "InfluxDB lieferte einen Zeitpunkt außerhalb des Query-Fensters."
                        )
                    writer.writerow(row)
                    summary["rows"] += 1
                    summary["open_prices"] += bool(row["price"])
        if not summary["rows"]:
            raise ValueError(
                "Keine InfluxDB-Daten im Zeitraum; bestehende Exportdatei bleibt erhalten."
            )
        os.replace(name, output)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return summary


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--since",
        help="ISO-Datum/Zeit; ohne Offset Europe/Berlin (Default: vor 70 Tagen)",
    )
    parser.add_argument(
        "--until", help="Exklusives Ende; ohne Offset Europe/Berlin (Default: jetzt)"
    )
    parser.add_argument("--fuel", choices=["e5", "e10", "diesel"], default="e10")
    parser.add_argument(
        "--polling", type=Path, default=ROOT / "docs/analysis/stations/polling.json"
    )
    parser.add_argument("--poll-city")
    parser.add_argument(
        "--out", type=Path, help="Default: data/engine/influx_<fuel>.csv.gz"
    )
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Nur Query zeigen; kein Netz, kein Token nötig",
    )
    args = parser.parse_args(argv)
    args.out = args.out or ROOT / f"data/engine/influx_{args.fuel}.csv.gz"
    try:
        stop = instant(args.until) if args.until else dt.datetime.now(UTC)
        start = instant(args.since) if args.since else stop - dt.timedelta(days=70)
        windows = list(time_windows(start, stop))
        lookup = station_lookup(args.polling, args.poll_city)
        cfg = InfluxConfig(
            os.environ.get("TANKAPP_INFLUX_URL", ""),
            os.environ.get("TANKAPP_INFLUX_ORG", ""),
            os.environ.get("TANKAPP_INFLUX_BUCKET", "tankapp"),
            os.environ.get("TANKAPP_INFLUX_TOKEN", ""),
            args.timeout,
        )
        if args.dry_run:
            print(
                f"Nur lesend: {len(windows)} Tages-Queries, {start.isoformat()} bis {stop.isoformat()} (exklusiv)."
            )
            print(
                flux_query(
                    cfg.bucket,
                    args.fuel,
                    *windows[0],
                    sorted({city for city, _ in lookup}),
                )
            )
            return 0
        summary = export_prices(cfg, start, stop, lookup, args.fuel, args.out)
        print(
            f"Export → {args.out}: {summary['rows']} Statuszeilen, "
            f"{summary['open_prices']} gültige {args.fuel.upper()}-Preise, {summary['queries']} Queries."
        )
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(f"Export abgebrochen: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
