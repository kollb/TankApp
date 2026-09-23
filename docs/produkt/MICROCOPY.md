# MICROCOPY — Regelwerk für alle Texte in der App

> Stand: 20.09.2026 · App-Version **0.61.0** · gilt für `web/src/**`,
> `rp2/fallback_gui.py`, Fehlertexte in `app/**`, die Push-Texte in
> `app/notify.py` (§4f) und für jede neue Zeile Text, die ein Nutzer zu
> sehen bekommt.

Eine Seite, damit Texte nicht je Panel neu erfunden werden. Wer eine
Formulierung sucht, findet hier Tonfall, Einheiten, Zahlen, Zitate und die
Standardsätze für Leer-, Lade- und Fehlerzustände.

## Inhaltsverzeichnis

- [1. Tonfall](#1-tonfall)
- [2. Anführungszeichen und Sonderzeichen](#2-anführungszeichen-und-sonderzeichen)
- [3. Zahlen, Einheiten, Zeiten](#3-zahlen-einheiten-zeiten)
- [4. Benennungen](#4-benennungen)
  - [4a. Fallback-GUI: feste Muster](#4a-fallback-gui-feste-muster)
  - [4b. Bereich „Jetzt“: feste Muster](#4b-bereich-jetzt-feste-muster)
  - [4c. Bereich „Labor“: feste Muster](#4c-bereich-labor-feste-muster)
  - [4d. Bereich „System“: feste Muster](#4d-bereich-system-feste-muster)
  - [4e. Tooltips ergänzen, sie erklären nicht](#4e-tooltips-ergänzen-sie-erklären-nicht)
  - [4f. Push-Texte: Alarme und Fenster-Meldungen](#4f-push-texte-alarme-und-fenster-meldungen)
  - [4g. Belegmaske und Diagramm-Beschreibungen](#4g-belegmaske-und-diagramm-beschreibungen)
- [5. Zustände: leer, lädt, Fehler](#5-zustände-leer-lädt-fehler)
  - [5a. Wortlaut je Zustand](#5a-wortlaut-je-zustand)
  - [5b. Meldungen: ein Register, ein Rang](#5b-meldungen-ein-register-ein-rang)
  - [5c. „Set“ ist Betriebssprache](#5c-set-ist-betriebssprache)
  - [5d. Ein Zustand, eine Zahl](#5d-ein-zustand-eine-zahl)
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
| die Bereiche der App | **Jetzt** (Einstieg), **Stationen**, **Woche**, **Ich**, **Labor**, **System** — die Ziel-Navigation aus [UI.md](UI.md) §4; die alten Tabs **Alltag**, **Werkstatt** und **Einstellungen** sind mit 0.35.0/0.36.0 ersetzt (nicht „Statistik“, nicht „Prüfstand“) |
| die sechs Bereiche des Neuentwurfs | **Jetzt**, **Stationen**, **Woche**, **Ich**, **Labor**, **System** — dieselbe Liste, hier als Planungs-Begriff (Phasen 1–4 in [UMSETZUNG-GUI-NEUENTWURF.md](../archiv/UMSETZUNG-GUI-NEUENTWURF-2026-09-14.md)) |
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

### 4a. Fallback-GUI: feste Muster

Diese Sätze stehen so im Template (`rp2/fallback_gui.py`, Marker
`tankapp-fallback-gui v5.0`) — nicht neu formulieren, nur wiederverwenden.

| Stelle | Muster |
|---|---|
| Preisvergleich | `Aktueller Preisvergleich` bzw. `Preis-Momentaufnahme — gewählter Preis veraltet`; nie Tank-/Warteaktion |
| Ohne Aktionsfreigabe | `Nur Preisvergleich — Tank- und Warteentscheidungen benötigen die geprüfte NAS-Entscheidung und das persönliche Profil.` |
| Antwort-Karte leer | `Noch kein frischer Preis.` + „Der Status oben zeigt, wo es hängt“ |
| Kicker der Antwort-Karte | `<KRAFTSTOFF> · <ORT | ALLE ORTE> · STAND <HH:MM> UHR` |
| Fenster | `Keine Fensterentscheidung` · `Prognosedaten stehen in der Werkstatt; Entscheidungen bleiben beim NAS.` |
| F2-Chip | `„Hier oder woanders“: 2. = <Station> · <Preis> €/L` |
| Tagesstreifen-Caption | `Grün = unteres Preisdrittel dieses Tages an dieser Station, rot = oberes Drittel. Leere Stunden hatten keine offene Meldung — nichts wird erfunden.` |
| Tagesstreifen leer | `Heute liegt noch keine offene Meldung für <Kraftstoff> an dieser Station vor — das Polling-Fenster ist 06–24 Uhr.` |
| Kraftstoff fehlt an der Station | `<Kraftstoff> nicht geführt` (grau, kursiv; nicht „nicht verfügbar“) |
| Station ohne offene Meldung | `geschlossen` bzw. `keine Preise` — der API-Code (z. B. „no prices“) steht nur im `title` der Werkstatt-Zeile |
| Abstand zur günstigsten | Delta-Chip `beste` / `+<x> ct` (ct/L für Unterschiede, €/L für Niveaus) |
| Sortierung | Knöpfe `Preis` · `Nähe` · `Aktuell`, darunter `Sortierung wirkt auf die Liste, nicht auf den Preisvergleich.` |
| Ansicht | `Alltag` · `Werkstatt`; Datenstatus-Karte `Woher die Daten kommen` |
| Sticky-Chip | `Günstigste <Preis> €/L · <erste drei Wörter des Namens> …` |
| Cache-Qualität | `Gültige Prognosedaten — keine Fensterentscheidung` bzw. `Historischer Cache — Qualität oder Gültigkeit nicht bestätigt` |
| Ehrlichkeits-Zeile | `Quantile sind keine kalibrierte Wahrscheinlichkeit und keine erwartete Nettoersparnis.` |
| NAS-Prüfung | `NAS bereit — Ansicht öffnen` · `NAS kehrt zurück` · `NAS eingeschränkt` · `NAS offline`; kein automatischer Reload |
| Ladefehler | `Daten konnten nicht geladen werden (<HTTP-Code>) — die Anzeige bleibt stehen, der nächste Versuch läuft automatisch.` |
| Drei Fakten der Antwort-Karte (v5.0) | `Jetzt hier` · `Fensterentscheidung` · `Frische Preise` — in dieser Reihenfolge |
| Frische-Fußzeile (v4.0) | `Preise <4 min> alt · Prognose <35 min> alt` — Alter von Preismeldung und Modell-Lauf, `—` statt „gerade eben“, wenn ein Stand fehlt |
| Fakt ohne Fenster | `—` mit Grund `nur auf dem NAS` |

### 4b. Bereich „Jetzt“: feste Muster

Der Einstieg aus [UI.md](UI.md) §5.1. Die Reihenfolge
der Sätze ist Teil des Entwurfs: erst die Handlung, dann Menge/Sicherheit,
dann der Grund.

| Stelle | Muster |
|---|---|
| Ausgänge der Ampel-Karte 2.0 | `Jetzt tanken` (grün) · `Warten bis 18–20 Uhr` (grün, mit Uhr) · `Woanders tanken · <Station>` (blau) · `Keine klare Empfehlung` (grau) |
| Ersparniszeile | `Erwartet <4,0> ct/L günstiger ≈ <1,60> €` — ct/L für Unterschiede, € für Beträge. **O45: ct/L und € kommen aus derselben Basis** — beide aus dem Medianpreis des Fensters (`expected_saving_median_eur`). Trägt nur das Fensterminimum einen Vorsprung, steht `Im günstigsten Moment ≈ <2,09> € günstiger` statt einer Zahl, die der genannte Fensterpreis nicht trägt |
| Grund der Empfehlung (Server, O45) | `Preis fällt im Fenster voraussichtlich — Warten spart im günstigsten Moment bis zu <2,09> €, im Mittel <0,44> €.` · gelb: `Eher warten: Fenster spart voraussichtlich <…>.` Ohne Fensterminima-Draws fallen beide Größen zusammen, dann bleibt die kurze Fassung `Warten spart bis zu <2,40> €.` Beträge auch hier in de-DE (`2,09 €`, nie `2.09 €`) |
| Brutto/netto-Trennung bei „Woanders tanken“ (B1) | Ebene-1-Hinweis: `Das Prozent misst die reine Preisdifferenz (brutto); der €-Betrag rechnet Umweg und Zeit ab (netto).` — seit 23.09.2026 Pflicht, weil Karten-Prozent (`p_lohnt`-Gate: `p_better_alt`) und der Server-Verdict zwei verschiedene Ereignisse messen |
| Sicherheitssatz (Stufe A) | `bei 40 L · ziemlich sicher (82 %)` · `<…> eher sicher (64 %)` · `<…> unsicher` — auf Stufe A kommt das **Wort aus dem Prozentwert** (Schwellen 75 / 55). Der Server-Badge beschreibt die Streuung der Lage; beide zusammen ergäben Sätze wie „unsicher (99 %)“ |
| Stufe C / S1 grau | `Keine klare Empfehlung` + `Das Modell lernt noch — <n> von 100 abgeschlossenen Empfehlungen. Die Preise unten sind gemessen.` — `n` ist der M7-Gate-Schnitt (`gate_n`, Vertragskohorte über die Lernzeit), nicht das 30-Tage-Fenster (Befund A3, 23.09.2026) |
| Drei Fakten | `Jetzt hier` · `Bestes Fenster heute` · `Tank reicht?` — immer dieselben drei, immer diese Reihenfolge |
| Fakt ohne Zahl | `—` mit Grund: `Kein bestätigter Preis in der Sicht` · `Heute kein Fenster mit Vorsprung` · `Tankstand nicht angegeben` |
| Frische-Fußzeile | `Preise vor 4 Minuten · Prognose vor 35 Minuten · <Ort>` (Alter in Worten über `ageLabel`, Schwellen wie `dataAgeNote`) |
| Nächste Schritte | `Günstigste Alternative: <Station>, <Preis> — netto <0,80> € nach <2,4> km Umweg` · `<Morgen> 19–21 Uhr wäre noch besser (<2,10> € weniger)` · `Tank reicht nicht bis zum Fenster — jetzt tanken oder Tankstand prüfen`. **Auf Stufe C entfällt der Fenster-Schritt** (0.55.0): Die Karte sagt dort „Keine klare Empfehlung“, ein Fenster mit Centbetrag behauptete drei Zeilen darunter genau die Sicherheit, die sie gerade verneint hat. Die Fenster bleiben über den Bereich „Woche“ erreichbar. **O45:** Die €-Zahl des Fenster-Schritts und die der Fensterliste im Bereich „Woche“ kommen aus `expected_saving_median_eur` — derselben Basis wie der €/L-Preis, der daneben steht |
| Hinweis unter der Fensterliste (A9, seit 0.44.0 mit Herkunft) | aktiv: `Reihenfolge nach deinen Tankzeiten (<12> Belege) — günstige Fenster zu Stunden ohne eigenen Tankvorgang stehen weiter hinten.` · darunter: `Noch nach Preis sortiert (<3> Belege von <8>) — ab <8> Belegen ordnet die App die Fenster nach deinen Tankzeiten, es fehlen <5>.` Belege ohne Zeitstempel hängen in **beiden** Fällen denselben Schlusssatz an: `<3> Belege ohne Zeitstempel zählen als 12 Uhr.` (Einzahl: `1 Beleg ohne Zeitstempel zählt als 12 Uhr.`); ohne solche Belege steht kein Schlusssatz (`personalizationNote` in `web/src/data.ts`, Zahlen aus `/v1/decide` → `personalization`) |
| Ebene 1 | Knopf `Warum?`, Sheet-Titel `Warum diese Empfehlung?`, Herkunftszeile `Grundlage: …`, Weg in die Tiefe `Im Labor vertiefen: <Abschnitt>` (seit Phase 3) |
| Tagesstreifen-Legende (O20, 0.50.0) | `<n> von 19 Stunden mit offener Meldung … Zahl = €/L (Stunden-Minimum) · Balken = Höhe im Tagesverlauf · Rahmen = jetzt.` + Skalen-Satz: mit Band `Farbskala der letzten <7> Tage: grün bis <1,720> €/L, rot ab <1,880> €/L.` — ohne Band `Ohne Verlauf der letzten Tage keine Farbskala — die Zahlen stehen ohne Grün/Rot-Urteil.` Die Skala nennt immer ihren Bezugszeitraum; „unteres/oberes Drittel dieses Tages“ war der Befund (rückwirkendes Umfärben) und steht nur noch in der Pi-Fallback-Vorlage, die ihren Tag als Bezug im Satz benennt |
| S0 „Einrichten“ | `Einrichten in drei Schritten` + `Schritt 1: Ort und Kraftstoff wählen · Schritt 2: Stationen festlegen · Schritt 3: Collector prüfen.` + Knopf `Einrichtung starten` |
| Fällig-Prompt: Ein-Tipp-Beleg (O17, 0.45.0) | Knopf nennt den gebuchten Live-Preis: `Ja, wie empfohlen (<1,719> €/L)`; ohne Live-Preis ist er aus: `Ja, wie empfohlen (Preis unbekannt)`. Wer ihn in der Lücke zwischen Anzeige und Tipp verliert, landet in der Maske mit `Kein frischer Preis für diese Station — bitte den Preis an der Säule eintragen.` — gebucht wird nie der Prognose-Median |
| Ich → Belege: Prognosepreis (O17, 0.45.0) | Altbestand ohne gezahlten Preis trägt `Prognosepreis — kein gezahlter Preis`; die Bilanz nennt darunter die zweite Spalte: `Ohne Prognosepreis: <+2,00> € (<1> Beleg zählt nicht mit).` (Mehrzahl: `<n> Belege zählen nicht mit`) |
| Günstigste Station jetzt (O19, 0.50.0; B4 0.59.0) | `<Station> ist gerade am günstigsten: <4,0> ct/L unter dem Preis, den die Empfehlung für „jetzt tanken“ ansetzt (<Referenz-Station>, <1,749> €/L) — das sind <1,80> € bei <45> L.` Die persönliche Zahl rechnet **immer** gegen den Anker der Empfehlung (`ref_nowcast`), nie gegen die teuerste Station im Set; die Referenz steht im Satz. Daneben, als Spanne benannt: `Günstigste bis teuerste: <5,0> ct/L · <2,25> € bei <45> L`. **B4 (0.59.0):** Ohne Empfehlung steht der Satz nicht mehr — die Karte zeigt denselben Inhalt (günstigster Preis in Headline/Betrag, Spanne in der Chip-Zeile) schon kompakter, und der Satz würde ihn nur noch einmal umstellen (`nowBestNow.sentence` = `null`); ist die Referenz selbst die günstigste, bleibt der Satz: `… — aber nicht unter dem Preis, den die Empfehlung für „jetzt tanken“ ansetzt (<Referenz-Station>, <1,709> €/L).` |
| Bilanz netto nach Umweg (O30, 0.50.0) | `Nach Umweg: <+6,34> € — Umwegkosten <1,66> € bei <1> Beleg, davon <1> mit geschätzter Strecke.` ohne Beleg mit Umweg `Nach Umweg: dieselbe Zahl — kein Beleg mit Umweg.` | `Ich` (Bilanz-Karte, O30) | Die Brutto-Zeile heißt ausdrücklich „brutto“, die Netto-Zeile steht darunter — dieselbe Formel wie die Entscheidung (`p_lohnt`, O9), Belege ohne Umweg erfinden keine Kilometer. |

### 4c. Bereich „Labor“: feste Muster

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
| Fensterbilanz (R3, 0.69.0) | zwei Zähler, zwei Zeilen — Fenster (Episoden) und abgerechnete Empfehlungen gehören nicht in einen Bruch: `Fenster (30 Tage): <3> von <5> genutzt — <2> verstrichen ohne Beleg, <1> läuft noch.` · `7 Tage: <1> von <2> Fenstern genutzt.` · `Abgerechnete Empfehlungen (30 Tage): <4>.` + Beziehungssatz `Fenster und Empfehlungen sind zwei Zähler: Ein Fenster trägt mehrere Empfehlungen, und auch ein verstrichenes Fenster wird abgerechnet — beide Zahlen gehören nicht auf denselben Bruch.` (`windowsBalance` in `web/src/data.ts`; die Kompaktform `windowsUsedLine` fügt dieselben Teile in derselben Reihenfolge). Ohne O38-Zähler: keine Bilanz statt einer erfundenen |
| Backtest-Bilanz der Regel (O21/R3, 0.69.0) | Kopf nennt die Parameter, sonst ist die €-Zahl keine Aussage: `Backtest-Bilanz (außerhalb der Stichprobe: <5> Tage · <40> L · ε = <1,00> ct/L)`. Geld-Kacheln `Ersparnis der Regel` · `Perfektes Timing (Orakel)` · `Ø Mehrkosten zum perfekten Timing`; Verhältnis-Kacheln `Geholtes Potenzial` · `Richtige Entscheidungen` · `Tage mit Vorteil`. Der Satz `Drei Maßzahlen, drei Nenner: …` steht **unter** den Zahlen, nicht in einem Tooltip — er erklärt, warum hohes Potenzial neben wenigen richtigen Tagen kein Widerspruch ist |
| Zwei MASE (R3, 0.69.0) | `MASE 1 Schritt` = Eine-Schritt-Validierung des Fits, trägt die Ensemble-Gewichte (`ensemble.mase`); `MASE 24 Stunden` = Roll-Backtest auf das 24-h-Fenster, trägt die Güte-Aussage (`metrics.mase`, `backtest.totals.mase`). Beide stehen nie ohne ihren Namen da; die Codes `MASE_1step`/`MASE_24h` gehören als Fachwort in ein `title`, nicht in den Satz. Die Engine weist keine sprungfreie Variante aus (`quality_metrics.mase_sprungfrei` ist immer `null`) — die Kachel sagt das, statt eine Zahl zu zeigen |
| Dünne Vergleichs-Basis (R3, 0.69.0) | Warnbox **über** der Matrix (`heatmapThinReference`), nicht nur Chip an der Zeile: `Dünne Vergleichs-Basis: <1> von <1> Wochentag (<Di>) liegt mit n=<16> Vergleichspreisen unter dem Mindestmaß <30>. Die „günstigste Stunde“ dieses Tages ist Mechanik, keine Empfehlung — die Werte bleiben sichtbar, tragen aber keine Aussage.` Der Wert bleibt ehrlich stehen, nur die Empfehlung wird zurückgenommen |
| Datenreichweite der Heatmap (R3, 0.69.0) | Bestand und Fenster mit der Zahl der fehlenden Tage: `Fenster <42> Tage (<6> Wochen), Bestand aber nur <5> Tage — <37> Tage fehlen (<Di 08.09. 05:10 – Sa 12.09. 07:55 Uhr>). Wochentage, die in dieser Zeit nicht vorkamen, bleiben leer: Das sind fehlende Tage, kein Datenverlust.` Liegt eine Live-Phase vor, hängt `heatmapCoverageNote` an: `Die Datenumstellung Archiv → Live-Polling braucht <90> vollständig live beobachtete Tage je Station. <livePhaseHint>` — ohne Phase kein Countdown |

### 4d. Bereich „System“: feste Muster

Technik-Bereich nach [UI.md](UI.md) §5.5. Reihenfolge ist
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
| Outbox-Karte (I1, 0.60.0) | Überschrift `Offline-Queue (Outbox)` + Badge `<n> offen` · `leer`; Satz `Belege und Vorsätze, die ohne Verbindung erfasst wurden, liegen hier, bis sie nachgereicht sind. …` — Endzustände `abgelehnt` · `abgelaufen` mit Fehlercode und Alter, nie still verworfen; Knöpfe `Outbox als JSON` · `Outbox als CSV` · `Abgeschlossene entfernen`; Zähler `<n> in der Historie`; nach dem Entfernen `<n> entfernt — der Nachweis bleibt im Export.`; Fußnote nennt IndexedDB-Name und 30-Sekunden-Takt |
| Header-Banner wartender Einträge (I1) | warn-Ton: `Ein Eintrag ist lokal vorgemerkt und geht raus, sobald die Verbindung steht.` (Plural: `<n> Einträge sind …`), bei offenem Eintrag älter als eine Stunde angehängt `Der älteste wartet seit <Alter>.`; nur Endzustände: `Die Outbox hat sichtbare Endzustände.`; Note: `Nichts ist verloren; die Einträge liegen im Browser.` + `… abgelehnt oder abgelaufen — sichtbar unter „System“ → Diagnose.` |
| API | bleibt `/api/v1` — ein v2-Baum wird nicht erfunden |
| Weg in die Tiefe | `Warum?` öffnet Ebene 1, `Im Labor vertiefen` springt in den Labor-Abschnitt |

### 4e. Tooltips ergänzen, sie erklären nicht

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

### 4f. Push-Texte: Alarme und Fenster-Meldungen

Push-Texte entstehen serverseitig (`app/notify.py`) — für sie gelten
dieselben Regeln wie für die GUI: Zahlen über die Formatter (de-DE,
„1,719 €/L“, „18:00 Uhr“ in Europe/Berlin), keine erfundenen Werte,
„…“-Anführungen, kurzer handlungsleitender Ton. Zwei Meldungsarten, zwei
Datentiefen (O42):

| Art | Inhalt | Wann |
|---|---|---|
| Alarm (`severity: error`) | nur Code, deutscher Klartext, App-Version — nie Preise, Stationen, Pfade | Zustandswechsel, Erinnerung nach 6 h, „wieder betriebsbereit“ |
| Fenster „offen“ | Modus `public`: neutraler Satz ohne Details · Modus `lan`: Station, Fensterzeit, erwarteter Preis | genau einmal je Episode beim Öffnen (Verteilungs-P ≥ Schwelle) |
| Fenster „geändert“ | dieselbe Regel wie „offen“ | Empfehlung kippt auf ein anderes Fenster |
| Fenster „verstrichen“ | neutraler Satz (`public`) bzw. Fensterzeit und Station (`lan`) | Fenster schließt ohne Beleg — nur, wenn es vorher gemeldet war |

Koordinaten, Pfade und Links stehen in **keinem** Modus. Die Ruhezeit
(22–7 Uhr, Europe/Berlin) gilt nur für Fenster-Meldungen; Alarme kommen
rund um die Uhr. Geprüft von `tests/test_notify.py` und
`tests/test_o29_window_push.py`.

### 4g. Belegmaske und Diagramm-Beschreibungen

Zwei Stellen, an denen Text **Zahlen** trägt, die sonst nur als Bild oder als
vorbefülltes Feld existieren. Regel für beide: Die Zahl kommt aus derselben
Quelle wie die Darstellung, läuft durch die Formatter aus §3 — und wo keine
Quelle ist, steht auch keine Zahl.

| Stelle | Muster |
|---|---|
| Live-Preis an der Belegmaske (O32) | `Jetzt an der Station: 1,719 €/L, gemeldet vor 3 Minuten.` — Niveau in €/L, Alter über `ageWord`. Ohne belegbares Alter (weder `observed_at` noch `age_minutes`) endet der Satz nach dem Preis; ohne frischen Preis steht gar nichts da |
| Abweichung der Eingabe (O32) | `Deine Eingabe liegt 3,0 ct/L über dem gemeldeten Preis — gebucht wird, was du eingibst.` — Differenz in ct/L (§3), Richtung `über`/`unter`, Schwelle 1,0 ct/L (`PRICE_DRIFT_CT`). Der Halbsatz nach dem Gedankenstrich bleibt: Die App korrigiert den Beleg nicht |
| Textalternative eines Diagramms (O40) | Ein Satz mit Werten, nicht mit Reihennamen: `Liniendiagramm. Erwarteter Preis fällt von 1,780 €/L auf 1,710 €/L, Tief 1,690 €/L.` Gebaut in `web/src/chartAlt.ts` aus denselben Punkten, die gezeichnet werden |
| Diagramm ohne Daten | `Liniendiagramm ohne Werte.` — nie eine gerundete Null, nie „0,000 €/L“ |
| `aria-label` eines Diagramms | benennt **dieses** Diagramm, nicht die Gattung: `Prognose-Fächer` · `Versprochen gegen eingetroffen` · `Preis-Abstand je Station · Frankfurt` · `Tageskurve der Backtest-Zeile` · `Preisverlauf der Station`. „Diagramm“ allein ist verboten — im Labor liegen vier in einer Ansicht |

Die Textalternative nennt Tief und Hoch nur, wenn sie **nicht** die Endpunkte
sind (sonst stünde dieselbe Zahl dreimal), und sie beschreibt nie die Farbe:
„grün = positiv“ hilft genau dem nicht, der die Beschreibung liest — gezählt
werden stattdessen die Seiten und die Ausreißer mit Namen. Geprüft von
`web/src/chartAlt.test.ts` und dem O40-Block in `web/src/a11y.test.ts`, die
Belegmaske von `web/src/fills.test.ts` und `web/src/views/Ich.test.tsx`.

## 5. Zustände: leer, lädt, Fehler

| Zustand | Baustein | Regel |
|---|---|---|
| lädt (erstes Mal) | `components/Skeleton.tsx` — `SkeletonPanel`, `SkeletonChart`, `SkeletonRows` | Hält den Platz des künftigen Inhalts. `role="status"` + `aria-busy`, Label „<Sache> wird geladen/berechnet“ nur für Screenreader |
| lädt (Aktualisierung) | **nichts** | Vorhandene Zahlen bleiben stehen. Ein Poll darf die Ansicht nicht leeren — sonst flackert sie im Takt |
| Datenstand veraltet | `components/DataAge.tsx` (`dataAgeNote`) | Nur wenn der Stand die Schwelle reißt (Preise 30 min, Modell 24 h = 1440 min — seit B5: kurze 180 min markierten ein gesundes System stur „alt“, Selektion 36 h; doppelt = roter Ton). Bei unbekanntem Stand: **kein** Banner |
| leer, weil noch nichts da | `Empty` | „Noch kein/e <Sache>.“ + was fehlt. Kein Alarm-Ton, kein „Erneut laden“ |
| leer, weil bewusst nichts | `Empty` | Grund nennen, nicht entschuldigen: „Fehlende Tage, kein Datenverlust.“ |
| Fehler (Panel) | `components/LoadError.tsx` | `problem(error_code)` als Klartext, Rohcode darunter, Knopf „Erneut laden“ |
| Fehler (Tabelle) | `components/CellError.tsx` | Gleiche Sprache als Tabellenzeile über die volle Breite; `empty` trennt „nichts da“ von „fehlgeschlagen“ |
| keine Zahl bestimmbar | `—` (Geviertstrich) | Nie `0`, nie leer |
| Job abgebrochen (0.21.0) | `components/JobCard.tsx` („Abgebrochen“) + `messages[\"aborted\"]` | Zustand benennen, keine Schuld: „Der Lauf wurde abgebrochen (z. B. durch einen Container-Neustart). Letzte Ergebnisse bleiben erhalten.“ |
| Job unvollständig (0.21.0) | `components/JobCard.tsx` („Unvollständig“) + `messages[\"some_models_unavailable\"]` | Sache statt Tadel: „Einige Stationen haben noch kein neues Modell. Vorige Ergebnisse sind gekennzeichnet.“ |

Ein Panel erfindet keinen eigenen Fehlertext: Klartexte stehen zentral in
`messages` in `web/src/data.ts`, je `error_code` genau einer.

### 5a. Wortlaut je Zustand

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

### 5b. Meldungen: ein Register, ein Rang

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

### 5c. „Set“ ist Betriebssprache

Das **Polling-Set** ist die Liste der Stationen, die der Collector abfragt —
ein Begriff aus der Einrichtung. In „System“ und „Labor“ ist er richtig: Wer
dort liest, richtet ein oder prüft nach, und §6 lässt für diese Fläche
ausdrücklich Betreibersprache zu.

Auf den Alltagsschirmen („Jetzt“, „Stationen“, „Ich“) steht er nicht mehr. Wer
nur tanken will, liest „Spanne im Set: 4,4 ct/L“ und hat kein Bild davon,
welche Menge gemeint ist — erklärt wurde das Wort nirgends, im Glossar stand
es nicht. Die Fläche benennt sich jetzt selbst:

| Statt | Jetzt |
|---|---|
| `Spanne im Set: <5,0> ct/L` | `Günstigste bis teuerste: <5,0> ct/L` |
| `die Spanne im Set beträgt <5,0> ct/L` | `zwischen günstigster und teuerster Station liegen <5,0> ct/L` |
| `Keine Station im Set` | `Noch keine Station eingerichtet` |

Das ist zugleich genauer: Gerechnet wird über die Stationen mit **offenem
Preis**, nicht über alles, was im Polling-Set steht.

### 5d. Ein Zustand, eine Zahl

Wenn ein Text eine Automatik beschreibt, nennt er den Wert **dieser
Automatik** — nicht den gerade gerechneten. Beides fällt nur zusammen,
solange die Automatik aktiv ist; sobald jemand einen festen Wert setzt,
laufen die Zahlen auseinander und der Text behauptet zwei Dinge zugleich.

Gefunden in 0.55.0 unter „Ich“ → „Fahrzeug“: Der Schalter zeigte
`Auto (12 €/h · Nebenzeit)`, direkt darunter stand `0 = Auto: 10 €/h — gerade
Nebenzeit`. Zwölf kam aus dem Profil, zehn aus der Uhrzeit-Regel; „Auto“ stand
an beiden. Dieselbe Verwechslung steckte in der Auswahl unter „Stationen“ —
die Auto-Option warb mit einer Zahl, die sie nie liefert.

| Statt | Jetzt |
|---|---|
| `Auto (${timeValueUsed} €/h)` | `Auto (${autoZ.z} €/h)` |
| `0 = Auto: <x> €/h — gerade Nebenzeit.` (immer) | `Fester Wert. Mit 0 rechnet die App nach Uhrzeit — gerade wären das <x> €/h (Nebenzeit).` bei gesetztem Wert |

Regel: `timeValueUsed` ist der Wert, mit dem **gerechnet** wird — er gehört in
Sätze über das Ergebnis. `autoZ.z` ist der Wert, den die **Automatik**
ergäbe — er gehört in jeden Satz, in dem das Wort „Auto“ vorkommt. Ein
Hinweis, der einen nicht aktiven Zustand beschreibt, sagt das im Konjunktiv
(„gerade wären das …“), statt ihn im Präsens zu behaupten.

Geprüft in `web/src/microcopy.test.ts` („„Auto“ zeigt den Automatik-Wert“).

## 6. Was nie im Text steht

- **Erfundene Zahlen.** Keine Demo-Preise, keine Platzhalter-Prozentwerte,
  keine „ca.“-Werte ohne Rechnung dahinter (Ehrlichkeits-Regel, Konzept §0.4).
- **Pfade, Tokens, URLs, Koordinaten.** Auch nicht in Alarm-Pushes: die
  ntfy-Nachricht trägt nur Alarm-Code, deutschen Klartext und App-Version.
  Fenster-Meldungen (O29) richten sich nach dem Push-Modus (§4f): im Modus
  `lan` dürfen sie Station, Fensterzeit und erwarteten Preis nennen —
  Koordinaten und Pfade bleiben in beiden Modi verboten.
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
