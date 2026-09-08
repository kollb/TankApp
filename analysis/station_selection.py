#!/usr/bin/env python3
"""
TankApp – Optionale mathematische Tankstellen-Selektion.

Liest historische Preisdaten (CSV, Schema s. data-tools/README.md) für beliebig
viele Städte und wählt je Stadt bzw. global die besten Tankstellen aus. Die
Methodik ist bewusst "hart" gerechnet:

  1. Robuste Relative Preislage  δ_i = median_t[ p_i(t) − median_{j≠i} p_j(t) ]
     (Leave-One-Out-Stadtmedian als Baseline -> keine mechanische Verzerrung;
      Median statt Mittelwert -> resistent gegen Preissprung-Artefakte)
  2. Inferenz: Tages-Block-Bootstrap (B=2000) -> 95 %-KI für δ_i sowie
     einseitiger p-Wert H0: δ_i ≥ 0, Benjamini-Hochberg-FDR-Korrektur über
     alle getesteten Stationen (q-Wert). Damit ist "signifikant billiger"
     multiplizitätsbereinigt nachgewiesen.
  3. Intraday-Struktur: robuste harmonische Regression (Huber-IRLS) der
     Halbstunden-Medianprofile
         Δ_i(h) = a1 cos(ωh) + b1 sin(ωh) + a2 cos(2ωh) + b2 sin(2ωh),  ω = 2π/24
     -> Amplitude A_i, Phase -> "billigste Stunde" h*_i = argmin der Fit-Kurve,
     gewichtetes R² als Zyklus-Vorhersagbarkeit.
  4. Treffer-Wahrscheinlichkeit: P_i(h) = P(Station ∈ Top-3 der Stadt | Stunde h)
     empirisch über alle Tage; daraus Verfügbarkeits-Score AV_i = Σ_h w_h P_i(h)
     für ein Nutzer-Tankzeitprofil w (Default: Pendlerfenster Mo–Fr 06–09/16–20,
     Wochenende gleichverteilt).
  5. Risiko: σ_i = 1.4826·MAD(Δ_i) (robuste Volatilität) und
     Tagesrang-Stabilität ρ_i = Std der täglichen Mittelränge.
  6. Datenqualitäts-Gate: Coverage ≥ 85 %, sonst Ausschluss.
  6b. Feiertage bundeslandspezifisch (--subdiv, z. B. HE/BY/NW): Feiertage werden
      für AV/Tagesform ausgeschlossen; δ̂ bleibt auf allen Tagen (robust).
  7. Composite-Score als gewichtete Summe der z-standardisierten Komponenten
     (Default-Gewichte: Niveau .40, Verfügbarkeit .25, Vorhersagbarkeit .15,
      inverse Volatilität .10, inverse Rangstreuung .10) plus
     Euro-Kennzahlen: Ersparnis pro Tankfüllung/Jahr bei Tankvolumen V.

Ausgaben:
  results/station_scores_<fuel>.csv   vollständige Kennzahlen je Station
  docs/analysis/figures/*.png         Zykluskurven, Heatmaps, Top-10
  docs/analysis/report_top10.md       fertiger Auswahlbericht
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

# json wird sowohl für die --config (unten) als auch für die scores-Metadaten
# (station_scores_<fuel>.meta.json) gebraucht -> immer importieren.

# Optionales Straßen-Routing (data-tools/road_route.py): OSRM/OpenStreetMap
# liefert echte Fahrstrecken + Fahrzeiten statt Luftlinie × Circuity.
# Nur Standardbibliothek; fehlt das Modul, läuft alles weiter mit Haversine.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "data-tools"))
try:
    from road_route import RoadRouter
except ImportError:  # pragma: no cover
    RoadRouter = None

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# Optional: bundeslandspezifische Feiertage (--subdiv, s. KONZEPT.md §2/§3.2).
# Feiertage sind in Deutschland Ländersache: Heilige Drei Könige (06.01.) gilt
# nur in Bayern, Allerheiligen (01.11.) in Bayern/NRW, aber nicht in Hessen —
# deshalb je Stadt ein eigenes Bundesland-Subdiv.
try:
    import holidays as _holidays
except ImportError:  # pragma: no cover
    _holidays = None

# ---------------------------------------------------------------- Konfiguration

@dataclass
class Config:
    fuel: str = "E10"
    top: int = 10
    tank_volume: float = 40.0        # Liter pro Tankfüllung (siehe KONZEPT.md §7)
    fills_per_week: float = 1.2
    min_coverage: float = 0.85
    n_boot: int = 2000
    step_min: int = 5            # Analyse-Raster in Minuten (Historie aus Änderungsdaten: 30/60)
    ffill_minutes: float | None = None   # Horizont "Preis gilt noch" (s. to_matrix)
    w_level: float = 0.40
    w_avail: float = 0.25
    w_pred: float = 0.15
    w_vol: float = 0.10
    w_rank: float = 0.10
    seed: int = 42
    # --- Umweg-Ökonomie (KONZEPT.md §7) ---
    # Referenzpunkt je Stadt (lat, lon). Default: Stations-Schwerpunkt der Stadt.
    home: dict = field(default_factory=dict)
    # Bundesland-Subdiv je Stadt (ISO 3166-2:DE, z. B. 'HE', 'BY', 'NW') für
    # bundeslandspezifische Feiertage. Leer = Feiertage werden nicht modelliert.
    subdiv: dict = field(default_factory=dict)
    consumption_l_100km: float = 7.0   # Fahrzeugverbrauch
    value_of_time: float = 12.0        # €/h Zeitwert
    avg_speed: float = 50.0            # km/h Stadtverkehr (nur ohne echtes Routing)
    # Stau-/Rushhour-Faktor auf die OSRM-Freifluss-Zeit (OSRM kennt keinen Live-Stau):
    # Fahrtzeit_real = Fahrtzeit_freifluss × F. Berufsverkehr 6-9/16-20 Uhr mit
    # f_peak, sonst f_off; über das Nutzerprofil (s. w_user) gemittelt, weil der
    # typische Tankvorgang gewichtet über diese Stunden stattfindet. Freifluss =
    # 50 km/h, Berufsverkehr real ~35 km/h -> f_peak ~1,45 (Worst Case Stop&Go ~2).
    congestion_peak: float = 1.45
    congestion_offpeak: float = 1.0
    # Nahbereich (Straßen-km ab Anker) für die Kontext-Zeitbewertung: Stationen
    # innerhalb dessen tankt man auf dem Arbeitsweg (Berufsverkehr -> f_peak),
    # weiter entfernte Routen-Stationen (Einkaufen/Arbeit am Wochenende, frei
    # zeitlich wählbar) -> f_offpeak. Soll mit --near-km des Polling-Sets
    # übereinstimmen (Default 5 km).
    near_km: float = 5.0
    circuity: float = 1.3              # Luftlinie -> Straßenkilometer (nur ohne/bei Fallback)
    trip_mode: str = "onroute"         # 'dedicated' = Extrafahrt | 'onroute' = beim Tanken ohnehin unterwegs
    rank_by: str = "net"               # 'net' = Netto-Ersparnis nach Umweg | 'score'
    # --- Straßen-Routing (OSRM/OpenStreetMap) ---
    # 'haversine' = Luftlinie × circuity (offline, Default); 'osrm' = echte
    # Straßen-km + Fahrzeit vom OSRM-Server (--osrm-url, mit Cache/Fallback).
    router: str = "haversine"
    osrm_url: str | None = None
    route_cache: Path = field(default_factory=lambda: Path("results") / "road_route_cache.json")

PLT_DARK = {
    "figure.facecolor": "#0e1117", "axes.facecolor": "#0e1117",
    "axes.edgecolor": "#3a4150", "axes.labelcolor": "#c9d1d9",
    "xtick.color": "#8b949e", "ytick.color": "#8b949e",
    "text.color": "#c9d1d9", "grid.color": "#21262d",
    "font.family": "DejaVu Sans", "axes.grid": True,
}

# --------------------------------------------------------------- Datenaufbau

def load_prices(paths: list[Path], fuel: str) -> pd.DataFrame:
    frames = []
    for p in paths:
        df = pd.read_csv(p, parse_dates=["timestamp"])
        need = {"timestamp", "station_id", "station_name", "brand", "city",
                "lat", "lon", "fuel", "price"}
        missing = need - set(df.columns)
        if missing:
            raise ValueError(f"{p}: fehlende Spalten {missing}")
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    df = df[df.fuel.str.upper() == fuel.upper()]
    if df.empty:
        raise ValueError(f"Keine Zeilen für fuel={fuel}")
    return df


def to_matrix(df: pd.DataFrame, city: str, step_min: int,
              ffill_min: int | None = None) -> pd.DataFrame:
    """Pivot auf reguläres step_min-Raster; Stations-Metadaten gehen nicht verloren.

    Lücken werden bis `ffill_min` Minuten vorwärts gefüllt. Default: max(30, 3× Median
    Beobachtungsabstand) — damit auch Daten, die nur PreisÄNDERUNGEN enthalten
    (Tankerkönig-Historie, Poll im 20-Min-Takt), nicht als Lücken verbucht werden.
    NaN bleibt, wo der Preis wirklich unbekannt ist (Staleness, s. KONZEPT.md §3.1).
    """
    d = df[df.city == city]
    mat = (d.pivot_table(index="timestamp", columns="station_id",
                         values="price", aggfunc="mean")
             .sort_index())
    grid = pd.date_range(mat.index.min().floor(f"{step_min}min"),
                         mat.index.max().ceil(f"{step_min}min"),
                         freq=f"{step_min}min")
    mat = mat.reindex(grid)
    if ffill_min is None:
        # Kadenz aus den ursprüglichen Beobachtungszeitpunkten (pro Station), nicht aus dem
        # reindexed Raster — sonst misst man hier immer genau step_min.
        st = d.sort_values(["station_id", "timestamp"]).groupby("station_id")["timestamp"]
        gaps = st.diff().dropna() / pd.Timedelta(minutes=1)
        med_gap = float(gaps.median()) if len(gaps) else 0.0
        # dichte Daten (Poll alle 5 min) wie bisher; späte Historie (nur Änderungen,
        # Lücken durch Nacht/Schließzeiten) braucht einen größeren Horizont, sonst
        # fällt jede Station durchs Coverage-Gate.
        ffill_min = max(30.0, 3.0 * med_gap) if med_gap <= 6 else max(180.0, 3.0 * med_gap)
    return mat.ffill(limit=max(1, round(ffill_min / step_min)))

# ------------------------------------------------- Statistik-Bausteine

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Großkreisdistanz (km)."""
    R = 6371.0088
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = np.radians(lat2 - lat1), np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return float(2 * R * np.arcsin(np.sqrt(a)))


