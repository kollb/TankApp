"""Tests für den RP2 Forecast-Cache (rp2/cache_forecasts.py) — G1.

Der `cache.log` wächst sonst unbegrenzt (alle 5 min ein Anhang). Der
Größen-Cap verwirft bei Überschreitung die ältere Hälfte.
"""

import importlib.util
import json
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


# B1: Die Payload des NAS-Endpunkts wird validiert, bevor gecacht wird.
# Ein Dict ohne „forecasts“-Liste (z. B. eine Fehler-Antwort) darf nicht als
# Cache durchgehen — sonst zeigt die Fallback-GUI „Cache fehlt“, obwohl das
# NAS geantwortet hat.


class _FakeResponse:
    def __init__(self, status=200, body=b"{}"):
        self.status = status
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _run_cache(monkeypatch, tmp_path, response):
    cache_file = tmp_path / "last_forecasts.json"
    monkeypatch.setattr(cache, "CACHE_FILE", cache_file)
    monkeypatch.setattr(cache, "LOG_FILE", tmp_path / "cache.log")
    monkeypatch.setattr(cache.urllib.request, "urlopen", lambda *a, **k: response)
    ok = cache.cache_forecasts()
    return ok, cache_file


def test_cache_forecasts_rejects_payload_without_forecasts_list(monkeypatch, tmp_path):
    body = b'{"error_code": "invalid_query"}'
    ok, cache_file = _run_cache(monkeypatch, tmp_path, _FakeResponse(200, body))
    assert ok is False
    assert not cache_file.exists()


def test_cache_forecasts_rejects_non_dict_payload(monkeypatch, tmp_path):
    ok, cache_file = _run_cache(monkeypatch, tmp_path, _FakeResponse(200, b"[1, 2, 3]"))
    assert ok is False
    assert not cache_file.exists()


def test_cache_forecasts_writes_valid_payload(monkeypatch, tmp_path):
    body = json.dumps(
        {
            "generated_at": "2026-09-14T06:00:00+00:00",
            "forecasts": [{"station_id": "x", "points": []}],
            "count": 1,
        }
    ).encode("utf-8")
    ok, cache_file = _run_cache(monkeypatch, tmp_path, _FakeResponse(200, body))
    assert ok is True
    assert cache_file.exists()
    saved = json.loads(cache_file.read_text(encoding="utf-8"))
    assert saved["_source"] == "NAS"
    assert saved["forecasts"] == [{"station_id": "x", "points": []}]
