"""Tiny deterministic fixtures; never exported into the live collector/bucket."""

import importlib.util
import os
import sys
from pathlib import Path

# Tests never wait on the public OSRM demo server.
os.environ.setdefault("TANKAPP_OSRM", "0")
# Modell-Läufe in Tests seriell (deterministisch, kein Prozess-Pool);
# die parallele Variante prüft tests/test_model_jobs.py explizit.
os.environ.setdefault("TANKAPP_MODEL_WORKERS", "1")

import numpy as np
import pandas as pd
import pytest

from engine.config import Config
from engine.data import normalize_observations, prepare_series


@pytest.fixture(autouse=True)
def _fresh_write_budget():
    """B5: Schreib-Budget je Test zurücksetzen — Tests laufen aus einer IP.

    Ohne Reset würde das 20-Schreibungen-Minuten-Budget aus ``app.server``
    beim ersten POST/DELETE-Lasttest der Suite die nachfolgenden Tests mit
    429 anstecken; produktiv gilt das Budget bewusst pro Client weiter.
    """
    import app.server as server_module

    server_module._WRITE_HITS.clear()
    yield
    server_module._WRITE_HITS.clear()


@pytest.fixture(autouse=True)
def _fresh_metadata_memo():
    """Prozess-globale Memo-/Refresh-Zustände von app.data je Test leeren.

    Das Metadata-Memo ist auf Datei-Stats geschlüsselt (mtime mit
    1-s-Granularität): Zwei Tests in derselben Sekunde mit identischen
    Test-Dateien würden sonst denselben Memo-Eintrag teilen.
    """
    import app.data as data_module

    data_module._META_MEMO.update({"key": None, "value": None, "at": 0.0})
    data_module._ROUTE_REFRESH.clear()
    # O22/O23: Veröffentlichung und Selektion liegen als geparstes Memo im
    # Prozess, geschlüsselt auf (Pfad, mtime_ns, Größe) — zwei Tests in
    # derselben Sekunde mit gleich großen Artefakten würden sich sonst den
    # Eintrag teilen. ``clear_publication_cache`` ist dieselbe Funktion, die
    # auch Werkzeuge nach einem eigenen Schreibvorgang aufrufen.
    data_module.clear_publication_cache()
    # A21-B2.2: Der gemeinsame Lesezustand (Ledger + Statistik je Revision)
    # ist prozess-global. Ohne Reset könnte ein Test die Statistik eines
    # früheren Tests mit anderem Store erben — die Revisionsschlüssel sind
    # Pfad-/Zeitstempel, zwei Tests könnten also denselben Schlüssel treffen.
    import app.read_state as read_state_module

    read_state_module.clear_cache()
    yield
    data_module._META_MEMO.update({"key": None, "value": None, "at": 0.0})
    data_module._ROUTE_REFRESH.clear()
    data_module.clear_publication_cache()
    read_state_module.clear_cache()


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
