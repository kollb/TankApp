"""A21-B5.4 (#214): NAS/Pi-Betriebsabnahme — Messrezept-Tooling.

Abnahme: Latenz-Messung (p50/p95/p99) gegen die feste LAN-Messlatte
300 ms, Pollkadenz-Prüfung mit Fensterlogik, RPO/RTO-Wertung mit
Blocker-Regel („Fehlender Zugang ist ein Blocker, kein erfolgreicher
Test") und maschinenlesbares Protokoll. Die Hardware-Strecken selbst
sind offen — siehe docs/betrieb/BETRIEBSABNAHME.md.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from data_tools_shim import load_ops_acceptance

ops = load_ops_acceptance()


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *args):  # noqa: D102
        pass


@pytest.fixture()
def local_server():
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    thread.join(timeout=5)


def test_latency_measurement_reports_percentiles_against_fixed_target(local_server):
    assert ops.ACCEPTANCE_TARGETS["latency_p95_ms"] == 300.0  # Messlatte #214
    result = ops.measure_latency(
        local_server,
        ("/api/v1/health",),
        samples=12,
        warmup=2,
        timeout=5.0,
    )
    entry = result["/api/v1/health"]
    assert entry["n"] == 12 and entry["errors"] == 0
    assert 0 < entry["p50_ms"] <= entry["p95_ms"] <= entry["p99_ms"]
    assert entry["ok"] is True  # Loopback < 300 ms
    # Nicht erreichbares ist ein Blocker, kein stiller Erfolg.
    dead = ops.measure_latency(
        "http://127.0.0.1:1",
        ("/api/v1/health",),
        samples=2,
        warmup=0,
        timeout=0.3,
    )
    assert dead["/api/v1/health"]["ok"] is False
    assert "Blocker" in dead["/api/v1/health"]["note"]


def test_poll_cadence_counts_violations_but_ignores_night_gaps():
    base = datetime.fromisoformat("2026-09-22T06:00:00+02:00")
    # Perfekte Kadenz (5 min) über den Vormittag.
    stamps = [base + timedelta(minutes=5 * i) for i in range(24)]
    ok = ops.check_poll_cadence(stamps)
    assert ok["ok"] is True and ok["violations"] == 0
    assert ok["median_s"] == 300.0
    # Ein ausgefallener Poll am Nachmittag zählt als Verstoß (600-s-Lücke).
    hole = stamps[:12] + stamps[13:]
    bad = ops.check_poll_cadence(hole)
    assert bad["ok"] is False and bad["violations"] == 1
    assert bad["worst_gap_s"] == 600.0
    # Über Nacht (Fenster 06:00–24:00) sind große Lücken Betriebskonzept.
    night = [
        datetime.fromisoformat("2026-09-22T23:55:00+02:00"),
        datetime.fromisoformat("2026-09-23T06:05:00+02:00"),
        datetime.fromisoformat("2026-09-23T06:10:00+02:00"),
    ]
    night_result = ops.check_poll_cadence(night)
    assert night_result["n_night_gaps"] == 1
    assert night_result["violations"] == 0
    assert night_result["ok"] is True
    # Zu wenig Stempel: Blocker statt „bestanden“.
    assert ops.check_poll_cadence([])["ok"] is False


def test_restore_measurement_never_passes_without_manual_stopwatch():
    blocker = ops.restore_measurement(
        rpo_minutes=None, rto_minutes=None, verified=False
    )
    assert blocker["ok"] is False
    assert "Blocker" in blocker["note"]
    good = ops.restore_measurement(rpo_minutes=12, rto_minutes=35, verified=True)
    assert good["ok"] is True and good["rpo_ok"] and good["rto_ok"]
    slow = ops.restore_measurement(rpo_minutes=45, rto_minutes=35, verified=True)
    assert slow["ok"] is False and slow["rpo_ok"] is False
    unverified = ops.restore_measurement(rpo_minutes=12, rto_minutes=35, verified=False)
    assert unverified["ok"] is False


def test_report_keeps_unmeasured_sections_honest(tmp_path, local_server):
    latency = ops.measure_latency(
        local_server, ("/api/v1/overview",), samples=6, warmup=1
    )
    restore = ops.restore_measurement(
        rpo_minutes=None, rto_minutes=None, verified=False
    )
    report = ops.build_report(
        latency=latency,
        cadence=None,
        restore=restore,
        base_url=local_server,
    )
    # Ohne Kadenz- und Restore-Messung bleibt das Urteil „offen“.
    assert report["overall"] == "offen"
    assert report["complete"] is False
    assert report["checks"]["restore"] is False
    json_path, md_path = ops.write_report(report, tmp_path)
    parsed = json.loads(json_path.read_text(encoding="utf-8"))
    assert parsed["targets"]["latency_p95_ms"] == 300.0
    text = md_path.read_text(encoding="utf-8")
    for needle in ("Gesamturteil: **offen**", "Latenz", "Pollkadenz", "Blocker"):
        assert needle in text
    # Vollständig gemessen, aber Latenz verfehlt → ehrlich „nicht bestanden“.
    full = ops.build_report(
        latency={
            "/x": {
                "n": 5,
                "errors": 0,
                "p50_ms": 400.0,
                "p95_ms": 500.0,
                "p99_ms": 500.0,
                "max_ms": 500.0,
                "ok": False,
            }
        },
        cadence={"n_stamps": 10, "n_gaps": 9, "ok": True},
        restore=ops.restore_measurement(rpo_minutes=5, rto_minutes=10, verified=True),
        base_url="http://lan",
    )
    assert full["complete"] is True
    assert full["overall"] == "nicht bestanden"
