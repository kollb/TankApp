"""Entscheidungsschwellen und M7-Schwellen-Nachzug (Konzept §4.5, §5.5, §13 M7).

Die Entscheidungstabelle (§4.1/§4.2) arbeitet mit Startschwellen, die bewusst
nicht als Naturkonstanten gelten: M7 zieht sie an die **gemessenen**
Trefferquoten des Advice-Ledgers nach (§5.5 Schicht B, Schritt 4).

Regeln (alle Schwellen nach oben *und* unten begrenzt, ein Zyklus bewegt jede
Schwelle nur um einen begrenzten Schritt — sonst schaukelt sich der Regler
auf):

1. ``hit_wait`` unter Ziel (70 %)  → **WARTEN erschweren**: Prozent- und
   €-Gates der Warten-Zweige steigen. Falsches WARTEN ist der teure Fehler
   (§4.5: Nutzer verliert Geld und ist genervt).
2. ``hit_wait`` über Ziel + 10 pp → **WARTEN erleichtern**: Gates Richtung
   Startwerte senken (nie unter die Startwerte — konservativ).
3. ``hit_now`` unter Ziel (85 %)   → **JETZT seltener**: die €-Schwelle, unter
   der „jetzt tanken“ gilt, sinkt; es öffnen sich mehr Warten-Fenster.
4. Trefferquote ``refuel_elsewhere`` unter 60 % → Netto-Schwelle und
   Prozent-Gate der Umweg-Empfehlung steigen.

Der Nachzug ist **deterministisch aus dem Ledger** abgeleitet (kein zusätzlicher
Zustand) und wird nur wirksam, wenn ``auto_apply`` aktiv ist (Konzept §8.2 Nr. 1:
die Produktion entscheidet weiterhin mit der kalibrierten Tabelle, der
Werkstatt-Slider zeigt nur Konsequenzen).
"""

from __future__ import annotations

from typing import Any

# Startwerte aus Konzept §4.1/§4.2.
DEFAULT_THRESHOLDS: dict[str, float] = {
    "wait_eur_high": 2.0,  # WARTEN grün: Ersparnis ≥ 2,00 € …
    "wait_p_high": 0.70,  #   … und P ≥ 70 %
    "wait_eur_mid": 1.0,  # WARTEN gelb: Ersparnis ≥ 1,00 € …
    "wait_p_mid": 0.60,  #   … und P ≥ 60 %
    "elsewhere_net_eur": 1.5,  # WOANDERS: Netto ≥ 1,50 € …
    "elsewhere_p": 0.50,  #   … und P ≥ 50 %
    "elsewhere_borderline_eur": 0.5,  # WOANDERS grenzwertig: Netto ≥ 0,50 € (untere Grenze der Grauzone, §4.2; route.py und decide teilen diesen Wert)
    "now_eur": 1.0,  # JETZT: Ersparnis < 1,00 €
    "now_p": 0.50,  # JETZT bei P(Warten) < 50 %
}

# Produkt-KPIs (Konzept §6).
TARGETS: dict[str, float] = {
    "hit_wait": 0.70,
    "hit_now": 0.85,
    "hit_elsewhere": 0.60,
}

# Mindest-Stichprobe je Aktion, bevor ein Nachzug etwas vorschlägt.
MIN_N = 25

# Harte Grenzen des Reglers (kein Nachzug läuft aus dem Ruder).
BOUNDS: dict[str, tuple[float, float]] = {
    "wait_eur_high": (2.0, 6.0),
    "wait_p_high": (0.70, 0.90),
    "wait_eur_mid": (1.0, 4.0),
    "wait_p_mid": (0.60, 0.80),
    "elsewhere_net_eur": (1.5, 5.0),
    "elsewhere_p": (0.50, 0.85),
    "elsewhere_borderline_eur": (0.25, 1.0),
    "now_eur": (0.50, 1.0),
    "now_p": (0.50, 0.50),  # fix: P(Warten) < 50 % → jetzt (§4.1)
}

MAX_P_STEP = 0.10
MAX_EUR_STEP = 1.50


def _clamp(name: str, value: float) -> float:
    low, high = BOUNDS.get(name, (0.0, 1e9))
    return round(min(high, max(low, value)), 4)


def _step_p(gap: float) -> float:
    """Prozent-Schritt aus der Ziellücke (pp), begrenzt."""
    return round(min(MAX_P_STEP, max(0.0, gap)), 4)


def _step_eur(gap: float) -> float:
    """€-Schritt aus der Ziellücke, begrenzt."""
    return round(min(MAX_EUR_STEP, max(0.0, gap) * 10.0), 4)


# Schlüsselnamen aus app/feedback.compute_advice_stats().
_N_KEYS = {"wait": "wait_n", "now": "now_n", "elsewhere": "elsewhere_n"}


def _hits(stats: dict[str, Any], prefix: str) -> tuple[float | None, float | None]:
    """(n, Trefferquote) einer Aktion aus compute_advice_stats()."""
    n = stats.get(_N_KEYS.get(prefix, f"{prefix}_n"))
    hit = stats.get(f"hit_{prefix}")
    try:
        n_val = float(n) if n is not None else None
        hit_val = float(hit) if hit is not None else None
    except (TypeError, ValueError):
        return None, None
    return n_val, hit_val


