"""Billige Selbstmessung des Servers (O37, A21-B2.1).

Vor 0.52.0 maß der Server sich selbst nicht: ``time.monotonic()`` diente
ausschließlich Trigger-Abständen und Budgets, und die einzigen Latenzzahlen
im Projekt entstanden durch Handmessung in einer Sandkiste
([docs/entwicklung/QUALITAET.md](../docs/entwicklung/QUALITAET.md)). Auf dem NAS gibt es kein
Äquivalent — also auch keine Frühwarnung, wenn eine Antwort langsamer wird,
weil eine Datei gewachsen ist (O22), ein Parse zurückkommt (O23) oder eine
Sperre im Lesepfad sitzt (O26).

Zwei Felder, keine Infrastruktur:

* ``X-Process-Time`` je Antwort (Header, ``app/server.py``),
* ein rollierendes Fenster über die letzten Antworten, das
  ``/api/v1/health`` als ``performance`` ausweist — p95, Maximum und die
  langsamste Route, dazu das Budget aus ``docs/entwicklung/QUALITAET.md``.

Kosten: eine ``deque`` mit ``WINDOW`` Tupeln und eine Sortierung je
Health-Aufruf. Kein Prometheus, keine Histogramme, kein Export.

A21-B2.1 ergänzt zwei Dinge, ohne die die Zahlen nicht deutbar waren:

* **``Server-Timing``-Spans je Antwort.** Der Audit (21.09.2026) konnte eine
  2,00-s-Antwort nicht aufteilen: Historienabfrage, Ledgerlesen,
  Advice-Statistik, Snapshot-Lock, Serialisierung und Proxy waren unsichtbar.
  Ein ``RequestSpans``-Sammler je Request hält benannte Abschnitte; die
  Namen sind eine **Whitelist** (``SPANS``), damit die Kardinalität fest
  bleibt — Tokens, Stationsinhalte und Querywerte haben darin nichts zu
  suchen. Verteilt über die Schichten läuft das über einen ``ContextVar``
  (``measure()``), der außerhalb eines Requests ein No-op ist: ``app/data.py``
  und ``app/feedback.py`` kennen den HTTP-Handler nicht.
* **Labels begrenzt.** ``route_label()`` fasst unbekannte API-Pfade zu
  ``/api/v1/*`` zusammen und ersetzt ID-Segmente durch ``*``; ein Client, der
  beliebige Pfade raten lässt, erzeugt damit keine neuen Metriknamen.
"""

from __future__ import annotations

import contextlib
import contextvars
import re
import threading
import time
import uuid
from collections import deque
from typing import Any, Iterator

# Fenster über die letzten Antworten. Bei den GUI-Polls (30–60 s je Ansicht,
# mehrere Endpunkte) sind 200 Antworten gut eine halbe Stunde Betrieb —
# lang genug für einen brauchbaren p95, kurz genug, um einen Ausreißer nicht
# über Stunden mitzuschleppen.
WINDOW = 200
# Budget aus docs/entwicklung/QUALITAET.md („Lastpfad LAN“): p95 einer API-Antwort im
# Heimnetz. Steht hier als Zahl, damit /health es neben die Messung stellen
# kann — ein Budget, das nur in der Doku steht, alarmiert niemanden.
REQUEST_BUDGET_MS = 300.0
# Ab so vielen Antworten je Route nennt ``summary`` einen eigenen p95.
# Darunter wäre die Zahl Rauschen (eine einzige langsame Anfrage „gewinnt“).
MIN_SAMPLES_PER_ROUTE = 5

