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
from pathlib import Path

from .data import read_json

UTC = dt.timezone.utc

# Lesbare Kraftstoffe der Einzeldateien (Falls current.json fehlt oder ein
# Alt-Artefakt ohne by_fuel vorliegt).
_FUELS = ["e10", "e5", "diesel"]


def selection_artifact(generated_at, by_fuel, error_code=None):
    """Die eine Form des kombinierten Selektions-Artefakts (O41).

    Vorher schrieben zwei Stellen zwei Formen: ``app/refresh.py`` einen
    Index ``{"generated_at", "fuels", "by_fuel"}`` und ``app/worker.py``
    das Ergebnis von ``build_selection`` mit zusätzlichen flachen Feldern
    (``stations``, ``cities``, ``count``). Gelesen hat die flache Form
    niemand — ``LiveData.selection`` baut seine Stationen aus ``by_fuel``,
    ``app/recap.py`` ebenso. Diese Factory ist jetzt die eine Struktur,
    die **beide Schreiber** schreiben und ``read_selection`` normalisiert;
    ``error_code`` trägt den Grund, wenn kein Kraftstoff ein Ranking liefert.
    """
    return {
        "generated_at": generated_at,
        "fuels": list(by_fuel.keys()),
        "by_fuel": by_fuel,
        "error_code": error_code,
    }


def publish_selection(settings, generated_at, by_fuel) -> dict:
    """Schreibt die Selektions-Artefakte — der gemeinsame Schreiber (O41).

    Eine Datei je Kraftstoff plus die eine kombinierte ``current.json``;
    ``refresh()`` (models-Job) und der eigenständige selection-Job rufen
    dieselbe Funktion, dadurch erzeugen beide Schreiber dieselbe Form und
    denselben Dateibestand. Rückgabe ist das kombinierte Artefakt.
    """
    from engine.storage import write_json

    sel_dir = Path(settings.runtime) / "selection"
    sel_dir.mkdir(parents=True, exist_ok=True)
    for fuel_key, sel_data in by_fuel.items():
        write_json(sel_dir / f"{fuel_key}.json", sel_data)
    combined = selection_artifact(generated_at, by_fuel)
    write_json(sel_dir / "current.json", combined)
    return combined


def read_selection(settings):
    """Liest das Selektions-Artefakt und normalisiert auf die eine Form (O41).

    Drei Lese-Pfade, eine Rückgabe: ``current.json`` (beide Schreiber),
    die Einzeldateien je Kraftstoff, oder — wenn keins davon existiert —
    nur der ``error_code``. Die flachen Felder (``stations``/``cities``/
    ``count``) aus der alten Worker-Form baute vorher jeder Pfad anders;
    sie waren tot (die API zählt ihre Stationen selbst aus ``by_fuel``).
    """
    raw = read_json(settings.runtime / "selection/current.json", None)
    if isinstance(raw, dict) and isinstance(raw.get("by_fuel"), dict):
        return selection_artifact(
            raw.get("generated_at"), raw["by_fuel"], raw.get("error_code")
        )

    by_fuel = {}
    generated = None
    for fuel in _FUELS:
        data = read_json(settings.runtime / f"selection/{fuel}.json", None)
        if isinstance(data, dict) and data.get("cities"):
            by_fuel[fuel] = data
            if not generated:
                generated = data.get("generated_at")

    if by_fuel:
        return selection_artifact(generated, by_fuel, None)

    # Altbestand vor der by_fuel-Ära: flache Stationsliste, von der API über
    # ihren Kompatibilitäts-Pfad gelesen. Kein Schreiber erzeugt diese Form
    # mehr (O41 — beide Schreiber schreiben selection_artifact); gelesen
    # bleibt sie, bis der letzte Altbestand ersetzt ist — wie die Monolith-
    # Publikation bei O22(d).
    if isinstance(raw, dict) and raw.get("stations"):
        return raw

    return {"error_code": "selection_not_available"}


def build_selection(settings, fuels=None, config=None, n_boot=None, progress=None):
    """Baut Selektions-Artefakt aus Trainingsbestand (standalone Job).

    Rückgabe ist die eine Artefakt-Form (``selection_artifact``, O41) —
    dieselbe Struktur, die ``app/refresh.py`` in die kombinierte
    ``current.json`` schreibt. Nur der Fehlerfall trägt ``error_code`` mit
    einem Grund statt Daten; dann veröffentlicht der Worker nichts.

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
            # Kein Artefakt, nur Job-Grund: Der Worker veröffentlicht dazu
            # nichts (O41) — die letzte gute Publikation bleibt stehen, wie
            # refresh() bei „waiting“ auch schweigt.
            return {
                "error_code": problem,
                "generated_at": dt.datetime.now(UTC).isoformat(),
            }

        metas_by_city = {}
        for (city, uid), meta in metas.items():
            metas_by_city.setdefault(city, {})[uid] = meta

        ids = {uid for _, uid in metas}
        by_fuel = {}

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

        # O41: dieselbe Form, die refresh() für die kombinierte Datei baut —
        # eine Factory, zwei Schreiber, keine flachen Zweitfelder mehr.
        return selection_artifact(
            dt.datetime.now(UTC).isoformat(),
            by_fuel,
            None if by_fuel else "selection_not_available",
        )

    except Exception:
        return {
            "error_code": "selection_failed",
            "generated_at": dt.datetime.now(UTC).isoformat(),
        }
