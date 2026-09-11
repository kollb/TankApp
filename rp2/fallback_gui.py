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
  GET /api/v1/nas-check        NAS-Status sofort neu prüfen
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

VERSION = "2.0"
# VERSION_MARKER wird am Ende des Moduls aus dem Template-Inhalt gebaut
# (Inhalts-Hash), damit auch JS-/CSS-Fixes innerhalb derselben Version auf
# bestehenden Installationen automatisch ersetzt werden.
VERSION_MARKER = ""

FUELS = ("e5", "e10", "diesel")
FRESH_MINUTES = 15  # Snapshot gilt als "aktuell" bis zu diesem Alter
WAIT_THRESHOLD_EUR = 1.0  # F1: ab so viel erwarteter Ersparnis pro Tank -> warten
DEFAULT_LITERS = 40
MIN_LITERS = 5
MAX_LITERS = 100
NAS_CHECK_TIMEOUT_S = 2.0
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
                for stset in (payload.get("sets") or {}).values():
                    city = stset.get("label") or ""
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
                            "city": city,
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
                "city": rec.get("city") or m.get("city", ""),
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
        return {
            "at": ts.isoformat(),
            "time": ts.strftime("%H:%M"),
            "date": ts.strftime("%Y-%m-%d"),
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
                body = resp.read(4096)
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
    ):
        self.poll_dir = Path(poll_dir)
        self.cache_file = Path(cache_file)
        self.meta = StationMeta(meta_candidates)
        self.template_dir = Path(template_dir)
        self.force_fallback = force_fallback
        self.proxy_timeout = proxy_timeout
        self.nas = nas_state or NasState(nas_base, nas_health)

    def snapshot(self) -> dict:
        meta = self.meta.load()
        best = read_snapshots(self.poll_dir)
        return {
            "stations": build_stations(best, meta),
            "forecasts": load_forecasts(self.cache_file),
            "meta_path": self.meta.path_used,
            "meta_error": self.meta.error,
        }


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
        def _proxy(self) -> bool:
            target = ctx.nas.base_url + self.path
            try:
                req = urllib.request.Request(target, method=self.command)
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
                row for row in rows if str(row.get("city", "")).casefold() == wanted
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
            cities = sorted({s["city"] for s in stations if s.get("city")})
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
                        "error": "Kein Prognose-Cache vorhanden (NAS war nie erreichbar?)"
                        " — cache_forecasts.py prüfen.",
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
        for p in (
            os.environ.get("STATION_META", ""),
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
<meta name="theme-color" content="#0b0f19">
<title>TankApp · Fallback (RP2)</title>
"""
_TEMPLATE_REST = """
<style>
:root {
  --bg: #0b0f19;
  --panel: rgba(15, 23, 42, 0.82);
  --panel-2: #0f172a;
  --border: #1e293b;
  --text: #f1f5f9;
  --muted: #94a3b8;
  --accent: #34d399;
  --accent-2: #10b981;
  --warn: #fbbf24;
  --bad: #f87171;
  --info: #38bdf8;
  --row-hover: rgba(30, 41, 59, 0.55);
  --shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.55);
}
html.light {
  --bg: #eef2f7;
  --panel: rgba(255, 255, 255, 0.92);
  --panel-2: #ffffff;
  --border: #dbe3ee;
  --text: #0f172a;
  --muted: #5b6b81;
  --accent: #059669;
  --accent-2: #047857;
  --warn: #b45309;
  --bad: #dc2626;
  --info: #0369a1;
  --row-hover: #f1f5f9;
  --shadow: 0 10px 24px -14px rgba(15, 23, 42, 0.25);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  min-height: 100vh;
}
.topbar {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 20px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
}
.brand { font-weight: 700; font-size: 17px; letter-spacing: 0.2px; display: flex; align-items: center; gap: 8px; }
.mode-badge {
  font-size: 11px; font-weight: 700; letter-spacing: 0.4px;
  color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
  padding: 2px 8px; border-radius: 999px;
}
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pill {
  font-size: 12px; font-weight: 600;
  border: 1px solid var(--border);
  background: var(--panel-2);
  padding: 4px 10px; border-radius: 999px;
  color: var(--muted);
  display: inline-flex; align-items: center; gap: 6px;
  white-space: nowrap;
}
.pill.ok { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.pill.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
.pill.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; display: inline-block; }
.btn {
  font: inherit; font-size: 12.5px; font-weight: 600;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.05s ease;
}
.btn:hover { border-color: var(--accent); }
.btn:active { transform: translateY(1px); }
.btn.primary {
  background: var(--accent); border-color: var(--accent); color: #04150d;
}
.btn.primary:hover { background: var(--accent-2); }
.wrap { width: min(100%, 1080px); margin: 0 auto; padding: 18px 16px 48px; }
button, input, select { max-width: 100%; }
select { font: inherit; color: var(--text); background: var(--panel-2); border: 1px solid var(--border); border-radius: 9px; padding: 5px 30px 5px 8px; }
@media (max-width: 560px) {
  body { font-size: 14px; }
  .topbar { padding: 10px 12px; }
  .topbar-right { width: 100%; margin-left: 0; }
  .topbar-right .pill { flex: 1 1 auto; }
  .wrap { padding: 12px 10px 32px; }
  .card { padding: 14px; border-radius: 14px; }
  .hero .price { font-size: 34px; }
  .decision .numbers { grid-template-columns: 1fr; }
  .liters { width: 100%; }
}
.banner {
  border-radius: 14px; border: 1px solid var(--border);
  background: var(--panel); padding: 10px 14px; margin-bottom: 14px;
  font-size: 13.5px; color: var(--muted);
}
.banner.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); }
.hidden { display: none !important; }
.fuelbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 4px 0 16px; }
.tabs { display: inline-flex; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 3px; }
.tab {
  font: inherit; font-size: 13.5px; font-weight: 700;
  color: var(--muted); background: transparent; border: 0; border-radius: 9px;
  padding: 6px 16px; cursor: pointer;
}
.tab.active { background: var(--accent); color: #04150d; }
.liters { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.liters input {
  width: 64px; font: inherit; font-size: 13px;
  color: var(--text); background: var(--panel-2);
  border: 1px solid var(--border); border-radius: 9px; padding: 5px 8px;
}
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 18px;
  box-shadow: var(--shadow);
}
.card h2 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); font-weight: 700; }
.hero { border-top: 3px solid var(--accent); }
.hero .station-name { font-size: 22px; font-weight: 700; margin: 2px 0; }
.hero .sub { color: var(--muted); font-size: 13.5px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.hero .price { font-size: 40px; font-weight: 800; margin: 10px 0 2px; letter-spacing: -1px; }
.hero .price small { font-size: 15px; color: var(--muted); font-weight: 600; }
.hero .savings { color: var(--accent); font-weight: 700; font-size: 14px; }
.tag {
  display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.3px;
  padding: 2px 8px; border-radius: 6px;
  background: color-mix(in srgb, var(--info) 14%, transparent);
  color: var(--info);
  border: 1px solid color-mix(in srgb, var(--info) 30%, transparent);
}
.tag.brand-tag { background: color-mix(in srgb, var(--muted) 16%, transparent); color: var(--muted); border-color: transparent; }
.decision .rec { font-size: 19px; font-weight: 700; margin-bottom: 4px; }
.decision .rec.wait { color: var(--info); }
.decision .rec.now { color: var(--accent); }
.decision .detail { color: var(--muted); font-size: 13.5px; margin-top: 6px; }
.decision .numbers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
.decision .num { background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 8px 10px; }
.decision .num b { display: block; font-size: 16px; }
.decision .num span { font-size: 11px; color: var(--muted); }
.windows { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.window {
  display: flex; align-items: center; gap: 10px;
  background: var(--panel-2); border: 1px solid var(--border);
  border-radius: 10px; padding: 7px 10px; font-size: 13px;
}
.window .when { font-weight: 700; min-width: 64px; }
.window .med { margin-left: auto; color: var(--muted); }
.window .save { color: var(--accent); font-weight: 700; min-width: 84px; text-align: right; }
.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; table-layout: fixed; }
th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.6px; white-space: nowrap; }
th.num, td.num { white-space: nowrap; }
td.station-cell { white-space: normal; word-break: break-word; min-width: 180px; max-width: 380px; }
tbody tr:hover { background: var(--row-hover); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td.num.save-pos { color: var(--accent); font-weight: 700; }
td.num.save-neg { color: var(--bad); font-weight: 600; opacity: 0.9; }
td.num.save-zero { color: var(--muted); }
tr.best td { background: color-mix(in srgb, var(--accent) 9%, transparent); }
tr.closed { color: var(--muted); }
@media (max-width: 700px) {
  table { table-layout: auto; font-size: 12.5px; }
  th:nth-child(1), td:nth-child(1) { width: 32px; }
  th:nth-child(4), td:nth-child(4), th:nth-child(6), td:nth-child(6), th:nth-child(7), td:nth-child(7) { display: none; }
  td.station-cell { max-width: 200px; font-size: 12.5px; }
}
.muted { color: var(--muted); }
.fresh { color: var(--accent); font-size: 11px; font-weight: 700; }
.stale { color: var(--warn); font-size: 11px; font-weight: 700; }
.navlink { color: var(--info); text-decoration: none; font-weight: 600; font-size: 12.5px; }
.navlink:hover { text-decoration: underline; }
.fgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); gap: 12px; }
.fcard { min-width: 0; }
.fcard svg { max-width: 100%; }
.fcard { background: var(--panel-2); border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; }
.fcard .fhead { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.fcard .fname { font-weight: 700; font-size: 14px; }
.fcard .fmeta { color: var(--muted); font-size: 12px; }
.fcard svg { width: 100%; height: auto; display: block; margin-top: 8px; }
svg .axis { stroke: var(--border); stroke-width: 1; }
svg .grid-line { stroke: var(--border); stroke-width: 1; stroke-dasharray: 3 4; }
svg .band { fill: color-mix(in srgb, var(--accent) 16%, transparent); }
svg .median { stroke: var(--accent); stroke-width: 2; fill: none; }
svg .nowline { stroke: var(--warn); stroke-width: 1.5; stroke-dasharray: 5 4; fill: none; }
svg text { fill: var(--muted); font-size: 10.5px; font-family: inherit; }
.foot { margin-top: 26px; font-size: 12.5px; color: var(--muted); text-align: center; }
.foot a { color: var(--info); }
.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--accent);
  animation: spin 0.8s linear infinite; display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<header class="topbar">
  <div class="brand">🚗 TankApp <span class="mode-badge">FALLBACK · RP2</span></div>
  <div class="topbar-right">
    <span id="nas-pill" class="pill"><span class="spinner"></span></span>
    <span id="price-pill" class="pill"><span class="spinner"></span></span>
    <button id="nas-check-btn" class="btn" title="NAS-Erreichbarkeit sofort neu prüfen">🔄 NAS prüfen</button>
    <button id="theme-btn" class="btn" title="Dark/Light wechseln">🌙</button>
    <button id="refresh-btn" class="btn" title="Jetzt aktualisieren">⟳</button>
  </div>
