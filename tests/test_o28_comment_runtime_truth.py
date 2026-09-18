"""O28 — Kleine Unehrlichkeiten in Kommentar und Laufzeit (Batch 8).

Drei Stellen, an denen Code und Kommentar auseinanderliefen
(docs/archiv/OPTIMIERUNGS-BEFUND-2026-09-18.md O28):

(a) ``engine/selection.py`` ließ ``np.nanmean``/``np.nanmedian`` über
    All-NaN-Schnitte laufen — Nachtzellen hinter dem Polling-Fenster und
    tote Stationen sind der erwartbare „keine Aussage“-Fall, trotzdem
    rauhte der letzte Suite-Lauf mit 18 ``RuntimeWarning``-Zeilen über
    ``tests/test_selection.py`` und ``tests/test_lifecycle_twins.py``.
    Hier: derselbe Lauf mit ``RuntimeWarning → error`` bleibt grün.
(b) ``engine/probabilities.py`` behauptete, die gemeinsame Ziehung über
    Stationen (§4.2) sei „noch nicht umgesetzt“ — A11 ist umgesetzt und
    weist sich je Draw-Block aus (``draws_*.shared``). Hier: Ratchet
    gegen die alte Behauptung.
(c) Der Demo-Stapel schrieb seine Veröffentlichung mit ``json.dumps``
    ohne ``allow_nan=False`` (gemessen 51 480 ``NaN``-Token — für Python
    lesbar, für ``jq`` und jeden Browser-Parser ungültig), während
    STATIONEN-TAUSCH.md ausgerechnet an diesem Stapel ``jq '.failures'
    data/runtime/engine/current.json`` nachvollziehbar macht. Hier: der
    Stapel nutzt denselben Schreiber wie die Produktion, und **jede**
    geschriebene Datei besteht die strenge JSON-Prüfung.
"""

import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from engine.selection import SelectionConfig, analyse_city_light

ROOT = Path(__file__).resolve().parents[1]


