# Tiefenanalyse 23.09.2026: GUI-Logik, GUI-Texte, Mathe/Statistik

> Stand: 23.09.2026 · Stichtagsprüfung, keine Umsetzung.
> Anlass: Verdacht, dass GUI, Texte und Statistik nicht das zeigen, was sie behaupten.
> Gegenprobe: CI-Spiegel zum Befundtag lokal grün — `ruff check`/`format` sauber,
> `pytest` 1524 bestanden, `vitest` 1245 bestanden, Web-Build ok. Die gefundenen
> Fehler sind also arretiertes Verhalten (Tests und E2E-Mocks bauen sie ein),
> keine laufenden Test-Brüche.
>
> Methode: vollständige Lektüre der Zahlenkette Server → Payload → Typ → Anzeige
> (`app/decide.py`, `route.py`, `pside.py`, `quantity.py`, `feedback.py`,
> `stats_summary.py`, `benefit.py`, `thresholds.py`; `engine/models.py`,
> `backtest.py`, `calibration.py`, `bootstrap.py`, `probabilities.py`,
> `personalization.py`; `web/src/*` inkl. aller Views) und Abgleich aller
> nutzersichtbaren Texte gegen `docs/produkt/MICROCOPY.md` und `docs/produkt/UI.md`.

## Inhaltsverzeichnis

