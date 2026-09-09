"""Dual-Ledger Feedback & Episode Tracking for TankPuls (Konzept §5.2, §5.4, §5.5).

Trennt strikt:
  1. Advice-Ledger  (Modell-Qualität, kein Nutzer-Input nötig):
     Snapshots kollabiert (30-min-Regel), Auto-Settlement nach Fensterende (Brier, Trefferquote).
  2. Wallet-Ledger  (Persönliche Tank-Bilanz, Nutzer meldet Füllung):
     Fills werden offener Episode zugeordnet (Slack-Matching), persönliche €-Ersparnis.
"""

from __future__ import annotations

import datetime as dt
import math
import uuid
from pathlib import Path
from typing import Any

from polling_plan import atomic_json
from .data import read_json

UTC = dt.timezone.utc

SNAPSHOT_COLLAPSE_MINUTES = 30
EPISODE_MAX_HOURS = 72
NOW_GRACE_HOURS = 0.75
WAIT_GRACE_AFTER_HOURS = 1.0
THETA_CT = 1.0  # 1 ct/L Signifikanzschwelle


def _now_iso(clock=None) -> str:
    now = clock() if clock else dt.datetime.now(UTC)
    return now.isoformat()


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def feedback_path(settings) -> Path:
    p = settings.runtime / "feedback" / "store.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load_store(settings) -> dict[str, Any]:
    raw = read_json(feedback_path(settings), None)
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
    return action_match and station_match and alt_match and fuel_match and delta_m < SNAPSHOT_COLLAPSE_MINUTES


def _open_episode(store: dict[str, Any]) -> dict[str, Any] | None:
    for ep in store.get("episodes", []):
        if ep.get("status") in ("open", "waiting", "due"):
            return ep
    return None


