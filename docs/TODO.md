# TankApp To-Do — aus Gutachten, Prüfstand und Doku-Abgleich

> Stand: 10.09.2026. Dieses Blatt bündelt die Aufgaben, die aus dem
> [Gutachten](Gutachten.md), dem [Prüfstand](Prüfstand.md) und einem
> unabhängigen Abgleich von [KONZEPT.md](KONZEPT.md) gegen die übrige
> Dokumentation entstehen. [LUECKEN.md](LUECKEN.md) bleibt der
> Konzept-gegen-Code-Abgleich; hier stehen die *bearbeitbaren* Aufgaben
> inklusive Dokumenten-Korrekturen. Abgeschlossen ist ein Punkt erst, wenn
> der Haken hier gesetzt **und** die zugehörige Doku angepasst ist.

## Inhaltsverzeichnis

- [A. Doku-Korrekturen (erledigt am 10.09.2026)](#a-doku-korrekturen-erledigt-am-10092026)
- [B. Inkonsistenzen Gutachten ↔ Repo (bewertet)](#b-inkonsistenzen-gutachten--repo-bewertet)
- [C. Offene Code-Aufgaben aus dem Prüfstand](#c-offene-code-aufgaben-aus-dem-prüfstand)
- [D. Offene Konzept-Entscheidungen](#d-offene-konzept-entscheidungen)

---

## A. Doku-Korrekturen (erledigt am 10.09.2026)

In diesem Durchgang wurden folgende Widersprüche zwischen Konzeption und
Dokumentation beseitigt (reine Doku-/Textänderungen, kein Verhalten):

| # | Stelle | Fehler | Korrektur |
|---|---|---|---|
| A1 | `API.md` (Übersicht + „Auth & Limits") | `POST /api/v1/episodes` als Schreib-Endpunkt dokumentiert — existiert nicht (Server: 501). Richtig ist nur `POST /api/v1/episodes/{id}/intent` | Endpunkt in beiden Listen korrigiert |
| A2 | `KONZEPT.md` §11.1 Parametertabelle | `lat`/`lon` steht unverändert als „Pflicht" — die Implementierung wertet beide still aus (App arbeitet mit dem Polling-Set); LUECKEN kennt den Punkt, API.md schwieg | Zeile mit Offen-Vermerk versehen und auf LUECKEN/TODO verwiesen |
| A3 | `LUECKEN.md` Zeile §4.1–4.3 | „fertig (B4)" — die Wahrscheinlichkeitsseite ist **anders gebaut**: `p_besser` ist eine Ledger-Trefferquote (Laplace-geglättete Grundrate), nicht `P(min p(t) ≤ p_jetzt − θ)` aus der Prognoseverteilung; `p_lohnt` (F2) fehlt ganz; F3-Fenster haben keine P/Wahrscheinlichkeitsangabe (Prüfstand §1.4) | Auf „Regel/€-Seite fertig, P-Seite abweichend" gestellt |
| A4 | `LUECKEN.md` Zeile §3.1–3.2 | „fertig" — Hampel-Filter (ANALYSE.md Aufbereitung Schritt 3), gepoolter Feiertags-Dummy und Zeit-seit-Sprung-Feature sind **nicht** implementiert (Prüfstand §1.3) | Zeile aufgetrennt: fertig / offen |
| A5 | `ANALYSE.md` Aufbereitung | Hampel-Filter ohne Ziel-Markierung als Schritt 3 gelistet, obwohl nicht implementiert | Als „geplant, noch nicht implementiert" markiert |
| A6 | `LUECKEN.md` Zeile §2 | „fertig (B3.10)" ohne Hinweis, dass die GUI nach δ̂-Score sortiert, während Konzept §2/§8.2 Nr. 7 „Sortierung nach aktueller Empfehlungsstärke" verlangt (Prüfstand §1.2) | Abweichung in LUECKEN vermerkt, Code-Aufgabe C7 |
| A7 | `docs/README.md`, `README.md` | Gutachten.md und Prüfstand.md sind in keinem Dokumenten-Index verlinkt | Beide (plus dieses Blatt) in die Indizes aufgenommen |
| A8 | `Prüfstand.md` | Datei brach mitten in §3.3 ab; ein Pfad war falsch (`web/src/server.py` — gemeint ist `app/server.py:247`, verifiziert) | Vervollständigt und Pfad korrigiert |
| A9 | `Dashboard.tsx` (4 nutzer­­sichtbare Texte) | GUI-Texte verwiesen auf Konzept-Paragraphen statt eigenständig zu beschreiben: „Due-Prompt §5.4", „kalibrierten Tabelle §4.1", „Kalibrierung … (§5.1, §6)", Footer „B4: decide/…" | Alle vier Texte eigenständig formuliert (Details unten, Abschnitt Website-Texte) |

**Website-Texte im Einzelnen** (`web/src/Dashboard.tsx`) — Nutzer sehen keine
Konzept-Paragraphen mehr, sondern benannte, eigenständige Beschreibungen:

| Vorher | Nachher |
|---|---|
| „Rückmeldung nach Fensterende (Due-Prompt §5.4)" | „Rückmeldung nach Fensterende (Due-Prompt)" |
| „Die Produktion entscheidet weiterhin mit der kalibrierten Tabelle §4.1; …" | „Die Produktion entscheidet weiterhin mit der kalibrierten Entscheidungstabelle; …" |
| „Kalibrierung der Entscheidungs-Wahrscheinlichkeit (§5.1, §6)" | „Kalibrierung der Entscheidungs-Wahrscheinlichkeit" |
| Footer „… · B4: decide/episodes/fills/settlement/summary" | Footer „… · Entscheidungs-API: decide · episodes · fills · settlement · summary" |

Code-Kommentare (z. B. `// B4 Workshop State`, `/** Issue 50 … */`) bleiben
bewusst erhalten — sie richten sich an Entwickler, nicht an Nutzer.
`rp2/fallback_gui.py` und `web/index.html` sind bereits frei von
Konzept-Referenzen (geprüft).

---

## B. Inkonsistenzen Gutachten ↔ Repo (bewertet)

Das Gutachten wurde auf Basis der Docs erstellt und stellenweise ohne Code-Abgleich
formuliert. Die folgenden Punkte sind **bewertet**, nicht ungeprüft übernommen:

| # | Gutachten-Behauptung | Befund am Code | Bewertung / Aufgabe |
|---|---|---|---|
| B1 | **F2: „NAS-Job muss zwingend auf B ≥ 2000 konfiguriert werden"** (Befund B=200) | `engine/selection.py:32` `n_boot: int = 2000` — der NAS-Job rechnet **längst mit B=2000** (B3.10, dokumentiert in ANALYSE.md) | Empfehlung bereits umgesetzt; Gutachten wirkt hier veraltet. Keine Aufgabe |
| B2 | **F1: „Bug in der Prozentanzeige (Float 0,5 als % formatiert)"** | Im aktuellen Code nicht reproduzierbar: `Dashboard.tsx:1477` nutzt `Math.round(p.p_correct * 100)`, `app/feedback.py:794` `int(b['min_p'] * 100)` — überall korrekt ×100 | Behauptung ist **unbelegt**; vermutlich auf alten Stand bezogen. Beobten bei M7-Freigabe (siehe C8), kein separater Bug |
| B3 | Gutachten verweist auf „Kapitel 4.3" (668 ms Laufzeit) und „Kapitel 8" (Gutachterfragen) | Diese Kapitelnummern existieren in keinem Repo-Dokument | Referenzbruch im Gutachten; akzeptiert als historisches Arbeitspapier, keine Doc-Änderung |
| B4 | „Beta-Binomial-Posterior (M7-Gate), Prior Beta(5,5)" | Implementiert ist eine **Laplace-artige Glättung** `(hits + 10·0,5)/(n + 10)` (`app/feedback.py:156-178`), kein Beta-Binomial | Konzept beschreibt kein Beta-Binomial; Gutachten beschreibt etwas, das weder Konzept noch Code so enthalten. Bei Gelegenheit entscheiden: Beta-Binomial tatsächlich einführen (sauberer) oder Gutachten als Meinungsäußerung abheften → D3 |
| B5 | „Implementiere Strukturbruch-Test (CUSUM) bzw. EWMA/EW-Median auf δ̂" | Beides **bereits implementiert**: `delta_ew_ct` (HWZ 7 d), `break_flag`/`break_stat` (CUSUM, Schwelle h=2,0) in der Selektion (F5/B3.10, ANALYSE.md dokumentiert es) | Empfehlung bereits umgesetzt; Gutachten kennt den Stand nicht |
| B6 | „Asymmetrischer Pinball-Loss wäre zielführend" | Bereits Konzept §3.2 Kriterium 3 **und** `engine/backtest.py` (asym τ=0,75, 3× Strafe) | Bereits umgesetzt in Konzept und Code |
| B7 | „Feedback-Ledger transaktional in relationale DB (SQLite/PostgreSQL) — ACID" | Real: JSON-Store auf dem NAS (`app/feedback.py`), Konzept §9.1 sagt nur „NAS (Tabelle)". Das Gutachten legt eine Architektur-Änderung nahe, die nirgends dokumentiert ist | Echte Entscheidung offen → D1. Hängt mit Prüfstand §3.5 (10-MB-Silent-Reset, keine Retention) zusammen — dort zeigt sich der konkrete Schaden des JSON-Stores zuerst |
| B8 | „Event-getriebene Pipeline (Webhook) statt Polling empfehlen" | Bereits implementiert (Issue 50: `POST /api/v1/jobs/trigger`, Debounce + Idempotenz, dokumentiert in API.md/ARCHITEKTUR.md) | Empfehlung bereits umgesetzt |
| B9 | „Fallback-UI alternativ als PyQt6-Desktop-Widget" | Widerspricht dem dokumentierten RP2-Konzept (24/7-Browserzugang über Pi-Port 8000, RP2.md); RP2-Fallback zeigt bewusst „Preis-Score" statt Wahrscheinlichkeit | Empfehlung **nicht übernommen**, RP2-Konzept bleibt verbindlich. Festgehalten, damit die Empfehlung nicht verloren geht → D4 |
| B10 | „Strikte Trennung von Produktivcode und unabhängigem Test-Code (Doppelimplementierung)" | Tests spiegeln teils dieselben Formeln (`web/src/data.test.ts` vs. Server-Scores), eine echte Doppelimplementierung existiert nicht flächig | Lob ohne belastbare Grundlage; keine Aufgabe |

**Fazit B:** Das Gutachten ist als fachliche Zweitmeinung nützlich; seine beiden
„harten Fehler" (F1/F2) treffen auf den aktuellen Code nicht zu (B1/B2). Seine
offenen Architektur-Empfehlungen (B7, B9) sind Entscheidungen, keine Fehler —
sie stehen in Abschnitt D.

## C. Offene Code-Aufgaben aus dem Prüfstand

Reihenfolge und Bewertung aus [Prüfstand §7](Prüfstand.md) übernommen;
Priorität P1 vor P2 vor P3. Details, Code-Stellen und Live-Nachweise dort.

- [ ] **C1 (P1) Fill-Schreibpfad validieren** — `price_paid`-Default 1,70 €/L entfernen; stattdessen Nowcast/Poll der Station (Konzept §11.2), sonst `400 price_not_available`; Bereichsprüfungen liters/price/fuel/station; Fehler als 4xx statt `200 {"error_code": …}` (Prüfstand §3.1)
- [ ] **C2 (P1) Episode-Schluss an `compliance` koppeln** — `unrelated`-Fills dürfen die offene Folge nicht schließen (Prüfstand §3.2)
- [ ] **C3 (P1) GUI-Rate-Limit-Betriebsmechanik** — Poll-Bündelung/Key für die eigene GUI, `Retry-After` taggerecht, Bucket-Eviction (Prüfstand §3.3)
- [ ] **C4 (P1) `no prices`-Alarm auf Kalendertage umstellen** — zählt heute Polls (7 × 5 min = 35 min statt 7 Tage, Konzept §1.2, Prüfstand §3.4)
- [ ] **C5 (P2) Feedback-Store: Retention statt Silent-Reset** — `store_too_large`-Fehler statt stiller Leerung ab 10 MB; Rotation; Snapshot-Schreibdrossel (Prüfstand §3.5, hängt mit B7/D1 zusammen)
- [ ] **C6 (P2) `brier_30d`/`last_30d_*` wirklich auf 30 Tage schneiden** — heute Allzeit-Zahlen unter 30-Tage-Namen (Prüfstand §3.6); dazu Gate-Konsistenz `n` vs. `n_brier`
- [ ] **C7 (P2) „Meine Stationen" nach Empfehlungsstärke sortieren** — Konzept §2/§8.2 Nr. 7 verlangt F2-Netto-Sortierung mit δ̂ nur im Detail; heute Score-Sortierung mit δ̂-Spalte (Prüfstand §1.2) — oder Konzeptstelle bewusst auf Werkstatt-Ansicht umschreiben → D2
- [ ] **C8 (P2) Konzept-P-Seite bauen** — `p_besser`/`p_lohnt` aus der (gemeinsamen) Bootstrap-Verteilung statt Ledger-Grundrate; dafür Bootstrap-Pfade veröffentlichen oder Draw-Auswertung in den Worker; F3 je Fenster P(±6-h-Umfeld); Rolling-PICP-Gate vor §4.1/§4.2 (Prüfstand §1.4, §4 — „das einzige echte M5-M6-Projekt")
- [ ] **C9 (P2) `trip_mode`/`latest_by` in den Snapshot-Store schreiben** — Felder gehen in `record_snapshot` verloren (Prüfstand §3.7)
- [ ] **C10 (P2) NAS-Backtest auf 21 Tage** — `app/refresh.py:244` fährt nur 7 Tage; das 21-Tage-Kriterium (Engine §3.2/§3.4) ist aus dem automatisierten Lauf nie erfüllbar
- [ ] **C11 (P3) Kleinigkeiten** — preflight-Stationszähler zählt JSON-Schlüssel; `Cache-Control: no-store` auch auf gehashten Assets (`app/server.py:247`); 501-Antwort als JSON statt HTML; Frankfurt-Hardcode-Fallbacks (`app/decide.py:475`, `app/feedback.py:580`); `POST /v1/episodes`-Doku↔501 war A1, Rest siehe Prüfstand §3.8
- [ ] **C12 (P2) CI für M4-Hartkriterien** — Lighthouse > 90 und „≤ 3 primäre Zahlen" sind Fertig-Kriterien ohne Mess-Job; ebenso fehlen e2e-Tests für `decide`/`fills`/`intent`/Due-Prompt (Prüfstand §6)

## D. Offene Konzept-Entscheidungen

- [ ] **D1 Persistenz des Feedback-Ledgers** — JSON-Store (Status quo) vs. relationale DB (Gutachten B7). Entscheidung nötig **vor** C5, weil Retention/Rotation davon abhängt. Konzept §9.1 („NAS (Tabelle)") ist bewusst offen formuliert.
- [ ] **D2 „Meine Stationen"-Sortierung** — Konzept anpassen (Werkstatt = Analyse-Werkzeug, Score-Sortierung ok) oder C7 umsetzen. Nur eine der beiden Seiten darf stehen bleiben.
- [ ] **D3 P-Schätzer im Ledger** — Laplace-Glättung (Code) vs. Beta-Binomial (Gutachten B4). Beide sind priorsauber; der Wechsel wäre billig, aber M7-konform zu dokumentieren (§0.4).
- [ ] **D4 RP2-Fallback-Strategie** — Browser-Fallback (Status quo, RP2.md) vs. PyQt6-Desktop-Widget (Gutachten B9). Status quo bleibt, bis jemand das Widget baut; Empfehlung hierarchisch archiviert.
- [ ] **D5 OpenAPI-Spezifikation** — Konzept §13 M5 nennt „OpenAPI + Tests grün" als Fertig-Kriterium; im Repo existiert nur die handgeschriebene API.md. Entweder OpenAPI aus `app/server.py` erzeugen oder Kriterium auf „API.md + Tests" umformulieren.
- [ ] **D6 Kampagnen-Quote auf dem NAS** — 6/2/2-Quotierung (Konzept §2) existiert nur in der Offline-Pipeline; der NAS-Job rankt global Top-10 je Kraftstoff (Prüfstand §1.2). Konzeptstelle oder Job anpassen, sobald mehr als eine Kampagnenstadt live geht.