# A21-B2.1: Die erlaubten Span-Namen von ``Server-Timing``. Bewusst eine
# feste Liste: Sie ist der Vertrag (docs/referenz/API.md) **und** die Grenze
# gegen hochkardinale Labels. Ein unbekannter Name wird verworfen.
SPANS: tuple[str, ...] = (
    # Clientleerlauf zwischen zwei Keep-Alive-Anfragen. Steht im Header,
    # zählt aber ausdrücklich nicht in ``total``/``X-Process-Time`` — genau
    # dieser Fehler (301,7 ms gemeldet, 1,8 ms Arbeit) war der Auditbefund.
    "idle",
    "body",  # Request-Body lesen
    "history",  # Influx-Verlauf / 7-Tage-Kurve
    "decide",  # Entscheidungstabelle (ohne Statistikanteile)
    "ledger",  # Hot-Store + Archiv laden
    "advice",  # Advice-Statistik inkl. Bootstrap
    "wallet",  # Wallet-Statistik inkl. w(h)-Profil
    "stats",  # Statistik-Ebene gesamt (Eltern von advice/wallet)
    "publication",  # Modell-Veröffentlichung parsen
    "snapshot",  # Entscheidungs-Snapshot (Sperre/Pfad)
    "serialize",  # JSON-Serialisierung
    "gzip",  # Kompression
    "total",  # Bearbeitung bis zum Antwortkopf
)
_SPAN_DESCRIPTIONS: dict[str, str] = {
    "idle": "client idle before request line (not part of total)",
    "body": "request body read",
    "history": "price history query",
    "decide": "decision table",
    "ledger": "ledger and archive read",
    "advice": "advice statistics incl. bootstrap",
    "wallet": "wallet statistics",
    "stats": "statistics layer (parent of advice/wallet)",
    "publication": "model publication parse",
    "snapshot": "decision snapshot / store lock",
    "serialize": "json serialization",
    "gzip": "compression",
    "total": "server processing until response head",
}
_SPAN_INDEX = {name: position for position, name in enumerate(SPANS)}

_SAMPLES: deque[tuple[str, float, str | None]] = deque(maxlen=WINDOW)
# A21-B2.1: Der Versand (Socket-Schreibvorgang) liegt **nach** dem
# Antwortkopf und kann deshalb nicht mehr im ``Server-Timing`` dieser Antwort
# stehen. Er wird getrennt gesammelt und in /health als eigene Zahl geführt —
# sonst wäre „Versand“ die einzige Phase ohne Messung.
_SEND_SAMPLES: deque[float] = deque(maxlen=WINDOW)
# Zähler über die Prozesslebenszeit (nicht im Fenster): Statusklassen und
# Keep-Alive-Timeouts. Ein Timeout ohne Antwort darf keine Route „gewinnen“,
# ist aber als Ereignis sichtbar (sonst verschwindet der Pfad ganz).
_COUNTERS: dict[str, int] = {"keep_alive_timeouts": 0, "requests": 0}
_LOCK = threading.Lock()


# --------------------------------------------------------------------------
# Spans (A21-B2.1)
# --------------------------------------------------------------------------


class RequestSpans:
    """Benannte Dauerabschnitte eines Requests — Grundlage von ``Server-Timing``.

    Ein Abschnitt darf mehrfach vorkommen (z. B. ``history`` bei zwei
    Abfragen); die Werte werden summiert. Negative oder unbekannte Namen
    werden ignoriert: Der Sammler ist ein Messinstrument, kein Logger.
    """

    __slots__ = ("request_id", "idle_seconds", "_durations", "_order", "_lock")

    def __init__(self, request_id: str, idle_seconds: float | None = None):
        self.request_id = request_id
        self.idle_seconds = idle_seconds
        self._durations: dict[str, float] = {}
        self._order: list[str] = []
        self._lock = threading.Lock()

    def add(self, name: str, seconds: float, *, respect_order: bool = False) -> None:
        if name not in _SPAN_INDEX or not seconds >= 0.0:
            return
        with self._lock:
            if name in self._durations:
                self._durations[name] += seconds
            else:
                self._durations[name] = seconds
                self._order.append(name)
            if respect_order:
                self._order = sorted(self._order, key=_SPAN_INDEX.__getitem__)

    @contextlib.contextmanager
    def measure(self, name: str) -> Iterator[None]:
        started = time.monotonic()
        try:
            yield
        finally:
            self.add(name, time.monotonic() - started)

    def total_seconds(self) -> float:
        """``total`` — die Bearbeitungszeit bis zum Antwortkopf (ohne ``idle``)."""
        with self._lock:
            return self._durations.get("total", 0.0)

    def header_value(self) -> str:
        """``Server-Timing``-Wert: feste Reihenfolge, Millisekunden, ASCII-``desc``.

        ``idle`` steht zuerst, wenn der Client vor der Anfrage pausiert hat —
        dann ist im DevTools sofort zu sehen, dass die Pause **nicht** in
        ``total`` steckt (genau die Verwechslung des Auditbefunds).
        """
        with self._lock:
            names = [name for name in self._order if name in _SPAN_INDEX]
            entries = {name: self._durations[name] for name in names}
        if self.idle_seconds is not None:
            entries["idle"] = self.idle_seconds
        parts = []
        for name in sorted(entries, key=_SPAN_INDEX.__getitem__):
            parts.append(
                f'{name};dur={entries[name] * 1000.0:.3f};desc="{_SPAN_DESCRIPTIONS[name]}"'
            )
        return ", ".join(parts)

    def ids(self) -> list[str]:
        """Gemessene Span-Namen (ohne ``idle``) — für Tests und Diagnose."""
        with self._lock:
            return list(self._order)


