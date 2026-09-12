"""B17: Tages-Cache des 21-Tage-Backtests (app/backtest_cache.py).

Die Zusage, die den Cache überhaupt erlaubt, wird hier gegen die echte
Implementierung geprüft — nicht nur der Cache-Mechanismus:

1. Gleicher lokaler Endtag, zusätzliche Stundendaten am selben Tag
   → identischer Bericht (Kennzahlen, Vergleichszeilen, Horizonte).
2. Änderung in der Vergangenheit (Lückenfüllung/Archiv-Nachholung)
   → anderer Fingerabdruck, neuer Bericht.
3. Cache-Treffer liefert dieselben Zahlen wie die Rechnung und wird
   ehrlich als ``backtest_cached`` ausgewiesen.
"""

import json

import numpy as np
import pandas as pd

from app import backtest_cache
from app.model_jobs import run_tasks
from engine.backtest import last_complete_day, run_backtest, truncate_series
from engine.data import normalize_observations, prepare_series
from engine.storage import json_safe

DAYS = 7
ORIGIN = pd.Timestamp("2026-08-05T10:00", tz="UTC")


def _frame(points, start="2026-07-01", seed=123):
    index = pd.date_range(start, periods=points, freq="5min", tz="Europe/Berlin")
    hour = np.asarray(index.hour + index.minute / 60)
    time = np.arange(len(index)) / 288
    rng = np.random.default_rng(seed)
    price = (
        1.70
        + 0.04 * np.cos(hour * 2 * np.pi / 24)
        + 0.005 * np.sin(time)
        + rng.normal(0, 0.001, len(index))
    )
    return pd.DataFrame(
        {
            "timestamp": index.astype(str),
            "city": "Testmarkt",
            "station_id": "station-1",
            "station_name": "Teststation",
            "fuel": "E10",
            "price": price,
            "status": np.where(hour >= 6, "open", "closed"),
            "source": "influxdb",
        }
    )


def _series(frame, cfg):
    normalized, _ = normalize_observations(frame, cfg)
    return prepare_series(normalized, cfg)[0]


def _report(series, cfg):
    report, _ = run_backtest([series], cfg, days=DAYS)
    return json.dumps(json_safe(report), sort_keys=True)


def test_same_day_new_hourly_data_yields_identical_report(cfg):
    """35 volle Tage + 10 Uhr, + 14 Uhr, + 20 Uhr des 36. Tags: ein Bericht."""
    reports = {
        hour: _report(_series(_frame(35 * 288 + 12 * hour), cfg), cfg)
        for hour in (10, 14, 20)
    }
    assert reports[10] == reports[14] == reports[20]
    parsed = json.loads(reports[10])
    # Der letzte Fold liegt vor dem angebrochenen Tag; Mehrtage-Fenster, die
    # hinter dem Testende lägen, werden gezählt statt gegen den laufenden
    # Tag bewertet.
    assert parsed["test_end_exclusive"].startswith("2026-08-05T00:00")
    assert parsed["horizons"]["72h"]["days_beyond_test_end"] == 3
    assert parsed["horizons"]["168h"]["days_beyond_test_end"] == 7


def test_fingerprint_stable_intraday_but_changes_on_past_edit(cfg):
    morning = _series(_frame(35 * 288 + 12 * 10), cfg)
    evening = _series(_frame(35 * 288 + 12 * 20), cfg)
    end = last_complete_day([morning], cfg)
    assert end == last_complete_day([evening], cfg)
    cut_a = truncate_series(morning, end.tz_convert("UTC"))
    cut_b = truncate_series(evening, end.tz_convert("UTC"))
    key_a = backtest_cache.fingerprint(cut_a, cfg, end, DAYS)
    key_b = backtest_cache.fingerprint(cut_b, cfg, end, DAYS)
    assert key_a == key_b

    # Lückenfüllung in der Vergangenheit: ein Preis 10 Tage vor dem Ende
    # ändert sich um 0,1 ct — muss den Fingerabdruck kippen.
    edited = _frame(35 * 288 + 12 * 20)
    stamp = pd.Timestamp("2026-07-26T12:00", tz="Europe/Berlin")
    mask = pd.to_datetime(edited.timestamp).eq(stamp)
    assert mask.sum() == 1
    edited.loc[mask, "price"] += 0.001
    cut_c = truncate_series(_series(edited, cfg), end.tz_convert("UTC"))
    assert backtest_cache.fingerprint(cut_c, cfg, end, DAYS) != key_a

    # Andere Config (Entscheidungsstunde) = anderer Bericht = anderer Schlüssel.
    from dataclasses import replace

    other_cfg = replace(cfg, decision_hour=8)
    assert backtest_cache.fingerprint(cut_a, other_cfg, end, DAYS) != key_a
    # Anderer Testzeitraum ebenso.
    assert backtest_cache.fingerprint(cut_a, cfg, end, DAYS + 1) != key_a


