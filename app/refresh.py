"""One model-refresh operation on NAS or optional PC; only publish completed results."""

import datetime as dt
import json
import uuid

from .config import Settings
from .data import metadata, publication


# Aufgaben je Station: Fit+24 h, +3 d, +7 d, Backtest (siehe app/model_jobs.py).
TASKS_PER_STATION = 4

# Prüfstand §1.3: Der NAS-Job fährt den 21-Tage-Backtest, damit das
# Kriterium `at_least_21_complete_test_days_per_station` aus dem
# automatischen Lauf erfüllbar ist (bei 7 Tagen war es strukturell offen).
BACKTEST_DAYS = 21


def refresh(settings: Settings, now=None, progress=None):
    # Heavy numerical dependencies are confined to this worker, not the live API.
    import pandas as pd
    import export_influx as influx
    from engine.bootstrap import bootstrap, write_csv
    from engine.config import Config
    from engine.data import load_observations, prepare_series
    from engine.models import SCHEMA_VERSION
    from engine.selection import SelectionConfig, compute_all as compute_selection
    from engine.storage import write_json
    from polling_plan import collector_lock
    from .history import prepare_archive
    from .model_jobs import HORIZON_COLUMNS, resolve_workers, run_tasks

    metas, error = metadata(settings)
    if error or not settings.influx_env.is_file():
        if progress:
            progress.finish("waiting", error or "influx_not_configured")
        return {"state": "waiting", "error_code": error or "influx_not_configured"}
    # Konzept §3.2: gepoolter Feiertags-Dummy je Bundesland; ohne
    # TANKAPP_CITY_SUBDIVS trägt er null (keine erfundenen Effekte).
    cfg = Config(city_subdivs=dict(getattr(settings, "city_subdivs", {})))
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
    if progress:
        progress.phase(
            "export",
            total=len(settings.model_fuels),
            message=f"{len(metas)} Stationen, "
            f"{len(settings.model_fuels)} Kraftstoff(e)",
        )
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
            if progress:
                progress.step(label=f"{fuel}: {summary.get('rows', '?')} Zeilen")
            live_paths.append(path)
        if progress:
            progress.phase("coverage", message="Live-Abdeckung (90-Tage-Regel)")
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
            if progress:
                progress.phase("archive", message=f"Archiv {start} bis {local_day}")
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
            if progress:
                progress.note(
                    f"Archiv: {archive_quality.get('events', '?')} Ereignisse, "
                    f"{archive_quality.get('missing_days', '?')} fehlende Tage"
                )
        forecasts, models, policies, failures = [], [], [], []
        selections = {}
        # Der Fit-Block ist der lange Teil: je Station laufen vier Aufgaben
        # (24 h, +3 d, +7 d, Backtest) — der Fortschritt zählt sie einzeln,
        # damit „Schritt x/y“ die Wartezeit erklärt.
        fit_total = len(metas) * len(settings.model_fuels) * TASKS_PER_STATION
        fit_done = 0
        # Prozessparallel (Konzept §9.4): 0/None = automatisch (CPU-Kerne).
        workers = resolve_workers(getattr(settings, "model_workers", 0) or None)
        if workers > 1:
            print(f"models: {workers} Prozesse für Fit/Prognose/Backtest", flush=True)
        for fuel in settings.model_fuels:
            if progress:
                progress.phase("bootstrap", message=f"Bootstrap {fuel}")
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
            # Datenstand je Station für die Prognose: aus dem Bootstrap dieses
            # Kraftstoffs (identisches Stationslabel in einem anderen Fuel darf
            # nicht dazwischenfunken) und einmal nachgeschlagen statt je Station
            # linear gesucht.
            policy_by_identity = {
                (row["city"], row["station_id"]): row for row in policy["stations"]
            }
            path = settings.runtime / "training" / f"{fuel}.csv.gz"
            write_csv(path, data)
            # Reload preserves missing historical status; never serialize assumed open as evidence.
            normalized, _ = load_observations([path], cfg, fuel, ids)
            series = {
                (item.city, item.station_id): item
                for item in prepare_series(normalized, cfg)
            }
            if progress:
                progress.phase("fit", total=fit_total, message=f"Fit + Backtest {fuel}")
            # --- Fit, Horizonte und Backtest (prozessparallel, §9.4) ---
            # Je Station sind 24 h, +3 d, +7 d und der 7-Tage-Backtest
            # voneinander unabhängig; seriell bliebe ein Kern ungenutzt.
            series_map = {
                identity: series[identity] for identity in metas if identity in series
            }
            # Fehler je Station sammeln und in Stationsreihenfolge anhängen —
            # die Reihenfolge der Veröffentlichung soll stabil bleiben.
            station_failures: dict[tuple, dict] = {}
            labels = {
                identity: f"{identity[0]} – {metas[identity].get('name', identity[1])}"
                for identity in metas
            }
            for identity in metas:
                if identity in series_map:
                    continue
                fit_done += 1
                if progress:
                    progress.step(
                        fit_done, label=f"{labels[identity]}: fehlende Historie"
                    )
                print(
                    f"models: {labels[identity]} ({fuel}): FEHLER missing_history",
                    flush=True,
                )
                station_failures[identity] = {
                    "city": identity[0],
                    "station_id": identity[1],
                    "fuel": fuel,
                    "reason": "missing_history",
                }

            def note(result):
                """Fortschritt je fertiger Teilaufgabe (auch im Fehlerfall)."""
                nonlocal fit_done
                fit_done += 1
                if progress:
                    suffix = "" if result.get("ok") else " – Fehler"
                    progress.step(
                        fit_done,
                        label=f"{labels.get(result['key'], '')} · {result['kind']}"
                        f"{result.get('hours') or ''}{suffix}",
                    )

            # Phase A: Fit + 24-h-Prognose — liefert die Modelle.
            first = run_tasks(
                [("fit", identity, 24) for identity in series_map],
                series_map,
                cfg,
                origin,
                workers,
                on_done=note,
            )
            fitted = {}
            for result in first:
                if result.get("ok"):
                    fitted[result["key"]] = result
                    continue
                detail = result.get("detail", "")
                print(
                    f"models: {labels[result['key']]} ({fuel}): FEHLER "
                    f"unzureichende Trainingsdaten – {detail}",
                    flush=True,
                )
                station_failures[result["key"]] = {
                    **series_map[result["key"]].identity(),
                    "reason": "insufficient_or_invalid_training_data",
                    "detail": detail,
                }

            # Phase B: erweiterte Horizonte + Backtest je Station.
            following = []
            for identity in fitted:
                following.extend(
                    [
                        ("wide", identity, 72),
                        ("wide", identity, 168),
                        ("backtest", identity, BACKTEST_DAYS),
                    ]
                )
            second = run_tasks(
                following, series_map, cfg, origin, workers, on_done=note
            )
            horizons_by_station: dict[tuple, dict[int, list]] = {}
            draws_by_station: dict[tuple, dict[int, dict]] = {}
            backtests: dict[tuple, dict] = {}
            broken = set()
            for result in second:
                identity = result["key"]
                if not result.get("ok"):
                    broken.add(identity)
                    station_failures[identity] = {
                        **series_map[identity].identity(),
                        "reason": "horizon_or_backtest_failed",
                        "detail": result.get("detail", ""),
                    }
                    continue
                if result["kind"] == "wide":
                    # Nur Quantile + Zeitstempel: Diagnostikspalten blieben Ballast.
                    horizons_by_station.setdefault(identity, {})[result["hours"]] = [
                        {key: row[key] for key in HORIZON_COLUMNS}
                        for row in result["points"]
                    ]
                    draws_by_station.setdefault(identity, {})[result["hours"]] = (
                        result.get("draws") or {}
                    )
                else:
                    backtests[identity] = result

            for position, identity in enumerate(metas, start=1):
                if identity not in fitted or identity in broken:
                    continue
                item = series_map[identity]
                model = fitted[identity]["model"]
                report = backtests.get(identity) or {}
                models.append(model)
                last = model.get("last_observation")
                age = (
                    (origin - pd.Timestamp(last)).total_seconds() / 60 if last else None
                )
                wide = horizons_by_station.get(identity, {})
                draws_wide = draws_by_station.get(identity, {})
                forecasts.append(
                    {
                        **item.identity(),
                        "origin": origin.isoformat(),
                        "last_observation": last,
                        "data_age_minutes_at_origin": age,
                        "stale_data_at_origin": age is None or age > cfg.ffill_minutes,
                        "points": fitted[identity]["points"],
                        "points_3d": wide.get(72, []),
                        "points_7d": wide.get(168, []),
                        # P-Seite (Konzept §4.1–4.3): Fenster-Minima + Nowcast-Draws
                        # je Horizont; daraus rechnet der Decision Layer
                        # P_besser/P_lohnt/F3-Fenster-P (app/pside.py).
                        "draws_24h": fitted[identity].get("draws") or {},
                        "draws_7d": draws_wide.get(168) or {},
                        "metrics": report.get("metrics"),
                        "backtest_days": BACKTEST_DAYS,
                        "train_days": cfg.train_days,
                        # Rolling-PICP 7 d je Station (Konzept §3.3.3):
                        # Konfidenz-Badge + letzte 7 Testtage; „current“ ist
                        # die Zahl fürs Güte-Gate (§4.4) in /v1/decide.
                        "rolling_picp_7d": report.get("rolling_picp_7d"),
                        # Mehrtage-Horizonte +3 d/+7 d (Konzept §3.4):
                        # MASE/PICP der Fan-Chart-Horizonte, ehrlich
                        # ausgewiesen (kein M3-Kriterium).
                        "horizons": report.get("horizons") or {},
                        "decision_rows": [
                            row
                            for row in report.get("decision_rows", [])
                            if (row.get("city"), row.get("station_id")) == identity
                        ],
                        "decision_hour": report.get("decision_hour", 8),
                        "operational_replay": False,
                        "data_policy": policy_by_identity.get(identity),
                        "calibrated": False,
                        "decision_ready": False,
                        "retained_previous": False,
                    }
                )
                print(
                    f"models: [{position}/{len(metas)}] {labels[identity]} "
                    f"({fuel}): ok",
                    flush=True,
                )
            failures.extend(
                station_failures[identity]
                for identity in metas
                if identity in station_failures
            )

            # --- Selektion (δ̂, KI, AV, billigste Stunde) je Kraftstoff ---
            try:
                if progress:
                    progress.phase("selection", message=f"δ̂-Ranking {fuel}")
                # metas gruppiert nach Stadt für die Selektion
                metas_by_city: dict[str, dict[str, dict]] = {}
                for (city, uid), meta in metas.items():
                    metas_by_city.setdefault(city, {})[uid] = meta
                # n_boot=2000 fest (Davison/Hinkley): bei m=11 Stationen
                # ist B=200 mathematisch unter α=0,05 nach BH unmöglich.
                sel_cfg = SelectionConfig(fuel=fuel.upper(), n_boot=2000)
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
            if progress:
                progress.finish(
                    "waiting", "keine Station fittbar (insufficient_history)"
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
        if progress:
            progress.phase(
                "publish",
                message=f"{len(forecasts)} Prognosen, {len(failures)} Fehler",
            )
        print("models: publiziere ...", flush=True)
        model_name = "models-" + uuid.uuid4().hex + ".json"
        # Das Bundle-Schema muss der von ``engine forecast`` geprüften
        # Modellversion entsprechen.  Nach dem Schema-2-Sprung darf hier kein
        # historisch fest verdrahtetes ``1`` stehen, sonst ist das soeben vom
        # NAS erzeugte Artefakt für die CLI sofort ungültig.
        write_json(
            output / model_name,
            {"schema_version": SCHEMA_VERSION, "models": models},
        )
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
