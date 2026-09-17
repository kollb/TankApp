"""O44 — die P-Seite liest ``null`` wie ``NaN``, und decide scheitert nie stumm.

Produktionsbefund 17.09.2026 (20:25, 20 Stationen, Modell-Lauf 20:20): Die
App zeigte „Empfehlung konnte nicht berechnet werden. Code: decide_failed“,
und die Ansicht „Stationen“ stürzte mit ``Cannot read properties of
undefined (reading 'find')`` ab.

Zwei Fehler, eine Ursache-Kette:

1. **Die eine Lücke, zwei Schreibweisen.** ``engine.probabilities`` füllt
   ungestützte Blöcke mit ``NaN`` (Nachtstunden, Polling-Lücken). Auf dem Weg
   in die Veröffentlichung macht ``engine.storage.json_safe`` daraus ``null``
   — nach dem JSON-Rundlauf heißt „keine Aussage“ also ``None``. ``app/pside``
   filterte nur ``NaN`` (``value == value``): Der erste ``None`` in einem
   Fenster-Umfeld warf ``TypeError``. Genau dieser Pfad wurde am 17.09. zum
   ersten Mal überhaupt erreicht, weil die Veröffentlichung mit der
   Stations-Aufteilung (O22 d) erstmals vollständig lesbar war — vorher war
   sie zu groß und die App zeigte „keine Prognose“.
2. **Das stumme ``except``.** ``LiveData.decide`` antwortete nur
   ``{"error_code": "decide_failed"}`` — kein Log, kein Grund. Hier steht,
   dass die bereinigte Ursache im Antwort-Payload **und** im Container-Log
   landet (``detail``, app/errors.py).

Belegt wird beides: die Zahlengleichheit von ``NaN``- und ``null``-Draws, das
Überleben von ``/decide`` gegen eine aufgeteilte Veröffentlichung mit echten
Nachlücken, und die sichtbare Ursache im Fehlerfall.
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.data import LiveData, clear_publication_cache, write_split_publication
from app.pside import p_better, p_lohnt, window_p_details
from engine.storage import write_json

NOW = dt.datetime(2026, 9, 17, 18, 25, tzinfo=dt.timezone.utc)  # 20:25 Berlin
ORIGIN = NOW - dt.timedelta(minutes=3)
UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"


@pytest.fixture
def settings(tmp_path):
    """Wie im Betrieb: zwei Stationen, eine Stadt, Polling-Set auf der Platte."""
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
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
    )


def raw_price(ts, uid, price, city="Frankfurt", status="open"):
    return {
        "_time": ts.isoformat(),
        "city": city,
        "station_id": uid,
        "station": "Station",
        "status": status,
        "e10": str(price),
    }


# --- Bausteine der veröffentlichten Zeile (Form wie app/refresh.py) ---------
#
# Blockraster: 2-h-Blöcke ab Mitternacht Berlin. Unterstützt ist nur, was der
# Collector wirklich sieht: 08–12 Uhr und 16–22 Uhr. Dazwischen liegen eine
# Lücke (12–16, wie eine Polling-Lücke) und die Nacht — beide ``None``, genau
# die Schreibweise, die der JSON-Rundlauf aus ``NaN`` macht.

SUPPORTED = {(8, 10), (10, 12), (16, 18), (18, 20), (20, 22)}
BLOCKS_PER_DAY = 12


def _block_start(index: int) -> dt.datetime:
    """Beginn des 2-h-Blocks ``index`` (Berliner Lokalzeit) als UTC-Stempel."""
    berlin = dt.timezone(dt.timedelta(hours=2))
    midnight = dt.datetime(2026, 9, 17, 0, 0, tzinfo=berlin)
    return (midnight + dt.timedelta(hours=2 * index)).astimezone(dt.timezone.utc)


def _supported(index: int) -> bool:
    return (index * 2, (index * 2 + 2) % 24) in SUPPORTED


def _points(days: int) -> list[dict]:
    """Quantil-Reihe im 5-Minuten-Raster: Nacht und Lücke ohne Punkt.

    Die Punkte laufen wie im Betrieb im 5-Minuten-Takt, damit ein 2-h-Block
    eine Dauer hat (Start ≠ Ende) und der Horizont sich am echten Raster
    entscheidet.
    """
    out = []
    for day in range(days):
        for index in range(BLOCKS_PER_DAY):
            start = _block_start(index) + dt.timedelta(days=day)
            for step in range(0, 120, 5):
                stamp = start + dt.timedelta(minutes=step)
                q50 = (
                    round(1.70 - 0.01 * (index % 5) + 0.001 * ((step // 5) % 3), 3)
                    if _supported(index)
                    else None
                )
                out.append({"timestamp": stamp.isoformat(), "q50": q50})
    return out


def _draws(days: int, drawings: int = 50) -> dict:
    """Fenster-Minima je Draw — ``None`` dort, wo kein Block gestützt ist."""
    minima = [
        [
            (
                round(1.68 + 0.001 * (drawing % 7), 4)
                if _supported(index % BLOCKS_PER_DAY)
                else None
            )
            for index in range(BLOCKS_PER_DAY * days)
        ]
        for drawing in range(drawings)
    ]
    blocks = [
        {
            "start": (_block_start(index) + dt.timedelta(days=day)).isoformat(),
            "end": (
                _block_start(index) + dt.timedelta(days=day) + dt.timedelta(hours=2)
            ).isoformat(),
        }
        for day in range(days)
        for index in range(BLOCKS_PER_DAY)
    ]
    return {
        "n": drawings,
        "block_minutes": 120,
        "blocks": blocks,
        "minima": minima,
        "nowcast": [round(1.69 + 0.001 * (d % 5), 4) for d in range(drawings)],
        "shared": True,
    }


def forecast_row(uid: str, price_now: float) -> dict:
    return {
        "city": "Frankfurt",
        "station_id": uid,
        "station_name": f"Station {uid[-1]}",
        "fuel": "e10",
        "origin": ORIGIN.isoformat(),
        "last_observation": ORIGIN.isoformat(),
        "data_age_minutes_at_origin": 3.0,
        "stale_data_at_origin": False,
        "points": _points(1),
        "points_3d": _points(3),
        "points_7d": _points(7),
        "draws_24h": _draws(1),
        "draws_7d": _draws(7, drawings=20),
        "metrics": {"mae_ct": 1.2, "mase": 0.9, "points": 2016},
        "rolling_picp_7d": {
            "current": {"badge": "green", "picp_pct": 94.1, "points": 7}
        },
        "decision_rows": [],
        "decision_hour": 12,
        "data_policy": {"mode": "bootstrap"},
        "calibrated": False,
        "decision_ready": False,
        "retained_previous": False,
    }


def publish(settings, rows) -> None:
    clear_publication_cache()
    write_split_publication(
        settings.runtime / "engine", ORIGIN.isoformat(), rows, index_extra={}
    )


# --- 1. Eine Lücke, zwei Schreibweisen --------------------------------------


def test_p_side_reads_null_and_nan_identically():
    """``null`` (JSON) und ``NaN`` (Engine-intern) sind dieselbe Aussage."""
    nan, null = float("nan"), None
    minima_nan = [
        [nan, 1.70, nan, 1.68, 1.65, nan, nan],
        [nan, 1.72, 1.71, 1.69, 1.66, nan, nan],
    ]
    minima_null = [
        [null, 1.70, null, 1.68, 1.65, null, null],
        [null, 1.72, 1.71, 1.69, 1.66, null, null],
    ]
    assert p_better(minima_null, 1, 1.75) == p_better(minima_nan, 1, 1.75)
    assert window_p_details(minima_null, 3) == window_p_details(minima_nan, 3)
    # Ungestützte Nachbarn zählen nicht als Konkurrenz — vor 0.49.1 warf
    # ``min(environment)`` hier „'<' not supported between NoneType and float“.
    assert window_p_details(minima_null, 4) == window_p_details(minima_nan, 4)


def test_p_side_null_draws_stay_silent_not_zero():
    """``None`` bleibt „keine Aussage“ — nie 0,0 (das wäre ein Ergebnis)."""
    assert p_better([[None], [None]], 0, 1.70) is None
    assert window_p_details([[None, None], [None, None]], 0) is None
    assert p_lohnt([None, None], [1.60, 1.61], 40.0, 2.0, 7.0, 45.0, 10.0) is None
    # Ein Zahlwert steht weiter zur Verfügung, wenn ein Paar es trägt.
    assert p_lohnt([1.70, None], [1.60, 1.61], 40.0, 2.0, 7.0, 45.0, 10.0) is not None


def test_json_round_trip_keeps_both_spellings_equal(settings):
    """Der Beweis in einem Test: ``write_json`` schreibt ``NaN`` als ``null``."""
    path = settings.runtime / "engine" / "draws.json"
    minima = [[float("nan"), 1.68, 1.65], [float("nan"), 1.69, 1.66]]
    write_json(path, {"minima": minima}, indent=None)
    text = path.read_text(encoding="utf-8")
    assert "NaN" not in text and "null" in text
    from_json = json.loads(text)["minima"]
    assert from_json[0][0] is None
    assert window_p_details(from_json, 1) == window_p_details(minima, 1)


# --- 2. /decide gegen die aufgeteilte Veröffentlichung ----------------------


def test_decide_survives_published_nulls(settings):
    """Der Produktionsfall: Nachlücken in den Draws → trotzdem eine Antwort."""
    publish(
        settings,
        [forecast_row(UID, 1.749), forecast_row(OTHER, 1.689)],
    )

    def query(cfg, flux):
        yield raw_price(NOW - dt.timedelta(minutes=2), UID, 1.749)
        yield raw_price(NOW - dt.timedelta(minutes=2), OTHER, 1.689)

    live = LiveData(settings, query=query, clock=lambda: NOW)
    result = live.decide({"fuel": "e10", "city": "Frankfurt"})

    assert result.get("error_code") is None, result.get("detail")
    assert "primary" in result  # Erfolgs-Payload, kein Fehlercode-Objekt
    assert result["primary"]["reason_short"]
    # Die Fenster tragen den P-Wert aus der Verteilung — vor dem Fix stand
    # hier gar keine Antwort. Ein gestütztes Fenster muss eine Zahl liefern.
    assert result["windows_today"], "Fenster am Abend erwartet"
    supported = [w for w in result["windows_today"] if w["p"] is not None]
    assert supported, result["windows_today"]
    assert all(isinstance(w["p"], float) for w in supported)
    assert all(isinstance(w["p_raw"], float) for w in supported)
    # Nachbarn ohne Aussage (Lücke/Nacht) erscheinen nicht als Konkurrenz.
    assert all(w["p_competitors"] >= 1 for w in supported)
    assert result["windows_week"]


def test_decide_without_live_price_still_answers(settings):
    """Ohne frischen Anker gibt es Fenster und P, aber keine €-Rechnung."""
    publish(settings, [forecast_row(UID, 1.749)])
    live = LiveData(settings, query=lambda *_: [], clock=lambda: NOW)
    result = live.decide({"fuel": "e10", "station_id": UID})
    assert result.get("error_code") is None, result.get("detail")
    assert result["primary"]["station"]["price_now"] is None
    assert result["primary"]["expected_saving_eur"] == 0.0
    assert any(w["p"] is not None for w in result["windows_today"])


# --- 3. „decide_failed“ sagt jetzt warum ------------------------------------


def test_decide_failed_names_the_cause_and_keeps_it_clean(
    settings, monkeypatch, capsys
):
    """Der Grund steht im Payload **und** im Log — ohne Pfade und Token."""
    import app.decide as decide_module

    def boom(*_args, **_kwargs):
        raise RuntimeError("kaputt /data/runtime/engine/current.json token=supersecret")

    monkeypatch.setattr(decide_module, "evaluate_decide", boom)
    live = LiveData(settings, query=lambda *_: [], clock=lambda: NOW)
    result = live.decide({})
    assert result["error_code"] == "decide_failed"
    detail = result["detail"]
    assert detail.startswith("RuntimeError: kaputt")
    # app/errors.redact: der letzte Pfadname bleibt, die Verzeichnisse nicht.
    assert "current.json" in detail
    assert "/data/runtime" not in detail
    assert "supersecret" not in detail
    logged = capsys.readouterr().out
    assert "decide: fehlgeschlagen" in logged
    assert "current.json" in logged
    assert "supersecret" not in logged
