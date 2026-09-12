"""A1: Fahrzeug-/Haushaltsprofile — Store-Logik und API-Endpunkte.

Ohne Login, dafür mit denselben Grenzen wie die GUI-Preferences: Der
Profil-Store füttert genau die Felder, die die GUI slidet/eingibt; andere
Werte würden an den Slidern wieder zerfallen. Getestet wird der Weg bis
durch den HTTP-Handler (dieselbe Form wie tests/test_app.py), denn genau
dort liegen die Statuscodes, die die GUI unterscheiden muss.
"""

import datetime as dt
import json
import threading
import urllib.error
import urllib.request

import pytest

from app.config import Settings
from app.data import LiveData
from app.server import make_server

NOW = dt.datetime(2026, 9, 12, 10, tzinfo=dt.timezone.utc)


@pytest.fixture
def profile_settings(tmp_path):
    static = tmp_path / "web"
    static.mkdir()
    (static / "index.html").write_text("<html>TankApp test shell</html>")
    return Settings(
        data=tmp_path / "data",
        archive=tmp_path / "archive",
        polling=tmp_path / "polling.json",
        influx_env=tmp_path / "influx.env",
        netrc=tmp_path / "netrc",
        static=static,
    )


@pytest.fixture
def server(profile_settings):
    live = LiveData(profile_settings, query=lambda *_: [], clock=lambda: NOW)
    srv = make_server(profile_settings, "127.0.0.1", 0, live)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    yield base
    srv.shutdown()
    srv.server_close()
    thread.join(timeout=2)


def request(base, path, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


def test_empty_store_serves_no_profiles(server):
    status, body = request(server, "/api/v1/profiles")
    assert status == 200
    assert body == {"profiles": [], "active": None}


def test_create_activates_first_profile_and_persists(server, profile_settings):
    status, body = request(
        server,
        "/api/v1/profiles",
        "POST",
        {"name": "Pendler-Benziner", "consumption": 6.5},
    )
    assert status == 200
    assert body["name"] == "Pendler-Benziner"
    assert body["consumption"] == 6.5
    # Fehlende Felder bekommen die Defaults — kein Teilprofil mit Löchern.
    assert body["liters"] == 40.0
    assert body["fuel"] == "e10"
    assert body["tank_capacity_l"] == 50.0
    assert body["id"] and body["created_at"] and body["updated_at"]

    status, body = request(server, "/api/v1/profiles")
    assert status == 200
    assert body["active"] is not None
    assert len(body["profiles"]) == 1

    # Persistenz: zweiter LiveData auf demselben Verzeichnis liest dasselbe.
    again = LiveData(profile_settings, query=lambda *_: [], clock=lambda: NOW)
    assert again.profiles()["profiles"][0]["name"] == "Pendler-Benziner"


def test_create_rejects_out_of_bounds_fields(server):
    status, body = request(
        server, "/api/v1/profiles", "POST", {"name": "X", "consumption": 25}
    )
    assert status == 400
    assert body["error_code"] == "invalid_consumption"

    status, body = request(server, "/api/v1/profiles", "POST", {"name": "   "})
    assert status == 400
    assert body["error_code"] == "invalid_profile_name"

    status, body = request(
        server, "/api/v1/profiles", "POST", {"name": "X", "fuel": "wasserstoff"}
    )
    assert status == 400
    assert body["error_code"] == "invalid_fuel"


def test_update_activate_delete_flow(server):
    _, created = request(
        server,
        "/api/v1/profiles",
        "POST",
        {"name": "Diesel-Kombi", "fuel": "diesel"},
    )
    pid = created["id"]
    _, second = request(server, "/api/v1/profiles", "POST", {"name": "Zweitwagen"})

    # Update: partiell, nur gesetzte Felder.
    status, body = request(
        server,
        f"/api/v1/profiles/{pid}",
        "PUT",
        {"liters": 60, "time_value_eur_h": 12.5},
    )
    assert status == 200
    assert body["liters"] == 60.0
    assert body["time_value_eur_h"] == 12.5
    assert body["name"] == "Diesel-Kombi"

    # Aktivieren des zweiten Profils.
    status, _ = request(server, f"/api/v1/profiles/{second['id']}/activate", "POST", {})
    assert status == 200
    _, listing = request(server, "/api/v1/profiles")
    assert listing["active"] == second["id"]

    # Aktives Profil löschen → danach ist keins aktiv (ehrlich leer).
    status, _ = request(server, f"/api/v1/profiles/{second['id']}", "DELETE")
    assert status == 200
    _, listing = request(server, "/api/v1/profiles")
    assert listing["active"] is None
    assert [p["id"] for p in listing["profiles"]] == [pid]

    # Unbekannte IDs: 404, kein stiller Erfolg.
    status, body = request(server, "/api/v1/profiles/prof_does_not_exist", "DELETE")
    assert status == 404
    assert body["error_code"] == "profile_not_found"
    status, _ = request(
        server, "/api/v1/profiles/prof_does_not_exist/activate", "POST", {}
    )
    assert status == 404
    status, _ = request(
        server, "/api/v1/profiles/prof_does_not_exist", "PUT", {"liters": 40}
    )
    assert status == 404


def test_profile_limit_returns_409(server):
    for i in range(8):
        status, _ = request(server, "/api/v1/profiles", "POST", {"name": f"Auto {i}"})
        assert status == 200
    status, body = request(server, "/api/v1/profiles", "POST", {"name": "Neuntes"})
    assert status == 409
    assert body["error_code"] == "profile_limit"


def test_activation_of_unknown_profile_is_404(server):
    _, created = request(server, "/api/v1/profiles", "POST", {"name": "Auto"})
    status, _ = request(
        server, f"/api/v1/profiles/{created['id']}/activate", "POST", {}
    )
    assert status == 200
    status, body = request(server, "/api/v1/profiles/none/activate", "POST", {})
    assert status == 404
    assert body["error_code"] == "profile_not_found"
