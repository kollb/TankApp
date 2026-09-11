"""Dual-Ledger Feedback & Episode Tracking for TankPuls (Konzept §5.2, §5.4, §5.5).

Trennt strikt:
  1. Advice-Ledger  (Modell-Qualität, kein Nutzer-Input nötig):
     Snapshots kollabiert (30-min-Regel), Auto-Settlement nach Fensterende (Brier, Trefferquote).
  2. Wallet-Ledger  (Persönliche Tank-Bilanz, Nutzer meldet Füllung):
     Fills werden offener Episode zugeordnet (Slack-Matching), persönliche €-Ersparnis.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from polling_plan import atomic_json, collector_lock
from .data import metadata

UTC = dt.timezone.utc

FUELS = {"e10", "e5", "diesel"}
# Füllungs-Validierung (§11.2, Prüfstand §3.1): ein Beleg außerhalb dieser
# Grenzen ist kein Messwert, sondern Eingabemüll — 4xx statt still verbuchen.
MIN_LITERS = 5.0
MAX_LITERS = 100.0
MIN_PRICE_PAID = 0.40
MAX_PRICE_PAID = 5.00
# Feedback-Store-Grenze: darüber wird nicht mehr still geleert, sondern
# explizit ``store_too_large`` gemeldet (Prüfstand §3.5). Rotation 90 Tage
# verhindert, dass der Store überhaupt dort ankommt.
FEEDBACK_MAX_BYTES = 10_000_000
FEEDBACK_RETENTION_DAYS = 90

SNAPSHOT_COLLAPSE_MINUTES = 30
EPISODE_MAX_HOURS = 72
NOW_GRACE_MINUTES = 45
WAIT_SLACK_BEFORE_MINUTES = 30
WAIT_SLACK_AFTER_MINUTES = 60
SETTLEMENT_LAG_MINUTES = 30
SETTLEMENT_VOID_AFTER_HOURS = 6
THETA_CT = 1.0  # 1 ct/L Signifikanzschwelle
# Laplace-Glättung der internen P-Schätzung (Schrumpfung zu 0,5 bei wenig Daten).
P_PRIOR_WEIGHT = 10

# M7-Kalibrierungs-Gate (Konzept §0.4, §13): ein **Zähl-Gate** über
# abgeschlossene Advice-Settlements — keine Kalendergröße. Die 90-Tage-
# Übergangsregel (engine/bootstrap.py → ``live_only_days``, CLI
# ``--live-only-days``, Default 90) regelt nur die Datenhygiene
# Archiv → Live-Polling und ist kein Nenner für M7: bei ~1 Empfehlung/Tag
# wären 100 Settlements ~100 Tage, M7 soll aber nach ~4 Wochen Live-Betrieb
# schaltbar sein (§13). Beide Schwellen gehen über ``stats_summary`` an die
# GUI, damit dort keine zweite Wahrheit entsteht.
M7_MIN_RECOMMENDATIONS = 100
M7_BRIER_THRESHOLD = 0.25

_STORE_THREAD_LOCK = threading.Lock()


class StoreTooLarge(RuntimeError):
    """Feedback-Store überschreitet die Größen-Grenze (Prüfstand §3.5).

    Bewusst KEIN ``ValueError``: ``locked_store`` fängt ``ValueError`` ab und
    würde sonst endlos neu laden. Der Aufrufer muss das als expliziten
    Fehlerzustand behandeln statt still mit einem leeren Store
    weiterzurechnen — sonst wären Advice-Historie, Brier-Grundlage und
    Wallet ohne Warnung weg.
    """


@contextmanager
def locked_store(settings):
    """Thread- + prozessübergreifend essicheres Lesen/Schreiben des Feedback-Stores.

    Server (decide/fills/intent) und Worker (settlement) schreiben dieselbe
    Datei; ohne Sperre gingen Snapshots bei gleichzeitigen Requests verloren.

    Schreibt nur bei echter Änderung (Digest-Vergleich) und kappt dabei die
    Retention (90 Tage) — ausgelagerte Einträge landen im JSONL-Archiv.

    Die Lock-Akquise wird bei Kollision retryt; ein ``ValueError`` aus dem
    Rumpf (z. B. Fill-Validierung) wird dagegen unverändert durchgereicht —
    sonst würde die Validierung als „Lock belegt" verschluckt und endlos neu
    versucht.
    """
    with _STORE_THREAD_LOCK:
        lock = None
        last_error = None
        for _ in range(50):
            try:
                lock = collector_lock(
                    feedback_path(settings).parent, label="Feedback-Store"
                )
                lock.__enter__()
                break
            except ValueError as exc:
                last_error = exc
                lock = None
                time.sleep(0.05)
        if lock is None:
            raise last_error
        try:
            store = load_store(settings)
            before = _store_digest(store)
            yield store
            archived = _prune_and_archive(store)
            if archived:
                _append_archive(settings, archived)
            if _store_digest(store) != before:
                save_store(settings, store)
        finally:
            lock.__exit__(None, None, None)


def _now_iso(clock=None) -> str:
    now = clock() if clock else dt.datetime.now(UTC)
    return now.isoformat()


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def feedback_path(settings) -> Path:
    p = settings.runtime / "feedback" / "store.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def feedback_archive_path(settings) -> Path:
    return feedback_path(settings).parent / "archive.jsonl"


def _store_digest(store: dict[str, Any]) -> bytes:
    """Kanonischer Fingerabdruck des Stores — Grundlage des Write-Throttles."""
    payload = json.dumps(store, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).digest()


def _prune_and_archive(store: dict[str, Any]) -> list[dict[str, Any]]:
    """Retention: Einträge älter als ``FEEDBACK_RETENTION_DAYS`` auslagern.

    Gibt die ausgelagerten Einträge zurück (der Aufrufer archiviert sie als
    JSONL). Felder ohne parsebaren Zeitstempel bleiben erhalten (Altdaten).
    """
    cutoff = dt.datetime.now(UTC) - dt.timedelta(days=FEEDBACK_RETENTION_DAYS)
    archived: list[dict[str, Any]] = []
    for key, field in (
        ("episodes", "opened_at"),
        ("settlements", "settled_at"),
        ("fills", "tanked_at"),
    ):
        kept = []
        for item in store.get(key, []):
            stamp = _parse_ts(item.get(field))
            if stamp is None or stamp >= cutoff:
                kept.append(item)
            else:
                archived.append({"collection": key, **item})
        store[key] = kept
    return archived


def _append_archive(settings, items: list[dict[str, Any]]) -> None:
    if not items:
        return
    with feedback_archive_path(settings).open("a", encoding="utf-8") as fh:
        for item in items:
            fh.write(json.dumps(item, ensure_ascii=False, default=str) + "\n")


def load_store(settings) -> dict[str, Any]:
    path = feedback_path(settings)
    raw = None
    try:
        if path.exists() and path.stat().st_size > FEEDBACK_MAX_BYTES:
            raise StoreTooLarge(
                f"Feedback-Store zu groß ({path.stat().st_size} Bytes > "
                f"{FEEDBACK_MAX_BYTES}) — Retention/Archivierung prüfen."
            )
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        raw = None
    if isinstance(raw, dict) and "episodes" in raw:
        return {
            "episodes": raw.get("episodes") or [],
            "fills": raw.get("fills") or [],
            "settlements": raw.get("settlements") or [],
        }
    return {
        "episodes": [],
        "fills": [],
        "settlements": [],
    }


def save_store(settings, store: dict[str, Any]) -> None:
    atomic_json(feedback_path(settings), store)


def _same_advice(a: dict, b: dict) -> bool:
    if not a or not b:
        return False
    action_match = a.get("action") == b.get("action")
    station_match = a.get("station_id") == b.get("station_id")
    alt_match = a.get("alt_station_id") == b.get("alt_station_id")
    fuel_match = a.get("fuel") == b.get("fuel")
    try:
        t_a = dt.datetime.fromisoformat(a.get("emitted_at", "").replace("Z", "+00:00"))
        t_b = dt.datetime.fromisoformat(b.get("emitted_at", "").replace("Z", "+00:00"))
        delta_m = abs((t_b - t_a).total_seconds()) / 60.0
    except Exception:
        delta_m = 999.0
    return (
        action_match
        and station_match
        and alt_match
        and fuel_match
        and delta_m < SNAPSHOT_COLLAPSE_MINUTES
    )


def _open_episode(store: dict[str, Any]) -> dict[str, Any] | None:
    for ep in store.get("episodes", []):
        if ep.get("status") in ("open", "waiting", "due"):
            return ep
    return None


def _parse_ts(value: Any) -> dt.datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    return stamp


def estimate_p(store: dict[str, Any], action: str) -> float | None:
    """Interne sequenzielle P-Schätzung je Aktion (Konzept §5.1, §0.4).

    Schrumpfungs-Schätzer über bereits gesettelte Snapshots derselben Aktion:
    p = (hits + k·0,5) / (n + k), k = 10. Bei n = 0 also 0,5 (uninformativ),
    mit wachsendem n nähert sich p der empirischen Trefferquote. Die Schätzung
    wird zum Emit-Zeitpunkt aus *früheren* Settlements gebildet (expanding
    window) — der Brier-Score darüber ist damit ehrlich sequenziell, nicht
    in-sample. Angezeigt wird p erst nach dem M7-Gate (n ≥ 100, Brier < 0,25);
    gespeichert wird es immer, sonst könnte das Gate nie öffnen.
    """
    track = action_track_record(store, action)
    if track is None:
        return None
    return track["p"]


def action_track_record(store: dict[str, Any], action: str) -> dict[str, Any] | None:
    """Gibt {'p': Schätzer, 'n': bewertete Settlements} je Aktion zurück."""
    if action not in ("wait", "refuel_now", "refuel_elsewhere"):
        return None
    episodes = store.get("episodes", [])
    by_id = {s["id"]: s for ep in episodes for s in ep.get("snapshots", [])}
    n = 0
    hits = 0.0
    for s in store.get("settlements", []):
        if s.get("outcome") not in ("win", "loss", "tie"):
            continue
        snap = by_id.get(s.get("snapshot_id"))
        if not snap or snap.get("action") != action:
            continue
        n += 1
        if s.get("outcome") == "win":
            hits += 1.0
        elif s.get("outcome") == "tie":
            hits += 0.5
    return {
        "p": round((hits + P_PRIOR_WEIGHT * 0.5) / (n + P_PRIOR_WEIGHT), 4),
        "n": n,
    }


def record_snapshot(
    settings, snapshot_data: dict[str, Any], clock=None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Registriert einen Snapshot nach der 30-min-Kollabierungsregel (§5.4).

    Gibt (store, episode) zurück. Die interne P-Schätzung (estimate_p) wird
    aus früheren Settlements gebildet und immer gespeichert — angezeigt wird
    sie erst nach dem M7-Gate.
    """
    with locked_store(settings) as store:
        now_str = _now_iso(clock)
        clock_now = clock() if clock else dt.datetime.now(UTC)

        # 1. Prüfe abgelaufene Episoden
        for ep in store.get("episodes", []):
            if ep.get("status") in ("open", "waiting", "due"):
                opened = _parse_ts(ep.get("opened_at"))
                if opened is None:
                    continue
                age_h = (clock_now - opened).total_seconds() / 3600.0
                if age_h > EPISODE_MAX_HOURS:
                    ep["status"] = "expired"
                    ep["closed_at"] = now_str

        ep = _open_episode(store)
        action = snapshot_data.get("action", "no_advice")

        # Verteilungs-P (§4.1/§4.2): dieselbe Zahl, die das UI nach dem
        # M7-Gate zeigt. Fehlt sie (Altbestand, kein Modell), fällt Brier auf
        # die interne Ledger-Schätzung zurück — sonst könnte das Gate nie öffnen.
        p_besser = snapshot_data.get("p_besser")
        if p_besser is None:
            p_besser = estimate_p(store, action)

        snap_id = _uid("snap")
        snap = {
            "id": snap_id,
            "emitted_at": now_str,
            "clock_hour": snapshot_data.get("clock_hour", 12.0),
            "action": action,
            "city": snapshot_data.get("city"),
            "station_id": snapshot_data.get("station_id"),
            "station_name": snapshot_data.get("station_name"),
            "alt_station_id": snapshot_data.get("alt_station_id"),
            "alt_station_name": snapshot_data.get("alt_station_name"),
            "price_now": snapshot_data.get("price_now"),
            "window_start": snapshot_data.get("window_start"),
            "window_end": snapshot_data.get("window_end"),
            "window_start_hour": snapshot_data.get("window_start_hour"),
            "window_end_hour": snapshot_data.get("window_end_hour"),
            "expected_price": snapshot_data.get("expected_price"),
            "expected_saving_eur": snapshot_data.get("expected_saving_eur", 0.0),
            "p_besser": snapshot_data.get("p_besser"),
            "p_correct": p_besser,
            "liters_assumed": snapshot_data.get("liters_assumed", 40.0),
            "fuel": snapshot_data.get("fuel", "e10"),
            # Konzepteigene Felder (Prüfstand §3.7): Fahrtmodus und
            # Deadline müssen im Store landen, sonst sind spätere
            # Auswertungen (Dedicated? Deadline-Druck?) unmöglich.
            "trip_mode": snapshot_data.get("trip_mode"),
            "latest_by": snapshot_data.get("latest_by"),
        }

        if not ep:
            # Neue Episode
            ep_id = _uid("ep")
            ep = {
                "id": ep_id,
                "opened_at": now_str,
                "closed_at": None,
                "status": "open",
                "intent": "none",
                "first_snapshot": snap,
                "last_snapshot": snap,
                "snapshots": [snap],
            }
            store["episodes"].insert(0, ep)
        else:
            last = ep.get("last_snapshot")
            if last and _same_advice(last, snap):
                # Kollabieren: Vorhandenen Snapshot aktualisieren, aber die
                # ursprüngliche P-Schätzung behalten (sie galt zum Emit-Zeitpunkt).
                updated_snap = {
                    **last,
                    **snap,
                    "id": last["id"],
                    "emitted_at": last["emitted_at"],
                    "p_correct": last.get("p_correct"),
                    "p_besser": last.get("p_besser"),
                }
                ep["last_snapshot"] = updated_snap
                ep["snapshots"] = [
                    updated_snap if s["id"] == last["id"] else s
                    for s in ep.get("snapshots", [])
                ]
            else:
                # Advice gekippt oder > 30 min vergangen -> neuen Snapshot anhängen
                ep["last_snapshot"] = snap
                ep["snapshots"].append(snap)

        return store, ep


