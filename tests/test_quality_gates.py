"""D4: Die Qualitäts-Gates müssen messen, was sie versprechen.

Ratchet für die Infrastruktur aus ``.github/workflows/quality.yml``:
Lighthouse-Budgets liegen in einer Datei, die Workflow verdrahtet den
Demo-Stack (nicht „irgendeinen“ Server), und der Demo-Stack selbst liefert
eine echte Publikation — sonst misst das Gate eine leere App und ist
beruhigend statt aussagekräftig (Prüfstand §1: keine grünen Haken ohne
Grundlage).
"""

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "data-tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

WORKFLOW = ROOT / ".github/workflows/quality.yml"
LHCI = ROOT / "web/lighthouserc.json"


def _lhci() -> dict:
    return json.loads(LHCI.read_text(encoding="utf-8"))


def test_lighthouse_budgets_sind_hinterlegt():
    config = _lhci()
    assertions = config["ci"]["assert"]["assertions"]
    # Harte Gates: Rückfälle in Barrierefreiheit/Best-Practices/SEO stoppen
    # den PR. Performance bleibt warnend, solange keine Messung vorliegt
    # (docs/QUALITAET.md, Abschnitt „Offen“).
    for key in ("categories:accessibility", "categories:best-practices"):
        level, options = assertions[key]
        assert level == "error", key
        assert options["minScore"] >= 0.9, key
    level, options = assertions["categories:seo"]
    assert level == "error" and options["minScore"] >= 0.8
    level, options = assertions["categories:performance"]
    assert level == "warn" and options["minScore"] >= 0.8
    # Ohne den Demo-Stack misst Lighthouse leere Panels. Der Server läuft
    # bewusst **außerhalb** von LHCI (Workflow-Schritt mit Bereitschafts-
    # schleife): LHCI wartet sonst zu kurz und bricht ohne Bericht ab.
    collect = config["ci"]["collect"]
    assert "startServerCommand" not in collect
    assert len(collect["url"]) >= 2
    assert all("127.0.0.1:1355" in url for url in collect["url"])
    # Chrome braucht im Container --no-sandbox.
    assert "--no-sandbox" in collect["settings"]["chromeFlags"]

    text = WORKFLOW.read_text(encoding="utf-8")
    assert "ops/quality/demo_server.py" in text
    # Bereitschaft nachweisbar prüfen, nicht auf gut Glück warten.
    assert "/api/v1/health" in text


def test_quality_workflow_nutzt_demo_stack_und_lastpfad():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "ops/quality/demo_server.py" in text
    assert "web/load/overview.mjs" in text
    assert "@lhci/cli" in text
    # Kein Upload in fremde Speicher (LAN-App, keine Messdaten nach draußen).
    assert "temporary-public-storage" not in text


def test_demo_stack_liefert_publikation_und_frische_preise(tmp_path):
    sys.path.insert(0, str(ROOT / "ops/quality"))
    try:
        import demo_data
    finally:
        sys.path.remove(str(ROOT / "ops/quality"))

    built = demo_data.build(tmp_path, days=45)

    from polling_plan import validate_sets

    payload = json.loads((tmp_path / "setup/polling.json").read_text(encoding="utf-8"))
    # Ungültige UUIDs wären „polling_invalid“ — das GUI bliebe leer.
    assert len(validate_sets(payload)) == 1

    publication = json.loads(
        (tmp_path / "runtime/engine/current.json").read_text(encoding="utf-8")
    )
    forecasts = publication["forecasts"]
    assert len(forecasts) == len(demo_data.STATIONS)
    for row in forecasts:
        # Entscheidungs-Layer braucht Draws: ohne sie sind p_besser/p_lohnt
        # null und der Lastpfad misst den billigsten Code-Pfad.
        assert row["draws_24h"]["n"] > 0
        assert len(row["draws_24h"]["nowcast"]) == row["draws_24h"]["n"]
        assert row["points"] and row["points_7d"]
    assert len(built["prices"]) == len(demo_data.STATIONS)
    assert all(1.0 < price < 3.0 for price in built["prices"].values())


def test_query_trennt_stationsabruf_und_zeitfenster(tmp_path):
    sys.path.insert(0, str(ROOT / "ops/quality"))
    try:
        import demo_data
    finally:
        sys.path.remove(str(ROOT / "ops/quality"))

    built = demo_data.build(tmp_path, days=45)
    query = demo_data.make_query(built["observations"], built["prices"])

    latest = query(None, "  |> tail(n: 1)\n")
    assert len(latest) == len(demo_data.STATIONS)
    assert all("e10" in row for row in latest)

    window = query(None, "start: -24h")
    assert window, "Zeitfenster-Abfrage liefert keine Punkte (Tageskurve leer)"
    assert {row["station_id"] for row in window} == set(built["prices"])


def test_lastpfad_skript_bennt_seine_budgets():
    script = (ROOT / "web/load/overview.mjs").read_text(encoding="utf-8")
    # Die Budgets stehen im Skript und sind per Umgebung überschreibbar — ein
    # Last-Gate ohne sichtbare Grenze ist kein Gate.
    for name in ("TANKAPP_LOAD_P95_MS", "TANKAPP_LOAD_P99_MS", "TANKAPP_LOAD_304_MIN"):
        assert name in script
    # Ohne Revalidierung misst der Pfad nicht den Betriebsfall (B7: ETag/304).
    assert "If-None-Match" in script
    assert "process.exit(1)" in script
