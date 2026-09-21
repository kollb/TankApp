"""Parity-Tests zwischen pside und decide (Batch B1: M3 & M5).

Stellt sicher:
- expected_saving_eur in decide stammt aus pside.expected_saving (Fensterminimum-Draws)
- expected_saving_median_eur entspricht der konservativen Median-Schätzung
- p_lohnt konditioniert auf den frischen Referenzpreis (M5), wenn das Alter <= 15 min ist
- p_lohnt nutzt Verteilungs-Draws der Referenzstation nur bei veraltetem Referenzpreis (> 15 min)
- Microcopy verwendet die „bis zu X €“-Formulierung
- Datenstrukturen in decide (primary, windows_today, windows_week) enthalten beide Ersparnis-Funktionale
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.data import LiveData
from app.decide import evaluate_decide
from app.pside import expected_saving, expected_window_min_price, p_lohnt

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
NOW = dt.datetime(2026, 9, 10, 14, 0, tzinfo=dt.timezone.utc)


@pytest.fixture
def b1_settings(tmp_path):
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
                                "name": "Station A",
                                "brand": "BrandA",
                                "lat": 50.1109,
                                "lon": 8.6821,
                            },
                            {
                                "uuid": OTHER,
                                "name": "Station B",
                                "brand": "BrandB",
                                "lat": 50.1150,
                                "lon": 8.6850,
                            },
                        ],
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\nTANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n"
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


def raw_price(ts, uid, city, price, status="open", fuel="e10"):
    return {
        "_time": ts.isoformat(),
        "city": city,
        "station_id": uid,
        "station": "Station",
        "status": status,
        fuel: str(price),
    }


def _write_engine_forecast(settings, minima_a, nowcast_a, nowcast_b, points):
    block_starts = [
        "2026-09-10T14:00:00+00:00",
        "2026-09-10T16:00:00+00:00",
        "2026-09-10T18:00:00+00:00",
        "2026-09-10T20:00:00+00:00",
    ]
    draws_a = {
        "n": len(minima_a),
        "block_minutes": 120,
        "blocks": [
            {"start": block_starts[i], "end": block_starts[i + 1]}
            for i in range(len(minima_a[0]))
        ],
        "minima": minima_a,
        "nowcast": nowcast_a,
    }
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
                        "points": points,
                        "points_7d": points,
                        "draws_24h": draws_a,
                        "draws_7d": draws_a,
                    },
                    {
                        "station_id": OTHER,
                        "city": "Frankfurt",
                        "fuel": "e10",
                        "points": [],
                        "points_7d": [],
                        "draws_24h": {
                            "n": len(nowcast_b),
                            "block_minutes": 120,
                            "blocks": [],
                            "minima": [],
                            "nowcast": nowcast_b,
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )


def test_b1_saving_parity_with_pside(b1_settings):
    """M3: evaluate_decide liefert exakt dieselben Ersparnis-Werte wie pside."""
    anchor = 1.759
    liters = 50.0

    def query(cfg, flux):
        yield raw_price(NOW - dt.timedelta(minutes=3), UID, "Frankfurt", anchor)

    points = [
        {"timestamp": "2026-09-10T16:00:00+02:00", "q50": 1.68},
        {"timestamp": "2026-09-10T17:00:00+02:00", "q50": 1.66},
        {"timestamp": "2026-09-10T18:00:00+02:00", "q50": 1.70},
    ]
    minima = [
        [1.64, 1.72],
        [1.65, 1.71],
        [1.62, 1.70],
        [1.66, 1.73],
    ]
    _write_engine_forecast(
        b1_settings, minima, [1.75, 1.75, 1.75, 1.75], [1.70, 1.70, 1.70, 1.70], points
    )

    live = LiveData(b1_settings, query=query, clock=lambda: NOW)
    res = evaluate_decide(live, {"city": "Frankfurt", "fuel": "e10", "liters": liters})

    # Erwartung aus pside berechnen:
    direct_expected_saving = expected_saving(minima, 0, anchor, liters)
    direct_expected_min_price = expected_window_min_price(minima, 0)
    # Median der Punkte für Block 0 (16:00 und 17:00) = (1.68 + 1.66)/2 = 1.67
    expected_median_price = 1.67
    direct_median_saving = round(max(0.0, (anchor - expected_median_price) * liters), 2)

    # Parität in primary:
    assert res["primary"]["expected_saving_eur"] == direct_expected_saving
    assert res["primary"]["expected_saving_median_eur"] == direct_median_saving
    assert (
        res["primary"]["recommended_window"]["expected_min_price"]
        == direct_expected_min_price
    )
    assert (
        res["primary"]["recommended_window"]["expected_price"] == expected_median_price
    )

    # Parität in windows_today:
    w0 = res["windows_today"][0]
    assert w0["expected_saving_eur"] == direct_expected_saving
    assert w0["expected_saving_median_eur"] == direct_median_saving
    assert w0["expected_min_price"] == direct_expected_min_price

    # Microcopy: _table_action verwendet „bis zu X €“ — in de-DE (Komma,
    # MICROCOPY §3), und ohne ``saving_median_eur`` bleibt es die kurze
    # Fassung (O45: Die Basis wird nur benannt, wenn beide auseinanderfallen).
    from app.decide import _table_action

    _act, _badge, reason, _ = _table_action(
        anchor=anchor,
        expected_price_later=res["primary"]["recommended_window"]["expected_price"],
        expected_saving_eur=res["primary"]["expected_saving_eur"],
        best_alt=None,
        p_besser=0.8,
    )
    assert f"bis zu {direct_expected_saving:.2f}".replace(".", ",") + " €" in reason


def test_b1_p_lohnt_conditioned_on_fresh_reference_price(b1_settings):
    """M5/B1-Fix: Frische Preise beidseitig konditioniert – frisch→Konstante.

    Beide Stationen frisch (2 min) → deterministisch aus Live-Preisen, nicht
    aus den Nowcast-Draws. Ref-Draws (1.50) werden ignoriert.
    """
    anchor = 1.70

    def query(cfg, flux):
        # Alter: 2 Minuten (< 15 min Poll-Periode) -> FRISCH beidseitig
        yield raw_price(NOW - dt.timedelta(minutes=2), UID, "Frankfurt", anchor)
        # Alternative mit aktuellem Preis frisch
        yield raw_price(NOW - dt.timedelta(minutes=2), OTHER, "Frankfurt", 1.62)

    # Alternative B hat 4 Nowcast-Draws (werden ignoriert weil frisch)
    cand_draws = [1.60, 1.62, 1.65, 1.75]
    # Referenzstation A hat Draws, die ignoriert werden müssen, da Preis frisch ist!
    ref_draws = [1.50, 1.50, 1.50, 1.50]  # Wenn nicht ignoriert, wäre p_lohnt 0.0

    _write_engine_forecast(b1_settings, [[1.70]], ref_draws, cand_draws, points=[])

    live = LiveData(b1_settings, query=query, clock=lambda: NOW)
    res = evaluate_decide(
        live, {"city": "Frankfurt", "fuel": "e10", "liters": 40, "station_id": UID}
    )

    alt = res["alternatives_nearby"][0]
    # Beidseitig frisch → deterministisch aus Live-Preisen (B1-Fix)
    expected_p = p_lohnt(
        ref_draws,
        cand_draws,
        liters=alt["economics"]["liters_assumed"],
        detour_km_total=alt["economics"]["detour_km_total_est"],
        consumption=alt["economics"]["consumption_l_100km"],
        speed=alt["economics"]["speed_kmh"],
        z_used=alt["economics"]["time_value_eur_h"],
        ref_price=anchor,
        alt_price=1.62,
    )
    # verify evaluate_decide passed ref_price=anchor + alt_price, ignoring draws
    assert alt["p_lohnt"] == expected_p
    # Wäre auf ref_draws gerechnet worden, wäre p_lohnt 0.0 (weil ref_draws viel billiger war)
    p_with_ref_draws = p_lohnt(
        ref_draws,
        cand_draws,
        liters=alt["economics"]["liters_assumed"],
        detour_km_total=alt["economics"]["detour_km_total_est"],
        consumption=alt["economics"]["consumption_l_100km"],
        speed=alt["economics"]["speed_kmh"],
        z_used=alt["economics"]["time_value_eur_h"],
    )
    assert p_with_ref_draws == 0.0
    assert alt["p_lohnt"] > 0.0


def test_b1_p_lohnt_stale_reference_price_uses_draws(b1_settings):
    """M5/B1-Fix: Stale Referenz, frische Alternative → ref Draws vs alt Konstante."""
    anchor = 1.70

    def query(cfg, flux):
        # Alter: 30 Minuten (> 15 min Poll-Periode) -> VERALTET / STALE
        yield raw_price(NOW - dt.timedelta(minutes=30), UID, "Frankfurt", anchor)
        # Alternative frisch (2 min) → Konstante
        yield raw_price(NOW - dt.timedelta(minutes=2), OTHER, "Frankfurt", 1.62)

    cand_draws = [1.60, 1.62, 1.65, 1.75]
    ref_draws = [1.68, 1.69, 1.70, 1.71]

    _write_engine_forecast(b1_settings, [[1.70]], ref_draws, cand_draws, points=[])

    live = LiveData(b1_settings, query=query, clock=lambda: NOW)
    res = evaluate_decide(
        live, {"city": "Frankfurt", "fuel": "e10", "liters": 40, "station_id": UID}
    )

    alt = res["alternatives_nearby"][0]
    # B1-Fix: stale ref → Draws, frische alt → Konstante 1.62
    expected_p = p_lohnt(
        ref_draws,
        cand_draws,
        liters=alt["economics"]["liters_assumed"],
        detour_km_total=alt["economics"]["detour_km_total_est"],
        consumption=alt["economics"]["consumption_l_100km"],
        speed=alt["economics"]["speed_kmh"],
        z_used=alt["economics"]["time_value_eur_h"],
        ref_price=None,
        alt_price=1.62,
    )
    assert alt["p_lohnt"] == expected_p
