"""C7: Glossar-Tabelle (web/src/data.ts) gegen docs/ANALYSE.md — Konsistenz (0.32.0).

Der Hilfe-Tab („Was heißt das?“) verweist je Begriff auf einen Doku-Anker
(``docs/ANALYSE.md#…``). Diese Verweise standen zeitweise auf Abschnitte,
die es nicht gab — der Link-Test in test_operations.py prüft nur Markdown,
keine TS-Strings. Diese Suite schließt die Lücke: jeder Glossar-Eintrag
braucht id/term/de/short/long plus einen Anker, der in ANALYSE.md existiert
(derselbe Slugger wie der Doku-Link-Test).
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_TS = ROOT / "web" / "src" / "data.ts"
ANALYSE = ROOT / "docs" / "ANALYSE.md"


def _glossary_entries():
    """Liest die GLOSSARY-Tabelle aus data.ts (stabile, flache Struktur)."""
    text = DATA_TS.read_text(encoding="utf-8")
    block = text.split("export const GLOSSARY", 1)[1].split("] as const;", 1)[0]
    entries = []
    for chunk in re.split(r"\n\s*\{\n", block):
        fields = dict(re.findall(r'(\w+): "((?:[^"\\]|\\.)*)",?', chunk))
        if "id" in fields:
            entries.append(fields)
    return entries


def _analyse_anchors():
    headings = re.findall(
        r"^#{1,6}\s+(.+)$", ANALYSE.read_text(encoding="utf-8"), re.MULTILINE
    )
    return {
        re.sub(r"[^\w\s-]", "", heading.lower()).replace(" ", "-")
        for heading in headings
    }


def test_glossary_covers_the_lab_terms():
    entries = _glossary_entries()
    by_id = {entry["id"]: entry for entry in entries}
    # Eindeutige IDs, kein Eintrag doppelt:
    assert len(by_id) == len(entries) and len(entries) >= 10
    # Die C7-Pflichtbegriffe aus TODO.md:
    for term_id in ("delta", "mase", "picp", "brier", "eps", "regret"):
        assert term_id in by_id, f"Glossar ohne {term_id}"
    for entry in entries:
        for field in ("term", "de", "short", "long", "anchor"):
            assert entry.get(field), f"{entry['id']}: {field} fehlt"


def test_glossary_anchors_exist_in_analyse():
    anchors = _analyse_anchors()
    for entry in _glossary_entries():
        assert entry["anchor"] in anchors, (
            f"Glossar {entry['id']}: docs/ANALYSE.md#{entry['anchor']} fehlt"
        )


def test_glossary_terms_match_the_documentation_words():
    """Fachwort und deutsche Zeile stehen auch in der Doku (kein Drift)."""
    doc = ANALYSE.read_text(encoding="utf-8").lower()
    for entry in _glossary_entries():
        assert entry["de"].lower() in doc, (
            f"{entry['id']}: de-Zeile {entry['de']!r} nicht in ANALYSE.md"
        )
