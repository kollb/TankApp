"""Regime-Hinweis der Entscheidung: Preisniveau-Termine im Sichtfeld der Prognose.

Die Engine rechnet nicht mit dem angekündigten Betrag (nur Marker). Damit die
GUI „günstiger als jetzt“ über einen Steuerschritt hinweg nicht als
Modellurteil ausgibt, meldet ``decide`` den nächsten Termin als
``regime_notice`` — ohne Gate, Kohorte oder Sperrgrund anzufassen.
"""

from __future__ import annotations

import datetime as dt

from app.gate_context import regime_notice_for, statistical_gate_context
from app.regimes import DEFAULT_REGIMES

UTC = dt.timezone.utc


def at(text: str) -> dt.datetime:
    return dt.datetime.fromisoformat(text).replace(tzinfo=UTC)


def test_tankrabatt_am_vortag_ist_bevorstehend():
    # 30.09. 12:00 Berlin = 10:00 UTC; Kante 01.10. 00:00 Berlin = 30.09. 22:00 UTC.
    notice = regime_notice_for("e10", at("2026-09-30T10:00:00"), DEFAULT_REGIMES)
    assert notice is not None
    assert notice["phase"] == "upcoming"
    assert notice["announced_ct"] == -17.0
    assert notice["announced_local"] == "2026-10-01T00:00"
    assert notice["status"] == "announced"
    assert notice["at"] == "2026-09-30T22:00:00+00:00"
    assert notice["days"] == 0


def test_nach_der_kante_bleibt_der_hinweis_als_recent():
    notice = regime_notice_for("e10", at("2026-10-05T10:00:00"), DEFAULT_REGIMES)
    assert notice is not None
    assert notice["phase"] == "recent"
    assert notice["days"] == 4


def test_ausserhalb_des_sichtfelds_kein_hinweis():
    # 7 Tage + 1 Stunde vor der Kante, und 15 Tage danach.
    assert regime_notice_for("e10", at("2026-09-23T20:00:00"), DEFAULT_REGIMES) is None
    assert regime_notice_for("e10", at("2026-10-16T10:00:00"), DEFAULT_REGIMES) is None


def test_bevorstehender_termin_schlaegt_zurueckliegenden():
    regimes = (
        {
            "announced_local": "2026-10-01T00:00",
            "fuel": None,
            "announced_value": -17.0,
            "status": "in_force",
        },
        {
            "announced_local": "2026-10-04T00:00",
            "fuel": None,
            "announced_value": 5.0,
            "status": "announced",
        },
    )
    notice = regime_notice_for("e10", at("2026-10-02T10:00:00"), regimes)
    assert notice["announced_local"] == "2026-10-04T00:00"
    assert notice["phase"] == "upcoming"


def test_sorte_und_unbrauchbare_eintraege_werden_uebergangen():
    regimes = (
        "kein-dict",
        {
            "announced_local": "2026-10-01T00:00",
            "fuel": "diesel",
            "announced_value": -17.0,
            "status": "announced",
        },
        {
            "announced_local": "2026-10-01T00:00",
            "fuel": None,
            "announced_value": None,
            "status": "announced",
        },
        {
            "announced_local": "2026-10-01T00:00",
            "fuel": None,
            "announced_value": 0,
            "status": "announced",
        },
        {
            "announced_local": "kaputt",
            "fuel": None,
            "announced_value": -17.0,
            "status": "announced",
        },
        {
            "announced_local": "2026-10-01T00:00",
            "fuel": None,
            "announced_value": -17.0,
            "status": "cancelled",
        },
    )
    assert regime_notice_for("e10", at("2026-09-30T10:00:00"), regimes) is None
    assert regime_notice_for("e10", at("2026-09-30T10:00:00"), ()) is None
    assert regime_notice_for("e10", at("2026-09-30T10:00:00"), None) is None
    only_diesel = regime_notice_for("diesel", at("2026-09-30T10:00:00"), regimes)
    assert only_diesel is not None and only_diesel["announced_ct"] == -17.0


def test_hinweis_aendert_weder_kohorte_noch_szenario_flag():
    now = at("2026-09-30T10:00:00")
    before = statistical_gate_context(None, "e10", now, DEFAULT_REGIMES)
    regime_notice_for("e10", now, DEFAULT_REGIMES)
    after = statistical_gate_context(None, "e10", now, DEFAULT_REGIMES)
    assert before == after
    assert before["regime_ref"] is not None or before["_scenario_pending"]
