"""O22 — Die Veröffentlichung passt durch das Leselimit, und wenn nicht, sagt es jemand.

Vor 0.44.0 schrieb ``app/refresh.py`` die Veröffentlichung der Prognosen mit
``indent=2`` und voller float-Präzision, und ``app.data.read_json`` verweigerte
jede Datei über 10 MB **still** (``return default`` → ``{}``). ``{}`` ist
zugleich der normale „noch keine Daten“-Zustand: Ab rund fünf Stationen zeigte
die App überall „keine Prognose“, während ``/api/v1/jobs/models/log`` Erfolg
meldete und kein Alarm ausgelöst wurde (docs/OPTIMIERUNGS-BEFUND.md O22).

Geprüft wird der Batch-Check:

* elf Stationen mit Produktionsparametern (``bootstrap_samples=2000``,
  ``train_days=42``, 24 h/72 h/168 h, 500 publizierte Draws) bleiben unter dem
  Budget von 8 MB — gemessen über dieselben Funktionen, die auch der Lauf
  benutzt (``app.model_jobs._records``/``_draws``, ``engine.storage.write_json``);
* ``/api/v1/health`` nennt die Publikationsgröße und schlägt mit
  ``publication_large`` an, sobald das Budget überschritten ist;
* eine künstlich zu große Datei ergibt ``publication_unreadable`` **mit Grund**
  statt eines stillen „keine Daten“;
* eine fehlende Datei bleibt ein Zustand, kein Fehler (erster Lauf).
"""

import datetime as dt
import json
import math

import numpy as np
import pandas as pd
import pytest

from app.config import Settings
from app.data import (
    PUBLICATION_BUDGET_BYTES,
    READ_JSON_MAX_BYTES,
    LiveData,
    clear_publication_cache,
    forecast_file_name,
    publication,
    publication_status,
)
from app.model_jobs import (
    HORIZON_VALUE_COLUMNS,
    PUBLICATION_DECIMALS,
    _draws,
    _records,
)
from engine.config import Config
from engine.storage import write_json

# Produktions-Set: m = 11 Stationen (docs/ANALYSE.md), B = 2000 fest.
STATIONS = 11
# Batch-Check O22: ``du -h data/runtime/engine/current.json`` unter 8 MB.
CHECK_BUDGET_BYTES = 8_000_000
ORIGIN = pd.Timestamp("2026-09-16T10:00:00+00:00")
NOW = dt.datetime(2026, 9, 16, 12, 0, tzinfo=dt.timezone.utc)
UID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def cfg():
    """Produktionskonfiguration — unverändert zu ``engine/config.py``."""
    return Config()


@pytest.fixture
def settings(tmp_path):
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "batch": [UID],
                        "stations": [{"uuid": UID, "name": "Station Alpha"}],
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


def _horizon(hours: int, cfg, seed: int) -> tuple[list[dict], dict]:
    """(Quantils-Reihen, Draws) eines Horizonts — über die Originalfunktionen.

    Die Werte sind synthetisch (kein Fit), Form und Präzision sind die echten:
    ``_records``/``_draws`` sind dieselben Funktionen, die der Worker aufruft,
    das Raster ist das 5-Minuten-Raster, und Nachtzellen außerhalb
    ``poll_start``/``poll_end`` sind ``NaN`` („nicht gestützt“) wie im Lauf.
    """
    periods = hours * 60 // cfg.step_minutes
    index = pd.date_range(ORIGIN, periods=periods, freq=f"{cfg.step_minutes}min")
    rng = np.random.default_rng(seed)
    level = 1.70 + 0.05 * np.sin(np.arange(periods) / 40.0)
    night = index.hour < cfg.poll_start
    frame = pd.DataFrame(
        {
            column: np.where(
                night,
                np.nan,
                level + offset + rng.normal(0, 0.0007, periods),
            )
            for column, offset in zip(
                HORIZON_VALUE_COLUMNS, (-0.024, -0.012, 0.0, 0.012, 0.024)
            )
        },
        index=index,
    )
    paths = np.where(
        night[None, :],
        np.nan,
        level[None, :] + rng.normal(0, 0.02, (cfg.bootstrap_samples, periods)),
    )
    return _records(frame), _draws(index, paths, cfg, shared=True)


