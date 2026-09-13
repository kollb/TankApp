"""Leichte Selektions-Berechnung für das NAS — ohne matplotlib, ohne OSRM.

Berechnet je Stadt:
  δ̂ (Median relativ zum LOO-Stadtmedian) plus EW-Median über Tages-δ̂
  (Issue 48/F5: Halbwertszeit 7 Tage, CUSUM-Strukturbruch-Flag),
  Bootstrap-KI (exponentiell gewichteter Tages-Block-Bootstrap B=2000,
  95 %; Issue 46: neuere Tage höheres Ziehgewicht),
  q-Wert (Benjamini-Hochberg),
  AV-Score (P(Top-3 | Stunde) gewichtet),
  billigste Stunde (robuste harmonische Regression),
  Zyklus-Amplitude und R²,
  Volatilität σ und Rang-Std.

Eingang: normalisierte Beobachtungen (DataFrame aus engine.data.load_observations)
mit Spalten timestamp, station_id, city, fuel, price, status_known etc.
Ausgang: JSON-serialisierbare Struktur für /api/v1/selection und runtime/selection/current.json
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class SelectionConfig:
    fuel: str = "E10"
    min_coverage: float = 0.85
    n_boot: int = 2000
    step_min: int = 5
    ffill_minutes: float | None = None
    tank_volume: float = 40.0
    seed: int = 42
    # Issue 46: Tagesblock-Bootstrap exponentiell gewichtet (neuere Tage
    # höhere Ziehwahrscheinlichkeit). Halbwertszeit in Tagen, None = uniform.
    boot_ew_half_life_days: float | None = 14.0
    # Issue 48 (F5): Effektgröße δ̂ als EW-Median — die letzten ~5 Tage
    # wiegen deutlich stärker als 5 Wochen alte Beobachtungen, damit ein
    # Betreiber-/Strategiewechsel nicht ~21 Tage im Median verschwindet.
    # Halbwertszeit in Tagen, None = klassischer Median.
    delta_ew_half_life_days: float | None = 7.0
    # B21: Polling-Fenster, in dem der Collector überhaupt Daten holt
    # (Default identisch zu ``engine.config.Config``: 06–24 Uhr
    # Europe/Berlin). Coverage wird nur über diese Zellen gemessen — die
    # Nachtzellen sind strukturell leer und machen ein absolutes 85-%-Gate
    # gegen das volle 24-h-Raster unerreichbar (Maximalwert 77,5 %).
    poll_start: int = 6
    poll_end: int = 24
    timezone: str = "Europe/Berlin"


def _to_matrix(
    df: pd.DataFrame, city: str, step_min: int, ffill_min: float | None
) -> pd.DataFrame:
    """Pivot auf regelmäßiges Raster, Lücken bis ffill_min vorwärts füllen."""
    d = df[df.city == city]
    if d.empty:
        return pd.DataFrame()
    # Sicherstellen dass timestamp datetime ist
    if not pd.api.types.is_datetime64_any_dtype(d["timestamp"]):
        d = d.copy()
        d["timestamp"] = pd.to_datetime(d["timestamp"], utc=True)
    mat = d.pivot_table(
        index="timestamp", columns="station_id", values="price", aggfunc="mean"
    ).sort_index()
    if mat.empty:
        return mat
    grid = pd.date_range(
        mat.index.min().floor(f"{step_min}min"),
        mat.index.max().ceil(f"{step_min}min"),
        freq=f"{step_min}min",
    )
    mat = mat.reindex(grid)
    if ffill_min is None:
        # Kadenz aus ursprünglichen Beobachtungszeitpunkten
        st = d.sort_values(["station_id", "timestamp"]).groupby("station_id")[
            "timestamp"
        ]
        gaps = st.diff().dropna() / pd.Timedelta(minutes=1)
        med_gap = float(gaps.median()) if len(gaps) else 0.0
        ffill_min = (
            max(30.0, 3.0 * med_gap) if med_gap <= 6 else max(180.0, 3.0 * med_gap)
        )
    limit = max(1, round(ffill_min / step_min))
    return mat.ffill(limit=limit)


def scheduled_mask(index: pd.DatetimeIndex, cfg: SelectionConfig) -> np.ndarray:
    """True für Rasterzellen innerhalb des Polling-Fensters (B21).

    Der Collector pollt ``poll_start``–``poll_end`` Uhr; die übrigen Zellen
    sind strukturell leer, egal wie vollständig die Daten sind. Ein
    Coverage-Nenner über das volle Raster bestraft deshalb den Betrieb statt
    der Datenqualität (gemessen: 77,5 % Maximalwert bei lückenlosem
    5-Minuten-Polling 06–24 Uhr — das Gate ``min_coverage=0.85`` kann nie
    erreicht werden). Naive Indizes werden ohne Zeitumrechnung gelesen; ein
    ungültiges Fenster bedeutet „alles zählt“.
    """
    if index.empty or not 0 <= cfg.poll_start < cfg.poll_end <= 24:
        return np.ones(len(index), dtype=bool)
    hours = (
        index.hour.to_numpy()
        if getattr(index, "tz", None) is None
        else index.tz_convert(cfg.timezone).hour.to_numpy()
    )
    return (hours >= cfg.poll_start) & (hours < cfg.poll_end)


def coverage_gate(
    coverage: pd.Series, cfg: SelectionConfig
) -> tuple[pd.Index, float, float]:
    """B21: Wer bleibt nach dem Coverage-Gate im Ranking?

    Liefert (behaltene Stationen, Referenz-Coverage der Stadt, wirksame
    Schwelle). Die Schwelle ist **relativ zum Bestwert der Stadt**
    (``min_coverage`` × Referenz), nicht absolut gegen das theoretische
    Raster — zwei strukturelle Gründe, beide am 13.09.2026 gemessen:

    1. Nachtzellen: Der Collector pollt 06–24 Uhr. Auch nach der
       Fenster-Korrektur oben bleibt ein Rest, den keine Station erreichen
       kann (Request-Budget, Round-Robin über Stadtsets).
    2. Archiv-Modus: Das Tankerkönig-Archiv liefert Preis-*Ereignisse*, keine
       5-Minuten-Punkte. Im Bootstrap-Betrieb (Archiv-Präfix + Live) bestimmt
       die dichte Live-Phase den Median-Gap und damit das 30-Minuten-ffill;
       ein Archiv-Ereignis deckt dann 30 von 216 Tageszellen ab — gemessen
       4,8 % Coverage bei vollständigem Datenstand.

    Ein absolutes Gate schließt in beiden Fällen **alle** Stationen aus
    („e10: 0 Stationen“ im Job-Log vom 12.09.2026). Relativ zur Stadt
    ausgeschlossen wird dagegen, wer deutlich seltener liefert als die
    Vergleichsstationen — genau die Datenqualität, die das Gate schützen soll.
    """
    reference = float(coverage.max()) if len(coverage) else 0.0
    if not np.isfinite(reference) or reference <= 0:
        return coverage.index[:0], 0.0, 0.0
    threshold = cfg.min_coverage * reference
    keep = coverage[coverage >= threshold].index
    return keep, reference, float(threshold)


def _loo_baseline(mat: pd.DataFrame) -> pd.DataFrame:
    vals = mat.to_numpy(dtype=float)
    T, S = vals.shape
    if S < 2:
        return pd.DataFrame(np.nan, index=mat.index, columns=mat.columns)
    srt = np.sort(vals, axis=1)
    ranks = np.argsort(vals, axis=1)
    pos = np.empty_like(ranks)
    np.put_along_axis(pos, ranks, np.arange(S)[None, :], axis=1)
    valid = ~np.isnan(vals)
    cnt = valid.sum(axis=1)
    out = np.full((T, S), np.nan)
    for j in range(S):
        pj_valid = valid[:, j]
        k = pos[:, j]
        m = cnt - 1
        i1 = m // 2
        src1 = np.where(i1 < k, i1, i1 + 1)
        ia, ib = m // 2 - 1, m // 2
        srca = np.where(ia < k, ia, ia + 1)
        srcb = np.where(ib < k, ib, ib + 1)
        med_odd = srt[np.arange(T), np.clip(src1, 0, S - 1)]
        med_even = 0.5 * (
            srt[np.arange(T), np.clip(srca, 0, S - 1)]
            + srt[np.arange(T), np.clip(srcb, 0, S - 1)]
        )
        odd = m % 2 == 1
        med = np.where(odd, med_odd, med_even)
        ok = pj_valid & (m >= 3)
        out[ok, j] = med[ok]
    return pd.DataFrame(out, index=mat.index, columns=mat.columns)


def exp_weights(n: int, half_life_days: float | None) -> np.ndarray | None:
    """Exponentielle Gewichte (ältester zuerst, neuester zuletzt).

    Gewicht bei Alter ``a`` (0 = neuester): ``0.5 ** (a / half_life)``,
    normiert auf Summe 1. ``None`` (oder ungültig) = uniform.
    """
    if n <= 0 or half_life_days is None:
        return None
    try:
        half_life = float(half_life_days)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(half_life) or half_life <= 0:
        return None
    ages = np.arange(n - 1, -1, -1, dtype=float)
    weights = 0.5 ** (ages / half_life)
    total = float(weights.sum())
    if total <= 0 or not np.isfinite(total):
        return None
    return weights / total


def weighted_median(values: np.ndarray, weights: np.ndarray | None) -> float:
    """Median mit Gewichten; ohne Gewichte der klassische Median.

    Bei exakt kumuliertem Gewicht 0,5 an einer Stufe wird mit dem
    Nachbarwert gemittelt — dadurch stimmt der EW-Median bei uniformen
    Gewichten mit dem klassischen Median überein.
    """
    values = np.asarray(values, dtype=float)
    mask = np.isfinite(values)
    raw_weights = None if weights is None else np.asarray(weights, dtype=float)
    values = values[mask]
    if len(values) == 0:
        return float("nan")
    if raw_weights is None or len(raw_weights) != len(mask):
        return float(np.median(values))
    weights = raw_weights[mask]
    total = float(weights.sum())
    if total <= 0 or not np.isfinite(total):
        return float(np.median(values))
    order = np.argsort(values, kind="stable")
    cumulative = np.cumsum(weights[order]) / total
    position = int(np.searchsorted(cumulative, 0.5))
    if position + 1 < len(values) and abs(float(cumulative[position]) - 0.5) < 1e-12:
        return float((values[order[position]] + values[order[position + 1]]) / 2.0)
    return float(values[order[position]])


def daily_median_series(
    delta: np.ndarray, days: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Tages-δ̂-Werte in chronologischer Reihenfolge (ältester zuerst).

    Liefert (Tages-Keys, Tagesmediane); Tage ohne endliche Werte entfallen.
    """
    uniq = np.unique(days[~np.isnan(days)])
    keys, medians = [], []
    for day in uniq:
        values = delta[days == day]
        values = values[np.isfinite(values)]
        if len(values):
            keys.append(day)
            medians.append(float(np.median(values)))
    return np.asarray(keys, dtype=float), np.asarray(medians, dtype=float)


