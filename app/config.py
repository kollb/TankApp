"""Paths only; credentials stay in the existing private files, never the browser."""

import os
from dataclasses import dataclass, field
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
    # B4: Alarm-Zustellung über ntfy. Leer = aus. Die URL (inklusive Topic) ist
    # der einzige Geheimnisträger; sie wird in Logs/Meldungen bereinigt und
    # niemals im Payload oder im GUI angezeigt.
    notify_url: str = ""
    # Startknopf im GUI (POST /api/v1/jobs/{job}/run). Ohne Passwort, dafür
    # nur bei laufendem Job-Betrieb; wer ihn abschalten will: =0.
    gui_job_start: bool = True
    # M7 (Konzept §13): Schwellen-Nachzug an gemessene Trefferquoten.
    # Default aus: die Tabelle rechnet mit den Startwerten (§4.1/§4.2), der
    # Vorschlag wird in /api/v1/stats/summary nur ausgewiesen.
    m7_auto_apply: bool = False
    # Hinweis: Ein API-Rate-Limit (früher 60/min anonym, TANKAPP_API_KEYS /
    # TANKAPP_RATE_*) ist seit 0.12.0 entfernt — die App läuft ausschließlich
    # im eigenen LAN, und das Limit traf den Normalbetrieb (mehrere Geräte).
    # Schicht-A-Anker (Konzept §5.5): Tagesstunde des hypothetischen
    # Backtest-Entscheids. Default 12: Nach der 12-Uhr-Regel (Anhebungen nur
    # mittags) weiß man um 12 Uhr, ob es heute teurer wurde — morgens fehlt
    # dem hypothetischen Entscheid genau diese Information.
    decision_hour: int = 12
    # Modell-Lauf: 0 = automatisch (CPU-Kerne, maximal 8), 1 = seriell.
    model_workers: int = 0
    # Gepoolter Feiertags-Dummy je Bundesland (Konzept §3.2):
    # TANKAPP_CITY_SUBDIVS="Frankfurt:HE;Gütersloh:NW". Ohne Angabe bleibt
    # der Dummy beitragslos null (keine erfundenen Feiertagseffekte).
    city_subdivs: dict[str, str] = field(default_factory=dict)

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
            notify_url=os.environ.get("TANKAPP_NTFY_URL", "").strip(),
            gui_job_start=os.environ.get("TANKAPP_GUI_JOB_START", "1").strip().lower()
            not in {"0", "false", "off", "no"},
            m7_auto_apply=os.environ.get("TANKAPP_M7_AUTO_APPLY", "0").strip()
            in {"1", "true", "on", "yes"},
            model_workers=_env_int("TANKAPP_MODEL_WORKERS", 0, low=0, high=64),
            decision_hour=_env_int("TANKAPP_DECISION_HOUR", 12, low=0, high=23),
            city_subdivs=_city_subdivs_from_env(),
        )


def _city_subdivs_from_env() -> dict[str, str]:
    """TANKAPP_CITY_SUBDIVS="Frankfurt:HE;Gütersloh:NW" -> {Stadt: Subdiv}.

    Gleiche Schreibweise wie ``--subdiv`` der Selektion. Ungültige Einträge
    werden verworfen (nicht stillschweigend halbgültig interpretiert); der
    Fit läuft dann ohne Feiertags-Beitrag für die betroffene Stadt weiter.
    """
    raw = os.environ.get("TANKAPP_CITY_SUBDIVS", "")
    out: dict[str, str] = {}
    for part in raw.split(";"):
        if not part.strip():
            continue
        if ":" not in part:
            continue
        name, sub = part.split(":", 1)
        sub = sub.strip().upper().removeprefix("DE-")
        if len(sub) == 2 and name.strip():
            out[name.strip()] = sub
    return out


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
