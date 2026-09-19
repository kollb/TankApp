"""B0 — PIT-Paare und Regime-Marker im Rolling-Backtest (Befund Teil 4, §5.7).

Der Backtest liefert seit 0.56.0 je bewertetem Punkt den PIT (Mittelrang der
Beobachtung unter den Bootstrap-Pfaden) und markiert Punkte, deren
Trainings- oder Bewertungsfenster eine deklarierte Regime-Kante überspannt
(``Config.regimes``). Der Bericht verdichtet das je Station und Horizont
(``pit``), zählt die Kanten (``regime_breaks_in_window``) und nennt das
gemessene Punktmodell (``model_kind``). Kennzahlen und Quantile bleiben
dabei unverändert — die Marker sind Etiketten, keine Filter.
"""

from __future__ import annotations

import gzip
import json

import numpy as np
import pandas as pd
import pytest

from engine.backtest import (
    PIT_BINS,
    markdown_report,
    pit_summary,
    pit_values,
    run_backtest,
)
from engine.cli import main
from engine.config import Config
from engine.regimes import breaks_within, regime_breaks_utc, spans_break
from engine.storage import json_safe

BREAK = {
    "announced_local": "2026-07-31T00:00",
    "kind": "tax_step",
    "fuel": None,
    "announced_value": -17.0,
    "status": "announced",
    "source": "Test-Kalender",
}


# --- PIT-Rechnung ---------------------------------------------------------------


def test_pit_ist_der_mittelrang_unter_den_pfaden():
    paths = np.array(
        [[1.0, 1.0, np.nan], [2.0, 1.0, np.nan], [3.0, 2.0, np.nan], [4.0, 3.0, np.nan]]
    )
    actual = np.array([2.5, 1.0, 1.0])
    pit = pit_values(paths, actual)
    # 2 Pfade unter 2,5 von 4 → 0,5; Bindung: 0 unter, 2 gleich → 1/4;
    # keine endlichen Pfade → NaN.
    assert pit[0] == pytest.approx(0.5)
    assert pit[1] == pytest.approx(0.25)
    assert np.isnan(pit[2])
    assert np.isnan(pit_values(paths[:, :1], np.array([np.nan]))[0])
    with pytest.raises(ValueError):
        pit_values(paths, np.array([1.0]))


def test_pit_summary_histogramm_und_abdeckung():
    values = np.linspace(0.0125, 0.9875, PIT_BINS)  # ein Wert je Klasse
    summary = pit_summary(values)
    assert summary["n"] == PIT_BINS
    assert summary["histogram"] == [1] * PIT_BINS
    assert sum(summary["histogram"]) == summary["n"]
    assert summary["coverage"]["0.5"] == pytest.approx(0.5)
    assert summary["coverage"]["0.025"] == pytest.approx(1 / PIT_BINS)
    assert summary["interval_95"] == pytest.approx(38 / PIT_BINS)
    empty = pit_summary(np.array([np.nan]))
    assert empty["n"] == 0
    assert empty["coverage"]["0.975"] is None
    assert empty["interval_95"] is None


# --- Regime-Kalender in der Config -----------------------------------------------


def test_config_normalisiert_regime_kanten():
    cfg = Config(regimes=["2026-10-01T00:00", BREAK, dict(BREAK)])
    assert len(cfg.regimes) == 2  # Duplikat fällt zusammen
    assert [entry["announced_local"] for entry in cfg.regimes] == [
        "2026-07-31T00:00",
        "2026-10-01T00:00",
    ]
    short = cfg.regimes[1]
    assert short == {
        "announced_local": "2026-10-01T00:00",
        "kind": "tax_step",
        "fuel": None,
        "announced_value": None,
        "status": "announced",
        "source": "",
    }
    # JSON-Rundreise (Artefakt → Config) ist idempotent, Hash bleibt gleich.
    again = Config(**json.loads(json.dumps(cfg.to_dict())))
    assert again == cfg and hash(again) == hash(cfg)
    assert Config().regimes == ()
    assert hash(Config()) != hash(cfg)


@pytest.mark.parametrize(
    "bad",
    [
        ["2026-03-29T02:30"],  # DST-Lücke
        ["2026-10-25T02:30"],  # doppelte Wanduhrzeit
        [{"announced_local": "2026-10-01", "foo": 1}],
        [{"announced_local": "2026-10-01", "kind": "subsidy"}],
        [{"announced_local": "2026-10-01", "fuel": "LPG"}],
        [{"announced_local": "2026-10-01", "status": "maybe"}],
        [{"announced_local": "2026-10-01", "announced_value": "viel"}],
        [{"kind": "tax_step"}],
        [42],
        ["kein datum"],
    ],
)
def test_config_lehnt_kaputte_kanten_ab(bad):
    with pytest.raises(ValueError, match="regimes"):
        Config(regimes=bad)