</header>

<main class="wrap">
  <section id="banner" class="banner hidden"></section>

  <nav class="fuelbar">
    <label class="liters">Ort
      <select id="city" aria-label="Ort auswählen">
        <option value="">Alle Orte</option>
      </select>
    </label>
    <div class="tabs" id="fuel-tabs">
      <button class="tab" data-fuel="e10">E10</button>
      <button class="tab" data-fuel="e5">E5</button>
      <button class="tab" data-fuel="diesel">Diesel</button>
    </div>
    <label class="liters">Tankgröße
      <input id="liters" type="number" min="5" max="100" step="5"> L
    </label>
  </nav>

  <section class="grid">
    <div class="card hero" id="hero">
      <h2>🏆 Günstigste Station</h2>
      <div id="hero-body"><div class="muted"><span class="spinner"></span> Lade …</div></div>
    </div>
    <div class="card decision" id="decision">
      <h2>⛽ Jetzt tanken oder warten?</h2>
      <div id="decision-body"><div class="muted"><span class="spinner"></span> Lade …</div></div>
    </div>
  </section>

  <section class="card" style="margin-top: 14px;">
    <h2>Stationen <span id="stations-sub" class="muted"></span></h2>
    <div class="table-wrap">
      <table id="stations-table">
        <thead>
          <tr>
            <th>#</th><th>Station</th><th class="num">Preis</th>
            <th class="num">Δ min.</th><th class="num">Spart (Tank)</th>
            <th>Daten</th><th>📍</th>
          </tr>
        </thead>
        <tbody id="stations-body"><tr><td colspan="7" class="muted"><span class="spinner"></span> Lade …</td></tr></tbody>
      </table>
    </div>
  </section>

  <section class="card" style="margin-top: 14px;">
    <h2>Prognosen (gecached) <span id="forecast-sub" class="muted"></span></h2>
    <div id="forecast-grid" class="fgrid"><div class="muted"><span class="spinner"></span> Lade …</div></div>
  </section>

  <footer class="foot">
    <p>Diese Adresse läuft auf dem <b>RP2</b>. Wenn das <b>NAS online</b> ist, zeigt sie automatisch
    die vollwertige TankApp-GUI (inkl. Live-Entscheidungen). Jetzt bist du im Fallback-Modus:
    Live-Preise kommen direkt vom Collector-Puffer, Prognosen sind gecacht und bis zu 24 h alt.</p>
    <p><a href="?fallback=1">Fallback-GUI erzwingen</a> · F1: „Jetzt oder warten“ · F2: „Günstigste Station“ · F3: „Beste Zeitfenster“</p>
  </footer>
