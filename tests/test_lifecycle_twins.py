"""A12/A13: Station-Lebenszyklus und Preis-Zwillinge — Abnahme-Tests (0.32.0).

Die Implementierung (engine/selection.py, app/alarms.py, GUI) war vorhanden,
aber unbelegt — diese Suite hält das Versprechen fest:

- A12: vier Zustände (aktiv/tot/geschlossen/führt-nicht), tote Stationen
  fallen vor dem Coverage-Gate aus dem Ranking, Schwelle konfigurierbar
  (``TANKAPP_DEAD_AFTER_DAYS``, 0 = aus). Das Polling-Set bleibt stabil —
  Tausch nur mit Bestätigung (docs/ANALYSE.md#lebenszyklus-der-stationen).
- A13: Zwillinge mit denselben Schwellen wie der manuelle Vergleich
  (28 Tage × ≥12 Punkte, ≥90 % Überlappung, ≥99 % ≤0,1 ct/L), als Warnung
  im Artefakt und im System-Tab, nie auto-apply.
"""

import json
from types import SimpleNamespace

import numpy as np
import pandas as pd

from app.alarms import build_alarms
from app.config import Settings
from engine.selection import (
    SelectionConfig,
    _detect_price_twins,
    _station_lifecycle,
    analyse_city_light,
    compute_all,
)

CITY = "Teststadt"
FUEL = "E10"


