import argparse
import datetime as dt
import json
import os
import subprocess

import pytest

from app.config import Settings
from app.refresh import refresh
from app.worker import run
from engine.models import SCHEMA_VERSION

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
    model_path = output.parent / publication["model_file"]
    assert model_path.exists()
    model_bundle = json.loads(model_path.read_text())
    assert model_bundle["schema_version"] == SCHEMA_VERSION == 2
    assert all(
        model["schema_version"] == SCHEMA_VERSION for model in model_bundle["models"]
    )


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


def compose_up_call(calls):
    """Der `compose up`-Aufruf — nach `nas-up` läuft noch `image prune`."""
    ups = [
        call
        for call in calls
        if call[0][-4:] == ["up", "-d", "--build", "--force-recreate"]
    ]
    assert len(ups) == 1
    return ups[0]


def test_nas_up_reuses_influx_and_mounts_secrets_read_only(
    model_setup, monkeypatch, tmp_path
):
    import app.nas as nas

    monkeypatch.setattr(nas, "ROOT", tmp_path)
    monkeypatch.setattr("tankapp.netrc_args", lambda *a: [])
    monkeypatch.setenv("TANKAPP_CITY_SUBDIVS", "Frankfurt:HE;Gütersloh:NW")
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
    up = compose_up_call(calls)
    env = up[1]["env"]
    assert calls[-1][0] == ["docker", "image", "prune", "-f"]
    assert env["TANKAPP_INFLUX_ENV"] == str(model_setup.influx_env)
    assert env["TANKAPP_CITY_SUBDIVS"] == "Frankfurt:HE;Gütersloh:NW"
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
    env = compose_up_call(calls)[1]["env"]
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
    env = compose_up_call(calls)[1]["env"]
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
    env = compose_up_call(calls)[1]["env"]
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
        lambda name, settings, progress=None: {
            "state": "success",
            "error_code": None,
        },
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
        lambda name, settings, progress=None: {
            "state": "failed",
            "error_code": "job_failed",
        },
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


# --- Fortschritts-Protokoll (lange Modellläufe) -----------------------------


def test_progress_file_tracks_phases_and_steps(model_setup):
    """Jede Phase und jeder Schritt landet in Status + Log (kein Rätselraten)."""
    from app.progress import JobProgress, read_progress

    progress = JobProgress(model_setup, "models", verbose=False)
    assert read_progress(model_setup, "models") is None
    progress.phase("fit", total=3, message="Fit + Backtest")
    progress.step(1, label="Frankfurt – One")
    raw = read_progress(model_setup, "models")
    assert raw is not None
    assert raw["phase"] == "fit"
    assert (raw["step"], raw["total"]) == (1, 3)
    assert raw["label"] == "Frankfurt – One"
    assert 0 < raw["pct"] < 100
    assert raw["eta_s"] is not None  # Restschätzung aus Schritt 1 von 3
    progress.finish("success", "fertig")
    # Nach dem Lauf kein „Läuft …“ mehr: die GUI zeigt den Endzustand.
    assert read_progress(model_setup, "models") is None

    log = (model_setup.runtime / "jobs" / "models.log").read_text(encoding="utf-8")
    assert "Modelle fitten" in log
    assert "Frankfurt – One" in log
    assert "fertig" in log


def test_progress_log_rotates_instead_of_growing_forever(model_setup):
    from app.progress import append_log

    path = model_setup.runtime / "jobs" / "models.log"
    for index in range(40):
        append_log(path, f"Zeile {index}", max_lines=10)
    lines = path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 10
    assert lines[-1].endswith("Zeile 39")
    assert "Zeile 0" not in "\n".join(lines)


