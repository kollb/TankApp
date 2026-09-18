"""O31: Wochen-Rückblick über den Kanal aus O29.

Geprüft wird die Zusage des Befunds: Die Meldung fasst **vorhandene**
Größen zusammen (keine neue Rechnung), erscheint höchstens einmal je
ISO-Woche, nie in der Ruhezeit, und im Modus ``public`` bleibt sie
stations- und preisfrei (O42). Der Ratchet am Ende nagelt fest, dass jede
Zahl über einen Formatter läuft — nicht über ein inline Format-Spec.
"""

import ast
import datetime as dt
import json
import pathlib

import pytest

from app.config import Settings
from app.notify import Notifier, notify_status
from app.recap import (
    RECAP_WINDOW_DAYS,
    build_facts,
    build_payload,
    de_ct,
    de_int,
    de_pct,
    iso_week,
    load_recap_state,
    load_selection,
    plan,
    recap_state_path,
    save_recap_state,
)

URL = "https://ntfy.example/tankapp"
# Donnerstag, 10:00 Berlin (CEST) — außerhalb der Ruhezeit.
NOW = dt.datetime(2026, 9, 17, 8, 0, tzinfo=dt.timezone.utc)
# 23:00 Berlin — inside WINDOW_QUIET_HOURS.
NIGHT = dt.datetime(2026, 9, 17, 21, 0, tzinfo=dt.timezone.utc)


@pytest.fixture
def settings(tmp_path):
    return Settings(data=tmp_path / "data", notify_url=URL)


@pytest.fixture
def lan(tmp_path):
    return Settings(data=tmp_path / "data", notify_url=URL, notify_mode="lan")


@pytest.fixture
def bare(tmp_path):
    return Settings(data=tmp_path / "data")


class FakeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self):
        return b""


class FakeOpener:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def __call__(self, request, timeout=None):
        self.calls.append(json.loads(request.data.decode("utf-8")))
        if self.fail:
            raise OSError("connection refused")
        return FakeResponse()

    @property
    def messages(self):
        return [call["message"] for call in self.calls]


def notifier(settings, opener=None, now=NOW):
    return Notifier(
        settings, lambda: [], version="0.50.0", opener=opener, clock=lambda: now
    )


def store_with(*outcomes, days_ago=0):
    """Settlements im Advice-Ledger-Format, ``days_ago`` vor NOW."""
    stamp = (NOW - dt.timedelta(days=days_ago)).isoformat()
    return {
        "schema_version": 3,
        "episodes": [],
        "fills": [],
        "settlements": [
            {"snapshot_id": f"s{i}", "settled_at": stamp, "outcome": outcome}
            for i, outcome in enumerate(outcomes)
        ],
    }


def selection_with(*rows):
    return {
        "stations": list(rows),
        "count": len(rows),
        "dead_count": 1,
        "n_days": 30,
        "error_code": None,
    }


# ---------------------------------------------------------------------------
# Reine Funktionen
# ---------------------------------------------------------------------------


def test_iso_week_is_a_stable_key():
    assert iso_week(NOW) == "2026-W38"
    # Dieselbe Woche, anderer Tag — derselbe Schlüssel.
    assert iso_week(NOW + dt.timedelta(days=2)) == "2026-W38"
    assert iso_week(NOW + dt.timedelta(days=7)) == "2026-W39"


def test_plan_sends_once_per_week_and_never_at_night():
    assert plan({}, NOW) == {"send": True, "week": "2026-W38", "reason": None}
    sent = {"last_week": "2026-W38"}
    assert plan(sent, NOW)["reason"] == "already_sent"
    assert plan(sent, NOW)["send"] is False
    # Nächste Woche darf wieder eine Meldung raus.
    assert plan(sent, NOW + dt.timedelta(days=7))["send"] is True
    # Ruhezeit: kein Push, aber auch kein „schon gesendet“.
    night = plan({}, NIGHT)
    assert night["send"] is False
    assert night["reason"] == "quiet_hours"


def test_formatters_speak_german():
    assert de_int(7) == "7"
    assert de_int(7.4) == "7"
    assert de_int(None) == "—"
    assert de_ct(2.1) == "+2,1 ct/L"
    assert de_ct(-0.4) == "−0,4 ct/L"
    assert de_ct(0) == "±0,0 ct/L"
    assert de_pct(0.86) == "86 %"


