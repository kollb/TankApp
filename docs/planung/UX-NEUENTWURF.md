# UX-Neuentwurf: Jetzt, Woche, Labor

> Stand: 05.10.2026 · Status: **Batch 1 abgenommen (0.73.0), Batch 2
> beauftragt und in Umsetzung.** · Anlass:
> Nutzer-Feedback „Ich finde nie die Informationen, die ich brauche.
> Die Texte überwältigen oder sind unintuitiv.“
> Betrifft: `web/src/views/Jetzt.tsx`, `web/src/views/Woche.tsx`,
> `web/src/views/Labor.tsx` + `labor/*`, `now.ts`, `week.ts`, `guide.ts`.
> Kein Code in diesem Dokument — erst lesen, dann entscheiden, dann bauen.
> Umsetzung in zwei Batches (§9, §10); betroffene Bestands-Doks in §11.

## Inhaltsverzeichnis

- [1. Befund: warum die drei Bereiche überfordern](#1-befund-warum-die-drei-bereiche-überfordern)
- [2. Leitprinzipien des Neuentwurfs](#2-leitprinzipien-des-neuentwurfs)
- [3. Jetzt neu: eine Frage, eine Antwort](#3-jetzt-neu-eine-frage-eine-antwort)
- [4. Woche neu: Ranking statt Raster](#4-woche-neu-ranking-statt-raster)
- [5. Labor neu: drei Fragen statt Sammelakte](#5-labor-neu-drei-fragen-statt-sammelakte)
- [6. Übergreifend: Vokabel-Diät und Zahlen-Diät](#6-übergreifend-vokabel-diät-und-zahlen-diät)
- [7. Streichliste: was wohin wandert](#7-streichliste-was-wohin-wandert)
- [8. Ehrlichkeit ohne Jargon](#8-ehrlichkeit-ohne-jargon)
- [9. Batch 1: Alltag entlasten (Jetzt und Woche neu)](#9-batch-1-alltag-entlasten-jetzt-und-woche-neu)
- [10. Batch 2: Vertrauen neu (Labor und Doku)](#10-batch-2-vertrauen-neu-labor-und-doku)
- [11. Dok-Anpassungsanalyse: was sich ändern muss](#11-dok-anpassungsanalyse-was-sich-ändern-muss)
- [12. Offene Fragen](#12-offene-fragen)

## 1. Befund: warum die drei Bereiche überfordern

Drei Kernprobleme, belegt am aktuellen Stand:

**1. Zu viele Fragen pro Bildschirm.** „Jetzt“ beantwortet nicht eine,
sondern rund zehn Fragen auf einmal: Rückmeldung nach Fensterende,
Prognose-Status, Empfehlung, Was-wäre-wenn-Annahmen, Feedback-Intents,
drei Fakten, Tankstand-Schnellauswahl, nächste Schritte, Tagesverlauf
mit 19 Zellen plus Stundenbalken, Warte-Vorteil als Betrag, Datenalter.
Jeder Block ist für sich begründet — zusammen liest niemand mehr,
wo die Antwort steht.

**2. Fachsprache statt Alltagssprache.** Auf den drei Schirmen stehen
nebeneinander: Draw-Potenzial, Medianbetrag, Fensterminima, Anker,
Referenz, brutto/netto, blocking_reasons, decision_ready, M7-Gate,
PIT-kalibriert, Szenarioprognose, Sterne, Prozent, Balken, δ̂, Brier,
PICP, MASE (zwei Sorten), CUSUM, q-Wert, Regime-Kante, Orakel, Ledger,
Snapshot, Episode. Das 550-Zeilen-Regelwerk `MICROCOPY.md` ist selbst
Symptom: Jeder Sonderfall bekam einen eigenen Satz, statt die
Oberfläche so zu vereinfachen, dass der Sonderfall verschwindet.

**3. Dieselbe Information an mehreren Orten, in mehreren Formen.**
Dasselbe Wochenfenster erscheint als Rasterkachel, als Detailkarte, als
Listen­eintrag und als Balken der Wochenlinie. Sicherheit erscheint als
Prozent, als Wort, als Sterne und als Balken — gleichzeitig. Der
Tankstand wird in „Jetzt“ und „Woche“ gepflegt. Das Datenalter steht als
Fußzeile unter jedem Bereich. Wer sucht, findet vier Halbwahrheiten
statt einer Antwort.

Hinzu kommen einzelne unintuitive Stellen: Die Wochenlinie zeichnet
höhere Balken für billigere Tage (gegen jede Lesegewohnheit). Das Labor
will gleichzeitig Kinderbuch (drei Sätze, Selbst-Check) und Dissertation
(Formeln, q-Werte, CUSUM-Schwellen) sein — und befriedigt weder die
schnelle noch die tiefe Frage.

## 2. Leitprinzipien des Neuentwurfs

1. **Ein Bildschirm, eine Frage, eine Antwort in einer Sekunde.**
   Jetzt = „Tanken?“, Woche = „Wann?“, Labor = „Stimmt das?“.
2. **Drei Ebenen, strikt getrennt.** Ebene 1: Antwort (max. ~25 Wörter,
   eine Leit-Zahl, eine Handlung). Ebene 2: Details (genau ein Tipp
   entfernt, „Warum?“). Ebene 3: Beweis (Labor bzw. System).
   Nichts aus Ebene 2 oder 3 steht auf Ebene 1.
3. **Eine Zahl pro Karte.** Die Leit-Zahl ist immer Euro. Cent je Liter
   nur als Zusatz in Details. Prozent, Sterne und Balken nie gleichzeitig.
4. **Vokabel-Diät.** Rund ein Dutzend Begriffe für den Alltag, der Rest
   wandert ins Glossar, ins System oder in die Doku (siehe §6).
5. **Löschen schlägt Verschieben.** Was keine Entscheidung trägt, fliegt
   raus — nicht in ein anderes Menü (§7).

## 3. Jetzt neu: eine Frage, eine Antwort

Frage: **„Soll ich jetzt tanken — und wenn ja, wo?“**

Entwurf Ebene 1 (alles, was ohne Scrollen und ohne Tippen sichtbar ist):

```text
┌─────────────────────────────────────────┐
│ Tanken?      Frankfurt · E10 · vor 4 Min │
│                                         │
│ ● JETZT TANKEN                          │
│   JET, Frankfurter Ring · 1,2 km        │
│   1,679 €/L                             │
│                                         │
│   [ Route ]              Warum? >       │
└─────────────────────────────────────────┘
│ Heute: ━━━━━●━━━━━━━━━ Tief ~19 Uhr >  │  ← eine Zeile, tappbar
```

Varianten der Antwortkarte (gleiche Form, anderer Inhalt):

| Lage | Titel | Unterzeile | Handlung |
|---|---|---|---|
| Jetzt günstig | Jetzt tanken | Station · Entfernung · Preis | Route |
| Warten lohnt | Warten bis ~19 Uhr | spart ca. 3,60 € | Erinnern |
| Kaum Unterschied | Tanken, wann's passt | Preise heute fast gleich | Route (nächste) |
| Keine Prognose | Günstigste gerade: JET | 1,679 €/L · Stand 14:32 | Route |
| Offline | Letzter Stand: JET | 1,679 €/L · Preis an der Säule zählt | — |

Regeln:

- **Max. 25 Wörter**, eine Leit-Zahl, genau eine primäre Handlung.
  Bei „Warten“ ist die Handlung eine Erinnerung, keine Route.
- Der Tagesverlauf ist **eine Zeile** (Mini-Kurve + Tiefpunkt), kein
  19-Zellen-Raster und keine drei Kennzahlen-Karten. Wer tippt, bekommt
  Ebene 2: Kurve, Tief/aktuell in €/L, ein Satz.
- „Warum?“ öffnet **ein** Blatt mit max. fünf Zeilen: Fenster, Ersparnis
  in €, Sicherheit als **ein Wort** (sehr/eher/kaum sicher), Tank-Hinweis
  nur wenn relevant („Reserve reicht nicht bis 19 Uhr“), Stand.
- Der Frische-Chip (`vor 4 Min` / `alt`) sitzt im Kopf, nicht als
  Fußzeile. Maximal **ein** Banner gleichzeitig (offline schlägt alles).
- Was ersatzlos entfällt, steht in §7: Was-wäre-wenn-Annahmen,
  Feedback-Intents, nächste Schritte, Benefit-Block, Gültigkeits-Chip
  (wird `bis 17:45` in kleiner Schrift), zweite Stationsliste.

## 4. Woche neu: Ranking statt Raster

Frage: **„Wann in den nächsten Tagen soll ich tanken?“**

Heute zeigen Raster, Detail, Liste und Wochenlinie dieselben (maximal
drei!) Fenster viermal. Der Neuentwurf zeigt **eine** Liste:

```text
┌─────────────────────────────────────────┐
│ Wann tanken?                            │
│ Tank: halbvoll · reicht bis Do  [Ändern]│  ← nur Anzeige + Sprung
│                                         │
│ 1  Heute ~19 Uhr                        │
│    1,669 €/L · spart ca. 3,60 €         │
│    ziemlich sicher                      │
│                                         │
│ 2  Morgen ~12 Uhr                       │
│    1,689 €/L · spart ca. 1,80 €         │
│    eher sicher                          │
│                                         │
│ 3  Freitag ~19 Uhr                      │
│    1,699 €/L · unsicher                 │
│                                         │
│ ⓘ Ab Tag 5 wird die Prognose unsicher.  │
└─────────────────────────────────────────┘
```

Regeln:

- **Bestenliste mit max. drei Einträgen**, sortiert nach Ersparnis.
  Kein 7-Tage-Raster, keine Wochenlinie, keine zweite Liste.
  Begründung: Der Server liefert max. drei Fenster — vier
  Darstellungen für drei Fenster sind drei zu viel.
- Jeder Eintrag: Tag + Uhrzeit, erwarteter Preis, Ersparnis in €,
  Sicherheit als Wort. Kein Stern, kein Prozent, kein Tooltip mit
  p_raw-Normalisierung.
- Die Wochenlinie (hoch = billig) wird **gestrichen**. Wer den Verlauf
  sehen will, tippt einen Eintrag an und bekommt die Tageskurve.
- Der Tank-Chip zeigt nur den Stand; Ändern springt dorthin, wo der
  Tankstand wirklich gepflegt wird (genau ein Ort, siehe §6).
- Kalibrierungs-Jargon (`PIT-kalibriert`, `Szenarioprognose
  (unkalibriert)`) wird zu genau einem Satz: „Ab Tag 5 wird die
  Prognose unsicher.“ Die technische Wahrheit bleibt in System/Doku.

## 5. Labor neu: drei Fragen statt Sammelakte

Frage: **„Stimmt, was die App sagt — und kann ich ihr vertrauen?“**

Heute: 4 Unterbereiche × Dutzende Blöcke (Vertrauens-Konto, Fan-Chart in
4 Schritten, 4 Beta-Blöcke, Tagebuch, Backtest-Bilanz, 8 Parameterkarten
mit Formeln, Spielplatz mit Regler, Güte mit PICP/MASE/CUSUM/Brier,
Heatmap mit 3 Schaltern, Rohdaten-Tabellen, 4 CSV-Exporte, API-Explorer).
Neu: **drei Blöcke, sonst nichts.**

```text
┌─────────────────────────────────────────┐
│ Stimmt das?                    [Glossar]│
│                                         │
│ 1 · Kann ich vertrauen?                 │
│   An 26 von 30 Tagen lag die Empfehlung │
│   richtig.               [Tagebuch >]   │
│                                         │
│ 2 · Wie gut ist die Prognose?           │
│   [Kurve: erwartet vs. echt, 7 Tage]    │
│   Im Schnitt 1,8 ct daneben.            │
│                                         │
│ 3 · Wie rechnet die App?                │
│   ① Tagesmuster deiner Stadt            │
│   ② aktuelle Lage                       │
│   ③ 12-Uhr-Regel                        │
│   [Details für Neugierige >]            │
└─────────────────────────────────────────┘
```

Regeln:

- Block 1 trägt **einen** Satz (Zählung, kein Prozent) plus das
  Tagebuch als Liste (filterbar). Kein Balken, kein Brier, keine
  M7-Zeilen, keine Fensterbilanz mit drei Nennern.
- Block 2 trägt **eine** Kurve und **einen** Satz (mittlerer Fehler in
  ct). Kein Reliability-Diagramm, kein PICP, keine zwei MASE, kein
  CUSUM, keine Heatmap im Normalfall.
- Block 3 trägt drei Schritte in Alltagssprache. Formeln, Karten und
  Fachwerte nur hinter „Details für Neugierige“ — und dort gebündelt,
  nicht über acht Karten verstreut.
- Der Rest wandert: Rohdaten, CSV, API-Explorer → System (Betreiber).
  Gestrichen: Heatmap-Feinschliff, Spielplatz-Regler, Experimente,
  Tankprofil-Rechner (dessen Frage „Was bringt es mir?“ gehört als
  eine Zeile nach „Ich“), Beta-Blöcke „Einflüsse“ (ersetzt durch den
  einen Satz in Block 2).
- Das Glossar bleibt erreichbar, wohnt aber nicht mehr **im** Labor.

## 6. Übergreifend: Vokabel-Diät und Zahlen-Diät

**Vokabel-Diät.** Diese Wörter stehen in keinem Alltagstext mehr:

| Gestrichen | Ersatz (oder Ort) |
|---|---|
| Draw-Potenzial, Medianbetrag, Fensterminima, ref_nowcast, Anker, Referenz | `ca. X €` — eine Zahl, kein Methoden­vergleich |
| blocking_reasons, decision_ready, M7-Gate, Brier, PICP, MASE, CUSUM, δ̂, PIT, q-Wert, Regime-Kante | raus aus der UI → System/Doku; für Nutzer nur „sicher/unsicher“ bzw. der konkrete Grund („die Prognose pausiert“) |
| brutto/netto (als Paar) | `inkl. Umweg` — oder der Satz nennt nur das Ergebnis |
| Szenarioprognose (unkalibriert) | `unsicher` |
| Set, Polling-Set | `beobachtete Stationen` |
| Episode, Snapshot, Settlement, Ledger, Orakel | raus aus der UI |
| Sterne + Prozent + Balken (nebeneinander) | genau ein Wort: sehr / eher / kaum sicher |

Ziel: Die Alltags­texte kommen mit rund einem Dutzend Begriffen aus
(Empfehlung, Fenster, Preis, Ersparnis, Tankstand, Umweg, Prognose,
Sicherheit, Station, Woche, Stand, Erinnerung). `MICROCOPY.md` schrumpft
im selben Zug von 550 auf unter 150 Zeilen.

**Zahlen-Diät.** Pro Karte eine Leit-Zahl in €. ct/L nur in Details.
Nie Prozent, Sterne und Balken gleichzeitig. Bereiche ohne Wortpaar
weiter mit `–`, Zitate weiter mit `„…“` — die Typografie-Regeln bleiben,
die Textmenge schrumpft.

**Ein Ort pro Sache.** Tankstand pflegen: genau ein Ort (Profil/Ich),
überall sonst nur Anzeige. Datenalter: ein Chip im Kopf (`vor 4 Min`),
keine Fußzeilen mehr. Banner: max. eins, Rangfolge
offline → keine Prognose → Hinweis. „Warum?“: überall dasselbe Blatt
(max. fünf Zeilen), überall derselbe Weg in die Tiefe.

## 7. Streichliste: was wohin wandert

| Heute | Neu |
|---|---|
| Jetzt: Was-wäre-wenn-Annahmen (Liter, spätestens, Zeitwert) | streichen (Tankmenge kommt aus dem Profil; der Rest war Laborspielzeug in der Hauptkarte) |
| Jetzt: Intents (Ich warte / Jetzt tanken / Verwerfen) | streichen (keine sichtbare Wirkung für Nutzer je gezeigt) |
| Jetzt: Nächste Schritte (bis 3) | streichen (Navigation existiert; kein zweiter Menü­ersatz) |
| Jetzt: Drei-Fakten-Karten + Tank-Quick | ersetzt durch Warum-Blatt + Tank-Chip |
| Jetzt: Heute-im-Blick (3 Kennzahl-Karten, 19 Zellen, Stundenbalken) | eine Zeile + Kurve im Detail |
| Jetzt: Benefit-Block, Gültigkeits-Chip, Confidence-Balken | eine €-Zahl in der Karte, `bis HH:MM` klein, ein Wort |
| Jetzt: Fällig-Prompt (Fenster vorbei) | nach Ich/Erinnerungen oder streichen (offen, siehe §10) |
| Woche: Raster + Detail + Liste + Wochenlinie | eine Bestenliste (max. 3) |
| Woche: Sterne, Prozente, p-Tooltips, Kalibrierungs­etiketten | ein Wort + ein Satz (§4) |
| Woche: Tank-Pflege (Slider, Quick) | nur Anzeige-Chip, Pflege an einem Ort |
| Labor: 8 Parameterkarten mit Formeln | 3 Schritte + ein Details-Bereich |
| Labor: Güte-Panel (PICP, MASE×2, CUSUM, Brier, Reliability, Heatmap-Schalter) | eine Kurve + ein Satz (§5) |
| Labor: Rohdaten, CSV×4, API-Explorer | nach System (Betreiber­sicht) |
| Labor: Spielplatz, Experimente, Tankprofil-Rechner, Einflüsse-Balken | streichen (Begründung in §5) |
| Labor: eingebettetes Glossar | Glossar bleibt eigener Ort |
| Überall: Frische-Fußzeilen | ein Chip im Kopf |
| Überall: zweite/dritte Stationslisten | genau ein Ort: Stationen |

Faustregel für alles, was hier nicht steht: Trägt es in den nächsten
30 Sekunden eine Tank­entscheidung? Nein → streichen oder nach System.

## 8. Ehrlichkeit ohne Jargon

Der Neuentwurf streicht Wörter, nicht Wahrhaftigkeit. Die Regeln:

- Was die App nicht weiß, sagt sie in einem Satz:
  `Noch zu wenig Daten für eine Empfehlung — die Preise oben stimmen trotzdem.`
  Kein Code, kein Gate-Name, kein Zähler im Hauptsatz.
- Unsicherheit ist ein Wort (sehr/eher/kaum sicher), kein Prozent.
  Wer fragt („Warum?“), bekommt die Zählung: `An 26 von 30 Tagen richtig.`
- Prognosen ohne Beleg gibt es nicht: Tage ohne Fenster bleiben leer,
  leere Stunden bleiben leer — wie heute, nur kürzer gesagt.
- Der Preis an der Säule bleibt letzte Wahrheit; offline steht das in
  der Karte, nicht im Kleingedruckten.
- Technik (Kalibrierung, Schwellen, Güte­maße) bleibt prüfbar — aber in
  System/Doku, nicht zwischen Nutzer und Antwort.

## 9. Batch 1: Alltag entlasten (Jetzt und Woche neu)

Ziel: Die Antwort steht in einer Sekunde. Größte Wirkung zuerst —
der Alltag wird lesbar, bevor das Labor angefasst wird.
Erst nach Freigabe dieses Entwurfs beginnen; Antworten auf §12,
Fragen 1, 2 und 5 gehören zur Freigabe.

### Umfang Jetzt (§3)

- [ ] Antwortkarte neu mit den fünf Varianten aus §3: max. 25 Wörter,
  eine Leit-Zahl in €, genau eine primäre Handlung.
- [ ] Primärhandlung bei „Warten“ nach §12, Frage 2 (Vorschlag:
  Erinnerung; sonst Route).
- [ ] „Warum?“-Blatt (max. fünf Zeilen) und Tageszeile (Mini-Kurve +
  Tief) als einzige Ebene-2-Orte bauen.
- [ ] Streichen: Was-wäre-wenn-Annahmen, Feedback-Intents, nächste
  Schritte, Drei-Fakten-Karten, Heute-im-Blick-Karten und 19-Zellen-
  Raster, Benefit-Block, Confidence-Balken (wird ein Wort),
  Gültigkeits-Chip (wird `bis HH:MM` in kleiner Schrift).
- [ ] Frische als Chip in den Kopf (`vor 4 Min` / `alt`); Fußzeile weg.
- [ ] Maximal ein Banner gleichzeitig (Rangfolge: offline → keine
  Prognose → Hinweis).
- [ ] Fällig-Prompt nach §12, Frage 1 entscheiden und umsetzen.
- [ ] RP2-Leseausgabe und Python-Notausgabe prüfen: Sie teilen
  Guide-Komponenten bzw. Verträge und dürfen nicht brechen.

### Umfang Woche (§4)

- [ ] Bestenliste (max. drei Einträge) ersetzt 7-Tage-Raster,
  Detailkarte, zweite Liste und Wochenlinie.
- [ ] Je Eintrag: Tag + Uhrzeit, erwarteter Preis, Ersparnis in €,
  Sicherheit als ein Wort. Sterne, Prozente, p-Tooltips und
  Kalibrierungs­etiketten entfallen; dafür ein Satz
  („Ab Tag 5 wird die Prognose unsicher.“).
- [ ] Tageskurve pro Eintrag als Detail (ein Tipp).
- [ ] Tank nur als Anzeige-Chip; Pflege an genau einem Ort (mit „Ich“
  abstimmen, kein zweiter Slider).

### Abnahme Batch 1

- [ ] Browser-Abnahme 390 px (Primärfall) und Desktop: Antwort ohne
  Scrollen sichtbar, Details genau einen Tipp entfernt.
- [ ] Unit-Tests gestrichener Logik (`now.ts`-, `week.ts`-,
  `guide.ts`-Anteile) entfernen, neue Antwort-Logik testen.
- [ ] E2E auf die neuen Antworten ausrichten; Scroll- und Text-Ratchets
  anpassen statt lockern.
- [ ] Barrierefreiheit erhalten: Fokus­führung, benannte Diagramme,
  keine Information nur per Farbe.
- [ ] Keine API-Vertragsänderung: Der Server liefert weiter alles
  (u. a. Intents, Fenster, p-Felder), die GUI zeigt weniger.

### Doks in Batch 1

- [ ] `UI.md`: Jetzt- und Woche-Teile neu (Tank-Guide, Bereiche-Tabelle,
  Frische-Regel, Banner-Rang).
- [ ] `MICROCOPY.md`: §4b-Muster ersetzen (Antwortkarte, Bestenliste,
  Warum-Blatt); gestrichene Muster entfernen.
- [ ] `INSTALL.md`: GUI-Rundgang für Jetzt/Woche aktualisieren.
- [ ] `QUALITAET.md`: Demo-Zusagen und Ratchets prüfen/anpassen.
- [ ] `LUECKEN.md`: Implementierter Stand nachziehen.
- [ ] Release: `CHANGELOG.md` + `app/version.py` gemeinsam (kein
  App-Release ohne beide).

## 10. Batch 2: Vertrauen neu (Labor und Doku)

Ziel: Das Labor beantwortet drei Fragen (§5); die Doku ist danach
wieder konsistent. Beginnt erst nach abgenommenem Batch 1; Antworten
auf §12, Fragen 3 und 4 gehören zur Freigabe.

**Freigabe 05.10.2026 (Entscheidungen).**

1. **Umfang:** Batch 2 umfasst Labor **und** die Verdichtung der noch
   nicht umgebauten Alltagsbereiche Stationen und Ich (§6, §7). Die
   Stand-Zeile in `LUECKEN.md` („Stationen, Ich, Labor/System“) bleibt
   damit zutreffend; der Plan war enger formuliert.
2. **Heatmap (§12, Frage 3):** bleibt als **einzige Grafik** in
   „Details für Neugierige“ (Block 3). Block 2 zeigt weiter nur eine
   Kurve. Die drei Schalter (Art, Wochen, Basis) entfallen — die
   Heatmap läuft mit den Standardwerten.
3. **Tagebuch (§12, Frage 4):** Die Liste ist **Kern von Block 1**
   (filterbar, wie in §5 skizziert). Der Vertrauens-Satz steht
   darüber; die Rohdaten des Ledgers wandern zusätzlich als
   CSV-Export nach System.

### Umfang Stationen (§6, §7)

- [ ] Der Atlas bleibt der **einzige** Ort für Stationslisten und
  Preis-Abstände: Karte, Liste, Detail, Verlauf und Vergleich.
- [ ] Doppelte Erklärungen zusammenziehen: Der δ̂-Beweis wohnt hier
  (nicht mehr im Labor); das Labor verlinkt.
- [ ] Eine Sortierung, ein Referenzbegriff: „Referenz“ nur an der
  gewählten Station, Netto nur als Zusatz in der Zeile.
- [ ] Frische bleibt die `FreshnessLine` im Fuß (kein zweiter Chip).

### Umfang Ich (§6, §7)

- [ ] Vier Unterseiten bleiben (Fahrzeug, Belege, Bilanz,
  Einstellungen) — der Tankstand wird **nur** hier gepflegt.
- [ ] Die Frage des gestrichenen Tankprofil-Rechners („Was bringt es
  mir?“) bekommt **eine Zeile** im Fahrzeug-Bereich; Regler,
  Wartebereitschaft und Experimente entfallen.
- [ ] Doppelte Erklärungen (Median-Maßstab, Netto/Brutto) auf einen
  Satz je Ort kürzen.

### Umfang Labor (§5)

- [ ] Drei Blöcke neu: 1) Vertrauens-Satz + Tagebuch-Liste mit Filter,
  2) eine Kurve + mittlerer Fehler in ct, 3) drei Schritte in
  Alltagssprache + ein Details-Bereich für Neugierige.
- [ ] Streichen bzw. verlagern: acht Parameterkarten (werden der eine
  Details-Bereich), Güte-Panel (wird Kurve + Satz), Heatmap-Schalter
  (nach §12, Frage 3), Spielplatz, Experimente, Tankprofil-Rechner,
  Einflüsse-Balken, eingebettetes Glossar (nur noch verlinkt).
- [ ] Rohdaten, CSV-Exporte und API-Explorer nach System als
  Betreiber-Sicht einordnen — ohne Neuaufbau, nur Umzug.

### Abnahme Batch 2

- [ ] Browser-Abnahme 390 px und Desktop wie in Batch 1.
- [ ] Labor-Unit-Tests und E2E auf die drei Blöcke ausrichten;
  Tests gestrichener Blöcke entfernen.
- [ ] Barrierefreiheit wie in Batch 1.
- [ ] Keine API-Vertragsänderung.

### Doks in Batch 2

- [ ] `UI.md`: Labor-Teile neu (Unterbereiche, freiwillige Blöcke,
  Antwort/Begründung/Beweis); System-Aufnahme der Betreiber-Sicht
  beschreiben.
- [ ] `MICROCOPY.md`: §4c-Muster ersetzen (Vertrauens-Satz, Tagebuch,
  drei Blöcke); Ziel: unter 150 Zeilen Gesamtumfang.
- [ ] `INSTALL.md`: Labor-Rundgang aktualisieren.
- [ ] `KONZEPT.md`: nur gegenlesen (Produktregeln bleiben; siehe §11).
- [ ] `RP2.md`: prüfen (Drei Fakten, geteilte Komponenten).
- [ ] `GUI-VORLAGEN.md`: optional ein Satz zur Divergenz Prototyp/Live.
- [ ] `LUECKEN.md`: Implementierter Stand nachziehen.
- [ ] Release: `CHANGELOG.md` + `app/version.py` gemeinsam.

## 11. Dok-Anpassungsanalyse: was sich ändern muss

Methode: Für jeden Block der Streichliste (§7) per Volltextsuche
geprüft, welche Doks ihn beschreiben. Ergebnis:

| Dokument | Urteil | Begründung | Batch |
|---|---|---|---|
| `produkt/UI.md` | anpassen | Beschreibt Tank-Guide, Fallback-Stufen, Urteilstöne, „Heute im Blick“, Frische-Fußzeile, Labor-Unterbereiche und freiwillige Blöcke im Detail — alles Umbau­gebiet | 1 + 2 |
| `produkt/MICROCOPY.md` | anpassen | Feste Muster §4b (Jetzt) und §4c (Labor) regeln genau die gestrichenen Blöcke; neue Muster (Antwortkarte, Bestenliste, drei Blöcke) aufnehmen | 1 + 2 |
| `betrieb/INSTALL.md` | anpassen | GUI-Rundgang beschreibt Jetzt (drei Fakten, Tagesstreifen), Woche (Sterne-Raster) und Labor (fünf Abschnitte, Spielplatz, Heatmap-Schalter) — veraltet mit dem Umbau | 1 + 2 |
| `entwicklung/QUALITAET.md` | anpassen | Demo-Zusagen nennen „Heute im Blick“ (19 Zellen); Scroll- und Text-Ratchets hängen an der alten Struktur | 1 |
| `planung/LUECKEN.md` | anpassen | Stand-Tabelle (Oberfläche, Labor) und Offene Arbeit nach jedem Batch nachziehen | 1 + 2 |
| `releases/CHANGELOG.md` + `app/version.py` | pro Release | Je Batch ein Release-Eintrag; beide Dateien gemeinsam pflegen (kein Vorab­eintrag im Entwurf) | 1 + 2 |
| `betrieb/RP2.md` | prüfen | Leseausgabe teilt Guide-Komponenten; „Drei Fakten“ der Notausgabe gegen neue Antwortkarte prüfen | 1 + 2 |
| `produkt/KONZEPT.md` | nur gegenlesen | F1–F3, Gates und Ehrlichkeits­regeln sind Produkt­ebene und bleiben; der Verweis auf `UI.md` bleibt gültig | 2 |
| `produkt/GUI-VORLAGEN.md` | optional ein Satz | Prototyp in `web/src/concept/` bleibt als Design-Lab unangetastet; Divergenz zur Live-App ist dort schon als Grenze geführt | 2 |
| `referenz/API.md` | unverändert | Keine Vertragsänderung: Intent-, Diary-, Fenster- und p-Felder bleiben serverseitig bestehen, die GUI zeigt nur weniger | — |
| `referenz/ANALYSE.md`, `ENGINE.md`, `MISSINGNESS.md`, `REPLAY.md`, `DATENWERKZEUGE.md` | unverändert | Engine- und Daten­ebene; der Umbau ist reine GUI | — |
| `architektur/ARCHITEKTUR.md` | unverändert | Geräte und Datenfluss ändern sich nicht | — |
| `betrieb/BETRIEB.md` (+ Abnahme, Speicher, Tausch) | unverändert | Heatmap/Selektion/Kalibrierung sind dort Betriebs­sicht (Jobs, Env); allenfalls ein GUI-Satz beim Gegenlesen | — |
| `entwicklung/DOKUMENTATION.md`, `PRUEFSTAENDE.md` | unverändert | Kein Bezug zum Umbau­gebiet | — |
| `adr/*` | kein neues ADR | Rückbau innerhalb des beschlossenen Umfangs, kein neuer Umfang; Führung in `LUECKEN.md` genügt | — |
| `README.md` (Root) | unverändert | Navigation 3+1 bleibt; nur Inhalte ändern sich | — |
| `planung/TODO.md` | bewusst nicht | Enthält nur P0-Korrekturen (A14, N1); die Batches leben hier, bis sie beauftragt sind | — |
| `README.md` (docs-Index) | unverändert | Kein neues Dokument; dieses ist bereits eingetragen | — |

## 12. Offene Fragen

1. **Fällig-Prompt** („Fenster vorbei — gerade getankt?“): nach „Ich“
   verschieben oder ganz streichen? (Zur Freigabe von Batch 1.)
2. **Primärhandlung bei „Warten“**: Erinnerung stellen (Vorschlag) oder
   weiter Route anbieten? (Zur Freigabe von Batch 1.)
3. **Heatmap**: ersatzlos streichen oder als einzige Grafik in „Details
   für Neugierige“ behalten? (Zur Freigabe von Batch 2.) →
   **Entschieden 05.10.2026:** als einzige Grafik in „Details für
   Neugierige“ behalten, ohne Schalter.
4. **Tagebuch**: Wie wichtig ist die Liste vergangener Empfehlungen —
   Kern von Block 1 oder auch verzichtbar? (Zur Freigabe von Batch 2.)
   → **Entschieden 05.10.2026:** Kern von Block 1 (filterbar).
5. **Umfang**: Alle drei Bereiche neu — oder erst „Jetzt“, dann sehen?
   (Zur Freigabe von Batch 1.)
