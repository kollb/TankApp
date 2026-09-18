"""B30 — Bodenkante der 12-Uhr-Regel (Beobachtung, Selektion, Kalibrierung).

Der Befund [docs/BEFUND-12-UHR-REGEL.md] belegt den Regimewechsel zum
01.04.2026: Vor dem Gesetz liegt das Tagestief am Abend, danach im Vormittag
(alle 169 Anstiege am Mittagspunkt). Beobachtungs-Kennzahlen, die beide
Rechtslagen mischen, beschreiben deshalb die alte Welt.

Diese Reihe prüft die Kante selbst:

* eine Quelle — ``Settings.price_law_local`` (``TANKAPP_PRICE_LAW_LOCAL``)
  wird über ``engine_config()`` zur Engine-Konfiguration, beide Defaults
  stimmen überein;
* Ablehnung statt Raterei — Müll, DST-Lücke und DST-Rücksprung ergeben
  ``None``, keine verschobene Kante;
* Gegenmessung — ``TANKAPP_LAW_FLOOR=0`` stellt den Mischbestand wieder her.
"""

import datetime as dt

import numpy as np
import pytest

from app.config import Settings, engine_config
from app.law import (
    DEFAULT_PRICE_LAW_LOCAL,
    law_floor_enabled,
    law_floor_iso,
    law_floor_label,
    law_floor_utc,
    parse_price_law,
    price_law_local,
)
from engine.config import Config
from engine.models import law_since_utc

UTC = dt.timezone.utc


def test_default_floor_is_the_engine_value():
    """Eine Kante, zwei Konsumenten: App-Default == Engine-Default."""
    assert DEFAULT_PRICE_LAW_LOCAL == Config().price_law_local
    assert Settings().price_law_local == DEFAULT_PRICE_LAW_LOCAL
    floor = law_floor_utc(Settings())
    # 01.04.2026 12:00 Europe/Berlin (Sommerzeit) = 10:00 UTC.
    assert floor == dt.datetime(2026, 4, 1, 10, 0, tzinfo=UTC)
    assert law_since_utc(engine_config(Settings())) == floor


def test_law_value_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("TANKAPP_PRICE_LAW_LOCAL", "2026-10-01T12:00")
    assert Settings.from_env().price_law_local == "2026-10-01T12:00"
    assert law_floor_utc(Settings.from_env()) == dt.datetime(
        2026, 10, 1, 10, 0, tzinfo=UTC
    )
    monkeypatch.delenv("TANKAPP_PRICE_LAW_LOCAL")
    assert Settings.from_env().price_law_local == DEFAULT_PRICE_LAW_LOCAL


def test_empty_or_blank_env_value_falls_back_instead_of_breaking(monkeypatch):
    """Leere Variable heißt „Default", nicht „keine Kante" und nicht Crash."""
    monkeypatch.setenv("TANKAPP_PRICE_LAW_LOCAL", "   ")
    settings = Settings.from_env()
    assert price_law_local(settings) == DEFAULT_PRICE_LAW_LOCAL
    # engine_config() darf daraus keinen leeren Wert an pandas weiterreichen.
    assert engine_config(settings).price_law_local == DEFAULT_PRICE_LAW_LOCAL


def test_floor_flag_comes_from_the_environment(monkeypatch):
    for raw, expected in (("0", False), ("false", False), ("1", True), ("", True)):
        monkeypatch.setenv("TANKAPP_LAW_FLOOR", raw)
        assert Settings.from_env().law_floor is expected, raw
    monkeypatch.delenv("TANKAPP_LAW_FLOOR")
    assert Settings.from_env().law_floor is True