def test_regime_helfer_filtern_nach_sorte_und_fenster():
    cfg = Config(
        regimes=[
            {**BREAK, "fuel": "DIESEL"},
            {**BREAK, "announced_local": "2026-10-01T00:00"},
        ]
    )
    assert len(regime_breaks_utc(cfg)) == 2
    e10 = regime_breaks_utc(cfg, "E10")
    assert [item["announced_local"] for item in e10] == ["2026-10-01T00:00"]
    assert e10[0]["at"] == pd.Timestamp("2026-09-30T22:00:00Z")
    start = pd.Timestamp("2026-09-01T00:00Z")
    assert spans_break(e10, start, pd.Timestamp("2026-10-01T00:00Z"))
    assert not spans_break(e10, start, pd.Timestamp("2026-09-30T22:00:00Z"))
    assert (
        breaks_within(
            e10, pd.Timestamp("2026-10-01T00:00Z"), pd.Timestamp("2026-11-01T00:00Z")
        )
        == []
    )


# --- Backtest -----------------------------------------------------------------------


@pytest.fixture
def cfg_with_break(cfg):
    return Config(**{**cfg.to_dict(), "regimes": (BREAK,)})


def test_backtest_zeilen_tragen_pit_und_marker(series, cfg_with_break):
    report, rows = run_backtest([series], cfg_with_break, days=3, until="2026-08-02")
    assert {"pit", "regime_break_spanned", "horizon_hours"} <= set(rows.columns)
    assert rows.horizon_hours.eq(0).all()
    assert rows.pit.between(0.0, 1.0).all()
    # Kante 31.07. 00:00: Folds 31.07. und 01.08. überspannen sie, 30.07. nicht.
    by_origin = rows.groupby("origin").regime_break_spanned.mean()
    assert by_origin.to_dict() == {
        "2026-07-29T22:00:00+00:00": 0.0,
        "2026-07-30T22:00:00+00:00": 1.0,
        "2026-07-31T22:00:00+00:00": 1.0,
    }
    scored = [fold for fold in report["folds"] if fold["status"] == "scored"]
    assert [fold["regime_break_spanned"] for fold in scored] == [False, True, True]
    assert scored[1]["regime_breaks"] == ["2026-07-31T00:00"]
    assert {
        "ar_shrink_events",
        "ar_fallback",
        "ar_state_reset",
        "training_start",
    } <= set(scored[0])


def test_bericht_zaehlt_kanten_und_nennt_das_modell(series, cfg_with_break):
    report, rows = run_backtest([series], cfg_with_break, days=3, until="2026-08-02")
    regime = report["regime_breaks_in_window"]
    assert regime["policy"] == "flagged_not_excluded"
    assert regime["count"] == 1
    assert regime["in_window"][0]["announced_local"] == "2026-07-31T00:00"
    assert regime["in_window"][0]["announced_value"] == -17.0
    assert regime["in_window"][0]["source"] == "Test-Kalender"
    assert regime["declared"] == regime["in_window"]
    assert regime["folds_spanning"] == 2 and regime["folds_scored"] == 3
    assert regime["points_spanning"] == 2 * 216 and regime["points"] == 3 * 216
    assert regime["metrics_break_free"]["points"] == 216
    assert report["model_kind"] == "harmonic_ar2"
    assert report["shared_draws"] is False
    ar = report["ar_shrink"]
    assert ar["folds_scored"] == 3 and ar["shrink_events_total"] >= 0
    assert set(ar) == {
        "folds_scored",
        "folds_shrunk",
        "shrink_events_total",
        "folds_state_reset",
        "fallbacks",
    }
    json.dumps(json_safe(report), allow_nan=False)
    text = markdown_report(report)
    assert "## Messgrundlagen (B0)" in text
    assert "Regime-Kanten im Fenster" in text and "-17.0 ct/L" in text
    assert "Gemessenes Punktmodell: `harmonic_ar2`" in text


