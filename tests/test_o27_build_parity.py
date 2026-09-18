"""O27 — Bild und Pipeline bauen gegen andere Versionen.

Vor 0.52.0 lief das NAS-Bild auf ``python:3.14-slim-bookworm`` und
``node:26-bookworm-slim``, während die Pipeline gegen Python 3.11/3.12 prüfte
und der web-Job die Node-Version des CI-Runners nahm (``quality.yml`` nannte
dritte Linie 22); ``web/package.json`` hatte kein ``engines``-Feld. „Grün
getestet“ und „ausgeliefert“ waren damit zwei verschiedene Interpreter — bei
``BaseHTTPRequestHandler``, ``zoneinfo``, numpy/pandas und einem Vite-Baum
genau die Stellen, an denen Minor-Versionen Unterschiede machen.

Batch-Check: Ein Pipeline-Job baut das Bild und fährt die Suite **im Bild**;
``web/package.json`` hat ``engines``; Bild und Pipeline nennen dieselbe
Python-Linie. Diese Datei ist der Ratchet, der das Zusammenhalten erzwingt —
eine Zahl im Dockerfile allein driftet wieder.
"""

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = ROOT / "ops" / "nas" / "app" / "Dockerfile"
TESTS_YML = ROOT / ".github" / "workflows" / "tests.yml"
QUALITY_YML = ROOT / ".github" / "workflows" / "quality.yml"
PACKAGE_JSON = ROOT / "web" / "package.json"


def _image_line(arg: str) -> str:
    """Default-Wert eines globalen ARG im Dockerfile (z. B. PYTHON_VERSION)."""
    text = DOCKERFILE.read_text(encoding="utf-8")
    match = re.search(rf"^ARG {arg}=(\S+)$", text, re.MULTILINE)
    assert match, f"Dockerfile nennt {arg} nicht als ARG"
    return match.group(1)


def _from_image(arg: str) -> str:
    """Das FROM, das den ARG nutzt — Beweis, dass er wirklich die Basis wählt."""
    text = DOCKERFILE.read_text(encoding="utf-8")
    match = re.search(rf"^FROM (\S*\${{{arg}}}\S*)", text, re.MULTILINE)
    assert match, f"kein FROM benutzt {arg}"
    return match.group(1)


def test_bild_nennt_python_und_node_linie_als_arg():
    assert _image_line("PYTHON_VERSION") == "3.12"
    assert _image_line("NODE_VERSION") == "22"
    # Die Basis ist festgelegt, nicht nur die Zahl: slim/bookworm gehören dazu
    # (ein Wechsel auf ein volles Image ändert den Bibliotheks-/tzdata-Stand).
    assert _from_image("PYTHON_VERSION") == "python:${PYTHON_VERSION}-slim-bookworm"
    assert _from_image("NODE_VERSION") == "node:${NODE_VERSION}-bookworm-slim"


def test_jedes_from_arg_steht_vor_dem_ersten_from():
    """Docker ersetzt in FROM nur ARGs, die **vor** dem ersten FROM stehen.

    Ein ARG dahinter gehört zur Build-Stage; die nächste FROM-Zeile sähe ein
    leeres ``${PYTHON_VERSION}`` und das Bild hieße ``python:-slim-bookworm``.
    Genau so ist der erste Anlauf dieses Batches am 18.09.2026 im CI-Job
    ``nas-image`` gestorben (``docker build``, exit 1 nach wenigen Sekunden,
    bevor ``npm ci`` lief). Ein Builder ist in der Arbeitsumgebung nicht
    verfügbar — diese Regel hält deshalb der Test, nicht das Bauen.
    """
    lines = DOCKERFILE.read_text(encoding="utf-8").splitlines()
    from_indices = [i for i, line in enumerate(lines) if line.startswith("FROM ")]
    assert from_indices, "Dockerfile hat kein FROM"
    first_from = from_indices[0]
    global_args = set()
    for line in lines[:first_from]:
        match = re.match(r"^ARG (\w+)=", line)
        if match:
            global_args.add(match.group(1))
    used = set()
    for index in from_indices:
        used |= set(re.findall(r"\$\{(\w+)\}", lines[index]))
    assert used, "kein FROM nutzt einen ARG — die Kopplung an die CI wäre lose"
    missing = sorted(used - global_args)
    assert not missing, (
        f"FROM benutzt {missing}, die erst hinter dem ersten FROM deklariert "
        "sind — dort sind sie leer und der Bildname wird ungültig"
    )


