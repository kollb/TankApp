"""P3 — Stations-Realismus: Schließzeit-Puffer und Preis-Stabilität.

Reine Funktionen ohne I/O. Ehrlichkeitsregel: Fehlt eine Angabe (keine
Schließzeit, zu wenig Preishistorie), sagt die Funktion „unbekannt“ und
verändert nichts — sie erfindet keine Öffnungszeit und keine Stabilität.

* **Schließzeit-Puffer.** Eine Station gilt als „Schließt bald“, wenn die
  verbleibende Öffnungszeit kleiner ist als Anfahrtszeit + Puffer (Standard
  15 Minuten). Solche Stationen werden im Jetzt-tanken-Ranking herabgestuft
  und nie zur besten Alternative.
* **Stabilität aus der Historie.** Ein „Tiefpreis“ ist ein Preis im unteren
  Quartil der Historie. Zusammenhängende Tiefpreis-Phasen werden gemessen:
  Anteil der Phasen ≥ 30 min („gehalten“), mittlere Haltedauer und Anteil
  der Lockvogel-Sprünge (< 15 min). Flackernde Stationen erhalten einen kleinen
  Abschlag im effektiven Vergleichspreis.
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Any, Sequence

CLOSING_BUFFER_MIN = 15.0
HOLD_MIN = 30.0
FLICKER_MIN = 15.0
LOW_QUANTILE = 0.25
MIN_PHASES = 4
MAX_FLICKER_DISCOUNT_EUR = 0.01  # höchstens 1 ct je Liter Abschlag


def closing_buffer_status(
    closes_at: dt.datetime | None,
    now: dt.datetime,
    travel_min: float | None,
    buffer_min: float = CLOSING_BUFFER_MIN,
) -> dict[str, Any]:
    """Status „ok“, „closing_soon“ oder „unknown“ (ohne Schließzeit/Anfahrt)."""
    base = {"status": "unknown", "remaining_min": None, "required_min": None}
    if closes_at is None or travel_min is None or not math.isfinite(travel_min):
        return base
    if closes_at.tzinfo is None or now.tzinfo is None:
        return base
    remaining = (closes_at - now).total_seconds() / 60.0
    required = float(travel_min) + float(buffer_min)
    status = "closing_soon" if remaining < required else "ok"
    return {
        "status": status,
        "remaining_min": round(remaining, 1),
        "required_min": round(required, 1),
    }


def price_phases(points: Sequence[tuple[dt.datetime, float]]) -> dict[str, Any] | None:
    """Zusammenhängende Tiefpreis-Phasen aus (Zeit, Preis)-Paaren.

    Gibt ``None`` zurück, wenn die Historie zu kurz ist (weniger als
    ``MIN_PHASES`` Phasen). Dauer einer Phase: vom ersten Tiefpreis-Punkt bis
    zum ersten Punkt danach über der Schwelle.
    """
    clean = sorted(
        (ts, float(price))
        for ts, price in points
        if ts is not None and price is not None and math.isfinite(float(price))
    )
    if len(clean) < 2:
        return None
    prices = sorted(price for _, price in clean)
    pos = (len(prices) - 1) * LOW_QUANTILE
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(prices) - 1)
    threshold = prices[lo] + (prices[hi] - prices[lo]) * (pos - lo)

    durations: list[float] = []
    start: dt.datetime | None = None
    for ts, price in clean:
        low = price <= threshold
        if low and start is None:
            start = ts
        if not low and start is not None:
            durations.append((ts - start).total_seconds() / 60.0)
            start = None
    if start is not None:
        durations.append((clean[-1][0] - start).total_seconds() / 60.0)
    if len(durations) < MIN_PHASES:
        return None
    return {"threshold_eur": round(threshold, 4), "durations_min": durations}


def price_stability(points: Sequence[tuple[dt.datetime, float]]) -> dict[str, Any]:
    """Stabilitäts-Kennzahl je Station; ``status`` „insufficient“ ohne Basis."""
    phases = price_phases(points)
    if phases is None:
        return {
            "status": "insufficient",
            "phases": 0,
            "held_share": None,
            "avg_hold_min": None,
            "flicker_share": None,
        }
    durations = phases["durations_min"]
    n = len(durations)
    held = sum(1 for d in durations if d >= HOLD_MIN)
    flicker = sum(1 for d in durations if d < FLICKER_MIN)
    return {
        "status": "measured",
        "phases": n,
        "held_share": round(held / n, 3),
        "avg_hold_min": round(sum(durations) / n, 1),
        "flicker_share": round(flicker / n, 3),
    }


def stability_discount_eur(stability: dict[str, Any] | None) -> float:
    """Risiko-Abschlag (€/L) für flackernde Stationen, sonst 0.

    Linear mit dem Lockvogel-Anteil bis ``MAX_FLICKER_DISCOUNT_EUR``. Nur
    gemessene Stationen erhalten einen Abschlag; „unbekannt“ bleibt null.
    """
    if not stability or stability.get("status") != "measured":
        return 0.0
    share = stability.get("flicker_share")
    if share is None or not math.isfinite(float(share)):
        return 0.0
    return round(MAX_FLICKER_DISCOUNT_EUR * max(0.0, min(1.0, float(share))), 4)


def effective_price(price: float, stability: dict[str, Any] | None) -> float:
    """Vergleichspreis = Preis + Risiko-Abschlag (nur für den Vergleich, nie angezeigt als Preis)."""
    return round(float(price) + stability_discount_eur(stability), 4)
