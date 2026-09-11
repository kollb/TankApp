"""UUID tagging and explicit JSONL replay, with fake writes only."""

import importlib.util
import json
import os
import sys
import urllib.error
from pathlib import Path

import pytest

A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"
TIME = "2026-09-07T06:00:00+00:00"


@pytest.fixture
def uploader():
    path = Path(__file__).resolve().parents[1] / "data-tools/upload_influx.py"
    spec = importlib.util.spec_from_file_location("test_uuid_uploader", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def snapshot(stamp=TIME):
    return {
        "source": "tankerkoenig-prices.php",
        "fetched_at": stamp,
        "city": "Testmarkt",
        "prices": {
            A: {"status": "open", "e10": 1.7, "e5": False},
            B: {"status": "open", "e10": 1.8, "diesel": None},
        },
    }


@pytest.fixture
def saved_buffer(uploader, tmp_path):
    poll = tmp_path / "saved-poll"
    poll.mkdir()
    meta = poll / "meta"
    meta.mkdir()
    (meta / "synced_until").write_text("2026-09-07T08:00:00+00:00\n", encoding="utf-8")
    path = poll / "2026-09-07.jsonl"
    path.write_text(json.dumps(snapshot()) + "\n", encoding="utf-8")
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Testmarkt": {
                        "label": "Testmarkt",
                        "batch": [A, B],
                        "stations": [
                            {"uuid": A, "name": "Aral Test"},
                            {"uuid": B, "name": "Aral Test"},
                        ],
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    cfg = uploader.Cfg(
        "http://nas:8086", "org", "tankapp", "not-a-real-token", poll, polling
    )
    return cfg, path


def test_equal_names_and_timestamp_have_distinct_point_identities(uploader):
    lines = uploader.snap_to_lines(
        uploader.parse_ts(TIME), snapshot(), {A: "Aral Test", B: "Aral Test"}
    )
    assert len(lines) == 2
    assert f"station_id={A} " in lines[0]
    assert f"station_id={B} " in lines[1]
    assert "station=Aral\\ Test" in lines[0] and "station=Aral\\ Test" in lines[1]
    assert "e10=1.700" in lines[0] and "e10=1.800" in lines[1]
    assert lines[0].rsplit(" ", 1)[1] == lines[1].rsplit(" ", 1)[1]
    assert "e5=" not in lines[0] and "diesel=" not in lines[1]
    assert lines == uploader.snap_to_lines(
        uploader.parse_ts(TIME), snapshot(), {A: "Aral Test", B: "Aral Test"}
    )


def test_name_fallback_tag_escaping_and_nonfinite_prices(uploader):
    snap = snapshot()
    snap["prices"][A] = {
        "status": "closed",
        "e10": float("nan"),
        "diesel": float("inf"),
    }
    lines = uploader.snap_to_lines(
        uploader.parse_ts(TIME), snap, {A: "Name = one, two"}
    )
    assert "station=Name\\ \\=\\ one\\,\\ two," in lines[0]
    assert (
        'status="closed"' in lines[0]
        and "e10=" not in lines[0]
        and "diesel=" not in lines[0]
    )
    assert f"station={B},station_id={B}" in lines[1]


def test_normal_upload_keeps_ack_until_success_then_advances(
    uploader, saved_buffer, monkeypatch
):
    cfg, path = saved_buffer
    old = "2026-09-07T05:00:00+00:00\n"
    cfg.ack_file.write_text(old)

    def failed(*args):
        raise urllib.error.URLError("offline")

    monkeypatch.setattr(uploader, "influx_write", failed)
    assert uploader.run_upload(cfg, uploader.State()) == 1
    assert cfg.ack_file.read_text() == old
    received = []
    monkeypatch.setattr(
        uploader, "influx_write", lambda cfg, lines: received.extend(lines)
    )
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert cfg.ack_file.read_text().strip() == TIME
    assert len(received) == 2 and all("station_id=" in line for line in received)


def test_replay_ignores_ack_without_reading_writing_or_resetting_it(
    uploader, saved_buffer, monkeypatch
):
    cfg, path = saved_buffer
    original = path.read_bytes()
    ack = cfg.ack_file.read_bytes()

    def forbidden(*args):
        raise AssertionError("Replay must never read/write the live ACK")

    monkeypatch.setattr(uploader, "read_ack", forbidden)
    monkeypatch.setattr(uploader, "write_ack", forbidden)
    received = []
    monkeypatch.setattr(
        uploader, "influx_write", lambda cfg, lines: received.extend(lines)
    )
    assert uploader.run_replay(cfg) == 0
    assert len(received) == 2
    assert path.read_bytes() == original
    assert cfg.ack_file.read_bytes() == ack
    again = []
    monkeypatch.setattr(
        uploader, "influx_write", lambda cfg, lines: again.extend(lines)
    )
    assert uploader.run_replay(cfg) == 0
    assert again == received


def test_replay_dry_run_needs_no_credentials_and_sends_nothing(
    uploader, saved_buffer, monkeypatch, capsys
):
    cfg, path = saved_buffer
    for key in (
        "TANKAPP_INFLUX_URL",
        "TANKAPP_INFLUX_ORG",
        "TANKAPP_INFLUX_BUCKET",
        "TANKAPP_INFLUX_TOKEN",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "upload_influx.py",
            "--replay",
            "--dry-run",
            "--poll-dir",
            str(cfg.poll_dir),
            "--poll-json",
            str(cfg.poll_json),
        ],
    )

    def forbidden(*args):
        raise AssertionError("dry-run cannot write or touch ACKs")

    monkeypatch.setattr(uploader, "influx_write", forbidden)
    monkeypatch.setattr(uploader, "write_ack", forbidden)
    assert uploader.main() == 0
    output = capsys.readouterr().out
    assert A in output and B in output and "station_id=" in output
    assert "not-a-real-token" not in output


