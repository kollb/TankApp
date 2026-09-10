"""One model-refresh operation on NAS or optional PC; only publish completed results."""

import datetime as dt
import json
import uuid

from .config import Settings
from .data import metadata, publication


def refresh(settings: Settings, now=None):
    # Heavy numerical dependencies are confined to this worker, not the live API.
    import pandas as pd
    import export_influx as influx
    from engine.backtest import run_backtest
    from engine.bootstrap import bootstrap, write_csv
    from engine.config import Config
    from engine.data import load_observations, prepare_series
    from engine.models import fit, predict
    from engine.selection import SelectionConfig, compute_all as compute_selection
    from engine.storage import write_json
    from polling_plan import collector_lock
    from .history import prepare_archive

    metas, error = metadata(settings)
    if error or not settings.influx_env.is_file():
        return {"state": "waiting", "error_code": error or "influx_not_configured"}
    cfg = Config()
    origin = (
        (pd.Timestamp(now) if now is not None else pd.Timestamp.now(tz="UTC"))
        .tz_convert("UTC")
        .floor("5min")
    )
    local_day = origin.tz_convert(cfg.timezone).date()
    env = influx.load_config(settings.influx_env, timeout=60)
    env.validate()
    lookup = influx.station_lookup(settings.polling)
    payload = json.loads(settings.polling.read_text(encoding="utf-8-sig"))
    cadence = len(payload["sets"]) * payload.get("request_interval_seconds", 300) / 60
    output = settings.runtime / "engine"
    output.mkdir(parents=True, exist_ok=True)
    ids = {uid for _, uid in metas}
    print(
        f"models: {len(metas)} Stationen, Kraftstoffe "
        f"{','.join(settings.model_fuels)}, Cutoff {origin.isoformat()}",
        flush=True,
    )
    with collector_lock(output, label="Modellaktualisierung"):
        live_paths = []
        for fuel in settings.model_fuels:
            path = settings.runtime / "exports" / f"influx_{fuel}.csv.gz"
            print(
                f"models: exportiere InfluxDB {fuel} "
                f"(letzte {settings.model_days} Tage) ...",
                flush=True,
            )
            # Failure preserves the prior export and must not masquerade as a current update.
            summary = (
                influx.export_prices(
                    env,
                    origin.to_pydatetime() - dt.timedelta(days=settings.model_days),
                    origin.to_pydatetime(),
                    lookup,
                    fuel,
                    path,
                    uuid_only=True,
                )
                or {}
            )
            print(
                f"models: Export {fuel}: {summary.get('rows', '?')} Zeilen, "
                f"{summary.get('open_prices', '?')} offene Preise",
                flush=True,
            )
            live_paths.append(path)
        print("models: prüfe Live-Abdeckung (90-Tage-Regel) ...", flush=True)
        all_live = True
        for fuel in settings.model_fuels:
            live, _ = load_observations(live_paths, cfg, fuel, ids)
            _, policy = bootstrap(live, cfg, origin, expected_poll_minutes=cadence)
            all_live &= ids == set(live.station_id) and all(
                item["mode"] == "live_only" for item in policy["stations"]
            )
        print(
            f"models: alle Stationen live_only: {'ja' if all_live else 'nein'}",
            flush=True,
        )
        history_paths, archive_quality = [], {}
        if not all_live:
            start = local_day - dt.timedelta(days=settings.model_days)
            print(
                f"models: bereite Archiv {start} bis {local_day} auf ...",
                flush=True,
            )
            history_paths, archive_quality = prepare_archive(
                settings.archive,
                metas,
                settings.model_fuels,
                start,
                local_day,
                settings.runtime / "archive-cache",
            )
            print(
                f"models: Archiv: {archive_quality.get('events', '?')} Ereignisse, "
                f"{archive_quality.get('missing_days', '?')} fehlende Tage",
                flush=True,
            )
        forecasts, models, policies, failures = [], [], [], []
        selections = {}
        for fuel in settings.model_fuels:
            print(
                f"models: Training {fuel}: Bootstrap + Fit "
                f"für {len(metas)} Stationen ...",
                flush=True,
            )
            observations, _ = load_observations(
                history_paths + live_paths, cfg, fuel, ids
            )
            data, policy = bootstrap(
                observations, cfg, origin, expected_poll_minutes=cadence
            )
            policies.extend(policy["stations"])
            path = settings.runtime / "training" / f"{fuel}.csv.gz"
            write_csv(path, data)
            # Reload preserves missing historical status; never serialize assumed open as evidence.
            normalized, _ = load_observations([path], cfg, fuel, ids)
            series = {
                (item.city, item.station_id): item
                for item in prepare_series(normalized, cfg)
            }
            for position, identity in enumerate(metas, start=1):
                label = f"{identity[0]} – {metas[identity].get('name', identity[1])}"
                item = series.get(identity)
                if item is None:
                    print(
                        f"models: [{position}/{len(metas)}] {label} "
                        f"({fuel}): FEHLER missing_history",
                        flush=True,
                    )
                    failures.append(
                        {
                            "city": identity[0],
                            "station_id": identity[1],
                            "fuel": fuel,
                            "reason": "missing_history",
                        }
                    )
                    continue
                try:
                    model = fit(item, origin, cfg)
                    prediction = predict(model, hours=24)
                    report, _ = run_backtest([item], cfg, days=7)
                    prediction["timestamp"] = prediction.index.map(
                        lambda stamp: stamp.isoformat()
                    )
                    # Erweiterte Horizonte (+3/+7 Tage) für die Werkstatt-Ansicht.
                    # Jeweils eigener Predict ab Cutoff (kein Slicing), damit die
                    # 12-Uhr-Projektion denselben Kontext wie der 24-h-Lauf sieht.
                    # Nur Quantile + Zeitstempel: Diagnostikspalten blieben Ballast.
                    horizons = {}
                    for key, hours in (("points_3d", 72), ("points_7d", 168)):
                        wide = predict(model, hours=hours)
                        wide["timestamp"] = wide.index.map(
                            lambda stamp: stamp.isoformat()
                        )
                        horizons[key] = wide[
                            [
                                "timestamp",
                                "q025",
                                "q10",
                                "q50",
                                "q90",
                                "q975",
                            ]
                        ].to_dict(orient="records")
                    models.append(model)
                    last = model.get("last_observation")
                    age = (
                        (origin - pd.Timestamp(last)).total_seconds() / 60
                        if last
                        else None
                    )
                    forecasts.append(
                        {
                            **item.identity(),
                            "origin": origin.isoformat(),
                            "last_observation": last,
                            "data_age_minutes_at_origin": age,
                            "stale_data_at_origin": age is None
                            or age > cfg.ffill_minutes,
                            "points": prediction.to_dict(orient="records"),
                            **horizons,
                            "metrics": report["metrics"],
                            "backtest_days": 7,
                            "train_days": cfg.train_days,
                            "decision_rows": [
                                r
                                for r in report.get("decision", {}).get("rows", [])
                                if (r.get("city"), r.get("station_id")) == identity
                            ],
                            "decision_hour": report.get("decision", {}).get(
                                "decision_hour", 8
                            ),
                            "operational_replay": False,
                            "data_policy": next(
                                (
                                    p
                                    for p in policy["stations"]
                                    if (p["city"], p["station_id"]) == identity
                                ),
                                None,
                            ),
                            "calibrated": False,
                            "decision_ready": False,
                            "retained_previous": False,
                        }
                    )
                    print(
                        f"models: [{position}/{len(metas)}] {label} ({fuel}): ok",
                        flush=True,
                    )
                except ValueError as error:
                    # The engine message quantifies the actual shortfall (usable
                    # days and open price points). Fixed German text from the
                    # engine, no credentials; surface it instead of swallowing.
                    detail = str(error)
                    print(
                        f"models: [{position}/{len(metas)}] {label} "
                        f"({fuel}): FEHLER unzureichende Trainingsdaten – {detail}",
                        flush=True,
                    )
                    failures.append(
                        {
                            **item.identity(),
                            "reason": "insufficient_or_invalid_training_data",
                            "detail": detail,
                        }
                    )
            # --- Selektion (δ̂, KI, AV, billigste Stunde) je Kraftstoff ---
            try:
                # metas gruppiert nach Stadt für die Selektion
                metas_by_city: dict[str, dict[str, dict]] = {}
                for (city, uid), meta in metas.items():
                    metas_by_city.setdefault(city, {})[uid] = meta
                # n_boot=200 wie Standalone-Job „selection“ und Doku (ANALYSE.md)
                sel_cfg = SelectionConfig(fuel=fuel.upper(), n_boot=200)
                sel_result = compute_selection(normalized, sel_cfg, metas_by_city)
                selections[fuel] = sel_result
                print(
                    f"models: Selektion {fuel}: {len(sel_result.get('top_global', []))} Top-Stationen, "
                    f"{len(sel_result.get('cities', []))} Städte",
                    flush=True,
                )
            except Exception as exc:
                print(
                    f"models: Selektion {fuel} übersprungen ({type(exc).__name__}: {exc})",
                    flush=True,
                )
        print(
            f"models: {len(forecasts)} Prognosen, {len(failures)} Fehler",
            flush=True,
        )
        if not forecasts:
            print(
                "models: keine Station fittbar; Details in engine/last-attempt.json",
                flush=True,
            )
            write_json(
                output / "last-attempt.json",
                {
                    "at": origin.isoformat(),
                    "failures": failures,
                    "archive_quality": archive_quality,
                },
            )
            return {"state": "waiting", "error_code": "insufficient_history"}
        # A new station must not block updates for mature stations. Keep old successful
        # forecasts only for still-selected identities, with original origin + explicit flag.
        fresh_keys = {
            (row["city"], row["station_id"], row["fuel"].lower()) for row in forecasts
        }
        for prior in publication(settings).get("forecasts", []):
            key = (
                prior.get("city"),
                prior.get("station_id"),
                prior.get("fuel", "").lower(),
            )
            if (
                key[:2] in metas
                and key[2] in settings.model_fuels
                and key not in fresh_keys
            ):
                forecasts.append({**prior, "retained_previous": True})
        print("models: publiziere ...", flush=True)
        model_name = "models-" + uuid.uuid4().hex + ".json"
        write_json(output / model_name, {"schema_version": 1, "models": models})
        # This is the sole publication point. Partial files or failed fits never replace it.
        write_json(
            output / "current.json",
            {
                "schema_version": 1,
                "published_at": origin.isoformat(),
                "forecasts": forecasts,
                "failures": failures,
                "policies": policies,
                "archive_quality": archive_quality,
                "model_file": model_name,
                "calibrated": False,
                "decision_ready": False,
            },
        )
        # Bounded model diagnostics; raw archive and current publication are not pruned.
        for old in sorted(
            output.glob("models-*.json"), key=lambda p: p.stat().st_mtime, reverse=True
        )[3:]:
            if old.name != model_name:
                try:
                    old.unlink(missing_ok=True)
                except OSError:
                    pass  # Publication succeeded; cleanup must not turn it into a failed update.

        # --- Selektions-Artefakte publizieren (für „Meine Stationen“) ---
        try:
            sel_dir = settings.runtime / "selection"
            sel_dir.mkdir(parents=True, exist_ok=True)
            # Einzeldateien je Kraftstoff + kombinierte current.json
            for fuel_key, sel_data in selections.items():
                write_json(sel_dir / f"{fuel_key}.json", sel_data)
            # Kombiniert
            combined = {
                "generated_at": origin.isoformat(),
                "fuels": list(selections.keys()),
                "by_fuel": selections,
            }
            write_json(sel_dir / "current.json", combined)
            print(
                f"models: Selektion publiziert nach {sel_dir}/current.json", flush=True
            )
        except Exception as exc:
            print(
                f"models: Selektion-Publish übersprungen ({type(exc).__name__})",
                flush=True,
            )

        return {
            "state": "partial" if failures else "success",
            "error_code": "some_models_unavailable" if failures else None,
        }
