#!/usr/bin/env python3
"""Bundled setup/operations. Standard library only; no PC venv required."""

import argparse
import datetime as dt
import json
import math
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT / "data-tools"
sys.path.insert(0, str(TOOLS))

from polling_plan import atomic_json, collector_lock, validate_sets  # noqa: E402

ACTIVE = ROOT / "docs/analysis/stations/polling.json"
LOCAL = ROOT / "analysis/config.local.json"


def run_tool(name, args):
    subprocess.run(
        [sys.executable, str(TOOLS / name), *map(str, args)], cwd=ROOT, check=True
    )


def netrc_args(explicit=None):
    candidates = (
        [Path(explicit)]
        if explicit
        else [
            ROOT / "data/_netrc",
            ROOT / "data/.netrc",
            ROOT / "_netrc",
            ROOT / ".netrc",
            Path.home() / ".netrc",
            Path.home() / "_netrc",
        ]
    )
    for path in candidates:
        if path.is_file():
            return ["--netrc", str(path.resolve())]
    if explicit:
        raise ValueError("Die angegebene netrc-Datei fehlt.")
    return []


def date_files(directory, kind):
    found = {}
    for path in directory.glob(f"{kind}/**/*-{kind}.csv*"):
        if not path.name.endswith((".csv", ".csv.gz")) or path.stat().st_size == 0:
            continue
        try:
            found[dt.date.fromisoformat(path.name[:10])] = path
        except ValueError:
            continue
    return found


def history_sync(args, today=None):
    """Pinned archive start + full-range gap scan, not merely 'fetch yesterday'."""
    if not 1 <= args.days <= 7300:
        raise ValueError("--days muss zwischen 1 und 7300 liegen.")
    archive = args.archive_dir.resolve()
    archive.mkdir(parents=True, exist_ok=True)
    # Same OS-lock primitive as the collector, but in an independent directory.
    with collector_lock(archive / ".sync", label="Archiv-Sync"):
        state_path = archive / ".sync/state.json"
        state = (
            json.loads(state_path.read_text(encoding="utf-8"))
            if state_path.exists()
            else {}
        )
        stop = (today or dt.date.today()) - dt.timedelta(days=1)
        requested = (
            dt.date.fromisoformat(args.since)
            if args.since
            else stop - dt.timedelta(days=args.days - 1)
        )
        if requested > stop:
            raise ValueError("Archivbeginn muss spätestens gestern sein.")
        # Never move the start forward; old gaps remain eligible after months offline.
        start = min(
            requested, dt.date.fromisoformat(state.get("archive_since", str(requested)))
        )
        existing = date_files(archive, "prices")
        if existing:
            start = min(start, min(existing))
        state.update(
            archive_since=str(start),
            requested_until=str(stop),
            status="running",
            last_attempt_at=dt.datetime.now(dt.timezone.utc).isoformat(),
        )
        atomic_json(state_path, state)
        error = None
        try:
            run_tool(
                "fetch_history.py",
                [
                    "--kind",
                    "both",
                    "--since",
                    start,
                    "--until",
                    stop,
                    "--outdir",
                    archive,
                    "--no-prompt",
                    "--quiet",
                    "--reuse-existing-format",
                    *netrc_args(args.netrc),
                ],
            )
        except (subprocess.CalledProcessError, OSError, ValueError) as exc:
            error = type(exc).__name__  # Never copy credentials/URLs from exceptions.
        files = {kind: date_files(archive, kind) for kind in ("prices", "stations")}
        gaps = []
        day = start
        while day <= stop:
            for kind in files:
                if day not in files[kind]:
                    gaps.append(f"{day}:{kind}")
            day += dt.timedelta(days=1)
        complete = not error and not gaps
        state.update(
            status="complete" if complete else "incomplete",
            missing_files=len(gaps),
            first_missing=gaps[:30],
            error=error,
            checked_at=dt.datetime.now(dt.timezone.utc).isoformat(),
        )
        if complete:
            state["last_complete_until"] = str(stop)
        atomic_json(state_path, state)
        print(
            f"NAS-Archiv {start} bis {stop}: {state['status']}, {len(gaps)} fehlende Tagesdateien."
        )
        print(f"Preise + Stationen: {archive}; Status: {state_path}")
        print(
            "Vorhandenes bleibt erhalten. Nächster Lauf ergänzt fehlende Dateien, auch alte Lücken."
        )
        return 0 if complete else 2


