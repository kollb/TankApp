#!/usr/bin/env python3
"""
TankApp – A21-B5.3 (#213): Walk-forward-/Operational-Replay fahren.

Produktionskette (Aufbereitung→Fit→Bootstrap→PIT→Projektion→Veröffentlichung→
Nettoentscheidung) über mehrere Ursprungsstunden und -tage; Bewertung je Slice
mit vorab festgelegten Akzeptanzmargen (``app/replay.py:REPLAY_ACCEPTANCE``).
Dateneingänge werden strikt vor dem Fold-Ursprung geschnitten — das äußere
Abnahmeset bleibt für den späteren Freigabelauf unangetastet.

Beispiele:

    # Ersatzdaten (Regression/CI, Rolle synthetic)
    .venv/bin/python data-tools/run_replay.py --synthetic --days 45 \\
        --first-day 2026-10-01 --last-day 2026-10-04 --origin-hours 0,12

    # Echtes äußeres Abnahmeset (Freigabelauf, Rolle acceptance)
    .venv/bin/python data-tools/run_replay.py \\
        --holdout data/acceptance/holdout.csv --role acceptance

Report: ``results/replay/report.{json,md}`` (nicht versioniert).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings, engine_config  # noqa: E402
from app.replay import (  # noqa: E402
    BERLIN,
    REPLAY_ACCEPTANCE,
    REPLAY_SEED,
    fold_origins,
    load_holdout,
    run_replay,
    synthetic_holdout,
    write_replay_report,
)


def workspace_settings(workdir: Path, dataset: pd.DataFrame, *, fuel: str) -> Settings:
    """Polling-/Influx-Stammdaten des Folds aus dem Datensatz ableiten."""
    workdir.mkdir(parents=True, exist_ok=True)
    stations = (
        dataset[["station_id", "station_name", "city"]]
        .drop_duplicates("station_id")
        .sort_values("station_id")
    )
    sets = {}
    for _, row in stations.iterrows():
        sets.setdefault(
            row["city"], {"label": row["city"], "batch": [], "stations": []}
        )
        entry = {
            "uuid": row["station_id"],
            "name": row["station_name"],
            "lat": 50.11,
            "lon": 8.68,
        }
        sets[row["city"]]["batch"].append(row["station_id"])
        sets[row["city"]]["stations"].append(entry)
    polling = workdir / "polling.json"
    polling.write_text(
        json.dumps({"sets": sets, "request_interval_seconds": 300}),
        encoding="utf-8",
    )
    env = workdir / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n",
        encoding="utf-8",
    )
    return Settings(
        data=workdir / "data",
        archive=workdir / "archive",
        polling=polling,
        influx_env=env,
        netrc=workdir / "netrc",
        model_fuels=(fuel,),
    )


def _sha256_of(path: Path) -> dict[str, object]:
    """Prüfsumme + Größe einer Datei (Akzeptanzmanifest, M2)."""
    import hashlib

    digest = hashlib.sha256()
    size = 0
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
            size += len(chunk)
    return {"sha256": digest.hexdigest(), "bytes": size}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[2])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--holdout", type=Path, help="Observations-CSV des Abnahmesets")
    source.add_argument(
        "--synthetic",
        action="store_true",
        help="deterministischer Ersatzbestand (Regression/CI)",
    )
    parser.add_argument("--days", type=int, default=45, help="Tage im Ersatzbestand")
    parser.add_argument(
        "--stations", type=int, default=2, help="Stationen im Ersatzbestand"
    )
    parser.add_argument("--fuel", default="e10")
    parser.add_argument("--seed", type=int, default=REPLAY_SEED)
    parser.add_argument(
        "--role",
        choices=("development", "acceptance", "synthetic"),
        default=None,
    )
    parser.add_argument("--first-day", required=True, help="erster Fold-Tag (lokal)")
    parser.add_argument(
        "--last-day", required=True, help="letzter Fold-Tag exkl. (lokal)"
    )
    parser.add_argument(
        "--origin-hours",
        default="0,6,12,18",
        help="Ursprungsstunden (Wanduhr, kommagetrennt)",
    )
    parser.add_argument("--legacy-history-rows", type=int, default=0)
    parser.add_argument("--out", type=Path, default=Path("results/replay"))
    parser.add_argument("--workdir", type=Path, default=Path("results/replay/work"))
    args = parser.parse_args(argv)

    role = args.role or ("acceptance" if args.holdout else "synthetic")
    if role == "acceptance" and not args.holdout:
        parser.error("Rolle acceptance braucht --holdout (echtes äußeres Abnahmeset).")
    if args.holdout:
        dataset = load_holdout(args.holdout, fuel=args.fuel)
    else:
        dataset = synthetic_holdout(
            days=args.days,
            stations=args.stations,
            seed=args.seed,
            fuel=args.fuel,
        )
    dataset["timestamp"] = pd.to_datetime(dataset["timestamp"], utc=True)
    origin_hours = tuple(float(part) for part in str(args.origin_hours).split(","))
    sample = dataset.loc[dataset["timestamp"] == dataset["timestamp"].min()].iloc[0:1]
    probe = workspace_settings(args.workdir / "probe", sample, fuel=args.fuel)
    cfg = engine_config(probe)
    origins = fold_origins(
        args.first_day,
        args.last_day,
        cfg,
        origin_hours=origin_hours,
    )
    result = run_replay(
        dataset=dataset,
        settings_factory=lambda workdir: workspace_settings(
            workdir, dataset, fuel=args.fuel
        ),
        cfg=cfg,
        workdir=args.workdir,
        origins=origins,
        role=role,
        seed=args.seed,
        legacy_history_rows=args.legacy_history_rows,
        fuel=args.fuel,
    )
    result["acceptance_margins"] = REPLAY_ACCEPTANCE
    result["timezone"] = BERLIN
    # M2: Das Akzeptanzmanifest belegt, welches äußere Set unverändert in
    # den Freigabelauf ging (Pfad, SHA-256, Bytes). Ersatzbestand trägt
    # keinen Manifest-Hash — er ist Regression, kein Abnahmebeweis.
    if args.holdout:
        try:
            checksum = _sha256_of(args.holdout)
        except OSError:
            checksum = {"sha256": None, "bytes": None}
        result["acceptance_manifest"] = {
            "holdout": str(args.holdout),
            **checksum,
            "role": role,
            "frozen_note": (
                "Akzeptanzbestand ist zeitlich unangetastet und wird "
                "einmalig für den Freigabelauf verwendet."
            ),
        }
    else:
        result["acceptance_manifest"] = {
            "holdout": None,
            "sha256": None,
            "bytes": None,
            "role": role,
            "frozen_note": "Ersatzbestand (synthetic) — kein Abnahmebeweis.",
        }
    json_path, md_path = write_replay_report(result, args.out)
    ok = result["margins"]["ok"]
    print(
        f"Replay: {json_path} und {md_path} — Margen {'erfüllt' if ok else 'NICHT erfüllt'}."
    )
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
