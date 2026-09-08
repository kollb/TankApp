import argparse

from .config import Settings
from .server import serve

parser = argparse.ArgumentParser(description="TankApp GUI + read-only API")
parser.add_argument("--host", default="0.0.0.0")
parser.add_argument("--port", type=int, default=8080)
parser.add_argument("--jobs", action="store_true")
args = parser.parse_args()
serve(Settings.from_env(), args.host, args.port, args.jobs)
