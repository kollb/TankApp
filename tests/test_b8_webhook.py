"""B8: Webhook Pi → NAS quittiert und wiederholt statt zu verschwinden.

Vorher war ``POST /api/v1/jobs/trigger`` Feuer-und-Vergessen: Ein kurzer
NAS-Ausfall kostete den Wasserstand, der Modell-Job lief nur noch im
Intervall — und nirgends stand, dass ein Trigger verloren ging. Hier stehen
die Zusagen: Wiederholung mit Backoff, Quittierung aus der Antwort,
dauerhafte Fehler werden nicht wiederholt, und der Zustand ist über den
Herzschlag sichtbar (``collector_status`` → System-Bereich).

Kein Netz: ``urlopen`` wird ersetzt; die letzte Prüfung fährt gegen den
echten NAS-Handler (``app.server``) mit ``Scheduler.request``.
"""

import datetime as dt
import importlib.util
import json
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TIME = "2026-09-07T06:00:00+00:00"


@pytest.fixture
def uploader():
    path = ROOT / "data-tools/upload_influx.py"
    spec = importlib.util.spec_from_file_location("test_b8_uploader", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _cfg(uploader, url="http://nas:1355", token="shared-secret"):
    return uploader.Cfg(
        "",
        "",
        "",
        "",
        Path("/tmp/tankapp-b8-poll"),
        Path("/tmp/tankapp-b8-poll.json"),
        nas_webhook_url=url,
        nas_webhook_token=token,
    )


class _Response:
    """Minimale Antwort-Attrappe mit Status und Body."""

    def __init__(self, status=200, body: bytes = b""):
        self.status = status
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._body


def test_trigger_wird_nach_fehlschlag_wiederholt(uploader, monkeypatch, capsys):
    """URLError → vorgemerkt mit Backoff; der nächste Zyklus sendet erneut."""
    calls = []
    answers = [
        urllib.error.URLError("NAS weg"),
        _Response(200, b'{"status": "queued"}'),
    ]

    def fake_urlopen(request, timeout):
        calls.append(request)
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(uploader.urllib.request, "urlopen", fake_urlopen)
    state = uploader.State()
    cfg = _cfg(uploader)

    uploader.notify_nas(cfg, state, dt.datetime.fromisoformat(TIME))
    assert len(calls) == 1
    assert state.webhook_pending is not None
    status = uploader.webhook_status(state)
    assert status["pending"] is True
    assert status["attempts"] == 1
    assert status["last_status"] == "retry_wait"

    # Vor Ablauf des Backoffs passiert nichts.
    uploader.webhook_tick(cfg, state)
    assert len(calls) == 1

    # Nach Ablauf: zweiter Versuch, diesmal quittiert.
    state.webhook_pending["next_at"] = 0.0
    uploader.webhook_tick(cfg, state)
    assert len(calls) == 2
    assert state.webhook_pending is None
    after = uploader.webhook_status(state)
    assert after["pending"] is False
    assert after["last_status"] == "queued"
    assert after["last_ok_age_s"] is not None
    # Kein Secret in den Logs.
    captured = capsys.readouterr()
    assert "shared-secret" not in captured.out + captured.err


def test_backoff_waechst_bis_zur_obergrenze(uploader, monkeypatch):
    monkeypatch.setattr(
        uploader.urllib.request,
        "urlopen",
        lambda request, timeout: (_ for _ in ()).throw(urllib.error.URLError("weg")),
    )
    state = uploader.State()
    cfg = _cfg(uploader)
    uploader.notify_nas(cfg, state, dt.datetime.fromisoformat(TIME))
    waits = []
    for _ in range(8):
        state.webhook_pending["next_at"] = 0.0
        uploader.webhook_tick(cfg, state)
        waits.append(
            round(state.webhook_pending["next_at"] - uploader.time.monotonic())
        )
    assert waits[0] < waits[-1]
    assert max(waits) <= uploader.WEBHOOK_RETRY_MAX_S
    assert state.webhook_pending["attempts"] == 9


def test_dauerhafter_fehler_wird_nicht_wiederholt(uploader, monkeypatch):
    """403 (falsches Token) ist kein Netzproblem — Wiederholen hilft nicht."""
    calls = []

    def fake_urlopen(request, timeout):
        calls.append(request)
        raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, None)

    monkeypatch.setattr(uploader.urllib.request, "urlopen", fake_urlopen)
    state = uploader.State()
    uploader.notify_nas(_cfg(uploader), state, dt.datetime.fromisoformat(TIME))
    assert len(calls) == 1
    assert state.webhook_pending is None
    assert state.webhook_last_status == "http_403"
    # Kein Wiederholungsversuch.
    state.webhook_pending = None
    uploader.webhook_tick(_cfg(uploader), state)
    assert len(calls) == 1