def set_intent(settings, episode_id: str, intent: str, clock=None) -> dict[str, Any]:
    """Nutzer setzt Intent: 'wait' | 'navigate' | 'refuel_now' | 'dismiss'.

    Strikt je Episode: Eine unbekannte ID liefert 404, statt still eine
    andere offene Episode umzuschreiben (falsche Intent-Zuordnung würde
    Due-Prompts und Wallet-Matching verfälschen).
    """
    with locked_store(settings) as store:
        now_str = _now_iso(clock)

        for ep in store.get("episodes", []):
            if ep.get("id") == episode_id:
                ep["intent"] = intent
                if intent in ("wait", "navigate"):
                    if ep.get("status") == "open":
                        ep["status"] = "waiting"
                elif intent == "dismiss":
                    ep["status"] = "expired"
                    ep["closed_at"] = now_str
                return ep

        return {"error_code": "episode_not_found"}


def classify_compliance(
    ep: dict[str, Any] | None,
    fill_hour: float,
    station_id: str,
    tanked_at: Any = None,
) -> str:
    """Slack-Matching (§5.4): followed | partial | ignored | unrelated.

    Primär über echte Zeitstempel (tanked_at vs. emitted_at/Fenster): Ein
    reiner Stundenvergleich würde über Mitternacht brechen (23:55 vs. 0:05)
    und Folgetage fälschlich matchen. Nur für Altdaten ohne ISO-Zeiten gilt
    die Stunden-Fallback-Regel.
    """
    if not ep:
        return "unrelated"
    snap = ep.get("last_snapshot")
    if not snap:
        return "unrelated"

    action = snap.get("action")
    snap_station = snap.get("station_id")
    alt_station = snap.get("alt_station_id")

    tanked = _parse_ts(tanked_at)
    emitted = _parse_ts(snap.get("emitted_at"))
    window_start = _parse_ts(snap.get("window_start"))
    window_end = _parse_ts(snap.get("window_end"))

    if tanked is not None and (emitted is not None or window_start is not None):
        at_emit_station = station_id == snap_station
        at_alt_station = bool(alt_station) and station_id == alt_station
        if action == "refuel_now" and emitted is not None:
            within = abs((tanked - emitted).total_seconds()) <= NOW_GRACE_MINUTES * 60
            if (at_emit_station or at_alt_station) and within:
                return "followed"
            if at_emit_station or at_alt_station:
                return "partial"
            return "ignored"
        if action == "wait" and window_start is not None and window_end is not None:
            lo = window_start - dt.timedelta(minutes=WAIT_SLACK_BEFORE_MINUTES)
            hi = window_end + dt.timedelta(minutes=WAIT_SLACK_AFTER_MINUTES)
            in_window = lo <= tanked <= hi
            same = at_emit_station or at_alt_station
            if same and in_window:
                return "followed"
            if same or in_window:
                return "partial"
            return "ignored"
        if action == "refuel_elsewhere":
            if at_alt_station:
                return "followed"
            if at_emit_station:
                return "ignored"
            return "partial"
        return "unrelated"

    # Fallback für Altdaten ohne ISO-Zeiten (stundenbasiert, tagblind).
    snap_hour = snap.get("clock_hour", 12.0)
    try:
        snap_hour = float(snap_hour)
    except (TypeError, ValueError):
        snap_hour = 12.0
    same_station = station_id == snap_station or station_id == alt_station

    if action == "refuel_now":
        if same_station and abs(fill_hour - snap_hour) * 60 <= NOW_GRACE_MINUTES:
            return "followed"
        if same_station:
            return "partial"
        return "ignored"

    if action == "wait":
        w_start = (snap.get("window_start_hour") or 17.5) - 0.5
        w_end = (snap.get("window_end_hour") or 20.5) + 1.0
        in_window = w_start <= fill_hour <= w_end
        if same_station and in_window:
            return "followed"
        if same_station or in_window:
            return "partial"
        return "ignored"

    if action == "refuel_elsewhere":
        if station_id == alt_station:
            return "followed"
        if station_id == snap_station:
            return "ignored"
        return "partial"

    return "unrelated"


