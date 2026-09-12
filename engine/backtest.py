"""Rolling origins, strictly past-only fits, real open observations as truth."""

from dataclasses import replace

import numpy as np
import pandas as pd

from .config import Config
from .data import PriceSeries, scheduled
from .models import fit, predict, utc_time

PENDING = [
    "M3-Zweitmodell (ETS/Local-Level) und inverse-MASE-Ensemble",
    "CUSUM-Sprungtage und gesonderte MASE-Abnahme sprungfreier Tage",
    "Out-of-sample-Kalibrierung / ACI nach ausreichender Live-Historie",
    "Echt-Daten-Abnahme aller M3-Kriterien auf NAS/PC",
]

# Mehrtage-Backtests (Konzept §3.4): zusätzlich zum 24-h-Tag je Origin wird
# das 24-h-Fenster am Anfang des +3-d- bzw. +7-d-Horizonts bewertet.
HORIZON_HOURS = (72, 168)

# Rolling-PICP je Station (Konzept §3.3.3): 7-Tage-Fenster, nominal 95 %.
# Grün ≥ nominal − 2 pp, gelb ≥ nominal − 5 pp, rot darunter → §4.4-Modus.
ROLLING_PICP_WINDOW_DAYS = 7
ROLLING_PICP_NOMINAL_PCT = 95.0
ROLLING_PICP_MIN_POINTS = 72  # 3 volle Tage — darunter keine Aussage

# Issue 47: asymmetrischer Pinball-Loss. Warten in eine Preiserhöhung
# (tatsächlich teurer als prognostiziert) kostet Vertrauen; 2 ct zu früh
# tanken schmerzt weniger. Mit τ=0,75 wird Unterschätzung des Preises
# (actual > q50) dreimal so stark bestraft wie Überschätzung:
#   L = τ·(y−q) falls y ≥ q, sonst (1−τ)·(q−y).
PINBALL_TAU_ASYM = 0.75


def pinball_loss(actual, forecast, tau: float = PINBALL_TAU_ASYM):
    """Pinball-Verlust je Punkt (gleiche Einheit wie die Preise).

    Für τ=0,5 symmetrisch (0,5·|Fehler|); für τ>0,5 wird Unterschätzung
    (actual > forecast) stärker bestraft.
    """
    diff = np.asarray(actual, dtype=float) - np.asarray(forecast, dtype=float)
    return np.where(diff >= 0, tau * diff, (tau - 1.0) * diff)


def metrics(rows: pd.DataFrame) -> dict:
    if rows.empty:
        return {
            "points": 0,
            "mae_ct": None,
            "rmse_ct": None,
            "mase": None,
            "mase_points": 0,
            "smape_pct": None,
            "pinball50_ct": None,
            "naive_pinball50_ct": None,
            "pinball_asym_ct": None,
            "naive_pinball_asym_ct": None,
            "picp95_pct": None,
            "mpiw95_ct": None,
        }
    error = rows.actual - rows.q50
    scaled = error.abs() / rows.mase_scale
    return {
        "points": len(rows),
        "mae_ct": 100 * float(error.abs().mean()),
        "rmse_ct": 100 * float(np.sqrt((error**2).mean())),
        "mase": float(scaled.mean()) if scaled.notna().any() else None,
        "mase_points": int(scaled.notna().sum()),
        "smape_pct": float(
            (200 * error.abs() / (rows.actual.abs() + rows.q50.abs())).mean()
        ),
        "pinball50_ct": 50 * float(error.abs().mean()),
        "naive_pinball50_ct": 50 * float((rows.actual - rows.naive).abs().mean()),
        "pinball_asym_ct": 100 * float(pinball_loss(rows.actual, rows.q50).mean()),
        "naive_pinball_asym_ct": 100
        * float(pinball_loss(rows.actual, rows.naive).mean()),
        "picp95_pct": 100
        * float(((rows.actual >= rows.q025) & (rows.actual <= rows.q975)).mean()),
        "mpiw95_ct": 100 * float((rows.q975 - rows.q025).mean()),
    }


