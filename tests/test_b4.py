"""Unit and integration tests for B4 (M5/M7 Konzept-Roadmap).

Tests:
  - GET /api/v1/decide + /v1/decide
  - Snapshot collapse rule (30 min)
  - Intent + Due-Prompt + Episodes API
  - POST /api/v1/fills + Compliance classification + Wallet €
  - Settlement Job (worker settlement + snapshot outcome)
  - GET /api/v1/stats/summary (3 layers: backtest, live_advice, wallet + quality_metrics)
  - GET /api/v1/day
"""

import datetime as dt
import json
import threading
import urllib.error
import urllib.request

import pytest

from app.config import Settings
from app.data import LiveData
from app.feedback import (
    M7_BRIER_THRESHOLD,
    M7_MIN_RECOMMENDATIONS,
    compute_advice_stats,
)
from app.server import make_server

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
NOW = dt.datetime(2026, 9, 10, 14, 0, tzinfo=dt.timezone.utc)


@pytest.fixture
def b4_settings(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "anchor": [50.11, 8.68],
                        "batch": [UID, OTHER],
                        "stations": [
                            {
                                "uuid": UID,
                                "name": "Station Alpha",
                                "brand": "ARAL",
                                "lat": 50.12,
                                "lon": 8.69,
                            },
                            {
                                "uuid": OTHER,
                                "name": "Station Beta",
                                "brand": "SHELL",
                                "lat": 50.13,
                                "lon": 8.70,
                            },
                        ],
                    }
                }
            }
        )
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\nTANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n"
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


def raw_price(ts, uid, city, price, status="open"):
    return {
        "_time": ts.isoformat(),
        "city": city,
        "station_id": uid,
        "station": "Station",
        "status": status,
        "e10": str(price),
    }


def _post_json(url, body):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Content-Length": str(len(data))},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, json.load(r)


