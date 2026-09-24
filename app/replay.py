"""A21-B5.3 (#213): deterministischer Walk-forward-/Operational-Replay-Harness.

Reproduzierbare Abnahme der Prognose- und Entscheidungskette über mehrere
Ursprungsstunden, 23-/25-Stunden-Tage, Regime und Datenqualitäten:

* **Echter Produktionsoperator** je Fold: Aufbereitung (``app.refresh.refresh``
  inkl. Gapfill/Archiv) → Fit → Tagesblock-Bootstrap → PIT-Kandidatur (echter
  21-/72-/168-h-Backtest) → finale Projektion → Veröffentlichung →
  ``app.decide.evaluate_decide`` (nutzbares Fenster, Nettoentscheidung). Nur
  die **Dateneingänge** werden injiziert (Historie/Live strekt vor dem
  Ursprung — kein Blick in die Zukunft); die Kette selbst bleibt unangetastet.
* **Zeitlich unangetastetes äußeres Abnahmeset**: Der Harness wertet nur das
  übergebene Set aus und trainiert strikt auf den Daten vor dem Fold-Ursprung.
  Ein echtes Produktions-Abnahmeset ist ein eigener, späterer Lauf (Rolle
  ``acceptance`` im Report) — bis dahin bleibt die Hardware-/Datenabnahme
  offen (docs/planung/LUECKEN.md).
* **Kennzahlen getrennt**: Quantilgüte (q50-MAE, PICP 50/95, PIT), Schärfe
  (PI95-Breite), Ereignis-Brier (P_besser), Reliability (Bins + ECE),
  Nettonutzen und Regret der Tagesentscheidung — je Slice Fuel/Pooling/
  Modellvertrag/Horizont/Datenqualität.
* **Unsicherheit** in Tages- und Regimeblöcken (Block-Bootstrap-KIs).
* **Maschinenlesbarer Report** (``report.json`` + ``report.md``) mit den
  **vorab definierten Akzeptanzmargen** ``REPLAY_ACCEPTANCE`` — das Ergebnis
  darf negativ ausfallen; ein Fehlschlag ändert nichts automatisch.
* **Gate-Vergleich**: jede Entscheidung weist das bisherige gemischte Gate
  (alle Historie gepoolt, vor 0.68.0) gegen das Vertragskohorten-Gate
  (A21-B5.1) aus.

Aufruf: ``.venv/bin/python data-tools/run_replay.py --help``.
"""

from __future__ import annotations

import contextlib
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator

import numpy as np
import pandas as pd

from engine.config import Config
from engine.models import utc_time

BERLIN = "Europe/Berlin"
REPLAY_SEED = 20260922
DECISION_PARAMS: dict[str, Any] = {
    "fuel": "e10",
    "liters": 40.0,
    "consumption": 7.0,
    "speed": 45.0,
    "mode": "onroute",
}

# A21-B5.3: Akzeptanzmargen — **vor** jedem Lauf festgelegt (Engineering-
# Defaults, keine nachträglich gesetzten Tore). ``band`` = Zielwert ± Toleranz;
# ``max`` = Obergrenze. Gültig je Slice mit n_folds >= MIN_FOLDS_PER_SLICE;
# das Gesamturteil ist die Konjunktion aller getroffenen Margen.
REPLAY_ACCEPTANCE: dict[str, dict[str, float]] = {
    "picp50": {"target": 0.50, "tolerance": 0.15},
    "picp95": {"target": 0.95, "tolerance": 0.10},
    "sharpness95_ct_max": {"max": 30.0},
    "event_brier_max": {"max": 0.25},
    "ece_max": {"max": 0.15},
    "regret_median_ct_max": {"max": 8.0},
}
MIN_FOLDS_PER_SLICE = 3
BLOCK_BOOTSTRAP_SAMPLES = 1000
RELIABILITY_BINS = (0.0, 0.4, 0.6, 0.8, 1.0001)


def _mean_or_none(values: list, digits: int = 4) -> float | None:
    """Mittel der nicht-leeren Werte oder ehrlich ``None``."""
    present = [v for v in values if v is not None]
    if not present:
        return None
    return round(float(np.mean(present)), digits)


@dataclass
class ReplayFold:
    """Eine Walk-forward-Entscheidung samt Bewertung."""

    origin: str
    day: str
    origin_hour: float
    fuel: str
    pooling: str
    model_contract: str
    horizon_hours: int
    data_quality: str
    regime_ref: str | None
    mae_q50_ct: float | None = None
    picp50: float | None = None
    picp95: float | None = None
    sharpness95_ct: float | None = None
    pit_values: list[float] = field(default_factory=list)
    event_p: float | None = None
    event_outcome: int | None = None
    net_benefit_ct: float | None = None
    regret_ct: float | None = None
    action: str | None = None
    gate_new_calibrated: bool | None = None
    gate_new_context: dict[str, Any] | None = None
    gate_legacy_calibrated: bool | None = None
    gate_legacy_n: int | None = None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        out = {
            key: value for key, value in self.__dict__.items() if key != "pit_values"
        }
        out["pit_values"] = list(self.pit_values)
        return out