def test_pit_block_je_station_und_horizont(series, cfg_with_break):
    report, rows = run_backtest([series], cfg_with_break, days=3, until="2026-08-02")
    pit = report["pit"]
    assert pit["bins"] == PIT_BINS and pit["levels"] == [0.025, 0.1, 0.5, 0.9, 0.975]
    station = pit["stations"][0]
    assert station["station_id"] == series.station_id
    assert set(station["horizons"]) == {"24h", "72h", "168h"}
    day = station["horizons"]["24h"]
    assert day["all"]["n"] == 3 * 216
    assert day["break_free"]["n"] == 216
    assert sum(day["all"]["histogram"]) == day["all"]["n"]
    # Das Histogramm ist dieselbe Verteilung wie die Spalte in den Zeilen.
    expected, _ = np.histogram(
        rows.pit.to_numpy(), bins=np.linspace(0, 1, PIT_BINS + 1)
    )
    assert day["all"]["histogram"] == expected.tolist()
    # +7 d liegt hinter dem Testende (until ohne strict_end, aber Daten enden
    # am 04.08.) → 168h ohne Punkte, ehrlich n = 0 statt erfunden.
    assert station["horizons"]["168h"]["all"]["n"] == 0
    assert station["horizons"]["168h"]["all"]["interval_95"] is None


def test_marker_aendern_keine_kennzahl(series, cfg, cfg_with_break):
    plain, plain_rows = run_backtest([series], cfg, days=2, until="2026-08-01")
    marked, marked_rows = run_backtest(
        [series], cfg_with_break, days=2, until="2026-08-01"
    )
    for key in ("metrics", "stations", "criteria", "horizons", "rolling_picp_7d"):
        assert json_safe(plain[key]) == json_safe(marked[key]), key
    assert plain["regime_breaks_in_window"]["count"] == 0
    assert plain["regime_breaks_in_window"]["metrics_break_free"] is None
    assert marked["regime_breaks_in_window"]["count"] == 1
    for column in ("q025", "q50", "q975", "pit"):
        np.testing.assert_array_equal(
            plain_rows[column].to_numpy(), marked_rows[column].to_numpy()
        )
    assert not plain_rows.regime_break_spanned.any()
    # PIT „all“ ist gleich, nur „break_free“ verliert markierte Punkte.
    p = plain["pit"]["stations"][0]["horizons"]["24h"]
    m = marked["pit"]["stations"][0]["horizons"]["24h"]
    assert p["all"] == m["all"]
    assert p["break_free"] == p["all"]
    assert m["break_free"]["n"] < m["all"]["n"]


def test_horizont_zeilen_nur_auf_wunsch(series, cfg):
    _, plain = run_backtest([series], cfg, days=2, until="2026-08-01")
    _, with_h = run_backtest(
        [series], cfg, days=2, until="2026-08-01", horizon_rows=True
    )
    assert plain.horizon_hours.eq(0).all()
    assert len(with_h) > len(plain)
    assert set(with_h.horizon_hours.unique()) >= {0, 72}
    day_part = with_h.loc[with_h.horizon_hours == 0].reset_index(drop=True)
    pd.testing.assert_frame_equal(day_part, plain.reset_index(drop=True))
    extra = with_h.loc[with_h.horizon_hours == 72]
    assert extra.pit.between(0, 1).all()
    assert extra.timestamp.notna().all()


def test_ensemble_als_gemessenes_modell(series, cfg):
    report, rows = run_backtest(
        [series], cfg, days=2, until="2026-08-01", kind="ensemble", shared_draws=True
    )
    assert report["model_kind"] == "ensemble"
    assert report["shared_draws"] is True
    assert report["metrics"]["points"] == 2 * 216
    with pytest.raises(ValueError, match="kind"):
        run_backtest([series], cfg, days=2, until="2026-08-01", kind="magic")


def test_cli_regime_break_und_kind(observations, tmp_path):
    data = tmp_path / "input.csv.gz"
    observations(days=35).to_csv(data, index=False)
    out = tmp_path / "backtest"
    assert (
        main(
            [
                "backtest",
                "--data",
                str(data),
                "--days",
                "2",
                "--until",
                "2026-08-01",
                "--regime-break",
                "2026-07-31T00:00",
                "--kind",
                "ensemble",
                "--out",
                str(out),
            ]
        )
        == 0
    )
    report = json.loads((out / "report.json").read_text())
    assert report["model_kind"] == "ensemble"
    assert report["config"]["regimes"][0]["announced_local"] == "2026-07-31T00:00"
    assert report["regime_breaks_in_window"]["count"] == 1
    assert report["regime_breaks_in_window"]["folds_spanning"] == 1
    with gzip.open(out / "predictions.csv.gz", "rt", encoding="utf-8") as handle:
        frame = pd.read_csv(handle)
    assert {"pit", "regime_break_spanned", "horizon_hours"} <= set(frame.columns)
    assert set(frame.horizon_hours.unique()) >= {0, 72}
    assert "Regime-Kanten im Fenster" in (out / "report.md").read_text(encoding="utf-8")