_ACTIVE: contextvars.ContextVar[RequestSpans | None] = contextvars.ContextVar(
    "tankapp_request_spans", default=None
)


def activate(spans: RequestSpans) -> contextvars.Token:
    """Sammler für diesen Request (und diesen Thread) aktivieren."""
    return _ACTIVE.set(spans)


def deactivate(token: contextvars.Token) -> None:
    """Vorherigen Zustand wiederherstellen (Handler-``finally``)."""
    _ACTIVE.reset(token)


def current() -> RequestSpans | None:
    """Aktiver Sammler — ``None`` außerhalb eines Requests."""
    return _ACTIVE.get()


@contextlib.contextmanager
def measure(name: str) -> Iterator[None]:
    """Abschnitt messen, wenn ein Request läuft — sonst ein No-op.

    Aufrufer sind Fachschichten (``app/data.py``, ``app/feedback.py``), die
    weder Handler noch Request kennen sollen. Außerhalb eines Servers
    (Worker, Tests, CLI) kostet der Aufruf einen ``ContextVar``-Zugriff.
    """
    spans = _ACTIVE.get()
    if spans is None:
        yield
        return
    with spans.measure(name):
        yield


# --------------------------------------------------------------------------
# Antwortfenster (O37)
# --------------------------------------------------------------------------


def observe(route: str, seconds: float, status: int | None = None) -> None:
    """Eine beantwortete Anfrage vermerken (Route, Dauer, Statusklasse).

    ``seconds`` ist die Zeit **ab Eingang der Requestzeile** bis zum
    Antwortkopf — Clientleerlauf vor der Anfrage zählt nicht mit, der
    Socket-Schreibvorgang liegt in :func:`observe_send`.
    """
    with _LOCK:
        _SAMPLES.append((route, seconds, _status_class(status)))
        _COUNTERS["requests"] += 1


def observe_send(seconds: float) -> None:
    """Versanddauer einer Antwort (Socket-Schreiben) getrennt vermerken."""
    if seconds < 0.0:
        return
    with _LOCK:
        _SEND_SAMPLES.append(seconds)


def note_keep_alive_timeout() -> None:
    """Keep-Alive-Verbindung ohne Antwort geschlossen (Leerlauf-Timeout).

    Der Pfad läuft denselben Handler wie eine Antwort, hat aber keine Route
    und keine Dauer; er wird gezählt, nicht als Latenz gebucht.
    """
    with _LOCK:
        _COUNTERS["keep_alive_timeouts"] += 1


def reset() -> None:
    """Fenster und Zähler leeren — für Tests und für einen Mess-Neustart."""
    with _LOCK:
        _SAMPLES.clear()
        _SEND_SAMPLES.clear()
        for key in _COUNTERS:
            _COUNTERS[key] = 0