def fold_origins(
    first_day: str,
    last_day: str,
    cfg: Config,
    *,
    origin_hours: tuple[float, ...] = (0.0, 6.0, 12.0, 18.0),
) -> list[pd.Timestamp]:
    """Walk-forward-Ursprünge (UTC) je lokalem Tag und Ursprungsstunde.

    Die Stunden werden als **Wanduhr** gesetzt (``wall_clock_hour``): an
    23-/25-Stunden-Tagen liegt der Ursprung auf der realen Ortszeit, nicht
    „Mitternacht + n verstrichene Stunden“. Ganztägige Ursprünge umfassen
    damit automatisch die DST-Tage des Fensters.
    """
    from engine.models import wall_clock_hour

    start = pd.Timestamp(first_day, tz=cfg.timezone).normalize()
    stop = pd.Timestamp(last_day, tz=cfg.timezone).normalize()
    out: list[pd.Timestamp] = []
    day = start
    while day < stop:
        for hour in origin_hours:
            # Wanduhr-Konstruktion über wall_clock_hour (M3): an 23-/25-h-
            # Tagen liegt der Ursprung auf der realen Ortszeit; die naive
            # tzinfo-Konstruktion ist an DST-Übergängen mehrdeutig.
            origin = wall_clock_hour(day, hour).tz_convert("UTC")
            out.append(pd.Timestamp(origin))
        # Kalender-Nächster Tag (DateOffset, keine absoluten 24 h) — sonst
        # driftet der Loop über den 25-h-Tag und erzeugt doppelte Tage.
        day = day + pd.DateOffset(days=1)
    return sorted(out)


def data_quality_label(
    frame: pd.DataFrame,
    start: pd.Timestamp,
    stop: pd.Timestamp,
    *,
    voll: float = 0.95,
    lueckig: float = 0.80,
) -> str:
    """Datenqualität des Trainingsfensters: voll / lueckig / duenn."""
    window = frame.loc[(frame.index >= start) & (frame.index < stop), "price"]
    share = float(window.notna().mean()) if len(window) else 0.0
    if share >= voll:
        return "voll"
    if share >= lueckig:
        return "lueckig"
    return "duenn"


def quantile_scores(frame: pd.DataFrame, truth: pd.Series) -> dict[str, Any]:
    """Quantilgüte und Schärfe gegen die Realisierung (5-Minuten-Raster)."""
    joined = pd.DataFrame(
        {
            "truth": truth.reindex(frame.index),
            "q025": frame.get("q025"),
            "q10": frame.get("q10"),
            "q50": frame.get("q50"),
            "q90": frame.get("q90"),
            "q975": frame.get("q975"),
        }
    ).dropna(subset=["truth", "q50"])
    if joined.empty:
        return {
            "mae_q50_ct": None,
            "picp50": None,
            "picp95": None,
            "sharpness95_ct": None,
            "pit_values": [],
        }
    err = (joined["q50"] - joined["truth"]).abs() * 100.0
    pit = quantile_pit(joined)
    return {
        "mae_q50_ct": round(float(err.mean()), 4),
        "picp50": round(
            float(
                (
                    (joined["truth"] >= joined["q10"])
                    & (joined["truth"] <= joined["q90"])
                ).mean()
            ),
            4,
        ),
        "picp95": round(
            float(
                (
                    (joined["truth"] >= joined["q025"])
                    & (joined["truth"] <= joined["q975"])
                ).mean(),
            ),
            4,
        ),
        "sharpness95_ct": round(
            float((joined["q975"] - joined["q025"]).mean() * 100.0), 4
        ),
        "pit_values": pit,
    }


def quantile_pit(joined: pd.DataFrame) -> list[float]:
    """PIT über die fünf veröffentlichten Quantilstufen (CDF-Interpolation)."""
    levels = np.asarray([0.025, 0.10, 0.50, 0.90, 0.975])
    out: list[float] = []
    for _, row in joined.iterrows():
        xs = np.asarray(
            [row["q025"], row["q10"], row["q50"], row["q90"], row["q975"]], dtype=float
        )
        if not np.isfinite(xs).all() or (np.diff(xs) < 0).any():
            continue
        out.append(round(float(np.interp(row["truth"], xs, levels)), 4))
    return out


