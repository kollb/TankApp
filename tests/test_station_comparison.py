import copy
import json
from dataclasses import replace

import numpy as np
import pandas as pd
import pytest

from engine.cli import main
from engine.config import Config
from engine.station_comparison import compare_pair, polling_stations


def other(series):
    return replace(series, station_id="station-2", frame=series.frame.copy())


def test_equal_histories_are_only_a_manual_candidate(series):
    result = compare_pair(series, other(series), Config())
    assert result["classification"] == "possible_price_twins"
    assert result["agreement_pct"] == result["overlap_pct"] == 100
    assert result["qualifying_days"] == 35
    assert result["auto_apply"] is result["opening_hours_verified"] is False


def test_same_shape_with_price_offset_is_not_redundant(series):
    b = other(series)
    b.frame["price"] += 0.03
    result = compare_pair(series, b, Config())
    assert result["classification"] == "different_prices"
    assert result["mean_abs_delta_ct"] == pytest.approx(3.0)


def test_one_equal_poll_or_short_history_is_not_evidence(series):
    a, b = copy.deepcopy(series), other(series)
    cutoff = a.frame.index.min() + pd.Timedelta(days=2)
    a.frame = a.frame.loc[a.frame.index < cutoff]
    b.frame = b.frame.loc[b.frame.index < cutoff]
    assert compare_pair(a, b, Config())["classification"] == "insufficient_data"


def test_engine_fill_is_not_compared_as_an_extra_observation(series):
    b = other(series)
    valid = b.frame.index[b.frame.observed]
    b.frame.loc[valid[::2], "observed"] = False
    result = compare_pair(series, b, Config())
    assert result["common_points"] == int(b.frame.observed.sum())
    assert result["overlap_pct"] == pytest.approx(50)
    assert result["classification"] == "insufficient_data"


def test_known_opening_difference_prevents_twin_recommendation(series):
    b = other(series)
    point = b.frame.index[b.frame.observed][0]
    b.frame.loc[point, ["price", "observed", "status"]] = [np.nan, False, "closed"]
    result = compare_pair(series, b, Config())
    assert result["agreement_pct"] == 100
    assert result["status_conflicts"] == 1
    assert result["classification"] == "availability_differs"


def test_empty_or_disjoint_observations_are_not_equal_prices(series):
    b = other(series)
    b.frame["observed"] = False
    result = compare_pair(series, b, Config())
    assert result["classification"] == "insufficient_data"
    assert result["agreement_pct"] is None
    assert result["mean_abs_delta_ct"] is None


def test_different_markets_and_fuels_cannot_replace_each_other(series):
    with pytest.raises(ValueError, match="Kampagne"):
        compare_pair(series, replace(other(series), city="Elsewhere"), Config())
    with pytest.raises(ValueError, match="Sorte"):
        compare_pair(series, replace(other(series), fuel="DIESEL"), Config())


def make_polling(tmp_path, second=True):
    stations = (
        [
            {"uuid": "station-1", "name": "Aral Test", "brand": "ARAL", "dist_km": 1.0},
            {"uuid": "station-2", "name": "Aral Test", "brand": "ARAL", "dist_km": 3.0},
        ]
        if second
        else [{"uuid": "station-1", "brand": "ARAL"}]
    )
    path = tmp_path / "polling.json"
    path.write_text(
        json.dumps(
            {
                "sets": {
                    "test": {
                        "label": "Testmarkt",
                        "batch": [s["uuid"] for s in stations],
                        "stations": stations,
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    return path


def test_cli_compares_actual_ids_without_changing_polling(
    observations, tmp_path, capsys
):
    a = observations().drop(columns=["status", "source"])
    b = a.copy()
    b["station_id"] = "station-2"
    path = tmp_path / "history.csv.gz"
    pd.concat([a, b]).to_csv(path, index=False)
    polling = make_polling(tmp_path)
    original = polling.read_bytes()
    out = tmp_path / "report"
    assert (
        main(
            [
                "compare-stations",
                "--data",
                str(path),
                "--polling",
                str(polling),
                "--brand",
                "aral",
                "--poll-city",
                "test",
                "--out",
                str(out),
            ]
        )
        == 0
    )
    result = json.loads((out / "report.json").read_text(encoding="utf-8"))
    assert result["pairs"][0]["classification"] == "possible_price_twins"
    assert result["pairs"][0]["nearer_candidate"] == "station-1"
    assert result["pairs"][0]["known_status_comparisons"] == 0
    assert result["quality"]["sources"] == ["history"]
    assert result["auto_apply"] is False
    assert polling.read_bytes() == original
    text = (out / "report.md").read_text(encoding="utf-8")
    assert "Mögliche Preis-Zwillinge" in text
    assert "station-1" in text and "station-2" in text
    assert "keine automatische Auswahl" in capsys.readouterr().out


def test_missing_member_and_single_station_are_reported(observations, tmp_path, capsys):
    path = tmp_path / "input.csv"
    observations().to_csv(path, index=False)
    polling = make_polling(tmp_path)
    assert (
        main(
            [
                "compare-stations",
                "--data",
                str(path),
                "--polling",
                str(polling),
                "--out",
                str(tmp_path / "result"),
            ]
        )
        == 1
    )
    assert "station-2" in capsys.readouterr().err
    assert not (tmp_path / "result").exists()
    polling = make_polling(tmp_path, second=False)
    with pytest.raises(ValueError, match="zwei"):
        polling_stations(polling, "ARAL", None)


def test_brand_filter_does_not_assume_every_similar_name_is_the_same_brand(tmp_path):
    path = make_polling(tmp_path)
    payload = json.loads(path.read_text())
    payload["sets"]["test"]["stations"][1]["brand"] = "OTHER"
    path.write_text(json.dumps(payload))
    with pytest.raises(ValueError, match="zwei"):
        polling_stations(path, "ARAL", None)
