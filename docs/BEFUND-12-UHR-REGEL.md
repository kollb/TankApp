# 12-Uhr-Regel — Befund-Report

> Stand: 18.09.2026 · App-Version 0.51.0 (§4 nachgerechnet und umgesetzt).
> 17.09.2026 (Stimmt die Preislogik/Anzeige noch, seit die 12-Uhr-Regel
> gilt?) in fünf Lagen: Problem, Befund, Erledigtes, Schritt 3, Nicht-Fixbares. Daten: Live-Export der eigenen NAS
> (`export_influx.py --uuid-only`, 5-Minuten-Takt) und der Archiv-Kontrast
> auf demselben `analysis/noon_rule_check.py`-Gerüst — kein Modell, kein
> Bauchgefühl, nur Beobachtungen. Werkzeug-Doku:
> [DATENWERKZEUGE.md#12-uhr-regel-check](DATENWERKZEUGE.md#12-uhr-regel-check).

## Inhaltsverzeichnis

- [Kurzfassung](#kurzfassung)
- [1 · Was war das Problem](#1--was-war-das-problem)
- [2 · Was die Daten belegen](#2--was-die-daten-belegen)
- [3 · Was bereits gefixt wurde](#3--was-bereits-gefixt-wurde)
- [4 · Schritt 3 (B30) ist umgesetzt](#4--schritt-3-b30-ist-umgesetzt)
- [5 · Was sich nicht fixen lässt](#5--was-sich-nicht-fixen-lässt)
- [Anhang · Reproduktion](#anhang--reproduktion)

## Kurzfassung

- **Problem:** Die Anzeige empfahl weiter „abends günstig", während seit
  01.04.2026 die 12-Uhr-Regel das Muster gewaltsam gedreht hat.
- **Befund:** Live-Daten folgen der Regel exakt (100 % der Erhöhungen am
  Mittagspunkt, Tief im Vormittag); das Abend-Muster war die Realität von
  **vor** dem Gesetz und steckte in den alten Daten.
- **Gefixt:** Anzeigefehler (Tagesstreifen quer über Mitternacht, 0.49.3),
  Werkzeug-Lauffähigkeit auf der NAS (0.49.4/0.49.5), Lesbarkeit des
  Labors (0.49.2); Beweis, dass `price_law_local` in der Prognose greift.
- **Schritt 3 (B30) erledigt (0.51.0):** Beobachtungs-Panels, Selektion,
  Kalibrierung und beide Offline-Werkzeuge zählen nur Beobachtungen **ab**
  `price_law_local`; Payload und GUI nennen, was ausgeblendet ist. Die
  Prämisse dieses Kapitels war dabei rechnerisch veraltet — §4.1.
- **Nicht fixbar:** Legacy-Serien mit Namenszwilling (nie wieder
  zuordenbar), gerastertes Archiv ohne exakten Sprungzeitpunkt, die
  Vergangenheit selbst — und dass das Gesetz befristet ist (darum
  konfigurierbar statt hardcodiert).

## 1 · Was war das Problem

Seit dem **01.04.2026** darf der Preis an Tankstellen nur noch **einmal
täglich um 12:00 erhöht** und jederzeit **gesenkt** werden
(Kraftstoffpreisanpassungsgesetz, zeitlich befristet; App-Seite:
`engine/config.py: price_law_local`). Anfang September 2026 zeigten die
Anzeige-Kästen weiter Muster der alten Welt: „Günstigste Stunde 20–22 Uhr",
„Abend günstig". Doppeltes Misstrauen war berechtigt:

1. **Anzeige-Fehler:** Der Tagesstreifen („Heute im Blick") stand auf einem
   24-h-rollierenden Fenster — am Nachmittag stammten die Zellen 18–24 Uhr
   aus den Meldungen von **gestern Abend** und lasen sich wie ein Tipp für
   heute.
2. **Daten-Frage:** Selbst sauber geschnitten bleibt offen, *was* die
   Panels da messen: Stimmt der Bestand (Modell- und Beobachtungs-Basis)
   überhaupt noch mit der Realität der 12-Uhr-Ära überein?

Die Prüfung lief in drei Schritten: (1) Anzeigefehler sauber aussortieren,
(2) Datenlage auf dem echten Bestand messen, (3) daraus Konsequenzen für
Anzeige und Modell. Schritt 1+2 sind erledigt; Schritt 3 ist auf Wunsch
ausgelagert (§4).

## 2 · Was die Daten belegen

### 2.1 Live-Beweis (eigener 20-Stationen-Bestand, 5-Minuten-Takt)

Export `--uuid-only`, **09.09.–18.09.2026**, 17 388 gültige E10-Preise,
171 Stationstage mit genug Substanz:

| Messung | Ergebnis | Lesart |
|---|---|---|
| Anstiege ≥ 1 ct am 12-Uhr-Punkt | **169 von 169 — 100 %** | Kein einziger Anstieg außerhalb des Mittagspunkts. Die Stationen halten die Regel exakt. |
| Stunde des Tagestiefs | **84 % im Block 6–12, Median 7 Uhr** | Das Tief ist in den Vormittag gerutscht — Ende des Abtrags vor der Mittagserhöhung. |
| Stunde des Tageshochs | **97 % im Block 12–18, Median 12** | Das Hoch sitzt direkt nach der Mittagserhöhung. |
| Sprung über die 12-Uhr-Kante | **Median 0 ct; 44 % ≥ 2 ct; max 26 ct** | Keine tägliche Pflicht-Erhöhung: An über der Hälfte der Tage bleibt es mittags flach. Aber wenn erhöht wird, dann nur dort. |
| Tages-Spanne | **Median 17 ct** | Deutlich größere Amplitude als früher (10 ct) — der Zeitpunkt kostet jetzt richtig Geld. |

Dazu der Prognose-Nachweis aus demselben Betrieb: In den publizierten
Kurven steigt **kein einziges Preis-Segment** an — `price_law_local`
greift und bricht jede Ziehung auf „steigt nur um 12:00, fällt danach".

### 2.2 Archiv-Kontrast (282 Stationen, 01.03.–18.09.2026, 1 245 257 Beobachtungen)

Derselbe Check auf dem M2-Aufbereitungsbestand, getrennt vor/nach
Gesetzesbeginn — die Frage war: Lebt das alte Muster wirklich in den
langen Daten?

| Messung | **vor 01.04.2026** | **ab 01.04.2026** | Regime-Wechsel |
|---|---|---|---|
| Tagestief-Verteilung | **41 % Abend (18–24)**, 5 % Block 6–12, Median 13 Uhr | 13 % Abend, **23 % Block 6–12** plus 31 % Block 0–6, Median 11 Uhr | Das Abend-Tief löst sich auf, der Vormittag wird hart |
| Tageshoch-Verteilung | **83 % Block 6–12**, Median 8 Uhr | **97 % Block 12–18**, Median 14 Uhr | Spiegelbildlich gedreht |
| Tages-Spanne | Median 10 ct | Median 16 ct | Amplitude wächst |

**Befund:** Das Abend-/Früh-Muster im Archiv ist kein Fehler der Panels —
es ist die korrekte Beschreibung der Welt **vor** dem 01.04.2026. Panels,
die über den rollierenden Bestand mischen, zeigten damit eine altgewichtete
Ansicht; nach dem Gesetz gilt das Gegenteil.

### 2.3 Caveats des Archiv-Laufs (Ehrlichkeit vor Zeigen)

- Die M2-CSVs sind **gerastert** (60 min): Der echte ~4-Minuten-Sprung um
  mittags verwäscht über Rasterpunkte — Tabelle „Anstiege am Punkt" und
  „12-Uhr-Kante" der Archiv-Datei sind **nicht entscheidbar** (der
  ±10-min-Toleranzrahmen des Checks ist kleiner als die Rasterperiode).
  Belastbar bleibt die **Tagesform** (Tief/Hoch-Blöcke), die den Wechsel
  eindeutig zeigt; den exakten Sprungzeitpunkt beweisen die
  5-Minuten-Live-Daten (§2.1).
- **9 829 Anstiege** lagen über der Lücken-Grenze und stehen in der Datei
  ehrlich als „nicht bewertbar" — sie werden nicht außerhalb/hinein
  gerechnet.

## 3 · Was bereits gefixt wurde

| Version | Wirkung |
|---|---|
| **0.49.2** | Labor-Achse „Preis-Abstand je Station" lesbar bei ~20 Stationen — Vorbedingung, das Labor gegen echte Sätze zu lesen. |
| **0.49.3** | Tagesstreifen strikt auf den Berliner **Kalendertag** geschnitten (gestern taucht nicht mehr als heute auf; Regression in `strip.test.ts`). **Werkzeug** `analysis/noon_rule_check.py` für genau diese Befund-Messung. Doku: Beobachtungspanels sind modellfreie Messung, Prognose ist gesetzesgesteuert. |
| **0.49.4** | Check **eigenständig** (nur numpy/pandas — bricht nicht mehr über matplotlib/engine an der NAS); Klartext-Installationsrezept; NAS-Runbook inkl. `--env-file data/influx.env` und `--since` vor dem Gesetz. |
| **0.49.5** | Check verträgt Tage **ohne gültige Preise** (ganztägig geschlossene Station warf `All-NaN slice`); zentraler valid-/finite-Filter, Lücken werden als „nicht bewertbar" gezählt statt geraten; Regressions-Test nagelt den Absturz fest. |
| **0.51.0** | **Schritt 3 (B30):** 12-Uhr-Bodenkante als Schnitt in allen Beobachtungs-Pfaden — Heatmap, Selektion, Modell-Fit, Preis-Zwillinge und Stations-Selektion zählen nur Daten ab der Kante; Payload, GUI und Publikations-Index nennen Kante und ausgeblendete Punkte. Messbar über `law_quality`, abschaltbar über `TANKAPP_LAW_FLOOR=0` (s. §4). |
| **Merge mit main (0.49.1/0.50.0)** | Paralleler Schub (Batch 6: u. a. **O20 feste Farbskala + Stunden-Minimum** im Tagesstreifen) ist mit dem Kalendertag-Schnitt **vereinigt** — beide Zusagen gelten gleichzeitig (1134 Vitest). |

Dazu zwei Doku-Schienen: NAS-Ablauf und Datenquellen-Auswahl
(UUID-Ära vs. Archiv-M2) in
[DATENWERKZEUGE.md#12-uhr-regel-check](DATENWERKZEUGE.md#12-uhr-regel-check).

**Zwischenbilanz:** Die gestellte Einzelfrage („Stimmt die Anzeige noch?")
ist beantwortet: Der gezeigte Abend-Tipp war (a) ein echter
Zeitfenster-Fehler — gefixt — und (b) die ehrliche Wiedergabe alter Realität
in gemischtem Bestand — für bist dahin angezeigt Zahlen korrekt geblieben.
Die Daten der 12-Uhr-Ära ticken regeltreu, das bisherige Modell-Regelwerk
greift.

## 4 · Schritt 3 (B30) ist umgesetzt

Erledigt am 18.09.2026 (0.51.0). Konzept, Schnittreihenfolge und Abnahme in
[UMSETZUNG-B30-12-UHR-BODENKANTE.md](UMSETZUNG-B30-12-UHR-BODENKANTE.md).

### 4.1 Die Prämisse war rechnerisch veraltet

Dieses Kapitel kündigte an, die Panels „sagen sonst weiter die alte Welt“.
Nachgerechnet galt das für den Bestand von heute nicht: Die Regel steht bei
`price_law_local = 2026-04-01T12:00` (`engine/config.py:44`), seit **170
Tagen** (Stand 18.09.2026). Jedes Fenster mit Zeitbegrenzung beginnt dahinter:

| Pfad | Fenster | Start am 18.09.2026 |
|---|---|---|
| Kalibrierung (`train_days`) | 42 Tage | 2026-08-07 |
| Heatmap (`HEATMAP_WEEKS`, max. 12 Wochen) | 84 Tage | 2026-06-26 |
| Modell-Training (`Settings.model_days`) | 120 Tage | 2026-05-21 |
| Selektion, Preis-Zwillinge | **kein** Fenster — ganzer publizierter Bestand | — |
| Preis-Verlauf/Nachzug (`history_days`) | 365 Tage | 2025-09-18 |

Die Muster-Panels liegen also längst vollständig in der Nach-Gesetz-Ära; aus
diesem Bestand kann kein Abend-Tipp mehr entstehen. (Der Jahres-Nachzug ist
kein Muster-Panel: Im Preis-Verlauf sind Vor-Gesetz-Preise korrekt.)

Richtig bleibt der zweite Teil: **Zwei Pfade hatten überhaupt keine
Zeitgrenze** — `analysis/station_selection.py` und
`engine/station_comparison.py` werten den Bestand vollständig aus. Dazu
kommen die Fälle, in denen die Kante wieder scharf wird: ein verschobenes
`price_law_local` (Gesetzeswechsel, Backtest) und Archiv-Nachzug über
`app/gapfill.py`/`app/history.py`, der Vorsgesetzliches in den Bestand zieht.

Die Bodenkante ist deshalb eine **Garantie, keine Reparatur** — auf heutigen
Daten beweisbar ein No-op (`points_before_law = 0`, s. §4.3), bei
Rechtswechsel oder Nachzug die einzige Grenze, die noch greift.

### 4.2 Was geschnitten wird

| Pfad | Schnitt |
|---|---|
| Heatmap (`/api/v1/heatmap`) | Zellen zählen nur Beobachtungen ab der Kante; `law_floor`, `points_before_law` im Payload. Schnitt **vor** der Matrix — `ffill` hätte Vor-Gesetz-Preise sonst als erste Zelle hinter der Kante wieder auftauchen lassen. |
| Selektion (`/api/v1/selection`) | δ̂, Coverage und „billigste Stunde“ nur aus Nach-Gesetz-Daten; `law_floor`, `points_before_law`, `days_before_law` im Payload. |
| Kalibrierung (`engine/models.py::fit`) | `training_start = max(nominal, Kante)`; das Artefakt nennt `law_floor_active`, `pre_law_points_excluded`. Reicht der Nach-Gesetz-Bestand nicht für `min_train_days`, sagt der Fehler das mit Kante und Zahl statt „zu wenige Daten“. |
| Preis-Zwillinge (`engine/station_comparison.py`) | Paar-Vergleich zählt nur gemeinsame Beobachtungen ab der Kante; Report nennt `law_floor` und `points_before_law`. CLI: `--law-date`, `--ignore-law-floor`. |
| Stations-Selektion (`analysis/station_selection.py`) | Schnitt über denselben Baustein (`engine/selection.py::law_floor_split`); `--law-date`, `--ignore-law-floor`; Report nennt Kante und Zähler. |

**Kein Code dieser Lieferung legt das Gesetz hart fest.** Die Regel bleibt
ein konfigurierbarer Wert (`engine/config.py: price_law_local`,
`TANKAPP_PRICE_LAW_LOCAL`); die Bodenkante liest ihn und ist über
`TANKAPP_LAW_FLOOR=0` abschaltbar.

### 4.3 Messen und Gegenmessen

Der Modell-Lauf schreibt den Anteil Vorsgesetzliches in den
Publikations-Index (`runtime/engine/current.json`, Feld `law_quality`:
`law_floor`, `points_total`, `points_before_law`,
`gapfill_events_before_law`, `by_fuel`) — damit der No-op-Beweis nicht
behauptet, sondern gelesen wird. Erwartung auf dem heutigen Bestand:
`points_before_law = 0` und `gapfill_events_before_law = 0`.

Gegenmessung (bewusst gemischter Bestand, z. B. um den Unterschied zu
zeigen): `TANKAPP_LAW_FLOOR=0` für die App, `--ignore-law-floor` für die
beiden Offline-Werkzeuge. Auf synthetischem Bestand kippt dabei das
Vorzeichen: Stations-Selektion δ̂ −3,0 ct (Kante) gegen +1,9 ct (gemischt),
„billigste Stunde“ 02:30 gegen 17:30 — genau die Aussage, die ein gemischter
Bestand erfindet.

### 4.4 Offen

Der DoD-Backtest „ohne Qualitätsverlust“ braucht echte NAS-Daten über beide
Rechtslagen. Er ist **nicht** gelaufen; das Runbook dafür steht in
[UMSETZUNG-B30-12-UHR-BODENKANTE.md](UMSETZUNG-B30-12-UHR-BODENKANTE.md)
(§6), der synthetische Nachweis ersetzt ihn nicht.

Optional und unverändert: Re-Ingest des Archiv-Zeitraums mit feinerer Dichte
(§2.3), falls exakte Sprung-Zahlen auch aus der Historie gebraucht werden.

## 5 · Was sich nicht fixen lässt

| Bestand | Warum nicht | Umgang damit |
|---|---|---|
| **Legacy-Punkte in Influx ohne `station_id`** (vor ca. 09.09.2026) | Bei Namenszwillingen („Aral Tankstelle") ist die Zuordnung nicht rekonstruierbar — jede Zuordnung wäre geraten (bewusst verboten, s. [STATIONS-UUID-MIGRATION](archiv/STATIONS-UUID-MIGRATION.md)). | Ehrlicher Weg: `--uuid-only`; die Serien bleiben stehen, nichts wird gelöscht. |
| **Exakter Sprungzeitpunkt im gerasterten Archiv** | 60-min-Raster kann den ~4-min-Sprung nicht lokalisieren (§2.3); die feineren Roh-Dumps sind zwar da, aber alter gerasterter Bestand bleibt, was er ist. | 5-Minuten-Polling liefert ab jetzt die Zeitpunkt-Beweise; bei Bedarf Re-Ingest mit feiner Dichte für die Neuzeit. |
| **Vergangene Panel-Anzeigen** | Was vor dem Schnitt angezeigt wurde, war für den damaligen Bestand korrekt (alt) beziehungsweise durch den Fenster-Fehler verzerrt (gefixt) — Rückwirkendes Ummalen erfindet eine andere Vergangenheit. | Dokumentiert hier; der Befund bleibt im Archiv. |
| **Befristung/Änderung des Gesetzes** | Heute gilt die 12-Uhr-Regel; morgen kann ein anderes Schema gelten. Jede feste Verdrahtung („günstig 20–12 Uhr o. ä.") wäre beim nächsten Beschluss falsch-kalibrer. | Gesetz bleibt **Konfiguration statt Logik** (`price_law_local`); der Befund-Kalk (dieses Skript) misst bei jeder Rechtslage weiter. |

## Anhang · Reproduktion

```bash
# Live-5-Min-Daten (UUID-Ära; Stand 09.09.2026+):
python data-tools/export_influx.py --fuel e10 --env-file data/influx.env \
    --uuid-only --since 2026-09-09 --out data/export_uuid.csv
.venv-analysis/bin/python analysis/noon_rule_check.py \
    --data data/export_uuid.csv --fuel E10

# Archiv-Kontrast (Vor/Nach-Gesetz; aus den Tankerkönig-Tagesdumps):
python data-tools/ingest_history.py \
    --since 2026-03-01 --out data/ready-noon --fuel e10 \
    --anchor "Frankfurt:50.11,8.68"
.venv-analysis/bin/python analysis/noon_rule_check.py \
    --data data/ready-noon/*.csv* --fuel E10 \
    --report data/analysis/report_noon_rule.md
```

Gefundene Fehlbedienungen auf dem Weg (nur der Vollständigkeit halber —
alle im Runbook in [DATENWERKZEUGE.md](DATENWERKZEUGE.md) dokumentiert):
`--env-file` fehlte beim ersten Export; `--raw` mit einer Datei statt dem
Verzeichnis belegt; Anker-Flag statt `analysis/config.local.json`;
Copy-Paste-Doppelziele in der Shell.
