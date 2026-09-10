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
