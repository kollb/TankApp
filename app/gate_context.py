"""Gültigkeitsbereich des M7-Gates (A21-B5.1, Issue 211).

Vor 0.68.0 rechnete das M7-Gate über **alle** ``verteilung``-Settlements des
Lebenszeit-Ledgers — Stadt, Kraftstoff, Modellgeneration und Regime bildeten
keine bindende Freigabegrenze (Audit 21.09.2026, §3.2). Gute Historie aus
einer anderen Daten- oder Modellphase konnte damit einen schwachen aktuellen
Zustand überdecken: „kalibriert“ hieß faktisch „eine gemischte historische
Sammlung hat einen Test bestanden“.

Dieses Modul definiert den **Vertragskontext** einer statistischen Freigabe —
fünf Felder, exakt verglichen (Issue 211):

* ``fuel`` — Kraftstoff. Harte Grenze: E10-Evidenz öffnet kein Diesel-Gate.
* ``model_contract`` — **fachliche** Modell-Vertrags-ID (Kern, Day-Pair- und
  Shared-Draws-Modus). Bewusst **keine** Fit-ID: ein stündlicher Refresh mit
  neuem Fit ist derselbe Vertrag und verwirft die Historie nicht (Issue 211,
  Umsetzungspunkt 3). Erst ein fachlich relevanter Vertragswechsel (anderer
  Kern, anderer Ziehungsmodus) bildet eine neue Kohorte.
* ``calibration_mode`` — technischer Kalibrierungsmodus der veröffentlichten
  Pfade (``raw``/``pit_24h``/``unknown``), dieselbe Zustandsmaschine wie
  ``forecast_calibration_state``. Die A/B-Trennung ist bindend: eine auf
  rohen Pfaden gemessene Trefferquote belegt keine PIT-Kurve und umgekehrt.
* ``decision_contract`` — Version des Entscheidungs-/Ereignisvertrags
  (Fenstermin-Ereignis mit θ = 1 ct/L, Abrechnungsregeln,
  Restfenster-Zuschnitt, Mengenvertrag). Ein fachlicher Wechsel dieser
  Definition hebt die Aussagekraft früherer Settlements auf — deshalb zwingt
  eine Anhebung von :data:`STATISTICAL_CONTRACT_VERSION` in eine neue Kohorte.
* ``regime_ref`` — Bezug des letzten **bestätigten** Regime-Bruchs
  (``detected``/``in_force``) bei Emit-Zeit, als Ablauf-/Drift-/Resetregel:
  Evidenz vor einer bestätigten Preisniveau-Kante gehört zu einem anderen
  Regime und öffnet das Gate danach nicht mehr (Issue 211, Umsetzungspunkt 5).
  ``None`` heißt „noch keine bestätigte Kante“, ``\"unknown"`` heißt
  „Altbestand ohne Herkunft“. **Angekündigte** Termine (``announced``) sind
  Szenarien (A14, Grenze in Issue 211): Sie verschieben die Grenze bewusst
  **nicht** und dürfen nur als ``regime_scenario_pending`` sichtbar mitlaufen.

Zulässiges Pooling (Issue 211, Umsetzungspunkt 4): Stationen und Städte
poolen **innerhalb** derselben Kohorte (fünf Felder gleich) — die
Wahrscheinlichkeit misst denselben Verteilungs-/Entscheidungsvertrag an
denselben Marktinstitutionen (Mittagsgesetz, Polling-Raster), und eine
Stadt allein erreicht die Mindestfallzahl nie. Fremde Kohorten werden nie
beigemischt; bei zu wenig passender Evidenz bleibt das Gate ehrlich gesperrt.

Legacy/unknown (Snapshots ohne ``gate_context``) bildet die eigene Kohorte
``unknown``. Sie wird ausgewiesen und zählt in die Allzeitbilanz, erklärt
aber die aktuelle Kohorte **nicht** rückwirkend für nachgewiesen (Issue 211,
Umsetzungspunkt 2).

Nur Standardbibliothek — ``app/feedback.py`` wird von jedem API-Pfad geladen.
"""

from __future__ import annotations

import datetime as dt
import json
from typing import Any
from zoneinfo import ZoneInfo

# A21-B5.1: Version des Entscheidungs-/Ereignisvertrags des M7-Gates.
# Anheben, wenn sich fachlich ändert: das Abrechnungsereignis (Fenstermin
# vs. Anker − θ), θ, die Symmetrie der Win-/Loss-Regeln, der
# Restfenster-Zuschnitt oder der Mengenvertrag. Nicht anheben für Fixes ohne
# Änderung dieser Definition — sonst startet das Gate bei jedem Release neu.
STATISTICAL_CONTRACT_VERSION = 1