def test_abgelehnter_job_wird_quittiert_und_verworfen(uploader, monkeypatch):
    """Der NAS antwortet 200 mit ``rejected`` — das ist eine Antwort, kein Netzfehler."""
    calls = []
    monkeypatch.setattr(
        uploader.urllib.request,
        "urlopen",
        lambda request, timeout: (
            calls.append(request)
            or _Response(200, b'{"status": "rejected", "reason": "unknown_job"}')
        ),
    )
    state = uploader.State()
    uploader.notify_nas(_cfg(uploader), state, dt.datetime.fromisoformat(TIME))
    assert calls and state.webhook_pending is None
    assert state.webhook_last_status == "rejected"


def test_aufgeben_nach_zwei_stunden(uploader, monkeypatch, capsys):
    """Endloses Wiederholen wäre eine Lüge — nach 2 h übernimmt der Intervalljob."""
    calls = []
    monkeypatch.setattr(
        uploader.urllib.request,
        "urlopen",
        lambda request, timeout: (
            calls.append(request) or (_ for _ in ()).throw(urllib.error.URLError("weg"))
        ),
    )
    state = uploader.State()
    cfg = _cfg(uploader)
    uploader.notify_nas(cfg, state, dt.datetime.fromisoformat(TIME))
    assert len(calls) == 1
    state.webhook_pending["first_at"] -= uploader.WEBHOOK_MAX_AGE_S + 1
    state.webhook_pending["next_at"] = 0.0
    uploader.webhook_tick(cfg, state)
    assert len(calls) == 1
    assert state.webhook_pending is None
    assert state.webhook_last_status == "abandoned"
    assert state.webhook_gave_up == 1
    assert "aufgegeben" in capsys.readouterr().out


def test_herzschlag_meldet_den_zustand_nur_bei_eingerichtetem_ziel(uploader):
    heartbeat = {
        "last_poll_at": TIME,
        "city": "Testmarkt",
        "poll_count": 12,
        "tmpfs": {"total_bytes": 1, "used_bytes": 1},
        "oldest_file": {"age_days": 0.1},
    }
    state = uploader.State()

    # Ohne Ziel: keine Felder — „nicht eingerichtet“ statt einer Null.
    assert "webhook_pending" not in uploader.heartbeat_to_line(
        heartbeat, webhook=uploader.webhook_influx_fields(_cfg(uploader, url=""), state)
    )

    state.webhook_pending = {
        "job": "models",
        "watermark": 1757584800,
        "attempts": 3,
        "first_at": uploader.time.time() - 600,
        "next_at": 0.0,
        "last_note": "URLError",
    }
    line = uploader.heartbeat_to_line(
        heartbeat, webhook=uploader.webhook_influx_fields(_cfg(uploader), state)
    )
    assert "webhook_pending=1i" in line
    assert "webhook_attempts=3i" in line
    assert "webhook_pending_age_s=600i" in line
    # Kein Token, keine URL im Punkt.
    assert "shared-secret" not in line and "nas:1355" not in line


