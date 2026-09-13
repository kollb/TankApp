"""Prozessparallele Modellberechnung (Konzept §9.4: Fits gehören aufs NAS).

Stationen und Prognosehorizonte sind voneinander unabhängig — der
Modell-Lauf ist „peinlich parallel“. Seriell nutzt er genau einen Kern,
obwohl NAS und PC mehrere haben; bei ~14 s je Station (nach der
Beschleunigung der 12-Uhr-Projektion) summiert sich das über 20 Stationen
auf mehrere Minuten.

Aufteilung (je Station ein Bündel unabhängiger Aufgaben):

- ``fit``: Fit + 24-h-Prognose (liefert das Modell für die Veröffentlichung)
- ``wide``: +3 d und +7 d Ausblick für die Werkstatt
- ``backtest``: 21-Tage-Rolling-Origin-Backtest (Prüfstand §1.3: nur so
  kann das 21-Tage-Gate aus dem automatischen Lauf erfüllt werden; liefert
  zusätzlich Rolling-PICP 7 d je Station und die Mehrtage-Horizonte +3 d/+7 d).
  B17: Das Ergebnis hängt nur vom lokalen Endtag und den Daten davor ab —
  bei gleichem Fingerabdruck kommt es aus ``runtime/engine/backtest-cache/``
  statt aus 21 Folds × (1 Fit + 3 Prognosen) (app/backtest_cache.py).

Die Aufgaben laufen in einem ``ProcessPoolExecutor``. Phase A (Fit + 24 h)
und Phase B (weite Horizonte + Backtest) teilen sich dabei denselben Pool:
Worker-Importe und der Stationsbestand werden nur einmal je Kraftstoff
aufgebaut. Auf dem Linux-NAS wird die Startmethode ausdrücklich auf ``fork``
gesetzt. Der Job-Prozess ist ein eigener, single-threaded Subprozess; Copy-on-
write vermeidet deshalb den teuren ``forkserver``-Transfer des kompletten
Stationsbestands. Fällt der Pool aus (eingeschränktes /dev/shm, keine Prozesse
erlaubt), rechnet derselbe Code seriell weiter — Funktionsfähigkeit geht vor
Geschwindigkeit.

Determinismus: Alle Aufgaben erhalten dieselbe Config und denselben
Cutoff, der Zufallsgenerator der Engine ist seed-basiert. Die Ergebnisse
werden in Reihenfolge der Stationsliste zusammengesetzt, damit die
Veröffentlichung unabhängig von der Anzahl der Prozesse identisch ist.
"""

from __future__ import annotations

import math
import multiprocessing as mp
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from concurrent.futures.process import BrokenProcessPool
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable

_STATE: dict[str, Any] = {}
MAX_AUTO_WORKERS = 8
POOL_START_METHOD = "fork"

# Spalten der publizierten Horizonte: Quantile + Zeitstempel.
HORIZON_COLUMNS = ("timestamp", "q025", "q10", "q50", "q90", "q975")

# Nur diese Spalten werden von ``fit`` und ``run_backtest`` gelesen. Die
# übrigen Diagnosefelder einer PriceSeries (status, available, age_minutes)
# machten den forkserver-initarg auf dem NAS unnötig groß. Reihenfolge und
# dtypes bleiben unverändert, damit Fit und Backtest bitgleich bleiben.
MODEL_FRAME_COLUMNS = (
    "price",
    "observed",
    "response_observed",
    "status_known",
    "source",
    "observed_at",
)

_CGROUP_V2_CPU_MAX = Path("/sys/fs/cgroup/cpu.max")
_CGROUP_V1_CPU_QUOTA = Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")
_CGROUP_V1_CPU_PERIOD = Path("/sys/fs/cgroup/cpu/cpu.cfs_period_us")


def _read_cpu_control(path: Path) -> str | None:
    """Kleine, separat testbare Leseschicht für cgroup-v1/v2 CPU-Limits."""
    try:
        return path.read_text(encoding="ascii").strip()
    except (OSError, UnicodeError):
        return None