- [1. Ergebnis auf einen Blick](#1-ergebnis-auf-einen-blick)
- [2. A — Befunde GUI-Logik](#2-a--befunde-gui-logik)
- [3. B — Befunde GUI-Texte](#3-b--befunde-gui-texte)
- [4. C — Mathe/Statistik: geprüft und entlastet](#4-c--mathestatistik-geprüft-und-entlastet)
- [5. Bewusst kein Befund](#5-bewusst-kein-befund)
- [6. Empfohlene Reihenfolge der Korrekturen](#6-empfohlene-reihenfolge-der-korrekturen)

## 1. Ergebnis auf einen Blick

Die Engine-Statistik ist sorgfältig und ehrlich — dort wurden **keine**
Rechenfehler gefunden. Die echten Fehler sitzen genau dort, wo der Nutzer Zahlen
direkt liest:

| Nr. | Severity | Befund kurz |
|---|---|---|
| A1 | **hoch** | Stationen-Atlas: Server-`net_eur` wird mit **falscher Vorzeichen-Konvention** angezeigt und sortiert — empfohlene Stationen erscheinen rot/teuer und sortieren nach unten. |
| A2 | mittel | F2-Freigabe „Woanders" rechnet deterministisch mit möglicherweise **veraltetem Alternativpreis**; Frischekette prüft nur die gewählte Station. |
| A3 | mittel | „Von X Empfehlungen“-Lernfortschritt und die Gleichung der Trefferquote benutzen **falsche Grundgesamtheit / gemischte Zählvariablen**. |
| A4 | mittel | „Tagesmedian" im Jetzt-Tagesspiegel ist der **obere Rand** einer geraden Stichprobe, kein Median. |
| A5 | niedrig | Stufe B („Modell lernt, Empfehlung ohne Prozent“) ist **unerreichbar**; Texte/Regelwerk dafür sind tot. |
| A6 | niedrig | `route.py` vs. `decide.py`: dieselbe Umweg-Schätzquelle, **verschiedene Werte**. |
| A7 | niedrig | `latest_by`-Verhalten anders als Docstring und GUI-Hinweis behaupten („endet vor"). |
| A8 | niedrig | TS/Python-Parität der Labor-Scores: `n_p = 0` → GUI `0` statt Server `null`. |
| B1 | mittel | „spart netto +X %" verspricht netto; das angezeigte Prozent misst **brutto** (§5.2-Ereignis ohne Umwegkosten). |
| B2 | niedrig | „Warte-Empfehlung zu unsicher (P < 50 %)“ — Schwellwert fest verdrahtet, bei M7-Nachzug falsch. |
| B3 | niedrig | Regelwerk-Drift: MICROCOPY (Modell-Frische 180 min, Stufe B) vs. Code (1440 min, Stufe B tot). |

## 2. A — Befunde GUI-Logik

### A1 — Stations-Atlas: Netto-Spalte und Standard-Sortierung zeigen das Gegenteil des Servers (hoch)

**Was der Server liefert.** `alternatives_nearby[].net_eur` entsteht in
`app/decide.py` (`_alternatives`, ~Zeilen 949–1080) aus
`net_economics(anchor, cand_price, …)` (`app/route.py:53-82`):

```
gross = (Ankerpreis-Referenz − Alternativpreis) · Liter
net_eur = gross − Umwegkosten        → positiv = Umweg SPART netto
```

Ein positiver Wert heißt: Die Alternative lohnt sich trotz Umweg. Genau so
spricht der F2-Freigabesatz (`app/decide.py:1226`):
„Fahre zu {Name}: spart netto **+2,50 €** trotz Umweg." — und so steht es auch
im Route-Verdict (`worth_it = net_eur ≥ elsewhere_net_eur`). Die E2E-Mocks
bestätigen die Konvention von der anderen Seite
(`web/e2e/horizons.spec.ts:112/131`): `net_eur: 2.3` mit `worth_it: true` und
`net_eur: -3.15` mit `worth_it: false`.

**Was der Atlas daraus macht.** In `web/src/stations.ts` landen **zwei
gegenläufig vorzeichenbehaftete Größen in derselben Zeile**:

- `netEur` = Server-Wert (positiv = Ersparnis), `web/src/stations.ts:142-165`
  (`atlasRows`);
- `fillEur` = `(price − refPrice) · Liter` (positiv = **teurer**),
  `web/src/stations.ts:149-151`.

`atlasEur` (`web/src/stations.ts:228-247`) zeigt dann
`value = row.netEur ?? row.fillEur` mit einem Ton
`value < -0.005 → "save"` und dem Text `+X,XX €` bei positivem Wert.
Konsequenz: Eine Station, die der Server gerade empfiehlt
(`net_eur = +2,50 €`, verdict `worth`), wird im Atlas **rot als
„+2,50 € netto“** dargestellt — also als Mehrpreis. Eine schlechte Station
(`net_eur = −3,15 €`, verdict `not_worth`) wird **grün „−3,15 € netto“**.
Der Kommentar in `sortAtlasRows` (`web/src/stations.ts:203-210`) behauptet
dabei ausdrücklich „beides ist eine €-Größe mit derselben Richtung (negativ =
günstiger)“ — das gilt nur für `fillEur`, nicht für `netEur`.

**Sortierung verschärft es.** Die **Standard-Sortierung ist „Netto“**
(`web/src/views/Stationen.tsx:179`: `useState<AtlasSort>("net")`), aufsteigend
nach `row.netEur ?? row.fillEur`. Bei den bis zu drei Zeilen mit Server-Netto
sortiert das die **schlechtesten Netto-Deals nach oben** und vermischt sie
zusätzlich mit den fillEur-Zeilen (deren Vorzeichenbetrachichtung umgekehrt
ist). `compareStationsPair` (`web/src/stations.ts:346-392`) benutzt
`netEur`/`verdict` hingegen korrekt („Der Umweg rechnet sich.") — dieselbe
Zahl steht also im selben Tab einmal richtig und einmal invertiert. Die
Tests arretieren die Inversion (`web/src/stations.test.ts:303-311` erwartet
explizit `atlasEur({netEur: -2.3}) → "save"`); ein Fix muss diese Tests
gleich mitziehen.

**Fix-Richtung:** `atlasEur` muss `netEur` in Anzeige-€ mit Ersparnis-Richtung
umrechnen (z. B. Vorzeichenwechsel oder eigenes Format „spart … €"), die
Sortierung „Netto" absteigend nach `netEur` (mit separater Richtung für
`fillEur`) bauen, und Tests+Mock-Erwartungen an die echte Konvention
angleichen.

### A2 — „Woanders"-Freigabe kann auf veraltetem Alternativpreis fußen (mittel)

`_alternatives` nimmt als Preis der Alternative
`cand.get("price") oder cand.get("last_price")`
(`app/decide.py`, ~Zeilen 983-990). `stations()` in `app/data.py:1637-1705`
setzt `price` auf `None`, sobald die Meldung älter als 30 min oder die Station
geschlossen ist — `last_price` behält den Wert. Das deterministische
`net_eur`, `verdict`, `worth_it` und damit die **F2-Freigabeschwelle**
(`app/decide.py:1215-1227`: `best_alt["net_eur"] >= th["elsewhere_net_eur"]`)
rechnen also teilweise mit einem veralteten Preis, während `p_lohnt` die
Frische korrekt behandelt (frisch → Konstante, alt → Draws, „M5 beidseitig").
Der Docstring von `_alternatives` behauptet die Regel „Frische (< threshold)
→ Konstante, stale → Draws" — sie gilt nur für `p_lohnt`, nicht für
`net_eur`/`verdict`. Die Sperrkette `_action_blocking_reasons`
(`app/decide.py:248-330`) prüft zudem ausschließlich die **gewählte** Station
(`price_stale`, `station_unusable`) — nie die Alternative. Die Server-Zeile
trägt zwar `price_fresh` zur Benennung mit, und die GUI zeigt das
Alternativ-Alter am Preis — aber die **Freigabe** entsteht aus der Mischung
„veralteter €-Betrag als Fakt + Prozent aus Modell-Draws".

### A3 — Lernfortschritt und Trefferzeile: falsche Grundgesamtheit, gemischte Zählvariablen (mittel)

Drei Zeilen im Alltagsbereich behaupten M7-Fortschritt
(`web/src/now.ts:179-186` `stageProgressNote`, `web/src/now.ts:192-198`
`learningNote` sowie die Trefferzeile `web/src/now.ts:678-682`):

1. Der Zähler weiht den 30-Tage-Ledger (`last_30d_total` = `advice_stats.n`),
   der Zielwert 100 ist der **Allzeit-Zähler des Gates über die
   Verteilungs-P-Kohorte** (`gate_n`, siehe Docstring
   `app/feedback.py:2924-2968`). Beide nennen denselben Fortschritt, können
   aber wild auseinanderlaufen: nach einer 30-Tage-Pause ohne neue
   Abrechnungen zeigt „Das Modell lernt noch — 0 von 100" an, obwohl
   `gate_n = 100` (und das Gate eventuell nur am Brier-Intervall hängt).
   Die Labor-Seite benutzt korrekterweise `gate_n` (`m7GateLine`,
   `web/src/data.ts:3816+`) — derselbe Sachverhalt erscheint damit in
   zwei Bereichen mit zwei verschiedenen Zählern.
   Referenzen: `app/decide.py:1865-1867` (Mapping `last_30d_hits` ↔
   `advice_stats.wins`), `app/feedback.py:3051` (`wins`) vs.
   `app/feedback.py:2888` (`gate_n`).

2. „Von X abgeschlossenen Empfehlungen trafen **Y** zu (**Z** %)" mischt zwei
   Zählweisen: `Y` = `wins` (Unentschieden zählt 0,
   `app/feedback.py:3051`), `Z` = `hit_rate` mit Ties × 0,5
   (`app/feedback.py:3119-3120`). Numerisches Beispiel: 2× „win", 1× „tie",
   1× „loss" ergibt die Zeile „2 von 4 trafen zu (63 %)" — beides ist jeweils
   richtig, im selben Satz aber mathematisch unverträglich. Eine der beiden
   Größen (empfohlen: Credits wie `hit_rate` als Trefferzahl oder die Angabe
   klar trennen) gehört aus dem Satz.

### A4 — „Tagesmedian" ist bei gerader Stichprobe der obere Rand, nicht der Median (mittel)

`web/src/now.ts:968-972`:

```
const median = open.length
  ? [...open.map((cell) => cell.value)].sort((a, b) => a - b)[
      Math.floor(open.length / 2)
    ]
  : null;
```

Bei gerader Zahl offener Stunden (der Normalfall: der Polling-Tag hat 18
Öffnungsstunden) ist das der **zweite Mittelwert** (oberer Median), nicht der
Median. Gezeigt wird „Tagesmedian" im „Heute im Blick"-Panel
(`web/src/views/Jetzt.tsx:905-953`) plus die Zeile „Jetzt X ct über/unter dem
Tagesmedian" (`dayPanel.nowVsMedianCt`). Bei einem typischen
Stundenminimum-Verlauf mit ~0,4-0,8 ct Abstand der mittleren Zeilen liegt der
angezeigte Median systematisch zu hoch, „Jetzt vs. Median" entsprechend zu
tief. Klein, aber eine sichtbare Statistik-Abweichung ohne Benennung — die
Lösung ist der Mittelwert der beiden mittleren Werte oder die Benennung
„mittlere Stunde (obere)".

### A5 — Stufe B („Empfehlung ohne Prozent") ist unerreichbar (niedrig)

`nowStage` (`web/src/now.ts:143-150`): `calibrated → "A"`, sonst Handlung =
`"B"`, `no_advice = "C"`. Der Server erzwingt aber:
`is_calibrated` kommt vom M7-Gate (`app/decide.py:1573, 1889`); `if not
is_calibrated: blocking_reasons.append("m7_pending")`
(`app/decide.py:1689-1691`) erzwingt `action = "no_advice"`. Damit ist B
strukturell unmöglich: nicht kalibriert ⇒ `m7_pending` ⇒ `no_advice` ⇒ Stufe
C. Die Stufe-B-Texte sind toter Code:

- `web/src/now.ts:179-186` (stageProgressNote), `web/src/now.ts:678-687`
  (B-Zweig), `web/src/week.ts:283-284` („Prozent ab 100 Empfehlungen"),
  `web/src/week.ts:340` (B-Zweig);
- das Regelwerk dokumentiert Stufe B weiter (`docs/produkt/MICROCOPY.md:211`).

Entweder Stufe B freischalten (Empfehlung ohne Prozent wirklich zeigen, wenn
das Gate fehlt) oder die Texte und Zeile 211 des Regelwerks entfallen lassen.
Der Status quo ist ein Dokumentations-/Implementations-Bruch.

### A6 — Umweg-Schätzung: `route.py` und `decide.py` rechnen dieselbe Quelle verschieden (niedrig)

Ohne Stations-Koordinaten schätzt beide Seiten den Umweg aus der Differenz der
Anker-Distanzen, Quelle `estimated_anchor_difference`:

- `app/decide.py:941-944`: `max(0.0, abs(dist_cand − dist_self))` — symmetrisch;
- `app/route.py:443-444`: `max(0.0, target_dist − ref_dist)` — einseitig (näher
  liegendes Ziel ⇒ `0`).

Gleiche Eingaben ergeben also je nach Endpoint verschiedene Umwege und damit
verschiedene Netto-Beträge. Die dedizierte Quellenangabe ist identisch; der
Nutzer sieht je nach View („Route bewerten" vs. „Woanders") für dasselbe
Stationspaar zwei Werte.

### A7 — `latest_by`-Verhalten: Docstring und GUI-Hinweis behaupten eine Regel, die der Code nicht hält (niedrig)

- `app/decide.py` `_today_windows` (~Zeilen 712-760), Docstring: „und mit
  `latest_by` nur Blöcke, die vollständig vor dem spätesten akzeptablen
  Tankzeitpunkt enden (Konzept §4.3: Fenster ⊆ [jetzt, T_max])." Der Code
  behält dagegen **abgeschnittene Fenster** (`usable = … stamp <= latest_by`,
  `end = usable[-1][0]`) — die letzte nutzbare Raster-Minute vor `latest_by`.
- Der Jetzt-Hinweis `assumptionHint` (`web/src/now.ts:736-753`) behauptet:
  „der Server zählt ein Fenster nur, wenn es vor latest_by ENDET. Kippt zu
  „Jetzt", wenn das Tanken vor {Fensterende} fällig wird." Der echte
  Kipp-Punkt liegt am **Fensterbeginn**: Erst wenn `latest_by` vor dem Anfang
  des empfohlenen Fensters liegt, verschwindet es (`horizon_cut`-Logik,
  `app/decide.py:1509`). Wer die Zeit eine Stunde in das Fenster hineinlegt,
  sieht das Fenster weiter — verkürzt und ohne Draw-Zahlen
  (`draw_scope`-Erklärung) — statt eines Kipps.

Konform ist eher das Konzept (Fenster sind Teilmengen von [jetzt, T_max]);
ehrlich wäre der Hinweis „Fenster wird gekürzt, sobald die Zeit ins Fenster
fällt — zu „Jetzt" kippt es erst unterhalb {Fensterbeginn}".

### A8 — Labor-Scoring: TS-Spiegel `scoreRows` weicht in Randfällen vom Server ab (niedrig)

`web/src/data.ts:1441-1448` gegen `app/stats_summary.py:177-183`:

- `p_avg`: TS fällt bei keiner Zeile mit bekanntem P auf `0` zurück (`nP ?
  … : 0`), der Server weist `null` aus (`… if n_p else None`). Aggregate
  (`labTotals.pAvg`, `web/src/views/laborModel.ts:146-156`) wichten diese
  Nullzeilen mit und senken damit den Mittelwert — die Rechnung läuft zwar
  aktuell ins Leere (`pAvg` wird nirgendwo mehr gerendert), die Fixture
  `tests/fixtures/score_parity.json` enthält aber keinen alle-`p`-`null`-Fall.
- `pot_share`: TS `: n ? 0 : 0` ist tot und entspricht der Server-`null` bei
  `sum_best = 0` nicht; gleiche Argumentation.

## 3. B — Befunde GUI-Texte

### B1 — „spart netto +X €" und das angezeigte Prozent messen zwei verschiedene Ereignisse (mittel)

Bei `refuel_elsewhere` zeigt Stufe A drei Zahlen: Name, „spart netto +X €" und
ein Prozent. „netto" und der Verdict-Wert (`worth_it`) kommen aus der
Umweg-Ökonomie (Netto, §10). Das Prozent (`p_correct = p_decision =
p_better_alt`, `app/decide.py:1622, 1663-1669`) ist dagegen
**P(Alt-Fenster-Minimum ≤ Ankerpreis − 1 ct) — brutto, ohne Umwegkosten**.
Auch die Messung im Ledger (Settlement „refuel_elsewhere, brutto (Umwegkosten
stecken in der Empfehlung)", `app/feedback.py:2334-2337`) prüft nur das
Brutto-Ereignis. Leser sehen also „83 %" neben „spart netto +1,80 €" — wobei
die 83 % garantiert **nicht** den genannten €-Betrag trifft. Fair wäre
entweder `p_lohnt` = P(Netto > 0) anzuzeigen oder den Satztitel sauber zu
trennen („brutto billiger" vs. „netto lohnt sich"). Aktuell hängt das
Benennelement am deterministischen Rechenweg des Verdicts und die Messung am
Brutto-Pfad — beide nebeneinander lesend suggerieren eine Zusammengehörigkeit,
die keiner der beiden Pfade mathematisch trägt.

### B2 — „Warte-Empfehlung zu unsicher (P < 50 %)" — Schwellwert fest verdrahtet (niedrig)

`app/decide.py:1265-1269`: Text sagt „(P < 50 %)", verglichen wird aber
`p_besser < th["now_p"]` — die aktive Schwelle kommt aus der M7-Regulatur
(`app/thresholds.py`) und kann vom Startwert 0,50 abrücken. Dann behauptet
der Grundsatz einen falschen Schwellwert. Korrektur: Zahl aus
`th["now_p"]` interpolieren.

### B3 — Regelwerk-Drift: MICROCOPY vs. App (niedrig)

- `docs/produkt/MICROCOPY.md:336` benennt in der `dataAgeNote`-Tabelle die
  Modell-Frischeschwelle mit **180 Minuten**. Seit B5 gilt im Code
  `STALE_AFTER_MINUTES.model = 24 · 60` (`web/src/data.ts:3413-3423`; dort ist
  die Begründung dokumentiert: „das markierte ein gesundes System stur „alt"").
  Das Regelwerk führt damit Grenzen, die die App bewusst nicht mehr zeigt.
- `docs/produkt/MICROCOPY.md:211` (Stufe-B-Satz mit Countdown) bezieht sich
  auf Anzeigezustände, die der allgemeine Regelfall nie erreicht (siehe A5).
- Kommentar-Drift in der Engine: `engine/calibration.py:88-93`, Docstring
  spricht von „2,5-pp-Gitter", der Code nutzt 401 Levels (0,25 pp) —
  `PIT_LEVELS` und der Konstanten-Kommentar sind korrekt, der Docstring nicht.

## 4. C — Mathe/Statistik: geprüft und entlastet

Die folgenden Kernpfade wurden zeilenweise gelesen und sind sauber;

**Engine (`engine/`)**: `models.py` vollständig — DST-sichere Wanduhr-Segmentierung
 der Mittagsgrenze (`wall_clock_hour`), AR(2)-Stabilisierung mit Audit-Feldern,
 Holiday-Pooling aus Jahr-shistorie, Ensemblemischung ∝ 1/MASE aus lokaler
 Eine-Schritt-Validation (`ensemble_detail`), Day-Pair/Shared-Draw-Systematik
 mit Salz (bitgleiche Reproduktion gegen 0.57, A11/B3), Missingness-Policy mit
 Messinstrumentierung (`fill_residual_draws`, A21-B5.2), PAVA-Pool-Statistik
 rein diagnostisch. `calibration.py` vollständig — PIT-Midrank-Rekalibrierung
 ist zeitlich getrennt (2/3 / späteres 1/3), 2-pp-PICP-Release-Gate,
 Abdeckungsbänder aus Tagesblock-Bootstrap plus Kish-ESS statt aus Tick-Zahlen
 (M6), Provenienz-Fingerprint (kind/shared/day_pair invertiert sicher).
 `backtest.py` Kern — Mid-Rank-PIT mit 0,5-Credit bei Ties, Pinball
 asymmetrisch mit Referenzmischung, MASE mit transparenten `none`-Gründen,
 Rolling-PICP als Tagesquoten-Mittel (O4, ein Tag/eine Stimme) mit
 Hysterese-Badge, Strict-End-Schnitt (Bericht ist reine Funktion der
 Vergangenheit). `bootstrap.py` — Buckets-Eigentum des ersten Live-Polls wird
 nie vom Archiv überschrieben; Gapfill nur markiert und nach Beweislage.

**Entscheidung/Kette (`app/`)**: `pside.expected_saving` = Median der
 Draw-Minima (benannt als Fenster-Minima-Basis) konistent mit Settlement;
 `quantity.py` physischer Modus mit What-if; `thresholds.py` H3-Regulator mit
 Rauschband ±2 SE, Deadbands und Schrittbegrenzung deterministisch aus dem
 Ledger; `stats_summary.py` Scores mit O21-Fix (gleiche Einheiten im
 Verhältnis) + Fixture gegen TS; `benefit.py` Vertrag benennt every Basis
 (Median-Potenzial ≠ arithmetische Erwartung, `strategy_utility = None` beim
 Emit, Oracle-Untergrenze getrennt). `feedback.py`: sequentieller
 Schrumpfungs-Schätzer `estimate_p` (expanding window, §0.4), tie-Credit, O5-
 Quellen ja pro Brier-Reihe, O6-Gate über Block-Bootstrap-CI (Tagesblöcke)
 gg. beide naive Referenzen, A21-B5.1-Cohorten korrekt hergeleitet;
 Serien-Abrechnung mit Kulanzschlitz (±, doc-beschrieben). `route.py`
 `net_economics` ist die eine ökonomische Quelle für alle Pfade (O9).

**GUI-Rechnungen ohne Defekt**: `web/src/strip.ts` vollständig —
 Kalendertag-Schnitt (0.49.3), Band aus Server (25./75.-%-Quantilen der 7-Tage
 -Verteilung), „unbewertet ohne Band" statt geratenem Urteil; `web/src/now.ts`
 Windo-Saving-Basen benannt (O45: `expected_saving_median_eur` neben
 dem behaupteten Draw-Potenzial, `windowSavingEur` mit Alt-Payload-Fallback);
 `web/src/lab.ts` Beta-kredibles Intervall sauber (Lanczos-betacf +
 Bisektion); `fuel-Style` `fills.ts` Ersparnis-Töne konsistent positiv =
 günstiger, `observed_at`-basiertes Altern von Preisen; V(S)-Karte mit
 Towns-Filtern.

## 5. Bewusst kein Befund

Zur Vermeidung von Fehlalarm des früheren Verdachts:

- **stage A/B/C-Ampel jetzt/Woche**, Fenstersterne (75/55/35 auf normalisiertem
  Lift) — Designentscheidung (O12), keine Wahrscheinlichkeitsbehauptung;
  Worttreppen `wordFromPercent` (75/55) decken sich mit MICROCOPY, nur die
  B-Stufe ist tot (A5).
- **`quantity_mode` what-if Blocker** und „bis zu"/„im Mittel"-Markierung des
  Warten-Grunds — dokumentiert, kollabiert exakt zur jeweiligen Basis (siehe
  `_wait_saving_clause`, `app/decide.py:1103-1130`).
- **E2E-Mocks mit `net_eur: 2.3`** — die Fixtures benutzen die echte
  Server-Konvention; nur der Atlas liest sie verkehrt herum (A1), kein
  Mock-Fehler.
- **`weekTankLine` „inkl. Reserve ≈ R km"** — lesbar als „Restreichweite
  inkl. der Reserve-Anteil R" und somit Reutersquell-Text, kein Rechenfehler.

## 6. Empfohlene Reihenfolge der Korrekturen

1. **A1** (Atlas-Vorzeichen und -Sortierung): direkte Nutzerschädigung —
   empfohlene Stationen erscheinen teuer. `atlasEur`/`sortAtlasRows` korrigieren,
   `stations.test.ts:303-311` und betroffene Sortier-Tests am Fix verscherbeln.
2. **A2** (F2 mit altem Alternativpreis): deterministisches `net_eur` nur aus
   frischem Preis — sonst Null/reine Draw-Basis mit `p_lohnt` gate; alternativ
   `station_unusable`/Frische des Alternativkandidaten in die Sperrkette.
3. **A3 + A4** (Zähler und Tagesmedian): kleine klare Fixes, unmittelbar
   nutzersichtbar; Tests nachziehen (30d → Gate-Felder; echter Median).
4. **B1** (netto behauptet, brutto gemessen): Textseitig trennen oder `p_lohnt`
   als Prozent ausgeben.
5. **A5/B3** (toter Pfad + Regelwerk): entweder Stufe B implementieren oder
   MICROCOPY-B-Texte + toten Code entfernen; Modell-Frische 1440 im Regelwerk
   nachziehen.
6. **A6/A7/A8/B2**: Gleichlauf der Umweg-Schätzung, ehrliche `latest_by`-Texte,
   `null`-Paritet der Score-Ränder, Schwellwert-Interpolation.

Nicht Thema dieser Prüfung (explizit offen): Betriebsnachweis auf
NAS-Daten, Kalibrierung der produktiven 24-h-Veröffentlichung (out-of-sample
Replay publizierter Kurven), Zielhardware-Latenzen des Pi — das steht
unverändert in `docs/planung/LUECKEN.md`.