def detour_cost(extra_km_oneway: float, price_ref: float, cfg: Config,
                extra_min_oneway: float | None = None,
                congestion: float = 1.0
                ) -> tuple[float, float, float]:
    """Kosten des Umwegs zur Station, aufgeteilt in Sprit und Zeit.

    K = K_sprit + K_Zeit  [KONZEPT.md §10]
    d_rt = 2·circuity·extra_km_oneway (bzw. 2·extra_km_oneway bei echten
    Straßen-km: circuity steckt schon in der Route, Faktor = 1).
    K_sprit = d_rt·(c/100)·p
    K_Zeit  = t_rt·z  (t_rt = OSRM-Freifluss-Zeit × Staufaktor congestion,
             hin+zurück; ohne Routing d_rt/avg_speed)
    `congestion` schlägt nur auf geroutete OSRM-Zeiten zu (Freifluss ohne
    Stau); die avg_speed-Näherung enthält bereits gemischten Verkehr.
    Rückgabe: (Umweg-km gesamt, Sprit-Kosten €, Zeit-Kosten €). Die Trennung
    ist Absicht: Wer nur Sprit werten will ('lohnt der Umweg an der Zapfsäule
    cash?'), setzt --value-of-time 0 bzw. liest net_fuel_only_eur im CSV.
    """
    circ = 1.0 if (extra_min_oneway is not None and cfg.router == "osrm") else cfg.circuity
    d_rt = 2.0 * circ * extra_km_oneway
    k_fuel = d_rt * (cfg.consumption_l_100km / 100.0) * price_ref
    if extra_min_oneway is not None:
        k_time = (2.0 * extra_min_oneway * congestion / 60.0) * cfg.value_of_time
    else:
        k_time = (d_rt / cfg.avg_speed) * cfg.value_of_time
    return d_rt, k_fuel, k_time



def loo_baseline(mat: pd.DataFrame) -> pd.DataFrame:
    """Leave-One-Out-Median über die jeweils anderen Stationen je Zeitpunkt.

    Exakt und vollständig vektorisiert: Zeile sortieren, Sortierposition jeder
    Station merken, LOO-Median über Indexverschiebung in der sortierten Zeile.
    """
    vals = mat.to_numpy(dtype=float)
    T, S = vals.shape
    srt = np.sort(vals, axis=1)                       # NaN wandern ans Ende
    ranks = np.argsort(vals, axis=1)
    pos = np.empty_like(ranks)
    np.put_along_axis(pos, ranks, np.arange(S)[None, :], axis=1)  # pos[t, j] = Sortierindex
    valid = ~np.isnan(vals)
    cnt = valid.sum(axis=1)                            # gültige Anzahl je Zeile

    out = np.full((T, S), np.nan)
    for j in range(S):
        pj_valid = valid[:, j]
        k = pos[:, j]                                  # Sortierindex von Station j
        m = cnt - 1                                    # Anzahl nach Entfernen
        med = np.full(T, np.nan)
        odd = (m % 2 == 1)
        # ungerade m: Median-Index m//2 im verkürzten Feld
        i1 = m // 2
        src1 = np.where(i1 < k, i1, i1 + 1)            # Verschiebung wegen Entfernen
        # gerade m: Mittel aus Indizes m/2-1 und m/2
        ia, ib = m // 2 - 1, m // 2
        srca = np.where(ia < k, ia, ia + 1)
        srcb = np.where(ib < k, ib, ib + 1)
        med_odd = srt[np.arange(T), np.clip(src1, 0, S - 1)]
        med_even = 0.5 * (srt[np.arange(T), np.clip(srca, 0, S - 1)]
                          + srt[np.arange(T), np.clip(srcb, 0, S - 1)])
        med = np.where(odd, med_odd, med_even)
        ok = pj_valid & (m >= 3)                       # mindestens 3 Vergleichsstationen
        out[ok, j] = med[ok]
    return pd.DataFrame(out, index=mat.index, columns=mat.columns)


