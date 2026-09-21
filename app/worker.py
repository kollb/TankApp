"""Supervised NAS jobs. No interactive prompts, no raw error text in status files.

Scheitert ein Lauf, steht die Ursache bereinigt (ohne Pfade und Zugangsdaten)
in ``runtime/jobs/<job>.json → error_detail``, in ``runtime/jobs/<job>.log``
und damit auch im GUI — siehe ``app/errors.py``.
"""

import argparse
import datetime as dt
import os
import signal
import sys
from zoneinfo import ZoneInfo

import tankapp
from polling_plan import atomic_json
from .config import Settings
from .data import read_json
from .errors import public_detail
from .progress import JobProgress, append_log


INTERVALS = {
    "archive": 3600,
    "models": 86400,
    "selection": 86400,
    "settlement": 1800,
}

# B18: Fehlercodes mit *struktureller* Ursache. Eine Station ohne genug
# Historie wird nicht in einer Stunde fitbar — der Stundentakt verbrennt nur
# NAS-Zeit (im Befund: 24 Läufe/Tag à ~10 min). Für diese Codes fällt der
# nächste Versuch auf das reguläre Intervall des Jobs zurück (models: 1×/Tag);
# alles andere behält den bisherigen schnellen Wiederholungsversuch.
PERSISTENT_ERROR_CODES = frozenset(
    {
        "some_models_unavailable",  # Station strukturell unfitbar
        "insufficient_history",  # keine Station fitbar
        "archive_not_configured",  # Netrc fehlt — ändert sich nicht stündlich
        "influx_not_configured",  # Influx-Zugang fehlt
        "selection_not_available",  # noch keine Artefakte (folgt dem Modell-Lauf)
        # S3: Defekter Feedback-Store — wiederholbare Wiederholungen bringen
        # nichts, bis der Bestand wiederhergestellt ist.
        "store_corrupted",
        "store_too_large",
        # A21-B3.1: Dasselbe für das Archiv — die Retention schreibt erst
        # wieder, wenn der Bestand wiederhergestellt ist.
        "archive_corrupted",
    }
)


class JobAborted(Exception):
    """S4: Der Lauf wurde abgebrochen (SIGTERM) — ab hier kein Commit mehr.

    Wird vom Signal-Handler in den laufenden Code hinein geworfen, damit der
    Lauf bis zu allen Commit-Stellen (Publikationen, Status-Dateien) aufgewickelt
    wird, statt dass der Handler nur den Zustand notiert und der Code
    weiterläuft. Breiter gefangene ``Exception``-Abschnitte auf dem Weg nach
    oben (``app/refresh.py``, ``app/selection.py``, ``app/settlement.py``)
    müssen sie durchreichen (``raise``), sonst verschlucken sie den Abbruch.
    """


# Schneller Wiederholungsversuch nach flüchtigen Fehlern (wie bisher).
TRANSIENT_RETRY_SECONDS = 3600

# B24: Ein liegengebliebener `running`-Zustand gilt nach dieser Zeit als
# Abbruch — derselbe Wert wie die Staleness-Grenze in app/progress.py.
ABORT_STALE_SECONDS = 6 * 3600

_ABORTED_DETAIL = (
    "Lauf hart beendet (z. B. Container-Neustart oder SIGTERM) — "
    "kein Ergebnis veröffentlicht, die letzte gute Publikation bleibt erhalten."
)


def is_transient_error(code: str | None) -> bool:
    """B18: Flüchtig = alles außer den strukturellen Codes (schneller Retry).

    ``None`` (unbekannter/fehlender Code) zählt als flüchtig — lieber einmal
    zu oft versuchen als einen echten Fehler auf den Tagestakt zu vertagen.
    """
    return code not in PERSISTENT_ERROR_CODES