def _forecast_row(position: int, cfg) -> dict:
    """Eine veröffentlichte Stations-Zeile, Feld für Feld wie in ``refresh.py``."""
    points, draws_24h = _horizon(24, cfg, seed=position)
    points_3d, _unused = _horizon(72, cfg, seed=100 + position)
    points_7d, draws_7d = _horizon(168, cfg, seed=200 + position)
    return {
        "city": "Frankfurt",
        "station_id": f"{UID[:-2]}{position:02d}",
        "station_name": f"Station {position}",
        "fuel": "e10",
        "origin": ORIGIN.isoformat(),
        "last_observation": ORIGIN.isoformat(),
        "data_age_minutes_at_origin": 1.0,
        "stale_data_at_origin": False,
        "points": points,
        "points_3d": points_3d,
        "points_7d": points_7d,
        "draws_24h": draws_24h,
        "draws_7d": draws_7d,
        "metrics": {"mae_ct": 1.234567, "mase": 0.876543, "points": 2016},
        "dst": None,
        "backtest_days": 21,
        "backtest_cached": False,
        "backtest_computed_at": None,
        "train_days": cfg.train_days,
        "range_from": "2026-08-05T00:00:00+00:00",
        "range_to": ORIGIN.isoformat(),
        "n_points": 12096,
        "n_days": 42,
        "ensemble": {"weights": {"harmonic_ar2": 0.52, "profile_ar2": 0.48}},
        "model_kind": "ensemble",
        "rolling_picp_7d": {"picp_pct": 93.1, "points": 7},
        "horizons": {"72": {"mase": 0.9}, "168": {"mase": 1.1}},
        "decision_rows": [
            {"day": f"2026-09-{day:02d}", "action": "wait"} for day in range(1, 22)
        ],
        "decision_hour": cfg.decision_hour,
        "operational_replay": False,
        "data_policy": {"mode": "bootstrap", "complete_days": 90},
        "calibrated": False,
        "decision_ready": False,
        "retained_previous": False,
    }


def _write_publication(settings, rows: list[dict]) -> tuple[int, object]:
    """Schreibt die Veröffentlichung genau wie ``app/refresh.py`` (kompakt)."""
    path = settings.runtime / "engine" / "current.json"
    size = write_json(
        path,
        {
            "schema_version": 1,
            "published_at": ORIGIN.isoformat(),
            "forecasts": rows,
            "failures": [],
            "policies": [{"mode": "bootstrap"}],
            "archive_quality": {"events": 1},
            "gapfill_quality": {"filled": 0},
            "model_file": "models-test.json",
            "calibrated": False,
            "decision_ready": False,
        },
        indent=None,
    )
    return size, path


def _alarms(settings, codes: str | None = None) -> list[dict]:
    live = LiveData(settings, query=lambda *_: [], clock=lambda: NOW)
    health = live.health()
    alarms = health.get("alarms") or []
    if codes is None:
        return alarms
    return [alarm for alarm in alarms if alarm.get("code") == codes]


# --- Größe: elf Stationen mit Produktionsparametern -------------------------


def test_eleven_stations_stay_under_the_size_budget(settings, cfg):
    """Der Batch-Check: 11 Stationen, B = 2000, unter 8 MB.

    Mit ``indent=2`` und voller Präzision lag dieselbe Zeile bei 2,04 MB
    (elf Stationen: 22,4 MB) — jenseits des Leselimits von
    ``READ_JSON_MAX_BYTES``. Kompakt und auf ``PUBLICATION_DECIMALS`` gerundet
    muss sie darunter bleiben, sonst ist die App ab dem nächsten Polling-Ausbau
    lautlos blind.
    """
    rows = [_forecast_row(position, cfg) for position in range(STATIONS)]
    size, path = _write_publication(settings, rows)
    assert size == path.stat().st_size
    assert size < CHECK_BUDGET_BYTES, f"{size / 1e6:.2f} MB — Klippe nicht gebannt"
    assert size < READ_JSON_MAX_BYTES
    # Die Datei ist gültiges JSON ohne NaN-Token — ``jq -e .failures`` läuft
    # durch (seit O28c schreibt auch der Demo-Stapel über ``write_json``).
    text = path.read_text(encoding="utf-8")
    assert "NaN" not in text and "Infinity" not in text
    assert json.loads(text)["failures"] == []