def cusum_break(daily: np.ndarray, h: float = 2.0) -> tuple[bool, float]:
    """Retrospektiver CUSUM-Changepoint-Test auf Tages-δ̂ (Issue 48 / F5).

    Statistik: maximale kumulierte Median-Abweichung, robust skaliert:
    ``max|Σ(x−median)| / (σ·√n)``. Die Skala σ kommt aus dem MAD der
    sukzessiven Differenzen (ein Niveauwechsel kontaminiert nur eine
    Differenz; ein gepoolter MAD würde den Wechsel selbst als Streuung
    maskieren). Schwelle ``h=2,0`` (≈96–97 %-Niveau unter iid-Normalität,
    empirisch kalibriert; konservativ, damit der Flag ein Warnsignal
    bleibt und kein Dauerfeuer). Liefert (flag, stat). Der primäre
    Mechanismus gegen Strukturblindheit bleibt der EW-Median; der Flag
    markiert nur plausible Regimewechsel (z. B. Betreiberwechsel) zur
    manuellen Prüfung.
    """
    daily = np.asarray(daily, dtype=float)
    daily = daily[np.isfinite(daily)]
    count = len(daily)
    if count < 10:
        return False, 0.0
    med = float(np.median(daily))
    gaps = np.diff(daily)
    mad_gap = float(np.median(np.abs(gaps - np.median(gaps))))
    sigma = 1.4826 * mad_gap / np.sqrt(2)
    if not np.isfinite(sigma) or sigma < 1e-9:
        return False, 0.0
    stat = float(np.max(np.abs(np.cumsum(daily - med))) / (sigma * np.sqrt(count)))
    if not np.isfinite(stat):
        return False, 0.0
    return bool(stat > h), stat


