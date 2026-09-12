# TankApp — Produkt- und Architekturkonzept

> Stand: 12.09.2026 · App-Version 0.11.0. Dieses Dokument beschreibt das
> **Zielbild**, nicht ausschließlich bereits laufende Funktionen. Der Abgleich
> Zielbild ↔ Code — § für §, mit Grund für jeden offenen Punkt — steht in
> [LUECKEN.md](LUECKEN.md); die priorisierte Arbeitsliste in
> [TODO.md](../TODO.md).
> Collector/Uploader befüllen die InfluxDB; M2 gilt als erledigter Arbeitsstand.
> M3 ist in Arbeit: [Implementierung und Kommandos](ENGINE.md).
> `web/` und `app/` implementieren Live-GUI (Alltag/Werkstatt/System),
> Nur-Lese-API mit Rate-Limit und automatische NAS-Archiv-/Modelljobs inkl.
> **B3** (Heatmaps, Meine Stationen δ̂, Collector-Herzschlag, Route-Evaluate),
> **B4/B5** (Decision Layer, `latest_by`, Fahrtmodus, Deprecation-Header,
> M7-Schwellen-Nachzug, Job-Fortschritt) und **0.10.0** (Beleg-Storno,
> CSV-Export, `runtime/`-Backup, `alarms[]`, Version/Commit, Checkliste) —
> Endpunkte: [API.md](API.md).
> Die Wahrscheinlichkeitsseite von §4 ist seit 11.09.2026 aus den
> Bootstrap-Draws gebaut (`p_besser`, `p_lohnt`, Fenster-P); **dokumentierte
> Abweichung** bleibt die gemeinsame Ziehung über Stationen (§4.2) — Begründung
> in [LUECKEN.md](LUECKEN.md#bewusst-offen-backlog-mit-grund).
> Die unabhängige Prüfung vom 10.09.2026 liegt im
> [Archiv](archiv/PRUEFSTAND-2026-09-10.md); ihre Befunde sind eingearbeitet
> ([LUECKEN.md](LUECKEN.md#umgesetzt-seit-der-prüfung-am-10092026)).
> Güte- und Kalibrierungsziele sind erst nach einer echten Datenabnahme erfüllt.
>
> **Die beiden GUI-Prototypen bleiben ausdrücklich die Basis der neuen Homepage**
> (Übernahmeregeln: [GUI-VORLAGEN.md](GUI-VORLAGEN.md)).
> Aufbau und Optik bewahren, nur die Demo-Datenlogik durch echte Daten ersetzen:
> [Übernahmeregeln](GUI-VORLAGEN.md), §8 und UI-Anhang.

**Verbindlicher Betriebsplan vom 10.09.: [INSTALL.md](INSTALL.md).**  
Reihenfolge: Gütersloh mitpolling starten → echte Live-Preise in die vorhandene
GUI → automatische Berechnung → kalibrierte Entscheidungen. Parallel lädt das
NAS selbst ein Jahr oder mehr Archiv und holt beim nächsten geplanten Lauf alle
Lücken nach. Pi = Collector/Uploader (inkl. Heartbeat); NAS = Archiv + InfluxDB + Berechnung +
API/Web-GUI; PC = optionales Rechnen/Einrichten, sonst Browser. Keine verpflichtende
PC-venv. Historische Pi-API-/PC-Pflicht-Zuordnungen weiter unten sind damit abgelöst.
Archiv und Polling sind dieselben Tankerkönig-Marktdaten. Der Archiv-Sync wird
nicht abgeschaltet, nur weil ein Modell ausschließlich auf jüngsten Polls trainiert.

**Das Produktprinzip in einem Satz:** Aus den Prognose-Quantilen q̂.025…q̂.975
der Engine wird eine **Entscheidung mit Kalibrierungsangabe** gemacht —
„Jetzt tanken / Warte bis 18–20 Uhr (+4 ct ≈ 1,60 €) / Fahre zu Shell
(+1,20 € netto) — 82 % sicher“. Fan-Charts, Heatmaps und Konfidenzbänder
sind nicht weg, aber sie sind **Begründung auf Nachfrage** (Modus
„Werkstatt“), nie die primäre Antwort.

```text
Tankerkönig prices.php → Pi: Collector/RAM/Uploader → NAS: InfluxDB
Tankerkönig Archiv ────────────────────────────────→ NAS: Preise + Stationen (≥ 1 Jahr)
                                                    │
                          NAS: Aufbereitung/Fits → API + vorhandene Web-GUI
                                                    │
                                                Handy/PC: Browser
```

## Inhaltsverzeichnis (klickbar)

- [0. Produktprinzip: drei Fragen, zwei Modi, eine Zahl](#0-produktprinzip-drei-fragen-zwei-modi-eine-zahl)
  - [0.1 Die drei einzigen Fragen, die zählen](#01-die-drei-einzigen-fragen-die-zählen)
  - [0.2 Von der Verteilung zur Entscheidung](#02-von-der-verteilung-zur-entscheidung)
  - [0.3 Zwei Modi: Alltag und Werkstatt](#03-zwei-modi-alltag-und-werkstatt)
  - [0.4 Die Ehrlichkeits-Regel (hartes Gate)](#04-die-ehrlichkeits-regel-hartes-gate)
- [1. Datenquelle: Tankerkönig API](#1-datenquelle-tankerkönig-api)
- [2. Schritt 1: Mathematische Stations-Selektion (fertig implementiert)](#2-schritt-1-mathematische-stations-selektion-fertig-implementiert)
- [3. Schritt 2: Zeitreihen-Engine — liefert Quantile, sieht das Frontend (im Alltag) nie](#3-schritt-2-zeitreihen-engine--liefert-quantile-sieht-das-frontend-im-alltag-nie)
- [4. Decision Layer (Ziel)](#4-decision-layer-ziel)
- [5. Konfidenz, die man wirklich fühlen kann](#5-konfidenz-die-man-wirklich-fühlen-kann)
- [6. Abnahme-Kriterien: Produkt-KPIs (neben den Engine-Kriterien §3.2)](#6-abnahme-kriterien-produkt-kpis-neben-den-engine-kriterien-32)
- [7. Polling-Fenster: 06:00–24:00 (fix)](#7-polling-fenster-06002400-fix)
- [8. UI: zwei Moden, ein Startbildschirm mit ≤ 3 primären Zahlen](#8-ui-zwei-moden-ein-startbildschirm-mit--3-primären-zahlen)
- [9. Systemarchitektur: Pi ↔ NAS](#9-systemarchitektur-pi--nas)
- [10. Fahrzeug- & Umweg-Ökonomie](#10-fahrzeug---umweg-ökonomie)
- [11. TankPuls-API](#11-tankpuls-api)
  - [11.1 Primär: `GET /v1/decide` — der eine Endpunkt fürs Frontend](#111-primär-get-v1decide--der-eine-endpunkt-fürs-frontend)
  - [11.2 Folge, Intent, Fill — nicht „Outcome an Recommendation“](#112-folge-intent-fill--nicht-outcome-an-recommendation)
  - [11.3 Detail-Endpunkte (Werkstatt-Modus, Debug) — inkl. B3](#113-detail-endpunkte-werkstatt-modus-debug--inkl-b3)
- [12. Noch nicht gestellte, aber wichtige Fragen (Lücken-Checkliste)](#12-noch-nicht-gestellte-aber-wichtige-fragen-lücken-checkliste)
- [13. Roadmap](#13-roadmap)
- [14. Ehrliche Grenzen](#14-ehrliche-grenzen)
- [UI-Anhang: Die zwei GUI-Vorlagen als Homepage-Basis](#ui-anhang-die-zwei-gui-vorlagen-als-homepage-basis)

---


## 0. Produktprinzip: drei Fragen, zwei Modi, eine Zahl

### 0.1 Die drei einzigen Fragen, die zählen

Alles, was die App im Alltag anzeigt, antwortet auf genau eine von drei
Fragen. Alles andere ist Deko und gehört in den Werkstatt-Modus.

| Frage | Kontext | Antwortform |
|---|---|---|
| **F1: Jetzt oder warten?** | Ich stehe (oder stehe gleich) an einer Station | Ampel + Zeitfenster: „Warte bis 18–20 Uhr, dann ~4 ct günstiger, 82 % sicher“ |
| **F2: Hier oder woanders?** | Ich habe 2–3 Stationen zur Auswahl | Netto-€-Vergleich: „Station B: −1,20 € nach Umweg, 71 % sicher“ |
| **F3: Heute oder später?** | Tank ist bei ¼, ich kann noch warten | Kalender mit besten Fenstern: „Morgen 19–21 Uhr ist billigstes Fenster der Woche, 68 %“ |

Fan-Charts, Heatmaps, Konfidenzbänder, MASE/PICP — alles zweiter Ordnung:
nur als Begründung („warum sagst du das?“) im Werkstatt-Modus, nicht als
primäre UI.

### 0.2 Von der Verteilung zur Entscheidung

Die Engine (§3) liefert weiterhin Quantile — **das Frontend sieht sie im
Alltags-Modus nie.** Dazwischen liegt der **Decision Layer** (§4), der aus
der Verteilung drei Dinge übersetzt:

```
Engine-Quantile ──► Decision Layer ──► { Aktion, Zeitfenster, €-Betrag, P_besser }
                                        (Ampel)  („bis 18–20 Uhr“) (1,60 €)  (82 %)
```

Drei Eigenschaften machen das mathematisch ehrlich:

1. **P_besser ist prüfbar.** Sie ist die einzige Zahl im UI, die eine
   Kalibrierungsgarantie braucht — und die einzige, die man wirklich
   kalibrieren kann (Brier-Score, §5.1). Über alle Fälle „82 % sicher“
   muss im Nachhinein tatsächlich ~82 % Erfolgsrate stehen.
2. **Entschieden wird über €-Erwartungswerte, nicht über Bandbreiten.**
   Eine Aktion ist besser, wenn ihr erwartetes €-Ergebnis die Kosten
   (Umweg, Unsicherheitsrisiko) übersteigt — die Wahrscheinlichkeit wird
   daneben ausgewiesen, sie ist nicht selbst die Regel (gleiche Philosophie
   wie im Statistik-Prototyp: `μ ≥ ε` entscheidet, `P(S>0)` wird gezeigt).
3. **Die App kennt ihr eigenes Können.** Jede *kollabierte* Empfehlung
   wird geloggt und nach Fensterende automatisch mit der Realität
   abgeglichen (Advice-Ledger, §5.2/§5.4) — unabhängig davon, ob jemand
   getankt hat. Die persönliche €-Bilanz ist ein zweites Ledger und
   braucht gemeldete Füllungen. Beides zusammen ist die ehrlichste
   Marketing-Abteilung der App gegen sich selbst.

### 0.3 Zwei Modi: Alltag und Werkstatt

Der Anwender hat die Ziel-UI an **zwei Sample-GUIs** ausgeprobiert:

| | **Modus „Alltag“** (Prototyp: `sample/good gui`) | **Modus „Werkstatt“** (Prototyp: `sample/good statistic gui`) |
|---|---|---|
| Zweck | An der Säule, 5 Sekunden, eine Entscheidung |Sonntagmorgen mit Kaffee: Statistik, Kalibrierung, Parameter-Spielen |
| Primär | Entscheidungs-Kompass: 1 Ampel-Karte + 3 Zeilen | Scoreboard, Kalibrierungs-Plot, Stations-Labor |
| Enthält | Alternativen, Fenster heute/Woche, What-If-Slider, Navigation | ε-Scan, Fan-Chart, Heatmaps, „Meine Stationen“, Paarvergleich, System-Status, API-Explorer |
| Prognose-Quantile | nie sichtbar | überall (das ist der Punkt) |

Beide Modi sind **gleichberechtigte Ebenen derselben App** (Tabs oder
Umbruch), kein „Expertenecke“-Verstecken: Der Alltag zeigt die eine
Entscheidung, die Werkstatt zeigt, warum man ihr vertrauen darf. Details in
§8.

### 0.4 Die Ehrlichkeits-Regel (hartes Gate)

„82 %“ ist nur dann mehr als Wahrsagerei, wenn sie kalibriert ist.
Deshalb gilt produktseitig:

- **P_besser-Prozente dürfen erst angezeigt werden, wenn der Brier-Score
  über ≥ 100 abgeschlossenen Empfehlungen < 0,25 nachgewiesen ist**
  (erwartbar nach ca. 4–6 Wochen Live-Betrieb). Vorher: nur binäre
  Empfehlung ohne Prozentzahl.
- Wenn die Prognoseverteilung zu breit oder die Entscheidung zu knapp ist
  (Rolling-PICP außerhalb Toleranz oder P_besser ∈ [40 %, 60 %]), lautet
  die Empfehlung **„Keine klare Empfehlung — tank nach Bedarf“** plus die
  reinen Aktualpreise der 3 nächsten Stationen. Das ist keine Schwäche,
  sondern die Alternative zu falscher Präzision (§4.4).

---

## 1. Datenquelle: Tankerkönig API

### 1.1 Kontingent und Konsequenz

Empfehlung/Limit: **1 Request / 5 min**. `prices.php?ids=<…10 UUIDs>` bündelt
bis zu 10 Stationen → die 10 selektierten Stationen kosten exakt einen Poll
je 5 min: **216 Requests/Tag** beim fixen Fenster 06–24 Uhr (§7), 288 bei
Volltag. Stations-Masterdaten 1×/Tag aus `list.php` (Radius bis 25 km,
liefert bereits Preise + `dist` + `isOpen` — guter täglicher
Plausibilitäts-Abgleich).

### 1.2 Payload → Schema-Mapping (Collector-Fallstricke)

`list.php`: `id` (UUID, Primärschlüssel), `name`/`brand`/Adresse (nur
Masterdaten), `lat`/`lng` (Masterdaten + Maps-Deep-Link), `dist` (**nur
relativ zum Suchstandort — nicht speichern**), `e5`/`e10`/`diesel` (je
eigener Datenpunkt), `isOpen`.

`prices.php` — drei Statusfälle:

```json
"<uuid>": { "status": "open",   "e5": false, "e10": false, "diesel": 1.189 }
"<uuid>": { "status": "closed" }
"<uuid>": { "status": "no prices" }
```

- `false` statt Zahl = *Kraftstoff wird nicht geführt* → **niemals 0
  schreiben**, gar keinen Punkt für diese Sorte.
- `closed` → kein Preis; letzter Open-Preis gilt am Zapfhahn weiter, die
  Engine markiert die Spanne als **stale**, nicht als Beobachtung (§3.1).
- `no prices` → nach 7 Tagen ohne Daten aus dem Monitoring nehmen (Alarm).

**InfluxDB-Line-Protocol** (idempotent durch festen Zeitstempel):

```
price,station=<uuid>,fuel=e10 value=1.389,open=1 <unix_ns(fetched_at)>
```

InfluxDB dedupliziert identische (measurement, tags, timestamp)-Zeilen → der
Uploader kann nach NAS-Ausfall blind nachliefern.

### 1.3 Lizenz & Etikette

CC BY 4.0 (MTS-K) → „Daten: MTS-K via tankerkoenig.de (CC BY 4.0)“ in die
Fußzeile der App. Token-Bucket 1 R/300 s **hart verdrahtet**, dazu
429-Backoff 60 s.

---

## 2. Schritt 1: Mathematische Stations-Selektion (fertig implementiert)

Pipeline: `analysis/station_selection.py` · Schema: [Werkzeugreferenz](DATENWERKZEUGE.md#datenformate).
Der echte Bericht wird lokal als `docs/analysis/report_top10.md` erzeugt
und archiviert; synthetische Berichte sind kein Abnahmenachweis und wurden entfernt.

| # | Komponente | Verfahren | Funktion im Score |
|---|---|---|---|
| 1 | **Relative Preislage δ̂ᵢ** | Medianᵢ(t) von pᵢ(t) − Medianⱼ≠ᵢ pⱼ(t) (Leave-One-Out-Baseline) + EW-Median über Tages-δ̂ (HWZ 7 d, F5) + CUSUM-Bruchflag | Gewicht 0.40 (auf EW-Median) |
| 2 | **Inferenz** | Exponentiell gewichteter Tages-Block-Bootstrap (B = 2000, HWZ 14 d) → 95 %-KI; p-Wert H₀: δᵢ ≥ 0; **Benjamini-Hochberg-FDR** (q < 0.05) | Signifikanz-Gate |
| 3 | **Verfügbarkeit AVᵢ** | Σₕ wₕ·P(Station ∈ Top-3 · Stunde h); w = Tankzeitprofil (werktags 06–09/16–20 h) | Gewicht 0.25 |
| 4 | **Tagesform** | robuste harmonische Regression (Huber-IRLS, 1.+2. Harmonische) → Amplitude, billigste Stunde, R² | Gewicht 0.15 |
| 5 | **Risiko** | σᵢ = 1.4826·MAD(Δᵢ); Streuung der Tages-Mittelränge | Gewicht 0.10 + 0.10 |
| 6 | **Datenqualität** | Coverage-Gate ≥ 85 % je Station | Ausschluss |

**Kampagnen-Setup:** drei Kampagnen in **Hessen, Bayern, NRW**; Heimat =
**Frankfurt am Main**. Frankfurt hat im 25-km-Radius 100+ Stationen → die
globale Top-10 wird **quotiert** (Empfehlung **6/2/2**, konfigurierbar),
sonst dominieren Heimatstadt-Stationen das Ranking und die 10 live
gepollten IDs decken die Reiseorte nicht. Die derzeitige
Ein-Befehl-Pipeline erstellt ein Set je gewählter Poll-Stadt (Default Frankfurt);
eine gemeinsame Kampagnen-Quote bleibt davon zu unterscheiden.
**Privatsphäre:** Straße/Hausnummer **nie** im Repo; Heimkoordinaten nur in
der gitignorierten `analysis/config.local.json` (`--config`, Vorlage
`config.local.example.json`); Feiertage je Bundesland via `--subdiv`
(`"Frankfurt": "HE"`, Bayern `"BY"`, NRW `"NW"` — z. B. Allerheiligen nur
BY/NW, Dreikönige nur BY, Fronleichnam in allen dreien).

**Kraftstoff:** primär **E10** für Selektion/Prognose/Heatmaps.
`prices.php` liefert alle Sorten in derselben Antwort → **Diesel und E5
werden ohne Extra-Request mitgesammelt** (Historie + Nowcast); E5↔E10 nur
als Äquivalenzpreis vergleichen: E5 lohnt erst bei p_E5 ≤ ~1,015·p_E10
(§10).

**Anschluss an die Entscheidungs-App:** Das Top-10-Ranking wird im Frontend
zu **„Meine Stationen“** — sortiert nach **aktueller Empfehlungsstärke**
(F2-Netto-Vorteil jetzt), nicht nach δ̂. Der δ̂-Wert („langfristig 3,80 ct/L
günstiger als Umgebung“) erscheint nur im Stations-Detail der Werkstatt.

---

## 3. Schritt 2: Zeitreihen-Engine — liefert Quantile, sieht das Frontend (im Alltag) nie

### 3.0 Umsetzungsstand

Der erste Durchstich in `engine/` liest echte Daten, fittet robuste Tagesform
und Wochentags-Dummies mit AR(2)-Nachlauf, vergleicht gegen eine saisonale
Naive und schreibt JSON-Artefakte. Die Bootstrap-Intervalle sind ausdrücklich
**unkalibriert**; `calibrated` und `decision_ready` bleiben `false`. Seit
September 2026 trägt das Strukturmodell die 12-Uhr-Regel (Erhöhungen nur um
12:00 Uhr, seit 2026-04-01): Mittags-Schritt als Feature plus Projektion von
Median und Bootstrap-Pfaden auf nicht-steigende [12:00, nächste 12:00)-Segmente;
unerlaubte Anstiege in den Beobachtungen werden als `law_rise_outside_noon`
gezählt statt still korrigiert. Details: [Engine-Referenz](ENGINE.md#12-uhr-regel-preiserhöhungen-nur-um-1200-uhr).

Der folgende Stack ist das M3-Ziel. Zweitmodell/Ensemble, gepoolte Feiertage,
Sprungdiagnostik und ACI sind noch offen. Keine Modellgüte wird aus früheren
Demo-Kurven übernommen. Wochensaisonalität wird zunächst über DoW-Dummies
modelliert; eine volle Wochenperiode braucht wesentlich mehr beobachtete Zyklen.

### 3.1 Aufbereitung & Öffnungszeiten-Bewusstsein (Ziel)

1. 5-Min-Raster je (Station, fuel); Lücken → Forward-Fill ≤ 30 min, sonst
   NaN + Staleness-Maske.
2. `closed`-Spannen: Preis = letzter Open-Preis, Flag `open=0`; diese
   Segmente fließen **nicht** in die Zyklus-Modellierung (eingefrorene
   Preise sind keine Marktsignale).
3. Hampel-Filter (Fenster 1 h, Median ± 5·MAD) gegen API-Artefakte.
4. Tagesblöcke als Bootstrap-/Backtest-Einheit.

### 3.2 Ziel-Stack (pro Station × Sorte)

**M1 Strukturmodell (robust):**
p(t) = μ + Σₖ₌₁²[aₖcos(2πkh/24) + bₖsin(2πkh/24)] + γ′·X(t) + ε(t)
mit X = DoW-Dummies + **gepoolter Feiertags-Dummy je Bundesland (HE/BY/NW,
über das Kalenderjahr geschätzt — 0–1 Feiertage je 6-Wochen-Fenster wären
unidentifizierbar)** + Zeit-seit-letztem-Preissprung; Huber-IRLS,
rollierendes 6-Wochen-Fenster, tägliches Refit. Wochensaison der ersten
12 Monate über die DoW-Dummies.

**M2 Residuen-Nachlauf:** AR(2) auf ε(t) (Yule-Walker) — fängt die
Persistenz direkt nach Sprüngen.

**M3 Zweitmeinung:** `UnobservedComponents` (Local-Level + Tagessaison 288
+ DoW) bzw. Holt-Winters (gedämpfter Trend, Periode 288) **plus** saisonale
Naive als Benchmark. Beide Perioden (288/2016) in einem Modell erst ab
≥ 1 Jahr Daten.

**M4-Q (optional):** Quantile-Gradient-Boosting (LightGBM) erst ab
Roadmap-M6 und ≥ 3 Monaten Daten, nur 3–5 Top-Stationen, nur
τ ∈ {0,1; 0,5; 0,9} (Zwischenquantile interpoliert), feste Hyperparameter,
wöchentliches Refit auf dem NAS. 30 Modelle × 19 Quantile × täglich = 570
Fits/Tag sprengen das Pi — deshalb so.

**Ensemble:** inverse-**MASE**-Gewichte aus 21-Tage-Rolling-Backtest,
täglich; Benchmark = saisonale Naive.

**Abnahme-Kriterien Engine:**

1. MASE(24 h) < **0,95** gesamt (inkl. Sprungtage),
2. MASE(24 h) < **0,80** an **sprungfreien** Tagen (Sprungtage via CUSUM
   auf Δp markiert),
3. **Pinball-Loss** (τ = 0,5, 24 h) < Pinball der Naive **und**
   asymmetrischer Pinball (τ = 0,75: Unterschätzung des Preises 3× so stark
   bestraft, weil Warten in eine Erhöhung Vertrauen kostet) < asym-Pinball
   der Naiven — Gate `pinball_asym_better_than_naive`, ergänzt MASE/PICP,
   ersetzt sie nicht,
4. Rolling-PICP(95 %) ∈ [90, 98] %.

### 3.3 Intervallkalibrierung (Ziel, noch nicht freigeschaltet)

1. Residuen-Block-Bootstrap (Block = Resttag, B = 500) → Quantile
   q̂.10/q̂.90 für 80 %, q̂.025/q̂.975 für 95 %.
2. **Adaptive Conformal Inference:** Nonkonformitäts-Scores
   s(t) = max(q̂_lo − y, y − q̂_hi) über 14 Tage;
   α_{t+1} = α_t + η·(α_Ziel − 1{y außerhalb des Intervalls}), **η = 0,005** Startwert
   (stark autokorrelierte 5-min-Scores → kleine effektive Stichprobe),
   im Dashboard konfigurierbar. **ACI erst nach 4 Wochen Live-Betrieb**,
   vorher als unkalibriert gekennzeichnete Bootstrap-Intervalle.
   Das ist keine Garantie für den nächsten Einzelpreis; unter Drift und
   Abhängigkeit muss die tatsächliche Überdeckung laufend geprüft werden.
   Die operationelle Wahrheit bleibt das gemessene Rolling-PICP.
3. **Monitoring:** 7-Tage-Rolling-PICP je Station als Konfidenz-Badge
   (grün ≥ Nominal − 2 pp, gelb ± 5 pp, rot → §4.4-Modus).

### 3.4 Horizonte & Gütenachweis

| Horizont | Arbeitsstand |
|---|---|
| Heute / folgende 24 h | Vorläufige Prognose und täglicher Rolling-Origin-Backtest implementiert; noch kein Echt-Daten-Gütenachweis im Repo. |
| +3 Tage / +7 Tage | Vorläufiger Ausblick ab Fit-Cutoff möglich; Mehrtage-Backtests und kalibrierte Bänder noch offen. |

Der tägliche Cutoff liegt bei lokaler Mitternacht, das Trainingsfenster bei
42 Tagen (nicht pauschal verdoppelt; stattdessen exponentiell gewichteter
Tagesblock-Bootstrap, Halbwertszeit 14 Tage, neuere Tage höheres Ziehgewicht).
MAE, RMSE, MASE, sMAPE, Pinball (τ=0,5 und asym τ=0,75), PICP und MPIW werden
gemessen, nicht als erwartete Beispielzahlen zugesagt. Der erste Backtest bewertet
den folgenden Tag im Poll-Fenster; ein punktgenauer +24-h-Test und weitere
Horizonte sind gesondert auszuweisen. Abdeckung-vs.-Reaktionszeit-Vergleich
(42d-EW vs. 42d-uniform vs. 84d): [Engine-Referenz §4](ENGINE.md).

**Grenze (bewusst):** Preissprünge sind Betreiber-Entscheidungen — nicht
punktvorhersagbar. Die Engine sagt *Fenster + Verteilung*, der Decision
Layer (§4) macht daraus die Aussageform, die man handeln kann.

---

## 4. Decision Layer (Ziel)

Input sind die Bootstrap-Draws der Engine (nicht nur Mediane!). Output ist
pro Frage genau eine Antwortkarte. **Ein Bootstrap-Pfad = eine
hypothetische Zukunft**: Alle Wahrscheinlichkeiten in diesem Abschnitt sind
relative Häufigkeiten über dieselben B = 500 Draws — dadurch sind sie
intern konsistent (F2 nutzt zusätzlich die **gemeinsame** Ziehung über
Stationen, damit Marktbewegungen nicht weggerechnet werden: steigt der
ganze Markt, steigen alle mit).

### 4.1 F1 — „Jetzt oder warten?“

Input: aktueller Preis p_jetzt an Station S, Prognoseverteilung der
nächsten H Stunden (H = Resttag bzw. bis zum spätesten notwendigen
Tankzeitpunkt `latest_by`).

```
p_min_erwartet = min_{t ∈ [jetzt, jetzt+H]} median(p̂(t))
t*             = argmin ebenda                                  (bestes Fenster)
Δ              = p_jetzt − p_min_erwartet                       (erwartete Ersparnis)
P_besser       = P( min_{t ∈ Fenster t*} p(t) ≤ p_jetzt − θ )   (aus Bootstrap-Draws)
               mit θ = 1 ct  (Signifikanzschwelle, gegen Rauschen)
€_ersparnis    = Δ · L
```

**Entscheidungsregel (alle Schwellen kalibrierbar, §4.5):**

| €_ersparnis | P_besser | Empfehlung | Ampel |
|---|---|---|---|
| ≥ 2,00 € | ≥ 70 % | **WARTEN bis {t}\*** | grün |
| ≥ 1,00 € | ≥ 60 % | „Warten lohnt eher“ | gelb |
| < 1,00 € | beliebig | **JETZT tanken** | grün |
| beliebig | < 50 % | JETZT tanken (Prognose unsicher) | grau |

Das ist die komplette UI-Logik für F1: eine Ampel, ein Zeitfenster, ein
€-Betrag, eine Prozentzahl. Keine ct-Kurve, keine Bänder.

*Prototyp-Referenz (`sample/good gui`, `evaluateRefuelingDecision`):*
Warte-Zweig ab ≥ 1,00 € Ersparnis und > 30 min bis zum Fenster; „JETZT“,
wenn der aktuelle Preis bereits innerhalb ± 1,5 ct des Tagesminimums liegt.
Diese Werte sind die Startkalibrierung für die Tabelle oben; die
asymmetrischen Prozentgates (70/60/50 %) kommen mit M7 hinzu, sobald
empirische Trefferquoten vorliegen.

### 4.2 F2 — „Hier oder woanders?“

Input: erreichbare Stationen {S₁, …, Sₙ} mit Nowcasts, Standort, Zeitpunkt.

```
p̂_i        = median(p̂_i(jetzt))                    (Nowcast)
€_brutto_i = (p̂_ref − p̂_i) · L                     (ref = aktuelle/erste Station)
€_umweg_i  = K(d_i) nach §10  (mit zeitabhängigem z: peak/offpeak)
€_netto_i  = €_brutto_i − €_umweg_i
P_lohnt_i  = P(€_netto_i > 0)   ← aus GEMEINSAMER Bootstrap-Ziehung über alle Stationen
```

Anzeige: sortierte Liste, pro Station eine Zeile —

```
Aral Hauptstr.    JETZT  1,689 €    ± Referenz
Shell Bahnhof     +2 km  1,649 €    −1,20 € netto    82 % sicher
Star Ostring      +5 km  1,629 €    −0,40 € netto    54 % sicher (grenzwertig)
JET Autobahn      +8 km  1,619 €    −0,30 € netto    38 % sicher (Umweg zu teuer)
```

Die kritische Zusatzinformation ist **P_lohnt**, nicht Δp: Wem 54 % zu
wenig sind, fährt nicht. Prototyp-Regel (Statistik-GUI `pairEval`):
Vorschlag nur, wenn der erwartete Netto-Vorteil die kritische
Preisdifferenz Δp\* = K/L klar übersteigt (im Alltags-Prototyp ≥ 1,50 €
netto); **P_lohnt wird daneben ausgewiesen.**

*Konsistenz-Falle korrekt gelöst:* gemeinsame Bootstrap-Ziehung — sonst
korreliert man Marktbewegungen weg.

### 4.3 F3 — „Heute oder morgen/übermorgen?“

Input: Prognose 0–72 h (bzw. 0–168 h) an der bevorzugten Station (oder
Top-3 kombiniert), spätestmöglicher Tankzeitpunkt T_max
(`latest_by`, z. B. „muss bis Freitag 20 Uhr“).

Berechnung: über alle Tank-Fenster [t, t+30 min] ∈ [jetzt, T_max] wird die
**Verteilung der Fensterminima** berechnet. Ausgabe: die **3 besten
Fenster** (nicht nur das beste — Nutzer will Alternativen) mit

1. Median-Preis im Fenster,
2. P(dieses Fenster ≤ Alternative im ± 6 h-Umfeld),
3. erwartete Ersparnis vs. „jetzt tanken“.

Anzeige als Kacheln (heute ≤ 24 h → „Heute später“, ≤ 7 d → „Diese Woche“):

```
🏆 Di 19–21 Uhr    ~1,619 €   −2,80 € vs. jetzt   68 %
   Mi 20–22 Uhr    ~1,629 €   −2,40 € vs. jetzt   61 %
   Do 06–08 Uhr    ~1,635 €   −2,20 € vs. jetzt   55 %
```

Keine Kurve — drei Zeilen, drei Preise, drei Prozentzahlen.

### 4.4 Modus „Keine klare Empfehlung“

Auslöser (irgendeines): Rolling-PICP außerhalb Toleranz (§3.3 rot) **oder**
P_besser ∈ [40 %, 60 %] **oder** Confidence-Badge „low“ in beiden
Fenster-Alternativen.

Verhalten: keine Ampel, kein Prozentwert. Stattdessen: „**Keine klare
Empfehlung — tank nach Bedarf**“ + reine Aktualpreise der 3 nächsten
Stationen (Information ohne Entscheidungsanmaßung). Begründung per Tap:
„Prognose derzeit unsicher (Markt unruhig)“. Dieser Modus ist produktseitig
ein **Feature**: Er ist der Beweis, dass die App falsche Präzision scheut.

### 4.5 Priorität und Kalibrierung der Regeln

Reihenfolge der Auswertung pro Interaktion:

1. **Güte-Gate** (§4.4): PICP/P_besser im Unsicherheitsband? → „Keine klare
   Empfehlung“.
2. **F2:** beste Alternative mit €_netto ≥ Schwelle **und** P_lohnt ≥
   Schwelle? → „Fahre zu …“.
3. **F1:** Entscheidungstabelle 4.1 → „Warten“ / „Jetzt“.
4. **F3** läuft immer mit (Karte „Heute später“ / „Diese Woche“), auch wenn
   F1 „Jetzt“ sagt — sie beantwortet eine andere Frage.

Asymmetrie der Fehler (dictiert die Schwellen):

- Falsches **WARTEN** (Preis steigt) = Nutzer verliert Geld **und** ist
  genervt → doppelter Schaden → hohes Prozentgate (70 %) für WARTEN.
- Falsches **JETZT** (er hätte warten können) = nur entgangene Ersparnis →
  kein Prozentgate, nur €-Gate.

Alle Schwellen (€-Stufen, 70/60/50 %, θ, F2-Netto-Schwelle) liegen in einer
Config; **M7** zieht sie nach 4 Wochen Live-Daten an die gemessenen
Trefferquoten heran (§13), bis die Produkt-KPIs (§6) getroffen sind.

---

## 5. Konfidenz, die man wirklich fühlen kann

PICP, MASE, Pinball bleiben Engine-Abnahmekriterien (§3.2) — für Nutzer
sind sie bedeutungslos. Nutzer-Konfidenz besteht aus zwei Dingen:

### 5.1 Kalibrierte Wahrscheinlichkeiten (die „82 %“)

```
BS = mean_i ( P_besser_i − 1{Warten war richtig}_i )²
```

Zielwerte: **BS < 0,20 brauchbar** (Zufall = 0,25), **BS < 0,15 gut**.
Reliability-Diagramm: 10 Bins (0–10 %, …, 90–100 %) auf der Diagonalen
± 5 pp. Der Brier-Score ersetzt PICP als **Produkt-KPI**; PICP bleibt
Engine-Güte. Implementiert im Statistik-Prototyp als Kalibrierungs-Plot
(behauptet P(S>0) vs. real, getrennt Werktag/Wochenende, mittlere Abweichung
in pp) — genau dieses Diagramm wandert als „Kalibrierung“-Sektion in die
Werkstatt.

**Hartes Gate (§0.4):** Prozent-Anzeigen erst ab Brier < 0,25 bei ≥ 100
abgeschlossenen Empfehlungen. Vorher binäre Empfehlung.

### 5.2 Erfolgs-Tracking (die eigentliche Vertrauensbildung)

Die App merkt sich **jede** Empfehlung + tatsächlichen Ausgang:

```
Deine App-Bilanz (letzte 30 Tage):
  23 Empfehlungen "WARTEN" → 19× richtig (83 %)   ✅ gut kalibriert
  41 Empfehlungen "JETZT"  → 38× richtig (93 %)
  Ø Ersparnis pro befolgte Empfehlung: +1,80 €
  Gesamt-Ersparnis vs. "immer sofort tanken": +42,50 €
```

**Datenerfassung — zwei getrennte Ströme (§5.4):**

- **Advice-Ledger (ohne Nutzer-Input):** Log je *kollabiertem* Snapshot
  einer Tank-Folge (`episode_id, snapshot_id, station_id, action, p_besser,
  expected_saving_eur, emitted_at, window_start, window_end`). Sobald der
  Ist-Preis für das Fenster bekannt ist (eigene Preishistorie, nach
  `window_end` + Lag), wird `outcome ∈ {win, loss, tie}` plus `regret_eur`
  ergänzt. Das ist Brier, Trefferquote, M7.
- **Wallet-Ledger (mit Nutzer-Input, asynchron):** Fill-Events
  (`station_id, tanked_at, liters, price_paid`) werden einer Folge
  zugeordnet — nicht dem einzelnen `/v1/decide`-Aufruf. UX und Matching
  in §5.4. Ohne Fill behauptet die App **keine** persönlichen Euros.
- Die Werkstatt aggregiert das Advice-Ledger zum **Scoreboard** (je Station:
  P behauptet vs. real, Trefferquoten je Aktionsart, Ø Regret, Regel-€ vs.
  Orakel-€ — exakt die Tabelle des Statistik-Prototyps). Das Wallet-Ledger
  erscheint im Alltag als „Deine Tank-Bilanz“.

Ist die Advice-Bilanz negativ, weiß es der Nutzer sofort — die App kann
sich nicht selbst schönlügen. Ist die Wallet-Bilanz leer, steht dort ehrlich
„0 Füllungen“, nicht eine hochgerechnete Compliance-Fantasie.

### 5.3 Was mit den Bändern passiert

Die 80/95 %-Bänder verschwinden nicht — sie sind die mathematische Basis
für P_besser und €_netto. Aber: **UI zweiter Ordnung.** Versteckt unter
„Details“/„Warum?“ (Werkstatt-Modus) oder als kleine Sparkline neben der
Empfehlung. Wer wissen will „wie sicher genau?“, tippt drauf. Alle anderen
sehen die Ampel.

### 5.4 Feedback trotz asynchronem Tanken — drei Uhren, eine Folge

Das ist die Stelle, an der v5 sonst in sich zusammenfällt. Empfehlung,
Absicht und Zapfhahn liegen **stunden- bis tageweise auseinander**. Wer
Feedback an den `/v1/decide`-Aufruf hängt, hat eines von zwei Problemen:

1. Die App fragt nach jedem Öffnen „hast du getankt?“ — der Nutzer lernt,
   die Frage zu ignorieren (und tankt ~1,2×/Woche, öffnet die App aber
   5×/Tag).
2. Die App nimmt an, die Empfehlung sei befolgt worden, und schreibt
   +1,80 € ins Erfolgskonto — das ist gelogen, sobald er doch morgens
   vollmacht.

Beides zerstört genau die Vertrauensbildung, für die §5.2 existiert.
Die Lösung ist nicht ein besserer Button an der Säule, sondern eine
**andere Einheit**.

#### Die drei Uhren

```
  Advice-Uhr          Intent-Uhr              Fill-Uhr
  (Entscheidung)      (Absicht, kein Tank)    (Zapfhahn)
       │                    │                      │
  14:12  GET /v1/decide      │                      │
       │  „WARTEN 18–20“     │                      │
  14:18  Refresh (gleiche    │                      │
       │  Advice → kein      │                      │
       │  neuer Snapshot)    │                      │
  14:19  Tap „Ich warte“ ────┘                      │
       │                                            │
  18:40  Advice kippt auf                           │
       │  „JETZT“ (Fenster da)                      │
  19:05  Nutzer tankt ──────────────────────────────┘
  21:00  Job: Advice-Settlement aus Preishistorie
         (unabhängig davon, ob ein Fill existiert)
```

| Uhr | Frage | Quelle | Nutzer nötig? | KPI |
|---|---|---|---|---|
| **Advice** | War die Empfehlung richtig? | Preishistorie vs. Snapshot | nein | Brier, Trefferquote WARTEN/JETZT, Regret |
| **Intent** | Hat er die Ampel ernst genommen? | Tap „Ich warte“ / Navigation | ja, 1 Tap, 2 s | nur UX-Zustand (Erinnerung, Prompt) |
| **Fill** | Hat *er* Geld gespart? | gemeldeter Tankvorgang | ja, asynchron | Wallet-€ vs. immer-sofort; Compliance |

**Hartes Trenngebot:** Advice-Zahlen und Wallet-Zahlen dürfen im UI nie
dieselbe Zeile sein. „19/23 WARTEN richtig“ ist Modell. „+12,40 € in
7 Füllungen“ ist sein Geld. Wer die 19/23 mit 40 L hochrechnet, lügt
über Compliance.

#### Die Einheit ist die Episode, nicht der Decide-Call

Eine **Tank-Folge** (`episode`) ist der Zyklus „ich muss demnächst
tanken“ bis „ich habe getankt / die Folge ist verfallen“.

```
episode
  status: open | waiting | due | resolved | expired
  intent: none | wait | navigate | refuel_now | dismiss
  snapshots[]     ← kollabierte /v1/decide-Antworten
  fill?           ← 0 oder 1 FillEvent
```

Kollabierungsregel für Snapshots (sonst gewichtet der Viel-Öffner den
Brier): gleicher `action` + gleiche Station + Δt < 30 min → Snapshot
*aktualisieren*, nicht anhängen. Ein neuer Snapshot nur, wenn die
Advice kippt (WARTEN → JETZT, andere Station) oder 30 min um sind.
Brier/M7 scoren **Snapshots**, nicht HTTP-Requests — und sie scoren
sie auch dann, wenn nie jemand getankt hat.

Advice darf in der Folge kippen. Das ist ein Feature: morgens WARTEN,
18:40 JETZT. **Compliance und Settlement bewerten den letzten Snapshot
vor der Aktion**, nicht den ersten.

Schließbedingungen: Fill gemeldet → `resolved`; `latest_by` oder 72 h
ohne Fill → `expired`; Nutzer tippt „noch nicht“ auf den Prompt →
`expired` (Advice bleibt trotzdem gesettled).

#### Matching ist ein Join mit Slack, kein Foreign-Key vom Zapfhahn

Ein Fill `(station, tanked_at, liters, price)` wird der offenen Folge
zugeordnet, nicht einem Recommendation-Id, den niemand an der Säule
parat hat.

| Letzte Advice | `followed` | `partial` | `ignored` |
|---|---|---|---|
| JETZT | gleiche Station, ≤ 45 min | gleiche Station, später | andere Station |
| WARTEN | gleiche Station, Fenster ± Slack (Start −30 min, Ende +60 min) | richtige Station oder richtiges Fenster | sofort an der Emit-Station |
| WOANDERS | Fill an der empfohlenen Alternative | dritte Station | Emit-Station ohne Umweg |

Kein Treffer in 72 h → Fill ist `unrelated` (Tank ohne App) oder die
Folge verfällt ohne Fill. Nur `followed` zählt für „Ø Ersparnis pro
*befolgte* Empfehlung“. Alle Fills zählen für „vs. immer sofort“
(Counterfactual = `price_now` des *ersten* Snapshots der Folge).

Preis am Fill **nicht abtippen lassen**: Nowcast bzw. eigener Poll der
Station zur `tanked_at` ist Vorbelegung. Der Nutzer bestätigt oder
korrigiert Liter. Das ist der ganze Beleg.

#### UX-Prinzip: nie an der Säule, immer in der nächsten ruhigen Öffnung

An der Zapfsäule ist schlechtes Netz, nasse Finger, kein Kopf für ein
Formular. Deshalb:

| Zeitpunkt | Was die App tut | Was sie nicht tut |
|---|---|---|
| Ampel JETZT | Primär-CTA **„Ich tanke jetzt“** (Fill sofort, Preis = Nowcast). Maps daneben. | Kein Modal, kein Liter-Dialog |
| Ampel WARTEN | Primär-CTA **„Ich warte bis 18:30“** setzt nur Intent. Optional lokale Notification 15 min vor Fenster (P2). | Kein Fill fingieren, keine Frage |
| Ampel WOANDERS | Navigation setzt Intent `navigate`. Fill wird **nicht** angenommen. | Location-Tracking, Geofence |
| Fenster vorbei, Intent gesetzt, kein Fill | Folge → `due`. Beim **nächsten** Öffnen eine Karte: „Hast du getankt?“ mit drei Taps: *Ja, wie empfohlen* / *Anders* / *Noch nicht*. | Push-Nagging, Frage nach jedem Refresh |
| Kein Intent, nur geschaut | nichts | Prompt |

„Anders“ klappt Station/Zeit/Liter auf, alles vorbelegt. Ein Tap mehr.
Offline: Fill und Intent landen in der PWA-Queue (IndexedDB), Sync
gegen NAS sobald Netz da ist — Client-UUID, idempotent.

Prototyp im Alltags-GUI (`sample/good gui`, `lib/feedback.ts`): der
Uhrzeit-Slider *ist* die asynchrone Struktur. Intent „Ich warte“,
Slider über das Fenster → Due-Prompt. Zwei getrennte Ledger-Karten
darunter. Genau so soll es sich anfühlen.

#### Was wir ausdrücklich nicht tun

- Kein GPS-Geofence „5 min an Station = getankt“ (Privatsphäre, False
  Positives an der Waschstraße).
- Kein Beleg-OCR, kein Bankimport.
- Kein Prompt nach jedem `/v1/decide`.
- Keine persönlichen € aus Advice × angenommener Compliance.
- P_besser weiterhin nur aus Advice-Settlements — Fills sind zu selten
  für Brier (≥ 100 Snapshots in 4–6 Wochen sind realistisch, ≥ 100
  Füllungen nicht).

#### Job und API (Produktiv, NAS)

Nach `window_end` + 30 min (bzw. 24 h-Lag, falls Poll-Lücken): Settlement
aus Influx, unabhängig vom Fill. Endpunkte in §11.2. Wie daraus
Werkstatt-Zahlen werden: §5.5.

### 5.5 Wie Feedback in die Statistik eingeht (drei Schichten, nicht eine)

Die Werkstatt-GUI (`sample/good statistic gui`) rechnet heute einen
**Markt-Backtest**: 14 Tage Preise, jeden Morgen 08:00 hypothetisch
WARTEN/JETZT, Regret gegen Orakel. Dafür braucht sie **keine Fills**.
Live-Folgen und Tankbelege sind zwei *weitere* Schichten. Die drei dürfen
im Scoreboard nie in eine Spalte fallen.

```
Preishistorie (Influx)                Episodes/Snapshots                 Fills
        │                                    │                              │
        │  A  Markt-Labor                    │  B  Live-Advice              │  C  Wallet
        │  (wie die Statistik-GUI            │  Settlement-Job              │  Matching §5.4
        │   heute: jeder Tag,                │  nach window_end             │
        │   auch ohne App-Nutzung)           │                              │
        ▼                                    ▼                              ▼
  Trefferquote der REGEL              Brier, Reliability,            € vs. immer-sofort
  auf dem Markt, ε-Scan,              Trefferquote der               Compliance
  Orakel-€  (§8.2 Scoreboard)         AUSGESPIELTEN Advice            w(h)-Profil
                                      → M7-Schwellen                  (≥ 8 Fills)
```

#### Schicht A — Markt-Labor (unverändert, ohne Nutzer)

Input: Preisreihe je Station. Pro Eval-Tag: S = p(08:00) − p(Fenster),
Regel `μ ≥ ε`, Regret gegen Tagesminimum. Output: die Tabelle, die der
Statistik-Prototyp schon zeigt. Das beantwortet „ist die Regel auf dem
Markt überhaupt geldwert?“, nicht „hat *du* getankt“. Läuft weiter als
täglicher NAS-Job (Rolling-Origin, §3.4) → `GET /v1/stats/summary`
Feld `backtest`.

#### Schicht B — Live-Advice (automatisch, sobald M5 sendet)

Jeder kollabierte Snapshot (§5.4) wird nach Fensterende gegen die
**echte** Preishistorie gesettled — egal ob ein Fill existiert.

Verarbeitung (NAS, nach Settlement-Job):

1. `outcome ∈ {win,loss,tie}` und `regret_eur` am Snapshot (schon §5.2).
2. Aggregation 7/30 Tage, je Station und Aktionsart:
   Trefferquote WARTEN/JETZT, mittleres `p_besser`, empirische
   Trefferrate, Brier, 10 Bins Reliability.
3. Dieselben Kennzahlen, die der Statistik-Prototyp am Backtest zeigt —
   nur diesmal über **ausgespielte** Empfehlungen, nicht über
   hypothetische 08:00-Tage. Werkstatt: zweite Scoreboard-Zeile
   „Live · n Snapshots“, Kalibrierungs-Plot bekommt Live-Punkte
   (andere Farbe) sobald n ≥ 20.
4. **M7:** wenn n ≥ 100 und Brier < 0,25 → P_besser-Anzeige an;
   wenn Trefferquote WARTEN < 70 % → ε / Prozentgate anziehen.
   Getuned wird an Schicht B, nie an Schicht C.

Ein Fill ändert Schicht-B-Zahlen **nicht nachträglich**. Sonst würde
„ich hab anders getankt“ die Kalibrierung der Ampel verbiegen.

#### Schicht C — Wallet / Fills (selten, persönlich)

~1,2 Füllungen/Woche. Zu wenig für Brier, genug für drei Dinge:

| n Fills | Was passiert | Wohin |
|---|---|---|
| 0 | Wallet zeigt „0 Füllungen“, keine €-Erfindung | Alltag-Ledger |
| ≥ 1 | `saved_vs_always_now`, Compliance followed/partial/ignored | Alltag + Werkstatt-Kachel „Deine Füllungen“ |
| ≥ 8 | empirisches Tankzeit-Histogramm (Stunde × Werktag/WE), **geschrumpft** gegen Default-Pendlerprofil w(h): w ← (n·ŵ + 8·w₀)/(n+8) | Selektion AVᵢ, F3-Fenster-Gewichtung (§12 P1) |
| ≥ 30 | grobe Jahres-€-Bilanz vs. immer-sofort und vs. Orakel der Tage mit Fill | Werkstatt, unterer Block, mit n in der Überschrift |

Nicht verarbeiten (zu wenig Signal, zu viel Schaden): Fill-Outcomes in
Brier mischen; ε aus 7 Füllungen nachziehen; Station-δ̂ aus dem eigenen
Tankverhalten schätzen.

#### Was `GET /v1/stats/summary` konkret liefert

```json
{
  "backtest": { /* Schicht A, wie der Statistik-Prototyp */ },
  "live_advice": {
    "n": 64, "brier_30d": 0.14, "hit_wait": 0.83, "hit_now": 0.93,
    "reliability": [ /* 10 Bins */ ]
  },
  "wallet": {
    "n_fills": 7, "followed": 4, "saved_eur": 12.40,
    "wh_hours": [ /* 24-Vektor, erst ab n≥8 ungleich Default */ ]
  }
}
```

Alltag zeigt `live_advice.hit_*` (ohne Brier-Zahl vor M7) und `wallet`.
Werkstatt zeigt alle drei Blöcke, Backtest groß, Live daneben, Wallet
klein und n-beschriftet.

---

## 6. Abnahme-Kriterien: Produkt-KPIs (neben den Engine-Kriterien §3.2)

| KPI | Definition | Zielwert | Warum |
|---|---|---|---|
| **Brier-Score P_besser** | §5.1 | < 0,20 | Kalibrierung der Kernaussage |
| **Trefferquote WARTEN** | Anteil richtiger „warten“-Empfehlungen | > 70 % | Nutzer verzeiht keine falschen Wartevorschläge |
| **Trefferquote JETZT** | Anteil richtiger „jetzt“-Empfehlungen | > 85 % | Fehlalarm nach oben ist teurer (doppelter Schaden, §4.5) |
| **Ø realisierte Ersparnis/Empfehlung** | € gespart bei Fills mit `compliance=followed` (§5.4) | > 1,00 € | unter 1 € ist die App die Aufmerksamkeit nicht wert; ohne Fills ist diese KPI undefiniert, nicht 0 |
| **Top-3-Fenster-Trefferquote** | tatsächliches Tagesminimum in einem der 3 empfohlenen Fenster | > 60 % | war schon in v4 Produkt-Kennzahl, bleibt gültig |
| **Regret-Ratio** | realisierte Ersparnis / Oracle-Ersparnis | > 0,55 | wie viel des theoretisch Möglichen hebt die App (Kennzahl aus dem Statistik-Prototyp: „geholtes Potenzial“) |

Die Kalibrierung ist tunbar: nach 4 Wochen Live-Betrieb tatsächliche
Trefferquoten messen (M7) und Schwellen nachziehen, bis die Zielwerte
stehen.

---

## 7. Polling-Fenster: 06:00–24:00 (fix)

Produktions-Default des Collectors: **06:00–24:00**, 216 Requests pro Tag
bei einem Request je fünf Minuten. Die frühere Zahlenbegründung stammte aus
synthetischen Daten und wurde entfernt; sie ist kein Nachweis für den echten Markt.

- Das Fenster deckt Morgen- und Abendverlauf ab, ohne eine zusätzliche
  adaptive Per-Station-Scheduler-Logik.
- Abweichende Fenster über die vorhandenen Flags `--window-start` und
  `--window-end`; Volltag mit `--window-start 0 --window-end 24`.
- `analysis/window_analysis.py` bleibt für eine erneute Prüfung mit **echter**
  Historie erhalten; Bericht und Abbildungen werden lokal erzeugt.
- Der M3-Backtest verwendet standardmäßig dasselbe Fenster (`--poll-start 6`
  / `--poll-end 24`). Nicht beobachtete Nachtstunden werden nicht als
  abgesicherte Empfehlung ausgegeben.

---

## 8. UI: zwei Moden, ein Startbildschirm mit ≤ 3 primären Zahlen

### 8.1 Modus „Alltag“ (Default) — der Entscheidungs-Kompass

Startbildschirm = **eine Karte, drei Zeilen**:

```
┌─────────────────────────────────────┐
│  🟢 JETZT TANKEN                     │
│  Aral Hauptstr. · 1,649 € · 400 m   │
│  Warten würde <1 € bringen           │
│  [Ich tanke jetzt]  [Maps]           │
└─────────────────────────────────────┘

  Alternativen (2)          [Details ▼]
  Heute später              [Details ▼]
  Diese Woche               [Details ▼]
```

Aufgeklappt:

- **Alternativen** → die F2-Liste (§4.2).
- **Heute später** → die F3-Fenster bis Tagesende (§4.3); darunter optional
  der kompakte **Tagesstreifen** aus dem Alltags-Prototyp (06–24 Uhr als
  klickbare Stundenzellen, grün/amber/rot, „Jetzt“-Marker) — er ist ein
  Zeit*fenster*-Wähler, keine Prognose-Kurve.
- **Diese Woche** → dieselbe Logik, Horizont 7 Tage.
- **Details / „Warum?“** → Sprung in die Werkstatt (§8.2) an genau die
  Stelle, die die Empfehlung begründet (Fan-Chart + Heatmap + P_besser-Herkunft).

Die Hero-Karte übernimmt die Sprache des Alltags-Prototyps: Ampel-Badge
(„JETZT TANKEN“ / „WARTEN BIS ~18:30 UHR“ / „FAHRE ZU SHELL (+1,20 €
NETTO)“), Headline mit €-Betrag, 2–3 Begründungs-Stichpunkte, großer
**Handlungs-CTA nach Ampel** (§5.4): „Ich tanke jetzt“ (Fill sofort) /
„Ich warte bis …“ (nur Intent) / Navigation (Intent `navigate`). Maps
daneben (Deep-Link ohne API-Key,
`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`). Beim
nächsten Öffnen nach Fensterende: Due-Prompt „Hast du getankt?“. Die
drei Optionen **Jetzt / Warten / Andere Station** stehen zusätzlich als
Vergleichs-Kacheln mit ihrem Netto-€-Ergebnis — die einzige Tabelle,
die an der Säule noch funktioniert. Unter der Karte: zwei getrennte
Ledger (Advice vs. Wallet), nie in einer Zahl.

**Kontext-Kontrolle** (aus dem Prototyp übernommen): Kampagnen-Umschalter
(Frankfurt HE · München BY · Köln NW), Kraftstoff-Umschalter (E10 · E5 ·
Diesel) mit E5-Äquivalenz-Hinweis (§10), „Stand: HH:MM“-Zeitstempel,
What-If-Slider (Tankmenge 20–80 L, Zeitwert z inkl. Auto-Modus 16/10 €/h
peak/offpeak) unter „Parameter“.

**PWA/Offline:** Service Worker mit Cache-First für die letzte
`/v1/decide`-Antwort (max-age 30 min), Stale-While-Revalidate für
Werkstatt-Daten; Offline-Banner; der Kern-Use-Case „an der Säule, schlechtes
Netz“ funktioniert offline mit gekennzeichnetem Datenstand. HTTPS via
Caddy ist Pflicht (SW).

**Fertig-Kriterium M4 (hart):** Der Startbildschirm hat **≤ 3 primäre
Zahlen** (Ampel-Aktion, €-Betrag, P_besser). Alles andere ist
aufgeklappt oder Werkstatt.

### 8.2 Modus „Werkstatt“ — das Entscheidungs-Labor

Der Statistik-Prototyp wird hier 1:1 produktiv. Sektionen:

1. **Die Entscheidungs-Regel:** Anzeige der aktiven Schwellen (€-Stufen,
   Prozentgates, θ) mit Erklärtext; interaktiver **ε-/-Schwellen-Slider**
   als Analyse-Instrument („Was würde die Regel mit ε = 0,5 ct anders
   sagen?“) — **die Produktion entscheidet weiterhin mit der kalibrierten
   Tabelle §4.1**, der Slider zeigt nur Konsequenzen.
2. **Scoreboard (drei Schichten, §5.5):** groß der Markt-Backtest (wie
   der Statistik-Prototyp, ohne Fills); daneben Live-Advice (gesettelte
   Snapshots, Brier/Trefferquoten); unten klein Wallet (n Füllungen auf
   der Kachel). ε-Slider wirkt nur auf den Backtest-Was-wäre-wenn, nicht
   auf Live-Schwellen.
3. **Kalibrierung:** Reliability-Diagramm (§5.1) aus Backtest, ab n ≥ 20
   Live-Punkte in zweiter Farbe; Brier 30 d aus Schicht B. Nach M7 das
   offizielle Debug-Diagramm.
4. **Stations-Labor:** Tag-für-Tag-Protokoll je Station, Preisverlauf mit
   Markern (Entscheidungszeitpunkt, vorhergesagtes Fenster, Ist-Verlauf),
   Histogramm der Trainings-Ersparnisse S mit μ- und ε-Markern,
   ε-Scan (Gesamtergebnis € als Funktion der Schwelle).
5. **Paarvergleich (F2-Werkzeug):** Station A vs. B mit Umweg-Slidern
   (Liter, Umweg-km, Verbrauch, Geschwindigkeit, Zeitwert z, peak/offpeak),
   Ausgabe K(d), Δp\*, brutto/netto, P_lohnt, out-of-sample-Nettos je Tag.
6. **Fan-Chart + Heatmaps:** Preisniveau (DoW × Stunde, Median 6 Wochen)
   und Cheap-Probability (P(p ≤ Stadtmedian)) — die vier Dashboard-Kacheln
   aus v4 §5 **wandern hierher**; sie sind Analyse-, keine
   Entscheidungswerkzeuge.
7. **Meine Stationen:** das Top-10-Ranking, sortiert nach aktueller
   Empfehlungsstärke (§2); δ̂ nur im Stations-Detail („langfristig 3,80 ct/L
   günstiger als Umgebung“), mit Bootstrap-KI-Whiskern. *(Stand 10.09.2026: die
   Werkstatt-Ansicht sortiert nach δ̂-Score — als Analyse-Werkzeug sachlich
   korrekt; die Sortierung nach Empfehlungsstärke bleibt Zielbild, Abgleich in
   [LUECKEN.md](LUECKEN.md).)*
8. **System-Status:** Pi ↔ NAS (Collector-Stand, tmpfs-Füllstand,
   NAS-Erreichbarkeit, Coverage, CUSUM-Driftstatus, letzte Fehler).
9. **API-Explorer:** die Endpunkte (§11) mit Live-Beispiel-Queries.

Footer in beiden Modi: „Daten: MTS-K via tankerkoenig.de (CC BY 4.0)“ ·
Token-Bucket · Fenster 06–24 · Datenstand.

### 8.3 Designprinzipien (aus beiden Prototypen destilliert)

1. Ampel zuerst, Zahlen second, Graphen third (und nur auf Wunsch).
2. Jede Prozentzahl ist entweder kalibriert (dann darf sie da sein) oder
   wird nicht angezeigt (§0.4).
3. Jede Empfehlung ist mit einem €-Betrag und einer Handlung verknüpft
   (Navigieren / warten / Station wechseln).
4. Der Datenstand ist immer sichtbar; offline degrade zu „letzter Stand +
   Warnung“.
5. Der Moduswechsel Alltag↔Werkstatt ist ein Tap, kein Architekturbruch —
   gleiche Daten, andere Übersetzung.
6. Feedback nie an der Säule, immer in der nächsten ruhigen Öffnung
   (§5.4). Advice-Ledger und Wallet-Ledger sind zwei Zahlen, nicht eine.

---

## 9. Systemarchitektur: Pi ↔ NAS

> **Schritt-für-Schritt-Erstinstallation (welcher Baustein auf welches
> Gerät gehört, Kommandos, systemd-Unit, Key, Störungsfälle):
> [`INSTALL.md`](INSTALL.md).** Kurz: Collector 24/7 auf dem **Pi**
> (Puffer im RAM), Archiv/InfluxDB/Fits/API/GUI auf dem **NAS**, PC optional.

### 9.1 Rollen & Datenfluss

| Aufgabe | Gerät | Begründung |
|---|---|---|
| Collector (ein Request alle 5 min; Städte abwechselnd, 06–24) | **Pi** | 24/7-Bereitschaft |
| Kurzzeit-Puffer | **Pi: tmpfs** `/dev/shm/tankapp` | RAM statt SD → SD-Schonung |
| Langzeit-Speicher | **NAS: InfluxDB (Docker)** | Plattenplatz, Retention |
| Hosting TankPuls-API + Web-GUI | **NAS** | ein gemeinsamer Daten-/App-Server; bei ausgeschaltetem NAS nicht erreichbar |
| Archiv für Engine und Langzeitvergleiche | **NAS: komprimierte Preis-/Stationsdateien, mindestens ein Jahr bei Bedarf** | automatischer Sync bei Start und regelmäßig; alte Lücken nachholen |
| **Engine-Fits, Rolling-Backtests, ACI-Kalibrierung, Decision-Layer-Kalibrierung (M7)** | **NAS (oder PC per WOL)** | Pi bleibt Collector/Uploader, Inference läuft auf dem NAS; der tägliche Backtest (bis 42 Refits × 10–30 Modelle) gehört auf 16 GB/x86, nicht auf 1 GB ARM |
| **Episode-/Snapshot-/Fill-Log (§5.2, §5.4)** | NAS (Tabelle; heute JSON-Store, relationale Ablage offen — [LUECKEN](LUECKEN.md)) | Advice-Settlement (Brier, M7) getrennt von Fill-Events (Wallet) |

Ablauf: Collector appended JSON-Zeilen an
`/dev/shm/tankapp/YYYY-MM-DD.jsonl`; Ringpuffer 7 Tage; Uploader pingt
TCP 8086 alle 60 s, Batch-Transfer unbestätigter Zeilen, Ack via
`meta/synced_until`, **idempotent** (§1.2). Jeder neue Punkt enthält zusätzlich
`station_id` als UUID-Tag; `station` bleibt Anzeigename. Alte Namenskollisionen
werden nicht geraten: [UUID-Umstellung/Replay](archiv/STATIONS-UUID-MIGRATION.md). Replay ist
explizit und ändert keinen Ack. NAS-Ausfall: 7 Tage Puffertiefe
(Urlaubssicher), bei Überlauf FIFO + Alarm.

### 9.2 Ressourcen-Rechnung (Pi: 921 Mi total / 571 Mi verfügbar)

| Posten | Bedarf |
|---|---|
| Collector + Uploader | ~40–60 MiB RSS |
| API/Web-GUI | läuft auf dem NAS, nicht im Pi-Budget |
| tmpfs-Ringpuffer (Limit 32 M) | ≤ 32 MiB |
| **Pi-Budget (Schätzung)** | **Collector/Uploader + bis zu 32 MiB Puffer; im Betrieb messen** |

Datenvolumen: JSONL ≈ 2,5 kB/Poll → 216 Polls ≈ 0,6 MB/Tag. InfluxDB:
bis zu **2 160 Stations-Snapshots/Tag** (10 Stationen × 216 Polls).
Der laufende Uploader schreibt je Snapshot den Status und bis zu drei
Preisfelder in **einen** Punkt, nicht drei Stationen-Punkte. Die tatsächliche
Speichergröße und Lückenquote werden im Betrieb gemessen, nicht aus
Demo-Kompressionswerten abgeleitet.

### 9.3 SD-Härtung & Betrieb

```ini
# /etc/fstab
tmpfs  /dev/shm/tankapp  tmpfs  defaults,noatime,size=32M,mode=0755  0  0
# /etc/sysctl.d/99-tankapp.conf
vm.swappiness=10
vm.vfs_cache_pressure=50
```

- `log2ram`/journald-Limits, `noatime` auf `/`; systemd-Units (collector,
  uploader) mit `WatchdogSec=30`, `Restart=always`; **NTP Pflicht**
  (`After=time-sync.target`, UTC speichern, Berlin nur im Frontend).
- NAS: `influxdb:2` + Volume, Retention 5 Jahre, wöchentliches Backup;
  API/Web-GUI auf dem NAS, CORS eng, TLS im Zielbetrieb via Reverse Proxy.
- NAS-Archiv: `tankapp.py history-sync`, bei Start und regelmäßig planen;
  dauerhaftes Volume, eigener Archivzugang, keine Kopplung an das Modell-Trainingsfenster.
- Keys nur in `/etc/tankapp/env` (chmod 600), nie im Repo.

### 9.4 Hardware-Bewertung

| Kandidat | Eignung | Urteil |
|---|---|---|
| **NAS: Pentium Silver J5040, 16 GB** | InfluxDB-Ingest bei 6 480 Punkten/Tag ≈ Last 0; RAM 1–2 GB; Docker-fähig; **alle Fits/Backtests/Kalibrierungen** | ✅ **Empfehlung** |
| PC: Ryzen 7 5700X, 32 GB, RX 9070 XT | fachlich ok, ~20× überdimensioniert; Idle ~50–90 W vs. NAS 10–15 W → 85–150 €/Jahr vs. 30–40 € Strom | ❌ im Dauerbetrieb; optional für Einmal-Analysen (WOL) |

## 10. Fahrzeug- & Umweg-Ökonomie

**Ja, wichtig — als Entscheidungs-/Ökonomie-Parameter, nicht als
Prognose-Input.**

1. **Kraftstoffart** wählt die Preisreihe — primär **E10**. Diesel/E5
   werden mitgesammelt (§2), aber nie mit der E10-Entscheidung
   vermischt; Diesel-Prognose erst nach eigenem Backtest. **E5↔E10:**
   äquivalenter Preis — E10 verbraucht ~1–2 % mehr → E5 lohnt erst bei
   p_E5 ≤ ~1,015·p_E10 (≈ 4–5 ct Differenz).
2. **Tankmenge L** skaliert linear: €/Füllung = Δp·L; bei 40 L zählt
   jeder Cent ≈ 0,40 €. Parameter von Selektion und `/v1/decide`.
3. **Umweg-Ökonomie:** Netto = Δp·L − K(Umweg), mit

   **K = d·(c/100)·p + (d/v)·z** —
   d = Umweg gesamt (Hin+Rück) in km, c = Verbrauch L/100 km,
   v = Durchschnittsgeschwindigkeit, z = Zeitwert €/h.
   Kritische Differenz **Δp\* = K/L**.
   Beispiel: 6 km einfach → d = 12 km, c = 7, p = 1,65 €/L, v = 50 km/h,
   z = 12 €/h ⇒ K = 1,39 € Sprit + 2,88 € Zeit = **4,27 €** ⇒ bei L = 40 L
   lohnt der Umweg erst ab **Δp\* ≈ 10,7 ct/L** — der Zeitwert dominiert.

   **Zeitwert zeitabhängig:** z-Profil mit
   `value_of_time_peak` (16 €/h, 16:30–20:00 Uhr) und `value_of_time_offpeak`
   (10 €/h) plus Slider („Wie viel ist dir 10 min Umweg wert?“); die
   Formel bleibt gleich, `/v1/decide` rechnet mit `when` und liefert
   `z_used` zurück. Die **Selektion** rechnet konservativ mit dem
   Durchschnitt.

   **Warum Zeit überhaupt? — und die „nur Sprit“-Sicht (Stand 2026-09):**
   Die Umwegkosten werden getrennt in `K_sprit` (~0,12 €/km bei
   7 L/100 km, 1,65 €/L) und `K_zeit` (z/v; ~0,24 €/km bei 12 €/h und
   50 km/h, ~0,40 €/km bei 30 km/h Stadt). Die **Zeit ist der größere
   Block**: würde man sie weglassen, gewinnt im Ranking systematisch die
   weit entfernte Billig-Station auf der grünen Wiese — ein Rat, den in
   der Praxis niemand befolgt (~18 min Arbeit für 1 €), und der die
   Erfolgsbilanz (§5.5) verfälscht. Statt dem Nutzer die eine Sicht
   vorzuschreiben, weist die Selektion **beide Netto-Zahlen** aus:
   `net_per_fill_eur` (Vollkosten, Default 12 €/h) und
   `net_fuel_only_eur` (nur Sprit = was an der Zapfsäule bar übrig
   bleibt), plus den **Break-even-Stundenlohn**
   `break_even_wage_eur_h = (Ersparnis − K_sprit)/Umwegzeit`: liegt der
   eigene Zeitwert darunter, lohnt der Umweg (Rente, Sonntag, Schlange an
   der Stammstation), darüber nicht. Wer seine Zeit gar nicht bepreisen
   will, rechnet `--value-of-time 0` (beide Sichten fallen zusammen).
   Im `onroute`-Modus ist die Zeitfrage entschärft: es zählt nur der
   Mehrweg gegenüber der nächsten Station (300 m/2 min ≈ 0,08 €).

   **Rushhour (Staufaktor), kontextabhängig je Station:** OSRM liefert
   Freifluss-Zeiten ohne Live-Stau; im Berufsverkehr kann eine Strecke
   das 1,5- bis 2-fache dauern (10–15 min Freifluss → bis 30 min Stop&Go).
   Die Selektion bewertet die Zeit deshalb je nach *Fahrtkontext* der
   Station, nicht über einen einzigen Mischfaktor:
   - **nahe Stationen** (≤ `--near-km`, Default 5 km): tankt man auf dem
     Arbeitsweg → Fahrtzeit × `congestion_peak` (Default 1,45 ≈ 35 statt
     50 km/h; Worst Case 2,0 = Stop&Go).
   - **weitere Routen-Stationen** (Globus/Guericke …): fährt man gezielt
     zum Einkaufen an, zeitlich frei wählbar (Wochenende/Vormittag) →
     Fahrtzeit × `congestion_offpeak` (Default 1,0 = Freifluss). Ein
     Mischfaktor würde den Einkaufs-Fall zu pessimistisch rechnen.
   Die Nahbereichs-Grenze entspricht dem `--near-km` des Polling-Sets.
   `--congestion-peak 1` schaltet die Staukorrektur ganz ab (reiner
   Freifluss für alle).

   **Betriebsmodi** (`--trip-mode`, beide in der Pipeline implementiert):
   - `dedicated` (Extrafahrt von zuhause): Hin- und Rückweg samt Zeitkosten
     vollständig abziehen; ob es sich lohnt, entscheidet der echte Netto-Vorteil.
   - `onroute` (tanken ohnehin unterwegs; nur der Mehrweg gegenüber der
     nächstgelegenen Station zählt): der Alltagsfall; hier entscheiden
     δ̂ und Entfernung gemeinsam.
   Je Station P(Netto > 0) aus der Bootstrap-Verteilung + konservatives
   Flag „Netto-KI-Untergrenze > 0“.

   **Echte Straßen-km statt Luftlinie (`--router osrm`):** d und t
   kommen dann von einem **OSRM-Server** (Open Source Routing Machine,
   Datenbasis OpenStreetMap) — kostenlos, ohne API-Key. Eine Table-API-
   Anfrage je Stadt (Anker → alle Stationen), Ergebnisse landen im Cache
   `results/road_route_cache.json` (wiederholte Läufe offline); bei
   Serverausfall fällt die Pipeline automatisch auf Luftlinie × Circuity
   zurück. Default-Server ist der öffentliche Demo-Server
   (`router.project-osrm.org`, Fair Use — für den privaten Wochenlauf
   über ein paar hundert Stationen unkritisch); für Dauerbetrieb läuft
   OSRM mit einem Docker-Befehl lokal auf dem NAS (komplett offline).
   **Snapping-Falle:** liegt der Anker (oder eine Station) auf einer
   Autobahnrampe/-kante, schnappt OSRM darauf und die Route wird
   unsinnig lang (Straße/Luftlinie > ~2,3, oft in *beide* Richtungen,
   weil man erst falsch abbiegen muss). Die Pipeline warnt dann
   („Anker vermutlich auf Autobahnrampe geschnappt“); Abhilfe: den
   Anker in `analysis/config.local.json` auf die eigene **Hausstraße**
   setzen (Koordinate per Google Maps auf die Adresse, nicht aufs
   Autobahnkreuz). `road_route.py` gibt je Strecke einen Google-Routen-
   Link zum direkten Vergleich aus.
   Achtung: ein **Straßen-Routing kann keine zu große Entfernung
   reparieren** — Luftlinie ist immer kürzer als die Straße. Weicht die
   App-Entfernung stark von Google Maps ab (statt ~0,7–0,8× sogar größer),
   stimmen die Koordinaten nicht: Anker in `analysis/config.local.json`
   prüfen (eigener Standort, nicht Stadtmitte, lat/lon nicht vertauscht)
   bzw. den Stations-Pin über den Maps-Link im Polling-Report kontrollieren.

---

## 11. TankPuls-API

Auth: anonym (**60/min, 10 000/Tag**) oder Header `X-Api-Key`
(**300/min, 50 000/Tag**). JSON/UTF-8, Zeiten Europe/Berlin (Speicherung
UTC), `Cache-Control` an `/v1/health`. Zielimplementierung: API auf dem NAS.

### 11.1 Primär: `GET /v1/decide` — der eine Endpunkt fürs Frontend

Ein Aufruf pro Nutzerinteraktion; alles, was das UI braucht, in einer
Antwort.

Parameter:

| Parameter | Bedeutung |
|---|---|
| `lat`, `lon` | Standort (Pflicht im Zielbild; **offen**: die App arbeitet heute mit dem kuratierten Polling-Set, beide Parameter werden noch nicht ausgewertet — [LUECKEN](LUECKEN.md)) |
| `fuel` | `E10` (Default) · `E5` · `Diesel` |
| `liters` | Tankmenge, Default 40 |
| `consumption` | L/100 km, Default Profil |
| `latest_by` | ISO-Zeit; spätester akzeptabler Tankzeitpunkt (optional) |
| `value_of_time` | €/h; optional, sonst peak/offpeak-Profil (§10) |
| `home_lat/home_lon` | optional, für onroute vs. dedicated |

Antwort:

```json
{
  "primary": {
    "action": "wait" | "refuel_now" | "refuel_elsewhere" | "no_advice",
    "station": {"id": "...", "name": "...", "price_now": 1.689},
    "recommended_window": {"start": "...", "end": "...", "expected_price": 1.649},
    "expected_saving_eur": 1.60,
    "p_correct": 0.78,
    "confidence_badge": "high" | "medium" | "low",
    "reason_short": "Preis fällt heute Abend erfahrungsgemäß um 3–4 ct"
  },
  "alternatives_nearby": [ /* §4.2, Top 3 */ ],
  "windows_today":       [ /* §4.3, Top 3 innerhalb 24 h */ ],
  "windows_week":        [ /* §4.3, Top 3 innerhalb 7 d */ ],
  "episode": {
    "id": "...", "status": "open" | "waiting" | "due" | "resolved" | "expired",
    "intent": "none" | "wait" | "navigate" | "refuel_now"
  },
  "personal_stats": {
    "advice": {"last_30d_hits": 57, "last_30d_total": 64, "hit_rate": 0.89, "brier_30d": 0.14},
    "wallet": {"fills_30d": 7, "followed": 4, "saved_eur_30d": 12.40}
  },
  "debug": {"forecast_url": "/v1/stations/.../forecast", "fitted_at": "..."}
}
```

`p_correct` ist `null`, solange das Kalibrierungs-Gate (§0.4) nicht
erfüllt ist. `action: "no_advice"` entspricht §4.4.
`debug` verlinkt die Rohprognose für die 5 %.

*Vorlage im Repo:* `sample/good gui/src/app/v1/decision/route.ts` — der
Prototyp-Endpunkt `/v1/decision` (Station, Liter, Stunde, Zeitwert,
Verbrauch → Entscheidungsobjekt). Produktiv wird daraus `/v1/decide` mit
der §4-Logik inkl. P_besser und Outcome-Anbindung.

### 11.2 Folge, Intent, Fill — nicht „Outcome an Recommendation“

`POST /v1/recommendations/{id}/outcome` bleibt als Alias (schreibt ein
Fill gegen den letzten Snapshot), ist aber die falsche Granularität.
Primär sind drei Endpunkte, die die drei Uhren aus §5.4 abbilden:

**`POST /v1/episodes/{id}/intent`** — `{intent: wait|navigate|refuel_now|dismiss}`.
Kein Fill. Setzt Erinnerung/Due-Zustand.

**`POST /v1/fills`** — der Tankbeleg.

```json
{
  "id": "client-uuid",
  "episode_id": "...",
  "station_id": "...",
  "tanked_at": "2026-09-06T17:05:00+02:00",
  "liters": 42.5,
  "price_paid": 1.649,
  "fuel": "e10",
  "source": "explicit_now" | "prompt" | "manual"
}
```

`episode_id` optional: fehlt er, matcht der Server die offene Folge
(§5.4 Slack-Regeln). `price_paid` optional: fehlt er, setzt der Server
den Nowcast/Poll der Station zur `tanked_at`. Antwort enthält
`compliance` und `saved_vs_always_now_eur`. Idempotent über `id`.

**`GET /v1/episodes?status=due`** — was der Alltag beim Öffnen braucht,
inklusive vorbelegtem Prompt. `GET /v1/decide` liefert die aktuelle
Folge gleich mit (`episode` in der Antwort).

Advice-Settlement läuft **ohne** diese Endpunkte: Job nach `window_end`
+ Lag schreibt `outcome ∈ {win, loss, tie}`, `regret_eur` an den
Snapshot. Ein Fill ändert das Settlement nicht nachträglich — es ändert
nur das Wallet-Ledger.

### 11.3 Detail-Endpunkte (Werkstatt-Modus, Debug) — inkl. B3

Aktuell implementierte Nur-Lese-API der gemeinsamen GUI (Stand 09.09.2026, B3):
`GET /api/v1/health` (erweitert um selection + collector),
`GET /api/v1/stations?fuel=e10`,
`GET /api/v1/series?city=...&station_id=...&fuel=e10`,
`GET /api/v1/forecast?city=...&station_id=...&fuel=e10`,
`GET /api/v1/heatmap?city=...&fuel=...&kind=level|probability&weeks=6&station_id=...` (**B3.9**),
`GET /api/v1/selection?fuel=...&city=...` (**B3.10** Meine Stationen mit δ̂),
`GET /api/v1/collector/status` (**B3.11** Pi/tmpfs Livestatus),
`GET /api/v1/route/evaluate?city=...&station_id=...&ref_station_id=...&liters=40&detour_km=3&consumption=7&value_of_time=12&when=...&mode=onroute` (**B3.12** serverseitig, UI rechnet auch lokal),
`GET /api/v1/last_forecasts` (für RP2-Cache).

Noch geplant: `/v1/decide` primär (liefert episode), `/v1/episodes`, `POST /v1/fills`, `GET /v1/stats/summary` (drei Blöcke backtest/live_advice/wallet).

Produktiv im Werkstatt-Modus genutzt; alte Alltags-Routen werden als
deprecated markiert (Antwort-Header `Deprecation`/`Sunset`), sobald
`/v1/decide` alle Alltags-Fälle abdeckt:

- `GET /v1/stations` — Umkreis-Liste (`lat, lon, radius ≤ 25 km, fuel, sort`), inkl. `maps_url` — **implementiert als /api/v1/stations**
- `GET /v1/stations/{id}/forecast` — Rohprognose (`fuel, horizon 0|3|7`) + `{mase_24h, picp_7d, confidence_badge, fitted_at}` — **implementiert als /api/v1/forecast**
- `GET /v1/heatmap` — `kind=level|probability, weeks=6` → DoW × Stunde — **B3.9 implementiert, echte InfluxDB-Daten, Berlin-Zeit**
- `GET /v1/route/evaluate` — Umweg-Ökonomik-Einzelrechnung (`station_id, liters, detour_km, consumption, value_of_time, when` → `{delta_ct, gross_eur, detour_cost_eur, net_eur, worth_it, z_used}`) — **B3.12 implementiert, serverseitig, UI rechnet lokal optional**
- `GET /v1/health` — Collector-Stand, NAS-Erreichbarkeit, tmpfs-Füllstand & Oldest-Age, Coverage, letzte Fehler — **implementiert, erweitert um collector + selection**
- `GET /v1/selection` — Meine Stationen mit δ̂, Bootstrap-KI, AV-Score, billigste Stunde — **B3.10 implementiert, Artefakt runtime/selection/current.json**
- `GET /v1/collector/status` — Pi/tmpfs Livestatus (Collector-Herzschlag) — **B3.11 implementiert**
- Neu (Werkstatt): `GET /v1/stats/summary` — drei Blöcke `backtest` / `live_advice` / `wallet` (§5.5, §8.2) — **noch offen**

Details und Beispiele: [API.md](API.md)

---

## 12. Noch nicht gestellte, aber wichtige Fragen (Lücken-Checkliste)

**P0** = vor/direkt nach M1, **P1** = vor Rollout, **P2** = später.

### Daten & Markt

| P | Frage | Abdeckung |
|---|---|---|
| **P0** | Historische Daten der 3 Städte: Quelle, Zeitraum, Auflösung? | CSV-Schema ([Werkzeugreferenz](DATENWERKZEUGE.md#datenformate)), Coverage-Gate ≥ 85 %; bei Grob-Auflösung schwächere Fits (im Report sichtbar) |
| **P0** | Sind die Historie-Stationen real erreichbar? (Frankfurt: 100+ im 25-km-Radius) | Referenzpunkt je Stadt aus gitignorierter `config.local.json`, `onroute`-Modus, `--rank-by score`, `--max-radius` |
| **P0** | E10-Verträglichkeit des Autos? | K.-o.-Kriterium; sonst `--fuel E5` (Äquivalenzpreis, §10) |
| **P1** | Rabatt-/Kartenprogramme (2–4 ct können das Ranking umdrehen)? | geplant: `--brand-rebate "ARAL:0.02;…"`; bis dahin Top-10 der eigenen Karten-Marke gesondert betrachten |
| **P1** | Wann tanke ich wirklich? (Pendlerprofil/Schicht/Homeoffice) | w(h)-Profil als Config; Fill-Log (§5.4) kalibriert das Profil, sobald ≥ 8 Füllungen da sind |
| **P1** | Lebenszyklus der Stationen (Umbau, Betreiberwechsel) | vierteljährliche Re-Selektion + **CUSUM-Driftschranke** (7-Tage-δ̂, Alarm bei \|CUSUM\| > 3σ über 14 d) + `no prices`-Alarm nach 7 Tagen |

### Mathematik

| P | Frage | Abdeckung |
|---|---|---|
| **P0** | Selektionsbias („Winner's Curse“) | Split-Half-Spearman-ρ im Report + Out-of-Sample-Re-Check nach 4 Wochen Live-Betrieb |
| **P1** | Stadtmedian vs. lokale Konkurrenz (3–5-km-Ring)? | Backlog: LOO-Median über k-nächste Nachbarn; heute pro Stadtteil getrennte `city`-Werte |
| **P1** | Feiertage bundeslandspezifisch (HE/BY/NW) | `holidays` + `--subdiv` (Selektion implementiert); gepoolter Bundesland-Dummy in der Engine (§3.2) |
| **P2** | Interaktionen (Preisführerschaft, Edgeworth-Zyklen) | Backlog: Cross-Correlation/Granger-Screening; M2-AR fängt das Gröbste |

### Technik & Betrieb

| P | Frage | Abdeckung |
|---|---|---|
| **P0** | Zeitzone/Sommerzeit + Pi ohne RTC | UTC speichern, Berlin nur im Frontend; NTP-Wait im Unit |
| **P1** | Monitoring von Pi **und** NAS | `/v1/health` + externer Watchdog (Uptime-Kuma auf dem NAS), optional ntfy/Telegram-Push |
| **P1** | Stromausfall/Boot-Reihenfolge | Units `WantedBy=multi-user.target`, tmpfs neu gemountet, Backfill ab NAS |
| **P2** | NAS nur bei Bedarf an | 7-Tage-FIFO, WOL, Sync-Intervall in Config |

### Recht, Kosten & Produkt

| P | Frage | Abdeckung |
|---|---|---|
| **P1** | CC BY 4.0 sichtbar? | Fußzeile + Lizenz-Feld in API-Responses |
| **P1** | Öffentliche API exponieren? | Rate-Limits + Key für Externe, nur lesend, TLS (Caddy), Fail2ban |
| **P2** | Push („Jetzt 4 ct unter Tagesmedian“)? | Backlog: ntfy/Telegram; Trigger aus Decision-Layer-Schwellen |
| **P2** | Eigene Tankbelege → echte €-Bilanz | Kern: `POST /v1/fills` + Episode-Matching (§5.4/§11.2); Wallet-Ledger im Alltag, Jahresbilanz in der Werkstatt |

---

## 13. Roadmap

**Arbeitsstand 07.09.2026:** InfluxDB wird laut Betreiber befüllt, M2 wird
auf dessen Rückmeldung vorläufig als erledigter Arbeitsschritt behandelt.
Die privaten Berichte/Quoten/Signifikanzen und der 14-Tage-M1-Nachweis sind
hier nicht unabhängig geprüft. **Als Nächstes Gütersloh mitpolling aufnehmen
und die Live-GUI anbinden; das NAS-Archiv parallel starten.** Die Reihenfolge
steht in INSTALL.md, die M-Nummern unten sind Paketnamen, keine Warteketten.
M3 bleibt unkalibriert; die erste nutzbare Live-Preisansicht wartet nicht darauf.
Die M4-Homepage basiert ausdrücklich auf **beiden vorhandenen GUIs**.

| Meilenstein | Inhalt | Fertig-Kriterium |
|---|---|---|
| M1 | Collector + tmpfs-Ringpuffer + NAS-Uploader laufen 14 d | Datenlücken < 2 %, Ack-Protokoll fehlerfrei |
| M2 | Selektion mit echten Historien der 3 Kampagnen (HE/BY/NW; Anker + Subdivs aus lokaler Config, nie im Repo) | Top-10 quotiert (6/2/2), q < 0.05, Report archiviert |
| M3 | Engine M1–M3 + ACI + Backtest (Fits und Inference auf NAS) | MASE(24 h) < 0,95 gesamt und < 0,80 sprungfrei; Pinball (τ=0,5 und asym τ=0,75) < Naive; PICP(95 %) ∈ [90, 98] % |
| **M4** | **PWA mit Decision-Layer-UI: Alltags-Modus (Startkarte + 3 aufklappbare Zeilen) + Werkstatt-Modus; Fan/Heatmaps nur noch in der Werkstatt; Service-Worker-Cache** | **Startbildschirm hat ≤ 3 primäre Zahlen**; Lighthouse > 90; installierbar; letzte `/v1/decide`-Antwort offline abrufbar |
| **M5** | **TankPuls: `/v1/decide` primär (liefert `episode`); `/v1/episodes/{id}/intent`, `POST /v1/fills`, Due-Prompt; automatisches Snapshot-Settlement nach Fensterende; alte `/outcome`-Route als Alias; deprecated-Header; Rate-Limits/Keys** | OpenAPI (noch offen — bis dahin ist [API.md](API.md) die verbindliche Endpunkt-Beschreibung) + Tests grün; Snapshots kollabiert (nicht 1:1 HTTP); jede Folge hat Auto-Settlement unabhängig vom Fill; Wallet-€ nur aus Fills |
| M6 *(optional)* | Quantile-Boosting M4-Q auf 3–5 Top-Stationen (wöchentliches Refit, 3 Quantile, NAS) | nur wenn 21-Tage-Backtest ≥ 0,3 ct Verbesserung; sonst verworfen |
| **M7** | **Kalibrierungs-Loop nach 4 Wochen Live-Betrieb: Brier-Score + Reliability-Diagramm messen (Werkstatt/Debug), Entscheidungsschwellen §4.1/§4.2 an Trefferquoten anziehen, Kalibrierungs-Gate (§0.4) schalten** | Brier < 0,25 bei ≥ 100 Empfehlungen → P_besser-Anzeige freigeschaltet; Produkt-KPIs (§6) im Ziel oder Schwellen-Nachzug terminiert. **Erst nach M7 gilt das Produkt als „fertig kalibriert“.** |

---

## 14. Ehrliche Grenzen

1. **P_besser ohne Kalibrierung ist Snakeoil.** Eine „82 %“-Anzeige ist
   ohne Erfolgsbilanz nicht besser als Wahrsagerei. Deshalb ist M7 kein
   Feinschliff, sondern Kernbestandteil, und §0.4 ein hartes Gate:
   Prozent erst nach Brier-Nachweis, vorher binäre Empfehlung.
2. **Es gibt Situationen, in denen die App ehrlich nichts sagen kann.**
   Zu breite Verteilung, unruhiger Markt, P_besser nahe 50 % → „Keine klare
   Empfehlung“ + reine Preisinformation (§4.4). Das ist die Alternative zu
   falscher Präzision.
3. **Preissprünge bleiben Betreiberentscheidungen.** Die Engine kann
   Sprünge nicht punktvorhersagen — die Aussageform „Fenster +
   Wahrscheinlichkeit + €-Erwartung“ ist die mathematisch korrekte, und
   der Regret-Tracking (§5.2) zeigt monatlich ehrlich, was drin ist.
4. **Die Entscheidungsschwellen sind Startwerte, keine Naturkonstanten.**
   Sie werden in M7 an die gemessenen Trefferquoten angepasst; wer die App
   danach nicht mehr anfasst, lässt das Werkstatt-Scoreboard merken.

---

## UI-Anhang: Die zwei GUI-Vorlagen als Homepage-Basis

Der Anwender hat den Decision-Layer-Ansatz an **zwei Next.js-Prototypen**
ausgeprobiert (`sample/`). **Beide bleiben als gestalterische und technische
Basis im Repo**; dieses Konzept macht aus ihnen die zwei Modi einer App.
Slate-/Emerald-/Sky-Design, Karten, Tabellen und Regler übernehmen, nicht
neu erfinden. [Konkrete visuelle Leitplanken](GUI-VORLAGEN.md).

### UI.1 `sample/good gui` → Modus „Alltag“

Beigesteuert zum Produkt:

- **Entscheidungs-Kompass** als Hero-Karte: Ampel-Verdict
  (`NOW`/`WAIT`/`SWITCH_STATION`), Badge-Texte („JETZT TANKEN“ /
  „WARTEN BIS ~18:30 UHR“ / „FAHRE ZU SHELL (+1,20 € NETTO)“), 2–3
  Begründungszeilen, Ersparnis in € + ct/L, Maps-Navigations-Button.
- **Drei-Optionen-Vergleich** (Jetzt / Warten / Andere Station) mit
  Netto-€ je Option inkl. Umwegkosten-Abzug.
- **Tagesstreifen 06–24** als klickbare Stundenzellen (Statusfarben,
  „Jetzt“-Marker) → „Heute später“-Aufklapper.
- **What-If-Slider:** Tankmenge 20–80 L, Uhrzeit-Simulation,
  Zeitwert z (0 = Auto: 16 €/h peak, 10 €/h offpeak).
- **Kampagnen-/Kraftstoff-Umschalter**, E5-Äquivalenz-Banner,
  Offline-Banner + Service Worker, „Stand: HH:MM“.
- API-Vorläufer `/v1/decision` (→ wird `/v1/decide`, §11.1).
- Güte-Kacheln (Top-3-Quote, PICP, MASE sprungfrei, CUSUM) — bleiben im
  Produkt **in der Werkstatt**, nicht im Alltags-Startbildschirm.
- **Asynchrones Feedback (§5.4):** Episode statt Decide-Call
  (`lib/feedback.ts`), CTAs „Ich tanke jetzt“ / „Ich warte“, Due-Prompt
  nach Fensterende, zwei getrennte Ledger. Der Uhrzeit-Slider simuliert
  die asynchrone Lücke.

Was der Prototyp noch nicht hat (Produkt-Lücke): P_besser als kalibrierte
Prozentzahl (zeigt stattdessen feste Schwellen), „Keine klare
Empfehlung“-Modus, Server-persistierte Episodes (Demo: localStorage),
deprecated-Headers.

### UI.2 `sample/good statistic gui` → Modus „Werkstatt“

Beigesteuert zum Produkt:

- **Entscheidungs-Regel als erstklassiges Objekt:** μ = E[Ersparnis]
  gegen Schwelle ε, entschieden wird über den Erwartungswert, P(S>0)
  wird separat ausgewiesen — exakt die Philosophie von §0.2/§4.
- **Scoreboard out-of-sample** (14 Tage Prüfstand, Tag für Tag): P
  behauptet vs. real, Warten/Jetzt-Trefferquoten, Ø Regret (ct/L und
  €/Füllung), Regel-€ vs. Orakel-€ → §5.2/§8.2.
- **Kalibrierungs-Plot** (behauptet P vs. real, Werktag/WE-Klassen,
  Abweichung in pp) → §5.1-Reliability-Diagramm.
- **Stations-Labor:** Tagesprotokoll, Verlauf mit Entscheidungs-/Fenster-
  Markern, Histogramm der Trainings-Ersparnisse mit μ/ε-Markern,
  **ε-Scan** (Regel-€ als Funktion der Schwelle).
- **Paarvergleich** mit Umweg-Slidern und `pairEval`
  (brutto − K(d) = netto, `worthIt` gegen Δp\*, out-of-sample-Nette je Tag)
  → F2-Werkzeug (§8.2 Nr. 5).
- **Methodik-Ehrlichkeit** im Footer (synthetische Demo-Daten,
  out-of-sample, kleine Stichproben) → Ton für die Werkstatt.

Was der Prototyp noch nicht hat: Multi-Kampagnen-Alltag (eine Station,
Navigation), F3-Fenster über Tage (nur 08:00-Entscheidung), PWA/Offline,
Anbindung an echte Historie.

### UI.3 Verschmelzungs-Regeln

1. Beide Prototypen teilen sich **eine** Datenbasis und **eine**
   Entscheidungslogik (§4); sie unterscheiden sich nur in der
   Übersetzung (Alltag = Ampel, Werkstatt = Verteilung).
2. Alle vier v4-Dashboard-Kacheln (Fan, 2 Heatmaps, Top-10) leben
   ausschließlich in der Werkstatt.
3. „Meine Stationen“ ersetzt das δ̂-Ranking; δ̂ ist Werkstatt-Detail.
4. Jede Prozentzahl in beiden Modi folgt dem Kalibrierungs-Gate (§0.4) —
   auch die Werkstatt zeigt P-Werte nach M7 mit Brier-Kontext.
