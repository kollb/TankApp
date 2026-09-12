"""Polling-Lücken werden automatisch aus dem Archiv geschlossen (echte Events)."""

import csv
import datetime as dt
from pathlib import Path

import pandas as pd

from app.gapfill import detect_gaps, fill_gaps
from engine.config import Config


def frame(stamps, station="uuid-1"):
    return pd.DataFrame(
        {
            "timestamp": pd.DatetimeIndex(list(stamps), tz="UTC"),
            "station_id": [station] * len(list(stamps)),
        }
    )


def stamps_berlin(day, *hours_minutes):
    tz = "Europe/Berlin"
    return [
        pd.Timestamp(dt.datetime.combine(day, dt.time(h, m)), tz=tz).tz_convert("UTC")
        for h, m in hours_minutes
    ]


def test_midday_gap_is_detected_with_exact_window():
    cfg = Config()
    origin = pd.Timestamp("2026-09-11 12:00", tz="Europe/Berlin").tz_convert("UTC")
    # Polls alle 5 Minuten, Lücke 12:00–13:00 Berlin.
    stamps = []
    minute = dt.datetime(2026, 9, 10, 6, 0)
    while minute <= dt.datetime(2026, 9, 10, 23, 55):
        if not (dt.time(12, 0) <= minute.time() < dt.time(13, 0)):
            stamps.append(pd.Timestamp(minute, tz="Europe/Berlin").tz_convert("UTC"))
        minute += dt.timedelta(minutes=5)
    gaps = detect_gaps(frame(stamps), cfg, 5, origin)
    assert list(gaps) == ["uuid-1"]
    assert len(gaps["uuid-1"]) == 1
    lower, upper = gaps["uuid-1"][0]
    # Fenster zwischen letztem und nächstem Poll (11:55 → 13:00); der
    # Live-Poll an den Rändern behält im Engine-Dedup ohnehin Vorrang.
    assert lower.tz_convert("Europe/Berlin").strftime("%H:%M") == "11:55"
    assert upper.tz_convert("Europe/Berlin").strftime("%H:%M") == "13:00"


def test_night_jitter_and_open_end_are_no_gaps():
    cfg = Config()
    origin = pd.Timestamp("2026-09-11 12:00", tz="Europe/Berlin").tz_convert("UTC")
    # Voller Vortag im 5-Minuten-Takt (mit 10-Minuten-Jitter mittags),
    # Nachtpause 23:55 → 06:05, offenes Ende heute früh.
    stamps = []
    minute = dt.datetime(2026, 9, 10, 6, 0)
    skip = pd.Timestamp("2026-09-10 10:05", tz="Europe/Berlin").tz_convert("UTC")
    while minute <= dt.datetime(2026, 9, 10, 23, 55):
        stamp = pd.Timestamp(minute, tz="Europe/Berlin").tz_convert("UTC")
        if stamp != skip:
            stamps.append(stamp)
        minute += dt.timedelta(minutes=5)
    stamps += stamps_berlin(dt.date(2026, 9, 11), (6, 5), (6, 10))
    gaps = detect_gaps(frame(stamps), cfg, 5, origin)
    assert gaps == {}


def test_today_gap_is_ignored_archive_knows_only_past():
    cfg = Config()
    origin = pd.Timestamp("2026-09-11 12:00", tz="Europe/Berlin").tz_convert("UTC")
    stamps = stamps_berlin(dt.date(2026, 9, 11), (8, 0), (9, 30))
    assert detect_gaps(frame(stamps), cfg, 5, origin) == {}


def write_raw_archive_day(directory: Path, day: dt.date, station: str):
    """Minimale Roh-Tagesdatei im Tankerkönig-Format (change-Flags)."""
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{day.isoformat()}-prices.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "date",
                "station_uuid",
                "e10",
                "e10change",
                "diesel",
                "dieselchange",
            ],
        )
        writer.writeheader()
        # Ereignis mitten in der Lücke + eins davor (darf nicht übernommen werden).
        writer.writerow(
            {
                "date": "2026-09-10T12:30:00+02:00",
                "station_uuid": station,
                "e10": "1.689",
                "e10change": "1",
                "diesel": "1.589",
                "dieselchange": "0",
            }
        )
        writer.writerow(
            {
                "date": "2026-09-10T10:00:00+02:00",
                "station_uuid": station,
                "e10": "1.699",
                "e10change": "1",
                "diesel": "1.599",
                "dieselchange": "0",
            }
        )
    return path


def test_fill_gaps_clips_events_to_gap_window(tmp_path):
    from types import SimpleNamespace

    cfg = Config()
    station = "uuid-1"
    origin = pd.Timestamp("2026-09-11 12:00", tz="Europe/Berlin").tz_convert("UTC")
    archive = tmp_path / "archive" / "prices"
    write_raw_archive_day(archive, dt.date(2026, 9, 10), station)
    settings = SimpleNamespace(
        archive=tmp_path / "archive", runtime=tmp_path / "runtime"
    )
    metas = {("Frankfurt", station): {"city": "Frankfurt", "name": "Test"}}
    stamps = stamps_berlin(dt.date(2026, 9, 10), (11, 55), (13, 5))
    live = frame(stamps, station)
    paths, quality = fill_gaps(settings, cfg, metas, ["e10"], {"e10": live}, origin, 5)
    assert quality["gaps_detected"] == 1
    assert quality["gaps_filled"] == 1
    assert quality["gap_events"] == 1
    assert len(paths) == 1
    import gzip

    with gzip.open(paths[0], "rt", encoding="utf-8") as handle:
        content = handle.read()
    assert "2026-09-10T10:30:00+00:00" in content  # 12:30 Berlin, in Lücke
    assert "1.689" in content
    assert "08:00" not in content  # 10:00 Berlin liegt vor der Lücke


def test_fill_gaps_without_gaps_writes_nothing(tmp_path):
    from types import SimpleNamespace

    cfg = Config()
    origin = pd.Timestamp("2026-09-11 12:00", tz="Europe/Berlin").tz_convert("UTC")
    settings = SimpleNamespace(
        archive=tmp_path / "archive", runtime=tmp_path / "runtime"
    )
    frames = frame(stamps_berlin(dt.date(2026, 9, 10), (12, 0), (12, 5)))
    paths, quality = fill_gaps(settings, cfg, {}, ["e10"], {"e10": frames}, origin, 5)
    assert paths == []
    assert quality["gaps_detected"] == 0
    assert not (tmp_path / "runtime" / "gapfill").exists()
