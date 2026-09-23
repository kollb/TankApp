# Befund Parameterschrank R3 – 23.09.2026 – 8 Karten + Spielplatz + PIT + Fensterbilanz + Güte

> Analysiert: Dump mit 8 Karten (Struktur, AR2, Bootstrap, 12-Uhr-Projektion, Ensemble, Selektion, Schwellen, Regime) + Spielplatz, PIT, Fensterbilanz, Backtest-Bilanz, Wochenrhythmus, Güte.
> Fix-Branch: `arena/01a0cf1d-tankapp` – PR enthält direkte Code-Fixes.

## 1. Zusammenfassung – 13 konkrete Fehler

| # | Ort | Typ | Fehler | Korrektur |
|---|---|---|---|---|
| F1 | Spielplatz – `Modell.tsx:462` | Darstellung | `String(predHour).padStart(2,"0")+":00"` → predHour=22.67 ergibt "22.67:00" | `formatHour(predHour)` → "22:40" |
| F2 | Karte 3 Bootstrap – `Modell.tsx:284` | Fachbegriff | `B=2000 Blöcke` – B sind Bootstrap-Samples/Ziehungen, nicht Tagesblöcke | Label → "B=2000 Ziehungen (Samples, nicht Blöcke)" – Blöcke sind n_days (z.B. 42) |
| F3 | Karte 1/2 – holiday_beta | Zuordnung | `holiday_beta` gehört zu Struktur (Dummy in X), stand in AR2-Karte | Verschoben zu Karte 1 ForTheCurious, Karte 2 zeigt jetzt AR-Größe shrink_events/state_reset |
| F4 | Karte 1 – B2 | Zuordnung | PIT-Kalibrierung `n_pit je Horizont` stand in Struktur-Karte | Verschoben zu Karte 5 (Ensemble), wo Kalibrierung nach Ensemble fließt |
| F5 | Karte 3 – B3 | Zuordnung | `pit.horizons["24h"].all.n` stand in Bootstrap | Hinweis: gehört zu Karte 5/7, hier nur Ziehungsmodus |
| F6 | Karte 4 – Satz | Fachlich unvollständig | "nur an 12:00 darf er steigen" unterschlägt Regime-Kanten | Satz + Chain korrigiert: "12:00 und deklarierte Regime-Kanten sind erlaubte Anstiegsstellen" – `_segment_bounds` setzt bei Regime-Kante neue Grenze wie 12:00 |
| F7 | Karte 5 – Titel | Darstellung irreführend | Titel "Gewichte je Horizont" aber `horizon_weights.status=not_estimated`, Werte 24h/72h/168h = - | Titel → "Ensemble (inverse MASE, global)", Sentence erklärt: aktuell global one_step, horizon_weights not_estimated |
| F8 | Karte 5 – MASE | Namenscollision | MASE 0,190/0,312 (<1, besser als Naive) vs Güte-MASE 2,75 (>1, schlechter als Naive) – gleiche Bezeichnung, unterschiedliche Definition | ForTheCurious erklärt: Karte 5 = One-Step-Validierungs-MASE, Güte = 24h-Fenster-MASE sprungfrei |
| F9 | Karte 6 / Stationen – DeltaBars | Darstellung | `DeltaBars` ohne `fmt` → Default `euro` → ct/L-Werte als "3,00 €-3,00 €0" | `fmt={centPerLiter}` ergänzt – Achse jetzt ct/L |
| F10 | Güte – Backtest-Bilanz | Label irreführend | "Regel-Ergebnis 31,35 € / Orakel 32,45 €" suggeriert Kosten → Orakel müsste ≤ Regel, wirkt unmöglich. Tatsächlich ist es Ersparnis `sum_smart_eur` vs `sum_best_eur` (saving) – Orakel > Regel korrekt | Label → "Ersparnis Regel" / "Ersparnis Orakel (obere Schranke)" / "Ø Mehrkosten vs Orakel" |
| F11 | Karte 2 – Stabilität vs CUSUM | Fachlich irreführend | phi1=0,984 phi2=-0,007 Radius 0,891 stabil ja = near-unit-root, shrink_events 0, aber CUSUM 8/10 Bruch Flag 10,49 Schwelle 2,0 – "stabil ja" suggeriert kein Bruch | ForTheCurious ergänzt: Stabilität (Wurzel<1) sagt nichts über Level-Bruch (CUSUM) – 8/10 möglich, aber irreführend |
| F12 | Wochenrhythmus | Statistik-Artefakt | "Do 06–19 Uhr 50% 13h gleichauf" bei Basis 17 Tage / 28 Tage Fenster, n=2 → 50% Artefakt, MIN_HEATMAP_POINTS=8, MIN_HEATMAP_REFERENCE=30 unterschritten | Bereits im Code: `thinReference` Flag, aber UI muss Warnung zeigen – `HeatmapGrid` zeigt "dünn, Mindestmaß 30" |
| F13 | Datenreichweite | Darstellung | Fenster 28d Bestand 17d (07.09 22:38–23.09 18:25) als "kein Datenverlust" deklariert, aber live_phase benötigt 90 Tage | Hinweis: Bestand < Fenster → fehlende Tage ehrlich, nicht als "kein Verlust" – `heatmapCoverageNote` erklärt |

