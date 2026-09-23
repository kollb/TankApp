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

import base64
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

# Public horizon: quantiles plus local support evidence. The model already
# computes these counts; dropping them made a thin band look as certain as a
# richly observed slot (O10).
HORIZON_VALUE_COLUMNS = ("q025", "q10", "q50", "q90", "q975")
HORIZON_COLUMNS = ("timestamp", *HORIZON_VALUE_COLUMNS, "support_days", "supported")

# O22: Draw- und Nowcast-Preise erhalten 4 Nachkommastellen (0,01 ct/L), um
# die Publikation unter dem Leselimit zu halten. Die sichtbaren Horizont-
# Quantile folgen dagegen O10 und werden unten auf 0,1 ct/L gerundet.
PUBLICATION_DECIMALS = 4

# Befund 23.09.2026 (Runde 2, N1): Modell-Parameter, die die Labor-Karten
# „Modell & Parameter“ zeigen soll. Vor 0.68.1 lebten sie nur im Modell-
# Artefakt (``models-*.json``) — der Forecast-Payload trug sie nicht, und
# die Karten zeigten durchweg „Kein Beta-Vektor im Forecast-Payload“ /
# „Kein AR(2) im Payload“. Diese Felder sind Anzeige-Diagnose (klein,
# einige hundert Byte je Station), keine Prognosezahl.
MODEL_PARAMETER_FIELDS = (
    "beta",
    "ar_phi",
    "holiday_beta",
    "holiday_source",
    "law_floor",
    "law_floor_active",
    "pre_law_points_excluded",
    "law_rise_outside_noon",
    "ar_shrink_events",
    "ar_state_reset",
    "ar_detail",
    "ensemble",
)


def model_parameter_fields(model: dict[str, Any]) -> dict[str, Any]:
    """Modell-Parameter für die Veröffentlichung (eine Quelle, keine Kopien).

    Liest die Felder aus :data:`MODEL_PARAMETER_FIELDS` aus dem Fit und
    ergänzt ``bootstrap_samples`` aus der im Modell gespeicherten Config —
    die Karte „Bootstrap“ zeigt die echte Ziehungszahl, nicht eine
    festgenagelte 2000. ``app/refresh.py`` (NAS-Lauf) und
    ``ops/quality/demo_data.py`` (Demo-Stack) bauen die Zeile damit aus
    **demselben** Helfer, damit die Labor-Karten auf beiden Stacks dasselbe
    sehen (kein zweiter Pfad). Fehlende Felder (Alt-Artefakt) fehlen auch
    in der Rückgabe — Leser behandeln fehlende Felder wie ``null``.
    """
    fields: dict[str, Any] = {}
    for key in MODEL_PARAMETER_FIELDS:
        if key in model:
            fields[key] = model[key]
    config = model.get("config")
    if isinstance(config, dict) and "bootstrap_samples" in config:
        fields["bootstrap_samples"] = int(config["bootstrap_samples"])
    return fields


