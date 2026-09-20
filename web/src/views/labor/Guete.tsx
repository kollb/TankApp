// B5 Sub-Tab: Güte & Kalibrierung — Rolling-PICP, Reliability, Brier, Backtest, Heatmaps
import { useEffect, useMemo, useRef, useState } from "react";
import { InfoTooltip, Empty } from "../../components/ui";
import { LoadError } from "../../components/LoadError";
import { SkeletonChart } from "../../components/Skeleton";
import { CalibChart } from "../../components/LabCharts";
import { HeatmapGrid } from "../../components/HeatmapGrid";
import { calibChartAlt } from "../../chartAlt";
import {
  HEATMAP_WEEKS,
  centPerLiter,
  deNumber,
  deTrimmed,
  euro,
  percentLabel,
  pitCalibrationCandidateLine,
  pitCalibrationLedgerBrierLine,
  pitCalibrationStatus,
  PIT_CALIBRATION_NO_CANDIDATE,
  windowsUsedLine,
  type HeatmapBasis,
} from "../../data";
import { labSection, type LabSectionId } from "../../lab";
import { useOverview } from "../../state/overview";
import { useLaborModel } from "../laborModel";
import { ForTheCurious, LabBlock, ReadingAid, SelfCheck, ThreeSentences } from "./components";

