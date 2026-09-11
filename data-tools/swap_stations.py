#!/usr/bin/env python3
"""Tote/ungeeignete Stationen aus dem aktiven Polling-Set 1:1 tauschen.

Ein Lauf:
  1. liest das aktive polling.json (Stadtsets, UUIDs, Koordinaten),
  2. bestimmt die zu entfernenden UUIDs — aus den Modell-Fehlern
     (--from-failures, Standard: data/runtime/engine/current.json) und/oder
     --remove-uuid; --keep-uuid nimmt Einzelne wieder aus,
  3. wählt aus der Kandidaten-CSV von `discover_stations.py --check-history`
     die nächstgelegenen Ersatz-Stationen, die wirklich --min-days Archiv-
     tage UND den gewünschten --fuel haben; keine Zwillings-Marke in
     --twin-km zu einer verbleibenden Station,
  4. repariert Doppelt-Kodierung in Namen/Marken (Quelle Datenrepo, z. B.
     „GÃœTERSLOH“ → „GÜTERSLOH“); UUIDs und Preise bleiben unberührt,
  5. validiert das GESAMTE Set (UUID-Format, 1–10 je Stadt, keine UUID in
     zwei Städten) und schreibt ausschließlich den Vorschlag
     data/setup/polling.json. Das aktive Set bleibt unverändert.

Aktivieren ist ein separater Schritt auf dem Pi; dieses Skript gibt die
genauen Befehle am Ende aus. Hintergrund: docs/STATIONEN-TAUSCH.md.

Nur Standardbibliothek; läuft auf NAS, Pi und PC. Beispiel:

    python3 data-tools/swap_stations.py --city Gütersloh \
        --kandidaten docs/analysis/stations-vorschlag-gt \
        --stations data/raw/stations
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data-tools"))

from discover_stations import brand_key, haversine_km, open_text  # noqa: E402
from polling_plan import atomic_json, validate_sets  # noqa: E402

FAILURES_DEFAULT = ROOT / "data/runtime/engine/current.json"
ACTIVE_DEFAULT = ROOT / "docs/analysis/stations/polling.json"
OUT_DEFAULT = ROOT / "data/setup/polling.json"


def repair_text(value: str) -> str:
    """Doppelt-kodierte Namen reparieren (UTF-8 als cp1252/latin-1 gelesen).

    „GÃœTERSLOH SÃœD“ → „GÜTERSLOH SÜD“. Gibt den Wert unverändert zurück,
    wenn sich nichts sauber zurückrechnen lässt — nie raten, nie kürzen.
    """
    if not value or ("Ã" not in value and "Â" not in value):
        return value
    for codec in ("cp1252", "latin-1"):
        try:
            fixed = value.encode(codec).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if fixed != value:
            return fixed
    return value


def find_group(plan: dict, city: str) -> tuple[str, dict]:
    sets = plan.get("sets") or {}
    if city in sets:
        return city, sets[city]
    for key, group in sets.items():
        if (group.get("label") or key) == city:
            return key, group
    raise SystemExit(
        f"Stadt {city!r} nicht im aktiven Set "
        f"({', '.join(sorted(sets))}) — Schreibweise prüfen."
    )


def failures_uuids(path: Path, city: str, label: str, fuel: str) -> set[str]:
    """UUIDs der Modell-Fehler dieser Stadt (und dieses Kraftstoffs)."""
    if not path.is_file():
        return set()
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    out: set[str] = set()
    for item in payload.get("failures") or []:
        if not isinstance(item, dict):
            continue
        if item.get("city") not in {city, label}:
            continue
        if fuel != "any" and (item.get("fuel") or "").lower() != fuel:
            continue
        uid = (item.get("station_id") or "").strip()
        if uid:
            out.add(uid)
    return out


def kandidaten_rows(path: Path) -> list[dict]:
    path = Path(path)
    files = sorted(path.glob("*_kandidaten.csv")) if path.is_dir() else [path]
    if not files or not files[0].is_file():
        raise SystemExit(
            f"{path}: keine *_kandidaten.csv — erst discover_stations.py "
            "--check-history --out <verzeichnis> --write-pool ausführen."
        )
    rows: list[dict] = []
    for item in files:
        with item.open(newline="", encoding="utf-8") as handle:
            rows.extend(csv.DictReader(handle))
    return rows


def stations_lookup(directory: Path) -> tuple[Path, dict[str, dict]]:
    """uuid → Name/Marke/exakte Koordinaten aus der neuesten Stationsliste."""
    directory = Path(directory)
    files = sorted(
        item
        for item in directory.rglob("*.csv*")
        if item.name.endswith(("-stations.csv", "-stations.csv.gz"))
    )
    if not files:
        raise SystemExit(f"{directory}: keine *-stations.csv(.gz) gefunden.")
    latest = files[-1]
    out: dict[str, dict] = {}
    with open_text(latest) as handle:
        for row in csv.DictReader(handle):
            uid = (row.get("uuid") or "").strip()
            try:
                lat, lon = float(row["latitude"]), float(row["longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            if not uid or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            out[uid.lower()] = {
                "name": (row.get("name") or "").strip(),
                "brand": (row.get("brand") or "").strip(),
                "lat": lat,
                "lon": lon,
            }
    return latest, out


def eligible(row: dict, min_days: int, fuel: str) -> bool:
    try:
        days = int(float(row.get("hist_days") or 0))
    except ValueError:
        return False
    if days < min_days:
        return False
    fuels = {part.strip().lower() for part in (row.get("hist_fuels") or "").split("/")}
    return fuel == "any" or fuel in fuels


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Polling-Stationen 1:1 tauschen; schreibt nur den Vorschlag.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument(
        "--city", required=True, help="Stadt-Key oder -Label im aktiven Set"
    )
    ap.add_argument(
        "--active", type=Path, default=ACTIVE_DEFAULT, help="aktives polling.json"
    )
    ap.add_argument(
        "--kandidaten",
        type=Path,
        required=True,
        help="Verzeichnis oder CSV von discover_stations.py --check-history",
    )
    ap.add_argument(
        "--stations",
        type=Path,
        default=None,
        help="Archiv data/raw/stations für exakte Koordinaten/Namen",
    )
    ap.add_argument(
        "--fuel",
        choices=("e10", "e5", "diesel", "any"),
        default="e10",
        help="Ersatz muss diesen Kraftstoff im Archiv geliefert haben",
    )
    ap.add_argument(
        "--min-days",
        type=int,
        default=28,
        help="Mindest-Archivtage für Ersatz (Modellgrenze: 28)",
    )
    ap.add_argument(
        "--from-failures",
        type=Path,
        default=FAILURES_DEFAULT,
        help="engine/current.json; entfernt deren Fehler-UUIDs der Stadt",
    )
    ap.add_argument(
        "--remove-uuid",
        action="append",
        default=[],
        help="zusätzlich zu entfernende UUID (wiederholbar)",
    )
    ap.add_argument(
        "--keep-uuid",
        action="append",
        default=[],
        help="trotz Fehler behalten, z. B. kurz before 28 Tagen (wiederholbar)",
    )
    ap.add_argument(
        "--twin-km",
        type=float,
        default=1.5,
        help="Ersatz mit gleicher Marke näher als das an einer "
        "verbleibenden Station wird übersprungen (0 = aus)",
    )
    ap.add_argument("--out", type=Path, default=OUT_DEFAULT, help="Vorschlagsdatei")
    ap.add_argument(
        "--dry-run", action="store_true", help="nur zeigen, nichts schreiben"
    )
    return ap


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    plan = json.loads(args.active.read_text(encoding="utf-8-sig"))
    validate_sets(plan)
    city_key, group = find_group(plan, args.city)
    label = group.get("label") or city_key
    batch = list(group.get("batch") or [s["uuid"] for s in group.get("stations", [])])

    keep = {uid.lower() for uid in args.keep_uuid}
    remove = {uid.lower() for uid in args.remove_uuid}
    failed = failures_uuids(args.from_failures, city_key, label, args.fuel)
    remove |= failed
    remove -= keep
    drop = {uid for uid in batch if uid.lower() in remove}
    ignored = remove - drop
    if ignored:
        print(
            f"Hinweis: nicht im Set {label} (übersprungen): {', '.join(sorted(ignored))}"
        )
    if not drop:
        raise SystemExit(
            f"Nichts zu tauschen für {label}: keine der Fehler-/Remove-UUIDs ist im Set. "
            f"(Fehlerquelle: {args.from_failures}, --remove-uuid ergänzen?)"
        )
    occupied = {
        uid.lower()
        for other in plan["sets"].values()
        for uid in (
            other.get("batch") or [s["uuid"] for s in other.get("stations", [])]
        )
    }

    lookup = {}
    if args.stations:
        source, lookup = stations_lookup(args.stations)
        print(f"Koordinaten/Namen: {source.name}")
    else:
        print(
            "Hinweis: ohne --stations stammen Koordinaten gerundet (~100 m) aus der CSV."
        )

    twins = []
    for uid in batch:
        entry = next(
            (s for s in group.get("stations", []) if s["uuid"].lower() == uid.lower()),
            {},
        )
        if entry and uid.lower() not in drop:
            twins.append((brand_key(entry), entry.get("lat"), entry.get("lon")))

    rows = []
    for row in kandidaten_rows(args.kandidaten):
        uid = (row.get("uuid") or "").strip()
        if uid.lower() in occupied or uid.lower() in drop:
            continue
        if not eligible(row, args.min_days, args.fuel):
            continue
        meta = lookup.get(uid.lower()) or {}
        lat, lon = (
            meta.get("lat") or float(row["lat"]),
            meta.get("lon") or float(row["lon"]),
        )
        if args.twin_km > 0 and any(
            brand == brand_key({"brand": meta.get("brand") or row.get("brand") or ""})
            and b_lat is not None
            and haversine_km(lat, lon, b_lat, b_lon) < args.twin_km
            for brand, b_lat, b_lon in twins
        ):
            continue
        rows.append((float(row["dist_km"]), uid, row, meta, lat, lon))
    rows.sort(key=lambda item: item[0])

    need = len(drop)
    if len(rows) < need:
        raise SystemExit(
            f"Nur {len(rows)} brauchbare Ersatz-Kandidaten für {need} Plätze in {label} "
            f"(--fuel {args.fuel}, ≥ {args.min_days} Tage). Erst Suche erweitern: "
            "discover_stations.py mit größerem --radius/--plz wiederholen; "
            "aktives Set bleibt unverändert."
        )
    chosen = rows[:need]

    alive = [uid for uid in batch if uid.lower() not in drop]
    by_id = {
        s["uuid"].lower(): s
        for s in group.get("stations", [])
        if s["uuid"].lower() not in drop
    }
    for _, uid, row, meta, lat, lon in chosen:
        by_id[uid.lower()] = {
            "uuid": uid,
            "name": repair_text(meta.get("name") or (row.get("name") or "").strip()),
            "brand": repair_text(meta.get("brand") or (row.get("brand") or "").strip()),
            "lat": lat,
            "lon": lon,
            "dist_km": round(float(row["dist_km"]), 3),
        }
        alive.append(uid)
    for entry in by_id.values():
        entry["name"] = repair_text(entry.get("name") or "")
        entry["brand"] = repair_text(entry.get("brand") or "")

    group["batch"] = alive
    group["stations"] = [by_id[uid.lower()] for uid in alive]
    plan["proposal"] = True
    plan["excluded_uuids"] = sorted(drop)
    plan["source"] = (
        f"swap_stations.py {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')} "
        f"({label}: {len(drop)} getauscht, fuel={args.fuel})"
    )
    validate_sets(plan)

    print(f"\nEntfernt ({len(drop)}):")
    for uid in sorted(drop):
        print(f"  - {uid}")
    if keep & {uid.lower() for uid in batch}:
        print(f"Behalten trotz Fehler: {', '.join(sorted(keep))}")
    print(f"Neu ({len(chosen)}, {args.fuel}, ≥ {args.min_days} Tage):")
    for dist, uid, row, _meta, _lat, _lon in chosen:
        print(
            f"  + {row.get('brand')} {row.get('name')} ({uid}) — {dist:.1f} km, "
            f"{row.get('hist_days')} Archivtage [{row.get('hist_fuels')}]"
        )
    print(f"\n{label}: {len(alive)} UUIDs; Gesamtset gültig.")

    check_ids = ",".join(uid for _, uid, *_ in chosen)
    print(
        "\nNächste Schritte (Details: docs/STATIONEN-TAUSCH.md):\n"
        f"  1. Auf dem Pi live prüfen (KEY=$(cat data/apikey.txt)):\n"
        f"     curl -s 'https://creativecommons.tankerkoenig.de/json/prices.php"
        f"?ids={check_ids}&apikey=$KEY' | jq '.prices'\n"
        f"  2. Vorschlag auf den Pi nach data/setup/ übertragen\n"
        f"  3. Pi: cp -p docs/analysis/stations/polling.json "
        f"data/setup/polling-backup-$(date -u +%Y%m%dT%H%M%SZ).json\n"
        f"     sudo systemctl stop tankapp-collector\n"
        f"     cp -p {args.out} docs/analysis/stations/polling.json\n"
        f"     sudo systemctl restart tankapp-collector tankapp-uploader\n"
        f"  4. Zurück aufs NAS kopieren + python3 tankapp.py nas-up"
    )
    if args.dry_run:
        print("\n--dry-run: nichts geschrieben.")
        return 0
    atomic_json(args.out, plan)
    print(f"\nVorschlag geschrieben: {args.out} (aktives Set unverändert).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
