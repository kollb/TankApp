"""Bereinigte Fehlertexte für Job-Status, Job-Log und GUI.

Ein NAS-Job, der mit ``state: failed`` endet, soll sagen **was** schiefging.
„Modell-Update fehlgeschlagen“ allein zwingt zum Rätselraten: fehlende
Historie, kaputte Archivdatei, voller Datenträger oder ein fehlendes Paket
sehen in der GUI identisch aus — der Unterschied steht bisher nur im
Container-Log, und dort absichtlich ohne Meldung.

Rohe Exception-Meldungen unverändert herauszugeben ist keine Alternative: sie
tragen regelmäßig absolute Pfade, InfluxDB-URLs mit Token und Inhalte aus
Konfigurationsdateien in eine Datei, die per API und GUI lesbar ist.

Deshalb geht jeder Text, der nach außen kann, durch :func:`redact`:

- absolute Pfade → Dateiname (``/data/runtime/jobs/models.json`` → ``models.json``)
- ``token=…``, ``password=…``, ``Bearer …``, ``scheme://user:pass@host`` → Platzhalter
- sehr lange Zendicode-Blobs (Influx-Token, Signaturen) → ``<entfernt>``
- Länge begrenzt, Zeilenumbrüche geglättet (eine Zeile je Logzeile)

Was bleibt, ist die Ursache in einem Satz — genug zum Handeln, zu wenig für
einen Datenabfluss. Pfad- und Token-Kürzung ist absichtlich grob: Ein
Dateiname mehr zu viel wird verschmerzt, ein Token zu wenig nicht.
"""

from __future__ import annotations

import re

# Ein Satz im GUI, nicht ein Stacktrace.
MAX_DETAIL = 240
# Eine Logzeile (append_log schreibt einzeilig).
MAX_LINE = 400

# ``token=abc`` / ``password: abc`` / ``Authorization: Bearer abc``
_SECRET_ASSIGN = re.compile(
    r"(?i)\b("
    r"token|tok|password|passwd|pwd|secret|api[_-]?key|apikey|auth|"
    r"authorization|credential|netrc|dsn|url"
    r")\b\s*[=:]\s*(\"[^\"]*\"|'[^']*'|\S+)"
)
# Schlüssel, deren **Name** schon verrät, dass der Wert geheim ist.
_SECRET_KEYS = frozenset(
    {
        "token",
        "tok",
        "password",
        "passwd",
        "pwd",
        "secret",
        "api_key",
        "api-key",
        "apikey",
        "auth",
        "authorization",
        "credential",
        "credentials",
        "netrc",
    }
)
# Ein Wort, das einen Geheimnis-Begriff enthält, ist verdächtig — auch ohne
# ``=``. So überlebt kein ``secret-token-must-not-appear`` den Weg ins GUI.
_SECRET_WORD = re.compile(
    r"(?i)\b[\w.\-]*(?:token|secret|passwor[dt]|passwd|api[_-]?key|"
    r"credential|netrc)[\w.\-]*\b"
)
_BEARER = re.compile(r"(?i)\bbearer\s+\S+")
# ``http://user:pass@host`` — Benutzer und Kennwort sind nie Teil der Ursache.
_URL_CREDENTIALS = re.compile(r"(?i)\b([a-z][a-z0-9+.\-]*://)([^/\s:@]+):([^/\s@]+)@")
# Absolute Pfade ab zwei Segmenten; der letzte Name bleibt stehen.
_PATH = re.compile(r"(?<![\w~])(?:/[\w.\-]+){2,}")
# Lange, bindestrichlose Blobs (Influx-Token, Signaturen). UUIDs von Stationen
# sind 36 Zeichen inklusive Bindestrichen und bleiben damit unangetastet.
_BLOB = re.compile(r"\b[A-Za-z0-9+/=_]{40,}\b")


def _hide_assignment(match: re.Match[str]) -> str:
    key = match.group(1)
    # Geheime Schlüssel verlieren auch ihren Namen (der Wert ist ohnehin weg),
    # neutrale wie ``url``/``dsn`` behalten ihn — „url=<entfernt>“ erklärt mehr.
    if key.lower().replace("-", "_") in _SECRET_KEYS:
        return "<entfernt>"
    return f"{key}=<entfernt>"


def _shorten_path(match: re.Match[str]) -> str:
    return match.group(0).rstrip("/").rsplit("/", 1)[-1]


def redact(text: str | None, max_len: int = MAX_LINE) -> str:
    """Kürzt Pfade, Zugangsdaten und Länge. Für Logzeilen und Meldungen."""
    if not text:
        return ""
    out = str(text)
    out = _URL_CREDENTIALS.sub(r"\1***:***@", out)
    out = _BEARER.sub("Bearer <entfernt>", out)
    out = _SECRET_ASSIGN.sub(_hide_assignment, out)
    out = _SECRET_WORD.sub("<entfernt>", out)
    out = _PATH.sub(_shorten_path, out)
    out = _BLOB.sub("<entfernt>", out)
    out = " ".join(out.split())
    if len(out) > max_len:
        out = out[: max_len - 1].rstrip() + "…"
    return out


def public_detail(exc: BaseException, max_len: int = MAX_DETAIL) -> str:
    """Einzeilige, bereinigte Ursache eines Fehlers (Typ + Meldung)."""
    label = type(exc).__name__
    try:
        message = redact(str(exc), max_len=max_len)
    except Exception:  # Eine kaputte __str__ darf den Job-Abbruch nicht brechen
        return label
    if not message:
        return label
    return redact(f"{label}: {message}", max_len=max_len)
