"""B5 — Konzept-Lücken, die nach B3/B4 noch offen waren.

Getestet werden die Bausteine, die das Konzept ausdrücklich nennt:

- ``latest_by``: Horizont [jetzt, T_max] für F1/F3 (§4.1, §4.3, §11.1)
- Fahrtmodus ``onroute``/``dedicated`` mit Heimatkoordinate (§10, §11.1)
- M7-Schwellen-Nachzug aus dem Advice-Ledger (§5.5, §13 M7)
- Rate-Limit + API-Key der TankPuls-API (§11)
- Deprecation/Sunset-Header auf den alten Alltags-Routen (§11.3, M5)
"""

import datetime as dt
import json
import threading
import urllib.error
import urllib.request

import pytest

from app.config import Settings
from app.data import LiveData
from app.decide import _parse_deadline, _today_windows, _week_windows
from app.server import make_server
from app.thresholds import (
    DEFAULT_THRESHOLDS,
    active_thresholds,
    suggest_thresholds,
)

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
NOW = dt.datetime(2026, 9, 10, 14, 0, tzinfo=dt.timezone.utc)
BERLIN = dt.timezone(dt.timedelta(hours=2))


@pytest.fixture
def settings_with_prices(tmp_path):
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
                                "lat": 50.30,
                                "lon": 8.90,
                            },
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
        rate_limit_anon_per_min=3,
        rate_limit_key_per_min=10,
        api_keys=("test-key",),
    )


def price_row(uid, price, age_minutes=5):
    return {
        "_time": (NOW - dt.timedelta(minutes=age_minutes)).isoformat(),
        "city": "Frankfurt",
        "station_id": uid,
        "station": "Station",
        "status": "open",
        "e10": str(price),
    }


def query(cfg, flux):
    yield price_row(UID, 1.689)
    yield price_row(OTHER, 1.609)