def test_facts_count_only_the_last_seven_days():
    store = {
        "settlements": [
            {"settled_at": NOW.isoformat(), "outcome": "win"},
            {"settled_at": (NOW - dt.timedelta(days=6)).isoformat(), "outcome": "loss"},
            # älter als das Fenster — zählt nicht mit
            {"settled_at": (NOW - dt.timedelta(days=9)).isoformat(), "outcome": "win"},
            # kaputter Zeitstempel — zählt nicht mit, wirft aber auch nicht
            {"settled_at": "keine Zeit", "outcome": "win"},
        ]
    }
    facts = build_facts(store, None, NOW)
    assert facts["outcomes"] == {
        "win": 1,
        "loss": 1,
        "tie": 0,
        "void": 0,
        "total": 2,
    }


def test_facts_name_best_and_worst_station_by_delta_recent5():
    selection = selection_with(
        {"name": "Aral Mitte", "delta_recent5_ct": 2.1, "coverage": 0.90},
        {"name": "Shell Nord", "delta_recent5_ct": -0.4, "coverage": 0.86},
        {"name": "Total Ost", "delta_recent5_ct": 0.7, "coverage": 0.95},
    )
    facts = build_facts(store_with("win"), selection, NOW)
    assert facts["best_station"] == "Aral Mitte"
    assert facts["best_delta_ct"] == 2.1
    assert facts["worst_station"] == "Shell Nord"
    assert facts["worst_delta_ct"] == -0.4
    assert facts["min_coverage"] == 0.86
    assert facts["dead_count"] == 1
    assert facts["n_days"] == 30


def test_facts_without_artifacts_invent_nothing():
    facts = build_facts(None, None, NOW)
    assert facts["outcomes"]["total"] == 0
    assert facts["best_station"] is None
    assert facts["min_coverage"] is None
    assert facts["learning"]["n_fills"] is None
    assert facts["learning"]["error_code"] == "store_missing"


def test_public_mode_names_no_station_and_no_price():
    selection = selection_with(
        {"name": "Aral Mitte", "delta_recent5_ct": 2.1, "coverage": 0.9}
    )
    facts = build_facts(store_with("win"), selection, NOW)
    message = build_payload(facts, mode="public")["message"]
    assert "Aral Mitte" not in message
    assert "ct/L" not in message
    # Die Zusammenfassung selbst bleibt erhalten.
    assert "1 richtig" in message


def test_lan_mode_names_station_and_delta():
    selection = selection_with(
        {"name": "Aral Mitte", "delta_recent5_ct": 2.1, "coverage": 0.9},
        {"name": "Shell Nord", "delta_recent5_ct": -0.4, "coverage": 0.86},
    )
    facts = build_facts(store_with("win", "loss"), selection, NOW)
    message = build_payload(facts, mode="lan", version="0.50.0")["message"]
    assert "Aral Mitte (+2,1 ct/L)" in message
    assert "Shell Nord (−0,4 ct/L)" in message
    assert "(TankApp 0.50.0)" in message


def test_empty_week_says_why_instead_of_showing_zeroes():
    message = build_payload(build_facts(None, None, NOW), mode="public")["message"]
    assert "noch nichts abgerechnet" in message
    assert "0 richtig" not in message


def test_diary_wording_never_says_treffer_or_fehler():
    facts = build_facts(store_with("win", "loss", "tie", "void"), None, NOW)
    message = build_payload(facts, mode="lan")["message"]
    for banned in ("Treffer", "Fehler", "Trefferquote"):
        assert banned not in message
    for word in ("richtig", "daneben", "unentschieden", "nicht bewertbar"):
        assert word in message


# ---------------------------------------------------------------------------
# Zustand und Zustellung
# ---------------------------------------------------------------------------


def test_recap_state_survives_a_roundtrip_and_ignores_garbage(settings):
    assert load_recap_state(settings) == {}
    assert save_recap_state(settings, {"last_week": "2026-W38"}) is True
    assert load_recap_state(settings) == {"last_week": "2026-W38"}
    recap_state_path(settings).write_text("{{{", "utf-8")
    assert load_recap_state(settings) == {}


def test_recap_tick_delivers_once_and_records_the_week(settings):
    opener = FakeOpener()
    note = notifier(settings, opener)
    first = note.recap_tick(NOW)
    assert first["sent"] is True
    assert first["week"] == "2026-W38"
    assert len(opener.calls) == 1
    assert opener.calls[0]["title"] == "TankApp: Wochen-Rückblick 2026-W38"
    assert load_recap_state(settings)["last_week"] == "2026-W38"
    # Zweiter Tick in derselben Woche: nichts gesendet, kein zweiter POST.
    second = note.recap_tick(NOW + dt.timedelta(hours=3))
    assert second["sent"] is False
    assert second["reason"] == "already_sent"
    assert len(opener.calls) == 1


def test_recap_tick_waits_out_the_quiet_hours(settings):
    opener = FakeOpener()
    note = notifier(settings, opener)
    result = note.recap_tick(NIGHT)
    assert result["sent"] is False
    assert result["reason"] == "quiet_hours"
    assert opener.calls == []
    # Nicht als „gesendet“ verbucht — am Morgen darf die Meldung raus.
    assert load_recap_state(settings).get("last_week") is None
    assert note.recap_tick(NOW)["sent"] is True


