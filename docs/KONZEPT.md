# TankApp — Gesamtkonzept (v5)

> Stand: 2026-09-06 · **v5 ist das eine Konzeptdokument.** Es vereinigt
>
> 1. das technische Konzept v4 (Engine, Selektion, Architektur, API),
> 2. die Auswertung der externen Bewertung v3 → v4 (früher
>    `REVIEW-2026-09-06.md`, jetzt Anhang A),
> 3. den Umbau von der **Prognose-App zur Entscheidungs-App** (Decision
>    Layer, §4–§6),
> 4. die Erkenntnisse aus den **zwei Sample-GUIs** (`sample/good gui` =
>    Alltags-Modus, `sample/good statistic gui` = Werkstatt-Modus, §8 und
>    Anhang B).
>
> Frühere Dokumente sind damit obsolet; dieses hier ist die einzige
> verbindliche Referenz.

**Das Produktprinzip in einem Satz:** Aus den Prognose-Quantilen q̂.05…q̂.95
der Engine wird eine **Entscheidung mit Kalibrierungsangabe** gemacht —
„Jetzt tanken / Warte bis 18–20 Uhr (+4 ct ≈ 1,60 €) / Fahre zu Shell
(+1,20 € netto) — 82 % sicher“. Fan-Charts, Heatmaps und Konfidenzbänder
sind nicht weg, aber sie sind **Begründung auf Nachfrage** (Modus
„Werkstatt“), nie die primäre Antwort.

```
 Tankerkönig        Pi (Collector)      NAS (Daten + Fits)            Handy (PWA)
 ┌───────────┐ 1R/5m ┌─────────────┐ LP  ┌────────────────────┐        ┌──────────────────┐
 │ prices.php│──────►│ tmpfs-Ring  │────►│ InfluxDB-Historie  │        │  MODUS ALLTAG:   │
 └───────────┘       │ └ Uploader  │     │ Engine-Fits/Backt. │        │  1 Karte, 3 Zahlen│
                     ├─────────────┤     ├────────────────────┤  JSON  ├──────────────────┤
                     │ FastAPI     │◄────│ DECISION LAYER     │───────►│  MODUS WERKSTATT:│
                     │ „TankPuls“  │     │ (Quantile → Ampel) │/v1/    │  Labor + Details  │
                     └─────────────┘     └────────────────────┘ decide └──────────────────┘
```

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
3. **Die App kennt ihr eigenes Können.** Jede Empfehlung wird geloggt und
   24 h später automatisch mit der Realität abgeglichen (§5.2) — die
   persönliche Erfolgsbilanz ist die ehrlichste Marketing-Abteilung der App
   gegen sich selbst.

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

Pipeline: `analysis/station_selection.py` · Demo-Bericht:
`docs/analysis/report_top10.md` · Schema: `analysis/README.md`.

| # | Komponente | Verfahren | Funktion im Score |
|---|---|---|---|
| 1 | **Relative Preislage δ̂ᵢ** | Medianᵢ(t) von pᵢ(t) − Medianⱼ≠ᵢ pⱼ(t) (Leave-One-Out-Baseline) | Gewicht 0.40 |
| 2 | **Inferenz** | Tages-Block-Bootstrap (B = 2000) → 95 %-KI; p-Wert H₀: δᵢ ≥ 0; **Benjamini-Hochberg-FDR** (q < 0.05) | Signifikanz-Gate |
| 3 | **Verfügbarkeit AVᵢ** | Σₕ wₕ·P(Station ∈ Top-3 · Stunde h); w = Tankzeitprofil (werktags 06–09/16–20 h) | Gewicht 0.25 |
| 4 | **Tagesform** | robuste harmonische Regression (Huber-IRLS, 1.+2. Harmonische) → Amplitude, billigste Stunde, R² | Gewicht 0.15 |
| 5 | **Risiko** | σᵢ = 1.4826·MAD(Δᵢ); Streuung der Tages-Mittelränge | Gewicht 0.10 + 0.10 |
| 6 | **Datenqualität** | Coverage-Gate ≥ 85 % je Station | Ausschluss |

Demo-Ergebnis (54 Stationen, 8 Wochen, 5-Min-Raster): Top-10 mit δ̂ zwischen
−2,85 und −4,40 ct/L, alle q < 0,005, Ersparnis ≈ 71–110 €/Jahr bei 40 L ·
1,2 Füllungen/Woche.

