#!/usr/bin/env python3
"""
TankApp – Demo-Rohdaten im Format des Tankerkönig-Datenrepos (für Tests ohne Netzzugang).

Erzeugt genau das Schema, das `data-tools/ingest_history.py` erwartet:

  <outdir>/prices/YYYY/MM/YYYY-MM-DD-prices.csv.gz
      date,station_uuid,diesel,e5,e10,dieselchange,e5change,e10change
  <outdir>/stations/YYYY/MM/YYYY-MM-DD-stations.csv.gz
      uuid,name,brand,street,house_number,post_code,city,latitude,longitude

Deterministisch (Seed), mit echsen Preisdynamiken: 20-Minuten-Takt, Morgen-/Abendspitzen,
Zyklen pro Marke, Preisänderungen nur bei |Δ| > Schwelle (damit change-Flags 0/1/3
sinnvoll belegt sind). Kein Ersatz für echte Daten — nur, um Pipeline und Formate zu üben.

  python3 data-tools/make_demo_raw.py --days 21 --stations 140 --outdir data/raw
  python3 data-tools/ingest_history.py --raw data/raw/prices --anchor "Test:50.11,8.68" \
      --radius 25 --resample 30 --out data/ready
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import math
import random
from pathlib import Path

BRANDS = ("JET", "HEM", "Aral", "Shell", "Esso", "Total", "Star", "bft", "Agip", "Sprint")
FUELS = ("diesel", "e5", "e10")
LEVEL = {"diesel": 1.72, "e5": 1.82, "e10": 1.79}
STEP = dt.timedelta(minutes=20)


def city_cycle(hour_frac: float) -> float:
    """Intraday-Muster: zwei Änderungen/Tag (morgens hoch, nachmittags runter)."""
    return (0.030 * math.sin(2 * math.pi * (hour_frac - 7) / 24)
            + 0.012 * math.sin(4 * math.pi * (hour_frac - 15) / 24))


def main() -> int:
    ap = argparse.ArgumentParser(description="Demo-Rohhistorie im Tankerkönig-CSV-Format erzeugen.")
    ap.add_argument("--outdir", type=Path, default=Path("data/raw"))
    ap.add_argument("--days", type=int, default=21)
    ap.add_argument("--end", default=None, help="letztes Datum YYYY-MM-DD (Default: heute-2)")
    ap.add_argument("--stations", type=int, default=140, help="Stationen im Test-Umkreis")
    ap.add_argument("--far-stations", type=int, default=400,
                    help="Stationen bundesweit (außerhalb des Radius, für Filtertest)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-gzip", action="store_true")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    end = (dt.date.fromisoformat(args.end) if args.end
           else dt.date.today() - dt.timedelta(days=2))
    start = end - dt.timedelta(days=args.days - 1)
    suffix = "" if args.no_gzip else ".gz"
    center = (50.110, 8.682)          # grob Frankfurt — Demo, keine echten Daten

    def mk_station(i: int, near: bool) -> dict:
        if near:
            lat = center[0] + rng.uniform(-0.20, 0.20)
            lon = center[1] + rng.uniform(-0.28, 0.28)
            city = rng.choice(["Frankfurt", "Offenbach", "Bad Homburg", "Kelsterbach"])
            plz = rng.choice(["60313", "60528", "63065", "61350"])
        else:
            lat = rng.uniform(47.6, 54.3)
            lon = rng.uniform(6.4, 14.6)
            city = rng.choice(["Muenchen", "Koeln", "Hamburg", "Leipzig", "Stuttgart"])
            plz = f"{rng.randint(10, 99):02d}000"
        return {"uuid": f"{i:08d}-0000-4000-8000-000000000000",
                "name": f"{rng.choice(BRANDS)} {city} {i}",
                "brand": rng.choice(BRANDS), "street": "Demostraße", "house_number": str(i % 90 + 1),
                "post_code": plz, "city": city, "lat": round(lat, 6), "lon": round(lon, 6),
                "bias": rng.uniform(-0.045, 0.030), "phase": rng.uniform(0, 24)}

    stations = [mk_station(i, True) for i in range(1, int(args.stations) + 1)]
    stations += [mk_station(i, False) for i in range(int(args.stations) + 1,
                                                     int(args.stations) + int(args.far_stations) + 1)]

    # --- stations-Liste (nur für den letzten Tag — wie im echten Repo täglich) ---
    sp = args.outdir / "stations" / f"{end.year:04d}" / f"{end.month:02d}" / f"{end}-stations.csv{suffix}"
    sp.parent.mkdir(parents=True, exist_ok=True)
    opener = gzip.open if suffix else open
    with opener(sp, "wt", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["uuid", "name", "brand", "street", "house_number", "post_code", "city",
                    "latitude", "longitude"])
        for s in stations:
            w.writerow([s["uuid"], s["name"], s["brand"], s["street"], s["house_number"],
                        s["post_code"], s["city"], f"{s['lat']:.6f}", f"{s['lon']:.6f}"])

    # --- prices: Änderungen je 20-Minuten-Takt, change-Flags 0/1/3 realistisch ---
    level = {s["uuid"]: {fu: LEVEL[fu] + s["bias"] + rng.uniform(-0.02, 0.02) for fu in FUELS}
             for s in stations}
    total_rows = 0
    day = start
    while day <= end:
        rows: list[list] = []
        t = dt.datetime.combine(day, dt.time(0, 0))
        day_end = t + dt.timedelta(days=1)
        # Zeilen aus Preisdifferenz zum Tagesanfang bauen
        t = dt.datetime.combine(day, dt.time(0, 0))
        snap = {s["uuid"]: dict(level[s["uuid"]]) for s in stations}
        while t < day_end:
            hour_frac = t.hour + t.minute / 60
            for s in stations:
                changed = {}
                for fu in FUELS:
                    if rng.random() < 0.06 * (1 + 1.4 * max(0.0, math.sin(math.pi * (hour_frac - 13)))):
                        nv = round(min(max(snap[s["uuid"]][fu] + rng.gauss(0, 0.012), 1.45), 2.35), 3)
                        changed[fu] = nv
                if not changed:
                    continue
                row = {"date": t.strftime("%Y-%m-%d %H:%M:%S"), "station_uuid": s["uuid"]}
                for fu in FUELS:
                    if fu in changed:
                        snap[s["uuid"]][fu] = changed[fu]
                        row[fu] = f"{changed[fu]:.3f}"
                        row[f"{fu}change"] = "3" if t == dt.datetime.combine(day, dt.time(0, 0)) else "1"
                    else:
                        row[fu] = f"{snap[s['uuid']][fu]:.3f}"
                        row[f"{fu}change"] = "0"
                # gelegentlich "nicht geführt" (0 statt Preis)
                if rng.random() < 0.002 and "e5" in row and row["e5change"] == "0":
                    row["e5"] = "0"
                rows.append([row[k] for k in ("date", "station_uuid", "diesel", "e5", "e10",
                                               "dieselchange", "e5change", "e10change")])
            t += STEP
        total_rows += len(rows)
        pp = args.outdir / "prices" / f"{day.year:04d}" / f"{day.month:02d}" / f"{day}-prices.csv{suffix}"
        pp.parent.mkdir(parents=True, exist_ok=True)
        with opener(pp, "wt", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["date", "station_uuid", "diesel", "e5", "e10", "dieselchange",
                        "e5change", "e10change"])
            w.writerows(sorted(rows))
        day += dt.timedelta(days=1)
    print(f"# Demo-Rohdaten: {len(stations)} Stationen ({int(args.stations)} im Umkreis von "
          f"{center[0]}/{center[1]}), {args.days} Tage ({start}…{end}), {total_rows:,} Zeilen")
    print(f"# Ablage: {args.outdir}/  → weiter mit data-tools/ingest_history.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