def _published(value):
    """Price publication precision (draw-related numeric fields remain 4 d.p.).

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


def _published_quantile(value):
    """Forecast bands at 0.1 ct/L precision, as promised by O10."""
    if value is None:
        return None
    number = float(value)
    if math.isnan(number):
        return number
    # 0.001 €/L = 0.1 ct/L. It saves output and avoids faux precision.
    return round(number, 3)


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
    model_kind: str = "profile_ar2",
    day_pair: bool = True,
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
    _STATE["day_pair"] = bool(day_pair)
    # A10/B3: Default seit 0.58.0 ist profile_ar2; ensemble bleibt Option.
    _STATE["model_kind"] = str(model_kind or "profile_ar2").strip().lower()


def _backtest(
    item,
    cfg,
    days: int,
    cache_dir,
    *,
    model_kind: str = "profile_ar2",
    shared_draws: bool = True,
    day_pair: bool = True,
) -> dict[str, Any]:
    """Backtest-Kennzahlen einer Station — aus dem Tages-Cache oder frisch.

    Rückgabe: die Payload-Felder (siehe app/backtest_cache.py::PAYLOAD_KEYS)
    plus ``backtest_cached`` und ``backtest_computed_at``. Ohne ``cache_dir``
    wird immer gerechnet (CLI, Tests).
    """
    from engine.backtest import (
        DAILY_LEAD_HOURS,
        last_complete_day,
        run_backtest,
        truncate_series,
    )
    from engine.calibration import assess_candidate
    from . import backtest_cache

    end_local = last_complete_day([item], cfg)
    cut = truncate_series(item, end_local.tz_convert("UTC"))
    key = None
    if cache_dir is not None:
        key = backtest_cache.fingerprint(
            cut,
            cfg,
            end_local,
            days,
            model_kind=model_kind,
            shared_draws=shared_draws,
            day_pair=day_pair,
        )
        hit = backtest_cache.load(cache_dir, cut, key)
        if hit is not None:
            return {
                **hit["payload"],
                "backtest_cached": True,
                "backtest_computed_at": hit["computed_at"],
            }
    report, rows = run_backtest(
        [cut],
        cfg,
        days=days,
        until=end_local,
        strict_end=True,
        kind=model_kind,
        shared_draws=shared_draws,
        day_pair=day_pair,
    )
    # B2: Der Kandidat lernt ausschließlich aus diesem streng vergangenen
    # Backtest. ``origin`` trennt das frühere Trainingsdrittel zeitlich vom
    # späteren Holdout; Regime-Fenster bleiben aus der Kurve heraus, statt den
    # Schock dauerhaft einzukalibrieren.
    if rows is None:
        # Einige schmale Test-/Betriebspfade liefern bewusst nur den Bericht;
        # fehlende Roh-PITs sind ein unkalibrierter Zustand, kein Job-Fehler.
        candidate_24h = assess_candidate([], [])
    else:
        calibration_rows = rows
        # M1: ``horizon_hours`` ist der **Vorlauf des Zieltags** (Stunden vom
        # Origin bis zum Fensterbeginn), nicht die Fensterlänge. Das live
        # veröffentlichte, 24-h-rekalibrierte Tagesfenster hat Vorlauf 0
        # (``DAILY_LEAD_HOURS``); die 72-/168-h-Fenster sind dieselben 24-h-
        # Fenster mit größerem Vorlauf und einer anderen Vorhersageverteilung
        # — sie dürfen die Tages-Kurve nicht kontaminieren. Vorher wurde hier
        # ``== 24`` selektiert (Fensterlänge statt Vorlauf), was genau null
        # Zeilen traf, weil der Produzent für das Tagesfenster 0 schreibt:
        # der NAS-Kandidat bekam ``insufficient_pit, n_pit=0`` (Befund M1).
        # Alte schmale Test-Reports ohne Horizontspalte bleiben lesbar.
        if len(calibration_rows) and "horizon_hours" in calibration_rows:
            calibration_rows = calibration_rows.loc[
                calibration_rows["horizon_hours"].astype(float)
                == float(DAILY_LEAD_HOURS)
            ]
        if len(calibration_rows) and "regime_break_spanned" in calibration_rows:
            calibration_rows = calibration_rows.loc[
                ~calibration_rows["regime_break_spanned"].astype(bool)
            ]
        candidate_24h = assess_candidate(
            calibration_rows.get("pit", []), calibration_rows.get("origin", [])
        )
    # M6: Regime-Referenz des Aktivierungsvertrags — welche deklarierten
    # Kanten im Kandidatenfenster lagen. Eine andere Regime-Welt teilt sich
    # damit nachweisbar nicht dieselbe Kurve (Provenienz-Fingerabdruck).
    regime_window = report.get("regime_breaks_in_window") or {}
    regime_entries = regime_window.get("in_window") or []
    regime_ref = {
        "n_breaks": int(regime_window.get("count") or 0),
        "at_utc": sorted(
            str(entry.get("at_utc"))
            for entry in regime_entries
            if isinstance(entry, dict) and entry.get("at_utc")
        ),
    }
    calibration_candidate = {
        "schema_version": 1,
        "method": "isotonic_pit_quantile_recalibration",
        "end_local": end_local.isoformat(),
        "model_kind": model_kind,
        "shared_draws": bool(shared_draws),
        "day_pair": bool(day_pair),
        "regime_ref": regime_ref,
        # M1: Der Hüllen-Schlüssel ``24h`` ist die *Fensterlänge* der live
        # veröffentlichten Tagesprognose (Vorlauf 0). Er ist bewusst nicht der
        # Vorlauf: ``engine.calibration.calibration_for_hours`` schlägt die
        # Kurve zur Prognose-Fensterlänge nach (predict(hours=24)), während
        # ``horizon_hours`` in den Backtest-Zeilen der Vorlauf ist.
        "24h": candidate_24h,
    }
    # Rolling-PICP 7 d (Konzept §3.3.3): nur der eigene Eintrag — das
    # Güte-Gate in /v1/decide braucht die aktuelle Zahl der ausgewählten
    # Station, nicht die aller anderen.
    rolling = report.get("rolling_picp_7d") or []
    pit_stations = (report.get("pit") or {}).get("stations") or []
    payload = {
        "metrics": report.get("metrics"),
        "decision_rows": list(report.get("decision", {}).get("rows", [])),
        "decision_hour": report.get("decision", {}).get("decision_hour", 12),
        "rolling_picp_7d": rolling[0] if rolling else None,
        "horizons": report.get("horizons") or {},
        # H5: Zeitumstellung im Prüfzeitraum — die GUI erklärt damit ein
        # „nicht bestimmbar“ und zeigt die betroffenen Tage.
        "dst": report.get("dst"),
        # B0: PIT-Histogramme der eigenen Station (je Horizont, all/
        # break_free), Regime-Kanten im Fenster, AR(2)-Stauchungen und das
        # gemessene Punktmodell — Messgrundlagen für B2, keine Anzeige-Pflicht.
        "pit": pit_stations[0] if pit_stations else None,
        "regime_breaks_in_window": report.get("regime_breaks_in_window"),
        "ar_shrink": report.get("ar_shrink"),
        "model_kind": report.get("model_kind"),
        "shared_draws": report.get("shared_draws"),
        "day_pair": report.get("day_pair"),
        "calibration_candidate": calibration_candidate,
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
    """Serialize public horizon quantiles and support evidence without a frame copy.

    Bands use :func:`_published_quantile` at 0.1 ct/L (O10); draw prices stay
    separately compact at four decimals for the O22 publication budget.
    """
    values = frame.loc[:, HORIZON_VALUE_COLUMNS].itertuples(index=False, name=None)
    supports = frame.get("support_days")
    supported = frame.get("supported")
    records = []
    for position, (stamp, row) in enumerate(zip(frame.index, values)):
        support_days = None
        if supports is not None:
            try:
                parsed = float(supports.iloc[position])
                support_days = (
                    int(parsed) if math.isfinite(parsed) and parsed >= 0 else None
                )
            except (TypeError, ValueError):
                pass
        supported_value = None
        if supported is not None:
            raw = supported.iloc[position]
            try:
                # Pandas NA has no truth value and float NaN must not turn
                # into True merely because bool(nan) is truthy.
                supported_value = (
                    bool(raw)
                    if raw is not None
                    and not (isinstance(raw, float) and math.isnan(raw))
                    else None
                )
            except (TypeError, ValueError):
                supported_value = None
        record = dict(
            zip(
                ("timestamp", *HORIZON_VALUE_COLUMNS),
                (stamp.isoformat(), *(_published_quantile(value) for value in row)),
            )
        )
        # Compatibility/size: synthetic and historic frames without support
        # columns keep the compact old payload. Real predict() frames have
        # both columns and always publish the O10 provenance together.
        if supports is not None or supported is not None:
            record["support_days"] = support_days
            record["supported"] = supported_value
        records.append(record)
    return records


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
    import numpy as np
    import pandas as pd

    n = min(DECISION_DRAWS, paths.shape[0])
    ids = block_ids(index, cfg.timezone, BLOCK_MINUTES)
    starts = block_starts(index, cfg.timezone, BLOCK_MINUTES)
    minima = block_minima(paths[:n], ids)
    blocks = []
    for position, stamp in enumerate(starts):
        # The next canonical start is the real end. On a DST transition this
        # is not necessarily start + 120 UTC minutes (the repeated hour must
        # not overlap its neighbour). The last block uses the nominal local
        # block duration as a safe horizon edge.
        end = (
            starts[position + 1]
            if position + 1 < len(starts)
            else stamp + pd.Timedelta(minutes=BLOCK_MINUTES)
        )
        blocks.append({"start": stamp.isoformat(), "end": end.isoformat()})
    # O22: Auch die Draws sind Preise — dieselbe Veröffentlichungs-Präzision
    # wie die Quantile. Die Fenster-Minima sind die größte einzelne Zahlengruppe
    # der Veröffentlichung (500 Draws × 84 Blöcke je Station).
    minima_rows = [[_published(v) for v in row] for row in minima.tolist()]
    nowcast_row = [_published(v) for v in nowcast_draws(paths[:n]).tolist()]
    # A21-B4.2: the first forecast block is the only block that can be
    # partially consumed by the next API request. Publish exact suffix minima
    # for it instead of reusing a whole-block minimum after ``now``. Keeping
    # this artifact to the origin block preserves the publication budget; later
    # blocks are either whole or explicitly reported as lacking partial draw
    # evidence until the next model run.
    suffix = None
    if n and len(index) and len(ids):
        first_block = int(ids[0])
        positions = np.flatnonzero(ids == first_block)
        # The first sample is the block minimum already published in
        # ``minima``. Suffixes start at the next sample; this saves a duplicate
        # column and is exactly the range that can be visible after a request
        # clock reaches the forecast origin.
        suffix_positions = positions[1:]
        values = np.full((n, len(suffix_positions)), np.nan)
        with np.errstate(all="ignore"):
            for offset in range(len(suffix_positions) - 1, -1, -1):
                segment = paths[:n, suffix_positions[offset:]]
                safe = np.where(np.isfinite(segment), segment, np.inf)
                minimum = safe.min(axis=1)
                values[:, offset] = np.where(np.isfinite(minimum), minimum, np.nan)
        # A JSON matrix costs too much at 500 draws × 2 h. The public whole
        # block minimum is the base; each suffix value is a non-negative
        # 0.0001 EUR/L delta encoded as uint16.  65535 means no finite path.
        deltas = np.full((n, len(suffix_positions)), 65535, dtype="<u2")
        for draw in range(n):
            base = minima_rows[draw][first_block]
            if not isinstance(base, (int, float)) or not math.isfinite(base):
                continue
            for offset, value in enumerate(values[draw]):
                if math.isfinite(float(value)):
                    delta = int(round((_published(value) - base) * 10000))
                    if 0 <= delta < 65535:
                        deltas[draw, offset] = delta
        suffix = {
            "block": first_block,
            "starts": [index[position].isoformat() for position in suffix_positions],
            "rows": n,
            "columns": len(suffix_positions),
            "encoding": "uint16_delta_1e4_from_block_minimum",
            "missing": 65535,
            "minima_b64": base64.b64encode(deltas.tobytes()).decode("ascii"),
        }
    return {
        "n": n,
        "block_minutes": BLOCK_MINUTES,
        "blocks": blocks,
        "minima": minima_rows,
        "nowcast": nowcast_row,
        "suffix_minima": suffix,
        # A11: gemeinsame Ziehung über Stationen (Konzept §4.2). False =
        # unabhängige Ziehung (Stand vor 0.31.0) — dann ist P_lohnt zu
        # selbstsicher, weil der Marktgleichlauf herausfällt.
        "shared": bool(shared),
    }


def _run(task: tuple) -> dict[str, Any]:
    """Eine Aufgabe: kind = 'fit' | 'wide' | 'backtest'."""
    kind, key, hours, *task_extra = task
    # B2: Eine bereits im vorherigen Backtest abgenommene Kurve ist
    # stationsspezifisch; sie darf nicht als globaler Worker-Zustand enden.
    calibration = task_extra[0] if task_extra else None
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
                    model_kind=str(_STATE.get("model_kind") or "profile_ar2"),
                    shared_draws=bool(_STATE.get("shared_draws", True)),
                    day_pair=bool(_STATE.get("day_pair", True)),
                ),
            )
            return out
        model = fit(item, origin, cfg)
        if calibration is not None:
            from engine.models import with_calibration

            model = with_calibration(model, calibration)
        shared = bool(_STATE.get("shared_draws", True))
        # Achtung: nicht „kind“ heißen — das ist die Aufgabenart.
        model_kind = str(_STATE.get("model_kind") or "profile_ar2")
        # B0: PAVA-Pool-Statistik nur für die publizierte 24-h-Prognose —
        # ein Wörterbuch, das predict() füllt; ohne es keine Mehrarbeit.
        diagnostics: dict[str, Any] | None = {} if kind == "fit" else None
        frame, paths = predict(
            model,
            hours=hours,
            return_paths=True,
            shared_draws=shared,
            day_pair=bool(_STATE.get("day_pair", True)),
            kind=model_kind,
            diagnostics=diagnostics,
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
            out["pava_pool_stats"] = (diagnostics or {}).get("pava_pool_stats")
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
        model_kind: str = "profile_ar2",
        day_pair: bool = True,
    ) -> None:
        self.series_map = _slim_series_map(series_map)
        self.cfg = cfg
        self.origin = origin
        self.cache_dir = cache_dir
        self.shared_draws = bool(shared_draws)
        self.day_pair = bool(day_pair)
        self.model_kind = str(model_kind or "profile_ar2").strip().lower()
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
            self.day_pair,
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
                        self.day_pair,
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
        _init(
            self.series_map,
            self.cfg,
            self.origin,
            self.cache_dir,
            self.shared_draws,
            self.model_kind,
            self.day_pair,
        )


def run_tasks(
    tasks: list[tuple],
    series_map: dict,
    cfg,
    origin,
    workers: int = 1,
    on_done: Callable[[dict[str, Any]], None] | None = None,
    cache_dir=None,
    shared_draws: bool = True,
    model_kind: str = "profile_ar2",
    day_pair: bool = True,
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
        day_pair,
    ) as pool:
        return pool.run(tasks, on_done=on_done)