**Kampagnen-Setup:** drei Kampagnen in **Hessen, Bayern, NRW**; Heimat =
**Frankfurt am Main**. Frankfurt hat im 25-km-Radius 100+ Stationen → die
globale Top-10 wird **quotiert** (Empfehlung **6/2/2**, konfigurierbar),
sonst dominieren Heimatstadt-Stationen das Ranking und die 10 live
gepollten IDs decken die Reiseorte nicht (Anhang A, N3).
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

### 3.0 Direkte Antworten

- **„Ist einfache Statistik ausreichend?“** Nein. Starke Tageszyklen
  (Morgensprung, Abendtief), Wochenmuster, diskontinuierliche
  Betreibersprünge, heteroskedastisches Rauschen → Strukturmodell +
  Residuen-Dynamik + Ensemble + kalibrierte Intervalle.
- **„Gute Konfidenz über die gesamte Zeitreihe?“** Ja: verteilungsfreie
  Kalibrierung (ACI) + laufend gemessene Überdeckung (Rolling-PICP).
  Tages-Saison (Periode 288) ab ~8 Wochen stabil identifiziert;
  Wochen-Saison (2016) erst ab ~1 Jahr (bis dahin DoW-Dummies, Anhang A N1).

### 3.1 Aufbereitung & Öffnungszeiten-Bewusstsein

1. 5-Min-Raster je (Station, fuel); Lücken → Forward-Fill ≤ 30 min, sonst
   NaN + Staleness-Maske.
2. `closed`-Spannen: Preis = letzter Open-Preis, Flag `open=0`; diese
   Segmente fließen **nicht** in die Zyklus-Modellierung (eingefrorene
   Preise sind keine Marktsignale).
3. Hampel-Filter (Fenster 1 h, Median ± 5·MAD) gegen API-Artefakte.
4. Tagesblöcke als Bootstrap-/Backtest-Einheit.

### 3.2 Modell-Stack (pro Station × Sorte; Demo-R² 0,94 im Median)

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

**Abnahme-Kriterien Engine (F2 des Reviews):**

1. MASE(24 h) < **0,95** gesamt (inkl. Sprungtage),
2. MASE(24 h) < **0,80** an **sprungfreien** Tagen (Sprungtage via CUSUM
   auf Δp markiert),
3. **Pinball-Loss** (τ = 0,5, 24 h) < Pinball der Naive,
4. Rolling-PICP(95 %) ∈ [90, 98] %.

### 3.3 Konfidenz: Intervalle mit verteilungsfreier Garantie

1. Residuen-Block-Bootstrap (Block = Resttag, B = 500) → Quantile
   q̂.05…q̂.95 → 80 %/95 %-Bänder.
2. **Adaptive Conformal Inference:** Nonkonformitäts-Scores
   s(t) = max(q̂_lo − y, y − q̂_hi) über 14 Tage;
   α_t = α_{t−1} − η·(Überdeckung − Ziel), **η = 0,005** Startwert
   (stark autokorrelierte 5-min-Scores → kleine effektive Stichprobe),
   im Dashboard konfigurierbar. **ACI erst nach 4 Wochen Live-Betrieb**,
   vorher feste Bootstrap-Intervalle. Die ACI-Garantie ist asymptotisch und
   unter Austauschbarkeit; die operationelle Wahrheit bleibt das gemessene
   Rolling-PICP.
3. **Monitoring:** 7-Tage-Rolling-PICP je Station als Konfidenz-Badge
   (grün ≥ Nominal − 2 pp, gelb ± 5 pp, rot → §4.4-Modus).

### 3.4 Horizonte & ehrlich bezifferte Genauigkeit

| Horizont | Inhalt | erwartbarer MAE* | 95 %-KI |
|---|---|---|---|
| **Heute 0–24 h** | Nowcast: Position im Tageszyklus + Sprung-Status | 0,8–1,5 ct punktuell; ≈ 0,5 ct im Tagesmittel | ± 2–3 ct |
| **+3 Tage** | Saison + Trend, Sprung-Wahrscheinlichkeit | 1,5–2,5 ct | ± 3–5 ct |
| **+7 Tage** | Wochenmuster/Tagesform; Trend nur gedämpft | 2–4 ct | ± 4–7 ct |

