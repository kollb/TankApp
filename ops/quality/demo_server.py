"""Demo-Server für die Qualitäts-Gates (D4): echte App, synthetische Daten.

Startet denselben HTTP-Server wie der Betrieb (``app.server.make_server``),
nur mit injizierter Preisabfrage statt InfluxDB und mit einer im Vorfeld
gerechneten Engine-Publikation. Damit kann Lighthouse das **gefüllte** GUI
messen und der Lastpfad das echte ``/api/v1/overview`` inklusive Decide,
Bootstrap-Draws, gzip und ETag-Revalidierung.

Aufruf::

    python ops/quality/demo_server.py --data-dir /tmp/tankapp-demo \\
        --static web/dist --port 1355

Der Prozess läuft, bis er beendet wird; „bereit“ steht auf stdout, sobald
``/api/v1/health`` antwortet.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import threading
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
OPS = Path(__file__).resolve().parent
if str(OPS) not in sys.path:
    sys.path.insert(0, str(OPS))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("/tmp/tankapp-demo"))
    parser.add_argument("--static", type=Path, default=ROOT / "web/dist")
    parser.add_argument("--port", type=int, default=1355)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--days", type=int, default=70)
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Demo-Daten neu erzeugen, auch wenn sie schon liegen.",
    )
    args = parser.parse_args(argv)

    import demo_data  # noqa: PLC0415 -- erst nach dem sys.path-Aufbau.

    from app.config import Settings
    from app.data import LiveData
    from app.server import make_server

    data_dir = Path(args.data_dir)
    marker = data_dir / "runtime/engine/current.json"
    if args.rebuild or not marker.is_file():
        built = demo_data.build(data_dir, days=args.days)
    else:
        observations = demo_data.synthetic_observations(days=args.days)
        _now, prices = demo_data.latest_prices(observations)
        built = {"observations": observations, "prices": prices}

    settings = Settings(
        data=data_dir,
        archive=data_dir / "archive",
        polling=data_dir / "setup/polling.json",
        influx_env=data_dir / "influx.env",
        netrc=data_dir / "_netrc",
        static=Path(args.static),
    )
    if not (settings.static / "index.html").is_file():
        raise SystemExit(
            f"GUI-Build fehlt unter {settings.static} — vorher "
            "npm --prefix web run build."
        )
    live = LiveData(
        settings,
        query=demo_data.make_query(built["observations"], built["prices"]),
        clock=lambda: dt.datetime.now(dt.timezone.utc),
    )
    # O16: Auch die Selektion (δ̂ mit KI und q-Wert) gehört zum gefüllten
    # Demo-Stapel — das Labor zeigt sie, und die Qualitäts-Gates messen den
    # echten /api/v1/selection-Vertrag statt eines Leerzustands.
    selection_marker = data_dir / "runtime/selection/current.json"
    if args.rebuild or not selection_marker.is_file():
        demo_data.build_selection_artifact(settings, built["observations"])
    server = make_server(settings, args.host, args.port, live)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://{args.host}:{args.port}"
    with urllib.request.urlopen(f"{url}/api/v1/health", timeout=30) as response:
        health = json.load(response)
    print(
        "bereit auf "
        f"{url} — App {health.get('version')}, "
        f"{len(built['prices'])} Demo-Stationen",
        flush=True,
    )
    try:
        thread.join()
    except KeyboardInterrupt:
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
