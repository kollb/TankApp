# Missingness-Policy — NaN-Residuen im Tagesblock-Bootstrap

> Stand: 22.09.2026 · Aufgabe A21-B5.2 (Issue #212) · Verbindliche Policy,
> Messfelder und reproduzierbare Ablation für fehlende Residuen

## Inhaltsverzeichnis

- [Problem](#problem)
- [Messung](#messung)
- [Policies](#policies)
- [Aktivierungsbedingungen](#aktivierungsbedingungen)
- [Ablation](#ablation)
- [Lücken-Ablation (seit 0.70.0)](#lücken-ablation-seit-0700)
- [Grenzen](#grenzen)

## Problem

Ein gezogener Tagesblock kann an einem Slot fehlen (Nachtlücke, Ausfalltag,
NAS/Pi-Catch-up). Ohne Behandlung fielen diese NaN-Pfade aus der
Quantilsberechnung — das Quantil konnte steigen, obwohl jeder einzelne Pfad
fallend war (12-Uhr-Verstoß). `engine/models.py::predict` füllt fehlende
Residuen deshalb mit 0 (Struktur allein), damit alle Ziehungen endlich bleiben
und die Monotonie der Quantile aus der Monotonie der Pfade folgt.

Das ist eine **stille Imputation**: Nullresiduen können Varianz und Schärfe
verzerren. Seit A21-B5.2 ist die Wirkung je Zeitpunkt messbar, die Policy
austauschbar und gegen zwei ehrliche Baselines paarweise bei gleichem
Cutoff/Seed vergleichbar (`engine/models.py::fill_residual_draws`).

## Messung

Jede Prognose (`engine/models.py::predict`) weist je Zeitpunkt aus:

| Feld | Bedeutung |
|---|---|
| `effective_draws` | endliche Residuen-Zellen der `bootstrap_samples` Ziehungen |
| `null_fill_share` | Anteil still auf 0 gesetzter Zellen (0 = keine Imputation) |
| `support_days` | Blöcke mit endlichem Wert am Slot (Blockstütze, wie zuvor) |
| `supported` | Freigabe des Punktes (Blockstütze, Policy, Quantil-Endlichkeit) |

Mit übergebenem `diagnostics`-Wörterbuch ergänzt `diagnostics["missingness"]`
die Zusammenfassung `policy`, `null_fill_share_max`, `effective_draws_min`,
`release_ok_all`.

## Policies

Parameter `missingness_policy` in `predict` (Default
`MISSINGNESS_POLICY_DEFAULT = "zero_fill"`):

| Policy | Verhalten | Rolle |
|---|---|---|
| `zero_fill` (A) | 0 je fehlender Zelle — Verhalten wie zuvor | **Produktions-Default** |
| `coherent_block` (C) | ein gezogener Tag mit irgendeiner Lücke fällt als Ganzes (reine Struktur), nie halb gefüllt | Baseline |
| `no_release` (B) | wie A, aber Zeitpunkte mit `< min_effective_draws` effektiven Draws sind nicht freigegeben (NaN statt Scheinschärfe) | Baseline |

`min_effective_draws` (Parameter) defaultet auf
`MIN_EFFECTIVE_DRAWS_SHARE = 0.5` × `bootstrap_samples`. Die Schwelle deckt
die **Mittelzone**: Slot formal gestützt (`support_days` ≥ `min_slot_days`),
aber die Mehrheit der gezogenen Blöcke fehlt. Totalausfälle je Slot sperrt
schon `supported` — dort sind alle Policies identisch.

## Aktivierungsbedingungen

- Der Default **bleibt `zero_fill`**, bis eine reproduzierbare Ablation über
  **alle** Lückenszenarien und **mehrere Seeds** zeigt: PICP 50/95, Schärfe
  (Intervallbreite) und Referenztreue (MAE q50 zum clean-Lauf) sind verbessert
  oder gleichbleibend **und** 12-Uhr-Verstöße bleiben 0.
- Ein **negatives Ergebnis ist zulässig** und lässt Sperre/Default einfach
  stehen: kein automatisches neues Release ohne robusten Nachweis.
- Die12-Uhr-Integrität (endliche Pfade, monotone Quantile je Segment) ist
  eine harte Randbedingung — jede Policy, die NaN-Pfade in die
  Quantilsberechnung zurückbringt, ist ausgeschlossen.

## Ablation

`data-tools/ablation_missingness.py` (nur Engine-Imports, deterministisch):

```bash
.venv/bin/python data-tools/ablation_missingness.py --quick
.venv/bin/python data-tools/ablation_missingness.py \
    --seed 20260922 --history-days 42 --bootstrap-samples 500 --hours 48
```

Ergebnis: `results/ablation_missingness/report.{csv,md}` (nicht versioniert;
gleicher Seed → byte-identisch, `tests/test_a21_b5_missingness.py`).
Szenarien: `clean`, `isolated_slots`, `systematic_slots`, `outage_days`,
`nas_catchup` (isolierte Lücken, systematische Slotlücken, Ausfalltage,
NAS/Pi-Catch-up) — alle Kombinationen mit den drei Policies, gleicher Cutoff,
gleicher Bootstrap-Seed (paarweise).

Letzter Befund (Seed 20260922, Stand 22.09.2026): `zero_fill` hält PICP/
Referenztreue unter allen vier Mustern nahe dem clean-Lauf (MAE q50 ≤ 0,002 ct);
`coherent_block` kollabiert unter isolierten/systematischen Lücken (PICP → 0);
`no_release` greift zusätzlich zu `supported` erst unter der 50-%-Schwelle.
**Kein Policy-Wechsel gerechtfertigt** — Default bleibt.

## Lücken-Ablation (seit 0.70.0)

Der Prüfbericht (§6.5) verlangt echte Lückenmuster und die Veröffentlichung
der Datenqualität:

- **Echte Muster:** `--gap-pattern-from gaps.csv` (Spalten `day,slot`)
  ergänzt das Muster `real_gaps` — Lücken aus Betriebsdaten statt aus dem
  Zufallsgenerator. `--seeds 7,8` fährt mehrere Seeds in einem Lauf
  (Seed-Spalte im Report). Ohne Muster bleibt der Report 15-zeilig
  (Kompat-Beleg `tests/test_a21_b5_missingness.py` bleibt gültig).
- **Veröffentlichte Qualität:** Jede Publikation trägt `data_quality`
  (`app/data_quality.py`): je Station `voll`/`lueckig`/`duenn`,
  `THIN_TRAIN_DAYS = 35` (unter 35 von 42 Trainingstagen = dünn), dazu
  `weak_share` (Anteil lückig+dünn) in `/v1/health` unter
  `models.data_quality`. Die Hampel-Ablation bleibt Messung, keine
  Modellkomplexität (Priorität 6).

## Grenzen

- Die Ablation nutzt eine **synthetische Einzelrealisierung**; selbst der
  clean-Lauf zeigt PICP unter den Nominalwerten (Residual-Bootstrap deckt
  AR-Rauschen unvollständig ab). Belastbare Kalibrierungsurteile liefert der
  Walk-forward-/Replay-Harness (#213) mit echtem Abnahmeset.
- Keine Betriebsabnahme realer Datenlücken (NAS-Ausfälle etc.) — offene
  Grenzen: [docs/planung/LUECKEN.md](../planung/LUECKEN.md).
