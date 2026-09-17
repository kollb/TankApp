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

import datetime as dt
from pathlib import Path
from typing import Any

from .backup import backup_status, stale_message
from .data import (
    PRICE_PLAUSIBLE_MAX,
    PRICE_PLAUSIBLE_MIN,
    implausible_price_status,
    publication_status,
    selection_publication,
)
from .feedback import FEEDBACK_MAX_BYTES

UTC = dt.timezone.utc


def _mb(size: int | None) -> str:
    """Byte als MB in de-DE — der Alarm nennt die Größe, nicht nur den Code."""
    if size is None:
        return "unbekannter Größe"
    return f"{size / 1_000_000:.1f} MB".replace(".", ",")


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
    clock=None,
    backup: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Fasst die vorhandenen Zustandsprüfungen zu einem ``alarms[]``-Block zusammen."""
    alarms: list[dict[str, Any]] = []

    if polling_error:
        # B21: Polling-Set fehlt → Hauptgrund für „Keine Stadt eingerichtet“
        # + „Ehrlich statt geschätzt / Noch kein frischer Preis“ trotz
        # Collector-✓ und Influx-✓. Actionable Copy: Wo liegt die Datei und
        # wie wird sie repariert (Pi → data/analysis/stations/polling.json,
        # NAS → TANKAPP_POLLING_FILE).
        if polling_error == "polling_missing":
            polling_path = str(
                getattr(settings, "polling", "data/analysis/stations/polling.json")
            )
            alarms.append(
                {
                    "code": polling_error,
                    "severity": "error",
                    "message": (
                        f"Polling-Set fehlt ({polling_path}) — keine Stadt eingerichtet. "
                        "Auf dem Pi data/analysis/stations/polling.json erzeugen "
                        "(docs/INSTALL.md Abschnitt Polling-Set), auf dem NAS "
                        "TANKAPP_POLLING_FILE prüfen und ops/nas/preflight.sh ausführen. "
                        "Collector-Herzschlag ✓ und InfluxDB ✓ nützen ohne Polling-Set nichts."
                    ),
                }
            )
        else:
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

    # O22: Veröffentlichung der Prognosen — Größe und Lesbarkeit. Vor 0.44.0
    # fiel eine Datei über dem Leselimit still als ``{}`` aus, also als „noch
    # keine Daten“: keine Prognosen, keine Fenster, keine Laborwerte — während
    # ``/api/v1/jobs/models/log`` Erfolg meldete. Jetzt ist die Größe ein
    # Zustand mit Budget (warn) und Klippe (error).
    try:
        publication = publication_status(settings)
    except Exception:
        publication = {}
    if publication.get("error_code") == "publication_unreadable":
        reason = publication.get("reason")
        if reason == "too_large":
            message = (
                f"Die Veröffentlichung der Prognosen ist {_mb(publication.get('bytes'))} "
                f"groß und passt nicht durch das Leselimit von "
                f"{_mb(publication.get('max_bytes'))} — die App zeigt deshalb "
                "überall „keine Prognose“. Seit 0.49.0 schreibt der Modell-Lauf "
                "eine Datei je Station; bleibt eine Datei darüber, Stationszahl "
                "oder Prognose-Horizonte prüfen."
            )
        elif reason == "incomplete":
            message = (
                "Die Veröffentlichung der Prognosen ist unvollständig — "
                "mindestens eine Stations-Datei fehlt oder ist nicht lesbar. "
                "Die übrigen Prognosen bleiben verfügbar; der nächste "
                "Modell-Lauf schreibt die Datei neu."
            )
        else:
            message = (
                "Die Veröffentlichung der Prognosen ist nicht lesbar "
                "(ungültiges JSON) — Prognosen, Fenster und Laborwerte fehlen, "
                "bis der nächste Modell-Lauf sie neu schreibt."
            )
        alarms.append(
            {
                "code": "publication_unreadable",
                "severity": "error",
                "message": message,
                "bytes": publication.get("bytes"),
                "max_bytes": publication.get("max_bytes"),
                "reason": reason,
            }
        )
    elif publication.get("over_budget"):
        alarms.append(
            {
                "code": "publication_large",
                "severity": "warn",
                "message": (
                    f"Die Veröffentlichung der Prognosen ist {_mb(publication.get('bytes'))} "
                    f"groß — über dem Budget von "
                    f"{_mb(publication.get('budget_bytes'))}. Sie bleibt lesbar; "
                    f"weitere Stationen oder Kraftstoffe kippen sie über das "
                    f"Leselimit von {_mb(publication.get('max_bytes'))}."
                ),
                "bytes": publication.get("bytes"),
                "budget_bytes": publication.get("budget_bytes"),
            }
        )

    # O35: Ein Live-Preis außerhalb 0,40–5,00 €/L ist ein API-Artefakt — er
    # wird nicht als Preis publiziert, aber der Vorfall soll sichtbar sein,
    # statt still die Sortierung zu überspringen. Nur ein lokaler Read des
    # Zählers (Healthcheck-Budget bleibt).
    implausible = implausible_price_status(
        settings, clock=clock or (lambda: dt.datetime.now(UTC))
    )
    if implausible.get("count_24h"):
        count = int(implausible["count_24h"])
        lo = f"{PRICE_PLAUSIBLE_MIN:.2f}".replace(".", ",")
        hi = f"{PRICE_PLAUSIBLE_MAX:.2f}".replace(".", ",")
        alarms.append(
            {
                "code": "price_implausible",
                "severity": "warn",
                "message": (
                    f"{'Ein Live-Preis' if count == 1 else f'{count} Live-Preise'} "
                    f"der letzten 24 Stunden liegt außerhalb der Grenzen "
                    f"{lo}–{hi} €/L und wurde nicht als Preis veröffentlicht — "
                    "die Station bleibt sichtbar, Empfehlung und Sortierung "
                    "nutzen den Wert nicht. Bei Dauerbetrieb die Preisquelle prüfen."
                ),
                "count_24h": count,
                "last_at": implausible.get("last_at"),
            }
        )

    # O33: Backup-Alterung. Stirbt der Cron (NAS-Update, Pfad umbenannt,
    # Volume ausgehängt), meldete bisher nichts — der Verlust fiel erst beim
    # Restore auf. Nur ``stat`` über das Backup-Ziel, kein Netz.
    if backup is None:
        try:
            backup = backup_status(settings, clock=clock)
        except Exception:
            backup = {}
    if backup.get("stale"):
        alarms.append(
            {
                "code": "backup_stale",
                "severity": "warn",
                "message": stale_message(backup),
                "reason": backup.get("reason"),
                "age_hours": backup.get("age_hours"),
                "newest_at": backup.get("newest_at"),
            }
        )

    # A12/A13: Station-Lebenszyklus und Preis-Zwillinge aus dem Selektions-Artefakt.
    # Keine neuen Netz-/Influx-Zugriffe — nur die lokale JSON lesen (Health-Budget).
    # Tote Stationen und Zwillinge sind Warnungen (gelb), kein Fehler; Zwillinge
    # werden nie automatisch aus dem Polling-Set entfernt (Dauer-partial braucht Bestätigung).
    try:
        import json as _json

        # O23: derselbe memoisierte Leser wie /api/v1/selection. Vorher parste
        # dieser Healthcheck-Pfad die Selektions-Datei selbst — zusammen mit
        # der Veröffentlichung also zwei komplette Parses je /health.
        sel_raw = selection_publication(settings)
        # Fallback: einzelne Fuel-Dateien, falls current.json noch nicht da
        if "by_fuel" not in sel_raw or not sel_raw.get("by_fuel"):
            by_fuel_tmp = {}
            for _fuel in ("e10", "e5", "diesel"):
                _p = (
                    Path(getattr(settings, "runtime", "."))
                    / "selection"
                    / f"{_fuel}.json"
                )
                try:
                    if _p.is_file() and _p.stat().st_size < 5_000_000:
                        _d = _json.loads(_p.read_text(encoding="utf-8-sig"))
                        if isinstance(_d, dict) and _d.get("cities"):
                            by_fuel_tmp[_fuel] = _d
                except Exception:
                    continue
            if by_fuel_tmp:
                sel_raw = {"by_fuel": by_fuel_tmp}
        if "by_fuel" in sel_raw:
            total_dead = 0
            total_closed = 0
            total_nofuel = 0
            total_twins = 0
            twin_details: list[str] = []
            for _fuel, _fdata in (sel_raw.get("by_fuel") or {}).items():
                if not isinstance(_fdata, dict):
                    continue
                totals = _fdata.get("lifecycle_totals") or {}
                total_dead += int(totals.get("dead", 0) or 0)
                total_closed += int(totals.get("closed", 0) or 0)
                total_nofuel += int(totals.get("no_fuel", 0) or 0)
                twins = _fdata.get("price_twins") or []
                total_twins += len(twins)
                for _t in twins[:2]:
                    _a = _t.get("station_a") or _t.get("a")
                    _b = _t.get("station_b") or _t.get("b")
                    if _a and _b:
                        twin_details.append(f"{_a} / {_b} ({_fuel})")
                if not totals:
                    for _c in _fdata.get("cities", []) or []:
                        total_dead += len(_c.get("dead_stations", []) or [])
                        total_closed += len(_c.get("closed_stations", []) or [])
                        total_nofuel += len(_c.get("nofuel_stations", []) or [])
            if total_dead:
                alarms.append(
                    {
                        "code": "stations_dead",
                        "severity": "warn",
                        "message": (
                            f"{total_dead} Station(en) ohne Preis seit Tagen — aus dem Ranking genommen. "
                            "Sie zählen nicht mehr als Vergleich; gepollt werden sie weiter, "
                            "bis das Polling-Set per Tausch-Anleitung bereinigt ist."
                        ),
                    }
                )
            if total_closed or total_nofuel:
                if total_closed and total_nofuel:
                    msg = f"{total_closed} temporär geschlossen, {total_nofuel} führt diesen Kraftstoff nicht."
                elif total_closed:
                    msg = f"{total_closed} Station(en) temporär geschlossen."
                else:
                    msg = f"{total_nofuel} Station(en) führt diesen Kraftstoff nicht."
                alarms.append(
                    {
                        "code": "stations_lifecycle",
                        "severity": "warn",
                        "message": msg
                        + " Sie bleiben unterscheidbar — nur tote fallen aus dem Ranking.",
                    }
                )
            if total_twins:
                twin_hint = (
                    f" Beispiel: {', '.join(twin_details[:2])}." if twin_details else ""
                )
                alarms.append(
                    {
                        "code": "price_twins",
                        "severity": "warn",
                        "message": (
                            f"{total_twins} Preis-Zwilling(e) erkannt — identische Verläufe über 28 Tage."
                            f"{twin_hint} Keine automatische Entfernung aus dem Polling-Set — im System-Tab prüfen und bestätigen."
                        ),
                    }
                )
    except Exception:
        pass

    return alarms
