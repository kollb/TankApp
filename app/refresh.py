"""One model-refresh operation on NAS or optional PC; only publish completed results."""

import datetime as dt
import json
import uuid

from .config import Settings, engine_config
from .data import metadata, publication, write_split_publication
from .worker import JobAborted


# Aufgaben je Station: Fit+24 h, +3 d, +7 d, Backtest (siehe app/model_jobs.py).
TASKS_PER_STATION = 4

# Prüfstand §1.3: Der NAS-Job fährt den 21-Tage-Backtest, damit das
# Kriterium `at_least_21_complete_test_days_per_station` aus dem
# automatischen Lauf erfüllbar ist (bei 7 Tagen war es strukturell offen).
BACKTEST_DAYS = 21
# B2: Nach einer deklarierten Niveau-Kante muss ein vollständiges neues
# Trainingsfenster entstehen. Die inklusive Frist entspricht für die bekannte
# Kante 01.10. dem Termin-Gate 01.10.–15.11. aus dem Befund.
CALIBRATION_REGIME_BLACKOUT_DAYS = 45


def calibration_regime_blackout(origin, cfg, fuel: str) -> bool:
    """Blockiert die Anwendung einer alten PIT-Kurve im Regime-Übergang."""
    from engine.regimes import regime_breaks_utc

    current_day = origin.tz_convert(cfg.timezone).date()
    for regime in regime_breaks_utc(cfg, fuel):
        break_day = regime["at"].tz_convert(cfg.timezone).date()
        if (
            break_day
            <= current_day
            <= break_day + dt.timedelta(days=CALIBRATION_REGIME_BLACKOUT_DAYS)
        ):
            return True
    return False


def _mb(size: int) -> str:
    """Byte als MB in de-DE — die Zeile landet im Job-Log der GUI."""
    return f"{size / 1_000_000:.1f} MB".replace(".", ",")


def _report_publication_size(
    size: int,
    progress=None,
    *,
    largest_file_bytes: int | None = None,
    file_count: int | None = None,
) -> str:
    """O22: Die Größe der Veröffentlichung ins Job-Log — laut statt still.

    Der Alarm selbst kommt aus ``/api/v1/health`` (``app/alarms.py``): Dort ist
    er auch für eine Datei sichtbar, die ein älterer Lauf geschrieben hat, und
    er erreicht die Zustellung (``app/notify.py``). Das Log nennt die Zahl
    trotzdem — wer dem Lauf zuschaut, soll die Klippe kommen sehen, bevor
    ``read_json`` die Datei nicht mehr liest.

    Seit O22(d) ist die Veröffentlichung aufgeteilt (Index + eine Datei je
    Station); ``largest_file_bytes`` kennzeichnet diesen Modus, und die Klippe
    gilt der **einzelnen** Datei, nicht der Summe.

    Rückgabe ist die Log-Zeile (Tests prüfen sie, ohne ``capsys`` zu brauchen).
    """
    from .data import PUBLICATION_BUDGET_BYTES, READ_JSON_MAX_BYTES

    if largest_file_bytes is not None:
        if largest_file_bytes > READ_JSON_MAX_BYTES:
            text = (
                f"Veröffentlichung {_mb(size)} in {file_count} Stations-Dateien "
                f"plus Index — die größte Datei ({_mb(largest_file_bytes)}) liegt "
                f"über dem Leselimit {_mb(READ_JSON_MAX_BYTES)}: Die App kann "
                "sie nicht lesen und zeigt für diese Station „keine Prognose“."
            )
            sticky = True
        else:
            text = (
                f"Veröffentlichung {_mb(size)} gesamt: {file_count} "
                f"Stations-Dateien plus Index, größte Datei "
                f"{_mb(largest_file_bytes)} (Leselimit "
                f"{_mb(READ_JSON_MAX_BYTES)} je Datei)."
            )
            sticky = False
    elif size > READ_JSON_MAX_BYTES:
        text = (
            f"Veröffentlichung {_mb(size)} — über dem Leselimit "
            f"{_mb(READ_JSON_MAX_BYTES)}: Die App kann sie nicht lesen und "
            "zeigt überall „keine Prognose“."
        )
        sticky = True
    elif size > PUBLICATION_BUDGET_BYTES:
        text = (
            f"Veröffentlichung {_mb(size)} — über dem Budget "
            f"{_mb(PUBLICATION_BUDGET_BYTES)}, Leselimit {_mb(READ_JSON_MAX_BYTES)}."
        )
        sticky = True
    else:
        text = f"Veröffentlichung {_mb(size)} (Budget {_mb(PUBLICATION_BUDGET_BYTES)})."
        sticky = False
    print(f"models: {text}", flush=True)
    if progress:
        progress.note(text, sticky=sticky)
    return text