</main>

<script>
"use strict";
const $ = (s) => document.querySelector(s);
const FUELS = ["e10", "e5", "diesel"];
const FUEL_LABEL = { e10: "E10", e5: "E5", diesel: "Diesel" };
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
const state = {
  fuel: savedFuel(),
  city: String(LS.get("city", "") || ""),
  liters: Math.max(5, Math.min(100, Number(LS.get("liters", 40)) || 40)),
};
let lastPayload = null;
let refreshTimer = null;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function eur(x, d = 3) {
  return x === null || x === undefined || Number.isNaN(x)
    ? "—"
    : x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function ct(x) {
  return x === null || x === undefined ? "—" : x.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " ct";
}
function eurTank(x) {
  return x === null || x === undefined ? "—" : x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function pct(x) {
  return x === null || x === undefined ? "—" : Math.round(x * 100) + " %";
}
function ageLabel(minutes) {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return Math.round(minutes) + " min";
  const h = Math.floor(minutes / 60);
  return h + " h " + Math.round(minutes % 60) + " min";
}
function relDay(iso) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 86400000);
  const hm = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return "heute " + hm;
  if (diff === 1) return "morgen " + hm;
  return d.toLocaleDateString("de-DE") + " " + hm;
}

// ------------------------------- Theme -----------------------------------
function applyTheme(t) {
  document.documentElement.classList.toggle("light", t === "light");
  $("#theme-btn").textContent = t === "light" ? "🌙" : "☀️";
  LS.set("theme", t);
}
(function initTheme() {
  const system = window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(LS.get("theme", system));
  $("#theme-btn").addEventListener("click", () => {
    applyTheme(document.documentElement.classList.contains("light") ? "dark" : "light");
  });
})();

