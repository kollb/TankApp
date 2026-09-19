"""Regime-Kanten lesen und Zeiträume dagegen prüfen (B0, Befund Teil 5).

Eine Regime-Kante ist ein deklarierter Zeitpunkt, an dem ein Steuerschritt
oder ein Deckel das Preisniveau bricht (Tankrabatt 01.10.2026, Rabatt-Ende
01.01.2027, im Archiv der Mai-Juni-Rabatt 2026 mit 01.05. und 01.07.). In
0.56.0 **rechnet** nichts damit — die Engine markiert nur: welche PIT-Paare
und Backtest-Folds ein Fenster überspannen, in dem eine Kante liegt.
Kalibrierung (B2) und Gates (G-R4) können diese Zeilen dann ausschließen,
statt einen Schock als Modellfehler zu lernen (§5.4.3, §5.7).

Der Kalender selbst steht in ``Config.regimes`` (durchgereicht wie
``price_law_local``: Settings → ``app/config.py::engine_config`` → Config).
"""

from __future__ import annotations

import pandas as pd

from .config import Config


def regime_breaks_utc(cfg: Config, fuel: str | None = None) -> list[dict]:
    """Deklarierte Kanten als UTC-Zeitpunkte, chronologisch.

    ``fuel`` filtert auf Einträge dieser Sorte oder ohne Sorte (None = alle).
    Jeder Eintrag trägt ``at`` (``pd.Timestamp`` UTC) plus die Kalenderfelder.
    """
    wanted = fuel.strip().upper() if isinstance(fuel, str) and fuel.strip() else None
    out: list[dict] = []
    for entry in cfg.regimes:
        if wanted is not None and entry["fuel"] not in (None, wanted):
            continue
        stamp = pd.Timestamp(entry["announced_local"])
        if stamp.tzinfo is None:
            stamp = stamp.tz_localize(cfg.timezone)
        out.append({**entry, "at": stamp.tz_convert("UTC")})
    return out


def breaks_within(
    breaks: list[dict], start: pd.Timestamp, end_exclusive: pd.Timestamp
) -> list[dict]:
    """Kanten mit ``start <= at < end_exclusive`` (halboffen wie alle Fenster)."""
    return [item for item in breaks if start <= item["at"] < end_exclusive]


def spans_break(
    breaks: list[dict], start: pd.Timestamp, end_exclusive: pd.Timestamp
) -> bool:
    """Liegt mindestens eine Kante in [start, end_exclusive)?"""
    return bool(breaks_within(breaks, start, end_exclusive))


def break_summary(item: dict) -> dict:
    """Kalenderfelder ohne den Zeitstempel, JSON-fertig (für Berichte)."""
    return {
        "announced_local": item["announced_local"],
        "at_utc": item["at"].isoformat(),
        "kind": item["kind"],
        "fuel": item["fuel"],
        "announced_value": item["announced_value"],
        "status": item["status"],
        "source": item["source"],
    }
