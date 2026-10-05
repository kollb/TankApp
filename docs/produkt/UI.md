# Oberfläche und Interaktion

> Stand: 05.10.2026 · App-Version 0.74.0
> Beschreibt die implementierte Navigation einschließlich der drei Labor-Blöcke.
> Neu in 0.60.0: Outbox-Karte in „System“ → Diagnose und Header-Banner für
> wartende Einträge (I1, [Release 0.60.0](../releases/CHANGELOG.md#0600--2026-09-20)).
> Neu in 0.70.2: der Tank-Guide — eine Frage, eine Antwort, drei Fallback-Stufen
> ([Release 0.70.2](../releases/CHANGELOG.md#0702--2026-09-27)).
> Neu in 0.71.0: GUI v2 — helles Material-You-Design nach `sample/good gui`
> als Standard; der bisherige dunkle Stand bleibt als Thema „Dunkel“
> ([Release 0.71.0](../releases/CHANGELOG.md#0710--2026-09-27)).
> Neu in 0.73.0: „Jetzt“ und „Woche“ antworten statt zu berichten — eine
> Frage, eine Antwort ([Release 0.73.0](../releases/CHANGELOG.md#0730--2026-10-04)).

## Inhaltsverzeichnis

- [Navigation](#navigation)
- [Bereiche](#bereiche)
- [Tank-Guide: eine Frage, eine Antwort](#tank-guide-eine-frage-eine-antwort)
- [Jetzt: eine Antwort, ein Tipp in die Tiefe](#jetzt-eine-antwort-ein-tipp-in-die-tiefe)
- [Woche: Bestenliste statt Raster](#woche-bestenliste-statt-raster)
- [Labor: drei Fragen](#labor-drei-fragen)
- [Antwort, Begründung und Beweis](#antwort-begründung-und-beweis)
- [Urteilstöne und Elevation](#urteilstöne-und-elevation)
- [Zustände und Datenwahrheit](#zustände-und-datenwahrheit)
- [Mobil, Desktop und Barrierefreiheit](#mobil-desktop-und-barrierefreiheit)
- [Änderungen abnehmen](#änderungen-abnehmen)

## Navigation

Seit 0.70.1 öffnet der Kontext-Chip im Kopf Stadt und Kraftstoff in einem
Bottom Sheet. Das Tagesverlauf-Detail der Tageszeile öffnet ebenfalls als
Sheet; native Dialoge begrenzen den Tastaturfokus und schließen mit Escape,
danach kehrt der Fokus zum Auslöser zurück. Die Gültigkeit zählt die letzten
30 Minuten herunter (`bis 17:45 · noch 12 min`); ab dem Ablaufzeitpunkt
zeigt die Karte auch ohne neue Serverantwort die neutrale Tatsachenvariante
(`Preisvergleich`) statt des Urteils.

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
| Jetzt | **Eine** Antwort („soll ich jetzt tanken?“), ein Euro-Betrag, eine Handlung | Keine drei Fakten, kein 19-Zellen-Raster, keine Was-wäre-wenn-Annahmen, keine zweite Stationsliste |
| Woche | Bestenliste: höchstens drei Fenster, sortiert nach Ersparnis | Kein 7-Tage-Raster, keine Sterne, keine Prozentwerte, keine Wochenlinie, keine zweite Liste; die Unsicherheit steht als **ein** Satz unter der Liste (`Ab Tag 5 wird die Prognose unsicher.`) |
| Stationen | Polling-Set, Karte, Vergleich und Stationsdetails | Tagesverlauf im Detail statt unbeschrifteter Mini-Linie in jeder Zeile |
| Labor | Drei Fragen: Kann ich vertrauen? · Wie gut ist die Prognose? · Wie rechnet die App? | Beweise statt Sammelakte; Rohdaten und CSV gehören dem Betreiber in „System“ |
| Ich | Fahrzeug, Profile, **Tankstand (einziger Ort der Pflege)**, Belege und Bilanz | Ein Intent ist kein Beleg |
| System | Konfiguration, Jobs, Archiv, Collector, Alarme, Outbox, **Rohdaten, CSV-Exporte und API-Explorer** | Interne Pfade und Betriebsbegriffe bleiben hier, nicht in Alltagskarten |
| Glossar | Begriffe mit verständlicher Kurz- und Langform | Fachwörter erst erklären, dann vertiefen |

Seit 0.73.0 gilt für beide Bereiche derselbe Auftrag: **eine Frage, eine
Antwort — der Rest ein Tipp entfernt.** „Jetzt“ zeigt die Antwortkarte und
eine Tageszeile (Mini-Kurve + Tief); „Woche“ zeigt die Bestenliste mit
höchstens drei Einträgen. Alles Statistische bleibt erreichbar, aber es
steht nicht mehr auf dem Antwortschirm.

## Tank-Guide: eine Frage, eine Antwort

Der Bereich „Jetzt“ beantwortet genau eine Frage: **Soll ich jetzt tanken?**
Die Antwortkarte (`web/src/now.ts`) trägt genau das, was die Frage braucht —
Chip, Überschrift, **eine** Zahl in Euro, eine Nebenzeile und **eine**
Handlung („Route“, daneben „Warum?“). Alles Statistische ordnet sich unter
und liegt einen Tipp entfernt (`web/src/guide.ts` hält die Fallback-Texte):

1. Chip — einer von fünf Ausgängen (siehe unten).
2. Überschrift — „Jetzt tanken“, „Warten bis ~18 Uhr“,
   „Tanken, wann’s passt“, „Günstigste gerade: <Station>“, „Letzter Stand:
   <Station>“. Höchstens 25 Wörter, kein Fachwort.
3. **Eine** Zahl in Euro — `spart ca. 1,60 €` beim Warten, sonst der
   günstigste Preis als `1,709 €/L`.
4. Genau eine primäre Handlung: „Route“ zur Station der Antwort.

**Geld und Zeit stehen in Nutzer-Einheiten:** Cent je Liter sind eine
Modellgröße, die Antwort ist der Betrag auf die Tankmenge
(`ca. 3,60 € pro Tankfüllung`). Zeitangaben sind konkrete Uhrzeiten
(„Gegen 19 Uhr“), nie Spannen und nie Wahrscheinlichkeitsdichten.

### Drei Fallback-Stufen

Ein anhaltender Zustand bekommt **kein** Modal und keinen Alert-Dialog. Das
Inline-Banner sitzt über der Karte und lässt die Preise sichtbar.

| Stufe | Auslöser | Banner | Karte |
|---|---|---|---|
| 1 · Voller Guide | Verbindung und `decision_ready` | keiner (außer Tankrabatt-Hinweis) | Urteilston wie oben |
| 2 · Ohne Prognose | `decision_ready=false`, Preise live | „Die Prognose macht gerade Pause“ | Neutral („Günstigste gerade: <Station>“) — ein Ort, kein Urteil über die Zeit |
| 3 · Offline | keine Verbindung | letzter Stand | Neutral („Letzter Stand: <Station>“) — „Der Preis an der Säule zählt.“ |

Genau **ein** Banner steht gleichzeitig; die Rangfolge ist offline →
keine Prognose → Hinweis (Tankrabatt). Die Tageszeile hängt nicht an der
Stufe, sondern an Messwerten: Sie erscheint, wenn der Tag bepreiste Stunden
hat, und fehlt sonst — geschätzt wird nie.

Die Faustregel folgt der 12-Uhr-Regel (seit 01.04.2026 darf der Preis nur um
12:00 Uhr steigen): `Vormittag` tief, `Nach 12` hoch, `Nachmittag` und `Abend`
mittel — nie „abends am günstigsten“. Liegt ein Preisniveau-Termin (Tankrabatt)
im Sichtfeld der Prognose, steht in Woche und Jetzt ein Inline-Banner
(`regime_notice`); Fenster hinter dem bevorstehenden Stichtag tragen keinen
Abstand zu „jetzt“. Das Banner ist zeitlich begrenzt (Termin höchstens 7 Tage
voraus oder 14 Tage zurück) und zählt wie das Fensterende-Feedback nicht zur
Scrolltiefe-Messung von „Jetzt“ (Ratchet ≤ 1,5 Viewports, `data-regime-notice`).
Die Stationenliste öffnet nach Preis, günstigste zuerst.

Der Tagesverlauf liegt **einen Tipp entfernt**, nicht offen unter der Karte:
Die Startseite trägt eine Frage und eine Antwort (B4 aus dem Befund
UX/Mathe 2026-09-19, §9 des Neuentwurfs). Wer den Tag sehen will, tippt die
Tageszeile und bekommt im Blatt die große Kurve mit drei Zahlen (tiefster
Preis, jetzt, Tagesmedian) und der Abdeckung (`n von m Stunden mit offener
Meldung`). Gemessene Scrolltiefe des Entscheidungsbildschirms: 1,41
Viewports auf 390 × 844 (Ratchet in `web/e2e/mobile.spec.ts`: ≤ 1,5); die
Antwort-Überschrift endet im ersten Viewport.

Die Karte trägt die Antwort und höchstens eine Nebenzeile; Spanne,
Preisalter, Herkunft und Sicherheit stehen im „Warum?“ -Blatt — **höchstens
fünf Zeilen** (Fenster, Ersparnis, Sicherheit, Tank, Stand), danach der Weg
ins Labor. Was der Antwort **widerspricht**, bleibt benennbar: Ohne
freigegebene Aktion zeigt die Karte die Tatsache (günstigster bekannter
Preis) statt eines Urteils.

Beide Fallback-Stufen bieten **eine** Handlung: „Erneut versuchen“ mit
Inline-Ladeindikator. Kommen die Daten zurück, springt die Ansicht leise auf
Stufe 1 — der Banner verschwindet, ohne Erfolgsmeldung.

**Eine Farbe, eine Bedeutung.** Der Entwurf („Tankklar“) ordnet „Warten“ Rot
zu. Rot trägt in dieser App aber schon eine sicherheitsrelevante Aussage:
„Reserve reicht nicht bis zum Fenster“. Rot wird deshalb **nicht**
umgewidmet — „Besser warten“ bleibt blau. Die Reihenfolge des Entwurfs ist
übernommen, nicht seine Farbe gegen eine bestehende Warnung.

### Labor: das Angebot bleibt freiwillig

Das Labor ist ein Angebot, kein Pfad zur Empfehlung — der Guide funktioniert
ohne jede Zahl von dort. Die früheren Beta-Blöcke (Einflüsse, Treffsicherheit,
Tankprofil-Rechner, Experimente) sind entfallen: Die Einflüsse ersetzt der eine
Satz in Block 2, die Treffsicherheit ist Block 1, die Tankprofil-Frage beantwortet
eine Zeile in „Ich“ → Fahrzeug, und Experimente hatten keinen Nutzerpfad (§7).

## Jetzt: eine Antwort, ein Tipp in die Tiefe

Der Aufbau ist fest (Befund UX/Mathe 2026-09-19, Neuentwurf §3):

```text
Kopf        Ort · Kraftstoff · Frische-Chip
Banner      höchstens einer (offline → keine Prognose → Tankrabatt)
Antwort     Chip · Überschrift · eine Zahl in € · eine Handlung · „Warum?“
Tageszeile  Mini-Kurve + Tief + „Heute: …“ — ein Tipp auf die große Kurve
```

Was 0.73.0 gestrichen hat und **nicht** zurückkehrt (§7):

| Entfällt | Warum | Wohin stattdessen |
|---|---|---|
| Was-wäre-wenn-Annahmen (Tankmenge, Zeitwert, Spätestens) | die App rechnet mit der Menge, die der Server nutzt (`used_liters`) | „Ich“ → Fahrzeug |
| Feedback-Intents („Ich warte“), Fällig-Prompt | eine Bestätigung ist kein Beleg; Belege werden gepflegt, nicht bestätigt (Entscheidung 04.10.2026) | „Ich“ → Belege |
| „Nächste Schritte“, drei Fakten, Benefit-Block | die Antwort steht oben; darunter stand dreimal dieselbe Zahl | „Warum?“ (≤ 5 Zeilen), Labor |
| „Heute im Blick“ mit 19 Zellen und Stundenbalken | die Entscheidung braucht kein Raster | Tageszeile, ein Tipp entfernt |
| Konfidenz-Balken, Prozentwerte | eine Prozentzahl ist keine Handlung | Sicherheit als **ein Wort** (`ziemlich sicher` · `eher sicher` · `unsicher` · `noch nicht messbar`) |
| Frische-Fußzeile unter der Ansicht | doppelter Ort für das Alter | Frische-Chip im Kopf |

Der Serververtrag bleibt unberührt: Intents, Fenster, p-Felder und
`regime_notice` werden weiter geliefert — die GUI zeigt weniger davon.

## Woche: Bestenliste statt Raster

„Woche“ beantwortet: **Wann in den nächsten Tagen soll ich tanken?**
Statt sieben Tageskarten, einer Detailkarte, einer zweiten Liste und einer
Wochenlinie (deren Balken „höher = günstiger“ gegen jede Lesegewohnheit
lief) steht eine Bestenliste mit **höchstens drei** Einträgen, sortiert
nach Ersparnis. Jeder Eintrag trägt:

1. Tag und Zeit (`Morgen` · `19–21 Uhr`),
2. erwarteten Preis (`1,709 €/L`),
3. Ersparnis (`spart ca. 1,60 €`) — oder keine Zahl, wenn ein
   Preisniveau-Termin dazwischen liegt,
4. Sicherheit als ein Wort.

Unter der Liste steht **ein** Satz zur Prognosebreite:
`Ab Tag 5 wird die Prognose unsicher.` Leere Tage bleiben leer — die App
erfindet kein Fenster. Der Tagesverlauf ist das Detail des heutigen
Eintrags; weiter voraus gibt es keine Messwerte, und geschätzt wird nichts.

Der Tankstand wird hier nur **angezeigt** (`Tank: 62 %` · „Ändern“).
Gepflegt wird er an genau einem Ort: „Ich“ → Fahrzeug (§6).

## Labor: drei Fragen

Das Labor hat seit 0.74.0 **drei Blöcke, sonst nichts** (`views/Labor.tsx`,
Vokabular in `lab.ts`). Die Fragen stehen genau einmal in `LAB_BLOCKS`:

| Block | Frage | Inhalt |
|---|---|---|
| 1 · `#labor-sicherheit` | Kann ich vertrauen? | **Ein** Satz als Zählung („An 26 von 30 Tagen lag die Empfehlung richtig.“), kein Prozent; darunter das filterbare Prognose-Tagebuch (Alle/Richtig/Daneben/Unentschieden/Nicht bewertbar) |
| 2 · `#labor-prognose` | Wie gut ist die Prognose? | **Eine** Kurve (erwartet vs. echt, Blickweite 24 h/3 Tage/7 Tage) und **ein** Satz: „Im Schnitt 1,8 ct/L daneben.“ |
| 3 · `#labor-rechenweg` | Wie rechnet die App? | Drei Schritte in Alltagssprache (Tagesmuster der Stadt, aktuelle Lage, 12-Uhr-Regel); darunter „Details für Neugierige“ mit acht Bausteinen, Fachwerten und der Heatmap als einziger Grafik |

Gestrichen und nicht wiederkehrend (§7): Sub-Tabs, Spielplatz-Regler,
Experimente, Tankprofil-Rechner, Einflüsse-Balken, Güte-Panel (PICP, Brier,
CUSUM, zwei MASE-Werte), eingebettetes Glossar, Heatmap-Schalter und der
Rohdatenraum. Rohdaten, die vier CSV-Exporte und der API-Explorer stehen als
Betreiber-Sicht in „System“ (Abschnitt „Datenreichweite & Herkunft“ und
`#rohdaten-section`); das Labor verweist nur dorthin.

Adressen: `?tab=labor&section=sicherheit|prognose|stationen|lernen|glossar`
springt auf den zugehörigen Block; die alten Sub-Tab-Links
(`?subtab=ueberblick|modell|guete|daten`) übersetzt `sectionFromLegacySubTab`.
Lange Modellbezeichner in Kette, Titel und Erklärung der acht Bausteine brechen
innerhalb ihrer verfügbaren Breite um — Text wird dabei nicht gekürzt. Der
geometrische Browsertest prüft dies bei 390 px mit einem absichtlich
überlangen Bezeichner.

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
| Grau (neutral) | ehrlich unentschieden — oder keine freigegebene Aktion | `Tanken, wann’s passt` · `Günstigste gerade: <Station>` · `Letzter Stand: <Station>` · abgelaufene Freigabe |

Rot ist keine Dekoration und kein Wartungs-Alarm: Es markiert genau die
eine Situation, in der das Warten physisch riskant ist. Grau (keine
Empfehlung) ist ein regulärer Produktzustand — bewusst ohne Elevation.

Die Antwort-Karte ist die **einzige Karte der Seite mit Elevation**
(Glow nach Urteilston: `glow-emerald` / `glow-blue` / `glow-rose`);
Tageszeile und Blätter bleiben flach (Tonal). Der Blick auf „Jetzt“
erreicht die Antwort deshalb ohne Suchen.

Seit 0.73.0 trägt die Antwortkarte **fünf** Ausgänge — mehr gibt es nicht,
und jeder heißt immer gleich:

| Chip | Ton | Wann |
|---|---|---|
| `Jetzt tanken` | grün (rot bei `tank.blocks_wait`) | jetzt ist der günstigste Weg |
| `Warten` | blau | Fenster mit spürbarem Vorsprung (`> 0,50 €`) |
| `Kaum Unterschied` | grau | „Tanken, wann’s passt“ — der Vorsprung ist kleiner als die Schwelle |
| `Preisvergleich` | grau | keine freigegebene Aktion (`no_advice`, abgelaufene Freigabe, nicht entscheidungsbereit) — die Tatsache statt eines Urteils |
| `Offline` | grau | keine Verbindung — letzter Stand, „Der Preis an der Säule zählt.“ |

Zu den Tönen gehören zwei Zustands-Chips:

- **Gültigkeit** `bis 17:45` in kleiner Schrift neben dem Chip — die
  Freigabe trägt ihr `valid_until` (A21-B1.4); Tageszeit über
  `timeOfDayLabel`. In den letzten 30 Minuten steht zusätzlich
  `· noch <n> min` (`countLabel`). Eine Ablehnung altert nicht und trägt
  keine Gültigkeit.
- **Abgelaufene Freigabe** — liegt `valid_until` in der Vergangenheit
  (offene Seite, gecachte Antwort), wechselt die Karte in die graue
  Tatsachenvariante (`Preisvergleich`): Chip, Überschrift und die
  Gültigkeitszeile verschwinden, der günstigste bekannte Preis bleibt.
  Das ist ein Inhaltswechsel, kein Fehler — und bewusst **keine** eigene
  „abgelaufen“-Karte: Sie würde eine Freigabe zeigen, die es nicht mehr
  gibt.
- **Frische** — ein Chip im Kopf (`vor 4 Min` · `alt` · `kein Stand`),
  nicht als Fußzeile unter der Antwort (§6: ein Ort je Sache).

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

## Änderungen abnehmen

Die gemockte Browser-Suite prüft Interaktionsfälle; die Demo-Suite prüft die
Oberfläche gegen echte Serverantworten. Beides ist erforderlich. Zusätzlich
bleiben Microcopy-Ratchet, mobile Layout-Prüfungen und die
[Qualitätsbudgets](../entwicklung/QUALITAET.md) maßgeblich.

Für das Labor bleiben alle historischen Abschnittssprünge (über
`sectionFromLegacySubTab` auf die drei Blöcke abgebildet) sowie der Umbruch
langer Bezeichner in den acht Bausteinen Teil der Demo-Browser-Suite. Eine
bestandene Layoutprüfung ersetzt keine Modell- oder Hardwareabnahme.

Seit 0.73.0 gehören zur Abnahme von „Jetzt“ und „Woche“:

- **Sichtprüfung bei 390 px und auf dem Desktop:** die Antwort ist ohne
  Scrollen sichtbar, die Details liegen einen Tipp entfernt (§9).
- **Ratchets in `web/e2e/mobile.spec.ts`:** die Antwort-Überschrift endet
  im ersten Viewport, die Tageszeile ist zu, das „Warum?“ -Blatt trägt
  höchstens fünf Zeilen, der Fokus liegt beim Öffnen im Dialog.
- **Streichlisten in den Unit-Tests** (`views/Jetzt.test.tsx`,
  `views/Woche.test.tsx`): keiner der gestrichenen Bausteine kehrt zurück.
- **Microcopy-Ratchet** (`web/src/microcopy.test.ts`): genau fünf
  Antwort-Chips, Frische aus einem Baustein, keine abgelaufene
  Urteils-Headline.

## Interaktives Design-Lab (0.72.0)

`/?konzept=1` öffnet den M3-Prototyp aus `sample/good gui`: Smartphone links,
UX-Panel rechts. Mobil schaltet „Konzept & Steuerung“ die Ansicht um. Der
Desktop-Link „Neue GUI“ sitzt in der Live-Kopfzeile. Die Live-App bleibt unter
`/` und den bisherigen Tab-URLs; deren Funktionen werden nicht durch Demo-Daten
ersetzt. Karte/Alarme im Prototyp sind ausdrücklich Demo-Interaktionen. Bedienung und
Funktionsabdeckung stehen in [GUI-VORLAGEN](GUI-VORLAGEN.md).
