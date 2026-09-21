"""Monotone PIT-Rekalibrierung für Bootstrap-Pfade (B2).

Die Engine erzeugt eine empirische Verteilung aus Tagesblock-Bootstrap-Pfaden.
Der B0-Backtest schreibt dazu für jeden tatsächlich beobachteten Punkt seinen
PIT-Mittelrang. Ist die Rohverteilung kalibriert, sind diese Werte gleichverteilt.

B2 lernt deshalb *nur* die empirische Verteilungsfunktion H der vergangenen,
strikt out-of-sample PIT-Werte. Für eine Rohverteilung F wird daraus
``F_kalibriert(y) = H(F(y))``. Zum Simulieren wird die inverse Abbildung auf die
Ränge der Bootstrap-Pfade angewandt. Das erhält die Rangordnung eines Pfads je
Zeitpunkt und lässt die Abhängigkeit innerhalb eines Tagesblocks nicht in
unabhängige Zufallszahlen zerfallen.

Wichtig: Eine Kandidatenkurve wird zeitlich getrennt geprüft. Sie wird nur
aktiviert, wenn der spätere Teil des Backtests die Quantil-Abdeckung nicht
verschlechtert. Eine unbekannte, zu kleine oder nicht bestandene Kurve bleibt
sichtbar unkalibriert; es gibt keinen stillen Fallback.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import numpy as np

CALIBRATION_SCHEMA_VERSION = 1
CALIBRATION_METHOD = "isotonic_pit_quantile_recalibration"
# 21 Backtest-Tage enthalten bei normalem 5-Minuten-Polling mehrere Tausend
# PIT-Werte. 500 ist absichtlich keine magische Freigabe: darunter sind die
# Flanken bei 2,5 % zu dünn (im Mittel nur 12,5 Beobachtungen).
MIN_PIT_SAMPLES = 500
# B2-Abnahme: Die 95%-Abdeckung darf im zeitlich späteren Holdout um maximal
# zwei Prozentpunkte fallen. Dieser Wert ist im Befund als Release-Gate genannt.
MAX_PICP_DEGRADATION = 0.02
# Ein Kalibrierungs-Plot ist erst dann aussagekräftig, wenn die Fehlergrenze
# die Stichprobengröße berücksichtigt. Die 2-pp-Untergrenze schützt zugleich
# die äußeren 2,5-%-Quantile vor einer scheinpräzisen 1/1000-Aussage.
MIN_COVERAGE_BAND = 0.02
# 0,25-pp-Stützen (401 Level) für die äußeren 2,5-%-Quantile: Bei 21 Tagen
# mit 5-Min-Polling haben 2,5 % nur ~12 Beobachtungen — 0,5-pp-Gitter
# quantisiert dort zu grob. 401 Punkte bleiben klein und sind für die
# Freigabe (MAX_PICP_DEGRADATION 2 pp) entscheidend.
PIT_LEVELS = tuple(float(value) for value in np.linspace(0.0, 1.0, 401))
QUANTILE_LEVELS = (0.025, 0.10, 0.50, 0.90, 0.975)


def _finite_pits(values: Any) -> np.ndarray:
    """Endliche PIT-Werte als flaches Array; kaputte Werte werden nie geklemmt."""
    try:
        pits = np.asarray(values, dtype=float).reshape(-1)
    except (TypeError, ValueError):
        return np.array([], dtype=float)
    return pits[np.isfinite(pits) & (pits >= 0.0) & (pits <= 1.0)]


def _isotonic_increasing(values: np.ndarray) -> np.ndarray:
    """Steigende PAVA-Projektion über die bewährte 12-Uhr-Implementierung.

    ``engine.models.isotonic_decreasing`` ist die getestete L2-PAVA. Durch
    Vorzeichenwechsel ist sie exakt dieselbe Projektion auf steigende Folgen.
    Der lokale Import verhindert einen Import-Zyklus: ``models`` verwendet die
    Kalibrierung erst in ``predict``.
    """
    from .models import isotonic_decreasing

    return -isotonic_decreasing(-np.asarray(values, dtype=float))


def empty_calibration(status: str = "not_available", **extra: Any) -> dict[str, Any]:
    """Eine vollständige, JSON-fähige Nicht-Kurve statt eines stillen ``None``."""
    return {
        "schema_version": CALIBRATION_SCHEMA_VERSION,
        "method": CALIBRATION_METHOD,
        "status": status,
        "n_pit": 0,
        "min_pit_samples": MIN_PIT_SAMPLES,
        "levels": [],
        "cdf": [],
        **extra,
    }


def fit_pit_calibration(
    pits: Any,
    *,
    min_samples: int = MIN_PIT_SAMPLES,
) -> dict[str, Any]:
    """Lernt H, die monotone CDF der B0-PIT-Werte.

    Die CDF wird auf einem festen 2,5-pp-Gitter gespeichert. Das Gitter macht
    Artefakte klein und reproduzierbar; PAVA auf der CDF ist im Idealfall ein
    No-op, schützt aber gegen künftig gewichtete/aggregierte PIT-Eingaben.
    """
    values = _finite_pits(pits)
    n = int(values.size)
    if n < int(min_samples):
        return empty_calibration(
            "insufficient_pit", n_pit=n, min_pit_samples=int(min_samples)
        )
    levels = np.asarray(PIT_LEVELS, dtype=float)
    empirical = np.asarray([(values <= level).mean() for level in levels], dtype=float)
    cdf = np.clip(_isotonic_increasing(empirical), 0.0, 1.0)
    # Die PAVA-Projektion darf numerisch keine Rückwärtsbewegung hinterlassen.
    cdf = np.maximum.accumulate(cdf)
    return {
        "schema_version": CALIBRATION_SCHEMA_VERSION,
        "method": CALIBRATION_METHOD,
        "status": "candidate",
        "n_pit": n,
        "min_pit_samples": int(min_samples),
        "levels": [round(float(value), 6) for value in levels],
        "cdf": [round(float(value), 6) for value in cdf],
    }


def valid_calibration(spec: Any) -> bool:
    """Strikte Prüfung einer gespeicherten Kurve vor jeder Anwendung."""
    if not isinstance(spec, dict):
        return False
    if spec.get("schema_version") != CALIBRATION_SCHEMA_VERSION:
        return False
    if spec.get("method") != CALIBRATION_METHOD:
        return False
    levels = np.asarray(spec.get("levels") or [], dtype=float)
    cdf = np.asarray(spec.get("cdf") or [], dtype=float)
    if levels.ndim != 1 or cdf.shape != levels.shape or len(levels) < 2:
        return False
    if not (np.isfinite(levels).all() and np.isfinite(cdf).all()):
        return False
    if levels[0] < 0 or levels[-1] > 1 or cdf[0] < 0 or cdf[-1] > 1:
        return False
    return bool(np.all(np.diff(levels) > 0) and np.all(np.diff(cdf) >= 0))


def calibrated_pit(pits: Any, spec: dict[str, Any]) -> np.ndarray:
    """PIT unter F_kalibriert: H(F_roh(y))."""
    values = np.asarray(pits, dtype=float)
    if not valid_calibration(spec):
        return values.copy()
    levels = np.asarray(spec["levels"], dtype=float)
    cdf = np.asarray(spec["cdf"], dtype=float)
    out = values.copy()
    finite = np.isfinite(values)
    out[finite] = np.interp(np.clip(values[finite], 0.0, 1.0), levels, cdf)
    return out


def _inverse_cdf(probabilities: np.ndarray, spec: dict[str, Any]) -> np.ndarray:
    """H⁻¹(p), mit wohldefiniertem Verhalten auf flachen empirischen Stufen."""
    levels = np.asarray(spec["levels"], dtype=float)
    cdf = np.asarray(spec["cdf"], dtype=float)
    # np.interp akzeptiert doppelte x nicht als echte Inverse. Auf einer
    # horizontalen CDF-Stufe ist das rechte Ende die konservative Wahl: Ein
    # kleiner kalibrierter Rang nutzt nie einen höheren Roh-Quantilrang.
    # Für jedes eindeutige CDF-Niveau die letzte Stütze nehmen.
    unique_cdf = np.unique(cdf)
    unique_levels = np.array(
        [levels[np.flatnonzero(cdf == value)[-1]] for value in unique_cdf]
    )
    return np.interp(np.clip(probabilities, 0.0, 1.0), unique_cdf, unique_levels)


def calibrate_paths(paths: Any, spec: dict[str, Any]) -> np.ndarray:
    """Rekalibriert Pfade spaltenweise ohne deren Rangkopplung zu zerstören.

    Pro Zeitpunkt wird ``Q_roh(H⁻¹(rang))`` auf den sortierten Pfad gelegt.
    Danach erhält jeder ursprüngliche Draw wieder seinen sortierten Rang. Damit
    bleiben komonotone Shared-Draws und die intraday Rangordnung erhalten;
    fehlende, ungestützte Punkte bleiben NaN.
    """
    values = np.asarray(paths, dtype=float)
    if values.ndim != 2:
        raise ValueError("calibrate_paths erwartet Pfade der Form (draws, points).")
    if not valid_calibration(spec):
        return values.copy()
    out = values.copy()
    for column in range(values.shape[1]):
        finite_index = np.flatnonzero(np.isfinite(values[:, column]))
        n = len(finite_index)
        if n < 2:
            continue
        ordered_index = finite_index[
            np.argsort(values[finite_index, column], kind="stable")
        ]
        ordered = values[ordered_index, column]
        calibrated_rank = (np.arange(n, dtype=float) + 0.5) / n
        raw_rank = _inverse_cdf(calibrated_rank, spec)
        source_rank = (np.arange(n, dtype=float) + 0.5) / n
        transformed = np.interp(raw_rank, source_rank, ordered)
        out[ordered_index, column] = transformed
    return out


def _coverage(values: np.ndarray) -> dict[str, float | None]:
    valid = _finite_pits(values)
    if not len(valid):
        return {f"{level:g}": None for level in QUANTILE_LEVELS}
    return {
        f"{level:g}": round(float(np.mean(valid <= level)), 4)
        for level in QUANTILE_LEVELS
    }


def _interval_95(values: np.ndarray) -> float | None:
    valid = _finite_pits(values)
    if not len(valid):
        return None
    return round(float(np.mean((valid > 0.025) & (valid <= 0.975))), 4)


def _coverage_band(level: float, n: int) -> tuple[float, float]:
    # Binomial 2-SE-Band plus dokumentierter 2-pp-Floor.
    radius = max(MIN_COVERAGE_BAND, 2.0 * float(np.sqrt(level * (1.0 - level) / n)))
    return max(0.0, level - radius), min(1.0, level + radius)


# M6: Abdeckungsbänder aus dem Tagesblock-Bootstrap (fester Samen) statt aus
# der Tick-Zahl. PIT-Ticks desselben Origins sind keine unabhängigen Ziehungen;
# ein Band aus n Ticks ist scheingenau, wenn es auf wenigen Tagen steht.
COVERAGE_BOOTSTRAP_SAMPLES = 1000
COVERAGE_BOOTSTRAP_SEED = 20260920


def _day_blocks(values: np.ndarray, origins: np.ndarray) -> list[np.ndarray]:
    grouped: dict[str, list[float]] = {}
    for origin, value in zip(origins, values):
        grouped.setdefault(str(origin), []).append(float(value))
    return [np.asarray(group, dtype=float) for group in grouped.values()]


def _effective_sample_size(blocks: list[np.ndarray]) -> float:
    """Kish-ESS über Tagesblöcke: (Σn_b)² / Σn_b² — effektive *Tage*.

    Gleich große Tage → ESS = Anzahl der Tage; dominiert ein einzelner
    Riesentag, bleibt die ESS nahe 1. Das ist die ehrliche unabhängige
    Stichprobe hinter den Abdeckungsbändern — die Tick-Zahl allein wäre
    scheingenau, weil Ticks desselben Tages geklumpt sind.
    """
    sizes = np.asarray([len(block) for block in blocks], dtype=float)
    total = float(sizes.sum())
    if total <= 0:
        return 0.0
    denominator = float((sizes**2).sum())
    return total * total / denominator if denominator > 0 else 0.0


def _coverage_bands_by_day(
    values: np.ndarray,
    origins: np.ndarray,
    samples: int = COVERAGE_BOOTSTRAP_SAMPLES,
    seed: int = COVERAGE_BOOTSTRAP_SEED,
) -> dict[str, list[float]]:
    """95-%-Band je Quantilslevel: Tagesblöcke mit Zurücklegen ziehen.

    Der 2-pp-Floor (``MIN_COVERAGE_BAND``) bleibt als Untergrenze der
    Bandbreite erhalten — identische Tage würden sonst ein degeneriert
    schmales Band ergeben, das jede Kurve durchwinkt.
    """
    blocks = _day_blocks(values, origins)
    if len(blocks) < 2:
        return {
            f"{level:g}": [round(lo, 4), round(hi, 4)]
            for level in QUANTILE_LEVELS
            for lo, hi in [_coverage_band(level, int(len(values)))]
        }
    rng = np.random.default_rng(seed)
    n_blocks = len(blocks)
    covers = np.empty((samples, len(QUANTILE_LEVELS)), dtype=float)
    for sample in range(samples):
        drawn = rng.integers(0, n_blocks, n_blocks)
        pooled = np.concatenate([blocks[index] for index in drawn])
        for column, level in enumerate(QUANTILE_LEVELS):
            covers[sample, column] = float(np.mean(pooled <= level))
    bands: dict[str, list[float]] = {}
    for column, level in enumerate(QUANTILE_LEVELS):
        lo = float(np.percentile(covers[:, column], 2.5))
        hi = float(np.percentile(covers[:, column], 97.5))
        lo = min(lo, level - MIN_COVERAGE_BAND)
        hi = max(hi, level + MIN_COVERAGE_BAND)
        bands[f"{level:g}"] = [round(max(0.0, lo), 4), round(min(1.0, hi), 4)]
    return bands


def assess_candidate(
    pits: Any,
    origins: Any = None,
    *,
    min_samples: int = MIN_PIT_SAMPLES,
) -> dict[str, Any]:
    """Zeitlich getrennte Kandidatenkurve inklusive 2-pp-PICP-Release-Gate.

    Bei vorhandenen Origins werden die früheren zwei Drittel zum Lernen und
    das letzte Drittel ausschließlich zur Abnahme verwendet. Ohne Origins
    bleibt die Kurve absichtlich abgelehnt: In-Sample-Verbesserung wäre kein
    Kalibrierungsnachweis.
    """
    values = _finite_pits(pits)
    if origins is None:
        return empty_calibration(
            "missing_temporal_split",
            n_pit=int(len(values)),
            min_pit_samples=int(min_samples),
        )
    raw_origins = np.asarray(origins, dtype=object).reshape(-1)
    try:
        raw_pits = np.asarray(pits, dtype=float).reshape(-1)
    except (TypeError, ValueError):
        raw_pits = np.array([], dtype=float)
    if len(raw_pits) != len(raw_origins):
        return empty_calibration(
            "invalid_pit_origins", min_pit_samples=int(min_samples)
        )
    usable = np.isfinite(raw_pits) & (raw_pits >= 0) & (raw_pits <= 1)
    usable &= np.asarray(
        [value is not None and str(value) != "" for value in raw_origins], dtype=bool
    )
    raw_pits = raw_pits[usable]
    ordered_origins = raw_origins[usable]
    if len(raw_pits) < 2 * int(min_samples):
        return empty_calibration(
            "insufficient_pit",
            n_pit=int(len(raw_pits)),
            min_pit_samples=int(min_samples),
        )
    order = np.argsort(
        np.asarray([str(value) for value in ordered_origins]), kind="stable"
    )
    ordered_pits = raw_pits[order]
    ordered_origins = ordered_origins[order]
    unique_origins = list(dict.fromkeys(str(value) for value in ordered_origins))
    split_count = max(1, int(len(unique_origins) * 2 / 3))
    if split_count >= len(unique_origins):
        return empty_calibration(
            "missing_temporal_split",
            n_pit=int(len(ordered_pits)),
            min_pit_samples=int(min_samples),
        )
    train_origins = set(unique_origins[:split_count])
    train_mask = np.asarray([str(value) in train_origins for value in ordered_origins])
    train = ordered_pits[train_mask]
    test = ordered_pits[~train_mask]
    test_origins = ordered_origins[~train_mask]
    candidate = fit_pit_calibration(train, min_samples=min_samples)
    if candidate["status"] != "candidate" or len(test) < int(min_samples):
        candidate["status"] = "insufficient_pit"
        candidate["n_test"] = int(len(test))
        return candidate
    calibrated = calibrated_pit(test, candidate)
    raw_coverage = _coverage(test)
    calibrated_coverage = _coverage(calibrated)
    # M6: Bänder aus Tagesblöcken, nicht aus Tick-Zahlen — plus die
    # effektive Stichprobengröße (Kish-ESS) der Holdout-Tage.
    test_blocks = _day_blocks(test, test_origins)
    ess_days = _effective_sample_size(test_blocks)
    target_bands = _coverage_bands_by_day(test, test_origins)
    target_ok = all(
        target_bands[key][0] <= calibrated_coverage[key] <= target_bands[key][1]
        for key in calibrated_coverage
        if calibrated_coverage[key] is not None
    )
    raw_picp = _interval_95(test)
    calibrated_picp = _interval_95(calibrated)
    picp_ok = (
        raw_picp is not None
        and calibrated_picp is not None
        and calibrated_picp >= raw_picp - MAX_PICP_DEGRADATION
    )
    candidate.update(
        {
            "n_pit": int(len(train)),
            "n_test": int(len(test)),
            "split": {
                "method": "earlier_two_thirds_train_later_one_third_holdout",
                "train_origins": int(len(train_origins)),
                "test_origins": int(len(unique_origins) - len(train_origins)),
            },
            "validation": {
                "raw_coverage": raw_coverage,
                "calibrated_coverage": calibrated_coverage,
                "target_bands": target_bands,
                # M6: Stichprobenstruktur des Holdouts — Tage, effektive
                # Tagesblock-Größe (Kish-ESS) und Bandmethode. „n_test
                # Ticks“ allein war scheingenau bei wenigen Tagen.
                "n_test_days": int(len(test_blocks)),
                "ess_day_blocks": round(float(ess_days), 1),
                "coverage_band_method": "day_block_bootstrap",
                "coverage_bootstrap_samples": int(COVERAGE_BOOTSTRAP_SAMPLES),
                "raw_picp95": raw_picp,
                "calibrated_picp95": calibrated_picp,
                "max_picp_degradation_pp": int(MAX_PICP_DEGRADATION * 100),
                "quantiles_in_target_band": bool(target_ok),
                "picp_release_gate": bool(picp_ok),
            },
        }
    )
    candidate["status"] = "accepted" if target_ok and picp_ok else "rejected_validation"
    return candidate


def _provenance_fingerprint(parts: dict[str, Any]) -> str:
    """Stabiler SHA-256 über die Aktivierungs-Herkunft (M6)."""
    payload = json.dumps(parts, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def calibration_envelope(
    candidate: Any,
    *,
    enabled: bool,
    model_kind: str,
    shared_draws: bool,
    day_pair: bool = True,
    activation_blocked: bool = False,
) -> dict[str, Any]:
    """Macht einen geprüften Backtest-Kandidaten zum Modell-Artefakt.

    Eine Kurve darf ausschließlich die Verteilung kalibrieren, aus der ihre
    PITs stammen. Modellkern, Shared-Draws **und Day-Pair-Modus** sind
    deshalb Provenienz, nicht Deko (M6): Ein Kandidat, der einen dieser
    Modi nicht ausweist oder abweicht, bleibt sichtbar unkalibriert — ein
    Moduswechsel entwertet alte Kurven nachweisbar statt still.

    Der Umschlag trägt außerdem einen Provenienz-Fingerabdruck über
    Modellkern, Verteilungsmodi, Horizontdefinition (24-h-Fenster am
    Vorlauf 0), Datenstand (``end_local``) und Regime-Referenz — dieselbe
    Kurve in anderer Herkunft bekommt einen anderen Fingerabdruck.
    """
    base = {
        "schema_version": CALIBRATION_SCHEMA_VERSION,
        "method": CALIBRATION_METHOD,
        "enabled": bool(enabled),
        "status": "not_available",
        "by_horizon": {},
        "model_kind": str(model_kind),
        "shared_draws": bool(shared_draws),
        "day_pair": bool(day_pair),
    }
    if not enabled:
        return {**base, "status": "disabled"}
    # Der Regime-Schutz wird im App-Orchestrator aus dem deklarierten
    # Kalender bestimmt. Selbst ein sauberer Kandidat der Vor-Regime-Welt darf
    # im Übergangsfenster nicht als aktuelle Kurve erscheinen.
    if activation_blocked:
        return {**base, "status": "regime_blackout"}
    if not isinstance(candidate, dict):
        return base
    # Die Veröffentlichung speichert mehrere Horizon-Kandidaten unter einem
    # Provenienz-Umschlag; ein einzelner API-Nutzer darf auch direkt eine
    # flache Kandidatenkurve übergeben.
    spec = candidate.get("24h") or candidate.get("by_horizon", {}).get("24h")
    status = candidate.get("status")
    if status is not None and status != "accepted":
        return {**base, "status": str(status)}
    if isinstance(spec, dict) and spec.get("status") != "accepted":
        return {**base, "status": str(spec.get("status") or "not_available")}
    # M6: Der Aktivierungsvertrag verlangt den ausgewiesenen Day-Pair-Modus.
    # Ein Kandidat ohne ``day_pair`` stammt aus dem Altvertrag und kann seine
    # Verteilungsherkunft nicht belegen — er aktiviert nichts mehr.
    if candidate.get("day_pair") is None:
        return {**base, "status": "model_mismatch"}
    if (
        candidate.get("model_kind") != str(model_kind)
        or bool(candidate.get("shared_draws")) != bool(shared_draws)
        or bool(candidate.get("day_pair")) != bool(day_pair)
    ):
        return {**base, "status": "model_mismatch"}
    if not valid_calibration(spec):
        return {**base, "status": "invalid_candidate"}
    provenance = {
        "model_kind": str(model_kind),
        "shared_draws": bool(shared_draws),
        "day_pair": bool(day_pair),
        # Horizontdefinition: live veröffentlichtes 24-h-Fenster am Vorlauf 0
        # (``DAILY_LEAD_HOURS``, engine/backtest.py) — Hüllenschlüssel ist die
        # Fensterlänge.
        "horizon": {"window_hours": 24, "lead_hours": 0},
        "end_local": candidate.get("end_local"),
        "regime_ref": candidate.get("regime_ref"),
        "n_pit": spec.get("n_pit"),
    }
    return {
        **base,
        "status": "active",
        "source_end_local": candidate.get("end_local"),
        "by_horizon": {"24h": spec},
        "provenance": {
            **provenance,
            "fingerprint": _provenance_fingerprint(provenance),
        },
    }


def calibration_for_hours(envelope: Any, hours: int) -> dict[str, Any] | None:
    """Aktive Kurve für einen Veröffentlichungshorizont (heute: 24 h)."""
    if not isinstance(envelope, dict) or envelope.get("status") != "active":
        return None
    spec = (envelope.get("by_horizon") or {}).get(f"{int(hours)}h")
    return spec if valid_calibration(spec) else None


def calibration_active(envelope: Any) -> bool:
    return calibration_for_hours(envelope, 24) is not None
