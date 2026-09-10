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


def exp_block_weights(n_blocks: int, half_life_days: float | None) -> np.ndarray | None:
    """Exponentielle Ziehgewichte für Tagesblöcke (Issue 46).

    Blöcke sind chronologisch sortiert (ältester zuerst, neuester zuletzt).
    Gewicht des Blocks mit Alter ``a`` (Tage, 0 = neuester):
    ``0.5 ** (a / half_life_days)``, normiert auf Summe 1.
    ``None`` (oder ungültig) bedeutet uniform — der Aufrufer zieht dann
    ungewichtet.
    """
    if n_blocks <= 0:
        return None
    if half_life_days is None:
        return None
    try:
        half_life = float(half_life_days)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(half_life) or half_life <= 0:
        return None
    ages = np.arange(n_blocks - 1, -1, -1, dtype=float)
    weights = 0.5 ** (ages / half_life)
    total = float(weights.sum())
    if total <= 0 or not np.isfinite(total):
        return None
    return weights / total


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


def law_since_utc(cfg: Config) -> pd.Timestamp:
    """Erster gesetzlich zulässiger Preiserhöhungspunkt, als UTC-Instanz."""
    return pd.Timestamp(cfg.price_law_local).tz_localize(cfg.timezone).tz_convert("UTC")


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
    # 12-Uhr-Regel (seit 2026-04-01): Erhöhungen nur um 12:00, danach nur
    # noch Senkungen. Der Nachmittag liegt deshalb strukturell auf einem
    # eigenen Niveau; das trägt der Schritt ab, statt die Harmonischen einen
    # glatten, unrechtmäßigen Tagesanstieg kurven zu lassen.
    after_law = np.asarray(local >= law_since_utc(cfg))
    columns.append(np.asarray(after_law & (local.hour >= 12), dtype=float))
    return np.column_stack(columns)


def isotonic_decreasing(values: np.ndarray) -> np.ndarray:
    """Pool-adjacent-violators: L2-Projektion auf die nicht-steigenden Verläufe.

    Wichtig: die Projektion ist ein Ganzheitsproblem — ein späterer Anstieg
    wird zusammen mit den vorhergehenden Punkten zu einem flachen Pool und
    schreibt deren Werte mit um. Der Kontext muss also genau der zusammen-
    hängende Ausschnitt sein, über den projektiert werden soll (hier: ein
    vollständiges [12:00-Uhr-Segment], siehe ``noon_law_projection``).
    """
    values = np.asarray(values, dtype=float)
    # Schnellpfad: bereits nicht-steigend → nichts zu poolen. Bei glatten
    # Strukturverläufen der Regelfall und der teure PAVA-Lauf entfällt.
    if values.size < 2 or bool(np.all(np.diff(values) <= 0)):
        return values.copy()
    # PAVA über flache Arrays statt über Python-Floats: gleicher Algorithmus
    # (L2-Projektion, gewichtete Pool-Mittel), aber ohne Boxing je Punkt.
    size = values.size
    block_values = np.empty(size, dtype=float)
    block_counts = np.empty(size, dtype=np.int64)
    top = 0
    for value in values:
        block_values[top] = float(value)
        block_counts[top] = 1
        top += 1
        while top > 1 and block_values[top - 2] < block_values[top - 1]:
            count = block_counts[top - 2] + block_counts[top - 1]
            block_values[top - 2] = (
                block_values[top - 2] * block_counts[top - 2]
                + block_values[top - 1] * block_counts[top - 1]
            ) / count
            block_counts[top - 2] = count
            top -= 1
    out = np.empty(size, dtype=float)
    start = 0
    for position in range(top):
        count = int(block_counts[position])
        out[start : start + count] = block_values[position]
        start += count
    return out