@pytest.mark.parametrize(
    "kind",
    ["demo", "broken", "naive", "bad_uuid", "bad_status", "nonfinite", "conflict"],
)
def test_replay_preflights_every_row_before_any_write(
    uploader, saved_buffer, monkeypatch, capsys, kind
):
    cfg, path = saved_buffer
    bad = snapshot("2026-09-07T06:05:00+00:00")
    if kind == "demo":
        bad["source"] = "demo"
    elif kind == "naive":
        bad["fetched_at"] = "2026-09-07T06:05:00"
    elif kind == "bad_uuid":
        bad["prices"] = {"not-a-real-token": {"status": "open", "e10": 1.7}}
    elif kind == "bad_status":
        bad["prices"][A]["status"] = "not-a-real-token"
    elif kind == "nonfinite":
        bad["prices"][A]["e10"] = float("nan")
    elif kind == "conflict":
        bad["fetched_at"] = TIME
        bad["prices"][A]["e10"] = 1.9
    with path.open("a", encoding="utf-8") as handle:
        handle.write(
            '{"not-a-real-token":' if kind == "broken" else json.dumps(bad) + "\n"
        )
    ack = cfg.ack_file.read_bytes()
    original = path.read_bytes()

    def forbidden(*args):
        raise AssertionError("Invalid replay must fail before the first write")

    monkeypatch.setattr(uploader, "influx_write", forbidden)
    assert uploader.run_replay(cfg) == 1
    assert cfg.ack_file.read_bytes() == ack
    assert path.read_bytes() == original
    assert "not-a-real-token" not in capsys.readouterr().out


def test_replay_detects_source_changes_during_read(uploader, saved_buffer, monkeypatch):
    cfg, path = saved_buffer
    original_loads = uploader.json.loads
    changed = False

    def loads(value, *args, **kwargs):
        nonlocal changed
        result = original_loads(value, *args, **kwargs)
        if isinstance(result, dict) and "fetched_at" in result and not changed:
            stat = path.stat()
            os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
            changed = True
        return result

    monkeypatch.setattr(uploader.json, "loads", loads)
    with pytest.raises(ValueError, match="verändert"):
        uploader.prepare_replay(cfg.poll_dir, cfg.poll_json)


def test_partial_replay_can_be_repeated_without_touching_ack(
    uploader, saved_buffer, monkeypatch, capsys
):
    cfg, path = saved_buffer
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(snapshot("2026-09-07T06:05:00+00:00")) + "\n")
    ack = cfg.ack_file.read_bytes()
    monkeypatch.setattr(uploader, "REPLAY_BATCH_POINTS", 2)
    batches = []

    def write(cfg, lines):
        batches.append(lines)
        if len(batches) == 2:
            raise urllib.error.HTTPError(cfg.url, 503, "not-a-real-token", {}, None)

    monkeypatch.setattr(uploader, "influx_write", write)
    assert uploader.run_replay(cfg) == 1
    assert cfg.ack_file.read_bytes() == ack
    assert "not-a-real-token" not in capsys.readouterr().out
    successful = []
    monkeypatch.setattr(
        uploader, "influx_write", lambda cfg, lines: successful.extend(lines)
    )
    assert uploader.run_replay(cfg) == 0
    assert len(successful) == 4
    assert cfg.ack_file.read_bytes() == ack


