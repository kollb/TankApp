"""P4 — strukturierte Begründungs-Codes (ein Satz Texte für Web und Push).

Die Codes sind die Quelle; Web („Warum & Rechenweg“) und Push (ntfy) zeigen
dieselben Sätze. Texte stehen hier, nicht im Frontend, damit beide Kanäle
wortgleich argumentieren. Keine Preise und keine Stationsnamen in den
Sätzen: der Push darf im öffentlichen Modus die Texte unverändert senden.
"""

from __future__ import annotations

from typing import Any

EVENING_DROP_EXPECTED = "EVENING_DROP_EXPECTED"
UPWARD_MARKET_DRIFT = "UPWARD_MARKET_DRIFT"
LOW_TANK_RESERVE = "LOW_TANK_RESERVE"
DETOUR_UNFAVORABLE = "DETOUR_UNFAVORABLE"
CLOSING_SOON_FILTERED = "CLOSING_SOON_FILTERED"
HYSTERESIS_HOLD = "HYSTERESIS_HOLD"

REASON_CODE_TEXT: dict[str, str] = {
    EVENING_DROP_EXPECTED: "Am Abend wird ein Preisrückgang erwartet.",
    UPWARD_MARKET_DRIFT: "Die Preise steigen über die nächsten Tage — Warten verteuert sich.",
    LOW_TANK_RESERVE: "Der Tankrest liegt im Reservebereich — das Risiko des Wartens zählt stärker.",
    DETOUR_UNFAVORABLE: "Der Umweg zur Alternative kostet mehr, als er spart.",
    CLOSING_SOON_FILTERED: "Schließt bald: Eine Station wurde wegen ihrer Öffnungszeit herabgestuft.",
    HYSTERESIS_HOLD: "Die Empfehlung bleibt stabil — der Vorteil liegt im Haltebereich.",
}


def reason_text(code: str) -> str | None:
    """Der gemeinsame Satz zu einem Code (``None`` bei unbekanntem Code)."""
    return REASON_CODE_TEXT.get(code)


def reason_entry(code: str, value: float | None = None) -> dict[str, Any]:
    """Strukturierter Eintrag: Code, Satz und optional ein konkreter Wert."""
    entry: dict[str, Any] = {"code": code, "text": REASON_CODE_TEXT[code]}
    if value is not None:
        entry["value"] = round(float(value), 4)
    return entry


def push_summary(codes: list[Any] | None, limit: int = 1) -> str | None:
    """Ein bis zwei Sätze für die Push-Meldung (dieselben Texte wie im Web)."""
    texts: list[str] = []
    for item in codes or []:
        code = item.get("code") if isinstance(item, dict) else item
        text = reason_text(str(code)) if code else None
        if text and text not in texts:
            texts.append(text)
        if len(texts) >= limit:
            break
    return " ".join(texts) if texts else None
