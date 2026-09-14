# TankApp GUI-Neuentwurf — Gesamtkonzept

> Stand: 13.09.2026, aktualisiert 14.09.2026 · Status: **Entwurf, bewusst unabhängig vom Bestand** · Die Entscheidungen aus der Mockup-Runde 1 (14.9.) sind eingearbeitet (§18).
> Dieses Dokument hinterfragt alles Bisherige (Tabs, Modi, Regeln, APIs) und
> entwirft die GUI neu — mit einem Ziel: **informativ, strukturiert und für
> Nicht-Mathematiker lernbar**, ohne die Mathematik zu verstecken oder zu
> verwässern. Es ersetzt weder [KONZEPT.md](KONZEPT.md) noch
> [MICROCOPY.md](MICROCOPY.md), sondern ist eine Diskussionsvorlage dafür, wie
> die GUI in der nächsten großen Iteration aussehen könnte.

## Inhaltsverzeichnis

- [1. Diagnose: Was an der heutigen GUI anstrengt](#1-diagnose-was-an-der-heutigen-gui-anstrengt)
- [2. Leitideen: 7 Prinzipien des Neuentwurfs](#2-leitideen-7-prinzipien-des-neuentwurfs)
- [3. Nutzer und Szenarien: 5 Jobs-to-be-done](#3-nutzer-und-szenarien-5-jobs-to-be-done)
- [4. Informationsarchitektur: 6 Bereiche statt 4 Tabs](#4-informationsarchitektur-6-bereiche-statt-4-tabs)
- [5. Die Bereiche im Detail](#5-die-bereiche-im-detail)
  - [5.1 Jetzt — der Tank-Kompass](#51-jetzt--der-tank-kompass)
  - [5.2 Stationen — der Preis-Atlas](#52-stationen--der-preis-atlas)
  - [5.3 Woche — der Zeit-Planer](#53-woche--der-zeit-planer)
  - [5.4 Ich — Fahrzeug, Belege, Bilanz](#54-ich--fahrzeug-belege-bilanz)
  - [5.5 System — Anlage & Daten (bleibt Haupttab)](#55-system--anlage--daten-bleibt-haupttab)
- [6. Das Labor — die getrennte Mathematik, die man lernt](#6-das-labor--die-getrennte-mathematik-die-man-lernt)
- [7. Die Erklär-Treppe: Antwort → Begründung → Beweis](#7-die-erklär-treppe-antwort--begründung--beweis)
- [8. Komponenten-Baukasten](#8-komponenten-baukasten)
- [9. Visuelle Richtung](#9-visuelle-richtung)
- [10. Zustände und Ehrlichkeit 2.0](#10-zustände-und-ehrlichkeit-20)
- [11. Persönliche Sortierung statt Mitteilungen](#11-persönliche-sortierung-statt-mitteilungen)
- [12. API-Vision: funktionalere Schnittstellen](#12-api-vision-funktionalere-schnittstellen)
- [13. Mobil, Desktop, PWA](#13-mobil-desktop-pwa)
- [14. Barrierefreiheit](#14-barrierefreiheit)
- [15. Woran wir merken, dass es besser ist (UX-KPIs)](#15-woran-wir-merken-dass-es-besser-ist-ux-kpis)
- [16. Migrationspfad: in 4 Phasen vom Alten zum Neuen](#16-migrationspfad-in-4-phasen-vom-alten-zum-neuen)
- [17. Was der Entwurf bewusst aufgibt](#17-was-der-entwurf-bewusst-aufgibt)
- [18. Offene Entscheidungen](#18-offene-entscheidungen)

---

## 1. Diagnose: Was an der heutigen GUI anstrengt

Kurz und ehrlich — das ist die Ausgangslage, von der sich der Entwurf löst:

| Befund | Wirkung auf Nutzer |
|---|---|
| **Alltag ist ein Sammelbecken.** Empfehlung, Tankstand, Tagesstreifen, Stationsliste, Karte, Umweg-Rechner, Belege, Due-Prompts — alles auf einer endlos scrollenden Seite. | Kein klarer Blickfang, keine fertige Aufgabe. Man scrollt, statt zu entscheiden. |
| **Werkstatt mischt Könner- und Laien-Inhalte.** Scoreboard, Kalibrierung, Fan-Chart, Heatmaps, Ranking und Jahresbilanz liegen nebeneinander — mal Bilanz, mal Forschung. | Laien verirren sich, Fachleute finden keinen roten Faden. |
| **System steht gleichberechtigt in der Hauptnavigation.** Jobs, Collector, Archiv, Logs — für 95 % der Sitzungen irrelevant. | Die Navigation verspricht vier gleich wichtige Welten, es gibt aber nur eine: Tanken. |
| **Mathematik sickert in den Alltag.** `p_besser`, Güte-Badges, M7-Gates und Schwellen sind auch dort sichtbar, wo „Warte bis 18 Uhr“ genügen würde. | Die Trennung Alltag/Werkstatt existiert auf dem Papier, nicht im Kopf. |
| **Technische Struktur statt Aufgaben.** Die Tabs spiegeln Module (Decide, Stats, Health), keine Situationen („Ich stehe an der Säule“, „Ich plane die Woche“). | Neue Nutzer müssen erst das Systemmodell lernen, bevor sie tanken. |
| **Riesen-Views, Props-Drilling.** `Daily.tsx`/`Dashboard.tsx` mit je ~2.000 Zeilen und dutzenden Props. | Jede UX-Änderung ist ein Eingriff am offenen Herzen — die Struktur zementiert den Ist-Zustand. |

**Kernaussage des Neuentwurfs:** Die GUI wird nach **Aufgaben in Situationen**
sortiert, nicht nach Modulen. Die Mathematik bekommt **eine eigene, klar
erkennbare Welt mit eigenem Lernweg** statt einer Ecke im zweiten Tab.

---

## 2. Leitideen: 7 Prinzipien des Neuentwurfs

1. **Eine Situation, ein Bildschirm, eine fertige Aufgabe.**
   Jeder Bereich beantwortet genau eine Nutzerfrage und endet mit genau einer
   primären Handlung („Navigieren“, „Vergleichen“, „Beleg buchen“). Was nicht zu
   dieser Aufgabe gehört, steht woanders — verlinkt, nicht eingebettet.

2. **Antwort zuerst, Begründung auf Nachfrage, Beweis im Labor.**
   Drei Ebenen, überall gleich (siehe §7): Die Zahl steht oben, das „Warum?“
   einen Fingertipp entfernt, die Methode im Labor. Keine Ebene drängt sich
   der anderen auf.

3. **Das Labor ist eine eigene Welt — sichtbar getrennt, einladend offen.**
   Eigene Akzentfarbe, eigene Kopfzeile, eigener Einstieg („Verstehen, warum
   die App das sagt“). Wer nie hineingeht, kann trotzdem alles nutzen. Wer
   hineingeht, wird geführt statt erschlagen (§6).

4. **Jede Zahl hat Herkunft und Frische.**
   Unter jeder wichtigen Zahl steht in einer Zeile: was sie ist, wie alt sie
   ist, was als Nächstes passiert („Median der letzten 6 Wochen · Stand
   08:05 · nächste Preise ca. 08:10“). Keine Zahl ohne Kontext.

5. **Die App zeigt ihr Können — und ihre Grenzen — an sich selbst.**
   Statt Güte-Kennzahlen als abstrakte Scores: ein **Prognose-Tagebuch**
   („Was wir gesagt haben, was passiert ist“) und ein **Vertrauens-Konto**
   (Trefferquote in Alltagssprache). Unsicherheit ist ein erstklassiger
   Inhalt, kein Fehlerzustand.

6. **Vom Zusehen zum Mitmachen in drei Stufen.**
   *Lesen* (Antwort) → *Stellen* (Was-wäre-wenn: Liter, Zeitwert, spätester
   Zeitpunkt) → *Prüfen* (eigene Schwellen, eigene Vergleiche im Labor).
   Jede Stufe ist optional, jede wird erklärt.

7. **Ruhige Dichte statt karger Leere.**
   Der Entwurf bricht bewusst mit „≤ 3 Zahlen“: Die Startansicht zeigt **1
   Entscheidung + 3 Fakten + Nächste Schritte** (1+3+N-Regel). Informativ
   heißt: alles Wichtige auf einen Blick — strukturiert heißt: jedes Ding hat
   seinen festen Platz im Raster.

---

## 3. Nutzer und Szenarien: 5 Jobs-to-be-done

Keine Personas mit Hobbys — fünf wiederkehrende Situationen, je mit
Einstieg, Zeitbudget und Erfolgskriterium:

| # | Situation | Einstieg | Zeit | Fertig, wenn … |
|---|---|---|---|---|
| **S1** | „Ich fahre gleich los — jetzt tanken oder warten?“ | **Jetzt** | ≤ 10 s | … eine Handlung feststeht (jetzt / warten bis / woanders) inkl. €-Betrag. |
| **S2** | „Welche Station auf meinem Weg ist wirklich günstig?“ | **Stationen** | ≤ 60 s | … Station + Preis + Umweg-Kosten verglichen und ggf. Navigation gestartet ist. |
| **S3** | „Wann in den nächsten Tagen tanke ich am besten?“ | **Woche** | ≤ 2 min | … ein Fenster gewählt und eingeordnet ist. |
| **S4** | „Stimmt das überhaupt, was die App behauptet?“ | **Labor** | 5–20 min | … ein konkreter Zweifel („Warum 82 %?“) an einem Beispiel geklärt ist. |
| **S5** | „Was habe ich verfahren, was ist meine Anlage?“ | **Ich / System** | ≤ 2 min | … Beleg gebucht, Bilanz gelesen oder Störung erkannt ist. |

**Konsequenz:** S1–S3 und S5 sind Alltags-Welten (schnell, deutsch, ohne
Formeln). S4 ist das Labor (langsam, neugierig, mit Formeln — aber geführt).
Die Navigation folgt exakt diesen fünf Situationen.

---

## 4. Informationsarchitektur: 6 Bereiche statt 4 Tabs

### 4.1 Die neue Hauptstruktur

```text
Hauptnavigation (immer sichtbar: Bottom-Bar mobil, Seitenleiste Desktop)
├── 1. Jetzt        S1 · Tank-Kompass: Entscheidung + nächste Schritte
├── 2. Stationen    S2 · Preis-Atlas: Karte, Liste, Verlauf, Vergleich
├── 3. Woche        S3 · Zeit-Planer: Fenster-Kalender, Tankstand (eigener Bereich)
├── 4. Ich          S5a · Fahrzeug, Belege, Bilanz, Einstellungen
├── 5. Labor  ◈     S4 · getrennte Welt: eine Seite mit Aufklapp-Abschnitten
└── 6. System       S5b · Anlage & Daten: Zustand, Läufe, Störungen (bleibt Haupttab)

Nebenwege (keine Hauptnavigation):
├── Suche           stations-/ortsübergreifend, aus jeder Ansicht (⌘K / Lupe)
└── Hilfe           kontextuell: jede Ansicht hat genau einen Hilfe-Einstieg
```

### 4.2 Warum so — die drei größten Umstellungen

- **„System“ bleibt Haupttab** (Entscheidung 14.9.). Der Technik-Bereich
  (Zustand, Daten, Läufe, Störungen) ist für den Admin-Blick prominent und
  vollständig — der Status-Punkt in der Kopfzeile ist nur die Abkürzung
  dorthin.
- **„Einstellungen“ verschwindet als eigener Tab.** Einstellungen wohnen dort,
  wo sie wirken (Zeitwert beim Umweg-Vergleich, Tankgröße beim Tankstand,
  Profile unter Ich). Was übrig bleibt (Darstellung, Verhalten, Daten),
  liegt unter Ich → Einstellungen. Kein Ort mehr, den man „verwalten“ muss.
- **Das Labor ist kein Tab, sondern ein Modus.** Optisch und räumlich
  getrennt (eigene Farbe, eigene Kopfzeile, ein Labor-Kopf mit
  Vertrauens-Konto und Aufklapp-Abschnitten). Man „geht ins Labor“
  und „kehrt zurück“ — dieser bewusste
  Übergang ist das Signal: *Hier beginnt die Mathematik, und das ist gut so.*

### 4.3 Sitemap (tief max. 3 Ebenen)

```text
Jetzt
├── Entscheidung (Ampel-Karte 2.0: Aktion, Fenster, €, Sicherheit)
├── Nächste Schritte (Navigieren / Vergleichen / Beleg buchen)
└── Warum? (Bottom-Sheet → führt in den Labor-Abschnitt)

Stationen
├── Karte (Netto-€-Pins, Umkreis, Filter: Kraftstoff, Marke, offen)
├── Liste (sortierbar: Preis, Netto-€, Entfernung, Verlauf)
├── Station (Detail: Preis, Verlauf 7 Tage, Tagesprofil, „Anpinnen“)
└── Vergleich (A gegen B: Preis, Umweg, Netto-€, Verlauf übereinander)

Woche
├── Fenster-Kalender (7-Tage-Raster: beste Zeiten je Tag)
├── Fenster-Detail (warum dieses Fenster, Sicherheit, Alternativen)
└── Tankstand (Reichweite, Reserve, „reicht bis Fenster?“)
    (Erinnerungen bewusst gestrichen, siehe §11.)

Ich
├── Fahrzeug & Profile (Tank, Verbrauch, Zeitwert, Haushaltsprofile)
├── Belege (buchen, Verlauf, stornieren, Export)
├── Bilanz (Monat/Jahr: Ausgaben, Ersparnis-Nachweis, Fahrtenbuch-light)
└── Einstellungen (Darstellung, Verhalten, Daten & Privatsphäre)

Labor ◈  (eigene Welt, eine Seite mit Aufklapp-Abschnitten)
├── Labor-Kopf: Vertrauens-Konto + Sprungleiste (immer sichtbar)
├── 1. Prognose verstehen (Fan-Chart geführt, Tagesprofil, Horizont)
├── 2. Sicherheit verstehen (Versprechen vs. Wirklichkeit, Band-Treffer)
├── 3. Stationen verstehen (Hauspreis-Vergleich, Paarvergleich, Rhythmus)
├── 4. Die App lernt (Prognose-Tagebuch, Vorsicht-Regler, Schwellen)
├── 5. Glossar & Methoden (jeder Begriff in 3 Stufen: Satz, Beispiel, Formel)
└── Spielplatz (eigene Vergleiche, eigene Zeiträume, Export)

System (Haupttab, prominent wie bisher)
├── Zustand (Ampel je Baustein: Collector, Datenbank, Modelle, App)
├── Daten (Archiv-Abdeckung, Lücken, Stations-Set, Polling-Plan)
├── Läufe (Modell-Läufe, Protokolle, Startknopf)
└── Störungen (Verlauf, Alarme, Checkliste, Beleg-Export für Diagnose)
```

---

## 5. Die Bereiche im Detail

> Notation: Die Skizzen sind **mobile-first** (eine Spalte). Desktop nutzt
> dasselbe Raster in 2–3 Spalten (§13). Jede Ansicht folgt dem gleichen
> Skelett: **Kopfzeile → Kern → Einordnung → Nächste Schritte.**

Gemeinsame Kopfzeile (alle Alltags-Bereiche):

```text
┌─────────────────────────────────────────────────┐
│ ☰?  TankApp · Gütersloh · E10        [●] [⌘K]  │  ● = System-Status
│                                                  │  (nur bei Gelb/Rot auffällig)
└─────────────────────────────────────────────────┘
```

---

### 5.1 Jetzt — der Tank-Kompass

**Frage:** Jetzt oder warten, hier oder woanders? **Zeit:** ≤ 10 Sekunden.

**Layout (von oben nach unten — feste Reihenfolge, nie anders):**

```text
┌─────────────────────────────────────────────────┐
│ ① ENTSCHEIDUNG (genau eine Karte, volle Breite) │
│  ┌───────────────────────────────────────────┐  │
│  │ ◉ WARTEN BIS 18–20 UHR                    │  │
│  │   Erwartet 4 ct/L günstiger ≈ 1,60 €      │  │
│  │   bei 40 L · ziemlich sicher (82 %)       │  │
│  │   [Warum?]                          [Route] │  │
│  └───────────────────────────────────────────┘  │
│ ② DREI FAKTEN (immer dieselben drei, immer     │
│    dieselbe Reihenfolge)                        │
│  ┌────────┐ ┌────────┐ ┌────────┐               │
│  │Jetzt   │ │Bestes  │ │Tank    │               │
│  │hier    │ │Fenster │ │reicht? │               │
│  │1,749   │ │heute   │ │Ja, bis │               │
│  │€/L     │ │18–20   │ │Do      │               │
│  └────────┘ └────────┘ └────────┘               │
│ ③ NÄCHSTE SCHRITTE (max. 3, als Zeilen)         │
│  → Günstigste Alternative: Shell, +0,80 € netto │
│  → Morgen 19–21 Uhr wäre noch besser (−2,10 €)  │
│  → Tank nur noch ¼ — Warten ist riskant         │
│ ④ HEUTE IM BLICK (kompakter Tagesstreifen)      │
│  ▓▓▓▓▓▓░░▓▓▓▓████▓▓▓░░  06–24 Uhr, jetzt markiert│
│ Fußzeile: Preise 4 Min alt · Prognose 35 Min   │
└─────────────────────────────────────────────────┘
```

**Entscheidungen im Detail:**

- **Die Ampel-Karte 2.0** kennt vier Ausgänge statt drei: `Jetzt tanken`
  (grün) · `Warten bis …` (grün mit Uhr) · `Woanders tanken` (blau, mit
  Station) · `Keine klare Empfehlung` (grau — ehrlich, mit den 3
  Aktualpreisen darunter). Grau ist ein erstklassiger Zustand mit eigenem
  Design, kein Fehler.
- **Sicherheit in Worten plus Prozent** (Entscheidung 14.9.). Die Karte sagt
  „ziemlich sicher (82 %)“ / „eher sicher (64 %)“ / „unsicher“ (Stufen mit
  festen Schwellen, im Labor erklärt). Worte zum Scannen, Prozent zum
  Einordnen — beides auf den ersten Blick, solange Stufe A gilt (§10).
- **„Warum?“ ist immer da und immer gleich.** Ein Tipp öffnet das
  Begründungs-Sheet (§7): 3 Sätze, 1 Mini-Visual, 1 Link ins Labor. Kein
  Scrollen zu einer weit entfernten Begründung.
- **Tankstand ist kein Formular, sondern ein Fakt.** Einmal unter Ich
  gepflegt (oder per „¼ / ½ / ¾ / voll“-Schnellauswahl hier), erscheint er
  als Fakt Nr. 3 („reicht bis Do“ / „reicht nicht bis zum Fenster“). Die
  Warnung bei knappem Tank ist ein „Nächster Schritt“, kein Pop-up.
- **Was-wäre-wenn wohnt in der Karte, nicht auf einer Seite.** Ein
  Aufklapp-Menü „Annahmen“ (Liter, spätester Zeitpunkt, Zeitwert) ändert die
  Empfehlung live — mit Hinweis, welche Annahme gerade den Ausschlag gibt
  („Kippt zu „Jetzt“, wenn du vor 17 Uhr tanken musst“).

---

### 5.2 Stationen — der Preis-Atlas

**Frage:** Wohin fahre ich? **Zeit:** ≤ 60 Sekunden.

```text
┌─────────────────────────────────────────────────┐
│ Suchfeld + Filter-Chips: [E10] [offen] [Marke]  │
│ ┌───────────────────────────────────────────┐   │
│ │                                 │   │
│ │            KARTE mit €-Pins               │   │
│ │   (Pin = Netto-€ ggü. Referenz, Farbe =   │   │
│ │    Urteil: günstig / mittel / teuer)      │   │
│ │                                           │   │
│ └───────────────────────────────────────────┘   │
│ Sortierung: [Preis | Netto-€ | Entfernung]      │
│ ┌───────────────────────────────────────────┐   │
│ │ ★ Shell, Musterstr. · 1,2 km              │   │
│ │   1,709 €/L · −0,80 € netto · vor 4 Min   │   │
│ │   ▁▂▃▂▁▃▂ Verlauf 24 h (Sparkline)        │   │
│ ├───────────────────────────────────────────┤   │
│ │   Aral, … · 0,4 km                        │   │
│ │   1,749 €/L · Referenz · vor 4 Min        │   │
│ └───────────────────────────────────────────┘   │
│ Fußzeile: 10 Stationen · Stand 08:05            │
└─────────────────────────────────────────────────┘
```

**Station-Detail (eine Seite pro Station, festes Raster):**

```text
┌─────────────────────────────────────────────────┐
│ ← Shell, Musterstraße · ★ Anpinnen              │
│ 1,709 €/L · vor 4 Min · geöffnet bis 22 Uhr     │
│                                                 │
│ VERLAUF (7 Tage, mit Tagesmedian-Band)          │
│  ╭╮   ╭──╮                                      │
│ ─╯╰───╯  ╰──  Linie = Preis, Band = üblich      │
│                                                 │
│ TAGESRHYTHMUS (vereinfachtes Profil)            │
│  morgens meist teuer · abends meist günstig     │
│  ▓▓▓▓▓░░░░▓▓▓████  (heute markiert)             │
│                                                 │
│ EINORDNUNG (3 Zeilen, Alltagssprache)           │
│  · 4,2 ct/L unter dem Stadt-Median heute        │
│  · Meist 2.‑günstigste deiner 10 Stationen      │
│  · Umweg ab Route: +1,2 km ≈ +0,35 €            │
│                                                 │
│ [Route] [Vergleichen] [Beleg buchen]            │
│ Fußzeile: [Warum ist sie meist günstig? → Labor]│
└─────────────────────────────────────────────────┘
```

**Entscheidungen im Detail:**

- **Referenz statt Rangliste.** Jede Zahl steht im Vergleich zu einer
  sichtbaren Referenz (Standard: nächstgelegene / meistgenutzte Station,
  umschaltbar). „−0,80 € netto“ ist sofort verständlich, „Rang 3“ nicht.
- **Netto-€ ist die Leitwährung der Liste.** Preis/Liter steht dabei, aber
  sortiert und gefärbt wird nach Netto-€ (Sprit + Zeit − Umweg). Der Zeitwert
  ist daneben als Chip änderbar („Zeit: 12 €/h ▾“) — keine Reise in die
  Einstellungen.
- **Verlauf schlägt Moment.** Jede Zeile hat eine 24-h-Sparkline, jedes
  Detail einen 7-Tage-Verlauf mit „Üblich-Band“. Ein billiger Preis bei
  steigender Tendenz liest sich anders als derselbe Preis bei fallender.
- **Vergleich ist ein eigener Modus, kein Rechnen im Kopf.** Zwei Stationen
  wählen → Gegenüberstellung (Preis, Verlauf übereinander, Umweg, Netto-€,
  Urteil in einem Satz). Tiefere Statistik („sind die beiden überhaupt
  verschieden?“) verlinkt in den Labor-Abschnitt 3.
- **Anpinnen statt Suchen.** Stamm-Stationen (★) erscheinen dauerhaft oben
  und bestimmen die Referenz. Kein Alarm, kein Push — nur Sortierung (§11).

---

### 5.3 Woche — der Zeit-Planer

**Frage:** Wann in den nächsten Tagen? **Zeit:** ≤ 2 Minuten.

```text
┌─────────────────────────────────────────────────┐
│ Tank: ▰▱▱▱ ¼ · reicht ≈ 120 km · bis ca. Do     │
│ [Ändern]                                        │
│                                                 │
│ BESTE FENSTER (7-Tage-Kalender)                 │
│ ┌────┬────┬────┬────┬────┬────┬────┐             │
│ │So  │Mo  │Di  │Mi  │Do  │Fr  │Sa  │             │
│ │    │19– │    │18– │    │    │    │             │
│ │heute│21 │ −− │20 │ −− │ −− │ −− │             │
│ │18– │★★★ │    │★★☆ │    │    │    │             │
│ │20  │    │    │    │    │    │    │             │
│ │★★☆ │    │    │    │    │    │    │             │
│ └────┴────┴────┴────┴────┴────┴────┴────┘        │
│ ★ = Sicherheit des Fensters (Legende darunter)  │
│                                                 │
│ AUSGEWÄHLT: Montag 19–21 Uhr                    │
│  Erwartet 1,689 €/L ≈ 2,10 € unter Jetzt        │
│  Ziemlich sicher (82 %) · Tank reicht ✓         │
│  [Stationen ansehen] [Warum?]                   │
│                                                 │
│ WOCHENLINIE (7 Tage, Tagesbestwerte)            │
│  ───╲╱───╲╱────  Punkte = Tagesbestwerte         │
│ Fußzeile: Prognose 35 Min alt · ab Do unsicher  │
└─────────────────────────────────────────────────┘
```

**Entscheidungen im Detail:**

- **Kalender statt Liste.** Die Top-3-Fenster als Liste verlieren den
  Kontext (Wochenende? Feiertag? Urlaub?). Das 7-Tage-Raster zeigt Muster
  („abends billig, Sonntag teuer“) auf einen Blick — die Liste steckt als
  sortierte Ansicht darunter („Alle Fenster nach Ersparnis“).
- **Sterne statt Prozente.** Jedes Fenster trägt 1–3 Sterne für Sicherheit
  (Schwellen im Labor erklärt, Prozent im Detail). Sterne lassen sich
  scannen, Prozente muss man lesen.
- **Tank-Reichweite ist der Spielverderber mit Namen.** Reicht der Tank
  nicht bis zum besten Fenster, sagt die App das vor der Empfehlung („Das
  beste Fenster erreichst du nicht — hier das beste erreichbare“). Physik
  schlägt Statistik, und man sieht warum.
- **Horizont-Ehrlichkeit.** Tage 5–7 tragen sichtbar den Hinweis „noch
  unsicher“ (entsättigte Farbe + Fußnote). Die App zeigt die ganze Woche,
  verspricht aber nur, was sie halten kann.
- **Keine Erinnerung nötig** (Entscheidung 14.9.). Die Woche ist ein
  Nachschlagewerk, kein Wecker: Fenster ansehen, einordnen, bei Bedarf
  „Stationen ansehen“. Erinnerungen und Push sind bewusst gestrichen (§11).

---

### 5.4 Ich — Fahrzeug, Belege, Bilanz

**Frage:** Was ist meins, was habe ich verfahren? **Zeit:** ≤ 2 Minuten.

Vier Unterseiten (Segment-Steuerung oben, kein eigenes Menü):

```text
┌─────────────────────────────────────────────────┐
│ [Fahrzeug] [Belege] [Bilanz] [Einstellungen]    │
├─────────────────────────────────────────────────┤
│ FAHRZEUG: Golf · E10 · 50-L-Tank · 6,5 L/100 km │
│ Zeitwert: 12 €/h · Modus: Auf dem Weg ▾         │
│ Profile: [Ich] [Partner] [+ Neu]                │
│                                                 │
│ BELEGE: [+ Buchen]  (Schnellerfassung oben)     │
│  12.09. Shell · 38,2 L · 1,709 €/L · 65,28 €    │
│  05.09. Aral  · 41,0 L · 1,749 €/L · 71,71 €    │
│  … Verlauf, Storno („Stornieren“ statt Löschen),│
│  … Export (CSV)                                 │
│                                                 │
│ BILANZ (Monat / Jahr umschaltbar):              │
│  Getankt: 245,60 € · Ø 1,729 €/L                │
│  Gegenüber Stadt-Median: −8,40 € ✓              │
│  Gegenüber „immer Aral nebenan“: −12,10 € ✓     │
│  Verlauf (Balken je Monat) + [Warum? → Labor]   │
│                                                 │
│ EINSTELLUNGEN:                                  │
│  Darstellung (Hell/Dunkel/Auto, Dichte)         │
│  Verhalten (Tankzeit-Sortierung, angepinnte     │
│    Stationen, Störungs-Anzeige)                 │
│  Daten (Export alles, Belege löschen,           │
│    „Vergiss mein Tankverhalten“)                │
│  Über (Version, Quelle CC BY 4.0, Hilfe)        │
└─────────────────────────────────────────────────┘
```

**Entscheidungen im Detail:**

- **Bilanz mit zwei ehrlichen Vergleichsmaßstäben** (Entscheidung 14.9.).
  Standard ist der neutrale Stadt-Median („−8,40 €“), darunter steht der
  persönliche Maßstab („−12,10 € gegenüber Aral, deiner meistgenutzten
  Station“). Beide nachprüfbar, beide bescheiden — kein „Du hast 120 €
  gespart!“ gegen einen erfundenen Vollpreis. Die Maßstäbe stehen dabei
  und sind im Labor erklärt.
- **Beleg buchen in ≤ 15 Sekunden.** Schnellerfassung (Station vorausgefüllt
  aus Empfehlung, Liter + Preis) oben auf der Beleg-Seite; Details
  (Kilometerstand, voll/teilweise) optional aufklappbar. Nach dem Buchen:
  kurze Bestätigung mit Einordnung („3,1 ct/L unter Tagesmedian ✓“).
- **Fahrtenbuch-light, kein Fahrtenbuch.** Kilometerstand ist optional; wer
  ihn pflegt, bekommt Verbrauchs-Auswertung (echter vs. Bordcomputer-Verbrauch)
  — wer nicht, hat trotzdem volle Bilanz.

---

### 5.5 System — Anlage & Daten (bleibt Haupttab)

**Frage:** Läuft alles? Wenn nein: was genau? **Nutzer:** dieselbe Person in
der Rolle „Haushalts-Admin“, plus Ferndiagnose.

```text
┌─────────────────────────────────────────────────┐
│ System · Anlage & Daten             ● Alles ok  │
│                                                 │
│ ZUSTAND (4 Bausteine, je eine Zeile)            │
│  ● Collector (Pi)    Preise 4 Min alt            │
│  ● Datenbank (NAS)   12.345 Preise · 18 Stationen│
│  ● Modelle           Lauf heute 06:12, ok        │
│  ● App               Version 0.31.0              │
│                                                 │
│ DATEN (Abdeckung je Stadt/Kraftstoff)           │
│  Gütersloh E10  ██████████ 98 % (Lücke: 2.9.)   │
│  …                                              │
│                                                 │
│ LÄUFE & PROTOKOLLE                              │
│  Modell-Update  heute 06:12 · 4 Min · ok        │
│  Archiv-Sync    gestern  · …                    │
│  [Protokoll ansehen] [Jetzt starten]            │
│                                                 │
│ STÖRUNGEN (Verlauf + Checkliste bei aktiv)      │
│  Keine aktiven Störungen.                       │
└─────────────────────────────────────────────────┘
```

**Entscheidungen im Detail:**

- **Vier Bausteine, vier Farben, vier Sätze.** Der gesamte Systemzustand
  passt auf einen Blick — Details (Protokolle, Lücken, Polling-Plan) eine
  Ebene tiefer. Die heutige Informationsdichte bleibt erhalten, aber
  gestaffelt.
- **Der Status-Punkt in der Kopfzeile ist die Abkürzung.** Grün = ruhig,
  Gelb/Rot = auffällig + Tipp führt direkt in den System-Tab zur Störung
  mit Checkliste („Was du tun kannst“). Der volle Bereich bleibt einen
  Tipp entfernt — prominent, nicht versteckt.
- **Diagnose-Export für den Ernstfall.** Ein Knopf bündelt Version, Zustand,
  letzte Protokoll-Zeilen und Datenabdeckung als Datei — für Forum, Issue
  oder den eigenen Notizzettel.

---

## 6. Das Labor — die getrennte Mathematik, die man lernt

### 6.1 Trennung, die man sieht und spürt

| Aspekt | Alltag (Jetzt/Stationen/Woche/Ich) | Labor ◈ |
|---|---|---|
| Akzentfarbe | Smaragd (Handlung) | Violett (Wissen) — durchgehend, inkl. Kopfzeile |
| Kopfzeile | „TankApp · Stadt · Kraftstoff“ | „◈ Labor · [← Zurück zum Alltag]“ |
| Sprache | Nur Deutsch, keine Symbole | Deutsch zuerst, Fachwort + Symbol direkt dahinter |
| Zahlen | €, ct/L, %, Sterne, Uhrzeiten | zusätzlich Verteilungen, Bänder, Güte-Kennzahlen |
| Tempo | Sekunden | Minuten — kein Zeitdruck, Lese-Layout (schmale Spalte) |
| Ziel | Entscheiden | Verstehen, Prüfen, Spielen |

**Der Übergang ist bewusst:** Wer aus dem Alltag ins Labor folgt („Warum?“ →
„Im Labor vertiefen“), landet nicht auf einer Kennzahlen-Wand — der passende
Abschnitt wird **aufgeklappt und angescrollt** („Warum war Montag 19–21 Uhr
ziemlich sicher?“). Umgekehrt führt „Zurück“ exakt dorthin, wo man herkam.
Das Labor ist damit kein Ort, sondern eine **Antwort-Tiefe**.

**Kein Onboarding nötig:** Das Labor ist eine einzige Seite: oben das
Vertrauens-Konto, darunter die Abschnitte. Wer nichts aufklappt, hat trotzdem
den Überblick — wer neugierig ist, klappt auf. Kein Rundgang, kein Quiz,
kein „Kapitel 2 von 5“.

### 6.2 Ein Labor, eine Seite: 5 Aufklapp-Abschnitte zum Verstehen

Das Labor ist die Herzidee für „Nicht-Mathematiker verstehen es irgendwann“ —
und es ist bewusst **kein Pfad mit Kapitelseiten** (Entscheidung 14.9.):
Aufklappen reicht. Eine einzige scrollbare Seite; jeder Abschnitt folgt
demselben Bauplan: **Alltagsfrage → Antwort in 3 Sätzen → geführtes Visual
(schrittweise aufbauend) → „Für Neugierige“ (verschachtelte Aufklapp-Ebene
mit Methode + Formel) → Selbst prüfen (kleine Aufgabe mit Auflösung).**
Kein Fortschritt, keine Häkchen, keine Benotung — Nachschlagen statt Schule.

**Der Labor-Kopf — „Wie gut kennt die App deine Stadt?“** (immer sichtbar,
nichts zum Aufklappen):

```text
┌─────────────────────────────────────────────────┐
│ ◈ Labor                      [← Zurück: Jetzt]  │
│                                                 │
│ VERTRAUENS-KONTO (deine Stadt, E10)             │
│  ┌───────────────────────────────────────────┐  │
│  │ Trefferquote der Empfehlungen (6 Wochen)  │  │
│  │   ██████████████░░░░  78 von 100 ✓        │  │
│  │   Versprochen waren „ziemlich sicher“     │  │
│  │   ≈ 75–85 von 100 — passt.                │  │
│  │   [Wie wird das gezählt? → Abschnitt 2]   │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│ SPRUNGLEISTE (klappt auf + scrollt hin):        │
│  [1 Prognose] [2 Sicherheit] [3 Stationen]      │
│  [4 Lernen] [5 Glossar] [Spielplatz]            │
│                                                 │
│ ▸ 1. Was sagt die App eigentlich vorher?        │
│ ▸ 2. Was heißt „ziemlich sicher“?               │
│ ▸ 3. Warum ist eine Station „meist günstig“?    │
│ ▸ 4. Wie lernt die App aus Fehlern?             │
│ ▸ 5. Alle Begriffe von A–Z (Glossar)            │
│ ▸ Spielplatz: Was wäre gewesen, wenn …?         │
└─────────────────────────────────────────────────┘
```

**Die fünf Abschnitte (alle auf einmal, Entscheidung 14.9.):**

1. **Was sagt die App eigentlich vorher?**
   Frage: „Woher weiß sie, was Benzin morgen kostet?“
   - 3-Satz-Antwort: Muster aus der Vergangenheit (Tages-/Wochenrhythmus) +
     aktuelle Lage + ehrliche Unsiciche Unsicherheit als Band.
   - Geführtes Visual: Fan-Chart, das sich **Schritt für Schritt aufbaut**
     (1. Linie „wahrscheinlichster Preis“ → 2. dunkles Band „meistens
     drin“ → 3. helles Band „fast immer drin“ → 4. echte Preise von
     gestern darübergelegt). Jeder Schritt ein Satz.
   - Für Neugierige: Quantile q̂.025…q̂.975, Strukturmodell + AR(2),
     Ensemble — mit Formel, aber erst hier.
   - Selbst prüfen: „An welchem Tag lag der echte Preis außerhalb des
     Bandes?“ (mit Auflösung).

2. **Was heißt „ziemlich sicher“?**
   Frage: „Warum 82 % — und stimmt das?“
   - 3-Satz-Antwort: Prozent = Anteil ähnlicher Fälle, in denen es
     stimmte; wird an echten Ergebnissen nachgezählt; Worte sind Stufen
     fester Bereiche.
   - Geführtes Visual: **Versprechen-vs.-Wirklichkeit-Diagramm** (kalibriert
     erklärt als: „Bei allen „80-%-Fällen“ zählen wir nach: waren es ~80?“),
     Punkte statt Kurven, Diagonale als „Ideal“.
   - Für Neugierige: Brier-Score („mittlerer quadratischer Fehler der
     Wahrscheinlichkeit“), Verlässlichkeitsdiagramm, M7-Gate als
     „Führerschein-Prüfung der App“.
   - Selbst prüfen: „Was wäre ein schlechtes Zeichen in diesem Diagramm?“

3. **Warum ist eine Station „meist günstig“?**
   Frage: „Zufall oder System?“
   - 3-Satz-Antwort: Jede Station wird mit dem Stadt-Üblichen verglichen
     (Median), über Wochen gemittelt, Zufall herausgerechnet.
   - Geführte Visuals: **Hauspreis-Vergleich** (Balkendiagramm „Station X
     liegt meist N ct unter/über dem Üblichen“ — das ist δ̂, aber so heißt
     es erst in der Klammer); **Wochenrhythmus-Heatmap** („Wann ist es wo
     billig?“ — lesbar als Stundenplan); **Paarvergleich** („Sind A und B
     wirklich verschieden oder nur zufällig?“).
   - Für Neugierige: δ̂-Definition, Median-Basis, Signifikanz-Gedanke,
     ε als „Ab wann ist uns ein Unterschied wichtig?“ (Vorsicht-Regler).
   - Selbst prüfen: Zwei Stationen wählen, Urteil vorhersagen, auflösen.

4. **Wie lernt die App aus Fehlern?**
   Frage: „Was passiert, wenn sie danebenlag?“
   - 3-Satz-Antwort: Jede Empfehlung wird aufgeschrieben (Tagebuch),
     nach Fensterende mit der Realität verglichen, Trefferquoten und
     Schwellen daraus nachgezogen.
   - Geführte Visuals: **Prognose-Tagebuch** (Filter: Treffer/Fehler,
     mit „Was war los?“-Notizen); **Entscheidungs-Scoreboard** als
     „Bilanz der Ratschläge“ (nicht der Tankungen!); **Vorsicht-Regler**
     (ε-Spielplatz: „Was wäre bei vorsichtigeren/mutigeren Schwellen
     passiert?“ — live nachgerechnet).
   - Für Neugierige: Advice-Ledger vs. Wallet-Ledger, Schwellen-Tabelle,
     „Keine klare Empfehlung“ als aktive Entscheidung.
   - Selbst prüfen: Regler verschieben, Trefferquote beobachten.

5. **Glossar & Methoden (A–Z).**
   Jeder Begriff in **3 Stufen**: (1) Ein Satz für alle („Trefferquote:
   Bei wie vielen von 100 Ratschlägen die App recht hatte.“), (2) Ein
   Beispiel mit echten Zahlen aus deiner Stadt, (3) Die exakte Definition
   mit Formel und Datenquelle. Begriffe: Trefferquote (Brier),
   Band-Treffer (PICP), Band-Breite (MPIW), Hauspreis-Abstand (δ̂),
   Vorsicht-Schwelle (ε), Tagesprofil, Quantil, Ensemble, Median, … —
   deutsch zuerst, Fachwort in Klammern, **nie umgekehrt**.
   Jeder Glossar-Eintrag verlinkt zurück auf die Stellen, wo der Begriff
   in der App vorkommt („Wo du das siehst“).

**Spielplatz (eigener Abschnitt darunter):** Freie Vergleiche (Stationen,
Zeiträume, Kraftstoffe), Export (CSV/PNG), „Was-wäre-gewesen“-Rechner
(„Was hätte Strategie X im letzten Quartal gebracht?“). Für alle, die nach
Abschnitt 4 noch Fragen haben.

### 6.3 Gestaltungsregeln des Labors (verbindlich)

- **Kein Fachwort ohne deutschen Satz davor.** Erst „Band-Treffer: Wie oft
  der echte Preis im vorhergesagten Band lag“, dann „(PICP = …)“.
- **Jedes Diagramm hat eine Lesehilfe.** Titel als Aussage („Die App
  verspricht eher zu viel als zu wenig“), Achsen in Worten, ein
  Beispiel-Punkt markiert („Dieser Punkt: …“), darunter „So liest du das“.
- **Jede Methode hat ein Beispiel aus deiner Stadt.** Keine Lehrbuch-Zahlen —
  der Paarvergleich startet mit deinen zwei meistgenutzten Stationen.
- **Fehler sind Ausstellungsstücke, keine Schande.** Das Tagebuch zeigt
  Fehler prominent („Hier lagen wir daneben — und das haben wir daraus
  gelernt“). Vertrauen entsteht aus eingestandenen Fehlern, nicht aus
  versteckten.

---

## 7. Die Erklär-Treppe: Antwort → Begründung → Beweis

Das Bindegewebe zwischen Alltag und Labor — **überall dieselbe Mechanik:**

```text
EBENE 0 · ANTWORT (Alltag, sofort sichtbar)
„Warten bis 18–20 Uhr · ≈ 1,60 € · ziemlich sicher“
        │  [Warum?] (immer an derselben Stelle)
        ▼
EBENE 1 · BEGRÜNDUNG (Bottom-Sheet / Seitenpanel, 3 Sätze + Mini-Visual)
 1. „Um 18–20 Uhr ist es hier meist am billigsten (6-Wochen-Muster).“
 2. „Der aktuelle Preis liegt 3 ct über dem Üblichen — fallen ist
     wahrscheinlicher als steigen.“
 3. „Ähnliche Fälle trafen in 78 von 100 ein.“
 [Mini-Visual: Tagesprofil mit Markierung]  [Im Labor vertiefen → Abschnitte 1+2]
        │  (führt zu genau dieser Frage im Labor, nicht zum Labor-Start)
        ▼
EBENE 2 · BEWEIS (Labor-Abschnitt, aufgeklappt + angescrollt)
 Fan-Chart der Station, Kalibrierungs-Punkt dieser Empfehlung,
 Tagebuch-Einträge ähnlicher Fälle, Methode + Formel (Aufklapp-Ebene),
 Export (CSV/PNG).
```

**Regeln:**

- Jede Empfehlung, jede Fenster-Auszeichnung, jede Bilanz-Zahl und jede
  Labor-Aussage hat alle drei Ebenen. Was keine Ebene 1 hat, wird nicht
  angezeigt (Ehrlichkeits-Regel 2.0).
- Ebene 1 ist **max. 3 Sätze + 1 Visual**, immer in Alltagssprache, immer
  mit Frische („Preise 4 Min alt“). Sie antwortet auf „Warum?“ — nicht auf
  „Wie rechnest du?“.
- Der Sprung 1 → 2 klappt den passenden Abschnitt auf, scrollt hin und merkt
  sich die Herkunft („Zurück zu: Montag 19–21 Uhr“). Kein Verirren, kein
  Neu-Suchen.

---

## 8. Komponenten-Baukasten

Wiederverwendbare Bausteine — jede Ansicht baut aus denselben Teilen
(das beendet die 2.000-Zeilen-Views strukturell):

| Baustein | Aufgabe | Wo |
|---|---|---|
| **Entscheidungskarte** | 1 Aktion + Fenster + € + Sicherheit + Warum/Handlungen | Jetzt |
| **Fakt-Kachel** (3er-Reihe) | 1 Zahl + Label + Mini-Kontext, feste Reihenfolge je Ansicht | Jetzt, Station-Detail |
| **Schritt-Zeile** | „Nächster Schritt“ mit Pfeil, max. 3 | Jetzt, Woche |
| **Preis-Zeile** | Station + Preis + Netto-€ + Sparkline + Frische | Stationen, Vergleich |
| **Netto-€-Pin** | Karten-Pin: €-Betrag + Urteils-Farbe | Karte |
| **Fenster-Kalender** | 7-Tage-Raster + Sterne + Auswahl-Detail | Woche |
| **Tagesstreifen** | 06–24-Uhr-Band: jetzt + Fenster markiert | Jetzt, Woche |
| **Verlaufs-Chart** | Linie + Üblich-Band + echte Punkte | Station-Detail, Labor |
| **Begründungs-Sheet** | 3 Sätze + Mini-Visual + Labor-Link | überall (Ebene 1) |
| **Vertrauens-Konto** | Trefferquote als Balken + Soll/Ist-Satz | Labor-Start, Bilanz |
| **Tagebuch-Eintrag** | Vorhersage → Realität → ✓/✗ + Notiz | Labor, Abschnitt 4 |
| **Lesehilfe** | Titel-als-Aussage + Achsen-Worte + Beispiel-Punkt | jedes Labor-Diagramm |
| **Stufen-Text** | Satz → Beispiel → Formel (Aufklapp-Ebenen) | Glossar, Für-Neugierige |
| **Zustands-Zeile** | Punkt + Baustein + Satz + Tiefe-Link | System |
| **Annahmen-Menü** | Liter/Zeit/Zeitwert live verstellbar | Jetzt, Vergleich |
| **Frische-Fußzeile** | „Preise N Min · Prognose M Min · nächste …“ | jede Ansicht (fixer Platz) |

**Layout-Regeln:** Max. 1 Entscheidungs-/Primärkarte pro Ansicht; max. 1
primäre Handlung pro Bildschirm (der Rest sind Zeilen/Links); jede Ansicht
endet mit der Frische-Fußzeile an derselben Stelle — Verlässlichkeit durch
Wiederholung.

---

## 9. Visuelle Richtung

Der Entwurf behält die dunkle Slate-Welt als Standard (wiedererkannt, nachts
an der Säule angenehm), schärft aber System und Hierarchie:

- **Farbrollen (nie anders verwendet):**
  - Smaragd = Handlung/Go (nur für die primäre Aktion + „günstig“)
  - Blau = Information/Vergleich („woanders“, Links, Zweitpreise)
  - Violett = Wissen/Labor (nur dort — der Farbwechsel signalisiert den
    Weltenwechsel)
  - Amber = Vorsicht („eher sicher“, knapper Tank, gelbe System-Zustände)
  - Rot = Stopp/Problem (nur: „reicht nicht“, Fehler, rote Zustände)
  - Grau = keine Aussage („keine klare Empfehlung“, unbekannt) — **bewusst
    gestaltet, kein blasses Grün**
- **Typografie:** Eine Zahlengröße pro Bedeutung (Entscheidungs-€ groß,
  Preise mittel, Kontext klein); tabellarische Ziffern für alle Preise;
  Komma-Dezimal, „ct/L“ für Unterschiede, „€/L“ für Niveaus (wie bisher —
  das bleibt).
- **Dichte:** Mobil kompakt (Bottom-Sheets, 44-px-Ziele), Desktop max.
  3-spaltig mit ruhiger Mitte (Lese-Spalte im Labor max. 65 Zeichen).
- **Hellmodus:** gleichwertig (nicht invertiert, sondern eigene Palette),
  Auto-Standard nach System. Charts funktionieren in beiden (kein
  Hellgrau-auf-Weiß).
- **Bewegung:** sparsam und bedeutungsvoll (Zahl wechselt = kurzes
  Aufblenden; Weltwechsel Alltag↔Labor = Schieben in Laufrichtung). Kein
  Parallax, kein Glow-Übermaß.

---

## 10. Zustände und Ehrlichkeit 2.0

Die heutige Ehrlichkeits-Regel wird zum **Zustands-System** ausgebaut —
jede Ansicht kennt alle Zustände, jeder Zustand hat ein festes Gesicht:

| Zustand | Gesicht | Beispiel |
|---|---|---|
| Lädt (erstmals) | Skelett im exakten späteren Raster | Karten-Platzhalter mit Label für Screenreader |
| Aktualisiert | kein Flackern — alte Zahlen bleiben, kleiner „Aktualisiert …“-Hinweis | Poll alle 5 Min |
| Leer (noch nichts da) | sachlich + fehlender Baustein + was als Nächstes passiert | „Noch keine Prognose — erster Modell-Lauf heute Nacht.“ |
| Unsicher (wissentlich) | eigene Gestaltung (grau/entsättigt), kein Prozent-Versteck | „Keine klare Empfehlung — die Preise springen heute.“ |
| Veraltet | Frische-Fußzeile wird amber/rot + Satz („Preise 2 Std alt — Collector prüfen“) | Schwellen wie bisher, doppelt = rot |
| Fehler | Klartext + Rohcode klein + „Erneut laden“ | „Empfehlung derzeit nicht erreichbar.“ |
| Offline | Banner + lesbarer Cache-Stand + Warteschlange für Belege | „Offline — Stand 07:55. Belege werden zwischengespeichert.“ |
| Neu/Geändert | „Neu“-Punkt max. 1×, Update-Banner mit „Was ist neu?“ | nach App-Update |

**Neu: drei Ehrlichkeits-Stufen für Sicherheit** (ersetzen das binäre Gate):

- **Stufe A „Nachgewiesen“** (≥ 100 abgeschlossene Empfehlungen, Brier <
  0,25): Worte + Prozent + Sterne, überall.
- **Stufe B „Lernend“** (darunter): Worte + Sterne ohne Prozent, mit
  Fortschritt („Noch 34 Empfehlungen bis zur Prozent-Anzeige“). Der Nutzer
  sieht die App reifen — das schafft mehr Vertrauen als Schweigen.
- **Stufe C „Zurückhaltend“** (Verteilung zu breit / Lage unklar): graue
  „Keine klare Empfehlung“ + Aktualpreise. Wie bisher, aber als
  erstklassiger Zustand mit eigenem Design und Begründung.

---

## 11. Persönliche Sortierung statt Mitteilungen

Entscheidung 14.9.: **Erinnerungen, Preis-Alarme und Push entfallen vorerst
ganz.** Die App ist ein Nachschlagewerk, kein Wecker — nichts pingt, nichts
nervt, keine Server-Komponente für Push. Was bleibt, ist stille
Personalisierung (alles lokal erklärt, alles abschaltbar):

| Funktion | Verhalten | Beispiel |
|---|---|---|
| **Lern-Gewohnheit** | Tankzeit-Profil: Fenster, die man nie nutzt, rutschen in der Sortierung nach hinten — mit sichtbarem Hinweis | „Nach Preis sortiert wäre Mi besser — du tankst aber nie mittags.“ |
| **Angepinnte Stationen** | Stamm-Stationen (★) bleiben dauerhaft oben und bestimmen die Referenz | Shell und Aral oben, Rest darunter |
| **Störungs-Anzeige** | Gelb/Rot nur als Anzeige im System-Tab + Status-Punkt in der Kopfzeile — kein Push, kein Ton | „Collector meldet seit 2 Std nichts — Pi prüfen?“ (Text im System-Tab) |

**Grundsätze:** Keine Funktion ohne sichtbaren Nutzen an Ort und Stelle;
alles unter Ich → Einstellungen an einer Stelle; keine Marketing-Töne.
Falls Mitteilungen je zurückkommen, dann als eigener, explizit
einzuschaltender Baustein — nicht als schleichende Erweiterung.

---

## 12. API-Vision: funktionalere Schnittstellen

Der Entwurf löst sich bewusst von den heutigen Endpunkten. Richtung:
**weniger, größere, aufgabenbezogene Aggregate** (ein Aufruf pro Ansicht),
plus Erklärung und Lerninhalte als eigene Ressourcen. Lesen
bleibt frei, Schreiben bleibt budgetiert.

```text
Übersicht & Aufgaben (ein Aufruf pro Ansicht — ersetzt N Einzelabfragen)
GET /api/v2/overview?city=&fuel=          Jetzt: Entscheidung + 3 Fakten +
                                          Schritte + Tagesstreifen + Frische
GET /api/v2/stations/atlas?city=&fuel=    Karte+Liste: Preise, Netto-€,
                                          Sparklines, Referenz, Frische
GET /api/v2/stations/{id}?window=7d       Detail: Verlauf, Profil,
                                          Einordnung, Alternativen
GET /api/v2/stations/compare?a=&b=        A-gegen-B: Preise, Umweg, Netto-€,
                                          Verlauf, Urteilssatz
GET /api/v2/windows/week?city=&fuel=      7-Tage-Fenster: Zeiten, €, Sterne,
                                          Sicherheit, Tank-Abgleich

Erklärung (die Erklär-Treppe als API)
GET /api/v2/explain/decision/{id}         Ebene 1+2 zu einer Empfehlung:
                                          3 Sätze, Mini-Visual-Daten,
                                          Labor-Tiefenlink (Abschnitt+Anker)
GET /api/v2/explain/window/{id}           dasselbe für ein Fenster
GET /api/v2/explain/balance?month=        dasselbe für eine Bilanz-Zahl

Labor & Lernen
GET /api/v2/learn                         Labor-Inhalt: alle Abschnitte
                                          (Sätze, Visual-Daten, Aufgaben)
GET /api/v2/learn/glossary                Glossar: Stufen-Texte + „Wo du
                                          das siehst“-Verweise
GET /api/v2/diary?filter=&limit=          Prognose-Tagebuch: Vorhersage →
                                          Realität, Notizen
GET /api/v2/trust?city=&fuel=             Vertrauens-Konto: Trefferquoten,
                                          Soll/Ist, Stufe A/B/C
POST /api/v2/learn/simulate               Was-wäre-gewesen: Strategie ×
                                          Zeitraum → Ergebnis (Spielplatz)

Ich & Fahrzeug
GET/PUT /api/v2/vehicle                   Fahrzeug + Profile (statt
                                          verstreuter Präferenzen)
GET /api/v2/balance?month=&year=          Bilanz + Vergleichsmaßstäbe +
                                          Erklär-Links

Echtzeit (neu)
SSE  /api/v2/stream/prices?city=&fuel=    Preis-Ticks (statt Polling),
                                          inkl. „Collector still seit …“
SSE  /api/v2/stream/ops                   System-Ereignisse (Lauf fertig,
                                          Störung da/weg)

System (Technik-Bereich)
GET /api/v2/ops/status                    4 Bausteine + Störungen +
                                          Checklisten
GET /api/v2/ops/coverage                  Datenabdeckung + Lücken
GET /api/v2/ops/runs?limit=               Läufe + Protokoll-Auszüge
POST /api/v2/ops/runs/{job}/start         Startknopf (wie bisher, Version 2                Diagnose-Bündel (eine Datei)
```

**Querschnitt:** Einheitliches Hüllformat (`data`, `freshness{as_of,next,
stale}`, `explain_url` an jeder Zahl mit Ebene 1); ETag + `max-age` nach
Änderungsrhythmus (Preise kurz, Fenster mittel, Labor lang); Version 2
neben Version 1, bis die neue GUI flächendeckend läuft.

---

## 13. Mobil, Desktop, PWA

- **Mobil (Primärfall Säule):** Bottom-Navigation (6 Punkte, 44-px-Ziele),
  eine Spalte, Bottom-Sheets für Ebene 1, Sticky-Primärhandlung nur in
  Jetzt („Navigieren“). Querformat: Tagesstreifen/Kalender werden
  zweizeilig, keine neue Seite.
- **Desktop (Primärfall Labor + Woche):** Seitenleiste links (6 Bereiche +
  Labor farblich abgesetzt), Inhalt 2-spaltig (Kern + Einordnung daneben
  statt darunter), Ebene 1 als Seitenpanel rechts (statt Sheet). Labor als
  ruhige Lese-Spalte mit Sprungleiste oben.
- **PWA:** installierbar, Offline-Lesen des letzten Stands (alle 6 Bereiche
  cachen ihren letzten `overview`/`atlas`/…), Offline-Warteschlange für
  Belege („wird gesendet, sobald online“), Update-Banner
  („Neue Version — was ist neu?“ + Neu-laden).
- **Geteilte Links:** Jede Ansicht ist eine URL (`/jetzt`, `/station/{id}`,
  `/woche?fenster=…`, `/labor#sicherheit`), „Teilen“-Knopf
  kopiert Kurz-Link mit aktuellem Stand (read-only, LAN).

---

## 14. Barrierefreiheit

Über den heutigen Stand hinaus (AA-Kontraste, Fokus-Ringe, 44-px-Ziele):

- **Jede Farbe hat einen Partner:** Ampel = Farbe + Symbol + Wort; Sterne =
  Sterne + Wort („ziemlich sicher“); Charts = Linie + Textfassung
  („So liest du das“ + Datentabelle auf Wunsch).
- **Lesereihenfolge = Sehreihenfolge:** Entscheidung → Fakten → Schritte
  (keine visuellen Sprünge per CSS-Grid, die Screenreader verwirren).
- **Bewegungsarmut respektiert:** `prefers-reduced-motion` schaltet alle
  Übergänge ab; Zahlen-Änderungen werden dann nur angesagt, nicht animiert.
- **Labor ist lesbar, nicht nur sichtbar:** Alle Diagramme mit Langtext,
  alle Aufgaben mit Tastatur lösbar, Glossar als echte Definitionsliste.
- **Schriftgröße:** System-Schriftgröße wird respektiert (keine px-Fixierung
  der Fließtexte), Dichte-Umschalter (kompakt/bequem) unter Ich.

---

## 15. Woran wir merken, dass es besser ist (UX-KPIs)

Keine Bauchgefühle — messbare Ziele (lokal, ohne Tracking-Anbieter):

| Ziel | Messung | Richtwert |
|---|---|---|
| S1 in ≤ 10 s entscheidbar | Zeit bis erste Handlung in Jetzt (lokal, opt-in) | Median ≤ 10 s |
| Begründung wird gefunden | Anteil „Warum?“-Öffnungen je Empfehlung | > 15 % |
| Labor wird genutzt | Aufklapp-Rate je Abschnitt, „Verstanden“-Quote | > 25 % klappen je Monat mind. einen Abschnitt auf |
| Vertrauen wächst | „Verstanden“-Rückmeldungen im Labor + Wiederkehr | trinär: verstanden / teilweise / nein — > 70 % verstanden |
| Weniger Suchen | Wechsel in System ohne Störung („Verlaufen“) | < 5 % der Sitzungen |
| Ehrlichkeit wirkt | Anteil grauer Empfehlungen, die Nutzer als „hilfreich“ bewerten | > 60 % |
| Barrierefreiheit | Lighthouse-A11y + Tastatur-Durchgang je Release | 100 / Durchgang ohne Maus möglich |

Alle Messungen **lokal und einwilligungsfrei möglich** (Zähler im Browser /
Server-Log-Aggregate, keine Drittanbieter, Opt-out unter Ich → Daten).

---

## 16. Migrationspfad: in 4 Phasen vom Alten zum Neuen

Mutig statt parallel (Entscheidung 14.9.): **Tab für Tab ersetzen, kein
Feature-Schalter, keine doppelte Pflege.** Jeder Schritt ersetzt einen alten
Bereich vollständig — alte Views werden sofort entfernt:

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **0. Fundament** | Baustein-Bibliothek (Ebene-1-Sheet, Karten, Frische-Fußzeile), API-v2-Hülle + `overview`, Labor-Farbwelt als Theme | Neue Teile sind baubar, alte GUI noch unverändert |
| **1. Jetzt + Stationen** | Neue Bereiche ersetzen den Entscheidungs- und Listenteil des Alltags | S1 + S2 neu, alter Code entfernt |
| **2. Woche + Ich** | Fenster-Kalender, Tankstand, Belege/Bilanz/Einstellungen neu; Rest des Alltags + Einstellungen ersetzt | Alltag vollständig neu |
| **3. Labor** | Alle 5 Abschnitte + Tagebuch + Spielplatz + Glossar auf einmal; Erklär-Treppe an alle Zahlen angeschlossen; alte Werkstatt ersetzt | Mathematik getrennt und lernbar |
| **4. System** | Technik-Bereich in neue Bausteine überführt (Inhalt bleibt vollständig); API v1 stilllegen, PWA-Ausbau, UX-KPIs auswerten | Ein System, ein Stand |

**Regel je Phase:** Kein Bereich geht live, ohne dass seine Hilfe-Seite,
seine Leer-/Fehler-Zustände und sein Labor-Anschluss (mind. Ebene 1) fertig
sind. Lieber ein Bereich weniger als ein halber mehr.

---

## 17. Was der Entwurf bewusst aufgibt

Damit die Diskussion ehrlich ist — diese bisherigen Festlegungen stellt der
Entwurf infrage oder ersetzt sie:

1. **Die 4 Tabs Alltag/Werkstatt/System/Einstellungen** → ersetzt durch
   6 Aufgaben-Bereiche (§4). „Einstellungen“ als Haupttab entfällt
   ersatzlos (wohnt unter Ich + am Wirkungsort); „System“ bleibt.
2. **Die ≤-3-Zahlen-Regel** → ersetzt durch die 1+3+N-Regel (§2.7):
   1 Entscheidung, 3 Fakten, N nächste Schritte. Informativer, aber fester
   strukturiert.
3. **Prozent als primäre Sicherheit** → Worte und Sterne zuerst, Prozent auf
   Nachfrage (§5.1). Das Prozent bleibt — es drängelt sich nur nicht vor.
4. **Das binäre Kalibrierungs-Gate** → drei Ehrlichkeits-Stufen A/B/C (§10):
   „Lernend“ mit Fortschritt statt Schweigen bis zum Stichtag.
5. **Werkstatt als Kennzahlen-Sammlung** → Labor als Aufklapp-Seite (§6):
   geführte Abschnitte statt Panel-Stapel, Fehler als Ausstellungsstücke.
6. **Modul-nahe API-Namen als GUI-Struktur** (`decide`, `stats/summary`,
   `health` als Seiten) → aufgabenbezogene Aggregate (§12). Die GUI folgt
   nicht mehr der Server-Dateiablage.
7. **Einstellungen als Ort** → Einstellungen am Wirkungsort (§4.2). Was man
   einstellt, sieht man, wo es wirkt.
8. **Sample-GUIs als Homepage-Basis** → Die beiden Prototypen bleiben als
   Ideenspeicher erhalten, aber der Neuentwurf übernimmt nicht mehr ihr
   Seitenmodell — nur bewährte Bausteine (Karten-Ästhetik, SVG-Chart-Stil).
9. **Erinnerungen, Alarme und Push** → ersatzlos gestrichen (§11). Die App
   pingt nicht; Störungen stehen als Text im System-Tab.

---

## 18. Offene Entscheidungen

Entschieden am 14.9. (Mockup-Runde 1) — und was noch offen ist:

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Woche eigener Bereich oder Teil von Jetzt? | **Eigener Bereich.** |
| 2 | Labor-Farbe Violett oder Smaragd? | **Egal** — Violett bleibt (leicht änderbar). |
| 3 | Prozent in Jetzt sichtbar? | **Ja** — Worte + Prozent ab Stufe A. |
| 4 | Bilanz-Maßstab: Median oder meistgenutzte Station? | **Beide** — Median als Standard, meistgenutzte darunter. |
| 5 | Erinnerungen/Push? | **Gestrichen** — vorerst ganz ohne (§11). |
| 6 | System verstecken oder prominent? | **Prominent** — bleibt 6. Haupttab. |
| 7 | Migration hinter Schalter oder direkt ersetzen? | **Direkt ersetzen**, Tab für Tab (§16). |
| 8 | Labor-Umfang: alles oder kleiner Start? | **Alles auf einmal**, aber als Aufklapp-Seite statt Pfad (§6). |
| — | Lernpfad vs. Aufklappen? | **Aufklappen reicht** — eine Labor-Seite, kein Fortschritt. |

---

**Verbleibend offen:** Feedback zur Mockup-Runde 2 (diese Version) —
insbesondere: Ist die Labor-Seite als Aufklapp-Seite übersichtlich genug?
Fehlt in Woche ohne Erinnerung etwas? Danach: eine Ansicht als
Produktions-Prototyp mit echten Daten (Nagelprobe für Raster, Bausteine
und Erklär-Treppe).
hren — als Nagelprobe für Raster,
Bausteine und Erklär-Treppe.*
 der heutigen API) überführen — als Nagelprobe für Raster,
Bausteine und Erklär-Treppe.*
hren — als Nagelprobe für Raster,
Bausteine und Erklär-Treppe.*
nd Erklär-Treppe.*
lprobe für Raster,
Bausteine und Erklär-Treppe.*
nd Erklär-Treppe.*
reppe.*
nd Erklär-Treppe.*
er,
Bausteine und Erklär-Treppe.*
nd Erklär-Treppe.*