def day_block_bootstrap(delta: np.ndarray, days: np.ndarray,
                        n_boot: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Block-Bootstrap über Tage -> verteilte Mediane (B,) und Tagesvektor."""
    uniq = np.unique(days[~np.isnan(days)])
    day_med = np.array([np.nanmedian(delta[days == d]) for d in uniq])
    ok = ~np.isnan(day_med)
    day_med = day_med[ok]
    uniq = uniq[ok]
    boots = np.empty(n_boot)
    n_days = len(uniq)
    for b in range(n_boot):
        take = rng.choice(day_med, size=n_days, replace=True)
        boots[b] = np.median(take)
    return boots, day_med


def benjamini_hochberg(pvals: np.ndarray) -> np.ndarray:
    p = np.asarray(pvals, float)
    n = p.size
    order = np.argsort(p)
    ranks = np.empty(n, int)
    ranks[order] = np.arange(1, n + 1)
    q = p * n / ranks
    q_sorted = np.minimum.accumulate(q[order][::-1])[::-1]
    out = np.empty(n)
    out[order] = np.clip(q_sorted, 0, 1)
    return out


def _huber_irls(X: np.ndarray, y: np.ndarray, w_base: np.ndarray,
                rounds: int = 8, c: float = 1.345) -> np.ndarray:
    """IRLS mit Huber-ψ (Kanal-korrekt: Zeilen werden mit √w skaliert)."""
    sw = np.sqrt(w_base)
    beta, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
    for _ in range(rounds):
        r = y - X @ beta
        s = 1.4826 * np.median(np.abs(r - np.median(r))) + 1e-9
        w_h = np.minimum(1.0, c * s / np.abs(r + 1e-12))   # ψ(r)/r
        sw = np.sqrt(w_base * w_h)
        beta_new, *_ = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)
        if np.max(np.abs(beta_new - beta)) < 1e-10:
            beta = beta_new
            break
        beta = beta_new
    return beta, sw ** 2


def harmonic_fit(hour_bins: np.ndarray, med: np.ndarray, w: np.ndarray):
    """Robuste harmonische Regression (Huber-IRLS, mit Interzept) auf
    Halbstunden-Medianen. Liefert gewichtetes R², Gesamtamplitude und das
    Minimum der Fit-Kurve ('billigste Stunde')."""
    ok = ~np.isnan(med)
    h = hour_bins[ok]
    y = med[ok]
    w = w[ok].astype(float)
    om = 2 * np.pi / 24.0
    X = np.column_stack([np.ones_like(h),
                         np.cos(om * h), np.sin(om * h),
                         np.cos(2 * om * h), np.sin(2 * om * h)])
    beta, w_tot = _huber_irls(X, y, w)
    resid = y - X @ beta
    y_bar = np.average(y, weights=w_tot)
    ss_res = np.sum(w_tot * resid ** 2)
    ss_tot = np.sum(w_tot * (y - y_bar) ** 2)
    r2 = float(1 - ss_res / ss_tot) if ss_tot > 1e-12 else np.nan
    grid = np.arange(0, 24, 0.5)
    Xg = np.column_stack([np.ones_like(grid),
                          np.cos(om * grid), np.sin(om * grid),
                          np.cos(2 * om * grid), np.sin(2 * om * grid)])
    curve = Xg @ beta
    amp = np.hypot(beta[1], beta[2]) + np.hypot(beta[3], beta[4])
    best_hour = grid[np.argmin(curve)]
    return r2, amp, best_hour, grid, curve




# -------------------------------------------------------------- Feiertage (--subdiv)

def parse_subdiv(spec: str | None) -> dict[str, str]:
    """'Stadt:HE;Stadt:BY' -> {Stadt: Bundesland-Subdiv} (ISO 3166-2:DE).

    Akzeptiert 'HE' und 'DE-HE' (wird normalisiert). Die Gültigkeit wird erst
    bei der Auswertung über das `holidays`-Paket geprüft.
    """
    if not spec:
        return {}
    out: dict[str, str] = {}
    for part in spec.split(";"):
        if ":" not in part:
            raise ValueError(f"--subdiv: 'Stadt:Subdiv' erwartet, bekam '{part}'")
        name, sub = part.split(":", 1)
        sub = sub.strip().upper().removeprefix("DE-")
        if not sub:
            raise ValueError(f"--subdiv: leeres Subdiv in '{part}'")
        out[name.strip()] = sub
    return out


def holiday_mask(index: pd.DatetimeIndex, subdiv: str) -> pd.Series:
    """True je Zeile, wenn der Kalendertag (lokal) ein Feiertag im Bundesland ist."""
    if _holidays is None:
        raise RuntimeError(
            "--subdiv erfordert das Paket 'holidays' (pip install holidays)")
    years = range(index.year.min(), index.year.max() + 1)
    try:
        cal = _holidays.Germany(subdiv=subdiv, years=years)
    except NotImplementedError as exc:
        raise ValueError(f"Unbekanntes Bundesland-Subdiv '{subdiv}'") from exc
    hol = set(cal.keys())
    days = pd.Series(index.normalize().date, index=index)
    return days.isin(hol)


# --------------------------------------------------------------- Hauptanalyse

@dataclass
class CityResult:
    city: str
    table: pd.DataFrame
    mat: pd.DataFrame
    delta: pd.DataFrame
    meta: pd.DataFrame
    excluded: list[str] = field(default_factory=list)
    stability: float = float("nan")   # Split-Half-Spearman-Rangkorrelation von δ̂
    holiday_subdiv: str | None = None     # Bundesland (ISO 3166-2:DE)
    holiday_days: int = 0                 # Feiertage im Analysefenster
    holidays_applied: bool = False        # Feiertage von AV/Tagesform ausgeschlossen?


def analyse_city(df: pd.DataFrame, city: str, cfg: Config,
                 rng: np.random.Generator,
                 router: "RoadRouter | None" = None) -> CityResult:
    mat = to_matrix(df, city, cfg.step_min, ffill_min=cfg.ffill_minutes)
    meta = (df[df.city == city]
            .drop_duplicates("station_id")
            .set_index("station_id")[["station_name", "brand", "lat", "lon"]])

    coverage = mat.notna().mean(axis=0)
    keep = coverage[coverage >= cfg.min_coverage].index
    excluded = [f"{sid} (Coverage {coverage[sid]:.0%})"
                for sid in coverage.index if sid not in set(keep)]
    mat = mat[keep]
    if mat.shape[1] < 2:
        raise ValueError(
            f"Stadt '{city}': nur {mat.shape[1]} Station nach dem Coverage-Gate — "
            f"Relativpreise (LOO-Median) sind damit nicht definierbar. "
            f"Größeren Zeitraum wählen, Städte zusammenlegen oder --min-coverage senken.")

    base = loo_baseline(mat)
    delta = (mat - base) * 100.0  # ct/L relativ zum Stadt-LOO-Median

    hours = mat.index.hour.to_numpy() + mat.index.minute.to_numpy() / 60.0
    days = mat.index.normalize()
    day_keys = {d: i for i, d in enumerate(days.unique())}
    dnum = np.array([day_keys[d] for d in days], dtype=float)

    # Feiertage (bundeslandspezifisch, --subdiv): werden für die Tagesform-/
    # Verfügbarkeits-Schätzung ausgeschlossen, weil Öffnungszeiten und
    # Pendlerverhalten an Feiertagen systematisch anders sind. Die robuste
    # Niveau-Schätzung δ̂ bleibt auf allen Tagen (relativer Median ist robust).
    subdiv = cfg.subdiv.get(city)
    hol_mask = None
    holiday_days = 0
    holidays_applied = False
    if subdiv:
        hm = holiday_mask(mat.index, subdiv)
        holiday_days = int(pd.unique(mat.index[hm].normalize()).size)
        if holiday_days and (days.nunique() - holiday_days) >= 10:
            hol_mask = hm.to_numpy()
            holidays_applied = True
    row_sel = ~hol_mask if hol_mask is not None else np.ones(len(mat), dtype=bool)

    # Top-3-Treffer je Stunde (ohne Feiertage, sofern angewendet)
    rank = mat.rank(axis=1, method="min", na_option="keep")
    win = (rank <= 3).astype(float).where(mat.notna())
    P = np.full((mat.shape[1], 24), np.nan)
    hour_arr = np.floor(hours).astype(int)
    for hi in range(24):
        sel = (hour_arr == hi) & row_sel
        P[:, hi] = np.nanmean(win.to_numpy()[sel], axis=0)

    # Nutzerprofil: Pendlerfenster werktags, Wochenende gleichverteilt
    w = np.zeros(24)
    w[[6, 7, 8, 16, 17, 18, 19]] = 1.0
    wd_weight, we_weight = 5 / 7, 2 / 7
    w_weekday = w / w.sum() * wd_weight
    w_weekend = np.full(24, 1 / 24) * we_weight
    w_user = w_weekday + w_weekend

    # Staufaktor, über das Nutzerprofil gemittelt: Anteil der Tankvorgänge im
    # Berufsverkehr (6-9/16-20 h werktags) bekommt f_peak, der Rest f_off.
    # OSRM liefert Freifluss-Zeiten ohne Stau -> echte Fahrtzeit im Mittel ×f.
    peak_hours = np.array([h in (6, 7, 8, 16, 17, 18, 19) for h in range(24)],
                          dtype=float)
    peak_share = float(np.sum(w_user * peak_hours))

    # Umweg-Referenz: konfigurierter Punkt der Stadt, sonst Stations-Schwerpunkt
    home_lat, home_lon = cfg.home.get(
        city, (float(meta.lat.median()), float(meta.lon.median())))
    price_ref = float(np.nanmedian(mat.to_numpy()))  # €/L Referenzpreis (Stadtmedian)

    sids = list(mat.columns)
    coords = [(float(meta.loc[sid, "lat"]), float(meta.loc[sid, "lon"])) for sid in sids]
    dist_map: dict[str, float] = {}
    dur_map: dict[str, float | None] = {}
    routed = router is not None and cfg.router == "osrm"
    if routed:
        # EINE OSRM-Table-Anfrage je Stadt (Anker -> alle Stationen), mit Cache/Fallback.
        routes = router.routes_from(home_lat, home_lon, coords)  # type: ignore[union-attr]
        for k, sid in enumerate(sids):
            dist_map[sid], dur_map[sid] = routes[k]
        for idx, fac, d_road in getattr(router, "suspicious", []):
            print(f"    ⚠ {sids[idx][:13]}… Straße/Luftlinie = {fac:.1f}× "
                  f"({d_road:.1f} km) — Anker vermutlich auf Autobahnrampe "
                  "geschnappt; home-Koordinate auf die Hausstraße prüfen.")
        snap = getattr(router, "anchor_snap", None)
        if snap and snap.get("on_autobahn"):
            print(f"    ⚠ ANKER {city} schnappt auf {snap['first_road']} (AUTOBAHN): "
                  "ALLE Routen laufen über die Autobahn -> home-Koordinate in "
                  "config.local.json auf die Hausstraße setzen, nicht aufs "
                  "Autobahnkreuz. Das Problem läge bei Google ebenso (Snap gleich).")
    else:
        for sid, (slat, slon) in zip(sids, coords):
            dist_map[sid] = haversine_km(home_lat, home_lon, slat, slon)
            dur_map[sid] = None
    # einzelne Station der Stadt -> keine "ohnehin-Alternative": Referenzweg = 0
    dist_ref = min(dist_map.values()) if dist_map else 0.0
    # onroute: Referenz-Fahrzeit = die der nächstgelegenen Station (i.d.R. Ziel
    # der ohnehin stattfindenden Fahrt); dedicated: Extrafahrt ab Anker.
    dur_ref = None
    if routed:
        ref_sid = min(dist_map, key=lambda s: dist_map[s])
        dur_ref = dur_map.get(ref_sid)
        # Kontext-Staufaktor je Station:
        #  * nahe Stationen (≤ near_km) tankt man auf dem Arbeitsweg (Berufsverkehr)
        #    -> Fahrtzeit × congestion_peak (Default 1,45, Worst Case 2,0)
        #  * weitere Routen-Stationen (Globus/Guericke …) fährt man gezielt zum
        #    Einkaufen an, zeitlich frei wählbar (Wochenende/Vormittag) -> Freifluss
        #    × congestion_offpeak (Default 1,0). Ein einziger Mischfaktor für alle
        #    würde den Einkaufs-Fall zu pessimistisch rechnen.
        n_near = sum(1 for s in dist_map.values() if s <= cfg.near_km)
        n_far = len(dist_map) - n_near
        if cfg.value_of_time > 0 and (cfg.congestion_peak != 1.0
                                      or cfg.congestion_offpeak != 1.0):
            print(f"      Rushhour-Kontext: {n_near} nahe Stationen (≤{cfg.near_km:g} km, "
                  f"Arbeitsweg) mit ×{cfg.congestion_peak:g} Berufsverkehr, "
                  f"{n_far} weitere (Einkaufen/Routen) mit ×{cfg.congestion_offpeak:g} "
                  f"Freifluss auf die OSRM-Zeit")

    rows = []
    for j, sid in enumerate(sids):
        d = delta[sid].to_numpy()
        d_hat = np.nanmedian(d)
        boots, _ = day_block_bootstrap(d, dnum, cfg.n_boot, rng)
        lo, hi = np.nanpercentile(boots, [2.5, 97.5])
        p_raw = (1 + np.sum(boots >= 0)) / (cfg.n_boot + 1)

        # --- Umweg-Ökonomie: Netto-Ersparnis € je Füllung ---
        dist_km = dist_map[sid]
        dur_min = dur_map.get(sid)
        # dedicated: Extrafahrt von zuhause (Hin+Rück)
        # onroute:   nur Mehrweg ggü. der nächstgelegenen Station (man ist eh unterwegs)
        extra = dist_km if cfg.trip_mode == "dedicated" else max(0.0, dist_km - dist_ref)
        extra_min = None
        if routed and dur_min is not None:
            base_min = 0.0 if cfg.trip_mode == "dedicated" else (dur_ref or 0.0)
            extra_min = max(0.0, dur_min - base_min)
        # Kontext-Staufaktor dieser Station: nah = Arbeitsweg (Peak-Stau),
        # weiter = frei wählbarer Einkaufs-/Routen-Trip (Offpeak/Freifluss).
        if routed:
            cong = cfg.congestion_peak if dist_km <= cfg.near_km else cfg.congestion_offpeak
        else:
            cong = 1.0      # avg_speed-Näherung enthält schon gemischten Verkehr
        d_rt, K_fuel, K_time = detour_cost(extra, price_ref, cfg,
                                           extra_min_oneway=extra_min,
                                           congestion=cong)
        K = K_fuel + K_time
        # Netto-Gewinn: Vollkosten (Sprit + Zeit) für das Ranking,
        # plus Sprit-only-Sicht (was an der Zapfsäule cash übrig bliebe).
        net_b = (-boots * cfg.tank_volume / 100.0) - K
        net_b_fuel = (-boots * cfg.tank_volume / 100.0) - K_fuel
        net_med, net_lo, net_hi = np.nanpercentile(net_b, [50, 2.5, 97.5])
        net_fuel_med, net_fuel_lo, net_fuel_hi = np.nanpercentile(
            net_b_fuel, [50, 2.5, 97.5])
        p_profit = float(np.mean(net_b > 0))
        # „Break-even-Stundenlohn": bei welchem Zeitwert z ist Gesamt-Netto = 0?
        # K = K_fuel + t_rt·z = Ersparnis  ->  z* = (Ersparnis − K_fuel)/t_rt.
        # t_rt enthält den Kontext-Staufaktor (nah=Peak, weit=Offpeak).
        if extra_min is not None:
            t_rt_h = 2.0 * extra_min * cong / 60.0
        else:
            t_rt_h = 2.0 * d_rt / cfg.avg_speed / 60.0
        saving_med = -d_hat * cfg.tank_volume / 100.0
        be_wage = ((saving_med - K_fuel) / t_rt_h) if t_rt_h > 1e-9 else None

        half = np.floor(hours * 2) / 2
        bins = np.arange(0, 24, 0.5)
        d_sel, half_sel = d[row_sel], half[row_sel]
        med = np.array([np.nanmedian(d_sel[half_sel == b]) for b in bins])
        cnt = np.array([np.sum(~np.isnan(d_sel[half_sel == b])) for b in bins])
        r2, amp, best_hour, grid, curve = harmonic_fit(bins, med, cnt)

        mad = np.nanmedian(np.abs(d - d_hat))
        sigma = 1.4826 * mad
        daily_rank = rank[sid].groupby(days).mean()
        rank_std = daily_rank.std()

        avail = float(np.nansum(P[j] * w_user))
        # Anzahl Tage als n für Wilson (gewichtet über Stundenanteile)
        rows.append(dict(
            station_id=sid,
            station_name=meta.loc[sid, "station_name"],
            brand=meta.loc[sid, "brand"],
            lat=meta.loc[sid, "lat"], lon=meta.loc[sid, "lon"],
            coverage=coverage[sid],
            delta_ct=d_hat, ci_lo=lo, ci_hi=hi, p_value=p_raw,
            avail=avail,
            best_hour=best_hour, cycle_amp=amp, cycle_r2=r2,
            vol_ct=sigma, rank_std=rank_std,
            dist_km=dist_km, detour_km=d_rt, detour_cost_eur=K,
            detour_fuel_eur=K_fuel, detour_time_eur=K_time,
            net_per_fill_eur=float(net_med), net_lo=float(net_lo),
            net_hi=float(net_hi), p_profit=p_profit,
            net_fuel_only_eur=float(net_fuel_med), net_fuel_lo=float(net_fuel_lo),
            net_fuel_hi=float(net_fuel_hi),
            break_even_wage_eur_h=(float(be_wage) if be_wage is not None else np.nan),
        ))

    tab = pd.DataFrame(rows)
    tab["q_value"] = benjamini_hochberg(tab.p_value.to_numpy())
    tab["significant"] = tab.q_value < 0.05

    # Composite-Score: z-Scores innerhalb der Stadt
    def z(s: pd.Series) -> pd.Series:
        sd = s.std(ddof=0)
        return (s - s.mean()) / (sd if sd > 1e-12 else 1.0)

    tab["score"] = (
        cfg.w_level * z(-tab.delta_ct)
        + cfg.w_avail * z(tab.avail)
        + cfg.w_pred * z(tab.cycle_r2)
        - cfg.w_vol * z(tab.vol_ct)
        - cfg.w_rank * z(tab.rank_std)
    )
    tab["saving_per_fill_eur"] = -tab.delta_ct * cfg.tank_volume / 100.0
    tab["saving_per_year_eur"] = tab.saving_per_fill_eur * cfg.fills_per_week * 52
    tab["net_per_year_eur"] = tab.net_per_fill_eur * cfg.fills_per_week * 52
    tab["net_fuel_only_year_eur"] = tab.net_fuel_only_eur * cfg.fills_per_week * 52
    # konservatives Kriterium: auch die untere 95-%-KI-Grenze des Netto-Gewinns > 0
    tab["worth_it"] = tab.net_lo > 0
    # Sprit-only-Lohnt-Flag: nur Spritkosten eingerechnet (Zeit ist einem egal)
    tab["worth_it_fuel_only"] = tab.net_fuel_lo > 0
    tab["city"] = city

    # Split-Half-Stabilität (Winner's-Curse-Kontrolle): Rangkorrelation der
    # δ̂-Schätzer zwischen erster und zweiter Hälfte der Historie
    uniq_days = days.unique()
    h = len(uniq_days) // 2
    m1 = delta.loc[delta.index.normalize().isin(uniq_days[:h])].median(axis=0)
    m2 = delta.loc[delta.index.normalize().isin(uniq_days[h:])].median(axis=0)
    stability = float(pd.concat([m1, m2], axis=1).corr(method="spearman").iloc[0, 1])

    sort_key = "net_per_fill_eur" if cfg.rank_by == "net" else "score"
    tab = tab.sort_values(sort_key, ascending=False).reset_index(drop=True)
    tab.insert(0, "rank", tab.index + 1)
    return CityResult(city=city, table=tab, mat=mat, delta=delta,
                      meta=meta.reset_index(), excluded=excluded,
                      stability=stability, holiday_subdiv=subdiv,
                      holiday_days=holiday_days,
                      holidays_applied=holidays_applied)

# ------------------------------------------------------------------- Figuren

def fig_city_cycle(res: CityResult, out: Path) -> None:
    plt.rcParams.update(PLT_DARK)
    fig, ax = plt.subplots(figsize=(10, 5.5), dpi=130)
    hours = res.delta.index.hour.to_numpy() + res.delta.index.minute.to_numpy() / 60.0
    bins = np.arange(0, 24.5, 0.5)
    centers = (bins[:-1] + bins[1:]) / 2
    rel = res.delta.to_numpy()
    hb = np.digitize(hours, bins) - 1
    prof = np.full_like(res.delta, np.nan, dtype=float)
    for b in range(len(centers)):
        sel = hb == b
        if sel.any():
            prof[sel] = np.nanmedian(rel[sel], axis=0)
    city_curve = np.nanmedian(prof, axis=1)
    q25, q75 = np.nanpercentile(prof, [25, 75], axis=1)
    ax.plot(hours, city_curve, color="#58a6ff", lw=2.2,
            label="Stadt-Medianprofil (geglättet)")
    ax.fill_between(hours, q25, q75, color="#58a6ff", alpha=0.18,
                    label="IQR über Stationen")
    t = res.table.head(5)
    for _, r in t.iterrows():
        ax.axvline(r.best_hour, ls=":", lw=1.1, alpha=0.85,
                   label=f"{r.brand} …{r.station_id[-3:]}: billigste Stunde {r.best_hour:04.1f} h")
    ax.set_title(f"{res.city} – Intraday-Preisstruktur relativ zum Stadtmedian")
    ax.set_xlabel("Uhrzeit [h]")
    ax.set_ylabel("Δ Preis [ct/L]")
    ax.set_xlim(0, 24)
    ax.legend(fontsize=8, loc="lower left", framealpha=0.2)
    fig.tight_layout()
    fig.savefig(out, facecolor=fig.get_facecolor())
    plt.close(fig)


def fig_heatmap(res: CityResult, out: Path) -> None:
    plt.rcParams.update(PLT_DARK)
    hours = res.delta.index.hour.to_numpy() + res.delta.index.minute.to_numpy() / 60.0
    hb = np.floor(hours).astype(int)
    cols = list(res.delta.columns)
    grid = np.full((len(cols), 24), np.nan)
    for j, sid in enumerate(cols):
        d = res.delta[sid].to_numpy()
        for h in range(24):
            grid[j, h] = np.nanmedian(d[hb == h])
    order = res.table.station_id.tolist()
    idx = [cols.index(s) for s in order]
    grid = grid[idx]
    labels = [f"{res.meta.set_index('station_id').loc[s, 'brand']} {s}" for s in order]

    fig, ax = plt.subplots(figsize=(10, max(4.5, 0.34 * len(cols) + 2)), dpi=130)
    vmax = np.nanpercentile(np.abs(grid), 97)
    im = ax.imshow(grid, aspect="auto", cmap="RdYlGn_r", vmin=-vmax, vmax=vmax)
    ax.set_yticks(range(len(labels)), labels, fontsize=8)
    ax.set_xticks(range(0, 24, 2), [f"{h:02d}:00" for h in range(0, 24, 2)], fontsize=8)
    ax.set_title(f"{res.city} – Heatmap Δ Preis [ct/L] (Median je Stunde, grün = günstig)")
    cb = fig.colorbar(im, ax=ax, pad=0.01)
    cb.set_label("Δ ct/L", fontsize=8)
    cb.ax.tick_params(labelsize=8)
    fig.tight_layout()
    fig.savefig(out, facecolor=fig.get_facecolor())
    plt.close(fig)


def fig_top10(top: pd.DataFrame, cfg: Config, out: Path) -> None:
    plt.rcParams.update(PLT_DARK)
    d = top.iloc[::-1]
    fig, ax = plt.subplots(figsize=(10, 0.62 * len(d) + 2.2), dpi=130)
    cols = ["#3fb950" if s else "#8b949e" for s in d.worth_it]
    ax.barh(d.label, d.net_per_fill_eur, color=cols, alpha=0.9)
    err = np.clip(np.vstack([d.net_per_fill_eur - d.net_lo,
                             d.net_hi - d.net_per_fill_eur]), 0, None)
    ax.errorbar(d.net_per_fill_eur, d.label, xerr=err, fmt="none",
                ecolor="#c9d1d9", elinewidth=1, capsize=3, alpha=0.7)
    for y, (_, r) in enumerate(d.iterrows()):
        ax.text(max(r.net_per_fill_eur, 0) + 0.01, y,
                f"{r.net_per_fill_eur:+.2f} € netto "
                f"(brutto {r.saving_per_fill_eur:+.2f} €, Umweg {r.detour_cost_eur:.2f} €)", va="center", fontsize=8)
    ax.axvline(0, color="#f85149", lw=1)
    ax.set_title(f"Top-{cfg.top} nach NETTO-Ersparnis pro Tankfüllung ({cfg.tank_volume:.0f} L)\n"
                 f"brutto − Umwegkosten (Rundfahrt, {cfg.consumption_l_100km} L/100km, "
                 f"{cfg.value_of_time:.0f} €/h) · grün = Netto > 0 auch an der 95-%-KI-Untergrenze")
    ax.set_xlabel("Netto [€ je Füllung], mit 95 %-Bootstrap-KI")
    ax.tick_params(labelsize=8)
    fig.tight_layout()
    fig.savefig(out, facecolor=fig.get_facecolor())
    plt.close(fig)

# -------------------------------------------------------------------- Report

def fmt_hour(h: float) -> str:
    return f"{int(h):02d}:{int(round((h % 1) * 60)):02d}"


def build_report(results: list[CityResult], top: pd.DataFrame, cfg: Config,
                 fig_dir: Path, report_path: Path) -> None:
    lines = []
    A = lines.append
    A(f"# TankApp – Tankstellen-Selektion ({cfg.fuel})\n")
    A(f"Automatisch erzeugt durch `analysis/station_selection.py`.\n")
    A(f"**Parameter:** Top-N = {cfg.top}, Tankvolumen = {cfg.tank_volume:.0f} L, "
      f"Füllungen/Woche = {cfg.fills_per_week}, Bootstrap B = {cfg.n_boot}, "
      f"Coverage-Gate ≥ {cfg.min_coverage:.0%}, FDR-Schwelle q < 0.05, "
      f"Ranking nach **{cfg.rank_by}**.\n")
    dist_basis = ("echten Straßen-km/Fahrzeit via OSRM-OpenStreetMap" if cfg.router == "osrm"
                  else f"Luftlinie × {cfg.circuity:g} (Circuity)")
    A(f"**Umweg-Modell `{cfg.trip_mode}`:** K = d·(c/100)·p + t·z auf Basis der {dist_basis}"
      f"{' (Extrafahrt Hin+Rück ab Referenzpunkt)' if cfg.trip_mode == 'dedicated' else ' (Mehrweg ggü. nächster Station, da ohnehin unterwegs)'}"
      f", c = {cfg.consumption_l_100km} L/100km, "
      f"{'t = OSRM-Fahrzeit' if cfg.router == 'osrm' else f'v = {cfg.avg_speed:.0f} km/h'}, "
      f"z = {cfg.value_of_time:.0f} €/h; p = Stadtmedian. "
      f"*Netto = −δ̂·V/100 − K* mit Bootstrap-Verteilung → P(Gewinn > 0) und "
      f"konservatives Lohnt-sich-Flag (KI-Untergrenze > 0)."
      f" Hinweis: `--trip-mode dedicated` beantwortet die strengere Frage "
      f"„lohnt eine Extrafahrt?“ — dort ist der Zeitwert meist dominant.\n")
    A("\n## Methodik in Kürze\n")
    A("| # | Komponente | Methode | Gewicht |")
    A("|---|---|---|---|")
    A(f"| 1 | Relative Preislage δ̂ | Median(p_i − LOO-Stadtmedian), Tages-Block-Bootstrap 95 %-KI | {cfg.w_level} |")
    A("| 2 | Signifikanz | einseitiger Bootstrap-p, Benjamini-Hochberg-FDR | Gate/Flag |")
    A(f"| 3 | Verfügbarkeit AV | P(Top-3 \\| Stunde) × Pendlerprofil | {cfg.w_avail} |")
    A(f"| 4 | Zyklus-Vorhersagbarkeit | robuste harmonische Regression (Huber), R² | {cfg.w_pred} |")
    A(f"| − | Volatilität σ | 1.4826·MAD | {cfg.w_vol} |")
    A(f"| − | Rangstabilität | Std(tägliche Mittelränge) | {cfg.w_rank} |")
    A("| 7 | Umweg-Netto | K(d)-Modell, Bootstrap-KI, P(Netto > 0) | Ranking 'net' |\n")


    for res in results:
        A(f"\n## Stadt: {res.city}\n")
        A(f"Split-Half-Stabilität der Rangfolge (Spearman-ρ δ̂ 1. vs. 2. Jahreshälfte): "
          f"**ρ = {res.stability:.2f}** (gegen Winner's Curse; ≥ 0.8 = stabil)\n")
        if res.holiday_subdiv:
            if res.holiday_days == 0:
                status = "keine im Analysefenster"
            elif res.holidays_applied:
                status = "aus AV & Tagesform ausgeschlossen"
            else:
                status = "im Fenster, aber nicht ausgeschlossen (zu wenige Tage)"
            A(f"Feiertage (Bundesland {res.holiday_subdiv}): **{res.holiday_days} Tage** — "
              f"{status} · δ̂ wird auf allen Tagen geschätzt (robust)\n")
        if res.excluded:
            A(f"⚠️ **Ausgeschlossen (Datenqualität):** {', '.join(res.excluded)}\n")
        A("![Intraday-Zyklus](figures/cycle_" + res.city.lower() + ".png)\n")
        A("![Heatmap](figures/heatmap_" + res.city.lower() + ".png)\n")
        A("| Rang | Station | Marke | δ̂ [ct/L] | 95 %-KI | q | AV | billigste Std | R² | σ [ct] | Entf. [km] | Umweg € | **Netto €/Füll** | Netto €/Jahr |")
        A("|---:|---|---|---:|---|---:|---:|---|---:|---:|---:|---:|---:|---:|")
        for _, r in res.table.iterrows():
            sig = " ✅" if r.significant else ""
            A(f"| {r['rank']} | {r.station_name} | {r.brand} | {r.delta_ct:+.2f} | "
              f"[{r.ci_lo:+.2f}, {r.ci_hi:+.2f}] | {r.q_value:.4f}{sig} | "
              f"{r.avail:.2f} | {fmt_hour(r.best_hour)} | "
              f"{r.cycle_r2:.2f} | {r.vol_ct:.2f} | {r.dist_km:.1f} | "
              f"{r.detour_cost_eur:.2f} | **{r.net_per_fill_eur:+.2f}** | "
              f"{r.net_per_year_eur:+.1f} |")

    A(f"\n## 🏆 Globale Top-{cfg.top} (über alle Städte, Ranking: {cfg.rank_by})\n")
    A("![Top-N](figures/top_selection.png)\n")
    A("| # | Stadt | Station | Marke | δ̂ [ct/L] | q | Entf. [km] | Sprit € | Zeit € | Netto €/Füll | **nur Sprit** € | Break-even z [€/h] | Maps |")
    A("|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|")
    for i, (_, r) in enumerate(top.iterrows(), 1):
        maps = (f"https://www.google.com/maps/dir/?api=1&destination={r.lat},{r.lon}")
        wage = ("—" if np.isnan(r.break_even_wage_eur_h) or r.detour_time_eur <= 1e-9
                else f"{r.break_even_wage_eur_h:.1f}")
        A(f"| {i} | {r.city} | {r.station_name} | {r.brand} | "
          f"{r.delta_ct:+.2f} | {r.q_value:.4f} | {r.dist_km:.1f} | "
          f"{r.detour_fuel_eur:.2f} | {r.detour_time_eur:.2f} | "
          f"**{r.net_per_fill_eur:+.2f} €** | {r.net_fuel_only_eur:+.2f} € | "
          f"{wage} | [Route]({maps}) |")

    A("\n> **Zwei Netto-Sichten — du entscheidest, was dir die Zeit wert ist.** "
      "*Netto €/Füll* rechnet voll: Sprit **und** Zeit (Default "
      f"{cfg.value_of_time:.0f} €/h). *nur Sprit* blendet die Zeit aus — das ist "
      "das, was an der Zapfsäule bar übrig bliebe. Die Spalte **Break-even z** "
      "nennt den Stundenlohn, ab dem sich der Umweg rechnet: liegt dein eigener "
      f"Zeitwert darunter (Rente, Sonntag, Warteschlange an der Stammstation), "
      "fahr los; darüber, lass es. Faustregel: bei Stadtfahrt (≈30–50 km/h) "
      f"kostet die Zeit ~0,24–0,40 € je Umweg-km, der Sprit nur ~0,12 €/km "
      f"(bei {cfg.consumption_l_100km:.0f} L/100 km und 1,65 €/L) — die Zeit ist "
      "also der größere Block. Wer sie gar nicht bepreisen will, rechnet die "
      "Selektion mit `--value-of-time 0` (dann fallen beide Netto-Sichten "
      "zusammen). Im `onroute`-Modus zählt nur der *Mehr*weg gegenüber der "
      "nächsten Station: für 300 m/2 min ist die Zeit dann ohnehin vernachlässigbar.")

    A("\n## Interpretation & Caveats\n")
    A("- **δ̂ < 0** heißt: Station liegt median **unter** dem Stadtmedian der übrigen "
      "Stationen → strukturell günstig. Nur Stationen mit **q < 0.05** gelten als "
      "nachweisbar günstiger (FDR-kontrolliert über alle Tests).")
    A("- **AV** ist die mit dem Tankzeitprofil gewichtete Wahrscheinlichkeit, dass die "
      "Station zum Tankzeitpunkt unter den drei günstigsten der Stadt liegt.")
    A("- **billigste Stunde** ist das Minimum des robusten harmonischen Fits; hohe "
      "**R²** bedeutet, dass dieses Zeitfenster verlässlich wiederkehrt.")
    A("- Hohe **σ** relativ zu |δ̂| bedeutet: Vorteil ist im Mittel da, aber volatil → "
      "im Score abgestraft.")
    A("- Der Composite-Score ist innerhalb einer Stadt z-standardisiert; globaler Vergleich "
      "über Score ist daher eine Näherung (Städte haben unterschiedliche Streuungen).")
    A("- **Winner's Curse:** Aus 54 Stationen wird das δ̂ der Gewinner systematisch leicht "
      "optimistisch geschätzt. Der Split-Half-Check (ρ je Stadt) misst, ob die Rangfolge "
      "auf ungesehenen Daten bestehen bleibt; zusätzlich empfiehlt sich ein Out-of-Sample-"
      "Re-Check nach 4 Wochen Live-Betrieb.")
    if cfg.router == "osrm":
        A("- **Netto-Ranking** bezieht Umwegkosten (Sprit + Zeit) ein. Entfernungen und "
          "Fahrzeiten stammen aus **OSRM/OpenStreetMap** (echte Straßen-routing, ein Anker "
          "je Stadt; Cache in `results/road_route_cache.json`, bei Serverausfall Fallback "
          "Luftlinie). Wer feste Pendelrouten hat, setzt den Anker passend zur Route.")
    else:
        A("- **Netto-Ranking** bezieht Umwegkosten (Sprit + Zeit) ein. Entfernungen sind "
          "Luftlinie × Straßenfaktor; **echte Straßen-km + Fahrzeit gibt es mit "
          "`--router osrm`** (OSRM/OpenStreetMap, kostenlos ohne Key, mit Cache/Fallback). "
          "Wer Pendelrouten hat, reicht `--home` einen Routen-Anker.")
    if cfg.subdiv:
        A("- **Feiertage bundeslandspezifisch** (z. B. Hessen/Bayern/NRW): ein Feiertag in "
          "Stadt A kann Werktag in Stadt B sein. Sie werden über das `holidays`-Paket je "
          "Bundesland erkannt und für AV/Tagesform ausgeschlossen (δ̂ bleibt robust auf "
          "allen Tagen).")
    A(f"- Euro-Kennzahlen: {cfg.tank_volume:.0f} L je Füllung bzw. "
      f"{cfg.fills_per_week} Füllungen/Woche × 52.")

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines), encoding="utf-8")

# ---------------------------------------------------------------------- Main

def parse_home(spec: str | None) -> dict[str, tuple[float, float]]:
    """'Stadt:lat,lon;Stadt:lat,lon' -> {Stadt: (lat, lon)}.

    Achtung Datenschutz: nur Koordinaten, niemals Straße/Hausnummer — und
    auch die Koordinaten gehören in die lokale, gitignorierte config
    (--config), nicht ins Repo oder in die Shell-History.
    """
    if not spec:
        return {}
    out = {}
    for part in spec.split(";"):
        name, coords = part.split(":")
        lat, lon = coords.split(",")
        out[name.strip()] = (float(lat), float(lon))
    return out


def home_from_config(data: dict) -> dict[str, tuple[float, float]]:
    """'{"home": {"Stadt": [lat, lon]}}' -> {Stadt: (lat, lon)}."""
    out: dict[str, tuple[float, float]] = {}
    for city, val in data.get("home", {}).items():
        if val is None or (len(val) != 2):
            raise ValueError(
                f"--config: home['{city}'] muss [lat, lon] sein "
                "(Platzhalter ersetzen!)")
        lat, lon = float(val[0]), float(val[1])
        if lat == 0.0 and lon == 0.0:
            raise ValueError(
                f"--config: home['{city}'] ist noch der Platzhalter [0.0, 0.0] — "
                "Koordinaten einmalig per Geocoding ermitteln und eintragen "
                "(Straße/Hausnummer aber nur lokal in config.local.json, niemals "
                "ins Repo!)")
        out[city] = (lat, lon)
    return out


def subdiv_from_config(data: dict) -> dict[str, str]:
    """'{"subdiv": {"Stadt": "HE"}}' -> {Stadt: 'HE'}."""
    out: dict[str, str] = {}
    for city, sub in data.get("subdiv", {}).items():
        sub = str(sub).strip().upper().removeprefix("DE-")
        if not sub:
            raise ValueError(f"--config: leeres subdiv für '{city}'")
        out[city] = sub
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="TankApp – Tankstellen-Selektion")
    ap.add_argument("--data", nargs="+", type=Path, required=True,
                    help="CSV-Dateien (historische Preisdaten, ggf. mehrere Städte)")
    ap.add_argument("--fuel", default="E10", choices=["E5", "E10", "DIESEL"])
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--tank-volume", type=float, default=40.0)
    ap.add_argument("--fills-per-week", type=float, default=1.2)
    ap.add_argument("--min-coverage", type=float, default=0.85)
    ap.add_argument("--ffill-minutes", type=float, default=None,
                    help="Lücken, die noch als 'Preis bekannt' gelten (min). Default: 30 bei "
                         "dichten Daten, max(180, 3×Medianabstand) bei Änderungshistorie")
    ap.add_argument("--step-min", type=int, default=5,
                    help="Analyse-Raster in Minuten. Tankerkönig-Historie liefert nur "
                         "PreisÄNDERUNGEN (~alle 15-30 min) — für übernommene Historie "
                         "--step-min 30 oder 60 setzen, sonst wird Abdeckung auf einem zu "
                         "feinen Raster gemessen (KONZEPT.md: Raster beliebig).")
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--home", default=None,
                    help="Referenzpunkt je Stadt: 'Stadt:lat,lon;Stadt:lat,lon' "
                         "(Default: Stations-Schwerpunkt; Werte bevorzugt aus "
                         "--config, damit Koordinaten nicht im Repo/Shell landen)")
    ap.add_argument("--config", type=Path, default=None,
                    help="Lokale JSON-Konfiguration (gitignored, enthält "
                         "Privatdaten): {'home': {'Stadt': [lat, lon]}, "
                         "'subdiv': {'Stadt': 'HE'}} — CLI-Flags überschreiben")
    ap.add_argument("--subdiv", default=None,
                    help="Bundesland je Stadt (ISO 3166-2:DE) für Feiertage: "
                         "'Stadt:HE;Stadt:BY;Stadt:NW' — Feiertage werden dann aus "
                         "AV & Tagesform ausgeschlossen (erfordert Paket 'holidays')")
    ap.add_argument("--consumption", type=float, default=7.0, help="L/100km")
    ap.add_argument("--value-of-time", type=float, default=12.0, help="€/h")
    ap.add_argument("--avg-speed", type=float, default=50.0, help="km/h")
    ap.add_argument("--congestion-peak", type=float, default=1.45,
                    help="Staufaktor im Berufsverkehr auf die OSRM-Freifluss-Zeit "
                         "(6-9/16-20 h werktags; 1.0=kein Stau, 1.45=~35 statt 50 km/h, "
                         "2.0=Stop&Go). Nur mit --router osrm wirksam.")
    ap.add_argument("--congestion-offpeak", type=float, default=1.0,
                    help="Staufaktor außerhalb des Berufsverkehrs (Freifluss = 1.0).")
    ap.add_argument("--near-km", type=float, default=5.0,
                    help="Nahbereich (Straßen-km ab Anker) für die Kontext-Zeitbewertung: "
                         "Stationen innerhalb (Arbeitsweg) bekommen den Peak-Staufaktor, "
                         "weitere (Einkaufen/Routen, frei wählbar) den Offpeak-Faktor. "
                         "Sollte mit dem --near-km des Polling-Sets übereinstimmen.")
    ap.add_argument("--rank-by", choices=["net", "score"], default="net",
                    help="Ranking nach Netto-Ersparnis (inkl. Umweg) oder Statistik-Score")
    ap.add_argument("--trip-mode", choices=["onroute", "dedicated"], default="onroute",
                    help="Umweg-Modell: 'onroute' = nur Mehrweg ggü. nächster Station; "
                         "'dedicated' = Extrafahrt von zuhause (strenger)")
    ap.add_argument("--router", choices=["haversine", "osrm"], default="haversine",
                    help="Entfernungsbasis: 'haversine' = Luftlinie × Circuity (Default, "
                         "offline); 'osrm' = echte Straßen-km + Fahrzeit via OSRM/"
                         "OpenStreetMap (kostenlos, ohne Key; mit Cache + Luftlinie-Fallback)")
    ap.add_argument("--osrm-url", default=None,
                    help="OSRM-Server für --router osrm (Default: öffentlicher Demo-Server "
                         "router.project-osrm.org; eigener Server z. B. http://nas:5000)")
    ap.add_argument("--route-cache", type=Path,
                    default=Path("results") / "road_route_cache.json",
                    help="Cache-Datei für OSRM-Routen (wiederholte Läufe offline)")
    ap.add_argument("--results", type=Path, default=Path("results"))
    ap.add_argument("--report", type=Path, default=Path("docs/analysis/report_top10.md"))
    ap.add_argument("--figdir", type=Path, default=Path("docs/analysis/figures"))
    args = ap.parse_args()

    cfg = Config(fuel=args.fuel.upper(), top=args.top, tank_volume=args.tank_volume,
                 fills_per_week=args.fills_per_week, min_coverage=args.min_coverage,
                 n_boot=args.boot, step_min=args.step_min, ffill_minutes=args.ffill_minutes,
                 home=parse_home(args.home),
                 subdiv=parse_subdiv(args.subdiv),
                 consumption_l_100km=args.consumption,
                 value_of_time=args.value_of_time, avg_speed=args.avg_speed,
                 congestion_peak=args.congestion_peak,
                 congestion_offpeak=args.congestion_offpeak,
                 near_km=args.near_km,
                 trip_mode=args.trip_mode, rank_by=args.rank_by,
                 router=args.router, osrm_url=args.osrm_url,
                 route_cache=args.route_cache)
    # Lokale, gitignorierte Konfiguration (Privatdaten) — CLI-Flags gewinnen.
    if args.config:
        data = json.loads(args.config.read_text(encoding="utf-8"))
        cfg.home = home_from_config(data)
        cfg.home.update(parse_home(args.home))           # CLI überschreibt
        cfg.subdiv = subdiv_from_config(data)
        cfg.subdiv.update(parse_subdiv(args.subdiv))
        print(f"Lokale Konfiguration geladen: {args.config} "
              f"(Privatdaten — Datei ist gitignored)")

    router = None
    if cfg.router == "osrm":
        if RoadRouter is None:
            print("⚠ --router osrm: data-tools/road_route.py nicht gefunden — "
                  "rechne mit Luftlinie × Circuity weiter.")
            cfg.router = "haversine"
        else:
            router = RoadRouter(mode="driving", base_url=cfg.osrm_url,
                                cache_path=cfg.route_cache, circuity=cfg.circuity)
            print(f"Routing: OSRM/OpenStreetMap ({cfg.osrm_url or 'öffentlicher Demo-Server'}) "
                  f"— echte Straßen-km + Fahrzeit, Cache {cfg.route_cache} "
                  f"(Fallback: Luftlinie × {cfg.circuity:g})")
    rng = np.random.default_rng(cfg.seed)

    df = load_prices(args.data, cfg.fuel)
    cities = sorted(df.city.unique())
    print(f"Geladen: {len(df):,} Zeilen | Städte: {', '.join(cities)} | Kraftstoff: {cfg.fuel}")

    results: list[CityResult] = []
    skipped: list[tuple[str, str]] = []
    for city in cities:
        print(f"  Analysiere {city} …")
        try:
            res = analyse_city(df, city, cfg, rng, router=router)
        except ValueError as exc:          # zu wenige Stationen o. ä. -> Stadt überspringen
            print(f"    ⚠ übersprungen: {exc}")
            skipped.append((city, str(exc)))
            continue
        results.append(res)
        t = res.table.iloc[0]
        print(f"    → bester Kandidat: {t.station_name} (δ̂={t.delta_ct:+.2f} ct, "
              f"q={t.q_value:.4f}, Netto={t.net_per_fill_eur:+.2f} €/Füllung, "
              f"Stabilität ρ={res.stability:.2f})")

    if not results:
        raise SystemExit("Keine Stadt erfüllt die Mindestanforderungen (≥2 Stationen nach dem "
                         "Coverage-Gate). Zeitraum vergrößern, Städte zusammenlegen "
                         "(data-tools/ingest_history.py --city campaign) oder --min-coverage senken.")
    if skipped:
        print(f"  ({len(skipped)} von {len(cities)} Städten übersprungen: "
              f"{', '.join(c for c, _ in skipped[:6])})")
    all_tab = pd.concat([r.table for r in results], ignore_index=True)
    sort_key = "net_per_fill_eur" if cfg.rank_by == "net" else "score"
    all_tab = all_tab.sort_values(sort_key, ascending=False).reset_index(drop=True)
    all_tab["label"] = all_tab.city.str[:2] + "·" + all_tab.brand + " " + all_tab.station_id
    top = all_tab.head(cfg.top).copy()

    cfg_results = args.results
    cfg_results.mkdir(parents=True, exist_ok=True)
    csv_path = cfg_results / f"station_scores_{cfg.fuel.lower()}.csv"
    all_tab.to_csv(csv_path, index=False)
    # Begleit-Metadaten: damit run_pipeline erkennt, ob die Netto-Spalten noch
    # zum aktuellen Anker/Routing passen (verhindert gemischt frische Distanzen
    # + veraltete Netto-Werte nach --skip-select mit geänderter Config).
    meta_path = cfg_results / f"station_scores_{cfg.fuel.lower()}.meta.json"
    meta = {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "router": cfg.router,
        "trip_mode": cfg.trip_mode,
        "value_of_time": cfg.value_of_time,
        "congestion_peak": cfg.congestion_peak,
        "congestion_offpeak": cfg.congestion_offpeak,
        "near_km": cfg.near_km,
        "homes": {c: [float(h[0]), float(h[1])] for c, h in cfg.home.items()},
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n",
                         encoding="utf-8")

    args.figdir.mkdir(parents=True, exist_ok=True)
    for res in results:
        fig_city_cycle(res, args.figdir / f"cycle_{res.city.lower()}.png")
        fig_heatmap(res, args.figdir / f"heatmap_{res.city.lower()}.png")
    fig_top10(top, cfg, args.figdir / "top_selection.png")

    build_report(results, top, cfg, args.figdir, args.report)
    print(f"\nCSV:    {csv_path}")
    print(f"Report: {args.report}")
    print(f"Plots:  {args.figdir}")
    print(f"\nTop-{cfg.top} (Ranking: {cfg.rank_by}):")
    for i, (_, r) in enumerate(top.iterrows(), 1):
        wage = (f"ab {r.break_even_wage_eur_h:4.1f} €/h"
                if not np.isnan(r.break_even_wage_eur_h) and r.detour_time_eur > 1e-9
                else "Zeit n/a")
        print(f"  {i:2d}. [{r.city:<10}] {r.station_name:<34} δ̂={r.delta_ct:+5.2f} ct  "
              f"Entf. {r.dist_km:4.1f} km  "
              f"→ Netto {r.net_per_fill_eur:+5.2f} €/Füll (nur Sprit {r.net_fuel_only_eur:+5.2f})  "
              f"{wage}  P>0: {r.p_profit:.0%}")


if __name__ == "__main__":
    main()
