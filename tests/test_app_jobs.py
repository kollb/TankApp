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
NOW = dt.datetime(2026, 9, 8, 10, tzinfo=dt.timezone.utc)


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

    def once(name, watermark=None):
        calls.append(name)
        if isinstance(failure, Exception):
            raise failure
        return failure

    def wait(delay):
        assert delay in (0, 3600)  # 0 = erster Starlauf im Prozess
        if delay == 3600:
            scheduler.stop_event.set()
        return False

    monkeypatch.setattr(scheduler, "run_once", once)
    monkeypatch.setattr(scheduler.wake["archive"], "wait", wait)
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


# ---------------------------------------------------------------------------
# Issue 50: Ereignis-Pipeline — Webhook-Trigger, Debounce, Idempotenz
# ---------------------------------------------------------------------------


def write_job_state(tmp_path, name, *, success_at, watermark=None, state="success"):
    import time as time_mod

    path = tmp_path / "runtime" / "jobs" / f"{name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.fromtimestamp(
        time_mod.time() - success_at, tz=dt.timezone.utc
    ).isoformat()
    path.write_text(
        json.dumps(
            {
                "state": state,
                "last_success_at": stamp,
                "data_watermark": str(watermark) if watermark is not None else None,
                "error_code": None,
            }
        )
    )


def test_trigger_admit_debounce_and_idempotency(tmp_path):
    import time as time_mod

    from app.server import Scheduler

    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    scheduler = Scheduler(settings)
    write_job_state(tmp_path, "models", success_at=100, watermark=42)

    # Innerhalb des Debounce-Fensters wird selbst neue Data nicht sofort
    # verarbeitet (Modell-Läufe werden nicht im 5-Minuten-Takt gefahren).
    scheduler.last_start["models"] = time_mod.monotonic() - 60
    assert scheduler.admit_trigger("models", 43) == "debounced"

    # Nach dem Debounce: gleiche Watermark wie beim letzten Erfolg -> kein Lauf.
    scheduler.last_start["models"] = time_mod.monotonic() - 10_000
    assert scheduler.admit_trigger("models", 42) == "duplicate"
    # Neue Watermark -> Lauf.
    assert scheduler.admit_trigger("models", 43) == "run"

    # Letzter Erfolg älter als das Job-Intervall: Lauf trotz alter Watermark
    # (Prognosefenster bleiben am aktuellen Tag verankert).
    write_job_state(tmp_path, "models", success_at=100_000, watermark=42)
    assert scheduler.admit_trigger("models", 42) == "run"

    # Kaputter Job-Status: nie als "duplicate" fehlinterpretieren.
    (tmp_path / "runtime" / "jobs" / "models.json").write_text("{broken")
    assert scheduler.admit_trigger("models", 42) == "run"

    # Nur Inferenz-Jobs sind triggerbar; Unbekanntes wird abgewiesen.
    assert scheduler.request("settlement", 42)["status"] == "rejected"
    assert scheduler.request("models", 43)["status"] == "queued"
    assert scheduler.pending["models"] == 43
    assert scheduler.wake["models"].is_set()


def test_scheduler_wakes_for_webhook_trigger_and_passes_watermark(
    tmp_path, monkeypatch
):
    import threading
    import time as time_mod

    from app.server import Scheduler

    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    scheduler = Scheduler(settings)
    calls = []
    waits = []

    def once(name, watermark=None):
        calls.append((name, watermark))
        scheduler.last_start[name] = time_mod.monotonic() - 10_000
        write_job_state(tmp_path, name, success_at=0, watermark=watermark)
        return 0

    def wait(delay):
        waits.append(delay)
        if len(waits) == 1:
            assert delay == 0  # erster Lauf im Prozess: sofort
            return False
        if len(waits) >= 3:
            scheduler.stop_event.set()
            return False
        # "Webhook" trifft ein, während der Scheduler eigentlich until tomorrow
        # warten würde (models-Intervall = 86400 s).
        assert delay == 86400
        scheduler.request("models", watermark=1727)
        return True

    monkeypatch.setattr(scheduler, "run_once", once)
    monkeypatch.setattr(scheduler.wake["models"], "wait", wait)
    thread = threading.Thread(target=scheduler.loop, args=("models",), daemon=True)
    thread.start()
    thread.join(timeout=10)
    assert not thread.is_alive()
    assert calls == [("models", None), ("models", 1727)]


