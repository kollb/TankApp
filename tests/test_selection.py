"""engine.selection: FDR-Signifikanz (B=2000) und EW-δ̂/Strukturbruch."""

import inspect
import re

import numpy as np
import pandas as pd
import pytest

from engine.config import Config
from engine.selection import (
    SelectionConfig,
    _benjamini_hochberg,
    analyse_city_light,
    compute_all,
)


def test_selection_default_b_is_2000():
    assert SelectionConfig().n_boot == 2000
    assert Config().bootstrap_samples == 2000


def test_nas_jobs_nehmen_die_ziehungen_aus_der_engine_konfiguration():
    """O36-Ratchet: keine Ziehungs-Literale im Job-Pfad.

    Der Vorgänger dieses Tests pinnte ``n_boot=2000`` als Literal in
    ``worker.execute``/``refresh`` — genau die zweite Wahrheit, die O36
    entfernt. Die **Absicht** bleibt: B darf nicht still auf einen Wert
    fallen, mit dem Benjamini-Hochberg über das Stations-Set keine
    Signifikanz mehr erreicht (siehe ``SELECTION_MIN_BOOTSTRAP``).
    """
    import app.refresh as refresh
    import app.selection as selection
    import app.worker as worker
    from engine.selection import SELECTION_MIN_BOOTSTRAP

    for function in (worker.execute, refresh.refresh, selection.build_selection):
        source = inspect.getsource(function)
        assert not re.search(r"n_boot\s*=\s*\d", source), (
            f"{function.__name__} trägt wieder ein Ziehungs-Literal"
        )

    # Eine Quelle: Default 2000 aus der Engine-Konfiguration, und ein
    # bewusst kleiner Engine-Wert fällt nicht unter die Signifikanzgrenze.
    assert SelectionConfig.from_engine_config(Config()).n_boot == 2000
    assert (
        SelectionConfig.from_engine_config(Config(bootstrap_samples=200)).n_boot
        == SELECTION_MIN_BOOTSTRAP
    )


def test_bh_q_unreachable_at_b200_reachable_at_b2000():
    # Strengster Fall: eine Alternative, zehn H0-wahr (q ≈ p_min * m).
    m = 11
    p200 = np.ones(m)
    p200[0] = 1 / (200 + 1)
    p2000 = np.ones(m)
    p2000[0] = 1 / (2000 + 1)
    q200 = _benjamini_hochberg(p200)
    q2000 = _benjamini_hochberg(p2000)
    assert float(q200.min()) > 0.05
    assert float(q2000.min()) < 0.05


def test_selection_reports_ew_delta_and_break_flag():
    """Integration: 4 Stationen, eine mit Preissenkung nach 21 Tagen."""
    index = pd.date_range("2026-06-01", periods=42 * 24, freq="h", tz="UTC")
    rng = np.random.default_rng(5)
    frames = []
    for position, sid in enumerate(["a", "b", "c", "d"]):
        price = 1.70 + rng.normal(0, 0.002, len(index))
        if sid == "a":
            price[21 * 24 :] -= 0.05
        frames.append(
            pd.DataFrame(
                {
                    "timestamp": index,
                    "station_id": sid,
                    "city": "Teststadt",
                    "fuel": "E10",
                    "price": price,
                    "status": "open",
                    "source": "influxdb",
                }
            )
        )
    df = pd.concat(frames, ignore_index=True)
    cfg = SelectionConfig(n_boot=200, step_min=60)
    result = analyse_city_light(df, "Teststadt", cfg, np.random.default_rng(42), {})
    assert result is not None
    by_id = {row["station_id"]: row for row in result["stations"]}
    shifted = by_id["a"]
    for key in (
        "delta_ct",
        "delta_ew_ct",
        "delta_recent5_ct",
        "delta_days",
        "break_flag",
        "break_stat",
        "saving_ew_per_fill_eur",
    ):
        assert key in shifted, key
    # Klassisch gemischt (~-2,5 ct), EW näher am neuen Regime (~-5 ct).
    assert shifted["delta_ct"] == pytest.approx(-2.5, abs=1.0)
    assert shifted["delta_ew_ct"] < shifted["delta_ct"]
    assert abs(shifted["delta_ew_ct"] - (-5.0)) < abs(shifted["delta_ct"] - (-5.0))
    assert shifted["delta_recent5_ct"] == pytest.approx(-5.0, abs=1.0)
    assert shifted["break_flag"] is True
    # Unveränderte Stationen ohne Bruch.
    assert by_id["b"]["break_flag"] is False


