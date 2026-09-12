#!/usr/bin/env python3
"""
TankApp – Ein-Befehl-Pipeline: fetch → ingest → Selektion → Polling-Set.

Bündelt die optionale vertiefte Analyse aus docs/DATENWERKZEUGE.md in einem
Aufruf und baut daraus das Live-Polling-Set (polling.json) für EINE Stadt
(default: Frankfurt) nach der Regel (Auswahl nach NETTO-Vorteil, nicht
blankem Preis):

    * die N NÄCHSTEN Stationen zum Anker (≤ --near-km, zuhause) — die man
      wirklich anfährt (Bequemlichkeit, kleine δ̂-Unterschiede = Rauschen),
    * plus die besten Stationen JENSEITS der Nähe aber innerhalb
      --leader-max-km (Default 12 km Straße), deren Umweg sich nach
      Sprit+Zeit NETTO lohnt (Netto €/Füll > 0) = Leader,
    * Auffüllung bis poll_size mit den BILLIGSTEN weiteren Stationen im
      Radius — das sind Routen-Stationen für ohnehin stattfindende Wege
      (Einkaufen/Arbeit, z. B. Globus/Guericke), keine Extra-Fahr-Empfehlung;
      Stationen > leader-max-km werden gar nicht gepollt
      (30 km fahren für 2 € Rabatt lohnt sich nie),
    * Marken-Dedupe (max. 2 je Marke, gleiche Marke nicht < 1,5 km doppelt).

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

# Straßen-Routing (optional): echte Straßen-km statt Luftlinie. Selbes Modul
# wie in analysis/station_selection.py — Import mit Fallback, damit die
# Pipeline auch ohne funktionsfähigen Import läuft.
sys.path.insert(0, str(HERE))
try:
    from road_route import RoadRouter
except ImportError:  # pragma: no cover
    RoadRouter = None


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
           "--router", args.router,
           "--config", str(args.config),
           "--results", str(RESULTS),
           "--report", str(ROOT / "docs" / "analysis" / "report_top10.md"),
           "--figdir", str(FIGDIR)]
    if args.osrm_url:
        cmd += ["--osrm-url", args.osrm_url]
    if args.router == "osrm":
        cmd += ["--route-cache", str(RESULTS / "road_route_cache.json"),
                "--congestion-peak", str(args.congestion_peak),
                "--congestion-offpeak", str(args.congestion_offpeak),
                "--near-km", str(args.near_km)]
    if subdiv_parts:
        cmd += ["--subdiv", ";".join(subdiv_parts)]
    run_script(ROOT / "analysis" / "station_selection.py", cmd[1:])
    log(f"[select] fertig → results/station_scores_{args.fuel.lower()}.csv "
        f"(alle Städte) + data/analysis/report_top10.md")


# ------------------------------------------------------- Polling-Set (5+5)

def _f(v: str) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")


def build_polling_set(scores_csv: Path, anchor_label: str,
                      anchor_lat: float, anchor_lon: float,
                      near_km: float, near_n: int, leader_n: int,
                      poll_size: int, fuel: str,
                      leader_max_km: float = 12.0,
                      router: "RoadRouter | None" = None,
                      exclude_uuids: "set[str] | None" = None) -> dict:
    """Wählt das Polling-Set nach NETTO-Vorteil, nicht nach blankem Preis.

    Drei Gruppen (Straßen-km ab Anker, sonst Luftlinie):
      * **nahe**    : billigste in ≤ near_km (zuhause — man tankt eh hier,
                      Mehrweg minimal); sortiert nach Preis.
      * **leader**  : Stationen JENSEITS near_km, aber innerhalb
                      leader_max_km, deren Umweg sich NETTO lohnt
                      (net_per_fill_eur > 0, also Sprit+Zeit eingerechnet);
                      sortiert nach Netto €/Füllung absteigend.
      * **auffuellung**: Rest bis poll_size aus dem selben Radius.
    Stationen weiter als leader_max_km werden GAR NICHT gepollt: ein
    30-km-Umweg ist nie eine Empfehlung (netto stark negativ), egal wie
    billig der Liter ist.
    """
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
                "dist_km": haversine_km(anchor_lat, anchor_lon, lat, lon),  # Default, s.u.
                "delta_ct": _f(r.get("delta_ct", "nan")),
                "net_eur": _f(r.get("net_per_fill_eur", "nan")),
                "net_fuel": _f(r.get("net_fuel_only_eur", "nan")),
                "q": _f(r.get("q_value", "nan")),
                "sig": (r.get("significant", "").strip() == "True"),
            })
    if not rows:
        raise SystemExit(f"{scores_csv}: keine Stationen für Stadt '{anchor_label}' — "
                         "Selektion (--skip-select?) oder city-Spalte prüfen.")

    excluded = set(exclude_uuids or ())
    unknown = excluded - {s["uuid"] for s in rows}
    if unknown:
        raise SystemExit("Ausschluss enthält UUIDs, die in den Scores dieser Kampagne nicht vorkommen; Bericht/UUIDs prüfen.")
    rows = [s for s in rows if s["uuid"] not in excluded]
    if not rows:
        raise SystemExit("Nach den Ausschlüssen sind keine Kandidaten übrig; kein Polling-Set erzeugt.")

    if router is not None:
        # EINE OSRM-Table-Anfrage für alle Stationen der Stadt (Cache + Fallback).
        routes = router.routes_from(
            anchor_lat, anchor_lon, [(s["lat"], s["lon"]) for s in rows])
        for i, s in enumerate(rows):
            s["dist_km"], s["dur_min"] = routes[i]
        for idx, fac, d_road in getattr(router, "suspicious", []):
            print(f"  ⚠ {rows[idx]['name'][:40]}: Straße/Luftlinie = {fac:.1f}× "
                  f"({d_road:.1f} km) — Anker vermutlich auf eine Autobahnrampe "
                  "geschnappt; Anker-Koordinate in config.local.json auf die "
                  "eigene Hausstraße setzen (nicht auf das Autobahnkreuz).",
                  file=sys.stderr)
    else:
        for s in rows:
            s["dur_min"] = None

    def is_num(x: float) -> bool:
        return x == x and x not in (float("inf"), float("-inf"))

    def key_price(stat: dict) -> tuple:
        # billigste zuerst; signifikant günstig vor nicht-signifikant
        sig = 0.0 if stat["sig"] else 1.0
        return (sig, stat["delta_ct"], stat["dist_km"])

    def key_near(stat: dict) -> tuple:
        # NÄCHSTE zuerst (nah = eh da, Bequemlichkeit zählt); bei Gleichstand billiger.
        # Die δ̂-Unterschiede im Nahbereich sind 0-1 ct = im Rauschen der KI.
        return (stat["dist_km"], stat["delta_ct"])

    def key_net(stat: dict) -> tuple:
        # höchster Netto-Vorteil (Sprit+Zeit) zuerst; NaN/negativ nach hinten
        net = stat["net_eur"] if is_num(stat["net_eur"]) else -1e9
        sig = 0.0 if stat["sig"] else 1.0
        return (-net, sig, stat["dist_km"])

    # Pools nach Straßen-Entfernung
    near_pool = sorted([s for s in rows if s["dist_km"] <= near_km], key=key_near)
    far_rows = [s for s in rows if near_km < s["dist_km"] <= leader_max_km]
    beyond = sorted([s for s in rows if s["dist_km"] > leader_max_km],
                    key=lambda s: s["dist_km"])
    # Leader-Kandidaten: billig SORTIERT für die Netto-Prüfung (take wählt dann
    # die Netto-positiven aus); near_pool bleibt entfernungs-sortiert.
    far_pool = sorted(far_rows, key=key_net)
    if beyond:
        print(f"  ℹ {len(beyond)} Stationen liegen > {leader_max_km:g} km Straße und "
              f"werden NICHT gepollt (Umweg netto zu teuer), z. B.:", file=sys.stderr)
        for s in beyond[:4]:
            print(f"      {s['dist_km']:5.1f} km  netto {s['net_eur']:+5.2f} €  "
                  f"{s['name'][:38]}", file=sys.stderr)

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

    def take(s: dict, group: str) -> bool:
        if len(chosen) >= poll_size or any(c["uuid"] == s["uuid"] for c in chosen):
            return False
        if not ok_brand(s):
            return False
        chosen.append(s)
        groups.append(group)
        return True

    # 1) PREIS-LEADER: weiter weg, aber der Umweg lohnt sich NETTO (Sprit+Zeit).
    #    Nur Stationen mit nachweislich positivem Netto-Vorteil zählen als Leader;
    #    gibt es keine, ist die ehrliche Antwort: lokal tanken.
    n_leader = 0
    for s in far_pool:
        if n_leader >= leader_n:
            break
        if is_num(s["net_eur"]) and s["net_eur"] > 0 and take(s, "leader"):
            n_leader += 1
    if n_leader == 0:
        print(f"  ℹ Keine Station im Radius {near_km:g}–{leader_max_km:g} km, deren "
              "Umweg sich nach Sprit+Zeit NETTO lohnt — die günstigste Entscheidung "
              "ist: in der Nähe tanken.", file=sys.stderr)

    # 2) NÄHE: die Billigsten rund um den Anker (zuhause — eh da)
    n_near = 0
    for s in near_pool:
        if n_near >= near_n:
            break
        if take(s, "nahe"):
            n_near += 1

    # 3) AUFFÜLLEN bis poll_size. Das sind KEINE Empfehlungen für eine
    #    Extra-Fahrt, sondern die preiswertesten Stationen im Radius, die man
    #    auf ohnehin stattfindenden Wegen (Einkaufen, Arbeitsweg) anfährt —
    #    billigste zuerst (δ̂), damit bei mehr Stationen als Slots die
    #    preiswertesten Routen-Kandidaten (z. B. Globus/Guericke) gewinnen.
    far_by_price = sorted(far_rows, key=key_price)
    for s in far_by_price + near_pool:
        take(s, "auffuellung")

    if len(chosen) < poll_size:
        print(f"  ⚠ nur {len(chosen)} statt {poll_size} Stationen im ≤{leader_max_km:g}-km-"
              f"Radius verfügbar (Coverage-Gate/Nähe/Netto) — Set bleibt kleiner. "
              "Ggf. --leader-max-km etwas erhöhen.", file=sys.stderr)

    basis = "OSRM-Straßen-km" if router is not None else "Luftlinie (Haversine)"
    return {
        "anchor_label": anchor_label, "anchor_lat": anchor_lat, "anchor_lon": anchor_lon,
        "rule": (f"{near_n} NÄCHSTE in ≤ {near_km:g} km um Anker (nahe, Bequemlichkeit) "
                 f"+ die max. {leader_n} Stationen mit POSITIVEM Netto-Vorteil (Sprit+Zeit) "
                 f"im Radius {near_km:g}–{leader_max_km:g} km (Leader, Umweg lohnt) "
                 f"+ Auffüllung: die billigsten weiteren Stationen im ≤{leader_max_km:g}-km-"
                 f"Radius für ohnehin stattfindende Wege (Einkaufen/Arbeit, z. B. Globus/"
                 f"Guericke) — KEINE Extra-Fahr-Empfehlung; > {leader_max_km:g} km wird "
                 f"nicht gepollt; max. 2 je Marke, gleiche Marke ≥ 1,5 km; Kraftstoff "
                 f"{fuel}; Entfernung: {basis}"
                 + (f"; VORSCHLAG, explizit ausgeschlossen: {', '.join(sorted(excluded))}" if excluded else "")),
        "stations": chosen, "groups": groups,
        "excluded_uuids": sorted(excluded),
    }


def warn_if_scores_stale(args: argparse.Namespace, cfg: dict, label: str,
                         scores_csv: Path) -> bool:
    """Erkennt, ob die Netto-Spalten der scores-CSV nicht mehr zur aktuellen
    Config passen (Anker verschoben oder Routing geändert, aber --skip-select
    benutzt). Dann wären Entfernungen frisch (OSRM, poll-Schritt) und
    Netto-Werte veraltet (select-Schritt mit altem Anker). Rückgabe: True =
    nachweislich veraltet (Netto nicht vertrauenswürdig)."""
    meta_path = scores_csv.with_suffix(".meta.json")
    if not meta_path.exists():
        # Alte CSV ohne Metadaten: nur warnen, nicht hart abbrechen (nicht beweisbar).
        log("  ℹ scores-Metadaten fehlen — falls der Anker oder --router seit "
            "dem letzten SELECT-Lauf geändert wurde, Netto-Werte neu rechnen "
            "(ohne --skip-select).")
        return False
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    home = cfg.get("home") or {}
    if label not in home:
        return False
    try:
        lat, lon = float(home[label][0]), float(home[label][1])
    except (TypeError, ValueError, IndexError):
        return False
    mhome = meta.get("homes") or {}
    same = False
    if label in mhome:
        try:
            same = (abs(float(mhome[label][0]) - lat) < 1e-4
                    and abs(float(mhome[label][1]) - lon) < 1e-4)
        except (TypeError, ValueError, IndexError):
            same = False
    stale = []
    if not same:
        stale.append(f"Anker ({mhome.get(label)} → {[lat, lon]})")
    if meta.get("router") != args.router:
        stale.append(f"Routing ({meta.get('router')} → {args.router})")
    if args.router == "osrm":
        mp, mo = meta.get("congestion_peak"), meta.get("congestion_offpeak")
        if mp is not None and (abs(mp - args.congestion_peak) > 1e-9
                               or abs((mo or 1.0) - args.congestion_offpeak) > 1e-9):
            stale.append(f"Staufaktor ({mp:.2g}/{mo:.2g} → "
                         f"{args.congestion_peak:.2g}/{args.congestion_offpeak:.2g})")
        mn = meta.get("near_km")
        if mn is not None and abs(mn - args.near_km) > 1e-9:
            stale.append(f"Nahbereich Stau-Kontext ({mn:g} → {args.near_km:g} km)")
    if stale:
        log("  ⚠ WARNUNG: Die Netto-Spalten stammen aus einem älteren Select-Lauf "
            f"({', '.join(stale)} geändert), die Entfernungen sind aber frisch. "
            "Ergebnis wäre gemischt/veraltet.")
        return True
    return False


def validate_proposal_target(args: argparse.Namespace) -> None:
    if getattr(args, "exclude_uuid", None) and args.out_stations.resolve() == DEFAULT_OUT_STATIONS.resolve():
        raise SystemExit("Ausschlüsse zunächst nur als Vorschlag speichern: --out-stations data/analysis/stations-vorschlag. Aktives Polling-Set bleibt unverändert.")


def validate_polling_target(args: argparse.Namespace) -> None:
    """A one-city run must never erase another city's already generated set."""
    if getattr(args, "skip_poll", False):
        return
    target = args.out_stations / "polling.json"
    if not target.exists():
        return
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
        sets = payload["sets"]
        if not isinstance(sets, dict) or not sets:
            raise ValueError("sets fehlt/leer")
    except (ValueError, KeyError, TypeError) as exc:
        raise SystemExit(f"Vorhandenes {target} ist ungültig; wird nicht überschrieben.") from exc
    others = set(sets) - {args.poll_city}
    if others:
        raise SystemExit(
            f"{target} enthält andere Städte ({', '.join(sorted(others))}). "
            "Ein Stadtlauf darf diese nicht ersetzen. Separates --out-stations "
            "verwenden, z. B. data/analysis/stations-guetersloh."
        )


