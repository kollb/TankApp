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
import warnings
from dataclasses import dataclass
from typing import Any

from .models import law_since_utc
from .personalization import default_weekday_profile, normalized_profile

import numpy as np
import pandas as pd


# O36: Untergrenze für die Bootstrap-Ziehungen der Selektion. Die kleinste
# erreichbare p-Wert-Stufe ist p_min = 1/(B+1); mit Benjamini-Hochberg über
# m ≈ 11 Stationen ergibt das q_min ≈ m/(B+1). B = 200 liefert q ≥ 0,0547 —
# selbst die stärkste Station wäre nie signifikant (docs/ANALYSE.md §B,
# „B=200 wäre ein Signifikanzblocker“). 1000 lässt Luft für ein größeres
# Stations-Set, ohne die Rechenzeit des Produktionswerts 2000 zu verlangen.
SELECTION_MIN_BOOTSTRAP = 1000


@dataclass(frozen=True)
class SelectionConfig:
    fuel: str = "E10"
    min_coverage: float = 0.85
    n_boot: int = 2000
    step_min: int = 5
    # O36: bewusst eine Zahl statt ``None``. ``None`` bedeutete „Kadenz aus
    # den Beobachtungen raten“ (``_to_matrix``: max(30, 3 × medianer Abstand),
    # bei grober Kadenz bis 180 Minuten) — die Selektion füllte damit Lücken,
    # die der Trainingspfad ablehnt (``engine/data.py``: frisch ≤
    # ``cfg.ffill_minutes`` = 30). Zwei Wahrheiten für dieselbe Lücke. Seit
    # 0.47.0 übernimmt :meth:`from_engine_config` die 30 Minuten der Engine:
    # Der Collector pollt höchstens alle 5 Minuten (MTS-K-Regel), 30 Minuten
    # decken also sechs verpasste Polls; wer drei Stunden füllt, erfindet
    # Preise, die das Modell nie sieht. Direkt konstruierte
    # Konfigurationen (Tests, Werkzeuge) behalten ``None`` als Default.
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
    # A12: Station-Lebenszyklus — nach so vielen Kalendertagen ohne
    # verwertbaren Preis gilt eine Station als „tot“ und fällt aus dem
    # Ranking (konfigurierbar, Default 7; None/0 = aus). Das Polling-Set
    # bleibt stabil — Tausch nur mit Bestätigung (docs/ANALYSE.md).
    dead_after_days: int | None = 7
    # O2: Weekly receipt availability mass, Monday=0 … Sunday=6. ``None``
    # means the documented shared default; it is not a hidden hard-code.
    user_time_weights: Any = None
    time_profile_source: str = "default"
    # B30: Bodenkante der 12-Uhr-Regel als tz-bewusste Instanz (UTC) oder
    # ``None``. Beobachtungen davor beschreiben eine andere Rechtslage — das
    # Tagestief lag am Abend, nicht im Vormittag
    # (docs/archiv/BEFUND-12-UHR-REGEL-2026-09-18.md §2) — und fallen deshalb aus δ̂, AV-Score
    # und „billigste Stunde". Gezählt werden sie in ``points_before_law``.
    # Kommt aus ``engine/config.py: price_law_local`` (eine Quelle, O36);
    # ``None`` ist die Gegenmessung (TANKAPP_LAW_FLOOR=0).
    law_floor: Any = None

    @classmethod
    def from_engine_config(cls, cfg, **overrides) -> "SelectionConfig":
        """Selektions-Konfiguration aus der Engine-Konfiguration (O36).

        **Eine Quelle für die gemeinsamen Knöpfe.** Vorher kopierte jeder
        Aufrufer vier Felder von Hand (``app/selection.py``,
        ``app/refresh.py``) und ``app/worker.py`` reichte die Ziehungen als
        Literal (B = 2000) im Job-Dispatcher: Wer ``bootstrap_samples`` in
        ``engine/config.py`` änderte (z. B. B22 „mehr Samples“), bekam mehr
        Draws in den Modellen und unverändert 2000 in der Selektion — ohne
        Fehlermeldung.

        Übernommen werden ``bootstrap_samples`` → ``n_boot``,
        ``bootstrap_ew_half_life_days``, ``seed``, ``step_minutes`` →
        ``step_min``, ``ffill_minutes``, ``poll_start``/``poll_end`` und
        ``timezone``. Nur die Selektion betreffende Felder (``fuel``,
        ``min_coverage``, ``tank_volume``, ``delta_ew_half_life_days``,
        ``dead_after_days``) bleiben Default bzw. Override. ``law_floor``
        (B30) kommt aus ``cfg.price_law_local`` — dieselbe Instanz, die
        ``engine/models.py::fit`` als Trainingsbeginn anlegt.

        ``n_boot`` bekommt die Signifikanz-Untergrenze
        (:data:`SELECTION_MIN_BOOTSTRAP`): Ein bewusst kleiner Wert in der
        Engine-Konfiguration (Demo, Versuch) darf nicht still dazu führen,
        dass kein q-Wert mehr unter 0,05 kommen kann. Ein explizites
        ``n_boot``-Override gilt unverändert — es ist die Entscheidung des
        Aufrufers (Demo-Stapel: B = 400, damit er in Sekunden steht);
        ``bootstrap_floor_note`` macht die Abweichung sichtbar.
        """
        shared = {
            "n_boot": max(int(cfg.bootstrap_samples), SELECTION_MIN_BOOTSTRAP),
            "boot_ew_half_life_days": cfg.bootstrap_ew_half_life_days,
            "seed": int(cfg.seed),
            "step_min": int(cfg.step_minutes),
            "ffill_minutes": float(cfg.ffill_minutes),
            "poll_start": int(cfg.poll_start),
            "poll_end": int(cfg.poll_end),
            "timezone": str(cfg.timezone),
            # B30: dieselbe Kante, die der Fit anlegt — kein zweites Datum.
            "law_floor": law_since_utc(cfg),
        }
        shared.update(overrides)
        return cls(**shared)


