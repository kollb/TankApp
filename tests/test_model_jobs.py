"""Prozessparallele Modellberechnung (app/model_jobs.py).

Prüft vor allem die Zusage, die die Parallelität teuer macht: **gleiche
Ergebnisse** wie seriell — unabhängig von der Anzahl der Prozesse. Außerdem
der Rückfall auf serielle Ausführung, wenn kein Prozess-Pool möglich ist
(eingeschränktes /dev/shm im Container).
"""

import os

import pandas as pd
import pytest

from app.model_jobs import HORIZON_COLUMNS, resolve_workers, run_tasks
from engine.config import Config
from engine.data import normalize_observations, prepare_series

ORIGIN = pd.Timestamp("2026-08-01T00:00", tz="UTC")


def _series_map(observations, cfg, count=3):
    frames = [
        observations(days=35, start="2026-07-01").assign(
            station_id=f"station-{index}", city="Testmarkt"
        )
        for index in range(count)
    ]
    normalized, _ = normalize_observations(pd.concat(frames), cfg)
    return {
        (item.city, item.station_id): item for item in prepare_series(normalized, cfg)
    }


@pytest.fixture
def plan(observations, cfg):
    series_map = _series_map(observations, cfg)
    tasks = []
    for key in series_map:
        tasks.extend([("fit", key, 24), ("wide", key, 72), ("backtest", key, 7)])
    return series_map, cfg, tasks


def _num(value):
    """NaN ist nicht gleich NaN — für den Vergleich auf None normalisieren."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    return None if value != value else round(float(value), 9)


def _fingerprint(results):
    """Vergleichbare Kurzform: pro Aufgabe die relevanten Zahlen."""
    out = []
    for result in results:
        entry = {
            "kind": result["kind"],
            "key": result["key"],
            "hours": result["hours"],
            "ok": result["ok"],
        }
        if result.get("points"):
            entry["points"] = [
                [
                    (column, _num(value))
                    for column, value in sorted(row.items())
                    if isinstance(value, (int, float))
                ]
                for row in result["points"]
            ]
        if result.get("metrics"):
            entry["metrics"] = {
                key: _num(value) for key, value in sorted(result["metrics"].items())
            }
        out.append(entry)
    return out


def test_parallel_matches_sequential(plan):
    series_map, cfg, tasks = plan
    sequential = run_tasks(tasks, series_map, cfg, ORIGIN, workers=1)
    parallel = run_tasks(tasks, series_map, cfg, ORIGIN, workers=2)
    assert len(sequential) == len(parallel) == len(tasks)
    assert all(item["ok"] for item in parallel)
    assert _fingerprint(sequential) == _fingerprint(parallel)


def test_parallel_keeps_station_order(plan):
    series_map, cfg, tasks = plan
    results = run_tasks(tasks, series_map, cfg, ORIGIN, workers=2)
    assert [result["key"] for result in results] == [task[1] for task in tasks]


def test_horizon_points_only_carry_quantiles(plan):
    series_map, cfg, tasks = plan
    results = run_tasks(tasks, series_map, cfg, ORIGIN, workers=2)
    wide = [r for r in results if r["kind"] == "wide"]
    assert wide
    for result in wide:
        for row in result["points"][:5]:
            assert set(HORIZON_COLUMNS).issubset(row)


def test_failing_station_is_reported_not_raised(observations, cfg):
    """Zu wenig Historie → Fehlertext je Station, kein Abbruch des Laufs."""
    frames = [
        observations(days=35, start="2026-07-01").assign(
            station_id="station-rich", city="Testmarkt"
        ),
        observations(days=3, start="2026-07-29").assign(
            station_id="station-poor", city="Testmarkt"
        ),
    ]
    normalized, _ = normalize_observations(pd.concat(frames), cfg)
    series_map = {
        (item.city, item.station_id): item for item in prepare_series(normalized, cfg)
    }
    tasks = [("fit", key, 24) for key in series_map]
    results = run_tasks(tasks, series_map, cfg, ORIGIN, workers=2)
    broken = [r for r in results if not r["ok"]]
    assert len(broken) == 1
    assert broken[0]["key"][1] == "station-poor"
    assert "nutzbare Tage" in broken[0]["detail"]


def test_falls_back_to_sequential_without_process_pool(plan, monkeypatch):
    """Kein /dev/shm oder keine Prozesse → seriell weiter, kein Abbruch."""

    class NoPool:
        def __init__(self, *args, **kwargs):
            raise OSError("Function sem_open failed")

    monkeypatch.setattr("app.model_jobs.ProcessPoolExecutor", NoPool)
    series_map, cfg, tasks = plan
    results = run_tasks(tasks, series_map, cfg, ORIGIN, workers=4)
    assert len(results) == len(tasks)
    assert all(item["ok"] for item in results)


def test_resolve_workers(monkeypatch):
    cpus = os.cpu_count() or 1
    monkeypatch.setenv("TANKAPP_MODEL_WORKERS", "3")
    assert resolve_workers() == 3
    assert resolve_workers(1) == 1  # explizit schlägt Umgebung
    monkeypatch.setenv("TANKAPP_MODEL_WORKERS", "")
    assert resolve_workers() == max(1, min(8, cpus))
    monkeypatch.setenv("TANKAPP_MODEL_WORKERS", "0")
    assert resolve_workers() == max(1, min(8, cpus))
    monkeypatch.setenv("TANKAPP_MODEL_WORKERS", "999")
    assert resolve_workers() == 64  # begrenzt, kein Prozess-Exzess
    monkeypatch.setenv("TANKAPP_MODEL_WORKERS", "unsinn")
    assert resolve_workers() == max(1, min(8, cpus))


def test_config_carries_worker_setting():
    """Die NAS-Konfiguration kennt die Prozesszahl (Default = automatisch)."""
    from app.config import Settings

    assert Settings().model_workers == 0
    assert isinstance(Config(), Config)
