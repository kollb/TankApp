"""Paths only; credentials stay in the existing private files, never the browser."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from polling_plan import active_polling

from .law import DEFAULT_PRICE_LAW_LOCAL
from .regimes import DEFAULT_REGIMES, regimes_from_env

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    data: Path = ROOT / "data"
    archive: Path = ROOT / "data/raw"
    # B14: Ausgabeverzeichnis der Selektion (privat, gitignored) ist
    # ``data/analysis/``. Der alte Ort ``docs/analysis/`` — ein
    # Datenverzeichnis mitten in der Doku — wird weiter benutzt, solange er
    # existiert und der neue fehlt; ``active_polling`` schreibt dann einen
    # Hinweis auf stderr. Kein stiller Umzug privater Daten.
    polling: Path = active_polling(ROOT)
    influx_env: Path = ROOT / "data/influx.env"
    netrc: Path = ROOT / "data/_netrc"
    static: Path = ROOT / "web/dist"
    history_days: int = 365
    model_days: int = 120
    model_fuels: tuple[str, ...] = ("e10",)
    # Issue 50: gemeinsames Secret für den Uploader-Webhook (leer = Endpoint aus).
    webhook_token: str = ""
    # O39: optionales Shared Secret für die **Lese**-Endpunkte des persönlichen
    # Datenbestands (Belege, Bilanz, Tagebuch, Profile, Episoden, Alltags-
    # Aggregat). Leer (Default) = offen, wie bisher: Die App läuft im eigenen
    # LAN ohne Login, und das ist eine dokumentierte Entscheidung
    # (docs/betrieb/BETRIEB.md), keine Nebenwirkung mehr. Derselbe Mechanismus wie
    # beim Webhook (``Authorization: Bearer <Secret>``), kein Login, keine
    # Sitzung, keine Nutzer:innen. Schreib-Endpunkte bleiben bewusst offen —
    # sie haben ihr eigenes Budget (429), und ein zweites Secret würde gegen
    # die benannte Gefahr (Mitlesen im LAN) nichts ändern.
    read_token: str = ""
    # B4: Alarm-Zustellung über ntfy. Leer = aus. Die URL (inklusive Topic) ist
    # der einzige Geheimnisträger; sie wird in Logs/Meldungen bereinigt und
    # niemals im Payload oder im GUI angezeigt.
    notify_url: str = ""
    # O42: Push-Modus — die dokumentierte Entscheidung, was der Push darf.
    # „public“ (Default): Der Endpunkt gilt als fremder/öffentlicher Dienst
    #   (z. B. ntfy.sh) → Meldungen bleiben bei Codes bzw. neutralen Sätzen;
    #   keine Preise, keine Stationen, keine Koordinaten im Text.
    # „lan“: selbst gehostetes ntfy im eigenen Netz → Fenster-Meldungen dürfen
    #   Station, Fensterzeit und erwarteten Preis nennen; weiterhin verboten
    #   bleiben Koordinaten, Pfade und Zugangsdaten.
    notify_mode: str = "public"
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
    # B30: Bodenkante der 12-Uhr-Regel. Beobachtungen **vor** diesem lokalen
    # Zeitpunkt beschreiben eine andere Rechtslage (Tief am Abend statt im
    # Vormittag) und fallen deshalb aus den Beobachtungs-Panels und aus dem
    # Training — gezählt, nicht still verworfen (``points_before_law``).
    # TANKAPP_PRICE_LAW_LOCAL; der Wert wird über engine_config() in
    # engine/config.py: price_law_local durchgereicht (eine Quelle, O36).
    price_law_local: str = DEFAULT_PRICE_LAW_LOCAL
    # TANKAPP_LAW_FLOOR=0 schaltet die Kante ab und stellt den Mischbestand
    # wieder her — nur als Gegenmessung, nicht als Dauerzustand.
    law_floor: bool = True
    # B0: Regime-Kalender (deklarierte Preisniveau-Kanten, app/regimes.py).
    # TANKAPP_REGIMES: leer = bekannte Termine, 0/off = keiner, JSON-Liste
    # oder Pfad einer .json-Datei. Wird über engine_config() zu
    # engine/config.py: regimes — dort nur Marker/Zähler, kein Rechenwerk.
    regimes: tuple[dict, ...] = DEFAULT_REGIMES
    # Modell-Lauf: 0 = automatisch (CPU-Kerne, maximal 8), 1 = seriell.
    model_workers: int = 0
    # B17: 21-Tage-Backtest je lokalem Endtag cachen (runtime/engine/
    # backtest-cache/). TANKAPP_BACKTEST_CACHE=0 rechnet jeden Lauf neu.
    backtest_cache: bool = True
    # A11: Gemeinsame Bootstrap-Ziehung über alle Stationen eines Laufs
    # (Konzept §4.2 — der Marktgleichlauf darf für P_lohnt nicht
    # wegkorreliert werden). TANKAPP_SHARED_DRAWS=0 stellt die unabhängige
    # Ziehung wieder her (Gegenprobe, Stand vor 0.31.0).
    shared_draws: bool = True
    # B2: PIT-Rekalibrierung der Bootstrap-Pfade. Der Schalter ist für die
    # Gegenmessung; ohne zeitlich getrennt abgenommene Kurve bleibt das Modell
    # trotz aktivem Schalter sichtbar unkalibriert.
    calibration: bool = True
    # A10/B3/A70: Punktmodell der Prognose — „profile_ar2“ (Default seit
    # 0.58.0, einziger produktiver Vertrag), „harmonic_ar2“ (experimentell,
    # Offline-/Laborvergleiche) oder „ensemble“ (deaktiviert, M1: keine
    # belegte End-to-end-Parität — die Freigabekette sperrt mit
    # ``model_not_released``; Offline-Forschung bleibt möglich, trägt aber
    # keine Empfehlung). Normativ: ``app/model_contracts.py``.
    model_kind: str = "profile_ar2"
    # B3: aufeinanderfolgende Prognose-Kalendertage als Paar ziehen
    # (TANKAPP_DAYPAIR=0 = unabhängig, Stand vor 0.58.0).
    day_pair: bool = True
    # Gepoolter Feiertags-Dummy je Bundesland (Konzept §3.2):
    # TANKAPP_CITY_SUBDIVS="Frankfurt:HE;Gütersloh:NW". Ohne Angabe bleibt
    # der Dummy beitragslos null (keine erfundenen Feiertagseffekte).
    city_subdivs: dict[str, str] = field(default_factory=dict)
    # A12: Tote Stationen nach N Kalendertagen ohne Preis aus dem Ranking
    # (konfigurierbar, Default 7; 0 = nie tot). Das Polling-Set bleibt stabil.
    dead_after_days: int = 7
    # O33: Ziel der Laufzeit-Backups (``ops/nas/backup.sh`` schreibt dorthin
    # ``tankapp-runtime-<datum>.tar.gz``). Die App liest es **nur** per stat,
    # um die Backup-Alterung zu melden (Alarm ``backup_stale``). None = keine
    # Überwachung eingerichtet; das steht dann sichtbar in
    # ``/api/v1/health`` → ``backup.configured``, statt still wegzufallen.
    # Im Container muss das Ziel gemountet sein (ops/nas/app/compose.yml).
    backup_dir: Path | None = None

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
            read_token=os.environ.get("TANKAPP_READ_TOKEN", "").strip(),
            notify_url=os.environ.get("TANKAPP_NTFY_URL", "").strip(),
            notify_mode=_env_choice("TANKAPP_NTFY_MODE", "public", {"public", "lan"}),
            gui_job_start=os.environ.get("TANKAPP_GUI_JOB_START", "1").strip().lower()
            not in {"0", "false", "off", "no"},
            m7_auto_apply=os.environ.get("TANKAPP_M7_AUTO_APPLY", "0").strip()
            in {"1", "true", "on", "yes"},
            model_workers=_env_int("TANKAPP_MODEL_WORKERS", 0, low=0, high=64),
            backtest_cache=os.environ.get("TANKAPP_BACKTEST_CACHE", "1").strip().lower()
            not in {"0", "false", "off", "no"},
            shared_draws=os.environ.get("TANKAPP_SHARED_DRAWS", "1").strip().lower()
            not in {"0", "false", "off", "no"},
            calibration=os.environ.get("TANKAPP_CALIBRATION", "1").strip().lower()
            not in {"0", "false", "off", "no"},
            model_kind=_env_choice(
                "TANKAPP_MODEL_KIND",
                "profile_ar2",
                {"harmonic_ar2", "profile_ar2", "ensemble"},
            ),
            day_pair=os.environ.get("TANKAPP_DAYPAIR", "1").strip().lower()
            not in {"0", "false", "off", "no"},
            decision_hour=_env_int("TANKAPP_DECISION_HOUR", 12, low=0, high=23),
            # B30: Bodenkante der 12-Uhr-Regel (eine Quelle: dieser Wert wird
            # über engine_config() zur Engine-Konfiguration).
            price_law_local=os.environ.get(
                "TANKAPP_PRICE_LAW_LOCAL", DEFAULT_PRICE_LAW_LOCAL
            ).strip(),
            law_floor=os.environ.get("TANKAPP_LAW_FLOOR", "1").strip().lower()
            not in {"0", "false", "off", "no"},
            # B0: Regime-Kalender; ein kaputter Wert bricht hier mit Grund ab.
            regimes=regimes_from_env(),
            backup_dir=_env_path("TANKAPP_BACKUP_DIR"),
            city_subdivs=_city_subdivs_from_env(),
            dead_after_days=_env_int("TANKAPP_DEAD_AFTER_DAYS", 7, low=0, high=365),
        )


def engine_config(settings):
    """Die Engine-Konfiguration zu diesen Settings — **eine** Quelle (O36).

    Vorher baute jeder Job seine eigene: ``app/refresh.py`` nahm
    ``city_subdivs`` und ``decision_hour`` aus den Settings, der standalone
    Selektions-Job (``app/selection.py``) rief ``Config()`` ohne beide — zwei
    Wahrheiten für dieselbe Engine. Jetzt kommt die Konfiguration hier her,
    und die Selektion leitet ihre Werte über
    ``SelectionConfig.from_engine_config`` daraus ab.

    Der Import bleibt in der Funktion: ``engine.config`` zieht pandas, und
    ``app/config.py`` wird von jedem CLI- und API-Pfad geladen.
    """
    from engine.config import Config

    from .law import price_law_local

    return Config(
        # Konzept §3.2: gepoolter Feiertags-Dummy je Bundesland; ohne
        # TANKAPP_CITY_SUBDIVS trägt er null (keine erfundenen Effekte).
        city_subdivs=dict(getattr(settings, "city_subdivs", {})),
        # Schicht-A-Anker (Konzept §5.5): TANKAPP_DECISION_HOUR, Default 12.
        decision_hour=getattr(settings, "decision_hour", 12),
        # B30: Bodenkante der 12-Uhr-Regel. Ein Wert, zwei Konsumenten —
        # dieselbe Instanz begrenzt Beobachtungs-Panels (app/law.py) und
        # Trainingsfenster (engine/models.py::fit). Nie leer: Der Fallback
        # auf den Default steht in app/law.py, nicht hier.
        price_law_local=price_law_local(settings),
        # B0: Regime-Kalender (app/regimes.py) — in der Engine nur Marker
        # und Zähler (PIT-Paare, Backtest-Folds, regime_breaks_in_window);
        # Config prüft die Einträge und lehnt kaputte mit Grund ab.
        regimes=tuple(getattr(settings, "regimes", DEFAULT_REGIMES) or ()),
    )


def _env_choice(name: str, default: str, allowed: set[str]) -> str:
    """Umgebungsvariable mit erlaubten Werten; Unbekanntes fällt zurück."""
    value = os.environ.get(name, "").strip().lower()
    return value if value in allowed else default


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


def _env_path(name: str) -> Path | None:
    """Pfad aus der Umgebung; leer oder nur Leerzeichen bedeutet „nicht gesetzt“."""
    raw = os.environ.get(name, "").strip()
    return Path(raw) if raw else None


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