def record_snapshot(settings, snapshot_data: dict[str, Any], clock=None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Registriert einen Snapshot nach der 30-min-Kollabierungsregel (§5.4).

    Gibt (store, episode) zurück.
    """
    store = load_store(settings)
    now_str = _now_iso(clock)
    clock_now = clock() if clock else dt.datetime.now(UTC)

    # 1. Prüfe abgelaufene Episoden
    for ep in store.get("episodes", []):
        if ep.get("status") in ("open", "waiting", "due"):
            try:
                opened = dt.datetime.fromisoformat(ep.get("opened_at", "").replace("Z", "+00:00"))
                age_h = (clock_now - opened).total_seconds() / 3600.0
                if age_h > EPISODE_MAX_HOURS:
                    ep["status"] = "expired"
                    ep["closed_at"] = now_str
            except Exception:
                pass

    ep = _open_episode(store)

    snap_id = _uid("snap")
    snap = {
        "id": snap_id,
        "emitted_at": now_str,
        "clock_hour": snapshot_data.get("clock_hour", 12.0),
        "action": snapshot_data.get("action", "no_advice"),
        "station_id": snapshot_data.get("station_id"),
        "station_name": snapshot_data.get("station_name"),
        "alt_station_id": snapshot_data.get("alt_station_id"),
        "alt_station_name": snapshot_data.get("alt_station_name"),
        "price_now": snapshot_data.get("price_now"),
        "window_start_hour": snapshot_data.get("window_start_hour"),
        "window_end_hour": snapshot_data.get("window_end_hour"),
        "expected_price": snapshot_data.get("expected_price"),
        "expected_saving_eur": snapshot_data.get("expected_saving_eur", 0.0),
        "p_correct": snapshot_data.get("p_correct"),
        "liters_assumed": snapshot_data.get("liters_assumed", 40.0),
        "fuel": snapshot_data.get("fuel", "e10"),
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
            # Kollabieren: Vorhandenen Snapshot aktualisieren
            updated_snap = {**last, **snap, "id": last["id"], "emitted_at": last["emitted_at"]}
            ep["last_snapshot"] = updated_snap
            ep["snapshots"] = [updated_snap if s["id"] == last["id"] else s for s in ep.get("snapshots", [])]
        else:
            # Advice gekippt oder > 30 min vergangen -> neuen Snapshot anhängen
            ep["last_snapshot"] = snap
            ep["snapshots"].append(snap)

    save_store(settings, store)
    return store, ep


def set_intent(settings, episode_id: str, intent: str, clock=None) -> dict[str, Any]:
    """Nutzer setzt Intent: 'wait' | 'navigate' | 'refuel_now' | 'dismiss'."""
    store = load_store(settings)
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
            save_store(settings, store)
            return ep

    # Falls episode_id nicht existiert, offene Episode suchen
    open_ep = _open_episode(store)
    if open_ep:
        open_ep["intent"] = intent
        if intent in ("wait", "navigate"):
            if open_ep.get("status") == "open":
                open_ep["status"] = "waiting"
        elif intent == "dismiss":
            open_ep["status"] = "expired"
            open_ep["closed_at"] = now_str
        save_store(settings, store)
        return open_ep

    return {"error_code": "episode_not_found"}


def classify_compliance(ep: dict[str, Any] | None, fill_hour: float, station_id: str) -> str:
    """Slack-Matching (§5.4): followed | partial | ignored | unrelated."""
    if not ep:
        return "unrelated"
    snap = ep.get("last_snapshot")
    if not snap:
        return "unrelated"

    action = snap.get("action")
    snap_station = snap.get("station_id")
    alt_station = snap.get("alt_station_id")
    snap_hour = snap.get("clock_hour", 12.0)

    same_station = station_id == snap_station or station_id == alt_station

    if action == "refuel_now":
        if same_station and abs(fill_hour - snap_hour) <= NOW_GRACE_HOURS:
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


def record_fill(settings, fill_data: dict[str, Any], clock=None) -> dict[str, Any]:
    """Registriert einen Tankbeleg (Wallet-Ledger)."""
    store = load_store(settings)
    now_str = _now_iso(clock)

    fill_id = fill_data.get("id") or _uid("fill")

    # Idempotenz
    for existing in store.get("fills", []):
        if existing.get("id") == fill_id:
            return existing

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
    station_id = fill_data.get("station_id", "")
    station_name = fill_data.get("station_name", "")
    liters = float(fill_data.get("liters", 40.0))
    price_paid = float(fill_data.get("price_paid", 1.70))
    fuel = fill_data.get("fuel", "e10")
    source = fill_data.get("source", "manual")

    compliance = classify_compliance(ep, clock_hour, station_id)

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
        "fuel": fuel,
        "source": source,
        "compliance": compliance,
        "saved_vs_always_now_eur": saved_eur,
    }

    store["fills"].insert(0, fill_event)

    # Episode abschließen
    if ep and ep.get("status") != "expired":
        ep["status"] = "resolved"
        ep["closed_at"] = now_str
        # Letzten Snapshot abrechnen falls noch nicht geschehen
        last_snap = ep.get("last_snapshot")
        if last_snap:
            _settle_one_snapshot(store, ep, last_snap, now_str)

    save_store(settings, store)
    return fill_event


def _settle_one_snapshot(store: dict[str, Any], ep: dict[str, Any], snap: dict[str, Any], now_str: str) -> dict[str, Any]:
    snap_id = snap.get("id")
    for s in store.get("settlements", []):
        if s.get("snapshot_id") == snap_id:
            return s

    p_emit = float(snap.get("price_now") or 1.70)
    p_window = float(snap.get("expected_price") or p_emit)
    action = snap.get("action", "refuel_now")
    liters = float(snap.get("liters_assumed") or 40.0)

    theta = THETA_CT / 100.0  # 0.01 €

    if action == "wait":
        if p_window <= p_emit - theta:
            outcome = "win"
        elif p_window >= p_emit + theta:
            outcome = "loss"
        else:
            outcome = "tie"
    elif action == "refuel_now":
        if p_window >= p_emit - theta:
            outcome = "win"
        else:
            outcome = "loss"
    elif action == "refuel_elsewhere":
        outcome = "win" if p_window <= p_emit - theta else "tie"
    else:
        outcome = "tie"

    best_p = min(p_emit, p_window)
    regret_eur = round(max(0.0, p_emit - best_p) * liters, 2)

    settlement = {
        "snapshot_id": snap_id,
        "episode_id": ep.get("id"),
        "settled_at": now_str,
        "p_emit": round(p_emit, 3),
        "p_window": round(p_window, 3),
        "outcome": outcome,
        "regret_eur": regret_eur,
    }
    store["settlements"].append(settlement)
    return settlement


def settle_snapshots(settings, live_data=None, clock=None) -> dict[str, Any]:
    """Settlement-Job (NAS/Worker, §5.4): rechnet Snapshots nach Fensterende ab."""
    store = load_store(settings)
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

        window_end = last_snap.get("window_end_hour", 20.5)

        # Prüfe, ob Fenster vorüber ist
        # Wir ermitteln aktuelle Berlin-Stunde
        try:
            from zoneinfo import ZoneInfo
            berlin_dt = clock_now.astimezone(ZoneInfo("Europe/Berlin"))
            current_berlin_hour = berlin_dt.hour + berlin_dt.minute / 60.0
        except Exception:
            current_berlin_hour = clock_now.hour + clock_now.minute / 60.0

        # Wenn Intent 'wait' oder 'navigate' gesetzt war und Fenster vorbei ist -> status wird 'due'
        if intent in ("wait", "navigate") and status in ("open", "waiting"):
            if current_berlin_hour >= window_end + WAIT_GRACE_AFTER_HOURS:
                ep["status"] = "due"
                due_count += 1
                if last_snap["id"] not in settled_snap_ids:
                    _settle_one_snapshot(store, ep, last_snap, now_str)
                    settled_snap_ids.add(last_snap["id"])
                    settled_count += 1

        # Generelles Snapshot-Settlement für alle abgelaufenen Fenster
        for snap in ep.get("snapshots", []):
            if snap["id"] not in settled_snap_ids:
                s_end = snap.get("window_end_hour", 20.5)
                if current_berlin_hour >= s_end + 0.5:
                    _settle_one_snapshot(store, ep, snap, now_str)
                    settled_snap_ids.add(snap["id"])
                    settled_count += 1

    save_store(settings, store)
    return {
        "status": "ok",
        "settled_count": settled_count,
        "due_count": due_count,
        "total_settlements": len(store.get("settlements", [])),
    }


def compute_advice_stats(store: dict[str, Any]) -> dict[str, Any]:
    """Berechnet Advice-Ledger-KPIs (Brier, Trefferquoten, Reliability)."""
    settlements = store.get("settlements", [])
    episodes = store.get("episodes", [])
    snapshots_by_id = {s["id"]: s for ep in episodes for s in ep.get("snapshots", [])}

    n = len(settlements)
    wins = sum(1 for s in settlements if s.get("outcome") == "win")
    losses = sum(1 for s in settlements if s.get("outcome") == "loss")
    ties = sum(1 for s in settlements if s.get("outcome") == "tie")

    wait_n, wait_hits = 0, 0
    now_n, now_hits = 0, 0

    # Brier-Score Berechnung: BS = 1/N * sum((p_pred - actual)^2)
    # actual = 1 für win, 0 für loss/tie
    brier_sq_errors = []

    # 10 Bins für Reliability Diagramm (0.0–0.1, 0.1–0.2, ..., 0.9–1.0)
    bins = [{"bin": i, "min_p": i * 0.1, "max_p": (i + 1) * 0.1, "count": 0, "p_sum": 0.0, "hits": 0} for i in range(10)]

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

        # Brier
        p_val = p_correct if (p_correct is not None and math.isfinite(p_correct)) else 0.75
        brier_sq_errors.append((p_val - is_win) ** 2)

        bin_idx = min(9, max(0, int(p_val * 10)))
        bins[bin_idx]["count"] += 1
        bins[bin_idx]["p_sum"] += p_val
        if is_win > 0:
            bins[bin_idx]["hits"] += 1

    brier_30d = round(sum(brier_sq_errors) / n, 4) if n > 0 else None
    hit_rate = round((wins + 0.5 * ties) / n, 3) if n > 0 else None
    hit_wait = round(wait_hits / wait_n, 3) if wait_n > 0 else None
    hit_now = round(now_hits / now_n, 3) if now_n > 0 else None

    reliability = []
    for b in bins:
        count = b["count"]
        mean_p = round(b["p_sum"] / count, 3) if count > 0 else round((b["min_p"] + b["max_p"]) / 2, 3)
        emp_hit = round(b["hits"] / count, 3) if count > 0 else None
        reliability.append({
            "bin": b["bin"],
            "range": f"{int(b['min_p']*100)}–{int(b['max_p']*100)}%",
            "count": count,
            "mean_p": mean_p,
            "empirical_hit_rate": emp_hit,
        })

    # M7 Kalibrierungs-Gate (§0.4, §6): Brier < 0.25 bei n >= 100
    calibrated = (n >= 100) and (brier_30d is not None and brier_30d < 0.25)
    if n < 100:
        gate_status = f"M7-Kalibrierung steht aus (n={n} < 100 Empfehlungen)"
    elif brier_30d is not None and brier_30d >= 0.25:
        gate_status = f"M7-Kalibrierung nicht erreicht (Brier {brier_30d:.2f} ≥ 0,25)"
    else:
        gate_status = f"M7 kalibriert (n={n}, Brier {brier_30d:.2f} < 0,25)"

    return {
        "n": n,
        "wins": wins,
        "losses": losses,
        "ties": ties,
        "hit_rate": hit_rate,
        "hit_wait": hit_wait,
        "hit_now": hit_now,
        "wait_n": wait_n,
        "wait_hits": wait_hits,
        "now_n": now_n,
        "now_hits": now_hits,
        "brier_30d": brier_30d,
        "calibrated": calibrated,
        "gate_status": gate_status,
        "reliability": reliability,
    }


def compute_wallet_stats(store: dict[str, Any]) -> dict[str, Any]:
    """Berechnet Wallet-Ledger-KPIs (Fills, Ersparnis, Compliance, w(h)-Profil)."""
    fills = store.get("fills", [])
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

    if n_fills < 8:
        wh_hours = w0
    else:
        # Empirisches Histogramm
        w_hat = [0.0] * 24
        for f in fills:
            h = int(f.get("clock_hour", 12.0)) % 24
            w_hat[h] += 1.0
        w_hat = [v / n_fills for v in w_hat]
        # Geschrumpft gegen Default (§5.5 Schicht C): w = (n*w_hat + 8*w0) / (n + 8)
        wh_hours = [round((n_fills * w_hat[i] + 8 * w0[i]) / (n_fills + 8), 4) for i in range(24)]

    return {
        "n_fills": n_fills,
        "followed": followed,
        "partial": partial,
        "ignored": ignored,
        "unrelated": unrelated,
        "saved_eur": saved_eur,
        "wh_hours": wh_hours,
        "last_fill": fills[0] if fills else None,
    }
