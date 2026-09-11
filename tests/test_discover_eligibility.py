import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent / "data-tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from discover_stations import history_eligible  # noqa: E402


def hist(days, fuels):
    return {"days": days, "fuels": fuels}


def test_days_alone_are_not_eligibility():
    # 367 Tage, aber nur Diesel: für ein E10-Set ungeeignet.
    assert not history_eligible(hist(367, ["diesel"]), 28, "e10")
    assert history_eligible(hist(367, ["diesel"]), 28, "diesel")
    assert history_eligible(hist(367, ["diesel"]), 28, "any")


def test_fuel_and_day_threshold():
    assert history_eligible(hist(28, ["e10", "e5"]), 28, "e10")
    assert not history_eligible(hist(27, ["e10"]), 28, "e10")
    assert not history_eligible(hist(28, []), 28, "e10")


def test_without_history_scan_everything_stays_eligible():
    assert not history_eligible(None, 28, "e10")
    assert not history_eligible({"days": 0, "fuels": []}, 28, "any")
