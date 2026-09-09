#!/usr/bin/env python3
"""
TankApp – M1 Uploader: schiebt die unbestätigten Zeilen des JSONL-Ringpuffers
nach InfluxDB 2.x auf dem NAS (Konzept §9.1). Nur Standardbibliothek.
"""

from __future__ import annotations

import argparse
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
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_POLL_JSON = ROOT / "docs" / "analysis" / "stations" / "polling.json"
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


class Cfg:
    def __init__(
        self,
        url: str,
        org: str,
        bucket: str,
        token: str,
        poll_dir: Path,
        poll_json: Path,
    ):
        self.url = url.rstrip("/")
        self.org = org
        self.bucket = bucket
        self.token = token
        self.poll_dir = poll_dir
        self.poll_json = poll_json
        self.meta_dir = poll_dir / "meta"
        self.ack_file = self.meta_dir / "synced_until"


class State:
    def __init__(self) -> None:
        self.fails = 0
        self.last_ping_fail_log = 0.0
        self.last_overflow_log = 0.0
        self.names_warned = False
        self.last_heartbeat = 0.0


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


def read_ack(meta_dir: Path) -> "dt.datetime | None":
    try:
        s = (meta_dir / "synced_until").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not s:
        return None
    try:
        return parse_ts(s)
    except ValueError:
        log(
            f"⚠ Ack-Datei nicht lesbar ({s!r}) — als 'nichts gesynced' behandelt "
            "(Neusenden ist dank Punkt-Identität in InfluxDB harmlos)."
        )
        return None


def write_ack(meta_dir: Path, ts: dt.datetime) -> None:
    meta_dir.mkdir(parents=True, exist_ok=True)
    tmp = meta_dir / ".synced_until.tmp"
    tmp.write_text(ts.isoformat() + "\n", encoding="utf-8")
    tmp.replace(meta_dir / "synced_until")


def read_unsynced(
    poll_dir: Path, ack: "dt.datetime | None"
) -> "list[tuple[dt.datetime, dict]]":
    rows: "list[tuple[dt.datetime, dict]]" = []
    bad = 0
    if not poll_dir.is_dir():
        return rows
    ack_date = ack.date() if ack else None
    for path in sorted(poll_dir.glob("*.jsonl")):
        try:
            file_date = dt.date.fromisoformat(path.stem)
        except ValueError:
            file_date = None
        if ack_date is not None and file_date is not None and file_date < ack_date:
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    snap = json.loads(line)
                    ts = parse_ts(snap["fetched_at"])
                except (ValueError, KeyError, TypeError):
                    bad += 1
                    continue
                if ack is None or ts > ack:
                    rows.append((ts, snap))
    if bad:
        log(
            f"⚠ {bad} kaputte Puffer-Zeile(n) übersprungen (Abbruch während Schreibens?) "
            "— sie werden nicht nachgeschickt."
        )
    rows.sort(key=lambda r: r[0])
    return rows


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
    city = esc_tag(str(snap.get("city") or "unknown"))
    ns = int(ts.timestamp() * 1_000_000_000)
    out = []
    for uid, rec in (snap.get("prices") or {}).items():
        if not isinstance(rec, dict):
            continue
        station = esc_tag(str(names.get(uid) or uid))
        fields = [f'status="{esc_str(str(rec.get("status") or "no prices"))}"']
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
        station_id = esc_tag(str(uid))
        out.append(
            f"prices,city={city},station={station},station_id={station_id} {','.join(fields)} {ns}"
        )
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


def heartbeat_to_line(heartbeat: dict) -> str | None:
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
    city = esc_tag(str(heartbeat.get("city") or "unknown"))

    fields = []
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

    if not fields:
        return None

    return f"collector_status,host={host},city={city} {','.join(fields)} {ns}"


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
    ack = read_ack(cfg.meta_dir)
    rows = read_unsynced(cfg.poll_dir, ack)

    if rows:
        age_d = (dt.datetime.now().astimezone() - rows[0][0]).total_seconds() / 86400.0
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
            heartbeat_line = heartbeat_to_line(hb)

    if not rows and not heartbeat_line:
        return 0

    names_by_city = load_station_names(cfg.poll_json)
    if not names_by_city and not state.names_warned:
        state.names_warned = True
        log(
            "⚠ Stationsnamen nicht verfügbar (polling.json fehlt?) — station-Tag "
            "enthält die UUID statt des Namens."
        )

    lines: "list[str]" = []
    newest = None
    if rows:
        for ts, snap in rows:
            lines.extend(
                snap_to_lines(ts, snap, names_by_city.get(snap.get("city") or "", {}))
            )
        newest = rows[-1][0]

        if not lines and newest:
            write_ack(cfg.meta_dir, newest)
            log(
                f"⇡ {len(rows)} Zeile(n) ohne Punkt als gesendet markiert "
                f"(synced until {newest.isoformat()})"
            )
            # still try heartbeat below
            lines = []
            newest = None  # don't ack twice

    if heartbeat_line:
        lines.append(heartbeat_line)

    if not lines:
        return 0

    try:
        influx_write(cfg, lines)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
        state.fails += 1
        wait = min(BACKOFF_BASE_S * 2 ** (state.fails - 1), BACKOFF_MAX_S)
        log(
            f"✗ InfluxDB-Write fehlgeschlagen: {explain_write_error(e, cfg)} — "
            f"Versuch in {wait} s (Ack bleibt stehen, nichts geht verloren)."
        )
        return 1

    state.fails = 0
    if newest:
        write_ack(cfg.meta_dir, newest)
        log(
            f"⇡ {len(rows)} Zeile(n) ({len(lines)} Punkte) → InfluxDB "
            f"(synced until {newest.isoformat()})"
        )
    if heartbeat_line:
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
    rows = read_unsynced(args.poll_dir, ack)
    hb = read_heartbeat_file(args.poll_dir)
    hb_line = heartbeat_to_line(hb) if hb else None
    if not rows and not hb_line:
        log(
            f"0 unsynced Zeilen in {args.poll_dir} — Puffer voll gesynct ✓ (oder leer)."
        )
        if hb:
            log(f"[dry-run] Herzschlag vorhanden: {hb_line}")
        return 0
    names_by_city = load_station_names(args.poll_json)
    lines: "list[str]" = []
    for ts, snap in rows:
        lines.extend(
            snap_to_lines(ts, snap, names_by_city.get(snap.get("city") or "", {}))
        )
    if hb_line:
        lines.append(hb_line)
    log(
        f"[dry-run] {len(rows)} unsynced Zeilen "
        f"({rows[0][0].isoformat() if rows else '–'} … {rows[-1][0].isoformat() if rows else '–'}) → {len(lines)} Punkte, "
        "dies WÜRDE per POST /api/v2/write gesendet:"
    )
    for line in lines[:DRYRUN_MAX_LINES]:
        print("  " + line)
    if len(lines) > DRYRUN_MAX_LINES:
        print(f"  … (+{len(lines) - DRYRUN_MAX_LINES} weitere)")
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
        help="polling.json für Stationsnamen (Default: docs/analysis/stations/)",
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

    cfg = Cfg(url, org, bucket, token, args.poll_dir, args.poll_json)
    state = State()
    if args.replay:
        return run_replay(cfg, replay_timezone=args.replay_timezone)
    if args.once:
        return run_once(cfg, state)
    return run_loop(cfg, state)


if __name__ == "__main__":
    sys.exit(main())