def _get_json(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.status, json.load(r)


def test_decide_endpoint_and_gate(b4_settings):
    def query(cfg, flux):
        yield raw_price(NOW - dt.timedelta(minutes=5), UID, "Frankfurt", 1.689)
        yield raw_price(NOW - dt.timedelta(minutes=5), OTHER, "Frankfurt", 1.729)

    live = LiveData(b4_settings, query=query, clock=lambda: NOW)
    server = make_server(b4_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        # GET /api/v1/decide
        status, body = _get_json(
            base + "/api/v1/decide?city=Frankfurt&fuel=e10&liters=40"
        )
        assert status == 200
        assert "primary" in body
        assert "alternatives_nearby" in body
        assert "windows_today" in body
        assert "episode" in body
        assert "personal_stats" in body
        assert "calibrated" in body
        # Before M7, calibrated is False and p_correct is None (Gate §0.4, §11.1)
        assert body["calibrated"] is False
        assert body["primary"]["p_correct"] is None
        assert body["primary"]["action"] in (
            "no_advice",
            "refuel_now",
            "wait",
            "refuel_elsewhere",
        )
        assert body["episode"]["status"] in ("open", "waiting", "due")

        # Alias /v1/decide
        status2, body2 = _get_json(base + "/v1/decide?city=Frankfurt&fuel=e10")
        assert status2 == 200
        assert "primary" in body2
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_decide_red_rolling_picp_is_published_and_blocks_advice(b4_settings):
    from app.decide import evaluate_decide

    def query(cfg, flux):
        yield raw_price(NOW - dt.timedelta(minutes=5), UID, "Frankfurt", 1.689)
        yield raw_price(NOW - dt.timedelta(minutes=5), OTHER, "Frankfurt", 1.729)

    path = b4_settings.runtime / "engine/current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "published_at": NOW.isoformat(),
                "forecasts": [
                    {
                        "station_id": UID,
                        "city": "Frankfurt",
                        "fuel": "e10",
                        "origin": NOW.isoformat(),
                        "points": [
                            {
                                "timestamp": "2026-09-10T18:00:00+02:00",
                                "q50": 1.60,
                            }
                        ],
                        "rolling_picp_7d": {
                            "current": {
                                "day": "2026-09-09",
                                "picp_pct": 88.5,
                                "points": 144,
                                "badge": "red",
                            }
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    live = LiveData(b4_settings, query=query, clock=lambda: NOW)
    body = evaluate_decide(live, {"city": "Frankfurt", "fuel": "e10", "liters": 40})

    assert body["primary"]["action"] == "no_advice"
    assert "Intervallquote" in body["primary"]["reason_short"]
    assert body["quality"] == {
        "rolling_picp_7d_pct": 88.5,
        "rolling_picp_7d_points": 144,
        "rolling_picp_7d_badge": "red",
        "rolling_picp_7d_as_of": "2026-09-09",
        "rolling_picp_window_days": 7,
        "rolling_picp_nominal_pct": 95.0,
        "gate": "picp",
    }


def test_decide_p_side_from_forecast_distribution(b4_settings):
    """P-Seite (Konzept §4.1–4.3) aus den Draws — nicht aus der Ledger-Quote.

    Regression gegen Prüfstand §1.4: p_besser war die Laplace-geglättete
    Trefferquote, p_lohnt fehlte, F3 hatte kein Fenster-P. Mit Draws im
    Artefakt liefern alle drei die Verteilungs-Wahrscheinlichkeit — und der
    Snapshot speichert dieselbe P, die Brier später gegen das Settlement
    misst (bzw. nach dem M7-Gate im UI erscheint).
    """
    from app.decide import evaluate_decide
    from app.feedback import load_store

    def query(cfg, flux):
        yield raw_price(NOW - dt.timedelta(minutes=5), UID, "Frankfurt", 1.689)
        yield raw_price(NOW - dt.timedelta(minutes=5), OTHER, "Frankfurt", 1.729)

    # Berlin: NOW 16:00 (UTC 14:00). Drei 2-h-Blöcke, billigster zuerst.
    block_starts = [
        "2026-09-10T14:00:00+00:00",
        "2026-09-10T16:00:00+00:00",
        "2026-09-10T18:00:00+00:00",
        "2026-09-10T20:00:00+00:00",
    ]
    points = [
        {"timestamp": "2026-09-10T16:00:00+02:00", "q50": 1.60},
        {"timestamp": "2026-09-10T17:00:00+02:00", "q50": 1.61},
        {"timestamp": "2026-09-10T18:00:00+02:00", "q50": 1.62},
        {"timestamp": "2026-09-10T19:00:00+02:00", "q50": 1.63},
        {"timestamp": "2026-09-10T20:00:00+02:00", "q50": 1.64},
    ]
    # Block 0: 3 von 4 Draws ≥ 1 ct unter dem Anker (p_besser = 0.75) und
    # 3 von 4 Draws unter dem ±6-h-Umfeld (F3-P = 0.75).
    minima = [
        [1.67, 1.70, 1.71],
        [1.60, 1.71, 1.72],
        [1.70, 1.68, 1.72],
        [1.66, 1.71, 1.72],
    ]
    draws = {
        "n": 4,
        "block_minutes": 120,
        "blocks": [
            {"start": block_starts[i], "end": block_starts[i + 1]} for i in range(3)
        ],
        "minima": minima,
        "nowcast": [1.68, 1.69, 1.70, 1.71],
    }
    path = b4_settings.runtime / "engine/current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "published_at": NOW.isoformat(),
                "forecasts": [
                    {
                        "station_id": UID,
                        "city": "Frankfurt",
                        "fuel": "e10",
                        "origin": NOW.isoformat(),
                        "points": points,
                        "points_7d": points,
                        "draws_24h": draws,
                        "draws_7d": draws,
                    },
                    {
                        "station_id": OTHER,
                        "city": "Frankfurt",
                        "fuel": "e10",
                        "points": [],
                        "points_7d": [],
                        "draws_24h": {
                            "n": 4,
                            "block_minutes": 120,
                            "blocks": [],
                            "minima": [],
                            "nowcast": [1.60, 1.61, 1.62, 1.63],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    live = LiveData(b4_settings, query=query, clock=lambda: NOW)
    body = evaluate_decide(live, {"city": "Frankfurt", "fuel": "e10", "liters": 40})

    # Vor dem M7-Gate bleibt p_correct null — die Verteilungs-P wird aber
    # trotzdem berechnet und gespeichert (Brier braucht sie, um das Gate zu öffnen).
    assert body["primary"]["p_correct"] is None
    assert body["calibrated"] is False

    # F3-Fenster-P (§4.3): Block 0 (1.605 €) schlägt das ±6-h-Umfeld in 3/4 Draws.
    assert body["windows_today"][0]["p"] == 0.75
    assert body["windows_today"][0]["expected_saving_eur"] == 3.36
    assert body["windows_week"][0]["p"] == 0.75

    # F2-P_lohnt (§4.2): die günstigere Alternative lohnt in jedem Draw.
    assert body["alternatives_nearby"][0]["p_lohnt"] == 1.0

    # Der Snapshot speichert dieselbe P (p_besser = 0.75), nicht die Ledger-Quote.
    store = load_store(b4_settings)
    snap = store["episodes"][0]["snapshots"][0]
    assert snap["action"] == "wait"
    assert snap["p_besser"] == 0.75
    assert snap["p_correct"] == 0.75


def test_table_action_gates_use_distribution_p(b4_settings):
    """F1/F2-Gates rechnen mit p_besser/p_lohnt, nicht mit einer Ledger-Quote."""
    from app.decide import _table_action

    # Güte-Gate (§4.5 Schritt 1) hat Vorrang vor F1/F2 und unterdrückt
    # die Empfehlung bei rotem Rolling-PICP.
    quality_action, quality_badge, quality_reason = _table_action(
        1.70, 1.64, 2.40, None, 0.9, quality_gate="picp"
    )
    assert quality_action == "no_advice"
    assert quality_badge == "low"
    assert "Intervallquote" in quality_reason

    # Grauzone (§4.4): p_besser ∈ [40, 60] % → no_advice, ohne n-Hürde.
    action, _, reason = _table_action(1.70, 1.64, 2.40, None, 0.5)
    assert action == "no_advice"
    assert "50 %" in reason

    # F1: € ≥ 2,00 und p_besser ≥ 70 % → wait.
    assert _table_action(1.70, 1.64, 2.40, None, 0.8)[0] == "wait"

    # Ohne Draws (p_besser None) entfällt das Prozent-Gate: €-Seite entscheidet.
    assert _table_action(1.70, 1.64, 2.40, None, None)[0] == "wait"
    assert _table_action(1.70, 1.695, 0.20, None, None)[0] == "refuel_now"

    # F2: netto ≥ Schwelle und p_lohnt ≥ elsewhere_p → refuel_elsewhere.
    alt = {"name": "Shell", "net_eur": 2.0, "p_lohnt": 0.8}
    assert _table_action(1.70, 1.64, 2.40, alt, 0.8)[0] == "refuel_elsewhere"
    # p_lohnt unter der Schwelle → F2-Zweig greift nicht, F1 entscheidet.
    alt_weak = {"name": "Shell", "net_eur": 2.0, "p_lohnt": 0.3}
    assert _table_action(1.70, 1.64, 2.40, alt_weak, 0.8)[0] == "wait"


def test_snapshot_collapse_rule(b4_settings):
    """Gleiche Advice + gleiche Station innerhalb 30 min aktualisiert denselben Snapshot."""
    t0 = NOW
    t1 = NOW + dt.timedelta(minutes=10)
    t2 = NOW + dt.timedelta(minutes=45)

    current_time = t0

    def query(cfg, flux):
        yield raw_price(current_time - dt.timedelta(minutes=5), UID, "Frankfurt", 1.65)

    live = LiveData(b4_settings, query=query, clock=lambda: current_time)

    # 1. Call at t0 -> creates episode + snap 1
    d1 = live.decide({"city": "Frankfurt", "fuel": "e10", "station_id": UID})
    ep_id = d1["episode"]["id"]
    from app.feedback import load_store

    store = load_store(b4_settings)
    assert len(store["episodes"]) == 1
    assert len(store["episodes"][0]["snapshots"]) == 1
    snap1_id = store["episodes"][0]["snapshots"][0]["id"]

    # 2. Call at t1 (10 min later, same advice) -> collapses into same snapshot
    current_time = t1
    live.clock = lambda: current_time
    d2 = live.decide({"city": "Frankfurt", "fuel": "e10", "station_id": UID})
    assert d2["episode"]["id"] == ep_id
    store = load_store(b4_settings)
    assert len(store["episodes"][0]["snapshots"]) == 1
    assert store["episodes"][0]["snapshots"][0]["id"] == snap1_id

    # 3. Call at t2 (45 min later) -> appends new snapshot
    current_time = t2
    live.clock = lambda: current_time
    live.decide({"city": "Frankfurt", "fuel": "e10", "station_id": UID})
    store = load_store(b4_settings)
    assert len(store["episodes"][0]["snapshots"]) == 2


def test_intent_and_due_prompt(b4_settings):
    """Intent 'wait' setzt Status 'waiting', nach Fensterende wird Status 'due'."""
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    server = make_server(b4_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        # Create episode
        _, d = _get_json(
            base + "/api/v1/decide?city=Frankfurt&fuel=e10&station_id=" + UID
        )
        ep_id = d["episode"]["id"]

        # POST intent 'wait'
        st, res = _post_json(
            base + f"/api/v1/episodes/{ep_id}/intent", {"intent": "wait"}
        )
        assert st == 200
        assert res["intent"] == "wait"
        assert res["status"] == "waiting"

        # GET /api/v1/episodes
        st_ep, ep_list = _get_json(base + "/api/v1/episodes")
        assert st_ep == 200
        assert ep_list["count"] >= 1

        # POST intent 'dismiss'
        st_dis, res_dis = _post_json(
            base + f"/api/v1/episodes/{ep_id}/intent", {"intent": "dismiss"}
        )
        assert st_dis == 200
        assert res_dis["status"] == "expired"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_fills_recording_and_compliance(b4_settings):
    """POST /api/v1/fills speichert Beleg und ordnet Compliance zu."""
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    server = make_server(b4_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        # Open episode first
        _get_json(base + "/api/v1/decide?city=Frankfurt&fuel=e10&station_id=" + UID)

        fill_payload = {
            "id": "fill-001",
            "station_id": UID,
            "station_name": "Station Alpha",
            "tanked_at": NOW.isoformat(),
            "clock_hour": 14.2,
            "liters": 45.0,
            "price_paid": 1.629,
            "fuel": "e10",
            "source": "explicit_now",
        }
        st, fill_res = _post_json(base + "/api/v1/fills", fill_payload)
        assert st == 200
        assert fill_res["id"] == "fill-001"
        assert fill_res["compliance"] in ("followed", "partial", "ignored", "unrelated")
        assert "saved_vs_always_now_eur" in fill_res

        # Idempotency test: posting same id again returns same record
        st2, fill_res2 = _post_json(base + "/api/v1/fills", fill_payload)
        assert st2 == 200
        assert fill_res2["id"] == "fill-001"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class _FakeLive:
    """Minimaler LiveData-Stub für ehrliches Settlement (beobachtete Preise)."""

    def __init__(self, points):
        self._points = points

    def series(self, station_id, city, fuel, hours=24):
        assert hours <= 168
        return {"points": self._points, "error_code": None}


def test_settlement_worker_job(b4_settings):
    """Settlement-Job (app.worker settlement) rechnet gegen beobachtete Preise ab."""
    from app.feedback import record_snapshot, load_store, settle_snapshots
    from app.worker import execute

    # Fenster gestern 17:30–20:30 Berlin = 15:30–17:30 UTC (September: UTC+2).
    window_start = dt.datetime(2026, 9, 9, 15, 30, tzinfo=dt.timezone.utc)
    window_end = dt.datetime(2026, 9, 9, 17, 30, tzinfo=dt.timezone.utc)
    emitted = dt.datetime(2026, 9, 9, 12, 0, tzinfo=dt.timezone.utc)

    snap_data = {
        "clock_hour": 14.0,
        "action": "wait",
        "city": "Frankfurt",
        "station_id": UID,
        "station_name": "Station Alpha",
        "price_now": 1.709,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "window_start_hour": 17.5,
        "window_end_hour": 20.5,
        "expected_price": 1.649,
        "expected_saving_eur": 2.40,
        "liters_assumed": 40.0,
        "fuel": "e10",
    }
    record_snapshot(b4_settings, snap_data, clock=lambda: emitted)

    # Beobachtete Preise: Tiefstpreis 1.649 im Fenster (win), der billigere
    # Punkt um 19:00 UTC liegt außerhalb (Fenster + 60 min Slack endet 18:30).
    live = _FakeLive(
        [
            {
                "timestamp": "2026-09-09T15:45:00+00:00",
                "status": "open",
                "price": 1.679,
            },
            {
                "timestamp": "2026-09-09T16:30:00+00:00",
                "status": "open",
                "price": 1.649,
            },
            {
                "timestamp": "2026-09-09T16:45:00+00:00",
                "status": "closed",
                "price": None,
            },
            {
                "timestamp": "2026-09-09T19:00:00+00:00",
                "status": "open",
                "price": 1.599,
            },
        ]
    )

    result = settle_snapshots(b4_settings, live_data=live, clock=lambda: NOW)
    assert result["status"] == "ok"
    assert result["settled_count"] == 1

    store = load_store(b4_settings)
    assert len(store["settlements"]) == 1
    settlement = store["settlements"][0]
    assert settlement["outcome"] == "win"
    assert settlement["p_realized"] == 1.649
    assert settlement["regret_eur"] == 0.0

    # Auch der execute()-Wrapper muss durchlaufen (idempotent: nichts mehr offen).
    outcome = execute("settlement", b4_settings)
    assert outcome["state"] == "success"
    assert outcome["error_code"] is None


def test_settlement_pending_without_live_data(b4_settings):
    """Ohne beobachtete Preise bleibt ein Snapshot pending (kein Self-Grading)."""
    from app.feedback import record_snapshot, load_store, settle_snapshots

    window_start = dt.datetime(2026, 9, 9, 15, 30, tzinfo=dt.timezone.utc)
    window_end = dt.datetime(2026, 9, 9, 17, 30, tzinfo=dt.timezone.utc)
    emitted = dt.datetime(2026, 9, 9, 12, 0, tzinfo=dt.timezone.utc)
    snap_data = {
        "clock_hour": 14.0,
        "action": "refuel_now",
        "city": "Frankfurt",
        "station_id": UID,
        "station_name": "Station Alpha",
        "price_now": 1.709,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "expected_price": 1.729,
        "expected_saving_eur": 0.0,
        "liters_assumed": 40.0,
        "fuel": "e10",
    }
    record_snapshot(b4_settings, snap_data, clock=lambda: emitted)

    # Fenster + Lag vorüber, aber live_data=None und noch innerhalb der
    # 6-h-Gnadenfrist → pending, kein Settlement (kein Self-Grading).
    pending_clock = dt.datetime(2026, 9, 9, 19, 0, tzinfo=dt.timezone.utc)
    result = settle_snapshots(b4_settings, live_data=None, clock=lambda: pending_clock)
    assert result["status"] == "ok"
    assert result["settled_count"] == 0
    store = load_store(b4_settings)
    assert store["settlements"] == []


def test_stats_summary_three_layers(b4_settings):
    """GET /api/v1/stats/summary liefert die 3 Schichten (Backtest, Live-Advice, Wallet)."""
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    server = make_server(b4_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        status, body = _get_json(base + "/api/v1/stats/summary?city=Frankfurt&fuel=e10")
        assert status == 200
        assert "backtest" in body
        assert "live_advice" in body
        assert "wallet" in body
        assert "quality_metrics" in body

        # Schicht A Backtest
        bt = body["backtest"]
        assert "stationScores" in bt
        assert "totals" in bt
        assert "calibration" in bt
        assert "evalRows" in bt
        assert "models" in bt
        assert "scan" in bt

        # Schicht B Live-Advice
        la = body["live_advice"]
        assert "n" in la
        assert "reliability" in la
        assert len(la["reliability"]) == 10

        # Schicht C Wallet
        w = body["wallet"]
        assert "n_fills" in w
        assert "saved_eur" in w
        assert "wh_hours" in w
        assert len(w["wh_hours"]) == 24

        # Güte-Kacheln
        qm = body["quality_metrics"]
        assert "top3_hit_rate" in qm
        assert "mase_sprungfrei" in qm
        assert "picp_95" in qm
        assert "cusum_drift" in qm

        # Test day series endpoint GET /api/v1/day
        st_day, day_body = _get_json(base + f"/api/v1/day?station={UID}&day=2026-09-10")
        assert st_day == 200
        assert day_body["ok"] is True
        assert "points" in day_body
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_stats_summary_live_phase_counts_published_policies(b4_settings):
    """Live-Phase in stats_summary kommt aus den Engine-Policies — nicht aus der GUI.

    Regression: Die Kalibrierungs-Kachel zeigte „Noch 21 von 21 bewerteten
    Live-Tagen“, obwohl die Engine eine 90-Tage-Übergangsregel zählt und die
    Oberfläche gar keine Policies hatte. Fehlende Policies müssen fehlende
    Daten bleiben (null), sonst erfindet die UI einen Countdown (§0.4).
    """
    path = b4_settings.runtime / "engine/current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "published_at": "2026-09-11T01:00:00+00:00",
                "forecasts": [],
                "policies": [
                    {
                        "city": "Frankfurt",
                        "station_id": UID,
                        "fuel": "e10",
                        "mode": "bootstrap",
                        "good_complete_live_days": 2,
                        "required_complete_live_days": 90,
                        "min_daily_coverage": 0.95,
                    },
                    {
                        "city": "Frankfurt",
                        "station_id": OTHER,
                        "fuel": "e10",
                        "mode": "bootstrap",
                        # Die schwächste Station entscheidet — hier die bessere.
                        "good_complete_live_days": 7,
                        "required_complete_live_days": 90,
                        "min_daily_coverage": 0.95,
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    phase = live.stats_summary({"city": "Frankfurt", "fuel": "e10"})["live_phase"]
    assert phase["good_complete_days"] == 2
    assert phase["best_complete_days"] == 7
    assert phase["required_complete_days"] == 90
    assert phase["days_missing"] == 88
    assert phase["stations"] == 2
    assert phase["live_only_stations"] == 0
    assert phase["complete"] is False
    assert phase["as_of"] == "2026-09-11T01:00:00+00:00"


def test_stats_summary_live_phase_without_publication(b4_settings):
    """Ohne Engine-Veröffentlichung ist live_phase null — kein 0-von-N-Countdown."""
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    summary = live.stats_summary({"city": "Frankfurt", "fuel": "e10"})
    assert summary["live_phase"] is None


def test_stats_summary_live_phase_needs_consistent_threshold(b4_settings):
    """Gemischte Schwellen (andere live_only_days) lassen sich nicht zu einem
    ehrlichen Nenner verdichten — dann gibt es keine Tageszahl, auch keine halbe."""
    path = b4_settings.runtime / "engine/current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "published_at": NOW.isoformat(),
                "policies": [
                    {
                        "city": "Frankfurt",
                        "station_id": UID,
                        "fuel": "e10",
                        "mode": "bootstrap",
                        "good_complete_live_days": 2,
                        "required_complete_live_days": 90,
                    },
                    {
                        "city": "Frankfurt",
                        "station_id": OTHER,
                        "fuel": "e10",
                        "mode": "bootstrap",
                        "good_complete_live_days": 2,
                        "required_complete_live_days": 21,
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    summary = live.stats_summary({"city": "Frankfurt", "fuel": "e10"})
    assert summary["live_phase"] is None


def test_stats_summary_no_demo_data(b4_settings):
    """Stats Summary darf keine Demo-Daten erfinden, wenn keine Engine läuft.

    Konzept §14: „Die App kennt ihr eigenes Können." Wenn die
    Engine-Veröffentlichung fehlt, sind alle Felder null/leer,
    nicht fest verdrahtet (68 %, 0.74, 94.5, 0.62σ).
    """
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    server = make_server(b4_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        _, body = _get_json(base + "/api/v1/stats/summary?city=Frankfurt&fuel=e10")

        qm = body["quality_metrics"]
        # None ist die korrekte Antwort, solange keine Engine-Veröffentlichung existiert
        assert qm["top3_hit_rate"] is None
        assert qm["mase_sprungfrei"] is None
        assert qm["picp_95"] is None
        assert qm["cusum_drift"]["status"] == "unknown"
        assert qm["cusum_drift"]["max_cusum"] is None

        bt = body["backtest"]
        # Keine Demo-Stationen erfinden
        assert bt["stationScores"] == []
        assert bt["stations"] == []
        # error_code signalisiert ehrlich, was fehlt
        assert bt.get("error_code") in ("polling_missing", "backtest_not_available")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_day_series_no_demo_data(b4_settings):
    """GET /api/v1/day darf ohne Engine keine Demo-Tageskurve liefern.

    Die alten hartkodierten Punkte (172.5, 173.9, …) sind weg.
    """
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    day_body = live.day_series(UID, "2026-09-10")
    # Ohne Engine: leere Liste, ok=True (kein Fehler, einfach keine Daten)
    assert day_body["ok"] is True
    assert day_body["points"] == []
    assert day_body.get("source") in (None, "engine")


def test_gray_zone_percent_is_times_100():
    """F1: P intern 0–1, Anzeige ×100 (0,5 → 50 %, nicht 0 %).

    ``p_besser`` ist jetzt die Verteilungs-P (§4.1), nicht mehr die
    Ledger-Quote — die Grauzone liest sie direkt, ohne n-Hürde.
    """
    from app.decide import _table_action

    _, _, reason = _table_action(1.70, 1.64, 2.40, None, 0.5)
    assert "50 %" in reason
    assert "P ≈ 0 %" not in reason
    assert "0.5 %" not in reason


def test_m7_gate_thresholds_come_from_the_ledger_not_the_calendar(b4_settings):
    """M7 ist ein Zähl-Gate — Schwellen und Stand kommen aus dem Advice-Ledger.

    Regression: Die Kalibrierungs-Kachel zeigte den Countdown der
    90-Tage-Übergangsregel (live_only_days) unter der M7-Freigabe, als wäre die
    Tageszahl ihr Nenner. Bei ~1 Empfehlung/Tag wären 100 Settlements ~100
    Tage; M7 soll aber nach ~4 Wochen Live-Betrieb schaltbar sein (§13). Die
    GUI bekommt den Zähl-Schwellwert deshalb mit dem Payload und muss die
    Übergangsregel nicht mehr zweckentfremden.
    """
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    advice = live.stats_summary({"city": "Frankfurt", "fuel": "e10"})["live_advice"]
    assert advice["min_recommendations"] == M7_MIN_RECOMMENDATIONS == 100
    assert advice["brier_threshold"] == M7_BRIER_THRESHOLD == 0.25
    assert advice["gate_status"] == ("Kalibrierung steht aus (n=0 < 100 Empfehlungen)")
    # Kein Tageszähler im Gate-Text: Die Übergangsregel ist eine andere Freigabe.
    assert "Tage" not in advice["gate_status"]


def test_m7_gate_calibrated_counts_settlements_and_brier():
    """Ab n ≥ 100 mit Brier < 0,25 ist das Gate offen (Konzept §0.4)."""
    snaps = [{"id": f"s{i}", "action": "wait", "p_correct": 0.9} for i in range(100)]
    store = {
        "episodes": [{"id": "ep", "snapshots": snaps}],
        "settlements": [{"snapshot_id": f"s{i}", "outcome": "win"} for i in range(100)],
    }
    advice = compute_advice_stats(store)
    assert advice["n"] == 100
    assert advice["brier_30d"] == 0.01
    assert advice["calibrated"] is True
    assert advice["gate_status"] == "Kalibriert (n=100, Brier 0,01 < 0,25)"


def test_m7_gate_is_unmeasurable_without_probability():
    """n ≥ 100 ohne P-Schätzung heißt „nicht messbar“ — nicht „kalibriert“.

    Snapshots ohne gespeichertes ``p_correct`` fallen aus Zähler und Nenner des
    Brier-Scores; „kalibriert“ zu melden wäre erfunden (§0.4).
    """
    store = {
        "episodes": [],
        "settlements": [{"snapshot_id": f"s{i}", "outcome": "win"} for i in range(100)],
    }
    advice = compute_advice_stats(store)
    assert advice["n"] == 100
    assert advice["n_brier"] == 0
    assert advice["brier_30d"] is None
    assert advice["calibrated"] is False
    assert advice["gate_status"] == (
        "Kalibrierung nicht messbar (n=100, keine P-Schätzung im Ledger)"
    )


# --- P1/P2-Fixes aus Prüfstand §3 / TIEFENANALYSE §6 -----------------------


def test_fills_validation_rejects_garbage(b4_settings):
    """Belege mit Müll (Liter/Preis/Sorte/Station) bekommen 4xx statt 200.

    Regression: POST /api/v1/fills {\"liters\":-5} wurde mit 200 quittiert
    und verbuchte einen erfundenen Preis (Prüfstand §3.1).
    """
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    server = make_server(b4_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        cases = [
            (
                {"station_id": UID, "liters": -5, "price_paid": 1.6},
                400,
                "invalid_liters",
            ),
            (
                {"station_id": UID, "liters": 40, "price_paid": 0.0},
                400,
                "invalid_price",
            ),
            (
                {
                    "station_id": UID,
                    "liters": 40,
                    "price_paid": 1.6,
                    "fuel": "hydrogen",
                },
                400,
                "invalid_fuel",
            ),
            (
                {"station_id": "custom", "liters": 40, "price_paid": 1.6},
                404,
                "unknown_station",
            ),
            ({"station_id": UID, "liters": 40}, 400, "price_not_available"),
        ]
        for payload, status, code in cases:
            with pytest.raises(urllib.error.HTTPError) as error:
                _post_json(base + "/api/v1/fills", payload)
            assert error.value.code == status, (payload, error.value.code)
            body = json.loads(error.value.read())
            assert body["error_code"] == code, (payload, body)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_fills_nowcast_when_price_missing(b4_settings):
    """Fehlt price_paid, wird der Nowcast-Preis genommen (kein 1,70-Default)."""

    def query(cfg, flux):
        yield raw_price(NOW - dt.timedelta(minutes=5), UID, "Frankfurt", 1.689)

    live = LiveData(b4_settings, query=query, clock=lambda: NOW)
    server = make_server(b4_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        status, res = _post_json(
            base + "/api/v1/fills",
            {"station_id": UID, "liters": 40, "fuel": "e10"},
        )
        assert status == 200
        assert res["price_paid"] == 1.689
        assert res["price_source"] == "nowcast"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_ignored_fill_does_not_close_episode(b4_settings):
    """Ein nicht befolgter Beleg (fremde Station, außerhalb des Fensters)
    beendet die Advice-Folge nicht (Prüfstand §3.2: vorher schloss JEDER
    Beleg die Episode, auch ein fachlich fremder)."""
    from app.feedback import load_store, record_fill, record_snapshot

    emitted = NOW
    snap_data = {
        "clock_hour": 14.0,
        "action": "wait",
        "city": "Frankfurt",
        "station_id": UID,
        "station_name": "Station Alpha",
        "price_now": 1.709,
        "window_start": (NOW + dt.timedelta(hours=3)).isoformat(),
        "window_end": (NOW + dt.timedelta(hours=6)).isoformat(),
        "expected_price": 1.649,
        "expected_saving_eur": 2.40,
        "liters_assumed": 40.0,
        "fuel": "e10",
    }
    _, ep = record_snapshot(b4_settings, snap_data, clock=lambda: emitted)
    assert ep["status"] == "open"

    # Tanken an einer fremden Station und außerhalb des Fensters → ignored.
    fill = record_fill(
        b4_settings,
        {
            "station_id": OTHER,
            "liters": 40,
            "price_paid": 1.60,
            "fuel": "e10",
            "tanked_at": (NOW + dt.timedelta(hours=30)).isoformat(),
        },
        live_data=None,
        clock=lambda: NOW + dt.timedelta(hours=30),
    )
    assert fill["compliance"] == "ignored"
    store = load_store(b4_settings)
    ep_after = next(e for e in store["episodes"] if e["id"] == ep["id"])
    assert ep_after["status"] == "open"


def test_followed_fill_closes_episode(b4_settings):
    """Ein befolgter Beleg (folgt der Warte-Empfehlung) schließt die Folge."""
    from app.feedback import load_store, record_fill, record_snapshot

    window_start = NOW + dt.timedelta(hours=3)
    window_end = NOW + dt.timedelta(hours=6)
    snap_data = {
        "clock_hour": 14.0,
        "action": "wait",
        "city": "Frankfurt",
        "station_id": UID,
        "station_name": "Station Alpha",
        "price_now": 1.709,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "expected_price": 1.649,
        "expected_saving_eur": 2.40,
        "liters_assumed": 40.0,
        "fuel": "e10",
    }
    _, ep = record_snapshot(b4_settings, snap_data, clock=lambda: NOW)
    fill = record_fill(
        b4_settings,
        {
            "station_id": UID,
            "liters": 40,
            "price_paid": 1.649,
            "fuel": "e10",
            "tanked_at": window_start.isoformat(),
        },
        live_data=None,
        clock=lambda: window_start,
    )
    assert fill["compliance"] == "followed"
    store = load_store(b4_settings)
    ep_after = next(e for e in store["episodes"] if e["id"] == ep["id"])
    assert ep_after["status"] == "resolved"


def test_snapshot_persists_trip_mode_and_latest_by(b4_settings):
    """Fahrtmodus + Deadline dürfen nicht auf dem Weg in den Store verloren gehen."""
    from app.feedback import load_store, record_snapshot

    _, ep = record_snapshot(
        b4_settings,
        {
            "clock_hour": 14.0,
            "action": "wait",
            "city": "Frankfurt",
            "station_id": UID,
            "price_now": 1.709,
            "fuel": "e10",
            "trip_mode": "dedicated",
            "latest_by": "2026-09-10T20:00:00+02:00",
        },
        clock=lambda: NOW,
    )
    store = load_store(b4_settings)
    snap = store["episodes"][0]["last_snapshot"]
    assert snap["trip_mode"] == "dedicated"
    assert snap["latest_by"] == "2026-09-10T20:00:00+02:00"
    assert ep["last_snapshot"]["trip_mode"] == "dedicated"


def test_store_too_large_errors_instead_of_silent_reset(b4_settings, monkeypatch):
    """Ein zu großer Store wird gemeldet, nicht still geleert (Prüfstand §3.5)."""
    from app import feedback
    from app.feedback import StoreTooLarge, feedback_path, load_store

    monkeypatch.setattr(feedback, "FEEDBACK_MAX_BYTES", 10)
    store_file = feedback_path(b4_settings)
    store_file.parent.mkdir(parents=True, exist_ok=True)
    store_file.write_text(
        json.dumps({"episodes": [{"id": "e1"}], "fills": [], "settlements": []})
    )

    with pytest.raises(StoreTooLarge):
        load_store(b4_settings)

    # Auch die API liefert ehrlich store_too_large statt record_fill_failed.
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    assert live.record_fill({"station_id": UID, "liters": 40, "price_paid": 1.6}) == {
        "error_code": "store_too_large"
    }


def test_retention_prunes_and_archives(b4_settings):
    """Einträge älter als 90 Tage werden ausgelagert (Rotation statt 10-MB-Knall)."""
    from app.feedback import (
        FEEDBACK_RETENTION_DAYS,
        feedback_archive_path,
        load_store,
    )

    # Wanduhr-unabhängig: „alt" liegt sicher vor der 90-Tage-Retention.
    wall = dt.datetime.now(dt.timezone.utc)
    old = wall - dt.timedelta(days=FEEDBACK_RETENTION_DAYS + 30)
    from app.feedback import locked_store

    # Direkt einen alten + einen frischen Eintrag in den Store legen.
    with locked_store(b4_settings) as store:
        store["episodes"].append(
            {
                "id": "ep_old",
                "opened_at": old.isoformat(),
                "status": "resolved",
                "snapshots": [],
            }
        )
        store["episodes"].append(
            {
                "id": "ep_new",
                "opened_at": wall.isoformat(),
                "status": "open",
                "snapshots": [],
            }
        )

    store = load_store(b4_settings)
    ids = [e["id"] for e in store["episodes"]]
    assert "ep_old" not in ids
    assert "ep_new" in ids
    archive = feedback_archive_path(b4_settings)
    assert archive.is_file()
    lines = archive.read_text(encoding="utf-8").splitlines()
    assert any("ep_old" in line for line in lines)
    assert not any("ep_new" in line for line in lines)


def test_advice_stats_uses_real_30d_window():
    """brier_30d/n sind 30 Tage, das M7-Gate bleibt ein Allzeit-Zähl-Gate."""
    from app.feedback import compute_advice_stats

    base = dt.datetime(2026, 9, 10, 12, 0, tzinfo=dt.timezone.utc)
    snaps = [{"id": f"s{i}", "action": "wait", "p_correct": 0.9} for i in range(3)]
    store = {
        "episodes": [{"id": "ep", "snapshots": snaps}],
        "settlements": [
            {"snapshot_id": "s0", "outcome": "win", "settled_at": base.isoformat()},
            {"snapshot_id": "s1", "outcome": "loss", "settled_at": base.isoformat()},
            # 60 Tage alt → raus aus dem 30-Tage-Fenster
            {
                "snapshot_id": "s2",
                "outcome": "loss",
                "settled_at": (base - dt.timedelta(days=60)).isoformat(),
            },
        ],
    }
    advice = compute_advice_stats(store, now=base)
    assert advice["n"] == 2
    assert advice["n_brier"] == 2
    assert advice["n_all"] == 3  # Allzeit-Gate zählt alle drei
    assert advice["wins"] == 1
    assert advice["brier_30d"] is not None


def test_wallet_stats_uses_real_30d_window():
    from app.feedback import compute_wallet_stats

    base = dt.datetime(2026, 9, 10, 12, 0, tzinfo=dt.timezone.utc)
    store = {
        "fills": [
            {
                "tanked_at": base.isoformat(),
                "compliance": "followed",
                "saved_vs_always_now_eur": 2.0,
                "clock_hour": 14,
            },
            {
                "tanked_at": (base - dt.timedelta(days=60)).isoformat(),
                "compliance": "followed",
                "saved_vs_always_now_eur": 100.0,
                "clock_hour": 14,
            },
        ]
    }
    wallet = compute_wallet_stats(store, now=base)
    assert wallet["n_fills"] == 1
    assert wallet["saved_eur"] == 2.0


def test_gate_requires_p_population_not_total_n():
    """n=100 ohne P-Schätzung öffnet das Gate nicht (gleiche Grundgesamtheit).

    Vorher verglich das Gate Gesamt-n mit dem Brier über die P-Teilmenge
    (Prüfstand §3.6): bei n=100, n_brier=3 wäre „kalibriert" gemeldet worden.
    """
    from app.feedback import compute_advice_stats

    store = {
        "episodes": [],
        "settlements": [{"snapshot_id": f"s{i}", "outcome": "win"} for i in range(100)],
    }
    advice = compute_advice_stats(store)
    assert advice["calibrated"] is False
    assert "P-Schätzung" in advice["gate_status"]


def _delete_json(url):
    req = urllib.request.Request(url, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as exc:
        return exc.code, json.load(exc)


def test_void_fill_flags_and_audits(b4_settings):
    """A3: DELETE /api/v1/fills/{id} storniert (Flag + Audit), löscht nicht."""
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    server = make_server(b4_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        payload = {
            "id": "fill-void-1",
            "station_id": UID,
            "station_name": "Station Alpha",
            "tanked_at": NOW.isoformat(),
            "liters": 40.0,
            "price_paid": 1.629,
            "fuel": "e10",
            "source": "prompt",
        }
        st, created = _post_json(base + "/api/v1/fills", payload)
        assert st == 200
        assert not created.get("voided")

        # Storno setzt Flag statt Löschen.
        st, voided = _delete_json(base + "/api/v1/fills/fill-void-1")
        assert st == 200
        assert voided["id"] == "fill-void-1"
        assert voided["voided"] is True
        assert "voided_at" in voided

        # Idempotent: zweites Storno ändert nichts (200, kein neuer Audit-Satz).
        st2, again = _delete_json(base + "/api/v1/fills/fill-void-1")
        assert st2 == 200
        assert again["voided"] is True

        # Unbekannter Beleg: ehrlich 404.
        st3, missing = _delete_json(base + "/api/v1/fills/nicht-da")
        assert st3 == 404
        assert missing["error_code"] == "fill_not_found"

        # Verlauf listet den Beleg inkl. voided-Flag und Audit-Spur.
        _, listing = _get_json(base + "/api/v1/fills")
        assert listing["count"] == 1
        assert listing["fills"][0]["voided"] is True

        from app.feedback import load_store

        store = load_store(b4_settings)
        assert store["audit"][0]["action"] == "void_fill"
        assert store["audit"][0]["fill_id"] == "fill-void-1"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_voided_fill_leaves_wallet_balance(b4_settings):
    """A3: ein stornierter Beleg verzerrt die Bilanz nicht mehr."""
    from app.feedback import compute_wallet_stats, load_store, void_fill

    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    live.record_fill(
        {
            "id": "fill-ok",
            "station_id": UID,
            "liters": 40.0,
            "price_paid": 1.629,
            "fuel": "e10",
        }
    )
    live.record_fill(
        {
            "id": "fill-wrong",
            "station_id": UID,
            "liters": 40.0,
            "price_paid": 1.999,
            "fuel": "e10",
        }
    )
    before = compute_wallet_stats(load_store(b4_settings), now=NOW)
    assert before["n_fills"] == 2

    void_fill(b4_settings, "fill-wrong", clock=lambda: NOW)

    store = load_store(b4_settings)
    after = compute_wallet_stats(store, now=NOW)
    assert after["n_fills"] == 1
    assert after["last_fill"]["id"] == "fill-ok"


def test_fills_csv_export(b4_settings):
    """A6: GET /api/v1/fills.csv liefert ;-getrenntes CSV mit deutschem Komma."""
    live = LiveData(b4_settings, query=lambda *_: [], clock=lambda: NOW)
    live.record_fill(
        {
            "id": "fill-csv-1",
            "station_id": UID,
            "station_name": "Station Alpha",
            "liters": 45.5,
            "price_paid": 1.629,
            "fuel": "e10",
        }
    )
    server = make_server(b4_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        req = urllib.request.Request(base + "/api/v1/fills.csv")
        with urllib.request.urlopen(req, timeout=10) as r:
            assert r.headers["Content-Type"].startswith("text/csv")
            body = r.read().decode("utf-8")
        assert "getankt_am" in body
        assert "fill-csv-1" in body
        assert "45,50" in body
        assert "1,63" in body
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
