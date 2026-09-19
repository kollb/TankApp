"""B0 — Zähler im Modell-Artefakt (Befund Teil 4, B0).

Drei Dinge geschahen vor 0.56.0 stumm und stehen jetzt im Artefakt:

* die ×0,9-Stauchung der AR(2)-Koeffizienten (``ar_shrink_events``,
  ``ar_detail`` je Kern samt Rückfallgrund und Wurzelradius),
* der Zustands-Reset am Cutoff (``ar_state_reset``: Lücke direkt vor dem
  Origin → AR startet bei 0),
* die Streuung der Ensemble-Gewichte über das Validierungsfenster
  (``ensemble.weight_spread``) und die PAVA-Pools der 12-Uhr-Projektion
  (``predict(..., diagnostics=…)`` → ``pava_pool_stats``).

Die Prognose selbst bleibt bitgleich — das prüft ``test_b0_invariance.py``;
hier geht es darum, dass die Zähler das Richtige zählen.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from engine.data import normalize_observations, prepare_series
from engine.models import (
    AR_SHRINK_MAX_STEPS,
    AR_STABILITY_RADIUS,
    ensemble_weight_spread,
    fit,
    fit_ar2,
    fit_ar2_detail,
    pool_summary,
    predict,
    validate_model,
)
from engine.storage import json_safe


def _radius(phi) -> float:
    return float(np.max(np.abs(np.roots([1, -phi[0], -phi[1]]))))


# --- fit_ar2_detail ---------------------------------------------------------


def test_stabiler_fit_zaehlt_null_stauchungen():
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 1, 3000)
    residual = np.empty_like(noise)
    residual[0], residual[1] = noise[0], noise[1]
    for t in range(2, len(noise)):
        residual[t] = 0.5 * residual[t - 1] - 0.2 * residual[t - 2] + noise[t]
    phi, detail = fit_ar2_detail(residual)
    assert detail["shrink_events"] == 0
    assert detail["fallback"] is None
    assert detail["triples"] == len(residual) - 2
    assert detail["root_radius_raw"] == pytest.approx(detail["root_radius"])
    assert detail["root_radius"] < AR_STABILITY_RADIUS
    assert phi == pytest.approx([0.5, -0.2], abs=0.05)


def test_random_walk_loest_die_stauchung_aus_und_wird_gezaehlt():
    rng = np.random.default_rng(1)
    walk = np.cumsum(rng.normal(0, 1, 2000))
    phi, detail = fit_ar2_detail(walk)
    assert detail["shrink_events"] >= 1
    assert detail["fallback"] is None
    assert detail["root_radius_raw"] >= AR_STABILITY_RADIUS
    assert detail["root_radius"] < AR_STABILITY_RADIUS
    assert _radius(phi) == pytest.approx(detail["root_radius"])
    # Die Zahl der Schritte ist nachrechenbar: radius_raw · 0,9^k < 0,98.
    assert detail["root_radius_raw"] * 0.9 ** detail["shrink_events"] < 0.98
    assert (
        detail["root_radius_raw"] * 0.9 ** (detail["shrink_events"] - 1)
        >= AR_STABILITY_RADIUS
    )


@pytest.mark.parametrize(
    "residual, fallback, triples",
    [
        (np.array([1.0, 2.0]), "too_few_points", 0),
        (np.where(np.arange(100) % 2 == 0, 1.0, np.nan), "too_few_triples", 0),
        (np.zeros(100), "zero_variance", 98),
    ],
)
def test_rueckfaelle_nennen_ihren_grund(residual, fallback, triples):
    phi, detail = fit_ar2_detail(residual)
    assert phi.tolist() == [0.0, 0.0]
    assert detail["fallback"] == fallback
    assert detail["triples"] == triples
    assert detail["shrink_events"] == 0
    assert detail["root_radius"] is None


def test_nicht_stabilisierbar_meldet_maximale_schritte(monkeypatch):
    """Wenn selbst 100 Stauchungen nicht reichen, fällt der Fit auf 0 zurück —
    und sagt es. (Erzwungen über einen Radius, der nie unterschritten wird.)"""
    import engine.models as models

    monkeypatch.setattr(models, "AR_STABILITY_RADIUS", 0.0)
    rng = np.random.default_rng(3)
    phi, detail = fit_ar2_detail(rng.normal(0, 1, 500))
    assert phi.tolist() == [0.0, 0.0]
    assert detail["fallback"] == "not_stabilised"
    assert detail["shrink_events"] == AR_SHRINK_MAX_STEPS


def test_fit_ar2_bleibt_die_alte_signatur():
    rng = np.random.default_rng(1)
    walk = np.cumsum(rng.normal(0, 1, 2000))
    assert fit_ar2(walk).tolist() == fit_ar2_detail(walk)[0].tolist()


# --- Artefakt -----------------------------------------------------------------


def test_artefakt_traegt_die_zaehler(series, cfg):
    model = fit(series, "2026-08-01", cfg)
    assert (
        model["ar_shrink_events"] == model["ar_detail"]["harmonic_ar2"]["shrink_events"]
    )
    assert model["ar_state_reset"] is False
    for kernel in ("harmonic_ar2", "profile_ar2"):
        detail = model["ar_detail"][kernel]
        assert set(detail) >= {
            "shrink_events",
            "fallback",
            "triples",
            "root_radius_raw",
            "root_radius",
            "state_reset",
        }
        assert detail["triples"] > 0
    # Die Diagnose ist JSON-fähig und stört die Artefakt-Prüfung nicht.
    safe = json_safe(model)
    validate_model(safe)
    assert safe["ar_detail"]["profile_ar2"]["state_reset"] is False


def test_altes_artefakt_ohne_zaehler_bleibt_gueltig(series, cfg):
    model = json_safe(fit(series, "2026-08-01", cfg))
    for key in ("ar_shrink_events", "ar_state_reset", "ar_detail"):
        model.pop(key)
    validate_model(model)
    frame = predict(model, 24)
    assert frame.q50.notna().any()


def test_luecke_vor_dem_cutoff_setzt_den_zustand_zurueck(observations, cfg):
    """Fehlen die letzten beiden Residuen (Schließung direkt vor dem Origin),
    startet AR(2) bei 0 — bisher stumm, jetzt ``ar_state_reset``."""
    raw = observations()
    stamps = pd.to_datetime(raw.timestamp, utc=True)
    cutoff = pd.Timestamp("2026-08-01", tz="Europe/Berlin").tz_convert("UTC")
    gap = stamps >= cutoff - pd.Timedelta(hours=2)
    raw = raw.loc[~(gap & (stamps < cutoff))]
    normalized, _ = normalize_observations(raw, cfg)
    series = prepare_series(normalized, cfg)[0]
    model = fit(series, "2026-08-01", cfg)
    assert model["ar_state_reset"] is True
    assert model["ar_state"].tolist() == [0.0, 0.0]
    assert model["ar_detail"]["harmonic_ar2"]["state_reset"] is True
    assert model["ar_detail"]["profile_ar2"]["state_reset"] is True


# --- Ensemble-Gewichtsstreuung ------------------------------------------------


def test_weight_spread_im_artefakt(series, cfg):
    model = fit(series, "2026-08-01", cfg)
    spread = model["ensemble"]["weight_spread"]
    assert spread["block_slots"] == 288
    assert 1 <= spread["blocks"] <= 14
    assert len(spread["harmonic_per_block"]) == spread["blocks"]
    assert all(0.0 <= w <= 1.0 for w in spread["harmonic_per_block"])
    assert spread["min"] <= spread["max"]
    assert spread["range"] == pytest.approx(spread["max"] - spread["min"], abs=1e-4)
    assert sum(spread["blocks_favouring"].values()) == spread["blocks"]
    # Das veröffentlichte Gesamtgewicht liegt in der Spanne der Blöcke.
    assert spread["min"] - 0.05 <= model["ensemble"]["weights"]["harmonic_ar2"]
    assert model["ensemble"]["weights"]["harmonic_ar2"] <= spread["max"] + 0.05


def test_weight_spread_rechnet_je_block():
    n = 3 * 288
    idx = np.arange(288, n)
    err_h = np.full(len(idx), 1.0)
    err_p = np.full(len(idx), 1.0)
    # Block 0 (letzter Tag): Harmonik doppelt so gut; Block 1: Profil besser.
    block = (n - 1 - idx) // 288
    err_h[block == 0] = 0.5
    err_p[block == 1] = 0.25
    naive = np.full(len(idx), 2.0)
    usable = np.ones(len(idx), dtype=bool)
    spread = ensemble_weight_spread(idx, n, err_h, err_p, naive, usable)
    assert spread["blocks"] == 2
    # ältester Block zuerst: Profil besser (w_h = 0,2), dann Harmonik (0,667)
    assert spread["harmonic_per_block"] == pytest.approx([0.2, 0.6667], abs=1e-4)
    assert spread["blocks_favouring"] == {"harmonic_ar2": 1, "profile_ar2": 1, "tie": 0}
    assert spread["range"] == pytest.approx(0.4667, abs=1e-4)


def test_weight_spread_ohne_brauchbare_punkte():
    spread = ensemble_weight_spread(
        np.arange(288, 600),
        600,
        np.full(312, np.nan),
        np.full(312, np.nan),
        np.full(312, 1.0),
        np.ones(312, dtype=bool),
    )
    assert spread["blocks"] == 0
    assert spread["std"] is None
    assert spread["harmonic_per_block"] == []


# --- PAVA-Pools -----------------------------------------------------------------


def test_pool_summary_zaehlt_verschmolzene_laeufe():
    original = np.array([5.0, 4.0, 4.5, 4.5, 3.0, 2.0, 2.0, 2.5])
    projected = np.array([5.0, 4.3333, 4.3333, 4.3333, 3.0, 2.1667, 2.1667, 2.1667])
    summary = pool_summary(original, projected)
    assert summary["pools"] == 2
    assert summary["pooled_points"] == 6
    assert summary["max_pool_size"] == 3
    assert summary["max_shift_ct"] == pytest.approx(33.33, abs=0.01)


def test_pool_summary_ohne_aenderung_und_mit_nan():
    flat = np.array([3.0, 3.0, np.nan, 2.0, 1.0])
    assert pool_summary(flat, flat) == {
        "pools": 0,
        "pooled_points": 0,
        "max_pool_size": 0,
        "max_shift_ct": 0.0,
    }
    # Gleiche Nachbarn im Original sind kein Pool — erst eine Änderung zählt.
    original = np.array([1.0, 1.0, 2.0, np.nan, 0.5])
    projected = np.array([1.3333, 1.3333, 1.3333, np.nan, 0.5])
    summary = pool_summary(original, projected)
    assert summary["pools"] == 1 and summary["pooled_points"] == 3


def test_predict_liefert_pool_statistik_nur_auf_wunsch(series, cfg):
    model = fit(series, "2026-08-01", cfg)
    diagnostics: dict = {}
    frame = predict(
        model, 48, kind="ensemble", shared_draws=True, diagnostics=diagnostics
    )
    stats = diagnostics["pava_pool_stats"]
    # 48 h ab Mitternacht: Segmente 12:00 Vortag, 12:00 Tag 1, 12:00 Tag 2.
    assert stats["law_segments"] == 3
    assert len(stats["segments"]) == 3
    first = stats["segments"][0]
    assert set(first) == {
        "segment_start_local",
        "points",
        "harmonic_ar2",
        "profile_ar2",
        "paths",
        "quantiles_points_changed",
    }
    assert first["paths"]["paths"] == cfg.bootstrap_samples
    assert 0.0 <= first["paths"]["paths_changed_fraction"] <= 1.0
    totals = stats["totals"]
    assert totals["harmonic_ar2"]["pools"] == sum(
        segment["harmonic_ar2"]["pools"] for segment in stats["segments"]
    )
    assert set(totals["quantiles_points_changed"]) == {
        "q025",
        "q10",
        "q50",
        "q90",
        "q975",
    }
    # Die synthetische Reihe steigt nachmittags — die Projektion greift
    # sichtbar ein (sonst wäre der Zähler wertlos).
    assert totals["harmonic_ar2"]["pooled_points"] > 0
    assert totals["harmonic_ar2"]["max_shift_ct"] > 0
    # Ohne Wörterbuch: nichts wird angelegt, Ergebnis identisch.
    plain = predict(model, 48, kind="ensemble", shared_draws=True)
    pd.testing.assert_frame_equal(plain, frame)
    assert json_safe(stats) == stats
