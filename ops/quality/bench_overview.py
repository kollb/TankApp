"""Benchmark des Overview-Lesepfads (A21-B2.2, Issue #203).

Gegenstueck zum Audit-Skript aus Issue #197: misst je Bestandsgroesse den
ungecachten Overview (Lesezustand wird neu gebaut) und den Speichertreffer,
und zaehlt die Advice-Rechnungen je Anfrage. Die Zahlen stehen in
docs/entwicklung/QUALITAET.md ("Overview-Lesepfad nach der Entkopplung").

Die Test-Helfer aus ``tests/`` werden bewusst mitbenutzt: derselbe
synthetische Ledger wie im Audit, keine Produktionsdaten, kein Netz.

Ausfuehren (Repository-Wurzel)::

    OPENBLAS_NUM_THREADS=1 python ops/quality/bench_overview.py

Die Ausgabe ist eine JSON-Zeile je Stufe. Sandkastenzahlen sind keine
NAS-Abnahme: p95 <= 300 ms auf der Zielhardware ist Issue #214.
"""

import datetime as dt
import json
import os
import statistics
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]
os.environ["TANKAPP_OSRM"] = "0"

from test_b5 import NOW, UID, query, settings_with_prices  # noqa: E402
from test_o6_gate_interval import _skill_rows, _store  # noqa: E402

import app.feedback as feedback  # noqa: E402
import app.read_state as read_state  # noqa: E402
from app.data import LiveData  # noqa: E402
from engine.storage import write_json  # noqa: E402

params = {
    "city": "Frankfurt",
    "fuel": "e10",
    "station_id": UID,
    "liters": "55",
    "value_of_time": "0",
    "consumption": "7",
    "speed_kmh": "40",
    "mode": "onroute",
    "tank_percent": "25",
    "tank_capacity_l": "55",
}

with tempfile.TemporaryDirectory(prefix="tankapp-perf-") as tmp:
    settings = settings_with_prices.__wrapped__(Path(tmp))
    history = []
    for k in range(7 * 288):
        stamp = NOW - dt.timedelta(minutes=5 * k)
        if stamp.astimezone(dt.timezone(dt.timedelta(hours=2))).hour >= 6:
            history.append(
                {
                    "city": "Frankfurt",
                    "station_id": UID,
                    "fuel": "e10",
                    "_time": stamp.isoformat(),
                    "price": 1.7,
                    "status": "open",
                }
            )
    history.reverse()
    query_count = [0]

    def influx(_cfg, flux, *args, **kwargs):
        if "|> last()" in flux:
            return query(_cfg, flux)
        query_count[0] += 1
        return iter(history)

    write_json(
        settings.runtime / "engine" / "current.json",
        {"published_at": NOW.isoformat(), "forecasts": []},
    )
    for n_days in (0, 20, 100, 200):
        feedback.save_store(
            settings, {**feedback._empty_feedback_store(), **_store(_skill_rows(n_days))}
        )
        live = LiveData(settings, query=influx, clock=lambda: NOW)
        live.stations()
        read_state.clear_cache()
        calls = []
        original = feedback.compute_advice_stats

        def timed(*a, **kw):
            start = time.perf_counter()
            value = original(*a, **kw)
            calls.append(time.perf_counter() - start)
            return value

        with patch.object(feedback, "compute_advice_stats", timed):
            cold = []
            for index in range(3):
                read_state.clear_cache()
                live.overview_cache.clear()
                start = time.perf_counter()
                result = live.overview(params, f"bench-{index}")
                cold.append(time.perf_counter() - start)
            # "warm" misst nur den Lesezustand: Antwort-Memo wird geleert,
            # die Revision bleibt -> die Statistik kommt aus der Ablage.
            before_warm = len(calls)
            warm = []
            for index in range(3, 6):
                live.overview_cache.clear()
                start = time.perf_counter()
                live.overview(params, f"bench-{index}")
                warm.append(time.perf_counter() - start)
            warm_calls = len(calls) - before_warm
        print(
            json.dumps(
                {
                    "gate_rows": 8 * n_days,
                    "day_blocks": n_days,
                    "cold_ms": [round(v * 1000, 1) for v in cold],
                    "cold_median_ms": round(statistics.median(cold) * 1000, 1),
                    "warm_median_ms": round(statistics.median(warm) * 1000, 2),
                    "advice_calls_cold": before_warm,
                    "advice_calls_warm": warm_calls,
                    "errors": {
                        k: result[k].get("error_code")
                        for k in ("decide", "stats_summary")
                    },
                }
            ),
            flush=True,
        )
