"""P-Seite des Decision Layers zur Laufzeit (Konzept §4.1–4.3).

Rechnet rein in Python über die veröffentlichten Draws
(``app/model_jobs.py`` → ``engine/probabilities.py`` → ``current.json``).
Keine numpy/pandas-Abhängigkeit im Live-API-Pfad; die Listen sind klein
(≤ 500 Draws × ≤ 84 Fenster).

Alle Wahrscheinlichkeiten sind relative Häufigkeiten über dieselben Draws;
``None`` bedeutet „keine Aussage“ (Block ungestützt oder Draws fehlen) und
ist strikt von ``0.0`` zu unterscheiden.

**Eine Lücke, zwei Schreibweisen (O44).** ``engine.probabilities`` füllt
ungestützte Blöcke mit ``NaN``. Auf dem Weg in die Veröffentlichung macht
``engine.storage.json_safe`` daraus ``null``, und ``json.loads`` liest das
als ``None`` zurück — dieselbe Aussage in einer anderen Schreibweise. Geprüft
wird sie hier **einmal** (:func:`_supported`), nicht an jeder Rechenstelle
erneut: Vor 0.49.1 filterten die Funktionen nur ``NaN`` (``value == value``),
und der Live-Pfad stürzte an ``None`` mit ``TypeError`` ab — ``/decide``
antwortete dann ``decide_failed``, sobald die Veröffentlichung einen einzigen
ungestützten Block im Umfeld eines Fensters trug.
"""

from __future__ import annotations

import statistics

from .outcomes import threshold_credit
from .route import net_economics

# Signifikanzschwelle gegen Rauschen (§4.1: θ = 1 ct/L).
THETA_CT = 1.0
# F3-Fenster-P: Umfeld ± 6 h (§4.3).
SURROUNDING_HOURS = 6.0


def _supported(value) -> bool:
    """Trägt dieser Draw-Punkt eine Aussage?

    ``NaN`` (Engine-intern, ``NaN != NaN``) und ``None`` (dieselbe Lücke nach
    dem JSON-Rundlauf, ``json_safe`` schreibt ``NaN`` als ``null``) heißen
    beide „keine Aussage“. Die Unterscheidung ist wichtig: ``0.0`` ist ein
    Ergebnis (nie unterschritten), ``None`` ist keines.
    """
    return value is not None and value == value


def _finite(values):
    return [value for value in values if _supported(value)]


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


def expected_window_min_price(minima, block_idx: int) -> float | None:
    """Median der Fensterminima über alle gestützten Draws (M3).

    Liefert das typische Preisminimum des Fensters in €/L (3 Dezimalstellen).
    Gibt ``None`` zurück, wenn keine gestützten Draws vorliegen.
    """
    if not minima or block_idx is None:
        return None
    column = [row[block_idx] for row in minima if block_idx < len(row)]
    finite = _finite(column)
    if not finite:
        return None
    return round(statistics.median(finite), 3)


def expected_saving(
    minima,
    block_idx: int,
    anchor: float,
    liters: float = 1.0,
) -> float | None:
    """F1: Erwartete Ersparnis aus den Fensterminimum-Draws (M3, Befund 19.09.2026).

    Rechnet den Median über alle gestützten Draws von ``(anchor - m) * liters``,
    wobei ``m = min_{t in Fenster} p(t)`` das Fensterminimum des jeweiligen
    Bootstrap-Draws ist. Entspricht exakt demselben Zufallseffekt wie
    :func:`p_better` („bis zu X €“).

    Gibt ``None`` zurück, wenn keine gestützten Draws vorliegen oder
    Anker/Liter ungültig sind; sonst mindestens ``0.0`` (gerundet auf 2 Stellen).
    """
    if not minima or block_idx is None or anchor is None or liters <= 0:
        return None
    column = [row[block_idx] for row in minima if block_idx < len(row)]
    finite = _finite(column)
    if not finite:
        return None
    m_median = statistics.median(finite)
    saving = max(0.0, (anchor - m_median) * liters)
    return round(saving, 2)


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
        if not _supported(own):
            continue
        environment = [row[j] for j in neighbors if j < len(row) and _supported(row[j])]
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
    ref_price: float | None = None,
):
    """F2: ``P(€_netto > 0)`` aus den Nowcast-Draws zweier Stationen (§4.2).

    Konditionierung (M5, Befund 19.09.2026): Ist der Referenzpreis frisch
    (< eine Poll-Periode), wird er als Konstante ``ref_price`` in die
    Paarung eingesetzt — nur die potenziell stale Seite (die Alternative)
    trägt dann Draws. Wurde ``ref_nowcast`` als skalarer Zahlenwert
    übergeben, wird er ebenfalls als feste Referenz interpretiert.

    ``net_economics`` ist dieselbe Formel, die `/route/evaluate`, die
    Alternativen und die spätere Wallet-Abrechnung nutzen (O9). Ein exakt
    ausgeglichener Draw zählt als halber Treffer (O7).
    """
    if speed <= 0 or liters <= 0:
        return None

    # M5: Skalare Referenz oder explizite Konditionierung
    if (
        ref_price is None
        and isinstance(ref_nowcast, (int, float))
        and _supported(ref_nowcast)
    ):
        ref_price = float(ref_nowcast)

    if ref_price is not None:
        if not _supported(ref_price) or not alt_nowcast:
            return None
        finite_alts = [alt for alt in alt_nowcast if _supported(alt)]
        if not finite_alts:
            return None
        credits = [
            threshold_credit(
                net_economics(
                    ref_price, alt, liters, detour_km_total, consumption, speed, z_used
                )["net_eur"]
            )
            for alt in finite_alts
        ]
        return round(sum(credits) / len(credits), 4)

    if not ref_nowcast or not alt_nowcast:
        return None
    pairs = [
        (ref, alt)
        for ref, alt in zip(ref_nowcast, alt_nowcast)
        if _supported(ref) and _supported(alt)
    ]
    if not pairs:
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
