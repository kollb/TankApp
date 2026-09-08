"""Single-origin read-only API + compiled GUI. No credentials or raw files served."""

import functools
import json
import os
import signal
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

from polling_plan import collector_lock
from .config import ROOT
from .data import LiveData, read_json
from .worker import INTERVALS


class Scheduler:
    def __init__(self, settings):
        self.settings = settings
        self.stop_event = threading.Event()
        self.processes = {}
        self.lock = threading.Lock()
        self.threads = []
        self.errors = {}

    def start(self):
        for name in INTERVALS:
            thread = threading.Thread(target=self.loop, args=(name,), daemon=True)
            thread.start()
            self.threads.append(thread)

    def loop(self, name):
        # NAS startup deliberately retries immediately, including missed jobs.
        while not self.stop_event.is_set():
            try:
                code = self.run_once(name)
                if code not in (None, 0, 2):
                    self.errors[name] = "job_start_failed"
                else:
                    self.errors.pop(name, None)
            except OSError:
                # A permissions/Popen failure must not silently kill supervision.
                # Keep diagnostics in memory even if the runtime is unwritable.
                self.errors[name] = "job_start_failed"
            state = read_json(self.settings.runtime / "jobs" / f"{name}.json", {})
            delay = (
                INTERVALS[name]
                if name not in self.errors
                and isinstance(state, dict)
                and state.get("state") == "success"
                else 3600
            )
            self.stop_event.wait(delay)

    def run_once(self, name):
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
        with path.open("ab") as log:
            with self.lock:
                if self.stop_event.is_set():
                    return
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
        # Avoid raw request strings/queries in server logs.
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
        if path == "/api/v1/health":
            return self.data.health()
        if path == "/api/v1/stations":
            return self.data.stations(fuel, city)
        if path == "/api/v1/series":
            return self.data.series(
                value("station_id"), city, fuel, int(value("hours", "24"))
            )
        if path == "/api/v1/forecast":
            return self.data.forecast(value("station_id"), city, fuel)
        return None

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path.startswith("/api/"):
            try:
                payload = self.api(
                    url.path,
                    parse_qs(url.query, keep_blank_values=True, max_num_fields=10),
                )
                self.json(
                    payload if payload is not None else {"error_code": "not_found"},
                    200 if payload is not None else 404,
                )
            except (ValueError, TypeError):
                self.json({"error_code": "invalid_query"}, 400)
            except Exception:
                self.json({"error_code": "server_error"}, 503)
            return
        # Only the built GUI tree, never the repository/data/.env. Reject traversal
        # rather than allowing SimpleHTTPRequestHandler to normalize it to '/'.
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
        # Same access checks as GET; SimpleHTTPRequestHandler suppresses file body for HEAD.
        self.do_GET()


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
    server = make_server(settings, host, port, live)
    # Prevent duplicate job supervisors in the same persistent runtime.
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
