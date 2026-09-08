import csv
import datetime as dt
import gzip

from app.history import convert_day, open_csv, prepare_archive

UID = "00000000-0000-0000-0000-000000000001"
META = {UID: {"city": "Frankfurt", "name": "Station"}}
HEADER = "date,station_uuid,e10,e10change\n"


def test_archive_keeps_offsets_exact_events_and_removal_barriers(tmp_path):
    source = tmp_path / "prices.csv"
    source.write_text(
        HEADER
        + f"2026-10-25 02:03:07+02:00,{UID},1.7,1\n"
        + f"2026-10-25 02:03:07+01:00,{UID},1.8,1\n"
        + f"2026-10-25 03:05:00+01:00,{UID},1.8,0\n"
        + f"2026-10-25 03:07:00+01:00,{UID},0,2\n"
        + f"2026-10-25 04:02:00+01:00,{UID},1.6,3\n"
    )
    output = tmp_path / "normalized.csv.gz"
    stats = convert_day(source, output, META, ("e10",))
    with open_csv(output) as file:
        rows = list(csv.DictReader(file))
    assert len(rows) == 4  # flag 0 is not an additional price observation
    assert rows[0]["timestamp"] == "2026-10-25T00:03:07+00:00"
    assert rows[1]["timestamp"] == "2026-10-25T01:03:07+00:00"
    assert rows[0]["status"] == ""  # do not invent opening status
    assert rows[2]["status"] == "no prices" and rows[2]["price"] == ""
    assert rows[3]["price"] == "1.6"
    assert stats["barriers"] == 1


def test_naive_times_and_invalid_changed_prices_are_not_silently_reconstructed(
    tmp_path,
):
    source = tmp_path / "prices.csv"
    source.write_text(
        HEADER
        + f"2026-09-01 06:03:00,{UID},1.7,1\n"
        + f"2026-09-01 06:04:00+02:00,{UID},NaN,1\n"
        + f"2026-09-01 06:05:00+02:00,{UID},1.7,unknown\n"
    )
    output = tmp_path / "normalized.csv.gz"
    stats = convert_day(source, output, META, ("e10",))
    assert stats == {
        "events": 2,
        "barriers": 2,
        "invalid_timestamps": 1,
        "invalid_flags": 1,
    }
    with open_csv(output) as file:
        assert all(row["price"] == "" for row in csv.DictReader(file))


def test_archive_cache_skips_unchanged_raw_days_and_invalidates_on_selection(
    tmp_path, monkeypatch
):
    import app.history as history

    raw = tmp_path / "archive/prices/2026/09/2026-09-01-prices.csv.gz"
    raw.parent.mkdir(parents=True)
    with gzip.open(raw, "wt") as file:
        file.write(HEADER + f"2026-09-01 06:03:00+02:00,{UID},1.7,1\n")
    original = raw.read_bytes()
    metas = {("Frankfurt", UID): META[UID]}
    start, stop = dt.date(2026, 9, 1), dt.date(2026, 9, 3)
    cache = tmp_path / "cache"
    paths, quality = prepare_archive(
        tmp_path / "archive", metas, ("e10",), start, stop, cache
    )
    assert len(paths) == 1 and quality["missing_days"] == 1
    real = history.convert_day
    monkeypatch.setattr(
        history,
        "convert_day",
        lambda *a: (_ for _ in ()).throw(AssertionError("cached day reprocessed")),
    )
    assert (
        prepare_archive(tmp_path / "archive", metas, ("e10",), start, stop, cache)[0]
        == paths
    )
    monkeypatch.setattr(history, "convert_day", real)
    moved = {("Gütersloh", UID): {"city": "Gütersloh", "name": "Station"}}
    new_paths, _ = prepare_archive(
        tmp_path / "archive", moved, ("e10",), start, stop, cache
    )
    assert new_paths != paths
    assert raw.read_bytes() == original