def step_poll(args: argparse.Namespace) -> None:
    validate_proposal_target(args)
    validate_polling_target(args)
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
    if args.skip_select and warn_if_scores_stale(args, cfg, label, scores_csv):
        raise SystemExit(
            "❌ Abbruch: station_scores mit --skip-select übernommen, aber die "
            "Netto-Spalten stammen von einem ANDEREN Anker/Routing (s. Warnung).\n"
            "   Einmal mit aktuellem select rechnen:\n"
            "      python3 data-tools/run_pipeline.py --router osrm --skip-fetch "
            "--skip-ingest --leader-max-km 10 --near-km 5\n"
            "   (danach sind Distanz UND Netto konsistent.)")

    lat, lon = homes[label]
    log(f"[poll] Set für {label}: Leader {args.leader_n} (Umweg lohnt netto, "
        f"≤ {args.leader_max_km:g} km) + Nähe {args.near_n} (≤ {args.near_km:g} km), "
        f"Zielgröße {args.poll_size}")
    router = None
    if getattr(args, "router", "haversine") == "osrm":
        if RoadRouter is None:
            log("⚠ --router osrm: road_route.py nicht importierbar — nutze Luftlinie.")
        else:
            router = RoadRouter(mode="driving", base_url=args.osrm_url,
                                cache_path=RESULTS / "road_route_cache.json",
                                quiet=False)
            log(f"[poll] Entfernungen: OSRM/OpenStreetMap "
                f"({args.osrm_url or 'öffentlicher Demo-Server'}) — echte Straßen-km")
    res = build_polling_set(scores_csv, label, float(lat), float(lon),
                            args.near_km, args.near_n, args.leader_n,
                            args.poll_size, args.fuel.upper(),
                            leader_max_km=args.leader_max_km, router=router,
                            exclude_uuids=set(getattr(args, "exclude_uuid", ()) or ()))

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
            "lat": round(s["lat"], 6), "lon": round(s["lon"], 6),
            "dist_km": round(s["dist_km"], 2),
            "drive_min": (round(s["dur_min"], 1) if s.get("dur_min") is not None else None),
            "maps": f"https://www.google.com/maps/dir/?api=1&destination={s['lat']:.6f},{s['lon']:.6f}",
            "delta_ct": round(s["delta_ct"], 2),
            "net_per_fill_eur": round(s["net_eur"], 2),
            "net_fuel_only_eur": (round(s["net_fuel"], 2)
                                  if s["net_fuel"] == s["net_fuel"] else None),
            "significant": s["sig"], "group": g,
        } for s, g in zip(res["stations"], res["groups"])],
    }}
    payload = {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": f"run_pipeline.py aus {scores_csv.name} (Selektion, --step-min {args.step_min})",
        "poll_size": args.poll_size,
        "proposal": bool(res["excluded_uuids"]),
        "excluded_uuids": res["excluded_uuids"],
        "sets": sets,
    }
    (out_dir / "polling.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"[poll] polling.json → {out_dir / 'polling.json'} (gitignored!)")

    if res["excluded_uuids"]:
        log("[poll] VORSCHLAG mit expliziten Ausschlüssen: " + ", ".join(res["excluded_uuids"]))
        log("[poll] Nicht ungeprüft aktivieren: Auswahländerung repariert keine alten vermischten Influx-Namensserien.")

    # menschenlesbarer Report
    entf_hdr = "Entf. Straße [km]" if router is not None else "Entf. Luftlinie [km]"
    lines = [
        f"# Polling-Set {label} (E10, {args.poll_size} UUIDs = 1 prices.php-Request)",
        "",
        f"Regel: {res['rule']}",
        "",
        f"Anker: `{res['anchor_lat']:.5f}, {res['anchor_lon']:.5f}` "
        f"(stammt aus analysis/config.local.json).",
        "",
        "| # | Gruppe | Marke | Station | δ̂ [ct/L] | sign. | " + entf_hdr + " | Netto €/Füll | davon nur Sprit | Koordinaten | Maps |",
        "|---:|---|---|---|---:|---:|---:|---:|---:|---|---|",
    ]
    for i, (s, g) in enumerate(zip(res["stations"], res["groups"]), 1):
        maps = (f"https://www.google.com/maps/dir/?api=1&destination="
                f"{s['lat']:.6f},{s['lon']:.6f}")
        nf = s.get("net_fuel")
        nf_str = f"{nf:+.2f}" if isinstance(nf, float) and nf == nf else "—"
        lines.append(f"| {i} | {g} | {s['brand']} | {s['name'][:40]} | "
                     f"{s['delta_ct']:+.2f} | {'✅' if s['sig'] else ''} | "
                     f"{s['dist_km']:.1f} | {s['net_eur']:+.2f} | {nf_str} | "
                     f"`{s['lat']:.5f},{s['lon']:.5f}` | [Route]({maps}) |")
    lines += [
        "",
        f"Gruppen: **nahe** = die {args.near_n} NÄCHSTEN in ≤ {args.near_km:g} km um den "
        "Anker (zuhause, Bequemlichkeit — die fährt man wirklich); **leader** = Stationen "
        "weiter weg, **deren Umweg sich nach Sprit UND Zeit NETTO lohnt** (Netto €/Füll > 0), "
        f"nur bis {args.leader_max_km:g} km Straße; **auffuellung** = die billigsten weiteren "
        "Stationen im Radius, gedacht für ohnehin stattfindende Wege (Einkaufen/Arbeit — "
        "Globus/Guericke fährt man beim Einkaufen an, ohne Extra-Umweg); das sind **keine** "
        f"Extra-Fahr-Empfehlungen. Stationen jenseits von {args.leader_max_km:g} km werden gar "
        "nicht gepollt (egal wie billig — der Umweg ist netto ein Verlust). Erzeugt von "
        "`data-tools/run_pipeline.py`.",
        "",
        "**Netto €/Füll > 0 prüfen:** Nur Leader mit positivem Netto sind eine echte "
        "„woanders\"-Empfehlung; steht in der leader-Gruppe keine Station, heißt die "
        "ehrliche Antwort: **nicht extra woanders hinfahren.** Die Spalte „davon nur "
        "Sprit\" zeigt den Barvorteil OHNE Zeitbewertung — ist auch der negativ, "
        "rechnet sich der Umweg selbst ohne Zeitkosten nicht (Faustregel: eine Station "
        "5 km weiter braucht ≈ −10 ct/L Preisvorteil; im Stadtmarkt sind es nur 2–7 ct). "
        "Bei der **nahe**-Gruppe ist die Netto-Spalte sekundär: dort zählt nicht ein "
        "Umweg, sondern zur richtigen Zeit an einer ohnehin nahen Station zu tanken — "
        "das Geld steckt im Intraday-Zeitfenster (abends billiger), nicht im Standort.",
        "",
        "**Entfernung prüfen:** Die Spalte „Entf.\" misst ab dem Anker oben. Weicht "
        "der Wert stark von Google Maps ab, stimmen die Koordinaten nicht — über den "
        "Maps-Link prüfen, ob der Pin auf der richtigen Station steht, und ob der "
        "**Anker** in `analysis/config.local.json` wirklich der eigene Standort ist "
        "(Hausstraße, nicht Autobahnkreuz/Stadtmitte, lat/lon nicht vertauscht). "
        "Straßen-km statt Luftlinie: `--router osrm` (OSRM/OpenStreetMap, kostenlos).",
        "",
        "Der laufende Collector (`data-tools/collect_prices.py`) verwendet genau "
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
    ap.add_argument("--near-n", type=int, default=5,
                    help="wie viele der NÄCHSTEN Stationen in --near-km als 'nahe' "
                         "(die fährt man wirklich). Rest bis poll_size wird mit "
                         "billigen Routen-Stationen (Einkaufen/Arbeit) aufgefüllt.")
    ap.add_argument("--leader-n", type=int, default=5,
                    help="max. Anzahl Leader (Umweg lohnt sich NETTO)")
    ap.add_argument("--leader-max-km", type=float, default=12.0,
                    help="Harte Entfernungsgrenze für Leader/Auffüllung in Straßen-km "
                         "(Luftlinie ohne --router). Stationen dahinter werden nie "
                         "gepollt: ein so weiter Umweg lohnt sich nach Sprit+Zeit nie.")
    ap.add_argument("--poll-size", type=int, default=10)
    ap.add_argument("--router", choices=["haversine", "osrm"], default="haversine",
                    help="Entfernungsbasis: 'haversine' = Luftlinie (Default); "
                         "'osrm' = echte Straßen-km/Fahrzeit via OSRM/OpenStreetMap "
                         "(kostenlos, Cache in results/, Fallback Luftlinie)")
    ap.add_argument("--osrm-url", default=None,
                    help="OSRM-Server für --router osrm (Default: öffentlicher "
                         "Demo-Server; eigener Server z. B. http://nas:5000)")
    ap.add_argument("--congestion-peak", type=float, default=1.45,
                    help="Staufaktor Berufsverkehr auf OSRM-Freifluss-Zeit "
                         "(1.0=kein Stau, 1.45=~35 statt 50 km/h, 2.0=Stop&Go)")
    ap.add_argument("--congestion-offpeak", type=float, default=1.0,
                    help="Staufaktor außerhalb des Berufsverkehrs (Freifluss=1.0)")
    ap.add_argument("--out-stations", type=Path, default=DEFAULT_OUT_STATIONS,
                    help="Ziel für polling.json + Report")
    ap.add_argument("--exclude-uuid", action="append", default=[],
                    help="Nach Preis-/Nutzbarkeitsprüfung ausschließen (wiederholbar); benötigt separates --out-stations für einen Vorschlag")
    ap.add_argument("--skip-fetch", action="store_true")
    ap.add_argument("--skip-ingest", action="store_true")
    ap.add_argument("--skip-select", action="store_true")
    ap.add_argument("--skip-poll", action="store_true")
    args = ap.parse_args()
    validate_proposal_target(args)
    validate_polling_target(args)

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
    step_fetch(args, netrc)          # netrc wird nur für fetch gebraucht
    step_ingest(args)
    step_select(args)
    step_poll(args)
    log(f"\n✅ Fertig in {(time.time() - t0) / 60:.1f} min. "
        f"Ausgaben: {READY}/ (Historie), results/, data/analysis/report_top10.md, "
        f"{args.out_stations}/polling.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