def bootstrap_floor_note(engine_samples: int, n_boot: int) -> str | None:
    """Klartext, wenn die Selektion mit mehr Ziehungen rechnet als die Engine.

    ``None`` bei Übereinstimmung — der Normalfall. Gedacht für die Job-Logs
    (``app/refresh.py``, ``app/selection.py``): Eine Abweichung zwischen zwei
    Konfigurationsflächen darf nicht still bleiben (O36).
    """
    if int(n_boot) == int(engine_samples):
        return None
    return (
        f"Selektion rechnet mit B={int(n_boot)} statt B={int(engine_samples)}: "
        f"unter B={SELECTION_MIN_BOOTSTRAP} ist mit Benjamini-Hochberg über "
        "das Stations-Set keine Signifikanz erreichbar (p_min = 1/(B+1))."
    )


def _to_matrix(
    df: pd.DataFrame, city: str, step_min: int, ffill_min: float | None
) -> pd.DataFrame:
    """Pivot auf regelmäßiges Raster, Lücken bis ffill_min vorwärts füllen.

    Beobachtungen werden vorher auf das Raster gesnappt (``ceil``) — dieselbe
    Verfügbarkeits-Semantik wie der Trainingspfad (``engine/data.py``:
    ``prepare_series``, „Grid labels are availability times (ceiling)“).
    Ohne den Snap zählt das anschließende ``reindex`` nur Beobachtungen, die
    **exakt** auf einer Rasterzelle liegen; echte Fetch-Zeitstempel (Collector-
    Latenz, Sekunden/Millisekunden) und Archiv-Ereignisse (beliebige
    Uhrzeiten) fallen sonst fast alle heraus, und die Coverage kollabiert auf
    Zufallstreffer (~0 % — „Stadt-Bestwert 0 %“ im Job-Log vom 17.09.2026,
    obwohl dieselben Daten 20 Prognosen trugen).
    """
    d = df[df.city == city]
    if d.empty:
        return pd.DataFrame()
    # Sicherstellen dass timestamp datetime ist
    if not pd.api.types.is_datetime64_any_dtype(d["timestamp"]):
        d = d.copy()
        d["timestamp"] = pd.to_datetime(d["timestamp"], utc=True)
    d = d.assign(timestamp=d["timestamp"].dt.ceil(f"{step_min}min"))
    # Zwei Beobachtungen derselben Station im selben Bucket: die letzte
    # gewinnt — wie im Trainingspfad (``drop_duplicates(available_at)``).
    d = d.sort_values("timestamp", kind="stable").drop_duplicates(
        ["timestamp", "station_id"], keep="last"
    )
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