def _segment_bounds(
    local: pd.DatetimeIndex,
) -> list[tuple[int, int, pd.Timestamp]]:
    """Segmente [12:00 Uhr, nächste 12:00 Uhr) auf dem Raster.

    Segment-Key ist der lokale 12:00-Uhr-Beginn: Ein Punkt vor 12:00 Uhr
    gehört zum Segment, das um 12:00 Uhr des Vortags begonnen hat.
    Mitternacht ist KEINE Segmentgrenze — Nachmittag und Folgevormittag
    werden gemeinsam projiziert (ein Anstieg über Mitternacht ist
    außerhalb des 12-Uhr-Punkts ebenfalls unzulässig).
    Liefert (start, stop, segment_beginn_noon).

    Vektorisiert über die int64-Rohwerte: Der frühere Skalarvergleich
    ``seg[position] != seg[start]`` baute je Punkt ein ``pd.Timestamp``
    (ca. 8 Mio. Boxing-Operationen pro 7-Tage-Prognose) und war damit der
    mit Abstand teuerste Teil des Modell-Laufs.
    """
    if len(local) == 0:
        return []
    day = local.normalize()
    before_noon = local.hour < 12
    seg = (
        day
        + pd.Timedelta(hours=12)
        - pd.to_timedelta(before_noon.astype(int), unit="D")
    )
    values = _asi8(seg)
    starts = np.flatnonzero(np.concatenate(([True], values[1:] != values[:-1])))
    stops = np.concatenate((starts[1:], [len(values)]))
    # Nur die Segment-Anfänge werden als Zeitstempel gebraucht (<< Punkte).
    heads = seg[starts]
    return [
        (int(start), int(stop), heads[position])
        for position, (start, stop) in enumerate(zip(starts, stops))
    ]


def _asi8(index: pd.DatetimeIndex) -> np.ndarray:
    """int64-Rohwerte eines DatetimeIndex ohne Timestamp-Boxing."""
    values = getattr(index, "asi8", None)
    if values is not None:
        return np.asarray(values, dtype="int64")
    return np.asarray(index, dtype="datetime64[ns]").astype("int64")


