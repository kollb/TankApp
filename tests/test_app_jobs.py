import argparse
import datetime as dt
import json
import os
import subprocess

import pytest

from app.config import Settings
from app.refresh import refresh
from app.worker import run

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"


@pytest.fixture
def model_setup(tmp_path, observations, monkeypatch):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "batch": [UID],
                        "stations": [{"uuid": UID, "name": "One"}],
                    },
                    "Gütersloh": {
                        "batch": [OTHER],
                        "stations": [{"uuid": OTHER, "name": "Two"}],
                    },
                }
            }
        )
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\nTANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=private-token\n"
    )
    settings = Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
        model_fuels=("e10",),
    )
    history = tmp_path / "history.csv.gz"
    observations(days=35).assign(
        station_id=UID, city="Frankfurt", source="history"
    ).drop(columns="status").to_csv(history, index=False)
    live = observations(days=1, start="2026-08-05").assign(
        station_id=UID, city="Frankfurt"
    )

    def export(cfg, start, stop, lookup, fuel, output, uuid_only):
        assert uuid_only
        output.parent.mkdir(parents=True, exist_ok=True)
        live.to_csv(output, index=False)

    monkeypatch.setattr("export_influx.export_prices", export)
    monkeypatch.setattr(
        "app.history.prepare_archive",
        lambda *a: ([history], {"events": 1, "missing_days": 0}),
    )
    monkeypatch.setattr(
        "engine.backtest.run_backtest",
        lambda *a, **kw: ({"metrics": {"points": 10, "mae_ct": 1.2}}, None),
    )
    return settings


def test_refresh_warmstarts_without_months_of_polling_and_marks_retained_model(
    model_setup,
):
    output = model_setup.runtime / "engine/current.json"
    output.parent.mkdir(parents=True)
    old = {
        "forecasts": [
            {
                "station_id": OTHER,
                "city": "Gütersloh",
                "fuel": "E10",
                "origin": "2026-06-01T00:00:00Z",
                "points": [],
            }
        ]
    }
    output.write_text(json.dumps(old))
    result = refresh(model_setup, dt.datetime(2026, 8, 6, tzinfo=dt.timezone.utc))
    assert result["state"] == "partial"
    publication = json.loads(output.read_text())
    assert publication["calibrated"] is False and publication["decision_ready"] is False
    by_id = {row["station_id"]: row for row in publication["forecasts"]}
    assert by_id[UID]["points"] and by_id[UID]["retained_previous"] is False
    assert by_id[OTHER]["origin"] == old["forecasts"][0]["origin"]
    assert by_id[OTHER]["retained_previous"] is True
    assert publication["policies"][0]["mode"] == "bootstrap"
    assert (output.parent / publication["model_file"]).exists()


def test_no_successful_fits_keep_last_good_publication(
    model_setup, monkeypatch, capsys
):
    path = model_setup.runtime / "engine/current.json"
    path.parent.mkdir(parents=True)
    path.write_text('{"published_at":"last-good","forecasts":[]}')
    before = path.read_bytes()

    def fail(*a):
        raise ValueError("insufficient data")

    monkeypatch.setattr("engine.models.fit", fail)
    result = refresh(model_setup, dt.datetime(2026, 8, 6, tzinfo=dt.timezone.utc))
    assert result["state"] == "waiting"
    assert path.read_bytes() == before
    attempt = json.loads((model_setup.runtime / "engine/last-attempt.json").read_text())
    assert attempt["failures"][0]["detail"] == "insufficient data"
    assert "insufficient data" in capsys.readouterr().out


def test_failed_publication_write_preserves_previous_version(model_setup, monkeypatch):
    import engine.storage

    path = model_setup.runtime / "engine/current.json"
    path.parent.mkdir(parents=True)
    path.write_text('{"forecasts":[]}')
    before = path.read_bytes()
    real = engine.storage.write_json

    def fail(target, payload):
        if target == path:
            raise OSError("disk unavailable")
        return real(target, payload)

    monkeypatch.setattr(engine.storage, "write_json", fail)
    with pytest.raises(OSError):
        refresh(model_setup, dt.datetime(2026, 8, 6, tzinfo=dt.timezone.utc))
    assert path.read_bytes() == before


def test_worker_records_failure_without_secret_and_keeps_last_success(
    tmp_path, monkeypatch, capsys
):
    settings = Settings(data=tmp_path)
    state_path = settings.runtime / "jobs/models.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text('{"last_success_at":"2026-09-01T00:00:00Z"}')

    def fail(*a):
        raise ValueError("secret-token-must-not-appear")

    monkeypatch.setattr("app.worker.execute", fail)
    assert run("models", settings) == 2
    state = json.loads(state_path.read_text())
    assert state["state"] == "failed" and state["next_run_at"]
    assert state["last_success_at"] == "2026-09-01T00:00:00Z"
    assert "secret-token" not in state_path.read_text()
    capture = capsys.readouterr()
    assert "secret-token" not in capture.out + capture.err


def test_archive_without_credentials_never_starts_downloader(tmp_path, monkeypatch):
    settings = Settings(data=tmp_path, netrc=tmp_path / "missing")
    monkeypatch.setattr(
        "tankapp.history_sync", lambda *a: pytest.fail("download must not start")
    )
    assert run("archive", settings) == 2
    assert (
        json.loads((settings.runtime / "jobs/archive.json").read_text())["error_code"]
        == "archive_not_configured"
    )


