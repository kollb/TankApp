"""Supervised NAS jobs. No interactive prompts, no unchecked error text in status files."""

import argparse
import datetime as dt
import os
import sys
from zoneinfo import ZoneInfo

import tankapp
from polling_plan import atomic_json
from .config import Settings
from .data import read_json


INTERVALS = {
    "archive": 3600,
    "models": 86400,
    "selection": 86400,
    "settlement": 1800,
}


def execute(name, settings):
    if name == "settlement":
        from .settlement import run_settlement_job

        return run_settlement_job(settings)

    if name == "archive":
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
            from .selection import build_selection
            from engine.storage import write_json

            result = build_selection(
                settings, fuels=list(settings.model_fuels), n_boot=2000
            )
            out = settings.runtime / "selection" / "current.json"
            write_json(out, result)
            if result.get("count", 0) == 0:
                return {
                    "state": "waiting",
                    "error_code": result.get("error_code") or "selection_not_available",
                }
            return {"state": "success", "error_code": None}
        except ModuleNotFoundError:
            raise
        except Exception as exc:
            print(
                f"selection: {type(exc).__name__}; Details werden nicht ausgegeben.",
                file=sys.stderr,
                flush=True,
            )
            return {"state": "failed", "error_code": "selection_failed"}

    from .refresh import refresh

    outcome = refresh(settings)
    # After successful model refresh, also try to update selection (best effort)
    if outcome.get("state") in ("success", "partial"):
        try:
            from .selection import build_selection
            from engine.storage import write_json

            sel = build_selection(
                settings, fuels=list(settings.model_fuels), n_boot=2000
            )
            write_json(settings.runtime / "selection" / "current.json", sel)
        except Exception:
            # Selection failure must not fail model job
            pass
    return outcome


def run(name, settings):
    path = settings.runtime / "jobs" / f"{name}.json"
    before = read_json(path, {})
    before = before if isinstance(before, dict) else {}
    started = dt.datetime.now(dt.timezone.utc)
    # Issue 50: Daten-Watermark des auslösenden Webhooks (Epochensekunden).
    # Der Scheduler nutzt sie für die Idempotenz-Entscheidung; sie wird nur
    # bei Erfolg im Job-Status verankert.
    trigger_watermark = os.environ.get("TANKAPP_TRIGGER_WATERMARK") or None
    state = {
        "state": "running",
        "started_at": started.isoformat(),
        "last_success_at": before.get("last_success_at"),
        "data_watermark": before.get("data_watermark"),
        "error_code": None,
    }
    atomic_json(path, state)
    print(f"{name}: gestartet {started.isoformat()}", flush=True)

    def finish(outcome):
        finished = dt.datetime.now(dt.timezone.utc)
        interval = INTERVALS[name] if outcome["state"] == "success" else 3600
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
        print(f"{name}: {state['state']}{suffix}", flush=True)
        return 0 if outcome["state"] == "success" else 2

    try:
        return finish(execute(name, settings))
    except ModuleNotFoundError:
        return finish({"state": "failed", "error_code": "dependencies_missing"})
    except Exception as exc:
        print(
            f"{name}: {type(exc).__name__}; Details/Zugangsdaten werden nicht ausgegeben.",
            file=sys.stderr,
            flush=True,
        )
        return finish({"state": "failed", "error_code": "job_failed"})
    except BaseException:
        finish({"state": "failed", "error_code": "interrupted"})
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Interner NAS-Job; gebündelter Start über tankapp.py nas-up."
    )
    parser.add_argument("job", choices=list(INTERVALS))
    args = parser.parse_args(argv)
    return run(args.job, Settings.from_env())


if __name__ == "__main__":
    sys.exit(main())
