"""B2 — PIT-Rekalibrierung, Artefakt-Schema und Rechtsgarantie.

Die Tests prüfen nicht nur, dass eine Kurve gespeichert wird: Die Kurve lernt
zeitlich getrennt, hält ihre Rangkopplung und darf keine 12-Uhr-Regel aufheben.
"""

from __future__ import annotations

import numpy as np
import pytest

from engine.calibration import (
    assess_candidate,
    calibrate_paths,
    calibrated_pit,
    calibration_active,
    calibration_envelope,
    fit_pit_calibration,
    valid_calibration,
)
from engine.models import SCHEMA_VERSION, fit, predict, validate_model, with_calibration


def _skewed_pits(n: int = 1800) -> np.ndarray:
    # F(u)=sqrt(u): stark U-förmig unkalibriert, nach H(u) annähernd gleichverteilt.
    uniform = (np.arange(n, dtype=float) + 0.5) / n
    return uniform**2


def test_pit_curve_is_monotone_and_corrects_a_known_skew():
    raw = _skewed_pits()
    curve = fit_pit_calibration(raw, min_samples=100)
    assert curve["status"] == "candidate"
    assert valid_calibration(curve)
    assert np.all(np.diff(np.asarray(curve["cdf"])) >= 0)

    recalibrated = calibrated_pit(raw, curve)
    # Der Mittelwert einer Uniform(0, 1) ist 0,5; roh liegt er klar darunter.
    assert float(raw.mean()) < 0.4
    assert float(recalibrated.mean()) == pytest.approx(0.5, abs=0.015)


def test_paths_keep_rank_order_and_missing_support():
    curve = fit_pit_calibration(_skewed_pits(), min_samples=100)
    paths = np.array(
        [
            [1.00, 2.00, np.nan],
            [1.10, 2.10, np.nan],
            [1.20, 2.20, np.nan],
            [1.30, 2.30, np.nan],
        ]
    )
    got = calibrate_paths(paths, curve)
    assert np.isnan(got[:, 2]).all()
    # Jede Spalte bleibt in derselben Draw-Reihenfolge; die Kopplung der Draws
    # über die Zeit wird nicht durch ein unabhängiges Neu-Ziehen zerstört.
    assert np.all(np.diff(got[:, 0]) >= 0)
    assert np.all(np.diff(got[:, 1]) >= 0)
    assert not np.array_equal(got[:, 0], paths[:, 0])


def test_temporal_holdout_is_required_and_enforces_picp_release_gate():
    # Jeder Origin trägt dieselbe schiefe Verteilung; der Holdout prüft damit
    # die Kurve statt künstlich einen zeitlichen Regimewechsel zu erzeugen.
    pits = np.tile(_skewed_pits(100), 24)
    origins = np.repeat(
        [f"2026-08-{day:02d}T12:00:00+00:00" for day in range(1, 25)], 100
    )
    candidate = assess_candidate(pits, origins, min_samples=100)
    assert candidate["status"] == "accepted"
    assert candidate["validation"]["quantiles_in_target_band"] is True
    assert candidate["validation"]["picp_release_gate"] is True
    assert candidate["validation"]["calibrated_picp95"] >= (
        candidate["validation"]["raw_picp95"] - 0.02
    )
    assert (
        assess_candidate(pits, None, min_samples=100)["status"]
        == "missing_temporal_split"
    )


def test_envelope_refuses_other_model_distribution():
    pits = np.tile(_skewed_pits(100), 24)
    origins = np.repeat(
        [f"2026-08-{day:02d}T12:00:00+00:00" for day in range(1, 25)], 100
    )
    candidate = assess_candidate(pits, origins, min_samples=100)
    candidate = {
        "model_kind": "ensemble",
        "shared_draws": True,
        "day_pair": True,
        "24h": candidate,
    }
    active = calibration_envelope(
        candidate, enabled=True, model_kind="ensemble", shared_draws=True
    )
    assert active["status"] == "active" and calibration_active(active)
    mismatch = calibration_envelope(
        candidate, enabled=True, model_kind="harmonic_ar2", shared_draws=True
    )
    assert mismatch["status"] == "model_mismatch" and not calibration_active(mismatch)
    blackout = calibration_envelope(
        candidate,
        enabled=True,
        model_kind="ensemble",
        shared_draws=True,
        activation_blocked=True,
    )
    assert blackout["status"] == "regime_blackout" and not calibration_active(blackout)


def test_schema2_stays_uncalibrated_schema3_can_apply_curve(series, cfg):
    model = fit(series, "2026-08-01", cfg)
    assert model["schema_version"] == SCHEMA_VERSION == 3
    # Ein Schema-2-Artefakt der Vorgängerversion bleibt lesbar, aber nie aktiv.
    old = dict(model)
    old["schema_version"] = 2
    old.pop("calibration")
    old["calibrated"] = False
    validate_model(old)

    curve = fit_pit_calibration(_skewed_pits(), min_samples=100)
    envelope = {
        "schema_version": 1,
        "method": "isotonic_pit_quantile_recalibration",
        "enabled": True,
        "status": "active",
        "by_horizon": {"24h": curve},
    }
    calibrated = with_calibration(model, envelope)
    assert calibrated["calibrated"] is True
    frame, paths = predict(calibrated, 24, return_paths=True)
    assert frame.q50.notna().any()
    # Auch nach Rang-Rekalibrierung bleibt jeder Pfad an der Rechtsregel.
    local = frame.index.tz_convert(cfg.timezone)
    rises = np.diff(paths, axis=1)
    # Ein Anstieg ist nur zulässig, wenn der *zweite* Rasterpunkt 12:00 ist.
    allowed = np.asarray((local[1:].hour == 12) & (local[1:].minute == 0))
    illegal = rises[:, ~allowed]
    assert np.nanmax(illegal) <= 1e-10


