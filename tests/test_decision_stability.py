"""P2: Hysterese (Deadband) und asymmetrisches Worst-Case-Risiko."""

import pytest

from app.decision_policy import (
    HYSTERESIS_EUR,
    REFUEL_NOW,
    WAIT,
    hysteresis,
    risk_adjusted_saving,
    risk_weight,
    tank_fraction,
    worst_case_saving,
)

MID = 1.0  # wait_eur_mid (DEFAULT_THRESHOLDS)
P_MID = 0.60


def _hyst(raw, prev, saving, p=0.8):
    return hysteresis(raw, prev, saving, wait_eur_mid=MID, wait_p_mid=P_MID, p_besser=p)


def test_flicker_around_threshold_does_not_flip_once_held():
    """Ein Flackern um 0,1 ct um die Schwelle kippt die Empfehlung nicht."""
    action = REFUEL_NOW
    flips = 0
    for saving in [1.00, 1.001, 0.999, 1.0005, 0.9995, 1.002, 0.998]:
        raw = WAIT if saving >= MID else REFUEL_NOW
        new, info = _hyst(raw, action, saving)
        if new != action:
            flips += 1
        action = new
    assert flips == 0
    assert action == REFUEL_NOW


def test_switch_back_to_wait_needs_full_margin():
    # Knapp über der Schwelle: noch kein Wechsel zurück auf „warten“.
    action, info = _hyst(WAIT, REFUEL_NOW, MID + HYSTERESIS_EUR - 0.01)
    assert action == REFUEL_NOW and info["held"] is True
    # Mit Abstand ≥ HYSTERESIS_EUR darf die Empfehlung kippen.
    action, info = _hyst(WAIT, REFUEL_NOW, MID + HYSTERESIS_EUR + 0.01)
    assert action == WAIT and info["held"] is False and info["applied"] is True


def test_wait_is_kept_inside_band_and_dropped_below_it():
    action, info = _hyst(REFUEL_NOW, WAIT, MID - HYSTERESIS_EUR + 0.05)
    assert action == WAIT and info["held"] is True
    action, info = _hyst(REFUEL_NOW, WAIT, MID - HYSTERESIS_EUR - 0.05)
    assert action == REFUEL_NOW and info["held"] is False


def test_probability_gate_switches_immediately():
    """Ist die Wahrscheinlichkeit zu niedrig, hält das Deadband nicht."""
    action, info = _hyst(REFUEL_NOW, WAIT, MID, p=0.30)
    assert action == REFUEL_NOW and info["held"] is False


def test_no_history_means_no_hysteresis():
    action, info = _hyst(WAIT, None, 1.2)
    assert action == WAIT and info["applied"] is False


def test_transparent_block_always_present():
    _, info = _hyst(WAIT, REFUEL_NOW, 1.2)
    for key in (
        "applied",
        "previous_action",
        "raw_action",
        "margin_eur",
        "saving_eur",
        "threshold_eur",
        "held",
    ):
        assert key in info
    assert info["margin_eur"] == HYSTERESIS_EUR


@pytest.mark.parametrize(
    "fraction,expected",
    [(None, 0.0), (0.9, 0.0), (0.5, 0.0), (0.3, 0.25), (0.1, 1.0), (0.02, 1.0)],
)
def test_risk_weight_is_progressive_at_low_tank(fraction, expected):
    assert risk_weight(fraction) == pytest.approx(expected, abs=1e-3)


def test_low_tank_weighs_downside_stronger_than_full_tank():
    expected, worst = 0.80, 0.10
    full = risk_adjusted_saving(expected, worst, risk_weight(0.9))
    mid = risk_adjusted_saving(expected, worst, risk_weight(0.3))
    low = risk_adjusted_saving(expected, worst, risk_weight(0.1))
    assert full == expected
    assert full > mid > low >= 0.0


def test_worst_case_is_the_upper_tail_of_window_minima():
    # Fensterminima je Pfad; Block 0. 90-%-Quantil liegt im schlechten Ende.
    minima = [[1.60 + 0.01 * k] for k in range(11)]  # 1,60 … 1,70
    worst = worst_case_saving(minima, 0, anchor=1.80, liters=40.0)
    median_based = (1.80 - 1.65) * 40.0
    assert worst is not None and worst < median_based
    assert worst == pytest.approx((1.80 - 1.69) * 40.0, abs=0.05)


def test_worst_case_none_without_draws():
    assert worst_case_saving(None, 0, 1.8, 40.0) is None
    assert worst_case_saving([[1.6]], None, 1.8, 40.0) is None


def test_tank_fraction_prefers_percent_then_range():
    assert tank_fraction(25.0, None, 50.0, 7.0) == pytest.approx(0.25)
    assert tank_fraction(None, 100.0, 50.0, 5.0) == pytest.approx(
        0.1
    )  # 100 von 1000 km
    assert tank_fraction(None, None, 50.0, 7.0) is None
