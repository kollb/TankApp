# Archiv — historische Dokumente

Hier liegt, was **seine Aufgabe erfüllt hat**: Stichtags-Prüfberichte,
abgeschlossene Migrationen, alte Anleitungen und Punktstände. Die Inhalte sind
nicht aktuell und werden nicht mehr gepflegt — sie bleiben lesbar, weil Code,
Commits und Entscheidungen auf sie verweisen.

**Was heute gilt, steht in den lebenden Dokumenten:** [../README.md](../README.md)
(Index) · Einrichtung [../INSTALL.md](../INSTALL.md) · Betrieb
[../BETRIEB.md](../BETRIEB.md) · API [../API.md](../API.md) · Konzept ↔ Stand
[../LUECKEN.md](../LUECKEN.md) · Arbeitsliste [../../TODO.md](../../TODO.md) ·
Änderungen [../../CHANGELOG.md](../../CHANGELOG.md).

## Prüfberichte

| Dokument | Stand | Was es war | Wo die Punkte heute stehen |
|---|---|---|---|
| [PRUEFSTAND-2026-09-10.md](PRUEFSTAND-2026-09-10.md) | geprüft 10.09.2026 (Branch `arena/01a08cad`, Commit `378947a`) | Unabhängige Prüfung Konzept ↔ API ↔ Engine ↔ GUI ↔ Live-Daten; Fehler §3.1–3.8, Reihenfolge §7 | §3-Fixes sind umgesetzt (siehe [../LUECKEN.md](../LUECKEN.md), Update 11.09.2026); offene Punkte in [../../TODO.md](../../TODO.md) |
| [GUTACHTEN-2026-09-10.md](GUTACHTEN-2026-09-10.md) | 10.09.2026 | Gutachterliche Zweitmeinung zur statistischen Methodik (Befunde F1/F2/F5, Beta-Binomial, Regimewechsel, ACID-Persistenz) + Repos-Nachtrag zur Bewertung | Nicht übernommene Empfehlungen sind in [../LUECKEN.md](../LUECKEN.md) „Bewusst offen“ begründet |
| [TIEFENANALYSE-2026-09-11.md](TIEFENANALYSE-2026-09-11.md) | 11.09.2026 (Basis: Prüfstand + Live-Code-Review) | Abgleich Konzept §0–14, API, Engine, GUI; Fehler nach Wirkung | Quelle von [../../TODO.md](../../TODO.md) — erledigte Punkte stehen dort nicht mehr |
| [TIEFENANALYSE-V2-2026-09-11.md](TIEFENANALYSE-V2-2026-09-11.md) | 11.09.2026 | „Ist das Beschriebene auch *richtig* umgesetzt?“ + was unabhängig vom Konzept fehlt (Security, Betrieb, Drift, UX, Performance, CI) | Quelle von [../../TODO.md](../../TODO.md), Prüfstrang 2 (Abschnitte E–H) |
| [TIEFENANALYSE-V3-GUI-2026-09-11.md](TIEFENANALYSE-V3-GUI-2026-09-11.md) | 11.09.2026 | Grafische Inkonsistenzen und erfundene Defaults in Haupt- und Fallback-GUI | Alle V3-Fixes sind im Code; Absicherung durch `web/e2e/decision.spec.ts` |

> **Zitate im Code:** Kommentare in `app/` und `data-tools/` nennen
> „Prüfstand §3.1“, „§11.2“, „Konzept §5.5“ u. ä. als Herkunftsnachweis.
> „Prüfstand §x“ = [PRUEFSTAND-2026-09-10.md](PRUEFSTAND-2026-09-10.md) dieses
> Ordners, „Konzept §x“ = [../KONZEPT.md](../KONZEPT.md). Die Paragraphennummern
> wurden beim Archivieren bewusst nicht verändert.

## Abgeschlossene Verfahren

