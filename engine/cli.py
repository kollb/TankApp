import argparse
import glob
import json
import sys
from pathlib import Path

import pandas as pd

from .backtest import markdown_report, run_backtest
from .config import Config
from .data import describe, load_observations, prepare_series
from .models import SCHEMA_VERSION, fit, predict, utc_time
from .storage import json_safe, write_json


def input_paths(patterns: list[str]) -> list[Path]:
    paths = []
    for pattern in patterns:
        matches = sorted(glob.glob(pattern))
        if not matches:
            raise ValueError(
                f"Keine Datei für {pattern!r} gefunden. Erst Historie/InfluxDB exportieren."
            )
        paths.extend(Path(match) for match in matches)
    return list(dict.fromkeys(paths))


def selected_ids(path: Path | None, city: str | None) -> set[str] | None:
    if path is None:
        if city:
            raise ValueError("--poll-city benötigt --polling.")
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    ids = set()
    for key, stset in (payload.get("sets") or {}).items():
        if city and city not in (key, stset.get("label")):
            continue
        ids.update(
            stset.get("batch")
            or [station["uuid"] for station in stset.get("stations", [])]
        )
    if not ids:
        raise ValueError("Keine Stationen im gewählten Polling-Set.")
    return ids


def load_raw_input(args):
    half_life = getattr(args, "bootstrap_ew_half_life", 14.0)
    cfg = Config(
        train_days=args.train_days,
        min_train_days=args.min_train_days,
        poll_start=args.poll_start,
        poll_end=args.poll_end,
        bootstrap_ew_half_life_days=(
            None if half_life is not None and half_life <= 0 else half_life
        ),
    )
    ids = selected_ids(args.polling, args.poll_city)
    observations, quality = load_observations(
        input_paths(args.data), cfg, args.fuel, ids
    )
    if ids:
        missing = ids - set(observations.station_id)
        if missing:
            raise ValueError(
                "Für ausgewählte Stationen fehlen Daten: "
                + ", ".join(sorted(missing))
                + ". Nicht stillschweigend aus der Auswertung ausgeschlossen."
            )
    return cfg, observations, quality


def load_input(args):
    cfg, observations, quality = load_raw_input(args)
    series = prepare_series(observations, cfg)
    return (
        cfg,
        series,
        {**quality, "stations": [describe(item, cfg) for item in series]},
    )


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        description="TankApp M3-Werkstatt: echte Daten, keine Demo-Fallbacks."
    )
    commands = root.add_subparsers(dest="command", required=True)
    for name, help_text in [
        ("bootstrap", "Historischer Warmstart mit geprüftem Übergang zu Polling-Daten"),
        ("inspect", "Datenqualität prüfen, auch bei erst wenigen Live-Tagen"),
        ("fit", "Struktur + AR(2) auf NAS/PC fitten, JSON-Artefakt schreiben"),
        ("backtest", "Täglicher Rolling-Origin-Backtest gegen saisonale Naive"),
    ]:
        command = commands.add_parser(name, help=help_text)
        command.add_argument(
            "--data",
            nargs="+",
            required=True,
            help="CSV / CSV.gz; Wildcards auch unter Windows",
        )
        command.add_argument("--fuel", choices=["E5", "E10", "DIESEL"], default="E10")
        command.add_argument(
            "--polling",
            type=Path,
            help="Nur UUIDs dieses privaten polling.json auswerten",
        )
        command.add_argument("--poll-city")
        command.add_argument("--train-days", type=int, default=42)
        command.add_argument("--min-train-days", type=int, default=28)
        command.add_argument(
            "--bootstrap-ew-half-life",
            type=float,
            default=14.0,
            help="Halbwertszeit (Tage) für den exponentiell gewichteten "
            "Tagesblock-Bootstrap (Issue 46); <=0 = uniform.",
        )
        command.add_argument("--poll-start", type=int, default=6)
        command.add_argument("--poll-end", type=int, default=24)
        if name == "bootstrap":
            command.add_argument("--at", help="Exklusiver Cutoff (Default: jetzt)")
            command.add_argument("--live-only-days", type=int, default=90)
            command.add_argument(
                "--expected-poll-minutes",
                type=int,
                help="Default: aus gemeinsamem Polling-Plan; sonst 5 Minuten",
            )
            command.add_argument("--min-daily-coverage", type=float, default=0.95)
            command.add_argument(
                "--out", type=Path, default=Path("data/engine/bootstrap.csv.gz")
            )
        elif name == "inspect":
            command.add_argument(
                "--out", type=Path, default=Path("results/engine/quality.json")
            )
        elif name == "fit":
            command.add_argument(
                "--at",
                help="Fit-Cutoff (exklusiv, ISO-Zeit; Default: letzter Rasterpunkt + 5 min)",
            )
            command.add_argument(
                "--out", type=Path, default=Path("data/models/forecast.json")
            )
        else:
            command.add_argument("--days", type=int, default=21)
            command.add_argument(
                "--until", help="Exklusives Ende, lokale Mitternacht (ISO-Datum)"
            )
            command.add_argument(
                "--out", type=Path, default=Path("results/engine/backtest")
            )
    forecast = commands.add_parser(
        "forecast", help="Inference aus JSON-Artefakt, kein Refit / Netzaufruf"
    )
    forecast.add_argument(
        "--model", type=Path, default=Path("data/models/forecast.json")
    )
    forecast.add_argument(
        "--hours",
        type=int,
        default=24,
        help="Ab Fit-Cutoff, 1–168 h; nur 24 h im Backtest geprüft",
    )
    forecast.add_argument("--out", type=Path, default=Path("data/engine/forecast.json"))
    comparison = commands.add_parser(
        "compare-stations",
        help="Preis-Zwillinge anhand UUID-getrennter Historien prüfen; kein Auto-Ausschluss",
    )
    comparison.add_argument("--data", nargs="+", required=True)
    comparison.add_argument("--polling", type=Path, required=True)
    comparison.add_argument("--poll-city")
    comparison.add_argument("--brand", help="Marke aus polling.json, z. B. ARAL")
    comparison.add_argument("--fuel", choices=["E5", "E10", "DIESEL"], default="E10")
    comparison.add_argument(
        "--out", type=Path, default=Path("results/engine/price_twins")
    )
    return root