def _day_block_bootstrap(
    delta: np.ndarray,
    days: np.ndarray,
    n_boot: int,
    rng: np.random.Generator,
    half_life_days: float | None = None,
):
    """Tages-Block-Bootstrap des Medians: Tage ziehen, Beobachtungen poolen.

    Jede Ziehung konkateniert die (endlichen) Tagesblöcke und nimmt den
    Median des Pools — das schätzt dieselbe Statistik wie δ̂ (Median über
    alle Zeitpunkte). Ein Median von Tagesmedianen würde dünn besetzte
    Tage (z. B. Anlaufrümpfe) übergewichten.

    Mit ``half_life_days`` (Issue 46) werden neuere Tagesblöcke
    exponentiell höher gewichtet gezogen; ``None`` = uniform.
    """
    uniq = np.unique(days[~np.isnan(days)])
    blocks = []
    for day in uniq:
        values = delta[days == day]
        values = values[np.isfinite(values)]
        if len(values):
            blocks.append(values)
    boots = np.empty(n_boot)
    boots[:] = np.nan
    day_med = np.array([np.median(block) for block in blocks])
    if not blocks:
        return boots, day_med
    weights = exp_weights(len(blocks), half_life_days)
    for b in range(n_boot):
        if weights is None:
            take = rng.integers(0, len(blocks), size=len(blocks))
        else:
            take = rng.choice(len(blocks), size=len(blocks), p=weights)
        pooled = np.concatenate([blocks[i] for i in take])
        boots[b] = np.median(pooled)
    return boots, day_med


