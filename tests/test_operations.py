import argparse
import datetime as dt
import importlib.util
import json
import os
import subprocess
from pathlib import Path

import pytest

import tankapp
from polling_plan import RequestSchedule, collector_lock, load_plan, validate_sets


def uid(number):
    return f"00000000-0000-0000-0000-{number:012d}"


def payload():
    return {
        "sets": {
            "Frankfurt": {"label": "Frankfurt", "batch": [uid(1)]},
            "Gütersloh": {"label": "Gütersloh", "batch": [uid(2)]},
        }
    }


def save_day(root, kind, date):
    path = (
        root / kind / f"{date.year:04}" / f"{date.month:02}" / f"{date}-{kind}.csv.gz"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"offline test file")
    return path


def sync_args(tmp_path, days=3):
    return argparse.Namespace(archive_dir=tmp_path, days=days, since=None, netrc=None)


def fake_downloader(root, calls, skip=None):
    def run(name, args):
        calls.append((name, args))
        assert name == "fetch_history.py"
        assert args[args.index("--kind") + 1] == "both"
        assert "--no-prompt" in args
        day = args[args.index("--since") + 1]
        stop = args[args.index("--until") + 1]
        while day <= stop:
            for kind in ("prices", "stations"):
                if (day, kind) != skip:
                    save_day(root, kind, day)
            day += dt.timedelta(days=1)

    return run


def test_nas_sync_pins_start_and_recovers_old_gaps_after_offline(tmp_path, monkeypatch):
    calls = []
    missing = dt.date(2026, 9, 6)
    monkeypatch.setattr(
        tankapp, "run_tool", fake_downloader(tmp_path, calls, (missing, "prices"))
    )
    args = sync_args(tmp_path)
    assert tankapp.history_sync(args, dt.date(2026, 9, 8)) == 2
    state_path = tmp_path / ".sync/state.json"
    state = json.loads(state_path.read_text())
    assert state["archive_since"] == "2026-09-05"
    assert state["missing_files"] == 1
    assert "last_complete_until" not in state
    monkeypatch.setattr(tankapp, "run_tool", fake_downloader(tmp_path, calls))
    assert tankapp.history_sync(args, dt.date(2026, 9, 20)) == 0
    state = json.loads(state_path.read_text())
    assert state["archive_since"] == "2026-09-05"
    assert state["last_complete_until"] == "2026-09-19"
    assert state["missing_files"] == 0
    assert calls[-1][1][calls[-1][1].index("--since") + 1] == dt.date(2026, 9, 5)
    assert tankapp.date_files(tmp_path, "prices")[missing].exists()


