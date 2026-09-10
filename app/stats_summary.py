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
    """Struktur des leeren Backtest-Felds — UI kann Felder abfragen ohne Fehler."""
    return {
        "daysTrain": 42,
        "daysEval": 14,
        "decisionHour": 8,
        "defaultEps": 1.0,
        "defaultLiters": 40.0,
        "days": [],
        "stations": [],
        "stationScores": [],
        "totals": {
            "smart": 0.0,
            "commit": 0.0,
            "best": 0.0,
            "always": 0.0,
            "regretEur": 0.0,
            "n": 0,
            "hitFreq": 0.0,
            "pAvg": 0.0,
            "potShare": 0.0,
        },
        "calibration": [],
        "evalRows": {},
        "models": {},
        "p8Series": {},
        "scan": {"eps": [], "commitEur": [], "smartEur": [], "waits": []},
        "error_code": "backtest_not_available",
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
    calib_points: list[dict[str, Any]] = []
    eval_rows: dict[str, list[dict[str, Any]]] = {}
    p8_series: dict[str, list[float]] = {}
    models: dict[str, dict[str, Any]] = {}

    backtest_days = rows[0].get("backtest_days", 7) or 7

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

        # Reale Engine-Metriken (MAE, MASE, PICP). UI kann sie 1:1 anzeigen.
        mae_ct = metrics.get("mae_ct")
        mase = metrics.get("mase")
        picp = metrics.get("picp95_pct")

        station_scores.append(
            {
                "station_id": sid,
                "name": name,
                "brand": brand,
                "city": city,
                "mae_ct": mae_ct,
                "mase": mase,
                "picp_95": picp,
                "n": backtest_days,
                "n_wait": 0,
                "hit_wait": None,
                "n_now": 0,
                "hit_now": None,
                "sum_smart_eur": 0.0,
                "sum_commit_eur": 0.0,
                "sum_best_eur": 0.0,
                "sum_always_eur": 0.0,
                "avg_regret_ct": 0.0,
                "avg_regret_eur": 0.0,
                "p_avg": 0.0,
                "hit_freq": 0.0,
                "pot_share": 0.0,
            }
        )

    totals: dict[str, Any] = {
        "smart": 0.0,
        "commit": 0.0,
        "best": 0.0,
        "always": 0.0,
        "regretEur": 0.0,
        "n": sum(s["n"] for s in station_scores),
        "hitFreq": 0.0,
        "pAvg": 0.0,
        "potShare": 0.0,
        "mae_ct": _safe_median([s["mae_ct"] for s in station_scores]),
        "mase": _safe_median([s["mase"] for s in station_scores]),
        "picp_95": _safe_median([s["picp_95"] for s in station_scores]),
    }

    return {
        "daysTrain": 42,
        "daysEval": backtest_days,
        "decisionHour": 8,
        "defaultEps": 1.0,
        "defaultLiters": 40.0,
        "days": [],
        "stations": stations_info,
        "stationScores": station_scores,
        "totals": totals,
        "calibration": calib_points,
        "evalRows": eval_rows,
        "models": models,
        "p8Series": p8_series,
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
    mase = _safe_median([r["metrics"].get("mase") for r in rows])
    picp = _safe_median([r["metrics"].get("picp95_pct") for r in rows])
    return {
        "top3_hit_rate": None,  # wird aus echtem Backtest/Settlement berechnet
        "mase_sprungfrei": mase,
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
