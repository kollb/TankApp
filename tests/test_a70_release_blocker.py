"""A70 — M7-Release-Blocker, Ensemble-Sperre, Verfügbarkeit, Regime, Qualität.

Abnahme der Audit-Punkte 6.2 (A5), 6.3 (M1), 6.4 (M2), 6.5 (M3),
7.2 (M5), 8.1 (N1) und Prioritäten 1/5/6/7 im Backend:

* Modellvertragsmatrix: genau ein Status je Konfiguration, ensemble
  deaktiviert, nur profile_ar2+shared+day_pair produktiv.
* Freigabekette sperrt nicht-produktive Verträge (model_not_released)
  und gehäufte 12-Uhr-Verletzungen (regime_check_pending).
* M7-Archiv: Ergebnisse mit Kohorte, Referenzen, Reliability und
  Ausschlussgründen, anhangbar und lesbar.
* Verfügbarkeit: ready-Anteil, Sperrgründe, M7- vs. Technik-Trennung.
* Datenqualität: M3-Exposition (lückig/dünn-Anteil).
* Forecast-Versionierung: Fingerprints je Zeile, reproduzierbar.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from app import data_quality, decision_metrics, regime_monitor
from app.config import Settings
from app.data import LiveData
from app.decide import ACTION_BLOCKING_REASONS, evaluate_decide
from app.m7_release import (
    append_entry,
    build_entry,
    read_entries,
    release_blocked_reason,
)
from app.model_contracts import (
    STATUS_DISABLED,
    STATUS_EXPERIMENTAL,
    STATUS_PRODUCTIVE,
    contract_status,
    describe,
    is_forecast_released,
)
from app.refresh import calibration_fingerprint, input_fingerprint

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 10, 14, 0, tzinfo=dt.timezone.utc)
CITY_PARAMS = {"city": "Frankfurt", "fuel": "e10", "liters": 40, "station_id": UID}

POINTS = [
    {"timestamp": "2026-09-10T16:00:00+02:00", "q50": 1.60},
    {"timestamp": "2026-09-10T17:00:00+02:00", "q50": 1.61},
    {"timestamp": "2026-09-10T18:00:00+02:00", "q50": 1.62},
    {"timestamp": "2026-09-10T19:00:00+02:00", "q50": 1.63},
    {"timestamp": "2026-09-10T20:00:00+02:00", "q50": 1.64},
]
BLOCKS = [
    {"start": "2026-09-10T14:00:00+00:00", "end": "2026-09-10T16:00:00+00:00"},
    {"start": "2026-09-10T16:00:00+00:00", "end": "2026-09-10T18:00:00+00:00"},
    {"start": "2026-09-10T18:00:00+00:00", "end": "2026-09-10T20:00:00+00:00"},
]
MINIMA = [
    [1.61, 1.70, 1.71],
    [1.60, 1.71, 1.72],
    [1.70, 1.68, 1.72],
    [1.62, 1.71, 1.72],
]


@pytest.fixture
def settings(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "anchor": [50.11, 8.68],
                        "batch": [UID],
                        "stations": [
                            {
                                "uuid": UID,
                                "name": "Station Alpha",
                                "brand": "ARAL",
                                "lat": 50.12,
                                "lon": 8.69,
                            }
                        ],
                    }
                }
            }
        )
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n"
    )
    static = tmp_path / "web"
    static.mkdir()
    (static / "index.html").write_text("<html>test</html>")
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
        static=static,
    )


def _evidence_row(**overrides):
    row = {
        "station_id": UID,
        "city": "Frankfurt",
        "fuel": "e10",
        "origin": NOW.isoformat(),
        "points": POINTS,
        "model_kind": "profile_ar2",
        "day_pair": True,
        "shared_draws": True,
        "draws_24h": {
            "n": 4,
            "block_minutes": 120,
            "blocks": BLOCKS,
            "minima": MINIMA,
            "nowcast": [1.68, 1.69, 1.70, 1.71],
            "shared": True,
        },
        "rolling_picp_7d": {
            "current": {"badge": "green", "picp_pct": 95.0, "points": 144, "n_days": 7}
        },
        "stale_data_at_origin": False,
        "calibrated": False,
        "calibration": None,
        "law_rise_outside_noon": 0,
    }
    row.update(overrides)
    return row


def _publish(settings, row):
    path = settings.runtime / "engine/current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"published_at": NOW.isoformat(), "forecasts": [row]}),
        encoding="utf-8",
    )


def _live(settings):
    def query(cfg, flux):
        return [
            {
                "_time": (NOW - dt.timedelta(minutes=5)).isoformat(),
                "city": "Frankfurt",
                "station_id": UID,
                "station": "Station Alpha",
                "status": "open",
                "e10": "1.689",
            }
        ]

    return LiveData(settings, query=query, clock=lambda: NOW)


# --- Modellvertragsmatrix (M1/Priorität 7) ----------------------------------


def test_matrix_gives_each_config_exactly_one_status():
    matrix = describe()
    assert matrix["productive"]["model_kind"] == "profile_ar2"
    assert set(matrix["contracts"]) == {"profile_ar2", "harmonic_ar2", "ensemble"}
    for entry in matrix["contracts"].values():
        assert set(entry) == {
            "status",
            "backtest_kind",
            "backtest_parity",
            "calibration_24h",
            "calibration_72_168h",
            "decision_release",
            "note",
        }


def test_only_productive_contract_is_released():
    assert contract_status("profile_ar2", shared_draws=True, day_pair=True) == (
        STATUS_PRODUCTIVE
    )
    # Jede Ziehabweichung fällt auf experimentell — derselbe Vertrag wie M7.
    assert contract_status("profile_ar2", shared_draws=False, day_pair=True) == (
        STATUS_EXPERIMENTAL
    )
    assert contract_status("profile_ar2", shared_draws=True, day_pair=False) == (
        STATUS_EXPERIMENTAL
    )
    assert contract_status("harmonic_ar2", shared_draws=True, day_pair=True) == (
        STATUS_EXPERIMENTAL
    )
    # M1: Ensemble ist deaktiviert — keine Pfadparität, keine Evidenz.
    assert contract_status("ensemble", shared_draws=True, day_pair=True) == (
        STATUS_DISABLED
    )
    assert contract_status("unknown_kind") == STATUS_DISABLED
    assert is_forecast_released(_evidence_row()) is True
    assert is_forecast_released(_evidence_row(model_kind="ensemble")) is False
    assert is_forecast_released({}) is False


def test_decide_blocks_ensemble_with_model_not_released(settings):
    assert "model_not_released" in ACTION_BLOCKING_REASONS
    assert "regime_check_pending" in ACTION_BLOCKING_REASONS
    _publish(settings, _evidence_row(model_kind="ensemble"))
    body = evaluate_decide(_live(settings), dict(CITY_PARAMS))
    assert body.get("error_code") is None
    assert body["decision_ready"] is False
    assert body["primary"]["action"] == "no_advice"
    assert "model_not_released" in body["blocking_reasons"]
    assert "nicht für Empfehlungen freigegeben" in body["primary"]["reason_short"]


def test_decide_blocks_regime_rises_with_regime_check_pending(settings):
    _publish(settings, _evidence_row(law_rise_outside_noon=12))
    body = evaluate_decide(_live(settings), dict(CITY_PARAMS))
    assert body["decision_ready"] is False
    assert "regime_check_pending" in body["blocking_reasons"]
    assert "12-Uhr-Regel" in body["primary"]["reason_short"]


def test_decide_keeps_productive_contract_unblocked_by_new_reasons(settings):
    _publish(settings, _evidence_row())
    body = evaluate_decide(_live(settings), dict(CITY_PARAMS))
    assert "model_not_released" not in body["blocking_reasons"]
    assert "regime_check_pending" not in body["blocking_reasons"]
    # Ohne M7-Evidenz bleibt m7_pending die einzige Sperre (A5).
    assert body["blocking_reasons"] == ["m7_pending"]


# --- M7-Archiv (A5) ----------------------------------------------------------


def test_m7_archive_appends_and_reads_with_cohort_and_exclusions(settings):
    context = {
        "fuel": "e10",
        "model_contract": "profile_ar2+day_pair=1+shared=1",
        "calibration_mode": "raw",
        "decision_contract": "decision-v1",
        "regime_ref": "2026-07-01T00:00",
    }
    entry = build_entry(
        gate_context=context,
        verdict="blocked_n_too_small",
        gate_n=34,
        references={"loo_a_brier": 0.21, "loo_b_brier": 0.22, "model_brier": 0.20},
        reliability={"slope": 0.9, "slope_ci": [0.5, 1.3]},
        bootstrap={"method": "block", "kish_ess": 42.5},
        exclusions=["12 Snapshots ohne Verteilungs-P (p_source != verteilung)"],
    )
    path = append_entry(settings, entry)
    assert path.name == "archive.jsonl"
    back = read_entries(settings)
    assert len(back) == 1
    assert back[0]["gate_context"]["fuel"] == "e10"
    assert back[0]["gate_n"] == 34
    assert back[0]["references"]["model_brier"] == 0.20
    assert back[0]["exclusions"][0].startswith("12 Snapshots")


def test_m7_release_blocker_names_learning_platform_not_decision_system():
    blocked = release_blocked_reason(calibrated=False, gate_n=34)
    assert blocked is not None
    assert "Keine klare Empfehlung" in blocked
    assert "34 von 100" in blocked
    assert "Preise sind gemessen" in blocked
    assert release_blocked_reason(calibrated=True, gate_n=120) is None


# --- Verfügbarkeit (M5) ------------------------------------------------------


def test_decision_metrics_separate_m7_from_technical():
    decision_metrics.reset()
    base = NOW
    decision_metrics.observe_decision(
        decision_ready=False,
        blocking_reasons=["m7_pending"],
        station_id=UID,
        fuel="e10",
        at=base,
    )
    decision_metrics.observe_decision(
        decision_ready=False,
        blocking_reasons=["price_stale", "forecast_expired"],
        station_id=UID,
        fuel="e10",
        at=base + dt.timedelta(minutes=5),
    )
    decision_metrics.observe_decision(
        decision_ready=True,
        blocking_reasons=[],
        station_id=UID,
        fuel="e10",
        at=base + dt.timedelta(minutes=10),
    )
    summary = decision_metrics.summary()
    assert summary["count"] == 3
    assert summary["ready_share"] == pytest.approx(1 / 3, abs=1e-4)
    assert summary["m7_blocked_count"] == 1
    assert summary["technical_blocked_count"] == 1
    codes = {item["code"]: item["count"] for item in summary["by_reason"]}
    assert codes["m7_pending"] == 1
    assert codes["price_stale"] == 1
    assert summary["by_fuel"][0]["fuel"] == "e10"


def test_evaluate_decide_feeds_availability_window(settings):
    decision_metrics.reset()
    _publish(settings, _evidence_row())
    evaluate_decide(_live(settings), dict(CITY_PARAMS))
    summary = decision_metrics.summary()
    assert summary["count"] == 1
    assert summary["ready_share"] == 0.0
    assert summary["m7_blocked_count"] == 1


# --- Datenqualität (M3) ------------------------------------------------------


def test_data_quality_exposure_names_weak_share():
    forecasts = [
        {"points": [{"supported": True}], "n_days": 42},
        {"points": [{"supported": False}], "n_days": 42},
        {"points": [{"supported": True}], "n_days": 20},
    ]
    result = data_quality.exposure(forecasts)
    assert result["stations_total"] == 3
    assert result["stations_voll"] == 1
    assert result["stations_lueckig"] == 1
    assert result["stations_duenn"] == 1
    assert result["weak_share"] == pytest.approx(2 / 3, abs=1e-4)


# --- Regime-Monitor (Priorität 6.4) ------------------------------------------


def test_regime_monitor_warns_and_blocks_on_accumulation():
    ok = regime_monitor.evaluate_publication(
        [{"station_id": "a", "law_rise_outside_noon": 0}]
    )
    assert ok["status"] == "ok"
    warn = regime_monitor.evaluate_publication(
        [
            {"station_id": "a", "law_rise_outside_noon": 1},
            {"station_id": "b", "law_rise_outside_noon": 2},
        ]
    )
    assert warn["status"] == "warn"
    blocked = regime_monitor.evaluate_publication(
        [{"station_id": f"s{i}", "law_rise_outside_noon": 1} for i in range(6)]
    )
    assert blocked["status"] == "blocked"
    assert blocked["stations_affected"] == 6
    assert regime_monitor.station_blocked({"law_rise_outside_noon": 12}) is True
    assert regime_monitor.station_blocked({"law_rise_outside_noon": 3}) is False


# --- Forecast-Versionierung (M2) ---------------------------------------------


def test_forecast_fingerprints_are_stable_and_distinct():
    parts = {"station_id": UID, "origin": NOW.isoformat(), "model_kind": "profile_ar2"}
    assert input_fingerprint(parts) == input_fingerprint(dict(parts))
    other = dict(parts, model_kind="ensemble")
    assert input_fingerprint(parts) != input_fingerprint(other)
    calibration = {"provenance": {"fingerprint": "abc123"}}
    assert calibration_fingerprint(calibration) == "abc123"
    assert calibration_fingerprint({}) is None
    assert calibration_fingerprint(None) is None


def test_health_carries_new_transparency_fields(settings):
    _publish(settings, _evidence_row())
    health = _live(settings).health()
    assert "contracts" in health["models"]
    assert health["models"]["contracts"]["productive"]["model_kind"] == "profile_ar2"
    assert health["models"]["data_quality"]["stations_total"] == 1
    assert health["models"]["regime_monitor"]["status"] in {"ok", "warn", "blocked"}
    assert "decision_availability" in health
    assert health["decision_availability"]["count"] >= 0
