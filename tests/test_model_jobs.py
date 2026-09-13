"""Prozessparallele Modellberechnung (app/model_jobs.py).

Prüft vor allem die Zusage, die die Parallelität teuer macht: **gleiche
Ergebnisse** wie seriell — unabhängig von der Anzahl der Prozesse. Außerdem
der Rückfall auf serielle Ausführung, wenn kein Prozess-Pool möglich ist
(eingeschränktes /dev/shm im Container).
"""

import os
from concurrent.futures import Future

import pandas as pd
import pytest

from app.model_jobs import (
    HORIZON_COLUMNS,
    MODEL_FRAME_COLUMNS,
    POOL_START_METHOD,
    ModelTaskPool,
    resolve_workers,
    run_tasks,
)
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
        assert "model" not in result  # B20.1: kein totes 101-kB-Artefakt
        for row in result["points"][:5]:
            assert tuple(row) == HORIZON_COLUMNS


def test_worker_state_only_carries_model_columns(plan):
    """B19: Diagnose-Spalten werden nicht in jeden Worker übertragen."""
    from app import model_jobs
    from engine.storage import json_safe

    series_map, cfg, _tasks = plan
    assert set(next(iter(series_map.values())).frame) > set(MODEL_FRAME_COLUMNS)
    key = next(iter(series_map))
    task = ("fit", key, 24)

    # Referenz mit dem bisherigen, vollständigen Frame.
    model_jobs._init(series_map, cfg, ORIGIN)
    full = model_jobs._run(task)
    with ModelTaskPool(series_map, cfg, ORIGIN, workers=1) as pool:
        assert all(
            tuple(item.frame.columns) == MODEL_FRAME_COLUMNS
            for item in pool.series_map.values()
        )
        slim = pool.run([task])[0]

    assert json_safe(slim["model"]) == json_safe(full["model"])
    assert json_safe(slim["points"]) == json_safe(full["points"])
    assert json_safe(slim["draws"]) == json_safe(full["draws"])


def test_one_pool_serves_both_batches_and_reports_completion_order(plan, monkeypatch):
    """B19/B20.5: ein Fork-Pool, ehrliche Callbacks, stabile Rückgabe."""
    created = []

    class ImmediatePool:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.closed = False
            created.append(self)

        def submit(self, _function, task):
            future = Future()
            kind, key, hours = task
            future.set_result({"kind": kind, "key": key, "hours": hours, "ok": True})
            return future

        def shutdown(self, **_kwargs):
            self.closed = True

    # Fertigstellungsreihenfolge gezielt umdrehen. Die Rückgabe muss dennoch
    # in Einreichreihenfolge bleiben.
    monkeypatch.setattr("app.model_jobs.ProcessPoolExecutor", ImmediatePool)
    monkeypatch.setattr(
        "app.model_jobs.as_completed", lambda futures: reversed(list(futures))
    )
    series_map, cfg, tasks = plan
    first_tasks, second_tasks = tasks[:3], tasks[3:6]
    completed = []
    with ModelTaskPool(series_map, cfg, ORIGIN, workers=2) as pool:
        first = pool.run(
            first_tasks, on_done=lambda row: completed.append(row["hours"])
        )
        second = pool.run(
            second_tasks, on_done=lambda row: completed.append(row["hours"])
        )

    assert len(created) == 1
    assert created[0].closed
    assert created[0].kwargs["mp_context"].get_start_method() == POOL_START_METHOD
    assert [row["hours"] for row in first] == [task[2] for task in first_tasks]
    assert [row["hours"] for row in second] == [task[2] for task in second_tasks]
    assert completed == [task[2] for task in reversed(first_tasks)] + [
        task[2] for task in reversed(second_tasks)
    ]


def test_serial_path_reports_each_task_immediately(plan, monkeypatch):
    """B20.7: kein minutenlanges Schweigen bis zum Ende der ganzen Phase."""
    events = []

    def fake_run(task):
        events.append(("run", task[2]))
        return {"kind": task[0], "key": task[1], "hours": task[2], "ok": True}

    monkeypatch.setattr("app.model_jobs._run", fake_run)
    series_map, cfg, tasks = plan
    selected = tasks[:3]
    results = run_tasks(
        selected,
        series_map,
        cfg,
        ORIGIN,
        workers=1,
        on_done=lambda row: events.append(("done", row["hours"])),
    )
    assert [row["hours"] for row in results] == [task[2] for task in selected]
    assert events == [
        event for task in selected for event in (("run", task[2]), ("done", task[2]))
    ]


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
    monkeypatch.setattr("app.model_jobs._available_cpu_count", lambda: 6)
    monkeypatch.setenv("TANKAPP_MODEL_WORKERS", "3")
    assert resolve_workers() == 3
    assert resolve_workers(1) == 1  # explizit schlägt Umgebung
    monkeypatch.setenv("TANKAPP_MODEL_WORKERS", "")
    assert resolve_workers() == 6
    monkeypatch.setenv("TANKAPP_MODEL_WORKERS", "0")
    assert resolve_workers() == 6
    monkeypatch.setenv("TANKAPP_MODEL_WORKERS", "999")
    assert resolve_workers() == 64  # begrenzt, kein Prozess-Exzess
    monkeypatch.setenv("TANKAPP_MODEL_WORKERS", "unsinn")
    assert resolve_workers() == 6


def test_auto_workers_respect_affinity_and_cgroup_quota(monkeypatch):
    """B23: 8 Host-Kerne, aber nur 2 nutzbar ⇒ automatisch 2 Worker."""
    monkeypatch.delattr(os, "process_cpu_count", raising=False)
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: {2, 3})
    monkeypatch.setattr("app.model_jobs._quota_cpu_count", lambda: None)
    assert resolve_workers(0) == 2

    # Eine engere Docker-Quota gewinnt gegen die Affinität.
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(8)))
    monkeypatch.setattr("app.model_jobs._quota_cpu_count", lambda: 2)
    assert resolve_workers(0) == 2


def test_cgroup_v2_and_v1_quotas_are_parsed(monkeypatch):
    from app import model_jobs

    values = {model_jobs._CGROUP_V2_CPU_MAX: "150000 100000"}
    monkeypatch.setattr(model_jobs, "_read_cpu_control", lambda path: values.get(path))
    assert model_jobs._quota_cpu_count() == 2

    values = {
        model_jobs._CGROUP_V2_CPU_MAX: "max 100000",
        model_jobs._CGROUP_V1_CPU_QUOTA: "200000",
        model_jobs._CGROUP_V1_CPU_PERIOD: "100000",
    }
    assert model_jobs._quota_cpu_count() == 2


def test_config_carries_worker_setting():
    """Die NAS-Konfiguration kennt die Prozesszahl (Default = automatisch)."""
    from app.config import Settings

    assert Settings().model_workers == 0
    assert isinstance(Config(), Config)


def test_settings_parse_city_subdivisions(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv(
        "TANKAPP_CITY_SUBDIVS",
        "Frankfurt:DE-HE; Gütersloh : nw;kaputt;Leer:;ZuLang:XYZ",
    )
    assert Settings.from_env().city_subdivs == {
        "Frankfurt": "HE",
        "Gütersloh": "NW",
    }
