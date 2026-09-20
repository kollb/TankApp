"""Browser fault injector: real NAS + real Pi, no production control routes.

Started by failover.spec.ts after the real demo server is ready. stdin
commands only interrupt the transport; neither API payloads nor UI are mocked.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from rp2.fallback_gui import Context, NasState, install_default_template, make_server  # noqa: E402


def main():
    nas_url = sys.argv[1]
    online = threading.Event()
    online.set()

    class Link(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.forward()

        def do_POST(self):
            self.forward()

        def forward(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            if not online.is_set() and self.path != "/api/v1/health":
                payload, status, headers = b'{"error":"injected_unavailable"}', 503, {}
            else:
                request = urllib.request.Request(
                    nas_url + self.path,
                    data=body if self.command == "POST" else None,
                    method=self.command,
                    headers={
                        k: v
                        for k, v in self.headers.items()
                        if k.lower() not in ("host", "connection", "content-length")
                    },
                )
                try:
                    response = urllib.request.urlopen(request, timeout=30)
                except urllib.error.HTTPError as exc:
                    response = exc
                with response:
                    status, headers, payload = (
                        response.status,
                        dict(response.headers),
                        response.read(),
                    )
            self.send_response(status)
            for key, value in headers.items():
                if key.lower() not in (
                    "content-length",
                    "connection",
                    "transfer-encoding",
                    "server",
                    "date",
                ):
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    link = ThreadingHTTPServer(("127.0.0.1", 0), Link)
    threading.Thread(target=link.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="tankapp-failover-") as directory:
        root = Path(directory)
        with urllib.request.urlopen(nas_url + "/api/v1/stations?fuel=e10") as response:
            stations = json.load(response)["stations"]
        # Preserve the identities from the real NAS in a genuine collector file.
        now = dt.datetime.now(dt.timezone.utc)
        prices = {
            s["station_id"]: {
                "status": "open",
                "e10": s["price"],
                "e5": s["price"],
                "diesel": s["price"],
            }
            for s in stations
        }
        (root / f"{dt.datetime.now():%Y-%m-%d}.jsonl").write_text(
            json.dumps(
                {"fetched_at": now.isoformat(), "city": "Demostadt", "prices": prices}
            )
            + "\n"
        )
        metadata = {
            "sets": {
                "Demostadt": {
                    "stations": [
                        {"uuid": s["station_id"], "name": s["name"]} for s in stations
                    ]
                }
            }
        }
        (root / "polling.json").write_text(json.dumps(metadata))
        install_default_template(root / "templates")
        state = NasState(
            f"http://127.0.0.1:{link.server_port}",
            ttl_online=0.05,
            ttl_offline=0.05,
            recovery_interval=0.05,
        )
        ctx = Context(
            poll_dir=root,
            cache_file=root / "missing.json",
            meta_candidates=[root / "polling.json"],
            template_dir=root / "templates",
            nas_state=state,
        )
        pi = make_server(ctx, "127.0.0.1", 0)
        threading.Thread(target=pi.serve_forever, daemon=True).start()
        print(f"READY http://127.0.0.1:{pi.server_port}", flush=True)
        try:
            for line in sys.stdin:
                if line.strip() == "offline":
                    online.clear()
                else:
                    online.set()
                state.is_online(force=True)
                print("ACK " + line.strip(), flush=True)
        finally:
            pi.shutdown()
            pi.server_close()
            link.shutdown()
            link.server_close()


if __name__ == "__main__":
    # Routine client disconnects are not failures of the test controller.
    with contextlib.suppress(KeyboardInterrupt):
        main()
