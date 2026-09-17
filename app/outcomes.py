"""Gemeinsame Gleichstandsregel für Entscheidung und Ledger (O7).

Eine Schwelle ist kein unsichtbarer Gewinner: Liegt ein Wert exakt auf der
fachlichen Grenze, erhält er einen halben Treffer. Die Regel wird von der
Verteilungsrechnung (``pside``), dem Settlement und den Ledger-Kennzahlen
geteilt, damit eine Differenz von genau 1,0 ct/L nicht je Ansicht anders
gezählt wird.
"""

from __future__ import annotations

import math

TIE_CREDIT = 0.5
# Preise werden höchstens auf 1/10 000 €/L veröffentlicht. Die deutlich
# kleinere Toleranz behandelt nur Rechenartefakte als Grenze, nie 0,01 ct als
# Gleichstand.
COMPARISON_EPSILON = 1e-9


def threshold_credit(value: float, threshold: float = 0.0) -> float:
    """Trefferanteil oberhalb einer Schwelle: 1, 0,5 (Grenze) oder 0."""
    if not math.isfinite(value) or not math.isfinite(threshold):
        return 0.0
    if math.isclose(value, threshold, abs_tol=COMPARISON_EPSILON):
        return TIE_CREDIT
    return 1.0 if value > threshold else 0.0


def outcome_credit(outcome: str | None) -> float:
    """Zählanteil eines gesettelten Outcomes — Gleichstand ist ein halber Treffer."""
    if outcome == "win":
        return 1.0
    if outcome == "tie":
        return TIE_CREDIT
    return 0.0


def symmetric_threshold_outcome(value: float, threshold: float) -> str:
    """Dreiweg-Outcome mit neutraler Zone und gleichen ±Grenzen.

    Das Advice-Settlement bewertet einen Vorteil erst außerhalb ``±theta``.
    Beide exakten Grenzen sind explizit ``tie`` — nicht zufällig Verlust auf
    der negativen und Gewinn auf der positiven Seite.
    """
    if math.isclose(abs(value), threshold, abs_tol=COMPARISON_EPSILON):
        return "tie"
    if value > threshold:
        return "win"
    if value < -threshold:
        return "loss"
    return "tie"


def threshold_outcome(
    value: float, threshold: float, positive_is_win: bool = True
) -> str:
    """``win``/``loss``/``tie`` relativ zur Schwelle mit derselben Grenzregel.

    ``positive_is_win=False`` dreht nur die Richtung (z. B. „jetzt“): Der
    exakte Grenzwert bleibt dennoch ein Gleichstand.
    """
    signed = value - threshold if positive_is_win else threshold - value
    credit = threshold_credit(signed)
    if credit == 1.0:
        return "win"
    if credit == TIE_CREDIT:
        return "tie"
    return "loss"