def test_recap_tick_is_off_without_a_webhook(bare):
    opener = FakeOpener()
    result = notifier(bare, opener).recap_tick(NOW)
    assert result == {"sent": False, "delivered": False, "reason": "not_configured"}
    assert opener.calls == []


def test_failed_delivery_keeps_the_week_open(settings):
    opener = FakeOpener(fail=True)
    result = notifier(settings, opener).recap_tick(NOW)
    assert result["sent"] is False
    assert result["reason"] == "delivery_failed"
    # Nicht verbucht — der nächste Tick versucht es erneut.
    assert load_recap_state(settings).get("last_week") is None


def test_a_broken_recap_tick_does_not_escape(settings, monkeypatch):
    import app.recap as recap

    def boom(*_args, **_kwargs):
        raise RuntimeError("kaputt")

    monkeypatch.setattr(recap, "build_facts", boom)
    note = notifier(settings, FakeOpener())
    # tick() fängt den Fehler — der Alarm-Betrieb läuft weiter.
    result = note.tick()
    assert result["recap"]["reason"] == "failed"
    assert result["recap"]["sent"] is False


def test_load_selection_reads_the_artifact_without_a_gateway(settings):
    path = pathlib.Path(settings.runtime) / "selection" / "current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "generated_at": "2026-09-17T06:00:00+00:00",
                "by_fuel": {
                    "e10": {
                        "n_days": 21,
                        "cities": [
                            {
                                "city": "Frankfurt",
                                "stations": [
                                    {"name": "Aral Mitte", "delta_recent5_ct": 1.5}
                                ],
                                "dead_stations": ["dead-1"],
                            }
                        ],
                    }
                },
            }
        ),
        "utf-8",
    )
    data = load_selection(settings)
    assert data["count"] == 1
    assert data["dead_count"] == 1
    assert data["n_days"] == 21
    assert data["stations"][0]["name"] == "Aral Mitte"
    assert data["error_code"] is None


def test_load_selection_reports_a_missing_artifact_as_data(settings):
    data = load_selection(settings)
    assert data["stations"] == []
    assert data["error_code"] == "selection_not_available"


def test_notify_status_exposes_the_last_recap_week(settings):
    assert notify_status(settings)["recap_last_week"] is None
    notifier(settings, FakeOpener()).recap_tick(NOW)
    status = notify_status(settings)
    assert status["recap_last_week"] == "2026-W38"
    assert status["recap_last_sent_at"]


# ---------------------------------------------------------------------------
# Ratchet: jede Zahl läuft über einen Formatter
# ---------------------------------------------------------------------------


def _functions_with_format_specs(source: str) -> set[str]:
    tree = ast.parse(source)
    found = set()
    for func in ast.walk(tree):
        if not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for node in ast.walk(func):
            if isinstance(node, ast.FormattedValue) and node.format_spec is not None:
                found.add(func.name)
    return found


def test_numbers_only_ever_get_formatted_inside_the_formatters():
    source = pathlib.Path(__file__).resolve().parent.parent / "app" / "recap.py"
    allowed = {"de_int", "de_ct", "de_pct", "iso_week"}
    offenders = _functions_with_format_specs(source.read_text("utf-8")) - allowed
    assert offenders == set(), (
        "O31: Zahlen im Wochen-Rückblick laufen über de_int/de_ct/de_pct. "
        f"Inline formatiert in: {sorted(offenders)}"
    )


def test_rendered_message_never_shows_an_english_decimal_point():
    selection = selection_with(
        {"name": "Aral Mitte", "delta_recent5_ct": 2.15, "coverage": 0.865},
        {"name": "Shell Nord", "delta_recent5_ct": -0.45, "coverage": 0.9},
    )
    facts = build_facts(store_with("win", "loss", "tie"), selection, NOW)
    for mode in ("public", "lan"):
        message = build_payload(facts, mode=mode)["message"]
        # „2.1“ oder „0.86“ wäre die englische Schreibweise — die GUI und die
        # Push-Texte sind de-DE (MICROCOPY §6).
        assert not any(
            chunk.replace(",", "").isdigit()
            for chunk in message.split()
            if "." in chunk and any(digit.isdigit() for digit in chunk)
        ), message
        assert "e-" not in message and "e+" not in message


def test_window_size_is_named_in_the_message_not_hardcoded():
    facts = build_facts(store_with("win"), None, NOW)
    message = build_payload(facts, mode="public")["message"]
    assert f"({de_int(RECAP_WINDOW_DAYS)} Tage)" in message
