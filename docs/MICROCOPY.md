# MICROCOPY — Regelwerk für alle Texte in der App

> Stand: 17.09.2026 · App-Version **0.45.0** · gilt für `web/src/**`,
> `rp2/fallback_gui.py`, Fehlertexte in `app/**` und für jede neue Zeile Text,
> die ein Nutzer zu sehen bekommt.

Eine Seite, damit Texte nicht je Panel neu erfunden werden. Wer eine
Formulierung sucht, findet hier Tonfall, Einheiten, Zahlen, Zitate und die
Standardsätze für Leer-, Lade- und Fehlerzustände.

## Inhaltsverzeichnis

- [1. Tonfall](#1-tonfall)
- [2. Anführungszeichen und Sonderzeichen](#2-anführungszeichen-und-sonderzeichen)
- [3. Zahlen, Einheiten, Zeiten](#3-zahlen-einheiten-zeiten)
- [4. Benennungen](#4-benennungen)
- [4a. Fallback-GUI: feste Muster (0.34.0)](#4a-fallback-gui-feste-muster-0340)
- [4b. Bereich „Jetzt“: feste Muster (0.34.0)](#4b-bereich-jetzt-feste-muster-0340)
- [4c. Bereich „Labor“: feste Muster (0.36.0)](#4c-bereich-labor-feste-muster-0360)
- [4d. Bereich „System“: feste Muster (0.37.0)](#4d-bereich-system-feste-muster-0370)
- [4e. Tooltips ergänzen, sie erklären nicht (V2)](#4e-tooltips-ergänzen-sie-erklären-nicht-v2)
- [5. Zustände: leer, lädt, Fehler](#5-zustände-leer-lädt-fehler)
- [5a. Wortlaut je Zustand (T8)](#5a-wortlaut-je-zustand-t8)
- [5b. Meldungen: ein Register, ein Rang (V3)](#5b-meldungen-ein-register-ein-rang-v3)
- [6. Was nie im Text steht](#6-was-nie-im-text-steht)
- [7. Prüfung](#7-prüfung)

## 1. Tonfall

**Ehrlich, knapp, handlungsleitend** — in dieser Reihenfolge.

| Regel | Ja | Nein |
|---|---|---|
| Handlung zuerst, Begründung danach | „Jetzt tanken — 4 ct unter Tagesmedian.“ | „Der Tagesmedian liegt über dem aktuellen Preis, daher …“ |
| Keine Sicherheit behaupten, die nicht gemessen ist | „Noch nicht kalibriert — bis dahin zählen nur aktuelle Preise.“ | „82 % sicher“ vor der Abnahme (Konzept §0.4) |
| Kein Tadel an den Nutzer | „Getankte Liter außerhalb 5–100 L.“ | „Ungültige Eingabe!“ |
| Deutsch als Primärlabel, Fachwort im Tooltip | „Günstig-Chance“, `title="Fachwort: Cheap-Probability"` | „Cheap-Probability“ als sichtbares Label |
| Kein Ausrufezeichen, kein Emoji im Fließtext | „Collector meldet seit 2 Stunden nichts.“ | „Achtung!! ⚠️“ |
| Kein `✓`/`!`-Präfix — der Ton steht im Icon und in der Farbe | Banner rose mit Warnzeichen: „Speichern fehlgeschlagen: …“ | grünes Häkchen vor „! Speichern fehlgeschlagen“ |
| Zustände benennen, nicht bewerten | „Noch kein Lauf“ | „Leider noch nichts da“ |
| Possessiv ist erlaubt, direkte Anrede und Imperativ nicht | „Beleg in deiner Bilanz verbucht.“ · „Wer vor 18:00 Uhr tanken muss, …“ | „Du hast deinen Beleg gespeichert.“ · „Fahr nur hin, wenn …“ |
| Fragen nur im Fällig-Prompt | „Gerade getankt?“ (Fenster vorbei) | „Hast du getankt?“ als Dauertext |

**Anrede (T10/T1):** „Sie“/„Du“ als Anrede bleibt draußen, der Possessiv
(„deine Bilanz“, „dein Profil“) ist die etablierte Form und bleibt. `du`,
`dir`, `dich` und die Höflichkeitsformen stehen in keinem Nutzertext — der
Ratchet `microcopy.test.ts` prüft sie, `tests/test_rp2_fallback.py` prüft
dasselbe für die Fallback-GUI. Fragen stehen nur dort, wo die App auf ein
Ereignis antwortet (Fällig-Prompt „Fenster vorbei“, Erfassungs-Formular) —
sonst Aussagesatz. Imperative („Vergleiche …“, „fahr nur hin …“) werden zu
Aussagen über die Sache. Anrede in **Hinweistexten der Doku** darf „Sie“
verwenden.

**Fehler sind keine Erfolge (T2):** Jede Rückmeldung einer Aktion trägt ihren
Ton — `ok` (grün, Häkchen, `role="status"`), `warn` (amber, „lokal vorgemerkt“,
`role="status"`), `error` (rose, Warnzeichen, `role="alert"`). Der Baustein ist
`components/FeedbackBanner.tsx`; Einschübe schreibt die App durchgehend mit `—`.

## 2. Anführungszeichen und Sonderzeichen

| Zeichen | Verwendung | Beispiel |
|---|---|---|
| `„…“` | **jedes** Zitat, jeder zitierte Label- oder Job-Name in Fließtext | Job „Modell-Update“ starten |
| `'…'` | nie in Nutzertext (nur JS-Stringliterale im Code) | — |
| `"…"` | nie in Nutzertext (nur JSX-Attributsyntax) | — |
| `—` (Geviertstrich, mit Leerzeichen) | Einschub, Gegenüberstellung | „Warten — 3 ct Ersparnis erwartet“ |
| `–` (Halbgeviertstrich) | Bereiche ohne Wortpaar | „18–20 Uhr“, „5–100 L“ |
| `×` | Malzeichen | „1,015 × E10-Preis“ — `·` bleibt Trenner |
| `…` (ein Zeichen) | Auslassung, Ladezustand | „Läuft …“ |
| `·` | Trenner zwischen gleichrangigen Angaben | „12.345 Preise · 18 Stationen“ |
| `≤ ≥ ≈ ±` | mit geschütztem Sinn, immer mit Leerzeichen | „≤ 5 Sekunden“ |

**Kein Zeichen als Textersatz (V4):** `✓`, `✗`, `✎`, `✕`, `★`, `▼`, `●`
trugen früher je nach Stelle eine andere Bedeutung (Erfolg, „offen“, „noch
nicht“, Chip-Richtung …) — ein Screenreader liest sie als „Häkchen“, „Stern“.
Seit 0.43.0 steht das **Wort** im Text („richtig“, „daneben“, „unentschieden“,
„Jetzt tanken“, „Warten“, „Woanders tanken“, „nur offene“); tragende
Zeichen sind durch lucide-Icons ersetzt, die dekorativ bleiben
(`aria-hidden`). Erlaubt bleiben die Formel- und Fließzeichen dieser Tabelle
(`→` als Richtung „von → zu“, `·`, `—`, `–`, `×`, `…`). Geprüft von
`microcopy.test.ts` (Regel 11).

Typografische Zeichen stehen direkt im Quelltext (UTF-8), **keine**
HTML-Entities (`&bdquo;`, `&quot;`) — die lesen sich im Diff nicht.

## 3. Zahlen, Einheiten, Zeiten

Formatiert wird **ausschließlich** über die Funktionen in `web/src/data.ts`;
`toFixed` in Anzeigen ist verboten und wird von
`web/src/format-convention.test.ts` als Ratchet gemeldet.

| Größe | Funktion | Darstellung |
|---|---|---|
| Preis je Liter | `euroPerLiter` | `1,749 €/L` (3 Nachkommastellen) |
| Preis**differenz** je Liter | `centPerLiter` | `4,2 ct/L` (1 Nachkommastelle) |
| Geldbetrag gesamt | `euro` | `62,45` (2 Nachkommastellen) + „€“ im Label |
| Prozent | `percentLabel` | `93 %` (Leerzeichen vor „%“) |
| Strecke | `kilometersLabel` | `12 km` · `2,4 km` (eine Nachkommastelle nur beim Umweg) |
| Tempo | `kilometersPerHour` / `kilometersPerHourSpeech` | `50 km/h` — Symbol; die Langform „Kilometer pro Stunde“ nur als Screenreader-Text |
| Zeitraum (Rückblick) | `timeSpanLabel` | `24 Stunden` · `3 Tage` · `7 Tage` — Schalter-Label ohne „letzte“; im Satz „die letzten 3 Tage“ |
| Horizont (Blick nach vorn) | `+N Tage` | `+3 Tage` · `+7 Tage` — das „+“ unterscheidet die Prognose vom Rückblick-Span |
| Zeitwert | `euroPerHour` | `16 €/h` — Symbol, die Langform „Euro pro Stunde“ gibt es nur noch als Screenreader-Text |
| Schwelle/Maßzahl ohne Einheit | `deNumber` | `0,80` (Komma, nie `0.80`) |
| Stückzahl | `countLabel` | `12.345` |
| Stundenbereich | `hourRangeLabel` | `18–20 Uhr` |
| Zeitpunkt | `timeLabel` / `epochLabel` | `12.09., 08:00` |

**Zwei Größen, zwei Spannen (T3):** *Tankmenge* ist die Rechengröße aus
Profil und „Jetzt“ — **10–100 L**, ganze Liter, Schritt 1 (dieselbe Obergrenze
wie `FIELD_BOUNDS` in `app/profiles.py` und `PROFILE_BOUNDS` in `web/src/data.ts`;
ein 100-L-Tank muss darstellbar sein, Prüfbericht §5). *Getankte Liter* ist
der gebuchte Vorgang im Beleg — **5–100 L**, Schritt 0,5
(`FILL_LIMITS.liters`, Server-Validierung). Beide tragen die Einheit `L`,
niemals ausgeschrieben „Liter“ neben einer Zahl. Wird eine Eingabe gerundet,
zeigt das Feld den gerundeten Wert zurück, statt still zu runden.

**Regel ct/L vs. €/L (C9):** *Niveaus* stehen in €/L, *Unterschiede* in ct/L.
Ein Panel mischt beides nur, wenn es Niveau **und** Differenz zeigt — dann
steht das Niveau zuerst. Beispiel: „1,749 €/L · 4,2 ct/L unter Tagesmedian“.

**Herkunft einer Uhrzeit (O1, 0.44.0):** Die App nennt eine Uhrzeit nur, wenn
sie einen Beleg dafür hat. Fehlt dem Beleg der Zeitstempel, ist seine Stunde die
erfundene 12-Uhr-Projektion der Engine — und der Satz sagt das
(`1 Beleg ohne Zeitstempel zählt als 12 Uhr.`). Nie stillschweigend als eigene
Tankzeit ausgeben, nie „Standardzeit“ oder „Default“ schreiben.

**Zeitzone:** Jede angezeigte Uhrzeit ist Europe/Berlin, auch wenn die API
UTC liefert. Die Formatter setzen `timeZone: "Europe/Berlin"` — eigene
`Date`-Ausgaben ohne Formatter sind ein Fehler.

Dezimaltrennzeichen ist immer das Komma (`de-DE`), Tausendertrennzeichen der
Punkt. Eingabefelder akzeptieren beides (`commaToDot`), zeigen aber Komma.

## 4. Benennungen

| Gemeint | Wort in der App |
|---|---|
| die Bereiche der App | **Jetzt** (Einstieg), **Stationen**, **Woche**, **Ich**, **Labor**, **System** — die Ziel-Navigation aus [UI-NEUENTWURF.md](UI-NEUENTWURF.md) §4; die alten Tabs **Alltag**, **Werkstatt** und **Einstellungen** sind mit 0.35.0/0.36.0 ersetzt (nicht „Statistik“, nicht „Prüfstand“) |
| die sechs Bereiche des Neuentwurfs | **Jetzt**, **Stationen**, **Woche**, **Ich**, **Labor**, **System** — dieselbe Liste, hier als Planungs-Begriff (Phasen 1–4 in [UMSETZUNG-GUI-NEUENTWURF.md](archiv/UMSETZUNG-GUI-NEUENTWURF-2026-09-14.md)) |
| eine Tankstelle | **Station** |
| ein gebuchter Tankvorgang | **Beleg** (nicht „Fill“, nicht „Buchung“, nicht „Füllung“, nicht „Tankbeleg“ — auch nicht als Überschrift) |
| die Rechengröße für Tankvolumen | **Tankmenge** (10–100 L) — im Beleg heißt dieselbe Spalte **Liter** und meint die getankten Liter (5–100 L) |
| der Preis-Vorteil | **Ersparnis** — Betrag **ohne** Vorzeichen, die Richtung steht im Wort: „1,60 € günstiger“, „0,80 € teurer“ |
| das Alter eines Standes | über `ageLabel`/`ageWord`: „vor 12 Minuten“ — nie „vor 12 Min.“ |
| δ̂ | **Preis-Abstand** (nicht „Hauspreis-Abstand“) |
| Regret | **Mehrkosten zum perfekten Timing** (nicht „Entscheidungsverlust“) |
| Orakel-Bestwert | **Perfektes Timing (Orakel)** (nicht „Perfekte Sicht“) |
| Heatmap-Modus Anteil | **Günstig-Chance** (Fachwort „Cheap-Probability“ nur im Tooltip) |
| Tageszeit des Zeitwerts | **Stoßzeit** / **Nebenzeit** (nicht „Peak“/„offpeak“) |
| Gesamtfarbe des Systems | **Alles ok** · **Hinweise** · **Störungen** · **Unbekannt** — nicht „OK“, nicht „System in Ordnung“ |
| Kennzahlen des Engine-Laufs | **Kennzahlen der Engine** / **Schwellen der Engine** — „Statistik“ ist ausgemustert |
| der Nachrechnungs-Lauf | **Backtest** — „Prüfstand“ ist ausgemustert (der Name lebt nur noch als Zitat des Archiv-Dokuments weiter) |
| Rückweg aus dem Labor | Knopf **Zurück**; die Herkunft steht in der Zeile `Zurück zu: <Bereich> · <Anlass>` — nie „Zurück zum Alltag“ |
| Nachschlage-Seite | **Glossar** — ein Name in Navigation, Titel und Fußzeile |
| Tankstand zurücknehmen | **Keine Angabe** — in „Jetzt“ wie in „Woche“ |
| Prognoselauf auf dem NAS | **Modell-Update** |
| Preisdaten-Abholung auf dem Pi | **Collector** |
| Zeitfenster mit günstigem Preis | **Fenster** |
| Ampel-Aussage | **Empfehlung** (nicht „Signal“) |

Fachbegriffe (δ̂, MASE, PICP, Brier, ε, Regret) bleiben der Werkstatt
vorbehalten und stehen dort im `title`/Tooltip hinter einem deutschen Label
(F2, 0.15.0). Der Alltag kommt ohne sie aus.

## 4a. Fallback-GUI: feste Muster (0.34.0)

Diese Sätze stehen so im Template (`rp2/fallback_gui.py`, Marker
`tankapp-fallback-gui v4.0`) — nicht neu formulieren, nur wiederverwenden.

| Stelle | Muster |
|---|---|
| Verdict (F1) | `Jetzt tanken` · `Bis <Zeitpunkt> Uhr warten lohnt sich` (Zeitpunkt mit „heute“/„morgen“-Präfix, immer mit „Uhr“) |
| Verdict ohne Prognose | `Aktueller Preisvergleich` + „ohne sie gibt es keinen belastbaren Grund zu warten“ |
| Antwort-Karte leer | `Noch kein frischer Preis.` + „Der Status oben zeigt, wo es hängt“ |
| Kicker der Antwort-Karte | `<KRAFTSTOFF> · <ORT | ALLE ORTE> · STAND <HH:MM> UHR` |
| F1-Chip | `„Jetzt oder warten“: <Zeitpunkt> · ~<Preis> €/L · −<Betrag>` |
| F2-Chip | `„Hier oder woanders“: 2. = <Station> · <Preis> €/L` |
| Tagesstreifen-Caption | `Grün = unteres Preisdrittel dieses Tages an dieser Station, rot = oberes Drittel. Leere Stunden hatten keine offene Meldung — nichts wird erfunden.` |
| Tagesstreifen leer | `Heute liegt noch keine offene Meldung für <Kraftstoff> an dieser Station vor — das Polling-Fenster ist 06–24 Uhr.` |
| Kraftstoff fehlt an der Station | `<Kraftstoff> nicht geführt` (grau, kursiv; nicht „nicht verfügbar“) |
| Station ohne offene Meldung | `geschlossen` bzw. `keine Preise` — der API-Code (z. B. „no prices“) steht nur im `title` der Werkstatt-Zeile |
| Abstand zur günstigsten | Delta-Chip `beste` / `+<x> ct` (ct/L für Unterschiede, €/L für Niveaus) |
| Sortierung | Knöpfe `Preis` · `Nähe` · `Aktuell`, darunter `Sortierung wirkt auf die Liste, nicht auf die Empfehlung.` |
| Ansicht | `Alltag` · `Werkstatt`; Datenstatus-Karte `Woher die Daten kommen` |
| Sticky-Chip | `Günstigste <Preis> €/L · <erste drei Wörter des Namens> …` |
| Ehrlichkeits-Zeile | `Preis-Score = historisches Quantil (q025–q975), keine kalibrierte Wahrscheinlichkeit — die rechnet ausschließlich das NAS (M7).` |
| NAS-Prüfung | Klick auf die NAS-Pill: `NAS ist wieder online — die Seite lädt jetzt die vollwertige NAS-GUI.` bzw. `NAS ist nach wie vor nicht erreichbar … — der Fallback bleibt aktiv und prüft selbst weiter.` |
| Ladefehler | `Daten konnten nicht geladen werden (<HTTP-Code>) — die Anzeige bleibt stehen, der nächste Versuch läuft automatisch.` |
| Drei Fakten der Antwort-Karte (v4.0) | `Jetzt hier` · `Bestes Fenster heute` · `Frische Preise` — immer dieselben drei, immer diese Reihenfolge. Der Tankstand fehlt hier **bewusst** (NAS-Sache), dafür nennt der dritte Fakt `von <n> Stationen im Set` |
| Frische-Fußzeile (v4.0) | `Preise <4 min> alt · Prognose <35 min> alt` — Alter von Preismeldung und Modell-Lauf, `—` statt „gerade eben“, wenn ein Stand fehlt |
| Fakt ohne Fenster | `—` mit Grund `kein Fenster mit Vorsprung` (nie ein geschätztes Fenster) |

## 4b. Bereich „Jetzt“: feste Muster (0.34.0)

Der Einstieg aus [UI-NEUENTWURF.md](UI-NEUENTWURF.md) §5.1. Die Reihenfolge
der Sätze ist Teil des Entwurfs: erst die Handlung, dann Menge/Sicherheit,
dann der Grund.

| Stelle | Muster |
|---|---|
| Ausgänge der Ampel-Karte 2.0 | `Jetzt tanken` (grün) · `Warten bis 18–20 Uhr` (grün, mit Uhr) · `Woanders tanken · <Station>` (blau) · `Keine klare Empfehlung` (grau) |
| Ersparniszeile | `Erwartet <4,0> ct/L günstiger ≈ <1,60> €` — ct/L für Unterschiede, € für Beträge |
| Sicherheitssatz (Stufe A) | `bei 40 L · ziemlich sicher (82 %)` · `<…> eher sicher (64 %)` · `<…> unsicher` — auf Stufe A kommt das **Wort aus dem Prozentwert** (Schwellen 75 / 55). Der Server-Badge beschreibt die Streuung der Lage; beide zusammen ergäben Sätze wie „unsicher (99 %)“ |
| Stufe B (Worte ohne Prozent) | derselbe Satz ohne Klammer, dazu `Noch <n> abgeschlossene Empfehlungen bis zur Prozent-Anzeige.` |
| Stufe C / S1 grau | `Keine klare Empfehlung` + `Das Modell lernt noch — <n> von 100 abgeschlossenen Empfehlungen. Die Preise unten sind live.` |
| Drei Fakten | `Jetzt hier` · `Bestes Fenster heute` · `Tank reicht?` — immer dieselben drei, immer diese Reihenfolge |
| Fakt ohne Zahl | `—` mit Grund: `Kein bestätigter Preis in der Sicht` · `Heute kein Fenster mit Vorsprung` · `Tankstand nicht gepflegt` |
| Frische-Fußzeile | `Preise vor 4 Minuten · Prognose vor 35 Minuten · <Ort>` (Alter in Worten über `ageLabel`, Schwellen wie `dataAgeNote`) |
| Nächste Schritte | `Günstigste Alternative: <Station>, <Preis> — netto <0,80> € nach <2,4> km Umweg` · `<Morgen> 19–21 Uhr wäre noch besser (<2,10> € weniger)` · `Tank reicht nicht bis zum Fenster — jetzt tanken oder Tankstand prüfen` |
| Hinweis unter der Fensterliste (A9, seit 0.44.0 mit Herkunft) | aktiv: `Reihenfolge nach deinen Tankzeiten (<12> Belege) — günstige Fenster zu Stunden ohne eigenen Tankvorgang stehen weiter hinten.` · darunter: `Noch nach Preis sortiert (<3> Belege von <8>) — ab <8> Belegen ordnet die App die Fenster nach deinen Tankzeiten, es fehlen <5>.` Belege ohne Zeitstempel hängen in **beiden** Fällen denselben Schlusssatz an: `<3> Belege ohne Zeitstempel zählen als 12 Uhr.` (Einzahl: `1 Beleg ohne Zeitstempel zählt als 12 Uhr.`); ohne solche Belege steht kein Schlusssatz (`personalizationNote` in `web/src/data.ts`, Zahlen aus `/v1/decide` → `personalization`) |
| Ebene 1 | Knopf `Warum?`, Sheet-Titel `Warum diese Empfehlung?`, Herkunftszeile `Grundlage: …`, Weg in die Tiefe `Im Labor vertiefen: <Abschnitt>` (seit Phase 3) |
| S0 „Einrichten“ | `Einrichten in drei Schritten` + `Schritt 1: Ort und Kraftstoff wählen · Schritt 2: Stationen festlegen · Schritt 3: Collector prüfen.` + Knopf `Einrichtung starten` |
| Fällig-Prompt: Ein-Tipp-Beleg (O17, 0.45.0) | Knopf nennt den gebuchten Live-Preis: `Ja, wie empfohlen (<1,719> €/L)`; ohne Live-Preis ist er aus: `Ja, wie empfohlen (Preis unbekannt)`. Wer ihn in der Lücke zwischen Anzeige und Tipp verliert, landet in der Maske mit `Kein frischer Preis für diese Station — bitte den Preis an der Säule eintragen.` — gebucht wird nie der Prognose-Median |
| Ich → Belege: Prognosepreis (O17, 0.45.0) | Altbestand ohne gezahlten Preis trägt `Prognosepreis — kein gezahlter Preis`; die Bilanz nennt darunter die zweite Spalte: `Ohne Prognosepreis: <+2,00> € (<1> Beleg zählt nicht mit).` (Mehrzahl: `<n> Belege zählen nicht mit`) |

## 4c. Bereich „Labor“: feste Muster (0.36.0)

Der Beweis-Ort (UI-NEUENTWURF §6/§7). Regel: Das Labor erklärt **mehr**, es
spricht aber nicht anders — dieselben Wörter wie „Jetzt“, dazu das Fachwort.
Die Überschriften der fünf Abschnitte und der Sprungleisten-Text stehen in
`web/src/lab.ts` (`LAB_SECTIONS`), die Sprache des Tagebuchs in denselben
Datei (`diaryActionWord`, `diaryOutcome`, `voidReasonWord`, `trustSentence`).

| Stelle | Muster |
|---|---|
| Abschnitts-Überschriften | die Alltagsfrage, nicht das Fachwort: `Was sagt die App eigentlich vorher?` · `Was heißt „ziemlich sicher“?` · `Warum ist eine Station „meist günstig“?` · `Wie lernt die App aus Fehlern?` · `Alle Begriffe von A–Z (Glossar)` · `Spielplatz: Was wäre gewesen, wenn …?` |
| Sprungleiste | `<Nummer> · <Kurzform>` (z. B. `3 · Warum eine Station meist günstig ist`), der Spielplatz ohne Nummer |
| Herkunft des Sprungs | `Zurück zu: <Bereich> · <Anlass>` (z. B. `Zurück zu: Jetzt · Warum?`) + Knopf `Zurück`; ohne Herkunft keine Zeile |
| Weg in die Tiefe (Ebene 2) | `Im Labor vertiefen: <Kurzform>` — das Ziel ist der Abschnitt, der die Zahl beweist |
| Ergebnis-Worte des Tagebuchs | `richtig` · `daneben` · `unentschieden` · `nicht bewertbar` — nie „Treffer“, nie „Fehler“, nie „Gleichstand“. Die Filter-Chips des Tagebuchs kommen aus `DIARY_FILTERS` (`lab.ts`) und tragen dieselben Worte; „Trefferquote“ bleibt als Name der Maßzahl erlaubt |
| Grau-Zustand der Ampel | `Keine klare Empfehlung` — ein Label, im Tagebuch wie in „Jetzt“ |
| Void-Grund | `Kein Vergleichspreis — Grund: <Klartext>.` (Codes aus `app/feedback.py`, z. B. `keine offene Meldung im Fenster`) — gilt weiter für Altbestände ohne gespeicherten Grund |
| Ablehnung mit Grund (0.40.0) | `Kein Vergleichspreis — die App hatte hier keine Empfehlung: <Grund der Tabelle>.` — der Grund kommt aus dem Snapshot (`decline_reason`: Güte-Gate, fehlender Anker, kein Fenster, Grauzone); die Grauzone nennt vor der M7-Freigabe **keine Zahl** (`GRAY_ZONE_REASON_GATE_SAFE`) |
| Mehrfach bestätigte Ablehnung (0.40.0) | dieselbe Aussage bleibt **eine** Zeile: Anzahl `3×` (bei gekürzter Liste `mehrfach`) und Zeitspanne `15.09., 19:59 – 15.09., 20:59` — linke Kante erste Bestätigung (`emitted_at`), rechte die Abrechnung (`diaryStamp`); kein zweiter Eintrag, kein zweiter Satz |
| Leeres Tagebuch | `no_settlements`: „Noch kein Eintrag abgerechnet: … Worker „settlement““ · `no_advice_history`: „Noch keine Empfehlung abgegeben — das Tagebuch beginnt mit der ersten Empfehlung aus „Jetzt“.“ |
| Trefferquote | `Versprochen waren die genannten Sicherheiten — eingetroffen sind <x> % davon.`; ohne Fälle der Satz mit `Noch keine abgeschlossene Empfehlung …` |
| Drift-Spalte | `unauffällig` · `noch nicht messbar` (nicht `unknown`, nicht „stabil“) |
| Maßzahl ohne Messwerte | `noch keine Vergleichspunkte — der Roll-Backtest füllt sie.` |
| Prinzip-Skizze ohne eigene Daten | `Prinzip-Skizze — nicht deine Daten.` — dieselbe Zeile wie in „Jetzt“ |
| Heatmap mobil (0.43.2) | `Die Matrix ist breit: seitlich schieben zeigt alle 24 Stunden. Farben und Zeilen erklärt die Lesehilfe darunter.` — nur unterhalb `sm`; die Matrix bleibt die eine bewusst schiebbare Fläche, `ReadingAid` darunter trägt die Erklärung wie bisher |
| Spielplatz | `Perfektes Timing (Orakel)` · `Eine Station sezieren` · Rohpreise `24 Stunden`/`3 Tage`/`7 Tage` — der Spielplatz sagt in jedem Fall, dass er mit **deinen** Daten rechnet, nicht mit einer Simulation |

## 4d. Bereich „System“: feste Muster (0.37.0)

Technik-Bereich nach [UI-NEUENTWURF.md](UI-NEUENTWURF.md) §5.5. Reihenfolge ist
Teil des Entwurfs: Zustand → Daten → Läufe → Störungen → Diagnose, darunter
die Frische-Fußzeile. Logik in `web/src/system.ts`.

| Stelle | Muster |
|---|---|
| Titel | `Einmal einrichten. Weiterlaufen lassen.` |
| Vier Bausteine | `Collector (Pi)` · `Datenbank (NAS)` · `Modelle` · `App` — je eine Zeile, Ton grün/gelb/rot/grau |
| Gesamtfarbe | `Alles ok` · `Hinweise` · `Störungen` · `Unbekannt` |
| Coverage-Gate | Fenster wie geliefert (`06–24 Uhr`) — kein zweites „Uhr“; Bestwert und Schwelle über `percentLabel` |
| Diagnose-Export | Knopf `Diagnose als Datei` — JSON mit Version, Zustand, Coverage, letzten Log-Zeilen, ohne Tokens |
| PWA | `der Service-Worker liegt unter /sw.js` — die Shell trägt die App-Version, ein wartender Worker meldet sich als „Neue Version verfügbar“; Belege/Vorsätze warten offline in der Queue und gehen raus, sobald die Verbindung steht (B10) |
| API | bleibt `/api/v1` — ein v2-Baum wird nicht erfunden |
| Weg in die Tiefe | `Warum?` öffnet Ebene 1, `Im Labor vertiefen` springt in den Labor-Abschnitt |

## 5. Zustände: leer, lädt, Fehler

| Zustand | Baustein | Regel |
|---|---|---|
| lädt (erstes Mal) | `components/Skeleton.tsx` — `SkeletonPanel`, `SkeletonChart`, `SkeletonRows` | Hält den Platz des künftigen Inhalts. `role="status"` + `aria-busy`, Label „<Sache> wird geladen/berechnet“ nur für Screenreader |
| lädt (Aktualisierung) | **nichts** | Vorhandene Zahlen bleiben stehen. Ein Poll darf die Ansicht nicht leeren — sonst flackert sie im Takt |
| Datenstand veraltet | `components/DataAge.tsx` (`dataAgeNote`) | Nur wenn der Stand die Schwelle reißt (Preise 30 min, Modell 180 min, Selektion 36 h; doppelt = roter Ton). Bei unbekanntem Stand: **kein** Banner |
| leer, weil noch nichts da | `Empty` | „Noch kein/e <Sache>.“ + was fehlt. Kein Alarm-Ton, kein „Erneut laden“ |
| leer, weil bewusst nichts | `Empty` | Grund nennen, nicht entschuldigen: „Fehlende Tage, kein Datenverlust.“ |
| Fehler (Panel) | `components/LoadError.tsx` | `problem(error_code)` als Klartext, Rohcode darunter, Knopf „Erneut laden“ |
| Fehler (Tabelle) | `components/CellError.tsx` | Gleiche Sprache als Tabellenzeile über die volle Breite; `empty` trennt „nichts da“ von „fehlgeschlagen“ |
| keine Zahl bestimmbar | `—` (Geviertstrich) | Nie `0`, nie leer |
| Job abgebrochen (0.21.0) | `components/JobCard.tsx` („Abgebrochen“) + `messages[\"aborted\"]` | Zustand benennen, keine Schuld: „Der Lauf wurde abgebrochen (z. B. durch einen Container-Neustart). Letzte Ergebnisse bleiben erhalten.“ |
| Job unvollständig (0.21.0) | `components/JobCard.tsx` („Unvollständig“) + `messages[\"some_models_unavailable\"]` | Sache statt Tadel: „Einige Stationen haben noch kein neues Modell. Vorige Ergebnisse sind gekennzeichnet.“ |

Ein Panel erfindet keinen eigenen Fehlertext: Klartexte stehen zentral in
`messages` in `web/src/data.ts`, je `error_code` genau einer.

### 5a. Wortlaut je Zustand (T8)

Vier Verben für „lädt“ und acht Knopftexte für „nochmal“ waren der Befund —
hier steht je Zustand **eine** Formulierung:

| Zustand | Formulierung | Beispiel |
|---|---|---|
| lädt, Daten vom Server | `<Sache> wird geladen` | „Preise werden geladen“ |
| lädt, App rechnet selbst | `<Sache> wird berechnet` | „Empfehlung wird berechnet“ |
| Knopf während des Schreibens | `<Sache> wird <Partizip>` | „Beleg wird verbucht“ |
| Wiederholen (allgemein) | `Erneut laden` | `LoadError`, `CellError` |
| Wiederholen (Bereich nennt die Sache) | `<Sache> neu laden` | „Tagebuch neu laden“ |
| Frische-Zeile | `Preise vor 4 Minuten · Prognose vor 35 Minuten · <Ort>` — Baustein `components/FreshnessLine.tsx`, Ort inklusive | ohne Ort: „kein Ort gewählt“ |
| Stand fehlt | `<Sache> ohne Stand` | „Prognose ohne Stand“ |
| Zählwort | über `freshCountLabel`/`countLabel` — der Plural steht in der Funktion | „1 frischer Preis“, „12 frische Preise“ |

Geprüft von `microcopy.test.ts` (Ladetexte, Retry-Knöpfe, Frische-Baustein).

### 5b. Meldungen: ein Register, ein Rang (V3)

Acht Blöcke über dem Inhalt waren der Befund — jede Meldung mit eigener Dauer
und ohne Ordnung. Seit 0.43.0 gilt:

| Rang | Bedeutung | Rolle |
|---|---|---|
| `error` | Störung — bleibt stehen, bis die Ursache weg ist | `role="alert"` |
| `warn` | Zustand — eingeschränkt, aber nichts verloren | `role="status"` |
| `hint` | Hinweis (Installation, Update, E5-Äquivalenz) | `role="status"` |
| `success` | Bestätigung einer Aktion (Beleg verbucht, Link kopiert) | `role="status"` |

Die Regeln dahinter: **höchste Rangstufe gewinnt**, gleichrangige Meldungen
werden mit „ · “ aneinandergereiht (nie gestapelt), die gemeinsame Dauer ist
**6 s** — nur `error` bleibt stehen. Der Regler ist
`components/Notices.tsx` (`reduceNotices`) + `components/NoticesView.tsx`;
Fehler- und Warn-Icons sind dekorativ (`aria-hidden`), der Text trägt die
Information. Geprüft von `components/Notices.test.ts`.

## 6. Was nie im Text steht

- **Erfundene Zahlen.** Keine Demo-Preise, keine Platzhalter-Prozentwerte,
  keine „ca.“-Werte ohne Rechnung dahinter (Ehrlichkeits-Regel, Konzept §0.4).
- **Pfade, Tokens, URLs, Koordinaten.** Auch nicht in Alarm-Pushes: die
  ntfy-Nachricht trägt nur Alarm-Code, deutschen Klartext und App-Version.
  **Einzige Ausnahme (T9/T6):** der Bereich „System“ in seinen Einrichtungs-
  und Diagnose-Texten — dort braucht ein Betreiber Datei- und Endpunkt-Namen
  (`polling.json`, `/api/v1/health`, `TANKAPP_NTFY_URL`). §4d beschreibt
  genau diese Fläche; die Muster dort (`/sw.js`, `/api/v1`) sind deshalb kein
  Widerspruch zu dieser Regel, sondern die Ausnahme selbst. Überall sonst
  gehören sie in einen `title`-Tooltip oder bleiben weg — ein Satz, der
  verspricht, Pfade zu entfernen, enthält selbst keinen. Ein Vorgang wird
  **einmal** beschrieben: Der Volltext steht in „System“, `messages` verweist
  dorthin („Die Schritte stehen im Bereich „System“ unter „Daten“.“).
  Vergleiche mit früheren GUI-Ständen („wie in der alten System-Ansicht“)
  gehören in die Doku, nie in den Text. Geprüft von `microcopy.test.ts`
  (Dateiliste minus System-Bereich).
- **Interne Ausnahmen.** Serverfehler werden über `app/errors.py` bereinigt,
  bevor sie irgendwo erscheinen.
- **Englische Hook-Zeilen** als Marketing. Eine deutsche Kurzzeile pro Tab
  reicht („Nachvollziehen statt blind vertrauen.“). Registriert sind:
  „Dein Tank-Kompass. Ohne Rätselraten.“ (Kopfzeile) und „Keine Demo-Preise.
  Keine erfundene Sicherheit.“ (Fußzeile). Ein englisches Wort ohne deutsche
  Erklärung — etwa ein `LIVE`-Badge — steht nirgends.

### 4e. Tooltips ergänzen, sie erklären nicht (V2)

Ein `title=` erscheint nur mit Maus oder Tastaturfokus — auf dem Telefon und
für Screenreader-Nutzer:innen fällt er ganz weg. Deshalb:

| Regel | Ja | Nein |
|---|---|---|
| Erklärung steht im sichtbaren Text | Hinweis unter der Filterleiste: „‚offen‘ zeigt nur Stationen mit aktuellem Preis …“ | `title="Nur Stationen mit aktuellem Preis für den gewählten Kraftstoff"` als einzige Quelle |
| Tooltip bleibt kurz (≤ 80 Zeichen, ein Satz) | `title="Zeitwert für die Umweg-Rechnung"` | `title="Wirkt auf die Umweg-Rechnung des Servers (Was-wäre-wenn, nicht das Profil)"` |
| Fachwort im Tooltip ist erlaubt (§1) | `title="Fachwort: Peak"` | `title="Stoßzeit = Peak (16:30–20:00), sonst Nebenzeit"` — die Definition gehört in den Text |
| Herkunft darf im Tooltip stehen (§4d) | `title="Quelle: /api/v1/fills.csv"` | — |
| Ein deaktivierter Knopf sagt sichtbar, warum | Text neben dem Knopf: „Verbindung läuft …“ | Erklärung nur im `title=` des deaktivierten Knopfs |

Der Ratchet (`microcopy.test.ts`, Regel 10) prüft Länge und Satzzahl jedes
`title=`.

## 7. Prüfung

- `npm --prefix web test` — enthält `format-convention.test.ts` (Ratchet gegen
  neue `toFixed`-Anzeigen und gegen `€`/`€/L` im Quelltext, T4),
  `microcopy.test.ts` (paarige `„…“`, keine HTML-Entities, **keine
  ausgemusterten Wörter und Synonyme** aus §4, die §4c-Ergebnis-Worte gegen
  `lab.ts`, keine Ausrufezeichen und keine `✓`/`!`-Präfixe, keine technischen
  Pfade außerhalb des System-Bereichs (§6/§4d), keine Abkürzungen ohne
  Langform (T7), kein doppelt eingetragener Satz (T5), ein Wortlaut je
  Zustand (§5a, T8), keine Erklärung im Tooltip (§4e, V2), **keine
  Symbolsprache als Textersatz** (`✓ ✗ ✎ ✕ ★ ▼ ●`, V4), **keine
  Einheiten-Langform und keine `ggü.`/`Min.` in Views** (V5)),
  `components/Notices.test.ts` (Rang, eine Meldung, eine Dauer — V3/§5b),
  `a11y.test.ts` (Kontrast AA — auch für **beide** Diagrammpaletten, V1),
  `components/FeedbackBanner.test.tsx` (Ton der Rückmeldung), `data-age.test.ts`
  (Schwellen und Wortform der Datenstand-Sätze) sowie
  `components/states.test.tsx` (Skeleton, Banner, Tabellen-Fehler gegen echtes
  Markup). **Neue Komponente mit Nutzertext? In die Dateilisten der beiden
  Ratchets eintragen**, sonst prüft sie niemand.
- `python -m pytest -q tests/test_operations.py` — prüft unter anderem, dass
  jeder lokale Doku-Link (also auch die Verweise auf diese Seite) existiert.

Neue Formulierung unklar? Kürzeste Variante wählen, die noch erklärt, **was
zu tun ist** — und sie hier eintragen, wenn sie ein Muster ist.
