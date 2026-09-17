"""Batch 3 (O35): Live-Preise kennen dieselben Plausibilitätsgrenzen wie das Ledger.

Der Trainingspfad filtert 0,40–5,00 €/L (``engine/data.py``), der Belegpfad
verweigert Werte außerhalb (``app/feedback.py``) — der Live-Pfad hatte vor
0.46.0 nichts davon: Ein API-Ausreißer (verrutschte Dezimalstelle) erschien
als aktueller Preis, sortierte sich an die Spitze und wurde Anker der
Empfehlung. Jetzt gilt: Werte außerhalb der Grenzen sind Beobachtungen,
aber keine Preise — die Station bleibt sichtbar, ohne Preis, mit
Kennzeichnung; ``/api/v1/health`` zählt die Vorfälle, und ab dem ersten
Wert schlägt ``price_implausible`` (warn) an. Regressionstest am Ende: Der
Trainingspfad filtert dieselben Werte weiterhin.
"""

import datetime as dt
import json

import pandas as pd
import pytest

from app.config import Settings
from app.data import LiveData
from engine.config import Config
from engine.data import normalize_observations

UID_GOOD = "00000000-0000-0000-0000-000000000001"
UID_LOW = "00000000-0000-0000-0000-000000000002"
UID_HIGH = "00000000-0000-0000-0000-000000000003"
NOW = dt.datetime(2026, 9, 8, 10, tzinfo=dt.timezone.utc)


@pytest.fixture
def app_settings(tmp_path):
    polling = tmp_path / "polling.json"
    stations = [
        {"uuid": UID_GOOD, "name": "Station Gut"},
        {"uuid": UID_LOW, "name": "Station Niedrig"},
        {"uuid": UID_HIGH, "name": "Station Hoch"},
    ]
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "batch": [s["uuid"] for s in stations],
                        "stations": stations,
                    }
                }
            }
        )
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=never-expose-me\n"
    )
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
        static=tmp_path / "web",
    )


def row(uid, value, age=5, status="open"):
    return {
        "_time": (NOW - dt.timedelta(minutes=age)).isoformat(),
        "city": "Frankfurt",
        "station_id": uid,
        "station": "Station",
        "status": status,
        "e10": value,
    }


def live(app_settings, rows, clock=NOW):
    return LiveData(app_settings, query=lambda *_: rows, clock=lambda: clock)


def by_uid(data, uid):
    return next(s for s in data["stations"] if s["station_id"] == uid)


def test_outlier_prices_are_never_published_and_never_sort_first(app_settings):
    rows = [
        row(UID_GOOD, "1.729"),
        row(UID_LOW, "0.05"),  # verrutschte Dezimalstelle
        row(UID_HIGH, "9.90"),  # zweiter Ausreißer-Typ
    ]
    data = live(app_settings, rows).stations()

    for uid in (UID_LOW, UID_HIGH):
        station = by_uid(data, uid)
        assert station["price"] is None
        assert station["last_price"] is None
        assert station["implausible_price"] is not None
    assert by_uid(data, UID_GOOD)["price"] == 1.729
    assert data["fresh_prices"] == 1

    # Die Ausreißer dürfen sich nicht an die Spitze sortieren.
    assert data["stations"][0]["station_id"] == UID_GOOD
    assert data["stations"][0]["price"] == 1.729


def test_non_finite_price_is_implausible_too(app_settings):
    data = live(app_settings, [row(UID_LOW, "NaN")]).stations()
    station = by_uid(data, UID_LOW)
    assert station["price"] is None
    assert station["last_price"] is None
    assert station["implausible_price"] != station["implausible_price"]  # NaN


def test_boundary_values_remain_prices(app_settings):
    rows = [row(UID_LOW, "0.40"), row(UID_HIGH, "5.00")]
    data = live(app_settings, rows).stations()
    assert by_uid(data, UID_LOW)["price"] == 0.40
    assert by_uid(data, UID_HIGH)["price"] == 5.00
    assert data["stations"][0]["implausible_price"] is None


def test_health_counts_implausible_observations(app_settings):
    rows = [row(UID_GOOD, "1.729"), row(UID_LOW, "0.05")]
    data = live(app_settings, rows)
    data.stations()
    status = data.health()["price_implausible"]
    assert status["count_24h"] == 1
    assert status["last_at"] is not None

    # Dieselbe Beobachtung im nächsten Poll zählt nicht doppelt …
    data.stations()
    assert data.health()["price_implausible"]["count_24h"] == 1

    # … eine neue Beobachtung derselben Station aber schon.
    live(app_settings, [row(UID_LOW, "0.06", age=1)]).stations()
    assert data.health()["price_implausible"]["count_24h"] == 2


def test_health_alarm_fires_on_first_implausible_price(app_settings):
    def alarm_codes(data):
        return [a["code"] for a in data.health()["alarms"]]

    clean = live(app_settings, [row(UID_GOOD, "1.729")])
    clean.stations()
    assert "price_implausible" not in alarm_codes(clean)

    dirty = live(app_settings, [row(UID_GOOD, "0.05")])
    dirty.stations()
    alarms = [a for a in dirty.health()["alarms"] if a["code"] == "price_implausible"]
    assert len(alarms) == 1
    assert alarms[0]["severity"] == "warn"
    assert alarms[0]["count_24h"] == 1
    assert "0,40" in alarms[0]["message"] and "5,00" in alarms[0]["message"]


def test_implausible_entry_lists_station_and_value(app_settings):
    live(app_settings, [row(UID_LOW, "0.05")]).stations()
    path = app_settings.runtime / "quality" / "implausible_prices.json"
    entries = json.loads(path.read_text(encoding="utf-8"))["entries"]
    assert len(entries) == 1
    assert entries[0]["station_id"] == UID_LOW
    assert entries[0]["value"] == 0.05
    assert entries[0]["fuel"] == "e10"


def test_training_path_still_filters_the_same_values():
    """Regression: ``engine/data.py`` verwirft dieselben Ausreißer (O35)."""
    frame = pd.DataFrame(
        {
            "timestamp": [
                "2026-07-01T06:00:00Z",
                "2026-07-01T06:05:00Z",
                "2026-07-01T06:10:00Z",
                "2026-07-01T06:15:00Z",
            ],
            "price": [1.729, 0.05, 9.90, True],
            "station_id": "station-1",
            "city": "Test",
            "fuel": "E10",
        }
    )
    rows, quality = normalize_observations(
        frame, Config(train_days=14, min_train_days=7, min_slot_days=2)
    )
    assert quality["invalid_open_prices"] == 3
    prices = rows["price"].tolist()
    assert prices[0] == 1.729
    assert all(p != p or p is None for p in prices[1:])  # NaN/verworfen