def test_empty_replay_is_not_successful_migration(uploader, saved_buffer, monkeypatch):
    cfg, path = saved_buffer
    path.write_text("", encoding="utf-8")
    assert uploader.run_replay(cfg) == 2
    path.unlink()
    assert uploader.run_replay(cfg) == 1


def test_replay_non_utf8_input_never_logs_raw_contents(uploader, saved_buffer, capsys):
    cfg, path = saved_buffer
    path.write_bytes(b"not-a-real-token\xff")
    assert uploader.run_replay(cfg) == 1
    assert "not-a-real-token" not in capsys.readouterr().out


def test_replay_exact_duplicate_copies_are_deduplicated(uploader, saved_buffer):
    cfg, path = saved_buffer
    path.write_text((json.dumps(snapshot()) + "\n") * 2, encoding="utf-8")
    lines, rows = uploader.prepare_replay(cfg.poll_dir, cfg.poll_json)
    assert rows == 2
    assert len(lines) == 2


@pytest.mark.parametrize(
    "kind,code",
    [
        ("json", "JSON_INVALID"),
        ("object", "SNAPSHOT_OBJECT"),
        ("source_missing", "SOURCE_MISSING"),
        ("source_unknown", "SOURCE_UNKNOWN"),
        ("source_demo", "SOURCE_DEMO"),
        ("time_missing", "TIME_MISSING_OR_INVALID"),
        ("time_invalid", "TIME_MISSING_OR_INVALID"),
        ("time_naive", "TIME_OFFSET_MISSING"),
        ("city", "CITY_INVALID"),
        ("prices", "PRICES_OBJECT"),
        ("uuid", "STATION_UUID_INVALID"),
        ("status", "STATION_STATUS_INVALID"),
        ("price", "PRICE_NONFINITE"),
        ("huge_price", "PRICE_NONFINITE"),
        ("conflict", "CONFLICTING_OBSERVATION"),
    ],
)
def test_replay_reports_exact_validation_stage_without_record_values(
    uploader, saved_buffer, monkeypatch, capsys, kind, code
):
    cfg, path = saved_buffer
    bad = snapshot()
    if kind == "object":
        bad = ["not-a-real-token"]
    elif kind == "source_missing":
        del bad["source"]
    elif kind == "source_unknown":
        bad["source"] = "not-a-real-token"
    elif kind == "source_demo":
        bad["source"] = "demo"
    elif kind == "time_missing":
        del bad["fetched_at"]
    elif kind == "time_invalid":
        bad["fetched_at"] = "not-a-real-token"
    elif kind == "time_naive":
        bad["fetched_at"] = "2026-09-07T06:00:00"
    elif kind == "city":
        bad["city"] = {"not-a-real-token": 1}
    elif kind == "prices":
        bad["prices"] = ["not-a-real-token"]
    elif kind == "uuid":
        bad["prices"] = {"not-a-real-token": {"status": "open"}}
    elif kind == "status":
        bad["prices"][A]["status"] = "not-a-real-token"
    elif kind == "price":
        bad["prices"][A]["e10"] = float("nan")
    elif kind == "huge_price":
        bad["prices"][A]["e10"] = 10**500
    elif kind == "conflict":
        bad["prices"][A]["e10"] += 0.1
    text = '{"not-a-real-token":' if kind == "json" else json.dumps(bad) + "\n"
    if kind == "conflict":
        text = json.dumps(snapshot()) + "\n" + text
    path.write_text(text, encoding="utf-8")
    original, ack = path.read_bytes(), cfg.ack_file.read_bytes()

    def forbidden(*args):
        raise AssertionError("Invalid original data cannot be sent or acknowledged")

    monkeypatch.setattr(uploader, "influx_write", forbidden)
    monkeypatch.setattr(uploader, "write_ack", forbidden)
    assert uploader.run_replay(cfg, dry=True) == 1
    output = capsys.readouterr().out
    assert f"[{code}]" in output
    assert "2026-09-07.jsonl" in output
    assert "Zeile 2" in output if kind == "conflict" else "Zeile 1" in output
    assert "nicht polling.json" in output
    assert "not-a-real-token" not in output
    assert A not in output and B not in output  # positions, never record contents
    assert path.read_bytes() == original and cfg.ack_file.read_bytes() == ack


