"""Supervised NAS Settlement Job for TankPuls (Konzept §5.4).

Rechnet abgelaufene Snapshots gegen Preishistorie ab und aktualisiert
den Due-Status von Episoden für den Due-Prompt beim nächsten App-Öffnen.
"""

from __future__ import annotations

import sys
from .feedback import settle_snapshots


def run_settlement_job(settings) -> dict[str, str | None]:
    try:
        from .data import LiveData
        from .feedback import ArchiveCorrupted, StoreCorrupted, StoreTooLarge
        from .worker import JobAborted

        live = LiveData(settings)
        result = settle_snapshots(settings, live_data=live)
        print(
            f"settlement: {result.get('settled_count', 0)} Snapshots abgerechnet, "
            f"{result.get('due_count', 0)} Episoden due gesetzt, "
            f"gesamt {result.get('total_settlements', 0)} Settlements.",
            flush=True,
        )
        return {"state": "success", "error_code": None}
    except JobAborted:
        # S4: Abbruch ist kein Job-Fehler — der Worker-Handler hat den
        # `aborted`-Zustand geschrieben; der Lauf endet hier.
        raise
    except StoreCorrupted:
        # S3: defekter Bestand — benannter Code statt generischem Fehler;
        # der Worker verschiebt den nächsten Versuch auf den Tagestakt.
        return {"state": "failed", "error_code": "store_corrupted"}
    except StoreTooLarge:
        return {"state": "failed", "error_code": "store_too_large"}
    except ArchiveCorrupted:
        # A21-B3.1: Die Retention des Settlement-Laufs kann das Archiv nicht
        # fortgeschrieben bekommen (fail-closed) — benannter Code, der heiße
        # Bestand bleibt unverändert.
        return {"state": "failed", "error_code": "archive_corrupted"}
    except Exception as exc:
        print(
            f"settlement: {type(exc).__name__}; Details werden nicht ausgegeben.",
            file=sys.stderr,
            flush=True,
        )
        return {"state": "failed", "error_code": "settlement_failed"}