def test_nas_up_reuses_influx_and_mounts_secrets_read_only(
    model_setup, monkeypatch, tmp_path
):
    import app.nas as nas

    monkeypatch.setattr(nas, "ROOT", tmp_path)
    monkeypatch.setattr("tankapp.netrc_args", lambda *a: [])
    calls = []

    def command(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(nas.subprocess, "run", command)
    args = argparse.Namespace(
        polling=model_setup.polling,
        influx_env=model_setup.influx_env,
        archive_dir=model_setup.archive,
        runtime_dir=model_setup.runtime,
    )
    assert nas.up(args) == 0
    assert calls[-1][0][-4:] == ["up", "-d", "--build", "--force-recreate"]
    env = calls[-1][1]["env"]
    assert env["TANKAPP_INFLUX_ENV"] == str(model_setup.influx_env)
    assert "TANKAPP_INFLUX_TOKEN" not in env
    stored = (tmp_path / "data/nas-settings.json").read_text()
    assert "private-token" not in stored
    assert json.loads(stored)["history_days"] == 365
    assert model_setup.polling.read_text().count(UID) == 2  # no active-set changes


def test_nas_up_applies_and_remembers_explicit_container_uid_gid(
    model_setup, monkeypatch, tmp_path
):
    import app.nas as nas

    monkeypatch.setattr(nas, "ROOT", tmp_path)
    monkeypatch.setattr("tankapp.netrc_args", lambda *a: [])
    calls = []

    def command(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(nas.subprocess, "run", command)
    args = argparse.Namespace(
        polling=model_setup.polling,
        influx_env=model_setup.influx_env,
        archive_dir=model_setup.archive,
        runtime_dir=model_setup.runtime,
        uid=99,
        gid=100,
    )
    assert nas.up(args) == 0
    env = calls[-1][1]["env"]
    assert env["TANKAPP_UID"] == "99" and env["TANKAPP_GID"] == "100"
    stored = json.loads((tmp_path / "data/nas-settings.json").read_text())
    assert stored["uid"] == 99 and stored["gid"] == 100
    # A later run without flags keeps the stored Unraid IDs.
    calls.clear()
    assert (
        nas.up(
            argparse.Namespace(
                polling=model_setup.polling,
                influx_env=model_setup.influx_env,
                archive_dir=model_setup.archive,
                runtime_dir=model_setup.runtime,
            )
        )
        == 0
    )
    env = calls[-1][1]["env"]
    assert env["TANKAPP_UID"] == "99" and env["TANKAPP_GID"] == "100"


def test_nas_up_defaults_to_executing_user_without_flags(
    model_setup, monkeypatch, tmp_path
):
    import app.nas as nas

    monkeypatch.setattr(nas, "ROOT", tmp_path)
    monkeypatch.setattr("tankapp.netrc_args", lambda *a: [])
    monkeypatch.delenv("SUDO_UID", raising=False)
    monkeypatch.delenv("SUDO_GID", raising=False)
    calls = []

    def command(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(nas.subprocess, "run", command)
    assert (
        nas.up(
            argparse.Namespace(
                polling=model_setup.polling,
                influx_env=model_setup.influx_env,
                archive_dir=model_setup.archive,
                runtime_dir=model_setup.runtime,
            )
        )
        == 0
    )
    env = calls[-1][1]["env"]
    assert env["TANKAPP_UID"] == str(os.getuid())
    assert env["TANKAPP_GID"] == str(os.getgid())


def test_nas_container_rejects_host_localhost_url(model_setup, monkeypatch, tmp_path):
    import app.nas as nas

    monkeypatch.setattr(nas, "ROOT", tmp_path)
    model_setup.influx_env.write_text(
        model_setup.influx_env.read_text().replace(
            "http://nas:8086", "http://localhost:8086"
        )
    )
    monkeypatch.setattr(
        nas.subprocess, "run", lambda *a, **kw: pytest.fail("Docker must not start")
    )
    with pytest.raises(ValueError, match="LAN-Adresse"):
        nas.up(
            argparse.Namespace(
                polling=model_setup.polling, influx_env=model_setup.influx_env
            )
        )


@pytest.mark.parametrize("failure", [PermissionError("private-path"), 1])
def test_scheduler_retries_failed_starts_and_exposes_safe_status(
    tmp_path, monkeypatch, failure
):
    from app.server import Scheduler
    from app.data import LiveData

    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    scheduler = Scheduler(settings)
    calls = []

    def once(name):
        calls.append(name)
        if isinstance(failure, Exception):
            raise failure
        return failure

    def wait(delay):
        assert delay == 3600
        scheduler.stop_event.set()

    monkeypatch.setattr(scheduler, "run_once", once)
    monkeypatch.setattr(scheduler.stop_event, "wait", wait)
    scheduler.loop("archive")
    assert calls == ["archive"]
    live = LiveData(settings)
    live.job_errors = scheduler.errors
    state = live.health()["jobs"]["archive"]
    assert state["state"] == "failed"
    assert state["error_code"] == "job_start_failed"
    assert "private-path" not in json.dumps(state)


def test_archive_worker_uses_explicit_berlin_calendar(tmp_path, monkeypatch):
    import app.worker as worker

    netrc = tmp_path / "netrc"
    netrc.write_text("private")
    received = {}

    def sync(args, *, today):
        received["today"] = today
        return 0

    monkeypatch.setattr(worker.tankapp, "history_sync", sync)
    settings = Settings(data=tmp_path, netrc=netrc)
    assert worker.execute("archive", settings)["state"] == "success"
    assert isinstance(received["today"], dt.date)