| Dokument | Stand | Was es war | Wo die Aussagen heute stehen |
|---|---|---|---|
| [STATIONS-UUID-MIGRATION.md](STATIONS-UUID-MIGRATION.md) | ca. 07.–09.09.2026 | Einmalige Migration von Namens-Serien auf `station_id`-UUID-Tags, inklusive JSONL-Prüfung und Zeitstempel-Replay | Migration ist durch; der Kurzweg für Legacy-Punkte ohne `station_id` steht in [../BETRIEB.md](../BETRIEB.md#legacy-punkte-ohne-station_id-namens-zwillinge) |

## Alte RP2-Dokumente

| Dokument | Stand | Was es war | Nachfolger |
|---|---|---|---|
| [RP2-ANLEITUNG-ALT.md](RP2-ANLEITUNG-ALT.md) | 09./10.09.2026 (RP2 v2.0/2.1) | Ausführliche Schritt-für-Schritt-Anleitung mit Emoji-Überschriften | [../RP2.md](../RP2.md) |
| [RP2-README-ALT.md](RP2-README-ALT.md) | 10.09.2026 (RP2 v2.1) | Kurzreferenz im `rp2/`-Ordner: Dateistruktur, Fallback-API, Template-Updates | [../RP2.md](../RP2.md) |
| [RP2-AENDERUNGEN-2026-09-08.md](RP2-AENDERUNGEN-2026-09-08.md) | 08.09.2026 (RP2 v1.0) | Änderungsbericht „F1/F3-Caching auf dem RP2“; die Einrichtungs-Schritte darin (NAS-IP per `sed` in Quelldateien, `pip` installieren) sind überholt | [../RP2.md](../RP2.md) (NAS-IP per systemd-Drop-in, keine Abhängigkeiten), [../../CHANGELOG.md](../../CHANGELOG.md) |
| [RP2-MOCKUP-VERGLEICH.md](RP2-MOCKUP-VERGLEICH.md) + [mockups/](mockups/richtige_gui.html) | undatiert, vor der `web/`-GUI | Statischer Vergleich „richtige GUI vs. Fallback-GUI“ mit drei HTML-Mockups; nennt noch Flask/Next.js und ist damit faktisch falsch | Live: `web/` (NAS-GUI) und `rp2/fallback_gui.py` (Fallback), beschrieben in [../RP2.md](../RP2.md); Design-Basis: [../GUI-VORLAGEN.md](../GUI-VORLAGEN.md) |

## Punktstände

| Dokument | Stand | Was es war | Hinweis |
|---|---|---|---|
| [POLLING-MERGED-2026-09-11.md](POLLING-MERGED-2026-09-11.md) / [.json](POLLING-MERGED-2026-09-11.json) | 11.09.2026 | Bericht + Ergebnis des gemergten Polling-Sets (Frankfurt + Gütersloh), erzeugt von `data-tools/run_pipeline.py` | Nur ein Schnappschuss: das **aktive** Set liegt gitignored in `docs/analysis/stations/polling.json`. Änderungen am Set laufen über [../STATIONEN-TAUSCH.md](../STATIONEN-TAUSCH.md) oder `tankapp.py add-city`. Die Koordinaten darin sind Stadt-Anker, keine privaten Heimkoordinaten. |

## Regeln

1. **Datum im Dateinamen** (`THEMA-JJJJ-MM-TT.md`), ASCII, kein Umlaut — damit
   klar ist, auf welchen Stand sich ein Befund bezieht.
2. **Eintrag in dieser Tabelle** mit Grund und Nachfolger. Ein Archiv-Dokument
   ohne Nachfolger-Hinweis ist eine Sackgasse.
3. **Banner oben in jeder Datei** wiederholt Stand und Nachfolger, damit niemand
   aus einem Suchtreffer heraus veraltete Schritte ausführt.
4. **Nichts wird umgeschrieben.** Befunde bleiben im Wortlaut der Prüfung;
   Korrekturen erfolgen in den lebenden Dokumenten.
5. **Gültige Betriebs-Aussagen werden vorher gerettet** — typischerweise nach
   [../BETRIEB.md](../BETRIEB.md), [../RP2.md](../RP2.md) oder
   [../ENGINE.md](../ENGINE.md).
