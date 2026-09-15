#!/usr/bin/env python3
"""
RP2 Fallback-GUI + NAS-Proxy auf Port 8000 (nur Python-Standardbibliothek).

Verhalten:
  * NAS online  -> alle Requests (GUI + /api/*) werden transparent an das NAS
                   weitergeleitet. Unter der RP2-Adresse (Port 8000) erscheint
                   dann die vollwertige TankApp-GUI vom NAS.
  * NAS offline -> lokale Fallback-GUI mit
                   - Live-Preisen aus dem RAM-Puffer (/dev/shm/tankapp),
                   - Stationen-Metadaten (Name, Marke, Koordinaten) aus
                     polling.json (die JSONL-Snapshots enthalten nur UUID+Preis),
                   - gecachten Prognosen aus /tmp/tankapp_cache (F1/F3).

Konfiguration (Umgebungsvariablen, systemd-Drop-in):
  NAS_IP / NAS_PORT      NAS-Adresse (Default: http://<NAS_IP>:1355)
  NAS_HEALTH_URL         kompletter Health-URL (überschreibt NAS_IP/PORT)
  FALLBACK_GUI_PORT      Port der RP2-GUI (Default 8000)
  POLL_DIR               Puffer des Collectors (Default /dev/shm/tankapp)
  CACHE_DIR              Prognose-Cache (Default /tmp/tankapp_cache)
  STATION_META           Pfad zu polling.json (Default: bekannte Orte)
  TEMPLATE_DIR           Template-Verzeichnis (Default: <rp2>/templates)
  FORCE_FALLBACK=1       erzwingt die Fallback-GUI (auch bei NAS online)

API-Endpunkte (Fallback-Modus):
  GET /                        Fallback-GUI (?fallback=1 erzwingt sie)
  GET /api/v1/health           Status (NAS, Preise, Prognosen, Metadaten)
  GET /api/v1/stations?fuel=   Stationen mit allen Preisen, sortiert
  GET /api/v1/forecasts?fuel=  gecachte Prognosen + Zusammenfassung je Station
  GET /api/v1/decide?fuel=&liters=  F1/F2/F3-Entscheidung (einfache Logik)
  GET /api/v1/series?station=&fuel= Tagesverlauf 06–24 Uhr aus dem Puffer
  GET /api/v1/nas-check        NAS-Status sofort neu prüfen

Der Puffer wird je Anfrage nur einmal gelesen: `Context.snapshot()` hält den
Stand 5 s (SNAPSHOT_TTL_S) — vorher baute jeder der vier Endpunkte pro
GUI-Refresh denselben Stand neu. Der `series`-Endpunkt liest die Tag-Dateien
zusätzlich (er braucht die Stunden, nicht nur den letzten Stand je Station).
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "4.1"
# VERSION_MARKER wird am Ende des Moduls aus dem Template-Inhalt gebaut
# (Inhalts-Hash), damit auch JS-/CSS-Fixes innerhalb derselben Version auf
# bestehenden Installationen automatisch ersetzt werden.
VERSION_MARKER = ""

FUELS = ("e5", "e10", "diesel")
FRESH_MINUTES = 15  # Snapshot gilt als "aktuell" bis zu diesem Alter
SNAPSHOT_TTL_S = 5.0  # Kurzzeit-Cache für Context.snapshot()
SERIES_FIRST_HOUR = 6  # Tagesstreifen beginnt mit der Stunde 06
SERIES_LAST_HOUR = 24  # Zelle „24“ ist die Mitternachtsstunde (00:00–00:59)
WAIT_THRESHOLD_EUR = 1.0  # F1: ab so viel erwarteter Ersparnis pro Tank -> warten
DEFAULT_LITERS = 40
MIN_LITERS = 5
MAX_LITERS = 100
NAS_CHECK_TIMEOUT_S = 2.0
# G4: Der Prognose-Cache liegt bewusst in /tmp (tmpfs) und ist damit nach
# jedem Reboot leer — das schont die SD-Karte des Pi. Statt den Cache auf
# Platte zu spiegeln, sagt die Oberfläche den Grund und wann es weitergeht.
# Ein Satz, drei Stellen (F1-Erklärung, Prognose-Raster, API-Fehler).
CACHE_REBOOT_HINT = (
    "Nach einem Neustart ist der Prognose-Puffer leer — er liegt bewusst im "
    "RAM (/tmp), damit die SD-Karte geschont wird. Der Cache füllt sich "
    "automatisch mit dem nächsten Abruf (alle 5 Minuten)."
)
PROXY_TIMEOUT_S = 15.0
HEALTH_TTL_ONLINE_S = 15.0  # wie schnell wird das NAS (nach Wiederkehr) bemerkt
HEALTH_TTL_OFFLINE_S = 30.0  # wie oft wird nach einem Offline-Zustand neu geprüft
SNAPSHOT_DAYS_BACK = 2  # letzte N Tag-Dateien berücksichtigen (Nacht-Puffer)
MAX_PROXY_BODY = 32 * 1024 * 1024


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(value) -> datetime | None:
    """ISO-Zeitstempel (mit oder ohne Offset, 'Z' erlaubt) -> aware datetime."""
    if not value or not isinstance(value, (str, int, float)):
        return None
    try:
        ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


# ---------------------------------------------------------------------------
# Stationen-Metadaten aus polling.json
# ---------------------------------------------------------------------------


class StationMeta:
    """Lädt uuid -> {name, brand, lat, lon, ...} aus polling.json.

    Liest die Datei nur bei mtime-Änderung; hält den letzten guten Stand,
    wenn die Datei einmal unlesbar ist.
    """

    def __init__(self, candidates: list[str | Path]):
        self.paths: list[Path] = [Path(p) for p in candidates if p]
        self._meta: dict[str, dict] = {}
        self._mtime: float | None = None
        self.path_used: str | None = None
        self.error: str | None = None

    def load(self) -> dict[str, dict]:
        for path in self.paths:
            if not path.is_file():
                continue
            try:
                mtime = path.stat().st_mtime
                if mtime == self._mtime and self._meta:
                    return self._meta
                payload = json.loads(path.read_text(encoding="utf-8"))
                meta: dict[str, dict] = {}
                for city_key, stset in (payload.get("sets") or {}).items():
                    # Der Pi arbeitet im Betrieb oft mit kurzen Set-Keys
                    # (z. B. FRA/GT), während ältere Dateien als Label den
                    # ausgeschriebenen Ort tragen. Beides ist eine gültige
                    # Identität: der sichtbare Text darf „Frankfurt“ sein,
                    # der Filter oben muss aber auch den stabilen Key
                    # „FRA“ anbieten und akzeptieren.
                    city_key = str(city_key).strip()
                    city_label = str(stset.get("label") or city_key).strip()
                    for st in stset.get("stations") or []:
                        uid = st.get("uuid")
                        if not uid:
                            continue
                        lat, lon = st.get("lat"), st.get("lon")
                        maps = st.get("maps")
                        if not maps and is_number(lat) and is_number(lon):
                            maps = (
                                "https://www.google.com/maps/dir/?api=1&"
                                f"destination={lat:.6f},{lon:.6f}"
                            )
                        meta[uid] = {
                            "name": st.get("name") or "",
                            "brand": st.get("brand") or "",
                            "group": st.get("group") or "",
                            "lat": lat,
                            "lon": lon,
                            "dist_km": st.get("dist_km"),
                            "drive_min": st.get("drive_min"),
                            "maps": maps,
                            "city": city_label,
                            "city_key": city_key or city_label,
                            "city_label": city_label,
                        }
                self._meta, self._mtime = meta, mtime
                self.path_used = str(path)
                self.error = None
                return self._meta
            except (OSError, json.JSONDecodeError) as exc:
                self.error = f"polling.json unlesbar ({path}): {exc}"
        if self._meta:
            return self._meta
        self.error = self.error or "polling.json nicht gefunden (Stationennamen fehlen)"
        return self._meta


# ---------------------------------------------------------------------------
# Live-Preise aus dem RAM-Puffer (JSONL)
# ---------------------------------------------------------------------------


def read_snapshots(
    poll_dir: Path, days_back: int = SNAPSHOT_DAYS_BACK
) -> dict[str, dict]:
    """Leset die letzten Tag-Dateien und liefert je Station den NEUESTEN Stand.

    Mehrere Stadtsets schreiben abwechselnd in dieselbe Datei; jede Station
    behält ihren eigenen Zeitstempel (je Zeile ein Snapshot einer Stadt).
    """
    today = datetime.now().date()
    files: list[Path] = []
    for i in range(days_back + 1):
        day = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        path = poll_dir / f"{day}.jsonl"
        if path.is_file():
            files.append(path)
    best: dict[str, dict] = {}
    for path in files:  # älteste zuerst; neuere Zeilen überschreiben
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                snap = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(snap, dict):
                continue
            fetched = parse_ts(snap.get("fetched_at"))
            if fetched is None:
                continue
            prices = snap.get("prices")
            if not isinstance(prices, dict):
                continue
            city = snap.get("city") or ""
            for uid, rec in prices.items():
                if not isinstance(rec, dict):
                    continue
                prev = best.get(uid)
                if prev is not None and prev["_fetched"] >= fetched:
                    continue
                best[uid] = {
                    "station_id": uid,
                    "status": rec.get("status") or "no prices",
                    "e5": rec.get("e5") if is_number(rec.get("e5")) else None,
                    "e10": rec.get("e10") if is_number(rec.get("e10")) else None,
                    "diesel": rec.get("diesel")
                    if is_number(rec.get("diesel"))
                    else None,
                    "city": city,
                    "fetched_at": fetched.isoformat(),
                    "_fetched": fetched,
                }
    return best


def local_tz():
    """Zeitzone des Systems (Pi/NAS: Europe/Berlin) — ohne Zusatzabhängigkeit.

    Der Collector benennt seine Tag-Dateien und sein Polling-Fenster nach
    Ortszeit, die Meldungen selbst tragen UTC-Zeitstempel. Für den Tagesstreifen
    wird deshalb beim Bucket auf Ortszeit umgerechnet.
    """
    return datetime.now().astimezone().tzinfo or timezone.utc


def read_series(poll_dir: Path, uid: str, fuel: str) -> dict:
    """Tagesverlauf 06–24 Uhr (Ortszeit) für EINE Station aus dem Puffer.

    Liest dieselben JSONL-Tag-Dateien wie `read_snapshots`, behält aber die
    Stunden statt nur der letzten Meldung je Station: je Stunde die letzte
    **offene** Meldung für ``fuel``, sonst ``null`` — der Streifen erfindet
    keine Preise (Ehrlichkeits-Regel). Die Zelle „24“ ist die
    Mitternachtsstunde (00:00–00:59 des Folgetags); der Collector pollt bis
    24 Uhr, sie bleibt im Normalbetrieb leer.

    Rückgabe (bewusst nur die angefragte Station, damit der Payload klein
    bleibt): ``hours`` (06…24 mit Wert + Zeitstempel) sowie ``min``/``max``
    (Tagestief/-hoch) und ``now`` (letzte Meldung) mit Wert + Ortszeit.
    """
    tz = local_tz()
    today = datetime.now(tz).date()
    tomorrow = today + timedelta(days=1)
    slots: dict[int, dict] = {}
    for day in (today, tomorrow):
        path = poll_dir / f"{day.strftime('%Y-%m-%d')}.jsonl"
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                snap = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(snap, dict):
                continue
            fetched = parse_ts(snap.get("fetched_at"))
            prices = snap.get("prices")
            if fetched is None or not isinstance(prices, dict):
                continue
            rec = prices.get(uid)
            if not isinstance(rec, dict) or rec.get("status") != "open":
                continue
            value = rec.get(fuel)
            if not is_number(value):
                continue
            local = fetched.astimezone(tz)
            if local.date() == tomorrow and local.hour == 0:
                slot = SERIES_LAST_HOUR
            elif local.date() == today and (
                SERIES_FIRST_HOUR <= local.hour < SERIES_LAST_HOUR
            ):
                slot = local.hour
            else:
                continue  # außerhalb des heutigen Polling-Fensters
            prev = slots.get(slot)
            if prev is None or prev["_at"] <= fetched:
                slots[slot] = {
                    "hour": f"{slot:02d}",
                    "value": round(float(value), 3),
                    "at": fetched.isoformat(),
                    "time": local.strftime("%H:%M"),
                    "_at": fetched,
                }
    hours: list[dict] = []
    for slot in range(SERIES_FIRST_HOUR, SERIES_LAST_HOUR + 1):
        rec = slots.get(slot)
        hours.append(
            {"hour": f"{slot:02d}", "value": rec["value"], "at": rec["at"]}
            if rec
            else {"hour": f"{slot:02d}", "value": None, "at": None}
        )

    def point(rec: dict | None) -> dict | None:
        if rec is None:
            return None
        return {"value": rec["value"], "at": rec["time"]}

    known = list(slots.values())
    return {
        "station_id": uid,
        "fuel": fuel,
        "day": today.isoformat(),
        "generated_at": utcnow().isoformat(),
        "hours": hours,
        "min": point(min(known, key=lambda r: r["value"]) if known else None),
        "max": point(max(known, key=lambda r: r["value"]) if known else None),
        "now": point(max(known, key=lambda r: r["_at"]) if known else None),
    }


def build_stations(
    best: dict[str, dict], meta: dict[str, dict], now: datetime | None = None
) -> list[dict]:
    """Merged Stationenliste (alle Treibstoffe, echtes Datenalter)."""
    now = now or utcnow()
    out: list[dict] = []
    for uid, rec in best.items():
        m = meta.get(uid, {})
        age = (now - rec["_fetched"]).total_seconds() / 60.0
        out.append(
            {
                "station_id": uid,
                "name": m.get("name") or uid,
                "brand": m.get("brand", ""),
                "group": m.get("group", ""),
                "city": rec.get("city") or m.get("city_label") or m.get("city", ""),
                "city_key": m.get("city_key") or rec.get("city") or m.get("city", ""),
                "city_label": m.get("city_label")
                or rec.get("city")
                or m.get("city", ""),
                "status": rec["status"],
                "e5": rec["e5"],
                "e10": rec["e10"],
                "diesel": rec["diesel"],
                "lat": m.get("lat"),
                "lon": m.get("lon"),
                "dist_km": m.get("dist_km"),
                "drive_min": m.get("drive_min"),
                "maps_url": m.get("maps"),
                "fetched_at": rec["fetched_at"],
                "age_minutes": round(age, 1),
                "fresh": age <= FRESH_MINUTES,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Gecachte Prognosen
# ---------------------------------------------------------------------------


def load_forecasts(cache_file: Path) -> dict | None:
    if not cache_file.is_file():
        return None
    try:
        data = json.loads(cache_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def point_stats(point: dict, current_price: float | None) -> dict | None:
    """Preis-Score (0…1) + erwartete Ersparnis/Liter — KEINE Wahrscheinlichkeit.

    Vereinfachte Annahme: gleichförmige Verteilung zwischen den historischen
    Quantilen q025 und q975 (Formfehler bis ~8,4 Prozentpunkte gegenüber der
    kalibrierten Posterior M7). Die GUI darf das deshalb nicht
    „Wahrscheinlichkeit“ nennen, sondern nur „Preis-Score“ auf Basis des
    historischen Quantils. Die kalibrierte Wahrscheinlichkeit liefert
    ausschließlich das NAS (M7).
    """
    lo, hi = point.get("q025"), point.get("q975")
    if not (is_number(lo) and is_number(hi) and hi > lo):
        return None
    price_score = 0.0
    exp_saving = 0.0
    if current_price is not None:
        price_score = max(0.0, min(1.0, (current_price - lo) / (hi - lo)))
        if current_price > lo:
            if current_price >= hi:
                exp_saving = current_price - (lo + hi) / 2.0
            else:
                d = current_price - lo
                exp_saving = d * d / (2.0 * (hi - lo))
    return {
        "price_score": round(price_score, 3),
        "exp_saving_per_l": round(exp_saving, 5),
    }


def summarize_forecast(
    points: list[dict] | None, now: datetime, current_price: float | None
) -> dict | None:
    """Zusammenfassung der zukünftigen Prognose-Punkte (ab jetzt, max. 24 h)."""
    future: list[tuple[datetime, dict, dict]] = []
    horizon = now + timedelta(hours=25)
    for p in points or []:
        if not isinstance(p, dict):
            continue
        ts = parse_ts(p.get("timestamp"))
        if ts is None or ts < now - timedelta(minutes=5) or ts > horizon:
            continue
        stats = point_stats(p, current_price)
        if stats is None:
            continue
        future.append((ts, p, stats))
    if not future:
        return None
    ranked = sorted(future, key=lambda t: t[2]["exp_saving_per_l"], reverse=True)

    def window(ts: datetime, p: dict, stats: dict) -> dict:
        # Die Punkte sind UTC (Engine-Index); „time“/„date“ sind API-Vertrag
        # für Menschen → Ortszeit (Europe/Berlin). Der ISO-Stempel „at“ bleibt
        # UTC — die GUI rendert ihn selbst mit Europe/Berlin.
        local = ts.astimezone(local_tz())
        return {
            "at": ts.isoformat(),
            "time": local.strftime("%H:%M"),
            "date": local.strftime("%Y-%m-%d"),
            "q50": p.get("q50"),
            "q025": p.get("q025"),
            "q975": p.get("q975"),
            "price_score": stats["price_score"],
            "expected_saving_ct_per_l": round(stats["exp_saving_per_l"] * 100, 1),
        }

    best_ts, best_p, best_stats = ranked[0]
    medians = [p.get("q50") for _, p, _ in future if is_number(p.get("q50"))]
    return {
        "best": window(best_ts, best_p, best_stats),
        "windows": [
            window(ts, p, s) for ts, p, s in ranked[:3] if s["exp_saving_per_l"] > 0
        ],
        "min_q50": min(medians) if medians else None,
        "max_q50": max(medians) if medians else None,
        "points": len(future),
    }


# ---------------------------------------------------------------------------
# NAS-Erreichbarkeit + Proxy
# ---------------------------------------------------------------------------


class NasState:
    """Gemeinsamer (thread-sicherer) NAS-Status mit Kurzzeit-Cache."""

    def __init__(
        self,
        base_url: str | None,
        health_url: str | None = None,
        ttl_online: float = HEALTH_TTL_ONLINE_S,
        ttl_offline: float = HEALTH_TTL_OFFLINE_S,
        timeout: float = NAS_CHECK_TIMEOUT_S,
    ):
        self.base_url = base_url
        self.health_url = health_url or (
            f"{base_url}/api/v1/health" if base_url else None
        )
        self.ttl_online = ttl_online
        self.ttl_offline = ttl_offline
        self.timeout = timeout
        self._lock = threading.Lock()
        self.online: bool | None = None
        self.checked_at: float = 0.0
        self.last_error: str | None = None

    def _probe(self) -> tuple[bool, str | None]:
        try:
            with urllib.request.urlopen(self.health_url, timeout=self.timeout) as resp:
                # Vollständiges Body lesen (bis zur Obergrenze), nicht die
                # ersten 4096 Bytes: Das Health-Payload wächst (mehr
                # Alarms, längere Fehler-Strings), und ein abgeschnittenes
                # JSON ist per Definition nicht parsebar.
                try:
                    length = min(
                        int(resp.headers.get("Content-Length") or 0),
                        128 * 1024,
                    )
                    body = resp.read(length) if length else b""
                except (ValueError, OSError):
                    body = b""
                try:
                    data = json.loads(body.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    data = {}
                if resp.status == 200 and (not data or data.get("app") == "online"):
                    return True, None
                return False, f"health antwortet nicht 'online' (HTTP {resp.status})"
        except Exception as exc:  # URLError, TimeoutError, HTTPError, ...
            return False, type(exc).__name__

    def is_online(self, force: bool = False) -> bool:
        if not self.base_url:
            return False
        with self._lock:
            now = time.monotonic()
            ttl = self.ttl_online if self.online else self.ttl_offline
            if not force and self.online is not None and now - self.checked_at < ttl:
                return self.online
        ok, err = self._probe()
        with self._lock:
            self.online, self.checked_at, self.last_error = ok, time.monotonic(), err
        return ok

    def mark_offline(self, reason: str):
        with self._lock:
            self.online = False
            self.checked_at = time.monotonic()
            self.last_error = reason

    def info(self) -> dict:
        with self._lock:
            return {
                "configured": bool(self.base_url),
                "online": bool(self.online) if self.base_url else False,
                "last_check": utcnow().isoformat() if self.checked_at else None,
                "error": self.last_error,
            }


# ---------------------------------------------------------------------------
# Kontext (geteilter Zustand)
# ---------------------------------------------------------------------------


class Context:
    def __init__(
        self,
        *,
        poll_dir: str | Path,
        cache_file: str | Path,
        meta_candidates: list[str | Path],
        template_dir: str | Path,
        nas_base: str | None = None,
        nas_health: str | None = None,
        force_fallback: bool = False,
        nas_state: NasState | None = None,
        proxy_timeout: float = PROXY_TIMEOUT_S,
        snapshot_ttl: float = SNAPSHOT_TTL_S,
    ):
        self.poll_dir = Path(poll_dir)
        self.cache_file = Path(cache_file)
        self.meta = StationMeta(meta_candidates)
        self.template_dir = Path(template_dir)
        self.force_fallback = force_fallback
        self.proxy_timeout = proxy_timeout
        self.snapshot_ttl = snapshot_ttl
        self.nas = nas_state or NasState(nas_base, nas_health)
        self._snapshot_lock = threading.Lock()
        self._snapshot: dict | None = None
        self._snapshot_at = 0.0

    def snapshot(self, force: bool = False) -> dict:
        """Puffer-Stand, kurz zwischengespeichert (SNAPSHOT_TTL_S).

        Ein GUI-Refresh fragt vier Endpunkte parallel ab — ohne Cache liest
        jeder den kompletten Puffer neu. Der Cache hält den Stand deshalb 5 s;
        der Collector tickt alle 5 min, die Frische bleibt also unberührt.

        Der Aufbau läuft **innerhalb** des Locks: nur so wird aus vier
        gleichzeitigen Anfragen wirklich ein Read pro Zyklus. Der Puffer liegt
        in /dev/shm, der kritische Abschnitt ist Millisekunden kurz.
        """
        with self._snapshot_lock:
            if (
                not force
                and self._snapshot is not None
                and time.monotonic() - self._snapshot_at < self.snapshot_ttl
            ):
                return self._snapshot
            meta = self.meta.load()
            best = read_snapshots(self.poll_dir)
            snapshot = {
                "stations": build_stations(best, meta),
                "forecasts": load_forecasts(self.cache_file),
                "meta_path": self.meta.path_used,
                "meta_error": self.meta.error,
            }
            self._snapshot, self._snapshot_at = snapshot, time.monotonic()
            return snapshot


# ---------------------------------------------------------------------------
# HTTP-Server
# ---------------------------------------------------------------------------


def _json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False).encode(
        "utf-8"
    )


def make_server(ctx: Context, host: str = "0.0.0.0", port: int = 8000):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"TankAppRP2/{VERSION}"
        protocol_version = "HTTP/1.1"

        # -- Basis ----------------------------------------------------------
        def log_message(self, fmt, *args):
            print(
                f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
                f"{self.address_string()} {fmt % args}",
                flush=True,
            )

        def _send(
            self,
            status: int,
            body: bytes,
            content_type: str,
            extra_headers: dict | None = None,
        ):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            for key, value in (extra_headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            if self.command != "HEAD" and body:
                self.wfile.write(body)

        def _json(self, payload: dict, status: int = 200):
            self._send(status, _json_bytes(payload), "application/json; charset=utf-8")

        def _error(self, status: int, message: str):
            self._json({"error": message}, status=status)

        # -- Routing ---------------------------------------------------------
        def do_GET(self):
            self._handle()

        def do_HEAD(self):
            self._handle()

        # B4: Schreibaktionen (Beleg buchen, Intent, Profil, …) werden wie
        # GET transparent zur NAS weitergeleitet — die Pi-Adresse ist kein
        # read-only-Einstiegspunkt mehr. Der Fallback selbst hat keine
        # Schreibendpunkte; bei offline NAS antwortet die GUI ehrlich.
        def do_POST(self):
            self._handle_write()

        def do_PUT(self):
            self._handle_write()

        def do_DELETE(self):
            self._handle_write()

        def do_PATCH(self):
            self._handle_write()

        def _read_body(self) -> bytes | None:
            """Request-Body nach Content-Length; ``None`` = Limit überschritten."""
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return None
            if length > MAX_PROXY_BODY:
                return None
            return self.rfile.read(length) if length > 0 else b""

        def _handle_write(self):
            try:
                url = urllib.parse.urlsplit(self.path)
                # Body immer zuerst lesen: Keep-Alive-Verbindung bleibt
                # sauber, egal ob weitergeleitet oder lokal geantwortet.
                body = self._read_body()
                if body is None:
                    self._error(413, "Payload zu groß (Proxy-Limit 32 MiB).")
                    return
                query = urllib.parse.parse_qs(url.query)
                force_fb = (
                    ctx.force_fallback
                    or "fallback" in query
                    or self.headers.get("X-Force-Fallback") == "1"
                )
                if not force_fb and ctx.nas.base_url and ctx.nas.is_online():
                    if self._proxy(body):
                        return
                if url.path.startswith("/api/"):
                    self._error(
                        503,
                        "NAS offline — Schreibaktionen sind nur erreichbar,"
                        " wenn das NAS antwortet (der Fallback ist nur lesend)."
                        " „🔄 NAS prüfen“ oben löst das direkt.",
                    )
                else:
                    self._error(405, "Methode wird hier nicht unterstützt.")
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as exc:  # Server bleibt laufen
                try:
                    self._error(500, f"interner Fehler: {type(exc).__name__}")
                except Exception:
                    pass

        def _handle(self):
            try:
                url = urllib.parse.urlsplit(self.path)
                query = urllib.parse.parse_qs(url.query)
                force_fb = (
                    ctx.force_fallback
                    or "fallback" in query
                    or self.headers.get("X-Force-Fallback") == "1"
                )
                # nas-check ist ein RP2-eigener Steuer-Endpunkt (kein NAS-API-
                # Pfad) und wird daher auch im Proxy-Modus lokal beantwortet.
                if url.path == "/api/v1/nas-check":
                    self._api(url.path, query)
                    return
                if not force_fb and ctx.nas.base_url and ctx.nas.is_online():
                    if self._proxy():
                        return
                    # Proxy fehlgeschlagen -> NAS als offline markiert, Fallback senden
                if url.path.startswith("/api/"):
                    self._api(url.path, query)
                elif url.path in ("/", "/index.html"):
                    self._index()
                else:
                    self._static(url.path)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as exc:  # Server bleibt laufen
                try:
                    self._error(500, f"interner Fehler: {type(exc).__name__}")
                except Exception:
                    pass

        # -- NAS-Proxy -------------------------------------------------------
        def _proxy(self, body: bytes | None = None) -> bool:
            """Request an die NAS weiterleiten.

            ``body`` nur für Schreibmethoden (POST/PUT/DELETE/PATCH): wird
            zusammen mit dem Content-Type der Anfrage durchgereicht.
            """
            target = ctx.nas.base_url + self.path
            try:
                headers = None
                if body is not None:
                    headers = {}
                    content_type = self.headers.get("Content-Type")
                    if content_type:
                        headers["Content-Type"] = content_type
                req = urllib.request.Request(
                    target, method=self.command, data=body, headers=headers or {}
                )
                with urllib.request.urlopen(req, timeout=ctx.proxy_timeout) as resp:
                    self.send_response(resp.status)
                    has_length = bool(resp.headers.get("Content-Length"))
                    for header in (
                        "Content-Type",
                        "Content-Length",
                        "Content-Encoding",
                        "Cache-Control",
                        "ETag",
                        "Last-Modified",
                    ):
                        # urlopen dekodiert Chunks/Close-Framing; ohne bekannte
                        # Bodylänge darf kein Content-Length vorgegeben werden
                        if not has_length and header == "Content-Length":
                            continue
                        value = resp.headers.get(header)
                        if value:
                            self.send_header(header, value)
                    if not has_length:
                        # Bodylänge unbekannt (chunked/close-delimited) ->
                        # Keep-Alive nicht antasten, Connection abschließen
                        self.send_header("Connection", "close")
                        self.close_connection = True
                    self.send_header("X-TankApp-Proxy", "nas")
                    self.end_headers()
                    if self.command == "HEAD":
                        return True
                    sent = 0
                    while True:
                        chunk = resp.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        sent += len(chunk)
                        if sent > MAX_PROXY_BODY:
                            return True
                    return True
            except urllib.error.HTTPError as exc:
                # Fehler des NAS (404, 400, ...) so weiterleiten wie bekommen
                body = b""
                if self.command != "HEAD":
                    try:
                        body = exc.read()[:MAX_PROXY_BODY]
                    except Exception:
                        body = b""
                self.send_response(exc.code)
                ctype = exc.headers.get("Content-Type") if exc.headers else None
                if ctype:
                    self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-TankApp-Proxy", "nas")
                self.end_headers()
                if body:
                    self.wfile.write(body)
                return True
            except Exception as exc:
                ctx.nas.mark_offline(type(exc).__name__)
                return False

        # -- Fallback: Hauptseite ---------------------------------------------
        def _index(self):
            template = ctx.template_dir / "index.html"
            try:
                html = template.read_text(encoding="utf-8")
            except OSError:
                self._error(500, "Template nicht gefunden (templates/index.html)")
                return
            self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")

        def _static(self, path: str):
            decoded = urllib.parse.unquote(path)
            if decoded != path:
                path = decoded
            candidate = (ctx.template_dir / path.lstrip("/")).resolve()
            if (
                not candidate.is_relative_to(ctx.template_dir.resolve())
                or not candidate.is_file()
            ):
                self._error(404, "nicht gefunden")
                return
            ctype = {
                ".css": "text/css",
                ".js": "text/javascript",
                ".svg": "image/svg+xml",
                ".png": "image/png",
                ".ico": "image/x-icon",
                ".json": "application/json",
            }.get(candidate.suffix.lower(), "application/octet-stream")
            self._send(
                200,
                candidate.read_bytes(),
                f"{ctype}; charset=utf-8"
                if candidate.suffix in (".css", ".js", ".json")
                else ctype,
            )

        # -- Fallback: API ------------------------------------------------------
        def _api(self, path: str, query: dict):
            if path == "/api/v1/health":
                self._api_health()
            elif path == "/api/v1/stations":
                self._api_stations(query)
            elif path == "/api/v1/forecasts":
                self._api_forecasts(query)
            elif path == "/api/v1/decide":
                self._api_decide(query)
            elif path == "/api/v1/series":
                self._api_series(query)
            elif path == "/api/v1/nas-check":
                online = ctx.nas.is_online(force=True)
                info = ctx.nas.info()
                self._json(
                    {
                        "online": online,
                        "nas": info,
                        "hint": (
                            "NAS ist online — jetzt neu laden (Reload) zeigt die "
                            "vollwertige NAS-GUI."
                            if online
                            else "NAS nicht erreichbar — Fallback-GUI bleibt aktiv."
                        ),
                    }
                )
            else:
                self._error(404, "Endpunkt unbekannt")

        @staticmethod
        def _city(query: dict) -> str | None:
            """Normalisierte Stadtfilterung; leer bedeutet alle Städte."""
            values = query.get("city", [])
            value = values[0].strip() if values else ""
            return value or None

        @staticmethod
        def _filter_city(rows: list[dict], city: str | None) -> list[dict]:
            if not city:
                return rows
            wanted = city.casefold()
            return [
                row
                for row in rows
                if wanted
                in {
                    str(row.get("city", "")).casefold(),
                    str(row.get("city_key", "")).casefold(),
                    str(row.get("city_label", "")).casefold(),
                }
            ]

        @staticmethod
        def _city_options(rows: list[dict]) -> list[dict]:
            """Filteroptionen: stabiler Set-Key als Wert, Label als Hilfe.

            `cities` bleibt aus Kompatibilitätsgründen eine Stringliste. Das
            neue Feld `city_options` gibt dem Template zusätzlich den Wert, den
            die API sicher filtern kann (FRA/GT), auch wenn die Snapshots als
            sichtbares Label „Frankfurt“/„Gütersloh“ tragen.
            """
            by_value: dict[str, str] = {}
            for row in rows:
                label = str(row.get("city_label") or row.get("city") or "").strip()
                key = str(row.get("city_key") or row.get("city") or label).strip()
                value = key or label
                if not value:
                    continue
                by_value.setdefault(value, label or value)
            return [
                {"value": value, "label": label}
                for value, label in sorted(by_value.items(), key=lambda item: item[0])
            ]

        @staticmethod
        def _fuel(query: dict) -> str:
            values = query.get("fuel", ["e10"])
            fuel = values[0].lower() if values else "e10"
            return fuel if fuel in FUELS else "e10"

        def _api_health(self):
            snap = ctx.snapshot()
            stations = snap["stations"]
            forecasts = snap["forecasts"]
            city_options = self._city_options(stations)
            cities = [entry["value"] for entry in city_options]
            price_now = utcnow()
            newest = None
            for st in stations:
                ts = parse_ts(st["fetched_at"])
                if ts and (newest is None or ts > newest):
                    newest = ts
            gen_ts = parse_ts(forecasts.get("generated_at")) if forecasts else None
            cached_ts = parse_ts(forecasts.get("_cached_at")) if forecasts else None
            with_names = sum(1 for st in stations if st["name"] != st["station_id"])
            self._json(
                {
                    "status": "fallback",
                    "version": VERSION,
                    "cities": cities,
                    "city_options": city_options,
                    "generated_at": price_now.isoformat(),
                    "nas": ctx.nas.info(),
                    "prices": {
                        "available": bool(stations),
                        "stations": len(stations),
                        "open": sum(1 for st in stations if st["status"] == "open"),
                        "fetched_at": newest.isoformat() if newest else None,
                        "age_minutes": round(
                            (price_now - newest).total_seconds() / 60.0, 1
                        )
                        if newest
                        else None,
                        "meta_error": snap["meta_error"],
                        "stations_with_name": with_names,
                    },
                    "forecasts": {
                        "available": bool(forecasts and forecasts.get("forecasts")),
                        "count": (len(forecasts.get("forecasts") or []))
                        if forecasts
                        else 0,
                        "generated_at": forecasts.get("generated_at")
                        if forecasts
                        else None,
                        "cached_at": cached_ts.isoformat() if cached_ts else None,
                        "age_hours": round(
                            (price_now - gen_ts).total_seconds() / 3600.0, 1
                        )
                        if gen_ts
                        else None,
                    },
                }
            )

        def _api_stations(self, query: dict):
            fuel = self._fuel(query)
            city = self._city(query)
            snap = ctx.snapshot()
            rows = self._filter_city(list(snap["stations"]), city)
            rows.sort(
                key=lambda s: (
                    0 if s["status"] == "open" and is_number(s.get(fuel)) else 1,
                    s.get(fuel) if is_number(s.get(fuel)) else 0.0,
                    s["name"],
                )
            )
            out = []
            for s in rows:
                out.append(
                    {
                        **s,
                        "fuel": fuel,
                        "price": s.get(fuel) if s["status"] == "open" else None,
                    }
                )
            self._json(
                {
                    "generated_at": utcnow().isoformat(),
                    "fuel": fuel,
                    "fresh_minutes": FRESH_MINUTES,
                    "stations": out,
                    "fresh_prices": sum(
                        1 for s in out if s["fresh"] and s["price"] is not None
                    ),
                    "nas_status": "offline" if not ctx.nas.online else "online",
                }
            )

        def _api_forecasts(self, query: dict):
            fuel = self._fuel(query)
            city = self._city(query)
            snap = ctx.snapshot()
            forecasts = snap["forecasts"]
            if not forecasts or not forecasts.get("forecasts"):
                self._json(
                    {
                        "available": False,
                        "count": 0,
                        "forecasts": [],
                        # Kein Cache hat drei mögliche Ursachen — statt die
                        # Schuld dem NAS zuzuschieben, auf das Log verweisen:
                        # NAS offline, fehlerhafte Antwort oder leerer /tmp
                        # nach Reboot.
                        "error": "Kein Prognose-Cache vorhanden — Ursache steht"
                        " im Cache-Log (/tmp/tankapp_cache/cache.log): NAS"
                        " offline, Fehler-Antwort oder Reboot. " + CACHE_REBOOT_HINT,
                    },
                    status=503,
                )
                return
            by_station = {
                s["station_id"]: s
                for s in self._filter_city(list(snap["stations"]), city)
            }
            now = utcnow()
            entries = []
            for fc in forecasts["forecasts"]:
                if not isinstance(fc, dict):
                    continue
                if str(fc.get("fuel", "")).lower() != fuel:
                    continue
                st = by_station.get(fc.get("station_id"))
                current = (
                    (
                        fc_price
                        if (fc_price := st.get(fuel)) is not None
                        and st["status"] == "open"
                        else None
                    )
                    if st
                    else None
                )
                points = fc.get("points") or []
                entries.append(
                    {
                        "station_id": fc.get("station_id"),
                        "name": (st or {}).get("name") or fc.get("station_id"),
                        "brand": (st or {}).get("brand", ""),
                        "city": (st or {}).get("city", ""),
                        "origin": fc.get("origin"),
                        "last_observation": fc.get("last_observation"),
                        "stale_data_at_origin": fc.get("stale_data_at_origin"),
                        "current_price": current,
                        "summary": summarize_forecast(points, now, current),
                        "points": points,
                    }
                )
            entries.sort(key=lambda e: (e["name"], e["station_id"]))
            gen_ts = parse_ts(forecasts.get("generated_at"))
            self._json(
                {
                    "available": True,
                    "fuel": fuel,
                    "count": len(entries),
                    "generated_at": forecasts.get("generated_at"),
                    "cached_at": forecasts.get("_cached_at"),
                    "age_hours": round((now - gen_ts).total_seconds() / 3600.0, 1)
                    if gen_ts
                    else None,
                    "forecasts": entries,
                }
            )

        def _api_series(self, query: dict):
            """Tagesverlauf 06–24 Uhr einer Station (gleichnamiger NAS-Endpunkt).

            Bewusst strenger als die anderen Fallback-Endpunkte: ein falsches
            ``fuel`` wird nicht still zu E10, sondern als 400 gemeldet — sonst
            zeigt der Tagesstreifen Zahlen zu einem Kraftstoff, den niemand
            angefragt hat.
            """
            values = query.get("fuel", [])
            fuel = values[0].strip().lower() if values else ""
            if fuel not in FUELS:
                self._error(400, f"fuel muss einer von {', '.join(FUELS)} sein")
                return
            station = (query.get("station", [""])[0] or "").strip()
            if not station:
                self._error(400, "station fehlt (Station-UUID)")
                return
            snap = ctx.snapshot()
            if not snap["stations"]:
                self._error(
                    503,
                    "Preis-Puffer ist leer — der Collector hat noch nichts "
                    "gemeldet (nach einem Neustart füllt er sich mit dem "
                    "nächsten Poll, alle 5 Minuten).",
                )
                return
            if station not in {s["station_id"] for s in snap["stations"]}:
                self._error(404, "Station unbekannt (nicht im Preis-Puffer)")
                return
            self._json(read_series(ctx.poll_dir, station, fuel))

        def _api_decide(self, query: dict):
            fuel = self._fuel(query)
            city = self._city(query)
            try:
                liters = int(query.get("liters", [str(DEFAULT_LITERS)])[0])
            except (ValueError, TypeError):
                liters = DEFAULT_LITERS
            liters = max(MIN_LITERS, min(MAX_LITERS, liters))

            snap = ctx.snapshot()
            now = utcnow()
            open_stations = [
                s
                for s in self._filter_city(list(snap["stations"]), city)
                if s["status"] == "open" and is_number(s.get(fuel))
            ]
            if not open_stations:
                self._json(
                    {
                        "available": False,
                        "error": "Keine offenen Stationen mit Preisen "
                        f"({fuel.upper()}) im Puffer.",
                    },
                    status=503,
                )
                return
            open_stations.sort(key=lambda s: s[fuel])
            cheapest = open_stations[0]
            second = open_stations[1] if len(open_stations) > 1 else None
            priciest = open_stations[-1]
            # B8: Die NAS-GUI nullt veraltete Preise, bevor sie die günstigste
            # sucht; der Fallback zeigt die Zahlen weiter an, macht die
            # Frische aber sichtbar — die Antwort-Karte kippt auf
            # „Momentaufnahme“, wenn im Set keine frische Meldung liegt.
            fresh_in_set = sum(1 for s in open_stations if s["fresh"])
            oldest_age = max(s["age_minutes"] for s in open_stations)
            # Fix: spart vs zweitgünstigste statt vs teuerste (Top1 vs Top10 nicht sinnvoll)
            ref_for_saving = second if second else priciest
            f2 = {
                "station": {
                    "station_id": cheapest["station_id"],
                    "name": cheapest["name"],
                    "brand": cheapest["brand"],
                    "city": cheapest["city"],
                    "maps_url": cheapest["maps_url"],
                },
                "price": cheapest[fuel],
                "second_price": second[fuel] if second else None,
                "second_name": second["name"] if second else None,
                "most_expensive": priciest[fuel],
                "saving_ct_per_l": round(
                    (ref_for_saving[fuel] - cheapest[fuel]) * 100, 1
                )
                if second
                else round((priciest[fuel] - cheapest[fuel]) * 100, 1),
                "saving_eur_tank": round(
                    (ref_for_saving[fuel] - cheapest[fuel]) * liters, 2
                )
                if second
                else round((priciest[fuel] - cheapest[fuel]) * liters, 2),
                "saving_vs": "second" if second else "most_expensive",
                "fresh": bool(cheapest["fresh"]),
                "age_minutes": cheapest["age_minutes"],
                "fresh_in_set": fresh_in_set,
                "oldest_age_minutes": oldest_age,
            }

            # F1/F3 aus gecachten Prognosen (für die günstigste Station)
            f1: dict = {"available": False}
            windows: list[dict] = []
            forecast_info: dict = {"available": False}
            forecasts = snap["forecasts"]
            if forecasts and forecasts.get("forecasts"):
                fc = next(
                    (
                        f
                        for f in forecasts["forecasts"]
                        if isinstance(f, dict)
                        and f.get("station_id") == cheapest["station_id"]
                        and str(f.get("fuel", "")).lower() == fuel
                        and isinstance(f.get("points"), list)
                    ),
                    None,
                )
                if fc:
                    summary = summarize_forecast(fc["points"], now, cheapest[fuel])
                    gen_ts = parse_ts(forecasts.get("generated_at"))
                    forecast_info = {
                        "available": summary is not None,
                        "generated_at": forecasts.get("generated_at"),
                        "age_hours": round((now - gen_ts).total_seconds() / 3600.0, 1)
                        if gen_ts
                        else None,
                        "station": cheapest["name"],
                    }
                    if summary:
                        best = summary["best"]
                        saving_eur = best["expected_saving_ct_per_l"] / 100.0 * liters
                        wait = (
                            saving_eur >= WAIT_THRESHOLD_EUR
                            and best["price_score"] >= 0.5
                        )
                        f1 = {
                            "available": True,
                            "recommendation": "wait" if wait else "refuel_now",
                            "reason": (
                                f"Prognose rechnet bis {best['time']} Uhr mit ~"
                                f"{best['q50']:.3f} € (Preis-Score "
                                f"{int(round(best['price_score'] * 100))} % auf Basis "
                                f"des historischen Quantils), erwartet "
                                f"~{saving_eur:.2f} € Ersparnis für {liters} L."
                                if wait
                                else "Kein deutlich günstigeres Fenster in den nächsten 24 h "
                                "abzusehen — jetzt tanken ist okay."
                            ),
                            "best_at": best["at"],
                            "expected_price": best["q50"],
                            "price_score": best["price_score"],
                            "expected_saving_eur_tank": round(saving_eur, 2),
                            "current_price": cheapest[fuel],
                            "basis": "Preis-Score aus historischen Quantilen "
                            "(Gleichverteilung zwischen q025/q975) — "
                            "keine kalibrierte Wahrscheinlichkeit; "
                            "die exakte M7-Berechnung läuft auf dem NAS",
                        }
                        windows = summary["windows"]

            self._json(
                {
                    "available": True,
                    "mode": "fallback",
                    "fuel": fuel,
                    "liters": liters,
                    "generated_at": now.isoformat(),
                    "f2": f2,
                    "f1": f1,
                    "windows": windows,
                    "forecast": forecast_info,
                    "nas_status": "offline" if not ctx.nas.online else "online",
                }
            )

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


# ---------------------------------------------------------------------------
# Template-Installation + Start
# ---------------------------------------------------------------------------


def install_default_template(template_dir: Path) -> Path:
    """Liefert templates/index.html; ersetzt ein veraltetes Template (Version-Check)."""
    template_dir.mkdir(parents=True, exist_ok=True)
    template = template_dir / "index.html"
    if template.is_file():
        try:
            if VERSION_MARKER in template.read_text(encoding="utf-8"):
                return template
            backup = template.with_name("index.html.old")
            if backup.exists():
                backup.unlink()
            template.rename(backup)
            print(f"Altes Template gesichert nach {backup}")
        except OSError:
            pass
    template.write_text(DEFAULT_INDEX_HTML, encoding="utf-8")
    return template


def nas_config_from_env() -> tuple[str | None, str | None]:
    health = os.environ.get("NAS_HEALTH_URL", "").strip()
    if health:
        parts = urllib.parse.urlsplit(health)
        return f"{parts.scheme}://{parts.netloc}", health
    ip = os.environ.get("NAS_IP", "").strip()
    if not ip:
        return None, None
    port = os.environ.get("NAS_PORT", "1355").strip()
    base = f"http://{ip}:{port}"
    return base, f"{base}/api/v1/health"


def default_meta_candidates() -> list[str]:
    repo = Path(__file__).resolve().parent.parent
    return [
        p
        # B14: neuer Ort data/analysis/, alter docs/analysis/ bleibt als
        # Fallback in der Liste — ein Pi mit altem Stand darf die
        # Stationsnamen nicht verlieren.
        for p in (
            os.environ.get("STATION_META", ""),
            str(
                Path.home()
                / "TankApp"
                / "data"
                / "analysis"
                / "stations"
                / "polling.json"
            ),
            str(repo / "data" / "analysis" / "stations" / "polling.json"),
            str(
                Path.home()
                / "TankApp"
                / "docs"
                / "analysis"
                / "stations"
                / "polling.json"
            ),
            str(repo / "docs" / "analysis" / "stations" / "polling.json"),
        )
        if p
    ]


def main():
    nas_base, nas_health = nas_config_from_env()
    template_dir = Path(
        os.environ.get(
            "TEMPLATE_DIR", str(Path(__file__).resolve().parent / "templates")
        )
    )
    poll_dir = Path(os.environ.get("POLL_DIR", "/dev/shm/tankapp"))
    cache_dir = Path(os.environ.get("CACHE_DIR", "/tmp/tankapp_cache"))
    cache_dir.mkdir(parents=True, exist_ok=True)
    port = int(os.environ.get("FALLBACK_GUI_PORT", "8000"))
    force_fallback = os.environ.get("FORCE_FALLBACK", "").lower() in (
        "1",
        "true",
        "yes",
    )

    ctx = Context(
        poll_dir=poll_dir,
        cache_file=cache_dir / "last_forecasts.json",
        meta_candidates=default_meta_candidates(),
        template_dir=template_dir,
        nas_base=nas_base,
        nas_health=nas_health,
        force_fallback=force_fallback,
    )
    install_default_template(template_dir)

    print(f"Starte RP2 Fallback-GUI + NAS-Proxy auf 0.0.0.0:{port}")
    print(f"NAS: {ctx.nas.base_url or 'NICHT konfiguriert (immer Fallback)'}")
    print(
        f"Puffer: {poll_dir} | Prognose-Cache: {ctx.cache_file} | Metadaten: "
        f"{ctx.meta.paths}"
    )
    server = make_server(ctx, "0.0.0.0", port)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        print("Server wird beendet ...")
        server.shutdown()


# ---------------------------------------------------------------------------
# Fallback-GUI (einzige Datei: HTML + CSS + JS)
# ---------------------------------------------------------------------------

_TEMPLATE_HEAD = """<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#020617">
<title>TankApp · Fallback (RP2)</title>
"""
_TEMPLATE_REST = """
<style>
/* ==========================================================================
   TankApp Fallback-GUI v4 — Alltag/Werkstatt, Antwort-Karte zuerst.
   Gestaltungs-Leitplanken aus docs/GUI-VORLAGEN.md: Slate-950-Basis,
   Slate-900-Karten, Slate-800-Rahmen, Emerald = positiv/aktiv,
   Sky = Details/Kurven, Amber = Warnung. Nur Standardbibliothek-Webserver:
   alles (HTML, CSS, JS) steckt in dieser einen Datei.
   ========================================================================== */
