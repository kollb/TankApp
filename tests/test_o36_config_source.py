"""O36 — Eine Konfigurationsquelle statt vier Flächen und einer Zahl als Literal.

Vor 0.47.0 verband jeder Aufrufer die Engine- und die Selektions-Konfiguration
selbst: ``app/selection.py`` kopierte vier Felder (``poll_start``,
``poll_end``, ``timezone``, dazu ``dead_after_days``) und baute seine Engine-
Config mit ``Config()`` — ohne ``city_subdivs`` und ``decision_hour`` aus den
Settings, die ``app/refresh.py`` sehr wohl übernahm. ``app/worker.py`` reichte
die Ziehungen als Literal (B = 2000) im Job-Dispatcher. Wer also
``bootstrap_samples`` in ``engine/config.py`` änderte, bekam mehr Draws in den
Modellen und unverändert 2000 in der Selektion — ohne Fehlermeldung.
``ffill_minutes`` wich ohnehin ab: 30 in der Engine, ``None`` („Kadenz raten“)
in der Selektion.

Batch-Checks:

* ``bootstrap_samples=4000`` in der Engine-Konfiguration führt zu
  ``n_boot == 4000`` in der Selektion — durch ``build_selection`` hindurch;
* ``grep -n "n_boot=2000" app/worker.py`` findet nichts mehr (Ratchet über den
  ganzen Job-Pfad);
* ``ffill_minutes`` hat in beiden Flächen denselben Wert, mit Begründung.
"""

import inspect
import json
import re

import pandas as pd
import pytest

from app.config import Settings, engine_config
from engine.config import Config
from engine.selection import (
    SELECTION_MIN_BOOTSTRAP,
    SelectionConfig,
    bootstrap_floor_note,
)

UID = "00000000-0000-0000-0000-000000000001"


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
    training = tmp_path / "runtime" / "training"
    training.mkdir(parents=True)
    # Inhalt egal: ``load_observations`` ist in den Plumbing-Tests ersetzt.
    pd.DataFrame({"timestamp": [], "station_id": [], "fuel": [], "price": []}).to_csv(
        training / "e10.csv.gz", index=False, compression="gzip"
    )
    return Settings(
        data=tmp_path,
        archive=tmp_path / "archive",
        polling=polling,
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "_netrc",
        static=tmp_path / "static",
        dead_after_days=9,
    )


def test_factory_uebernimmt_alle_gemeinsamen_knoepfe():
    """Ein Wert je Knopf — aus der Engine, nicht aus einer zweiten Default-Tabelle."""
    cfg = Config(
        bootstrap_samples=4000,
        bootstrap_ew_half_life_days=9.0,
        seed=7,
        step_minutes=5,
        ffill_minutes=25,
        poll_start=7,
        poll_end=22,
        timezone="Europe/Berlin",
    )

    sel = SelectionConfig.from_engine_config(cfg)

    assert sel.n_boot == 4000
    assert sel.boot_ew_half_life_days == 9.0
    assert sel.seed == 7
    assert sel.step_min == 5
    assert sel.ffill_minutes == 25.0
    assert (sel.poll_start, sel.poll_end) == (7, 22)
    assert sel.timezone == "Europe/Berlin"


def test_build_selection_rechnet_mit_den_ziehungen_der_engine(settings, monkeypatch):
    """Batch-Check: ``bootstrap_samples=4000`` kommt in der Selektion an."""
    import app.selection as selection
    import engine.data as engine_data
    import engine.selection as engine_selection

    captured = {}

    def fake_load(paths, cfg, fuel, ids):
        captured["engine_config"] = cfg
        return pd.DataFrame({"timestamp": ["2026-09-01"], "price": [1.7]}), {}

    def fake_compute_all(obs, sel_cfg, metas_by_city):
        captured["selection_config"] = sel_cfg
        return {"top_global": [], "cities": [], "diagnostics": []}

    monkeypatch.setattr(engine_data, "load_observations", fake_load)
    monkeypatch.setattr(engine_selection, "compute_all", fake_compute_all)

    result = selection.build_selection(
        settings, fuels=["e10"], config=Config(bootstrap_samples=4000)
    )

    assert result["error_code"] is None
    assert captured["selection_config"].n_boot == 4000, (
        "Die Selektion rechnet nicht mit den Ziehungen der Engine-Konfiguration"
    )
    # Dieselbe Konfiguration versorgt auch das Laden der Trainingsdaten.
    assert captured["engine_config"].bootstrap_samples == 4000


def test_build_selection_uebernimmt_einstellungen_und_fenster(settings, monkeypatch):
    """App-Einstellungen und Polling-Fenster gehen nicht beim Umbau verloren."""
    import app.selection as selection
    import engine.data as engine_data
    import engine.selection as engine_selection

    captured = {}
    monkeypatch.setattr(
        engine_data,
        "load_observations",
        lambda *a, **k: (pd.DataFrame({"timestamp": ["x"], "price": [1.7]}), {}),
    )

    def fake_compute_all(obs, sel_cfg, metas_by_city):
        captured["cfg"] = sel_cfg
        return {"top_global": [], "cities": [], "diagnostics": []}

    monkeypatch.setattr(engine_selection, "compute_all", fake_compute_all)

    # Ohne explizite Config: aus den Settings (engine_config), nicht Config().
    selection.build_selection(settings, fuels=["e10"])

    cfg = captured["cfg"]
    assert cfg.dead_after_days == 9, "A12-Einstellung der Settings verloren"
    assert cfg.fuel == "E10"
    assert (cfg.poll_start, cfg.poll_end) == (6, 24)
    assert cfg.n_boot == Config().bootstrap_samples