export function GueteView({
  focusSection,
  onFocusHandled,
}: {
  focusSection: LabSectionId | null;
  onFocusHandled: () => void;
}) {
  const ov = useOverview();
  const {
    activeCity,
    forecast,
    heatmap,
    heatmapBasis,
    heatmapBasisActive,
    heatmapKind,
    heatmapWeeks,
    refreshNow,
    setHeatmapBasis,
    setHeatmapKind,
    setHeatmapWeeks,
    statsSummaryRes,
    selection,
  } = ov;

  const [eps] = useState(1.0);
  const [labDayIdx] = useState(13);
  const { calibPoints, livePointsForChart, metrics, epsScan, labData, labTotals } = useLaborModel(
    ov,
    eps,
    labDayIdx,
  );

  const [open, setOpen] = useState<Record<LabSectionId, boolean>>({
    prognose: false,
    sicherheit: true,
    stationen: false,
    lernen: false,
    glossar: false,
    spielplatz: false,
  });
  const blockRefs = useRef<Record<string, HTMLElement | null>>({});

  const toggle = (id: LabSectionId) =>
    setOpen((current) => ({ ...current, [id]: !current[id] }));
  const jumpTo = (id: LabSectionId) => {
    setOpen((current) => ({ ...current, [id]: true }));
    blockRefs.current[id]?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (!focusSection) return;
    if (focusSection === "sicherheit") {
      jumpTo(focusSection);
      onFocusHandled();
    }
  }, [focusSection, onFocusHandled]);

  const advice = statsSummaryRes.data?.live_advice ?? null;
  const windowsLine = windowsUsedLine(advice);
  const quality = statsSummaryRes.data?.quality_metrics ?? null;

  const selStations = selection.data?.stations ?? [];
  const rankStability = useMemo(() => {
    const values = selStations
      .map((r) => r.rank_std)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }, [selStations]);
  const breakCount = selStations.length ? selStations.filter((r) => r.break_flag === true).length : null;
  const stationCount = selStations.length;
  const breakStats = selStations
    .map((r) => r.break_stat)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const breakMax = breakStats.length ? Math.max(...breakStats) : null;
  const cusumThreshold = statsSummaryRes.data?.quality_metrics?.cusum_drift?.threshold ?? 2.0;

  const modelCalibration = forecast.data?.calibration ?? null;
  const calibrationCandidate = (forecast.data as any)?.calibration_candidate?.["24h"] ?? null;
  const calibrationValidation = calibrationCandidate?.validation ?? null;
  const calibrationActive = forecast.data?.calibrated === true;
  const calibErr = useMemo(() => {
    if (!calibPoints.length) return null;
    const err = calibPoints.reduce((sum, p) => sum + Math.abs(p.p - p.hit), 0) / calibPoints.length;
    return err;
  }, [calibPoints]);

  return (
    <div className="grid grid-cols-1 gap-3">
      <LabBlock
        id="sicherheit"
        open={open.sicherheit}
        onToggle={() => toggle("sicherheit")}
        headline="2 · Sicherheit"
        question={labSection("sicherheit").question}
        blockRef={(node) => {
          blockRefs.current.sicherheit = node;
        }}
      >
        <ThreeSentences
          sentences={[
            "Ein Prozentwert ist ein Anteil: „82 %“ heißt „in 82 von 100 ähnlichen Fällen traf es zu“.",
            "Die App zählt das an ihren eigenen abgerechneten Empfehlungen nach — sie schätzt es nicht.",
            "Die Worte sind feste Stufen derselben Skala: ab 75 % „ziemlich sicher“, ab 55 % „eher sicher“, darunter „unsicher“.",
          ]}
        />
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs font-semibold text-slate-200">PIT-Rekalibrierung der Prognose</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            {pitCalibrationStatus(calibrationActive, modelCalibration?.status)}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {pitCalibrationLedgerBrierLine(advice?.brier_all_by_calibration)}
          </p>
          {calibrationCandidate ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {pitCalibrationCandidateLine({
                status: calibrationCandidate.status,
                nPit: calibrationCandidate.n_pit,
                rawPicp95: calibrationValidation?.raw_picp95,
                calibratedPicp95: calibrationValidation?.calibrated_picp95,
                picpReleaseGate: calibrationValidation?.picp_release_gate,
                active: calibrationActive,
              })}
            </p>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{PIT_CALIBRATION_NO_CANDIDATE}</p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Versprochen gegen eingetroffen</p>
            <CalibChart
              points={calibPoints}
              livePoints={livePointsForChart}
              ariaLabel="Versprochen gegen eingetroffen"
              ariaDescription={calibChartAlt({ points: calibPoints, livePoints: livePointsForChart })}
            />
            <ReadingAid
              headline={
                Number.isFinite(calibErr)
                  ? `Waagerecht das Versprechen, senkrecht das Eingetroffene. Ø Abweichung: ${percentLabel((calibErr as number) * 100, 1)}`
                  : "Noch keine Punkte — die Kalibrierung entsteht aus abgerechneten Empfehlungen."
              }
              text="Punkte auf der Diagonalen = ehrlich versprochen. Darunter zu viel versprochen, darüber zu vorsichtig."
            />
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-xs font-semibold text-slate-200">Was die App selbst prüft</p>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-300">
                <li>
                  <strong className="text-slate-100">Band-Trefferquote (PICP 95):</strong>{" "}
                  {metrics?.picp95_pct != null
                    ? percentLabel(metrics.picp95_pct, 1)
                    : quality?.picp_95 != null
                      ? percentLabel(quality.picp_95, 1)
                      : "—"}{" "}
                  der echten Preise lagen im 95-%-Band (Ziel 90–98 %).
                </li>
                <li>
                  <strong className="text-slate-100">Prognose-Fehler (MASE):</strong>{" "}
                  {metrics?.mase != null
                    ? deTrimmed(metrics.mase, 2)
                    : quality?.mase_sprungfrei != null
                      ? deTrimmed(quality.mase_sprungfrei, 2)
                      : "—"}{" "}
                  — unter 1,0 heißt besser als Naive.
                </li>
                <li>
                  <strong className="text-slate-100">Rang-Streuung:</strong>{" "}
                  {rankStability != null ? (
                    <>
                      {deNumber(rankStability, 2)} Plätze im Schnitt — wie stark sich die Reihenfolge verschiebt.
                    </>
                  ) : (
                    <>noch keine Selektion geladen.</>
                  )}
                </li>
                <li>
                  <strong className="text-slate-100">Strukturbruch (CUSUM):</strong>{" "}
                  {breakCount != null ? (
                    <>
                      {breakCount} von {stationCount} Stationen mit Bruch-Flag
                      {breakMax != null ? ` (höchste ${deNumber(breakMax, 2)}, Schwelle ${deNumber(cusumThreshold, 2)})` : ""}
                      .
                    </>
                  ) : (
                    <>noch keine Selektion geladen.</>
                  )}
                </li>
                <li>
                  <strong className="text-slate-100">Mittlerer Fehler (MAE):</strong>{" "}
                  {metrics?.mae_ct != null
                    ? `${deTrimmed(metrics.mae_ct, 2)} ct/L aus ${metrics.points} Punkten.`
                    : "noch keine Vergleichspunkte — Roll-Backtest füllt sie."}
                </li>
              </ul>
            </div>
            {windowsLine && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-xs font-semibold text-slate-200">Fensterbilanz</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{windowsLine}</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs font-semibold text-slate-200">
            Backtest-Bilanz (außerhalb der Stichprobe: {labData?.daysEval ?? "—"} Tage)
          </p>
          {labTotals.n === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Ohne Backtest-Tage keine Bilanz: Die App rechnet sie erst, wenn genug echte Preishistorie da ist.
            </p>
          ) : (
            <>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-900/70 p-2.5">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Regel-Ergebnis</p>
                  <p className="font-mono text-lg font-bold text-emerald-300">{euro(labTotals.smart)} €</p>
                </div>
                <div className="rounded-lg bg-slate-900/70 p-2.5">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Orakel</p>
                  <p className="font-mono text-lg font-bold text-slate-100">{euro(labTotals.best)} €</p>
                </div>
                <div className="rounded-lg bg-slate-900/70 p-2.5">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Ø Mehrkosten</p>
                  <p className="font-mono text-lg font-bold text-amber-300">{euro(labTotals.regretEur)} €</p>
                </div>
              </div>
              {epsScan && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-slate-200">Dieselbe Regel, andere Vorsicht</p>
                  <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-slate-300">
                    {epsScan.map((point) => (
                      <li key={point.eps}>
                        ε = {centPerLiter(point.eps, 2)}: <strong className="text-slate-100">{euro(point.smartEur)} €</strong> · warten
                        an {point.waits} von {point.n} Tagen
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-200">Wochenrhythmus: Wann ist es wo billig?</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1 text-slate-400">
                Art
                <select
                  aria-label="Heatmap-Art"
                  value={heatmapKind}
                  onChange={(e) => setHeatmapKind(e.target.value as "level" | "probability")}
                  className="ml-1 rounded-lg border border-slate-700 bg-slate-900 p-1 text-slate-200"
                >
                  <option value="level">Preisniveau</option>
                  <option value="probability">Günstig-Chance</option>
                </select>
              </label>
              <label className="flex items-center gap-1 text-slate-400">
                Wochen
                <select
                  aria-label="Heatmap-Zeitraum"
                  value={heatmapWeeks}
                  onChange={(e) => setHeatmapWeeks(Number(e.target.value))}
                  className="ml-1 rounded-lg border border-slate-700 bg-slate-900 p-1 text-slate-200"
                >
                  {HEATMAP_WEEKS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
              {heatmapBasisActive && (
                <label className="flex items-center gap-1 text-slate-400">
                  Basis
                  <select
                    aria-label="Vergleichs-Basis"
                    value={heatmapBasis}
                    onChange={(e) => setHeatmapBasis(e.target.value as HeatmapBasis)}
                    className="ml-1 rounded-lg border border-slate-700 bg-slate-900 p-1 text-slate-200"
                  >
                    <option value="overall">Gesamtmedian</option>
                    <option value="hour">gleiche Stunde</option>
                  </select>
                </label>
              )}
            </div>
          </div>
          {heatmap.error || heatmap.data?.error_code ? (
            <div className="mt-3">
              <LoadError
                errorCode={heatmap.data?.error_code || heatmap.errorCode}
                fallback="Die Heatmap konnte nicht geladen werden."
                onRetry={refreshNow}
                compact
              />
            </div>
          ) : heatmap.data ? (
            <div className="mt-3">
              <HeatmapGrid heatmap={heatmap.data} />
              <ReadingAid
                headline="Zeilen sind Wochentage, Spalten sind Stunden (06–24)."
                text="Grün heißt billiger als Vergleichswert, rot teurer. „dünn“ heißt: Zu wenige Preise in dieser Zelle."
              />
            </div>
          ) : heatmap.pending ? (
            <div className="mt-3">
              <SkeletonChart height="h-48" label="Heatmap wird berechnet" />
            </div>
          ) : (
            <div className="mt-3">
              <Empty>Noch keine Heatmap — sie entsteht aus mindestens zwei vollständigen Wochen echter Preise.</Empty>
            </div>
          )}
        </div>

        <ForTheCurious>
          <p>
            Der Brier-Score ist der mittlere quadratische Fehler der Prozent-Angaben (0 = perfekt, 0,25 = Raten). Das
            M7-Gate ist die Führerschein-Prüfung der App: erst ab 100 abgerechneten Empfehlungen, deren Brier-Intervall
            unter beiden Referenzen liegt, zeigt sie Prozente.
          </p>
          <div className="rounded-lg bg-slate-950/70 p-2 font-mono text-xs text-slate-300">
            Brier = mean((p − o)²), o ∈ {"{"}0, 1{"}"} · Gate: n ≥ {advice?.min_recommendations ?? 100} ∧
            Obergrenze(Brier-KI) &lt; min(Basis, Klima)
          </div>
        </ForTheCurious>
        <SelfCheck
          question="Was wäre ein schlechtes Zeichen in diesem Diagramm?"
          answer="Punkte deutlich unter der Diagonalen: Dort wurde viel Sicherheit versprochen, aber selten getroffen — die App wäre übermütig. Punkte darüber sind unschön, aber harmlos: zu vorsichtig."
        />
      </LabBlock>
    </div>
  );
}
