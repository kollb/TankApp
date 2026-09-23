"""Hilfs-Lader für data-tools-Skripte mit Bindestrich-Pfad (kein Paket)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_ops_acceptance():
    spec = importlib.util.spec_from_file_location(
        "tankapp_ops_acceptance", ROOT / "data-tools/ops_acceptance.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
