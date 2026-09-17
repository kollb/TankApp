"""O6 — Die Brier-Schwelle ist kein Münzwurf mehr (Intervall + Referenzen).

Vor 0.45.0 bestand das M7-Gate bei Punkt-Brier < 0,25 — dem Score einer
konstanten 50-Prozent-Vorhersage. Eine Nachkommastelle entschied über
„kalibriert“, ohne Intervall, ohne Fenster, ohne Hysterese
(docs/OPTIMIERUNGS-BEFUND.md O6).

Seit O6 besteht das Gate erst, wenn die Obergrenze des Block-Bootstrap-
Intervalls (Tagesblöcke, 95 %) unter beiden naiven Referenzen — konstanter
Basisrate und Leave-one-out-Klimatologie je (Stunde, Wochentag) — auf
derselben Grundgesamtheit (Verteilungs-P, Allzeit) liegt. Die Antwort nennt
Intervall, Fenstergröße und beide Referenzen.
"""

import datetime as dt

from app.feedback import (
    GATE_BOOTSTRAP_SAMPLES,
    GATE_MIN_DAY_BLOCKS,
    _block_bootstrap_ci,
    _reference_briers,
    compute_advice_stats,
)

NOW = dt.datetime(2026, 9, 10, 14, 0, tzinfo=dt.timezone.utc)


def _store(rows):
    """Baut einen Store aus (Tagesversatz, UTC-Stunde, p, outcome)-Zeilen.

    Stunden um die Mittagszeit: UTC und Europe/Berlin liegen am selben
    Kalendertag (September, UTC+2), Tagesversatz = Tagesblock.
    """
    snaps, settlements = [], []
    for i, (day, hour, p, outcome) in enumerate(rows):
        snaps.append(
            {
                "id": f"s{i}",
                "action": "wait",
                "p_correct": p,
                "p_source": "verteilung",
                "emitted_at": (NOW - dt.timedelta(days=day))
                .replace(hour=hour, minute=0, second=0, microsecond=0)
                .isoformat(),
            }
        )
        settlements.append({"snapshot_id": f"s{i}", "outcome": outcome})
    return {"episodes": [{"id": "ep", "snapshots": snaps}], "settlements": settlements}


