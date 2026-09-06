#!/usr/bin/env python3
"""
TankApp – Ein-Befehl-Pipeline: fetch → ingest → Selektion → Polling-Set.

Macht genau die manuelle Kette aus docs/DATEN-BEZUG.md (Kapitel 7/11) in einem
Aufruf und baut daraus das Live-Polling-Set (polling.json) für EINE Stadt
(default: Frankfurt) nach der Regel:

    * die N_billigsten im Gesamt-Umkreis (Preis-Leader, auch weiter weg —
      man ist im Alltag oft „woanders" (Nachbar, Einkauf, Arbeitsweg)),
    * plus die N_billigsten in der Nähe des Ankers (zuhause/Standardecke),
    * Auffüllung nach (Signifikanz, δ̂) bis poll_size, mit Marken-Dedupe
      (max. 2 je Marke, gleiche Marke nicht < 1,5 km doppelt).

Nur Standardbibliothek; ruft die data-tools/analysis-Skripte mit demselben
Python auf. Windows: `py -3 data-tools\\run_pipeline.py`.

Beispiel (alles, idempotent — bereits geladene Tage werden übersprungen):

    py -3 data-tools\run_pipeline.py
    py -3 data-tools\run_pipeline.py --poll-city Frankfurt --near-km 4
    py -3 data-tools\run_pipeline.py --skip-fetch --skip-ingest   # nur neu rechnen

Konfiguration:
    * analysis/config.local.json  (gitignored): home-Anker + subdiv je Stadt
    * netrc: automatisch gesucht unter data/_netrc, ./_netrc, ~/.netrc,
      oder per --netrc <datei>
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = ROOT / "analysis" / "config.local.json"
DEFAULT_OUT_STATIONS = ROOT / "docs" / "analysis" / "stations"
RAW_PRICES = ROOT / "data" / "raw" / "prices"
RAW_ROOT = ROOT / "data" / "raw"
READY = ROOT / "data" / "ready"
RESULTS = ROOT / "results"
FIGDIR = ROOT / "docs" / "analysis" / "figures"

EARTH_R_KM = 6371.0088


# --------------------------------------------------------------- Hilfen

def log(msg: str) -> None:
    print(msg, flush=True)


def run_script(script: str, args: list[str], cwd: Path | None = None) -> None:
    """Führt ein TankApp-Skript mit dem aktuellen Python aus (stdout live)."""
    cmd = [sys.executable, str(script), *args]
    log(f"\n$ {Path(script).name} {' '.join(args)}\n")
    subprocess.run(cmd, cwd=str(cwd or ROOT), check=True)


def find_netrc() -> Path | None:
    for p in (ROOT / "data" / "_netrc", ROOT / "data" / ".netrc",
              ROOT / "_netrc", ROOT / ".netrc",
              Path.home() / "_netrc", Path.home() / ".netrc"):
        if p.exists():
            return p
    return None


def find_stations_file() -> Path | None:
    """Neueste *-stations.csv(.gz) unter data/raw (wie ingest_history)."""
    pool = [p for p in sorted(RAW_ROOT.rglob("*.csv*"))
            if p.name.endswith("-stations.csv") or p.name.endswith("-stations.csv.gz")
            or (p.parent == RAW_ROOT and p.name.startswith("stations"))]
    return pool[-1] if pool else None


def earliest_price_day() -> dt.date | None:
    days = []
    for p in RAW_PRICES.rglob("*-prices.csv*"):
        try:
            days.append(dt.date.fromisoformat(p.name[:10]))
        except ValueError:
            continue
    return min(days) if days else None


def load_config(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(f"Config fehlt: {path} (Vorlage: analysis/config.local.example.json)")
    return json.loads(path.read_text(encoding="utf-8"))


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_R_KM * math.asin(math.sqrt(a))


# --------------------------------------------------------------- Stufen

def step_fetch(args: argparse.Namespace, netrc: Path | None) -> None:
    if args.skip_fetch:
        log("[fetch] übersprungen (--skip-fetch)")
        return
    first = earliest_price_day()
    since = args.since or (str(first) if first else str(dt.date.today() - dt.timedelta(days=180)))
    until = args.until or "yesterday"
    cmd = [str(HERE / "fetch_history.py"), "--since", since, "--until", until]
    if netrc:
        cmd += ["--netrc", str(netrc)]
    log(f"[fetch] Zeitraum {since}…{until} — fehlende Tage werden nachgeladen, "
        f"vorhandene übersprungen (idempotent).")
    run_script(HERE / "fetch_history.py", cmd[1:])
    # Tankstellenliste (uuid→Name/PLZ/Koordinaten) für den Ingest sicherstellen
    if not find_stations_file():
        log("[fetch] keine Stationsliste unter data/raw — hole neueste …")
        cmd2 = [str(HERE / "fetch_history.py"), "--stations-latest"]
        if netrc:
            cmd2 += ["--netrc", str(netrc)]
        run_script(HERE / "fetch_history.py", cmd2[1:])


def step_ingest(args: argparse.Namespace) -> None:
    if args.skip_ingest:
        log("[ingest] übersprungen (--skip-ingest)")
        return
    stations = find_stations_file()
    if not stations:
        raise SystemExit("Keine Tankstellenliste unter data/raw gefunden — bitte "
                         "`py -3 data-tools\\fetch_history.py --netrc data\\_netrc "
                         "--stations-latest` einmal ausführen (oder --skip-ingest).")
    cmd = [str(HERE / "ingest_history.py"),
           "--config", str(args.config),
           "--stations", str(stations),
           "--radius", str(args.radius),
           "--resample", str(args.resample),
           "--density", str(args.density),
           "--city", "campaign",
           "--fuel", args.fuel.lower(),
           "--out", str(READY),
           "--qa", str(READY / "QA.md")]
    run_script(HERE / "ingest_history.py", cmd[1:])
    log(f"[ingest] fertig → {READY}/<stadt>_hist.csv + manifest.json + QA.md")


def step_select(args: argparse.Namespace) -> None:
    if args.skip_select:
        log("[select] übersprungen (--skip-select)")
        return
    cfg = load_config(args.config)
    ready_files = sorted(READY.glob("*_hist.csv*"))
    if not ready_files:
        raise SystemExit(f"Keine Ready-CSVs in {READY} — Ingest lief nicht?")
    subdiv_parts = []
    for lab in (cfg.get("home") or {}):
        sub = (cfg.get("subdiv") or {}).get(lab)
        if sub:
            subdiv_parts.append(f"{lab}:{sub}")
    cmd = [str(ROOT / "analysis" / "station_selection.py"),
           "--data", *[str(p) for p in ready_files],
           "--fuel", args.fuel.upper(),
           "--top", str(args.top),
           "--step-min", str(args.step_min),
           "--config", str(args.config),
           "--results", str(RESULTS),
           "--report", str(ROOT / "docs" / "analysis" / "report_top10.md"),
           "--figdir", str(FIGDIR)]
    if subdiv_parts:
        cmd += ["--subdiv", ";".join(subdiv_parts)]
    run_script(ROOT / "analysis" / "station_selection.py", cmd[1:])
    log(f"[select] fertig → results/station_scores_{args.fuel.lower()}.csv "
        f"(alle Städte) + docs/analysis/report_top10.md")


# ------------------------------------------------------- Polling-Set (5+5)

def _f(v: str) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")


def build_polling_set(scores_csv: Path, anchor_label: str,
                      anchor_lat: float, anchor_lon: float,
                      near_km: float, near_n: int, leader_n: int,
                      poll_size: int, fuel: str) -> dict:
    """Wählt das Polling-Set: Preis-Leader im Gesamtumkreis + billigste in Nähe."""
    rows = []
    with open(scores_csv, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if (r.get("city") or "").strip().casefold() != anchor_label.casefold():
                continue
            try:
                lat, lon = _f(r["lat"]), _f(r["lon"])
            except KeyError:
                continue
            rows.append({
                "uuid": r["station_id"].strip(),
                "name": r.get("station_name", "").strip(),
                "brand": r.get("brand", "").strip() or "—",
                "lat": lat, "lon": lon,
                "dist_km": haversine_km(anchor_lat, anchor_lon, lat, lon),
                "delta_ct": _f(r.get("delta_ct", "nan")),
                "net_eur": _f(r.get("net_per_fill_eur", "nan")),
                "q": _f(r.get("q_value", "nan")),
                "sig": (r.get("significant", "").strip() == "True"),
            })
    if not rows:
        raise SystemExit(f"{scores_csv}: keine Stationen für Stadt '{anchor_label}' — "
                         "Selektion (--skip-select?) oder city-Spalte prüfen.")

    def sort_key(stat: dict) -> tuple:
        # billigste zuerst; signifikant günstig vor nicht-signifikant
        sig = 0.0 if stat["sig"] else 1.0
        return (sig, stat["delta_ct"], stat["dist_km"])

    ranked = sorted(rows, key=sort_key)
    near_pool = sorted([s for s in rows if s["dist_km"] <= near_km], key=sort_key)

    chosen: list[dict] = []
    groups: list[str] = []

    def ok_brand(s: dict) -> bool:
        same = [c for c in chosen if c["brand"] == s["brand"]]
        if len(same) >= 2:                      # max. 2 je Marke
            return False
        if any(c["brand"] == s["brand"] and haversine_km(c["lat"], c["lon"],
                                                         s["lat"], s["lon"]) < 1.5 for c in chosen):
            return False                        # gleiche Marke < 1,5 km = Zwilling
        return True

    def take(s: dict, group: str) -> None:
        if len(chosen) >= poll_size or any(c["uuid"] == s["uuid"] for c in chosen):
            return
        if not ok_brand(s):
            return
        chosen.append(s)
        groups.append(group)

    # 1) Preis-Leader im GESAMTEN Umkreis (man ist oft woanders: Nachbar, Einkauf …)
    for s in ranked:
        if len([g for g in groups if g == "leader"]) >= leader_n:
            break
        take(s, "leader")
    # 2) die Billigsten in der NÄHE des Ankers (zuhause)
    for s in near_pool:
        if len([g for g in groups if g == "nahe"]) >= near_n:
            break
        take(s, "nahe")
    # 3) Auffüllen bis poll_size (bester Rest nach δ̂/Signifikanz)
    for s in ranked:
        take(s, "auffuellung")

    if len(chosen) < poll_size:
        print(f"  ⚠ nur {len(chosen)} statt {poll_size} Stationen verfügbar "
              f"(Coverage-Gate/Nähe) — Set bleibt kleiner.", file=sys.stderr)

    return {
        "anchor_label": anchor_label, "anchor_lat": anchor_lat, "anchor_lon": anchor_lon,
        "rule": (f"{near_n} billigste in ≤ {near_km:g} km um Anker + {leader_n} billigste "
                 f"im Gesamtumkreis (Preis-Leader) + Auffüllung; max. 2 je Marke, "
                 f"gleiche Marke ≥ 1,5 km; Kraftstoff {fuel}"),
        "stations": chosen, "groups": groups,
    }


def step_poll(args: argparse.Namespace) -> None:
    if args.skip_poll:
        log("[poll] übersprungen (--skip-poll)")
        return
    cfg = load_config(args.config)
    homes = cfg.get("home") or {}
    label = args.poll_city
    if label not in homes:
        raise SystemExit(f"--poll-city '{label}' nicht in config.local.json "
                         f"(home: {', '.join(homes) or '—'})")
    scores_csv = RESULTS / f"station_scores_{args.fuel.lower()}.csv"
    if not scores_csv.exists():
        raise SystemExit(f"{scores_csv} fehlt — Selektion lief nicht (--skip-select?)")

    lat, lon = homes[label]
    log(f"[poll] Set für {label}: Leader {args.leader_n} + Nähe {args.near_n} "
        f"(≤ {args.near_km:g} km), Zielgröße {args.poll_size}")
    res = build_polling_set(scores_csv, label, float(lat), float(lon),
                            args.near_km, args.near_n, args.leader_n,
                            args.poll_size, args.fuel.upper())

    out_dir = args.out_stations
    out_dir.mkdir(parents=True, exist_ok=True)
    sets = {label: {
        "label": label,
        "lat": round(float(lat), 5), "lon": round(float(lon), 5),
        "radius_km": args.radius,
        "rule": res["rule"],
        "batch": [s["uuid"] for s in res["stations"]],
        "stations": [{
            "uuid": s["uuid"], "name": s["name"], "brand": s["brand"],
            "dist_km": round(s["dist_km"], 2),
            "delta_ct": round(s["delta_ct"], 2),
            "net_per_fill_eur": round(s["net_eur"], 2),
            "significant": s["sig"], "group": g,
        } for s, g in zip(res["stations"], res["groups"])],
    }}
    payload = {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": f"run_pipeline.py aus {scores_csv.name} (Selektion, --step-min {args.step_min})",
        "poll_size": args.poll_size,
        "sets": sets,
    }
    (out_dir / "polling.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"[poll] polling.json → {out_dir / 'polling.json'} (gitignored!)")

    # menschenlesbarer Report
    lines = [
        f"# Polling-Set {label} (E10, {args.poll_size} UUIDs = 1 prices.php-Request)",
        "",
        f"Regel: {res['rule']}",
        "",
        "| # | Gruppe | Marke | Station | δ̂ [ct/L] | sign. | Entf. [km] | Netto €/Füll |",
        "|---:|---|---|---|---:|---:|---:|---:|",
    ]
    for i, (s, g) in enumerate(zip(res["stations"], res["groups"]), 1):
        lines.append(f"| {i} | {g} | {s['brand']} | {s['name'][:40]} | "
                     f"{s['delta_ct']:+.2f} | {'✅' if s['sig'] else ''} | "
                     f"{s['dist_km']:.1f} | {s['net_eur']:+.2f} |")
    lines += [
        "",
        "Gruppen: **leader** = billigste im ganzen 25-km-Umkreis (auch weiter weg — "
        "du bist oft woanders), **nahe** = billigste rund um den Anker (zuhause),",
        "**auffuellung** = Rest bis zur Set-Größe. Automatisch erzeugt von "
        "`data-tools/run_pipeline.py` — Änderungen bitte im Script, nicht von Hand.",
        "",
        "Nächster Schritt: Sobald der Collector (M1) im Repo ist, frisst er genau "
        "diese `polling.json`.",
    ]
    md_path = out_dir / f"polling_{label.casefold().replace(' ', '_')}.md"
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log(f"[poll] Report → {md_path}")


# --------------------------------------------------------------- Haupt

def main() -> int:
    ap = argparse.ArgumentParser(
        description="TankApp-Komplettpipeline: fetch → ingest → Selektion → polling.json.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG,
                    help="gitignored Lokalkonfig (home-Anker + subdiv)")
    ap.add_argument("--netrc", type=Path, default=None,
                    help="netrc-Datei (Default: auto-Suche data/_netrc … ~/.netrc)")
    ap.add_argument("--since", default=None, help="fetch ab (Default: ältester "
                    "vorhandener Roh-Tag, sonst 180 Tage)")
    ap.add_argument("--until", default=None, help="fetch bis (Default: yesterday)")
    ap.add_argument("--radius", type=float, default=25.0)
    ap.add_argument("--fuel", default="e10", help="Kraftstoff (e10/e5/diesel)")
    ap.add_argument("--resample", type=int, default=30, help="Ingest-Raster (min)")
    ap.add_argument("--density", type=int, default=60, help="Ingest-Fortschreibung (min)")
    ap.add_argument("--step-min", type=int, default=30,
                    help="Selektions-Raster (30 = Tankerkönig-Änderungshistorie)")
    ap.add_argument("--top", type=int, default=10, help="Top-N im Report")
    ap.add_argument("--poll-city", default="Frankfurt",
                    help="Stadt, für die das 10er-Polling-Set gebaut wird")
    ap.add_argument("--near-km", type=float, default=4.0,
                    help="Nahbereich um den Anker (km)")
    ap.add_argument("--near-n", type=int, default=5, help="billigste in der Nähe")
    ap.add_argument("--leader-n", type=int, default=5,
                    help="billigste im Gesamtumkreis (Preis-Leader)")
    ap.add_argument("--poll-size", type=int, default=10)
    ap.add_argument("--out-stations", type=Path, default=DEFAULT_OUT_STATIONS,
                    help="Ziel für polling.json + Report")
    ap.add_argument("--skip-fetch", action="store_true")
    ap.add_argument("--skip-ingest", action="store_true")
    ap.add_argument("--skip-select", action="store_true")
    ap.add_argument("--skip-poll", action="store_true")
    args = ap.parse_args()

    if not (args.config).exists():
        raise SystemExit(f"Config fehlt: {args.config} — bitte aus "
                         "analysis/config.local.example.json anlegen (gitignored).")
    netrc = args.netrc or find_netrc()
    if netrc:
        log(f"netrc: {netrc}")
    elif not args.skip_fetch:
        log("⚠ keine netrc gefunden — fetch wird Zugangsdaten vermissen "
            "(~/.netrc, data/_netrc oder --netrc)")

    t0 = time.time()
    for step in (step_fetch, step_ingest, step_select, step_poll):
        step(args)
    log(f"\n✅ Fertig in {(time.time() - t0) / 60:.1f} min. "
        f"Ausgaben: {READY}/ (Historie), results/, docs/analysis/report_top10.md, "
        f"{args.out_stations}/polling.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
