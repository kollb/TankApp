# MICROCOPY — Regelwerk für alle Texte in der App

> Stand: 05.10.2026 · App-Version **0.74.0** · gilt für `web/src/**`,
> `web/rp2/**`, `rp2/fallback_gui.py`, Fehlertexte in `app/**` und die
> Push-Texte in `app/notify.py`. Neu mit 0.74.0 (UX-NEUENTWURF Batch 2):
> das Labor hat drei Blöcke, Rohdaten und CSV wohnen in „System“, Stationen
> und Ich sind verdichtet. **Entfallen:** Sub-Tabs, Spielplatz, Experimente,
> Tankprofil-Rechner, Einflüsse-Balken, Güte-Panel, eingebettetes Glossar,
> Heatmap-Schalter, Fachjargon im Alltag.

## Inhaltsverzeichnis

- [1. Tonfall](#1-tonfall)
- [2. Anführungszeichen und Sonderzeichen](#2-anführungszeichen-und-sonderzeichen)
- [3. Zahlen, Einheiten, Zeiten](#3-zahlen-einheiten-zeiten)
- [4. Benennungen](#4-benennungen)
- [5. Zustände: leer, lädt, Fehler](#5-zustände-leer-lädt-fehler)
- [6. Was nie im Text steht](#6-was-nie-im-text-steht)
- [7. Prüfung](#7-prüfung)

## 1. Tonfall

**Ehrlich, knapp, handlungsleitend** — in dieser Reihenfolge.

| Regel | Ja | Nein |
|---|---|---|
| Handlung zuerst | „Jetzt tanken — 4 ct unter Tagesmedian.“ | „Der Tagesmedian liegt über dem Preis, daher …“ |
| Keine Sicherheit behaupten, die nicht gemessen ist | „Noch nicht gemessen — die ersten Empfehlungen sind Lern-Fälle.“ | „82 % sicher“ |
| Kein Tadel an den Nutzer | „Getankte Liter außerhalb 5–100 L.“ | „Ungültige Eingabe!“ |
| Deutsch als Label, Fachwort im Tooltip | „Günstig-Chance“, `title="Fachwort: Cheap-Probability"` | „Cheap-Probability“ sichtbar |
| Zustände benennen, nicht bewerten | „Noch kein Lauf“ | „Leider noch nichts da“ |
| Possessiv erlaubt, Anrede und Imperativ nicht | „Beleg in deiner Bilanz verbucht.“ | „Du hast deinen Beleg gespeichert.“ |

„Sie“/„Du“ als Anrede, `du`/`dir`/`dich` und Höflichkeitsformen stehen in
keinem Nutzertext; Possessiv („deine Bilanz“) ist die etablierte Form.
Fragen stehen nur, wo die App auf ein Ereignis antwortet („Gerade getankt?“
im Fällig-Prompt); Imperative werden Aussagen über die Sache.
**Fehler sind keine Erfolge:** `ok` (grün, Häkchen, `role="status"`), `warn`
(amber, „lokal vorgemerkt“), `error` (rose, Warnzeichen, `role="alert"`);
Einschübe mit `—`; Baustein `components/FeedbackBanner.tsx`.

## 2. Anführungszeichen und Sonderzeichen

Jedes Zitat ist `„…“`; `'…'` und `"…"` stehen nie im Nutzertext (nur Code-
und JSX-Syntax). `—` Einschub · `–` Bereiche („18–20 Uhr“) · `·` Trenner ·
`…` Auslassung · `×` Malzeichen · `≤ ≥ ≈ ±` mit Sinn. Kein Zeichen als
Textersatz: `✓ ✗ ✎ ✕ ★ ▼ ●` stehen nie im Text — das **Wort** trägt die
Aussage („richtig“, „daneben“, „Jetzt tanken“), Icons bleiben dekorativ
(`aria-hidden`); kein Ausrufezeichen, kein Emoji. Typografie steht als
UTF-8 im Quelltext, nie als HTML-Entity.

## 3. Zahlen, Einheiten, Zeiten

Formatiert wird **ausschließlich** über `web/src/data.ts`; `toFixed` in
Anzeigen ist verboten (`format-convention.test.ts`).

| Größe | Funktion | Darstellung |
|---|---|---|
| Preis je Liter (Niveau) | `euroPerLiter` | `1,749 €/L` |
| Preisunterschied | `centPerLiter` | `4,2 ct/L` |
| Geldbetrag · Prozent | `euro` · `percentLabel` | `62,45 €` · `93 %` |
| Strecke · Tempo | `kilometersLabel` · `kilometersPerHour` | `2,4 km` · `50 km/h` |
| Rückblick · Blick voraus | `timeSpanLabel` · `+N Tage` | `3 Tage` · `+7 Tage` |
| Zeitwert · Maßzahl · Stückzahl | `euroPerHour` · `deNumber` · `countLabel` | `16 €/h` · `0,80` · `12.345` |
| Zeitpunkt · Stundenbereich | `timeLabel` · `hourRangeLabel` | `12.09., 08:00` · `18–20 Uhr` |

**Niveau in €/L, Unterschied in ct/L** — gemischt nur, wenn beides sichtbar
ist, das Niveau zuerst („1,749 €/L · 4,2 ct/L unter Tagesmedian“).
**Zwei Spannen:** *Tankmenge* 10–100 L (Profil/„Jetzt“), *getankte Liter*
5–100 L im Beleg, Schritt 0,5 — beide mit `L`, nie „Liter“ neben einer Zahl.
Dezimaltrennzeichen Komma, Tausenderpunkt; Eingabefelder akzeptieren beides,
zeigen Komma. Alle Zeiten sind Europe/Berlin über `timeLabel`/`epochLabel`;
eine erfundene 12-Uhr-Projektion eines Belegs ohne Zeitstempel wird benannt:
`1 Beleg ohne Zeitstempel zählt als 12 Uhr.`

## 4. Benennungen

| Gemeint | Wort in der App |
|---|---|
| Bereiche | **Jetzt** · **Stationen** · **Woche** · **Ich** · **Labor** · **System** |
| Tankstelle · Tankvorgang | **Station** · **Beleg** (nicht „Fill“, „Buchung“, „Füllung“) |
| Rechengröße · gebuchte Menge | **Tankmenge** (10–100 L) · **Liter** (5–100 L) |
| Preis-Vorteil | **Ersparnis**, Betrag ohne Vorzeichen: „1,60 € günstiger“ |
| δ̂ · Regret · Orakel | **Preis-Abstand** · **Mehrkosten zum perfekten Timing** · **Perfektes Timing (Orakel)** |
| Heatmap-Modus · Tageszeit | **Günstig-Chance** (Fachwort nur im Tooltip) · **Stoßzeit**/**Nebenzeit** |
| Systemfarbe · Engine-Zahlen | **Alles ok** · **Hinweise** · **Störungen** · **Kennzahlen der Engine** · **Backtest** |
| Prognoselauf · Preisdaten · Fenster | **Modell-Update** · **Collector** · **Fenster** |
| Ampel-Aussage · Alter · Glossar | **Empfehlung** · `ageLabel` „vor 12 Minuten“ · **Glossar** |

Fachbegriffe (δ̂, MASE, PICP, Brier, ε, Regret) stehen nur in „Details für
Neugierige“ und im Tooltip hinter einem deutschen Label; der Alltag kommt
ohne sie aus. Der Tankstand wird nur in „Ich“ → Fahrzeug gepflegt.

### 4a. Fallback-GUI: feste Muster

Diese Sätze stehen so in `rp2/fallback_gui.py` — wiederverwenden, nicht neu formulieren: `Aktueller Preisvergleich` · `Nur Preisvergleich — Tank- und Warteentscheidungen benötigen die geprüfte NAS-Entscheidung und das persönliche Profil.` · `Noch kein frischer Preis.` · Kraftstoffzeile `<KRAFTSTOFF> · <ORT> · STAND <HH:MM> UHR` · Delta-Chip `beste`/`+<x> ct` · Lesemodus-Badge `Lesemodus · RP2` · `NAS ist gerade nicht erreichbar — die Preise zeigen den letzten gemeldeten Stand. Zur Orientierung, nicht zur Entscheidung.` · Frische-Fußzeile `Preise <4 min> alt · Prognose <35 min> alt` (Alter `—` statt „gerade eben“, wenn ein Stand fehlt).

### 4b. Bereich „Jetzt“: feste Muster

Genau fünf Chips, immer gleich benannt: `Jetzt tanken` (grün; rot, wenn der Tankrest das Warten blockiert) · `Warten` (blau, Überschrift `Warten bis ~18 Uhr`) · `Kaum Unterschied` (grau, `Tanken, wann’s passt`) · `Preisvergleich` (grau, `Günstigste gerade: <Station>`) · `Offline` (grau, `Letzter Stand: <Station>` + `Der Preis an der Säule zählt.`). Die Überschrift trägt höchstens 25 Wörter, die Karte genau **eine** Zahl in Euro (`spart ca. <1,60> €`, sonst `1,709 €/L`) und genau **eine** Handlung (`Route`); „Warum?“ erklärt in höchstens fünf Zeilen. Sicherheit ist **ein Wort** (`sehr sicher` · `ziemlich sicher` · `kaum einschätzbar`), nie eine Prozentzahl. Gültigkeit: `bis <17:45>`, in den letzten 30 Minuten `· noch <12> min`; eine abgelaufene Freigabe fällt auf die graue Tatsachenvariante. „Woche“ trägt höchstens drei Einträge (`<Tag> <Zeit>` · `<1,709> €/L` · `spart ca. <1,60> €` · Sicherheit als Wort) und **einen** Satz zur Prognosebreite (`Ab Tag 5 wird die Prognose unsicher.`).

### 4c. Bereich „Labor“: feste Muster

Drei Blöcke, sonst nichts; die Fragen stehen genau einmal in `lab.ts` (`LAB_BLOCKS`), die Tagebuch-Sprache in derselben Datei (`diaryActionWord`, `diaryOutcome`, `voidReasonWord`). Block 1 **„Kann ich vertrauen?“** trägt **einen** Satz als Zählung, kein Prozent: `An <26> von <30> Tagen lag die Empfehlung richtig.` Ohne Messung: `Noch nicht gemessen — die ersten Empfehlungen sind Lern-Fälle.` Darunter das filterbare Tagebuch (`Alle · Richtig · Daneben · Unentschieden · Nicht bewertbar`) mit den Worten `Warten` · `Jetzt tanken` · `Woanders tanken` · `Keine klare Empfehlung` (nie „Treffer“, nie „Fehler“). Block 2 **„Wie gut ist die Prognose?“** zeigt eine Kurve und **einen** Satz: `Im Schnitt <1,8> ct/L daneben.` Block 3 **„Wie rechnet die App?“** nennt drei Schritte in Alltagssprache (Tagesmuster der Stadt · aktuelle Lage · 12-Uhr-Regel); Formeln, acht Bausteine, Fachwerte und die Heatmap liegen gebündelt hinter `Details für Neugierige`. Rohdaten, CSV und API-Explorer stehen in „System“; das Labor verweist nur dorthin.

### 4d. Bereich „System“: feste Muster

Hier dürfen Datei- und Endpunktnamen stehen (`TECH_TEXT_ALLOWED` in `microcopy.test.ts`): Herkunft `Quelle: /api/v1/…`, Winter-Hinweis zur 12-Uhr-Regel, `Alles ok` · `Hinweise` · `Störungen` im Kopf. Rohdaten- und CSV-Blöcke nennen **was** exportiert wird und **woher** es kommt, nie nur „Export“.

## 5. Zustände: leer, lädt, Fehler

- **Lädt:** `… wird geladen` / `Läuft …` — nie ein leerer Rahmen ohne Text.
- **Leer:** den Grund nennen (`Noch kein Lauf`, `Kein Eintrag in dieser Auswahl`), nie eine Null-Verschönerung.
- **Fehler:** `LoadError` mit Code und „Erneut versuchen“; ein Fehler ist keine Erfolgsmeldung (Ton-Trias aus §1).
- **Ein Zustand, eine Zahl:** dieselbe Größe steht einmal auf der Fläche; Fehlendes steht als `—` mit Grund, nie als erfundene Zahl. **„Set“** ist Betriebssprache und steht nicht im Alltagstext.

## 6. Was nie im Text steht

Ausgemusterte Wörter (Ratchet `microcopy.test.ts`): Draw-Potenzial, Medianbetrag, Fensterminima, Anker, `blocking_reasons`, `decision_ready`, M7-Gate, Brier, PICP, MASE, CUSUM, PIT, „brutto/netto“ in Alltagskarten, „Szenarioprognose“, „Episode“, „Snapshot“, „Settlement“, „Ledger“, „Orakel“ außer als „Perfektes Timing (Orakel)“. Keine internen Pfade außer in „System“, keine Abkürzung ohne Erklärung, kein Englisch als Label.

## 7. Prüfung

`web/src/microcopy.test.ts` prüft paarige `„…“`, verbotene Entities, ausgemusterte Wörter, Tagebuch-Ergebnisworte (nie „Treffer“/„Fehler“), fehlende Ausrufezeichen und die Zeitwert-Automatik; `web/src/format-convention.test.ts` prüft die Zahlenformatter; `web/src/guide.test.ts` prüft die Übersetzungstabelle Technik → Alltag in den Guide-Quellen. Wer eine Formulierung braucht, findet sie hier — oder ergänzt sie hier zuerst.