def truncate_series(item: PriceSeries, end_utc: pd.Timestamp) -> PriceSeries:
    """Kopie der Reihe mit Raster strikt vor ``end_utc`` (exklusives Ende).

    Alles, was ein Backtest mit Ende ``end`` lesen darf. Kein Umbau der
    Daten — nur ein Zuschnitt; ``hampel_removed`` bleibt der Wert der
    vollen Reihe (Diagnostik, fließt nicht in den Bericht).
    """
    frame = item.frame
    if len(frame) and frame.index[-1] >= end_utc:
        frame = frame.loc[frame.index < end_utc]
    return replace(item, frame=frame)


def last_complete_day(series: list[PriceSeries], cfg: Config) -> pd.Timestamp:
    # Use a shared cutoff, not a different period for every station. Stations
    # whose data ended earlier get explicit missing folds, not flattering tests.
    last = max(item.frame.index.max() for item in series) + pd.Timedelta(
        minutes=cfg.step_minutes
    )
    return last.tz_convert(cfg.timezone).normalize()


DECISION_HOUR = 12
DECISION_THETA_CT = 1.0


def decision_row(
    truth: pd.DataFrame,
    forecast: pd.DataFrame,
    target: pd.DatetimeIndex,
    local_origin: pd.Timestamp,
    timezone: str,
    decision_hour: int = DECISION_HOUR,
) -> dict | None:
    """Eine Entscheidungszeile zum Tages-Anker (Konzept §6, Schicht A).

    Entscheidungsregel wie im Live-Betrieb: Zur Ankerstunde Ortszeit gilt der
    zuletzt beobachtete Preis als Anker; der Mitternachts-Fit (reines
    Vergangenheits-Training, identisch zum Produktiv-Regime mit nächtlichem
    Fit) liefert die Tageserwartung. Bewertet gegen realisierte offene Preise.
    None, wenn der Tag nicht entscheidbar ist (kein Anker, keine Erwartung
    oder keine Realisierung nach dem Anker) — solche Tage werden gezählt,
    nicht erfunden.

    Der Anker ist ``cfg.decision_hour`` (Default 12): Anhebungen gibt es nur
    mittags (12-Uhr-Regel) — um 12 Uhr weiß der hypothetische Entscheid, ob
    es heute teurer wurde; um 8 Uhr fehlt ihm genau diese Information.
    """
    if len(target) == 0:
        return None
    cutoff = (local_origin + pd.DateOffset(hours=decision_hour)).tz_convert("UTC")
    before = target <= cutoff
    after = target > cutoff
    if not bool(after.any()):
        return None
    anchor_sel = truth.loc[before & truth.observed, "price"].dropna()
    if anchor_sel.empty:
        return None
    expected_sel = forecast.loc[after, "q50"].dropna()
    if expected_sel.empty:
        return None
    realized_sel = truth.loc[after & truth.observed, "price"].dropna()
    if realized_sel.empty:
        return None
    anchor_price = float(anchor_sel.iloc[-1])
    exp_min = float(expected_sel.min())
    real_min = float(realized_sel.min())
    pred_ts = expected_sel.idxmin()
    pred_local = pd.Timestamp(pred_ts).tz_convert(timezone)
    pred_hour = round(pred_local.hour + pred_local.minute / 60.0, 2)
    mu = round((anchor_price - exp_min) * 100.0, 2)
    saving = round((anchor_price - real_min) * 100.0, 2)
    # Tageskurve der Erwartung (ct vs. Tages-Anker, x = Berlin-Stunde) fürs Labor.
    curve = []
    for ts, q50 in expected_sel.items():
        local = pd.Timestamp(ts).tz_convert(timezone)
        curve.append(
            {
                "x": round(local.hour + local.minute / 60.0, 2),
                "y": round((float(q50) - anchor_price) * 100.0, 2),
            }
        )
    return {
        "day": local_origin.date().isoformat(),
        "cls": 1 if local_origin.dayofweek >= 5 else 0,
        "mu": mu,
        "p": None,  # P(S>0): kein P-Modell in der Engine (ehrlich null)
        "s": saving,
        "best": round(max(saving, 0.0), 2),
        "predHour": pred_hour,
        "curve": curve,
    }