:root {
  --bg: #020617;
  --panel: #0f172a;
  --panel-2: #0b1220;
  --border: #1e293b;
  --text: #f8fafc;
  --muted: #94a3b8;
  --dim: #64748b;
  --accent: #34d399;
  --accent-deep: #059669;
  --info: #38bdf8;
  --warn: #fbbf24;
  --bad: #fb7185;
  /* Inhaltsspalte: Kopf- und Steuerleiste laufen vollflächig (Hintergrund und
     Rahmen über die ganze Fensterbreite), ihr Inhalt bleibt aber in derselben
     Spalte wie <main class="wrap">. Sonst klebt auf breiten Desktops der
     Schriftzug links am Rand und die Pills rechts — weit weg vom Inhalt. */
  --content: 1060px;
  --gutter: 14px;
  --glow-emerald: rgba(16, 185, 129, 0.10);
  --glow-sky: rgba(56, 189, 248, 0.08);
}
html.light {
  --bg: #eef2f7;
  --panel: #ffffff;
  --panel-2: #f8fafc;
  --border: #dbe3ee;
  --text: #0f172a;
  --muted: #5b6b81;
  --dim: #8494ab;
  --accent: #059669;
  --accent-deep: #047857;
  --info: #0369a1;
  --warn: #b45309;
  --bad: #e11d48;
  --glow-emerald: rgba(5, 150, 105, 0.07);
  --glow-sky: rgba(3, 105, 161, 0.05);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  overflow-x: hidden;
}
button, input, select { font: inherit; color: inherit; max-width: 100%; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--info); outline-offset: 2px; border-radius: 6px; }
.num { font-variant-numeric: tabular-nums; }
a { color: var(--info); text-decoration: none; }
a:hover { text-decoration: underline; }
.hidden { display: none !important; }
.spacer { margin-left: auto; }
.muted { color: var(--muted); }