// ------------------------------- Data ------------------------------------
async function j(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(url + " → HTTP " + r.status);
  return r.json();
}
function banner(msg, bad) {
  const el = $("#banner");
  if (!msg) { el.classList.add("hidden"); el.textContent = ""; return; }
  el.classList.remove("hidden");
  el.classList.toggle("bad", !!bad);
  el.textContent = msg;
}

async function refresh() {
  try {
    const q = "?fuel=" + encodeURIComponent(state.fuel) +
      "&city=" + encodeURIComponent(state.city) + "&liters=" + state.liters;
    const [health, stations, forecasts, decide] = await Promise.all([
      j("/api/v1/health"),
      j("/api/v1/stations" + q),
      j("/api/v1/forecasts" + q).catch(() => null),
      j("/api/v1/decide" + q).catch(() => null),
    ]);
    lastPayload = { health, stations, forecasts, decide };
    banner(null);
    renderAll(lastPayload);
  } catch (e) {
    banner("⚠️ Daten konnten nicht geladen werden: " + e.message + " — wird automatisch erneut versucht.", true);
  }
}

// ------------------------------ Rendering --------------------------------
function renderAll({ health, stations, forecasts, decide }) {
  renderHeader(health);
  renderHero(stations, decide);
  renderDecision(decide, forecasts);
  renderStationsTable(stations);
  renderForecasts(forecasts);
}