def _benjamini_hochberg(pvals: np.ndarray) -> np.ndarray:
    p = np.asarray(pvals, float)
    n = p.size
    if n == 0:
        return p
    order = np.argsort(p)
    ranks = np.empty(n, int)
    ranks[order] = np.arange(1, n + 1)
    q = p * n / ranks
    q_sorted = np.minimum.accumulate(q[order][::-1])[::-1]
    out = np.empty(n)
    out[order] = np.clip(q_sorted, 0, 1)
    return out


def _huber_irls(
    X: np.ndarray, y: np.ndarray, w_base: np.ndarray, rounds: int = 8, c: float = 1.345
):
    sw = np.sqrt(w_base)
    beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    for _ in range(rounds):
        r = y - X @ beta
        s = 1.4826 * np.median(np.abs(r - np.median(r))) + 1e-9
        w_h = np.minimum(1.0, c * s / np.abs(r + 1e-12))
        sw = np.sqrt(w_base * w_h)
        beta_new, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
        if np.max(np.abs(beta_new - beta)) < 1e-10:
            beta = beta_new
            break
        beta = beta_new
    return beta, sw**2


def _harmonic_fit(hour_bins: np.ndarray, med: np.ndarray, w: np.ndarray):
    ok = ~np.isnan(med)
    if ok.sum() < 5:
        return float("nan"), float("nan"), float("nan"), np.array([]), np.array([])
    h = hour_bins[ok]
    y = med[ok]
    w = w[ok].astype(float)
    om = 2 * np.pi / 24.0
    X = np.column_stack(
        [
            np.ones_like(h),
            np.cos(om * h),
            np.sin(om * h),
            np.cos(2 * om * h),
            np.sin(2 * om * h),
        ]
    )
    beta, w_tot = _huber_irls(X, y, w)
    resid = y - X @ beta
    y_bar = np.average(y, weights=w_tot)
    ss_res = np.sum(w_tot * resid**2)
    ss_tot = np.sum(w_tot * (y - y_bar) ** 2)
    r2 = float(1 - ss_res / ss_tot) if ss_tot > 1e-12 else float("nan")
    grid = np.arange(0, 24, 0.5)
    Xg = np.column_stack(
        [
            np.ones_like(grid),
            np.cos(om * grid),
            np.sin(om * grid),
            np.cos(2 * om * grid),
            np.sin(2 * om * grid),
        ]
    )
    curve = Xg @ beta
    amp = float(np.hypot(beta[1], beta[2]) + np.hypot(beta[3], beta[4]))
    best_hour = float(grid[np.argmin(curve)])
    return r2, amp, best_hour, grid, curve


