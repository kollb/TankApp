"""A21-B4: fachliche Mengen- und Nutzenverträge."""

from app.benefit import build_benefit_contract
from app.decide import _format_window_item, _draws_for_window, tank_context
from app.quantity import resolve_quantity
from app.stats_summary import _score_rows


def test_physical_quantity_uses_free_capacity_not_requested_full_tank():
    quantity = resolve_quantity(55, 25, 55)
    assert quantity["requested_liters"] == 55
    assert quantity["used_liters"] == 41.25
    assert quantity["available_liters"] == 41.25
    assert quantity["adjusted"] is True
    assert quantity["source"] == "free_capacity_limited"


def test_what_if_quantity_is_explicit_and_never_an_action_release():
    quantity = resolve_quantity(55, 25, 55, mode="what_if")
    contract = build_benefit_contract(
        liters=quantity["used_liters"],
        quantity=quantity,
        anchor_price=2.00,
        latest_by=None,
        decision_ready=False,
        draw_scope="unavailable",
    )
    assert quantity["used_liters"] == 55
    assert contract["quantity"]["mode"] == "what_if"
    assert contract["action"]["hypothetical_only"] is True
    assert contract["action"]["executable"] is False


def test_zero_and_full_fill_levels_are_finite_and_distinct_from_unknown():
    empty = resolve_quantity(40, 0, 50)
    full = resolve_quantity(40, 100, 50)
    unknown = resolve_quantity(40, None, 50)
    assert empty["used_liters"] == 40
    assert full["used_liters"] == 0
    assert full["available_liters"] == 0
    assert unknown["used_liters"] == 40
    assert unknown["available_liters"] is None
    assert tank_context(100, 50, None, 7)["state"] == "ok"


def test_partial_origin_block_uses_exact_suffix_for_minimum_and_probability():
    draws = {
        "blocks": [
            {
                "start": "2026-09-17T14:00:00+00:00",
                "end": "2026-09-17T16:00:00+00:00",
            },
            {
                "start": "2026-09-17T16:00:00+00:00",
                "end": "2026-09-17T18:00:00+00:00",
            },
        ],
        # The whole-block value is deliberately not the suffix value.
        "minima": [[1.50, 1.70], [1.60, 1.80]],
        "suffix_minima": {
            "block": 0,
            "starts": [
                "2026-09-17T14:00:00+00:00",
                "2026-09-17T15:00:00+00:00",
            ],
            "minima": [[1.50, 1.40], [1.60, 1.55]],
        },
    }
    window = {
        "start": "2026-09-17T15:00:00+00:00",
        "end": "2026-09-17T15:55:00+00:00",
        "expected_price": 1.60,
    }
    scoped, block, scope = _draws_for_window(window, draws)
    assert scoped is draws
    assert block == 0
    assert scope == "suffix_artifact"
    item = _format_window_item(window, draws, 2.0, 40.0)
    assert item["draw_scope"] == "suffix_artifact"
    assert item["expected_min_price"] == 1.475
    assert item["expected_saving_eur"] == 21.0
    assert item["p"] is not None


def test_score_contract_names_strategy_and_oracle_without_calling_potential_expectation():
    score = _score_rows(
        [{"mu": 2.0, "s": 1.0, "best": 3.0, "p": 0.7}],
        1.0,
        40.0,
        include_contract=True,
    )
    assert score["strategy_saving_eur"] == 0.4
    assert score["realized_policy_delta_eur"] == 0.4
    assert score["oracle_lower_bound_eur"] == 1.2
    assert score["potential_is_expectation"] is False
    assert score["oracle_reachable"] is False


def test_invalid_nonfinite_values_do_not_become_unknown_or_default():
    import pytest

    with pytest.raises(ValueError, match="invalid_liters"):
        resolve_quantity(float("nan"), None, None)
    with pytest.raises(ValueError, match="invalid_liters"):
        resolve_quantity(float("inf"), None, None)
    with pytest.raises(ValueError, match="invalid_tank"):
        resolve_quantity(40, 25, float("nan"))