def add_city(args):
    """Fast provisional selection from station metadata, no price-history prerequisite."""
    from discover_stations import (
        dedupe_same_place,
        haversine_km,
        select_polling_set,
        stations_from_csv,
    )

    if not 1 <= args.size <= 10 or not 0 < args.radius <= 25:
        raise ValueError("1–10 Stationen und Radius größer 0 bis 25 km erforderlich.")
    if args.out.resolve() in {args.polling.resolve(), args.config.resolve()}:
        raise ValueError(
            "Vorschlag darf weder aktive Auswahl noch Ankerkonfiguration überschreiben."
        )
    active = json.loads(args.polling.read_text(encoding="utf-8-sig"))
    validate_sets(active)
    if args.city in active["sets"]:
        raise ValueError(
            "Stadt ist bereits enthalten; bestehende Auswahl wird nicht neu ersetzt."
        )
    config = (
        json.loads(args.config.read_text(encoding="utf-8-sig"))
        if args.config.exists()
        else {}
    )
    anchor = config.get("home", {}).get(args.city)
    if anchor is None:
        print(
            f"Einmaliger Anker für {args.city}; Eingabe bleibt lokal, keine Geocoding-Abfrage."
        )
        anchor = [
            float(input("Breitengrad (Dezimalpunkt): ")),
            float(input("Längengrad (Dezimalpunkt): ")),
        ]
    if (
        not isinstance(anchor, list)
        or len(anchor) != 2
        or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in anchor)
        or not (47 <= anchor[0] <= 56 and 5 <= anchor[1] <= 16)
    ):
        raise ValueError(
            "Bitte einen gültigen deutschen Anker lokal eintragen (keine 0/0-Platzhalter)."
        )
    # Configuration is saved only after a successful station selection.
    stations = args.stations
    if stations is None:
        # Can point at the NAS archive; never needs a price-history download.
        pool = date_files(args.archive_dir, "stations")
        stations = pool[max(pool)] if pool else None
        if not stations:
            run_tool(
                "fetch_history.py",
                [
                    "--stations-latest",
                    "--outdir",
                    args.archive_dir,
                    "--no-prompt",
                    *netrc_args(args.netrc),
                ],
            )
            pool = date_files(args.archive_dir, "stations")
            stations = pool[max(pool)] if pool else None
    if not stations:
        raise ValueError(
            "Keine Stationsliste verfügbar; bestehendes Polling unverändert."
        )
    candidates = []
    occupied = {
        uid.lower()
        for group in active["sets"].values()
        for uid in (
            group.get("batch") or [s["uuid"] for s in group.get("stations", [])]
        )
    }
    for station in stations_from_csv(stations).values():
        distance = haversine_km(*anchor, station["lat"], station["lon"])
        if distance <= args.radius and station["uuid"].lower() not in occupied:
            candidates.append({**station, "dist_km": round(distance, 3)})
    candidates.sort(key=lambda item: item["dist_km"])
    chosen = select_polling_set(dedupe_same_place(candidates, 1.5), args.size, set())
    if not chosen:
        raise ValueError(
            "Keine passenden Stationen im Radius; aktive Auswahl bleibt unverändert."
        )
    group = {
        "label": args.city,
        "anchor": anchor,
        "stations": chosen,
        "batch": [s["uuid"] for s in chosen],
        "selection": "provisional-nearby",
    }
    combined = {
        **active,
        "sets": {**active["sets"], args.city: group},
        "proposal": True,
        "request_interval_seconds": 300,
    }
    validate_sets(combined)
    config.setdefault("home", {})[args.city] = anchor
    if args.city == "Gütersloh":
        config.setdefault("subdiv", {})[args.city] = "NW"
    atomic_json(args.config, config)
    atomic_json(args.out, combined)
    print(
        f"{args.city}: {len(chosen)} vorläufige Stationen; vorhandene Sets unverändert übernommen."
    )
    print(f"Gemeinsamer Vorschlag: {args.out}")
    print(
        f"Ein Request alle 5 Minuten; jede Stadt etwa alle {len(combined['sets']) * 5} Minuten."
    )
    for station in chosen:
        print(
            f"  {station['brand']} {station['name']} – {station['dist_km']:.1f} km Luftlinie"
        )
    print("Noch keine billigste-Stations-/Umwegempfehlung. Aktivierung nur auf dem Pi.")
    return 0