def execute(name, settings, progress=None):
    if name == "settlement":
        from .settlement import run_settlement_job

        if progress:
            progress.phase("settle", message="Snapshots gegen Preishistorie abrechnen")
        return run_settlement_job(settings)

    if name == "archive":
        if progress:
            progress.phase("sync", message="Tankerkönig-Archiv nachladen")
        if not settings.netrc.is_file() or settings.netrc.stat().st_size == 0:
            return {"state": "waiting", "error_code": "archive_not_configured"}
        code = tankapp.history_sync(
            argparse.Namespace(
                archive_dir=settings.archive,
                days=settings.history_days,
                since=None,
                netrc=settings.netrc,
                state_dir=settings.runtime / "jobs" / "archive-sync",
                force=False,
            ),
            today=dt.datetime.now(ZoneInfo("Europe/Berlin")).date(),
        )
        return {
            "state": "success" if code == 0 else "partial",
            "error_code": None if code == 0 else "archive_incomplete",
        }
    if name == "selection":
        try:
            from .config import engine_config
            from .selection import build_selection, publish_selection

            # O36: Die Selektion bekommt die Engine-Konfiguration, keine Zahl.
            # Hier stand B = 2000 als Literal im Job-Dispatcher — eine Änderung
            # von ``bootstrap_samples`` wirkte damit nur in den Modellen, nicht
            # in der Selektion (docs/archiv/OPTIMIERUNGS-BEFUND-2026-09-18.md O36).
            result = build_selection(
                settings,
                fuels=list(settings.model_fuels),
                config=engine_config(settings),
                progress=progress,
            )
            # O41: Der Job veröffentlicht über denselben Schreiber wie
            # refresh() (publish_selection) — dieselbe Form, derselbe
            # Dateibestand. Ein struktureller Grund ohne Daten (polling.json
            # fehlt, Lesefehler) wird **nicht** veröffentlicht — die letzte
            # gute Publikation bleibt stehen, genau wie refresh() bei
            # „waiting“ nichts schreibt. Vorher stand hier eine Fehler-
            # Markierung ohne by_fuel, die der Leser wie ein fehlendes
            # Artefakt behandelte.
            if result.get("error_code") not in (None, "selection_not_available"):
                return {"state": "waiting", "error_code": result["error_code"]}
            publish_selection(
                settings, result["generated_at"], result.get("by_fuel") or {}
            )
            if not result.get("by_fuel"):
                return {"state": "waiting", "error_code": "selection_not_available"}
            return {"state": "success", "error_code": None}
        except (ModuleNotFoundError, JobAborted):
            raise
        except Exception as exc:
            detail = public_detail(exc)
            print(
                f"selection: {detail}",
                file=sys.stderr,
                flush=True,
            )
            return {
                "state": "failed",
                "error_code": "selection_failed",
                "error_detail": detail,
            }

    from .refresh import refresh

    # B21: Selektion läuft bereits in refresh() (je Kraftstoff) und publiziert
    # nach runtime/selection/current.json. Ein zweiter Aufruf hier überschrieb
    # das Artefakt mit abweichender Struktur und „0 Stationen“ (Fortschritt
    # 2/1 bei total=1). Deshalb kein zweiter build_selection-Aufruf mehr —
    # refresh() bleibt die einzige Quelle; der eigenständige Job „selection“
    # rechnet täglich separat.
    return refresh(settings, progress=progress)


