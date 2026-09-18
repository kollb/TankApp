"""M3 first increment: robust daily structure + stable AR(2) residual follow-up.

Residual day blocks provide explicitly *uncalibrated* bootstrap intervals.
These are not ACI, not live probabilities, and never an automatic release gate.
"""

import warnings

import numpy as np
import pandas as pd

from .config import Config
from .data import PriceSeries
from .holidays import holiday_flags

QUANTILES = (0.025, 0.10, 0.50, 0.90, 0.975)
Q_COLUMNS = ("q025", "q10", "q50", "q90", "q975")
# A10 (0.31.0): Fenster am Ende des Trainings, auf dem die inversen
# MASE-Gewichte des Ensembles bestimmt werden (Konzept §3.2 M3).
VALIDATION_WINDOW_DAYS = 14
# Schema 2 (Konzept §3.2): X trägt zusätzlich zum Kalender-Satz (12 Spalten)
# den gepoolten Feiertags-Dummy und die Zeit seit dem letzten Preissprung.
# beta wächst damit von 12 auf 13 Spalten (Feiertag läuft als eigener,
# gepoolt geschätzter Koeffizient nebenher); alte Artefakte werden neu gefittet.
SCHEMA_VERSION = 2

# Sprung-Hazard-Feature: Preissprung = |Δp| ≥ 1 ct zwischen zwei beobachteten
# Punkten (dieselbe Zählschwelle wie die 12-Uhr-Regel). Die Zeit seit dem
# letzten Sprung ist auf 168 h gekappt: „länger als 7 Tage (oder im Blickfeld
# unbekannt)“ ist ein Zustand, kein weiter laufender Zähler.
JUMP_THRESHOLD_EUR = 0.01
JUMP_AGE_CAP_HOURS = 168.0


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


def jump_age_hours(
    price: pd.Series, threshold: float = JUMP_THRESHOLD_EUR
) -> np.ndarray:
    """Stunden seit dem letzten Preissprung je Rasterpunkt (Konzept §3.2).

    Sprung = |Δp| ≥ ``threshold`` (Default 1 ct) zwischen zwei *beobachteten*
    Punkten; Lücken (NaN) brechen die Kette. Punkte vor dem ersten Sprung —
    und Punkte, deren letzter Sprung weiter zurückliegt als
    ``JUMP_AGE_CAP_HOURS`` — tragen den Deckel: „länger als 7 Tage (oder im
    Blickfeld unbekannt)“ ist ein Zustand, kein unbeschränkter Zähler.
    """
    values = price.to_numpy(dtype=float)
    n = len(values)
    finite = np.isfinite(values)
    jump = np.zeros(n, dtype=bool)
    if n > 1:
        delta = np.abs(np.diff(values))
        both = finite[1:] & finite[:-1]
        jump[1:] = both & (delta >= threshold)
    # A missing price invalidates knowledge of the last jump.  Do not carry a
    # pre-outage jump through the gap: when observations resume at the same
    # level we cannot know whether another jump happened while the station was
    # closed/offline.  The capped "unknown" state remains in force until a new
    # jump is directly observed between adjacent finite points.
    age = np.full(n, JUMP_AGE_CAP_HOURS, dtype=float)
    events = jump | ~finite
    event_positions = np.where(events, np.arange(n), -1)
    last_event = np.maximum.accumulate(event_positions)
    lookup = np.maximum(last_event, 0)
    known = finite & (last_event >= 0) & jump[lookup]
    if known.any():
        index = np.asarray(price.index, dtype="datetime64[ns]")
        elapsed = (index[known] - index[last_event[known]]) / np.timedelta64(1, "h")
        age[known] = np.minimum(elapsed, JUMP_AGE_CAP_HOURS)
    return age


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
    begannen, bleiben unverändert; NaN bleibt NaN, wird aber nicht als
    Barriere behandelt — ein Anstieg über eine Schließungs-/Nachtlücke
    hinweg (z. B. 22:00 → 06:00) ist nach dem Gesetz ebenfalls unzulässig,
    weil kein 12:00-Punkt dazwischen liegt. Die Projektion läuft deshalb
    über die endlichen Werte des Segments hinweg.

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
        finite_mask = np.isfinite(chunk)
        if not np.any(finite_mask):
            continue
        finite_vals = chunk[finite_mask]
        projected = isotonic_decreasing(finite_vals)
        chunk[finite_mask] = projected
        result[start:stop] = chunk
    return result