def event_scores(p_values: list[float], outcomes: list[int]) -> dict[str, Any]:
    """Ereignis-Brier und Reliability (ECE) über P_besser-Bins."""
    if not p_values:
        return {"event_brier": None, "ece": None, "bins": []}
    p = np.asarray(p_values, dtype=float)
    o = np.asarray(outcomes, dtype=float)
    brier = float(np.mean((p - o) ** 2))
    bins = []
    ece = 0.0
    for lo, hi in zip(RELIABILITY_BINS[:-1], RELIABILITY_BINS[1:]):
        mask = (p >= lo) & (p < hi)
        if not mask.any():
            bins.append({"lo": lo, "hi": hi, "n": 0, "mean_p": None, "share": None})
            continue
        mean_p = float(p[mask].mean())
        share = float(o[mask].mean())
        ece += mask.mean() * abs(mean_p - share)
        bins.append(
            {
                "lo": lo,
                "hi": hi,
                "n": int(mask.sum()),
                "mean_p": round(mean_p, 4),
                "share": round(share, 4),
            },
        )
    return {
        "event_brier": round(brier, 4),
        "ece": round(float(ece), 4),
        "bins": bins,
    }


def decision_scores(
    action: str | None,
    window_start: Any,
    window_end: Any,
    anchor: float | None,
    truth: pd.Series,
) -> dict[str, float | None]:
    """Nettonutzen und Regret der Tagesentscheidung (ct, Konzept §6).

    Politik folgt der Empfehlung: ``warten`` kauft am realisierten Minimum
    des empfohlenen Fensters, ``jetzt`` am Anker. Der Orakel-Vergleich kauft
    am Tagesminimum. ``regret_ct = orakel − politik`` (ct, nie kleiner 0
    gerundet); ``net_benefit_ct`` ist der realisierte Nutzen der Politik.
    """
    if anchor is None or truth is None or not len(truth):
        return {"net_benefit_ct": None, "regret_ct": None}
    day = truth.dropna()
    if day.empty:
        return {"net_benefit_ct": None, "regret_ct": None}
    oracle_ct = (float(anchor) - float(day.min())) * 100.0
    if (
        action in ("wait", "warten")
        and window_start is not None
        and window_end is not None
    ):
        start = utc_time(window_start, BERLIN)
        end = utc_time(window_end, BERLIN)
        sel = day.loc[(day.index > start) & (day.index <= end)]
        if sel.empty:
            return {"net_benefit_ct": None, "regret_ct": None}
        policy_ct = (float(anchor) - float(sel.min())) * 100.0
    else:
        policy_ct = 0.0
    regret = max(oracle_ct - policy_ct, 0.0)
    return {
        "net_benefit_ct": round(policy_ct, 3),
        "regret_ct": round(regret, 3),
    }


def block_bootstrap_ci(
    values_by_block: list[list[float]],
    *,
    n_boot: int = BLOCK_BOOTSTRAP_SAMPLES,
    seed: int = REPLAY_SEED,
    statistic: Callable[[np.ndarray], float] = np.mean,
) -> tuple[float | None, float | None]:
    """KI über Block-Ziehungen (Tages- oder Regimeblöcke), 2,5/97,5 %."""
    blocks = [np.asarray(block, dtype=float) for block in values_by_block if block]
    if len(blocks) < 2:
        return None, None
    rng = np.random.default_rng(seed)
    stats = np.empty(n_boot)
    for i in range(n_boot):
        pick = rng.integers(0, len(blocks), size=len(blocks))
        sample = np.concatenate([blocks[j] for j in pick])
        stats[i] = statistic(sample)
    lo, hi = np.percentile(stats, [2.5, 97.5])
    return round(float(lo), 4), round(float(hi), 4)


@contextlib.contextmanager
def inject_data_sources(
    history_csv: Path,
    live_csv: Path,
) -> Iterator[None]:
    """Dateneingänge der Produktionskette injizieren (nur Quellen, nie Logik).

    ``app.history.prepare_archive`` liefert die Historie-CSV des Folds,
    ``export_influx.export_prices`` schreibt die LiveData-CSV — beide strikt
    vor dem Fold-Ursprung vom Harness erzeugt. Alles zwischen diesen Quellen
    und ``evaluate_decide`` ist die unveränderte Produktionskette.
    """
    import export_influx
    import app.history as history_mod

    def _archive(*_args, **_kwargs):
        return ([history_csv], {"events": 1, "missing_days": 0})

    def _export(cfg, start, stop, lookup, fuel, output, uuid_only):
        assert uuid_only
        output.parent.mkdir(parents=True, exist_ok=True)
        pd.read_csv(live_csv).to_csv(output, index=False)

    orig_archive = history_mod.prepare_archive
    orig_export = export_influx.export_prices
    history_mod.prepare_archive = _archive
    export_influx.export_prices = _export
    try:
        yield
    finally:
        history_mod.prepare_archive = orig_archive
        export_influx.export_prices = orig_export


