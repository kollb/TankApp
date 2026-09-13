"""A9: Das persönliche Tankzeit-Profil w(h) gewichtet die F3-Fenster.

Konzept §5.5 Schicht C: Ab **8 Füllungen** fließt das geschrumpfte
Tankzeit-Histogramm in die Fensterreihenfolge („billigste Stunde“/F3);
darunter bleibt die reine Preisreihenfolge die ehrlichere Wahl — ein
Profil aus drei Belegen wäre erfunden.

Getestet werden beide Zustände und die Kante dazwischen: Nachtfenster
(günstig, aber nie genutzt) gegen Feierabendfenster (etwas teurer, aber
genau die Tankzeit des Nutzers).
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.data import LiveData
from app.decide import _rank_windows, _wh_weight, evaluate_decide
from app.feedback import WH_MIN_FILLS, compute_wallet_stats, load_store

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
# 22:00 UTC = 00:00 Berlin (11.09.): beide Fenster liegen am selben
# Berliner Tag und noch vor dem Nutzer — 03–05 Uhr und 18–20 Uhr.
NOW = dt.datetime(2026, 9, 10, 22, 0, tzinfo=dt.timezone.utc)


@pytest.fixture
def a9_settings(tmp_path):
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


def _write_fills(settings, hours: list[float]) -> None:
    """Füllungen in den Store schreiben (Form wie app/feedback.add_fill)."""
    store = load_store(settings)
    for index, hour in enumerate(hours):
        store["fills"].append(
            {
                "id": f"fill-{index}",
                "episode_id": None,
                "station_id": UID,
                "station_name": "Station Alpha",
                "tanked_at": (NOW - dt.timedelta(days=index + 1)).isoformat(),
                "clock_hour": hour,
                "liters": 40.0,
                "price_paid": 1.70,
                "price_source": "nowcast",
                "fuel": "e10",
                "source": "gui",
                "compliance": "followed",
                "saved_vs_always_now_eur": 1.2,
            }
        )
    path = settings.runtime / "feedback" / "store.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store), encoding="utf-8")


def _live(a9_settings):
    """Live-Daten mit zwei Fenstern: 03–05 Uhr (1,55 €) und 18–20 Uhr (1,60 €)."""

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
            for uid, price in ((UID, 1.729), (OTHER, 1.749))
        ]

    live = LiveData(a9_settings, query=query, clock=lambda: NOW)
    path = a9_settings.runtime / "engine/current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    # Zwei 2-h-Blöcke am 11.09. (Berlin): 03–05 Uhr günstig, 18–20 Uhr teurer.
    points = [
        {"timestamp": "2026-09-11T03:00:00+02:00", "q50": 1.55},
        {"timestamp": "2026-09-11T03:55:00+02:00", "q50": 1.56},
        {"timestamp": "2026-09-11T18:00:00+02:00", "q50": 1.60},
        {"timestamp": "2026-09-11T18:55:00+02:00", "q50": 1.61},
    ]
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
                        "points": points,
                        "points_7d": points,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return live


# --- w(h)-Profil: Laden und Fenstergewicht --------------------------------


def test_wh_profil_trägt_erst_ab_acht_füllungen(a9_settings):
    store = load_store(a9_settings)
    stats = compute_wallet_stats(store, now=NOW)
    assert stats["wh_personalized"] is False
    assert stats["wh_n"] == 0
    assert stats["wh_min_fills"] == WH_MIN_FILLS
    assert len(stats["wh_hours"]) == 24

    _write_fills(a9_settings, [18.0] * 7)
    stats = compute_wallet_stats(load_store(a9_settings), now=NOW)
    assert stats["wh_n"] == 7
    assert stats["wh_personalized"] is False  # noch nicht belastbar

    _write_fills(a9_settings, [18.0])
    stats = compute_wallet_stats(load_store(a9_settings), now=NOW)
    assert stats["wh_n"] == 8
    assert stats["wh_personalized"] is True
    # Geschrumpft gegen den Default: 18 Uhr trägt, aber nicht ausschließlich.
    assert stats["wh_hours"][18] == max(stats["wh_hours"])
    assert sum(stats["wh_hours"]) == pytest.approx(1.0, abs=0.01)


def test_wh_gewicht_mittelt_über_das_fenster():
    profile = [0.0] * 24
    profile[18] = 1.0
    # Fenster ganz innerhalb der Stunde mit Gewicht 1 (Viertelstunden-Raster).
    assert _wh_weight(profile, 18.0, 18.75) == pytest.approx(1.0)
    # Fenster in einer Stunde ohne Gewicht: 0, nicht „keine Aussage“.
    assert _wh_weight(profile, 3.0, 4.75) == pytest.approx(0.0)
    # Fenster über die Grenze (17–19 Uhr) zählt anteilig.
    assert _wh_weight(profile, 17.0, 19.0) == pytest.approx(0.5)
    # Ohne Profil keine Gewichtung — die Preisreihenfolge bleibt stehen.
    assert _wh_weight(None, 18.0, 20.0) is None
    assert _wh_weight([], 18.0, 20.0) is None


def test_rangfolge_ohne_profil_bleibt_preisreihenfolge():
    windows = [
        {"expected_price": 1.60, "start": "b", "start_hour": 18.0, "end_hour": 20.0},
        {"expected_price": 1.55, "start": "a", "start_hour": 3.0, "end_hour": 5.0},
    ]
    ranked = _rank_windows(windows)
    assert [w["start"] for w in ranked] == ["a", "b"]
    assert all(w["wh_weight"] is None for w in ranked)


# --- Durch evaluate_decide ------------------------------------------------


def test_ohne_füllungen_zählt_der_preis_nicht_die_uhrzeit(a9_settings):
    result = evaluate_decide(_live(a9_settings), {"city": "Frankfurt", "liters": 40})
    windows = result["windows_today"]
    assert windows, "Fenster fehlen — Testfall trägt nicht"
    assert windows[0]["expected_price"] == 1.555  # Nachtfenster ist am billigsten
    assert all(w["wh_weight"] is None for w in windows)
    assert result["personalization"] == {
        "active": False,
        "n_fills": 0,
        "min_fills": WH_MIN_FILLS,
        "missing_fills": WH_MIN_FILLS,
    }


def test_ab_acht_füllungen_zieht_das_profil_das_fenster(a9_settings):
    """Acht Belege um 18 Uhr: das teurere Feierabendfenster führt."""
    _write_fills(a9_settings, [18.0] * 8)
    result = evaluate_decide(_live(a9_settings), {"city": "Frankfurt", "liters": 40})
    windows = result["windows_today"]
    assert [round(w["expected_price"], 3) for w in windows][0] == 1.605
    # Das Nachtfenster bleibt sichtbar (Top 3, nicht ersetzt), nur hinten.
    assert any(round(w["expected_price"], 3) == 1.555 for w in windows)
    assert windows[0]["wh_weight"] > 0
    assert windows[-1]["wh_weight"] == 0
    assert result["personalization"]["active"] is True
    assert result["personalization"]["n_fills"] == 8
    assert result["personalization"]["missing_fills"] == 0
    # Die Empfehlung folgt der neuen Reihenfolge.
    assert result["primary"]["recommended_window"]["start"].endswith("+02:00")


def test_wochenfenster_folgen_demselben_profil(a9_settings):
    _write_fills(a9_settings, [18.0] * 9)
    result = evaluate_decide(_live(a9_settings), {"city": "Frankfurt", "liters": 40})
    week = result["windows_week"]
    assert week
    assert week[0]["wh_weight"] >= week[-1]["wh_weight"]
    # Die Wochenfenster tragen ihre Stunden — sonst kann die GUI die
    # Reihenfolge nicht begründen.
    assert result["personalization"]["active"] is True