def project_paths(
    paths: np.ndarray,
    index: pd.DatetimeIndex,
    cfg: Config,
    segments: list[tuple[int, int, pd.Timestamp]] | None = None,
) -> np.ndarray:
    """12-Uhr-Projektion aller Bootstrap-Pfade, dedupliziert je Segment (B15).

    Innerhalb eines Segments [12:00 Uhr, nächste 12:00 Uhr) hängt der
    projizierte Pfad nur von den gezogenen Tagesblöcken dieses Segments ab:
    bei ``n`` Tagesblöcken gibt es je Segment höchstens ``n²`` verschiedene
    Zeilen (bei Mitternachts-Origin genau ``n``) statt ``bootstrap_samples``
    projizierter Vollpfade. Eindeutige Zeilen werden einmal projiziert und
    über ``inverse`` auf alle Pfade zurückgeschrieben — bitgleich zur
    skalaren Projektion jedes einzelnen Pfads.
    """
    paths = np.asarray(paths, dtype=float)
    law = law_since_utc(cfg).tz_convert(cfg.timezone)
    if segments is None:
        segments = _segment_bounds(index.tz_convert(cfg.timezone))
    for start, stop, boundary in segments:
        if boundary < law:
            continue
        chunk = paths[:, start:stop]
        # NaN als endlichen Stellvertreter kodieren: ``np.unique`` vergleicht
        # NaN != NaN und würde Zeilen mit identischem NaN-Muster (gleiche
        # Ziehung) nie zusammenführen — die Deduplizierung liefe sonst für
        # Segmente mit Nacht-/Schließzeiten ins Leere. Der Stellvertreter
        # kommt in echten Preisen/Residuen nicht vor und wird vor der
        # Projektion wieder zu NaN.
        dedup_input = np.where(np.isnan(chunk), np.inf, chunk)
        unique, inverse = np.unique(dedup_input, axis=0, return_inverse=True)
        sub_index = index[start:stop]
        sub_segments = [(0, stop - start, boundary)]
        for row in range(len(unique)):
            row_values = np.where(unique[row] == np.inf, np.nan, unique[row])
            unique[row] = noon_law_projection(
                row_values, sub_index, cfg, segments=sub_segments
            )
        paths[:, start:stop] = unique[inverse]
    return paths


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


def seasonal_scale_detail(price: pd.Series, cfg: Config) -> dict:
    """MASE-Nenner mit ausgewiesenen Gründen für fehlende Anker (H5).

    Die saisonale Skala ist der mittlere absolute Abstand zum selben Slot des
    Vortags. Der Vortages-Anker wird über lokale Wanduhr minus einen Tag
    gebildet; an Zeitumstellungen existiert bzw. eindeutig ist diese Uhrzeit
    nicht (02:00–02:59 fehlt im Frühjahr, ist im Herbst doppelt). Solche
    Anker sind ``NaT`` und fallen aus dem Mittel — sichtbar ist bisher nur
    ein kleinerer Stichprobenumfang.

    Diese Funktion liefert deshalb neben der Skala die Zählung der fehlenden
    Anker. ``anchors_nat`` sind die Wanduhr-Fälle (Zeitumstellung), getrennt
    von ``anchors_outside`` (Anker liegt außerhalb der vorhandenen Reihe,
    z. B. am Reihenanfang). ``scale`` ist ``None``, wenn die Skala undefiniert
    ist — dann nennt ``reason`` den Grund, statt still ``None`` zu liefern.
    """
    local = price.index.tz_convert(cfg.timezone).tz_localize(None)
    previous = (
        (local - pd.Timedelta(days=1))
        .tz_localize(cfg.timezone, ambiguous="NaT", nonexistent="NaT")
        .tz_convert("UTC")
    )
    anchors_nat = int(previous.isna().sum())
    lagged = price.reindex(previous).to_numpy()
    available = np.isfinite(lagged)
    error = np.abs(price.to_numpy() - lagged)
    error = error[np.isfinite(error)]
    # ``reindex`` liefert auch für die NaT-Anker NaN — nicht doppelt zählen.
    anchors_outside = int((~available).sum()) - anchors_nat
    scale = float(error.mean()) if len(error) else 0.0
    if len(error) == 0:
        reason = "no_reference_points"
    elif scale <= 1e-8:
        reason = "constant_series"
    else:
        reason = None
    return {
        "scale": scale if reason is None else None,
        "points": int(len(error)),
        "anchors_nat": anchors_nat,
        "anchors_outside": anchors_outside,
        "reason": reason,
    }


def seasonal_scale(price: pd.Series, cfg: Config) -> float | None:
    """Standard seasonal MASE denominator, estimated on training data only."""
    return seasonal_scale_detail(price, cfg)["scale"]


def _residual_blocks(
    index: pd.DatetimeIndex, residual: np.ndarray, cfg: Config
) -> np.ndarray:
    """Residuen-Tagesblöcke als (Tag, Slot)-Matrix (B16 a+c, bitgleich).

    (Tag, Slot) ist je Gitterpunkt eindeutig; die frühere
    ``pivot_table(aggfunc="median")`` reduzierte deshalb genau einen Wert
    je Zelle und verwarf NaN. Tagesschlüssel über ``factorize`` — die
    Auftretensreihenfolge ist chronologisch, weil das Raster sortiert ist
    (dieselbe Ziehreihenfolge wie die frühere ``strftime``-Sortierung).
    """
    day_codes = pd.factorize(index.tz_convert(cfg.timezone).normalize())[0]
    slot_index = slots(index, cfg)
    blocks = np.full((int(day_codes.max()) + 1, 288), np.nan)
    blocks[day_codes, slot_index] = residual
    return blocks