def _quota_cpu_count() -> int | None:
    """CPU-Anzahl aus cgroup-Quota (Docker ``NanoCpus``/``cpu.max``).

    Bruchteile werden aufgerundet: bei 1,5 CPU kann ein zweiter Prozess den
    verbleibenden halben Kern nutzen. Affinität und das harte Auto-Maximum
    begrenzen das Ergebnis anschließend weiter.
    """
    raw = _read_cpu_control(_CGROUP_V2_CPU_MAX)
    if raw:
        parts = raw.split()
        if len(parts) >= 2 and parts[0] != "max":
            try:
                quota, period = int(parts[0]), int(parts[1])
            except ValueError:
                pass
            else:
                if quota > 0 and period > 0:
                    return max(1, math.ceil(quota / period))

    quota_raw = _read_cpu_control(_CGROUP_V1_CPU_QUOTA)
    period_raw = _read_cpu_control(_CGROUP_V1_CPU_PERIOD)
    if quota_raw and period_raw:
        try:
            quota, period = int(quota_raw), int(period_raw)
        except ValueError:
            return None
        if quota > 0 and period > 0:
            return max(1, math.ceil(quota / period))
    return None


def _available_cpu_count() -> int:
    """Für diesen Prozess tatsächlich nutzbare CPUs (Affinität + cgroup)."""
    process_cpu_count = getattr(os, "process_cpu_count", None)
    cpus = process_cpu_count() if process_cpu_count is not None else None
    try:
        affinity_cpus = len(os.sched_getaffinity(0))
    except (AttributeError, OSError):
        affinity_cpus = None
    if cpus and affinity_cpus:
        cpus = min(int(cpus), affinity_cpus)
    elif not cpus:
        cpus = affinity_cpus or os.cpu_count() or 1
    quota = _quota_cpu_count()
    if quota is not None:
        cpus = min(int(cpus), quota)
    return max(1, int(cpus))


def resolve_workers(requested: int | None = None) -> int:
    """Anzahl Prozesse: 0/None = affinitäts-/quota-aware automatisch.

    Ein positiver expliziter Wert bleibt eine bewusste Betreiber-Vorgabe und
    wird wie bisher nur durch das Sicherheitsmaximum 64 begrenzt.
    """
    if requested is None:
        raw = os.environ.get("TANKAPP_MODEL_WORKERS", "")
        try:
            requested = int(str(raw).strip() or 0)
        except ValueError:
            requested = 0
    if requested and requested > 0:
        return max(1, min(64, int(requested)))
    return max(1, min(MAX_AUTO_WORKERS, _available_cpu_count()))


def _init(series_map: dict, cfg, origin, cache_dir=None, cache_digests=None) -> None:
    """Wird je Prozess einmal ausgeführt (Daten via Fork/Init, nicht je Task)."""
    _STATE["series"] = series_map
    _STATE["cfg"] = cfg
    _STATE["origin"] = origin
    _STATE["cache_dir"] = cache_dir
    _STATE["cache_digests"] = cache_digests or {}


def _cache_series_digests(series_map: dict, cfg, enabled: bool) -> dict:
    """Vollen B17-Inhaltshash vor dem Kürzen der Worker-Frames sichern.

    So treffen Cache-Dateien aus 0.25 weiterhin: Nur der kleine SHA-256-Wert
    wandert in den Worker, nicht die drei ausschließlich diagnostischen
    Frame-Spalten, die der Fingerabdruck konservativ mit absichert.
    """
    if not enabled:
        return {}
    from engine.backtest import last_complete_day, truncate_series
    from . import backtest_cache

    digests = {}
    for key, item in series_map.items():
        end_local = last_complete_day([item], cfg)
        cut = truncate_series(item, end_local.tz_convert("UTC"))
        digests[key] = backtest_cache.series_digest(cut.frame)
    return digests


def _slim_series_map(series_map: dict) -> dict:
    """PriceSeries für Worker auf die tatsächlich gelesenen Spalten kürzen."""
    compact = {}
    for key, item in series_map.items():
        missing = set(MODEL_FRAME_COLUMNS) - set(item.frame.columns)
        if missing:
            raise ValueError(
                "Modellreihe ohne Pflichtspalten: " + ", ".join(sorted(missing))
            )
        if tuple(item.frame.columns) == MODEL_FRAME_COLUMNS:
            compact[key] = item
        else:
            compact[key] = replace(
                item, frame=item.frame.loc[:, list(MODEL_FRAME_COLUMNS)]
            )
    return compact