def test_polling_manifest_source_and_anchors_are_not_snapshot_validation(
    uploader, saved_buffer
):
    cfg, path = saved_buffer
    polling = json.loads(cfg.poll_json.read_text(encoding="utf-8"))
    polling["generated"] = "2026-09-07T00:00:00Z"
    polling["source"] = "run_pipeline.py aus station_scores_e10.csv"
    polling["sets"]["Testmarkt"].update({"lat": 0.0, "lon": 0.0})
    cfg.poll_json.write_text(json.dumps(polling), encoding="utf-8")
    original = cfg.poll_json.read_bytes()
    lines, rows = uploader.prepare_replay(cfg.poll_dir, cfg.poll_json)
    assert rows == 1 and len(lines) == 2
    assert all("station_id=" in line for line in lines)
    assert cfg.poll_json.read_bytes() == original


def test_replay_encoding_diagnostic_does_not_echo_bytes(uploader, saved_buffer, capsys):
    cfg, path = saved_buffer
    path.write_bytes(b"not-a-real-token\xff")
    assert uploader.run_replay(cfg, dry=True) == 1
    output = capsys.readouterr().out
    assert "[ENCODING_UTF8]" in output
    assert "not-a-real-token" not in output


@pytest.mark.parametrize(
    "local,zone,utc",
    [
        ("2026-09-07T06:00:00", "Europe/Berlin", "2026-09-07T04:00:00+00:00"),
        ("2026-01-07T06:00:00", "Europe/Berlin", "2026-01-07T05:00:00+00:00"),
        ("2026-09-07T06:00:00", "UTC", "2026-09-07T06:00:00+00:00"),
    ],
)
def test_explicit_legacy_zone_maps_wall_clock_without_editing_source(
    uploader, saved_buffer, monkeypatch, capsys, local, zone, utc
):
    cfg, path = saved_buffer
    path.write_text(json.dumps(snapshot(local)) + "\n", encoding="utf-8")
    original, ack = path.read_bytes(), cfg.ack_file.read_bytes()
    received = []
    monkeypatch.setattr(
        uploader, "influx_write", lambda cfg, lines: received.extend(lines)
    )
    monkeypatch.setenv(
        "TZ", "Pacific/Honolulu"
    )  # must not infer the executing process's zone
    assert uploader.run_replay(cfg, replay_timezone=zone) == 0
    expected = str(int(uploader.parse_ts(utc).timestamp() * 1_000_000_000))
    assert len(received) == 2 and all(
        line.endswith(" " + expected) for line in received
    )
    assert path.read_bytes() == original and cfg.ack_file.read_bytes() == ack
    assert "1 Snapshot(s) ohne Offset" in capsys.readouterr().out


def test_explicit_zone_never_overrides_an_existing_offset(uploader, saved_buffer):
    cfg, path = saved_buffer
    path.write_text(
        json.dumps(snapshot("2026-09-07T06:00:00+02:00")) + "\n", encoding="utf-8"
    )
    before, _ = uploader.prepare_replay(cfg.poll_dir, cfg.poll_json)
    after, _ = uploader.prepare_replay(cfg.poll_dir, cfg.poll_json, "UTC")
    assert before == after


@pytest.mark.parametrize(
    "local,code",
    [
        ("2026-03-29T02:30:00", "TIME_LOCAL_NONEXISTENT"),
        ("2026-10-25T02:30:00", "TIME_LOCAL_AMBIGUOUS"),
    ],
)
def test_legacy_dst_holes_and_folds_are_not_guessed(
    uploader, saved_buffer, monkeypatch, capsys, local, code
):
    cfg, path = saved_buffer
    path.write_text(
        json.dumps(snapshot()) + "\n" + json.dumps(snapshot(local)) + "\n",
        encoding="utf-8",
    )
    original, ack = path.read_bytes(), cfg.ack_file.read_bytes()

    def forbidden(*args):
        raise AssertionError("No write or ACK on ambiguous/nonexistent local times")

    monkeypatch.setattr(uploader, "influx_write", forbidden)
    monkeypatch.setattr(uploader, "write_ack", forbidden)
    assert uploader.run_replay(cfg, replay_timezone="Europe/Berlin") == 1
    output = capsys.readouterr().out
    assert f"[{code}]" in output and "Zeile 2" in output
    assert local not in output
    assert path.read_bytes() == original and cfg.ack_file.read_bytes() == ack


