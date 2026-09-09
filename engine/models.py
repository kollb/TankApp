"""M3 first increment: robust daily structure + stable AR(2) residual follow-up.

Residual day blocks provide explicitly *uncalibrated* bootstrap intervals.
These are not ACI, not live probabilities, and never an automatic release gate.
"""

import warnings

import numpy as np
import pandas as pd

from .config import Config
from .data import PriceSeries

QUANTILES = (0.025, 0.10, 0.50, 0.90, 0.975)
Q_COLUMNS = ("q025", "q10", "q50", "q90", "q975")
SCHEMA_VERSION = 1


def utc_time(value, timezone: str = "Europe/Berlin") -> pd.Timestamp:
    result = pd.Timestamp(value)
    if pd.isna(result):
        raise ValueError("Ungültiger Zeitpunkt.")
    if result.tzinfo is None:
        result = result.tz_localize(timezone, ambiguous="NaT", nonexistent="NaT")
        if pd.isna(result):
            raise ValueError(
                "Mehrdeutige/nicht existente lokale Zeit; UTC-Offset explizit angeben."
            )
    return result.tz_convert("UTC")


def calendar_before(origin: pd.Timestamp, days: int, cfg: Config) -> pd.Timestamp:
    """Past local-day boundary; clamp DST holes, prefer the later repeated hour.

    This only defines a training boundary, never manufactures observations.
    Actual price comparisons at ambiguous legacy wall times remain masked.
    """
    naive = origin.tz_convert(cfg.timezone).tz_localize(None) - pd.DateOffset(days=days)
    return naive.tz_localize(
        cfg.timezone, ambiguous=False, nonexistent="shift_forward"
    ).tz_convert("UTC")