def test_eleven_stations_are_over_the_warn_budget_and_say_so(settings, cfg):
    """Elf Stationen liegen über dem Warn-Budget — genau dafür ist der Alarm da.

    Wird die Veröffentlichung eines Tages kleiner als ``PUBLICATION_BUDGET_BYTES``
    (z. B. durch Aufteilen je Kraftstoff/Station, O22 Maßnahme d), darf diese
    Prüfung fallen; der Alarm-Pfad bleibt über den Test unten nachgewiesen.
    """
    rows = [_forecast_row(position, cfg) for position in range(STATIONS)]
    size, _path = _write_publication(settings, rows)
    assert size > PUBLICATION_BUDGET_BYTES

    status = publication_status(settings)
    assert status["bytes"] == size
    assert status["over_budget"] is True
    assert status["readable"] is True
    assert status["error_code"] is None

    alarms = _alarms(settings, "publication_large")
    assert len(alarms) == 1
    assert alarms[0]["severity"] == "warn"
    assert alarms[0]["bytes"] == size
    assert (
        "," in alarms[0]["message"] and "MB groß" in alarms[0]["message"]
    )  # de-DE, not only code
    # Kein Fehler-Alarm: Die App kann die Datei lesen.
    assert not _alarms(settings, "publication_unreadable")


def test_health_payload_names_the_publication_size(settings, cfg):
    """Batch-Abnahme: ein Health-Payload, das die Publikationsgröße nennt."""
    rows = [_forecast_row(0, cfg)]
    size, _path = _write_publication(settings, rows)
    live = LiveData(settings, query=lambda *_: [], clock=lambda: NOW)
    block = live.health()["publication"]
    assert block["bytes"] == size
    assert block["budget_bytes"] == PUBLICATION_BUDGET_BYTES
    assert block["max_bytes"] == READ_JSON_MAX_BYTES
    assert block["readable"] is True


# --- Laut werden: zu groß, kaputt, fehlt ------------------------------------


def test_oversized_publication_is_an_error_with_a_reason(settings):
    """Künstlich zu große Datei: ``publication_unreadable`` statt stiller Leere."""
    path = settings.runtime / "engine" / "current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    padding = "x" * (READ_JSON_MAX_BYTES + 100_000)
    path.write_text(json.dumps({"forecasts": [], "padding": padding}), encoding="utf-8")
    assert path.stat().st_size > READ_JSON_MAX_BYTES

    # Der Lesepfad gibt weiter ``{}`` zurück — aber nicht mehr begründungslos.
    assert publication(settings) == {}
    status = publication_status(settings)
    assert status["error_code"] == "publication_unreadable"
    assert status["reason"] == "too_large"
    assert status["readable"] is False
    assert status["bytes"] == path.stat().st_size

    alarms = _alarms(settings, "publication_unreadable")
    assert len(alarms) == 1
    assert alarms[0]["severity"] == "error"
    assert alarms[0]["reason"] == "too_large"
    assert "Leselimit" in alarms[0]["message"]
    # Kein Pfad im Text: Der Alarm geht über app/notify.py auch aufs Handy.
    assert str(path) not in alarms[0]["message"]


