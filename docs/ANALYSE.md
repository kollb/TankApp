# TankApp Analyse — Selektion, Modelle, Heatmaps

> Stand: 12.09.2026 · App-Version 0.11.0 — B3-Aggregate, P-Seite aus der
> Prognoseverteilung (11.09.2026), Hampel-Filter, Rolling-PICP und Güte-Gate
> enthalten. Methodik-Nachschlagewerk, keine Checkliste: Einrichten
> [INSTALL.md](INSTALL.md), rechnen lassen [BETRIEB.md](BETRIEB.md),
> offene Punkte [LUECKEN.md](LUECKEN.md) · [TODO.md](../TODO.md).

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Stations-Selektion — Meine Stationen mit δ̂](#stations-selektion--meine-stationen-mit-δ)
  - [Relative Preislage δ̂](#relative-preislage-δ)
  - [Bootstrap-KI & FDR](#bootstrap-ki--fdr)
  - [AV-Score & billigste Stunde](#av-score--billigste-stunde)
  - [NAS Artefakte B3.10](#nas-artefakte-b310)
- [Heatmaps DoW×Stunde B3.9](#heatmaps-dowstunde-b39)
  - [Niveau](#niveau)
  - [Cheap-Probability](#cheap-probability)
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

Pipeline: `analysis/station_selection.py` — Schema siehe [DATENWERKZEUGE.md](DATENWERKZEUGE.md#datenformate). Echter Bericht lokal als `docs/analysis/report_top10.md`, synthetische Berichte sind kein Abnahmenachweis.

| # | Komponente | Verfahren | Funktion |
|---|---|---|---|
| 1 | Relative Preislage δ̂ᵢ | Medianᵢ(t) von pᵢ(t) − Medianⱼ≠ᵢ pⱼ(t) (Leave-One-Out-Baseline) + EW-Median über Tages-δ̂ (HWZ 7d, F5) + CUSUM-Bruchflag | Gewicht 0.40 (auf EW-Median) |
| 2 | Inferenz | Exponentiell gewichteter Tages-Block-Bootstrap B=2000 (HWZ 14d, neuere Tage höheres Ziehgewicht) → 95%-KI; p-Wert H0: δᵢ≥0; Benjamini-Hochberg FDR q<0.05 | Signifikanz-Gate |
| 3 | Verfügbarkeit AVᵢ | Σₕ wₕ·P(Top-3\|h); w = Tankzeitprofil werktags 06–09/16–20 | Gewicht 0.25 |
| 4 | Tagesform | robuste harmonische Regression (Huber-IRLS, 1.+2. Harmonische) → Amplitude, billigste Stunde, R² | Gewicht 0.15 |
| 5 | Risiko | σᵢ = 1.4826·MAD(Δᵢ); Streuung Tages-Mittelränge | Gewicht 0.10+0.10 |
| 6 | Datenqualität | Coverage-Gate ≥85% je Station | Ausschluss |

Kampagnen-Setup: drei Kampagnen Hessen, Bayern, NRW; Heimat Frankfurt am Main. Frankfurt hat 100+ Stationen im 25km Radius → globale Top-10 wird quotiert (Empfehlung 6/2/2, konfigurierbar), sonst dominieren Heimatstadt-Stationen.

Privatsphäre: Straße/Hausnummer nie im Repo; Heimkoordinaten nur in gitignorierter `analysis/config.local.json` (`--config`, Vorlage `config.local.example.json`); Feiertage je Bundesland via `--subdiv` (`HE`, `BY`, `NW`).

Kraftstoff: primär E10 für Selektion/Prognose/Heatmaps. Diesel/E5 werden ohne Extra-Request mitgesammelt (Historie+Nowcast); E5↔E10 nur als Äquivalenzpreis vergleichen: E5 lohnt erst bei p_E5 ≤ ~1,015·p_E10.

### Relative Preislage δ̂

δ̂ᵢ = Median über Zeit von (pᵢ(t) − Median_{j≠i} pⱼ(t))

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

Beispiel: „langfristig 3,80 ct/L günstiger als Umgebung“ erscheint nur im Stations-Detail der Werkstatt.

### Bootstrap-KI & FDR

- Exponentiell gewichteter Tages-Block-Bootstrap B=2000 (Issue 46): ziehe Tage mit Zurücklegen,
  neuere Tage mit höherer Wahrscheinlichkeit (Halbwertszeit 14 Tage), berechne je Ziehung Median Δ
- 95%-KI = 2,5% und 97,5% Quantile
- p-Wert = (1 + Anzahl(Bootstrap ≥0)) / (B+1), einseitig H0: δ≥0
- Benjamini-Hochberg über alle Stationen → q-Wert, signifikant bei q<0.05 (FDR kontrolliert)

NAS-Job (B3.10): B=2000 fest (nicht sequenziell erhöhen). B=200 wäre ein Signifikanzblocker: p_min=1/(B+1) ergibt mit BH und m=11 Stationen q≥0,0547>0,05. Artefakt `runtime/selection/current.json`.

### AV-Score & billigste Stunde

- P_i(h) = P(Station ∈ Top-3 der Stadt | Stunde h) empirisch über alle Tage
- AV_i = Σ_h w_h·P_i(h), w = Tankzeitprofil (Default Pendlerfenster)
- Tagesform: robuste harmonische Regression der Halbstunden-Medianprofile Δ_i(h) = a1 cos(ωh)+b1 sin(ωh)+a2 cos(2ωh)+b2 sin(2ωh), ω=2π/24, Huber-IRLS
  - Amplitude A_i, Phase → billigste Stunde h*_i = argmin Fit-Kurve, gewichtetes R² als Vorhersagbarkeit
- Risiko: σ_i = 1.4826·MAD(Δ_i) und Rangstabilität

### NAS Artefakte B3.10

**Problem vorher:** Selektions-Artefakte fehlten auf dem NAS — nur lokal per `analysis/station_selection.py` erzeugbar, nicht automatisch.

**Jetzt:**

- Job `selection` täglich (Intervall 86400), nach Modell-Job best-effort
- Liest `runtime/training/*.csv.gz` (aus InfluxDB + Archiv) — echter Trainingsbestand, keine Demo
- Berechnet δ̂, KI, AV, billigste Stunde, Volatilität, Coverage, Score, Ranking
- Publiziert nach `runtime/selection/current.json`
- API `/api/v1/selection?fuel=e10&city=Frankfurt` liefert „Meine Stationen“
- GUI Werkstatt zeigt Tabelle mit Ranking, Bootstrap-KI-Whiskern, AV-Score, billigster Stunde

Falls kein Trainingsbestand vorhanden: `error_code: selection_not_available` → GUI zeigt ehrlichen Hinweis, keine erfundenen Rankings.

Datei `results/station_scores_<fuel>.csv` bleibt lokal für vertiefte Analyse, nicht im NAS-Image.

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
Entscheidungsansicht.

Beide Heatmaps sind Analyse-, keine Entscheidungswerkzeuge — sie leben in der
Werkstatt (Tab **Werkstatt**), nicht im Alltags-Startbildschirm. Sie zeigen die
**Vergangenheit** (letzte N Wochen), keine Prognose für die kommende Woche.

Frontend: Umschalter Level/Probability, Wochen-Wahl 4/6/12 (E5, Default 6),
Basis-Umschalter für die Cheap-Probability ohne Station (B12), Station aus
Dropdown. Seit 0.10.0 (C10) zusätzlich unter der 7×24-Matrix:

- **Tages-Zusammenfassung** je Wochentag (Median + günstigste Stunde),
- **hervorgehobene heutige Zeile**,
- ein **Fazit-Satz** („Typisch am günstigsten: Di 18–20 Uhr — Median 1,653 €/L“)
  und eine Erklärzeile, was „Niveau“ und „Cheap-Prob“ bedeuten.

Die frühere Grenze (TODO B12: ohne Station überstrahlt der Tagesgang den
Wochentag) ist seit 0.11.0 als **Modus** gelöst, nicht als stiller
Verhaltenswechsel: `basis=overall` rechnet weiter wie früher, `basis=hour`
gegen die Spalten-Basis. Der API-Default bleibt `overall`, damit bestehende
Aufrufe (und die Doku dazu) gültig bleiben; die GUI schickt ohne Station
bewusst `hour` und erklärt die Wahl in der Erklärzeile unter der Matrix.

Die Tages-Zusammenfassung (Median je Wochentag) ist von beiden Modi unabhängig
— sie rechnet auf dem Niveau, nicht auf der Cheap-Probability.

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

**Dokumentierte Abweichung (§4.2):** die Draws je Station sind **unabhängig**;
eine gemeinsame Bootstrap-Ziehung über Stationen (gleicher Tagesblock je Ziehung,
damit der Marktgleichlauf nicht wegkorreliert wird) ist nicht umgesetzt. Richtung
der Abweichung: konservativ — Marktgleichlauf würde die Unsicherheit von
`p_lohnt` verringern. Begründung und Folgen:
[LUECKEN.md](LUECKEN.md#bewusst-offen-backlog-mit-grund). Das M7-Gate (§0.4)
bleibt hart: `primary.p_correct` erscheint erst nach der Kalibrierung
(n ≥ 100 abgeschlossene Empfehlungen, Brier < 0,25).

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
