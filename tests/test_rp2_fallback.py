"""Tests für die RP2 Fallback-GUI + NAS-Proxy (rp2/fallback_gui.py).

Deckt ab:
  * Stationen-Metadaten aus polling.json (Namen statt UUIDs)
  * Live-Preise aus dem JSONL-Ringpuffer (neueste Zeile je Station, echtes Alter)
  * Tagesverlauf 06–24 Uhr je Station (`read_series` + `/api/v1/series`)
  * Snapshot-TTL-Cache (ein Puffer-Read je GUI-Zyklus statt vier)
  * F1/F2/F3-Entscheidung aus echten Quantil-Prognosen (q025/q975-Logik)
  * Proxy-Verhalten: NAS online -> transparente Weiterleitung,
    NAS offline -> Fallback-GUI, ?fallback=1 erzwingt Fallback
"""

import datetime as dt
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
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
    path.write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")
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
                {
                    "uuid": UID_B,
                    "name": "Station Beta",
                    "brand": "Esso",
                    "lat": 50.11,
                    "lon": 8.68,
                    "group": "Nähe",
                    "dist_km": 4.2,
                    "drive_min": 11.0,
                },
                {
                    "uuid": UID_C,
                    "name": "Station Gamma",
                    "brand": "Jet",
                    "lat": 50.10,
                    "lon": 8.70,
                    "group": "Umweg",
                    "dist_km": 9.9,
                    "drive_min": 20.0,
                },
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
        out.append(
            {
                "timestamp": ts.isoformat(),
                "q025": round(base - 0.02 - dip, 3),
                "q10": round(base - 0.01 - dip, 3),
                "q50": round(base - dip, 3),
                "q90": round(base + 0.01 - dip, 3),
                "q975": round(base + 0.02 - dip, 3),
            }
        )
    return out


