# Oberfläche und Interaktion

> Stand: 28.09.2026 · App-Version 0.73.0
> Beschreibt die implementierte Navigation einschließlich Labor-Unterbereichen.
> Neu in 0.60.0: Outbox-Karte in „System“ → Diagnose und Header-Banner für
> wartende Einträge (I1, [Release 0.60.0](../releases/CHANGELOG.md#0600--2026-09-20)).
> Neu in 0.70.2: der Tank-Guide — eine Frage, eine Antwort, drei Fallback-Stufen
> ([Release 0.70.2](../releases/CHANGELOG.md#0702--2026-09-27)).
> Neu in 0.71.0: GUI v2 — das Material-You-Schema aus `sample/good gui` wird
> die Gestaltung; beide Themen tragen dieselben Rollen
> ([Release 0.71.0](../releases/CHANGELOG.md#0710--2026-09-27)).
> Neu in 0.73.0: **Dunkel ist die Voreinstellung** („System“ folgt dem Gerät,
> Rückfall Dunkel) und das Konzept ist unter `/?konzept=1` die echte Ansicht —
> Desktop zuerst, mit den drei Fallback-Stufen
> ([Release 0.73.0](../releases/CHANGELOG.md#0730--2026-09-28)).

## Inhaltsverzeichnis

- [Navigation](#navigation)
- [Bereiche](#bereiche)
- [Tank-Guide: eine Frage, eine Antwort](#tank-guide-eine-frage-eine-antwort)
- [Labor-Unterbereiche](#labor-unterbereiche)
- [Antwort, Begründung und Beweis](#antwort-begründung-und-beweis)
- [Urteilstöne und Elevation](#urteilstöne-und-elevation)
- [Zustände und Datenwahrheit](#zustände-und-datenwahrheit)
- [Mobil, Desktop und Barrierefreiheit](#mobil-desktop-und-barrierefreiheit)
- [Änderungen abnehmen](#änderungen-abnehmen)

## Navigation

Seit 0.70.1 öffnet der Kontext-Chip im Kopf Stadt und Kraftstoff in einem
Bottom Sheet. Tagesstreifen-Details öffnen ebenfalls als Sheet; native
Dialoge begrenzen den Tastaturfokus und schließen mit Escape, danach
kehrt der Fokus zum Auslöser zurück. Der Gültigkeits-Chip zählt die
letzten 30 Minuten herunter; ab dem Ablaufzeitpunkt wird die Empfehlung
auch ohne neue Serverantwort durch die neutrale Ablaufkarte ersetzt.

Die RP2-Leseausgabe (`web/rp2`) teilt Theme, Formatter und Sheet mit der
Vollversion, bleibt aber ausdrücklich beim lesenden `pi-v1`-Vertrag.
Navigation: Jetzt · Stationen · Mehr. Python bleibt Server und Notausgabe,
wenn kein React-Build installiert ist; [Deployment](../betrieb/RP2.md#template-updates).

Die Alltagsnavigation folgt **3+1**:

```text
Jetzt
Woche
Stationen
Mehr / Studio
├── Labor
├── Ich
├── System
└── Glossar
```

Mobil öffnet „Mehr“ ein nicht-modales Auswahlblatt; Escape schließt es und der
Fokus springt beim Öffnen auf die aktive Zeile. Der aktive Studio-Bereich ist
am Mehr-Eintrag markiert. Auf dem Desktop stehen diese Einträge in einer
Studio-Gruppe der Seitenleiste.

Bestehende URLs bleiben erreichbar: `?tab=labor`, `?tab=ich`, `?tab=system`,
`?tab=glossar` und zugehörige `?section=…`-Sprünge. Alarm-Pille und
Update-Banner bleiben global. Die Navigation darf keine Inhalte verstecken,
die nur über einen alten Haupttab erreichbar waren.

## Bereiche

| Bereich | Verantwortung | Abgrenzung |
|---|---|---|
| Jetzt | Empfehlung, drei Fakten, „Heute im Blick“, Umweg-Rechnung | Keine zweite vollständige Stationsliste |
| Woche | Veröffentlichte Fenster für die nächsten Tage | Mehrtagesbänder nicht als PIT-kalibriert ausgeben — seit 0.70.0 trägt jede Tageskarte ihr Kalibrierungs-Etikett (`24-h-Fenster (PIT-kalibriert, wenn aktiv)` nur am heutigen Tag, danach `Szenarioprognose (unkalibriert)`), die Fußzeile nennt `24h kalibriert (PIT), 3/7d unkalibrierte Szenarioprognose` |
| Stationen | Polling-Set, Karte, Vergleich und Stationsdetails | Tagesverlauf im Detail statt unbeschrifteter Mini-Linie in jeder Zeile |
| Labor | Modell, Güte, Kalibrierung, Heatmaps und Begründungen | Markt-Labor und Live-Advice nicht mit persönlicher Bilanz vermengen |
| Ich | Fahrzeug, Profile, Tankstand, Belege und Bilanz | Ein Intent ist kein Beleg |
| System | Konfiguration, Jobs, Archiv, Collector, Alarme, Outbox und Export | Interne Pfade und Betriebsbegriffe bleiben hier, nicht in Alltagskarten |
| Glossar | Begriffe mit verständlicher Kurz- und Langform | Fachwörter erst erklären, dann vertiefen |

„Heute im Blick“ zeigt die drei Faktenzeilen dauerhaft, den Tagesstreifen
zunächst eingeklappt. Ohne Empfehlung entfällt eine zusätzliche Freitext-
Wiederholung derselben Aussage. Mit Empfehlung kann sie Referenz und
persönlichen Vorteil erläutern.

## Tank-Guide: eine Frage, eine Antwort

Der Bereich „Jetzt“ beantwortet genau eine Frage: **Soll ich jetzt tanken?**
Die Erfassung läuft in vier Schritten, alles Statistische ordnet sich unter
(`web/src/guide.ts` hält die Texte und die Rechnung):

1. Farbe der Karte — Grün = jetzt tanken, Rot = Reserve wird knapp,
   Blau = besser warten, neutral = keine Zeit-Empfehlung.
2. Handlungs-Headline — „Jetzt tanken.“, „Besser warten.“,
   „Tanken, wann’s passt.“
3. Günstigster Preis in der Nähe.
4. Primäre Handlung (Route oder Erinnerung), daneben „Warum?“

**Geld und Zeit stehen in Nutzer-Einheiten:** Cent je Liter sind eine
Modellgröße, die Antwort ist der Betrag auf die Tankmenge
(`ca. 3,60 € pro Tankfüllung`). Zeitangaben sind konkrete Uhrzeiten
(„Gegen 19 Uhr“), nie Spannen und nie Wahrscheinlichkeitsdichten.

### Drei Fallback-Stufen

Ein anhaltender Zustand bekommt **kein** Modal und keinen Alert-Dialog. Das
Inline-Banner sitzt über der Karte und lässt die Preise sichtbar.

| Stufe | Auslöser | Karte | Tagesverlauf (im Blatt „Heute im Blick“) |
|---|---|---|---|
| 1 · Voller Guide | Verbindung und `decision_ready` | Urteilston wie oben | Stundenbalken (nächste 8 Stunden, aus `windows_today`) |
| 2 · Ohne Prognose | `decision_ready=false`, Preise live | Neutral (Outlined Card) mit „Jetzt am günstigsten: <Station>“ — ein Ort, kein Urteil über die Zeit | Faustregel: vier Tageszeiten, typischer Verlauf |
| 3 · Offline | keine Verbindung | Neutral, gedämpfte Preise mit Stand | Faustregel |

Der Tagesverlauf liegt **einen Tipp entfernt**, nicht offen unter der Karte:
Die Startseite trägt eine Frage und eine Antwort (B4 aus dem Befund
UX/Mathe 2026-09-19). Wer den Tag sehen will, tippt „Tagesstreifen 06–24
Uhr“ und bekommt Streifen **und** Balken bzw. Faustregel in einem Blatt.
Gemessene Scrolltiefe des Entscheidungsbildschirms: 1,41 Viewports auf
390 × 844 (Ratchet in `web/e2e/mobile.spec.ts`: ≤ 1,5).

Die Karte selbst trägt die Antwort und höchstens zwei Sätze dazu; Spanne,
Preisalter und die Bestätigung des Netto-Vergleichs stehen hinter „Mehr zum
Vergleich“. Was der Antwort **widerspricht** (eine andere Station ist netto
günstiger), bleibt sichtbar — eine Karte darf nicht „hier am günstigsten“
sagen und das Gegenteil einklappen.

Beide Fallback-Stufen bieten **eine** Handlung: „Erneut versuchen“ mit
Inline-Ladeindikator. Kommen die Daten zurück, springt die Ansicht leise auf
Stufe 1 und bestätigt mit einer Snackbar („Wieder online. Alles ist aktuell.“).

**Eine Farbe, eine Bedeutung.** Der Entwurf („Tankklar“) ordnet „Warten“ Rot
zu. Rot trägt in dieser App aber schon eine sicherheitsrelevante Aussage:
„Reserve reicht nicht bis zum Fenster“. Rot wird deshalb **nicht**
umgewidmet — „Besser warten“ bleibt blau. Die Reihenfolge des Entwurfs ist
übernommen, nicht seine Farbe gegen eine bestehende Warnung.

### Labor: die freiwilligen Blöcke

Das Labor ist ein Angebot, kein Pfad zur Empfehlung — der Guide funktioniert
ohne jede Zahl von dort. Neben Fan-Chart, Vertrauens-Konto und Tagebuch
stehen vier Blöcke (`web/src/views/labor/BetaBlocks.tsx`):

| Block | Frage | Datenpfad |
|---|---|---|
| Was den Preis gerade bewegt | Warum ist es gerade teuer oder günstig? | Tagesspielraum (Tagesstreifen) und Stationsspanne — Balken **nur** mit Messwert, sonst sichtbar ohne Balken |
| Wie oft lag die Empfehlung richtig? | Kann ich der App trauen? | Advice-Ledger: ein Punkt je abgerechnete Empfehlung; ohne Zählung der Lernstand |
| Persönliches Tankprofil | Was bringt es **mir**? | Tankmenge × Wartebereitschaft gegen die echten Fenster des Tages; lokale Vorschau, das Profil bleibt in „Ich“ |
| Experimente | Was gibt es Neues? | Lokale Schalter, offline deaktiviert mit dem Grund „Braucht eine Verbindung“ |

## Labor-Unterbereiche

Das Labor ist im Checkout bereits in vier Sub-Tabs aufgeteilt:

| Sub-Tab | Inhalt |
|---|---|
| Überblick | Geführter Fan-Chart, Vertrauens-Konto, Tagebuch **und die vier freiwilligen Blöcke** (Einflüsse, Treffsicherheit, Tankprofil, Experimente) |
| Modell & Parameter | Acht Karten: Struktur, AR(2), Bootstrap, 12-Uhr-Projektion, Ensemble, Selektion, Schwellen, Regime |
| Güte & Kalibrierung | Rolling-PICP, Reliability, Brier, Backtest und Heatmaps |
| Daten & Rohdaten | Reichweite, Roh-Tabellen, CSV-Export, API-Explorer und Winter-Hinweis |

`?tab=labor&subtab=ueberblick|modell|guete|daten` adressiert die Unterbereiche.
Historische Abschnittssprünge werden über `LAB_SECTION_TO_SUBTAB` zugeordnet.
Die Einzelansichten liegen unter `web/src/views/labor/`; Karte 7 zeigt ein
Beta(5,5)-Intervall der Trefferquote. Karte 8 beschreibt auch geplante
Regime-Bausteine und ist deshalb **kein Beleg**, dass Normalisierung, Deckel
oder Projektionsausnahme in der Engine implementiert sind.

Lange Modellbezeichner in Kette, Titel und Erklärung der Parameterkarten
brechen innerhalb ihrer verfügbaren Breite um. Dafür wird Text weder gekürzt
noch zusätzlich abgeschnitten. Der geometrische Browsertest prüft dies bei
320 und 390 px auch mit einem absichtlich überlangen Bezeichner.

## Antwort, Begründung und Beweis

1. **Antwort:** eine klare Aussage mit handlungsrelevanten Zahlen.
2. **Begründung:** Datenalter, Quelle, Bedingungen und relevante Unsicherheit.
3. **Beweis:** gezielter Sprung in Labor, Diagramm oder Rohdaten.

Tooltips ergänzen bekannte Begriffe; sie ersetzen keine notwendige Erklärung.
Preise verwenden €/L, Differenzen ct/L, Tankbeträge €. Zeitangaben folgen
Europe/Berlin. Formatierung erfolgt über `web/src/data.ts`; verbindliche
Formulierungen stehen in [Microcopy](MICROCOPY.md).

Fenster-Vorteil („bis zu“) und Median-Erwartung sind verschiedene Größen.
Die GUI darf sie weder sprachlich noch rechnerisch austauschen. Ebenso bleiben
Prognosekalibrierung und Produktfreigabe getrennt sichtbar.

## Urteilstöne und Elevation

Seit 26.09.2026 trägt jede Urteils-Karte vier Töne mit fester Bedeutung:

| Ton | Bedeutung | Beispiel |
|---|---|---|
| Grün (primary) | jetzt handeln | `Jetzt tanken` bei Preisvorteil |
| Blau (tertiary) | warten bis Fenster — die geplante, Geld sparende Handlung | `Warten bis 18–20 Uhr` · `Woanders tanken` |
| Rot (error) | echtes Risiko — Tankrest blockiert das Warten | `Jetzt tanken` bei `tank.blocks_wait` |
| Grau (neutral) | ehrlich unentschieden | `Keine klare Empfehlung` · abgelaufene Freigabe |

Rot ist keine Dekoration und kein Wartungs-Alarm: Es markiert genau die
eine Situation, in der das Warten physisch riskant ist. Grau (keine
Empfehlung) ist ein regulärer Produktzustand — bewusst ohne Elevation.

Die Urteils-Karte ist die **einzige Karte der Seite mit Elevation**
(Glow nach Urteilston: `glow-emerald` / `glow-blue` / `glow-rose`);
Fakten-, Tagesstreifen- und Umweg-Karten bleiben flach (Tonal). Der
Blick auf „Jetzt“ erreicht die Antwort deshalb ohne Suchen.

Zu den Tönen gehören zwei Zustands-Chips:

- **Gültigkeits-Chip** `gültig bis 17:45` — die Freigabe trägt ihr
  `valid_until` (A21-B1.4) sichtbar; Tageszeit über `timeOfDayLabel`.
  Eine Ablehnung altert nicht und trägt keinen Chip.
- **Abgelaufene Freigabe** — liegt `valid_until` in der Vergangenheit
  (offene Seite, gecachte Antwort), wechselt der Karteninhalt in die
  graue Variante `Empfehlung abgelaufen`. Das ist ein Inhaltswechsel,
  kein Fehler: Der Vertrag verbietet, die Aktion erneut zu zeigen;
  Preise und Fakten bleiben darunter sichtbar.

Die Lernphase (S1) benennt, was schon funktioniert:
`Vergleich und Umweg-Rechnung funktionieren bereits.` — die App ist in
der Lernphase keine tote Fläche (Muster in [Microcopy](MICROCOPY.md) §4b).

Die RP2-Fallback-Oberfläche heißt **Lesemodus** (Badge `Lesemodus · RP2`):
dieselbe Marke, reduzierte Edition, kein Fehlerbild. Solange das NAS
nicht erreichbar ist, benennt sich der Status-Banner selbst —
`NAS ist gerade nicht erreichbar — die Preise zeigen den letzten
gemeldeten Stand. Zur Orientierung, nicht zur Entscheidung.` (Muster in
[Microcopy](MICROCOPY.md) §4a).

## Zustände und Datenwahrheit

- **Einrichtung:** fehlende Daten erklären und nächste Schritte nennen.
- **Laden:** Ladezustand statt fälschlicher Behauptung, es gebe keine Preise.
- **Veraltet:** vorhandene Daten mit Alter kennzeichnen, nicht als frisch
  empfehlen.
- **Fehler:** Grund und Handlung nennen; ein HTTP-200-Fehlerkörper ist keine
  gültige Summary.
- **Nicht entscheidungsbereit:** reine Preise zeigen, keine erfundene
  Empfehlung oder Sicherheitsquote.
- **Offline:** Belege/Vorsätze, die ohne Verbindung erfasst werden, liegen
  in der Outbox (IndexedDB): offene Einträge mit 30-s-Nachreich-Takt,
  sichtbare Endzustände (`rejected`/`expired`), Export und Entfernung in
  „System“ → Diagnose — nichts wird still verworfen. `queued=true` steht nur
  für persistiert. RP2-Fallback ist dagegen eine eigene, lesende
  Betriebsoberfläche.

Forecast, Backtest, Live-Advice und Wallet müssen als unterschiedliche
Datenquellen erkennbar bleiben. Diagramme brauchen eine Textalternative mit
Werten, nicht nur Reihennamen.

## Mobil, Desktop und Barrierefreiheit

- Fokusführung, Tastaturbedienung und aktive Navigation sind testbare Zusagen.
- Auf 390 px dürfen Stationskarten und Tabellen keinen unnötigen horizontalen
  Seiten-Scroll erzeugen.
- Die Scrolltiefen-Grenze von 1,5 Viewports gilt für den „Jetzt“-Abschnitt bei
  390 × 844, nicht für die gesamte Seite einschließlich globalem Kopf.
- Ein Desktop-Zweispalter und eine zusätzliche Verdichtung der mobilen
  Steuerzeilen sind keine offenen Implementierungszusagen:
  [ADR 0002](../adr/0002-PRODUKTUMFANG.md).
- Dark/Light, Typografie und Komponenten übernehmen die gestalterische Basis
  der [GUI-Vorlagen](GUI-VORLAGEN.md), aber keine Demo-Datenlogik.
- Der Neubau ist **Desktop zuerst**: Kopfzeile, Seitenleiste und zwei Spalten
  ab 1024 px; darunter dieselbe Reihenfolge in einer Spalte mit unterer Leiste
  und „Mehr“-Blatt. Geprüft in `web/e2e/konzept.spec.ts` für 1440 px und
  390 px.

## Änderungen abnehmen

Die gemockte Browser-Suite prüft Interaktionsfälle; die Demo-Suite prüft die
Oberfläche gegen echte Serverantworten. Beides ist erforderlich. Zusätzlich
bleiben Microcopy-Ratchet, mobile Layout-Prüfungen und die
[Qualitätsbudgets](../entwicklung/QUALITAET.md) maßgeblich.

Für das Labor bleiben alle sechs historischen Abschnittssprünge sowie der
Umbruch langer Bezeichner in den Parameterkarten Teil der Demo-Browser-Suite.
Eine bestandene Layoutprüfung ersetzt keine Modell- oder Hardwareabnahme.

## Konzept-Neubau („GUI v3“, 0.73.0)

`/?konzept=1` ist die **echte** Ansicht: dieselben Endpunkte, dieselben
Freigabegates, dieselben Formatter wie unter `/` — nur Gestaltung und
Anordnung kommen aus dem Konzept. Der frühere Prototyp mit Handy-Rahmen,
Steuerpanel und Beispieldaten ist entfernt
([Release 0.73.0](../releases/CHANGELOG.md#0730--2026-09-28)); Details und die
Übernahmeregeln stehen in [GUI-Vorlagen](GUI-VORLAGEN.md).

- **Kopfzeile** trägt Kontext (Stadt · Kraftstoff), Zustand, Darstellung und
  Aktualisieren. **Seitenleiste** links: Jetzt · Woche · Stationen, darunter
  das Studio (Labor, Ich, System, Glossar). Am Handy trägt die untere Leiste
  dieselben Einträge, Studio hinter „Mehr“.
- **Jetzt** beantwortet weiter genau eine Frage. Die Antwort steht in der
  einzigen Karte mit Elevation; darunter drei Fakten und höchstens drei
  Schritte. Rechts stehen die Annahmen (Was wäre wenn, Tankstand, was Warten
  bringt), darunter „Heute im Blick“ über die **volle** Breite: der
  Tagesstreifen braucht je Stundenzelle rund 36 px (Ratchet U2b) — in einer
  360-px-Seitspalte wären es 30, und die Zahlen liefen ineinander. Am Handy
  liegen dieselben Kennzahlen als Zeilen in der Karte, der Streifen hinter
  „Tag ansehen“.
- **Stufe 2 und 3** bleiben unverändert ehrlich: ein Inline-Banner über der
  Antwort erklärt, was fehlt und was trotzdem geht, mit genau einer Handlung
  („Erneut versuchen“). Ohne Verbindung nennt die Karte den Stand und die
  Faustregel — keine zwischengespeicherte Prognose als Prognose.
- **Woche** folgt demselben Muster: die Antwortkarte ist das gewählte Fenster
  (Preis, Ersparnis, Sicherheit, Kalibrierungs- und Tank-Hinweis), darunter
  das Raster der sieben Tage, die Wochenlinie und die Liste aller Fenster
  nach Ersparnis; rechts die Tankstand-Pflege und der Datenstand. Tage 5–7
  bleiben „noch unsicher“, Sterne gibt es nur mit messbarem P.
- **Stationen** ist der Preis-Atlas im neuen Raster: Steuerleiste (Suche,
  „nur offene“, Marke, Zeitwert, Sortierung), darunter Karte und Liste, rechts
  die sichtbare **Referenz** mit Datenstand. Detail und Verlauf sowie „A gegen
  B“ liegen über die **volle** Breite — ein Diagramm mit Achsen und
  Zeitmarken (`components/SeriesChart.tsx`, von beiden Hüllen genutzt) hat in
  einer 360-px-Seitspalte nichts zu suchen.
- **Bereiche außer „Jetzt“, „Woche“ und „Stationen“** laufen in der
  bisherigen Gestaltung weiter und werden über `views/Sections.tsx` für beide
  Hüllen einmal gerendert. Der Neubau sagt offen, wo das noch so ist; jeder
  migrierte Bereich ersetzt dort einen Block.

## Darstellung und Themen

Die Wahl steht in den Einstellungen (Ich → Einstellungen → Darstellung) und
hat drei Zustände:

| Wahl | Anzeige | Speicher |
|---|---|---|
| **System** (Voreinstellung) | folgt `prefers-color-scheme`, live | kein Schlüssel |
| Dunkel | immer dunkel | `tankapp.theme = "dark"` |
| Hell | immer hell | `tankapp.theme = "light"` |

Sagt das Gerät nichts (oder ist die Abfrage nicht möglich), gilt **Dunkel** —
das ist der Rückfall, keine Vorliebe. `public/theme-boot.js` wendet dieselben
Regeln vor dem ersten Paint an, `src/theme.ts` hält sie fest (mit
`theme.test.ts`), `applyAppTheme` hält Klasse und `theme-color` synchron.
Beide Themen sind dasselbe Material-You-Schema; keine Komponente trägt eigene
Farbwerte.