def law_floor_iso(cfg: SelectionConfig) -> str | None:
    """Bodenkante als ISO-8601 für Artefakt und Anzeige; ``None`` ohne Kante."""
    floor = getattr(cfg, "law_floor", None)
    return None if floor is None else pd.Timestamp(floor).isoformat()


def law_floor_split(
    df: pd.DataFrame,
    law_floor,
    timezone: str = "Europe/Berlin",
    subset: np.ndarray | None = None,
):
    """Beobachtungen an der 12-Uhr-Bodenkante teilen (B30).

    Liefert ``(kept, points_before_law, days_before_law)``: ``kept`` ist der
    Eingang ohne die Zeilen **vor** ``law_floor``, dazu die Zahl der
    ausgeblendeten Beobachtungen und die Zahl der Kalendertage (``timezone``),
    die sie betreffen. Ohne Kante (``law_floor`` ist ``None``,
    ``TANKAPP_LAW_FLOOR=0``) bleibt der Eingang unverändert. ``subset`` grenzt
    Zählen und Schneiden ein (z. B. auf eine Stadt).

    Gemeinsamer Baustein aller Beobachtungs-Pfade — Selektion
    (:func:`law_floor_cut`) und Offline-Werkzeuge
    (``analysis/station_selection.py``) — damit die Kante überall dieselbe
    Zahl liefert.
    """
    if law_floor is None or df is None or df.empty or "timestamp" not in df.columns:
        return df, 0, 0
    stamps = df["timestamp"]
    if not pd.api.types.is_datetime64_any_dtype(stamps):
        stamps = pd.to_datetime(stamps, utc=True)
    elif stamps.dt.tz is None:
        stamps = stamps.dt.tz_localize("UTC")
    before = (stamps < pd.Timestamp(law_floor)).to_numpy()
    if subset is not None:
        before = before & np.asarray(subset, dtype=bool)
    if not before.any():
        return df, 0, 0
    days = int(stamps[before].dt.tz_convert(timezone).dt.normalize().nunique())
    return df.loc[~before], int(before.sum()), days


def law_floor_cut(df: pd.DataFrame, city: str, cfg: SelectionConfig):
    """Beobachtungen **einer Stadt** an der Kante teilen (B30).

    Der Schnitt liegt **vor** :func:`_to_matrix`, nicht danach: Dort füllt
    ``ffill(limit=…)`` Lücken vorwärts — eine Vor-Gesetz-Beobachtung tauchte
    sonst als erste Zelle hinter der Kante wieder auf, und die „Bodenkante"
    wäre eine Behauptung statt eines Schnitts.
    """
    subset = (df["city"] == city).to_numpy() if "city" in df.columns else None
    return law_floor_split(df, getattr(cfg, "law_floor", None), cfg.timezone, subset)


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


def _pct(value: float) -> str:
    """Prozent-Anzeige, die auch kleine Werte nicht zu „0 %“ rundet.

    ``{:.0%}`` macht aus 0,4 % eine „0 %“ — im Job-Log vom 17.09.2026 sah das
    aus wie „keine Daten“, war aber nur sehr dünne Abdeckung. Unter 1 % wird
    deshalb eine Nachkommastelle gezeigt (de-DE-Komma wie in den GUI-Texten).
    """
    if not np.isfinite(value):
        return "–"
    digits = 0 if abs(value) >= 0.0995 else 1
    return f"{value:.{digits}%}".replace(".", ",")


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


# ---------------------------------------------------------------------------
# A12: Station-Lebenszyklus — tot vs. geschlossen vs. führt Kraftstoff nicht
# ---------------------------------------------------------------------------


