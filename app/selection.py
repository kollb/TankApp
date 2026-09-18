"""Selektions-Artefakte für das NAS — Meine Stationen mit δ̂.

Liest publizierte Artefakte (runtime/selection/current.json) und baut sie
bei Bedarf aus dem Trainingsbestand (runtime/training/*.csv.gz).

Berechnet je Stadt:
  δ̂ (Median relativ zum LOO-Stadtmedian),
  Bootstrap-KI (Tages-Block-Bootstrap),
  q-Wert (Benjamini-Hochberg),
  AV-Score (P(Top-3|Stunde) gewichtet),
  billigste Stunde (harmonische Regression),
  Volatilität σ und Rang-Std.

Quelle: training/*.csv.gz aus InfluxDB + Archiv (echte Daten), keine Demo.
"""

from __future__ import annotations

import datetime as dt

from .data import read_json

UTC = dt.timezone.utc


def read_selection(settings):
    raw = read_json(settings.runtime / "selection/current.json", None)
    if isinstance(raw, dict) and raw:
        if "by_fuel" in raw:
            # Alle gerankten Stationen zählen (top_global ist auf 10/Fuel gekappt).
            count = 0
            for fuel_data in raw["by_fuel"].values():
                if isinstance(fuel_data, dict):
                    cities = fuel_data.get("cities") or []
                    if cities:
                        count += sum(len(c.get("stations", [])) for c in cities)
                    else:
                        count += len(fuel_data.get("top_global", []))
            raw["count"] = count
        return raw

    fuels = ["e10", "e5", "diesel"]
    by_fuel = {}
    all_stations = []
    cities_set = set()
    generated = None
    for fuel in fuels:
        data = read_json(settings.runtime / f"selection/{fuel}.json", None)
        if isinstance(data, dict) and data.get("cities"):
            by_fuel[fuel] = data
            if not generated:
                generated = data.get("generated_at")
            for city in data["cities"]:
                cities_set.add(city.get("city"))
                all_stations.extend(city.get("stations", []))

    if by_fuel:
        return {
            "generated_at": generated,
            "fuels": list(by_fuel.keys()),
            "by_fuel": by_fuel,
            "count": len(all_stations),
            "cities": list(cities_set),
            "stations": all_stations,
            "error_code": None,
        }

    return {
        "error_code": "selection_not_available",
        "stations": [],
        "count": 0,
        "cities": [],
    }


