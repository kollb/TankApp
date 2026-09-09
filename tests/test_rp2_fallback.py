"""Tests für die RP2 Fallback-GUI + NAS-Proxy (rp2/fallback_gui.py).

Deckt ab:
  * Stationen-Metadaten aus polling.json (Namen statt UUIDs)
  * Live-Preise aus dem JSONL-Ringpuffer (neueste Zeile je Station, echtes Alter)
  * F1/F2/F3-Entscheidung aus echten Quantil-Prognosen (q025/q975-Logik)
  * Proxy-Verhalten: NAS online -> transparente Weiterleitung,
    NAS offline -> Fallback-GUI, ?fallback=1 erzwingt Fallback
"""

import datetime as dt
import importlib.util
import json
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

RP2_PATH = Path(__file__).resolve().parents[1] / "rp2" / "fallback_gui.py"

UID_A = "11111111-2222-3333-4444-555555555555"
UID_B = "6a7fe9a1-e30d-422e-a6a9-00bea6621c6f"
UID_C = "99999999-8888-7777-6666-555555555555"


def load_rp2_module():
    spec = importlib.util.spec_from_file_location("tankapp_rp2_fallback", RP2_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


rp2 = load_rp2_module()

UTC = dt.timezone.utc


def now_iso(minutes_ago: float = 0.0) -> str:
    return (dt.datetime.now(UTC) - dt.timedelta(minutes=minutes_ago)).isoformat()


def write_poll_file(poll_dir: Path, lines: list[dict], day_offset: int = 0) -> Path:
    poll_dir.mkdir(parents=True, exist_ok=True)
    day = (dt.datetime.now() - dt.timedelta(days=day_offset)).strftime("%Y-%m-%d")
    path = poll_dir / f"{day}.jsonl"
    path.write_text(
        "\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8"
    )
    return path


POLLING_JSON = {
    "sets": {
        "Gütersloh": {
            "label": "Gütersloh",
            "batch": [UID_A],
            "stations": [
                {
                    "uuid": UID_A,
                    "name": "Station Alpha",
                    "brand": "Aral",
                    "lat": 51.9,
                    "lon": 8.36,
                    "group": "Nähe",
                    "dist_km": 2.1,
                    "drive_min": 7.0,
                    "maps": "https://maps.example/alpha",
                }
            ],
        },
        "Frankfurt": {
            "label": "Frankfurt",
            "batch": [UID_B, UID_C],
            "stations": [
                {"uuid": UID_B, "name": "Station Beta", "brand": "Esso",
                 "lat": 50.11, "lon": 8.68, "group": "Nähe", "dist_km": 4.2,
                 "drive_min": 11.0},
                {"uuid": UID_C, "name": "Station Gamma", "brand": "Jet",
                 "lat": 50.10, "lon": 8.70, "group": "Umweg", "dist_km": 9.9,
                 "drive_min": 20.0},
            ],
        },
    }
}


def write_polling_json(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(POLLING_JSON, ensure_ascii=False), encoding="utf-8")
    return path


def forecast_points(base: float, origin: dt.datetime, hours: int = 26) -> list[dict]:
    """Stündliche Punkte: q025 < q10 < q50 < q90 < q975, danach leichter Dip."""
    out = []
    for h in range(hours):
        ts = origin + dt.timedelta(hours=h)
        dip = 0.0 if h < 14 else min(0.03, (h - 14) * 0.004)
        out.append({
            "timestamp": ts.isoformat(),
            "q025": round(base - 0.02 - dip, 3),
            "q10": round(base - 0.01 - dip, 3),
            "q50": round(base - dip, 3),
            "q90": round(base + 0.01 - dip, 3),
            "q975": round(base + 0.02 - dip, 3),
        })
    return out


def write_forecast_cache(cache_dir: Path, entries: list[dict], age_hours: float = 1.0) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / "last_forecasts.json"
    payload = {
        "generated_at": (dt.datetime.now(UTC) - dt.timedelta(hours=age_hours)).isoformat(),
        "_cached_at": dt.datetime.now(UTC).isoformat(),
        "count": len(entries),
        "forecasts": entries,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def make_ctx(tmp_path, *, nas_base=None, poll_lines=None, poll_day_offset=0,
             with_meta=True, with_forecast=True, ttl_offline=0.2, ttl_online=0.2):
    poll_dir = tmp_path / "poll"
    cache_dir = tmp_path / "cache"
    meta_path = tmp_path / "polling.json"
    template_dir = tmp_path / "templates"
    template_dir.mkdir(parents=True, exist_ok=True)
    (template_dir / "index.html").write_text(
        "MARKER: " + rp2.VERSION_MARKER, encoding="utf-8"
    )
    if poll_lines is not None:
        write_poll_file(poll_dir, poll_lines, day_offset=poll_day_offset)
    meta_candidates = [meta_path] if with_meta else [tmp_path / "missing.json"]
    if with_meta:
        write_polling_json(meta_path)
    if with_forecast:
        origin = dt.datetime.now(UTC) - dt.timedelta(hours=1)
        write_forecast_cache(
            cache_dir,
            [
                {"station_id": UID_A, "city": "Gütersloh", "fuel": "E10",
                 "origin": origin.isoformat(),
                 "points": forecast_points(1.71, origin)},
                {"station_id": UID_B, "city": "Frankfurt", "fuel": "E10",
                 "origin": origin.isoformat(),
                 "points": forecast_points(1.76, origin)},
            ],
        )
    nas_state = (
        rp2.NasState(nas_base, ttl_online=ttl_online, ttl_offline=ttl_offline,
                     timeout=1.0)
        if nas_base
        else rp2.NasState(None, ttl_online=ttl_online, ttl_offline=ttl_offline)
    )
    return rp2.Context(
        poll_dir=poll_dir,
        cache_file=cache_dir / "last_forecasts.json",
        meta_candidates=meta_candidates,
        template_dir=template_dir,
        nas_base=nas_base,
        nas_health=f"{nas_base}/api/v1/health" if nas_base else None,
        nas_state=nas_state,
    )


def default_poll_lines():
    return [
        {"fetched_at": now_iso(12), "source": "test", "city": "Gütersloh",
         "prices": {UID_A: {"status": "open", "e10": 1.699, "e5": 1.819,
                            "diesel": 1.489},
                    UID_B: {"status": "open", "e10": 1.749, "diesel": 1.539}}},
        {"fetched_at": now_iso(3), "source": "test", "city": "Frankfurt",
         "prices": {UID_B: {"status": "open", "e10": 1.739, "diesel": 1.529},
                    UID_C: {"status": "closed"}}},
    ]


def get_json(base: str, path: str):
    with urllib.request.urlopen(base + path, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# Metadaten + Puffer
# ---------------------------------------------------------------------------

def test_meta_loads_names_from_polling_json(tmp_path):
    meta_path = write_polling_json(tmp_path / "p.json")
    meta = rp2.StationMeta([meta_path])
    loaded = meta.load()
    assert loaded[UID_A]["name"] == "Station Alpha"
    assert loaded[UID_A]["brand"] == "Aral"
    assert loaded[UID_A]["maps"] == "https://maps.example/alpha"
    assert loaded[UID_B]["city"] == "Frankfurt"


def test_meta_missing_falls_back_to_uuid_and_reports_error(tmp_path):
    ctx = make_ctx(tmp_path, with_meta=False, poll_lines=default_poll_lines(),
                   with_forecast=False)
    snap = ctx.snapshot()
    names = {s["station_id"]: s["name"] for s in snap["stations"]}
    assert names[UID_A] == UID_A  # UUID statt Name
    assert ctx.meta.error


def test_snapshots_use_latest_line_per_station(tmp_path):
    ctx = make_ctx(tmp_path, poll_lines=default_poll_lines(), with_forecast=False)
    snap = ctx.snapshot()
    by_id = {s["station_id"]: s for s in snap["stations"]}
    assert set(by_id) == {UID_A, UID_B, UID_C}
    # UID_B in beiden Zeilen -> neuere Zeile (1.739) gewinnt, nicht die alte
    assert by_id[UID_B]["e10"] == 1.739
    assert by_id[UID_A]["e10"] == 1.699
    assert by_id[UID_C]["status"] == "closed"
    # echtes Datenalter, keine hartcodierten Werte
    assert by_id[UID_A]["age_minutes"] >= 11
    assert by_id[UID_B]["age_minutes"] < 5
    assert by_id[UID_B]["fresh"] is True


def test_snapshots_fall_back_to_yesterday_at_night(tmp_path):
    # Heutige Datei fehlt -> vorgestrige? Nein: gestern wird genommen.
    ctx = make_ctx(tmp_path, poll_lines=default_poll_lines(),
                   poll_day_offset=1, with_forecast=False)
    snap = ctx.snapshot()
    assert len(snap["stations"]) == 3


# ---------------------------------------------------------------------------
# Prognose-Zusammenfassung + Entscheidung
# ---------------------------------------------------------------------------

def test_point_stats_uniform_assumption():
    # q025=1.60, q975=1.80, aktuell 1.70 -> P(günstiger)=0.5,
    # E[min(0, 1.70-X)] = d^2/(2w) = 0.1^2/(2*0.2) = 0.025
    stats = rp2.point_stats({"q025": 1.60, "q975": 1.80}, 1.70)
    assert stats["p_better"] == pytest.approx(0.5, abs=1e-9)
    assert stats["exp_saving_per_l"] == pytest.approx(0.025, abs=1e-9)
    # aktuell über q975 -> P=1, Ersparnis = 1.90 - Mittel(1.70) = 0.20
    stats = rp2.point_stats({"q025": 1.60, "q975": 1.80}, 1.90)
    assert stats["p_better"] == 1.0
    assert stats["exp_saving_per_l"] == pytest.approx(0.20, abs=1e-9)
    # aktuell unter q025 -> kein Gewinn
    stats = rp2.point_stats({"q025": 1.60, "q975": 1.80}, 1.50)
    assert stats["p_better"] == 0.0
    assert stats["exp_saving_per_l"] == 0.0
    # kaputte Quantile -> None
    assert rp2.point_stats({"q025": 1.9, "q975": 1.8}, 1.7) is None


def test_summarize_forecast_ignores_past_points():
    now = dt.datetime.now(UTC)
    origin = now - dt.timedelta(hours=3)
    points = forecast_points(1.70, origin)  # 3 Punkte in der Vergangenheit
    summary = rp2.summarize_forecast(points, now, 1.70)
    assert summary is not None
    assert summary["best"]["at"] >= now.replace(microsecond=0).isoformat()[:16]
    # Fenster: Dip kommt ab h=14 (also jetzt+11 h)
    assert summary["best"]["time"]


def test_summarize_forecast_none_when_only_past():
    now = dt.datetime.now(UTC)
    origin = now - dt.timedelta(hours=30)
    summary = rp2.summarize_forecast(forecast_points(1.70, origin, hours=26), now, 1.7)
    assert summary is None


# ---------------------------------------------------------------------------
# Server: Fallback-Modus
# ---------------------------------------------------------------------------

def start_fallback_server(tmp_path, **kwargs):
    ctx = make_ctx(tmp_path, **kwargs)
    server = rp2.make_server(ctx, "127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, ctx


def test_fallback_api_endpoints(tmp_path):
    server, _ = start_fallback_server(tmp_path, poll_lines=default_poll_lines())
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        health = get_json(base, "/api/v1/health")
        assert health["status"] == "fallback"
        assert health["prices"]["available"] is True
        assert health["prices"]["stations"] == 3
        assert health["prices"]["stations_with_name"] == 3
        assert health["forecasts"]["available"] is True
        assert health["nas"]["configured"] is False

        stations = get_json(base, "/api/v1/stations?fuel=e10")
        names = [s["name"] for s in stations["stations"]]
        assert "Station Alpha" in names and "Station Beta" in names
        # keine UUID als Name mehr
        assert UID_A not in names
        # sortiert nach Preis; Alpha (1.699) zuerst
        assert stations["stations"][0]["station_id"] == UID_A
        # Gamma geschlossen -> nach hinten, Preis null
        gamma = [s for s in stations["stations"] if s["station_id"] == UID_C][0]
        assert gamma["price"] is None
        assert stations["stations"][-1]["station_id"] == UID_C

        decide = get_json(base, "/api/v1/decide?fuel=e10&liters=40")
        assert decide["available"] is True
        assert decide["f2"]["station"]["name"] == "Station Alpha"
        assert decide["f2"]["price"] == 1.699
        assert decide["f1"]["available"] is True
        assert decide["f1"]["recommendation"] in ("wait", "refuel_now")
        if decide["f1"]["recommendation"] == "wait":
            assert decide["f1"]["expected_saving_eur_tank"] >= 1.0
    finally:
        server.shutdown()
        server.server_close()


def test_fallback_index_served_and_forced(tmp_path):
    server, _ = start_fallback_server(tmp_path, poll_lines=default_poll_lines())
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(base + "/", timeout=5) as resp:
            body = resp.read().decode("utf-8")
        assert rp2.VERSION_MARKER in body
    finally:
        server.shutdown()
        server.server_close()


def test_decide_without_open_prices_503(tmp_path):
    lines = [{"fetched_at": now_iso(1), "city": "X",
              "prices": {UID_A: {"status": "closed"}}}]
    server, _ = start_fallback_server(tmp_path, poll_lines=lines, with_forecast=False)
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with pytest.raises(urllib.error.HTTPError) as exc:
            get_json(base, "/api/v1/decide?fuel=e10")
        assert exc.value.code == 503
    finally:
        server.shutdown()
        server.server_close()


def test_forecasts_endpoint_503_without_cache(tmp_path):
    server, _ = start_fallback_server(tmp_path, poll_lines=default_poll_lines(),
                                      with_forecast=False)
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with pytest.raises(urllib.error.HTTPError) as exc:
            get_json(base, "/api/v1/forecasts?fuel=e10")
        assert exc.value.code == 503
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------------------
# Server: NAS-Proxy
# ---------------------------------------------------------------------------

class FakeNasHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/api/v1/health":
            body = json.dumps({"app": "online"}).encode()
            ctype = "application/json"
        else:
            body = b"NAS-GUI-PROXIED"
            ctype = "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_HEAD = do_GET


def start_fake_nas():
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeNasHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}"


def test_proxy_forwards_gui_and_api_when_nas_online(tmp_path):
    nas, nas_base = start_fake_nas()
    try:
        server, _ = start_fallback_server(
            tmp_path, poll_lines=default_poll_lines(), nas_base=nas_base)
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            # GUI-Root wird proxied (nicht die Fallback-Seite)
            with urllib.request.urlopen(base + "/", timeout=5) as resp:
                assert resp.read() == b"NAS-GUI-PROXIED"
                assert resp.headers.get("X-TankApp-Proxy") == "nas"
            # API wird proxied
            assert get_json(base, "/api/v1/health") == {"app": "online"}
            # ?fallback=1 erzwingt trotzdem die lokale Seite
            with urllib.request.urlopen(base + "/?fallback=1", timeout=5) as resp:
                body = resp.read().decode("utf-8")
            assert rp2.VERSION_MARKER in body
        finally:
            server.shutdown()
            server.server_close()
    finally:
        nas.shutdown()
        nas.server_close()


def test_proxy_falls_back_to_local_when_nas_dies(tmp_path):
    nas, nas_base = start_fake_nas()
    server, _ = start_fallback_server(
        tmp_path, poll_lines=default_poll_lines(), nas_base=nas_base,
        ttl_online=5.0, ttl_offline=0.2)
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(base + "/", timeout=5) as resp:
            assert resp.read() == b"NAS-GUI-PROXIED"
        nas.shutdown()
        nas.server_close()
        # nächsten Request: Proxy schlägt fehl -> Fallback-GUI wird gesendet
        with urllib.request.urlopen(base + "/", timeout=5) as resp:
            body = resp.read().decode("utf-8")
        assert rp2.VERSION_MARKER in body
        health = get_json(base, "/api/v1/health")
        assert health["nas"]["online"] is False
        assert health["nas"]["error"]
    finally:
        server.shutdown()
        server.server_close()


def test_nas_check_endpoint_forces_reprobe(tmp_path):
    nas, nas_base = start_fake_nas()
    server, ctx = start_fallback_server(
        tmp_path, poll_lines=default_poll_lines(), nas_base=nas_base,
        ttl_online=5.0, ttl_offline=5.0)
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        result = get_json(base, "/api/v1/nas-check")
        assert result["online"] is True
        nas.shutdown()
        nas.server_close()
        result = get_json(base, "/api/v1/nas-check")
        assert result["online"] is False
        assert result["nas"]["error"]
        del ctx
    finally:
        server.shutdown()
        server.server_close()


def test_nas_unconfigured_always_fallback(tmp_path):
    server, _ = start_fallback_server(tmp_path, poll_lines=default_poll_lines())
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        health = get_json(base, "/api/v1/health")
        assert health["nas"]["configured"] is False
        with urllib.request.urlopen(base + "/", timeout=5) as resp:
            assert rp2.VERSION_MARKER in resp.read().decode("utf-8")
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------------------
# Template-Installation
# ---------------------------------------------------------------------------

def test_install_default_template_replaces_stale_version(tmp_path):
    template_dir = tmp_path / "tpl"
    template_dir.mkdir()
    stale = template_dir / "index.html"
    stale.write_text("alt, ohne Marker", encoding="utf-8")
    rp2.install_default_template(template_dir)
    assert stale.read_text(encoding="utf-8") == rp2.DEFAULT_INDEX_HTML
    assert (template_dir / "index.html.old").is_file()
    # zweiter Aufruf: nichts passiert (Marker stimmt)
    rp2.install_default_template(template_dir)
    assert not stale.read_text(encoding="utf-8").startswith("alt")


def test_install_default_template_keeps_custom_same_marker(tmp_path):
    template_dir = tmp_path / "tpl"
    template_dir.mkdir()
    custom = (
        "<html>" + rp2.VERSION_MARKER + "<body>customisiert</body></html>"
    )
    (template_dir / "index.html").write_text(custom, encoding="utf-8")
    rp2.install_default_template(template_dir)
    assert (template_dir / "index.html").read_text(encoding="utf-8") == custom


# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

def test_nas_config_from_env(monkeypatch):
    monkeypatch.setenv("NAS_HEALTH_URL", "http://nas.lan:9999/api/v1/health")
    base, health = rp2.nas_config_from_env()
    assert base == "http://nas.lan:9999"
    assert health == "http://nas.lan:9999/api/v1/health"
    monkeypatch.delenv("NAS_HEALTH_URL")
    monkeypatch.setenv("NAS_IP", "192.168.178.61")
    monkeypatch.setenv("NAS_PORT", "1355")
    base, health = rp2.nas_config_from_env()
    assert base == "http://192.168.178.61:1355"
    assert health.endswith("/api/v1/health")
    monkeypatch.delenv("NAS_IP")
    assert rp2.nas_config_from_env() == (None, None)
