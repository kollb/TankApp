"""B4: Alarm-Zustellung über ntfy — ein Webhook, kein Netz in den Tests.

Geprüft wird die Kette Alarm → Entscheidung → Payload → Zustellung → Zustand:
keine Doppel-Meldung im Takt, Erinnerung nach Ablauf, „wieder betriebsbereit“
beim Abräumen, kein Effekt bei fehlgeschlagener Zustellung und vor allem: keine
Preis- oder Stationsdetails im Text (Datenschutz-Zusage aus TODO B4).
"""

import datetime as dt
import json
import urllib.error

import pytest

from app.alarms import build_alarms
from app.config import Settings
from app.data import LiveData
from app.notify import (
    NOTIFY_REPEAT_S,
    Notifier,
    alarm_lines,
    build_payload,
    error_codes,
    load_state,
    notify_status,
    plan,
    post,
    save_state,
)

NOW = dt.datetime(2026, 9, 12, 6, 0, tzinfo=dt.timezone.utc)
URL = "https://ntfy.example/tankapp"

HEARTBEAT = {
    "code": "collector_no_heartbeat",
    "severity": "error",
    "message": "Noch kein Collector-Herzschlag des Pi auf dem NAS.",
}
JOB_MODELS = {
    "code": "job_failed",
    "severity": "error",
    "job": "models",
    "message": "NAS-Job „models“ ist fehlgeschlagen — Prognosen und Rankings können veraltet sein.",
}
JOB_SELECTION = {**JOB_MODELS, "job": "selection"}
STALE = {
    "code": "collector_stale",
    "severity": "warn",
    "message": "Collector-Herzschlag ist veraltet (Preise können eingefroren sein).",
}


@pytest.fixture
def settings(tmp_path):
    return Settings(data=tmp_path / "data", notify_url=URL)


@pytest.fixture
def bare(tmp_path):
    """Ohne notify_url — Zustellung muss ausgeschaltet bleiben."""
    return Settings(data=tmp_path / "data")


class FakeResponse:
    def __init__(self, status=200):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self):
        return b""


class FakeOpener:
    """Sammelt POSTs; ``fail`` spielt einen Netzfehler ohne Interna nach."""

    def __init__(self, fail=False, status=200):
        self.calls = []
        self.fail = fail
        self.status = status

    def __call__(self, request, timeout=None):
        self.calls.append(
            {
                "url": request.full_url,
                "method": request.get_method(),
                "timeout": timeout,
                "payload": json.loads(request.data.decode("utf-8")),
            }
        )
        if self.fail:
            raise OSError("connection refused")
        if self.status >= 400:
            raise urllib.error.HTTPError(URL, self.status, "error", {}, None)
        return FakeResponse(self.status)

    @property
    def messages(self):
        return [call["payload"]["message"] for call in self.calls]


def notifier(settings, alarms, opener=None, now=NOW):
    return Notifier(
        settings,
        lambda: alarms,
        version="0.14.0",
        opener=opener,
        clock=lambda: now,
    )


# ---------------------------------------------------------------------------
# Reine Funktionen
# ---------------------------------------------------------------------------


def test_error_codes_only_counts_errors_and_is_stable():
    codes = error_codes([STALE, JOB_MODELS, HEARTBEAT, HEARTBEAT, "quatsch", None])
    assert codes == ["collector_no_heartbeat", "job_failed"]
    assert error_codes([]) == []
    assert error_codes(None) == []


def test_alarm_lines_names_every_job_and_falls_back_to_the_code():
    lines = alarm_lines(
        [
            JOB_MODELS,
            JOB_SELECTION,
            STALE,
            {"code": "store_too_large", "severity": "error"},
        ],
        ["job_failed", "store_too_large"],
    )
    assert lines[0].startswith("job_failed (models) — NAS-Job")
    assert lines[1].startswith("job_failed (selection) — NAS-Job")
    # Ohne Klartext bleibt der stabile Code — nichts wird erfunden.
    assert lines[2] == "store_too_large"
    # Warnungen gehören nicht in den Push-Text.
    assert not any("collector_stale" in line for line in lines)


def test_payload_carries_codes_severity_and_version_only():
    payload = build_payload(
        ["collector_no_heartbeat"],
        alarm_lines([HEARTBEAT], ["collector_no_heartbeat"]),
        version="0.14.0",
    )
    assert payload["priority"] == 4
    assert payload["tags"] == ["warning"]
    assert payload["title"] == "TankApp: 1 Alarm"
    assert "collector_no_heartbeat" in payload["message"]
    assert "TankApp 0.14.0" in payload["message"]

    recovered = build_payload([], [], version="0.14.0", recovered=True)
    assert recovered["priority"] == 2
    assert recovered["title"] == "TankApp: wieder betriebsbereit"


