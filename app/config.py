"""Paths only; credentials stay in the existing private files, never the browser."""

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    data: Path = ROOT / "data"
    archive: Path = ROOT / "data/raw"
    polling: Path = ROOT / "docs/analysis/stations/polling.json"
    influx_env: Path = ROOT / "data/influx.env"
    netrc: Path = ROOT / "data/_netrc"
    static: Path = ROOT / "web/dist"
    history_days: int = 365
    model_days: int = 120
    model_fuels: tuple[str, ...] = ("e10",)

    @property
    def runtime(self):
        return self.data / "runtime"

    @classmethod
    def from_env(cls):
        defaults = cls()
        fields = {
            name: Path(os.environ.get(env, str(getattr(defaults, name))))
            for name, env in {
                "data": "TANKAPP_DATA_DIR",
                "archive": "TANKAPP_ARCHIVE_DIR",
                "polling": "TANKAPP_POLLING_FILE",
                "influx_env": "TANKAPP_INFLUX_ENV",
                "netrc": "TANKAPP_NETRC",
                "static": "TANKAPP_STATIC_DIR",
            }.items()
        }
        days = int(os.environ.get("TANKAPP_HISTORY_DAYS", "365"))
        fuels = tuple(
            dict.fromkeys(os.environ.get("TANKAPP_MODEL_FUELS", "e10").split(","))
        )
        if (
            not 1 <= days <= 7300
            or not fuels
            or not set(fuels) <= {"e5", "e10", "diesel"}
        ):
            raise ValueError(
                "Ungültiger Archivzeitraum oder Kraftstoff in der NAS-Konfiguration."
            )
        return cls(**fields, history_days=days, model_fuels=fuels)
