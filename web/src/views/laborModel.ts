// U8: Das Prognose-Modell des Labors — bereichsspezifische Ableitung.
//
// Vorher rechnete die Root (Dashboard.tsx) Scores, Tagesreihen, Bänder und
// Kalibrierung aus und reichte ~20 fertige Werte als Props herein. Seit U8
// besitzt die Labor-View ihr Modell: Sie holt den Rohstoff aus dem
// OverviewContext (stats/summary, forecast, series) und rechnet hier.
//
// Batch 2 (0.74.0) hat das Labor auf drei Blöcke verdichtet: Übrig bleibt,
// was die Kurve in Block 2 und die Fachwerte in Block 3 tragen. Die alten
// Werkstatt-Reihen (ε-Scan, Kalibrierungspunkte, Tageszeilen, Form-Modell)
// sind mit ihren Ansichten entfallen — sie hatten keinen Leser mehr.
import { useMemo } from "react";
import { scoreRows, segments, type StatsSummary } from "../data";
import type { OverviewState } from "../state/overview";

export function useLaborModel(
  ov: Pick<
    OverviewState,
    | "statsSummaryRes"
    | "forecast"
    | "history"
    | "horizon"
    | "liters"
    | "selected"
  >,
  eps: number,
) {
  const f = ov.forecast.data;
  const horizonDays = ov.horizon;
  const forecastPoints =
    (horizonDays === 3
      ? f?.points_3d
      : horizonDays === 7
        ? f?.points_7d
        : f?.points) || [];
  const metrics = f?.metrics;

  const observations = segments(ov.history.data?.points || []);

  const modelPoints = forecastPoints.map((p) => ({
    x: Date.parse(p.timestamp),
    y: p.q50,
  }));
  const modelSeries = modelPoints.length
    ? [
        {
          name: "Erwarteter Preis",
          color: "#38bdf8",
          pts: modelPoints.filter(
            (p): p is { x: number; y: number } =>
              p.y !== null && Number.isFinite(p.y),
          ),
        },
      ]
    : [];
  const fanBand80 = forecastPoints.length
    ? [
        {
          name: "80-%-Band (q10–q90)",
          color: "rgba(56, 189, 248, 0.22)",
          pts: forecastPoints
            .filter(
              (p) =>
                p.q10 !== undefined &&
                p.q10 !== null &&
                p.q90 !== undefined &&
                p.q90 !== null,
            )
            .map((p) => ({
              x: Date.parse(p.timestamp),
              yLow: p.q10!,
              yHigh: p.q90!,
              thin: p.supported === true && (p.support_days ?? Infinity) <= 7,
              supportDays: p.support_days,
            })),
        },
      ]
    : [];

  const forecastWindow: [number, number] | null = modelPoints.length
    ? [modelPoints[0].x, modelPoints[modelPoints.length - 1].x]
    : null;

  const forecastMarks = modelPoints.length
    ? [
        {
          x: modelPoints[0].x,
          color: "#38bdf8",
          label: "Fit-Zeitpunkt",
        },
      ]
    : [];

  // --- Backtest-Anker: die eine Zahl, die den Rechenweg belegt ---
  const labData: StatsSummary["backtest"] | undefined =
    ov.statsSummaryRes.data?.backtest;
  // Schicht-A-Anker aus dem Backtest-Report (TANKAPP_DECISION_HOUR, Default
  // 12) — die Texte folgen dem echten Wert, nie einem Hardcode.
  const anchorHour = labData?.decisionHour ?? 12;
  const anchorLabel = `${String(anchorHour).padStart(2, "0")}:00`;
  const labScores = useMemo(() => {
    if (!labData?.evalRows) return [];
    return Object.entries(labData.evalRows).map(([sid, rows]) => ({
      station_id: sid,
      score: scoreRows(rows, eps, ov.liters, sid),
    }));
  }, [labData, eps, ov.liters]);

  const labTotals = useMemo(() => {
    let smart = 0,
      commit = 0,
      bestVal = 0,
      regretEur = 0,
      n = 0,
      sPos = 0,
      waitN = 0,
      waitHits = 0,
      nowN = 0,
      nowHits = 0;
    for (const { score: sc } of labScores) {
      smart += sc.sum_smart_eur;
      commit += sc.sum_commit_eur;
      bestVal += sc.sum_best_eur;
      regretEur += sc.avg_regret_eur * sc.n;
      n += sc.n;
      sPos += sc.n * sc.hit_freq;
      waitN += sc.n_wait;
      waitHits += (sc.hit_wait ?? 0) * sc.n_wait;
      nowN += sc.n_now;
      nowHits += (sc.hit_now ?? 0) * sc.n_now;
    }
    return {
      smart,
      commit,
      best: bestVal,
      regretEur: n ? regretEur / n : 0,
      n,
      /** Tage mit realisiertem Vorteil — Markt-Basisrate, unabhängig von der Entscheidung. */
      hitFreq: n ? sPos / n : null,
      /** Richtige Entscheidungen der Regel. */
      hitRate: n ? (waitHits + nowHits) / n : null,
      waitN,
      nowN,
      potShare: bestVal > 0 ? smart / bestVal : n ? 0 : null,
    };
  }, [labScores]);

  return {
    f,
    metrics,
    horizonDays,
    observations,
    modelSeries,
    fanBand80,
    forecastWindow,
    forecastMarks,
    labData,
    anchorHour,
    anchorLabel,
    labTotals,
  };
}
