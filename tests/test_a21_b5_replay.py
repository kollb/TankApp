"""A21-B5.3 (#213): Walk-forward-/Operational-Replay-Harness.

Abnahme: deterministische Folds (Wanduhr-Ursprünge inkl. 23-/25-h-Tagen),
echter Produktionsoperator (refresh → evaluate_decide) mit strikt vor dem
Ursprung geschnittenen Dateneingängen, getrennte Kennzahlen mit Tagesblock-
KIs, Slices, vorab definierte Margen und der Gate-Vergleich alt (gemischt)
gegen neu (Vertragskohorte) — maschinenlesbarer Report, Ergebnis darf
negativ ausfallen.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from app.config import Settings, engine_config
from app.replay import (
    REPLAY_ACCEPTANCE,
    block_bootstrap_ci,
    decision_scores,
    evaluate_margins,
    event_scores,
    fold_origins,
    legacy_mixed_verdict,
    quantile_scores,
    run_replay,
    seed_legacy_history,
    synthetic_holdout,
    write_replay_report,
)

BERLIN_TZ = "Europe/Berlin"


def _cfg() -> object:
    return engine_config(
        Settings(
            data=Path("/tmp/replay-unused"),
            archive=Path("/tmp/replay-unused"),
            polling=Path("/tmp/replay-unused/polling.json"),
            influx_env=Path("/tmp/replay-unused/influx.env"),
            netrc=Path("/tmp/replay-unused/netrc"),
        ),
    )


def test_fold_origins_are_wall_clock_and_span_dst_days():
    cfg = _cfg()
    # EU-Umstellung 2026: 29.03. = 23-h-Tag, 25.10. = 25-h-Tag.
    frueh = fold_origins("2026-03-28", "2026-03-31", cfg, origin_hours=(0.0, 12.0))
    spaet = fold_origins("2026-10-24", "2026-10-27", cfg, origin_hours=(0.0, 12.0))
    assert len(frueh) == 6 and len(spaet) == 6
    assert len(set(frueh)) == 6 and len(set(spaet)) == 6
    mitternacht_f = [ts for ts in frueh if ts.tz_convert(BERLIN_TZ).hour == 0]
    assert [ts.tz_convert(BERLIN_TZ).date().isoformat() for ts in mitternacht_f] == [
        "2026-03-28",
        "2026-03-29",
        "2026-03-30",
    ]
    # 28.→29. (vor dem Sprung) 24 h, 29.→30. über den 23-h-Tag nur 23 h.
    assert mitternacht_f[1] - mitternacht_f[0] == pd.Timedelta(hours=24)
    assert mitternacht_f[2] - mitternacht_f[1] == pd.Timedelta(hours=23)
    mitternacht_o = [ts for ts in spaet if ts.tz_convert(BERLIN_TZ).hour == 0]
    # 24.→25. 24 h, 25.→26. über den 25-h-Tag 25 h.
    assert mitternacht_o[1] - mitternacht_o[0] == pd.Timedelta(hours=24)
    assert mitternacht_o[2] - mitternacht_o[1] == pd.Timedelta(hours=25)
    # Stunden sind Wanduhr — der 12er-Ursprung bleibt um 12:00 Ortszeit.
    assert frueh[1].tz_convert(BERLIN_TZ).hour == 12
    assert spaet[3].tz_convert(BERLIN_TZ).hour == 12


def test_quantile_scores_and_pit_are_separated():
    index = pd.date_range("2026-06-01", periods=4, freq="h", tz="UTC")
    frame = pd.DataFrame(
        {
            "q025": [0.9, 0.9, 0.9, 0.9],
            "q10": [0.95, 0.95, 0.95, 0.95],
            "q50": [1.0, 1.0, 1.0, 1.0],
            "q90": [1.05, 1.05, 1.05, 1.05],
            "q975": [1.1, 1.1, 1.1, 1.1],
        },
        index=index,
    )
    truth = pd.Series([1.0, 1.2, 0.8, 1.0], index=index)
    scores = quantile_scores(frame, truth)
    assert scores["mae_q50_ct"] == pytest.approx(10.0, abs=0.01)
    assert scores["picp50"] == 0.5  # 1.0 und 1.0 liegen im [q10,q90]
    assert scores["picp95"] == 0.5  # 1.2 darüber, 0.8 darunter
    assert scores["sharpness95_ct"] == pytest.approx(20.0, abs=0.01)
    pit = scores["pit_values"]
    assert len(pit) == 4 and all(0.0 <= p <= 1.0 for p in pit)
    # Wahrheit über q975 → PIT am oberen Rand.
    assert max(pit) >= 0.97
    # Unsortierte Quantile werden nicht gewertet (ehrlich ausgelassen).
    broken = frame.copy()
    broken.loc[index[0], "q90"] = 0.5
    assert len(quantile_scores(broken, truth)["pit_values"]) == 3


def test_event_scores_reliability_and_decision_regret():
    events = event_scores([0.9, 0.9, 0.1, 0.1], [1, 1, 0, 0])
    assert events["event_brier"] == pytest.approx(0.01, abs=1e-6)
    assert events["ece"] == pytest.approx(0.1, abs=0.01)
    assert len(events["bins"]) == 4
    empty = event_scores([], [])
    assert empty["event_brier"] is None and empty["ece"] is None

    truth = pd.Series(
        [1.70, 1.60, 1.65],
        index=pd.date_range("2026-06-01 13:00", periods=3, freq="h", tz="UTC"),
    )
    wait = decision_scores(
        "wait",
        "2026-06-01 13:00:00+00:00",
        "2026-06-01 15:00:00+00:00",
        1.70,
        truth,
    )
    # Politik kauft im Fenster bei 1,60 → 10 ct; Orakel ebenso → kein Regret.
    assert wait["net_benefit_ct"] == pytest.approx(10.0)
    assert wait["regret_ct"] == pytest.approx(0.0)
    now = decision_scores("refuel_now", None, None, 1.70, truth)
    # Sofort-Kauf: 0 ct Nutzen, 10 ct Regret gegen das Tagesminimum.
    assert now["net_benefit_ct"] == 0.0
    assert now["regret_ct"] == pytest.approx(10.0)


def test_block_bootstrap_ci_spans_day_blocks():
    lo, hi = block_bootstrap_ci(
        [[1.0, 1.1], [2.0, 2.1], [3.0, 3.2]], seed=7, n_boot=500
    )
    assert lo is not None and hi is not None
    assert lo <= 2.1 and hi >= 2.0 and lo < hi
    assert block_bootstrap_ci([[1.0]]) == (None, None)


def test_evaluate_margins_keeps_negative_results_visible():
    good = {
        "picp50": 0.5,
        "picp95": 0.9,
        "sharpness95_ct": 12.0,
        "event_brier": 0.2,
        "ece": 0.1,
        "regret_median_ct": 4.0,
    }
    verdict = evaluate_margins(good, margins=REPLAY_ACCEPTANCE)
    assert verdict["ok"] is True
    bad = dict(good, picp95=0.4)
    verdict_bad = evaluate_margins(bad, margins=REPLAY_ACCEPTANCE)
    assert verdict_bad["ok"] is False
    assert verdict_bad["margins"]["picp95"]["ok"] is False
    # Nicht messbar ist nie „bestanden“.
    missing = evaluate_margins({}, margins=REPLAY_ACCEPTANCE)
    assert missing["ok"] is False


def test_legacy_history_opens_old_gate_but_not_cohort_gate(tmp_path):
    from app.feedback import compute_advice_stats, select_gate_cohort

    store_file = tmp_path / "store.json"
    n = seed_legacy_history(store_file, n_days=20, rows_per_day=8, seed=5)
    assert n == 160
    store = json.loads(store_file.read_text(encoding="utf-8"))
    legacy = legacy_mixed_verdict(store)
    assert legacy["gate_n"] == 160
    # Altes gemischtes Gate: genug Evidenz, gute Statistik → geht auf.
    assert legacy["statistical_verdict"] is True
    assert legacy["calibrated"] is True

    advice = compute_advice_stats(store)
    # Dieselbe Historie, aber als unknown-Legacy: Statistik sichtbar, jedoch
    # ohne Herkunft — keine Vertragsfreigabe, keine aktuelle Kohorte.
    assert advice["statistical_verdict"] is True
    assert advice["gate_provenance_complete"] is False
    assert advice["calibrated"] is False
    fresh = {
        "fuel": "e10",
        "model_contract": "profile_ar2+day_pair=1+shared=1",
        "calibration_mode": "raw",
        "decision_contract": "decision-v1",
        "regime_ref": None,
    }
    cohort = select_gate_cohort(advice, fresh)
    assert cohort["gate_n"] == 0
    assert cohort["statistical_verdict"] is False
    assert cohort["calibrated"] is False


def test_write_replay_report_is_machine_readable(tmp_path):
    result = {
        "seed": 1,
        "role": "synthetic",
        "operator": "kette",
        "limits": "offen",
        "overall": {
            "n_folds": 2,
            "n_scored": 2,
            "n_failed": 0,
            "mae_q50_ct": 1.0,
            "picp50": 0.5,
            "picp95": 0.9,
            "sharpness95_ct": 12.0,
            "pit_mean": 0.5,
            "event_brier": 0.2,
            "ece": 0.1,
            "reliability_bins": [],
            "net_benefit_ct_median": 4.0,
            "regret_median_ct": 2.0,
        },
        "slices": {
            "fuel": {
                "e10": {
                    "n_folds": 2,
                    "picp50": 0.5,
                    "picp95": 0.9,
                    "picp95_block_ci": [0.8, 1.0],
                    "regret_median_ct": 2.0,
                    "sharpness95_ct": 12.0,
                },
            },
        },
        "margins": evaluate_margins(
            {
                "picp50": 0.5,
                "picp95": 0.9,
                "sharpness95_ct": 12.0,
                "event_brier": 0.2,
                "ece": 0.1,
                "regret_median_ct": 2.0,
            },
        ),
        "gate_comparison": {
            "n_decisions": 2,
            "legacy_calibrated": 1,
            "new_calibrated": 0,
            "legacy_gate_n": 120,
            "divergences": 1,
        },
        "folds": [],
    }
    json_path, md_path = write_replay_report(result, tmp_path)
    parsed = json.loads(json_path.read_text(encoding="utf-8"))
    assert parsed["overall"]["picp95"] == 0.9
    text = md_path.read_text(encoding="utf-8")
    for needle in ("Akzeptanzmargen", "Slices", "Gate-Vergleich", "Gesamturteil"):
        assert needle in text


def _settings_factory(dataset: pd.DataFrame):
    def factory(workdir: Path) -> Settings:
        workdir.mkdir(parents=True, exist_ok=True)
        stations = sorted(dataset["station_id"].unique())
        sets = {
            "Replay-Stadt": {
                "label": "Replay-Stadt",
                "batch": list(stations),
                "stations": [
                    {"uuid": uid, "name": uid, "lat": 50.11, "lon": 8.68}
                    for uid in stations
                ],
            }
        }
        polling = workdir / "polling.json"
        polling.write_text(json.dumps({"sets": sets}), encoding="utf-8")
        env = workdir / "influx.env"
        env.write_text(
            "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\n"
            "TANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n",
            encoding="utf-8",
        )
        return Settings(
            data=workdir / "data",
            archive=workdir / "archive",
            polling=polling,
            influx_env=env,
            netrc=workdir / "netrc",
            model_fuels=("e10",),
        )

    return factory


def test_run_replay_walks_forward_on_production_chain(tmp_path, monkeypatch):
    """End-to-End: echte Kette, zwei Ursprünge, Report + Margen + Slices."""
    from engine.config import Config

    cheap = Config(
        train_days=35,
        min_train_days=28,
        bootstrap_samples=100,
        seed=11,
    )
    monkeypatch.setattr("app.refresh.engine_config", lambda settings: cheap)
    dataset = synthetic_holdout(days=40, stations=2, seed=3, start="2026-06-01")
    dataset["timestamp"] = pd.to_datetime(dataset["timestamp"], utc=True)
    cfg = cheap
    origins = fold_origins("2026-07-05", "2026-07-07", cfg, origin_hours=(0.0,))
    assert len(origins) == 2
    result = run_replay(
        dataset=dataset,
        settings_factory=_settings_factory(dataset),
        cfg=cfg,
        workdir=tmp_path / "work",
        origins=origins,
        role="synthetic",
        seed=9,
    )
    assert result["overall"]["n_folds"] == 2
    assert result["overall"]["n_failed"] == 0
    assert result["overall"]["picp95"] is not None
    assert result["slices"]["fuel"]["e10"]["n_folds"] == 2
    assert result["slices"]["model_contract"]
    assert result["margins"]["judged"] == len(REPLAY_ACCEPTANCE)
    assert result["gate_comparison"]["n_decisions"] == 2
    json_path, md_path = write_replay_report(result, tmp_path / "out")
    parsed = json.loads(json_path.read_text(encoding="utf-8"))
    assert parsed["folds"][0]["action"] in (
        "wait",
        "refuel_now",
        "refuel_elsewhere",
        "no_advice",
        None,
    )
    assert "Gate-Vergleich" in md_path.read_text(encoding="utf-8")

    # Zweiter Lauf mit denselben Seeds/Zuschnitten: identische Kennzahlen
    # (reproduzierbares Messartefakt).
    again = run_replay(
        dataset=dataset,
        settings_factory=_settings_factory(dataset),
        cfg=cfg,
        workdir=tmp_path / "work2",
        origins=origins,
        role="synthetic",
        seed=9,
    )
    assert again["overall"] == result["overall"]
    assert again["margins"] == result["margins"]
