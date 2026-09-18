"""Atomic, inspectable JSON; no pickle/joblib execution on the Pi.

Zwei Schreib-Varianten, eine Funktion (O22):

* ``indent=2`` (Default) für kleine, menschenlesbare Artefakte — Job-Stände,
  ``last-attempt.json``, Diagnose-Bündel.
* ``indent=None`` für große Maschinen-Artefakte — die Veröffentlichung der
  Prognosen. ``indent=2`` bläht sie gemessen um rund 50 % auf (eine Zeile je
  Wert plus Einrückung bei zehntausenden Werten); elf Stationen lagen damit
  bei 22,4 MB und somit jenseits des Leselimits von ``app.data.read_json``
  (docs/archiv/OPTIMIERUNGS-BEFUND-2026-09-18.md O22).

``write_json`` gibt die geschriebene **Byte-Größe** zurück, weil der Schreiber
sie kennen muss: Eine Veröffentlichung über dem Leselimit fällt beim Lesen
sonst still als „keine Daten“ aus, während der Job Erfolg meldet.
"""

import json
import math
import os
import tempfile
from pathlib import Path

import numpy as np


def json_safe(value):
    if isinstance(value, np.ndarray):
        return json_safe(value.tolist())
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return float(value) if math.isfinite(value) else None
    return value


def write_json(path: Path, value, *, indent: int | None = 2) -> int:
    """Schreibt ``value`` atomar als JSON; Rückgabe ist die Dateigröße in Byte.

    Kompakt (``indent=None``) heißt wirklich kompakt: ohne ``separators``
    schreibt ``json`` auch einzeilig ``", "`` und ``": "`` — bei den
    Zehntausenden Werten einer Veröffentlichung sind das Megabytes.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            name = handle.name
            json.dump(
                json_safe(value),
                handle,
                ensure_ascii=False,
                allow_nan=False,
                indent=indent,
                separators=None if indent else (",", ":"),
            )
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
        name = None
        # Byte-Größe des Artefakts. ``tell()`` auf einem Text-Handle ist ein
        # positions-Cookie, keine Bytezahl — Umlaute in Stationsnamen sind
        # Mehrbytezeichen.
        return path.stat().st_size
    finally:
        if name and os.path.exists(name):
            os.unlink(name)