def picp_badge(picp_pct: float | None, points: int) -> str | None:
    """Konfidenz-Badge (Konzept §3.3.3) aus einer Rolling-PICP-Zahl.

    ``None`` bei zu wenig Punkten (keine Aussage, kein geratenes Grün).
    """
    if picp_pct is None or points < ROLLING_PICP_MIN_POINTS:
        return None
    if picp_pct >= ROLLING_PICP_NOMINAL_PCT - 2.0:
        return "green"
    if picp_pct >= ROLLING_PICP_NOMINAL_PCT - 5.0:
        return "yellow"
    return "red"


def rolling_picp_7d(
    rows: pd.DataFrame,
    series: list[PriceSeries],
    timezone: str,
    test_days: list[pd.Timestamp],
) -> list[dict]:
    """7-Tage-Rolling-PICP je Station (Konzept §3.3.3).

    Für jeden Testtag ``d`` werden die Vergleichspunkte der letzten 7 Tage
    (inklusive ``d``) gepoolt; ausgedehnte Tage ohne bewertete Punkte
    (übersprungene Folds) steuern ehrlich null Punkte bei. ``current`` ist
    der zuletzt verlaufene Testtag — die Zahl, die das Güte-Gate (§4.4)
    in der Entscheidung nutzt.
    """
    if not len(rows):
        return [
            {
                **item.identity(),
                "window_days": ROLLING_PICP_WINDOW_DAYS,
                "nominal_pct": ROLLING_PICP_NOMINAL_PCT,
                "days": [],
                "current": None,
            }
            for item in series
        ]
    work = rows.copy()
    origin_days = (
        pd.to_datetime(work.origin, utc=True).dt.tz_convert(timezone).dt.normalize()
    )
    work["origin_day"] = origin_days
    covered = (work.actual >= work.q025) & (work.actual <= work.q975)
    results = []
    for item in series:
        sub = work[
            (work.city == item.city)
            & (work.station_id == item.station_id)
            & (work.fuel == item.fuel)
        ]
        day_entries = []
        for day in test_days:
            pool = sub[
                (
                    sub.origin_day
                    >= day - pd.DateOffset(days=ROLLING_PICP_WINDOW_DAYS - 1)
                )
                & (sub.origin_day <= day)
            ]
            points = int(len(pool))
            picp = 100.0 * float(covered[pool.index].mean()) if points else None
            day_entries.append(
                {
                    "day": day.tz_convert(timezone).strftime("%Y-%m-%d"),
                    "picp_pct": round(picp, 2) if picp is not None else None,
                    "points": points,
                    "badge": picp_badge(picp, points),
                }
            )
        current = day_entries[-1] if day_entries else None
        results.append(
            {
                **item.identity(),
                "window_days": ROLLING_PICP_WINDOW_DAYS,
                "nominal_pct": ROLLING_PICP_NOMINAL_PCT,
                "days": day_entries,
                "current": current,
            }
        )
    return results


