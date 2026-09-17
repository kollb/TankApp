"""O23 — Ein Parse je Datenstand statt einer je Anfrage.

Vor 0.47.0 parste jeder Leser die komplette Veröffentlichung
(``runtime/engine/current.json``) selbst:

* ``/api/v1/health`` einmal (``publication``) plus einmal die Selektion in
  ``app/alarms.py`` — der Docker-Healthcheck läuft alle 30 s, die GUI pollt
  denselben Endpunkt;
* ``/api/v1/stats/summary`` **dreimal** dieselbe Datei, weil Backtest,
  Güte-Kacheln und Live-Phase je den Provider aufriefen.

Gemessen auf dem Demo-Stapel (2,52 MB, 6 Stationen): 21,7 ms je Health-Aufruf
und 90,3 ms je Stats-Aufruf, davon 88 % ``json.loads``
(docs/OPTIMIERUNGS-BEFUND.md O23).

Diese Datei hält den Batch-Check fest: ``/api/v1/stats/summary`` → genau
**ein** Parse, ``/api/v1/health`` bei unverändertem ``(mtime, size)`` →
**kein** Parse. Dazu die Gegenprobe, dass ein geänderter Datenstand sehr wohl
neu gelesen wird — das Memo darf nie einen alten Stand liefern.
"""

import datetime as dt
import json

import pytest

import app.data as data_mod
from app.config import Settings
from engine.storage import write_json
from app.data import (
    LiveData,
    publication,
    publication_status,
    selection_publication,
)
from app.stats_summary import evaluate_stats_summary

UID = "00000000-0000-0000-0000-000000000001"
NOW = dt.datetime(2026, 9, 17, 12, 0, tzinfo=dt.timezone.utc)


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
    (tmp_path / "influx.env").write_text("INFLUX_URL=http://127.0.0.1:8086\n")
    (tmp_path / "_netrc").write_text("")
    return Settings(
        data=tmp_path,
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "_netrc",
        static=tmp_path / "static",
    )


@pytest.fixture
def zaehler(monkeypatch):
    """Zählt die echten Lesevorgänge je Artefakt (Parse = ``read_json_checked``)."""
    real = data_mod.read_json_checked
    counts = {"publication": 0, "selection": 0}

    def counting(path, max_bytes=data_mod.READ_JSON_MAX_BYTES):
        name = str(path)
        if name.endswith("engine/current.json"):
            counts["publication"] += 1
        elif name.endswith("selection/current.json"):
            counts["selection"] += 1
        return real(path, max_bytes)

    monkeypatch.setattr(data_mod, "read_json_checked", counting)
    return counts


def _publication_payload(marker: str = "a") -> dict:
    return {
        "schema_version": 1,
        "published_at": NOW.isoformat(),
        "forecasts": [
            {
                "city": "Frankfurt",
                "station_id": UID,
                "station_name": "Station Alpha",
                "fuel": "E10",
                "origin": NOW.isoformat(),
                "points": [{"t": NOW.isoformat(), "median": 1.7, "lo": 1.6, "hi": 1.8}],
                "points_3d": [],
                "points_7d": [],
                "draws_24h": {},
                "draws_7d": {},
                "metrics": {"mae_ct": 1.2, "mase": 0.9, "picp95_pct": 94.0},
                "train_days": 42,
                "backtest_days": 7,
                "marker": marker,
            }
        ],
        "failures": [],
        "policies": [
            {
                "station_id": UID,
                "city": "Frankfurt",
                "fuel": "E10",
                "good_complete_live_days": 12,
                "required_complete_live_days": 90,
                "min_daily_coverage": 0.9,
                "mode": "live_only",
            }
        ],
        "archive_quality": {},
        "gapfill_quality": {},
        "calibrated": False,
        "decision_ready": False,
    }


def _write_publication(settings, marker: str = "a") -> None:
    """Schreibt über den echten Schreiber (``write_json`` → atomares Ersetzen).

    Genau so entstehen die Artefakte im Betrieb (``app/refresh.py``,
    ``app/worker.py``); das Lese-Memo erkennt den neuen Stand an der neuen
    Inode (siehe ``app.data._memo_stamp``).
    """
    path = settings.runtime / "engine" / "current.json"
    write_json(path, _publication_payload(marker), indent=None)


def _write_selection(settings) -> None:
    write_json(
        settings.runtime / "selection" / "current.json",
        {
            "generated_at": NOW.isoformat(),
            "by_fuel": {"e10": {"cities": [], "top_global": [], "price_twins": []}},
        },
        indent=None,
    )


def _live(settings) -> LiveData:
    return LiveData(settings, query=lambda *args, **kwargs: [], clock=lambda: NOW)


