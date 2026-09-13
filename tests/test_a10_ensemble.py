"""A10 (0.31.0): Zweitmodell „profile_ar2“ und inverse-MASE-Ensemble.

Konzept §3.2 M3 verlangt ein **zweites Modell** und ein Ensemble mit
Gewichten ∝ 1/MASE. Das Zweitmodell ist bewusst kein zweiter Sinus-Fit,
sondern ein anderer Modellkern: das Tagesprofil je 5-Minuten-Slot als
Median über das Trainingsfenster (nicht-parametrisch), sonst dieselbe
Kette (Holiday-Bereinigung, AR(2), Tagesblock-Bootstrap, 12-Uhr-Regel).

Geprüft wird: eigene Punktprognose, Gewichte ∝ 1/MASE (mit Zahlen, nicht
nur „irgendwie gemischt“), die Mischung liegt zwischen beiden Modellen,
und der Rückfall auf den Hauptpfad, wenn ein Alt-Artefakt kein Zweitmodell
enthält.
"""

import numpy as np
import pandas as pd
import pytest

from engine.config import Config
from engine.data import normalize_observations, prepare_series
from engine.models import VALIDATION_WINDOW_DAYS, ensemble_detail, fit, predict

ORIGIN = pd.Timestamp("2026-07-11T00:00", tz="Europe/Berlin")


def _frame(days: int = 40, start: str = "2026-06-01", seed: int = 11) -> pd.DataFrame:
    """Zwei Preispitzen je Tag (morgens/abends) — bewusst keine Sinusform.

    Genau dafür ist das Zweitmodell da: eine harmonische Summe kann diese
    Form nur angenähert abbilden, der Slot-Median bildet sie exakt ab.
    """
    index = pd.date_range(start, periods=days * 288, freq="5min", tz="Europe/Berlin")
    hour = np.asarray(index.hour + index.minute / 60)
    shape = 0.03 * np.exp(-(((hour - 8) / 1.2) ** 2)) + 0.05 * np.exp(
        -(((hour - 18) / 1.5) ** 2)
    )
    level = 1.60 + 0.02 * np.sin(np.arange(len(index)) / 288 / 7 * 2 * np.pi)
    rng = np.random.default_rng(seed)
    price = level + shape + rng.normal(0, 0.002, len(index))
    return pd.DataFrame(
        {
            "timestamp": index.astype(str),
            "city": "Testmarkt",
            "station_id": "station-a",
            "station_name": "Teststation",
            "fuel": "E10",
            "price": price,
            "status": np.where((hour >= 6) & (hour < 22), "open", "closed"),
            "source": "influxdb",
        }
    )


@pytest.fixture(scope="module")
def cfg() -> Config:
    return Config(train_days=30, min_train_days=20, bootstrap_samples=200, seed=5)


@pytest.fixture(scope="module")
def model(cfg: Config) -> dict:
    normalized, _ = normalize_observations(_frame(), cfg)
    series = next(iter(prepare_series(normalized, cfg)))
    return fit(series, ORIGIN, cfg)


def test_zweitmodell_liefert_eigene_endliche_punktprognose(model: dict):
    """Das Profil-Modell rechnet mit, aber es ist nicht der Hauptpfad."""
    harmonic = predict(model, hours=24, kind="harmonic_ar2")
    profile = predict(model, hours=24, kind="profile_ar2")

    assert np.isfinite(profile["harmonic_ar2"].to_numpy()).sum() > 0
    assert np.isfinite(profile["profile_ar2"].to_numpy()).sum() > 0
    gap = np.abs(
        profile["profile_ar2"].to_numpy() - harmonic["harmonic_ar2"].to_numpy()
    )
    # Ein anderer Modellkern — kein zweiter Sinus-Fit: die beiden weichen
    # spürbar voneinander ab (sonst wäre das Ensemble nur Rechenzeit).
    assert float(np.nanmax(gap)) > 0.005


def test_ensemble_ist_gewichtete_mischung_beider_modelle(model: dict):
    """Der Mischwert ist exakt w_h·harmonisch + w_p·profil, nicht „ähnlich“."""
    weights = (model.get("ensemble") or {}).get("weights") or {}
    w_h = float(weights.get("harmonic_ar2", 0.0))
    w_p = float(weights.get("profile_ar2", 0.0))
    assert w_h + w_p == pytest.approx(1.0, abs=1e-3)

    for hours in (24, 72):
        frame = predict(model, hours=hours, kind="ensemble")
        harmonic = frame["harmonic_ar2"].to_numpy()
        profile = frame["profile_ar2"].to_numpy()
        mixed = frame["ensemble"].to_numpy()
        mask = np.isfinite(mixed)
        assert mask.any()
        expected = w_h * harmonic[mask] + w_p * profile[mask]
        assert np.allclose(mixed[mask], expected, atol=1e-12)
        # Die Mischung liegt zwischen beiden Einzelmodellen.
        pair = np.vstack([harmonic[mask], profile[mask]])
        assert np.all(mixed[mask] <= pair.max(axis=0) + 1e-12)
        assert np.all(mixed[mask] >= pair.min(axis=0) - 1e-12)


