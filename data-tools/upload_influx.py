#!/usr/bin/env python3
"""
TankApp – M1 Uploader: schiebt die unbestätigten Zeilen des JSONL-Ringpuffers
nach InfluxDB 2.x auf dem NAS (Konzept §9.1). Nur Standardbibliothek.

Der Collector (collect_prices.py) hängt je Poll eine JSON-Zeile an
<PUFFER>/YYYY-MM-DD.jsonl. Dieser Uploader — als zweite systemd-Service auf
demselben Pi (tankapp-uploader.service) — überträgt alle Zeilen, deren
Zeitstempel hinter dem Ack (<PUFFER>/meta/synced_until) liegen, nach InfluxDB
und schiebt das Ack **erst nach erfolgreichem Write** weiter (Ack-Protokoll
§9.1). NAS-Ausfall wird so bis zur 7-Tage-Ringpuffertiefe überbrückt
(Überlauf FIFO + Alarm ab 6 Tagen); neu gesendete Zeilen sind harmlos, weil
InfluxDB-Punkte ihre Identität (Measurement+Tags+Timestamp) mitbringen und
doppelte Writes nur überschreiben (idempotent, §1.2).

Line Protocol (Measurement `prices`):
  prices,city=<Stadt>,station=<Name>,station_id=<UUID> status="open",e10=1.620,e5=1.740 <ns>
  * Tags: city (Label aus polling.json), station (Name aus polling.json,
    sonst die UUID), station_id (stabile UUID aus dem Snapshot).
    Gleiche Namen können verschiedene Stationen sein; station_id trennt sie.
  * Felder: status + nur tatsächlich geführte Preise je Sorte —
    `false`/`0` = Sorte NICHT geführt → KEIN Feld, nie 0.000 (§1.2)
  * Zeitstempel: `fetched_at` der Zeile (seit dem UTC-Fix mit Offset, d. h.
    eindeutiger UTC-Moment); alte naive Zeilen = System-Lokalzeit

Konfiguration (Umgebung, z. B. /etc/tankapp/env auf dem Pi, chmod 600 —
nie im Repo; Werte bei uns, siehe INSTALL.md Phase C):
  TANKAPP_INFLUX_URL    http://192.168.178.61:8086
  TANKAPP_INFLUX_ORG    gtwrlab
  TANKAPP_INFLUX_BUCKET tankapp
  TANKAPP_INFLUX_TOKEN  Least-Privilege-Token (auth create --read-bucket --write-bucket)
  TANKAPP_POLL_DIR      Ringpuffer (wie beim Collector; Default: data/poll)

Verhalten:
  * alle 60 s: GET /ping (Liveness) — NAS-Ausfall ist im Log in < 1 min sichtbar
  * Zyklus: unsynced Zeilen lesen → Line Protocol → POST /api/v2/write →
    erst bei 2xx meta/synced_until weiter (atomares Schreiben, nie rückwärts)
  * Fehler: klare Meldung (401/403 Token, 404 Org/Bucket, 400 Line Protocol),
    Backoff 60 s, 2 min, 4 min, … bis 15 min, dann weiter versuchen
  * systemd: Type=notify + WatchdogSec=30 (READY=1 beim Start, WATCHDOG=1
    alle 10 s) — ein NAS-Ausfall ist KEIN Fehlerzustand des Dienstes

Beispiele:
  python3 data-tools/upload_influx.py --dry-run   # Zeilen zeigen, nichts senden
  python3 data-tools/upload_influx.py --once      # ein Zyklus (Test), Exit 0/1
  python3 data-tools/upload_influx.py             # Dauerbetrieb (systemd)
  python3 data-tools/upload_influx.py --replay --dry-run --poll-dir <SICHERUNG>
  # --replay ist einmalig, liest auch bestätigte Original-JSONL-Zeilen,
  # schreibt station_id-Tags und ändert weder Quelldateien noch Ack-Dateien.
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

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_POLL_JSON = ROOT / "docs" / "analysis" / "stations" / "polling.json"
DEFAULT_POLL_DIR = Path(os.environ.get("TANKAPP_POLL_DIR", ROOT / "data" / "poll"))
FUELS = ("e5", "e10", "diesel")
PING_EVERY_S = 60           # Liveness-Ping an den NAS (§9.1)
PING_FAIL_LOG_EVERY_S = 300  # Ping-Fehlalarm im Log höchstens alle 5 min
CYCLE_TICK_S = 10           # Hauptloop-Takt = Watchdog-Nachricht
OVERFLOW_ALARM_DAYS = 6     # Alarm, wenn älteste unsynced Zeile so alt ist (Ringtiefe 7 d)
OVERFLOW_LOG_EVERY_S = 3600
BACKOFF_BASE_S = 60         # 60 s, 2 min, 4 min, … (Verschlechterung bei Wiederholung)
BACKOFF_MAX_S = 900
HTTP_TIMEOUT_S = 30
PING_TIMEOUT_S = 5
DRYRUN_MAX_LINES = 40
REPLAY_BATCH_POINTS = 1000


class Cfg:
    def __init__(self, url: str, org: str, bucket: str, token: str,
                 poll_dir: Path, poll_json: Path):
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


def log(msg: str) -> None:
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def mask_token(token: str) -> str:
    """Token fürs Log unkenntlich machen (Geheimnis, nie voll ausgeben)."""
    if not token:
        return "(leer)"
    if len(token) <= 8:
        return token[:2] + "…"
    return f"{token[:4]}…{token[-4:]} ({len(token)} Zeichen)"


# ------------------------------------------------------------------- Zeitstempel

def parse_ts(s: str) -> dt.datetime:
    """ISO-Zeitstempel → aware Datetime.

    Naive Zeilen (vom Collector vor dem UTC-Fix) werden als
    System-Lokalzeit interpretiert — das war deren Bedeutung.
    """
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
        log(f"⚠ Ack-Datei nicht lesbar ({s!r}) — als 'nichts gesynced' behandelt "
            "(Neusenden ist dank Punkt-Identität in InfluxDB harmlos).")
        return None


def write_ack(meta_dir: Path, ts: dt.datetime) -> None:
    """Ack atomar weiter (tmp + rename) — kein teilgeschriebenes Ack."""
    meta_dir.mkdir(parents=True, exist_ok=True)
    tmp = meta_dir / ".synced_until.tmp"
    tmp.write_text(ts.isoformat() + "\n", encoding="utf-8")
    tmp.replace(meta_dir / "synced_until")


def read_unsynced(poll_dir: Path, ack: "dt.datetime | None") -> "list[tuple[dt.datetime, dict]]":
    """Alle Puffer-Zeilen mit fetched_at > ack, chronologisch sortiert."""
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
        # Ganze Dateien vor dem Ack-Tag sind durchsynchroniert.
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
        log(f"⚠ {bad} kaputte Puffer-Zeile(n) übersprungen (Abbruch während Schreibens?) "
            "— sie werden nicht nachgeschickt.")
    rows.sort(key=lambda r: r[0])
    return rows


# ----------------------------------------------------------------- Stationsnamen

def load_station_names(poll_json: Path) -> "dict[str, dict[str, str]]":
    """polling.json → {City-Label: {uuid: Stationsname}} für den station-Tag."""
    try:
        payload = json.loads(poll_json.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out: "dict[str, dict[str, str]]" = {}
    for city_key, stset in (payload.get("sets") or {}).items():
        if not isinstance(stset, dict):
            continue
        names = {s["uuid"]: (s.get("name") or s["uuid"])
                 for s in stset.get("stations", [])
                 if isinstance(s, dict) and s.get("uuid")}
        if names:
            out[stset.get("label") or city_key] = names
    return out


# ------------------------------------------------------------------ Line Protocol

def esc_tag(v: str) -> str:
    """Tag-Wert: Backslash, Komma, Leerzeichen und Gleichheitszeichen escapen."""
    return v.replace("\\", "\\\\").replace(",", "\\,").replace(" ", "\\ ").replace("=", "\\=")


def esc_str(v: str) -> str:
    """String-Feld: Backslash + Anführungszeichen escapen."""
    return v.replace("\\", "\\\\").replace('"', '\\"')


def snap_to_lines(ts: dt.datetime, snap: dict,
                  names: "dict[str, str]") -> "list[str]":
    """Ein Snapshot → ein Punkt je UUID, einschließlich geschlossener Stationen."""
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
            # §1.2: false/None/0 = Sorte wird nicht geführt → KEIN Feld.
            # bool explizit ausschließen: in Python ist False ein int und
            # würde sonst als 0.000 durchgehen.
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0:
                continue
            fields.append(f"{fu}={float(v):.3f}")
        station_id = esc_tag(str(uid))
        out.append(f"prices,city={city},station={station},station_id={station_id} {','.join(fields)} {ns}")
    return out


# --------------------------------------------------------------------- InfluxDB

def influx_ping(cfg: Cfg) -> "tuple[bool, str]":
    try:
        req = urllib.request.Request(cfg.url + "/ping")
        with urllib.request.urlopen(req, timeout=PING_TIMEOUT_S) as r:
            return True, f"ok (HTTP {r.status})"
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        reason = getattr(e, "reason", None) or (str(e) or type(e).__name__)
        return False, f"unreachable ({reason}) — NAS aus oder TANKAPP_INFLUX_URL={cfg.url} falsch?"


def influx_write(cfg: Cfg, lines: "list[str]") -> None:
    qs = urllib.parse.urlencode({"org": cfg.org, "bucket": cfg.bucket, "precision": "ns"})
    req = urllib.request.Request(
        f"{cfg.url}/api/v2/write?{qs}",
        data="\n".join(lines).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Token {cfg.token}",
                 "Content-Type": "text/plain; charset=utf-8",
                 "User-Agent": "TankApp-Uploader/1.0"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
        if r.status not in (200, 204):
            raise RuntimeError(f"unerwartetes HTTP {r.status} bei /api/v2/write")


def explain_write_error(e: Exception, cfg: Cfg) -> str:
    """Fehler → konkrete Ursache + was wo zu prüfen ist (keine Rätsel)."""
    if isinstance(e, urllib.error.HTTPError):
        code = e.code
        body = ""
        try:
            raw = (e.read().decode("utf-8", "replace") or "").strip()
            body = raw.splitlines()[0][:200] if raw else ""
        except (OSError, IndexError):
            pass
        if code == 401:
            msg = ("Token fehlt/falsch — TANKAPP_INFLUX_TOKEN in /etc/tankapp/env prüfen "
                   "(NAS: 'docker compose exec influxdb influx auth list').")
        elif code == 403:
            msg = (f"Token existiert, aber keine Schreibberechtigung — Token neu anlegen: "
                   f"'influx auth create --org {cfg.org} --read-bucket {cfg.bucket} "
                   f"--write-bucket {cfg.bucket}'.")
        elif code == 404:
            msg = (f"Org '{cfg.org}' oder Bucket '{cfg.bucket}' existiert nicht — "
                   f"TANKAPP_INFLUX_ORG/_BUCKET prüfen (NAS: 'influx org list', "
                   f"'influx bucket list --org {cfg.org}').")
        elif code == 400:
            msg = f"Line Protocol abgelehnt. InfluxDB: {body or '(keine Meldung)'}"
        else:
            msg = f"InfluxDB: {body or '(keine Meldung)'}"
        return f"HTTP {code} — {msg}"
    if isinstance(e, TimeoutError):
        return f"Timeout nach {HTTP_TIMEOUT_S} s — NAS sehr langsam oder nicht erreichbar"
    if isinstance(e, urllib.error.URLError):
        return (f"NAS nicht erreichbar ({e.reason}) — NAS aus oder "
                f"TANKAPP_INFLUX_URL={cfg.url} falsch?")
    return str(e) or type(e).__name__


# ------------------------------------------------------------------ systemd-notify

def sd_notify(state: str) -> None:
    """sd_notify per RAW-Socket (Standardbibliothek): READY=1 / WATCHDOG=1."""
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


# ---------------------------------------------------------------------- Zyklen

def run_upload(cfg: Cfg, state: State) -> int:
    """Einen Upload-Zyklus. Return 0 = ok, 1 = Write fehlgeschlagen."""
    ack = read_ack(cfg.meta_dir)
    rows = read_unsynced(cfg.poll_dir, ack)

    if rows:
        age_d = (dt.datetime.now().astimezone() - rows[0][0]).total_seconds() / 86400.0
        if age_d >= OVERFLOW_ALARM_DAYS and \
                time.time() - state.last_overflow_log >= OVERFLOW_LOG_EVERY_S:
            state.last_overflow_log = time.time()
            log(f"⚠ PUFFER ÜBERFÜLLT: älteste unsynced Zeile ist {age_d:.1f} Tage alt "
                "(Ringpuffer hält nur 7 Tage) — NAS-Ausfall zu lange, älteste Daten "
                "werden FIFO verloren! Uploader + NAS prüfen.")

    if not rows:
        return 0

    names_by_city = load_station_names(cfg.poll_json)
    if not names_by_city and not state.names_warned:
        state.names_warned = True
        log("⚠ Stationsnamen nicht verfügbar (polling.json fehlt?) — station-Tag "
            "enthält die UUID statt des Namens.")

    lines: "list[str]" = []
    for ts, snap in rows:
        lines.extend(snap_to_lines(ts, snap, names_by_city.get(snap.get("city") or "", {})))
    newest = rows[-1][0]

    if not lines:
        # Zeilen ohne einzige Punkt (leerer 'prices') trotzdem acken,
        # sonst blieben sie für immer 'unsynced'.
        write_ack(cfg.meta_dir, newest)
        log(f"⇡ {len(rows)} Zeile(n) ohne Punkt als gesendet markiert "
            f"(synced until {newest.isoformat()})")
        return 0

    try:
        influx_write(cfg, lines)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
        state.fails += 1
        wait = min(BACKOFF_BASE_S * 2 ** (state.fails - 1), BACKOFF_MAX_S)
        log(f"✗ InfluxDB-Write fehlgeschlagen: {explain_write_error(e, cfg)} — "
            f"Versuch in {wait} s (Ack bleibt stehen, nichts geht verloren).")
        return 1

    state.fails = 0
    write_ack(cfg.meta_dir, newest)
    log(f"⇡ {len(rows)} Zeile(n) ({len(lines)} Punkte) → InfluxDB "
        f"(synced until {newest.isoformat()})")
    return 0


def run_once(cfg: Cfg, state: State) -> int:
    ok, detail = influx_ping(cfg)
    log(f"Ping {cfg.url}: {detail}")
    return run_upload(cfg, state)


def run_loop(cfg: Cfg, state: State) -> int:
    log(f"Uploader startet: {cfg.url} org={cfg.org} bucket={cfg.bucket} "
        f"(Token {mask_token(cfg.token)})")
    log(f"Uploader: Puffer {cfg.poll_dir}, Ack {cfg.ack_file}, "
        f"Ping alle {PING_EVERY_S} s, Watchdog alle {CYCLE_TICK_S} s")
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
                if not ok and time.time() - state.last_ping_fail_log >= PING_FAIL_LOG_EVERY_S:
                    state.last_ping_fail_log = time.time()
                    log(f"⚠ Ping {cfg.url} fehlgeschlagen: {detail} — Uploader "
                        "versucht trotzdem weiter, Puffer läuft weiter.")
            rc = run_upload(cfg, state)
            if rc:
                retry_at = time.monotonic() + \
                    min(BACKOFF_BASE_S * 2 ** (state.fails - 1), BACKOFF_MAX_S)
        time.sleep(CYCLE_TICK_S)


def dry_run(args: argparse.Namespace) -> int:
    ack = read_ack(args.poll_dir / "meta")
    rows = read_unsynced(args.poll_dir, ack)
    if not rows:
        log(f"0 unsynced Zeilen in {args.poll_dir} — Puffer voll gesynct ✓ (oder leer).")
        return 0
    names_by_city = load_station_names(args.poll_json)
    lines: "list[str]" = []
    for ts, snap in rows:
        lines.extend(snap_to_lines(ts, snap, names_by_city.get(snap.get("city") or "", {})))
    log(f"[dry-run] {len(rows)} unsynced Zeilen "
        f"({rows[0][0].isoformat()} … {rows[-1][0].isoformat()}) → {len(lines)} Punkte, "
        "dies WÜRDE per POST /api/v2/write gesendet:")
    for line in lines[:DRYRUN_MAX_LINES]:
        print("  " + line)
    if len(lines) > DRYRUN_MAX_LINES:
        print(f"  … (+{len(lines) - DRYRUN_MAX_LINES} weitere)")
    log("[dry-run] nichts gesendet, Ack bleibt stehen.")
    return 0


class ReplayError(ValueError):
    """Credential-/record-free diagnostic for an explicitly requested replay."""


def prepare_replay(poll_dir: Path, poll_json: Path) -> tuple[list[str], int]:
    """Preflight a saved live JSONL buffer before writing ANY points.

    Unlike the normal tailing reader this is strict: no silently skipped bad,
    demo, naive-time or conflicting rows. No ACK read/write and no source edits.
    """
    paths = sorted(poll_dir.glob("*.jsonl"))
    if not paths:
        raise ReplayError("Keine JSONL-Dateien in der angegebenen Sicherung gefunden.")
    names_by_city = load_station_names(poll_json)
    rows = []
    observations = {}
    for path in paths:
        before = path.stat()
        with path.open(encoding="utf-8-sig") as handle:
            for line_no, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                try:
                    snap = json.loads(line)
                    if not isinstance(snap, dict) or snap.get("source") != "tankerkoenig-prices.php":
                        raise ValueError("keine originale Live-Quelle")
                    stamp = dt.datetime.fromisoformat(snap["fetched_at"].replace("Z", "+00:00"))
                    if stamp.tzinfo is None:
                        raise ValueError("UTC-Offset fehlt")
                    city = snap.get("city")
                    prices = snap.get("prices")
                    if not isinstance(city, str) or not city.strip() or any(c in city for c in "\r\n"):
                        raise ValueError("Stadt fehlt/ungültig")
                    if not isinstance(prices, dict):
                        raise ValueError("prices ist kein Objekt")
                    for uid, rec in prices.items():
                        if not isinstance(uid, str) or str(uuid.UUID(uid)) != uid.lower():
                            raise ValueError("ungültige UUID")
                        if not isinstance(rec, dict) or rec.get("status") not in ("open", "closed", "no prices"):
                            raise ValueError("Stationsstatus fehlt/ungültig")
                        if any(isinstance(rec.get(fuel), (int, float)) and not math.isfinite(rec[fuel]) for fuel in FUELS):
                            raise ValueError("nicht endlicher Preis")
                        key = (city, uid, stamp)
                        if key in observations and observations[key] != rec:
                            raise ValueError("widersprüchliche Originalzeilen für dieselbe UUID/Zeit")
                        observations[key] = rec
                    rows.append((stamp, snap))
                except (ValueError, KeyError, TypeError, AttributeError):
                    raise ReplayError(
                        f"Replay-Prüfung fehlgeschlagen: {path.name}, Zeile {line_no}. "
                        "Originale Live-JSONL mit UUIDs, Status und UTC-Offset erforderlich; "
                        "keine Demo-/kaputten/widersprüchlichen Zeilen. Noch nichts geschrieben."
                    ) from None
        after = path.stat()
        if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
            raise ReplayError("Replay-Quelle wurde während des Lesens verändert. Eine ruhende Sicherung verwenden.")
    rows.sort(key=lambda row: row[0])
    lines = []
    for stamp, snap in rows:
        names = names_by_city.get(snap["city"], {})
        if any("\n" in name or "\r" in name for name in names.values()):
            raise ReplayError("Stationsnamen enthalten Zeilenumbrüche; Metadaten prüfen.")
        lines.extend(snap_to_lines(stamp, snap, names))
    # Exact re-copies of the same snapshot need not be sent twice.
    return list(dict.fromkeys(lines)), len(rows)


def run_replay(cfg: Cfg, dry: bool = False) -> int:
    """Explicit one-shot migration/backfill. Even on failure, never touch ACKs."""
    try:
        lines, snapshots = prepare_replay(cfg.poll_dir, cfg.poll_json)
    except ReplayError as exc:
        log(f"Replay abgebrochen: {exc}")
        return 1
    except (ValueError, OSError, TypeError, KeyError, AttributeError):
        log("Replay abgebrochen: Sicherung/Metadaten ungültig oder nicht lesbar; UTF-8, Pfade und Rechte prüfen.")
        return 1
    if not lines:
        log("Replay: keine Stationspunkte vorhanden; nichts geschrieben, Ack unverändert.")
        return 2
    log(f"Replay: {snapshots} Original-Snapshot(s) → {len(lines)} UUID-Punkte. Ack bleibt unverändert.")
    if dry:
        for line in lines[:DRYRUN_MAX_LINES]:
            print("  " + line)
        log("[dry-run] nur Vorschau; keine Netzwerkabfrage, keine Datei-/Ack-Änderung.")
        return 0
    batches = (len(lines) + REPLAY_BATCH_POINTS - 1) // REPLAY_BATCH_POINTS
    for offset in range(0, len(lines), REPLAY_BATCH_POINTS):
        batch = offset // REPLAY_BATCH_POINTS + 1
        try:
            influx_write(cfg, lines[offset:offset + REPLAY_BATCH_POINTS])
        except (urllib.error.HTTPError, urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError, ValueError, RuntimeError) as exc:
            code = f"HTTP {exc.code}" if isinstance(exc, urllib.error.HTTPError) else "Transport-/Write-Fehler"
            log(f"Replay bei Batch {batch}/{batches} abgebrochen ({code}). "
                "Quelle/Ack unverändert; bereits bestätigte UUID-Punkte bleiben erhalten. "
                "Nach Behebung dieselbe Sicherung mit denselben Metadaten erneut senden.")
            return 1
        log(f"Replay: Batch {batch}/{batches} bestätigt; Ack unverändert.")
    log("Replay erfolgreich: UUID-Punkte ergänzt, alte Namensserien nicht gelöscht, Ack unverändert.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="TankApp M1-Uploader: JSONL-Ringpuffer → InfluxDB 2.x (NAS)")
    ap.add_argument("--url", default=None, help="InfluxDB-URL (Default: TANKAPP_INFLUX_URL)")
    ap.add_argument("--org", default=None, help="Org (Default: TANKAPP_INFLUX_ORG)")
    ap.add_argument("--bucket", default=None, help="Bucket (Default: TANKAPP_INFLUX_BUCKET)")
    ap.add_argument("--token", default=None, help="Token (Default: TANKAPP_INFLUX_TOKEN)")
    ap.add_argument("--poll-dir", type=Path, default=DEFAULT_POLL_DIR,
                    help="JSONL-Ringpuffer (Default: TANKAPP_POLL_DIR bzw. data/poll)")
    ap.add_argument("--poll-json", type=Path, default=DEFAULT_POLL_JSON,
                    help="polling.json für Stationsnamen (Default: docs/analysis/stations/)")
    ap.add_argument("--once", action="store_true",
                    help="ein Zyklus (Ping + Upload + Ack), dann Ende (Exit 0/1)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Zeilen als Line Protocol zeigen, nichts senden")
    ap.add_argument("--replay", action="store_true",
                    help="Einmalig ALLE Original-JSONL aus --poll-dir nachliefern, Ack niemals ändern; zuerst --dry-run und eine Sicherung verwenden")
    args = ap.parse_args()

    if args.dry_run:
        if args.replay:
            return run_replay(Cfg("", "", "", "", args.poll_dir, args.poll_json), dry=True)
        return dry_run(args)

    url = args.url or os.environ.get("TANKAPP_INFLUX_URL", "")
    org = args.org or os.environ.get("TANKAPP_INFLUX_ORG", "")
    bucket = args.bucket or os.environ.get("TANKAPP_INFLUX_BUCKET", "")
    token = args.token or os.environ.get("TANKAPP_INFLUX_TOKEN", "")
    missing = [n for n, v in (("TANKAPP_INFLUX_URL", url), ("TANKAPP_INFLUX_ORG", org),
                              ("TANKAPP_INFLUX_BUCKET", bucket),
                              ("TANKAPP_INFLUX_TOKEN", token)) if not v]
    if missing:
        raise SystemExit("Fehlende Konfiguration: " + ", ".join(missing) +
                         " — auf dem Pi in /etc/tankapp/env (chmod 600, siehe "
                         "INSTALL.md Phase C, §3.2).")

    cfg = Cfg(url, org, bucket, token, args.poll_dir, args.poll_json)
    state = State()
    if args.replay:
        return run_replay(cfg)
    if args.once:
        return run_once(cfg, state)
    return run_loop(cfg, state)


if __name__ == "__main__":
    sys.exit(main())