def build_selection(settings, fuels=None, config=None, n_boot=None, progress=None):
    """Baut Selektions-Artefakt aus Trainingsbestand (standalone Job).

    ``config`` ist die Engine-Konfiguration (``engine.config.Config``); ohne
    Angabe wird sie aus den Settings gebaut (``app.config.engine_config``).
    Alle gemeinsamen Knöpfe — Ziehungen, Raster, Lückenfüllung, Polling-
    Fenster, Zeitzone — übernimmt ``SelectionConfig.from_engine_config``
    (O36): Früher stand hier ``Config()`` und der Aufrufer reichte die
    Ziehungen als Zahl (B = 2000), eine Änderung von ``bootstrap_samples``
    wirkte deshalb nur in den Modellen, nicht in der Selektion.

    ``n_boot`` ist ein bewusstes Override für Werkzeuge (Demo-Stapel:
    B = 400, damit er in Sekunden steht) und gilt unverändert; die Abweichung
    wird im Fortschritts-Protokoll benannt.

    ``progress`` ist das optionale Fortschritts-Protokoll (app/progress.py),
    damit der System-Status der GUI zeigt, welcher Kraftstoff gerade läuft.

    B21: total war vorher len(fuels) bei 2 Schritten je Fuel (laden + ranking)
    → Fortschritt 2/1. Jetzt len(fuels)*2, damit „0/2, 1/2, 2/2“ statt „2/1“.
    """
    if fuels is None:
        fuels = ["e10"]
    if progress:
        # 2 Schritte je Fuel: Trainingsdaten laden + δ̂-Ranking
        progress.phase("selection", total=max(1, len(fuels) * 2), message="δ̂-Ranking")

    try:
        from engine.data import load_observations
        from engine.selection import (
            SelectionConfig,
            bootstrap_floor_note,
            compute_all,
        )
        from .config import engine_config
        from .data import metadata
        from .feedback import compute_wallet_stats, load_store
        from .profiles import active_liters
        from .profiles import load_store as load_profile_store

        cfg_engine = config if config is not None else engine_config(settings)

        metas, problem = metadata(settings)
        if problem:
            return {
                "error_code": problem,
                "stations": [],
                "count": 0,
                "generated_at": dt.datetime.now(UTC).isoformat(),
            }

        metas_by_city = {}
        for (city, uid), meta in metas.items():
            metas_by_city.setdefault(city, {})[uid] = meta

        ids = {uid for _, uid in metas}
        by_fuel = {}
        all_flat = []

        for fuel in fuels:
            # Training data path
            train_path = settings.runtime / "training" / f"{fuel}.csv.gz"
            if not train_path.is_file():
                train_path = settings.runtime / "exports" / f"influx_{fuel}.csv.gz"
            if not train_path.is_file():
                continue

            try:
                if progress:
                    progress.step(label=f"{fuel}: Trainingsdaten laden")
                obs, _ = load_observations([train_path], cfg_engine, fuel, ids)
                if obs.empty:
                    if progress:
                        progress.step(label=f"{fuel}: keine Daten")
                    continue
                # O36: eine Quelle — B21 (Coverage-Gate im Polling-Fenster)
                # und A12 (dead_after_days) sind als Override dabei, alles
                # Gemeinsame kommt aus der Engine-Konfiguration.
                overrides = {"fuel": fuel.upper()}
                if n_boot is not None:
                    overrides["n_boot"] = int(n_boot)
                # O2: Selection receives the very same 7×24 profile as
                # decide. No receipts uses its named default, never a second
                # commuter literal hidden in this job.
                wallet = compute_wallet_stats(load_store(settings))
                overrides["user_time_weights"] = wallet.get("wh_weekday")
                # O21: dieselbe Tankmenge wie im Score und in der GUI.
                # `saving_per_fill_eur` wurde bisher für feste 40 L publiziert,
                # egal was im Profil steht (10–100 L sind erlaubt).
                overrides["tank_volume"] = active_liters(load_profile_store(settings))[
                    0
                ]
                overrides["time_profile_source"] = wallet.get(
                    "wh_profile_source", "default"
                )
                sel_cfg = SelectionConfig.from_engine_config(
                    cfg_engine,
                    dead_after_days=getattr(settings, "dead_after_days", 7),
                    **overrides,
                )
                note = bootstrap_floor_note(
                    cfg_engine.bootstrap_samples, sel_cfg.n_boot
                )
                if note:
                    if progress:
                        progress.step(label=note)
                    else:
                        print(f"selection: {note}", flush=True)
                result = compute_all(obs, sel_cfg, metas_by_city)
                # B21-Diagnose: Warum 0 Stationen? Coverage, <4 Stationen je Stadt, etc.
                top_n = len(result.get("top_global", []))
                city_n = sum(
                    len(c.get("stations", [])) for c in result.get("cities", [])
                )
                if top_n == 0 and city_n == 0:
                    # Kein belastbares Ranking — mögliche Gründe in result
                    # (excluded_count, station_count) sind im Artefakt enthalten.
                    pass
                by_fuel[fuel] = result
                all_flat.extend(result.get("top_global", []))
                if progress:
                    progress.step(label=f"{fuel}: {top_n} Stationen")
            except Exception as exc:
                if progress:
                    # Kurz die Ursache zeigen (ohne Pfade), damit „Fehler“
                    # im Log nicht das Ende der Diagnose ist.
                    try:
                        from .errors import public_detail

                        detail = public_detail(exc, max_len=120)
                    except Exception:
                        detail = type(exc).__name__
                    progress.step(label=f"{fuel}: Fehler — {detail}")
                continue

        return {
            "generated_at": dt.datetime.now(UTC).isoformat(),
            "fuels": list(by_fuel.keys()),
            "by_fuel": by_fuel,
            "count": len(all_flat),
            "stations": all_flat,
            "cities": list(metas_by_city.keys()),
            "error_code": None if by_fuel else "selection_not_available",
        }

    except Exception:
        return {
            "error_code": "selection_failed",
            "stations": [],
            "count": 0,
            "generated_at": dt.datetime.now(UTC).isoformat(),
        }