def _backtest(item, cfg, days: int, cache_dir, cache_digest=None) -> dict[str, Any]:
    """Backtest-Kennzahlen einer Station — aus dem Tages-Cache oder frisch.

    Rückgabe: die Payload-Felder (siehe app/backtest_cache.py::PAYLOAD_KEYS)
    plus ``backtest_cached`` und ``backtest_computed_at``. Ohne ``cache_dir``
    wird immer gerechnet (CLI, Tests).
    """
    from engine.backtest import last_complete_day, run_backtest, truncate_series
    from . import backtest_cache

    end_local = last_complete_day([item], cfg)
    cut = truncate_series(item, end_local.tz_convert("UTC"))
    key = None
    if cache_dir is not None:
        key = backtest_cache.fingerprint(
            cut, cfg, end_local, days, series_digest_value=cache_digest
        )
        hit = backtest_cache.load(cache_dir, cut, key)
        if hit is not None:
            return {
                **hit["payload"],
                "backtest_cached": True,
                "backtest_computed_at": hit["computed_at"],
            }
    report, _ = run_backtest([cut], cfg, days=days, until=end_local, strict_end=True)
    # Rolling-PICP 7 d (Konzept §3.3.3): nur der eigene Eintrag — das
    # Güte-Gate in /v1/decide braucht die aktuelle Zahl der ausgewählten
    # Station, nicht die aller anderen.
    rolling = report.get("rolling_picp_7d") or []
    payload = {
        "metrics": report.get("metrics"),
        "decision_rows": list(report.get("decision", {}).get("rows", [])),
        "decision_hour": report.get("decision", {}).get("decision_hour", 12),
        "rolling_picp_7d": rolling[0] if rolling else None,
        "horizons": report.get("horizons") or {},
    }
    computed_at = None
    if cache_dir is not None and key is not None:
        try:
            computed_at = backtest_cache.store(
                cache_dir, cut, key, end_local, days, payload
            )
        except OSError:
            # Cache ist Beschleunigung, keine Voraussetzung: Schreibfehler
            # (voller/readonly Datenträger) dürfen den Lauf nicht kippen.
            computed_at = None
    return {
        **payload,
        "backtest_cached": False,
        "backtest_computed_at": computed_at,
    }


def _records(frame) -> list[dict[str, Any]]:
    """Nur die sechs tatsächlich publizierten Felder serialisieren (B20.4)."""
    published = frame.loc[:, list(HORIZON_COLUMNS[1:])].copy()
    published.insert(0, "timestamp", [stamp.isoformat() for stamp in frame.index])
    return published.to_dict(orient="records")


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
    from engine.models import fit, predict

    try:
        if kind == "backtest":
            # Kein eigener Fit am Cutoff: Der Backtest fittet je Fold selbst,
            # das Modell kommt aus der Phase-A-Aufgabe (B20 Punkt 1).
            out.update(
                ok=True,
                **_backtest(
                    item,
                    cfg,
                    hours,
                    _STATE.get("cache_dir"),
                    _STATE.get("cache_digests", {}).get(key),
                ),
            )
            return out
        model = fit(item, origin, cfg)
        frame, paths = predict(model, hours=hours, return_paths=True)
        out.update(
            ok=True,
            points=_records(frame),
            draws=_draws(frame.index, paths, cfg),
        )
        # Nur Phase A veröffentlicht das Modell. Bei ``wide`` wurde das
        # ~101-kB-Artefakt bisher ungenutzt aus jedem Worker zurückgepickelt
        # (Rest von B20.1); die Quantile/Draws genügen dort vollständig.
        if kind == "fit":
            out["model"] = model
        return out
    except ValueError as exc:
        # Gleiche Meldung wie im seriellen Pfad (Engine-Text, keine Interna).
        out["detail"] = str(exc)
        return out
    except Exception as exc:  # harte Fehler nicht verschlucken, aber benennen
        out["detail"] = f"{type(exc).__name__}: {exc}"
        return out


_POOL_FAILURES = (BrokenProcessPool, OSError, ImportError, RuntimeError, ValueError)