def _diagnostic(
    city: str,
    cfg: SelectionConfig,
    mat: pd.DataFrame,
    excluded: list,
    reason: str,
    coverage: pd.Series | None = None,
    **extra,
) -> dict:
    """Stadt-Eintrag ohne Ranking, aber mit Grund (B21).

    „0 Stationen“ war im Job-Log nicht debuggbar; jeder Abbruch trägt deshalb
    die Zahlen bei, die ihn erklären: Reichweite, Punktzahl, ausgeschlossene
    Stationen und die Coverage-Schwelle samt Referenz.
    """
    entry = {
        "city": city,
        "fuel": cfg.fuel,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "range_from": mat.index.min().isoformat() if len(mat.index) else None,
        "range_to": mat.index.max().isoformat() if len(mat.index) else None,
        "n_points": int(mat.notna().to_numpy().sum()) if not mat.empty else 0,
        "n_days": int(len(mat.index.normalize().unique())) if not mat.empty else 0,
        "station_count": 0,
        "excluded_count": len(excluded),
        "excluded": list(excluded[:20]),
        "stations": [],
        "reason": reason,
        "coverage_window": f"{cfg.poll_start:02d}-{cfg.poll_end:02d}",
    }
    if coverage is not None and len(coverage):
        entry["coverage_min"] = float(coverage.min())
        entry["coverage_max"] = float(coverage.max())
    entry.update(extra)
    return entry


