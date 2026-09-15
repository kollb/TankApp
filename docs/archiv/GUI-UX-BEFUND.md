# GUI-UX-Befund — warum sich die Oberfläche trotz grüner Listen noch nicht gut anfühlt

> **Erledigt (0.40.0, 15.09.2026):** Alle Befunde U1–U8 sind umgesetzt und
> abgenommen — U2/U7 (P0), U1/U3/U6 (P1), U4/U5/U8 (P2). Die Nachweise stehen
> im [CHANGELOG](../../CHANGELOG.md) (0.40.0) und in der Erledigt-Tabelle von
> [TODO.md](../../TODO.md); die Ratchets leben in `web/src/`
> (`a11y.test.ts`, `AppNav.test.tsx`, `routing.test.ts`,
> `format-convention.test.ts`). Bewusst offen geblieben ist nur der
> zweispaltige Desktop-Inhalt (§13) — er steht als C12 in
> [TODO.md](../../TODO.md). Dieser Befund bleibt als Protokoll lesbar und
> wird nicht mehr gepflegt.

> Stand: 15.09.2026 · App-Version **0.38.0** · Arbeitsdokument (Vermessung,
> keine Abnahme). Gemessene Basis: `web/src/` (27 237 Zeilen TS/TSX), der
> `web/dist`-Build und ein laufender Demo-Stack
> (`ops/quality/demo_server.py`, Port 1357). Maßstab ist
> [UI-NEUENTWURF.md](../UI-NEUENTWURF.md); der Konzept-Abgleich steht in
> [LUECKEN.md](../LUECKEN.md), die Aufgabenliste in [TODO.md](../../TODO.md).

## Inhaltsverzeichnis

