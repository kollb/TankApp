"""B0 — die Messgrundlagen kommen in der App an (Kalender, Cache, Publikation).

Engine-seitig prüfen ``test_b0_counters.py`` und ``test_b0_pit_regime.py``
die Zähler; hier geht es um den Weg in den Betrieb:

* ``TANKAPP_REGIMES`` → ``Settings.regimes`` → ``engine_config`` →
  ``Config.regimes`` (eine Quelle, wie ``price_law_local``),
* der Backtest-Cache trägt die neuen Felder (Schema 3) und liefert sie beim
  Treffer unverändert,
* der Fit-Task liefert ``pava_pool_stats`` für die 24-h-Prognose,
* die Veröffentlichung je Station trägt Zähler, PIT-Block, Regime-Kanten und
  das **gemessene** Punktmodell des Backtests (``backtest_model_kind``).
"""

from __future__ import annotations

import datetime as dt
import json

import pandas as pd
import pytest

import app.data as app_data
from app import backtest_cache
from app.config import Settings, engine_config
from app.model_jobs import run_tasks
from app.refresh import refresh
from app.regimes import DEFAULT_REGIMES, regimes_from_env
from engine.config import Config
from engine.data import normalize_observations, prepare_series
from test_app_jobs import UID, model_setup  # noqa: F401 — Fixture wird hier genutzt

ORIGIN = pd.Timestamp("2026-08-05T10:00", tz="UTC")


# --- Kalender aus der Umgebung -------------------------------------------------


def test_default_kalender_traegt_die_vier_bekannten_termine():
    stamps = [entry["announced_local"] for entry in DEFAULT_REGIMES]
    assert stamps == [
        "2026-05-01T00:00",
        "2026-07-01T00:00",
        "2026-10-01T00:00",
        "2027-01-01T00:00",
    ]
    assert all(entry["source"] for entry in DEFAULT_REGIMES)
    assert all(entry["kind"] == "tax_step" for entry in DEFAULT_REGIMES)
    # Der Default besteht die Engine-Prüfung unverändert.
    assert Config(regimes=DEFAULT_REGIMES).regimes == DEFAULT_REGIMES


def test_regimes_from_env_varianten(tmp_path):
    assert regimes_from_env("") == DEFAULT_REGIMES
    assert regimes_from_env("   ") == DEFAULT_REGIMES
    for off in ("0", "off", "NONE", "false"):
        assert regimes_from_env(off) == ()
    assert regimes_from_env('["2026-10-01T00:00"]') == ("2026-10-01T00:00",)
    calendar = tmp_path / "regimes.json"
    calendar.write_text(
        json.dumps({"regimes": [{"announced_local": "2026-10-01T00:00"}]}),
        encoding="utf-8",
    )
    assert regimes_from_env(str(calendar)) == ({"announced_local": "2026-10-01T00:00"},)
    calendar.write_text(json.dumps(["2027-01-01T00:00"]), encoding="utf-8")
    assert regimes_from_env(str(calendar)) == ("2027-01-01T00:00",)


@pytest.mark.parametrize(
    "raw, match",
    [
        ("quatsch", "TANKAPP_REGIMES muss"),
        ("[nicht json", "kein gültiges JSON"),
        ('{"announced_local": "2026-10-01"}', "TANKAPP_REGIMES muss"),
        ("[1, 2]", "Liste aus Kalender-Einträgen"),
        ("/nirgendwo/regimes.json", "fehlt"),
    ],
)
def test_regimes_from_env_lehnt_kaputtes_laut_ab(raw, match):
    with pytest.raises(ValueError, match=match):
        regimes_from_env(raw)