def run_backtest(
    series: list[PriceSeries],
    cfg: Config,
    days: int = 21,
    until=None,
    strict_end: bool | None = None,
) -> tuple[dict, pd.DataFrame]:
    """Rolling-Origin-Backtest über ``days`` lokale Tage bis ``until`` (exklusiv).

    ``strict_end`` (B17): Reihe und Mehrtage-Fenster hart am Ende abschneiden,
    damit der Bericht eine reine Funktion der Daten **vor** dem Ende ist.
    Default: an, wenn das Ende automatisch aus den Daten bestimmt wird (der
    letzte Tag ist dann angebrochen und darf nicht als Wahrheit dienen);
    aus bei explizitem ``until`` (CLI-Auswertung mit bekannter Zukunft).
    """
    if not 1 <= days <= 90:
        raise ValueError("Backtest-Zeitraum muss 1 bis 90 Tage betragen.")
    end = (
        utc_time(until, cfg.timezone).tz_convert(cfg.timezone)
        if until
        else last_complete_day(series, cfg)
    )
    if end != end.normalize():
        raise ValueError(
            "Backtest --until muss eine lokale Mitternacht sein (exklusives Ende)."
        )
    origins = pd.date_range(
        end - pd.DateOffset(days=days), end, freq="D", inclusive="left"
    )
    # B17: Der Bericht endet exklusiv an ``end`` — auch die Mehrtage-Fenster.
    # Vorher wurden +3-d/+7-d-Fenster der letzten Folds gegen den *laufenden*
    # (unvollständigen) Tag bewertet, obwohl ``test_end_exclusive`` Mitternacht
    # nannte; damit hing der Bericht untertägig von jeder neuen Stunde ab.
    # Mit dem Zuschnitt ist er eine reine Funktion der Daten vor ``end`` —
    # Voraussetzung für den Tages-Cache (app/backtest_cache.py) und ehrlicher:
    # bewertet wird nur, was innerhalb des Testzeitraums liegt.
    if strict_end is None:
        strict_end = until is None
    end_utc = end.tz_convert("UTC")
    if strict_end:
        series = [truncate_series(item, end_utc) for item in series]
    folds, predictions = [], []
    decision_rows: list[dict] = []
    decision_skipped = 0
    # Mehrtage-Horizonte (Konzept §3.4): je Origin wird zusätzlich das
    # 24-h-Fenster am Horizontbeginn bewertet (+3 d: [origin+72h, +96h),
    # +7 d: [origin+168h, +192h)). Selbes Modell, selbe Wahrheit, selbe
    # gemeinsame Abdeckung — die Güte der +3/+7-d-Prognose, die das Frontend
    # als Fan-Chart zeigt, bekommt damit ihre eigene Messzahl.
    horizon_predictions: dict[int, list[pd.DataFrame]] = {h: [] for h in HORIZON_HOURS}
    horizon_folds: dict[int, dict[str, int]] = {
        h: {"evaluated": 0, "no_common_observations": 0, "beyond_test_end": 0}
        for h in HORIZON_HOURS
    }
    for item in series:
        for local_origin in origins:
            origin = local_origin.tz_convert("UTC")
            stop = (local_origin + pd.DateOffset(days=1)).tz_convert("UTC")
            target = pd.date_range(
                origin, stop, freq=f"{cfg.step_minutes}min", inclusive="left"
            )
            target = target[scheduled(target, cfg)]
            truth = item.frame.reindex(target)
            observed = truth.observed.eq(True)
            responses = truth.response_observed.eq(True)
            fold = {
                **item.identity(),
                "origin": origin.isoformat(),
                "training_end_exclusive": origin.isoformat(),
                "target_points": len(target),
                "observed_prices": int(observed.sum()),
                "response_coverage_pct": 100 * float(responses.mean()),
                "status_known_fraction": float(
                    truth.loc[observed, "status_known"].mean()
                )
                if observed.any()
                else None,
            }
            try:
                model = fit(item, origin, cfg)
                forecast = predict(model, index=target)
            except ValueError as exc:
                folds.append(
                    {
                        **fold,
                        "status": "skipped",
                        "reason": str(exc),
                        **metrics(pd.DataFrame()),
                    }
                )
                continue
            # Entscheidungszeile zum Tages-Anker (Schicht A): Mitternachts-Fit
            # als Erwartung, realisierte offene Preise als Wahrheit.
            decision = decision_row(
                truth, forecast, target, local_origin, cfg.timezone, cfg.decision_hour
            )
            if decision is None:
                decision_skipped += 1
            else:
                decision_rows.append({**item.identity(), **decision})
            # Same support for every comparison. Engine-added fill is never
            # scored as truth. Legacy inputs may already contain reconstructed
            # rows; keep that provenance explicit and block live-evidence gates.
            valid = observed & forecast.q50.notna() & forecast.naive.notna()
            rows = forecast.loc[valid].copy()
            rows["actual"] = truth.loc[valid, "price"]
            rows["source"] = truth.loc[valid, "source"]
            rows["status_known"] = truth.loc[valid, "status_known"]
            rows["mase_scale"] = (
                model["mase_scale"] if model["mase_scale"] is not None else np.nan
            )
            for key, value in item.identity().items():
                rows[key] = value
            rows["origin"] = origin.isoformat()
            rows["timestamp"] = rows.index.map(lambda time: time.isoformat())
            folds.append(
                {
                    **fold,
                    "status": "scored" if len(rows) else "no_common_observations",
                    "training_days": model["training_days"],
                    "mase_scale": model["mase_scale"],
                    "law_rise_outside_noon": model["law_rise_outside_noon"],
                    "training_status_known_fraction": model["status_known_fraction"],
                    "comparison_coverage_pct": 100 * len(rows) / int(observed.sum())
                    if observed.any()
                    else 0,
                    **metrics(rows),
                }
            )
            if len(rows):
                predictions.append(rows)
            # Selbes Modell für die Mehrtage-Fenster; die 12-Uhr-Projektion
            # und die AR-Fortsetzung laufen über dasselbe Raster wie live.
            for horizon_hours in HORIZON_HOURS:
                h_start = origin + pd.Timedelta(hours=horizon_hours)
                if strict_end and h_start >= end_utc:
                    # Fenster liegt ganz außerhalb des Testzeitraums (Zukunft
                    # aus Sicht des Berichts) — zählen, nicht als „keine
                    # gemeinsame Beobachtung“ tarnen.
                    horizon_folds[horizon_hours]["beyond_test_end"] += 1
                    continue
                h_target = pd.date_range(
                    h_start,
                    h_start + pd.Timedelta(days=1),
                    freq=f"{cfg.step_minutes}min",
                    inclusive="left",
                )
                h_target = h_target[scheduled(h_target, cfg)]
                h_truth = item.frame.reindex(h_target)
                h_observed = h_truth.observed.eq(True)
                h_forecast = predict(model, index=h_target)
                h_valid = h_observed & h_forecast.q50.notna() & h_forecast.naive.notna()
                h_rows = h_forecast.loc[h_valid].copy()
                if not len(h_rows):
                    horizon_folds[horizon_hours]["no_common_observations"] += 1
                    continue
                h_rows["actual"] = h_truth.loc[h_valid, "price"]
                h_rows["mase_scale"] = (
                    model["mase_scale"] if model["mase_scale"] is not None else np.nan
                )
                for key, value in item.identity().items():
                    h_rows[key] = value
                h_rows["origin"] = origin.isoformat()
                horizon_predictions[horizon_hours].append(h_rows)
                horizon_folds[horizon_hours]["evaluated"] += 1
    rows = pd.concat(predictions, ignore_index=True) if predictions else pd.DataFrame()
    aggregate = metrics(rows)
    horizon_report = {}
    for horizon_hours in HORIZON_HOURS:
        h_rows_all = (
            pd.concat(horizon_predictions[horizon_hours], ignore_index=True)
            if horizon_predictions[horizon_hours]
            else pd.DataFrame()
        )
        horizon_report[f"{horizon_hours}h"] = {
            "window": "24 h am Horizontbeginn (origin + "
            f"{horizon_hours} h bis origin + {horizon_hours + 24} h)",
            "days_evaluated": horizon_folds[horizon_hours]["evaluated"],
            "days_no_common_observations": horizon_folds[horizon_hours][
                "no_common_observations"
            ],
            "days_beyond_test_end": horizon_folds[horizon_hours]["beyond_test_end"],
            "metrics": metrics(h_rows_all),
        }
    # Evidence needs >=21 days for EACH requested station, enough actual polls,
    # and a benchmark over essentially the same observed opening times.
    enough = days >= 21 and all(
        fold["status"] == "scored"
        and fold["points"] >= 24
        and fold["response_coverage_pct"] >= 85
        and fold.get("comparison_coverage_pct", 0) >= 85
        for fold in folds
    )
    criteria = {
        "at_least_21_complete_test_days_per_station": enough,
        "all_test_prices_have_live_status": bool(len(rows))
        and bool(rows.status_known.all() and rows.source.eq("influxdb").all()),
        "mase_24h_below_0_95": aggregate["mase"] < 0.95
        if aggregate["mase"] is not None
        and aggregate["mase_points"] == aggregate["points"]
        else None,
        "mase_jump_free_below_0_80": None,  # not approximated with an ad-hoc jump label
        "pinball50_better_than_naive": aggregate["pinball50_ct"]
        < aggregate["naive_pinball50_ct"]
        if len(rows)
        else None,
        "pinball_asym_better_than_naive": aggregate["pinball_asym_ct"]
        < aggregate["naive_pinball_asym_ct"]
        if len(rows)
        else None,
        "picp95_between_90_and_98": 90 <= aggregate["picp95_pct"] <= 98
        if len(rows)
        else None,
    }
    per_station = []
    for item in series:
        subset = (
            rows.loc[
                (rows.city == item.city)
                & (rows.station_id == item.station_id)
                & (rows.fuel == item.fuel)
            ]
            if len(rows)
            else rows
        )
        per_station.append({**item.identity(), **metrics(subset)})
    # Rolling-PICP je Station (Konzept §3.3.3): 7-Tage-Fenster über die
    # bewerteten Punkte; Basis des Güte-Gates (§4.4) und des Konfidenz-Badges.
    test_days = [
        local_origin.tz_convert(cfg.timezone).normalize() for local_origin in origins
    ]
    rolling = rolling_picp_7d(rows, series, cfg.timezone, test_days)
    report = {
        "schema_version": 1,
        "status": "preliminary",
        "m3_complete": False,
        "decision_ready": False,
        "calibrated": False,
        "interval_method": "residual_day_bootstrap_uncalibrated",
        "test_start": origins[0].isoformat(),
        "test_end_exclusive": end.isoformat(),
        "config": cfg.to_dict(),
        "law_rise_outside_noon": int(
            sum(
                fold.get("law_rise_outside_noon", 0)
                for fold in folds
                if fold["status"] == "scored"
            )
        ),
        "requested_test_days": days,
        "test_sources": sorted(rows.source.unique().tolist()) if len(rows) else [],
        # 7-Tage-Rolling-PICP je Station (Konzept §3.3.3): Konfidenz-Badge
        # grün/gelb/rot; „current“ ist der zuletzt verlaufene Testtag und
        # die Größe, die das Güte-Gate (§4.4) in der Entscheidung prüft.
        "rolling_picp_7d": rolling,
        # Mehrtage-Backtests (Konzept §3.4): Güte der +3-d/+7-d-Prognose.
        # Kein M3-Abnahmekriterium (diese gelten für 24 h) — ehrlich
        # ausgewiesen, damit die Fan-Chart-Horizonte messbar sind.
        "horizons": horizon_report,
        "decision": {
            "decision_hour": cfg.decision_hour,
            "theta_ct": DECISION_THETA_CT,
            "days_evaluated": len(decision_rows),
            "days_skipped": decision_skipped,
            "rows": decision_rows,
        },
        "metrics": aggregate,
        "pinball_asym_tau": PINBALL_TAU_ASYM,
        "pinball_asym_note": (
            "τ=0,75: Unterschätzung des Preises (actual > q50, "
            "Warten in eine Erhöhung) wird 3× so stark bestraft wie "
            "Überschätzung. Gate: asym-Pinball < asym-Pinball der Naiven."
        ),
        "criteria": criteria,
        "pending": PENDING,
        "stations": per_station,
        "folds": folds,
    }
    return report, rows


