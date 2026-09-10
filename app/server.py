"""Single-origin read-only API + compiled GUI. No credentials or raw files served."""

import datetime as dt
import functools
import hmac
import json
import os
import signal
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

from polling_plan import collector_lock
from .config import ROOT
from .data import LiveData, read_json
from .worker import INTERVALS

# Issue 50: Der Uploader-Webhook darf ausschließlich diese Inferenz-Jobs
# anstoßen. Separation of Concerns: Der Webhook meldet nur „neue Daten liegen
# sicher in der InfluxDB“, ob/wann der Job läuft, entscheidet allein der
# Scheduler; ohne Webhook bleibt alles beim intervallo-basierten Betrieb.
TRIGGERABLE_JOBS = ("models", "selection")
# Debounce: Mindestabstand zwischen zwei webhook-ausgelösten Läufen.
TRIGGER_MIN_GAP_S = {"models": 900.0, "selection": 3600.0}
DEFAULT_TRIGGER_GAP_S = 600.0


class Scheduler:
    def __init__(self, settings):
        self.settings = settings
        self.stop_event = threading.Event()
        self.processes = {}
        self.lock = threading.Lock()
        self.threads = []
        self.errors = {}
        # Issue 50: pro Job ein Wake-Event + vorgemerkte Daten-Watermark.
        self.wake = {name: threading.Event() for name in INTERVALS}
        self.pending = {}
        self.trigger_counts = {name: 0 for name in INTERVALS}
        self.trigger_skips = {}
        self.last_start = {}

    def start(self):
        for name in INTERVALS:
            thread = threading.Thread(target=self.loop, args=(name,), daemon=True)
            thread.start()
            self.threads.append(thread)

    def request(self, name, watermark=None):
        """Webhook-Eingang: Watermark vormerken und die Job-Schleife aufwecken."""
        if name not in TRIGGERABLE_JOBS:
            return {"status": "rejected", "reason": "unknown_job"}
        with self.lock:
            self.pending[name] = watermark
        self.wake[name].set()
        return {"status": "queued", "job": name}

    def job_state(self, name):
        return read_json(self.settings.runtime / "jobs" / f"{name}.json", {})

    def stale(self, name, state):
        """True, wenn der letzte Erfolg älter als das Job-Intervall ist."""
        try:
            finished = dt.datetime.fromisoformat(str(state.get("last_success_at")))
        except (TypeError, ValueError):
            return True
        if finished.tzinfo is None:
            finished = finished.replace(tzinfo=dt.timezone.utc)
        age = (dt.datetime.now(dt.timezone.utc) - finished).total_seconds()
        return age >= INTERVALS[name]

    def admit_trigger(self, name, watermark):
        """Entscheidet über einen Webhook-Trigger: Debounce + Idempotenz."""
        gap = TRIGGER_MIN_GAP_S.get(name, DEFAULT_TRIGGER_GAP_S)
        if time.monotonic() - self.last_start.get(name, 0.0) < gap:
            return "debounced"
        state = self.job_state(name)
        if (
            watermark is not None
            and isinstance(state, dict)
            and state.get("state") == "success"
            and str(state.get("data_watermark")) == str(watermark)
            and not self.stale(name, state)
        ):
            # Gleicher Datenstand wie beim letzten erfolgreichen Lauf:
            # Idempotenz — kein erneutes Trainieren für identische Eingabe.
            return "duplicate"
        return "run"

    def next_delay(self, name, state):
        if name in self.errors:
            return 3600
        if not isinstance(state, dict) or state.get("state") != "success":
            return 3600
        return INTERVALS[name]

    def loop(self, name):
        wake = self.wake[name]
        state = self.job_state(name)
        first = True
        while not self.stop_event.is_set():
            # Erster Lauf im Prozess: sofort (bisheriges Verhalten), danach
            # Intervall bzw. Fehler-Backoff — unterbrochen durch Webhook-Triggers.
            fired = wake.wait(0.0 if first else self.next_delay(name, state))
            first = False
            if self.stop_event.is_set():
                break
            watermark = None
            if fired or wake.is_set():
                wake.clear()
                with self.lock:
                    watermark = self.pending.pop(name, None)
                    self.trigger_counts[name] += 1
                decision = self.admit_trigger(name, watermark)
                if decision != "run":
                    with self.lock:
                        self.trigger_skips[name] = decision
                    continue
            try:
                code = self.run_once(name, watermark=watermark)
                if code not in (None, 0, 2):
                    self.errors[name] = "job_start_failed"
                else:
                    self.errors.pop(name, None)
            except OSError:
                self.errors[name] = "job_start_failed"
            state = self.job_state(name)

    def run_once(self, name, watermark=None):
        path = self.settings.runtime / "logs" / f"{name}.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.stat().st_size > 2_000_000:
            path.replace(path.with_suffix(".previous.log"))
        env = {
            **os.environ,
            "TANKAPP_DATA_DIR": str(self.settings.data),
            "TANKAPP_ARCHIVE_DIR": str(self.settings.archive),
            "TANKAPP_POLLING_FILE": str(self.settings.polling),
            "TANKAPP_INFLUX_ENV": str(self.settings.influx_env),
            "TANKAPP_NETRC": str(self.settings.netrc),
            "TANKAPP_HISTORY_DAYS": str(self.settings.history_days),
            "TANKAPP_MODEL_FUELS": ",".join(self.settings.model_fuels),
            "OPENBLAS_NUM_THREADS": "1",
        }
        if watermark is not None:
            # Watermark mitgeben, damit der Worker sie bei Erfolg im
            # Job-Status verankert (Grundlage der Idempotenz über Neustarts).
            env["TANKAPP_TRIGGER_WATERMARK"] = str(watermark)
        with path.open("ab") as log:
            with self.lock:
                if self.stop_event.is_set():
                    return
                self.last_start[name] = time.monotonic()
                process = subprocess.Popen(
                    [sys.executable, "-m", "app.worker", name],
                    cwd=ROOT,
                    env=env,
                    stdin=subprocess.DEVNULL,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
                self.processes[name] = process
            code = process.wait()
            with self.lock:
                self.processes.pop(name, None)
        return code

    def stop(self):
        self.stop_event.set()
        for wake in self.wake.values():
            wake.set()
        with self.lock:
            for process in self.processes.values():
                if process.poll() is None:
                    try:
                        if os.name == "posix":
                            os.killpg(process.pid, signal.SIGTERM)
                        else:
                            process.terminate()
                    except ProcessLookupError:
                        pass
        for thread in self.threads:
            thread.join(timeout=5)
        with self.lock:
            for process in self.processes.values():
                if process.poll() is None:
                    if os.name == "posix":
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        process.kill()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, data, **kwargs):
        self.data = data
        super().__init__(*args, directory=str(data.settings.static), **kwargs)

    def log_message(self, format, *args):
        pass

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
        )
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def json(self, payload, status=200):
        content = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(content)

    def api(self, path, query):
        def value(key, default=None):
            values = query.get(key, [default])
            if len(values) != 1:
                raise ValueError("invalid_query")
            return values[0]

        fuel, city = value("fuel", "e10"), value("city")
        norm_path = path if path.startswith("/api/") else f"/api{path}"

        if norm_path == "/api/v1/health":
            return self.data.health()
        if norm_path == "/api/v1/stations":
            return self.data.stations(fuel, city)
        if norm_path == "/api/v1/series":
            return self.data.series(
                value("station_id"), city, fuel, int(value("hours", "24"))
            )
        if norm_path == "/api/v1/forecast":
            return self.data.forecast(value("station_id"), city, fuel)
        if norm_path == "/api/v1/last_forecasts":
            return self.data.last_forecasts()

        # --- B3 neue Endpunkte ---
        if norm_path == "/api/v1/heatmap":
            kind = value("kind", "level")
            weeks_raw = value("weeks", "6")
            try:
                weeks = int(weeks_raw) if weeks_raw is not None else 6
            except (TypeError, ValueError):
                raise ValueError("invalid_query")
            station_id = value("station_id")
            # city is required for heatmap
            if not city:
                raise ValueError("invalid_query")
            return self.data.heatmap(city, fuel, kind, weeks, station_id)

        if norm_path in ("/api/v1/selection", "/api/v1/stations/selection"):
            return self.data.selection(fuel, city)

        if norm_path == "/api/v1/collector/status":
            return self.data.collector_status()

        if norm_path == "/api/v1/route/evaluate":
            # Sammelt alle Query-Parameter in ein dict (max 15 Felder)
            params = {k: v[0] if len(v) == 1 else v for k, v in query.items()}
            return self.data.route_evaluate(params)

        # --- B4 M5/M7 neue Endpunkte ---
        if norm_path == "/api/v1/decide":
            params = {k: v[0] if len(v) == 1 else v for k, v in query.items()}
            return self.data.decide(params)

        if norm_path == "/api/v1/episodes":
            status = value("status")
            return self.data.episodes(status)

        if norm_path == "/api/v1/stats/summary":
            params = {k: v[0] if len(v) == 1 else v for k, v in query.items()}
            return self.data.stats_summary(params)

        if norm_path in ("/api/v1/day", "/api/day"):
            st_id = value("station") or value("station_id")
            day_str = value("day")
            if not st_id or not day_str:
                raise ValueError("invalid_query")
            return self.data.day_series(st_id, day_str)

        return None

    def do_GET(self):
        try:
            self.serve_get()
        except (BrokenPipeError, ConnectionError):
            pass

    def serve_get(self):
        url = urlsplit(self.path)
        if url.path.startswith("/api/") or url.path.startswith("/v1/"):
            try:
                payload = self.api(
                    url.path,
                    parse_qs(url.query, keep_blank_values=True, max_num_fields=15),
                )
                self.json(
                    payload if payload is not None else {"error_code": "not_found"},
                    200 if payload is not None else 404,
                )
            except ValueError as exc:
                # Bekannte Fach-Codes (unknown_station, invalid_fuel, …)
                # passieren, alles andere bleibt pauschal invalid_query, damit
                # keine Interna (Flux-/Datei-Details) nach außen dringen.
                code = str(exc) or "invalid_query"
                if code in ("unknown_station", "unknown_city"):
                    self.json({"error_code": code}, 404)
                elif code in (
                    "invalid_query",
                    "invalid_fuel",
                    "invalid_liters",
                    "invalid_consumption",
                    "invalid_speed",
                    "invalid_when",
                    "invalid_value_of_time",
                    "invalid_mode",
                    "invalid_detour",
                ):
                    self.json({"error_code": code}, 400)
                else:
                    self.json({"error_code": "invalid_query"}, 400)
            except TypeError:
                self.json({"error_code": "invalid_query"}, 400)
            except Exception:
                self.json({"error_code": "server_error"}, 503)
            return
        parts = unquote(url.path).replace("\\", "/").split("/")
        if any(part.startswith(".") for part in parts if part) or "\x00" in unquote(
            url.path
        ):
            self.send_error(404)
            return
        resolved = (self.data.settings.static / unquote(url.path).lstrip("/")).resolve()
        if not resolved.is_relative_to(self.data.settings.static.resolve()):
            self.send_error(404)
            return
        if self.command == "HEAD":
            super().do_HEAD()
        else:
            super().do_GET()

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        try:
            self.serve_post()
        except (BrokenPipeError, ConnectionError):
            pass

    def serve_post(self):
        url = urlsplit(self.path)
        norm_path = url.path if url.path.startswith("/api/") else f"/api{url.path}"

        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except (TypeError, ValueError):
            # Malformed header: answer 400 instead of dropping the connection.
            self.json({"error_code": "invalid_request"}, 400)
            return

        if length < 0 or length > 100_000:
            self.json({"error_code": "payload_too_large"}, 413)
            return

        try:
            body = self.rfile.read(length) if length else b"{}"
            payload = json.loads(body.decode("utf-8") or "{}")
        except Exception:
            self.json({"error_code": "invalid_json"}, 400)
            return

        if not isinstance(payload, dict):
            self.json({"error_code": "invalid_query"}, 400)
            return

        if norm_path == "/api/v1/collector/heartbeat":
            allowed = {
                "timestamp",
                "last_poll",
                "city",
                "open_count",
                "total_count",
                "tmpfs_used_mb",
                "tmpfs_total_mb",
                "oldest_file_age_days",
                "poll_interval_s",
            }
            cleaned = {k: payload[k] for k in allowed if k in payload}
            # timestamp may arrive as "timestamp" or "last_poll"; normalize to
            # "timestamp" so the response and the stored file always have it.
            ts_raw = cleaned.get("timestamp") or cleaned.get("last_poll")
            if not isinstance(ts_raw, str) or not ts_raw:
                ts_raw = dt.datetime.now(dt.timezone.utc).isoformat()
            cleaned["timestamp"] = ts_raw
            try:
                from polling_plan import atomic_json

                out_path = self.data.settings.runtime / "collector/heartbeat.json"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                atomic_json(out_path, cleaned)
                self.json({"status": "ok", "received_at": cleaned["timestamp"]}, 200)
            except Exception:
                self.json({"error_code": "server_error"}, 503)
            return

        # --- Issue 50: Uploader-Webhook — Trigger nach sicherem InfluxDB-Write ---
        if norm_path == "/api/v1/jobs/trigger":
            expected = getattr(self.data.settings, "webhook_token", "")
            scheduler = getattr(self.data, "scheduler", None)
            endpoint_live = (
                bool(expected)
                and scheduler is not None
                and bool(getattr(self.data, "jobs_enabled", False))
            )
            if not endpoint_live:
                # Ohne Secret/Job-Betrieb existiert der Endpoint bewusst nicht.
                self.json({"error_code": "not_found"}, 404)
                return
            auth = self.headers.get("Authorization", "")
            if not hmac.compare_digest(auth, "Bearer " + expected):
                self.json({"error_code": "unauthorized"}, 403)
                return
            job = payload.get("job")
            raw_watermark = payload.get("watermark")
            if job not in TRIGGERABLE_JOBS:
                self.json({"error_code": "invalid_query"}, 400)
                return
            watermark = None
            if raw_watermark is not None:
                try:
                    watermark = int(raw_watermark)
                except (TypeError, ValueError):
                    self.json({"error_code": "invalid_query"}, 400)
                    return
            self.json(scheduler.request(job, watermark), 200)
            return

        # --- B4 Intent Endpoint: POST /api/v1/episodes/{id}/intent ---
        if norm_path.startswith("/api/v1/episodes/") and norm_path.endswith("/intent"):
            parts = norm_path.split("/")
            # /api/v1/episodes/<id>/intent => parts = ['', 'api', 'v1', 'episodes', '<id>', 'intent']
            if len(parts) == 6:
                episode_id = parts[4]
                intent = payload.get("intent")
                if not intent or intent not in (
                    "wait",
                    "navigate",
                    "refuel_now",
                    "dismiss",
                    "none",
                ):
                    self.json({"error_code": "invalid_query"}, 400)
                    return
                try:
                    res = self.data.set_intent(episode_id, intent)
                    if (
                        isinstance(res, dict)
                        and res.get("error_code") == "episode_not_found"
                    ):
                        self.json(res, 404)
                    else:
                        self.json(res, 200)
                except Exception:
                    self.json({"error_code": "server_error"}, 503)
                return

        # --- B4 Fills Endpoint: POST /api/v1/fills ---
        if norm_path == "/api/v1/fills":
            try:
                res = self.data.record_fill(payload)
                self.json(res, 200)
            except Exception:
                self.json({"error_code": "server_error"}, 503)
            return

        # --- B4 Outcome Alias: POST /api/v1/recommendations/{id}/outcome ---
        if norm_path.startswith("/api/v1/recommendations/") and norm_path.endswith(
            "/outcome"
        ):
            try:
                res = self.data.record_fill(payload)
                self.json(res, 200)
            except Exception:
                self.json({"error_code": "server_error"}, 503)
            return

        # Unknown POST -> 501 to keep read-only contract
        self.send_error(501)

    def do_PUT(self):
        self.send_error(501)

    def do_DELETE(self):
        self.send_error(501)

    def do_PATCH(self):
        self.send_error(501)


