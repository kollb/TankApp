"""One receipt-based availability profile for ranking and recommendations (O2/O3).

The default is intentionally explicit rather than a hidden commuter vector:
each weekday carries 1/7 of the weekly probability; Mon–Fri distribute that
share over commuter hours, Saturday/Sunday uniformly over the day. Every
observed receipt is shrunk gradually against this prior, so its influence
starts with the first receipt and never jumps at a magic eighth fill.
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Any, Iterable

try:
    from zoneinfo import ZoneInfo

    BERLIN_TZ = ZoneInfo("Europe/Berlin")
except Exception:  # pragma: no cover - old Python / stripped zoneinfo image
    BERLIN_TZ = dt.timezone.utc

COMMUTER_HOURS = (6, 7, 8, 16, 17, 18, 19)
PRIOR_STRENGTH_FILLS = 8


def default_weekday_profile() -> list[list[float]]:
    """Return normalized 7×24 default mass, indexed Monday=0 … Sunday=6."""
    profile = [[0.0 for _ in range(24)] for _ in range(7)]
    weekday_mass = 1.0 / 7.0 / len(COMMUTER_HOURS)
    weekend_mass = 1.0 / 7.0 / 24.0
    for day in range(5):
        for hour in COMMUTER_HOURS:
            profile[day][hour] = weekday_mass
    for day in (5, 6):
        for hour in range(24):
            profile[day][hour] = weekend_mass
    return profile


def _timestamp(value: Any) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=dt.timezone.utc)
    return stamp


def _receipt_cell(fill: dict[str, Any]) -> tuple[int, int] | None:
    """A usable local weekday/hour cell, never an invented legacy weekday."""
    stamp = _timestamp(fill.get("tanked_at"))
    if stamp is None:
        return None
    local = stamp.astimezone(BERLIN_TZ)
    # clock_hour is persisted primarily for audit; timestamp wins because it
    # binds weekday and hour to one physical local time (incl. DST).
    return local.weekday(), local.hour


def weekday_profile(
    fills: Iterable[dict[str, Any]], prior_strength: int = PRIOR_STRENGTH_FILLS
) -> dict[str, Any]:
    """Return a shrunk normalized 7×24 profile plus auditable metadata.

    Voided/invalid receipt dicts and legacy rows without a timestamp do not
    add invented weekday evidence. ``n_fills`` therefore names the usable
    receipt count, while callers may expose their total separately.
    """
    default = default_weekday_profile()
    counts = [[0.0 for _ in range(24)] for _ in range(7)]
    n = 0
    for fill in fills:
        if not isinstance(fill, dict) or fill.get("voided"):
            continue
        cell = _receipt_cell(fill)
        if cell is None:
            continue
        day, hour = cell
        counts[day][hour] += 1.0
        n += 1

    if n <= 0:
        profile = default
        source = "default"
    else:
        profile = [
            [
                (n * (counts[day][hour] / n) + prior_strength * default[day][hour])
                / (n + prior_strength)
                for hour in range(24)
            ]
            for day in range(7)
        ]
        source = "shrunk_receipts"

    # Floating-point correction keeps the published and consumption invariant
    # exact enough without rounding away small first-fill evidence.
    total = sum(sum(day) for day in profile)
    if not math.isclose(total, 1.0) and total > 0:
        profile = [[value / total for value in day] for day in profile]

    return {
        "weights": profile,
        "source": source,
        "n_fills": n,
        "prior_strength": prior_strength,
    }


def hourly_profile(weights: list[list[float]]) -> list[float]:
    """Collapse 7×24 mass for legacy hourly UI consumers, preserving sum=1."""
    if len(weights) != 7 or any(len(day) != 24 for day in weights):
        return [0.0] * 24
    return [sum(weights[day][hour] for day in range(7)) for hour in range(24)]


def normalized_profile(weights: Any) -> list[list[float]] | None:
    """Validate arbitrary API/config weights and normalize their total mass."""
    if not isinstance(weights, (list, tuple)) or len(weights) != 7:
        return None
    try:
        result = [[float(value) for value in day] for day in weights]
    except (TypeError, ValueError):
        return None
    if any(len(day) != 24 for day in result):
        return None
    total = sum(sum(day) for day in result)
    if (
        total <= 0
        or not math.isfinite(total)
        or any(not math.isfinite(value) or value < 0 for day in result for value in day)
    ):
        return None
    return [[value / total for value in day] for day in result]