def test_payload_from_real_alarms_leaks_no_prices_or_stations(tmp_path):
    """Datenschutz-Zusage B4: Der Push-Text trägt keine Betriebsdetails."""
    settings = Settings(data=tmp_path / "data", notify_url=URL)
    alarms = build_alarms(
        settings,
        collector={"available": False},
        jobs={"models": {"state": "failed"}},
        job_errors={"models": "influx_read_failed"},
        polling_error=None,
        station_count=18,
    )
    codes = error_codes(alarms)
    text = json.dumps(
        build_payload(codes, alarm_lines(alarms, codes), version="0.14.0")
    )
    assert "collector_no_heartbeat" in text and "job_failed" in text
    # Weder Preise, noch Stationen, noch Koordinaten, noch Pfade.
    for forbidden in (
        "€/L",
        "ct/L",
        "00000000",
        "Station",
        "50.1",
        "8.6",
        "/home",
        "runtime",
    ):
        assert forbidden not in text


def test_plan_sends_on_change_and_repeats_after_the_interval():
    fresh = {"sent": {}, "last_ok_at": None}
    assert plan(fresh, [], NOW) == {
        "send": [],
        "repeat": [],
        "new": [],
        "gone": [],
        "recovered": False,
    }
    codes = ["collector_no_heartbeat", "job_failed"]
    first = plan(fresh, codes, NOW)
    assert first["send"] == codes and first["new"] == codes

    sent = {"sent": {code: NOW.isoformat() for code in codes}, "last_ok_at": None}
    # Gleicher Zustand im nächsten Tick → keine Meldung (kein Spam im 5-Minuten-Takt).
    assert plan(sent, codes, NOW + dt.timedelta(seconds=300))["send"] == []
    # Nach der Erinnerungs-Frist bleibt der Dauerfehler sichtbar.
    late = plan(sent, codes, NOW + dt.timedelta(seconds=NOTIFY_REPEAT_S))
    assert late["send"] == codes and late["repeat"] == codes and late["new"] == []
    # Ein neuer Code kommt sofort, der alte wartet auf seine Frist.
    mixed = plan(sent, codes + ["store_too_large"], NOW + dt.timedelta(seconds=60))
    assert mixed["send"] == ["store_too_large"]
    # Alles weg → einmal „wieder betriebsbereit“.
    cleared = plan(sent, [], NOW + dt.timedelta(seconds=60))
    assert cleared["recovered"] is True and cleared["send"] == []
    assert cleared["gone"] == codes
    # Teilweise beruhigt: Zustand nachziehen, aber keine eigene Meldung.
    partial = plan(sent, ["job_failed"], NOW + dt.timedelta(seconds=60))
    assert partial["recovered"] is False and partial["send"] == []
    assert partial["gone"] == ["collector_no_heartbeat"]


def test_state_survives_a_roundtrip_and_ignores_garbage(settings):
    assert load_state(settings) == {"sent": {}, "last_ok_at": None}
    assert save_state(
        settings, {"sent": {"job_failed": NOW.isoformat()}, "last_ok_at": None}
    )
    assert load_state(settings)["sent"] == {"job_failed": NOW.isoformat()}

    path = settings.runtime / "notify" / "state.json"
    path.write_text("{ kaputt", encoding="utf-8")
    assert load_state(settings) == {"sent": {}, "last_ok_at": None}
    path.write_text(json.dumps({"sent": {"a": 1}, "last_ok_at": 2}), encoding="utf-8")
    # Fremde Typen werden verworfen statt halb übernommen.
    assert load_state(settings) == {"sent": {}, "last_ok_at": None}


def test_post_reports_http_and_network_failures_without_internals():
    assert post(URL, {"title": "x"}, opener=FakeOpener())[0] is True
    ok, cause = post(URL, {"title": "x"}, opener=FakeOpener(status=500))
    assert (ok, cause) == (False, "HTTP 500")
    ok, cause = post(URL, {"title": "x"}, opener=FakeOpener(fail=True))
    assert ok is False
    assert URL not in cause and "ntfy.example" not in cause


# ---------------------------------------------------------------------------
# Notifier-Ticks (Zustellung + Zustand)
# ---------------------------------------------------------------------------


def test_disabled_without_webhook(bare):
    opener = FakeOpener()
    result = notifier(bare, [HEARTBEAT], opener).tick()
    assert result == {"skipped": "not_configured", "delivered": False}
    assert opener.calls == []