\* Nachgewiesen per Rolling-Origin-Backtest (Cutoff täglich 00:00, Training
42 Tage): MAE, RMSE, MASE, sMAPE, PICP, MPIW, Pinball, CRPS.

**Grenze (bewusst):** Preissprünge sind Betreiber-Entscheidungen — nicht
punktvorhersagbar. Die Engine sagt *Fenster + Verteilung*, der Decision
Layer (§4) macht daraus die Aussageform, die man handeln kann.

---

## 4. Decision Layer (Kernstück — neu in v5)

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

**Datenerfassung — minimal und ohne Nutzer-Input:**

- Log je Empfehlung: `recommendation_id, station_id, action, p_besser,
  expected_saving_eur, emitted_at, window_start, window_end`.
- Sobald der Ist-Preis für das empfohlene Fenster bekannt ist (automatisch
  aus der eigenen Preishistorie, 24 h später), wird
  `outcome ∈ {win, loss, tie}` ergänzt; dazu `regret_eur` (Orakel minus
  realisiert — Definition wie im Statistik-Prototyp).
- Optional: „Hast du getankt?“-Button für exakte €-Bilanz
  (`POST /v1/recommendations/{id}/outcome`, §11.2).
- Die Werkstatt aggregiert das zum **Scoreboard** (je Station: P behauptet
  vs. real, Trefferquoten je Aktionsart, Ø Regret in ct/L und €/Füllung,
  Regel-€ vs. Orakel-€ — exakt die Tabelle des Statistik-Prototyps).

Ist die Bilanz negativ, weiß es der Nutzer sofort — die App kann sich nicht
selbst schönlügen.

### 5.3 Was mit den Bändern passiert

Die 80/95 %-Bänder verschwinden nicht — sie sind die mathematische Basis
für P_besser und €_netto. Aber: **UI zweiter Ordnung.** Versteckt unter
„Details“/„Warum?“ (Werkstatt-Modus) oder als kleine Sparkline neben der
Empfehlung. Wer wissen will „wie sicher genau?“, tippt drauf. Alle anderen
sehen die Ampel.

---

## 6. Abnahme-Kriterien: Produkt-KPIs (neben den Engine-Kriterien §3.2)

| KPI | Definition | Zielwert | Warum |
|---|---|---|---|
| **Brier-Score P_besser** | §5.1 | < 0,20 | Kalibrierung der Kernaussage |
| **Trefferquote WARTEN** | Anteil richtiger „warten“-Empfehlungen | > 70 % | Nutzer verzeiht keine falschen Wartevorschläge |
| **Trefferquote JETZT** | Anteil richtiger „jetzt“-Empfehlungen | > 85 % | Fehlalarm nach oben ist teurer (doppelter Schaden, §4.5) |
| **Ø realisierte Ersparnis/Empfehlung** | € gespart bei befolgten Empfehlungen | > 1,00 € | unter 1 € ist die App die Aufmerksamkeit nicht wert |
| **Top-3-Fenster-Trefferquote** | tatsächliches Tagesminimum in einem der 3 empfohlenen Fenster | > 60 % | war schon in v4 Produkt-Kennzahl, bleibt gültig |
| **Regret-Ratio** | realisierte Ersparnis / Oracle-Ersparnis | > 0,55 | wie viel des theoretisch Möglichen hebt die App (Kennzahl aus dem Statistik-Prototyp: „geholtes Potenzial“) |

Die Kalibrierung ist tunbar: nach 4 Wochen Live-Betrieb tatsächliche
Trefferquoten messen (M7) und Schwellen nachziehen, bis die Zielwerte
stehen.

---

## 7. Polling-Fenster: 06:00–24:00 (fix)

Empirisch beantwortet (`analysis/window_analysis.py`, Bericht
`docs/analysis/report_window.md`):

| Kennzahl | Fenster 08–24 | Fenster 06–24 |
|---|---:|---:|
| Tage mit Preis-Minimum im Fenster | 98,1 % | 98,1 % |
| Median \|δ̂-Bias\| | 0,30 ct/L | 0,20 ct/L |
| 95 %-Quantil \|δ̂-Bias\| | 0,84 ct/L | 0,68 ct/L |
| Median Fehler „billigste Stunde“ | 0,5 h | 0,5 h |
| 95 %-Quantil Fehler | 8,7 h ⚠ | 8,5 h ⚠ |