class ModelTaskPool:
    """Ein wiederverwendbarer Worker-Pool für beide Modellphasen (B19).

    ``run`` meldet Ergebnisse über ``on_done`` in echter
    Fertigstellungsreihenfolge, gibt sie aber weiterhin in ``tasks``-Reihenfolge
    zurück. Scheitert der Pool, werden nur noch nicht gemeldete Aufgaben
    seriell nachgerechnet; alle späteren Batches bleiben ebenfalls seriell.
    """

    def __init__(
        self,
        series_map: dict,
        cfg,
        origin,
        workers: int = 1,
        cache_dir=None,
    ) -> None:
        self.cache_digests = _cache_series_digests(
            series_map, cfg, enabled=cache_dir is not None
        )
        self.series_map = _slim_series_map(series_map)
        self.cfg = cfg
        self.origin = origin
        self.workers = max(1, int(workers))
        self.cache_dir = cache_dir
        self._pool: ProcessPoolExecutor | None = None
        self._serial = self.workers <= 1 or not self.series_map

    def __enter__(self) -> ModelTaskPool:
        # Auch für den seriellen Pfad und einen späteren Pool-Fallback setzen.
        _init(
            self.series_map,
            self.cfg,
            self.origin,
            self.cache_dir,
            self.cache_digests,
        )
        if self._serial:
            return self
        try:
            context = mp.get_context(POOL_START_METHOD)
            self._pool = ProcessPoolExecutor(
                # Phase B hat bis zu drei Aufgaben je Station; nicht auf die
                # kürzere Phase-A-Liste begrenzen, aber auch keine 64 Prozesse
                # für eine einzelne Station starten.
                max_workers=min(self.workers, max(1, len(self.series_map) * 3)),
                mp_context=context,
                initializer=_init,
                initargs=(
                    self.series_map,
                    self.cfg,
                    self.origin,
                    self.cache_dir,
                    self.cache_digests,
                ),
            )
        except _POOL_FAILURES:
            self._pool = None
            self._serial = True
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        self._close_pool()

    def _close_pool(self) -> None:
        pool, self._pool = self._pool, None
        if pool is None:
            return
        try:
            pool.shutdown(wait=True, cancel_futures=True)
        except (OSError, RuntimeError):
            pass

    @staticmethod
    def _notify(
        result: dict[str, Any],
        on_done: Callable[[dict[str, Any]], None] | None,
    ) -> None:
        if on_done is not None:
            on_done(result)

    def _run_serial(
        self,
        tasks: list[tuple],
        on_done: Callable[[dict[str, Any]], None] | None,
        results: list[dict[str, Any] | None] | None = None,
    ) -> list[dict[str, Any]]:
        # B20.7: sofort nach *jeder* Aufgabe melden, nicht erst nach der Phase.
        output = results if results is not None else [None] * len(tasks)
        for index, task in enumerate(tasks):
            if output[index] is not None:
                continue
            result = _run(task)
            output[index] = result
            self._notify(result, on_done)
        return [result for result in output if result is not None]

    def run(
        self,
        tasks: list[tuple],
        on_done: Callable[[dict[str, Any]], None] | None = None,
    ) -> list[dict[str, Any]]:
        """Einen Batch rechnen; Rückgabe stabil, Fortschritt nach Fertigstellung."""
        if not tasks:
            return []
        if self._serial or self._pool is None:
            return self._run_serial(tasks, on_done)

        results: list[dict[str, Any] | None] = [None] * len(tasks)
        futures = {}
        try:
            for index, task in enumerate(tasks):
                futures[self._pool.submit(_run, task)] = index
        except _POOL_FAILURES:
            self._serial = True
            self._close_pool()
            _init(
                self.series_map,
                self.cfg,
                self.origin,
                self.cache_dir,
                self.cache_digests,
            )
            return self._run_serial(tasks, on_done, results)

        # B20.5: Callback nach echter Fertigstellung; der Index stellt danach
        # trotzdem die deterministische Einreichreihenfolge wieder her.
        pool_failed = False
        for future in as_completed(futures):
            index = futures[future]
            try:
                result = future.result()
            except _POOL_FAILURES:
                pool_failed = True
                break
            results[index] = result
            self._notify(result, on_done)

        if pool_failed:
            self._serial = True
            self._close_pool()
            _init(
                self.series_map,
                self.cfg,
                self.origin,
                self.cache_dir,
                self.cache_digests,
            )
            return self._run_serial(tasks, on_done, results)
        return [result for result in results if result is not None]


def run_tasks(
    tasks: list[tuple],
    series_map: dict,
    cfg,
    origin,
    workers: int = 1,
    on_done: Callable[[dict[str, Any]], None] | None = None,
    cache_dir=None,
) -> list[dict[str, Any]]:
    """Kompatibler Ein-Batch-Wrapper; Refresh nutzt einen Pool für zwei Batches."""
    if not tasks:
        return []
    with ModelTaskPool(series_map, cfg, origin, workers, cache_dir) as pool:
        return pool.run(tasks, on_done=on_done)
