"""A2: Tankstand / Restreichweite als Eingabe für F3.

Konzept-F3 („Tank bei ¼ — kann ich warten?“) bekommt eine ehrliche Antwort:
Aus Füllstand (Prozent × Tankgröße ÷ Verbrauch) oder Rest-km wird die
Restreichweite bestimmt; liegt sie im Reservebereich, wird eine Warte-
Empfehlung blockiert — „Warten riskant, Reserve reicht ~X km“ statt nur
„bestes Fenster morgen“. Getestet werden die Grenzen der Einordnung und der
Weg durch ``evaluate_decide`` bis in den Snapshot (der Ledger bekommt die
Aktion, die wirklich angezeigt wurde).
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.data import LiveData
from app.decide import (
    TANK_RESERVE_LITERS,
    evaluate_decide,
    tank_context,
)
from app.feedback import load_store

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
NOW = dt.datetime(2026, 9, 10, 14, 0, tzinfo=dt.timezone.utc)  # 16:00 Berlin


@pytest.fixture
def tank_settings(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "anchor": [50.11, 8.68],
                        "batch": [UID, OTHER],
                        "stations": [
                            {
                                "uuid": UID,
                                "name": "Station Alpha",
                                "brand": "ARAL",
                                "lat": 50.12,
                                "lon": 8.69,
                            },
                            {
                                "uuid": OTHER,
                                "name": "Station Beta",
                                "brand": "SHELL",
                                "lat": 50.13,
                                "lon": 8.70,
                            },
                        ],
                    }
                }
            }
        )
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n"
    )
    static = tmp_path / "web"
    static.mkdir()
    (static / "index.html").write_text("<html>test</html>")
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
        static=static,
    )


def _live_with_wait_forecast(settings):
    """Zwei frische Preise plus Prognose, die ein „Warten“-Fenster ausspielt."""

    def query(cfg, flux):
        return [
            {
                "_time": (NOW - dt.timedelta(minutes=5)).isoformat(),
                "city": "Frankfurt",
                "station_id": uid,
                "station": "Station",
                "status": "open",
                "e10": str(price),
            }
            for uid, price in ((UID, 1.689), (OTHER, 1.729))
        ]

    live = LiveData(settings, query=query, clock=lambda: NOW)
    path = settings.runtime / "engine/current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "published_at": NOW.isoformat(),
                "forecasts": [
                    {
                        "station_id": UID,
                        "city": "Frankfurt",
                        "fuel": "e10",
                        "origin": NOW.isoformat(),
                        "points": [
                            {
                                "timestamp": "2026-09-10T20:00:00+02:00",
                                "q50": 1.60,
                            },
                            {
                                "timestamp": "2026-09-10T21:55:00+02:00",
                                "q50": 1.61,
                            },
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return live


# --- tank_context: Einordnung und Grenzen ------------------------------------


def test_tank_context_computes_range_from_percent():
    tank = tank_context(25, 50, None, 7.0)
    # 50 l × 25 % = 12,5 l ÷ 7 l/100 km → ~179 km; Reserve 5/7 → ~71 km.
    assert tank["range_km"] == 178.6
    assert tank["reserve_range_km"] == 71.4
    assert tank["state"] == "ok"
    assert tank["blocks_wait"] is False
    assert tank["message"] is None
    assert tank["input"] == "computed"


def test_tank_context_state_boundaries_follow_reserve():
    # Genau die Reserve-Reichweite → noch „empty“ (≤, nicht <).
    at_reserve = TANK_RESERVE_LITERS / 7.0 * 100.0
    assert tank_context(None, None, at_reserve, 7.0)["state"] == "empty"
    assert tank_context(None, None, at_reserve * 1.01, 7.0)["state"] == "low"
    assert tank_context(None, None, at_reserve * 2.01, 7.0)["state"] == "ok"
    # Diesel mit hohem Verbrauch: dieselbe Restmenge ist weniger Reichweite.
    assert (
        tank_context(10, 50, None, 10.0)["state"]
        == "empty"  # 5 l ÷ 10 l/100 km = 50 km ≤ Reserve (50 km)
    )


def test_tank_context_range_input_wins_and_reports_source():
    tank = tank_context(10, 50, 300, 7.0)
    assert tank["input"] == "input"
    assert tank["range_km"] == 300.0
    assert tank["state"] == "ok"


def test_tank_context_none_without_input():
    assert tank_context(None, None, None, 7.0) is None


def test_tank_context_messages_name_the_reserve():
    empty = tank_context(None, None, 40, 7.0)
    assert empty["state"] == "empty"
    assert "Warten riskant" in empty["message"]
    assert "71 km" in empty["message"]
    low = tank_context(None, None, 100, 7.0)
    assert low["state"] == "low"
    assert "Tankstand knapp" in low["message"]


# --- Parameterprüfung --------------------------------------------------------


def test_decide_rejects_out_of_range_tank_params(tank_settings):
    live = _live_with_wait_forecast(tank_settings)
    with pytest.raises(ValueError) as exc:
        evaluate_decide(live, {"city": "Frankfurt", "fuel": "e10", "tank_percent": 150})
    assert str(exc.value) == "invalid_tank"
    with pytest.raises(ValueError) as exc:
        evaluate_decide(live, {"city": "Frankfurt", "fuel": "e10", "range_km": 5000})
    assert str(exc.value) == "invalid_tank"
    with pytest.raises(ValueError) as exc:
        evaluate_decide(
            live, {"city": "Frankfurt", "fuel": "e10", "tank_capacity_l": 5}
        )
    assert str(exc.value) == "invalid_tank"


# --- Verdrahtung in evaluate_decide ------------------------------------------


def test_decide_carries_tank_block_without_input_noise(tank_settings):
    live = _live_with_wait_forecast(tank_settings)
    body = evaluate_decide(live, {"city": "Frankfurt", "fuel": "e10", "liters": 40})
    assert body["tank"] is None

    body = evaluate_decide(
        live,
        {
            "city": "Frankfurt",
            "fuel": "e10",
            "liters": 40,
            "tank_percent": 25,
            "tank_capacity_l": 50,
        },
    )
    assert body["tank"]["state"] == "ok"
    assert body["tank"]["range_km"] == 178.6


def test_empty_tank_blocks_wait_recommendation_and_is_ledgered(tank_settings):
    live = _live_with_wait_forecast(tank_settings)
    # Ohne Tankstand: die Tabelle sagt „warten“ (Snapshot im Shadow-Betrieb).
    evaluate_decide(live, {"city": "Frankfurt", "fuel": "e10", "liters": 40})
    store = load_store(tank_settings)
    first_actions = [
        snap["action"] for ep in store["episodes"] for snap in ep["snapshots"]
    ]
    assert "wait" in first_actions

    # Mit leerem Tank wird dieselbe Lage als „jetzt tanken“ geführt —
    # auch vor dem M7-Gate (Physik, kein Modellwert).
    live2 = _live_with_wait_forecast(tank_settings)
    body = evaluate_decide(
        live2,
        {
            "city": "Frankfurt",
            "fuel": "e10",
            "liters": 40,
            "tank_percent": 5,
            "tank_capacity_l": 50,
        },
    )
    assert body["tank"]["state"] == "empty"
    assert body["tank"]["blocks_wait"] is True
    assert body["tank"]["message"].startswith("Warten riskant")

    store = load_store(tank_settings)
    snapshots = [
        snap
        for ep in store["episodes"]
        for snap in ep["snapshots"]
        if snap.get("tank_state")
    ]
    assert snapshots, "Tankstand muss im Ledger ankommen (Auswertbarkeit)"
    assert all(snap["action"] == "refuel_now" for snap in snapshots)
    assert all(snap["tank_state"] == "empty" for snap in snapshots)


def test_low_tank_keeps_wait_but_adds_note(tank_settings):
    live = _live_with_wait_forecast(tank_settings)
    body = evaluate_decide(
        live,
        {
            "city": "Frankfurt",
            "fuel": "e10",
            "liters": 40,
            "tank_percent": 18,
            "tank_capacity_l": 50,
        },
    )
    # 9 l ÷ 7 l/100 km ≈ 129 km → knapp (≤ 2 × Reserve), aber machbar.
    assert body["tank"]["state"] == "low"
    assert body["tank"]["blocks_wait"] is False
    assert body["tank"]["message"].startswith("Tankstand knapp")
