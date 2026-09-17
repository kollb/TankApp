"""B4: Alarm-Zustellung über ntfy — ein Webhook, kein Auth-Ausbau.

Die Aggregation ist seit 0.10.0 fertig (``app/alarms.py`` → ``alarms[]`` in
``/api/v1/health`` + roter/gelber Punkt im GUI-Header). Offen war der Teil,
der hier steht: Jemand schaut nur hin, wenn die GUI offen ist. Dieses Modul
schickt Alarme mit ``severity: error`` an einen einzigen konfigurierten
ntfy-Endpunkt (``TANKAPP_NTFY_URL``, URL inklusive Topic).

Grundsätze:

- **O42 — die Kanal-Entscheidung (dokumentiert, statt offen):** Der Push teilt
  sich in zwei Meldungsarten mit unterschiedlicher Datentiefe.
  *Alarm-Meldungen* (``severity: error``) bleiben immer bei Codes und
  Klartexten — keine Preise, keine Stationen, unabhängig vom Kanal.
  *Fenster-Meldungen* (O29: Fenster offen, Empfehlung geändert, Fenster
  verstrichen) richten sich nach dem konfigurierten Modus
  (``TANKAPP_NTFY_MODE``, siehe unten). **Entscheidung:** Default ist
  ``public`` — der Endpunkt gilt als fremder/öffentlicher Dienst (z. B.
  ntfy.sh), die URL ist ein Bearer-Secret und schon die Zeitpunkte der
  Meldungen sind Metadaten über das Tankverhalten; deshalb bleiben
  Fenster-Meldungen dort bei neutralen Sätzen ohne Preis und Station. Wer
  einen **eigenen ntfy-Server im LAN** betreibt, schaltet ``lan`` frei:
  Dann dürfen Fenster-Meldungen Station, Fensterzeit und erwarteten Preis
  nennen — weiterhin verboten bleiben Koordinaten, Pfade und Zugangsdaten.
  Die Regel ist keine Frage der Vorsicht, sondern der Konfiguration: beide
  Modi sind getestet (``tests/test_notify.py``), der gewählte Modus steht in
  ``/api/v1/health`` → ``notify.mode``.
- **Keine Preis- oder Stationsdetails im Alarm-Text.** Verschickt werden die stabilen
  Alarm-Codes, ihre deutschen Klartexte aus ``app/alarms.py`` (die selbst keine
  Zahlen tragen) und die App-Version. Keine Koordinaten, keine Stationen, keine
  Preise, keine Pfade, keine Zugangsdaten — die URL ist der einzige
  Geheimnisträger und wird in jeder Ausgabe bereinigt (``app/errors.redact``).
- **Zustandswechsel statt Dauerschleife**: Gesendet wird, wenn ein Error-Code
  neu auftaucht, wenn er nach ``NOTIFY_REPEAT_S`` weiterhin besteht
  (Erinnerung, damit ein Dauerfehler nicht still bleibt) und einmal, wenn alle
  Errors weg sind („wieder betriebsbereit“). ``warn`` bleibt in der GUI — Push
  ist für ``error`` gedacht.
- **Fenster-Meldungen (O29)**: genau eine Meldung je Episode beim Öffnen eines
  empfohlenen Fensters (Verteilungs-P über ``WINDOW_PUSH_P_MIN``), eine
  Abschlussmeldung, wenn das Fenster ungenutzt verstreicht, und eine
  Änderungs-Meldung, wenn die Empfehlung auf ein anderes Fenster kippt.
  Entdupliziert über die ``episode.id``, nachts still (Ruhezeit
  ``WINDOW_QUIET_HOURS``) — Alarm-Meldungen kennen keine Ruhezeit, sie sind
  ``severity: error``.
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

try:
    from zoneinfo import ZoneInfo

    _BERLIN_TZ = ZoneInfo("Europe/Berlin")
except Exception:  # pragma: no cover
    _BERLIN_TZ = dt.timezone.utc

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

# O29: Fenster-Meldungen. ``WINDOW_PUSH_P_MIN`` ist die Verteilungs-P, ab der
# ein empfohlenes Fenster eine Meldung wert ist — unterhalb bleibt der Push
# still (das Fenster ist dann in der GUI ebenso wenig hervorgehoben). Die
# Ruhezeit gilt nur für Fenster-Meldungen; Alarme (``severity: error``)
# werden rund um die Uhr zugestellt.
WINDOW_PUSH_P_MIN = 0.60
WINDOW_QUIET_HOURS = (22.0, 7.0)  # Europe/Berlin: von 22 Uhr bis 7 Uhr
NTFY_PRIORITY_WINDOW = 3
WINDOWS_STATE_RELATIVE = ("notify", "windows.json")


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


# ---------------------------------------------------------------------------
# O29/O42: Fenster-Meldungen — eine Meldung, wenn das empfohlene Fenster
# aufgeht, sich die Empfehlung ändert oder das Fenster ungenutzt verstreicht.
# Der Payload richtet sich nach dem Push-Modus (O42): ``public`` bleibt ohne
# Preis/Station, ``lan`` darf beides nennen (nie Koordinaten oder Pfade).
# ---------------------------------------------------------------------------


def windows_state_path(settings):
    return settings.runtime / WINDOWS_STATE_RELATIVE[0] / WINDOWS_STATE_RELATIVE[1]


def load_windows_state(settings) -> dict:
    """Zustand der Fenster-Meldungen; kaputte Dateien gelten als leer."""
    try:
        raw = json.loads(windows_state_path(settings).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"episodes": {}}
    episodes = raw.get("episodes") if isinstance(raw, dict) else None
    return {
        "episodes": {
            str(ep_id): entry
            for ep_id, entry in (episodes or {}).items()
            if isinstance(entry, dict)
        }
    }


def save_windows_state(settings, state: dict) -> bool:
    """Atomisch schreiben — ein halber Zustand würde Meldungen verdoppeln."""
    path = windows_state_path(settings)
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


def in_quiet_hours(
    stamp: dt.datetime, quiet: tuple[float, float] = WINDOW_QUIET_HOURS
) -> bool:
    """Ruhezeit in Europe/Berlin (Default 22–7 Uhr) — nur für Fenster-Meldungen."""
    try:
        hour = (
            stamp.astimezone(_BERLIN_TZ).hour
            + stamp.astimezone(_BERLIN_TZ).minute / 60.0
        )
    except (ValueError, OverflowError, OSError):
        return False
    start, end = quiet
    return hour >= start or hour < end


def _de_price(value: float) -> str:
    """Niveaus in €/L, de-DE (MICROCOPY) — 1,719 €/L statt 1.719."""
    return f"{value:.3f} €/L".replace(".", ",")


def _berlin_hhmm(iso_value: str | None) -> str | None:
    """ISO-Zeitstempel als „HH:MM Uhr“ in Europe/Berlin, sonst None."""
    if not isinstance(iso_value, str) or not iso_value.strip():
        return None
    try:
        stamp = dt.datetime.fromisoformat(iso_value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=dt.timezone.utc)
    try:
        berlin = stamp.astimezone(_BERLIN_TZ)
    except (ValueError, OverflowError, OSError):
        return None
    return f"{berlin.hour:02d}:{berlin.minute:02d} Uhr"


def window_signature(snapshot: dict) -> str:
    """Identität des empfohlenen Fensters — kippt sie, kippt die Empfehlung."""
    return "|".join(
        str(snapshot.get(key) or "")
        for key in ("station_id", "window_start", "window_end")
    )


def _pushable_window(snapshot: dict, p_min: float) -> bool:
    """Ein Fenster ist meldepflichtig, wenn die Verteilungs-P die Schwelle trägt.

    ``p_besser`` ist die Verteilungs-P aus den Draws (O5: ``p_source``) —
    die Basisrate kann eine Meldung nie auslösen. Fehlt die Verteilungs-P,
    fehlt die Messung: kein Push statt einer behaupteten Sicherheit.
    """
    if not isinstance(snapshot, dict):
        return False
    if snapshot.get("action") != "wait":
        return False
    if not snapshot.get("window_start") or not snapshot.get("window_end"):
        return False
    try:
        p = float(snapshot.get("p_besser"))
    except (TypeError, ValueError):
        return False
    return p == p and p >= p_min  # NaN scheitert am Selbstvergleich


def plan_window_events(
    store: dict, state: dict, *, p_min: float = WINDOW_PUSH_P_MIN
) -> list[dict]:
    """Entscheidet aus Store + Melde-Zustand, welche Fenster-Meldung fällig ist.

    Rein (keine Uhr nötig — die Ruhezeit prüft der Zustell-Pfad): liefert je
    Episode höchstens ein Ereignis, Art ``open`` · ``changed`` · ``expired``.
    Eine Episode, die nie gemeldet wurde (P unterhalb der Schwelle), erzeugt
    auch keine Abschlussmeldung — es gibt nichts abzuschließen.
    """
    events: list[dict] = []
    notified = (state or {}).get("episodes") or {}
    for ep in (store or {}).get("episodes") or []:
        if not isinstance(ep, dict):
            continue
        ep_id = ep.get("id")
        if not isinstance(ep_id, str) or not ep_id:
            continue
        status = ep.get("status")
        snapshot = ep.get("last_snapshot") or {}
        entry = notified.get(ep_id)
        if status in ("open", "waiting", "due"):
            if not _pushable_window(snapshot, p_min):
                continue
            signature = window_signature(snapshot)
            if entry is None:
                events.append(
                    {
                        "episode_id": ep_id,
                        "kind": "open",
                        "snapshot": snapshot,
                        "signature": signature,
                    }
                )
            elif entry.get("signature") != signature and not entry.get(
                "expired_notified"
            ):
                events.append(
                    {
                        "episode_id": ep_id,
                        "kind": "changed",
                        "snapshot": snapshot,
                        "signature": signature,
                    }
                )
        elif status == "expired":
            if entry is not None and not entry.get("expired_notified"):
                events.append(
                    {
                        "episode_id": ep_id,
                        "kind": "expired",
                        "snapshot": snapshot,
                        "signature": entry.get("signature")
                        or window_signature(snapshot),
                    }
                )
        # „resolved“: Die Episode wurde genutzt — der Beleg spricht selbst,
        # keine Abschlussmeldung. Der Zustand wird bei Gelegenheit entrümpelt.
    return events


def build_window_payload(
    kind: str,
    snapshot: dict,
    *,
    mode: str,
    version: str | None = None,
) -> dict:
    """ntfy-Payload einer Fenster-Meldung (rein — Inhalt je Modus testbar).

    O42: ``mode="public"`` bleibt bei neutralen Sätzen (keine Preise, keine
    Stationen); ``mode="lan"`` nennt Station, Fensterzeit und erwarteten
    Preis. Koordinaten und Pfade stehen in keinem der beiden Modi.
    """
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    detail = mode == "lan"
    station = str(snapshot.get("station_name") or "").strip()
    window_text = None
    start_text = _berlin_hhmm(snapshot.get("window_start"))
    end_text = _berlin_hhmm(snapshot.get("window_end"))
    if start_text and end_text:
        window_text = f"{start_text}–{end_text}"
    try:
        expected_price = float(snapshot.get("expected_price"))
    except (TypeError, ValueError):
        expected_price = None

    if kind == "open":
        title = "TankApp: Günstiges Tankfenster offen"
        if detail:
            parts = ["Empfehlung: mit dem Tanken warten."]
            if station:
                parts.append(f"Station: {station}.")
            if window_text:
                parts.append(f"Fenster: {window_text}.")
            if expected_price is not None:
                parts.append(f"Erwarteter Preis: {_de_price(expected_price)}.")
            parts.append("Details in der App.")
            body = " ".join(parts)
        else:
            body = (
                "Ein empfohlenes Zeitfenster zum Tanken ist aufgegangen. "
                "Details in der App."
            )
        priority, tags = NTFY_PRIORITY_WINDOW, ["fuelpump"]
    elif kind == "changed":
        title = "TankApp: Tank-Empfehlung geändert"
        if detail:
            parts = ["Die Empfehlung hat sich geändert."]
            if snapshot.get("action") == "wait" and window_text:
                if station:
                    parts.append(f"Neues Fenster: {window_text} ({station}).")
                else:
                    parts.append(f"Neues Fenster: {window_text}.")
                if expected_price is not None:
                    parts.append(f"Erwarteter Preis: {_de_price(expected_price)}.")
            elif station:
                parts.append(f"Betroffene Station: {station}.")
            parts.append("Details in der App.")
            body = " ".join(parts)
        else:
            body = "Die Tank-Empfehlung hat sich geändert. Neuer Stand in der App."
        priority, tags = NTFY_PRIORITY_WINDOW, ["left_right_arrow"]
    else:  # expired
        title = "TankApp: Tankfenster verstrichen"
        if detail:
            parts = [
                "Das empfohlene Zeitfenster ist zu Ende gegangen, ohne dass ein Beleg gebucht wurde."
            ]
            if window_text or station:
                detail_bits = ", ".join(bit for bit in (window_text, station) if bit)
                parts.append(f"({detail_bits})")
            body = " ".join(parts)
        else:
            body = (
                "Das empfohlene Zeitfenster ist zu Ende gegangen, "
                "ohne dass ein Beleg gebucht wurde."
            )
        priority, tags = NTFY_PRIORITY_OK, ["hourglass_done"]

    if version:
        body = f"{body}\n(TankApp {version})"
    return {"title": title, "message": body, "priority": priority, "tags": tags}


def prune_windows_state(state: dict, store: dict) -> bool:
    """Wirft Melde-Zustände heraus, deren Episode nicht mehr im Store ist.

    Rückgabe: True, wenn sich etwas geändert hat. Die Retention räumt den
    Store nach 90 Tagen auf; der Melde-Zustand folgt, sonst wüchse er für immer.
    """
    episodes = state.get("episodes") or {}
    present = {
        ep.get("id")
        for ep in (store or {}).get("episodes") or []
        if isinstance(ep, dict) and isinstance(ep.get("id"), str)
    }
    stale = [ep_id for ep_id in episodes if ep_id not in present]
    for ep_id in stale:
        episodes.pop(ep_id, None)
    state["episodes"] = episodes
    return bool(stale)


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
        elif decision["recovered"]:
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
        elif decision["gone"]:
            # Teilweise beruhigt: Zustand nachziehen, keine eigene Meldung —
            # die nächste Fehlermeldung nennt nur, was wirklich offen ist.
            for code in decision["gone"]:
                state["sent"].pop(code, None)
            save_state(self.settings, state)
        result.setdefault("sent", [])

        # O29: Fenster-Meldungen — eigener Zustand, eigene Regeln (O42-Modus,
        # Ruhezeit). Ein Fehlschlag hier berührt den Alarm-Zustand nicht.
        try:
            window_result = self.window_tick(now)
        except Exception as exc:  # der Betrieb darf nie am Push hängen
            print(
                f"ntfy: Fenster-Prüfschritt fehlgeschlagen — {public_detail(exc)}",
                file=sys.stderr,
            )
            window_result = {"sent": [], "deferred": [], "delivered": False}
        if window_result.get("sent") or window_result.get("deferred"):
            result["windows"] = window_result
            result["delivered"] = bool(
                result["delivered"] or window_result.get("delivered")
            )
        return result

    # --- Fenster-Meldungen (O29) --------------------------------------------
    def window_tick(self, now: dt.datetime | None = None) -> dict:
        """Ein Prüf-Schritt für Fenster-Meldungen: Store lesen, Ereignisse
        planen, außerhalb der Ruhezeit höchstens je eine Meldung je Episode
        zustellen. Liest den Feedback-Store (kein Schreibzugriff) und macht
        nie einen Netz-Zugriff außer dem Versand selbst.
        """
        url = getattr(self.settings, "notify_url", "")
        if not url:
            return {"sent": [], "deferred": [], "delivered": False}
        now = now or self.clock()
        try:
            from .feedback import load_store

            store = load_store(self.settings)
        except Exception:
            return {"sent": [], "deferred": [], "delivered": False}
        state = load_windows_state(self.settings)
        if prune_windows_state(state, store):
            save_windows_state(self.settings, state)
        events = plan_window_events(store, state)
        result: dict = {"sent": [], "deferred": [], "delivered": False}
        if not events:
            return result
        # Ruhezeit (Europe/Berlin): Fenster-Meldungen warten bis zum Morgen —
        # Alarm-Meldungen kennen diese Pause bewusst nicht.
        if in_quiet_hours(now):
            result["deferred"] = sorted({event["kind"] for event in events})
            return result
        mode = getattr(self.settings, "notify_mode", "public")
        for event in events:
            payload = build_window_payload(
                event["kind"],
                event["snapshot"],
                mode=mode,
                version=self.version,
            )
            ok, cause = post(url, payload, opener=self.opener)
            if not ok:
                self.last_error = cause
                print(
                    f"ntfy: Zustellung fehlgeschlagen — {redact(cause)}",
                    file=sys.stderr,
                )
                continue
            result["sent"].append(event["kind"])
            result["delivered"] = True
            entry = state["episodes"].setdefault(event["episode_id"], {})
            if event["kind"] == "expired":
                entry["expired_notified"] = True
            else:
                entry["signature"] = event["signature"]
                entry["notified_at"] = now.isoformat()
            save_windows_state(self.settings, state)
        return result


def notify_status(settings) -> dict:
    """Sichtbarkeit für /api/v1/health: konfiguriert, offen, zuletzt gemeldet.

    Liest ausschließlich die lokale Zustandsdatei — kein Netz, damit das
    Healthcheck-Budget (3–5 s) bleibt. ``last_sent_at`` ist der jüngste
    Zeitstempel einer tatsächlich zugestellten Fehlermeldung, ``last_ok_at``
    der letzten „wieder betriebsbereit“-Meldung. Die Webhook-URL ist der
    einzige Geheimnisträger und erscheint hier bewusst **nicht**.
    """
    configured = bool(getattr(settings, "notify_url", ""))
    mode = getattr(settings, "notify_mode", "public")
    state = load_state(settings)
    sent = state.get("sent") or {}
    stamps = sorted(value for value in sent.values() if isinstance(value, str))
    return {
        "configured": configured,
        # O42: Der gewählte Push-Modus ist sichtbar, damit die Datentiefe der
        # Fenster-Meldungen (O29) keine Überraschung ist.
        "mode": mode if mode in ("public", "lan") else "public",
        "open_errors": sorted(sent),
        "last_ok_at": state.get("last_ok_at"),
        "last_sent_at": stamps[-1] if stamps else None,
    }
