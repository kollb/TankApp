"""O1 — Die Tankuhrzeit kommt aus dem Beleg, nicht aus der 12-Uhr-Projektion.

Vor 0.44.0 las ``record_fill`` die Stunde aus einem Feld, das die GUI nie
sendet (``clock_hour``), und fiel auf 12 Uhr zurück: Jeder über die GUI
erfasste Beleg landete im w(h)-Histogramm bei 12 — ab dem achten Beleg stand
die Personalisierung der Fensterreihenfolge damit auf einer Uhrzeit, die nie
gemessen wurde (docs/archiv/OPTIMIERUNGS-BEFUND-2026-09-18.md O1).

Geprüft wird hier der DoD-Nachweis:
  * ``tanked_at`` 18:40 Europe/Berlin → ``clock_hour == 18``,
    ``clock_hour_source == "beleg"`` (auch wenn der Client UTC schickt),
  * ein Beleg ohne Zeitstempel → Uhrzeit aus dem Server-Zeitstempel und
    ``"server"`` (O43), statt einer erfundenen 12-Uhr-Zelle,
  * dieselben Werte kommen über ``GET /api/v1/fills`` zurück,
  * das w(h)-Histogramm liegt nach Abendbelegen bei 18 und nicht bei 12,
  * Altbestände werden migriert **mit Kennzeichnung** statt still
    umgeschrieben, und die Migration ist idempotent.
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.data import LiveData
from app.feedback import (
    CLOCK_HOUR_DEFAULT,
    FEEDBACK_SCHEMA_VERSION,
    WH_MIN_FILLS,
    compute_wallet_stats,
    load_store,
    migrate_store,
    record_fill,
    record_snapshot,
)

UID = "00000000-0000-0000-0000-000000000001"
# 14:00 UTC = 16:00 Europe/Berlin (Sommerzeit) — Buchungszeitpunkt der Tests.
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
        "TANKAPP_INFLUX_URL=http://nas:8086\nTANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\nTANKAPP_INFLUX_TOKEN=dummy\n"
    )
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "netrc",
    )


def _fill(settings, **overrides):
    payload = {"station_id": UID, "liters": 40, "price_paid": 1.7, **overrides}
    return record_fill(settings, payload, clock=lambda: NOW)


# --- Ratchet: gemessene Uhrzeit statt erfundener 12 -------------------------


def test_evening_receipt_is_booked_at_18_not_12(settings_with_station):
    """Der DoD-Fall: 18:40 Europe/Berlin ergibt Stunde 18 mit Herkunft „beleg“."""
    fill = _fill(
        settings_with_station, tanked_at="2026-09-14T18:40:00+02:00", id="fill-abend"
    )
    assert fill["clock_hour"] == 18
    assert fill["clock_hour_source"] == "beleg"


def test_utc_timestamp_is_converted_to_berlin(settings_with_station):
    """Die GUI schickt UTC (``new Date().toISOString()``) — gerechnet wird lokal."""
    fill = _fill(settings_with_station, tanked_at="2026-09-14T16:40:00Z", id="fill-utc")
    assert fill["clock_hour"] == 18
    assert fill["clock_hour_source"] == "beleg"
    # Winterzeit: 17:40 UTC = 18:40 MEZ — dieselbe lokale Stunde, anderes
    # Offset. Eigener Buchungszeitpunkt, das Beleg-Fenster liegt 90 Tage zurück.
    winter_now = dt.datetime(2026, 1, 15, 14, 0, tzinfo=dt.timezone.utc)
    winter = record_fill(
        settings_with_station,
        {
            "id": "fill-winter",
            "station_id": UID,
            "liters": 40,
            "price_paid": 1.7,
            "tanked_at": "2026-01-14T17:40:00Z",
        },
        clock=lambda: winter_now,
    )
    assert winter["clock_hour"] == 18
    assert winter["clock_hour_source"] == "beleg"


def test_receipt_without_timestamp_uses_server_time_and_says_so(settings_with_station):
    """O43: no receipt timestamp derives weekday/hour from the server clock."""
    fill = _fill(settings_with_station, id="fill-ohne-zeit")
    assert fill["clock_hour"] == 16  # 14:00 UTC = 16:00 CEST
    assert fill["clock_hour_source"] == "server"
    assert fill["tanked_at"] == NOW.isoformat()


def test_explicit_clock_hour_without_timestamp_does_not_override_server_time(
    settings_with_station,
):
    """A detached client clock cannot contradict the server booking timestamp."""
    fill = _fill(settings_with_station, clock_hour=6.5, id="fill-explicit")
    assert fill["clock_hour"] == 16
    assert fill["clock_hour_source"] == "server"


def test_timestamp_wins_over_contradicting_clock_hour(settings_with_station):
    """Eine Wahrheit: Beleg-Zeit und Beleg-Stunde dürfen sich nicht widersprechen."""
    fill = _fill(
        settings_with_station,
        tanked_at="2026-09-14T18:40:00+02:00",
        clock_hour=3,
        id="fill-widerspruch",
    )
    assert fill["clock_hour"] == 18
    assert fill["clock_hour_source"] == "beleg"


def test_detached_clock_hour_is_ignored_without_a_receipt_timestamp(
    settings_with_station,
):
    fill = _fill(settings_with_station, clock_hour=27, id="fill-ueberlauf")
    assert fill["clock_hour"] == 16
    assert fill["clock_hour_source"] == "server"
    garbage = _fill(settings_with_station, clock_hour="viel", id="fill-muell")
    assert garbage["clock_hour"] == 16
    assert garbage["clock_hour_source"] == "server"


# --- API: dieselben Werte über GET /api/v1/fills ----------------------------


def test_fills_endpoint_shows_hour_and_source(settings_with_station):
    live = LiveData(settings_with_station, query=lambda *_: [], clock=lambda: NOW)
    posted = live.record_fill(
        {
            "id": "fill-api",
            "station_id": UID,
            "liters": 41.0,
            "price_paid": 1.669,
            "tanked_at": "2026-09-14T18:40:00+02:00",
        }
    )
    assert posted.get("error_code") is None, posted
    payload = live.fills()
    assert payload["error_code"] is None
    row = next(f for f in payload["fills"] if f["id"] == "fill-api")
    assert {
        "tanked_at": row["tanked_at"],
        "clock_hour": row["clock_hour"],
        "clock_hour_source": row["clock_hour_source"],
    } == {
        "tanked_at": "2026-09-14T18:40:00+02:00",
        "clock_hour": 18,
        "clock_hour_source": "beleg",
    }


# --- Wirkung: das w(h)-Histogramm lernt aus Abendbelegen --------------------


def test_wh_histogram_moves_to_the_measured_evening_hour(settings_with_station):
    """Check aus dem Befund: Gewicht bei 18, nicht bei 12."""
    for index in range(WH_MIN_FILLS):
        _fill(
            settings_with_station,
            id=f"fill-abend-{index}",
            tanked_at=f"2026-09-{5 + index:02d}T18:40:00+02:00",
        )
    wallet = compute_wallet_stats(load_store(settings_with_station), now=NOW)
    assert wallet["wh_personalized"] is True
    assert wallet["wh_n"] == WH_MIN_FILLS
    hours = wallet["wh_hours"]
    assert hours[18] > hours[12]
    assert hours[18] == max(hours)
    # Herkunft: alle Belege gemessen, keiner auf der erfundenen 12.
    assert wallet["wh_clock_sources"] == {
        "beleg": WH_MIN_FILLS,
        "server": 0,
        "abgeleitet": 0,
        "default": 0,
    }
    assert wallet["wh_measured_n"] == WH_MIN_FILLS
    assert wallet["wh_default_n"] == 0


def test_wh_histogram_names_server_booked_hours(settings_with_station):
    """O43: timestamp-free receipts use the server's real local hour, not 12."""
    for index in range(WH_MIN_FILLS):
        _fill(settings_with_station, id=f"fill-ohne-{index}")
    wallet = compute_wallet_stats(load_store(settings_with_station), now=NOW)
    assert wallet["wh_n"] == WH_MIN_FILLS
    assert wallet["wh_default_n"] == 0
    assert wallet["wh_measured_n"] == WH_MIN_FILLS
    assert wallet["wh_clock_sources"] == {
        "beleg": 0,
        "server": WH_MIN_FILLS,
        "abgeleitet": 0,
        "default": 0,
    }
    assert wallet["wh_hours"][16] == max(wallet["wh_hours"])


