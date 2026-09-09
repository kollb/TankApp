"""Supervised NAS Settlement Job for TankPuls (Konzept §5.4).

Rechnet abgelaufene Snapshots gegen Preishistorie ab und aktualisiert
den Due-Status von Episoden für den Due-Prompt beim nächsten App-Öffnen.
"""

from __future__ import annotations

import sys
from .feedback import settle_snapshots


def run_settlement_job(settings) -> dict[str, str | None]:
    try:
        result = settle_snapshots(settings)
        print(
            f"settlement: {result.get('settled_count', 0)} Snapshots abgerechnet, "
            f"{result.get('due_count', 0)} Episoden due gesetzt, "
            f"gesamt {result.get('total_settlements', 0)} Settlements.",
            flush=True,
        )
        return {"state": "success", "error_code": None}
    except Exception as exc:
        print(
            f"settlement: {type(exc).__name__}; Details werden nicht ausgegeben.",
            file=sys.stderr,
            flush=True,
        )
        return {"state": "failed", "error_code": "settlement_failed"}