def suggest_thresholds(
    advice_stats: dict[str, Any], base: dict[str, float] | None = None
) -> dict[str, Any]:
    """Leitet aus den Advice-Statistiken einen Schwellen-Vorschlag ab.

    Rückgabe: ``{thresholds, base, reasons, sample, changed, min_n, targets}``.
    Ohne ausreichende Stichprobe bleibt der Vorschlag gleich den Startwerten
    (``changed=False``, ``reasons`` erklärt warum).
    """
    current = dict(base or DEFAULT_THRESHOLDS)
    for key, value in DEFAULT_THRESHOLDS.items():
        current.setdefault(key, value)

    n_wait, hit_wait = _hits(advice_stats, "wait")
    n_now, hit_now = _hits(advice_stats, "now")
    n_else, hit_else = _hits(advice_stats, "elsewhere")

    reasons: list[str] = []
    suggested = dict(current)

    if n_wait is not None and n_wait >= MIN_N and hit_wait is not None:
        gap = TARGETS["hit_wait"] - hit_wait
        if gap > 0:
            step_p, step_eur = _step_p(gap), _step_eur(gap)
            suggested["wait_p_high"] = _clamp(
                "wait_p_high", current["wait_p_high"] + step_p
            )
            suggested["wait_p_mid"] = _clamp(
                "wait_p_mid", current["wait_p_mid"] + step_p
            )
            suggested["wait_eur_high"] = _clamp(
                "wait_eur_high", current["wait_eur_high"] + step_eur
            )
            suggested["wait_eur_mid"] = _clamp(
                "wait_eur_mid", current["wait_eur_mid"] + step_eur / 2
            )
            reasons.append(
                f"WARTEN nur {hit_wait * 100:.0f} % richtig (Ziel "
                f"{TARGETS['hit_wait'] * 100:.0f} %) — Gates angezogen "
                f"(+{step_p * 100:.0f} pp, +{step_eur:.2f} €)."
            )
        elif hit_wait > TARGETS["hit_wait"] + 0.10:
            step_p, step_eur = (
                _step_p(hit_wait - TARGETS["hit_wait"] - 0.10),
                _step_eur(hit_wait - TARGETS["hit_wait"] - 0.10),
            )
            suggested["wait_p_high"] = _clamp(
                "wait_p_high", current["wait_p_high"] - step_p
            )
            suggested["wait_p_mid"] = _clamp(
                "wait_p_mid", current["wait_p_mid"] - step_p
            )
            suggested["wait_eur_high"] = _clamp(
                "wait_eur_high", current["wait_eur_high"] - step_eur
            )
            suggested["wait_eur_mid"] = _clamp(
                "wait_eur_mid", current["wait_eur_mid"] - step_eur / 2
            )
            reasons.append(
                f"WARTEN {hit_wait * 100:.0f} % richtig — Gates gelockert "
                f"(−{step_p * 100:.0f} pp, −{step_eur:.2f} €), nie unter Startwert."
            )
    else:
        reasons.append(
            f"WARTEN: Stichprobe zu klein für einen Nachzug (n={n_wait or 0} < {MIN_N})."
        )

    if n_now is not None and n_now >= MIN_N and hit_now is not None:
        if hit_now < TARGETS["hit_now"]:
            gap = TARGETS["hit_now"] - hit_now
            step_eur = _step_eur(gap)
            suggested["now_eur"] = _clamp("now_eur", current["now_eur"] - step_eur / 2)
            reasons.append(
                f"JETZT nur {hit_now * 100:.0f} % richtig (Ziel "
                f"{TARGETS['hit_now'] * 100:.0f} %) — €-Schwelle auf "
                f"{suggested['now_eur']:.2f} € gesenkt (mehr Warten-Fenster)."
            )
    else:
        reasons.append(
            f"JETZT: Stichprobe zu klein für einen Nachzug (n={n_now or 0} < {MIN_N})."
        )

    if n_else is not None and n_else >= MIN_N and hit_else is not None:
        if hit_else < TARGETS["hit_elsewhere"]:
            gap = TARGETS["hit_elsewhere"] - hit_else
            suggested["elsewhere_net_eur"] = _clamp(
                "elsewhere_net_eur", current["elsewhere_net_eur"] + _step_eur(gap) / 2
            )
            suggested["elsewhere_p"] = _clamp(
                "elsewhere_p", current["elsewhere_p"] + _step_p(gap)
            )
            reasons.append(
                f"WOANDERS nur {hit_else * 100:.0f} % richtig — Netto-Schwelle auf "
                f"{suggested['elsewhere_net_eur']:.2f} € angehoben."
            )
    elif n_else is not None and n_else > 0:
        reasons.append(
            f"WOANDERS: Stichprobe zu klein für einen Nachzug (n={n_else} < {MIN_N})."
        )

    changed = any(
        abs(float(suggested[k]) - float(current[k])) > 1e-9
        for k in DEFAULT_THRESHOLDS
        if k in current
    )

    return {
        "thresholds": suggested,
        "base": dict(current),
        "targets": dict(TARGETS),
        "sample": {
            "n_wait": n_wait,
            "hit_wait": hit_wait,
            "n_now": n_now,
            "hit_now": hit_now,
            "n_elsewhere": n_else,
            "hit_elsewhere": hit_else,
        },
        "reasons": reasons,
        "changed": changed,
        "min_n": MIN_N,
    }


def active_thresholds(
    advice_stats: dict[str, Any],
    auto_apply: bool = False,
    base: dict[str, float] | None = None,
) -> tuple[dict[str, float], dict[str, Any]]:
    """Schwellen für die Entscheidungstabelle + Vorschlag für die Werkstatt.

    ``auto_apply=False`` (Default): die Tabelle rechnet mit den Startwerten,
    der Vorschlag wird nur ausgewiesen (Konzept §8.2 Nr. 1).
    """
    proposal = suggest_thresholds(advice_stats, base=base)
    used = proposal["thresholds"] if auto_apply else proposal["base"]
    proposal["auto_apply"] = bool(auto_apply)
    proposal["applied"] = bool(auto_apply and proposal["changed"])
    return used, proposal