def _polling_frame(days, station_ids, start="2026-07-01"):
    """Dichte Beobachtungen 06–24 Uhr — Nachtzellen bleiben unbesetzt."""
    frames = []
    rng = np.random.default_rng(21)
    for position, sid in enumerate(station_ids):
        stamps = []
        for day in range(days):
            date = pd.Timestamp(start, tz="Europe/Berlin") + pd.Timedelta(days=day)
            stamps.append(
                pd.date_range(
                    date + pd.Timedelta(hours=6), periods=18 * 12, freq="5min"
                )
            )
        index = stamps[0].append(stamps[1:]) if len(stamps) > 1 else stamps[0]
        frames.append(
            pd.DataFrame(
                {
                    "timestamp": index,
                    "station_id": sid,
                    "city": "Teststadt",
                    "fuel": "E10",
                    "price": 1.70 + 0.01 * position + rng.normal(0, 0.002, len(index)),
                    "status": "open",
                    "source": "influxdb",
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


def test_selection_warnungsfrei_trotz_nachtzellen_und_toter_station():
    """O28a: All-NaN ist der erwartbare Fall — keine RuntimeWarning mehr.

    Nachtzellen (0–6 Uhr, unbesetzt hinter dem Polling-Fenster) und eine
    tote Station (5 statt 20 Tage Daten) erzeugen All-NaN-Schnitte in
    ``nanmean``/``nanmedian``. Mit ``simplefilter("error")`` wird genau
    die Warnung zum Fehler, die vorher durch den Suite-Lauf rauhte.
    """
    frames = []
    for sid in ["a", "b", "c", "d", "e", "tot"]:
        days = 5 if sid == "tot" else 20
        frames.append(_polling_frame(days, [sid]).assign(station_id=sid))
    df = pd.concat(frames, ignore_index=True)

    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)
        result = analyse_city_light(
            df, "Teststadt", SelectionConfig(n_boot=200), np.random.default_rng(42), {}
        )

    assert result is not None
    assert sorted(row["station_id"] for row in result["stations"]) == list("abcde")
    assert result["excluded"] == ["tot"]


def test_wahrscheinlichkeiten_docstring_sagt_die_a11_wahrheit():
    """O28b: Ratchet gegen die veraltete „noch nicht umgesetzt“-Behauptung.

    Die gemeinsame Ziehung über Stationen (Konzept §4.2, A11) ist umgesetzt;
    ``app/model_jobs._draws`` weist sie je Draw-Block aus. Der Docstring von
    ``engine/probabilities.py`` muss sie beim Namen nennen — nicht mehr als
    offene Abweichung.
    """
    source = (ROOT / "engine" / "probabilities.py").read_text(encoding="utf-8")
    assert "noch nicht umgesetzt" not in source, (
        "engine/probabilities.py behauptet wieder, die gemeinsame Ziehung "
        "(§4.2, A11) fehle — sie ist umgesetzt und ausgewiesen."
    )
    assert "A11" in source, (
        "Der Docstring nennt die gemeinsame Ziehung nicht mehr beim "
        "Befund-Namen (A11) — der Querverweis gehört dazu."
    )
    # Die behauptete Umsetzung muss existieren, nicht nur behauptet werden.
    models = (ROOT / "engine" / "models.py").read_text(encoding="utf-8")
    assert "def shared_day_uniforms" in models
    assert "def blocks_from_uniform" in models


def test_analysis_spiegel_behandelt_all_nan_wie_die_engine():
    """O28a: Das Offline-Werkzeug spiegelt den erwartbaren Zweig der Engine.

    ``analysis/station_selection.py`` rechnet dieselbe Stundenverteilung wie
    ``engine/selection.py`` (gespiegelt, siehe 0.49.0). Der All-NaN-Fall ist
    auch hier erwartet — das Ratchet prüft den Quelltext, weil das Werkzeug
    matplotlib voraussetzt und in der Test-Umgebung nicht importierbar ist.
    """
    source = (ROOT / "analysis" / "station_selection.py").read_text(encoding="utf-8")
    assert 'warnings.simplefilter("ignore", RuntimeWarning)' in source, (
        "Der Analysis-Spiegel läuft wieder ohne den erwartbaren Zweig für "
        "All-NaN-Schnitte."
    )


def _strict_loads(text: str):
    """``json.loads`` so streng wie ``jq``: NaN/Infinity sind ungültig."""

    def reject(value):
        raise ValueError(f"kein gültiges JSON-Token: {value}")

    return json.loads(text, parse_constant=reject)


def test_demo_stapel_ist_strenges_json_wie_die_produktion(tmp_path):
    """O28c: Demo-Veröffentlichung über denselben Schreiber wie der NAS-Lauf.

    ``jq -e . current.json`` (STATIONEN-TAUSCH.md) und jeder Browser-Parser
    lehnen ``NaN``-Token ab — ``json.dumps`` ohne ``allow_nan=False``
    schreibt sie trotzdem. Der Stapel nutzt jetzt ``write_split_publication``
    und liegt damit im selben aufgeteilten Layout wie die Produktion; jede
    geschriebene Datei besteht die strenge Prüfung.
    """
    sys.path.insert(0, str(ROOT / "ops/quality"))
    try:
        import demo_data
    finally:
        sys.path.remove(str(ROOT / "ops/quality"))

    demo_data.build(tmp_path, days=45)

    engine_dir = tmp_path / "runtime" / "engine"
    index_text = (engine_dir / "current.json").read_text(encoding="utf-8")
    assert "NaN" not in index_text and "Infinity" not in index_text
    index = _strict_loads(index_text)
    assert index["layout"] == "split-forecast-files"
    # Genau der Aufruf aus STATIONEN-TAUSCH.md, nur hier streng geprüft:
    # jq -e '.failures' data/runtime/engine/current.json
    assert index["failures"] == []
    assert len(index["forecasts"]) == len(demo_data.STATIONS)

    files = sorted((engine_dir / "forecasts").glob("*.json"))
    assert len(files) == len(demo_data.STATIONS)
    for path in files:
        text = path.read_text(encoding="utf-8")
        assert "NaN" not in text and "Infinity" not in text, path.name
        part = _strict_loads(text)
        assert part["forecast"]["draws_24h"]["n"] > 0