/* ---------- Status- + Steuerleiste (gemeinsam sticky) -------------------- */
.stickies {
  position: sticky; top: 0; z-index: 40;
  background: color-mix(in srgb, var(--bg) 94%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}
.topbar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px var(--gutter);
  padding-inline: max(var(--gutter), calc((100% - var(--content)) / 2));
  border-bottom: 1px solid var(--border);
}
.brand { font-weight: 800; font-size: 16px; letter-spacing: 0.2px; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.mode-badge {
  font-size: 10px; font-weight: 800; letter-spacing: 0.6px;
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--warn) 38%, transparent);
  padding: 2px 7px; border-radius: 999px; white-space: nowrap;
}
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.pill {
  font-size: 11.5px; font-weight: 700;
  border: 1px solid var(--border);
  background: var(--panel-2);
  padding: 5px 9px; border-radius: 999px;
  color: var(--muted);
  display: inline-flex; align-items: center; gap: 6px;
  white-space: nowrap;
  min-height: 32px;
}
button.pill { font-weight: 700; }
.pill.ok { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.pill.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
.pill.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, transparent); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; display: inline-block; flex: none; }
.icon-btn {
  width: 44px; height: 44px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: 12px;
  background: var(--panel-2); color: var(--muted);
}
.icon-btn:hover { color: var(--text); border-color: var(--accent); }
.icon-btn svg { width: 18px; height: 18px; }
@media (max-width: 460px) {
  .pill .pill-text { display: none; }
  .pill { padding: 8px; }
}
.controls {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px var(--gutter) 12px;
  padding-inline: max(var(--gutter), calc((100% - var(--content)) / 2));
}
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.seg {
  display: inline-flex; background: var(--panel-2);
  border: 1px solid var(--border); border-radius: 12px; padding: 3px; gap: 2px;
}
/* Auf dem Handy füllt die Kraftstoff-Umschaltung die Breite; auf dem Desktop
   deckelt sie sich, sonst werden aus drei kurzen Tabs eine sehr breite Leiste
   mit viel Leerraum. */