def test_refresh_reports_every_phase(model_setup, capsys):
    cutoff = dt.datetime(2026, 8, 6, tzinfo=dt.timezone.utc)
    outcome = refresh(model_setup, now=cutoff, progress=None)
    assert outcome["state"] == "partial"  # eine Station hat keine Historie

    from app.progress import JobProgress

    progress = JobProgress(model_setup, "models", verbose=False)
    refresh(model_setup, now=cutoff, progress=progress)
    log = (model_setup.runtime / "jobs" / "models.log").read_text(encoding="utf-8")
    # Der lange Teil ist sichtbar: Export, Fit je Station, Veröffentlichen.
    assert "InfluxDB-Export" in log
    assert "Modelle fitten" in log
    assert "Veröffentlichen" in log
    # Stationen erscheinen mit Namen — „läuft seit 20 min“ wird erklärbar.
    assert "Frankfurt – One" in log


def test_health_shows_progress_only_while_running(model_setup):
    """/api/v1/health liefert den Fortschritt, solange der Job läuft."""
    import datetime as dt

    from app.data import LiveData
    from app.progress import JobProgress

    jobs = model_setup.runtime / "jobs"
    jobs.mkdir(parents=True, exist_ok=True)
    running = JobProgress(model_setup, "models", verbose=False)
    running.phase("fit", total=2)
    running.step(1, label="Frankfurt – One")
    (jobs / "models.json").write_text(
        json.dumps(
            {
                "state": "running",
                "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }
        )
    )
    health = LiveData(model_setup, query=lambda *_: [], clock=lambda: NOW).health()
    progress = health["jobs"]["models"]["progress"]
    assert progress and progress["phase"] == "fit"
    assert progress["step"] == 1 and progress["total"] == 2

    # Fertig → kein Fortschrittsblock mehr (sonst „Läuft …“ bis zum nächsten Lauf).
    running.finish("success")
    health = LiveData(model_setup, query=lambda *_: [], clock=lambda: NOW).health()
    assert health["jobs"]["models"]["progress"] is None


def test_worker_run_writes_progress_and_duration(model_setup, monkeypatch):
    """Der NAS-Job protokolliert Start, Phasen und Dauer (docker logs / Datei)."""
    import app.worker as worker

    def fake(name, settings, progress=None):
        progress.phase("fit", total=2)
        progress.step(1, label="Frankfurt – One")
        return {"state": "success", "error_code": None}

    monkeypatch.setattr(worker, "execute", fake)
    assert worker.run("models", model_setup) == 0
    log = (model_setup.runtime / "jobs" / "models.log").read_text(encoding="utf-8")
    assert "Start" in log
    assert "Modelle fitten" in log
    assert "Frankfurt – One" in log
    assert "Dauer" in log
    assert "beendet: success" in log
    state = json.loads((model_setup.runtime / "jobs" / "models.json").read_text())
    assert state["state"] == "success"


# --- Fehlerursache statt „fehlgeschlagen“ (B6) ------------------------------


def test_redact_hides_paths_credentials_and_blobs():
    from app.errors import public_detail, redact

    # Pfade: nur der Dateiname bleibt, das Verzeichnislayout nicht.
    assert redact("No such file or directory: '/data/runtime/jobs/models.json'") == (
        "No such file or directory: 'models.json'"
    )
    # Zugangsdaten in jeder Schreibweise verschwinden.
    assert "supergeheim" not in redact("token=supergeheim")
    assert "geheim" not in redact("password: geheim")
    assert "geheim" not in redact("Authorization: Bearer geheim")
    assert "user:pw" not in redact("http://user:pw@nas:8086 fehlt")
    # Influx-Token-artige Blobs sind weg, Stations-UUIDs bleiben lesbar.
    assert "a" * 64 not in redact("token " + "a" * 64)
    assert UID in redact(f"Station {UID} ohne Modell")

    class Broken(Exception):
        pass

    detail = public_detail(
        Broken("lesbar: /data/runtime/jobs/models.json mit token=geheim")
    )
    assert detail.startswith("Broken: lesbar:")
    assert "models.json" in detail and "geheim" not in detail
    # Unbegrenzte Meldungen werden auf einen Satz gekürzt.
    assert len(public_detail(Broken("x" * 5000))) <= 240


def test_worker_failure_keeps_sanitized_reason_in_status_and_log(
    model_setup, monkeypatch
):
    """„Fehlgeschlagen“ allein ist keine Diagnose — die Ursache schon."""
    import app.worker as worker

    def boom(name, settings, progress=None):
        raise RuntimeError(
            "InfluxDB nicht erreichbar: "
            "url=http://tankapp:geheim@nas:8086 token=supergeheim "
            "Datei /data/runtime/jobs/models.json"
        )

    monkeypatch.setattr(worker, "execute", boom)
    assert worker.run("models", model_setup) == 2

    state = json.loads((model_setup.runtime / "jobs" / "models.json").read_text())
    assert state["state"] == "failed" and state["error_code"] == "job_failed"
    detail = state["error_detail"]
    assert "RuntimeError" in detail and "InfluxDB nicht erreichbar" in detail
    assert "geheim" not in detail and "supergeheim" not in detail
    assert "/data" not in detail

    # Dieselbe Zeile steht im Log (tail -f) und damit auch im GUI-Logpanel.
    log = (model_setup.runtime / "jobs" / "models.log").read_text(encoding="utf-8")
    assert "Fehler:" in log and "InfluxDB nicht erreichbar" in log
    assert "supergeheim" not in log


def test_missing_dependency_names_the_module(model_setup, monkeypatch):
    import app.worker as worker

    def boom(name, settings, progress=None):
        raise ModuleNotFoundError("No module named pandas")

    monkeypatch.setattr(worker, "execute", boom)
    assert worker.run("models", model_setup) == 2
    state = json.loads((model_setup.runtime / "jobs" / "models.json").read_text())
    assert state["error_code"] == "dependencies_missing"
    assert "pandas" in state["error_detail"]


def test_health_exposes_error_detail(tmp_path):
    from app.data import LiveData

    settings = Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=tmp_path / "polling.json",
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "netrc",
    )
    jobs = settings.runtime / "jobs"
    jobs.mkdir(parents=True)
    (jobs / "models.json").write_text(
        json.dumps(
            {
                "state": "failed",
                "error_code": "job_failed",
                "error_detail": "ValueError: zu wenig Historie für models.json",
            }
        )
    )
    health = LiveData(settings, query=lambda *_: [], clock=lambda: NOW).health()
    assert health["jobs"]["models"]["error_detail"].startswith("ValueError")


