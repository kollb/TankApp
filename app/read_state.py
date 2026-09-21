"""Ein gelesener Ledgerstand je Datenrevision — der gemeinsame Lesezustand.

A21-B2.2 (#203). Der Audit vom 21.09.2026 maß auf dem NAS-Pfad:

* ``/overview`` las den Ledger **zweimal** (``decide`` und ``stats_summary``)
  und rechnete Advice- und Wallet-Statistik zweimal — bei 1 600 Settlements
  je 1,82 s, davon 1,79 s doppelt. Über zehn Tagesblöcke entstanden vier
  Bootstrap-Verfahren à 1 000 Wiederholungen **je** Advice-Aufruf.
* Jeder ``/decide``-Poll parste den Store erneut für den Snapshot-Vorblick
  (``_peek_confirmation``) — der Snapshot-Log hing damit am Rechenpfad.
* Die Antwort hatte kein Revisionsmerkmal: Ein Teilfehler einer Komponente
  war von einer vollständigen Antwort nicht zu unterscheiden
  (``error_code=null`` außen, ``influx_read_failed`` innen).

Dieses Modul hält **einen** Lesezustand je Revision:

* Revision = ``data_version()`` (Store, Archiv, Engine-/Selektionsartefakt,
  Polling-Set) **plus** ein 5-Minuten-Uhrfenster (die Statistik hängt an
  Tages-/Stundenfenstern und am Tageswechsel) **plus** der Policy-Schalter
  ``m7_auto_apply``, der die wirksamen Schwellen bestimmt.
* Der Zustand enthält den heißen Store (für den Snapshot-Vorblick), den
  gemergten Ledger (Store + Archiv), die Advice- und Wallet-Statistik und die
  daraus abgeleiteten Schwellen. ``decide`` und ``stats_summary`` teilen
  dieselben Dicts — sie können nicht mehr verschiedene Stände sehen.
* **Singleflight:** Parallele Anfragen derselben Revision warten auf die eine
  Rechnung (``Event``) statt selbst zu bootstrappen. Fehler werden **nicht**
  gespeichert: Wer nach einem Fehlschlag kommt, rechnet selbst.
* **Begrenzte Ablage:** höchstens :data:`MAX_ENTRIES` Revisionen; die älteste
  wird gezielt verdrängt (kein ``clear()``, das auch den aktuellen Stand
  wegwirft).
* Ein grober Rechenriegel (:data:`_COMPUTE_LOCK`) lässt höchstens **eine**
  schwere Rechnung gleichzeitig laufen — auf einem NAS ist das die Grenze,
  die einen Bootstrap-Sturm überhaupt vermeidet.

Was hier **nicht** passiert: Es wird nichts verkürzt, kein Ledger
abgeschnitten, kein Ergebnis erfunden. Die Zahlen bleiben identisch zu einem
direkten ``compute_advice_stats``/``compute_wallet_stats`` auf denselben
Eingaben (das sichert ``tests/test_a21_b2_readstate.py`` ab), sie werden nur
seltener gerechnet.
"""

from __future__ import annotations

import datetime as dt
import threading
import time
from collections import OrderedDict
from typing import Any

from . import feedback, metrics
from .thresholds import active_thresholds

# Obergrenze der Ablage. Mehr als eine Handvoll Revisionen braucht niemand:
# Der Alltag ist eine Stadt, ein Kraftstoff und ein Tagesfenster.
MAX_ENTRIES = 4
# Uhrfenster im Revisionsschlüssel. Die Statistik rechnet über 7-/30-Tage-
# Fenster und Tagesblöcke; ein Tageswechsel ist damit sicher erfasst, ein
# Stundenwechsel wird spätestens nach diesem Fenster neu gerechnet.
CLOCK_BUCKET_SECONDS = 300
# Wartezeit der Mitläufer auf den Singleflight-Eigentümer. Danach rechnen sie
# selbst (kein Fehler wird weitergegeben, keine Anfrage wartet unbegrenzt).
WAIT_TIMEOUT_S = 60.0

_LOCK = threading.Lock()
_COMPUTE_LOCK = threading.Lock()
_MEMO: "OrderedDict[str, ReadBundle]" = OrderedDict()
_INFLIGHT: dict[str, threading.Event] = {}


class ReadBundle:
    """Ein gelesener Ledgerstand mit den daraus gerechneten Kennzahlen."""

    __slots__ = (
        "revision",
        "data_version",
        "clock_bucket",
        "hot_store",
        "ledger",
        "advice",
        "wallet",
        "thresholds",
        "tuning",
        "computed_monotonic",
    )

    def __init__(
        self,
        *,
        revision: str,
        data_version: str,
        clock_bucket: int,
        hot_store: dict[str, Any],
        ledger: dict[str, Any],
        advice: dict[str, Any],
        wallet: dict[str, Any],
        thresholds: Any,
        tuning: Any,
        computed_monotonic: float | None = None,
    ) -> None:
        self.revision = revision
        self.data_version = data_version
        self.clock_bucket = clock_bucket
        self.hot_store = hot_store
        self.ledger = ledger
        self.advice = advice
        self.wallet = wallet
        self.thresholds = thresholds
        self.tuning = tuning
        self.computed_monotonic = computed_monotonic