def _frames(index, specs):
    """Baut ein df aus {station_id: (price-or-nan, status)} je Zeitpunkt."""
    frames = []
    for sid, (price, status) in specs.items():
        n = len(index)
        frames.append(
            pd.DataFrame(
                {
                    "timestamp": index,
                    "station_id": sid,
                    "city": CITY,
                    "fuel": FUEL,
                    "price": np.full(n, price, dtype=float),
                    "status": status,
                    "source": "influxdb",
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


def _live_specs(index, sids, base=1.70, seed=7):
    rng = np.random.default_rng(seed)
    frames = []
    for position, sid in enumerate(sids):
        price = base + position * 0.004 + rng.normal(0, 0.002, len(index))
        frames.append(
            pd.DataFrame(
                {
                    "timestamp": index,
                    "station_id": sid,
                    "city": CITY,
                    "fuel": FUEL,
                    "price": price,
                    "status": "open",
                    "source": "influxdb",
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


# --- A12: Klassifikation ----------------------------------------------------


def test_lifecycle_distinguishes_four_states():
    index = pd.date_range("2026-07-01", periods=10 * 24, freq="h", tz="UTC")
    df = _frames(
        index,
        {
            "aktiv": (1.70, "open"),
            "tot": (np.nan, "no prices"),
            "zu": (np.nan, "closed"),
            "sorte": (np.nan, "open"),
        },
    )
    cfg = SelectionConfig()
    end_ts = df["timestamp"].max()
    assert _station_lifecycle(df, CITY, "aktiv", cfg, end_ts) == "active"
    assert _station_lifecycle(df, CITY, "tot", cfg, end_ts) == "dead"
    assert _station_lifecycle(df, CITY, "zu", cfg, end_ts) == "closed"
    assert _station_lifecycle(df, CITY, "sorte", cfg, end_ts) == "no_fuel"


def test_lifecycle_dead_needs_full_window_without_price():
    # Preis vor 3 Tagen, seither Funkstille — noch nicht tot (Fenster 7 Tage).
    index = pd.date_range("2026-07-01", periods=10 * 24, freq="h", tz="UTC")
    price = np.full(len(index), np.nan)
    price[len(index) - 3 * 24] = 1.70
    df = pd.DataFrame(
        {
            "timestamp": index,
            "station_id": "wackel",
            "city": CITY,
            "fuel": FUEL,
            "price": price,
            "status": ["open"] * len(index),
            "source": "influxdb",
        }
    )
    cfg = SelectionConfig(dead_after_days=7)
    assert (
        _station_lifecycle(df, CITY, "wackel", cfg, df["timestamp"].max()) == "active"
    )
    cfg_short = SelectionConfig(dead_after_days=2)
    assert (
        _station_lifecycle(df, CITY, "wackel", cfg_short, df["timestamp"].max())
        == "no_fuel"
    )


def test_lifecycle_unknown_station_is_dead_but_switchable_off():
    index = pd.date_range("2026-07-01", periods=10 * 24, freq="h", tz="UTC")
    df = _frames(index, {"aktiv": (1.70, "open")})
    end_ts = df["timestamp"].max()
    assert _station_lifecycle(df, CITY, "fremd", SelectionConfig(), end_ts) == "dead"
    assert (
        _station_lifecycle(
            df, CITY, "fremd", SelectionConfig(dead_after_days=0), end_ts
        )
        == "active"
    )
    assert (
        _station_lifecycle(
            df, CITY, "fremd", SelectionConfig(dead_after_days=None), end_ts
        )
        == "active"
    )


def test_dead_after_days_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("TANKAPP_DEAD_AFTER_DAYS", "14")
    assert Settings.from_env().dead_after_days == 14
    monkeypatch.setenv("TANKAPP_DEAD_AFTER_DAYS", "0")
    assert Settings.from_env().dead_after_days == 0
    monkeypatch.delenv("TANKAPP_DEAD_AFTER_DAYS")
    assert Settings.from_env().dead_after_days == 7


# --- A12: Ranking-Ausschluss -------------------------------------------------


def test_dead_station_leaves_the_ranking_but_stays_named():
    index = pd.date_range("2026-06-01", periods=42 * 24, freq="h", tz="UTC")
    df = pd.concat(
        [
            _live_specs(index, ["a", "b", "c", "d", "e"]),
            _frames(index, {"tot": (np.nan, "no prices")}),
        ],
        ignore_index=True,
    )
    cfg = SelectionConfig(n_boot=200, step_min=60)
    result = analyse_city_light(df, CITY, cfg, np.random.default_rng(42), {})
    assert result is not None
    ranked = [row["station_id"] for row in result["stations"]]
    assert "tot" not in ranked
    assert result["dead_stations"] == ["tot"]
    assert result["dead_count"] == 1
    assert result["lifecycle_counts"]["dead"] == 1
    assert result["lifecycles"]["tot"] == "dead"
    # Tote belegen auch keinen Vergleichsplatz über die Hintertür:
    assert "tot" not in result["lifecycles"] or "tot" not in ranked
    for row in result["stations"]:
        assert row["lifecycle"] == "active"


def test_recently_dead_station_leaves_the_ranking():
    # DoD-Fall: 35 Tage Preise, dann Funkstille — „no prices“ seit > 7 Tagen.
    index = pd.date_range("2026-06-01", periods=42 * 24, freq="h", tz="UTC")
    silence_from = index.max() - pd.Timedelta(days=8)
    price = 1.70 + np.random.default_rng(3).normal(0, 0.002, len(index))
    status = ["open"] * len(index)
    silent = index >= silence_from
    price[silent] = np.nan
    for position in np.flatnonzero(silent):
        status[position] = "no prices"
    df = pd.concat(
        [
            _live_specs(index, ["a", "b", "c", "d", "e"]),
            pd.DataFrame(
                {
                    "timestamp": index,
                    "station_id": "frischtot",
                    "city": CITY,
                    "fuel": FUEL,
                    "price": price,
                    "status": status,
                    "source": "influxdb",
                }
            ),
        ],
        ignore_index=True,
    )
    cfg = SelectionConfig(n_boot=200, step_min=60)
    result = analyse_city_light(df, CITY, cfg, np.random.default_rng(42), {})
    assert result is not None
    ranked = [row["station_id"] for row in result["stations"]]
    assert "frischtot" not in ranked
    assert result["dead_stations"] == ["frischtot"]
    assert result["lifecycles"]["frischtot"] == "dead"


def test_closed_and_nofuel_stay_distinguishable():
    index = pd.date_range("2026-06-01", periods=42 * 24, freq="h", tz="UTC")
    df = pd.concat(
        [
            _live_specs(index, ["a", "b", "c", "d", "e"]),
            _frames(
                index,
                {
                    "zu": (np.nan, "closed"),
                    "sorte": (np.nan, "open"),
                },
            ),
        ],
        ignore_index=True,
    )
    cfg = SelectionConfig(n_boot=200, step_min=60)
    result = analyse_city_light(df, CITY, cfg, np.random.default_rng(42), {})
    assert result is not None
    assert result["closed_stations"] == ["zu"]
    assert result["nofuel_stations"] == ["sorte"]
    assert result["dead_count"] == 0
    assert result["lifecycles"]["zu"] == "closed"
    assert result["lifecycles"]["sorte"] == "no_fuel"


def test_compute_all_aggregates_lifecycle_totals():
    index = pd.date_range("2026-06-01", periods=42 * 24, freq="h", tz="UTC")
    df = pd.concat(
        [
            _live_specs(index, ["a", "b", "c", "d", "e"]),
            _frames(index, {"tot": (np.nan, "no prices")}),
        ],
        ignore_index=True,
    )
    total = compute_all(df, SelectionConfig(n_boot=200, step_min=60), {})
    assert total["lifecycle_totals"]["dead"] == 1
    assert total["lifecycle_totals"]["active"] == 5
    assert "price_twins" in total


# --- A13: Preis-Zwillinge ----------------------------------------------------


def _twin_frames(index, price_a, price_b):
    return pd.concat(
        [
            _frames(index, {"zw1": (price_a, "open")}),
            _frames(index, {"zw2": (price_b, "open")}),
        ],
        ignore_index=True,
    )


def test_identical_series_are_reported_as_twins():
    index = pd.date_range("2026-06-01", periods=30 * 24, freq="h", tz="UTC")
    df = _twin_frames(index, 1.70, 1.70)
    twins = _detect_price_twins(df, CITY, ["zw1", "zw2"], SelectionConfig())
    assert len(twins) == 1
    twin = twins[0]
    assert {twin["station_a"], twin["station_b"]} == {"zw1", "zw2"}
    assert twin["classification"] == "possible_price_twins"
    assert twin["auto_apply"] is False
    assert twin["qualifying_days"] >= 28
    assert twin["overlap_pct"] >= 90.0
    assert twin["agreement_pct"] >= 99.0


def test_different_series_are_no_twins():
    index = pd.date_range("2026-06-01", periods=30 * 24, freq="h", tz="UTC")
    df = _twin_frames(index, 1.70, 1.75)
    assert _detect_price_twins(df, CITY, ["zw1", "zw2"], SelectionConfig()) == []


def test_short_history_is_no_twin():
    index = pd.date_range("2026-07-01", periods=7 * 24, freq="h", tz="UTC")
    df = _twin_frames(index, 1.70, 1.70)
    assert _detect_price_twins(df, CITY, ["zw1", "zw2"], SelectionConfig()) == []


def test_twins_need_a_pair():
    index = pd.date_range("2026-06-01", periods=30 * 24, freq="h", tz="UTC")
    df = _frames(index, {"solo": (1.70, "open")})
    assert _detect_price_twins(df, CITY, ["solo"], SelectionConfig()) == []


def test_twins_land_in_the_selection_artifact():
    # Zwei identische + drei eigene Verläufe: Ranking läuft, Zwilling steht drin.
    index = pd.date_range("2026-06-01", periods=35 * 24, freq="h", tz="UTC")
    rng = np.random.default_rng(11)
    frames = [_twin_frames(index, 1.70, 1.70)]
    for position, sid in enumerate(["c", "d", "e"]):
        frames.append(
            pd.DataFrame(
                {
                    "timestamp": index,
                    "station_id": sid,
                    "city": CITY,
                    "fuel": FUEL,
                    "price": 1.72 + position * 0.01 + rng.normal(0, 0.003, len(index)),
                    "status": "open",
                    "source": "influxdb",
                }
            )
        )
    df = pd.concat(frames, ignore_index=True)
    cfg = SelectionConfig(n_boot=200, step_min=60)
    result = analyse_city_light(df, CITY, cfg, np.random.default_rng(42), {})
    assert result is not None
    assert result["price_twin_count"] == 1
    pair = result["price_twins"][0]
    assert {pair["station_a"], pair["station_b"]} == {"zw1", "zw2"}
    assert pair["auto_apply"] is False


# --- A12/A13: Alarme ---------------------------------------------------------


def _alarm_settings(tmp_path):
    return SimpleNamespace(runtime=tmp_path)


def _write_current(tmp_path, fuel_data):
    sel_dir = tmp_path / "selection"
    sel_dir.mkdir(parents=True, exist_ok=True)
    (sel_dir / "current.json").write_text(
        json.dumps({"by_fuel": {"e10": fuel_data}}), encoding="utf-8"
    )


def test_alarms_warn_about_dead_closed_and_twins(tmp_path):
    _write_current(
        tmp_path,
        {
            "lifecycle_totals": {"active": 5, "dead": 2, "closed": 1, "no_fuel": 0},
            "price_twins": [{"station_a": "zw1", "station_b": "zw2"}],
            "cities": [],
        },
    )
    alarms = build_alarms(
        _alarm_settings(tmp_path),
        collector={"available": True, "fresh": True},
        jobs={},
        job_errors={},
        polling_error=None,
        station_count=8,
    )
    by_code = {a["code"]: a for a in alarms}
    assert by_code["stations_dead"]["severity"] == "warn"
    assert "2 Station(en)" in by_code["stations_dead"]["message"]
    assert "Ranking" in by_code["stations_dead"]["message"]
    assert "kein Kontingent" not in by_code["stations_dead"]["message"]
    assert by_code["stations_lifecycle"]["severity"] == "warn"
    assert "temporär geschlossen" in by_code["stations_lifecycle"]["message"]
    assert by_code["price_twins"]["severity"] == "warn"
    assert "zw1 / zw2" in by_code["price_twins"]["message"]
    assert "Keine automatische Entfernung" in by_code["price_twins"]["message"]


def test_alarms_stay_quiet_without_findings(tmp_path):
    _write_current(
        tmp_path,
        {
            "lifecycle_totals": {"active": 5, "dead": 0, "closed": 0, "no_fuel": 0},
            "price_twins": [],
            "cities": [],
        },
    )
    alarms = build_alarms(
        _alarm_settings(tmp_path),
        collector={"available": True, "fresh": True},
        jobs={},
        job_errors={},
        polling_error=None,
        station_count=5,
    )
    codes = {a["code"] for a in alarms}
    assert "stations_dead" not in codes
    assert "stations_lifecycle" not in codes
    assert "price_twins" not in codes


def test_alarms_read_fuel_files_when_current_is_missing(tmp_path):
    sel_dir = tmp_path / "selection"
    sel_dir.mkdir(parents=True, exist_ok=True)
    (sel_dir / "e10.json").write_text(
        json.dumps(
            {
                "cities": [{"dead_stations": ["tot"], "closed_stations": []}],
            }
        ),
        encoding="utf-8",
    )
    alarms = build_alarms(
        _alarm_settings(tmp_path),
        collector={"available": True, "fresh": True},
        jobs={},
        job_errors={},
        polling_error=None,
        station_count=5,
    )
    assert "stations_dead" in {a["code"] for a in alarms}
