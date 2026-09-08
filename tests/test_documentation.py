"""Keep the central entrypoint and remaining references free of dead local links."""

import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pytest

ROOT = Path(__file__).resolve().parents[1]
DOCUMENTS = [
    ROOT / "README.md",
    *sorted((ROOT / "docs").glob("*.md")),
    ROOT / "data-tools/README.md",
    ROOT / "engine/README.md",
    ROOT / "sample/README.md",
]


@pytest.mark.parametrize(
    "document", DOCUMENTS, ids=lambda path: str(path.relative_to(ROOT))
)
def test_local_documentation_links_exist(document):
    text = document.read_text(encoding="utf-8")
    for destination in re.findall(r"\[[^\]\n]+\]\(([^\s)]+)\)", text):
        url = urlsplit(destination)
        if url.scheme or url.netloc:
            continue  # Offline test: do not contact external sites.
        target = document.parent / unquote(url.path) if url.path else document
        assert target.exists(), f"{document.name}: broken link {destination}"
        if url.fragment and target.suffix == ".md":
            headings = re.findall(
                r"^#{1,6}\s+(.+)$", target.read_text(encoding="utf-8"), re.MULTILINE
            )
            anchors = {
                re.sub(r"[^\w\s-]", "", heading.lower()).replace(" ", "-")
                for heading in headings
            }
            assert unquote(url.fragment) in anchors, (
                f"{document.name}: missing heading {destination}"
            )
