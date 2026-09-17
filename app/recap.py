"""Wochen-Rückblick über den Kanal aus O29 (O31).

Die App führte ein Tagebuch und Monatsbilanzen, aber keine Meldung, die
die Woche zusammenfasst. Dieser Baustein liefert sie — **ohne neue
Rechnung**: Jede Zahl kommt aus einem Artefakt, das die App ohnehin führt.

Inhalt (DoD O31):
  * abgerechnete Empfehlungen der letzten sieben Tage (Advice-Ledger,
    ``app/feedback.py``) — richtig/daneben/unentschieden/nicht bewertbar,
    dieselben Wörter wie das Tagebuch (MICROCOPY §4c),
  * größte Verbesserung und größte Verschlechterung im Ranking nach
    ``delta_recent5_ct`` (``engine/selection.py``),
  * Datenqualität: Stationszahl, Aussetzer, niedrigste Coverage,
    Datenreichweite in Tagen,
  * Lernstand: Belege und ob die Personalisierung aktiv ist.

Jede Zahl läuft über einen Formatter (``de_int``/``de_ct``/``de_pct``);
``tests/test_o31_recap.py`` ratchtet das. O42 gilt wie bei den
Fenster-Meldungen: ``mode="public"`` bleibt stations- und preisfrei.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from .notify import NTFY_PRIORITY_OK, in_quiet_hours, parse_stamp

RECAP_STATE_RELATIVE = ("notify", "recap.json")
RECAP_WINDOW_DAYS = 7

# Ergebnis-Wörter des Tagebuchs (MICROCOPY §4c) — nie „Treffer“/„Fehler“.
OUTCOME_WORDS = (
    ("win", "richtig"),
    ("loss", "daneben"),
    ("tie", "unentschieden"),
    ("void", "nicht bewertbar"),
)


# --- Formatter -------------------------------------------------------------
# Der Rückblick ist eine Nutzermeldung: Zahlen laufen durch diese drei
# Funktionen und nirgends sonst durch ein Format-Spec.


def de_int(value: int | float | None) -> str:
    """Ganzzahl ohne Dezimalstelle — „7“, nie „7.0“."""
    try:
        return f"{int(round(float(value))):d}"
    except (TypeError, ValueError):
        return "—"


def de_ct(value: float | None) -> str:
    """ct/L-Differenz in deutscher Schreibweise, mit Vorzeichen."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "—"
    sign = "−" if number < 0 else ("+" if number > 0 else "±")
    return f"{sign}{abs(number):.1f} ct/L".replace(".", ",")


def de_pct(value: float | None) -> str:
    """Anteil 0…1 als Prozent — „92 %“."""
    try:
        return f"{float(value) * 100:.0f} %".replace(".", ",")
    except (TypeError, ValueError):
        return "—"


# --- Zustand ---------------------------------------------------------------


def recap_state_path(settings) -> Path:
    return Path(settings.runtime).joinpath(*RECAP_STATE_RELATIVE)