def _strip(result):
    return {
        key: value
        for key, value in result.items()
        if key not in {"backtest_cached", "backtest_computed_at"}
    }


def test_cache_hit_returns_identical_payload_and_is_flagged(cfg, tmp_path):
    cache_dir = tmp_path / "backtest-cache"
    series_a = _series(_frame(35 * 288 + 12 * 10), cfg)
    series_b = _series(_frame(35 * 288 + 12 * 20), cfg)
    key = (series_a.city, series_a.station_id)
    task = [("backtest", key, DAYS)]

    fresh = run_tasks(
        task, {key: series_a}, cfg, ORIGIN, workers=1, cache_dir=cache_dir
    )[0]
    assert fresh["ok"] and fresh["backtest_cached"] is False
    assert fresh["backtest_computed_at"]
    files = list(cache_dir.glob("e10-*.json"))
    assert len(files) == 1
    stored = json.loads(files[0].read_text(encoding="utf-8"))
    assert stored["station_id"] == "station-1"
    assert stored["end_local"].startswith("2026-08-05T00:00")

    # Zweiter Lauf am selben Tag mit zehn Stunden mehr Live-Daten: Treffer.
    hit = run_tasks(task, {key: series_b}, cfg, ORIGIN, workers=1, cache_dir=cache_dir)[
        0
    ]
    assert hit["ok"] and hit["backtest_cached"] is True
    assert hit["backtest_computed_at"] == fresh["backtest_computed_at"]
    assert json_safe(_strip(hit)) == json_safe(_strip(fresh))
    assert len(list(cache_dir.glob("e10-*.json"))) == 1

    # Ohne Cache-Verzeichnis: immer rechnen, keine Datei, gleiche Zahlen.
    plain = run_tasks(task, {key: series_b}, cfg, ORIGIN, workers=1)[0]
    assert plain["backtest_cached"] is False
    assert json_safe(_strip(plain)) == json_safe(_strip(fresh))


def test_cache_miss_after_past_gapfill_recomputes(cfg, tmp_path):
    cache_dir = tmp_path / "backtest-cache"
    base = _frame(35 * 288 + 12 * 10)
    series_a = _series(base, cfg)
    key = (series_a.city, series_a.station_id)
    task = [("backtest", key, DAYS)]
    first = run_tasks(
        task, {key: series_a}, cfg, ORIGIN, workers=1, cache_dir=cache_dir
    )[0]
    assert first["backtest_cached"] is False

    # Archiv-Nachholung: ein vergangener Tag bekommt spürbar andere Preise.
    edited = base.copy()
    day = pd.to_datetime(edited.timestamp).dt.strftime("%Y-%m-%d").eq("2026-07-30")
    edited.loc[day, "price"] += 0.05
    series_b = _series(edited, cfg)
    second = run_tasks(
        task, {key: series_b}, cfg, ORIGIN, workers=1, cache_dir=cache_dir
    )[0]
    assert second["ok"] and second["backtest_cached"] is False
    assert second["metrics"] != first["metrics"]
    # Eine Datei je Station — der neue Stand ersetzt den alten.
    assert len(list(cache_dir.glob("e10-*.json"))) == 1
    third = run_tasks(
        task, {key: series_b}, cfg, ORIGIN, workers=1, cache_dir=cache_dir
    )[0]
    assert third["backtest_cached"] is True
    assert json_safe(_strip(third)) == json_safe(_strip(second))


def test_corrupt_cache_file_is_ignored(cfg, tmp_path):
    cache_dir = tmp_path / "backtest-cache"
    series_a = _series(_frame(35 * 288 + 12 * 10), cfg)
    key = (series_a.city, series_a.station_id)
    cache_dir.mkdir()
    backtest_cache.cache_path(cache_dir, series_a).write_text("{nicht json")
    result = run_tasks(
        [("backtest", key, DAYS)],
        {key: series_a},
        cfg,
        ORIGIN,
        workers=1,
        cache_dir=cache_dir,
    )[0]
    assert result["ok"] and result["backtest_cached"] is False
    assert json.loads(backtest_cache.cache_path(cache_dir, series_a).read_text())[
        "fingerprint"
    ]