def test_analysis_module_mirrors_ew_helpers(monkeypatch):
    try:
        import analysis.station_selection as analysis
    except ImportError:
        # CI installiert kein matplotlib: Plot-Backend stubben, um die
        # reinen Numpy-Helfer des gespiegelten Analyse-Moduls zu prüfen.
        import sys
        import types

        stub = types.ModuleType("matplotlib")
        stub.use = lambda *args, **kwargs: None
        monkeypatch.setitem(sys.modules, "matplotlib", stub)
        monkeypatch.setitem(
            sys.modules, "matplotlib.pyplot", types.ModuleType("matplotlib.pyplot")
        )
        import analysis.station_selection as analysis
    assert analysis.Config().boot_ew_half_life_days == 14.0
    assert analysis.Config().delta_ew_half_life_days == 7.0
    assert analysis.exp_weights(4, 7.0).sum() == pytest.approx(1.0)
    assert analysis.weighted_median(np.array([1.0, 2.0, 3.0]), None) == pytest.approx(
        2.0
    )
    rng = np.random.default_rng(2)
    delta = np.concatenate([rng.normal(0, 0.2, 240), rng.normal(-5, 0.2, 240)])
    days = np.repeat(np.arange(20), 24).astype(float)
    boots_uniform, _ = analysis.day_block_bootstrap(
        delta, days, 300, np.random.default_rng(1), None
    )
    boots_ew, _ = analysis.day_block_bootstrap(
        delta, days, 300, np.random.default_rng(1), 14.0
    )
    assert float(np.median(boots_ew)) < float(np.median(boots_uniform))


# --- B21: Coverage-Gate — warum „e10: 0 Stationen“ passierte -----------------
#
# Befund (13.09.2026, reproduziert): Das Gate verglich die Abdeckung jeder
# Station mit dem vollen 5-Minuten-Raster über die gesamte Datenreichweite.
# Zwei strukturelle Gründe machen 85 % dort unerreichbar, egal wie vollständig
# die Daten sind — im Live-Betrieb maximal 77,5 % (der Collector pollt 06–24
# Uhr, die Nachtzellen sind nie besetzt), im Archiv-/Bootstrap-Betrieb ~4,8 %
# (Preis-*Ereignisse* statt Rasterpunkte, 30-min-ffill). Folge: alle Stationen
# ausgeschlossen, `top_global` leer, „Meine Stationen“ dauerhaft leer.


