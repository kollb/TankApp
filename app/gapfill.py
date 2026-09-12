"""Polling-Lücken automatisch aus dem Tankerkönig-Archiv schließen.

Der Archiv-Job lädt stündlich die nationalen Tagesdateien nach
(``settings.archive``); dieser Baustein nutzt sie gezielt: Er erkennt
geschlossene Lücken im Live-Export (z. B. gestern 12–13 Uhr), schneidet die
echten Archiv-Ereignisse auf genau diese Fenster zu und legt sie dem
Training als zusätzliche History-Quelle bei.

Grundsätze (keine erfundenen Daten):
- Nur echte Archiv-Ereignisse (``app/history.py::convert_day``) — niemals
  Interpolation oder Forward-Fill über die Lücke hinaus.
- Nur geschlossene Lücken (beide Ränder beobachtet); die offene Flanke am
  Datenrand bleibt Live-Sache.
- Nur vergangene Tage: Das Archiv kennt nur Vergangenheit; Lücken von heute
  fallen weg — sie gehören dem Live-Betrieb, nicht dem Archiv.
- Nur innerhalb des Polling-Fensters (``poll_start``–``poll_end``): Die
  Nacht ist Sammelpause, keine Lücke.
- Live hat immer Vorrang: Archiv-Zeilen tragen ``source=history`` und
  verlieren im Engine-Dedup gegen jeden Live-Poll desselben Zeitpunkts.
"""

import csv
import datetime as dt
import gzip
from pathlib import Path

# Lücke ab 3× Soll-Takt, mindestens 15 Minuten — darunter ist es Jitter,
# kein Ausfall. Segmente unter 15 Minuten nach dem Zuschneiden auf
# Polling-Fenster/Tagesgrenzen fallen ebenfalls weg (keine Splitter).
MIN_GAP_MINUTES = 15
GAP_FACTOR = 3


def _segments_in_poll_window(start, end, cfg, today):
    """Geschlossene Lücke auf Polling-Fenster und vergangene Tage zuschneiden.

    Liefert UTC-Segmente ``[(lo, hi), ...]`` — je lokaler Tag höchstens eins.
    """
    import pandas as pd

    tz = cfg.timezone
    local_start = start.tz_convert(tz)
    local_end = end.tz_convert(tz)
    day = local_start.date()
    last = min(local_end.date(), today - dt.timedelta(days=1))
    segments = []
    while day <= last:
        midnight = pd.Timestamp(day, tz=tz)
        lower = max(local_start, midnight + pd.Timedelta(hours=cfg.poll_start))
        upper = min(local_end, midnight + pd.Timedelta(hours=cfg.poll_end))
        if (upper - lower) >= pd.Timedelta(minutes=MIN_GAP_MINUTES):
            segments.append((lower.tz_convert("UTC"), upper.tz_convert("UTC")))
        day += dt.timedelta(days=1)
    return segments


def detect_gaps(live, cfg, cadence_minutes, origin):
    """Geschlossene Polling-Lücken je Station erkennen.

    ``live`` ist der normalisierte Live-Export einer Fuel
    (``engine.data.load_observations``). Ergebnis: ``{station_id: [(lo, hi),
    ...]}`` mit UTC-Segmenten — bereits auf Polling-Fenster und vergangene
    Tage zugeschnitten, nach Station sortiert.
    """
    threshold = max(MIN_GAP_MINUTES, GAP_FACTOR * cadence_minutes)
    today = origin.tz_convert(cfg.timezone).date()
    gaps: dict[str, list] = {}
    if live.empty:
        return gaps
    for station_id, group in live.groupby("station_id"):
        stamps = group["timestamp"].sort_values().reset_index(drop=True)
        for previous, current in zip(stamps[:-1], stamps[1:]):
            if (current - previous).total_seconds() < threshold * 60:
                continue
            for segment in _segments_in_poll_window(previous, current, cfg, today):
                gaps.setdefault(str(station_id), []).append(segment)
    return {key: gaps[key] for key in sorted(gaps)}