function renderHeader(health) {
  const citySelect = $("#city");
  const cities = Array.isArray(health.cities) ? health.cities : [];
  if (!cities.includes(state.city)) state.city = "";
  citySelect.innerHTML = '<option value="">Alle Orte</option>' + cities.map((city) =>
    '<option value="' + esc(city) + '">' + esc(city) + '</option>'
  ).join("");
  citySelect.value = state.city;
  const nas = health.nas || {};
  const nasPill = $("#nas-pill");
  if (!nas.configured) {
    nasPill.className = "pill bad";
    nasPill.innerHTML = '<span class="dot"></span> NAS nicht konfiguriert';
  } else if (nas.online) {
    nasPill.className = "pill ok";
    nasPill.innerHTML = '<span class="dot"></span> NAS online';
  } else {
    nasPill.className = "pill bad";
    nasPill.innerHTML = '<span class="dot"></span> NAS offline — Fallback-Modus';
  }
  const p = health.prices || {};
  const pricePill = $("#price-pill");
  if (!p.available) {
    pricePill.className = "pill bad";
    pricePill.textContent = "Preise: keine (Puffer leer?)";
  } else {
    const stale = p.age_minutes > 60;
    pricePill.className = "pill " + (stale ? "bad" : p.age_minutes > 15 ? "warn" : "ok");
    pricePill.textContent = "Preise: " + ageLabel(p.age_minutes) + " alt · " + (p.open || 0) + "/" + p.stations + " offen";
  }
  const f = health.forecasts || {};
  $("#forecast-sub").textContent = f.available
    ? "· " + f.count + " Stationen · generiert " + relDay(f.generated_at) + " (" + (f.age_hours ?? "–") + " h alt)"
    : "· kein Cache — cache_forecasts.py prüfen";
}

function renderHero(stations, decide) {
  const el = $("#hero-body");
  const f2 = decide && decide.available ? decide.f2 : null;
  if (!f2) {
    el.innerHTML = '<div class="muted">Keine offenen Stationen mit ' + esc(FUEL_LABEL[state.fuel]) + "-Preisen im Puffer.</div>";
    return;
  }
  const s = f2.station;
  const live = stations.stations.find((x) => x.station_id === s.station_id) || {};
  const vsLabel = f2.saving_vs === "second" && f2.second_name
    ? "vs. " + esc(f2.second_name) + " (2.)"
    : f2.saving_vs === "second"
      ? "vs. 2.-günstigste"
      : "vs. teuerste (Top10-Vergleich)";
  el.innerHTML =
    '<div class="sub">' +
      (s.brand ? '<span class="tag brand-tag">' + esc(s.brand) + "</span>" : "") +
      (s.city ? '<span class="tag">' + esc(s.city) + "</span>" : "") +
      (live.drive_min ? '<span>≈ ' + esc(live.drive_min) + " min Fahrt</span>" : "") +
      '<span>' + FUEL_LABEL[state.fuel] + " · Daten " + ageLabel(live.age_minutes) + " alt</span>" +
    "</div>" +
    '<div class="station-name">' + esc(s.name) + "</div>" +
    '<div class="price">' + eur(f2.price) + " <small>€/L</small></div>" +
    '<div class="savings">spart ' + ct(f2.saving_ct_per_l) + "/L · " + eurTank(f2.saving_eur_tank) + " pro " + state.liters + " L-Tank <span class=\"muted\" style=\"font-weight:400\">" + vsLabel + "</span></div>" +
    (s.maps_url ? '<div style="margin-top:12px"><a class="btn primary" href="' + esc(s.maps_url) + '" target="_blank" rel="noopener">📍 Navigation</a></div>' : "");
}