def write_forecast_cache(
    cache_dir: Path, entries: list[dict], age_hours: float = 1.0
) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / "last_forecasts.json"
    payload = {
        "generated_at": (
            dt.datetime.now(UTC) - dt.timedelta(hours=age_hours)
        ).isoformat(),
        "_cached_at": dt.datetime.now(UTC).isoformat(),
        "count": len(entries),
        "forecasts": entries,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def make_ctx(
    tmp_path,
    *,
    nas_base=None,
    poll_lines=None,
    poll_day_offset=0,
    with_meta=True,
    with_forecast=True,
    ttl_offline=0.2,
    ttl_online=0.2,
):
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
                {
                    "station_id": UID_A,
                    "city": "Gütersloh",
                    "fuel": "E10",
                    "origin": origin.isoformat(),
                    "points": forecast_points(1.71, origin),
                },
                {
                    "station_id": UID_B,
                    "city": "Frankfurt",
                    "fuel": "E10",
                    "origin": origin.isoformat(),
                    "points": forecast_points(1.76, origin),
                },
            ],
        )
    nas_state = (
        rp2.NasState(
            nas_base, ttl_online=ttl_online, ttl_offline=ttl_offline, timeout=1.0
        )
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
        {
            "fetched_at": now_iso(12),
            "source": "test",
            "city": "Gütersloh",
            "prices": {
                UID_A: {"status": "open", "e10": 1.699, "e5": 1.819, "diesel": 1.489},
                UID_B: {"status": "open", "e10": 1.749, "diesel": 1.539},
            },
        },
        {
            "fetched_at": now_iso(3),
            "source": "test",
            "city": "Frankfurt",
            "prices": {
                UID_B: {"status": "open", "e10": 1.739, "diesel": 1.529},
                UID_C: {"status": "closed"},
            },
        },
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


def test_meta_preserves_city_key_for_short_filters(tmp_path):
    payload = {
        "sets": {
            "GT": {"label": "Gütersloh", "stations": [{"uuid": UID_A, "name": "A"}]},
            "FRA": {"label": "Frankfurt", "stations": [{"uuid": UID_B, "name": "B"}]},
        }
    }
    meta_path = tmp_path / "p.json"
    meta_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    loaded = rp2.StationMeta([meta_path]).load()
    assert loaded[UID_A]["city_key"] == "GT"
    assert loaded[UID_A]["city_label"] == "Gütersloh"
    assert loaded[UID_B]["city_key"] == "FRA"
    assert loaded[UID_B]["city_label"] == "Frankfurt"


def test_meta_missing_falls_back_to_uuid_and_reports_error(tmp_path):
    ctx = make_ctx(
        tmp_path, with_meta=False, poll_lines=default_poll_lines(), with_forecast=False
    )
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
    ctx = make_ctx(
        tmp_path,
        poll_lines=default_poll_lines(),
        poll_day_offset=1,
        with_forecast=False,
    )
    snap = ctx.snapshot()
    assert len(snap["stations"]) == 3


# ---------------------------------------------------------------------------
# Prognose-Zusammenfassung + Entscheidung
# ---------------------------------------------------------------------------


def test_point_stats_uniform_assumption():
    # q025=1.60, q975=1.80, aktuell 1.70 -> P(günstiger)=0.5,
    # E[min(0, 1.70-X)] = d^2/(2w) = 0.1^2/(2*0.2) = 0.025
    stats = rp2.point_stats({"q025": 1.60, "q975": 1.80}, 1.70)
    assert stats["price_score"] == pytest.approx(0.5, abs=1e-9)
    assert stats["exp_saving_per_l"] == pytest.approx(0.025, abs=1e-9)
    # aktuell über q975 -> P=1, Ersparnis = 1.90 - Mittel(1.70) = 0.20
    stats = rp2.point_stats({"q025": 1.60, "q975": 1.80}, 1.90)
    assert stats["price_score"] == 1.0
    assert stats["exp_saving_per_l"] == pytest.approx(0.20, abs=1e-9)
    # aktuell unter q025 -> kein Gewinn
    stats = rp2.point_stats({"q025": 1.60, "q975": 1.80}, 1.50)
    assert stats["price_score"] == 0.0
    assert stats["exp_saving_per_l"] == 0.0
    # kaputte Quantile -> None
    assert rp2.point_stats({"q025": 1.9, "q975": 1.8}, 1.7) is None


def test_template_labels_score_not_probability():
    """Issue 49: Fallback-UI nennt den Wert „Preis-Score“ (historisches
    Quantil), nie „Wahrscheinlichkeit“ — die kalibrierte M7-Wahrscheinlichkeit
    bleibt dem NAS vorbehalten."""
    html = rp2.DEFAULT_INDEX_HTML
    assert "Wahrsch. günstiger" not in html
    assert "Preis-Score" in html
    assert "keine kalibrierte Wahrscheinlichkeit" in html


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
        assert health["city_options"] == [
            {"value": "Frankfurt", "label": "Frankfurt"},
            {"value": "Gütersloh", "label": "Gütersloh"},
        ]

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
        # Issue 49: Der Gleichverteilungs-Fallback darf sich nicht
        # „Wahrscheinlichkeit“ nennen — nur Preis-Score/historisches Quantil.
        f1_text = decide["f1"]["reason"] + " " + decide["f1"]["basis"]
        # Die alte falsche Behauptung darf nicht mehr auftreten; der Wert wird
        # als Preis-Score/historisches Quantil ausgewiesen (der explizite
        # Disclaimer „keine kalibrierte Wahrscheinlichkeit“ ist erlaubt).
        assert "Wahrscheinlichkeit unter dem jetzigen Preis" not in f1_text
        assert "Preis-Score" in f1_text and "Quantil" in f1_text
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


def test_city_filter_accepts_short_polling_keys(tmp_path):
    poll_dir = tmp_path / "poll"
    cache_dir = tmp_path / "cache"
    meta_path = tmp_path / "polling.json"
    template_dir = tmp_path / "templates"
    template_dir.mkdir(parents=True, exist_ok=True)
    (template_dir / "index.html").write_text(
        "MARKER: " + rp2.VERSION_MARKER, encoding="utf-8"
    )
    meta_path.write_text(
        json.dumps(
            {
                "sets": {
                    "GT": {
                        "label": "Gütersloh",
                        "stations": [{"uuid": UID_A, "name": "GT A"}],
                    },
                    "FRA": {
                        "label": "Frankfurt",
                        "stations": [{"uuid": UID_B, "name": "FRA B"}],
                    },
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    write_poll_file(
        poll_dir,
        [
            {
                "fetched_at": now_iso(1),
                "city": "Gütersloh",
                "prices": {UID_A: {"status": "open", "e10": 1.699}},
            },
            {
                "fetched_at": now_iso(1),
                "city": "Frankfurt",
                "prices": {UID_B: {"status": "open", "e10": 1.759}},
            },
        ],
    )
    ctx = rp2.Context(
        poll_dir=poll_dir,
        cache_file=cache_dir / "last_forecasts.json",
        meta_candidates=[meta_path],
        template_dir=template_dir,
        nas_state=rp2.NasState(None),
    )
    server = rp2.make_server(ctx, "127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        health = get_json(base, "/api/v1/health")
        assert health["cities"] == ["FRA", "GT"]
        assert health["city_options"] == [
            {"value": "FRA", "label": "Frankfurt"},
            {"value": "GT", "label": "Gütersloh"},
        ]
        gt = get_json(base, "/api/v1/stations?fuel=e10&city=GT")
        assert [row["station_id"] for row in gt["stations"]] == [UID_A]
        fra = get_json(base, "/api/v1/decide?fuel=e10&city=FRA&liters=40")
        assert fra["f2"]["station"]["station_id"] == UID_B
        # Der ausgeschriebene Name bleibt aus Kompatibilität ebenfalls gültig.
        assert (
            get_json(base, "/api/v1/stations?fuel=e10&city=Frankfurt")["fresh_prices"]
            == 1
        )
    finally:
        server.shutdown()
        server.server_close()


def test_decide_without_open_prices_503(tmp_path):
    lines = [
        {"fetched_at": now_iso(1), "city": "X", "prices": {UID_A: {"status": "closed"}}}
    ]
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
    server, _ = start_fallback_server(
        tmp_path, poll_lines=default_poll_lines(), with_forecast=False
    )
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with pytest.raises(urllib.error.HTTPError) as exc:
            get_json(base, "/api/v1/forecasts?fuel=e10")
        assert exc.value.code == 503
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------------------
# Tagesverlauf (`read_series` + /api/v1/series) + Snapshot-TTL-Cache
# ---------------------------------------------------------------------------

LOCAL_TZ = dt.datetime.now().astimezone().tzinfo


def local_iso(day: dt.date, hour: int, minute: int = 5) -> str:
    """UTC-Zeitstempel für eine Ortszeit-Stunde (der Collector schreibt UTC)."""
    return (
        dt.datetime.combine(day, dt.time(hour % 24, minute), tzinfo=LOCAL_TZ)
        .astimezone(UTC)
        .isoformat()
    )


def poll_line(
    day: dt.date, hour: int, minute: int, rec: dict, uid: str = UID_A
) -> dict:
    return {
        "fetched_at": local_iso(day, hour, minute),
        "source": "test",
        "city": "Gütersloh",
        "prices": {uid: rec},
    }


def write_day_file(poll_dir: Path, day: dt.date, lines: list[dict]) -> Path:
    """Tag-Datei mit frei wählbarem Datum (gestern, heute, morgen)."""
    poll_dir.mkdir(parents=True, exist_ok=True)
    path = poll_dir / f"{day.strftime('%Y-%m-%d')}.jsonl"
    path.write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")
    return path


def series_history(poll_dir: Path) -> dict:
    """Heutiger Verlauf: letzte Meldung je Stunde, geschlossene und fremde
    Kraftstoffe bleiben leer, dazu gestern (zählt nicht) und morgen (Zelle 24)."""
    today = dt.datetime.now(LOCAL_TZ).date()
    write_day_file(
        poll_dir,
        today - dt.timedelta(days=1),
        [
            poll_line(
                today - dt.timedelta(days=1), 9, 0, {"status": "open", "e10": 1.999}
            ),
        ],
    )
    write_day_file(
        poll_dir,
        today,
        [
            poll_line(today, 7, 5, {"status": "open", "e10": 1.700}),
            poll_line(today, 7, 55, {"status": "open", "e10": 1.690}),
            poll_line(today, 8, 30, {"status": "closed"}),
            poll_line(today, 12, 10, {"status": "open", "e5": 1.800}),
            poll_line(today, 18, 20, {"status": "open", "e10": 1.684}),
            poll_line(today, 23, 55, {"status": "open", "e10": 1.672}),
        ],
    )
    write_day_file(
        poll_dir,
        today + dt.timedelta(days=1),
        [
            poll_line(
                today + dt.timedelta(days=1), 0, 15, {"status": "open", "e10": 1.666}
            ),
        ],
    )
    return {"today": today}


def test_read_series_hour_buckets_and_extremes(tmp_path):
    poll_dir = tmp_path / "poll"
    info = series_history(poll_dir)
    out = rp2.read_series(poll_dir, UID_A, "e10")
    assert out["station_id"] == UID_A
    assert out["fuel"] == "e10"
    assert out["day"] == info["today"].isoformat()
    assert [h["hour"] for h in out["hours"]] == [f"{h:02d}" for h in range(6, 25)]
    by_hour = {h["hour"]: h for h in out["hours"]}
    assert by_hour["06"]["value"] is None  # gestern zählt nicht
    assert by_hour["07"]["value"] == 1.690  # letzte Meldung der Stunde gewinnt
    assert by_hour["07"]["at"] == local_iso(info["today"], 7, 55)
    assert by_hour["08"]["value"] is None  # geschlossen -> keine erfundene Zahl
    assert by_hour["12"]["value"] is None  # E10 nicht geführt (nur E5 gemeldet)
    assert by_hour["18"]["value"] == 1.684
    assert by_hour["23"]["value"] == 1.672
    assert by_hour["24"]["value"] == 1.666  # Mitternachtsstunde aus der Folgetags-Datei
    assert by_hour["24"]["at"] == local_iso(info["today"] + dt.timedelta(days=1), 0, 15)
    assert out["min"] == {"value": 1.666, "at": "00:15"}
    assert out["max"] == {"value": 1.690, "at": "07:55"}
    assert out["now"] == {"value": 1.666, "at": "00:15"}  # letzte Meldung
    # Stunden ohne Meldung tragen keine Zahl (auch kein "at")
    for hour in ("06", "08", "09", "12"):
        assert by_hour[hour] == {"hour": hour, "value": None, "at": None}


def test_read_series_filters_fuel(tmp_path):
    poll_dir = tmp_path / "poll"
    series_history(poll_dir)
    e5 = rp2.read_series(poll_dir, UID_A, "e5")
    by_hour = {h["hour"]: h for h in e5["hours"]}
    assert by_hour["12"]["value"] == 1.800
    assert by_hour["07"]["value"] is None  # die Stunde hatte nur E10
    assert e5["min"] == {"value": 1.800, "at": "12:10"}
    assert e5["now"] == {"value": 1.800, "at": "12:10"}


def test_read_series_without_any_report_is_empty(tmp_path):
    poll_dir = tmp_path / "poll"
    poll_dir.mkdir(parents=True, exist_ok=True)
    out = rp2.read_series(poll_dir, UID_A, "e10")
    assert len(out["hours"]) == 19
    assert all(h["value"] is None for h in out["hours"])
    assert out["min"] is None and out["max"] is None and out["now"] is None


def test_series_endpoint_returns_daily_strip(tmp_path):
    today = dt.datetime.now(LOCAL_TZ).date()
    lines = [
        poll_line(today, 7, 5, {"status": "open", "e10": 1.700}),
        poll_line(today, 7, 55, {"status": "open", "e10": 1.690}),
        poll_line(today, 8, 30, {"status": "closed"}),
    ]
    server, _ = start_fallback_server(tmp_path, poll_lines=lines, with_forecast=False)
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        data = get_json(base, f"/api/v1/series?station={UID_A}&fuel=e10")
        assert data["station_id"] == UID_A
        assert len(data["hours"]) == 19
        by_hour = {h["hour"]: h for h in data["hours"]}
        assert by_hour["07"]["value"] == 1.690
        assert by_hour["08"]["value"] is None
        assert data["max"]["value"] == 1.690
    finally:
        server.shutdown()
        server.server_close()


def test_series_endpoint_errors(tmp_path):
    today = dt.datetime.now(LOCAL_TZ).date()
    lines = [poll_line(today, 7, 5, {"status": "open", "e10": 1.700})]
    server, _ = start_fallback_server(tmp_path, poll_lines=lines, with_forecast=False)
    base = f"http://127.0.0.1:{server.server_port}"

    def status_of(path: str) -> int:
        with pytest.raises(urllib.error.HTTPError) as exc:
            get_json(base, path)
        return exc.value.code

    try:
        # unbekannte Station -> 404
        assert status_of(f"/api/v1/series?station={'9' * 36}&fuel=e10") == 404
        # ungültiges fuel -> 400 (kein stilles E10)
        assert status_of(f"/api/v1/series?station={UID_A}&fuel=super") == 400
        # fehlende Station -> 400
        assert status_of("/api/v1/series?fuel=e10") == 400
        assert status_of(f"/api/v1/series?station={UID_A}") == 400
    finally:
        server.shutdown()
        server.server_close()


def test_series_endpoint_503_on_empty_buffer(tmp_path):
    server, _ = start_fallback_server(tmp_path, with_forecast=False)
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with pytest.raises(urllib.error.HTTPError) as exc:
            get_json(base, f"/api/v1/series?station={UID_A}&fuel=e10")
        assert exc.value.code == 503
        body = json.loads(exc.value.read().decode("utf-8"))
        assert "Preis-Puffer ist leer" in body["error"]
    finally:
        server.shutdown()
        server.server_close()


def test_snapshot_ttl_cache_keeps_state_short(tmp_path):
    today = dt.datetime.now(LOCAL_TZ).date()
    ctx = make_ctx(
        tmp_path,
        poll_lines=[poll_line(today, 7, 5, {"status": "open", "e10": 1.700})],
        with_forecast=False,
    )
    first = ctx.snapshot()
    assert first["stations"][0]["e10"] == 1.700
    # Neue Zeile im Puffer: innerhalb der TTL bleibt der Stand stehen ...
    write_day_file(
        ctx.poll_dir,
        today,
        [poll_line(today, 7, 10, {"status": "open", "e10": 1.555})],
    )
    cached = ctx.snapshot()
    assert cached is first
    assert cached["stations"][0]["e10"] == 1.700
    # ... erzwungen liest der Cache neu.
    fresh = ctx.snapshot(force=True)
    assert fresh["stations"][0]["e10"] == 1.555


def test_snapshot_ttl_collapses_parallel_endpoints(tmp_path, monkeypatch):
    """Ein GUI-Refresh fragt vier Endpunkte parallel ab — zusammen mit dem
    Tagesstreifen darf der Puffer nur einmal gelesen werden (Checkliste 1.3)."""
    calls = {"n": 0}
    real = rp2.read_snapshots

    def counting(*args, **kwargs):
        calls["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(rp2, "read_snapshots", counting)
    today = dt.datetime.now(LOCAL_TZ).date()
    lines = [
        poll_line(today, 7, 5, {"status": "open", "e10": 1.700}),
        poll_line(today, 12, 5, {"status": "open", "e10": 1.690}),
    ]
    server, _ = start_fallback_server(tmp_path, poll_lines=lines)
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        get_json(base, "/api/v1/health")
        get_json(base, "/api/v1/stations?fuel=e10")
        get_json(base, "/api/v1/forecasts?fuel=e10")
        get_json(base, "/api/v1/decide?fuel=e10&liters=40")
        get_json(base, f"/api/v1/series?station={UID_A}&fuel=e10")
        assert calls["n"] == 1
    finally:
        server.shutdown()
        server.server_close()


def test_template_is_the_v4_gui_without_mock_data():
    """Checkliste 2.1: Mock-Leiste und Beispieldaten sind raus, die Bausteine
    der neuen Oberfläche stehen im ausgelieferten Template."""
    html = rp2.DEFAULT_INDEX_HTML
    for marker in (
        "answer-card",
        "daystrip",
        "st-grid",
        "view-werkstatt",
        "sticky-chip",
        "sort-tabs",
        "REBOOT_HINT",
    ):
        assert marker in html
    assert "Mockup" not in html
    assert "const STATIONS = [" not in html  # keine Beispiel-Stationen
    assert "const DAYSTRIP = {" not in html  # kein Mock-Tagesstreifen
    assert "NOW_MIN" not in html  # keine Mock-Uhr


def test_template_uses_city_options_for_short_city_filters():
    html = rp2.DEFAULT_INDEX_HTML
    assert "h.city_options" in html
    assert "entry.value" in html
    assert 'entry.value + " · " + entry.label' in html


def test_answer_card_has_three_facts_and_freshness_footer():
    """GUI-Neuentwurf §5.1 im Gleichschritt: Die Antwort-Karte der Pi-GUI
    trägt dieselben drei Fakten in derselben Reihenfolge wie „Jetzt“ in der
    NAS-GUI — nur der Tankstand fehlt hier bewusst, er ist NAS-Sache
    (UMSETZUNG-FALLBACK-GUI-V2 §0). Darunter steht die Frische-Fußzeile mit
    dem Alter von Preisen und Prognose."""
    html = rp2.DEFAULT_INDEX_HTML
    # Fakten-Markup und Beschriftungen — Reihenfolge im Fakten-Block, nicht im
    # ganzen Dokument (die Werkstatt nennt „Frische Preise“ ebenfalls).
    # B7: Der Fenster-Fakt trägt einen dynamischen Tag („heute“/„morgen“),
    # deshalb wird hier nur der feste Bestandteil gefixt.
    assert 'class="facts"' in html
    start = html.index('class="facts"')
    labels = ("Jetzt hier", "Bestes Fenster ", "Frische Preise")
    positions = []
    for label in labels:
        at = html.index(label, start)
        assert at > start, f"Fakt „{label}“ fehlt in der Antwort-Karte"
        positions.append(at)
    assert positions == sorted(positions)
    # B7: Der Tag des Fensters kommt aus dayWord, Default „heute“.
    assert "dayWord(waitWindow.at)" in html
    # Frische-Fußzeile: Satzbau und Altersquellen
    assert 'class="fresh-footer"' in html
    assert '" alt · Prognose "' in html
    assert "Preise ' + priceAge +" in html
    assert "+ forecastAge +" in html
    assert "function minutesSince(iso)" in html
    # Der Tankstand darf hier nicht auftauchen (bewusste Grenze des Fallbacks).
    assert "Tank reicht?" not in html


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
            tmp_path, poll_lines=default_poll_lines(), nas_base=nas_base
        )
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
        tmp_path,
        poll_lines=default_poll_lines(),
        nas_base=nas_base,
        ttl_online=5.0,
        ttl_offline=0.2,
    )
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
        tmp_path,
        poll_lines=default_poll_lines(),
        nas_base=nas_base,
        ttl_online=5.0,
        ttl_offline=5.0,
    )
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
    custom = "<html>" + rp2.VERSION_MARKER + "<body>customisiert</body></html>"
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


# ---------------------------------------------------------------------------
# G4: leerer Cache nach dem Reboot wird erklärt, nicht nur gemeldet
# ---------------------------------------------------------------------------


def test_reboot_hint_is_rendered_into_the_fallback_page():
    html = rp2.DEFAULT_INDEX_HTML
    assert "const REBOOT_HINT = " in html
    assert "Prognose-Puffer leer" in html
    assert "__CACHE_REBOOT_HINT_JSON__" not in html


def test_forecasts_error_names_the_volatile_tmp_cache(tmp_path):
    server, _ = start_fallback_server(
        tmp_path, poll_lines=default_poll_lines(), with_forecast=False
    )
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with pytest.raises(urllib.error.HTTPError) as exc:
            get_json(base, "/api/v1/forecasts?fuel=e10")
        body = json.loads(exc.value.read().decode("utf-8"))
        assert "Prognose-Puffer leer" in body["error"]
        assert "SD-Karte" in body["error"]
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------------------
# Regression: Das Inline-JS des Templates muss syntaktisch gültig sein.
#
# Ein einziger unmaskiertes Anführungszeichen in einem JS-String (z. B.
# "<td class=\"station-cell\">") bricht das komplette <script> ab — die
# Fallback-GUI bleibt dann für immer bei „Lade …“ hängen, OHNE Fehlerbanner,
# weil refresh() gar nie ausgeführt wird. Die API lieferte dabei einwandfrei
# Daten; nur das Template war kaputt. (Aufgefallen im Sep 2026-Betrieb.)
# ---------------------------------------------------------------------------


def _extract_inline_js() -> str:
    scripts = re.findall(r"<script>([\s\S]*?)</script>", rp2.DEFAULT_INDEX_HTML)
    assert len(scripts) == 1, "erwartet genau ein Inline-<script> im Template"
    return scripts[0]


_JS_REGEX_OK_PREV = set("(,=:[!&|?{};+-*%^~<>\n")
_JS_KEYWORDS = {
    "return",
    "typeof",
    "instanceof",
    "in",
    "of",
    "new",
    "delete",
    "void",
    "do",
    "else",
    "case",
    "yield",
    "await",
}


def _scan_js_string_literals(js: str) -> list:
    """Kleiner Token-Scanner für die JS-Bug-Klasse „Kaputter String".

    Erkennt (a) Strings, die bis zum Zeilenende nicht mehr geschlossen werden,
    und (b) String-Literale, hinter denen direkt ein Bezeichner/Nachkomma steht
    (Zeichen, die dort nur landen können, wenn ein unmaskiertes Anführungs-
    Zeichen den String früher beendet hat). Kommentare, Regex-Literale und
    escapete Sequenzen werden korrekt übersprungen.
    """
    i, n, line = 0, len(js), 1
    last_char, last_word = None, ""
    while i < n:
        c = js[i]
        if c == "\n":
            line += 1
            i += 1
            last_char = c
            continue
        if c in " \t\r":
            i += 1
            continue
        if c == "/" and i + 1 < n and js[i + 1] == "/":
            j = js.find("\n", i)
            i = n if j == -1 else j
            continue
        if c == "/" and i + 1 < n and js[i + 1] == "*":
            j = js.find("*/", i + 2)
            if j == -1:
                return ["unterminated block comment at line %d" % line]
            line += js[i:j].count("\n")
            i = j + 2
            continue
        if c == "/" and (
            last_char is None
            or last_char in _JS_REGEX_OK_PREV
            or last_word in _JS_KEYWORDS
        ):
            # Regex-Literal: bis zum nächsten unescapekten / außerhalb von []
            j = i + 1
            in_cls = False
            while j < n:
                cj = js[j]
                if cj == "\n":
                    return ["unterminated regex at line %d" % line]
                if cj == "\\":
                    j += 2
                    continue
                if in_cls:
                    if cj == "]":
                        in_cls = False
                elif cj == "[":
                    in_cls = True
                elif cj == "/":
                    break
                j += 1
            if j >= n:
                return ["unterminated regex at line %d" % line]
            i = j + 1
            last_char = "/"
            last_word = ""
            continue
        if c in "\"'":
            quote = c
            j = i + 1
            while j < n:
                if js[j] == "\\":
                    j += 2
                    continue
                if js[j] == "\n":
                    break
                if js[j] == quote:
                    break
                j += 1
            if j >= n or js[j] != quote:
                return ["unterminated %s-string at line %d" % (quote, line)]
            k = j + 1
            while k < n and js[k] in " \t":
                k += 1
            if k < n and (js[k].isalpha() or js[k] in "_$"):
                return [
                    "identifier directly after %s-string at line %d" % (quote, line)
                ]
            i = j + 1
            last_char = quote
            last_word = ""
            continue
        if c.isalpha() or c in "_$":
            j = i
            while j < n and (js[j].isalnum() or js[j] in "_$"):
                j += 1
            last_word = js[i:j]
            last_char = js[j - 1]
            i = j
            continue
        last_char = c
        last_word = ""
        i += 1
    return []


def test_fallback_template_js_string_literals_wellformed():
    """Ohne externe Abhängigkeit: kein JS-String im Template darf durch ein
    unmaskiertes Anführungszeichen frühzeitig beendet werden."""
    problems = _scan_js_string_literals(_extract_inline_js())
    assert problems == [], problems


@pytest.mark.skipif(shutil.which("node") is None, reason="node nicht installiert")
def test_fallback_template_js_parses_with_node():
    """Härtester Check: der echte JS-Parser muss das komplette Inline-<script>
    ohne Syntaxfehler akzeptieren."""
    js = _extract_inline_js()
    with tempfile.NamedTemporaryFile(
        "w", suffix=".js", encoding="utf-8", delete=False
    ) as f:
        f.write(js)
        path = f.name
    try:
        proc = subprocess.run(
            [shutil.which("node"), "--check", path],
            capture_output=True,
            timeout=30,
        )
    finally:
        Path(path).unlink(missing_ok=True)
    assert proc.returncode == 0, proc.stderr.decode("utf-8", "replace")


# ---------------------------------------------------------------------------
# Regression: Kopf-/Steuerleiste teilen die Inhaltsspalte mit <main>.
#
# Auf breiten Desktops liefen Schriftzug und Status-Pills über die ganze
# Fensterbreite, während Karten und Listen in einer 1060-px-Spalte mittig
# saßen — der Kopf wirkte „viel zu breit“ (bei 1920 px 416 px Versatz je
# Seite). Ab 1100 px nutzt die Oberfläche die Breite zusätzlich: 1280 px
# Spalte, Leiste in einer Zeile, Alltag zweispaltig.
# ---------------------------------------------------------------------------


def _css_rule(html: str, selector: str) -> str:
    match = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", html)
    assert match, f"CSS-Regel fehlt: {selector}"
    return match.group(1)


def test_bars_and_main_share_one_content_column():
    html = rp2.DEFAULT_INDEX_HTML
    assert re.search(r"--content:\s*\d+px", _css_rule(html, ":root"))
    for selector in (".topbar", ".controls", ".wrap"):
        assert "var(--content)" in _css_rule(html, selector), selector


def test_desktop_uses_the_width_instead_of_wasting_it():
    html = rp2.DEFAULT_INDEX_HTML
    assert html.count("@media (min-width: 1100px)") >= 3
    assert "--content: 1280px" in html  # Schritt 1: Spalte wie max-w-7xl
    assert "grid-template-columns: minmax(0, 7fr) minmax(0, 5fr)" in html  # Schritt 3
    assert "flex-wrap: wrap" in html  # Leiste bricht um, statt zu quetschen
    assert "#spark-grid .spark-card { margin-top: 0; }" in html


def test_alltag_sections_are_grouped_in_two_columns():
    html = rp2.DEFAULT_INDEX_HTML
    assert '<div class="cols">' in html
    assert '<div class="col col-a">' in html
    assert '<div class="col col-b">' in html
    # Nur die vier Alltag-Kicker tragen die (auf dem Desktop versteckte) Zahl.
    assert html.count('<span class="idx">') == 4


# ---------------------------------------------------------------------------
# B3: Fenster-Zeiten in Ortszeit (nicht UTC)
# ---------------------------------------------------------------------------


def test_summarize_forecast_reports_local_time_not_utc(monkeypatch):
    """B3: Cache-Punkte sind UTC; „time“/„date“ im API-Contract sind für
    Menschen → Europe/Berlin. Ein UTC-Stempel um 23:30 ist in Berlin
    Mitternacht/00:30 am Folgetag — nicht „23:30“ am selben Tag."""
    from zoneinfo import ZoneInfo

    monkeypatch.setattr(rp2, "local_tz", lambda: ZoneInfo("Europe/Berlin"))
    # Winterzeit (CET, UTC+1): 15.01. 22:00 UTC = 15.01. 23:00 Berlin.
    now = dt.datetime(2026, 1, 15, 22, 0, tzinfo=UTC)
    # 23:30 UTC = 00:30 Berlin am 16.01. — Tagesgrenze überschritten.
    points = [
        {
            "timestamp": "2026-01-15T23:30:00+00:00",
            "q025": 1.50,
            "q50": 1.52,
            "q975": 1.60,
        },
        {
            "timestamp": "2026-01-16T08:20:00+00:00",
            "q025": 1.50,
            "q50": 1.56,
            "q975": 1.62,
        },
    ]
    summary = rp2.summarize_forecast(points, now, current_price=1.70)
    # best = erster Punkt (Ersparnis 0.15 > 0.14)
    assert summary["best"]["time"] == "00:30"
    assert summary["best"]["date"] == "2026-01-16"
    # Der ISO-Stempel bleibt UTC — die GUI rendert ihn selbst in Berlin.
    assert summary["best"]["at"] == "2026-01-15T23:30:00+00:00"
    assert summary["windows"][1]["time"] == "09:20"
    assert summary["windows"][1]["date"] == "2026-01-16"


def test_summarize_forecast_local_time_in_summer(monkeypatch):
    """Sommerzeit (CEST, UTC+2): 22:30 UTC = 00:30 Berlin am Folgetag."""
    from zoneinfo import ZoneInfo

    monkeypatch.setattr(rp2, "local_tz", lambda: ZoneInfo("Europe/Berlin"))
    now = dt.datetime(2026, 7, 15, 22, 0, tzinfo=UTC)
    points = [
        {
            "timestamp": "2026-07-15T22:30:00+00:00",
            "q025": 1.40,
            "q50": 1.45,
            "q975": 1.55,
        }
    ]
    summary = rp2.summarize_forecast(points, now, current_price=1.70)
    assert summary["best"]["time"] == "00:30"
    assert summary["best"]["date"] == "2026-07-16"


# ---------------------------------------------------------------------------
# B4: Schreibaktionen (POST/PUT/DELETE/PATCH) über den Proxy
# ---------------------------------------------------------------------------


class EchoNasHandler(BaseHTTPRequestHandler):
    """NAS-Doppel: beantwortet /api/v1/health und gibt Schreib-Requests echo."""

    def log_message(self, *args):
        pass

    def _echo(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        payload = json.dumps(
            {
                "method": self.command,
                "path": self.path,
                "body": body.decode("utf-8"),
                "content_type": self.headers.get("Content-Type"),
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/api/v1/health":
            body = json.dumps({"app": "online"}).encode()
        else:
            body = b"NAS-GUI-PROXIED"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self._echo()

    do_PUT = do_POST
    do_DELETE = do_POST
    do_PATCH = do_POST


def _post_json(base: str, path: str, payload: dict, method: str = "POST") -> dict:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def test_proxy_forwards_write_methods_when_nas_online(tmp_path):
    """B4: Beleg/Intent/Profil über die Pi-Adresse — transparent zur NAS."""
    nas = ThreadingHTTPServer(("127.0.0.1", 0), EchoNasHandler)
    threading.Thread(target=nas.serve_forever, daemon=True).start()
    nas_base = f"http://127.0.0.1:{nas.server_port}"
    server, _ = start_fallback_server(
        tmp_path, poll_lines=default_poll_lines(), nas_base=nas_base
    )
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        for method in ("POST", "PUT", "DELETE", "PATCH"):
            result = _post_json(
                base, "/api/v1/fills", {"liters": 40, "price": 1.699}, method=method
            )
            assert result["method"] == method
            assert result["path"] == "/api/v1/fills"
            assert result["body"] == json.dumps({"liters": 40, "price": 1.699})
            assert result["content_type"] == "application/json"
        # GET bleibt unverändert proxied.
        with urllib.request.urlopen(base + "/", timeout=5) as resp:
            assert resp.read() == b"NAS-GUI-PROXIED"
    finally:
        server.shutdown()
        server.server_close()
        nas.shutdown()
        nas.server_close()


def test_write_without_nas_gets_honest_503(tmp_path):
    """B4: NAS offline → keine 501-Fehlerseite, sondern eine ehrliche
    JSON-Antwort: der Fallback ist nur lesend."""
    nas, nas_base = start_fake_nas()
    server, _ = start_fallback_server(
        tmp_path,
        poll_lines=default_poll_lines(),
        nas_base=nas_base,
        ttl_online=5.0,
        ttl_offline=0.2,
    )
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        nas.shutdown()
        nas.server_close()
        request = urllib.request.Request(
            base + "/api/v1/fills",
            data=b'{"liters": 40}',
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with pytest.raises(urllib.error.HTTPError) as excinfo:
            urllib.request.urlopen(request, timeout=5)
        assert excinfo.value.code == 503
        payload = json.loads(excinfo.value.read().decode("utf-8"))
        assert "NAS offline" in payload["error"]
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------------------
# B7/B8/B9: Antwort-Karte (Fakt-Label, Freshness-Gate, Frische-Zähler)
# ---------------------------------------------------------------------------


def test_decide_marks_stale_set_as_snapshot(tmp_path):
    """B8: Alle Preismeldungen veraltet → f2 meldet fresh_in_set=0; die
    Antwort-Karte kippt auf „Momentaufnahme“ statt zu empfehlen."""
    stale_lines = [
        {
            "fetched_at": now_iso(240),  # 4 Stunden alt
            "source": "test",
            "city": "Gütersloh",
            "prices": {
                UID_A: {"status": "open", "e10": 1.699},
                UID_B: {"status": "open", "e10": 1.749},
            },
        }
    ]
    server, _ = start_fallback_server(tmp_path, poll_lines=stale_lines)
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        decide = get_json(base, "/api/v1/decide?fuel=e10")
        assert decide["available"] is True
        assert decide["f2"]["fresh_in_set"] == 0
        assert decide["f2"]["fresh"] is False
        assert decide["f2"]["oldest_age_minutes"] >= 240
        assert decide["f2"]["station"]["station_id"] == UID_A
    finally:
        server.shutdown()
        server.server_close()


def test_decide_reports_fresh_set(tmp_path):
    """B8: Frische Meldungen → fresh_in_set zählt, fresh=True bei günstigster."""
    server, _ = start_fallback_server(tmp_path, poll_lines=default_poll_lines())
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        decide = get_json(base, "/api/v1/decide?fuel=e10")
        assert decide["available"] is True
        assert decide["f2"]["fresh_in_set"] >= 1
        assert decide["f2"]["fresh"] is True
    finally:
        server.shutdown()
        server.server_close()


def test_answer_card_has_stale_snapshot_wording():
    """B8: Das Template trägt die Abwärtsemotion für ein veraltetes Set."""
    assert "Preis-Momentaufnahme" in rp2.DEFAULT_INDEX_HTML


def test_fresh_price_fact_counts_fuel_price_not_just_report():
    """B9: „Frische Preise“ zählt frische Meldungen MIT Preis für den
    gewählten Kraftstoff — nicht alle frischen Meldungen."""
    js = _extract_inline_js()
    assert "row.fresh && isNum(row.price)" in js


@pytest.mark.skipif(shutil.which("node") is None, reason="node nicht installiert")
def test_day_word_labels_windows_by_actual_day():
    """B7: „Bestes Fenster heute“ zeigt nie auf morgen — dayWord liefert
    „heute“/„morgen“/Datum nach Europe/Berlin."""
    js = _extract_inline_js()
    sources = []
    for name in ("dayKey", "clockOf", "dayWord"):
        match = re.search(rf"function {name}\([\s\S]*?\n\}}", js)
        assert match, name
        sources.append(match.group(0))
    script = (
        "const TZ = 'Europe/Berlin';\n"
        + "\n".join(sources)
        + """
function berlinIso(offsetDays, hh, mm) {
  // Berliner Wall-Clock → UTC-ISO (Offset am Stichtag probeieren).
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  const t = Date.parse(today + 'T00:00:00Z') + offsetDays * 86400000
    + hh * 3600000 + mm * 60000;
  const f = new Intl.DateTimeFormat('de-DE', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = f.formatToParts(new Date(t));
  const bh = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const bm = Number(parts.find((p) => p.type === 'minute').value);
  const off = (bh * 60 + bm - (hh * 60 + mm)) * 60000;
  return new Date(t - off).toISOString();
}
console.log(dayWord(berlinIso(0, 21, 25)));
console.log(dayWord(berlinIso(1, 21, 25)));
console.log(dayWord(berlinIso(2, 21, 25)));
"""
    )
    proc = subprocess.run(
        [shutil.which("node"), "-e", script],
        capture_output=True,
        timeout=30,
    )
    assert proc.returncode == 0, proc.stderr.decode("utf-8", "replace")
    out = proc.stdout.decode("utf-8", "replace").splitlines()
    assert out[0] == "heute"
    assert out[1] == "morgen"
    # In zwei Tagen: Datum TT.MM. (z. B. "16.09.")
    assert re.fullmatch(r"\d{2}\.\d{2}\.", out[2])


def test_template_microcopy_rules():
    """MICROCOPY §1/§2 auch auf der Pi-GUI (GUI-TEXT-BEFUND T1/T2).

    Die Fallback-GUI ist eine eigene Oberfläche ohne Vitest-Ratchet — die
    Tonfall-Regeln (kein Emoji, kein Ausrufezeichen am Satzende, keine direkte
    Anrede) werden deshalb hier gegen das ausgelieferte Template geprüft. Der
    Possessiv bleibt erlaubt (§1, T10), Karten-Links sind keine Sätze.
    """
    text = re.sub(r"https?://\S+", " ", rp2.DEFAULT_INDEX_HTML)
    emoji = re.search(r"[\U0001F000-\U0001FAFF\u2600-\u27BF]", text)
    assert emoji is None, f"Emoji im Nutzertext: {emoji.group(0)!r}"
    bang = re.search(r"[\wÄÖÜäöüß)\].]!\s*[\"'<]", text)
    assert bang is None, f"Ausrufezeichen am Satzende: {bang.group(0)!r}"
    address = re.search(r"\b(du|dir|dich)\b", text, flags=re.IGNORECASE)
    assert address is None, f"direkte Anrede: {address.group(0)!r}"


# ---------------------------------------------------------------------------
# O44: Der Fallback spricht die Form der gebauten App (web/dist)
# ---------------------------------------------------------------------------
#
# Befund 17.09.2026: Im Browser lief die gebaute App (SPA, Index-Chunk aus
# ``web/dist``), während die Anfragen der Pi (Port 8000) beantwortete — der
# Proxy hielt das NAS für offline. Die SPA las daraufhin ``data.cities`` aus
# einer Antwort, die kein ``cities`` trug (TypeError, weiße Seite), und der
# Verlauf antwortete auf ``station_id`` mit 400, weil der Fallback nur
# ``station`` kannte. Beides ist derselbe Sachverhalt: Die gleichnamigen
# Endpunkte müssen die Form liefern, die die App dort liest.


def test_stations_payload_carries_the_fields_the_app_reads(tmp_path):
    """``cities`` in der Schreibweise der Zeilen, ``observed_at`` je Station."""
    server, _ = start_fallback_server(tmp_path, poll_lines=default_poll_lines())
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        data = get_json(base, "/api/v1/stations?fuel=e10")
        # Die App wählt ihre aktive Stadt aus ``cities`` und filtert dann über
        # ``row.city`` — beide müssen dieselbe Schreibweise tragen (Label),
        # sonst findet sie ihre eigenen Stationen nicht mehr.
        assert data["cities"] == sorted(data["cities"], key=data["cities"].index)
        assert set(data["cities"]) == {s["city"] for s in data["stations"]}
        assert "Frankfurt" in data["cities"]
        # Alter/Frische je Zeile: der Puffer führt den Poll-Stempel als
        # ``fetched_at``, die App liest ``observed_at``.
        for row in data["stations"]:
            assert row["observed_at"] == row["fetched_at"]
            assert row["observed_at"]
        # Die App-Form verlangt diese Felder; ohne sie fällt sie in den
        # Leerzustand, obwohl Preise da sind.
        for key in ("generated_at", "fuel", "fresh_prices", "nas_status"):
            assert key in data
        assert data["calibrated"] is False and data["decision_ready"] is False
    finally:
        server.shutdown()
        server.server_close()


def test_stations_cities_stay_label_city_even_with_short_set_key(tmp_path):
    """Kurzer Set-Key („FRA“) darf die Labels der Zeilen nicht verdrängen."""
    meta_path = tmp_path / "polling.json"
    meta_path.write_text(
        json.dumps(
            {
                "sets": {
                    "FRA": {
                        "label": "Frankfurt",
                        "batch": [UID_B],
                        "stations": [{"uuid": UID_B, "name": "Station Beta"}],
                    }
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    today = dt.datetime.now(LOCAL_TZ).date()
    lines = [
        {
            "fetched_at": local_iso(today, 7, 5),
            "source": "test",
            "city": "Frankfurt",
            "prices": {UID_B: {"status": "open", "e10": 1.700}},
        }
    ]
    # Ohne Metadaten kennt der Puffer nur UUID und Stadt; Namen und Set-Key
    # kommen aus der polling.json — genau der Weg, der „FRA“ und „Frankfurt“
    # auseinanderhält.
    ctx = make_ctx(tmp_path, poll_lines=lines, with_forecast=False, with_meta=False)
    ctx.meta.paths = [meta_path]
    server = rp2.make_server(ctx, "127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        data = get_json(base, "/api/v1/stations?fuel=e10")
        assert data["cities"] == ["Frankfurt"]
        assert data["stations"][0]["city"] == "Frankfurt"
        # Das Fallback-Template behält seine eigene Liste mit dem Set-Key.
        health = get_json(base, "/api/v1/health")
        assert health["city_options"] == [{"value": "FRA", "label": "Frankfurt"}]
    finally:
        server.shutdown()
        server.server_close()


def test_series_accepts_the_app_station_id(tmp_path):
    """``station_id`` (App) und ``station`` (Template) meinen dieselbe UUID."""
    today = dt.datetime.now(LOCAL_TZ).date()
    lines = [
        poll_line(today, 7, 5, {"status": "open", "e10": 1.700}),
        poll_line(today, 7, 55, {"status": "open", "e10": 1.690}),
    ]
    server, _ = start_fallback_server(tmp_path, poll_lines=lines, with_forecast=False)
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        by_id = get_json(base, f"/api/v1/series?station_id={UID_A}&fuel=e10")
        by_name = get_json(base, f"/api/v1/series?station={UID_A}&fuel=e10")
        # Nur der Antwort-Zeitstempel darf sich unterscheiden.
        assert {k: v for k, v in by_id.items() if k != "generated_at"} == {
            k: v for k, v in by_name.items() if k != "generated_at"
        }
        assert by_id["max"]["value"] == 1.690
        # Ohne beide Namen bleibt es der 400er — kein stilles Raten.
        with pytest.raises(urllib.error.HTTPError) as exc:
            get_json(base, "/api/v1/series?fuel=e10")
        assert exc.value.code == 400
    finally:
        server.shutdown()
        server.server_close()
