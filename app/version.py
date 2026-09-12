"""App-Version und Build-Hash für /api/v1/health und den GUI-Footer (B9).

Eine Stelle für „was läuft wo?": Bei Pi / NAS / Fallback-GUI (drei Oberflächen)
muss im Fehlerfall erkennbar sein, welcher Stand ausgeliefert wird. Die Werte
werden beim Import einmalig bestimmt — /health ist ein häufiger, billiger
Endpunkt und soll nicht je Request `git` aufrufen.
"""

import os
import subprocess
from pathlib import Path

# Sprach- und Verhaltens-Version der App. Bei jedem Release anheben;
# Änderungen seit dem letzten Stand stehen im CHANGELOG.md.
VERSION = "0.14.0"

ROOT = Path(__file__).resolve().parents[1]


def _git_commit() -> str | None:
    """Commit-Hash des ausgecheckten Stands — oder None (z. B. Docker-Build ohne .git)."""
    env = os.environ.get("TANKAPP_BUILD_COMMIT")
    if env:
        return env.strip()[:12] or None
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    value = proc.stdout.strip()
    return value[:12] or None


BUILD_COMMIT = _git_commit()


def build_info() -> dict:
    """Versions-Block für /api/v1/health — JSON-serialisierbar, ohne Geheimnisse."""
    return {"version": VERSION, "commit": BUILD_COMMIT}