function renderDecision(decide, forecasts) {
  const el = $("#decision-body");
  if (!decide || !decide.available) {
    el.innerHTML = '<div class="muted">Keine Entscheidungsdaten (keine offenen Stationen).</div>';
    return;
  }
  const f1 = decide.f1 || {};
  const fc = decide.forecast || {};
  let html = "";
  if (f1.available) {
    const waiting = f1.recommendation === "wait";
    html += '<div class="rec ' + (waiting ? "wait" : "now") + '">' +
      (waiting ? "⏳ Warten lohnt sich: bis " + esc(relDay(f1.best_at)) : "⛽ Jetzt tanken") + "</div>";
    html += '<div class="detail">' + esc(f1.reason) + "</div>";
    html += '<div class="numbers">' +
      '<div class="num"><b>' + eur(f1.current_price) + " €</b><span>jetzt (" + esc(FUEL_LABEL[state.fuel]) + ")</span></div>" +
      '<div class="num"><b>' + eur(f1.expected_price) + " €</b><span>erwartet " + esc((f1.best_at || "").slice(11, 16)) + " Uhr</span></div>" +
      '<div class="num"><b>' + pct(f1.price_score) + "</b><span>Preis-Score</span></div>" +
    "</div>";
    html += '<div class="detail muted">Preis-Score: 0–100 % auf Basis des historischen Quantils (q025–q975), keine kalibrierte Wahrscheinlichkeit. Die kalibrierte M7-Wahrscheinlichkeit liefert nur das NAS.</div>' +
    '<div class="detail muted" style="margin-top:10px">Basis: Prognose von ' +
      esc(fc.station || "?") + " vom " + esc(fc.generated_at ? relDay(fc.generated_at) : "?") +
      " (" + (fc.age_hours ?? "?") + " h alt) · " + esc(f1.basis || "") + "</div>";
  } else {
    html += '<div class="rec now">Aktueller Preisvergleich</div>';
    html += '<div class="detail">Keine Prognose für die günstigste Station verfügbar' +
      (fc.generated_at ? " (Cache von " + esc(relDay(fc.generated_at)) + ")" : "") +
      " — es gibt keine Grundlage, um zu warten. Nimm die günstigste frische Station.</div>";
  }
  const windows = decide.windows || [];
  if (windows.length) {
    html += '<div class="detail" style="margin-top:14px;font-weight:700">🕑 Beste Zeitfenster heute/24 h:</div><div class="windows">';
    for (const w of windows) {
      html += '<div class="window">' +
        '<span class="when">' + esc(relDay(w.at)) + "</span>" +
        '<span class="muted">~' + eur(w.q50) + " € · Preis-Score " + pct(w.price_score) + "</span>" +
        '<span class="save">−' + eurTank((w.expected_saving_ct_per_l / 100) * state.liters) + "</span>" +
      "</div>";
    }
    html += "</div>";
  }
  el.innerHTML = html;
}

function renderStationsTable(stations) {
  const rows = (stations.stations || []).slice();
  const first = rows.find((s) => s.price !== null && s.price !== undefined);
  const base = first ? first.price : null;
  const body = $("#stations-body");
  $("#stations-sub").textContent =
    "· " + FUEL_LABEL[state.fuel] + " · " + rows.filter((s) => s.price !== null && s.price !== undefined).length +
    " mit Preis · sortiert nach Preis";
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted">Keine Stationen im Puffer — Collector laufen lassen.</td></tr>';
    return;
  }
  let i = 0;
  body.innerHTML = rows.map((s) => {
    const hasPrice = s.price !== null && s.price !== undefined;
    if (hasPrice) i += 1;
    const isBest = hasPrice && base !== null && Math.abs(s.price - base) < 0.0005 && i === 1;
    const closed = s.status !== "open";
    const cls = [isBest ? "best" : "", closed ? "closed" : ""].filter(Boolean).join(" ");
    const delta = hasPrice && base !== null ? Math.round((s.price - base) * 100) : null;
    const save = hasPrice && base !== null ? (s.price - base) * state.liters : null;
    // save >0 = teurer als günstigste -> negativer Spart-Wert -> dezent rot
    const saveCls = save === null ? "save-zero" : save <= 0.001 ? "save-zero" : "save-neg";
    const deltaCls = delta === null ? "" : delta > 0 ? "save-neg" : "save-zero";
    const age = s.age_minutes;
    const ageHtml = closed
      ? '<span class="muted">geschlossen</span>'
      : s.fresh
        ? '<span class="fresh">● aktuell (' + ageLabel(age) + ")</span>"
        : '<span class="stale">● ' + ageLabel(age) + " alt</span>";
    return '<tr class="' + cls + '">' +
      "<td>" + (hasPrice ? i : "·") + "</td>" +
      "<td class=\"station-cell\"><b>" + esc(s.name) + "</b>" +
        (s.brand ? ' <span class="tag brand-tag">' + esc(s.brand) + "</span>" : "") +
        (s.city ? ' <span class="muted">(' + esc(s.city) + ")</span>" : "") +
        (!hasPrice && !closed ? ' <span class="muted">— ' + esc(FUEL_LABEL[state.fuel]) + " nicht geführt</span>" : "") +
      "</td>" +
      '<td class="num"><b>' + (hasPrice ? eur(s.price) + " €" : "—") + "</b></td>" +
      '<td class="num ' + deltaCls + '">' + (delta === null ? "—" : (delta > 0 ? "+" : "") + delta + " ct") + "</td>" +
      '<td class="num ' + saveCls + '">' + (save === null ? "—" : save <= 0.001 ? "±0,00 €" : "-" + eurTank(save)) + "</td>" +
      "<td>" + ageHtml + "</td>" +
      "<td>" + (s.maps_url ? '<a class="navlink" href="' + esc(s.maps_url) + '" target="_blank" rel="noopener">Los</a>' : "") + "</td>" +
    "</tr>";
  }).join("");
}