- **Selektion** reicht mit 08–24; **Engine** braucht den Morgensprung
  (≈ 05:30–07:30) → **fix 06:00–24:00** (216 R/Tag, unter dem Limit),
  **ohne adaptive Per-Station-Logik** (Review F3: Komplexität ohne
  messbaren Nutzen).
- 00–24 (288 R/Tag) = exakt die Empfehlungsgrenze ohne Retry-Puffer; 25 %
  der Extra-Polls liefern bei geschlossenen Stationen keine Information.
  Wer Volltag will: `POLL_START=00`, Collector identisch.
- **24h-Stationen als Opt-in:** Liste `NIGHT_IDS` (Default leer); bei
  ≥ 7 Tagen überwiegend offen **und** ≥ 10 % der Tagesminima vor 08:00
  wird nur für diese IDs bis 00:00 gepollt — einfache Regel, keine
  Scheduler-Maschinerie.
- Die p95-Fehler bei „billigste Stunde“ betreffen fast nur
  24h-Discounter-Ausfallstraßen-Typen; für die F1/F3-Fenster nach 06:00
  ohne Bedeutung.

---

## 8. UI: zwei Moden, ein Startbildschirm mit ≤ 3 primären Zahlen

### 8.1 Modus „Alltag“ (Default) — der Entscheidungs-Kompass

Startbildschirm = **eine Karte, drei Zeilen**:

