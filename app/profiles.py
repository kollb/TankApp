"""A1: Fahrzeug-/Haushaltsprofile ohne Login.

Verbrauch, Zeitwert, Tankmenge, Kraftstoffart und Tankgröße liegen bisher nur
im ``localStorage`` je Browser — Handy ≠ PC, ein zweites Fahrzeug (Diesel
gegen Benziner) war unmöglich. Dieses Modul speichert Profile **serverseitig
für den Haushalt** (LAN-only, bewusst ohne Account/Rollen — siehe TODO
„Bewusst NICHT in dieser Liste“): Die GUI liest die Felder daraus und schreibt
Änderungen zurück; ohne erreichbaren Server gilt weiter der localStorage-Stand.

Trennung zu anderen Stores:
- Kein Eintrag im Feedback-Store: Profile sind Konfiguration, keine Belege —
  sie unterliegen auch nicht der 90-Tage-Retention.
- ``city``/``station_id`` bleiben Gerätesache (localStorage): Die Stadt gehört
  zur Sicht, nicht zum Fahrzeug.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from polling_plan import atomic_json, collector_lock

UTC = dt.timezone.utc

# B2-Muster: Schema-Version des Profil-Stores. Erste Fassung; jeder weitere
# Sprung bekommt eine Schritt-Funktion in _STORE_MIGRATIONS — nie wieder still.
PROFILE_SCHEMA_VERSION = 1

# Ein Haushalt braucht wenige Fahrzeuge; die Grenze hält die Datei klein und
# den Umschalter lesbar. Darüber: ``profile_limit`` (409) statt still kappen.
PROFILES_MAX = 8
MAX_NAME_CHARS = 40

# Dieselben Grenzen wie die GUI-Preferences (web/src/data.ts) — ein Profil
# füttert genau diese Felder; andere Werte würden an den Slidern wieder
# zerfallen. ``time_value_eur_h = 0`` bedeutet „Automatik“ (wie im GUI).
FUELS = {"e10", "e5", "diesel"}
DETOUR_MODES = {"onroute", "dedicated"}
FIELD_BOUNDS = {
    "liters": (10.0, 80.0),
    "consumption": (4.0, 15.0),
    "time_value_eur_h": (0.0, 30.0),
    "speed_kmh": (25.0, 80.0),
    "tank_capacity_l": (20.0, 120.0),
}
DEFAULTS = {
    "fuel": "e10",
    "liters": 40.0,
    "consumption": 7.0,
    "time_value_eur_h": 0.0,
    "speed_kmh": 45.0,
    "detour_mode": "onroute",
    "tank_capacity_l": 50.0,
}

_STORE_THREAD_LOCK = threading.Lock()


class ProfileError(ValueError):
    """Validierungsfehler mit Fach-Code für die 4xx-Antwort des Servers."""


def profiles_path(settings) -> Path:
    p = settings.runtime / "profiles" / "profiles.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _store_digest(store: dict[str, Any]) -> bytes:
    payload = json.dumps(store, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).digest()


def _migrate_store_v0_to_v1(store: dict[str, Any]) -> dict[str, Any]:
    """Ohne ``schema_version`` (Datei fehlt Schlüssel) → Neutralwerte ergänzen."""
    store.setdefault("profiles", [])
    store.setdefault("active", None)
    return store


_STORE_MIGRATIONS = {
    0: _migrate_store_v0_to_v1,
}


def migrate_store(raw: dict[str, Any]) -> dict[str, Any]:
    """Bringt einen geladenen Store auf ``PROFILE_SCHEMA_VERSION``.

    Ein Store aus einer neueren App-Version ist ein harter Fehler — sonst
    würde der nächste Schreibvorgang den neueren Bestand wegpeitschen
    (dasselbe Muster wie ``app/feedback.py``).
    """
    try:
        version = int(raw.get("schema_version", 0))
    except (TypeError, ValueError):
        version = 0
    version = max(0, version)
    if version > PROFILE_SCHEMA_VERSION:
        raise RuntimeError(
            f"Profil-Store hat Schema-Version {version}, der Code kennt nur "
            f"{PROFILE_SCHEMA_VERSION}. Erst die App aktualisieren."
        )
    store = dict(raw)
    while version < PROFILE_SCHEMA_VERSION:
        step = _STORE_MIGRATIONS.get(version)
        if step is None:
            break
        store = step(store)
        version += 1
    store["schema_version"] = PROFILE_SCHEMA_VERSION
    return store


@contextmanager
def locked_profiles(settings):
    """Essicheres Lesen/Schreiben des Profil-Stores (dasselbe Muster wie Feedback).

    Schreibt nur bei echter Änderung (Digest-Vergleich); Lese-Pfade ändern die
    Datei nie. Ein ``ProfileError`` (Validierung) wird nicht als „Lock belegt“
    verschluckt, sondern durchgereicht.
    """
    with _STORE_THREAD_LOCK:
        lock = None
        last_error = None
        for _ in range(50):
            try:
                lock = collector_lock(
                    profiles_path(settings).parent, label="Profil-Store"
                )
                lock.__enter__()
                break
            except ValueError as exc:
                last_error = exc
                lock = None
                time.sleep(0.05)
        if lock is None:
            raise last_error
        try:
            store = load_store(settings)
            before = _store_digest(store)
            yield store
            if _store_digest(store) != before:
                atomic_json(profiles_path(settings), store)
        finally:
            lock.__exit__(None, None, None)


def _read_json(path: Path, default=None):
    """Lokale Kopie des read_json-Musters — bewusst ohne Import aus app.data
    (data.py importiert die Profil-Funktionen, hier wäre der Kreis geschlossen)."""
    try:
        if path.stat().st_size > 10_000_000:
            return default
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return default


def load_store(settings) -> dict[str, Any]:
    raw = _read_json(profiles_path(settings), None)
    if not isinstance(raw, dict):
        raw = {}
    return migrate_store(raw)


def public_profiles(store: dict[str, Any]) -> dict[str, Any]:
    """Der GUI-Teil: Profil-Liste + aktives Profil, ohne interne Schlüssel."""
    profiles = [dict(p) for p in store.get("profiles", []) if isinstance(p, dict)]
    active = store.get("active")
    if active is not None and not any(p.get("id") == active for p in profiles):
        active = None  # toter Verweis (z. B. manuell gelöschte Datei) → keiner
    return {"profiles": profiles, "active": active}


def _now_iso(clock) -> str:
    return (clock() if clock else dt.datetime.now(UTC)).isoformat()


def _uid() -> str:
    return f"prof_{uuid.uuid4().hex[:12]}"


def _to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None
    return out if out == out and out not in (float("inf"), float("-inf")) else None


def _clean_name(value: Any) -> str:
    name = str(value or "").strip()
    if not name:
        raise ProfileError("invalid_profile_name")
    if len(name) > MAX_NAME_CHARS:
        raise ProfileError("invalid_profile_name")
    return name


def clean_fields(payload: dict[str, Any], *, partial: bool) -> dict[str, Any]:
    """Validiert Profil-Felder — dieselben Grenzen wie die GUI-Preferences.

    ``partial=True`` (Update) prüft nur gesetzte Schlüssel; ``partial=False``
    (Neuanlage) füllt alles mit Defaults. Unbekannte Schlüssel werden
    still weggelassen — der Store ist kein Freitext-Ablagefach.
    """
    out: dict[str, Any] = {}
    if not partial or "name" in payload:
        out["name"] = _clean_name(payload.get("name"))
    for key, (low, high) in FIELD_BOUNDS.items():
        if partial and key not in payload:
            continue
        raw = payload.get(key, DEFAULTS.get(key))
        value = _to_float(raw)
        if value is None or not (low <= value <= high):
            raise ProfileError(f"invalid_{key}")
        out[key] = round(value, 2)
    if not partial or "fuel" in payload:
        fuel = str(payload.get("fuel") or DEFAULTS["fuel"]).lower()
        if fuel not in FUELS:
            raise ProfileError("invalid_fuel")
        out["fuel"] = fuel
    if not partial or "detour_mode" in payload:
        mode = str(payload.get("detour_mode") or DEFAULTS["detour_mode"]).lower()
        if mode not in DETOUR_MODES:
            raise ProfileError("invalid_mode")
        out["detour_mode"] = mode
    return out


def create_profile(settings, payload: dict[str, Any], clock=None) -> dict[str, Any]:
    """Legt ein Profil an (Felder wie im GUI; fehlende bekommen Defaults)."""
    with locked_profiles(settings) as store:
        profiles = store.setdefault("profiles", [])
        if len(profiles) >= PROFILES_MAX:
            raise ProfileError("profile_limit")
        fields = clean_fields(payload, partial=False)
        now = _now_iso(clock)
        profile = {
            "id": _uid(),
            "name": fields["name"],
            **{k: v for k, v in fields.items() if k != "name"},
            "created_at": now,
            "updated_at": now,
        }
        profiles.append(profile)
        if store.get("active") is None:
            store["active"] = profile["id"]
        return dict(profile)


def update_profile(
    settings, profile_id: str, payload: dict[str, Any], clock=None
) -> dict[str, Any]:
    """Aktualisiert Felder eines Profils (partiell; ``name`` umbenennbar)."""
    if not isinstance(payload, dict):
        raise ProfileError("invalid_query")
    with locked_profiles(settings) as store:
        profile = _find(store, profile_id)
        if profile is None:
            raise ProfileError("profile_not_found")
        fields = clean_fields(payload, partial=True)
        if not fields:
            raise ProfileError("invalid_query")
        profile.update(fields)
        profile["updated_at"] = _now_iso(clock)
        return dict(profile)


def activate_profile(settings, profile_id: str | None) -> dict[str, Any]:
    """Setzt das aktive Profil (``None`` = „kein Profil, nur dieses Gerät“)."""
    with locked_profiles(settings) as store:
        if profile_id is not None and _find(store, profile_id) is None:
            raise ProfileError("profile_not_found")
        store["active"] = profile_id
        return {"active": profile_id}


def delete_profile(settings, profile_id: str) -> dict[str, Any]:
    """Löscht ein Profil. War es aktiv, ist danach keins aktiv (ehrlich leer)."""
    with locked_profiles(settings) as store:
        profile = _find(store, profile_id)
        if profile is None:
            raise ProfileError("profile_not_found")
        store["profiles"] = [p for p in store["profiles"] if p.get("id") != profile_id]
        if store.get("active") == profile_id:
            store["active"] = None
        return {"deleted": profile_id}


def _find(store: dict[str, Any], profile_id: str) -> dict[str, Any] | None:
    for p in store.get("profiles", []):
        if isinstance(p, dict) and p.get("id") == profile_id:
            return p
    return None
