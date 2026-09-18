"""B30 — Bodenkante der 12-Uhr-Regel (Beobachtung, Selektion, Kalibrierung).

Der Befund [docs/BEFUND-12-UHR-REGEL.md] belegt den Regimewechsel zum
01.04.2026: Vor dem Gesetz liegt das Tagestief am Abend, danach im Vormittag
(alle 169 Anstiege am Mittagspunkt). Beobachtungs-Kennzahlen, die beide
Rechtslagen mischen, beschreiben deshalb die alte Welt.

Diese Reihe prüft die Kante selbst:

* eine Quelle — ``Settings.price_law_local`` (``TANKAPP_PRICE_LAW_LOCAL``)
  wird über ``engine_config()`` zur Engine-Konfiguration, beide Defaults
  stimmen überein;
* Ablehnung statt Raterei — Müll, DST-Lücke und DST-Rücksprung ergeben
  ``None``, keine verschobene Kante;
* Gegenmessung — ``TANKAPP_LAW_FLOOR=0`` stellt den Mischbestand wieder her.
"""

import datetime as dt

import pytest

from app.config import Settings, engine_config
from app.law import (
    DEFAULT_PRICE_LAW_LOCAL,
    law_floor_enabled,
    law_floor_iso,
    law_floor_label,
    law_floor_utc,
    parse_price_law,
    price_law_local,
)
from engine.config import Config
from engine.models import law_since_utc

UTC = dt.timezone.utc


def test_default_floor_is_the_engine_value():
    """Eine Kante, zwei Konsumenten: App-Default == Engine-Default."""
    assert DEFAULT_PRICE_LAW_LOCAL == Config().price_law_local
    assert Settings().price_law_local == DEFAULT_PRICE_LAW_LOCAL
    floor = law_floor_utc(Settings())
    # 01.04.2026 12:00 Europe/Berlin (Sommerzeit) = 10:00 UTC.
    assert floor == dt.datetime(2026, 4, 1, 10, 0, tzinfo=UTC)
    assert law_since_utc(engine_config(Settings())) == floor


def test_law_value_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("TANKAPP_PRICE_LAW_LOCAL", "2026-10-01T12:00")
    assert Settings.from_env().price_law_local == "2026-10-01T12:00"
    assert law_floor_utc(Settings.from_env()) == dt.datetime(
        2026, 10, 1, 10, 0, tzinfo=UTC
    )
    monkeypatch.delenv("TANKAPP_PRICE_LAW_LOCAL")
    assert Settings.from_env().price_law_local == DEFAULT_PRICE_LAW_LOCAL


def test_empty_or_blank_env_value_falls_back_instead_of_breaking(monkeypatch):
    """Leere Variable heißt „Default", nicht „keine Kante" und nicht Crash."""
    monkeypatch.setenv("TANKAPP_PRICE_LAW_LOCAL", "   ")
    settings = Settings.from_env()
    assert price_law_local(settings) == DEFAULT_PRICE_LAW_LOCAL
    # engine_config() darf daraus keinen leeren Wert an pandas weiterreichen.
    assert engine_config(settings).price_law_local == DEFAULT_PRICE_LAW_LOCAL


def test_floor_flag_comes_from_the_environment(monkeypatch):
    for raw, expected in (("0", False), ("false", False), ("1", True), ("", True)):
        monkeypatch.setenv("TANKAPP_LAW_FLOOR", raw)
        assert Settings.from_env().law_floor is expected, raw
    monkeypatch.delenv("TANKAPP_LAW_FLOOR")
    assert Settings.from_env().law_floor is True


def test_disabled_floor_means_no_floor():
    """Gegenmessung: TANKAPP_LAW_FLOOR=0 stellt den Mischbestand wieder her."""
    settings = Settings(law_floor=False)
    assert law_floor_enabled(settings) is False
    assert law_floor_utc(settings) is None
    assert law_floor_iso(settings) is None
    assert law_floor_label(settings) is None
    # Die Engine behält ihren Wert — abgeschaltet ist nur die Kante der
    # Beobachtung, nicht das Gesetz selbst.
    assert engine_config(settings).price_law_local == DEFAULT_PRICE_LAW_LOCAL


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "kein-datum",
        "2026-13-45T99:99",
        # DST-Lücke (Europe/Berlin, 29.03.2026) und DST-Rücksprung
        # (25.10.2026): beide Wanduhrzeiten sind keine gültige Kante.
        "2026-03-29T02:30",
        "2026-10-25T02:30",
    ],
)
def test_invalid_or_ambiguous_law_values_are_rejected(raw):
    """Keine still verschobene Kante — Müll und DST-Kanten ergeben None."""
    assert parse_price_law(raw) is None


def test_offset_aware_value_is_taken_as_is():
    parsed = parse_price_law("2026-04-01T12:00+02:00")
    assert parsed == dt.datetime(2026, 4, 1, 10, 0, tzinfo=UTC)


def test_label_is_the_berlin_calendar_day():
    assert law_floor_label(Settings()) == "01.04.2026"
    assert law_floor_iso(Settings()) == "2026-04-01T10:00:00+00:00"