def _polling_frame(
    days, station_ids, start="2026-07-01", source="influxdb", step="5min"
):
    """Dichte Beobachtungen 06–24 Uhr (Polling-Kadenz des Collectors)."""
    frames = []
    rng = np.random.default_rng(21)
    for position, sid in enumerate(station_ids):
        stamps = []
        for day in range(days):
            date = pd.Timestamp(start, tz="Europe/Berlin") + pd.Timedelta(days=day)
            stamps.append(
                pd.date_range(date + pd.Timedelta(hours=6), periods=18 * 12, freq=step)
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
                    "source": source,
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


def test_coverage_gate_ignores_unpolled_night_cells():
    """Lückenloses 06–24-Polling ergibt ein Ranking — nicht „0 Stationen“.

    Gegenprobe zum Befund: dieselben Daten lieferten vor der Korrektur
    Coverage 77,5 % (Nachtzellen im Nenner) und damit null Stationen.
    """
    df = _polling_frame(20, ["a", "b", "c", "d", "e"])
    result = analyse_city_light(
        df, "Teststadt", SelectionConfig(n_boot=200), np.random.default_rng(42), {}
    )
    assert result["station_count"] == 5
    assert sorted(row["station_id"] for row in result["stations"]) == list("abcde")
    # Im Polling-Fenster ist der Bestand lückenlos; die Referenz ist der
    # Bestwert der Stadt und liegt deutlich über der alten Vollraster-Marke.
    assert result["coverage_reference"] == pytest.approx(1.0, abs=1e-9)
    assert result["coverage_window"] == "06-24"
    assert result["coverage_threshold"] == pytest.approx(0.85)


def test_coverage_gate_survives_archive_prefix():
    """Archiv-Präfix + Live (Bootstrap-Betrieb) bleibt rankbar.

    Das Archiv liefert Preis-Ereignisse; die dichte Live-Phase drückt den
    Median-Gap auf 5 min und damit das ffill auf 30 min — gemessen 4,8 %
    Abdeckung gegen das Vollraster. Das Gate darf deshalb nicht absolut sein.
    """
    rng = np.random.default_rng(11)
    frames = []
    for day in range(30):
        date = pd.Timestamp("2026-06-01", tz="Europe/Berlin") + pd.Timedelta(days=day)
        hours = np.sort(rng.uniform(0, 24, 12))
        stamps = pd.DatetimeIndex([date + pd.Timedelta(hours=float(h)) for h in hours])
        for position, sid in enumerate(["a", "b", "c", "d", "e"]):
            frames.append(
                pd.DataFrame(
                    {
                        "timestamp": stamps,
                        "station_id": sid,
                        "city": "Teststadt",
                        "fuel": "E10",
                        "price": 1.70 + 0.01 * position,
                        "status": "open",
                        "source": "history",
                    }
                )
            )
    live = _polling_frame(2, ["a", "b", "c", "d", "e"], start="2026-06-30")
    result = analyse_city_light(
        pd.concat(frames + [live], ignore_index=True),
        "Teststadt",
        SelectionConfig(n_boot=200),
        np.random.default_rng(42),
        {},
    )
    assert result["station_count"] == 5
    # Beleg, dass ein absolutes 85-%-Gate hier ausgeschlossen hätte.
    assert result["coverage_reference"] < 0.5


def test_dead_station_is_excluded_by_relative_gate():
    """Das Gate trennt weiter: wer aufhört zu liefern, fliegt raus."""
    frames = []
    for sid in ["a", "b", "c", "d", "e", "tot"]:
        days = 5 if sid == "tot" else 20
        frames.append(_polling_frame(days, [sid]).assign(station_id=sid))
    df = pd.concat(frames, ignore_index=True)
    result = analyse_city_light(
        df, "Teststadt", SelectionConfig(n_boot=200), np.random.default_rng(42), {}
    )
    assert sorted(row["station_id"] for row in result["stations"]) == list("abcde")
    assert result["excluded"] == ["tot"]
    assert result["excluded_count"] == 1
    assert result["coverage_threshold"] == pytest.approx(0.85)


def test_city_without_overlap_reports_reason_instead_of_vanishing():
    """Nie ≥4 Stationen gleichzeitig ⇒ Diagnose-Eintrag, kein stilles None."""
    frames = []
    for sid, hour_from, hour_to in [
        ("a", 6, 12),
        ("b", 6, 12),
        ("c", 14, 20),
        ("d", 14, 20),
    ]:
        day_frames = []
        for day in range(8):
            date = pd.Timestamp("2026-07-01", tz="Europe/Berlin") + pd.Timedelta(
                days=day
            )
            index = pd.date_range(
                date + pd.Timedelta(hours=hour_from),
                periods=(hour_to - hour_from) * 12,
                freq="5min",
            )
            day_frames.append(
                pd.DataFrame(
                    {
                        "timestamp": index,
                        "station_id": sid,
                        "city": "Teststadt",
                        "fuel": "E10",
                        "price": 1.70,
                        "status": "open",
                        "source": "influxdb",
                    }
                )
            )
        frames.append(pd.concat(day_frames, ignore_index=True))
    df = pd.concat(frames, ignore_index=True)
    cfg = SelectionConfig(n_boot=200)
    result = analyse_city_light(df, "Teststadt", cfg, np.random.default_rng(42), {})
    assert result["station_count"] == 0
    assert result["stations"] == []
    assert "ohne verwertbares δ̂" in result["reason"]
    # compute_all behält die Stadt als Diagnose und publiziert kein Ranking.
    overall = compute_all(df, cfg, {"Teststadt": {}})
    assert overall["top_global"] == []
    assert len(overall["diagnostics"]) == 1
    assert len(overall["cities"]) == 1


def test_poll_window_changes_nothing_when_night_has_data():
    """Invarianz: Das Fenster ist ein Nenner, kein Eingriff in die Zahlen.

    Liegen nachts Beobachtungen (z. B. Archiv), sind 06–24 und 00–24 dieselbe
    Rechnung — δ̂, KI, Score und Rang bleiben bitgleich.
    """
    index = pd.date_range("2026-06-01", periods=42 * 24, freq="h", tz="UTC")
    rng = np.random.default_rng(5)
    frames = []
    for position, sid in enumerate(["a", "b", "c", "d", "e"]):
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
    df = pd.concat(frames, ignore_index=True)

    def run(poll_start, poll_end):
        cfg = SelectionConfig(
            n_boot=200, poll_start=poll_start, poll_end=poll_end, step_min=60
        )
        return analyse_city_light(df, "Teststadt", cfg, np.random.default_rng(42), {})

    day_only, full_day = run(6, 24), run(0, 24)
    assert [row["rank"] for row in day_only["stations"]] == [
        row["rank"] for row in full_day["stations"]
    ]
    for row_day, row_full in zip(
        day_only["stations"], full_day["stations"], strict=True
    ):
        assert row_day["station_id"] == row_full["station_id"]
        for key in ("delta_ct", "delta_ew_ct", "ci_lo", "ci_hi", "score", "coverage"):
            left, right = row_day[key], row_full[key]
            if left is None or right is None:
                assert left == right, key
            else:
                assert float(left) == pytest.approx(float(right), abs=0.0, rel=0.0), key


def test_nas_callers_pass_the_poll_window_to_selection():
    """Beide NAS-Rechnungen messen Coverage im Fenster der Engine-Config.

    Ohne das misst die Selektion Nachtzellen als fehlende Daten — genau der
    B21-Befund. Seit O36 reicht nicht mehr jeder Aufrufer das Fenster per Hand
    durch, sondern ``SelectionConfig.from_engine_config`` übernimmt es:
    Geprüft wird die Wirkung (ein verschobenes Fenster kommt an) und dass
    beide Aufrufer die Factory nutzen.
    """
    import inspect

    import app.refresh as refresh
    import app.selection as selection

    derived = SelectionConfig.from_engine_config(Config(poll_start=7, poll_end=22))
    assert (derived.poll_start, derived.poll_end) == (7, 22)

    for function in (refresh.refresh, selection.build_selection):
        assert "from_engine_config" in inspect.getsource(function), (
            f"{function.__name__} baut die Selektions-Konfiguration wieder selbst"
        )