# Reihenfolge ist die Anzeige-Reihenfolge des Gültigkeitsbereichs.
GATE_CONTRACT_FIELDS = (
    "fuel",
    "model_contract",
    "calibration_mode",
    "decision_contract",
    "regime_ref",
)

# Herkunftsmarker für Felder, die ein Altbestand nie belegt hat. ``unknown``
# ist bewusst kein Joker: Es gleicht keinem Live-Wert und bildet deshalb eine
# eigene Kohorte, die eine Freigabe nie öffnet.
UNKNOWN = "unknown"

# Kalibrierungsmodi — dieselben Zustände wie ``forecast_calibration_state``
# (app/feedback.py FORECAST_CALIBRATION_STATES; hier ohne Importzyklus).
CALIBRATION_MODES = ("raw", "pit_24h", "unknown")

# Zulässiges Pooling dieser Policy (an ``compute_advice_stats`` und die GUI):
# Stationen/Städte innerhalb einer Kohorte. Harte Grenzen sind die fünf
# Vertragsfelder selbst.
POOLING_POLICY = "stations_cities_within_contract_cohort"

# Nur bestätigte Regime-Kanten wirken als Drift-/Resetgrenze. ``announced``
# bleibt Szenario (A14) — siehe Moduldocstring.
CONFIRMED_REGIME_STATUSES = ("detected", "in_force")

_BERLIN = ZoneInfo("Europe/Berlin")


def decision_contract_id() -> str:
    """ID des Entscheidungs-/Ereignisvertrags — Version plus Kernfachlichkeit."""
    return f"decision-v{STATISTICAL_CONTRACT_VERSION}"


def model_contract_id(forecast: Any) -> str:
    """Fachliche Modell-Vertrags-ID einer Veröffentlichung.

    Enthält Modellkern und die verteilungsrelevanten Ziehungsmodi
    (Day-Pair, Shared Draws) — **keine** Fit-ID, keinen Origin, keine
    Parameter eines einzelnen Fits. Ein Refresh im selben statistischen
    Vertrag verwirst damit die Historie nicht (Issue 211); ein Wechsel des
    Kerns oder der Ziehungslogik bildet eine neue Kohorte.
    """
    if not isinstance(forecast, dict):
        return UNKNOWN
    kind = str(forecast.get("model_kind") or "").strip().lower()
    day_pair = forecast.get("day_pair")
    draws = forecast.get("draws_24h")
    shared = draws.get("shared") if isinstance(draws, dict) else None
    if not kind or day_pair is None or shared is None:
        # Teilweise bekannte Alt-Artefakte erklären keinen Vertrag.
        return UNKNOWN
    return f"{kind}+day_pair={int(bool(day_pair))}+shared={int(bool(shared))}"


def forecast_calibration_mode(forecast: Any) -> str:
    """Kalibrierungsmodus der veröffentlichten Pfade (``raw``/``pit_24h``/``unknown``).

    Spiegelt exakt ``app/decide.py::_forecast_calibration_state`` (B2): Nur
    eine valide aktive PIT-Hülle markiert ``pit_24h``; ein fehlerhaftes oder
    älteres Artefakt beansprucht keine A/B-Seite und fällt auf ``raw``. Ein
    leeres/fehlendes Artefakt bleibt ``unknown`` — ohne Veröffentlichung gibt
    es keine Messbedingung.
    """
    if not forecast:
        return "unknown"
    try:
        from engine.calibration import calibration_active

        if calibration_active(forecast.get("calibration")):
            return "pit_24h"
    except Exception:
        # Ein Defekt darf keine Messgruppe beanspruchen.
        return "raw"
    return "raw"


def _fuel_matches(entry_fuel: Any, fuel: Any) -> bool:
    """Regime-Eintrag gilt für die Sorte — ``None``/leer heißt alle Sorten."""
    if not entry_fuel:
        return True
    if not fuel:
        return False
    return str(entry_fuel).strip().lower() == str(fuel).strip().lower()


def _regime_stamp(entry: dict[str, Any]) -> dt.datetime | None:
    raw = entry.get("announced_local")
    if not raw:
        return None
    try:
        stamp = dt.datetime.fromisoformat(str(raw))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=_BERLIN)
    return stamp