def test_stats_summary_parst_die_veroeffentlichung_genau_einmal(settings, zaehler):
    """Batch-Check: ``/api/v1/stats/summary`` → genau ein Parse (vorher drei)."""
    _write_publication(settings)
    live = _live(settings)

    evaluate_stats_summary(live, {"fuel": "e10"})

    assert zaehler["publication"] == 1, (
        "stats/summary muss die Veröffentlichung einmal lesen und das Ergebnis "
        "an Backtest, Güte-Kacheln und Live-Phase durchreichen"
    )


def test_stats_summary_zeigt_alle_drei_bereiche_aus_demselben_bundle(settings):
    """Der eine Lesevorgang darf nichts unterschlagen (Gegenprobe zum Sparen)."""
    _write_publication(settings)
    live = _live(settings)

    payload = evaluate_stats_summary(live, {"fuel": "e10"})

    assert payload["backtest"]["stations"], "Backtest aus der Veröffentlichung fehlt"
    assert payload["quality_metrics"]["picp_95"] is not None, "Güte-Kachel leer"
    assert payload["live_phase"] is not None, "Live-Phase fehlt"


def test_health_parst_bei_unveraendertem_datenstand_nicht(settings, zaehler):
    """Batch-Check: zweiter Health-Aufruf bei gleichem ``(mtime, size)`` → kein Parse."""
    _write_publication(settings)
    _write_selection(settings)
    live = _live(settings)

    live.health()  # erster Aufruf: Memo füllen
    first = dict(zaehler)
    assert first["publication"] == 1
    zaehler["publication"] = 0
    zaehler["selection"] = 0

    payload = live.health()

    assert zaehler["publication"] == 0, "unveränderte Veröffentlichung neu geparst"
    assert zaehler["selection"] == 0, "unveränderte Selektion neu geparst"
    # Die Antwort bleibt vollständig — gespart wird der Parse, nicht der Inhalt.
    assert payload["publication"]["bytes"] > 0
    assert isinstance(payload["alarms"], list)


def test_health_liest_einen_neuen_datenstand_nach(settings, zaehler):
    """Gegenprobe: Das Memo darf nie einen alten Stand liefern."""
    _write_publication(settings, marker="alt")
    live = _live(settings)
    assert publication(settings)["forecasts"][0]["marker"] == "alt"
    zaehler["publication"] = 0

    _write_publication(settings, marker="neu")

    assert zaehler["publication"] == 0, "gelesen wurde vor dem Zugriff"
    bundle = publication(settings)
    assert bundle["forecasts"][0]["marker"] == "neu"
    assert zaehler["publication"] == 1, "geänderter Datenstand muss neu gelesen werden"
    # Auch der Health-Pfad sieht den neuen Stand (und parst nicht erneut).
    zaehler["publication"] = 0
    assert live.health()["models"]["count"] == 1
    assert zaehler["publication"] == 0


def test_endpunkte_teilen_sich_den_gelesenen_stand(settings, zaehler):
    """health() und stats/summary lesen dieselbe Datei — einmal, nicht je Endpunkt."""
    _write_publication(settings)
    _write_selection(settings)
    live = _live(settings)

    live.health()
    evaluate_stats_summary(live, {"fuel": "e10"})
    live.health()

    assert zaehler["publication"] == 1
    assert zaehler["selection"] == 1


def test_geteilter_stand_wird_von_lesern_nicht_veraendert(settings):
    """Das Memo reicht dasselbe Objekt weiter — Leser dürfen es nicht verbiegen."""
    _write_publication(settings)
    _write_selection(settings)
    live = _live(settings)
    vorher = json.dumps(publication(settings), sort_keys=True)
    sel_vorher = json.dumps(selection_publication(settings), sort_keys=True)

    live.health()
    evaluate_stats_summary(live, {"fuel": "e10"})
    live.overview(
        {"fuel": "e10", "city": "Frankfurt", "liters": 40, "consumption": 7.0}
    )

    assert json.dumps(publication(settings), sort_keys=True) == vorher
    assert json.dumps(selection_publication(settings), sort_keys=True) == sel_vorher


def test_unlesbare_veroeffentlichung_bleibt_mit_grund_sichtbar(settings, zaehler):
    """O22 bleibt stehen: Ein Parse-Fehler ist ein Alarm, kein „keine Daten“."""
    path = settings.runtime / "engine" / "current.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{ kein json", encoding="utf-8")
    live = _live(settings)

    live.health()
    status = publication_status(settings)

    assert status["error_code"] == "publication_unreadable"
    assert status["reason"] == "invalid"
    assert any(a["code"] == "publication_unreadable" for a in live.health()["alarms"])


def test_fehlende_veroeffentlichung_bleibt_ein_zustand(settings):
    """Kein Parse, kein Fehler: Vor dem ersten Lauf gibt es nichts zu lesen."""
    live = _live(settings)

    assert publication(settings) == {}
    assert publication_status(settings)["reason"] == "missing"
    assert live.health()["publication"]["error_code"] is None
