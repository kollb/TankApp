"""O20 — Der Tagesstreifen färbt nicht mehr rückwirkend um.

Bis 0.49.0 kamen die Tonlagen der 19 Stunden aus Minimum/Maximum **des
Tages**: Eine günstigere Meldung um 18 Uhr färbte den ganzen bisherigen Tag
heller — dieselbe Zahl, abends eine andere Farbe. Dazu gewann je Stunde die
letzte Meldung, während die Fenstersuche das Stunden-Minimum bewertet.

Die Skala kommt deshalb vom Server als festes Band über einen
Bezugszeitraum (7 Tage, 25./75. Perzentil). Batch-Check: Die Farbskala hängt
nicht am Tag, und je Stunde steht das Minimum.
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.data import (
    DAY_SERIES_HOURS,
    STRIP_BAND_MIN_DAYS,
    STRIP_BAND_MIN_POINTS,
    LiveData,
    price_band,
)

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 17, 16, 0, tzinfo=dt.timezone.utc)


@pytest.fixture
def settings(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "batch": [UID],
                        "stations": [{"uuid": UID, "name": "Station Alpha"}],
                    }
                }
            }
        )
    )
    (tmp_path / "influx.env").write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\n"
        "TANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\n"
        "TANKAPP_INFLUX_TOKEN=never-expose-me\n"
    )
    (tmp_path / "_netrc").write_text("")
    return Settings(
        data=tmp_path,
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "_netrc",
        static=tmp_path / "static",
    )


def row(minutes_ago: int, price: str = "1.729", status: str = "open") -> dict:
    return {
        "_time": (NOW - dt.timedelta(minutes=minutes_ago)).isoformat(),
        "city": "Frankfurt",
        "station_id": UID,
        "station": "Station",
        "status": status,
        "e10": price,
    }


def history(days: int = 7, per_day: int = 40) -> list[dict]:
    """Synthetischer Bestand über ``days`` Tage — genug für eine Skala."""
    rows: list[dict] = []
    step = (24 * 60) // per_day
    for day in range(days):
        for index in range(per_day):
            minutes = day * 24 * 60 + index * step + 5
            # Leichte Wellenbewegung, damit Perzentile auseinanderliegen.
            price = 1.70 + 0.06 * ((index % 7) / 6)
            rows.append(row(minutes, f"{price:.3f}"))
    return rows


def test_band_braucht_genug_bestand():
    assert price_band([1.7, 1.8]) is None
    thin = [1.70 + (i % 5) * 0.01 for i in range(STRIP_BAND_MIN_POINTS)]
    # Genug Punkte, aber zu wenige Tage → keine Skala (ehrlich statt geraten).
    assert price_band(thin, days=1) is None
    band = price_band(thin, days=STRIP_BAND_MIN_DAYS)
    assert band is not None
    assert band["lo"] < band["hi"]
    assert band["basis"] == "percentile_25_75"
    assert band["days"] == STRIP_BAND_MIN_DAYS
    assert band["n_points"] == STRIP_BAND_MIN_POINTS


def test_konstanter_bestand_bekommt_keine_skala():
    """Eine Spanne von null wäre eine Skala ohne Aussage."""
    assert price_band([1.75] * (STRIP_BAND_MIN_POINTS + 10), days=7) is None


def test_overview_liefert_tageskurve_und_band_aus_einer_abfrage(settings):
    queries: list[str] = []

    def query(cfg, text):
        queries.append(text)
        return history()

    live = LiveData(settings, query=query, clock=lambda: NOW)
    day = live.overview({"fuel": "e10", "city": "Frankfurt", "station_id": UID})["day"]

    assert day is not None
    band = day["band"]
    assert band is not None
    assert band["lo"] < band["hi"]
    assert band["days"] >= STRIP_BAND_MIN_DAYS
    # Die Tageskurve bleibt die Tageskurve — nicht sieben Tage Punkte.
    for point in day["points"]:
        stamp = dt.datetime.fromisoformat(point["timestamp"])
        assert stamp >= NOW - dt.timedelta(hours=DAY_SERIES_HOURS)
    assert day["n_points"] == len(
        [p for p in day["points"] if p.get("price") is not None]
    )
    # **Eine** Abfrage für Kurve und Skala, nicht zwei (Lesepfad-Budget,
    # O23): Die Tageskurve wird aus dem 7-Tage-Ergebnis geschnitten. Die
    # zweite Abfrage im Overview-Pfad gehört decide (letzte Preise) und ist
    # unverändert.
    wide = [text for text in queries if "2026-09-10T16:00:00" in text]  # NOW − 168 h
    assert len(wide) == 1


def test_duennen_bestand_bekommt_keine_skala(settings):
    """Zwei Messwerte sind keine Skala — die GUI zeigt Zahlen ohne Urteil."""
    live = LiveData(
        settings,
        query=lambda *_: [row(10, "1.729"), row(70, "1.809")],
        clock=lambda: NOW,
    )
    day = live.overview({"fuel": "e10", "city": "Frankfurt", "station_id": UID})["day"]
    assert day is not None
    assert day["band"] is None
    assert len(day["points"]) == 2


def test_geschlossene_meldungen_zaehlen_nicht_in_die_skala(settings):
    rows = history()
    for entry in rows:
        entry["status"] = "closed"
    live = LiveData(settings, query=lambda *_: rows, clock=lambda: NOW)
    day = live.overview({"fuel": "e10", "city": "Frankfurt", "station_id": UID})["day"]
    assert day["band"] is None