def test_voided_fills_do_not_count_into_the_provenance(settings_with_station):
    from app.feedback import void_fill

    _fill(settings_with_station, id="fill-aktiv", tanked_at="2026-09-14T18:40:00+02:00")
    _fill(
        settings_with_station, id="fill-storno", tanked_at="2026-09-13T06:10:00+02:00"
    )
    void_fill(settings_with_station, "fill-storno", clock=lambda: NOW)
    wallet = compute_wallet_stats(load_store(settings_with_station), now=NOW)
    assert wallet["wh_clock_sources"]["beleg"] == 1


# --- Migration: Altbestand mit Kennzeichnung, nicht still -------------------


def legacy_store() -> dict:
    """Ein Store im Stand 0.43 (Schema 3): Belege ohne ``clock_hour_source``."""
    return {
        "schema_version": 3,
        "episodes": [],
        "settlements": [],
        "audit": [],
        "fills": [
            {
                "id": "fill_alt_1",
                "station_id": UID,
                "tanked_at": "2026-08-01T16:40:00+00:00",
                "clock_hour": 12.0,
                "liters": 41.2,
                "price_paid": 1.689,
                "fuel": "e10",
            },
            {
                "id": "fill_alt_2",
                "station_id": UID,
                "clock_hour": 12.0,
                "liters": 38.0,
                "price_paid": 1.709,
                "fuel": "e10",
            },
            {
                "id": "fill_alt_3",
                "station_id": UID,
                "clock_hour": 6.5,
                "liters": 38.0,
                "price_paid": 1.709,
                "fuel": "e10",
            },
        ],
    }


