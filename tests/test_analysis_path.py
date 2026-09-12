"""B14: Selektions-Datenverzeichnis liegt unter ``data/analysis/``.

Geprüft wird die Übergangsregel aus TODO B14: neuer Pfad ist der Default,
ein vorhandener alter Pfad (``docs/analysis/``) wird weiter benutzt statt
still umgezogen, und in diesem Fall gibt es genau einen klaren Hinweis.
"""

import tankapp  # noqa: F401 -- legt data-tools auf den sys.path

import polling_plan


def _reset_hint():
    polling_plan._LEGACY_HINTED.clear()


def test_default_is_data_analysis(tmp_path):
    """Ohne Altbestand zeigt alles auf data/analysis/."""
    _reset_hint()
    assert polling_plan.analysis_dir(tmp_path) == tmp_path / "data" / "analysis"
    assert (
        polling_plan.active_polling(tmp_path)
        == tmp_path / "data" / "analysis" / "stations" / "polling.json"
    )


def test_existing_new_path_wins(tmp_path):
    """Liegt die Datei am neuen Ort, ist der alte Ort irrelevant."""
    _reset_hint()
    new = tmp_path / "data/analysis/stations/polling.json"
    new.parent.mkdir(parents=True)
    new.write_text("{}", encoding="utf-8")
    old = tmp_path / "docs/analysis/stations/polling.json"
    old.parent.mkdir(parents=True)
    old.write_text("{}", encoding="utf-8")
    assert polling_plan.active_polling(tmp_path) == new


def test_legacy_path_is_used_and_announced(tmp_path, capsys):
    """Alter Pfad bleibt gültig — mit Hinweis, ohne Umzug, ohne Datenverlust."""
    _reset_hint()
    old = tmp_path / "docs/analysis/stations/polling.json"
    old.parent.mkdir(parents=True)
    old.write_text("{}", encoding="utf-8")

    assert polling_plan.active_polling(tmp_path) == old
    note = capsys.readouterr().err
    assert "docs/analysis" in note and "data/analysis" in note

    # Zweiter Aufruf: gleiche Entscheidung, aber kein Dauerfeuer im Log.
    assert polling_plan.active_polling(tmp_path) == old
    assert capsys.readouterr().err == ""

    # Nichts wurde verschoben oder angelegt.
    assert old.exists()
    assert not (tmp_path / "data/analysis").exists()


def test_legacy_directory_without_file(tmp_path):
    """Auch das Verzeichnis selbst folgt der Übergangsregel."""
    _reset_hint()
    (tmp_path / "docs/analysis/figures").mkdir(parents=True)
    assert polling_plan.analysis_dir(tmp_path) == tmp_path / "docs" / "analysis"
