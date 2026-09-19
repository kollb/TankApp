"""Prozessparallele Modellberechnung (app/model_jobs.py).

Prüft vor allem die Zusage, die die Parallelität teuer macht: **gleiche
Ergebnisse** wie seriell — unabhängig von der Anzahl der Prozesse. Außerdem
der Rückfall auf serielle Ausführung, wenn kein Prozess-Pool möglich ist
(eingeschränktes /dev/shm im Container).
"""

import multiprocessing as mp
import os

import pandas as pd
import pytest

import app.model_jobs as model_jobs
from app.model_jobs import (
    HORIZON_COLUMNS,
    WORKER_FRAME_COLUMNS,
    ModelTaskPool,
    available_cpu_count,
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


def test_horizon_points_carry_only_public_quantiles_and_support(plan):
    series_map, cfg, tasks = plan
    results = run_tasks(tasks, series_map, cfg, ORIGIN, workers=2)
    predicted = [r for r in results if r["kind"] in {"fit", "wide"}]
    assert predicted
    for result in predicted:
        for row in result["points"][:5]:
            assert tuple(row) == HORIZON_COLUMNS
    # Wide muss fitten, aber das Modell wird nur aus der fit24-Aufgabe
    # publiziert; zwei tote ~100-kB-Rücktransfers je Station entfallen.
    assert all(
        "model" not in result for result in predicted if result["kind"] == "wide"
    )
    assert all("model" in result for result in predicted if result["kind"] == "fit")


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
    cpus = available_cpu_count()
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


def test_auto_workers_respect_affinity_and_cgroup_quota(monkeypatch):
    """B23: 8 Host-Kerne dürfen bei 2 nutzbaren CPUs nur 2 Worker ergeben."""
    monkeypatch.setattr(os, "process_cpu_count", lambda: 8, raising=False)
    monkeypatch.setattr(os, "cpu_count", lambda: 8)
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(2)))
    monkeypatch.setattr(model_jobs, "_cgroup_cpu_limit", lambda: 6)
    assert available_cpu_count() == 2
    assert resolve_workers(0) == 2

    # Auch ohne Pinning begrenzt Docker --cpus/NanoCpus über cpu.max.
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(8)))
    monkeypatch.setattr(model_jobs, "_cgroup_cpu_limit", lambda: 2)
    assert available_cpu_count() == 2
    assert resolve_workers(0) == 2


def test_cgroup_v2_and_v1_quotas_are_rounded_up(tmp_path):
    proc = tmp_path / "proc-self-cgroup"
    proc.write_text("0::/\n", encoding="utf-8")
    (tmp_path / "cpu.max").write_text("150000 100000\n", encoding="ascii")
    assert model_jobs._cgroup_cpu_limit(tmp_path, proc) == 2

    (tmp_path / "cpu.max").write_text("max 100000\n", encoding="ascii")
    cpu = tmp_path / "cpu"
    cpu.mkdir()
    (cpu / "cpu.cfs_quota_us").write_text("250000\n", encoding="ascii")
    (cpu / "cpu.cfs_period_us").write_text("100000\n", encoding="ascii")
    assert model_jobs._cgroup_cpu_limit(tmp_path, proc) == 3


def test_serial_callback_follows_each_task_immediately(plan, monkeypatch):
    """B20/7: seriell nicht erst rechnen und danach Fortschritt ausschütten."""
    series_map, cfg, tasks = plan
    events = []

    def fake_run(task):
        events.append(("run", task))
        return {"kind": task[0], "key": task[1], "hours": task[2], "ok": True}

    monkeypatch.setattr(model_jobs, "_run", fake_run)
    selected = tasks[:3]
    results = run_tasks(
        selected,
        series_map,
        cfg,
        ORIGIN,
        workers=1,
        on_done=lambda result: events.append(("done", result["kind"])),
    )
    assert [result["kind"] for result in results] == [task[0] for task in selected]
    assert [kind for kind, _value in events] == [
        "run",
        "done",
        "run",
        "done",
        "run",
        "done",
    ]


def test_one_pool_serves_two_waves_and_reports_completion_order(plan, monkeypatch):
    """B19/B20: ein fork-Pool, schlanke initargs, Callback nach Abschluss.

    Der Fake beendet jede Welle rückwärts. Die Ergebnisliste muss trotzdem in
    Einreichreihenfolge bleiben, während der Callback die echte Reihenfolge sieht.
    """
    series_map, cfg, tasks = plan
    instances = []

    class Future:
        def __init__(self, task):
            self.task = task

        def result(self):
            kind, key, hours = self.task
            return {"kind": kind, "key": key, "hours": hours, "ok": True}

    class Pool:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.shutdown_calls = 0
            instances.append(self)

        def submit(self, _fn, task):
            return Future(task)

        def shutdown(self, **_kwargs):
            self.shutdown_calls += 1

    monkeypatch.setattr(model_jobs, "ProcessPoolExecutor", Pool)
    monkeypatch.setattr(
        model_jobs, "as_completed", lambda futures: iter(reversed(list(futures)))
    )
    wave_a, wave_b = tasks[:3], tasks[3:6]
    completed = []
    with ModelTaskPool(series_map, cfg, ORIGIN, workers=2) as pool:
        result_a = pool.run(
            wave_a, on_done=lambda row: completed.append((row["kind"], row["hours"]))
        )
        result_b = pool.run(
            wave_b, on_done=lambda row: completed.append((row["kind"], row["hours"]))
        )

    assert len(instances) == 1
    assert instances[0].shutdown_calls == 1
    assert [row["key"] for row in result_a] == [task[1] for task in wave_a]
    assert [row["key"] for row in result_b] == [task[1] for task in wave_b]
    assert completed == [(task[0], task[2]) for task in reversed(wave_a)] + [
        (task[0], task[2]) for task in reversed(wave_b)
    ]
    init_series = instances[0].kwargs["initargs"][0]
    assert all(
        tuple(item.frame.columns) == WORKER_FRAME_COLUMNS
        for item in init_series.values()
    )
    context = instances[0].kwargs["mp_context"]
    expected_method = "fork" if "fork" in mp.get_all_start_methods() else "spawn"
    assert context.get_start_method() == expected_method


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


def test_horizon_records_publish_support_and_round_bands_to_tenth_cent():
    """O10: thin local slots survive publication rather than looking certain."""
    from app.model_jobs import _records

    index = pd.date_range("2026-09-16T12:00:00Z", periods=2, freq="5min")
    frame = pd.DataFrame(
        {
            "q025": [1.70149, 1.70251],
            "q10": [1.71149, 1.71251],
            "q50": [1.72149, 1.72251],
            "q90": [1.73149, 1.73251],
            "q975": [1.74149, 1.74251],
            "support_days": [7, 21],
            "supported": [True, True],
        },
        index=index,
    )
    records = _records(frame)
    assert records[0]["support_days"] == 7
    assert records[0]["supported"] is True
    assert records[0]["q50"] == 1.721  # 0.001 €/L = 0.1 ct/L
    assert records[1]["q50"] == 1.723


def test_settings_parse_calibration_ab_switch(monkeypatch):
    """B2: Der PIT-Schalter ist bewusst leicht für A/B-Läufe umsetzbar."""
    from app.config import Settings

    monkeypatch.setenv("TANKAPP_CALIBRATION", "0")
    assert Settings.from_env().calibration is False
    monkeypatch.setenv("TANKAPP_CALIBRATION", "on")
    assert Settings.from_env().calibration is True