def refresh(settings: Settings, now=None, progress=None):
    # Heavy numerical dependencies are confined to this worker, not the live API.
    import pandas as pd
    import export_influx as influx
    from engine.bootstrap import bootstrap, write_csv
    from engine.data import load_observations, prepare_series
    from engine.models import SCHEMA_VERSION, law_since_utc
    from engine.calibration import calibration_envelope
    from engine.selection import (
        SelectionConfig,
        bootstrap_floor_note,
        compute_all as compute_selection,
    )
    from engine.storage import write_json
    from polling_plan import collector_lock
    from .selection import publish_selection
    from .gapfill import fill_gaps
    from .history import prepare_archive
    from .model_jobs import ModelTaskPool, resolve_workers

    # B2 lernt nie auf der eben zu veröffentlichenden Zukunft: Die Fit-Aufgaben
    # erhalten ausschließlich den im *vorigen* Backtest gespeicherten,
    # zeitlich getrennt abgenommenen Kandidaten. Der aktuelle Backtest erzeugt
    # wiederum erst die Kandidatur für den nächsten Modell-Lauf.
    prior_calibration_candidates = {
        (
            row.get("city"),
            row.get("station_id"),
            str(row.get("fuel") or "").lower(),
        ): row.get("calibration_candidate")
        for row in publication(settings).get("forecasts", [])
        if isinstance(row, dict)
    }

    metas, error = metadata(settings)
    if error or not settings.influx_env.is_file():
        if progress:
            progress.finish("waiting", error or "influx_not_configured")
        return {"state": "waiting", "error_code": error or "influx_not_configured"}
    # O36: eine Quelle — dieselbe Factory nutzt der standalone Selektions-Job
    # (Konzept §3.2 Feiertags-Dummy, §5.5 Schicht-A-Anker aus den Settings).
    cfg = engine_config(settings)
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
    # B17: Tages-Cache des 21-Tage-Backtests (app/backtest_cache.py).
    # TANKAPP_BACKTEST_CACHE=0 rechnet jeden Lauf neu (Gegenprobe).
    backtest_cache_dir = (
        output / "backtest-cache" if getattr(settings, "backtest_cache", True) else None
    )
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
        # Einmal geladen, zweimal genutzt: Die Live-Frames prüfen hier die
        # Abdeckung und liefern danach die Lückenfenster für die
        # Archiv-Füllung (kein doppelter Export-Parse).
        live_by_fuel = {}
        for fuel in settings.model_fuels:
            live, _ = load_observations(live_paths, cfg, fuel, ids)
            live_by_fuel[fuel] = live
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
        # Polling-Lücken (z. B. gestern 12–13 Uhr) automatisch aus dem
        # Tankerkönig-Archiv schließen — echte Ereignisse, nur vergangene
        # Tage, nur Lückenfenster; Live behält immer Vorrang. Läuft auch bei
        # all_live: Eine Stundenlücke bricht die 90-Tage-Regel nicht, soll
        # aber trotzdem nicht als Loch ins Training.
        gapfill_paths, gapfill_quality = [], {}
        if progress:
            progress.phase("gapfill", message="Polling-Lücken aus Archiv schließen")
        print("models: suche Polling-Lücken für Archiv-Füllung ...", flush=True)
        try:
            gapfill_paths, gapfill_quality = fill_gaps(
                settings,
                cfg,
                metas,
                list(settings.model_fuels),
                live_by_fuel,
                origin,
                cadence,
                progress=progress,
            )
        except JobAborted:
            # S4: Abbruch läuft durch — kein „Lückenfüllung übersprungen“,
            # das den Lauf nach SIGTERM weiterlaufen lassen würde.
            raise
        except Exception as exc:
            # Die Füllung ist Kür: Scheitert sie, läuft das Training mit den
            # Lücken weiter statt ganz auszufallen — ehrlich vermerkt.
            print(f"models: Lückenfüllung übersprungen ({exc})", flush=True)
            gapfill_quality = {"skipped": True, "reason": str(exc)[:200]}
            if progress:
                progress.note("Lückenfüllung übersprungen — Training mit Lücken")
        forecasts, models, policies, failures = [], [], [], []
        selections = {}
        # B30: Messung zur 12-Uhr-Bodenkante. Der Befund verlangt, vor dem
        # Schnitt zu zählen, wie viel vorgesetzliches Muster im Bestand
        # steckt — sonst ist „die Kante ändert heute nichts" eine Behauptung.
        law_floor_stamp = law_since_utc(cfg)
        law_quality = {
            "law_floor": law_floor_stamp.isoformat(),
            "points_total": 0,
            "points_before_law": 0,
            "gapfill_events_before_law": int(
                gapfill_quality.get("events_before_law", 0) or 0
            ),
            "by_fuel": {},
        }
        # Der Fit-Block ist der lange Teil: je Station laufen vier Aufgaben
        # (24 h, +3 d, +7 d, Backtest) — der Fortschritt zählt sie einzeln,
        # damit „Schritt x/y“ die Wartezeit erklärt.
        fit_total = len(metas) * len(settings.model_fuels) * TASKS_PER_STATION
        fit_done = 0
        # Prozessparallel (Konzept §9.4): 0/None = automatisch (CPU-Kerne).
        workers = resolve_workers(getattr(settings, "model_workers", 0) or None)
        if workers > 1:
            print(f"models: {workers} Prozesse für Fit/Prognose/Backtest", flush=True)
        for fuel_index, fuel in enumerate(settings.model_fuels):
            if progress:
                progress.phase("bootstrap", message=f"Bootstrap {fuel}")
            print(
                f"models: Training {fuel}: Bootstrap + Fit "
                f"für {len(metas)} Stationen ...",
                flush=True,
            )
            observations, _ = load_observations(
                history_paths + gapfill_paths + live_paths, cfg, fuel, ids
            )
            # B30: Vor-Gesetz-Anteil dieses Trainingsbestands.
            if not observations.empty:
                before_law = int((observations["timestamp"] < law_floor_stamp).sum())
            else:
                before_law = 0
            law_quality["points_total"] += int(len(observations))
            law_quality["points_before_law"] += before_law
            law_quality["by_fuel"][fuel] = {
                "points": int(len(observations)),
                "points_before_law": before_law,
            }
            print(
                f"models: {fuel}: 12-Uhr-Bodenkante "
                f"{law_floor_stamp.date()}: {before_law} von "
                f"{len(observations)} Beobachtungen davor",
                flush=True,
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
                # Der Zähler läuft über alle Kraftstoffe hinweg. Beim erneuten
                # Eintritt übernimmt ``completed`` den erreichten Stand; so
                # bleibt auch der Prozentwert monoton (B20/6).
                progress.phase(
                    "fit",
                    total=fit_total,
                    message=f"Fit + Backtest {fuel}",
                    completed=fit_done,
                )
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
                if progress:
                    # 0.25.1: Der Grund stand bisher nur auf Container-stdout,
                    # nicht im Job-Log — dort sucht man ihn aber zuerst.
                    progress.note(
                        f"{labels[identity]}: keine Historie — kein Fit, "
                        f"{TASKS_PER_STATION - 1} Folgetasks entfallen",
                        sticky=False,
                    )

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

            # B2: Kandidaten sind an Station, Kraftstoff, Modellkern und
            # Shared-Draw-Modus gebunden. Eine andere Verteilung bekommt nie
            # still dieselbe Kurve (siehe engine.calibration).
            calibration_by_identity = {
                identity: calibration_envelope(
                    prior_calibration_candidates.get((identity[0], identity[1], fuel)),
                    enabled=bool(getattr(settings, "calibration", True)),
                    model_kind=getattr(settings, "model_kind", "profile_ar2"),
                    shared_draws=bool(getattr(settings, "shared_draws", True)),
                    activation_blocked=calibration_regime_blackout(origin, cfg, fuel),
                )
                for identity in series_map
            }

            # B19: derselbe explizite fork-Pool bleibt für Phase A und B
            # stehen; series_map wird genau einmal als schlanke Worker-Sicht
            # initialisiert. Das spart den zweiten Pool-Start je Kraftstoff.
            with ModelTaskPool(
                series_map,
                cfg,
                origin,
                workers,
                cache_dir=backtest_cache_dir,
                # A11: gemeinsame Ziehung (§4.2); TANKAPP_SHARED_DRAWS=0
                # schaltet für Gegenmessungen zurück auf unabhängig.
                shared_draws=getattr(settings, "shared_draws", True),
                # A10: Ensemble aus Haupt- und Zweitmodell (§3.2 M3);
                # TANKAPP_MODEL_KIND stellt auf ein Einzelmodell um.
                model_kind=getattr(settings, "model_kind", "profile_ar2"),
                day_pair=getattr(settings, "day_pair", True),
            ) as task_pool:
                # Phase A: Fit + 24-h-Prognose — liefert die Modelle.
                first = task_pool.run(
                    [
                        ("fit", identity, 24, calibration_by_identity[identity])
                        for identity in series_map
                    ],
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
                    if progress:
                        # 0.25.1: Dieselbe Ursache ins Job-Log — ohne sie bleibt
                        # offen, ob die Station je fitbar wird oder dauerhaft tot
                        # ist (A12). Nicht klebend: sie gilt nur für diese Station.
                        progress.note(
                            f"{labels[result['key']]} · fit24 – FEHLER: "
                            f"{(detail or 'unbekannte Ursache')[:200]}",
                            sticky=False,
                        )

                # 0.25.1: Jede Station ohne Modell kostet ihre drei Folgeaufgaben
                # (+3 d, +7 d, Backtest). Die Gesamtzahl wird nachgezogen, sonst
                # endet der Lauf bei „77/80“ — das sieht aus wie verschluckte
                # Aufgaben. Noch folgende Kraftstoffe bleiben geschätzt.
                dropped = len(metas) - len(fitted)
                if dropped:
                    fit_total = (
                        fit_done
                        + (TASKS_PER_STATION - 1) * len(fitted)
                        + (len(settings.model_fuels) - fuel_index - 1)
                        * len(metas)
                        * TASKS_PER_STATION
                    )
                    if progress:
                        progress.note(
                            f"{dropped} Station"
                            f"{'en' if dropped != 1 else ''} ohne Modell — "
                            f"{dropped * (TASKS_PER_STATION - 1)} Folgetasks entfallen",
                            sticky=False,
                        )
                        progress.retotal(fit_total)

                # Phase B: erweiterte Horizonte + Backtest je Station.
                following = []
                for identity in fitted:
                    following.extend(
                        [
                            ("wide", identity, 72, calibration_by_identity[identity]),
                            ("wide", identity, 168, calibration_by_identity[identity]),
                            ("backtest", identity, BACKTEST_DAYS),
                        ]
                    )
                second = task_pool.run(
                    following,
                    on_done=note,
                )
            cached_hits = sum(
                1
                for result in second
                if result.get("kind") == "backtest" and result.get("backtest_cached")
            )
            if backtest_cache_dir is not None:
                print(
                    f"models: Backtest {fuel}: {cached_hits} aus Tages-Cache, "
                    f"{len(fitted) - cached_hits} neu gerechnet",
                    flush=True,
                )
                if progress:
                    progress.note(
                        f"Backtest: {cached_hits} aus Tages-Cache, "
                        f"{len(fitted) - cached_hits} neu gerechnet"
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
                    if progress:
                        # 0.25.1: Ursache auch hier ins Job-Log (bisher nur
                        # im Artefakt unter ``failures``).
                        progress.note(
                            f"{labels[identity]} · {result['kind']}"
                            f"{result.get('hours') or ''} – FEHLER: "
                            f"{(result.get('detail') or 'unbekannte Ursache')[:200]}",
                            sticky=False,
                        )
                    continue
                if result["kind"] == "wide":
                    # B20/4: Der Worker schickt bereits ausschließlich die
                    # veröffentlichten Quantile + Zeitstempel zurück.
                    horizons_by_station.setdefault(identity, {})[result["hours"]] = (
                        result["points"]
                    )
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
                        # H5: DST-Tage des Prüfzeitraums (ausgewiesen, nicht
                        # ausgeschlossen) — die Werkstatt nennt sie.
                        "dst": report.get("dst"),
                        "backtest_days": BACKTEST_DAYS,
                        # B17: Herkunft und Alter des Backtests ehrlich
                        # ausweisen — der Bericht gilt für den lokalen
                        # Endtag, nicht für den Zeitpunkt dieses Laufs.
                        "backtest_cached": bool(report.get("backtest_cached", False)),
                        "backtest_computed_at": report.get("backtest_computed_at"),
                        "train_days": cfg.train_days,
                        # C11: Datenreichweite des Fits — worauf diese
                        # Prognose beruht. Der Fit kennt die Werte längst
                        # (engine/models.py), sie standen bisher nur im
                        # Modell-Artefakt, nicht in der Publikation; ohne sie
                        # kann die GUI nicht sagen, wie breit die Grundlage ist.
                        "range_from": model.get("training_start"),
                        "range_to": model.get("last_observation"),
                        "n_points": model.get("training_points"),
                        "n_days": model.get("training_days"),
                        # Rolling-PICP 7 d je Station (Konzept §3.3.3):
                        # Konfidenz-Badge + letzte 7 Testtage; „current“ ist
                        # die Zahl fürs Güte-Gate (§4.4) in /v1/decide.
                        # A10: Zweitmodell und Ensemble — Gewichte, MASE
                        # und Bewertungsfenster kommen aus dem Fit, die GUI
                        # zeigt sie in der Werkstatt nur an.
                        "ensemble": model.get("ensemble"),
                        "model_kind": getattr(settings, "model_kind", "profile_ar2"),
                        "day_pair": bool(getattr(settings, "day_pair", True)),
                        # B2: angewandte Kurve (falls eine frühere Abnahme
                        # sie freigegeben hat) und der neue Kandidat für den
                        # nächsten Lauf bleiben getrennt sichtbar.
                        "calibration": model.get("calibration"),
                        "calibrated": bool(model.get("calibrated", False)),
                        "calibration_candidate": report.get("calibration_candidate"),
                        # B0 (Messgrundlagen): Zähler aus Fit und Backtest —
                        # AR(2)-Stauchung/Reset, PAVA-Pools der 24-h-Prognose,
                        # PIT-Histogramme, Regime-Kanten im Prüffenster und
                        # das Punktmodell, das der Backtest tatsächlich
                        # gemessen hat (heute harmonic_ar2 — nicht das
                        # veröffentlichte ensemble; docs/planung/LUECKEN.md).
                        "ar_shrink_events": model.get("ar_shrink_events"),
                        "ar_state_reset": model.get("ar_state_reset"),
                        "ar_detail": model.get("ar_detail"),
                        "pava_pool_stats": fitted[identity].get("pava_pool_stats"),
                        "pit": report.get("pit"),
                        "regime_breaks_in_window": report.get(
                            "regime_breaks_in_window"
                        ),
                        "ar_shrink": report.get("ar_shrink"),
                        "backtest_model_kind": report.get("model_kind"),
                        "backtest_shared_draws": report.get("shared_draws"),
                        "backtest_day_pair": report.get("day_pair"),
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
                        "decision_hour": report.get("decision_hour", 12),
                        "operational_replay": False,
                        "data_policy": policy_by_identity.get(identity),
                        # M7 bleibt unabhängig von der technischen
                        # Verteilungs-Rekalibrierung die Produktfreigabe.
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
                    if fuel_index == len(settings.model_fuels) - 1:
                        progress.phase("selection", message=f"δ̂-Ranking {fuel}")
                    else:
                        # Selektion ist je Kraftstoff nötig, darf aber vor dem
                        # nächsten Kraftstoff nicht vorzeitig auf 95 % springen.
                        progress.note(f"δ̂-Ranking {fuel}", sticky=False)
                # metas gruppiert nach Stadt für die Selektion
                metas_by_city: dict[str, dict[str, dict]] = {}
                for (city, uid), meta in metas.items():
                    metas_by_city.setdefault(city, {})[uid] = meta
                # O36: Die gemeinsamen Knöpfe (Ziehungen, Raster,
                # Lückenfüllung, Polling-Fenster, Zeitzone) kommen aus der
                # Engine-Konfiguration — kein zweites Literal. B21: Das
                # Coverage-Gate misst damit im selben Fenster wie der Rest des
                # Laufs, sonst zählt die Selektion Nachtzellen als fehlende
                # Daten. A12: dead_after_days bleibt eine App-Einstellung.
                sel_cfg = SelectionConfig.from_engine_config(
                    cfg,
                    fuel=fuel.upper(),
                    dead_after_days=getattr(settings, "dead_after_days", 7),
                )
                note = bootstrap_floor_note(cfg.bootstrap_samples, sel_cfg.n_boot)
                if note:
                    print(f"models: {note}", flush=True)
                sel_result = compute_selection(normalized, sel_cfg, metas_by_city)
                selections[fuel] = sel_result
                # B21: „0 Stationen“ ohne Grund ist nicht debuggbar — Diagnose loggen
                top_n = len(sel_result.get("top_global", []))
                city_n = len(sel_result.get("cities", []))
                diag = sel_result.get("diagnostics", [])
                if top_n == 0 and diag:
                    reasons = "; ".join(d.get("reason", "") for d in diag[:3])
                    print(
                        f"models: Selektion {fuel}: 0 Stationen — Diagnose: {reasons} — "
                        f"{city_n} Städte (alle ohne Ranking)",
                        flush=True,
                    )
                else:
                    print(
                        f"models: Selektion {fuel}: {top_n} Top-Stationen, {city_n} Städte",
                        flush=True,
                    )
            except JobAborted:
                # S4: Abbruch läuft durch — „übersprungen“ wäre
                # Weiterlaufen nach SIGTERM.
                raise
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
                    "gapfill_quality": gapfill_quality,
                    "law_quality": law_quality,
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
                # O22(d): Der Lese-Pfad bringt je Zeile den Dateizeiger der
                # aufgeteilten Veröffentlichung mit — er gehört nicht in die
                # neu geschriebene Stations-Datei. A1: Auch der ``sha256``-Wert
                # gilt nur der alten Datei; die neue Generation bekommt ihren
                # eigenen Hash. Modell-Origin und Veröffentlichungs-Generation
                # sind nicht dasselbe — ``retained_previous`` trägt das.
                retained = {
                    k: v for k, v in prior.items() if k not in ("file", "sha256")
                }
                forecasts.append({**retained, "retained_previous": True})
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
        # O22: kompakt (eine Zeile, enge Separatoren) statt ``indent=2``. Die
        # Veröffentlichung ist ein Maschinen-Artefakt. Mit Einrückung lag sie bei
        # elf Stationen gemessen über dem Leselimit von ``app.data.read_json``,
        # und die App fiel lautlos in den „keine Prognose“-Zustand, während
        # dieser Job Erfolg meldete.
        #
        # O22 Maßnahme (d): **Aufgeteilte Veröffentlichung.** Mit 20 Stationen
        # wuchs selbst die kompakte, gerundete Monolith-Datei auf 13,5 MB und
        # damit über das 10-MB-Leselimit (17.09.2026) — die App zeigte überall
        # „keine Prognose“, während dieser Job Erfolg meldete. Die Klippe ist
        # eine Eigenschaft der *einzelnen* Datei; deshalb liegt jetzt jede
        # Stations-Prognose in einer eigenen Datei unter ``forecasts/``, und
        # ``current.json`` ist ein kleiner Index mit Zeigern. ``publication()``
        # (app/data.py) fügt Index + Stations-Dateien zur gewohnten Bundle-Form
        # zusammen, sodass die Leser (``/forecast``, ``/decide``,
        # ``/stats/summary``, ``/last_forecasts`` → RP2-Cache) unverändert
        # bleiben. Reihenfolge: erst die Stations-Dateien, dann der Index —
        # der Index ist der Commit-Zeiger; schlägt sein Schreiben fehl, bleibt
        # der vorige Stand gültig (``test_failed_publication_write_...``).
        # Das Index-Feld ist nur dann wahr, wenn jede veröffentlichte Station
        # eine aktive 24-h-Kurve trägt. Eine einzelne alte/retained Zeile darf
        # den Gesamtzustand nicht schöner machen als er ist.
        publication_calibrated = bool(forecasts) and all(
            bool(row.get("calibrated", False)) for row in forecasts
        )
        sizes = write_split_publication(
            output,
            origin.isoformat(),
            forecasts,
            index_extra={
                "failures": failures,
                "policies": policies,
                "archive_quality": archive_quality,
                "gapfill_quality": gapfill_quality,
                "law_quality": law_quality,
                "model_file": model_name,
                "calibrated": publication_calibrated,
                "decision_ready": False,
            },
        )
        _report_publication_size(
            sizes["total_bytes"],
            progress,
            largest_file_bytes=sizes["largest_file_bytes"],
            file_count=sizes["file_count"],
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
            # O41: eine Form für beide Schreiber — der eigenständige
            # selection-Job (app/worker.py) veröffentlicht über dieselbe
            # Funktion, keine zweite Wahrheit über das Artefakt.
            publish_selection(settings, origin.isoformat(), selections)
            print(
                f"models: Selektion publiziert nach "
                f"{settings.runtime / 'selection'}/current.json",
                flush=True,
            )
        except JobAborted:
            # S4: Abbruch läuft durch — kein Publish, kein „success“ nach
            # SIGTERM.
            raise
        except Exception as exc:
            print(
                f"models: Selektion-Publish übersprungen ({type(exc).__name__})",
                flush=True,
            )

        return {
            "state": "partial" if failures else "success",
            "error_code": "some_models_unavailable" if failures else None,
        }
