// U8: Das Prognose-Modell des Labors — bereichsspezifische Ableitung.
//
// Vorher rechnete die Root (Dashboard.tsx) Scores, Tagesreihen, Bänder und
// Kalibrierung aus und reichte ~20 fertige Werte als Props herein. Seit U8
// besitzt die Labor-View ihr Modell: Sie holt den Rohstoff aus dem
// OverviewContext (stats/summary, forecast, series) und rechnet hier.
// ε-Handlungsschwelle und Tagesindex bleiben Ansichtszustand der Labor-View.
import { useMemo } from "react";
import { rowOutcome, scoreRows, segments, type StatsSummary } from "../data";
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
    | "spanHours"
  >,
  eps: number,
  labDayIdx: number,
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
          name: "Modell-Median (q50)",
          color: "#38bdf8",
          pts: modelPoints.filter(
            (p): p is { x: number; y: number } =>
              p.y !== null && Number.isFinite(p.y),
          ),
        },
      ]
    : [];
  const fanBand95 = forecastPoints.length
    ? [
        {
          name: "95-%-Band (q025–q975)",
          color: "rgba(56, 189, 248, 0.12)",
          pts: forecastPoints
            .filter((p) => p.q025 !== null && p.q975 !== null)
            .map((p) => ({
              x: Date.parse(p.timestamp),
              yLow: p.q025!,
              yHigh: p.q975!,
            })),
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

  // --- B4 Workshop Dynamic Calculations ---
  const labData: StatsSummary["backtest"] | undefined =
    ov.statsSummaryRes.data?.backtest;
  // Schicht-A-Anker aus dem Backtest-Report (TANKAPP_DECISION_HOUR, Default
  // 12) — alle Werkstatt-Texte folgen dem echten Wert, nie einem Hardcode.
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
      always = 0,
      regretEur = 0,
      n = 0,
      sPos = 0,
      pSum = 0;
    for (const { score: sc } of labScores) {
      smart += sc.sum_smart_eur;
      commit += sc.sum_commit_eur;
      bestVal += sc.sum_best_eur;
      always += sc.sum_always_eur;
      regretEur += sc.avg_regret_eur * sc.n;
      n += sc.n;
      sPos += sc.n * sc.hit_freq;
      pSum += sc.p_avg * sc.n;
    }
    return {
      smart,
      commit,
      best: bestVal,
      always,
      regretEur: n ? regretEur / n : 0,
      n,
      hitFreq: n ? sPos / n : 0,
      pAvg: n ? pSum / n : 0,
      potShare: bestVal > 0 ? smart / bestVal : 0,
    };
  }, [labScores]);

  const calibPoints = labData?.calibration || [];
  const liveReliability = ov.statsSummaryRes.data?.live_advice?.reliability || [];
  const livePointsForChart = liveReliability
    .filter((b) => b.empirical_hit_rate !== null && b.count > 0)
    .map((b) => ({
      p: b.mean_p,
      hit: b.empirical_hit_rate!,
      n: b.count,
    }));

  const calibErr = useMemo(() => {
    if (!calibPoints.length) return NaN;
    return (
      calibPoints.reduce((a, c) => a + Math.abs(c.hit - c.p), 0) /
      calibPoints.length
    );
  }, [calibPoints]);

  const labStationId =
    ov.selected?.station_id || labData?.stations[0]?.id || "";
  const labRows = labData?.evalRows[labStationId] || [];
  const labModel = labData?.models[labStationId];
  const activeLabDayRow =
    labRows[Math.min(Math.max(labDayIdx, 0), Math.max(0, labRows.length - 1))];
  const activeLabOutcome = activeLabDayRow
    ? rowOutcome(activeLabDayRow, eps, ov.liters)
    : null;

  const labDayClass = activeLabDayRow?.cls ?? 0;
  const labSaves = labModel
    ? labDayClass === 0
      ? labModel.savesWk
      : labModel.savesWe
    : [];
  const labPredHour = labModel
    ? labDayClass === 0
      ? labModel.predWk
      : labModel.predWe
    : 19;
  const labMu = labModel
    ? labDayClass === 0
      ? labModel.muWk
      : labModel.muWe
    : 1.5;

  return {
    f,
    metrics,
    horizonDays,
    observations,
    modelSeries,
    fanBand80,
    fanBand95,
    forecastMarks,
    forecastWindow,
    labData,
    anchorHour,
    anchorLabel,
    labTotals,
    calibPoints,
    calibErr,
    livePointsForChart,
    labRows,
    labModel,
    activeLabDayRow,
    activeLabOutcome,
    labDayClass,
    labSaves,
    labPredHour,
    labMu,
  };
}
