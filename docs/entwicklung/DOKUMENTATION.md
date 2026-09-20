# Dokumentationspflege und Aufräumprotokoll

> Stand: 20.09.2026 · App-Version 0.59.1 · Redaktionelle Änderung, kein Release.

## Inhaltsverzeichnis

- [Struktur](#struktur)
- [Konsolidierte Zieldokumente](#konsolidierte-zieldokumente)
- [Archiv und Löschkandidaten](#archiv-und-löschkandidaten)
- [Pflegeregeln](#pflegeregeln)
- [Prüfergebnis](#prüfergebnis)
- [Change-Log des Aufräumens](#change-log-des-aufräumens)

## Struktur

```text
README.md                 Projekteinstieg
CONTRIBUTING.md            Entwicklungsumgebung und Prüfsequenz
AGENTS.md                 Agenten-Arbeitsregeln (technisch im Root erforderlich)
docs/
├── README.md              einziger Gesamtindex
├── betrieb/               INSTALL, BETRIEB, RP2, SPEICHER, STATIONEN-TAUSCH
├── referenz/              API, ANALYSE, ENGINE, DATENWERKZEUGE
├── architektur/           ARCHITEKTUR
├── produkt/               KONZEPT, UI, MICROCOPY, GUI-VORLAGEN
├── planung/               TODO, LUECKEN, REGIME
├── adr/                   kurze Entscheidungsakten und ihr Index
├── entwicklung/           QUALITAET, PRUEFSTAENDE, DOKUMENTATION
├── releases/              CHANGELOG
└── archiv/                datierte Prüfberichte, Migrationen und Altanleitungen
```

`TODO.md` und `CHANGELOG.md` sind aus dem Root verschoben.
`UI-NEUENTWURF.md` heißt jetzt `produkt/UI.md`, weil es den aktuellen Aufbau
beschreibt, keinen offenen Komplett-Neuentwurf.

Die ausführbare App (`tankapp.py`), Paket-/Testkonfiguration
(`pyproject.toml`, `requirements-dev.txt`), `.gitignore`, `.dockerignore` und
Code-/Deployment-Ordner bleiben funktionsbedingt an ihrem Ort. Ein pauschales
Verschieben nach `docs/` würde den Build oder Betriebsbefehle beschädigen.
`.docx`-Dateien sind im Checkout nicht vorhanden; es wurde keine Code-Lizenz
erfunden oder ergänzt.

## Konsolidierte Zieldokumente

Die vollständigen neuen Inhalte stehen direkt in den Zieldateien:

| Datei | Verbleibender Inhalt |
|---|---|
| [Root-README](../../README.md) | Einstieg, Rollen, aktueller Stand und Datenhinweise |
| [Doku-Index](../README.md) | Ein Navigationsverzeichnis statt Release-Erzählung und zweiter API-Kurzreferenz |
| [Konzept](../produkt/KONZEPT.md) | Aktuelle Produktregeln und klare Trennung von Prognose, Advice und Wallet |
| [UI](../produkt/UI.md) | Implementierte 3+1-Navigation und Anzeigeprinzipien statt alter Migrationsphasen |
| [Projektstand](../planung/LUECKEN.md) | Implementiert, offen, ausstehende Datenabnahme, bewusste Grenze |
| [TODO](../planung/TODO.md) | Nur notwendige, jetzt ausführbare Schritte mit konkreter Abnahme |
| [Regime-Plan](../planung/REGIME.md) | Aktuelle Planung, protokollierte Juli-Messung und Grenzen der Simulation |
| [ADRs](../adr/README.md) | Speicher-/Backup-, Umfangs- und Modellentscheidungen |

RP2 verliert die eingebettete v1–v4-Chronik; Speicher verliert die Liste
abgeschlossener Codeänderungen. Die fachlichen Anleitungen bleiben erhalten.
Microcopy erhält eine logische Abschnittsreihenfolge ohne Release-Anhängsel.
Die Engine-Referenz nennt den gültigen Modell-Default ohne widersprüchlichen
Vorher-/Nachher-Absatz.

**Grenze der Aufräumaktion:** API, Betrieb, Analyse und die übrigen technischen
Referenzen sind nicht vollständig neu fachlich abgenommen. Ihre Prüfstände
bleiben in [PRUEFSTAENDE](PRUEFSTAENDE.md) sichtbar. Deren weiterhin relevante
Parameter, Befehle und Payload-Schemas wurden nicht pauschal gekürzt. Eine
Schema-Version oder Befund-ID wie „B2“ ist kein automatisch löschbarer
Entwurfsrest.

## Archiv und Löschkandidaten

Neu archiviert:

- [BEFUND-UX-MATH-2026-09-19.md](../archiv/BEFUND-UX-MATH-2026-09-19.md):
  Stichtagsbericht mit umfangreichen Messbelegen. Gültige Aussagen und offene
  Arbeit sind nach UI, Regime-Plan, Projektstand und TODO extrahiert.
- [ANALYSE-B0-B1-B2-2026-09-19.md](../archiv/ANALYSE-B0-B1-B2-2026-09-19.md):
  Review eines bestimmten Code-Stands; unentschiedene Vorschläge bleiben im TODO.

Das vorhandene Archiv wird nicht nochmals in lebende Dokumente kopiert.
Prüfberichte mit „V2/V3“ im Dateinamen sind Nachweise verschiedener Prüfungen,
nicht allein deshalb identische Duplikate. Ihre Messbelege bleiben erhalten.
Ein Hashvergleich hat keine bytegleichen Markdown-Duplikate ergeben.
Auch `sample/good gui` und `sample/good statistic gui` bleiben unverändert.

**Optionale Löschkandidaten, in dieser Änderung nicht gelöscht:**
`RP2-ANLEITUNG-ALT.md`, `RP2-README-ALT.md`, `RP2-MOCKUP-VERGLEICH.md` und die
zugehörigen alten Archiv-Mockups. Nachfolger ist die aktuelle RP2-Anleitung.
Vor dem Löschen Herkunftsverweise entfernen oder auf einen Git-Commit pinnen;
keine stillen Löschungen verlinkter Belege. Die Release-Historie bleibt als
gezielte historische Dokumentation erhalten, nicht als Betriebsanleitung.

## Pflegeregeln

1. Eine Aufgabe hat ein maßgebliches Dokument. Index und README verlinken,
   statt Befehle, Parameter oder Release-Texte mehrfach zu kopieren.
2. Aktuelle Regeln ohne Iterationschronik schreiben. Aufgaben in TODO,
   Implementierungsgrenzen in LUECKEN, Entscheidungen in ADRs. TODO enthält
   ausschließlich notwendige, jetzt ausführbare Handlungen, keine optionalen
   Reviews, Wartezustände oder unbestätigten Szenario-Fristen.
3. Neue Version bedeutet nicht automatisch neue fachliche Abnahme aller
   Dokumente. Stand-Zeilen wahrheitsgemäß pflegen, Rückstände im Prüfindex nennen.
4. Historische Berichte mit Stand, Status und Nachfolger archivieren. Links
   dürfen repariert werden; Messwerte werden nicht auf den heutigen Stand
   „umgeschrieben“.
5. Umbenennungen umfassen Markdown-Links **und** CLI-Hilfen, Fehlermeldungen,
   Code-Kommentare, Tests, Web und Betriebsdateien. Links und Anker testen.
6. Fachliche Dokumente nicht wieder im Root ansammeln. Binäre Originale bei
   Bedarf in den fachlich passenden `docs/`-Ordner, nicht neben den Einstieg.

## Prüfergebnis

Lokal am 20.09.2026, Python 3.11 und Node 22:

| Prüfung | Ergebnis |
|---|---|
| Ruff Check / Format | Grün |
| Python-Gesamtsuite | 1.238 bestanden |
| Doku-/Betriebs- und Drift-Tests | 83 bestanden (Teil der Python-Suite) |
| Web-Unit-Tests | 1.233 bestanden |
| Web-Build | Grün |
| Browser mit Mocks | 38 bestanden |
| Browser gegen Demo-Stack | 45 bestanden, 14 übersprungen, **1 fehlgeschlagen** |

Der Fehler betrifft einen bereits bestehenden Textüberlauf der Labor-Regime-
Karte bei 320 px. Gegenprobe auf unverändertem Ausgangscommit `b1e60df`
reproduziert denselben Test und dieselben Breiten. Kein durch die
Dokumentationsverschiebung entstandener Fehler; offene Arbeit in
[TODO B5](../planung/TODO.md#b5-labor-überlauf-beheben).

Der normale Playwright-Browserdownload war nicht erreichbar. Verwendet wurde
Chromium 153 aus `@sparticuz/chromium` mit lokal bereitgestellten Laufzeitlibs,
ohne Änderung der Projektabhängigkeiten. Keine Hardware-/NAS-Live-Abnahme.
Der vorhandene Fehler bleibt ausdrücklich offen. Auf Wunsch des Betreibers
wird die Dokumentationsänderung trotzdem als PR zur Prüfung vorgelegt; die
rote Demo-Prüfung wird dort benannt, nicht als bestanden dargestellt.

## Change-Log des Aufräumens

- Release-Erzählungen, alte Konzept-/UI-Iterationen und Erledigt-Tabellen aus
  den lebenden Einstiegs-, Konzept-, Status- und Planungsdokumenten entfernt;
  Release-Historie und originale Messberichte bleiben an ihren gezielten Orten.
- Widersprüche zu Navigation, Modell-Default, Kalibrierung und offenen Aufgaben
  bereinigt; Entscheidungen aus Fließtext in drei ADRs ausgelagert, offene
  Regime-Voraussetzungen in der Fachplanung erhalten. TODO auf zwei unmittelbar
  notwendige Schritte beschränkt; optionale Reviews bleiben nur im Originalbericht.
- Fachliche Root-Dateien und den flachen Doku-Ordner thematisch einsortiert;
  lokale Links, Anker und Codeverweise nachgezogen und Doku-Tests an die neue
  Struktur angepasst. Kein Anwendungsalgorithmus geändert.
