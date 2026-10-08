"""test.py — Demo und Smoke-Test für die semantische Kontextdatenbank.

Baut eine Beispiel-Datenbank mit BSI-Grundschutz-Bausteinen (strukturiert wie
im Kompendium: Layer -> Baustein -> Anforderungen mit MUSS/SOLLTE/KANN) und
internen Confluence-Maßnahmen auf. Gezeigt wird:

    * semantische Suche über Themenfelder hinweg:
        "Verschlüsselung"        -> findet "Kryptografie" / "Chiffrierung"
        "Wir setzen TLS 1.2 ein" -> findet "CON.1 Kryptokonzept"
    * BSI-Struktur-Erkennung: Baustein, Layer, Anforderungs-ID, Priorität
    * Metadaten-Filter: Suche auf ein Themenfeld einschränken
    * Persistenz (save/load)

Alles lokal: keine Cloud, kein Modell-Download. Die Embeddings werden aus
dem Beispielkorpus selbst gelernt (TF-IDF + SVD).

Aufruf: python test.py
Exit-Code 0 = alle Erwartungen erfüllt.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from context import BSI_LAYERS, ContextDB, chunk_text

# Beispiel-Dokumente im Stil des BSI-Grundschutz-Kompendiums, über viele
# Themenfelder (Layer) verteilt, plus interne Confluence-Maßnahmen.
EXAMPLE_DOCS: dict[str, str] = {
    "BSI_CON_1_Kryptokonzept.pdf": """
CON.1 Kryptokonzept

1 Einleitung
Ein Kryptokonzept beschreibt, wie kryptografische Verfahren im Unternehmen
eingesetzt werden. Es regelt die Auswahl geeigneter Chiffren, die
Schlüssellängen und das gesamte Schlüsselmanagement.

2 Anforderungen

CON.1.A1 MUSS: Kryptokonzept erstellen und pflegen
Es MUSS ein Kryptokonzept erstellt und regelmäßig an den Stand der Technik
angepasst werden. Das Kryptokonzept dokumentiert alle eingesetzten
kryptografischen Verfahren.

CON.1.A2 MUSS: Verschlüsselung gespeicherter Daten
Die Vertraulichkeit gespeicherter Daten MUSS durch geeignete
Verschlüsselung sichergestellt werden. Zertifikate nach anerkannten
Standards (z.B. BSI TR-03116) sind zu bevorzugen.

CON.1.A3 SOLLTE: Transportverschlüsselung
Für die Übertragung von Daten über öffentliche Netze SOLLTE eine
Transportverschlüsselung nach dem Stand der Technik eingesetzt werden.
Veraltete Verfahren sind abzulösen.
""",
    "BSI_ORP_4_Identitaetsmanagement.pdf": """
ORP.4 Identitäts- und Berechtigungsmanagement

1 Einleitung
Jede Person erhält eine eindeutige Kennung (Identität). Die Vergabe von
Rechten folgt dem Need-to-know-Prinzip.

2 Anforderungen

ORP.4.A1 MUSS: Eindeutige Identitäten
Jeder Person MUSS eine eindeutige Kennung zugewiesen werden.
Berechtigungen folgen dem Need-to-know-Prinzip und sind regelmäßig zu
rezertifizieren.

ORP.4.A2 MUSS: Sichere Authentisierung
Authentisierungsverfahren MÜSSEN dem Schutzbedarf angemessen sein.
Passwörter sind regelmäßig zu wechseln und dürfen nicht wiederverwendet
werden.

ORP.4.A3 SOLLTE: Mehr-Faktor-Authentisierung
Für administrative Zugänge SOLLTE eine Mehr-Faktor-Authentisierung
eingerichtet werden. Bei Verdacht auf Kompromittierung ist das Kennwort
sofort zu sperren.
""",
    "BSI_NET_3_Firewall.pdf": """
NET.3 Firewall und Netztrennung

2 Anforderungen

NET.3.A1 MUSS: Firewall-Regelwerk
Eine Firewall MUSS den Datenverkehr zwischen Netzen kontrollieren.
Paketfilter erlauben nur explizit freigegebene Verbindungen
(Default-Deny).

NET.3.A2 SOLLTE: Netzsegmentierung
Netze SOLLTEN nach Schutzbedarf segmentiert werden (z.B. DMZ, interne
Server, Client-Netze). Firewall-Regeln sind zu dokumentieren und zu
auditieren.
""",
    "BSI_OPS_1_Betrieb.pdf": """
