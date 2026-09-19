"""Regime-Kalender der App (B0, Befund Teil 5): deklarierte Preisniveau-Kanten.

Eine Regime-Kante ist ein Steuerschritt oder Deckel, der das Preisniveau
bricht — Tankrabatt ab 01.10.2026, dessen Ende zum 01.01.2027, und im Archiv
der Mai-Juni-Rabatt 2026 (01.05. Start, 01.07. Ende). In 0.56.0 **rechnet**
nichts damit: Der Kalender wird wie ``price_law_local`` durchgereicht
(``Settings`` → ``app/config.py::engine_config`` → ``engine.config.Config.
regimes``), und die Engine markiert und zählt (PIT-Paare, Backtest-Folds,
``regime_breaks_in_window``). Dummy, Kante und Warmstart sind R1–R3 und
kommen mit eigenem Schalter.

**Eine Quelle.** Der wirksame Kalender kommt aus ``Settings.regimes``;
``TANKAPP_REGIMES`` überschreibt ihn:

- leer / nicht gesetzt → :data:`DEFAULT_REGIMES` (die vier bekannten Termine),
- ``0`` / ``off`` / ``none`` → kein Kalender (Gegenmessung ohne Marker),
- JSON-Liste (``[{"announced_local": "2026-10-01T00:00", ...}, ...]``) →
  genau diese Einträge,
- Pfad einer ``.json``-Datei mit einer solchen Liste → vom Betrieb gepflegter
  Kalender (kein Code-Fassen bei der nächsten Maßnahme).

Feldnamen und erlaubte Werte prüft ``engine.config.normalize_regimes`` —
mehrdeutige Wanduhrzeiten, unbekannte Felder oder Sorten werden abgelehnt,
nicht stillschweigend verschoben. Ein kaputter Kalender bricht deshalb den
Modell-Lauf mit Grund ab, statt ohne Marker weiterzulaufen: Genau das
unmarkierte Übergangsfenster ist der Fehler, vor dem §5.7 warnt.

Nur Standardbibliothek — ``app/config.py`` wird von jedem CLI- und API-Pfad
geladen.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

# Bekannte Termine (Stand 19.09.2026, Befund Teil 5). Beträge sind die
# **angekündigten** Größen in ct/L brutto, Vorzeichen = Richtung der Kante;
# sie sind Prior, nicht Wahrheit (§5.3.2: die Durchgabe je Sorte ist offen,
# R2 schätzt Kante und Betrag aus den Daten). Sorte None = alle Sorten.
DEFAULT_REGIMES: tuple[dict, ...] = (
    {
        "announced_local": "2026-05-01T00:00",
        "kind": "tax_step",
        "fuel": None,
        "announced_value": -17.0,
        "status": "in_force",
        "source": (
            "Mai-Juni-Tankrabatt 2026, Start — im eigenen Archiv; "
            "Befund §5.8, analysis/regime_check.py"
        ),
    },
    {
        "announced_local": "2026-07-01T00:00",
        "kind": "tax_step",
        "fuel": None,
        "announced_value": 17.0,
        "status": "in_force",
        "source": (
            "Mai-Juni-Tankrabatt 2026, Ende — im eigenen Archiv; "
            "Befund §5.8, analysis/regime_check.py"
        ),
    },
    {
        "announced_local": "2026-10-01T00:00",
        "kind": "tax_step",
        "fuel": None,
        "announced_value": -17.0,
        "status": "announced",
        "source": (
            "Einigung der Koalition, Meldung 19.09.2026: Tankrabatt −17 ct/L "
            "(14 ct Energiesteuer + 3 ct USt-Effekt), befristet bis 31.12.2026"
        ),
    },
    {
        "announced_local": "2027-01-01T00:00",
        "kind": "tax_step",
        "fuel": None,
        "announced_value": 17.0,
        "status": "announced",
        "source": (
            "Ende des befristeten Tankrabatts (31.12.2026); Spritpreisdeckel "
            "spätestens 01.01.2027 angekündigt, Ausgestaltung offen (§5.9)"
        ),
    },
)

_OFF = {"0", "off", "none", "false", "no"}


def regimes_from_env(raw: str | None = None) -> tuple[dict, ...]:
    """Kalender aus ``TANKAPP_REGIMES`` (oder ``raw``); siehe Modul-Doku.

    Rückgabe sind die rohen Einträge — die inhaltliche Prüfung übernimmt
    ``engine.config.Config`` beim Bau der Engine-Konfiguration.
    """
    if raw is None:
        raw = os.environ.get("TANKAPP_REGIMES", "")
    text = (raw or "").strip()
    if not text:
        return DEFAULT_REGIMES
    if text.lower() in _OFF:
        return ()
    if text.startswith("["):
        try:
            loaded = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"TANKAPP_REGIMES: kein gültiges JSON ({exc.msg} an Position {exc.pos})."
            ) from exc
        return _as_entries(loaded, "TANKAPP_REGIMES")
    path = Path(text)
    if path.suffix.lower() == ".json":
        if not path.is_file():
            raise ValueError(f"TANKAPP_REGIMES: Kalenderdatei {path} fehlt.")
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"TANKAPP_REGIMES: {path} nicht lesbar ({exc}).") from exc
        if isinstance(loaded, dict) and "regimes" in loaded:
            loaded = loaded["regimes"]
        return _as_entries(loaded, str(path))
    raise ValueError(
        "TANKAPP_REGIMES muss leer (Default), 0/off (kein Kalender), eine "
        "JSON-Liste oder der Pfad einer .json-Datei sein — "
        f"erhalten {text[:60]!r}."
    )


def _as_entries(loaded, origin: str) -> tuple[dict, ...]:
    if not isinstance(loaded, list) or not all(
        isinstance(item, (dict, str)) for item in loaded
    ):
        raise ValueError(
            f"{origin}: erwartet wird eine Liste aus Kalender-Einträgen "
            "(Wörterbücher mit announced_local … oder ISO-Zeitpunkte)."
        )
    return tuple(loaded)
