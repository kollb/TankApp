"""Rolling origins, strictly past-only fits, real open observations as truth."""

import numpy as np
import pandas as pd

from .config import Config
from .data import PriceSeries, scheduled
from .models import fit, predict, utc_time

PENDING = [
    "M3-Zweitmodell (ETS/Local-Level) und inverse-MASE-Ensemble",
    "gepoolte Feiertagseffekte im Strukturmodell (12-Uhr-Sprung ist bereits Struktur)",
    "CUSUM-Sprungtage und gesonderte MASE-Abnahme sprungfreier Tage",
    "Out-of-sample-Kalibrierung / ACI nach ausreichender Live-Historie",
    "Echt-Daten-Abnahme aller M3-Kriterien auf NAS/PC",
]


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
        "picp95_pct": 100
        * float(((rows.actual >= rows.q025) & (rows.actual <= rows.q975)).mean()),
        "mpiw95_ct": 100 * float((rows.q975 - rows.q025).mean()),
    }


def last_complete_day(series: list[PriceSeries], cfg: Config) -> pd.Timestamp:
    # Use a shared cutoff, not a different period for every station. Stations
    # whose data ended earlier get explicit missing folds, not flattering tests.
    last = max(item.frame.index.max() for item in series) + pd.Timedelta(
        minutes=cfg.step_minutes
    )
    return last.tz_convert(cfg.timezone).normalize()


def run_backtest(
    series: list[PriceSeries], cfg: Config, days: int = 21, until=None
) -> tuple[dict, pd.DataFrame]:
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
    folds, predictions = [], []
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
    rows = pd.concat(predictions, ignore_index=True) if predictions else pd.DataFrame()
    aggregate = metrics(rows)
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
        "metrics": aggregate,
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
    lines += [
        "",
        "## Datenlücken und Grenzen",
        "",
        "Intervalle: Residuen-Tagesblock-Bootstrap aus dem Training, **unkalibriert**, nicht ACI.",
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
