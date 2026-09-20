"""Documentation guards: current status, open work and evidence stay separate.

Completed work belongs in the release history, decisions in ADRs, and only
open tasks in TODO. Technical references may lag, but must say so explicitly.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

from app import version as app_version

ROOT = Path(__file__).resolve().parents[1]
TODO = ROOT / "docs/planung/TODO.md"
LUECKEN = ROOT / "docs/planung/LUECKEN.md"
CHANGELOG = ROOT / "docs/releases/CHANGELOG.md"
AUDITS = ROOT / "docs/entwicklung/PRUEFSTAENDE.md"
STAND_ROW = re.compile(
    r"Stand:[^\n]*?App-Version\s*\**\s*(\d+\.\d+\.\d+)", re.IGNORECASE
)
TASK_HEADING = re.compile(r"^### ([A-Z]\d+): (.+)$", re.MULTILINE)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _stand_match(text: str):
    return STAND_ROW.search("\n".join(text.splitlines()[:12]))


def _documents() -> list[Path]:
    return [
        ROOT / "README.md",
        ROOT / "CONTRIBUTING.md",
        *(
            path
            for path in sorted((ROOT / "docs").rglob("*.md"))
            if not {"archiv", "releases"}.intersection(path.relative_to(ROOT).parts)
        ),
    ]


def test_stand_zeilen_nennen_die_app_version() -> None:
    for path in (TODO, LUECKEN):
        match = _stand_match(_read(path))
        assert match and match.group(1) == app_version.VERSION, path
    newest = re.search(r"^## \[([^\]]+)\]", _read(CHANGELOG), re.MULTILINE)
    assert newest and newest.group(1) == app_version.VERSION


def test_todo_hat_nur_offene_aufgaben_mit_abnahme() -> None:
    text = _read(TODO)
    tasks = list(TASK_HEADING.finditer(text))
    assert tasks, "Aufgaben müssen über stabile IDs auffindbar bleiben."
    ids = [task.group(1) for task in tasks]
    assert not [key for key, count in Counter(ids).items() if count > 1]
    for index, task in enumerate(tasks):
        end = tasks[index + 1].start() if index + 1 < len(tasks) else len(text)
        body = text[task.end() : end].split("\n## ")[0]
        assert "**Abnahme:**" in body, task.group(1)
        assert re.search(r"\*\*P[012]", body), task.group(1)
        assert re.search(r"^- \[ \] ", body, re.MULTILINE), task.group(1)
        assert not re.search(r"erledigt|geschlossen", task.group(2), re.IGNORECASE)
    # Known completed/declined work must not return as an open heading.
    assert not set(ids).intersection(
        {"A9", "A10", "A11", "A12", "A13", "A16", "B22", "B25", "C12", "C13", "G4"}
    )
    assert not re.search(r"^## Erledigt|^\|\s*Version\s*\|", text, re.MULTILINE)


def test_todo_enthaelt_keine_wunschliste_oder_warteabschnitte() -> None:
    text = _read(TODO)
    # Other material belongs in the plan/status/archive, not in another TODO section.
    assert re.findall(r"^## (.+)$", text, re.MULTILINE) == ["Inhaltsverzeichnis"]
    assert not re.search(r"^- \[x\]|^\|", text, re.MULTILINE | re.IGNORECASE)
    first_task = TASK_HEADING.search(text)
    assert first_task
    assert not re.search(r"^### ", text[: first_task.start()], re.MULTILINE)
    for title in re.findall(r"^### (.+)$", text, re.MULTILINE):
        assert re.match(r"[A-Z]\d+: ", title), title


def test_status_trennt_arbeit_betriebsnachweis_und_entscheidungen() -> None:
    text = _read(LUECKEN)
    for heading in (
        "Implementierter Stand",
        "Offene Arbeit",
        "Ausstehender Betriebsnachweis",
        "Bewusste Grenzen",
    ):
        assert f"## {heading}" in text
    # Deferred work and accepted scope constraints need explicit reasons.
    for heading in ("Ausstehender Betriebsnachweis", "Bewusste Grenzen"):
        block = text.split(f"## {heading}\n", 1)[1].split("\n## ", 1)[0]
        rows = [line for line in block.splitlines() if line.startswith("| ")][1:]
        assert rows, heading
        for row in rows:
            cells = [cell.strip() for cell in row.strip("|").split("|")]
            assert len(cells) >= 2 and all(cells), row
    waiting = text.split("## Ausstehender Betriebsnachweis\n", 1)[1].split("\n## ", 1)[
        0
    ]
    for completed in (
        "E2E ohne Mocks",
        "PWA/Service Worker",
        "Offline-Queue für Fill/Intent",
    ):
        assert completed not in waiting


def test_keine_stand_zeile_behauptet_eine_zukunftige_version() -> None:
    version = tuple(map(int, app_version.VERSION.split(".")))
    for path in _documents():
        match = _stand_match(_read(path))
        if match:
            assert tuple(map(int, match.group(1).split("."))) <= version, path


def test_jedes_dokument_hat_eine_stand_zeile() -> None:
    missing = [
        str(path.relative_to(ROOT))
        for path in _documents()
        if "Stand:" not in "\n".join(_read(path).splitlines()[:12])
    ]
    assert not missing, f"Ohne Stand-Zeile im Kopf: {missing}"


def test_jedes_dokument_hat_ein_inhaltsverzeichnis() -> None:
    missing = [
        str(path.relative_to(ROOT))
        for path in _documents()
        # Folder READMEs are indexes themselves; the root README is not.
        if not (path.name == "README.md" and path.parent != ROOT)
        and "Inhaltsverzeichnis" not in "\n".join(_read(path).splitlines()[:80])
    ]
    assert not missing, f"Ohne Inhaltsverzeichnis im Kopf: {missing}"


def test_veraltete_stand_zeilen_stehen_in_der_liste() -> None:
    lagging = set()
    for path in _documents():
        match = _stand_match(_read(path))
        if match and match.group(1) != app_version.VERSION:
            lagging.add(path.resolve())
    # Resolve link destinations, not basenames: thematic folders may reuse names.
    listed = {
        (AUDITS.parent / destination).resolve()
        for destination in re.findall(r"^\| \[[^]]+\]\(([^)]+)\)", _read(AUDITS), re.M)
    }
    assert listed == lagging, (
        f"Prüfstandsliste weicht ab: fehlen={lagging - listed}, "
        f"überflüssig={listed - lagging}"
    )


def test_root_bleibt_frei_von_fachdokumenten() -> None:
    allowed = {"README.md", "CONTRIBUTING.md", "AGENTS.md"}
    assert {path.name for path in ROOT.glob("*.md")} == allowed
    assert not list(ROOT.glob("*.docx"))
    assert {path.name for path in (ROOT / "docs").glob("*.md")} == {"README.md"}


def test_neu_archivierte_berichte_haben_nachfolger() -> None:
    for name in ("BEFUND-UX-MATH-2026-09-19", "ANALYSE-B0-B1-B2-2026-09-19"):
        path = ROOT / "docs/archiv" / f"{name}.md"
        head = "\n".join(_read(path).splitlines()[:12])
        assert "Historischer Prüfbericht" in head
        assert "../planung/TODO.md" in head
        assert f"({name}.md)" in _read(ROOT / "docs/archiv/README.md")
