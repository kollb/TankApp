"""A4: Jahres-/Monatsbilanz des Wallet-Ledgers (Konzept §12).

„Wallet-Ledger im Alltag, Jahresbilanz in der Werkstatt“: Die Bilanz gruppiert
aktive Belege je Kalendermonat/-jahr (Europe/Berlin), rechnet Ø €/Tankung und
stellt die Ersparnis der „immer sofort getankt“-Baseline gegenüber. Getestet
werden die Gruppierung, der Umgang mit Storno/Altbeständen und der Endpunkt
``GET /api/v1/fills/summary``.
"""

import datetime as dt
import json
import threading
import urllib.request

import pytest

from app.config import Settings
from app.data import LiveData
from app.feedback import compute_wallet_balance
from app.server import make_server

NOW = dt.datetime(2026, 9, 12, 12, 0, tzinfo=dt.timezone.utc)


def fill(fill_id, tanked_at, liters, price_paid, saved=0.0, voided=False):
    return {
        "id": fill_id,
        "tanked_at": tanked_at,
        "liters": liters,
        "price_paid": price_paid,
        "saved_vs_always_now_eur": saved,
        "voided": voided,
    }


def test_balance_groups_by_berlin_month_and_year():
    store = {
        "fills": [
            fill("a", "2026-09-01T10:00:00+02:00", 40, 1.70, saved=1.2),
            fill("b", "2026-09-20T10:00:00+02:00", 35, 1.65, saved=0.8),
            fill("c", "2026-08-30T23:30:00+02:00", 40, 1.80),
            # Kurz vor Mitternacht UTC — in Berlin schon der 1. Januar.
            # Die Bilanz folgt dem Kalender des Nutzers, nicht UTC.
            fill("d", "2025-12-31T23:30:00+00:00", 45, 1.60, saved=-0.5),
            fill("e", "2025-11-20T10:00:00+00:00", 50, 1.55, saved=0.6),
        ]
    }
    balance = compute_wallet_balance(store, now=NOW)
    assert [m["key"] for m in balance["months"]] == [
        "2026-09",
        "2026-08",
        "2026-01",
        "2025-11",
    ]
    september = balance["months"][0]
    assert september["fills"] == 2
    assert september["liters"] == 75.0
    assert september["total_eur"] == round(40 * 1.70 + 35 * 1.65, 2)
    assert september["avg_eur_per_fill"] == round(september["total_eur"] / 2, 2)
    assert september["avg_eur_per_liter"] == round(september["total_eur"] / 75, 3)
    assert september["saved_eur"] == 2.0
    # Baseline = „immer sofort getankt“: total + saved.
    assert september["baseline_eur"] == round(september["total_eur"] + 2.0, 2)

    assert [y["key"] for y in balance["years"]] == ["2026", "2025"]
    assert balance["years"][0]["fills"] == 4
    assert balance["years"][0]["liters"] == 160.0
    assert balance["years"][1]["fills"] == 1

    overall = balance["overall"]
    assert overall["fills"] == 5
    assert overall["saved_eur"] == 2.1
    assert overall["n_without_date"] == 0
    assert overall["saved_pct"] == round(100 * 2.1 / overall["baseline_eur"], 1)


def test_balance_excludes_voided_and_reports_undated_fills():
    store = {
        "fills": [
            fill("a", "2026-09-01T10:00:00+02:00", 40, 1.70, saved=1.2),
            fill("void", "2026-09-02T10:00:00+02:00", 99, 3.50, saved=9.9, voided=True),
            fill("bad", "kein Datum", 30, 1.60),
        ]
    }
    balance = compute_wallet_balance(store, now=NOW)
    assert balance["months"][0]["fills"] == 1
    assert balance["n_fills_total"] == 2
    # Der undatierte Beleg zählt in die Gesamtsumme, fehlt aber in keiner
    # Monatszeile — die Differenz wird genannt, nicht verschwiegen.
    assert balance["overall"]["fills"] == 2
    assert balance["overall"]["n_without_date"] == 1


def test_balance_empty_store_is_honest_zero():
    balance = compute_wallet_balance({"fills": []}, now=NOW)
    assert balance["months"] == [] and balance["years"] == []
    assert balance["overall"]["fills"] == 0
    assert balance["overall"]["avg_eur_per_fill"] is None
    assert balance["overall"]["saved_pct"] is None


@pytest.fixture
def balance_settings(tmp_path):
    static = tmp_path / "web"
    static.mkdir()
    (static / "index.html").write_text("<html>test</html>")
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=tmp_path / "polling.json",
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "netrc",
        static=static,
    )


def _write_store(settings, fills):
    path = settings.runtime / "feedback" / "store.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"schema_version": 2, "episodes": [], "fills": fills}),
        encoding="utf-8",
    )


def test_fills_summary_endpoint_serves_recorded_fills(balance_settings):
    _write_store(
        balance_settings,
        [
            fill("a", "2026-09-01T10:00:00+02:00", 40, 1.70, saved=1.2),
            fill("b", "2026-08-15T10:00:00+02:00", 38, 1.78, saved=0.4),
        ],
    )
    live = LiveData(balance_settings, query=lambda *_: [], clock=lambda: NOW)
    server = make_server(balance_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(base + "/api/v1/fills/summary") as response:
            status, body = response.status, json.loads(response.read().decode())
        assert status == 200
        assert body["error_code"] is None
        assert [m["key"] for m in body["months"]] == ["2026-09", "2026-08"]
        assert body["overall"]["fills"] == 2
        assert body["overall"]["avg_eur_per_fill"] is not None
        assert "generated_at" in body
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
