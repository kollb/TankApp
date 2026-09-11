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
    # Issue 50: gemeinsames Secret für den Uploader-Webhook (leer = Endpoint aus).
    webhook_token: str = ""
    # Startknopf im GUI (POST /api/v1/jobs/{job}/run). Ohne Passwort, dafür
    # nur bei laufendem Job-Betrieb; wer ihn abschalten will: =0.
    gui_job_start: bool = True
    # M7 (Konzept §13): Schwellen-Nachzug an gemessene Trefferquoten.
    # Default aus: die Tabelle rechnet mit den Startwerten (§4.1/§4.2), der
    # Vorschlag wird in /api/v1/stats/summary nur ausgewiesen.
    m7_auto_apply: bool = False
    # API-Schutz (Konzept §11): anonym 60/min, mit Key 300/min.
    api_keys: tuple[str, ...] = ()
    rate_limit_anon_per_min: int = 60
    rate_limit_key_per_min: int = 300
    rate_limit_anon_per_day: int = 10_000
    rate_limit_key_per_day: int = 50_000
    # Modell-Lauf: 0 = automatisch (CPU-Kerne, maximal 8), 1 = seriell.
    model_workers: int = 0

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
        return cls(
            **fields,
            history_days=days,
            model_fuels=fuels,
            webhook_token=os.environ.get("TANKAPP_WEBHOOK_TOKEN", "").strip(),
            gui_job_start=os.environ.get("TANKAPP_GUI_JOB_START", "1").strip().lower()
            not in {"0", "false", "off", "no"},
            m7_auto_apply=os.environ.get("TANKAPP_M7_AUTO_APPLY", "0").strip()
            in {"1", "true", "on", "yes"},
            api_keys=tuple(
                key.strip()
                for key in os.environ.get("TANKAPP_API_KEYS", "").split(",")
                if key.strip()
            ),
            rate_limit_anon_per_min=_env_int(
                "TANKAPP_RATE_ANON_PER_MIN", 60, low=1, high=100_000
            ),
            rate_limit_key_per_min=_env_int(
                "TANKAPP_RATE_KEY_PER_MIN", 300, low=1, high=100_000
            ),
            rate_limit_anon_per_day=_env_int(
                "TANKAPP_RATE_ANON_PER_DAY", 10_000, low=1, high=10_000_000
            ),
            rate_limit_key_per_day=_env_int(
                "TANKAPP_RATE_KEY_PER_DAY", 50_000, low=1, high=10_000_000
            ),
            model_workers=_env_int("TANKAPP_MODEL_WORKERS", 0, low=0, high=64),
        )


def _env_int(name: str, default: int, low: int, high: int) -> int:
    """Liest eine positive Ganzzahl aus der Umgebung (Default bei Müll)."""
    raw = os.environ.get(name, "")
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    if not low <= value <= high:
        return default
    return value
