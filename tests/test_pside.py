"""P-Seite im Live-API-Pfad: app/pside.py (Konzept §4.1–4.3).

Reine Python-Rechnung über die veröffentlichten Draws — keine
numpy/pandas-Abhängigkeit. Alle P sind relative Häufigkeiten über dieselben
Draws; ``None`` heißt „keine Aussage“ (keine Draws / kein gestützter Block).
"""

from app.pside import p_better, p_lohnt, window_p


def test_p_better_threshold_and_none_cases():
    # θ = 1 ct: Ein Draw zählt, wenn p_jetzt − p_min ≥ 0,01. Spalte 0:
    # 1.67, 1.65, 1.60 sind ≥ 1 ct unter 1.689 → 3/4 = 0.75.
    minima = [[1.67, 1.70], [1.65, 1.71], [1.70, 1.72], [1.60, 1.73]]
    assert p_better(minima, 0, 1.689) == 0.75
    # Genau 1 ct unter dem Anker zählt (Grenzfall, kein Float-Verlust).
    assert p_better([[1.679], [1.70]], 0, 1.689) == 0.5
    # Kein Draw unter der Schwelle → 0.0 (nicht None).
    assert p_better([[1.70], [1.71]], 0, 1.689) == 0.0
    # Ohne Draws / ohne Block / ohne Anker: keine Aussage.
    assert p_better(None, 0, 1.689) is None
    assert p_better(minima, None, 1.689) is None
    assert p_better(minima, 0, None) is None


def test_p_better_all_nan_block_is_none():
    assert p_better([[float("nan")], [float("nan")]], 0, 1.689) is None


def test_window_p_surrounding_half_window():
    # Drei Blöcke. Block 1 gewinnt, wenn sein Minimum ≤ Minimum(Block 0, Block 2).
    minima = [
        [1.60, 1.55, 1.62],  # Draw 0: Block 1 (1.55) schlägt 1.60 und 1.62 → win
        [1.50, 1.58, 1.56],  # Draw 1: Block 1 (1.58) schlägt weder 1.50 noch … → loss
    ]
    # half_hours=6 → ±3 Blöcke; hier nur 3 Blöcke, Umfeld = {0, 2}.
    assert window_p(minima, 1) == 0.5
    # Ohne Nachbarn (nur ein Block) oder ohne Draws: keine Aussage.
    assert window_p([[1.0]], 0) is None
    assert window_p(None, 0) is None
    assert window_p(minima, None) is None


def test_window_p_nan_draw_is_skipped():
    minima = [[float("nan"), float("nan"), 1.0], [1.0, 0.9, 1.1]]
    # Draw 0 übersprungen (Fenster NaN); Draw 1: 0.9 ≤ min(1.0, 1.1) → win.
    assert window_p(minima, 1) == 1.0


def test_p_lohnt_basic_netto_share():
    # netto = ref·L − alt·(L + d·c/100) − (d/v)·z. L=40, d=2 km, c=7, v=45, z=10.
    # alt=1.60 → netto = 1.70·40 − 1.60·(40+0.14) − (2/45)·10 = 68 − 64.224 − 0.444 = 3.33 > 0
    # alt=1.72 → netto = 68 − 1.72·40.14 − 0.444 = 68 − 69.04 − 0.444 < 0
    ref = [1.70, 1.70]
    alt = [1.60, 1.72]
    assert p_lohnt(ref, alt, 40.0, 2.0, 7.0, 45.0, 10.0) == 0.5
    # Kein Draw → None; ohne Liter/Tempo → None.
    assert p_lohnt(None, alt, 40.0, 2.0, 7.0, 45.0, 10.0) is None
    assert p_lohnt(ref, alt, 40.0, 2.0, 7.0, 0.0, 10.0) is None


def test_p_lohnt_nan_draws_skipped():
    ref = [1.70, float("nan")]
    alt = [1.60, 1.72]
    assert p_lohnt(ref, alt, 40.0, 2.0, 7.0, 45.0, 10.0) == 1.0