def slots(index: pd.DatetimeIndex, cfg: Config) -> np.ndarray:
    local = index.tz_convert(cfg.timezone)
    return np.asarray((local.hour * 60 + local.minute) // cfg.step_minutes)


def features(index: pd.DatetimeIndex, cfg: Config) -> np.ndarray:
    local = index.tz_convert(cfg.timezone)
    hour = np.asarray(local.hour + local.minute / 60)
    columns = [np.ones(len(index))]
    for harmonic in (1, 2):
        angle = 2 * np.pi * harmonic * hour / 24
        columns.extend([np.cos(angle), np.sin(angle)])
    columns.extend(
        [np.asarray(local.dayofweek == day, dtype=float) for day in range(1, 7)]
    )
    return np.column_stack(columns)


def huber_fit(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    beta = np.linalg.lstsq(x, y, rcond=None)[0]
    for _ in range(30):
        residual = y - x @ beta
        scale = max(
            1.4826 * float(np.median(np.abs(residual - np.median(residual)))), 0.0005
        )
        weight = np.minimum(1.0, 1.345 * scale / np.maximum(np.abs(residual), 1e-12))
        root = np.sqrt(weight)
        updated = np.linalg.lstsq(x * root[:, None], y * root, rcond=None)[0]
        if np.max(np.abs(updated - beta)) < 1e-8:
            return updated
        beta = updated
    return beta


def fit_ar2(residual: np.ndarray) -> np.ndarray:
    """Yule-Walker using only contiguous valid triples, never across closures.

    Pairwise covariance estimates with missing observations need not be positive
    definite. Shrink coefficients toward zero until the recursion is stable.
    """
    if len(residual) < 3:
        return np.zeros(2)
    triples = np.lib.stride_tricks.sliding_window_view(residual, 3)
    triples = triples[np.isfinite(triples).all(axis=1)]
    if len(triples) < 30:
        return np.zeros(2)
    r0 = np.mean(triples**2)
    if r0 < 1e-12:
        return np.zeros(2)
    r1 = np.mean((triples[:, 0] * triples[:, 1] + triples[:, 1] * triples[:, 2]) / 2)
    r2 = np.mean(triples[:, 0] * triples[:, 2])
    matrix = np.array([[r0, r1], [r1, r0]]) + np.eye(2) * r0 * 1e-6
    phi = np.linalg.solve(matrix, [r1, r2])
    for _ in range(100):
        if np.max(np.abs(np.roots([1, -phi[0], -phi[1]]))) < 0.98:
            return phi
        phi *= 0.9
    return np.zeros(2)


def seasonal_scale(price: pd.Series, cfg: Config) -> float | None:
    """Standard seasonal MASE denominator, estimated on training data only."""
    local = price.index.tz_convert(cfg.timezone).tz_localize(None)
    previous = (
        (local - pd.Timedelta(days=1))
        .tz_localize(cfg.timezone, ambiguous="NaT", nonexistent="NaT")
        .tz_convert("UTC")
    )
    lagged = price.reindex(previous).to_numpy()
    error = np.abs(price.to_numpy() - lagged)
    error = error[np.isfinite(error)]
    scale = float(error.mean()) if len(error) else 0
    return scale if scale > 1e-8 else None


def fit(series: PriceSeries, origin, cfg: Config) -> dict:
    origin = utc_time(origin, cfg.timezone)
    if origin != origin.floor(f"{cfg.step_minutes}min"):
        raise ValueError("Fit-Cutoff muss auf dem 5-Minuten-Raster liegen.")
    start = calendar_before(origin, cfg.train_days, cfg)
    # Reindex to the full training range so trailing outages reset AR state.
    index = pd.date_range(
        start, origin, freq=f"{cfg.step_minutes}min", inclusive="left"
    )
    frame = series.frame.reindex(index)
    price = frame.price
    valid = price.notna().to_numpy()
    days = price.index[valid].tz_convert(cfg.timezone).normalize().nunique()
    if days < cfg.min_train_days or valid.sum() < cfg.min_train_days * 24:
        raise ValueError(
            f"{series.station_id}: nur {days} nutzbare Tage mit "
            f"{int(valid.sum())} offenen 5-Minuten-Preisen in "
            f"{cfg.train_days} Tagen; mindestens {cfg.min_train_days} Tage "
            f"mit {cfg.min_train_days * 24} Punkten erforderlich."
        )
    x = features(index, cfg)
    beta = huber_fit(x[valid], price.to_numpy()[valid])
    residual = price.to_numpy() - x @ beta
    phi = fit_ar2(residual)
    # [epsilon(t-1), epsilon(t-2)] at the forecast origin. No stale carryover.
    state = residual[-2:][::-1] if np.isfinite(residual[-2:]).all() else np.zeros(2)
    local_days = index.tz_convert(cfg.timezone).strftime("%Y-%m-%d")
    blocks = pd.DataFrame(
        {"day": local_days, "slot": slots(index, cfg), "error": residual}
    )
    blocks = blocks.pivot_table(
        index="day", columns="slot", values="error", aggfunc="median"
    )
    blocks = blocks.reindex(columns=range(288)).to_numpy()
    # Previous local day's observed profile, repeated for multi-day outlooks.
    # Missing night hours remain missing; no fallback disguised as a naive.
    last_day = calendar_before(origin, 1, cfg)
    recent = price.loc[price.index >= last_day]
    naive = (
        pd.Series(recent.to_numpy(), index=slots(recent.index, cfg))
        .groupby(level=0)
        .agg(lambda group: group.iloc[-1])
    )
    naive = naive.reindex(range(288)).to_numpy()
    last_observation = frame.observed_at.dropna()
    return {
        "schema_version": SCHEMA_VERSION,
        "model": "harmonic_ar2",
        **series.identity(),
        "config": cfg.to_dict(),
        "origin": origin.isoformat(),
        "training_start": start.isoformat(),
        "training_end_exclusive": origin.isoformat(),
        "last_observation": last_observation.iloc[-1].isoformat()
        if len(last_observation)
        else None,
        "training_days": int(days),
        "training_points": int(valid.sum()),
        "status_known_fraction": float(frame.loc[price.notna(), "status_known"].mean()),
        "beta": beta,
        "ar_phi": phi,
        "ar_state": state,
        "residual_blocks": blocks,
        "naive_profile": naive,
        "mase_scale": seasonal_scale(price, cfg),
        "interval_method": "residual_day_bootstrap_uncalibrated",
        "calibrated": False,
        "decision_ready": False,
    }


def validate_model(model: dict) -> Config:
    if (
        model.get("schema_version") != SCHEMA_VERSION
        or model.get("model") != "harmonic_ar2"
    ):
        raise ValueError("Unbekannte Modell-/Artefakt-Version; neu fitten.")
    cfg = Config(**model["config"])
    for key, shape in (("beta", (11,)), ("ar_phi", (2,)), ("ar_state", (2,))):
        value = np.asarray(model[key], dtype=float)
        if value.shape != shape or not np.isfinite(value).all():
            raise ValueError(f"Ungültiger Modellzustand: {key}.")
    phi = np.asarray(model["ar_phi"], dtype=float)
    if np.max(np.abs(np.roots([1, -phi[0], -phi[1]]))) >= 1:
        raise ValueError("Instabile AR-Koeffizienten im Artefakt.")
    blocks = np.asarray(model["residual_blocks"], dtype=float)
    if (
        blocks.ndim != 2
        or blocks.shape[1] != 288
        or not 1 <= len(blocks) <= cfg.train_days + 1
    ):
        raise ValueError("Ungültige Residuen-Tagesblöcke.")
    naive = np.asarray(model["naive_profile"], dtype=float)
    if naive.shape != (288,) or np.isinf(naive).any() or np.isinf(blocks).any():
        raise ValueError("Ungültiges saisonales Profil.")
    origin = utc_time(model["origin"], cfg.timezone)
    if origin != origin.floor(f"{cfg.step_minutes}min"):
        raise ValueError("Modell-Cutoff liegt nicht auf dem 5-Minuten-Raster.")
    if utc_time(model["training_start"], cfg.timezone) >= origin:
        raise ValueError("Ungültiger Trainingsbeginn.")
    if model.get("last_observation") and utc_time(model["last_observation"]) >= origin:
        raise ValueError("Beobachtung darf nicht nach dem Trainings-Cutoff liegen.")
    if utc_time(model["training_end_exclusive"], cfg.timezone) != origin:
        raise ValueError("Inkonsistenter Trainings-Cutoff.")
    if model.get("calibrated") is not False or model.get("decision_ready") is not False:
        raise ValueError(
            "Diese Engine-Version kann keine kalibrierten Empfehlungen freigeben."
        )
    return cfg


def predict(
    model: dict, hours: int = 24, *, index: pd.DatetimeIndex | None = None
) -> pd.DataFrame:
    cfg = validate_model(model)
    origin = utc_time(model["origin"], cfg.timezone)
    if not 1 <= hours <= 168:
        raise ValueError("Prognosehorizont muss 1 bis 168 Stunden betragen.")
    if index is None:
        index = pd.date_range(
            origin,
            periods=hours * 60 // cfg.step_minutes,
            freq=f"{cfg.step_minutes}min",
        )
    if (
        not len(index)
        or index.tz is None
        or not index.is_monotonic_increasing
        or not index.is_unique
        or index[0] < origin
        or index[-1] >= origin + pd.Timedelta(days=7)
        or not index.equals(index.floor(f"{cfg.step_minutes}min"))
    ):
        raise ValueError(
            "Prognoseraster muss eindeutig, sortiert und innerhalb Cutoff + 7 Tage liegen."
        )
    beta = np.asarray(model["beta"], dtype=float)
    phi = np.asarray(model["ar_phi"], dtype=float)
    state = list(np.asarray(model["ar_state"], dtype=float))
    offsets = np.asarray(
        (index - origin).total_seconds() / (cfg.step_minutes * 60), dtype=int
    )
    correction = np.zeros(int(offsets[-1]) + 1)
    for i in range(len(correction)):
        following = phi[0] * state[0] + phi[1] * state[1]
        correction[i] = following
        state = [following, state[0]]
    structure = features(index, cfg) @ beta
    point = structure + correction[offsets]
    block = np.asarray(model["residual_blocks"], dtype=float)
    slot = slots(index, cfg)
    counts = np.isfinite(block).sum(axis=0)
    supported = counts[slot] >= cfg.min_slot_days
    paths = np.full((cfg.bootstrap_samples, len(index)), np.nan)
    rng = np.random.default_rng(cfg.seed)
    local_dates = index.tz_convert(cfg.timezone).strftime("%Y-%m-%d")
    # A single draw supplies a whole day's error path, not independent ticks.
    for day in np.unique(local_dates):
        positions = np.flatnonzero(local_dates == day)
        draws = rng.integers(0, len(block), size=cfg.bootstrap_samples)
        paths[:, positions] = point[positions] + block[draws[:, None], slot[positions]]
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore", message="All-NaN slice encountered", category=RuntimeWarning
        )
        quantiles = np.nanquantile(paths, QUANTILES, axis=0).T
    supported &= np.isfinite(quantiles).all(axis=1)
    quantiles[~supported] = np.nan
    result = pd.DataFrame(quantiles, index=index, columns=Q_COLUMNS)
    result.index.name = "timestamp"
    result["structure"] = np.where(supported, structure, np.nan)
    result["harmonic_ar2"] = np.where(supported, point, np.nan)
    result["naive"] = np.asarray(model["naive_profile"], dtype=float)[slot]
    result["support_days"] = counts[slot]
    result["supported"] = supported
    return result
