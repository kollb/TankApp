import argparse
import csv
import importlib.util
import sys
from pathlib import Path

import pytest


@pytest.fixture
def pipeline():
    path = Path(__file__).resolve().parents[1] / "data-tools/run_pipeline.py"
    spec = importlib.util.spec_from_file_location("test_poll_pipeline", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def scores(tmp_path):
    path = tmp_path / "scores.csv"
    rows = []
    for idx in range(5):
        rows.append(
            {
                "station_id": f"station-{idx}",
                "station_name": f"Station {idx}",
                "brand": f"brand-{idx}",
                "city": "Test",
                "lat": 0.01 * (idx + 1),
                "lon": 0,
                "delta_ct": -2,
                "net_per_fill_eur": 1,
                "net_fuel_only_eur": 2,
                "q_value": 0.01,
                "significant": "True",
            }
        )
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0])
        writer.writeheader()
        writer.writerows(rows)
    return path


def build(pipeline, path, exclude=None):
    return pipeline.build_polling_set(
        path,
        "Test",
        0,
        0,
        near_km=10,
        near_n=3,
        leader_n=0,
        poll_size=3,
        fuel="E10",
        exclude_uuids=exclude,
    )


def test_excluded_uuid_is_replaced_by_next_eligible_candidate(pipeline, tmp_path):
    path = scores(tmp_path)
    original = path.read_bytes()
    before = build(pipeline, path)
    after = build(pipeline, path, {"station-1"})
    assert [s["uuid"] for s in before["stations"]] == [
        "station-0",
        "station-1",
        "station-2",
    ]
    assert [s["uuid"] for s in after["stations"]] == [
        "station-0",
        "station-2",
        "station-3",
    ]
    assert after["excluded_uuids"] == ["station-1"]
    assert "VORSCHLAG" in after["rule"]
    assert path.read_bytes() == original


def test_unknown_exclusion_fails_instead_of_silently_keeping_station(
    pipeline, tmp_path
):
    with pytest.raises(SystemExit, match="UUIDs"):
        build(pipeline, scores(tmp_path), {"typo"})


def test_constraints_are_not_relaxed_to_fill_all_slots(pipeline, tmp_path):
    result = build(
        pipeline, scores(tmp_path), {"station-1", "station-2", "station-3", "station-4"}
    )
    assert [s["uuid"] for s in result["stations"]] == ["station-0"]


def test_all_excluded_fails_without_rewriting_any_inputs(pipeline, tmp_path):
    with pytest.raises(SystemExit, match="keine Kandidaten"):
        build(pipeline, scores(tmp_path), {f"station-{n}" for n in range(5)})


def test_exclusions_require_separate_proposal_directory(pipeline, tmp_path):
    args = argparse.Namespace(
        exclude_uuid=["station-1"], out_stations=pipeline.DEFAULT_OUT_STATIONS
    )
    with pytest.raises(SystemExit, match="Vorschlag"):
        pipeline.validate_proposal_target(args)
    args.out_stations = tmp_path / "proposal"
    pipeline.validate_proposal_target(args)
    assert not args.out_stations.exists()
    args.exclude_uuid = []
    args.out_stations = pipeline.DEFAULT_OUT_STATIONS
    pipeline.validate_proposal_target(args)


def test_step_poll_writes_only_marked_proposal_and_keeps_active_set(
    pipeline, tmp_path, monkeypatch
):
    import json

    results = tmp_path / "results"
    results.mkdir()
    scores(results).rename(results / "station_scores_e10.csv")
    monkeypatch.setattr(pipeline, "RESULTS", results)
    active = tmp_path / "active"
    active.mkdir()
    (active / "polling.json").write_text("existing active set", encoding="utf-8")
    monkeypatch.setattr(pipeline, "DEFAULT_OUT_STATIONS", active)
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"home": {"Test": [0, 0]}}), encoding="utf-8")
    proposal = tmp_path / "proposal"
    args = argparse.Namespace(
        skip_poll=False,
        skip_select=False,
        config=config,
        poll_city="Test",
        fuel="e10",
        leader_n=0,
        leader_max_km=12,
        near_n=3,
        near_km=10,
        poll_size=3,
        router="haversine",
        out_stations=proposal,
        radius=25,
        step_min=30,
        exclude_uuid=["station-1"],
    )
    pipeline.step_poll(args)
    payload = json.loads((proposal / "polling.json").read_text(encoding="utf-8"))
    assert payload["proposal"] is True
    assert payload["excluded_uuids"] == ["station-1"]
    assert payload["sets"]["Test"]["batch"] == ["station-0", "station-2", "station-3"]
    assert (active / "polling.json").read_text(
        encoding="utf-8"
    ) == "existing active set"
    assert "VORSCHLAG" in (proposal / "polling_test.md").read_text(encoding="utf-8")


def test_new_city_cannot_erase_existing_polling_set(pipeline, tmp_path):
    import json

    target = tmp_path / "polling.json"
    target.write_text(json.dumps({"sets": {"Frankfurt": {"batch": ["existing"]}}}))
    original = target.read_bytes()
    args = argparse.Namespace(
        out_stations=tmp_path, poll_city="Gütersloh", skip_poll=False
    )
    with pytest.raises(SystemExit, match="andere Städte"):
        pipeline.validate_polling_target(args)
    assert target.read_bytes() == original
    args.poll_city = "Frankfurt"
    pipeline.validate_polling_target(args)
    args.poll_city = "Gütersloh"
    args.skip_poll = True
    pipeline.validate_polling_target(args)


def test_malformed_polling_set_is_not_overwritten(pipeline, tmp_path):
    (tmp_path / "polling.json").write_text("broken")
    args = argparse.Namespace(out_stations=tmp_path, poll_city="Gütersloh")
    with pytest.raises(SystemExit, match="ungültig"):
        pipeline.validate_polling_target(args)