def _station_lifecycle(
    df: pd.DataFrame, city: str, station_id: str, cfg: SelectionConfig, end_ts
) -> str:
    """Lebenszyklus einer Station für diesen Kraftstoff (A12).

    Unterscheidet, warum kein Preis da ist — die GUI soll nicht drei
    Zustände vermischen (MICROCOPY: Zustände benennen, nicht bewerten):

    * ``active``    — mindestens ein verwertbarer Preis in den letzten
                      ``dead_after_days`` Kalendertagen (Berlin)
    * ``dead``      — keine Beobachtung / Status „no prices“ seit
                      ``dead_after_days`` Tagen — „tote“ Station
    * ``closed``    — „temporär geschlossen“ (Status geschlossen)
    * ``no_fuel``   — „führt E10 nicht“ (offen, aber Sorte nie als
                      Zahl gemeldet — ``false`` bei der API)

    ``None``/0 bei ``dead_after_days`` schaltet die Tot-Erkennung ab
    (konfigurierbar, TODO A12).
    """
    dead_days = getattr(cfg, "dead_after_days", 7)
    try:
        dead_days_int = int(dead_days) if dead_days is not None else 0
    except (TypeError, ValueError):
        dead_days_int = 0
    if dead_days_int <= 0 or end_ts is None or pd.isna(end_ts):
        return "active"
    # Fenster: letzte dead_days Kalendertage (Berlin) inkl. End-Tag
    try:
        end = pd.Timestamp(end_ts)
        if end.tzinfo is None:
            end = end.tz_localize("UTC")
        end_local = end.tz_convert(cfg.timezone)
        window_start = (end_local - pd.Timedelta(days=dead_days_int - 1)).normalize()
        window_start_utc = window_start.tz_convert("UTC")
    except Exception:
        return "active"
    sub = df[
        (df.city == city)
        & (df.station_id == station_id)
        & (df.fuel.str.upper() == cfg.fuel.upper())
    ]
    if sub.empty:
        return "dead"
    # Beobachtungen im Fenster (Kalendertage)
    try:
        ts = pd.to_datetime(sub["timestamp"], utc=True)
    except Exception:
        return "active"
    in_window = ts >= window_start_utc
    window_rows = sub.loc[in_window]
    if window_rows.empty:
        return "dead"
    # Gibt es irgendeinen Preis im Fenster?
    has_price = window_rows["price"].notna().any() if "price" in window_rows else False
    # Fallback: numerische Prüfung (price kann string sein)
    if not has_price and "price" in window_rows:
        try:
            has_price = (
                pd.to_numeric(window_rows["price"], errors="coerce").notna().any()
            )
        except Exception:
            pass
    if has_price:
        return "active"
    # Kein Preis — warum?
    statuses = (
        window_rows.get("status", pd.Series(dtype=str))
        .astype(str)
        .str.strip()
        .str.lower()
    )
    if statuses.empty:
        return "dead"
    # Alle „no prices“ → tot (API liefert seit Tagen kein Signal)
    if (statuses == "no prices").all():
        return "dead"
    # Überwiegend geschlossen → temporär geschlossen
    if (statuses == "closed").all() or (statuses == "closed").mean() > 0.8:
        return "closed"
    # Offen aber Sorte fehlt → führt diesen Kraftstoff nicht
    if (statuses == "open").any():
        return "no_fuel"
    return "dead"