def test_disabled_floor_means_no_floor():
    """Gegenmessung: TANKAPP_LAW_FLOOR=0 stellt den Mischbestand wieder her."""
    settings = Settings(law_floor=False)
    assert law_floor_enabled(settings) is False
    assert law_floor_utc(settings) is None
    assert law_floor_iso(settings) is None
    assert law_floor_label(settings) is None
    # Die Engine behält ihren Wert — abgeschaltet ist nur die Kante der
    # Beobachtung, nicht das Gesetz selbst.
    assert engine_config(settings).price_law_local == DEFAULT_PRICE_LAW_LOCAL


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "kein-datum",
        "2026-13-45T99:99",
        # DST-Lücke (Europe/Berlin, 29.03.2026) und DST-Rücksprung
        # (25.10.2026): beide Wanduhrzeiten sind keine gültige Kante.
        "2026-03-29T02:30",
        "2026-10-25T02:30",
    ],
)
def test_invalid_or_ambiguous_law_values_are_rejected(raw):
    """Keine still verschobene Kante — Müll und DST-Kanten ergeben None."""
    assert parse_price_law(raw) is None


def test_offset_aware_value_is_taken_as_is():
    parsed = parse_price_law("2026-04-01T12:00+02:00")
    assert parsed == dt.datetime(2026, 4, 1, 10, 0, tzinfo=UTC)


def test_label_is_the_berlin_calendar_day():
    assert law_floor_label(Settings()) == "01.04.2026"
    assert law_floor_iso(Settings()) == "2026-04-01T10:00:00+00:00"


# --- Heatmap: Bodenkante der Beobachtungs-Panel ------------------------------

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
CITY = "Frankfurt"
# 10.09.2026, 12 Wochen Fenster ⇒ Fensterbeginn 18.06.2026 — wie heute:
# vollständig hinter der Default-Kante vom 01.04.2026.
NOW = dt.datetime(2026, 9, 10, 12, tzinfo=UTC)


@pytest.fixture
def law_settings(tmp_path):
    import json

    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    CITY: {
                        "label": CITY,
                        "anchor": [50.11, 8.68],
                        "batch": [UID, OTHER],
                        "stations": [
                            {"uuid": UID, "name": "Station One"},
                            {"uuid": OTHER, "name": "Station Two"},
                        ],
                    }
                }
            }
        )
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\n"
        "TANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\n"
        "TANKAPP_INFLUX_TOKEN=dummy\n"
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


def _row(stamp, uid, price, status="open"):
    return {
        "_time": stamp.isoformat(),
        "city": CITY,
        "station_id": uid,
        "station": "Station",
        "status": status,
        "e10": str(price),
    }


def _live(settings, rows):
    from app.data import LiveData

    def query(_cfg, _flux):
        yield from rows

    return LiveData(settings, query=query, clock=lambda: NOW)


def test_heatmap_drops_prices_before_the_floor_and_counts_them(law_settings):
    """Die Kante schneidet — und sagt, wie viel sie abschneidet."""
    from dataclasses import replace

    # Kante auf den 09.09.2026 gelegt: Die Preise vom 07.09. liegen davor
    # und beschreiben die alte Rechtslage, die vom 09.09. (nachmittags)
    # danach. Beides liegt im 12-Wochen-Fenster.
    settings = replace(law_settings, price_law_local="2026-09-09T12:00")
    before = dt.datetime(2026, 9, 7, 18, 0, tzinfo=UTC)
    after = dt.datetime(2026, 9, 9, 14, 0, tzinfo=UTC)
    live = _live(
        settings,
        [
            _row(before, UID, 1.70),
            _row(before + dt.timedelta(minutes=5), OTHER, 1.72),
            _row(after, UID, 1.90),
        ],
    )

    heatmap = live.heatmap(CITY, "e10", "level", weeks=12)
    assert heatmap["error_code"] is None
    assert heatmap["law_floor"] == "2026-09-09T10:00:00+00:00"
    assert heatmap["points_before_law"] == 2
    assert heatmap["points"] == 1
    assert heatmap["range_from"] == after.isoformat()
    # Die Vor-Gesetz-Zelle (Mo 07.09., 20 Uhr Berlin) bleibt leer …
    assert heatmap["counts"][0][20] == 0
    # … die Nach-Gesetz-Zelle (Mi 09.09., 16 Uhr Berlin) trägt den Preis.
    assert heatmap["counts"][2][16] == 1