- [1. Ausgangslage: zwei Listen, eine Lücke](#1-ausgangslage-zwei-listen-eine-lücke)
- [2. Befunde](#2-befunde)
  - [U1 — Typografie ist pixel-fixiert und zu klein](#u1--typografie-ist-pixel-fixiert-und-zu-klein)
  - [U2 — „Heute im Blick“ bricht auf dem Handy](#u2--heute-im-blick-bricht-auf-dem-handy)
  - [U3 — Navigation: ein Pillen-Streifen statt der entworfenen Raster](#u3--navigation-ein-pillen-streifen-statt-der-entworfenen-raster)
  - [U4 — Kein Routing, keine geteilte Antwort](#u4--kein-routing-keine-geteilte-antwort)
  - [U5 — Die Erklär-Treppe führt aus dem Bereich heraus](#u5--die-erklär-treppe-führt-aus-dem-bereich-heraus)
  - [U6 — Designsystem vorhanden, aber nicht benutzt](#u6--designsystem-vorhanden-aber-nicht-benutzt)
  - [U7 — Lighthouse-Gate prüft den Zustand nicht, den es behauptet](#u7--lighthouse-gate-prüft-den-zustand-nicht-den-es-behauptet)
  - [U8 — Struktur: Props-Drilling ist der Grund, warum UX-Fixes teuer sind](#u8--struktur-props-drilling-ist-der-grund-warum-ux-fixes-teuer-sind)
- [3. Priorisierte Arbeitsliste](#3-priorisierte-arbeitsliste)
- [4. Was schon richtig ist](#4-was-schon-richtig-ist)

## 1. Ausgangslage: zwei Listen, eine Lücke

[TODO.md](../../TODO.md) meldet nach PR #123 in **C. GUI / UX: „Keine offenen
Punkte"**. Das ist nicht falsch, aber eng: Die Ledger dort gleichen **Konzept ↔
Code** und **Audit-Befunde ↔ Fix** ab (Punkte wie C3, C5, C7, C8, E2–E7). Keiner
dieser Punkte misst, ob die Oberfläche *leicht zu lesen und zu bedienen* ist.

Der Maßstab dafür liegt an anderer Stelle: [UI-NEUENTWURF.md](../UI-NEUENTWURF.md)
beschreibt die anvisierte GUI **nach** dem Neuentwurf (§13 Geräte-Raster, §14
Barrierefreiheit, §15 UX-KPIs, §16 Migrationspfad) — und dort ist die Umsetzung
lückenhaft. Diese acht Befunde sind der Grund für das diffuse Unbehagen: Sie
fallen keinem Test auf, weil kein Test sie prüft.

Alle Zeilenangaben beziehen sich auf den Stand 0.38.0 (`0c3ed64`).

## 2. Befunde

### U1 — Typografie ist pixel-fixiert und zu klein

[UI-NEUENTWURF.md §14](../UI-NEUENTWURF.md#14-barrierefreiheit) verlangt explizit:
„System-Schriftgröße wird respektiert (keine px-Fixierung der Fließtexte)“.
Gemessen in `web/src` (ohne Tests):

| Klasse | Vorkommen |
|---|---|
| `text-[11px]` | 199 |
| `text-[10px]` | 83 |
| `text-[9px]` | 8 |
| `text-[8px]` | 2 |
| `text-xs` (= 12 px) | 138 |
| `text-sm` (= 14 px) | 60 |

Rund **430 Stellen** setzen Fließtext auf 8–11 px und umgehen damit die
Browser-Einstellung. „Anstrengend“ ist hier also nicht Geschmack, sondern
Lesegröße. Betroffen sind ausgerechnet die handlungsleitenden Zahlen, nicht nur
Labels: `web/src/views/Jetzt.tsx:932` (Tagesstreifen-Werte, `text-[8px]`),
`views/Ich.tsx:616` (`text-[8px]`), `views/Woche.tsx:136,363`,
`components/HeatmapGrid.tsx:189,206`.

**DoD:** Fließtext und Zahlen ≥ 12 px (rem statt px), 8/9 px nur noch für
Dekoration mit Ersatztext; Ratchet in `web/src/a11y.test.ts` oder
`microcopy.test.ts`, das `text-[8px]`/`text-[9px]` verbietet.

### U2 — „Heute im Blick“ bricht auf dem Handy

`views/Jetzt.tsx:159` baut den Tagesstreifen mit 19 Zellen in ein starres
Raster ohne Scroll-Container:

```
grid grid-cols-[repeat(19,minmax(0,1fr))] gap-1
```

Bei 390 px Viewport und `px-4` bleiben für 19 Zellen + 18 × 4 px Abstand ≈
**15,7 px je Zelle** — darin stehen `font-mono text-[8px]`-Zahlen. Das ist
Primärhandlung an der Säule, und sie ist auf dem Mobilgerät faktisch unlesbar.
Zum Vergleich: `components/HeatmapGrid.tsx:140` löst dasselbe Problem richtig
(`overflow-x-auto`).

**DoD:** Streifen auf Mobil auf zwei Zeilen
([§13](../UI-NEUENTWURF.md#13-mobil-desktop-pwa): „Querformat/Zweizeilig statt
neuer Seite") **oder** `overflow-x-auto` mit Mindestzellbreite;
Playwright-Test bei 390 px, der Zellenbreite ≥ 26 px und sichtbaren Werttext
verlangt.

### U3 — Navigation: ein Pillen-Streifen statt der entworfenen Raster

[§13](../UI-NEUENTWURF.md#13-mobil-desktop-pwa) verspricht zwei unterschiedliche
Geräte-Raster: mobil Bottom-Navigation mit 6 Punkten, desktop Seitenleiste
links, Ebene 1 als rechtes Seitenpanel, Inhalt zweispaltig. Implementiert ist
**ein** Streifen oben (`Dashboard.tsx:1647` ff., `flex flex-wrap`), für alle
Viewports.

Belege aus dem Code:

- `pushState`/`popstate`, Bottom-Nav, Sidebar: **keine Treffer** in `web/src`
  (nur ein `replaceState` für die Share-URL, `Dashboard.tsx:764`).
- Responsive Klassen sind dünn gesät: `Dashboard.tsx` hat **3** `sm:`/`lg:`-
  Klassen bei 2 172 Zeilen; `views/Woche.tsx` **2** bei 519, `views/Labor.tsx`
  **5** bei 1 643. Desktop bekommt also nie das zwei-spaltige „Kern +
  Einordnung"-Layout, Labor nie die ruhige Lese-Spalte.
- Die Navigation hat **7** Punkte, darunter „Glossar“ als Haupttab. Der Entwurf
  zählt 6 Aufgabenbereiche; das Glossar gehört ins Labor (§6.2). Ein
  Nachschlagewerk neben „Jetzt“ zu stellen verwässert die Aufgaben-Navigation —
  und auf 390 px umbrechend produziert die Leiste genau das Gefühl von „viel
  Zeug, kein Eingang".
- Header-Zeile 1 enthält Stadt-/Kraftstoff-/Stations-Umschalter,
  Profil-Select + Stift, Alarm-Punkt, Teilen, Aktualisieren. Vor dem
  Inhaltstext stehen so **zwei** dichte Steuerzeilen — der „eine Blickfang“ aus
  §2.1 ist nicht die Empfehlung, sondern die App-Bedienung.

**DoD:** mobil Bottom-Nav (6 Punkte, 44 px), desktop Sidebar + zweispaltiger
Inhalt; „Glossar“ aus der Hauptnavigation in den Labor-Kopf; Kopf auf eine
Zeile mit den vier wirklich globalen Steuerungen.

### U4 — Kein Routing, keine geteilte Antwort

[§13](../UI-NEUENTWURF.md#13-mobil-desktop-pwa): „Jede Ansicht ist eine URL
(`/jetzt`, `/station/{id}`, `/woche?fenster=…`, `/labor#sicherheit`)".
Existiert nicht. Gelesen werden in `web/src/data.ts::readShareParams`
(Zeile 1796) nur `city`, `fuel`, `station_id`, `liters`, `weeks`, `basis` —
**kein** `tab`/Bereich, **kein** Anker.

Folgen, die man täglich spürt: kein Zurück-Knopf des Browsers (der Tabs
vergisst), Lesezeichen landen immer auf „Jetzt“, und der „Teilen“-Knopf
verspricht mehr, als er liefert — der Link teilt Filter, aber nicht die
Antwort. Nebenbefund: genau deshalb misst Lighthouse den Labor-Bereich nicht
(siehe [U7](#u7--lighthouse-gate-prüft-den-zustand-nicht-den-es-behauptet)).

**DoD:** `tab`/`section` in der Query (oder Pfad-Routing), Zustand wird beim
Start gelesen, Browser-Back funktioniert, ein Test pro Bereich: Link öffnen →
richtiger Bereich.

### U5 — Die Erklär-Treppe führt aus dem Bereich heraus

Die Erklär-Treppe (Antwort → Begründung → Beweis,
[§7](../UI-NEUENTWURF.md#7-die-erklär-treppe-antwort--begründung--beweis)) ist
angebaut, aber der zweite Schritt springt weg: „Warum?“ in `views/Jetzt.tsx:469`
und die System-Zeilen (`views/System.tsx:258,396,625`) rufen
`openLabor(section, …)` auf — Sprung in einen anderen Bereich mit
`labReturn`-Buchhaltung (`Dashboard.tsx:1176,2058`). Genau das will §7 mit
„kein Verirren“ vermeiden; der „Zurück zu: …“-Pfad ist der Patch für ein
Problem, das der Sprung selbst erzeugt. Ein Level-1-Sheet
(`components/Level1Sheet.tsx`) wäre der Weg für Ebene 1 am Ort; Labor nur für
Ebene 2 (den Beweis).

**DoD:** Ebene 1 im Sheet am Wirkungsort, Labor-Sprung erst ab Ebene 2;
`labReturn` kann entfallen.

### U6 — Designsystem vorhanden, aber nicht benutzt

`components/ui.tsx` erklärt die Karten-Grundklasse `panel` zu *der einen*
Stelle für Rand, Radius und Hintergrund (`ui.tsx:20`). Genutzt wird sie in den
Views 37-mal — daneben stehen im selben Code **110 × `rounded-lg`, 91 ×
`rounded-xl`, 12 × `rounded-md`, nur 6 × `rounded-2xl`** (die Klasse von
`panel`). Ergebnis: Kartenradien, Ränder und Flächen sind von Panel zu Panel
verschieden, die Oberfläche wirkt „zusammengeklaubt“, ohne dass ein einzelnes
Element falsch wäre — der typische Fall für „weiß nicht wieso“.

**DoD:** alle Flächen über `panel`/eine Radius-Rampe (z. B. 12 px Karten, 8 px
Chips), Lint-Regel oder Test, der `rounded-` außerhalb von `components/ui.tsx`
auf eine erlaubte Menge beschränkt.

### U7 — Lighthouse-Gate prüft den Zustand nicht, den es behauptet

[QUALITAET.md](../QUALITAET.md) (Zeile 31) und `web/lighthouserc.json` sagen:
gemessen werden „Zwei GUI-Zustände: Alltag und Statistik“. Die zweite URL ist
aber `…&tab=statistik` — einen Bereich `statistik` gibt es seit dem Neuentwurf
nicht mehr (`grep -rn "statistik" web/src` ohne Tests: **kein Treffer**). Beide
Läufe messen also denselben Startbildschirm „Jetzt“, und der Labor-Bereich
(1 643 Zeilen, 15 Chart-Aufrufe, Heatmap) wird **nie** gemessen.

Dazu drei Verschärfungen:

- `categories:performance`, `total-byte-weight`, LCP und CLS stehen alle auf
  `warn` — das Gate kann nicht rot werden, und das M4-Ziel > 0,90 ist nie
  angefasst ([QUALITAET.md → Offen](../QUALITAET.md#offen)).
- Der Demo-Stack liefert `decision_ready: False`, `calibrated: False`
  (`ops/quality/demo_data.py:315`) und keine Belege. Gemessen wird damit der
  **Einrichtungszustand** von „Jetzt“ (S0, `views/Jetzt.tsx:282`), nicht der
  gefüllte Entscheidungs-Bildschirm — „Lighthouse misst das gefüllte GUI“
  (Begründung im Kopftext von QUALITAET.md) gilt für diesen Zustand nicht.
- Im Build steckt ein einzelner JS-Chunk mit 540 kB (160 kB gzip); Vite meldet
  die Größe selbst als Warnung.

**DoD:** zweite URL auf den Labor-Bereich (setzt
[U4](#u4--kein-routing-keine-geteilte-antwort) voraus) und eine dritte auf den
Einrichtungszustand, damit beide Fälle belegt sind; Budgets von `warn` auf
`error` für `total-byte-weight`/CLS; Code-Splitting pro Bereich (`import()` je
`views/*`); die Messwerte in [QUALITAET.md](../QUALITAET.md) eintragen.

### U8 — Struktur: Props-Drilling ist der Grund, warum UX-Fixes teuer sind

[§1](../UI-NEUENTWURF.md#1-diagnose-was-an-der-heutigen-gui-anstrengt) stellte
fest: „Riesen-Views, Props-Drilling — jede UX-Änderung ist ein Eingriff am
offenen Herzen". Der Schnitt hat `Dashboard.tsx` von ~4 700 auf 2 172 Zeilen
gebracht; die Views sind aber an dieselbe Stelle gewachsen und kriegen den
Zustand weiter per Prop: **41 Props nach `LaborView`, 32 nach `SystemView`**
(`Dashboard.tsx` 2013 ff., 2087 ff.), Zustand in 75 `useState`-Aufrufen im
Dashboard.

Solange das so bleibt, ist jede der Änderungen U1–U6 ein Eingriff durch
siebeneinhalb Prop-Listen — deshalb werden Kleinigkeiten aufgeschoben und die
Oberfläche altert in großen Sprüngen statt in Korrekturen.

**DoD:** bereichsspezifischen Zustand in die Views (Context pro Bereich,
`OverviewContext` für die geteilten Daten), Dashboard unter ~600 Zeilen;
`LaborView`/`SystemView` unter 15 Props.

## 3. Priorisierte Arbeitsliste

| # | Prio | Aufgabe | Warum zuerst |
|---|---|---|---|
| U2 | **P0** | Tagesstreifen mobil lesbar machen (zwei Zeilen oder Scroll) | Primärhandlung an der Säule ist auf dem Handy unbrauchbar |
| U7 | **P0** | Lighthouse-Zustände reparieren, Budgets scharf, Chunks splitten | ohne ehrliches Gate fehlt jeder Beweis für „besser“ |
| U1 | **P1** | 8/9/10-px-Schrift auflösen, rem statt px | 430 Stellen, wirkt überall gleichzeitig |
| U6 | **P1** | Karten auf `panel` + Radius-Rampe ziehen | großer Eindruck, kleiner Eingriff |
| U3 | **P1** | Bottom-Nav mobil / Sidebar desktop, Glossar aus der Hauptnavigation | Navigationsqualität ist das „weiß nicht wieso“ |
| U4 | **P2** | Bereichs-Routing + ehrliche Share-URL | Voraussetzung für U7, für Zurück und Lesezeichen |
| U5 | **P2** | Erklär-Treppe: Ebene 1 als Sheet am Ort | entfernt den Sprung, der `labReturn` braucht |
| U8 | **P2** | Props-Drilling auflösen (D1 zu Ende führen) | macht U1–U6 billiger |

Die Liste ist bewusst noch nicht in [TODO.md](../../TODO.md) als Tabellenzeilen
unter C — das gehört mit der ersten Umsetzung zusammen rein, sonst steht dort
ein Befund ohne Owner. Nach der Abnahme von U1/U2/U6: Eintrag in TODO.md under
„C. GUI / UX“, Ratchet-Tests in `web/src/`, und dieser Befund wandert mit
Erledigt-Vermerk nach [archiv/](README.md).

## 4. Was schon richtig ist

Damit das Bild nicht zerrt: Farbwelt für Labor (Violett), Erreichbarkeit
(44-px-Ziele, Kontrast-Anhebung für `slate-500/600` in
`web/src/styles.css:8`, `prefers-reduced-motion` in `styles.css:155`),
Zustände (Skeleton, `DataAge`, `CellError`, `LoadError`), Microcopy-Ratchet und
die Regel „Farbe trägt nie allein eine Bedeutung“ sind real und geprüft. Das
Problem ist nicht Geschmacksache oder Sorglosigkeit, es ist **eine nicht
umgesetzte Hälfte des Entwurfs** (Geräte-Raster, Typografie, Routing) **bei
gleichzeitiger Selbstprüfung an der falschen Stelle** (U7).