def test_migration_reconstructs_hours_and_marks_them():
    store = migrate_store(legacy_store())
    # O5 (0.45.0): Schema 4 → 5 — die Stunden-Rekonstruktion (O1) läuft auf
    # dem Weg mit, das Ziel ist die aktuelle Version.
    assert store["schema_version"] == FEEDBACK_SCHEMA_VERSION == 6
    by_id = {fill["id"]: fill for fill in store["fills"]}
    # 16:40 UTC = 18:40 Europe/Berlin (Sommerzeit) — rekonstruiert, gekennzeichnet.
    assert by_id["fill_alt_1"]["clock_hour"] == 18
    assert by_id["fill_alt_1"]["clock_hour_source"] == "abgeleitet"
    # Ohne Zeitstempel bleibt die erfundene 12 — jetzt sichtbar als Default.
    assert by_id["fill_alt_2"]["clock_hour"] == CLOCK_HOUR_DEFAULT
    assert by_id["fill_alt_2"]["clock_hour_source"] == "default"
    # Eine von einem Client genannte Stunde bleibt stehen (Herkunft „beleg“).
    assert by_id["fill_alt_3"]["clock_hour"] == 6.5
    assert by_id["fill_alt_3"]["clock_hour_source"] == "beleg"


def test_migration_is_idempotent_and_keeps_everything_else():
    once = migrate_store(legacy_store())
    twice = migrate_store(json.loads(json.dumps(once)))
    assert twice == once
    # Idempotenz auch gegen erneutes Laden desselben Bestands.
    assert migrate_store(json.loads(json.dumps(twice))) == twice


def test_migrated_store_is_written_once_and_serves_the_histogram(
    settings_with_station,
):
    path = settings_with_station.runtime / "feedback" / "store.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(legacy_store()), encoding="utf-8")

    store = load_store(settings_with_station)
    assert store["fills"][0]["clock_hour_source"] == "abgeleitet"

    # Ein neuer Beleg schreibt den migrierten Bestand mit Kennzeichnung zurück.
    _fill(settings_with_station, id="fill_neu", tanked_at="2026-09-14T18:40:00+02:00")
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["schema_version"] == FEEDBACK_SCHEMA_VERSION
    sources = {fill["id"]: fill["clock_hour_source"] for fill in raw["fills"]}
    assert sources["fill_neu"] == "beleg"
    assert sources["fill_alt_1"] == "abgeleitet"
    assert sources["fill_alt_2"] == "default"


# --- Snapshots: keine erfundene Emit-Uhrzeit mehr ---------------------------


def test_snapshot_without_clock_hour_uses_the_emit_time(settings_with_station):
    _store, episode = record_snapshot(
        settings_with_station,
        {"action": "no_advice", "decline_reason": "kein Fenster"},
        clock=lambda: NOW,
    )
    snap = episode["snapshots"][0]
    # 14:00 UTC = 16:00 Europe/Berlin — gemessen, nicht 12 Uhr.
    assert snap["clock_hour"] == pytest.approx(16.0)
    assert snap["emitted_at"] == NOW.isoformat()


def test_snapshot_keeps_the_hour_it_is_given(settings_with_station):
    _store, episode = record_snapshot(
        settings_with_station,
        {"action": "no_advice", "clock_hour": 7.25},
        clock=lambda: NOW,
    )
    assert episode["snapshots"][0]["clock_hour"] == 7.25