def markdown_report(report: dict) -> str:
    def number(value, decimals=3):
        return "nicht bestimmbar" if value is None else f"{value:.{decimals}f}"

    def cell(value):
        return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")

    m = report["metrics"]
    lines = [
        "# TankApp – M3-Backtest (vorläufig)",
        "",
        "**M3 ist nicht abgenommen. Keine kalibrierten Empfehlungen oder Erfolgsprozente.**",
        "",
        f"Zeitraum: {report['test_start']} bis {report['test_end_exclusive']} (exklusiv).",
        "Täglicher Cutoff: lokale Mitternacht; jeder Fit sieht ausschließlich frühere Preise.",
        "Bewertet wird der folgende lokale Tag (00–24 h, innerhalb des konfigurierten Poll-Fensters).",
        "Nur Eingangszeilen mit gültigem Preis, auf gemeinsamer Datenbasis mit der saisonalen Naiven.",
        "Bei Live-Daten muss status=open sein; bei Alt-Historie ohne Status bleibt die Öffnung unbekannt.",
        "",
        "| Kennzahl | Messwert |",
        "|---|---:|",
        f"| Vergleichspunkte | {m['points']} |",
        f"| MAE [ct/L] | {number(m['mae_ct'])} |",
        f"| RMSE [ct/L] | {number(m['rmse_ct'])} |",
        f"| MASE (Skala nur aus Training) | {number(m['mase'])} |",
        f"| MASE auswertbare Punkte | {m['mase_points']} |",
        f"| sMAPE [%] | {number(m['smape_pct'])} |",
        f"| Pinball τ=0,5 [ct/L] | {number(m['pinball50_ct'])} |",
        f"| Naive Pinball τ=0,5 [ct/L] | {number(m['naive_pinball50_ct'])} |",
        f"| Pinball τ=0,75 asym [ct/L] | {number(m.get('pinball_asym_ct'))} |",
        f"| Naive Pinball τ=0,75 asym [ct/L] | {number(m.get('naive_pinball_asym_ct'))} |",
        f"| PICP 95 % [%] | {number(m['picp95_pct'])} |",
        f"| MPIW 95 % [ct/L] | {number(m['mpiw95_ct'])} |",
        "",
        "## Kriterien (kein automatischer M3-Abschluss)",
        "",
    ]
    for key, value in report["criteria"].items():
        state = (
            "offen / nicht bestimmbar"
            if value is None
            else "erfüllt"
            if value
            else "nicht erfüllt"
        )
        lines.append(f"- `{key}`: **{state}**")
    lines += [
        "",
        "## Je Station",
        "",
        "| Stadt | Station | Punkte | MAE ct/L | MASE | PICP 95 % |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for station in report["stations"]:
        lines.append(
            f"| {cell(station['city'])} | {cell(station['station_name'])} | {station['points']} | "
            f"{number(station['mae_ct'])} | {number(station['mase'])} | {number(station['picp95_pct'])} |"
        )
    horizons = report.get("horizons") or {}
    if horizons:
        lines += ["", "## Mehrtage-Horizonte (Konzept §3.4)", ""]
        lines.append(
            "24-h-Fenster am Horizontbeginn, bewertet gegen beobachtete offene "
            "Preise — kein M3-Abnahmekriterium (diese gelten für 24 h)."
        )
        lines += [
            "",
            "| Horizont | Tage bewertet | MAE ct/L | MASE | PICP 95 % |",
            "|---|---:|---:|---:|---:|",
        ]
        for label, horizon in horizons.items():
            hm = horizon["metrics"]
            lines.append(
                f"| {label} | {horizon['days_evaluated']} "
                f"({horizon['days_no_common_observations']} ohne gemeinsame Beobachtung, "
                f"{horizon.get('days_beyond_test_end', 0)} außerhalb des Testzeitraums) "
                f"| {number(hm['mae_ct'])} | {number(hm['mase'])} | {number(hm['picp95_pct'])} |"
            )
    rolling = report.get("rolling_picp_7d") or []
    if rolling:
        lines += [
            "",
            "## Rolling-PICP 7 Tage je Station (Konzept §3.3.3)",
            "",
            "Badge: grün ≥ 93 %, gelb ≥ 90 %, rot < 90 % (nominal 95 %); "
            "weniger als 72 Punkte im Fenster = keine Aussage. Rot löst den "
            "§4.4-Modus („Keine klare Empfehlung“) aus.",
            "",
            "| Stadt | Station | Letzter Testtag | PICP 7 d [%] | Punkte | Badge |",
            "|---|---|---|---:|---:|---|",
        ]
        for entry in rolling:
            current = entry.get("current") or {}
            badge = current.get("badge")
            lines.append(
                f"| {cell(entry['city'])} | {cell(entry['station_name'])} "
                f"| {current.get('day', '—')} "
                f"| {number(current.get('picp_pct'))} "
                f"| {current.get('points', 0)} "
                f"| {'—' if badge is None else badge} |"
            )
    lines += [
        "",
        "## Datenlücken und Grenzen",
        "",
        "Intervalle: Residuen-Tagesblock-Bootstrap aus dem Training (exponentiell gewichtet, "
        "neuere Tage höheres Ziehgewicht), **unkalibriert**, nicht ACI.",
        "Asymmetrie: Pinball τ=0,75 bestraft Unterschätzung des Preises (Warten in eine "
        "Erhöhung) 3× stärker als Überschätzung; Gate `pinball_asym_better_than_naive` "
        "ergänzt MASE/PICP95, ersetzt sie nicht.",
        f"12-Uhr-Regel: {report['law_rise_outside_noon']} beobachtete Erhöhung(en) ≥ 1 ct "
        "außerhalb des erlaubten 12-Uhr-Zeitpunkts im Training der bewerteten Folds "
        "(seit 2026-04-01) — mögliche Datenartefakte, im Fit verbleibend; Median und "
        "Bänder werden auf nicht-steigende [12:00, nächste 12:00)-Segmente projiziert.",
        "Fehlende Nacht-/Öffnungszeiten werden nicht erfunden. Geschlossene und veraltete Preise",
        "gehen nicht in den Fit ein; von der Engine ergänzte Forward-Fill-Zeilen nicht in die Testwahrheit.",
        "MASE bei konstanter saisonaler Trainingsreihe ist undefiniert, nicht 0.",
        "Alt-Historie kann bereits rekonstruierte Stand-Zeilen enthalten, nicht einzelne Polls.",
        "Das ersetzt keinen Live-Nachweis: siehe Datenquellen, QA und Statusanteile je Fold.",
        "Lücken, gemeinsame Vergleichsabdeckung und übersprungene Tage stehen vollständig in `report.json`.",
        "",
    ]
    skipped = [fold for fold in report["folds"] if fold["status"] != "scored"]
    lines.append(
        f"Nicht auswertbare Stationstage: **{len(skipped)} / {len(report['folds'])}**."
    )
    decision = report.get("decision", {})
    anchor = decision.get("decision_hour", DECISION_HOUR)
    lines.append(
        f"Entscheidungszeilen zum {anchor:02d}:00-Anker (Schicht A): "
        f"**{decision.get('days_evaluated', 0)}** "
        f"auswertbar, {decision.get('days_skipped', 0)} übersprungen "
        f"(kein Anker/keine Erwartung/keine Realisierung nach {anchor:02d}:00)."
    )
    for fold in skipped[:20]:
        lines.append(
            f"- {cell(fold['station_id'])} / {fold['origin']}: {cell(fold.get('reason', fold['status']))}"
        )
    if len(skipped) > 20:
        lines.append("- Weitere Gründe in `report.json`.")
    lines += ["", "## Noch offen in M3", ""] + [
        f"- {item}" for item in report["pending"]
    ]
    return "\n".join(lines) + "\n"
