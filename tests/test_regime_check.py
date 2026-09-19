"""Regressions-Schutz für analysis/regime_check.py und den Befund
docs/BEFUND-UX-MATH-2026-09-19.md, Teil 5.

Genagelt werden die Aussagen, die der Befund *misst* und auf denen die
Regime-Schicht (R2–R4) aufsetzt:

- der Kantenschätzer findet Termin und Betrag einer bekannten Steuer-Änderung
  in beide Richtungen und nutzt **keine** Daten nach dem Cutoff,
- ohne echte Kante bleibt er unter der Schwelle (kein Fehlalarm),
- die Tagesform des Simulationsgenerators bleibt auf die Live-Messwerte aus
  docs/archiv/BEFUND-12-UHR-REGEL-2026-09-18.md §2.1 kalibriert,
- die beiden Projektions-Lemmata: eine Regime-Kante als Segmentgrenze erhält
  den Schritt (sonst poolt die 12-Uhr-PAVA ihn weg), und ein bewegter Deckel
  gehört **vor** die Projektion (danach erzeugt er einen illegalen Anstieg).
"""

import numpy as np
import pandas as pd
import pytest

pytest.importorskip("numpy")
pytest.importorskip("pandas")

from analysis.regime_check import (  # noqa: E402
    BERLIN,
    MIN_STEP_CT,
    STEP_MINUTES,
    daily_medians,
    daily_shape,
    estimate_break_day,
    estimate_step,
    make_prices,
    prepare,
)


