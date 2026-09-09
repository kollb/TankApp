#!/usr/bin/env python3
"""
RP2 Forecast Cache - Lädt und cached die letzten Prognosen vom NAS.
Läuft als systemd-Service auf dem RP2.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Konfiguration ueber Umgebungsvariablen (systemd: Environment=NAS_IP=...)
NAS_IP = os.environ.get("NAS_IP", "")
NAS_PORT = os.environ.get("NAS_PORT", "1355")
NAS_URL = os.environ.get(
    "NAS_URL", f"http://{NAS_IP}:{NAS_PORT}/api/v1/last_forecasts"
)
POLL_SECONDS = int(os.environ.get("CACHE_INTERVAL_SECONDS", "300"))
CACHE_DIR = Path("/tmp/tankapp_cache")
CACHE_FILE = CACHE_DIR / "last_forecasts.json"
LOG_FILE = CACHE_DIR / "cache.log"

# Stelle sicher, dass Cache-Verzeichnis existiert
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def log(message):
    """Loggt Nachrichten mit Zeitstempel."""
    timestamp = datetime.now(timezone.utc).isoformat()
    with open(LOG_FILE, "a") as f:
        f.write(f"[{timestamp}] {message}\n")
    print(f"[{timestamp}] {message}")


def cache_forecasts():
    """Lädt Prognosen vom NAS und cached sie lokal."""
    try:
        with urllib.request.urlopen(NAS_URL, timeout=10) as response:
            if response.status == 200:
                data = json.loads(response.read().decode("utf-8"))

                # Füge Metadaten hinzu
                data["_cached_at"] = datetime.now(timezone.utc).isoformat()
                data["_source"] = "NAS"

                # Atomar speichern, damit die GUI nie eine halbe Datei liest
                tmp = CACHE_FILE.with_suffix(".json.tmp")
                with open(tmp, "w") as f:
                    json.dump(data, f, indent=2)
                os.replace(tmp, CACHE_FILE)

                log(
                    f"✅ Prognosen gecached: {data.get('count', 0)} Stationen, "
                    f"generiert: {data.get('generated_at')}"
                )
                return True
            log(f"⚠️  NAS antwortete mit Status {response.status}")
            return False
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        log(f"⚠️  NAS nicht erreichbar: {type(e).__name__}")
        return False
    except json.JSONDecodeError as e:
        log(f"⚠️  Ungültige JSON-Antwort: {e}")
        return False
    except Exception as e:
        log(f"⚠️  Unerwarteter Fehler: {type(e).__name__}: {e}")
        return False


def main():
    log("=== RP2 Forecast Cache gestartet ===")

    if not NAS_IP and "NAS_URL" not in os.environ:
        log(
            "❌ Keine NAS-IP konfiguriert. Setze NAS_IP in "
            "/etc/systemd/system/tankapp-forecast-cache.service.d/nas.conf "
            "oder starte mit NAS_IP=192.168.x.y python3 cache_forecasts.py"
        )
        return 1

    log(f"NAS-Endpunkt: {NAS_URL}")

    # Initialer Cache
    cache_forecasts()

    # Endlosschleife
    while True:
        try:
            time.sleep(POLL_SECONDS)
            cache_forecasts()
        except KeyboardInterrupt:
            log("Cache-Service beendet")
            break
        except Exception as e:
            log(f"⚠️  Fehler in Hauptschleife: {e}")
            time.sleep(60)  # Warte vor neuem Versuch
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