def activate(args):
    """Use only on the existing Pi installation; rollback if restart fails."""
    if os.name != "posix" or os.geteuid() != 0:
        raise ValueError(
            "Auf dem Pi mit sudo ausführen; PC startet keine produktiven Dienste."
        )
    proposal = json.loads(args.proposal.read_text(encoding="utf-8-sig"))
    validate_sets(proposal)
    old = json.loads(ACTIVE.read_text(encoding="utf-8"))
    validate_sets(old)
    # This bundled path adds a city; changing/removing old stations is a separate operation.
    for city, group in old["sets"].items():
        if proposal["sets"].get(city) != group:
            raise ValueError(
                f"Bestehendes Set {city} wäre verändert. Aktivierung abgebrochen."
            )
    command = subprocess.run(
        ["systemctl", "show", "tankapp-collector", "--property=ExecStart", "--value"],
        text=True,
        capture_output=True,
        check=True,
    ).stdout
    if (
        str(ROOT / "data-tools/collect_prices.py") not in command
        or "--poll-city" in command
        or "--poll-json" in command
    ):
        raise ValueError(
            "Collector-Unit hat einen Sonderstartpfad/Stadtfilter. Vor Aktivierung prüfen; nichts geändert."
        )
    for service in ("tankapp-collector", "tankapp-uploader"):
        subprocess.run(["systemctl", "is-active", "--quiet", service], check=True)
    original_stat = ACTIVE.stat()
    backup = (
        ROOT
        / "data/setup"
        / f"polling-backup-{dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.json"
    )
    atomic_json(backup, old)

    def install(payload):
        atomic_json(ACTIVE, payload)
        os.chown(ACTIVE, original_stat.st_uid, original_stat.st_gid)
        os.chmod(ACTIVE, original_stat.st_mode & 0o777)

    subprocess.run(["systemctl", "stop", "tankapp-collector"], check=True)
    try:
        install({**proposal, "proposal": False})
        subprocess.run(
            ["systemctl", "restart", "tankapp-collector", "tankapp-uploader"],
            check=True,
        )
        for service in ("tankapp-collector", "tankapp-uploader"):
            subprocess.run(["systemctl", "is-active", "--quiet", service], check=True)
    except (subprocess.CalledProcessError, OSError):
        install(old)
        subprocess.run(
            ["systemctl", "restart", "tankapp-collector", "tankapp-uploader"],
            check=True,
        )
        raise ValueError(
            "Neustart fehlgeschlagen; vorherige Auswahl wiederhergestellt."
        ) from None
    print(f"Gemeinsames Polling aktiviert, Dienste neu gestartet. Sicherung: {backup}")
    print(
        "Dienststart ist noch kein Preisnachweis; beide Städte im Uploader/InfluxDB prüfen."
    )
    return 0


def serve_app(args):
    from app.config import Settings
    from app.server import serve

    serve(Settings.from_env(), args.host, args.port, args.jobs)
    return 0


def nas_up(args):
    from app.nas import up

    return up(args)