OPS.1.1 Betrieb und Datensicherung

2 Anforderungen

OPS.1.A1 MUSS: Datensicherung (Backup)
Datensicherungen MÜSSEN automatisiert durchgeführt, verschlüsselt abgelegt
und deren Wiederherstellbarkeit getestet werden. Backups sind räumlich
getrennt vom Produktivsystem aufzubewahren.

OPS.1.A2 SOLLTE: Patch-Management
Systeme SOLLTEN regelmäßig gepatcht und auf dem aktuellen Stand der
Technik gehalten werden.
""",
    "BSI_SYS_1_Server.pdf": """
SYS.1 Allgemeiner Server

2 Anforderungen

SYS.1.A1 MUSS: Härtung von Servern
Server MÜSSEN nach dem Prinzip der minimalen Rechte konfiguriert werden.
Nicht benötigte Dienste und Ports sind zu deaktivieren (Hardening).

SYS.1.A2 MUSS: Verschlüsselter administrativer Zugriff
Der Zugriff auf Server MUSS ausschließlich verschlüsselt erfolgen
(z.B. SSH, RDP mit TLS). Administrativer Zugang ist auf dedizierte
Systeme beschränkt.
""",
    "BSI_APP_2_Webanwendungen.pdf": """
APP.2 Webanwendungen

2 Anforderungen

APP.2.A1 MUSS: Absicherung gegen OWASP Top 10
Webanwendungen MÜSSEN gegen die OWASP Top 10 abgesichert werden.
Eingaben sind serverseitig zu validieren. Sitzungen (Sessions) sind
kryptografisch abzusichern.

APP.2.A2 MUSS: HTTPS mit aktuellen TLS-Versionen
Für die Auslieferung von Webseiten MUSS HTTPS mit aktuellen TLS-Versionen
verwendet werden. Veraltete Protokolle und Cipher Suites sind zu
deaktivieren.
""",
    "BSI_DER_1_Detektion.pdf": """
DER.1 Detektion von Sicherheitsvorfällen

2 Anforderungen

DER.1.A1 MUSS: Überwachung und Protokollierung
Systeme MÜSSEN überwacht und Änderungen protokolliert werden (Audit-Log).
Protokolle sind vor Manipulation zu schützen und regelmäßig auszuwerten
(Monitoring).

DER.1.A2 MUSS: Meldung von Sicherheitsvorfällen
Sicherheitsvorfälle MÜSSEN unverzüglich gemeldet und dokumentiert
werden. Es ist ein Meldeweg einzurichten, der auch anonyme Meldungen
ermöglicht.
""",
    "BSI_INF_1_Gebaeude.pdf": """
INF.1 Allgemeines Gebäude

2 Anforderungen

INF.1.A1 MUSS: Zutrittskontrolle
Der Zutritt zu Gebäuden und Räumen mit IT-Systemen MUSS kontrolliert
werden. Zutrittsberechtigungen sind zu dokumentieren und regelmäßig zu
überprüfen.
""",
    "BSI_ISMS_1_Sicherheitsmanagement.pdf": """
ISMS.1 Sicherheitsmanagement

2 Anforderungen

ISMS.1.A1 MUSS: Sicherheitsleitlinie
Es MUSS eine Sicherheitsleitlinie erstellt werden, die die Schutzziele
und den Geltungsbereich des Informationssicherheits-Managements
definiert. Die Leitlinie ist von der Leitung zu verabschieden.
""",
    # Interne Confluence-Einträge — jede Maßnahme eine eigene Quelle
    "Confluence_TLS_Webseiten.docx": """
Maßnahme: TLS für externe Webseiten

Wir setzen TLS 1.2 für alle externen Webseiten ein. Zertifikate werden
jährlich erneuert. Ältere TLS-Versionen sind deaktiviert.
""",
    "Confluence_Backup_Datenbanken.docx": """
Maßnahme: Datensicherung

Alle Datenbanken werden nächtlich verschlüsselt gesichert (Backup). Die
Wiederherstellung wird quartalsweise getestet.
""",
    "Confluence_Passwort_vergessen.docx": """
Prozess: Kennwort zurücksetzen

Mitarbeiter melden vergessene Zugangsdaten dem Helpdesk. Das Kennwort
wird zurückgesetzt und eine Mehr-Faktor-Authentisierung eingerichtet.
""",
    "Confluence_SSH_Server.docx": """
Maßnahme: SSH statt Passwort-Login