def test_broken_publication_reports_invalid_json(settings):
    """Nicht parsebar ist ein anderer Grund als zu groß — beide sind Alarme."""
    path = settings.runtime / "engine" / "current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"forecasts": [', encoding="utf-8")

    assert publication(settings) == {}
    status = publication_status(settings)
    assert status["error_code"] == "publication_unreadable"
    assert status["reason"] == "invalid"

    alarms = _alarms(settings, "publication_unreadable")
    assert len(alarms) == 1
    assert alarms[0]["reason"] == "invalid"
    assert "ungültiges JSON" in alarms[0]["message"]


def test_missing_publication_is_a_state_not_an_error(settings):
    """Vor dem ersten Modell-Lauf gibt es keine Veröffentlichung — kein Alarm."""
    status = publication_status(settings)
    assert status["reason"] == "missing"
    assert status["error_code"] is None
    assert status["bytes"] is None
    assert status["readable"] is False
    assert publication(settings) == {}
    assert not _alarms(settings, "publication_unreadable")
    assert not _alarms(settings, "publication_large")


def test_a_readable_publication_raises_no_size_alarm(settings):
    rows = [{"city": "Frankfurt", "station_id": UID, "fuel": "e10", "points": []}]
    size, _path = _write_publication(settings, rows)
    assert size < PUBLICATION_BUDGET_BYTES
    assert not _alarms(settings, "publication_large")
    assert not _alarms(settings, "publication_unreadable")
    assert publication(settings)["forecasts"] == rows


# --- Kompakt und gerundet: die Maßnahmen (b) und (c) ------------------------


def test_publication_is_rounded_to_published_precision(cfg):
    """Keine sechs Nachkommastellen mehr in Preisen und Quantilen."""
    points, draws = _horizon(24, cfg, seed=1)

    def check(value):
        # NaN bleibt NaN („nicht gestützt“); ``write_json`` macht daraus ``null``.
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return
        assert round(value, PUBLICATION_DECIMALS) == value

    for row in points:
        for column in HORIZON_VALUE_COLUMNS:
            check(row[column])
    for row in draws["minima"]:
        for value in row:
            check(value)
    for value in draws["nowcast"]:
        check(value)
    # Die Draw-Zahl ist gekappt — B = 2000 ändert die Größe nicht (B22).
    assert draws["n"] == len(draws["minima"]) == 500


def test_compact_write_has_no_indentation(settings, cfg):
    """Maßnahme (b): eine Zeile, enge Separatoren — ``indent=2`` ist Ballast."""
    rows = [_forecast_row(0, cfg)]
    _size, path = _write_publication(settings, rows)
    text = path.read_text(encoding="utf-8")
    assert text.count("\n") == 1  # nur der Zeilenumbruch am Ende
    assert '": ' not in text and '", ' not in text
    # Dieselbe Zeile mit Einrückung ist messbar größer — der Vergleich, den der
    # Befund nennt, bleibt als Ratchet stehen.
    pretty = path.with_name("pretty.json")
    write_json(pretty, json.loads(text), indent=2)
    assert pretty.stat().st_size > path.stat().st_size * 1.2


# --- Maßnahme (d): aufgeteilte Veröffentlichung (seit 0.49.0) ---------------
#
# Befund 17.09.2026: Das Polling-Set wuchs von 11 auf 20 Stationen (zweite
# Stadt), die kompakte, gerundete Monolith-Datei erreichte 13,5 MB und fiel
# über das Leselimit — „keine Prognose“ überall, während der Job Erfolg
# meldete. Die Klippe ist eine Eigenschaft der einzelnen Datei; seit 0.49.0
# liegt jede Stations-Prognose in einer eigenen Datei, ``current.json`` ist
# ein kleiner Index mit Zeigern, und ``publication()`` fügt beides zur
# gewohnten Bundle-Form zusammen.


def _write_split(settings, rows):
    """Schreibt die aufgeteilte Veröffentlichung über den Original-Schreiber."""
    from app.data import write_split_publication

    clear_publication_cache()
    return write_split_publication(
        settings.runtime / "engine",
        ORIGIN.isoformat(),
        rows,
        index_extra={
            "failures": [],
            "policies": [{"mode": "bootstrap"}],
            "archive_quality": {"events": 1},
            "gapfill_quality": {"filled": 0},
            "model_file": "models-test.json",
            "calibrated": False,
            "decision_ready": False,
        },
    )


