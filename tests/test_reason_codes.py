"""P4: gemeinsame Begründungs-Codes (Web + Push) und Brückentag-Hinweise."""

import pandas as pd

from app.notify import build_window_payload
from app.reason_codes import (
    CLOSING_SOON_FILTERED,
    EVENING_DROP_EXPECTED,
    LOW_TANK_RESERVE,
    REASON_CODE_TEXT,
    UPWARD_MARKET_DRIFT,
    push_summary,
    reason_entry,
    reason_text,
)
from engine.holidays import calendar_hints


def test_every_code_has_one_german_sentence_without_numbers():
    for code, text in REASON_CODE_TEXT.items():
        assert text.endswith(".")
        assert not any(ch.isdigit() for ch in text), code
        assert reason_text(code) == text


def test_structured_entry_carries_code_text_and_value():
    entry = reason_entry(UPWARD_MARKET_DRIFT, value=0.0123456)
    assert entry == {
        "code": UPWARD_MARKET_DRIFT,
        "text": REASON_CODE_TEXT[UPWARD_MARKET_DRIFT],
        "value": 0.0123,
    }
    assert "value" not in reason_entry(EVENING_DROP_EXPECTED)


def test_push_uses_the_same_sentence_as_web_in_both_modes():
    snapshot = {
        "action": "wait",
        "station_name": "Tankstelle Nord",
        "window_start": "2026-11-28T18:00:00+01:00",
        "window_end": "2026-11-28T19:00:00+01:00",
        "expected_price": 1.699,
        "reason_codes": [
            reason_entry(EVENING_DROP_EXPECTED),
            reason_entry(LOW_TANK_RESERVE),
        ],
    }
    expected = REASON_CODE_TEXT[EVENING_DROP_EXPECTED]
    for mode in ("public", "lan"):
        payload = build_window_payload("open", snapshot, mode=mode)
        assert expected in payload["message"]
    # Öffentlicher Modus: keine Station, kein Preis — nur die neutrale Begründung.
    public = build_window_payload("open", snapshot, mode="public")["message"]
    assert "Tankstelle Nord" not in public and "1,70" not in public


def test_push_summary_is_deduplicated_and_limited():
    codes = [
        {"code": CLOSING_SOON_FILTERED},
        {"code": CLOSING_SOON_FILTERED},
        {"code": LOW_TANK_RESERVE},
    ]
    assert push_summary(codes, limit=1) == REASON_CODE_TEXT[CLOSING_SOON_FILTERED]
    assert push_summary(codes, limit=2) == (
        REASON_CODE_TEXT[CLOSING_SOON_FILTERED]
        + " "
        + REASON_CODE_TEXT[LOW_TANK_RESERVE]
    )
    assert push_summary(None) is None


def test_bridge_day_after_thursday_holiday_is_hinted():
    # Fronleichnam 2026: Donnerstag 04.06. → Freitag 05.06. ist Brückentag.
    hints = calendar_hints(pd.Timestamp("2026-06-01"), "HE")
    kinds = {(item["date"], item["kind"]) for item in hints["items"]}
    assert ("2026-06-04", "holiday") in kinds
    assert ("2026-06-05", "bridge") in kinds
    assert hints["source"] == "holidays:HE"


def test_quiet_week_has_no_hints_and_holiday_in_window_is_listed():
    quiet = calendar_hints(pd.Timestamp("2026-11-28"), "HE")
    assert quiet["items"] == []
    # Heiligabend-nahe Woche: Weihnachten (Freitag) liegt in den nächsten 7 Tagen.
    christmas = calendar_hints(pd.Timestamp("2026-12-20"), "HE")
    assert any(
        item["date"] == "2026-12-25" and item["kind"] == "holiday"
        for item in christmas["items"]
    )


def test_unknown_subdivision_is_honest_and_empty():
    hints = calendar_hints(pd.Timestamp("2026-06-01"), None)
    assert hints == {"source": "none", "subdiv": None, "items": []}