Für den administrativen Zugriff auf Server setzen wir SSH mit
Schlüsselpaaren ein. Passwort-Logins sind deaktiviert.
""",
}

# (Query, erwartete Quelle im Top-5, Beschreibung)
TEST_QUERIES = [
    (
        "Verschlüsselung von Kundendaten auf dem Server",
        "BSI_CON_1_Kryptokonzept.pdf",
        "Synonym-Suche: 'Verschlüsselung' -> Kryptografie/Chiffre",
    ),
    (
        "Wir setzen TLS 1.2 für die Webseite ein",
        "BSI_CON_1_Kryptokonzept.pdf",
        "Abstrakte Maßnahme -> BSI-Baustein CON.1 Kryptokonzept",
    ),
    (
        "Mitarbeiter hat sein Passwort vergessen",
        "BSI_ORP_4_Identitaetsmanagement.pdf",
        "Alltagssprache -> ORP.4 Identitätsmanagement",
    ),
    (
        "Firewall Regeln für den Serverraum konfigurieren",
        "BSI_NET_3_Firewall.pdf",
        "Thematische Suche -> NET.3 Firewall",
    ),
    (
        "nächtliches verschlüsseltes Backup der Datenbank",
        "BSI_OPS_1_Betrieb.pdf",
        "Kombination aus zwei Themen -> OPS.1 Betrieb",
    ),
]


def _bar(score: float, width: int = 30) -> str:
    filled = int(score * width)
    return "█" * filled + "░" * (width - filled)


def main() -> int:
    print("=" * 72)
    print("ContextDB — Semantische Suche Demo")
    print("Lokal: TF-IDF + SVD, keine Cloud, kein Modell-Download")
    print("=" * 72)

    failures = 0

    with tempfile.TemporaryDirectory(prefix="contextdb_test_") as tmp:
        db = ContextDB(persist_dir=Path(tmp) / "db")

        # 1. Beispiel-Dokumente einlesen und chunken
        print(f"\n--- Baue Datenbank aus {len(EXAMPLE_DOCS)} Dokumenten ---")
        total = 0
        for source, text in EXAMPLE_DOCS.items():
            chunks = chunk_text(text, source=source)
            db.add_chunks(chunks)
            total += len(chunks)
            print(f"  {source}: {len(chunks)} Chunks")
        print(f"\nGesamt: {total} Chunks, Dimensionen: {db.embedder.n_dims}")

        # 2. BSI-Struktur-Erkennung zeigen
        print("\n--- Erkannte BSI-Struktur (Metadaten pro Chunk) ---")
        shown = 0
        for c in db.chunks:
            if c.requirement_id and shown < 6:
                print(
                    f"  {c.requirement_id:12s} [{c.priority:7s}] "
                    f"layer={c.layer:5s} section={c.section[:45]}"
                )
                shown += 1

        # 3. Metadaten-Konsistenz prüfen
        print("\n--- Metadaten-Konsistenz ---")
        bsi_chunks = [c for c in db.chunks if c.source.startswith("BSI_")]
        bad_layer = [
            c
            for c in bsi_chunks
            if c.layer
            and (c.layer not in BSI_LAYERS or c.layer != c.baustein.split(".")[0])
        ]
        req_chunks = [c for c in db.chunks if c.requirement_id]
        bad_prio = [
            c for c in req_chunks if c.priority not in {"MUSS", "SOLLTE", "KANN"}
        ]
        a2 = next((c for c in db.chunks if c.requirement_id == "CON.1.A2"), None)
        if bad_layer:
            print(f"  ❌ Layer-Mismatch bei {len(bad_layer)} Chunks")
            failures += 1
        else:
            print(f"  ✅ Layer konsistent bei {len(bsi_chunks)} BSI-Chunks")
        if bad_prio:
            print(f"  ❌ Priorität fehlt bei {len(bad_prio)} Anforderungs-Chunks")
            failures += 1
        else:
            print(
                f"  ✅ Priorität (MUSS/SOLLTE/KANN) bei {len(req_chunks)} Anforderungen erkannt"
            )
        if a2 is not None and a2.priority == "MUSS" and a2.baustein == "CON.1":
            print("  ✅ CON.1.A2: baustein=CON.1, priority=MUSS")
        else:
            print("  ❌ CON.1.A2 Metadaten falsch")
            failures += 1

        # 4. Persistenz testen (save -> neue Instanz -> load)
        db.save()
        db2 = ContextDB(persist_dir=Path(tmp) / "db")
        assert db2.load(), "Persistenz: load() fehlgeschlagen"
        assert len(db2.chunks) == total, "Persistenz: Chunk-Anzahl stimmt nicht"
        assert db2.chunks[0].to_dict() == db.chunks[0].to_dict(), (
            "Persistenz: Metadaten verloren"
        )
        print("\nPersistenz-Test (save/load inkl. Metadaten): OK")

        # 5. Semantische Suchen
        print("\n" + "=" * 72)
        print("Semantische Suchen")
        print("=" * 72)
        for query, expected_source, description in TEST_QUERIES:
            print(f'\n🔍 Query: "{query}"')
            print(f"   {description}")
            expanded = db.embedder.expand_query(query)
            if expanded != query:
                print(f'   ⤷ erweitert: "{expanded}"')
            results = db.search(query, top_k=5)
            for r in results:
                meta = f"{r['baustein'] or '-':8s} {r['requirement_id'] or '-'}"
                print(
                    f"   [{_bar(r['score'])}] {r['score']:.4f}  {meta}  {r['source']}"
                )
                preview = r["text"][:80].replace("\n", " ")
                print(f"      → {preview}...")

            top_sources = [r["source"] for r in results]
            if expected_source in top_sources:
                rank = top_sources.index(expected_source) + 1
                print(f"   ✅ Erwartet: {expected_source} (Rang {rank})")
            else:
                print(f"   ❌ Erwartet: {expected_source} — nicht in Top-5!")
                failures += 1

        # 6. Metadaten-Filter
        print("\n" + "=" * 72)
        print("Metadaten-Filter")
        print("=" * 72)
        filtered = db.search("Verschlüsselung", top_k=5, filter={"layer": "CON"})
        ok = filtered and all(r["layer"] == "CON" for r in filtered)
        print("\n🔍 filter={'layer': 'CON'}: \"Verschlüsselung\"")
        for r in filtered:
            print(
                f"   [{_bar(r['score'])}] {r['score']:.4f}  {r['baustein']}  {r['source']}"
            )
        print(f"   {'✅' if ok else '❌'} alle Treffer im Layer CON")
        failures += 0 if ok else 1

        filtered = db.search("Sicherheitsvorfälle", top_k=3, filter={"layer": "DER"})
        ok = filtered and all(r["layer"] == "DER" for r in filtered)
        print("\n🔍 filter={'layer': 'DER'}: \"Sicherheitsvorfälle\"")
        for r in filtered:
            print(
                f"   [{_bar(r['score'])}] {r['score']:.4f}  {r['baustein']}  {r['source']}"
            )
        print(f"   {'✅' if ok else '❌'} alle Treffer im Layer DER")
        failures += 0 if ok else 1

        # 7. Synonym-Nachweis: 'Chiffrierung' als Flexion, die im Korpus
        #    als 'Chiffren' steht
        print("\n" + "=" * 72)
        print("Synonym-Nachweis: 'Chiffrierung' -> 'Chiffren' (CON.1.A1)")
        print("=" * 72)
        results = db.search("moderne Chiffrierung und Algorithmen", top_k=3)
        for r in results:
            print(
                f"   [{_bar(r['score'])}] {r['score']:.4f}  {r['baustein']}  {r['source']}"
            )
            preview = r["text"][:80].replace("\n", " ")
            print(f"      → {preview}...")
        ok = results and results[0]["source"] == "BSI_CON_1_Kryptokonzept.pdf"
        print(f"   {'✅' if ok else '❌'} Rang 1 = CON.1 Kryptokonzept")
        failures += 0 if ok else 1

        # 8. Statistik
        stats = db.stats()
        print("\n" + "=" * 72)
        print("Statistik")
        print("=" * 72)
        print(f"  Chunks:      {stats['chunks']}")
        print(f"  Dimensionen: {stats['dims']}")
        print(f"  Quellen:     {len(stats['sources'])}")
        print(f"  Layer:       {', '.join(stats['layers'])}")
        print(f"  Bausteine:   {', '.join(stats['bausteine'])}")
        print(f"  Prioritäten: {', '.join(stats['priorities'])}")

        print("\n" + "=" * 72)
        if failures:
            print(f"ERGEBNIS: {failures} Erwartungen verfehlt.")
            return 1
        print("ERGEBNIS: Alle Erwartungen erfüllt. ✅")
        return 0


if __name__ == "__main__":
    sys.exit(main())