def test_heatmap_floor_is_a_no_op_on_todays_window(law_settings):
    """Nachweis, dass die Kante heute nichts ändert (Befund §4, nachgerechnet).

    Das 12-Wochen-Fenster beginnt am 18.06.2026 — hinter der Kante vom
    01.04.2026. Alle Preise zählen weiter; die Kante ist ausgewiesen, nicht
    wirksam.
    """
    rows = [
        _row(dt.datetime(2026, 9, 7, 18, 0, tzinfo=UTC), UID, 1.70),
        _row(dt.datetime(2026, 9, 8, 18, 0, tzinfo=UTC), OTHER, 1.72),
    ]
    heatmap = _live(law_settings, rows).heatmap(CITY, "e10", "level", weeks=12)
    assert heatmap["law_floor"] == "2026-04-01T10:00:00+00:00"
    assert heatmap["points_before_law"] == 0
    assert heatmap["points"] == 2


def test_heatmap_floor_can_be_switched_off_for_a_counter_measurement(law_settings):
    """TANKAPP_LAW_FLOOR=0 stellt den Mischbestand wieder her."""
    from dataclasses import replace

    settings = replace(
        law_settings, price_law_local="2026-09-09T12:00", law_floor=False
    )
    rows = [
        _row(dt.datetime(2026, 9, 7, 18, 0, tzinfo=UTC), UID, 1.70),
        _row(dt.datetime(2026, 9, 9, 14, 0, tzinfo=UTC), UID, 1.90),
    ]
    heatmap = _live(settings, rows).heatmap(CITY, "e10", "level", weeks=12)
    assert heatmap["law_floor"] is None
    assert heatmap["points_before_law"] == 0
    assert heatmap["points"] == 2
    assert heatmap["counts"][0][20] == 1
    assert heatmap["counts"][2][16] == 1


# --- Selektion: δ̂, AV-Score und „billigste Stunde" -------------------------

import pandas as pd  # noqa: E402  (Abschnitt Selektion, nach den reinen Kanten-Tests)
from engine.selection import (  # noqa: E402
    SelectionConfig,
    _to_matrix,
    analyse_city_light,
    compute_all,
    law_floor_cut,
)

SELECTION_CITY = "Teststadt"
# 01.04.2026 12:00 Europe/Berlin (Sommerzeit) — dieselbe Instanz wie app/law.py.
SELECTION_FLOOR = pd.Timestamp("2026-04-01T10:00:00+00:00")
NOON = pd.Timestamp("2026-04-01 12:00", tz="Europe/Berlin")


