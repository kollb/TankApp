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

from .outcomes import threshold_credit
from .route import net_economics

# Signifikanzschwelle gegen Rauschen (§4.1: θ = 1 ct/L).
THETA_CT = 1.0
# F3-Fenster-P: Umfeld ± 6 h (§4.3).
SURROUNDING_HOURS = 6.0


def _finite(values):
    return [value for value in values if value == value]  # NaN != NaN


def _window_neighbors(
    minima, block_idx: int, half_hours: float, block_hours: float
) -> list[int]:
    n_blocks = max((len(row) for row in minima), default=0)
    half = max(1, int(round(half_hours / block_hours)))
    return [
        j
        for j in range(max(0, block_idx - half), min(n_blocks, block_idx + half + 1))
        if j != block_idx
    ]


def p_better(minima, block_idx: int, anchor: float, theta_ct: float = THETA_CT):
    """F1: ``P( min_{t∈Fenster} p(t) ≤ p_jetzt − θ )`` (§4.1).

    Ein Draw auf dem exakten θ-Rand erhält einen halben Treffer (O7), genau
    wie Settlement, Trefferquote und Brier-Ziel. ``None``, wenn kein
    gestützter Draw im Fenster liegt.
    """
    if not minima or block_idx is None or anchor is None:
        return None
    column = [row[block_idx] for row in minima if block_idx < len(row)]
    finite = _finite(column)
    if not finite:
        return None
    theta = theta_ct / 100.0
    credits = [threshold_credit(anchor - value, theta) for value in finite]
    return round(sum(credits) / len(credits), 4)


def window_p_details(
    minima,
    block_idx: int,
    half_hours: float = SURROUNDING_HOURS,
    block_hours: float = 2.0,
):
    """F3-Rohwert, Konkurrenzzahl und basisratenbereinigter Fensterwert.

    Die rohe Wahrscheinlichkeit ist am Horizont-Rand höher, weil dort weniger
    Konkurrenzfenster liegen. Für die Anzeige wird sie deshalb gegen ihre
    Zufallsbasisrate ``1 / (k + 1)`` normiert: ``min(1, p_raw * (k + 1))``.
    Bei identischer Lage bekommen Rand und Mitte damit dieselbe Bewertung
    (O12). Preisgleichstand mit dem günstigsten Nachbarn zählt als halber
    Treffer (O7).
    """
    if not minima or block_idx is None:
        return None
    neighbors = _window_neighbors(minima, block_idx, half_hours, block_hours)
    if not neighbors:
        return None
    credits = []
    for row in minima:
        own = row[block_idx] if block_idx < len(row) else None
        if own != own:  # NaN
            continue
        environment = [row[j] for j in neighbors if j < len(row) and row[j] == row[j]]
        if not environment:
            continue
        # Kleinerer Preis gewinnt. ``threshold_credit`` gibt bei Gleichstand
        # bewusst 0,5 zurück; negieren macht „own < min(environment)“ positiv.
        credits.append(threshold_credit(min(environment) - own))
    if not credits:
        return None
    raw = round(sum(credits) / len(credits), 4)
    competitors = len(neighbors)
    normalized = round(min(1.0, raw * (competitors + 1)), 4)
    return {
        "raw": raw,
        "normalized": normalized,
        "competitors": competitors,
        "baseline": round(1.0 / (competitors + 1), 4),
    }


def window_p(
    minima,
    block_idx: int,
    half_hours: float = SURROUNDING_HOURS,
    block_hours: float = 2.0,
):
    """F3-Rohwert: ``P(Fenster ≤ Minimum im ±half_hours-Umfeld)`` (§4.3).

    Für Darstellungen mit vergleichbaren Sternen verwende
    :func:`window_p_details` und deren ``normalized``-Wert. Der Wrapper bleibt
    für bestehende technische Leser erhalten.
    """
    details = window_p_details(minima, block_idx, half_hours, block_hours)
    return details["raw"] if details is not None else None


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

    ``net_economics`` ist dieselbe Formel, die `/route/evaluate`, die
    Alternativen und die spätere Wallet-Abrechnung nutzen (O9). Ein exakt
    ausgeglichener Draw zählt als halber Treffer (O7).
    """
    if not ref_nowcast or not alt_nowcast:
        return None
    pairs = [
        (ref, alt)
        for ref, alt in zip(ref_nowcast, alt_nowcast)
        if ref == ref and alt == alt
    ]
    if not pairs or speed <= 0 or liters <= 0:
        return None
    credits = [
        threshold_credit(
            net_economics(
                ref, alt, liters, detour_km_total, consumption, speed, z_used
            )["net_eur"]
        )
        for ref, alt in pairs
    ]
    return round(sum(credits) / len(credits), 4)