def analyse_city_light(
    df: pd.DataFrame,
    city: str,
    cfg: SelectionConfig,
    rng: np.random.Generator,
    metas: dict,
) -> dict | None:
    """Berechnet Selektions-Kennzahlen für eine Stadt, ohne Plots.

    B21: Liefert auch bei zu wenig Stationen ein diagnostisches Dict statt
    None, damit „0 Stationen“ im Log erklärbar ist (Coverage, <4 Stationen).
    Nur bei völlig leerer Matrix bleibt None — dann hat die Stadt schlicht
    keine Daten für diesen Fuel.

    Coverage (Datenqualitäts-Gate, Konzept §2 Zeile 6) wird über die Zellen
    des Polling-Fensters gemessen und relativ zum Bestwert der Stadt
    angewandt — siehe ``scheduled_mask`` und ``coverage_gate``.
    """
    mat = _to_matrix(df, city, cfg.step_min, cfg.ffill_minutes)
    if mat.empty:
        return None
    if mat.shape[1] < 2:
        # Zu wenig Stationen für LOO — Diagnose statt stilles None.
        return _diagnostic(
            city,
            cfg,
            mat,
            list(mat.columns),
            f"nur {mat.shape[1]} Station(en) mit Daten — LOO braucht ≥2 (≥4 für δ̂)",
        )
    # B21: Coverage nur über die Zellen des Polling-Fensters (06–24 Uhr) —
    # gegen das volle 24-h-Raster ist das Gate strukturell unerreichbar.
    scheduled = scheduled_mask(mat.index, cfg)
    if scheduled.any():
        coverage = pd.Series(
            mat.notna().to_numpy()[scheduled].mean(axis=0), index=mat.columns
        )
    else:
        coverage = mat.notna().mean(axis=0)
    keep, coverage_reference, coverage_threshold = coverage_gate(coverage, cfg)
    excluded = [sid for sid in coverage.index if sid not in set(keep)]
    mat = mat[keep]
    # Die LOO-Baseline verlangt ≥ 3 Vergleichsstationen je Zeitpunkt (m ≥ 3).
    # Mit weniger als 4 Stationen wäre δ̂ überall NaN — ehrlich abbrechen,
    # statt eine NaN-Tabelle zu publizieren. B21: Diagnose zurückgeben.
    if mat.shape[1] < 4:
        return _diagnostic(
            city,
            cfg,
            mat,
            excluded,
            f"nach Coverage-Gate (≥{cfg.min_coverage:.0%} vom Stadt-Bestwert "
            f"{coverage_reference:.0%} im Fenster "
            f"{cfg.poll_start:02d}–{cfg.poll_end:02d} Uhr) nur {mat.shape[1]} "
            f"Station(en) übrig — LOO braucht ≥4",
            coverage=coverage,
            coverage_reference=coverage_reference,
            coverage_threshold=coverage_threshold,
        )

    base = _loo_baseline(mat)
    delta = (mat - base) * 100.0  # ct/L relativ

    hours = mat.index.hour.to_numpy() + mat.index.minute.to_numpy() / 60.0
    days = mat.index.normalize()
    day_keys = {d: i for i, d in enumerate(days.unique())}
    dnum = np.array([day_keys[d] for d in days], dtype=float)

    rank = mat.rank(axis=1, method="min", na_option="keep")
    win = (rank <= 3).astype(float).where(mat.notna())
    P = np.full((mat.shape[1], 24), np.nan)
    hour_arr = np.floor(hours).astype(int)
    for hi in range(24):
        sel = hour_arr == hi
        if sel.any():
            P[:, hi] = np.nanmean(win.to_numpy()[sel], axis=0)

    w = np.zeros(24)
    w[[6, 7, 8, 16, 17, 18, 19]] = 1.0
    wd_weight, we_weight = 5 / 7, 2 / 7
    w_weekday = w / w.sum() * wd_weight if w.sum() else np.zeros(24)
    w_weekend = np.full(24, 1 / 24) * we_weight
    w_user = w_weekday + w_weekend

    sids = list(mat.columns)
    rows = []
    # B21: Stationen ohne einzigen verwertbaren Zeitpunkt (LOO braucht ≥4
    # Stationen mit Wert zur selben Zeit) haben kein δ̂. Sie fallen aus dem
    # Ranking, statt als NaN-Zeile publiziert zu werden — und der Grund steht
    # im Artefakt.
    no_delta = []
    for j, sid in enumerate(sids):
        d = delta[sid].to_numpy()
        d_hat = float(np.nanmedian(d))
        if not np.isfinite(d_hat):
            no_delta.append(sid)
            continue
        boots, _ = _day_block_bootstrap(
            d, dnum, cfg.n_boot, rng, cfg.boot_ew_half_life_days
        )
        lo, hi = (
            np.nanpercentile(boots, [2.5, 97.5])
            if np.isfinite(boots).any()
            else (float("nan"), float("nan"))
        )
        p_raw = (
            float((1 + np.sum(boots >= 0)) / (cfg.n_boot + 1))
            if np.isfinite(boots).any()
            else float("nan")
        )
        # Issue 48 (F5): EW-Median über Tages-δ̂ + CUSUM-Strukturbruch.
        # Der klassische Median bleibt als delta_ct erhalten; delta_ew_ct
        # reagiert bei Regimewechsel deutlich schneller (Halbwertszeit
        # Default 7 Tage: 5 Tage alte Tage wiegen ~61 %, 5 Wochen alte
        # noch ~3 %).
        _day_keys, _day_meds = daily_median_series(d, dnum)
        _ew_weights = exp_weights(len(_day_meds), cfg.delta_ew_half_life_days)
        d_ew = weighted_median(_day_meds, _ew_weights)
        d_recent5 = (
            float(np.median(_day_meds[-5:]))
            if len(_day_meds) >= 5 and np.isfinite(_day_meds[-5:]).any()
            else float("nan")
        )
        break_flag, break_stat = cusum_break(_day_meds)

        half = np.floor(hours * 2) / 2
        bins = np.arange(0, 24, 0.5)
        med = np.array([np.nanmedian(d[half == b]) for b in bins])
        cnt = np.array([np.sum(~np.isnan(d[half == b])) for b in bins])
        r2, amp, best_hour, _, _ = _harmonic_fit(bins, med, cnt)

        mad = (
            float(np.nanmedian(np.abs(d - d_hat)))
            if np.isfinite(d).any()
            else float("nan")
        )
        sigma = float(1.4826 * mad) if np.isfinite(mad) else float("nan")
        daily_rank = rank[sid].groupby(days).mean()
        rank_std = float(daily_rank.std()) if len(daily_rank) else float("nan")
        # AV über endliche Zellen renormiert: Stunden ohne Beobachtung
        # tragen 0 bei nansum bei und würden den Score sonst systematisch
        # drücken (fehlende Nachtstunden ≠ nie Top-3).
        _mask = np.isfinite(P[j])
        _wsum = float(w_user[_mask].sum()) if _mask.any() else 0.0
        avail = (
            float(np.sum(P[j][_mask] * w_user[_mask]) / _wsum)
            if _wsum > 0
            else float("nan")
        )

        meta = metas.get(sid, {})
        rows.append(
            dict(
                station_id=sid,
                city=city,
                name=meta.get("name") or sid,
                brand=meta.get("brand") or "",
                lat=meta.get("lat"),
                lon=meta.get("lon"),
                dist_km=meta.get("dist_km"),
                dist_mode=meta.get("dist_mode"),
                maps_url=meta.get("maps_url"),
                coverage=float(coverage[sid]),
                delta_ct=d_hat,
                delta_ew_ct=float(d_ew),
                delta_recent5_ct=float(d_recent5),
                delta_days=int(len(_day_meds)),
                break_flag=bool(break_flag),
                break_stat=float(break_stat),
                ci_lo=float(lo),
                ci_hi=float(hi),
                p_value=p_raw,
                avail=float(avail) if np.isfinite(avail) else None,
                best_hour=float(best_hour) if np.isfinite(best_hour) else None,
                cycle_amp=float(amp) if np.isfinite(amp) else None,
                cycle_r2=float(r2) if np.isfinite(r2) else None,
                vol_ct=float(sigma) if np.isfinite(sigma) else None,
                rank_std=float(rank_std) if np.isfinite(rank_std) else None,
            )
        )

    if not rows:
        # B21: Auch das ist ein erklärbarer Abbruch, kein stilles None —
        # sonst verschwindet die Stadt kommentarlos aus dem Artefakt.
        return _diagnostic(
            city,
            cfg,
            mat,
            excluded + no_delta,
            f"{len(no_delta)} Station(en) ohne verwertbares δ̂ — zu wenig "
            f"gleichzeitige Werte (LOO braucht ≥4 Stationen je Zeitpunkt)",
            coverage=coverage,
            coverage_reference=coverage_reference,
            coverage_threshold=coverage_threshold,
        )

    tab = pd.DataFrame(rows)
    tab["q_value"] = _benjamini_hochberg(tab["p_value"].to_numpy())
    tab["significant"] = tab["q_value"] < 0.05

    def z(s: pd.Series) -> pd.Series:
        sd = s.std(ddof=0)
        return (s - s.mean()) / (sd if sd > 1e-12 else 1.0)

    # Composite-Score
    # Fehlende Werte mit 0 ersetzen für Score, aber Original erhalten.
    # Issue 48: Das Niveau-Gewicht nutzt den EW-Median (aktuelles Regime),
    # mit Fallback auf den klassischen Median bei zu kurzer Historie.
    level = tab["delta_ew_ct"].fillna(tab["delta_ct"]).fillna(0)
    tab["score"] = (
        0.40 * z(-level)
        + 0.25 * z(tab["avail"].fillna(0))
        + 0.15 * z(tab["cycle_r2"].fillna(0))
        - 0.10 * z(tab["vol_ct"].fillna(0))
        - 0.10 * z(tab["rank_std"].fillna(0))
    )
    tab["saving_per_fill_eur"] = -tab["delta_ct"] * cfg.tank_volume / 100.0
    tab["saving_ew_per_fill_eur"] = -level * cfg.tank_volume / 100.0

    # Split-Half-Stabilität
    uniq_days = days.unique()
    h = len(uniq_days) // 2
    if h >= 5:
        m1 = delta.loc[delta.index.normalize().isin(uniq_days[:h])].median(axis=0)
        m2 = delta.loc[delta.index.normalize().isin(uniq_days[h:])].median(axis=0)
        try:
            stability = float(
                pd.concat([m1, m2], axis=1).corr(method="spearman").iloc[0, 1]
            )
        except Exception:
            stability = float("nan")
    else:
        stability = float("nan")

    tab = tab.sort_values("score", ascending=False).reset_index(drop=True)
    tab.insert(0, "rank", tab.index + 1)

    # JSON-sicher machen
    result = {
        "city": city,
        "fuel": cfg.fuel,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        # C11: Datenreichweite des Rankings. „Rang 1“ aus zehn Tagen ist eine
        # andere Aussage als „Rang 1“ aus drei Monaten; ohne Fenster und
        # Punktzahl kann die GUI diesen Unterschied nicht zeigen.
        "range_from": mat.index.min().isoformat(),
        "range_to": mat.index.max().isoformat(),
        "n_points": int(mat.notna().to_numpy().sum()),
        "n_days": int(len(uniq_days)),
        "station_count": len(tab),
        "excluded_count": len(excluded),
        "excluded": excluded[:20],
        # B21: Ausweis des Coverage-Gates — woran gemessen wurde (Fenster,
        # Bestwert der Stadt, wirksame Schwelle) und wer ohne δ̂ blieb.
        # Ohne diese Zahlen ist „warum ist Station X nicht dabei?“ nicht
        # beantwortbar.
        "coverage_window": f"{cfg.poll_start:02d}-{cfg.poll_end:02d}",
        "coverage_reference": coverage_reference,
        "coverage_threshold": coverage_threshold,
        "no_delta_count": len(no_delta),
        "no_delta": no_delta[:20],
        "stability": stability,
        "stations": tab.to_dict(orient="records"),
    }
    return result