def test_python_matrix_enthaelt_die_bild_linie():
    """Batch-Check: Bild und Pipeline nennen dieselbe Python-Linie."""
    matrix = re.search(
        r"python-version:\s*\[([^\]]+)\]", TESTS_YML.read_text(encoding="utf-8")
    )
    assert matrix, "tests.yml hat keine Python-Matrix"
    versions = [v.strip().strip("'\"") for v in matrix.group(1).split(",")]
    assert _image_line("PYTHON_VERSION") in versions, (
        f"Bild läuft auf Python {_image_line('PYTHON_VERSION')}, "
        f"die Matrix prüft {versions}"
    )
    # Der Pi-Collector läuft auf 3.11 (engine/requirements.txt) — die Matrix
    # darf ihn nicht verlieren, während sie das Bild nachzieht.
    assert "3.11" in versions


def test_node_linie_ist_ueberall_dieselbe():
    """Drei Flächen, eine Zahl: Bild, web-Job, quality.yml."""
    node = _image_line("NODE_VERSION")
    tests_yml = TESTS_YML.read_text(encoding="utf-8")
    assert re.search(rf"node-version:\s*'{node}'", tests_yml), (
        "der web-Job pinnt nicht die Node-Linie des Bildes"
    )
    quality = QUALITY_YML.read_text(encoding="utf-8")
    assert re.search(rf'node-version:\s*"{node}"', quality), (
        "quality.yml fährt eine andere Node-Linie als das Bild"
    )


def test_engines_feld_nennt_die_node_linie():
    """Batch-Check: ``web/package.json`` hat ``engines``."""
    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    engines = package.get("engines", {})
    assert "node" in engines, "web/package.json hat kein engines-Feld"
    major = engines["node"].lstrip("^>=~ ").split(".")[0]
    assert major == _image_line("NODE_VERSION"), (
        f"engines nennt Node {engines['node']}, das Bild baut mit "
        f"{_image_line('NODE_VERSION')}"
    )


def test_pipeline_faehrt_die_suite_im_bild():
    """Batch-Check: Ein Job baut das Bild und fährt die Suite **im Bild**."""
    text = TESTS_YML.read_text(encoding="utf-8")
    start = text.index("  nas-image:")
    job = text[start:]
    assert re.search(r"docker build[^\n]*-f ops/nas/app/Dockerfile", job)
    assert "Suite im Bild" in job, "der Job nennt den Nachweis nicht beim Namen"
    # Die Suite läuft im Bild (docker run … pytest), nicht auf dem Runner.
    assert re.search(r"docker run[^\n]*tankapp-web:check", job)
    assert "pytest" in job
    # requirements-dev.txt kommt im Bild dazu, nicht auf dem Runner — sonst
    # wären die Paket-Versionen wieder andere als im Betrieb.
    assert "pip install --no-cache-dir -q -r requirements-dev.txt" in job


def test_zeitzonen_datenstand_kommt_aus_dem_paket():
    """``zoneinfo`` braucht tzdata — in -slim-Images fehlt das Debian-Paket.

    Der Datenstand muss in Bild **und** Pipeline derselbe sein, sonst verschiebt
    sich Europe/Berlin zwischen Test und Betrieb (O27).
    """
    requirements = (ROOT / "app" / "requirements.txt").read_text(encoding="utf-8")
    assert re.search(r"^tzdata>=", requirements, re.MULTILINE), (
        "app/requirements.txt pinnt tzdata nicht — das Bild und die Pipeline "
        "hätten verschiedene Zeitzonen-Datenstände"
    )


@pytest.mark.parametrize("path", [DOCKERFILE, TESTS_YML])
def test_bild_und_pipeline_verweisen_auf_den_ratchet(path):
    """Wer die Zahl ändert, stolpert über den Hinweis auf diese Datei."""
    assert "test_o27_build_parity" in path.read_text(encoding="utf-8")


def test_check_bild_nennt_seinen_commit():
    """Der Check-Build übergibt ``TANKAPP_BUILD_COMMIT`` — sonst lügt ``/health``.

    ``app/version.py`` liest erst die Variable und ruft dann ``git``. Beides
    fehlt im Bild (kein git, kein .git), also bleibt ``commit`` ohne das
    Build-Argument ``null`` — dokumentiert in ``docs/API.md`` und
    ``docs/BETRIEB.md``, dort mit dem Hinweis, die Variable bei Bedarf zu
    setzen. Ohne den Wert prüft der Job ein Bild, das im Fehlerfall nicht
    sagen kann, welcher Stand läuft — genau die Frage, die B9 beantwortet.
    """
    job = TESTS_YML.read_text(encoding="utf-8").split("  nas-image:", 1)[1]
    assert '--build-arg TANKAPP_BUILD_COMMIT="$GITHUB_SHA"' in job, (
        "das Check-Bild baut ohne Commit: /health.commit bliebe null, obwohl "
        "der Betrieb denselben Weg über compose.yml geht"
    )
    # compose.yml muss denselben Namen führen, sonst driftet die Übergabe.
    compose = (ROOT / "ops" / "nas" / "app" / "compose.yml").read_text(encoding="utf-8")
    assert "TANKAPP_BUILD_COMMIT" in compose