def test_collector_status_hebt_den_webhook_zustand_heraus():
    from app.collector_status import _webhook_from_fields

    assert _webhook_from_fields({}) is None
    assert _webhook_from_fields({"last_poll_at": TIME}) is None

    lifted = _webhook_from_fields(
        {
            "webhook_pending": 1,
            "webhook_attempts": 2,
            "webhook_pending_age_s": 300,
            "webhook_last_status": "retry_wait",
        }
    )
    assert lifted == {
        "pending": True,
        "attempts": 2,
        "pending_age_s": 300,
        "last_status": "retry_wait",
        "last_ok_age_s": None,
        "gave_up": None,
    }


def test_quittierung_gegen_den_echten_nas_handler(tmp_path):
    """Der ganze Weg: Uploader-Retry → echter Handler → ``Scheduler.request``.

    Kein Mock auf der Serverseite: ``app.server`` entscheidet wie im Betrieb
    (Token, Debounce/Idempotenz) — der Test belegt, dass die Quittierung, die
    der Uploader verbucht, auch die des NAS ist.
    """
    from app.config import Settings
    from app.data import LiveData
    from app.server import Scheduler, make_server

    settings = Settings(
        data=tmp_path,
        archive=tmp_path / "archive",
        polling=tmp_path / "polling.json",
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "_netrc",
        webhook_token="shared-secret",
    )
    data = LiveData(settings)
    data.scheduler = Scheduler(settings)
    data.jobs_enabled = True
    server = make_server(settings, "127.0.0.1", 0, data)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        spec = importlib.util.spec_from_file_location(
            "test_b8_uploader_http", ROOT / "data-tools/upload_influx.py"
        )
        uploader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(uploader)
        cfg = _cfg(uploader, url=base, token="shared-secret")
        state = uploader.State()
        uploader.notify_nas(cfg, state, dt.datetime.fromisoformat(TIME))
        assert state.webhook_pending is None, "der echte NAS hat nicht quittiert"
        assert state.webhook_last_status == "queued"
        # Der Scheduler hat den Wasserstand vorgemerkt (die Job-Schleife selbst
        # läuft in diesem Test nicht — ihre Zählung wäre keine Aussage über
        # die Quittierung).
        assert data.scheduler.pending["models"] == int(
            dt.datetime.fromisoformat(TIME).timestamp()
        )

        # Falsches Token: 403 → dauerhaft, nicht wiederholt.
        wrong = _cfg(uploader, url=base, token="falsch")
        state2 = uploader.State()
        uploader.notify_nas(wrong, state2, dt.datetime.fromisoformat(TIME))
        assert state2.webhook_pending is None
        assert state2.webhook_last_status == "http_403"
    finally:
        server.shutdown()
        thread.join(timeout=5)


def test_kaputter_body_gilt_als_quittiert(uploader, monkeypatch):
    """HTTP 200 ohne lesbaren Body: angenommen — kein Retry-Sturm."""
    monkeypatch.setattr(
        uploader.urllib.request,
        "urlopen",
        lambda request, timeout: _Response(200, b"kein json"),
    )
    state = uploader.State()
    uploader.notify_nas(_cfg(uploader), state, dt.datetime.fromisoformat(TIME))
    assert state.webhook_pending is None
    assert state.webhook_last_status == "http_200"


def test_dry_run_und_json_body_bleiben_unveraendert(uploader):
    """Der Payload bleibt, was der NAS erwartet (Job + Wasserstand)."""
    seen = {}

    def fake_urlopen(request, timeout):
        seen["body"] = json.loads(request.data.decode())
        seen["auth"] = request.headers.get("Authorization")
        return _Response(200, b'{"status": "debounced"}')

    state = uploader.State()
    import unittest.mock as mock

    with mock.patch.object(uploader.urllib.request, "urlopen", fake_urlopen):
        uploader.notify_nas(_cfg(uploader), state, dt.datetime.fromisoformat(TIME))
    assert seen["body"] == {
        "job": "models",
        "watermark": int(dt.datetime.fromisoformat(TIME).timestamp()),
    }
    assert seen["auth"] == "Bearer shared-secret"