def _detect_price_twins(
    df: pd.DataFrame, city: str, station_ids: list[str], cfg: SelectionConfig
) -> list[dict]:
    """Preis-Zwillinge (A13) — identische Verläufe zweier Stationen.

    Nutzt dieselben Schwellen wie ``engine/station_comparison.py`` (read-only,
    nie auto-apply): mind. 28 Tage mit je ≥12 gemeinsamen Punkten, ≥90 %
    Überlappung, ≥99 % der gemeinsamen Punkte innerhalb 0,1 ct/L. Liefert
    Warnungen für das Selektions-Artefakt + System-Tab, baut das Polling-Set
    nie automatisch um (TODO: Raus Polling-Set Umbau ohne Bestätigung).

    Implementiert leichtgewichtig auf dem DataFrame, ohne PriceSeries-Overhead.
    """
    # Kriterien aus station_comparison.Criteria
    min_days = 28
    min_common_per_day = 12
    tol_ct = 0.1
    min_agreement = 99.0
    min_overlap = 90.0
    if len(station_ids) < 2:
        return []
    # Nur dieser Kraftstoff/Stadt
    city_df = df[(df.city == city) & (df.fuel.str.upper() == cfg.fuel.upper())]
    if city_df.empty:
        return []
    # Je Station: Series der beobachteten Preise (nur price notna)
    series_by_id: dict[str, pd.Series] = {}
    for sid in station_ids:
        sub = city_df[city_df.station_id == sid]
        if sub.empty:
            continue
        # Nur echte Preise
        price_numeric = pd.to_numeric(sub["price"], errors="coerce")
        ok = price_numeric.notna()
        if not ok.any():
            continue
        s = pd.Series(
            price_numeric[ok].to_numpy(),
            index=pd.to_datetime(sub.loc[ok, "timestamp"], utc=True),
        )
        s = s.sort_index()
        # Doppelte Zeitstempel: letzter gewinnt (wie normalize)
        s = s[~s.index.duplicated(keep="last")]
        series_by_id[sid] = s
    twins: list[dict] = []
    ids = sorted(series_by_id)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a_id, b_id = ids[i], ids[j]
            sa, sb = series_by_id[a_id], series_by_id[b_id]
            # Gemeinsame Zeitstempel (exakt, da Polling-Batch je Stadt)
            common_idx = sa.index.intersection(sb.index)
            n_common = len(common_idx)
            if n_common == 0:
                continue
            n_a, n_b = len(sa), len(sb)
            overlap = 100.0 * n_common / max(n_a, n_b) if max(n_a, n_b) else 0.0
            if overlap < min_overlap:
                continue
            # Pro Tag: Berlin-Datum
            try:
                dates = common_idx.tz_convert(cfg.timezone).normalize()
            except Exception:
                continue
            per_day = pd.Series(1, index=dates).groupby(level=0).size()
            qualifying_days = int((per_day >= min_common_per_day).sum())
            if qualifying_days < min_days:
                continue
            # Preisdifferenz in ct/L
            delta_ct = (
                sa.loc[common_idx].to_numpy() - sb.loc[common_idx].to_numpy()
            ) * 100.0
            delta_ct = np.abs(delta_ct)
            # Vereinzelte NaNs aus numerischen Fehlern ignorieren
            delta_ct = delta_ct[np.isfinite(delta_ct)]
            if len(delta_ct) == 0:
                continue
            agreement = (
                float(100.0 * np.mean(delta_ct <= tol_ct + 1e-9))
                if len(delta_ct)
                else 0.0
            )
            if agreement < min_agreement:
                continue
            twins.append(
                {
                    "station_a": a_id,
                    "station_b": b_id,
                    "city": city,
                    "fuel": cfg.fuel,
                    "common_points": int(n_common),
                    "overlap_pct": float(overlap),
                    "qualifying_days": int(qualifying_days),
                    "agreement_pct": float(agreement),
                    "mean_abs_delta_ct": float(np.mean(delta_ct))
                    if len(delta_ct)
                    else None,
                    "p95_abs_delta_ct": float(np.quantile(delta_ct, 0.95))
                    if len(delta_ct)
                    else None,
                    "max_abs_delta_ct": float(np.max(delta_ct))
                    if len(delta_ct)
                    else None,
                    "classification": "possible_price_twins",
                    "auto_apply": False,
                }
            )
    return twins


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


# O18: Die CUSUM-Schwelle als benannte Konstante — `app/stats_summary.py`
# publizierte bisher 3,0 als „Schwelle“, während hier bei 2,0 geflaggt wird.
# Zwei Zahlen für dieselbe Schwelle, eine davon falsch angezeigt.
CUSUM_THRESHOLD = 2.0


