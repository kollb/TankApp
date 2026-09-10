"""One-command NAS start/update. Secrets are bind-mounted read-only, not image/env content."""

import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

import tankapp
import export_influx as influx
from polling_plan import atomic_json, validate_sets
from .config import ROOT


def up(args):
    state_path = ROOT / "data/nas-settings.json"
    try:
        previous = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = {}
    if not isinstance(previous, dict):
        raise ValueError(
            "Ungültige nas-settings.json; keine bestehenden Einstellungen überschrieben."
        )

    def chosen(name, default):
        supplied = getattr(args, name, None)
        return supplied if supplied is not None else previous.get(name, default)

    paths = {
        name: Path(chosen(name, default)).expanduser().resolve()
        for name, default in {
            "archive_dir": ROOT / "data/raw",
            "runtime_dir": ROOT / "data/runtime",
            "polling": tankapp.ACTIVE,
            "influx_env": ROOT / "data/influx.env",
        }.items()
    }
    if not paths["polling"].is_file():
        raise ValueError(
            "Das gemeinsame polling.json fehlt auf dem NAS. Vorhandenes Set mit --polling einbinden."
        )
    validate_sets(json.loads(paths["polling"].read_text(encoding="utf-8-sig")))
    if not paths["influx_env"].is_file():
        raise ValueError(
            "Vorhandene private influx.env mit Lesezugang auf dem NAS bereitstellen (--influx-env)."
        )
    cfg = influx.load_config(paths["influx_env"])
    cfg.validate()
    if urlsplit(cfg.url).hostname in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError(
            "InfluxDB-URL muss aus dem App-Container erreichbar sein: NAS-LAN-Adresse statt localhost verwenden."
        )
    port, days = int(chosen("port", 1355)), int(chosen("history_days", 365))
    fuels = str(chosen("model_fuels", "e10"))
    default_uid = os.environ.get(
        "SUDO_UID", str(os.getuid() if hasattr(os, "getuid") else 1000)
    )
    default_gid = os.environ.get(
        "SUDO_GID", str(os.getgid() if hasattr(os, "getgid") else 1000)
    )
    uid, gid = int(chosen("uid", default_uid)), int(chosen("gid", default_gid))
    if (
        not 1024 <= port <= 65535
        or not 0 <= uid <= 65534
        or not 0 <= gid <= 65534
        or not 1 <= days <= 7300
        or not set(fuels.split(",")) <= {"e10", "e5", "diesel"}
    ):
        raise ValueError(
            "Ungültiger Port, Container-UID/GID, Archivzeitraum oder Modell-Kraftstoff."
        )
    selected_netrc = chosen("netrc", None)
    access = tankapp.netrc_args(selected_netrc)
    netrc = Path(access[1]) if access else ROOT / "data/nas-empty-netrc"
    try:
        subprocess.run(
            ["docker", "compose", "version"], check=True, capture_output=True
        )
    except (OSError, subprocess.CalledProcessError):
        raise ValueError(
            "Docker mit Compose v2 wird auf dem NAS benötigt. Kein Python-venv-Setup erforderlich."
        ) from None
    for name in ("archive_dir", "runtime_dir"):
        path = paths[name]
        existed = path.exists()
        path.mkdir(parents=True, exist_ok=True)
        if not existed and hasattr(os, "geteuid") and os.geteuid() == 0:
            os.chown(path, uid, gid)
    if not access:
        netrc.parent.mkdir(parents=True, exist_ok=True)
        if not netrc.exists():
            netrc.touch(mode=0o600)
    values = {
        "TANKAPP_ARCHIVE_DIR": str(paths["archive_dir"]),
        "TANKAPP_RUNTIME_DIR": str(paths["runtime_dir"]),
        "TANKAPP_POLLING_FILE": str(paths["polling"]),
        "TANKAPP_INFLUX_ENV": str(paths["influx_env"]),
        "TANKAPP_NETRC": str(netrc),
        "TANKAPP_WEB_PORT": str(port),
        "TANKAPP_HISTORY_DAYS": str(days),
        "TANKAPP_MODEL_FUELS": fuels,
        "TANKAPP_UID": str(uid),
        "TANKAPP_GID": str(gid),
        # B5: Betriebsknöpfe des App-Dienstes (Defaults in app/config.py).
        # Keine Geheimnisse — Werte kommen aus der Umgebung des Aufrufs.
        "TANKAPP_MODEL_WORKERS": os.environ.get("TANKAPP_MODEL_WORKERS", "0"),
        "TANKAPP_M7_AUTO_APPLY": os.environ.get("TANKAPP_M7_AUTO_APPLY", "0"),
        "TANKAPP_API_KEYS": os.environ.get("TANKAPP_API_KEYS", ""),
    }
    command = [
        "docker",
        "compose",
        "--project-name",
        "tankapp-web",
        "-f",
        str(ROOT / "ops/nas/app/compose.yml"),
    ]
    # Process environment contains configuration paths, NEVER token contents.
    subprocess.run(
        [*command, "config", "--quiet"],
        env={**os.environ, **values},
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        [*command, "up", "-d", "--build", "--force-recreate"],
        env={**os.environ, **values},
        cwd=ROOT,
        check=True,
    )
    atomic_json(
        state_path,
        {
            **{name: str(path) for name, path in paths.items()},
            "netrc": str(netrc) if access else None,
            "port": port,
            "uid": uid,
            "gid": gid,
            "history_days": days,
            "model_fuels": fuels,
        },
    )
    print(f"TankApp gestartet: http://<NAS-Adresse>:{port}")
    print(
        "Archiv- und Modelljobs laufen im App-Dienst. Vorhandene zusätzliche cron-Jobs dafür deaktivieren."
    )
    print(
        "Nur im Heimnetz/VPN betreiben; keine ungeschützte Portfreigabe ins Internet."
    )
    if not access:
        print(
            "Archivzugang fehlt noch. Bestehende netrc bereitstellen und denselben nas-up-Befehl erneut ausführen."
        )
    print(
        "Datenstand und Job-Ergebnisse stehen in der GUI unter System; Start ist noch kein Echt-Daten-Nachweis."
    )
    return 0