def test_besseres_modell_traegt_das_groessere_gewicht(model: dict):
    """Gewichte ∝ 1/MASE: der niedrigere MASE bekommt das größere Gewicht."""
    detail = model.get("ensemble") or {}
    mase = detail.get("mase") or {}
    weights = detail.get("weights") or {}
    assert set(mase) == {"harmonic_ar2", "profile_ar2"}
    assert all(value is None or value > 0 for value in mase.values())
    if None in mase.values():
        # Ohne bestimmten MASE trägt nur der Hauptpfad.
        assert weights == {"harmonic_ar2": 1.0, "profile_ar2": 0.0}
        return
    better = min(mase, key=lambda key: mase[key])
    worse = max(mase, key=lambda key: mase[key])
    assert weights[better] >= weights[worse]
    assert detail["window_days"] == VALIDATION_WINDOW_DAYS
    assert detail["n_eval"] > 0


def test_altbestand_ohne_zweitmodell_faellt_auf_hauptpfad_zurueck(
    model: dict, cfg: Config
):
    """Ein Artefakt vor 0.31.0 kennt kein Profil — dann kein halbes Ensemble."""
    legacy = dict(model)
    for key in ("profile_level", "profile_phi", "profile_state", "profile_blocks"):
        legacy.pop(key, None)
    legacy["ensemble"] = {"weights": {"harmonic_ar2": 0.4, "profile_ar2": 0.6}}

    classic = predict(legacy, hours=24, kind="harmonic_ar2")
    fallback = predict(legacy, hours=24, kind="ensemble")

    for column in ("harmonic_ar2", "q025", "q50", "q975"):
        left = classic[column].to_numpy()
        right = fallback[column].to_numpy()
        assert np.array_equal(np.isfinite(left), np.isfinite(right))
        assert np.allclose(left[np.isfinite(left)], right[np.isfinite(right)], atol=0)


def test_gewichte_folgen_dem_kehrwert_des_mase():
    """Rechnerische Probe: halber Fehler ⇒ doppeltes Gewicht.

    „adjusted“ ist eine Rampe (damit die saisonale Naive einen echten
    Nenner liefert), Hauptmodell liegt konstant 2 ct daneben, Zweitmodell
    1 ct. Erwartet werden Gewichte 1/3 zu 2/3.
    """
    n = 3 * 288
    ramp = 1.7 + 0.0001 * np.arange(n, dtype=float)
    zeros = np.zeros(n)
    detail = ensemble_detail(
        ramp,
        ramp - 0.02,
        ramp - 0.01,
        zeros,
        zeros,
        np.zeros(2),
        np.zeros(2),
    )

    assert detail["naive_mae"] == pytest.approx(288 * 0.0001, rel=1e-6)
    assert detail["mase"]["harmonic_ar2"] == pytest.approx(0.02 / 0.0288, rel=1e-3)
    assert detail["mase"]["profile_ar2"] == pytest.approx(0.01 / 0.0288, rel=1e-3)
    assert detail["weights"]["profile_ar2"] == pytest.approx(2 / 3, abs=1e-3)
    assert detail["weights"]["harmonic_ar2"] == pytest.approx(1 / 3, abs=1e-3)
    assert detail["n_eval"] == n - 288
    assert detail["method"] == "inverse_mase_one_step_validation"


def test_zu_wenig_historie_laesst_nur_den_hauptpfad_zu():
    """Ohne Vortages-Anker ist kein MASE bestimmbar — kein Ratespiel."""
    short = np.array([1.7, 1.71, 1.69])
    detail = ensemble_detail(
        short, short, short, short, short, np.zeros(2), np.zeros(2)
    )
    assert detail["weights"] == {"harmonic_ar2": 1.0, "profile_ar2": 0.0}
    assert detail["mase"]["harmonic_ar2"] is None
    assert detail["n_eval"] == 0


def test_alle_drei_pfade_sind_deterministisch(model: dict):
    """Zwei Läufe, gleiche Zahlen — auch im Ensemble."""
    for kind in ("harmonic_ar2", "profile_ar2", "ensemble"):
        first = predict(model, hours=24, kind=kind, return_paths=True)[1]
        second = predict(model, hours=24, kind=kind, return_paths=True)[1]
        assert np.array_equal(first, second, equal_nan=True)
