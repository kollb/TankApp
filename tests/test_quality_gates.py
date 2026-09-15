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
    # U7: drei echte Zustände — der gefüllte Einstieg und der Labor-Bereich
    # gegen den Demo-Stack (Port 1355), der Einrichtungszustand gegen den
    # leeren Server (Port 1356). Mehr als diese beiden Hosts darf es nicht
    # geben, sonst misst das Gate einen anderen Server als den Prüfstand.
    assert len(collect["url"]) >= 3
    assert all(
        "127.0.0.1:1355" in url or "127.0.0.1:1356" in url
        for url in collect["url"]
    )
    assert sum("127.0.0.1:1356" in url for url in collect["url"]) == 1
    assert any("tab=labor" in url for url in collect["url"])
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


def test_query_honoriert_stationsfilter_des_flux_texts(tmp_path):
    """„Heute im Blick“: ``LiveData.series`` filtert im Flux-Text nach
    Station und prüft die Identität Zeile für Zeile. Der Demo-Stack muss
    denselben Filter honorieren — sonst bricht ``series()`` mit
    „Wrong identity“ und die Tageskurve ist im Demo immer leer."""
    sys.path.insert(0, str(ROOT / "ops/quality"))
    try:
        import demo_data
    finally:
        sys.path.remove(str(ROOT / "ops/quality"))

    built = demo_data.build(tmp_path, days=45)
    query = demo_data.make_query(built["observations"], built["prices"])
    uid = demo_data.STATIONS[0][0]

    flux_text = (
        'from(bucket: "tankapp")\n'
        '  |> range(start: time(v: "2026-09-14T10:00:00+00:00"), '
        'stop: time(v: "2026-09-15T10:00:00+00:00"))\n'
        '  |> filter(fn: (r) => r._measurement == "prices")\n'
        "  |> filter(fn: (r) => contains(value: r.city, set: ["
        f'"{demo_data.CITY}"]))\n'
        f'  |> filter(fn: (r) => contains(value: r.station_id, set: ["{uid}"]))\n'
    )
    rows = query(None, flux_text)
    assert rows, "Station-Abfrage liefert keine Punkte"
    assert {row["station_id"] for row in rows} == {uid}, (
        "Demo-Query ignoriert den Stations-Filter aus dem Flux-Text"
    )


def test_e2e_demo_suite_ist_keine_mock_suite():
    """Die unmocked E2E-Suite bleibt unmocked und bleibt verdrahtet.

    LUECKEN „Bewusst offen“: Die Alltagssuite mockt jeden API-Pfad und bewies
    deshalb nur Rendering — B1/B3/der defekte Demo-Stack fielen erst im
    Sanity-Check auf. Diese Zusage ist ein Ratchet: eigene Konfiguration
    gegen den Demo-Stack, kein ``page.route`` in der Spec, eigener CI-Schritt
    und ein Skript, das beides startet.
    """
    spec = (ROOT / "web/e2e/demo.spec.ts").read_text(encoding="utf-8")
    # Nur der Aufruf zählt — der Kommentar *nennt* ``page.route`` als das, was
    # hier bewusst fehlt.
    assert "page.route(" not in spec, "die unmocked Suite darf keine Routen mocken"
    assert "/api/v1/overview" in spec
    assert "Heute im Blick" in spec, "die Zusage aus LUECKEN fehlt (overview → Zellen)"
    assert "Europe/Berlin" in spec, "Ortszeit-Prüfung fehlt (B3-Klasse)"

    config = (ROOT / "web/playwright.demo.config.ts").read_text(encoding="utf-8")
    assert "ops/quality/demo_server.py" in config
    assert "1357" in config, "eigener Port — sonst kollidiert sie mit der Alltagssuite"
    assert "--rebuild" in config, "stale Demo-Daten würden die Zellen leeren"

    base = (ROOT / "web/playwright.config.ts").read_text(encoding="utf-8")
    assert "demo.spec.ts" in base and "testIgnore" in base, (
        "die Alltagssuite (Port 1355, ohne Demo-Daten) darf die Spec nicht mitziehen"
    )

    package = json.loads((ROOT / "web/package.json").read_text(encoding="utf-8"))
    assert package["scripts"]["test:e2e:demo"].endswith("playwright.demo.config.ts")

    workflow = (ROOT / ".github/workflows/tests.yml").read_text(encoding="utf-8")
    assert "test:e2e:demo" in workflow, "die Suite läuft nicht im CI"
    # Der Demo-Stack braucht die Engine-Abhängigkeiten (echter Fit).
    assert "requirements-dev.txt" in workflow


def test_lastpfad_skript_bennt_seine_budgets():
    script = (ROOT / "web/load/overview.mjs").read_text(encoding="utf-8")
    # Die Budgets stehen im Skript und sind per Umgebung überschreibbar — ein
    # Last-Gate ohne sichtbare Grenze ist kein Gate.
    for name in ("TANKAPP_LOAD_P95_MS", "TANKAPP_LOAD_P99_MS", "TANKAPP_LOAD_304_MIN"):
        assert name in script
    # Ohne Revalidierung misst der Pfad nicht den Betriebsfall (B7: ETag/304).
    assert "If-None-Match" in script
    assert "process.exit(1)" in script