def run(name, settings):
    path = settings.runtime / "jobs" / f"{name}.json"
    before = read_json(path, {})
    before = before if isinstance(before, dict) else {}
    started = dt.datetime.now(dt.timezone.utc)
    # Issue 50: Daten-Watermark des auslösenden Webhooks (Epochensekunden).
    # Der Scheduler nutzt sie für die Idempotenz-Entscheidung; sie wird nur
    # bei Erfolg im Job-Status verankert.
    trigger_watermark = os.environ.get("TANKAPP_TRIGGER_WATERMARK") or None
    # B24(b): Ein liegengebliebener `running`-Eintrag ohne lebenden Prozess
    # (Container-Recreate, `docker restart`, SIGKILL) wird hier als `aborted`
    # verbucht statt still überschrieben — die Job-Historie kennt den Abbruch.
    if before.get("state") == "running":
        _mark_prior_aborted(path, name, before, started)
    state = {
        "state": "running",
        "started_at": started.isoformat(),
        "last_success_at": before.get("last_success_at"),
        "data_watermark": before.get("data_watermark"),
        "error_code": None,
    }
    atomic_json(path, state)
    progress = JobProgress(settings, name)
    progress.phase("start", message="Job gestartet")
    print(f"{name}: gestartet {started.isoformat()}", flush=True)

    # B24(a) + S4: SIGTERM-Handler im Job-Prozess. Der Handler schreibt den
    # Zustand als `aborted` samt Abbruchphase **und wirft `JobAborted`** in
    # den laufenden Code: Kehrt er nur zurück, läuft die Arbeit weiter und
    # `finish` drückt `success` über den Abbruch (Prüfstand §5.4 des
    # Befunds). Durch die Ausnahme wird der Lauf bis zu allen Commit-Stellen
    # aufgewickelt — nach dem Abbruch gibt es weder `success` noch eine
    # Veröffentlichung. Die 20-s-Grace-Periode des Containers reicht; der
    # anschließende SIGKILL findet einen ehrlichen Zustand vor.
    previous_handler = None
    abort = {"flag": False}
    if os.name == "posix":

        def _mark_aborted(signum, frame):
            if progress.done:
                return  # beendet — das Ergebnis steht, kein Abbruch mehr
            if abort["flag"]:
                return
            abort["flag"] = True
            finished = dt.datetime.now(dt.timezone.utc)
            record = {
                **state,
                "state": "aborted",
                "finished_at": finished.isoformat(),
                "aborted_at": finished.isoformat(),
                "aborted_phase": progress.phase_key,
                "next_run_at": (
                    finished + dt.timedelta(seconds=TRANSIENT_RETRY_SECONDS)
                ).isoformat(),
                "error_code": "aborted",
                "error_detail": _ABORTED_DETAIL,
            }
            atomic_json(path, record)
            append_log(
                settings.runtime / "jobs" / f"{name}.log",
                f"{finished.isoformat().replace('+00:00', 'Z')} {name}: "
                f"abgebrochen in Phase '{progress.phase_key}' (SIGTERM)",
            )
            raise JobAborted(f"{name}: SIGTERM in Phase '{progress.phase_key}'")

        previous_handler = signal.signal(signal.SIGTERM, _mark_aborted)

    def _finish_aborted() -> int:
        """S4: Abschlussvertrag eines Abbruchs — kein `success` mehr.

        Der Handler hat den `aborted`-Zustand bereits geschrieben; hier
        stehen nur noch Fortschritts-Notiz und ein eigener Exitcode
        (3 = abgebrochen, 0 = Erfolg, 2 = reguläres Versagen), damit
        Überwachungen den Abbruch vom Erfolg trennen können.
        """
        progress.finish(
            "aborted",
            "Abgebrochen (SIGTERM) — kein Ergebnis veröffentlicht.",
        )
        print(f"{name}: abgebrochen (SIGTERM)", flush=True)
        return 3

    def finish(outcome):
        # S4: Trifft SIGTERM zwischen „Arbeit erledigt“ und „Status
        # geschrieben“, gewinnt der Abbruch — `success` nach `aborted`
        # wäre ein widersprüchlicher Zustand.
        if abort["flag"]:
            return _finish_aborted()
        finished = dt.datetime.now(dt.timezone.utc)
        state_value = outcome["state"]
        code = outcome.get("error_code")
        if state_value == "success":
            interval = INTERVALS[name]
        elif is_transient_error(code):
            # Flüchtige Ursache: schneller Wiederholungsversuch (wie bisher).
            interval = TRANSIENT_RETRY_SECONDS
        else:
            # B18: strukturelle Ursache — kein Stundentakt, nächster Versuch
            # erst im regulären Intervall des Jobs (models: 1×/Tag).
            interval = INTERVALS[name]
        state.update(
            outcome,
            finished_at=finished.isoformat(),
            next_run_at=(finished + dt.timedelta(seconds=interval)).isoformat(),
        )
        if outcome["state"] == "success":
            state["last_success_at"] = finished.isoformat()
            if trigger_watermark:
                state["data_watermark"] = trigger_watermark
        atomic_json(path, state)
        suffix = f" ({outcome['error_code']})" if outcome.get("error_code") else ""
        progress.finish(
            state["state"],
            f"{state['state']}{suffix}, Dauer "
            f"{(finished - started).total_seconds() / 60:.1f} min",
        )
        print(f"{name}: {state['state']}{suffix}", flush=True)
        return 0 if outcome["state"] == "success" else 2

    try:
        try:
            return finish(execute(name, settings, progress))
        except JobAborted:
            # S4: SIGTERM mitten in der Arbeit — der `aborted`-Zustand steht,
            # der Lauf endet hier. `finish` (und damit `success`/`failed`)
            # wird nicht mehr erreicht.
            return _finish_aborted()
        except ModuleNotFoundError as exc:
            # Modulname ist Teil der Ursache („No module named pandas“) und trägt
            # keine Interna — deshalb anders als unten bereinigt, aber begrenzt.
            return finish(
                {
                    "state": "failed",
                    "error_code": "dependencies_missing",
                    "error_detail": public_detail(exc, max_len=120),
                }
            )
        except Exception as exc:
            # Bereinigte Ursache: derselbe Text landet in Job-Status, Job-Log und
            # GUI. Rohe Meldungen können Pfade und Zugangsdaten enthalten.
            detail = public_detail(exc)
            progress.note(f"Fehler: {detail}")
            print(f"{name}: {detail}", file=sys.stderr, flush=True)
            return finish(
                {"state": "failed", "error_code": "job_failed", "error_detail": detail}
            )
        except BaseException as exc:
            finish(
                {
                    "state": "failed",
                    "error_code": "interrupted",
                    "error_detail": public_detail(exc, max_len=120),
                }
            )
            raise
    except JobAborted:
        # S4: SIGTERM traf einen Fehlerzweig, der gerade seinen eigenen
        # Status schriebs — der Abbruch gewinnt trotzdem (seine Aufzeichnung
        # liegt vor).
        return _finish_aborted()
    finally:
        if previous_handler is not None:
            signal.signal(signal.SIGTERM, previous_handler)