def cusum_break(daily: np.ndarray, h: float = CUSUM_THRESHOLD) -> tuple[bool, float]:
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
    # B30: Erst an der 12-Uhr-Bodenkante schneiden, dann aufs Raster —
    # sonst zieht der Forward-Fill Vor-Gesetz-Preise über die Kante.
    kept, points_before_law, days_before_law = law_floor_cut(df, city, cfg)
    law_fields = {
        "law_floor": law_floor_iso(cfg),
        "points_before_law": points_before_law,
        "days_before_law": days_before_law,
    }
    mat = _to_matrix(kept, city, cfg.step_min, cfg.ffill_minutes)
    if mat.empty:
        if points_before_law:
            # Ehrlicher Grund statt „Stadt verschwunden": Der Bestand liegt
            # vollständig vor der Kante — kein Ranking, aber erklärbar.
            return _diagnostic(
                city,
                cfg,
                mat,
                [],
                f"alle {points_before_law} Beobachtungen ({days_before_law} Tage) "
                f"liegen vor der 12-Uhr-Bodenkante {law_fields['law_floor']}",
                **law_fields,
            )
        return None
    if mat.shape[1] < 2:
        # Zu wenig Stationen für LOO — Diagnose statt stilles None.
        return _diagnostic(
            city,
            cfg,
            mat,
            list(mat.columns),
            f"nur {mat.shape[1]} Station(en) mit Daten — LOO braucht ≥2 (≥4 für δ̂)",
            **law_fields,
        )
    # A12: Lebenszyklus — tote Stationen (kein Preis seit dead_after_days
    # Kalendertagen) fallen vor dem Coverage-Gate aus dem Ranking.
    # Konfigurierbar, Default 7 Tage. Geschlossen / führt-nicht bleiben
    # unterscheidbar, aber noch im Gate. Gepollt wird weiter — das Set
    # ändert sich erst nach Bestätigung (keine Selbst-Tot-Schleife).
    end_ts = df["timestamp"].max() if not df.empty and "timestamp" in df else None
    lifecycles: dict[str, str] = {}
    dead_stations: list[str] = []
    closed_stations: list[str] = []
    nofuel_stations: list[str] = []
    # A12: Stationen ohne einzige Rasterzelle (nie ein Preis im Fenster)
    # stehen nicht in mat — ohne diese Zeilen wären sie unsichtbar statt
    # tot (kein Ranking-Ausschluss im Artefakt, kein Alarm, kein Tausch).
    mat_ids = list(mat.columns)
    try:
        _fuel_match = df.fuel.str.upper() == cfg.fuel.upper()
        _known = set(mat_ids)
        df_only_ids = [
            sid
            for sid in df.loc[(df.city == city) & _fuel_match, "station_id"].unique()
            if sid not in _known and not pd.isna(sid) and str(sid) != ""
        ]
    except Exception:
        df_only_ids = []
    for sid in mat_ids + df_only_ids:
        lc = _station_lifecycle(df, city, sid, cfg, end_ts)
        lifecycles[sid] = lc
        if lc == "dead":
            dead_stations.append(sid)
        elif lc == "closed":
            closed_stations.append(sid)
        elif lc == "no_fuel":
            nofuel_stations.append(sid)
    # Tote Stationen aussortieren — raus aus dem Ranking (A12)
    if dead_stations:
        mat = mat.drop(columns=[c for c in dead_stations if c in mat.columns])
        if mat.empty or mat.shape[1] < 2:
            return _diagnostic(
                city,
                cfg,
                mat,
                dead_stations,
                f"nach Ausschluss toter Stationen (kein Preis seit {cfg.dead_after_days} Kalendertagen) nur {mat.shape[1]} Station(en) übrig — LOO braucht ≥2 (≥4 für δ̂)",
                coverage=pd.Series(dtype=float),
                coverage_reference=0.0,
                coverage_threshold=0.0,
                dead_stations=dead_stations,
                dead_count=len(dead_stations),
                lifecycles=lifecycles,
                closed_stations=closed_stations,
                nofuel_stations=nofuel_stations,
                **law_fields,
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
            dead_stations + excluded,
            f"nach Coverage-Gate (≥{cfg.min_coverage:.0%} vom Stadt-Bestwert "
            f"{_pct(coverage_reference)} im Fenster "
            f"{cfg.poll_start:02d}–{cfg.poll_end:02d} Uhr) nur {mat.shape[1]} "
            f"Station(en) übrig — LOO braucht ≥4",
            coverage=coverage,
            coverage_reference=coverage_reference,
            coverage_threshold=coverage_threshold,
            dead_stations=dead_stations,
            dead_count=len(dead_stations),
            closed_stations=closed_stations,
            closed_count=len(closed_stations),
            nofuel_stations=nofuel_stations,
            nofuel_count=len(nofuel_stations),
            lifecycles=lifecycles,
            **law_fields,
        )

    base = _loo_baseline(mat)
    delta = (mat - base) * 100.0  # ct/L relativ

    hours = mat.index.hour.to_numpy() + mat.index.minute.to_numpy() / 60.0
    # O2: availability is P(Top-3 | weekday, hour), weighted by exactly the
    # same receipt/default profile used for decision windows.
    time_weights = (
        normalized_profile(cfg.user_time_weights) or default_weekday_profile()
    )
    local_index = (
        mat.index.tz_convert(cfg.timezone)
        if getattr(mat.index, "tz", None) is not None
        else mat.index
    )
    weekday_arr = local_index.dayofweek.to_numpy()
    days = mat.index.normalize()
    day_keys = {d: i for i, d in enumerate(days.unique())}
    dnum = np.array([day_keys[d] for d in days], dtype=float)

    rank = mat.rank(axis=1, method="min", na_option="keep")
    win = (rank <= 3).astype(float).where(mat.notna())
    P = np.full((mat.shape[1], 7, 24), np.nan)
    hour_arr = np.floor(hours).astype(int)
    # O28: Eine (Wochentag, Stunde)-Zelle ohne einzigen verwertbaren Wert —
    # Nachtzellen hinter dem Polling-Fenster, tote Stationen — lässt
    # ``np.nanmean`` über einen All-NaN-Schnitt laufen. NaN ist hier das
    # erwartete Ergebnis („keine Aussage“), die RuntimeWarning wäre
    # Fehlalarm; derselbe Umgang wie in ``engine.probabilities.block_minima``.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # All-NaN → NaN
        for weekday in range(7):
            for hi in range(24):
                sel = (weekday_arr == weekday) & (hour_arr == hi)
                if sel.any():
                    P[:, weekday, hi] = np.nanmean(win.to_numpy()[sel], axis=0)

    sids = list(mat.columns)
    rows = []
    # B21: Stationen ohne einzigen verwertbaren Zeitpunkt (LOO braucht ≥4
    # Stationen mit Wert zur selben Zeit) haben kein δ̂. Sie fallen aus dem
    # Ranking, statt als NaN-Zeile publiziert zu werden — und der Grund steht
    # im Artefakt.
    no_delta = []
    for j, sid in enumerate(sids):
        d = delta[sid].to_numpy()
        # O28: Eine Station ohne einzigen verwertbaren δ̂-Wert ist der
        # erwartbare Fall (tote Station, LOO ohne Überlappung) — der
        # All-NaN-Median ist dann NaN und wird unten begründet übersprungen,
        # die Warnung wäre Fehlalarm.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # All-NaN → NaN
            d_hat = float(np.nanmedian(d))
            half = np.floor(hours * 2) / 2
            bins = np.arange(0, 24, 0.5)
            # Halbe-Stunden-Bins ohne Beobachtung (Nachtzellen hinter dem
            # Polling-Fenster) laufen hier über einen All-NaN-Schnitt.
            med = np.array([np.nanmedian(d[half == b]) for b in bins])
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
        _wsum = float(np.asarray(time_weights)[_mask].sum()) if _mask.any() else 0.0
        avail = (
            float(np.sum(P[j][_mask] * np.asarray(time_weights)[_mask]) / _wsum)
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
                lifecycle=lifecycles.get(sid, "active"),
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
            dead_stations + excluded + no_delta,
            f"{len(no_delta)} Station(en) ohne verwertbares δ̂ — zu wenig "
            f"gleichzeitige Werte (LOO braucht ≥4 Stationen je Zeitpunkt)",
            coverage=coverage,
            coverage_reference=coverage_reference,
            coverage_threshold=coverage_threshold,
            dead_stations=dead_stations,
            dead_count=len(dead_stations),
            closed_stations=closed_stations,
            closed_count=len(closed_stations),
            nofuel_stations=nofuel_stations,
            nofuel_count=len(nofuel_stations),
            lifecycles=lifecycles,
            **law_fields,
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
    # A13: Preis-Zwillinge erkennen (identische Verläufe) — Warnung, nie auto-apply
    try:
        price_twins = _detect_price_twins(
            df, city, list(tab["station_id"]) if not tab.empty else [], cfg
        )
    except Exception:
        price_twins = []
    # A12: Lebenszyklus-Bilanz für die Stadt (für Artefakt + GUI)
    # lifecycles enthält nur die ursprünglich im mat vorhandenen Stationen;
    # tote sind bereits vor dem Coverage-Gate entfernt, geschlossene/führt-nicht bleiben bis hier.
    lifecycle_counts = {
        "active": sum(1 for v in lifecycles.values() if v == "active"),
        "dead": len(dead_stations),
        "closed": len(closed_stations),
        "no_fuel": len(nofuel_stations),
    }
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
        "availability_profile": {
            "source": cfg.time_profile_source,
            "weekday_hour_weights": time_weights,
        },
        "excluded_count": len(dead_stations) + len(excluded),
        "excluded": (dead_stations + excluded)[:20],
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
        # A12: Station-Lebenszyklus — tote raus aus dem Ranking,
        # die drei Zustände bleiben unterscheidbar (GUI zeigt Badge).
        "dead_stations": dead_stations[:20],
        "dead_count": len(dead_stations),
        "closed_stations": closed_stations[:20],
        "closed_count": len(closed_stations),
        "nofuel_stations": nofuel_stations[:20],
        "nofuel_count": len(nofuel_stations),
        "lifecycle_counts": lifecycle_counts,
        "lifecycles": {
            k: v
            for k, v in lifecycles.items()
            if k in set(tab["station_id"])
            or k in dead_stations
            or k in closed_stations
            or k in nofuel_stations
        },
        # A13: Preis-Zwillinge als Warnung (nie auto-apply, Dauer-partial)
        "price_twins": price_twins,
        "price_twin_count": len(price_twins),
        # B30: worauf dieses Ranking steht — Kante der 12-Uhr-Regel und wie
        # viele Beobachtungen (über wie viele Tage) davor ausgeblendet sind.
        **law_fields,
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
    # A12/A13: aggregierte Lebenszyklus- und Zwillingssummen
    all_twins: list[dict] = []
    lifecycle_totals = {"active": 0, "dead": 0, "closed": 0, "no_fuel": 0}
    for r in all_results:
        all_twins.extend(r.get("price_twins", []))
        counts = r.get("lifecycle_counts") or {}
        for k in lifecycle_totals:
            lifecycle_totals[k] += int(counts.get(k, 0) or 0)
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
        # A12/A13: aggregiert für System-Tab / Artefakt-Warnungen
        "price_twins": all_twins,
        "price_twin_count": len(all_twins),
        "lifecycle_totals": lifecycle_totals,
        "dead_after_days": getattr(cfg, "dead_after_days", 7),
        # B30: Bodenkante der 12-Uhr-Regel über alle Städte — die GUI sagt
        # damit, worauf das Ranking steht, und wie viel Bestand die Kante
        # ausblendet (0 = Garantie ohne Wirkung, nicht „nicht gemessen").
        "law_floor": law_floor_iso(cfg),
        "points_before_law": sum(
            int(r.get("points_before_law") or 0) for r in all_results
        ),
        "days_before_law": max(
            (int(r.get("days_before_law") or 0) for r in all_results), default=0
        ),
    }
