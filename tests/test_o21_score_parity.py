"""O21 — Eine Quelle für die Score-Formel und für die Tankmenge.

`app/stats_summary.py::_score_rows` ist der „Server-Spiegel von
`web/src/data.ts` scoreRows“. Zwei Implementierungen derselben Formel driften:
Der Befund nennt O13 als Beleg, und der Paritätslauf zu diesem Test fand einen
echten Einheitenfehler (die GUI teilte `sum_smart_eur` durch `sum_best` in ct —
`pot_share` war um den Faktor Liter/100 falsch).

Deshalb: **eine** Fixture (`tests/fixtures/score_parity.json`), gelesen von
diesem Test *und* von `web/src/scoreParity.test.ts`. Wer die Formel ändert,
muss beide Seiten ändern — sonst fällt eine der beiden Suiten.

Zweiter Teil: die Tankmenge. Das Profil erlaubt 10–100 L; der Server-Score
rechnete fest mit 40 L und die Selektion mit `SelectionConfig.tank_volume =
40.0`. Beide müssen jetzt dem Profil folgen.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.config import Settings
from app.profiles import active_liters, create_profile
from app.stats_summary import DEFAULT_LITERS, _score_rows

FIXTURE = Path(__file__).parent / "fixtures" / "score_parity.json"


@pytest.fixture
def settings(tmp_path) -> Settings:
    """Minimal-Settings: Profil-Store und runtime liegen im tmp_path."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    polling = tmp_path / "polling.json"
    polling.write_text(json.dumps({"sets": {}}))
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


def _fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case_index", range(4))
def test_score_formel_stimmt_mit_der_geteilten_fixture_ueberein(case_index):
    """Derselbe Fall wie in `web/src/scoreParity.test.ts` — gleiche Quelle."""
    data = _fixture()
    case = data["cases"][case_index]
    score = _score_rows(data["rows"], case["eps"], case["liters"])
    assert score == case["expected"]


def test_fixture_deckt_beide_tankmengen_und_schwellen_ab():
    """Die Fixture ist der Ratchet: ohne 60 L fällt die Tankmenge nicht auf."""
    cases = _fixture()["cases"]
    assert {(c["eps"], c["liters"]) for c in cases} == {
        (1.0, 40.0),
        (1.0, 60.0),
        (2.5, 40.0),
        (2.5, 60.0),
    }
    # Euro-Kennzahlen skalieren mit der Tankmenge, ct-Kennzahlen nicht.
    by_liters = {c["liters"]: c["expected"] for c in cases if c["eps"] == 1.0}
    assert by_liters[60.0]["sum_smart_eur"] == pytest.approx(
        by_liters[40.0]["sum_smart_eur"] * 1.5
    )
    assert by_liters[60.0]["avg_regret_ct"] == by_liters[40.0]["avg_regret_ct"]


def test_score_block_nennt_seine_parameter():
    """„+2,12 €“ ohne Tankmenge und Schwelle beantwortet keine Frage."""
    score = _score_rows(_fixture()["rows"], 2.5, 60.0)
    assert score["eps"] == 2.5
    assert score["liters"] == 60.0


def test_profil_tankmenge_ist_lesbar(settings):
    """Ohne Profil gilt der benannte Default, mit Profil dessen Wert."""
    assert active_liters({"profiles": [], "active": None}) == (
        DEFAULT_LITERS,
        "default",
    )
    create_profile(settings, {"name": "Transporter", "liters": 60.0})
    from app.profiles import load_store

    assert active_liters(load_store(settings)) == (60.0, "profile")


def test_profilaenderung_auf_60_l_wirkt_auf_den_score(settings):
    """O21-DoD: eine Profiländerung geht durch den Score."""
    from app.stats_summary import _build_backtest_from_publication

    pub = {
        "forecasts": [
            {
                "station_id": "s1",
                "city": "Frankfurt",
                "backtest_days": 5,
                "metrics": {"mae_ct": 1.0},
                "decision_rows": _fixture()["rows"],
            }
        ]
    }
    before = _build_backtest_from_publication({}, None, pub)
    assert before["defaultLiters"] == DEFAULT_LITERS
    assert before["litersSource"] == "default"
    assert before["stationScores"][0]["liters"] == DEFAULT_LITERS

    create_profile(settings, {"name": "Transporter", "liters": 60.0})
    from app.profiles import load_store

    liters, source = active_liters(load_store(settings))
    after = _build_backtest_from_publication(
        {}, None, pub, liters=liters, liters_source=source
    )
    assert after["defaultLiters"] == 60.0
    assert after["litersSource"] == "profile"
    assert after["stationScores"][0]["liters"] == 60.0
    # Euro skaliert, Trefferquote nicht.
    assert after["stationScores"][0]["sum_smart_eur"] == pytest.approx(
        before["stationScores"][0]["sum_smart_eur"] * 1.5
    )
    assert (
        after["stationScores"][0]["hit_freq"]
        == (before["stationScores"][0]["hit_freq"])
    )


def test_profilaenderung_auf_60_l_wirkt_auf_die_selektion(settings, monkeypatch):
    """O21-DoD: dieselbe Profiländerung geht durch die Selektion.

    `saving_per_fill_eur` = −δ̂ × `tank_volume` / 100 — wurde bisher für feste
    40 L publiziert, egal was im Profil stand.
    """
    from app import selection as selection_module

    seen: dict[str, float] = {}

    class _Cfg:
        bootstrap_samples = 2000
        bootstrap_ew_half_life_days = 14.0
        seed = 42
        step_minutes = 5
        ffill_minutes = 30
        poll_start = 6
        poll_end = 24
        timezone = "Europe/Berlin"

    import pandas as pd

    from engine.selection import SelectionConfig

    def fake_load_observations(_paths, _cfg, _fuel, _ids):
        # Nicht leer: ein leeres Frame bricht den Zweig vor compute_all ab.
        return pd.DataFrame({"price": [1.7]}), None

    def fake_compute_all(_obs, cfg, _metas):
        seen["tank_volume"] = cfg.tank_volume
        return {"cities": [], "top_global": []}

    # `app/selection.py` importiert alles **in** der Funktion — gepatcht wird
    # deshalb die Quelle, nicht das Modul-Attribut.
    monkeypatch.setattr("app.data.metadata", lambda _s: ({}, None))
    monkeypatch.setattr("engine.data.load_observations", fake_load_observations)
    monkeypatch.setattr("engine.selection.compute_all", fake_compute_all)
    monkeypatch.setattr("app.config.engine_config", lambda _s: _Cfg())

    train = settings.runtime / "training"
    train.mkdir(parents=True, exist_ok=True)
    (train / "e10.csv.gz").write_bytes(b"")

    create_profile(settings, {"name": "Transporter", "liters": 60.0})
    selection_module.build_selection(settings, fuels=["e10"])
    assert seen["tank_volume"] == 60.0

    # Und ohne Profil fällt sie auf den benannten Default zurück.
    seen.clear()
    from app.profiles import activate_profile

    activate_profile(settings, None)
    selection_module.build_selection(settings, fuels=["e10"])
    assert seen["tank_volume"] == DEFAULT_LITERS
    assert SelectionConfig().tank_volume == DEFAULT_LITERS
