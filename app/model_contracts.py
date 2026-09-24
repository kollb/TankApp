"""Maschinenlesbare Modellvertragsmatrix (M1/Priorität 7).

Ein Modellvertrag ist die fachliche Identität einer veröffentlichten
Prognose: Kern (``model_kind``), Ziehungsmodi (``shared_draws``,
``day_pair``) und Kalibrierungsmodus. Die Matrix ist die **eine**
normative Quelle dafür, welcher Vertrag produktiv Empfehlungen tragen
darf — Backtest-Parität, Kalibrierung und Freigabestatus stehen pro
Konfiguration genau einmal hier, nicht verstreut in Prosa.

Statuswerte (verbindlich, siehe docs/planung/LUECKEN.md):

* ``produktiv`` — End-to-end paritätisch (Fit, Bootstrap, PAVA,
  Kalibrierung, Backtest, Veröffentlichung, Decision Layer, Fixtures,
  Replay) und für die M7-Kohortenstatistik zugelassen.
* ``experimentell`` — technisch lauffähig, Backtest misst denselben Pfad,
  aber keine produktive Empfehlungsfreigabe (keine M7-Kohorte).
* ``deaktiviert`` — keine Pfadparität oder keine Freigabe; Metriken dieses
  Vertrags sind keine Evidenz für einen anderen Vertrag.
* ``bekannt_offen`` — dokumentierte Lücke mit Abnahmebedingung.

Nur Standardbibliothek — ``app/decide.py`` und ``app/config.py`` werden
von jedem API-Pfad geladen.
"""

from __future__ import annotations

from typing import Any

# Verbindliche Statuswerte (Priorität 7 / N1). Jede Konfiguration hat
# genau einen Status; Prosa-Dokumente spiegeln diese Matrix, ersetzen
# sie aber nicht.
STATUS_PRODUCTIVE = "produktiv"
STATUS_EXPERIMENTAL = "experimentell"
STATUS_DISABLED = "deaktiviert"
STATUS_KNOWN_OPEN = "bekannt_offen"

STATUSES = (
    STATUS_PRODUCTIVE,
    STATUS_EXPERIMENTAL,
    STATUS_DISABLED,
    STATUS_KNOWN_OPEN,
)

# Der einzige produktive Vertrag (ADR 0003, A10/B3): profile_ar2 mit
# gemeinsamer Ziehung und Day-Pair. Backtest (``engine/backtest.py``),
# Veröffentlichung (``app/refresh.py``) und Decision Layer
# (``app/decide.py``) bewerten denselben Pfad — das ist die
# Paritätsbedingung für MASE, Pinball, PICP, PIT, Variantenwahl und
# Schwellen.
PRODUCTIVE_MODEL_KIND = "profile_ar2"
PRODUCTIVE_SHARED_DRAWS = True
PRODUCTIVE_DAY_PAIR = True

# Kalibrierungsmodi je Horizont (M2): Nur 24-h-Pfade sind PIT-kalibriert.
# 72-/168-h-Pfade sind unkalibrierte Szenarioprognosen und erhalten nie
# dieselbe Vertrauenssprache wie 24-h-Fenster.
CALIBRATION_BY_HORIZON = {
    24: "pit_24h",
    72: "unkalibriert_szenario",
    168: "unkalibriert_szenario",
}


def _entry(
    *,
    status: str,
    backtest_kind: str,
    backtest_parity: bool,
    calibration_24h: str,
    calibration_72_168h: str,
    decision_release: bool,
    note: str,
) -> dict[str, Any]:
    return {
        "status": status,
        "backtest_kind": backtest_kind,
        "backtest_parity": bool(backtest_parity),
        "calibration_24h": calibration_24h,
        "calibration_72_168h": calibration_72_168h,
        "decision_release": bool(decision_release),
        "note": note,
    }