def test_worker_records_trigger_watermark_on_success(tmp_path, monkeypatch):
    import app.worker as worker

    monkeypatch.setenv("TANKAPP_TRIGGER_WATERMARK", "1727")
    monkeypatch.setattr(
        worker,
        "execute",
        lambda name, settings: {"state": "success", "error_code": None},
    )
    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    assert worker.run("models", settings) == 0
    state = json.loads((tmp_path / "runtime" / "jobs" / "models.json").read_text())
    assert state["data_watermark"] == "1727"

    # Ohne Trigger bleibt die verankerte Watermark erhalten (Grundlage der
    # Idempotenz-Entscheidung über Neustarts hinweg).
    monkeypatch.delenv("TANKAPP_TRIGGER_WATERMARK")
    monkeypatch.setattr(
        worker,
        "execute",
        lambda name, settings: {"state": "failed", "error_code": "job_failed"},
    )
    assert worker.run("models", settings) == 2
    state = json.loads((tmp_path / "runtime" / "jobs" / "models.json").read_text())
    assert state["state"] == "failed"
    assert state["data_watermark"] == "1727"


def test_health_exposes_watermark_and_trigger_stats(tmp_path):
    """Issue 50: Idempotenz-Anker und Trigger-Statistik sind via /health sichtbar."""
    from app.data import LiveData
    from app.server import Scheduler

    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    scheduler = Scheduler(settings)
    write_job_state(tmp_path, "models", success_at=10, watermark=1727)
    scheduler.trigger_counts["models"] = 3
    scheduler.trigger_skips["models"] = "debounced"
    live = LiveData(settings)
    live.scheduler = scheduler
    jobs = live.health()["jobs"]
    assert jobs["models"]["data_watermark"] == "1727"
    assert jobs["models"]["triggers"] == 3
    assert jobs["models"]["last_trigger_skip"] == "debounced"
    # Nur Inferenz-Jobs tragen Trigger-Statistik; andere Jobs bleiben unberührt.
    assert "triggers" not in jobs["archive"]
    assert "triggers" not in jobs["settlement"]
    assert jobs["settlement"]["data_watermark"] is None
    # Ohne anhängenden Scheduler (Read-Only-Instanz) bleibt das Feld leer.
    assert LiveData(settings).trigger_info() == {}


def test_webhook_endpoint_auth_and_wiring(tmp_path, monkeypatch):
    import threading
    import urllib.request
    from dataclasses import replace

    from app.data import LiveData
    from app.server import Scheduler, make_server

    polling = tmp_path / "polling.json"
    polling.write_text(json.dumps({"sets": {}}))
    static = tmp_path / "web"
    static.mkdir()
    (static / "index.html").write_text("<html>t</html>")
    base_settings = Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "netrc",
        static=static,
    )
    settings = replace(base_settings, webhook_token="secret-token")
    row = {
        "_time": "2026-09-08T09:55:00+00:00",
        "city": "Frankfurt",
        "station_id": UID,
        "station": "Station",
        "status": "open",
        "e10": "1.729",
    }
    data = LiveData(settings, query=lambda *_: [row], clock=lambda: NOW)
    scheduler = Scheduler(settings)
    data.jobs_enabled = True
    data.scheduler = scheduler

    server = make_server(settings, "127.0.0.1", 0, data)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    url = base + "/api/v1/jobs/trigger"
    body = json.dumps({"job": "models", "watermark": 1727}).encode()

    def post(token=None, payload=body, job=None):
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        data_bytes = payload
        if job is not None:
            data_bytes = json.dumps({"job": job, "watermark": 1727}).encode()
        request = urllib.request.Request(
            url, data=data_bytes, headers=headers, method="POST"
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response), response.status

    try:
        # Ohne Secret/Job-Betrieb bewusst 404 — hier konfiguriert.
        with pytest.raises(urllib.error.HTTPError) as error:
            post(token="falsches-token")
        assert error.value.code == 403
        with pytest.raises(urllib.error.HTTPError) as error:
            post()  # ganz ohne Authorization
        assert error.value.code == 403
        with pytest.raises(urllib.error.HTTPError) as error:
            post(token="secret-token", job="archive")
        assert error.value.code == 400
        with pytest.raises(urllib.error.HTTPError) as error:
            post(token="secret-token", payload=b'{"job": "models", "watermark": "x"}')
        assert error.value.code == 400
        result, status = post(token="secret-token")
        assert status == 200 and result == {"status": "queued", "job": "models"}
        assert scheduler.pending["models"] == 1727
        assert scheduler.wake["models"].is_set()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_webhook_endpoint_disabled_without_token_or_jobs(tmp_path):
    import threading
    import urllib.request

    from app.data import LiveData
    from app.server import make_server

    polling = tmp_path / "polling.json"
    polling.write_text(json.dumps({"sets": {}}))
    static = tmp_path / "web"
    static.mkdir()
    (static / "index.html").write_text("<html>t</html>")
    settings = Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "netrc",
        static=static,
    )
    data = LiveData(settings, query=lambda *_: [], clock=lambda: None)
    server = make_server(settings, "127.0.0.1", 0, data)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        request = urllib.request.Request(
            base + "/api/v1/jobs/trigger",
            data=json.dumps({"job": "models", "watermark": 1}).encode(),
            headers={"Authorization": "Bearer x", "Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=5)
        # Ohne konfiguriertes Secret existiert der Endpoint nicht (404).
        assert error.value.code == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
