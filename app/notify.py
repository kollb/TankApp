"""B4: Alarm-Zustellung über ntfy — ein Webhook, kein Auth-Ausbau.

Die Aggregation ist seit 0.10.0 fertig (``app/alarms.py`` → ``alarms[]`` in
``/api/v1/health`` + roter/gelber Punkt im GUI-Header). Offen war der Teil,
der hier steht: Jemand schaut nur hin, wenn die GUI offen ist. Dieses Modul
schickt Alarme mit ``severity: error`` an einen einzigen konfigurierten
ntfy-Endpunkt (``TANKAPP_NTFY_URL``, URL inklusive Topic).

Grundsätze:

- **Keine Preis- oder Stationsdetails im Text.** Verschickt werden die stabilen
  Alarm-Codes, ihre deutschen Klartexte aus ``app/alarms.py`` (die selbst keine
  Zahlen tragen) und die App-Version. Keine Koordinaten, keine Stationen, keine
  Preise, keine Pfade, keine Zugangsdaten — die URL ist der einzige
  Geheimnisträger und wird in jeder Ausgabe bereinigt (``app/errors.redact``).
- **Zustandswechsel statt Dauerschleife**: Gesendet wird, wenn ein Error-Code
  neu auftaucht, wenn er nach ``NOTIFY_REPEAT_S`` weiterhin besteht
  (Erinnerung, damit ein Dauerfehler nicht still bleibt) und einmal, wenn alle
  Errors weg sind („wieder betriebsbereit“). ``warn`` bleibt in der GUI — Push
  ist für ``error`` gedacht.
- **Kein Effekt auf den Betrieb**: Zustellung fehlgeschlagen → bereinigte Zeile
  auf stderr, Zustand unverändert, der nächste Tick versucht es erneut. Der
  Notifier läuft als Daemon-Thread und wirft nie in die Server-Schleife.
- Kein Auth-Ausbau, kein zweiter Kanal: LAN-only, ein Webhook, abschaltbar
  durch Weglassen der Umgebungsvariable.
"""

import datetime as dt
import json
import os
import sys
import threading
import urllib.error
import urllib.request

from .errors import public_detail, redact

# Prüftakt des Notifiers. Bewusst über dem kürzesten Job-Intervall (30 min) und
# unter der Zeit, in der ein ausgefallener Collector wehtut.
NOTIFY_INTERVAL_S = 300.0
# Erinnerung, solange ein Error besteht — sonst verschwindet ein Dauerfehler
# nach der ersten Meldung aus dem Blick.
NOTIFY_REPEAT_S = 6 * 3600.0
# ntfy-Prioritäten: 4 = high (Ton/Vibration), 2 = low (still im Feed).
NTFY_PRIORITY_ERROR = 4
NTFY_PRIORITY_OK = 2
STATE_RELATIVE = ("notify", "state.json")


def error_codes(alarms) -> list[str]:
    """Stabile, sortierte Liste der Error-Codes (Warnungen zählen nicht)."""
    codes = set()
    for alarm in alarms or ():
        if not isinstance(alarm, dict):
            continue
        if alarm.get("severity") != "error":
            continue
        code = alarm.get("code")
        if isinstance(code, str) and code.strip():
            codes.add(code.strip())
    return sorted(codes)


def alarm_lines(alarms, codes) -> list[str]:
    """Klartext je Code — derselbe Text wie im GUI-Header, ohne Zahlen.

    Ein Code kann mehrfach vorkommen (``job_failed`` je Job); jede Variante
    wird eine eigene Zeile, deterministisch in der Reihenfolge von ``codes``.
    """
    by_code: dict[str, list[str]] = {}
    for alarm in alarms or ():
        if not isinstance(alarm, dict) or alarm.get("severity") != "error":
            continue
        code = alarm.get("code")
        if not isinstance(code, str) or not code.strip():
            continue
        message = alarm.get("message")
        job = alarm.get("job")
        label = f"{code} ({job})" if isinstance(job, str) and job else code
        text = message if isinstance(message, str) and message.strip() else ""
        line = f"{label} — {text}" if text else label
        bucket = by_code.setdefault(code, [])
        if line not in bucket:
            bucket.append(line)
    lines: list[str] = []
    for code in codes:
        lines.extend(by_code.get(code) or [code])
    return lines


def build_payload(
    codes: list[str],
    lines: list[str],
    *,
    version: str | None,
    recovered: bool = False,
) -> dict:
    """ntfy-JSON-Payload (reine Funktion — Inhalt und Priorität testbar)."""
    if recovered:
        title = "TankApp: wieder betriebsbereit"
        body = "Kein Alarm mit Schweregrad „error“ mehr offen."
        priority = NTFY_PRIORITY_OK
        tags = ["white_check_mark"]
    else:
        count = len(codes)
        title = f"TankApp: {count} Alarm" if count == 1 else f"TankApp: {count} Alarme"
        body = "\n".join(lines) or ", ".join(codes)
        priority = NTFY_PRIORITY_ERROR
        tags = ["warning"]
    if version:
        body = f"{body}\n(TankApp {version})"
    return {"title": title, "message": body, "priority": priority, "tags": tags}


def state_path(settings):
    return settings.runtime / STATE_RELATIVE[0] / STATE_RELATIVE[1]


def load_state(settings) -> dict:
    """Zustand der Zustellung; kaputte Dateien gelten als leer (Neustart)."""
    path = state_path(settings)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"sent": {}, "last_ok_at": None}
    if not isinstance(raw, dict):
        return {"sent": {}, "last_ok_at": None}
    sent = raw.get("sent")
    return {
        "sent": {
            str(code): str(stamp)
            for code, stamp in sent.items()
            if isinstance(sent, dict) and isinstance(stamp, str)
        }
        if isinstance(sent, dict)
        else {},
        "last_ok_at": raw.get("last_ok_at")
        if isinstance(raw.get("last_ok_at"), str)
        else None,
    }