# Die Matrix: Produktionskern, Backtest-Kern, Ziehmodus, Day-Pair-Modus,
# Kalibrierungsmodus, Freigabestatus. Schlüssel ist der veröffentlichte
# Kern; Ziehmodi stehen in der Freigabebedingung, weil sie den
# M7-Vertragskontext bilden (``app/gate_context.py::model_contract_id``).
MODEL_CONTRACTS: dict[str, dict[str, Any]] = {
    "profile_ar2": _entry(
        status=STATUS_PRODUCTIVE,
        backtest_kind="profile_ar2",
        backtest_parity=True,
        calibration_24h="pit_optional_zeitgetrennt",
        calibration_72_168h="unkalibriert_szenario",
        decision_release=True,
        note=(
            "Produktiver Vertrag nur mit shared_draws=1 und day_pair=1. "
            "M7-Freigabe zusätzlich je Vertragskohorte (Kraftstoff, "
            "Kalibrierungsmodus, Entscheidungsvertrag, Regime-Bezug)."
        ),
    ),
    "harmonic_ar2": _entry(
        status=STATUS_EXPERIMENTAL,
        backtest_kind="harmonic_ar2",
        backtest_parity=True,
        calibration_24h="pit_optional_zeitgetrennt",
        calibration_72_168h="unkalibriert_szenario",
        decision_release=False,
        note=(
            "Paritätisch messbar (Backtest misst denselben Kern), aber ohne "
            "produktive M7-Kohortenfreigabe. Nur Offline-/Laborvergleiche."
        ),
    ),
    "ensemble": _entry(
        status=STATUS_DISABLED,
        backtest_kind="ensemble",
        backtest_parity=False,
        calibration_24h="nicht_freigegeben",
        calibration_72_168h="unkalibriert_szenario",
        decision_release=False,
        note=(
            "Deaktiviert (M1): keine belegte End-to-end-Parität zwischen "
            "Backtest-Kern und Veröffentlichungspfad. Ensemble-Metriken sind "
            "keine Evidenz für profile_ar2 und umgekehrt. Reaktivierung nur "
            "mit paritätischem Fit, Bootstrap, PAVA, Kalibrierung, Backtest, "
            "Veröffentlichung, Decision Layer, Fixtures und Replay."
        ),
    ),
}


def normalize_kind(kind: Any) -> str:
    """Kernname normieren (klein, gestrippt); Unbekanntes bleibt lesbar."""
    text = str(kind or "").strip().lower()
    return text or "unknown"


def contract_status(
    model_kind: Any,
    *,
    shared_draws: Any = None,
    day_pair: Any = None,
) -> str:
    """Status einer Konfiguration (Priorität 7: genau ein Status).

    ``profile_ar2`` ist nur im produktiven Ziehmodus produktiv; jede
    Abweichung (unabhängige Ziehung, kein Day-Pair) fällt auf
    ``experimentell`` zurück — derselbe Vertragskontext wie das M7-Gate.
    Unbekannte Kerne sind ``deaktiviert`` (fail-closed).
    """
    kind = normalize_kind(model_kind)
    entry = MODEL_CONTRACTS.get(kind)
    if entry is None:
        return STATUS_DISABLED
    if kind == PRODUCTIVE_MODEL_KIND:
        shared_ok = shared_draws is None or bool(shared_draws) is True
        pair_ok = day_pair is None or bool(day_pair) is True
        if shared_ok and pair_ok:
            return STATUS_PRODUCTIVE
        return STATUS_EXPERIMENTAL
    return str(entry["status"])


def is_productive_contract(
    model_kind: Any,
    *,
    shared_draws: Any = None,
    day_pair: Any = None,
) -> bool:
    """Darf dieser Vertrag eine Empfehlung tragen (M1/M7)?"""
    return (
        contract_status(model_kind, shared_draws=shared_draws, day_pair=day_pair)
        == STATUS_PRODUCTIVE
    )


def contract_from_forecast(forecast: Any) -> dict[str, Any]:
    """Vertragsfelder aus einer Veröffentlichungszeile lesen.

    Fehlende Felder (Alt-Artefakt) bleiben ``None`` — Aufrufer behandeln
    sie wie „unbekannt“, nicht wie den produktiven Vertrag.
    """
    if not isinstance(forecast, dict):
        return {"model_kind": None, "shared_draws": None, "day_pair": None}
    draws = forecast.get("draws_24h")
    shared = draws.get("shared") if isinstance(draws, dict) else None
    return {
        "model_kind": forecast.get("model_kind"),
        "shared_draws": forecast.get("shared_draws", shared),
        "day_pair": forecast.get("day_pair"),
    }


def is_forecast_released(forecast: Any) -> bool:
    """Ist diese Veröffentlichungszeile ein produktiver Vertrag?

    Alt-Artefakte ohne Vertragsfeld gelten als **nicht belegt** und
    sperren die Empfehlung (``model_not_released``) — sie öffnen keine
    Freigabe rückwirkend (A21-B5.1).
    """
    fields = contract_from_forecast(forecast)
    if fields["model_kind"] is None:
        return False
    return is_productive_contract(
        fields["model_kind"],
        shared_draws=fields["shared_draws"],
        day_pair=fields["day_pair"],
    )


def describe() -> dict[str, Any]:
    """Die Matrix als JSON-serialisierbares Dict (API/Doku)."""
    return {
        "productive": {
            "model_kind": PRODUCTIVE_MODEL_KIND,
            "shared_draws": PRODUCTIVE_SHARED_DRAWS,
            "day_pair": PRODUCTIVE_DAY_PAIR,
        },
        "calibration_by_horizon": dict(CALIBRATION_BY_HORIZON),
        "contracts": {key: dict(value) for key, value in MODEL_CONTRACTS.items()},
    }