def run(args) -> int:
    if args.command == "bootstrap":
        from .bootstrap import bootstrap, write_csv

        if not args.out.name.endswith((".csv", ".csv.gz")):
            raise ValueError("Bootstrap-Ausgabe muss .csv oder .csv.gz sein.")
        paths = {path.resolve() for path in input_paths(args.data)}
        report_path = Path(str(args.out) + ".policy.json")
        if args.out.resolve() in paths or report_path.resolve() in paths:
            raise ValueError("Bootstrap-Ausgabe darf keine Eingabedatei überschreiben.")
        if args.polling and args.polling.resolve() in {
            args.out.resolve(),
            report_path.resolve(),
        }:
            raise ValueError("Bootstrap-Ausgabe darf polling.json nicht überschreiben.")
        cfg, observations, quality = load_raw_input(args)
        cadence = args.expected_poll_minutes
        if cadence is None and args.polling:
            payload = json.loads(args.polling.read_text(encoding="utf-8"))
            # All sets share the collector's request budget, even when only one
            # city is being evaluated here. --poll-city is NOT a collector setting.
            cadence = (
                len(payload["sets"]) * payload.get("request_interval_seconds", 300) / 60
            )
        output, policy = bootstrap(
            observations,
            cfg,
            args.at if args.at else pd.Timestamp.now(tz="UTC"),
            args.live_only_days,
            args.min_daily_coverage,
            cadence if cadence is not None else 5,
        )
        if args.polling:
            missing = selected_ids(args.polling, args.poll_city) - set(
                output.station_id
            )
            if missing:
                raise ValueError(
                    "Vor dem Cutoff fehlen Stationen: " + ", ".join(sorted(missing))
                )
        write_csv(args.out, output)
        write_json(report_path, {**policy, "input_quality": quality})
        for item in policy["stations"]:
            print(
                f"{item['city']} / {item['station_id']} / {item['fuel']}: "
                f"{item['mode']} – {item['good_complete_live_days']}/"
                f"{item['required_complete_live_days']} vollständige Live-Tage mit Zielabdeckung"
            )
        print(f"Bootstrap-Daten → {args.out}; Übergangsbericht → {report_path}")
        print(
            "Keine Live-Lücken mit Archivpreisen gefüllt; keine kalibrierte Tankempfehlung."
        )
        return 0
    if args.command == "compare-stations":
        from .station_comparison import (
            compare_stations,
            markdown_report as comparison_markdown,
        )

        report = compare_stations(
            input_paths(args.data), args.polling, args.fuel, args.brand, args.poll_city
        )
        args.out.mkdir(parents=True, exist_ok=True)
        write_json(args.out / "report.json", report)
        (args.out / "report.md").write_text(
            comparison_markdown(report), encoding="utf-8"
        )
        print(
            f"{len(report['pairs'])} Stationspaar(e) geprüft → {args.out / 'report.md'}"
        )
        print(
            "Nur lesend: keine automatische Auswahl, keine Änderung an Polling-Set oder InfluxDB."
        )
        return 0
    if args.command == "forecast":
        if args.model.resolve() == args.out.resolve():
            raise ValueError(
                "Prognose-Ausgabe darf nicht das Modell-Artefakt überschreiben."
            )
        bundle = json.loads(args.model.read_text(encoding="utf-8"))
        if bundle.get("schema_version") != SCHEMA_VERSION or not bundle.get("models"):
            raise ValueError("Ungültiges/leeres Modell-Bundle.")
        forecasts = []
        now = pd.Timestamp.now(tz="UTC")
        for model in bundle["models"]:
            frame = predict(model, args.hours)
            age = float((now - utc_time(model["origin"])).total_seconds() / 3600)
            frame["timestamp"] = frame.index.map(lambda time: time.isoformat())
            observation = model.get("last_observation")
            data_age = (
                float(
                    (utc_time(model["origin"]) - utc_time(observation)).total_seconds()
                    / 60
                )
                if observation
                else None
            )
            forecasts.append(
                {
                    **{
                        key: model[key]
                        for key in (
                            "city",
                            "station_id",
                            "station_name",
                            "fuel",
                            "origin",
                            "last_observation",
                        )
                    },
                    "model_age_hours": max(0, age),
                    "stale_model": age > 24,
                    "data_age_minutes_at_origin": data_age,
                    "stale_data": data_age is None
                    or data_age > model["config"]["ffill_minutes"],
                    "calibrated": False,
                    "decision_ready": False,
                    "interval_method": model["interval_method"],
                    "points": frame.to_dict(orient="records"),
                }
            )
        write_json(
            args.out,
            {
                "schema_version": 1,
                "generated_at": now.isoformat(),
                "calibrated": False,
                "decision_ready": False,
                "forecasts": forecasts,
            },
        )
        print(
            f"{len(forecasts)} unkalibrierte Prognosen ab jeweiligem Fit-Cutoff → {args.out}"
        )
        if any(item["stale_model"] for item in forecasts):
            print(
                "WARNUNG: Modell älter als 24 Stunden; historischer Ausblick, kein aktueller Nowcast."
            )
        if any(item["stale_data"] for item in forecasts):
            print(
                "WARNUNG: Am Fit-Cutoff lagen veraltete Eingangsdaten vor; kein frischer Nowcast."
            )
        return 0

    cfg, series, quality = load_input(args)
    if quality["invalid_or_ambiguous_timestamps"]:
        print(
            f"WARNUNG: {quality['invalid_or_ambiguous_timestamps']} ungültige/mehrdeutige Zeitstempel verworfen."
        )
    if quality["rows_without_status"]:
        print(
            "HINWEIS: Ein Teil der Historie hat keinen Status; Öffnungszeiten sind dort unbekannt."
        )
    if args.command == "inspect":
        write_json(args.out, quality)
        print(
            json.dumps(
                json_safe(quality), ensure_ascii=False, indent=2, allow_nan=False
            )
        )
        print(f"Datenqualität → {args.out}")
    elif args.command == "fit":
        origin = (
            utc_time(args.at, cfg.timezone)
            if args.at
            else max(item.frame.index.max() for item in series)
            + pd.Timedelta(minutes=cfg.step_minutes)
        )
        # All fits must succeed before the last good bundle is replaced.
        models = [fit(item, origin, cfg) for item in series]
        write_json(
            args.out,
            {"schema_version": SCHEMA_VERSION, "models": models, "quality": quality},
        )
        print(
            f"{len(models)} Modelle → {args.out}; unkalibriert, M3-Abnahme noch offen."
        )
    else:
        report, rows = run_backtest(series, cfg, args.days, args.until)
        args.out.mkdir(parents=True, exist_ok=True)
        write_json(args.out / "report.json", {**report, "quality": quality})
        (args.out / "report.md").write_text(markdown_report(report), encoding="utf-8")
        rows.to_csv(args.out / "predictions.csv.gz", index=False, compression="gzip")
        print(
            f"{report['metrics']['points']} Vergleichspunkte → {args.out / 'report.md'}; M3 nicht abgenommen."
        )
        if not report["metrics"]["points"]:
            print(
                "Zu wenig passende Historie / offene Beobachtungen; Gründe in report.json.",
                file=sys.stderr,
            )
            return 2
    return 0


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        return run(args)
    except (ValueError, OSError, KeyError, TypeError, EOFError) as exc:
        print(f"Engine abgebrochen: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    # Vorher war `python -m engine.cli` ein stiller Null-Exit (kein
    # __main__-Block); korrekt ist `python -m engine`, aber `-m engine.cli`
    # darf ruhig dasselbe tun statt zu verpuffen (Prüfstand §3.8).
    raise SystemExit(main())