def test_schema3_rejects_lie_about_calibration(series, cfg):
    model = fit(series, "2026-08-01", cfg)
    model["calibrated"] = True
    with pytest.raises(ValueError, match="inkonsistent"):
        validate_model(model)


def test_regime_blackout_blocks_activation_through_the_declared_cooldown(cfg):
    """B2 Termin-Gate: 01.10.–15.11. keine Kurve der Vor-Regime-Welt aktiv."""
    import pandas as pd

    from app.refresh import calibration_regime_blackout
    from engine.config import Config

    marked = Config(
        **{
            **cfg.to_dict(),
            "regimes": ({"announced_local": "2026-10-01T00:00"},),
        }
    )
    assert calibration_regime_blackout(
        pd.Timestamp("2026-10-01T10:00:00Z"), marked, "e10"
    )
    assert calibration_regime_blackout(
        pd.Timestamp("2026-11-15T20:00:00Z"), marked, "e10"
    )
    assert not calibration_regime_blackout(
        pd.Timestamp("2026-11-16T10:00:00Z"), marked, "e10"
    )


def _m6_candidate():
    pits = np.tile(_skewed_pits(100), 24)
    origins = np.repeat(
        [f"2026-08-{day:02d}T12:00:00+00:00" for day in range(1, 25)], 100
    )
    curve = assess_candidate(pits, origins, min_samples=100)
    assert curve["status"] == "accepted"
    return {
        "model_kind": "ensemble",
        "shared_draws": True,
        "day_pair": True,
        "end_local": "2026-08-24T00:00:00+02:00",
        "regime_ref": {"n_breaks": 0, "at_utc": []},
        "24h": curve,
    }


def test_envelope_contract_covers_day_pair_and_fingerprints_provenance():
    """M6: Der Aktivierungsvertrag nennt den Day-Pair-Modus; die Herkunft
    trägt einen Fingerabdruck über Kern, Modi, Horizont, Datenstand und
    Regime-Referenz."""
    candidate = _m6_candidate()
    active = calibration_envelope(
        candidate,
        enabled=True,
        model_kind="ensemble",
        shared_draws=True,
        day_pair=True,
    )
    assert active["status"] == "active" and calibration_active(active)
    provenance = active["provenance"]
    assert provenance["day_pair"] is True
    assert provenance["horizon"] == {"window_hours": 24, "lead_hours": 0}
    assert provenance["end_local"] == "2026-08-24T00:00:00+02:00"
    assert provenance["regime_ref"] == {"n_breaks": 0, "at_utc": []}
    fingerprint = provenance["fingerprint"]
    assert isinstance(fingerprint, str) and len(fingerprint) == 64

    # Dieselbe Herkunft → derselbe Fingerabdruck (deterministisch).
    again = calibration_envelope(
        dict(candidate),
        enabled=True,
        model_kind="ensemble",
        shared_draws=True,
        day_pair=True,
    )
    assert again["provenance"]["fingerprint"] == fingerprint

    # Anderer Datenstand → anderer Fingerabdruck.
    later = dict(candidate, end_local="2026-08-25T00:00:00+02:00")
    moved = calibration_envelope(
        later,
        enabled=True,
        model_kind="ensemble",
        shared_draws=True,
        day_pair=True,
    )
    assert moved["provenance"]["fingerprint"] != fingerprint


def test_changed_distribution_mode_invalidates_old_curves():
    """M6-Abnahme: Ein geänderter Modus entwertet alte Kurven nachweisbar.

    Ein Kandidat des Altvertrags (ohne ``day_pair``) kann seine
    Verteilungsherkunft nicht belegen — und ein Moduswechsel (Day-Pair
    aus statt an) aktiviert dieselbe Kurve nicht still weiter.
    """
    candidate = _m6_candidate()
    legacy = {key: value for key, value in candidate.items() if key != "day_pair"}
    old = calibration_envelope(
        legacy,
        enabled=True,
        model_kind="ensemble",
        shared_draws=True,
        day_pair=True,
    )
    assert old["status"] == "model_mismatch" and not calibration_active(old)

    switched = calibration_envelope(
        candidate,
        enabled=True,
        model_kind="ensemble",
        shared_draws=True,
        day_pair=False,
    )
    assert switched["status"] == "model_mismatch" and not calibration_active(switched)


def test_assess_reports_day_structure_and_effective_sample_size():
    """M6: Abdeckungsbänder kommen aus Tagesblöcken, und die effektive
    Stichprobengröße der Holdout-Tage wird sichtbar."""
    pits = np.tile(_skewed_pits(100), 24)
    origins = np.repeat(
        [f"2026-08-{day:02d}T12:00:00+00:00" for day in range(1, 25)], 100
    )
    candidate = assess_candidate(pits, origins, min_samples=100)
    validation = candidate["validation"]
    assert validation["coverage_band_method"] == "day_block_bootstrap"
    assert validation["coverage_bootstrap_samples"] == 1000
    assert candidate["split"]["test_origins"] == 8
    assert validation["n_test_days"] == 8
    # Gleich große Tage → Kish-ESS = Zahl der unabhängigen Tage (nicht die
    # Tick-Zahl: 800 Ticks auf 8 Tagen tragen wie 8 unabhängige Ziehungen).
    assert validation["ess_day_blocks"] == pytest.approx(8.0)
    # Bänder bleiben trotz identischer Tage durch den 2-pp-Floor ehrlich breit.
    for level, (lo, hi) in validation["target_bands"].items():
        assert hi - lo >= 0.04 - 1e-9, level
