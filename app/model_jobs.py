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

B19: Ein ``ModelTaskPool`` bleibt je Kraftstoff für Fit **und** Folgeaufgaben
stehen. Der NAS-Worker ist ein eigener, single-threaded Prozess; deshalb wird
auf POSIX explizit ``fork`` gewählt statt des Python-3.14-Defaults
``forkserver``. Die Initialisierungsdaten enthalten nur die sechs Spalten,
die Fit, Backtest und Cache-Fingerabdruck tatsächlich lesen. Fällt der Pool
aus (eingeschränktes /dev/shm, keine Prozesse erlaubt), rechnet derselbe Code
seriell weiter — Funktionsfähigkeit geht vor Geschwindigkeit.

Determinismus: Alle Aufgaben erhalten dieselbe Config und denselben
Cutoff, der Zufallsgenerator der Engine ist seed-basiert. Die Ergebnisse
werden in Reihenfolge der Stationsliste zusammengesetzt, damit die
Veröffentlichung unabhängig von der Anzahl der Prozesse identisch ist.
``on_done`` läuft dagegen in echter Fertigstellungsreihenfolge — nur so sind
Fortschritt und Restschätzung ehrlich (B20).
"""

from __future__ import annotations

import math
import multiprocessing as mp
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import suppress
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable

from .backtest_cache import BACKTEST_FRAME_COLUMNS

_STATE: dict[str, Any] = {}
MAX_AUTO_WORKERS = 8
CGROUP_ROOT = Path("/sys/fs/cgroup")
PROC_CGROUP = Path("/proc/self/cgroup")

# Nur diese Spalten werden von engine.models.fit, engine.backtest und dem
# Backtest-Fingerabdruck gelesen. ``status``, ``available`` und ``age_minutes``
# sind bereits in price/observed/... aufgegangen und wären je Worker Ballast.
WORKER_FRAME_COLUMNS = BACKTEST_FRAME_COLUMNS

# Spalten der veröffentlichten Horizonte: Quantile + Zeitstempel. Interne
# Diagnosewerte aus predict() gehören nicht ins JSON und nicht über die
# Prozessgrenze (B20 Punkt 4).
HORIZON_COLUMNS = ("timestamp", "q025", "q10", "q50", "q90", "q975")
HORIZON_VALUE_COLUMNS = HORIZON_COLUMNS[1:]

# O22: Nachkommastellen der veröffentlichten Preise und Quantile. 4 Stellen =
# 0,0001 €/L = 0,01 ct/L — feiner als jede Anzeige (``euroPerLiter`` zeigt
# drei, ``centPerLiter`` eine) und feiner als jede Schwelle der App
# (``THETA_CT`` = 1,0 ct/L). Volle float-Präzision verdoppelt dagegen die
# Veröffentlichung: Sie ist der Grund, warum elf Stationen nicht mehr durch
# das Leselimit passen (docs/OPTIMIERUNGS-BEFUND.md O22).
PUBLICATION_DECIMALS = 4


def _published(value):
    """Preis/Quantil in Veröffentlichungs-Präzision — NaN bleibt NaN.

    Gerundet wird hier und nicht erst beim Schreiben, weil die Werte über die
    Prozessgrenze des Worker-Pools gehen: Was nicht publiziert werden soll,
    muss auch nicht übertragen werden (B20 Punkt 4).
    """
    if value is None:
        return None
    number = float(value)
    if math.isnan(number):
        return number
    return round(number, PUBLICATION_DECIMALS)


_POOL_FAILURES = (OSError, ImportError, RuntimeError, ValueError)
_MISSING = object()


def _quota_from_cpu_max(path: Path) -> int | None:
    """cgroup-v2-Quota aus ``cpu.max`` als nutzbare Prozesszahl.

    Eine Teil-CPU wird aufgerundet: zwei Worker können eine Quote von 1,5 CPUs
    auslasten, acht Worker würden nur Speicher und Startaufwand vervielfachen.
    ``max`` bzw. kaputte/fehlende Dateien bedeuten „hier kein Limit“.
    """
    try:
        quota_text, period_text, *_ = path.read_text(encoding="ascii").split()
        if quota_text == "max":
            return None
        quota, period = int(quota_text), int(period_text)
    except (OSError, ValueError):
        return None
    if quota <= 0 or period <= 0:
        return None
    return max(1, math.ceil(quota / period))


def _quota_from_cgroup_v1(directory: Path) -> int | None:
    """cgroup-v1-Quota aus ``cpu.cfs_{quota,period}_us``."""
    try:
        quota = int((directory / "cpu.cfs_quota_us").read_text(encoding="ascii"))
        period = int((directory / "cpu.cfs_period_us").read_text(encoding="ascii"))
    except (OSError, ValueError):
        return None
    if quota <= 0 or period <= 0:  # -1 = unbegrenzt
        return None
    return max(1, math.ceil(quota / period))


def _cgroup_directories(root: Path, proc_cgroup: Path) -> list[Path]:
    """Mögliche aktuelle cgroup-Verzeichnisse (v2, v1 und Namespaces)."""
    candidates = [root, root / "cpu", root / "cpu,cpuacct"]
    try:
        lines = proc_cgroup.read_text(encoding="utf-8").splitlines()
    except OSError:
        lines = []
    for line in lines:
        parts = line.split(":", 2)
        if len(parts) != 3:
            continue
        controllers, relative = parts[1], parts[2]
        relative_path = Path(relative.lstrip("/"))
        if ".." in relative_path.parts:
            continue
        # v2: ``0::/pfad``; v1: Controller stehen im mittleren Feld.
        if not controllers:
            candidates.append(root / relative_path)
        elif "cpu" in controllers.split(","):
            for mount in (root, root / "cpu", root / "cpu,cpuacct"):
                candidates.append(mount / relative_path)
    # Elternlimits gelten ebenfalls. Das ist z. B. bei systemd-Slices wichtig.
    expanded: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        current = candidate
        while current == root or root in current.parents:
            if current not in seen:
                seen.add(current)
                expanded.append(current)
            if current == root:
                break
            current = current.parent
    return expanded


def _cgroup_cpu_limit(
    root: Path | None = None, proc_cgroup: Path | None = None
) -> int | None:
    """Kleinste aktive CPU-Quota des aktuellen cgroup-Pfads.

    Docker ``NanoCpus``/``--cpus`` wird vom Kernel als dieselbe cgroup-Quota
    sichtbar. Ein Docker-Socket oder ``docker inspect`` ist daher nicht nötig.
    """
    root = Path(root or CGROUP_ROOT)
    proc_cgroup = Path(proc_cgroup or PROC_CGROUP)
    limits = []
    for directory in _cgroup_directories(root, proc_cgroup):
        v2 = _quota_from_cpu_max(directory / "cpu.max")
        if v2 is not None:
            limits.append(v2)
        v1 = _quota_from_cgroup_v1(directory)
        if v1 is not None:
            limits.append(v1)
    return min(limits) if limits else None


def available_cpu_count() -> int:
    """Für diesen Prozess nutzbare CPUs: Affinität **und** cgroup-Quota.

    ``os.process_cpu_count`` (Python ≥3.13) respektiert die Prozesssicht. Für
    die in CI noch unterstützten Python 3.11/3.12 folgt der Affinitäts-Fallback.
    Eine cgroup-CPU-Quota ist eine zweite, unabhängige Obergrenze.
    """
    counts: list[int] = []
    process_cpu_count = getattr(os, "process_cpu_count", None)
    if callable(process_cpu_count):
        try:
            value = process_cpu_count()
        except OSError:
            value = None
        if value:
            counts.append(int(value))
    if hasattr(os, "sched_getaffinity"):
        try:
            counts.append(len(os.sched_getaffinity(0)))
        except OSError:
            pass
    host_count = os.cpu_count()
    if host_count:
        counts.append(int(host_count))
    quota = _cgroup_cpu_limit()
    if quota:
        counts.append(quota)
    return max(1, min(counts)) if counts else 1


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
    return max(1, min(MAX_AUTO_WORKERS, available_cpu_count()))


def _slim_series_map(series_map: dict) -> dict:
    """Worker-Eingabe ohne abgeleitete, nie gelesene DataFrame-Spalten."""
    return {
        key: replace(item, frame=item.frame.loc[:, WORKER_FRAME_COLUMNS])
        for key, item in series_map.items()
    }


def _process_context():
    """Explizite Startmethode; auf dem single-threaded NAS-Worker ist fork sicher."""
    methods = mp.get_all_start_methods()
    return mp.get_context("fork" if "fork" in methods else "spawn")


def _init(
    series_map: dict,
    cfg,
    origin,
    cache_dir=None,
    shared_draws: bool = True,
    model_kind: str = "ensemble",
) -> None:
    """Wird je Prozess einmal ausgeführt (Daten via Fork/Init, nicht je Task).

    ``shared_draws`` (A11): alle Stationen desselben Laufs ziehen ihre
    Tagesblöcke aus denselben Zufallszahlen. Der Schalter steckt im
    Worker-Zustand, damit auch der serielle Pfad nach einem Pool-Ausfall
    dieselbe Ziehung benutzt.
    """
    _STATE.clear()
    _STATE["series"] = series_map
    _STATE["cfg"] = cfg
    _STATE["origin"] = origin
    _STATE["cache_dir"] = cache_dir
    _STATE["shared_draws"] = bool(shared_draws)
    # A10: „harmonic_ar2“ (alt), „profile_ar2“ (Zweitmodell) oder
    # „ensemble“ (Default: inverse-MASE-gewichtete Mischung).
    _STATE["model_kind"] = str(model_kind or "harmonic_ar2").strip().lower()


def _backtest(item, cfg, days: int, cache_dir) -> dict[str, Any]:
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
        key = backtest_cache.fingerprint(cut, cfg, end_local, days)
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
        # H5: Zeitumstellung im Prüfzeitraum — die GUI erklärt damit ein
        # „nicht bestimmbar“ und zeigt die betroffenen Tage.
        "dst": report.get("dst"),
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
    """Nur veröffentlichte Quantile serialisieren, ohne DataFrame-Vollkopie.

    Die Werte gehen durch :func:`_published` (O22): sechs Nachkommastellen
    sind bei Preisen Ballast, und der Ballast entscheidet, ob elf Stationen
    noch durch das Leselimit passen.
    """
    values = frame.loc[:, HORIZON_VALUE_COLUMNS].itertuples(index=False, name=None)
    return [
        dict(zip(HORIZON_COLUMNS, (stamp.isoformat(), *(_published(v) for v in row))))
        for stamp, row in zip(frame.index, values)
    ]


def _draws(index, paths, cfg, shared: bool = False) -> dict[str, Any]:
    """Kompakte Draw-Veröffentlichung für den Decision Layer (Konzept §4).

    Die vollen Pfade bleiben im Worker; veröffentlicht werden nur die
    Fenster-Minima je Draw (2-h-Blöcke) und die Nowcast-Draws — daraus
    rechnet der Live-API-Pfad ``P_besser``/``P_lohnt``/F3-Fenster-P ohne
    Numerik-Abhängigkeit (app/pside.py).

    ``shared`` sagt, ob die Tagesblöcke stationsübergreifend gemeinsam
    gezogen wurden (A11) — die GUI und die Doku weisen das aus.
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
    # O22: Auch die Draws sind Preise — dieselbe Veröffentlichungs-Präzision
    # wie die Quantile. Die Fenster-Minima sind die größte einzelne Zahlengruppe
    # der Veröffentlichung (500 Draws × 84 Blöcke je Station).
    minima_rows = [[_published(v) for v in row] for row in minima.tolist()]
    nowcast_row = [_published(v) for v in nowcast_draws(paths[:n]).tolist()]
    return {
        "n": n,
        "block_minutes": BLOCK_MINUTES,
        "blocks": blocks,
        "minima": minima_rows,
        "nowcast": nowcast_row,
        # A11: gemeinsame Ziehung über Stationen (Konzept §4.2). False =
        # unabhängige Ziehung (Stand vor 0.31.0) — dann ist P_lohnt zu
        # selbstsicher, weil der Marktgleichlauf herausfällt.
        "shared": bool(shared),
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
            out.update(ok=True, **_backtest(item, cfg, hours, _STATE.get("cache_dir")))
            return out
        model = fit(item, origin, cfg)
        shared = bool(_STATE.get("shared_draws", True))
        # Achtung: nicht „kind“ heißen — das ist die Aufgabenart.
        model_kind = str(_STATE.get("model_kind") or "harmonic_ar2")
        frame, paths = predict(
            model, hours=hours, return_paths=True, shared_draws=shared, kind=model_kind
        )
        out.update(
            ok=True,
            points=_records(frame),
            draws=_draws(frame.index, paths, cfg, shared=shared),
        )
        # Nur der 24-h-Fit wird publiziert. Wide-Aufgaben brauchen ihr Modell
        # lokal für predict(), der ~100-kB-Rücktransfer war aber tote Arbeit.
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


class ModelTaskPool:
    """Ein wiederverwendbarer Pool für beide Aufgabenwellen eines Kraftstoffs.

    Ergebnisse bleiben in Einreichreihenfolge. Der Callback wird dagegen
    unmittelbar beim echten Abschluss aufgerufen. Bei Infrastrukturfehlern
    bleiben schon gemeldete Ergebnisse erhalten; nur offene Aufgaben werden
    seriell nachgerechnet und alle weiteren Wellen laufen ebenfalls seriell.
    """

    def __init__(
        self,
        series_map: dict,
        cfg,
        origin,
        workers: int = 1,
        cache_dir=None,
        shared_draws: bool = True,
        model_kind: str = "ensemble",
    ) -> None:
        self.series_map = _slim_series_map(series_map)
        self.cfg = cfg
        self.origin = origin
        self.cache_dir = cache_dir
        self.shared_draws = bool(shared_draws)
        self.model_kind = str(model_kind or "harmonic_ar2").strip().lower()
        # Phase B hat höchstens drei gleichzeitig unabhängige Aufgaben je
        # Station. Mehr Prozesse könnten nie Arbeit bekommen, würden aber
        # trotzdem pandas importieren und Speicher belegen.
        useful_workers = max(1, 3 * len(self.series_map))
        self.workers = min(max(1, int(workers)), useful_workers)
        self.pool = None
        self._entered = False
        self._serial = self.workers <= 1

    def __enter__(self):
        self._entered = True
        # Parent-State ist zugleich der serielle Pfad nach einem Pool-Ausfall.
        _init(
            self.series_map,
            self.cfg,
            self.origin,
            self.cache_dir,
            self.shared_draws,
            self.model_kind,
        )
        if not self._serial:
            try:
                self.pool = ProcessPoolExecutor(
                    max_workers=self.workers,
                    mp_context=_process_context(),
                    initializer=_init,
                    initargs=(
                        self.series_map,
                        self.cfg,
                        self.origin,
                        self.cache_dir,
                        self.shared_draws,
                        self.model_kind,
                    ),
                )
            except _POOL_FAILURES:
                self._serial = True
                self.pool = None
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()

    def close(self) -> None:
        pool, self.pool = self.pool, None
        if pool is not None:
            with suppress(Exception):
                pool.shutdown(wait=True, cancel_futures=True)
        self._entered = False

    def run(
        self,
        tasks: list[tuple],
        on_done: Callable[[dict[str, Any]], None] | None = None,
    ) -> list[dict[str, Any]]:
        if not self._entered:
            raise RuntimeError(
                "ModelTaskPool muss als Context-Manager verwendet werden."
            )
        if not tasks:
            return []
        if self._serial or self.pool is None:
            return self._run_serial(tasks, on_done)

        results: list[Any] = [_MISSING] * len(tasks)
        futures = {}
        try:
            for index, task in enumerate(tasks):
                futures[self.pool.submit(_run, task)] = index
        except _POOL_FAILURES:
            self._switch_to_serial()
            return self._run_serial(tasks, on_done)

        iterator = as_completed(futures)
        while True:
            try:
                future = next(iterator)
            except StopIteration:
                break
            except _POOL_FAILURES:
                self._switch_to_serial()
                return self._complete_serial(tasks, results, on_done)
            index = futures[future]
            try:
                result = future.result()
            except _POOL_FAILURES:
                self._switch_to_serial()
                return self._complete_serial(tasks, results, on_done)
            results[index] = result
            if on_done:
                # Bewusst außerhalb des Pool-Fehlerhandlers: Ein Fehler im
                # Aufrufer darf Aufgaben nicht unbemerkt doppelt ausführen.
                on_done(result)
        return list(results)

    @staticmethod
    def _run_serial(tasks, on_done):
        results = []
        for task in tasks:
            result = _run(task)
            results.append(result)
            # B20 Punkt 7: nicht erst die ganze (ggf. 38-minütige) Phase
            # rechnen und danach alle Fortschrittszeilen auf einmal schreiben.
            if on_done:
                on_done(result)
        return results

    @staticmethod
    def _complete_serial(tasks, results, on_done):
        for index, task in enumerate(tasks):
            if results[index] is not _MISSING:
                continue
            result = _run(task)
            results[index] = result
            if on_done:
                on_done(result)
        return list(results)

    def _switch_to_serial(self) -> None:
        pool, self.pool = self.pool, None
        self._serial = True
        if pool is not None:
            with suppress(Exception):
                pool.shutdown(wait=True, cancel_futures=True)
        _init(self.series_map, self.cfg, self.origin, self.cache_dir)


def run_tasks(
    tasks: list[tuple],
    series_map: dict,
    cfg,
    origin,
    workers: int = 1,
    on_done: Callable[[dict[str, Any]], None] | None = None,
    cache_dir=None,
    shared_draws: bool = True,
    model_kind: str = "ensemble",
) -> list[dict[str, Any]]:
    """Kompatibler Ein-Wellen-Aufruf; Refresh nutzt einen Pool für zwei Wellen.

    Rückgabe in der Reihenfolge von ``tasks``. ``cache_dir`` aktiviert den
    Tages-Cache des Backtests (B17); None = immer rechnen.
    """
    if not tasks:
        return []
    # Der Kompatibilitätsaufruf kennt nur diese eine Welle und kann enger
    # deckeln; Refresh hält dagegen Kapazität für die größere Folgewelle frei.
    effective_workers = min(max(1, int(workers)), len(tasks))
    with ModelTaskPool(
        series_map,
        cfg,
        origin,
        effective_workers,
        cache_dir,
        shared_draws,
        model_kind,
    ) as pool:
        return pool.run(tasks, on_done=on_done)
