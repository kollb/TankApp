#!/usr/bin/env python3
"""
TankApp – M1 Uploader: schiebt die unbestätigten Zeilen des JSONL-Ringpuffers
nach InfluxDB 2.x auf dem NAS (Konzept §9.1). Nur Standardbibliothek.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import datetime as dt
import json
import math
import uuid
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import NamedTuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from polling_plan import active_polling

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_POLL_JSON = active_polling(ROOT)
DEFAULT_POLL_DIR = Path(os.environ.get("TANKAPP_POLL_DIR", ROOT / "data" / "poll"))
FUELS = ("e5", "e10", "diesel")
PING_EVERY_S = 60
PING_FAIL_LOG_EVERY_S = 300
CYCLE_TICK_S = 10
OVERFLOW_ALARM_DAYS = 6
OVERFLOW_LOG_EVERY_S = 3600
BACKOFF_BASE_S = 60
BACKOFF_MAX_S = 900
HTTP_TIMEOUT_S = 30
PING_TIMEOUT_S = 5
DRYRUN_MAX_LINES = 40
REPLAY_BATCH_POINTS = 1000
UPLOAD_BATCH_POINTS = REPLAY_BATCH_POINTS
ACK_SCHEMA = 2
# v1 was a single ISO timestamp used as ``ts > ack``. A clock rollback or a
# late older row appended after that ACK was skipped forever. Treat v1 as
# empty cursors plus a 7-day bounded rescan: Influx identity is idempotent,
# so rewriting those days is safe. Walking ``last ts <= ack`` would still
# skip older-ts lines that arrived after the original ACK.
V1_RESCAN_DAYS = 7
# Issue 50: Webhook an die NAS-App nach sicherem InfluxDB-Write. Scheitert er,
# läuft der intervallo-basierte Job unverändert weiter (Graceful Degradation,
# keine neue Abhängigkeit).
#
# B8: „Feuer-und-Vergessen“ ist ergänzt um **Wiederholung mit Backoff und
# Quittierung**. Ein verlorener Trigger kostete bisher den Wasserstand: Der
# Job lief dann nur noch im Intervall, ohne dass es irgendwo sichtbar war.
# Jetzt wird der Trigger vorgemerkt, wiederholt (30 s … 15 min) und der
# Zustand über den Herzschlag gemeldet (`collector_status` → System-Bereich).
# Nach WEBHOOK_MAX_AGE_S wird ehrlich aufgegeben — der Intervaljob übernimmt.
WEBHOOK_TIMEOUT_S = 5
WEBHOOK_MIN_GAP_S = 240
WEBHOOK_RETRY_BASE_S = 30
WEBHOOK_RETRY_MAX_S = 900
WEBHOOK_MAX_AGE_S = 7200
WEBHOOK_FAIL_LOG_EVERY_S = 300
# 4xx außer diesen: dauerhafter Fehler (falsches Token, unbekannter Job) —
# Wiederholen würde nur Log-Zeilen erzeugen.
WEBHOOK_RETRY_HTTP = (408, 429)


class Cfg:
    def __init__(
        self,
        url: str,
        org: str,
        bucket: str,
        token: str,
        poll_dir: Path,
        poll_json: Path,
        nas_webhook_url: str = "",
        nas_webhook_token: str = "",
    ):
        self.url = url.rstrip("/")
        self.org = org
        self.bucket = bucket
        self.token = token
        self.poll_dir = poll_dir
        self.poll_json = poll_json
        self.meta_dir = poll_dir / "meta"
        self.ack_file = self.meta_dir / "synced_until"
        # Issue 50: optionaler Webhook an die NAS-App nach sicherem Write.
        self.nas_webhook_url = nas_webhook_url.strip()
        self.nas_webhook_token = nas_webhook_token.strip()


class State:
    def __init__(self) -> None:
        self.fails = 0
        self.last_ping_fail_log = 0.0
        self.last_overflow_log = 0.0
        self.names_warned = False
        self.last_heartbeat = 0.0
        self.last_webhook = 0.0
        # B8: offener Trigger (Wiederholung mit Backoff) und sein Zustand.
        # ``pending`` ist ein Dict: job, watermark, attempts, first_at (epoch),
        # next_at (monoton), last_note.
        self.webhook_pending: dict | None = None
        self.webhook_last_status: str | None = None
        self.webhook_last_status_at: float | None = None
        self.webhook_last_ok_at: float | None = None
        self.webhook_last_fail_log = 0.0
        self.webhook_gave_up = 0


def log(msg: str) -> None:
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def mask_token(token: str) -> str:
    if not token:
        return "(leer)"
    if len(token) <= 8:
        return token[:2] + "…"
    return f"{token[:4]}…{token[-4:]} ({len(token)} Zeichen)"


def parse_ts(s: str) -> dt.datetime:
    ts = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=dt.datetime.now().astimezone().tzinfo)
    return ts


def empty_ack() -> dict:
    return {"v": ACK_SCHEMA, "cursors": {}, "fetched_at_max": None, "stamps": {}}


def read_ack(meta_dir: Path) -> dict:
    """Load the uploader cursor (schema v2: per-file byte offsets).

    Schema v1 was a single ISO timestamp. A v1 file is treated as empty
    cursors plus ``fetched_at_max`` for the collector's date prune and a
    bounded 7-day rescan — never as ``ts > ack``.
    """
    try:
        s = (meta_dir / "synced_until").read_text(encoding="utf-8").strip()
    except OSError:
        return empty_ack()
    if not s:
        return empty_ack()
    if s.startswith("{"):
        try:
            data = json.loads(s)
        except json.JSONDecodeError:
            log(
                "⚠ Ack-Datei nicht lesbar — als 'nichts gesynced' behandelt "
                "(Neusenden ist dank Punkt-Identität in InfluxDB harmlos)."
            )
            return empty_ack()
        if not isinstance(data, dict):
            return empty_ack()
        try:
            version = int(data.get("v") or 0)
        except (TypeError, ValueError):
            version = 0
        if version >= ACK_SCHEMA:
            cursors = data.get("cursors") or {}
            clean: dict[str, int] = {}
            if isinstance(cursors, dict):
                for key, value in cursors.items():
                    try:
                        clean[str(key)] = int(value)
                    except (TypeError, ValueError):
                        continue
            stamps: dict[str, dict] = {}
            raw_stamps = data.get("stamps")
            if isinstance(raw_stamps, dict):
                for key, value in raw_stamps.items():
                    if isinstance(value, dict):
                        stamps[str(key)] = dict(value)
            return {
                "v": ACK_SCHEMA,
                "cursors": clean,
                "fetched_at_max": data.get("fetched_at_max"),
                "stamps": stamps,
            }
        return empty_ack()
    try:
        ts = parse_ts(s)
    except ValueError:
        log(
            f"⚠ Ack-Datei nicht lesbar ({s!r}) — als 'nichts gesynced' behandelt "
            "(Neusenden ist dank Punkt-Identität in InfluxDB harmlos)."
        )
        return empty_ack()
    return {"v": 1, "cursors": {}, "fetched_at_max": ts.isoformat()}


def write_ack(meta_dir: Path, ack: dict) -> None:
    meta_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "v": ACK_SCHEMA,
        "cursors": {
            str(key): int(value) for key, value in (ack.get("cursors") or {}).items()
        },
        "fetched_at_max": ack.get("fetched_at_max"),
        "stamps": {
            str(key): dict(value)
            for key, value in (ack.get("stamps") or {}).items()
            if isinstance(value, dict)
        },
    }
    tmp = meta_dir / ".synced_until.tmp"
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    tmp.replace(meta_dir / "synced_until")


def advance_ack(ack: dict, batch) -> dict:
    """A21-B1.1: Cursor nur für verkettete, zusammenhängende Pufferbereiche.

    Invariante: Der Cursor je Datei ist ein **lückenlos bestätigtes
    Byte-Präfix**. Ein Batch wird in der Reihenfolge seiner Tiles verarbeitet;
    für jede Datei muss die Kette am bestätigten Cursor ansetzen (bzw. bei 0,
    wenn der Leser nach einer nachgewiesenen Verkürzung neu begonnen hat) und
    lückenlos fortlaufen. Ein Kettenbruch bestätigt nichts mehr dahinter — der
    Rest wird erneut gesucht statt still übersprungen (Neusenden ist dank
    Punkt-Identität in InfluxDB idempotent).

    Ereigniszeit bleibt Messgröße: sie wandert nur als ``fetched_at_max`` und
    ist nie Commit-Position. Eine rückspringende Uhr vertauscht
    Ereigniszeiten, keine Dateibereiche.
    """
    out = {
        "v": ACK_SCHEMA,
        "cursors": {
            str(key): int(value) for key, value in (ack.get("cursors") or {}).items()
        },
        "fetched_at_max": ack.get("fetched_at_max"),
        "stamps": {
            str(key): dict(value)
            for key, value in (ack.get("stamps") or {}).items()
            if isinstance(value, dict)
        },
    }
    fetched = ack_fetched_at(out)
    chain: dict[str, int] = {}
    blocked: set[str] = set()
    for tile in batch:
        name = tile.file_name
        if tile.ts is not None and (fetched is None or tile.ts > fetched):
            fetched = tile.ts
            out["fetched_at_max"] = tile.ts.isoformat()
        if name in blocked:
            continue
        cursor = int(out["cursors"].get(name, 0) or 0)
        prev = chain.get(name)
        if prev is None:
            # Anker: Scanbeginn. Offset 0 heißt Neubeginn nach Verkürzung/
            # Rotation — der Cursor darf dann auch zurückspringen (erneutes
            # Senden ist sicher); eine Vorwärtslücke nie.
            if tile.start_offset != cursor and tile.start_offset != 0:
                log(
                    f"⚠ Ack-Halt {name}: Bereich beginnt bei Offset "
                    f"{tile.start_offset}, bestätigt ist nur bis {cursor} — "
                    "Lücke wird nicht übersprungen, sondern erneut gesucht."
                )
                blocked.add(name)
                continue
        elif tile.start_offset != prev:
            log(
                f"⚠ Ack-Halt {name}: Kette bricht bei Offset "
                f"{tile.start_offset} (erwartet {prev}) — Rest nicht "
                "bestätigt, wird erneut gesendet."
            )
            blocked.add(name)
            continue
        out["cursors"][name] = int(tile.end_offset)
        chain[name] = int(tile.end_offset)
    return out


def ack_fetched_at(ack: dict | None) -> dt.datetime | None:
    if not ack:
        return None
    raw = ack.get("fetched_at_max")
    if not raw:
        return None
    try:
        return parse_ts(str(raw))
    except ValueError:
        return None


def _file_in_v1_rescan(path: Path, ack: dict) -> bool:
    if int(ack.get("v") or 0) >= ACK_SCHEMA:
        return True
    fetched = ack_fetched_at(ack)
    if fetched is None:
        return True
    floor = fetched - dt.timedelta(days=V1_RESCAN_DAYS)
    try:
        mtime = dt.datetime.fromtimestamp(path.stat().st_mtime, tz=dt.timezone.utc)
    except OSError:
        return True
    return mtime >= floor


class SyncTile(NamedTuple):
    """Ein zusammenhängend verarbeiteter Bytebereich einer Pufferdatei.

    Die Tiles einer Datei verketten sich exakt: Das erste beginnt am
    Scan-Anfang (Cursor bzw. 0 nach Verkürzung), jedes folgende am Ende
    seines Vorgängers. Leere Zeilen liegen im Span des Folgetiles; ein
    abgebrochener Dateischwanz erzeugt gar kein Tile (A21-B1.2).
    """

    kind: str  # "row" (gültige Meldung) | "damaged" (zu isolieren)
    file_name: str
    start_offset: int
    end_offset: int
    ts: dt.datetime | None  # nur "row"
    snap: dict | None  # nur "row"
    raw: bytes  # Zeile ohne Zeilenumbruch (Quarantäne/Diagnose)
    reason: str | None  # nur "damaged": "utf8" | "json" | "schema"


class BufferScan(NamedTuple):
    tiles: "list[SyncTile]"  # verkettete Kette, Datei-/Offsetordnung
    rows: "list[SyncTile]"  # Sicht auf kind == "row"
    damaged: "list[SyncTile]"  # Sicht auf kind == "damaged"
    tail_files: "list[str]"  # Dateien mit unvollständigem Schwanz


def _prefix_sha256(path: Path, end: int) -> str:
    """SHA-256 der Bytes ``[0, end)`` — Nachweis des bestätigten Präfixes."""
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            remaining = int(end)
            while remaining > 0:
                chunk = handle.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                digest.update(chunk)
    except OSError:
        return ""
    return digest.hexdigest()


def scan_unsynced(poll_dir: Path, ack: dict | None) -> BufferScan:
    """Unbestätigte Pufferbereiche als verkettete Tiles (A21-B1.1/A21-B1.2).

    Reihenfolge ist **Datei- und Offset-Reihenfolge**, nie Ereigniszeit — nur
    so ist der Cursor ein lückenlos bestätigtes Präfix. Beschädigte
    vollständige Zeilen (ungültiges UTF-8, defektes JSON, falsches Schema)
    werden als eigene Tiles sichtbar; der Aufrufer isoliert sie, bevor der ACK
    an ihnen vorbeigeht. Ein Dateischwanz ohne abschließenden Zeilenumbruch
    (laufender Append oder abgebrochener Schreibvorgang) endet die Kette
    unbestätigt — er darf weder bestätigt noch als beschädigt gelten.
    """
    tiles: "list[SyncTile]" = []
    tail_files: "list[str]" = []
    if not poll_dir.is_dir():
        return BufferScan(tiles, [], [], tail_files)
    ack = ack or empty_ack()
    cursors = ack.get("cursors") or {}
    recorded_stamps = ack.get("stamps") or {}
    for path in sorted(poll_dir.glob("*.jsonl")):
        if not _file_in_v1_rescan(path, ack):
            continue
        start = int(cursors.get(path.name, 0) or 0)
        try:
            stat = path.stat()
        except OSError:
            continue
        size = stat.st_size
        if start > size:
            # Verkürzung: Neubeginn bei 0 — im Zweifel erneut senden.
            start = 0
        if start > 0:
            # A21-B1.1: Das bestätigte Präfix muss noch dieselben Bytes
            # tragen. Ein Ersatz unter dem Cursor (Rotation, auch bei gleicher
            # Größe oder grober mtime-Auflösung) ändert den Hash: dann wird
            # von 0 erneut gesendet statt still zu überspringen.
            recorded = recorded_stamps.get(path.name)
            want = recorded.get("prefix_sha256") if isinstance(recorded, dict) else None
            if want and _prefix_sha256(path, start) != want:
                start = 0
        if start >= size:
            continue
        span_start = start
        with path.open("rb") as handle:
            if start:
                handle.seek(start)
            while True:
                raw = handle.readline()
                if not raw:
                    break
                end_offset = handle.tell()
                if not raw.endswith(b"\n"):
                    # Unvollständiger Dateischwanz: nicht bestätigen, nicht
                    # beschädigt nennen — er kann gerade erst teilweise
                    # geschrieben worden sein und noch wachsen.
                    tail_files.append(path.name)
                    break
                body = raw[:-1]
                snap = None
                ts = None
                reason = None
                try:
                    line = body.decode("utf-8").strip()
                except UnicodeDecodeError:
                    reason = "utf8"
                    line = ""
                if reason is None and not line:
                    # Leerzeile: Bytes liegen im Span des Folgetiles.
                    continue
                if reason is None:
                    try:
                        parsed = json.loads(line)
                    except ValueError:
                        reason = "json"
                    else:
                        try:
                            if not isinstance(parsed, dict):
                                raise TypeError("payload is not an object")
                            ts = parse_ts(parsed["fetched_at"])
                            snap = parsed
                        except (AttributeError, KeyError, TypeError, ValueError):
                            reason = "schema"
                            snap = None
                            ts = None
                if reason is not None:
                    tiles.append(
                        SyncTile(
                            "damaged",
                            path.name,
                            span_start,
                            end_offset,
                            None,
                            None,
                            body,
                            reason,
                        )
                    )
                else:
                    tiles.append(
                        SyncTile(
                            "row",
                            path.name,
                            span_start,
                            end_offset,
                            ts,
                            snap,
                            body,
                            None,
                        )
                    )
                span_start = end_offset
    rows = [tile for tile in tiles if tile.kind == "row"]
    damaged = [tile for tile in tiles if tile.kind == "damaged"]
    return BufferScan(tiles, rows, damaged, tail_files)


def read_unsynced(poll_dir: Path, ack: dict | None) -> "list[SyncTile]":
    """Unbestätigte Meldungen — Sicht ``kind == \"row\"`` auf :func:`scan_unsynced`.

    Eine beschädigte Zeile beendet den Lauf nicht mehr (A21-B1.2): sie fehlt
    hier, wird aber in :func:`scan_unsynced` sichtbar und von
    :func:`run_upload` mit Datei-/Offsetbezug isoliert, bevor der ACK an ihr
    vorbeigeht. Der Dateischwanz ohne Zeilenumbruch bleibt unbestätigt.
    """
    return scan_unsynced(poll_dir, ack).rows


def quarantine_tile(meta_dir: Path, tile: SyncTile) -> Path:
    """A21-B1.2: Isoliert eine beschädigte Pufferzeile nachvollziehbar.

    Eine Datei je Vorfall unter ``meta/quarantine/``, benannt nach Quelldatei
    und Byte-Offsets. Exklusives Anlegen macht Wiederholungen nach einem
    Abbruch idempotent. Der Eintrag nennt Datei, Offsets, Grund, SHA-256 und
    die Rohbytes (base64) — die Diagnose im Log nennt nur Datei, Offsets und
    Zähler, nie Zugangsdaten und nie Rohinhalte.
    """
    qdir = meta_dir / "quarantine"
    qdir.mkdir(parents=True, exist_ok=True)
    target = qdir / f"{tile.file_name}.{tile.start_offset}-{tile.end_offset}.json"
    payload = {
        "file": tile.file_name,
        "start_offset": int(tile.start_offset),
        "end_offset": int(tile.end_offset),
        "reason": tile.reason,
        "sha256": hashlib.sha256(tile.raw).hexdigest(),
        "raw_base64": base64.b64encode(tile.raw).decode("ascii"),
        "quarantined_at": dt.datetime.now().astimezone().isoformat(),
    }
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    try:
        with target.open("x", encoding="utf-8") as handle:
            handle.write(data)
    except FileExistsError:
        # Bereits isoliert (Retry nach Abbruch zwischen Quarantäne und Ack).
        return target
    except OSError:
        # Halb geschriebener Eintrag gilt nicht als isoliert — beim Retry
        # wird erneut geschrieben.
        try:
            target.unlink()
        except OSError:
            pass
        raise
    return target


def load_station_names(poll_json: Path) -> "dict[str, dict[str, str]]":
    try:
        payload = json.loads(poll_json.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out: "dict[str, dict[str, str]]" = {}
    for city_key, stset in (payload.get("sets") or {}).items():
        if not isinstance(stset, dict):
            continue
        names = {
            s["uuid"]: (s.get("name") or s["uuid"])
            for s in stset.get("stations", [])
            if isinstance(s, dict) and s.get("uuid")
        }
        if names:
            out[stset.get("label") or city_key] = names
    return out


def esc_tag(v: str) -> str:
    return (
        v.replace("\\", "\\\\")
        .replace(",", "\\,")
        .replace(" ", "\\ ")
        .replace("=", "\\=")
    )


def esc_str(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


def snap_to_lines(ts: dt.datetime, snap: dict, names: "dict[str, str]") -> "list[str]":
    """Line protocol with UUID-only series identity (I3).

    ``station_id`` is the sole tag (Influx identity / idempotency key).
    Display name and city are fields: a rename does not fork the series.
    """
    city = str(snap.get("city") or "unknown")
    ns = int(ts.timestamp() * 1_000_000_000)
    out = []
    for uid, rec in (snap.get("prices") or {}).items():
        if not isinstance(rec, dict):
            continue
        station = str(names.get(uid) or uid)
        fields = [
            f'status="{esc_str(str(rec.get("status") or "no prices"))}"',
            f'city="{esc_str(city)}"',
            f'station="{esc_str(station)}"',
        ]
        for fu in FUELS:
            v = rec.get(fu)
            if (
                isinstance(v, bool)
                or not isinstance(v, (int, float))
                or not math.isfinite(v)
                or v <= 0
            ):
                continue
            fields.append(f"{fu}={float(v):.3f}")
        out.append(f"prices,station_id={esc_tag(str(uid))} {','.join(fields)} {ns}")
    return out


def read_heartbeat_file(poll_dir: Path) -> dict | None:
    hb_path = poll_dir / "meta" / "heartbeat.json"
    try:
        if not hb_path.is_file() or hb_path.stat().st_size > 10_000_000:
            return None
        data = json.loads(hb_path.read_text(encoding="utf-8-sig"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def heartbeat_to_line(heartbeat: dict, webhook: dict | None = None) -> str | None:
    if not heartbeat:
        return None
    last_poll = heartbeat.get("last_poll_at")
    if not last_poll:
        return None
    try:
        # use current time as point time, not last_poll
        ns = int(dt.datetime.now().astimezone().timestamp() * 1_000_000_000)
    except Exception:
        ns = int(time.time() * 1_000_000_000)

    host = esc_tag("pi")

    fields = [f'city="{esc_str(str(heartbeat.get("city") or "unknown"))}"']
    try:
        fields.append(f'last_poll_at="{esc_str(str(last_poll))}"')
    except Exception:
        pass

    tmpfs = (
        heartbeat.get("tmpfs", {}) if isinstance(heartbeat.get("tmpfs"), dict) else {}
    )
    for key, field_name in (
        ("total_bytes", "tmpfs_total_bytes"),
        ("used_bytes", "tmpfs_used_bytes"),
        ("free_bytes", "tmpfs_free_bytes"),
    ):
        v = tmpfs.get(key)
        if isinstance(v, (int, float)) and math.isfinite(v):
            fields.append(f"{field_name}={int(v)}i")

    oldest = (
        heartbeat.get("oldest_file", {})
        if isinstance(heartbeat.get("oldest_file"), dict)
        else {}
    )
    age = oldest.get("age_days")
    if isinstance(age, (int, float)) and math.isfinite(age):
        fields.append(f"oldest_age_days={float(age):.3f}")

    poll_count = heartbeat.get("poll_count")
    if isinstance(poll_count, (int, float)) and math.isfinite(poll_count):
        fields.append(f"poll_count={int(poll_count)}i")

    # B8: Zustand des Webhook-Triggers mit dem Herzschlag melden — nur wenn ein
    # Ziel eingerichtet ist (sonst „nicht eingerichtet“ statt einer Null).
    for key, value in (webhook or {}).items():
        if isinstance(value, bool):
            continue
        if isinstance(value, str):
            fields.append(f'{key}="{esc_str(value)}"')
        elif isinstance(value, (int, float)) and math.isfinite(value):
            fields.append(f"{key}={int(value)}i")

    if not fields:
        return None

    return f"collector_status,host={host} {','.join(fields)} {ns}"


def influx_ping(cfg: Cfg) -> "tuple[bool, str]":
    try:
        req = urllib.request.Request(cfg.url + "/ping")
        with urllib.request.urlopen(req, timeout=PING_TIMEOUT_S) as r:
            return True, f"ok (HTTP {r.status})"
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        reason = getattr(e, "reason", None) or (str(e) or type(e).__name__)
        return (
            False,
            f"unreachable ({reason}) — NAS aus oder TANKAPP_INFLUX_URL={cfg.url} falsch?",
        )


def influx_write(cfg: Cfg, lines: "list[str]") -> None:
    qs = urllib.parse.urlencode(
        {"org": cfg.org, "bucket": cfg.bucket, "precision": "ns"}
    )
    req = urllib.request.Request(
        f"{cfg.url}/api/v2/write?{qs}",
        data="\n".join(lines).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Token {cfg.token}",
            "Content-Type": "text/plain; charset=utf-8",
            "User-Agent": "TankApp-Uploader/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
        if r.status not in (200, 204):
            raise RuntimeError(f"unerwartetes HTTP {r.status} bei /api/v2/write")


def explain_write_error(e: Exception, cfg: Cfg) -> str:
    if isinstance(e, urllib.error.HTTPError):
        code = e.code
        body = ""
        try:
            raw = (e.read().decode("utf-8", "replace") or "").strip()
            body = raw.splitlines()[0][:200] if raw else ""
        except (OSError, IndexError):
            pass
        if code == 401:
            msg = (
                "Token fehlt/falsch — TANKAPP_INFLUX_TOKEN in /etc/tankapp/env prüfen "
                "(NAS: 'docker compose exec influxdb influx auth list')."
            )
        elif code == 403:
            msg = (
                f"Token existiert, aber keine Schreibberechtigung — Token neu anlegen: "
                f"'influx auth create --org {cfg.org} --read-bucket {cfg.bucket} "
                f"--write-bucket {cfg.bucket}'."
            )
        elif code == 404:
            msg = (
                f"Org '{cfg.org}' oder Bucket '{cfg.bucket}' existiert nicht — "
                f"TANKAPP_INFLUX_ORG/_BUCKET prüfen (NAS: 'influx org list', "
                f"'influx bucket list --org {cfg.org}')."
            )
        elif code == 400:
            msg = f"Line Protocol abgelehnt. InfluxDB: {body or '(keine Meldung)'}"
        else:
            msg = f"InfluxDB: {body or '(keine Meldung)'}"
        return f"HTTP {code} — {msg}"
    if isinstance(e, TimeoutError):
        return (
            f"Timeout nach {HTTP_TIMEOUT_S} s — NAS sehr langsam oder nicht erreichbar"
        )
    if isinstance(e, urllib.error.URLError):
        return (
            f"NAS nicht erreichbar ({e.reason}) — NAS aus oder "
            f"TANKAPP_INFLUX_URL={cfg.url} falsch?"
        )
    return str(e) or type(e).__name__


def webhook_status(state: State) -> dict:
    """Zustand des Webhook-Triggers für Herzschlag und Log (B8).

    Enthält bewusst **keine** URL, keinen Token und keine Stationsdaten —
    nur Zähler, Zeiten und den kurzen Statuscode der NAS-Antwort.
    """
    now = time.time()
    pending = state.webhook_pending
    out = {
        "pending": pending is not None,
        "attempts": int(pending.get("attempts", 0)) if pending else 0,
        "pending_age_s": None,
        "last_status": state.webhook_last_status,
        "last_status_age_s": None,
        "last_ok_age_s": None,
        "gave_up": state.webhook_gave_up,
    }
    if pending:
        out["pending_age_s"] = max(0, int(now - float(pending.get("first_at", now))))
    if state.webhook_last_status_at:
        out["last_status_age_s"] = max(0, int(now - state.webhook_last_status_at))
    if state.webhook_last_ok_at:
        out["last_ok_age_s"] = max(0, int(now - state.webhook_last_ok_at))
    return out


def webhook_influx_fields(cfg: Cfg, state: State) -> dict:
    """Felder für den ``collector_status``-Punkt — nur bei eingerichtetem Ziel.

    Ohne ``TANKAPP_NAS_WEBHOOK_URL`` gibt es nichts zu melden: Der System-Bereich
    zeigt dann „nicht eingerichtet“ statt einer erfundenen Null.
    """
    if not cfg.nas_webhook_url:
        return {}
    status = webhook_status(state)
    fields: dict = {
        "webhook_pending": 1 if status["pending"] else 0,
        "webhook_attempts": status["attempts"],
    }
    if status["pending_age_s"] is not None:
        fields["webhook_pending_age_s"] = status["pending_age_s"]
    if status["last_status"]:
        fields["webhook_last_status"] = status["last_status"]
    if status["last_ok_age_s"] is not None:
        fields["webhook_last_ok_age_s"] = status["last_ok_age_s"]
    if status["gave_up"]:
        fields["webhook_gave_up"] = status["gave_up"]
    return fields


def _webhook_settle(state: State, status: str, note: str | None = None) -> None:
    """Trigger abgeschlossen (quittiert oder dauerhaft abgelehnt)."""
    state.webhook_pending = None
    state.webhook_last_status = status
    state.webhook_last_status_at = time.time()
    if not status.startswith(("http_4", "rejected")):
        state.webhook_last_ok_at = state.webhook_last_status_at
    if note:
        log(f"⇡ NAS-Webhook quittiert: {status} — {note}")
    else:
        log(f"⇡ NAS-Webhook quittiert: {status}")


def _webhook_attempt(cfg: Cfg, state: State, pending: dict) -> None:
    """Einen (weiteren) Versuch senden und das Ergebnis verbuchen."""
    body = json.dumps(
        {"job": pending["job"], "watermark": pending["watermark"]}
    ).encode()
    headers = {"Content-Type": "application/json"}
    if cfg.nas_webhook_token:
        headers["Authorization"] = "Bearer " + cfg.nas_webhook_token
    request = urllib.request.Request(
        cfg.nas_webhook_url.rstrip("/") + "/api/v1/jobs/trigger",
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=WEBHOOK_TIMEOUT_S) as response:
            raw = b""
            try:
                raw = response.read() or b""
            except Exception:
                raw = b""
            answer = {}
            try:
                parsed = json.loads(raw.decode("utf-8"))
                if isinstance(parsed, dict):
                    answer = parsed
            except (ValueError, UnicodeDecodeError):
                answer = {}
            status = str(answer.get("status") or f"http_{response.status}")
            if status in ("rejected",) or answer.get("error_code") == "unauthorized":
                # Dauerhaft: der NAS-Kennt den Job nicht oder will nicht.
                _webhook_settle(state, status, str(answer.get("reason") or "abgelehnt"))
                return
            _webhook_settle(state, status)
    except urllib.error.HTTPError as exc:
        if 400 <= exc.code < 500 and exc.code not in WEBHOOK_RETRY_HTTP:
            # Falsches Token, falscher Job: Wiederholen hilft nicht.
            _webhook_settle(state, f"http_{exc.code}", "dauerhaft — nicht wiederholt")
            return
        _webhook_retry(state, pending, f"http_{exc.code}")
    except Exception as exc:
        _webhook_retry(state, pending, type(exc).__name__)


def _webhook_retry(state: State, pending: dict, reason: str) -> None:
    """Versuch verbuchen und den nächsten Versuch mit Backoff vormerken."""
    pending["attempts"] = int(pending.get("attempts", 0)) + 1
    pending["last_note"] = reason
    wait = min(
        WEBHOOK_RETRY_BASE_S * 2 ** (pending["attempts"] - 1), WEBHOOK_RETRY_MAX_S
    )
    pending["next_at"] = time.monotonic() + wait
    state.webhook_last_status = "retry_wait"
    state.webhook_last_status_at = time.time()
    now = time.time()
    if now - state.webhook_last_fail_log >= WEBHOOK_FAIL_LOG_EVERY_S:
        state.webhook_last_fail_log = now
        log(
            f"⚠ NAS-Webhook nicht quittiert ({reason}, Versuch "
            f"{pending['attempts']}) — nächster Versuch in {wait} s, "
            "Intervaljob läuft unverändert weiter."
        )


def notify_nas(cfg: Cfg, state: State, watermark: dt.datetime) -> None:
    """NAS-App nach sicherem InfluxDB-Write anstoßen (Issue 50, B8).

    Merkt den Trigger vor und versucht ihn sofort; scheitert er, wiederholt
    ``webhook_tick`` ihn mit Backoff. Erzeugt nie einen Upload-Fehler und gibt
    niemals den Token preis. Der NAS-Scheduler entscheidet selbst (Debounce +
    Idempotenz), ob ein Inferenzlauf startet — die Antwort ist die Quittierung.
    """
    if not cfg.nas_webhook_url:
        return
    now_mono = time.monotonic()
    # ``0.0`` means "noch nie gesendet".  On a freshly booted Pi,
    # ``monotonic()`` is itself smaller than the minimum gap; comparing it
    # unconditionally with zero would therefore suppress the very first
    # trigger for up to four minutes after boot.
    if state.last_webhook and now_mono - state.last_webhook < WEBHOOK_MIN_GAP_S:
        # Die Sperre gilt **neuen** Triggern; ein offener Wiederholungsversuch
        # läuft weiter (er gehört zum selben Ereignis).
        return
    state.last_webhook = now_mono
    state.webhook_pending = {
        "job": "models",
        "watermark": int(watermark.timestamp()),
        "attempts": 0,
        "first_at": time.time(),
        "next_at": now_mono,
        "last_note": None,
    }
    webhook_tick(cfg, state)


def webhook_tick(cfg: Cfg, state: State) -> None:
    """Fällige Webhook-Trigger senden — Erstversuch oder Wiederholung (B8).

    Läuft in jedem Uploader-Zyklus (10 s), damit ein Wiederholungsversuch
    nicht auf die nächste Preiszeile warten muss.
    """
    pending = state.webhook_pending
    if pending is None or not cfg.nas_webhook_url:
        return
    if time.time() - float(pending.get("first_at", 0.0)) >= WEBHOOK_MAX_AGE_S:
        state.webhook_pending = None
        state.webhook_gave_up += 1
        state.webhook_last_status = "abandoned"
        state.webhook_last_status_at = time.time()
        log(
            "⚠ NAS-Webhook: Trigger nach 2 h nicht quittiert — aufgegeben, "
            "der Intervaljob übernimmt (Wasserstand ist dann nur später da)."
        )
        return
    if time.monotonic() < float(pending.get("next_at", 0.0)):
        return
    _webhook_attempt(cfg, state, pending)


def sd_notify(state: str) -> None:
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr:
        return
    if addr.startswith("@"):
        addr = "\0" + addr[1:]
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as s:
            s.connect(addr)
            s.sendall(state.encode("utf-8"))
    except OSError:
        pass


def run_upload(cfg: Cfg, state: State) -> int:
    # B8: Ein offener Trigger wird in **jedem** Zyklus erneut versucht — auch
    # dann, wenn gerade keine neue Preiszeile zu senden ist.
    webhook_tick(cfg, state)

    ack = read_ack(cfg.meta_dir)
    scan = scan_unsynced(cfg.poll_dir, ack)
    rows = scan.rows

    if rows:
        oldest_ts = min(tile.ts for tile in rows)
        age_d = (dt.datetime.now().astimezone() - oldest_ts).total_seconds() / 86400.0
        if (
            age_d >= OVERFLOW_ALARM_DAYS
            and time.time() - state.last_overflow_log >= OVERFLOW_LOG_EVERY_S
        ):
            state.last_overflow_log = time.time()
            log(
                f"⚠ PUFFER ÜBERFÜLLT: älteste unsynced Zeile ist {age_d:.1f} Tage alt "
                "(Ringpuffer hält nur 7 Tage) — NAS-Ausfall zu lange, älteste Daten "
                "werden FIFO verloren! Uploader + NAS prüfen."
            )

    # Even if no price rows, try to upload heartbeat periodically (every 60s)
    heartbeat_line = None
    now_mono = time.monotonic()
    if now_mono - state.last_heartbeat >= 60:
        hb = read_heartbeat_file(cfg.poll_dir)
        if hb:
            heartbeat_line = heartbeat_to_line(
                hb, webhook=webhook_influx_fields(cfg, state)
            )

    names_by_city = load_station_names(cfg.poll_json)
    if not names_by_city and not state.names_warned:
        state.names_warned = True
        log(
            "⚠ Stationsnamen nicht verfügbar (polling.json fehlt?) — station-Feld "
            "enthält die UUID statt des Namens."
        )

    newest = None
    wrote_prices = False
    n_points = 0
    n_quarantined = 0
    if scan.tiles:
        for offset in range(0, len(scan.tiles), UPLOAD_BATCH_POINTS):
            batch = scan.tiles[offset : offset + UPLOAD_BATCH_POINTS]
            lines: "list[str]" = []
            for tile in batch:
                if tile.kind == "row":
                    lines.extend(
                        snap_to_lines(
                            tile.ts,
                            tile.snap,
                            names_by_city.get(tile.snap.get("city") or "", {}),
                        )
                    )
                    continue
                # A21-B1.2: beschädigte Zeile VOR der Bestätigung isolieren.
                # Scheitert die Quarantäne, bleibt der Cursor davor stehen —
                # ein unbemerkter Import oder ein stiller Verlust ist beides
                # ausgeschlossen.
                try:
                    quarantine_tile(cfg.meta_dir, tile)
                    n_quarantined += 1
                except OSError as e:
                    state.fails += 1
                    log(
                        f"✗ Quarantäne für {tile.file_name} "
                        f"@ {tile.start_offset}–{tile.end_offset} "
                        f"({tile.reason}) fehlgeschlagen: {e} — Ack bleibt "
                        "stehen, Unbestätigtes wird erneut versucht."
                    )
                    return 1
            if lines:
                try:
                    influx_write(cfg, lines)
                except (
                    urllib.error.HTTPError,
                    urllib.error.URLError,
                    TimeoutError,
                    OSError,
                ) as e:
                    state.fails += 1
                    wait = min(BACKOFF_BASE_S * 2 ** (state.fails - 1), BACKOFF_MAX_S)
                    log(
                        f"✗ InfluxDB-Write fehlgeschlagen: {explain_write_error(e, cfg)} — "
                        f"Versuch in {wait} s (Ack bleibt stehen, der Bereich "
                        "wird erneut gesendet)."
                    )
                    return 1
                wrote_prices = True
                n_points += len(lines)
            ack = advance_ack(ack, batch)
            # A21-B1.1: je Datei den Hash des jetzt bestätigten Präfixes
            # mitbestätigen — ein Ersatz unter dem Cursor (Rotation) ist
            # damit beim nächsten Lauf erkennbar („im Zweifel erneut senden“).
            for name in {tile.file_name for tile in batch}:
                cursor = int(ack["cursors"].get(name, 0) or 0)
                ack.setdefault("stamps", {})[name] = {
                    "prefix_sha256": _prefix_sha256(cfg.poll_dir / name, cursor),
                    "for_bytes": cursor,
                }
            write_ack(cfg.meta_dir, ack)
            for tile in batch:
                if tile.ts is not None and (newest is None or tile.ts > newest):
                    newest = tile.ts
        state.fails = 0
        if rows or n_quarantined:
            summary = (
                f"⇡ {len(rows)} Zeile(n) ({n_points} Punkte) → InfluxDB — "
                "zusammenhängendes Dateipräfix bestätigt"
            )
            if n_quarantined:
                summary += (
                    f"; ⚠ {n_quarantined} beschädigte Zeile(n) isoliert "
                    "(meta/quarantine, Datei/Offset dort benannt)"
                )
            log(summary)
        if scan.tail_files:
            names = ", ".join(sorted(set(scan.tail_files)))
            log(
                f"⏳ Unvollständiger Dateischwanz in {names} — nicht bestätigt "
                "und nicht beschädigt, wird später erneut gelesen."
            )
        if wrote_prices and newest:
            # Issue 50: sichere Write-Bestätigung als Ereignis an die NAS-App.
            # Watermark = jüngste Ereigniszeit der bestätigten Zeilen
            # (Messgröße, keine Commit-Position).
            notify_nas(cfg, state, newest)

    if heartbeat_line:
        try:
            influx_write(cfg, [heartbeat_line])
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            OSError,
        ) as e:
            state.fails += 1
            wait = min(BACKOFF_BASE_S * 2 ** (state.fails - 1), BACKOFF_MAX_S)
            log(
                f"✗ InfluxDB-Write fehlgeschlagen: {explain_write_error(e, cfg)} — "
                f"Versuch in {wait} s (Ack bleibt stehen, der Bereich "
                "wird erneut gesendet)."
            )
            return 1
        state.fails = 0
        state.last_heartbeat = now_mono
        log("⇡ Collector-Herzschlag → InfluxDB (collector_status)")
    return 0


def run_once(cfg: Cfg, state: State) -> int:
    ok, detail = influx_ping(cfg)
    log(f"Ping {cfg.url}: {detail}")
    return run_upload(cfg, state)


def run_loop(cfg: Cfg, state: State) -> int:
    log(
        f"Uploader startet: {cfg.url} org={cfg.org} bucket={cfg.bucket} "
        f"(Token {mask_token(cfg.token)})"
    )
    log(
        f"Uploader: Puffer {cfg.poll_dir}, Ack {cfg.ack_file}, "
        f"Ping alle {PING_EVERY_S} s, Watchdog alle {CYCLE_TICK_S} s"
    )
    sd_notify("READY=1")
    next_ping = 0.0
    retry_at = 0.0
    while True:
        sd_notify("WATCHDOG=1")
        now_m = time.monotonic()
        if now_m >= retry_at:
            if now_m >= next_ping:
                next_ping = now_m + PING_EVERY_S
                ok, detail = influx_ping(cfg)
                if (
                    not ok
                    and time.time() - state.last_ping_fail_log >= PING_FAIL_LOG_EVERY_S
                ):
                    state.last_ping_fail_log = time.time()
                    log(
                        f"⚠ Ping {cfg.url} fehlgeschlagen: {detail} — Uploader "
                        "versucht trotzdem weiter, Puffer läuft weiter."
                    )
            rc = run_upload(cfg, state)
            if rc:
                retry_at = time.monotonic() + min(
                    BACKOFF_BASE_S * 2 ** (state.fails - 1), BACKOFF_MAX_S
                )
        time.sleep(CYCLE_TICK_S)


def dry_run(args: argparse.Namespace) -> int:
    ack = read_ack(args.poll_dir / "meta")
    scan = scan_unsynced(args.poll_dir, ack)
    rows = scan.rows
    hb = read_heartbeat_file(args.poll_dir)
    # Ohne Cfg-Ziel zeigt dry-run keine Webhook-Felder (nichts eingerichtet).
    hb_line = heartbeat_to_line(hb) if hb else None
    if not rows and not scan.damaged and not hb_line and not scan.tail_files:
        log(
            f"0 unsynced Zeilen in {args.poll_dir} — Puffer voll gesynct ✓ (oder leer)."
        )
        if hb:
            log(f"[dry-run] Herzschlag vorhanden: {hb_line}")
        return 0
    names_by_city = load_station_names(args.poll_json)
    lines: "list[str]" = []
    for tile in rows:
        lines.extend(
            snap_to_lines(
                tile.ts, tile.snap, names_by_city.get(tile.snap.get("city") or "", {})
            )
        )
    if hb_line:
        lines.append(hb_line)
    log(
        f"[dry-run] {len(rows)} unsynced Zeilen "
        f"({rows[0].ts.isoformat() if rows else '–'} … {rows[-1].ts.isoformat() if rows else '–'}) → {len(lines)} Punkte, "
        "dies WÜRDE per POST /api/v2/write gesendet:"
    )
    for line in lines[:DRYRUN_MAX_LINES]:
        print("  " + line)
    if len(lines) > DRYRUN_MAX_LINES:
        print(f"  … (+{len(lines) - DRYRUN_MAX_LINES} weitere)")
    if scan.damaged:
        log(
            f"[dry-run] {len(scan.damaged)} beschädigte Zeile(n) würden isoliert "
            "(meta/quarantine): "
            + ", ".join(
                f"{t.file_name} @{t.start_offset}–{t.end_offset} ({t.reason})"
                for t in scan.damaged[:5]
            )
        )
    if scan.tail_files:
        log(
            "[dry-run] Unvollständiger Dateischwanz (nicht bestätigt): "
            + ", ".join(sorted(set(scan.tail_files)))
        )
    log("[dry-run] nichts gesendet, Ack bleibt stehen.")
    return 0


class ReplayError(ValueError):
    pass


REPLAY_HINTS = {
    "JSON_INVALID": "Zeile ist kein gültiges JSON; unvollständige/falsche Sicherung prüfen.",
    "SNAPSHOT_OBJECT": "Jede JSONL-Zeile muss ein einzelnes Snapshot-Objekt sein, nicht eine Liste oder Stationsliste.",
    "SOURCE_MISSING": "Snapshot-Feld source fehlt. Collector-Version/Originalformat prüfen; nicht nachträglich eine Quelle erfinden.",
    "SOURCE_UNKNOWN": "Snapshot-Feld source ist keine erkannte Live-Quelle. Den Wert nicht zum Erzwingen eines Replays umschreiben.",
    "SOURCE_DEMO": "Snapshot ist ausdrücklich als demo markiert und darf nicht als echter Preis nachgeliefert werden.",
    "TIME_MISSING_OR_INVALID": "fetched_at fehlt oder ist kein gültiger ISO-Zeitstempel.",
    "TIME_OFFSET_MISSING": "fetched_at hat keinen UTC-Offset (älteres Format möglich). Ursprüngliche Collector-Zeitzone erst klären, dann ausdrücklich --replay-timezone angeben; keine Uhrzeit raten.",
    "TIME_LOCAL_NONEXISTENT": "Lokale Uhrzeit existiert in der gewählten Replay-Zeitzone nicht (Zeitumstellung). Originalen Offset klären, nicht verschieben.",
    "TIME_LOCAL_AMBIGUOUS": "Lokale Uhrzeit ist in der gewählten Replay-Zeitzone doppelt vorhanden (Zeitumstellung). Ohne originalen Offset keine eindeutige Zuordnung.",
    "CITY_INVALID": "Snapshot-Feld city fehlt, ist leer oder enthält ein ungültiges Format.",
    "PRICES_OBJECT": "Snapshot-Feld prices muss ein nach Stations-UUIDs indiziertes Objekt sein.",
    "STATION_UUID_INVALID": "Ein Schlüssel in prices ist keine UUID im kanonischen Format.",
    "STATION_STATUS_INVALID": "Ein Stationseintrag ist kein Objekt oder sein status ist nicht open, closed bzw. no prices.",
    "PRICE_NONFINITE": "Ein numerischer Kraftstoffpreis ist nicht endlich oder nicht als Zahl darstellbar.",
    "CONFLICTING_OBSERVATION": "Für dieselbe Stadt/UUID/Zeit liegen widersprüchliche Originalwerte vor; nicht willkürlich einen auswählen.",
}


def replay_zone(name: str | None) -> ZoneInfo | None:
    if name is None:
        return None
    try:
        if name in ("localtime", "posixrules"):
            raise ValueError
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise ReplayError(
            "[REPLAY_TIMEZONE_INVALID] Benannte IANA-Zeitzone der ursprünglichen "
            "Collector-Uhrzeit angeben (z. B. Europe/Berlin oder UTC); keine automatische lokale Annahme."
        ) from None


def local_time_candidates(stamp: dt.datetime, zone: ZoneInfo) -> list[dt.datetime]:
    candidates = set()
    for fold in (0, 1):
        aware = stamp.replace(tzinfo=zone, fold=fold)
        utc = aware.astimezone(dt.timezone.utc)
        if utc.astimezone(zone).replace(tzinfo=None) == stamp:
            candidates.add(utc)
    return sorted(candidates)


def prepare_replay(
    poll_dir: Path, poll_json: Path, replay_timezone: str | None = None
) -> tuple[list[str], int]:
    zone = replay_zone(replay_timezone)
    legacy_count = 0
    paths = sorted(poll_dir.glob("*.jsonl"))
    if not paths:
        raise ReplayError("Keine JSONL-Dateien in der angegebenen Sicherung gefunden.")
    names_by_city = load_station_names(poll_json)
    rows = []
    observations = {}
    for path in paths:
        before = path.stat()
        try:
            with path.open(encoding="utf-8-sig") as handle:
                for line_no, line in enumerate(handle, 1):
                    if not line.strip():
                        continue
                    stage = "JSON_INVALID"
                    station_no = None
                    try:
                        snap = json.loads(line)
                        stage = "SNAPSHOT_OBJECT"
                        if not isinstance(snap, dict):
                            raise ValueError
                        source = snap.get("source")
                        stage = (
                            "SOURCE_DEMO"
                            if source == "demo"
                            else (
                                "SOURCE_MISSING"
                                if source is None or source == ""
                                else "SOURCE_UNKNOWN"
                            )
                        )
                        if source != "tankerkoenig-prices.php":
                            raise ValueError
                        stage = "TIME_MISSING_OR_INVALID"
                        stamp = dt.datetime.fromisoformat(
                            snap["fetched_at"].replace("Z", "+00:00")
                        )
                        stage = "TIME_OFFSET_MISSING"
                        if stamp.tzinfo is None:
                            if zone is None:
                                raise ValueError
                            candidates = local_time_candidates(stamp, zone)
                            stage = "TIME_LOCAL_NONEXISTENT"
                            if not candidates:
                                raise ValueError
                            stage = "TIME_LOCAL_AMBIGUOUS"
                            if len(candidates) != 1:
                                raise ValueError
                            stamp = candidates[0]
                            legacy_count += 1
                        stage = "CITY_INVALID"
                        city = snap.get("city")
                        if (
                            not isinstance(city, str)
                            or not city.strip()
                            or any(c in city for c in "\r\n")
                        ):
                            raise ValueError
                        stage = "PRICES_OBJECT"
                        prices = snap.get("prices")
                        if not isinstance(prices, dict):
                            raise ValueError
                        for station_no, (uid, rec) in enumerate(prices.items(), 1):
                            stage = "STATION_UUID_INVALID"
                            if (
                                not isinstance(uid, str)
                                or str(uuid.UUID(uid)) != uid.lower()
                            ):
                                raise ValueError
                            stage = "STATION_STATUS_INVALID"
                            if not isinstance(rec, dict) or rec.get("status") not in (
                                "open",
                                "closed",
                                "no prices",
                            ):
                                raise ValueError
                            stage = "PRICE_NONFINITE"
                            if any(
                                isinstance(rec.get(fuel), (int, float))
                                and not math.isfinite(rec[fuel])
                                for fuel in FUELS
                            ):
                                raise ValueError
                            stage = "CONFLICTING_OBSERVATION"
                            key = (city, uid, stamp)
                            if key in observations and observations[key] != rec:
                                raise ValueError
                            observations[key] = rec
                        rows.append((stamp, snap))
                    except (
                        ValueError,
                        KeyError,
                        TypeError,
                        AttributeError,
                        OverflowError,
                    ):
                        position = (
                            f", Stationseintrag {station_no}"
                            if station_no is not None
                            else ""
                        )
                        raise ReplayError(
                            f"Replay-Prüfung fehlgeschlagen: {path.name}, Zeile {line_no}{position}. "
                            f"[{stage}] {REPLAY_HINTS[stage]} "
                            "Gemeint ist die Preis-JSONL, nicht polling.json. "
                            "Noch nichts geschrieben; Quelle und Ack unverändert."
                        ) from None
        except UnicodeError:
            raise ReplayError(
                f"Replay-Prüfung fehlgeschlagen: {path.name}. [ENCODING_UTF8] "
                "Preis-JSONL ist nicht als UTF-8 lesbar; Sicherung prüfen, keine Originaldaten überschreiben. "
                "Noch nichts geschrieben; Quelle und Ack unverändert."
            ) from None
        after = path.stat()
        if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
            raise ReplayError(
                "Replay-Quelle wurde während des Lesens verändert. Eine ruhende Sicherung verwenden."
            )
    rows.sort(key=lambda row: row[0])
    lines = []
    for stamp, snap in rows:
        names = names_by_city.get(snap["city"], {})
        if any("\n" in name or "\r" in name for name in names.values()):
            raise ReplayError(
                "Stationsnamen enthalten Zeilenumbrüche; Metadaten prüfen."
            )
        lines.extend(snap_to_lines(stamp, snap, names))
    if zone is not None:
        log(
            f"Replay-Zeitzone ausdrücklich gewählt: {zone.key}; {legacy_count} Snapshot(s) "
            "ohne Offset zu UTC zugeordnet. Vorhandene Offsets und Quelldateien unverändert."
        )
    return list(dict.fromkeys(lines)), len(rows)


def run_replay(cfg: Cfg, dry: bool = False, replay_timezone: str | None = None) -> int:
    try:
        lines, snapshots = prepare_replay(cfg.poll_dir, cfg.poll_json, replay_timezone)
    except ReplayError as exc:
        log(f"Replay abgebrochen: {exc}")
        return 1
    except (ValueError, OSError, TypeError, KeyError, AttributeError):
        log(
            "Replay abgebrochen: Sicherung/Metadaten ungültig oder nicht lesbar; UTF-8, Pfade und Rechte prüfen."
        )
        return 1
    if not lines:
        log(
            "Replay: keine Stationspunkte vorhanden; nichts geschrieben, Ack unverändert."
        )
        return 2
    log(
        f"Replay: {snapshots} Original-Snapshot(s) → {len(lines)} UUID-Punkte. Ack bleibt unverändert."
    )
    if dry:
        for line in lines[:DRYRUN_MAX_LINES]:
            print("  " + line)
        log("[dry-run] nur Vorschau; keine Netzwerkabfrage, keine Datei-/Ack-Änderung.")
        return 0
    batches = (len(lines) + REPLAY_BATCH_POINTS - 1) // REPLAY_BATCH_POINTS
    for offset in range(0, len(lines), REPLAY_BATCH_POINTS):
        batch = offset // REPLAY_BATCH_POINTS + 1
        try:
            influx_write(cfg, lines[offset : offset + REPLAY_BATCH_POINTS])
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            http.client.HTTPException,
            TimeoutError,
            OSError,
            ValueError,
            RuntimeError,
        ) as exc:
            code = (
                f"HTTP {exc.code}"
                if isinstance(exc, urllib.error.HTTPError)
                else "Transport-/Write-Fehler"
            )
            log(
                f"Replay bei Batch {batch}/{batches} abgebrochen ({code}). "
                "Quelle/Ack unverändert; bereits bestätigte UUID-Punkte bleiben erhalten. "
                "Nach Behebung dieselbe Sicherung mit denselben Metadaten erneut senden."
            )
            return 1
        log(f"Replay: Batch {batch}/{batches} bestätigt; Ack unverändert.")
    log(
        "Replay erfolgreich: UUID-Punkte ergänzt, alte Namensserien nicht gelöscht, Ack unverändert."
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="TankApp M1-Uploader: JSONL-Ringpuffer → InfluxDB 2.x (NAS)"
    )
    ap.add_argument(
        "--url", default=None, help="InfluxDB-URL (Default: TANKAPP_INFLUX_URL)"
    )
    ap.add_argument("--org", default=None, help="Org (Default: TANKAPP_INFLUX_ORG)")
    ap.add_argument(
        "--bucket", default=None, help="Bucket (Default: TANKAPP_INFLUX_BUCKET)"
    )
    ap.add_argument(
        "--token", default=None, help="Token (Default: TANKAPP_INFLUX_TOKEN)"
    )
    ap.add_argument(
        "--poll-dir",
        type=Path,
        default=DEFAULT_POLL_DIR,
        help="JSONL-Ringpuffer (Default: TANKAPP_POLL_DIR bzw. data/poll)",
    )
    ap.add_argument(
        "--poll-json",
        type=Path,
        default=DEFAULT_POLL_JSON,
        help="polling.json für Stationsnamen (Default: data/analysis/stations/)",
    )
    ap.add_argument(
        "--once",
        action="store_true",
        help="ein Zyklus (Ping + Upload + Ack), dann Ende (Exit 0/1)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Zeilen als Line Protocol zeigen, nichts senden",
    )
    ap.add_argument(
        "--replay",
        action="store_true",
        help="Einmalig ALLE Original-JSONL aus --poll-dir nachliefern, Ack niemals ändern; zuerst --dry-run und eine Sicherung verwenden",
    )
    ap.add_argument(
        "--replay-timezone",
        default=None,
        help="Nur Replay: bestätigte ursprüngliche IANA-Zeitzone für Zeitstempel ohne Offset; vorhandene Offsets bleiben gültig, DST-Lücken/Dopplungen werden abgelehnt",
    )
    args = ap.parse_args()
    if args.replay_timezone is not None and not args.replay:
        ap.error("--replay-timezone ist nur mit --replay zulässig.")

    if args.dry_run:
        if args.replay:
            return run_replay(
                Cfg("", "", "", "", args.poll_dir, args.poll_json),
                dry=True,
                replay_timezone=args.replay_timezone,
            )
        return dry_run(args)

    url = args.url or os.environ.get("TANKAPP_INFLUX_URL", "")
    org = args.org or os.environ.get("TANKAPP_INFLUX_ORG", "")
    bucket = args.bucket or os.environ.get("TANKAPP_INFLUX_BUCKET", "")
    token = args.token or os.environ.get("TANKAPP_INFLUX_TOKEN", "")
    missing = [
        n
        for n, v in (
            ("TANKAPP_INFLUX_URL", url),
            ("TANKAPP_INFLUX_ORG", org),
            ("TANKAPP_INFLUX_BUCKET", bucket),
            ("TANKAPP_INFLUX_TOKEN", token),
        )
        if not v
    ]
    if missing:
        raise SystemExit(
            "Fehlende Konfiguration: "
            + ", ".join(missing)
            + " — auf dem Pi in /etc/tankapp/env (chmod 600, siehe "
            "INSTALL.md Phase C, §3.2)."
        )

    cfg = Cfg(
        url,
        org,
        bucket,
        token,
        args.poll_dir,
        args.poll_json,
        nas_webhook_url=os.environ.get("TANKAPP_NAS_WEBHOOK_URL", ""),
        nas_webhook_token=os.environ.get("TANKAPP_NAS_WEBHOOK_TOKEN", ""),
    )
    state = State()
    if args.replay:
        return run_replay(cfg, replay_timezone=args.replay_timezone)
    if args.once:
        return run_once(cfg, state)
    return run_loop(cfg, state)


if __name__ == "__main__":
    sys.exit(main())
