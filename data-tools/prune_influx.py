#!/usr/bin/env python3
"""
TankApp – InfluxDB Prune: löscht alte Punkte, um SSD-Platz zu sparen.

Hintergrund (SPEICHER.md 4.2): Influx liegt bewusst auf SSD (alle 30 s gelesen),
wächst aber mit 5-Jahre-Retention (43800h) auf mehrere GB. Wer nur 1 Jahr
braucht (Modelle nutzen 120 Tage roh, danach Archiv), kann hier alte Daten
löschen oder die Retention per CLI kürzen:

  docker exec tankapp-influxdb influx bucket update --org gtwrlab --name tankapp --retention 8760h

Dieses Skript nutzt die InfluxDB Delete API (2.x) und löscht per Zeitfenster,
ohne das Volume zu bewegen — HDD bleibt schlafend, nur Influx auf SSD wird
kleiner. Nur Standardbibliothek.
"""

import argparse
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV = ROOT / "data" / "influx.env"


def load_env(path: Path):
    env = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


def parse_args():
    ap = argparse.ArgumentParser(description="InfluxDB alte Daten löschen (SSD sparen)")
    ap.add_argument("--url", default=os.environ.get("TANKAPP_INFLUX_URL", ""))
    ap.add_argument("--org", default=os.environ.get("TANKAPP_INFLUX_ORG", ""))
    ap.add_argument("--bucket", default=os.environ.get("TANKAPP_INFLUX_BUCKET", ""))
    ap.add_argument("--token", default=os.environ.get("TANKAPP_INFLUX_TOKEN", ""))
    ap.add_argument("--env-file", type=Path, default=DEFAULT_ENV, help="influx.env mit URL/ORG/BUCKET/TOKEN")
    ap.add_argument("--older-than-days", type=int, default=365, help="Lösche Daten älter als N Tage (Default 365)")
    ap.add_argument("--dry-run", action="store_true", help="Nur zeigen, was gelöscht würde")
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    env_file = load_env(args.env_file) if args.env_file else {}
    url = args.url or env_file.get("TANKAPP_INFLUX_URL") or env_file.get("INFLUX_URL") or ""
    org = args.org or env_file.get("TANKAPP_INFLUX_ORG") or env_file.get("INFLUX_ORG") or ""
    bucket = args.bucket or env_file.get("TANKAPP_INFLUX_BUCKET") or env_file.get("INFLUX_BUCKET") or ""
    token = args.token or env_file.get("TANKAPP_INFLUX_TOKEN") or env_file.get("INFLUX_TOKEN") or ""

    if not (url and org and bucket and token):
        print("Fehlende Influx-Konfiguration: URL/ORG/BUCKET/TOKEN (env oder --env-file)", file=sys.stderr)
        return 1

    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=args.older_than_days)
    start = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
    # Influx Delete API erwartet RFC3339
    body = {
        "start": start.isoformat(),
        "stop": cutoff.isoformat(),
        "predicate": "",  # alles
    }
    print(f"Prune: lösche {bucket} älter als {args.older_than_days} Tage (bis {cutoff.isoformat()})")
    print(f"  URL={url} org={org} bucket={bucket}")
    if args.dry_run:
        print("[dry-run] nichts gelöscht. Ohne --dry-run würde per POST /api/v2/delete gelöscht.")
        print(f"  Body: {json.dumps(body)}")
        return 0

    qs = urllib.parse.urlencode({"org": org, "bucket": bucket})
    req = urllib.request.Request(
        f"{url.rstrip('/')}/api/v2/delete?{qs}",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Token {token}",
            "Content-Type": "application/json",
            "User-Agent": "TankApp-Prune/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"Delete OK (HTTP {r.status}) — alte Punkte entfernt, SSD wird kleiner.")
            return 0
    except Exception as e:
        print(f"Delete fehlgeschlagen: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
