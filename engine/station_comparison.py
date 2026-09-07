"""Read-only comparison of UUID-separated station histories; never apply exclusions."""

import json
import math
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd

from .config import Config
from .data import PriceSeries, load_observations, prepare_series, scheduled

CRITERIA = {
    "min_days": 28,
    "min_common_points_per_day": 12,
    "price_tolerance_ct": 0.1,
    "min_agreement_pct": 99.0,
    "min_overlap_pct": 90.0,
}


def number(value):
    try:
        result = float(value)
    except (ValueError, TypeError):
        return None
    return result if math.isfinite(result) else None


def polling_stations(path: Path, brand: str | None, city: str | None) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    result = {}
    for key, stset in (payload.get("sets") or {}).items():
        label = stset.get("label") or key
        if city and city not in (key, label):
            continue
        batch = set(stset.get("batch") or [])
        for station in stset.get("stations", []):
            uid = station.get("uuid")
            if not uid or (batch and uid not in batch):
                continue
            if (
                brand
                and str(station.get("brand") or "").strip().casefold()
                != brand.strip().casefold()
            ):
                continue
            result[(label, uid)] = {
                "city": label,
                "station_id": uid,
                "station_name": station.get("name") or uid,
                "brand": station.get("brand") or "",
                "dist_km": number(station.get("dist_km")),
                "net_per_fill_eur": number(station.get("net_per_fill_eur")),
            }
    if not any(sum(k[0] == label for k in result) >= 2 for label, _ in result):
        raise ValueError(
            "Mindestens zwei passende Stationen derselben Kampagne nötig; Marke/Set prüfen."
        )
    return result


def compare_pair(a: PriceSeries, b: PriceSeries, cfg: Config, criteria=None) -> dict:
    rules = CRITERIA if criteria is None else criteria
    if a.city != b.city or a.fuel != b.fuel:
        raise ValueError("Nur Stationen derselben Kampagne und Sorte vergleichen.")
    # Only input observations on the availability grid, never engine-added fill.
    fa = a.frame.loc[scheduled(a.frame.index, cfg)]
    fb = b.frame.loc[scheduled(b.frame.index, cfg)]
    pa = fa.loc[fa.observed & fa.price.notna(), "price"]
    pb = fb.loc[fb.observed & fb.price.notna(), "price"]
    common = pd.concat([pa.rename("a"), pb.rename("b")], axis=1).dropna()
    per_day = common.groupby(common.index.tz_convert(cfg.timezone).normalize()).size()
    days = int((per_day >= rules["min_common_points_per_day"]).sum())
    overlap = (
        100 * len(common) / max(len(pa), len(pb)) if max(len(pa), len(pb)) else 0.0
    )
    delta_ct = (common.a - common.b).abs().to_numpy() * 100
    agreement = (
        float(100 * np.mean(delta_ct <= rules["price_tolerance_ct"] + 1e-9))
        if len(common)
        else None
    )
    known_a = fa.loc[fa.response_observed & fa.status_known, "status"]
    known_b = fb.loc[fb.response_observed & fb.status_known, "status"]
    statuses = pd.concat([known_a.rename("a"), known_b.rename("b")], axis=1).dropna()
    conflicts = int(statuses.a.ne(statuses.b).sum())
    enough = days >= rules["min_days"] and overlap >= rules["min_overlap_pct"]
    if not enough:
        verdict = "insufficient_data"
    elif agreement < rules["min_agreement_pct"]:
        verdict = "different_prices"
    elif conflicts:
        verdict = "availability_differs"
    else:
        verdict = "possible_price_twins"
    return {
        "city": a.city,
        "fuel": a.fuel,
        "station_a": a.station_id,
        "station_b": b.station_id,
        "classification": verdict,
        "observed_a": len(pa),
        "observed_b": len(pb),
        "common_points": len(common),
        "qualifying_days": days,
        "overlap_pct": overlap,
        "agreement_pct": agreement,
        "mean_abs_delta_ct": float(delta_ct.mean()) if len(common) else None,
        "p95_abs_delta_ct": float(np.quantile(delta_ct, 0.95)) if len(common) else None,
        "max_abs_delta_ct": float(delta_ct.max()) if len(common) else None,
        "known_status_comparisons": len(statuses),
        "status_conflicts": conflicts,
        "opening_hours_verified": False,
        "auto_apply": False,
    }


