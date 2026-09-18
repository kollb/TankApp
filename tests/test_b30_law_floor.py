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


# --- Heatmap: Bodenkante der Beobachtungs-Panel ------------------------------

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
CITY = "Frankfurt"
# 10.09.2026, 12 Wochen Fenster ⇒ Fensterbeginn 18.06.2026 — wie heute:
# vollständig hinter der Default-Kante vom 01.04.2026.
NOW = dt.datetime(2026, 9, 10, 12, tzinfo=UTC)


@pytest.fixture
def law_settings(tmp_path):
    import json

    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    CITY: {
                        "label": CITY,
                        "anchor": [50.11, 8.68],
                        "batch": [UID, OTHER],
                        "stations": [
                            {"uuid": UID, "name": "Station One"},
                            {"uuid": OTHER, "name": "Station Two"},
                        ],
                    }
                }
            }
        )
    )
    env = tmp_path / "influx.env"
    env.write_text(
        "TANKAPP_INFLUX_URL=http://nas:8086\n"
        "TANKAPP_INFLUX_ORG=local\n"
        "TANKAPP_INFLUX_BUCKET=tankapp\n"
        "TANKAPP_INFLUX_TOKEN=dummy\n"
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
    )


def _row(stamp, uid, price, status="open"):
    return {
        "_time": stamp.isoformat(),
        "city": CITY,
        "station_id": uid,
        "station": "Station",
        "status": status,
        "e10": str(price),
    }


def _live(settings, rows):
    from app.data import LiveData

    def query(_cfg, _flux):
        yield from rows

    return LiveData(settings, query=query, clock=lambda: NOW)


def test_heatmap_drops_prices_before_the_floor_and_counts_them(law_settings):
    """Die Kante schneidet — und sagt, wie viel sie abschneidet."""
    from dataclasses import replace

    # Kante auf den 09.09.2026 gelegt: Die Preise vom 07.09. liegen davor
    # und beschreiben die alte Rechtslage, die vom 09.09. (nachmittags)
    # danach. Beides liegt im 12-Wochen-Fenster.
    settings = replace(law_settings, price_law_local="2026-09-09T12:00")
    before = dt.datetime(2026, 9, 7, 18, 0, tzinfo=UTC)
    after = dt.datetime(2026, 9, 9, 14, 0, tzinfo=UTC)
    live = _live(
        settings,
        [
            _row(before, UID, 1.70),
            _row(before + dt.timedelta(minutes=5), OTHER, 1.72),
            _row(after, UID, 1.90),
        ],
    )

    heatmap = live.heatmap(CITY, "e10", "level", weeks=12)
    assert heatmap["error_code"] is None
    assert heatmap["law_floor"] == "2026-09-09T10:00:00+00:00"
    assert heatmap["points_before_law"] == 2
    assert heatmap["points"] == 1
    assert heatmap["range_from"] == after.isoformat()
    # Die Vor-Gesetz-Zelle (Mo 07.09., 20 Uhr Berlin) bleibt leer …
    assert heatmap["counts"][0][20] == 0
    # … die Nach-Gesetz-Zelle (Mi 09.09., 16 Uhr Berlin) trägt den Preis.
    assert heatmap["counts"][2][16] == 1


def test_heatmap_floor_is_a_no_op_on_todays_window(law_settings):
    """Nachweis, dass die Kante heute nichts ändert (Befund §4, nachgerechnet).

    Das 12-Wochen-Fenster beginnt am 18.06.2026 — hinter der Kante vom
    01.04.2026. Alle Preise zählen weiter; die Kante ist ausgewiesen, nicht
    wirksam.
    """
    rows = [
        _row(dt.datetime(2026, 9, 7, 18, 0, tzinfo=UTC), UID, 1.70),
        _row(dt.datetime(2026, 9, 8, 18, 0, tzinfo=UTC), OTHER, 1.72),
    ]
    heatmap = _live(law_settings, rows).heatmap(CITY, "e10", "level", weeks=12)
    assert heatmap["law_floor"] == "2026-04-01T10:00:00+00:00"
    assert heatmap["points_before_law"] == 0
    assert heatmap["points"] == 2


def test_heatmap_floor_can_be_switched_off_for_a_counter_measurement(law_settings):
    """TANKAPP_LAW_FLOOR=0 stellt den Mischbestand wieder her."""
    from dataclasses import replace

    settings = replace(
        law_settings, price_law_local="2026-09-09T12:00", law_floor=False
    )
    rows = [
        _row(dt.datetime(2026, 9, 7, 18, 0, tzinfo=UTC), UID, 1.70),
        _row(dt.datetime(2026, 9, 9, 14, 0, tzinfo=UTC), UID, 1.90),
    ]
    heatmap = _live(settings, rows).heatmap(CITY, "e10", "level", weeks=12)
    assert heatmap["law_floor"] is None
    assert heatmap["points_before_law"] == 0
    assert heatmap["points"] == 2
    assert heatmap["counts"][0][20] == 1
    assert heatmap["counts"][2][16] == 1