def test_settings_und_engine_config_reichen_den_kalender_durch(monkeypatch):
    monkeypatch.delenv("TANKAPP_REGIMES", raising=False)
    cfg = engine_config(Settings.from_env())
    assert cfg.regimes == DEFAULT_REGIMES
    monkeypatch.setenv("TANKAPP_REGIMES", "0")
    assert engine_config(Settings.from_env()).regimes == ()
    monkeypatch.setenv(
        "TANKAPP_REGIMES",
        '[{"announced_local": "2026-10-01T00:00", "fuel": "e10", '
        '"announced_value": -17, "source": "Test"}]',
    )
    cfg = engine_config(Settings.from_env())
    assert cfg.regimes == (
        {
            "announced_local": "2026-10-01T00:00",
            "kind": "tax_step",
            "fuel": "E10",
            "announced_value": -17.0,
            "status": "announced",
            "source": "Test",
        },
    )
    # Kaputter Kalender: Abbruch mit Grund beim Bau der Engine-Konfiguration,
    # nicht ein stiller Lauf ohne Marker.
    monkeypatch.setenv("TANKAPP_REGIMES", '["2026-03-29T02:30"]')
    with pytest.raises(ValueError, match="regimes"):
        engine_config(Settings.from_env())
    monkeypatch.setenv("TANKAPP_REGIMES", "kaputt")
    with pytest.raises(ValueError, match="TANKAPP_REGIMES"):
        Settings.from_env()


# --- Cache und Worker ------------------------------------------------------------


def _series_map(observations, cfg):
    normalized, _ = normalize_observations(observations(days=35), cfg)
    return {
        (item.city, item.station_id): item for item in prepare_series(normalized, cfg)
    }


def test_backtest_payload_traegt_die_messgrundlagen_und_ueberlebt_den_cache(
    observations, cfg, tmp_path
):
    assert backtest_cache.CACHE_SCHEMA_VERSION == 5
    assert {
        "pit",
        "regime_breaks_in_window",
        "ar_shrink",
        "model_kind",
        "shared_draws",
        "day_pair",
        "calibration_candidate",
    } <= set(backtest_cache.PAYLOAD_KEYS)
    marked = Config(**{**cfg.to_dict(), "regimes": ("2026-07-31T00:00",)})
    series_map = _series_map(observations, marked)
    key = next(iter(series_map))
    task = [("backtest", key, 5)]
    cache_dir = tmp_path / "backtest-cache"
    fresh = run_tasks(task, series_map, marked, ORIGIN, workers=1, cache_dir=cache_dir)[
        0
    ]
    assert fresh["ok"] and fresh["backtest_cached"] is False
    # B2 misst dieselbe Verteilung, deren PIT-Kurve später auf die
    # Veröffentlichung angewandt wird (run_tasks-Default: Ensemble/shared).
    assert fresh["model_kind"] == "profile_ar2" and fresh["shared_draws"] is True
    assert fresh["day_pair"] is True
    candidate = fresh["calibration_candidate"]
    assert (
        candidate["model_kind"] == "profile_ar2" and candidate["shared_draws"] is True
    )
    candidate_24h = candidate["24h"]
    assert candidate_24h["status"] in {
        "accepted",
        "rejected_validation",
        "insufficient_pit",
    }
    assert fresh["pit"]["station_id"] == key[1]
    assert set(fresh["pit"]["horizons"]) == {"24h", "72h", "168h"}
    assert fresh["pit"]["horizons"]["24h"]["all"]["n"] > 0
    # B2 darf die nur als ``24h`` bezeichnete Kurve nicht mit den anderen
    # Vorhersagehorizonten trainieren. Regime-Fenster können die Menge nur
    # weiter verkleinern.
    assert (
        candidate_24h["n_pit"] + candidate_24h.get("n_test", 0)
        <= fresh["pit"]["horizons"]["24h"]["break_free"]["n"]
    )
    regime = fresh["regime_breaks_in_window"]
    assert regime["count"] == 1 and regime["folds_spanning"] >= 1
    assert fresh["ar_shrink"]["folds_scored"] == regime["folds_scored"]
    hit = run_tasks(task, series_map, marked, ORIGIN, workers=1, cache_dir=cache_dir)[0]
    assert hit["backtest_cached"] is True
    for field in (
        "pit",
        "regime_breaks_in_window",
        "ar_shrink",
        "model_kind",
        "calibration_candidate",
    ):
        assert hit[field] == fresh[field], field
    stored = json.loads(next(cache_dir.glob("e10-*.json")).read_text(encoding="utf-8"))
    assert stored["cache_schema"] == 5
    assert "pit" in stored["payload"] and "regime_breaks_in_window" in stored["payload"]


