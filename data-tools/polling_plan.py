"""Shared polling validation and safe JSON replacement; standard library only."""

import json
import os
import re
import tempfile
from pathlib import Path

UUID = re.compile(r"^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")


def validate_sets(payload):
    sets = payload.get("sets") if isinstance(payload, dict) else None
    if not isinstance(sets, dict) or not sets:
        raise ValueError("polling.json benötigt mindestens ein Stadtset.")
    seen, labels = set(), set()
    for key, group in sets.items():
        if not isinstance(group, dict):
            raise ValueError("Ungültiges Stadtset.")
        label = group.get("label") or key
        if (
            not isinstance(label, str)
            or not label.strip()
            or any(c in label for c in "\r\n")
        ):
            raise ValueError("Ungültiges Stadtlabel.")
        if label in labels:
            raise ValueError("Stadtlabels müssen eindeutig sein.")
        labels.add(label)
        ids = group.get("batch") or [s["uuid"] for s in group.get("stations", [])]
        if not isinstance(ids, list) or not 1 <= len(ids) <= 10:
            raise ValueError(f"{label}: pro Stadtset sind 1–10 UUIDs erforderlich.")
        if any(not isinstance(uid, str) or not UUID.fullmatch(uid) for uid in ids):
            raise ValueError(f"{label}: ungültige UUID.")
        canonical = [uid.lower() for uid in ids]
        if len(set(canonical)) != len(ids) or seen.intersection(canonical):
            raise ValueError(
                "Eine UUID darf derzeit nur einem Stadtset zugeordnet sein."
            )
        seen.update(canonical)
    return sets


def _json_syntax_error(path: Path, text: str, exc: json.JSONDecodeError):
    """JSONDecodeError → ValueError mit Dateiname, Stelle und Handlungsempfehlung."""
    lines = text.splitlines()
    bad = lines[exc.lineno - 1] if 0 < exc.lineno <= len(lines) else ""
    truncated = exc.pos >= len(text.rstrip())
    diag = [
        f"{path}: JSON in Zeile {exc.lineno}, Spalte {exc.colno} unleserlich "
        f"({exc.msg})."
    ]
    if bad.strip():
        diag.append("    " + bad.rstrip())
        diag.append("    " + " " * max(0, exc.colno - 1) + "^")
    elif 0 < exc.lineno <= len(lines) + 1:
        diag.append("    " + " " * max(0, exc.colno - 1) + "^  (Dateiende)")
    if truncated:
        diag.append(
            "Die Datei bricht genau dort ab: ein Kopier-/Speichervorgang wurde "
            "vermutlich unterbrochen, die Datei ist unvollständig (abgeschnitten)."
        )
    else:
        diag.append(
            "Vermutlich wurde beim manuellen Bearbeiten/Zusammenführen ein Komma "
            "oder eine Klammer ([ ] { }) zu viel oder zu wenig gesetzt."
        )
    diag.append(
        f"Vor dem erneuten Aufruf prüfen mit: python3 -m json.tool {path} "
        "und die Datei danach unverändert aus einer gültigen Vorlage neu kopieren."
    )
    return ValueError("\n".join(diag))


def robust_json_load(path: Path):
    """JSON lesen: utf-8(-sig) primär, cp1252/latin1-Fallback für alte Dateien;
    repariert nebenbei doppelt kodiertes UTF-8 (Mojibake GÃ¼ → Gü).
    Syntaxfehler werden zu einem ValueError mit Dateiname, Stelle und Tipp."""
    path = Path(path)
    raw = path.read_bytes()
    decoded = None
    for enc in ("utf-8-sig", "utf-8"):
        try:
            decoded = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if decoded is not None:
        try:
            return json.loads(decoded)
        except json.JSONDecodeError as exc:
            raise _json_syntax_error(path, decoded, exc) from None
    last_failure = None
    for enc in ("cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue
        try:
            maybe = text.encode(enc).decode("utf-8")
            if maybe != text:
                text = maybe
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            last_failure = (text, exc)
            continue
    if last_failure is not None:
        raise _json_syntax_error(path, last_failure[0], last_failure[1]) from None
    raise ValueError(
        f"{path}: ungültiges JSON/Encoding (utf-8 erwartet, auch latin1 versucht)"
    )


def load_plan(path: Path, city=None):
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    sets = validate_sets(payload)
    if city and city not in sets:
        raise ValueError(f"Stadt {city!r} nicht in polling.json.")
    return [
        {
            **group,
            "label": group.get("label") or key,
            "batch": group.get("batch") or [s["uuid"] for s in group["stations"]],
        }
        for key, group in sets.items()
        if not city or key == city
    ]


def atomic_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, suffix=".tmp", delete=False
        ) as handle:
            temporary = handle.name
            json.dump(payload, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


class RequestSchedule:
    """One request budget for all cities, persisted across collector restarts."""

    def __init__(self, directory, interval, cold_start=False):
        import time

        self.clock = time.time
        self.path = directory / "meta" / "poll-schedule.json"
        self.interval = max(300, interval)
        self.state = {
            "cursor": 0,
            "next_request_at": self.clock() + self.interval if cold_start else 0,
        }
        if self.path.exists():
            self.state = json.loads(self.path.read_text(encoding="utf-8"))
            if (
                not isinstance(self.state, dict)
                or not isinstance(self.state.get("cursor"), int)
                or self.state["cursor"] < 0
                or not isinstance(self.state.get("next_request_at"), (int, float))
                or not 0 <= self.state["next_request_at"] < float("inf")
            ):
                raise ValueError(
                    "Ungültiger Polling-Zeitplan; nicht blind zurücksetzen."
                )

    def wait_seconds(self):
        return max(0, self.state["next_request_at"] - self.clock())

    def claim(self, count):
        if self.wait_seconds() > 0:
            raise ValueError("Request-Abstand noch nicht abgelaufen.")
        cursor = self.state["cursor"] % count
        self.state = {
            "cursor": cursor + 1,
            "next_request_at": self.clock() + self.interval,
        }
        # Persist BEFORE sending, including errors/429, so restarts cannot burst.
        atomic_json(self.path, self.state)
        return cursor


def collector_lock(directory, label="Collector"):
    """Process-lifetime OS lock, also released on crashes (Pi and Windows)."""
    from contextlib import contextmanager

    @contextmanager
    def locked():
        directory.mkdir(parents=True, exist_ok=True)
        handle = (directory / ".collector.lock").open("a+b")
        try:
            if os.name == "nt":
                import msvcrt

                handle.write(b"0")
                handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            raise ValueError(
                f"{label}: in diesem Verzeichnis läuft bereits ein Prozess."
            ) from None
        try:
            yield
        finally:
            handle.close()

    return locked()