def regime_ref_for(
    fuel: Any, now: dt.datetime, regimes: Any
) -> tuple[str | None, bool]:
    """Drift-Bezug zum Zeitpunkt ``now``: ``(regime_ref, scenario_pending)``.

    ``regime_ref`` ist die ``announced_local``-ID der letzten **bestätigten**
    Kante (``detected``/``in_force``) für diese Sorte oder alle Sorten — die
    Resetregel der Kohorte. ``None`` = noch keine bestätigte Kante.
    ``scenario_pending`` ist True, sobald ein **angekündigtes** Szenario
    (``announced``) bekannt ist: Es verschiebt den Bezug bewusst nicht, darf
    aber nicht unbemerkt mit einer gesicherten Betriebsannahme zusammenfallen
    (Audit §3.3.6).
    """
    best: tuple[dt.datetime, str] | None = None
    scenario_pending = False
    for entry in regimes or ():
        if not isinstance(entry, dict):
            continue
        status = str(entry.get("status") or "").strip().lower()
        if status not in CONFIRMED_REGIME_STATUSES and status != "announced":
            continue
        if not _fuel_matches(entry.get("fuel"), fuel):
            continue
        stamp = _regime_stamp(entry)
        if stamp is None:
            continue
        if status == "announced":
            scenario_pending = True
            continue
        if stamp <= now and (best is None or stamp > best[0]):
            best = (stamp, str(entry.get("announced_local")))
    return (best[1] if best else None), scenario_pending


def normalize_gate_context(raw: Any) -> dict[str, Any]:
    """Exakt fünf Vertragsfelder; fehlende Teile werden ``unknown``, nie geraten.

    ``regime_ref`` kennt drei Zustände: ``None`` = ausdrücklich „noch keine
    bestätigte Kante“ (gilt nur für einen Kontext, der insgesamt bekannt ist),
    ``"unknown"`` = Altbestand ohne Herkunft, sonst die Kanten-ID. Ein
    unbekannter Kontext (``raw=None`` oder leeres Wort) bleibt durchgehend
    ``unknown`` — auch im ``regime_ref``.
    """
    source = raw if isinstance(raw, dict) else {}
    known = bool(source) and any(
        str(source.get(field)).strip()
        for field in GATE_CONTRACT_FIELDS
        if source.get(field) is not None
    )
    out: dict[str, Any] = {}
    for field in GATE_CONTRACT_FIELDS:
        if field == "regime_ref":
            if not known:
                out[field] = UNKNOWN
            elif "regime_ref" in source and source.get("regime_ref") is None:
                out[field] = None
            else:
                text = str(source.get("regime_ref") or "").strip()
                out[field] = text if text else UNKNOWN
            continue
        value = source.get(field)
        text = str(value).strip() if value is not None else ""
        out[field] = text if text else UNKNOWN
    return out


def gate_context_key(context: Any) -> str:
    """Stabiler, kanonischer Kohortenschlüssel (sortiertes JSON)."""
    return json.dumps(
        normalize_gate_context(context), sort_keys=True, ensure_ascii=True
    )


def same_gate_context(a: Any, b: Any) -> bool:
    """Zwei Kontexte sind nur bei exakter Vertragsgleichheit dieselbe Kohorte."""
    return gate_context_key(a) == gate_context_key(b)


def statistical_gate_context(
    forecast: Any,
    fuel: Any,
    now: dt.datetime,
    regimes: Any,
    *,
    calibration_mode: str | None = None,
) -> dict[str, Any]:
    """Vollständiger Vertragskontext einer Veröffentlichung zum Emit-Zeitpunkt.

    ``regime_ref`` und ``scenario_pending`` sind zeitabhängig — sie werden aus
    dem Emit-Zeitpunkt ``now`` abgeleitet und damit reproduzierbar (dasselbe
    ``now`` ergibt denselben Kontext).
    """
    ref, scenario_pending = regime_ref_for(fuel, now, regimes)
    mode = calibration_mode or forecast_calibration_mode(forecast)
    if mode not in CALIBRATION_MODES:
        mode = "unknown"
    context = normalize_gate_context(
        {
            "fuel": str(fuel).strip().lower() if fuel else UNKNOWN,
            "model_contract": model_contract_id(forecast),
            "calibration_mode": mode,
            "decision_contract": decision_contract_id(),
            "regime_ref": ref,
        }
    )
    context["_scenario_pending"] = bool(scenario_pending)
    return context


def public_context(context: Any) -> dict[str, Any]:
    """Kontext ohne interne Zusatzfelder (für API, Ledger und Aggregat)."""
    return normalize_gate_context(context)


def describe_gate_context(context: Any) -> str:
    """Kompakte deutsche Bezeichnung des Gültigkeitsbereichs (Gate-Status)."""
    ctx = normalize_gate_context(context)
    parts = [
        f"Kraftstoff {ctx['fuel']}",
        f"Modellvertrag {ctx['model_contract']}",
        f"Kalibrierung {ctx['calibration_mode']}",
        ctx["decision_contract"],
    ]
    if ctx["regime_ref"] and ctx["regime_ref"] != UNKNOWN:
        parts.append(f"Regime seit {ctx['regime_ref']}")
    elif ctx["regime_ref"] is None:
        parts.append("ohne bestätigte Regime-Kante")
    return ", ".join(parts)
