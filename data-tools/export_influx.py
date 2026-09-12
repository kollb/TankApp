#!/usr/bin/env python3
"""Read-only InfluxDB 2.x export for M3. No writes, deletes or collector ACKs.

The uploader now tags each point with station_id (UUID), keeping city and
station NAME for display. Legacy name-only points are supported only when
unambiguous; --uuid-only deliberately excludes legacy points. polling.json
selects known UUIDs. Collisions are errors, never guessed matches.
Only Python >= 3.9's standard library is required.

Configuration: TANKAPP_INFLUX_* environment variables, or --env-file with four
literal NAME=VALUE lines (the file replaces, rather than merges with, the env).
A whole config file is not a token; malformed credentials are never logged.
Use --check-connection before exporting to check health and bucket read access
without a polling set or output files.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import errno
import http.client
import io
import json
import math
import os
import re
import socket
import ssl
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

from polling_plan import active_polling

ROOT = Path(__file__).resolve().parent.parent
COLUMNS = [
    "timestamp",
    "station_id",
    "station_name",
    "brand",
    "city",
    "lat",
    "lon",
    "fuel",
    "price",
    "status",
    "source",
]
UTC = dt.timezone.utc
INFLUX_KEYS = (
    "TANKAPP_INFLUX_URL",
    "TANKAPP_INFLUX_ORG",
    "TANKAPP_INFLUX_BUCKET",
    "TANKAPP_INFLUX_TOKEN",
)
MAX_ENV_BYTES = 64 * 1024
PRICE_COLUMNS = ("_time", "city", "station", "status")
PROBE_COLUMNS = ("_time",)
MAX_PROBE_ROWS = 4096


class ExportError(ValueError):
    """User-facing error with a deliberately credential-free message."""


@dataclass(frozen=True)
class InfluxConfig:
    url: str
    org: str
    bucket: str
    token: str = field(repr=False)
    timeout: int = 60
    no_proxy: bool = False

    def validate(self):
        if self.token in {
            "<DEIN-INFLUXDB-LESE-TOKEN>",
            "<NUR-LESE-TOKEN>",
            "<Secret>",
            "<SECRET>",
        }:
            raise ExportError(
                "TANKAPP_INFLUX_TOKEN enthält noch einen Platzhalter. "
                "Den vollständigen Wert eines neuen InfluxDB-Lese-Tokens eintragen, nicht seine ID."
            )
        # Validate BEFORE constructing HTTP headers. http.client can otherwise
        # include the entire credential in "Invalid header value b'...'" errors.
        if self.token and (
            self.token.startswith(tuple(name + "=" for name in INFLUX_KEYS))
            or any(not 33 <= ord(char) <= 126 for char in self.token)
        ):
            raise ExportError(
                "TANKAPP_INFLUX_TOKEN darf nur den einzelnen Token enthalten: "
                "keine Konfigurationszeilen, Leer-/Steuerzeichen, BOM oder Token-Präfixe. "
                "Eine Datei mit NAME=WERT-Zeilen über --env-file data/influx.env laden; "
                "nicht ihren gesamten Inhalt in die Token-Variable schreiben."
            )
        invalid_url = False
        try:
            # urlsplit silently strips some controls; reject them first. Access
            # .port inside this guard too: its ValueError may echo bad input.
            parsed = urllib.parse.urlsplit(self.url)
            port = parsed.port
            invalid_url = (
                parsed.scheme not in ("http", "https")
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.query
                or parsed.fragment
                or port == 0
                or any(
                    char.isspace() or unicodedata.category(char).startswith("C")
                    for char in self.url
                )
            )
        except ValueError:
            invalid_url = True
        if invalid_url:
            raise ExportError(
                "TANKAPP_INFLUX_URL: http(s)-Adresse ohne Zugangsdaten/Query erforderlich; "
                "als Klartext ohne Markdown-Linkklammern eintragen."
            ) from None
        if not self.org or not self.bucket or not self.token:
            raise ExportError(
                "TANKAPP_INFLUX_ORG, _BUCKET und _TOKEN setzen (nur Lese-Token nötig). "
                "Alternativ die vier Werte über --env-file data/influx.env laden."
            )
        if not 1 <= self.timeout <= 600:
            raise ExportError("Timeout muss zwischen 1 und 600 Sekunden liegen.")


def read_env_file(path: Path) -> dict[str, str]:
    """Parse literal NAME=VALUE lines, never execute or expand shell content.

    UTF-8 BOM/CRLF, blank lines, whole-line comments and matching outer quotes
    are supported. Split at the first '=' so base64 padding is preserved.
    Reject unknown/duplicate keys without echoing any file contents.
    """
    try:
        with path.open("rb") as handle:
            raw = handle.read(MAX_ENV_BYTES + 1)
    except OSError:
        raise ExportError(
            "Konfigurationsdatei nicht lesbar: Pfad bei --env-file und Dateirechte prüfen."
        ) from None
    if len(raw) > MAX_ENV_BYTES:
        raise ExportError("Konfigurationsdatei zu groß (maximal 64 KiB).")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeError:
        raise ExportError(
            "Konfigurationsdatei als UTF-8 speichern (BOM ist erlaubt)."
        ) from None
    values = {}
    for number, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, value = line.partition("=")
        name, value = name.strip(), value.strip()
        if not separator or name not in INFLUX_KEYS:
            raise ExportError(
                f"Konfigurationsdatei, Zeile {number}: erwartet TANKAPP_INFLUX_URL, "
                "_ORG, _BUCKET oder _TOKEN als NAME=WERT; keine PowerShell-Befehle."
            )
        if name in values:
            raise ExportError(
                f"Konfigurationsdatei, Zeile {number}: doppelter Eintrag."
            )
        if value[:1] in ("'", '"'):
            if len(value) < 2 or value[-1] != value[0]:
                raise ExportError(
                    f"Konfigurationsdatei, Zeile {number}: Anführungszeichen nicht geschlossen."
                )
            value = value[1:-1]
        values[name] = value
    return values


def load_config(
    env_file: Path | None, timeout: int = 60, no_proxy: bool = False
) -> InfluxConfig:
    # A supplied file is authoritative. In particular, do not inherit a stale
    # multi-line TANKAPP_INFLUX_TOKEN from the user's current PowerShell session.
    if env_file is not None:
        values = read_env_file(env_file)
        bucket_default = ""
    else:
        values = os.environ
        bucket_default = "tankapp"
    return InfluxConfig(
        values.get("TANKAPP_INFLUX_URL", ""),
        values.get("TANKAPP_INFLUX_ORG", ""),
        values.get("TANKAPP_INFLUX_BUCKET", bucket_default),
        values.get("TANKAPP_INFLUX_TOKEN", ""),
        timeout,
        no_proxy,
    )


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the Authorization header to an unexpected host.
        return None


def http_opener(cfg: InfluxConfig):
    # Explicit opt-in for a single process, never mutate system/env proxy or TLS settings.
    handlers = [NoRedirect()]
    if cfg.no_proxy:
        handlers.append(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener(*handlers)


def proxy_diagnostic(cfg: InfluxConfig) -> str:
    """Report routing intent only; proxy URLs may contain usernames/passwords."""
    if cfg.no_proxy:
        return "HTTP-Weg: direkt angefordert (--no-proxy); TLS-Prüfung unverändert."
    try:
        parsed = urllib.parse.urlsplit(cfg.url)
        proxies = urllib.request.getproxies()
        configured = bool(proxies.get(parsed.scheme))
        bypass = urllib.request.proxy_bypass(parsed.netloc) if configured else False
    except Exception:
        # Registry/environment errors can embed credentials. This advisory must
        # not fail the actual connection test or echo their contents.
        return "HTTP-Weg: Proxy-Konfiguration nicht bestimmbar; keine Proxy-Werte ausgegeben."
    if not configured:
        return "HTTP-Weg: kein passender Proxy in urllib erkannt; transparente Filter bleiben möglich."
    if bypass:
        return "HTTP-Weg: Proxy konfiguriert, NAS laut Bypass-Regel direkt; keine Proxy-Werte ausgegeben."
    return "HTTP-Weg: Proxy laut urllib vorgesehen; Windows-/Umgebungsproxy kann vom RPi abweichen."


def instant(value: str, timezone: str = "Europe/Berlin") -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        zone = ZoneInfo(timezone)
        first, second = (
            parsed.replace(tzinfo=zone, fold=0),
            parsed.replace(tzinfo=zone, fold=1),
        )
        if first.utcoffset() != second.utcoffset():
            raise ExportError(
                "Mehrdeutige/nicht existente lokale Zeit; UTC-Offset explizit angeben."
            )
        parsed = first
    return parsed.astimezone(UTC)


def time_windows(start: dt.datetime, stop: dt.datetime):
    if start >= stop:
        raise ExportError("--since muss vor --until liegen (until ist exklusiv).")
    while start < stop:
        end = min(start + dt.timedelta(days=1), stop)
        yield start, end
        start = end


def station_lookup(path: Path, city: str | None = None) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    lookup: dict[tuple[str, str], dict[str, dict]] = {}
    for key, stset in (payload.get("sets") or {}).items():
        label = stset.get("label") or key
        if city and city not in (key, label):
            continue
        batch = set(stset.get("batch") or [])
        for station in stset.get("stations", []):
            uid = station.get("uuid")
            if not uid or (batch and uid not in batch):
                continue
            for alias in {uid, station.get("name") or uid}:
                lookup.setdefault((label, alias), {})[uid] = station
        # Old/minimal polling sets may contain UUIDs without metadata.
        for uid in batch:
            lookup.setdefault((label, uid), {}).setdefault(
                uid, {"uuid": uid, "name": uid}
            )
    if not lookup:
        raise ExportError("Keine Stationen in polling.json / für die gewählte Stadt.")
    return lookup


def selected_uuid_sets(lookup: dict) -> dict[str, list[str]]:
    groups = {}
    for (city, _), candidates in lookup.items():
        groups.setdefault(city, set()).update(candidates)
    return {city: sorted(ids) for city, ids in sorted(groups.items())}


def flux_query(
    bucket: str,
    fuel: str,
    start: dt.datetime,
    stop: dt.datetime,
    cities: list[str],
    station_ids: dict[str, list[str]] | None = None,
) -> str:
    if fuel not in ("e5", "e10", "diesel"):
        raise ExportError("Kraftstoff muss e5, e10 oder diesel sein.")

    # json.dumps produces valid Flux string literals, including escaped quotes.
    def quote(value):
        return json.dumps(value, ensure_ascii=False)

    identity_filter = ""
    if station_ids is not None:
        clauses = [
            f"(r.city == {quote(city)} and contains(value: r.station_id, set: {quote(sorted(ids))}))"
            for city, ids in sorted(station_ids.items())
            if ids
        ]
        if not clauses:
            raise ExportError("Keine ausgewählten UUIDs für den UUID-Export.")
        identity_filter = (
            "  |> filter(fn: (r) => exists r.station_id and ("
            + " or ".join(clauses)
            + "))\n"
        )
    return (
        f"from(bucket: {quote(bucket)})\n"
        f"  |> range(start: time(v: {quote(start.isoformat())}), stop: time(v: {quote(stop.isoformat())}))\n"
        '  |> filter(fn: (r) => r._measurement == "prices")\n'
        f"  |> filter(fn: (r) => contains(value: r.city, set: {quote(sorted(cities))}))\n"
        f"{identity_filter}"
        f'  |> filter(fn: (r) => r._field == "status" or r._field == {quote(fuel)})\n'
        '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n'
        f'  |> keep(columns: ["_time", "city", "station", "station_id", "status", {quote(fuel)}])\n'
        '  |> sort(columns: ["_time"])\n'
    )


def error_causes(exc: BaseException) -> list:
    causes = [exc]
    while isinstance(causes[-1], urllib.error.URLError) and len(causes) < 4:
        following = causes[-1].reason
        if any(following is item for item in causes):
            break
        causes.append(following)
    return causes


def error_details(exc: BaseException, phase: str, status: int | None = None) -> str:
    """Only fixed type labels and numeric OS/HTTP codes; no exception strings/args."""
    labels = (
        (http.client.RemoteDisconnected, "RemoteDisconnected"),
        (http.client.IncompleteRead, "IncompleteRead"),
        (urllib.error.HTTPError, "HTTPError"),
        (urllib.error.URLError, "URLError"),
        (ssl.SSLCertVerificationError, "SSLCertVerificationError"),
        (ssl.SSLError, "SSLError"),
        (ConnectionResetError, "ConnectionResetError"),
        (ConnectionAbortedError, "ConnectionAbortedError"),
        (ConnectionRefusedError, "ConnectionRefusedError"),
        (BrokenPipeError, "BrokenPipeError"),
        (TimeoutError, "TimeoutError"),
        (socket.gaierror, "gaierror"),
        (http.client.HTTPException, "HTTPException"),
        (UnicodeError, "UnicodeError"),
        (ValueError, "ValueError"),
        (OSError, "OSError"),
        (str, "Textursache"),
    )
    causes = error_causes(exc)
    kinds = [
        next((label for kind, label in labels if isinstance(item, kind)), "unbekannt")
        for item in causes
    ]
    http_status = (
        str(status) if type(status) is int and 100 <= status <= 599 else "unbekannt"
    )
    details = [f"Phase={phase}", f"HTTP={http_status}", "Typ=" + "/".join(kinds)]
    for name in ("errno", "winerror"):
        # Windows socket exceptions are sometimes generic OSError rather than
        # the more specific ConnectionResetError. Keep their numeric evidence.
        values = [getattr(item, name, None) for item in reversed(causes)]
        value = next(
            (value for value in values if type(value) is int and abs(value) <= 65535),
            None,
        )
        if value is not None:
            details.append(f"{name}={value}")
    return "[" + "; ".join(details) + "]"


def network_error(
    exc: BaseException,
    stage: str,
    phase: str = "HTTP-Aufruf",
    status: int | None = None,
) -> ExportError:
    """Classify types/codes, not raw error messages that may contain secrets."""
    reason = error_causes(exc)[-1]
    codes = {
        value
        for name in ("errno", "winerror")
        if type(value := getattr(reason, name, None)) is int and abs(value) <= 65535
    }
    if isinstance(reason, (TimeoutError, socket.timeout)) or codes & {
        errno.ETIMEDOUT,
        10060,
    }:
        hint = "Zeitüberschreitung: NAS/Netz/VPN prüfen, bei Bedarf --timeout erhöhen. Das behebt keinen HTTP 401."
    elif isinstance(reason, http.client.RemoteDisconnected):
        hint = "Gegenstelle hat ohne vollständige HTTP-Antwort geschlossen; Server/Proxy prüfen."
    elif isinstance(reason, ConnectionResetError) or codes & {errno.ECONNRESET, 10054}:
        hint = "Verbindung zurückgesetzt: Gegenstelle oder Zwischenstation hat abgebrochen. Kein Beleg für einen falschen Token."
    elif isinstance(reason, ConnectionAbortedError) or codes & {
        errno.ECONNABORTED,
        10053,
    }:
        hint = "Verbindung abgebrochen: Rechner/Netzfilter/NAS prüfen. Kein Beleg für einen falschen Token."
    elif isinstance(reason, BrokenPipeError) or codes & {errno.EPIPE}:
        hint = "Verbindung beim Senden geschlossen (Broken Pipe); Server/Proxy prüfen."
    elif isinstance(reason, ConnectionRefusedError) or codes & {
        errno.ECONNREFUSED,
        10061,
    }:
        hint = "Verbindung abgelehnt: Influx-Dienst, URL-Port und Firewall prüfen."
    elif isinstance(reason, socket.gaierror):
        hint = "Hostname nicht auflösbar: URL und DNS/VPN prüfen."
    elif isinstance(reason, ssl.SSLCertVerificationError):
        hint = "TLS-Zertifikat nicht vertrauenswürdig: Zertifikat/HTTPS-Adresse prüfen."
    elif isinstance(reason, ssl.SSLError):
        hint = (
            "TLS-Verbindung fehlgeschlagen: http/https und Server-Konfiguration prüfen."
        )
    else:
        hint = "Netz-/Lesefehler noch nicht eindeutig zugeordnet. Ein Proxy- oder Tokenfehler ist damit nicht nachgewiesen."
    return ExportError(f"{stage}: {hint} {error_details(exc, phase, status)}")


def query_rows(cfg: InfluxConfig, query: str, required_columns=PRICE_COLUMNS):
    cfg.validate()
    url = (
        cfg.url.rstrip("/")
        + "/api/v2/query?"
        + urllib.parse.urlencode({"org": cfg.org})
    )
    # Use the documented plain Flux API, not a JSON wrapper with a custom
    # dialect. Authorization is the same Token header used by the writer;
    # the read endpoint and payload/content type are intentionally different.
    body = query.encode("utf-8")
    phase, status = "POST senden / HTTP-Header empfangen", None
    try:
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Token {cfg.token}",
                "Accept": "application/csv",
                "Content-Type": "application/vnd.flux",
                "User-Agent": "TankApp-ReadOnly-Export/1.0",
            },
        )
        opener = http_opener(cfg)
        with opener.open(request, timeout=cfg.timeout) as response:
            status = response.status
            phase = "CSV-Antwort lesen"
            if required_columns == PROBE_COLUMNS:
                print(
                    "3/3 HTTP-Antwort empfangen; Query-Ergebnis wird noch gelesen.",
                    flush=True,
                )
                content_type = (
                    response.headers.get("Content-Type", "")
                    .split(";")[0]
                    .lower()
                    .strip()
                )
                if content_type not in ("application/csv", "text/csv"):
                    raise ExportError(
                        "Query-Endpunkt liefert kein CSV: URL/Reverse-Proxy prüfen."
                    )
            text = io.TextIOWrapper(response, encoding="utf-8-sig", newline="")
            try:
                yield from parse_flux_csv(text, required_columns)
                # HTTPResponse.read1 (used by TextIOWrapper) can accept an early
                # EOF without raising IncompleteRead. Check Content-Length too.
                if getattr(response, "length", None) not in (None, 0):
                    raise ExportError(
                        "Unvollständige HTTP-Antwort; Export bleibt unverändert."
                    )
            finally:
                text.close()
    except ExportError:
        raise
    except urllib.error.HTTPError as exc:
        hints = {
            401: (
                "Zugriff abgelehnt: Token ungültig/deaktiviert oder keine Leseberechtigung "
                "für die gewählte Organisation/den Bucket. Neuen Lese-Token in genau dieser "
                "InfluxDB-Instanz erstellen und seinen vollständigen Wert in influx.env eintragen "
                "(nicht Token-ID, Token-Name, Login-Passwort oder Tankerkönig-Key). "
                "Bei vorgeschaltetem Proxy auch dessen Zugriff prüfen."
            ),
            403: "Token braucht Leserecht für den TankApp-Bucket; ggf. Proxy-Zugriff prüfen",
            400: "Organisation, Bucket und Flux-Unterstützung prüfen; Query wurde nicht akzeptiert",
            404: "Org/Bucket/InfluxDB-2.x-URL prüfen",
            407: "Proxy verlangt Anmeldung; Proxy-Einstellungen prüfen, nicht den InfluxDB-Token dafür verwenden",
            429: "Server ausgelastet; später erneut exportieren",
        }
        # No response body / URL / token in logs (a proxy may echo credentials).
        raise ExportError(
            f"InfluxDB HTTP {exc.code}: " + hints.get(exc.code, "Query/Server prüfen")
        ) from None
    except http.client.IncompleteRead as exc:
        raise ExportError(
            "Unvollständige HTTP-Antwort; Export bleibt unverändert. "
            + error_details(exc, phase, status)
        ) from None
    except (http.client.RemoteDisconnected, ConnectionError) as exc:
        raise network_error(exc, "Flux-Query", phase, status) from None
    except (ValueError, http.client.HTTPException) as exc:
        raise ExportError(
            "Ungültige HTTP-Anfrage/Antwort; Influx-Konfiguration und Token-Format prüfen. "
            "Header- und Antwortinhalte werden aus Sicherheitsgründen nicht ausgegeben. "
            + error_details(exc, phase, status)
        ) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise network_error(exc, "Flux-Query", phase, status) from None


def query_raw(cfg: InfluxConfig, query: str):
    """Generische Flux-Zeilen ohne Preis-Schema-Prüfung.

    ``query_rows`` erzwingt standardmäßig das Preis-Schema (``_time``, ``city``,
    ``station``, ``status``) — richtig für Export und Live-Preise, falsch für
    Messungen wie ``collector_status``: deren Antwort besteht aus langen
    ``_field``/``_value``-Zeilen ohne ``station``/``status``-Paar und würde dort
    als „unerwartetes CSV-Format" verworfen. Solche Messungen lesen hierüber als
    rohe Zeilen (nur ``_time`` wird als Spalte verlangt).
    """
    yield from query_rows(cfg, query, required_columns=PROBE_COLUMNS)


def parse_flux_csv(handle, required_columns=PRICE_COLUMNS):
    header = None
    defaults = []
    for row in csv.reader(handle):
        if row and row[0] == "#default":
            defaults = row
            continue
        if not row or not any(row) or row[0].startswith("#"):
            continue
        if "error" in row and "reference" in row:
            raise ExportError(
                "InfluxDB meldet einen Flux-Query-Fehler; kein Export übernommen."
            )
        if "_time" in row and ("station" in row or required_columns == PROBE_COLUMNS):
            header = row
            if not set(required_columns).issubset(header):
                raise ExportError(
                    "InfluxDB-Schema unvollständig: "
                    + "/".join(required_columns)
                    + " erforderlich."
                )
            continue
        if header is None or len(row) != len(header):
            raise ExportError(
                "Unerwartetes InfluxDB-CSV-Format; kein Export übernommen."
            )
        values = [
            value or (defaults[i] if i < len(defaults) and i else "")
            for i, value in enumerate(row)
        ]
        yield dict(zip(header, values))


def check_health(cfg: InfluxConfig) -> None:
    """Identify a ready InfluxDB service without sending any Authorization header."""
    cfg.validate()
    phase, status = "GET senden / HTTP-Header empfangen", None
    try:
        request = urllib.request.Request(
            cfg.url.rstrip("/") + "/health",
            method="GET",
            headers={
                "Accept": "application/json",
                "User-Agent": "TankApp-ReadOnly-Export/1.0",
            },
        )
        with http_opener(cfg).open(request, timeout=cfg.timeout) as response:
            status = response.status
            phase = "Health-Antwort lesen"
            if status != 200:
                raise ExportError(
                    "Health-Endpunkt meldet keinen bereiten Dienst; NAS/InfluxDB prüfen."
                )
            raw = response.read(MAX_ENV_BYTES + 1)
            if len(raw) > MAX_ENV_BYTES or getattr(response, "length", None) not in (
                None,
                0,
            ):
                raise ExportError(
                    "Health-Antwort unvollständig oder zu groß; URL/Proxy prüfen."
                )
            health = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(health, dict) or health.get("name") != "influxdb":
            raise ExportError(
                "Kein InfluxDB-Health-Endpunkt erkannt; URL/Port/Reverse-Proxy prüfen."
            )
        if health.get("status") != "pass":
            raise ExportError(
                "InfluxDB meldet sich noch nicht bereit; Dienst auf dem NAS prüfen."
            )
        major = re.match(r"v?(\d+)\.", str(health.get("version", "")))
        if major and major.group(1) != "2":
            raise ExportError(
                "Andere InfluxDB-Hauptversion erkannt; dieser Exporter benötigt InfluxDB 2.x/Flux."
            )
    except ExportError:
        raise
    except urllib.error.HTTPError as exc:
        raise ExportError(
            f"Health-Endpunkt HTTP {exc.code}: URL/Port, Influx-Dienst oder vorgeschalteten Proxy prüfen. "
            "Dieser Schritt sendet keinen Token; die Token-Berechtigung ist noch nicht geprüft."
        ) from None
    except (http.client.RemoteDisconnected, ConnectionError) as exc:
        raise network_error(exc, "Health-Endpunkt", phase, status) from None
    except (ValueError, http.client.HTTPException) as exc:
        raise ExportError(
            "Keine gültige InfluxDB-Health-Antwort; URL/Port/Reverse-Proxy prüfen. "
            + error_details(exc, phase, status)
        ) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise network_error(exc, "Health-Endpunkt", phase, status) from None


def check_connection(cfg: InfluxConfig) -> None:
    """Check configuration, service and bucket read access; no polling set/files needed."""
    cfg.validate()
    print(
        "1/3 Konfiguration: OK (Format geprüft; Token wird nicht ausgegeben).",
        flush=True,
    )
    print(proxy_diagnostic(cfg), flush=True)
    print("2/3 Prüfe InfluxDB /health ohne Token ...", flush=True)
    check_health(cfg)
    print("2/3 InfluxDB: bereit.", flush=True)
    print(
        "3/3 Prüfe Bucket-Lesezugriff: POST /api/v2/query als Flux-Text ...", flush=True
    )
    query = (
        f"from(bucket: {json.dumps(cfg.bucket, ensure_ascii=False)})\n"
        "  |> range(start: -1h)\n"
        '  |> filter(fn: (r) => r._measurement == "prices")\n'
        "  |> limit(n: 1)\n"
    )
    # Exactly the simple query that can be checked in the Data Explorer.
    # limit applies per table: different fuels and the status field legitimately
    # produce several tables/types. Drain them all, with a diagnostic safety cap,
    # so a late Flux error cannot become a false success. No prices are logged.
    count = 0
    for row in query_rows(cfg, query, required_columns=PROBE_COLUMNS):
        count += 1
        if count > MAX_PROBE_ROWS:
            raise ExportError(
                "Diagnose-Limit erreicht (zu viele Serien); Bucket/Measurement prüfen. "
                "Verbindungstest nicht vollständig ausgewertet."
            )
        try:
            instant(row["_time"])
        except (ValueError, KeyError, TypeError):
            raise ExportError(
                "Verbindungs-Query lieferte keinen gültigen Zeitstempel; Antwort nicht wie erwartet."
            ) from None
    print("3/3 Lesezugriff: OK (Query akzeptiert).", flush=True)
    if not count:
        print(
            "Hinweis: keine prices-Punkte in der letzten Stunde; kein Nachweis für laufende Datenerfassung."
        )
    print(
        "Verbindungstest erfolgreich. Kein Export geschrieben; kein Schreib-/Adminrecht benötigt."
    )


def normalized_row(row: dict, lookup: dict, fuel: str) -> dict:
    city, tag = row.get("city", ""), row.get("station", "")
    station_id = row.get("station_id", "").strip()
    if station_id:
        # Explicit UUID always wins, even when the display name is ambiguous,
        # stale, or itself looks like another UUID. Never fall back on its name.
        meta = lookup.get((city, station_id), {}).get(station_id)
        if meta is None:
            raise ExportError(
                "Influx-UUID nicht im ausgewählten Polling-Set; Stadt/UUID-Zuordnung prüfen. Kein Namens-Fallback."
            )
        uid = station_id
    else:
        matches = lookup.get((city, tag), {})
        if len(matches) != 1:
            reason = "mehrdeutig" if matches else "nicht in polling.json"
            raise ExportError(
                f"Influx-Station {city!r}/{tag!r}: {reason}. "
                "Legacy-Punkt ohne station_id; UUIDs werden nicht geraten. "
                "Uploader auf UUID-Tags aktualisieren, Original-JSONL bei Bedarf nachliefern "
                "und mit --uuid-only exportieren (docs/archiv/STATIONS-UUID-MIGRATION.md). "
                "Nicht einen Namenszwilling aus polling.json entfernen, um alte Punkte umzudeuten."
            )
        uid, meta = next(iter(matches.items()))
    timestamp = instant(row["_time"])
    status = row.get("status", "").strip().lower() or "no prices"
    raw = row.get(fuel, "").strip()
    price = ""
    if status == "open" and raw.lower() not in ("", "false", "true", "null"):
        try:
            number = float(raw)
        except ValueError:
            raise ExportError(
                "Nichtnumerischer Preis in InfluxDB; Export abgebrochen."
            ) from None
        if math.isfinite(number) and 0.4 <= number <= 5.0:
            price = f"{number:.3f}"
    return {
        "timestamp": timestamp.isoformat(),
        "station_id": uid,
        "station_name": meta.get("name") or uid,
        "brand": meta.get("brand", ""),
        "city": city,
        "lat": meta.get("lat", ""),
        "lon": meta.get("lon", ""),
        "fuel": fuel.upper(),
        "price": price,
        "status": status,
        "source": "influxdb",
    }


def export_prices(
    cfg: InfluxConfig,
    start: dt.datetime,
    stop: dt.datetime,
    lookup: dict,
    fuel: str,
    output: Path,
    uuid_only: bool = False,
) -> dict:
    cfg.validate()
    if not output.name.endswith((".csv", ".csv.gz")):
        raise ExportError(
            "Exportziel muss .csv oder .csv.gz sein, keine Konfigurations-/Pufferdatei."
        )
    windows = list(time_windows(start, stop))
    cities = sorted({city for city, _ in lookup})
    selected = selected_uuid_sets(lookup)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(
        dir=output.parent, prefix=f".{output.name}.", suffix=".tmp"
    )
    os.close(fd)
    summary = {
        "rows": 0,
        "open_prices": 0,
        "queries": len(windows),
        "source": "influxdb",
        "identity_mode": "uuid_only" if uuid_only else "strict_mixed",
    }
    try:
        opener = gzip.open if output.suffix == ".gz" else open
        with opener(name, "wt", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=COLUMNS)
            writer.writeheader()
            for lower, upper in windows:
                query = flux_query(
                    cfg.bucket,
                    fuel,
                    lower,
                    upper,
                    cities,
                    selected if uuid_only else None,
                )
                for raw in query_rows(cfg, query):
                    if uuid_only and not raw.get("station_id", "").strip():
                        raise ExportError(
                            "UUID-Export erhielt einen Punkt ohne station_id; Server-Filter/Schema prüfen."
                        )
                    row = normalized_row(raw, lookup, fuel)
                    if not lower <= instant(row["timestamp"]) < upper:
                        raise ExportError(
                            "InfluxDB lieferte einen Zeitpunkt außerhalb des Query-Fensters."
                        )
                    writer.writerow(row)
                    summary["rows"] += 1
                    summary["open_prices"] += bool(row["price"])
        if not summary["rows"]:
            raise ExportError(
                "Keine InfluxDB-Daten im Zeitraum; bestehende Exportdatei bleibt erhalten."
                + (
                    " Für --uuid-only muss der aktualisierte Uploader station_id-Tags geschrieben haben; ggf. JSONL-Replay ausführen."
                    if uuid_only
                    else ""
                )
            )
        os.replace(name, output)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return summary


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--since",
        help="ISO-Datum/Zeit; ohne Offset Europe/Berlin (Default: vor 70 Tagen)",
    )
    parser.add_argument(
        "--until", help="Exklusives Ende; ohne Offset Europe/Berlin (Default: jetzt)"
    )
    parser.add_argument("--fuel", choices=["e5", "e10", "diesel"], default="e10")
    parser.add_argument("--polling", type=Path, default=active_polling(ROOT))
    parser.add_argument("--poll-city")
    parser.add_argument(
        "--uuid-only",
        action="store_true",
        help="Nur station_id-getaggte Punkte der gewählten UUIDs lesen; alte Namensserien bewusst ausschließen, nicht löschen",
    )
    parser.add_argument(
        "--out", type=Path, help="Default: data/engine/influx_<fuel>.csv.gz"
    )
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument(
        "--no-proxy",
        action="store_true",
        help="Expliziter Direktzugriff ohne urllib-/Windows-Proxy für diesen Aufruf; TLS-Prüfung bleibt aktiv",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        help="Lokale UTF-8-Datei mit TANKAPP_INFLUX_…=…; ersetzt die Prozessumgebung vollständig",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Nur Query zeigen; kein Netz, kein Token nötig",
    )
    mode.add_argument(
        "--check-connection",
        action="store_true",
        help="Nur Konfiguration, Health und Bucket-Leserecht prüfen; keine Exportdatei / kein Polling-Set nötig",
    )
    args = parser.parse_args(argv)
    if args.check_connection and args.uuid_only:
        parser.error(
            "--uuid-only betrifft den Export; --check-connection prüft nur den Zugriff und benötigt kein Polling-Set."
        )
    args.out = args.out or ROOT / f"data/engine/influx_{args.fuel}.csv.gz"
    try:
        cfg = load_config(args.env_file, args.timeout, args.no_proxy)
        if args.check_connection:
            check_connection(cfg)
            return 0
        stop = instant(args.until) if args.until else dt.datetime.now(UTC)
        start = instant(args.since) if args.since else stop - dt.timedelta(days=70)
        windows = list(time_windows(start, stop))
        lookup = station_lookup(args.polling, args.poll_city)
        if args.env_file and args.out.resolve() == args.env_file.resolve():
            raise ExportError(
                "Exportziel darf nicht die Konfigurationsdatei überschreiben."
            )
        if args.dry_run:
            print(
                f"Nur lesend: {len(windows)} Tages-Queries, {start.isoformat()} bis {stop.isoformat()} (exklusiv)."
            )
            print(
                flux_query(
                    cfg.bucket,
                    args.fuel,
                    *windows[0],
                    sorted({city for city, _ in lookup}),
                    selected_uuid_sets(lookup) if args.uuid_only else None,
                )
            )
            return 0
        if args.uuid_only:
            print(
                "UUID-Modus: alte Punkte ohne station_id werden bewusst nicht exportiert; keine Daten werden gelöscht."
            )
        summary = export_prices(
            cfg, start, stop, lookup, args.fuel, args.out, uuid_only=args.uuid_only
        )
        print(
            f"Export → {args.out}: {summary['rows']} Statuszeilen, "
            f"{summary['open_prices']} gültige {args.fuel.upper()}-Preise, {summary['queries']} Queries."
        )
        return 0
    except ExportError as exc:
        print(f"Export abgebrochen: {exc}", file=sys.stderr)
        return 1
    except (ValueError, OSError, KeyError, TypeError):
        # Library errors (including Unicode/header errors) may embed secrets.
        # Do not print their raw repr/message or a traceback from this CLI.
        print(
            "Export abgebrochen: Eingaben/Dateien ungültig oder nicht lesbar/schreibbar. "
            "Pfade, Dateirechte, UTF-8 und polling.json bzw. --env-file prüfen. "
            "Detailinhalte werden aus Sicherheitsgründen nicht ausgegeben.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
