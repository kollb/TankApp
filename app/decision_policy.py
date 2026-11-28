"""P2 — Entscheidungs-Hysterese und asymmetrisches Worst-Case-Risiko.

Reine Funktionen ohne I/O (testbar). ``evaluate_decide`` ruft sie auf und
legt jedes Ergebnis transparent unter ``decision_policy`` ab — die
bestehenden Pflichtfelder der Entscheidung bleiben unverändert.

* **Hysterese (Deadband) gegen die letzte gespeicherte Empfehlung.** Die
  Schwelle ist ``wait_eur_mid`` aus den aktiven Schwellen; ein Wechsel
  zwischen „warten“ und „jetzt tanken“ braucht einen Abstand von
  ``HYSTERESIS_EUR`` (0,50 €) über bzw. unter dieser Schwelle. Ein
  Flackern um 0,1 ct ändert die Empfehlung damit nicht.
* **Worst-Case-Quantil.** Aus den Bootstrap-Fensterminima wird das
  10-%-Quantil der *ungünstigen* Fälle ausgewiesen: der Preis steigt statt
  zu fallen. Die Ersparnis im schlechten Fall bestimmt, wie stark das
  Abwärtsrisiko in die Warte-Ersparnis eingeht.
* **Tankstand-Gewichtung.** Je weniger im Tank, desto stärker geht das
  Worst-Case-Risiko ein — quadratisch, damit der Effekt bei normalem Füllstand
  verschwindet und erst bei knapper Reichweite spürbar wird.
"""

from __future__ import annotations

import math
from typing import Any

HYSTERESIS_EUR = 0.50
WORST_CASE_QUANTILE = 0.10
# Tankstand-Gewicht: 0 ab 50 % Füllstand, 1 ab 10 % (dazwischen quadratisch).
RISK_FULL_AT_FRACTION = 0.50
RISK_MAX_AT_FRACTION = 0.10

WAIT = "wait"
REFUEL_NOW = "refuel_now"
_HYSTERESIS_ACTIONS = (WAIT, REFUEL_NOW)


def tank_fraction(
    tank_percent: float | None,
    range_km: float | None,
    capacity_l: float | None,
    consumption: float,
    reserve_km: float | None = None,
) -> float | None:
    """Tankstand als Anteil 0–1, wenn er sich ehrlich ableiten lässt.

    ``tank_percent`` gewinnt; sonst ``range_km`` über die Tankgröße (Reichweite
    je Liter). Ohne Angabe ``None`` — dann greift keine Risikogewichtung.
    """
    if tank_percent is not None:
        return max(0.0, min(1.0, float(tank_percent) / 100.0))
    if range_km is not None and capacity_l and consumption > 0:
        full_range = capacity_l / max(0.1, consumption) * 100.0
        if full_range > 0:
            return max(0.0, min(1.0, float(range_km) / full_range))
    return None


def risk_weight(fraction: float | None) -> float:
    """Gewicht des Worst-Case-Abschlags in [0, 1]; progressiv bei knappem Tank."""
    if fraction is None or not math.isfinite(fraction):
        return 0.0
    span = RISK_FULL_AT_FRACTION - RISK_MAX_AT_FRACTION
    ramp = (RISK_FULL_AT_FRACTION - fraction) / span
    ramp = max(0.0, min(1.0, ramp))
    return round(ramp * ramp, 4)


def _finite(values) -> list[float]:
    out: list[float] = []
    for value in values or []:
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            out.append(number)
    return out


def worst_case_saving(
    minima, block_idx: int | None, anchor: float | None, liters: float
) -> float | None:
    """Ersparnis im ungünstigen Fall: Anker − 90-%-Quantil der Fensterminima.

    Das 90-%-Quantil ist der Preis, den das Fenster in einem von zehn Pfaden
    mindestens erreicht. Null nach unten abgeschnitten, wie die Median-Ersparnis.
    """
    if not minima or block_idx is None or anchor is None or liters <= 0:
        return None
    column = _finite(row[block_idx] for row in minima if block_idx < len(row))
    if not column:
        return None
    column.sort()
    pos = (len(column) - 1) * (1.0 - WORST_CASE_QUANTILE)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(column) - 1)
    q_bad = column[lo] + (column[hi] - column[lo]) * (pos - lo)
    return round(max(0.0, (anchor - q_bad) * liters), 2)


