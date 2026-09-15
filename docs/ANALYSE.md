# TankApp Analyse — Selektion, Modelle, Heatmaps

> Stand: 15.09.2026 · App-Version 0.38.0 — B3-Aggregate, P-Seite aus der
> Prognoseverteilung (11.09.2026), Hampel-Filter, Rolling-PICP und Güte-Gate
> enthalten; seit 0.25.0 Coverage-Gate im Polling-Fenster und relativ zum
> Stadt-Bestwert (B21). Methodik-Nachschlagewerk, keine Checkliste: Einrichten
> [INSTALL.md](INSTALL.md), rechnen lassen [BETRIEB.md](BETRIEB.md),
> offene Punkte [LUECKEN.md](LUECKEN.md) · [TODO.md](../TODO.md).

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Stations-Selektion — Meine Stationen mit δ̂](#stations-selektion--meine-stationen-mit-δ)
  - [Coverage-Gate — woran gemessen wird (B21)](#coverage-gate--woran-gemessen-wird-b21)
  - [Relative Preislage δ̂](#relative-preislage-δ)
  - [Bootstrap-KI & FDR](#bootstrap-ki--fdr)
  - [AV-Score & billigste Stunde](#av-score--billigste-stunde)
  - [NAS Artefakte B3.10](#nas-artefakte-b310)
  - [Lebenszyklus der Stationen](#lebenszyklus-der-stationen)
  - [Preis-Zwillinge](#preis-zwillinge)
- [Heatmaps DoW×Stunde B3.9](#heatmaps-dowstunde-b39)
  - [Niveau](#niveau)
  - [Cheap-Probability](#cheap-probability)
  - [Günstigste Stunde, Gleichstand und Reichweite](#günstigste-stunde-gleichstand-und-reichweite)
- [Zeitreihen-Engine](#zeitreihen-engine)
  - [Aufbereitung](#aufbereitung)
  - [Strukturmodell + AR2](#strukturmodell--ar2)
  - [12-Uhr-Regel](#12-uhr-regel)
  - [Backtest & Güte](#backtest--güte)
- [Wahrscheinlichkeiten aus der Prognoseverteilung (P-Seite)](#wahrscheinlichkeiten-aus-der-prognoseverteilung-p-seite)
- [Umweg-Ökonomie B3.12](#umweg-ökonomie-b312)
- [Verweise](#verweise)

## Überblick

TankApp hat drei Analyse-Schichten:

1. **Selektion** (welche 10 Stationen live pollen?) — δ̂ Ranking mit Signifikanz
2. **Zeitreihe** (wie teuer wann?) — robuste Tagesform + AR2 + Bootstrap
3. **Aggregate** (wiederkehrende Muster?) — Heatmaps DoW×Stunde, Meine Stationen

Alle Schichten liefern JSON-Artefakte nach `data/runtime/`, die die GUI via Nur-Lese-API zeigt. Keine Demo-Daten als Ersatz.

## Stations-Selektion — Meine Stationen mit δ̂

Pipeline: `analysis/station_selection.py` — Schema siehe [DATENWERKZEUGE.md](DATENWERKZEUGE.md#datenformate). Echter Bericht lokal als `data/analysis/report_top10.md`, synthetische Berichte sind kein Abnahmenachweis.

| # | Komponente | Verfahren | Funktion |
|---|---|---|---|
| 1 | Relative Preislage δ̂ᵢ | Medianᵢ(t) von pᵢ(t) − Medianⱼ≠ᵢ pⱼ(t) (Leave-One-Out-Baseline) + EW-Median über Tages-δ̂ (HWZ 7d, F5) + CUSUM-Bruchflag | Gewicht 0.40 (auf EW-Median) |
| 2 | Inferenz | Exponentiell gewichteter Tages-Block-Bootstrap B=2000 (HWZ 14d, neuere Tage höheres Ziehgewicht) → 95%-KI; p-Wert H0: δᵢ≥0; Benjamini-Hochberg FDR q<0.05 | Signifikanz-Gate |
| 3 | Verfügbarkeit AVᵢ | Σₕ wₕ·P(Top-3\|h); w = Tankzeitprofil werktags 06–09/16–20 | Gewicht 0.25 |
| 4 | Tagesform | robuste harmonische Regression (Huber-IRLS, 1.+2. Harmonische) → Amplitude, billigste Stunde, R² | Gewicht 0.15 |
| 5 | Risiko | σᵢ = 1.4826·MAD(Δᵢ); Streuung Tages-Mittelränge | Gewicht 0.10+0.10 |
| 6 | Datenqualität | Coverage-Gate ≥85 % je Station — gemessen im Polling-Fenster (06–24 Uhr) und relativ zum Bestwert der Stadt (B21, 0.25.0) | Ausschluss |

Kampagnen-Setup: drei Kampagnen Hessen, Bayern, NRW; Heimat Frankfurt am Main. Frankfurt hat 100+ Stationen im 25km Radius → globale Top-10 wird quotiert (Empfehlung 6/2/2, konfigurierbar), sonst dominieren Heimatstadt-Stationen.

Privatsphäre: Straße/Hausnummer nie im Repo; Heimkoordinaten nur in gitignorierter `analysis/config.local.json` (`--config`, Vorlage `config.local.example.json`); Feiertage je Bundesland via `--subdiv` (`HE`, `BY`, `NW`).

Kraftstoff: primär E10 für Selektion/Prognose/Heatmaps. Diesel/E5 werden ohne Extra-Request mitgesammelt (Historie+Nowcast); E5↔E10 nur als Äquivalenzpreis vergleichen: E5 lohnt erst bei p_E5 ≤ ~1,015·p_E10.

### Coverage-Gate — woran gemessen wird (B21)

Zeile 6 der Tabelle schließt Stationen mit zu dünner Datenlage aus. **Woran**
„zu dünn“ gemessen wird, war bis 0.25.0 falsch — und der Grund, warum die
Selektion im Dauerbetrieb immer null Stationen lieferte („e10: 0 Stationen“ im
Job-Log vom 12.09.2026). Das Gate verglich die Abdeckung je Station mit dem
vollen 5-Minuten-Raster über die gesamte Datenreichweite. Dagegen kommt der
Betrieb aus zwei strukturellen Gründen nicht an:

| Grund | Messwert | Folge |
|---|---|---|
| Der Collector pollt 06–24 Uhr (`Config.poll_start`/`poll_end`) — 25 % des Rasters sind nie besetzt, das 30-Minuten-ffill reicht nicht über die Nacht | **77,5 %** Maximalwert bei lückenlosem 5-Minuten-Polling (40 Tage, 8 Stationen) | `coverage >= 0.85` für jede Station falsch |
| Das Tankerkönig-Archiv liefert Preis-*Ereignisse*, keine Rasterpunkte; mit der dichten Live-Phase fällt der Median-Gap auf 5 min und das ffill auf 30 min, ein Ereignis deckt 30 von 216 Tageszellen | **4,8 %** (30 Tage Archiv + 2 Tage Live), **1,3 %** (120 + 2 Tage) | dito, im Bootstrap-Betrieb noch deutlicher |

Seit 0.25.0 misst `engine/selection.py` deshalb in zwei Schritten
(`scheduled_mask`, `coverage_gate`):

1. **Nenner = Zellen des Polling-Fensters** (06–24 Uhr in `Config.timezone`,
   durchgereicht aus derselben `Config` wie der Rest des Modell-Laufs). Wer
   nachts nicht pollt, dem fehlen nachts keine Daten.
2. **Schwelle relativ zum Bestwert der Stadt**: behalten wird
   `coverage ≥ min_coverage × max(coverage der Stadt)` — bei 85 % also
   „mindestens 85 % dessen, was die beste Station der Stadt liefert“.

Damit entscheidet das Gate wieder das, wofür es da ist: Wer deutlich seltener
liefert als die Vergleichsstationen, fliegt raus (Test: eine Station, die nach
Tag 5 verstummt, landet in `excluded`), und wer nur eine andere Datenquelle
oder ein 18-Stunden-Pollfenster hat, bleibt drin. Die Werte im Ranking ändern
sich dadurch nicht — wo das Gate bisher alles ausschloss, gibt es keine alten
Zahlen; wo es nicht bindet, ist die Rechnung bitgleich (Invarianz-Test:
Fenster 06–24 gegen 00–24 bei dichten 24-h-Daten).

**Ausweis im Artefakt** (`runtime/selection/{fuel}.json`, je Stadt):
`coverage_window` (`06-24`), `coverage_reference` (Bestwert der Stadt),
`coverage_threshold` (wirksame Schwelle), `excluded`/`excluded_count` und
`no_delta`/`no_delta_count` (Stationen ohne einzigen verwertbaren Zeitpunkt —
LOO braucht ≥ 4 Stationen mit Wert zur selben Zeit). Städte, für die kein
Ranking zustande kommt, bleiben als Eintrag mit `reason` und Reichweite
erhalten (`compute_all` → `diagnostics`), statt kommentarlos zu verschwinden.

**Offline-Pipeline bleibt absolut:** `analysis/station_selection.py` behält das
absolute Gate gegen das Vollraster mit `--min-coverage` (Default 0,85) — dort
arbeitet ein Operator mit der Fehlermeldung („Größeren Zeitraum wählen, Städte
zusammenlegen oder `--min-coverage` senken“) und kann reagieren. Der NAS-Job hat
diesen Operator im Moment des Laufs nicht und muss selbst entscheiden.

### Relative Preislage δ̂

Der Preis-Abstand δ̂ᵢ = Median über Zeit von (pᵢ(t) − Median_{j≠i} pⱼ(t))

- LOO-Median vermeidet mechanische Verzerrung (eigener Preis nicht in Baseline)
- Median statt Mittelwert → resistent gegen Preissprung-Artefakte
- Einheit ct/L, negativ = günstiger als Umgebung
- **F5/EW-Median (Issue 48):** Zusätzlich EW-Median über Tages-δ̂ (Halbwertszeit 7 Tage:
  5 Tage alte Tage wiegen ~61 %, 5 Wochen alte ~3 %) als `delta_ew_ct`, Median der
  letzten 5 Tage als `delta_recent5_ct` und retrospektiver CUSUM-Changepoint-Flag
  (`break_flag`, `break_stat`, Schwelle h=2,0; Skala aus Differenzen-MAD, damit ein
  Wechsel die Skala nicht maskiert). Der klassische
  Median über 42 Tage wäre bei Betreiber-/Strategiewechsel ~21 Tage blind (Mischung
  zweier Verteilungen); Ranking/Score nutzen deshalb den EW-Median (Fallback klassisch).

Beispiel: „langfristig 3,80 ct/L günstiger als Umgebung“ erscheint nur im Stations-Detail des Labors.

### Bootstrap-KI & FDR

- Exponentiell gewichteter Tages-Block-Bootstrap B=2000 (Issue 46): ziehe Tage mit Zurücklegen,
  neuere Tage mit höherer Wahrscheinlichkeit (Halbwertszeit 14 Tage), berechne je Ziehung Median Δ
- 95%-KI = 2,5% und 97,5% Quantile
- p-Wert = (1 + Anzahl(Bootstrap ≥0)) / (B+1), einseitig H0: δ≥0
- Benjamini-Hochberg über alle Stationen → q-Wert, signifikant bei q<0.05 (FDR kontrolliert)
- Der q-Wert ist der falscher-Alarm-korrigierte p-Wert: Unter allen als signifikant markierten Stationen sind höchstens q Fehlalarme erwartet

NAS-Job (B3.10): B=2000 fest (nicht sequenziell erhöhen). B=200 wäre ein Signifikanzblocker: p_min=1/(B+1) ergibt mit BH und m=11 Stationen q≥0,0547>0,05. Artefakt `runtime/selection/current.json`.

### AV-Score & billigste Stunde

- P_i(h) = P(Station ∈ Top-3 der Stadt | Stunde h) empirisch über alle Tage
- AV_i = Σ_h w_h·P_i(h), w = Tankzeitprofil (Default Pendlerfenster) — in der App die Ampel-Stärke: die gewichtete Verfügbarkeit bei 3 günstigsten
- Tagesform: robuste harmonische Regression der Halbstunden-Medianprofile Δ_i(h) = a1 cos(ωh)+b1 sin(ωh)+a2 cos(2ωh)+b2 sin(2ωh), ω=2π/24, Huber-IRLS
  - Amplitude A_i, Phase → billigste Stunde h*_i = argmin Fit-Kurve, gewichtetes R² als Vorhersagbarkeit
- Risiko: σ_i = 1.4826·MAD(Δ_i) und Rangstabilität

### NAS Artefakte B3.10

**Problem vorher:** Selektions-Artefakte fehlten auf dem NAS — nur lokal per `analysis/station_selection.py` erzeugbar, nicht automatisch.

**Jetzt:**

- Job `selection` täglich (Intervall 86400), nach Modell-Job best-effort
- Liest `runtime/training/*.csv.gz` (aus InfluxDB + Archiv) — echter Trainingsbestand, keine Demo
- Berechnet δ̂, KI, AV, billigste Stunde, Volatilität, Coverage, Score, Ranking
- Weist das Coverage-Gate aus (`coverage_window`, `coverage_reference`,
  `coverage_threshold`) und hält Städte ohne Ranking als Diagnose mit
  `reason` — „0 Stationen“ ist damit erklärbar, statt nur im Log zu stehen
- Publiziert nach `runtime/selection/current.json`
- API `/api/v1/selection?fuel=e10&city=Frankfurt` liefert „Meine Stationen“
- GUI-Bereich **Labor** (früher „Werkstatt“) zeigt die Tabelle mit Ranking, Bootstrap-KI-Whiskern, AV-Score, billigster Stunde

Falls kein Trainingsbestand vorhanden: `error_code: selection_not_available` → GUI zeigt ehrlichen Hinweis, keine erfundenen Rankings.

Datei `results/station_scores_<fuel>.csv` bleibt lokal für vertiefte Analyse, nicht im NAS-Image.

### Lebenszyklus der Stationen

Seit 0.32.0 (A12) unterscheidet die Selektion, **warum** kein Preis da ist —
vorher las sich „keine Daten“ in der GUI immer gleich, egal ob die Station
geschlossen war, die Sorte nicht führt oder seit Tagen schweigt. Der
Lebenszyklus beschreibt den Zustand der Station für diesen Kraftstoff. Die
Klassifikation läuft in `engine/selection.py::_station_lifecycle`, je
(Station, Kraftstoff), über die letzten `dead_after_days` **Kalendertage**
(Europe/Berlin, inkl. End-Tag, Default 7):

| Zustand | Bedeutung | Regel |
|---|---|---|
| `active` | Preis vorhanden | ≥ 1 verwertbarer Preis im Fenster |
| `dead` (tot) | kein Signal seit Tagen | kein Preis und nur Status „no prices“ (oder gar keine Zeilen) |
| `closed` | temporär geschlossen | kein Preis, Status durchgehend (oder zu > 80 %) „closed“ |
| `no_fuel` | führt die Sorte nicht | kein Preis, aber Status „open“ — die Sorte kommt als `false` |

Tote Stationen fallen **vor** dem Coverage-Gate aus der Preis-Matrix und
damit aus dem Ranking — sie belegen keinen Vergleichsplatz mehr. Geschlossene
und sortenlose Stationen bleiben benannt, aber vergleichslos: Sie laufen noch
durchs Gate (ohne Preise schließt es sie dort aus) und stehen in
`closed_stations`/`nofuel_stations`. Jede Ranking-Zeile trägt ihren Zustand
(`lifecycle`), je Stadt stehen `lifecycle_counts` und die drei Listen im
Artefakt, aggregiert `lifecycle_totals`; `dead_after_days` ist ausgewiesen.
`dead_after_days: 0`/`None` schaltet die Tot-Erkennung ab (Umgebung:
`TANKAPP_DEAD_AFTER_DAYS`, 0–365). Alarme: `stations_dead`,
`stations_lifecycle` (beide `warn`, [BETRIEB.md](BETRIEB.md)).

Bewusst **nicht** automatisch: der Umbau des Polling-Sets. Tote Stationen
werden weiter gepollt, bis sie per [Tausch-Anleitung](STATIONEN-TAUSCH.md)
ersetzt sind — wer nicht mehr gepollt wird, kann nie wieder „aktiv“ werden
(eine Selbst-Tot-Schleife), und ein Request holt bis zu 10 Stationen
(`prices.php`-Batch), sodass eine tote Station höchstens ein Zehntel Request
je Poll kostet. Der Pfad ist Alarm → System-Tab → Tausch mit Bestätigung,
nie ein stiller Umbau. Begründung: [LUECKEN.md](LUECKEN.md).

### Preis-Zwillinge

Preis-Zwillinge sind Stationen mit identischem Preisverlauf. Seit 0.32.0
(A13) warnt die Selektion vor ihnen — typisch Doppel-Source oder
Franchise-Überlappung, die das Ranking mit Schein-Vergleichen füllt.
Die Erkennung läuft in
`engine/selection.py::_detect_price_twins` mit denselben Schwellen wie der
manuelle Vergleich (`engine/station_comparison.py`, CLI `compare-stations`):

- ≥ **28 Tage** mit je ≥ **12 gemeinsamen** Zeitpunkten,
- ≥ **90 %** Beobachtungsüberlappung,
- ≥ **99 %** der gemeinsamen Preise innerhalb **0,1 ct/L**.

Jeder Treffer steht mit Paar, Punkten, Überlappung, Übereinstimmung und
Abweichungs-Kennzahlen (`mean`/`p95`/`max` des absoluten Abstands) als
`classification: possible_price_twins` im Artefakt (`price_twins`,
`price_twin_count`), als Warnung `price_twins` in `/health` und als Tabelle
im System-Tab. `auto_apply` ist immer `false`: Zwillinge werden **nie**
automatisch aus dem Polling-Set entfernt — prüfen, bestätigen, dann erst per
[Tausch-Anleitung](STATIONEN-TAUSCH.md) bereinigen.

## Heatmaps DoW×Stunde B3.9

**Lücke vorher:** Heatmaps DoW×Stunde (Niveau + Cheap-Probability) fehlten im Backend — GUI zeigte Platzhalter „Noch kein Backend“.

**Jetzt:**

### Niveau

- `GET /api/v1/heatmap?city=Frankfurt&fuel=e10&kind=level&weeks=6&station_id=...`
- Niveau = Medianpreis je Zelle (Wochentag × Stunde) über letzte N Wochen, Europe/Berlin
- Wenn `station_id` gesetzt: nur diese Station; sonst Stadt-Median (Median aller Stationen je Zelle)
- Matrix 7×24, Mo–So, 0–23 Uhr, Werte €/L oder null
- Quelle: InfluxDB letzte N Wochen, nur offene Preise

### Cheap-Probability

- `kind=probability`: Cheap-Probability in % je Zelle (DoW × Stunde, Berlin):
  - **mit `station_id`**: Stadtmedian pro Zelle = Median aller Stationen im selben (DoW, Stunde); je Zelle der Anteil der Preise der Station, die ≤ diesem Zellen-Median sind
  - **ohne `station_id`, `basis=hour` (Default der GUI, seit 0.11.0)**: je Zelle der Anteil der Preise ≤ **Median derselben Stunde** (Spalten-Basis: alle Wochentage dieser Stunde, alle Stationen des Fensters)
  - **ohne `station_id`, `basis=overall`**: Gesamtmedian = Median aller offenen Preise des Zeitfensters; je Zelle der Anteil der Preise ≤ Gesamtmedian (durchschnittliche Chance, dass ein zufälliger Preis günstiger als der Schnitt ist)
- Nur offene Preise, InfluxDB letzte N Wochen
- Grün = hohe Chance (≥80%), Rot = niedrige

**Warum zwei Basen? (B12)** Der Tagesgang (nachts/abends günstig, mittags
teuer) ist um ein Vielfaches größer als der Wochentags-Effekt. Gegen den
Gesamtmedian gerechnet werden Abendzellen deshalb fast immer grün und
Mittagszellen fast immer rot — egal welcher Wochentag. Die Frage „an welchem
*Wochentag* ist es günstig?“ ist in dieser Ansicht nicht ablesbar. Mit
Spalten-Basis wird jede Zelle gegen den Median **ihrer eigenen Stunde**
geteilt: Der Tagesgang ist herausgerechnet, die Zeilen (Wochentage) sind
untereinander vergleichbar. Beide Sichten sind richtig, sie beantworten
verschiedene Fragen:

| Basis | Beantwortet | Liefert |
|---|---|---|
| `hour` | „Welcher Wochentag ist zur selben Uhrzeit günstiger?“ | Zeilenvergleich, Tagesgang neutralisiert |
| `overall` | „Wie günstig ist diese Stunde insgesamt im Zeitraum?“ | absolute Einordnung, Tagesgang sichtbar |

Vergleichs-Basis und Zellen-Median sind nicht dasselbe: Die Spalten-Basis teilt
gegen alle Preise *dieser Stunde* (unabhängig von der Zahl der Stationen je
Zelle), der Zellen-Median gegen alle Preise *dieser Zelle*. Mit gewählter
Station bleibt es beim Zellen-Median — die GUI deaktiviert den Umschalter in
diesem Fall, weil er dort nichts ändert. Die Zellen selbst (und damit die
Spalten-Basis) enthalten die eigene Stichprobe; bei dünner Datenlage wandert
der Vergleichswert mit — die Heatmap bleibt eine Analyse-, keine
lten die eigene Stichprobe; bei dünner Datenlage wandert
der Vergleichswert mit — die Heatmap bleibt eine Analyse-, keine
Entscheidungsansicht.

Beide Heatmaps sind Analyse-, keine Entscheidungswerkzeuge — sie leben in der
Labor (früher „Werkstatt“), nicht auf „Jetzt“. Sie zeigen die
**Vergangenheit** (letzte N Wochen), keine Prognose für die kommende Woche.

Frontend: Umschalter Level/Probability, Wochen-Wahl 4/6/12 (E5, Default 6),
Basis-Umschalter für die Cheap-Probability ohne Station (B12), Station aus
Dropdown. Seit 0.10.0 (C10) zusätzlich unter der 7×24-Matrix:

- **Tages-Zusammenfassung** je Wochentag (Median + günstigste Stunde),
- **hervorgehobene heutige Zeile**,
- ein **Fazit-Satz** („Typisch am günstigsten: Di 17–18 Uhr — 2,219 €/L in
  dieser Stunde (Tagesmedian 2,239 €/L)“) und eine Erklärzeile, was „Niveau“
  und „Cheap-Prob“ bedeuten,
- seit 0.14.0 die **Datenreichweite** (Bestand + Zeitraum) und die
  Ehrlichkeits-Regeln unten.

Die Tages-Zusammenfassung rechnet auf der **angezeigten Größe**: Im Niveau ist
der Tages-Median der Median der Stunden-Mediane in €/L, in der
Cheap-Probability der Median der Zellen-Prozente — beide aus denselben
belastbaren Zellen (früher stand hier „immer auf dem Niveau“, das war seit
0.10.0 nicht mehr wahr).

### Günstigste Stunde, Gleichstand und Reichweite

Die „günstigste Stunde“ ist die einzige Empfehlung, die die Heatmap überhaupt
ausspricht — seit 0.14.0 (P0) gilt dafür ein Regelwerk, weil der erste echte
Tracking-Bestand drei Fehldeutungen gleichzeitig sichtbar machte:

| Regel | Schwelle | Warum |
|---|---|---|
| Eine Spalte = **eine** Stunde; Label „06–07 Uhr“ | — | „06–08 Uhr“ las sich wie ein Zweistundenfenster, das es im Raster nicht gab — die Aussage war nicht wiederzufinden |
| Zelle belastbar | `counts` ≥ 8 (`MIN_HEATMAP_POINTS`) | sonst bestimmt ein einzelner Nacht-Preis die Stunde |
| Zeile belastbar | ≥ 3 Zellen (`MIN_HEATMAP_CELLS_PER_DAY`) | kein Tages-Median aus ein, zwei Zellen |
| Gleichstand wird **ausgeschrieben** | ±0,05 % / ±0,0005 €/L | lagen zwölf Stunden gleichauf, war die erstbeste Nennung willkürlich |
| Vergleichs-Basis belastbar | `reference_counts` ≥ 30 (`MIN_HEATMAP_REFERENCE`) | 100 % „günstig“ aus einem Stunden-Median über 16 Preise ist Mechanik, keine Empfehlung |
| Reichweite sichtbar | `range_from`/`range_to` | Fenster (6 Wochen) ≠ Bestand (4 Tage): leere Wochentage sind fehlende Tage, kein Datenverlust |

Der nachgestellte Befund: Tracking-Start Dienstag, 8 günstige Dienstagspreise
je Stunde und je 2 teurere Preise der übrigen Tage → Stunden-Median über 16
Preise, jeder Dienstagspreis darunter, `100 %` für 06–17 Uhr. Die Zelle war
formal belastbar (n = 9), die **Referenz** nicht (n = 16). Anzeige seit 0.14.0:
Stunde „dünn“ markiert, statt „Typisch am günstigsten“ steht „Noch keine
belastbare ‚günstigste Stunde‘ … Vergleichs-Basis n=16, Mindestmaß 30“. Der
Zellwert bleibt stehen — die Heatmap ist eine Analyse-Ansicht, sie versteckt
nichts, sie empfiehlt nur nichts aus zu wenig Daten. `kind=level` hat keine
Vergleichs-Basis (`reference_counts: null`) und kann deshalb nie „dünn“ sein.

Rechnung und Beschriftung liegen als reine Funktionen in
`web/src/data.ts` (`heatmapDaySummaries`, `heatmapBestDay`, `hourRunsOf`,
`hourRunsLabel`, `heatmapCoverage`, `heatmapCoverageNote`), getestet in
`web/src/data.test.ts` und gegen echtes Markup in
`web/src/components/HeatmapGrid.test.tsx`; die Payload-Felder prüft
`tests/test_b3.py::test_heatmap_reports_reach_and_reference_sample`.

Die frühere Grenze (TODO B12: ohne Station überstrahlt der Tagesgang den
Wochentag) ist seit 0.11.0 als **Modus** gelöst, nicht als stiller
Verhaltenswechsel: `basis=overall` rechnet weiter wie früher, `basis=hour`
gegen die Spalten-Basis. Der API-Default bleibt `overall`, damit bestehende
Aufrufe (und die Doku dazu) gültig bleiben; die GUI schickt ohne Station
bewusst `hour` und erklärt die Wahl in der Erklärzeile unter der Matrix.

## Zeitreihen-Engine

Erster Durchstich in `engine/` liest echte Daten, fittet robuste Tagesform und Wochentags-Dummies mit AR(2)-Nachlauf, vergleicht gegen saisonale Naive und schreibt JSON-Artefakte. Bootstrap-Intervalle sind unkalibriert; `calibrated` und `decision_ready` bleiben false.

### Aufbereitung

1. 5-Min-Raster je (Station, fuel); Lücken → Forward-Fill ≤30min, sonst NaN + Staleness-Maske
2. closed-Spannen: Preis = letzter Open-Preis, Flag open=0; diese Segmente fließen nicht in Zyklus-Modellierung
3. Hampel-Filter (Fenster 1h, Median ±5·MAD) gegen API-Artefakte — **implementiert** in `engine/data.py::hampel_mask` (± 60 min, Schranke `max(5·1,4826·MAD, 1 ct)`, nur isolierte Einzel-Punkte; Zähler `hampel_removed_points` in `describe()`, Update 11.09.2026)
4. Tagesblöcke als Bootstrap-/Backtest-Einheit

### Strukturmodell + AR2

Ziel-Stack pro Station×Sorte:

- **M1 Strukturmodell (robust):** p(t) = μ + Σ[aₖcos(2πkh/24)+bₖsin(...)] + γ·X(t) + ε(t), X = DoW-Dummies + gepoolter Feiertags-Dummy je Bundesland (HE/BY/NW) + Zeit-seit-letztem-Preissprung; Huber-IRLS, rollierendes 6-Wochen-Fenster, tägliches Refit — **fertig** (Update 11.09.2026: Feiertags-γ aus bis zu 365-d-Pool via `TANKAPP_CITY_SUBDIVS`, Sprung-Hazard auf 168 h gedeckelt; Modell-Schema 2)
- **M2 Residuen-Nachlauf:** AR(2) auf ε(t) (Yule-Walker)
- **M3 Zweitmeinung:** UnobservedComponents / Holt-Winters plus saisonale Naive als Benchmark
- **Ensemble:** inverse-MASE-Gewichte aus 21-Tage Rolling-Backtest

Abnahme-Kriterien: MASE(24h) <0,95 gesamt und <0,80 sprungfrei, Pinball (τ=0,5 und asym τ=0,75,
Unterschätzung 3× bestraft) < Naive, Rolling-PICP(95%) ∈ [90,98]%.

### 12-Uhr-Regel

Seit 2026-04-01 dürfen Tankstellen Preis nur um 12:00 Uhr erhöhen; Senkungen jederzeit.

1. Strukturmodell: Mittags-Schritt nach 12:00 ab Gesetzesbeginn
2. Prognose-Projektion: Median und Bootstrap-Pfade je Segment [12:00, nächste 12:00) auf nicht-steigend projiziert (Pool-adjacent-violators)
3. Datenqualität: beobachtete Anstiege ≥1ct ohne erlaubten 12:00 Punkt werden als `law_rise_outside_noon` gezählt, nicht still gelöscht

### Backtest & Güte

| Horizont | Arbeitsstand |
|---|---|
| Heute / 24 h | Prognose + täglicher Rolling-Origin-Backtest implementiert; **kein** Echt-Daten-Gütenachweis (M3-Abnahme offen) |
| +3 d / +7 d | Ausblick ab Cutoff **und** Mehrtage-Backtests gegen beobachtete Preise (`horizons` im Report, seit 11.09.2026); ehrlich als Zusatz ausgewiesen, kein M3-Abnahmekriterium |
| Rolling-PICP 7 d | Je Station im Backtest; Badge grün ≥ 93 %, gelb ≥ 90 %, rot < 90 % (nominal 95 %, < 72 Punkte = keine Aussage). Publiziert als `rolling_picp_7d`, in `/v1/decide` als `quality` |
| Backtest-Fenster des NAS-Jobs | **21 Tage** statt 7 (`app/refresh.py`), damit das Gate `at_least_21_complete_test_days_per_station` aus dem automatischen Lauf erfüllbar ist |
| Güte-Gate | Rolling-PICP **rot** → `no_advice` („Keine klare Empfehlung — Prognose derzeit unsicher …“) als Auswertungsschritt 1, *vor* F2/F1 (§4.5) |

Cutoff lokale Mitternacht, Trainingsfenster 42 Tage (nicht pauschal verdoppelt; stattdessen
exponentiell gewichteter Tagesblock-Bootstrap, HWZ 14d). MAE, RMSE, MASE, sMAPE, Pinball
(τ=0,5 und asym τ=0,75), PICP, MPIW werden gemessen. Erster Backtest bewertet folgenden Tag
im Poll-Fenster. Vergleich 42d-EW vs. 42d-uniform vs. 84d siehe Engine-Referenz §4.

### MASE (Fehler gegen die Naive)

Die MASE misst den Fehler als Vergleich zur saisonalen Naive:
Backtest-MAE des Modells geteilt durch den MAE der Vor-Tages-Preise zur
selben Stunde. Die Kennzahl kommt aus dem Rolling-Origin-Backtest
(`engine/backtest.py`); wo die Naive undefinierbar ist (keine bewertbaren
Punkte, konstante Reihe), steht der Grund in `mase_none_reason` statt einer
stillen Lücke. **Unter 1,0 heißt besser als die einfache
Vergleichsmethode** — MASE 0,7 sind 30 % weniger Fehler als „nimm den
gestrigen Preis“. Die Ensemble-Gewichte (A10) sind ∝ 1/MASE je Modellkern,
gemessen auf den letzten 14 Trainingstagen.

### PICP (Band-Trefferquote)

Die PICP ist die Trefferquote des 95-%-Bandes: der Anteil der **echten**
Preise, die im vorhergesagten Band lagen (Prediction Interval Coverage
Probability). Gezählt wird nur an Zeitpunkten mit echtem Preis —
geschlossene Meldungen sind keine Bandverfehlung. Bei perfekter
Kalibrierung liegt der Wert bei etwa 95 %; darunter ist das Band zu schmal
(zu siegessicher), darüber zu breit (zu vorsichtig). Das Labor zeigt
den 7-Tage-Rolling-Wert je Station als Badge (grün ≥ 93 %, gelb ≥ 90 %,
rot < 90 %, unter 72 Punkten keine Aussage) — rot löst das Güte-Gate aus
(`no_advice` vor F2/F1, siehe Tabelle oben).

## Wahrscheinlichkeiten aus der Prognoseverteilung (P-Seite)

Seit 11.09.2026 reduziert der Worker die Bootstrap-Pfade auf **2-h-Fenster-Minima
je Draw** und **Nowcast-Draws** und veröffentlicht sie im Artefakt
(`forecasts[].draws_24h` / `draws_7d`, `engine/probabilities.py`). Der Decision
Layer rechnet daraus ohne Numerik-Abhängigkeit (`app/pside.py`):

| Größe | Definition | Verwendung |
|---|---|---|
| `p_besser` | P(Minimum über dem Fenster ≤ Preis jetzt − 1 ct) | F1-Gate **und** Brier-Input des Advice-Ledgers |
| `p_lohnt` | P(€_netto > 0) je Alternative | F2-Zeilen („lohnt sich der Umweg?“) |
| Fenster-P | P(Fenster ≤ Minimum im ±6-h-Umfeld) | F3-Top-3-Fenster |

Fallback: Sind keine Draws veröffentlicht (Altbestand, kein Modell), greift die
Laplace-geglättete Ledger-Quote `(hits + 10·0,5)/(n + 10)` — gekennzeichnet,
nicht vermischt.

**Gemeinsame Ziehung (§4.2, seit 0.31.0):** alle Stationen eines Laufs ziehen
ihre Tagesblöcke aus **denselben** Zufallszahlen je (Horizont, Tagesposition)
(`engine/models.py::shared_day_uniforms`); jede Station bildet die Zahl über
ihre eigene Blockverteilung ab (comonotone Kopplung). Damit steckt der
Marktgleichlauf in `p_lohnt`, statt herauszufallen. Ausgewiesen ist das je
Horizont im Artefakt: `draws_24h.shared` / `draws_7d.shared`. Gegenprobe mit
`TANKAPP_SHARED_DRAWS=0` (alte, unabhängige Ziehung).

| Messung (Demo-Stack, sechs Stationen mit gemeinsamem Tages-Marktfaktor) | unabhängig | gemeinsam |
|---|---|---|
| Korrelation der Nowcast-Draws, **ein Lauf, eine Config** | 0,995 | 0,992 |
| Korrelation der Nowcast-Draws, **unterschiedliche Trainingsfenster** (z. B. erhaltene Prognose aus einem früheren Lauf) | 0,545 | 0,588 |
| Streuung der Nowcast-Differenz, unterschiedliche Fenster | 1,40 ct/L | 1,13 ct/L (−19 %) |

Ehrlicher Befund: Bei **einem** Lauf mit gleicher Config koppelte die alte
Ziehung schon zufällig richtig — gleicher Samen und gleiche Blockzahl ergaben
dieselbe Indexfolge, also denselben Kalendertag. A11 schreibt das fest und
verbessert genau den Fall, in dem die alte Ziehung ohne Hinweis entkoppelte:
unterschiedlich viele Tagesblöcke (erhaltene Prognosen, `retained_previous`).
Das M7-Gate (§0.4) bleibt hart: `primary.p_correct` erscheint erst nach der
Kalibrierung (n ≥ 100 abgeschlossene Empfehlungen, Brier < 0,25).

## Empfehlungs-Bilanz (Brier, Epsilon, Regret)

Das Labor bilanziert zwei Dinge: ob die **Prozentzahlen** stimmten
(Brier, aus dem Advice-Ledger) und ob die **Regel** das günstige Fenster
traf (ε und Regret, aus dem Labor-Vergleich gegen das Orakel). Alle drei
Begriffe stehen im Glossar der App („Was heißt das?“).

### Brier-Score (Treffergenauigkeit der Prozentzahlen)

Der Brier-Score vergleicht jede Empfehlungs-Prozentzahl `p_besser`
(„Warten lohnt“) mit dem tatsächlich eingetretenen Ergebnis (Ja = 1, Nein =
0): mittlerer quadratischer Abstand über alle abgeschlossenen Empfehlungen
(`app/feedback.py`, Advice-Ledger). **0 wäre perfekt, 0,25 entspricht
Raten.** Die Freigabe des Kalibrierungs-Gates fordert Brier < 0,25 bei
mindestens 100 abgeschlossenen Empfehlungen (Konzept §0.4, M7) — darunter
zählen nur aktuelle Preise, keine Prozent-Behauptung.

### Epsilon-Schwelle des Labor-Vergleichs

Die Labor-Regel des Prüfstands empfiehlt „Warten“ nur, wenn die im Training
geschätzte erwartete Ersparnis μ mindestens **ε** erreicht
(im Labor: Karte **„Vorsicht-Regler ε“** mit **„Was wäre gewesen, wenn …?“** —
früher `views/Statistics.tsx`, Gruppe B1 „Die Entscheidungs-Regel“).
ε ist die Handlungsschwelle des Labors: ε = 1,0 ct/L heißt, erwarte ich
weniger als einen Cent Vorteil, bleibe ich bei „Jetzt“. ε ist ein **Was-wäre-wenn-Schalter** für den Labor-Vergleich —
die Produktion rechnet mit der kalibrierten Entscheidungstabelle (§4.1/§4.2),
nicht mit dem Slider.

### Regret (Mehrkosten zur perfekten Sicht)

Regret = (Preis der Regel − Preis des **Orakels**) je Entscheidung,
gemittelt (`web/src/data.ts`, `avg_regret_ct`). Das Orakel kennt den ganzen
Tagesverlauf vorher und tankt immer im günstigsten Fenster — es ist die
unerreichbare Referenz. Daneben stehen Regel-€ (smart, was die Regel zahlte),
Orakel-€ (best) und „immer warten“-€ (always): Geholtes Potenzial = Regel-€
/ Orakel-€. Regret misst also nicht, ob die Regel gut ist, sondern was sie
gegen die perfekte Sicht liegen ließ.

## Ensemble aus zwei Modellkernen (A10, Konzept §3.2 M3)

Seit 0.31.0 fittet die Engine **zwei** Modellkerne und mischt ihre
Punktprognosen. Das Zweitmodell `profile_ar2` ist bewusst kein zweiter
Sinus-Fit, sondern nicht-parametrisch: das Tagesprofil je 5-Minuten-Slot als
**Median** über das Trainingsfenster (`engine/models.py::_profile_level`).
Es teilt mit dem Hauptpfad alles andere — Holiday-Bereinigung, AR(2)-Nachlauf,
Tagesblock-Bootstrap, 12-Uhr-Regel —, aber nicht die Formannahme. Genau
darum trägt es bei: Tankstellenpreise haben oft zwei Spitzen (morgens,
abends) und ein flaches Mittag, das eine harmonische Summe nur annähert.

Gewichte ∝ **1/MASE** (`ensemble_detail`): verglichen wird die
Eine-Schritt-Prognose beider Modelle auf den letzten 14 Trainingstagen,
Nenner ist die saisonale Naive (derselbe Slot am Vortag). Veröffentlicht
werden MAE, MASE, Stichprobengröße und Fenster — nicht nur die Gewichte,
denn ein Gewicht ohne seine Grundlage ist eine Behauptung.

| Messung (Demo-Daten, 6 Stationen, 72-h-Holdout, B = 200) | MAE |
|---|---|
| Hauptpfad `harmonic_ar2` (Stand vor 0.31.0) | 2,53 ct/L |
| Zweitmodell `profile_ar2` | 1,86 ct/L |
| **Ensemble** (Default) | **1,93 ct/L** (−24 % gegen den Hauptpfad, 6/6 Stationen besser) |

Ehrlicher Befund: **das Ensemble ist schlechter als das Zweitmodell allein**
(1,93 vs. 1,86), weil die Gewichte fast gleich ziehen (0,51 / 0,49) — das
Eine-Schritt-Fenster trennt die Modelle kaum, beide stützen sich dort auf
denselben AR(2)-Nachlauf. Der Sprung gegen den bisherigen Hauptpfad kommt
also vom Zweitmodell, nicht von der Mischung. Die Gewichte stattdessen aus
dem Rolling-Origin-Backtest (Mehrstufen-Fehler, wie er später tatsächlich
gebraucht wird) zu ziehen, ist ein eigener Schritt und bewusst offen
([LUECKEN.md](LUECKEN.md#bewusst-offen-backlog-mit-grund)). Bis dahin gilt:
das Ensemble ist nie schlechter als das **schlechtere** der beiden Modelle,
und `TANKAPP_MODEL_KIND` stellt jeden Pfad einzeln her — die Zahl oben ist
damit nachprüfbar, nicht geglaubt.

Die Verteilungsform kommt in allen drei Fällen aus dem Tagesblock-Bootstrap
des Hauptpfads; das Ensemble verschiebt sie auf den gewichteten Punktwert.

## Umweg-Ökonomie B3.12

Formel Konzept §10: K = d·(c/100)·p + (d/v)·z

- d = Umweg gesamt (Hin+Rück) km, c = Verbrauch L/100km, p = Preis €/L, v = Geschwindigkeit km/h, z = Zeitwert €/h
- Kritische Differenz Δp* = K/L
- Beispiel: 6km einfach → d=12km, c=7, p=1,65, v=50, z=12 ⇒ K=1,39 Sprit+2,88 Zeit=4,27€ ⇒ bei L=40 lohnt erst ab Δp*≈10,7 ct/L — Zeitwert dominiert
- Zeitwert zeitabhängig: peak 16€/h (16:30–20:00 Berlin), offpeak 10€/h, Slider, Auto-Modus 16/10, 0=Auto
- Nur Sprit-Sicht: K_sprit ~0,12€/km bei 7L/100km 1,65€/L, K_zeit ~0,24€/km bei 12€/h 50km/h — Zeit größerer Block. Deshalb Selektion weist beide Netto-Zahlen aus: Vollkosten und nur Sprit, plus Break-even Stundenlohn.
- Rushhour: OSRM liefert Freifluss ohne Live-Stau, im Berufsverkehr 1,5–2×. Selektion bewertet je Fahrtkontext: nahe ≤near_km (5km) auf Arbeitsweg → congestion_peak 1,45, weitere Routen-Stationen → congestion_offpeak 1,0
- Betriebsmodi: dedicated (Extrafahrt) vs onroute (nur Mehrweg ggü. nächster Station)
- Straßen-km via OSRM (OpenStreetMap) kostenlos ohne Key, Cache `results/road_route_cache.json`, Fallback Luftlinie×Circuity. Snapping-Falle: Anker auf Autobahnrampe → Warnung

**B3.12 serverseitig:** Endpunkt `/api/v1/route/evaluate` rechnet dieselbe Formel serverseitig mit live Preisen, ohne externen Routing-Call. UI rechnet lokal (schnell), kann optional Server zur Validierung nutzen.

Parameter: city, fuel, station_id (Ziel), ref_station_id (Referenz, sonst Stadtmedian), liters, detour_km (optional — fehlt: aus dist_km ableiten: onroute = max(0, dist(ziel) − dist(ref)), dedicated = dist(ziel)), consumption, speed, value_of_time, when (ISO, `HH:MM` oder Stunde; die GUI sendet die Ist-Zeit mit), mode, price/target_price/alt_price + ref_price (optional für Tests).

Antwort: delta_ct, gross_eur, fuel_cost_eur, time_cost_eur, detour_cost_eur, net_eur, critical_delta_ct, worth_it, verdict, z_used, z_auto, is_peak, detour_km_source, ref_station_name, consumption_l_100km, etc.

## Verweise

- [Installation](INSTALL.md)
- [Architektur](ARCHITEKTUR.md)
- [API](API.md)
- [Betrieb](BETRIEB.md)
- [Konzept](KONZEPT.md) — vollständiges Zielbild
- [Lücken-Check](LUECKEN.md) — Konzept ↔ Stand, bewusst offene Punkte mit Grund
- [TODO](../TODO.md) — priorisierte Arbeitsliste (u. a. A11 gemeinsame Ziehung)
- [Engine-Referenz](ENGINE.md) — Backtest-Rezepte, Datenqualität, 12-Uhr-Regel
- [Werkzeuge](DATENWERKZEUGE.md)
 Ziehung)
- [Engine-Referenz](ENGINE.md) — Backtest-Rezepte, Datenqualität, 12-Uhr-Regel
- [Werkzeuge](DATENWERKZEUGE.md)
