"""O38 — Verstrichene Fenster sind sichtbar (Fensterbilanz, 0.45.0).

Vor 0.45.0 wurde ``episode.status = \"expired\"`` zwar gesetzt, aber nie
gezählt und nie angezeigt: Sichtbar waren nur abgerechnete Fälle, die
verstrichenen Empfehlungen verschwanden — keine Gegenprobe zur
Trefferquote (docs/OPTIMIERUNGS-BEFUND.md O38).

Seit O38 zählt ``compute_advice_stats`` genutzte (resolved) gegen
verstrichene (expired) Fenster je Woche/Monat — nur Folgen mit echter
Empfehlung, datiert nach ``closed_at``.
"""

import datetime as dt

from app.feedback import compute_advice_stats

NOW = dt.datetime(2026, 9, 10, 14, 0, tzinfo=dt.timezone.utc)


def _ep(ep_id, status, action, closed_days_ago=None, opened_days_ago=0):
    ep = {
        "id": ep_id,
        "status": status,
        "opened_at": (NOW - dt.timedelta(days=opened_days_ago)).isoformat(),
        "closed_at": (
            (NOW - dt.timedelta(days=closed_days_ago)).isoformat()
            if closed_days_ago is not None
            else None
        ),
        "snapshots": [{"id": f"s-{ep_id}", "action": action}],
    }
    return ep


def _stats(episodes):
    return compute_advice_stats(
        {"episodes": episodes, "settlements": []}, now=NOW, window_days=30
    )


def test_expired_episode_counts_in_week_and_month():
    """Der Batch-Check: Eine expired-Folge erscheint in beiden Zählern."""
    stats = _stats([_ep("ep1", "expired", "wait", closed_days_ago=2)])
    assert stats["episodes_expired_7d"] == 1
    assert stats["episodes_expired_30d"] == 1
    assert stats["episodes_used_7d"] == 0
    assert stats["episodes_used_30d"] == 0


def test_month_only_for_older_closures():
    stats = _stats(
        [
            _ep("ep1", "resolved", "wait", closed_days_ago=10),
            _ep("ep2", "expired", "refuel_now", closed_days_ago=20),
            _ep("ep3", "expired", "wait", closed_days_ago=40),
        ]
    )
    assert (stats["episodes_used_7d"], stats["episodes_expired_7d"]) == (0, 0)
    assert (stats["episodes_used_30d"], stats["episodes_expired_30d"]) == (1, 1)


def test_no_advice_only_episodes_are_no_windows():
    """Reine no_advice-Folgen hatten kein Fenster — sie zählen nirgends."""
    stats = _stats([_ep("ep1", "expired", "no_advice", closed_days_ago=1)])
    assert (stats["episodes_used_30d"], stats["episodes_expired_30d"]) == (0, 0)
    assert stats["episodes_open"] == 0


def test_open_episodes_run_outside_both_sides():
    stats = _stats(
        [
            _ep("ep1", "open", "wait"),
            _ep("ep2", "due", "refuel_elsewhere"),
            _ep("ep3", "waiting", "no_advice"),
        ]
    )
    assert stats["episodes_open"] == 2
    assert (stats["episodes_used_30d"], stats["episodes_expired_30d"]) == (0, 0)


def test_closed_at_fallback_is_opened_at():
    """Ohne closed_at datiert opened_at — kein stilles Fallenlassen."""
    stats = _stats([_ep("ep1", "resolved", "wait", opened_days_ago=3)])
    assert (stats["episodes_used_7d"], stats["episodes_used_30d"]) == (1, 1)


def test_mixed_actions_in_one_episode_count_once():
    """Eine Folge mit mehreren Snapshots ist ein Fenster, nicht viele."""
    ep = _ep("ep1", "expired", "wait", closed_days_ago=1)
    ep["snapshots"].append({"id": "s-ep1b", "action": "refuel_now"})
    assert _stats([ep])["episodes_expired_30d"] == 1