def _station_frame(step_eur: float, cut_day: str, days: int = 40, seed: int = 3):
    """Eine Station, 5-Minuten-Takt, bekannter Schritt am bekannten Tag."""
    cut = pd.Timestamp(cut_day, tz=BERLIN)
    index = pd.date_range(
        cut - pd.Timedelta(days=days // 2), periods=days * 288, freq="5min", tz=BERLIN
    )
    local = index.tz_convert(BERLIN)
    hour = np.asarray(local.hour + local.minute / 60.0)
    rng = np.random.default_rng(seed)
    price = (
        1.72
        + daily_shape(hour)
        + rng.normal(0, 0.002, len(index))
        + np.where(index >= cut, step_eur, 0.0)
    )
    return pd.DataFrame(
        {
            "timestamp": index.astype(str),
            "station_id": "s1",
            "station_name": "Teststation",
            "city": "Testmarkt",
            "fuel": "E10",
            "price": np.round(price, 3),
            "valid": "true",
        }
    )


def _estimate(raw: pd.DataFrame, tmp_path, announced=None):
    path = tmp_path / "export.csv"
    raw.to_csv(path, index=False)
    df = prepare([path], "E10")
    group = df[df.station_id == "s1"]
    prices = group["price"].to_numpy(dtype=float)
    days = group["day"]
    day_keys, day_values = daily_medians(prices, days)
    found, contrast = estimate_break_day(day_values, day_keys)
    return found, contrast, prices, group["slot"].to_numpy(), days


def test_falling_regime_is_found_with_amount_and_day(tmp_path):
    """Rabatt-Start: −17 ct müssen als negative Kante am richtigen Tag landen."""
    found, _contrast, prices, slots, days = _estimate(
        _station_frame(-0.17, "2026-10-01"), tmp_path
    )
    assert found is not None
    assert pd.Timestamp(found).date().isoformat() == "2026-10-01"
    step = estimate_step(prices, slots, days, pd.Timestamp(found), 14, 14)
    assert step["delta_ct"] is not None
    assert abs(step["delta_ct"] * 100.0 - (-17.0)) < 1.5
    assert step["n_slots"] > 100


def test_rising_regime_is_found_with_positive_sign(tmp_path):
    """Rabatt-Ende (01.01.2027): dieselbe Schätzung, umgekehrtes Vorzeichen."""
    found, _contrast, prices, slots, days = _estimate(
        _station_frame(+0.17, "2027-01-01"), tmp_path
    )
    assert found is not None
    assert pd.Timestamp(found).date().isoformat() == "2027-01-01"
    step = estimate_step(prices, slots, days, pd.Timestamp(found), 14, 14)
    assert step["delta_ct"] * 100.0 > MIN_STEP_CT
    assert abs(step["delta_ct"] * 100.0 - 17.0) < 1.5


def test_estimation_never_reads_data_after_the_cutoff(tmp_path):
    """Zukunftsleck-Schutz: alles nach dem Cutoff darf δ̂ nicht ändern.

    Dasselbe Versprechen wie ``engine/models.py::fit`` — nur dass hier die
    Versuchung größer ist, weil die Kante per Definition in der Zukunft liegt.
    """
    raw = _station_frame(-0.17, "2026-10-01")
    found, _contrast, prices, slots, days = _estimate(raw, tmp_path)
    cut = pd.Timestamp(found)
    cutoff = pd.Timestamp("2026-10-05", tz=BERLIN).tz_localize(None)
    clean = estimate_step(prices, slots, days, cut, 14, 14, cutoff)
    # Preise nach dem Cutoff massiv manipulieren — δ̂ darf sich nicht bewegen.
    # Dieselbe Kante für beide Läufe: geprüft wird der Cutoff-Schutz der
    # Schätzung, nicht die Kantensuche.
    manipulated = raw.copy()
    after = pd.to_datetime(manipulated["timestamp"], utc=True) > pd.Timestamp(
        "2026-10-05", tz="UTC"
    )
    assert int(after.sum()) > 1000  # die Manipulation greift wirklich
    manipulated.loc[after, "price"] += 0.40
    _f2, _c2, prices2, slots2, days2 = _estimate(manipulated, tmp_path)
    leaked = estimate_step(prices2, slots2, days2, cut, 14, 14, cutoff)
    assert clean["delta_ct"] == pytest.approx(leaked["delta_ct"], abs=1e-9)


def test_flat_series_stays_below_the_threshold(tmp_path):
    """Kein Fehlalarm: ohne echte Kante bleibt der Kontrast unter der Schwelle."""
    found, contrast, _prices, _slots, _days = _estimate(
        _station_frame(0.0, "2026-10-01", seed=9), tmp_path
    )
    assert found is None or abs(contrast) < MIN_STEP_CT


def test_small_wobble_does_not_pass_the_amount_gate(tmp_path):
    """Befund §5.3.2: Der Tageskontrast allein darf nicht reichen.

    Am 31.12.2026 fand der Lauf eine Kante aus Weihnachts-Rauschen
    (Kontrast über, slot-gematchter Betrag unter der Schwelle) und kippte den
    02.01. auf −14,9 ct Bias. Beide Statistiken müssen tragen.
    """
    found, _contrast, prices, slots, days = _estimate(
        _station_frame(0.012, "2026-12-24", seed=13), tmp_path
    )
    if found is None:
        return  # schon die Kontrast-Schwelle hat abgelehnt — ebenfalls richtig
    step = estimate_step(prices, slots, days, pd.Timestamp(found), 14, 14)
    assert step["delta_ct"] is None or abs(step["delta_ct"]) * 100.0 < MIN_STEP_CT


def test_simulated_day_shape_stays_calibrated_to_the_live_measurement():
    """Der Generator ist Messwert-kalibriert, nicht frei erfunden.

    Live (12-Uhr-Befund §2.1): Tagesspanne 17 ct, Tief Median 7 Uhr, Hoch
    Median 12 Uhr. Driftet die Kurve, sind alle Simulationszahlen des Befunds
    wertlos — deshalb steht die Kalibrierung unter Test.
    """
    hours = np.arange(0, 24, 5 / 60.0)
    shape = daily_shape(hours) * 100.0
    assert round(float(shape.max() - shape.min()), 1) == 17.0
    assert hours[int(np.argmin(shape))] == pytest.approx(7.0)
    assert hours[int(np.argmax(shape))] == pytest.approx(12.0)
    # Senkungen jederzeit, Erhöhungen nur um 12:00 — die Kurve darf zwischen
    # 12:00 und 07:00 nicht steigen.
    # Chronologisch innerhalb eines 12-Uhr-Segments: erst 12:00–24:00, dann
    # 00:00–07:00. Eine boolesche Maske würde die Reihenfolge verdrehen und
    # den erlaubten Mittagssprung als Verstoß lesen.
    segment = np.concatenate([np.flatnonzero(hours >= 12), np.flatnonzero(hours < 7)])
    assert np.all(np.diff(shape[segment]) <= 1e-9)


def test_simulated_prices_reach_the_export_schema(tmp_path):
    """Der Simulationsbestand muss durch denselben Loader wie ein Export gehen."""
    raw = make_prices(
        "2026-09-01", 3, step=-0.17, break_at=pd.Timestamp("2026-09-02", tz=BERLIN)
    )
    path = tmp_path / "sim.csv"
    raw.to_csv(path, index=False)
    df = prepare([path], "E10")
    assert len(df) == 3 * 288
    assert set(df["station_id"]) == {"station-1"}
    assert df["price"].between(0.4, 5.0).all()
    assert df["slot"].between(0, 24 * 60 // STEP_MINUTES - 1).all()


def test_standard_error_bootstraps_day_blocks_per_side(tmp_path):
    """Der SE gehört zum gemeldeten Betrag — nicht zur Regime-Differenz selbst.

    Regression: Die erste Fassung zog Vor- und Nach-Tage aus **einem** Topf und
    bootstrapt damit einen Median über zwei Niveaus. Auf dem Juli-Testbestand
    meldete sie `se = 6,6 ct` bei einem klaren 17-ct-Schritt — ein Intervall,
    das die Durchgabe unlesbar macht (102,6 % ± 39 %). Richtig sind 0,6–0,8 ct.
    """
    _found, _contrast, prices, slots, days = _estimate(
        _station_frame(-0.17, "2026-10-01"), tmp_path
    )
    step = estimate_step(prices, slots, days, pd.Timestamp("2026-10-01"), 14, 14)
    assert step["se_ct"] is not None
    assert abs(step["delta_ct"]) * 100.0 > 15.0
    assert step["se_ct"] * 100.0 < 2.0  # ein Punkt-SE wäre ~0,02 ct — auch falsch
    assert step["se_ct"] < abs(step["delta_ct"]) / 5.0
    assert step["pre_days"] == 14 and step["post_days"] == 14


def test_standard_error_grows_with_noisier_days(tmp_path):
    """Mehr Tages-zu-Tages-Streuung muss einen größeren SE geben (Monotonie)."""
    quiet = _estimate(_station_frame(-0.17, "2026-10-01", seed=5), tmp_path)
    step_quiet = estimate_step(
        quiet[2], quiet[3], quiet[4], pd.Timestamp("2026-10-01"), 14, 14
    )
    raw = _station_frame(-0.17, "2026-10-01", seed=5)
    rng = np.random.default_rng(4)
    raw["price"] = np.round(raw["price"] + rng.normal(0, 0.05, len(raw)), 3)
    loud = _estimate(raw, tmp_path)
    step_loud = estimate_step(
        loud[2], loud[3], loud[4], pd.Timestamp("2026-10-01"), 14, 14
    )
    assert step_loud["se_ct"] > step_quiet["se_ct"]


def test_regime_edge_as_segment_boundary_preserves_the_step():
    """Befund §5.3.3: Ohne Kante poolt die 12-Uhr-PAVA einen Anstieg auf null."""
    from engine.config import Config
    from engine.models import noon_law_projection

    cfg = Config()
    index = pd.date_range("2026-12-31T12:00", periods=288, freq="5min", tz=BERLIN)
    edge = pd.Timestamp("2027-01-01T00:00", tz=BERLIN)
    local = index.tz_convert(BERLIN)
    hour = np.asarray(local.hour + local.minute / 60.0)
    raw = 1.72 + daily_shape(hour) + np.where(index >= edge, 0.17, 0.0)
    at = int(np.argmax(np.asarray(index >= edge)))

    pooled = noon_law_projection(raw, index, cfg)
    assert abs((pooled[at] - pooled[at - 1]) * 100.0) < 0.01  # Schritt gelöscht
    assert int((np.abs(pooled - raw) > 0.005).sum()) > 200  # Segment verbogen

    # Dieselbe Projektion, aber die Regime-Kante als Segmentgrenze (R3):
    # zwei Teilsegmente statt einem — der Schritt bleibt exakt stehen.
    preserved = np.concatenate(
        [
            noon_law_projection(raw[:at], index[:at], cfg),
            noon_law_projection(raw[at:], index[at:], cfg),
        ]
    )
    assert (preserved[at] - preserved[at - 1]) * 100.0 == pytest.approx(16.89, abs=0.05)
    assert int((np.abs(preserved - raw) > 0.005).sum()) == 0


def test_falling_regime_needs_no_segment_edge():
    """Senkungen sind jederzeit erlaubt — die Projektion lässt sie durch."""
    from engine.config import Config
    from engine.models import noon_law_projection

    cfg = Config()
    index = pd.date_range("2026-09-30T12:00", periods=288, freq="5min", tz=BERLIN)
    edge = pd.Timestamp("2026-10-01T00:00", tz=BERLIN)
    local = index.tz_convert(BERLIN)
    hour = np.asarray(local.hour + local.minute / 60.0)
    raw = 1.72 + daily_shape(hour) + np.where(index >= edge, -0.17, 0.0)
    projected = noon_law_projection(raw, index, cfg)
    assert np.allclose(projected, raw, atol=1e-9)


def test_moving_cap_must_be_clipped_before_the_projection():
    """Befund §5.3.4b: Clip nach der Projektion erzeugt einen illegalen Anstieg."""
    from engine.config import Config
    from engine.models import noon_law_projection

    cfg = Config()
    index = pd.date_range("2027-01-05T12:00", periods=288, freq="5min", tz=BERLIN)
    path = np.full(288, 1.80)
    cap = np.where(index.hour < 12, 1.85, 1.75)  # Formeldeckel steigt um Mitternacht

    after = np.minimum(noon_law_projection(path, index, cfg), cap)
    assert float(np.max(np.diff(after))) * 100.0 == pytest.approx(5.0, abs=0.01)

    before = noon_law_projection(np.minimum(path, cap), index, cfg)
    assert np.all(np.diff(before) <= 1e-12)


def test_clipping_keeps_quantile_order():
    """``min(·, c)`` ist monoton — die Quantilsordnung bleibt erhalten."""
    quantiles = np.array([[1.70, 1.75, 1.80, 1.90, 2.00]])
    clipped = np.minimum(quantiles, 1.78)
    assert np.all(np.diff(clipped, axis=1) >= 0)
    assert clipped.tolist() == [[1.70, 1.75, 1.78, 1.78, 1.78]]
