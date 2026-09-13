"""Fortschritts-Protokoll der NAS-Jobs (Konzept §8.2 Nr. 8 System-Status).

Ein Modell-Lauf dauert je nach Datenbestand viele Minuten (Export, Archiv,
Bootstrap, je Station Fit + Backtest, Selektion, Publikation). Ein
``state: running`` in ``runtime/jobs/models.json`` sagt „läuft“, aber nicht
**wo** es gerade hängt. Deshalb schreibt jeder Job eine zweite, kleine Datei:

    runtime/jobs/<job>.progress.json

Inhalt (klein, atomar geschrieben, keine Zugangsdaten):

    {
      "job": "models", "state": "running",
      "phase": "fit", "phase_label": "Modelle fitten",
      "step": 7, "total": 22, "label": "Frankfurt – Aral Hauptstr.",
      "pct": 31.8, "started_at": "...", "updated_at": "...",
      "elapsed_s": 421.5, "eta_s": 902.0, "message": "..."
    }

Zwei Abnehmer:

1. **Mensch am Terminal**: ``journalctl -u tankapp -f`` bzw.
   ``docker logs -f tankapp-app`` — jede Phase und jeder Schritt erscheint
   als eine Zeile (Phase/Schritt/Dauer).
2. **GUI/API**: ``GET /api/v1/health`` liefert je laufendem Job den Block
   ``progress``; der System-Tab zeigt Phase, Schritt x/y, Balken und
   Restschätzung.

Die Datei ist bewusst ein **Status**, kein Log: sie enthält nur den letzten
Stand. Wer die Historie braucht, liest das Journal.
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Any

from polling_plan import atomic_json

UTC = dt.timezone.utc

# Phasen des Modell-Jobs (Reihenfolge wie in app/refresh.py).
PHASE_LABELS = {
    "start": "Start",
    "export": "InfluxDB-Export",
    "coverage": "Live-Abdeckung prüfen",
    "archive": "Archiv aufbereiten",
    "gapfill": "Polling-Lücken schließen",
    "bootstrap": "Bootstrap & Trainingsdaten",
    "fit": "Modelle fitten + Backtest",
    "selection": "Selektion (δ̂)",
    "publish": "Veröffentlichen",
    "sync": "Archiv-Sync",
    "settle": "Empfehlungen abrechnen",
    "done": "Fertig",
}

# Fortschrittsgewicht am Beginn jeder Phase. Der rechenintensive Fit-Block
# belegt seit Batch 4 bewusst 65 Prozentpunkte statt nur 10: Im gemessenen
# Kaltlauf waren dort 92 % der Wandzeit. ``gapfill`` hat einen eigenen Platz
# statt auf 0 % zurückzufallen. JobProgress klemmt zusätzlich monoton, weil
# Bootstrap/Fit/Selektion bei mehreren Kraftstoffen wiederholt werden.
PHASE_WEIGHTS = {
    "start": 0.0,
    "export": 0.05,
    "coverage": 0.10,
    "archive": 0.15,
    "gapfill": 0.20,
    "bootstrap": 0.25,
    "fit": 0.30,
    "selection": 0.95,
    "publish": 0.99,
    "done": 1.0,
}

# Ohne Lebenszeichen gilt ein Job nach dieser Zeit als abgebrochen
# (z. B. hart beendeter Container) — die GUI zeigt dann keinen Fortschritt
# mehr statt eine Geister-Anzeige zu konservieren.
STALE_SECONDS = 6 * 3600


def _now() -> dt.datetime:
    return dt.datetime.now(UTC)


def _pct(weight_done: float) -> float:
    return round(min(100.0, max(0.0, weight_done * 100.0)), 1)


class JobProgress:
    """Schreibt den Fortschritt eines Jobs (atomar, ein Status pro Zeitpunkt)."""

    def __init__(self, settings, job: str, verbose: bool = True) -> None:
        self.settings = settings
        self.job = job
        self.verbose = verbose
        self.path = settings.runtime / "jobs" / f"{job}.progress.json"
        self.started = _now()
        self.phase_key = "start"
        self.phase_label = PHASE_LABELS["start"]
        self.step_index = 0
        self.total = 0
        self.label = ""
        self.message = ""
        self.state = "running"
        self.done = False
        self._weight_override: float | None = None
        self._last_weight = 0.0

    # -- setzen -----------------------------------------------------------
    def phase(
        self,
        phase: str,
        total: int | None = None,
        message: str = "",
        *,
        completed: int = 0,
        weight: float | None = None,
    ) -> None:
        """Neue Phase mit optionalem Schritt- und Gesamtfortschritt.

        Ohne ``total`` verschwinden die Zähler der vorherigen Phase. Für den
        über mehrere Kraftstoffe laufenden Fit kann ``completed`` den bereits
        erledigten globalen Stand wieder aufnehmen. ``weight`` setzt nur den
        Startpunkt dieser Phase (0..1), etwa für eine Selektion zwischen zwei
        Kraftstoffen.
        """
        self.phase_key = phase
        self.phase_label = PHASE_LABELS.get(phase, phase)
        self._weight_override = weight
        if total is not None:
            self.total = max(0, int(total))
            self.step_index = min(self.total, max(0, int(completed)))
        else:
            self.total = 0
            self.step_index = 0
        if message:
            self.message = message
        self._emit(f"Phase {self.phase_label}")

    def step(self, index: int | None = None, label: str = "") -> None:
        """Ein Arbeitsschritt ist fertig (oder läuft, wenn index vorgegeben)."""
        if index is not None:
            self.step_index = int(index)
        else:
            self.step_index += 1
        if label:
            self.label = label
        self._emit(None)

    def retotal(self, total: int) -> None:
        """Gesamtzahl der Schritte nachziehen, ohne den Zähler zurückzusetzen.

        Fällt eine Station in Phase A aus, entfallen ihre Folgeaufgaben (+3 d,
        +7 d, Backtest). Bliebe die Gesamtzahl bei der Vorschätzung, endet der
        Lauf bei „77/80“ und sieht aus, als habe der Zähler drei Aufgaben
        verschluckt. Der Zähler darf dabei nie kleiner werden als der schon
        erreichte Stand — der Balken soll nicht zurückspringen.
        """
        self.total = max(int(total), self.step_index)
        self._emit(f"Gesamtzahl auf {self.total} Schritte korrigiert")

    def note(self, message: str, *, sticky: bool = True) -> None:
        """Freitext (z. B. Zwischenergebnisse, Trefferzahlen).

        ``sticky=True`` (Default) setzt die Meldung als bleibenden Status —
        sinnvoll für Zwischensummen, die bis zur nächsten Phase gelten.
        ``sticky=False`` schreibt **nur eine Log-Zeile**: für die Ursache
        eines einzelnen Fehlers, die nicht an jedem folgenden Schritt hängen
        soll (0.25.1).
        """
        if sticky:
            self.message = message
        self._emit(message)

    def finish(self, state: str = "success", message: str = "") -> None:
        self.state = state
        self.done = True
        if message:
            self.message = message
        self._emit(f"beendet: {state}")

    # -- schreiben ---------------------------------------------------------
    def payload(self) -> dict[str, Any]:
        now = _now()
        elapsed = (now - self.started).total_seconds()
        base = (
            self._weight_override
            if self._weight_override is not None
            else PHASE_WEIGHTS.get(self.phase_key, 0.0)
        )
        nxt = PHASE_WEIGHTS.get(_next_phase(self.phase_key), base)
        if self.total > 0 and self.step_index > 0:
            frac = min(1.0, max(0.0, self.step_index / self.total))
            weight = base + (nxt - base) * frac
        else:
            weight = base
        # B20.6: Phasen dürfen den sichtbaren Balken nie zurücksetzen. Das
        # betrifft insbesondere gapfill (früher 35 -> 0 %) und den nächsten
        # Kraftstoff nach einer Zwischen-Selektion.
        weight = 1.0 if self.done else max(self._last_weight, weight)
        self._last_weight = weight
        eta = None
        if self.total and 0 < self.step_index < self.total:
            per_step = elapsed / max(1, self._steps_done())
            remaining = self.total - self.step_index
            if math.isfinite(per_step):
                eta = round(per_step * remaining, 0)
        return {
            "job": self.job,
            "state": self.state,
            "phase": self.phase_key,
            "phase_label": self.phase_label,
            "step": self.step_index,
            "total": self.total,
            "label": self.label,
            "pct": _pct(weight),
            "started_at": self.started.isoformat(),
            "updated_at": now.isoformat(),
            "elapsed_s": round(elapsed, 1),
            "eta_s": eta,
            "message": self.message,
            "done": self.done,
        }

    def _steps_done(self) -> int:
        """Fortschritt über alle Phasen hinweg (für die ETA-Schätzung)."""
        return max(1, self.step_index)

    def _emit(self, text: str | None) -> None:
        payload = self.payload()
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            atomic_json(self.path, payload)
        except OSError:
            return  # Fortschritt ist Komfort, kein Grund einen Lauf zu brechen
        parts = [f"{self.job}: [{payload['pct']:.0f} %] {self.phase_label}"]
        if self.total:
            parts.append(f"{self.step_index}/{self.total}")
        if self.label:
            parts.append(f"– {self.label}")
        if text:
            parts.append(f"– {text}")
        if self.message and not (text and self.message in text):
            parts.append(f"– {self.message}")
        parts.append(f"({payload['elapsed_s'] / 60:.1f} min)")
        line = " ".join(parts)
        stamp = payload["updated_at"].replace("+00:00", "Z")
        append_log(
            self.path.with_suffix("").with_name(f"{self.job}.log"),
            f"{stamp} {line}",
        )
        if self.verbose:
            print(line, flush=True)


def append_log(path, line: str, max_lines: int = 500) -> None:
    """Hängt eine Zeile an das Job-Log an (älteste Zeilen fallen heraus).

    Dasselbe wie ``docker logs``/``journalctl``, nur ohne Docker und ssh:
    ``cat data/runtime/jobs/models.log``. Kein Rotieren nach Größe — 500
    Zeilen sind wenige kB, und der letzte Lauf interessiert am meisten.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        existing = (
            path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
        )
    except OSError:
        return
    existing.append(line)
    if len(existing) > max_lines:
        existing = existing[-max_lines:]
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_text("\n".join(existing) + "\n", encoding="utf-8")
        tmp.replace(path)
    except OSError:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _next_phase(phase: str) -> str:
    order = [
        "start",
        "export",
        "coverage",
        "archive",
        "gapfill",
        "bootstrap",
        "fit",
        "selection",
        "publish",
        "done",
    ]
    if phase not in order:
        return phase
    index = order.index(phase)
    return order[index + 1] if index + 1 < len(order) else "done"


def read_progress(settings, job: str) -> dict[str, Any] | None:
    """Fortschritt eines **laufenden** Jobs, sonst ``None``.

    Abgeschlossene oder verwaiste Stati (Prozess hart beendet) werden nicht
    zurückgegeben — die GUI soll „Läuft …“ nicht endlos zeigen.
    """
    from .data import read_json

    path = settings.runtime / "jobs" / f"{job}.progress.json"
    raw = read_json(path, None)
    if not isinstance(raw, dict):
        return None
    if raw.get("done"):
        return None
    stamp = raw.get("updated_at")
    if isinstance(stamp, str):
        try:
            updated = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        except ValueError:
            return None
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=UTC)
        if (_now() - updated).total_seconds() > STALE_SECONDS:
            return None
    return raw
