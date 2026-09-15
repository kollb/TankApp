"""Drift-Test für die Arbeitsliste: TODO.md und der Abgleich-Ledger dürfen
nicht auseinanderlaufen.

Der Befund, der diesen Test ausgelöst hat (15.09.2026): `TODO.md` stand im Kopf
auf 0.32.0, während die App längst 0.37.2 war; erledigte Punkte (A9–A13, C3–C8,
D4, F3, G4, H3, H5) hingen mit „*(Erledigt in …)*“ weiter in den **offenen**
Tabellen, und `docs/LUECKEN.md` behauptete in der Kurzfassung einen Stand von
0.11.0. Ein Ledger, der ordentlicher aussieht als der Code, ist wertlos — dieser
Test hält die drei Regeln fest, die daraus entstanden sind:

1. Stand-Zeilen (TODO-Kopf, LUECKEN-Kopf, neueste CHANGELOG-Version) nennen die
   Version aus `app/version.py`.
2. Kein Punkt ist gleichzeitig offen und erledigt, und eine offene Zeile
   behauptet nicht, erledigt zu sein.
3. Jede Zeile unter „Bewusst offen“ trägt eine Statusmarke — damit sichtbar
   bleibt, was Arbeit ist, was auf Betriebsdaten wartet und was entschieden ist.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

from app import version as app_version

ROOT = Path(__file__).resolve().parents[1]
TODO = ROOT / "TODO.md"
LUECKEN = ROOT / "docs" / "LUECKEN.md"
CHANGELOG = ROOT / "CHANGELOG.md"

# Tabellenzeile mit Aufgaben-ID, z. B. „| B22 | D | …“.
TASK_ROW = re.compile(r"^\|\s*([A-Z]\d+)\s*\|", re.MULTILINE)
# Stand-Zeile mit App-Version, z. B. „> Stand: 15.09.2026 · App-Version 0.38.0“.
STAND_ROW = re.compile(
    r"Stand:[^\n]*?App-Version\s*\**\s*(\d+\.\d+\.\d+)", re.IGNORECASE
)
AUDIT_HEADING = "### Nicht gegen die aktuelle Version geprüft"
# Statusmarken unter „Bewusst offen (Backlog mit Grund)“.
MARKEN = ("Arbeit", "wartet auf Betrieb", "entschieden")
DONE_HEADING = "## Erledigt — hier gestrichen"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _open_todo_section() -> str:
    """Der offene Teil von TODO.md (alles vor der Erledigt-Tabelle)."""
    text = _read(TODO)
    return text[: text.index(DONE_HEADING)]


def test_stand_zeilen_nennen_die_app_version() -> None:
    """Regel 1: Die Stand-Zeile ist keine Stimmung, sondern die Version."""
    todo_head = _read(TODO).splitlines()[0]
    assert f"App-Version {app_version.VERSION}" in todo_head, (
        f"TODO.md-Kopf nennt nicht {app_version.VERSION}: {todo_head}"
    )

    luecken_head = next(
        line for line in _read(LUECKEN).splitlines() if line.startswith("> Stand:")
    )
    assert f"App-Version {app_version.VERSION}" in luecken_head, (
        f"LUECKEN.md-Kopf nennt nicht {app_version.VERSION}: {luecken_head}"
    )

    newest = re.search(r"^## \[([^\]]+)\]", _read(CHANGELOG), re.MULTILINE)
    assert newest and newest.group(1) == app_version.VERSION, (
        "Die neueste CHANGELOG-Version muss die App-Version sein "
        f"({app_version.VERSION})."
    )


def test_kein_punkt_ist_offen_und_erledigt_zugleich() -> None:
    """Regel 2: Eine ID steht entweder oben oder unten — nie in beiden."""
    text = _read(TODO)
    open_ids = set(TASK_ROW.findall(text[: text.index(DONE_HEADING)]))
    done_ids = set(TASK_ROW.findall(text[text.index(DONE_HEADING) :]))
    assert not (open_ids & done_ids), (
        "Diese Punkte stehen gleichzeitig als offen und als erledigt in "
        f"TODO.md: {sorted(open_ids & done_ids)}"
    )


def test_offene_zeilen_behaupten_nicht_erledigt_zu_sein() -> None:
    """Erledigtes gehört in die Erledigt-Tabelle, nicht in die offene Liste."""
    open_section = _open_todo_section()
    offenders = [
        line[:120]
        for line in open_section.splitlines()
        if TASK_ROW.match(line) and re.search(r"erledigt", line, re.IGNORECASE)
    ]
    assert not offenders, "Offene Zeilen behaupten, erledigt zu sein:\n" + "\n".join(
        offenders
    )

    ids = TASK_ROW.findall(open_section)
    duplicates = [item for item, count in Counter(ids).items() if count > 1]
    assert not duplicates, f"Doppelte Zeilen in der offenen Liste: {duplicates}"


def _version_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))


def _stand_match(text: str):
    """Die Stand-Zeile steht oben im Kopf (AGENTS-Regel) — nur dort suchen.

    Sonst trifft der Ausdruck Fließtext weiter unten, in dem zufällig „Stand:“
    und „App-Version“ auf einer Zeile stehen.
    """
    head = "\n".join(text.splitlines()[:12])
    return STAND_ROW.search(head)


def _documents() -> list[Path]:
    """Alle Dokumente außer dem Archiv (das ist bewusst historisch)."""
    return [
        ROOT / "README.md",
        *(
            path
            for path in sorted((ROOT / "docs").rglob("*.md"))
            if "archiv" not in path.parts
        ),
    ]


def test_keine_stand_zeile_behauptet_eine_zukunftige_version() -> None:
    """Kein Dokument darf neuer tun, als die App ist."""
    for path in _documents():
        match = _stand_match(_read(path))
        if not match:
            continue
        claimed = _version_tuple(match.group(1))
        assert claimed <= _version_tuple(app_version.VERSION), (
            f"{path.relative_to(ROOT)}: Stand-Zeile behauptet App-Version "
            f"{match.group(1)}, die App ist {app_version.VERSION}."
        )


def test_jedes_dokument_hat_eine_stand_zeile() -> None:
    """AGENTS-Regel: Stand-Zeile oben — sonst weiß niemand, wogegen geprüft ist."""
    missing = [
        str(path.relative_to(ROOT))
        for path in _documents()
        if "Stand:" not in "\n".join(_read(path).splitlines()[:12])
    ]
    assert not missing, f"Ohne Stand-Zeile im Kopf: {missing}"


def test_veraltete_stand_zeilen_stehen_in_der_liste() -> None:
    """Ein Dokument darf zurückfallen — aber nicht unbemerkt.

    `docs/README.md` führt unter „Nicht gegen die aktuelle Version geprüft“
    genau die Dokumente, deren Stand-Zeile älter ist als die App. Beide
    Richtungen werden geprüft: keine Liste ohne Grund, kein alter Stand ohne
    Listeneintrag.
    """
    versioned: dict[str, str] = {}
    for path in _documents():
        if path.name == "README.md" and path.parent == ROOT / "docs":
            continue  # der Index selbst zählt nicht als Fundstelle
        match = _stand_match(_read(path))
        if match:
            versioned[path.name] = match.group(1)
    lagging = {
        name for name, value in versioned.items() if value != app_version.VERSION
    }

    index = _read(ROOT / "docs" / "README.md")
    start = index.index(AUDIT_HEADING)
    block = index[start : index.index("\n## ", start + 1)]
    listed: set[str] = set()
    for line in block.splitlines():
        if not line.startswith("| ["):
            continue
        first_cell = line.split("|")[1]
        target = re.search(r"\[([A-Za-z0-9.\-]+\.md)\]", first_cell)
        if target:
            listed.add(target.group(1))

    assert not (lagging - listed), (
        "Diese Dokumente stehen auf einem älteren Stand, ohne in "
        f"docs/README.md gelistet zu sein: {sorted(lagging - listed)}"
    )
    assert not (listed & set(versioned) - lagging), (
        "Diese Dokumente sind als „nicht geprüft“ gelistet, tragen aber die "
        f"aktuelle Version: {sorted(listed & set(versioned) - lagging)}"
    )


def test_bewusst_offen_traegt_eine_statusmarke() -> None:
    """Regel 3: Ohne Marke ist eine offene Zeile ein Vergessen, kein Beschluss."""
    text = _read(LUECKEN)
    start = text.index("## Bewusst offen (Backlog mit Grund)")
    block = text[start : text.index("\n## ", start + 1)]
    rows = [line for line in block.splitlines() if line.startswith("| **")]
    assert rows, "Die Tabelle „Bewusst offen“ ist leer."
    for line in rows:
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        assert len(cells) >= 3, line[:160]
        assert cells[1] in MARKEN, (
            f"Statusmarke fehlt oder ist unbekannt: {line[:100]!r} "
            f"(erlaubt: {sorted(MARKEN)})"
        )
    for marke in MARKEN:
        assert f"| {marke} |" in block, (
            f"Die Erklärung der Marke „{marke}“ fehlt unter der Tabelle."
        )


def test_erledigte_luecken_stehen_nicht_mehr_als_offen() -> None:
    """Was seit 0.38.0 gebaut ist, darf nicht weiter als Lücke gelistet sein."""
    text = _read(LUECKEN)
    start = text.index("## Bewusst offen (Backlog mit Grund)")
    block = text[start : text.index("\n## ", start + 1)]
    rows = "\n".join(line for line in block.splitlines() if line.startswith("| **"))
    for erledigt in (
        "E2E ohne Mocks",
        "PWA/Service Worker",
        "Offline-Queue für Fill/Intent",
    ):
        assert erledigt not in rows, (
            f"„{erledigt}“ ist umgesetzt, steht aber noch als Zeile unter "
            "„Bewusst offen“."
        )