def _get(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.status, json.load(response), dict(response.headers)


# --- latest_by (§4.1, §4.3, §11.1) ---------------------------------------


def test_parse_deadline_reads_naive_as_berlin():
    assert _parse_deadline(None) is None
    assert _parse_deadline("") is None
    assert _parse_deadline("garbage") is False
    stamp = _parse_deadline("2026-09-10T18:30")
    assert stamp is not None and stamp.hour == 18 and stamp.utcoffset() is not None
    aware = _parse_deadline("2026-09-10T18:30:00+02:00")
    assert aware == dt.datetime(2026, 9, 10, 18, 30, tzinfo=BERLIN)


def test_latest_by_cuts_windows_after_deadline():
    base = dt.datetime(2026, 9, 10, 12, 0, tzinfo=dt.timezone.utc)

    def point(hour_utc):
        stamp = base + dt.timedelta(hours=hour_utc)
        return {"timestamp": stamp.isoformat(), "q50": 1.60}

    points = [point(1), point(2), point(5), point(6), point(9)]
    all_windows = _today_windows(points, base)
    assert all_windows, "ohne Deadline bleiben Fenster übrig"
    # Berlin: base 12:00 UTC = 14:00 Berlin; 18:00 Berlin = 16:00 UTC (+4 h)
    cutoff = base + dt.timedelta(hours=4)
    cut = _today_windows(points, base, cutoff)
    assert len(cut) < len(all_windows)
    assert all(dt.datetime.fromisoformat(window["end"]) <= cutoff for window in cut)
    # Vor dem ersten Fenster bleibt nichts — und nichts wird erfunden.
    assert _today_windows(points, base, base) == []


def test_week_windows_respect_deadline():
    base = dt.datetime(2026, 9, 10, 12, 0, tzinfo=dt.timezone.utc)
    points = [
        {"timestamp": (base + dt.timedelta(days=offset)).isoformat(), "q50": 1.60}
        for offset in range(1, 6)
    ]
    assert len(_week_windows(points)) == 3
    assert len(_week_windows(points, base + dt.timedelta(days=2))) == 2
    assert _week_windows(points, base) == []


def test_decide_rejects_broken_latest_by(settings_with_prices):
    live = LiveData(settings_with_prices, query=query, clock=lambda: NOW)
    from app.decide import evaluate_decide

    with pytest.raises(ValueError, match="invalid_latest_by"):
        evaluate_decide(live, {"city": "Frankfurt", "latest_by": "morgen"})


def test_decide_accepts_latest_by_and_reports_context(settings_with_prices):
    from app.decide import evaluate_decide

    live = LiveData(settings_with_prices, query=query, clock=lambda: NOW)
    payload = evaluate_decide(
        live,
        {
            "city": "Frankfurt",
            "liters": 40,
            "latest_by": "2026-09-10T20:00:00+02:00",
        },
    )
    assert payload["context"]["latest_by"].startswith("2026-09-10")
    assert payload["primary"]["action"] == "no_advice"
    assert payload["context"]["horizon_cut"] is False  # ohne Prognose kein Schnitt


# --- Fahrtmodus (§10) ------------------------------------------------------


def test_decide_dedicated_mode_costs_the_round_trip(settings_with_prices):
    from app.decide import evaluate_decide

    live = LiveData(settings_with_prices, query=query, clock=lambda: NOW)
    onroute = evaluate_decide(
        live,
        {"city": "Frankfurt", "liters": 40, "station_id": UID},
    )
    dedicated = evaluate_decide(
        live,
        {
            "city": "Frankfurt",
            "liters": 40,
            "station_id": UID,
            "mode": "dedicated",
            "home_lat": 50.11,
            "home_lon": 8.68,
        },
    )
    assert onroute["context"]["trip_mode"] == "onroute"
    assert dedicated["context"]["trip_mode"] == "dedicated"
    assert dedicated["context"]["home_used"] is True
    alt_onroute = onroute["alternatives_nearby"][0]
    alt_dedicated = dedicated["alternatives_nearby"][0]
    assert alt_dedicated["trip_mode"] == "dedicated"
    # Extrafahrt: Hin + Rück kosten mehr als der reine Mehrweg.
    assert alt_dedicated["detour_km"] > alt_onroute["detour_km"]
    assert alt_dedicated["net_eur"] < alt_onroute["net_eur"]


def test_decide_rejects_broken_mode_and_home(settings_with_prices):
    from app.decide import evaluate_decide

    live = LiveData(settings_with_prices, query=query, clock=lambda: NOW)
    with pytest.raises(ValueError, match="invalid_mode"):
        evaluate_decide(live, {"city": "Frankfurt", "mode": "zu-fuss"})
    with pytest.raises(ValueError, match="invalid_home"):
        evaluate_decide(live, {"city": "Frankfurt", "home_lat": 1.0, "home_lon": 2.0})


# --- M7-Schwellen-Nachzug (§5.5, §13) ------------------------------------


def test_suggestion_needs_sample_size():
    proposal = suggest_thresholds({"wait_n": 3, "hit_wait": 0.2})
    assert proposal["changed"] is False
    assert proposal["thresholds"] == DEFAULT_THRESHOLDS
    assert any("Stichprobe" in text for text in proposal["reasons"])


def test_weak_wait_hit_rate_tightens_gates():
    proposal = suggest_thresholds(
        {"wait_n": 60, "hit_wait": 0.55, "now_n": 60, "hit_now": 0.9}
    )
    assert proposal["changed"] is True
    thresholds = proposal["thresholds"]
    assert thresholds["wait_p_high"] > DEFAULT_THRESHOLDS["wait_p_high"]
    assert thresholds["wait_eur_high"] > DEFAULT_THRESHOLDS["wait_eur_high"]
    assert any("WARTEN" in text for text in proposal["reasons"])


def test_strong_wait_hit_rate_loosens_towards_defaults():
    tightened = dict(DEFAULT_THRESHOLDS, wait_p_high=0.85, wait_eur_high=4.0)
    proposal = suggest_thresholds(
        {"wait_n": 60, "hit_wait": 0.95, "now_n": 60, "hit_now": 0.95},
        base=tightened,
    )
    assert proposal["thresholds"]["wait_p_high"] < tightened["wait_p_high"]
    # Nie unter die Startwerte: konservativ in beide Richtungen.
    assert proposal["thresholds"]["wait_p_high"] >= DEFAULT_THRESHOLDS["wait_p_high"]


def test_weak_now_hit_rate_opens_more_wait_windows():
    proposal = suggest_thresholds(
        {"wait_n": 60, "hit_wait": 0.8, "now_n": 60, "hit_now": 0.6}
    )
    assert proposal["thresholds"]["now_eur"] < DEFAULT_THRESHOLDS["now_eur"]
    assert proposal["thresholds"]["now_eur"] >= 0.5  # untere Grenze


def test_auto_apply_off_keeps_production_on_defaults():
    stats = {"wait_n": 60, "hit_wait": 0.4, "now_n": 60, "hit_now": 0.9}
    used, proposal = active_thresholds(stats, auto_apply=False)
    assert used == DEFAULT_THRESHOLDS
    assert proposal["applied"] is False
    used, proposal = active_thresholds(stats, auto_apply=True)
    assert used == proposal["thresholds"]
    assert proposal["applied"] is True


def test_stats_summary_exposes_tuning(settings_with_prices):
    """Die Werkstatt zeigt Vorschlag und Stichprobe, nicht nur eine Zahl."""
    from app.stats_summary import evaluate_stats_summary

    class Live:
        def __init__(self, settings):
            self.settings = settings

        def clock(self):
            return NOW

    payload = evaluate_stats_summary(
        Live(settings_with_prices), {"fuel": "e10", "city": "Frankfurt"}
    )
    tuning = payload["threshold_tuning"]
    assert tuning["targets"]["hit_wait"] == 0.70
    assert tuning["min_n"] >= 1
    assert payload["thresholds"] == DEFAULT_THRESHOLDS


# --- Rate-Limit & API-Key (§11) ------------------------------------------


def _serve(settings, live):
    server = make_server(settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, f"http://127.0.0.1:{server.server_port}"


def test_rate_limit_headers_and_429(settings_with_prices):
    live = LiveData(settings_with_prices, query=query, clock=lambda: NOW)
    server, thread, base = _serve(settings_with_prices, live)
    try:
        status, _, headers = _get(base + "/api/v1/health")
        assert status == 200
        assert headers.get("X-RateLimit-Limit") == "3"
        assert headers.get("X-RateLimit-Policy") == "anon"
        assert headers.get("X-RateLimit-Remaining") == "2"
        for _ in range(2):
            _get(base + "/api/v1/health")
        with pytest.raises(urllib.error.HTTPError) as error:
            _get(base + "/api/v1/health")
        assert error.value.code == 429
        assert error.value.headers.get("Retry-After")
        body = json.loads(error.value.read())
        assert body["error_code"] == "rate_limited"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_api_key_gets_higher_limit(settings_with_prices):
    live = LiveData(settings_with_prices, query=query, clock=lambda: NOW)
    server, thread, base = _serve(settings_with_prices, live)
    try:
        status, _, headers = _get(
            base + "/api/v1/health", headers={"X-Api-Key": "test-key"}
        )
        assert status == 200
        assert headers.get("X-RateLimit-Limit") == "10"
        assert headers.get("X-RateLimit-Policy") == "keyed"
        # Falscher Key zählt als anonym (kein Privileg ohne gültiges Geheimnis).
        _, _, wrong = _get(base + "/api/v1/health", headers={"X-Api-Key": "nope"})
        assert wrong.get("X-RateLimit-Policy") == "anon"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


# --- Deprecation-Header (§11.3, M5) --------------------------------------


def test_legacy_daily_routes_are_marked_deprecated(settings_with_prices):
    live = LiveData(settings_with_prices, query=query, clock=lambda: NOW)
    server, thread, base = _serve(settings_with_prices, live)
    try:
        _, _, headers = _get(base + "/api/v1/stations?city=Frankfurt&fuel=e10")
        assert headers.get("Deprecation") == "true"
        assert headers.get("Sunset")
        assert "/api/v1/decide" in headers.get("Link", "")
        # Werkstatt-Routen bleiben unmarkiert.
        _, _, health = _get(base + "/api/v1/health")
        assert "Deprecation" not in health
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


# --- Rate-Limit-Fixes (Prüfstand §3.3) -------------------------------------


def test_rate_limit_day_quota_retry_after_is_day_based():
    """Erschöpft das Tageskontingent, zeigt Retry-After bis zum Tages-Reset.

    Vorher antwortete Retry-After minutes-based, als könne der Client in 60 s
    weitermachen, obwohl der Tageszähler bis zu 24 h sperrt.
    """
    from app.ratelimit import RateLimiter

    limiter = RateLimiter(anon_per_min=1000, anon_per_day=3)
    allowed, _ = limiter.check(None, "10.0.0.1", now=0.0)
    assert allowed
    allowed, _ = limiter.check(None, "10.0.0.1", now=1.0)
    assert allowed
    allowed, _ = limiter.check(None, "10.0.0.1", now=2.0)
    assert allowed
    allowed, info = limiter.check(None, "10.0.0.1", now=3.0)
    assert not allowed
    # Tagesgrenze ist der Flaschenhals → Retry-After ≈ Rest des Tages.
    assert info["retry_after"] > 60


def test_rate_limiter_evicts_old_buckets():
    """Die Bucket-Map wächst nicht unbegrenzt (LRU-Eviction)."""
    from app.ratelimit import MAX_BUCKETS, RateLimiter

    limiter = RateLimiter(anon_per_min=1000, anon_per_day=10_000_000)
    for i in range(MAX_BUCKETS + 50):
        limiter.check(None, f"10.0.{i // 256}.{i % 256}", now=float(i))
    assert len(limiter._buckets) <= MAX_BUCKETS