def test_mixed_naive_and_aware_copies_deduplicate_after_timezone_conversion(
    uploader, saved_buffer
):
    cfg, path = saved_buffer
    path.write_text(
        json.dumps(snapshot("2026-09-07T08:00:00"))
        + "\n"
        + json.dumps(snapshot())
        + "\n",
        encoding="utf-8",
    )
    lines, count = uploader.prepare_replay(cfg.poll_dir, cfg.poll_json, "Europe/Berlin")
    assert count == 2 and len(lines) == 2


def test_conflicting_mixed_time_records_still_stop_replay(
    uploader, saved_buffer, capsys
):
    cfg, path = saved_buffer
    changed = snapshot("2026-09-07T08:00:00")
    changed["prices"][A]["e10"] = 1.9
    path.write_text(
        json.dumps(snapshot()) + "\n" + json.dumps(changed) + "\n", encoding="utf-8"
    )
    assert uploader.run_replay(cfg, dry=True, replay_timezone="Europe/Berlin") == 1
    assert "CONFLICTING_OBSERVATION" in capsys.readouterr().out


@pytest.mark.parametrize(
    "name", ["not-a-real-token", "", "localtime", "posixrules", "../secret"]
)
def test_invalid_or_machine_dependent_replay_zone_is_rejected_safely(uploader, name):
    with pytest.raises(uploader.ReplayError, match="REPLAY_TIMEZONE_INVALID") as error:
        uploader.replay_zone(name)
    assert "not-a-real-token" not in str(error.value)
    assert "../secret" not in str(error.value)


def test_replay_timezone_option_only_valid_in_replay_mode(uploader, monkeypatch):
    monkeypatch.setattr(
        sys, "argv", ["upload_influx.py", "--dry-run", "--replay-timezone", "UTC"]
    )
    with pytest.raises(SystemExit) as error:
        uploader.main()
    assert error.value.code == 2


def test_cli_timezone_dry_run_without_credentials(
    uploader, saved_buffer, monkeypatch, capsys
):
    cfg, path = saved_buffer
    path.write_text(
        json.dumps(snapshot("2026-09-07T06:00:00")) + "\n", encoding="utf-8"
    )
    original, ack = path.read_bytes(), cfg.ack_file.read_bytes()
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "upload_influx.py",
            "--replay",
            "--dry-run",
            "--replay-timezone",
            "Europe/Berlin",
            "--poll-dir",
            str(cfg.poll_dir),
            "--poll-json",
            str(cfg.poll_json),
        ],
    )

    def forbidden(*args):
        raise AssertionError("Timezone dry-run must remain offline")

    monkeypatch.setattr(uploader, "influx_write", forbidden)
    assert uploader.main() == 0
    output = capsys.readouterr().out
    assert "Europe/Berlin" in output and "1 Snapshot(s) ohne Offset" in output
    assert path.read_bytes() == original and cfg.ack_file.read_bytes() == ack


# ---------------------------------------------------------------------------
# Issue 50: Webhook an die NAS-App nach sicherem InfluxDB-Write
# ---------------------------------------------------------------------------


def webhook_cfg(uploader, saved_buffer, url, token=""):
    cfg, _ = saved_buffer
    # Ack vor den Snapshot zurücksetzen, damit der Upload Zeilen hat
    # ( gleiche Ausgangslage wie test_normal_upload_keeps_ack_until_success...).
    if url:
        cfg.ack_file.write_text("2026-09-07T05:00:00+00:00\n")
    return uploader.Cfg(
        cfg.url,
        cfg.org,
        cfg.bucket,
        cfg.token,
        cfg.poll_dir,
        cfg.poll_json,
        nas_webhook_url=url,
        nas_webhook_token=token,
    )


