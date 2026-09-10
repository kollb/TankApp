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


def build_selection(settings, fuels=None, n_boot=2000):
    """Baut Selektions-Artefakt aus Trainingsbestand (standalone Job)."""
    if fuels is None:
        fuels = ["e10"]

    try:
        from engine.data import load_observations
        from engine.selection import SelectionConfig, compute_all
        from .data import metadata

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
                from engine.config import Config

                cfg_engine = Config()
                obs, _ = load_observations([train_path], cfg_engine, fuel, ids)
                if obs.empty:
                    continue
                sel_cfg = SelectionConfig(fuel=fuel.upper(), n_boot=n_boot)
                result = compute_all(obs, sel_cfg, metas_by_city)
                by_fuel[fuel] = result
                all_flat.extend(result.get("top_global", []))
            except Exception:
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
