# Befund 19.09.2026 — UX-Vision und mathematische Tiefenprüfung

> Stand: 19.09.2026 · App-Version **0.55.1** · Stichtagsprüfung gegen den
> Arbeitszweig `arena/01a0b83e-tankapp` (Basis `main` @ `be3c912`).
> Rollen: Senior UI/UX-Design + Data Science. Zwei Fragen: Wie muss die
> Seitenstruktur aussehen, damit Kunden in 5 Sekunden wissen, **wann und wo**
> sie tanken — und greift die Statistik (Huber-M-Schätzer, isotone
> Regression, Beta-Binomial-Updating) methodisch konsistent ineinander?
> Dieser Befund ist eine Diskussionsvorlage wie
> [UI-NEUENTWURF.md](UI-NEUENTWURF.md); er ersetzt weder Konzept noch
> Analyse-Referenz.

## Inhaltsverzeichnis

- [0. Kurzfassung](#0-kurzfassung)
- [Teil 1: UX-Konzept](#teil-1-ux-konzept)
  - [1.1 Ist-Analyse: die sechs Bereiche](#11-ist-analyse-die-sechs-bereiche)
  - [1.2 Leitidee: zwei Welten, ein Übergang](#12-leitidee-zwei-welten-ein-übergang)
  - [1.3 Navigation: 3+1 statt sechs gleichberechtigter Tabs](#13-navigation-31-statt-sechs-gleichberechtigter-tabs)
  - [1.4 Text-Wireframes](#14-text-wireframes)
  - [1.5 Die Statistik-Sicht: Parametrschrank statt Riesen-Akkordeon](#15-die-statistik-sicht-parametrschrank-statt-riesen-akkordeon)
  - [1.6 Was der Entwurf bewusst nicht ändert](#16-was-der-entwurf-bewusst-nicht-ändert)
  - [1.7 Migrationspfad](#17-migrationspfad)
- [Teil 2: Mathematische Tiefenanalyse](#teil-2-mathematische-tiefenanalyse)
  - [2.1 Die Kette im Überblick](#21-die-kette-im-überblick)
  - [2.2 Baustein-Audit: was korrekt und gut gebaut ist](#22-baustein-audit-was-korrekt-und-gut-gebaut-ist)
  - [2.3 Methodische Lücken M1–M8](#23-methodische-lücken-m1m8)
  - [2.4 Overfitting-Risiken](#24-overfitting-risiken)
  - [2.5 Konsistenz-Urteil](#25-konsistenz-urteil)
  - [2.6 Korrekturvorschläge im Überblick](#26-korrekturvorschläge-im-überblick)
- [Teil 3: Nächste Schritte](#teil-3-nächste-schritte)
- [Teil 4: Batch-Plan](#teil-4-batch-plan)
- [Anhang: Prüfprotokoll](#anhang-prüfprotokoll)

---

## 0. Kurzfassung

**UX.** Die seit 0.36.0 gelieferte Sechs-Bereiche-GUI ist aufgabenorientiert
und handwerklich stark (Erklär-Treppe, ehrliche Zustände, Labor als eigene
Welt). Ihr Konstruktionsfehler ist die **Gleichberechtigung**: sechs
Hauptbereiche suggerieren sechs gleich wichtige Welten, obwohl 95 % der
Sitzungen nur drei Fragen stellen — *Jetzt oder warten? Wo? Diese Woche?*
Der Vorschlag komprimiert die Kunden-Nav auf **3 Aufgaben + 1 Studio-Eingang**
(Ich, System, Labor, Glossar hinter einer Tür) und gliedert das Labor intern
in vier Sub-Tabs mit einem **Parameterschrank**: eine Karte je
Modellbaustein, Diagramm und Rohdaten strikt getrennt, Rohdaten immer
eingeklappt und exportierbar (§1.3–1.5, mit Text-Wireframes).

**Mathematik.** Die Bausteine sind einzeln **korrekt implementiert**:
Huber-IRLS mit richtigen Gewichten und MAD-Skala, Yule-Walker-AR(2) mit
Stabilitätsnetz, PAVA als exakte L2-Projektion für die 12-Uhr-Regel,
Tagesblock-Bootstrap mit exponentiellen Ziehgewichten, LOO-Median-Baseline,
Einseitige Bootstrap-p-Werte mit B=2000 plus Benjamini-Hochberg-FDR, und der
Ledger-Schätzer `(hits+5)/(n+10)` ist exakt der Posterior-Mittelwert eines
Beta(5,5)-Binomial-Updates (§2.2). Die **Nähte** zwischen den Bausteinen
tragen jedoch vier methodische Brüche mit Nutzerwirkung: die
Wahrscheinlichkeiten sind bauartbedingt unkalibriert, fließen aber
ungefiltert in die €-P-Entscheidungstabelle (**M1**, der Zentralbefund);
Mehrtagesprognosen ziehen Tage unabhängig und kennen keine „günstige Woche“
(**M2**); die €-Ersparnis rechnet über das Fenster-**Median**, die
Prozentzahl über das Fenster-**Minimum** — dieselbe Empfehlung spricht mit
zwei Maßstäben (**M3**); der Ensemble-Punktwert mischt zwei Modellkerne,
die Verteilung stammt aber nur aus einem (**M4**). Dazu zwei kleinere
Anschlüsse (**M5** Nowcast trotz frischem Live-Preis, **M6** Rolle des
Beta-Binomial-Updates) und zwei Strukturbeobachtungen (**M7**
Hyperparameter-Zoo, **M8** erster Winter nach der 12-Uhr-Regel ohne
Trainingsdaten). Overfitting-Risiko: im Strukturmodell gering, in der
Entscheidungs-/Schwellenschicht mittel (§2.4).

**Nächste Schritte.** (1) Kalibrierungsschicht: isotone Rekalibrierung der
Bootstrap-Verteilung — die PAVA-Implementierung der 12-Uhr-Regel lässt sich
dafür wiederverwenden. (2) € und P auf dasselbe Fenster-Funktional einigen
und den Nowcast am Live-Preis konditionieren. (3) Navigation auf 3+1
reduzieren und das Labor in vier Sub-Tabs mit Parameterschrank umbauen
(§Teil 3).

---

# Teil 1: UX-Konzept

## 1.1 Ist-Analyse: die sechs Bereiche

Geprüft gegen Code-Stand 0.55.1 (`web/src/views/*`, `AppNav.tsx`,
`routing.ts`, `lab.ts`, [UI-NEUENTWURF.md](UI-NEUENTWURF.md)):

| Bereich | Datei (Zeilen) | Inhalt | Urteil |
|---|---|---|---|
| Jetzt | `Jetzt.tsx` (1111) | Feedback-Banner, Ampel-Karte, Heute-im-Blick (Streifen), Stationszeilen, Umweg | Kern richtig; die Seite trägt aber Entscheidung **und** Vergleich **und** Tagesstreifen **und** Rückmeldung — vier Aufgaben auf einem Scroll |
| Stationen | `Stationen.tsx` (1060) | Set, Karte, Vergleich, Detail | solide; Überschneidung mit „Jetzt“ (Stationszeilen doppeln) |
| Woche | `Woche.tsx` (534) | Fenster-Kalender, Top-3 | schlank, fast fertig |
| Ich | `Ich.tsx` (760) | Tankstand, Belege, Bilanz, Profile | eigene Welt — im Alltag selten gebraucht |
| Labor | `Labor.tsx` (1760) | Vertrauens-Konto + 5 Aufklapp-Abschnitte + Spielplatz in **einer** View | die größte View der App; mischt Erklärung, Parameter, Kalibrierung, Heatmap, Rohdaten |
| System | `System.tsx` (1071) | Zustand, Läufe, Störungen | Admin-Welt, 95 % der Sitzungen brauchen sie nie |

**Stärken, die erhalten bleiben müssen:** die Erklär-Treppe
(Antwort → Begründung → Beweis), die ehrlichen Zustände (`no_advice` mit
Grund, Datenalter je Zahl), das Labor als optisch getrennte Welt, das
URL-Routing (`?tab=…&section=…`), die eine Alltagssprache
([MICROCOPY.md](MICROCOPY.md)).

**Die vier Konstruktionsfehler:**

1. **Gleichberechtigungs-Fiktion.** Sechs Items in der Bottom-Bar behaupten,
   Alltag (Jetzt/Woche/Stationen), Buchhaltung (Ich), Forschung (Labor) und
   Betrieb (System) wären gleich wichtig. Für die Kernfrage „Wann und wo
   tanke ich?“ sind drei zuständig — die anderen drei belegen dauernd
   Aufmerksamkeit und Bildschirmbreite.
2. **Labor ist eine 1760-Zeilen-Einseiter.** Fünf Aufklapp-Abschnitte plus
   Spielplatz teilen sich eine Scrollfläche. Wer einen bestimmten Parameter
   sucht (z. B. die Ensemble-Gewichte), weiß nie, in welchem Abschnitt er
   steckt; wer nur die Heatmap will, lädt alles mit. Diagramme,
   Parameterwerte und Roh-Tabellen stehen unsortiert nebeneinander — genau
   das im Auftrag genannte „visuelle Überfordern“.
3. **Stationszeilen-Dopplung.** „Jetzt“ zeigt Stationszeilen, „Stationen“
   zeigt dieselben Daten ausführlicher. Zwei Orte, eine Wahrheit — der
   Nutzer lernt nicht, welchem er trauen soll.
4. **Mathematik sickert über die Begründung ins Labor-Sammelsurium.** Die
   Erklär-Treppe springt in einen von fünf Abschnitten derselben Seite — das
   Ziel ist korrekt, aber der Zielort selbst ist unstrukturiert (Punkt 2).

## 1.2 Leitidee: zwei Welten, ein Übergang

- **Welt 1 — Tanken (Kunde):** drei Bildschirme, jeder beantwortet genau
  eine Frage mit einer Handlung. Keine Formel, kein Parameter, kein
  Rohdatum. Maßstab: an der Säule in ≤ 5 Sekunden lesbar.
- **Welt 2 — Verstehen & Betreiben (Studio):** Labor, Ich, System, Glossar
  hinter **einem** Eingang. Das Studio ist kein Tab zweiter Klasse, sondern
  der Maschinenraum — sichtbar erreichbar, aber nicht dauerpräsent.
- **Der Übergang ist die Erklär-Treppe.** Jede Zahl in Welt 1 trägt ein
  „Warum?“; es öffnet die Ebene-1-Begründung und von dort den Sprung ins
  Labor. Wer nie ins Studio geht, verliert nichts. Wer hineingeht, findet
  Struktur statt Scroll.

Drei Gestaltungsregeln für Welt 1:

1. **Eine Entscheidung pro Bildschirm, oben, farbig.** Die Ampel-Karte ist
   das erste Element, nie das dritte.
2. **1 + 3 + 1.** Eine Entscheidung, drei stützende Fakten, eine
   nächste Handlung. Alles darüber gehört auf einen anderen Bildschirm.
3. **Vergleich nur dort, wo entschieden wird.** Die Umweg-Zeile bleibt in
   „Jetzt“ (sie ist Teil der Entscheidung), die Stations-Liste wandert
   vollständig nach „Stationen“ — keine Dopplung mehr.

## 1.3 Navigation: 3+1 statt sechs gleichberechtigter Tabs

```text
Bottom-Bar (mobil, immer sichtbar)          Seitenleiste (Desktop)
┌────────┬────────┬────────┬─────┐
│ Jetzt  │ Woche  │Statio- │ ⋯   │        Jetzt · Woche · Stationen
│  (●)   │        │  nen   │Mehr │        ─────────────────────────
└────────┴────────┴────────┴─────┘        Studio: Labor · Ich · System · Glossar
```

| Eintrag | Beantwortet | Tritt ein für |
|---|---|---|
| **Jetzt** | Jetzt oder warten? Hier oder woanders? | S1, S2-Kern |
| **Woche** | Wann in den nächsten Tagen? | S3 |
| **Stationen** | Welche Station, Karte, Verlauf, Vergleich | S2-Vertiefung |
| **Mehr → Studio** | Labor, Ich, System, Glossar | S4, S5 |

Begründung: Die Hauptnavigation ist ab jetzt ein Abbild der drei
Kernfragen des Konzepts (F1/F2 → Jetzt, F3 → Woche, Ort → Stationen).
„Ich“ und „System“ sind Verwaltung — sie verlieren nichts, wenn sie einen
Tipper tiefer liegen (ein Blatt „Studio“ mit vier Zeilen); das Labor
gewinnt, weil sein Eingang nicht mehr zwischen Alltags-Tabs um Aufmerksamkeit
konkurriert. URL-Schema bleibt kompatibel: `?tab=…` weiter gültig,
`labor`/`ich`/`system` bleiben erreichbar und teilbar.

## 1.4 Text-Wireframes

Alle Skizzen mobile-first (eine Spalte, 390 px gedacht); Desktop nutzt
dasselbe Raster zweispaltig (links Kern, rechts Einordnung). Jede Ansicht
folgt dem Skelett **Kopf → Kern → Einordnung → Handlung**.

### 1.4.1 „Jetzt“ — der Entscheidungsbildschirm

```text
┌──────────────────────────────────────┐
│ ☰  TankApp      Frankfurt · E10  ●   │ ← 1 Zeile: Stadt/Sprit hinter
├──────────────────────────────────────┤   einem Blatt (C13-Folge),
│ ┌──────────────────────────────────┐ │   Status-Punkt = Datenfrische
│ │  ⏳ WARTEN BIS 18–20 UHR         │ │ ← Ampel-Karte 3.0 (Kern)
│ │  Sparen ≈ 2,40 € · 78 % sicher   │ │   1 Aktion · 1 Fenster · 1 € · 1 %
│ │  Shell Musterstraße · jetzt 1,719│ │
│ │  [Warum?]     [Dorthin navigieren]│ │ ← „Warum?“ = Ebene 1 der Treppe
│ └──────────────────────────────────┘ │
│ Heute im Blick                       │
│  Jetzt 1,719 · Tief erwartet 1,679   │ ← 3 Fakten als Zeilenliste
│  um 18–20 Uhr · Chance auf fallenden │   (wie seit 0.53.0)
│  Preis 78 %                          │
│  [Tagesstreifen 06–24 h ▸]           │ ← einklappbar, nicht default-offen
├──────────────────────────────────────┤
│ Lohnt sich der Umweg?                │ ← F2, max. 2 Zeilen + Link
│  1. Esso Nordring  +1,10 € netto     │
│  2. Jet Berliner Str. +0,60 € netto  │
│  Alle vergleichen ▸ (→ Stationen)    │
├──────────────────────────────────────┤
│ [Jetzt] [Woche] [Stationen] [⋯ Mehr] │
└──────────────────────────────────────┘
```

Regeln: Ohne Empfehlung steht in der Kernkarte ehrlich „Keine klare
Empfehlung — tank nach Bedarf“ plus Grund (`quality_gate`, `gray_zone`, …).
Der Tagesstreifen ist die einzige Visualisierung auf diesem Bildschirm und
standardmäßig eingeklappt — die Entscheidung braucht ihn nicht. Die
Stationszeilen-Liste entfällt hier vollständig (sie lebt in „Stationen“);
nur die Umweg-Zeile bleibt, weil sie Teil von F1/F2 ist.

### 1.4.2 „Woche“ — der Zeit-Planer

```text
┌──────────────────────────────────────┐
│ Woche                     Frankfurt ·E10│
├──────────────────────────────────────┤
│ Bestes Fenster der Woche             │ ← Kern: eine Antwort oben
│  Sa 06–08 Uhr · ~1,659 €/L · 4,10 €  │
│  unter „jetzt tanken“                │
├──────────────────────────────────────┤
│ Mo  ▓▓░░░▓▓▓░░  günstig 18–20        │ ← 7 Zeilen, je Tag eine
│ Di  ▓▓▓░░▓▓░░░  günstig 06–08        │   Mini-Zeitleiste (06–24 h),
│ …                                    │   grün = günstige 2-h-Fenster
│ So  ░░░░▓▓▓░░░  günstig 17–19        │
├──────────────────────────────────────┤
│ Top 3 Fenster (nächste 7 Tage)       │ ← F3, aus window_p (normiert)
│  1. Sa 06–08 · 2. Mo 18–20 · 3. …    │
│  [Warum diese Fenster?]              │
├──────────────────────────────────────┤
│ [Jetzt] [Woche] [Stationen] [⋯ Mehr] │
└──────────────────────────────────────┘
```

Regel: Die 7-Tage-Zeilen zeigen **Vergangenheitsprofil und Prognose
getrennt eingefärbt** (Prognose gestrichelt/markiert, mit Legende in einer
Zeile) — die Heatmap ist Vergangenheit, die Fenster sind Prognose; beide
Sprachen dürfen sich nicht mischen (siehe [ANALYSE.md](ANALYSE.md),
Heatmaps sind „Analyse-, keine Entscheidungswerkzeuge“).

### 1.4.3 „Stationen“ — der Preis-Atlas

```text
┌──────────────────────────────────────┐
│ Stationen              Karte | Liste │ ← Umschalter, kein Doppelaufbau
├──────────────────────────────────────┤
│ [Karte: Netto-€-Pins, Radius, Filter]│
│  oder                                │
│ Liste (sortierbar)                   │
│  1. Shell Musterstr.  1,719 −3 ct ▲▼ │
│  2. Esso Nordring     1,729 −2 ct ▲▼ │
│     ▸ Verlauf · Tagesprofil · Pinnen │
├──────────────────────────────────────┤
│ Vergleich: A gegen B                 │ ← bewusst hier, nicht in „Jetzt“
│  [Preisverlauf übereinander, Netto-€]│
├──────────────────────────────────────┤
│ [Jetzt] [Woche] [Stationen] [⋯ Mehr] │
└──────────────────────────────────────┘
```

Stationen ist der **einzige** Ort der Stationsliste; „Jetzt“ verlinkt nur
noch dorthin („Alle vergleichen ▸“). Das Detail (Verlauf 7 Tage,
Tagesprofil, δ̂-Einordnung) bleibt je Zeile aufgeklappt erreichbar — aber
das δ̂ selbst (Labor-Inhalt) erscheint hier nur als „meist günstiger
Vergleichswert“ in Alltagssprache mit Sprung ins Labor.

### 1.4.4 Studio-Eingang, „Ich“ und „System“

```text
┌──────────────────────────────────────┐
│ Studio                               │
├──────────────────────────────────────┤
│ 🧪 Labor      Verstehen, warum die   │ ← eigener Akzentfarbton wie heute
│               App das sagt           │
│ 🚗 Ich        Tankstand · Belege ·   │
│               Bilanz · Profile       │
│ 🖥 System     Zustand · Läufe ·      │
│               Störungen              │
│ 📖 Glossar    Alle Begriffe A–Z      │
└──────────────────────────────────────┘
```

„Ich“ und „System“ bleiben innerlich unverändert (sie funktionieren); sie
verlieren nur ihren Haupttab-Status. Alarm-Pille und Update-Banner bleiben
im globalen Header, damit Betriebsstörungen auch ohne Studio-Besuch
sichtbar sind.

## 1.5 Die Statistik-Sicht: Parametrschrank statt Riesen-Akkordeon

Das Labor wird von **einer** 1760-Zeilen-Seite mit fünf Akkordeons in
**vier Sub-Tabs** mit fester Aufgabe zerlegt. Die Erklär-Treppe springt
dann direkt in den Sub-Tab (URL: `?tab=labor&section=modell#ensemble`).

```text
Labor-Kopf (in jedem Sub-Tab sichtbar)
│ Vertrauens-Konto: „Von 120 Empfehlungen trafen 89 zu“ · M7-Gate-Status
├─────────────────────────────────────────────────────────────────────┤
│ [Überblick] [Modell & Parameter] [Güte & Kalibrierung] [Daten & Roh] │

SUB-TAB 1 · Überblick (der geführte Einstieg, S4)
  · Prognose-Tagebuch („was gesagt, was passiert ist“)
  · Fan-Chart geführt: eine Prognose, drei Erklärstufen
  · „Was sagt die App vorher?“ in 3 Sätzen

SUB-TAB 2 · Modell & Parameter  ← der Parametrschrank
  Eine Karte je Modellbaustein, feste Reihenfolge = Modellkette:
  ┌────────────────────────────────────────────────────────────────┐
  │ 1 Strukturmodell (Huber-IRLS)                                  │
  │   Satz: „Robuste Tagesform: 2 Harmonischen + Wochentage +      │
  │          Feiertag + Zeit seit Preissprung — Ausreißer zählen   │
  │          gedämpft.“                                            │
  │   [Diagramm: gefittete Tageskurve vs. Medianprofil]            │
  │   ▸ Parameter (eingeklappt): β-Vektor 13 Werte, Holiday-γ,     │
  │     Trainingsfenster 42 d, Konvergenz — als Tabelle + CSV      │
  ├────────────────────────────────────────────────────────────────┤
  │ 2 Kurzfrist-Dynamik AR(2)                                      │
  │   [Diagramm: Korrekturpfad ab Cutoff, Zerfall]                 │
  │   ▸ Parameter: φ₁, φ₂, Wurzeln, Zustand, Stabilitäts-Eingriffe │
  ├────────────────────────────────────────────────────────────────┤
  │ 3 Unsicherheit (Tagesblock-Bootstrap)                          │
  │   [Fan-Chart 24 h mit q025…q975]                               │
  │   ▸ Parameter: B, HWZ 14 d, min_slot_days, shared draws        │
  ├────────────────────────────────────────────────────────────────┤
  │ 4 Rechtliche Projektion (12-Uhr-Regel, isotone Regression)     │
  │   [Diagramm: projizierter Verlauf mit Segmentkanten]           │
  │   ▸ Parameter: law_floor, Verstöße (law_rise_outside_noon)     │
  ├────────────────────────────────────────────────────────────────┤
  │ 5 Ensemble (zwei Modellkerne)                                  │
  │   [Balken: Gewichte + MASE je Kern, Fenster]                   │
  │   ▸ Parameter: weights, mase, n_eval, method                   │
  ├────────────────────────────────────────────────────────────────┤
  │ 6 Stations-Selektion δ̂                                         │
  │   [Diagramm: δ̂-Ranking mit Bootstrap-KI-Whiskern]              │
  │   ▸ Parameter: q-Werte, Coverage-Gate, EW-HWZ, CUSUM-Flags     │
  ├────────────────────────────────────────────────────────────────┤
  │ 7 Entscheidungsschwellen (M7)                                  │
  │   [Diagramm: Trefferquoten vs. Ziel, Rauschband]               │
  │   ▸ Parameter: 9 Schwellen aktiv/Basis, Bounds, Schritte,      │
  │     Beta-Posterior des Fallback-Schätzers (hits+5)/(n+10)      │
  └────────────────────────────────────────────────────────────────┘
  Jede Karte folgt derselben Anatomie: 1 Satz Alltagssprache →
  1 Diagramm → 1 Aufklapp-„Parameter“ (Tabelle, nie nacktes JSON) →
  Formel-Ebene hinter „Methode“ (details-Tag, wie heute §6.3).
  Spielplatz (Was-wäre-wenn: ε-Regler, eigene Zeiträume) bleibt eigener
  Bereich unten im Sub-Tab, klar abgetrennt.

SUB-TAB 3 · Güte & Kalibrierung
  · Rolling-PICP-Badges je Station (7 d, Hysterese wie heute)
  · Reliability-/Kalibrierungs-Chart (CalibChart), Brier-Verlauf,
    M7-Gate-Historie, Backtest-Scoreboard (MASE/Pinball je Horizont)
  · Heatmaps (Niveau & Cheap-Probability) — Vergangenheit, Analyse

SUB-TAB 4 · Daten & Rohdaten
  · Datenreichweite, Abdeckung, Lücken, Stations-Set, Polling-Plan
  · Roh-Tabellen: Veröffentlichung je Station (Quantile, Draws-
    Metadaten), Selektions-Artefakt, Ledger-Export — je als
    eingeklappte Tabelle mit CSV-Export; kein JSON-Browsing im Alltag
  · API-Explorer (für Entwickler) ganz unten
```

**Die zwei harten Regeln dieses Umbaus** (sie beantworten den Auftrag
„logisch und aufgeräumt, ohne zu überfordern“):

1. **Diagramm und Rohdaten teilen sich nie eine Ebene.** Diagramme stehen
   auf der Karten-Ebene; Rohdaten liegen eine Aufklapp-Ebene tiefer und sind
   immer exportierbar (CSV), nie abgetippt. Wer rechnen will, lädt; wer
   lesen will, schaut.
2. **Eine Karte = ein Baustein der Modellkette**, in der Reihenfolge der
   Kette (Struktur → AR(2) → Bootstrap → Projektion → Ensemble → Selektion
   → Schwellen). Die Karte ist die Antwort auf „welcher Parameter gehört
   wohin“ — heute muss man das in fünf Akkordeons suchen.

## 1.6 Was der Entwurf bewusst nicht ändert

- Die Erklär-Treppe, die Ehrlichkeits-Regel (hartes Gate), alle
  `no_advice`-Zustände und das Vokabular aus MICROCOPY.md.
- Das URL-Schema (`?tab=…`, `?section=…`) und die Teilbarkeit.
- Die Labor-Akzentfarbe als „andere Welt“-Signal.
- Die 12-Uhr-Bodenkante und alle Gesetz-Anzeigen — sie wandern nur von
  Akkordeon-Abschnitten in die Karten 4 (Projektion) und den Daten-Tab.

## 1.7 Migrationspfad

| Phase | Inhalt | Risiko |
|---|---|---|
| 1 | Bottom-Bar auf 3+1; Studio-Blatt; „Ich“/„System“ dorthin umziehen (Views bleiben) | niedrig — reine Nav-Arbeit, E2E `AppNav` anpassen |
| 2 | „Jetzt“ entschlacken: Stationszeilen raus, Streifen einklappbar, Umweg-Zeile bleibt | niedrig-mittel — O21-/Stations-Tests mitziehen |
| 3 | Labor in vier Sub-Tabs zerlegen (Views splitten, `LAB_SECTIONS` → Sub-Tab-Adressraum), Parameterschrank-Karten bauen | mittel — größter Brocken, je Sub-Tab ein PR |
| 4 | Rohdaten-Tab + CSV-Export konsolidieren, API-Explorer dorthin | niedrig |

UX-KPIs (Übernahme aus UI-NEUENTWURF §15, hier konkretisiert): Scrolltiefe
„Jetzt“ ≤ 1,5 Viewports mobil; Zeit-zur-Antwort in Nutzertests ≤ 5 s;
Labor-Aufrufe sinken im Alltag und steigen gezielt über „Warum?“; null
„Welcher Tab war das nochmal?“-Rückfragen.

---

# Teil 2: Mathematische Tiefenanalyse

## 2.1 Die Kette im Überblick

```text
Tankerkönig-Preise (5-Min-Raster, ffill ≤30 min, Hampel-Filter)
   │
   ├─ A Stations-Selektion (engine/selection.py)
   │    δ̂ = Zeit-Median LOO-Lücke → EW-Median (HWZ 7 d) → CUSUM-Flag
   │    Tages-Block-Bootstrap B=2000 (HWZ 14 d) → einseitige p → BH-FDR
   │
   ├─ B Strukturmodell (engine/models.py::fit)
   │    p(t) = μ + Harmonische₁,₂ + DoW + Mittags-Schritt(nach Gesetz)
   │           + γ·Feiertag (gepoolt, ≤365 d) + β₁₂·Zeit-seit-Sprung
   │    Huber-IRLS (k=1,345, MAD-Skala), 42-Tage-Fenster ab 12-Uhr-Bodenkante
   │
   ├─ C Kurzfrist-Dynamik: AR(2) auf Residuen (Yule-Walker, Stabilitätsnetz)
   │
   ├─ D Zweitkern + Ensemble: Slot-Median-Profil (288 Slots) ∓ AR(2);
   │    Gewichte ∝ 1/MASE aus 14-Tage-Eine-Schritt-Validierung
   │
   ├─ E Verteilung: Tagesblock-Bootstrap der Residuen (EW-Ziehung HWZ 14 d),
   │    gemeinsame Ziehung über Stationen (comonotone Kopplung)
   │
   ├─ F Projektion: 12-Uhr-Regel via PAVA (isoton fallend je [12→12)-Segment)
   │    auf Medianpfad, jeden Bootstrap-Pfad und jedes Quantil
   │
   ├─ G P-Seite (engine/probabilities.py, app/pside.py):
   │    p_besser = P(Fenstermin ≤ Anker − 1 ct), p_lohnt = P(Netto-€ > 0),
   │    Fenster-P = P(Fenster ≤ ±6-h-Umfeld), normiert auf Basisrate
   │
   └─ H Entscheidung & Lernen (app/decide.py, thresholds.py, feedback.py):
        €-P-Tabelle (9 Schwellen) → Advice-Ledger → Settlement →
        Brier/M7-Gate (nur Quelle „verteilung“) → Schwellen-Nachzug
        (MIN_N=25, Rauschband ±2 SE, Totband) ; Fallback-Schätzer
        (hits+5)/(n+10) = Beta(5,5)-Posterior-Mittelwert
```

## 2.2 Baustein-Audit: was korrekt und gut gebaut ist

Geprüft Zeile für Zeile gegen `engine/`, `app/`, `analysis/`
(Protokoll im Anhang):

| Baustein | Prüfung | Urteil |
|---|---|---|
| **Huber-IRLS** (`huber_fit`) | Gewichte `min(1, 1,345·s/|r|)` mit √w in WLS = exaktes Huber-IRLS; Skala `1,4826·MAD` (bodenstabil 0,05 ct/L); k=1,345 ≈ 95 % Effizienz unter Normalität; Abbruch 1e-8, max. 30 Iterationen | ✅ korrekt |
| **AR(2)** (`fit_ar2`) | Yule-Walker nur über lückenlose Tripel (keine Kovarianz-Schätzung über Löcher), Ridge-Störterm 1e-6·r₀, Schrumpfen ×0,9 bis Wurzelradius < 0,98 | ✅ korrekt; Eingriffs-Häufigkeit messen (siehe M7) |
| **Isotone Regression / PAVA** (`isotonic_decreasing`, `noon_law_projection`) | Korrekte L2-Projektion auf den Kegel nicht-steigender Folgen; Segmentierung [12:00→12:00) über Mitternacht hinweg richtig (Anstieg über Nacht ist ebenfalls unzulässig); NaN als Nicht-Barrieren-Regel gesetzestreu; Deduplizierung der Pfade bitgleich | ✅ korrekt und die eleganteste denkbare Abbildung der Rechtslage |
| **Tagesblock-Bootstrap** | Blöcke = ganze Tages-Residuenprofile → Intraday-Abhängigkeit bleibt erhalten; EW-Ziehung `0,5^(Alter/HWZ)` normiert; B=500 Draws für die P-Seite, B=2000 in der Selektion | ✅ korrekt für den Intraday-Fall; Tage untereinander unabhängig → M2 |
| **Gemeinsame Ziehung** (`shared_day_uniforms`) | Ableitbare Seed-Folge je (Horizont, Tagesposition), comonotone Kopplung über die eigene Blockverteilung je Station — Marktgleichlauf bleibt in p_lohnt | ✅ korrekt; Gegenmessung per Flag vorhanden |
| **LOO-Median-Baseline δ̂** | Eigener Preis nie in der eigenen Baseline (kein Self-Masking); Median robust gegen Sprung-Artefakte | ✅ korrekt |
| **Bootstrap-Inferenz δ̂** | p = (1+#)/(B+1) einseitig (Davison/Hinkley-Standard), B=2000 fest (F2-Blocker behoben), Benjamini-Hochberg über Stationen | ✅ korrekt; Korrelation der Baseline über Stationen nur durch BH aufgefangen — akzeptable Näherung |
| **Beta-Binomial-Updating** (`estimate_p`) | `(hits + 10·0,5)/(n + 10)` = `(hits+5)/(n+10)` = **exakt** Posterior-Mittelwert von `Beta(5,5) ⊗ Binomial(n, hits)`; Schätzung zur Emit-Zeit aus *früheren* Settlements (expanding window) → Brier darüber ist ehrlich sequenziell | ✅ korrekt und priorsauber; Rolle im System aber klein → M6 |
| **M7-Gate** | Seit O5 getrennte P-Quellen (Gate rechnet nur auf „verteilung“ — keine Selbsterfüllung), seit O6 Block-Bootstrap-KI des Brier gegen Basisrate/Klimatologie statt Punktvergleich | ✅ gut gebaut |
| **12-Uhr-Bodenkante** (B30) | Training der Intraday-Struktur nur ab Gesetzesbeginn — kein Mischen zweier Rechtslagen; `law_quality` ausgewiesen | ✅ wichtig und richtig |
| **Gleichstandsregel θ** (`threshold_credit`) | Halber Treffer auf der Schwelle, eine ε-Regel für p_besser, Settlement und Brier — keine Ansicht rechnet eigene Grenzen | ✅ konsistent |

**Zwischenfazit:** Kein Baustein ist mathematisch falsch implementiert. Das
System krankt nicht an den Verfahren, sondern an vier **Nähten** zwischen
ihnen (2.3) und an der Kalibrierungsfrage als rotem Faden.

## 2.3 Methodische Lücken M1–M8

### M1 — Kalibrierungslücke (Zentralbefund, Schwere: hoch)

**Befund.** Jede Prognose trägt `calibrated: false`, und
`validate_model()` **weist kalibrierte Artefakte sogar aktiv ab**
(`raise`, falls `calibrated is not False`). Zugleich fließen `p_besser` und
`p_lohnt` — reine Relative-Häufigkeiten über **unkalibrierten**
Bootstrap-Draws — ungefiltert in zwei entscheidende Stellen: die
€-P-Entscheidungstabelle (`wait_p_high ≥ 0,70` usw.) und die angezeigte
Prozentzahl nach dem M7-Gate. Das System kann Fehlkalkibration **messen**
(Rolling-PICP, Brier, O6-Intervall), aber nirgends **korrigieren**: Der
einzige Regelkreis (M7-Schwellen-Nachzug) verstellt die
Entscheidungs-Schwellen, nie die Wahrscheinlichkeiten.

**Warum das mehr ist als Kosmetik.** PICP misst die Abdeckung des
95 %-Bands; `p_besser` hängt aber am **unteren Rand der Fensterminimum-**
Verteilung. Ein Band kann 95 % treffen, während die 10–40 %-Quantile
systematisch verschoben sind — dann stimmt die Ampel-Logik nicht, obwohl
das Güte-Gate grün ist. Die Schwellen der Tabelle (0,70/0,60/0,50) sind
zudem als kalibrierte Wahrscheinlichkeitsgates gemeint („82 % sicher“ ist
ein Versprechen); auf unkalibrierten Draws sind sie Glücksache.

**Korrekturvorschlag.** Rekalibrierungsschicht zwischen Bootstrap und
P-Seite, mit Bordmitteln: **isotone Regression auf der PIT-Historie.** Die
PAVA-Implementierung der 12-Uhr-Regel (`isotonic_decreasing`) ist bereits
getestet und performant; dieselbe L2-/Ordnungs-Projektion auf die Paare
„vorhergesagtes Quantil ↔ beobachteter Rang“ liefert eine monotone
Kalibrierungsabbildung (Standardverfahren: quantile recalibration à la
Gneiting et al.). Alternativ, einfacher zu beginnen: **split-conformal** auf
den Rolling-Backtest-Residuen je Horizont, skaliert auf die Bootstrap-Draws.
Danach bekommt das Artefakt ehrlich `calibrated: true` (das `validate`-Veto
fällt), und die €-P-Tabelle arbeitet erstmals auf dem, was ihre Schwellen
semantisch voraussetzen. Das M7-Gate wird um eine
Kalibrierungs-Steigung (Reliability-Regression) ergänzt, damit „Brier gut“
nicht „Kalibrierung gut“ ersetzen muss.

### M2 — Mehrtagesprognosen ziehen Tage unabhängig (Schwere: mittel-hoch)

**Befund.** `predict()` zieht je Prognosetag **einen** Tagesblock, Tage
untereinander unabhängig (Schleife über `day_position`). Damit existiert in
der Verteilung keine „günstige Woche“ und kein „drei Tage Hochpreisphase“:
die intertägige Autokorrelation der Residuen (Mehrfach-Sprünge,
Wetter-/Nachfrage-Regime) ist null.

**Wirkung.** Für F1 (heutige Fenster) harmlos. Für die **Woche-Ansicht**
und die F3-Top-3 über mehrere Tage werden gemeinsame Unsicherheit und
Korrelation der Tages-Minima systematisch falsch abgebildet — die
„besten Fenster verschiedener Tage“ wirken unabhängiger, als der Markt ist.

**Korrekturvorschlag.** **Day-Pair-Bootstrap:** Ziehung zusammenhängender
(Tag d, Tag d+1)-Paare (ggf. Triple) aus beobachteten aufeinanderfolgenden
Tagen — erhält die Intraday-Struktur **und** die Intertag-Abhängigkeit, ohne
neue Modellannahmen; EW-Gewichte bleiben anwendbar. Aufwand klein (die
Block-Matrix liegt bereits als (Tag, Slot)-Array vor), Gegenmessung über
`TANKAPP_*`-Flag wie bei `shared_draws` üblich.

### M3 — € und P messen zwei verschiedene Fenster-Funktionale (Schere hoch)

**Befund.** `expected_saving_eur` rechnet `Anker − Median(q50 über das
Fenster)` (`_today_windows`), während `p_besser` das **Minimum** der Draws
im Fenster gegen `Anker − 1 ct` prüft. Das Minimum-Funktional ist
systematisch optimistischer als das Median-Funktional. Dieselbe Empfehlung
zeigt also „Sparen ≈ 2,40 €“ (konservativ) **und** „78 % sicher“
(optimistisches Ereignis) — zwei Maßstäbe, ein Satz. Der Nutzer, der dem
Fenster folgt, tankt realistisch nahe dem Fenster-Median, nicht am Minimum.

**Korrekturvorschlag.** Beide Größen aus **demselben** Funktional ableiten:
`expected_saving = Median über Draws von (Anker − Fensterminimum)`,
angezeigt als „bis zu X €“; `p_besser` bleibt das Ereignis dazu. Damit wird
aus „€ und % widersprechen sich latent“ eine konsistente Aussage; die
konservative Variante (Median-Preis im Fenster) kann als zweite Zeile
„erwartet statt bester Fall“ ergänzt werden.

### M4 — Ensemble: Punktwert aus zwei Kernen, Verteilung aus einem (Schwere: mittel)

**Befund.** Für `kind=ensemble` ist die Punktprognose die gewichtete Mischung
beider Kerne, die Bootstrap-Pfade werden aber stets aus den **Harmonischen-**
Residuenblöcken aufgebaut (`predict` wechselt Blöcke nur bei
`kind=profile_ar2`). Liegt der Punktwert zwischen beiden Kernen, trägt die
Verteilung den Strukturfehler des Harmonischen-Modells relativ zum neuen
Zentrum — Spreizung und Zentrum gehören nicht zusammen. Verstärkend: Die
Ensemble-**Gewichte** werden auf dem 5-Minuten-Horizont gemessen, auf dem
der AR(2)-Nachlauf beide Kerne fast gleich macht (0,51/0,49 laut
ANALYSE.md), konsumiert aber 24-h- bis 7-Tage-Prognosen, wo der Unterschied
liegt (72-h-MAE 2,53 vs. 1,86 ct/L). Das Repo dokumentiert das ehrlich
(„bewusst offen“, 18.09. entschieden: bleibt).

**Korrekturvorschlag (abgestuft).** (a) Kurzfristig: den Default-Pfad auf
`profile_ar2` stellen — er ist in der vorliegenden Messung strikt besser
als das Ensemble, und eine Verteilung aus **einem** Kern ist in sich
konsistent; das Ensemble bleibt als ausgewiesene Experimentieroption.
(b) Mittelfristig: Gewichte aus dem Rolling-Origin-Backtest **je Horizont**
(wie in LUECKEN.md beschrieben) und die Residualblöcke des jeweils
gewichtsführenden Kerns für die Pfade verwenden.

### M5 — Nowcast-Draws trotz frischem Live-Preis (Schwere: niedrig)

**Befund.** `p_lohnt` paart die Nowcast-Draws (`paths[:,0]`) beider
Stationen — auch wenn der Live-Preis der Referenzstation Minuten jung ist.
Die bekannte Gegenwart wird dann als Zufallsgröße behandelt; Phantom-
Unsicherheit fließt in F2.

**Korrekturvorschlag.** Konditionierung: Referenzpreis frisch (< eine
Poll-Periode) → als Konstante in die Paarung; nur die potenziell stale
Seite trägt Draws. Billig, erhöht die Ehrlichkeit von „lohnt sich der
Umweg?“ messbar.

### M6 — Rolle des Beta-Binomial-Updatings: korrekt, aber unterbelichtet (Schwere: niedrig)

**Befund.** Das Beta(5,5)-Binomial-Update ist mathematisch sauber (2.2),
dient aber nur als **Fallback** (`p_source=basisrate`), seit die P-Seite die
Verteilungs-Draws nutzt. Der aktive Regelkreis (M7-Schwellen-Nachzug)
arbeitet dagegen frequentistisch (Normalapproximation, MIN_N=25, Rauschband,
Totband — gut gegen Oszillation geschützt, H3). Zwei Punkte:

1. **Zielkonflikt der Regelkreise.** Die Treffer-Ziele (70/85/60 %) sind
   **Produktziele**, keine Kalibrierungsziele. Ein Nachzug, der die Gates
   so lange anzieht, bis die Trefferquote das Produktziel trifft, kann
   Fehlkalkibration der P-Seite *absorbieren statt beheben* (Schwellen
   reparieren, was M1 eigentlich korrigieren müsste). Empfehlung: erst M1
   bauen, dann den Nachzug ausdrücklich nur noch auf die **€-Nutzenseite**
   (Zeitwert-, Umweg-Schwellen) wirken lassen — Kalibrierung bleibt Aufgabe
   der Rekalibrierungsschicht.
2. Der Beta-Posterior könnte sofort mehr leisten, als er darf: Für das
   Labor (Karte 7 im Parameterschrank) wäre das 95 %-Credible-Interval der
   Trefferquote `(Beta-Quantile)` eine ehrlichere Anzeige als Punktquote ±
   Normalapproximation — bei n ≥ 25 numerisch fast identisch, aber
   konzeptionell derselbe Schätzer, der ohnehin implementiert ist.

### M7 — Hyperparameter-Zoo ohne Ablations-Protokoll (Schwere: strukturell)

**Befund.** Das System trägt ~25 handgesetzte Konstanten: θ=1 ct,
Fenster 2 h, Umfeld ±6 h, HWZ 7 d/14 d, CUSUM h=2,0, Score-Gewichte
(0,40/0,25/0,15/0,10/0,10), Coverage 0,85×Bestwert, MIN_N=25, 9 Schwellen
mit Bounds und Schrittweiten, Hampel 5·MAD/1 h, `min_slot_days`, B-Werte,
M7-Ziele … Jede ist einzeln plausibel begründet; ein systematisches
Abtasten der Empfindlichkeit existiert nicht. Hinzu kommt: Wie oft das
AR(2)-Stabilitätsnetz (×0,9-Schrumpfen) wirklich eingreift, wird nicht
gezählt — ein stiller Modellwechsel, der sichtbar sein sollte.

**Overfitting-Ort Nr. 1 ist nicht das Strukturmodell** (13 Parameter,
robust, rollierendes Fenster — geringes Risiko), sondern diese Meta-Schicht:
Sobald `TANKAPP_M7_AUTO_APPLY` läuft, tuned sich die Entscheidungstabelle
auf das Advice-Ledger **eines einzigen Haushalts** — kleine Stichprobe,
keine Kontrollgruppe, Rückkopplung (die Schwelle verändert künftige
Empfehlungen und damit künftige Daten). Klassisches adaptives Overfitting.

**Korrekturvorschlag.** (a) Versionierte Parameter-Snapshots im Artefakt
(teilweise schon der Fall: `config`-Block) plus **ein** Ablations-Backtest
je geändertem Parameter als Abnahme-Kriterium (Rezept liegt in ENGINE.md).
(b) `ar_shrink_events`, `pava_pool_count` u. ä. als Zähler ins Artefakt.
(c) Für den Nachzug: Änderungen nur einzeln, mit protokolliertem
Vorher/Nachher-Brier — nie zwei Regelkreise gleichzeitig.

### M8 — Erster Winter nach der 12-Uhr-Regel: strukturelle Grenze (Schwere: Beobachtung)

**Befund.** Seit B30 lernt die Intraday-Struktur ausschließlich aus Daten ab
dem 01.04.2026 — korrekt und wichtig. Die Kehrseite: Es gibt **keinen**
einzigen Winter-Trainingstag unter der neuen Rechtslage. Harmonische und
Slot-Mediane können den Winter-Tagesgang 2026/27 nicht antizipieren; ab
~Oktober fährt die App in unbekanntes Terrain, bis das 42-Tage-Fenster
nachgelernt hat. Zusätzlich hat das Sprung-Alter-Feature (β₁₂) im
Nach-Gesetz-Fenster kaum Varianz (Sprünge nur noch um 12:00) — es läuft
sehenden Auges in Kollinearität mit dem Nachmittags-Dummy; für die
Prognose unschädlich, für die Interpretation von β zu beachten.

**Korrekturvorschlag.** Kein Code, sondern Betrieb: „Erster Winter nach der
12-Uhr-Regel“ als Datenreichweite-Hinweis in Labor → Daten; ab November ein
Sonder-Backtest (MASE/PICP gegen den Vor-Regime-Sommer), bevor die
PICP-Badges Winter-Fehlalarme als „Modell kaputt“ melden.

### Nebenbefunde (kurz)

- **Fenster-P-Normierung** `min(1, raw·(k+1))` ist eine heuristische
  Basisraten-Korrektur, keine Wahrscheinlichkeit. Korrekt, dass sie nur als
  Sterne-Sortierung dient und nie in die Entscheidungstabelle darf — das
  Labor sollte sie als „Index“ beschriften, nicht als %.
- **Heatmap-Cheap-Probability** enthält die eigene Stichprobe in der
  Vergleichsbasis; die Mindest-Referenzgröße (n ≥ 30) und die Ausweisung
  „dünn“ sind die richtige Antwort darauf — beibehalten.
- **Selection-p-Werte** ignorieren die Querkorrelation der LOO-Baseline über
  Stationen; BH korrigiert grob mit. Als Näherung akzeptabel, im
  Labor-Parameterblatt ausweisen.
- **Quantil-Klammerung** nach der Projektion (min/max gegen q50) erhält
  Regel und Ordnung, verschiebt aber minimal Bandmasse — die gemessene
  Rolling-PICP ist die korrekte Kontrolle dafür; keine Änderung nötig.

## 2.4 Overfitting-Risiken

| Schicht | Risiko | Begründung |
|---|---|---|
| Strukturmodell (Huber, 13 β) | **gering** | sparsam, robust, rollierend, Bodenkante sauber |
| Slot-Profil (288 Medianwerte) | **gering** | ~42 Beobachtungen/Slot bei dichten Daten; NaN statt Auffüllen |
| Bootstrap-Verteilung | **mittel** | 42 Atome (Tage) begrenzen die Tail-Auflösung; EW-Gewicht verjüngt — aber M2/M4 |
| Ensemble-Gewichte | **hoch (angezeigt)** | 14-Tage-Fenster, 5-Minuten-Horizont, keine Trennschärfe (0,51/0,49) |
| €-P-Tabelle + M7-Nachzug | **mittel bis hoch** | kleine Ein-Nutzer-Stichprobe, Rückkopplung, ~12 Konstanten — Gegenmittel: M7-Vorschläge |
| Selektions-Score-Gewichte | **mittel** | Handmaß ohne Outcomes-Validierung; Signifikanz-Gate schützt das Ranking nur teilweise |

## 2.5 Konsistenz-Urteil

Die drei namengebenden Verfahren **greifen grundsätzlich sinnvoll
ineinander**: Der robuste Huber-Schätzer liefert die Struktur, die kein OLS
liefern könnte (Preissprünge, API-Artefakte); die isotone Regression setzt
die harte Rechtsbedingung dort durch, wo Heuristiken lügen würden
(exakte L2-Projektion, auf Pfaden *und* Quantilen); das Beta-Binomial-Update
ist der priorsaubre sequenzielle Schätzer für die Trefferquote des
Fallbacks. AR(2)-Nachlauf, Tagesblock-Bootstrap und P-Seite bilden eine
saubere Monte-Carlo-Kette, und die Ehrlichkeits-Gates (M7, PICP, O5/O6)
verhindern, dass sich das System selbst für kalibriert erklärt.

**Aber:** Die Kette hat vier Nähte mit Nutzerwirkung (M1–M4), von denen M1
die wichtigste ist, weil sie die Semantik der angezeigten Prozentzahlen
betrifft — das Produktversprechen „82 % sicher“ ist heute ein Versprechen
auf unkalibrierte Relative Häufigkeiten, kontrolliert nur indirekt über
Brier-Gates. Mit den Korrekturen M1→M2→M3/M4 (Teil 3) wird aus einer in
Einzelteilen exzellenten eine **in der Fläche konsistente** Statistik.

## 2.6 Korrekturvorschläge im Überblick

| # | Lücke | Schwere | Vorschlag | Ort im Code | Aufwand |
|---|---|---|---|---|---|
| M1 | Unkalibrierte P in Gates & Anzeige | hoch | Isotone Rekalibrierung (PAVA wiederverwenden) oder split-conformal; `calibrated:true` ermöglichbaren; Reliability-Check ins M7-Gate | neu: `engine/calibration.py`; `models.py::validate_model`; `feedback.py` | 1–2 Wochen |
| M2 | Tage unabhängig | mittel-hoch | Day-Pair-Bootstrap auf (Tag, Slot)-Matrix | `models.py::predict` | ~1 Woche |
| M3 | Median vs. Minimum | hoch (Anzeige) | Beide Größen auf Fensterminimum-Draws; „bis zu X €“ | `decide.py`, `pside.py` | 2–3 Tage |
| M4 | Ensemble-Punkt/-Verteilung | mittel | Default `profile_ar2`; später Horizon-Gewichte aus Rolling-Backtest | `models.py::predict`, `model_jobs.py` | 1 Tag / 1 Woche |
| M5 | Nowcast trotz Live-Preis | niedrig | Frischen Anker konditionieren | `pside.py::p_lohnt`, `decide.py` | 1 Tag |
| M6 | β-Binomial unterbelichtet; Regelkreis-Konflikt | niedrig | Nachzug erst nach M1 auf €-Seite beschränken; Beta-CI im Labor | `thresholds.py`, Labor-Karte 7 | 2 Tage |
| M7 | Hyperparameter-Zoo | strukturell | Ablations-Backtest als Abnahme; Eingriffs-Zähler ins Artefakt | `backtest.py`, Artefakt-Schema | laufend |
| M8 | Erster Regel-Winter | Beobachtung | Datenreichweite-Hinweis + Sonder-Backtest ab November | Labor → Daten | 1 Tag |

---

# Teil 3: Nächste Schritte

Drei Empfehlungen, priorisiert nach Wirkung/Aufwand — die ersten beiden
schließen die mathematischen Nähte, die dritte setzt das UX-Konzept um:

## Empfehlung 1 — Kalibrierungsschicht bauen (M1, inkl. M3/M5-Konsistenz)

**Was.** Ein neues Modul `engine/calibration.py`: monotone
Rekalibrierungsabbildung aus Rolling-Backtest-PIT-Paaren (isotone
Regression — der PAVA-Code der 12-Uhr-Regel wird wiederverwendet), auf die
Bootstrap-Draws angewendet vor der Veröffentlichung. Im selben Zug
`expected_saving` und `p_besser` auf dasselbe Fenster-Funktional legen
(M3) und `p_lohnt` am frischen Live-Preis konditionieren (M5).
`validate_model()` gibt `calibrated: true` frei; das M7-Gate bekommt die
Reliability-Steigung als zweite Bedingung.

**Warum zuerst.** Jeder andere Ausbau steht auf Prozentzahlen, die heute
nicht kalibriert sind. Dieser Schritt macht aus „wir messen
Fehlkalkibration“ ein „wir beheben sie“ — und ist die Voraussetzung dafür,
dass der M7-Nachzug (M6) nicht weiter Schwellen verbiegt, was eigentlich
die Verteilung reparieren müsste.

**Abnahme.** Rolling-PICP je Quantilstufe (nicht nur 95 %), Brier-Vorher/
Nachher auf dem Ledger, A/B gegen `TANKAPP_*`-Flag wie bei `shared_draws`.

## Empfehlung 2 — Verteilung mehrtagefähig machen (M2, dann M4)

**Was.** Day-Pair-Bootstrap: zusammenhängende Tagespaare statt
unabhängiger Tage ziehen (die (Tag, Slot)-Block-Matrix liegt bereits vor);
danach den Ensemble-Default auf `profile_ar2` stellen und die Gewichte aus
dem Rolling-Origin-Backtest je Horizont ziehen.

**Warum.** Die „Woche“-Ansicht und F3 verkaufen Mehrtages-Aussagen, deren
gemeinsame Unsicherheit heute per Konstruktion fehlt. Der
Zweitkern-Wechsel ist zudem die billigste Konsistenz-Reparatur im Paket
(Verteilung und Punktwert aus einem Guss), bis die Horizon-Gewichte stehen.

**Abnahme.** Vergleich der Tagesminimum-Korrelation in Draws gegen
beobachtete Tagesminimum-Korrelation (Soll: > 0 statt ≈ 0); MASE/PICP der
Mehrtages-Horizonte im Rolling-Backtest unverändert oder besser.

## Empfehlung 3 — Navigation 3+1 und Parameterschrank (UX-Phase 1–3)

**Was.** Bottom-Bar auf Jetzt/Woche/Stationen + Studio-Blatt (Phase 1),
„Jetzt“ um Stationszeilen-Dopplung und Default-offenen Streifen
entschlacken (Phase 2), Labor in die vier Sub-Tabs mit Parameterschrank-
Karten zerlegen (Phase 3) — Diagramme auf Kartenebene, Rohdaten eine
Aufklapp-Ebene tiefer mit CSV-Export, nie gemischt (§1.5).

**Warum jetzt.** Die Mathematik-Korrekturen aus Empfehlung 1 landen sonst
im selben unstrukturierten 1760-Zeilen-Akkordeon wie heute: Die
Kalibrierungsabbildung, der β-Posterior und die Ensemble-Gewichte brauchen
ihre festen Karten (Kalibrierung unter „Güte & Kalibrierung“, Rest im
Parameterschrank), bevor sie gebaut werden — sonst wächst das Labor schon
wieder unsortiert.

**Abnahme.** Scrolltiefe „Jetzt“ ≤ 1,5 Viewports (mobile.spec.ts-Ratchet),
Erklär-Treppen-Sprünge landen im richtigen Sub-Tab (E2E), Labor-Views je
Sub-Tab unter ~600 Zeilen.

**Reihenfolge insgesamt:** Empfehlung 1 → 3-Phase-1 → Empfehlung 2 →
3-Phase-2/3. So hat jede Mathematik-Änderung sofort einen strukturierten
Anzeigeort, und die Nav-Reform blockiert nichts.

---

# Teil 4: Batch-Plan

Sieben Batches nach der bewährten Befund-Kultur: **ein Thema pro Batch,
jeder Batch für sich auslieferbar** (Versionssprung, CHANGELOG, Tests,
Stand-Zeilen-Sync, `test_ledger_drift` grün), jede Nutzerzahl bleibt auch
zwischendurch ehrlich. Geschätzte Größen sind reine Arbeitswerte für einen
Entwickler.

## Übersicht

| Batch | Thema | Deckt | Größe | Hängt an |
|---|---|---|---|---|
| **B0** | Messgrundlagen | M7 (Zähler), Vorbereitung M1 | 2–3 Tage | — |
| **B1** | Eine Sprache für € und % | M3, M5 | 3–4 Tage | — |
| **B2** | Kalibrierungsschicht | M1, M6a | 7–10 Tage | B0 |
| **B3** | Mehrtage & Kerne | M2, M4 | 5–7 Tage | B0 |
| **B4** | Navigation 3+1 | UX-Phase 1+2 | 4–5 Tage | — |
| **B5** | Labor-Umbau | UX-Phase 3+4, M6b, M8-Anzeige | 8–10 Tage | B2, B3, B4 |
| **B6** | Betriebsbeweis | M7-Prozess, M8-Backtest | 4 Wochen Betrieb | B2, B5 |

```text
        B0 ──┬── B2 ──┐
             └── B3 ──┼── B5 ── B6 (Betriebszeit)
        B1 ────────────┤
        B4 ────────────┘
```

B1 ∥ B4 sind parallelisierbar (Frontend/Engine getrennt); B2 ∥ B3 ebenso,
sobald B0 steht. B5 wartet bewusst auf B2/B3, damit Kalibrierungsabbildung,
Day-Pair-Status und Beta-CI gleich ihre festen Parameterschrank-Karten
bekommen statt in ein Zwischen-Akkordeon einzuziehen.

## B0 — Messgrundlagen (unsichtbar, bitgleich)

Sichtbar machen, was heute still passiert, und die Datengrundlage für die
Kalibrierung legen.

- Neue Zähler ins Modell-Artefakt: `ar_shrink_events` (wie oft greift das
  ×0,9-Stabilitätsnetz), `pava_pool_stats` (Anzahl/Größe der Pools je
  Segment), Ensemble-Gewichtsstreuung.
- Der Rolling-Backtest persistiert **PIT-Paare** (vorhergesagte
  Quantilstufe ↔ beobachteter Rang) je Station und Horizont — das ist der
  Trainingsstoff für B2.
- Referenz-Messung dokumentieren: PICP/Brier/MASE je Station **vor** jeder
  Änderung (Vergleichsbasis für B2/B3).

**Abnahme:** Prognose bitgleich (Invarianz-Test), Zähler getestet, PIT-Paare
im Backtest-Artefakt. Kein Nutzerverhalten ändert sich.

## B1 — Eine Sprache für € und % (klein, sofort sichtbar)

- `expected_saving` aus den Fensterminimum-Draws („bis zu X €“), zweite
  Zeile „erwartet Y €“ aus dem Fenster-Median — dieselbe Empfehlung, ein
  Maßstab (M3).
- `p_lohnt` konditioniert den Referenzpreis: frisch (< eine Poll-Periode)
  → Konstante, nur die potenziell stale Seite trägt Draws (M5).
- MICROCOPY-Anpassung („bis zu“) + Parity-Tests `pside`/`decide`.

**Abnahme:** € und P stammen nachweislich aus demselben Ereignis;
E2E-Demo-Stack grün; alte Pfade unverändert (nur Anzeigeformel).

## B2 — Kalibrierungsschicht (der Kernbatch)

- Neu `engine/calibration.py`: monotone Rekalibrierung der Bootstrap-Draws
  aus den B0-PIT-Paaren — **isotone Regression, die PAVA-Implementierung
  der 12-Uhr-Regel wird wiederverwendet**; Umschalter
  `TANKAPP_CALIBRATION` für Gegenmessungen.
- Artefakt-Schema 3: `calibrated: true` wird möglich, `validate_model`
  bleibt zu Schema-2-Artefakten kompatibel (Fallback = unkalibriert,
  ausgewiesen).
- M7-Gate: Reliability-Steigung als zweite Bedingung neben dem
  Brier-Intervall (O6-Muster: Intervall gegen Referenz statt Punkt gegen
  Schwelle).
- Schwellen-Nachzug wirkt ab Freigabe nur noch auf die €-Seite
  (Zeitwert/Umweg); Kalibrierung ist Aufgabe der neuen Schicht (M6a).
- Bestehendes Labor bekommt eine Kalibrierungs-Kachel (der große Umbau
  folgt in B5).

**Abnahme:** PICP je Quantilstufe (nicht nur 95 %) im Rolling-Backtest im
Zielband; Brier vorher/nachher auf dem Ledger; A/B gegen den Umschalter
gemessen und dokumentiert. **Release-Gate:** keine Verschlechterung einer
einzelnen Station um mehr als 2 pp.

## B3 — Mehrtage & Kerne

- **Day-Pair-Bootstrap:** Ziehung zusammenhängender (Tag d, Tag d+1)-Paare
  aus der vorhandenen (Tag, Slot)-Block-Matrix; Umschalter
  `TANKAPP_DAYPAIR` wie bei `shared_draws` (M2).
- **Kern-Klarheit:** Default-Pfad `profile_ar2` (in der vorliegenden
  Messung strikt besser als das Ensemble), Ensemble bleibt ausgewiesene
  Option; Horizont-Gewichte aus dem Rolling-Backtest als Folgepunkt im
  Artefakt sichtbar machen (M4).

**Abnahme:** Korrelation der Tages-Minima in den Draws ≈ beobachtete
Korrelation (heute ≈ 0); MASE/PICP der Mehrtages-Horizonte mindestens
gehalten; Gegenmessung dokumentiert.

## B4 — Navigation 3+1 (parallel zu B2/B3 möglich)

- Bottom-Bar Jetzt/Woche/Stationen + Studio-Blatt (Labor/Ich/System/
  Glossar); URL-Schema bleibt kompatibel (`?tab=labor` weiter gültig).
- „Jetzt“ entschlacken: Stationszeilen-Liste raus (lebt nur noch in
  „Stationen“), Tagesstreifen default-eingeklappt, Umweg-Zeile bleibt.
- Ratchets: `mobile.spec.ts` Scrolltiefe ≤ 1,5 Viewports; `AppNav`-Tests
  auf 3+1.

**Abnahme:** Jeder Inhalt hat einen neuen festen Ort (keine Feature-
Verluste), alle Teil-URLs weiter auflösbar, Lighthouse-Budgets gehalten.

## B5 — Labor-Umbau (größter Brocken, je Sub-Tab ein PR)

- `Labor.tsx` in vier Sub-Tabs zerlegen: Überblick · Modell & Parameter ·
  Güte & Kalibrierung · Daten & Rohdaten; `LAB_SECTIONS` wird zum
  Sub-Tab-Adressraum, Erklär-Treppen-Sprünge landen punktgenau.
- **Parameterschrank:** Karten 1–7 in Kettenreihenfolge (Struktur → AR(2)
  → Bootstrap → 12-Uhr-Projektion → Ensemble → Selektion → Schwellen),
  je Karte Satz/Diagramm/Aufklapp-Parameter/Formel — inkl. der neuen Größen
  aus B2/B3 (Kalibrierungsabbildung, PIT-Verteilung, Day-Pair-Status,
  Kern-Gewichte) und dem Beta(5,5)-Credible-Interval der Trefferquote
  (M6b) auf Karte 7.
- Rohdaten-Tab mit CSV-Export, API-Explorer zieht dorthin; Diagramm/Roh-
  daten-Trennung als Test-Ratchet (kein Diagramm auf Rohdaten-Ebene).
- Daten-Tab: Reichweiten-Hinweis „Erster Winter nach der 12-Uhr-Regel“
  (M8).

**Abnahme:** Views je Sub-Tab < ~600 Zeilen, E2E-Sprung-Tests,
Trennungs-Ratchet grün, keine Labor-Inhalte verloren.

## B6 — Betriebsbeweis (kein Code-Batch, Betriebszeit)

- Vier Wochen Produktion mit Kalibrierung beobachten: PICP-Drift,
  Brier-Verlauf, Verhalten des €-Nachzugs.
- Ab November: Sonder-Backtest „erster Regel-Winter“ (MASE/PICP gegen den
  Vor-Regime-Sommer), bevor Winter-Bewegungen als Modellfehler gelesen
  werden (M8).
- **Prozessregel (M7):** Ab jetzt gilt jede Parameteränderung nur mit
  dokumentiertem Ablations-Backtest (Rezept in ENGINE.md ergänzen) — ein
  Hyperparameter, ein Vergleich, eine Entscheidung.

## Was bewusst in keinen Batch kommt

OpenAPI, zweite Backup-Ziel-Befassung, Kampagnen-Quote auf dem NAS und die
übrigen „bewusst offen“-Posten aus [LUECKEN.md](LUECKEN.md): Sie haben
dort ihren Grund und werden durch diesen Befund nicht berührt. M8 selbst
ist keine Code-Aufgabe — B5 liefert die Anzeige, B6 die Messung.

---

# Anhang: Prüfprotokoll

Gelesene Primärquellen (Code): `engine/models.py` (Huber-IRLS, AR(2),
PAVA/12-Uhr-Projektion, Ensemble, fit/predict, shared draws),
`engine/probabilities.py`, `engine/selection.py` (über ANALYSE.md und
Tests), `engine/backtest.py`, `engine/bootstrap.py`, `app/decide.py`,
`app/pside.py`, `app/thresholds.py`, `app/feedback.py`, `app/outcomes.py`,
`analysis/station_selection.py` (Doku), `web/src/{routing.ts,lab.ts,
components/AppNav.tsx,views/*.tsx}`.
Gelesene Sekundärquellen: `docs/{ANALYSE,KONZEPT,LUECKEN,ENGINE,
UI-NEUENTWURF,MICROCOPY}.md`, `docs/archiv/GUTACHTEN-2026-09-10.md`,
`README.md`. Unabhängig nachgerechnet: Huber-IRLS-Gewichte gegen
ψ-/w-Form, Yule-Walker-Matrix, PAVA-Poolbedingung, Beta(5,5)-Posterior-
Mittelwert, p-Wert-Auflösung bei B=2000 (q_min=0,0547 bei m=11 → B=2000
erforderlich, bestätigt). Dieser Befund prüft gegen den Code-Zweig, nicht
gegen den Live-Betrieb; alle Betriebszahlen (Brier, PICP, Trefferquoten)
sind deshalb als Entwurfsziele, nicht als Messwerte zu lesen.