def risk_adjusted_saving(
    expected_eur: float, worst_eur: float | None, weight: float
) -> float:
    """Erwartete Ersparnis minus Gewicht × Abstand zum Worst-Case.

    Bei vollem Tank (Gewicht 0) bleibt die Ersparnis unverändert. Der Abschlag
    wirkt nur nach unten: eine bessere Worst-Case-Lage erhöht sie nie.
    """
    if worst_eur is None or weight <= 0:
        return round(expected_eur, 2)
    penalty = weight * max(0.0, expected_eur - worst_eur)
    return round(max(0.0, expected_eur - penalty), 2)


def hysteresis(
    raw_action: str,
    previous_action: str | None,
    saving_eur: float,
    *,
    wait_eur_mid: float,
    wait_p_mid: float,
    p_besser: float | None,
    margin_eur: float = HYSTERESIS_EUR,
) -> tuple[str, dict[str, Any]]:
    """Deadband gegen die letzte gespeicherte Empfehlung.

    Gibt (angezeigte Aktion, Nachweis) zurück. Gehalten wird nur bei einem
    **€-getriebenen** Wechsel zwischen Warten und Jetzt tanken; Prozent-Gates
    (P zu niedrig) lösen den Wechsel immer sofort aus.
    """
    # „Keine Empfehlung“ ist kein Haltezustand: sie zählt wie „keine Vorgabe“.
    # So bleibt der Nachweis bei unverändertem Stand bitgleich.
    held_previous = previous_action if previous_action in _HYSTERESIS_ACTIONS else None
    info: dict[str, Any] = {
        "applied": False,
        "previous_action": held_previous,
        "raw_action": raw_action,
        "margin_eur": margin_eur,
        "saving_eur": round(float(saving_eur), 2),
        "threshold_eur": wait_eur_mid,
        "held": False,
    }
    if held_previous is None or raw_action not in _HYSTERESIS_ACTIONS:
        return raw_action, info
    if held_previous == raw_action:
        return raw_action, info
    info["applied"] = True
    if held_previous == REFUEL_NOW and raw_action == WAIT:
        # Zurück auf Warten erst mit Vorteil ≥ Schwelle + Abstand.
        if saving_eur < wait_eur_mid + margin_eur:
            info["held"] = True
            return REFUEL_NOW, info
        return raw_action, info
    if held_previous == WAIT and raw_action == REFUEL_NOW:
        # Warten nur aufgeben, wenn der Vorteil unter Schwelle − Abstand fällt
        # (und die Prozent-Seite nicht selbst gegen Warten spricht).
        p_ok = p_besser is None or p_besser >= wait_p_mid
        if p_ok and saving_eur >= wait_eur_mid - margin_eur:
            info["held"] = True
            return WAIT, info
    return raw_action, info


def policy_summary(
    *,
    hysteresis_info: dict[str, Any],
    fraction: float | None,
    weight: float,
    expected_eur: float | None,
    worst_eur: float | None,
    adjusted_eur: float | None,
) -> dict[str, Any]:
    """Der transparente Block im Entscheidungsobjekt (Ledger- und UI-Quelle)."""
    return {
        "hysteresis": hysteresis_info,
        "risk": {
            "quantile": WORST_CASE_QUANTILE,
            "tank_fraction": None if fraction is None else round(fraction, 4),
            "weight": round(weight, 4),
            "expected_saving_eur": expected_eur,
            "worst_case_saving_eur": worst_eur,
            "risk_adjusted_saving_eur": adjusted_eur,
        },
    }