def compute_all(df: pd.DataFrame, cfg: SelectionConfig, metas_by_city: dict) -> dict:
    """Berechnet Selektion für alle Städte im DataFrame.

    B21: Auch Städte mit 0 Stationen (z. B. Coverage <85% oder <4 Stationen)
    bleiben als Diagnose-Eintrag erhalten, damit „0 Stationen“ erklärbar ist.
    Nur völlig leere Städte (keine Daten) entfallen.
    """
    rng = np.random.default_rng(cfg.seed)
    cities = sorted(df.city.unique()) if not df.empty else []
    results = []
    diagnostics = []
    for city in cities:
        city_metas = metas_by_city.get(city, {})
        res = analyse_city_light(df, city, cfg, rng, city_metas)
        if res is None:
            continue
        # Städte mit 0 Stationen sind Diagnose, nicht Erfolg — trotzdem behalten
        if res.get("station_count", 1) == 0 and not res.get("stations"):
            diagnostics.append(res)
        else:
            results.append(res)
    # Für das globale Ranking zählen nur echte Rankings; Diagnosen kommen extra
    all_results = results + diagnostics
    # Globales Ranking — nur echte Rankings, Diagnosen haben keine stations
    all_stations = []
    for res in results:
        all_stations.extend(res.get("stations", []))
    all_stations_sorted = sorted(
        all_stations, key=lambda x: x.get("score", 0), reverse=True
    )
    # Reichweite über alle Städte (inkl. Diagnosen, damit Fenster sichtbar bleibt)
    froms = [r["range_from"] for r in all_results if r.get("range_from")]
    tos = [r["range_to"] for r in all_results if r.get("range_to")]
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "fuel": cfg.fuel,
        "cities": all_results,
        "top_global": all_stations_sorted[:10],
        "range_from": min(froms) if froms else None,
        "range_to": max(tos) if tos else None,
        "n_points": sum(int(r.get("n_points") or 0) for r in all_results) or None,
        "n_days": max((int(r.get("n_days") or 0) for r in all_results), default=0)
        or None,
        # B21: Diagnose, warum Städte ohne Ranking blieben
        "diagnostics": diagnostics,
    }
