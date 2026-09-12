"""Aggregierter System-Alarm für /api/v1/health (B4).

Vorher waren die Einzelzustände (Heartbeat, Job-Fehler, Store-Größe, Polling)
über sieben Endpunkte verteilt und niemand schaut aktiv hin. Hier werden die
*vorhandenen* Prüfungen zu einem ``alarms[]``-Block zusammengefasst — ohne neue
Netz-/InfluxDB-Zugriffe, damit /health weiterhin in das 3–5-s-Budget des
Docker-Healthchecks passt.

Jeder Alarm ist ein dict mit:
  code      — stabiler Schlüssel für GUI/Doku (z. B. ``collector_no_heartbeat``)
  severity  — ``error`` | ``warn`` (GUI: roter Punkt nur bei ``error``)
  message   — deutscher Klartext für Menschen
  job       — Jobname, nur bei Job-Alarmen
"""

from pathlib import Path
from typing import Any

from .feedback import FEEDBACK_MAX_BYTES


def _store_size_bytes(settings) -> int:
    path = Path(getattr(settings, "runtime", ".")) / "feedback" / "store.json"
    try:
        return path.stat().st_size
    except OSError:
        return 0


def build_alarms(
    settings,
    *,
    collector: dict[str, Any] | None,
    jobs: dict[str, Any],
    job_errors: dict[str, str],
    polling_error: str | None,
    station_count: int,
) -> list[dict[str, Any]]:
    """Fasst die vorhandenen Zustandsprüfungen zu einem ``alarms[]``-Block zusammen."""
    alarms: list[dict[str, Any]] = []

    if polling_error:
        alarms.append(
            {
                "code": polling_error,
                "severity": "error",
                "message": (
                    "Das gemeinsame Polling-Set ist ungültig oder fehlt — "
                    "keine Stationen verfügbar."
                ),
            }
        )

    collector = collector or {}
    if not collector.get("available"):
        alarms.append(
            {
                "code": "collector_no_heartbeat",
                "severity": "error",
                "message": "Noch kein Collector-Herzschlag des Pi auf dem NAS.",
            }
        )
    elif collector.get("available") and not collector.get("fresh"):
        alarms.append(
            {
                "code": "collector_stale",
                "severity": "warn",
                "message": "Collector-Herzschlag ist veraltet (Preise können eingefroren sein).",
            }
        )

    for name, job in jobs.items():
        if name in job_errors or job.get("state") == "failed":
            alarms.append(
                {
                    "code": "job_failed",
                    "severity": "error",
                    "job": name,
                    "message": (
                        f"NAS-Job „{name}“ ist fehlgeschlagen — Prognosen und "
                        "Rankings können veraltet sein."
                    ),
                }
            )
        elif job.get("state") == "partial":
            # B18: Ein unvollständiger Lauf (z. B. eine Station strukturell
            # unfitbar) wiederholt sich nicht mehr stündlich — sichtbar machen,
            # warum der nächste Versuch erst im regulären Intervall kommt.
            alarms.append(
                {
                    "code": "job_partial",
                    "severity": "warn",
                    "job": name,
                    "message": (
                        f"NAS-Job „{name}“ ist unvollständig — mindestens eine "
                        "Station hat kein neues Modell. Nächster Versuch im "
                        "regulären Intervall, nicht stündlich."
                    ),
                }
            )
        elif job.get("state") == "aborted":
            alarms.append(
                {
                    "code": "job_aborted",
                    "severity": "warn",
                    "job": name,
                    "message": (
                        f"NAS-Job „{name}“ wurde abgebrochen (z. B. "
                        "Container-Neustart). Letzte Ergebnisse bleiben erhalten."
                    ),
                }
            )

    store_bytes = _store_size_bytes(settings)
    if store_bytes > FEEDBACK_MAX_BYTES:
        alarms.append(
            {
                "code": "store_too_large",
                "severity": "error",
                "message": "Persönlicher Speicher ist voll — Tank-Bilanz kann nicht mehr verbucht werden.",
            }
        )
    elif store_bytes > FEEDBACK_MAX_BYTES * 0.8:
        alarms.append(
            {
                "code": "store_growing",
                "severity": "warn",
                "message": "Persönlicher Speicher nähert sich der Größen-Grenze.",
            }
        )

    return alarms
