"""B17: Tages-Cache für den 21-Tage-Backtest je Station.

Warum: Der Backtest ist mit ~86 % der CPU-Zeit der teuerste Teil des
Modell-Laufs — 21 Folds × (1 Fit + 3 Prognosen) je Station. Sein Ergebnis
hängt aber **nicht** vom Zeitpunkt des Laufs ab, sondern nur vom lokalen
Endtag und den Eingabedaten **vor** diesem Endtag: Alle Folds enden an der
letzten lokalen Mitternacht, ihre Trainingsfenster und Wahrheiten liegen
vollständig in der Vergangenheit (`engine/backtest.py::run_backtest`
schneidet die Reihe seit B17 hart am exklusiven Ende ab — vorher wurden die
+3-d/+7-d-Fenster der letzten Folds gegen den *laufenden* Tag bewertet).
Ein zweiter Lauf am selben Tag rechnet also dieselben Zahlen noch einmal.

Schlüssel und Fingerabdruck (P0-Risiko: ein unvollständiger Fingerabdruck
bedeutet falsche publizierte Zahlen — deshalb lieber zu viel als zu wenig):

- Identität der Station (Stadt, UUID, Name, Kraftstoff — alle Felder, die
  im Bericht selbst auftauchen),
- lokaler Endtag (exklusiv) und Anzahl Testtage,
- vollständige Engine-Config (`Config.to_dict()`, also auch Feiertags-
  Subdivs, Entscheidungsstunde, Seed, Bootstrap-Größe …),
- Inhalt der **gesamten** Preisreihe bis zum Endtag — alle Spalten samt
  Index, per `pd.util.hash_pandas_object`. Damit greift jede Änderung in
  der Vergangenheit (Archiv-Nachholung, Lückenfüllung, Hampel-Ergebnis,
  Status-Korrektur), egal ob im Trainings- oder Wahrheitsfenster,
- Schema-Versionen von Engine und Cache sowie die numpy/pandas-Versionen
  (eine Bibliotheksänderung darf keine alten Zahlen wiederverwenden).

Ablage: je Station **eine** Datei unter ``runtime/engine/backtest-cache/``
(atomar geschrieben, reines JSON, inspizierbar). Ein Treffer setzt
Gleichheit des kompletten Fingerabdrucks voraus; alles andere ist ein
Fehltreffer und wird neu gerechnet und überschrieben. Die Größe des
Verzeichnisses ist damit durch die Zahl der Stationen begrenzt.

Ehrlichkeit: Die Publikation trägt ``backtest_cached`` und
``backtest_computed_at`` — das Alter des Berichts wird ausgewiesen, nicht
verschwiegen.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path
from typing import Any

# Bei jeder Änderung an Inhalt oder Form des gecachten Payloads anheben.
CACHE_SCHEMA_VERSION = 1

# Felder aus dem Backtest-Bericht, die der Modell-Lauf je Station braucht
# (siehe app/model_jobs.py::_run und app/refresh.py).
PAYLOAD_KEYS = (
    "metrics",
    "decision_rows",
    "decision_hour",
    "rolling_picp_7d",
    "horizons",
)


def _sha256(*parts: bytes) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part)
        digest.update(b"\x00")
    return digest.hexdigest()


def series_digest(frame) -> str:
    """Inhalts-Hash der Preisreihe (Index + alle Spalten, dtype-sensitiv)."""
    import pandas as pd

    hashed = pd.util.hash_pandas_object(frame, index=True).to_numpy()
    columns = json.dumps(
        [(str(name), str(dtype)) for name, dtype in frame.dtypes.items()]
    )
    return _sha256(
        columns.encode("utf-8"),
        str(len(frame)).encode("ascii"),
        hashed.tobytes(),
    )


def fingerprint(item, cfg, end_local, days: int) -> str:
    """Fingerabdruck aller Eingaben, von denen der Bericht abhängt.

    ``item`` muss bereits auf ``end_local`` zugeschnitten sein
    (`engine.backtest.truncate_series`) — genau die Reihe, die
    ``run_backtest`` liest.
    """
    import numpy as np
    import pandas as pd
    from engine.models import SCHEMA_VERSION

    header = {
        "cache_schema": CACHE_SCHEMA_VERSION,
        "engine_schema": SCHEMA_VERSION,
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "identity": item.identity(),
        "end_local": end_local.isoformat(),
        "days": int(days),
        "config": cfg.to_dict(),
    }
    return _sha256(
        json.dumps(header, sort_keys=True, ensure_ascii=False, default=str).encode(
            "utf-8"
        ),
        series_digest(item.frame).encode("ascii"),
    )


def cache_path(directory: Path, item) -> Path:
    """Eine Datei je (Stadt, Station, Kraftstoff); Name ohne Sonderzeichen."""
    key = _sha256(
        json.dumps(
            [item.city, item.station_id, str(item.fuel).lower()], ensure_ascii=False
        ).encode("utf-8")
    )[:24]
    return Path(directory) / f"{str(item.fuel).lower()}-{key}.json"


def load(directory: Path, item, expected_fingerprint: str) -> dict[str, Any] | None:
    """Gecachter Payload bei exakt gleichem Fingerabdruck, sonst None."""
    path = cache_path(directory, item)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict) or raw.get("fingerprint") != expected_fingerprint:
        return None
    payload = raw.get("payload")
    if not isinstance(payload, dict) or not all(key in payload for key in PAYLOAD_KEYS):
        return None
    return {
        "payload": payload,
        "computed_at": raw.get("computed_at"),
        "end_local": raw.get("end_local"),
    }


def store(
    directory: Path,
    item,
    fingerprint_value: str,
    end_local,
    days: int,
    payload: dict[str, Any],
    computed_at: str | None = None,
) -> str:
    """Schreibt den Payload atomar; gibt ``computed_at`` (ISO, UTC) zurück."""
    from engine.storage import json_safe, write_json

    stamp = computed_at or dt.datetime.now(dt.timezone.utc).isoformat(
        timespec="seconds"
    )
    write_json(
        cache_path(directory, item),
        {
            "cache_schema": CACHE_SCHEMA_VERSION,
            "fingerprint": fingerprint_value,
            "computed_at": stamp,
            "end_local": end_local.isoformat(),
            "days": int(days),
            **item.identity(),
            "payload": json_safe({key: payload.get(key) for key in PAYLOAD_KEYS}),
        },
    )
    return stamp