// --------------------------- Prognose-Sparklines --------------------------
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
  let lo = Math.min(...pts.map((p) => Number.isFinite(p.lo) ? p.lo : p.mid));
  let hi = Math.max(...pts.map((p) => Number.isFinite(p.hi) ? p.hi : p.mid));
  if (entry.current_price !== null && entry.current_price !== undefined) {
    lo = Math.min(lo, entry.current_price); hi = Math.max(hi, entry.current_price);
  }
  const padY = (hi - lo) * 0.18 || 0.005;
  lo -= padY; hi += padY;
  const W = 560, H = 150, pad = { l: 52, r: 10, t: 10, b: 24 };
  const X = (t) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = (key) => pts.map((p, i) => (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p[key]).toFixed(1)).join(" ");
  const band =
    pts.map((p, i) => (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p.hi).toFixed(1)).join(" ") +
    " " + [...pts].reverse().map((p) => "L" + X(p.t).toFixed(1) + " " + Y(p.lo).toFixed(1)).join(" ") + " Z";
  // Y-Achse: 3 Gitterlinien
  let grid = "";
  for (const frac of [0, 0.5, 1]) {
    const v = lo + (hi - lo) * frac;
    const y = Y(v);
    grid += '<line class="grid-line" x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '"/>' +
      '<text x="' + (pad.l - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + eur(v, 2) + "</text>";
  }
  // X-Achse: Ticks alle ~6 h
  const ticks = [];
  const stepMs = 6 * 3600000;
  const firstTick = Math.ceil(t0 / stepMs) * stepMs;
  for (let t = firstTick; t <= t1; t += stepMs) ticks.push(t);
  let axes = "";
  for (const t of ticks) {
    const x = X(t);
    const label = new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    axes += '<line class="axis" x1="' + x.toFixed(1) + '" y1="' + (pad.t + H - pad.b) + '" x2="' + x.toFixed(1) + '" y2="' + (H - 14) + '"/>' +
      '<text x="' + x.toFixed(1) + '" y="' + (H - 3) + '" text-anchor="middle">' + label + "</text>";
  }
  let nowMark = "";
  if (now >= t0 && now <= t1) {
    const x = X(now);
    nowMark = '<line class="nowline" x1="' + x.toFixed(1) + '" y1="' + pad.t + '" x2="' + x.toFixed(1) + '" y2="' + (H - pad.b) + '"/>' +
      '<text x="' + (x + 4).toFixed(1) + '" y="' + (pad.t + 9).toFixed(1) + '">jetzt</text>';
  }
  let curMark = "";
  if (entry.current_price !== null && entry.current_price !== undefined) {
    const y = Y(entry.current_price);
    curMark = '<line class="nowline" x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '"/>' +
      '<text x="' + (W - pad.r) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="end">aktuell ' + eur(entry.current_price) + "</text>";
  }
  return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Prognose ' + esc(entry.name) + '">' +
    grid + axes + '<path class="band" d="' + band + '"/>' +
    '<path class="median" d="' + line("mid") + '"/>' + nowMark + curMark +
  "</svg>";
}