def _status_class(status: int | None) -> str | None:
    if status is None:
        return None
    if 200 <= status < 300:
        return str(status) if status != 200 else "2xx"
    if 300 <= status < 400:
        return str(status) if status == 304 else "3xx"
    if 400 <= status < 500:
        return "4xx"
    if 500 <= status < 600:
        return "5xx"
    return "other"


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
        sends = list(_SEND_SAMPLES)
        counters = dict(_COUNTERS)
    payload: dict[str, Any] = {
        "window": WINDOW,
        "count": len(samples),
        "p95_ms": None,
        "max_ms": None,
        "budget_ms": REQUEST_BUDGET_MS,
        "slowest_route": None,
        "slowest_p95_ms": None,
        "by_route": {},
        "by_status": {},
        "send_count": len(sends),
        "send_p95_ms": None,
        "send_max_ms": None,
        "keep_alive_timeouts": counters["keep_alive_timeouts"],
        "requests": counters["requests"],
        "spans": list(SPANS),
    }
    if not samples:
        return payload
    durations = [seconds for _route, seconds, _status in samples]
    by_route: dict[str, dict[str, Any]] = {}
    for route in sorted({route for route, _seconds, _status in samples}):
        values = [seconds for name, seconds, _status in samples if name == route]
        if len(values) < MIN_SAMPLES_PER_ROUTE:
            continue
        by_route[route] = {"count": len(values), "p95_ms": _p95_ms(values)}
    slowest_route = None
    slowest_p95 = None
    if by_route:
        slowest_route = max(by_route, key=lambda name: by_route[name]["p95_ms"])
        slowest_p95 = by_route[slowest_route]["p95_ms"]
    by_status: dict[str, int] = {}
    for _route, _seconds, status in samples:
        key = status or "unknown"
        by_status[key] = by_status.get(key, 0) + 1
    payload.update(
        {
            "p95_ms": _p95_ms(durations),
            "max_ms": round(max(durations) * 1000.0, 1),
            "slowest_route": slowest_route,
            "slowest_p95_ms": slowest_p95,
            "by_route": by_route,
            "by_status": by_status,
        }
    )
    if sends:
        payload["send_p95_ms"] = _p95_ms(sends)
        payload["send_max_ms"] = round(max(sends) * 1000.0, 1)
    return payload


# --------------------------------------------------------------------------
# Begrenzte Labels (A21-B2.1)
# --------------------------------------------------------------------------

# Segmente, die wie eine ID aussehen (UUID, Hex, Zahl) — sie werden durch
# ``*`` ersetzt. Alles andere bleibt stehen, aber nur innerhalb der
# bekannten Routen; unbekannte API-Pfade landen im Sammelnamen.
_ID_SEGMENT = re.compile(
    r"^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    r"|[0-9a-f]{8,}|\d+)$",
    re.IGNORECASE,
)
MAX_LABEL_CHARS = 64


def _normalize_ids(path: str) -> str:
    parts = path.split("/")
    return "/".join("*" if _ID_SEGMENT.match(part) else part for part in parts)


def route_label(
    path: str,
    *,
    known: frozenset[str] | tuple[str, ...] = (),
    prefixes: tuple[str, ...] = (),
) -> str:
    """Metrikname einer Route — ohne Query, ohne IDs, ohne Überraschungen.

    * exakte bekannte Route → sie selbst,
    * bekannter Pfadanfang (``/api/v1/jobs/``) → ``…/*``-Form,
    * sonst alles unter ``/api/`` bzw. ``/v1/`` → ``/api/v1/*`` (ein
      ratender Client erzeugt damit keine neuen Labels),
    * alles andere → ``static`` (Einzel-Assets aufzuschreiben brächte je
      Build neue Namen und keine Erkenntnis).
    """
    if not path.startswith(("/api/", "/v1/")):
        return "static"
    if path in known:
        return path
    for prefix in prefixes:
        if path.startswith(prefix):
            rest = path[len(prefix) :]
            segments = [segment for segment in rest.split("/") if segment]
            named = "/".join("*" if segment else "*" for segment in segments)
            return f"{prefix}{named}" if named else f"{prefix}*"
    normalized = _normalize_ids(path)
    if normalized in known and len(normalized) <= MAX_LABEL_CHARS:
        return normalized
    return "/api/v1/*"


def new_request_id() -> str:
    """Kurze, zufällige Request-ID — ohne Personenbezug, ohne Zeitanteil."""
    return uuid.uuid4().hex[:16]


_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


def sanitize_request_id(value: str | None) -> str | None:
    """Vom Client gelieferte Request-ID übernehmen — nur im erlaubten Format.

    Der Wert landet im Antwort-Header und in keinem Log: Er wird deshalb
    streng geprüft (Länge, Zeichenvorrat), damit keine Header-Injektion und
    keine hochkardinalen Fremdwerte durchgereicht werden.
    """
    if not value or not isinstance(value, str):
        return None
    value = value.strip()
    if not _REQUEST_ID.match(value):
        return None
    return value
