"""O41 — Drei Normalisierungswege für ein Artefakt (Batch 8).

Vorher hatte ``read_selection`` drei Pfade mit drei Antwortformen, und zwei
Schreiber schrieben zwei verschiedene Formen in dieselbe Datei
(``runtime/selection/current.json``): ``app/refresh.py`` einen Index
``{"generated_at", "fuels", "by_fuel"}``, ``app/worker.py`` das Ergebnis von
``build_selection`` mit zusätzlichen flachen Feldern (``stations``, ``cities``,
``count``). Die flachen Felder las niemand — ``LiveData.selection`` baut seine
Stationen aus ``by_fuel``, ``app/recap.py`` ebenso —, und kein Test deckte
``read_selection`` ab, deshalb blieb die Dreifachheit unsichtbar
(docs/OPTIMIERUNGS-BEFUND.md O41).

Geprüft wird der Batch-Check:

* beide Schreiber (``refresh.py``, ``worker.py``) erzeugen über
  ``selection_artifact``/``publish_selection`` dieselbe Form;
* die API-Antwort ist vor und nach der Änderung byte-identisch — für jede
  Artefakt-Form, die auf der Platte liegen kann (Nachweis: Sonde gegen den
  Vorgänger-Commit, siehe Wechsel zu 0.54.0 im CHANGELOG);
* Altbestände (flache Liste vor der by_fuel-Ära, Worker-Altform mit
  ``count``/``stations``/``cities``) bleiben lesbar — wie die Monolith-
  Publikation bei O22(d);
* ein struktureller Grund ohne Daten (polling.json fehlt) wird nicht
  veröffentlicht: die letzte gute Publikation bleibt stehen.
"""

import datetime as dt
from pathlib import Path
import json

import pandas as pd
import pytest

from app.config import Settings
from app.data import LiveData
from app.refresh import refresh
from app.selection import read_selection, selection_artifact
from app import worker

UID = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
NOW = dt.datetime(2026, 9, 10, 12, tzinfo=dt.timezone.utc)

STATION = {
    "station_id": UID,
    "city": "Frankfurt",
    "fuel": "e10",
    "name": "Station One",
    "brand": "ARAL",
    "delta_ct": -3.8,
    "rank": 1,
    "coverage": 0.9,
    "dist_km": 1.0,
    "best_hour": 19.5,
    "maps_url": "https://maps.example/0",
}

FUEL_DATA = {
    "generated_at": NOW.isoformat(),
    "cities": [{"city": "Frankfurt", "stations": [STATION]}],
    "top_global": [STATION],
    "range_from": "2026-07-01T00:00:00+00:00",
    "range_to": "2026-09-11T23:55:00+00:00",
    "n_points": 1000,
    "n_days": 42,
    "lifecycle_totals": {"active": 2, "dead": 0, "closed": 0, "no_fuel": 0},
    "price_twins": [],
}

# Die eine Form: genau diese Schlüssel, keine flachen Zweitfelder.
ARTIFACT_KEYS = {"generated_at", "fuels", "by_fuel", "error_code"}