def make_server(settings, host="0.0.0.0", port=1355, data=None):
    return ThreadingHTTPServer(
        (host, port), functools.partial(Handler, data=data or LiveData(settings))
    )


def serve(settings, host="0.0.0.0", port=1355, jobs=False):
    if not (settings.static / "index.html").is_file():
        raise ValueError(
            "GUI-Build fehlt. NAS: tankapp.py nas-up; Entwicklung: npm --prefix web run build."
        )
    scheduler = Scheduler(settings)
    live = LiveData(settings)
    live.jobs_enabled = jobs
    live.job_errors = scheduler.errors
    live.scheduler = scheduler
    server = make_server(settings, host, port, live)
    context = (
        collector_lock(settings.runtime / "scheduler", label="NAS-Jobs")
        if jobs
        else None
    )
    if context:
        context.__enter__()
    try:
        if jobs:
            scheduler.start()
        print(
            f"TankApp GUI/API auf {host}:{server.server_port}; Hintergrundjobs {'an' if jobs else 'aus'}.",
            flush=True,
        )

        def stop(signum, frame):
            threading.Thread(target=server.shutdown, daemon=True).start()

        if threading.current_thread() is threading.main_thread():
            signal.signal(signal.SIGTERM, stop)
            signal.signal(signal.SIGINT, stop)
        server.serve_forever(poll_interval=0.2)
    finally:
        scheduler.stop()
        server.server_close()
        if context:
            context.__exit__(None, None, None)