def test_upload_success_triggers_nas_webhook_with_watermark(
    uploader, saved_buffer, monkeypatch, capsys
):
    calls = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        status = 200

    def fake_urlopen(request, timeout):
        calls.append(
            (
                request.full_url,
                json.loads(request.data.decode()),
                dict(request.headers),
                timeout,
            )
        )
        return FakeResponse()

    monkeypatch.setattr(uploader.urllib.request, "urlopen", fake_urlopen)
    # Kurz nach einem Pi-Neustart ist monotonic() kleiner als die 240-s-Sperre.
    # Der erste Trigger muss trotzdem sofort gesendet werden; erst Folgetrigger
    # werden gedrosselt.
    monkeypatch.setattr(uploader.time, "monotonic", lambda: 10.0)
    cfg = webhook_cfg(uploader, saved_buffer, "http://nas:1355", token="shared-secret")
    monkeypatch.setattr(uploader, "influx_write", lambda cfg, lines: None)
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert len(calls) == 1
    url, payload, headers, timeout = calls[0]
    assert url == "http://nas:1355/api/v1/jobs/trigger"
    assert payload["job"] == "models"
    # Watermark = Epochensekunden des neuesten Snapshots (TIME, UTC).
    import datetime as dt

    expected = int(dt.datetime.fromisoformat(TIME).timestamp())
    assert payload["watermark"] == expected
    assert headers.get("Authorization") == "Bearer shared-secret"
    assert timeout <= uploader.WEBHOOK_TIMEOUT_S
    # Trigger-Log darf das Secret nie enthalten.
    captured = capsys.readouterr()
    assert "shared-secret" not in captured.out + captured.err


def test_webhook_failure_never_breaks_upload(uploader, saved_buffer, monkeypatch):
    def boom(request, timeout):
        raise urllib.error.URLError("trigger weg")

    monkeypatch.setattr(uploader.urllib.request, "urlopen", boom)
    cfg = webhook_cfg(uploader, saved_buffer, "http://nas:1355", token="t")
    received = []
    monkeypatch.setattr(
        uploader, "influx_write", lambda cfg, lines: received.extend(lines)
    )
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert len(received) == 2
    # Ack trotzdem vorgerückt — der Webhook ist reiner Optimierungsweg.
    assert cfg.ack_file.read_text().strip() == TIME


def test_webhook_rate_limited_and_only_with_price_rows(
    uploader, saved_buffer, monkeypatch
):
    import datetime as dt
    import time as time_mod

    calls = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        status = 200

    monkeypatch.setattr(
        uploader.urllib.request,
        "urlopen",
        lambda request, timeout: calls.append(request) or FakeResponse(),
    )
    cfg = webhook_cfg(uploader, saved_buffer, "http://nas:1355", token="t")
    monkeypatch.setattr(uploader, "influx_write", lambda cfg, lines: None)
    state = uploader.State()
    assert uploader.run_upload(cfg, state) == 0
    assert len(calls) == 1

    # Gap-Sperre: zweiter Trigger direkt danach wird gedrosselt.
    uploader.notify_nas(cfg, state, dt.datetime.fromisoformat(TIME))
    assert len(calls) == 1
    state.last_webhook = time_mod.monotonic() - uploader.WEBHOOK_MIN_GAP_S - 1
    uploader.notify_nas(cfg, state, dt.datetime.fromisoformat(TIME))
    assert len(calls) == 2

    # Ohne konfigurierte URL: gar kein Netzwerkcall (Standardbetrieb).
    cfg_off = webhook_cfg(uploader, saved_buffer, "")
    state.last_webhook = 0.0
    uploader.notify_nas(cfg_off, state, dt.datetime.fromisoformat(TIME))
    assert len(calls) == 2


def test_webhook_skipped_when_only_heartbeat_uploaded(
    uploader, saved_buffer, monkeypatch
):
    cfg, path = saved_buffer
    writes = []
    calls = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        status = 200

    monkeypatch.setattr(
        uploader.urllib.request,
        "urlopen",
        lambda request, timeout: calls.append(request) or FakeResponse(),
    )
    cfg = webhook_cfg(uploader, saved_buffer, "http://nas:1355", token="t")
    cfg.ack_file.write_text(TIME + "\n")  # alles schon hochgeladen

    def write(cfg, lines):
        writes.extend(lines)

    monkeypatch.setattr(uploader, "influx_write", write)
    # Heartbeat vorhanden, aber keine Preiszeilen hinter dem Ack.
    heartbeat = cfg.poll_dir / "meta" / "heartbeat.json"
    heartbeat.write_text(
        json.dumps(
            {
                "last_poll_at": "2026-09-07T06:05:00+00:00",
                "city": "Testmarkt",
                "poll_count": 12,
                "tmpfs": {"total_bytes": 1, "used_bytes": 1},
                "oldest_file": {"age_days": 0.1},
            }
        )
    )
    assert uploader.run_upload(cfg, uploader.State()) == 0
    assert len(writes) == 1 and "collector_status" in writes[0]
    assert calls == []  # Heartbeat-Write löst keinen Modell-Trigger aus
