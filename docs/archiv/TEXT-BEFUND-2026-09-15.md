# TEXT-BEFUND — wo die Worte gegen das eigene Regelwerk laufen

> **Archiviert am 18.09.2026 · App-Version 0.54.0.** Lektorat zum Stand 0.38.0; die Befunde T1–T13 sind mit 0.39.0 umgesetzt. Das Dokument bleibt als Protokoll eingefroren. Verbindlich für neue Texte ist allein [MICROCOPY.md](../produkt/MICROCOPY.md).
>
> Stand: 15.09.2026 · App-Version **0.38.0** · Arbeitsdokument (Lektorat,
> keine Abnahme). Gelesen wurden alle sichtbaren Texte in `web/src/` (Views,
> Bausteine, `messages` in `data.ts`, Glossar) gegen
> [MICROCOPY.md](../produkt/MICROCOPY.md), dazu eine Randsichtung der
> Fallback-GUI (`rp2/fallback_gui.py`). Der strukturelle GUI-Befund steht in
> [GUI-UX-BEFUND.md](GUI-UX-BEFUND.md), die Aufgabenliste in
> [TODO.md](../planung/TODO.md).

## Inhaltsverzeichnis

- [1. Ausgangslage: das Regelwerk steht, der Befund ist die Abweichung](#1-ausgangslage-das-regelwerk-steht-der-befund-ist-die-abweichung)
- [2. Befunde](#2-befunde)
  - [T1 — Die Wochenlinie sagt das Gegenteil dessen, was sie zeichnet](#t1--die-wochenlinie-sagt-das-gegenteil-dessen-was-sie-zeichnet)
  - [T2 — Der Aktions-Kanal zeigt Fehler im Erfolgs-Gewand](#t2--der-aktions-kanal-zeigt-fehler-im-erfolgs-gewand)
  - [T3 — „Tankmenge“ ist zwei Größen, und der Fehlertext lügt über die Eingabe](#t3--tankmenge-ist-zwei-größen-und-der-fehlertext-lügt-über-die-eingabe)
  - [T4 — „A gegen B“: der Satz nennt beide Seiten, gemeint ist eine](#t4--a-gegen-b-der-satz-nennt-beide-seiten-gemeint-ist-eine)
  - [T5 — Das Tagebuch bricht die eigenen Ergebnis-Worte](#t5--das-tagebuch-bricht-die-eigenen-ergebnis-worte)
  - [T6 — Eine Größe, viele Namen](#t6--eine-größe-viele-namen)
  - [T7 — Ausgemusterte Wörter leben weiter](#t7--ausgemusterte-wörter-leben-weiter)
  - [T8 — Anglizismen im Fließtext, wo der deutsche Primärlabel versprochen ist](#t8--anglizismen-im-fließtext-wo-der-deutsche-primärlabel-versprochen-ist)
  - [T9 — Pfade, Endpunkte und Repo-Verweise im Nutzertext](#t9--pfade-endpunkte-und-repo-verweise-im-nutzertext)
  - [T10 — Anrede und Ton: die Regel sagt vermieden, die GUI sagt du](#t10--anrede-und-ton-die-regel-sagt-vermieden-die-gui-sagt-du)
  - [T11 — Zähl- und Einheits-Worte driften](#t11--zähl--und-einheits-worte-driften)
  - [T12 — Frage und Antwort passen nicht zusammen, und Doppelungen](#t12--frage-und-antwort-passen-nicht-zusammen-und-doppelungen)
  - [T13 — Kleinschliff: Einzelfunde mit Beleg](#t13--kleinschliff-einzelfunde-mit-beleg)
- [3. Priorisierte Arbeitsliste](#3-priorisierte-arbeitsliste)
- [4. Was schon richtig ist](#4-was-schon-richtig-ist)

## 1. Ausgangslage: das Regelwerk steht, der Befund ist die Abweichung

Die TankApp ist im Text weiter als die meisten Apps:
[MICROCOPY.md](../produkt/MICROCOPY.md) regelt Tonfall, Zeichen, Einheiten und
Zustandssätze, `web/src/data.ts` zwingt Zahlen durch Formatter, und
`web/src/microcopy.test.ts` prüft Anführungszeichen als Ratchet. Genau deshalb
fallen die Abweichungen unten auf: Es sind keine Stilfragen, sondern Stellen,
wo die GUI vom eigenen Regelwerk abweicht — oder wo das Regelwerk selbst eine
Frage offen lässt, die jede View anders beantwortet.

Alle Zeilenangaben beziehen sich auf den Stand 0.38.0 (`49e849c`, der
Doku-Stand von [GUI-UX-BEFUND.md](GUI-UX-BEFUND.md)). Der Ratchet prüft heute
nur paare `„…“` und fehlende HTML-Entities — er sieht keine der folgenden
Abweichungen. Zwei Befunde (T1, T2) sind keine Schönheitsfehler: Sie lassen
Nutzer:innen das Falsche lesen bzw. lesen Fehler wie Erfolge.

## 2. Befunde

### T1 — Die Wochenlinie sagt das Gegenteil dessen, was sie zeichnet

`web/src/views/Woche.tsx:117` baut die Wochenlinie so, dass der **höchste
Balken der teuerste** Tag ist (`height = 10 + ((value - min) / span) * 34` —
der günstigste erwartete Preis bekommt den kürzesten Balken). Die Legende
dazu, `web/src/views/Woche.tsx:438`, behauptet das Gegenteil:

```
Balken = günstigster erwarteter Preis des Tages (höher = günstiger)
```

Wer der Legende folgt, hält den teuersten Tag für den besten. Der
`aria-label` der Linie (`Woche.tsx:111`, „Wochenlinie: beste erwartete Preise
je Tag“) nennt die Richtung ebenfalls nicht — das Bild ist damit auch für
Screenreader mehrdeutig.

**DoD:** Eine Richtung, überall dieselbe. Entweder Legende zu
„höher = teurer“ korrigieren, oder die Karte drehen (`max - value`), damit
„höher = günstiger“ stimmt; `aria-label` und `title` nennen dieselbe Richtung.
Ein Test in `Woche.test.tsx`, der günstigster Tag ↔ Balkenhöhe festhält.

### T2 — Der Aktions-Kanal zeigt Fehler im Erfolgs-Gewand

Alle Meldungen der Aktionen (Beleg buchen, Empfehlung bestätigen, Intent,
Storno) laufen in `setActionFeedback` und landen in **einem** Banner:
`web/src/Dashboard.tsx:1743` — grüne Tonalität, `CheckCircle2`-Häkchen,
`role="status"`. In dem Banner stehen auch Ausfälle:

- `„! Speichern fehlgeschlagen: … – bitte erneut versuchen.“`
  (`Dashboard.tsx:1345,1397`) und
  `„! Auswahl speichern fehlgeschlagen: … – App-Server erreichbar?“`
  (`Dashboard.tsx:1466`) erscheinen mit grünem Häkchen-Icon.
- Die Texte tragen die Präfixe `!` und `✓` als Text (`Dashboard.tsx:1315,
  1321, 1350, 1371, 1408–1409, 1470`), während das Icon daneben dieselbe
  Aussage schon visuell macht — dreifache Kodierung desselben.
- Vier Meldungen enden auf Ausrufezeichen
  („… verbucht!“, „… gespeichert!“), gegen [MICROCOPY §1](../produkt/MICROCOPY.md#1-tonfall)
  („Kein Ausrufezeichen im Fließtext“).
- Dieselbe Rolle mischt Begründungs-Zeichen: „— bitte manuell erfassen.“
  (`Dashboard.tsx:1315`) steht neben „– bitte erneut versuchen.“
  (`Dashboard.tsx:1345`) — Halbe- und Geviertstrich im selben Atemzug, §2
  reserviert `–` für Bereiche.

**DoD:** Feedback mit Ton-Flag (`ok`/`warn`/`error`); Fehlerbanner in
amber/rose mit `AlertTriangle` und `role="alert"`, `✓`/`!`-Präfixe entfallen,
Ausrufezeichen weg, durchgehend `—` als Einschub. Die `InstallHint`- und
Queue-Notizen, die denselben Kanal teilen, ziehen mit.

### T3 — „Tankmenge“ ist zwei Größen, und der Fehlertext lügt über die Eingabe

Dasselbe Wort, drei Spannen:

| Stelle | Benennung | Spanne |
|---|---|---|
| Profil-Slider „Deine Tankmenge“ (`views/Settings.tsx:176`) | Tankmenge | 10–80 L, Schritt 1 |
| Was-wäre-wenn in „Jetzt“ (`views/Jetzt.tsx:299–306`) | Tankmenge | 10–80 L |
| Beleg-Erfassung (`data.ts:1283`, `FILL_LIMITS`) und Server (`data.ts:2435`, „Tankmenge außerhalb 5–100 Liter.“) | Tankmenge/Liter | 5–100 L, Schritt 0,5 |

Dazu der Fehlertext `„Tankmenge: ganze Zahl zwischen 10 und 80 L.“`
(`views/Jetzt.tsx:303`): Der Code akzeptiert `12,5` durchaus — er rundet still
auf 13 (`Jetzt.tsx:307`, `Math.round`). Der Text verbietet also, was die
Eingabe ruhig schluckt, und das Ergebnis (13 statt 12,5) wird nicht zurück
gemeldet. Einheiten-Schreibweise schwankt zusätzlich: „Liter“ (Server-Text)
gegen „L“ (GUI-Hinweise).

**DoD:** Zwei Benennungen, zwei Spannen — die Rechengröße im Profil/„Jetzt“
(z. B. „Tankmenge“, 10–80) und der gebuchte Vorgang im Beleg („Liter getankt“,
5–100); Fehlertext sagt, was gilt (Nachkommastellen ja/nein), die Ansicht
zeigt den gerundeten Wert; einheitlich „L“. MICROCOPY §3 hält beide Spannen
fest.

### T4 — „A gegen B“: der Satz nennt beide Seiten, gemeint ist eine

`web/src/stations.ts:313` im Vergleich A gegen B:

```
Noch kein frischer Preis auf beiden Seiten — der Vergleich steht mit der
nächsten Meldung.
```

Der Zweig greift, wenn **eine** der beiden Stationen keinen Preis hat
(`priceA === null || priceB === null`) — der Satz behauptet aber, beide Seiten
seien ohne Preis. Wer sieht, dass A einen frischen Preis zeigt, hält den Satz
für falsch.

**DoD:** Satz unterscheiden: eine Seite fehlt → „<A> hat keinen frischen
Preis — der Vergleich steht mit der nächsten Meldung.“; beide fehlen →
bestehender Satz. Testfall mit gemischtem Set.

### T5 — Das Tagebuch bricht die eigenen Ergebnis-Worte

[MICROCOPY §4c](../produkt/MICROCOPY.md#4c-bereich-labor-feste-muster) legt fest:
Ergebnis-Worte des Tagebuchs sind `richtig` · `daneben` · `unentschieden` ·
`nicht bewertbar` — „nie „Treffer“, nie „Fehler““. Die Einträge halten das
ein (`lab.ts:172–196`). Dasselbe Panel widerspricht sich selbst:

- Die Filter-Chips heißen `„Treffer“` und `„Fehler“`
  (`views/Labor.tsx:1031–1032`) — genau die verbotenen Wörter, im selben
  Panel über derselben Liste.
- Der Einführungssatz sagt „verbucht Richtig, Daneben oder **Gleichstand**“
  (`Labor.tsx:1019`) — der dritte Wert heißt in den Einträgen
  „unentschieden“ (`lab.ts:186`), eine dritte Variante.
- `diaryActionWord` nennt den Grau-Zustand „Keine Empfehlung“
  (`lab.ts:160`), die Ampel-Karte sagt „Keine klare Empfehlung“
  (`now.ts:356`).

**DoD:** Filter-Chips auf die §4c-Worte („Richtig · Daneben · Unentschieden ·
Nicht bewertbar“), Einführungssatz ebenso; „Keine klare Empfehlung“ als ein
Label überall. Ratchet: die Liste der erlaubten Ergebnis-Worte in
`microcopy.test.ts` gegen `lab.ts` prüfen.

### T6 — Eine Größe, viele Namen

Derselbe Wert trägt je Panel einen anderen Namen — der Klassiker für „weiß
nicht wieso“, nur in Text:

| Größe | Name A | Name B (und C) |
|---|---|---|
| Heatmap-Modus „Anteil günstiger Preise“ | „Günstig-Chance“ (`views/Labor.tsx:905`) | „Cheap-Probability: …“ als Caption-Anfang (`components/HeatmapGrid.tsx:292–295`), „Heatmap Cheap-Prob“ (`components/ApiExplorer.tsx:51`) |
| δ̂ | „Preis-Abstand“ (Glossar, `data.ts:3442`) | „Hauspreis-Abstand“ (`views/Labor.tsx:860,882,989`) |
| Regret | „Mehrkosten zur perfekten Sicht“ (Glossar, `data.ts:3482`) | „Ø Entscheidungsverlust“ (`views/Labor.tsx:1168`) |
| Orakel-Bestwert | „Perfekte Sicht (Orakel)“ (`views/Labor.tsx:1160`) | „Perfektes Timing (Orakel)“ (`Labor.tsx:1339`) — letzteres ist das Muster aus §4c |
| System in Ordnung | „OK“ (Header-Pill, `Dashboard.tsx:1605`) | „Alles ok“ (`system.ts:275`), „System in Ordnung — keine Alarme“ (Tooltip, `Dashboard.tsx:1581`) |

**DoD:** je Größe ein Name, gepflegt im Glossar (`GLOSSARY`) und als
Benennung in MICROCOPY §4; Caption- und Select-Texte ziehen nach. Ein Test
kontra Doppelbenennung (Liste verbotener Synonym-Paare im Ratchet).

### T7 — Ausgemusterte Wörter leben weiter

[MICROCOPY §4](../produkt/MICROCOPY.md#4-benennungen) sagt: Die alten Tabs heißen nicht
mehr „Statistik“, nicht „Prüfstand“, „Alltag“ ist ersetzt. In sichtbaren
Texten stehen sie trotzdem:

- „Prüfstand“: `views/Labor.tsx:876,1135,1246,1366,1395,1492,1620` („Werte
  aus dem Prüfstand …“, „Ohne Prüfstand-Tage keine Bilanz …“), dazu
  `data.ts:2455` („Noch kein Prüfstand-Ergebnis veröffentlicht.“) und der
  Glossar-Langtext `data.ts:3476`. Acht Bednungen in dem Bereich, der laut
  Entwurf ausdrücklich alltagssprachlich erklärt.
- „Statistik“: `views/Labor.tsx:1637` („Statistik nicht geladen“),
  `views/Settings.tsx:477` („Die Statistik mit den aktiven Schwellen …“) und
  `:569` („Noch keine Statistik geladen …“) plus Retry-Knopf „Statistik neu
  laden“ (`Settings.tsx:480`).
- „Alltag“: `views/Labor.tsx:517` — der Rückfall-Knopf ohne Herkunft heißt
  „Zurück zum Alltag“.
- „Buchung“: `views/Ich.tsx:540` („die Bilanz füllt sich mit jeder
  Buchung unter „Belege““) — §4 sagt ausdrücklich nicht „Buchung“.

Gemeint ist jeweils der Nachfolger: Backtest, `stats/summary`, die Bereiche
„Jetzt/Ich“ und der Beleg. Entweder die Worte sind ersatzlos zu ersetzen —
oder §4 muss „Prüfstand“ als Fachwort des Backtests registrieren; beides ist
besser als der Halbstand.

**DoD:** Entscheidung in §4, danach Ersatz in allen oben genannten Zeilen
(z. B. „Backtest“, „Schwellen der Engine“, „Zurück“, „mit jedem Beleg“);
verbotene Wörter als Liste in `microcopy.test.ts`.

### T8 — Anglizismen im Fließtext, wo der deutsche Primärlabel versprochen ist

§1: „Deutsch als Primärlabel, Fachwort im Tooltip“. Das „Nein“-Beispiel der
Regel („Cheap-Probability“ als sichtbares Label) steht wörtlich im GUI:

- `components/HeatmapGrid.tsx:292–295` beginnt die sichtbare Erklärung mit
  „Cheap-Probability: Anteil der Preise …“ — während das Auswahlfeld
  daneben „Günstig-Chance“ sagt (siehe T6).
- „Peak“/„offpeak“ als sichtbare Zustandsworte: `views/Jetzt.tsx:571`,
  `views/Stationen.tsx:431`, `views/Settings.tsx:268` („0 = Auto: 16 €/h im
  Peak (16:30–20:00), sonst 10 €/h.“).
- „LIVE“-Badge im Header (`Dashboard.tsx:1491`) — ein englisches Wort ohne
  Erklärung, dessen Bedeutung (Live-Polling aktiv) sich nur das Team
  erschließt.
- `views/Labor.tsx:1131`: „Bilanz der Ratschläge (12 Tage out-of-sample)“ —
  Fachwort ohne deutschen Primärlabel und ohne Tooltip.

**DoD:** deutsches Label vorne, Fachwort in Klammern/Tooltip: „Stoßzeit
(Peak)“ bzw. schlicht „Hauptverkehrszeit“, „Außerhalb der Stichprobe
(out-of-sample)“, Caption „Günstig-Chance: Anteil der Preise …“; „LIVE“
entfällt oder wird zum beschrifteten Zustand („Preise live“).

### T9 — Pfade, Endpunkte und Repo-Verweise im Nutzertext

§6 verbietet Pfade und URLs im Text. Im GUI stehen sie mehrfach — mit einer
echten Ausnahmefrage:

- `data.ts:2383` (`polling_missing`): „… Auf dem Pi
  `data/analysis/stations/polling.json` erzeugen (docs/betrieb/INSTALL.md Abschnitt
  Polling-Set), auf dem NAS `TANKAPP_POLLING_FILE` prüfen
  (ops/nas/app/compose.yml → /config/polling.json RO) und
  ops/nas/preflight.sh ausführen.“
- `views/System.tsx:405–409`: derselbe Vorgang als eigener Absatz — mit
  ASCII-Pfeil `compose.yml -> /config/polling.json` statt `→` und zweiter,
  abweichender Formulierung zur `messages`-Variante (Drift vorprogrammiert).
- `system.ts:377,424,427,444`: Herkunftszeilen wie „Grundlage:
  `/api/v1/health` und `/api/v1/collector/status` …“ und
  „`data/runtime/jobs/<job>.log`“.
- `views/Settings.tsx:466`: „read-only · Quelle: /api/v1/stats/summary“.
- `views/Glossary.tsx:62,80`: Repo-Verweise „docs/referenz/ANALYSE.md#…“ und
  „docs/produkt/KONZEPT.md §4 · §5 · §8“ als sichtbare Zeilen.
- `views/Stationen.tsx:924`: „Quelle: decide → alternatives_nearby
  (Server-Netto-€ inkl. Umweg)“ — JSON-Felder im Alltagstext.
- Meta-Sätze über frühere GUI-Stände: „dieselben Endpunkte wie **die alte
  System-Ansicht**“ (`system.ts:377`), „wie im **alten System-Tab**“
  (`system.ts:427`) — die Nutzer:innen der App kennen die alte Ansicht nicht;
  Vergleiche mit Vorversionen gehören in Doku, nicht in den GUI-Text.

Die Einrichtungshilfen in „System“ sind der legitime Grenzfall: Genau dort
braucht ein Betreiber die Datei-Namen. Aber dann als Regel, nicht als
Ausnahme im Widerspruch zum §6.

**DoD:** §6 präzisieren („Pfade nur im System-Bereich, in Einrichtungs- und
Diagnose-Texten; sonst nie“), die Doppel-Fassung `polling_missing` /
System-Absatz auf einen Text zusammenziehen, `->` → `→`, JSON-Feld-Quellen in
den `title`-Tooltip verschieben, Meta-Sätze über die „alte“ Ansicht streichen.

### T10 — Anrede und Ton: die Regel sagt vermieden, die GUI sagt du

§1: „Sie/Du wird vermieden — die App spricht über die Sache, nicht über den
Nutzer.“ Die GUI redet den Nutzer durchgehend mit „du“ an, und das Regelwerk
selbst legitimiert den Possessiv (feste Muster wie „Prinzip-Skizze — nicht
deine Daten“, §4c). Tatsächlich im Text:

- Direkte Fragen: „Hast du getankt?“ (`views/Jetzt.tsx:362`),
  „Gerade getankt?“ (`views/Ich.tsx:305`).
- Kipp-Satz: „Kippt zu „Jetzt“, wenn du vor 18:00 Uhr tanken musst.“
  (`now.ts:698`).
- Imperativ: „fahr nur hin, wenn du ohnehin an der Station vorbeikommst.“
  (`views/Settings.tsx:306–308`), „Vergleiche E5-Preise nur mit E5, nie mit
  E10.“ (`Dashboard.tsx:1765`).
- Durchgängiger Possessiv: „deiner Bilanz“, „deine Tankbelege“
  (`views/Ich.tsx`), „deiner … Stationen“ (`stations.ts:236–237`), „dein
  Profil bleibt unangetastet“ (`views/Jetzt.tsx:526`), „in deinem Tempo“
  (`views/Labor.tsx:502`).

Das ist kein Wildwuchs, sondern eine Entscheidung, die nie ins Regelwerk
geschrieben wurde: Die App duzt per Possessiv, meidet aber (fast) die direkte
Anrede — bis auf die vier Stellen oben.

**DoD:** §1 präzisieren (Vorschlag: „Possessiv erlaubt — direkte Anrede und
Imperativ bleiben außen; Fragen nur im Due-Prompt“), dann die vier Stellen
entscheiden: Due-Prompt-Frage registrieren oder in Aussagesätze drehen
(„Tankstand eintragen — der Beleg landet in der Bilanz.“).

### T11 — Zähl- und Einheits-Worte driften

- Der gebuchte Tankvorgang heißt `Beleg` (§4) — und daneben „Füllung“
  (`Dashboard.tsx:1337,1350` gegen `:1390,1408` im selben Handler-Verbund;
  „1 Füllung“ `views/Ich.tsx:559`, „pro Füllung“ `stations.ts:324`),
  „Tankbeleg“ (Überschrift „Deine Tankbelege“ `views/Ich.tsx:370` gegen
  Nav-Punkt „Belege“; `data.ts:2429–2433`) und „Tankung“
  (`views/Labor.tsx:1017`).
- „Ersparnis“ steht für unterschiedliche Messungen mit unterschiedlichen
  Vorzeichen: Liste „Alle Fenster nach Ersparnis“ zeigt Erwartetes **mit
  Minus** (`Woche.tsx:444,470` — „−1,6 €“ heißt hier: so viel günstiger),
  die Beleg-Tabelle zeigt Erreichtes **mit Plus**
  (`views/Ich.tsx:411`, „+0,8 €“ = günstiger), das Labor rechnet „S“ mit
  Vorzeichen (`Labor.tsx:1462`). „Jetzt“ meidet das Wort bewusst
  (`now.ts`, „… wird nie „Ersparnis“ genannt“) — die Regel dafür steht nur im
  Code-Kommentar, nicht im Regelwerk.
- Altersangaben: „vor 12 Min.“ (`views/Stationen.tsx:349`) gegen „vor 12
  Minuten“ (`data.ts:2701`, `ageLabel`) — beide in derselben Ansicht; „≤ 30
  Min. alt“ (`views/System.tsx:455`).
- Klein: „Reserve (5 l)“ (`views/Settings.tsx:226`) — das einzige kleine „l“;
  „Werktag / WE/Feiertag“ (`components/LabCharts.tsx:386`) gegen
  „Wochenende/Feiertag“ (`views/Labor.tsx:1290`).

**DoD:** §4 ergänzen: genau ein Wort für den gebuchten Vorgang („Beleg“,
abgeleitet „Tankbeleg“ nur als Überschrift-Form oder gar nicht); „Ersparnis“
entweder verbannen oder festschreiben (Betrag ohne Vorzeichen, Richtung
steht im Wort — „1,60 € günstiger“); Alter überall über `ageLabel`,
Einheiten über §3. Die `-Zeile „Füllung“ in `Dashboard.tsx` auf „Beleg“
ziehen — derselbe Dialog sagt heute beides.

### T12 — Frage und Antwort passen nicht zusammen, und Doppelungen

- Der Knopf fragt „Warum diese Reihenfolge?“ (`views/Stationen.tsx:976`), das
  Sheet antwortet unter dem Titel „Warum ist die Liste so sortiert?“
  (`Stationen.tsx:992`) — zwei Fragen für dieselbe Erklärung.
- Im Labor-Kopf steht „Zurück zu: …“ doppelt: einmal als Absatz
  (`views/Labor.tsx:506–509`), einmal als Knopf-Beschriftung (`:517`) —
  dieselbe Information zwei Male untereinander.
- Der Abdeckungs-Satz verdoppelt sich selbst: „Keine offene Meldung in
  06–24 Uhr — das Polling-Fenster läuft von 06 bis 24 Uhr.“ (`now.ts:884`)
  — Headline darüber sagt es schon (`now.ts:876`), und „in 06–24 Uhr“ ist
  schief (§4a-Muster: „das Polling-Fenster ist 06–24 Uhr“).
- Das Glossar trägt drei Namen: Nav „Glossar“, Kicker „Hilfe · Nachschlagen“
  + Titel „Was heißt das?“ (`views/Glossary.tsx:15–19`), Footer-Knopf
  „Glossar — was heißt das?“ (`Dashboard.tsx:2128–2134`). Dass es als
  Haupt-Tab fehl am Platz ist, steht in [GUI-UX-BEFUND U3](GUI-UX-BEFUND.md#u3--navigation-ein-pillen-streifen-statt-der-entworfenen-raster) — hier geht es um den Namen.
- Dieselbe Aktion, zwei Wörter: Tankstand-Schnellauswahl zurücknehmen heißt
  „Keine Angabe“ (`views/Woche.tsx:256`) und „ausblenden“
  (`views/Jetzt.tsx:786`).

**DoD:** Knopf und Sheet-Titel aus einer Quelle (dasselbe Feld wie
`labHint`); Origin-Zeile oder Knopf, nicht beides; Coverage-Satz auf das §4a-
Muster kürzen; ein Name für das Glossar („Glossar“), ein Wort für das
Zurücknehmen.

### T13 — Kleinschliff: Einzelfunde mit Beleg

| Stelle | Befund | Schliff |
|---|---|---|
| `views/Woche.tsx:377` | „Schwellen in des Labors“ — Grammatik | „Schwellen im Labor“ |
| `views/Woche.tsx:378` | „(entsättigt)“ — Fachwort ohne Erklärung im Alltagstext | streichen oder „noch unsicher“ genügt |
| `views/Settings.tsx:596,601` | „Dunkles Slate (Standard)“ / „Hell (Slate)“ — Tailwind-Farbname im GUI | „Dunkel (Standard)“ / „Hell“ |
| `views/Settings.tsx:208` | „4–15 L/100 km · Feld: 6,3 möglich“ — „Feld“ ist unverständlich | „Kommastellen erlaubt (z. B. 6,3)“ |
| `views/Settings.tsx:306` | „Bei 12 €/h Zeitwert …“ — nennt einen konkreten Wert, unabhängig vom eingestellten Regler | Zahl an den aktiven Zeitwert koppeln oder als Beispiel kennzeichnen |
| `now.ts:563,568` | „Preise kein Stand“ — holprig gegen „Kein Datenstand — noch nichts gemeldet“ (`now.ts:552`) | „Preise — kein Stand“ oder das `—`-Muster aus §4a |
| `views/Stationen.tsx:347–349` | „Stand veraltet“, „vor 12 Min.“ | „veralteter Stand“, Alter über `ageLabel` |
| `stations.ts:237` | „Gerade 2.-günstigste deiner …“ — Artikel fehlt | „Gerade die Zweitgünstigste deiner …“ |
| `views/Ich.tsx:78` | „Gleichauf mit dem Median deines Sets — fair.“ — „fair“ bewertet (§1: Zustände benennen, nicht bewerten) | Punkt streichen |
| `Dashboard.tsx:1762–1765` | E5-Banner: „~1–2 %“ (`~` statt `≈`), „p_E5 ≤ ~1,015 · p_E10“ — `·` als Malzeichen, §2 reserviert `·` als Trenner; `p_E5`-Schreibweise ohne Klartext | „≈“, „×“ als Malzeichen, Größen benennen („E5-Preis ≤ 1,015 × E10-Preis“) |
| `Dashboard.tsx:1495` | Tagline „Dein Tank-Kompass. Ohne Rätselraten.“ — Hook-Zeile im §6-Sinn, nicht im Regelwerk registriert | registrieren oder streichen |
| `components/LabCharts.tsx:386,395` | Prozente im Tooltip über `(p * 100).toFixed(0)` statt `percentLabel` (Ratchet-Geist, §3) | `percentLabel` nutzen |
| `views/System.tsx:407` | ASCII-Pfeil „->“ | „→“ |
| `views/System.tsx:460` | `InfoTooltip`-Label „Unterschieden“ (Begriff) | „Unterschied“ |
| `rp2/fallback_gui.py:722` | Emoji „🔄 NAS prüfen“ im Fehlertext — §1 verbietet Emoji im Text | Icon ins Markup, Text ohne Emoji |
| `rp2/fallback_gui.py:1268` | „jetzt tanken ist okay“ — Tonfall (§1: benennen, nicht bewerten) | „— jetzt tanken passt.“ oder §4a-Muster ergänzen |

**DoD:** je Zeile ein Einzeiler; die Formatter- und Tonfall-Punkte in die
beiden Ratchets aufnehmen (`microcopy.test.ts`: Wortliste, Ausrufezeichen;
`format-convention.test.ts`: Dateiliste um `LabCharts.tsx`-Tooltips erweitern
bzw. `toFixed`-Ausnahme für SVG-Koordinaten bestätigen).

## 3. Priorisierte Arbeitsliste

| # | Prio | Aufgabe | Warum zuerst |
|---|---|---|---|
| T1 | **P0** | Wochenlinie: Text und Bild in eine Richtung bringen | die Legende lässt Nutzer:innen den teuersten Tag für den besten halten |
| T2 | **P0** | Feedback-Kanal: Ton-Flag, Fehlerbanner, Präfixe und Ausrufezeichen raus | Fehler sehen aktuell wie Erfolge aus |
| T3 | **P0** | „Tankmenge“: zwei Größen benennen, Fehlertext an das Verhalten koppeln | derselbe Begriff mit drei Spannen, Fehlermeldung beschreibt ein Verbot, das nicht existiert |
| T4 | **P0** | „A gegen B“-Satz auf eine/beide Seiten unterscheiden | Ein-Satz-Fix mit sichtbarem Effekt |
| T5 | **P1** | Tagebuch-Worte auf §4c bringen (Filter, Einführungssatz) | das Panel widerspricht dem Regelwerk im selben Atemzug |
| T6 | **P1** | Namens-Entscheidung je Größe (Glossar + §4), Captions/Selects nachziehen | drei Namen für eine Größe sind teurer als die Entscheidung |
| T7 | **P1** | „Prüfstand“/„Statistik“/„Alltag“/„Buchung“ ersetzen oder in §4 registrieren | ausgemusterte Wörter, die lebendig sind, machen die Benennung unglaubwürdig |
| T8 | **P1** | Anglizismen: deutsche Primärlabels, Fachwort in den Tooltip | das wörtliche „Nein“-Beispiel der eigenen Regel steht im GUI |
| T9 | **P1** | §6 präzisieren (Ausnahme System), Doppeltexte zusammenziehen, Meta-Sätze streichen | Pfad-Texte sind im System legitim, im Alltagstext Lärm |
| T10 | **P2** | Anrede-Regel in §1 klären, vier Stellen entscheiden | die Regel stimmt heute mit sich selbst nicht |
| T11 | **P2** | Wort-Familien festziehen (Beleg, Ersparnis-Vorzeichen, Alter, Einheiten) | Einzeln klein, zusammen ergibt es das Gefühl „verschiedene Autoren“ |
| T12 | **P2** | Frage-Antwort-Paare und Doppelungen auflösen | Leseführung ohne Kosten |
| T13 | **P2** | Kleinschliff-Tabelle abarbeiten, Ratchets erweitern | jede Zeile ein Einzeiler |

Die Liste ist bewusst noch nicht als Tabellenzeilen in [TODO.md](../planung/TODO.md)
unter C — das gehört mit der ersten Umsetzung zusammen rein. Anders als
[U1–U8](GUI-UX-BEFUND.md#3-priorisierte-arbeitsliste) sind die meisten Punkte
hier Einzeiler ohne strukturellen Eingriff: Der Aufwand liegt im Treffen der
Benennungen, nicht im Code.

## 4. Was schon richtig ist

Damit das Bild nicht zerrt: Die Zustands-Sprache aus §5 ist breit real —
Skeleton-Labels („Empfehlung wird berechnet“, „Fenster werden berechnet“),
`LoadError` mit Klartext, Rohcode und „Erneut laden“, `Empty` mit Grund statt
Entschuldigung. Der Satz „Kein Datenstand — noch nichts gemeldet“ steht
wortgleich in `now.ts:552`, `stations.ts:396` und `system.ts:343`. Die
Frische-Fußzeile sitzt in allen vier Alltagsbereichen am festen Platz, die
S0-Zustände erklären drei Schritte statt zu schreien, „—“ mit Grund
(„Tankstand nicht gepflegt“, „Heute kein Fenster mit Vorsprung“) ist
durchgehalten, und der Anführungszeichen-Ratchet ist grün. Die Befunde oben
sind Abweichungen von einem hohen Standard — genau deshalb lohnt es sich,
sie zu glätten, statt neue Muster neben den alten zu erfinden.
