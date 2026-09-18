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
| [GUI-FALLBACK-SANITY-2026-09-14.md](GUI-FALLBACK-SANITY-2026-09-14.md) | 14.09.2026 (App 0.37.1) | Sanity-Check nach echter NAS/Pi-Abnahme: UX/UI, Implementierung, Defaults, Fallback-Filter FRA/GT | Filterfix ist in `rp2/fallback_gui.py`; offene Produktpunkte stehen in [../LUECKEN.md](../LUECKEN.md) |
| [GUI-UX-BEFUND.md](GUI-UX-BEFUND.md) | 15.09.2026 (App 0.38.0) | Vermessung der gebauten GUI gegen UI-NEUENTWURF: Befunde U1–U8 (Typografie, Geräte-Raster, Routing, Erklär-Treppe, Designsystem, Lighthouse-Gate, Props-Drilling) | **Erledigt in 0.41.0** — Nachweise im [../../CHANGELOG.md](../../CHANGELOG.md) und in [../../TODO.md](../../TODO.md); einzig offen: C12 (zweispaltiger Desktop-Inhalt) |
| [REVIEW-NEUE-GUI-FALLBACK-2026-09-15.md](REVIEW-NEUE-GUI-FALLBACK-2026-09-15.md) | Prüfung 14.09.2026, vorgelegt 15.09.2026 (App 0.37.0) | Tiefenanalyse der neuen React-GUI und der Fallback-GUI v4.0 inklusive Server-/Engine-Koppelung: Befunde B1–B12, M1/M8, Defaults und die strukturelle Test-Lücke (Quelle: [PR #121](https://github.com/kollb/TankApp/pull/121)) | **Umgesetzt** — B1–B12/M1/M8 und der Demo-Stack in 0.37.2, E2E ohne Mocks in 0.38.0, die Reste (Kommentar, Doku-Abgrenzung) in 0.43.1; Befund-für-Befund-Nachweis in §9 des Dokuments, offene Produktpunkte in [../LUECKEN.md](../LUECKEN.md) |
| [OPTIMIERUNGS-BEFUND-2026-09-18.md](OPTIMIERUNGS-BEFUND-2026-09-18.md) | Sichtung 16.09.2026 (App 0.43.2), archiviert 18.09.2026 (App 0.54.0) | Sichtung der App gegen sich selbst, ohne Auftrag: 44 Befunde O1–O44 über Mathematik, UX, Technik/Betrieb, Kundensicht und zwölf weitere Dimensionen — je Befund Beleg mit Zeilenangabe, Wirkung, DoD und Batch-Zuordnung | **Vollständig abgearbeitet:** Batch 1–8 mit 0.44.0–0.54.0 umgesetzt oder als Dauerzustand benannt, Vermerk je Befund im Dokument; Nachweise im [../../CHANGELOG.md](../../CHANGELOG.md), Reste begründet in [../LUECKEN.md](../LUECKEN.md) |
| [BEFUND-12-UHR-REGEL-2026-09-18.md](BEFUND-12-UHR-REGEL-2026-09-18.md) | 17.–18.09.2026 (App 0.51.0) | Prüft, ob Preislogik und Anzeige noch stimmen, seit die 12-Uhr-Regel gilt: fünf Lagen aus Live-Export und Archiv-Kontrast, kein Modell | Schritt 3 ist mit 0.51.0 umgesetzt ([UMSETZUNG-B30-12-UHR-BODENKANTE-2026-09-18.md](UMSETZUNG-B30-12-UHR-BODENKANTE-2026-09-18.md)); die Bodenkante lebt in `app/law.py` und [../ENGINE.md](../ENGINE.md#12-uhr-regel-preiserhöhungen-nur-um-1200-uhr) |
| [TEXT-BEFUND-2026-09-15.md](TEXT-BEFUND-2026-09-15.md) | 15.09.2026 (App 0.38.0) | Lektorat aller Nutzertexte gegen MICROCOPY: Wochenlinie-Widerspruch, Feedback-Kanal, Tankmengen-Spannen, Tagebuch-Worte, Namens-Drift, Anglizismen, Pfade im Text — Befunde T1–T13 | **Erledigt in 0.39.0**; verbindlich für neue Texte ist [../MICROCOPY.md](../MICROCOPY.md) |

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
| [UMSETZUNG-GUI-NEUENTWURF-2026-09-14.md](UMSETZUNG-GUI-NEUENTWURF-2026-09-14.md) | 14.09.2026 (App 0.37.1) | Abgeschlossene Phasen-Checkliste des GUI-Neuentwurfs inkl. manueller Abnahme 7.2–7.5 und Abschluss 8.1/8.2 | Gültiges Zielbild: [../UI-NEUENTWURF.md](../UI-NEUENTWURF.md); Betrieb: [../BETRIEB.md](../BETRIEB.md); neue offene Punkte: [../LUECKEN.md](../LUECKEN.md) |
| [UMSETZUNG-B30-12-UHR-BODENKANTE-2026-09-18.md](UMSETZUNG-B30-12-UHR-BODENKANTE-2026-09-18.md) | 18.09.2026 (App 0.51.0) | Arbeits-Checkliste zur 12-Uhr-Bodenkante (B30): was gebaut wird, was bewusst nicht, Abnahme-Protokoll §7 | Umgesetzt in 0.51.0; der DoD-Backtest über beide Rechtslagen ist am 18.09.2026 als nicht nötig geschlossen ([../../TODO.md](../../TODO.md#geschlossen-als-nicht-nötig-18092026)) |
| [UMSETZUNG-FALLBACK-GUI-V2-2026-09-14.md](UMSETZUNG-FALLBACK-GUI-V2-2026-09-14.md) | 14.09.2026 (App 0.33.0) | Arbeits-Checkliste zur Fallback-GUI v2: series-Endpunkt, Template, Tests, Abnahme | Umgesetzt in 0.33.0; die Pi-Sichtprüfung (5.2) ist am 18.09.2026 als nicht nötig geschlossen. Gültig: [../RP2.md](../RP2.md) |

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