def compare_stations(paths, polling, fuel="E10", brand=None, city=None):
    cfg = Config()
    meta = polling_stations(polling, brand, city)
    observations, quality = load_observations(
        paths, cfg, fuel, {key[1] for key in meta}
    )
    by_id = {
        (item.city, item.station_id): item for item in prepare_series(observations, cfg)
    }
    missing = set(meta) - set(by_id)
    if missing:
        raise ValueError(
            "Historie fehlt für ausgewählte Kampagne/UUID: "
            + ", ".join(f"{c}/{s}" for c, s in sorted(missing))
        )
    pairs = []
    for label in sorted({key[0] for key in meta}):
        keys = sorted(key for key in meta if key[0] == label)
        for ka, kb in combinations(keys, 2):
            pair = compare_pair(by_id[ka], by_id[kb], cfg)
            nearer = None
            da, db = meta[ka]["dist_km"], meta[kb]["dist_km"]
            if (
                pair["classification"] == "possible_price_twins"
                and da is not None
                and db is not None
                and da != db
            ):
                nearer = ka[1] if da < db else kb[1]
            pairs.append({**pair, "nearer_candidate": nearer})
    return {
        "schema_version": 1,
        "mode": "read_only_comparison",
        "auto_apply": False,
        "fuel": fuel,
        "criteria": CRITERIA,
        "poll_window": "06–24 Europe/Berlin",
        "quality": quality,
        "stations": list(meta.values()),
        "pairs": pairs,
        "warnings": [
            "Keine automatische Änderung des Polling-Sets oder der InfluxDB.",
            "Nur originale UUID-getrennte Historien verwenden, keine vermischten Namensserien.",
            "Rekonstruierte M2-Raster können kurze Unterschiede verdecken; keine Garantie für zukünftige Preisgleichheit.",
            "Öffnungszeiten und praktische Erreichbarkeit manuell prüfen; Nähe ist nur ein Vorschlag aus dem vorhandenen Polling-Set.",
            "Alte unter gleichem Namen gespeicherte Influx-Daten werden durch Ausschluss einer UUID nicht nachträglich eindeutig.",
        ],
    }


def markdown_report(report):
    def cell(value):
        return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")

    def fmt(value, digits=2):
        return "–" if value is None else f"{value:.{digits}f}"

    labels = {
        "insufficient_data": "Zu wenig gemeinsame Daten",
        "different_prices": "Unterschiedliche Preisverläufe",
        "availability_differs": "Status/Verfügbarkeit unterscheiden sich",
        "possible_price_twins": "Mögliche Preis-Zwillinge – manuell prüfen",
    }
    c = report["criteria"]
    lines = [
        "# Preis-Zwillinge prüfen (nur lesend)",
        "",
        f"Sorte: **{report['fuel']}**, Vergleich im Fenster {report['poll_window']}.",
        f"Schwellen: ≥{c['min_days']} Tage mit je ≥{c['min_common_points_per_day']} gemeinsamen Eingangszeilen; "
        f"≥{c['min_overlap_pct']:g} % Beobachtungsüberlappung; ≥{c['min_agreement_pct']:g} % Preise innerhalb "
        f"{c['price_tolerance_ct']:g} ct/L. Bekannte unterschiedliche Status verhindern eine Zwillingsempfehlung.",
        "",
        "**Kein Polling-Set wurde verändert. Ein gleicher Name ist kein Preisnachweis.**",
        "",
        "| UUID | Name | Kampagne | Entfernung aus Polling-Set [km] | Netto €/Füllung aus Polling-Set |",
        "|---|---|---|---:|---:|",
    ]
    for s in report["stations"]:
        lines.append(
            f"| {cell(s['station_id'])} | {cell(s['station_name'])} | {cell(s['city'])} | {fmt(s['dist_km'])} | {fmt(s['net_per_fill_eur'])} |"
        )
    for pair in report["pairs"]:
        lines += [
            "",
            f"## {cell(pair['station_a'])} ↔ {cell(pair['station_b'])}",
            "",
            f"**{labels[pair['classification']]}**",
            "",
            f"- Qualifizierende Tage: {pair['qualifying_days']}; gemeinsame Punkte: {pair['common_points']}.",
            f"- Überlappung: {fmt(pair['overlap_pct'])} %; Preise innerhalb Toleranz: {fmt(pair['agreement_pct'])} %.",
            f"- Absolute Preisdifferenz: Mittel {fmt(pair['mean_abs_delta_ct'], 3)}, P95 {fmt(pair['p95_abs_delta_ct'], 3)}, Maximum {fmt(pair['max_abs_delta_ct'], 3)} ct/L.",
            f"- Bekannte Statusvergleiche: {pair['known_status_comparisons']}; Unterschiede: {pair['status_conflicts']}.",
        ]
        if pair["nearer_candidate"]:
            lines.append(
                f"- Näherer Kandidat laut vorhandenem Polling-Set: **{cell(pair['nearer_candidate'])}**. Öffnungszeiten/Wege vor einem Ausschluss prüfen."
            )
    lines += ["", "## Grenzen / nächster Schritt", ""] + [
        "- " + value for value in report["warnings"]
    ]
    return "\n".join(lines) + "\n"
