"""Names and definitions for the decision-layer benefit contract (A21-B4.4)."""

from __future__ import annotations

from typing import Any

STRATEGY_ID = "threshold-window-v1"
CONTRACT_VERSION = 1


def build_benefit_contract(
    *,
    liters: float,
    quantity: dict[str, Any],
    anchor_price: float | None,
    latest_by: str | None,
    decision_ready: bool,
    draw_scope: str,
) -> dict[str, Any]:
    """Describe every displayed quantity without changing legacy field names.

    The contract is deliberately data, not a new estimator: ``potential`` is
    the existing clipped median of draw minima, ``ranking`` is the median of
    usable q50 points, and ``strategy_utility`` is only produced by a replay
    after a real outcome. The oracle is an explicitly unreachable lower bound.
    """
    return {
        "version": CONTRACT_VERSION,
        "quantity_l": round(liters, 3),
        "quantity": {
            "mode": quantity.get("mode"),
            "requested_liters": quantity.get("requested_liters"),
            "used_liters": quantity.get("used_liters"),
            "available_liters": quantity.get("available_liters"),
            "source": quantity.get("source"),
        },
        "ranking": {
            "metric": "median_q50_of_usable_future_points",
            "unit": "EUR_per_liter",
            "scope": "same_remaining_window_as_expected_price",
        },
        "potential": {
            "field": "expected_saving_eur",
            "metric": "clipped_median_of_draw_window_minima",
            "unit": "EUR",
            "arithmetic_expectation": False,
            "losses_included": False,
            "guaranteed": False,
            "anchor_price_eur_per_liter": anchor_price,
        },
        "probability": {
            "metric": "P_draw_window_minimum_at_least_theta_below_anchor",
            "unit": "probability",
            "theta_ct_per_liter": 1.0,
            "same_draws_as_potential": True,
            "scope": draw_scope,
        },
        "strategy_utility": {
            "metric": "realized_threshold_policy_net_utility",
            "unit": "EUR",
            "available_at_emit": False,
            "value": None,
            "loss_side_included": True,
        },
        "replay": {
            "strategy_id": STRATEGY_ID,
            "decision_rule": (
                "thresholds plus current price, usable future window, tank state "
                "and net detour economics"
            ),
            "information_cutoff": "request_time",
            "latest_by": latest_by,
            "oracle": {
                "metric": "realized_minimum_in_usable_window",
                "reachable_by_strategy": False,
            },
        },
        "action": {
            "strategy_id": STRATEGY_ID,
            "executable": bool(decision_ready),
            "hypothetical_only": quantity.get("mode") == "what_if",
        },
        "distance": {
            "source": "station_metadata_or_route_contract",
            "net_economics_required_for_elsewhere": True,
        },
    }