def noon_law_projection(
    values: np.ndarray,
    index: pd.DatetimeIndex,
    cfg: Config,
    segments: list[tuple[int, int, pd.Timestamp]] | None = None,
) -> np.ndarray:
    """Projektiert einen Preisverlauf auf die 12-Uhr-Regel.

    Innerhalb jedes Segments [12:00 Uhr, nächste 12:00 Uhr) darf der Preis
    nur gleich bleiben oder sinken; der erlaubte Sprung liegt exakt an der
    Segmentgrenze. Segmente, die vor dem Gesetzesbeginn (lokale Zeit)
    begannen, bleiben unverändert; NaN bleibt NaN.

    ``segments`` erlaubt es, die Segmentgrenzen einmal zu berechnen und für
    alle Bootstrap-Pfade wiederzuverwenden (predict() projiziert bis zu
    2000 Pfade auf dasselbe Raster).
    """
    result = np.asarray(values, dtype=float).copy()
    if len(index) < 2:
        return result
    law = law_since_utc(cfg).tz_convert(cfg.timezone)
    if segments is None:
        segments = _segment_bounds(index.tz_convert(cfg.timezone))
    for start, stop, boundary in segments:
        if boundary < law:
            continue
        chunk = result[start:stop]
        mask = np.isfinite(chunk)
        position = 0
        while position < len(chunk):
            if not mask[position]:
                position += 1
                continue
            end = position
            while end < len(chunk) and mask[end]:
                end += 1
            chunk[position:end] = isotonic_decreasing(chunk[position:end])
            position = end
        result[start:stop] = chunk
    return result


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
    # 12-Uhr-Regel als Datenqualitäts-Signal: beobachtete Anstiege von
    # mindestens 1 ct, deren 5-Minuten-Intervall keinen erlaubten
    # Erhöhungspunkt (12:00 Uhr, ab Gesetzesbeginn) enthalten. Das sind
    # mögliche Datenartefakte oder Regelverstöße; sie bleiben im Modell,
    # werden nur sichtbar gezählt.
    price_values = price.to_numpy()
    finite = np.isfinite(price_values)
    local_index = index.tz_convert(cfg.timezone)
    law = law_since_utc(cfg).tz_convert(index.tz)
    irregular_rises = 0
    for position in range(1, len(index)):
        if not (finite[position] and finite[position - 1]):
            continue
        # Zählschwelle 1 ct/L (0,01 €): Kleinere Bewegungen sind
        # Rundungs-/Meldungsrauschen, keine Preiserhöhungen im Sinn der Regel.
        if price_values[position] <= price_values[position - 1] + 0.01:
            continue
        # Der erlaubte Erhöhungspunkt ist die lokale 12:00 Uhr des Rasterpunkts.
        noon = (local_index[position].normalize() + pd.Timedelta(hours=12)).tz_convert(
            index.tz
        )
        if noon < law or index[position - 1] < noon <= index[position]:
            continue
        irregular_rises += 1
    last_observation = frame.observed_at.dropna()
    ew_half_life = getattr(cfg, "bootstrap_ew_half_life_days", None)
    interval_method = (
        "residual_day_bootstrap_ew_uncalibrated"
        if ew_half_life
        else "residual_day_bootstrap_uncalibrated"
    )
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
        "law_rise_outside_noon": int(irregular_rises),
        "beta": beta,
        "ar_phi": phi,
        "ar_state": state,
        "residual_blocks": blocks,
        "naive_profile": naive,
        "mase_scale": seasonal_scale(price, cfg),
        "interval_method": interval_method,
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
    for key, shape in (("beta", (12,)), ("ar_phi", (2,)), ("ar_state", (2,))):
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
    """Prognose ab Cutoff. Das Raster muss eindeutig, sortiert und auf dem
    5-Minuten-Raster liegen. Die 12-Uhr-Regel-Projektion verwendet das
    übergebene Raster als Kontext: Teilraster sind mit dem Vollraster
    identisch, wenn sie ganze Segmente [12:00 Uhr, nächste 12:00 Uhr)
    überdecken (Pools koppeln nur innerhalb eines Segments).
    """
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
    # Segmentgrenzen des 12-Uhr-Gesetzes einmal je Raster bestimmen (statt
    # je Bootstrap-Pfade erneut) — das war der zeitaufwendige Teil.
    segments = _segment_bounds(index.tz_convert(cfg.timezone))
    # 12-Uhr-Regel: Median und Struktur dürfen innerhalb der Segmente
    # [12:00 Uhr, nächste 12:00 Uhr) nicht steigen; der erlaubte Sprung liegt
    # an der Segmentgrenze. Segmente vor dem Gesetzesbeginn bleiben unverändert.
    point = noon_law_projection(
        structure + correction[offsets], index, cfg, segments=segments
    )
    block = np.asarray(model["residual_blocks"], dtype=float)
    slot = slots(index, cfg)
    counts = np.isfinite(block).sum(axis=0)
    supported = counts[slot] >= cfg.min_slot_days
    paths = np.full((cfg.bootstrap_samples, len(index)), np.nan)
    rng = np.random.default_rng(cfg.seed)
    local_dates = index.tz_convert(cfg.timezone).strftime("%Y-%m-%d")
    # A single draw supplies a whole day's error path, not independent ticks.
    # Issue 46: neuere Tagesblöcke werden exponentiell höher gewichtet
    # (Halbwertszeit aus der Config, Default 14 Tage); None = uniform.
    block_weights = exp_block_weights(
        len(block), getattr(cfg, "bootstrap_ew_half_life_days", None)
    )
    for day in np.unique(local_dates):
        positions = np.flatnonzero(local_dates == day)
        if block_weights is None:
            draws = rng.integers(0, len(block), size=cfg.bootstrap_samples)
        else:
            draws = rng.choice(len(block), size=cfg.bootstrap_samples, p=block_weights)
        paths[:, positions] = point[positions] + block[draws[:, None], slot[positions]]
    # Die 12-Uhr-Regel gilt für jedes Szenario, nicht nur für den Median.
    for sample in range(cfg.bootstrap_samples):
        paths[sample] = noon_law_projection(
            paths[sample], index, cfg, segments=segments
        )
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
