# Befund 19.09.2026 — UX-Vision, mathematische Tiefenprüfung und Regime-Wechsel

> **Historischer Prüfbericht** · Prüfung: 19.09.2026 (Nachträge bis 20.09.2026).
> Archiviert am 20.09.2026. Versionsbezogene Aussagen sind keine aktuelle
> Anleitung; Archivierung bedeutet nicht, dass alle Vorschläge erledigt sind.
> Aktuell: [Projektstand](../planung/LUECKEN.md), [Aufgaben](../planung/TODO.md),
> [Regime-Plan](../planung/REGIME.md), [UI](../produkt/UI.md).


> Stand: 19.09.2026 · App-Version **0.55.2** · Stichtagsprüfung gegen den
> Arbeitszweig `arena/01a0b83e-tankapp` (Basis `main` @ `be3c912`); Teil 5
> zusätzlich gegen `arena/01a0b85b-tankapp` (Basis `main` @ `cfb10b9`).
> 0.55.2 ist ein GUI-/Test-Suite-Patch; die fachliche Prüfung dieses Befunds
> lief gegen 0.55.1, Engine, App-Schicht, Datenwerkzeuge und Analyse blieben
> unverändert.
> Rollen: Senior UI/UX-Design + Data Science. Drei Fragen: Wie muss die
> Seitenstruktur aussehen, damit Kunden in 5 Sekunden wissen, **wann und wo**
> sie tanken (Teil 1) — greift die Statistik (Huber-M-Schätzer, isotone
> Regression, Beta-Binomial-Updating) methodisch konsistent ineinander
> (Teil 2) — und was richten die beiden datierten Regime-Wechsel Tankrabatt
> (01.10.2026) und Spritpreisdeckel (01.01.2027) in der Engine an (Teil 5)?
> Dieser Befund ist eine Diskussionsvorlage wie
> [UI.md](../produkt/UI.md); er ersetzt weder Konzept noch
> Analyse-Referenz. Er lebt in `docs/`, solange seine Punkte offen sind, und
> wandert nach deren Abschluss nach `docs/archiv/` (Hausregel für datierte
> Befunde, wie
> [archiv/BEFUND-12-UHR-REGEL-2026-09-18.md](BEFUND-12-UHR-REGEL-2026-09-18.md)
> nach B30). Arbeitspunkte: [TODO.md](../planung/TODO.md) — Teil 1/2 als
> Batch-Plan B0–B6 (Teil 4), Teil 5 als A14–A16 und H6–H10 mit Fristen.

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
- [Teil 5: Regime-Wechsel — Tankrabatt und Spritpreisdeckel](#teil-5-regime-wechsel--tankrabatt-und-spritpreisdeckel)
  - [5.1 Urteil über den Entwurf — Kurzfassung](#51-urteil-über-den-entwurf--kurzfassung)
  - [5.2 Was der Entwurf richtig sieht](#52-was-der-entwurf-richtig-sieht)
  - [5.3 Fünf Korrekturen, gemessen](#53-fünf-korrekturen-gemessen)
    - [5.3.1 Der Punkt heilt — die Verteilung heilt nicht](#531-der-punkt-heilt--die-verteilung-heilt-nicht)
    - [5.3.2 „17 Cent abziehen“ ist der falsche Mechanismus](#532-17-cent-abziehen-ist-der-falsche-mechanismus)
    - [5.3.3 Die 12-Uhr-Projektion frisst den Regime-Sprung](#533-die-12-uhr-projektion-frisst-den-regime-sprung)
    - [5.3.4 Der Deckel ist keine Konstante, und das Clipping sitzt an der falschen Stelle](#534-der-deckel-ist-keine-konstante-und-das-clipping-sitzt-an-der-falschen-stelle)
    - [5.3.5 Der 42-Tage-Bezug ist nicht das eigentliche Problem](#535-der-42-tage-bezug-ist-nicht-das-eigentliche-problem)
  - [5.4 Was der Entwurf nicht sieht](#54-was-der-entwurf-nicht-sieht)
    - [5.4.1 Der 1. Januar ist die gefährliche Richtung](#541-der-1-januar-ist-die-gefährliche-richtung)
    - [5.4.2 Der gepoolte Feiertags-Fit ist heute schon verfälscht](#542-der-gepoolte-feiertags-fit-ist-heute-schon-verfälscht)
    - [5.4.3 Das Qualitäts-Gate wird durch den Bruch grüner, nicht roter](#543-das-qualitäts-gate-wird-durch-den-bruch-grüner-nicht-roter)
    - [5.4.4 Der Schwellenregler lernt aus einem Steuergeschenk](#544-der-schwellenregler-lernt-aus-einem-steuergeschenk)
    - [5.4.5 Der Verstößezähler meldet am 1. Januar Verstöße, die keine sind](#545-der-verstößezähler-meldet-am-1-januar-verstöße-die-keine-sind)
    - [5.4.6 Die WO-Seite ist immun, die WANN-Seite nicht](#546-die-wo-seite-ist-immun-die-wann-seite-nicht)
  - [5.5 Konzept: Regime-Kante statt Regime-Korrektur](#55-konzept-regime-kante-statt-regime-korrektur)
    - [R1 Regime-Kalender als Daten](#r1-regime-kalender-als-daten)
    - [R2 Schritt als Dummy mit geschätzter Kante und geschätztem Betrag](#r2-schritt-als-dummy-mit-geschätzter-kante-und-geschätztem-betrag)
    - [R3 Erlaubte Sprungzeitpunkte in der bestehenden Projektion](#r3-erlaubte-sprungzeitpunkte-in-der-bestehenden-projektion)
    - [R4 Deckel als bewegliche Schranke vor der Projektion](#r4-deckel-als-bewegliche-schranke-vor-der-projektion)
    - [R5 Ehrliche Degradation statt falscher Zuversicht](#r5-ehrliche-degradation-statt-falscher-zuversicht)
    - [Schema, Umschalter, Tests](#schema-umschalter-tests)
  - [5.6 Strategie: drei Phasen gegen drei Termine](#56-strategie-drei-phasen-gegen-drei-termine)
    - [Phase 0 — bis 30.09.2026 (11 Tage)](#phase-0--bis-30092026-11-tage)
    - [Phase 1 — Oktober bis Dezember 2026](#phase-1--oktober-bis-dezember-2026)
    - [Phase 2 — bis 31.12.2026](#phase-2--bis-31122026)
    - [Warum diese Reihenfolge und nicht die des Entwurfs](#warum-diese-reihenfolge-und-nicht-die-des-entwurfs)
  - [5.7 Einordnung in den Batch-Plan B0–B6](#57-einordnung-in-den-batch-plan-b0b6)
  - [5.8 Abnahme: welcher Beweis zählt](#58-abnahme-welcher-beweis-zählt)
  - [5.9 Offen, ehrlich benannt](#59-offen-ehrlich-benannt)
  - [5.10 Anhang A: Messtabellen](#510-anhang-a-messtabellen)
    - [A.1 Szenario A — Bruch −17,0 ct/L am 01.10.2026, sofort und vollständig](#a1-szenario-a--bruch-170-ctl-am-01102026-sofort-und-vollständig)
    - [A.2 Szenario B — Bruch −14,5 ct/L am 03.10.2026 (2 Tage spät, 85 % Durchgabe)](#a2-szenario-b--bruch-145-ctl-am-03102026-2-tage-spät-85--durchgabe)
    - [A.3 Szenario C — Bruch +17,0 ct/L am 01.01.2027 (Rabatt-Ende)](#a3-szenario-c--bruch-170-ctl-am-01012027-rabatt-ende)
    - [A.4 Projektions- und Deckel-Lemmata](#a4-projektions--und-deckel-lemmata)
    - [A.5 MASE-Nenner und Ensemble-Gewichte (Szenario A)](#a5-mase-nenner-und-ensemble-gewichte-szenario-a)
  - [5.11 Anhang B: Grenzen der Messung](#511-anhang-b-grenzen-der-messung)
- [5.12 Gegengutachten: Ergänzung und Beschluss](#512-gegengutachten-ergänzung-und-beschluss)
  - [5.12.1 Gesamturteil](#5121-gesamturteil)
  - [5.12.2 Drei technische Nachschärfungen](#5122-drei-technische-nachschärfungen)
  - [5.12.3 Verbindlicher Batch-Ablauf](#5123-verbindlicher-batch-ablauf)
  - [5.12.4 Abnahme- und Stop-Regeln](#5124-abnahme--und-stop-regeln)
- [5.13 Nachtrag 0.56.0: Modularität, Konfigurierbarkeit, Betreiber-Pflichten](#513-nachtrag-0560-modularität-konfigurierbarkeit-betreiber-pflichten)
  - [5.13.1 Ist das Konzept modular?](#5131-ist-das-konzept-modular)
  - [5.13.2 Jetzt bauen, obwohl es noch Gespräche sind?](#5132-jetzt-bauen-obwohl-es-noch-gespräche-sind)
  - [5.13.3 Was der Betreiber tun muss — und was von allein passiert](#5133-was-der-betreiber-tun-muss--und-was-von-allein-passiert)
  - [5.13.4 Verbindlich ab jetzt](#5134-verbindlich-ab-jetzt)
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

**Regime (Teil 5).** Zwei datierte äußere Eingriffe treffen dieselbe
Grundannahme „ein Regime, ein Niveau": Tankrabatt −17 ct/L ab 01.10.2026
(befristet bis 31.12.2026) und Spritpreisdeckel spätestens 01.01.2027. Der
vorgelegte Fahrplan-Entwurf hat recht mit dem Anlass und unrecht mit der
Konstruktion: Der dominante Schaden ist nicht der Punkt (der heilt in 2–3
Wochen), sondern die **Verteilung** — Intervallbreite 7,9 → 23–26 ct über fünf
Wochen, dazu `P_besser` 0,000–0,448 in einem tatsächlich günstigen Fenster
(§5.3.1). Ein harter Daten-Abzug um 17 ct auf den angekündigten Termin
vertauscht bei verzögerter oder unvollständiger Durchgabe +16 ct Fehler mit
−14,5 ct und bläht das Intervall dauerhaft (§5.3.2). Die gefährliche Richtung
ist das Rabatt-**Ende** am 01.01.2027: `P_besser = 0,920`, während das wahre
Fensterminimum 10 ct *über* dem Anker liegt (§5.4.1). Und die bestehende
12-Uhr-PAVA poolt einen Regime-Anstieg auf **+0,00 ct** (231/288 Punkte
verbogen) — sie macht jede Regime-Korrektur stillschweigend rückgängig, wenn
die Kante keine Segmentgrenze wird (§5.3.3). Dazu drei Punkte, die schon heute
zählen: der Feiertags-Pool (365 Tage) ist um −1,47/−1,24 ct/L verfälscht
(§5.4.2), das MASE-Gate kann **wegen** des Schocks grün werden (§5.4.3), und
der Verstößezähler meldet am 01.01. einen gesetzlichen Anstieg als Verstoß
(§5.4.5). Strategie: Regime-Kante statt Regime-Korrektur (§5.5), in drei
Phasen gegen drei Termine (§5.6) — und umgekehrte Priorität gegenüber dem
Entwurf, der die Architektur in das befristete Problem investiert und den
Dauerzustand Deckel als einzeiliges `min()` behandelt.

**Nächste Schritte.** (1) Kalibrierungsschicht: isotone Rekalibrierung der
Bootstrap-Verteilung — die PAVA-Implementierung der 12-Uhr-Regel lässt sich
dafür wiederverwenden. (2) € und P auf dasselbe Fenster-Funktional einigen
und den Nowcast am Live-Preis konditionieren. (3) Navigation auf 3+1
reduzieren und das Labor in vier Sub-Tabs mit Parameterschrank umbauen
(§Teil 3). (4) **Fristgebunden und deshalb vorgezogen:** die Phase-0-Punkte
aus Teil 5 bis 30.09.2026 — den eigenen Juli als Generalprobe messen,
Feiertags-Pool und Gate-Zähler schützen, Alarme am Kanten-Tag entschärfen und
dafür B1 (M5-Nowcast) vorziehen (§5.6, §5.7).

---

# Teil 1: UX-Konzept

## 1.1 Ist-Analyse: die sechs Bereiche

Geprüft gegen Code-Stand 0.55.1 (`web/src/views/*`, `AppNav.tsx`,
`routing.ts`, `lab.ts`, [UI.md](../produkt/UI.md)):

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
([MICROCOPY.md](../produkt/MICROCOPY.md)).

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
Sprachen dürfen sich nicht mischen (siehe [ANALYSE.md](../referenz/ANALYSE.md),
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

**Seit Teil 5 gilt eine Ausnahme von dieser Reihenfolge:** Die Regime-Punkte
A14–A16 und H6–H10 sind nicht nach Größe, sondern nach **Kalender** fällig —
der Tankrabatt beginnt am 01.10.2026, das Rabatt-Ende am 01.01.2027. Deshalb
wird **B1 vorgezogen** (der M5-Nowcast am Live-Preis ist die billigste
Regime-Maßnahme, §5.4.6/§5.7), und die Phase-0-Punkte aus §5.6 laufen vor B2/B3
— sie sind klein, datiert und ohne sie sind die Oktober-Zahlen nicht lesbar.
B3 (Day-Pair-Bootstrap) zieht dagegen **nach**: Mehrtages-Draws über eine Kante
sind ohne Schritt-Dummy doppelt falsch (§5.7).

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

> **Status 19.09.2026 — umgesetzt in 0.56.0** ([CHANGELOG](../releases/CHANGELOG.md),
> [ENGINE.md](../referenz/ENGINE.md#messgrundlagen-b0-seit-0560)), mit vier Vermerken aus
> der kritischen Prüfung des Batches:
>
> 1. **Abnahme erfüllt:** `tests/test_b0_invariance.py` vergleicht Fit, Prognose
>    und Backtest-Kennzahlen gegen eine Fixture aus dem Code **vor** der
>    Änderung; Zähler und PIT-Paare sind getestet
>    (`test_b0_counters.py`, `test_b0_pit_regime.py`, `test_b0_app.py`).
> 2. **`pava_pool_stats` ist kein Artefakt-Zähler**, wie oben geschrieben,
>    sondern eine Prognose-Diagnose: PAVA (12-Uhr-Projektion) läuft in
>    `predict`, nicht im Fit. `predict(..., diagnostics={})` liefert sie;
>    App-Veröffentlichung und `engine forecast` tragen sie je Prognose.
> 3. **Der §5.7-Nachtrag ist als Kalender gebaut, nicht als Marker:**
>    `Config.regimes` mit Zeit, Art, Sorte, Betrag, Status und Quelle
>    (`TANKAPP_REGIMES`), weil R1–R3 dieselben Felder brauchen und ein
>    bloßer Zeitstempel im Oktober nicht sagen könnte, welche Kante gemeint
>    ist. `regime_breaks_in_window` zählt und markiert (`flagged_not_excluded`),
>    rechnet aber nichts — die Prognose bleibt bitgleich.
> 4. **Zwei Punkte sind offen und stehen mit Grund in
>    [LUECKEN.md](../planung/LUECKEN.md#ausstehender-betriebsnachweis):** Die
>    **Referenzmessung** PICP/Brier/MASE je Station ist nicht gelaufen (keine
>    NAS-Daten in der Entwicklungsumgebung; Rezept in ENGINE.md; Brier gibt es
>    nur global je P-Quelle aus dem Advice-Ledger, eine Stations-Aufteilung
>    wäre bei ~1 Empfehlung/Tag lange nicht belastbar). Und **dabei gefunden:**
>    Der Backtest maß bisher `harmonic_ar2` mit unabhängiger Ziehung, während
>    die App das `ensemble` mit gemeinsamer Ziehung veröffentlicht — die
>    Güte-Kacheln beschreiben ein anderes Modell als das gezeigte Band. B0
>    macht beides benennbar (`--kind`, `--shared-draws`, `backtest_model_kind`
>    neben `model_kind`); das Umschalten ändert jede Kennzahl und gehört zu B3.

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

> **Status 19.09.2026 — umgesetzt in 0.59.0**
> ([CHANGELOG](../releases/CHANGELOG.md)), mit vier Vermerken aus der kritischen
> Prüfung des Batches:
>
> 1. **Abnahme erfüllt:** Alle Teil-URLs (`?tab=labor|ich|system|glossar`,
>    inkl. `?section=…`) bleiben auflösbar, weil der Routing-Code nicht
>    angefasst wurde (Testfälle in `web/e2e/app.spec.ts`); jeder verlagerte
>    Inhalt hat seinen festen Ort (Stationszeilen → „Stationen“,
>    Studio-Bereiche hinter „Mehr“); Lighthouse-Budgets unangetastet (keine
>    neuen Assets; fest positioniertes Blatt + initial geschlossener
>    Tagesstreifen ⇒ kein CLS).
> 2. **Ratchet abschnittsweit, nicht Vollseite:** Der „Jetzt“-Abschnitt
>    (390×844) hält ≤ 1,5 Viewports (gemessen 1,23; Due-Prompt zählt nicht
>    mit), die volle Seite wird protokolliert. Eine Vollseiten-Lesung
>    wäre 1,77 Viewports — konfliktfrei nur, wenn der globale Kopf (C13,
>    271 px) wegfielen. C13 ist am 18.09.2026 als *bewusst nicht
>    verdichtet* geschlossen (docs/planung/TODO.md „Geschlossen als nicht nötig“); die
>    Batch-Ziffer wird deshalb auf den Abschnitt bezogen, statt C13
>    rückwirkend aufzubrechen.
> 3. **Nebenbefund, im Batch mitgepflegt:** Echte `stats_summary`-Ausfälle
>    kommen als HTTP-200-Fehler-Körper — die GUI ließ ihn als Summary
>    durch („System“ stürzte auf frischem Server an
>    `data.quality_metrics`). Jetzt normalisiert die Overview-Ebene solche
>    Körper zu einem Fehler-Zustand; der Gate-Text „kein Engine-Lauf“ gilt
>    nur ohne Summary, und der e2e-Wortlaut in `web/e2e/app.spec.ts`
>    („Kalibrierung steht aus“) folgt der ehrlichen Summary des leeren
>    Servers.
> 4. **Heute im Blick:** Die drei Faktenzeilen bleiben sichtbar (Wireframe
>    §1.4.1 bindet genau das); nur der Tagesstreifen klappt. Ohne
>    Empfehlung entfällt der freie Satz, weil die Karte denselben Inhalt
>    kompakter trägt; mit Empfehlung bleibt er (Referenz + Ersparnis, O19).

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
übrigen „bewusst offen“-Posten aus [LUECKEN.md](../planung/LUECKEN.md): Sie haben
dort ihren Grund und werden durch diesen Befund nicht berührt. M8 selbst
ist keine Code-Aufgabe — B5 liefert die Anzeige, B6 die Messung.

---

# Teil 5: Regime-Wechsel — Tankrabatt und Spritpreisdeckel

> **Anlass.** Einigung der Koalition (Meldung vom 19.09.2026): Tankrabatt
> −17 ct/L ab 01.10.2026 (14 ct Energiesteuer + 3 ct USt-Effekt), befristet bis
> 31.12.2026; Spritpreisdeckel spätestens 01.01.2027 nach Luxemburger oder
> Belgischem Vorbild, Ausgestaltung offen; dazu die Prüfung einer
> Übergewinnsteuer. **Prüfgegenstand** ist der vorgelegte Fahrplan-Entwurf
> „Interventions-Schicht (Regime-Handling)" und die Frage, was davon am
> Code-Stand 0.55.1 trägt.
>
> **Methode** wie in Teil 2: gegen den Code gelesen **und nachgerechnet**. Alle
> Zahlen dieses Teils stammen aus Rolling-Origin-Läufen der echten
> `engine.models.fit`/`predict`-Kette auf synthetischen Reihen, kalibriert auf
> die Live-Messwerte aus
> [archiv/BEFUND-12-UHR-REGEL-2026-09-18.md](BEFUND-12-UHR-REGEL-2026-09-18.md)
> §2.1 (Tagesspanne 17 ct, Tief Median 7 Uhr, Hoch Median 12 Uhr, 44 %
> Mittagssprünge ≥ 2 ct). **Keine Zahl stammt aus dem Echtbestand** — der liegt
> auf dem NAS und war hier nicht erreichbar. Reproduktion:
> [analysis/regime_check.py](../../analysis/regime_check.py); `--simulate` rechnet
> die Tabellen in §5.10 nach, der Messpfad läuft auf einem echten Export
> (Aufruf in [DATENWERKZEUGE.md](../referenz/DATENWERKZEUGE.md#regime-check-durchgabe-einer-steuer--oder-deckel-änderung)).
> Arbeitspunkte: [TODO.md](../planung/TODO.md) A14–A16 (Fachlich) und H6–H10
> (Mathematik); offene Punkte mit Grund in
> [LUECKEN.md](../planung/LUECKEN.md#ausstehender-betriebsnachweis).

## 5.1 Urteil über den Entwurf — Kurzfassung

**Der Entwurf hat recht mit dem Anlass und unrecht mit der Konstruktion.** Drei
seiner vier Aussagen tragen, eine ist falsch, und die wichtigste Auswirkung
fehlt ganz.

| Aussage des Entwurfs | Urteil | Beleg |
|---|---|---|
| Der Huber-Schätzer bleibt über einem Niveau-Sprung „in der Mitte hängen“ und liefert „wochenlang falsche Prognosen“ | **Halb richtig, falsch lokalisiert** | Der Punkt heilt in 2–3 Wochen; die **Verteilung** heilt 5+ Wochen nicht, und sie ist es, die die Entscheidung trägt (§5.3.1) |
| Fix: 17 ct von den September-Trainingsdaten abziehen | **Falscher Mechanismus** | Er vertauscht in der Übergangszeit ein +16-ct- gegen ein −14-ct-Problem und bläht das Intervall dauerhaft, weil der angekündigte Termin nicht der Wirksamkeits-Termin ist (§5.3.2) |
| Der Deckel braucht ein hartes `min(Preis, DECKEL)` nach Bootstrap und AR(2) | **Richtige Idee, falsche Stelle** | Nach der Projektion erzeugt ein bewegter Deckel einen **illegalen** Preisanstieg; und `LEGAL_CAP` als Konstante ist das belgische/luxemburgische Modell nicht (§5.3.4) |
| Das Beta-Binomial-Update heilt sich von selbst, nichts zu tun | **Richtig, aber zu billig** | Der Ledger rollt über 30 Tage (`app/feedback.py`), heilt also — und verfüttert in diesen 30 Tagen verzerrte Trefferquoten an den M7-Schwellenregler und das Kalibrierungs-Gate (§5.4.4) |
| *(fehlt)* Die 12-Uhr-Projektion löscht den Regime-Sprung | — | Am 01.01.2027 wird ein +16,9-ct-Schritt von der bestehenden PAVA-Projektion auf **+0,00 ct** gepoolt, 231 von 288 Punkten des Segments werden verbogen — **auch bei perfekter Regime-Korrektur** (§5.3.3) |
| *(fehlt)* Der 1. Januar ist die gefährliche Richtung | — | `P_besser` steigt auf **0,92–1,00**, während das wahre Fenster 10 ct *über* dem Anker liegt: Die App empfiehlt „warten“ mit hoher Zuversicht in eine +17-ct-Erhöhung (§5.4.1) |
| *(fehlt)* Der gepoolte Feiertags-Fit ist **heute** verfälscht | — | `holiday_beta` = +4,48 ct statt +5,96 ct, weil 1. Mai, Himmelfahrt, Pfingstmontag und Fronleichnam 2026 in den Mai-Juni-Rabatt fielen: **−1,5 ct/L an jedem Feiertag**, mehr als die Entscheidungsschwelle θ = 1,0 ct (§5.4.2) |
| *(fehlt)* Das Qualitäts-Gate wird durch den Bruch leichter grün | — | Der MASE-Nenner wächst um 27–33 % (`mase_scale`), im Ensemble-Validierungsfenster um das 2,4-Fache: `mase_24h_below_0_95` kann **wegen** des Schocks erfüllt sein (§5.4.3) |

**Strategie in einem Satz.** Nicht das Niveau korrigieren, sondern **die Kante
kennen**: Regime-Termine als Daten, der Schritt als Dummy in der Designmatrix
mit *geschätzter* Kante und *geschätztem* Betrag (die Ankündigung ist der Prior,
nicht die Wahrheit), die Regime-Kante als zusätzlicher erlaubter Sprungzeitpunkt
in der bestehenden 12-Uhr-Projektion, der Deckel als bewegliche Schranke
*vor* der Projektion — und in den ersten Tagen nach einer Kante ehrliche
Degradation statt falscher Zuversicht (§5.5).

**Reihenfolge in einem Satz.** Der Rabatt ist transient (nach 42 Tagen ist er
aus dem Fenster) und der Deckel ist permanent — der Entwurf investiert die
Architektur in das transiente Problem und erledigt das permanente mit einem
`min()`; es muss umgekehrt sein, und weil am 01.10. in 12 Tagen nichts
Validiertes mehr steht, beginnt Phase 0 mit dem, was schon im Archiv liegt:
dem **Rabatt-Ende am 01.07.2026**, derselbe Schock in derselben Richtung wie
der 01.01.2027 (§5.6, §5.8).

---

## 5.2 Was der Entwurf richtig sieht

Fair zuerst — vier Punkte tragen und werden hier nicht wiederholt diskutiert:

1. **Ein dauerhafter Niveau-Sprung ist für einen M-Schätzer ein anderes Problem
   als ein Ausreißer.** Richtig. Huber-IRLS begrenzt den Einfluss einzelner
   Punkte, nicht den eines Regimes; `engine/models.py::huber_fit` hat keine
   Bruchstelle im Design.
2. **Die Tagesrhythmen bleiben intakt, das Niveau nicht.** Richtig und wichtig:
   Harmonische, Wochentags-Dummies und der Mittags-Schritt müssen nicht neu
   gelernt werden. Der Eingriff gehört an den Level-Term, nicht an die Form.
3. **Die 12-Uhr-Projektion ist der richtige Anbauort für eine weitere
   juristische Regel.** Richtig — nur nicht als `min()` dahinter, sondern als
   zweite erlaubte Sprungkante *davor* (§5.3.3, §5.3.4).
4. **Am Beta-Binomial-Update selbst ist algorithmisch nichts zu ändern.**
   Richtig. `(hits+5)/(n+10)` ist der Posterior-Mittelwert eines Beta(5,5), die
   Grundgesamtheit rollt über 30 Tage; der Schätzer heilt. Was nicht heilt, ist
   das, was *aus ihm folgt* (§5.4.4).

---

## 5.3 Fünf Korrekturen, gemessen

### 5.3.1 Der Punkt heilt — die Verteilung heilt nicht

Der Entwurf warnt vor „wochenlang falschen Prognosen“ des Punktwerts. Gemessen
ist es umgekehrt verteilt: **der Punkt ist nach 2–3 Wochen durch, das Intervall
nach 5 Wochen noch nicht** — und das Intervall ist es, aus dem die App ihre
Entscheidung zieht (`app/pside.py` rechnet `P_besser`, `P_lohnt` und die
Fenster-P ausschließlich aus den Draws).

Szenario A, Bruch −17,0 ct/L um 00:00 am 01.10.2026, sofort und vollständig
durchgereicht, Status quo (vollständige Tabelle in Anhang A):

| Cutoff | Bias q50 | Breite q975−q025 | `P_besser` | Wahrheit: Fenstermin. − Anker |
|---|---|---|---|---|
| 30.09. | −2,2 ct | 7,8 ct | 1,000 | −6,3 ct |
| 02.10. | **+17,7 ct** | **23,1 ct** | **0,000** | −3,9 ct |
| 05.10. | **+17,9 ct** | **23,6 ct** | **0,136** | −11,5 ct |
| 12.10. | +13,2 ct | 24,6 ct | **0,448** | −8,8 ct |
| 16.10. | +5,1 ct | **26,4 ct** | 0,570 | −12,4 ct |
| 29.10. | −0,0 ct | **25,9 ct** | 0,682 | −6,6 ct |
| 08.11. | +1,4 ct | 15,7 ct | 0,842 | −6,7 ct |

Drei getrennte Schäden mit drei getrennten Zeitskalen:

- **Punktniveau: ~2–3 Wochen.** Der Huber-Intercept folgt dem neuen Regime,
  sobald es die Mehrheit des 42-Tage-Fensters stellt; ab dem 16.10. liegt der
  Bias unter 5 ct, am 29.10. bei null. Das ist ärgerlich, aber begrenzt und
  selbstheilend.
- **Intervallbreite: 5+ Wochen.** Die Residuen-Tagesblöcke enthalten beide
  Niveaus. Blöcke aus dem Alt-Regime tragen ±17 ct in jede Ziehung, und die
  exponentiellen Ziehgewichte (Halbwertszeit 14 Tage, `exp_block_weights`)
  dämpfen sie nur: 23–26 ct Breite statt 7,8 ct, also das **3-Fache**, noch am
  29.10. Ein zu breites Intervall ist ehrlich, aber nutzlos — und es ist nicht
  neutral, siehe nächster Punkt.
- **`P_besser`: ~2 Wochen entscheidungsfalsch.** `p_better` vergleicht die
  Fenster-Minima der Draws mit dem **live beobachteten** Anker
  (`app/decide.py`: `anchor = chosen_station["price"]`). Nach einem Preissturz
  steht der Anker im neuen (billigen) Regime, die Draws stehen noch im alten
  (teuren) — also ist `Anker − Draw` systematisch negativ und `P_besser`
  kollabiert auf **0,000–0,448**, während die Wahrheit sagt: ja, es gibt ein
  Fenster 4–12 ct unter dem jetzigen Preis. Die App beantwortet die
  Hauptfrage „jetzt oder warten?“ in genau diesen Wochen mit „jetzt“, und zwar
  mit der Zuversicht einer Zahl, die sie für eine Wahrscheinlichkeit hält.

**Konsequenz für den Entwurf.** Sein Kapitel 1 zielt auf den Punktwert
(„Prognosen“), gemessen ist der Punktwert der am schnellsten heilende Teil.
Ziel der Maßnahme muss die **Verteilung** sein, denn sie trägt die
Entscheidungstabelle — und das ist derselbe Befund M1 aus
[BEFUND-UX-MATH-2026-09-19.md](BEFUND-UX-MATH-2026-09-19.md) („die
Wahrscheinlichkeiten sind bauartbedingt unkalibriert, fließen aber ungefiltert
in die €-P-Entscheidungstabelle"), nur mit einem harten Termin daran.

### 5.3.2 „17 Cent abziehen“ ist der falsche Mechanismus

Der Entwurf beschreibt die richtige Semantik — *„der Vorhersage-Tag liegt im
Rabatt-Regime, die Trainingsdaten aus dem September aber nicht"* — und wählt
dafür den falschen Mechanismus: eine Vorverarbeitung der Trainingsdaten. Vier
Gründe, alle messbar.

**(a) Die Semantik gehört in die Designmatrix, nicht in die Daten.** Was der
Entwurf beschreibt, ist ein Schritt-Dummy `D(t) = 1{t ≥ Kante}` mit Koeffizient
γ. Genau dieses Muster hat die Engine schon einmal gebaut: der Mittags-Schritt
`after_law & (hour ≥ 12)` in `engine/models.py::features` trägt das eigene
Nachmittag-Niveau der 12-Uhr-Regel ab. Ein Regime-Dummy ist dieselbe
Konstruktion, eine Spalte mehr, vom selben Huber-IRLS geschätzt, und er gilt
**automatisch für Training und Prognose** — weil `predict` die Features für das
Prognoseraster neu baut. Ein Datenabzug gilt nur für die Seite, an die man
gedacht hat.

**(b) Der angekündigte Termin ist nicht der Wirksamkeits-Termin.** Szenario B:
Durchgabe 2 Tage verzögert und zu 85 % (also −14,5 ct ab dem 03.10.) — beides
ist das, was man aus 2022 und aus jedem Kartellamtsbericht erwartet, nicht das,
was eine Pressemitteilung sagt. Hartkodiert auf den 01.10.:

| Cutoff | Status quo | hartkodiert −17 ct ab 01.10. | Kante **und** Betrag geschätzt |
|---|---|---|---|
| 01.10. | +4,2 ct / 6,6 / 0,730 | **−12,8 ct** / 6,6 / 1,000 | −12,8 ct / 6,6 / 1,000 |
| 02.10. | +0,9 ct / 7,6 / 1,000 | **−14,5 ct** / 14,9 / 1,000 | −14,5 ct / 14,9 / 1,000 |
| 03.10. | +16,0 ct / 7,8 / 1,000 | +1,3 ct / **18,4** / 0,956 | +1,3 ct / **18,4** / 0,956 |
| 08.10. | +14,3 ct / 19,9 / 0,192 | −0,1 ct / **18,4** / 0,922 | −0,9 ct / **7,6** / 1,000 |
| 16.10. | +6,0 ct / 20,9 / 0,510 | −1,6 ct / **18,0** / 0,940 | −0,9 ct / **8,0** / 1,000 |
| 22.10. | +7,7 ct / 21,0 / 0,660 | +4,4 ct / **16,1** / 0,954 | +3,8 ct / **7,3** / 1,000 |

*(Format: Bias q50 / Breite q975−q025 in ct / `P_besser`.)*

Die hartkodierte Korrektur **tauscht einen +16-ct-Fehler gegen einen
−14,5-ct-Fehler** an den Tagen, an denen die Tankstellen noch nicht gesenkt
haben. Nutzer sähen eine Prognose von 1,58 €/L an einer Tafel mit 1,72 €/L —
der teuerste Vertrauensfehler, den diese App machen kann, und er wäre
hausgemacht. Und die Breite bleibt den ganzen Oktober über bei 15–18 ct statt
7 ct: **eine Korrektur zum falschen Termin injiziert einen künstlichen Bruch in
die Trainingsdaten** und bläht damit genau die Verteilung, die sie retten
sollte. Nur die Variante mit geschätzter Kante bringt die Breite am 08.10. auf
7,6 ct zurück, also auf Vor-Bruch-Niveau.

**(c) Brutto ist nicht netto, und die 17 ct sind nicht die Steuer.** Die
Meldung nennt 14 ct Energiesteuer und 3 ct Mehrwertsteuer-Effekt. Das ist keine
Addition, sondern eine Multiplikation: 14 ct × 1,19 = 16,7 ct ≈ 17 ct. Für die
Engine folgt daraus zweierlei. Erstens ist der Bruttopreis eine **multiplikative**
Funktion des Nettopreises — ein Eingriff, der als additiver ct-Betrag modelliert
wird, ist nur bei vollständiger Durchgabe exakt. Zweitens hängt der Betrag je
Sorte an einem anderen Steuersatz (Energiesteuer Benzin 65,45 ct/L, Diesel
47,04 ct/L); die Engine führt E5/E10/Diesel getrennt (`--fuel`), eine einzige
globale Zahl „17 ct“ ist für mindestens eine Sorte falsch. 2022 waren es
29,55 ct/L für Benzin und 14,04 ct/L für Diesel — die „14 ct“ dieser Meldung
sind auffällig nah am damaligen Diesel-Wert.

**(d) δ̂ aus den Daten ist nicht kostenlos, aber billiger als die Annahme.** Der
slot-gematchte robuste Unterschied (Median je 5-Minuten-Slot nach minus vor,
dann Median über die Slots — entfernt die Tagesform, weil je Slot verglichen
wird) liefert in Szenario A −18,4 bis −20,0 ct statt der wahren −17,0 ct, also
1,4–3,0 ct Überschwinger aus der Niveau-Drift. In Szenario B findet er −14,5
bis −15,5 ct, also fast exakt die wahren −14,5 ct. **Folgerung: nicht
entweder/oder, sondern Shrinkage** — die Ankündigung als Prior-Mittelwert mit
einer Durchgabe-Unsicherheit (±3 ct sind aus 2022 gut begründbar), δ̂ als
Likelihood, präzisionsgewichtet kombiniert. Das ist dasselbe Muster wie die
×0,9-Stabilitätsschrumpfung in `fit_ar2` und das Beta(5,5)-Prior im Ledger:
dieses Repo schrumpft schon überall sonst.

**Drei Betriebsfehler des Schätzers, im Lauf gefunden** (alle drei gehören ins
Konzept, nicht in die Fußnote):

1. **Zu wenig Nach-Daten.** Am 05.10. — zwei Tage nach der Kante — schätzte der
   Lauf die Kante auf den 30.09. und δ̂ auf −4,4 ct; Ergebnis Bias +9,3 ct,
   `P_besser` 0,044. Ab fünf Nach-Tagen trägt die Schätzung.
2. **Kante einen Tag daneben.** Am 04.01.2027 (Szenario C) fand der Lauf
   t̂ = 31.12. statt 01.01. und δ̂ = +14,4 ct statt +17,0: Bias −5,8 ct und
   Breite **20,6 ct statt 8,1**. Dieselbe Wirkung wie ein falscher
   angekündigter Termin (§5.3.2b) — eine um einen Tag versetzte Kante injiziert
   einen künstlichen Bruch und bläht die Verteilung. Ab dem 06.01. ist t̂ exakt
   und die Breite zurück auf 8,1 ct.
3. **Alternde Kante.** Am 29.10. war der Bruch aus dem 21-Tage-Suchfenster
   herausgerutscht, der Schätzer lieferte nichts und fiel auf die hartkodierte
   Annahme zurück (Breite wieder 15,5 ct).

**Folgerung: Ein erkanntes Regime muss persistiert werden, nicht je Lauf neu
detektiert.** Dazu zwei Schwellen, die beide auf den *verwendeten* Betrag prüfen
müssen, nicht auf die Teststatistik: Im Lauf fiel am 31.12.2026 eine
falsch-positive Kante aus Weihnachts-Rauschen an (Tageskontrast über der
Schwelle, slot-gematchter Betrag nur +1,2 ct), und sie kippte den 02.01. auf
−14,9 ct Bias. Erst die Prüfung „Kontrast **und** |δ̂| ≥ 2 ct“ nimmt sie
zurück — in `analysis/regime_check.py` als `MIN_STEP_CT` an beiden Stellen
umgesetzt und im Lauf nachgewiesen.

### 5.3.3 Die 12-Uhr-Projektion frisst den Regime-Sprung

Das ist der wichtigste Code-Befund, und er steht in keinem der beiden Papiere.
`noon_law_projection` projektiert jeden Verlauf je Segment [12:00 Uhr, nächste
12:00 Uhr) auf *nicht-steigend* (PAVA, exakte L2-Projektion). Ein
Steuer-Schritt um Mitternacht liegt **mitten in einem solchen Segment**.

Gemessen, 288-Punkte-Segment [31.12. 12:00, 01.01. 12:00), reale Tagesform,
Regime-Dummy +17 ct ab 00:00:

| | Sprung über die Kante | verbogene Punkte | größter Fehler |
|---|---|---|---|
| ohne Projektion (was das Gesetz am 01.01. tut) | +16,89 ct | — | — |
| **mit bestehender Projektion** | **+0,00 ct** | **231 von 288** | **+9,83 ct** zu hoch vor der Kante, **−7,06 ct** zu niedrig danach, \|Fehler\|-Mittel 3,03 ct |
| mit Regime-Kante als zusätzlicher Segmentgrenze | +16,89 ct | 0 von 288 | 0,00 ct |

Die Projektion **löscht den Schritt vollständig** und verteilt ihn über fast das
ganze Segment: Der Silvesterabend wird bis zu 10 ct zu teuer prognostiziert, der
Neujahrsmorgen bis zu 7 ct zu billig. Das passiert **auch dann, wenn die
Regime-Korrektur perfekt ist** — sie passiert *wegen* ihr, weil der Dummy den
Sprung in die Struktur legt und die Projektion ihn dort wieder herausnimmt.

Die Asymmetrie ist juristisch begründet und deshalb nicht wegkonfigurierbar:
Senkungen sind jederzeit erlaubt, also geht der −17-ct-Schritt am 01.10.
unbeschadet durch (gemessen: 0 von 288 Punkten betroffen, −17,11 ct bleiben
−17,11 ct). **Nur der Anstieg am 01.01.2027 wird zerstört** — der Termin, an dem
die Richtung ohnehin die gefährliche ist (§5.4.1).

Der Fix ist klein und liegt in gut getestetem Code: `_segment_bounds` bekommt
zusätzliche erlaubte Sprungzeitpunkte aus dem Regime-Kalender (R1/R3). Die
Segment-Logik ist seit B15 vektorisiert und wird je Lauf einmal für alle
Bootstrap-Pfade berechnet; ein oder zwei zusätzliche Kanten pro Prognose kosten
nichts Messbares.

**Offene Rechtsfrage, die vorher geklärt sein muss** (§5.9): Darf eine
Tankstellenpreis-Erhöhung, die ausschließlich eine gesetzlich wirksame
Steueränderung durchreicht, um 00:00 Uhr erfolgen — oder gilt die 12-Uhr-Regel
auch dann? Die Antwort entscheidet, ob die Regime-Kante eine *erlaubte*
Sprungkante ist (dann R3 wie oben) oder ob die Projektion recht hat und die
Stationen die Erhöhung tatsächlich erst um 12:00 Uhr zeigen dürfen. Beides ist
modellierbar; raten darf die Engine es nicht. Solange die Antwort fehlt, ist der
ehrliche Zustand: Kante als **zulässige** Sprungkante führen und im Artefakt
ausweisen, dass sie aus einer Steuermaßnahme und nicht aus einer Beobachtung
stammt.

### 5.3.4 Der Deckel ist keine Konstante, und das Clipping sitzt an der falschen Stelle

Der Entwurf nennt `predicted_price = min(model_price, LEGAL_CAP)` mit
„z. B. 1,80 €“ und setzt es „nach dem Bootstrap und nach dem AR(2)-Nachlauf“,
also ans Ende der Kette. Beides hält nicht.

**(a) Die genannten Vorbilder haben keinen festen Deckel.** Belgien setzt
Höchstpreise aus einem Referenzproduktkurs (ARA-Notierungen über ein
rollierendes Fenster) plus gesetzlich fixierten Kosten- und Margenkomponenten
zusammen; Luxemburg arbeitet mit staatlich festgesetzten Höchstpreisen über
Verordnungen. In beiden Fällen **bewegt sich der Deckel**, teils täglich, und er
bewegt sich mit dem Rohöl- und Produktmarkt — nicht mit der Politik. Für die
Engine heißt das: `cap(t)` ist eine **Zeitreihe**, keine Konstante, und sie
braucht eine Quelle. Ein `min()` gegen eine Zahl, die vor drei Wochen stimmt
war, ist eine stille Lüge — genau das, was dieses Repo mit
„Datenqualität statt stiller Korrektur“ ausschließt.

**(b) Die Reihenfolge ist falsch, und zwar nachweisbar.** Ein bewegter Deckel,
der um 00:00 Uhr steigt (Referenzkurs hoch), zusammen mit `min()` **nach** der
12-Uhr-Projektion:

| Reihenfolge | Ergebnis |
|---|---|
| Projektion → `min(·, cap(t))` | **illegaler Anstieg von +5,0 ct um Mitternacht** — die 12-Uhr-Regel ist verletzt, und zwar in der veröffentlichten Kurve |
| `min(·, cap(t))` → Projektion | legal (max. Anstieg 0,00 ct), aber der Deckelsprung wird um −2,5 ct verflacht |
| Deckel-Wechsel als erlaubte Sprungkante → `min` → Projektion | legal **und** exakt |

`min(x, c)` ist monoton, deshalb bleibt eine *konstante* Schranke harmlos — der
Entwurf hat mit dem statischen Beispiel recht. Sobald `cap(t)` selbst steigt,
erzeugt punktweises Abschneiden einen Anstieg an der Deckel-Kante. Also gehört
der Deckel-Wechsel in dieselbe Liste erlaubter Sprungzeitpunkte wie die
Regime-Kante (R3), und das Clipping gehört **vor** die Projektion.

**(c) Ein bindender Deckel zensiert die Trainingsdaten — das ist mehr als
Abschneiden.** Liegt der Marktpreis am Deckel, sind die Beobachtungen
top-censored. Drei Folgen, die der Entwurf nicht behandelt:

1. Die Residuen am Deckel sind künstlich klein. Der Tagesblock-Bootstrap zieht
   sie und **unterschätzt die Unsicherheit des unzensierten Preises** — das
   Modell wird ausgerechnet dann zu selbstsicher, wenn der Markt unter Spannung
   steht. Beim Wegfall oder Anheben des Deckels ist die Prognose systematisch
   zu niedrig.
2. Die Streuung *zwischen* Stationen kollabiert: Wenn alle am Deckel stehen,
   gibt es kein „wo ist es billiger“ mehr. Damit fällt der Kern der
   Umweg-Ökonomie (`app/route.py`, `elsewhere_net_eur`) auf null, und
   `P_lohnt` wird zur Scheingenauigkeit über zwei identische Preise. Das ist
   eine **Produktaussage**, keine Randnotiz: Die App muss dann sagen „Der Deckel
   bindet: Timing und Ort bringen nichts", statt weiterhin Sterne und
   Wahrscheinlichkeiten zu zeigen.
3. Umgekehrt wird die Prognose *besser*, nicht schlechter: Ein Formeldeckel ist
   eine deterministische Funktion veröffentlichter Referenzkurse. Wer die Formel
   und die Kurse hat, kann den Deckel genauer vorhersagen als jeden
   Wettbewerbspreis. **Das ist eine Chance**: „Der Deckel morgen: 1,78 €/L
   (Referenzkurs gefallen)" ist eine ehrlichere und nützlichere Auskunft als
   jede Bootstrap-Wolke. Voraussetzung ist R4 mit Quelle, nicht `LEGAL_CAP`.

Richtig am Entwurf ist die Verteilungs-Aussage: Pfade über der Schranke gehören
auf die Schranke, und die Masse am Limit ist die korrekte Abbildung. Sie muss
nur **ausgewiesen** werden (`p_at_cap` je Fenster), sonst liest niemand, dass
das 90-%-Quantil eine Kante und keine Schätzung ist.

### 5.3.5 Der 42-Tage-Bezug ist nicht das eigentliche Problem

Der Entwurf macht das Fenster zum Tatort („wieder zerreißt es dein
42-Tage-Trainingsfenster"). Gemessen ist das Fenster nicht der Hebel:
`train_days = 14` heilt den Punkt schneller (ab dem 08.10. statt ab dem 16.10.),
löst aber weder die erste Woche noch die Verteilung —

| Cutoff | Bias | Breite | `P_besser` |
|---|---|---|---|
| 02.10. | +18,4 ct | 18,4 ct | **0,000** |
| 05.10. | +20,3 ct | 20,8 ct | **0,000** |
| 08.11. | +6,4 ct | 10,7 ct | **0,044** |

— und destabilisiert den Fit danach (08.11.: `P_besser` 0,044 bei einer
Wahrheit von −6,7 ct; bei 14 Tagen liegt der Fit nahe an `min_train_days = 28`
bzw. unter ihr, ein einziger Collector-Ausfalltag lässt ihn mit `ValueError`
scheitern). Die in [ENGINE.md](../referenz/ENGINE.md) offen gehaltene 90-vs-42-Entscheidung
darf deshalb **nicht** im Oktober getroffen werden: Jede Messung in diesem
Monat misst den Bruch, nicht das Fenster (§5.4.3, §5.8).

---

## 5.4 Was der Entwurf nicht sieht

### 5.4.1 Der 1. Januar ist die gefährliche Richtung

Beide Brüche sind gleich groß und **ungleich gefährlich**. Am 01.10. fällt der
Preis: Ein zu hoch liegendes Modell sagt „jetzt tanken“, der Nutzer tankt zu
früh und ärgert sich über verpasste 10 ct. Am 01.01. steigt der Preis: Ein zu
niedrig liegendes Modell sagt „warten“ — und der Nutzer läuft in die Erhöhung
hinein. Genau das benennt `app/thresholds.py` als den teuren Fehler
(„Falsches WARTEN ist der teure Fehler“), und
[archiv/GUTACHTEN-2026-09-10.md](GUTACHTEN-2026-09-10.md) nennt es
asymmetrisch („Warten und in eine 10-Cent-Erhöhung laufen, kostet massiv
Vertrauen").

Gemessen, +17,0 ct am 01.01.2027 um 00:00, Status quo:

| Cutoff | Bias q50 | Breite | `P_besser` | Wahrheit: Fenstermin. − Anker |
|---|---|---|---|---|
| 31.12. | +1,3 ct | 7,6 ct | 1,000 | −7,7 ct |
| **01.01.** | **−15,4 ct** | 7,7 ct | **0,920** | **+10,0 ct** |
| 04.01. | −19,2 ct | 19,1 ct | 1,000 | −6,9 ct |
| 06.01. | −17,8 ct | 22,4 ct | 1,000 | −14,3 ct |
| 10.01. | −16,0 ct | 24,1 ct | 1,000 | −9,9 ct |

Am 01.01. liegt das billigste Fenster der nächsten 24 Stunden **10 ct über** dem
jetzigen Preis — es gibt kein günstigeres Fenster, die richtige Antwort ist
`P_besser = 0`. Die Engine liefert **0,920**. Mit Schritt-Dummy: Bias +1,6 ct,
Breite 7,7 ct, `P_besser` **0,000** — korrekt.

Das ist kein Restrisiko, sondern ein **datierter, richtungssicherer, hoher
Fehler** am ersten Tag eines Jahres, an dem die App ohnehin im Fokus steht.
Dazu kommt §5.3.3: Selbst ein perfekter Dummy würde am 01.01. von der
PAVA-Projektion auf null gepoolt. **Der 01.01.2027 braucht R2 und R3 zusammen,
oder er wird der schlechteste Tag dieser App.**

### 5.4.2 Der gepoolte Feiertags-Fit ist heute schon verfälscht

Der Feiertags-Koeffizient γ wird bewusst **nicht** im 42-Tage-Fenster geschätzt,
sondern gepoolt über bis zu `holiday_pool_days = 365` — korrekt begründet
(„0–1 Feiertage je 6-Wochen-Fenster wären unidentifizierbar“). Das Pool-Fenster
reicht damit bis September 2025 zurück (`docs/referenz/API.md`: `archive_since
2025-09-09`) und **enthält den Mai-Juni-Tankrabatt 2026 vollständig**. Von den
11 Feiertagen im Pool (NW) fallen vier in das Rabatt-Fenster: 01.05., 14.05.
(Himmelfahrt), 25.05. (Pfingstmontag), 04.06. (Fronleichnam). Der
Rabatt-Anteil an allen Pool-Tagen beträgt 16,8 %.

Gemessen mit `huber_fit` auf den echten `features()`-Spalten, kontrollierter
Vergleich mit und ohne Rabatt im Pool:

| | `holiday_beta` | Verfehlung |
|---|---|---|
| Referenz (Pool ohne Rabatt) | **+5,96 ct/L** | — |
| Pool mit Mai-Juni-Rabatt (NW) | +4,48 ct/L | **−1,47 ct/L** |
| Pool mit Mai-Juni-Rabatt (BY) | +4,64 ct/L | −1,24 ct/L |

Der Feiertagszuschlag ist um rund ein Viertel zu klein, weil Pfingsten und
Himmelfahrt zufällig in eine Steuererleichterung fielen. **Einordnung: θ = 1,0
ct/L ist die Signifikanzschwelle der Entscheidung** (`app/pside.py::THETA_CT`),
und `wait_eur_high = 2,00 €` sind bei 50 L rund 4 ct/L. Eine Feiertags-
Verfehlung von 1,5 ct/L ist also größer als die Schwelle, ab der die App
überhaupt einen Unterschied zählt, und knapp 40 % der Warten-Schwelle.

Das ist **kein Oktober-Problem, sondern ein Zustand der heute veröffentlichten
Artefakte.** Und es wiederholt sich: Im neuen Rabatt-Fenster liegen der
03.10. (Tag der Deutschen Einheit), der 01.11. (Allerheiligen, u. a. NW) und
der 25./26.12. — erneut vier von elf Feiertagen im Pooljahr, erneut in einem
fremden Regime.

**Folgerung:** Die Regime-Normalisierung muss **beide** Fits bedienen, den
42-Tage-Fit *und* den Pool-Fit. Der Entwurf spricht nur vom 42-Tage-Fenster.
Kurzfristig und ohne Regime-Schicht hilft schon die billigste Maßnahme: den
Pool um deklarierte Regime-Fenster kürzen (`holiday_pool_days` bleibt, aber die
Pool-Stützstellen aus Regime-Zeiten fallen aus) — ehrlich ausgewiesen über
`holiday_pool_days` und `holiday_source`, die das Artefakt schon trägt.

### 5.4.3 Das Qualitäts-Gate wird durch den Bruch grüner, nicht roter

MASE teilt den Modellfehler durch die saisonale Naive
(`seasonal_scale`: mittlerer |p(t) − p(t−288)|). Ein 17-ct-Schritt liegt in
genau einem Tagespaar und **bläht den Nenner**:

| Cutoff | `mase_scale` | Naive-MAE im 14-Tage-Validierungsfenster | MASE harmonisch | MASE Profil |
|---|---|---|---|---|
| 20.09. | 1,98 ct | 2,42 ct | 0,146 | 0,158 |
| 30.09. | 2,21 ct | 2,47 ct | 0,144 | 0,166 |
| 05.10. | 2,78 ct | **6,30 ct** | **0,125** | **0,115** |
| 12.10. | 2,80 ct | 5,88 ct | 0,226 | 0,225 |
| 16.10. | 2,92 ct | 4,50 ct | 0,287 | 0,331 |
| 22.10. | 2,94 ct | 2,55 ct | **0,375** | **0,515** |

Zwei getrennte Schäden. Erstens: Der Nenner des Backtest-Gates wächst um
**27–33 %**, im Ensemble-Validierungsfenster (`ensemble_detail`, 14 Tage) um
das **2,4-Fache** — jede MASE wird um denselben Faktor besser, `mase_24h_below_0_95`
ist also **leichter zu erfüllen, während das Modell 17 ct daneben liegt**. Ein
Schock kann ein Gate grün schalten. Zweitens: Die Kennzahl ist um den Bruch
herum **nicht monoton in der echten Güte** — am 05.10. meldet sie 0,115
(blendend), am 22.10. meldet sie 0,375/0,515 (schlecht), obwohl das Niveau am
22.10. schon fast geheilt ist und am 05.10. noch voll daneben lag.

**Folgerung für die Governance, nicht für die Mathematik:** Jede
Parameter-Entscheidung, jede A/B-Messung und jede Gate-Freigabe im Zeitraum
01.10.2026–15.11.2026 ist uninterpretierbar, solange Brüche im Fenster nicht
ausgewiesen sind. Der Backtest-Report braucht ein Feld
`regime_breaks_in_window` (Anzahl, Termin, Betrag, Quelle), und die
Ensemble-Gewichte brauchen dieselbe Kennzeichnung — sonst wird im Oktober jemand
`train_days` senken, weil die Messung es nahelegt, und overfittet den Bruch.
Das ist exakt die M7-Prozessregel aus
[BEFUND-UX-MATH-2026-09-19.md](BEFUND-UX-MATH-2026-09-19.md) („jede
Parameteränderung nur mit dokumentiertem Ablations-Backtest") — sie braucht
jetzt eine Ausnahme-Klausel: **kein Ablations-Backtest über eine Regime-Kante.**

### 5.4.4 Der Schwellenregler lernt aus einem Steuergeschenk

`app/thresholds.py` zieht die Entscheidungsschwellen **deterministisch aus dem
Ledger** nach: `hit_wait` über Ziel + 10 pp → „WARTEN erleichtern“. Im Oktober
werden Warten-Empfehlungen aus dem September durch den Preissturz massenhaft zu
Treffern — nicht weil Warten klug war, sondern weil der Staat gesenkt hat. Der
Regler kann einen Steuereffekt nicht von einer Modellgüte unterscheiden und
würde die Warten-Gates lockern, genau wenn das Warten (Richtung Januar)
gefährlich wird. Der H3-Oszillationsschutz (MIN_N = 25, Rauschband ±2 SE,
Totband) dämpft das, verhindert es aber nicht: 30 Tage × mehrere Empfehlungen
pro Tag sind weit über MIN_N, und der Effekt ist kein Rauschen, sondern ein
Bias.

**Folgerung:** Settlements, deren Bewertungsintervall eine deklarierte
Regime-Kante schneidet, müssen im Ledger **gekennzeichnet und aus der
Regler-Grundgesamtheit ausgeschlossen** werden — nicht gelöscht (Ehrlichkeit:
der Nutzer hat die Empfehlung gesehen und das Geld wirklich ausgegeben), aber
nicht als Evidenz für die Schwellen gezählt. Dasselbe gilt für das
M7-Kalibrierungs-Gate (`n ≥ 100`, `brier < 0.25`, ausschließlich über
P aus der Verteilung): Eine Übergangswoche mit `P_besser = 0,000` bei
eingetretenem Ereignis treibt den Brier-Anteil dieser Tage gegen 1,0 und kann
**das Gate auf Monate schließen**. Der Schaden des Bruchs ist dann nicht eine
schlechte Prognose, sondern eine App, die weiterhin `no_advice` sagt — der
Bruch kostet den Produktstart, nicht die Genauigkeit.

### 5.4.5 Der Verstößezähler meldet am 1. Januar Verstöße, die keine sind

`law_rise_outside_noon` zählt Erhöhungen ≥ 1 ct, deren 5-Minuten-Intervall
keinen erlaubten 12:00-Uhr-Punkt enthält — als Datenqualitätssignal, ausdrücklich
nicht als stille Korrektur. Eine Steuer-Erhöhung, die um 00:00 Uhr durchgereicht
wird, erfüllt genau dieses Muster. Gemessen: **1 gezähltes Intervall je Station
und Sorte** am Sprungtag; im Live-Bestand mit ~20 Stationen also ~40
„Regelverstöße“ in einem einzigen Bericht, im Archivbestand (282 Stationen)
dreistellig. Der Report würde am 01.01.2027 aussehen wie ein flächendeckender
Rechtsbruch der Tankstellen.

**Folgerung:** Der Zähler braucht eine zweite Kategorie
`rise_at_regime_boundary` (gleiches Muster, aber das Intervall enthält eine
deklarierte Regime-Kante). Dieselbe Trennung, dieselbe Ehrlichkeit, keine
gelöschten Punkte — nur kein Fehlalarm. `analysis/noon_rule_check.py` zählt
analog und braucht denselben Ausschluss, sonst „beweist“ der Check am 02.01.
einen Regelverstoß.

### 5.4.6 Die WO-Seite ist immun, die WANN-Seite nicht

Die App hat zwei Hälften, und der Bruch trifft nur eine:

- **Selektion/WO** (`engine/selection.py`) arbeitet auf δ̂, dem Abstand einer
  Station zum Stadt-Median — einer **Differenz**. Eine einheitliche Steuersenkung
  kürzt sich heraus. Dazu hat diese Hälfte den Strukturbruch-Schutz schon:
  EW-Median mit 7 Tagen Halbwertszeit und `cusum_break`/`break_flag`
  (Issue 48 / Befund F5). Getroffen wird sie nur von **ungleichmäßiger**
  Durchgabe — und genau dafür ist der CUSUM-Flag da.
- **Prognose/WANN** (`engine/models.py`) arbeitet auf **absoluten Niveaus** und
  ist voll exponiert.

Das ist die eigentliche Architektur-Aussage, und sie ist billiger als eine neue
Schicht: **Die Engine hat schon einen Regime-Detektor — nur in der falschen
Hälfte.** R2 sollte denselben Mechanismus nutzen (Tages-Mediane + CUSUM/
Zweiteilung), statt einen zweiten zu erfinden, und die WANN-Seite sollte wo
immer möglich auf **Differenzen gegen den live beobachteten Anker** rechnen
statt auf modellierten Niveaus. Das ist nicht neu, sondern Empfehlung B1 /
Befund M5 aus
[BEFUND-UX-MATH-2026-09-19.md](BEFUND-UX-MATH-2026-09-19.md): den Nowcast am
Live-Preis konditionieren. `P_besser` tut das schon (Anker = Live-Preis),
`P_lohnt` nicht (beide Seiten kommen aus Modell-Draws:
`app/model_jobs.py::_draws` veröffentlicht `nowcast = paths[:, 0]`). **B1 ist
damit keine UX-Feinheit, sondern die billigste verfügbare Regime-Maßnahme für
F2** — und sie war ohnehin geplant.

---

## 5.5 Konzept: Regime-Kante statt Regime-Korrektur

Keine neue Schicht *neben* der Pipeline, sondern vier Anbauten an bestehende,
getestete Funktionen. Leitbild: **Der Rohbestand bleibt unverändert** (wie bei
der 12-Uhr-Bodenkante B30 wird nichts umgeschrieben), die Regime-Information
liegt als Daten vor, wird im Modell als Dummy getragen, in der Projektion als
erlaubte Kante respektiert und im Artefakt ausgewiesen.

### R1 Regime-Kalender als Daten

`engine/regimes.py` (Standardbibliothek + pandas, wie `app/law.py`): eine Liste
von Interventionen, je Eintrag

```text
kind            tax_step | price_cap
fuel            E5 | E10 | DIESEL            (je Sorte, nie global — §5.3.2c)
announced_local ISO-Zeitpunkt (Europa/Berlin), darf fehlen
announced_value ct/L brutto, darf fehlen     (Prior, nicht Wahrheit)
effective_local nachgewiesener Zeitpunkt     (aus den Daten, §R2)
effective_value nachgewiesener Betrag ct/L
status          announced | detected | in_force | unknown
source          Deklaration (Gesetz/Presse) oder Schätzung mit Beleg
```

Durchgereicht wie `price_law_local`: `Settings` → `app/config.py::engine_config`
→ `Config` (neues Feld `regimes`, `to_dict`/`__hash__` mitziehen, damit
`Config` hashbar bleibt und Artefakte reproduzierbar sind). Ein eigener
Umschalter `TANKAPP_REGIME=0` schaltet die Schicht für Gegenmessungen ab —
dasselbe Muster wie `TANKAPP_LAW_FLOOR`, `TANKAPP_SHARED_DRAWS`,
`TANKAPP_DAYPAIR`. Mehrdeutige/nicht existente Wanduhrzeiten werden abgelehnt,
nicht verschoben (`parse_price_law` ist die Vorlage).

**Warum als Daten und nicht als Code:** Der Deckel kommt spätestens 2027, seine
Ausgestaltung ist offen, und die Übergewinnsteuer-Prüfung kann weitere
Maßnahmen bringen. Ein Kalender, den der Betrieb pflegt, schlägt jede
Hardcodierung in `features()`.

### R2 Schritt als Dummy mit geschätzter Kante und geschätztem Betrag

1. `features()` bekommt je aktiver `tax_step`-Intervention eine Spalte
   `1{t ≥ effective_local}` (vor der Detektion: `announced_local`, mit
   `status`-Kennung im Artefakt). Der Koeffizient wird vom bestehenden
   Huber-IRLS mitgeschätzt — 14 statt 13 Spalten, `SCHEMA_VERSION = 3`.
2. **Kante und Betrag werden geschätzt, nicht geglaubt.** Tages-Mediane über ein
   Suchfenster (21 Tage), Zweiteilungs-Argument (kleinste absolute
   Binnen-Streuung) für t̂, slot-gematchte robuste Differenz für δ̂
   (Median je 5-Minuten-Slot, dann Median über Slots — entfernt die
   Tagesform). Beides nur aus Daten **strikt vor dem Cutoff**.
3. **Shrinkage gegen die Ankündigung:** δ = w·δ̂ + (1−w)·δ_announced mit
   w aus den Präzisionen (Ankündigung als Prior mit ±3 ct Durchgabe-Streuung,
   δ̂ mit seinem Bootstrap-Standardfehler). Bei `n_post < 5 Tagen` ist w = 0
   (Vorbehalt gilt, ausgewiesen), danach wächst w.
   **Der Standardfehler gehört zum Schätzer, nicht zur Differenz der Niveaus.**
   Gezogen werden muss innerhalb jeder Seite getrennt (Vor-Tage unter sich,
   Nach-Tage unter sich), sonst mischt der Bootstrap beide Regimes in eine
   Median-Statistik und meldet die Regime-Differenz als Unsicherheit. Im Lauf
   auf dem Juli-Testbestand gemessen: ein Topf für beide Seiten gibt
   `se = 6,6 ct` bei δ̂ = 17,45 ct — Durchgabe „102,6 % ± 39 %", also unlesbar;
   je Seite gezogen sind es `se = 0,62 ct`, Durchgabe 102,6 % ± 3,6 %. Genau
   diese Zahl trägt das Gewicht w, ein falscher SE macht die Shrinkage
   wirkungslos (w ≈ 0 für immer) oder leichtsinnig (w ≈ 1 trotz Rauschen).
   Umsetzung und Regressionstest: `analysis/regime_check.py::day_block_se`,
   `tests/test_regime_check.py::test_standard_error_bootstraps_day_blocks_per_side`.
4. **Ein detektiertes Regime wird persistiert**, nicht je Lauf neu gesucht
   (§5.3.2, alle drei gefundenen Betriebsfehler). Speicherort: das Modell-Artefakt
   (`regimes_detected`) plus der Kalender als Quelle.
5. **Der Pool-Fit wird mit normalisiert** (§5.4.2): `holiday_beta` wird auf
   regime-bereinigten Preisen geschätzt; `holiday_pool_days`,
   `holiday_source` und neu `holiday_regime_points_excluded` weisen aus, was
   passiert ist.

*Äquivalenz-Hinweis für die Umsetzung:* δ auf die Nach-Kante-Preise anzuwenden
und die Prognose für Zeiten im neuen Regime um δ zu verschieben, ist exakt ein
Schritt-Dummy. Der Dummy in der Designmatrix ist die saubere Form — aber **er
muss vor der Projektion liegen**, siehe R3.

### R3 Erlaubte Sprungzeitpunkte in der bestehenden Projektion

`_segment_bounds` bekommt eine optionale Liste zusätzlicher Kanten (Regime-Termine,
Deckel-Wechsel). Damit wird

- der +17-ct-Schritt am 01.01. **nicht mehr gepoolt** (gemessen: +16,89 ct
  bleiben, 0 von 288 Punkten verbogen — §5.3.3),
- der Deckel-Wechsel legal abgebildet (§5.3.4b),
- die Deduplizierung von `project_paths` (B15) unverändert nutzbar: sie arbeitet
  je Segment, und mehr Segmente bedeuten nur kürzere.

Die Projektion bleibt eine **Garantie, keine Reparatur**: Wo die Rechtslage
unklar ist (§5.9, Frage 1), wird die Kante geführt und im Artefakt als
`regime_jump_assumed: true` ausgewiesen, damit niemand sie für eine Beobachtung
hält.

### R4 Deckel als bewegliche Schranke vor der Projektion

1. `cap(t)` als Zeitreihe aus R1 (`kind = price_cap`), je Sorte. Quelle offen
   (§5.9, Frage 2); ohne Quelle **kein** Clipping und ein ehrliches
   `cap_status: unknown` — nie ein `min()` gegen eine veraltete Zahl.
2. Reihenfolge in `predict`: **Clip auf `cap(t)` → Projektion (mit R3-Kanten) →
   Quantile → Ordnungsnetz → Clip der Quantile.** Monotonie-Beweis: `min(·, c)`
   ist monoton, erhält also „nicht-steigend“ und die Quantilsordnung
   q025 ≤ … ≤ q975 (beides numerisch bestätigt, §5.3.4).
3. **Zensierungs-Kennzeichnung:** Beobachtungen am Deckel (|p − cap| ≤ 1 ct)
   werden im Fit als `at_cap_points` gezählt und im Backtest ausgewiesen — wie
   `law_rise_outside_noon`. Sie bleiben im Modell (keine stille Löschung), aber
   die Residuen-Blöcke dieser Tage bekommen ein Flag, damit die
   Intervallbreite am Deckel nicht als echte Marktstreuung gelesen wird.
4. **Ausweis der Masse am Limit:** `p_at_cap` je Fenster in der
   Draw-Veröffentlichung, damit die P-Seite sagen kann „Unsicherheit nach oben
   ist gesetzlich begrenzt" statt eine Wolke zu zeigen, die es nicht geben darf.
   Der Entwurf hat diesen Punkt richtig gesehen; er gehört nur in die
   Veröffentlichung, nicht nur in die Rechnung.
5. **Produktfolge bei bindendem Deckel:** Kollabiert die Stationsstreuung
   (alle am Deckel), muss die Umweg-Empfehlung denselben Weg gehen wie heute bei
   fehlender Evidenz: `no_advice` mit Grund „Der Deckel bindet: Ort und
   Zeitpunkt bringen messbar nichts" — nicht `refuel_elsewhere` mit
   `P_lohnt = 0,50` über zwei identischen Preisen.

### R5 Ehrliche Degradation statt falscher Zuversicht

Die ersten Tage nach einer Kante sind ex-ante unsicherbar — kein Schätzer der
Welt weiß am 01.10. um 00:05, ob und wie stark die Station vor der Tür gesenkt
hat. Drei Bausteine:

1. **Szenario-Mischung in den Draws statt Punkt-Korrektur.** Je Draw ein
   Szenario-Bit: Durchgabe erfolgt (δ angewendet) / nicht erfolgt (δ = 0), mit
   einem Gewicht aus der gemessenen Durchgabe-Verzögerung (§5.8). Die
   Wahrscheinlichkeit wird dann breit und mittig — also ehrlich — statt
   falsch und schmal. Anschlussfähig an `shared_day_uniforms`: die Szenario-Bits
   müssen stationsübergreifend gemeinsam gezogen werden (A11), sonst fällt der
   Marktgleichlauf heraus und `P_lohnt` wird wieder zu selbstsicher.
2. **`no_advice` mit eigenem Grund** für das Übergangsfenster (`regime_transition`
   als `reason_code` neben `no_anchor`, `no_forecast`, `no_window`,
   `gray_zone`). Die Infrastruktur dafür steht (`app/decide.py`,
   `_gate_safe_reason`, MICROCOPY-Regelwerk) — es fehlt nur der Code und ein
   Text nach Tonfall „ehrlich, knapp, handlungsleitend“.
3. **Kennzeichnung statt Löschung** überall, wo der Bruch in eine Messung
   hineinreicht: Backtest-Report (`regime_breaks_in_window`), Ledger
   (Settlements über einer Kante zählen, aber nicht in den Regler), Heatmap und
   Tagesstreifen (Regime-Kante als sichtbare Marke), Labor (Karte im
   Parameterschrank, wie B5 sie für die Kalibrierung vorsieht).

### Schema, Umschalter, Tests

- `SCHEMA_VERSION = 3`; `validate_model` prüft `beta.shape == (14,)` und die
  neuen Felder, bleibt aber **zu Schema-2-Artefakten kompatibel** (Fallback:
  keine Regime-Spalte, `regimes_active: false`, ausgewiesen) — dasselbe Muster,
  das B2 für `calibrated` vorsieht. `decision_ready` bleibt `False`.
- Umschalter `TANKAPP_REGIME=0` für die Gegenmessung; `TANKAPP_REGIME_CAP=0`
  trennt Deckel- von Steuer-Schicht, weil beide unterschiedliche Termine haben.
- Tests (Vorbild `tests/test_b30_law_floor.py` und
  `tests/test_noon_rule_check.py`): (i) Dummy-Spalte trägt den Schritt, Prognose
  bitgleich bei `regimes = []`; (ii) PAVA-Projektion erhält einen Regime-Sprung,
  wenn die Kante als Segmentgrenze deklariert ist, und poolt ihn, wenn nicht;
  (iii) Clip-vor-Projektion ist legal, Clip-nach-Projektion fällt als
  Gegenprobe auf; (iv) δ̂-Schätzer findet einen bekannten Schritt auf ±1 ct und
  nutzt nur Daten vor dem Cutoff (Zukunftsleck-Test wie
  `test_no_future_leakage_in_fit`); (v) `law_rise_outside_noon` zählt eine
  deklarierte Regime-Kante nicht als Verstoß; (vi) `holiday_beta` auf
  regime-bereinigtem Pool gleich Referenz-Pool ohne Rabatt.
- Leistung: R2 läuft einmal je Fit und Station (21 Tages-Mediane + 288
  Slot-Mediane), R3 kostet je Lauf ein bis zwei Segmente mehr. Gegen die
  B11-Kaltlauf-Messung (2,6 min für 19 Stationen) ist das vernachlässigbar;
  gemessen wird es trotzdem, weil das NAS das Limit ist.

---

## 5.6 Strategie: drei Phasen gegen drei Termine

Heute ist der 19.09.2026. Bis zum 01.10. sind es **12 Tage**, bis zum 31.12.
**15 Wochen**, bis zum Deckel **≤ 15 Wochen bei unbekannter Ausgestaltung**.
Daraus folgt die Reihenfolge — nicht aus der Architektur.

### Phase 0 — bis 30.09.2026 (11 Tage)

Ziel: **Nichts Falsches sagen und nichts kaputtmessen.** Kein Modell-Umbau, der
nicht mehr validiert werden kann.

| # | Maßnahme | Deckt | Größe |
|---|---|---|---|
| 0.1 | `analysis/regime_check.py`: Durchgabe-Messung auf dem eigenen Archiv für das **Rabatt-Ende 01.07.2026** und den **Rabatt-Start 01.05.2026** — je Station und Sorte: Betrag, Verzögerung, Vollständigkeit, Streuung | §5.8, Grundlage für alles Weitere | 1 Tag |
| 0.2 | R3 allein: Regime-Kante als erlaubter Sprungzeitpunkt in `_segment_bounds`, Kanten aus einem minimalen Kalender (Config-Feld, zwei Termine) | §5.3.3 | 1 Tag |
| 0.3 | Gate- und Regler-Schutz: `regime_breaks_in_window` im Backtest-Report, Settlement-Kennzeichnung über einer Kante, Regler-Grundgesamtheit ohne diese Zeilen, M7-Gate ebenso | §5.4.3, §5.4.4 | 1–2 Tage |
| 0.4 | Pool-Fit-Schutz: Feiertags-Pool-Stützstellen aus deklarierten Regime-Fenster fallen aus, ausgewiesen über `holiday_regime_points_excluded` | §5.4.2 | 0,5 Tage |
| 0.5 | `rise_at_regime_boundary` als zweite Zählerkategorie (Engine + `analysis/noon_rule_check.py`) | §5.4.5 | 0,5 Tage |
| 0.6 | R5.2: `reason_code = regime_transition` + MICROCOPY für das Übergangsfenster | §5.3.1, §5.4.1 | 1 Tag |
| 0.7 | B1/M5 vorziehen: `P_lohnt` konditioniert den Referenzpreis am Live-Preis | §5.4.6 | 1–2 Tage (war ohnehin geplant) |

Summe ≈ 6–8 Entwicklungstage. Das ist in 11 Tagen machbar **und** jeder Punkt ist
für sich abnehmbar, ohne die anderen. 0.2 und 0.3 sind die beiden, die
wirklich vor dem 01.10. stehen müssen: 0.2 weil der Sprung sonst von der
eigenen Projektion gelöscht wird, 0.3 weil sonst der Oktober jede Messung
vergiftet.

### Phase 1 — Oktober bis Dezember 2026

Ziel: **Den echten Bruch als Trainingsmaterial benutzen.** Der Oktober ist kein
Betriebsunfall, sondern die einzige Gelegenheit, R2 an einem realen
Steuer-Schock zu messen, bevor der Deckel kommt.

- R1 vollständig (Kalender, Config-Plumbing, Umschalter, Artefakt-Felder).
- R2 mit Shrinkage; Validierung **am 01.07.2026 im Archiv** (Rolling-Origin
  über die Kante, Status quo vs. Dummy), Nachmessung am echten 01.10.
- R5.1 Szenario-Mischung, sobald 0.1 eine gemessene Verzögerungsverteilung
  liefert (vorher wäre das Gewicht geraten).
- Ablations-Dokumentation je Hyperparameter (M7-Prozessregel) — **außer** über
  einer Kante (§5.4.3).
- Ab November: der in B6 geplante Sonder-Backtest „erster Regel-Winter“ bekommt
  eine zweite Achse „Vor-/Nach-Regime“, sonst werden Winterbewegung und
  Steuerbruch zu einem Fehler vermengt (M8).

### Phase 2 — bis 31.12.2026

Ziel: **Den permanenten Zustand bauen.** Der Deckel bleibt, der Rabatt geht.

- R4, sobald die Ausgestaltung bekannt ist — und **keine Zeile davor**: Ohne
  Formel, Referenz und Quelle ist jeder `LEGAL_CAP`-Wert geraten. Solange gilt
  `cap_status: unknown` und kein Clipping.
- Deckel-Prognose als eigenes Produktmerkmal prüfen (Formeldeckel aus
  veröffentlichten Referenzkursen ist genauer vorhersagbar als jeder
  Wettbewerbspreis, §5.3.4c).
- Produktregel für den bindenden Deckel (Streuungs-Kollaps → `no_advice` mit
  Grund, §R4.5), inkl. GUI-Texte nach MICROCOPY.

### Warum diese Reihenfolge und nicht die des Entwurfs

Der Entwurf baut die Interventions-Schicht für Oktober–Dezember (transient: nach
42 Tagen ist der Rabatt aus jedem Trainingsfenster, gemessen heilt der Punkt
selbst ohne Eingriff in 2–3 Wochen) und erledigt den Deckel (permanent,
strukturverändernd, zensierend, produktverändernd) mit einer Zeile `min()`.
**Die Aufwandsverteilung ist genau verkehrt.** Dazu kommt der Termin: Für den
01.10. lässt sich in 12 Tagen keine validierte Schätzung bauen — wohl aber
ehrliche Degradation, Gate-Schutz und die Projektions-Kante. Und der Deckel
lässt sich heute gar nicht bauen, weil seine Ausgestaltung offen ist; was sich
heute bauen lässt, ist die *Aufnahmefähigkeit* dafür (R1, R3, R4-Schnittstelle).

---

## 5.7 Einordnung in den Batch-Plan B0–B6

Der Batch-Plan aus
[BEFUND-UX-MATH-2026-09-19.md](BEFUND-UX-MATH-2026-09-19.md) bleibt gültig; dieser
Befund hängt sich ein, statt ihn zu ersetzen.

| Batch | Auswirkung | Begründung |
|---|---|---|
| **B0** Messgrundlagen | **ergänzen**: PIT-Paare brauchen einen Regime-Marker, `regime_breaks_in_window` als Zähler — *umgesetzt in 0.56.0 als Kalender (`Config.regimes`), Marker je Zeile `regime_break_spanned`* | PIT-Paare aus dem Übergangsfenster sind der Trainingsstoff von B2 — unmarkiert trainiert die Kalibrierung auf einem Schock |
| **B1** Eine Sprache für € und % | **vorziehen auf Phase 0** (0.7) | M5 (Nowcast am Live-Preis) ist die billigste Regime-Maßnahme für F2, §5.4.6 |
| **B2** Kalibrierungsschicht | **Termin-Gate**: keine Freigabe auf Daten aus 01.10.–15.11. | Eine isotone Rekalibrierung, die auf Bruch-Daten lernt, kalibriert den Schock ein — dauerhaft |
| **B3** Mehrtage & Kerne | **nachziehen**: Day-Pair-Bootstrap erst nach R2 | Mehrtages-Draws über eine Kante sind ohne Dummy doppelt falsch (§5.3.1, §5.4.1); die Ensemble-Gewichte sind im Oktober unbrauchbar (§5.4.3) |
| **B4** Navigation 3+1 | unberührt | keine Kopplung |
| **B5** Labor-Umbau | **eine Karte mehr**: „Regime & Rechtslagen“ im Parameterschrank (Kette: Kalender → δ̂/t̂ → Dummy → Projektions-Kante → Deckel → Zensierung) | Die Regime-Schicht braucht einen Anzeigeort, sonst landet sie im 1760-Zeilen-Akkordeon |
| **B6** Betriebsbeweis | **zweite Achse** Vor-/Nach-Regime im Sonder-Backtest | sonst werden Winter und Steuerbruch vermengt (M8) |
| **neu B7** Regime-Schicht | Phase 0 (0.1–0.7) → Phase 1 (R1/R2/R5.1) → Phase 2 (R4) | hängt an B0 (Marker) und B1 (Anker); B2/B3 hängen an B7 |

```text
        0.1 Messung ──┬── B7-Phase1 (R1/R2) ──┬── B7-Phase2 (R4, Deckel)
        0.2 R3 Kante ─┘                       │
        0.3 Gate-Schutz ──── B0 (+Marker) ────┤
        B1/M5 (0.7) ──────── B2 (erst ab 16.11.) ── B3 ── B5 (+Karte) ── B6 (+Achse)
```

---

## 5.8 Abnahme: welcher Beweis zählt

**Der wichtigste Punkt dieses Befunds, und er kostet nichts:** Dieser Bruch ist
nicht der erste. Das eigene Archiv (`archive_since 2025-09-09`) enthält den
Mai-Juni-Tankrabatt 2026 mit **beiden** Kanten — Start am 01.05. (−) und Ende am
01.07. (+). Das Rabatt-**Ende** ist derselbe Schock in derselben Richtung wie
der 01.01.2027 (§5.4.1), mit echter Durchgabe, echten Verzögerungen und echter
Streuung je Station. Wer den Oktober vorbereiten will, misst den Juli.

**Abnahme Phase 0** (vor dem 01.10.):

1. `analysis/regime_check.py` auf dem Archiv-Export 15.06.–15.07.2026, je
   Station und Sorte: δ̂, t̂, Vollständigkeit in %, Verzögerung in Tagen,
   Streuung über Stationen. Bericht nach `data/analysis/`, wie beim
   12-Uhr-Check.
2. Rolling-Origin-Backtest über den 01.07.2026 (`engine backtest --until
   2026-07-15 --at …`, Rezept in [ENGINE.md](../referenz/ENGINE.md)): Status quo vs. R3 vs.
   R2 — drei Läufe, dieselben Tage. **Zielgrößen:** Bias q50 am Sprungtag
   ≤ 3 ct/L, Breite q975−q025 ≤ 1,5× Vor-Bruch-Basiswert, `P_besser` am
   Sprungtag in Richtung der Wahrheit (Szenario C: von 0,920 auf ≤ 0,20).
3. Invarianz-Nachweis: ohne deklarierte Regime ist die Prognose **bitgleich**
   (Muster aus B0).
4. Gegenmessung dokumentiert: `TANKAPP_REGIME=0` liefert den Vor-Zustand.
5. `law_rise_outside_noon` am 01.07.2026: ohne 0.5 dreistellig, mit 0.5 null —
   und die echten Verstöße bleiben stehen.

> **Messung 20.09.2026 (A16, Juli-Generalprobe, Frankfurt E10 + Diesel,
> 0.59.1)** — Punkt 1 der Phase-0-Abnahme ist gelaufen, die Berichte
> liegen auf dem Daten-Host unter `data/analysis/`. Bestand: E10
> 586.297 gültige Beobachtungen / 282 Stationen (256 geschätzt), Diesel
> 591.280 / 284 (258 geschätzt); Export ab 15.06.2026 ohne `--until`, de
> facto Stundenraster (je Station exakt 24 belegte 5-Min-Slots).
> Ankündigung jeweils 2026-07-01 · +17,0 ct/L wie im Regime-Kalender
> (`DEFAULT_REGIMES`).
>
> | Sorte | δ Median (p10–p90) | Spread | Durchgabe Median | Verzögerung Median (Max) |
> |---|---|---|---|---|
> | E10 | +21,0 ct (17,0–23,0) | 11,0 ct | 123,5 % | 0 Tage (14) |
> | Diesel | +25,0 ct (22,5–28,0) | 10,5 ct | 147,1 % | 9 Tage (14) |
>
> Drei Befunde, eine Warnung: (1) **R2 bestätigt — der Betrag muss
> geschätzt werden.** Angekündigt waren 17,0 ct, durchgereicht wurden im
> Median 21,0 (E10) bzw. 25,0 ct (Diesel); ein Dummy auf die Ankündigung
> würde um 4–8 ct unterkorrigieren. E10 und Diesel brauchen getrennte δ
> (kein globales Delta); die Diesel-Frage 17,0 vs. 14,04
> (DATENWERKZEUGE-Beispiel) betrifft nur die Prozent-Relation, die
> absoluten δ stehen. (2) **Die Verzögerung wird nicht übernommen.** Sie
> ist bimodal und sortenverschieden (E10: Median 0 mit Nebencluster +6;
> Diesel: Median +9 mit Streuung bei 0) — synchron über Stationen, also
> ein Marktmerkmal, keine individuelle Trägheit. Ob dahinter ein zweites
> Ereignis Anfang Juli oder ein Detektions-Artefakt des langen Fensters
> (Detektion über den vollen Export bis September, nicht nur ±14 d)
> steht, klärt der Tagesmedian-Plot — bis dahin trägt sie keine
> Szenario-Mischung (R5.1 wartet). (3) **Die Schätzung steht auf
> Mindestsubstanz:** exakt 24/24 Slots je Station (kein Puffer), `se_ct`
> in rund einem Drittel der Zeilen nicht berechenbar (`nan`:
> Tagesblock-Bootstrap auf lückenhafter Slot-Matrix; δ als Median über
> gematchte Slots unberührt). R2 braucht dafür ein SE-Handling.
> Nebenbefund Simulation: `--simulate` reproduziert die §5.10-Tabellen
> (Szenario C, 01.01.: Bias −15,37 ct, `P_besser = 0,920` bei Wahrheit
> +10,0 ct; Projektions-Lemmata identisch) — Mechanik und Vorzeichen
> dieses Befunds stehen, nur die Beträge kamen aus der Synthetik.

**Abnahme Phase 1/2:** PICP je Quantilstufe über die Kante (nicht nur 95 %),
Brier auf dem Ledger getrennt nach „Settlement schneidet eine Kante“ und
„schneidet keine“, MASE **nur** auf bruchfreien Fenstern, und für den Deckel:
`p_at_cap` gegen den Anteil der Beobachtungen am Deckel (Soll: deckungsgleich,
sonst ist die Schranke falsch gesetzt).

**Was ausdrücklich nicht als Beweis zählt:** eine Messung im Zeitraum
01.10.–15.11.2026 ohne `regime_breaks_in_window`-Kennzeichnung (§5.4.3), und jede
`train_days`-Änderung, die auf Oktober-Daten begründet wird (§5.3.5).

---

## 5.9 Offen, ehrlich benannt

1. **Rechtsfrage (blockiert R3 für den 01.01.):** Darf eine
   Tankstellenpreis-Erhöhung, die nur eine gesetzliche Steueränderung
   durchreicht, um 00:00 Uhr wirksam werden, oder gilt die 12-Uhr-Regel auch
   dann? Solange das ungeklärt ist, führt die Engine die Regime-Kante als
   erlaubte Sprungkante und weist sie als Annahme aus (`regime_jump_assumed`).
   Eine stillschweigend gepoolte Kurve (§5.3.3) ist die schlechteste der drei
   Antworten, weil sie niemand sieht.
2. **Deckel-Ausgestaltung unbekannt (blockiert R4):** feste Zahl, Formel aus
   Referenzkursen, je Sorte, je Region, je Station? Mit welcher Quelle und
   welcher Veröffentlichungs-Verzögerung? Ohne Antwort ist jeder `LEGAL_CAP`
   geraten; die Engine liefert dann `cap_status: unknown` und clippt nicht.
3. **Betrag je Sorte offen:** Die Meldung nennt eine Zahl für „Sprit“. Die
   Energiesteuersätze unterscheiden sich je Sorte deutlich (Benzin 65,45 ct/L,
   Diesel 47,04 ct/L), 2022 wurde je Sorte unterschiedlich gesenkt. R1 führt
   den Betrag deshalb **je Sorte**; eine globale Zahl wäre für mindestens eine
   Sorte falsch.
4. **Durchgabe-Verhalten ist eine Marktfrage, keine Modellfrage:** Wie stark
   weiten Stationen ihre Marge, wenn die Steuer sinkt? 0.1 misst das am
   eigenen Bestand für Mai/Juni 2026. Bis dahin ist jede Zahl — auch die hier
   verwendete — eine Annahme.
5. **Übergewinnsteuer:** Für die Engine ohne direkte Wirkung (sie betrifft
   Gewinne, nicht Endpreise). Indirekt denkbar als Marginendruck in
   Hochpreisphasen; nicht modelliert, nicht geraten, hier nur benannt.
6. **Keine Zahl dieses Befunds stammt aus dem Echtbestand.** Alle Messungen
   laufen auf synthetischen Reihen, die auf die eigenen Messwerte aus
   [archiv/BEFUND-12-UHR-REGEL-2026-09-18.md](BEFUND-12-UHR-REGEL-2026-09-18.md)
   kalibriert sind (Anhang B). Sie belegen **Mechanismen und Vorzeichen**, nicht
   Beträge für den eigenen Stationsbestand. Die Beträge liefert 0.1.

---

## 5.10 Anhang A: Messtabellen

Rolling-Origin, echte `engine.models.fit`/`predict`-Kette, `train_days = 42`,
`min_train_days = 28`, `bootstrap_samples = 500` (entspricht
`engine.probabilities.DECISION_DRAWS`), `bootstrap_ew_half_life_days = 14`,
`decision_hour`-unabhängig (Cutoff jeweils 00:00 lokal), `P_besser` gerechnet
wie `app/pside.py::p_better` mit θ = 1 ct gegen den live beobachteten Anker.
Reproduktion: `python analysis/regime_check.py --simulate`.

### A.1 Szenario A — Bruch −17,0 ct/L am 01.10.2026, sofort und vollständig

| Cutoff | Status quo Bias / Breite / P | Schritt-Dummy Bias / Breite / P | Kurzfenster 14 d Bias / Breite / P |
|---|---|---|---|
| 25.09. | +0,8 / 7,8 / 1,000 | +0,8 / 7,8 / 1,000 | +1,2 / 8,1 / 1,000 |
| 30.09. | −2,2 / 7,8 / 1,000 | −2,2 / 7,8 / 1,000 | −1,3 / 7,4 / 0,946 |
| 01.10. | **+19,1** / 7,9 / 1,000 | +2,1 / 7,9 / 1,000 | +19,2 / 8,0 / 1,000 |
| 02.10. | +17,7 / **23,1** / **0,000** | +0,5 / 7,9 / 0,736 | +18,4 / 18,4 / **0,000** |
| 03.10. | +17,3 / 23,5 / **0,000** | +0,2 / 7,7 / 0,732 | +18,6 / 19,7 / **0,000** |
| 05.10. | +17,9 / 23,6 / **0,136** | +0,8 / 8,4 / 1,000 | +20,3 / 20,8 / **0,000** |
| 08.10. | +13,2 / 24,3 / **0,270** | −3,2 / 8,1 / 1,000 | −2,0 / 23,0 / 0,506 |
| 12.10. | +13,2 / 24,6 / **0,448** | −1,9 / 7,7 / 1,000 | +5,6 / 21,8 / 0,368 |
| 16.10. | +5,1 / **26,4** / 0,570 | −1,5 / 7,7 / 1,000 | −0,8 / 16,1 / 1,000 |
| 22.10. | +3,1 / 25,3 / 0,706 | +1,6 / 7,8 / 1,000 | +3,5 / 5,8 / 1,000 |
| 29.10. | −0,0 / **25,9** / 0,682 | −0,6 / 7,2 / 1,000 | −0,2 / 6,2 / 0,950 |
| 08.11. | +1,4 / 15,7 / 0,842 | −0,8 / 6,7 / 1,000 | +6,4 / 10,7 / **0,044** |

Wahrheit (Fensterminimum − Anker, ct/L): 30.09. −6,3 · 01.10. −31,8 ·
02.10. −3,9 · 03.10. −5,9 · 05.10. −11,5 · 08.10. −8,8 · 12.10. −8,8 ·
16.10. −12,4 · 22.10. −15,0 · 29.10. −6,6 · 08.11. −6,7.
Der hartkodierte Daten-Abzug aus dem Entwurf liefert in Szenario A
**dieselben** Werte wie der Schritt-Dummy (bei sofortiger, vollständiger,
terminrichtiger Durchgabe sind beide äquivalent) — der Unterschied zeigt sich
erst in Szenario B.

### A.2 Szenario B — Bruch −14,5 ct/L am 03.10.2026 (2 Tage spät, 85 % Durchgabe)

| Cutoff | Status quo | hartkodiert −17 ab 01.10. | δ̂ geschätzt (Termin angekündigt) | t̂ und δ̂ geschätzt |
|---|---|---|---|---|
| 01.10. | +4,2 / 6,6 / 0,730 | **−12,8** / 6,6 / 1,000 | −12,8 / 6,6 / 1,000 | −12,8 / 6,6 / 1,000 |
| 02.10. | +0,9 / 7,6 / 1,000 | **−14,5** / 14,9 / 1,000 | −14,5 / 14,9 / 1,000 | −14,5 / 14,9 / 1,000 |
| 03.10. | +16,0 / 7,8 / 1,000 | +1,3 / 18,4 / 0,956 | +1,3 / 18,4 / 0,956 | +1,3 / 18,4 / 0,956 |
| 05.10. | +12,3 / 19,3 / **0,044** | −2,4 / 17,9 / 0,908 | +4,9 / 12,8 / 0,576 (δ̂ −9,4) | **+9,3** / 15,2 / **0,044** (t̂ 30.09., δ̂ −4,4) |
| 08.10. | +14,3 / 19,9 / 0,192 | −0,1 / 18,4 / 0,922 | +1,1 / 16,8 / 0,922 (δ̂ −15,5) | −0,9 / **7,6** / 1,000 (t̂ 03.10., δ̂ −15,5) |
| 12.10. | +8,9 / 21,0 / 0,382 | −5,9 / 17,9 / 0,934 | −5,0 / 16,4 / 0,934 (δ̂ −15,4) | −4,7 / **6,6** / 1,000 (t̂ 03.10.) |
| 16.10. | +6,0 / 20,9 / 0,510 | −1,6 / 18,0 / 0,940 | −0,2 / 15,8 / 0,940 (δ̂ −14,5) | −0,9 / **8,0** / 1,000 (t̂ 03.10.) |
| 22.10. | +7,7 / 21,0 / 0,660 | +4,4 / 16,1 / 0,954 | +4,9 / 14,5 / 0,954 (δ̂ −14,5) | +3,8 / **7,3** / 1,000 (t̂ 04.10.) |
| 29.10. | +4,0 / 21,6 / 0,482 | +1,6 / 15,5 / 0,854 | +2,1 / 14,8 / 0,826 | +1,6 / **15,5** / 0,854 (Rückfall: Bruch aus dem Suchfenster) |
| 08.11. | −1,9 / 17,5 / 0,900 | −4,3 / 8,5 / 0,980 | −3,8 / 7,8 / 0,980 | −4,3 / 8,5 / 0,980 |

*(Bias q50 in ct / Breite q975−q025 in ct / `P_besser`.)*

### A.3 Szenario C — Bruch +17,0 ct/L am 01.01.2027 (Rabatt-Ende)

| Cutoff | Status quo Bias / Breite / P | Schritt-Dummy Bias / Breite / P | t̂ und δ̂ geschätzt Bias / Breite / P | Wahrheit: Fenstermin. − Anker |
|---|---|---|---|---|
| 28.12. | −1,4 / 7,6 / 1,000 | −1,4 / 7,6 / 1,000 | −1,4 / 7,6 / 1,000 (keine Kante) | −15,0 ct |
| 31.12. | +1,3 / 7,6 / 1,000 | +1,3 / 7,6 / 1,000 | +1,3 / 7,6 / 1,000 (Fehlalarm von der δ̂-Schwelle zurückgenommen) | −7,7 ct |
| **01.01.** | **−15,4** / 7,7 / **0,920** | +1,6 / 7,7 / **0,000** | +1,6 / 7,7 / **0,000** (Ankündigung, noch keine Nach-Daten) | **+10,0 ct** |
| 02.01. | −15,9 / 15,5 / 1,000 | +0,2 / 7,8 / 0,728 | +0,2 / 7,8 / 0,728 | −4,0 ct |
| 04.01. | −19,2 / 19,1 / 1,000 | −3,2 / 8,0 / 1,000 | **−5,8 / 20,6** / 1,000 (t̂ 31.12., δ̂ +14,4 — einen Tag daneben) | −6,9 ct |
| 06.01. | −17,8 / 22,4 / 1,000 | −1,8 / 8,1 / 1,000 | −2,9 / **8,1** / 1,000 (t̂ 01.01., δ̂ +15,6) | −14,3 ct |
| 10.01. | −16,0 / 24,1 / 1,000 | −2,8 / 7,3 / 1,000 | −3,4 / **7,4** / 1,000 (t̂ 01.01., δ̂ +15,9) | −9,9 ct |
| 15.01. | −3,6 / 23,4 / 0,956 | −2,7 / 7,7 / 1,000 | −2,8 / **7,5** / 1,000 (t̂ 01.01., δ̂ +16,3) | −6,6 ct |

### A.4 Projektions- und Deckel-Lemmata

| Prüfung | Ergebnis |
|---|---|
| Regime-Anstieg +17 ct um 00:00 innerhalb eines 12-Uhr-Segments, bestehende `noon_law_projection` | Sprung +16,89 ct → **+0,00 ct**; 231/288 Punkte verbogen; +9,83 ct zu hoch vor der Kante, −7,06 ct danach |
| Regime-Senkung −17 ct um 00:00, bestehende Projektion | Sprung −17,11 ct → **−17,11 ct**; 0/288 Punkte betroffen (Senkungen sind jederzeit erlaubt) |
| Regime-Kante als zusätzliche Segmentgrenze | Sprung +16,89 ct → **+16,89 ct**; 0/288 Punkte betroffen |
| `min(·, cap(t))` **nach** der Projektion, Deckel steigt um 00:00 | **illegaler Anstieg +5,0 ct** — 12-Uhr-Regel verletzt |
| `min(·, cap(t))` **vor** der Projektion | legal (max. Anstieg 0,00 ct), Deckelsprung um −2,5 ct verflacht |
| `min(·, c)` auf die Quantile q025…q975 | Ordnung bleibt erhalten (1,70/1,75/1,80/1,90/2,00 → 1,70/1,75/1,78/1,78/1,78) |
| `law_rise_outside_noon` bei deklarierter Steuer-Erhöhung um 00:00 | zählt **1 Verstoß** je Station und Sorte |

### A.5 MASE-Nenner und Ensemble-Gewichte (Szenario A)

Siehe Tabelle in §5.4.3. `mase_scale` 1,98–2,21 ct (September) → 2,71–2,94 ct
(Oktober/November), +27 bis +33 %. Naive-MAE im 14-Tage-Validierungsfenster des
Ensembles 2,42–2,73 ct → **6,30 ct** am 05.10. (2,4×). Die Ensemble-Gewichte
bleiben über den gesamten Zeitraum nahe 50/50 — sie tragen im Bruch keine
Information, sehen aber gültig aus.

## 5.11 Anhang B: Grenzen der Messung

Ehrlichkeit vor Zeigen, wie in
[archiv/BEFUND-12-UHR-REGEL-2026-09-18.md](BEFUND-12-UHR-REGEL-2026-09-18.md)
§5.3.3:

1. **Synthetische Reihen, keine Echtbestands-Messung.** Der Generator ist auf
   die eigenen Live-Messwerte kalibriert (Tagesspanne 17 ct, Tief Median 7 Uhr
   mit 84 % im Block 6–12, Hoch Median 12 Uhr mit 97 % im Block 12–18,
   Mittagssprung Median 0 ct mit 44 % ≥ 2 ct), plus langsames Niveau (±1 ct),
   Wochenend-Anteil (+0,4 ct) und AR(1)-Rauschen auf dem 5-Minuten-Raster. Er
   kennt **keine** Schließzeiten, keine Nachtlücken, keine Hampel-Artefakte,
   keine Collector-Ausfälle und keine Betreiberwechsel — alles Effekte, die im
   Echtbestand die Breite zusätzlich treiben. Die gemessenen **Mechanismen und
   Vorzeichen** sind belastbar, die absoluten ct-Beträge sind es für den
   eigenen Bestand nicht.
2. **Eine Station, eine Sorte, ein Samen je Szenario.** Die Streuung über
   Stationen (die für die Durchgabe-Verteilung in R5.1 gebraucht wird) ist
   nicht gemessen; das liefert Maßnahme 0.1 auf dem Archiv.
3. **Das Modell ist gegen den Generator gut spezifiziert.** Die Tagesform ist
   harmonischen-freundlich gewählt, damit der Bruch isoliert messbar wird. Im
   Echtbestand kommt Fehlspezifikation dazu; sie wirkt auf alle Varianten
   gleich, vergrößert aber die Basisbreite (hier 6,6–8,1 ct) gegenüber dem, was
   das Labor zeigen wird.
4. **Die Dummy-Varianten sind als Niveau-Verschiebung emuliert**, nicht als
   zusätzliche Spalte in `features()`. Beides ist algebraisch äquivalent
   (Schritt-Dummy = Verschiebung der Nach-Kante-Preise plus Rückverschiebung der
   Prognose), aber die Emulation teilt die Kante nicht mit dem Huber-IRLS — die
   gemeinsame Schätzung von γ und Intercept ist leicht stabiler als die hier
   gemessene zweistufige Form. Die gemessenen Unterschiede zwischen den
   Varianten sind deshalb **konservativ**.
5. **`P_besser` ist gegen eine deterministische Wahrheit gerechnet.** Die
   synthetische Zukunft ist bekannt, also ist die wahre Antwort 0 oder 1;
   `wahr_fenster_ct` nennt den Abstand des echten Fensterminimums zum Anker. Im
   Echtbetrieb ist die Wahrheit eine Verteilung — die Bewertung über den Ledger
   (§5.4.4) bleibt der maßgebliche Nachweis.
6. **Die Feiertags-Messung (§5.4.2) nutzt einen konstruierten Feiertagseffekt von
   +6 ct/L.** Gemessen wird die **Differenz** zwischen Pool mit und Pool ohne
   Rabatt bei sonst identischen Daten; die Größe des konstruierten Effekts geht
   in diese Differenz nur über die Kollinearität ein. Für einen kleineren echten
   Feiertagseffekt ist die absolute Verfehlung kleiner, ihr Verhältnis zum
   Effekt (hier −25 %) bleibt in derselben Größenordnung.

---


## 5.12 Gegengutachten: Ergänzung und Beschluss

> **Ergänzung zum Stand 19.09.2026.** Das vorgelegte Gegengutachten wird hier
> in den bestehenden Befund eingearbeitet — nicht als weiteres Dokument. Es
> bestätigt die Leitentscheidung „Regime-Kante statt 17-Cent-Korrektur“, findet
> aber drei fehlende Implementierungsbedingungen. Dieser Abschnitt ist deshalb
> der verbindliche Arbeitsbeschluss für die Batches; R1–R5 und B0–B7 bleiben
> die technische Referenz, soweit sie hier nicht präzisiert werden.

### 5.12.1 Gesamturteil

**Kein fataler Fehler im Befund, aber eine gefährliche Auslassung im
Umsetzungsplan.** Das Gegengutachten ist fachlich besonders wertvoll, weil es
nicht die zentrale Architekturentscheidung umstößt, sondern ihre dynamischen
Folgen bis in den AR-Nachlauf, die Übergangsphase und das Shrinkage verfolgt.

| Aussage des Gegengutachtens | Beschluss | Konsequenz |
|---|---|---|
| „17 Cent abziehen“ verankert politische Erwartung statt Marktwirklichkeit | **übernehmen** | Kein historisches Umschreiben und kein globaler Betrag; Dummy/Rampe mit Prior, geschätzter Kante und Betrag |
| PAVA löscht einen legalen Anstieg um Mitternacht | **übernehmen, blocker** | Regime-Kante ist eine erlaubte Segmentgrenze; bis zur Klärung wird die Annahme im Artefakt markiert |
| Der 1. Januar erzeugt asymmetrischen Vertrauensschaden | **übernehmen, produktkritisch** | Falsches `WARTEN` wird höher gewichtet als verpasstes `JETZT`; in der Übergangsphase lieber `no_advice` |
| MASE kann durch den Bruch künstlich besser werden | **übernehmen** | Kein grünes Gate und kein Tuning auf Fenstern mit Regime-Kante |
| AR(2) darf Altregime-Residuen über die Kante tragen | **übernehmen, bisher fehlend** | Residuen-Zustand wird an der Kante geleert oder für einen definierten Zeitraum gedämpft; der Zustand muss im Artefakt sichtbar sein |
| Harte Treppenstufe kann graduelle Durchgabe verfehlen | **übernehmen, mit Einschränkung** | Rampenmodell als kontrollierte Erweiterung; kein freier Mehrparameter-Fit kurz vor dem Termin |
| `w = 0` bis Tag 5 ist eine künstliche Diskontinuität | **übernehmen** | Präzisionsgewicht wird stetig aus Prior- und Datenvarianz berechnet; Mindestdaten dienen als Sicherheits-Gate, nicht als Sprung im Gewicht |

Der Begriff **„harter Dummy“** ist dabei nicht grundsätzlich falsch: Ein
instantaner gesetzlicher Effekt darf als Treppe modelliert werden. Falsch wäre,
die Treppe als sicher zu behandeln, wenn die Durchgabe empirisch eine Rampe
ist. Die robuste Lösung ist ein Modellvergleich: Treppe als Basismodell,
regularisierte Rampe als Alternative, Freigabe nur bei besserem
Rolling-Origin-Nachweis.

### 5.12.2 Drei technische Nachschärfungen

#### A. AR(2)-Gedächtnis an der Regime-Kante flushen

Der AR(2)-Fit darf nicht ungeprüft Residuen aus zwei Rechts- oder
Preisregimen verbinden. Für jede Prognose wird daher ein `regime_id` je
Zeitpunkt geführt. Schneidet die Zustandsstrecke eine Kante, gelten folgende
Regeln:

1. **Kante erkennen:** `regime_id[t] != regime_id[t-1]` invalidiert mindestens
   die beiden AR-Lags, die auf das alte Regime zeigen.
2. **Sicherer Default:** `phi = (0, 0)` für die ersten beiden Punkte im neuen
   Regime; alternativ darf ein explizit dokumentierter gedämpfter Warmstart
   verwendet werden. Der Strukturfit und der Regime-Dummy bleiben aktiv.
3. **Kein Leck:** Ein Residuum vor der Kante darf nicht als Beobachtung für den
   AR-Zustand nach der Kante dienen. Der Fit kann historische Daten nutzen,
   aber der Online-Zustand muss an der Kante neu beginnen.
4. **Messung:** Artefaktfelder `ar_state_reset`, `ar_warmup_points`,
   `ar_shrink_events` und `regime_id` werden veröffentlicht. Ein Vergleich
   „kein Flush / Flush / gedämpfter Warmstart“ läuft auf dem Juli-Ende und
   synthetischen Szenarien.

Das ist kein pauschales Löschen des AR-Modells. Nach zwei gültigen Punkten darf
es wieder lernen; dadurch bleibt kurzfristige Dynamik erhalten, ohne einen
politischen Sprung als Markt-Autokorrelation fortzuschreiben.

#### B. Treppe gegen Rampe als verschachtelten Modellvergleich fitten

Der Fit bekommt neben dem Schritt-Dummy eine begrenzte Übergangsfunktion. Eine
geeignete erste Form ist

```text
D_step(t) = 1[t >= K]
D_ramp(t) = clip((t - K) / tau, 0, 1),  tau in {12 h, 24 h, 48 h, 72 h}
```

`K` und der Betrag bleiben die geschätzten Größen aus R2; `tau` wird nicht
beliebig optimiert, sondern aus einem kleinen, versionierten Kandidatensatz
gewählt. Der Betrag bleibt je Sorte und wird mit der Ankündigung als Prior
geschrumpft. Die Kandidaten werden auf demselben Rolling-Origin-Split bewertet
mit q50-Bias, Intervallbreite, PICP und richtungsrichtigem `P_besser` — jeweils
getrennt nach sofortiger und verzögerter Durchgabe.

- **Treppe**, wenn eine nachgewiesene Kante innerhalb der Messauflösung liegt.
- **Rampe**, wenn die Durchgabe über mehrere Messintervalle stabil verteilt
  ist und der Backtest die Treppe schlägt.
- **Szenario-Mischung**, wenn am Cutoff noch nicht entschieden werden kann, ob
  Treppe oder Rampe gilt. Nicht die Unsicherheit durch einen Mittelwert
  verstecken: die Draws tragen dann das Szenario-Bit wie in R5.1.

Damit wird die Realität gradueller Durchgabe berücksichtigt, ohne wenige
Übergangstage mit einer frei wachsenden Transition-Funktion zu überfitten.

#### C. Shrinkage stetig und präzisionsbasiert machen

Die bisherige Formulierung „bei weniger als fünf Nach-Tagen `w = 0`“ wird
ersetzt. Für den Betrag gilt:

```text
w = precision_data / (precision_data + precision_prior)
δ = w · δ_hat + (1 - w) · δ_announced
precision = 1 / max(se², se_floor²)
```

`se_data` wird per day-block bootstrap **innerhalb der Vor-/Nach-Seite
getrennt** geschätzt; `se_prior` bleibt die explizit dokumentierte
Durchgabe-Unsicherheit. `se_floor` verhindert, dass ein einzelner dichter
Collector-Lauf sofort Gewicht 1 erhält. Die fünf Tage sind künftig nur noch
zwei Sicherheitsbedingungen: Vorher darf der Datenanteil das Übergangsmodell
nicht allein freigeben, und bei zu wenigen gültigen Nach-Tagen bleibt
`no_advice` oder Szenario-Mischung aktiv. Das Gewicht selbst wächst stetig.

So kann ein sehr präziser Tag-3-Schätzer Evidenz beitragen, ohne dass er die
Produktfreigabe erzwingt; zugleich gibt es keinen künstlichen Sprung von Tag 4
auf Tag 5.

### 5.12.3 Verbindlicher Batch-Ablauf

Die bestehenden B0–B7 werden für die neuen Risiken in sechs abnehmbare
Arbeitsbatches gegliedert. Jeder Batch endet mit einem Artefakt, einem
Gegenlauf ohne Feature und einer dokumentierten Entscheidung. Kein Batch
ändert gleichzeitig Modell, UI und Schwellenregel.

| Batch | Zweck | Inhalt | Gate / Ergebnis |
|---|---|---|---|
| **G-R0** | Sicherheitsfreeze vor der Kante | R3-Segmentgrenze, `regime_transition` → `no_advice`, Gate-/Ledger-Ausschluss, Regime-Marker, Nowcast-Konditionierung | PAVA erhält den +17-ct-Sprung; keine falsche Empfehlung am Kanten-Tag; `TANKAPP_REGIME=0` bitgleich zum Status quo |
| **G-R1** | Beobachten statt raten | Juli-Archiv messen: Kante, Verzögerung, Durchgabe, Sortenstreuung; persistenter Regime-Kalender und Rohdaten-Provenienz | Bericht je Station/Sorte; kein Wert wird aus der Pressemitteilung als Wahrheit übernommen |
| **G-R2** | Dynamik entkoppeln | AR(2)-Flush/Warmstart, Zustands- und Regime-Marker, Tests gegen Residuen-Leck | Kein AR-Lag über die Kante; kurzfristige Qualität nach Warmup nicht schlechter als Status quo |
| **G-R3** | Übergabe modellieren | Treppe/Rampe als verschachtelte Kandidaten, stetiges Präzisions-Shrinkage, getrennte SE, Szenario-Mischung | Juli-Ende bestanden: Bias, Breite und P-Richtung verbessern sich; kein harter Gewichtssprung |
| **G-R4** | Messen ohne Selbsttäuschung | `regime_breaks_in_window`, MASE nur bruchfrei interpretieren, Settlements markieren; M7 und Schwellenregler nicht aus Übergangsdaten speisen | Übergangsdaten bleiben sichtbar, verändern aber weder Schwellen noch Kalibrierungsfreigabe |
| **G-R5** | Freigabe und Betrieb | Rolling-Origin-Abnahme, Kalibrierung erst auf bruchfreien Daten, Labor-Karte „Regime & Rechtslagen“, Monitoring | Freigabe nur bei erfüllten Kriterien; sonst `no_advice`, kein stiller Fallback auf 17 ct |

**Abhängigkeiten:** G-R0 und G-R1 sind die Vorbedingung für alles. G-R2 kann
nach G-R0 separat umgesetzt werden. G-R3 hängt an G-R1 und muss vor B2/B3 auf
Juli-Daten bewiesen sein. G-R4 läuft parallel, blockiert aber jede
Interpretation von MASE/Brier/MASE. G-R5 folgt erst nach den Gegenläufen.
B4 (Navigation) bleibt unabhängig und kann parallel laufen; B5 bekommt die
Regime-Karte erst nach G-R3, damit die UI keine unfertige Modellsemantik
verfestigt.

**Reihenfolge für den 01.10.:** Nur G-R0 ist zwingend produktiv vor der
Kante. G-R1 darf die Messung vorbereiten. G-R2/G-R3 werden nicht mit Gewalt
in elf Tage gedrückt; bis sie auf dem Juli-Ende abgenommen sind, gilt die
Ehrlichkeitsregel `regime_transition`/`no_advice`. **Das ist die zentrale
operative Entscheidung.**

### 5.12.4 Abnahme- und Stop-Regeln

Ein Batch gilt nur dann als abgeschlossen, wenn alle vier Nachweise vorliegen:

1. **Mechanismus-Test:** minimaler synthetischer Fall beweist genau die neue
   Eigenschaft (AR-Flush, Rampe, Shrinkage oder Segmentkante).
2. **Archiv-Test:** derselbe Code läuft über das Rabatt-Ende 01.07.2026,
   ohne Zukunftsleck und mit Vergleich zum Status quo.
3. **Negativtest:** ohne Regime-Deklaration bleibt das Verhalten unverändert;
   bei unklarer Rechts- oder Datenlage wird nicht still korrigiert.
4. **Produkt-Test:** die Ausgabe ist entweder richtungsrichtig oder lautet
   `no_advice`; eine schmale, hochsichere, nachweislich falsche Zahl ist kein
   zulässiges Zwischenresultat.

**Stop-Regeln:**

- Kein `17 ct`-Hardcoding in Trainingsdaten, Features oder Prognosepfaden.
- Kein `w = 0/1`-Sprung allein aufgrund des Kalendertags.
- Kein AR(2)-State über eine deklarierte Regime-Kante.
- Kein MASE-/Brier-/M7-Release-Gate auf einem Fenster ohne
  `regime_breaks_in_window`-Markierung.
- Kein Deckel-Clipping ohne Quelle, Formel und Zeitreihe; bis dahin
  `cap_status: unknown`.

**Beschluss.** Wir übernehmen das Gegengutachten als verbindliche
Nachschärfung des Befunds. Die Architektur bleibt: Rohdaten unverändert,
Regime als Daten, Dummy/Rampe im Fit, Kante in der Projektion, Deckel vor der
Projektion. Neu und ab jetzt verbindlich sind der AR-Flush, der verschachtelte
Treppe/Rampe-Vergleich und das stetige Präzisions-Shrinkage. Vor dem
01.10.2026 wird nur der sichere Teil ausgeliefert; jeder unsichere Teil hat
`no_advice` als Ausfallmodus, nicht eine politisch angenommene Zahl.

## 5.13 Nachtrag 0.56.0: Modularität, Konfigurierbarkeit, Betreiber-Pflichten

> Nachgetragen am 19.09.2026 mit der Auslieferung von B0 (0.56.0), auf drei
> Fragen des Betreibers: *Ist das Konzept modular oder konfigurierbar? Macht
> es Sinn, es jetzt umzusetzen, wo Rabatt und Deckel noch Gespräche sind? Was
> muss ich am Ende tun — oder läuft es von allein?*

### 5.13.1 Ist das Konzept modular?

Ja — und zwar in drei Achsen, die man getrennt prüfen kann. Der Stand je
Schicht ist der von 0.56.0.

| Schicht | Art | Schalter | Stand 0.56.0 | Wirkt, wenn das Gesetz **nicht** kommt? |
|---|---|---|---|---|
| **R1 Kalender** | Daten (kein Code) | `TANKAPP_REGIMES`: leer = Defaults, `0` = aus, JSON-Liste oder `.json`-Datei | **gebaut.** `app/regimes.py` → `Settings.regimes` → `Config.regimes`; Einträge mit `kind`, `fuel`, `announced_local`, `announced_value`, `status`, `source` | Er ist nur eine Liste. Ohne Schicht, die ihn liest, bewegt er keine Zahl. |
| **Marker/Zähler** (Teil von G-R4) | Messen | fällt mit dem Kalender (`TANKAPP_REGIMES=0` → keine Marker) | **gebaut.** `regime_breaks_in_window`, `regime_break_spanned` je Fold und PIT-Paar, `metrics_break_free` | Nur Kennzeichnung: `all` bleibt die Kopfzahl, `break_free` wird zur Teilmenge. Falsch markiert ist billig; unmarkiert ist teuer (§5.7). |
| **G-R0 Sicherheitsfreeze** (`regime_transition` → `no_advice`, Gate-/Ledger-Ausschluss, R3-Segmentgrenze, Nowcast-Konditionierung) | Rechnen, aber nur *Zurückhaltung* | `TANKAPP_REGIME=0` (reserviert, existiert noch nicht) | **nicht gebaut** (H6, H8, H9, H10 in [TODO.md](../planung/TODO.md)) | Darf es nicht: siehe Regel 2 in 5.13.4 — die Degradation zündet nur an Einträgen mit `status` `in_force`/`detected`, nie an `announced`. |
| **R2 Dummy + Kantenschätzer, R3 Segmentgrenze, G-R2 AR-Flush** | Rechnen, verändert Prognosen | `TANKAPP_REGIME=0` | **nicht gebaut** | Stop-Regel „kein w = 0/1-Sprung allein aus dem Kalendertag“: Der Kalender liefert den *Prior* für den Kantenzeitpunkt, den Schritt muss der Schätzer in den **Daten** finden. Ohne Schritt in den Daten bleibt δ̂ ≈ 0 und die Schicht ist wirkungslos. |
| **R4 Deckel `cap(t)`** | Rechnen, zensiert | `TANKAPP_REGIME_CAP=0` | **nicht gebaut**, kein Kalender-Eintrag (A15) | Ohne Quelle, Formel und Zeitreihe gilt `cap_status: unknown` und es wird nicht geclippt. |
| **R5/B5 Anzeige** (Labor-Karte, Heatmap-Marke, Nutzertext `regime_transition`) | Anzeigen | — | **nicht gebaut** | Zeigt nur, was die Schichten darunter ausweisen. |

Drei Eigenschaften machen das modular statt nur „mit Schaltern versehen“:

1. **Daten vor Code.** Was das Gesetz *ist* (Termin, Art, Sorte, Betrag,
   Quelle, Status), steht im Kalender; was die Engine daraus *macht*, steht in
   Schichten mit eigenem Schalter und eigener Gegenprobe („bitgleich ohne
   Deklaration“). Ein neuer Termin ist ein Eintrag, keine Codeänderung. Genau
   das Muster von `price_law_local`/`TANKAPP_LAW_FLOOR` (B30).
2. **Jede Schicht ist einzeln abnehmbar und einzeln abschaltbar** (5.12.4:
   Mechanismus-, Archiv-, Negativ-, Produkt-Test je Batch). Die Marker aus B0
   sind der erste Beweis dafür: Kalender gesetzt, Prognose bitgleich
   (`tests/test_b0_invariance.py`).
3. **Der Rohbestand bleibt unverändert.** Nichts wird um 17 ct verschoben;
   der Bruch bleibt in den Daten sichtbar und wird in Fit, Projektion und
   Bericht *behandelt*, nicht *wegretuschiert*.

**Was nicht modular ist und es auch nicht sein soll:** Der Status eines
Eintrags (`announced` → `in_force`) ist eine Tatsachenbehauptung über die
Welt. Die kann keine Schicht selbst herstellen — erst R2 (`detected`) misst,
ob am Termin tatsächlich ein Schritt in den Preisen liegt. Bis dahin ist der
Status Handarbeit (5.13.3).

### 5.13.2 Jetzt bauen, obwohl es noch Gespräche sind?

Die ehrliche Antwort ist dreigeteilt, entlang der Frage, **was eine Schicht
braucht, um richtig zu sein.**

- **B0 (ausgeliefert) — ja, unabhängig vom Gesetz.** PIT-Paare, AR-Zähler,
  Gewichtsstreuung und PAVA-Pools sind Messgrundlagen für die Kalibrierung
  (B2) und hätten auch ohne Tankrabatt gefehlt. Der Kalender kostet nichts,
  solange keine Schicht rechnet, und die Marker sind billig, wenn sie falsch
  sind (5.13.1). Das Archiv liefert außerdem eine **echte** Kante, die schon
  passiert ist: Mai–Juli 2026. Alles, was für den Oktober gebaut wird, lässt
  sich daran ohne Spekulation prüfen (5.12.4, Archiv-Test).
- **G-R0 (Zurückhaltung: `no_advice` im Übergangsfenster, Gates und Ledger
  nicht aus Bruchdaten speisen) — ja, vor dem 01.10., aber scharf gestellt
  nur durch den Status.** Diese Schicht kann nichts Falsches *behaupten*,
  sie kann nur *schweigen*. Ihr einziges Risiko ist ein unnötiges Schweigen,
  wenn das Gesetz nicht kommt — und das ist ausgeschlossen, solange sie nur
  an `in_force`/`detected` zündet (Regel 2). Kommt das Gesetz, ist der
  Umstieg ein Statuswechsel, keine Entwicklung in elf Tagen.
- **R2/R3/G-R2/G-R3 (Dummy, Kantenschätzer, AR-Flush, Rampe) — erst nach
  der Juli-Messung (G-R1), nicht nach dem Kalender.** Diese Schichten
  verändern Prognosen. Ihre Parameter (Verzögerung, Durchgabe, Sortenspanne)
  kommen aus dem eigenen Archiv, nicht aus der Pressemitteilung (§5.9.3/4).
  Ob der Oktober-Rabatt kommt, ändert daran nichts — der Juli ist da, und
  die Schicht ist auch für die *nächste* Maßnahme gebaut. Was den Bau bis zur
  Gesetzesverkündung aufschieben würde, ist nur der **Termin**, und der ist
  ein Eintrag im Kalender.
- **R4 Deckel — nein, nicht vor dem Gesetzestext.** Ohne Referenz, Formel
  und Rhythmus wäre jede Schranke geraten; ein geratener Clip verfälscht die
  Prognose in eine Richtung, die niemand sieht (§5.3.4). Bis dahin
  `cap_status: unknown`, kein Kalender-Eintrag (A15).

Kurz: **Gebaut wird, was aus dem eigenen Archiv beweisbar und per Daten
scharfstellbar ist; gewartet wird, wo der Inhalt des Gesetzes selbst der
Parameter ist.** Politische Unsicherheit landet im Kalender (`status`), nicht
im Code.

### 5.13.3 Was der Betreiber tun muss — und was von allein passiert

Die Kurzfassung für den Betrieb, Kommandos in
[BETRIEB.md](../betrieb/BETRIEB.md#regime-kalender-b0-seit-0560):

**Von allein (0.56.0):** Der Kalender kommt als Default mit der App
(01.05./01.07.2026 `in_force` aus dem Archiv; 01.10.2026 und 01.01.2027
`announced`). Der tägliche Lauf zählt und markiert ab dem Lauf, dessen
Fenster den Termin enthält (Kante 01.10. 00:00 → ab dem Lauf vom 02.10.2026
steht `regime_breaks_in_window.count = 1`). Prognose, Band, Empfehlung und
Nutzertexte ändern sich dadurch **nicht** — auch nicht am 01.10.

**Jetzt nichts zu tun**, außer wie gewohnt ausliefern (`nas-up`). Optional,
aber vor B2/B3 empfohlen: die Referenzmessung am PC
([ENGINE.md](../referenz/ENGINE.md#messgrundlagen-b0-seit-0560)), damit es einen
Vorher-Wert gibt, gegen den sich jede spätere Schicht messen lässt.

**Bei Nachrichten — drei Fälle, immer dieselbe Handbewegung** (Kalender
ändern, `nas-up`; entweder per `TANKAPP_REGIMES` in der NAS-Umgebung oder als
`regimes.json` unter `runtime/`, dann braucht es kein Release):

| Es passiert … | In 0.56.0 zu tun | Sobald G-R0/R2 ausgeliefert sind |
|---|---|---|
| Rabatt kommt **wie angekündigt** (Gesetzblatt) | nichts — der Marker steht schon; das nächste Release setzt den Default auf `in_force` | Status auf `in_force` setzen (Eintrag oder Release) — erst das stellt Zurückhaltung und Kantenschätzer scharf |
| Rabatt kommt **anders** (Termin, Betrag, nur einzelne Sorten) | Eintrag anpassen (`announced_local`, `announced_value`, je Sorte ein Eintrag) — nur die Markierung verschiebt sich | dito; der Kantenschätzer prüft den Termin ohnehin in den Daten (±Tage), der Betrag ist Prior |
| Rabatt kommt **nicht** | `status: unknown` setzen oder den Eintrag streichen; falls vergessen: kostet nur eine unnötige `break_free`-Teilmenge, keine falsche Zahl | Eintrag streichen; solange `announced` steht, zündet ohnehin nichts (Regel 2) |
| Deckel wird **konkret** | nichts eintragen, bis Referenz und Formel bekannt sind (A15) | `kind: price_cap`-Eintrag **und** R4 — das ist ein Release, kein Kalender-Eintrag allein |

**Nicht automatisiert, und zwar absichtlich:** ob ein Gesetz kommt. Die App
liest keine Nachrichten; sie misst Preise. Was sie *nach* dem Termin selbst
kann — feststellen, dass da ein Schritt war (`detected`) — ist R2 und kommt
nach der Juli-Messung.

### 5.13.4 Verbindlich ab jetzt

Zusätzlich zu den Stop-Regeln aus 5.12.4:

1. **Der Kalender allein bewegt keine Zahl.** Jede Schicht, die Prognosen
   verändert, braucht einen in den Daten gefundenen Schritt (R2) oder einen
   ausdrücklich gesetzten Status; ein `announced`-Eintrag ist Prior und
   Marker, nie Fakt. (Präzisierung von „kein w = 0/1-Sprung aus dem
   Kalendertag“.)
2. **`announced` zündet keine Degradation.** `regime_transition` →
   `no_advice`, Gate-Suspendierung und Ledger-Ausschluss (G-R0/G-R4) lesen
   nur `in_force`/`detected`. Sonst würde eine Meldung, die nie Gesetz wird,
   die App zwei Wochen zum Schweigen bringen.
3. **Sorte:** Ein Eintrag ohne Sorte (`fuel: null`) markiert die *Zeit* für
   alle Sorten — für B0 richtig, weil der Termin alle trifft. Sein
   `announced_value` ist die Pressezahl, keine Sortenwahrheit (§5.9.3); R2
   schätzt den Betrag **je Sorte** und darf eine globale Zahl höchstens als
   schwachen Prior lesen. Sobald Sätze je Sorte bekannt sind, gehört je Sorte
   ein Eintrag in den Kalender.
4. **Zwei Variablen, zwei Dinge:** `TANKAPP_REGIMES` (Daten: der Kalender)
   und `TANKAPP_REGIME` (Rechnen: die Schichten ab G-R0, reserviert). Die
   Gegenmessung „Kalender an, Schichten aus“ muss jederzeit möglich bleiben.
5. **Kein kaputter Kalender läuft still weiter:** ungültige Einträge brechen
   `Settings.from_env` mit Grund ab (gebaut in 0.56.0). Der Preis dafür ist
   ein sichtbarer Fehlstart statt eines unmarkierten Übergangsfensters —
   bewusst so gewählt.

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

**Teil 5 (Regime-Wechsel) — zusätzlich gelesene Primärquellen:**
`engine/models.py` (`_segment_bounds`, `noon_law_projection`, `fit`/`predict`,
Day-Block-Bootstrap), `engine/config.py` (`train_days`, `holiday_pool_days`,
`price_law_local`, `bootstrap_samples`), `engine/holidays.py`,
`engine/selection.py` (`cusum_break`, EW-Median), `engine/probabilities.py`
(`DECISION_DRAWS`, Nowcast), `app/law.py` (`law_rise_outside_noon`),
`app/decide.py`, `app/pside.py` (`THETA_CT`), `app/thresholds.py`,
`app/alarms.py`, `app/feedback.py` (M7-Gate, 30-Tage-Fenster),
`app/model_jobs.py`, `analysis/noon_rule_check.py` (Gerüst-Vorlage),
`docs/referenz/API.md` (`archive_since`). Nachgerechnet: PAVA-Poolung eines
Regime-Anstiegs (+16,89 → +0,00 ct, 231/288 Punkte), derselbe Sprung als
Segmentgrenze (0/288), Deckel-Clip vor und nach der Projektion (+5,00 ct gegen
+0,00 ct), Quantilsordnung unter `min(·, c)`, Feiertags-Pool-Referenzen
(4 von 11 Stützstellen im Rabattfenster), MASE-Nenner über den Bruch
(+27–38 %), Zähler `law_rise_outside_noon` am 01.01. Werkzeug und
Reproduktionsweg: `analysis/regime_check.py` (Messpfad + `--simulate`),
abgesichert durch `tests/test_regime_check.py` (13 Tests, darunter
Zukunftsleck-Schutz, Schwellen gegen Fehlalarme und beide
Projektions-Lemmata). Umgebung: `.venv` mit numpy 2.4.6, pandas 3.0.6,
holidays, pytest; `pytest -q` 1144 bestanden, `ruff check`/`format --check`
auf den CI-Zielen grün, `npm --prefix web test` 1229 bestanden, `build` grün.
Die beiden Playwright-Suiten liefen nicht (kein Chromium im Sandkasten);
`web/` ist von Teil 5 nicht berührt. **Grenzen:** Wie in Teil 2 gilt, dass
gegen den Code-Zweig geprüft wurde, nicht gegen den Live-Betrieb. In Teil 5
kommt hinzu, dass alle Zahlen aus synthetischen, auf Live-Messwerte
kalibrierten Reihen stammen — sie belegen Mechanismen, Vorzeichen und
Größenordnungen, keine Beträge für den Echtbestand (§5.11).