def load_recap_state(settings) -> dict:
    """Zustand des Rückblicks; kaputte Dateien gelten als leer."""
    try:
        raw = json.loads(recap_state_path(settings).read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    return raw if isinstance(raw, dict) else {}


def save_recap_state(settings, state: dict) -> bool:
    path = recap_state_path(settings)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")
        return True
    except OSError:
        return False


def iso_week(now: dt.datetime) -> str:
    """ISO-Woche als stabiler Schlüssel — „2026-W38“."""
    year, week, _ = now.isocalendar()
    return f"{year}-W{week:02d}"


def plan(state: dict, now: dt.datetime) -> dict:
    """Höchstens eine Meldung je ISO-Woche, nie in der Ruhezeit."""
    week = iso_week(now)
    if state.get("last_week") == week:
        return {"send": False, "week": week, "reason": "already_sent"}
    if in_quiet_hours(now):
        return {"send": False, "week": week, "reason": "quiet_hours"}
    return {"send": True, "week": week, "reason": None}


# --- Fakten aus vorhandenen Größen -----------------------------------------


def _outcome_counts(store: dict | None, now: dt.datetime) -> dict[str, int]:
    """Abrechnungen der letzten sieben Tage, nach Ergebnis des Tagebuchs."""
    counts = {key: 0 for key, _ in OUTCOME_WORDS}
    counts["total"] = 0
    cutoff = now - dt.timedelta(days=RECAP_WINDOW_DAYS)
    for row in (store or {}).get("settlements") or []:
        stamp = parse_stamp(row.get("settled_at"))
        if stamp is None or stamp < cutoff:
            continue
        outcome = row.get("outcome")
        if outcome in counts:
            counts[outcome] += 1
            counts["total"] += 1
    return counts


def _station_extremes(stations: list[dict]) -> tuple[dict | None, dict | None]:
    """Größte Verbesserung / größte Verschlechterung nach delta_recent5_ct."""
    rows = [
        row for row in stations if isinstance(row.get("delta_recent5_ct"), (int, float))
    ]
    if not rows:
        return None, None
    best = max(rows, key=lambda row: row["delta_recent5_ct"])
    worst = min(rows, key=lambda row: row["delta_recent5_ct"])
    return best, worst


def load_selection(settings, fuel: str | None = None) -> dict:
    """Selektions-Artefakt flach gelesen — dieselbe Quelle wie
    ``/api/v1/selection``, aber ohne ``DataGateway`` (der Notifier hat
    kein Influx und braucht kein Stationen-Cache).

    Rückgabe ist immer ein Dict; ein fehlendes oder kaputtes Artefakt
    ergibt ``error_code`` und leere Liste, nie eine Ausnahme.
    """
    try:
        from .selection import read_selection

        data = read_selection(settings)
    except Exception:
        return {"stations": [], "count": 0, "error_code": "selection_read_failed"}
    if not isinstance(data, dict) or not data:
        return {"stations": [], "count": 0, "error_code": "selection_not_available"}
    if data.get("error_code"):
        # read_selection meldet ein fehlendes Artefakt als Daten, nicht als
        # Ausnahme — diesen Grund reichen wir unverändert weiter.
        return {"stations": [], "count": 0, "error_code": data["error_code"]}
    fuels = getattr(settings, "model_fuels", ("e10",)) or ("e10",)
    fuel = fuel or fuels[0]
    fuel_data = (data.get("by_fuel") or {}).get(fuel) or {}
    stations: list[dict] = []
    dead = 0
    for city in fuel_data.get("cities") or []:
        stations.extend(city.get("stations") or [])
        dead += len(city.get("dead_stations") or [])
    return {
        "stations": stations,
        "count": len(stations),
        "dead_count": dead,
        "n_days": fuel_data.get("n_days"),
        "error_code": None,
    }


def build_facts(
    store: dict | None,
    selection: dict | None,
    now: dt.datetime,
) -> dict[str, Any]:
    """Fasst zusammen, was schon da ist — keine neue Rechnung.

    ``store`` ist der Feedback-Store (Advice- und Wallet-Ledger),
    ``selection`` die Antwort von ``DataGateway.selection``. Fehlende
    Artefakte ergeben ``None``-Felder, keine erfundenen Zahlen.
    """
    selection = selection if isinstance(selection, dict) else {}
    stations = selection.get("stations") or []
    best, worst = _station_extremes(stations)
    coverages = [
        float(row["coverage"])
        for row in stations
        if isinstance(row.get("coverage"), (int, float))
    ]

    learning: dict[str, Any] = {
        "n_fills": None,
        "personalized": None,
        "error_code": "store_missing",
    }
    if isinstance(store, dict):
        try:
            from .feedback import compute_wallet_stats

            stats = compute_wallet_stats(store, now=now)
            learning = {
                "n_fills": stats.get("n_fills"),
                "personalized": bool(stats.get("wh_personalized")),
                "error_code": None,
            }
        except Exception:
            learning = {
                "n_fills": None,
                "personalized": None,
                "error_code": "wallet_stats_failed",
            }

    return {
        "week": iso_week(now),
        "outcomes": _outcome_counts(store, now),
        "best_station": (best or {}).get("name") or None,
        "best_delta_ct": (best or {}).get("delta_recent5_ct"),
        "worst_station": (worst or {}).get("name") or None,
        "worst_delta_ct": (worst or {}).get("delta_recent5_ct"),
        "station_count": selection.get("count") or len(stations) or None,
        "dead_count": selection.get("dead_count"),
        "min_coverage": min(coverages) if coverages else None,
        "n_days": selection.get("n_days"),
        "learning": learning,
        "selection_error": selection.get("error_code"),
    }


# --- Meldung ---------------------------------------------------------------


def build_payload(
    facts: dict,
    *,
    mode: str,
    version: str | None = None,
) -> dict:
    """ntfy-Payload des Wochen-Rückblicks (rein — je Modus testbar).

    O42: ``mode="public"`` nennt keine Station und keinen Preis;
    ``mode="lan"`` nennt beide. Koordinaten und Paste stehen in keinem
    der beiden Modi.
    """
    facts = facts if isinstance(facts, dict) else {}
    outcomes = facts.get("outcomes") or {}
    detail = mode == "lan"
    lines = [f"Abgerechnete Empfehlungen ({de_int(RECAP_WINDOW_DAYS)} Tage):"]

    total = outcomes.get("total") or 0
    if total:
        parts = [
            f"{de_int(outcomes.get(key))} {word}"
            for key, word in OUTCOME_WORDS
            if outcomes.get(key)
        ]
        lines.append(f"{de_int(total)} — " + ", ".join(parts) + ".")
    else:
        lines.append(
            "keine — die Woche hat noch nichts abgerechnet. "
            "Das Tagebuch zählt erst nach dem Fensterende."
        )

    if detail:
        best, worst = facts.get("best_station"), facts.get("worst_station")
        if best and facts.get("best_delta_ct") is not None:
            lines.append(
                f"Am meisten verbessert: {best} ({de_ct(facts['best_delta_ct'])})."
            )
        if worst and facts.get("worst_delta_ct") is not None:
            lines.append(
                f"Am meisten verschlechtert: {worst} ({de_ct(facts['worst_delta_ct'])})."
            )

    quality = []
    if facts.get("station_count") is not None:
        quality.append(f"{de_int(facts['station_count'])} Stationen")
    if facts.get("dead_count") is not None:
        quality.append(f"{de_int(facts['dead_count'])} Aussetzer")
    if facts.get("min_coverage") is not None:
        quality.append(f"niedrigste Coverage {de_pct(facts['min_coverage'])}")
    if facts.get("n_days") is not None:
        quality.append(f"Datenreichweite {de_int(facts['n_days'])} Tage")
    if quality:
        lines.append("Daten: " + ", ".join(quality) + ".")
    elif facts.get("selection_error"):
        lines.append("Daten: diese Woche kein Ranking veröffentlicht.")

    learning = facts.get("learning") or {}
    if learning.get("n_fills") is not None:
        state = "aktiv" if learning.get("personalized") else "noch nicht aktiv"
        lines.append(
            f"Lernstand: {de_int(learning['n_fills'])} Belege, "
            f"Personalisierung {state}."
        )

    body = "\n".join(lines)
    if version:
        body = f"{body}\n(TankApp {version})"
    return {
        "title": f"TankApp: Wochen-Rückblick {facts.get('week') or ''}".strip(),
        "message": body,
        "priority": NTFY_PRIORITY_OK,
        "tags": ["calendar"],
    }