## 2. Details je Karte

### Karte 1 Struktur (Huber-IRLS)
- Beta-Vektor Länge 13 korrekt (engine/models.py features(): ones + 4 harmonic +6 dow +1 after_law +1 jump_age) – UI slice 0,48 mit `Math.min(length,48)` → "Erste 13 gezeigt" dynamisch korrekt.
- Fehler F3/F4: holiday_beta und PIT-Größe falsch platziert. Fix: holiday_beta jetzt hier, PIT nach Karte 5.
- Balkenhöhe vorher `|v|·10` → alle ≥0,1 €/L auf 100% – seit N1c relativ zum größten Betrag – korrekt.

### Karte 2 AR(2)
- phi1=0,984 nah 1 → starke Persistenz, phi2≈0, Radius 0,891 <1 stabil ja technisch korrekt, aber near-unit-root → CUSUM-Bruch plausibel.
- shrink_events 0 plausibel, state_reset nein.
- F11: Widerspruch Stabilität vs Bruch erklärt.

### Karte 3 Bootstrap
- shared_draws=ja/day_pair=ja korrekt für Betrieb (profile_ar2+shared=1+day_pair=1) – BEFUND N2 zeigte Demo lief vorher harmonic/shared=False.
- F2: B=2000 Blöcke → Samples. Fix.
- F5: PIT-Größe hier falsch.

### Karte 4 PAVA
- Segmente 2, Pools 10, gepoolte 220, max 72 → starke Isotonisierung, ein Pool 72 Punkte → Rohkurve stark nicht-monoton.
- F6: Regime-Kanten fehlen im Satz. Fix: Chain und Sentence plus ForTheCurious Formel `Segment s=[12:00_d,12:00_d+1) oder [Regime-Kante, nächste Kante)`.
- law_floor aktiv, rise_outside_noon sollte 0 sein – wenn >0 Verstoß gegen Regel.

### Karte 5 Ensemble
- method=inverse_mase_one_step_validation n_eval=3003 window=14d – 3003 = Tage×Stationen? 14d Fensterlänge, aber n_eval viel größer – Verwirrung, aber nicht falsch.
- Gewichte harmonic 0,62/profile 0,38 – MASE harmonic 0,190 besser als profile 0,312.
- F7/F8: horizon_weights not_estimated trotz Titel "je Horizont" – Fix Titel und Sentence.
- weight_spread blocks=14 std=0,089 range [0,472–0,782] – stabil.

### Karte 6 Selektion
- delta_hat korrekt, CI aus Tages-Block-Bootstrap B=2000, q-Wert BH.
- Duplizierung DeltaBars Top (Stationen-Block + Karte 6) – beabsichtigt? Beide zeigen gleiches.

### Karte 7 Schwellen & Beta-CI
- Beta(5,5)-CI korrekt – lab.ts betaCredibleInterval nutzt echte Beta-Quantile via betainc/betacf, nicht Wilson. Normal-Approx zusätzlich mit Clamping [0,1] – gut.
- "Noch keine Trefferquote" korrekt bei wait_n=0 – Prior mean 0,5 wird nicht als Trefferquote angezeigt.

### Karte 8 Regime
- law_floor, cap, Zensierung – Hinweis M8 "Erster Winter nach 12-Uhr-Regel – Deckel bindend?" korrekt als kein Beleg.

### Spielplatz
- F1: Bug "22.67:00" – Fix formatHour.
- Werkstück-Text "Engine veröffentlicht kein Form-Modell je Station" erscheint weil labModel (models dict) leer – models: {} im Backtest. mu aus decision_rows (activeLabDayRow.mu=1,5 ct) existiert aber. Zwei mu-Quellen vermischt: labMu (Trainings-Erwartung aus Modell) vs activeLabDayRow.mu (realisierte Erwartung aus Backtest-Zeile). Fix: Text sollte unterscheiden oder beide zeigen.
- Epsilon-Scan 0,5/1,0=31,35€ vs 1,5-3,0=29,70€ – höheres epsilon → weniger Warten (142→106 Tage) → weniger Ersparnis – Warten hilft hier. Aussage "höheres epsilon sicherer?" korrekt verneint.

### PIT / Kalibrierung
- n_pit je Horizont gehört zu B2, nicht zu Karte 1/3.
- Status "Noch nicht aktiv" korrekt, candidate insufficient_pit (451 PITs) – Schwelle evtl. 500.

### Fensterbilanz
- "0 von 1 Fenstern genutzt (4 Empfehlungen abgerechnet · 1 Fenster verstrichen)" – used=episodes_used_30d, expired=episodes_expired_30d, settled=n – Empfehlungen ≠ Fenster. Text mischt Nenner – sollte erklären: episodes vs recommendations.

