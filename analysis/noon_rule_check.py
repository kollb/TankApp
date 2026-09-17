#!/usr/bin/env python3
"""
TankApp – 12-Uhr-Regel-Check: Zeigt sich das Gesetz in den echten Daten?

Seit 2026-04-01 dürfen Tankstellen Preise nur noch einmal täglich um
12:00 Uhr erhöhen; Senkungen sind jederzeit erlaubt (engine/config.py:
``price_law_local``). Das Modell trägt der Regel schon Rechnung
(Mittags-Schritt im Strukturmodell, PAVA-Projektion, Zähler
``law_rise_outside_noon``) — dieses Skript prüft die andere Seite: **ob
die beobachteten Preise die Regel überhaupt zeigen**, also ob Aussagen wie
„günstigste Stunde 20–22 Uhr" aus echtem, aktuellem Verhalten stammen
oder aus Daten, die noch das Vorgesetzes-Muster tragen
(Nutzer-Rückfrage 17.09.2026).

Vier empirische Fragen, getrennt nach Zeitraum (vor/nach Gesetzesbeginn):

  1. Erhöhungen: Wie viele Preis-Anstiege (≥ Schwelle, Default 1 ct wie
     die Engine) passieren am 12-Uhr-Punkt, wie viele außerhalb?
     Intervalle, die länger als --max-gap-min sind, sind nicht bewertbar
     (der Sprung könnte legal um 12:00 in der Lücke liegen) und werden
     separat ausgewiesen statt als Verstoß gezählt.
  2. Tages-Minimum: In welcher Stunde (Berlin) liegt der Tagestiefpunkt —
     vorher vs. nachher? Unter der Regel müsste er Richtung späten
     Vormittag wandern; bleibt er bei 20–22 Uhr, trägt der Bestand noch
     das alte Muster.
  3. Tages-Maximum: müsste sich unter der Regel auf 12–18 Uhr richten.
  4. Mittagsschritt: Medianer Sprung über die 12-Uhr-Kante (letzte
     Beobachtung davor vs. erste danach, gleiche Station, knapper Abstand).

Eingabe sind dieselben CSVs wie bei station_selection.py
(data-tools/export_influx.py / fetch_history.py). Kein Modell, kein
Schätzen — nur Zählen auf den Beobachtungen.

Aufruf::

    python analysis/noon_rule_check.py --data data/export_e10.csv --fuel E10

Ausgabe: Konsole + Markdown-Report (Default data/analysis/report_noon_rule.md).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

# Repo-Wurzel UND analysis/ auf den Pfad: station_selection importiert
# engine.personalization (geteilter Default, O2) — das schlägt fehl, wenn
# das Skript aus einem anderen Arbeitsverzeichnis gestartet wird.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from station_selection import load_prices  # noqa: E402

BERLIN = ZoneInfo("Europe/Berlin")
LAW_DEFAULT = "2026-04-01"

# Tagesstunden-Blöcke für die Min/Max-Verteilung (Berliner Wanduhr).
BLOCKS = [(0, 6, "0–6"), (6, 12, "6–12"), (12, 18, "12–18"), (18, 24, "18–24")]


def _prepare(paths: list[Path], fuel: str) -> pd.DataFrame:
    """Beobachtungen laden und um Berlin-Kalendertag/-Stunde ergänzen."""
    df = load_prices(paths, fuel).copy()
    df["ts"] = pd.to_datetime(df["timestamp"], utc=True)
    df["local"] = df["ts"].dt.tz_convert(BERLIN)
    df["day"] = df["local"].dt.date
    df["hour"] = df["local"].dt.hour
    return df.sort_values(["station_id", "ts"], kind="stable").reset_index(drop=True)


def rise_check(
    df: pd.DataFrame,
    law_day: pd.Timestamp,
    threshold_eur: float,
    max_gap: pd.Timedelta,
    noon_tol: pd.Timedelta,
) -> pd.DataFrame:
    """Anstiege zwischen aufeinanderfolgenden Beobachtungen je Station.

    Erlaubt ab Gesetzesbeginn: Das Beobachtungsintervall berührt das
    12-Uhr-Fenster (± noon_tol) — dort *darf* erhöht werden. Zu lange
    Intervalle sind „nicht bewertbar" (die Erhöhung könnte legal in der
    Lücke passiert sein) und zählen weder als Verstoß noch als Beleg.
    """
    rows = []
    for station_id, g in df.groupby("station_id", sort=False):
        if len(g) < 2:
            continue
        g = g.reset_index(drop=True)
        prev_price = g["price"].iloc[:-1].to_numpy(dtype=float)
        new_price = g["price"].iloc[1:].to_numpy(dtype=float)
        prev_ts = g["ts"].iloc[:-1].reset_index(drop=True)
        new_ts = g["ts"].iloc[1:].reset_index(drop=True)
        prev_local = g["local"].iloc[:-1].reset_index(drop=True)
        new_local = g["local"].iloc[1:].reset_index(drop=True)
        risen = (new_price - prev_price) >= threshold_eur
        if not risen.any():
            continue
        # 12-Uhr-Punkte um das Intervall herum: der des Tages der alten und
        # der des Tages der neuen Beobachtung (Intervalle über Mitternacht
        # oder genau über Mittag werden so beide abgedeckt).
        prev_day = prev_local.dt.normalize()
        new_day = new_local.dt.normalize()
        touches = (
            (prev_ts <= prev_day + pd.Timedelta(hours=12) + noon_tol)
            & (new_ts >= prev_day + pd.Timedelta(hours=12) - noon_tol)
        ) | (
            (prev_ts <= new_day + pd.Timedelta(hours=12) + noon_tol)
            & (new_ts >= new_day + pd.Timedelta(hours=12) - noon_tol)
        )
        frame = pd.DataFrame(
            {
                "station_id": station_id,
                "ts": new_ts,
                "local": new_local,
                "delta_ct": (new_price - prev_price) * 100,
                "gap_min": (new_ts - prev_ts) / pd.Timedelta(minutes=1),
                "touches_noon": touches,
                "assessable": (new_ts - prev_ts) <= max_gap,
                "after_law": new_local >= law_day,
            }
        )
        rows.append(frame[risen])
    if not rows:
        return pd.DataFrame(
            columns=[
                "station_id",
                "ts",
                "local",
                "delta_ct",
                "gap_min",
                "touches_noon",
                "assessable",
                "after_law",
            ]
        )
    return pd.concat(rows, ignore_index=True)


def day_extrema(df: pd.DataFrame, min_obs: int, min_hours: int) -> pd.DataFrame:
    """Je Station × Kalendertag: Stunde des Tagestiefs/-hochs (erste
    Beobachtung auf dem Extremwert) und die Spanne — nur Tage mit genug
    Substanz, sonst misst man die Lage der Polling-Lücken statt des
    Preismusters."""
    rows = []
    for (station_id, day), g in df.groupby(["station_id", "day"], sort=True):
        if len(g) < min_obs or g["hour"].nunique() < min_hours:
            continue
        prices = g["price"].to_numpy(dtype=float)
        hours = g["hour"].to_numpy()
        lo = int(np.nanargmin(prices))
        hi = int(np.nanargmax(prices))
        rows.append(
            {
                "station_id": station_id,
                "day": day,
                "min_hour": int(hours[lo]),
                "max_hour": int(hours[hi]),
                "span_ct": (float(np.nanmax(prices)) - float(np.nanmin(prices))) * 100,
                "obs": len(g),
            }
        )
    return pd.DataFrame(rows)


def noon_steps(df: pd.DataFrame, max_gap: pd.Timedelta) -> pd.DataFrame:
    """Sprung über die 12-Uhr-Kante: letzte Beobachtung vor 12:00 vs. erste
    danach, gleiche Station, gleicher Kalendertag, knapper Abstand."""
    rows = []
    for (station_id, day), g in df.groupby(["station_id", "day"], sort=True):
        g = g.sort_values("ts", kind="stable")
        before = g[g["hour"] < 12]
        after = g[g["hour"] >= 12]
        if before.empty or after.empty:
            continue
        b, a = before.iloc[-1], after.iloc[0]
        if a["ts"] - b["ts"] > max_gap:
            continue
        rows.append(
            {
                "station_id": station_id,
                "day": day,
                "step_ct": (float(a["price"]) - float(b["price"])) * 100,
            }
        )
    return pd.DataFrame(rows)


def _block_hour(hour: int) -> str:
    for start, end, label in BLOCKS:
        if start <= hour < end:
            return label
    return "?"


def _md_table(headers: list[str], rows: list[list[str]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join(["---"] * len(headers)) + "|",
    ]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join(lines)


def _extremum_table(days: pd.DataFrame, col: str) -> str:
    """Verteilung der Extrem-Stunden je Zeitraum (Anteile in % + Lagen)."""
    rows = []
    for period, g in days.groupby("period", sort=True):
        row = [period]
        for _, _, label in BLOCKS:
            share = (g[col].map(_block_hour) == label).mean() * 100
            row.append(f"{share:.0f} %")
        row.append(str(len(g)))
        row.append(f"{g[col].median():.0f}")
        row.append(f"{g['span_ct'].median():.1f}")
        rows.append(row)
    return _md_table(
        [
            "Zeitraum",
            *[f"Extrem {label}" for _, _, label in BLOCKS],
            "n Tage",
            "Median-Stunde",
            "Spanne median (ct)",
        ],
        rows,
    )


def build_report(
    df: pd.DataFrame,
    rises: pd.DataFrame,
    days: pd.DataFrame,
    steps: pd.DataFrame,
    law_day: pd.Timestamp,
    threshold_eur: float,
) -> str:
    law_label = law_day.date().isoformat()
    lines = [
        "# 12-Uhr-Regel-Check",
        "",
        f"Erzeugt aus {df['station_id'].nunique()} Stationen, "
        f"{df['day'].nunique()} Kalendertagen "
        f"({df['day'].min().isoformat()} bis {df['day'].max().isoformat()}), "
        f"{len(df)} Beobachtungen. Gesetzesbeginn: {law_label}.",
        "",
        "Frage: Zeigen die echten Preise die 12-Uhr-Regel (Erhöhung nur um "
        "12:00, danach nur Senkungen) — oder trägt der Bestand noch das "
        "Vorgesetzes-Muster (abends günstig, mehrere Erhöhungen pro Tag)?",
        "",
        "## 1 · Anstiege am 12-Uhr-Punkt vs. außerhalb",
        "",
    ]
    if rises.empty:
        lines.append(f"Keine Anstiege ≥ {threshold_eur * 100:.1f} ct gefunden.")
    else:
        assess = rises[rises["assessable"]]
        lines += [
            f"Anstiege ≥ {threshold_eur * 100:.1f} ct zwischen zwei "
            "Beobachtungen (Intervalle über der Lücken-Grenze zählen nicht "
            "mit — dort ist der Sprungzeitpunkt unbekannt):",
            "",
        ]
        rows = []
        for after, g in assess.groupby("after_law"):
            label = f"ab {law_label}" if after else f"vor {law_label}"
            inside = int(g["touches_noon"].sum())
            rows.append(
                [
                    label,
                    str(len(g)),
                    f"{inside} ({inside / len(g) * 100:.0f} %)",
                    f"{len(g) - inside} ({(len(g) - inside) / len(g) * 100:.0f} %)",
                ]
            )
        lines.append(
            _md_table(
                [
                    "Zeitraum",
                    "Anstiege",
                    "davon am 12-Uhr-Punkt",
                    "außerhalb",
                ],
                rows,
            )
        )
        not_assess = rises[~rises["assessable"]]
        if len(not_assess):
            lines += [
                "",
                f"Nicht bewertbar (Lücke zu groß): {len(not_assess)} Anstiege.",
            ]
    lines += [
        "",
        "Unter der Regel müsste die Zeile „ab …“ nahe 100 % am 12-Uhr-Punkt "
        "stehen. Deutlich weniger heißt: In den Daten wird weiter im Tageslauf"
        " erhöht — Regel erodiert, ältere Mischbestände dominieren, oder die"
        " Zeitstempel tragen Artefakte.",
        "",
        "## 2 · Stunde des Tagestiefs („billigste Stunde“)",
        "",
    ]
    if days.empty:
        lines.append("Keine auswertbaren Stationstage (Daten-Gates).")
    else:
        lines += _extremum_table(days, "min_hour").splitlines()
        lines += [
            "",
            "Erwartung unter der Regel: Das Tief wandert Richtung Block 6–12"
            " (Ende des Abtrags vor der Mittagserhöhung). Ein verharrendes"
            " Abend-Tief (18–24) ist das Vorgesetzes-Muster — so ein Befund"
            " erklärt Panels wie „Günstigste Stunde 20–22 Uhr“ aus alten"
            " Daten, nicht aus heutigem Verhalten.",
            "",
            "## 3 · Stunde des Tageshochs",
            "",
        ]
        lines += _extremum_table(days, "max_hour").splitlines()
        lines += [
            "",
            "Erwartung unter der Regel: Das Hoch konzentriert sich auf"
            " 12–18 (direkt nach der Mittagserhöhung).",
            "",
            "## 4 · Sprung über die 12-Uhr-Kante",
            "",
        ]
    if not days.empty:
        if steps.empty:
            lines.append("Keine verwertbaren 12-Uhr-Kanten (Lücken-Grenze).")
        else:
            rows = []
            for period, g in steps.groupby("period", sort=True):
                share = (g["step_ct"] >= 2).mean() * 100
                rows.append(
                    [
                        period,
                        str(len(g)),
                        f"{g['step_ct'].median():.1f}",
                        f"{g['step_ct'].max():.1f}",
                        f"{share:.0f} %",
                    ]
                )
            lines += [
                "Preisschritt letzte Beobachtung vor 12:00 → erste danach"
                " (gleiche Station, knapper Abstand):",
                "",
                _md_table(
                    [
                        "Zeitraum",
                        "Kanten",
                        "Schritt median (ct)",
                        "Schritt max (ct)",
                        "davon ≥ 2 ct",
                    ],
                    rows,
                ),
            ]
    lines += [
        "",
        "## Einordnung",
        "",
        "- „vor …“ ist der Referenzrahmen aus demselben Bestand — kein"
        " Normwert, nur der Kontrast innerhalb der eigenen Daten.",
        "- Ein Stationstag zählt nur mit genug Beobachtungen über genug"
        " Stunden (Gates --min-obs/--min-hours); sonst würden Polling-Lücken"
        " als Preismuster erscheinen.",
        "- Das Skript liest Beobachtungen und schätzt nichts: Keine Aussage"
        " darüber hinaus, was die Zeitstempel hergeben.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(
        description="TankApp – 12-Uhr-Regel-Check auf echten Preisdaten"
    )
    ap.add_argument("--data", nargs="+", type=Path, required=True)
    ap.add_argument("--fuel", default="E10")
    ap.add_argument(
        "--law-date",
        default=LAW_DEFAULT,
        help="Beginn der 12-Uhr-Regel, lokaler Kalendertag (engine/config.py "
        "price_law_local). Default: %(default)s",
    )
    ap.add_argument(
        "--rise-threshold-ct",
        type=float,
        default=1.0,
        help="Anstiegs-Schwelle in ct/L (wie die Engine). Default: %(default)s",
    )
    ap.add_argument(
        "--max-gap-min",
        type=float,
        default=120.0,
        help="Ab dieser Beobachtungslücke (Minuten) ist ein Anstieg nicht "
        "mehr bewertbar. Default: %(default)s",
    )
    ap.add_argument(
        "--noon-tol-min",
        type=float,
        default=10.0,
        help="Toleranz ± Minuten um den 12-Uhr-Punkt. Default: %(default)s",
    )
    ap.add_argument(
        "--min-obs",
        type=int,
        default=10,
        help="Mindest-Beobachtungen je Stationstag für Min/Max. Default: %(default)s",
    )
    ap.add_argument(
        "--min-hours",
        type=int,
        default=6,
        help="Mindest-Zahl unterschiedlicher Stunden je Stationstag. "
        "Default: %(default)s",
    )
    ap.add_argument(
        "--report",
        type=Path,
        default=Path("data/analysis/report_noon_rule.md"),
    )
    args = ap.parse_args()

    law_day = pd.Timestamp(args.law_date, tz=BERLIN)
    df = _prepare(args.data, args.fuel)
    if df.empty:
        raise SystemExit("Keine Beobachtungen im Bestand.")
    max_gap = pd.Timedelta(minutes=args.max_gap_min)
    rises = rise_check(
        df,
        law_day,
        threshold_eur=args.rise_threshold_ct / 100,
        max_gap=max_gap,
        noon_tol=pd.Timedelta(minutes=args.noon_tol_min),
    )
    days = day_extrema(df, args.min_obs, args.min_hours)
    steps = noon_steps(df, max_gap)
    if not days.empty:
        day_keys = pd.to_datetime(days["day"].astype(str))
        days["period"] = np.where(
            day_keys >= law_day.tz_localize(None),
            f"ab {law_day.date().isoformat()}",
            f"vor {law_day.date().isoformat()}",
        )
    if not steps.empty:
        step_keys = pd.to_datetime(steps["day"].astype(str))
        steps["period"] = np.where(
            step_keys >= law_day.tz_localize(None),
            f"ab {law_day.date().isoformat()}",
            f"vor {law_day.date().isoformat()}",
        )

    report = build_report(
        df,
        rises,
        days,
        steps,
        law_day,
        threshold_eur=args.rise_threshold_ct / 100,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(report, encoding="utf-8")
    print(report)
    print(f"→ Report: {args.report}")


if __name__ == "__main__":
    main()