def _to_float(value: Any) -> float | None:
    """Strikte Zahl ohne stillen Default: None bei Nicht-Zahl/NaN/∞."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _nowcast_price(
    live_data: Any, station_id: str, city: str, fuel: str
) -> float | None:
    """Frischer Live-Preis der Station (Nowcast, §11.2) — oder None."""
    if live_data is None:
        return None
    try:
        data = live_data.stations(fuel=fuel, city=city)
    except Exception:
        return None
    for s in data.get("stations", []):
        if s.get("station_id") == station_id and s.get("price") is not None:
            try:
                return float(s["price"])
            except (TypeError, ValueError):
                return None
    return None


def _closes_episode(compliance: str, ep: dict[str, Any], station_id: str) -> bool:
    """Nur ein Beleg, der die Empfehlung betrifft, schließt die Folge (§5.4).

    ``unrelated`` (Tanken ohne App) beendet die Advice-Folge NICHT — sonst
    killt ein fachlich fremder Beleg Due-Prompt und M7-Zählfolge
    (Prüfstand §3.2). ``ignored`` schließt nur an der Emit-/Alt-Station
    (z. B. „doch an der empfohlenen Station geblieben“).
    """
    if compliance in ("followed", "partial"):
        return True
    if compliance == "ignored":
        snap = ep.get("last_snapshot") or {}
        emit = snap.get("station_id")
        alt = snap.get("alt_station_id")
        return bool(station_id) and station_id in (emit, alt)
    return False


def record_fill(
    settings, fill_data: dict[str, Any], live_data=None, clock=None
) -> dict[str, Any]:
    """Registriert einen Tankbeleg (Wallet-Ledger) — validiert (§11.2).

    Validierung (Prüfstand §3.1): ``liters`` 5–100, ``price_paid`` 0,40–5,00,
    ``fuel`` ∈ {e10, e5, diesel}, ``station_id`` ∈ Polling-Set. Fehlt
    ``price_paid``, wird der Nowcast-Preis der Station gesucht; ohne ihn
    ``ValueError("price_not_available")`` — kein erfundener 1,70-€-Default.
    """
    with locked_store(settings) as store:
        now_str = _now_iso(clock)

        fill_id = fill_data.get("id") or _uid("fill")

        # Idempotenz: derselbe Beleg wird nie doppelt verbucht.
        for existing in store.get("fills", []):
            if existing.get("id") == fill_id:
                return existing

        # --- Validierung (§11.2, Prüfstand §3.1) ---
        fuel = str(fill_data.get("fuel") or "e10").lower()
        if fuel not in FUELS:
            raise ValueError("invalid_fuel")

        station_id = fill_data.get("station_id") or ""
        metas, _problem = metadata(settings)
        city = next((c for (c, uid) in metas if uid == station_id), None)
        if city is None:
            raise ValueError("unknown_station")

        liters = _to_float(fill_data.get("liters"))
        if liters is None or not (MIN_LITERS <= liters <= MAX_LITERS):
            raise ValueError("invalid_liters")

        price_paid_raw = fill_data.get("price_paid")
        if price_paid_raw is None:
            # §11.2: fehlt price_paid → Nowcast/Poll der Station.
            price_paid = _nowcast_price(live_data, station_id, city, fuel)
            if price_paid is None:
                raise ValueError("price_not_available")
            price_source = "nowcast"
        else:
            price_paid = _to_float(price_paid_raw)
            if price_paid is None or not (
                MIN_PRICE_PAID <= price_paid <= MAX_PRICE_PAID
            ):
                raise ValueError("invalid_price")
            price_source = "explicit"

        episode_id = fill_data.get("episode_id")
        ep = None
        if episode_id:
            for e in store.get("episodes", []):
                if e.get("id") == episode_id:
                    ep = e
                    break
        if not ep:
            ep = _open_episode(store)

        clock_hour = fill_data.get("clock_hour", 12.0)
        station_name = fill_data.get("station_name", "")
        source = fill_data.get("source", "manual")

        compliance = classify_compliance(
            ep, clock_hour, station_id, tanked_at=fill_data.get("tanked_at")
        )

        # Counterfactual = price_now des ersten Snapshots der Folge (oder price_paid wenn keine Folge)
        ref_price = ep.get("first_snapshot", {}).get("price_now") if ep else price_paid
        if ref_price is None or not math.isfinite(ref_price):
            ref_price = price_paid

        saved_eur = round((ref_price - price_paid) * liters, 2)

        fill_event = {
            "id": fill_id,
            "episode_id": ep.get("id") if ep else None,
            "station_id": station_id,
            "station_name": station_name,
            "tanked_at": fill_data.get("tanked_at") or now_str,
            "clock_hour": clock_hour,
            "liters": liters,
            "price_paid": price_paid,
            "price_source": price_source,
            "fuel": fuel,
            "source": source,
            "compliance": compliance,
            "saved_vs_always_now_eur": saved_eur,
        }

        store["fills"].insert(0, fill_event)

        # Episode abschließen — nur wenn der Beleg die Folge betrifft.
        # Das Snapshot-Settlement bleibt Sache des Settlement-Jobs
        # (Fensterende + Lag, gegen beobachtete Preise) — zum Tankzeitpunkt
        # ist das Fenster ggf. noch offen.
        if ep and ep.get("status") in ("open", "waiting", "due"):
            if _closes_episode(compliance, ep, station_id):
                ep["status"] = "resolved"
                ep["closed_at"] = now_str

        return fill_event


def _finite_price(value: Any) -> float | None:
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    return price if math.isfinite(price) and price >= 0 else None


def _realized_min(
    live_data: Any,
    station_id: str,
    city: str,
    fuel: str,
    start: dt.datetime,
    end: dt.datetime,
    now: dt.datetime,
) -> float | None:
    """Billigster *beobachteter* offener Preis im Fenster.

    Fenstergrenzen mit Slack (§5.4): [start − 30 min, end + 60 min].
    None, wenn (noch) kein offener Preis im Fenster bekannt ist — der
    Snapshot bleibt dann 'pending' und wird NIEMALS aus der Prognose
    abgerechnet (kein Self-Grading).
    """
    if live_data is None:
        return None
    hours_back = (now - start).total_seconds() / 3600.0 + 1.0
    if hours_back > 168:
        raise ValueError("unprovable")
    try:
        res = live_data.series(
            station_id, city, fuel, hours=max(1, min(168, math.ceil(hours_back)))
        )
    except Exception:
        return None
    if not isinstance(res, dict) or res.get("error_code"):
        return None
    lo = start - dt.timedelta(minutes=WAIT_SLACK_BEFORE_MINUTES)
    hi = end + dt.timedelta(minutes=WAIT_SLACK_AFTER_MINUTES)
    best = None
    for point in res.get("points", []):
        if point.get("status") != "open":
            continue
        price = _finite_price(point.get("price"))
        stamp = _parse_ts(point.get("timestamp"))
        if price is None or stamp is None:
            continue
        if lo <= stamp <= hi and (best is None or price < best):
            best = price
    return best


def _void_settlement(
    store: dict[str, Any],
    ep: dict[str, Any],
    snap: dict[str, Any],
    now_str: str,
    reason: str,
) -> dict[str, Any]:
    settlement = {
        "snapshot_id": snap.get("id"),
        "episode_id": ep.get("id"),
        "settled_at": now_str,
        "p_emit": snap.get("price_now"),
        "p_realized": None,
        "outcome": "void",
        "void_reason": reason,
        "regret_eur": 0.0,
    }
    store["settlements"].append(settlement)
    return settlement


def _settle_one_snapshot(
    store: dict[str, Any],
    ep: dict[str, Any],
    snap: dict[str, Any],
    now: dt.datetime,
    now_str: str,
    live_data: Any = None,
) -> dict[str, Any] | None:
    """Rechnet einen Snapshot gegen *beobachtete* Preise ab (Konzept §11.2).

    Gibt das Settlement zurück oder None, wenn der Snapshot noch nicht
    abrechenbar ist ('pending': Fenster + Lag noch nicht vorüber, oder die
    realisierten Preise sind noch nicht verfügbar). 'void' bedeutet
    endgültig nicht bewertbar (kein Advice, kein Ankerpreis, Altdaten ohne
    Fenster, Fenster außerhalb der Series-Reichweite, Station geschlossen).
    """
    snap_id = snap.get("id")
    for s in store.get("settlements", []):
        if s.get("snapshot_id") == snap_id:
            return s

    action = snap.get("action", "no_advice")
    if action == "no_advice":
        return _void_settlement(store, ep, snap, now_str, "no_advice")

    p_emit = _finite_price(snap.get("price_now"))
    if p_emit is None:
        return _void_settlement(store, ep, snap, now_str, "no_emit_price")

    start = _parse_ts(snap.get("window_start"))
    end = _parse_ts(snap.get("window_end"))
    if start is None or end is None:
        # Altdaten ohne ISO-Fenster: nicht rekonstruierbar → void, sobald
        # die Episode sicher vorbei ist (Emit + 24 h).
        emitted = _parse_ts(snap.get("emitted_at"))
        if emitted is not None and now < emitted + dt.timedelta(hours=24):
            return None
        return _void_settlement(store, ep, snap, now_str, "legacy_no_window")

    if now < end + dt.timedelta(minutes=SETTLEMENT_LAG_MINUTES):
        return None  # Fenster + Lag noch nicht vorüber → pending

    if (now - start).total_seconds() / 3600.0 > 168:
        return _void_settlement(store, ep, snap, now_str, "beyond_series_range")

    if action == "refuel_elsewhere":
        station_id = snap.get("alt_station_id")
        if not station_id:
            return _void_settlement(store, ep, snap, now_str, "no_alt_station")
    else:
        station_id = snap.get("station_id")
    if not station_id:
        return _void_settlement(store, ep, snap, now_str, "no_station")

    city = snap.get("city")
    if not city:
        # Ohne Stadt wäre die Abrechnung gegen eine geratene Stadt gelaufen
        # (vorher still „Frankfurt", Prüfstand §3.8) — ehrlich void statt falsch.
        return _void_settlement(store, ep, snap, now_str, "no_city")
    fuel = snap.get("fuel") or "e10"
    try:
        p_real = _realized_min(live_data, station_id, city, fuel, start, end, now)
    except ValueError:
        return _void_settlement(store, ep, snap, now_str, "beyond_series_range")
    if p_real is None:
        if now > end + dt.timedelta(hours=SETTLEMENT_VOID_AFTER_HOURS):
            return _void_settlement(store, ep, snap, now_str, "no_realized_price")
        return None  # Influx-Lag o. ä. → später erneut versuchen

    theta = THETA_CT / 100.0  # 0.01 €
    liters = _finite_price(snap.get("liters_assumed")) or 40.0
    saving = p_emit - p_real  # > 0: Warten hat sich gelohnt

    if action == "wait":
        if saving >= theta:
            outcome = "win"
        elif saving <= -theta:
            outcome = "loss"
        else:
            outcome = "tie"
        regret = round(max(0.0, -saving) * liters, 2) if outcome == "loss" else 0.0
    elif action == "refuel_now":
        # Richtig, wenn Warten keine signifikante Ersparnis gebracht hätte.
        outcome = "win" if saving < theta else "loss"
        regret = round(max(0.0, saving) * liters, 2) if outcome == "loss" else 0.0
    else:  # refuel_elsewhere, brutto (Umwegkosten stecken in der Empfehlung)
        if saving >= theta:
            outcome = "win"
        elif saving <= -theta:
            outcome = "loss"
        else:
            outcome = "tie"
        regret = round(max(0.0, -saving) * liters, 2) if outcome == "loss" else 0.0

    settlement = {
        "snapshot_id": snap_id,
        "episode_id": ep.get("id"),
        "settled_at": now_str,
        "p_emit": round(p_emit, 3),
        "p_realized": round(p_real, 3),
        "outcome": outcome,
        "regret_eur": regret,
    }
    store["settlements"].append(settlement)
    return settlement


def settle_snapshots(settings, live_data=None, clock=None) -> dict[str, Any]:
    """Settlement-Job (NAS/Worker, §5.4): rechnet Snapshots nach Fensterende ab."""
    with locked_store(settings) as store:
        now_str = _now_iso(clock)
        clock_now = clock() if clock else dt.datetime.now(UTC)

        settled_count = 0
        due_count = 0

        settled_snap_ids = {s.get("snapshot_id") for s in store.get("settlements", [])}

        for ep in store.get("episodes", []):
            status = ep.get("status")
            intent = ep.get("intent", "none")
            last_snap = ep.get("last_snapshot")
            if not last_snap:
                continue

            window_end = _parse_ts(last_snap.get("window_end"))

            # Wenn Intent 'wait' oder 'navigate' gesetzt war und Fenster vorbei
            # ist -> status wird 'due'. Altdaten ohne ISO-Fenster nutzen die
            # tagblinde Stundenregel nur noch für den Due-Prompt.
            window_over = False
            if window_end is not None:
                window_over = clock_now >= window_end + dt.timedelta(
                    minutes=WAIT_SLACK_AFTER_MINUTES
                )
            else:
                window_over = _legacy_window_over(
                    last_snap.get("window_end_hour", 20.5), clock_now
                )
            if intent in ("wait", "navigate") and status in ("open", "waiting"):
                if window_over:
                    ep["status"] = "due"
                    due_count += 1

            # Generelles Snapshot-Settlement für alle abrechenbaren Fenster
            for snap in ep.get("snapshots", []):
                if snap["id"] not in settled_snap_ids:
                    res = _settle_one_snapshot(
                        store, ep, snap, clock_now, now_str, live_data
                    )
                    if res is not None:
                        settled_snap_ids.add(snap["id"])
                        settled_count += 1

        return {
            "status": "ok",
            "settled_count": settled_count,
            "due_count": due_count,
            "total_settlements": len(store.get("settlements", [])),
        }


def _legacy_window_over(window_end_hour: Any, clock_now: dt.datetime) -> bool:
    """Tagblinde Stundenregel — nur noch für Due-Prompts von Altdaten."""
    try:
        from zoneinfo import ZoneInfo

        berlin_dt = clock_now.astimezone(ZoneInfo("Europe/Berlin"))
        current_hour = berlin_dt.hour + berlin_dt.minute / 60.0
    except Exception:
        current_hour = clock_now.hour + clock_now.minute / 60.0
    try:
        end = float(window_end_hour)
    except (TypeError, ValueError):
        end = 20.5
    return current_hour >= end + WAIT_SLACK_AFTER_MINUTES / 60.0


def _de(value: float) -> str:
    """Zwei Dezimalstellen in deutscher Schreibweise (0,25 statt 0.25).

    Nur für Anzeigetexte — gerechnet wird weiterhin mit dem Float.
    """
    return f"{value:.2f}".replace(".", ",")


def compute_advice_stats(
    store: dict[str, Any], now: dt.datetime | None = None, window_days: int = 30
) -> dict[str, Any]:
    """Berechnet Advice-Ledger-KPIs (Brier, Trefferquoten, Reliability).

    'void'-Settlements (nicht bewertbar, z. B. no_advice oder Station
    geschlossen) zählen weder zu n noch zu Brier.

    Die angezeigten Kennzahlen (``n``, Trefferquoten, ``brier_30d``,
    Reliability) sind ein echtes 30-Tage-Fenster (Prüfstand §3.6) — vorher
    waren es Allzeit-Zahlen unter einem „30d"-Namen. Das M7-Gate selbst ist
    ein Allzeit-Zähl-Gate (§0.4, §13) und rechnet über dieselbe
    Grundgesamtheit wie der Brier (``n_brier_all``), statt Gesamt-n gegen
    die P-Teilmenge zu vergleichen.
    """
    now = now or dt.datetime.now(UTC)
    cutoff = now - dt.timedelta(days=window_days)

    episodes = store.get("episodes", [])
    snapshots_by_id = {s["id"]: s for ep in episodes for s in ep.get("snapshots", [])}

    def in_window(settlement: dict[str, Any]) -> bool:
        stamp = _parse_ts(settlement.get("settled_at"))
        return stamp is None or stamp >= cutoff

    settlements_all = [
        s
        for s in store.get("settlements", [])
        if s.get("outcome") in ("win", "loss", "tie")
    ]
    settlements = [s for s in settlements_all if in_window(s)]
    n_void = sum(
        1
        for s in store.get("settlements", [])
        if s.get("outcome") not in ("win", "loss", "tie") and in_window(s)
    )

    n = len(settlements)
    wins = sum(1 for s in settlements if s.get("outcome") == "win")
    losses = sum(1 for s in settlements if s.get("outcome") == "loss")
    ties = sum(1 for s in settlements if s.get("outcome") == "tie")

    wait_n, wait_hits = 0, 0
    now_n, now_hits = 0, 0
    elsewhere_n, elsewhere_hits = 0, 0

    # Brier-Score Berechnung: BS = 1/N * sum((p_pred - actual)^2)
    # actual = 1 für win, 0 für loss/tie
    brier_sq_errors = []

    # 10 Bins für Reliability Diagramm (0.0–0.1, 0.1–0.2, ..., 0.9–1.0)
    bins = [
        {
            "bin": i,
            "min_p": i * 0.1,
            "max_p": (i + 1) * 0.1,
            "count": 0,
            "p_sum": 0.0,
            "hits": 0,
        }
        for i in range(10)
    ]

    for s in settlements:
        snap = snapshots_by_id.get(s.get("snapshot_id"))
        action = snap.get("action") if snap else None
        p_correct = snap.get("p_correct") if snap else None
        outcome = s.get("outcome")

        is_win = 1.0 if outcome == "win" else 0.0

        if action == "wait":
            wait_n += 1
            if outcome == "win":
                wait_hits += 1
        elif action == "refuel_now":
            now_n += 1
            if outcome == "win":
                now_hits += 1
        elif action == "refuel_elsewhere":
            elsewhere_n += 1
            if outcome == "win":
                elsewhere_hits += 1

        # Brier nur über Snapshots mit gespeicherter interner P-Schätzung.
        # Snapshots ohne p (Altdaten) würden mit einem erfundenen Default den
        # Score verzerren und fallen daher aus Zähler UND Nenner.
        if p_correct is not None and math.isfinite(p_correct):
            p_val = min(1.0, max(0.0, float(p_correct)))
            brier_sq_errors.append((p_val - is_win) ** 2)

            bin_idx = min(9, max(0, int(p_val * 10)))
            bins[bin_idx]["count"] += 1
            bins[bin_idx]["p_sum"] += p_val
            if is_win > 0:
                bins[bin_idx]["hits"] += 1

    n_brier = len(brier_sq_errors)
    brier_30d = round(sum(brier_sq_errors) / n_brier, 4) if n_brier > 0 else None
    hit_rate = round((wins + 0.5 * ties) / n, 3) if n > 0 else None
    hit_wait = round(wait_hits / wait_n, 3) if wait_n > 0 else None
    hit_now = round(now_hits / now_n, 3) if now_n > 0 else None
    hit_elsewhere = round(elsewhere_hits / elsewhere_n, 3) if elsewhere_n > 0 else None

    reliability = []
    for b in bins:
        count = b["count"]
        mean_p = (
            round(b["p_sum"] / count, 3)
            if count > 0
            else round((b["min_p"] + b["max_p"]) / 2, 3)
        )
        emp_hit = round(b["hits"] / count, 3) if count > 0 else None
        reliability.append(
            {
                "bin": b["bin"],
                "range": f"{int(b['min_p'] * 100)}–{int(b['max_p'] * 100)}%",
                "count": count,
                "mean_p": mean_p,
                "empirical_hit_rate": emp_hit,
            }
        )

    # Allzeit-Brier über dieselbe Grundgesamtheit wie das Zähl-Gate: nur
    # Settlements, deren Snapshot eine P-Schätzung trägt.
    brier_all_sq: list[float] = []
    for s in settlements_all:
        snap = snapshots_by_id.get(s.get("snapshot_id"))
        p_correct = snap.get("p_correct") if snap else None
        if p_correct is None or not math.isfinite(p_correct):
            continue
        is_win = 1.0 if s.get("outcome") == "win" else 0.0
        p_val = min(1.0, max(0.0, float(p_correct)))
        brier_all_sq.append((p_val - is_win) ** 2)
    n_brier_all = len(brier_all_sq)
    brier_all = round(sum(brier_all_sq) / n_brier_all, 4) if n_brier_all > 0 else None

    # M7 Kalibrierungs-Gate (§0.4, §6): Allzeit-Zähl-Gate über die gleiche
    # Grundgesamtheit, deren Brier wir messen (n_brier_all), Brier < 0,25.
    # Die 90-Tage-Übergangsregel (live_only_days) ist Datenhygiene und kein
    # Nenner hier.
    n_all = len(settlements_all)
    calibrated = (
        n_brier_all >= M7_MIN_RECOMMENDATIONS
        and brier_all is not None
        and brier_all < M7_BRIER_THRESHOLD
    )
    limit = _de(M7_BRIER_THRESHOLD)
    if n_all < M7_MIN_RECOMMENDATIONS:
        gate_status = f"M7-Kalibrierung steht aus (n={n_all} < {M7_MIN_RECOMMENDATIONS} Empfehlungen)"
    elif brier_all is None:
        # Zählstand reicht, aber kein Settlement trägt eine P-Schätzung: Der
        # Score ist nicht messbar. „kalibriert" wäre erfunden (§0.4).
        gate_status = (
            f"M7-Kalibrierung nicht messbar (n={n_all}, keine P-Schätzung im Ledger)"
        )
    elif n_brier_all < M7_MIN_RECOMMENDATIONS:
        # Gesamt-n reicht, aber die P-Teilmenge nicht — der Brier wäre über
        # eine andere Grundgesamtheit gemessen als der Zähler (Prüfstand §3.6).
        gate_status = (
            f"M7-Kalibrierung nicht messbar (n={n_all}, nur {n_brier_all} "
            "mit P-Schätzung im Ledger)"
        )
    elif brier_all >= M7_BRIER_THRESHOLD:
        gate_status = (
            f"M7-Kalibrierung nicht erreicht (Brier {_de(brier_all)} ≥ {limit})"
        )
    else:
        gate_status = f"M7 kalibriert (n={n_all}, Brier {_de(brier_all)} < {limit})"

    return {
        "n": n,
        "n_void": n_void,
        "n_brier": n_brier,
        "n_all": n_all,
        "n_brier_all": n_brier_all,
        "brier_all": brier_all,
        "wins": wins,
        "losses": losses,
        "ties": ties,
        "hit_rate": hit_rate,
        "hit_wait": hit_wait,
        "hit_now": hit_now,
        "hit_elsewhere": hit_elsewhere,
        "wait_n": wait_n,
        "wait_hits": wait_hits,
        "now_n": now_n,
        "now_hits": now_hits,
        "elsewhere_n": elsewhere_n,
        "elsewhere_hits": elsewhere_hits,
        "brier_30d": brier_30d,
        "calibrated": calibrated,
        "gate_status": gate_status,
        # Schwellen des Zähl-Gates mitliefern: Die GUI zeigt damit „n von 100
        # Empfehlungen" aus demselben Wert, an dem auch hier gerechnet wird —
        # und muss nicht die 90-Tage-Übergangsregel als Nenner missbrauchen.
        "min_recommendations": M7_MIN_RECOMMENDATIONS,
        "brier_threshold": M7_BRIER_THRESHOLD,
        "reliability": reliability,
    }


def compute_wallet_stats(
    store: dict[str, Any], now: dt.datetime | None = None, window_days: int = 30
) -> dict[str, Any]:
    """Berechnet Wallet-Ledger-KPIs (Fills, Ersparnis, Compliance, w(h)-Profil).

    ``n_fills``/Compliance/``saved_eur`` sind ein echtes 30-Tage-Fenster
    (Prüfstand §3.6: die Felder hießen vorher ``…_30d``, zählten aber
    Allzeit). Das w(h)-Profil nutzt weiterhin alle Füllungen — es ist ein
    Langzeitprofil, kein 30-Tage-Wert.
    """
    now = now or dt.datetime.now(UTC)
    cutoff = now - dt.timedelta(days=window_days)

    fills_all = store.get("fills", [])

    def in_window(fill: dict[str, Any]) -> bool:
        stamp = _parse_ts(fill.get("tanked_at"))
        return stamp is None or stamp >= cutoff

    fills = [f for f in fills_all if in_window(f)]
    n_fills = len(fills)

    followed = sum(1 for f in fills if f.get("compliance") == "followed")
    partial = sum(1 for f in fills if f.get("compliance") == "partial")
    ignored = sum(1 for f in fills if f.get("compliance") == "ignored")
    unrelated = sum(1 for f in fills if f.get("compliance") == "unrelated")

    saved_eur = round(sum(f.get("saved_vs_always_now_eur", 0.0) for f in fills), 2)

    # w(h)-Histogramm der Tankzeiten: Default Pendlerprofil w0
    # w0: Mo-Fr 06-09 und 16-20 gewichtet, sonst flach
    w0 = [0.0] * 24
    for h in range(6, 9):
        w0[h] = 0.08
    for h in range(16, 20):
        w0[h] = 0.12
    # Normalisieren
    s0 = sum(w0)
    w0 = [round(v / s0, 4) for v in w0]

    n_all = len(fills_all)
    if n_all < 8:
        wh_hours = w0
    else:
        # Empirisches Histogramm über ALLE Füllungen (Langzeitprofil).
        w_hat = [0.0] * 24
        for f in fills_all:
            h = int(f.get("clock_hour", 12.0)) % 24
            w_hat[h] += 1.0
        w_hat = [v / n_all for v in w_hat]
        # Geschrumpft gegen Default (§5.5 Schicht C): w = (n*w_hat + 8*w0) / (n + 8)
        wh_hours = [
            round((n_all * w_hat[i] + 8 * w0[i]) / (n_all + 8), 4) for i in range(24)
        ]

    return {
        "n_fills": n_fills,
        "followed": followed,
        "partial": partial,
        "ignored": ignored,
        "unrelated": unrelated,
        "saved_eur": saved_eur,
        "wh_hours": wh_hours,
        "last_fill": fills_all[0] if fills_all else None,
    }