def _skill_rows(n_days=20, per_day=5):
    """Diskriminierendes Modell: hohe P auf Treffern, niedrige auf Nieten."""
    rows = []
    outcomes = ["win"] * 70 + ["loss"] * 30
    for i, outcome in enumerate(outcomes):
        rows.append(
            (i // per_day % n_days, 12, 0.9 if outcome == "win" else 0.1, outcome)
        )
    return rows


def test_gate_opens_when_upper_bound_beats_both_references():
    """Batch-Check: Skill (Diskrimination) öffnet das Gate — mit Intervall."""
    advice = compute_advice_stats(_store(_skill_rows()))
    assert advice["gate_n"] == 100
    assert advice["gate_brier"] == 0.01
    assert advice["gate_brier_ci"] == [0.01, 0.01]
    assert advice["gate_ref_base"] == 0.21
    assert advice["gate_ref_climate"] is not None
    assert advice["gate_brier_ci"][1] < advice["gate_ref_base"]
    assert advice["gate_brier_ci"][1] < advice["gate_ref_climate"]
    assert advice["calibrated"] is True
    assert advice["gate_status"].startswith("Kalibriert (n=100, Brier 0,01 [")


def test_response_names_interval_window_and_both_references():
    """Die Antwort enthält Intervall, Fenstergröße und beide Referenzen."""
    advice = compute_advice_stats(_store(_skill_rows()))
    assert advice["gate_brier_ci"] == [0.01, 0.01]
    assert advice["block_days"] == 1
    assert advice["n_day_blocks"] == 20
    assert advice["min_day_blocks"] == GATE_MIN_DAY_BLOCKS == 10
    assert advice["bootstrap_samples"] == GATE_BOOTSTRAP_SAMPLES == 1000
    assert advice["gate_ref_base"] == 0.21
    assert advice["gate_ref_climate"] is not None


def test_constant_base_rate_prediction_fails_despite_low_brier():
    """Der O6-Ratchet: Was die alte 0,25-Regel bestand, besteht nicht mehr.

    Konstante 0,8 bei 80 % Trefferquote: Brier 0,16 < 0,25 (alt: offen),
    aber exakt die Basisraten-Referenz — keine Diskrimination, kein Skill.
    """
    rows = []
    for i in range(100):
        rows.append((i // 5, 12, 0.8, "win" if i < 80 else "loss"))
    advice = compute_advice_stats(_store(rows))
    assert advice["gate_brier"] == 0.16 < 0.25
    assert advice["gate_ref_base"] == 0.16
    assert advice["calibrated"] is False
    assert advice["gate_status"].startswith("Kalibrierung nicht erreicht")


def test_coin_flip_model_fails():
    """Konstante 0,5 bei 50/50: Brier = Referenz — das Gate bleibt zu."""
    rows = []
    for i in range(100):
        rows.append((i // 5, 12, 0.5, "win" if i % 2 == 0 else "loss"))
    advice = compute_advice_stats(_store(rows))
    assert advice["gate_brier"] == 0.25
    assert advice["gate_ref_base"] == 0.25
    assert advice["calibrated"] is False


def test_too_few_day_blocks_is_unmeasurable_not_calibrated():
    """Unter 10 Tagesblöcken gibt es kein Intervall — „nicht messbar“."""
    rows = []
    for i in range(100):
        win = i < 70
        rows.append((i % 3, 12, 0.9 if win else 0.1, "win" if win else "loss"))
    advice = compute_advice_stats(_store(rows))
    assert advice["n_day_blocks"] == 3 < GATE_MIN_DAY_BLOCKS
    assert advice["gate_brier_ci"] is None
    assert advice["calibrated"] is False
    assert "Tagesblöcke" in advice["gate_status"]
    assert advice["gate_status"].startswith("Kalibrierung nicht messbar")


def test_single_day_has_no_interval():
    """Ein Block hätte Varianz null — der degenerierte Fall bleibt zu."""
    rows = [(0, 12, 0.9, "win")] * 70 + [(0, 12, 0.1, "loss")] * 30
    advice = compute_advice_stats(_store(rows))
    assert advice["n_day_blocks"] == 1
    assert advice["gate_brier_ci"] is None
    assert advice["calibrated"] is False


def test_rows_without_date_form_singleton_blocks():
    """Zeilen ohne Datum werden je ein eigener Block — kein Pooling."""
    snaps = []
    settlements = []
    for i in range(100):
        win = i < 70
        snaps.append(
            {
                "id": f"s{i}",
                "action": "wait",
                "p_correct": 0.9 if win else 0.1,
                "p_source": "verteilung",
            }
        )
        settlements.append(
            {"snapshot_id": f"s{i}", "outcome": "win" if win else "loss"}
        )
    store = {"episodes": [{"id": "ep", "snapshots": snaps}], "settlements": settlements}
    advice = compute_advice_stats(store)
    assert advice["n_day_blocks"] == 100
    assert advice["gate_brier_ci"] == [0.01, 0.01]
    assert advice["calibrated"] is True


def test_interval_is_deterministic():
    """Fester Samen: derselbe Store, dasselbe Intervall — über Läufe."""
    store = _store(_skill_rows())
    first = compute_advice_stats(store)["gate_brier_ci"]
    second = compute_advice_stats(store)["gate_brier_ci"]
    assert first == second == [0.01, 0.01]


def test_base_rate_reference_is_mean_squared_error_of_constant_q():
    """Basisrate: konstante empirische Quote — mean((q − y)²)."""
    ref_base, _ = _reference_briers([1.0, 1.0, 1.0, 0.0], [None] * 4)
    assert ref_base == 0.1875


def test_climatology_falls_back_to_base_rate_for_singleton_cells():
    """Einzelzellen raten nicht aus sich selbst — sie nehmen die Quote."""
    outcomes = [1.0, 0.0, 1.0, 0.0]
    cells = [(8, 0), (9, 1), (10, 2), (11, 3)]
    ref_base, ref_climate = _reference_briers(outcomes, cells)
    assert ref_base == 0.25
    assert ref_climate == ref_base


def test_climatology_uses_leave_one_out_not_in_sample():
    """LOO: Jede Zeile wird mit den *anderen* ihrer Zelle bewertet.

    Zwei einstimmige Zellen (10× Treffer, 10× Niete): Die Klimatologie
    erkennt die Struktur (0,0) — ohne LOO wäre sie bei dünnen Zellen
    in-sample-perfekt und damit unschlagbar (O11-Fehler).
    """
    outcomes = [1.0] * 10 + [0.0] * 10
    cells = [(8, 0)] * 10 + [(20, 5)] * 10
    ref_base, ref_climate = _reference_briers(outcomes, cells)
    assert ref_base == 0.25
    assert ref_climate == 0.0


def test_helpers_handle_empty_input():
    """Leere Eingabe → None statt erfundener Null."""
    assert _block_bootstrap_ci([]) == (None, None)
    assert _reference_briers([], []) == (None, None)


def test_single_block_bootstrap_has_zero_width():
    """Der degenerierte Fall, der die Mindestblockzahl begründet.

    Ein einziger Block resampelt immer sich selbst — das „Intervall“ hätte
    Breite null und würde jedes Gate öffnen. Deshalb bleibt es unter
    ``GATE_MIN_DAY_BLOCKS`` None (siehe ``test_single_day_has_no_interval``).
    """
    assert _block_bootstrap_ci([[0.01] * 100]) == (0.01, 0.01)