def test_failed_sync_keeps_files_and_last_success(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(tankapp, "run_tool", fake_downloader(tmp_path, calls))
    args = sync_args(tmp_path)
    assert tankapp.history_sync(args, dt.date(2026, 9, 8)) == 0
    before = tankapp.date_files(tmp_path, "prices")

    def fail(*args):
        raise subprocess.CalledProcessError(1, ["offline"])

    monkeypatch.setattr(tankapp, "run_tool", fail)
    assert tankapp.history_sync(args, dt.date(2026, 9, 9)) == 2
    state = json.loads((tmp_path / ".sync/state.json").read_text())
    assert state["last_complete_until"] == "2026-09-07"
    assert state["status"] == "incomplete"
    assert tankapp.date_files(tmp_path, "prices") == before


def test_larger_history_retains_older_existing_files(tmp_path, monkeypatch):
    old = save_day(tmp_path, "prices", dt.date(2026, 8, 1))
    partial = old.with_suffix(".gz.part")
    partial.write_bytes(b"in progress")
    calls = []
    monkeypatch.setattr(tankapp, "run_tool", fake_downloader(tmp_path, calls))
    args = sync_args(tmp_path, days=7)
    assert tankapp.history_sync(args, dt.date(2026, 9, 8)) == 0
    assert (
        json.loads((tmp_path / ".sync/state.json").read_text())["archive_since"]
        == "2026-08-01"
    )
    assert partial.exists()  # never considered a completed download or deleted


def test_complete_sync_skips_archive_until_new_day(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(tankapp, "run_tool", fake_downloader(tmp_path, calls))
    args = sync_args(tmp_path)
    assert tankapp.history_sync(args, dt.date(2026, 9, 8)) == 0
    assert len(calls) == 1
    # Same day again: nothing new can exist → skipped, archive untouched.
    assert tankapp.history_sync(args, dt.date(2026, 9, 8)) == 0
    assert len(calls) == 1
    # Next day: the stop date advances → a real run happens again.
    assert tankapp.history_sync(args, dt.date(2026, 9, 9)) == 0
    assert len(calls) == 2


def test_force_rechecks_despite_complete_state(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(tankapp, "run_tool", fake_downloader(tmp_path, calls))
    args = sync_args(tmp_path)
    assert tankapp.history_sync(args, dt.date(2026, 9, 8)) == 0
    forced = argparse.Namespace(
        archive_dir=tmp_path, days=3, since=None, netrc=None, force=True
    )
    assert tankapp.history_sync(forced, dt.date(2026, 9, 8)) == 0
    assert len(calls) == 2


def test_state_dir_keeps_state_and_lock_out_of_archive(tmp_path, monkeypatch):
    state_dir = tmp_path / "runtime" / "jobs" / "archive-sync"
    args = argparse.Namespace(
        archive_dir=tmp_path, days=3, since=None, netrc=None, state_dir=state_dir
    )
    calls = []
    monkeypatch.setattr(tankapp, "run_tool", fake_downloader(tmp_path, calls))
    assert tankapp.history_sync(args, dt.date(2026, 9, 8)) == 0
    assert (
        json.loads((state_dir / "state.json").read_text())["last_complete_until"]
        == "2026-09-07"
    )
    assert not (tmp_path / ".sync").exists()
    # The relocated state drives the skip, the lock lives with the state.
    assert tankapp.history_sync(args, dt.date(2026, 9, 8)) == 0
    assert len(calls) == 1
    with collector_lock(state_dir):
        with pytest.raises(ValueError, match="bereits"):
            tankapp.history_sync(args, dt.date(2026, 9, 9))


def test_sync_lock_prevents_second_download(tmp_path, monkeypatch):
    monkeypatch.setattr(tankapp, "run_tool", lambda *a: pytest.fail("second download"))
    with collector_lock(tmp_path / ".sync"):
        with pytest.raises(ValueError, match="bereits"):
            tankapp.history_sync(sync_args(tmp_path), dt.date(2026, 9, 8))


def test_request_budget_survives_restart_and_rotates_cities(tmp_path):
    schedule = RequestSchedule(tmp_path, 300)
    schedule.clock = lambda: 1000
    assert schedule.claim(2) == 0
    with pytest.raises(ValueError, match="Abstand"):
        schedule.claim(2)
    restarted = RequestSchedule(tmp_path, 300)
    restarted.clock = lambda: 1299
    assert restarted.wait_seconds() == 1
    restarted.clock = lambda: 1300
    assert restarted.claim(2) == 1
    restarted.clock = lambda: 1600
    assert restarted.claim(2) == 0


def test_plan_limits_and_city_identity(tmp_path):
    data = payload()
    path = tmp_path / "polling.json"
    path.write_text(json.dumps(data))
    assert [group["label"] for group in load_plan(path)] == ["Frankfurt", "Gütersloh"]
    assert len(load_plan(path, "Gütersloh")) == 1
    with pytest.raises(ValueError):
        load_plan(path, "missing")
    data["sets"]["Gütersloh"]["batch"] = [uid(1)]
    with pytest.raises(ValueError, match="UUID"):
        validate_sets(data)
    data["sets"]["Gütersloh"]["batch"] = [uid(i) for i in range(10, 21)]
    with pytest.raises(ValueError, match="1–10"):
        validate_sets(data)


@pytest.fixture
def collector():
    path = Path(__file__).resolve().parents[1] / "data-tools/collect_prices.py"
    spec = importlib.util.spec_from_file_location("test_collector_operations", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_collector_once_rotates_and_writes_existing_snapshot_schema(
    collector, tmp_path, monkeypatch
):
    path = tmp_path / "polling.json"
    path.write_text(json.dumps(payload()))
    clock = [1000.0]
    monkeypatch.setattr(collector.time, "time", lambda: clock[0])
    monkeypatch.setattr(
        collector.time,
        "sleep",
        lambda seconds: clock.__setitem__(0, clock[0] + seconds),
    )
    out = tmp_path / "buffer"
    args = ["--poll-json", str(path), "--out", str(out), "--once", "--demo"]
    assert collector.main(args) == 0
    assert collector.main(args) == 0
    rows = [
        json.loads(line)
        for file in out.glob("*.jsonl")
        for line in file.read_text().splitlines()
    ]
    assert [row["city"] for row in rows] == ["Frankfurt", "Gütersloh"]
    assert list(rows[0]["prices"]) == [uid(1)]
    assert list(rows[1]["prices"]) == [uid(2)]
    assert clock[0] >= 1300
    assert all(dt.datetime.fromisoformat(row["fetched_at"]).tzinfo for row in rows)


def test_collector_once_error_returns_failure_without_retrying(
    collector, tmp_path, monkeypatch
):
    path = tmp_path / "polling.json"
    path.write_text(json.dumps(payload()))
    clock = [1000.0]
    monkeypatch.setattr(collector.time, "time", lambda: clock[0])
    monkeypatch.setattr(
        collector.time,
        "sleep",
        lambda seconds: clock.__setitem__(0, clock[0] + seconds),
    )
    calls = []

    def fail(*args):
        calls.append(1)
        raise RuntimeError("offline test")

    monkeypatch.setattr(collector, "fetch_prices", fail)
    assert (
        collector.main(
            [
                "--poll-json",
                str(path),
                "--out",
                str(tmp_path / "buffer"),
                "--once",
                "--api-key",
                uid(999),
            ]
        )
        == 1
    )
    assert len(calls) == 1
    assert not list((tmp_path / "buffer").glob("*.jsonl"))


def test_add_city_needs_no_price_history_preserves_frankfurt(tmp_path, monkeypatch):
    active = tmp_path / "active.json"
    before = {"sets": {"Frankfurt": payload()["sets"]["Frankfurt"]}, "custom": "keep"}
    active.write_text(json.dumps(before))
    config = tmp_path / "config.json"
    config.write_text(
        json.dumps(
            {"home": {"Gütersloh": [51.90, 8.38]}, "subdiv": {"Frankfurt": "HE"}}
        )
    )
    stations = tmp_path / "stations.csv"
    stations.write_text(
        f"uuid,latitude,longitude,name,brand\n{uid(2)},51.901,8.381,Near station,Brand\n"
    )
    proposal = tmp_path / "proposal.json"
    monkeypatch.setattr(
        tankapp, "run_tool", lambda *a: pytest.fail("no downloads needed")
    )
    args = [
        "add-city",
        "--polling",
        str(active),
        "--config",
        str(config),
        "--stations",
        str(stations),
        "--out",
        str(proposal),
    ]
    assert tankapp.main(args) == 0
    result = json.loads(proposal.read_text())
    assert result["sets"]["Frankfurt"] == before["sets"]["Frankfurt"]
    assert result["sets"]["Gütersloh"]["batch"] == [uid(2)]
    assert result["custom"] == "keep"
    assert result["proposal"] is True
    assert json.loads(active.read_text()) == before
    assert json.loads(config.read_text())["subdiv"] == {
        "Frankfurt": "HE",
        "Gütersloh": "NW",
    }
    assert tankapp.main([*args, "--out", str(active)]) == 1
    assert json.loads(active.read_text()) == before


@pytest.mark.skipif(os.name != "posix", reason="Pi activation uses systemd")
def test_activate_rolls_back_on_restart_failure(tmp_path, monkeypatch):
    old = {"sets": {"Frankfurt": payload()["sets"]["Frankfurt"]}}
    active = tmp_path / "active.json"
    active.write_text(json.dumps(old))
    proposal = tmp_path / "proposal.json"
    proposal.write_text(json.dumps(payload()))
    monkeypatch.setattr(tankapp, "ROOT", tmp_path)
    monkeypatch.setattr(tankapp, "ACTIVE", active)
    monkeypatch.setattr(tankapp.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(tankapp.os, "chown", lambda *a: None, raising=False)
    calls = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        if cmd[1] == "restart" and sum(c[1] == "restart" for c in calls) == 1:
            raise subprocess.CalledProcessError(1, cmd)
        return subprocess.CompletedProcess(
            cmd,
            0,
            stdout=f"/usr/bin/python3 {tmp_path}/data-tools/collect_prices.py",
        )

    monkeypatch.setattr(tankapp.subprocess, "run", run)
    with pytest.raises(ValueError, match="wiederhergestellt"):
        tankapp.activate(argparse.Namespace(proposal=proposal))
    assert json.loads(active.read_text()) == old
    assert len(list((tmp_path / "data/setup").glob("polling-backup-*.json"))) == 1
    assert sum(cmd[1] == "restart" for cmd in calls) == 2


def test_history_default_is_one_year_without_a_retention_delete():
    args = tankapp.parser().parse_args(["history-sync"])
    assert args.days == 365
    assert args.since is None


def test_nas_download_reuses_existing_uncompressed_day(tmp_path, monkeypatch):
    import fetch_history

    dest = tmp_path / "2026-09-07-prices.csv.gz"
    dest.with_suffix("").write_text("date,station_uuid,e10\n")
    monkeypatch.setattr(
        fetch_history, "fetch", lambda *a: pytest.fail("unnecessary download")
    )
    args = argparse.Namespace(force=False, reuse_existing_format=True)
    assert fetch_history.download("unused", str(dest), {}, args) == ("skip", 0)
    assert not dest.exists()


def test_cold_start_without_persistent_schedule_waits(tmp_path, monkeypatch):
    import time

    monkeypatch.setattr(time, "time", lambda: 1000)
    schedule = RequestSchedule(tmp_path, 300, cold_start=True)
    assert schedule.wait_seconds() == 300
    with pytest.raises(ValueError, match="Abstand"):
        schedule.claim(2)