def _mark_prior_aborted(path, name, before, started):
    """B24(b): Einen `running`-Vorgänger als `aborted` verbuchen.

    Ohne lebenden Prozess ist ein `running`-Eintrag ein hart beendeter Lauf:
    Der einzige Schreiber dieses Zustands ist der Worker selbst, und der
    Scheduler startet nie zwei Prozesse desselben Jobs gleichzeitig.
    """
    phase = None
    progress_raw = read_json(path.with_name(f"{name}.progress.json"), None)
    if isinstance(progress_raw, dict) and not progress_raw.get("done"):
        phase = progress_raw.get("phase")
    finished = dt.datetime.now(dt.timezone.utc)
    atomic_json(
        path,
        {
            "state": "aborted",
            "started_at": before.get("started_at"),
            "finished_at": finished.isoformat(),
            "aborted_at": finished.isoformat(),
            "aborted_phase": phase,
            "next_run_at": (
                finished + dt.timedelta(seconds=TRANSIENT_RETRY_SECONDS)
            ).isoformat(),
            "last_success_at": before.get("last_success_at"),
            "data_watermark": before.get("data_watermark"),
            "error_code": "aborted",
            "error_detail": _ABORTED_DETAIL,
        },
    )
    append_log(
        path.with_name(f"{name}.log"),
        f"{finished.isoformat().replace('+00:00', 'Z')} {name}: "
        f"vorheriger Lauf hart beendet — als abgebrochen verbucht"
        f" (Phase: {phase or 'unbekannt'})",
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Interner NAS-Job; gebündelter Start über tankapp.py nas-up."
    )
    parser.add_argument("job", choices=list(INTERVALS))
    args = parser.parse_args(argv)
    return run(args.job, Settings.from_env())


if __name__ == "__main__":
    sys.exit(main())
