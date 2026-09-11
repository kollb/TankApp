"""Collector: Preis-Keys und Kadenz ohne Extra-Sleep."""

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
OK = "6a7fe9a1-e30d-422e-a6a9-00bea6621c6f"
V1 = "51d4b557-a095-1aa0-e100-80009459e03a"
GLOBUS = "eed1f8be-6ec6-7eb6-1cf7-688b969574e1"


@pytest.fixture
def collector():
    tools = str(ROOT / "data-tools")
    if tools not in sys.path:
        sys.path.insert(0, tools)
    path = ROOT / "data-tools/collect_prices.py"
    spec = importlib.util.spec_from_file_location("test_collect_prices", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_known_frankfurt_ids_are_sent(collector):
    assert collector.tankerkoenig_id(OK)
    assert collector.tankerkoenig_id(V1)
    assert collector.tankerkoenig_id(GLOBUS)
    usable, skipped = collector.request_ids([OK, GLOBUS, V1, "nope"])
    assert usable == [OK, GLOBUS, V1]
    assert skipped == ["nope"]


def test_normalize_matches_api_keys_case_insensitively(collector):
    raw = {OK.upper(): {"status": "open", "e10": 1.799}}
    out = collector.normalize(raw, [OK, GLOBUS])
    assert out[OK]["e10"] == 1.799
    assert out[GLOBUS]["status"] == "no prices"
