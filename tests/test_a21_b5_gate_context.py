"""A21-B5.1 (#211) — M7-Gültigkeit an Modell-/Policy-Kontexte binden.

Vor 0.68.0 rechnete das M7-Gate über den gemischten Lebenszeit-Ledger:
Stadt, Kraftstoff, Modellgeneration und Regime waren keine bindende
Freigabegrenze (Audit 21.09.2026 §3.2). Gute Historie aus Kontext A konnte
einen schwachen aktuellen Zustand B freigeben.

Abnahme (Issue 211):

* Gute Historie in Kontext A öffnet bei unzulässigem Wechsel nach B nicht
  dessen Freigabe — Fuel-, Modellkern-, Kalibrierungsmodus- und
  Regimewechsel wirken als harte Grenze.
* Normale Refreshes im selben statistischen Vertrag verwerfen Historie nicht
  (keine Fit-ID im Vertragskontext).
* Legacy/unknown wird nie zur nachgewiesenen aktuellen Kohorte — bleibt aber
  in der Allzeitbilanz vollständig sichtbar.
* Kleine Stichprobe bleibt ehrlich gesperrt; zulässiges Pooling (Stationen/
  Städte innerhalb einer Kohorte) zählt zusammen.
* API trennt historische Güte (``gate_cohorts``/``statistical_verdict``),
  Vertragsfreigabe (``calibrated`` + ``gate_context``) und aktuelle
  Verwendbarkeit (``blocking_reasons``/``decision_ready``).
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.data import LiveData
from app.decide import evaluate_decide
from app.feedback import (
    _empty_feedback_store,
    advice_for_context,
    compute_advice_stats,
    select_gate_cohort,
)
from app.gate_context import (
    decision_contract_id,
    gate_context_key,
    model_contract_id,
    regime_ref_for,
    statistical_gate_context,
)

NOW = dt.datetime(2026, 9, 10, 14, 0, tzinfo=dt.timezone.utc)  # 16:00 Berlin

# Der Vertragskontext der Skill-Historie dieser Datei (vollständig belegt).
CONTEXT = {
    "fuel": "e10",
    "model_contract": "profile_ar2+day_pair=1+shared=1",
    "calibration_mode": "raw",
    "decision_contract": decision_contract_id(),
    "regime_ref": None,
}


def _store(rows, context=None):
    """Store aus (Tagesversatz, UTC-Stunde, p, outcome) — optional mit Kontext."""
    snaps, settlements = [], []
    for i, (day, hour, p, outcome) in enumerate(rows):
        snap = {
            "id": f"s{i}",
            "action": "wait",
            "p_correct": p,
            "p_source": "verteilung",
            "emitted_at": (NOW - dt.timedelta(days=day))
            .replace(hour=hour, minute=0, second=0, microsecond=0)
            .isoformat(),
        }
        if context is not None:
            snap["gate_context"] = dict(context)
        snaps.append(snap)
        settlements.append({"snapshot_id": f"s{i}", "outcome": outcome})
    return {"episodes": [{"id": "ep", "snapshots": snaps}], "settlements": settlements}


def _skill_rows(n_days=20):
    """Kalibrierter Skill: p=.75 trifft 3/4, p=.25 trifft 1/4 je Tag."""
    rows = []
    for day in range(n_days):
        rows.extend(
            [
                (day, 12, 0.75, "win"),
                (day, 12, 0.75, "win"),
                (day, 12, 0.75, "win"),
                (day, 12, 0.75, "loss"),
                (day, 12, 0.25, "win"),
                (day, 12, 0.25, "loss"),
                (day, 12, 0.25, "loss"),
                (day, 12, 0.25, "loss"),
            ]
        )
    return rows


def _switch(context, **overrides):
    return {**context, **overrides}


# --- Vertrags-ID: fachlich, ohne Fit-ID ------------------------------------


def test_model_contract_id_ignores_fit_refresh_fields():
    """Ein stündlicher Fit-Refresh ist derselbe Vertrag (Issue 211)."""
    fresh = {
        "model_kind": "profile_ar2",
        "day_pair": True,
        "draws_24h": {"shared": True},
        "origin": "2026-09-10T12:00:00+00:00",
        "n_points": 8064,
    }
    later_refresh = {
        **fresh,
        "origin": "2026-09-10T13:00:00+00:00",
        "n_points": 8076,
    }
    assert model_contract_id(fresh) == model_contract_id(later_refresh)
    assert model_contract_id(fresh) == CONTEXT["model_contract"]


def test_model_contract_id_switches_on_kernel_and_draw_mode():
    assert (
        model_contract_id(
            {
                "model_kind": "harmonic_ar2",
                "day_pair": True,
                "draws_24h": {"shared": True},
            }
        )
        != CONTEXT["model_contract"]
    )
    assert (
        model_contract_id(
            {
                "model_kind": "profile_ar2",
                "day_pair": False,
                "draws_24h": {"shared": True},
            }
        )
        != CONTEXT["model_contract"]
    )
    assert (
        model_contract_id(
            {
                "model_kind": "profile_ar2",
                "day_pair": True,
                "draws_24h": {"shared": False},
            }
        )
        != CONTEXT["model_contract"]
    )
    # Teilwissen erklärt keinen Vertrag.
    assert model_contract_id({"model_kind": "profile_ar2"}) == "unknown"
    assert model_contract_id(None) == "unknown"


def test_regime_ref_counts_only_confirmed_edges_and_flags_scenarios():
    regimes = (
        {
            "announced_local": "2026-07-01T00:00",
            "kind": "tax_step",
            "fuel": None,
            "status": "in_force",
            "announced_value": 17.0,
        },
        {
            "announced_local": "2026-10-01T00:00",
            "kind": "tax_step",
            "fuel": None,
            "status": "announced",
            "announced_value": -17.0,
        },
    )
    ref, scenario = regime_ref_for("e10", NOW, regimes)
    assert ref == "2026-07-01T00:00"
    assert scenario is True  # angekündigtes Szenario bleibt sichtbar
    before = dt.datetime(2026, 6, 1, 12, 0, tzinfo=dt.timezone.utc)
    assert regime_ref_for("e10", before, regimes) == (None, True)
    # Nur angekündigt (A14-Szenario) verschiebt die Driftgrenze bewusst nicht.
    announced_only = (regimes[1],)
    assert regime_ref_for("e10", NOW, announced_only) == (None, True)


# --- Harte Kohortengrenzen -------------------------------------------------


def test_good_history_in_context_a_does_not_open_b():
    """Gute Historie in A öffnet B (hier: Fuel-Wechsel) nicht."""
    advice = compute_advice_stats(_store(_skill_rows(), CONTEXT))
    diesel = _switch(CONTEXT, fuel="diesel")
    entry = select_gate_cohort(advice, diesel)
    assert entry["calibrated"] is False
    assert entry["match"] is False
    assert entry["gate_n"] == 0
    assert "fremde Kohorten öffnen ihn nicht" in entry["gate_status"]
    # Die gute Historie bleibt als eigene Kohorte und in der Allzeitbilanz.
    assert advice["n_all"] == 160
    by_key = {row["context_key"]: row for row in advice["gate_cohorts"]}
    assert by_key[gate_context_key(CONTEXT)]["calibrated"] is True


def test_unallowed_switches_do_not_inherit_release():
    advice = compute_advice_stats(_store(_skill_rows(), CONTEXT))
    for other in (
        _switch(CONTEXT, model_contract="harmonic_ar2+day_pair=1+shared=1"),
        _switch(CONTEXT, calibration_mode="pit_24h"),
        _switch(CONTEXT, decision_contract="decision-v99"),
        _switch(CONTEXT, regime_ref="2026-07-01T00:00"),
        _switch(CONTEXT, fuel="e5"),
    ):
        entry = select_gate_cohort(advice, other)
        assert entry["calibrated"] is False
        assert entry["gate_n"] == 0


def test_regime_switch_resets_gate_evidence():
    """Bestätigte Regime-Kante = Drift-/Resetgrenze der Kohorte (Issue 211)."""
    before_rows = _skill_rows()
    store = _store(before_rows, _switch(CONTEXT, regime_ref="2026-05-01T00:00"))
    advice = compute_advice_stats(store)
    assert (
        select_gate_cohort(advice, _switch(CONTEXT, regime_ref="2026-05-01T00:00"))[
            "calibrated"
        ]
        is True
    )
    after = select_gate_cohort(advice, _switch(CONTEXT, regime_ref="2026-07-01T00:00"))
    assert after["calibrated"] is False
    assert after["gate_n"] == 0


def test_normal_refresh_same_contract_keeps_history():
    """Neue Zeilen im selben Vertrag poolen mit der Historie."""
    store = _store(_skill_rows(10), CONTEXT)
    # „Refresh“: neue Zeilen, andere Origin-Stunden, selbe Vertragsfelder.
    more = []
    for i, row in enumerate(_skill_rows(10)):
        more.append((row[0] + 10, 13, row[2], row[3]))
    snaps2, sets2 = [], []
    for i, (day, hour, p, outcome) in enumerate(more):
        snaps2.append(
            {
                "id": f"r{i}",
                "action": "wait",
                "p_correct": p,
                "p_source": "verteilung",
                "gate_context": dict(CONTEXT),
                "emitted_at": (NOW - dt.timedelta(days=day))
                .replace(hour=hour, minute=0, second=0, microsecond=0)
                .isoformat(),
            }
        )
        sets2.append({"snapshot_id": f"r{i}", "outcome": outcome})
    store["episodes"].append({"id": "ep2", "snapshots": snaps2})
    store["settlements"].extend(sets2)
    entry = select_gate_cohort(compute_advice_stats(store), CONTEXT)
    assert entry["gate_n"] == 160
    assert entry["calibrated"] is True


def test_unknown_legacy_history_never_proven_current_cohort():
    """Altbestand ohne Herkunft bleibt sichtbar, öffnet aber nichts mehr."""
    legacy = _store(_skill_rows())  # ohne gate_context
    advice = compute_advice_stats(legacy, gate_context=CONTEXT)
    assert advice["gate_n"] == 0
    assert advice["calibrated"] is False
    assert advice["gate_context_source"] == "requested"
    # Allzeitbilanz und historische Statistik bleiben vollständig (Issue 211).
    assert advice["n_all"] == 160
    unknown = next(
        row
        for row in advice["gate_cohorts"]
        if row["context"]
        == {
            "fuel": "unknown",
            "model_contract": "unknown",
            "calibration_mode": "unknown",
            "decision_contract": "unknown",
            "regime_ref": "unknown",
        }
    )
    assert unknown["statistical_verdict"] is True  # historische Güte sichtbar
    assert unknown["calibrated"] is False  # …aber keine Vertragsfreigabe
    assert "Historisch kalibriert" in unknown["gate_status"]
    assert "öffnet keine Aktionsfreigabe" in unknown["gate_status"]


def test_small_sample_stays_blocked_in_cohort():
    advice = compute_advice_stats(_store(_skill_rows(5), CONTEXT))
    entry = select_gate_cohort(advice, CONTEXT)
    assert entry["gate_n"] == 40
    assert entry["calibrated"] is False
    assert entry["gate_status"].startswith("Kalibrierung steht aus")


def test_allowed_pooling_across_stations_and_cities():
    """Zulässiges Pooling: Stationen/Städte einer Kohorte zählen zusammen."""
    rows = _skill_rows(10)
    snaps, settlements = [], []
    for i, (day, hour, p, outcome) in enumerate(rows):
        for suffix, city, station in (
            ("a", "Frankfurt", "st-1"),
            ("b", "Gütersloh", "st-2"),
        ):
            snaps.append(
                {
                    "id": f"s{i}-{suffix}",
                    "action": "wait",
                    "city": city,
                    "station_id": station,
                    "p_correct": p,
                    "p_source": "verteilung",
                    "gate_context": dict(CONTEXT),
                    "emitted_at": (NOW - dt.timedelta(days=day))
                    .replace(hour=hour, minute=0, second=0, microsecond=0)
                    .isoformat(),
                }
            )
            settlements.append({"snapshot_id": f"s{i}-{suffix}", "outcome": outcome})
    store = {
        "episodes": [{"id": "ep", "snapshots": snaps}],
        "settlements": settlements,
    }
    entry = select_gate_cohort(compute_advice_stats(store), CONTEXT)
    assert entry["gate_n"] == 160
    assert entry["calibrated"] is True


def test_cohort_walks_do_not_rewrite_all_time_balance():
    """Gemischte Kohorten: Bilanz vollständig, Gate streng getrennt."""
    rows_a = _skill_rows()
    rows_b = [(d + 30, h, p, o) for d, h, p, o in _skill_rows()]
    store = _store(rows_a, CONTEXT)
    other = _switch(CONTEXT, calibration_mode="pit_24h")
    snaps, settlements = [], []
    for i, (day, hour, p, outcome) in enumerate(rows_b):
        snaps.append(
            {
                "id": f"b{i}",
                "action": "wait",
                "p_correct": p,
                "p_source": "verteilung",
                "gate_context": dict(other),
                "emitted_at": (NOW - dt.timedelta(days=day))
                .replace(hour=hour, minute=0, second=0, microsecond=0)
                .isoformat(),
            }
        )
        settlements.append({"snapshot_id": f"b{i}", "outcome": outcome})
    store["episodes"].append({"id": "ep-b", "snapshots": snaps})
    store["settlements"].extend(settlements)
    advice = compute_advice_stats(store, gate_context=other)
    assert advice["gate_n"] == 160
    assert advice["n_all"] == 320  # gemischte Allzeitbilanz bleibt vollständig
    assert len(advice["gate_cohorts"]) == 2
    verdicts = {
        row["context_key"]: (row["statistical_verdict"], row["gate_n"])
        for row in advice["gate_cohorts"]
    }
    assert verdicts[gate_context_key(CONTEXT)] == (True, 160)
    assert verdicts[gate_context_key(other)] == (True, 160)


def test_advice_for_context_does_not_mutate_cache_view():
    advice = compute_advice_stats(_store(_skill_rows(), CONTEXT))
    snapshot_before = dict(advice)
    view = advice_for_context(advice, _switch(CONTEXT, fuel="diesel"))
    assert view is not advice
    assert advice == snapshot_before
    assert view["calibrated"] is False
    assert view["gate_context_source"] == "requested"
    assert view["gate_match"] is False
    # Historische Kohortengüte bleibt in der Ansicht sichtbar.
    assert any(row["calibrated"] for row in view["gate_cohorts"])


# --- Decide-Integration: drei getrennte Aussagen ---------------------------

UID = "00000000-0000-0000-0000-000000000001"
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


def _evidence_row(**overrides):
    row = {
        "station_id": UID,
        "city": "Frankfurt",
        "fuel": "e10",
        "origin": NOW.isoformat(),
        "points": POINTS,
        "model_kind": "profile_ar2",
        "day_pair": True,
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
    }
    row.update(overrides)
    return row


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


def _seed(settings, context, rows=_skill_rows):
    store = _store(rows(), context)
    store = {**_empty_feedback_store(), **store}
    path = settings.runtime / "feedback" / "store.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store), encoding="utf-8")


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


def test_decide_blocks_release_from_foreign_or_legacy_history(settings):
    """Historische Güte ≠ gültige Aktionsfreigabe (Issue 211, Abnahme)."""
    live_context = statistical_gate_context(
        _evidence_row(), "e10", NOW, settings.regimes
    )
    assert live_context["regime_ref"] == "2026-07-01T00:00"  # bestätigte Kante
    # Alles belegt, aber die gute Historie liegt im **unknown**-Altbestand.
    _seed(settings, context=None)
    _publish(settings, _evidence_row())
    body = evaluate_decide(_live(settings), dict(CITY_PARAMS))
    assert body.get("error_code") is None
    assert body["calibrated"] is False
    assert body["gate_context_source"] == "requested"
    assert body["decision_ready"] is False
    assert "m7_pending" in body["blocking_reasons"]
    # Historische Güte bleibt sichtbar, getrennt von der Freigabe.
    assert body["gate_context"]["fuel"] == "e10"
    assert body["gate_context"]["decision_contract"] == decision_contract_id()


def test_decide_releases_inside_matching_cohort(settings):
    live_context = statistical_gate_context(
        _evidence_row(), "e10", NOW, settings.regimes
    )
    _seed(settings, context=live_context)
    _publish(settings, _evidence_row())
    body = evaluate_decide(_live(settings), dict(CITY_PARAMS))
    assert body["calibrated"] is True
    assert body["decision_ready"] is True
    assert body["blocking_reasons"] == []
    assert body["gate_context"] == {
        key: live_context[key] for key in live_context if not key.startswith("_")
    }


def test_decide_model_contract_switch_blocks_despite_same_fuel(settings):
    live_context = statistical_gate_context(
        _evidence_row(), "e10", NOW, settings.regimes
    )
    # Historie stammt aus einem anderen Modellkern-Vertrag.
    _seed(
        settings,
        context=_switch(
            live_context, model_contract="harmonic_ar2+day_pair=1+shared=1"
        ),
    )
    _publish(settings, _evidence_row())
    body = evaluate_decide(_live(settings), dict(CITY_PARAMS))
    assert body["calibrated"] is False
    assert "m7_pending" in body["blocking_reasons"]


def test_snapshot_and_settlement_carry_gate_context(settings):
    """Reproduzierbare Herkunft in Snapshots und Settlements (Issue 211)."""
    from app.feedback import load_store

    live_context = statistical_gate_context(
        _evidence_row(), "e10", NOW, settings.regimes
    )
    _seed(settings, context=live_context)
    _publish(settings, _evidence_row())
    evaluate_decide(_live(settings), dict(CITY_PARAMS))
    store = load_store(settings)
    fresh = [
        snap
        for ep in store["episodes"]
        if ep.get("id") != "ep"
        for snap in ep.get("snapshots", [])
    ]
    assert fresh
    assert fresh[-1]["gate_context"] == {
        key: live_context[key] for key in live_context if not key.startswith("_")
    }
    assert fresh[-1]["regime_scenario_pending"] is True  # Okt-Szenario sichtbar