.seg.grow { flex: 1 1 auto; max-width: 420px; }
.seg button {
  flex: 1 1 0; min-height: 40px;
  border: 0; border-radius: 9px; background: transparent;
  color: var(--muted); font-weight: 700; font-size: 13.5px;
  padding: 6px 12px; white-space: nowrap;
}
.seg button.active { background: var(--accent); color: #04150d; }
.seg.slim button { flex: 0 1 auto; padding: 6px 12px; font-size: 12.5px; }
select, input[type="number"] {
  background: var(--panel-2); border: 1px solid var(--border);
  border-radius: 10px; padding: 8px 10px; font-size: 13.5px;
  min-height: 44px; color: var(--text);
}
select { min-width: 0; }
.field { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12.5px; font-weight: 600; }
input[type="number"] { width: 72px; text-align: center; }

/* ---------- Layout ------------------------------------------------------ */
.wrap { padding: 14px var(--gutter) 40px; width: min(100%, var(--content)); margin: 0 auto; }
.section-kicker {
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--dim);
  margin: 18px 2px 8px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 12px 32px -16px rgba(0, 0, 0, 0.6);
}
.card h2 {
  margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--muted); font-weight: 800;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.card h2 .sub { font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--dim); font-size: 12px; }

/* ---------- Antwort-Karte ------------------------------------------------ */
.answer {
  position: relative; overflow: hidden;
  border-top: 3px solid var(--accent);
  background:
    radial-gradient(600px 260px at 110% -40%, var(--glow-emerald), transparent 65%),
    radial-gradient(500px 240px at -30% 130%, var(--glow-sky), transparent 60%),
    var(--panel);
}
.answer.waiting { border-top-color: var(--info); }
.answer .kicker {
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--dim); margin-bottom: 10px;
}
.answer .verdict { display: flex; align-items: center; gap: 12px; }
.verdict-icon {
  width: 46px; height: 46px; flex: none; border-radius: 14px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}
.answer.waiting .verdict-icon {
  border-color: color-mix(in srgb, var(--info) 40%, transparent);
  background: color-mix(in srgb, var(--info) 12%, transparent);
  color: var(--info);
}
.verdict-icon svg { width: 24px; height: 24px; }
.verdict-text { font-size: 19px; font-weight: 800; line-height: 1.25; }
.verdict-text .tint-now { color: var(--accent); }
.verdict-text .tint-wait { color: var(--info); }
.verdict-reason { color: var(--muted); font-size: 12.5px; margin-top: 3px; }
.answer .price-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 12px 0 10px; }
.answer .price { font-size: 40px; font-weight: 900; letter-spacing: -1.2px; line-height: 1; }
.answer .price small { font-size: 14px; color: var(--muted); font-weight: 700; letter-spacing: 0; }
.answer .station-block { min-width: 0; }
.station-name {
  font-size: 16.5px; font-weight: 700; line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.station-meta, .st-meta {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  color: var(--muted); font-size: 12.5px; margin-top: 4px;
}
.st-meta { font-size: 11.5px; color: var(--dim); margin-top: 3px; }
.tag {
  display: inline-block; font-size: 10.5px; font-weight: 800; letter-spacing: 0.4px;
  padding: 2px 7px; border-radius: 6px; white-space: nowrap;
  background: color-mix(in srgb, var(--info) 12%, transparent);
  color: var(--info);
  border: 1px solid color-mix(in srgb, var(--info) 28%, transparent);
}
.tag.brand { background: color-mix(in srgb, var(--muted) 14%, transparent); color: var(--muted); border-color: transparent; }
.savings-line {
  margin-top: 10px; font-size: 13.5px; font-weight: 700; color: var(--accent);
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.savings-line .vs { color: var(--muted); font-weight: 500; font-size: 12.5px; }
.answer .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  min-height: 46px; padding: 9px 16px;
  border-radius: 12px; border: 1px solid var(--border);
  background: var(--panel-2); color: var(--text);
  font-weight: 700; font-size: 13.5px;
}
.btn:hover { border-color: var(--accent); }
.btn.primary {
  background: var(--accent); border-color: var(--accent); color: #04150d;
  box-shadow: 0 6px 20px -8px color-mix(in srgb, var(--accent) 65%, transparent);
}
.btn.primary:hover { background: var(--accent-deep); }
.btn svg { width: 16px; height: 16px; }
.answer .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11.5px; font-weight: 700;
  border: 1px solid var(--border); border-radius: 999px;
  padding: 5px 10px; color: var(--muted); background: var(--panel-2);
  max-width: 100%;
}
.chip .chip-txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 230px; }
.chip.info { color: var(--info); border-color: color-mix(in srgb, var(--info) 35%, transparent); }
.chip svg { width: 13px; height: 13px; flex: none; }

