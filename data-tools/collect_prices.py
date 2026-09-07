#!/usr/bin/env python3
"""
TankApp – M1 Collector: pollt die 10 selektierten Stationen live von der
Tankerkönig-Preis-API (prices.php, 1 Request für bis zu 10 UUIDs) und
schreibt die Snapshots als JSONL in einen Ringpuffer (7 Tage), ganz nach
docs/KONZEPT.md §1.2/§7/§9.1.

Läuft auf dem Raspberry Pi 24/7 (nur Standardbibliothek, ~40-60 MiB RSS);
der NAS-InfluxDB-Uploader (§9.1) ist ein späterer Schritt — hier wird erst
mal gepuffert.

Fenster/Kadenz: 1 Poll / 5 min (hart, Token-Bucket) im Fenster 06:00-24:00
(§7: nachts sind alle Stationen zu, Extra-Polls liefern nichts). Vor-
/mitternachtspuffer auf /dev/shm beim Pi, sonst data/poll/.

Zeitstempel: `fetched_at` wird **mit UTC-Offset** gespeichert (§9.3 „UTC
speichern") — das ist ein eindeutiger UTC-Moment, egal in welcher Zeitzone
der Pi läuft. Tabelle und Dateiname bleiben Lokalzeit. Der InfluxDB-
Uploader (upload_influx.py) interpretiert alte naive Zeilen (vor diesem
Fix) als System-Lokalzeit.

API-Key (kostenlos, MTS-K CreativeCommons): einer von
  * --api-key
  * Umgebungsvariable TANKERKOENIG_API_KEY
  * Datei data/apikey.txt (eine Zeile, gitignored)
ohne Key nur --demo (simulierte Preise, zum Testen ohne Netz/Key).

Statusfälle (§1.2):
  "open"   -> Preise schreiben; `false` = Sorte wird NICHT geführt -> weglassen
  "closed" -> Status schreiben, keinen Preis (letzter Preis gilt am Hahn weiter;
              die Engine markiert die Spanne später als stale, §3.1)
  "no prices" -> Status schreiben; nach 7 Tagen ohne Daten -> Alarm (gezählt)

Beispiele:
  python3 data-tools/collect_prices.py --once            # ein Poll, Tabelle zeigen
  python3 data-tools/collect_prices.py                   # Dauerbetrieb 06-24 Uhr
  python3 data-tools/collect_prices.py --demo --once     # ohne Key/Netz testen
  python3 data-tools/collect_prices.py --poll-json docs/analysis/stations/polling.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_POLL_JSON = ROOT / "docs" / "analysis" / "stations" / "polling.json"
DEFAULT_OUT = Path(os.environ.get("TANKAPP_POLL_DIR", ROOT / "data" / "poll"))
API_URL = "https://creativecommons.tankerkoenig.de/json/prices.php"
FUELS = ("e5", "e10", "diesel")
RING_DAYS = 7
# Lizenz/Etikette (§1.3): Token-Bucket 1 Request / 300 s hart, 429 -> 60 s Pause.
POLL_INTERVAL_S = 300
BACKOFF_429_S = 60

# Tankerkönig-IDs und -Keys sind UUIDs. Der API-Check dient nur dazu, GARANTIERT
# kaputte Eingaben sofort (und verständlich) zu melden, statt auf das kryptische
# "parameter error" der API zu warten.
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
                     r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def is_uuid(value: str) -> bool:
    return bool(value) and UUID_RE.match(value) is not None


def mask_key(key: str) -> str:
    """Key fürs Log unkenntlich machen (Geheimnis, nie voll ausgeben)."""
    if not key:
        return "(leer)"
    if len(key) <= 8:
        return key[:2] + "…"
    return f"{key[:4]}…{key[-4:]} ({len(key)} Zeichen)"


def explain_api_error(msg: str) -> str:
    """ok=false-Meldung der API -> verständlicher Text mit Hinweis auf die Ursache.

    Empirisch (prices.php, 2026-09):
      * 'parameter error'            == ids ODER apikey kamen leer/fehlend an
      * 'Key existiert nicht …'      == Key unbekannt/deaktiviert
      * '… nicht im korrekten Format' == mind. eine UUID hat nicht das UUID-Format
    """
    low = (msg or "").lower()
    if "parameter error" in low:
        return ("API ok=false: 'parameter error' — d. h. ids ODER apikey kamen leer "
                "bei der API an. Prüfe polling.json (batch-UUIDs) und data/apikey.txt. "
                "Falls ein HTTPS-Proxy gesetzt ist (http_proxy/https_proxy), kann er "
                "den Aufruf verfälschen.")
    if "key existiert nicht" in low:
        return ("API ok=false: 'Key existiert nicht oder ist deaktiviert' — der Key in "
                "data/apikey.txt ist unbekannt oder nicht aktiviert. Key auf "
                "tankerkoenig.de prüfen.")
    if "nicht im korrekten format" in low:
        return ("API ok=false: 'eine oder mehrere Tankstellen-IDs nicht im korrekten "
                "Format' — polling.json enthält UUIDs außerhalb des Formats "
                "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.")
    return f"API ok=false: {msg!r}"


def log(msg: str) -> None:
    print(f"[{dt.datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def find_api_key(explicit: str | None) -> str | None:
    if explicit:
        return explicit.strip()
    env = os.environ.get("TANKERKOENIG_API_KEY")
    if env:
        return env.strip()
    for p in (ROOT / "data" / "apikey.txt", ROOT / "apikey.txt"):
        try:
            key = p.read_text(encoding="utf-8").strip().splitlines()[0].strip()
            if key:
                return key
        except (OSError, IndexError):
            pass
    return None


def load_poll_set(path: Path, city: str | None) -> dict:
    if not path.exists():
        raise SystemExit(f"polling.json fehlt: {path} — erst data-tools/run_pipeline.py "
                         "laufen lassen (baut das Polling-Set).")
    payload = json.loads(path.read_text(encoding="utf-8"))
    sets = payload.get("sets") or {}
    if not sets:
        raise SystemExit(f"{path}: keine 'sets' (leer?).")
    if city:
        if city not in sets:
            raise SystemExit(f"Stadt '{city}' nicht in {path} (vorhanden: {', '.join(sets)})")
        return sets[city]
    if len(sets) == 1:
        return next(iter(sets.values()))
    raise SystemExit(f"Mehrere Städte in {path} ({', '.join(sets)}) — --poll-city wählen.")


# ----------------------------------------------------------------- Poll-API

def fetch_prices(api_key: str, ids: list[str], timeout: int = 30) -> dict:
    """prices.php für bis zu 10 UUIDs. Rückgabe: {uuid: {status, e5?, e10?, diesel?}}."""
    qs = urllib.parse.urlencode({"ids": ",".join(ids), "apikey": api_key})
    url = f"{API_URL}?{qs}"
    req = urllib.request.Request(url, headers={"User-Agent": "TankApp-Collector/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        payload = json.loads(r.read().decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(explain_api_error(payload.get("message") or ""))
    return payload.get("prices") or {}


def normalize(raw_prices: dict, ids: list[str]) -> dict:
    """API-Rohantwort -> kompakten Snapshot je Station (§1.2 Fallstricke)."""
    out: dict[str, dict] = {}
    for uid in ids:
        st = raw_prices.get(uid) or {}
        status = st.get("status") or "no prices"
        rec: dict = {"status": status}
        if status == "open":
            for fu in FUELS:
                v = st.get(fu)
                # false/None = Sorte wird nicht geführt -> GAR KEINEN Punkt (nicht 0)
                if isinstance(v, (int, float)) and v > 0:
                    rec[fu] = round(float(v), 3)
        out[uid] = rec
    return out


def demo_prices(ids: list[str], stations: dict, fuel: str) -> dict:
    """Simulierte Preise für --demo: Intraday-Zyklus (Morgensprung, Abendtief)
    + stations-feste δ̂-Offsets aus polling.json, damit der Collector ohne
    Key/Netz testbar ist."""
    now = dt.datetime.now()
    h = now.hour + now.minute / 60.0
    # Basiszyklus ct/L: morgens hoch (~+5 ct um 7 h), abends tief (~-4 ct um 20 h)
    cyc = 4.5 * math.sin((h - 9) / 24 * 2 * math.pi) + 1.5
    base = 1.62
    out: dict[str, dict] = {}
    for uid in ids:
        meta = stations.get(uid, {})
        delta_ct = float(meta.get("delta_ct", 0.0) or 0.0)
        closed = (now.hour < 6)  # nachts zu (im Demo nicht abgefragt, aber falls doch)
        price = round(base + (cyc + delta_ct) / 100.0, 3)
        rec = {"status": "closed" if closed else "open"}
        if not closed:
            rec[fuel] = price
            rec["e5" if fuel != "e5" else "diesel"] = round(price + 0.12, 3)
        out[uid] = rec
    return out


# ------------------------------------------------------------- Ringpuffer/IO

def write_snapshot(out_dir: Path, snap: dict) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = dt.datetime.fromisoformat(snap["fetched_at"])
    path = out_dir / f"{ts.date().isoformat()}.jsonl"
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(snap, ensure_ascii=False, separators=(",", ":")) + "\n")
    return path


def ring_prune(out_dir: Path, keep_days: int = RING_DAYS) -> list[str]:
    """JSONL-Dateien löschen, die älter als die Puffertiefe sind (FIFO, §9.1).

    Puffer = keep_days Tag-DATEIEN: der heutige Tag plus die (keep_days-1)
    vorherigen bleiben (7 Tage Tiefe -> die Dateien 'heute' bis 'heute-6',
    'heute-7' fällt raus), also gelöscht ab Alter >= keep_days.
    """
    cutoff = dt.date.today() - dt.timedelta(days=keep_days - 1)
    removed = []
    for p in out_dir.glob("*.jsonl"):
        try:
            d = dt.date.fromisoformat(p.stem)
        except ValueError:
            continue
        if d < cutoff:
            p.unlink()
            removed.append(p.name)
    return removed


# ------------------------------------------------------------------ Ausgabe

def print_table(snap: dict, stset: dict, fuel: str) -> None:
    """Aktuelle Preise der 10 Stationen, billigste zuerst (live 'wo ist es
    gerade am günstigsten' — die Vorstufe der Ampel)."""
    stations = {s["uuid"]: s for s in stset.get("stations", [])}
    rows = []
    for uid, rec in snap["prices"].items():
        meta = stations.get(uid, {})
        p = rec.get(fuel)
        if rec["status"] == "open" and p is not None:
            rows.append((p, uid, meta, rec))
    rows.sort(key=lambda r: r[0])
    print(f"\nAktuelle {fuel.upper()}-Preise  ({snap['fetched_at'][11:16]} Uhr, "
          f"{len(rows)} offen):")
    print(f"  {'#':>2} {'€/L':>5}  {'Gruppe':<11} {'Station'[:36]}")
    for i, (p, uid, meta, rec) in enumerate(rows, 1):
        grp = meta.get("group", "?")
        name = (meta.get("name") or uid)[:36]
        mark = " ← billigste" if i == 1 else ""
        print(f"  {i:>2} {p:5.3f}  {grp:<11} {name}{mark}")
    closed = [uid for uid, r in snap["prices"].items() if r["status"] != "open"]
    if closed:
        print(f"  ({len(closed)} Stationen geschlossen/ohne Preis)")


# --------------------------------------------------------------------- Loop

def seconds_until_window(now: dt.datetime, start_h: int) -> float:
    """Sekunden bis zum nächsten Fensterbeginn (start_h Uhr)."""
    target = now.replace(hour=start_h, minute=0, second=0, microsecond=0)
    if now >= target:
        target += dt.timedelta(days=1)
    return (target - now).total_seconds()


def in_poll_window(now: dt.datetime, start_h: int, end_h: int) -> bool:
    return start_h <= now.hour < end_h


def main() -> int:
    ap = argparse.ArgumentParser(description="TankApp M1-Collector: live-Preise der 10 Polling-Stationen")
    ap.add_argument("--poll-json", type=Path, default=DEFAULT_POLL_JSON,
                    help="Polling-Set aus run_pipeline.py")
    ap.add_argument("--poll-city", default=None, help="Stadt bei mehreren Sets")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT,
                    help="Puffer-Verzeichnis (Pi: /dev/shm/tankapp)")
    ap.add_argument("--fuel", default="e10", choices=["e5", "e10", "diesel"])
    ap.add_argument("--api-key", default=None, help="Tankerkönig-Key (Default: "
                    "TANKERKOENIG_API_KEY bzw. data/apikey.txt)")
    ap.add_argument("--interval", type=int, default=POLL_INTERVAL_S,
                    help="Sekunden je Poll (Default 300 = 1/5 min, Limit der API)")
    ap.add_argument("--window-start", type=int, default=6, help="Fensterbeginn Stunde")
    ap.add_argument("--window-end", type=int, default=24, help="Fensterende Stunde")
    ap.add_argument("--once", action="store_true", help="ein Poll, dann beenden")
    ap.add_argument("--demo", action="store_true", help="simulierte Preise (kein Key/Netz)")
    args = ap.parse_args()

    stset = load_poll_set(args.poll_json, args.poll_city)
    ids = stset.get("batch") or [s["uuid"] for s in stset.get("stations", [])]
    stations = {s["uuid"]: s for s in stset.get("stations", [])}
    if not ids:
        raise SystemExit("Polling-Set enthält keine UUIDs.")
    # Garantiert kaputte UUIDs sofort melden statt auf das kryptische
    # "parameter error"/"nicht im korrekten Format" der API zu warten.
    bad_ids = [i for i in ids if not is_uuid(i)]
    if bad_ids:
        preview = ", ".join(repr(str(b))[:42] for b in bad_ids[:3])
        log(f"⚠ {len(bad_ids)} von {len(ids)} UUIDs haben kein gültiges UUID-Format "
            f"({preview}{' …' if len(bad_ids) > 3 else ''}) — diese Stationen werden "
            "übersprungen. polling.json neu erzeugen (run_pipeline.py)!")
        ids = [i for i in ids if is_uuid(i)]
    if not ids:
        raise SystemExit("Polling-Set enthält keine gültigen UUIDs — polling.json "
                         "(docs/analysis/stations/polling.json) prüfen/neu erzeugen.")
    log(f"{len(ids)} Stationen im Set ({stset.get('label', '?')}), "
        f"Fenster {args.window_start:02d}-{args.window_end:02d} Uhr, "
        f"Puffer {args.out}")

    api_key = None if args.demo else find_api_key(args.api_key)
    if not args.demo and not api_key:
        raise SystemExit("Kein Tankerkönig-API-Key (--api-key / Umgebungsvariable "
                         "TANKERKOENIG_API_KEY / data/apikey.txt). Kostenlos registrieren "
                         "auf tankerkoenig.de, oder --demo zum Testen.")
    if api_key and not is_uuid(api_key):
        log(f"⚠ API-Key sieht nicht nach einer UUID aus ({mask_key(api_key)}) — "
            "data/apikey.txt muss GENAU eine Zeile im Format "
            "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx enthalten (nur den Key, kein Label).")
    proxy_env = sorted(k for k in os.environ
                       if k.lower() in ("http_proxy", "https_proxy", "all_proxy"))
    if proxy_env:
        log(f"⚠ Proxy-Umgebung gesetzt ({', '.join(proxy_env)}) — urllib routet darüber. "
            "Falls Polls mit 'parameter error' scheitern, kann der Proxy den Aufruf "
            "verfälschen (prüfen: env | grep -i proxy).")

    # Puffer-Verzeichnis früh prüfen: existiert und für den Dienst-User beschreibbar?
    # (Sonst läuft der erste Poll erst erfolgreich und crasht DANN beim Schreiben mit
    #  einem PermissionError — klassisch: /dev/shm/tankapp per sudo root-owned angelegt.)
    try:
        args.out.mkdir(parents=True, exist_ok=True)
        probe = args.out / ".write_test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except OSError as e:
        raise SystemExit(
            f"Puffer {args.out} nicht beschreibbar: {e} — das Verzeichnis muss für den "
            "Dienst-User beschreibbar sein, z. B. "
            f"'sudo install -d -o pi -g pi -m 0755 {args.out}' "
            "(oder --out auf ein beschreibbares Verzeichnis setzen).")

    stale_no_price: dict[str, int] = {}
    while True:
        # Mit Offset (§9.3 „UTC speichern"): eindeutiger UTC-Moment; Anzeige
        # (.hour, Tabelle) und Dateiname bleiben Lokalzeit (gleiche Uhrzeit).
        now = dt.datetime.now().astimezone()
        if not in_poll_window(now, args.window_start, args.window_end):
            if args.once:
                log(f"außerhalb des Fensters {args.window_start:02d}-{args.window_end:02d} "
                    "Uhr — --once pollt trotzdem einmal (Test).")
                # bei --once nicht schlafen, direkt einen Poll durchführen
            else:
                wait = seconds_until_window(now, args.window_start)
                log(f"Fenster zu (vor {args.window_start:02d} Uhr) — schlafe "
                    f"{wait/3600:.1f} h bis zum Fensterbeginn.")
                time.sleep(min(wait, 3600))
                continue

        try:
            if args.demo:
                raw = demo_prices(ids, stations, args.fuel)
                prices = raw
            else:
                prices = normalize(fetch_prices(api_key, ids), ids)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                log(f"429 (Kontingent) — {BACKOFF_429_S} s Backoff.")
                time.sleep(BACKOFF_429_S)
                continue
            log(f"HTTP {e.code}: {e} — wiederhole in {args.interval} s.")
            time.sleep(args.interval)
            continue
        except RuntimeError as e:
            # ok=false der API — in der Meldung steckt jetzt die konkrete Ursache.
            log(f"Poll fehlgeschlagen: {e}")
            log(f"  Request-Kontext: {len(ids)} ids, Key {mask_key(api_key or '')} — "
                f"wiederhole in {args.interval} s.")
            time.sleep(args.interval)
            continue
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            log(f"Poll fehlgeschlagen ({type(e).__name__}: {e}) — wiederhole in "
                f"{args.interval} s.")
            time.sleep(args.interval)
            continue

        snap = {"fetched_at": now.replace(microsecond=0).isoformat(),
                "source": "demo" if args.demo else "tankerkoenig-prices.php",
                "city": stset.get("label"), "prices": prices}
        try:
            path = write_snapshot(args.out, snap)
        except OSError as e:
            log(f"✗ Puffer nicht beschreibbar: {e} — Ownership von {args.out} prüfen "
                f"(Dienst-User muss schreiben dürfen). Wiederhole in {args.interval} s.")
            time.sleep(args.interval)
            continue
        n_open = sum(1 for r in prices.values() if r["status"] == "open")
        log(f"Poll ok: {n_open}/{len(ids)} offen → {path.name}")

        # 'no prices' über Tage zählen (§1.2: nach 7 Tagen aus dem Monitoring -> Alarm)
        for uid, rec in prices.items():
            if rec["status"] == "no prices":
                stale_no_price[uid] = stale_no_price.get(uid, 0) + 1
                if stale_no_price[uid] >= 7:
                    log(f"⚠ {uid} seit 7 Polls 'no prices' — aus Monitoring prüfen!")
            else:
                stale_no_price.pop(uid, None)

        removed = ring_prune(args.out)
        if removed:
            log(f"Ringpuffer: {len(removed)} alte Tag(e) gelöscht ({removed[0]} …).")

        print_table(snap, stset, args.fuel)
        if args.once:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
