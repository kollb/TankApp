"""O4: Rolling-PICP zählt Tage, nicht Punkte — mit Hysterese (0.45.0).

Jeder Tag im 7-Tage-Fenster zählt genau eine Stimme (Mittel der
Tagesquoten); die Fallzahl ``n_days`` steht in der Antwort. Das Badge
läuft als Kette über die Tageshistorie und wechselt erst 1,5 pp jenseits
der Schwelle.
"""

from types import SimpleNamespace

import pandas as pd

from engine.backtest import ROLLING_PICP_MIN_DAYS, rolling_picp_7d

TZ = "Europe/Berlin"


def _station():
    return SimpleNamespace(
        city="Frankfurt",
        station_id="s1",
        station_name="T1",
        fuel="e10",
        identity=lambda: {
            "city": "Frankfurt",
            "station_id": "s1",
            "station_name": "T1",
            "fuel": "e10",
        },
    )


def _rows(day_coverages: dict[str, tuple[int, int]]) -> pd.DataFrame:
    """Synthetische Vergleichszeilen: Tag → (Punkte, davon gedeckt)."""
    rows = []
    for day, (points, covered) in day_coverages.items():
        for i in range(points):
            rows.append(
                {
                    "city": "Frankfurt",
                    "station_id": "s1",
                    "fuel": "e10",
                    "origin": f"{day}T10:00:00Z",  # 12:00 Berlinzeit
                    "actual": 1.60 if i < covered else 1.80,
                    "q025": 1.50,
                    "q975": 1.70,
                }
            )
    return pd.DataFrame(rows)


def _test_days(days: list[str]) -> list[pd.Timestamp]:
    return [pd.Timestamp(day, tz=TZ) for day in days]


def test_one_day_one_vote_not_pooled_points():
    """Ein punktreicher Tag dominiert das Fenster nicht (O4-Kern)."""
    rows = _rows(
        {
            "2026-09-01": (200, 200),  # 100 % aus 200 Punkten
            "2026-09-02": (10, 5),  # 50 %
            "2026-09-03": (10, 5),  # 50 %
            "2026-09-04": (10, 5),  # 50 %
        }
    )
    (entry,) = rolling_picp_7d(
        rows, [_station()], TZ, _test_days([f"2026-09-0{d}" for d in range(1, 5)])
    )
    current = entry["current"]
    # Gepoolt wären es (200+5+5+5)/230 = 93,5 %; als Tagesmittel sind es
    # (100+50+50+50)/4 = 62,5 % — die drei schwachen Tage zählen mit.
    assert current["picp_pct"] == 62.5
    assert current["n_days"] == 4
    assert current["points"] == 230  # Volumen bleibt sichtbar, zählt aber nicht
    assert current["badge"] == "red"


def test_sparse_days_do_not_vote_and_do_not_reset_chain():
    """Tage ohne Punkte steuern keine Stimme bei (Kette hält den Stand)."""
    rows = _rows(
        {
            "2026-09-01": (100, 100),
            # 2026-09-02 fehlt: übersprungener Fold, ehrlich null Stimmen.
            "2026-09-03": (100, 100),
            "2026-09-04": (100, 100),
        }
    )
    (entry,) = rolling_picp_7d(
        rows, [_station()], TZ, _test_days([f"2026-09-0{d}" for d in range(1, 5)])
    )
    current = entry["current"]
    assert current["n_days"] == 3
    assert current["picp_pct"] == 100.0
    assert current["badge"] == "green"
    assert entry["days"][1]["n_days"] == 1  # nur der 01.09. im Fenster
    assert entry["days"][1]["badge"] is None


def test_badge_chain_holds_within_hysteresis_band():
    """Die Kette verankert: 92 % nach Grün bleibt grün (roh wäre gelb)."""
    rows = _rows(
        {
            "2026-09-01": (100, 100),
            "2026-09-02": (100, 100),
            "2026-09-03": (100, 100),
            "2026-09-04": (100, 92),  # Fenster-Mittel: 98 %
            "2026-09-05": (100, 80),  # Fenster-Mittel: 94,4 % (roh grün)
            "2026-09-06": (100, 80),  # Fenster-Mittel: 92 % (roh gelb!)
        }
    )
    (entry,) = rolling_picp_7d(
        rows, [_station()], TZ, _test_days([f"2026-09-0{d}" for d in range(1, 7)])
    )
    assert entry["days"][2]["badge"] == "green"  # erster Tag mit n ≥ 3, roh
    assert entry["current"]["picp_pct"] == 92.0
    assert entry["current"]["n_days"] == 6
    assert entry["current"]["badge"] == "green"  # Hysterese hält (92 ≥ 91,5)


def test_min_days_is_three_full_days():
    assert ROLLING_PICP_MIN_DAYS == 3
