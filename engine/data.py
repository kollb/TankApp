"""Read real CSV observations, preserving status barriers and information time.

Nothing in this module estimates statistics from future prices. Grid labels are
*availability* times (ceiling, not flooring); a 06:03 poll cannot inform 06:00.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .config import Config

REQUIRED = {"timestamp", "station_id", "city", "fuel", "price"}
OPTIONAL = {"status", "source", "station_name"}


def parse_times(values: pd.Series, timezone: str) -> pd.Series:
    """Offset timestamps are absolute; legacy naive history is Berlin time.

    Legacy files lost their DST offset. Ambiguous/nonexistent wall times are
    deliberately NaT rather than assigning invented UTC instants.
    """
    text = values.astype("string").str.strip()
    aware = text.str.contains(r"(?:Z|[+-]\d{2}:?\d{2})$", case=False, na=False)
    out = pd.Series(pd.NaT, index=values.index, dtype="datetime64[ns, UTC]")
    out.loc[aware] = pd.to_datetime(
        text[aware], format="mixed", errors="coerce", utc=True
    )
    naive = pd.to_datetime(text[~aware], format="mixed", errors="coerce")
    out.loc[~aware] = naive.dt.tz_localize(
        timezone, ambiguous="NaT", nonexistent="NaT"
    ).dt.tz_convert("UTC")
    return out


def normalize_observations(raw: pd.DataFrame, cfg: Config) -> tuple[pd.DataFrame, dict]:
    missing = REQUIRED - set(raw.columns)
    if missing:
        raise ValueError(f"CSV-Spalten fehlen: {', '.join(sorted(missing))}")
    df = raw.copy()
    quality = {"input_rows": len(df)}
    for col in ("station_id", "city", "fuel"):
        df[col] = df[col].fillna("").astype(str).str.strip()
        if df[col].eq("").any():
            raise ValueError(f"Leere Werte in Pflichtspalte {col}.")
    df["fuel"] = df.fuel.str.upper()
    if not df.fuel.isin(["E5", "E10", "DIESEL"]).all():
        raise ValueError("Unbekannter Kraftstoff; erwartet E5, E10 oder DIESEL.")
    df["timestamp"] = parse_times(df.timestamp, cfg.timezone)
    quality["invalid_or_ambiguous_timestamps"] = int(df.timestamp.isna().sum())
    df = df.loc[df.timestamp.notna()].copy()
    if df.empty:
        raise ValueError(
            "Keine gültigen Zeitstempel (UTC-Offset bzw. Zeitzone prüfen)."
        )
    df["status_known"] = df.get(
        "status", pd.Series(index=df.index, dtype="string")
    ).notna()
    status = df.get("status", pd.Series("open", index=df.index)).fillna("open")
    df["status"] = status.astype(str).str.strip().str.lower()
    df["status_known"] &= df.status.ne("")
    df.loc[df.status.eq(""), "status"] = "open"
    df["source"] = df.get("source", pd.Series("history", index=df.index)).fillna(
        "history"
    )
    df["source"] = df.source.astype(str).str.strip().str.lower()
    if df.source.str.contains(r"demo|synthetic|sample", regex=True).any():
        raise ValueError(
            "Demo-/synthetische Daten sind kein Eingang für die Echt-Daten-Engine."
        )
    df["station_name"] = df.get("station_name", df.station_id).fillna(df.station_id)
    # A bad/missing price is still an observation: it must stop forward fill.
    price = pd.to_numeric(df.price, errors="coerce")
    valid_price = (price.between(0.4, 5.0) & np.isfinite(price)).fillna(False)
    # bool True is a Python number, but is never a fuel price.
    valid_price &= ~df.price.map(lambda value: isinstance(value, (bool, np.bool_)))
    quality["invalid_open_prices"] = int((~valid_price & df.status.eq("open")).sum())
    df["price"] = price.where(valid_price & df.status.eq("open"))
    quality["rows_without_status"] = int((~df.status_known).sum())
    # Explicit live status wins over an overlapping legacy history file, in
    # either file order. Within the same source the last input row wins.
    df["_priority"] = df.status_known.astype(int) + 2 * df.source.eq("influxdb").astype(
        int
    )
    keys = ["city", "station_id", "fuel", "timestamp"]
    before = len(df)
    df = df.sort_values(keys + ["_priority"], kind="stable").drop_duplicates(
        keys, keep="last"
    )
    quality["duplicates_removed"] = before - len(df)
    df = (
        df.drop(columns="_priority")
        .sort_values("timestamp", kind="stable")
        .reset_index(drop=True)
    )
    quality["rows"] = len(df)
    quality["sources"] = sorted(df.source.unique().tolist())
    quality["first_timestamp"] = df.timestamp.min().isoformat()
    quality["last_timestamp"] = df.timestamp.max().isoformat()
    return df, quality


def load_observations(
    paths: list[Path],
    cfg: Config,
    fuel: str = "E10",
    station_ids: set[str] | None = None,
) -> tuple[pd.DataFrame, dict]:
    chunks = []
    for path in paths:
        for chunk in pd.read_csv(
            path,
            usecols=lambda col: col in REQUIRED | OPTIONAL,
            dtype="string",
            chunksize=200_000,
        ):
            if "fuel" not in chunk:
                raise ValueError(f"{path.name}: Spalte fuel fehlt.")
            chunk = chunk.loc[chunk.fuel.str.upper().eq(fuel.upper())]
            if station_ids is not None:
                if "station_id" not in chunk:
                    raise ValueError(f"{path.name}: Spalte station_id fehlt.")
                chunk = chunk.loc[chunk.station_id.isin(station_ids)]
            if not chunk.empty:
                chunks.append(chunk)
    if not chunks:
        raise ValueError(f"Keine Daten für {fuel} / die gewählten Stationen gefunden.")
    return normalize_observations(pd.concat(chunks, ignore_index=True), cfg)


@dataclass
class PriceSeries:
    city: str
    station_id: str
    station_name: str
    fuel: str
    frame: pd.DataFrame

    def identity(self) -> dict:
        return {
            key: getattr(self, key)
            for key in ("city", "station_id", "station_name", "fuel")
        }


def prepare_series(observations: pd.DataFrame, cfg: Config) -> list[PriceSeries]:
    result = []
    for (city, station_id, fuel), group in observations.groupby(
        ["city", "station_id", "fuel"], sort=True
    ):
        group = group.sort_values("timestamp", kind="stable").copy()
        name = str(group.station_name.iloc[-1])
        group["available_at"] = group.timestamp.dt.ceil(f"{cfg.step_minutes}min")
        # Last *row*, not last non-null value: closed/no-prices/unsupported fuel
        # must not resurrect the preceding open price.
        group = group.drop_duplicates("available_at", keep="last").set_index(
            "available_at"
        )
        grid = pd.date_range(
            group.index.min(), group.index.max(), freq=f"{cfg.step_minutes}min"
        )
        state = group.reindex(grid, method="ffill")
        age = (pd.Series(grid, index=grid) - state.timestamp).dt.total_seconds() / 60
        fresh = age.le(cfg.ffill_minutes)
        valid = fresh & state.status.eq("open") & state.price.notna()
        frame = pd.DataFrame(
            {
                "price": state.price.where(valid).astype(float),
                "observed": grid.isin(group.index) & valid,
                "response_observed": grid.isin(group.index),
                "available": fresh,
                "status": state.status.where(fresh, "stale"),
                "status_known": state.status_known & fresh,
                "source": state.source,
                "age_minutes": age,
                "observed_at": state.timestamp.where(fresh),
            },
            index=grid,
        )
        frame.index.name = "timestamp"
        result.append(PriceSeries(city, station_id, name, fuel, frame))
    return result


def scheduled(index: pd.DatetimeIndex, cfg: Config) -> np.ndarray:
    hours = index.tz_convert(cfg.timezone).hour
    return np.asarray((hours >= cfg.poll_start) & (hours < cfg.poll_end))


def describe(series: PriceSeries, cfg: Config) -> dict:
    frame = series.frame
    active = frame.loc[scheduled(frame.index, cfg)]
    return {
        **series.identity(),
        "first_grid_time": frame.index.min().isoformat(),
        "last_grid_time": frame.index.max().isoformat(),
        "open_days": int(
            frame.loc[frame.price.notna()]
            .index.tz_convert(cfg.timezone)
            .normalize()
            .nunique()
        ),
        "observed_prices": int(frame.observed.sum()),
        "filled_prices": int((frame.price.notna() & ~frame.observed).sum()),
        "scheduled_buckets": len(active),
        "response_coverage_pct": 100 * float(active.response_observed.mean())
        if len(active)
        else None,
        "usable_coverage_pct": 100 * float(active.available.mean())
        if len(active)
        else None,
        "unknown_status_buckets": int((~frame.status_known & frame.available).sum()),
    }
