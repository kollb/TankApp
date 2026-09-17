"""Batch 3 (O29 + O42): Fenster-Meldungen über den bestehenden ntfy-Kanal.

O29: Ein empfohlenes Fenster meldet sich — genau eine Meldung je
``episode.id``, wenn das Fenster aufgeht (Verteilungs-P über der Schwelle),
eine Abschlussmeldung, wenn es ungenutzt verstreicht, und eine
Änderungs-Meldung, wenn die Empfehlung auf ein anderes Fenster kippt.
Nachts (Ruhezeit, Europe/Berlin) bleibt der Push still.

O42: Der Payload richtet sich nach der dokumentierten Kanal-Entscheidung —
``public`` (Default): keine Preise, keine Stationen im Text; ``lan``
(selbst gehostetes ntfy): Station, Fensterzeit und erwarteter Preis sind
erlaubt, Koordinaten und Pfade nie.
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.feedback import feedback_path, record_snapshot
from app.notify import (
    NTFY_PRIORITY_OK,
    NTFY_PRIORITY_WINDOW,
    WINDOW_PUSH_P_MIN,
    Notifier,
    build_window_payload,
    in_quiet_hours,
    load_windows_state,
    notify_status,
    plan_window_events,
)

URL = "https://ntfy.example/tankapp"
UTC = dt.timezone.utc
# 12:00 UTC = 14:00 Berlin (Sommerzeit) — außerhalb der Ruhezeit.
DAY = dt.datetime(2026, 9, 12, 12, 0, tzinfo=UTC)
# 21:00 UTC = 23:00 Berlin — innerhalb der Ruhezeit (22–7 Uhr).
NIGHT = dt.datetime(2026, 9, 12, 21, 0, tzinfo=UTC)

WINDOW = {
    "action": "wait",
    "city": "Teststadt",
    "station_id": "uuid-1",
    "station_name": "Teststation Mitte",
    "price_now": 1.749,
    "window_start": "2026-09-12T18:00:00+02:00",
    "window_end": "2026-09-12T20:00:00+02:00",
    "expected_price": 1.719,
    "p_besser": 0.83,
    "liters_assumed": 40.0,
    "fuel": "e10",
}


class FakeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self):
        return b""


class FakeOpener:
    """Sammelt POSTs; ``fail`` spielt einen Zustellfehler nach."""

    def __init__(self, fail=False):
        self.posts = []
        self.fail = fail

    def __call__(self, request, timeout=None):
        self.posts.append(json.loads(request.data.decode("utf-8")))
        if self.fail:
            raise OSError("connection refused")
        return FakeResponse()


def make_settings(tmp_path, mode="public"):
    return Settings(data=tmp_path / "data", notify_url=URL, notify_mode=mode)


def notifier(settings, clock=DAY, opener=None):
    return Notifier(
        settings,
        lambda: [],  # keine Alarme — hier geht es nur um Fenster-Meldungen
        version="0.46.0",
        opener=opener or FakeOpener(),
        clock=lambda: clock,
    )


def open_window_episode(settings, clock=DAY, **overrides):
    """Eine offene Episode mit empfohlenem Fenster über den echten Pfad."""
    data = {**WINDOW, **overrides}
    record_snapshot(settings, data, clock=lambda: clock)
    return settings


def set_episode_status(settings, status):
    path = feedback_path(settings)
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["episodes"][0]["status"] = status
    raw["episodes"][0]["closed_at"] = DAY.isoformat()
    path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")


# --- O42: die Payload-Regel je Kanal-Modus --------------------------------


def test_public_mode_payload_names_neither_price_nor_station(tmp_path):
    payload = build_window_payload("open", WINDOW, mode="public", version="0.46.0")
    text = f"{payload['title']}\n{payload['message']}"
    assert "Teststation Mitte" not in text
    assert "1,719" not in text
    assert "1.719" not in text
    assert "€/L" not in payload["message"]
    assert payload["priority"] == NTFY_PRIORITY_WINDOW
    assert "0.46.0" in payload["message"]


def test_lan_mode_payload_carries_station_window_and_price(tmp_path):
    payload = build_window_payload("open", WINDOW, mode="lan")
    text = payload["message"]
    assert "Teststation Mitte" in text
    assert "18:00 Uhr" in text and "20:00 Uhr" in text
    assert "1,719 €/L" in text  # de-DE über den Formatter, nicht 1.719
    # Koordinaten und Pfade bleiben auch im LAN-Modus verboten.
    assert "lat" not in text.lower() and "data/" not in text


def test_payload_never_carries_paths_or_links_in_any_mode(tmp_path):
    """Weder Modi noch Arten dürfen Pfade, Links oder Koordinaten tragen."""
    for mode in ("public", "lan"):
        for kind in ("open", "changed", "expired"):
            payload = build_window_payload(kind, WINDOW, mode=mode)
            text = f"{payload['title']}\n{payload['message']}"
            assert "data/" not in text
            assert "runtime" not in text
            assert "http" not in text


def test_expired_payload_public_stays_neutral():
    payload = build_window_payload("expired", WINDOW, mode="public")
    assert payload["priority"] == NTFY_PRIORITY_OK
    assert "Teststation Mitte" not in payload["message"]
    assert payload["message"].startswith("Das empfohlene Zeitfenster")


def test_expired_payload_lan_names_window_and_station():
    payload = build_window_payload("expired", WINDOW, mode="lan")
    assert "18:00 Uhr" in payload["message"]
    assert "Teststation Mitte" in payload["message"]


# --- Ruhezeit (Europe/Berlin) ----------------------------------------------


@pytest.mark.parametrize(
    "stamp,quiet",
    [
        (dt.datetime(2026, 9, 12, 19, 59, tzinfo=UTC), False),  # 21:59 Berlin
        (dt.datetime(2026, 9, 12, 20, 0, tzinfo=UTC), True),  # 22:00 Berlin
        (dt.datetime(2026, 9, 12, 4, 59, tzinfo=UTC), True),  # 06:59 Berlin
        (dt.datetime(2026, 9, 12, 5, 0, tzinfo=UTC), False),  # 07:00 Berlin
        (dt.datetime(2026, 1, 12, 11, 30, tzinfo=UTC), False),  # Winter 12:30
        (dt.datetime(2026, 1, 12, 21, 30, tzinfo=UTC), True),  # Winter 22:30
    ],
)
def test_quiet_hours_follow_berlin_time(stamp, quiet):
    assert in_quiet_hours(stamp) is quiet


# --- O29: genau eine Meldung je Episode ------------------------------------


def test_window_open_sends_exactly_one_message_per_episode(tmp_path):
    settings = make_settings(tmp_path)
    open_window_episode(settings)
    fake = FakeOpener()
    n = notifier(settings, opener=fake)

    first = n.tick()
    assert first["windows"]["sent"] == ["open"]
    assert len(fake.posts) == 1
    assert fake.posts[0]["title"] == "TankApp: Günstiges Tankfenster offen"

    # Zweiter und dritter Takt: dieselbe Episode, dasselbe Fenster — still.
    assert "windows" not in n.tick()
    assert "windows" not in n.tick()
    assert len(fake.posts) == 1


def test_window_below_p_threshold_stays_silent(tmp_path):
    settings = make_settings(tmp_path)
    open_window_episode(settings, p_besser=WINDOW_PUSH_P_MIN - 0.01)
    fake = FakeOpener()
    n = notifier(settings, opener=fake)
    assert "windows" not in n.tick()
    assert fake.posts == []


def test_window_without_distribution_p_stays_silent(tmp_path):
    """Ohne Verteilungs-P fehlt die Messung — kein Push (O5: keine Basisrate)."""
    settings = make_settings(tmp_path)
    open_window_episode(settings, p_besser=None)
    fake = FakeOpener()
    n = notifier(settings, opener=fake)
    assert "windows" not in n.tick()
    assert fake.posts == []


def test_night_defers_until_morning_and_sends_once(tmp_path):
    settings = make_settings(tmp_path)
    open_window_episode(settings, clock=NIGHT)
    fake = FakeOpener()

    night = Notifier(
        settings, lambda: [], version="0.46.0", opener=fake, clock=lambda: NIGHT
    )
    result = night.tick()
    assert result["windows"]["deferred"] == ["open"]
    assert result["windows"]["sent"] == []
    assert fake.posts == []

    # Wiederholung in der Ruhezeit: weiter still, keine zweite Ankündigung.
    assert night.tick()["windows"]["deferred"] == ["open"]
    assert fake.posts == []

    # Morgens außerhalb der Ruhezeit kommt genau die eine Meldung nach.
    morning = Notifier(
        settings, lambda: [], version="0.46.0", opener=fake, clock=lambda: DAY
    )
    assert morning.tick()["windows"]["sent"] == ["open"]
    assert len(fake.posts) == 1
    assert morning.tick().get("windows", {}).get("sent", []) == []
    assert len(fake.posts) == 1


def test_changed_window_sends_one_update_then_silence(tmp_path):
    settings = make_settings(tmp_path)
    open_window_episode(settings)
    fake = FakeOpener()
    n = notifier(settings, opener=fake)
    assert n.tick()["windows"]["sent"] == ["open"]

    # Die Empfehlung kippt auf ein anderes Fenster (späterer Takt).
    later = DAY + dt.timedelta(minutes=40)
    record_snapshot(
        settings,
        {
            **WINDOW,
            "window_start": "2026-09-12T20:00:00+02:00",
            "window_end": "2026-09-12T22:00:00+02:00",
            "expected_price": 1.709,
        },
        clock=lambda: later,
    )
    n2 = Notifier(
        settings, lambda: [], version="0.46.0", opener=fake, clock=lambda: later
    )
    assert n2.tick()["windows"]["sent"] == ["changed"]
    assert len(fake.posts) == 2
    assert fake.posts[1]["title"] == "TankApp: Tank-Empfehlung geändert"

    # Dieselbe Empfehlung erneut bestätigt: keine zweite Änderungs-Meldung.
    confirm = later + dt.timedelta(minutes=40)
    record_snapshot(
        settings,
        {
            **WINDOW,
            "window_start": "2026-09-12T20:00:00+02:00",
            "window_end": "2026-09-12T22:00:00+02:00",
            "expected_price": 1.709,
        },
        clock=lambda: confirm,
    )
    assert "windows" not in n2.tick()
    assert len(fake.posts) == 2


def test_expired_without_fill_sends_closing_message_once(tmp_path):
    settings = make_settings(tmp_path)
    open_window_episode(settings)
    fake = FakeOpener()
    n = notifier(settings, opener=fake)
    assert n.tick()["windows"]["sent"] == ["open"]

    set_episode_status(settings, "expired")
    later = DAY + dt.timedelta(hours=3)
    n2 = Notifier(
        settings, lambda: [], version="0.46.0", opener=fake, clock=lambda: later
    )
    assert n2.tick()["windows"]["sent"] == ["expired"]
    assert len(fake.posts) == 2
    assert fake.posts[1]["title"] == "TankApp: Tankfenster verstrichen"

    # Die Abschlussmeldung kommt genau einmal je Episode.
    assert "windows" not in n2.tick()
    assert len(fake.posts) == 2


def test_episode_expired_without_prior_push_gets_no_closing_message(tmp_path):
    """Nie gemeldet (P unter der Schwelle) → nichts abzuschließen."""
    settings = make_settings(tmp_path)
    open_window_episode(settings, p_besser=0.30)
    set_episode_status(settings, "expired")
    fake = FakeOpener()
    n = notifier(settings, opener=fake)
    assert "windows" not in n.tick()
    assert fake.posts == []


def test_used_episode_sends_no_closing_message(tmp_path):
    settings = make_settings(tmp_path)
    open_window_episode(settings)
    fake = FakeOpener()
    n = notifier(settings, opener=fake)
    assert n.tick()["windows"]["sent"] == ["open"]

    set_episode_status(settings, "resolved")
    assert "windows" not in n.tick()
    assert len(fake.posts) == 1


def test_failed_delivery_is_retried_not_marked(tmp_path):
    settings = make_settings(tmp_path)
    open_window_episode(settings)
    failing = FakeOpener(fail=True)
    n = notifier(settings, opener=failing)
    result = n.tick()
    # Zustellung fehlgeschlagen: nichts gesendet, nichts im Melde-Zustand.
    assert result.get("windows", {}).get("sent", []) == []
    assert result.get("windows", {}).get("delivered", False) is False

    # Der Melde-Zustand bleibt leer — der nächste Takt versucht es erneut.
    assert load_windows_state(settings)["episodes"] == {}
    working = FakeOpener()
    n2 = Notifier(
        settings, lambda: [], version="0.46.0", opener=working, clock=lambda: DAY
    )
    assert n2.tick()["windows"]["sent"] == ["open"]
    assert len(working.posts) == 1


def test_window_tick_without_notify_url_is_a_noop(tmp_path):
    settings = Settings(data=tmp_path / "data")  # kein notify_url
    assert notifier(settings).window_tick() == {
        "sent": [],
        "deferred": [],
        "delivered": False,
    }


def test_notify_status_names_the_push_mode(tmp_path):
    for mode, expected in (("public", "public"), ("lan", "lan")):
        settings = make_settings(tmp_path / mode, mode=mode)
        assert notify_status(settings)["mode"] == expected


def test_plan_window_events_ignores_non_wait_actions(tmp_path):
    store = {
        "episodes": [
            {
                "id": "ep_1",
                "status": "open",
                "last_snapshot": {
                    "action": "refuel_now",
                    "window_start": None,
                    "window_end": None,
                    "p_besser": 0.9,
                },
            }
        ]
    }
    assert plan_window_events(store, {"episodes": {}}) == []