def _naive_profile(recent: pd.Series, cfg: Config) -> np.ndarray:
    """Letzter Wert je Slot des Vortags-Profils (B16 d, bitgleich).

    Stabiler Sortierindex + ``searchsorted`` statt
    ``groupby(…).agg(lambda g: g.iloc[-1])``: der letzte Gitterpunkt eines
    Slots ist sein zeitlich jüngster Wert.
    """
    recent_slots = slots(recent.index, cfg)
    order = np.argsort(recent_slots, kind="stable")
    sorted_slots = recent_slots[order]
    starts = np.searchsorted(sorted_slots, np.arange(288))
    ends = np.searchsorted(sorted_slots, np.arange(288), side="right")
    naive = np.full(288, np.nan)
    present = starts < ends
    naive[present] = recent.to_numpy()[order[ends[present] - 1]]
    return naive


def _profile_level(values: np.ndarray, slot_index: np.ndarray) -> np.ndarray:
    """Median je Tages-Slot (288) — das Zweitmodell (A10).

    Nicht-parametrisch: statt einer Sinusform wird der beobachtete
    Tagesverlauf je Slot genommen. Ein Slot ohne Beobachtung bleibt NaN —
    kein Auffüllen aus Nachbarstunden, sonst wäre das „Profil“ erfunden.
    """
    level = np.full(288, np.nan)
    for slot in range(288):
        mask = slot_index == slot
        if mask.any():
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                level[slot] = np.nanmedian(values[mask])
    return level


def ensemble_detail(
    adjusted: np.ndarray,
    harmonic: np.ndarray,
    profile: np.ndarray,
    residual_h: np.ndarray,
    residual_p: np.ndarray,
    phi_h: np.ndarray,
    phi_p: np.ndarray,
    window_days: int = VALIDATION_WINDOW_DAYS,
) -> dict:
    """Gewichte ∝ 1/MASE aus einem Validierungsfenster (A10, Konzept §3.2 M3).

    Verglichen wird die **Eine-Schritt-Prognose** (5 min im Voraus, AR(2)-
    Zustand aus den beiden Vorpunkten) beider Modelle auf den letzten
    ``window_days`` Trainingstagen; Nenner ist die saisonale Naive
    (derselbe Slot am Vortag) — damit ist es ein echter MASE, nicht nur ein
    MAE-Vergleich.

    Ausgewiesen wird alles, was das Gewicht trägt: MAE, MASE, Stichprobe und
    Fenster. Ist ein MASE nicht bestimmbar (zu wenig Daten, Naive konstant),
    trägt das Modell nichts bei — der Hauptpfad bleibt dann allein.
    """
    n = len(adjusted)
    empty = {
        "weights": {"harmonic_ar2": 1.0, "profile_ar2": 0.0},
        "mase": {"harmonic_ar2": None, "profile_ar2": None},
        "mae": {"harmonic_ar2": None, "profile_ar2": None},
        "n_eval": 0,
        "window_days": int(window_days),
        "method": "inverse_mase_one_step_validation",
    }
    if n <= 288 + 2:
        return empty
    start = max(288, n - int(window_days) * 288)
    idx = np.arange(start, n)

    def errors(structure: np.ndarray, residual: np.ndarray, phi: np.ndarray):
        prediction = (
            structure[idx] + phi[0] * residual[idx - 1] + phi[1] * residual[idx - 2]
        )
        return np.abs(adjusted[idx] - prediction)

    naive = np.abs(adjusted[idx] - adjusted[idx - 288])
    usable = np.isfinite(adjusted[idx]) & np.isfinite(naive)
    if not usable.any():
        return empty
    scale = float(np.mean(naive[usable]))
    if not np.isfinite(scale) or scale <= 0:
        return empty
    errs = {
        "harmonic_ar2": errors(harmonic, residual_h, phi_h),
        "profile_ar2": errors(profile, residual_p, phi_p),
    }
    mae: dict[str, float | None] = {}
    mase: dict[str, float | None] = {}
    for name, err in errs.items():
        mask = usable & np.isfinite(err)
        if not mask.any():
            mae[name], mase[name] = None, None
            continue
        mae[name] = round(float(np.mean(err[mask])), 6)
        mase[name] = round(mae[name] / scale, 4)
    inverse = {
        name: (1.0 / value if value and value > 0 else 0.0)
        for name, value in mase.items()
    }
    total = sum(inverse.values())
    weights = (
        {name: round(value / total, 4) for name, value in inverse.items()}
        if total > 0
        else {"harmonic_ar2": 1.0, "profile_ar2": 0.0}
    )
    return {
        "weights": weights,
        "mase": mase,
        "mae": mae,
        "n_eval": int(mask_count(usable)),
        "window_days": int(window_days),
        "method": "inverse_mase_one_step_validation",
        "naive_mae": round(scale, 6),
    }


def mask_count(mask: np.ndarray) -> int:
    """Anzahl nutzbarer Vergleichspunkte (Hilfsfunktion, keine Fachlogik)."""
    return int(np.count_nonzero(mask))