def test_fit_task_liefert_pava_pool_statistik(observations, cfg):
    series_map = _series_map(observations, cfg)
    key = next(iter(series_map))
    fit_result, wide_result = run_tasks(
        [("fit", key, 24), ("wide", key, 72)], series_map, cfg, ORIGIN, workers=1
    )
    assert fit_result["ok"] and wide_result["ok"]
    stats = fit_result["pava_pool_stats"]
    assert stats["law_segments"] >= 1
    assert {"harmonic_ar2", "profile_ar2", "paths_changed_fraction"} <= set(
        stats["totals"]
    )
    assert fit_result["model"]["ar_shrink_events"] >= 0
    assert "ar_detail" in fit_result["model"]
    # Wide-Aufgaben rechnen ohne Diagnose (kein Rücktransfer toter Arbeit).
    assert "pava_pool_stats" not in wide_result


# --- Veröffentlichung -----------------------------------------------------------


def test_publikation_traegt_zaehler_pit_und_gemessenes_modell(
    model_setup,  # noqa: F811 — Fixture aus test_app_jobs
    monkeypatch,
):
    stub_report = {
        "metrics": {"points": 10, "mae_ct": 1.2},
        "model_kind": "harmonic_ar2",
        "shared_draws": False,
        "pit": {
            "method": "mid_rank_of_actual_among_bootstrap_paths",
            "stations": [
                {
                    "city": "Frankfurt",
                    "station_id": UID,
                    "fuel": "E10",
                    "horizons": {"24h": {"all": {"n": 10}, "break_free": {"n": 10}}},
                }
            ],
        },
        "regime_breaks_in_window": {"count": 0, "declared": [], "in_window": []},
        "ar_shrink": {"folds_scored": 1, "folds_shrunk": 0},
    }
    monkeypatch.setattr(
        "engine.backtest.run_backtest", lambda *a, **kw: (stub_report, None)
    )
    result = refresh(model_setup, dt.datetime(2026, 8, 6, tzinfo=dt.timezone.utc))
    assert result["state"] in {"ok", "partial"}
    publication = app_data.publication(model_setup)
    forecast = next(row for row in publication["forecasts"] if row["station_id"] == UID)
    # Zähler aus dem Fit …
    assert isinstance(forecast["ar_shrink_events"], int)
    assert forecast["ar_state_reset"] in (True, False)
    assert set(forecast["ar_detail"]) == {"harmonic_ar2", "profile_ar2"}
    assert forecast["pava_pool_stats"]["law_segments"] >= 1
    assert "weight_spread" in forecast["ensemble"]
    # … und aus dem Backtest, samt dem gemessenen Modell neben dem
    # veröffentlichten (heute verschieden — docs/planung/LUECKEN.md).
    assert forecast["pit"]["station_id"] == UID
    assert forecast["regime_breaks_in_window"]["count"] == 0
    assert forecast["ar_shrink"]["folds_scored"] == 1
    assert forecast["backtest_model_kind"] == "harmonic_ar2"
    assert forecast["backtest_shared_draws"] is False
    assert forecast["model_kind"] == "profile_ar2"
    assert forecast["day_pair"] is True
    assert forecast["ensemble"]["horizon_weights"]["status"] == "not_estimated"
    # Das Modell-Artefakt trägt den Kalender in seiner Config.
    model_bundle = json.loads(
        (model_setup.runtime / "engine" / publication["model_file"]).read_text()
    )
    assert model_bundle["models"][0]["config"]["regimes"] == list(DEFAULT_REGIMES)
