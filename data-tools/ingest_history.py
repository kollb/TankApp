#!/usr/bin/env python3
"""
TankApp – Schritt 0b: aus den bundesweiten Tages-CSVs kampagnenfähige Zeitreihen bauen.

Die Rohdateien des Tankerkönig-Datenrepos enthalten pro Tag ALLE Tankstellen Deutschlands
(~14 000 Stationen, ~20 MB/Tag). gebraucht werden aber nur die Stationen im Umfeld der
Ankerpunkte (Home + Kampagnenstädte) — und zwar im Schema aus `analysis/README.md`.
Dieses Skript

  1. wählt Stationen per Radius um die Anker aus (Straße/Hausnummer werden dabei nie
     eingelesen → Datensparsamkeit, keine Adressen in data/),
  2. schwenkt die "Änderungs"-Zeilen (diesel/e5/e10 + *change-Flags) auf lange
     (timestamp, station_id, fuel, price)-Zeilen,
  3. führt Preisstände fort (Zeilen mit change==0 tragen den zuletzt gültigen Preis),
  4. aggregiert optional auf ein festes Raster (--resample 30 → ~8–10× kleiner,
     Median pro Bucket, intraday-Zyklen bleiben erhalten),
  5. schreibt je Kampagne eine CSV nach data/ready/ + optional einen QA-Bericht
     (fehlende Tage, Coverage je Station×Kraftstoff, verworfene Ausreißer).

Nur Standardbibliothek → läuft auf Pi, NAS-Shell und PC ohne `pip install`.

  python3 data-tools/ingest_history.py \
      --config analysis/config.local.json \
      --anchor "Muenchen:48.1374,11.5755" --anchor "Koeln:50.9375,6.9603" \
      --since 2025-01-01 --radius 25 --resample 30 --compress
  python3 analysis/station_selection.py --data data/ready/*.csv --fuel E10 --top 10 \
      --config analysis/config.local.json --subdiv "Muenchen:BY;Koeln:NW"
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

FUELS = ("diesel", "e5", "e10")
ANALYSIS_COLUMNS = ["timestamp", "station_id", "station_name", "brand", "city",
                    "lat", "lon", "fuel", "price"]
EARTH_R_KM = 6371.0088
STATIONS_KEEP = ("uuid", "name", "brand", "post_code", "city", "latitude", "longitude")


# ---------------------------------------------------------------- Geometrie/Auswahl


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_R_KM * math.asin(math.sqrt(a))


def parse_anchor(spec: str) -> tuple[str, float, float]:
    if ":" not in spec:
        raise SystemExit(f"--anchor erwartet 'Label:lat,lon', erhalten: {spec!r}")
    label, _, rest = spec.partition(":")
    try:
        lat, lon = (float(x) for x in rest.replace(";", ",").split(",")[:2])
    except ValueError:
        raise SystemExit(f"--anchor: Koordinaten nicht lesbar: {spec!r}")
    return (label.strip() or "Anker"), lat, lon


def load_config(path: Path | None) -> dict:
    """Anker ('home') + Bundesländer ('subdiv') aus gitignorierter analysis/config.local.json."""
    anchors: dict[str, tuple[float, float]] = {}
    subdivs: dict[str, str] = {}
    if path and path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        for label, ll in (data.get("home") or {}).items():
            try:
                lat, lon = float(ll[0]), float(ll[1])
            except (TypeError, ValueError, IndexError):
                continue
            if (lat, lon) != (0.0, 0.0):      # Platzhalter der Vorlage überspringen
                anchors[label.strip()] = (lat, lon)
        subdivs.update({str(k).strip(): str(v) for k, v in (data.get("subdiv") or {}).items()})
    return {"anchors": anchors, "subdivs": subdivs}


# ---------------------------------------------------------------------- Dateien


def open_text(path: Path):
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt", newline="", encoding="utf-8-sig")
    return open(path, "r", newline="", encoding="utf-8-sig")


def date_of(name: str) -> dt.date | None:
    try:
        return dt.date.fromisoformat(name[:10])
    except ValueError:
        return None


def find_price_files(raw: Path, since: dt.date | None, until: dt.date | None) -> list[Path]:
    out = []
    for p in sorted(raw.rglob("*.csv*")):
        if "stations" in p.parts:
            continue
        if not (p.name.endswith("-prices.csv") or p.name.endswith("-prices.csv.gz")):
            continue
        d = date_of(p.name)
        if d and (since is None or d >= since) and (until is None or d <= until):
            out.append(p)
    return out


def find_stations_file(raw: Path, explicit: Path | None) -> Path | None:
    """Explizit > neueste stations/*.csv(.gz) im data/raw-Baum."""
    if explicit:
        return explicit if explicit.exists() else None
    root = raw.parent if raw.name == "prices" else raw
    pool = [p for p in sorted(root.rglob("*.csv*"))
            if p.name.endswith("-stations.csv") or p.name.endswith("-stations.csv.gz")
            or (p.parent == root and p.name.startswith("stations"))]
    return pool[-1] if pool else None


def load_stations(path: Path, anchors: dict[str, tuple[float, float]], radius_km: float,
                  plz_prefix: str | None, all_stations: bool) -> dict[str, dict]:
    """Tankstellenliste → {uuid: Meta + {label: Distanz}}. Adresse wird nie eingelesen."""
    sel: dict[str, dict] = {}
    with open_text(path) as f:
        rd = csv.DictReader(f)
        cols = {c.strip().lower(): c for c in (rd.fieldnames or [])}
        miss = {c for c in ("uuid", "latitude", "longitude") if c not in cols}
        if miss:
            raise SystemExit(f"Stations-Datei {path}: Spalten {sorted(miss)} fehlen "
                             f"(Header: {rd.fieldnames})")
        for row in rd:
            try:
                lat, lon = float(row[cols["latitude"]]), float(row[cols["longitude"]])
            except (TypeError, ValueError, KeyError):
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            uuid = (row.get(cols["uuid"]) or "").strip()
            if not uuid:
                continue
            plz = (row.get(cols.get("post_code", ""), "") or "").strip()
            if plz_prefix and not plz.startswith(plz_prefix):
                continue
            campaigns = {}
            for label, (alat, alon) in anchors.items():
                dist = haversine_km(lat, lon, alat, alon)
                if dist <= radius_km:
                    campaigns[label] = round(dist, 2)
            if not campaigns and not all_stations:
                continue
            sel[uuid] = {
                "name": (row.get(cols.get("name", ""), "") or "").strip(),
                "brand": (row.get(cols.get("brand", ""), "") or "").strip(),
                "city": (row.get(cols.get("city", ""), "") or "").strip() or plz,
                "post_code": plz,
                "lat": lat, "lon": lon, "campaigns": campaigns,
            }
    return sel


# ------------------------------------------------------------------- Parsing


def parse_price(tok: str | None, lo: float, hi: float) -> float | None:
    """€-Preis; '', '0', '-1' (nicht geführt/ungültig) → None. Cent-Export wird erkannt."""
    if not tok:
        return None
    t = tok.strip()
    if not t or t in ("-", "null", "None", "NULL"):
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    if v <= 0:
        return None
    if v > 10 * hi:               # Zehntel-Cent (z. B. 1789)
        v /= 1000.0
    elif v > 10 * lo and v > hi:  # Cent (z. B. 178.9)
        v /= 100.0
    return v if lo <= v <= hi else None


def parse_timestamp(tok: str) -> dt.datetime | None:
    t = (tok or "").strip().replace("T", " ")
    if not t:
        return None
    for fmt, cut in (("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%d %H:%M", 16), ("%Y-%m-%d", 10)):
        try:
            return dt.datetime.strptime(t[:cut], fmt)
        except ValueError:
            continue
    try:
        return dt.datetime.fromisoformat(t)
    except ValueError:
        return None


def bucket_of(ts: dt.datetime, step_min: int) -> dt.datetime:
    """Rasterstart des Tages (step_min > 1440 bleibt heil, weil über datetime addiert)."""
    if step_min <= 0:
        return ts.replace(second=0, microsecond=0)
    minutes_of_day = ts.hour * 60 + ts.minute
    start = dt.datetime.combine(ts.date(), dt.time(0, 0))
    return start + dt.timedelta(minutes=(minutes_of_day // step_min) * step_min)


def ingest_day(path: Path, stations: dict[str, dict], state: dict[str, dict[str, float]],
               fuels: tuple[str, ...], resample_min: int, lo: float, hi: float,
               day_events: dict[tuple[str, str], set], first_day: bool,
               density_min: int = 0, max_hold_min: int = 0,
               carry: dict[tuple[str, str], tuple[dt.datetime, float]] | None = None,
               ) -> tuple[int, int, list[tuple[dt.datetime, str, str, float]]]:
    """Ein Tagesfile → Output-Zeilen (timestamp, uuid, fuel, price).

    Zwei Ausgaben, die am Ende in dasselbe Raster (max(resample_min, density_min)) fallen:

    * **Änderungen** — jede Zeile mit `*change != 0` liefert den neuen Preis; `state` führt
      ihn über Tage fort (Zeilen mit change==0 tragen denselben Preis, sind aber keine neue
      Beobachtung),
    * **Dichte-Zeilen** (`density_min > 0`) — auf einem Minuten-Raster wird der *gültige Stand*
      geschrieben (maximal `max_hold_min` Minuten alt, sonst NaN-Lücke wie im echten Leben).
      Das ist der Kompromiss für `station_selection.py`, das Coverage auf einem Raster misst
      und die Änderungshistorie sonst als 22-h-Lücke läse.

    `carry[(uuid, fuel)]` = (Zeitpunkt, Preis) des letzten bekannten Stands vom Vortag.
    """
    day = date_of(path.name)
    day_start = dt.datetime.combine(day or dt.date.today(), dt.time(0, 0))
    changes: dict[tuple[str, str], list[tuple[dt.datetime, float]]] = {}
    n_read = n_drop = 0
    with open_text(path) as f:
        rd = csv.reader(f)
        header = next(rd, None)
        if not header:
            return 0, 0, []
        idx = {c.strip().lower(): i for i, c in enumerate(header)}
        for req in ("date", "station_uuid"):
            if req not in idx:
                raise SystemExit(f"{path.name}: Spalte {req!r} fehlt (Header: {header})")
        i_date, i_uuid = idx["date"], idx["station_uuid"]
        i_val = {fu: idx.get(fu) for fu in FUELS}
        i_chg = {fu: idx.get(fu + "change") for fu in FUELS}
        for rec in rd:
            if len(rec) <= i_uuid:
                continue
            n_read += 1
            uuid = rec[i_uuid].strip()
            if uuid not in stations:
                continue
            ts = parse_timestamp(rec[i_date])
            if ts is None:
                n_drop += 1
                continue
            for fu in fuels:
                j, k = i_val.get(fu), i_chg.get(fu)
                raw = rec[j] if j is not None and j < len(rec) else None
                flag = rec[k].strip() if k is not None and k < len(rec) else "1"
                val = parse_price(raw, lo, hi)
                if flag == "2":                      # Kraftstoff entfernt → Serie stoppen
                    state.get(uuid, {}).pop(fu, None)
                    if carry is not None:
                        carry.pop((uuid, fu), None)
                    changes.pop((uuid, fu), None)
                    continue
                cur = state.setdefault(uuid, {})
                if val is not None:
                    cur[fu] = val
                    changed = True
                else:
                    if flag not in ("0", "3"):
                        n_drop += 1                   # change==1 ohne Preis → Datenfehler
                    val = cur.get(fu)                 # Stand halten (oder gar keiner)
                    changed = flag in ("1", "3")
                if val is None:
                    continue
                if changed or first_day:
                    changes.setdefault((uuid, fu), []).append((ts, val))
                    if day is not None:
                        day_events[(uuid, fu)].add(day)

    # Raster für die Ausgabe: Änderungen und Dichte-Zeilen landen in derselben Zelle
    out_step = max(resample_min, density_min)
    buckets: dict[tuple[str, str, dt.datetime], list[float]] = defaultdict(list)

    def emit(t: dt.datetime, uuid: str, fu: str, val: float) -> None:
        buckets[(uuid, fu, bucket_of(t, out_step))].append(val)

    for (uuid, fu), series in changes.items():
        for ts, val in series:
            emit(ts, uuid, fu, val)

    if density_min > 0:
        n_b = 1440 // density_min
        carry = carry if carry is not None else {}
        timeline = {k: v for k, v in changes.items()}
        for (uuid, fu), (cts, cval) in list(carry.items()):
            timeline.setdefault((uuid, fu), []).append((cts, cval))
        for (uuid, fu), series in timeline.items():
            if uuid not in stations:
                continue
            series = sorted(series)
            if not series:
                continue
            k = 0
            for i in range(n_b):
                b = day_start + dt.timedelta(minutes=i * density_min)
                while k + 1 < len(series) and series[k + 1][0] <= b:
                    k += 1
                ts, val = series[k]
                if ts > b:
                    continue
                age = (b - ts).total_seconds() / 60.0
                if age > 0 and max_hold_min and age > max_hold_min:
                    continue
                emit(b, uuid, fu, val)
            carry[(uuid, fu)] = series[-1]

    rows = [(b, uuid, fu, statistics.median(v)) for (uuid, fu, b), v in buckets.items()]
    rows.sort()
    return n_read, n_drop, rows


# ------------------------------------------------------------------------ Main


def slug(label: str) -> str:
    keep = "".join(c if (c.isalnum() or c in "-_") else "-" for c in label.strip().lower())
    while "--" in keep:
        keep = keep.replace("--", "-")
    return keep.strip("-") or "kampagne"


def daterange(d0: dt.date, d1: dt.date):
    d = d0
    while d <= d1:
        yield d
        d += dt.timedelta(days=1)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Tankerkönig-Rohhistorie → analysefertige CSV je Kampagne (Schema analysis/README.md).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    ap.add_argument("--raw", type=Path, default=Path("data/raw/prices"),
                    help="Verzeichnis der Tagesdateien (prices/)")
    ap.add_argument("--stations", type=Path, default=None,
                    help="Tankstellenliste csv/csv.gz (Default: neueste unter data/raw)")
    ap.add_argument("--out", type=Path, default=Path("data/ready"), help="Ziel für die CSVs")
    ap.add_argument("--config", type=Path, default=Path("analysis/config.local.json"),
                    help="gitignorierte Lokalkonfig (home/subdiv) als Ankerquelle")
    ap.add_argument("--anchor", action="append", default=[],
                    help="Anker zusätzlich: 'Label:lat,lon' (wiederholbar)")
    ap.add_argument("--radius", type=float, default=25.0, help="Radius je Anker in km")
    ap.add_argument("--plz", default=None, help="nur PLZ mit diesem Präfix (z. B. 60)")
    ap.add_argument("--all-stations", action="store_true",
                    help="ohne Stationsauswahl (bundesweit — Output wird groß)")
    ap.add_argument("--fuel", action="append", default=[],
                    help="Kraftstoff (diesel/e5/e10), wiederholbar; Default: alle")
    ap.add_argument("--since", default=None, help="nur ab Datum YYYY-MM-DD")
    ap.add_argument("--until", default=None, help="nur bis Datum YYYY-MM-DD")
    ap.add_argument("--density", type=int, default=60,
                    help="Minuten-Raster für Fortschreibungs-Zeilen (0 = nur Preisänderungen). "
                         "Kosten: 60 min ≈ +12 %% Zeilen, 5 min ≈ ×12 Zeilen. Sinn: "
                         "station_selection.py misst Coverage auf einem Raster; mit "
                         "Änderungshistorie und '--step-min 30' ist --density 0 ebenfalls ok")
    ap.add_argument("--max-hold", type=int, default=720,
                    help="min. Gültigkeit eines fortgeschriebenen Preises (Nachtpausen werden "
                         "nicht erfunden); 0 = Preis gilt unbegrenzt weiter")
    ap.add_argument("--city", choices=["campaign", "station"], default="campaign",
                    help="'campaign' (Default): city-Spalte = Anker-/Kampagnenlabel, damit "
                         "--config/--subdiv (Label→Koordinaten/Bundesland) andockt und der "
                         "25-km-Raum als EIN Markt behandelt wird. 'station': echte Ortsnamen "
                         "(→ viele Kleinstädte, die Selektion braucht ≥2 Stationen je Ort)")
    ap.add_argument("--resample", type=int, default=0,
                    help="Aggregation auf Raster in Minuten (0 = jede Preisänderung)")
    ap.add_argument("--price-min", type=float, default=0.5, help="Plausibilitätsgrenze €/L")
    ap.add_argument("--price-max", type=float, default=3.5, help="Plausibilitätsgrenze €/L")
    ap.add_argument("--compress", action="store_true", help="Output als .csv.gz")
    ap.add_argument("--qa", type=Path, default=None, help="QA-Bericht (md) schreiben")
    ap.add_argument("--no-baseline", action="store_true",
                    help="im ersten Tag keine Fortsetzungszeilen schreiben (nur Änderungen)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    fuels = tuple(f.strip().lower() for f in args.fuel) or FUELS
    if set(fuels) - set(FUELS):
        raise SystemExit(f"--fuel: {sorted(set(fuels)-set(FUELS))} unbekannt (erlaubt {FUELS})")
    if args.resample not in (0, 5, 10, 15, 20, 30, 60, 120):
        print(f"# Hinweis: --resample {args.resample} min ist ungewöhnlich (üblich 5–60)",
              file=sys.stderr)

    cfg = load_config(args.config if args.config and args.config.exists() else None)
    anchors: dict[str, tuple[float, float]] = dict(cfg["anchors"])
    for spec in args.anchor:
        label, lat, lon = parse_anchor(spec)
        anchors[label] = (lat, lon)
    if not anchors and not args.all_stations:
        raise SystemExit("Kein Ankerpunkt — --anchor 'Label:lat,lon' setzen, "
                         "analysis/config.local.json füllen oder --all-stations wählen.")

    since = dt.date.fromisoformat(args.since) if args.since else None
    until = dt.date.fromisoformat(args.until) if args.until else None
    files = find_price_files(args.raw, since, until)
    if not files:
        raise SystemExit(f"Keine Tagesdateien unter {args.raw} — erst data-tools/fetch_history.py "
                         f"laufen lassen (data/raw/prices/YYYY/MM/...).")
    st_path = find_stations_file(args.raw, args.stations)
    if not st_path:
        raise SystemExit("Keine Tankstellenliste gefunden — data-tools/fetch_history.py "
                         "--stations-latest holen (data/raw/stations/...).")
    stations = load_stations(st_path, anchors, args.radius, args.plz, args.all_stations)
    if not stations:
        raise SystemExit(f"Keine Station im {args.radius:g} km-Umkreis — Anker/Radius prüfen.")

    if not args.quiet:
        per = defaultdict(int)
        for s in stations.values():
            for label in (s["campaigns"] or ["bundesweit"]):
                per[label] += 1
        print("# Anker: " + (", ".join(f"{k} {v[0]:.4f}/{v[1]:.4f}" for k, v in anchors.items())
                             or "(bundesweit)")
              + f" | Radius {args.radius:g} km")
        print(f"# Stationsliste {st_path.name} → {len(stations)} Stationen im Einzugsgebiet "
              f"({', '.join(f'{k}={v}' for k, v in sorted(per.items()))})")
        print(f"# Tage {files[0].name[:10]}…{files[-1].name[:10]} ({len(files)}) | "
              f"Raster {args.resample or 'änderungsgenau'} min | Kraftstoffe {','.join(fuels)}")

    args.out.mkdir(parents=True, exist_ok=True)
    sinks: dict[str, list] = defaultdict(list)
    state: dict[str, dict[str, float]] = {}
    day_events: dict[tuple[str, str], set] = defaultdict(set)
    carry: dict[tuple[str, str], tuple[dt.datetime, float]] = {}
    n_rows = n_events = n_drop = 0
    days_ok: list[dt.date] = []
    days_bad: list[str] = []
    for i, p in enumerate(files, 1):
        try:
            read, drop, rows = ingest_day(
                p, stations, state, fuels, args.resample, args.price_min, args.price_max,
                day_events, first_day=(i == 1 and not args.no_baseline),
                density_min=args.density, max_hold_min=args.max_hold, carry=carry)
        except Exception as e:  # ein kaputter Tag darf den Lauf nicht killen
            days_bad.append(f"{p.name}: {e}")
            continue
        days_ok.append(date_of(p.name) or dt.date.fromisoformat(p.name[:10]))
        n_events += read
        n_rows += len(rows)
        n_drop += drop
        for ts, uuid, fu, val in rows:
            for label in (stations[uuid]["campaigns"] or ["nationwide"]):
                sinks[label].append((ts, uuid, fu, val))
        if not args.quiet and (i % 20 == 0 or i == len(files)):
            print(f"  [{i}/{len(files)}] {p.name[:10]} → {n_rows:,} Zeilen      ", end="\r")
    if not args.quiet:
        print(" " * 64, end="\r")
    if not days_ok:
        raise SystemExit("Kein Tagesfile erfolgreich gelesen — Format prüfen (--stations/-raw).")

    written: dict[str, str] = {}
    manifest = {"generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "source_days": len(days_ok), "events_read": n_events, "rows_written": n_rows,
                "dropped_values": n_drop, "radius_km": args.radius,
                "resample_min": args.resample, "fuels": list(fuels),
                "city_mode": args.city,
                "price_window_eur": [args.price_min, args.price_max], "campaigns": {}}
    for label, rows in sinks.items():
        rows.sort(key=lambda r: (r[1], r[2], r[0]))
        dest = args.out / f"{slug(label)}_hist.csv{'.gz' if args.compress else ''}"
        opener = gzip.open if str(dest).endswith(".gz") else open
        with opener(dest, "wt", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(ANALYSIS_COLUMNS)
            for ts, uuid, fu, val in rows:
                st = stations[uuid]
                if args.city == "campaign":
                    city_lbl = label if label != "nationwide" else (st["city"] or "nationwide")
                else:
                    city_lbl = st["city"] or label
                w.writerow([ts.strftime("%Y-%m-%d %H:%M:%S"), uuid, st["name"], st["brand"],
                            city_lbl, f"{st['lat']:.6f}", f"{st['lon']:.6f}",
                            fu.upper(), f"{val:.3f}"])
        written[label] = str(dest)
        span = max(len(days_ok), 1)
        n_st = len({r[1] for r in rows})
        manifest["campaigns"][label] = {"file": str(dest), "rows": len(rows), "stations": n_st,
                                        "days": span, "first": str(days_ok[0]), "last": str(days_ok[-1])}
        if not args.quiet:
            print(f"# {dest}  {len(rows):,} Zeilen · {n_st} Stationen · "
                  f"{dest.stat().st_size/1e6:.1f} MB")
    (args.out / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # ---------------- QA ----------------
    expected = list(daterange(days_ok[0], days_ok[-1]))
    missing = sorted(set(expected) - set(days_ok))
    span = max(len(expected), 1)
    cov_med = (statistics.median([len(v) for v in day_events.values() or [0]]) / span) if day_events else 0.0
    lines = ["# QA – Übernahme Tankerkönig-Historie", "",
             f"- Zeitraum: {days_ok[0]} … {days_ok[-1]} — {len(days_ok)}/{span} Tage vorhanden"
             + (f", fehlend: {', '.join(d.isoformat() for d in missing[:12])}"
                + (" …" if len(missing) > 12 else "") if missing else " (lückenlos)"),
             f"- Gelesene Events: {n_events:,} · geschriebene Zeilen: {n_rows:,} · "
             f"geprüfte/verworfene Werte: {n_drop:,}",
             f"- Median-Coverage je Station×Kraftstoff: {cov_med:.0%} "
             f"(Gate in analysis/README.md: ≥ 85 %)", "",
             "| Kampagne | Dateien | Zeilen | Stationen | Ø Zeilen/Station/Tag |", "|---|---|---|---|---|"]
    for label, info in manifest["campaigns"].items():
        per = info["rows"] / max(info["stations"], 1) / max(info["days"], 1)
        lines.append(f"| {label} | `{written[label]}` | {info['rows']:,} | {info['stations']} | {per:.1f} |")
    if days_bad:
        lines += ["", f"- ⚠ {len(days_bad)} Tagesdateien fehlerhaft: " + "; ".join(days_bad[:5])]
    text = "\n".join(lines) + "\n"
    if args.qa:
        args.qa.parent.mkdir(parents=True, exist_ok=True)
        args.qa.write_text(text, encoding="utf-8")
    if not args.quiet:
        print("\n" + text)
    sample = " ".join(sorted(written.values())) or f"{args.out}/*.csv{'{.gz}' if args.compress else ''}"
    print(f"# Analyse: python3 analysis/station_selection.py --data {sample} --fuel "
          f"{fuels[0].upper()} --top 10 --config analysis/config.local.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
