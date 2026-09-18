"""O17 — Ein Tipp bucht den Prognosepreis als gezahlten Preis (jetzt nicht mehr).

Vor 0.45.0 trug „Ja, wie empfohlen“ den **erwarteten** Preis (Median der
Prognose) als ``price_paid`` ein — Wallet-Bilanz und Güte-Kennzahlen
rechneten mit einem Preis, den niemand gezahlt hat
(docs/archiv/OPTIMIERUNGS-BEFUND-2026-09-18.md O17).

Geprüft wird hier der Server-Anteil des DoD:
  * der Client deklariert die Preis-Herkunft (``live``|``manuell``),
    alles andere ist ``invalid_price_source`` (400),
  * ein Ein-Tipp-Beleg (``source == "prompt"``) ohne Live-Nachweis wird mit
    ``prompt_price_not_live`` (400) abgewiesen statt gebucht,
  * Belege mit Prognosepreis (nur via Migration 4 → 5) zählen nicht in die
    verifizierte Ersparnis — die zweite, ausdrücklich so benannte Spalte.
"""

import datetime as dt
import json

import pytest

from app.config import Settings
from app.feedback import (
    compute_wallet_balance,
    compute_wallet_stats,
    record_fill,
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


class _LiveWithPrice:
    """LiveData-Stub: frischer Poll-Preis für die Station (Nowcast)."""

    def __init__(self, price):
        self._price = price

    def stations(self, fuel, city):
        return {"stations": [{"station_id": UID, "price": self._price}]}


def _fill_payload(**overrides):
    payload = {
        "station_id": UID,
        "station_name": "Station Alpha",
        "liters": 40,
        "price_paid": 1.709,
        "fuel": "e10",
        "source": "manual",
        "tanked_at": NOW.isoformat(),
    }
    payload.update(overrides)
    return payload


def test_declared_price_source_is_stored(settings_with_station):
    """``live``/``manuell`` kommen vom Client und stehen am Beleg."""
    live = record_fill(
        settings_with_station,
        _fill_payload(source="prompt", price_source="live"),
        live_data=None,
        clock=lambda: NOW,
    )
    assert live["price_source"] == "live"
    manual = record_fill(
        settings_with_station,
        _fill_payload(price_source="manuell", tanked_at=NOW.isoformat()),
        live_data=None,
        clock=lambda: NOW,
    )
    assert manual["price_source"] == "manuell"


def test_explicit_price_without_declaration_is_manual(settings_with_station):
    """Ein Preis ohne Herkunft ist per Definition nicht live-verifiziert."""
    fill = record_fill(
        settings_with_station, _fill_payload(), live_data=None, clock=lambda: NOW
    )
    assert fill["price_source"] == "manuell"


def test_unknown_price_source_is_rejected(settings_with_station):
    """Unbekannte Herkunft → 400-Code statt stiller Buchung."""
    with pytest.raises(ValueError, match="invalid_price_source"):
        record_fill(
            settings_with_station,
            _fill_payload(price_source=" geraten "),
            live_data=None,
            clock=lambda: NOW,
        )


def test_prognose_is_never_assigned_to_new_fills(settings_with_station):
    """``prognose`` vergibt nur die Migration — kein Client, kein Serverpfad."""
    with pytest.raises(ValueError, match="invalid_price_source"):
        record_fill(
            settings_with_station,
            _fill_payload(price_source="prognose"),
            live_data=None,
            clock=lambda: NOW,
        )


def test_prompt_fill_without_live_price_is_rejected_not_booked(settings_with_station):
    """Der O17-Ratchet: Ein-Tipp-Beleg ohne Live-Nachweis wird abgewiesen."""
    from app.feedback import load_store

    with pytest.raises(ValueError, match="prompt_price_not_live"):
        record_fill(
            settings_with_station,
            _fill_payload(source="prompt", price_source="manuell"),
            live_data=None,
            clock=lambda: NOW,
        )
    with pytest.raises(ValueError, match="prompt_price_not_live"):
        record_fill(
            settings_with_station,
            _fill_payload(source="prompt"),
            live_data=None,
            clock=lambda: NOW,
        )
    assert load_store(settings_with_station)["fills"] == []


def test_prompt_fill_with_server_nowcast_is_live(settings_with_station):
    """Prompt ohne Preis, Server ergänzt aus dem frischen Poll → ``nowcast``."""
    fill = record_fill(
        settings_with_station,
        _fill_payload(source="prompt", price_source=None, price_paid=None),
        live_data=_LiveWithPrice(1.719),
        clock=lambda: NOW,
    )
    assert fill["price_paid"] == 1.719
    assert fill["price_source"] == "nowcast"


def test_prompt_fill_without_any_price_stays_unavailable(settings_with_station):
    """Prompt ohne Preis und ohne Poll → weiter ``price_not_available``."""
    with pytest.raises(ValueError, match="price_not_available"):
        record_fill(
            settings_with_station,
            _fill_payload(source="prompt", price_paid=None),
            live_data=_LiveWithPrice(None),
            clock=lambda: NOW,
        )


def test_fill_status_maps_new_codes_to_400():
    """Die neuen Fach-Codes sind 400 (Eingabe), nicht 503."""
    from app.server import _fill_status

    assert _fill_status({"error_code": "invalid_price_source"}) == 400
    assert _fill_status({"error_code": "prompt_price_not_live"}) == 400


def test_wallet_excludes_prognosis_fills_from_verified_savings():
    """Verifizierte Ersparnis: zweite Spalte ohne Prognosepreis-Belege."""
    store = {
        "fills": [
            {
                "tanked_at": NOW.isoformat(),
                "compliance": "followed",
                "saved_vs_always_now_eur": 2.0,
                "price_source": "live",
                "clock_hour": 14,
            },
            {
                "tanked_at": NOW.isoformat(),
                "compliance": "followed",
                "saved_vs_always_now_eur": 100.0,
                "price_source": "prognose",
                "clock_hour": 14,
            },
        ]
    }
    wallet = compute_wallet_stats(store, now=NOW)
    assert wallet["saved_eur"] == 102.0
    assert wallet["saved_verified_eur"] == 2.0
    assert wallet["n_prognosis_price"] == 1


def test_balance_marks_prognosis_fills_per_row():
    """Monats-/Jahreszeilen nennen die verifizierte Ersparnis je Zeile."""
    store = {
        "fills": [
            {
                "tanked_at": NOW.isoformat(),
                "liters": 40,
                "price_paid": 1.70,
                "saved_vs_always_now_eur": 2.0,
                "price_source": "live",
            },
            {
                "tanked_at": NOW.isoformat(),
                "liters": 40,
                "price_paid": 1.60,
                "saved_vs_always_now_eur": 6.0,
                "price_source": "prognose",
            },
        ]
    }
    balance = compute_wallet_balance(store, now=NOW)
    assert balance["months"][0]["saved_eur"] == 8.0
    assert balance["months"][0]["saved_verified_eur"] == 2.0
    assert balance["months"][0]["n_prognosis_price"] == 1
    assert balance["overall"]["saved_verified_eur"] == 2.0
    assert balance["overall"]["n_prognosis_price"] == 1