def test_job_log_endpoint_serves_tail_lines(tmp_path):
    import threading
    import urllib.error
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
    jobs = settings.runtime / "jobs"
    jobs.mkdir(parents=True)
    # 300 Zeilen, eine davon mit einem Geheimnis — es darf nicht herausgehen.
    (jobs / "models.log").write_text(
        "\n".join(
            [f"2026-09-11T06:0{i % 10}:00Z models: [10 %] Start" for i in range(299)]
            + ["2026-09-11T06:10:00Z models: token=supergeheim Datei /data/x.json"]
        )
        + "\n",
        encoding="utf-8",
    )
    data = LiveData(settings, query=lambda *_: [], clock=lambda: NOW)
    server = make_server(settings, "127.0.0.1", 0, data)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"

    def get(path):
        with urllib.request.urlopen(base + path, timeout=5) as response:
            return json.load(response), response.status

    try:
        payload, status = get("/api/v1/jobs/models/log?lines=50")
        assert status == 200
        assert payload["available"] is True
        assert payload["count"] == 50 and payload["total"] == 300
        assert payload["lines"][-1].endswith("Datei x.json")
        assert "supergeheim" not in payload["lines"][-1]
        assert all("/data" not in line for line in payload["lines"])

        # Ohne Logdatei: ehrliche Antwort statt 500.
        payload, status = get("/api/v1/jobs/selection/log")
        assert status == 200
        assert payload == {
            "job": "selection",
            "available": False,
            "count": 0,
            "total": 0,
            "lines": [],
            "updated_at": None,
            "error_code": "log_missing",
        }

        # Unbekannte Jobs und Müll-Parameter existieren nicht.
        for bad in ("/api/v1/jobs/backup/log", "/api/v1/jobs/models/log?lines=abc"):
            with pytest.raises(urllib.error.HTTPError) as error:
                get(bad)
            assert error.value.code in (400, 404)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


