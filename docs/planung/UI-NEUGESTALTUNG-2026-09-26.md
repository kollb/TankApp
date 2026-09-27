# UI-Neugestaltung — Konzept (umgesetzt am 26.09.2026)

> Stand: 26.09.2026 · Design-Entwurf, Kern am 26.09.2026 umgesetzt
> (Urteilstöne, Gültigkeits-Chip, abgelaufene Freigabe, S1-Texte,
> Lesemodus auf dem RP2). Beschreibt die konzeptionelle Darstellung,
> das Layout und die Microcopy für die beiden Haupt-States
> **Normal Guide** (volle Datenlage) und **Fallback** (reduzierte
> Datenlage bzw. NAS nicht erreichbar).
> Grundlage: [Konzept](../produkt/KONZEPT.md), [UI](../produkt/UI.md),
> [Microcopy](../produkt/MICROCOPY.md), [Mockup](../../ui-neuentwurf-mockup/index.html).
> Alle Beispieldaten sind erfunden und dienen nur dem Layout.

## Inhaltsverzeichnis

- [1. Befund: Was heute nicht trägt](#1-befund-was-heute-nicht-trägt)
- [2. Fünf Kernentscheidungen](#2-fünf-kernentscheidungen)
- [3. Farbe und Signalik](#3-farbe-und-signalik)
- [4. Wireframe Normal Guide](#4-wireframe-normal-guide)
  - [4a. Startseite „Jetzt“](#4a-startseite-jetzt)
  - [4b. „Woche“](#4b-woche)
  - [4c. „Stationen“](#4c-stationen)
  - [4d. „Mehr“: Labor, Ich, System, Glossar](#4d-mehr-labor-ich-system-glossar)
- [5. Wireframe Fallback](#5-wireframe-fallback)
  - [5a. Zwei Achsen: Bereitschaft und Infrastruktur](#5a-zwei-achsen-bereitschaft-und-infrastruktur)
  - [5b. Bereitschaftsleiter S0–S3](#5b-bereitschaftsleiter-s0s3)
  - [5c. Lesemodus: NAS nicht erreichbar (RP2)](#5c-lesemodus-nas-nicht-erreichbar-rp2)
  - [5d. Übergangsregeln](#5d-übergangsregeln)
- [6. Wording und Microcopy](#6-wording-und-microcopy)
- [7. Material-3-Komponentenkarte](#7-material-3-komponentenkarte)
- [8. Vom Modell zum Indikator](#8-vom-modell-zum-indikator)
- [9. Entscheidungen bei der Umsetzung](#9-entscheidungen-bei-der-umsetzung-26092026)

## 1. Befund: Was heute nicht trägt

Die vorhandenen Bausteine sind richtig (Antwort → Begründung → Beweis,
3+1-Navigation, genau drei Fakten in fester Reihenfolge, Skelette statt
Falsch-Aussagen). Was blockiert:

1. **Die Entscheidung liest sich wie ein Formular.** Zahlen stehen ohne
   klare, farbgebende Handlungsaussage zuerst. Der Nutzer muss selbst
   aus ct/L, Fenstern und Schwellen die Antwort ableiten.
2. **Komplexität leckt in den Alltag.** Kalibrierungs-Etiketten
   („24h kalibriert (PIT), 3/7d unkalibrierte Szenarioprognose“) und
   Betriebsbegriffe stehen auf Alltagskarten. Das Modell ist für den
   Nutzer nicht sichtbar — korrekt — aber die *Sprache* des Modells
   ist es.
3. **Der Fallback wirkt wie eine Notfall-Konsole.** Die RP2-Oberfläche
   ist eine andere App (anderer Look, andere IA) und keine reduzierte
   Edition desselben Produkts. Der Nutzer merkt sofort, dass etwas
   „kaputt“ ist, obwohl die Daten weiterkommen.
4. **Zustände sind technisch benannt.** `decision_ready=false`,
   `blocking_reasons`, Outbox-Status — verständlich für den Betrieb,
   nicht für den Tankenden.

Ziel dieses Entwurfs: Die App beantwortet in einer Sekunde die Frage
„Was soll ich jetzt tun?“ — und alles, was diese Antwort nicht ist,
liegt eine Ebene tiefer, aber greifbar.

## 2. Fünf Kernentscheidungen

1. **Eine Antwort an der Spitze.** Die Startseite beginnt mit genau
   einer Entscheidungs-Karte (M3 Elevated Card): Urteil + eine Zahl +
   ein Satz Begründung + ein Gültigkeitsende. Sie ist die einzige
   Karte der Seite mit voller Elevation — alles andere ist flacher.
2. **Komplexität wird übersetzt, nicht versteckt.**
   Wahrscheinlichkeitsverteilungen werden zu Signalwörtern und
   Fortschrittsbalken, Prognosebänder zu „eng“/„breit“-Sätzen,
   Kalibrierung zu Label-Chips. Die Evidenz (Kurve, Modell, Güte) ist
   einen Tap entfernt (Bottom Sheet, Labor) — sie taucht aber nicht
   ungefragt auf.
3. **Farbe ist Bedeutung.** Jedes Urteil hat Farbe und Icon: Grün =
   jetzt tanken, Blau = warten bis Fenster, Rot = echtes Risiko
   (Tank fast leer, Fenster verpasst), Grau = keine Empfehlung
   (ehrliche Zurückhaltung), Amber = Zeitlimit/Datenalter.
   **Entscheidung zum Vorschlag „Rot = Warten“:** Rot bleibt dem
   echten Risiko vorbehalten. „Warten“ ist die Geld sparende
   Empfehlung — ein rotes Warten liest sich wie eine Warnung vor der
   eigenen Empfehlung. Die Deutlichkeit des Vorschlags ist gewahrt,
   weil jedes Urteil eigenständig gefärbt und ikonisiert ist.
4. **Fallback ist keine Fehleranzeige, sondern eine Edition.**
   Gleiche Marke, gleiche Spitzenkomponenten, ruhiger Status-Banner,
   reduzierte IA, ehrliches Datenalter. Der Lesemodus auf dem RP2 ist
   die „Leseausgabe“ derselben App.
5. **Alles folgt dem Microcopy-Regelwerk.** Ehrlich, knapp,
   handlungsleitend; kein „du“, kein Imperativ im Fließtext, kein
   Ausrufezeichen, keine erfundene Sicherheit. Neue Sätze aus §6 sind
   regelwerkskonform formuliert und kandidaten für das Ratchet-Test.

## 3. Farbe und Signalik

Semantische Rollen auf M3-Tonal-Containern (Light und Dark, Material-You-
Seed von der Markenfarbe):

| Semantik | M3-Rolle | Einsatz | Beispiel |
|---|---|---|---|
| Jetzt tanken | primary (grün tonal) | Entscheidungs-Karte, primärer Button | „Jetzt tanken — 4,2 ct/L unter Tagesmedian.“ |
| Warten bis Fenster | tertiary (blau/teal tonal) | Entscheidungs-Karte | „Warten — Fenster 18–20 Uhr, bis zu 1,80 € gespart.“ |
| Echtes Risiko | error (rot tonal) | „Warten riskant“, Tank-Reserve untergrenze | „Warten riskant — Rest reicht für 60 km.“ |
| Zeitlimit, Alter, Lernphase | warning (amber tonal) | Alter-Chips, Lernkarte, veraltete Prognose | „vor 3 h“, „Tag 12 von ~30“ |
| Keine Empfehlung | neutral (surface tonal, grau) | Entscheidungs-Karte Stufe C / gesperrt | „Keine klare Empfehlung heute.“ |
| Modellwissen | violett | nur im Labor | Labor-Akzent, Beweis-Links |
| Information, Vergleich | blau (info) | Vergleich, Stationsdetails | Umweg-Rechnung |

Regeln:

- **Icon und Farbe tragen den Ton** — kein `✓`/`!`-Präfix (Regel V4).
- **Rot ist kein Zustand, sondern ein Risiko.** Es erscheint nie als
  Dekor, nie für „nur“ Wartungszustände wie Lernphase oder Sperrung.
- **Grau ist keine Strafe.** „Keine Empfehlung“ ist ein regulärer
  Produktzustand und wird ohne Alarmfarbe, aber mit Grund und
  nächstem Schritt dargestellt.
- **Eine Elevation, eine Bedeutung:** Nur die Entscheidungs-Karte
  schwebt (Elevation 3); Fakten- und Info-Karten sind flach
  (Elevation 0–1, Tonal). Der Blick landet automatisch oben.

## 4. Wireframe Normal Guide

Der Normal Guide ist die App bei voller Datenlage (S3). Die
Navigation bleibt **Jetzt · Woche · Stationen · Mehr** (Bestand,
URLs und Gewohnheiten bleiben). Neu ist, was die Karten tragen.

### 4a. Startseite „Jetzt“

Aufbau von oben nach unten (390 px; Scrolltiefen-Budget der
„Jetzt“-Sektion: 1,5 Viewports bei 390 × 844, Bestand):

```text
┌────────────────────────────────────────────────┐
│ ① Top App Bar (sticky)                         │
│    TankApp      [Gütersloh · E10 ▾]     ● 2 min│
├────────────────────────────────────────────────┤
│ ② ENTSCHEIDUNG (Elevated Card, tonal)  ← 1 s   │
│    ■ Jetzt tanken                               │
│    4,2 ct/L unter Tagesmedian —                 │
│    bis zu 1,80 € gespart bei 40 L               │
│    „Der Preis fällt am Nachmittag meist —      │
│     in 28 der letzten 30 Tage war es so.“       │
│    [gültig bis 17:45] [Warum?] [Route]          │
├────────────────────────────────────────────────┤
│ ③ DREI FAKTEN (Tonal Card, drei Zeilen)        │
│    Jetzt hier        1,709 €/L · Shell · offen │
│    Bestes Fenster    18–20 Uhr · −4,2 ct/L     │
│    Tank reicht?      ¾ · ca. 280 km            │
├────────────────────────────────────────────────┤
│ ④ HEUTE IM BLICK (Card, Tagesstreifen)         │
│    06─ mittel ▓▓ mittel ▓▓▓ günstig ▓▓ günstig─24│
│    ▲ jetzt                        [Details ⌄]  │
├────────────────────────────────────────────────┤
│ ⑤ UMWEG (Card, F2)                             │
│    Freie Tankstelle · 5,2 km                    │
│    5,0 ct/L günstiger → netto +1,95 €           │
│    [Rechnung] [Route]                           │
├────────────────────────────────────────────────┤
│ ⑥ ZEIT-TEASER (Text Button, F3)                │
│    Zwei günstige Fenster bis Donnerstag →       │
├────────────────────────────────────────────────┤
│ ⑦ FUSNOTE (Caption)                            │
│    Quelle: Tankerkönig · Empfehlung gültig      │
│    bis 17:45 · Details im Labor                 │
└────────────────────────────────────────────────┘
```

Element-für-Element:

- **① Top App Bar (Small, sticky).** Marke links, Kontext-Chip
  „Gütersloh · E10“ (Filter-Chip; öffnet Bottom Sheet mit Stadt und
  Kraftstoff), rechts ein Datenalter-Indikator (Punkt + „2 min“,
  grün/amber) und — nur bei aktiven Alarmen — die Alarm-Pille
  (Bestand). Der Kontext-Chip ist der einzige permanente
  Steuerelement im Kopf; alles andere ist Inhalt.
- **② Entscheidungs-Karte — die eine Sekunde.** Tonaler Hintergrund
  in der Urteil-Farbe (§3), Elevation 3. Reihenfolge innerhalb:
  **Urteil (Display)** → **eine handlungsrelevante Zahl (Headline)**
  → **ein Satz Begründung (Body, Plain Language)** → **Gültigkeits-
  Chip + Aktionszeile**. Variantenvollständig:

  | Situation | Urteil (Display) | Zahl/Zweite Zeile |
  |---|---|---|
  | Preisvorteil jetzt | Jetzt tanken | „4,2 ct/L unter Tagesmedian — bis zu 1,80 € gespart.“ |
  | Tankrest niedrig | Jetzt tanken | „Rest reicht noch für 60 km.“ |
  | Fenster kommt | Warten | „Fenster 18–20 Uhr — bis zu 1,80 € gespart.“ |
  | Warten blockiert | Warten riskant | „Rest reicht nur für 60 km — jetzt tanken lohnt nicht, wenn das Fenster leer bleibt.“ |
  | Keine Empfehlung | Keine klare Empfehlung | „Günstigster offener Preis: 1,709 €/L bei Shell.“ (Fakt, das auch ohne Modell gilt) |
  | Abgelaufen | Empfehlung abgelaufen | „Die Empfehlung ist abgelaufen — neu berechnet wird automatisch. Preise und Fakten bleiben sichtbar.“ + „Empfehlung neu laden“ |
  | Wird berechnet | Empfehlung wird berechnet … | (Skelett der Karte, keine Falsch-Aussage) |

  **Aktionszeile:** Tonal Button „Warum?“ (öffnet Bottom Sheet mit
  Begründung + Beweis, §7 — etabliertes Muster, MICROCOPY §4b
  „Ebene 1“) · Filled Button „Route“ (Navigation zur Station) ·
  Gültigkeits-Chip „gültig bis 17:45“ (neu, A21-B1.4).
- **③ Drei Fakten.** Bestehende `NowFact`-Reihe, feste Reihenfolge
  („Jetzt hier“ · „Bestes Fenster“ · „Tank reicht?“), je Label, Wert,
  eine Erklärzeile. Tonal Card, Elevation 0. Auf 390 px bleiben die
  drei nebeneinander (Bestand) — unter 360 px stapeln sie sich.
- **④ Heute im Blick.** Der Tagesstreifen (06–24 Uhr) bleibt
  zusammengeklappt (Bestand); „Details“ klappt Stundenwerte und das
  Prognoseband auf (Bottom Sheet statt Zweit-Karte). Segmente:
  günstig (primary-tonal) · mittel (neutral) · teuer (error-tonal,
  gedämpft). Der „jetzt“-Marker ist die einzige Linie.
- **⑤ Umweg (F2).** Genau **eine** beste Alternative als Card
  („Hier oder woanders?“ — die zweite vollständige Stationsliste
  bleibt in „Stationen“, Bestands-Abgrenzung). Netto-Vorteil =
  Preisvorteil × Tankmenge − Umwegkosten, als eine Zahl mit Vorzeichen
  und Button „Rechnung“ (Bottom Sheet mit Aufschlüsselung). Ist der
  Umweg nicht sinnvoll, trägt die Card den Satz statt der Buttons:
  „Umweg rechnet sich nicht — 2,10 € Sprit, ca. 4,00 € Zeit und
  Verschleiß.“
- **⑥ Zeit-Teaser (F3).** Einzeiler als Text Button mit Pfeil nach
  „Woche“: kündigt die nächsten Fenster an, ohne sie vorwegzunehmen
  („Zwei günstige Fenster bis Donnerstag →“). Ohne Fenster entfällt
  die Zeile — keine leere Karte.
- **⑦ Fußnote.** Caption: Quelle, Gültigkeit, Laboreinstieg. Klein,
  gedämpft, nie ein zweiter Banner.

Verhalten bei Zuständen auf der Startseite (Ausführliches in §5):
Laden → Skelett für Karte ②; veraltete Preise → Karte ② wird grau
(„Keine klare Empfehlung“ + Grund „Preise älter als 30 Minuten“),
Fakten bleiben sichtbar mit Alter-Chip; Empfehlung abgelaufen →
Variante „abgelaufen“; NAS weg → Übergang in den Lesemodus (§5c).

### 4b. „Woche“

```text
┌────────────────────────────────────────────────┐
│ Kopfzeile: Woche                    [¾ · bis Do]│
│ „Der Tank reicht locker bis Donnerstag.“       │
├────────────────────────────────────────────────┤
│ Tageskarte So (heute)                           │
│   Fenster 18–20 Uhr        [24-h-Fenster]      │
│   bis zu 1,80 € gespart                     ●  │
├────────────────────────────────────────────────┤
│ Tageskarte Mo                                  │
│   Fenster 19–21 Uhr        [Szenarioprognose]  │
│   bis zu 2,10 € gespart                     ●  │
├────────────────────────────────────────────────┤
│ Tageskarte Di                                  │
│   Kein Fenster                                    │
├────────────────────────────────────────────────┤
│ … (Mi–Sa)                                       │
└────────────────────────────────────────────────┘
```

- Kopfzeile: Tankreichweite als Satz („¾ · bis Do“), keine
  Prozent-Spielerei.
- **Eine Card pro Tag**, Listenzeile statt Zweit-Screen: Tag,
  Fenster-Chip (Zeitfenster) oder „Kein Fenster“, „bis zu X €
  gespart“ (Fenster-Vorteil, Bestands-Semantik: *bis zu* ≠ Median-
  Erwartung, beides bleibt unterscheidbar), Label-Chip
  „24-h-Fenster (kalibriert)“ nur heute, danach
  „Szenarioprognose“ — die Kalibrierung bleibt sichtbar, aber als
  kurzes Chip-Label statt Fußzeile-Begriffserklärung.
- Ausgefülltes Fenster-Icon = freigegebenes Fenster; umrissen =
  noch kein Fenster. Die **Sterne bleiben** (Entscheidungen bei der
  Umsetzung): Sie sind gemessen (P-Wert gegen Zufallsbasis,
  Tooltip mit Schwellen im Labor) — keine erfundene Konfidenz.
- Tagesdetails (Bottom Sheet): Medianlinie + Band, Textalternative
  mit Werten (Bestands-Pflicht), Gültigkeitsende.

### 4c. „Stationen“

- Filterzeile: Kraftstoff (Segmented Buttons), „nur offene“
  (Filter-Chip), Sortierung (Chip: Preis · Netto · Entfernung).
- Karte + Liste: Karte oben einklappbar; Liste unten (M3 List,
  dreizeilig): Name, Straße, Preis, Δ zur Referenz (Farbe nach
  Vorzeichen), „geöffnet bis 22 Uhr“, Mini-Verlauf (24 h, vorhanden
  bleibt im Detail — Bestands-Abgrenzung).
- **Vergleich:** Zwei Stationen anwählbar → Extended FAB
  „Vergleichen (2)“ → modaler Bottom Sheet: A/B-Reihe, Preis-Delta,
  Umweg-Rechnung, beide Verläufe übereinander.
- Stationsdetail: Tagesverlauf (Chart mit Textalternative),
  Datenqualität (letzter Poll, Lücken) — Betriebsdetails bleiben
  hier und in „System“, nicht auf Alltagskarten.

### 4d. „Mehr“: Labor, Ich, System, Glossar

Verantwortlichkeiten unverändert (Tabelle in `UI.md` gilt).
Konzeptuell rückt das **Labor als Beweis-Ebene** nach vorn: „Warum?“
auf der Entscheidungs-Karte springt mit Kontext in die passende
Labor-Karte (Antwort → Begründung → **Beweis** wird zur Navigation).
Labor-Subtabs bleiben vier (Übersicht, Modell & Parameter, Güte &
Kalibrierung, Daten & Rohdaten). (Entscheidung bei der Umsetzung:
keine FABs — „Stationen“ hat den etablierten Vergleichs-Modus A/B,
„Ich“ den Button „Tanken erfassen“. Ein zweiter Bedienkanal pro
Aktion würde die Taste-44- und Fokus-Prüfungen nur vergrößern,
ohne die Führung zu verbessern.) **System** bleibt der
einzige Ort für Betriebsbegriffe, Jobs, Outbox und die
Bereitschaftsanzeige („Bereitschaft: S3 von S3“).

## 5. Wireframe Fallback

### 5a. Zwei Achsen: Bereitschaft und Infrastruktur

„Fallback“ meint in dieser App zwei unterschiedliche Dinge, die UX-
technisch getrennt gelöst werden:

| Achse | Ursache | Oberfläche |
|---|---|---|
| **Bereitschaft (S0–S3)** | App läuft, Daten oder Modell-Reife fehlen | dieselbe App, die Entscheidungs-Karte trägt den Zustand |
| **Infrastruktur (Lesemodus)** | NAS nicht erreichbar | RP2-Oberfläche als reduzierte, lesende Edition desselben Produkts |

Grundprinzip der Graceful Degradation: **Die IA bleibt stabil, der
Inhalt wird reduziert.** Es gibt keinen „Fehler-Screen“ und keine
andere Navigation. Der Nutzer sieht immer dieselbe App — nur sagt
sie ehrlich, was sie gerade kann, was sie noch lernen muss und wann
wieder mehr kommt.

### 5b. Bereitschaftsleiter S0–S3

Stufen (Bestand aus Mockup und M7-Gate, nun als UX-Prinzip fixiert):

- **S0 — Einrichten** (keine Preise):
  Entscheidungs-Karte neutral: „Noch keine Preise — richten wir die
  App in 3 Schritten ein.“ Darunter eine nummerierte Schrittkarte mit
  Status je Schritt (erledigt/offen): „Stadt und Stationen —
  erledigt“, „Collector aktiv — erster Preis in ~5 Minuten“,
  „Datenstrom — beginnt mit dem ersten Preis“. Button „Status
  ansehen“ (nach System). Keine Demo-Preise, keine erfundene
  Ampel (Ehrlichkeits-Regel).
- **S1 — Lernen** (Preise live, M7-Gate offen):
  Entscheidungs-Karte grau: „Keine klare Empfehlung“ + der M7-Grund
  (Server, `m7_pending`): „Keine Empfehlung — die Kalibrierung steht
  noch aus. Die Preismeldungen sind unverfälscht, der Preisvergleich
  bleibt.“ Entscheidend: Die App ist in S1 bereits zu gutem Teil
  nützlich, und sie sagt das — der Lernsatz benennt den Zählstand
  **und** das Funktionierende: „Das Modell lernt noch — <n> von 100
  abgeschlossenen Empfehlungen. Vergleich und Umweg-Rechnung
  funktionieren bereits.“ (Drei Fakten, Tagesstreifen,
  Stationsvergleich und Umweg-Rechnung tragen sich mit Live-Preisen.)
- **S2 — Gesperrt** (frische Daten, Freigabekette nicht erfüllt,
  `decision_ready=false`):
  Entscheidungs-Karte grau: „Keine Empfehlung heute.“ + **eine
  begründende Zeile** (übersetzter `blocking_reason`,
  Plain Language, z. B. „Preise älter als 30 Minuten“ oder
  „Gültigkeit der Freigabe ist abgelaufen“) + „Nächster Modell-Lauf:
  heute 06:00 — die Entscheidung wird automatisch neu berechnet.“
  Der günstigste offene Preis bleibt als Fakt sichtbar (Bestand).
  Keine Ampel, keine erfundene Prozentzahl (Stufe C bleibt grau,
  Bestandsregel).
- **S3 — Voll** (Normal Guide, §4).

Die Leiter steht **einmal** sichtbar (System → „Bereitschaft: S2 von
S3“ mit je einem Wort je Stufe), nicht als permanenter Banner.
Zwischenstufen verändern sich automatisch — der Nutzer muss nie
„neu laden“ oder Stufen wählen.

### 5c. Lesemodus: NAS nicht erreichbar (RP2)

Die RP2-Oberfläche (Port 8000) wird zur **Leseausgabe derselben
Marke**: gleicher App-Name, gleiche Spitzenkomponenten, gleiche
Farbrollen — plus ein ruhiger Status-Banner. Kein rotes
Fehler-Konzert, kein anderer Look. Aufbau von oben nach unten
(mobil):

```text
┌────────────────────────────────────────────────┐
│ ① Top App Bar:  TankApp · Lesemodus            │
├────────────────────────────────────────────────┤
│ ② Status-Banner (Tonal, neutral/amber)         │
│    „NAS ist gerade nicht erreichbar.“          │
│    „Preise vom 26.09., 06:12 — zur             │
│     Orientierung, nicht zur Entscheidung.“     │
│    [Neu laden]                                 │
├────────────────────────────────────────────────┤
│ ③ PREISE (Card, Liste)                         │
│    Station · Kraftstoff · Preis · bis 22 Uhr   │
│    (je Zeile: Datenalter „2 h“)                │
├────────────────────────────────────────────────┤
│ ⑴ TAGESSTREIFEN (Card)                         │
│    „Letzter voller Tag: 25.09.“ + Streifen     │
├────────────────────────────────────────────────┤
│ ④ PROGNOSSE (Card, nur wenn Cache vorhanden)   │
│    „Letzter Modellstand: 25.09., 06:12.“       │
│    Fenster + Band, statisch, mit Label         │
│    „Seither keine neue Berechnung.“            │
├────────────────────────────────────────────────┤
│ ⑤ WOHER KOMMEN DIE DATEN (Card, Caption-Stufe) │
│    Collector: Pi · letztes Datum 06:12         │
│    NAS: offline · Cache: 25.09.                │
│    „Es wird weitergesammelt — der Collector    │
│     schreibt auch jetzt in den Puffer.“        │
│    (Klick auf den NAS-Status öffnet die        │
│     Vollversion, wenn sie bereit ist)          │
└────────────────────────────────────────────────┘
```

Regeln für den Lesemodus:

- **Keine Empfehlung, keine Aktion, keine Eingabe** — aber auch kein
  Fehlerbild. Der Banner ist Tonal (neutral bis amber), nie error-
  rot; Rot bleibt dem echten Risiko vorbehalten (§3).
- **Datenalter überall sichtbar**, nie versteckt: je Zeile und in
  Kartenkopf. Der Satz „zur Orientierung, nicht zur Entscheidung“
  ist die Ehrlichkeits-Zeile des gesamten Fallbacks.
- **Kein Cache für Prognosen?** Dann entfällt Karte ④ komplett —
  keine leere Karte, kein „keine Prognose“-Placeholder mit
  Fragezeichen.
- **Umschaltung ist ein Klick, kein Automatismus:** Der
  NAS-Status-Knopf prüft sofort neu; ein Klick öffnet die
  Vollversion. „Keine garantierte Umschaltzeit“ (Betriebs-Doku) —
  deshalb steht auch im Footer: „Es wird weitergesammelt — der
  Collector schreibt auch jetzt in den Puffer.“
- **Outbox taucht im Lesemodus nicht auf** (lesend, keine
  Erfassungen); die Outbox gehört zur Vollversion und wird dort
  weiterverarbeitet.
- Prognose-Cache zeigt **nur den letzten freigegebenen Stand** mit
  Stammeintrag — nie als aktuelle Empfehlung neu verpackt.

### 5d. Übergangsregeln

| Situation | Was der Nutzer sieht | Was technisch passiert |
|---|---|---|
| App startet, NAS erreichbar | Normal Guide | — |
| App startet, NAS down | Automatisch Lesemodus, gleicher Auftritt | RP2:8000 antwortet |
| NAS down, Preise altern weiter | Karte ② grau: „Keine Empfehlung — Preise älter als 30 Minuten.“ | Freigabekette sperrt (Bestand) |
| Empfehlung läuft ab (`valid_until`) | Karteninhalt wechselt zu „Empfehlung abgelaufen“ — kein Fehler, keine rote Fläche | Entscheidung wird neu berechnet |
| Verbindung weg (Browser), NAS ok | Snackbar: „Beleg lokal vorgemerkt — wird nachgereicht.“ (warn, `role="status"`) | Outbox (Bestand) |
| NAS zurück | Lesemodus-Banner verschwindet; Klick auf den NAS-Status öffnet die Vollversion | Nacherholung der NAS-Prüfung (zwei erfolgreiche Probes, Bestand) |
| Modell-Lauf in Lernphase | Lernkarte aktualisiert sich, Fortschritt wächst | M7-Gate (Bestand) |

Prinzip: **Übergänge sind Inhaltswechsel, keine Neuladungen und
keine Fehler.** Jede Zustandsänderung trägt ihren Ton (ok/warn/error
nach Regelwerk T2), aber der einzige Zustand, der „error“ ist, ist
ein echtes Scheitern (z. B. Upload fehlgeschlagen) — nicht das
Fehlen von Daten.

## 6. Wording und Microcopy

Alle Sätze sind regelwerkskonform formuliert (Tonalität: ehrlich,
knapp, handlungsleitend; keine Fragen außer Fällig-Prompt; Possessiv
erlaubt; Einschübe mit „—“; Zahlen über die Formatter).

### 6a. Urteile (Display der Entscheidungs-Karte)

| Situation | Wortlaut |
|---|---|
| Preisvorteil jetzt | Jetzt tanken — 4,2 ct/L unter Tagesmedian. |
| Tankrest niedrig | Jetzt tanken — Rest reicht noch für 60 km. |
| Fenster kommt | Warten — Fenster 18–20 Uhr, bis zu 1,80 € gespart. |
| Warten blockiert | Warten riskant — Rest reicht nur für 60 km. |
| Keine Empfehlung | Keine klare Empfehlung heute. |
| Abgelaufen | Empfehlung abgelaufen — neu um 18:00. |
| Wird berechnet | Empfehlung wird berechnet … |

### 6b. Begründung (ein Satz, Plain Language)

- „Der Preis fällt am Nachmittag meist — in 28 der letzten 30 Tage
  war es so.“
- „Das Fenster 18–20 Uhr lag in 26 der letzten 30 Tage unter dem
  Vormittagspreis.“
- „Umweg rechnet sich nicht — 2,10 € Sprit, ca. 4,00 € Zeit und
  Verschleiß.“
- „Keine Empfehlung heute: Preise älter als 30 Minuten.“
- „Keine Empfehlung heute: Gültigkeit der Freigabe ist abgelaufen.“
- „Das Modell lernt noch — <n> von 100 abgeschlossenen
  Empfehlungen. Vergleich und Umweg-Rechnung funktionieren
  bereits.“ (umgesetzt; `n` = M7-Gate-Schnitt `gate_n`)

### 6c. Status-Indikatoren (Chips, Punkt + Text)

| Indikator | Wortlaut |
|---|---|
| Daten frisch | „2 min“ (grüner Punkt) |
| Daten veraltet | „3 h“ (amber Punkt) |
| Lesemodus | „Lesemodus“ |
| Lernphase | „Das Modell lernt noch — <n> von 100 abgeschlossenen Empfehlungen.“ (umgesetzt) |
| Collector still | „Collector meldet seit 2 Stunden nichts.“ |
| Empfehlung gültig | „gültig bis 17:45“ |
| Kein Fenster | „Kein Fenster“ |

### 6d. Buttons und Aktionen

(Implementierter Stand — keine FABs, bestehende Wege bleiben.)

- **Warum?** (Entscheidungs-Karte; öffnet Begründung + Beweis)
- **Route** (Navigation zur Station)
- **Empfehlung neu laden** (abgelaufene Freigabe)
- **Einrichtung starten** (S0)
- **Neu laden** (Lesemodus, Fehlerzustände)
- Vergleich: Modus **A gegen B** in „Stationen“ (statt FAB)
- **Tanken erfassen** (Button in „Ich“, statt FAB)

### 6e. Fallback- und Lesemodus-Texte

(Im RP2 umgesetzt — Wortlaut in `rp2/fallback_gui.py`, fixiert in
`tests/test_rp2_fallback.py`.)

- Status-Banner: „NAS ist gerade nicht erreichbar — die Preise zeigen
  den letzten gemeldeten Stand. Zur Orientierung, nicht zur
  Entscheidung.“ (ohne Konfiguration: „NAS ist nicht konfiguriert —
  diese Ansicht zeigt lokale Preise. Zur Orientierung, nicht zur
  Entscheidung.“)
- Badge: „Lesemodus · RP2“
- Footer: „Es wird weitergesammelt — der Collector schreibt auch
  jetzt in den Puffer.“
- Prognose-Cache-Label: „Letzter Modellstand — seither keine neue
  Berechnung.“
- S0-Karte (Web-App): „Noch keine Preise — richten wir die App in
  3 Schritten ein.“

### 6f. Leerzustände

- S0: „Noch keine Preise — richten wir die App in 3 Schritten ein.“
- S1: „Das Modell lernt noch — <n> von 100 abgeschlossenen
  Empfehlungen. Vergleich und Umweg-Rechnung funktionieren
  bereits.“ (umgesetzt)
- Keine offene Station: „Keine Station ist gerade geöffnet. Die
  nächste öffnet um 06:00.“
- Kein Fenster diese Woche: „Diese Woche kein günstiges Fenster —
  der Tagesstreifen zeigt die beste Zeit.“
- Kein Beleg: „Noch keine Belege. Der erste Beleg beginnt die
  Bilanz.“

### 6g. Snackbars (Aktion-Rückmeldung, je eine Zeile)

- ok: „Beleg in der Bilanz verbucht.“
- warn (offline): „Beleg lokal vorgemerkt — wird nachgereicht.“
- ok (Rückkehr): „Wieder vollständig — neue Daten seit 07:12.“
- error (echtes Scheitern): „Speichern fehlgeschlagen: …“ +
  Aktion „Neu laden“ (`role="alert"`)

### 6h. Rich Tooltips (Fachwort-Ebene, ergänzen nicht erklären)

- „Fachwort: Cheap-Probability — der Anteil der Modell-Szenarien,
  in denen der Preis unter dem aktuellen Niveau fällt.“
- „Fachwort: PIT-kalibriert — die 24-h-Prognose wurde gegen echte
  Treffer nachjustiert; längere Zeiträume sind Szenarien.“

## 7. Material-3-Komponentenkarte

| Funktion | M3-Komponente | Hinweis |
|---|---|---|
| Marke, Kontext, Datenalter | Small Top App Bar (sticky) | Kontext-Chip öffnet Bottom Sheet |
| Entscheidung | **Elevated Card** (einzige Elevation 3) | Tonal nach Urteil; Skelett beim Laden |
| Drei Fakten, Heute im Blick, Umweg | Filled/Tonal Card (Elevation 0–1) | flach, Gruppe ohne Schweben |
| Primäraktion | Filled Button | Farbe folgt dem Urteil (grün/blau) |
| Sekundäraktion | Tonal Button | „Details“, „Rechnung“ |
| Tertiär | Text Button | Zeit-Teaser nach „Woche“ |
| Kontext, Filter | Filter-Chips, Segmented Buttons | Stadt/Kraftstoff, „nur offene“, Sortierung, Tank ¼/½/¾/voll |
| Begründung + Beweis | **Standard Bottom Sheet** | „Details“ — Reihenfolge Antwort, Begründung, Chart |
| Stationsvergleich | **Modal Bottom Sheet** | A/B + Umweg-Rechnung |
| Kontextabhängige Hauptaktion | **Extended FAB** (einer pro Screen) | Stationen: „Vergleichen (2)“ · Ich: „Beleg erfassen“ |
| Kurz-Rückmeldung | **Snackbar** | ok/warn/error, je eine Zeile, `role="status"`/`"alert"` |
| Dauerzustand | **Banner** (M3, Tonal) | Lesemodus, Lernphase, Sperrung — kein Snackbar |
| Lernphase, Abdeckung | Linear Progress (determiniert) | „Tag 12 von ~30“ |
| Laden | **Skelette** (Shimmer) | Karte ② als Skelett; keine Spinner-Fläche |
| Kurz-Laden (Aktion) | Circular Progress Indicator | nur in Buttons |
| Zerstörend | Dialog | „Beleg löschen?“ — einziger Dialog im Alltag |
| Fachwort | **Rich Tooltip** | „Fachwort: …“ |
| Stationsliste | M3 List (dreizeilig) | Preis, Δ, Öffnungszeiten |
| Leerzustand | Card mit Icon + Headline + Aktion | Zustand benennen, nächsten Schritt nennen |
| Theme | Material You (Light/Dark) | Seed Markenfarbe; semantische Tonal-Container |
| Motion | Elevation + Fade (100–200 ms) | Urteilswechsel: Karten-Tonal verblasst zur neuen Farbe |

Bewusst **nicht** verwendet: Large FAB (verwässert die eine
Kontextaktion), App-Bar-Suche (Stations-Suche im Listenkopf),
infinite Bottom Sheets, zweifarbige Snackbar-Flächen, Fortschritts-
Spinner als Dauerzustand.

## 8. Vom Modell zum Indikator

| Was die Engine berechnet | Was der Nutzer sieht | Wo das Detail |
|---|---|---|
| Bootstrap-Pfade, Quantile | Tagesstreifen (eng/breit), Fenster-Chip | „Details“ → Band-Chart |
| `p_besser` (Draw-Anteil) | Signalwort („gut“/„eher gut“) — **nur in Stufe A**, sonst gar keines | Labor → Güte |
| Median + Band (24 h, PIT) | „Fällt nachmittags um 4,2 ct“ + Streifen | „Details“ |
| 72-/168-h unkalibriert | Label-Chip „Szenarioprognose“ | Wochen-Karte |
| `decision_ready=false` + `blocking_reasons` | graue Karte + ein deutscher Grund-Satz | System: Vollliste |
| `valid_until` | Chip „gültig bis 17:45“; in den letzten 30 Min Countdown | Entscheidungs-Karte |
| M7-Gate-Fortschritt | „Tag 12 von ~30“ + Balken | Lernkarte, Labor |
| Regime, Modellvertrag, Fit-ID | im Alltag unsichtbar | Labor, System |

Faustregel: **Zahlen, die Handeln tragen, stehen an der Spitze;
Zahlen, die erklären, stehen im Bottom Sheet; Zahlen, die beweisen,
stehen im Labor.**

## 9. Entscheidungen bei der Umsetzung (26.09.2026)

1. **Blau statt Rot für „Warten“** — angenommen und umgesetzt:
   `wait` → `tone: "blue"` (now.ts), rot nur bei
   `tank.blocks_wait` („Warten riskant“).
2. **S2-Sperrgründe auf der Startseite** — eine Grundzeile: die
   graue Karte zeigt den Server-Grund (`reason_short`), mehr nicht;
   die Volliste bleibt in „System“. Bestand, unverändert bestätigt.
3. **Lesemodus-Technik** — Beibehaltung der Python-GUI
   (`rp2/fallback_gui.py`) mit übernommener Signalik: Marke/Badge
   („Lesemodus · RP2“), Selbstbenennungs-Banner, Footer-Satz
   „Es wird weitergesammelt“. Eine React-Build für den RP2 bleibt
   offen — erst wenn die RP2-Ressourcen (CPU, RAM) ein Vite-Bundle
   tragen, lohnt der Wechsel; die Signalik ist seither
   technologie-unabhängig festgelegt.
4. **Umschaltung Lesemodus → Vollversion** — ein Klick auf den
   NAS-Status (zwei erfolgreiche Probes), kein Automatismus:
   „keine garantierte Umschaltzeit“ ist ein Betriebsversprechen.
5. **Ratchet** — umgesetzt: Urteilstöne + Chips + Gültigkeits-Chip
   + abgelaufene Freigabe in `now.test.ts`, fixe Muster in
   `MICROCOPY.md` (§4a/§4b), neue Prüfungen in `microcopy.test.ts`
   (Chips, abgelaufene Headline, `timeOfDayLabel`), Lesemodus-Satz
   fixiert in `tests/test_rp2_fallback.py`.
6. **Sternen-Rating in „Woche“ bleibt** — gemessener P-Wert gegen
   Zufallsbasis mit Tooltip; keine erfundene Konfidenz (Korrektur
   zum Entwurf, der Sterne ausschließen wollte).
7. **„Warum?“ bleibt der Knopf** (etabliertes Muster, MICROCOPY
   §4b „Ebene 1“) — Korrektur zum Entwurf, der „Details“ vorschlug.
8. **Keine FABs** — bestehende Wege bleiben (Vergleichs-Modus A/B
   in „Stationen“, Button „Tanken erfassen“ in „Ich“).