def fill_gaps(
    settings, cfg, metas, fuels, live_by_fuel, origin, cadence_minutes, progress=None
):
    """Lückenfenster mit Archiv-Ereignissen füllen; gibt (Pfade, Qualität) zurück.

    Legt je Fuel mit mindestens einem Treffer eine Datei
    ``runtime/gapfill/gapfill_<fuel>.csv.gz`` im History-Format an (nur
    Ereignisse innerhalb der Fenster, nur Vergangenheit). Leere Füllung →
    keine Datei, ehrliche Nullen in der Qualität.
    """
    from .history import event_time, prepare_archive

    gaps: dict[str, list] = {}
    for fuel in fuels:
        live = live_by_fuel.get(fuel)
        if live is None or live.empty:
            continue
        for station_id, windows in detect_gaps(
            live, cfg, cadence_minutes, origin
        ).items():
            have = {
                (lo.isoformat(), hi.isoformat()) for lo, hi in gaps.get(station_id, [])
            }
            for window in windows:
                key = (window[0].isoformat(), window[1].isoformat())
                if key not in have:
                    gaps.setdefault(station_id, []).append(window)
                    have.add(key)
    quality = {
        "gaps_detected": sum(len(windows) for windows in gaps.values()),
        "gap_days": [],
        "gap_events": 0,
        "gaps_filled": 0,
        "gaps_without_events": 0,
        "missing_days": 0,
        "files": [],
    }
    if not gaps:
        return [], quality
    days = set()
    for windows in gaps.values():
        for lower, _ in windows:
            days.add(lower.tz_convert(cfg.timezone).date())
    day_min, day_max = min(days), max(days)
    paths, archive_quality = prepare_archive(
        settings.archive,
        metas,
        tuple(fuels),
        day_min,
        day_max + dt.timedelta(days=1),
        settings.runtime / "archive-cache",
    )
    quality["missing_days"] = archive_quality.get("missing_days", 0)
    quality["gap_days"] = [day.isoformat() for day in sorted(days)]
    rows_by_fuel: dict[str, list] = {fuel: [] for fuel in fuels}
    by_upper = {fuel.upper(): fuel for fuel in fuels}
    filled = set()
    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
            for raw in csv.DictReader(handle):
                station_id = (raw.get("station_id") or "").strip()
                windows = gaps.get(station_id)
                if not windows:
                    continue
                stamp = event_time(raw.get("timestamp"))
                if stamp is None:
                    continue
                for lower, upper in windows:
                    if lower <= stamp < upper:
                        filled.add((station_id, lower.isoformat(), upper.isoformat()))
                        fuel = (raw.get("fuel") or "").upper()
                        if fuel in by_upper:
                            rows_by_fuel[by_upper[fuel]].append(raw)
                        break
    quality["gaps_filled"] = len(filled)
    quality["gaps_without_events"] = quality["gaps_detected"] - len(filled)
    out_dir = settings.runtime / "gapfill"
    out_paths = []
    for fuel in fuels:
        rows = rows_by_fuel.get(fuel, [])
        if not rows:
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        destination = out_dir / f"gapfill_{fuel}.csv.gz"
        _write_gapfill(destination, rows)
        out_paths.append(destination)
        quality["gap_events"] += len(rows)
        quality["files"].append(destination.name)
    if progress:
        progress.note(
            f"Lückenfüllung: {quality['gaps_filled']} von "
            f"{quality['gaps_detected']} Lücken mit "
            f"{quality['gap_events']} Archiv-Ereignissen geschlossen"
            + (
                f" ({quality['missing_days']} Archivtage fehlend)"
                if quality["missing_days"]
                else ""
            )
        )
    print(
        f"models: Lückenfüllung: {quality['gaps_filled']}/"
        f"{quality['gaps_detected']} Lücken, {quality['gap_events']} Ereignisse, "
        f"Tage {', '.join(quality['gap_days']) or '–'}",
        flush=True,
    )
    return out_paths, quality


def _write_gapfill(destination: Path, rows: list) -> None:
    from .history import COLUMNS

    destination.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(destination, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        for raw in rows:
            writer.writerow({key: raw.get(key, "") for key in COLUMNS})