# --- Startknopf im GUI: POST /api/v1/jobs/{job}/run (B6) ---------------------


def _manual_settings(tmp_path, **overrides):
    from dataclasses import replace

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
    return replace(settings, **overrides)


def test_scheduler_manual_bypasses_debounce_but_never_runs_twice(tmp_path):
    import time as time_mod

    from app.server import MANUAL_MIN_GAP_S, Scheduler

    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    scheduler = Scheduler(settings)

    # Unbekannter Job: abgelehnt, kein Wake.
    assert scheduler.manual("backup") == {
        "status": "rejected",
        "reason": "unknown_job",
    }

    # Läuft bereits: kein zweiter Start, auch nicht „vorgemerkt“.
    class Running:
        def poll(self):
            return None

    scheduler.processes["models"] = Running()
    assert scheduler.manual("models") == {"status": "running", "job": "models"}
    assert not scheduler.wake["models"].is_set()
    del scheduler.processes["models"]

    # Frischer Start: vorgemerkt und aufgeweckt.
    assert scheduler.manual("models") == {"status": "queued", "job": "models"}
    assert scheduler.wake["models"].is_set()
    assert "models" in scheduler.manual_flags
    scheduler.wake["models"].clear()
    scheduler.manual_flags.clear()

    # Gerade eben gelaufen: ehrliche Antwort statt Doppellauf.
    scheduler.last_start["models"] = time_mod.monotonic() - 5
    answer = scheduler.manual("models")
    assert answer["status"] == "debounced"
    assert 0 < answer["retry_after"] <= MANUAL_MIN_GAP_S

    # Nach dem Knopf-Abstand — und entgegen dem *Webhook*-Debounce (900 s) —
    # startet der Knopf sofort: genau der Fall „Fehler behoben, nachholen“.
    scheduler.last_start["models"] = time_mod.monotonic() - (MANUAL_MIN_GAP_S + 1)
    assert scheduler.manual("models")["status"] == "queued"


def test_scheduler_manual_request_runs_the_job(tmp_path, monkeypatch):
    import threading

    from app.server import Scheduler

    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    scheduler = Scheduler(settings)
    calls = []
    done = threading.Event()

    def once(name, watermark=None):
        calls.append((name, watermark))
        done.set()
        return 0

    def wait(delay):
        # Beim ersten Durchlauf den Knopf „drücken“ (sonst würde der Loop bis
        # zum Intervall schlafen), danach den Thread beenden.
        if not calls:
            scheduler.manual("selection")
            return True
        scheduler.stop_event.set()
        return False

    monkeypatch.setattr(scheduler, "run_once", once)
    monkeypatch.setattr(scheduler.wake["selection"], "wait", wait)
    thread = threading.Thread(target=scheduler.loop, args=("selection",), daemon=True)
    thread.start()
    assert done.wait(timeout=10)
    scheduler.stop_event.set()
    thread.join(timeout=5)
    assert calls == [("selection", None)]  # Knopf hat keine Watermark