def fit(series: PriceSeries, origin, cfg: Config) -> dict:
    origin = utc_time(origin, cfg.timezone)
    if origin != origin.floor(f"{cfg.step_minutes}min"):
        raise ValueError("Fit-Cutoff muss auf dem 5-Minuten-Raster liegen.")
    nominal_start = calendar_before(origin, cfg.train_days, cfg)
    # B30: Bodenkante der 12-Uhr-Regel. Intraday-Struktur (Harmonische,
    # Mittags-Schritt, Slot-Profil) lernt nur aus Beobachtungen **ab**
    # ``price_law_local``: Vor dem Gesetz lag das Tagestief am Abend, danach
    # im Vormittag (docs/archiv/BEFUND-12-UHR-REGEL-2026-09-18.md §2) — ein Fenster über beide
    # Rechtslagen mittet zwei Tagesrhythmen zu einem, den es nie gab.
    # Reicht der Nach-Gesetz-Bestand nicht für ``min_train_days``, scheitert
    # der Fit mit Grund, statt still den alten Rhythmus mitzulernen.
    law = law_since_utc(cfg)
    start = max(nominal_start, law.floor(f"{cfg.step_minutes}min"))
    law_floor_active = start > nominal_start
    if law_floor_active:
        window = series.frame.index
        excluded = (window >= nominal_start) & (window < start)
        pre_law_points = int(series.frame.loc[excluded, "price"].notna().sum())
    else:
        pre_law_points = 0
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
            + (
                f" Der Trainingsbeginn ist die 12-Uhr-Bodenkante "
                f"{start.isoformat()} — Beobachtungen davor beschreiben die "
                f"Rechtslage vor dem Gesetz ({pre_law_points} ausgeblendet)."
                if law_floor_active
                else ""
            )
        )
    base = features(index, cfg)
    jump_train = jump_age_hours(price)
    x = np.column_stack([base, jump_train])
    price_values = price.to_numpy()
    # Gepoolter Feiertags-Dummy (Konzept §3.2): Der Koeffizient kommt aus
    # einem bis zu einem Jahr breiten Fenster, nicht aus dem 42-Tage-Fit —
    # 0–1 Feiertage je 6 Wochen wären dort unidentifizierbar. Ohne Subdiv,
    # ohne Paket oder ohne Feiertag im Pool bleibt der Beitrag ehrlich 0.
    subdiv = (cfg.city_subdivs or {}).get(series.city)
    holiday_beta = 0.0
    holiday_source = "none"
    holiday_pool_days = 0
    hol_train, holiday_source = holiday_flags(index, subdiv, cfg.timezone)
    if holiday_source != "none":
        pool_start = max(
            calendar_before(origin, cfg.holiday_pool_days, cfg),
            series.frame.index.min(),
        )
        pool_index = pd.date_range(
            pool_start, origin, freq=f"{cfg.step_minutes}min", inclusive="left"
        )
        pool_frame = series.frame.reindex(pool_index)
        pool_price = pool_frame.price.to_numpy()
        pool_valid = pool_frame.price.notna().to_numpy()
        if pool_valid.sum() >= cfg.min_train_days * 24:
            hol_pool, _ = holiday_flags(pool_index, subdiv, cfg.timezone)
            if hol_pool.sum() > 0:
                x_pool = np.column_stack([features(pool_index, cfg), hol_pool])
                pool_beta = huber_fit(x_pool[pool_valid], pool_price[pool_valid])
                holiday_beta = float(pool_beta[12])
                holiday_pool_days = (
                    origin.tz_convert(cfg.timezone).normalize()
                    - pool_start.tz_convert(cfg.timezone).normalize()
                ).days + 1
        else:
            holiday_source = "none"
    adjusted = price_values - holiday_beta * hol_train
    beta = huber_fit(x[valid], adjusted[valid])
    residual = adjusted - x @ beta
    phi = fit_ar2(residual)
    # [epsilon(t-1), epsilon(t-2)] at the forecast origin. No stale carryover.
    state = residual[-2:][::-1] if np.isfinite(residual[-2:]).all() else np.zeros(2)
    # A10: Zweitmodell „profile_ar2“ — Tagesprofil je Slot (Median) statt
    # Harmonischer, sonst dieselbe Kette (Holiday-Bereinigung, AR(2),
    # Tagesblock-Bootstrap). Es ist bewusst **nicht** eine zweite Variante
    # derselben Sinusform, sondern ein anderer Modellkern (Konzept §3.2 M3).
    slot_train = slots(index, cfg)
    profile_level = _profile_level(adjusted, slot_train)
    profile_structure = profile_level[slot_train]
    profile_residual = adjusted - profile_structure
    profile_phi = fit_ar2(profile_residual)
    profile_state = (
        profile_residual[-2:][::-1]
        if np.isfinite(profile_residual[-2:]).all()
        else np.zeros(2)
    )
    profile_blocks = _residual_blocks(index, profile_residual, cfg)
    ensemble = ensemble_detail(
        adjusted,
        x @ beta,
        profile_structure,
        residual,
        profile_residual,
        phi,
        profile_phi,
    )
    # B16(a)+(c): Residuen-Tagesblöcke als direkte (Tag, Slot)-Index-Zuweisung
    # statt pivot_table(aggfunc="median") — bitgleich, siehe _residual_blocks.
    blocks = _residual_blocks(index, residual, cfg)
    # Previous local day's observed profile, repeated for multi-day outlooks.
    # Missing night hours remain missing; no fallback disguised as a naive.
    # B16(d): letzter Wert je Slot statt groupby(…).agg(lambda g: g.iloc[-1]).
    last_day = calendar_before(origin, 1, cfg)
    recent = price.loc[price.index >= last_day]
    naive = _naive_profile(recent, cfg)
    # 12-Uhr-Regel als Datenqualitäts-Signal: beobachtete Anstiege von
    # mindestens 1 ct, deren 5-Minuten-Intervall keinen erlaubten
    # Erhöhungspunkt (12:00 Uhr, ab Gesetzesbeginn) enthalten. Das sind
    # mögliche Datenartefakte oder Regelverstöße; sie bleiben im Modell,
    # werden nur sichtbar gezählt.
    price_values = price.to_numpy()
    finite = np.isfinite(price_values)
    local_index = index.tz_convert(cfg.timezone)
    law = law_since_utc(cfg).tz_convert(index.tz)
    # B16(e): Zähler vektorisiert — dieselbe Bedingung wie die frühere
    # Positionsschleife, nur als Masken-Operation (bitgleich).
    if len(index) > 1:
        both_finite = finite[1:] & finite[:-1]
        risen = price_values[1:] > price_values[:-1] + 0.01
        noon = (local_index[1:].normalize() + pd.Timedelta(hours=12)).tz_convert(
            index.tz
        )
        after_law = noon >= law
        spans_noon = (index[:-1] < noon) & (noon <= index[1:])
        irregular_rises = int((both_finite & risen & after_law & ~spans_noon).sum())
    else:
        irregular_rises = 0
    last_observation = frame.observed_at.dropna()
    ew_half_life = getattr(cfg, "bootstrap_ew_half_life_days", None)
    interval_method = (
        "residual_day_bootstrap_ew_uncalibrated"
        if ew_half_life
        else "residual_day_bootstrap_uncalibrated"
    )
    # H5: Die saisonale Skala weist ihre fehlenden Vortages-Anker aus. An
    # Zeitumstellungen sind das Wanduhr-Fälle (``anchors_nat``) — sie bleiben
    # aus dem Mittel, statt still die Stichprobe zu verkleinern.
    scale_detail = seasonal_scale_detail(price, cfg)
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
        # B30: Bodenkante der 12-Uhr-Regel im Fit — wirksamer Beginn, ob sie
        # gegriffen hat und wie viele Beobachtungen sie ausgeblendet hat.
        # ``law_floor_active`` ist heute (Fenster 42 Tage, Gesetz seit
        # 01.04.2026) durchgehend False: Die Kante ist eine Garantie, keine
        # Reparatur — sichtbar statt behauptet.
        "law_floor": law.isoformat(),
        "law_floor_active": bool(law_floor_active),
        "pre_law_points_excluded": int(pre_law_points),
        "beta": beta,
        # Schema 2 (Konzept §3.2): Feiertagseffekt gepoolt geschätzt (γ),
        # Sprung-Hazard als Feature (Zeit seit letztem Sprung, gedeckelt).
        "holiday_beta": holiday_beta,
        "holiday_subdiv": subdiv.strip().upper() if subdiv else None,
        "holiday_source": holiday_source,
        "holiday_pool_days": holiday_pool_days,
        "jump_age_hours": float(jump_train[-1]) if len(price) else JUMP_AGE_CAP_HOURS,
        "jump_age_cap_hours": JUMP_AGE_CAP_HOURS,
        "jump_threshold_eur": JUMP_THRESHOLD_EUR,
        "ar_phi": phi,
        "ar_state": state,
        "residual_blocks": blocks,
        # A10: Zweitmodell samt Gewichten (Konzept §3.2 M3). Fehlen die
        # Felder (Alt-Artefakt), rechnet predict allein mit dem Hauptpfad.
        "profile_level": profile_level,
        "profile_phi": profile_phi,
        "profile_state": profile_state,
        "profile_blocks": profile_blocks,
        "ensemble": ensemble,
        "naive_profile": naive,
        "mase_scale": scale_detail["scale"],
        "mase_scale_detail": scale_detail,
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
    for key, shape in (("beta", (13,)), ("ar_phi", (2,)), ("ar_state", (2,))):
        value = np.asarray(model[key], dtype=float)
        if value.shape != shape or not np.isfinite(value).all():
            raise ValueError(f"Ungültiger Modellzustand: {key}.")
    for key in (
        "holiday_beta",
        "holiday_subdiv",
        "holiday_source",
        "holiday_pool_days",
        "jump_age_hours",
        "jump_age_cap_hours",
        "jump_threshold_eur",
    ):
        if key not in model:
            raise ValueError(
                f"Modell-Feld '{key}' fehlt — Schema 1-Artefakt, neu fitten."
            )
    if not np.isfinite(float(model["holiday_beta"])):
        raise ValueError("Ungültiger Modellzustand: holiday_beta.")
    if not np.isfinite(float(model["jump_age_hours"])):
        raise ValueError("Ungültiger Modellzustand: jump_age_hours.")
    if not isinstance(model["holiday_source"], str):
        raise ValueError("Ungültiger Modellzustand: holiday_source.")
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