### Backtest-Bilanz
- F10: Label irreführend – Fix zu Ersparnis.
- potShare 31,35/32,45≈96,6% trotz "Richtig 5 von 18" (27%) – hit_freq ≠ pot_share, weil pot_share ct/ct, hit_freq zählt nur Vorzeichen.

### Wochenrhythmus
- F12: 50% bei n=2 Artefakt – MIN_HEATMAP_POINTS=8, MIN_HEATMAP_REFERENCE=30 – HeatmapGrid zeigt bereits "dünn".

### Güte
- PICP 69,8%/67,4% Ziel 90–98% unterdeckt → Band zu schmal, übermütig.
- MASE 2,75 >1 schlechter als Naive → Modell schlechter als Vor-Tages-Naive – Alarm.
- MAE 4,28 ct/L groß.
- CUSUM 8/10 Bruch – starker Drift.

## 3. Code-Zeilen der Fixes (dieser PR)

- `web/src/views/labor/Modell.tsx:18` – import `formatHour`
- `Modell.tsx:462` – `String(predHour).padStart → formatHour(predHour)`
- `Modell.tsx:284` – B Bloecke → Ziehungen (Samples, nicht Bloecke)
- `Modell.tsx:250/273/285/320/354` – ForTheCurious Texte korrigiert, holiday_beta nach Karte 1, PIT nach Karte 5, Regime-Kanten Hinweis
- `web/src/lab.ts:218-232` – Karte 4 Chain/Sentence + Karte 5 Titel/Sentence korrigiert
- `web/src/views/labor/Guete.tsx:249-255` – Regel-Ergebnis → Ersparnis Regel / Orakel obere Schranke
- `web/src/views/labor/Modell.tsx: DeltaBars` – `fmt={centPerLiter}` ergänzt (beide Vorkommen) → behebt "3,00 €-3,00 €0"

## 4. Offene Punkte (nicht in diesem PR)

- Fensterbilanz Text m7: episodes vs recommendations trennen – Microcopy-Pattern, braucht Abstimmung.
- Wochenrhythmus Warnung bei thinReference deutlicher hervorheben.
- Backtest pot_share vs hit_freq Erklärung im UI ergänzen.
- MASE Namenscollision (One-Step vs 24h-Fenster) – unterschiedliche Labels einführen: MASE_1step vs MASE_24h.
- Datenreichweite "Fehlende Tage, kein Datenverlust" – präziser: Bestand 17d < Fenster 28d, live_phase braucht 90d.

## 5. Umsetzung (0.69.0)

Die fünf offenen Punkte aus §4 sind mit App-Version 0.69.0 umgesetzt
(Folge-Branch `arena/01a0cf34-tankapp`); Messwerte und Befundtexte oben
bleiben unverändert.

| Punkt aus §4 | Umsetzung | Ort |
|---|---|---|
| Fensterbilanz: Episoden vs. Empfehlungen trennen | `windowsBalance()` liefert je Zähler eine eigene Zeile plus einen Beziehungssatz; die GUI rendert drei `<li>` statt eines Bruchs aus zwei Mengen | `web/src/data.ts`, `web/src/views/labor/Guete.tsx` |
| Wochenrhythmus: `thinReference` deutlicher | Warnbox über der Matrix mit den betroffenen Wochentagen, `n=` und Mindestmaß; `heatmapThinReference()` als Baustein | `web/src/components/HeatmapGrid.tsx`, `web/src/data.ts` |
| `pot_share` vs. `hit_freq` erklären | Drei Verhältnis-Kacheln (`Geholtes Potenzial`, `Richtige Entscheidungen`, `Tage mit Vorteil`) plus Satz „Drei Maßzahlen, drei Nenner“ unter den Zahlen; `labTotals` berechnet `hitRate` und liefert `null` statt 0 (A8-Gleichlauf) | `web/src/views/labor/Guete.tsx`, `web/src/views/laborModel.ts` |
| MASE-Namenskollision | `MASE_1step` (Eine-Schritt-Validierung, Ensemble-Gewichte) und `MASE_24h` (Roll-Backtest, 24-h-Fenster) als eigene Namen in GUI, Glossar und Referenz | `web/src/data.ts`, `docs/referenz/ANALYSE.md` |
| Datenreichweite präziser | `heatmapCoverageNote()` nennt Bestand, Fenster und die Zahl der fehlenden Tage; die 90-Tage-Regel hängt nur an, wenn eine Live-Phase vorliegt | `web/src/data.ts`, `web/src/components/HeatmapGrid.tsx` |

Eigene Befunde derselben Prüfung (nicht in §4): oberer Median statt echten
Median in drei Anzeigen (`medianOf()` als eine Quelle), `System.tsx` zeigte
eine dimensionslose MASE mit `euro()` und einen Kalibrier-Hinweis für eine
Metrik, die die Engine bewusst nie veröffentlicht, `Daten.tsx` baute Prozent
selbst, Karte 5 hieß „Gewichte je Horizont“ und nannte Zahlen aus einem Dump,
Karte 6 behauptete `B=2000` und „6 Wochen“ ohne Quelle im Payload.
