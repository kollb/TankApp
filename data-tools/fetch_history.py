#!/usr/bin/env python3
"""
TankApp – Schritt 0: historische Tankerkönig-Tagesdateien holen, ohne das Riesen-Repo zu clonen.

Warum kein `git clone`? Das Daten-Repo enthält eine CSV pro Tag seit 2014 (~4,5 GB/Tag
History, Repo ausgepackt >50 GB). Sparse-Checkout entpackt zwar nur die gewünschten
Dateien, lädt aber trotzdem alles herunter; Gitea unterstützt Partial Clone
(`--filter=blob:none`) in der Regel nicht. Also: Tagesdateien direkt per HTTP vom
Raw-Endpoint holen — idempotent, fortsetzbar, datensparsam.

Nur Standardbibliothek → läuft auf Pi, NAS-Shell und PC ohne `pip install`.

Beispiele
---------
# Zugangsdaten einmalig setzen (NIE ins Repo committen):
export TK_BASE="https://data.tankerkoenig.de/tankerkoenig-organization/tankerkoenig-data"
export TK_LOGIN="koll.bernhard_gmail.com"
export TK_TOKEN="<API-KEY>"

# 1) Erst schauen, dann laden (zeigt Größen + Hochrechnung, lädt nichts):
python3 data-tools/fetch_history.py --since 2025-01-01 --dry-run

# 2) Anprobieren: nur die letzten 5 Tage
python3 data-tools/fetch_history.py --since 2025-01-01 --only 5

# 3) Kompletter Zeitraum (setzt beim nächsten Lauf fort, vorhandene Tage werden übersprungen):
python3 data-tools/fetch_history.py --since 2025-01-01

# 4) Nur die aktuellste Tankstellenliste (Metadaten: Name, Marke, PLZ, Koordinaten):
python3 data-tools/fetch_history.py --stations-latest

# 5) Täglich per cron (ein Tag ≈ 20 MB, dauert Sekunden):
#    20 6 * * *  cd /srv/tankapp/TankApp && python3 data-tools/fetch_history.py --since yesterday --quiet >> data/raw/fetch.log 2>&1

Ablage: data/raw/prices/YYYY/MM/YYYY-MM-DD-prices.csv.gz
        data/raw/stations/YYYY/MM/YYYY-MM-DD-stations.csv.gz
Lizenz der Datensammlung: CC BY-NC-SA 4.0 (nicht-kommerziell).
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import getpass
import gzip
import io
import netrc
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "tankapp-history/1.0 (persoenliches Projekt)"
DEFAULT_BASE = "https://data.tankerkoenig.de/tankerkoenig-organization/tankerkoenig-data"
DEFAULT_BRANCH = "master"
DAY = dt.timedelta(days=1)


# ------------------------------------------------------------------ Zugang


def netrc_credentials(path: str, host: str) -> tuple[str, str] | None:
    """Login/Passwort aus einer netrc-Datei (empfohlen: ~/.netrc, chmod 600)."""
    try:
        entry = netrc.netrc(path).authenticators(host)
    except (FileNotFoundError, netrc.NetrcParseError, OSError):
        return None
    if not entry:
        return None
    login, _, password = entry
    return login or "", password or ""


def credentials(args: argparse.Namespace) -> str | None:
    """'user:token' für Basic-Auth, sonst None (offenes Repo / Helper im Git-Credential-Store)."""
    login = args.login or os.environ.get("TK_LOGIN")
    token = args.token or os.environ.get("TK_TOKEN")
    host = urllib.parse.urlparse(args.base).netloc
    if not args.no_netrc and (not login or not token):
        for p in (args.netrc, os.path.expanduser("~/.netrc")):
            got = netrc_credentials(p, host) if p else None
            if got:
                login, token = login or got[0], token or got[1]
                break
    if login and not token and sys.stdin.isatty() and not args.no_prompt:
        token = getpass.getpass(f"API-Key für {login}@{host}: ")
    if not login or not token:
        return None
    return f"{login}:{token}"


def make_headers(userinfo: str | None) -> dict:
    headers = {"User-Agent": UA, "Accept-Encoding": "identity"}
    if userinfo:
        headers["Authorization"] = "Basic " + base64.b64encode(userinfo.encode()).decode()
    return headers


# --------------------------------------------------------------------- HTTP


class HttpError(Exception):
    def __init__(self, code: int, msg: str, retry_after: int | None = None):
        super().__init__(f"HTTP {code}: {msg}")
        self.code, self.retry_after = code, retry_after


def fetch(url: str, headers: dict, method: str = "GET", timeout: int = 120,
          extra: dict | None = None) -> tuple[bytes, dict]:
    h = dict(headers)
    if extra:
        h.update(extra)
    req = urllib.request.Request(url, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        ra = e.headers.get("Retry-After")
        raise HttpError(e.code, url, int(ra) if ra and ra.isdigit() else None) from e
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        raise HttpError(0, f"{url} ({e})") from e


def content_length(url: str, headers: dict, timeout: int = 60) -> int | None:
    """Größe einer Datei: erst HEAD, sonst Range-Trick. None wenn unbekannt."""
    try:
        _, hdr = fetch(url, headers, "HEAD", timeout)
        if hdr.get("Content-Length"):
            return int(hdr["Content-Length"])
    except HttpError as e:
        if e.code not in (400, 405, 501):
            raise
    try:
        req = urllib.request.Request(url, headers={**headers, "Range": "bytes=0-0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            cr = r.headers.get("Content-Range")
            if cr and "/" in cr:
                return int(cr.rsplit("/", 1)[-1])
    except Exception:  # nur Zusatzinfo, kein Abbruch
        pass
    return None


# ------------------------------------------------------------------- Pfade


def raw_url(base: str, branch: str, path: str) -> str:
    return f"{base.rstrip('/')}/raw/branch/{branch}/" + "/".join(
        urllib.parse.quote(p) for p in path.split("/"))


def repo_path(kind: str, date: dt.date) -> str:
    return f"{kind}/{date.year:04d}/{date.month:02d}/{date.isoformat()}-{kind}.csv"


def local_path(outdir: str, kind: str, date: dt.date, gz: bool) -> str:
    name = f"{date.isoformat()}-{kind}.csv" + (".gz" if gz else "")
    return os.path.join(outdir, kind, f"{date.year:04d}", f"{date.month:02d}", name)


def daterange(d0: dt.date, d1: dt.date):
    d = d0
    while d <= d1:
        yield d
        d += DAY


def parse_date(s: str, today: dt.date) -> dt.date:
    s = s.strip().lower()
    if s in ("today", "heute"):
        return today
    if s in ("yesterday", "gestern"):
        return today - DAY
    try:
        if len(s) == 4 and s.isdigit():
            return dt.date(int(s), 1, 1)
        if len(s) == 7 and s[4] == "-":
            return dt.date(int(s[:4]), int(s[5:]), 1)
        return dt.date.fromisoformat(s)
    except ValueError:
        raise SystemExit(f"Datum nicht verstanden: {s!r} (erwartet YYYY-MM-DD, YYYY-MM, YYYY, "
                         "'yesterday' oder 'today')")


# --------------------------------------------------------------------- Kern


def download(url: str, dest: str, headers: dict, args: argparse.Namespace) -> tuple[str, int]:
    """Eine Datei laden. -> Status, übertragene Bytes."""
    if os.path.exists(dest) and os.path.getsize(dest) > 0 and not args.force:
        return "skip", 0
    body = None
    for attempt in range(1, args.retries + 1):
        try:
            body = fetch(url, headers, "GET", args.timeout)[0]
            break
        except HttpError as e:
            if e.code in (404, 451):
                return "missing", 0
            if e.code in (401, 403):
                print(f"    ! Zugriff verweigert ({e.code}) — Login/API-Key prüfen, "
                      f"URL: {url}", file=sys.stderr)
                return "auth", 0
            if attempt == args.retries:
                print(f"    ! {e}", file=sys.stderr)
                return "error", 0
            wait = e.retry_after or min(args.backoff * 2 ** (attempt - 1), 120)
            if not args.quiet:
                print(f"    … {e.code or 'Netzwerk'}, Versuch {attempt}/{args.retries}, "
                      f"warte {wait:.0f}s", file=sys.stderr)
            time.sleep(wait)
    if body is None:
        return "error", 0
    payload = body if args.raw_no_gzip else _gzip_bytes(body, args.compresslevel)
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    tmp = dest + ".part"
    with open(tmp, "wb") as f:
        f.write(payload)
    os.replace(tmp, dest)
    return "ok", len(body)


def _gzip_bytes(data: bytes, level: int) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=level, mtime=0) as gz:
        gz.write(data)
    return buf.getvalue()


def plan(args: argparse.Namespace, since: dt.date, until: dt.date):
    kinds = ["prices", "stations"] if args.kind == "both" else [args.kind]
    days = list(daterange(since, until))
    if args.only:
        days = days[-args.only:]
    for kind in kinds:
        for d in days:
            yield kind, d, local_path(args.outdir, kind, d, not args.raw_no_gzip), \
                raw_url(args.base, args.branch, repo_path(kind, d))


def run(args: argparse.Namespace) -> int:
    today = dt.date.today()
    since, until = parse_date(args.since, today), parse_date(args.until, today)
    if until < since:
        raise SystemExit("--until liegt vor --since")
    userinfo = credentials(args)
    headers = make_headers(userinfo)
    if not args.quiet:
        host = urllib.parse.urlparse(args.base).netloc
        print(f"# {host}  {'auth als ' + userinfo.split(':', 1)[0] if userinfo else 'ohne Auth'}")
    todo = list(plan(args, since, until))

    if args.dry_run:
        need = [t for t in todo if not (os.path.exists(t[2]) and os.path.getsize(t[2]) > 0)]
        print(f"# {len(todo)} Dateien im Bereich {since}..{until}, davon {len(need)} zu laden")
        sizes = []
        errors = 0
        for kind, d, _, url in need[:args.probe]:
            try:
                n = content_length(url, headers)
            except HttpError as e:
                errors += 1
                print(f"  {kind:8} {d}  Fehler {e}")
                continue
            if n:
                sizes.append(n)
                print(f"  {kind:8} {d}  {n/1e6:7.2f} MB")
            else:
                print(f"  {kind:8} {d}  Größe unbekannt")
        if sizes:
            avg = sum(sizes) / len(sizes)
            print(f"# Ø {avg/1e6:.1f} MB/Datei → Hochrechnung: {len(need)*avg/1e9:.1f} GB Download, "
                  f"≈ {len(need)*avg/1e9*args.gz_factor:.1f} GB auf der Platte (gz)")
            print(f"#   bei {args.speed_mbs:.1f} MB/s ≈ {len(need)*avg/1e6/args.speed_mbs/3600:.1f} h "
                  f"(inkl. {args.delay}s Pause/Datei: "
                  f"+{len(need)*args.delay/3600:.1f} h)")
        else:
            hint = "kein Netz/Server nicht erreichbar" if errors else "ggf. Auth fehlt oder HEAD blockiert"
            print(f"# Keine Größe ermittelbar — {hint}.")
        print("# (--dry-run: nichts geladen)")
        return 0

    counts = dict(ok=0, skip=0, missing=0, error=0, auth=0)
    t0 = time.time()
    net_bytes = 0
    for i, (kind, d, dest, url) in enumerate(todo, 1):
        status, nbytes = download(url, dest, headers, args)
        counts[status] = counts.get(status, 0) + 1
        net_bytes += nbytes
        if not args.quiet and (status == "ok" or status in ("auth",)):
            secs = max(time.time() - t0, 1e-6)
            print(f"[{i}/{len(todo)}] {kind} {d} ok {nbytes/1e6:.1f} MB | "
                  f"{net_bytes/1e6:.0f} MB, {net_bytes/1e6/secs:.1f} MB/s")
        if status == "auth":
            break
        if status == "ok" and args.delay:
            time.sleep(args.delay)
    mins = (time.time() - t0) / 60
    print(f"# geladen {counts.get('ok',0)} | übersprungen {counts.get('skip',0)} | "
          f"nicht gefunden {counts.get('missing',0)} | Fehler {counts.get('error',0)} | "
          f"Auth {counts.get('auth',0)}")
    print(f"# {net_bytes/1e9:.2f} GB in {mins:.1f} min ({net_bytes/1e6/max(mins*60,1e-6):.1f} MB/s)"
          f" → {args.outdir}/")
    if counts.get("error"):
        print("# Fehler meist Rate-Limit/Netzwerk: Skript erneut starten, es setzt fort.",
              file=sys.stderr)
    return 1 if (counts.get("error") or counts.get("auth")) else 0


def stations_latest(args: argparse.Namespace) -> int:
    """Aktuellste Tankstellenliste finden und holen (blind absteigend, ohne API)."""
    today = dt.date.today()
    headers = make_headers(credentials(args))
    for delta in range(0, 62):  # bis ~2 Monate zurück
        d = today - dt.timedelta(days=delta)
        url = raw_url(args.base, args.branch, repo_path("stations", d))
        try:
            n = content_length(url, headers)
        except HttpError as e:
            if e.code in (404, 451):
                continue
            if e.code in (401, 403):
                print(f"# Zugriff verweigert ({e.code}) — Zugangsdaten prüfen.", file=sys.stderr)
                return 1
            continue
        if not n:
            continue
        dest = local_path(args.outdir, "stations", d, gz=not args.raw_no_gzip)
        print(f"# neueste Stations-Liste {d} ({n/1e6:.1f} MB) → {dest}")
        status, nbytes = download(url, dest, headers, args)
        print(f"# {status}, {nbytes/1e6:.1f} MB")
        return 0 if status in ("ok", "skip") else 1
    print("# keine Tags-Liste gefunden (Zugriff/Zugangsdaten prüfen)", file=sys.stderr)
    return 1


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Historische Tankerkönig-Tagesdateien per HTTP holen (statt git clone).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    ap.add_argument("--base", default=os.environ.get("TK_BASE", DEFAULT_BASE),
                    help="Basis-URL des Daten-Repos")
    ap.add_argument("--branch", default=os.environ.get("TK_BRANCH", DEFAULT_BRANCH))
    ap.add_argument("--kind", choices=["prices", "stations", "both"], default="prices")
    ap.add_argument("--since", default="2025-01-01", help="erster Tag (YYYY-MM-DD/-MM/YYYY, gestern)")
    ap.add_argument("--until", default="today", help="letzter Tag")
    ap.add_argument("--outdir", default="data/raw", help="Zielverzeichnis (auf NAS mounten!)")
    ap.add_argument("--stations-latest", action="store_true",
                    help="nur die neueste Tankstellenliste holen")
    ap.add_argument("--only", type=int, default=0, help="nur die N letzten Tage des Bereichs (Test)")
    ap.add_argument("--dry-run", action="store_true", help="nichts laden, nur Größen zeigen")
    ap.add_argument("--probe", type=int, default=3, help="so viele Dateien für --dry-run messen")
    ap.add_argument("--speed-mbs", type=float, default=15.0,
                    help="angenommene Download-Rate für die Zeit-Abschätzung in --dry-run")
    ap.add_argument("--gz-factor", type=float, default=0.12,
                    help="Plattenfaktor gz/roh für die Abschätzung")
    ap.add_argument("--delay", type=float, default=0.4, help="Pause pro Datei (Fairness)")
    ap.add_argument("--retries", type=int, default=4)
    ap.add_argument("--backoff", type=float, default=5.0)
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--compresslevel", type=int, default=6)
    ap.add_argument("--raw-no-gzip", action="store_true",
                    help="ungepackt ablegen (spart CPU auf dem Pi, kostet ~8× Platz)")
    ap.add_argument("--login", default=None, help="Basic-User (sonst TK_LOGIN/~/.netrc)")
    ap.add_argument("--token", default=None, help="API-Key (sonst TK_TOKEN/~/.netrc)")
    ap.add_argument("--netrc", default=None, help="zusätzliche netrc-Datei")
    ap.add_argument("--no-netrc", action="store_true")
    ap.add_argument("--no-prompt", action="store_true", help="nie interaktiv nach dem Key fragen")
    ap.add_argument("--force", action="store_true", help="vorhandene Dateien neu laden")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    if args.stations_latest:
        return stations_latest(args)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