def test_first_tick_delivers_and_deduplicates(settings):
    opener = FakeOpener()
    note = notifier(settings, [HEARTBEAT, JOB_MODELS], opener)
    first = note.tick()
    assert first["delivered"] is True
    assert first["sent"] == ["collector_no_heartbeat", "job_failed"]
    assert len(opener.calls) == 1
    call = opener.calls[0]
    assert call["url"] == URL and call["method"] == "POST"
    assert call["payload"]["priority"] == 4
    assert "job_failed (models)" in call["payload"]["message"]

    # Zweiter Tick, gleicher Zustand: nichts senden.
    second = note.tick()
    assert second["delivered"] is False and second["sent"] == []
    assert len(opener.calls) == 1
    assert load_state(settings)["sent"].keys() == {
        "collector_no_heartbeat",
        "job_failed",
    }


def test_repeat_reminder_after_the_interval(settings):
    opener = FakeOpener()
    notifier(settings, [HEARTBEAT], opener, now=NOW).tick()
    assert len(opener.calls) == 1
    # Kurz vor der Frist: still. Danach: Erinnerung.
    notifier(settings, [HEARTBEAT], opener, now=NOW + dt.timedelta(seconds=60)).tick()
    assert len(opener.calls) == 1
    notifier(
        settings,
        [HEARTBEAT],
        opener,
        now=NOW + dt.timedelta(seconds=NOTIFY_REPEAT_S + 1),
    ).tick()
    assert len(opener.calls) == 2
    assert opener.calls[1]["payload"]["title"] == "TankApp: 1 Alarm"


def test_recovery_is_announced_once_and_clears_the_state(settings):
    opener = FakeOpener()
    alarms = [HEARTBEAT]
    notifier(settings, alarms, opener).tick()
    assert len(opener.calls) == 1

    alarms.clear()
    note = notifier(settings, alarms, opener, now=NOW + dt.timedelta(seconds=600))
    result = note.tick()
    assert result["recovered"] is True and result["delivered"] is True
    assert len(opener.calls) == 2
    assert opener.calls[1]["payload"]["priority"] == 2
    assert "wieder betriebsbereit" in opener.calls[1]["payload"]["title"]
    state = load_state(settings)
    assert state["sent"] == {} and state["last_ok_at"]

    # Und nicht noch einmal, solange nichts Neues kommt.
    note.tick()
    assert len(opener.calls) == 2


def test_failed_delivery_keeps_the_alarm_open(settings):
    opener = FakeOpener(fail=True)
    note = notifier(settings, [HEARTBEAT], opener)
    result = note.tick()
    assert result["delivered"] is False
    # Nichts als zugestellt merken → der nächste Tick versucht es erneut.
    assert load_state(settings)["sent"] == {}
    assert URL not in note.last_error

    healthy = FakeOpener()
    note.opener = healthy
    assert note.tick()["delivered"] is True
    assert len(healthy.calls) == 1


def test_warnings_never_trigger_a_push(settings):
    opener = FakeOpener()
    result = notifier(settings, [STALE], opener).tick()
    assert opener.calls == []
    assert result["delivered"] is False and result["codes"] == []


def test_a_broken_tick_does_not_escape(settings, monkeypatch):
    def explode():
        raise RuntimeError("kaputte Alarm-Quelle")

    note = Notifier(settings, explode, version="0.14.0", opener=FakeOpener())
    ticks = {"n": 0}

    def wait(*_args):
        ticks["n"] += 1
        return ticks["n"] > 1  # ein Tick, dann Stopp

    monkeypatch.setattr(note.stop_event, "wait", wait)
    note._loop()  # darf nicht werfen
    assert ticks["n"] == 2
    assert "kaputte Alarm-Quelle" in note.last_error


def test_health_shows_whether_delivery_is_configured(settings, bare):
    configured = LiveData(settings).health()
    assert configured["notify"]["configured"] is True
    assert configured["notify"]["open_errors"] == []
    # Polling fehlt in diesem Testaufbau → ein echter Error-Alarm liegt an.
    assert "polling_missing" in [a["code"] for a in configured["alarms"]]

    assert LiveData(bare).health()["notify"] == {
        "configured": False,
        "open_errors": [],
        "last_ok_at": None,
        "last_sent_at": None,
    }


def test_notify_status_reports_open_errors(settings):
    notifier(settings, [HEARTBEAT, JOB_MODELS], FakeOpener()).tick()
    status = notify_status(settings)
    assert status["configured"] is True
    assert status["open_errors"] == ["collector_no_heartbeat", "job_failed"]
    assert status["last_ok_at"] is None
    # B4-GUI: Der System-Tab zeigt „zuletzt gemeldet“ — dafür braucht er einen
    # Zeitstempel der tatsächlich zugestellten Meldung, nicht nur die Codes.
    assert status["last_sent_at"] == NOW.isoformat()