def legacy_mixed_verdict(store: dict[str, Any]) -> dict[str, Any]:
    """Bisheriges gemischtes Gate (vor 0.68.0): **alle** Historie gepoolt.

    Dieselbe M7-Statistik (``_gate_stats_for_rows``) über die Vereinigung
    aller Settlements ohne Kohortentrennung — der Vergleichsmaßstab des
    Replay-Berichts („wie hätte das alte Gate entschieden?“).
    """
    from app.feedback import (
        _emit_day_cell,
        _gate_stats_for_rows,
        outcome_credit,
        snapshot_p_source,
    )

    snapshots_by_id = {
        snap.get("id"): snap
        for ep in store.get("episodes", [])
        for snap in (ep.get("snapshots") or [])
    }
    pooled: list[dict[str, Any]] = []
    for settlement in store.get("settlements", []):
        snap = snapshots_by_id.get(settlement.get("snapshot_id"))
        if not snap or snapshot_p_source(snap) != "verteilung":
            continue
        p_correct = snap.get("p_correct")
        if p_correct is None or not math.isfinite(float(p_correct)):
            continue
        is_win = outcome_credit(settlement.get("outcome"))
        p_val = min(1.0, max(0.0, float(p_correct)))
        day, hour, weekday = _emit_day_cell(snap)
        pooled.append(
            {
                "day": day,
                "cell": (hour, weekday) if hour is not None else None,
                "outcome": is_win,
                "p": p_val,
                "sq": (p_val - is_win) ** 2,
            },
        )
    block = _gate_stats_for_rows({"fuel": "unknown"}, pooled, n_all=len(pooled))
    verdict = block.get("statistical_verdict")
    return {
        # Vor 0.68.0 gab es keine Herkunftsforderung — das alte „kalibriert“
        # war der reine Statistik-Ausgang.
        "calibrated": verdict,
        "statistical_verdict": verdict,
        "gate_n": block.get("gate_n"),
    }