/* ---------- Tagesstreifen ------------------------------------------------ */
.daystrip { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-top: 12px; }
@media (min-width: 700px) { .daystrip { grid-template-columns: repeat(12, 1fr); } }
.cell {
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--panel-2); padding: 7px 4px 6px; text-align: center; min-width: 0;
}
.cell .h { font-size: 10px; color: var(--dim); font-variant-numeric: tabular-nums; }
.cell .v { font-size: 11.5px; font-weight: 800; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.cell.cheap { border-color: color-mix(in srgb, var(--accent) 45%, transparent); background: color-mix(in srgb, var(--accent) 10%, var(--panel-2)); }
.cell.cheap .v { color: var(--accent); }
.cell.pricey { border-color: color-mix(in srgb, var(--bad) 40%, transparent); background: color-mix(in srgb, var(--bad) 8%, var(--panel-2)); }
.cell.pricey .v { color: var(--bad); }
.cell.none .v { color: var(--dim); }
.cell.now { outline: 2px solid var(--accent); outline-offset: 1px; background: color-mix(in srgb, var(--accent) 16%, var(--panel-2)); }
.cell.now .h { color: var(--accent); font-weight: 800; }
/* Die drei Fakten der Antwort-Karte (1+3+N): Jetzt hier · Bestes Fenster
   heute · Frische Preise. Immer dieselben drei, immer dieselbe Reihenfolge;
   der Tankstand fehlt hier bewusst — er ist NAS-Sache (siehe RP2.md). */
.answer .facts {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px; margin-top: 12px;
}
.fact {
  border: 1px solid var(--border); border-radius: 12px;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  padding: 9px 11px; min-width: 0;
}
.fact .l { font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--dim); }
.fact .v { font-size: 17px; font-weight: 800; margin-top: 3px; line-height: 1.2; }
.fact .v small { font-size: 11px; color: var(--muted); font-weight: 700; }
.fact .d { font-size: 11px; color: var(--muted); margin-top: 2px; line-height: 1.35; }
.fresh-footer { font-size: 11.5px; color: var(--muted); margin: 10px 2px 0; font-weight: 700; }
.strip-note { font-size: 11.5px; color: var(--dim); margin: 10px 2px 0; }
.strip-summary { font-size: 12px; color: var(--muted); margin-top: 10px; display: flex; gap: 14px; flex-wrap: wrap; }
.strip-summary b { color: var(--text); }