def test_twenty_stations_split_stay_readable(settings, cfg):
    """20 Stationen (zwei Städte) über der Monolith-Klippe — lesbar dank Aufteilung.

    Die Summe liegt deutlich über dem Leselimit; entscheiden darf aber nur die
    einzelne Datei, und die bleibt weit darunter. Kein Alarm, volle 20 Zeilen
    im Lese-Pfad.
    """
    rows = [_forecast_row(position, cfg) for position in range(20)]
    sizes = _write_split(settings, rows)
    assert sizes["file_count"] == 20
    assert sizes["total_bytes"] > READ_JSON_MAX_BYTES  # Monolith wäre gekippt
    assert sizes["largest_file_bytes"] < PUBLICATION_BUDGET_BYTES
    assert sizes["index_bytes"] < 100_000  # der Index bleibt klein

    status = publication_status(settings)
    assert status["readable"] is True
    assert status["error_code"] is None
    assert status["bytes"] == sizes["total_bytes"]
    assert status["over_budget"] is False  # Budget gilt der einzelnen Datei
    assert status["file_count"] == 20

    bundle = publication(settings)
    assert len(bundle["forecasts"]) == 20
    assert all(row.get("points") for row in bundle["forecasts"])
    assert bundle["published_at"] == ORIGIN.isoformat()
    assert not _alarms(settings, "publication_unreadable")
    assert not _alarms(settings, "publication_large")


def test_split_missing_station_file_is_incomplete_not_silent(settings, cfg):
    """Fehlt eine Stations-Datei, ist das ein Alarm — nicht „keine Prognose“."""
    rows = [_forecast_row(position, cfg) for position in range(3)]
    _write_split(settings, rows)
    victim = settings.runtime / "engine" / "forecasts" / forecast_file_name(rows[1])
    victim.unlink()
    clear_publication_cache()

    status = publication_status(settings)
    assert status["error_code"] == "publication_unreadable"
    assert status["reason"] == "incomplete"

    bundle = publication(settings)
    assert len(bundle["forecasts"]) == 2  # die übrigen bleiben verfügbar
    assert bundle["skipped_forecast_files"][0]["reason"] == "incomplete"

    alarms = _alarms(settings, "publication_unreadable")
    assert len(alarms) == 1
    assert alarms[0]["reason"] == "incomplete"
    assert "unvollständig" in alarms[0]["message"]


def test_split_oversized_station_file_is_an_error(settings, cfg):
    """Eine einzelne Stations-Datei über dem Limit — die Klippe gilt je Datei."""
    rows = [_forecast_row(0, cfg)]
    _write_split(settings, rows)
    path = settings.runtime / "engine" / "forecasts" / forecast_file_name(rows[0])
    padding = "x" * (READ_JSON_MAX_BYTES + 100_000)
    write_json(path, {"forecast": rows[0], "padding": padding}, indent=None)
    clear_publication_cache()

    status = publication_status(settings)
    assert status["error_code"] == "publication_unreadable"
    assert status["reason"] == "too_large"
    assert _alarms(settings, "publication_unreadable")


def test_split_index_alone_carries_no_forecast_payload(settings, cfg):
    """Der Index trägt Zeiger, keine Prognose-Masse — sonst wäre die Klippe zurück."""
    rows = [_forecast_row(position, cfg) for position in range(3)]
    _write_split(settings, rows)
    index = json.loads(
        (settings.runtime / "engine" / "current.json").read_text(encoding="utf-8")
    )
    assert index["layout"] == "split-forecast-files"
    for entry in index["forecasts"]:
        assert set(entry) == {
            "city",
            "station_id",
            "fuel",
            "origin",
            "retained_previous",
            "file",
        }
        assert (settings.runtime / "engine" / entry["file"]).is_file()