```
┌─────────────────────────────────────┐
│  🟢 JETZT TANKEN                     │
│  Aral Hauptstr. · 1,649 € · 400 m   │
│  Warten würde <1 € bringen           │
│  [Navigation starten]                │
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
**Google-Maps-Button** (Deep-Link ohne API-Key,
`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`). Die
drei Optionen **Jetzt / Warten / Andere Station** stehen zusätzlich als
vergleichs-Kacheln mit ihrem Netto-€-Ergebnis — die einzige „Vergleichstabelle“,
die an der Säule noch funktioniert.

**Kontext-Kontrolle** (aus dem Prototyp übernommen): Kampagnen-Umschalter
(Frankfurt HE · München BY · Köln NW), Kraftstoff-Umschalter (E10 · E5 ·
Diesel) mit E5-Äquivalenz-Hinweis (§10), „Stand: HH:MM“-Zeitstempel,
What-If-Slider (Tankmenge 20–80 L, Zeitwert z inkl. Auto-Modus 16/10 €/h
peak/offpeak) unter „Parameter“.

**PWA/Offline (Review O5):** Service Worker mit Cache-First für die letzte
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
2. **Scoreboard (out-of-sample):** je Station — P behauptet vs. S>0 real,
   Anzahl+Trefferquote „Warten“/„Jetzt“, Ø Regret (ct/L und €/Füllung),
   Regel-€ vs. Orakel-€, δ̂-Balken. Das ist §5.2 in Aggregatform.
3. **Kalibrierung:** Reliability-Diagramm (§5.1) + mittlere
   Kalibrier-Abweichung in pp + Brier-Score 30 d. Nach M7 auch das
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
   günstiger als Umgebung“), mit Bootstrap-KI-Whiskern.
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

---

## 9. Systemarchitektur: Pi ↔ NAS

### 9.1 Rollen & Datenfluss

| Aufgabe | Gerät | Begründung |
|---|---|---|
| Collector (Poll alle 5 min, 06–24) | **Pi** | 24/7-Bereitschaft |
| Kurzzeit-Puffer | **Pi: tmpfs** `/dev/shm/tankapp` | RAM statt SD → SD-Schonung |
| Langzeit-Speicher | **NAS: InfluxDB (Docker)** | Plattenplatz, Retention |
| Hosting TankPuls-API + PWA | **Pi** | autark auch bei NAS-Ausfall |
| Historie für Engine | NAS primär; Pi hält Cache-Aggregate (Parquet) | degradierter Modus ohne NAS |
| **Engine-Fits, Rolling-Backtests, ACI-Kalibrierung, Decision-Layer-Kalibrierung (M7)** | **NAS (oder PC per WOL)** | Pi macht **nur Inference** (lädt joblib/Parquet-Artefakte); der tägliche Backtest (bis 42 Refits × 10–30 Modelle) gehört auf 16 GB/x86, nicht auf 1 GB ARM (Anhang A, O1/N2) |
| **Empfehlungs-/Outcome-Log (§5.2)** | NAS (Tabelle/Measurement) | Quelle für Bilanz, Brier, M7 |

Ablauf: Collector appended JSON-Zeilen an
`/dev/shm/tankapp/YYYY-MM-DD.jsonl`; Ringpuffer 7 Tage; Uploader pingt
TCP 8086 alle 60 s, Batch-Transfer unbestätigter Zeilen, Ack via
`meta.synced_until`, **idempotent** (§1.2). NAS-Ausfall: 7 Tage Puffertiefe
(Urlaubssicher), bei Überlauf FIFO + Alarm.

### 9.2 Ressourcen-Rechnung (Pi: 921 Mi total / 571 Mi verfügbar)

| Posten | Bedarf |
|---|---|
| Collector + Uploader | ~40–60 MiB RSS |
| FastAPI/uvicorn + statisches Frontend | ~60–80 MiB |
| tmpfs-Ringpuffer (Limit 32 M) | ≤ 32 MiB |
| **Summe** | **< 180 MiB → ~390 MiB Reserve** |

Datenvolumen: JSONL ≈ 2,5 kB/Poll → 216 Polls ≈ 0,6 MB/Tag. InfluxDB:
6 480 Punkte/Tag max (10 Stationen × 3 Sorten × 216 Polls; realistisch
4 320–6 480, weil E5 oft nicht geführt wird) à ~20–60 B TSM →
~0,26–0,4 MB/Tag ≈ 95–150 MB/Jahr. **Urteil: komfortabel ausreichend.**

### 9.3 SD-Härtung & Betrieb

```ini
# /etc/fstab
tmpfs  /dev/shm/tankapp  tmpfs  defaults,noatime,size=32M,mode=0755  0  0
# /etc/sysctl.d/99-tankapp.conf
vm.swappiness=10
vm.vfs_cache_pressure=50
```

- `log2ram`/journald-Limits, `noatime` auf `/`; systemd-Units (collector,
  uploader, api) mit `WatchdogSec=30`, `Restart=always`; **NTP Pflicht**
  (`After=time-sync.target`, UTC speichern, Berlin nur im Frontend).
- NAS: `influxdb:2` + Volume, Retention 5 Jahre, wöchentliches Backup;
  Pi hostet uvicorn auf 0.0.0.0, CORS eng, TLS via Caddy.
- Keys nur in `/etc/tankapp/env` (chmod 600), nie im Repo.

### 9.4 Hardware-Bewertung

| Kandidat | Eignung | Urteil |
|---|---|---|
| **NAS: Pentium Silver J5040, 16 GB** | InfluxDB-Ingest bei 6 480 Punkten/Tag ≈ Last 0; RAM 1–2 GB; Docker-fähig; **alle Fits/Backtests/Kalibrierungen** | ✅ **Empfehlung** |
| PC: Ryzen 7 5700X, 32 GB, RX 9070 XT | fachlich ok, ~20× überdimensioniert; Idle ~50–90 W vs. NAS 10–15 W → 85–150 €/Jahr vs. 30–40 € Strom | ❌ im Dauerbetrieb; optional für Einmal-Analysen (WOL) |

---

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

   **Zeitwert zeitabhängig (Review O7):** z-Profil mit
   `value_of_time_peak` (16 €/h, 17–20 Uhr) und `value_of_time_offpeak`
   (10 €/h) plus Slider („Wie viel ist dir 10 min Umweg wert?“); die
   Formel bleibt gleich, `/v1/decide` rechnet mit `when` und liefert
   `z_used` zurück. Die **Selektion** rechnet konservativ mit dem
   Durchschnitt.

   **Betriebsmodi** (`--trip-mode`, beide in der Pipeline implementiert):
   - `dedicated` (Extrafahrt von zuhause): fast nie lohnend — im Demo-Lauf
     bei 12 €/h keine Station netto positiv. Ehrliches Ergebnis.
   - `onroute` (tanken ohnehin unterwegs; nur der Mehrweg gegenüber der
     nächstgelegenen Station zählt): der Alltagsfall; hier entscheiden
     δ̂ und Entfernung gemeinsam.
   Je Station P(Netto > 0) aus der Bootstrap-Verteilung + konservatives
   Flag „Netto-KI-Untergrenze > 0“.

---

## 11. TankPuls-API

Auth: anonym (**60/min, 10 000/Tag**) oder Header `X-Api-Key`
(**300/min, 50 000/Tag**). JSON/UTF-8, Zeiten Europe/Berlin (Speicherung
UTC), `Cache-Control` an `/v1/health`. Implementierung: FastAPI auf dem Pi.

### 11.1 Primär: `GET /v1/decide` — der eine Endpunkt fürs Frontend

Ein Aufruf pro Nutzerinteraktion; alles, was das UI braucht, in einer
Antwort.

Parameter:

| Parameter | Bedeutung |
|---|---|
| `lat`, `lon` | Standort (Pflicht) |
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
  "personal_stats": {
    "last_30d_hits": 57, "last_30d_total": 64, "hit_rate": 0.89,
    "saved_eur_30d": 42.50, "brier_30d": 0.14
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

### 11.2 Neu: `POST /v1/recommendations/{id}/outcome`

Optional vom Nutzer („habe getankt bei X um Y für Z €“). Ohne Nutzer-Input
wird das Outcome 24 h später automatisch aus der Preishistorie befüllt
(§5.2): `outcome ∈ {win, loss, tie}`, `regret_eur`, `realized_saving_eur`.

### 11.3 Detail-Endpunkte (Werkstatt-Modus, Debug)

Bleiben bestehen, im Frontend nur noch im Werkstatt-Modus genutzt; als
deprecated markiert (Antwort-Header `Deprecation`/`Sunset`), sobald
`/v1/decide` alle Alltags-Fälle abdeckt:

- `GET /v1/stations` — Umkreis-Liste
  (`lat, lon, radius ≤ 25 km, fuel, sort`), inkl. `maps_url`.
- `GET /v1/stations/{id}/forecast` — Rohprognose
  (`fuel, horizon 0|3|7`) + `{mase_24h, picp_7d, confidence_badge,
  fitted_at}`; Debugging und Werkstatt-Fan-Chart.
- `GET /v1/heatmap` — `kind=level|probability, weeks=6` → DoW × Stunde.
- `GET /v1/route/evaluate` — Umweg-Ökonomik-Einzelrechnung
  (`station_id, liters, detour_km, consumption, value_of_time, when` →
  `{delta_ct, gross_eur, detour_cost_eur, net_eur, worth_it, z_used}`).
- `GET /v1/health` — Collector-Stand, NAS-Erreichbarkeit, tmpfs-Füllstand
  & Oldest-Age, Coverage, letzte Fehler.
- Neu (Werkstatt): `GET /v1/stats/summary` — Scoreboard-/Kalibrierdaten
  (§5.2, §8.2) für den Labor-Bildschirm.

---

## 12. Noch nicht gestellte, aber wichtige Fragen (Lücken-Checkliste)

**P0** = vor/direkt nach M1, **P1** = vor Rollout, **P2** = später.

### Daten & Markt

| P | Frage | Abdeckung |
|---|---|---|
| **P0** | Historische Daten der 3 Städte: Quelle, Zeitraum, Auflösung? | CSV-Schema (`analysis/README.md`), Coverage-Gate ≥ 85 %; bei Grob-Auflösung schwächere Fits (im Report sichtbar) |
| **P0** | Sind die Historie-Stationen real erreichbar? (Frankfurt: 100+ im 25-km-Radius) | Referenzpunkt je Stadt aus gitignorierter `config.local.json`, `onroute`-Modus, `--rank-by score`, `--max-radius` |
| **P0** | E10-Verträglichkeit des Autos? | K.-o.-Kriterium; sonst `--fuel E5` (Äquivalenzpreis, §10) |
| **P1** | Rabatt-/Kartenprogramme (2–4 ct können das Ranking umdrehen)? | geplant: `--brand-rebate "ARAL:0.02;…"`; bis dahin Top-10 der eigenen Karten-Marke gesondert betrachten |
| **P1** | Wann tanke ich wirklich? (Pendlerprofil/Schicht/Homeoffice) | w(h)-Profil als Config; Kalibrierung aus eigenen Tankbelegen (`/outcome`-Log liefert das gratis mit) |
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
| **P2** | Eigene Tankbelege → echte €-Bilanz | jetzt Kern: `/v1/recommendations/{id}/outcome` (§11.2); jährliche Effektiv-Bilanz in der Werkstatt |

---

## 13. Roadmap

| Meilenstein | Inhalt | Fertig-Kriterium |
|---|---|---|
| M1 | Collector + tmpfs-Ringpuffer + NAS-Uploader laufen 14 d | Datenlücken < 2 %, Ack-Protokoll fehlerfrei |
| M2 | Selektion mit echten Historien der 3 Kampagnen (HE/BY/NW; Anker + Subdivs aus lokaler Config, nie im Repo) | Top-10 quotiert (6/2/2), q < 0.05, Report archiviert |
| M3 | Engine M1–M3 + ACI + Backtest (Fits auf NAS, Pi nur Inference) | MASE(24 h) < 0,95 gesamt und < 0,80 sprungfrei; Pinball < Naive; PICP(95 %) ∈ [90, 98] % |
| **M4** | **PWA mit Decision-Layer-UI: Alltags-Modus (Startkarte + 3 aufklappbare Zeilen) + Werkstatt-Modus; Fan/Heatmaps nur noch in der Werkstatt; Service-Worker-Cache** | **Startbildschirm hat ≤ 3 primäre Zahlen**; Lighthouse > 90; installierbar; letzte `/v1/decide`-Antwort offline abrufbar |
| **M5** | **TankPuls: `/v1/decide` primär + `/v1/recommendations/{id}/outcome` + Outcome-Logging; klassische Endpunkte bleiben (deprecated-Header); Rate-Limits/Keys** | OpenAPI-Doku + Tests grün; jede Empfehlung erzeugt einen log-Eintrag mit automatischem 24-h-Outcome |
| M6 *(optional)* | Quantile-Boosting M4-Q auf 3–5 Top-Stationen (wöchentliches Refit, 3 Quantile, NAS) | nur wenn 21-Tage-Backtest ≥ 0,3 ct Verbesserung; sonst verworfen |
| **M7 (neu)** | **Kalibrierungs-Loop nach 4 Wochen Live-Betrieb: Brier-Score + Reliability-Diagramm messen (Werkstatt/Debug), Entscheidungsschwellen §4.1/§4.2 an Trefferquoten anziehen, Kalibrierungs-Gate (§0.4) schalten** | Brier < 0,25 bei ≥ 100 Empfehlungen → P_besser-Anzeige freigeschaltet; Produkt-KPIs (§6) im Ziel oder Schwellen-Nachzug terminiert. **Erst nach M7 gilt das Produkt als „fertig kalibriert“.** |

---

## 14. Ehrliche Grenzen dieser Umstellung

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

Das Ganze macht die App fachlich weniger beeindruckend und praktisch erst
nützlich: Die 2 000-Zeilen-Konzept-Mathematik wird zu drei Zeilen auf dem
Handy — der Rest ist Werkstatt.

---

## Anhang A: Auswertung der externen Bewertung (v3 → v4)

Die externe Bewertung von KONZEPT v3 (F1–F3, O1–O7) wurde in v4
verarbeitet; dieses Kapitel dokumentiert die Entscheidungen dauerhaft
(früher eigenständiges Dokument `REVIEW-2026-09-06.md`).

**Gesamturteil damals:** methodisch starkes Konzept; die Korrekturen waren
überwiegend Sparsamkeit, nicht Reparatur. „Zusatznutzen von Ensemble/M4-Q
ist marginal“ stimmt für die *Punktschätzung*, nicht für das
*Produktziel* — weshalb produktseitige Kennzahlen (Top-3-Trefferquote,
heute zusätzlich Brier/Regret, §6) eingeführt wurden.

| Punkt | Bewertung sagte | Entscheidung | Umsetzung |
|---|---|---|---|
| F1 Datenpunkte/Tag | 5 760 falsch → 6 480 | ✅ übernommen | §9.2 (6 480; realistisch 4 320–6 480) |
| F2 MASE < 0,8 zu streng | < 0,95 + Pinball | ✅ übernommen, **verschärft** | 4-stufige Kriterien + Top-3-Quote (§3.2) |
| F3 Poll 00–24 | einfach Volltag | ⚠️ teils: adaptive Logik raus, Default bleibt 06–24 | §7, `POLL_START=00`, `NIGHT_IDS` |
| O1 M4-Over-Engineering | später, weniger | ✅ übernommen, präzisiert | M4-Q (3 Quantile, wöchentlich, NAS); Training verlässt den Pi (§9.1) |
| O2 ACI-η | 0,005, nach 4 Wochen | ✅ übernommen | §3.3 |
| O3 Feiertage je Bundesland | `holidays`+`subdiv` | ✅ übernommen + implementiert | `--subdiv` (Selektion); gepoolter Dummy (§3.2) |
| O4 Selektions-Drift | CUSUM auf Rolling-δ̂ | ✅ übernommen | §12 Daten & Markt |
| O5 PWA-Offline | Service Worker | ✅ übernommen | §8.1 |
| O6 InfluxDB-Memory-Limit | `--memory=4g` + Retention | ❌ **nicht übernommen** (Betreiber-Anweisung) | §9 unverändert; Weg ist dokumentiert und nachrüstbar |
| O7 Zeitwert pauschal | peak/offpeak + Slider | ✅ übernommen | §10 + API `when`/`z_used` |

**Eigene Korrekturen jenseits der Bewertung (N1–N5):**

- **N1:** Wochen-Saison (Periode 2016) ist mit 6 Wochen Training (~6 Zyklen)
  nicht schätzbar → DoW-Dummies für 12 Monate; ETS nur eine Saisonperiode.
- **N2:** Der tägliche Rolling-Origin-Backtest (42 Refits × 10–30 Modelle +
  Bootstrap B = 500) ist der größere Pi-Posten, nicht M4-Q → klare
  Trennung Pi = Inference, NAS = Training (§9.1).
- **N3:** Frankfurt (25-km-Radius: 100+ Stationen) → Sampling auf real
  erreichbare Stationen begrenzen + **quotierte Top-10 (6/2/2)**, sonst
  decken die 10 gepollten IDs die Reiseorte nicht.
- **N4:** Namenskollision „M4“ (Modell vs. Meilenstein) → Modell heißt
  **M4-Q**.
- **N5:** Feiertags-Dummy pro 6-Wochen-Fenster unidentifizierbar (0–1
  Fälle) → Poolschätzung über das Kalenderjahr je Bundesland.

Datenschutz-Entscheidungen (früher §8 des Reviews): Stadtname darf ins Repo,
**Straße/Hausnummer nie**; Heimkoordinaten nur in gitignorierter
`analysis/config.local.json` (`--config`); keine Adressen in Reports;
falls doch etwas in der Git-History landet: Repo privat oder
Filter-Repo-Bereinigung — `git rm` allein reicht nicht.

---

## Anhang B: Die zwei Sample-GUIs als UI-Prototypen

Der Anwender hat den Decision-Layer-Ansatz an **zwei Next.js-Prototypen**
ausgeprobiert (`sample/`). Beide bleiben als Referenz im Repo; dieses
Konzept macht aus ihnen die zwei Modi einer App.

### B.1 `sample/good gui` → Modus „Alltag“

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

Was der Prototyp noch nicht hat (Produkt-Lücke): P_besser als kalibrierte
Prozentzahl (zeigt stattdessen feste Schwellen), Outcome-Log/Bilanz,
„Keine klare Empfehlung“-Modus, deprecated-Headers.

### B.2 `sample/good statistic gui` → Modus „Werkstatt“

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

### B.3 Verschmelzungs-Regeln

1. Beide Prototypen teilen sich **eine** Datenbasis und **eine**
   Entscheidungslogik (§4); sie unterscheiden sich nur in der
   Übersetzung (Alltag = Ampel, Werkstatt = Verteilung).
2. Alle vier v4-Dashboard-Kacheln (Fan, 2 Heatmaps, Top-10) leben
   ausschließlich in der Werkstatt.
3. „Meine Stationen“ ersetzt das δ̂-Ranking; δ̂ ist Werkstatt-Detail.
4. Jede Prozentzahl in beiden Modi folgt dem Kalibrierungs-Gate (§0.4) —
   auch die Werkstatt zeigt P-Werte nach M7 mit Brier-Kontext.
