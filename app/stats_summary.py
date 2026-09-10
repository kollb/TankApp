"""Stats Summary API — GET /api/v1/stats/summary (Konzept §5.5, §8.2).

Liefert die drei getrennten Schichten der TankApp-Statistik:
  - Schicht A: Markt-Labor (echter Backtest aus engine/, kein Demo)
  - Schicht B: Live-Advice (gesettelte Snapshots, Brier, M7-Gate)
  - Schicht C: Wallet (echte Tankbelege, Ersparnis, w(h)-Profil)
  - Güte-Kacheln (echte Werte aus engine/current.json, sonst null)

Wichtig: Diese API erfindet NICHTS. Fehlende Daten werden als
``error_code`` oder leerem Wert zurückgegeben, nicht durch Demo-Zahlen
ersetzt. Das schützt das Kalibrierungs-Gate (§0.4) und die
Produkt-Ehrlichkeits-Regel (Konzept §14).
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from .data import metadata
from .feedback import (
    compute_advice_stats,
    compute_wallet_stats,
    load_store,
)

UTC = dt.timezone.utc


# Provider-Hook für die Engine-Veröffentlichung. Wird in
# evaluate_stats_summary() je Request auf die echte settings-gebundene
# Funktion gesetzt. Das verhindert einen circular import (data ↔ stats_summary)
# und macht die Funktion für Tests überschreibbar.
def _publication_provider() -> dict:
    return {}


def set_publication_provider(fn) -> None:
    """Tests / app/data.py können hier den echten publication(settings)-Wrapper einsetzen."""
    global _publication_provider
    _publication_provider = fn


def _empty_backtest() -> dict[str, Any]:
    """Struktur des leeren Backtest-Felds — UI kann Felder abfragen ohne Fehler.

    Zähler sind null (nicht 0,0): 0,00 € sähe nach gemessener Null aus,
    tatsächlich wurde nichts gemessen.
    """
    return {
        "daysTrain": None,
        "daysEval": None,
        "decisionHour": 8,
        "defaultEps": 1.0,
        "defaultLiters": 40.0,
        "days": [],
        "stations": [],
        "stationScores": [],
        "totals": {
            "smart": None,
            "commit": None,
            "best": None,
            "always": None,
            "regretEur": None,
            "n": 0,
            "hitFreq": None,
            "pAvg": None,
            "potShare": None,
        },
        "calibration": [],
        "evalRows": {},
        "models": {},
        "p8Series": {},
        "scan": {"eps": [], "commitEur": [], "smartEur": [], "waits": []},
        "error_code": "backtest_not_available",
    }


def _score_rows(
    rows: list[dict[str, Any]], eps: float, liters: float
) -> dict[str, Any]:
    """Server-Spiegel von web/src/data.ts scoreRows (gleiche Formeln).

    wait = mu ≥ eps; hit = (s > 0) bei wait, (s ≤ 0) bei now;
    smart = Ersparnis nur bei korrektem wait; commit = gebuchte Ersparnis;
    regret = best − smart. p ist null, solange die Engine kein P-Modell hat.
    """
    n_wait = hit_wait = n_now = hit_now = 0
    sum_smart = sum_commit = sum_best = sum_always = sum_regret = 0.0
    sum_p = 0.0
    n_p = 0
    s_pos = 0
    for r in rows:
        mu = float(r.get("mu") or 0.0)
        s = float(r.get("s") or 0.0)
        best = float(r.get("best") or 0.0)
        wait = mu >= eps
        hit = (s > 0) if wait else (s <= 0)
        if wait:
            n_wait += 1
            hit_wait += 1 if hit else 0
            smart_ct = max(s, 0.0)
            commit_ct = s
        else:
            n_now += 1
            hit_now += 1 if hit else 0
            smart_ct = 0.0
            commit_ct = 0.0
        sum_smart += smart_ct
        sum_commit += commit_ct
        sum_best += max(best, 0.0)
        sum_always += max(s, 0.0)
        sum_regret += max(best - smart_ct, 0.0)
        p = r.get("p")
        if p is not None:
            try:
                sum_p += float(p)
                n_p += 1
            except (TypeError, ValueError):
                pass
        if s > 0:
            s_pos += 1
    n = len(rows)

    def to_eur(ct: float) -> float:
        return round((ct / 100.0) * liters, 2)

    return {
        "n": n,
        "n_wait": n_wait,
        "hit_wait": round(hit_wait / n_wait, 4) if n_wait else None,
        "n_now": n_now,
        "hit_now": round(hit_now / n_now, 4) if n_now else None,
        "sum_smart_eur": to_eur(sum_smart),
        "sum_commit_eur": to_eur(sum_commit),
        "sum_best_eur": to_eur(sum_best),
        "sum_always_eur": to_eur(sum_always),
        "avg_regret_ct": round(sum_regret / n, 3) if n else 0.0,
        "avg_regret_eur": round(to_eur(sum_regret) / n, 3) if n else 0.0,
        "p_avg": round(sum_p / n_p, 4) if n_p else None,
        "hit_freq": round(s_pos / n, 4) if n else 0.0,
        "pot_share": round(sum_smart / sum_best, 4)
        if sum_best > 0
        else (0.0 if n else None),
    }


def _build_backtest_from_publication(
    metas: dict, target_city: str | None
) -> dict[str, Any]:
    """Baut das Backtest-Feld aus der Engine-Veröffentlichung (runtime/engine/current.json).

    Die Engine schreibt dort je Station ``metrics`` (mae_ct, mase, picp95_pct)
    und ``backtest_days``. Wenn keine Veröffentlichung existiert oder die
    Engine-Fits fehlen, wird das leere Backtest-Feld zurückgegeben — keine
    Demo-Daten, keine erfundenen Bewertungen.
    """
    # publication(settings) braucht das Settings-Objekt, nicht metas.
    # Das settings wird per closure vom Aufrufer (evaluate_stats_summary) gereicht.
    pub = _publication_provider()
    if not pub or not pub.get("forecasts"):
        return _empty_backtest()

    rows = [r for r in pub.get("forecasts", []) if r.get("metrics")]
    if not rows:
        return _empty_backtest()

    # Stationen, die tatsächlich einen Backtest haben
    stations_info: list[dict[str, Any]] = []
    station_scores: list[dict[str, Any]] = []
    eval_rows: dict[str, list[dict[str, Any]]] = {}

    backtest_days = rows[0].get("backtest_days", 7) or 7
    train_days = rows[0].get("train_days") or 42
    decision_hour = rows[0].get("decision_hour", 8) or 8
    default_eps = 1.0
    default_liters = 40.0
    all_eval: list[dict[str, Any]] = []

    for row in rows:
        if target_city and row.get("city") != target_city:
            continue
        sid = row.get("station_id", "")
        city = row.get("city", "")
        meta = metas.get((city, sid), {})
        name = meta.get("name") or sid
        brand = meta.get("brand") or ""
        metrics = row.get("metrics") or {}

        stations_info.append(
            {
                "id": sid,
                "city": city,
                "name": name,
                "brand": brand,
                "lat": meta.get("lat"),
                "lon": meta.get("lon"),
                "dist_km": meta.get("dist_km"),
            }
        )

        # Echte 08:00-Entscheidungszeilen der Engine (Schicht A).
        station_rows = [
            {
                "day": r.get("day"),
                "cls": r.get("cls", 0),
                "mu": r.get("mu"),
                "p": r.get("p"),
                "s": r.get("s"),
                "best": r.get("best"),
                "predHour": r.get("predHour"),
                "curve": r.get("curve") or [],
            }
            for r in (row.get("decision_rows") or [])
            if r.get("mu") is not None and r.get("s") is not None
        ]
        eval_rows[sid] = station_rows
        all_eval.extend(station_rows)

        # Reale Engine-Metriken (MAE, MASE, PICP) + Entscheidungs-Scores.
        score = _score_rows(station_rows, default_eps, default_liters)
        station_scores.append(
            {
                "station_id": sid,
                "name": name,
                "brand": brand,
                "city": city,
                "mae_ct": metrics.get("mae_ct"),
                "mase": metrics.get("mase"),
                "picp_95": metrics.get("picp95_pct"),
                **score,
            }
        )

    total_score = _score_rows(all_eval, default_eps, default_liters)
    n_total = total_score["n"]
    totals: dict[str, Any] = {
        "smart": total_score["sum_smart_eur"] if n_total else None,
        "commit": total_score["sum_commit_eur"] if n_total else None,
        "best": total_score["sum_best_eur"] if n_total else None,
        "always": total_score["sum_always_eur"] if n_total else None,
        "regretEur": total_score["avg_regret_eur"] if n_total else None,
        "n": n_total,
        "hitFreq": total_score["hit_freq"] if n_total else None,
        "pAvg": total_score["p_avg"],
        "potShare": total_score["pot_share"],
        "mae_ct": _safe_median([s["mae_ct"] for s in station_scores]),
        "mase": _safe_median([s["mase"] for s in station_scores]),
        "picp_95": _safe_median([s["picp_95"] for s in station_scores]),
    }

    return {
        "daysTrain": train_days,
        "daysEval": backtest_days,
        "decisionHour": decision_hour,
        "defaultEps": default_eps,
        "defaultLiters": default_liters,
        "days": sorted({r["day"] for r in all_eval if r.get("day")}),
        "stations": stations_info,
        "stationScores": station_scores,
        "totals": totals,
        # calibration/models/p8Series/scan: kein P-/Form-Modell in der Engine —
        # ehrlich leer, bis die Engine sie liefert (Konzept §6, offen).
        "calibration": [],
        "evalRows": eval_rows,
        "models": {},
        "p8Series": {},
        "scan": {"eps": [], "commitEur": [], "smartEur": [], "waits": []},
        "source": "engine",
        "published_at": pub.get("published_at"),
    }


def _safe_median(values: list) -> float | None:
    """Median über nicht-None-Werte; None wenn alle None/empty."""
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    s = sorted(clean)
    n = len(s)
    if n % 2 == 1:
        return s[n // 2]
    return round((s[n // 2 - 1] + s[n // 2]) / 2, 4)


def _quality_metrics_from_publication() -> dict[str, Any]:
    """Liest reale Engine-Qualitäts-Metriken aus dem publizierten Bundle.

    Liefert ``None`` für alle Felder, wenn keine Engine-Veröffentlichung
    existiert. Das ist explizit — die GUI darf keine Demo-Zahlen
    anzeigen, sondern soll "noch keine Daten" rendern.
    """
    pub = _publication_provider()
    if not pub or not pub.get("forecasts"):
        return {
            "top3_hit_rate": None,
            "mase_sprungfrei": None,
            "picp_95": None,
            "cusum_drift": {
                "status": "unknown",
                "max_cusum": None,
                "threshold": 3.0,
            },
        }
    rows = [r for r in pub.get("forecasts", []) if r.get("metrics")]
    if not rows:
        return {
            "top3_hit_rate": None,
            "mase_sprungfrei": None,
            "picp_95": None,
            "cusum_drift": {
                "status": "unknown",
                "max_cusum": None,
                "threshold": 3.0,
            },
        }
    picp = _safe_median([r["metrics"].get("picp95_pct") for r in rows])
    return {
        # top3_hit_rate: erst aus echtem Backtest/Settlement (Konzept §6, offen).
        "top3_hit_rate": None,
        # mase_sprungfrei: die Engine berechnet bewusst keine sprungfreie MASE
        # (engine/backtest.py: kein Ad-hoc-Sprunglabel) — die Gesamt-MASE hier
        # zu zeigen wäre Etikettenschwindel.
        "mase_sprungfrei": None,
        "picp_95": picp,
        "cusum_drift": {
            "status": "unknown",
            "max_cusum": None,
            "threshold": 3.0,
        },
    }


def evaluate_stats_summary(live_data, params: dict[str, Any]) -> dict[str, Any]:
    """Drei-Schichten-Statistik ohne Demo-Daten.

    Felder, die noch nicht aus echten Daten abgeleitet werden können, sind
    ``None`` (statt fester Demo-Werte). Das ist die ehrliche Form: die
    Web-GUI zeigt "—" oder "noch keine Daten" und keine erfundenen
    Zahlen, solange die Engine nicht läuft.
    """
    fuel = (params.get("fuel") or "e10").lower()
    city = params.get("city")

    metas, problem = metadata(live_data.settings)

    # Schicht A: Backtest — aus engine/current.json, sonst leer
    if problem:
        backtest = _empty_backtest()
        backtest["error_code"] = problem
    else:
        backtest = _build_backtest_from_publication(metas, city)

    # Schicht B & C: Live-Advice & Wallet (immer echt, nie Demo)
    store = load_store(live_data.settings)
    live_advice = compute_advice_stats(store)
    wallet = compute_wallet_stats(store)

    # Güte-Kacheln: aus engine/current.json, sonst None
    quality_metrics = _quality_metrics_from_publication()

    return {
        "generated_at": live_data.clock().isoformat(),
        "fuel": fuel,
        "city": city,
        "backtest": backtest,
        "live_advice": live_advice,
        "wallet": wallet,
        "quality_metrics": quality_metrics,
        "calibrated": live_advice.get("calibrated", False),
        "decision_ready": False,
        "error_code": None,
    }
