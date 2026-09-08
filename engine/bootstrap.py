"""Archive warm start and a conservative, auditable handover to polling.

Both paths carry Tankerkönig data. `source` denotes the acquisition path, not
an independent market feed. Never repair a polling outage with archive rows:
archive snapshots have no reliable opening-status/availability-time evidence.
"""

import os
import tempfile
from pathlib import Path

import pandas as pd

from .config import Config
from .data import scheduled
from .models import utc_time

COLUMNS = [
    "timestamp",
    "station_id",
    "city",
    "station_name",
    "fuel",
    "price",
    "status",
    "source",
]


def bootstrap(
    observations: pd.DataFrame,
    cfg: Config,
    at,
    live_only_days: int = 90,
    min_daily_coverage: float = 0.95,
) -> tuple[pd.DataFrame, dict]:
    """Accept normalized observations; return a CSV-safe view and its policy report.

    Decisions are per UUID/fuel, never per city or installation age. A partial
    current day does not count towards the handover. Coverage counts actual,
    usable responses, not forward-filled prices. All cutoffs are exclusive.
    """
    if not 7 <= live_only_days <= 366:
        raise ValueError("live_only_days muss zwischen 7 und 366 liegen.")
    if not 0 < min_daily_coverage <= 1:
        raise ValueError("min_daily_coverage muss größer 0 und höchstens 1 sein.")
    origin = utc_time(at, cfg.timezone)
    if pd.isna(origin):
        raise ValueError("Ungültiger Bootstrap-Cutoff.")
    local_end = origin.tz_convert(cfg.timezone).normalize()
    start = local_end - pd.DateOffset(days=live_only_days)
    grid = pd.date_range(start, local_end, freq="5min", inclusive="left")
    grid = grid[scheduled(grid, cfg)]
    # Latest scheduled bucket strictly before the cutoff, including at night.
    recent = pd.date_range(
        origin.ceil("5min") - pd.Timedelta(days=2),
        origin,
        freq="5min",
        inclusive="left",
    )
    expected_latest = recent[scheduled(recent, cfg)][-1]
    data = observations.copy()
    data["_bucket"] = data.timestamp.dt.ceil("5min")
    data = data.loc[data._bucket < origin].copy()
    if data.empty:
        raise ValueError("Keine Daten vor dem Bootstrap-Cutoff.")
    parts, stations = [], []
    for (station_id, fuel), group in data.groupby(["station_id", "fuel"], sort=True):
        # City is presentation metadata, never a second physical identity.
        cities = group.city.unique()
        if len(cities) != 1:
            raise ValueError(
                f"{station_id}: unterschiedliche Stadtlabels {sorted(cities)}. "
                "Historie und Export mit demselben Ankerlabel erzeugen."
            )
        live = group.loc[group.source.eq("influxdb")].sort_values("timestamp")
        archive = group.loc[~group.source.eq("influxdb")].copy()
        first_live = live._bucket.min() if len(live) else None
        latest = live.drop_duplicates("_bucket", keep="last").set_index("_bucket")
        usable = latest.status_known & (
            latest.status.eq("closed")
            | (latest.status.eq("open") & latest.price.notna())
        )
        coverage = pd.Series(grid.isin(latest.index[usable]), index=grid)
        daily = coverage.groupby(coverage.index.normalize()).mean()
        good_days = int(daily.ge(min_daily_coverage).sum())
        # A missing/invalid newest response must not be hidden by an older open one.
        newest = latest.iloc[-1] if len(latest) else None
        age = (
            max(0.0, (expected_latest - newest.timestamp).total_seconds() / 60)
            if newest is not None
            else None
        )
        fresh = bool(
            newest is not None and usable.iloc[-1] and age <= cfg.ffill_minutes
        )
        live_only = good_days == live_only_days and fresh
        if live_only:
            selected_archive = archive.iloc[:0]
            mode, reason = "live_only", "90-day-policy-passed"
            if live_only_days != 90:
                reason = "configured-day-policy-passed"
        else:
            # Ownership boundary at availability bucket: even a later archive row
            # in the first live bucket cannot resurrect a live closed/no-price state.
            selected_archive = (
                archive.loc[archive._bucket < first_live]
                if first_live is not None
                else archive
            )
            mode = "bootstrap" if len(live) else "history_only"
            reason = "insufficient-daily-live-coverage"
            if good_days == live_only_days and not fresh:
                reason = "latest-live-response-missing-invalid-or-stale"
        parts.extend([selected_archive, live])
        stations.append(
            {
                "station_id": station_id,
                "city": str(cities[0]),
                "fuel": fuel,
                "mode": mode,
                "reason": reason,
                "first_live_bucket": first_live.isoformat()
                if first_live is not None
                else None,
                "good_complete_live_days": good_days,
                "required_complete_live_days": live_only_days,
                "min_daily_coverage": min_daily_coverage,
                "worst_daily_coverage": float(daily.min()),
                "fresh_live": fresh,
                "live_age_minutes_at_last_scheduled_bucket": age,
                "history_rows_used": len(selected_archive),
                "live_rows_used": len(live),
                "history_rows_excluded": len(archive) - len(selected_archive),
            }
        )
    result = pd.concat(parts, ignore_index=True).sort_values("timestamp", kind="stable")
    # normalize_observations defaults missing status to open internally. Do NOT
    # serialize that default as known opening-status evidence on the next load.
    result.loc[~result.status_known, "status"] = pd.NA
    report = {
        "schema_version": 1,
        "at": origin.isoformat(),
        "market_data_provider": "Tankerkönig",
        "coverage_window_start": start.isoformat(),
        "coverage_window_end_exclusive": local_end.isoformat(),
        "policy": "archive-prefix-then-polling; no archive repair of live gaps",
        "calibrated": False,
        "decision_ready": False,
        "historical_backtest_is_operational_replay": False,
        "stations": stations,
    }
    return result[COLUMNS], report


def write_csv(path: Path, data: pd.DataFrame) -> None:
    """Replace only after a complete write, including on Windows; optional gzip."""
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, suffix=".tmp", delete=False
        ) as f:
            name = f.name
        data.to_csv(
            name, index=False, compression="gzip" if path.suffix == ".gz" else None
        )
        os.replace(name, path)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)
