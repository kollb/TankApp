"""Supervised NAS jobs. No interactive prompts, no unchecked error text in status files."""

import argparse
import datetime as dt
import sys
from zoneinfo import ZoneInfo

import tankapp
from polling_plan import atomic_json
from .config import Settings
from .data import read_json


INTERVALS = {"archive": 3600, "models": 86400}


def execute(name, settings):
    if name == "archive":
        if not settings.netrc.is_file() or settings.netrc.stat().st_size == 0:
            return {"state": "waiting", "error_code": "archive_not_configured"}
        # State/lock in the runtime dir (SSD-friendly): the hourly run must
        # not wake a sleeping archive disk (Unraid HDD pools).
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
    from .refresh import refresh

    return refresh(settings)


def run(name, settings):
    path = settings.runtime / "jobs" / f"{name}.json"
    before = read_json(path, {})
    before = before if isinstance(before, dict) else {}
    started = dt.datetime.now(dt.timezone.utc)
    state = {
        "state": "running",
        "started_at": started.isoformat(),
        "last_success_at": before.get("last_success_at"),
        "error_code": None,
    }
    atomic_json(path, state)
    try:
        result = execute(name, settings)
    except ModuleNotFoundError:
        result = {"state": "failed", "error_code": "dependencies_missing"}
    except Exception as exc:
        print(
            f"{name}: {type(exc).__name__}; Details/Zugangsdaten werden nicht ausgegeben.",
            file=sys.stderr,
        )
        result = {"state": "failed", "error_code": "job_failed"}
    finished = dt.datetime.now(dt.timezone.utc)
    interval = INTERVALS[name] if result["state"] == "success" else 3600
    state.update(
        result,
        finished_at=finished.isoformat(),
        next_run_at=(finished + dt.timedelta(seconds=interval)).isoformat(),
    )
    if result["state"] == "success":
        state["last_success_at"] = finished.isoformat()
    atomic_json(path, state)
    print(f"{name}: {state['state']}")
    return 0 if result["state"] == "success" else 2


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Interner NAS-Job; gebündelter Start über tankapp.py nas-up."
    )
    parser.add_argument("job", choices=list(INTERVALS))
    args = parser.parse_args(argv)
    return run(args.job, Settings.from_env())


if __name__ == "__main__":
    sys.exit(main())