def test_worker_reicht_die_konfiguration_statt_einer_zahl(settings, monkeypatch):
    """Der Job-Dispatcher nennt keine Ziehungen mehr (O36)."""
    import app.selection as selection
    import app.worker as worker

    captured = {}

    def fake_build_selection(settings_, fuels=None, config=None, n_boot=None, **kw):
        captured.update({"config": config, "n_boot": n_boot, "fuels": fuels})
        return {"count": 3, "error_code": None}

    monkeypatch.setattr(selection, "build_selection", fake_build_selection)

    outcome = worker.execute("selection", settings)

    assert outcome["state"] == "success"
    assert isinstance(captured["config"], Config), "Worker reicht keine Konfiguration"
    assert captured["n_boot"] is None, "Worker nennt wieder eine Ziehungs-Zahl"
    assert captured["fuels"] == list(settings.model_fuels)


def test_kein_ziehungs_literal_im_job_pfad():
    """Ratchet: ``n_boot=<Zahl>`` darf im App-/Selektionspfad nicht stehen."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    treffer = []
    for path in sorted((root / "app").glob("*.py")) + [
        root / "engine" / "selection.py",
        root / "engine" / "config.py",
    ]:
        for number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if re.search(r"n_boot\s*=\s*\d", line):
                treffer.append(f"{path.relative_to(root)}:{number}: {line.strip()}")
    assert not treffer, "Ziehungs-Literal im Job-Pfad:\n" + "\n".join(treffer)


def test_ffill_minutes_ist_in_beiden_flaechen_dieselbe_zahl():
    """Batch-Check: 30 Minuten überall — nicht 30 gegen „Kadenz raten“."""
    assert Config().ffill_minutes == 30
    derived = SelectionConfig.from_engine_config(Config())
    assert derived.ffill_minutes == 30.0
    # Die Begründung steht an der Definition, nicht nur im CHANGELOG.
    source = inspect.getsource(SelectionConfig)
    assert "O36" in source and "MTS-K" in source


def test_engine_config_nimmt_feiertagsdummy_und_entscheidunt_aus_den_settings(
    tmp_path,
):
    """Die frühere Drift: der Selektions-Job baute ``Config()`` ohne beides."""
    settings = Settings(
        data=tmp_path,
        polling=tmp_path / "polling.json",
        decision_hour=9,
        city_subdivs={"Frankfurt": "HE"},
    )

    cfg = engine_config(settings)

    assert cfg.decision_hour == 9
    assert cfg.city_subdivs == {"Frankfurt": "HE"}


def test_bodenkante_der_12_uhr_regel_hat_eine_quelle(tmp_path):
    """B30: Die Kante wandert über dieselbe Factory — kein zweites Datum.

    Vorher hätte jeder Aufrufer ``price_law_local`` selbst durchreichen
    müssen; wer es vergisst, mischt zwei Rechtslagen in δ̂ und „billigste
    Stunde" (docs/BEFUND-12-UHR-REGEL.md §4).
    """
    from app.law import law_floor_utc
    from engine.models import law_since_utc

    cfg = Config(price_law_local="2026-07-01T12:00")
    derived = SelectionConfig.from_engine_config(cfg)
    assert derived.law_floor == law_since_utc(cfg)

    # App-Seite: Settings → engine_config → Selektion ⇒ dieselbe Instanz.
    settings = Settings(
        data=tmp_path,
        polling=tmp_path / "polling.json",
        price_law_local="2026-07-01T12:00",
    )
    assert engine_config(settings).price_law_local == "2026-07-01T12:00"
    assert SelectionConfig.from_engine_config(
        engine_config(settings)
    ).law_floor == law_floor_utc(settings)


def test_signifikanz_untergrenze_faengt_kleine_engine_werte_ab():
    """Kein stiller Verlust der Signifikanz, wenn ``bootstrap_samples`` sinkt."""
    assert SELECTION_MIN_BOOTSTRAP >= 1000
    floored = SelectionConfig.from_engine_config(Config(bootstrap_samples=200))
    assert floored.n_boot == SELECTION_MIN_BOOTSTRAP
    note = bootstrap_floor_note(200, floored.n_boot)
    assert note and "B=1000" in note and "Benjamini-Hochberg" in note
    # Ein bewusster Override (Demo-Stapel) gilt — und wird benannt.
    override = SelectionConfig.from_engine_config(Config(), n_boot=400)
    assert override.n_boot == 400
    assert bootstrap_floor_note(2000, 400)
    # Normalfall: keine Abweichung, kein Hinweis.
    assert bootstrap_floor_note(2000, 2000) is None