/* ---------- Stations-Karten ---------------------------------------------- */
.st-grid { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 12px; }
@media (min-width: 700px) { .st-grid { grid-template-columns: 1fr 1fr; } }
.st {
  display: flex; align-items: center; gap: 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 14px; padding: 12px 12px 12px 10px;
  min-width: 0;
}
.st.best {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  background:
    radial-gradient(300px 120px at 0% 50%, var(--glow-emerald), transparent 70%),
    var(--panel-2);
}
.st.closed { opacity: 0.62; }
.rank {
  width: 30px; height: 30px; flex: none; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800;
  border: 1px solid var(--border); color: var(--muted); background: var(--panel);
  font-variant-numeric: tabular-nums;
}
.st.best .rank { background: var(--accent); border-color: var(--accent); color: #04150d; }
.st-main { flex: 1 1 auto; min-width: 0; }
.st-name {
  font-size: 14.5px; font-weight: 700; line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.st-meta .sep { opacity: 0.6; }
.fresh { color: var(--accent); font-weight: 700; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.stale { color: var(--warn); font-weight: 700; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.closed-tag { color: var(--dim); font-weight: 700; white-space: nowrap; }
.noprice-tag { color: var(--dim); font-style: italic; }
.st-price { text-align: right; flex: none; }
.st-price .p { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
.st-price .p small { font-size: 10.5px; color: var(--muted); font-weight: 700; }
.delta {
  display: inline-block; margin-top: 3px;
  font-size: 11px; font-weight: 800; border-radius: 6px; padding: 2px 6px;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.delta.best { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.delta.more { color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); }
.delta.zero { color: var(--dim); background: color-mix(in srgb, var(--muted) 10%, transparent); }
.st-nav {
  width: 44px; height: 44px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: 12px;
  background: var(--panel); color: var(--info);
}
.st-nav:hover { border-color: var(--info); }
.st-nav svg { width: 19px; height: 19px; }
.st.closed .st-nav { visibility: hidden; }

/* ---------- Prognose-Fenster (F3) ---------------------------------------- */
.win {
  display: flex; align-items: center; gap: 10px;
  background: var(--panel-2); border: 1px solid var(--border);
  border-radius: 12px; padding: 10px 12px; margin-top: 8px; min-width: 0;
}
.win .when { font-weight: 800; font-size: 13px; min-width: 116px; flex: none; }
.win .when small { display: block; font-weight: 600; color: var(--dim); font-size: 10.5px; }
.win .mid { color: var(--muted); font-size: 12.5px; flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.win .save { color: var(--accent); font-weight: 800; font-size: 13.5px; flex: none; font-variant-numeric: tabular-nums; }
.win .wstation { color: var(--dim); font-size: 11px; flex: none; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 460px) { .win .wstation { display: none; } }

/* ---------- Werkstatt ---------------------------------------------------- */
.spark-card {
  background: var(--panel-2); border: 1px solid var(--border);
  border-radius: 14px; padding: 12px 14px; margin-top: 10px; min-width: 0;
}
.spark-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.spark-head .nm { font-weight: 800; font-size: 13.5px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.spark-head .mv { color: var(--muted); font-size: 12px; margin-left: auto; white-space: nowrap; }
.spark-card svg { width: 100%; height: auto; display: block; margin-top: 8px; }
svg .axis { stroke: var(--border); stroke-width: 1; }
svg .grid-line { stroke: var(--border); stroke-width: 1; stroke-dasharray: 3 4; }
svg .band { fill: color-mix(in srgb, var(--accent) 15%, transparent); }
svg .median { stroke: var(--accent); stroke-width: 2; fill: none; }
svg .nowline { stroke: var(--warn); stroke-width: 1.5; stroke-dasharray: 5 4; fill: none; }
svg .curline { stroke: var(--info); stroke-width: 1.2; stroke-dasharray: 2 3; fill: none; }
svg text { fill: var(--muted); font-size: 10.5px; font-family: inherit; }
.kv { display: grid; grid-template-columns: 150px 1fr; gap: 6px 12px; font-size: 12.5px; margin: 0; padding: 0; }
.kv dt { color: var(--dim); font-weight: 700; margin: 0; }
.kv dd { margin: 0; color: var(--text); word-break: break-word; }
.raw-table-wrap { overflow-x: auto; margin-top: 12px; border: 1px solid var(--border); border-radius: 12px; }
table.raw { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 620px; }
table.raw th, table.raw td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
table.raw th { color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.6px; background: var(--panel-2); }
table.raw td.n, table.raw th.n { text-align: right; font-variant-numeric: tabular-nums; }
table.raw tr:last-child td { border-bottom: 0; }
table.raw td .st-name { white-space: nowrap; max-width: 260px; }

/* ---------- Banner, Sticky-Chip, Footer ---------------------------------- */
.banner {
  border-radius: 12px; border: 1px solid var(--border);
  background: var(--panel); padding: 10px 12px; margin-bottom: 12px;
  font-size: 12.5px; color: var(--muted);
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.banner.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
.banner.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); }
.sticky-chip {
  position: fixed; z-index: 50; right: 14px; bottom: 14px;
  display: inline-flex; align-items: center; gap: 8px;
  background: color-mix(in srgb, var(--panel) 94%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
  color: var(--text); border-radius: 999px;
  padding: 10px 16px; font-size: 12.5px; font-weight: 800;
  box-shadow: 0 12px 30px -10px rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  min-height: 44px;
  max-width: calc(100% - 28px);
}
.sticky-chip:hover { border-color: var(--accent); }
.sticky-chip .c-price { color: var(--accent); font-variant-numeric: tabular-nums; }
.sticky-chip svg { width: 15px; height: 15px; flex: none; }
.foot { margin-top: 26px; font-size: 12px; color: var(--dim); text-align: center; line-height: 1.6; }
.foot b { color: var(--muted); }
/* ---------- Desktop: Breite nutzen statt verschenken --------------------- */
/* Unterhalb 1100 px bleibt alles wie auf dem Handy (Leisten untereinander,
   Inhalt einspaltig). Ab 1100 px wird die Inhaltsspalte so breit wie in der
   NAS-GUI (max-w-7xl), Kopf- und Steuerleiste rücken in EINE Zeile (~60 px
   statt ~185 px) und der Alltag steht zweispaltig: links Antwort und
   Tagesverlauf, rechts Stationen und Prognosen. Die DOM-Reihenfolge bleibt
   1→4, die Kicker-Zahlen entfallen — sie sind eine Lesehilfe für die
   einspaltige Handy-Ansicht. */
@media (min-width: 1100px) {
  :root { --content: 1280px; }
}
@media (min-width: 1100px) {
  .stickies {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 8px max(var(--gutter), calc((100% - var(--content)) / 2));
  }
  .topbar, .controls { padding: 0; border-bottom: 0; }
  .topbar { flex: 0 0 auto; }
  .controls { flex: 1 1 340px; flex-direction: row; align-items: center; gap: 10px; }
  .seg.grow { flex: 0 0 auto; }
  .row { flex: 1 1 auto; }
}
@media (min-width: 1100px) {
  .cols {
    display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    gap: 14px; align-items: start;
  }
  .col { min-width: 0; }
  .col > .section-kicker:first-child { margin-top: 0; }
  .section-kicker .idx { display: none; }
  .st-grid { grid-template-columns: 1fr; }
  .sticky-chip { right: max(var(--gutter), calc((100% - var(--content)) / 2)); }
  #spark-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  #spark-grid .spark-card { margin-top: 0; }
}
.empty {
  border: 1px dashed var(--border); border-radius: 14px;
  padding: 18px 14px; color: var(--muted); font-size: 13px; text-align: center; margin-top: 12px;
}
.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--accent);
  animation: spin 0.8s linear infinite; display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>

<div class="stickies">
<header class="topbar">
  <div class="brand">TankApp <span class="mode-badge">FALLBACK · RP2</span></div>
  <div class="topbar-right">
    <button class="pill" id="nas-pill" type="button" title="NAS-Erreichbarkeit sofort neu prüfen">
      <span class="dot"></span><span class="pill-text" id="nas-text">NAS wird geprüft</span>
    </button>
    <span class="pill" id="price-pill" title="Stand der Preise im Puffer">
      <span class="dot"></span><span class="pill-text" id="price-text">Preise werden geladen</span>
    </span>
    <button class="icon-btn" id="theme-btn" type="button" title="Dark/Light wechseln" aria-label="Dark/Light wechseln"></button>
    <button class="icon-btn" id="refresh-btn" type="button" title="Jetzt aktualisieren" aria-label="Jetzt aktualisieren">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
    </button>
  </div>
</header>

<nav class="controls" aria-label="Filter und Ansicht">
  <div class="seg grow" id="fuel-tabs" role="tablist" aria-label="Kraftstoff">
    <button type="button" data-fuel="e10" class="active">E10</button>
    <button type="button" data-fuel="e5">E5</button>
    <button type="button" data-fuel="diesel">Diesel</button>
  </div>
  <div class="row">
    <label class="field">Ort
      <select id="city" aria-label="Ort auswählen">
        <option value="">Alle Orte</option>
      </select>
    </label>
    <label class="field">Tank
      <input id="liters" type="number" min="5" max="100" step="5" value="40" aria-label="Tankgröße in Liter"> L
    </label>
    <span class="spacer"></span>
    <div class="seg slim" id="view-tabs" role="tablist" aria-label="Ansicht">
      <button type="button" data-view="alltag" class="active">Alltag</button>
      <button type="button" data-view="werkstatt">Werkstatt</button>
    </div>
  </div>
</nav>
</div>

<main class="wrap">
  <section id="banner" class="banner warn hidden" role="status"></section>

  <!-- ============================== ALLTAG ============================== -->
  <div id="view-alltag">
    <div class="cols">
    <div class="col col-a">

    <p class="section-kicker"><span class="idx">1 · </span>Empfehlung</p>
    <section class="card answer" id="answer-card" aria-labelledby="answer-title">
      <div class="muted"><span class="spinner"></span> Lade …</div>
    </section>

    <p class="section-kicker"><span class="idx">2 · </span>Heute im Überblick</p>
    <section class="card" aria-labelledby="daystrip-title">
      <h2 id="daystrip-title">Tagesverlauf <span class="sub" id="daystrip-sub"></span></h2>
      <div class="daystrip" id="daystrip"></div>
      <div class="strip-summary" id="strip-summary"></div>
      <p class="strip-note">Grün = unteres Preisdrittel dieses Tages an dieser Station, rot = oberes Drittel. Leere Stunden hatten keine offene Meldung — nichts wird erfunden.</p>
    </section>

    </div>
    <div class="col col-b">

    <p class="section-kicker"><span class="idx">3 · </span>Stationen</p>
    <section class="card" aria-labelledby="stations-title">
      <div class="row">
        <h2 id="stations-title">Stationen <span class="sub" id="stations-sub"></span></h2>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="seg slim" id="sort-tabs" role="tablist" aria-label="Sortierung">
          <button type="button" data-sort="price" class="active">Preis</button>
          <button type="button" data-sort="near">Nähe</button>
          <button type="button" data-sort="fresh">Aktuell</button>
        </div>
        <span class="muted" style="font-size:11.5px">Sortierung wirkt auf die Liste, nicht auf die Empfehlung.</span>
      </div>
      <div class="st-grid" id="st-grid"><div class="muted"><span class="spinner"></span> Lade …</div></div>
    </section>

    <p class="section-kicker"><span class="idx">4 · </span>Nächste 24 h</p>
    <section class="card" aria-labelledby="forecast-title">
      <h2 id="forecast-title">Prognosen <span class="sub" id="forecast-sub"></span></h2>
      <div id="forecast-body"><div class="muted"><span class="spinner"></span> Lade …</div></div>
    </section>
    </div>
    </div>
  </div>

  <!-- ============================= WERKSTATT ============================= -->
  <div id="view-werkstatt" class="hidden">

    <p class="section-kicker">Quantile · nächste 24 h (gecacht)</p>
    <section class="card" aria-labelledby="spark-title">
      <h2 id="spark-title">Prognose-Verläufe <span class="sub" id="spark-sub">Band = q025–q975 · Linie = Median · blau gestrichelt = aktueller Preis · gelb gestrichelt = jetzt</span></h2>
      <div id="spark-grid"></div>
    </section>

    <p class="section-kicker">Rohdaten</p>
    <section class="card" aria-labelledby="raw-title">
      <h2 id="raw-title">Alle Stationen, alle Treibstoffe</h2>
      <div class="raw-table-wrap">
        <table class="raw">
          <thead>
            <tr><th>Station</th><th class="n">E5</th><th class="n">E10</th><th class="n">Diesel</th><th>Meldung</th><th>Alter</th><th>Status</th></tr>
          </thead>
          <tbody id="raw-body"><tr><td colspan="7" class="muted"><span class="spinner"></span> Lade …</td></tr></tbody>
        </table>
      </div>
    </section>

    <p class="section-kicker">Datenstatus</p>
    <section class="card" aria-labelledby="status-title">
      <h2 id="status-title">Woher die Daten kommen</h2>
      <dl class="kv" id="status-list"></dl>
    </section>
  </div>

  <footer class="foot">
    <p>Diese Adresse läuft auf dem <b>RP2</b>. Wenn das <b>NAS online</b> ist, zeigt sie automatisch
    die vollwertige TankApp-GUI. Im Fallback-Modus kommen die Live-Preise direkt aus dem
    Collector-Puffer; Prognosen sind gecacht und bis zu 24 h alt.</p>
    <p>F1 „Jetzt oder warten“ · F2 „Hier oder woanders“ · F3 „Heute oder später“ —
    Preis-Score = historisches Quantil (q025–q975), keine kalibrierte Wahrscheinlichkeit
    (die liefert ausschließlich das NAS, M7) · Auto-Refresh alle 60 s.</p>
  </footer>
</main>

<button class="sticky-chip hidden" id="sticky-chip" type="button" title="Zur Antwort-Karte">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
  <span id="sticky-chip-txt"></span>
</button>

<script>
"use strict";
// G4: wird beim Rendern aus CACHE_REBOOT_HINT eingesetzt (JSON-String).
const REBOOT_HINT = __CACHE_REBOOT_HINT_JSON__;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
const FUELS = ["e10", "e5", "diesel"];
const FUEL_LABEL = { e10: "E10", e5: "E5", diesel: "Diesel" };
const SORTS = ["price", "near", "fresh"];
const TZ = "Europe/Berlin";
const DOT = '<span class="dot"></span>';
const LS = {
  get(k, d) {
    try {
      const raw = localStorage.getItem("tankapp." + k);
      if (raw === null || raw === undefined) return d;
      const v = JSON.parse(raw);
      return v === null || v === undefined ? d : v;
    } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem("tankapp." + k, JSON.stringify(v)); } catch {} },
};
function savedFuel() {
  const f = LS.get("fuel", "e10");
  return FUELS.includes(f) ? f : "e10";
}
function savedSort() {
  const s = LS.get("sort", "price");
  return SORTS.includes(s) ? s : "price";
}
const state = {
  fuel: savedFuel(),
  city: String(LS.get("city", "") || ""),
  liters: Math.max(5, Math.min(100, Number(LS.get("liters", 40)) || 40)),
  view: LS.get("view", "alltag") === "werkstatt" ? "werkstatt" : "alltag",
  sort: savedSort(),
};
let lastPayload = null;
let answerVisible = true;
let refreshTimer = null;
let inFlight = false;

/* ------------------------------ Formatierung ----------------------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function isNum(x) { return typeof x === "number" && Number.isFinite(x); }
function eur(x, d = 3) {
  return isNum(x) ? x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
}
function ct(x) {
  return isNum(x) ? x.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " ct" : "—";
}
function ctOf(delta) { return ct(Math.round(delta * 1000) / 10); }
function eurTank(x) {
  return isNum(x) ? x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : "—";
}
function pct(x) { return isNum(x) ? Math.round(x * 100) + " %" : "—"; }
function ageLabel(minutes) {
  if (!isNum(minutes)) return "—";
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return Math.round(minutes) + " min";
  const h = Math.floor(minutes / 60);
  return h + " h " + Math.round(minutes % 60) + " min";
}
/* Minuten seit einem Zeitstempel — null, wenn er fehlt oder unlesbar ist. */
function minutesSince(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, (Date.now() - ms) / 60000) : null;
}
function clockOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}
function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("sv-SE", { timeZone: TZ });
}
function relDay(iso) {
  const key = dayKey(iso);
  if (!key) return "—";
  const today = dayKey(new Date().toISOString());
  const diff = Math.round((Date.parse(key + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86400000);
  if (diff === 0) return "heute " + clockOf(iso);
  if (diff === 1) return "morgen " + clockOf(iso);
  return shortStamp(iso);
}
/* Nur der Tag, ohne Zeit: „heute“ / „morgen“ / „15.09.“ — für Labels, die
   den Fenster-Zeitpunkt benennen sollen (B7: „Bestes Fenster heute“ darf
   nicht auf morgen zeigen). */
function dayWord(iso) {
  const key = dayKey(iso);
  if (!key) return "";
  const today = dayKey(new Date().toISOString());
  const diff = Math.round((Date.parse(key + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86400000);
  if (diff === 0) return "heute";
  if (diff === 1) return "morgen";
  return key.slice(8, 10) + "." + key.slice(5, 7) + ".";
}
function shortStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: TZ }) + ", " + clockOf(iso);
}
function shortName(name) {
  const words = String(name ?? "").split(" ").filter(Boolean);
  return words.length > 3 ? words.slice(0, 3).join(" ") + " …" : String(name ?? "");
}
function statusLabel(status) {
  if (status === "open") return "offen";
  if (status === "closed") return "geschlossen";
  return "keine Preise";
}
function ageHtml(s) {
  if (s.status !== "open") return '<span class="closed-tag">' + esc(statusLabel(s.status)) + "</span>";
  const title = ' title="Meldung ' + clockOf(s.fetched_at) + ' Uhr"';
  return s.fresh
    ? '<span class="fresh"' + title + ">" + DOT + ageLabel(s.age_minutes) + "</span>"
    : '<span class="stale"' + title + ">" + DOT + ageLabel(s.age_minutes) + " alt</span>";
}

/* --------------------------------- Icons --------------------------------- */
const ICONS = {
  fuel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 22V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v17M3 22h10M13 9h2.5a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V9.8a2 2 0 0 0-.59-1.42L18 6"/><path d="M5 6h6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  nav: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l19-8-8 19-2.5-8.5L3 11z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  window: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3l4 4-4 4M21 7H7M7 21l-4-4 4-4M3 17h14"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};

/* ------------------------------ Theme ------------------------------------ */
function applyTheme(t) {
  document.documentElement.classList.toggle("light", t === "light");
  $("#theme-btn").innerHTML = t === "light" ? ICONS.moon : ICONS.sun;
  LS.set("theme", t);
}
(function initTheme() {
  const system = window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(LS.get("theme", system));
  $("#theme-btn").addEventListener("click", () => {
    applyTheme(document.documentElement.classList.contains("light") ? "dark" : "light");
  });
})();

/* ------------------------------- Daten ----------------------------------- */
async function j(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const err = new Error("HTTP " + r.status);
    err.status = r.status;
    throw err;
  }
  return r.json();
}
function banner(msg, bad) {
  const el = $("#banner");
  if (!msg) { el.classList.add("hidden"); el.textContent = ""; return; }
  el.classList.remove("hidden");
  el.classList.toggle("bad", !!bad);
  el.textContent = msg;
}
function query() {
  return "?fuel=" + encodeURIComponent(state.fuel) +
    "&city=" + encodeURIComponent(state.city) +
    "&liters=" + state.liters;
}
async function refresh() {
  if (inFlight) return;
  inFlight = true;
  try {
    const q = query();
    const [health, stations, forecasts, decide] = await Promise.all([
      j("/api/v1/health"),
      j("/api/v1/stations" + q),
      j("/api/v1/forecasts" + q).catch(() => null),
      j("/api/v1/decide" + q).catch(() => null),
    ]);
    // Tagesstreifen: nur die eine Station, die die Empfehlung nennt.
    const cheapest = decide && decide.available && decide.f2 ? decide.f2.station.station_id : null;
    const series = cheapest
      ? await j("/api/v1/series?station=" + encodeURIComponent(cheapest) + "&fuel=" + encodeURIComponent(state.fuel)).catch(() => null)
      : null;
    lastPayload = { health, stations, forecasts, decide, series };
    banner(null);
    renderAll(lastPayload);
  } catch (e) {
    banner("Daten konnten nicht geladen werden (" + e.message + ") — die Anzeige bleibt stehen, der nächste Versuch läuft automatisch.", true);
  } finally {
    inFlight = false;
  }
}

/* ------------------------------ Rendering -------------------------------- */
function renderAll(p) {
  renderHeader(p.health);
  renderAnswer(p.decide, p.stations, p.health);
  renderDaystrip(p.series, p.decide, p.health);
  renderStations(p.stations, p.decide);
  renderForecast(p.decide, p.forecasts);
  renderWerkstatt(p.forecasts, p.stations, p.health);
  updateChip();
}

function renderHeader(health) {
  const h = health || {};
  const nas = h.nas || {};
  const nasPill = $("#nas-pill");
  if (!nas.configured) {
    nasPill.className = "pill bad";
    nasPill.title = "NAS nicht konfiguriert — diese Adresse läuft dauerhaft im Fallback-Modus.";
    $("#nas-text").textContent = "NAS nicht konfiguriert";
  } else if (nas.online) {
    nasPill.className = "pill ok";
    nasPill.title = "NAS erreichbar — neu laden zeigt die vollwertige NAS-GUI. Klick prüft sofort neu.";
    $("#nas-text").textContent = "NAS online";
  } else {
    nasPill.className = "pill bad";
    nasPill.title = "NAS nicht erreichbar" + (nas.error ? " (" + nas.error + ")" : "") + " — Fallback-Modus. Klick prüft sofort neu.";
    $("#nas-text").textContent = "NAS offline";
  }
  const p = h.prices || {};
  const pricePill = $("#price-pill");
  if (!p.available) {
    pricePill.className = "pill bad";
    pricePill.title = "Keine Preismeldung im Puffer — der Collector hat noch nichts geschrieben.";
    $("#price-text").textContent = "keine Preise";
  } else {
    const age = isNum(p.age_minutes) ? p.age_minutes : null;
    const tone = age === null ? "" : age > 60 ? "bad" : age > 15 ? "warn" : "ok";
    pricePill.className = "pill " + tone;
    pricePill.title = "Neueste Preismeldung " + ageLabel(age) + " alt · " + (p.open || 0) + " von " + (p.stations || 0) + " Stationen offen (alle 5 min neuer Poll).";
    $("#price-text").textContent = "Preise " + ageLabel(age) + " alt";
  }
  const cityOptions = Array.isArray(h.city_options) && h.city_options.length
    ? h.city_options.map((entry) => ({
        value: String(entry.value || entry.label || ""),
        label: String(entry.label || entry.value || "")
      })).filter((entry) => entry.value)
    : (Array.isArray(h.cities) ? h.cities.map((city) => ({ value: String(city), label: String(city) })) : []);
  if (!cityOptions.some((entry) => entry.value === state.city)) state.city = "";
  const citySelect = $("#city");
  citySelect.innerHTML = '<option value="">Alle Orte</option>' + cityOptions.map((entry) => {
    const text = entry.label && entry.label !== entry.value ? entry.value + " · " + entry.label : entry.value;
    return '<option value="' + esc(entry.value) + '">' + esc(text) + "</option>";
  }).join("");
  citySelect.value = state.city;
}

function kickerText(health) {
  const stamp = health && health.generated_at ? clockOf(health.generated_at) : clockOf(new Date().toISOString());
  return FUEL_LABEL[state.fuel].toUpperCase() + " · " + (state.city || "ALLE ORTE").toUpperCase() + " · STAND " + stamp + " UHR";
}
function standText(iso) {
  return iso ? "Stand " + clockOf(iso) + " Uhr" : "Stand —";
}

function renderAnswer(decide, stations, health) {
  const el = $("#answer-card");
  const rows = (stations && stations.stations) || [];
  const kicker = '<div class="kicker">' + esc(kickerText(health)) + "</div>";
  if (!decide || !decide.available) {
    const reason = decide && decide.error
      ? decide.error
      : "Keine offenen Stationen mit " + FUEL_LABEL[state.fuel] + "-Preisen im Puffer.";
    el.className = "card answer";
    el.innerHTML = kicker +
      '<div class="verdict"><span class="verdict-icon">' + ICONS.fuel + "</span>" +
      '<div style="min-width:0"><div class="verdict-text" id="answer-title">Noch kein frischer Preis.</div>' +
      '<div class="verdict-reason">' + esc(reason) +
      " Der Status oben zeigt, wo es hängt — sobald der Collector meldet, steht hier die Empfehlung.</div></div></div>";
    return;
  }
  const f2 = decide.f2;
  const s = f2.station || {};
  const live = rows.find((x) => x.station_id === s.station_id) || {};
  const f1 = decide.f1 || {};
  const fc = decide.forecast || {};
  const waiting = !!f1.available && f1.recommendation === "wait";
  // B8: Ohne frische Meldung im Set ist der Preisvergleich nur eine
  // Momentaufnahme — die Antwort kippt von „Empfehlung“ auf „Zustand“.
  const staleSet = isNum(f2.fresh_in_set) && f2.fresh_in_set === 0;
  let verdict, reason, icon;
  if (staleSet) {
    icon = ICONS.clock;
    verdict = "Preis-Momentaufnahme — kein frischer Report im Set";
    reason = "Alle Preismeldungen im Set sind veraltet (älteste: " +
      ageLabel(f2.oldest_age_minutes) + ") — bis der Collector wieder meldet" +
      " ist das nur ein Preisvergleich, keine Empfehlung." +
      (f1.reason ? " " + esc(f1.reason) : "");
  } else if (waiting) {
    icon = ICONS.clock;
    verdict = "Bis " + esc(relDay(f1.best_at)) + " Uhr warten lohnt sich";
    reason = esc(f1.reason || "");
  } else if (f1.available) {
    icon = ICONS.fuel;
    verdict = "Jetzt tanken";
    reason = esc(f1.reason || "");
  } else {
    icon = ICONS.fuel;
    verdict = "Aktueller Preisvergleich";
    reason = "Keine Prognose für die günstigste Station" +
      (fc.generated_at ? " (Cache von " + esc(shortStamp(fc.generated_at)) + ")" : "") +
      " — ohne sie gibt es keinen belastbaren Grund zu warten. Nimm die günstigste frische Station." +
      " " + esc(REBOOT_HINT);
  }
  const vsLabel = f2.saving_vs === "second" && f2.second_name
    ? "gegen " + esc(f2.second_name) + " (2. günstigste)"
    : "gegen die teuerste im Set";
  const route = s.maps_url
    ? '<div class="actions"><a class="btn primary" href="' + esc(s.maps_url) + '" target="_blank" rel="noopener">' + ICONS.pin + "Route öffnen</a></div>"
    : "";
  const waitWindow = (decide.windows || [])[0];
  /* Frische-Fußzeile: Alter der Preismeldung und des Modell-Laufs, in Worten —
     dieselbe Aussage wie in der NAS-GUI („Preise 4 min alt · Prognose 35 min alt“). */
  const priceAge = isNum(live.age_minutes) ? ageLabel(live.age_minutes) : "—";
  const forecastAge = isNum(minutesSince(fc.generated_at)) ? ageLabel(minutesSince(fc.generated_at)) : "—";
  // B9: „Frische Preise“ zählt nur Stationen, die auch einen Preis für den
  // gewählten Kraftstoff melden — eine frische Meldung ohne Diesel-Preis
  // zählt in der Diesel-Ansicht nicht mit.
  const freshCount = rows.filter((row) => row.fresh && isNum(row.price)).length;
  const waitChip = waitWindow
    ? '<span class="chip info">' + ICONS.window + '<span class="chip-txt">„Jetzt oder warten“: ' +
      esc(relDay(waitWindow.at)) + " · ~" + eur(waitWindow.q50) + " €/L · −" +
      eurTank((waitWindow.expected_saving_ct_per_l / 100) * state.liters) + "</span></span>"
    : "";
  const secondChip = f2.second_name
    ? '<span class="chip">' + ICONS.swap + '<span class="chip-txt">„Hier oder woanders“: 2. = ' +
      esc(f2.second_name) + " · " + eur(f2.second_price) + " €/L</span></span>"
    : "";
  // B8: Ein veraltetes Set trägt nicht den „warten“-Look.
  el.className = "card answer" + (staleSet ? "" : waiting ? " waiting" : "");
  el.innerHTML = kicker +
    '<div class="verdict"><span class="verdict-icon">' + icon + "</span>" +
    '<div style="min-width:0"><div class="verdict-text" id="answer-title">' +
    '<span class="' + (waiting ? "tint-wait" : "tint-now") + '">' + verdict + "</span></div>" +
    '<div class="verdict-reason">' + reason + "</div></div></div>" +
    '<div class="price-line"><span class="price num">' + eur(f2.price) + " <small>€/L</small></span></div>" +
    '<div class="station-block"><div class="station-name" title="' + esc(s.name) + '">' + esc(s.name) + "</div>" +
    '<div class="station-meta">' +
      (s.brand ? '<span class="tag brand">' + esc(s.brand) + "</span>" : "") +
      (s.city ? '<span class="tag">' + esc(s.city) + "</span>" : "") +
      (isNum(live.drive_min) ? "<span>≈ " + Math.round(live.drive_min) + " min Fahrt</span>" : "") +
      (live.station_id ? ageHtml(live) : "") +
    "</div></div>" +
    '<div class="savings-line">spart ' + ct(f2.saving_ct_per_l) + "/L · " + eurTank(f2.saving_eur_tank) +
      " pro " + state.liters + ' L-Tank <span class="vs">' + vsLabel + "</span></div>" +
    route +
    '<div class="chips">' + waitChip + secondChip + "</div>" +
    '<div class="facts">' +
      '<div class="fact"><div class="l">Jetzt hier</div>' +
        '<div class="v">' + eur(f2.price) + ' <small>€/L</small></div>' +
        '<div class="d">' + esc(shortName(s.name)) + "</div></div>" +
      // B7: Das Fenster kommt aus den nächsten 24 h und kann morgen liegen —
      // dann heißt das Label auch „morgen“ (oder Datum), nicht „heute“.
      '<div class="fact"><div class="l">Bestes Fenster ' + (waitWindow ? dayWord(waitWindow.at) || "heute" : "heute") + "</div>" +
        '<div class="v">' + (waitWindow ? clockOf(waitWindow.at) : "—") + "</div>" +
        '<div class="d">' + (waitWindow ? "~" + eur(waitWindow.q50) + " €/L" : "kein Fenster mit Vorsprung") + "</div></div>" +
      '<div class="fact"><div class="l">Frische Preise</div>' +
        '<div class="v">' + freshCount + "</div>" +
        '<div class="d">von ' + rows.length + " Stationen im Set</div></div>" +
    "</div>" +
    '<p class="fresh-footer">Preise ' + priceAge + " alt · Prognose " + forecastAge + " alt</p>" +
    '<p class="strip-note">Preis-Score = historisches Quantil (q025–q975), keine kalibrierte Wahrscheinlichkeit — die rechnet ausschließlich das NAS (M7).</p>';
}

function renderDaystrip(series, decide, health) {
  const strip = $("#daystrip");
  const sub = $("#daystrip-sub");
  const summary = $("#strip-summary");
  const hours = series && Array.isArray(series.hours) ? series.hours : [];
  const name = decide && decide.available ? decide.f2.station.name : "";
  const known = hours.filter((h) => isNum(h.value));
  if (!hours.length) {
    sub.textContent = "";
    strip.innerHTML = "";
    summary.innerHTML = "";
    return;
  }
  sub.textContent = "· " + (name ? name + " · " : "") + FUEL_LABEL[state.fuel] + " · heute" +
    (series.day ? " (" + series.day + ")" : "");
  if (!known.length) {
    strip.innerHTML = '<div class="empty" style="grid-column:1/-1">Heute liegt noch keine offene Meldung für ' +
      esc(FUEL_LABEL[state.fuel]) + " an dieser Station vor — das Polling-Fenster ist 06–24 Uhr.</div>";
    summary.innerHTML = "";
    return;
  }
  const lo = Math.min.apply(null, known.map((h) => h.value));
  const hi = Math.max.apply(null, known.map((h) => h.value));
  const third = (hi - lo) / 3;
  const nowHour = series.now && series.now.at ? series.now.at.slice(0, 2) : "";
  strip.innerHTML = hours.map((h) => {
    const label = h.hour + ":00";
    if (!isNum(h.value)) {
      // M8: Werte nicht nur per Hover — jede Zelle ist für Screenreader
      // ein beschriftetes Bild (wie in der NAS-GUI).
      const emptyTitle = label + " — keine offene Meldung";
      return '<div class=\"cell none\" role=\"img\" aria-label=\"' + emptyTitle + '\" title=\"' + emptyTitle + '\"><div class=\"h\">' + label + '</div><div class=\"v\">–</div></div>';
    }
    const tone = h.value <= lo + third ? "cheap" : h.value >= hi - third ? "pricey" : "";
    const isNow = h.hour === nowHour;
    const title = label + " — " + eur(h.value) + " €/L" + (h.at ? " (Meldung " + clockOf(h.at) + " Uhr)" : "");
    return '<div class=\"cell ' + tone + (isNow ? \" now\" : \"\") + '\" role=\"img\" aria-label=\"' + title + '\" title=\"' + title + '\">' +
      '<div class="h">' + label + (isNow ? " · jetzt" : "") + "</div>" +
      '<div class="v">' + eur(h.value) + "</div></div>";
  }).join("");
  const now = series.now || series.max;
  const low = series.min || now;
  const high = series.max || now;
  const vsLow = now && low && isNum(now.value) && isNum(low.value) && now.value > low.value
    ? " · +" + ctOf(now.value - low.value) + " über dem Tief"
    : " · Tages-Tief";
  summary.innerHTML =
    "<span>Tages-Tief <b class='num'>" + eur(low && low.value) + " €</b> (" + esc((low && low.at) || "—") + " Uhr)</span>" +
    "<span>jetzt <b class='num'>" + eur(now && now.value) + " €</b>" + vsLow + "</span>" +
    "<span>Tages-Hoch <b class='num'>" + eur(high && high.value) + " €</b></span>" +
    "<span>" + esc(standText(health && health.generated_at)) + "</span>";
}

function renderStations(stations, decide) {
  const grid = $("#st-grid");
  const sub = $("#stations-sub");
  const rows = (stations && stations.stations ? stations.stations : []).slice();
  const fuel = state.fuel;
  const num = (v) => (isNum(v) ? v : Number.POSITIVE_INFINITY);
  const priced = rows.filter((s) => s.status === "open" && isNum(s.price));
  const bestId = decide && decide.available ? decide.f2.station.station_id : null;
  const base = bestId ? (rows.find((s) => s.station_id === bestId) || {}).price : null;
  const basePrice = isNum(base) ? base : (priced.length ? Math.min.apply(null, priced.map((s) => s.price)) : null);
  sub.textContent = rows.length
    ? "· " + rows.length + " Stationen · " + priced.length + " mit " + FUEL_LABEL[fuel] + "-Preis"
    : "";
  if (!rows.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Keine Stationen im Puffer — Collector laufen lassen.</div>';
    return;
  }
  if (state.sort === "price") {
    rows.sort((a, b) => (num(a.price) - num(b.price)) || a.name.localeCompare(b.name, "de"));
  } else if (state.sort === "near") {
    rows.sort((a, b) => (num(a.drive_min) - num(b.drive_min)) || (num(a.price) - num(b.price)));
  } else {
    rows.sort((a, b) => (num(a.age_minutes) - num(b.age_minutes)) || (num(a.price) - num(b.price)));
  }
  let rank = 0;
  grid.innerHTML = rows.map((s) => {
    const hasPrice = s.status === "open" && isNum(s.price);
    if (hasPrice) rank += 1;
    const closed = s.status !== "open";
    const isBest = hasPrice && (bestId ? s.station_id === bestId : rank === 1);
    const delta = hasPrice && isNum(basePrice) ? Math.round((s.price - basePrice) * 1000) / 10 : null;
    let deltaHtml = "";
    if (isBest) deltaHtml = '<span class="delta best">beste</span>';
    else if (delta !== null) deltaHtml = '<span class="delta ' + (delta > 0 ? "more" : "zero") + '">' +
      (delta > 0 ? "+" : "−") + ct(Math.abs(delta)) + "</span>";
    const meta = [
      s.brand ? '<span class="tag brand">' + esc(s.brand) + "</span>" : "",
      s.city ? "<span>" + esc(s.city) + "</span>" : "",
      isNum(s.drive_min) ? "<span>≈ " + Math.round(s.drive_min) + " min</span>" : "",
      ageHtml(s),
      !hasPrice && !closed ? '<span class="noprice-tag">' + esc(FUEL_LABEL[fuel]) + " nicht geführt</span>" : "",
    ].filter(Boolean).join('<span class="sep">·</span>');
    const nav = hasPrice && s.maps_url
      ? '<a class="st-nav" href="' + esc(s.maps_url) + '" target="_blank" rel="noopener" title="Route zu ' + esc(s.name) + '" aria-label="Route zu ' + esc(s.name) + '">' + ICONS.nav + "</a>"
      : '<span class="st-nav" aria-hidden="true">' + ICONS.nav + "</span>";
    return '<div class="st' + (isBest ? " best" : "") + (closed ? " closed" : "") + '">' +
      '<span class="rank" aria-hidden="true">' + (hasPrice ? rank : "·") + "</span>" +
      '<div class="st-main"><div class="st-name" title="' + esc(s.name) + '">' + esc(s.name) + "</div>" +
      '<div class="st-meta">' + meta + "</div></div>" +
      '<div class="st-price"><div class="p">' + (hasPrice ? eur(s.price) + " <small>€/L</small>" : "—") + "</div>" + deltaHtml + "</div>" +
      nav + "</div>";
  }).join("");
}

function renderForecast(decide, forecasts) {
  const sub = $("#forecast-sub");
  const body = $("#forecast-body");
  const fc = (decide && decide.forecast) || {};
  const windows = decide && Array.isArray(decide.windows) ? decide.windows : [];
  const name = decide && decide.available ? decide.f2.station.name : "";
  if (forecasts && forecasts.generated_at) {
    sub.textContent = "· Cache vom " + shortStamp(forecasts.generated_at) +
      (isNum(fc.age_hours) ? " (" + fc.age_hours + " h alt)" : "") +
      " · Basis: " + (fc.station || name || "günstigste Station");
  } else {
    sub.textContent = "· kein Prognose-Cache";
  }
  if (!decide || !decide.available) {
    body.innerHTML = '<div class="empty">Keine Prognose möglich, solange keine offenen Stationen mit Preis im Puffer sind.</div>';
    return;
  }
  if (!windows.length) {
    body.innerHTML = '<div class="empty">Keine gecachten Prognosen für ' + esc(FUEL_LABEL[state.fuel]) +
      " vorhanden. Sobald das NAS wieder läuft, füllt cache_forecasts.py den Cache (alle 5 min). " +
      esc(REBOOT_HINT) + "<br>„Jetzt ist die günstigste Station?“ (F2) funktioniert trotzdem.</div>";
    return;
  }
  let html = "";
  for (const w of windows) {
    html += '<div class="win">' +
      '<span class="when">' + esc(relDay(w.at)) + " Uhr<small>Preis-Score " + pct(w.price_score) + "</small></span>" +
      '<span class="mid">erwartet ~' + eur(w.q50) + " €/L</span>" +
      '<span class="save">−' + eurTank((w.expected_saving_ct_per_l / 100) * state.liters) + "</span>" +
      '<span class="wstation" title="' + esc(name) + '">' + esc(name) + "</span>" +
      "</div>";
  }
  html += '<p class="strip-note">Ersparnis pro ' + state.liters +
    " L-Tank. Preis-Score = Gleichverteilung zwischen q025/q975 — keine kalibrierte " +
    "Wahrscheinlichkeit; die exakte M7-Rechnung läuft auf dem NAS.</p>";
  body.innerHTML = html;
}

function renderWerkstatt(forecasts, stations, health) {
  const sparkSub = $("#spark-sub");
  const grid = $("#spark-grid");
  const entries = forecasts && forecasts.available && Array.isArray(forecasts.forecasts) ? forecasts.forecasts : [];
  if (forecasts && forecasts.generated_at) {
    sparkSub.textContent = "· Cache vom " + shortStamp(forecasts.generated_at) +
      (isNum(forecasts.age_hours) ? " (" + forecasts.age_hours + " h alt)" : "") +
      " · Band = q025–q975 · Linie = Median";
  } else {
    sparkSub.textContent = "· kein Cache · Band = q025–q975 · Linie = Median";
  }
  if (!entries.length) {
    grid.innerHTML = '<div class="empty">Kein Prognose-Cache vorhanden — Sparklines fehlen bis zum nächsten NAS-Lauf. ' + esc(REBOOT_HINT) + "</div>";
  } else if (!entries.some((e) => e.summary)) {
    grid.innerHTML = '<div class="empty">Prognose-Cache ist vorhanden, aber älter als 24 h — keine zukünftigen Punkte mehr. Er aktualisiert sich beim nächsten NAS-Lauf.</div>';
  } else {
    grid.innerHTML = entries.map((e) => sparkCard(e)).join("");
  }
  renderRawTable(stations);
  renderStatus(health);
}

function sparkCard(e) {
  const sum = e.summary || {};
  const range = isNum(sum.min_q50) && isNum(sum.max_q50)
    ? "24-h-Band " + eur(sum.min_q50) + "–" + eur(sum.max_q50) + " €"
    : "";
  const best = sum.best ? "günstigster Moment " + relDay(sum.best.at) + " (~" + eur(sum.best.q50) + " €)" : "";
  const meta = [e.city ? esc(e.city) : "", range ? esc(range) : "", best ? esc(best) : ""].filter(Boolean).join(" · ");
  return '<div class="spark-card"><div class="spark-head">' +
    '<span class="nm" title="' + esc(e.name) + '">' + esc(e.name) + "</span>" +
    (e.brand ? '<span class="tag brand">' + esc(e.brand) + "</span>" : "") +
    '<span class="mv num">' + (isNum(e.current_price) ? "jetzt " + eur(e.current_price) + " €" : "kein Live-Preis") + "</span>" +
    "</div>" +
    (meta ? '<div class="st-meta">' + meta + "</div>" : "") +
    sparkline(e) + "</div>";
}

/* --------------------------- Prognose-Sparklines -------------------------- */
function sparkline(entry) {
  const pts = (entry.points || [])
    .map((p) => ({ t: new Date(p.timestamp).getTime(), lo: p.q025, mid: p.q50, hi: p.q975 }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.mid))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return "";
  const now = Date.now();
  const t0 = Math.min(now, pts[0].t);
  const t1 = pts[pts.length - 1].t;
  if (!(t1 > t0)) return "";
  let lo = Math.min.apply(null, pts.map((p) => (Number.isFinite(p.lo) ? p.lo : p.mid)));
  let hi = Math.max.apply(null, pts.map((p) => (Number.isFinite(p.hi) ? p.hi : p.mid)));
  if (isNum(entry.current_price)) {
    lo = Math.min(lo, entry.current_price);
    hi = Math.max(hi, entry.current_price);
  }
  const padY = (hi - lo) * 0.18 || 0.005;
  lo -= padY; hi += padY;
  const W = 560, H = 150, pad = { l: 52, r: 10, t: 10, b: 24 };
  const X = (t) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = (key) => pts.map((p, i) => (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p[key]).toFixed(1)).join(" ");
  const band =
    pts.map((p, i) => (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p.hi).toFixed(1)).join(" ") + " " +
    pts.slice().reverse().map((p) => "L" + X(p.t).toFixed(1) + " " + Y(p.lo).toFixed(1)).join(" ") + " Z";
  let grid = "";
  for (const frac of [0, 0.5, 1]) {
    const v = lo + (hi - lo) * frac;
    const y = Y(v);
    grid += '<line class="grid-line" x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '"/>' +
      '<text x="' + (pad.l - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + eur(v, 2) + "</text>";
  }
  const ticks = [];
  const stepMs = 6 * 3600000;
  for (let t = Math.ceil(t0 / stepMs) * stepMs; t <= t1; t += stepMs) ticks.push(t);
  let axes = "";
  for (const t of ticks) {
    const x = X(t);
    const label = new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
    axes += '<line class="axis" x1="' + x.toFixed(1) + '" y1="' + (pad.t + H - pad.b) + '" x2="' + x.toFixed(1) + '" y2="' + (H - 14) + '"/>' +
      '<text x="' + x.toFixed(1) + '" y="' + (H - 3) + '" text-anchor="middle">' + label + "</text>";
  }
  let marks = "";
  if (now >= t0 && now <= t1) {
    const x = X(now);
    marks += '<line class="nowline" x1="' + x.toFixed(1) + '" y1="' + pad.t + '" x2="' + x.toFixed(1) + '" y2="' + (H - pad.b) + '"/>' +
      '<text x="' + (x + 4).toFixed(1) + '" y="' + (pad.t + 9).toFixed(1) + '">jetzt</text>';
  }
  if (isNum(entry.current_price)) {
    const y = Y(entry.current_price);
    marks += '<line class="curline" x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '"/>' +
      '<text x="' + (W - pad.r) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="end">aktuell ' + eur(entry.current_price) + "</text>";
  }
  return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Prognose ' + esc(entry.name) + '">' +
    grid + axes + '<path class="band" d="' + band + '"/>' +
    '<path class="median" d="' + line("mid") + '"/>' + marks + "</svg>";
}

function renderRawTable(stations) {
  const body = $("#raw-body");
  const rows = (stations && stations.stations) || [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted">Keine Stationen im Puffer — Collector laufen lassen.</td></tr>';
    return;
  }
  const cell = (s, fuel) => (isNum(s[fuel]) ? eur(s[fuel]) : "—");
  body.innerHTML = rows.map((s) => {
    const status = s.status === "open"
      ? '<span class="fresh">' + DOT + "offen</span>"
      : '<span class="closed-tag" title="API-Status: ' + esc(s.status) + '">' + esc(statusLabel(s.status)) + "</span>";
    return "<tr><td><div class='st-name' title='" + esc(s.name) + "'>" + esc(s.name) + "</div></td>" +
      "<td class='n'>" + cell(s, "e5") + "</td>" +
      "<td class='n'>" + cell(s, "e10") + "</td>" +
      "<td class='n'>" + cell(s, "diesel") + "</td>" +
      "<td>" + clockOf(s.fetched_at) + " Uhr</td>" +
      "<td>" + ageLabel(s.age_minutes) + (s.fresh ? "" : " alt") + "</td>" +
      "<td>" + status + "</td></tr>";
  }).join("");
}

function renderStatus(health) {
  const el = $("#status-list");
  const h = health || {};
  const p = h.prices || {};
  const f = h.forecasts || {};
  const nas = h.nas || {};
  const rows = [];
  rows.push(["Preis-Puffer", p.available
    ? (p.stations || 0) + " Stationen · " + (p.open || 0) + " offen · neueste Meldung " +
      ageLabel(p.age_minutes) + " alt (Meldung " + clockOf(p.fetched_at) + " Uhr)"
    : "leer — der Collector hat noch nichts gemeldet (Poll alle 5 Minuten, Fenster 06–24 Uhr)"]);
  rows.push(["Stations-Metadaten", p.stations_with_name === p.stations && p.available
    ? (p.stations_with_name || 0) + " von " + (p.stations || 0) + " Stationen mit Name und Koordinaten"
    : (p.stations_with_name || 0) + " von " + (p.stations || 0) +
      " Stationen mit Name — die Stationsliste fehlt oder ist unlesbar (Einrichtung bzw. Ortsumstellung auf dem Pi prüfen)"]);
  rows.push(["Prognose-Cache", f.available
    ? (f.count || 0) + " Stationen · generiert " + shortStamp(f.generated_at) + " (" + ageLabel((f.age_hours || 0) * 60) + " alt)"
    : "kein Cache — " + REBOOT_HINT]);
  rows.push(["NAS", !nas.configured
    ? "nicht konfiguriert — diese Adresse läuft dauerhaft im Fallback-Modus"
    : (nas.online ? "online" : "offline") + (nas.error ? " · letzter Fehler: " + nas.error : "")]);
  rows.push(["Fallback-GUI", "v" + (h.version || "?") + " · RP2 · Auto-Refresh alle 60 s"]);
  rows.push(["Stand der Antwort", h.generated_at ? shortStamp(h.generated_at) + " Uhr" : "—"]);
  el.innerHTML = rows.map((row) => "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>").join("");
}

/* ------------------------------- Sticky-Chip ------------------------------ */
function updateChip() {
  const chip = $("#sticky-chip");
  const p = lastPayload;
  const ok = !!(p && p.decide && p.decide.available) && state.view === "alltag" && answerVisible === false;
  chip.classList.toggle("hidden", !ok);
  if (!ok) return;
  const station = p.decide.f2.station;
  $("#sticky-chip-txt").innerHTML = "Günstigste <span class='c-price'>" + eur(p.decide.f2.price) +
    " €/L</span> · " + esc(shortName(station.name));
}
if (window.IntersectionObserver) {
  new IntersectionObserver((entries) => {
    answerVisible = entries[0].isIntersecting;
    updateChip();
  }, { threshold: 0.05 }).observe($("#answer-card"));
}
$("#sticky-chip").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

/* ------------------------------- Bedienung -------------------------------- */
function setActive(selector, predicate) {
  $$(selector).forEach((b) => b.classList.toggle("active", !!predicate(b)));
}
function applyView(view) {
  state.view = view === "werkstatt" ? "werkstatt" : "alltag";
  LS.set("view", state.view);
  $("#view-alltag").classList.toggle("hidden", state.view !== "alltag");
  $("#view-werkstatt").classList.toggle("hidden", state.view !== "werkstatt");
  setActive("#view-tabs button", (b) => b.dataset.view === state.view);
  updateChip();
}
$$("#fuel-tabs button").forEach((b) => b.addEventListener("click", () => {
  state.fuel = b.dataset.fuel;
  LS.set("fuel", state.fuel);
  setActive("#fuel-tabs button", (x) => x.dataset.fuel === state.fuel);
  refresh();
}));
$$("#view-tabs button").forEach((b) => b.addEventListener("click", () => applyView(b.dataset.view)));
$$("#sort-tabs button").forEach((b) => b.addEventListener("click", () => {
  state.sort = b.dataset.sort;
  LS.set("sort", state.sort);
  setActive("#sort-tabs button", (x) => x.dataset.sort === state.sort);
  if (lastPayload) renderStations(lastPayload.stations, lastPayload.decide);
}));
$("#city").addEventListener("change", () => {
  state.city = $("#city").value;
  LS.set("city", state.city);
  refresh();
});
$("#liters").addEventListener("change", () => {
  const v = Math.max(5, Math.min(100, Number($("#liters").value) || state.liters));
  $("#liters").value = v;
  if (v !== state.liters) {
    state.liters = v;
    LS.set("liters", v);
    refresh();
  }
});
$("#refresh-btn").addEventListener("click", refresh);
$("#nas-pill").addEventListener("click", async () => {
  const pill = $("#nas-pill");
  pill.disabled = true;
  banner("NAS wird geprüft …");
  try {
    const r = await j("/api/v1/nas-check");
    if (r.online) {
      banner("NAS ist wieder online — die Seite lädt jetzt die vollwertige NAS-GUI.");
      setTimeout(() => { window.location.href = "/"; }, 600);
    } else {
      banner("NAS ist nach wie vor nicht erreichbar" + (r.nas && r.nas.error ? " (" + r.nas.error + ")" : "") +
        " — der Fallback bleibt aktiv und prüft selbst weiter.", true);
      refresh();
    }
  } catch (e) {
    banner("NAS-Prüfung fehlgeschlagen: " + e.message, true);
  } finally {
    pill.disabled = false;
  }
});

/* --------------------------------- Start ---------------------------------- */
$("#liters").value = state.liters;
setActive("#fuel-tabs button", (b) => b.dataset.fuel === state.fuel);
setActive("#sort-tabs button", (b) => b.dataset.sort === state.sort);
applyView(state.view);
refresh();
refreshTimer = setInterval(refresh, 60000);
window.addEventListener("beforeunload", () => clearInterval(refreshTimer));
</script>
</body>
</html>
"""


def _build_template() -> tuple[str, str]:
    """Template + Inhalts-Hash-Marker (ersetzt veraltete Template-Dateien)."""
    # G4: Der Reboot-Satz steht einmal in Python und wird als JSON-String in
    # das Template gesetzt (esc() beim Rendern bleibt Pflicht).
    body = (_TEMPLATE_HEAD + _TEMPLATE_REST).replace(
        "__CACHE_REBOOT_HINT_JSON__",
        json.dumps(CACHE_REBOOT_HINT, ensure_ascii=False),
    )
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:12]
    marker = f"<!-- tankapp-fallback-gui v{VERSION} sha:{digest} -->"
    rendered = _TEMPLATE_HEAD + marker + _TEMPLATE_REST
    return rendered.replace(
        "__CACHE_REBOOT_HINT_JSON__",
        json.dumps(CACHE_REBOOT_HINT, ensure_ascii=False),
    ), marker


DEFAULT_INDEX_HTML, VERSION_MARKER = _build_template()


if __name__ == "__main__":
    main()
