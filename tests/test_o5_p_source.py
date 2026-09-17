"""O5 — Das M7-Gate mischt zwei Wahrscheinlichkeitsquellen (jetzt nicht mehr).

Vor 0.45.0 buk ``record_snapshot`` die Verteilungs-P und die
selbstkalibrierte Ledger-Quote (``estimate_p``) in eine Zahl (``p_correct``):
Der Brier-Score mischte beide Quellen, und das M7-Gate konnte sich über die
Basisrate selbst erfüllen (docs/OPTIMIERUNGS-BEFUND.md O5).

Geprüft wird hier der DoD-Nachweis:
  * jede Snapshot-Zeile trägt ``p_source`` (``verteilung``|``basisrate``|``keine``),
  * der Brier wird je Quelle getrennt ausgewiesen (30 Tage und Allzeit),
  * das Gate rechnet ausschließlich über ``p_source == "verteilung"``,
  * Altbestände werden **mit Kennzeichnung** rekonstruiert (Migration 4 → 5,
    idempotent) — Snapshots wie Belegpreise (O17-Anteil: ``price_source``).
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.data import LiveData
from app.feedback import (
    FEEDBACK_SCHEMA_VERSION,
    compute_advice_stats,
    feedback_path,
    locked_store,
    migrate_store,
    record_snapshot,
    snapshot_p_source,
)

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 15, 14, 0, tzinfo=dt.timezone.utc)


@pytest.fixture
def settings_with_station(tmp_path):
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
        "TANKAPP_INFLUX_URL=http://nas:8086\\nTANKAPP_INFLUX_ORG=local\\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\\nTANKAPP_INFLUX_TOKEN=dummy\\n"
    )
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
    )


def _snap_payload(**overrides):
    payload = {
        "action": "wait",
        "city": "Frankfurt",
        "station_id": UID,
        "station_name": "Station Alpha",
        "price_now": 1.789,
        "fuel": "e10",
    }
    payload.update(overrides)
    return payload


def test_snapshot_with_distribution_p_is_marked_verteilung(settings_with_station):
    """Verteilungs-P aus den Draws → Quelle ``verteilung`` (O5-Kern)."""
    store, ep = record_snapshot(
        settings_with_station, _snap_payload(p_besser=0.75), clock=lambda: NOW
    )
    snap = ep["snapshots"][-1]
    assert snap["p_besser"] == 0.75
    assert snap["p_correct"] == 0.75
    assert snap["p_source"] == "verteilung"


def test_snapshot_without_distribution_p_falls_back_to_basisrate(
    settings_with_station,
):
    """Ohne Draws greift die Ledger-Quote — als ``basisrate`` benannt."""
    store, ep = record_snapshot(
        settings_with_station, _snap_payload(), clock=lambda: NOW
    )
    snap = ep["snapshots"][-1]
    assert snap["p_besser"] is None
    # Leerer Store: Laplace-Quote (0 + 10·0,5)/(0 + 10) = 0,5.
    assert snap["p_correct"] == 0.5
    assert snap["p_source"] == "basisrate"


def test_snapshot_without_any_p_is_marked_keine(settings_with_station):
    """``no_advice`` kennt keine Aktionsschätzung → ``keine`` statt erfundener Zahl."""
    store, ep = record_snapshot(
        settings_with_station, _snap_payload(action="no_advice"), clock=lambda: NOW
    )
    snap = ep["snapshots"][-1]
    assert snap["p_correct"] is None
    assert snap["p_source"] == "keine"


def test_non_finite_distribution_p_falls_back_to_basisrate(settings_with_station):
    """Eine NaN-Verteilungs-P ist keine Messung — Fallback statt NaN im Ledger."""
    store, ep = record_snapshot(
        settings_with_station, _snap_payload(p_besser=float("nan")), clock=lambda: NOW
    )
    snap = ep["snapshots"][-1]
    assert snap["p_besser"] is None
    assert snap["p_correct"] == 0.5
    assert snap["p_source"] == "basisrate"


def test_migration_marks_old_snapshots_with_source():
    """Migration 4 → 5 rekonstruiert die Quelle — mit Kennzeichnung (O5)."""
    raw = {
        "schema_version": 4,
        "episodes": [
            {
                "id": "ep",
                "snapshots": [
                    {"id": "s_dist", "p_besser": 0.75, "p_correct": 0.75},
                    {"id": "s_base", "p_besser": None, "p_correct": 0.5},
                    {"id": "s_none", "action": "no_advice"},
                ],
                "first_snapshot": {"id": "s_dist", "p_besser": 0.75, "p_correct": 0.75},
                "last_snapshot": {"id": "s_none", "action": "no_advice"},
            }
        ],
        "fills": [],
        "settlements": [],
        "audit": [],
    }
    store = migrate_store(raw)
    assert store["schema_version"] == FEEDBACK_SCHEMA_VERSION == 6
    by_id = {s["id"]: s for s in store["episodes"][0]["snapshots"]}
    assert by_id["s_dist"]["p_source"] == "verteilung"
    assert by_id["s_base"]["p_source"] == "basisrate"
    assert by_id["s_none"]["p_source"] == "keine"
    # Erst-/Letzt-Sicht laufen mit (keine zweite Wahrheit nach Migration).
    assert store["episodes"][0]["first_snapshot"]["p_source"] == "verteilung"
    assert store["episodes"][0]["last_snapshot"]["p_source"] == "keine"
    # Idempotent: ein zweiter Lauf schreibt nichts um.
    again = migrate_store(store)
    assert again["episodes"][0]["snapshots"] == store["episodes"][0]["snapshots"]


def test_migration_backfills_fill_price_source():
    """Migration 4 → 5 kennzeichnet alte Belegpreise (O17-Anteil).

    Ein-Tipp-Belege aus der Zeit des gebuchten Prognose-Medians gelten als
    ``prognose``; explizit mitgeschickte Preise als ``manuell``.
    """
    raw = {
        "schema_version": 4,
        "episodes": [],
        "fills": [
            {"id": "f1", "source": "prompt", "price_source": "explicit"},
            {"id": "f2", "source": "manual", "price_source": "explicit"},
            {"id": "f3", "source": "manual", "price_source": "nowcast"},
            {"id": "f4", "source": "manual"},
        ],
        "settlements": [],
        "audit": [],
    }
    store = migrate_store(raw)
    by_id = {f["id"]: f for f in store["fills"]}
    assert by_id["f1"]["price_source"] == "prognose"
    assert by_id["f2"]["price_source"] == "manuell"
    assert by_id["f3"]["price_source"] == "nowcast"
    assert by_id["f4"]["price_source"] == "manuell"
    again = migrate_store(store)
    assert [f["price_source"] for f in again["fills"]] == [
        "prognose",
        "manuell",
        "nowcast",
        "manuell",
    ]


def test_unmigrated_snapshot_is_reconstructed_defensively():
    """Handgebaute Zeilen ohne ``p_source`` folgen derselben Regel."""
    assert snapshot_p_source({"p_besser": 0.7, "p_correct": 0.7}) == "verteilung"
    assert snapshot_p_source({"p_correct": 0.5}) == "basisrate"
    assert snapshot_p_source({"action": "no_advice"}) == "keine"
    assert snapshot_p_source(None) == "keine"
    # Explizit gespeicherte Quelle gewinnt gegen die Rekonstruktion.
    assert snapshot_p_source({"p_source": "keine", "p_correct": 0.5}) == "keine"


def test_brier_is_reported_per_source():
    """Der Brier steht je Quelle — der gemischte Score bleibt benannt daneben."""
    store = {
        "episodes": [
            {
                "id": "ep",
                "snapshots": [
                    {
                        "id": "s_v1",
                        "action": "wait",
                        "p_correct": 0.9,
                        "p_source": "verteilung",
                    },
                    {
                        "id": "s_v2",
                        "action": "wait",
                        "p_correct": 0.9,
                        "p_source": "verteilung",
                    },
                    {
                        "id": "s_b1",
                        "action": "wait",
                        "p_correct": 0.6,
                        "p_source": "basisrate",
                    },
                    {
                        "id": "s_b2",
                        "action": "wait",
                        "p_correct": 0.6,
                        "p_source": "basisrate",
                    },
                ],
            }
        ],
        "settlements": [
            {"snapshot_id": sid, "outcome": "win"}
            for sid in ("s_v1", "s_v2", "s_b1", "s_b2")
        ],
    }
    advice = compute_advice_stats(store)
    assert advice["brier_by_source"]["verteilung"] == {"brier": 0.01, "n": 2}
    assert advice["brier_by_source"]["basisrate"] == {"brier": 0.16, "n": 2}
    assert advice["brier_30d"] == 0.085
    assert advice["p_source_counts"] == {"verteilung": 2, "basisrate": 2, "keine": 0}
    assert advice["brier_all_by_source"]["verteilung"]["n"] == 2
    assert advice["brier_all_by_source"]["basisrate"]["n"] == 2


def test_gate_ignores_basisrate_rows():
    """100 Basisraten-Treffer öffnen das Gate nicht (Selbsttäuschungs-Schutz)."""
    snaps = [
        {"id": f"s_b{i}", "action": "wait", "p_correct": 0.9, "p_source": "basisrate"}
        for i in range(100)
    ] + [
        {"id": f"s_v{i}", "action": "wait", "p_correct": 0.9, "p_source": "verteilung"}
        for i in range(5)
    ]
    store = {
        "episodes": [{"id": "ep", "snapshots": snaps}],
        "settlements": [{"snapshot_id": s["id"], "outcome": "win"} for s in snaps],
    }
    advice = compute_advice_stats(store)
    assert advice["n_all"] == 105
    assert advice["gate_n"] == 5
    assert advice["gate_brier"] == 0.01
    assert advice["calibrated"] is False
    assert advice["gate_status"] == (
        "Kalibrierung nicht messbar (n=105, nur 5 mit Verteilungs-P im Ledger)"
    )


def test_gate_opens_on_distribution_p_only():
    """100 Verteilungs-Zeilen mit Skill → Gate offen (Konzept §0.4, O6).

    O6: Die Obergrenze des Intervalls muss unter beiden Referenzen liegen —
    reine Treffer (Basisraten-Referenz 0,0) bestünden nicht. Der Aufbau
    diskriminiert (hohe P auf Treffern, niedrige auf Nieten) über 20 Tage.
    """
    now = dt.datetime(2026, 9, 10, 14, 0, tzinfo=dt.timezone.utc)
    snaps = []
    settlements = []
    for i in range(100):
        win = i < 70
        snaps.append(
            {
                "id": f"s{i}",
                "action": "wait",
                "p_correct": 0.9 if win else 0.1,
                "p_source": "verteilung",
                "emitted_at": (
                    now - dt.timedelta(days=i // 5, hours=i % 9)
                ).isoformat(),
            }
        )
        settlements.append(
            {"snapshot_id": f"s{i}", "outcome": "win" if win else "loss"}
        )
    store = {"episodes": [{"id": "ep", "snapshots": snaps}], "settlements": settlements}
    advice = compute_advice_stats(store)
    assert advice["gate_n"] == 100
    assert advice["gate_brier"] == 0.01
    assert advice["calibrated"] is True
    assert advice["gate_status"].startswith("Kalibriert (n=100, Brier 0,01 [")


def test_diary_carries_p_source_after_migration(settings_with_station):
    """Das Tagebuch nennt je Zeile die P-Quelle — auch nach Migration (O5)."""
    raw = {
        "schema_version": 4,
        "episodes": [
            {
                "id": "ep_o5",
                "status": "resolved",
                "snapshots": [
                    {
                        "id": "s_o5",
                        "action": "wait",
                        "station_id": UID,
                        "station_name": "Station Alpha",
                        "city": "Frankfurt",
                        "fuel": "e10",
                        "p_besser": 0.75,
                        "p_correct": 0.75,
                    }
                ],
            }
        ],
        "fills": [],
        "settlements": [
            {
                "snapshot_id": "s_o5",
                "episode_id": "ep_o5",
                "settled_at": NOW.isoformat(),
                "outcome": "win",
            }
        ],
        "audit": [],
    }
    path = feedback_path(settings_with_station)
    path.write_text(json.dumps(raw), encoding="utf-8")
    live = LiveData(settings_with_station, query=lambda *_: [], clock=lambda: NOW)
    diary = live.diary()
    assert diary["error_code"] is None
    assert diary["entries"][0]["p_source"] == "verteilung"
    # Die Migration hat den Store auf dem Weg gehoben (Lesen migriert im
    # Speicher; der nächste Schreibvorgang sichert die Version).
    with locked_store(settings_with_station) as store:
        assert store["schema_version"] == FEEDBACK_SCHEMA_VERSION == 6
