"""B0 — Messgrundlagen: die Prognose bleibt bitgleich.

Der Befund (BEFUND-UX-MATH-2026-09-19.md, Teil 4, B0) verlangt Zähler,
PIT-Paare und Regime-Marker **ohne** eine einzige Prognosezahl zu ändern.
Ein Versprechen dieser Art ist nur mit einem Referenzwert prüfbar, der *vor*
dem Umbau festgehalten wurde: `tests/fixtures/b0_invariance.json` wurde am
Stand `dacea676` (0.55.2, vor jeder B0-Änderung) aus genau der synthetischen
Reihe aus `conftest.py` erzeugt — Fit-Parameter, Vorhersage-Quantile aller
drei Kerne (mit und ohne gemeinsame Züge) und die Backtest-Kennzahlen.

Die Toleranzen sind bewusst eng (1e-8 für Modellparameter, 1e-5 €/L für
Quantile, relativ 1e-7 für Kennzahlen): Sie lassen Rundungsrauschen der
BLAS-Bibliothek zwischen Python-/NumPy-Versionen durch, aber keine Logik-
Änderung — schon ein anderes Bootstrap-Los oder eine verschobene PAVA-Pool-
Grenze ändert Quantile um 1e-4 und mehr.

Wer die Prognose *absichtlich* ändert (B2/B3), muss diese Fixture bewusst
neu erzeugen — und das im CHANGELOG sagen. Das ist der Zweck.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from engine.backtest import run_backtest
from engine.models import fit, predict

FIXTURE = Path(__file__).parent / "fixtures" / "b0_invariance.json"
QUANTILE_ATOL = 1e-5
PARAM_ATOL = 1e-8
METRIC_RTOL = 1e-7


@pytest.fixture(scope="module")
def golden() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture
def model(series, cfg):
    return fit(series, "2026-08-01", cfg)


def _close(actual, expected, *, atol=0.0, rtol=0.0) -> None:
    got = np.asarray(actual, dtype=float).ravel()
    want = np.asarray(
        [np.nan if v is None else v for v in np.atleast_1d(expected)], dtype=float
    )
    assert got.shape == want.shape, (got.shape, want.shape)
    both_nan = np.isnan(got) & np.isnan(want)
    assert np.array_equal(np.isnan(got), np.isnan(want)), "NaN-Muster weicht ab"
    ok = both_nan | np.isclose(got, want, atol=atol, rtol=rtol, equal_nan=True)
    if not ok.all():
        idx = int(np.argmax(~ok))
        raise AssertionError(
            f"Abweichung an Position {idx}: {got[idx]!r} statt {want[idx]!r}"
        )


def test_fit_parameter_sind_unveraendert(model, golden):
    want = golden["fit"]
    _close(model["beta"], want["beta"], atol=PARAM_ATOL)
    _close(model["ar_phi"], want["ar_phi"], atol=PARAM_ATOL)
    _close(model["profile_phi"], want["profile_phi"], atol=PARAM_ATOL)
    _close(model["ar_state"], want["ar_state"], atol=PARAM_ATOL)
    assert model["holiday_beta"] == pytest.approx(want["holiday_beta"], abs=1e-9)
    assert model["mase_scale"] == pytest.approx(want["mase_scale"], abs=1e-9)
    assert model["ensemble"]["weights"] == want["ensemble_weights"]
    assert model["ensemble"]["mase"] == pytest.approx(want["ensemble_mase"], rel=1e-9)
    assert float(np.nansum(model["residual_blocks"])) == pytest.approx(
        want["residual_blocks_sum"], abs=1e-5
    )
    assert float(np.nansum(model["profile_level"])) == pytest.approx(
        want["profile_level_sum"], abs=1e-5
    )


@pytest.mark.parametrize("kind", ["harmonic_ar2", "profile_ar2", "ensemble"])
@pytest.mark.parametrize("shared", [False, True])
def test_vorhersage_quantile_sind_unveraendert(model, golden, kind, shared):
    want = golden["predict"][f"{kind}/shared={int(shared)}"]
    frame, paths = predict(model, 24, return_paths=True, shared_draws=shared, kind=kind)
    for col in ("q025", "q10", "q50", "q90", "q975", "ensemble"):
        _close(frame[col].to_numpy(), want[col], atol=QUANTILE_ATOL)
    assert int(frame.supported.sum()) == want["supported"]
    # Die Pfade selbst: eine Summe über 100 × 288 Werte — jede andere Ziehung
    # verschiebt sie um Größenordnungen mehr als die Toleranz.
    assert float(np.nansum(paths)) == pytest.approx(want["paths_nansum"], abs=1e-2)


def test_vorhersage_ohne_diagnose_gleich_mit_diagnose(model, golden):
    """Das Diagnose-Wörterbuch (PAVA-Pools) darf die Zahlen nicht anfassen."""
    want = golden["predict"]["ensemble/shared=1"]
    diagnostics: dict = {}
    frame = predict(
        model, 24, shared_draws=True, kind="ensemble", diagnostics=diagnostics
    )
    _close(frame["q50"].to_numpy(), want["q50"], atol=QUANTILE_ATOL)
    _close(frame["q975"].to_numpy(), want["q975"], atol=QUANTILE_ATOL)
    assert "pava_pool_stats" in diagnostics


def test_72h_vorhersage_ist_unveraendert(model, golden):
    frame = predict(model, 72, kind="ensemble", shared_draws=True)
    _close(
        frame["q50"].to_numpy(),
        golden["predict"]["ensemble/72h/q50"],
        atol=QUANTILE_ATOL,
    )
    _close(
        frame["q975"].to_numpy(),
        golden["predict"]["ensemble/72h/q975"],
        atol=QUANTILE_ATOL,
    )


def _assert_metrics_equal(actual: dict, expected: dict) -> None:
    assert set(actual) >= set(expected), sorted(set(expected) - set(actual))
    for key, value in expected.items():
        if isinstance(value, dict):
            _assert_metrics_equal(actual[key], value)
        elif isinstance(value, float):
            assert actual[key] == pytest.approx(value, rel=METRIC_RTOL, abs=1e-9), key
        else:
            assert actual[key] == value, key


def test_backtest_kennzahlen_sind_unveraendert(series, cfg, golden):
    report, rows = run_backtest(
        [series],
        cfg,
        days=2,
        until="2026-08-01",
        kind="harmonic_ar2",
        shared_draws=False,
        day_pair=False,
    )
    want = golden["backtest"]
    _assert_metrics_equal(report["metrics"], want["metrics"])
    assert len(report["stations"]) == len(want["stations"])
    for got_station, want_station in zip(report["stations"], want["stations"]):
        _assert_metrics_equal(got_station, want_station)
    for horizon, metrics in want["horizons"].items():
        _assert_metrics_equal(report["horizons"][horizon]["metrics"], metrics)
    _assert_metrics_equal(
        report["rolling_picp_7d"][0]["current"], want["rolling_current"]
    )
    assert report["criteria"] == want["criteria"]
    assert len(rows) == want["n_rows"]
    for col in ("q50", "q025", "q975", "actual"):
        assert float(rows[col].sum()) == pytest.approx(
            want[f"rows_{col}_sum"], abs=len(rows) * QUANTILE_ATOL
        )