def refresh_models(args):
    from dataclasses import replace
    from app.config import Settings
    from app.worker import run

    settings = Settings.from_env()
    overrides = {
        name: value
        for name, value in {
            "archive": args.archive_dir,
            "data": args.data_dir,
            "polling": args.polling,
            "influx_env": args.influx_env,
        }.items()
        if value is not None
    }
    return run("models", replace(settings, **overrides))


def parser():
    ap = argparse.ArgumentParser(description=__doc__)
    commands = ap.add_subparsers(dest="command", required=True)
    web = commands.add_parser(
        "serve", help="GUI + nur lesende API; NAS-Dauerbetrieb bevorzugt mit nas-up"
    )
    web.add_argument("--host", default="0.0.0.0")
    web.add_argument("--port", type=int, default=8080)
    web.add_argument(
        "--jobs", action="store_true", help="Archiv-/Modelljobs mitstarten"
    )
    nas = commands.add_parser(
        "nas-up",
        help="NAS: GUI, API und automatische Jobs gemeinsam starten/aktualisieren",
    )
    nas.add_argument("--polling", type=Path)
    nas.add_argument("--influx-env", type=Path)
    nas.add_argument("--netrc", type=Path)
    nas.add_argument("--archive-dir", type=Path)
    nas.add_argument("--runtime-dir", type=Path)
    nas.add_argument("--port", type=int)
    nas.add_argument("--history-days", type=int)
    nas.add_argument("--model-fuels", help="Default e10; optional e10,e5,diesel")
    models = commands.add_parser(
        "refresh-models",
        help="Ein Rechenlauf: Export → Archiv-Ereignisse → Bootstrap → Fit/Backtest → Veröffentlichung",
    )
    models.add_argument("--archive-dir", type=Path)
    models.add_argument("--data-dir", type=Path)
    models.add_argument("--polling", type=Path)
    models.add_argument("--influx-env", type=Path)
    sync = commands.add_parser(
        "history-sync", help="NAS: Archiv initial laden und alle Lücken nachholen"
    )
    sync.add_argument("--archive-dir", type=Path, default=ROOT / "data/raw")
    sync.add_argument(
        "--days",
        type=int,
        default=365,
        help="Initialer Bestand; Default ein Jahr, keine Löschfrist",
    )
    sync.add_argument("--since", help="Alternativer früherer Archivbeginn YYYY-MM-DD")
    sync.add_argument("--netrc", type=Path)
    city = commands.add_parser(
        "add-city",
        help="Pi/NAS/PC: Stadt anhand Stationsliste vorbereiten, ohne Preisdownload",
    )
    city.add_argument("--city", default="Gütersloh")
    city.add_argument("--config", type=Path, default=LOCAL)
    city.add_argument("--polling", type=Path, default=ACTIVE)
    city.add_argument("--archive-dir", type=Path, default=ROOT / "data/raw")
    city.add_argument("--stations", type=Path)
    city.add_argument("--netrc", type=Path)
    city.add_argument("--size", type=int, default=10)
    city.add_argument("--radius", type=float, default=5)
    city.add_argument("--out", type=Path, default=ROOT / "data/setup/polling.json")
    activation = commands.add_parser(
        "activate-polling",
        help="Pi: Vorschlag sichern, installieren und Dienste neu starten",
    )
    activation.add_argument(
        "proposal", type=Path, nargs="?", default=ROOT / "data/setup/polling.json"
    )
    return ap


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        return {
            "serve": serve_app,
            "nas-up": nas_up,
            "refresh-models": refresh_models,
            "history-sync": history_sync,
            "add-city": add_city,
            "activate-polling": activate,
        }[args.command](args)
    except (
        ValueError,
        OSError,
        KeyError,
        TypeError,
        EOFError,
        subprocess.CalledProcessError,
    ) as exc:
        print(
            f"TankApp: {type(exc).__name__}: "
            + (
                str(exc)
                if isinstance(exc, ValueError)
                else "Lauf fehlgeschlagen; lokale Konfiguration/Zugriff prüfen."
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