def shared_day_uniforms(
    cfg: Config,
    hours: int,
    day_position: int,
    samples: int | None = None,
) -> np.ndarray:
    """Gemeinsame Ziehungs-Zufallszahlen eines Tagesblocks (A11).

    Konzept §4.2: Der Marktgleichlauf darf nicht wegkorreliert werden.
    ``P_lohnt`` (F2) vergleicht zwei Stationen — zieht jede Station ihre
    Tagesblöcke unabhängig, fällt der gemeinsame Markt aus der Differenz
    heraus und die Wahrscheinlichkeit wird zu selbstsicher.

    Statt eines gemeinsamen Zustands (der im Prozess-Pool nicht überlebt)
    steht hier eine **ableitbare** Zahlenfolge: gleicher Samen, gleicher
    Horizont, gleiche Tagesposition → identische Zufallszahlen in jedem
    Prozess. Jede Station bildet sie über ihre **eigene** Verteilung ab
    (comonotone Kopplung): ein „teurer Tag“ der gezogenen Zahl trifft alle
    Stationen gleichzeitig.
    """
    samples = int(samples or cfg.bootstrap_samples)
    seed = np.random.SeedSequence([int(cfg.seed), int(hours), int(day_position), 0xA11])
    return np.random.default_rng(seed).random(samples)


