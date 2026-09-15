# GUI-TEXT-BEFUND — was die Oberfläche sagt und wie sie es sagt

> Stand: 15.09.2026 · App-Version **0.38.0** · Arbeitsdokument (Vermessung,
> keine Abnahme). Gemessene Basis: `web/src` (ohne Tests), `rp2/fallback_gui.py`
> und ein laufender Demo-Stack (Port 1357). Maßstab ist
> [MICROCOPY.md](MICROCOPY.md); die Bedienbarkeit steht in
> [GUI-UX-BEFUND.md](GUI-UX-BEFUND.md) (U1–U8), der Konzept-Abgleich in
> [LUECKEN.md](LUECKEN.md), die Aufgabenliste in [../TODO.md](../TODO.md).

## Inhaltsverzeichnis

- [1. Ausgangslage: zwei Prüfungen, eine Lücke](#1-ausgangslage-zwei-prüfungen-eine-lücke)
- [2. Befunde — Texte](#2-befunde--texte)
  - [T1 — Die Regel verbietet „Du“, 41 Zeilen benutzen es](#t1--die-regel-verbietet-du-41-zeilen-benutzen-es)
  - [T2 — Ausrufezeichen und Häkchen-Rhetorik in den Rückmeldungen](#t2--ausrufezeichen-und-häkchen-rhetorik-in-den-rückmeldungen)
  - [T3 — Verbotene Alt-Wörter stehen wieder im Text](#t3--verbotene-alt-wörter-stehen-wieder-im-text)
  - [T4 — Zahlen und Einheiten laufen an den Formattern vorbei](#t4--zahlen-und-einheiten-laufen-an-den-formattern-vorbei)
  - [T5 — Dieselbe Aussage, zwei oder drei Texte](#t5--dieselbe-aussage-zwei-oder-drei-texte)
  - [T6 — Technik im Nutzertext: Pfade, Umgebungsvariablen, Endpunkte](#t6--technik-im-nutzertext-pfade-umgebungsvariablen-endpunkte)
  - [T7 — Rohcodes und englische Serverzustände](#t7--rohcodes-und-englische-serverzustände)
  - [T8 — Lade-, Fehler- und Frischetexte ohne gemeinsame Regel](#t8--lade--fehler--und-frischetexte-ohne-gemeinsame-regel)
- [3. Befunde — Oberfläche](#3-befunde--oberfläche)
  - [V1 — Diagramme und Karte kennen das helle Thema nicht](#v1--diagramme-und-karte-kennen-das-helle-thema-nicht)
  - [V2 — Der Klartext lebt im Tooltip](#v2--der-klartext-lebt-im-tooltip)
  - [V3 — Meldungen: acht Blöcke über dem Inhalt, vier Anzeigedauern](#v3--meldungen-acht-blöcke-über-dem-inhalt-vier-anzeigedauern)
  - [V4 — Symbole ohne feste Bedeutung](#v4--symbole-ohne-feste-bedeutung)
  - [V5 — Dieselbe Sache, andere Einheit, andere Form](#v5--dieselbe-sache-andere-einheit-andere-form)
- [4. Priorisierte Arbeitsliste](#4-priorisierte-arbeitsliste)
- [5. Was schon richtig ist](#5-was-schon-richtig-ist)

## 1. Ausgangslage: zwei Prüfungen, eine Lücke

[GUI-UX-BEFUND.md](GUI-UX-BEFUND.md) hat die Oberfläche gegen den Entwurf
vermisst (Raster, Navigation, Typografie). Dieser Befund nimmt denselben
Bestand von der anderen Seite: **Was steht im Text — und wird es so
durchgesetzt, wie das Regelwerk es aufschreibt?**

Der Stand ist zwiespältig:

- **[MICROCOPY.md](MICROCOPY.md) ist gut** — §1–§3 (Tonfall, Zeichen, Zahlen),
  §4 (Benennungen), §4a–4d (55 Musterzeilen für Fallback-GUI, „Jetzt“,
  „Labor“, „System“) und §5 (Zustände). Die Liste der Dinge, die nie im Text
  stehen (erfundene Zahlen, Pfade, interne Ausnahmen, englische Hook-Zeilen),
  ist präzise.
- **Er deckt aber nur die Hälfte der Oberfläche.** „Stationen“, „Woche“,
  „Ich“, „Einstellungen“, der Glossar-Kopf, jede Rückmeldung (Toasts) und
  fast alle Lade- und Fehlertexte der Views haben **kein** Muster. Die
  Fallback-GUI (`rp2/fallback_gui.py`) ist trotz ihres Alters die disziplinierteste
  Fläche im Projekt — weil §4a sie beschreibt.
- **Geprüft wird fast nichts davon.** `web/src/microcopy.test.ts` prüft vier
  Zusagen über 34 Dateien: paarige `„…“`, kein `”`, keine HTML-Entities und
  dass das Regelwerk verlinkt ist. Kein Test prüft Du-Form, Ausrufezeichen,
  Einheiten, Terminologie oder Pfade. `TODO.md` §F meldet F3 dennoch als
  geschlossen.
- **Der Bestand zementiert die Verstöße:** `web/e2e/decision.spec.ts:202,214,291`
  sucht wörtlich `„Auswahl gespeichert!“` und `„Füllung in deiner
  Tank-Bilanz verbucht!“`. Wer die Sätze korrigiert, macht zuerst den Test rot
  — die falsche Formulierung ist damit eine Testzusage, nicht ein Versehen
  (siehe T2).

Alle Zeilenangaben beziehen sich auf 0.38.0 (`0c3ed64`). Zählungen kommen aus
einer String-Extraktion über `web/src` ohne Tests (rund 840 Nutzertext-Zeilen)
und wurden mit `grep` nachgeprüft; Kommentare sind ausgenommen.

## 2. Befunde — Texte

### T1 — Die Regel verbietet „Du“, 41 Zeilen benutzen es

[MICROCOPY.md §1](MICROCOPY.md#1-tonfall) sagt in der Tabelle: *„Sie/Du wird
vermieden — die App spricht über die Sache, nicht über den Nutzer“*, mit dem
Nein-Beispiel „Du hast deinen Beleg gespeichert.“ Genau dieses Nein steht 41 ×
in 10 Dateien, u. a.:

| Stelle | Text |
|---|---|
| `Dashboard.tsx:1350` | `✓ Füllung in deiner Tank-Bilanz verbucht!` |
| `Dashboard.tsx:1408` | `✓ Beleg in deiner Tank-Bilanz verbucht! ${positionNote}` |
| `Dashboard.tsx:1428` | `Beleg ${fillId} storniert — zählt nicht mehr in deiner Bilanz.` |
| `Dashboard.tsx:1495` | Tagline `Dein Tank-Kompass. Ohne Rätselraten.` |
| `now.ts:698` | `Kippt zu „Jetzt“, wenn du vor 18:00 Uhr tanken musst.` |
| `week.ts:214` | `… hängt von deiner Strecke ab.` |
| `stations.ts:236/237` | `Gerade die günstigste deiner 12 Stationen.` |
| `views/Jetzt.tsx:362,365` | `Hast du getankt?` · `Ein kurzer Tap erfasst deinen Beleg in deiner Bilanz.` |
| `views/Ich.tsx:78,80,370,578` | `… deines Sets …` · `Deine Tankbelege` · `… an deiner Station …` |
| `views/Labor.tsx:502,608,1276` | `… in deinem Tempo.` · `… deiner Stadt …` · `Deine Tankungen stehen getrennt …` |
| `service-worker.ts:34` | `Deine Eingaben bleiben gespeichert; …` |

Es gibt also zwei Sprachen im selben Produkt: „Beleg gespeichert.“ (Regel) und
„✓ Beleg in deiner Tank-Bilanz verbucht!“ (Toast). Nebenbei macht die Du-Form
die Texte länger — derselbe Satz ohne Anrede ist kürzer und passt in eine
Zeilenhöhe, was dem Typografie-Befund U1 zugutekommt.

**DoD:** Die 41 Stellen auf sachliche Aussagesätze umschreiben (statt „Beleg in
deiner Tank-Bilanz verbucht“ künftig „Beleg verbucht“, statt „wenn du vor
18:00 Uhr tanken musst“ künftig „Tanken vor 18:00 Uhr“), Du-Form als Ratchet in
`microcopy.test.ts` verbieten, `web/e2e/decision.spec.ts` nachziehen.

### T2 — Ausrufezeichen und Häkchen-Rhetorik in den Rückmeldungen

[MICROCOPY.md §1](MICROCOPY.md#1-tonfall): *„Kein Ausrufezeichen, kein Emoji im
Fließtext“*. In `web/src` enden genau **drei** Nutzertexte mit `!`:

- `Dashboard.tsx:1350` — `✓ Füllung in deiner Tank-Bilanz verbucht!`
- `Dashboard.tsx:1408/1409` — `✓ Beleg in deiner Tank-Bilanz verbucht!`
- `Dashboard.tsx:1470` — `✓ Auswahl gespeichert!`

Dazu kommt eine Symbolsprache, die die Regel nicht kennt: Rückmeldungen werden
mit vorangestelltem `✓` (Erfolg) oder `!` (Warnung) gebaut
(`Dashboard.tsx:365,1337,1390,1456` bzw. `:359,1315,1321,1371,1397,1439,1463`)
und in den E2E-Tests wörtlich gesucht. Dazu ein Emoji im Fließtext, das §4a
nicht kennt: Die Fallback-GUI schreibt `„🔄 NAS prüfen“`
(`rp2/fallback_gui.py:722`). Das ist die Stelle, an der der Regelverstoß am
teuersten ist, weil er als bestandener Test aussieht.

**DoD:** Rückmeldungen ohne Ausrufezeichen und ohne Präfix-Glyphe (Zustand
benennen: „Beleg verbucht.“ / „Beleg vorgemerkt — geht raus, sobald die
Verbindung steht.“); `!` und `✓` als Textzeichen in `microcopy.test.ts`
ausschließen; `decision.spec.ts` anpassen.

### T3 — Verbotene Alt-Wörter stehen wieder im Text

[MICROCOPY.md §4](MICROCOPY.md#4-benennungen) legt die sechs Bereiche fest
(**Jetzt, Stationen, Woche, Ich, Labor, System**) und sagt ausdrücklich: „die
alten Tabs **Alltag**, **Werkstatt** und **Einstellungen** sind mit
0.35.0/0.36.0 ersetzt (nicht „Statistik“, nicht „Prüfstand“)“. Trotzdem:

| Wort | Stellen (Auswahl) |
|---|---|
| `Statistik` | `views/Settings.tsx:473,475,553` (Fehlertext, Knopf „Statistik neu laden“, Leertext) · `data.ts:2464` (`stats_summary_failed`) · `Dashboard.tsx:1182,1189` · `views/Labor.tsx:1637` |
| `Prüfstand` | `views/Labor.tsx:876,1135,1246,1366,1395,1483,1492,1620` · `data.ts:2466` (`backtest_not_available`) · `data.ts:3476` (Glossar) |
| `Alltag` | `views/Labor.tsx:517` — der Rückweg-Knopf heißt `Zurück zum Alltag` |
| `Füllung` (= Beleg) | `Dashboard.tsx:1337,1350` · `components/StationMap.tsx:631` („0,00 € Unterschied“-Karte) |
| `Buchung` | `views/Ich.tsx:540` · `views/Settings.tsx:191` |

Besonders sichtbar: Die Schwellen-Karte in „Ich → Einstellungen“ heißt im
Fehlerfall „Die Statistik mit den aktiven Schwellen …“, und der Labor-Knopf
führt „Zurück zum Alltag“ — beide Wörter hat das Projekt abgeschafft. Der
Grund für den Befund ist nicht Kosmetik: Wer „Statistik“ liest, sucht einen
Tab, den es nicht gibt.

**DoD:** Alt-Wörter in Nutzertexten ersetzen (`Labor`, `Beleg`, `Jetzt`) und
als Liste in `microcopy.test.ts` festnageln (Kommentare und `docs/` bleiben
frei); die betroffenen `messages`-Einträge in `data.ts` mitziehen.

### T4 — Zahlen und Einheiten laufen an den Formattern vorbei

[MICROCOPY.md §3](MICROCOPY.md#3-zahlen-einheiten-zeiten) sagt: „Formatiert
wird **ausschließlich** über die Funktionen in `web/src/data.ts`“, Komma als
Dezimaltrennzeichen, `93 %` mit Leerzeichen. Vier Muster brechen das:

1. **Dezimalpunkt.** `views/System.tsx:554`: `„Skalierter Fehler an
   sprungfreien Tagen. Ziel < 0.80.“` — überall sonst gilt `1,0` / `0,25`
   (`data.ts:3468`). Gleiche Karte: `views/System.tsx:592` schreibt `14 d`
   statt `14 Tagen`.
2. **Geldformatter für andere Größen.** `${euro(alt.detour_km, 1)} km`
   (`now.ts:470,723`, `stations.ts:324`), `${euro(twin.agreement_pct, 1)} %`
   (`data.ts:3423`), `` `${euro(v, 1)} ct` `` (`components/LabCharts.tsx:148` —
   Einheit ohne `/L`, obwohl `centPerLiter` die Vorgabe ist).
3. **Prozent ohne Leerzeichen.** `components/LabCharts.tsx:366,369`:
   `{Math.round(f * 100)}%` in der Achsenbeschriftung — dieselbe Datei schreibt
   in den Tooltips `…toFixed(0)} %` (":386,395"). Die Datei hat sechs erlaubte
   `toFixed`-Stellen (`format-convention.test.ts:25`, Begründung „SVG-Pfad-Koordinaten
   + ganzzahlige Prozent in `<title>`“) — die sichtbare Achse fällt mit unter
   diese Sammelbegründung.
4. **Umrechnung per Hand.** `lab.ts:155` rechnet den Cent-Unterschied selbst
   (`(entry.price_then - entry.price_window) * 100`) statt über
   `savingPerLiterCt()` (`now.ts:238`) — zwei Wege für dieselbe Zahl.

**DoD:** `euro()` nur noch für Euro; km/Prozent/Cent über
`kilometersLabel`/`percentLabel`/`centPerLiter`; Prozent immer mit
Leerzeichen; `format-convention.test.ts` um eine Regel „kein `* 100` in
Anzeigetexten“ und um die drei genannten Dateien erweitern.

### T5 — Dieselbe Aussage, zwei oder drei Texte

MICROCOPY §5 verlangt zentrale Klartexte (`messages` in `data.ts`). Daneben
existiert ein zweiter Kanal: **13 `fallback=`-Texte in 8 Dateien** und
Formulierungen, die mehrfach im Code stehen:

- `„Grundlage: die geladenen Preismeldungen dieser Station, jüngste …“` steht
  zweimal wörtlich: `now.ts:648` und `stations.ts:392`.
- Push-Zustellung: `data.ts:2568` sagt `„Keine Push-Zustellung eingerichtet —
  Alarme stehen nur hier in der GUI.“`, `views/System.tsx:824` sagt dasselbe
  plus Einrichtungsanweisung (siehe T6).
- `„Kein Profil aktiv — Einstellungen gelten nur auf diesem Gerät“` doppelt
  (`Dashboard.tsx:594` mit Punkt, `:1553` ohne).
- `„URL steht jetzt in der Adresszeile — zum Teilen kopieren.“` doppelt
  (`Dashboard.tsx:785,788`, zwei Zweige).
- `„Speichern fehlgeschlagen: … – bitte erneut versuchen.“` doppelt
  (`Dashboard.tsx:1345,1397`).
- `„Kein Datenstand — noch nichts gemeldet“` doppelt (`now.ts:549`,
  `stations.ts:405`).

Dubletten sind kein Stilproblem, sondern Drift-Gefahr: Beim nächsten Wortwechsel
wird eine der beiden Stellen vergessen (genau so sind die Umlaute und die
Punkt-Setzung oben unterschiedlich geworden).

**DoD:** Gemeinsame Funktion oder Konstante je Satz (z. B. `grundlageNote()`,
`frischeZeile()`); Test, der doppelte Literale ab einer Länge meldet.

### T6 — Technik im Nutzertext: Pfade, Umgebungsvariablen, Endpunkte

[MICROCOPY.md §6](MICROCOPY.md#6-was-nie-im-text-steht): *„Pfade, Tokens, URLs,
Koordinaten“* stehen nie im Text. Die gebaute GUI zeigt sie **sichtbar**:

| Stelle | Text (Auszug) |
|---|---|
| `views/Settings.tsx:466` | `read-only · Quelle: /api/v1/stats/summary` (englisch **und** Pfad, im Kopf der Schwellen-Karte) |
| `views/System.tsx:824` | `Einrichtung: TANKAPP_NTFY_URL setzen (docs/BETRIEB.md, Abschnitt „Alarm-Zustellung über ntfy“). …` |
| `data.ts:2400` | `polling_missing`: `… data/analysis/stations/polling.json erzeugen (docs/INSTALL.md …), auf dem NAS TANKAPP_POLLING_FILE prüfen (ops/nas/app/compose.yml → /config/polling.json RO) und ops/nas/preflight.sh ausführen.` |
| `system.ts:407,427,444` | `Grundlage: /api/v1/health → jobs und /api/v1/jobs/<job>/log — dieselben Zahlen wie im alten System-Tab.` |
| `system.ts:424` | `… direkt vom NAS (data/runtime/jobs/<job>.log) — Pfade und Zugangsdaten werden beim Auslesen entfernt.` |

Der letzte Eintrag ist der deutlichste: Der Satz, der verspricht, dass Pfade
entfernt werden, enthält selbst einen. Dazu ein **Widerspruch im Regelwerk**:
§6 verbietet Pfade, §4d dokumentiert „der Service-Worker liegt unter `/sw.js`“
als Muster. Solange das nicht entschieden ist, kann kein Ratchet greifen.

**DoD:** Entscheidung im Regelwerk: Technik nur in der Diagnose/„Warum?“-Ebene
(§4d anpassen), Nutzertexte ohne Pfad, Env-Variable und Endpunkt; die
betroffenen `messages`-Einträge (u. a. `polling_missing`) kürzen und den Rest in
`docs/INSTALL.md` verweisen statt in die GUI.

### T7 — Rohcodes und englische Serverzustände

MICROCOPY §5 beschreibt genau ein Muster für Fehler: *`problem(error_code)` als
**Klartext**, Rohcode **darunter**, Knopf „Erneut laden“*. Zwei Stellen drehen
das um:

- `views/System.tsx:781` zeigt `{alarm.code}` als **erste Zeile** (monospace),
  der Klartext folgt erst darunter (`:785`).
- `views/System.tsx:816,817` zeigt für offene Push-Fehler **nur** den Code; der
  deutsche Satz steht ausschließlich in `title` — auf dem Handy nicht
  erreichbar (siehe V2).
- `views/System.tsx:586` gibt den Serverzustand per `status.toUpperCase()`
  aus (`STABIL`, sonst z. B. `DRIFT`), `:460` erklärt in einem Satz
  „… Sorte als `false` gemeldet“ — englische Enums im Fließtext.
- `components/JobCard.tsx:139,144`: `Webhook-Trigger` und `letzter Skip: …`;
  `views/Stationen.tsx:349` kürzt `vor 5 Min.` (überall sonst „vor 5 Minuten“),
  `:476` schreibt `ggü. der Referenz` statt „gegenüber“.

**DoD:** Klartext zuerst, Code klein darunter (oder in der Diagnose); Enums
übersetzen; Abkürzungen (`Min.`, `ggü.`) auflösen.

### T8 — Lade-, Fehler- und Frischetexte ohne gemeinsame Regel

§5 nennt Zustände, aber keine Sprache dafür. Gezählt in `web/src` (ohne Tests):

- **18 Ladetexte** mit vier Verben: `wird geladen`, `werden geladen`,
  `wird berechnet`, `werden berechnet` (z. B. `views/Stationen.tsx:519`
  „Preise werden geladen“ vs. `views/Jetzt.tsx:403` „Empfehlung wird
  berechnet“), dazu `Beleg wird verbucht` (`views/Ich.tsx:345`).
- **8 Knopftexte für einen Vorgang**: `Erneut laden` (`CellError.tsx:26`,
  `LoadError.tsx:35`) und sechsmal `… neu laden` (`Ausblick`, `Bilanz`,
  `Statistik`, `Status`, `Tagebuch`, `Verlauf`).
- **Frische-Zeile:** §4b verspricht `Preise vor 4 Minuten · Prognose vor 35
  Minuten · <Ort>`. Geliefert wird `„Preise kein Stand“` / `„Prognose kein
  Stand“` (`now.ts:563,568` — grammatisch kein Satz), und den Ort hängt jede
  View selbst an: `views/Jetzt.tsx:965`, `views/Stationen.tsx:987`,
  `views/Woche.tsx:486`, `views/System.tsx:909`, `views/Labor.tsx:1638`
  (jeweils `· kein Ort gewählt`, kleingeschrieben als Satzteil).
- **Pluralfehler:** `Dashboard.tsx:1700` schreibt `${fresh.length} frische
  Preise` — bei genau einem frischen Preis steht dort „1 frische Preise“.

**DoD:** §5 um eine Tabelle „lädt / leer / Fehler / Frische“ mit je einer
Formulierung erweitern; eine Frische-Komponente für alle Views (Ort inklusive);
Plural über das bestehende `… === 1 ? … : …`-Idiom oder `countLabel`; die acht
Retry-Knöpfe auf zwei Formen zusammenziehen.

## 3. Befunde — Oberfläche

### V1 — Diagramme und Karte kennen das helle Thema nicht

Das helle Thema ist ein Feature (`views/Settings.tsx:580`, `data.ts:3174`
`APP_THEMES`), und es funktioniert über CSS-Variablen: `html.light` biegt die
`--color-*`-Werte um (`styles.css:39` ff.), Tailwind-Klassen bleiben stehen.
Die Diagramme machen das nicht mit. Sie tragen **64 feste Hex-Werte**
(monospace-Palette des dunklen Stands): `components/StationMap.tsx` 21,
`components/LabCharts.tsx` 24, `components/LineChart.tsx` 9,
`views/Labor.tsx` 5, `views/Stationen.tsx` 3, `Dashboard.tsx` 2. In `web/src`
steht **kein** `var(--color` — die SVG-Flächen sind von der Umschaltung
abgeschnitten.

Folgen im hellen Stand: Achsen- und Legendentext `#94a3b8`
(`components/LineChart.tsx:7`, `components/LabCharts.tsx:6`) erreicht auf weißer
Karte nur ≈ 2,4:1 (AA verlangt 4,5:1); im Radar verschwinden die
Fadenkreuzlinien `#1e293b` (`components/StationMap.tsx:790,791`) auf der hellen
Fläche. `web/src/a11y.test.ts` prüft die Palette genau so, wie sie entstanden
ist — `#94a3b8` gegen **dunkle** Flächen (`a11y.test.ts:111`), der
Light-Block nur die beiden `slate`-Töne. Die Diagramme stehen in keinem
Kontrast-Test.

**DoD:** Diagrammfarben aus CSS-Variablen lesen (oder zwei Paletten mit
`useTheme`) und `a11y.test.ts` um die Diagrammfarben **beider** Themen
erweitern; der U1-/U6-Schnitt (Typografie, Karten) sollte dabei dieselbe
Token-Quelle benutzen.

### V2 — Der Klartext lebt im Tooltip

`title=` wird 57 × gesetzt (33 × `title={…}`, 24 × `title="…"`), neunmal in
`views/System.tsx`, achtmal in `views/Stationen.tsx`. In mehreren Fällen trägt
genau der Tooltip die Erklärung, die der sichtbare Text schuldig bleibt:

- `views/System.tsx:816` — Alarm-Code sichtbar, deutscher Klartext nur im
  `title` (siehe T7).
- `views/Jetzt.tsx:370–375` — der `title` „Kein frischer Preis – bitte manuell
  erfassen“ hängt an einem **`disabled`**-Knopf: nicht fokussierbar, kein
  Hover auf Touch — die Begründung ist unerreichbar.
- `views/Stationen.tsx:650` — „Als Stamm-Station merken — wird
  Referenz-Kandidat und sortiert oben“ nur als `title`, daneben `:371` der
  Tastatur-Hinweis `Station suchen — Strg+K / ⌘K`, der auf dem Handy nichts
  erklärt, während der Platzhalter `:372` dasselbe zweimal sagt.

**DoD:** Erklärung als sichtbare Zweitzeile (oder aufklappbar) am Ort; `title`
nur noch redundant. Auf `disabled`-Elementen auf sichtbaren Text ausweichen
(oder `aria-describedby`) — `title` ist dort für Tastatur und Touch verloren.

### V3 — Meldungen: acht Blöcke über dem Inhalt, vier Anzeigedauern

Über dem Inhalt von `Dashboard.tsx` können acht Blöcke stehen, jeder mit
`mb-6`, ohne Priorität und ohne Obergrenze (`Dashboard.tsx:1708–1790`):
Rückmeldung, Datenstand (`DataAgeBanner`), Installationshinweis,
Update-Banner, Offline-Queue-Banner, „Browser ist offline“, E5-Hinweis,
Verbindungsproblem. Auf 390 px ist das der halbe erste Bildschirm, bevor
irgendetwas aus „Jetzt“ zu sehen ist — die UX-Seite davon steht in
[U3](GUI-UX-BEFUND.md#u3--navigation-ein-pillen-streifen-statt-der-entworfenen-raster).

Dazu die Dauer: Dieselbe Art Meldung verschwindet nach 4 s
(`Dashboard.tsx:1316,1322`), 5 s (`:1347`), 6 s (`:367,1340`) oder 8 s
(`:361`) — neun `setTimeout`-Aufrufe, vier Werte, keine Regel.

**DoD:** Eine Meldungs-Registry mit Rang (Störung > Zustand > Hinweis > Erfolg),
höchstens **eine** gleichzeitig sichtbar; eine gemeinsame Anzeigedauer
(Vorschlag 6 s, Störungen bleiben); alles Sichtbare zusätzlich mit
`role="status"`/`aria-live`
(heute vorhanden, aber je Block: `Dashboard.tsx:1710,1730`, `views/Stationen.tsx:508`).

### V4 — Symbole ohne feste Bedeutung

Die Oberfläche benutzt Zeichen als Textersatz. `✓` bedeutet heute fünf
verschiedene Dinge: Erfolg in der Rückmeldung (`Dashboard.tsx:365`), „wie
empfohlen getankt“ (`views/Jetzt.tsx:380`), erledigter Schritt
(`views/System.tsx:363`), richtige Empfehlung (`views/Labor.tsx:1100`) und
„offen“ in der Stationsliste (`views/Stationen.tsx:397`). Daneben stehen `✗`
(nur Labor), `●`/`▼`/`→`/`–` als Chip-Icons (`views/Jetzt.tsx:133–139`), `✎`
und `✕` in derselben Karte (`:383,393`) sowie `★` für die Fenster-Sicherheit
(`views/Woche.tsx:88,376`).

Kein Zeichen ist falsch — aber keins ist verlässlich. Ein Screenreader liest
`✓ Ja, wie empfohlen` als „Häkchen Ja, wie empfohlen“ vor.

**DoD:** Symbol-Tabelle in [MICROCOPY.md](MICROCOPY.md) (Zeichen → eine
Bedeutung) und in der UI-Referenz; dekorative Zeichen `aria-hidden`, tragende
durch Text ersetzen.

### V5 — Dieselbe Sache, andere Einheit, andere Form

| Größe | Form A | Form B |
|---|---|---|
| Zeitwert | `Zeitwert (€/h)` (`views/Stationen.tsx:422`) | `${…} Euro pro Stunde` (`views/Settings.tsx:263,264`) |
| Tempo | `km/h` (Profilaustausch) | `${speed} Kilometer pro Stunde` (`views/Settings.tsx:284`) |
| Zeitraum | `24 Stunden / 3 Tage / 7 Tage` (`views/Stationen.tsx:126–128`, `views/Labor.tsx:1502–1504`) | `letzte 24 Stunden / letzte 3 Tage / letzte 7 Tage` (`Dashboard.tsx:1031–1034`) und `+3 Tage / +7 Tage` (`views/Labor.tsx:617,618`) |
| Alter | `vor ${age} Min.` (`views/Stationen.tsx:349`) | `vor ${minutes} Minuten` (`data.ts:2698` `ageLabel`) |
| Ergebnis | `Richtig, Daneben oder Gleichstand` (`views/Labor.tsx:1019`) | `richtig · daneben · unentschieden · nicht bewertbar` (§4c, `lab.ts:149` ff.: `diaryOutcome`) |

Das Muster ist überall dasselbe: Die Regel existiert, aber es gibt keine
zweite Stelle, die sie für den jeweiligen Bildschirm wiederholt — und keine
Prüfung, die sie einfordert.

**DoD:** Einheiten-Tabelle in MICROCOPY §3 (Symbol in Klammern, Langform nur in
Erklärtexten) und ein Test, der die Langformen (`Euro pro Stunde`, `Kilometer
pro Stunde`, `Min.`, `ggü.`) in Views meldet.

## 4. Priorisierte Arbeitsliste

| # | Prio | Aufgabe | Warum zuerst |
|---|---|---|---|
| T1+T2 | **P0** | Du-Form, Ausrufezeichen, Präfix-Glyphen auflösen — und den Ratchet dazu bauen | 41 + 3 Stellen, zwei Regeln, heute von E2E-Tests zementiert: ohne diesen Test kommt jede Korrektur zurück |
| T6 | **P0** | Pfade, Env-Variablen und Endpunkte aus dem Nutzertext; §6 ↔ §4d entscheiden | zeigt Betriebswissen an der falschen Stelle; wenige Stellen, klare Regel |
| T3 | **P1** | Alt-Wörter (Statistik, Prüfstand, Alltag, Füllung, Buchung) ersetzen | Nutzer suchen Tabs, die es nicht gibt |
| T4 | **P1** | Zahlen über die Formatter, Prozent mit Leerzeichen, Komma statt Punkt | harte Regel, mechanisch prüfbar, betrifft 8 Stellen |
| T8 | **P2** | Ladetabelle + eine Frische-Zeile + zwei Retry-Formen + Pluralfehler | berührt jede Ansicht, aber je Stelle klein |
| T7 | **P2** | Klartext vor Rohcode, Enums übersetzen, Abkürzungen auflösen | hängt an V2 (Tooltip) und §5 |
| V1 | **P2** | Diagrammfarben themenfähig, Kontrast-Test für beide Themen | sichtbarer Fehler im hellen Stand (2,4:1) |
| V2 | **P2** | Erklärungen aus dem `title` in den sichtbaren Text | Mobil unerreichbar, `disabled`-Fall ganz verloren |
| V3 | **P2** | Meldungen ordnen: Rang, Obergrenze, eine Dauer, `aria-live` | erste Bildschirmfläche auf dem Handy |
| T5 | **P3** | Dubletten zu je einer Funktion ziehen | Drift-Vorsorge, kein sichtbarer Fehler |
| V4 | **P3** | Symbol-Tabelle, `aria-hidden` für Dekoration | Verständlichkeit, Screenreader |
| V5 | **P3** | Einheiten- und Zeitraum-Formen vereinheitlichen | Kosmetik mit Test |

Reihenfolge: **erst der Ratchet (T1/T2), dann die Textstellen** — dieselbe Logik
wie bei U1/U6 aus [GUI-UX-BEFUND.md](GUI-UX-BEFUND.md): Ein Befund ohne Prüfung
ist nach zwei Releases wieder da. **T6 ist die einzige Zeile, die auch
inhaltlich falsch ist**, nicht nur uneinheitlich. Die C-Punkte in
[../TODO.md](../TODO.md) entstehen mit der ersten Umsetzung, nicht vorher —
sonst steht dort ein Befund ohne Owner.

## 5. Was schon richtig ist

Damit das Bild nicht zerrt: Das Regelwerk ist **substantiiert** — §1 (Tonfall),
§3 (Formatter-Katalog ≙ `data.ts`), §4a–4d (Muster je Bereich) und §5
(Zustände) sind gelebte Vorgaben, die Fallback-GUI (`rp2/fallback_gui.py`,
Marker `tankapp-fallback-gui v4.0`) hält ihre §4a-Muster bis auf das
`🔄 NAS prüfen`-Emoji ein. Der zentrale Fehlerkatalog `messages` in `data.ts`
(rund 50 Codes, je ein deutscher Klartext) ist genau die Struktur, die §5
verlangt; `problem()` wird an 13 Stellen benutzt. Zustandsbausteine
(`Skeleton`, `DataAge`, `CellError`, `LoadError`, `Level1Sheet`) und
`role="status"`/`aria-live` existieren, Tabellen laufen in `overflow-x-auto`
(`views/Ich.tsx:403`, `views/Settings.tsx:487`, `views/System.tsx:484`),
Diagramme tragen `aria-label`/`ariaDescription`
(`components/LineChart.tsx:79`, `components/LabCharts.tsx:260,328`,
`components/HeatmapGrid.tsx:157`), und die Glossar-Einträge
(`data.ts:3441–3516`) halten die Regel „deutsches Label, Fachwort in der
Erklärung“ sauber ein.

Das Problem ist nicht die Sorgfalt, sondern die **Reichweite der Prüfung**: Das
Regelwerk beschreibt vier von neun Flächen und die Ebene-1-Texte, der Ratchet
prüft zwei Zeichenregeln — der Rest der Oberfläche ist damit auf
Selbstdisziplin angewiesen. Genau dort stehen die 41 Du-Stellen, die drei
Ausrufezeichen und die `read-only`-Zeile.