def _selection_frame(days_pre=20, days_post=14, start="2026-03-06"):
    """Fünf Stationen, 5-Minuten-Takt 06–24 Uhr, über den Regimewechsel hinweg.

    Station „a" ist **vor** dem Gesetz 5 ct teurer als der Stadtmedian und
    danach 2,5 ct billiger — genau die Lage, in der ein Mischbestand das
    Gegenteil der Nach-Gesetz-Welt behauptet.
    """
    frames = []
    for position, sid in enumerate(["a", "b", "c", "d", "e"]):
        stamps = []
        base = pd.Timestamp(start, tz="Europe/Berlin")
        for day in range(days_pre + days_post):
            date = base + pd.Timedelta(days=day)
            stamps.append(
                pd.date_range(
                    date + pd.Timedelta(hours=6), periods=18 * 12, freq="5min"
                )
            )
        index = stamps[0].append(stamps[1:])
        price = np.full(len(index), 1.70 + 0.01 * position)
        if sid == "a":
            law = pd.Timestamp("2026-04-01T12:00", tz="Europe/Berlin")
            price = price + np.where(index < law, 0.05, 0.0)
        frames.append(
            pd.DataFrame(
                {
                    "timestamp": index,
                    "station_id": sid,
                    "city": SELECTION_CITY,
                    "fuel": "E10",
                    "price": price,
                    "status": "open",
                    "source": "influxdb",
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


def _cfg(**overrides):
    base = {
        "n_boot": 200,
        "step_min": 5,
        "ffill_minutes": 30.0,
        "law_floor": SELECTION_FLOOR,
    }
    base.update(overrides)
    return SelectionConfig(**base)


def test_selection_cut_stops_the_panel_from_describing_the_old_world():
    """Vor dem Gesetz war „a" die teuerste Station, danach die billigste.

    Ohne Schnitt behauptet das Ranking weiter +2,5 ct (alte Welt); mit Schnitt
    steht dort −2,5 ct. Das ist die B30-DoD: Kein Panel behauptet das
    Vor-Gesetz-Muster, während die Nach-Gesetz-Daten das Gegenteil sagen.
    """
    df = _selection_frame()
    cut = analyse_city_light(df, SELECTION_CITY, _cfg(), np.random.default_rng(42), {})
    mixed = analyse_city_light(
        df, SELECTION_CITY, _cfg(law_floor=None), np.random.default_rng(42), {}
    )

    station_cut = {row["station_id"]: row for row in cut["stations"]}
    station_mixed = {row["station_id"]: row for row in mixed["stations"]}
    assert station_mixed["a"]["delta_ct"] == pytest.approx(2.5, abs=1e-6)
    assert station_cut["a"]["delta_ct"] == pytest.approx(-2.5, abs=1e-6)
    # Reichweite des Rankings beginnt an der Kante, nicht im Vormonat.
    assert cut["range_from"] == NOON.isoformat()
    assert mixed["range_from"] == "2026-03-06T06:00:00+01:00"
    assert cut["n_days"] == 9
    assert mixed["n_days"] == 35


def test_selection_reports_what_the_floor_hides():
    """Die Kante zählt, was sie ausblendet — statt still zu verkleinern."""
    df = _selection_frame()
    result = analyse_city_light(
        df, SELECTION_CITY, _cfg(), np.random.default_rng(42), {}
    )
    assert result["law_floor"] == SELECTION_FLOOR.isoformat()
    assert result["points_before_law"] == 28380
    assert result["days_before_law"] == 27

    aggregate = compute_all(df, _cfg(), {SELECTION_CITY: {}})
    assert aggregate["law_floor"] == SELECTION_FLOOR.isoformat()
    assert aggregate["points_before_law"] == 28380
    assert aggregate["days_before_law"] == 27


def test_selection_without_floor_keeps_the_mixed_baseline():
    """Gegenmessung: law_floor=None lässt den Bestand, wie er war."""
    df = _selection_frame()
    result = analyse_city_light(
        df, SELECTION_CITY, _cfg(law_floor=None), np.random.default_rng(42), {}
    )
    assert result["law_floor"] is None
    assert result["points_before_law"] == 0
    assert result["days_before_law"] == 0


def test_selection_explains_a_stock_entirely_before_the_floor():
    """Stadt verschwindet nicht kommentarlos, wenn alles vor der Kante liegt."""
    df = _selection_frame()
    result = analyse_city_light(
        df,
        SELECTION_CITY,
        _cfg(law_floor=pd.Timestamp("2026-10-01T10:00:00+00:00")),
        np.random.default_rng(42),
        {},
    )
    assert result["station_count"] == 0
    assert "12-Uhr-Bodenkante" in result["reason"]
    assert result["points_before_law"] == len(df)


def test_forward_fill_carries_no_pre_law_price_over_the_floor():
    """Der Schnitt liegt vor dem Raster — sonst füllt ffill die Kante auf.

    Station „a" meldet zuletzt 11:55 (Vor-Gesetz-Preis) und wieder 12:30.
    Ohne Schnitt trägt die Zelle 12:00 den weitergereichten Vor-Gesetz-Preis;
    mit Schnitt ist sie leer, bis „a" selbst nach dem Gesetz meldet.
    """
    rows = [
        {
            "timestamp": stamp,
            "station_id": "b",
            "city": SELECTION_CITY,
            "fuel": "E10",
            "price": 1.72,
            "status": "open",
            "source": "influxdb",
        }
        for stamp in pd.date_range(
            "2026-04-01 11:00", periods=20, freq="5min", tz="Europe/Berlin"
        )
    ]
    for stamp, price in (
        (pd.Timestamp("2026-04-01 11:55", tz="Europe/Berlin"), 1.75),
        (pd.Timestamp("2026-04-01 12:30", tz="Europe/Berlin"), 1.70),
    ):
        rows.append(
            {
                "timestamp": stamp,
                "station_id": "a",
                "city": SELECTION_CITY,
                "fuel": "E10",
                "price": price,
                "status": "open",
                "source": "influxdb",
            }
        )
    df = pd.DataFrame(rows)

    leaked = _to_matrix(df, SELECTION_CITY, 5, 30.0)
    assert float(leaked.loc[NOON, "a"]) == pytest.approx(1.75)

    kept, before, days = law_floor_cut(df, SELECTION_CITY, _cfg())
    assert (before, days) == (13, 1)
    cut = _to_matrix(kept, SELECTION_CITY, 5, 30.0)
    assert cut.index.min() == NOON
    assert pd.isna(cut.loc[NOON, "a"])
    assert float(
        cut.loc[pd.Timestamp("2026-04-01 12:30", tz="Europe/Berlin"), "a"]
    ) == (pytest.approx(1.70))


# --- Kalibrierung: Trainingsbeginn ab der Kante -----------------------------

from dataclasses import replace  # noqa: E402
from engine.config import Config as EngineConfig  # noqa: E402
from engine.data import normalize_observations, prepare_series  # noqa: E402
from engine.models import fit, predict  # noqa: E402

FIT_KNOBS = {
    "train_days": 42,
    "min_train_days": 7,
    "min_slot_days": 2,
    "bootstrap_samples": 100,
}


def _fit_series(observations, cfg, days, start):
    raw = observations(days=days, start=start)
    raw["status"] = "open"
    rows, _ = normalize_observations(raw, cfg)
    return prepare_series(rows, cfg)[0]


def test_fit_clamps_the_training_start_to_the_law(observations):
    """Fenster über den Regimewechsel: gelernt wird erst ab der Kante."""
    cfg = EngineConfig(**FIT_KNOBS)
    series = _fit_series(observations, cfg, 45, "2026-03-06")
    model = fit(series, "2026-04-20T00:00:00+02:00", cfg)

    assert model["law_floor"] == "2026-04-01T10:00:00+00:00"
    assert model["law_floor_active"] is True
    assert model["training_start"] == "2026-04-01T10:00:00+00:00"
    assert model["pre_law_points_excluded"] > 0


def test_fit_floor_is_a_no_op_on_todays_window(observations):
    """42-Tage-Fenster heute (Beginn 04.07.2026) liegt hinter der Kante."""
    cfg = EngineConfig(**FIT_KNOBS)
    series = _fit_series(observations, cfg, 45, "2026-07-01")
    model = fit(series, "2026-08-15T00:00:00+02:00", cfg)

    assert model["law_floor_active"] is False
    assert model["pre_law_points_excluded"] == 0
    # 42 Tage vor dem Cutoff, als UTC-Instanz: 04.07.2026 00:00 Berlin.
    assert model["training_start"] == "2026-07-03T22:00:00+00:00"


def test_fit_floor_rejects_a_stock_entirely_before_the_law(observations):
    """Kein stilles Mitlernen des alten Rhythmus — der Fit nennt den Grund."""
    cfg = EngineConfig(**FIT_KNOBS)
    series = _fit_series(observations, cfg, 35, "2026-02-20")
    with pytest.raises(ValueError, match="12-Uhr-Bodenkante"):
        fit(series, "2026-03-27T00:00:00+01:00", cfg)


def test_fit_with_the_floor_still_forecasts_and_holds_the_law(observations):
    """Synthetischer Nachweis der B30-DoD — der echte Backtest ist Betrieb.

    Geklemmter Trainingsbeginn darf die Prognose nicht brechen, und die
    12-Uhr-Projektion gilt weiter: Innerhalb eines Segments [12:00 Uhr,
    nächste 12:00 Uhr) steigt kein Preis-Segment.
    """
    cfg = EngineConfig(**FIT_KNOBS)
    series = _fit_series(observations, cfg, 45, "2026-03-06")
    model = fit(series, "2026-04-20T00:00:00+02:00", cfg)

    # 36 h, damit das Segment [12:00 Uhr, nächste 12:00 Uhr) vollständig im
    # Raster liegt — nur dann koppelt die Projektion (engine/models.py).
    out = predict(model, hours=36)
    segment = out.q50.loc[
        (out.index >= pd.Timestamp("2026-04-20 12:00", tz="Europe/Berlin"))
        & (out.index < pd.Timestamp("2026-04-21 12:00", tz="Europe/Berlin"))
    ].dropna()
    assert len(segment) == 288
    steps = segment.to_numpy()[1:] - segment.to_numpy()[:-1]
    assert (steps <= 1e-9).all()


def test_law_date_is_configuration_not_logic(observations):
    """Verschiebt sich das Gesetz, folgt die Kante — kein Hardcode."""
    cfg = replace(EngineConfig(**FIT_KNOBS), price_law_local="2026-08-01T12:00")
    series = _fit_series(observations, cfg, 45, "2026-07-01")
    model = fit(series, "2026-08-20T00:00:00+02:00", cfg)
    assert model["law_floor"] == "2026-08-01T10:00:00+00:00"
    assert model["law_floor_active"] is True
    assert model["training_start"] == "2026-08-01T10:00:00+00:00"


# --- Offline-Werkzeug: Preis-Zwillings-Vergleich ----------------------------

import json  # noqa: E402
from dataclasses import replace as dc_replace  # noqa: E402
from engine.cli import main as engine_main  # noqa: E402
from engine.station_comparison import compare_pair  # noqa: E402


def _twin_polling(tmp_path):
    path = tmp_path / "polling.json"
    path.write_text(
        json.dumps(
            {
                "sets": {
                    "test": {
                        "label": "Testmarkt",
                        "batch": ["station-1", "station-2"],
                        "stations": [
                            {
                                "uuid": "station-1",
                                "name": "Aral Test",
                                "brand": "ARAL",
                                "dist_km": 1.0,
                            },
                            {
                                "uuid": "station-2",
                                "name": "Aral Test",
                                "brand": "ARAL",
                                "dist_km": 3.0,
                            },
                        ],
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    return path


def test_price_twin_comparison_cuts_at_the_law_floor(series):
    """Der Vergleich zählt nur Beobachtungen ab der Kante — und sagt es."""
    b = dc_replace(series, station_id="station-2", frame=series.frame.copy())
    cfg = EngineConfig()

    full = compare_pair(series, b, cfg)
    assert full["points_before_law"] == 0
    assert full["qualifying_days"] == 35

    floor = pd.Timestamp("2026-07-25T10:00:00+00:00")
    cut = compare_pair(series, b, cfg, law_floor=floor)
    assert cut["points_before_law"] > 0
    assert cut["common_points"] < full["common_points"]
    assert cut["qualifying_days"] < full["qualifying_days"]
    # Unter 28 qualifizierenden Tagen ist ein Zwillingsurteil keine Aussage.
    assert cut["classification"] == "insufficient_data"


def test_compare_stations_cli_names_the_floor_and_the_counter_measurement(
    observations, tmp_path
):
    """CLI: --law-date schneidet, --ignore-law-floor mischt bewusst."""
    a = observations().drop(columns=["status", "source"])
    b = a.copy()
    b["station_id"] = "station-2"
    path = tmp_path / "history.csv.gz"
    pd.concat([a, b]).to_csv(path, index=False)
    polling = _twin_polling(tmp_path)

    def run(extra, out):
        assert (
            engine_main(
                [
                    "compare-stations",
                    "--data",
                    str(path),
                    "--polling",
                    str(polling),
                    "--out",
                    str(tmp_path / out),
                ]
                + extra
            )
            == 0
        )
        return json.loads((tmp_path / out / "report.json").read_text(encoding="utf-8"))

    cut = run(["--law-date", "2026-07-20T12:00"], "cut")
    assert cut["law_floor"] == "2026-07-20T10:00:00+00:00"
    assert cut["points_before_law"] > 0
    assert "12-Uhr-Bodenkante" in (tmp_path / "cut" / "report.md").read_text(
        encoding="utf-8"
    )

    mixed = run(["--ignore-law-floor"], "mixed")
    assert mixed["law_floor"] is None
    assert mixed["points_before_law"] == 0
    assert "abgeschaltet" in (tmp_path / "mixed" / "report.md").read_text(
        encoding="utf-8"
    )
    assert mixed["pairs"][0]["common_points"] > cut["pairs"][0]["common_points"]
