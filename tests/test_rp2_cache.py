"""Tests für den RP2 Forecast-Cache (rp2/cache_forecasts.py) — G1.

Der `cache.log` wächst sonst unbegrenzt (alle 5 min ein Anhang). Der
Größen-Cap verwirft bei Überschreitung die ältere Hälfte.
"""

import importlib.util
import sys
from pathlib import Path

CACHE_PATH = Path(__file__).resolve().parents[1] / "rp2" / "cache_forecasts.py"


def load_cache_module():
    spec = importlib.util.spec_from_file_location("tankapp_cache_forecasts", CACHE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


cache = load_cache_module()


def test_log_cap_keeps_only_recent_half(tmp_path):
    log_file = tmp_path / "cache.log"
    # 2000 Zeilen à ~40 Bytes > 1 KiB-Cap.
    log_file.write_text("".join(f"Zeile {i:04d}\n" for i in range(2000)))

    cache.cap_log_file(log_file, max_bytes=1024)

    content = log_file.read_text(encoding="utf-8")
    assert log_file.stat().st_size <= 1024
    assert "aeltere Zeilen verworfen" in content
    # Die jüngsten Zeilen bleiben erhalten.
    assert "Zeile 1999" in content


def test_log_cap_ignores_small_files(tmp_path):
    log_file = tmp_path / "cache.log"
    original = "kurze Zeile\n" * 3
    log_file.write_text(original)
    cache.cap_log_file(log_file, max_bytes=1024 * 1024)
    assert log_file.read_text(encoding="utf-8") == original


def test_log_cap_is_noop_on_missing_file(tmp_path):
    # Fehlende Datei: kein Fehler, keine Datei.
    cache.cap_log_file(tmp_path / "nicht-da.log", max_bytes=1024)
    assert not (tmp_path / "nicht-da.log").exists()


# G4: Der Cache bleibt in /tmp (bewusst, SD-Schonung). Statt ihn zu
# persistieren, benennt der Service den Zustand beim Start.
def test_boot_state_note_explains_missing_cache_after_reboot(tmp_path):
    note = cache.boot_state_note(tmp_path / "last_forecasts.json")
    assert "Kein Cache vorhanden" in note
    assert "/tmp ist nach einem Reboot leer" in note
    assert "SD-Karte" in note


def test_boot_state_note_reports_existing_cache(tmp_path):
    cache_file = tmp_path / "last_forecasts.json"
    cache_file.write_text("{}", encoding="utf-8")
    note = cache.boot_state_note(cache_file)
    assert "Cache vorhanden" in note
    assert str(cache_file) in note
