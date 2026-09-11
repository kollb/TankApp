"""P-Seite des Decision Layers zur Laufzeit (Konzept §4.1–4.3).

Rechnet rein in Python über die veröffentlichten Draws
(``app/model_jobs.py`` → ``engine/probabilities.py`` → ``current.json``).
Keine numpy/pandas-Abhängigkeit im Live-API-Pfad; die Listen sind klein
(≤ 500 Draws × ≤ 84 Fenster).

Alle Wahrscheinlichkeiten sind relative Häufigkeiten über dieselben Draws;
``None`` bedeutet „keine Aussage“ (Block ungestützt oder Draws fehlen) und
ist strikt von ``0.0`` zu unterscheiden.
"""

from __future__ import annotations

# Signifikanzschwelle gegen Rauschen (§4.1: θ = 1 ct/L).
THETA_CT = 1.0
# F3-Fenster-P: Umfeld ± 6 h (§4.3).
SURROUNDING_HOURS = 6.0


def _finite(values):
    return [value for value in values if value == value]  # NaN != NaN


def p_better(minima, block_idx: int, anchor: float, theta_ct: float = THETA_CT):
    """F1: ``P( min_{t∈Fenster} p(t) ≤ p_jetzt − θ )`` (§4.1).

    ``minima`` ist die veröffentlichte Draw×Fenster-Matrix, ``block_idx`` das
    Fenster. ``None``, wenn kein gestützter Draw im Fenster liegt.
    """
    if not minima or block_idx is None or anchor is None:
        return None
    column = [row[block_idx] for row in minima if block_idx < len(row)]
    finite = _finite(column)
    if not finite:
        return None
    # Vergleich wie im Settlement (§5.2): p_jetzt − p_min ≥ θ. Direkte
    # Differenz statt „Schwelle − Float-Arithmetik“, damit der θ-Grenzfall
    # (genau 1 ct Ersparnis) nicht durch Float-Rundung verloren geht.
    theta = theta_ct / 100.0
    return round(sum(1 for value in finite if anchor - value >= theta) / len(finite), 4)


def window_p(
    minima, block_idx: int, half_hours: float = SURROUNDING_HOURS, block_hours: float = 2.0
):
    """F3: ``P(Fenster ≤ Minimum im ±half_hours-Umfeld)`` (§4.3).

    Das „Umfeld“ sind die Nachbarfenster (ohne das Fenster selbst) im selben
    Horizont; am Rand wird das Umfeld entsprechend abgeschnitten. ``None``,
    wenn das Fenster ungestützt ist oder das ganze Umfeld keinen gestützten
    Draw hat.
    """
    if not minima or block_idx is None:
        return None
    n_blocks = max((len(row) for row in minima), default=0)
    half = max(1, int(round(half_hours / block_hours)))
    neighbors = [
        j
        for j in range(max(0, block_idx - half), min(n_blocks, block_idx + half + 1))
        if j != block_idx
    ]
    if not neighbors:
        return None
    better = 0
    total = 0
    for row in minima:
        own = row[block_idx] if block_idx < len(row) else None
        if own != own:  # NaN
            continue
        environment = [row[j] for j in neighbors if j < len(row) and row[j] == row[j]]
        if not environment:
            continue
        total += 1
        if own <= min(environment):
            better += 1
    if not total:
        return None
    return round(better / total, 4)


def p_lohnt(
    ref_nowcast,
    alt_nowcast,
    liters: float,
    detour_km_total: float,
    consumption: float,
    speed: float,
    z_used: float,
):
    """F2: ``P(€_netto > 0)`` aus den Nowcast-Draws zweier Stationen (§4.2).

    ``netto = (p̂_ref − p̂_alt)·L − K`` mit ``K = d·(c/100)·p̂_alt + (d/v)·z``
    (§10) — der Spritanteil des Umwegs hängt am Alternativ-Preis und läuft
    daher mit in die Draws ein. **Abweichung (dokumentiert):** die Ziehung ist
    unabhängig, nicht die gemeinsame Ziehung über Stationen aus §4.2.
    """
    if not ref_nowcast or not alt_nowcast:
        return None
    pairs = [
        (ref, alt)
        for ref, alt in zip(ref_nowcast, alt_nowcast)
        if ref == ref and alt == alt
    ]
    if not pairs:
        return None
    if speed <= 0 or liters <= 0:
        return None
    wins = 0
    for ref, alt in pairs:
        netto = (
            ref * liters
            - alt * (liters + detour_km_total * consumption / 100.0)
            - (detour_km_total / speed) * z_used
        )
        if netto > 0:
            wins += 1
    return round(wins / len(pairs), 4)
