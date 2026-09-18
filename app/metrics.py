"""Billige Selbstmessung des Servers (O37).

Vor 0.52.0 maß der Server sich selbst nicht: ``time.monotonic()`` diente
ausschließlich Trigger-Abständen und Budgets, und die einzigen Latenzzahlen
im Projekt entstanden durch Handmessung in einer Sandkiste
([docs/QUALITAET.md](../docs/QUALITAET.md)). Auf dem NAS gibt es kein
Äquivalent — also auch keine Frühwarnung, wenn eine Antwort langsamer wird,
weil eine Datei gewachsen ist (O22), ein Parse zurückkommt (O23) oder eine
Sperre im Lesepfad sitzt (O26).

Zwei Felder, keine Infrastruktur:

* ``X-Process-Time`` je Antwort (Header, ``app/server.py``),
* ein rollierendes Fenster über die letzten Antworten, das
  ``/api/v1/health`` als ``performance`` ausweist — p95, Maximum und die
  langsamste Route, dazu das Budget aus ``docs/QUALITAET.md``.

Kosten: eine ``deque`` mit ``WINDOW`` Tupeln und eine Sortierung je
Health-Aufruf. Kein Prometheus, keine Histogramme, kein Export.
"""

from __future__ import annotations

import threading
from collections import deque
from typing import Any

# Fenster über die letzten Antworten. Bei den GUI-Polls (30–60 s je Ansicht,
# mehrere Endpunkte) sind 200 Antworten gut eine halbe Stunde Betrieb —
# lang genug für einen brauchbaren p95, kurz genug, um einen Ausreißer nicht
# über Stunden mitzuschleppen.
WINDOW = 200
# Budget aus docs/QUALITAET.md („Lastpfad LAN“): p95 einer API-Antwort im
# Heimnetz. Steht hier als Zahl, damit /health es neben die Messung stellen
# kann — ein Budget, das nur in der Doku steht, alarmiert niemanden.
REQUEST_BUDGET_MS = 300.0
# Ab so vielen Antworten je Route nennt ``summary`` einen eigenen p95.
# Darunter wäre die Zahl Rauschen (eine einzige langsame Anfrage „gewinnt“).
MIN_SAMPLES_PER_ROUTE = 5

_SAMPLES: deque[tuple[str, float]] = deque(maxlen=WINDOW)
_LOCK = threading.Lock()


def observe(route: str, seconds: float) -> None:
    """Eine beantwortete Anfrage vermerken (Route, Dauer in Sekunden)."""
    with _LOCK:
        _SAMPLES.append((route, seconds))


def reset() -> None:
    """Fenster leeren — für Tests und für einen bewussten Mess-Neustart."""
    with _LOCK:
        _SAMPLES.clear()


def _p95_ms(values: list[float]) -> float:
    """p95 in Millisekunden, nächstgrößere Rangstelle (kein Interpolieren)."""
    ordered = sorted(values)
    index = max(0, -(-int(len(ordered) * 95) // 100) - 1)
    return round(ordered[min(index, len(ordered) - 1)] * 1000.0, 1)


def summary() -> dict[str, Any]:
    """Latenz-Blick für ``/api/v1/health`` — JSON-serialisierbar, ohne I/O.

    ``count`` steht immer dabei: Ein p95 aus drei Antworten ist keine
    Aussage, und ohne Fallzahl wäre er eine.
    """
    with _LOCK:
        samples = list(_SAMPLES)
    if not samples:
        return {
            "window": WINDOW,
            "count": 0,
            "p95_ms": None,
            "max_ms": None,
            "budget_ms": REQUEST_BUDGET_MS,
            "slowest_route": None,
            "slowest_p95_ms": None,
            "by_route": {},
        }
    durations = [seconds for _route, seconds in samples]
    by_route: dict[str, dict[str, Any]] = {}
    routes = sorted({route for route, _seconds in samples})
    for route in routes:
        values = [seconds for name, seconds in samples if name == route]
        if len(values) < MIN_SAMPLES_PER_ROUTE:
            continue
        by_route[route] = {"count": len(values), "p95_ms": _p95_ms(values)}
    slowest_route = None
    slowest_p95 = None
    if by_route:
        slowest_route = max(by_route, key=lambda name: by_route[name]["p95_ms"])
        slowest_p95 = by_route[slowest_route]["p95_ms"]
    return {
        "window": WINDOW,
        "count": len(samples),
        "p95_ms": _p95_ms(durations),
        "max_ms": round(max(durations) * 1000.0, 1),
        "budget_ms": REQUEST_BUDGET_MS,
        "slowest_route": slowest_route,
        "slowest_p95_ms": slowest_p95,
        "by_route": by_route,
    }
