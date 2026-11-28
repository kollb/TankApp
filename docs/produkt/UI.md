# Oberfläche und Interaktion

> Stand: 28.11.2026 · App-Version 0.78.0
> Beschreibt die implementierte Navigation, die Atlas-Referenz und die drei Labor-Blöcke.
> Neu in 0.60.0: Outbox-Karte in „System“ → Diagnose und Header-Banner für
> wartende Einträge (I1, [Release 0.60.0](../releases/CHANGELOG.md#0600--2026-09-20)).
> Neu in 0.70.2: der Tank-Guide — eine Frage, eine Antwort, drei Fallback-Stufen
> ([Release 0.70.2](../releases/CHANGELOG.md#0702--2026-09-27)).
> Neu in 0.71.0: GUI v2 — helles Material-You-Design nach der M3-Vorlage
> als Standard; der bisherige dunkle Stand bleibt als Thema „Dunkel“
> ([Release 0.71.0](../releases/CHANGELOG.md#0710--2026-09-27)).
> Neu in 0.73.0: „Jetzt“ und „Woche“ antworten statt zu berichten — eine
> Frage, eine Antwort ([Release 0.73.0](../releases/CHANGELOG.md#0730--2026-10-04)).
> Neu in 0.75.0: kompakte Kopfzeile unter 1280 px — Profil und seltene
> Aktionen liegen in einem zugänglichen Blatt ([Release 0.75.0](../releases/CHANGELOG.md#0750--2026-10-05)).
> Neu in 0.76.0: Übersicht + Stationen als Alltagsnavigation, Atlas-Referenz
> nur mit frischem Preis und bis zu fünf Server-Alternativen ([Release 0.76.0](../releases/CHANGELOG.md#0760--2026-11-27)).
> Neu in 0.77.0: Labor zweistufig — Beweise (Wochen-Heatmap,
> Trefferquote/Kalibrierung, Stations-Pool) oben, Tagebuch, Prognose und
> Rechenweg hinter „Warum & Rechenweg“ ([Release 0.77.0](../releases/CHANGELOG.md#0770--2026-11-28)).
> Neu in 0.78.0: „Ich“ ist in „Einstellungen“ aufgegangen (Belege und Bilanz
> als eingeklapptes Blatt, kein vierter Untertab), der Konzept-Einstieg ist
> entfernt, und die Übersicht endet mit „Alle X Stationen & Karte anzeigen“
> ([Release 0.78.0](../releases/CHANGELOG.md#0780--2026-11-28)).
>
> Prüfhinweis (28.11.2026): Navigation, Kopfzeile, Bereichsübersicht,
> Entscheidungskarte, Labor und Testverzeichnis wurden mit der 0.79-Shell
> abgeglichen. Die übrigen visuellen und Interaktions-Entwurfsabschnitte sind
> weiterhin der 0.78-Stand und keine vollständige Abnahme der aktuellen
> Oberfläche; siehe [Prüfstände](../entwicklung/PRUEFSTAENDE.md).

## Inhaltsverzeichnis

- [Navigation](#navigation)
  - [Kompakte Kopfzeile](#kompakte-kopfzeile)
- [Bereiche](#bereiche)
- [Tank-Guide: eine Frage, eine Antwort](#tank-guide-eine-frage-eine-antwort)
- [Übersicht: eine Antwort, ein Tipp in die Tiefe](#übersicht-eine-antwort-ein-tipp-in-die-tiefe)
- [Wochenblick: kein eigener Bereich](#wochenblick-kein-eigener-bereich)
- [Stationen: Atlas-Referenz und Server-Netto](#stationen-atlas-referenz-und-server-netto)
- [Labor: aktuelle Datenansichten](#labor-aktuelle-datenansichten)
- [Antwort, Begründung und Beweis](#antwort-begründung-und-beweis)
- [Urteilstöne und Elevation](#urteilstöne-und-elevation)
- [Zustände und Datenwahrheit](#zustände-und-datenwahrheit)
- [Mobil, Desktop und Barrierefreiheit](#mobil-desktop-und-barrierefreiheit)
- [Änderungen abnehmen](#änderungen-abnehmen)

## Navigation

Die aktuelle Kopfzeile (`web/src/components/layout/TopBar.tsx`) bietet
beschriftete Auswahlfelder für Stadt und Kraftstoff, den Profilwechsel, den
Datenstands-/Offline-Hinweis und „Daten aktualisieren“. Sie enthält weder den
früheren Kontext-Chip noch ein separates Auswahlblatt für diese Filter. Der
Tagesverlauf steht als Karte direkt auf der Übersicht; ohne Stadt- und
Stationsfilter bleibt er als ehrlicher Leerzustand sichtbar.

Die RP2-Leseausgabe (`web/rp2`) teilt Formatter, Theme-Helfer und Sheet-
Komponente mit der Vollversion, bleibt aber ausdrücklich beim lesenden
`pi-v1`-Vertrag. Navigation: Übersicht · Stationen · Mehr. Python bleibt
Server und Notausgabe, wenn kein React-Build installiert ist;
[Deployment](../betrieb/RP2.md#template-updates).

Die Desktop-Seitenleiste zeigt alle sechs Bereiche. Mobil bleiben Übersicht
und Stationen in der unteren Navigation direkt erreichbar; „Mehr“ öffnet die
übrigen Bereiche:

```text
Übersicht · Stationen · Mehr
├── Labor
├── System
├── Einstellungen
└── Glossar
```

Das mobile Bereiche-Blatt ist ein modales Dialogfenster mit Fokusführung.
Escape schließt es und stellt den Fokus am Menü-Auslöser wieder her. Auf dem
Desktop stehen dieselben Bereiche in der Seitenleiste.

Die kanonischen URLs sind `?tab=stationen`, `?tab=einstellungen`,
`?tab=labor`, `?tab=system` und `?tab=glossar`; beim Bereichswechsel bleiben
andere Query-Parameter und der Hash erhalten. `?section=…` wird derzeit nicht
als Sprungziel im Labor ausgewertet. Alte Links `?tab=woche`/`?tab=week`
führen zur Übersicht, `?tab=ich` zur Einstellungen-Seite. Das Update-Banner
bleibt global.

### Kompakte Kopfzeile

Die aktuelle Kopfzeile ist in `web/src/components/layout/TopBar.tsx` umgesetzt.
Sie zeigt Stadt und Kraftstoff immer direkt; Profil, Datenstand und
Aktualisieren stehen daneben. Unter 1024 px blendet CSS nur das Profilfeld aus,
damit die übrigen Steuerungen in schmalen Viewports erreichbar bleiben. Es gibt
hier kein Profil-und-Aktionen-Blatt und keinen Teilen-Knopf; Profilverwaltung
liegt in „Einstellungen“.

Die Responsive-Browserprüfung misst bei 390 px und 320 px, dass alle sechs
Hauptbereiche und die drei Einstellungen-Unterbereiche ohne horizontalen
Seitenüberlauf bleiben. Sie prüft außerdem, dass das modale Bereiche-Blatt per
Escape schließt und den Fokus an den Menü-Auslöser zurückgibt. Die alte
Abnahme der 80-px-Kopfzeile und der Antwort-Überschrift im ersten Viewport ist
kein aktueller Testvertrag.

## Bereiche

| Bereich | Verantwortung | Abgrenzung |
|---|---|---|
| Übersicht | Entscheidung, Tagesverlauf, fünf günstigste frische Stationen sowie Reichweiten- und Datenstatus | Ungefilterter Tagesverlauf bleibt ehrlich leer, wenn keine Tagesdaten vorliegen |
| Stationen | Karte, Liste, Frischfilter, Stationsreferenz und A-gegen-B-Vergleich | Server-Netto nur bei passender Referenz und bestätigten frischen Preisen |
| Einstellungen | Fahrzeug/Tankstand, Profile sowie Belege/Bilanz in drei Unterbereichen | Tankstand wird lokal gespeichert; Receipt-Schreibfehler 400 wird nicht in die Offline-Queue übernommen |
| Labor | Gütekennzahlen, Modell-Pipeline, Reliability-Bins, Prognose/Beobachtung, Heatmap und Tagebuch | Diagnoseansicht; keine Freigabe einer gesperrten Entscheidung |
| System | Jobs, Datenstand, Outbox-Synchronisierung, Exporte und API-Explorer | Betreiberfunktionen getrennt von den Alltagskarten |
| Glossar | Begriffe mit verständlicher Kurz- und Langform | Fachwörter erst erklären, dann vertiefen |

Die Übersicht (`web/src/features/overview/OverviewPage.tsx`) zeigt eine
Entscheidungskarte, die Tagesverlauf-Karte, eine Liste der fünf günstigsten
frischen Stationen und Reichweiten-/Datenstatus. Für einen ungefilterten Tag
ohne konkrete Stationsreferenz bleibt die Tageskarte sichtbar und zeigt den
ehrlichen Leerzustand; der Browservertrag dafür steht in
`web/e2e/demo.spec.ts`. Alte Woche-Links führen zur Übersicht. Die
Stationsseite ist der separate Ort für Atlas und Stationsdetails.

## Tank-Guide: eine Frage, eine Antwort

Die aktuelle Entscheidung wird von `web/src/features/overview/decision.ts`
aufbereitet und in `web/src/features/overview/OverviewPage.tsx` dargestellt.
Der Server bleibt maßgeblich: Ein gesperrter Datensatz darf weder eine
Handlung noch eine erwartete Ersparnis freigeben.

| Eingabezustand | Darstellung |
|---|---|
| `refuel_now` oder `wait` mit einer Primärentscheidung | Titel, Begründung, Preis, Station, Ablaufzeit und — nur falls geliefert — erwarteter Vorteil. „Route“ erscheint bei Kartenlink; sonst kann „Warum?“ die Begründung einblenden. |
| `decision_ready=false` oder `action=no_advice` | Neutrale Preisvergleichsvariante aus frischen Stationspreisen; kein erwarteter Vorteil und keine Handlungsfreigabe. Ohne frische Preise: „Keine Prognose“. |
| Backend offline | Neutrale Offline-Karte mit Hinweis, dass angezeigte Daten veraltet sein können; keine Handlung oder Ersparnis. |
| Keine Primärentscheidung / keine Overview-Antwort | „Keine Prognose“ ohne erfundenen Preis oder Stationsnamen. |

Die Branches sind in `web/src/features/overview/decision.test.ts` abgedeckt;
der Browserfall „gesperrt“ ist zusätzlich in `web/e2e/app.spec.ts` sichtbar.
Die Ablaufzeit wird als Berliner Uhrzeit oder Countdown dargestellt. Zahlen
werden über `web/src/utils/format.ts` mit deutscher Formatierung ausgegeben.

Der Tagesverlauf steht als eigene Karte direkt auf der Übersicht. Wenn keine
Punkte vorhanden sind, zeigt sie „Noch kein Tagesverlauf vorhanden.“; sie
erfindet weder Stunden noch Preise. Stationsangebote darunter kommen aus
frischen, endlichen Preisen. Ein globaler Statushinweis erklärt eine
Gesperrt- oder Offline-Situation ohne `role="alert"`.

### Labor: das Angebot bleibt freiwillig

Das Labor ist ein Angebot, kein Pfad zur Empfehlung — der Guide funktioniert
ohne jede Zahl von dort. Die früheren Beta-Blöcke (Einflüsse, Treffsicherheit,
Tankprofil-Rechner, Experimente) sind entfallen: Die Einflüsse ersetzt der eine
Satz in Block 2, die Treffsicherheit ist Block 1, die Tankprofil-Frage beantwortet
eine Zeile in „Einstellungen“ → Fahrzeug, und Experimente hatten keinen Nutzerpfad (§7).

## Übersicht: eine Antwort, ein Tipp in die Tiefe

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
| Was-wäre-wenn-Annahmen (Tankmenge, Zeitwert, Spätestens) | die App rechnet mit der Menge, die der Server nutzt (`used_liters`) | „Einstellungen“ → Fahrzeug |
| Feedback-Intents („Ich warte“), Fällig-Prompt | eine Bestätigung ist kein Beleg; Belege werden gepflegt, nicht bestätigt (Entscheidung 04.10.2026) | „Einstellungen“ → Belege und Bilanz |
| „Nächste Schritte“, drei Fakten, Benefit-Block | die Antwort steht oben; darunter stand dreimal dieselbe Zahl | „Warum?“ (≤ 5 Zeilen), Labor |
| „Heute im Blick“ mit 19 Zellen und Stundenbalken | die Entscheidung braucht kein Raster | Tageszeile, ein Tipp entfernt |
| Konfidenz-Balken, Prozentwerte | eine Prozentzahl ist keine Handlung | Sicherheit als **ein Wort** (`ziemlich sicher` · `eher sicher` · `unsicher` · `noch nicht messbar`) |
| Frische-Fußzeile unter der Ansicht | doppelter Ort für das Alter | Frische-Chip im Kopf |

Der Serververtrag bleibt unberührt: Intents, Fenster, p-Felder und
`regime_notice` werden weiter geliefert — die GUI zeigt weniger davon.

## Wochenblick: kein eigener Bereich

Seit 0.76.0 gibt es keinen eigenen Woche-Tab und keine separate Wochen-
Bestenliste in der Oberfläche. Die Entscheidungs-API behält `windows_week`
für kompatible Clients und Datenverträge; die App zeigt die Antwort im
Alltagsbereich „Übersicht“. Alte `?tab=woche`- und `?tab=week`-Links landen
auf dieser Übersicht, nicht auf einer leeren Seite.

Der Tankstand wird in der Übersicht nicht gepflegt. Die einzige Pflege-Stelle
ist „Einstellungen“ → „Fahrzeug“.

## Stationen: Atlas-Referenz und Server-Netto

Der Atlas verwendet genau eine Bezugsstation und zeigt sie sichtbar als
„Referenz“:

1. ausgewählte Station, sofern sie einen frischen Preis hat;
2. sonst die erste angeheftete Station mit frischem Preis;
3. sonst die nächste Station mit frischem Preis (Entfernung zum Zuhause-Anker).

Die gewählte ID geht im Stations-Tab als `station_id` an `/api/v1/overview`
(und damit an `/decide`). `primary.station.id` muss mit der lokalen
Referenz-ID übereinstimmen. Server-Netto, Umweg und Urteil erscheinen nur,
wenn zusätzlich `ref_price_fresh === true` vorliegt. Andernfalls zeigt die
Liste nur den Preisunterschied × Tankmenge („ohne Umweg“); Karte und A-gegen-B
bleiben ebenfalls beim Preisvergleich. Eine Alternative mit `last_price`
bleibt zulässig, trägt aber `price_fresh: false` und wird im Atlas als
„Serverpreis nicht frisch“ markiert. Die Serverantwort enthält höchstens fünf
Alternativen zusätzlich zur Referenz, absteigend nach `net_eur`.

## Labor: aktuelle Datenansichten

Die aktuelle Implementierung liegt in `web/src/features/lab/LabPage.tsx`;
`web/src/features/lab/logic.ts` übersetzt die Reliability-Bins der API in
Anzeige-Felder. Die Seite enthält:

- Kennzahlen zur empirischen Güte und Modell-Pipeline.
- Kalibrierungs-Bins; fehlende oder ungültige Werte bleiben leer statt durch
  erfundene Fallback-Zahlen ersetzt zu werden.
- Prognose-vs.-Ist-Sparkline mit Horizonten 24 h, 3 Tage und 7 Tage.
- Wochen-Heatmap, filterbares Prognose-Tagebuch und eingeklappte Parameter.

`web/src/features/lab/logic.test.ts` und der Browserfall in
`web/e2e/app.spec.ts` halten die Zuordnung `lo`/`hi`, `p`/`rate` und `n` fest.
Das aktuelle Labor hat keine alten drei `LAB_BLOCKS`, die Legacy-Subtabs oder
jene alten Sprung-IDs. `?section=…` bleibt beim URL-Bereichswechsel erhalten,
wird aber nicht als Scrollziel implementiert.

## Antwort, Begründung und Beweis

1. **Antwort:** eine klare Aussage mit handlungsrelevanten Zahlen.
2. **Begründung:** Datenalter, Quelle, Bedingungen und relevante Unsicherheit.
3. **Beweis:** gezielter Sprung in Labor, Diagramm oder Rohdaten.

Tooltips ergänzen bekannte Begriffe; sie ersetzen keine notwendige Erklärung.
Preise verwenden €/L, Differenzen ct/L, Tankbeträge €. Zeitangaben folgen
Europe/Berlin. Formatierung erfolgt über `web/src/utils/format.ts`; aktuelle
Entscheidungstexte werden von `web/src/features/overview/decision.ts`
abgeleitet. Fachliche Muster in [Microcopy](MICROCOPY.md) sind zum Stand
0.78 dokumentiert.

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
Tageszeile und Blätter bleiben flach (Tonal). Der Blick auf die Übersicht
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

Die Tests aus der alten `web/src/views/*`-Shell (`Jetzt.test.tsx`,
`Woche.test.tsx` und `web/src/microcopy.test.ts`) gehörten zu entfernten Views
und wurden im Frontend-Audit entfernt. Sie sind **keine** Regressionstests der
heutigen Oberfläche und ihre alten Ratchets sind keine aktuellen Zusagen.

Die aktuelle Shell wird stattdessen durch folgende aktive Tests abgedeckt:

- `web/src/routing.test.ts` und `web/e2e/app.spec.ts`: kanonische Routen,
  alter `ich`-Alias, Browser-History und aktive Navigation.
- `web/src/features/overview/decision.test.ts` sowie der gemockte Browserfall:
  eine gesperrte Entscheidung gibt weder Handlung noch erwartete Ersparnis
  frei.
- `web/src/api/client.test.ts` und `web/e2e/app.spec.ts`: ETag-Cache,
  `If-None-Match`/304 und Trennung der UI-Verträge.
- `web/src/settings.test.tsx` und `web/e2e/app.spec.ts`: aktuelle
  Einstellungen-Bereiche, lokaler Tankstand, Profilbearbeitung und -aktivierung,
  Kraftstoffwechsel, Stadt-/Kraftstoffpräferenzen und retrybare 503-Belegqueue
  (400 bleibt abgewiesen).
- `web/e2e/demo.spec.ts`, `web/e2e/mobile.spec.ts` und
  `web/e2e/failover.spec.ts`: echte Demo-Antworten, ehrlicher Tageszustand
  ohne Stadt-/Stationsfilter, Stationsnamen, schmale Layouts, mobile
  Fokuswiederherstellung und Outbox-Sync nach NAS-Rückkehr.

Die konkrete Browserabnahme und ihr Laufstand stehen in
[QUALITAET.md](../entwicklung/QUALITAET.md).
