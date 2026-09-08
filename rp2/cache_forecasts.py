#!/usr/bin/env python3
"""
RP2 Forecast Cache - Lädt und cached die letzten Prognosen vom NAS.
Läuft als systemd-Service auf dem RP2.
"""

import json
import os
import requests
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Konfiguration
NAS_URL = "http://<NAS-IP>:1355/api/v1/last_forecasts"  # IP anpassen!
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
        response = requests.get(NAS_URL, timeout=10)
        if response.status_code == 200:
            data = response.json()
            
            # Füge Metadaten hinzu
            data["_cached_at"] = datetime.now(timezone.utc).isoformat()
            data["_source"] = "NAS"
            
            # Speichere Cache
            with open(CACHE_FILE, "w") as f:
                json.dump(data, f, indent=2)
            
            log(f"✅ Prognosen gecached: {data.get('count', 0)} Stationen, generiert: {data.get('generated_at')}")
            return True
        else:
            log(f"⚠️  NAS antwortete mit Status {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        log(f"⚠️  NAS nicht erreichbar: {type(e).__name__}")
        return False
    except json.JSONDecodeError as e:
        log(f"⚠️  Ungültige JSON-Antwort: {e}")
        return False
    except Exception as e:
        log(f"⚠️  Unerwarteter Fehler: {type(e).__name__}: {e}")
        return False


def load_live_prices():
    """Lädt aktuelle Preise aus dem RP2-Puffer (/dev/shm/tankapp)."""
    poll_dir = Path("/dev/shm/tankapp")
    today = datetime.now().strftime("%Y-%m-%d")
    poll_file = poll_dir / f"{today}.jsonl"
    
    prices = []
    if poll_file.exists():
        try:
            with open(poll_file, "r") as f:
                for line in f:
                    data = json.loads(line)
                    prices.append(data)
            log(f"✅ Live-Preise geladen: {len(prices)} Einträge")
        except Exception as e:
            log(f"⚠️  Fehler beim Laden der Preise: {e}")
    else:
        log(f"⚠️  Poll-Datei nicht gefunden: {poll_file}")
    
    return prices


def main():
    log("=== RP2 Forecast Cache gestartet ===")
    
    # Initialer Cache
    cache_forecasts()
    
    # Endlosschleife
    while True:
        try:
            time.sleep(300)  # Alle 5 Minuten
            cache_forecasts()
        except KeyboardInterrupt:
            log("Cache-Service beendet")
            break
        except Exception as e:
            log(f"⚠️  Fehler in Hauptschleife: {e}")
            time.sleep(60)  # Warte vor neuem Versuch


if __name__ == "__main__":
    main()