function renderForecasts(forecasts) {
  const grid = $("#forecast-grid");
  if (!forecasts || !forecasts.available || !(forecasts.forecasts || []).length) {
    grid.innerHTML = '<div class="muted">Keine gecachten Prognosen für ' + esc(FUEL_LABEL[state.fuel]) +
      " vorhanden. Sobald das NAS wieder läuft, füllt cache_forecasts.py den Cache " +
      "(alle 5 min).<br>Doch: „Jetzt ist die günstigste Station?“ (F2) funktioniert trotzdem.</div>";
    return;
  }
  const entries = forecasts.forecasts;
  if (!entries.some((e) => e.summary)) {
    grid.innerHTML = '<div class="muted">Prognose-Cache ist vorhanden, aber älter als 24 h — ' +
      "keine zukünftigen Punkte mehr. Cache aktualisiert sich beim nächsten NAS-Start.</div>";
    return;
  }
  grid.innerHTML = entries.map((e) => {
    const sum = e.summary || {};
    const range = Number.isFinite(sum.min_q50) && Number.isFinite(sum.max_q50)
      ? "24-h-Band: " + eur(sum.min_q50) + " – " + eur(sum.max_q50) + " €"
      : "";
    const best = sum.best ? " · günstigster Moment " + esc(relDay(sum.best.at)) + " (~" + eur(sum.best.q50) + " €)" : "";
    return '<div class="fcard">' +
      '<div class="fhead"><span class="fname">' + esc(e.name) + "</span>" +
      (e.brand ? '<span class="tag brand-tag">' + esc(e.brand) + "</span>" : "") +
      (e.current_price !== null && e.current_price !== undefined
        ? '<span class="fmeta">jetzt ' + eur(e.current_price) + " €</span>" : '<span class="fmeta">kein Live-Preis</span>') +
      "</div>" +
      '<div class="fmeta">' + range + best + "</div>" +
      sparkline(e) +
    "</div>";
  }).join("");
}

// ------------------------------- Events -----------------------------------
function setFuel(fuel) {
  state.fuel = fuel;
  LS.set("fuel", fuel);
  document.querySelectorAll("#fuel-tabs .tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.fuel === fuel));
  refresh();
}
document.querySelectorAll("#fuel-tabs .tab").forEach((b) =>
  b.addEventListener("click", () => setFuel(b.dataset.fuel)));
$("#city").addEventListener("change", () => {
  state.city = $("#city").value;
  LS.set("city", state.city);
  refresh();
});
setFuel(state.fuel); // Tabs markieren + initial laden

$("#liters").value = state.liters;
$("#liters").addEventListener("change", () => {
  const v = Math.max(5, Math.min(100, Number($("#liters").value) || state.liters));
  $("#liters").value = v;
  if (v !== state.liters) { state.liters = v; LS.set("liters", v); refresh(); }
});
$("#refresh-btn").addEventListener("click", refresh);
$("#nas-check-btn").addEventListener("click", async () => {
  const btn = $("#nas-check-btn");
  btn.disabled = true;
  btn.textContent = "⏳ prüfe …";
  try {
    const r = await j("/api/v1/nas-check");
    if (r.online) {
      banner("NAS ist wieder online — lade die vollwertige NAS-GUI …");
      setTimeout(() => { window.location.href = "/"; }, 400);
    } else {
      banner("NAS ist nach wie vor nicht erreichbar (" + (r.nas.error || "keine Antwort") +
        ") — Fallback bleibt aktiv. Neu geprüft wird automatisch, solange diese Seite offen ist.");
      refresh();
    }
  } catch (e) {
    banner("NAS-Check fehlgeschlagen: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 NAS prüfen";
  }
});
// Auto-Refresh alle 60 s
refreshTimer = setInterval(refresh, 60000);
window.addEventListener("beforeunload", () => clearInterval(refreshTimer));
</script>
</body>
</html>
"""


def _build_template() -> tuple[str, str]:
    """Template + Inhalts-Hash-Marker (ersetzt veraltete Template-Dateien)."""
    body = _TEMPLATE_HEAD + _TEMPLATE_REST
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()[:12]
    marker = f"<!-- tankapp-fallback-gui v{VERSION} sha:{digest} -->"
    return _TEMPLATE_HEAD + marker + _TEMPLATE_REST, marker


DEFAULT_INDEX_HTML, VERSION_MARKER = _build_template()


if __name__ == "__main__":
    main()
