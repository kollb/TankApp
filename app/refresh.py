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
    with collector_lock(output, label="Modellaktualisierung"):
        live_paths = []
        for fuel in settings.model_fuels:
            path = settings.runtime / "exports" / f"influx_{fuel}.csv.gz"
            # Failure preserves the prior export and must not masquerade as a current update.
            influx.export_prices(
                env,
                origin.to_pydatetime() - dt.timedelta(days=settings.model_days),
                origin.to_pydatetime(),
                lookup,
                fuel,
                path,
                uuid_only=True,
            )
            live_paths.append(path)
        all_live = True
        for fuel in settings.model_fuels:
            live, _ = load_observations(live_paths, cfg, fuel, ids)
            _, policy = bootstrap(live, cfg, origin, expected_poll_minutes=cadence)
            all_live &= ids == set(live.station_id) and all(
                item["mode"] == "live_only" for item in policy["stations"]
            )
        history_paths, archive_quality = [], {}
        if not all_live:
            history_paths, archive_quality = prepare_archive(
                settings.archive,
                metas,
                settings.model_fuels,
                local_day - dt.timedelta(days=settings.model_days),
                local_day,
                settings.runtime / "archive-cache",
            )
        forecasts, models, policies, failures = [], [], [], []
        for fuel in settings.model_fuels:
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
            for identity in metas:
                item = series.get(identity)
                if item is None:
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
                            "metrics": report["metrics"],
                            "backtest_days": 7,
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
                except ValueError:
                    failures.append(
                        {
                            **item.identity(),
                            "reason": "insufficient_or_invalid_training_data",
                        }
                    )
        if not forecasts:
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
        return {
            "state": "partial" if failures else "success",
            "error_code": "some_models_unavailable" if failures else None,
        }