def save_state(settings, state: dict) -> bool:
    """Atomisch schreiben — ein halber Zustand würde Meldungen verdoppeln."""
    path = state_path(settings)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(temporary, path)
        return True
    except OSError:
        return False


def parse_stamp(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)


def plan(state: dict, codes: list[str], now: dt.datetime) -> dict:
    """Entscheidet aus Zustand + aktuellen Codes, was zu tun ist (rein).

    Ergebnis: ``send`` (Codes für eine Fehlermeldung), ``recovered`` (alle
    Errors weg und es war einer gemeldet), ``forget`` (Codes, die still
    verschwunden sind, weil andere bleiben).
    """
    sent = state.get("sent") or {}
    new = [code for code in codes if code not in sent]
    repeat = []
    for code in codes:
        stamp = parse_stamp(sent.get(code))
        if stamp is not None and (now - stamp).total_seconds() >= NOTIFY_REPEAT_S:
            repeat.append(code)
    gone = [code for code in sent if code not in codes]
    send = sorted(set(new) | set(repeat))
    return {
        "send": send,
        "repeat": sorted(repeat),
        "new": sorted(new),
        "gone": sorted(gone),
        "recovered": bool(gone) and not codes,
    }


def post(
    url: str, payload: dict, *, opener=None, timeout: float = 10.0
) -> tuple[bool, str]:
    """Ein POST, keine Wiederholung im selben Tick.

    ``opener`` ist injizierbar (Tests ohne Netz). Rückgabe: (ok, Ursache) —
    die Ursache ist immer bereinigt, sie kann die Webhook-URL enthalten.
    """
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    open_url = opener or urllib.request.urlopen
    try:
        with open_url(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status >= 400:
                return False, f"HTTP {status}"
        return True, ""
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except Exception as exc:  # Netz, DNS, TLS, Timeout — alles ohne Interna
        return False, public_detail(exc)


class Notifier:
    """Daemon-Thread, der Error-Alarme an den ntfy-Webhook zustellt."""

    def __init__(
        self,
        settings,
        alarms,
        *,
        version: str | None = None,
        opener=None,
        clock=None,
        interval: float = NOTIFY_INTERVAL_S,
    ):
        self.settings = settings
        self.alarms = alarms  # Callable[[], list[dict]] — liefert alarms[]
        self.version = version
        self.opener = opener
        self.clock = clock or (lambda: dt.datetime.now(dt.timezone.utc))
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.last_error = ""

    # --- Betrieb -----------------------------------------------------------
    def start(self):
        if not self.enabled or self.thread is not None:
            return
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        thread, self.thread = self.thread, None
        if thread is not None:
            thread.join(timeout=2.0)

    def _loop(self):
        while not self.stop_event.wait(self.interval):
            try:
                self.tick()
            except Exception as exc:  # der Betrieb darf nie am Push hängen
                self.last_error = public_detail(exc)
                print(f"ntfy: Tick fehlgeschlagen — {self.last_error}", file=sys.stderr)

    @property
    def enabled(self) -> bool:
        return bool(getattr(self.settings, "notify_url", ""))

    # --- ein Prüfschritt ---------------------------------------------------
    def tick(self) -> dict:
        """Ein Prüf-Schritt; liefert, was gesendet wurde (auch für Tests)."""
        url = getattr(self.settings, "notify_url", "")
        if not url:
            return {"skipped": "not_configured", "delivered": False}
        now = self.clock()
        alarms = self.alarms() or []
        codes = error_codes(alarms)
        state = load_state(self.settings)
        decision = plan(state, codes, now)
        result = {
            "codes": codes,
            "new": decision["new"],
            "repeat": decision["repeat"],
            "delivered": False,
            "recovered": decision["recovered"],
        }

        if decision["send"]:
            payload = build_payload(
                decision["send"],
                alarm_lines(alarms, decision["send"]),
                version=self.version,
            )
            ok, cause = post(url, payload, opener=self.opener)
            self.last_error = "" if ok else cause
            result["delivered"] = ok
            result["sent"] = decision["send"]
            if ok:
                stamp = now.isoformat()
                for code in decision["send"]:
                    state["sent"][code] = stamp
                save_state(self.settings, state)
            else:
                print(
                    f"ntfy: Zustellung fehlgeschlagen — {redact(cause)}",
                    file=sys.stderr,
                )
            return result

        if decision["recovered"]:
            payload = build_payload([], [], version=self.version, recovered=True)
            ok, cause = post(url, payload, opener=self.opener)
            self.last_error = "" if ok else cause
            result["delivered"] = ok
            if ok:
                state["sent"] = {}
                state["last_ok_at"] = now.isoformat()
                save_state(self.settings, state)
            else:
                print(
                    f"ntfy: Zustellung fehlgeschlagen — {redact(cause)}",
                    file=sys.stderr,
                )
            return result

        if decision["gone"]:
            # Teilweise beruhigt: Zustand nachziehen, keine eigene Meldung —
            # die nächste Fehlermeldung nennt nur, was wirklich offen ist.
            for code in decision["gone"]:
                state["sent"].pop(code, None)
            save_state(self.settings, state)
        result["sent"] = []
        return result


def notify_status(settings) -> dict:
    """Sichtbarkeit für /api/v1/health: konfiguriert, zuletzt, letzter Fehler."""
    configured = bool(getattr(settings, "notify_url", ""))
    state = load_state(settings)
    return {
        "configured": configured,
        "open_errors": sorted(state.get("sent") or {}),
        "last_ok_at": state.get("last_ok_at"),
    }