def seed_legacy_history(
    store_file: Path,
    *,
    n_days: int = 30,
    rows_per_day: int = 4,
    seed: int = REPLAY_SEED,
    now: pd.Timestamp | None = None,
) -> int:
    """Migrationsbestand einsäen: settled ``verteilung``-Zeilen **ohne** Kontext.

    Genau das ist die Ausgangslage beim Deploy von 0.68.0: Monate gemischter
    Alt-Historie ohne Vertrags-Herkunft. Das alte Gate poolt sie (kann dadurch
    aufgehen); das Vertragskohorten-Gate sieht sie nur als ``unknown``-Legacy
    und lässt sich von ihnen nicht freigeben (A21-B5.1). Rückgabe: Anzahl
    gesäter Snapshot-Zeilen.
    """
    now = now or pd.Timestamp.now(tz="UTC")
    episodes: list[dict[str, Any]] = []
    settlements: list[dict[str, Any]] = []
    count = 0
    # Deterministisches Skill-Muster (wie die O6-Abnahme-Ledger): je Tag
    # 3×(0.75, win), 1×(0.75, loss), 1×(0.25, win), 3×(0.25, loss) —
    # Trefferquote passt zum P-Wert (Steigung 1), Bias 0, Brier ~0.19.
    pattern = (
        [(0.75, "win")] * 3 + [(0.75, "loss")] + [(0.25, "win")] + [(0.25, "loss")] * 3
    )
    for day in range(n_days):
        emitted = (now - pd.Timedelta(days=day + 1)).isoformat()
        for k, (p, outcome) in enumerate(pattern[:rows_per_day]):
            snap_id = f"legacy-{day}-{k}"
            episodes.append(
                {
                    "id": f"legacy-ep-{snap_id}",
                    "snapshots": [
                        {
                            "id": snap_id,
                            "action": "wait",
                            "p_correct": p,
                            "p_source": "verteilung",
                            "emitted_at": emitted,
                            # kein ``gate_context`` → unknown-Legacy
                        },
                    ],
                },
            )
            settlements.append(
                {
                    "snapshot_id": snap_id,
                    "outcome": outcome,
                },
            )
            count += 1
    if store_file.is_file():
        store = json.loads(store_file.read_text(encoding="utf-8"))
    else:
        store = {}
    store.setdefault("episodes", []).extend(episodes)
    store.setdefault("settlements", []).extend(settlements)
    store_file.parent.mkdir(parents=True, exist_ok=True)
    store_file.write_text(
        json.dumps(store, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    return count


def load_holdout(path: Path, *, fuel: str = "e10") -> pd.DataFrame:
    """Äußeres Abnahmeset einlesen (Observations-Schema, eine Sorte)."""
    frame = pd.read_csv(path)
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
    frame = frame.sort_values("timestamp", kind="stable")
    frame = frame.loc[frame["fuel"].str.lower() == fuel.lower()]
    if frame.empty:
        raise ValueError(f"Abnahmeset {path} enthält keine Zeilen für {fuel}.")
    return frame.reset_index(drop=True)


def synthetic_holdout(
    *,
    days: int = 45,
    stations: int = 2,
    seed: int = REPLAY_SEED,
    start: str = "2026-09-01",
    fuel: str = "e10",
) -> pd.DataFrame:
    """Deterministischer Ersatzbestand zum Regressionstest des Harness.

    Tagesprofil + Wochenendniveau + AR(1)-Rauschen je Station (versetzte
    Niveaus) — gleicher Seed = identische Reihe. Der Ersatz ersetzt **kein**
    echtes Abnahmeset (Rolle ``synthetic`` im Report). Die ``source``-Spalte
    beschreibt den Transportpfad (``history``) — die Engine lehnt Demo-Labels
    zu Recht ab; die Ehrlichkeit über die Herkunft trägt der Report.
    """
    rng = np.random.default_rng(seed)
    index = pd.date_range(
        pd.Timestamp(start, tz=BERLIN),
        periods=days * 288,
        freq="5min",
    )
    hour = np.asarray(index.hour + index.minute / 60.0)
    rows: list[pd.DataFrame] = []
    for station in range(stations):
        # polling.json verlangt UUID-Formate (polling_plan.validate_sets).
        station_id = f"{(seed & 0xFFFFFFFF):08x}-0000-4000-8000-{station:012d}"
        noise = np.zeros(len(index))
        eps = rng.normal(0.0, 0.002, size=len(index))
        for i in range(1, len(index)):
            noise[i] = 0.85 * noise[i - 1] + eps[i]
        price = 1.65 + 0.05 * station + 0.04 * np.cos(hour * 2 * np.pi / 24) + noise
        rows.append(
            pd.DataFrame(
                {
                    "timestamp": index.astype(str),
                    "city": "Replay-Stadt",
                    "station_id": station_id,
                    "station_name": f"Replay-Station {station + 1}",
                    "fuel": fuel.upper(),
                    "price": np.round(price, 5),
                    "status": np.where(hour >= 6, "open", "closed"),
                    "source": "history",
                },
            ),
        )
    return pd.concat(rows, ignore_index=True)


def run_fold(
    *,
    dataset: pd.DataFrame,
    settings_factory: Callable[[Path], Any],
    origin: pd.Timestamp,
    cfg: Config,
    workdir: Path,
    horizons: tuple[int, ...] = (24, 72, 168),
    params: dict[str, Any] | None = None,
    legacy_history_rows: int = 0,
    fuel: str = "e10",
) -> ReplayFold:
    """Ein Fold: echte Produktionskette ab ``origin`` + Bewertung.

    Dateneingänge (Historie/Live) sind strikt vor ``origin`` geschnitten; die
    Realisierung danach dient ausschließlich der Bewertung. Ein Fehler in der
    Kette wird im Fold vermerkt (``error``), nicht verschluckt.
    """
    from app.data import LiveData, publication
    from app.decide import evaluate_decide
    from app.refresh import refresh

    workdir.mkdir(parents=True, exist_ok=True)
    dataset = dataset.copy()
    dataset["timestamp"] = pd.to_datetime(dataset["timestamp"], utc=True)
    before = dataset.loc[dataset["timestamp"] < origin]
    after = dataset.loc[dataset["timestamp"] >= origin]
    stations = sorted(before["station_id"].unique())
    origin_str = origin.isoformat()
    local_origin = origin.tz_convert(cfg.timezone)
    fold = ReplayFold(
        origin=origin_str,
        day=local_origin.date().isoformat(),
        origin_hour=local_origin.hour + local_origin.minute / 60.0,
        fuel=fuel,
        pooling="shared",
        model_contract="profile_ar2+day_pair=1+shared=1",
        horizon_hours=max(horizons),
        data_quality=data_quality_label(
            before.set_index("timestamp"),
            origin - pd.Timedelta(days=cfg.train_days),
            origin,
        ),
        regime_ref=None,
    )
    try:
        history_csv = workdir / "history.csv"
        live_csv = workdir / "live.csv"
        hist_cols = [c for c in before.columns if c != "status"]
        before[hist_cols].to_csv(history_csv, index=False)
        live_start = origin - pd.Timedelta(hours=24)
        before.loc[before["timestamp"] >= live_start].to_csv(live_csv, index=False)
        settings = settings_factory(workdir)
        if legacy_history_rows > 0:
            seed_legacy_history(
                settings.runtime / "feedback" / "store.json",
                n_days=max(1, legacy_history_rows // 8),
                rows_per_day=8,
                now=origin,
            )
        with inject_data_sources(history_csv, live_csv):
            refresh(settings, now=origin)
        published = publication(settings)
        fold.regime_ref = (published or {}).get("regime_ref")

        truth_by_station: dict[str, pd.Series] = {}
        for station in stations:
            part = after.loc[after["station_id"] == station].set_index("timestamp")
            truth_by_station[station] = part["price"].astype(float)
        per_station_scores: list[dict[str, Any]] = []
        for row in published.get("forecasts", []):
            if str(row.get("fuel") or "").lower() != fuel:
                continue
            points = row.get("points") or []
            if not points:
                continue
            frame = pd.DataFrame(points)
            frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
            frame = frame.set_index("timestamp").sort_index()
            truth = truth_by_station.get(str(row.get("station_id")))
            if truth is None:
                continue
            scores = quantile_scores(frame, truth)
            per_station_scores.append(scores)
            fold.pit_values.extend(scores["pit_values"])
        if per_station_scores:
            fold.mae_q50_ct = _mean_or_none(
                [s["mae_q50_ct"] for s in per_station_scores]
            )
            fold.picp50 = _mean_or_none([s["picp50"] for s in per_station_scores])
            fold.picp95 = _mean_or_none([s["picp95"] for s in per_station_scores])
            fold.sharpness95_ct = _mean_or_none(
                [s["sharpness95_ct"] for s in per_station_scores]
            )

        def _query(cfg_, flux):
            rows_out = []
            for station in stations:
                part = before.loc[before["station_id"] == station]
                if part.empty:
                    continue
                last = part.iloc[-1]
                rows_out.append(
                    {
                        "_time": str(last["timestamp"]),
                        "city": str(last.get("city") or "Replay-Stadt"),
                        "station_id": station,
                        "station": str(last.get("station_name") or station),
                        "status": str(last.get("status") or "open"),
                        fuel: str(last["price"]),
                    },
                )
            return rows_out

        live = LiveData(
            settings,
            query=_query,
            clock=lambda: origin.to_pydatetime(),
        )
        decision = evaluate_decide(live, dict(params or DECISION_PARAMS))
        primary = decision.get("primary") or {}
        fold.action = primary.get("action")
        anchor = (primary.get("station") or {}).get("price_now")
        # Ereignis-P wie im Ledger: p_correct der Empfehlung gegen
        # „Warten lohnt“ (realisierter Tiefstpreis unter Anker).
        fold.event_p = primary.get("p_correct")
        window = primary.get("recommended_window") or {}
        best_id = (primary.get("station") or {}).get("id") or (
            stations[0] if stations else ""
        )
        truth = truth_by_station.get(best_id)
        anchor_ts = origin
        if truth is not None and anchor is not None:
            realized = truth.loc[truth.index > anchor_ts].dropna()
            fold.event_outcome = int(
                bool(len(realized)) and float(realized.min()) < float(anchor),
            )
            decision_result = decision_scores(
                fold.action,
                window.get("start"),
                window.get("end"),
                float(anchor),
                realized,
            )
            fold.net_benefit_ct = decision_result["net_benefit_ct"]
            fold.regret_ct = decision_result["regret_ct"]
        fold.gate_new_calibrated = decision.get("calibrated")
        fold.gate_new_context = decision.get("gate_context")
        from app.feedback import load_store

        store = load_store(settings)
        legacy = legacy_mixed_verdict(store)
        fold.gate_legacy_calibrated = legacy.get("calibrated")
        fold.gate_legacy_n = legacy.get("gate_n")
    except Exception as exc:  # ehrlich dokumentiert statt verschluckt
        fold.error = f"{type(exc).__name__}: {exc}"
    return fold


def run_replay(
    *,
    dataset: pd.DataFrame,
    settings_factory: Callable[[Path], Any],
    cfg: Config,
    workdir: Path,
    origins: list[pd.Timestamp],
    role: str = "development",
    seed: int = REPLAY_SEED,
    params: dict[str, Any] | None = None,
    legacy_history_rows: int = 0,
    fuel: str = "e10",
    horizons: tuple[int, ...] = (24, 72, 168),
) -> dict[str, Any]:
    """Walk-forward über alle Ursprünge + maschinenlesbarer Gesamtbericht."""
    folds: list[ReplayFold] = []
    for i, origin in enumerate(origins):
        fold = run_fold(
            dataset=dataset,
            settings_factory=settings_factory,
            origin=origin,
            cfg=cfg,
            workdir=workdir / f"fold-{i:03d}",
            horizons=horizons,
            params=params,
            legacy_history_rows=legacy_history_rows,
            fuel=fuel,
        )
        folds.append(fold)
    scored = [f for f in folds if not f.error and f.gate_new_calibrated is not None]
    divergences = sum(
        1
        for f in scored
        if bool(f.gate_new_calibrated) != bool(f.gate_legacy_calibrated)
    )
    overall = _overall_metrics(folds)
    result = {
        "schema_version": 1,
        "seed": seed,
        "role": role,
        "fuel": fuel,
        "operator": (
            "app.refresh.refresh (Aufbereitung→Fit→Bootstrap→PIT→Projektion→"
            "Veröffentlichung) → app.decide.evaluate_decide (Fenster/Netto)"
        ),
        "horizons": list(horizons),
        "legacy_history_rows": legacy_history_rows,
        "overall": overall,
        "slices": _slice_overview(folds),
        "margins": evaluate_margins(overall),
        "gate_comparison": {
            "n_decisions": len(scored),
            "legacy_calibrated": sum(1 for f in scored if f.gate_legacy_calibrated),
            "new_calibrated": sum(1 for f in scored if f.gate_new_calibrated),
            "legacy_gate_n": max(
                (f.gate_legacy_n or 0 for f in folds),
                default=0,
            ),
            "divergences": divergences,
        },
        "folds": [f.as_dict() for f in folds],
        "limits": (
            "Rolle "
            + role
            + ": "
            + (
                "echtes äußeres Abnahmeset — einmaliger Freigabelauf; Ergebnis "
                "darf negativ ausfallen."
                if role == "acceptance"
                else "Entwicklungs-/Ersatzdaten; die echte Abnahme mit "
                "äußerem, zeitlich unangetastetem Set bleibt offen "
                "(docs/planung/LUECKEN.md)."
            )
        ),
    }
    return result


def evaluate_margins(
    metrics: dict[str, Any],
    *,
    margins: dict[str, dict[str, float]] = REPLAY_ACCEPTANCE,
) -> dict[str, Any]:
    """Vorab definierte Margen prüfen — ein Fehlschlag ist ein zulässiges Ergebnis."""

    def _fmt(value: float | None, digits: int = 3) -> str:
        return "—" if value is None else f"{value:.{digits}f}".replace(".", ",")

    verdicts: dict[str, Any] = {}
    for name, spec in margins.items():
        key = name.removesuffix("_max")
        value = metrics.get(key)
        if value is None:
            verdicts[name] = {"value": None, "ok": False, "note": "nicht messbar"}
            continue
        if "target" in spec:
            ok = abs(value - spec["target"]) <= spec["tolerance"]
            note = (
                f"Ziel {_fmt(spec['target'], 2)} ± {_fmt(spec['tolerance'], 2)} — "
                f"gemessen {_fmt(value)}"
            )
        else:
            ok = value <= spec["max"]
            note = f"Höchstens {_fmt(spec['max'])} — gemessen {_fmt(value)}"
        verdicts[name] = {"value": value, "ok": bool(ok), "note": note}
    judged = [item["ok"] for item in verdicts.values()]
    return {
        "margins": verdicts,
        "ok": all(judged) if judged else False,
        "judged": len(judged),
    }


def _slice_overview(folds: list[ReplayFold]) -> dict[str, Any]:
    """Slices Fuel/Pooling/Modellvertrag/Horizont/Datenqualität + Tages-KIs."""
    buckets: dict[str, dict[str, list[ReplayFold]]] = {}
    for fold in folds:
        if fold.error:
            continue
        for axis, value in (
            ("fuel", fold.fuel),
            ("pooling", fold.pooling),
            ("model_contract", fold.model_contract),
            ("horizon", f"{fold.horizon_hours}h"),
            ("data_quality", fold.data_quality),
        ):
            buckets.setdefault(axis, {}).setdefault(value, []).append(fold)
    out: dict[str, Any] = {}
    for axis, groups in buckets.items():
        out[axis] = {}
        for value, group in sorted(groups.items()):
            p50 = [f.picp50 for f in group if f.picp50 is not None]
            p95 = [f.picp95 for f in group if f.picp95 is not None]
            regrets = [f.regret_ct for f in group if f.regret_ct is not None]
            by_day: dict[str, list[float]] = {}
            for fold in group:
                if fold.picp95 is not None:
                    by_day.setdefault(fold.day, []).append(fold.picp95)
            ci = block_bootstrap_ci(list(by_day.values()))
            out[axis][value] = {
                "n_folds": len(group),
                "picp50": round(float(np.mean(p50)), 4) if p50 else None,
                "picp95": round(float(np.mean(p95)), 4) if p95 else None,
                "picp95_block_ci": list(ci),
                "regret_median_ct": (
                    round(float(np.median(regrets)), 3) if regrets else None
                ),
                "sharpness95_ct": (
                    round(
                        float(
                            np.mean(
                                [
                                    f.sharpness95_ct
                                    for f in group
                                    if f.sharpness95_ct is not None
                                ],
                            ),
                        ),
                        4,
                    )
                    if any(f.sharpness95_ct is not None for f in group)
                    else None
                ),
            }
    return out


def _overall_metrics(folds: list[ReplayFold]) -> dict[str, Any]:
    ok = [f for f in folds if not f.error]
    pits = [p for f in ok for p in f.pit_values]
    events = event_scores(
        [f.event_p for f in ok if f.event_p is not None],
        [f.event_outcome for f in ok if f.event_p is not None],
    )
    regrets = [f.regret_ct for f in ok if f.regret_ct is not None]
    nets = [f.net_benefit_ct for f in ok if f.net_benefit_ct is not None]
    p50 = [f.picp50 for f in ok if f.picp50 is not None]
    p95 = [f.picp95 for f in ok if f.picp95 is not None]
    sharp = [f.sharpness95_ct for f in ok if f.sharpness95_ct is not None]
    return {
        "n_folds": len(folds),
        "n_scored": len(ok),
        "n_failed": len(folds) - len(ok),
        "mae_q50_ct": (
            round(
                float(np.mean([f.mae_q50_ct for f in ok if f.mae_q50_ct is not None])),
                4,
            )
            if any(f.mae_q50_ct is not None for f in ok)
            else None
        ),
        "picp50": round(float(np.mean(p50)), 4) if p50 else None,
        "picp95": round(float(np.mean(p95)), 4) if p95 else None,
        "sharpness95_ct": round(float(np.mean(sharp)), 4) if sharp else None,
        "pit_mean": round(float(np.mean(pits)), 4) if pits else None,
        "event_brier": events["event_brier"],
        "ece": events["ece"],
        "reliability_bins": events["bins"],
        "net_benefit_ct_median": round(float(np.median(nets)), 3) if nets else None,
        "regret_median_ct": round(float(np.median(regrets)), 3) if regrets else None,
    }


def _manifest_md_line(manifest: Any) -> str:
    """Abnahme-Manifest als Lesezeile (M2) — ohne Hash kein Beleg."""
    if not isinstance(manifest, dict):
        return "- Abnahme-Manifest: fehlt (Lauf ohne Manifest)."
    holdout = manifest.get("holdout") or "—"
    sha = manifest.get("sha256") or "kein Hash — kein Abnahmebeweis"
    size = manifest.get("bytes")
    size_text = "—" if size is None else f"{size} Bytes"
    role = manifest.get("role") or "—"
    note = manifest.get("frozen_note") or ""
    line = f"- Bestand: {holdout} · SHA-256: {sha} · {size_text} · Rolle: {role}."
    return f"{line} {note}" if note else line


def write_replay_report(result: dict[str, Any], out_dir: Path) -> tuple[Path, Path]:
    """Maschinenlesbaren Report (JSON) + Lesefassung (Markdown) schreiben."""

    def _fmt(value: float | None, digits: int = 3) -> str:
        return "—" if value is None else f"{value:.{digits}f}".replace(".", ",")

    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "report.json"
    json_path.write_text(
        json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    overall = result["overall"]
    margins = result["margins"]
    lines = [
        "# Replay-Bericht (A21-B5.3, #213)",
        "",
        f"- Stand: Seed {result['seed']}, Rolle {result['role']}, "
        f"{overall['n_folds']} Folds ({overall['n_failed']} fehlgeschlagen).",
        f"- Operator: {result['operator']} — Dateneingänge strikt vor dem "
        "Fold-Ursprung.",
        "- Akzeptanzmargen waren vor dem Lauf festgelegt (REPLAY_ACCEPTANCE).",
        "",
        "## Abnahme-Manifest",
        "",
        _manifest_md_line(result.get("acceptance_manifest")),
        "",
        "## Gesamt",
        "",
        f"- q50-MAE {_fmt(overall['mae_q50_ct'])} ct · PICP50 "
        f"{_fmt(overall['picp50'])} · PICP95 {_fmt(overall['picp95'])} · "
        f"PI95-Breite {_fmt(overall['sharpness95_ct'])} ct",
        f"- Ereignis-Brier {_fmt(overall['event_brier'])} · ECE "
        f"{_fmt(overall['ece'])} · PIT-Mittel {_fmt(overall['pit_mean'])}",
        f"- Nettonutzen (Median) {_fmt(overall['net_benefit_ct_median'])} ct · "
        f"Regret (Median) {_fmt(overall['regret_median_ct'])} ct",
        "",
        "## Akzeptanzmargen",
        "",
        "| Marge | Wert | Urteil |",
        "|---|---|---|",
    ]
    for name, item in margins["margins"].items():
        lines.append(
            f"| {name} | {item['note']} | {'erfüllt' if item['ok'] else 'NICHT erfüllt'} |"
        )
    lines += [
        "",
        f"Gesamturteil: **{'erfüllt' if margins['ok'] else 'NICHT erfüllt'}**",
        "",
    ]

    lines += [
        "## Slices",
        "",
    ]
    for axis, groups in result["slices"].items():
        lines.append(f"### {axis}")
        lines.append("")
        lines.append("| Slice | Folds | PICP50 | PICP95 | KI (Tag) | Regret Ø |")
        lines.append("|---|---|---|---|---|---|")
        for value, item in groups.items():
            ci = item["picp95_block_ci"]
            ci_text = f"[{_fmt(ci[0])}–{_fmt(ci[1])}]" if ci[0] is not None else "—"
            lines.append(
                f"| {value} | {item['n_folds']} | {_fmt(item['picp50'])} | "
                f"{_fmt(item['picp95'])} | {ci_text} | "
                f"{_fmt(item['regret_median_ct'])} |",
            )
        lines.append("")
    gate = result["gate_comparison"]
    lines += [
        "## Gate-Vergleich (bisher gemischtes Gate vs. Vertragskohorte)",
        "",
        f"- Folds mit Empfehlung: {gate['n_decisions']} — davon nach bisher "
        f"gemischtem Gate freigegeben: {gate['legacy_calibrated']} (n="
        f"{gate['legacy_gate_n']}), nach Vertragskohorten-Gate: "
        f"{gate['new_calibrated']}.",
        f"- Abweichungen alt≠neu: {gate['divergences']} (Althistorie darf eine "
        "neue Kohorte nicht rückwirkend freigeben).",
        "",
        "## Grenzen",
        "",
        f"- {result['limits']}",
        "",
    ]
    md_path = out_dir / "report.md"
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path