def blocks_from_uniform(
    uniform: np.ndarray, n_blocks: int, weights: np.ndarray | None = None
) -> np.ndarray:
    """Tagesblock-Indizes aus gemeinsamen Zufallszahlen (A11).

    Gleichverteilte Ziehung ohne Gewichte, sonst Inversion der
    kumulierten Gewichte (Issue-46-Halbwertszeit). Das Ergebnis liegt
    immer in ``[0, n_blocks)``.
    """
    if n_blocks <= 0:
        raise ValueError("Keine Tagesblöcke zum Ziehen vorhanden.")
    if weights is None:
        indexes = np.floor(np.asarray(uniform, dtype=float) * n_blocks).astype(int)
    else:
        cumulative = np.cumsum(np.asarray(weights, dtype=float))
        indexes = np.searchsorted(
            cumulative, np.asarray(uniform, dtype=float), side="right"
        )
    return np.clip(indexes, 0, n_blocks - 1)


def predict(
    model: dict,
    hours: int = 24,
    *,
    index: pd.DatetimeIndex | None = None,
    return_paths: bool = False,
    shared_draws: bool = False,
    kind: str = "harmonic_ar2",
) -> pd.DataFrame | tuple[pd.DataFrame, np.ndarray]:
    """Prognose ab Cutoff. Das Raster muss eindeutig, sortiert und auf dem
    5-Minuten-Raster liegen. Die 12-Uhr-Regel-Projektion verwendet das
    übergebene Raster als Kontext: Teilraster sind mit dem Vollraster
    identisch, wenn sie ganze Segmente [12:00 Uhr, nächste 12:00 Uhr)
    überdecken (Pools koppeln nur innerhalb eines Segments).

    ``return_paths=True`` liefert zusätzlich die Bootstrap-Pfade
    ``(n_samples, n_timesteps)`` — die Grundlage der P-Seite des Decision
    Layers (Konzept §4.1–4.3): P_besser/P_lohnt/F3-Fenster-P werden aus der
    Verteilung gerechnet, nicht aus einer Ledger-Trefferquote. NaN bedeutet
    „Punkt nicht gestützt“ (wie bei den Quantilen).

    ``shared_draws=True`` zieht die Tagesblöcke **gemeinsam** über alle
    Stationen eines Laufs (A11, Konzept §4.2): gleiche Zufallszahlen je
    (Horizont, Tagesposition), je Station über die eigene Blockverteilung
    abgebildet. Ohne das Flag bleibt die Ziehung unabhängig wie vor 0.31.0.

    ``kind`` wählt das Punktmodell (A10, Konzept §3.2 M3): ``harmonic_ar2``
    (Default, wie vor 0.31.0), ``profile_ar2`` (Zweitmodell) oder
    ``ensemble`` (inverse-MASE-gewichtete Mischung beider Punktprognosen).
    Die Verteilungsform kommt in allen drei Fällen aus dem Tagesblock-
    Bootstrap; das Ensemble verschiebt sie auf den gewichteten Punktwert.
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
        or index[-1] >= origin + pd.Timedelta(days=8)
        or not index.equals(index.floor(f"{cfg.step_minutes}min"))
    ):
        raise ValueError(
            "Prognoseraster muss eindeutig, sortiert und innerhalb Cutoff + 8 Tage "
            "liegen (7-Tage-Horizont plus ein 24-h-Entscheidungsfenster darüber "
            "für die Mehrtage-Backtests, Konzept §3.4)."
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
    # Konzept §3.2: Struktur = Kalender (12 Spalten) + Zeit-seit-Sprung +
    # gepoolter Feiertags-Dummy (γ aus dem Pool-Fenster, hier nur ausgewiesen).
    # Nach dem Cutoff passiert kein neuer beobachteter Sprung mehr, deshalb
    # läuft das Sprung-Alter vom Cutoff-Wert weiter (gedeckelt).
    base = features(index, cfg)
    jump_forecast = np.minimum(
        float(model["jump_age_hours"]) + (offsets * cfg.step_minutes / 60.0),
        float(model.get("jump_age_cap_hours", JUMP_AGE_CAP_HOURS)),
    )
    hol_forecast, _ = holiday_flags(index, model.get("holiday_subdiv"), cfg.timezone)
    structure = (
        base @ beta[:12]
        + jump_forecast * beta[12]
        + float(model["holiday_beta"]) * hol_forecast
    )
    # Segmentgrenzen des 12-Uhr-Gesetzes einmal je Raster bestimmen (statt
    # je Bootstrap-Pfade erneut) — das war der zeitaufwendige Teil.
    segments = _segment_bounds(index.tz_convert(cfg.timezone))
    # 12-Uhr-Regel: Median und Struktur dürfen innerhalb der Segmente
    # [12:00 Uhr, nächste 12:00 Uhr) nicht steigen; der erlaubte Sprung liegt
    # an der Segmentgrenze. Segmente vor dem Gesetzesbeginn bleiben unverändert.
    point_harmonic = noon_law_projection(
        structure + correction[offsets], index, cfg, segments=segments
    )
    # A10: Zweitmodell und Ensemble-Punkt. Ohne Profil im Artefakt (Altbestand
    # oder Schema-1-Fit) bleibt der Hauptpfad allein — nie ein halbes Ensemble.
    raw_profile = model.get("profile_level")
    profile_level = np.asarray(
        raw_profile if raw_profile is not None else [], dtype=float
    )
    ensemble = model.get("ensemble") or {}
    weights = dict(ensemble.get("weights") or {})
    w_harmonic = float(weights.get("harmonic_ar2", 1.0) or 0.0)
    w_profile = float(weights.get("profile_ar2", 0.0) or 0.0)
    kind = (kind or "harmonic_ar2").strip().lower()
    point_profile = None
    if profile_level.shape == (288,) and np.isfinite(profile_level).any():
        profile_phi = np.asarray(
            model["profile_phi"]
            if model.get("profile_phi") is not None
            else (0.0, 0.0),
            dtype=float,
        )
        profile_state = list(
            np.asarray(
                model["profile_state"]
                if model.get("profile_state") is not None
                else (0.0, 0.0),
                dtype=float,
            )
        )
        profile_correction = np.zeros(int(offsets[-1]) + 1)
        for i in range(len(profile_correction)):
            following = (
                profile_phi[0] * profile_state[0] + profile_phi[1] * profile_state[1]
            )
            profile_correction[i] = following
            profile_state = [following, profile_state[0]]
        point_profile = noon_law_projection(
            profile_level[slots(index, cfg)] + profile_correction[offsets],
            index,
            cfg,
            segments=segments,
        )
    if kind == "ensemble" and point_profile is not None:
        total = w_harmonic + w_profile
        share_h = w_harmonic / total if total > 0 else 1.0
        share_p = w_profile / total if total > 0 else 0.0
        point = share_h * point_harmonic + share_p * point_profile
    elif kind == "profile_ar2" and point_profile is not None:
        point = point_profile
    else:
        point = point_harmonic
    block = np.asarray(model["residual_blocks"], dtype=float)
    if kind == "profile_ar2":
        raw_blocks = model.get("profile_blocks")
        profile_block = np.asarray(
            raw_blocks if raw_blocks is not None else [], dtype=float
        )
        if profile_block.shape == block.shape:
            block = profile_block
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
    for day_position, day in enumerate(np.unique(local_dates)):
        positions = np.flatnonzero(local_dates == day)
        if shared_draws:
            # A11: dieselben Zufallszahlen für dieses (Horizont, Tagesposition)
            # in allen Stationen — die Abbildung auf die Blöcke bleibt je
            # Station eigen (comonotone Kopplung, Konzept §4.2).
            uniform = shared_day_uniforms(cfg, hours, day_position)
            draws = blocks_from_uniform(uniform, len(block), block_weights)
        elif block_weights is None:
            draws = rng.integers(0, len(block), size=cfg.bootstrap_samples)
        else:
            draws = rng.choice(len(block), size=cfg.bootstrap_samples, p=block_weights)
        drawn = block[draws[:, None], slot[positions]]
        # Fix für 12-Uhr-Verstöße durch wechselnde NaN-Mengen: Ein fehlender
        # Tagesblock an einem Slot (z. B. Nachtlücke) führte zu NaN-Pfaden,
        # die aus dem Quantil herausfielen — das Quantil konnte dadurch
        # steigen, obwohl jeder einzelne Pfad fallend war. Fehlende Residuen
        # werden mit 0 gefüllt (Struktur allein), damit alle Ziehungen an
        # gestützten Slots endlich bleiben und die Monotonie der Quantile
        # aus der Monotonie der Pfade folgt.
        drawn = np.where(np.isfinite(drawn), drawn, 0.0)
        paths[:, positions] = point[positions] + drawn
    # Die 12-Uhr-Regel gilt für jedes Szenario, nicht nur für den Median.
    # B15: Pfade je Segment deduplizieren statt jeden Vollpfad einzeln zu
    # projizieren — bitgleich, aber deutlich weniger Projektionsarbeit.
    paths = project_paths(paths, index, cfg, segments=segments)
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore", message="All-NaN slice encountered", category=RuntimeWarning
        )
        quantiles = np.nanquantile(paths, QUANTILES, axis=0).T
    supported &= np.isfinite(quantiles).all(axis=1)
    quantiles[~supported] = np.nan
    # Fix 12-Uhr-Verstöße durch wechselnde NaN-Mengen: Selbst wenn jeder
    # Pfad einzeln nicht-steigend ist, kann das Quantil steigen, wenn die
    # Teilmenge der endlichen Pfade wechselt (z. B. Nachtlücke). Die finale
    # Veröffentlichung muss deshalb selbst projiziert werden. Zusätzlich wird
    # die Quantil-Ordnung (q025 ≤ q10 ≤ q50 ≤ q90 ≤ q975) erhalten — min/max
    # zweier fallender Folgen bleibt fallend, daher bleibt die 12-Uhr-Regel
    # nach dem Clippen erhalten.
    for qi in range(quantiles.shape[1]):
        quantiles[:, qi] = noon_law_projection(
            quantiles[:, qi], index, cfg, segments=segments
        )
    # Ordnung je Zeitpunkt wahren (Sicherheitsnetz für unabhängige Projektion)
    # q50 ist Anker, untere Quantile ≤ Anker, obere ≥ Anker.
    # NaN bleibt NaN (ungestützt).
    q50_idx = Q_COLUMNS.index("q50")
    q10_idx = Q_COLUMNS.index("q10")
    q025_idx = Q_COLUMNS.index("q025")
    q90_idx = Q_COLUMNS.index("q90")
    q975_idx = Q_COLUMNS.index("q975")
    # Untere: min erhält fallend
    quantiles[:, q10_idx] = np.where(
        np.isfinite(quantiles[:, q10_idx]) & np.isfinite(quantiles[:, q50_idx]),
        np.minimum(quantiles[:, q10_idx], quantiles[:, q50_idx]),
        quantiles[:, q10_idx],
    )
    quantiles[:, q025_idx] = np.where(
        np.isfinite(quantiles[:, q025_idx]) & np.isfinite(quantiles[:, q10_idx]),
        np.minimum(quantiles[:, q025_idx], quantiles[:, q10_idx]),
        quantiles[:, q025_idx],
    )
    # Obere: max erhält fallend
    quantiles[:, q90_idx] = np.where(
        np.isfinite(quantiles[:, q90_idx]) & np.isfinite(quantiles[:, q50_idx]),
        np.maximum(quantiles[:, q90_idx], quantiles[:, q50_idx]),
        quantiles[:, q90_idx],
    )
    quantiles[:, q975_idx] = np.where(
        np.isfinite(quantiles[:, q975_idx]) & np.isfinite(quantiles[:, q90_idx]),
        np.maximum(quantiles[:, q975_idx], quantiles[:, q90_idx]),
        quantiles[:, q975_idx],
    )
    result = pd.DataFrame(quantiles, index=index, columns=Q_COLUMNS)
    result.index.name = "timestamp"
    result["structure"] = np.where(supported, structure, np.nan)
    result["harmonic_ar2"] = np.where(supported, point_harmonic, np.nan)
    result["profile_ar2"] = (
        np.where(supported, point_profile, np.nan)
        if point_profile is not None
        else np.nan
    )
    result["ensemble"] = np.where(supported, point, np.nan)
    result["naive"] = np.asarray(model["naive_profile"], dtype=float)[slot]
    result["support_days"] = counts[slot]
    result["supported"] = supported
    if return_paths:
        # P-Seite (Konzept §4.1–4.3): die volle Verteilung mitliefern. An
        # ungestützten Punkten gibt es keine definierte Wahrscheinlichkeit —
        # dort wie bei den Quantilen NaN, damit der Decision Layer sauber
        # zwischen „P=0“ und „keine Aussage“ unterscheiden kann.
        paths[:, ~supported] = np.nan
        return result, paths
    return result
