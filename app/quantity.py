"""Fachvertrag für die Menge einer Tankentscheidung.

``liters`` war historisch zugleich Profilwert, Was-wäre-wenn-Annahme und
physisch verfügbare Menge. Das ist bei einem teilweise gefüllten Tank nicht
haltbar. Dieses Modul hält die Auflösung an einer Stelle und gibt die Herkunft
jeder Zahl mit zurück.
"""

from __future__ import annotations

import math
from typing import Any

QUANTITY_MODES = {"physical", "what_if"}


def resolve_quantity(
    requested_liters: float,
    tank_percent: float | None,
    tank_capacity_l: float | None,
    *,
    mode: str = "physical",
    default_capacity_l: float = 50.0,
) -> dict[str, Any]:
    """Resolve requested, physically usable and hypothetical litres.

    ``physical`` is the normal planning contract. With a known fill level the
    usable amount is the requested amount limited by free capacity, and the
    response explicitly says when that limit changed the calculation. A full
    tank yields zero usable litres and never receives an action release.

    ``what_if`` deliberately leaves the requested amount independent of the
    current fill level. It is useful for comparing a hypothetical full fill,
    but the caller must not release a real action for it.
    """
    if mode not in QUANTITY_MODES:
        raise ValueError("invalid_quantity_mode")
    if not math.isfinite(requested_liters) or requested_liters <= 0:
        raise ValueError("invalid_liters")
    if tank_percent is not None and not 0.0 <= tank_percent <= 100.0:
        raise ValueError("invalid_tank")
    capacity = tank_capacity_l if tank_capacity_l is not None else default_capacity_l
    if not math.isfinite(capacity) or capacity <= 0:
        raise ValueError("invalid_tank")

    if mode == "what_if" or tank_percent is None:
        available = None
        used = requested_liters
        source = "what_if" if mode == "what_if" else "requested_without_fill_level"
        adjusted = False
    else:
        available = max(0.0, capacity * (1.0 - tank_percent / 100.0))
        used = min(requested_liters, available)
        adjusted = used < requested_liters - 1e-9
        source = "free_capacity" if not adjusted else "free_capacity_limited"

    return {
        "mode": mode,
        "requested_liters": round(requested_liters, 3),
        "used_liters": round(used, 3),
        "available_liters": round(available, 3) if available is not None else None,
        "adjusted": adjusted,
        "source": source,
        "notice": (
            "Die Rechnung nutzt nur die freie Tankkapazität." if adjusted else None
        ),
    }
