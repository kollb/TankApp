"""Prozessparallele Modellberechnung (Konzept §9.4: Fits gehören aufs NAS).

Stationen und Prognosehorizonte sind voneinander unabhängig — der
Modell-Lauf ist „peinlich parallel“. Seriell nutzt er genau einen Kern,
obwohl NAS und PC mehrere haben; bei ~14 s je Station (nach der
Beschleunigung der 12-Uhr-Projektion) summiert sich das über 20 Stationen
auf mehrere Minuten.

Aufteilung (je Station ein Bündel unabhängiger Aufgaben):

- ``fit``: Fit + 24-h-Prognose (liefert das Modell für die Veröffentlichung)
- ``wide``: +3 d und +7 d Ausblick für die Werkstatt
- ``backtest``: 7-Tage-Rolling-Origin-Backtest

Die Aufgaben laufen in einem ``ProcessPoolExecutor``. Fällt der Pool aus
(eingeschränktes /dev/shm, keine Prozesse erlaubt), rechnet derselbe Code
seriell weiter — Funktionsfähigkeit geht vor Geschwindigkeit.

Determinismus: Alle Aufgaben erhalten dieselbe Config und denselben
Cutoff, der Zufallsgenerator der Engine ist seed-basiert. Die Ergebnisse
werden in Reihenfolge der Stationsliste zusammengesetzt, damit die
Veröffentlichung unabhängig von der Anzahl der Prozesse identisch ist.
"""

from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor
from typing import Any, Callable

_STATE: dict[str, Any] = {}
MAX_AUTO_WORKERS = 8

# Spalten der erweiterten Horizonte (+3 d/+7 d): Quantile + Zeitstempel.
HORIZON_COLUMNS = ("timestamp", "q025", "q10", "q50", "q90", "q975")


def resolve_workers(requested: int | None = None) -> int:
    """Anzahl Prozesse: 0/None = automatisch, mindestens 1, maximal begrenzt."""
    if requested is None:
        raw = os.environ.get("TANKAPP_MODEL_WORKERS", "")
        try:
            requested = int(str(raw).strip() or 0)
        except ValueError:
            requested = 0
    if requested and requested > 0:
        return max(1, min(64, int(requested)))
    cpus = os.cpu_count() or 1
    return max(1, min(MAX_AUTO_WORKERS, cpus))


def _init(series_map: dict, cfg, origin) -> None:
    """Wird je Prozess einmal ausgeführt (Daten via Fork/Init, nicht je Task)."""
    _STATE["series"] = series_map
    _STATE["cfg"] = cfg
    _STATE["origin"] = origin


def _records(frame) -> list[dict[str, Any]]:
    frame = frame.copy()
    frame["timestamp"] = frame.index.map(lambda stamp: stamp.isoformat())
    return frame.to_dict(orient="records")


def _draws(index, paths, cfg) -> dict[str, Any]:
    """Kompakte Draw-Veröffentlichung für den Decision Layer (Konzept §4).

    Die vollen Pfade bleiben im Worker; veröffentlicht werden nur die
    Fenster-Minima je Draw (2-h-Blöcke) und die Nowcast-Draws — daraus
    rechnet der Live-API-Pfad ``P_besser``/``P_lohnt``/F3-Fenster-P ohne
    Numerik-Abhängigkeit (app/pside.py).
    """
    from engine.probabilities import (
        BLOCK_MINUTES,
        DECISION_DRAWS,
        block_ids,
        block_minima,
        block_starts,
        nowcast_draws,
    )
    import pandas as pd

    n = min(DECISION_DRAWS, paths.shape[0])
    ids = block_ids(index, cfg.timezone, BLOCK_MINUTES)
    starts = block_starts(index, cfg.timezone, BLOCK_MINUTES)
    minima = block_minima(paths[:n], ids)
    blocks = [
        {
            "start": stamp.isoformat(),
            "end": (stamp + pd.Timedelta(minutes=BLOCK_MINUTES)).isoformat(),
        }
        for stamp in starts
    ]
    return {
        "n": n,
        "block_minutes": BLOCK_MINUTES,
        "blocks": blocks,
        "minima": minima.tolist(),
        "nowcast": nowcast_draws(paths[:n]).tolist(),
    }


def _run(task: tuple) -> dict[str, Any]:
    """Eine Aufgabe: kind = 'fit' | 'wide' | 'backtest'."""
    kind, key, hours = task
    item = _STATE["series"][key]
    cfg = _STATE["cfg"]
    origin = _STATE["origin"]
    out: dict[str, Any] = {"kind": kind, "key": key, "hours": hours, "ok": False}
    # Schwere Importe erst im Worker (Parent bleibt schlank).
    from engine.backtest import run_backtest
    from engine.models import fit, predict

    try:
        model = fit(item, origin, cfg)
        if kind == "backtest":
            report, _ = run_backtest([item], cfg, days=hours)
            out.update(
                ok=True,
                metrics=report.get("metrics"),
                decision_rows=list(report.get("decision", {}).get("rows", [])),
                decision_hour=report.get("decision", {}).get("decision_hour", 8),
                model=model,
            )
            return out
        frame, paths = predict(model, hours=hours, return_paths=True)
        out.update(
            ok=True,
            model=model,
            points=_records(frame),
            draws=_draws(frame.index, paths, cfg),
        )
        return out
    except ValueError as exc:
        # Gleiche Meldung wie im seriellen Pfad (Engine-Text, keine Interna).
        out["detail"] = str(exc)
        return out
    except Exception as exc:  # harte Fehler nicht verschlucken, aber benennen
        out["detail"] = f"{type(exc).__name__}: {exc}"
        return out


def run_tasks(
    tasks: list[tuple],
    series_map: dict,
    cfg,
    origin,
    workers: int = 1,
    on_done: Callable[[dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """Führt Aufgaben aus (parallel, mit seriellem Fallback).

    Rückgabe in der Reihenfolge von ``tasks``.
    """
    if not tasks:
        return []
    if workers <= 1:
        _init(series_map, cfg, origin)
        results = [_run(task) for task in tasks]
        for result in results:
            if on_done:
                on_done(result)
        return results

    try:
        with ProcessPoolExecutor(
            max_workers=min(workers, len(tasks)),
            initializer=_init,
            initargs=(series_map, cfg, origin),
        ) as pool:
            futures = [(task, pool.submit(_run, task)) for task in tasks]
            results = []
            for _task, future in futures:
                results.append(future.result())
                if on_done:
                    on_done(results[-1])
            return results
    except (OSError, ImportError, RuntimeError, ValueError):
        # Kein Prozess-Pool verfügbar (z. B. eingeschränktes /dev/shm):
        # seriell weiterrechnen statt den Modell-Lauf abzubrechen.
        _init(series_map, cfg, origin)
        results = [_run(task) for task in tasks]
        for result in results:
            if on_done:
                on_done(result)
        return results