def clock_bucket(now: dt.datetime) -> int:
    """Uhrfenster eines Zeitpunkts — dieselbe Zahl für dieselben 5 Minuten.

    Bewusst aus dem Datum gerechnet (nicht aus ``timestamp()``): naive und
    zeitzonenbehaftete Uhren (Tests) liefern so denselben, monotonen Wert.
    """
    floor = now.replace(second=0, microsecond=0)
    return int(floor.timestamp() // CLOCK_BUCKET_SECONDS)


def _data_version(settings, now: dt.datetime) -> str:
    """Datenstand aus ``app/data.py`` — bezieht sich auf dieselben Quellen."""
    from .data import data_version

    return data_version(settings, lambda: now)


def revision_key(settings, now: dt.datetime) -> str:
    """Schlüssel des Lesezustands: Datenstand + Uhrfenster + Policy."""
    auto_apply = bool(getattr(settings, "m7_auto_apply", False))
    return f"{_data_version(settings, now)}|{clock_bucket(now)}|{int(auto_apply)}"


def load_bundle(settings, now: dt.datetime) -> ReadBundle:
    """Lesezustand dieser Revision — aus der Ablage oder einmal gerechnet."""
    key = revision_key(settings, now)
    with _LOCK:
        cached = _MEMO.get(key)
        if cached is not None:
            _MEMO.move_to_end(key)
            return cached
        event = _INFLIGHT.get(key)
        if event is None:
            _INFLIGHT[key] = threading.Event()
            owner = True
        else:
            owner = False
    if owner:
        try:
            return _compute_and_store(settings, now, key)
        finally:
            with _LOCK:
                waiter = _INFLIGHT.pop(key, None)
            if waiter is not None:
                waiter.set()
    # Mitläufer: auf die eine Rechnung warten. Ein Fehler des Eigentümers
    # wird nicht kopiert — dann rechnet dieser Thread selbst (und meldet
    # seinen eigenen Fehler).
    event.wait(WAIT_TIMEOUT_S)
    with _LOCK:
        cached = _MEMO.get(key)
    if cached is not None:
        return cached
    return _compute_and_store(settings, now, key)


def _compute_and_store(settings, now: dt.datetime, key: str) -> ReadBundle:
    with _COMPUTE_LOCK:
        with _LOCK:
            cached = _MEMO.get(key)
            if cached is not None:
                return cached
        bundle = _compute(settings, now, key)
        with _LOCK:
            _MEMO[key] = bundle
            _MEMO.move_to_end(key)
            while len(_MEMO) > MAX_ENTRIES:
                # Gezielt die älteste Revision verdrängen — nicht alles leeren.
                _MEMO.popitem(last=False)
        return bundle


def _compute(settings, now: dt.datetime, key: str) -> ReadBundle:
    with metrics.measure("ledger"):
        hot_store = feedback.load_store(settings)
        ledger = feedback.ledger_from_store(hot_store, settings)
    with metrics.measure("advice"):
        advice = feedback.compute_advice_stats(ledger, now=now)
    with metrics.measure("wallet"):
        wallet = feedback.compute_wallet_stats(ledger, now=now)
    # Schwellen aus derselben Statistik: decide und stats_summary lesen sie
    # damit aus **einem** Ergebnis (vorher rechnete jeder Aufruf sie neu).
    thresholds, tuning = active_thresholds(
        advice, auto_apply=bool(getattr(settings, "m7_auto_apply", False))
    )
    return ReadBundle(
        revision=key,
        data_version=key.split("|", 1)[0],
        clock_bucket=clock_bucket(now),
        hot_store=hot_store,
        ledger=ledger,
        advice=advice,
        wallet=wallet,
        thresholds=thresholds,
        tuning=tuning,
        computed_monotonic=time.monotonic(),
    )


def clear_cache() -> None:
    """Ablage leeren — für Tests, Werkzeuge und einen Mess-Neustart."""
    with _LOCK:
        _MEMO.clear()


def cache_info() -> dict[str, Any]:
    """Diagnose: wie viele Revisionen liegen im Prozess (ohne Inhalte)."""
    with _LOCK:
        return {
            "entries": len(_MEMO),
            "max_entries": MAX_ENTRIES,
            "clock_bucket_seconds": CLOCK_BUCKET_SECONDS,
            "inflight": len(_INFLIGHT),
        }
