#!/usr/bin/env python3
"""
TankApp – A21-B5.2 (#212): reproduzierbare Missingness-Ablation.

Grund: Im Tagesblock-Bootstrap werden fehlende Residuen (NaN) per 0-Füllung
(Struktur allein) imputiert — nötig für den 12-Uhr-Fix (endliche Pfade), aber
eine stille Imputation, die Varianz und Schärfe verzerren kann
(engine/models.py ``fill_residual_draws``). Dieses Werkzeug misst die Wirkung
unter reproduzierbaren Lückenmustern und vergleicht die drei Policies paarweise
bei **gleichem Cutoff und gleichem Seed**:

- ``zero_fill``    (A, Produktions-Default): 0 je fehlender Zelle.
- ``coherent_block`` (C, Baseline): gezogene Tage mit Lücke fallen ganz weg.
- ``no_release``   (B, Baseline): zu wenig effektive Draws → kein Release.

Lückenszenarien (Ablations-Auftrag, #212):

- ``clean``            Referenz ohne Lücken.
- ``isolated_slots``   isolierte Lücken (5 % zufällige Zellen).
- ``systematic_slots`` systematische Slotlücken (jeder Tag 00:00–06:00 Uhr).
- ``outage_days``      Ausfalltage (3 ganze Tage am Stück).
- ``nas_catchup``      NAS/Pi-Catch-up (jeder 7. Tag nur bis 12:00 Uhr da).

Scores je Lauf (gegen die realisierte synthetische Wahrheit nach dem Cutoff
und gegen den clean-Referenzlauf): PICP50/PI95, mittlere Intervallbreite
(Schärfe), MAE der q50 zum Clean-Lauf, 12-Uhr-Verstöße des q50 (der ursprüng-
liche Bug-Anlass), dazu die Messfelder ``null_fill_share_max``/
``effective_draws_min``. Ein **negatives Ergebnis ist zulässig** und ändert
per Default nichts: Der Policy-Wechsel braucht robusten Nachweis über alle
Szenarien und Seeds (docs/referenz/MISSINGNESS.md).

Aufruf (reproduzierbar, Ergebnis unter results/ — nicht versioniert):

    .venv/bin/python data-tools/ablation_missingness.py --quick
    .venv/bin/python data-tools/ablation_missingness.py \
        --seed 20260922 --history-days 60 --bootstrap-samples 1000

Nur Standardbibliothek + numpy/pandas (Engine-Import).
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.config import Config  # noqa: E402
from engine.data import PriceSeries  # noqa: E402
from engine.models import (  # noqa: E402
    MISSINGNESS_POLICIES,
    fit,
    predict,
)

SCENARIOS = (
    "clean",
    "isolated_slots",
    "systematic_slots",
    "outage_days",
    "nas_catchup",
    "real_gaps",
)
DEFAULT_SEED = 20260922
SLOT_COUNT = 288  # 5-Minuten-Raster je Tag (Config erzwingt step_minutes=5)


def synthetic_series(
    *,
    start: str,
    days: int,
    seed: int,
) -> pd.Series:
    """Deterministische Preisreihe (5-Minuten-Raster, UTC) zum Ablatieren.

    Tagesprofil + Wochentagsniveau + AR(1)-Rauschen — genug Struktur für
    Tagesblock-Bootstrap und 12-Uhr-Projektion; alles aus einem Seed.
    """
    rng = np.random.default_rng(seed)
    index = pd.date_range(
        pd.Timestamp(start, tz="UTC"),
        periods=days * SLOT_COUNT,
        freq="5min",
    )
    slots = np.arange(len(index)) % SLOT_COUNT
    local = index.tz_convert("Europe/Berlin")
    profile = 0.12 * np.sin(2 * np.pi * (slots - 60) / SLOT_COUNT)
    weekday = 0.03 * ((local.dayofweek.to_numpy() % 6 == 0).astype(float))
    noise = np.zeros(len(index))
    eps = rng.normal(0.0, 0.01, size=len(index))
    for i in range(1, len(index)):
        noise[i] = 0.9 * noise[i - 1] + eps[i]
    return pd.Series(1.55 + profile + weekday + noise, index=index, name="price")


def price_series_frame(series: pd.Series) -> pd.DataFrame:
    """``PriceSeries.frame``-Form für den Fit (wie ``prepare_series``).

    Synthetische Reihe ohne Artefakte: alle Punkte frisch und offen, Diagnose-
    Spalten gleich den Trainingspreisen.
    """
    values = series.to_numpy(dtype=float)
    return pd.DataFrame(
        {
            "price": values,
            "price_raw": values,
            "observed": np.ones(len(values), dtype=bool),
            "response_observed": np.ones(len(values), dtype=bool),
            "available": np.ones(len(values), dtype=bool),
            "status": "open",
            "status_known": np.ones(len(values), dtype=bool),
            "source": "synthetic",
            "age_minutes": np.zeros(len(values), dtype=float),
            "observed_at": series.index,
        },
        index=series.index,
    )


def gap_mask(
    scenario: str,
    n_blocks: int,
    *,
    seed: int,
    pattern_from: Path | None = None,
) -> np.ndarray:
    """Boolean-Lückenmaske (True = fehlend) auf (Tag, 288 Slots).

    ``real_gaps`` lädt ein reales Lückenmuster aus ``pattern_from`` (M3):
    CSV mit Spalten ``day,slot`` (0-indiziert, Slot 0–287 auf dem
    5-Minuten-Raster) — z. B. aus exportierten Polling-Lücken. Das Muster
    wird auf die Blockzahl zugeschnitten bzw. periodisch wiederholt.
    """
    mask = np.zeros((n_blocks, SLOT_COUNT), dtype=bool)
    rng = np.random.default_rng(seed + 17)
    if scenario == "clean":
        return mask
    if scenario == "real_gaps":
        if pattern_from is None:
            raise ValueError("real_gaps braucht --gap-pattern-from (CSV).")
        return real_gap_mask(pattern_from, n_blocks)
    if scenario == "isolated_slots":
        pick = rng.random(mask.shape) < 0.05
        return pick
    if scenario == "systematic_slots":
        # Nachtlücke 00:00–06:00 Uhr — jeden Tag derselbe Slot-Bereich.
        mask[:, 0:72] = True
        return mask
    if scenario == "outage_days":
        # Drei ganze Ausfalltage in der Trainingsmitte.
        mid = max(1, n_blocks // 2)
        mask[max(0, mid - 1) : min(n_blocks, mid + 2), :] = True
        return mask
    if scenario == "nas_catchup":
        # Pi/ NAS liefert an jedem 7. Tag nur die erste Tageshälfte nach
        # (Catch-up blieb aus) — systematische halbe Ausfalltage.
        mask[6::7, 144:] = True
        return mask
    raise ValueError(f"Unbekanntes Ablationsszenario {scenario!r}.")


def real_gap_mask(path: Path, n_blocks: int) -> np.ndarray:
    """Reales Lückenmuster aus CSV (``day,slot``) auf (Tag, 288 Slots).

    Zeilen außerhalb des Rasters werden verworfen (gezählt, nicht still
    verschoben); das Muster wiederholt sich periodisch über die Blöcke.
    """
    import csv as csv_module

    mask = np.zeros((n_blocks, SLOT_COUNT), dtype=bool)
    with Path(path).open("r", encoding="utf-8", newline="") as handle:
        reader = csv_module.DictReader(handle)
        if reader.fieldnames is None or not {"day", "slot"} <= set(reader.fieldnames):
            raise ValueError(f"{path}: erwartet Spalten day,slot.")
        for row in reader:
            try:
                day = int(float(str(row["day"]).strip()))
                slot = int(float(str(row["slot"]).strip()))
            except (TypeError, ValueError):
                continue
            if slot < 0 or slot >= SLOT_COUNT or day < 0:
                continue
            mask[day % n_blocks, slot] = True
    return mask


def apply_gaps(model: dict, mask: np.ndarray) -> dict:
    """Lückenmaske auf **alle** Residuen-Tagesblöcke des Modells anwenden.

    ``kind="profile_ar2"`` zieht aus ``profile_blocks`` (Rückfall auf
    ``residual_blocks`` bei Formabweichung) — beide Arrays müssen dieselbe
    Korruption sehen, sonst misst die Ablation die falschen Lücken.
    """
    out = dict(model)
    for key in ("residual_blocks", "profile_blocks"):
        raw = out.get(key)
        if raw is None:
            continue
        blocks = np.asarray(raw, dtype=float).copy()
        if blocks.shape != mask.shape:
            raise ValueError(
                f"Lückenmaske {mask.shape} passt nicht zu {key} {blocks.shape}."
            )
        blocks[mask] = np.nan
        out[key] = blocks
    return out


def _segments(local: pd.DatetimeIndex) -> np.ndarray:
    """12-Uhr-Segmente [12:00, nächste 12:00) als Kennungen."""
    shifted = (local - pd.Timedelta(hours=12)).normalize()
    return shifted.to_numpy()


def noon_violations(q50: np.ndarray, index: pd.DatetimeIndex) -> int:
    """Steigende q50-Schritte innerhalb eines 12-Uhr-Segments."""
    local = index.tz_convert("Europe/Berlin")
    seg = _segments(local)
    rises = 0
    for start, stop in _segment_slices(seg):
        window = q50[start:stop]
        finite = np.isfinite(window)
        if finite.sum() < 2:
            continue
        vals = window[finite]
        rises += int((np.diff(vals) > 1e-9).sum())
    return rises


def _segment_slices(seg: np.ndarray) -> list[tuple[int, int]]:
    slices: list[tuple[int, int]] = []
    start = 0
    for i in range(1, len(seg) + 1):
        if i == len(seg) or seg[i] != seg[start]:
            slices.append((start, i))
            start = i
    return slices


def score_run(
    frame: pd.DataFrame,
    truth: pd.Series,
    reference: pd.DataFrame,
) -> dict:
    """Coverage/Schärfe/Referenztreue + 12-Uhr-Verstöße je Lauf."""
    joined = pd.DataFrame(
        {
            "truth": truth.reindex(frame.index),
            "q025": frame["q025"],
            "q10": frame["q10"],
            "q50": frame["q50"],
            "q90": frame["q90"],
            "q975": frame["q975"],
        }
    ).dropna(subset=["truth", "q50"])
    q50_ref = reference["q50"].reindex(joined.index)
    both = np.isfinite(q50_ref.to_numpy()) & np.isfinite(joined["q50"].to_numpy())
    mae_q50 = (
        float(
            np.mean(
                np.abs(
                    joined["q50"].to_numpy()[both] - q50_ref.to_numpy()[both],
                ),
            ),
        )
        if both.any()
        else float("nan")
    )
    return {
        "picp50": float(
            (
                (joined["truth"] >= joined["q10"]) & (joined["truth"] <= joined["q90"])
            ).mean(),
        ),
        "picp95": float(
            (
                (joined["truth"] >= joined["q025"])
                & (joined["truth"] <= joined["q975"])
            ).mean(),
        ),
        "width95": float((joined["q975"] - joined["q025"]).mean()),
        "mae_q50_to_clean": mae_q50,
        "noon_violations_q50": noon_violations(
            frame["q50"].to_numpy(dtype=float), frame.index
        ),
    }


def run_ablation(
    *,
    seed: int = DEFAULT_SEED,
    history_days: int = 42,
    bootstrap_samples: int = 200,
    hours: int = 48,
    scenarios: tuple[str, ...] = SCENARIOS,
    policies: tuple[str, ...] = MISSINGNESS_POLICIES,
    pattern_from: Path | None = None,
) -> list[dict]:
    """Paarweise Ablation: gleicher Cutoff, gleicher Seed, alle Kombinationen."""
    for scenario in scenarios:
        if scenario == "real_gaps" and pattern_from is None:
            continue  # ohne Muster kein reales Szenario (kein Fehler)
        gap_mask(scenario, 1, seed=seed, pattern_from=pattern_from)  # Namen prüfen
    horizon_days = (hours + 23) // 24
    total_days = history_days + horizon_days + 1
    series = synthetic_series(
        start="2026-05-01T00:00",
        days=total_days,
        seed=seed,
    )
    origin = series.index[history_days * SLOT_COUNT]
    truth = series[origin : origin + pd.Timedelta(hours=hours)]
    cfg = Config(
        train_days=history_days,
        min_train_days=min(28, history_days),
        bootstrap_samples=bootstrap_samples,
        seed=seed,
        # Bodenkante der 12-Uhr-Regel deaktivieren — die Ablation misst die
        # Füll-Policy, nicht die Gesetzesprojektion.
        price_law_local="2020-01-01T00:00",
    )
    base_model = fit(
        PriceSeries(
            city="Ablation",
            station_id="synthetic-1",
            station_name="Synthetisch",
            fuel="E10",
            frame=price_series_frame(series),
        ),
        origin,
        cfg,
    )
    blocks = np.asarray(base_model["residual_blocks"], dtype=float)
    index = pd.date_range(
        origin,
        periods=hours * 60 // cfg.step_minutes,
        freq=f"{cfg.step_minutes}min",
    )
    # Clean-Referenzlauf (unlückige Blöcke, zero_fill) zuerst — die
    # Referenztreue aller Läufe misst gegen ihn.
    reference = predict(dict(base_model), hours, index=index, kind="profile_ar2")

    rows: list[dict] = []
    for scenario in scenarios:
        if scenario == "real_gaps" and pattern_from is None:
            continue
        masked_model = apply_gaps(
            base_model,
            gap_mask(scenario, blocks.shape[0], seed=seed, pattern_from=pattern_from),
        )
        for policy in policies:
            diagnostics: dict = {}
            frame = predict(
                masked_model,
                hours,
                index=index,
                kind="profile_ar2",
                missingness_policy=policy,
                diagnostics=diagnostics,
            )
            miss = diagnostics.get("missingness", {})
            rows.append(
                {
                    "scenario": scenario,
                    "policy": policy,
                    "missingness": miss,
                    "frame": frame,
                },
            )
    scored: list[dict] = []
    for row in rows:
        entry = {
            "seed": seed,
            "scenario": row["scenario"],
            "policy": row["policy"],
            **score_run(row["frame"], truth, reference),
            "null_fill_share_max": row["missingness"].get("null_fill_share_max", 0.0),
            "effective_draws_min": row["missingness"].get(
                "effective_draws_min", bootstrap_samples
            ),
            "release_ok_all": row["missingness"].get("release_ok_all", True),
        }
        scored.append(entry)
    return scored


CSV_FIELDS = (
    "seed",
    "scenario",
    "policy",
    "picp50",
    "picp95",
    "width95",
    "mae_q50_to_clean",
    "noon_violations_q50",
    "null_fill_share_max",
    "effective_draws_min",
    "release_ok_all",
)


def write_report(rows: list[dict], out_dir: Path, *, seed: int) -> tuple[Path, Path]:
    """CSV + Markdown-Bericht (reproduzierbares Messartefakt) schreiben."""
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "report.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    md_path = out_dir / "report.md"
    lines = [
        "# Missingness-Ablation (A21-B5.2, #212)",
        "",
        f"- Stand: Lauf mit Seed {seed} (reproduzierbar: gleicher Seed = "
        "identische Zahlen).",
        "- Fragestellung: Was macht die stille NaN→0-Imputation der "
        "Tagesblock-Residuen mit PICP, Schärfe, Referenztreue und der "
        "12-Uhr-Monotonie — und wie schlagen sich die beiden ehrlichen "
        "Baselines (kein Release bei zu wenig Support / kohärente "
        "Blockauswahl)?",
        "- Cutoffs und Bootstrap-Seeds sind über alle Policies und Szenarien "
        "identisch (paarweiser Vergleich).",
        "",
        "## Szenarien",
        "",
        "- `clean`: Referenz ohne Lücken.",
        "- `isolated_slots`: isolierte Lücken (5 % zufällige Zellen).",
        "- `systematic_slots`: systematische Slotlücken (jeder Tag 00:00–06:00 Uhr).",
        "- `outage_days`: Ausfalltage (3 ganze Tage am Stück).",
        "- `nas_catchup`: NAS/Pi-Catch-up (jeder 7. Tag nur bis 12:00 Uhr).",
        "",
        "## Ergebnisse",
        "",
        "| Seed | Szenario | Policy | PICP50 | PICP95 | Breite Ø | MAE q50 "
        "zum Clean | 12-Uhr-Verstöße | fill-share max | eff. Draws min "
        "| Release ok |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        lines.append(
            "| {seed} | {scenario} | {policy} | {picp50:.3f} | {picp95:.3f} | "
            "{width95:.4f} | {mae_q50_to_clean:.4f} | {noon_violations_q50} "
            "| {null_fill_share_max:.3f} | {effective_draws_min} | "
            "{release_ok_all} |".format(**row),
        )
    lines += [
        "",
        "## Auswertung und Grenzen",
        "",
        "- `zero_fill` ist der Produktions-Default (Verhalten wie zuvor, "
        "12-Uhr-Integrität bleibt durch endliche Pfade erhalten).",
        "- Ein Wechsel des Defaults ist erst nach robustem Nachweis zulässig: "
        "verbesserte oder gleichbleibende PICP (50/95) **und** Schärfe **und** "
        "Referenztreue **und** 0 12-Uhr-Verstöße über **alle** Szenarien und "
        "mehrere Seeds. Ein negatives Ergebnis ist zulässig — dann bleibt die "
        "aktuelle Sperre/Default einfach stehen (kein automatisches neues "
        "Release).",
        "- Aktivierungsmechanik der Baselines: Ausfalltage, die einen Slot "
        "ganz ohne Stütze lassen, sperrt schon `supported` (counts je Slot < "
        "`min_slot_days`) — dort sind alle Policies identisch. Die "
        "`no_release`-Schwelle (50 % effektive Draws) deckt die Mittelzone: "
        "Slot formal gestützt, aber die Mehrheit der gezogenen Blöcke "
        "fehlt (siehe Spalte eff. Draws min). `coherent_block` zeigt den "
        "Preis des vollständigen Weglassens gezogener Lückentage: unter "
        "isolierten/systematischen Lücken kollabiert die Streuung "
        "(PICP nahe 0) — als Default ungeeignet.",
        "- Grenze: PICP selbst im clean-Lauf unter den Nominalwerten — die "
        "synthetische Wahrheit ist eine einzelne Realisierung unter "
        "AR(1)-Rauschen, und das Residual-Bootstrap-Resampling deckt dieses "
        "Rauschen nicht vollständig ab. Belastbare Kalibrierungsurteile "
        "kommen aus dem Walk-forward-Harness (#213) mit echtem "
        "Abnahmeset, nicht aus diesem Werkzeug.",
        "- Dieser Bericht ersetzt keine Betriebsabnahme realer Datenlücken "
        "(offene Grenzen: docs/planung/LUECKEN.md).",
        "",
    ]
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return csv_path, md_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[2])
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument(
        "--seeds",
        default=None,
        help="Mehrere Seeds (kommagetrennt) — robuster Nachweis (M3).",
    )
    parser.add_argument("--history-days", type=int, default=42)
    parser.add_argument("--bootstrap-samples", type=int, default=200)
    parser.add_argument("--hours", type=int, default=48)
    parser.add_argument(
        "--gap-pattern-from",
        type=Path,
        default=None,
        help="Reales Lückenmuster (CSV day,slot) für Szenario real_gaps (M3).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("results/ablation_missingness"),
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Kurzlauf für die CI (weniger Samples, 24 h Horizont).",
    )
    args = parser.parse_args(argv)
    bootstrap = 100 if args.quick else args.bootstrap_samples
    hours = 24 if args.quick else args.hours
    if args.seeds:
        seeds = [
            int(part.strip()) for part in str(args.seeds).split(",") if part.strip()
        ]
    else:
        seeds = [args.seed]
    rows: list[dict] = []
    for seed in seeds:
        rows.extend(
            run_ablation(
                seed=seed,
                history_days=args.history_days,
                bootstrap_samples=bootstrap,
                hours=hours,
                pattern_from=args.gap_pattern_from,
            )
        )
    csv_path, md_path = write_report(rows, args.out, seed=seeds[0])
    print(f"Ablation geschrieben: {csv_path} und {md_path} ({len(rows)} Läufe).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
