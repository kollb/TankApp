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


# --- B14: Datenverzeichnis der Selektion -------------------------------------
# Historisch lag das gitignored Ausgabeverzeichnis der Selektion unter
# ``docs/analysis/`` — ein Datenverzeichnis mitten in der Dokumentation. Es
# gehört nach ``data/analysis/`` (privat, gitignored wie der Rest von ``data/``).
# Der Umzug passiert **nicht** still: Solange nur der alte Pfad existiert, wird
# er weiter benutzt und einmal je Prozess ein Hinweis auf stderr geschrieben.
ANALYSIS_RELATIVE = Path("data") / "analysis"
LEGACY_ANALYSIS_RELATIVE = Path("docs") / "analysis"
_LEGACY_HINTED = set()


def _hint_legacy(old: Path, new: Path) -> None:
    """Einmal je Prozess und Pfad: klarer Hinweis, kein automatischer Umzug."""
    import sys

    key = str(old)
    if key in _LEGACY_HINTED:
        return
    _LEGACY_HINTED.add(key)
    print(
        f"Hinweis: Selektions-Daten liegen noch unter {old} — neuer Ort ist "
        f"{new}. Verschieben Sie den Ordner bei Gelegenheit von Hand "
        "(z. B. `mv docs/analysis data/analysis`); bis dahin wird der alte "
        "Pfad weiter gelesen und geschrieben.",
        file=sys.stderr,
    )


def analysis_dir(root: Path) -> Path:
    """Ausgabeverzeichnis der Selektion: neu ``data/analysis``, alt geduldet."""
    root = Path(root)
    new = root / ANALYSIS_RELATIVE
    old = root / LEGACY_ANALYSIS_RELATIVE
    if not new.exists() and old.exists():
        _hint_legacy(old, new)
        return old
    return new


def analysis_path(root: Path, *parts: str) -> Path:
    """Datei/Unterordner unterhalb des Selektions-Datenverzeichnisses.

    Existiert die Datei nur am alten Ort, wird der alte Pfad zurückgegeben
    (mit Hinweis) — sonst würde ein bestehender Pi nach dem Update plötzlich
    ohne Polling-Set dastehen.
    """
    root = Path(root)
    new = root.joinpath(ANALYSIS_RELATIVE, *parts)
    old = root.joinpath(LEGACY_ANALYSIS_RELATIVE, *parts)
    if not new.exists() and old.exists():
        _hint_legacy(old, new)
        return old
    return new


def active_polling(root: Path) -> Path:
    """Aktives gemeinsames Polling-Set (``<analysis>/stations/polling.json``)."""
    return analysis_path(root, "stations", "polling.json")
