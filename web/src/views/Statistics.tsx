// D1: Views-Schnitt — Werkstatt-Tab. Gemeinsamer Zustand aus der
// Dashboard-Root per typisierten Props; die View rendert, sie entscheidet
// nichts.
import { Activity, BarChart3, Scale } from "lucide-react";
import { HeatmapGrid } from "../components/HeatmapGrid";
import { LoadError } from "../components/LoadError";
import { CellError } from "../components/CellError";
import { DataAgeBanner } from "../components/DataAge";
import { DataReachNote } from "../components/DataReach";
import {
  SkeletonChart,
  SkeletonPanel,
  SkeletonRows,
} from "../components/Skeleton";
import { Badge, Empty, Metric, panel } from "../components/ui";
import { LineChart } from "../components/LineChart";
import {
  CalibChart,
  HistogramBars,
  LabLineChart,
} from "../components/LabCharts";
import {
  HEATMAP_WEEKS,
  autoTimeTicks,
  centPerLiter,
  euro,
  formatHour,
  rowOutcome,
  timeLabel,
  type DataReach,
  type Forecast,
  type Health,
  type Heatmap,
  type HeatmapBasis,
  type Point,
  type ResourceState,
  type Selection,
  type Station,
  type Stations,
  type StatsSummary,
} from "../data";
export interface StatisticsViewProps {
  activeCity: string;
  data: Stations | null;
  stations: Station[];
  selected: Station | undefined;
  best: Station | undefined;
  h: Health | null;
  // Präferenzen der Werkstatt
  spanHours: number;
  horizon: number;
  eps: number;
  labDayIdx: number;
  heatmapKind: string;
  heatmapWeeks: number;
  heatmapBasis: string;
  heatmapBasisActive: boolean;
  setSpanHours: (v: number) => void;
  setHorizon: (v: number) => void;
  setEps: (v: number) => void;
  setLabDayIdx: (v: number) => void;
  setHeatmapKind: (v: "level" | "probability") => void;
  setHeatmapWeeks: (v: number) => void;
  setHeatmapBasis: (v: HeatmapBasis) => void;
  setSelectedId: (v: string) => void;
  // Ressourcen (Einzelpolls der Werkstatt)
  history: ResourceState<{ points: Point[]; error_code: string | null } & DataReach>;
  forecast: ResourceState<Forecast>;
  heatmap: ResourceState<Heatmap>;
  selection: ResourceState<Selection>;
  statsSummaryRes: ResourceState<StatsSummary>;
  // Abgeleitete Werkstatt-Werte
  gateStatus: string;
  m7Line: string | null;
  transitionLine: string;
  stationPhase: Forecast["data_policy"] | null;
  f: any;
  metrics: any;
  horizonDays: number;
  modelSeries: Array<{ name?: string; color: string; pts: Array<{ x: number; y: number }> }>;
  obsWindow: [number, number];
  observations: any[];
  series: any[];
  spanLabel: string;
  livePointsForChart: Array<{ p: number; hit: number; n: number }>;
  fanBand80: any;
  fanBand95: any;
  forecastMarks: any[];
  forecastWindow: any;
  anchorHour: number;
  modelWindows: any[];
  span: number | null;
  liters: number;
  labPredHour: number;
  anchorLabel: string;
  labData: StatsSummary["backtest"] | undefined;
  labRows: any[];
  labScores: any[];
  labTotals: any;
  labSaves: number[];
  labMu: number;
  labModel: any;
  labDayClass: number | null;
  activeLabDayRow: any;
  activeLabOutcome: any;
  calibPoints: any[];
  calibErr: any;
  refreshNow: () => void;
}
export function StatisticsView(props: StatisticsViewProps) {
  const { activeCity, activeLabDayRow, activeLabOutcome, anchorHour, anchorLabel, best, calibErr, calibPoints, data, f, fanBand80, fanBand95, forecast, forecastMarks, forecastWindow, gateStatus, h, heatmap, heatmapBasis, heatmapBasisActive, heatmapKind, heatmapWeeks, history, horizon, horizonDays, labData, labDayClass, labDayIdx, labModel, labMu, labPredHour, labRows, labSaves, labScores, labTotals, livePointsForChart, liters, m7Line, metrics, modelSeries, modelWindows, obsWindow, observations, refreshNow, selection, selected, series, setEps, setHeatmapBasis, setHeatmapKind, setHeatmapWeeks, setHorizon, setLabDayIdx, setSelectedId, setSpanHours, span, spanHours, spanLabel, stationPhase, stations, statsSummaryRes, transitionLine, eps, } = props;
  return (
<>
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[.2em] text-sky-400">
        Werkstatt / Analyse
      </p>
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Nachvollziehen statt blind vertrauen.
      </h2>
      <p className="mt-2 text-sm text-slate-400">
        Drei Fragen, von oben nach unten: Taugt das Modell? Warum
        empfiehlt es das? Was zeigen die Daten? — keine
        Beispielzahlen.
      </p>
      <div className="mt-3">
        <Badge warning>
          Unkalibriert · keine Handlungsempfehlung
        </Badge>
      </div>
    </div>
    <label className="text-xs text-slate-400">
      Station
      <select
        aria-label="Werkstatt-Station"
        value={selected?.station_id || ""}
        onChange={(e) => setSelectedId(e.target.value)}
        className="ml-3 max-w-64 rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200"
      >
        {stations.length ? (
          stations.map((row) => (
            <option key={row.station_id} value={row.station_id}>
              {row.name}
            </option>
          ))
        ) : (
          <option value="">Keine Station</option>
        )}
      </select>
    </label>
  </div>

  <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <Metric
      label="Backtest · mittlerer absoluter Fehler"
      value={centPerLiter(metrics?.mae_ct)}
      detail="Letzte 7 abgeschlossene Prüftage des Roll-Backtests; kein kalibrierter Live-Gütenachweis."
      tip="Mittlerer absoluter Fehler (MAE): der durchschnittliche Abstand zwischen Prognose und tatsächlichem Preis in Cent pro Liter."
    />
    <Metric
      label="Vergleich zur saisonalen Naive · MASE"
      value={euro(metrics?.mase)}
      detail="Skalierte Vergleichszahl: kleiner als 1,0 = besser als die Vergleichsmethode."
      tip="Mean Absolute Scaled Error (MASE) = Backtest-MAE geteilt durch den MAE der saisonalen Naive."
    />
    <Metric
      label="Beobachtete Vergleichspunkte"
      value={metrics?.points ?? "—"}
      detail="5-Minuten-Zeitpunkte, an denen Prognose und echter gemeldeter Preis verglichen wurden."
    />
    <Metric
      label="95-%-Band-Trefferquote · PICP"
      value={
        <>
          {euro(metrics?.picp95_pct, 1)}{" "}
          <span className="text-sm font-normal text-slate-500">
            %
          </span>
        </>
      }
      detail="Anteil echter Preise im 95-%-Band des Backtests. Ziel: 90–98 %."
    />
  </div>

  <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
    A · Taugt das Modell? — Bewährung an echten Tagen
  </p>
  {/* Gruppe A1: Entscheidungs-Scoreboard */}
  <section className="mb-8">
    <div className="mb-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
        <span title="Out-of-Sample: nur Tage, die das Modell beim Training nicht gesehen hat — keine Eigenbewertung.">
          Entscheidungs-Scoreboard · Prüfzeitraum (
          {labData?.daysEval ?? "–"} Tage)
        </span>
      </p>
      <h3 className="mt-1 text-xl font-bold text-white">
        Wurde die Empfehlung real belohnt?
      </h3>
    </div>
    <div className="overflow-x-auto rounded-2xl border border-slate-800">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-slate-900 text-[11px] uppercase tracking-wider text-slate-400">
          <tr>
            <th className="px-4 py-3">Station (Stadt)</th>
            <th
              className="px-3 py-3"
              title="δ̂ (relative Preislage) aus der Selektion: Median der Differenz zum Median der anderen Stationen der Stadt, in ct/L — negativ = günstiger."
            >
              Preis-Abstand
            </th>
            <th
              className="px-3 py-3 text-right hidden sm:table-cell"
              title="Durchschnittlich behauptete Wahrscheinlichkeit P, dass Warten günstiger ist."
            >
              P behauptet
            </th>
            <th
              className="px-3 py-3 text-right hidden sm:table-cell"
              title="Beobachtete Trefferquote: wie oft Warten wirklich einen Vorteil brachte (Ersparnis S > 0)."
            >
              S&gt;0 real
            </th>
            <th
              className="px-3 py-3 text-right hidden md:table-cell"
              title="Empfehlungen „Warten“: Anzahl und Anteil, bei dem Warten tatsächlich günstiger war."
            >
              „Warten“
            </th>
            <th
              className="px-3 py-3 text-right hidden md:table-cell"
              title="Empfehlungen „Jetzt tanken“: Anzahl und Anteil, bei dem sofort tanken tatsächlich günstiger war."
            >
              „Jetzt“
            </th>
            <th
              className="px-3 py-3 text-right hidden lg:table-cell"
              title="Regret: durchschnittliche Mehrkosten der Regel gegenüber dem besten Zeitpunkt im Fenster (Orakel)."
            >
              Ø Mehrkosten
            </th>
            <th className="px-3 py-3 text-right">Regel-€</th>
            <th className="px-3 py-3 text-right hidden sm:table-cell">
              Orakel-€
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {/* C6: erstes Laden = Skelett (Höhe bleibt), Fehler und
              Leerstand = derselbe Tabellen-Baustein wie überall. */}
          {labScores.length === 0 &&
            (statsSummaryRes.pending && !statsSummaryRes.data ? (
              <SkeletonRows
                rows={3}
                cols={9}
                label="Entscheidungs-Scoreboard wird geladen"
              />
            ) : (
              <CellError
                colSpan={9}
                errorCode={
                  (labData as any)?.error_code ||
                  statsSummaryRes.errorCode
                }
                empty={
                  !(
                    (labData as any)?.error_code ||
                    statsSummaryRes.errorCode
                  )
                }
                fallback="Noch keine Entscheidungszeilen — sie kommen aus dem täglichen Modell-Lauf, sobald genug Preishistorie vorliegt."
                onRetry={refreshNow}
              />
            ))}
          {labScores.map(({ station_id: sid, score: sc }) => {
            const stMeta = labData?.stations.find(
              (s) => s.id === sid,
            );
            const active = sid === selected?.station_id;
            const selDelta = selection.data?.stations.find(
              (s) => s.station_id === sid,
            )?.delta_ct;
            return (
              <tr
                key={sid}
                onClick={() => setSelectedId(sid)}
                className={`cursor-pointer transition ${active ? "bg-emerald-500/10" : "hover:bg-slate-800/40"}`}
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-100">
                    {stMeta?.name || sid}{" "}
                    <span className="text-slate-500">
                      · {stMeta?.city || activeCity}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono">
                  {selDelta != null ? (
                    <span
                      className={
                        selDelta <= 0
                          ? "text-emerald-300 font-semibold"
                          : "text-rose-300 font-semibold"
                      }
                    >
                      {selDelta > 0 ? "+" : ""}
                      {centPerLiter(selDelta)}
                    </span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-slate-300 hidden sm:table-cell">
                  {sc.p_known
                    ? `${Math.round(sc.p_avg * 100)} %`
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-slate-300 hidden sm:table-cell">
                  {Math.round(sc.hit_freq * 100)} %
                </td>
                <td className="px-3 py-2.5 text-right font-mono hidden md:table-cell">
                  {sc.n_wait > 0
                    ? `${sc.n_wait} · ${Math.round((sc.hit_wait ?? 0) * 100)}%`
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono hidden md:table-cell">
                  {sc.n_now > 0
                    ? `${sc.n_now} · ${Math.round((sc.hit_now ?? 0) * 100)}%`
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-slate-300 hidden lg:table-cell">
                  {euro(sc.avg_regret_eur)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold text-emerald-300">
                  {euro(sc.sum_smart_eur)} €
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-slate-400 hidden sm:table-cell">
                  {euro(sc.sum_best_eur)} €
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </section>

  {/* Gruppe A2: Kalibrierung */}
  <section className="mb-8">
    <div className="mb-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
        Stimmen die Prozentzahlen?
      </p>
      <h3 className="mt-1 text-xl font-bold text-white">
        Wenn das Modell 70 % verspricht, trifft es dann auch in 7 von
        10 Fällen?
      </h3>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
        Jeder Punkt fasst vergangene Empfehlungen mit ähnlicher Wette
        zusammen — waagerecht das Versprechen, senkrecht das
        Eingetroffene. Auf der gestrichelten Diagonalen stimmt beides
        überein; darunter war das Modell zu siegessicher, darüber zu
        bescheiden. Größere Punkte stehen für mehr Empfehlungen.
      </p>
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 lg:col-span-2">
        <CalibChart
          points={calibPoints}
          livePoints={livePointsForChart}
          ariaDescription="Kalibrierungsdiagramm: die Prozentzahl der Empfehlung (waagerecht) gegen das eingetretene Ergebnis (senkrecht); auf der Diagonalen stimmt Versprechen und Wirklichkeit überein."
        />
      </div>
      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <p className="text-slate-400">
            Versprechen vs. Wirklichkeit
          </p>
          <p className="mt-1 text-2xl font-bold text-white">
            {Number.isFinite(calibErr)
              ? `${euro(calibErr * 100, 1)} pp`
              : "—"}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Mittlerer Abstand der Punkte von der Diagonalen — je
            kleiner, desto ehrlicher die Prozentzahlen.
          </p>
        </div>
        {/* Freigabe 1 — M7-Gate (§0.4): Zähl-Gate über abgeschlossene
            Empfehlungen. Kein Tages-Nenner: 90 Übergangs-Tage sind
            keine 100 Empfehlungen. */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <p className="text-slate-400">
            Freigabe 1 von 2 · Genug Beweise gesammelt?
          </p>
          <p className="mt-1 text-base font-bold text-amber-300">
            {gateStatus}
          </p>
          {m7Line && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {m7Line}
            </p>
          )}
        </div>
        {/* Freigabe 2 — Übergangsregel Datenhygiene (Archiv →
            Live-Polling). Eigene Schwelle (live_only_days), eigener
            Fortschritt; sie schaltet keine Prozentanzeige frei. */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <p className="text-slate-400">
            Freigabe 2 von 2 · Nur eigene Live-Tage?
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            {transitionLine}
          </p>
          {stationPhase && (
            <p className="mt-1 text-[10px] leading-relaxed text-slate-600">
              Ausgewählte Station:{" "}
              {stationPhase.good_complete_live_days} von{" "}
              {stationPhase.required_complete_live_days} nötigen
              Live-Tagen erreicht —{" "}
              {stationPhase.mode === "live_only"
                ? "rechnet nur mit eigenen Beobachtungen."
                : "Archiv noch im Training."}
            </p>
          )}
        </div>
      </div>
    </div>
  </section>

  {/* Gruppe B1: Die Entscheidungs-Regel & ε-Slider */}
  <section className={`${panel} mb-8 p-6`}>
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Scale size={18} className="text-emerald-400" />
          <h3 className="text-lg font-semibold text-white">
            Die Entscheidungs-Regel & ε-Steuerung
          </h3>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">
          Jeden Tag um{" "}
          <span className="text-slate-200">{anchorLabel}</span>{" "}
          entscheidet die Station aus ihrem Training:{" "}
          <strong className="text-slate-200">Warten</strong> bis zur
          vorhergesagten billigsten Stunde (μ ≥ ε) — sonst{" "}
          <strong className="text-slate-200">jetzt tanken</strong>.
          <span className="text-slate-500 block mt-1">
            {anchorLabel} ist der Tages-Anker: Ausgangslage ist der
            letzte gemeldete Preis vor {anchorLabel}, verglichen mit
            der billigsten Stunde des restlichen Tages. Standard ist
            12:00 — Anhebungen gibt es nur mittags, und erst um 12 Uhr
            weiß der hypothetische Entscheid, ob es heute teurer
            wurde. So ist jeder Tag im Prüfstand gleich bewertbar —
            nicht abhängig davon, wann man zufällig nachschaut.
          </span>
          <span className="text-slate-500 block mt-1">
            Die Produktion entscheidet weiterhin mit der kalibrierten
            Entscheidungstabelle; dieser interaktive Slider dient zur
            Was-wäre-wenn-Analyse.
          </span>
        </p>
      </div>
      <div className="w-full max-w-xs shrink-0 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <label className="text-xs font-medium uppercase tracking-wider text-slate-400 flex justify-between">
          <span>Handlungsschwelle ε</span>
          <span className="font-mono text-emerald-400 font-bold">
            {centPerLiter(eps, 2)}
          </span>
        </label>
        <input
          type="range"
          min={0}
          max={4}
          step={0.05}
          value={eps}
          aria-valuetext={`${euro(eps, 2)} Cent pro Liter`}
          onChange={(e) => setEps(Number(e.target.value))}
          className="mt-2 w-full accent-emerald-400"
        />
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          Warten nur, wenn die Trainings-Ersparnis diese Schwelle
          verspricht.
        </p>
      </div>
    </div>
    {labTotals.n === 0 ? (
      statsSummaryRes.pending && !statsSummaryRes.data ? (
        <div className="mt-5">
          <SkeletonPanel
            lines={2}
            title={false}
            label="Tages-Entscheidungen werden geladen"
          />
        </div>
      ) : (
        <div className="mt-5">
          <LoadError
            errorCode={
              (labData as any)?.error_code ||
              statsSummaryRes.errorCode
            }
            fallback="Noch keine Tages-Entscheidungen. Sie erscheinen, sobald der Modell-Lauf genug echte Preishistorie ausgewertet hat (mind. 7 vollständige Tage je Station)."
            onRetry={refreshNow}
            compact
          />
        </div>
      )
    ) : (
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
          <p className="text-[11px] text-slate-500">
            Regel-Ergebnis ({labData?.daysEval ?? "–"} d
            out-of-sample)
          </p>
          <p className="mt-1 text-xl font-bold text-emerald-300 font-mono">
            {euro(labTotals.smart)} €
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
          <p className="text-[11px] text-slate-500">
            Perfekte Sicht (Orakel)
          </p>
          <p className="mt-1 text-xl font-bold text-slate-100 font-mono">
            {euro(labTotals.best)} €
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
          <p className="text-[11px] text-slate-500">
            Baseline „immer warten“
          </p>
          <p className="mt-1 text-xl font-bold text-slate-100 font-mono">
            {euro(labTotals.always)} €
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
          <p className="text-[11px] text-slate-500">
            Geholtes Potenzial
          </p>
          <p className="mt-1 text-xl font-bold text-amber-300 font-mono">
            {labTotals.best > 0
              ? `${Math.round(labTotals.potShare * 100)} %`
              : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
          <p className="text-[11px] text-slate-500">
            Ø Entscheidungsverlust
          </p>
          <p className="mt-1 text-xl font-bold text-slate-100 font-mono">
            {euro(labTotals.regretEur)} €
          </p>
        </div>
      </div>
    )}
  </section>

  {/* Gruppe B2a: Beobachtete Historie & Modell-Ausblick */}
  <section className={`${panel} mb-6 p-5 sm:p-6`}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">
        Stations-Labor · {spanLabel}
      </h3>
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-slate-500">
          Zeitraum{" "}
          <select
            aria-label="Zeitraum des Stations-Labors"
            value={spanHours}
            onChange={(e) => setSpanHours(Number(e.target.value))}
            className="ml-1 rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-200"
          >
            <option value={24}>24 Stunden</option>
            <option value={72}>3 Tage</option>
            <option value={168}>7 Tage</option>
          </select>
        </label>
        <Badge warning={!observations.length}>
          Echte Polling-Beobachtungen
        </Badge>
      </div>
    </div>
    {history.error || history.data?.error_code ? (
      <LoadError
        errorCode={history.data?.error_code || history.errorCode}
        fallback="Der Preisverlauf konnte nicht geladen werden."
        onRetry={refreshNow}
        retryLabel="Verlauf neu laden"
      />
    ) : series.length ? (
      <LineChart
        series={series}
        xDomain={obsWindow}
        xTicks={autoTimeTicks(obsWindow[0], obsWindow[1])}
        yFmt={(v) => euro(v, 3)}
        ariaDescription={`Preisverlauf der gewählten Station über die letzten ${spanHours === 24 ? "24 Stunden" : spanHours === 72 ? "3 Tage" : "7 Tage"} in €/L.`}
      />
    ) : history.pending && !history.data ? (
      <SkeletonChart
        height="h-56"
        label="Preisverlauf wird geladen"
      />
    ) : (
      <Empty>
        Noch keine Beobachtungen für diese Station — leere Stunden
        werden nicht erfunden.
      </Empty>
    )}
    {/* C11: Das gewählte Fenster (24 h / 3 d / 7 d) sagt nichts
        darüber, wie viel davon wirklich belegt ist. */}
    <DataReachNote reach={history.data} noun="Preise" />
  </section>

  <section className={`${panel} mb-6 p-5 sm:p-6`}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">
          Modell-Ausblick · 12-Uhr-Regel
        </h3>
        <p className="mt-1 text-[11px] text-slate-500">
          Modellprognose mit 80-%- und 95-%-Band.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Prognose-Horizont"
          className="flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs font-semibold"
        >
          <button
            aria-pressed={horizonDays === 0}
            onClick={() => setHorizon(0)}
            className={`rounded px-2.5 py-1 transition-colors ${horizonDays === 0 ? "bg-slate-800 text-sky-400" : "text-slate-400 hover:text-white"}`}
          >
            24 Stunden
          </button>
          <button
            aria-pressed={horizonDays === 3}
            onClick={() => setHorizon(3)}
            disabled={!f?.points_3d?.length}
            className={`rounded px-2.5 py-1 transition-colors ${horizonDays === 3 ? "bg-slate-800 text-sky-400" : f?.points_3d?.length ? "text-slate-400 hover:text-white" : "cursor-not-allowed text-slate-600"}`}
          >
            +3 Tage
          </button>
          <button
            aria-pressed={horizonDays === 7}
            onClick={() => setHorizon(7)}
            disabled={!f?.points_7d?.length}
            className={`rounded px-2.5 py-1 transition-colors ${horizonDays === 7 ? "bg-slate-800 text-sky-400" : f?.points_7d?.length ? "text-slate-400 hover:text-white" : "cursor-not-allowed text-slate-600"}`}
          >
            +7 Tage
          </button>
        </div>
      </div>
    </div>
    <DataAgeBanner stamp={forecast.data?.origin} kind="model" />
    {forecast.error || forecast.data?.error_code ? (
      <LoadError
        errorCode={forecast.data?.error_code || forecast.errorCode}
        fallback="Der Modell-Ausblick konnte nicht geladen werden."
        onRetry={refreshNow}
        retryLabel="Ausblick neu laden"
      />
    ) : forecastWindow && modelSeries.length ? (
      <>
        <LineChart
          series={modelSeries}
          bands={[...fanBand95, ...fanBand80]}
          marks={forecastMarks}
          xDomain={forecastWindow}
          xTicks={autoTimeTicks(forecastWindow[0], forecastWindow[1])}
          yFmt={(v) => euro(v, 3)}
          ariaDescription="Modell-Ausblick: prognostizierter Preisverlauf mit 80-%- und 95-%-Unsicherheitsband in €/L; Markierungen zeigen Fensterenden und den 12-Uhr-Anker."
        />
        {modelWindows.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="text-slate-500">
              Prognostizierte Tief- und Hoch-Phasen:
            </span>
            {modelWindows.map((w, i) => (
              <span
                key={i}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-slate-300"
              >
                {i === 0 ? "Tief" : "Hoch"}:{" "}
                {timeLabel(new Date(w.start).toISOString())} –{" "}
                {euro(w.median, 3)} €
              </span>
            ))}
          </div>
        )}
      </>
    ) : forecast.pending && !forecast.data ? (
      <SkeletonChart
        height="h-56"
        label="Modell-Ausblick wird berechnet"
      />
    ) : (
      <Empty>Noch kein veröffentlichter Modell-Ausblick.</Empty>
    )}
    {/* C11: Worauf der Fit beruht — Trainingsfenster und Punktzahl. */}
    <DataReachNote
      reach={forecast.data}
      noun="Preise im Training"
      hint="Grundlage des Fits, nicht der gezeigte Prognose-Horizont."
    />
  </section>

  <p className="mb-2 mt-10 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
    B · Warum empfiehlt es das? — Regel ausprobieren, Station sezieren
  </p>
  {/* Gruppe B2b: Stations-Labor Detail-Analyse */}
  <section className={`${panel} mb-8 p-6`}>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
          Stations-Labor
        </p>
        <h3 className="mt-1 text-xl font-bold text-white">
          {selected?.name || "Station"} · Detail-Analyse
        </h3>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-slate-400">
          Billigste Stunde (Tr.):{" "}
          <strong className="text-slate-200">
            {labModel
              ? `${String(labPredHour).padStart(2, "0")}:00`
              : "—"}
          </strong>
        </span>
      </div>
    </div>

    <div className="mt-5 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-slate-500">
        Tag im Prüfstand:
      </span>
      {labRows.map((r, i) => {
        const o = rowOutcome(r, eps, liters);
        const active = i === labDayIdx;
        return (
          <button
            key={r.day}
            onClick={() => setLabDayIdx(i)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
              active
                ? "bg-slate-200 text-slate-900 font-bold"
                : o.hit
                  ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                  : "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
            }`}
          >
            {r.day.slice(5)}
          </button>
        );
      })}
    </div>

    {activeLabDayRow && activeLabOutcome && (
      <div className="mt-5 grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <p className="text-xs uppercase tracking-wider text-slate-500">
            Regel am Morgen (
            {activeLabDayRow.cls === 0 ? "Werktag" : "WE/Feiertag"})
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">
            Training:{" "}
            <strong className="text-white">
              μ = {centPerLiter(activeLabDayRow.mu)}
            </strong>
            ,{" "}
            <strong className="text-white">
              P(S&gt;0) ={" "}
              {activeLabDayRow.p != null
                ? `${Math.round(activeLabDayRow.p * 100)} %`
                : "—"}
            </strong>
            . Regel (ε = {centPerLiter(eps, 2)}):{" "}
            <strong
              className={
                activeLabOutcome.wait
                  ? "text-emerald-300"
                  : "text-sky-300"
              }
            >
              {activeLabOutcome.wait
                ? `WARTEN bis ~${String(activeLabDayRow.predHour).padStart(2, "0")}:00`
                : "JETZT tanken"}
            </strong>
          </p>
        </div>
        <div className="rounded-xl bg-slate-900/80 p-3">
          <p className="text-xs text-slate-500">
            Realisierte Ersparnis S
          </p>
          <p
            className={`text-2xl font-bold font-mono ${activeLabDayRow.s > 0 ? "text-emerald-300" : "text-rose-300"}`}
          >
            {activeLabDayRow.s > 0 ? "+" : ""}
            {centPerLiter(activeLabDayRow.s)}
          </p>
        </div>
        <div className="rounded-xl bg-slate-900/80 p-3">
          <p className="text-xs text-slate-500">Urteil</p>
          <p
            className={`mt-1 text-lg font-bold ${activeLabOutcome.hit ? "text-emerald-300" : "text-rose-300"}`}
          >
            {activeLabOutcome.hit
              ? "✓ Richtig entschieden"
              : "✗ Falsch entschieden"}
          </p>
        </div>
      </div>
    )}

    <div className="mt-4 grid gap-4 xl:grid-cols-5">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 xl:col-span-3">
        <p className="px-1 text-xs font-medium text-slate-400">
          Tageskurve {activeLabDayRow?.day || "—"} (ct/L)
        </p>
        {(() => {
          const dayPts: { x: number; y: number }[] =
            activeLabDayRow?.curve && activeLabDayRow.curve.length
              ? activeLabDayRow.curve
              : [];
          const rowPredHour = activeLabDayRow?.predHour;
          return dayPts.length ? (
            <LabLineChart
              height={220}
              series={[
                {
                  name: `Erwartung vs. ${anchorLabel}`,
                  color: "#e2e8f0",
                  pts: dayPts,
                },
              ]}
              marks={[
                {
                  x: anchorHour,
                  color: "#38bdf8",
                  label: anchorLabel,
                },
                ...(rowPredHour != null
                  ? [
                      {
                        x: rowPredHour,
                        color: "#34d399",
                        label: `~${String(Math.floor(rowPredHour)).padStart(2, "0")}:${String(Math.round((rowPredHour % 1) * 60)).padStart(2, "0")}`,
                      },
                    ]
                  : []),
              ]}
              xTicks={[
                { x: 6, label: "06" },
                { x: 9, label: "09" },
                { x: 12, label: "12" },
                { x: 15, label: "15" },
                { x: 18, label: "18" },
                { x: 21, label: "21" },
              ]}
              yFmt={(v) => `${euro(v, 1)} ct`}
              ariaDescription="Tageskurve des gewählten Tags: erwartete Preisdifferenz in Cent je Stunde, mit Markierung für den Anker und die prognostizierte günstigste Stunde."
            />
          ) : (
            <div className="flex h-[220px] items-center justify-center px-6 text-center text-xs leading-relaxed text-slate-500">
              Keine Tageskurve für diesen Tag — wähle einen bewerteten
              Tag im Prüfstand.
            </div>
          );
        })()}
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 xl:col-span-2">
        <p className="px-1 text-xs font-medium text-slate-400">
          Trainings-Verteilung S (
          {labDayClass === 0 ? "Werktag" : "WE"})
        </p>
        {labModel ? (
          <HistogramBars
            values={labSaves}
            thresholds={[
              {
                x: eps,
                color: "#fbbf24",
                label: `ε ${euro(eps, 1)}`,
              },
              {
                x: labMu,
                color: "#38bdf8",
                label: `μ ${euro(labMu, 1)}`,
              },
            ]}
            height={220}
            ariaDescription="Histogramm der Trainings-Verteilung S: wie häufig eine Ersparnis in Cent je Liter vorkam, mit Markern für die Schwelle ε und den Durchschnitt μ."
          />
        ) : (
          <div className="flex h-[220px] items-center justify-center px-6 text-center text-xs leading-relaxed text-slate-500">
            Noch kein Form-Modell veröffentlicht — die Engine liefert
            bisher Tageszeilen, aber keine Trainings-Verteilung.
          </div>
        )}
      </div>
    </div>
  </section>

  <p className="mb-2 mt-10 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
    C · Was zeigen die Daten? — Muster und Stationsvergleich
  </p>
  {/* Gruppe C1: Heatmaps */}
  <section className={`${panel} mb-8 p-5 sm:p-6`}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <BarChart3 size={16} className="text-purple-400" />
        Heatmaps · Wochentag × Stunde · {activeCity || "—"}
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Heatmap Art"
          value={heatmapKind}
          onChange={(e) =>
            setHeatmapKind(e.target.value as "level" | "probability")
          }
          className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-200"
        >
          <option
            value="probability"
            title="Cheap-Probability P(p ≤ Median): Anteil der Preise dieser Stunde, die unter dem Vergleichs-Median lagen — hoch heißt typischerweise günstig."
          >
            Wahrscheinlichkeit für günstig
          </option>
          <option value="level">Preisniveau (Median €/L)</option>
        </select>
        {/* E5: Zeitraum war bisher fest verdrahtet — jetzt wählbar. */}
        <select
          aria-label="Heatmap Zeitraum"
          value={heatmapWeeks}
          onChange={(e) => setHeatmapWeeks(Number(e.target.value))}
          className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-200"
          title="Zeitraum der Auswertung — die Heatmap zeigt Vergangenheit, keine Prognose"
        >
          {HEATMAP_WEEKS.map((weeks) => (
            <option key={weeks} value={weeks}>
              {weeks} Wochen
            </option>
          ))}
        </select>
        {/* B12: Die Basis ändert nur ohne Station etwas — mit Station
            ist sie deaktiviert und wird auch nicht mitgesendet. */}
        {heatmapKind === "probability" && (
          <select
            aria-label="Heatmap Vergleichsbasis"
            value={heatmapBasis}
            disabled={!!selected}
            onChange={(e) =>
              setHeatmapBasis(e.target.value as HeatmapBasis)
            }
            className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              selected
                ? "Mit gewählter Station vergleicht die Heatmap ohnehin gegen den Median derselben Zelle — die Basis ist dann wirkungslos."
                : "Billig gegen welche Referenz? Der Stunden-Median rechnet den Tagesgang heraus."
            }
          >
            <option value="hour">
              Basis: Median derselben Stunde
            </option>
            <option value="overall">
              Basis: Gesamtmedian des Zeitraums
            </option>
          </select>
        )}
      </div>
    </div>
    {heatmapKind === "probability" && selected && (
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        Vergleich mit Station: jede Zelle gegen den Median aller
        Stationen derselben Zelle (gleicher Wochentag, gleiche
        Stunde). Der Basis-Umschalter ist hier deaktiviert, weil er
        nichts ändert.
      </p>
    )}
    {/* C6: Datenstand-Banner — erscheint nur, wenn der Stand wirklich alt ist. */}
    <DataAgeBanner stamp={heatmap.data?.generated_at} kind="model" />
    {heatmap.data && heatmap.data.matrix.length ? (
      <HeatmapGrid heatmap={heatmap.data} />
    ) : heatmap.pending && !heatmap.data ? (
      <SkeletonChart height="h-64" label="Heatmap wird berechnet" />
    ) : (
      <Empty>Noch keine Daten für Heatmap.</Empty>
    )}
  </section>

  {/* Gruppe C2: Meine Stationen Ranking */}
  <section className={`${panel} mb-8 p-5 sm:p-6`}>
    <div className="mb-4 flex items-center justify-between">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Activity size={16} className="text-emerald-400" />
        <span title="δ̂ Ranking: sortiert nach relativer Preislage — Median der Differenz zu den anderen Stationen.">
          Meine Stationen · Ranking nach Preis-Abstand
        </span>
      </h3>
    </div>
    <DataAgeBanner
      stamp={selection.data?.generated_at}
      kind="selection"
    />
    {selection.data && selection.data.stations.length ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-500">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-3">Station</th>
              <th
                className="py-2 pr-3"
                title="δ̂ (relative Preislage): Median der Differenz zum Median der anderen Stationen, in ct/L — negativ = günstiger als die Umgebung."
              >
                Preis-Abstand ct/L
              </th>
              <th
                className="py-2 pr-3 hidden sm:table-cell"
                title="95-%-Konfidenzintervall aus dem Tages-Block-Bootstrap (2,5-/97,5-Perzentil) für den Preis-Abstand."
              >
                95-%-KI
              </th>
              <th
                className="py-2 pr-3 hidden md:table-cell"
                title="q-Wert (Benjamini-Hochberg-Korrektur über alle Stationen): signifikant günstiger bei q < 0,05."
              >
                q-Wert
              </th>
              <th
                className="py-2 pr-3 hidden md:table-cell"
                title="AV-Score (Verfügbarkeit): gewichtete Wahrscheinlichkeit, dass die Station in dieser Stunde zu den drei günstigsten der Stadt gehört — Gewicht ist dein Tankzeitprofil."
              >
                Ampel-Stärke
              </th>
              <th
                className="py-2 pr-3"
                title="Stunde mit dem tiefsten Punkt der Tageskurve (robuste harmonische Regression)."
              >
                Billigste Stunde
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {selection.data.stations.map((s) => (
              <tr key={s.station_id}>
                <td className="py-2 pr-2 font-mono">{s.rank}</td>
                <td className="py-2 pr-3 font-semibold text-slate-200 truncate max-w-[180px]">
                  {s.name}
                </td>
                <td
                  className={`py-2 pr-3 font-mono ${s.delta_ct != null && s.delta_ct < 0 ? "text-emerald-400" : "text-rose-300"}`}
                >
                  {s.delta_ct != null
                    ? `${s.delta_ct > 0 ? "+" : ""}${centPerLiter(s.delta_ct)}`
                    : "—"}
                </td>
                <td className="py-2 pr-3 font-mono text-slate-400 hidden sm:table-cell">
                  {s.ci_lo != null && s.ci_hi != null
                    ? `[${centPerLiter(s.ci_lo)}, ${centPerLiter(s.ci_hi)}]`
                    : "—"}
                </td>
                <td className="py-2 pr-3 font-mono hidden md:table-cell">
                  {s.q_value != null ? euro(s.q_value, 4) : "—"}
                </td>
                <td className="py-2 pr-3 font-mono hidden md:table-cell">
                  {s.avail != null ? euro(s.avail, 2) : "—"}
                </td>
                <td className="py-2 pr-3 font-mono">
                  {formatHour(s.best_hour)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : selection.pending && !selection.data ? (
      <SkeletonPanel
        lines={4}
        title={false}
        label="Ranking wird geladen"
      />
    ) : (
      <Empty>Noch keine Stationen im Ranking.</Empty>
    )}
    {/* C11: „Rang 1“ aus zehn Tagen ist etwas anderes als aus drei
        Monaten — die Reichweite gehört unter die Tabelle. */}
    <DataReachNote reach={selection.data} noun="Beobachtungen" />
  </section>
</>
  );
}