def test_manual_start_endpoint_without_token(tmp_path):
    import threading
    import urllib.error
    import urllib.request
    from dataclasses import replace

    from app.data import LiveData
    from app.server import Scheduler, make_server

    settings = _manual_settings(tmp_path)
    data = LiveData(settings, query=lambda *_: [], clock=lambda: NOW)
    scheduler = Scheduler(settings)
    data.jobs_enabled = True
    data.scheduler = scheduler
    server = make_server(settings, "127.0.0.1", 0, data)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"

    def post(path):
        request = urllib.request.Request(
            base + path,
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return json.load(response), response.status
        except urllib.error.HTTPError as error:
            return json.load(error), error.code

    try:
        # Ohne Passwort: der Knopf wirkt, weil der Dienst Jobs fährt.
        payload, status = post("/api/v1/jobs/models/run")
        assert status == 200 and payload == {"status": "queued", "job": "models"}
        assert scheduler.wake["models"].is_set()
        # Unbekannter Job existiert nicht.
        payload, status = post("/api/v1/jobs/backup/run")
        assert status == 404 and payload == {"error_code": "not_found"}

        # Ohne Job-Betrieb (reine Lese-Instanz) existiert der Knopf nicht.
        data.jobs_enabled = False
        payload, status = post("/api/v1/jobs/models/run")
        assert status == 404 and payload == {"error_code": "not_found"}
        data.jobs_enabled = True

        # Abschaltbar: TANKAPP_GUI_JOB_START=0 (nur Env, nicht neu starten).
        data.settings = replace(settings, gui_job_start=False)
        payload, status = post("/api/v1/jobs/models/run")
        assert status == 404 and payload == {"error_code": "not_found"}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_gui_job_start_switch_reads_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("TANKAPP_DATA_DIR", str(tmp_path / "data"))
    assert Settings.from_env().gui_job_start is True
    monkeypatch.setenv("TANKAPP_GUI_JOB_START", "0")
    assert Settings.from_env().gui_job_start is False
    monkeypatch.setenv("TANKAPP_GUI_JOB_START", "off")
    assert Settings.from_env().gui_job_start is False
    monkeypatch.setenv("TANKAPP_GUI_JOB_START", "1")
    assert Settings.from_env().gui_job_start is True


# ---------------------------------------------------------------------------
# B18: dauerhaftes `partial` löst keinen Stundentakt aus
# ---------------------------------------------------------------------------


def test_partial_models_backoff_to_job_interval(tmp_path, monkeypatch):
    """B18: `some_models_unavailable` → nächster Versuch im Tagesintervall."""
    import app.worker as worker

    monkeypatch.setattr(
        worker,
        "execute",
        lambda name, settings, progress=None: {
            "state": "partial",
            "error_code": "some_models_unavailable",
        },
    )
    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    assert worker.run("models", settings) == 2
    state = json.loads((tmp_path / "runtime" / "jobs" / "models.json").read_text())
    finished = dt.datetime.fromisoformat(state["finished_at"])
    nxt = dt.datetime.fromisoformat(state["next_run_at"])
    assert (nxt - finished).total_seconds() == pytest.approx(86400, abs=2)
    assert state["state"] == "partial"


def test_transient_failure_keeps_hourly_retry(tmp_path, monkeypatch):
    """B18: ein flüchtiger Fehler behält den schnellen Wiederholungsversuch."""
    import app.worker as worker

    monkeypatch.setattr(
        worker,
        "execute",
        lambda name, settings, progress=None: {
            "state": "failed",
            "error_code": "job_failed",
        },
    )
    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    assert worker.run("models", settings) == 2
    state = json.loads((tmp_path / "runtime" / "jobs" / "models.json").read_text())
    finished = dt.datetime.fromisoformat(state["finished_at"])
    nxt = dt.datetime.fromisoformat(state["next_run_at"])
    assert (nxt - finished).total_seconds() == pytest.approx(3600, abs=2)


def test_scheduler_next_delay_separates_transient_from_persistent(tmp_path):
    """B18: Der Scheduler wartet nach strukturellen Codes das Job-Intervall ab."""
    from app.server import Scheduler

    scheduler = Scheduler(Settings(data=tmp_path, polling=tmp_path / "missing"))
    assert (
        scheduler.next_delay(
            "models", {"state": "partial", "error_code": "some_models_unavailable"}
        )
        == 86400
    )
    assert (
        scheduler.next_delay("models", {"state": "failed", "error_code": "job_failed"})
        == 3600
    )
    assert scheduler.next_delay("models", {"state": "success"}) == 86400
    # Ein Abbruch ist flüchtig (der Job wurde unterbrochen, nicht strukturell unfit).
    assert (
        scheduler.next_delay("models", {"state": "aborted", "error_code": "aborted"})
        == 3600
    )


def test_partial_job_raises_warn_alarm(tmp_path):
    """B18: ein unvollständiger Lauf ist als Warnung sichtbar, nicht als Fehler."""
    from app.alarms import build_alarms

    alarms = build_alarms(
        Settings(data=tmp_path),
        collector={"available": True, "fresh": True},
        jobs={"models": {"state": "partial", "error_code": "some_models_unavailable"}},
        job_errors={},
        polling_error=None,
        station_count=20,
    )
    partial = [a for a in alarms if a["code"] == "job_partial"]
    assert partial, alarms
    assert partial[0]["severity"] == "warn"
    assert partial[0]["job"] == "models"


def test_aborted_job_raises_warn_alarm(tmp_path):
    """B24: ein abgebrochener Lauf ist als Warnung sichtbar, nicht als Fehler."""
    from app.alarms import build_alarms

    alarms = build_alarms(
        Settings(data=tmp_path),
        collector={"available": True, "fresh": True},
        jobs={"models": {"state": "aborted", "error_code": "aborted"}},
        job_errors={},
        polling_error=None,
        station_count=20,
    )
    aborted = [a for a in alarms if a["code"] == "job_aborted"]
    assert aborted, alarms
    assert aborted[0]["severity"] == "warn"
    assert aborted[0]["job"] == "models"


# ---------------------------------------------------------------------------
# B24: hart abgebrochene Läufe werden `aborted` statt ewig `running`
# ---------------------------------------------------------------------------


def test_prior_running_is_booked_as_aborted(tmp_path):
    """B24(b): Ein liegengebliebener `running`-Eintrag wird als `aborted` verbucht."""
    import app.worker as worker
    from app.data import public_job

    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    path = settings.runtime / "jobs" / "models.json"
    path.parent.mkdir(parents=True)
    started = "2026-09-12T14:00:00Z"
    path.write_text(
        json.dumps(
            {
                "state": "running",
                "started_at": started,
                "last_success_at": "2026-09-11T00:00:00Z",
                "data_watermark": "1727",
            }
        )
    )
    before = worker.read_json(path, {})
    worker._mark_prior_aborted(path, "models", before, dt.datetime.now(dt.timezone.utc))
    state = json.loads(path.read_text())
    assert state["state"] == "aborted"
    assert state["error_code"] == "aborted"
    assert state["started_at"] == started  # der Abbruch bewahrt den Laufbeginn
    assert state["last_success_at"] == "2026-09-11T00:00:00Z"
    assert state["data_watermark"] == "1727"
    assert state["aborted_at"] and state["next_run_at"]
    assert state["aborted_phase"] is None  # kein Fortschritt hinterlegt

    payload = public_job(settings, "models")
    assert payload["state"] == "aborted"
    assert payload["aborted_at"] and "aborted_phase" in payload
    log = (settings.runtime / "jobs" / "models.log").read_text(encoding="utf-8")
    assert "abgebrochen" in log


def test_prior_aborted_keeps_last_progress_phase(tmp_path):
    """B24(b): Die zuletzt protokollierte Phase bleibt als Abbruchphase erhalten."""
    import app.worker as worker

    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    jobs = settings.runtime / "jobs"
    jobs.mkdir(parents=True)
    (jobs / "models.json").write_text(
        json.dumps({"state": "running", "started_at": "2026-09-12T14:00:00Z"})
    )
    (jobs / "models.progress.json").write_text(
        json.dumps(
            {"phase": "fit", "done": False, "updated_at": "2026-09-12T14:05:00Z"}
        )
    )
    before = worker.read_json(jobs / "models.json", {})
    worker._mark_prior_aborted(
        jobs / "models.json", "models", before, dt.datetime.now(dt.timezone.utc)
    )
    assert json.loads((jobs / "models.json").read_text())["aborted_phase"] == "fit"


def test_run_with_prior_running_records_abort_then_succeeds(tmp_path, monkeypatch):
    """B24(b): Der nächste Lauf verbucht den Vorgänger als abgebrochen und läuft."""
    import app.worker as worker

    monkeypatch.setattr(
        worker,
        "execute",
        lambda name, settings, progress=None: {"state": "success", "error_code": None},
    )
    settings = Settings(data=tmp_path, polling=tmp_path / "missing")
    jobs = settings.runtime / "jobs"
    jobs.mkdir(parents=True)
    (jobs / "models.json").write_text(
        json.dumps({"state": "running", "started_at": "2026-09-12T10:00:00Z"})
    )
    assert worker.run("models", settings) == 0
    assert json.loads((jobs / "models.json").read_text())["state"] == "success"
    log = (jobs / "models.log").read_text(encoding="utf-8")
    assert "vorheriger Lauf hart beendet" in log


@pytest.mark.skipif(os.name != "posix", reason="SIGTERM-Handler ist POSIX-only")
def test_sigterm_marks_aborted_then_completion_wins(tmp_path, monkeypatch):
    """B24(a): SIGTERM schreibt `aborted`; läuft der Job doch zu Ende, gewinnt das Ergebnis."""
    import signal
    import threading

    import app.worker as worker

    entered = threading.Event()
    release = threading.Event()

    def slow(name, settings, progress=None):
        progress.phase("fit", total=2)
        progress.step(1, label="Frankfurt – One")
        entered.set()
        release.wait(5)
        return {"state": "success", "error_code": None}

    monkeypatch.setattr(worker, "execute", slow)
    settings = Settings(data=tmp_path, polling=tmp_path / "missing")

    def send_term():
        assert entered.wait(5)
        os.kill(os.getpid(), signal.SIGTERM)
        release.set()

    sender = threading.Thread(target=send_term, daemon=True)
    sender.start()
    assert worker.run("models", settings) == 0
    sender.join(timeout=5)
    log = (settings.runtime / "jobs" / "models.log").read_text(encoding="utf-8")
    assert "abgebrochen in Phase 'fit'" in log
    # Der Lauf wurde trotz SIGTERM regulär zu Ende geführt → das Ergebnis zählt.
    assert (
        json.loads((settings.runtime / "jobs" / "models.json").read_text())["state"]
        == "success"
    )


def test_nas_up_warns_while_model_job_is_running(tmp_path, monkeypatch, capsys):
    """B24(c): `nas-up` warnt vor dem Recreate, wenn der Modell-Lauf aktiv ist."""
    import app.nas as nas

    runtime = tmp_path / "runtime"
    jobs = runtime / "jobs"
    jobs.mkdir(parents=True)
    started = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=2)
    (jobs / "models.json").write_text(
        json.dumps({"state": "running", "started_at": started.isoformat()})
    )
    capsys.readouterr()
    nas._warn_if_model_job_active(runtime)
    out = capsys.readouterr().out
    assert "läuft noch" in out
    # Ein liegengebliebener (alter) Zustand warnt nicht mehr.
    (jobs / "models.json").write_text(
        json.dumps(
            {
                "state": "running",
                "started_at": (
                    dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=9)
                ).isoformat(),
            }
        )
    )
    nas._warn_if_model_job_active(runtime)
    assert "läuft noch" not in capsys.readouterr().out
