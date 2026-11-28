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

## Inhaltsverzeichnis

- [Navigation](#navigation)
  - [Kompakte Kopfzeile](#kompakte-kopfzeile)
- [Bereiche](#bereiche)
- [Tank-Guide: eine Frage, eine Antwort](#tank-guide-eine-frage-eine-antwort)
- [Übersicht: eine Antwort, ein Tipp in die Tiefe](#übersicht-eine-antwort-ein-tipp-in-die-tiefe)
- [Wochenblick: kein eigener Bereich](#wochenblick-kein-eigener-bereich)
- [Stationen: Atlas-Referenz und Server-Netto](#stationen-atlas-referenz-und-server-netto)
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
Navigation: Übersicht · Stationen · Mehr. Python bleibt Server und Notausgabe,
wenn kein React-Build installiert ist; [Deployment](../betrieb/RP2.md#template-updates).

Seit 0.76.0 ist die Alltagsnavigation **2+1**:

```text
Übersicht
Stationen
Mehr / Studio
├── Labor
├── System
├── Einstellungen
└── Glossar
```

Mobil öffnet „Mehr“ ein nicht-modales Auswahlblatt; Escape schließt es und der
Fokus springt beim Öffnen auf die aktive Zeile. Der aktive Studio-Bereich ist
am Mehr-Eintrag markiert. Auf dem Desktop stehen dieselben Einträge in einer
Studio-Gruppe der Seitenleiste.

Die kanonischen URLs sind `?tab=stationen`, `?tab=einstellungen`,
`?tab=labor`, `?tab=system` und `?tab=glossar`; Labor-Abschnitte bleiben über
`?section=…` direkt erreichbar. Alte Links `?tab=woche`/`?tab=week` führen zur
Übersicht, `?tab=ich` zur Einstellungen-Seite. Alarm-Pille und Update-Banner
bleiben global.

### Kompakte Kopfzeile

Seit 0.75.0 (UX-Neuentwurf Batch 3 / C13) bleibt die Kopfzeile unter
1280 px eine Zeile: Marke, Stadt/Kraftstoff und ein aktiver Alarmstatus
(falls vorhanden). Der Kontext-Chip öffnet wie bisher die Auswahl für Stadt
und Kraftstoff. Profilwechsel und -verwaltung, Teilen und Aktualisieren
liegen gemeinsam hinter dem Knopf „Profil und Aktionen“ im gleichnamigen
Blatt. Die Steuerungen behalten ihre deutschen Namen und Touch-Ziele; beim
Öffnen liegt der Fokus im Blatt, Escape schließt es und gibt den Fokus an den
Auslöser zurück. Die Profilverwaltung schließt das Blatt zuerst, damit nie
zwei Dialoge ineinander liegen.

Ab 1280 px bleiben Profil, Alarm, Teilen und Aktualisieren direkt in der
Kopfzeile. Meldungen, Installationshinweise und ein verfügbares Update bleiben
im normalen Seitenfluss sichtbar — sie verschwinden nicht im Aktionsblatt.
Die 320 × 720-Abnahme hält die Kopfzeile bei höchstens 80 px; Stadt und
Kraftstoff sind im Prüfraster nicht abgeschnitten, die Antwort-Überschrift
steht im ersten Viewport und Hinweise bleiben sichtbar.

## Bereiche

| Bereich | Verantwortung | Abgrenzung |
|---|---|---|
| Übersicht | **Eine** Antwort („soll ich jetzt tanken?“), ein Euro-Betrag, eine Handlung und der heutige Verlauf | Keine drei Fakten, keine separate Woche-Ansicht, kein Was-wäre-wenn-Formular und keine zweite Stationsliste |
| Stationen | Karte, Liste, frische Referenz, Preisvergleich und A-gegen-B | Server-Netto nur bei passender Referenz-ID und bestätigtem frischem Referenzpreis; sonst reiner Preisvergleich |
| Einstellungen | Fahrzeug, Profile, **Tankstand (einziger Ort der Pflege)** und App-Kontext; „Belege und Bilanz“ als eingeklapptes Blatt (Verlauf und Bilanz laden erst beim Öffnen) | Bestätigungs-Intent ist kein Beleg; die Buchhaltung ist kein eigener Tab mehr |
| Labor | Drei Fragen: Kann ich vertrauen? · Wie gut ist die Prognose? · Wie rechnet die App? | Beweise statt Sammelakte; Rohdaten und CSV gehören dem Betreiber in „System“ |
| System | Konfiguration, Jobs, Archiv, Collector, Alarme, Outbox, **Rohdaten, CSV-Exporte und API-Explorer** | Interne Pfade und Betriebsbegriffe bleiben hier, nicht in Alltagskarten |
| Glossar | Begriffe mit verständlicher Kurz- und Langform | Fachwörter erst erklären, dann vertiefen |

Die Übersicht hält den Auftrag **eine Frage, eine Antwort — der Rest ein Tipp
entfernt**: Urteilskarte mit **einer** großen Zahl, ein gemeinsamer
Zeitraum-Rahmen („3 Tage zurück“ | „Heute“ | „Woche“) und die Top-5-Tabelle
nach effektivem Gesamtpreis — jede Zeile am Bestpreis der ersten gemessen.
Darunter steht „Alle X Stationen & Karte anzeigen“; Herleitung und Quellen
liegen im eingeklappten „Warum & Rechenweg“. Der eigene Wochen-Bereich ist
entfallen; alte Woche-Links landen hier. Der Stationen-Atlas
wählt seine Referenz aus frischen Preisen und zeigt Server-Netto nur, wenn
Server und UI dieselbe frische Referenz bestätigen.

## Tank-Guide: eine Frage, eine Antwort

Die Übersicht beantwortet genau eine Frage: **Soll ich jetzt tanken?**
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

## Labor: drei Fragen

Seit 0.77.0 ist das Labor **zweistufig** (`views/Labor.tsx`, Vokabular in
`lab.ts`): oben die Beweise ohne Klick, darunter die Erklärungen hinter einem
Tipp. Die drei Fragen selbst stehen unverändert genau einmal in `LAB_BLOCKS`.

**Oben — drei Karten, direkt sichtbar:**

| Karte | Inhalt |
|---|---|
| Wochen-Heatmap | Der Wochenrhythmus der Stadt; dieselbe Grafik wie im Betreiber-Block, hier als Beweis für die Alltagsfrage |
| Trefferquote und Kalibrierung | **Ein** Satz als Zählung („An 26 von 30 Tagen lag die Empfehlung richtig.“); daneben Trefferquote, Brier-Score und Zahl der bewerteten Empfehlungen, darunter die Reliability-Balken je Bin. Fehlende Kennzahlen stehen als `—`, nie als Null |
| Stations-Pool | Zahl der Stationen in der Auswahl und die fünf größten Preis-Abstände in ct/L |

**Darunter — „Warum & Rechenweg“ (zugeklappt), die drei Fragen:**

| Block | Frage | Inhalt |
|---|---|---|
| 1 · `#labor-sicherheit` | Kann ich vertrauen? | Der aufgeschlüsselte Zähler (richtig · daneben · unentschieden · nicht bewertbar) und das filterbare Prognose-Tagebuch (Alle/Richtig/Daneben/Unentschieden/Nicht bewertbar) |
| 2 · `#labor-prognose` | Wie gut ist die Prognose? | **Eine** Kurve (erwartet vs. echt, Blickweite 24 h/3 Tage/7 Tage) und **ein** Satz: „Im Schnitt 1,8 ct/L daneben.“ |
| 3 · `#labor-rechenweg` | Wie rechnet die App? | Drei Schritte in Alltagssprache (Tagesmuster der Stadt, aktuelle Lage, 12-Uhr-Regel); darunter „Details für Neugierige“ mit acht Bausteinen, Fachwerten und dem Wochenrhythmus |

Die Zählung steht **genau einmal** — oben in der Karte. Block 1 wiederholt sie
nicht, sondern schlüsselt sie auf. Ein `?section=…`-Sprung öffnet den Rahmen
automatisch und scrollt auf den zugehörigen Block.

Gestrichen und nicht wiederkehrend (§7): Sub-Tabs, Spielplatz-Regler,
Experimente, Tankprofil-Rechner, Einflüsse-Balken, CUSUM, die beiden
MASE-Werte, eingebettetes Glossar, Heatmap-Schalter und der Rohdatenraum.
Trefferquote, Brier-Score und Reliability-Balken sind **keine** Rückkehr des
alten Güte-Panels: Sie beantworten die erste Frage direkt, statt sie hinter
einen Tipp zu legen (`MICROCOPY.md` §4d). Rohdaten, die vier CSV-Exporte und
der API-Explorer stehen als Betreiber-Sicht in „System“ (Abschnitt
„Datenreichweite & Herkunft“ und `#rohdaten-section`); das Labor verweist nur
dorthin.

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

Die **historische** Abnahme von „Jetzt“ und „Woche“ seit 0.73.0 bleibt als Regression der ausgelagerten Komponenten dokumentiert; die aktuelle Navigation wird separat geprüft:

- **Sichtprüfung bei 390 px und auf dem Desktop:** die Antwort ist ohne
  Scrollen sichtbar, die Details liegen einen Tipp entfernt (§9).
- **Ratchets in `web/e2e/mobile.spec.ts`:** die Antwort-Überschrift endet
  im ersten Viewport, die Tageszeile ist zu, das „Warum?“ -Blatt trägt
  höchstens fünf Zeilen, der Fokus liegt beim Öffnen im Dialog.
- **Streichlisten in den Unit-Tests** (`views/Jetzt.test.tsx`,
  `views/Woche.test.tsx`): die in der Legacy-Komponente gestrichenen Bausteine kehren nicht zurück.
- **Microcopy-Ratchet** (`web/src/microcopy.test.ts`): genau fünf
  Antwort-Chips, Frische aus einem Baustein, keine abgelaufene
  Urteils-Headline.
