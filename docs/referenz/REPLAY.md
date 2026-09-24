# Replay-Harness — Walk-forward und Operational Replay

> Stand: 22.09.2026 · Aufgabe A21-B5.3 (Issue #213) · Deterministische
> Abnahme der Prognose- und Entscheidungskette über Zeit, Regime und
> Datenqualität

## Inhaltsverzeichnis

- [Zweck](#zweck)
- [Operator](#operator)
- [Folds und Abnahmeset](#folds-und-abnahmeset)
- [Kennzahlen und Slices](#kennzahlen-und-slices)
- [Akzeptanzmargen](#akzeptanzmargen)
- [Gate-Vergleich](#gate-vergleich)
- [Aufruf](#aufruf)
- [Abnahme-Manifest (seit 0.70.0)](#abnahme-manifest-seit-0700)
- [Grenzen](#grenzen)

## Zweck

Der Harness beantwortet: Wie gut sind Prognose (Quantile/PIT) und
Nettoentscheidung (Fenster, Regret) **auf der Zeitachse** — über mehrere
Ursprungsstunden, 23-/25-Stunden-Tage, Regime-Kanten und Datenqualitäten —
und hält das die **vor dem Lauf festgelegten** Akzeptanzmargen? Ein negatives
Ergebnis ist zulässig und ändert nichts automatisch (`app/replay.py`,
`data-tools/run_replay.py`).

## Operator

Je Fold läuft die **unveränderte Produktionskette**:

1. Aufbereitung → Fit → Tagesblock-Bootstrap → PIT-Kandidatur (echter
   21-/72-/168-h-Backtest) → finale 12-Uhr-Projektion → Veröffentlichung
   (`app.refresh.refresh`).
2. Nutzbares Fenster und Nettoentscheidung (`app.decide.evaluate_decide`).

Injiziert werden ausschließlich die **Dateneingänge** (Historie/Live-Export)
— beide strikt vor dem Fold-Ursprung geschnitten (kein Blick in die Zukunft).
Kosten drosselt nur der Aufrufer (z. B. `bootstrap_samples` in Tests); die
Kette bleibt vollständig.

## Folds und Abnahmeset

- Folds: je lokalem Tag und Ursprungsstunde (Wanduhr — an 23-/25-h-Tagen
  liegt der Ursprung auf der realen Ortszeit, `fold_origins`).
- **Äußeres Abnahmeset**: Der Harness wertet nur übergebene Daten aus;
  `--holdout` lädt einen Observations-Export. Ein echter Freigabelauf
  (Rolle `acceptance`) nutzt ein zeitlich **unangetastetes** Set einmalig —
  bis dieser Lauf stattgefunden hat, ist die Abnahme offen
  (docs/planung/LUECKEN.md).
- Rolle `synthetic` (Ersatzbestand, `synthetic_holdout`) sichert die
  dauerhafte Regression: gleicher Seed = byte-identische Kennzahlen.

## Kennzahlen und Slices

Getrennt ausgewiesen (nie vermischt): Quantilgüte (q50-MAE, PIT),
Deckung (PICP 50/95), Schärfe (PI95-Breite), Ereignis-Brier (p_correct
gegen „Warten lohnt“), Reliability (Bins + ECE), Nettonutzen und Regret der
Tagesentscheidung (ct, Orakel-Vergleich). Unsicherheit als Block-Bootstrap-
KI über Tagesblöcke. Slices: Fuel, Pooling, Modellvertrag
(`profile_ar2+day_pair=1+shared=1`), Horizont (24/72/168 h), Datenqualität
(voll/lueckig/duenn am Trainingsfenster).

## Akzeptanzmargen

`REPLAY_ACCEPTANCE` in `app/replay.py` — **vor** jedem Lauf festgelegt
(Engineering-Defaults): PICP50 0,50 ± 0,15; PICP95 0,95 ± 0,10; PI95-Breite
≤ 30 ct; Ereignis-Brier ≤ 0,25; ECE ≤ 0,15; Regret-Median ≤ 8 ct. Gültig je
Slice mit n ≥ 3 Folds; Gesamturteil = Konjunktion. Fehlschläge bleiben im
Report sichtbar („NICHT erfüllt“), ohne automatische Gegenmaßnahme.

## Gate-Vergleich

Jeder Fold weist beide Gates aus (Report-Abschnitt „Gate-Vergleich“):

- **bisher gemischtes Gate** (vor 0.68.0): M7-Statistik über alle Historie
  gepoolt (`legacy_mixed_verdict`) — ohne Herkunftsforderung.
- **Vertragskohorten-Gate** (A21-B5.1): Kontext aus der Prognose, fremde
  Kohorten öffnen nicht; `calibrated` = Statistik **und** Herkunft.

Mit `--legacy-history-rows N` säht der Harness Migrationsbestand
(kontextlose Alt-Historie) — das Szenario des 0.68.0-Deploys: das alte Gate
kann dadurch aufgehen, das Kohorten-Gate bleibt ehrlich gesperrt
(`tests/test_a21_b5_replay.py`).

## Aufruf

```bash
# Ersatzdaten (Regression; Rolle synthetic)
.venv/bin/python data-tools/run_replay.py --synthetic --days 45 \
    --first-day 2026-10-01 --last-day 2026-10-04 --origin-hours 0,12

# Echtes äußeres Abnahmeset (Freigabelauf; Rolle acceptance)
.venv/bin/python data-tools/run_replay.py \
    --holdout data/acceptance/holdout.csv --role acceptance
```

Report: `results/replay/report.json` (maschinenlesbar) und `report.md`.
Exit-Code 2 = mindestens eine Marge NICHT erfüllt.

## Abnahme-Manifest (seit 0.70.0)

Der Prüfbericht (§6.4) verlangt einen fälschungssicheren Abnahmebeleg:
Jeder Replay-Lauf schreibt `acceptance_manifest` in `report.json` —
Holdout-Pfad, **SHA-256** und Bytezahl der Holdout-Datei, die Rolle des
Laufs und einen Frozen-Hinweis (`holdout_sha256`, `holdout_bytes`,
`role`, `frozen_note`; fehlt die Datei, stehen Hash und Bytes auf
`null`, nie auf einem erfundenen Wert). **Synthetische Läufe tragen
explizit keinen Hash und sind kein Abnahmebeleg** — der Manifest-Text
sagt das im Report plain. Kalibriert ist nur der 24-h-Pfad
(PIT-Hülle); 72-/168-h-Fenster sind unkalibrierte Szenarioprognosen
und tragen in der App nie die Kalibrierungs-Sprache (UI.md, Woche).

## Grenzen

- Bis zum ersten `acceptance`-Lauf mit echtem Holdout sind alle gezeigten
  Zahlen Ersatz-/Entwicklungsstand — offene Grenzen:
  [docs/planung/LUECKEN.md](../planung/LUECKEN.md).
- Das Ereignis-„Warten lohnt“ bewertet den Tagesverlauf nach Anker; die
  VOT-/Fahrtkostenlogik steht im Ledger-Settlement, nicht im Replay.
