#!/usr/bin/env python3
"""
TankApp – Schritt 1: WELCHE Tankstellen wollen wir beobachten? (Entdeckung, kein Preis-Download)

Ausgangspunkt ist die **eine** Tagesdatei des Datenrepos mit allen Tankstellen
(~10 MB, `stations/YYYY/MM/YYYY-MM-DD-stations.csv`) oder die Antwort des offenen
APIs `transparent.tankerkoenig.de/list.php`. Daraus entstehen je Ort:

  1. **Kandidatenliste** (alle Stationen im Radius, dedupliziert nach Marke+Position),
  2. **Polling-Set** — die harte Währung der App: `prices.php?ids=` bündelt max. **10 UUIDs
     je Request**, und das Kontingent ist 1 Request / 5 min (KONZEPT.md §1.1). Ein Set =
     max. 10 Stationen = 1 Poll. Deshalb: Marken-Diversität vor Nähe (zwei Stationen
     derselben Marke am selben Ort zeigen fast denselben Preis). Mit `--check-history`
     kommen nur geeignete Stationen (Mindesttage, gewünschte Sorte) ins Set; gibt es im
     Radius keine 10, bleibt es kürzer (Warnung im Report) — Radius erweitern statt an
     der Eignung drehen; `--allow-ineligible` stellt das alte Auffüllverhalten wieder her,
  3. **Statistik-Pool** — die volle Liste als CSV für Selektion/Baseline (`--data`).
  4. Optional **Historie-Eignung** (`--check-history`): liest die bereits geladenen
     Tagesdateien und sagt je Station: Tage mit Preis, erster/letzter Tag, welche
     Kraftstoffe überhaupt geführt werden. Erst danach entscheidet sich, ob eine
     Station ins Monitoring darf oder nur im Pool bleibt.

Reihenfolge-Tipp: Entdeckung braucht KEINE Preis-Historie (nur die Stationsliste, 10 MB)
— aber die Historie ist bundesweit, also wird durch die Auswahl nichts kleiner. Der
Nutzen der Auswahl liegt im Monitoring-Set und in der Frage "hat diese Station Daten?".

Nur Standardbibliothek. Läuft unter Windows (py -3), auf dem Pi und auf dem NAS.

  # A) nur Stationsliste (Windows: Datei liegt in Downloads)
  py -3 data-tools/discover_stations.py --stations "$env:USERPROFILE\\Downloads\\2026-09-05-stations.csv" \
      --anchor "Frankfurt:50.110,8.682" --radius 25 --check-history data/raw/prices \
      --out docs/analysis/stations

  # B) aus Konfig (Heimat-Anker) + zwei Kampagnenstädten
  py -3 data-tools/discover_stations.py --config analysis/config.local.json \
      --anchor "Muenchen:48.1374,11.5755" --anchor "Koeln:50.9375,6.9603"

  # C) ohne Datenrepo: offenes API anzapfen (nur im Heimnetz sinnvoll)
  py -3 data-tools/discover_stations.py --api "Frankfurt:50.110,8.682" --radius 25

Ausgaben: <out>/<ort>_kandidaten.csv, <out>/<ort>_pool.csv, <out>/polling.json,
          <out>/monitoring_set.md (+ Report auf stdout)
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import json
import math
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

EARTH_R_KM = 6371.0088
FUELS = ("diesel", "e5", "e10")
# Marken, die im Alltag gern billiger sind (Preisbrecher) — nur Vorzug, kein Ausschluss.
CHEAP_BRANDS = ("jet", "hem", "star", "bft", "sprint", "total", "agip", "hoyer", "westtank",
                "avia", "eno", "liqoil", "clans", "bartels", "turm", "cadillion", "shell")
BATCH_LIMIT = 10          # prices.php?ids= ... max 10 UUIDs (KONZEPT.md §1.1)
UA = "tankapp-discover/1.0"


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_R_KM * math.asin(math.sqrt(a))


# ------------------------------------------------------------------ Eingaben


def open_text(path: Path):
    if str(path).endswith(".gz"):
        return gzip.open(path, "rt", newline="", encoding="utf-8-sig")
    return open(path, "r", newline="", encoding="utf-8-sig")


def repair_text(value: str) -> str:
    """Doppelt-kodierte Namen aus dem Datenrepo reparieren (UTF-8 als cp1252/
    latin-1 gelesen): „GÃœTERSLOH SÃœD“ → „GÜTERSLOH SÜD“. Einige Stationslisten
    des Datenrepos enthalten diese Zeichenketten unverändert. Rein kosmetisch
    (Anzeigenamen/Marken) — UUIDs und Preise bleiben unberührt. Gibt den Wert
    unverändert zurück, wenn sich nichts sauber zurückrechnen lässt; nie raten."""
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


def parse_anchor(spec: str) -> tuple[str, float, float, float | None]:
    """'Label:lat,lon' oder 'Label:lat,lon:radius'."""
    label, _, rest = (spec.partition(":") if ":" in spec else (spec, "", ""))
    if not rest:
        raise SystemExit(f"--anchor/--api erwartet 'Label:lat,lon[:radius]', erhalten {spec!r}")
    parts = rest.replace(";", ",").split(":")
    try:
        lat, lon = (float(x) for x in parts[0].split(",")[:2])
    except ValueError:
        raise SystemExit(f"--anchor: Koordinaten nicht lesbar: {spec!r}")
    radius = float(parts[1]) if len(parts) > 1 else None
    return label.strip() or "Ort", lat, lon, radius


def anchors_from_config(path: Path | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if path and path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        for label, ll in (data.get("home") or {}).items():
            try:
                lat, lon = float(ll[0]), float(ll[1])
            except (TypeError, ValueError, IndexError):
                continue
            if (lat, lon) != (0.0, 0.0):
                out[label.strip()] = {"lat": lat, "lon": lon}
        for label, sub in (data.get("subdiv") or {}).items():
            if label.strip() in out:
                out[label.strip()]["subdiv"] = str(sub)
    return out


def stations_from_csv(path: Path) -> dict[str, dict]:
    """Tankstellenliste des Datenrepos → {uuid: dict}. Straße/Hausnummer werden
    bewusst nicht übernommen (Datensparsamkeit; sie landen nie in data/ oder docs/)."""
    out: dict[str, dict] = {}
    with open_text(path) as f:
        rd = csv.DictReader(f)
        cols = {(c or "").strip().lower(): c for c in (rd.fieldnames or [])}
        need = {"uuid", "latitude", "longitude"}
        if need - set(cols):
            raise SystemExit(f"{path}: Pflichtspalten {sorted(need - set(cols))} fehlen "
                             f"(Header: {rd.fieldnames})")
        for row in rd:
            try:
                lat, lon = float(row[cols["latitude"]]), float(row[cols["longitude"]])
            except (TypeError, ValueError):
                continue
            uuid = (row.get(cols["uuid"]) or "").strip()
            if not uuid or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            out[uuid] = {
                "uuid": uuid,
                "name": repair_text((row.get(cols.get("name", ""), "") or "").strip()),
                "brand": repair_text((row.get(cols.get("brand", ""), "") or "").strip()),
                "plz": (row.get(cols.get("post_code", ""), "") or "").strip(),
                "city": (row.get(cols.get("city", ""), "") or "").strip(),
                "lat": lat, "lon": lon,
            }
    return out


def fetch_api(lat: float, lon: float, radius: float, size: int, timeout: int) -> dict[str, dict]:
    url = ("https://transparent.tankerkoenig.de/api/list.php?radius=25&lat=%.6f&lng=%.6f"
           "&size=%d&sort=distance" % (lat, lon, size))
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = json.loads(r.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"! list.php nicht erreichbar ({e}). Ohne Netzzugang: Stationsliste des "
              f"Datenrepos benutzen (--stations).", file=sys.stderr)
        return {}
    return stations_from_list(raw)


def stations_from_json(path: Path) -> dict[str, dict]:
    """gespeicherte list.php-Antwort (JSON) → gleiches Schema"""
    return stations_from_list(json.loads(path.read_text(encoding="utf-8")))


def stations_from_list(raw: dict) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for st in raw.get("stations", []):
        uuid = str(st.get("id") or "").strip()
        try:
            lat, lon = float(st.get("lat")), float(st.get("lng"))
        except (TypeError, ValueError):
            continue
        if not uuid:
            continue
        out[uuid] = {
            "uuid": uuid, "name": repair_text((st.get("name") or "").strip()),
            "brand": repair_text((st.get("brand") or "").strip()),
            "plz": str(st.get("postcity") or "").split("-")[0].strip(),
            "city": (st.get("city") or "").strip(), "lat": lat, "lon": lon,
            "open": bool(st.get("isOpen")),
            "prices": {fu: st.get(fu) for fu in FUELS if isinstance(st.get(fu), (int, float))},
        }
    return out


# ------------------------------------------------------- Geschichte je Station


def scan_history(raw: Path, uuids: set[str], since: str | None, until: str | None,
                 quiet: bool) -> dict[str, dict]:
    """Liest (ggf. nur gz) Tagesdateien und zählt je Station Tage/Events/Kraftstoffe.
    Ein Jahr × ~400k Zeilen/Tag ist IO-limitiert: ~1 min/100 Tage auf schneller Platte."""
    stats: dict[str, dict] = {u: {"days": 0, "events": 0, "first": None, "last": None,
                                  "fuels": set(), "closed_days": 0} for u in uuids}
    files = [p for p in sorted(raw.rglob("*.csv*"))
             if p.name.endswith(("-prices.csv", "-prices.csv.gz"))]
    if since:
        files = [f for f in files if f.name[:10] >= since]
    if until:
        files = [f for f in files if f.name[:10] <= until]
    if not files:
        print(f"! {raw}: keine Tagesdateien gefunden — --check-history ohne Wirkung",
              file=sys.stderr)
        return stats
    for i, p in enumerate(files, 1):
        day = p.name[:10]
        try:
            with open_text(p) as f:
                rd = csv.reader(f)
                header = next(rd, None)
                if not header:
                    continue
                idx = {c.strip().lower(): n for n, c in enumerate(header)}
                if "station_uuid" not in idx:
                    continue
                iu = idx["station_uuid"]
                ifu = {fu: idx.get(fu) for fu in FUELS}
                ich = {fu: idx.get(fu + "change") for fu in FUELS}
                seen_today: set[str] = set()
                for rec in rd:
                    if len(rec) <= iu:
                        continue
                    u = rec[iu].strip()
                    st = stats.get(u)
                    if st is None:
                        continue
                    st["events"] += 1
                    seen_today.add(u)
                    for fu in FUELS:
                        j, k = ifu.get(fu), ich.get(fu)
                        val = rec[j].strip() if j is not None and j < len(rec) else ""
                        flag = rec[k].strip() if k is not None and k < len(rec) else "1"
                        try:
                            ok = float(val) > 0
                        except ValueError:
                            ok = False
                        if ok and flag != "2":
                            st["fuels"].add(fu)
                    st["first"] = day if st["first"] is None else min(st["first"], day)
                    st["last"] = day if st["last"] is None else max(st["last"], day)
                for u in seen_today:
                    stats[u]["days"] += 1
        except (OSError, csv.Error) as e:
            print(f"! {p.name}: {e}", file=sys.stderr)
        if not quiet and (i % 25 == 0 or i == len(files)):
            print(f"  Historie-Scan [{i}/{len(files)}] {day}", end="\r")
    if not quiet:
        print(" " * 46, end="\r")
    for st in stats.values():
        st["fuels"] = sorted(st["fuels"])
        st["files"] = len(files)
    return stats


# ------------------------------------------------------------------ Auswahl


def brand_key(st: dict) -> str:
    b = re.sub(r"[^a-z0-9]", "", (st.get("brand") or "").lower())
    return b or "unbekannt"


def history_eligible(hist: dict | None, min_days: int, fuel: str = "any") -> bool:
    """Eignung fürs Monitoring: genug Tage mit Preis UND der gewünschte
    Kraftstoff. Eine Station mit 367 Tagen, aber nur `diesel`, ist für ein
    E10-Set ungeeignet — Tage allein sind kein Eignungsnachweis.
    fuel='all' verlangt alle drei Sorten (diesel/e5/e10) im Archiv."""
    if not hist:
        return False
    if hist.get("days", 0) < min_days:
        return False
    fuels = set(hist.get("fuels") or [])
    if fuel == "all":
        return set(FUELS) <= fuels
    return fuel == "any" or fuel in fuels


def select_polling_set(cands: list[dict], size: int, prefer: set[str],
                       require_eligible: bool = False) -> list[dict]:
    """Greedy: erst jede Marke einmal (nach Nähe), dann auffüllen. Kein Duplikat
    derselben Marke, es sei denn, es bleibt nichts anderes.

    require_eligible (Default bei aktiviertem --check-history): Stationen ohne
    Eignung (zu wenige Archivtage / falsche Sorte) kommen in KEINER Phase ins
    Set — vorher wurden sie beim Auffüllen auf poll-size still mitgenommen."""
    if size <= 0:
        return []
    chosen: list[dict] = []
    used_brand: set[str] = set()
    pool = sorted(cands, key=lambda s: (0 if brand_key(s) in prefer else 1, s["dist_km"]))
    if require_eligible:
        pool = [s for s in pool if s.get("eligible", True)]
    for st in pool:
        if len(chosen) >= size:
            break
        b = brand_key(st)
        if b in used_brand:
            continue
        used_brand.add(b)
        chosen.append(st)
    if len(chosen) < size:
        rest = [s for s in pool if s not in chosen]
        chosen.extend(rest[: size - len(chosen)])
    return chosen


def dedupe_same_place(cands: list[dict], min_km: float) -> list[dict]:
    """Zwei Einträge derselben Marke im Umkreis von min_km = ein Kandidat (nächster gewinnt).
    Schützt das Polling-Budget vor Zwillingen (RWE/Esso-Umbauten, Markenschilder an
    derselben Zufahrt)."""
    out: list[dict] = []
    for st in sorted(cands, key=lambda s: s["dist_km"]):
        b = brand_key(st)
        if any(brand_key(o) == b and o["dist_km"] - st["dist_km"] < min_km
               and haversine_km(st["lat"], st["lon"], o["lat"], o["lon"]) < min_km for o in out):
            continue
        out.append(st)
    return out


# ---------------------------------------------------------------------- Report


def fmt_row(st: dict, hist: dict | None) -> str:
    cells = [f"{st['dist_km']:.2f}", st["brand"] or "—", st["name"][:38], st["plz"] or "—",
             st["city"] or "—", f"{st['lat']:.5f}", f"{st['lon']:.5f}", st["uuid"][:13] + "…"]
    if hist is not None:
        cells += [str(hist.get("days", 0)), f"{hist.get('first') or '—'}…{hist.get('last') or '—'}",
                  "/".join(hist.get("fuels") or []) or "—"]
    return "| " + " | ".join(cells) + " |"


def header(hist: bool) -> str:
    base = ("| km | Marke | Name | PLZ | Ort | lat | lon | uuid "
            "| Tage | erster…letzter Tag | Sorten |" if hist else
            "| km | Marke | Name | PLZ | Ort | lat | lon | uuid |")
    n = 11 if hist else 8
    return base + "\n|" + "---:|" * 2 + "---|" * (n - 2)


def write_csv(path: Path, rows: list[dict], with_hist: bool) -> None:
    cols = ["dist_km", "brand", "name", "plz", "city", "lat", "lon", "uuid"]
    if with_hist:
        cols += ["hist_days", "hist_first", "hist_last", "hist_fuels"]
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([f"{r[c]:.3f}" if c in ("dist_km", "lat", "lon") else r.get(c, "")
                        for c in cols])


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Tankstellen je Ort finden, Monitoring-Set wählen, Eignung prüfen.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    src = ap.add_argument_group("Eingabe")
    src.add_argument("--stations", type=Path, default=None,
                     help="stations-CSV(.gz) aus dem Datenrepos (Datei oder Verzeichnis)")
    src.add_argument("--from-json", type=Path, default=None,
                     help="gespeicherte list.php-Antwort (JSON) statt CSV")
    src.add_argument("--api", action="append", default=[],
                     help="Ort(e) live über das offene API abfragen: 'Label:lat,lon[:radius]'")
    src.add_argument("--config", type=Path, default=Path("analysis/config.local.json"),
                     help="Heimat-Anker aus gitignorierter Konfig")
    sel = ap.add_argument_group("Auswahl")
    sel.add_argument("--anchor", action="append", default=[],
                     help="Ort: 'Label:lat,lon' (wiederholbar; je Ort ein Set)")
    sel.add_argument("--radius", type=float, default=25.0, help="Standardradius in km")
    sel.add_argument("--plz", action="append", default=[],
                     help="zusätzlich PLZ-Präfix je Ort: 'Frankfurt:60,63'")
    sel.add_argument("--poll-size", type=int, default=BATCH_LIMIT,
                     help="Plätze je Polling-Set (prices.php bündelt max. 10 UUIDs)")
    sel.add_argument("--prefer", default="",
                     help="Marken mit Vorzug (Liste, ';' getrennt), z. B. von Kundenkarten")
    sel.add_argument("--dedupe-km", type=float, default=1.5,
                     help="zwei Stationen derselben Marke näher als das = ein Kandidat "
                          "(0 = aus)")
    hist = ap.add_argument_group("Eignung")
    hist.add_argument("--check-history", type=Path, default=None,
                      help="Verzeichnis der Preis-Tagesdateien (data/raw/prices)")
    hist.add_argument("--since", default=None, help="Historie-Scan ab Tag")
    hist.add_argument("--until", default=None, help="Historie-Scan bis Tag")
    hist.add_argument("--min-days", type=int, default=45,
                      help="unter so vielen Tagen mit Preis: nicht ins Monitoring")
    hist.add_argument("--fuel", choices=("e5", "e10", "diesel", "any", "all"), default="any",
                      help="Eignung nur, wenn dieser Kraftstoff im Archiv auftaucht "
                           "(z. B. --fuel e10 für ein E10-Modell-Set; 'all' verlangt "
                           "diesel/e5/e10 gemeinsam; Default: beliebiger)")
    hist.add_argument("--allow-ineligible", action="store_true",
                      help="Polling-Set auch mit Stationen füllen, die die Eignung "
                           "(Tage/Sorte) nicht erfüllen. Default bei --check-history: "
                           "nein — das Set bleibt dann ggf. kürzer als --poll-size")
    out = ap.add_argument_group("Ausgabe")
    out.add_argument("--out", type=Path, default=Path("docs/analysis/stations"),
                     help="Zielverzeichnis für CSVs/Report")
    out.add_argument("--report", type=Path, default=None, help="Report (md), Default: <out>/report.md")
    out.add_argument("--write-pool", action="store_true",
                     help="zusätzlich die volle Kandidatenliste je Ort als CSV (Statistik-Pool)")
    out.add_argument("--show", type=int, default=25,
                     help="so viele Zeilen je Ort im Report (CSV enthält immer alle)")
    out.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    # Anker sammeln
    anchors: dict[str, dict] = {}
    for label, meta in anchors_from_config(args.config if args.config and args.config.exists() else None).items():
        anchors[label] = {**meta, "radius": args.radius, "via": "config"}
    for spec in args.anchor:
        label, lat, lon, r = parse_anchor(spec)
        anchors[label] = {"lat": lat, "lon": lon, "radius": r or args.radius, "via": "flag"}
    for spec in args.api:
        label, lat, lon, r = parse_anchor(spec)
        anchors[label] = {"lat": lat, "lon": lon, "radius": r or args.radius, "via": "api"}
    if not anchors:
        raise SystemExit("Kein Ort angegeben: --anchor 'Label:lat,lon' (oder analysis/"
                         "config.local.json mit 'home' füllen, oder --api verwenden).")
    plz_filter: dict[str, set[str]] = {}
    for spec in args.plz:
        label, _, rest = spec.partition(":")
        plz_filter[label.strip()] = {x.strip() for x in rest.split(",") if x.strip()}
    prefer = {re.sub(r"[^a-z0-9]", "", b.lower()) for b in args.prefer.split(";") if b.strip()}

    # Stationsbasis
    base: dict[str, dict] = {}
    used_src = None
    if args.from_json:
        base = stations_from_json(args.from_json)
        used_src = f"{args.from_json} (list.php-JSON)"
    if not base:
        p = args.stations
        if p and p.is_dir():
            cands = sorted([q for q in p.rglob("*.csv*") if q.name.endswith(("-stations.csv",
                             "-stations.csv.gz"))])
            if not cands:
                raise SystemExit(f"kein stations-CSV in {p}")
            p = cands[-1]
        if p and p.exists():
            base = stations_from_csv(p)
            used_src = f"{p}"
    api_anchors = [lab for lab, a in anchors.items() if a["via"] == "api"]
    if not base and not api_anchors:
        raise SystemExit("Keine Stationsbasis: --stations <csv> (aus dem Datenrepos, ~10 MB) "
                         "oder --from-json <list.php> oder --api 'Label:lat,lon'.")
    if api_anchors:
        for lab in api_anchors:
            a = anchors[lab]
            more = fetch_api(a["lat"], a["lon"], min(a["radius"], 25.0), 1000, args_timeout())
            base.update(more)
            if more and not args.quiet:
                print(f"# list.php {lab}: {len(more)} Stationen")

    # Je Ort filtern
    reports: dict[str, dict] = {}
    all_cands: dict[str, list[dict]] = {}
    for lab, a in anchors.items():
        allow = plz_filter.get(lab)
        lst = []
        for st in base.values():
            d = haversine_km(st["lat"], st["lon"], a["lat"], a["lon"])
            if d > a["radius"]:
                continue
            if allow and not any(st["plz"].startswith(p) for p in allow):
                continue
            e = dict(st)
            e["dist_km"] = round(d, 2)
            lst.append(e)
        lst.sort(key=lambda s: s["dist_km"])
        if not lst:
            print(f"! {lab}: 0 Stationen im {a['radius']:g}-km-Radius — Anker-Koordinaten "
                  f"(lat,lon vertauscht?) oder Radius prüfen", file=sys.stderr)
            continue
        full = lst
        if args.dedupe_km > 0:
            lst = dedupe_same_place(lst, args.dedupe_km)
        reports[lab] = {"anchor": a, "n_all": len(full), "n_cand": len(lst),
                        "dropped_dupes": len(full) - len(lst)}
        all_cands[lab] = {"full": full, "cand": lst}

    if not reports:
        return 1

    # Historie-Eignung
    hist_stats: dict[str, dict] = {}
    if args.check_history:
        uuids = {s["uuid"] for c in all_cands.values() for s in c["full"]}
        if not args.quiet:
            print(f"# Historie-Scan: {len(uuids)} Stationen, {args.check_history}")
        hist_stats = scan_history(args.check_history, uuids, args.since, args.until, args.quiet)

    # Sets bauen
    args.out.mkdir(parents=True, exist_ok=True)
    polling: dict[str, dict] = {}
    lines = ["# Monitoring-Sets – gefundene Tankstellen je Ort", "",
             f"Quelle: {used_src or 'list.php'} | Radius je Ort: "
             + ", ".join(f"{k} {v['anchor']['radius']:g} km" for k, v in reports.items())
             + f" | Polling-Set-Größe: {args.poll_size} (prices.php bündelt max. {BATCH_LIMIT} UUIDs)",
             "",
             "Auswahlregel: nächster Kandidat je Marke (Zwillinge < "
             f"{args.dedupe_km:g} km zusammengefasst)"
             + (f", bevorzugte Marken: {', '.join(sorted(prefer))}" if prefer else ""),
             "",
            "Eignung: min. "
            + (f"{args.min_days} Tage mit Preis"
               + ("" if args.fuel == "any"
                  else " und alle Sorten diesel/e5/e10" if args.fuel == "all"
                  else f" und Sorte {args.fuel}")
               + f" in {args.since or 'anfang'}…{args.until or 'ende'}"
               + ("; ungeeignete bleiben außerhalb des Polling-Sets"
                  if not args.allow_ineligible else "; --allow-ineligible: Auffüllen erlaubt")
               if args.check_history else "nicht geprüft (--check-history fehlt)"),
             ""]
    pool_all: dict[str, list[dict]] = {}
    for lab, c in all_cands.items():
        r = reports[lab]
        cand = c["cand"]
        for s in cand:
            h = hist_stats.get(s["uuid"])
            if h:
                s["hist_days"], s["hist_first"], s["hist_last"] = h["days"], h["first"], h["last"]
                s["hist_fuels"] = "/".join(h["fuels"])
                s["eligible"] = history_eligible(h, args.min_days, args.fuel)
        ranked = sorted(cand, key=lambda s: (not s.get("eligible", True), s["dist_km"]))
        n_ok = sum(1 for s in cand if s.get("eligible", True))
        strict = bool(hist_stats) and not args.allow_ineligible
        poll = select_polling_set(ranked, args.poll_size, prefer,
                                  require_eligible=strict)
        polling[lab] = {"label": lab, "lat": round(r["anchor"]["lat"], 5),
                        "lon": round(r["anchor"]["lon"], 5), "radius_km": r["anchor"]["radius"],
                        "batch": [s["uuid"] for s in poll],
                        "stations": [{"uuid": s["uuid"], "name": s["name"], "brand": s["brand"],
                                      "dist_km": s["dist_km"], "fuels": s.get("hist_fuels", ""),
                                      "hist_days": s.get("hist_days", "")} for s in poll]}
        pool_all[lab] = c["full"]
        eignung = (f", {n_ok} geeignet / {len(cand) - n_ok} ungeeignet"
                   if hist_stats else "")
        lines += [f"## {lab}", "",
                  f"{r['n_all']} Stationen im Radius, {r['n_cand']} nach Marke/Dedupe "
                  f"(−{r['dropped_dupes']} Zwillinge){eignung}, {len(poll)} im Polling-Set."
                  + ("" if not poll else
                     f" Marken im Set: {', '.join(sorted({(s['brand'] or '—') for s in poll}))}"),
                  "", header(bool(hist_stats)),
                  "\n".join(fmt_row(s, hist_stats.get(s["uuid"]) if hist_stats else None)
                            for s in ranked[:args.show])]
        if strict and len(poll) < args.poll_size:
            hinweis = (f"⚠ nur {len(poll)} geeignete Stationen für {args.poll_size} Plätze "
                       f"({len(cand) - n_ok} nach Tagen/Sorte ausgeschlossen) — Set bleibt "
                       "absichtlich kurz; für einen vollen Tausch --radius/--plz erweitern"
                       " (oder --allow-ineligible, dann aber selbst auf hist_fuels achten).")
            lines += ["", hinweis]
            if not args.quiet:
                print(f"! {lab}: {hinweis}", file=sys.stderr)
        excl = [s for s in ranked if s.get("eligible") is False]
        if excl:
            def warum(s: dict) -> str:
                tage = int(s.get("hist_days") or 0)
                if tage < args.min_days:
                    return f"{tage} Tage"
                sorten = s.get("hist_fuels") or "keine Preise"
                return f"nur {sorten}" if args.fuel == "all" else f"ohne {args.fuel} ({sorten})"

            lines += ["", f"*nicht fürs Monitoring geeignet ({len(excl)}):* "
                      + ", ".join(f"{s['brand'] or '—'} {s['name']} [{warum(s)}]"
                                  for s in excl[:12])
                      + (" …" if len(excl) > 12 else "")]
        write_csv(args.out / f"{slug(lab)}_kandidaten.csv", ranked, bool(hist_stats))
        lines.append("")

    (args.out / "polling.json").write_text(
        json.dumps({"generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "source": used_src, "poll_size": args.poll_size, "sets": polling},
                   indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.write_pool:
        for lab, rows in pool_all.items():
            write_csv(args.out / f"{lab}_pool.csv", rows, False)
    rep = args.report or (args.out / "report.md")
    rep.parent.mkdir(parents=True, exist_ok=True)
    rep.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    if not args.quiet:
        print("\n".join(lines[:6]) + "\n")
        for lab, p in polling.items():
            print(f"# {lab}: Polling-Set {len(p['batch'])} → {', '.join(p['batch'])[:70]}")
        print(f"# Ausgaben: {args.out}/ (polling.json, *_kandidaten.csv"
              + (", *_pool.csv" if args.write_pool else "") + f"), Report {rep}")
    print("# nächsten Schritt: python3 data-tools/fetch_history.py --stations-latest "
          "(falls noch nicht da) und --check-history erneut, danach Ingest mit den "
          "Pool-CSVs als Basis")
    return 0


def args_timeout() -> int:
    return 30


def slug(label: str) -> str:
    keep = "".join(c if (c.isalnum() or c in "-_") else "-" for c in label.strip().lower())
    while "--" in keep:
        keep = keep.replace("--", "-")
    return keep.strip("-") or "ort"


if __name__ == "__main__":
    sys.exit(main())
