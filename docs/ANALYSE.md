# TankApp Analyse — Selektion, Modelle, Heatmaps

> Stand: 09.09.2026 — B3 Aggregate enthalten, mit klickbarem Inhaltsverzeichnis.

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
- [Umweg-Ökonomie B3.12](#umweg-ökonomie-b312)
- [Verweise](#verweise)

## Überblick

TankApp hat drei Analyse-Schichten:

1. **Selektion** (welche 10 Stationen live pollen?) — δ̂ Ranking mit Signifikanz
2. **Zeitreihe** (wie teuer wann?) — robuste Tagesform + AR2 + Bootstrap
3. **Aggregate** (wiederkehrende Muster?) — Heatmaps DoW×Stunde, Meine Stationen

Alle Schichten liefern JSON-Artefakte nach `data/runtime/`, die die GUI via Nur-Lese-API zeigt. Keine Demo-Daten als Ersatz.

## Stations-Selektion — Meine Stationen mit δ̂

Pipeline: `analysis/station_selection.py` — Schema siehe `data-tools/README.md`. Echter Bericht lokal als `docs/analysis/report_top10.md`, synthetische Berichte sind kein Abnahmenachweis.

| # | Komponente | Verfahren | Funktion |
|---|---|---|---|
| 1 | Relative Preislage δ̂ᵢ | Medianᵢ(t) von pᵢ(t) − Medianⱼ≠ᵢ pⱼ(t) (Leave-One-Out-Baseline) | Gewicht 0.40 |
| 2 | Inferenz | Tages-Block-Bootstrap B=2000 → 95%-KI; p-Wert H0: δᵢ≥0; Benjamini-Hochberg FDR q<0.05 | Signifikanz-Gate |
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

Beispiel: „langfristig 3,80 ct/L günstiger als Umgebung“ erscheint nur im Stations-Detail der Werkstatt.

### Bootstrap-KI & FDR

- Tages-Block-Bootstrap B=2000: ziehe Tage mit Zurücklegen, berechne je Ziehung Median Δ, erhalte Verteilung von δ̂
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
  - **ohne `station_id`**: Gesamtmedian = Median aller offenen Preise des Zeitfensters; je Zelle der Anteil der Preise ≤ Gesamtmedian (durchschnittliche Chance, dass ein zufälliger Preis günstiger als der Schnitt ist)
- Nur offene Preise, InfluxDB letzte N Wochen
- Grün = hohe Chance (≥80%), Rot = niedrige

Beide Heatmaps sind Analyse-, keine Entscheidungswerkzeuge — sie leben in der Werkstatt (Tab Statistik), nicht im Alltags-Startbildschirm.

Frontend: Umschalter Level/Probability, Wochen-Wahl 2/4/6/8, Station aus Dropdown.

## Zeitreihen-Engine

Erster Durchstich in `engine/` liest echte Daten, fittet robuste Tagesform und Wochentags-Dummies mit AR(2)-Nachlauf, vergleicht gegen saisonale Naive und schreibt JSON-Artefakte. Bootstrap-Intervalle sind unkalibriert; `calibrated` und `decision_ready` bleiben false.

### Aufbereitung

1. 5-Min-Raster je (Station, fuel); Lücken → Forward-Fill ≤30min, sonst NaN + Staleness-Maske
2. closed-Spannen: Preis = letzter Open-Preis, Flag open=0; diese Segmente fließen nicht in Zyklus-Modellierung
3. Hampel-Filter (Fenster 1h, Median ±5·MAD) gegen API-Artefakte
4. Tagesblöcke als Bootstrap-/Backtest-Einheit

### Strukturmodell + AR2

Ziel-Stack pro Station×Sorte:

- **M1 Strukturmodell (robust):** p(t) = μ + Σ[aₖcos(2πkh/24)+bₖsin(...)] + γ·X(t) + ε(t), X = DoW-Dummies + gepoolter Feiertags-Dummy je Bundesland (HE/BY/NW) + Zeit-seit-letztem-Preissprung; Huber-IRLS, rollierendes 6-Wochen-Fenster, tägliches Refit
- **M2 Residuen-Nachlauf:** AR(2) auf ε(t) (Yule-Walker)
- **M3 Zweitmeinung:** UnobservedComponents / Holt-Winters plus saisonale Naive als Benchmark
- **Ensemble:** inverse-MASE-Gewichte aus 21-Tage Rolling-Backtest

Abnahme-Kriterien: MASE(24h) <0,95 gesamt und <0,80 sprungfrei, Pinball < Naive, Rolling-PICP(95%) ∈ [90,98]%.

### 12-Uhr-Regel

Seit 2026-04-01 dürfen Tankstellen Preis nur um 12:00 Uhr erhöhen; Senkungen jederzeit.

1. Strukturmodell: Mittags-Schritt nach 12:00 ab Gesetzesbeginn
2. Prognose-Projektion: Median und Bootstrap-Pfade je Segment [12:00, nächste 12:00) auf nicht-steigend projiziert (Pool-adjacent-violators)
3. Datenqualität: beobachtete Anstiege ≥1ct ohne erlaubten 12:00 Punkt werden als `law_rise_outside_noon` gezählt, nicht still gelöscht

### Backtest & Güte

| Horizont | Arbeitsstand |
|---|---|
| Heute / 24h | Vorläufige Prognose + täglicher Rolling-Origin-Backtest implementiert, noch kein Echt-Daten-Gütenachweis |
| +3d / +7d | Vorläufiger Ausblick ab Cutoff, Mehrtage-Backtests offen |

Cutoff lokale Mitternacht, Trainingsfenster 42 Tage. MAE, RMSE, MASE, sMAPE, Pinball, PICP, MPIW werden gemessen. Erster Backtest bewertet folgenden Tag im Poll-Fenster.

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
- [Engine-Referenz](../engine/README.md)
- [Werkzeuge](../data-tools/README.md)
