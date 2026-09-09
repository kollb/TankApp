"""Tiny deterministic fixtures; never exported into the live collector/bucket."""

import importlib.util
import os
import sys
from pathlib import Path

# Tests never wait on the public OSRM demo server.
os.environ.setdefault("TANKAPP_OSRM", "0")

import numpy as np
import pandas as pd
import pytest

from engine.config import Config
from engine.data import normalize_observations, prepare_series


@pytest.fixture
def cfg():
    return Config(
        train_days=14, min_train_days=7, min_slot_days=2, bootstrap_samples=100
    )


@pytest.fixture
def observations():
    def make(days=35, start="2026-07-01", constant=False):
        index = pd.date_range(
            start, periods=days * 288, freq="5min", tz="Europe/Berlin"
        )
        hour = np.asarray(index.hour + index.minute / 60)
        time = np.arange(len(index)) / 288
        rng = np.random.default_rng(123)
        price = (
            1.70
            + 0.04 * np.cos(hour * 2 * np.pi / 24)
            + 0.005 * np.sin(time)
            + rng.normal(0, 0.001, len(index))
        )
        if constant:
            price[:] = 1.7
        return pd.DataFrame(
            {
                "timestamp": index.astype(str),
                "city": "Testmarkt",
                "station_id": "station-1",
                "station_name": "Teststation",
                "fuel": "E10",
                "price": price,
                "status": np.where(hour >= 6, "open", "closed"),
                "source": "influxdb",
            }
        )

    return make


@pytest.fixture
def series(observations, cfg):
    normalized, _ = normalize_observations(observations(), cfg)
    return prepare_series(normalized, cfg)[0]


@pytest.fixture(scope="session")
def exporter():
    path = Path(__file__).resolve().parents[1] / "data-tools/export_influx.py"
    spec = importlib.util.spec_from_file_location("tankapp_export_influx", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