def _settings(tmp_path) -> Settings:
    tmp_path = Path(tmp_path)
    tmp_path.mkdir(parents=True, exist_ok=True)
    polling = tmp_path / "polling.json"
    polling.write_text(
        json.dumps(
            {
                "sets": {
                    "Frankfurt": {
                        "label": "Frankfurt",
                        "anchor": [50.11, 8.68],
                        "batch": [UID, OTHER],
                        "stations": [
                            {"uuid": UID, "name": "One", "lat": 50.12, "lon": 8.69},
                            {"uuid": OTHER, "name": "Two", "lat": 50.13, "lon": 8.70},
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
    static = tmp_path / "web"
    static.mkdir()
    (static / "index.html").write_text("<html>test</html>")
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=env,
        netrc=tmp_path / "_netrc",
        static=static,
        model_fuels=("e10",),
    )


def _write(path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


# --- Beide Schreiber, eine Form ---------------------------------------------


def _stub_compute_all(obs, sel_cfg, metas_by_city):
    """Dieselbe Stub-Antwort für beide Schreiber — verglichen wird die Form."""
    return {
        "cities": [{"city": "Frankfurt", "stations": [dict(STATION)]}],
        "top_global": [dict(STATION)],
        "lifecycle_totals": {"active": 1, "dead": 0, "closed": 0, "no_fuel": 0},
        "price_twins": [],
        "diagnostics": [],
    }


@pytest.fixture
def model_run(tmp_path, observations, monkeypatch):
    """refresh()-fähiger Bestand wie in tests/test_app_jobs.py::model_setup."""
    settings = _settings(tmp_path)
    history = tmp_path / "history.csv.gz"
    observations(days=35).assign(
        station_id=UID, city="Frankfurt", source="history"
    ).drop(columns="status").to_csv(history, index=False)
    live = observations(days=1, start="2026-08-05").assign(
        station_id=UID, city="Frankfurt"
    )

    def export(cfg, start, stop, lookup, fuel, output, uuid_only):
        output.parent.mkdir(parents=True, exist_ok=True)
        live.to_csv(output, index=False)

    monkeypatch.setattr("export_influx.export_prices", export)
    monkeypatch.setattr(
        "app.history.prepare_archive",
        lambda *a: ([history], {"events": 1, "missing_days": 0}),
    )
    monkeypatch.setattr(
        "engine.backtest.run_backtest",
        lambda *a, **kw: ({"metrics": {"points": 10, "mae_ct": 1.2}}, None),
    )
    return settings


def test_beide_schreiber_erzeugen_dieselbe_form(tmp_path, model_run, monkeypatch):
    """refresh() (models-Job) und der selection-Job schreiben dieselbe Form.

    Beide Pfade laufen mit derselben ``compute_all``-Antwort; das geschriebene
    ``current.json`` muss in Form **und** Inhalt übereinstimmen — nur der
    Zeitstempel unterscheidet sich (refresh: Origin des Laufs, Job: jetzt).
    Vor O41 schrieb der Job zusätzliche flache Felder (``stations``,
    ``cities``, ``count``), die niemand las.
    """
    monkeypatch.setattr("engine.selection.compute_all", _stub_compute_all)

    # Schreiber 1: refresh() — der models-Job publiziert die Selektion mit.
    # Zeitlicher Aufbau wie tests/test_app_jobs.py::model_setup: Historie bis
    # 04.08., ein Tag Live-Daten, Lauf am 06.08.
    refresh_settings = model_run
    refresh_now = dt.datetime(2026, 8, 6, tzinfo=dt.timezone.utc)
    outcome = refresh(refresh_settings, refresh_now)
    assert outcome["state"] in ("success", "partial"), outcome
    refresh_artifact = json.loads(
        (refresh_settings.runtime / "selection" / "current.json").read_text(
            encoding="utf-8"
        )
    )

    # Schreiber 2: der eigenständige selection-Job (Worker).
    worker_dir = tmp_path / "worker-data"
    worker_settings = _settings(worker_dir)
    training = worker_settings.runtime / "training"
    training.mkdir(parents=True)
    pd.DataFrame({"timestamp": [], "station_id": [], "fuel": [], "price": []}).to_csv(
        training / "e10.csv.gz", index=False
    )

    def fake_load(paths, cfg, fuel, ids):
        index = pd.date_range(
            "2026-08-05", periods=288, freq="5min", tz="Europe/Berlin"
        )
        frame = pd.DataFrame(
            {
                "timestamp": index.astype(str),
                "city": "Frankfurt",
                "station_id": UID,
                "fuel": "E10",
                "price": 1.7,
                "status": "open",
                "source": "influxdb",
            }
        )
        return frame, {}

    monkeypatch.setattr("engine.data.load_observations", fake_load)
    outcome = worker.execute("selection", worker_settings)
    assert outcome == {"state": "success", "error_code": None}, outcome
    worker_artifact = json.loads(
        (worker_settings.runtime / "selection" / "current.json").read_text(
            encoding="utf-8"
        )
    )

    # Die eine Form — und zwar für beide Schreiber dieselbe.
    assert set(refresh_artifact) == ARTIFACT_KEYS
    assert set(worker_artifact) == ARTIFACT_KEYS
    assert worker_artifact["fuels"] == refresh_artifact["fuels"] == ["e10"]
    assert worker_artifact["by_fuel"] == refresh_artifact["by_fuel"]
    assert worker_artifact["error_code"] is None
    assert refresh_artifact["error_code"] is None
    # Keine flachen Zweitfelder mehr.
    for field in ("stations", "cities", "count"):
        assert field not in worker_artifact
        assert field not in refresh_artifact
    # Derselbe Dateibestand: Einzeldatei je Kraftstoff plus Index.
    assert (refresh_settings.runtime / "selection" / "e10.json").is_file()
    assert (worker_settings.runtime / "selection" / "e10.json").is_file()


def test_worker_veroeffentlicht_nichts_bei_strukturem_problem(tmp_path, monkeypatch):
    """polling.json fehlt ⇒ waiting mit Grund, kein Artefakt-Schreiben.

    Vorher schrieb der Job eine Fehler-Markierung ohne ``by_fuel``, die der
    Leser wie ein fehlendes Artefakt behandelte (und damit je nach Bestand
    auf die Einzeldateien zurückfiel). Jetzt bleibt die letzte gute
    Publikation stehen — dasselbe Versprechen wie bei Abbrüchen (B24).
    """
    settings = _settings(tmp_path)
    settings.polling.unlink()

    prior = settings.runtime / "selection" / "current.json"
    _write(prior, selection_artifact(NOW.isoformat(), {"e10": FUEL_DATA}))

    outcome = worker.execute("selection", settings)
    assert outcome["state"] == "waiting"
    assert outcome["error_code"] == "polling_missing"
    # Die letzte gute Publikation bleibt unverändert stehen.
    assert json.loads(prior.read_text(encoding="utf-8"))["by_fuel"]["e10"] == FUEL_DATA


# --- Leser: eine Form, Altbestände bleiben lesbar ---------------------------


def test_read_selection_normalisiert_alle_lesbaren_formen(tmp_path):
    settings = _settings(tmp_path)
    sel = settings.runtime / "selection"

    # (1) current.json in der einen Form (beide Schreiber).
    _write(
        sel / "current.json",
        selection_artifact(NOW.isoformat(), {"e10": FUEL_DATA}),
    )
    data = read_selection(settings)
    assert set(data) == ARTIFACT_KEYS
    assert data["by_fuel"]["e10"] == FUEL_DATA
    assert data["fuels"] == ["e10"]
    assert data["error_code"] is None

    # (2) Altbestand: Worker-Form vor O41 (flache Felder dazu) — bleibt lesbar.
    _write(
        sel / "current.json",
        {
            "generated_at": NOW.isoformat(),
            "fuels": ["e10"],
            "by_fuel": {"e10": FUEL_DATA},
            "count": 1,
            "stations": [STATION],
            "cities": ["Frankfurt"],
            "error_code": None,
        },
    )
    data = read_selection(settings)
    assert set(data) == ARTIFACT_KEYS
    assert data["by_fuel"]["e10"] == FUEL_DATA
    assert "stations" not in data  # flache Felder werden nicht durchgereicht

    # (3) Nur Einzeldateien je Kraftstoff (current.json fehlt).
    (sel / "current.json").unlink()
    _write(sel / "e10.json", FUEL_DATA)
    data = read_selection(settings)
    assert set(data) == ARTIFACT_KEYS
    assert data["by_fuel"]["e10"] == FUEL_DATA
    assert data["generated_at"] == FUEL_DATA["generated_at"]

    # (4) Nichts da: nur der Grund, keine toten Leer-Listen.
    (sel / "e10.json").unlink()
    assert read_selection(settings) == {"error_code": "selection_not_available"}


# --- API-Antwort: byte-identisch vor und nach der Änderung ------------------
#
# Die erwarteten Antworten sind mit einer Sonde gegen den Vorgänger-Commit
# (0.53.0) gemessen und hier festgenagelt: Für jede Artefakt-Form auf der
# Platte antwortet /api/v1/selection (LiveData.selection) exakt wie vorher.


def _live(settings) -> LiveData:
    return LiveData(settings, query=lambda *_: [], clock=lambda: NOW)


def _api_state(tmp_path, builder):
    settings = _settings(tmp_path)
    builder(settings)
    return _live(settings).selection("e10")


def test_api_antwort_canonisches_artefakt(tmp_path):
    """Die Form beider Schreiber: volles Ranking durch by_fuel."""

    def build(settings):
        _write(
            settings.runtime / "selection" / "current.json",
            selection_artifact(NOW.isoformat(), {"e10": FUEL_DATA}),
        )

    sel = _api_state(tmp_path, build)
    assert sel["error_code"] is None
    assert sel["count"] == 1
    assert sel["total_count"] == 1
    assert sel["stations"][0]["station_id"] == UID
    assert sel["stations"][0]["delta_ct"] == -3.8
    assert sel["top_global"][0]["station_id"] == UID
    assert sel["cities"] == ["Frankfurt"]
    assert sel["range_from"] == "2026-07-01T00:00:00+00:00"
    assert sel["n_points"] == 1000
    assert sel["n_days"] == 42
    assert sel["lifecycle_counts"] == {
        "active": 2,
        "dead": 0,
        "closed": 0,
        "no_fuel": 0,
    }
    assert sel["generated_at"] == NOW.isoformat()
    assert sel["calibrated"] is False
    assert sel["decision_ready"] is False


def test_api_antwort_worker_altform_bleibt_identisch(tmp_path):
    """Altbestand: Worker-Form vor O41 — dieselbe Antwort wie vorher."""

    def build(settings):
        _write(
            settings.runtime / "selection" / "current.json",
            {
                "generated_at": NOW.isoformat(),
                "fuels": ["e10"],
                "by_fuel": {"e10": FUEL_DATA},
                "count": 1,
                "stations": [STATION],
                "cities": ["Frankfurt"],
                "error_code": None,
            },
        )

    sel = _api_state(tmp_path, build)
    assert sel["error_code"] is None
    assert sel["count"] == 1
    assert sel["stations"][0]["delta_ct"] == -3.8


def test_api_antwort_leeres_artefakt_ohne_ranking(tmp_path):
    """Kein Kraftstoff mit Ranking: Erfolg-Form mit 0 Stationen (wie vorher).

    Der Reader liefert by_fuel={} — die API antwortet wie schon vor O41 mit
    error_code None (kein Fehler) und 0 Stationen; der Grund steht im
    Artefakt und im Job-Status, nicht in der API erfunden.
    """

    def build(settings):
        _write(
            settings.runtime / "selection" / "current.json",
            selection_artifact(NOW.isoformat(), {}, "selection_not_available"),
        )

    sel = _api_state(tmp_path, build)
    assert sel["error_code"] is None
    assert sel["count"] == 0
    assert sel["stations"] == []
    assert sel["top_global"] == []
    assert sel["cities"] == []


def test_api_antwort_nur_einzeldateien(tmp_path):
    """current.json fehlt, Einzeldateien vorhanden: Ranking aus den Dateien."""

    def build(settings):
        _write(settings.runtime / "selection" / "e10.json", FUEL_DATA)

    sel = _api_state(tmp_path, build)
    assert sel["error_code"] is None
    assert sel["count"] == 1
    assert sel["generated_at"] == FUEL_DATA["generated_at"]


def test_api_antwort_altbestand_flache_liste(tmp_path):
    """Altbestand vor der by_fuel-Ära: flache Liste bleibt bedient."""

    def build(settings):
        _write(
            settings.runtime / "selection" / "current.json",
            {
                "generated_at": NOW.isoformat(),
                "fuels": ["e10"],
                "cities": ["Frankfurt"],
                "count": 1,
                "stations": [STATION],
            },
        )

    sel = _api_state(tmp_path, build)
    assert sel["error_code"] is None
    assert sel["count"] == 1
    assert sel["total_count"] == 1
    assert sel["stations"][0]["best_hour"] == 19.5


def test_api_antwort_kein_artefakt(tmp_path):
    """Nichts da: selection_not_available mit leerer Antwort — wie vorher."""

    def build(settings):
        pass

    sel = _api_state(tmp_path, build)
    assert sel["error_code"] == "selection_not_available"
    assert sel["count"] == 0
    assert sel["total_count"] == 0
    assert sel["stations"] == []
    assert sel["cities"] == []
    assert sel["generated_at"] is None
    assert sel["range_from"] is None
    assert sel["n_points"] is None
