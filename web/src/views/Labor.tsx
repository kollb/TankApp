// Labor — die getrennte Mathematik, die man lernt
// (docs/UI-NEUENTWURF.md §6 und §7, Checkliste Phase 3).
//
// Eine Seite, fünf Aufklapp-Abschnitte plus Spielplatz. Kein Pfad, kein
// Fortschritt, keine Häkchen, kein Quiz: Wer nichts aufklappt, hat den
// Überblick — wer neugierig ist, klappt auf. Jeder Abschnitt folgt demselben
// Bauplan aus §6.2:
//
//   Alltagsfrage → Antwort in drei Sätzen → geführtes Visual →
//   „Für Neugierige“ (Methode, Fachwort, Formel) → Selbst prüfen
//
// Die View rendert, sie entscheidet nichts (D1). Alle Zahlen kommen aus
// derselben `/api/v1/stats/summary`-Antwort wie vorher die Werkstatt; das
// Tagebuch kommt aus `GET /api/v1/advice/diary` — echte Settlements des
// Advice-Ledgers, keine Demo-Zeilen.
//
// Ehrlichkeits-Regeln, die hier sichtbar werden:
//   * Fehlt ein Backtest, steht der Grund da statt einer leeren Kachel.
//   * Prinzip-Skizzen sind als solche beschriftet, nie als deine Daten.
//   * Prozente nur nach dem M7-Gate; sonst Worte und gezählte Fälle.
//   * Fehler sind Ausstellungsstücke: Das Tagebuch zeigt „daneben“ genauso
//     wie „richtig“, mit dem tatsächlich gemessenen Preis.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  FlaskConical,
  Gauge,
  ListChecks,
  MapPin,
  SlidersHorizontal,
  Sparkles,
  Target,
} from "lucide-react";
import { DataReachNote } from "../components/DataReach";
import { FreshnessLine } from "../components/FreshnessLine";
import { HeatmapGrid } from "../components/HeatmapGrid";
import { useChartPalette } from "../chartTheme";
import { LineChart } from "../components/LineChart";
import { LoadError } from "../components/LoadError";
import { SkeletonChart, SkeletonPanel } from "../components/Skeleton";
import { CalibChart, DeltaBars } from "../components/LabCharts";
import { Badge, Empty, InfoTooltip, panel } from "../components/ui";
import {
  HEATMAP_WEEKS,
  autoTimeTicks,
  centPerLiter,
  deNumber,
  deTrimmed,
  euro,
  percentLabel,
  rowOutcome,
  timeLabel,
  timeSpanLabel,
  windowsUsedLine,
  type AdviceDiary,
  type Forecast,
  type Health,
  type Heatmap,
  type HeatmapBasis,
  type Point,
  type ResourceState,
  type Selection,
  type Station,
  type StatsSummary,
} from "../data";
import { type NowTarget } from "../now";
import {
  DIARY_FILTERS,
  LAB_SECTIONS,
  diaryActionWord,
  diaryCountLabel,
  diaryEmptyNote,
  diaryOutcome,
  diaryStamp,
  groupDiaryEntries,
  labSection,
  type DiaryFilterId,
  type LabSectionId,
} from "../lab";
import { GlossaryView } from "./Glossary";
import { useOverview } from "../state/overview";
import { useLaborModel } from "./laborModel";

// U8: Die Labor-View holt sich ihre Daten aus dem OverviewContext und
// besitzt ihren bereichsspezifischen Zustand selbst — der Spielplatz
// (ε-Schwelle, Tagesindex) ist Ansichtszustand, das Modell rechnet
// `useLaborModel` aus dem Rohstoff (stats/summary, forecast, series).
// Von der Root kommen nur noch die vier Navigations-Props.
export interface LaborViewProps {
  // Erklär-Treppe Ebene 1 → 2 (§7). U5: Ebene 1 öffnet ein Sheet am
  // Wirkungsort; der Sprung hierher ist ausdrücklich — der Rückweg ist das
  // Browser-Zurück (U4), eine gemerkte Herkunft braucht es nicht mehr.
  focusSection: LabSectionId | null;
  onFocusHandled: () => void;
  onNavigate: (target: NowTarget | "jetzt" | "werkstatt") => void;
  /** U3: Das Glossar ist kein Hauptbereich mehr — sein Eingang liegt im
      Labor-Kopf (und im Fußzeilen-Link), nicht in der Bereichs-Navigation. */
  onOpenGlossary: () => void;
}

const LAB_ACCENT = "text-violet-300";
const LAB_BORDER = "border-violet-500/30";
const LAB_BG = "bg-violet-500/10";

const SECTION_ICONS: Record<LabSectionId, ReactNode> = {
  prognose: <FlaskConical size={16} aria-hidden="true" />,
  sicherheit: <Gauge size={16} aria-hidden="true" />,
  stationen: <MapPin size={16} aria-hidden="true" />,
  lernen: <ListChecks size={16} aria-hidden="true" />,
  glossar: <BookOpen size={16} aria-hidden="true" />,
  spielplatz: <Sparkles size={16} aria-hidden="true" />,
};

/**
 * Ein Aufklapp-Abschnitt mit stabiler Kennung — der Sprung aus Ebene 1
 * öffnet genau diesen Block und scrollt ihn in den Blick (§7).
 */
function LabBlock({
  id,
  open,
  onToggle,
  headline,
  question,
  children,
  blockRef,
}: {
  id: LabSectionId;
  open: boolean;
  onToggle: () => void;
  headline: string;
  question: string;
  children: ReactNode;
  blockRef?: (node: HTMLElement | null) => void;
}) {
  return (
    <section
      id={`labor-${id}`}
      ref={blockRef}
      aria-labelledby={`labor-${id}-title`}
      className={`${panel} scroll-mt-24 overflow-hidden`}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`labor-${id}-body`}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-violet-500/5"
      >
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${LAB_BORDER} ${LAB_BG} ${LAB_ACCENT}`}
        >
          {SECTION_ICONS[id]}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-xs font-bold uppercase tracking-[.2em] ${LAB_ACCENT}`}
          >
            {headline}
          </span>
          {/* Die Abschnitts-Frage ist die Überschrift — auch für Vorleser
              und `getByRole("heading")`: Der Knopf bleibt der Schalter, die
              Frage trägt `role="heading"` (h2-Ebene unter der Seite). */}
          <span
            id={`labor-${id}-title`}
            role="heading"
            aria-level={2}
            className="mt-0.5 block text-base font-semibold text-white"
          >
            {question}
          </span>
        </span>
        <span className="mt-1 shrink-0 text-xs font-semibold text-slate-500">
          {open ? "zuklappen" : "aufklappen"}
        </span>
      </button>
      {open && (
        <div id={`labor-${id}-body`} className="border-t border-slate-800 px-4 py-4">
          {children}
        </div>
      )}
    </section>
  );
}

/** „In drei Sätzen“ — der Kern jedes Abschnitts (§6.2). */
function ThreeSentences({ sentences }: { sentences: string[] }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3.5">
      <p className="text-xs font-bold uppercase tracking-[.2em] text-slate-500">
        In drei Sätzen
      </p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm leading-relaxed text-slate-200">
        {sentences.slice(0, 3).map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ol>
    </div>
  );
}

/** Verschachtelte Aufklapp-Ebene: Methode, Fachwort, Formel. */
function ForTheCurious({ children }: { children: ReactNode }) {
  return (
    <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200">
        Für Neugierige: Methode, Fachwort, Formel
      </summary>
      <div className="space-y-2 border-t border-slate-800/70 px-3 py-3 text-xs leading-relaxed text-slate-400">
        {children}
      </div>
    </details>
  );
}

/** Kleine Aufgabe mit Auflösung — Nachschlagen statt Schule. */
function SelfCheck({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-violet-200">
        Selbst prüfen: {question}
      </summary>
      <p className="border-t border-violet-500/20 px-3 py-3 text-xs leading-relaxed text-slate-300">
        {answer}
      </p>
    </details>
  );
}

/** Lesehilfe unter jedem Diagramm (§6.3: Titel als Aussage). */
function ReadingAid({ headline, text }: { headline: string; text: string }) {
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-slate-200">{headline}</p>
      <p className="text-xs leading-relaxed text-slate-500">{text}</p>
    </div>
  );
}

/** Prinzip-Skizze: ehrlich beschriftet, wenn eigene Daten fehlen (§10). */
function SketchNote({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-xs leading-relaxed text-amber-300/80">
      {children}
    </p>
  );
}

export function LaborView(props: LaborViewProps) {
  const c = useChartPalette();
  const { focusSection, onFocusHandled, onNavigate, onOpenGlossary } = props;
  // U8: geteilte Daten aus dem OverviewContext …
  const ov = useOverview();
  const {
    activeCity,
    best,
    diary,
    forecast,
    fuel,
    gateStatus,
    h,
    heatmap,
    heatmapBasis,
    heatmapBasisActive,
    heatmapKind,
    heatmapWeeks,
    history,
    horizon,
    horizonDays,
    liters,
    m7Line,
    observations,
    refreshNow,
    selection,
    selected,
    setHeatmapBasis,
    setHeatmapKind,
    setHeatmapWeeks,
    setHorizon,
    setSelectedId,
    setSpanHours,
    spanHours,
    spanLabel,
    stationPhase,
    stations,
    statsSummaryRes,
    transitionLine,
  } = ov;
  // … der Spielplatz ist Ansichtszustand (B4) …
  const [eps, setEps] = useState(1.0);
  const [labDayIdx, setLabDayIdx] = useState(13);
  // … und das Modell rechnet die View selbst (views/laborModel.ts).
  const {
    activeLabDayRow,
    activeLabOutcome,
    anchorHour,
    anchorLabel,
    calibErr,
    calibPoints,
    f,
    fanBand80,
    fanBand95,
    forecastMarks,
    forecastWindow,
    epsScan,
    labData,
    labDayClass,
    labModel,
    labMu,
    labPredHour,
    labRows,
    labSaves,
    labTotals,
    livePointsForChart,
    metrics,
    modelSeries,
    thinSupportPoints,
  } = useLaborModel(ov, eps, labDayIdx);
  // U8: Die Sorte kommt aus der Auswahl (Overview), nicht mehr aus einem
  // `any`-Feld des Forecast-Payloads.
  const fuelLabel = fuel === "diesel" ? "Diesel" : fuel.toUpperCase();

  // O18: CUSUM-Flags und Rang-Streuung stehen je Station im
  // Selektions-Artefakt (`engine/selection.py`) — echte Daten statt eines
  // Dauertextes ohne Datenpfad.
  const selStations = selection.data?.stations ?? [];
  const rankStability = useMemo(() => {
    const values = selStations
      .map((row) => row.rank_std)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }, [selStations]);
  const breakCount = selStations.length
    ? selStations.filter((row) => row.break_flag === true).length
    : null;
  const stationCount = selStations.length;
  const breakStats = selStations
    .map((row) => row.break_stat)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const breakMax = breakStats.length ? Math.max(...breakStats) : null;
  const cusumThreshold =
    statsSummaryRes.data?.quality_metrics?.cusum_drift?.threshold ?? 2.0;

  const [open, setOpen] = useState<Record<LabSectionId, boolean>>({
    prognose: true,
    sicherheit: false,
    stationen: false,
    lernen: false,
    glossar: false,
    spielplatz: false,
  });
  const blockRefs = useRef<Record<string, HTMLElement | null>>({});
  const [fanStep, setFanStep] = useState(0);
  const [diaryFilter, setDiaryFilter] = useState<DiaryFilterId>("all");

  const toggle = (id: LabSectionId) =>
    setOpen((current) => ({ ...current, [id]: !current[id] }));

  const jumpTo = (id: LabSectionId) => {
    setOpen((current) => ({ ...current, [id]: true }));
    // `?.` auf der Methode: happy-dom/ältere Browser kennen scrollIntoView
    // nicht immer — der Sprung öffnet trotzdem, er springt nur nicht.
    blockRefs.current[id]?.scrollIntoView?.({
      behavior: "smooth",
      block: "start",
    });
  };

  // Ebene 1 → Ebene 2 (§7): aufklappen, scrollen, Herkunft steht im Kopf.
  useEffect(() => {
    if (!focusSection) return;
    jumpTo(focusSection);
    onFocusHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSection, onFocusHandled]);

  const advice = statsSummaryRes.data?.live_advice ?? null;
  // O38: Fensterbilanz („x von y Fenstern genutzt“) — null ohne O38-Zähler.
  const windowsLine = windowsUsedLine(advice);
  const quality = statsSummaryRes.data?.quality_metrics ?? null;
  const wins = Number(advice?.wins ?? 0);
  const losses = Number(advice?.losses ?? 0);
  const ties = Number(advice?.ties ?? 0);
  const settled = wins + losses + ties || Number(advice?.n ?? 0);
  const trustPercent =
    advice && settled > 0 ? ((wins + ties * 0.5) / settled) * 100 : null;
  // „Versprochen“ ist der Mittelwert der behaupteten Sicherheiten, gewichtet
  // mit der Fallzahl je Prozent-Klasse — dieselben Fälle wie „eingetroffen“.
  const promised = useMemo(() => {
    const rows = (advice?.reliability ?? []).filter(
      (b) => b.count > 0 && Number.isFinite(b.mean_p),
    );
    if (!rows.length) return null;
    const n = rows.reduce((sum, b) => sum + b.count, 0);
    if (!n) return null;
    return (rows.reduce((sum, b) => sum + b.mean_p * b.count, 0) / n) * 100;
  }, [advice]);

  // O16: Der Preis-Abstand kommt aus der Selektion (`/api/v1/selection`) —
  // dort rechnet die Engine δ̂ samt Bootstrap-KI und q-Wert. Vorher las die
  // Ansicht ein Feld (`stationScores.delta_ct`), das der Server nie sendet,
  // und der Balken blieb dauerhaft leer.
  const stationDeltas = useMemo(() => {
    const rows = selection.data?.stations ?? [];
    return rows
      .filter((row) => Number.isFinite(row.delta_ct ?? Number.NaN))
      .map((row) => ({
        id: row.station_id,
        label: row.name || row.station_id,
        deltaCt: row.delta_ct as number,
        ciLo: Number.isFinite(row.ci_lo ?? Number.NaN)
          ? (row.ci_lo as number)
          : null,
        ciHi: Number.isFinite(row.ci_hi ?? Number.NaN)
          ? (row.ci_hi as number)
          : null,
        significant: row.significant === true,
      }));
  }, [selection]);

  const diaryEntries = diary.data?.entries ?? [];
  // Gleiche, direkt aufeinanderfolgende Einträge stehen als **eine** Zeile in
  // der Liste (vor 0.40.0 füllte eine offene Ablehnung sie im 30-Minuten-Takt
  // mit identischen Zeilen und verdrängte die echten Empfehlungen).
  const shownDiary = groupDiaryEntries(
    diaryEntries.filter((entry) =>
      diaryFilter === "all"
        ? true
        : diaryFilter === "void"
          ? entry.outcome !== "win" && entry.outcome !== "loss" && entry.outcome !== "tie"
          : entry.outcome === diaryFilter,
    ),
  );
  // Ist die Liste gekürzt (Server-Limit 50) oder der Gesamtstand unbekannt,
  // ist jede Zahl aus der Liste eine Untergrenze — dann sagt die Zeile
  // „mehrfach“ statt einer zu kleinen Zahl.
  const diaryTotal = diary.data?.settled_total;
  const diaryCapped = diaryTotal == null || diaryTotal > diaryEntries.length;

  const dayCurve: Array<{ x: number; y: number }> =
    activeLabDayRow?.curve && activeLabDayRow.curve.length
      ? activeLabDayRow.curve
      : [];

  // „Was wäre gewesen, wenn…“: dieselbe Bewertung wie das Scoreboard, nur
  // mit dem eingestellten ε und der Tankmenge aus dem Alltag nachgerechnet.
  const scenario = useMemo(() => {
    if (!labRows.length) return null;
    const outcomes = labRows.map((row: any) => ({
      outcome: rowOutcome(row, eps, liters),
    }));
    const wait = outcomes.filter((o) => o.outcome.wait).length;
    const hits = outcomes.filter((o) => o.outcome.hit).length;
    const regret = outcomes.reduce(
      (sum, o) => sum + (o.outcome.wait && !o.outcome.hit ? o.outcome.regretEur ?? 0 : 0),
      0,
    );
    return { days: outcomes.length, wait, hits, regret };
  }, [labRows, eps, liters]);

  const observationPts = useMemo(
    () =>
      (history.data?.points ?? []).filter(
        (p): p is Point & { price: number } =>
          Number.isFinite(p.timestamp) && p.price !== null,
      ),
    [history],
  );

  const forecastSeries = [
    ...modelSeries,
    ...(fanStep >= 3 && observationPts.length
      ? [
          {
            name: "Echte Preise (beobachtet)",
            color: c.marker,
            pts: observationPts.map((p) => ({
              x: Date.parse(p.timestamp),
              y: p.price,
            })),
          },
        ]
      : []),
  ];
  const forecastBands =
    fanStep >= 2 ? [...fanBand95, ...fanBand80] : fanStep >= 1 ? [...fanBand80] : [];

  return (
    <section aria-labelledby="labor-title" className="pb-2">
      {/* Labor-Kopf (§6.1): eigener Kopf, eigene Farbe, ein Weg zurück */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-bold uppercase tracking-[.3em] ${LAB_ACCENT}`}>
            ◈ Labor
          </p>
          <h1 id="labor-title" className="mt-1 text-2xl font-bold tracking-tight text-white">
            Verstehen, warum die App das sagt
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
            Verstehen, prüfen, spielen — in deinem Tempo. Nichts hier muss man
            wissen, um zu tanken: Einfach aufklappen, was interessiert. Kein
            Quiz, kein Fortschritt, keine Häkchen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* U3: Eingang zum Glossar — es ist kein Hauptbereich mehr,
              sondern wohnt beim Labor (UI-NEUENTWURF §6.2). */}
          <button
            onClick={onOpenGlossary}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-500/40"
          >
            <BookOpen size={14} aria-hidden="true" />
            Glossar
          </button>
        </div>
      </div>

      {/* Vertrauens-Konto — immer sichtbar, nichts zum Aufklappen */}
      <div className={`${panel} mb-4 border-violet-500/20 p-4 sm:p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Vertrauens-Konto ({activeCity || "kein Ort"} · {fuelLabel})
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">
              Trefferquote der Empfehlungen (6 Wochen):{" "}
              <strong className="font-mono text-violet-200">
                {trustPercent === null ? "—" : percentLabel(trustPercent, 0)}
              </strong>
              {settled > 0
                ? ` aus ${settled} abgerechneten Empfehlungen`
                : " — noch nichts zu zählen"}
            </p>
          </div>
          <Badge warning={!advice?.calibrated}>{gateStatus}</Badge>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full border border-slate-800 bg-slate-950">
          <div
            className="h-full rounded-full bg-violet-400/80"
            style={{ width: `${trustPercent === null ? 0 : Math.min(100, trustPercent)}%` }}
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          {advice && settled > 0
            ? `Versprochen waren im Mittel ${promised === null ? "—" : percentLabel(promised, 0)} — eingetroffen sind ${percentLabel(trustPercent!, 0)}. ` +
              `(${wins} richtig · ${losses} daneben · ${ties} unentschieden` +
              (advice.n_void ? ` · ${advice.n_void} nicht bewertbar` : "") +
              (advice.n_pending ? ` · ${advice.n_pending} noch offen` : "") +
              ")"
            : "Das Konto füllt sich mit der ersten abgerechneten Empfehlung — gezählt wird, nicht geschätzt. Solange die Liste leer ist, steht hier kein Prozentwert."}
          {advice?.brier_30d != null && (
            <>
              {" "}
              <InfoTooltip
                label="Brier-Score (30 Tage)"
                text="Mittlerer quadratischer Fehler der Prozent-Angaben: 0 = perfekt, kleiner ist besser. Die Prozent-Anzeige gilt als kalibriert, wenn die Obergrenze des Brier-Intervalls unter Basis- und Klima-Referenz liegt (M7)."
              />
              {deTrimmed(advice.brier_30d, 3)}
            </>
          )}
        </p>
        {m7Line && (
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{m7Line}</p>
        )}
        {windowsLine && (
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{windowsLine}</p>
        )}
        <button
          onClick={() => jumpTo("sicherheit")}
          className="mt-2 text-xs font-semibold text-violet-300 underline underline-offset-4 hover:text-violet-200"
        >
          Wie wird das gezählt?
        </button>
      </div>

      {/* Sprungleiste (klappt auf + scrollt hin) */}
      <div className="mb-4 flex flex-wrap gap-2">
        {LAB_SECTIONS.map((section) => (
          <button
            key={section.id}
            onClick={() => jumpTo(section.id)}
            aria-expanded={open[section.id]}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              open[section.id]
                ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
                : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200"
            }`}
          >
            {section.number ? `${section.number} · ${section.short}` : section.short}
          </button>
        ))}
      </div>

      <div className="grid gap-3">
        {/* ── 1. Prognose ───────────────────────────────────────────── */}
        <LabBlock
          id="prognose"
          open={open.prognose}
          onToggle={() => toggle("prognose")}
          headline="1 · Prognose"
          question={labSection("prognose").question}
          blockRef={(node) => {
            blockRefs.current.prognose = node;
          }}
        >
          <ThreeSentences
            sentences={[
              "Die App kombiniert das Muster deiner Stadt — morgens teuer, abends billig, Sonntag anders — mit der aktuellen Lage.",
              "Was sie nicht weiß, sagt sie als Band: innen „meistens drin“ (80 %), außen „fast immer drin“ (95 %).",
              "Je weiter der Blick nach vorn geht, desto breiter wird das Band — Tage 5 bis 7 sind sichtbar unsicher.",
            ]}
          />
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Horizont:</span>
            {[
              // V5: Blick nach vorn — das „+“ unterscheidet den Horizont vom
              // Rückblick-Span („3 Tage“ = letzte 3 Tage). Deshalb behält der
              // Prognose-Horizont seine „+N Tage“-Form.
              { days: 0, label: "24 Stunden", enabled: true },
              { days: 3, label: "+3 Tage", enabled: !!f?.points_3d?.length },
              { days: 7, label: "+7 Tage", enabled: !!f?.points_7d?.length },
            ].map((option) => (
              <button
                key={option.days}
                disabled={!option.enabled}
                aria-pressed={horizonDays === option.days}
                onClick={() => setHorizon(option.days)}
                className={`rounded-lg border px-2.5 py-1 font-semibold transition-colors ${
                  horizonDays === option.days
                    ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
                    : option.enabled
                      ? "border-slate-700 text-slate-400 hover:text-slate-200"
                      : "cursor-not-allowed border-slate-800 text-slate-600"
                }`}
              >
                {option.label}
              </button>
            ))}
            <span className="text-slate-500">· Aufbau:</span>
            <div className="flex flex-wrap gap-1">
              {["1 Linie", "2 + 80 %-Band", "3 + 95 %-Band", "4 echte Preise"].map(
                (label, index) => (
                  <button
                    key={label}
                    aria-pressed={fanStep === index}
                    onClick={() => setFanStep(index)}
                    className={`rounded-md border px-2 py-1 font-semibold ${
                      fanStep === index
                        ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
                        : "border-slate-800 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    Schritt {index + 1}
                  </button>
                ),
              )}
            </div>
          </div>
          {forecast.error || forecast.data?.error_code ? (
            <div className="mt-3">
              <LoadError
                errorCode={forecast.data?.error_code || forecast.errorCode}
                fallback="Der Modell-Ausblick konnte nicht geladen werden."
                onRetry={refreshNow}
                retryLabel="Ausblick neu laden"
              />
            </div>
          ) : forecastWindow && forecastSeries.length ? (
            <div className="mt-3">
              {fanStep === 3 && (
                <SketchNote>
                  Die echten Punkte sind gemessene Preise aus dem gewählten
                  Zeitraum — kein Modell, keine Schätzung.
                </SketchNote>
              )}
              {fanStep >= 1 && thinSupportPoints.length > 0 && (
                <p className="mb-2 flex items-center gap-1.5 text-xs leading-relaxed text-amber-200">
                  <span aria-hidden="true" className="inline-block size-2 rounded-full border border-amber-300" />
                  Hohle Punkte im Band: dünn gestützte Zeit-Slots (mindestens einer hat nur {Math.min(...thinSupportPoints.map((p) => p.support_days ?? Infinity))} Tage). Das Band bleibt sichtbar, ist aber weniger belastbar.
                </p>
              )}
              <LineChart
                series={forecastSeries}
                bands={forecastBands}
                marks={fanStep >= 1 ? forecastMarks : []}
                xDomain={forecastWindow}
                xTicks={autoTimeTicks(forecastWindow[0], forecastWindow[1])}
                yFmt={(value) => euro(value, 3)}
                ariaDescription={`Geführter Aufbau, Schritt ${fanStep + 1} von 4: wahrscheinlichster Preis${fanStep >= 1 ? ", 80-%-Band" : ""}${fanStep >= 2 ? ", 95-%-Band" : ""}${fanStep >= 1 && thinSupportPoints.length ? `, ${thinSupportPoints.length} hohle Markierungen für dünn gestützte Slots` : ""}${fanStep >= 3 ? ", darüber die echten beobachteten Preise" : ""} in €/L.`}
              />
              <ReadingAid
                headline={
                  fanStep === 0
                    ? "Schritt 1: Nur die wahrscheinlichste Linie."
                    : fanStep === 1
                      ? "Schritt 2: Das dunkle Band ist „meistens drin“ (80 %)."
                      : fanStep === 2
                        ? "Schritt 3: Das helle Band ist „fast immer drin“ (95 %)."
                        : "Schritt 4: Darüber die echten Preise — außerhalb des Bandes heißt: Die App lag daneben."
                }
                text="Je breiter das Band, desto weniger weiß die App. Ein schmales Band an einem weit entfernten Tag wäre ein Schwindel — deshalb wird es nach hinten breiter."
              />
            </div>
          ) : forecast.pending && !forecast.data ? (
            <div className="mt-3">
              <SkeletonChart height="h-56" label="Modell-Ausblick wird berechnet" />
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <SketchNote>Prinzip-Skizze — nicht deine Daten.</SketchNote>
              <p className="text-xs leading-relaxed text-slate-300">
                Ohne veröffentlichten Modell-Lauf gibt es keinen Ausblick zu
                zeigen. Die Linie entsteht erst mit dem ersten Modell-Update;
                bis dahin gilt der Preisvergleich in „Jetzt“.
              </p>
            </div>
          )}
          <DataReachNote
            reach={forecast.data}
            noun="Preise im Training"
            hint="Grundlage des Fits, nicht der gezeigte Prognose-Horizont."
          />
          <ForTheCurious>
            <p>
              Je Station schätzt ein Strukturmodell (Tages-/Wochenform) plus
              AR(2)-Rest die Verteilung der nächsten Stunden; die Bänder sind
              Quantile der Bootstrap-Verteilung.
            </p>
            <div className="rounded-lg bg-slate-950/70 p-2 font-mono text-xs text-slate-300">
              q̂(τ, h) mit τ ∈ {"{"}.005, .025, .10, .50, .90, .975, .995{"}"} ·
              Band₈₀ = [q̂.₁₀, q̂.₉₀] · Band₉₅ = [q̂.₀₂₅, q̂.₉₇₅]
            </div>
          </ForTheCurious>
          <SelfCheck
            question="An welchem Tag lag der echte Preis außerhalb des Bandes?"
            answer="Schritt 4 zeigt die echten Punkte über dem Band. Punkte außerhalb des hellen Bandes kommen vor — sie sind der Grund, warum vor dem Prozentwert die Kalibrierung geprüft wird (Abschnitt 2)."
          />
        </LabBlock>

        {/* ── 2. Sicherheit ─────────────────────────────────────────── */}
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
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-xs font-semibold text-slate-200">
                Versprochen gegen eingetroffen
              </p>
              <CalibChart
                points={calibPoints}
                livePoints={livePointsForChart}
                ariaDescription="Kalibrierungsdiagramm: X-Achse die versprochene Sicherheit in Prozent, Y-Achse die eingetroffene Trefferquote; die Diagonale ist die perfekte Kalibrierung."
              />
              <ReadingAid
                headline={
                  Number.isFinite(calibErr)
                    ? `Waagerecht das Versprechen, senkrecht das Eingetroffene. Durchschnittliche Abweichung: ${percentLabel((calibErr as number) * 100, 1)}`
                    : "Noch keine Punkte — die Kalibrierung entsteht aus abgerechneten Empfehlungen."
                }
                text="Punkte auf der Diagonalen = ehrlich versprochen. Darunter hat die App zu viel versprochen, darüber war sie zu vorsichtig."
              />
            </div>
            <div className="grid gap-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-xs font-semibold text-slate-200">
                  Was die App selbst prüft
                </p>
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
                    — unter 1,0 heißt besser als die einfache Vergleichsmethode.
                  </li>
                  {/* O18: Beide Zeilen lasen Kennzahlen, die niemand
                      berechnet (`top3_hit_rate`, `cusum_drift.status` sind
                      serverseitig dauerhaft null/„unknown“). Die echten
                      Größen liegen je Station im Selektions-Artefakt. */}
                  <li>
                    <strong className="text-slate-100">Rang-Streuung:</strong>{" "}
                    {rankStability != null ? (
                      <>
                        {deNumber(rankStability, 2)} Plätze im Schnitt — wie
                        stark sich die Reihenfolge der Stationen von Tag zu Tag
                        verschiebt.
                      </>
                    ) : (
                      <>noch keine Selektion geladen.</>
                    )}
                  </li>
                  <li>
                    <strong className="text-slate-100">
                      Strukturbruch (CUSUM):
                    </strong>{" "}
                    {breakCount != null ? (
                      <>
                        {breakCount} von {stationCount} Stationen mit Bruch-Flag
                        {breakMax != null
                          ? ` (höchste CUSUM-Kennzahl ${deNumber(breakMax, 2)}, Schwelle ${deNumber(cusumThreshold, 2)})`
                          : ""}
                        .
                      </>
                    ) : (
                      <>noch keine Selektion geladen.</>
                    )}
                  </li>
                  <li>
                    <strong className="text-slate-100">Mittlerer Fehler (MAE):</strong>{" "}
                    {metrics?.mae_ct != null
                      ? `${deTrimmed(metrics.mae_ct, 2)} ct/L aus ${metrics.points} Vergleichspunkten.`
                      : "noch keine Vergleichspunkte — der Roll-Backtest füllt sie."}
                  </li>
                </ul>
              </div>
              {transitionLine && (
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-xs font-semibold text-slate-200">
                    Übergang Archiv → Live-Polling
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    {transitionLine}
                  </p>
                </div>
              )}
            </div>
          </div>
          <ForTheCurious>
            <p>
              Der Brier-Score ist der mittlere quadratische Fehler der
              Prozent-Angaben (0 = perfekt, 0,25 = Raten). Das M7-Gate ist die
              Führerschein-Prüfung der App: erst ab 100 abgerechneten
              Empfehlungen, deren Brier-Intervall unter beiden Referenzen
              liegt, zeigt sie Prozente.
            </p>
            <div className="rounded-lg bg-slate-950/70 p-2 font-mono text-xs text-slate-300">
              Brier = mean((p − o)²), o ∈ {"{"}0, 1{"}"} · Gate: n ≥{" "}
              {advice?.min_recommendations ?? 100} ∧ Obergrenze(Brier-KI) &lt;{" "}
              min(Basis, Klima) · ≥ {advice?.min_day_blocks ?? 10} Tagesblöcke
            </div>
          </ForTheCurious>
          <SelfCheck
            question="Was wäre ein schlechtes Zeichen in diesem Diagramm?"
            answer="Punkte deutlich unter der Diagonalen: Dort wurde viel Sicherheit versprochen, aber selten getroffen — die App wäre übermütig. Punkte darüber sind unschön, aber harmlos: zu vorsichtig."
          />
        </LabBlock>

        {/* ── 3. Stationen ──────────────────────────────────────────── */}
        <LabBlock
          id="stationen"
          open={open.stationen}
          onToggle={() => toggle("stationen")}
          headline="3 · Stationen"
          question={labSection("stationen").question}
          blockRef={(node) => {
            blockRefs.current.stationen = node;
          }}
        >
          <ThreeSentences
            sentences={[
              "Jede Station wird mit dem Stadt-Üblichen verglichen — dem Median derselben Stunde, nicht mit dem Durchschnitt.",
              "Der Abstand wird über Wochen gemittelt; Zufall mittelt sich heraus, ein System bleibt stehen.",
              "Was übrig bleibt, ist der Preis-Abstand: Meist N ct unter dem Üblichen heißt oft günstig — nicht immer.",
            ]}
          />
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">
              Preis-Abstand je Station · {activeCity || "Stadt"}
            </p>
            {stationDeltas.length ? (
              <>
                <DeltaBars
                  values={stationDeltas.map((row) => row.deltaCt)}
                  labels={stationDeltas.map((row) => row.label)}
                  whiskers={stationDeltas.map((row) =>
                    row.ciLo != null && row.ciHi != null
                      ? { lo: row.ciLo, hi: row.ciHi }
                      : null,
                  )}
                  muted={stationDeltas.map((row) => !row.significant)}
                  ariaDescription="Balkendiagramm: Abstand jeder Station zum Stadt-Üblichen in Cent pro Liter, mit Konfidenzintervall als senkrechtem Strich; links = meist günstiger, rechts = meist teurer. Blasse Balken sind statistisch nicht signifikant."
                />
                <ReadingAid
                  headline="Balken links = meist unter dem Üblichen (grün) · rechts = darüber."
                  text="Werte aus der Stations-Auswahl: δ̂ mit Bootstrap-Konfidenzintervall (senkrechter Strich) und Signifikanz nach Benjamini-Hochberg — blasse Balken sind nicht signifikant. Der Strich in der Mitte ist der Stadt-Median."
                />
              </>
            ) : (
              <div className="mt-2">
                <Empty>
                  Noch kein Preis-Abstand messbar — er entsteht aus
                  mindestens einer vollständigen Woche echter Preise je Station.
                </Empty>
              </div>
            )}
          </div>
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-200">
                Wochenrhythmus: Wann ist es wo billig?
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1 text-slate-400">
                  Art
                  <select
                    aria-label="Heatmap-Art"
                    value={heatmapKind}
                    onChange={(event) =>
                      setHeatmapKind(event.target.value as "level" | "probability")
                    }
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
                    onChange={(event) => setHeatmapWeeks(Number(event.target.value))}
                    className="ml-1 rounded-lg border border-slate-700 bg-slate-900 p-1 text-slate-200"
                  >
                    {HEATMAP_WEEKS.map((weeks) => (
                      <option key={weeks} value={weeks}>
                        {weeks}
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
                      onChange={(event) =>
                        setHeatmapBasis(event.target.value as HeatmapBasis)
                      }
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
                  text="Grün heißt billiger als der Vergleichswert, rot teurer. „dünn“ heißt: Zu wenige Preise in dieser Zelle für eine Aussage — dort steht bewusst keine Zahl."
                />
              </div>
            ) : heatmap.pending ? (
              <div className="mt-3">
                <SkeletonChart height="h-48" label="Heatmap wird berechnet" />
              </div>
            ) : (
              <div className="mt-3">
                <Empty>
                  Noch keine Heatmap — sie entsteht aus mindestens zwei
                  vollständigen Wochen echter Preise.
                </Empty>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <button
              onClick={() => onNavigate("stations")}
              className="font-semibold text-violet-300 underline underline-offset-4 hover:text-violet-200"
            >
              Zwei Stationen im Preis-Atlas gegenüberstellen (A gegen B)
            </button>
            {selected && (
              <span className="text-slate-500">
                Ausgewählt: {selected.name}
                {labModel
                  ? ` · billigste Stunde meist ${String(labPredHour).padStart(2, "0")}:00`
                  : ""}
              </span>
            )}
          </div>
          <ForTheCurious>
            <p>
              δ̂ („Preis-Abstand“) ist der Mittelwert der Differenzen
              zwischen Stationspreis und Stadt-Median derselben Stunde — nicht
              der Mittelwert der Preise. Nur so verschwindet der Tagesgang aus
              dem Vergleich.
            </p>
            <div className="rounded-lg bg-slate-950/70 p-2 font-mono text-xs text-slate-300">
              δ̂(s) = mean( p(s, t) − median(t) ) über 6 Wochen · ε = „ab wann
              ist uns ein Unterschied wichtig?“
            </div>
          </ForTheCurious>
          <SelfCheck
            question="Zwei Stationen haben denselben Preis — sind sie gleich gut?"
            answer="Nicht unbedingt. Gleich gut wäre: über Wochen denselben Abstand zum Üblichen zu haben. Ein einmaliger Preisgleichstand sagt nur, dass beide gerade dasselbe kosten — der Wochenrhythmus oben zeigt den Rest."
          />
        </LabBlock>

        {/* ── 4. Lernen ─────────────────────────────────────────────── */}
        <LabBlock
          id="lernen"
          open={open.lernen}
          onToggle={() => toggle("lernen")}
          headline="4 · Lernen"
          question={labSection("lernen").question}
          blockRef={(node) => {
            blockRefs.current.lernen = node;
          }}
        >
          <ThreeSentences
            sentences={[
              "Jede Empfehlung wird aufgeschrieben — mit oder ohne deine Tankung.",
              "Nach dem Fensterende vergleicht die App die Vorhersage mit dem echten Preis und verbucht richtig, daneben oder unentschieden.",
              "Daneben liegende Empfehlungen bleiben stehen: Das Tagebuch zeigt sie genauso wie die richtigen, und aus ihnen eicht sich die App selbst.",
            ]}
          />

          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-200">Prognose-Tagebuch</p>
              <div className="flex flex-wrap gap-1 text-xs">
                {DIARY_FILTERS.map((option) => (
                  <button
                    key={option.id}
                    aria-pressed={diaryFilter === option.id}
                    onClick={() => setDiaryFilter(option.id)}
                    className={`rounded-md border px-2 py-1 font-semibold ${
                      diaryFilter === option.id
                        ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
                        : "border-slate-800 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {diary.error || diary.data?.error_code ? (
              <div className="mt-3">
                <LoadError
                  errorCode={diary.data?.error_code || diary.errorCode}
                  fallback="Das Tagebuch konnte nicht geladen werden."
                  onRetry={refreshNow}
                  retryLabel="Tagebuch neu laden"
                  compact
                />
              </div>
            ) : diary.pending && !diary.data ? (
              <div className="mt-3">
                <SkeletonPanel lines={3} title={false} label="Tagebuch wird geladen" />
              </div>
            ) : shownDiary.length === 0 ? (
              <div className="mt-3">
                <Empty>
                  {diaryFilter === "all"
                    ? diaryEmptyNote(diary.data?.reason)
                    : "Kein Eintrag in dieser Auswahl — das heißt nicht, dass es keine gibt: einfach auf „Alle“ schalten."}
                </Empty>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-slate-800/80">
                {shownDiary.map((row) => {
                  const entry = row.entry;
                  const verdict = diaryOutcome(entry);
                  const stationName =
                    stations.find(
                      (station) => station.station_id === entry.station_id,
                    )?.name ??
                    entry.station_name ??
                    entry.station_id ??
                    "unbekannte Station";
                  const rowCount = diaryCountLabel(row.count, diaryCapped);
                  const stamp = diaryStamp(entry);
                  return (
                    <li
                      key={entry.snapshot_id ?? `${entry.settled_at}-${entry.action}`}
                      className="flex flex-wrap items-start justify-between gap-2 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200">
                          <span
                            className={
                              verdict.tone === "good"
                                ? "text-emerald-300"
                                : verdict.tone === "bad"
                                  ? "text-rose-300"
                                  : "text-slate-400"
                            }
                          >
                            {verdict.word}
                          </span>{" "}
                          {diaryActionWord(entry.action)} · {stationName}
                          {rowCount ? ` · ${rowCount}` : ""}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                          {entry.price_then !== null && entry.price_window !== null
                            ? `${euro(entry.price_then, 3)} €/L vorhergesagt → ${euro(entry.price_window, 3)} €/L wirklich · `
                            : ""}
                          {entry.window_start && entry.window_end
                            ? `Fenster ${timeLabel(entry.window_start)}–${timeLabel(entry.window_end)} · `
                            : ""}
                          {verdict.detail}
                        </p>
                      </div>
                      <p className="shrink-0 text-xs text-slate-500">
                        {row.count > 1 && row.oldest && stamp
                          ? `${timeLabel(row.oldest)} – ${timeLabel(stamp)}`
                          : stamp
                            ? timeLabel(stamp)
                            : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p
                className="text-xs font-semibold text-slate-200"
                title="Fachwort: out-of-sample"
              >
                Bilanz der Ratschläge (
                {labData?.daysEval ?? "—"} Tage außerhalb der Stichprobe)
              </p>
              {labTotals.n === 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Ohne Backtest-Tage keine Bilanz: Die App rechnet sie erst,
                  wenn genug echte Preishistorie da ist (mind. 7 vollständige
                  Tage je Station) — geschätzt wird nichts.
                </p>
              ) : (
                <>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-slate-900/70 p-2.5">
                      <p className="text-xs uppercase tracking-wider text-slate-500">
                        Regel-Ergebnis
                      </p>
                      <p className="font-mono text-lg font-bold text-emerald-300">
                        {euro(labTotals.smart)} €
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-900/70 p-2.5">
                      <p className="text-xs uppercase tracking-wider text-slate-500">
                        Perfektes Timing (Orakel)
                      </p>
                      <p className="font-mono text-lg font-bold text-slate-100">
                        {euro(labTotals.best)} €
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-900/70 p-2.5">
                      <p className="text-xs uppercase tracking-wider text-slate-500">
                        Ø Mehrkosten zum perfekten Timing
                      </p>
                      <p className="font-mono text-lg font-bold text-amber-300">
                        {euro(labTotals.regretEur)} €
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    Bewertet werden Ratschläge, nicht deine Tankungen. Tagesanker
                    ist {anchorLabel} — die Ausgangslage jeder Zeile.
                  </p>
                  {/* O21: Eine Euro-Zahl ohne Tankmenge und Schwelle
                      beantwortet keine Frage — beide stehen dabei. */}
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Gerechnet für {deTrimmed(liters, 0)} L (
                    {labData?.litersSource === "profile"
                      ? "aus deinem Profil"
                      : "Platzhalter, kein Profil aktiv"}
                    ) und ε = {centPerLiter(eps, 2)}.
                  </p>
                </>
              )}
            </div>
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={14} className="text-violet-300" aria-hidden="true" />
                <p className="text-xs font-semibold text-slate-100">Vorsicht-Regler ε</p>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                „Ab wann ist uns ein Unterschied wichtig?“ — verschiebe die
                Schwelle und sieh unten, wie viele Tage die Regel gewartet
                hätte und wie oft das richtig war. Live nachgerechnet, nicht
                gespeichert.
              </p>
              <label className="mt-3 block text-xs text-slate-400" htmlFor="labor-eps">
                Handlungsschwelle:{" "}
                <span className="font-mono font-bold text-violet-200">
                  {centPerLiter(eps, 2)}
                </span>
              </label>
              <input
                id="labor-eps"
                type="range"
                min={0}
                max={4}
                step={0.05}
                value={eps}
                aria-valuetext={`${euro(eps, 2)} Cent pro Liter`}
                onChange={(event) => setEps(Number(event.target.value))}
                className="mt-2 w-full accent-violet-400"
              />
              {scenario ? (
                <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-300">
                  <li>
                    Station im Blick:{" "}
                    <strong className="text-slate-100">{selected?.name ?? "—"}</strong>
                  </li>
                  <li>
                    Gewartet hätte sie an{" "}
                    <strong className="text-slate-100">
                      {scenario.wait} von {scenario.days}
                    </strong>{" "}
                    Tagen.
                  </li>
                  <li>
                    Richtig entschieden:{" "}
                    <strong className="text-slate-100">
                      {scenario.hits} von {scenario.days}
                    </strong>{" "}
                    Tagen.
                  </li>
                  <li>
                    Verlust aus falschem Warten:{" "}
                    <strong className="text-slate-100">{euro(scenario.regret)} €</strong>{" "}
                    bei {deTrimmed(liters, 0)} L.
                  </li>
                  {labMu != null ? (
                    <li>
                      Trainings-Erwartung der Station:{" "}
                      <strong className="text-slate-100">μ = {centPerLiter(labMu)}</strong>{" "}
                      ({labDayClass === 0 ? "Werktag" : "Wochenende/Feiertag"}),{" "}
                      {labSaves.length} Trainings-Tage.
                    </li>
                  ) : (
                    /* O18: Die Engine publiziert kein Form-Modell je Station
                       (`models` ist leer). Hier stand ein erfundenes
                       „μ = 1,5 ct“ — jetzt steht der Dauerzustand. */
                    <li className="text-slate-500">
                      Werkstück „Modellvergleich“: Die Engine veröffentlicht kein
                      Form-Modell je Station, deshalb gibt es hier nichts zu
                      vergleichen — die Tageskurve oben zeigt die gemessenen
                      Backtest-Zeilen.
                    </li>
                  )}
                </ul>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Der Regler wirkt, sobald ein Backtest für diese Station
                  vorliegt — vorher gibt es nichts nachzurechnen.
                </p>
              )}
            </div>
          </div>
          {selection.data && (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Auswahl-Set: {selection.data.stations?.length ?? 0} Stationen ·{" "}
              {stationPhase
                ? `Datenpolitik ${stationPhase}`
                : "keine Datenpolitik publiziert"}
            </p>
          )}
          <ForTheCurious>
            <p>
              Das <strong className="text-slate-300">Advice-Ledger</strong>{" "}
              zählt Ratschläge gegen die Realität — es braucht keine Tankung.
              Das <strong className="text-slate-300">Wallet-Ledger</strong>{" "}
              zählt deine Euro gegen den Median und braucht Belege. Beide
              getrennt: Können der App und Nutzen im Geldbeutel.
            </p>
            <p>
              „Keine klare Empfehlung“ ist eine aktive Entscheidung: Sie kostet
              keine Genauigkeit, sondern vermeidet eine Aussage, die die Daten
              nicht tragen.
            </p>
          </ForTheCurious>
          <SelfCheck
            question="Warum zählt die Bilanz Ratschläge und nicht Tankungen?"
            answer="Weil sonst die eigenen Tankgewohnheiten die Messung verzerren: Wer selten tankt, hätte dann eine bessere Bilanz, ohne dass die Empfehlung besser wäre. Deine Tankungen stehen getrennt in „Ich → Bilanz“."
          />
        </LabBlock>

        {/* ── 5. Glossar ────────────────────────────────────────────── */}
        <LabBlock
          id="glossar"
          open={open.glossar}
          onToggle={() => toggle("glossar")}
          headline="5 · Glossar"
          question={labSection("glossar").question}
          blockRef={(node) => {
            blockRefs.current.glossar = node;
          }}
        >
          <p className="mb-4 text-xs leading-relaxed text-slate-400">
            Jeder Begriff in drei Stufen: ein Satz für alle, ein Beispiel und
            die exakte Definition mit Formel. Deutsch zuerst, Fachwort in
            Klammern — nie umgekehrt.
          </p>
          <GlossaryView />
        </LabBlock>

        {/* ── Spielplatz ────────────────────────────────────────────── */}
        <LabBlock
          id="spielplatz"
          open={open.spielplatz}
          onToggle={() => toggle("spielplatz")}
          headline="Spielplatz"
          question={labSection("spielplatz").question}
          blockRef={(node) => {
            blockRefs.current.spielplatz = node;
          }}
        >
          <p className="text-xs leading-relaxed text-slate-400">
            Freies Prüfen auf echten Vergangenheits-Preisen — nicht auf
            Prognosen, deshalb ehrlich vergleichbar. Nichts hier wird
            gespeichert und nichts ändert dein Profil.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex items-center gap-2">
                <Target size={14} className="text-violet-300" aria-hidden="true" />
                <p className="text-xs font-semibold text-slate-200">
                  Was wäre gewesen, wenn …?
                </p>
              </div>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-300">
                <li>
                  App-Regel (ε = {centPerLiter(eps, 2)}):{" "}
                  <strong className="text-slate-100">
                    {scenario ? `${scenario.hits} von ${scenario.days} Tagen richtig` : "—"}
                  </strong>
                </li>
                <li>
                  Immer sofort tanken wäre gewesen:{" "}
                  <strong className="text-slate-100">{euro(labTotals.commit)} €</strong>{" "}
                  <span className="text-slate-500">
                    bei {deTrimmed(liters, 0)} L
                  </span>
                </li>
                <li>
                  Perfektes Timing (Orakel):{" "}
                  <strong className="text-slate-100">{euro(labTotals.best)} €</strong> —
                  also {euro(Math.max(0, labTotals.best - labTotals.smart))} € mehr als die
                  Regel.
                </li>
              </ul>
              {/* O18: Der Scan ist eine Nachrechnung auf denselben
                  Backtest-Zeilen wie die Bilanz oben — nicht ein Feld, auf
                  das gewartet wird. */}
              {epsScan ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-slate-200">
                    Dieselbe Regel, andere Vorsicht
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-slate-300">
                    {epsScan.map((point) => (
                      <li
                        key={point.eps}
                        className={
                          Math.abs(point.eps - eps) < 1e-9
                            ? "font-semibold text-violet-200"
                            : ""
                        }
                      >
                        ε = {centPerLiter(point.eps, 2)}:{" "}
                        <strong className="text-slate-100">
                          {euro(point.smartEur)} €
                        </strong>{" "}
                        · warten an {point.waits} von {point.n} Tagen
                        {Math.abs(point.eps - eps) < 1e-9 ? " (gewählt)" : ""}
                      </li>
                    ))}
                  </ul>
                  <ReadingAid
                    headline="Die Regel reagiert flach auf ε — kein Feintuning-Wunder."
                    text="Jede Zeile ist dieselbe Regel mit einer anderen Schwelle, nachgerechnet auf denselben Tagen. Große Sprünge wären ein Warnzeichen: Sie hießen, dass ein einzelner Tag die Bilanz dreht."
                  />
                </div>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Ohne Backtest-Tage gibt es nichts nachzurechnen — die Zeilen
                  entstehen aus echter Preishistorie, nicht aus einer Schätzung.
                </p>
              )}
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-xs font-semibold text-slate-200">Eine Station sezieren</p>
              {labData?.stations?.length ? (
                <label className="mt-2 block text-xs text-slate-400">
                  Station
                  <select
                    aria-label="Station für die Detail-Analyse"
                    value={
                      labData.stations.some((s) => s.id === selected?.station_id)
                        ? selected?.station_id
                        : labData.stations[0].id
                    }
                    onChange={(event) => setSelectedId(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                  >
                    {labData.stations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Keine Station im Backtest — der Modell-Lauf füllt die Liste.
                </p>
              )}
              {labRows.length ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {labRows.map((row: any, index: number) => {
                      const outcome = rowOutcome(row, eps, liters);
                      return (
                        <button
                          key={row.day}
                          aria-pressed={index === labDayIdx}
                          onClick={() => setLabDayIdx(index)}
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${
                            index === labDayIdx
                              ? "bg-violet-400/20 text-violet-100"
                              : outcome.hit
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-rose-500/15 text-rose-300"
                          }`}
                        >
                          {row.day.slice(5)}
                        </button>
                      );
                    })}
                  </div>
                  {activeLabDayRow && activeLabOutcome && (
                    <>
                      <ul className="mt-3 space-y-1 text-xs leading-relaxed text-slate-300">
                        <li>
                          Erwartung μ ={" "}
                          <strong className="text-slate-100">
                            {centPerLiter(activeLabDayRow.mu)}
                          </strong>{" "}
                          · Regel:{" "}
                          <strong
                            className={
                              activeLabOutcome.wait ? "text-emerald-300" : "text-sky-300"
                            }
                          >
                            {activeLabOutcome.wait
                              ? `warten bis ~${String(activeLabDayRow.predHour).padStart(2, "0")}:00`
                              : "sofort tanken"}
                          </strong>
                        </li>
                        <li>
                          Realisierte Ersparnis S ={" "}
                          <strong
                            className={
                              activeLabDayRow.s > 0 ? "text-emerald-300" : "text-rose-300"
                            }
                          >
                            {centPerLiter(Math.abs(activeLabDayRow.s))}{" "}
                            {activeLabDayRow.s >= 0 ? "günstiger" : "teurer"}
                          </strong>{" "}
                          · Urteil:{" "}
                          <strong
                            className={activeLabOutcome.hit ? "text-emerald-300" : "text-rose-300"}
                          >
                            {activeLabOutcome.hit ? "richtig" : "daneben"}
                          </strong>
                        </li>
                      </ul>
                      {dayCurve.length > 0 && (
                        <div className="mt-3">
                          <LineChart
                            height={190}
                            series={[
                              {
                                name: `Erwartung vs. ${anchorLabel}`,
                                color: c.marker,
                                pts: dayCurve,
                              },
                            ]}
                            marks={[
                              { x: anchorHour, color: c.accent, label: anchorLabel },
                              ...(activeLabDayRow.predHour != null
                                ? [
                                    {
                                      x: activeLabDayRow.predHour,
                                      color: c.positive,
                                      label: "prognostizierte Tiefstphase",
                                    },
                                  ]
                                : []),
                            ]}
                            xTicks={autoTimeTicks(0, 24)}
                            yFmt={(value) => `${deTrimmed(value, 1)} ct`}
                            ariaDescription="Tageskurve der Backtest-Zeile: erwartete Preisdifferenz in Cent je Stunde gegenüber dem Tagesanker, mit Markierungen für Anker und prognostizierte Tiefstphase."
                          />
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Für diese Station liegt noch kein Backtest-Tag vor. Der
                  tägliche Modell-Lauf füllt ihn — ohne Zutun.
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-semibold text-slate-200">Echte Preise im Zeitraum</p>
            <div className="mt-2 flex flex-wrap gap-1 text-xs">
              {[
                { hours: 24, label: timeSpanLabel(24) },
                { hours: 72, label: timeSpanLabel(72) },
                { hours: 168, label: timeSpanLabel(168) },
              ].map((option) => (
                <button
                  key={option.hours}
                  aria-pressed={spanHours === option.hours}
                  onClick={() => setSpanHours(option.hours)}
                  className={`rounded-md border px-2 py-1 font-semibold ${
                    spanHours === option.hours
                      ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
                      : "border-slate-800 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {option.label}
                </button>
              ))}
              <span className="self-center text-slate-500">· {spanLabel}</span>
            </div>
            {history.error || history.data?.error_code ? (
              <div className="mt-3">
                <LoadError
                  errorCode={history.data?.error_code || history.errorCode}
                  fallback="Die Preis-Reihe konnte nicht geladen werden."
                  onRetry={refreshNow}
                  compact
                />
              </div>
            ) : observations.length ? (
              <div className="mt-3">
                <LineChart
                  height={200}
                  series={observations}
                  gapMinutes={30}
                  xTicks={autoTimeTicks(
                    Date.now() - spanHours * 3600000,
                    Date.now(),
                  )}
                  yFmt={(value) => euro(value, 3)}
                  ariaDescription={`Beobachtete Preise der gewählten Station, ${spanLabel}, in €/L. Lücken heißen: keine offene Meldung — geschätzt wird nichts.`}
                />
                <ReadingAid
                  headline={`Gemessene Preise: ${spanLabel}.`}
                  text="Lücken sind ehrlich: Wo keine offene Meldung vorliegt, steht keine Linie. Die Punkte sind Rohdaten, kein Modell."
                />
              </div>
            ) : history.pending && !history.data ? (
              <div className="mt-3">
                <SkeletonChart height="h-48" label="Preis-Reihe wird geladen" />
              </div>
            ) : (
              <div className="mt-3">
                <Empty>
                  Keine Preise in diesem Zeitraum — Meldungen entstehen nur zu
                  den Polling-Zeiten (06–24 Uhr).
                </Empty>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <button
              onClick={() => {
                const rows: string[] = [
                  "ausgesprochen_am;aktion;station;stadt;fenster_start;fenster_ende;preis_damals;preis_fenster;ergebnis;verlust_eur",
                  ...diaryEntries.map((entry) =>
                    [
                      entry.emitted_at ?? "",
                      entry.action ?? "",
                      entry.station_id ?? "",
                      entry.city ?? "",
                      entry.window_start ?? "",
                      entry.window_end ?? "",
                      entry.price_then ?? "",
                      entry.price_window ?? "",
                      entry.outcome ?? "",
                      entry.regret_eur ?? "",
                    ].join(";"),
                  ),
                ];
                const blob = new Blob([rows.join("\n")], {
                  type: "text/csv;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "tankapp-tagebuch.csv";
                link.click();
                URL.revokeObjectURL(url);
              }}
              className="font-semibold text-violet-300 underline underline-offset-4 hover:text-violet-200"
            >
              Tagebuch als CSV exportieren ({diaryEntries.length} Einträge)
            </button>
            <span className="text-slate-500">
              Export enthält nur abgerechnete Empfehlungen — keine Schätzungen.
            </span>
            <button
              onClick={() => {
                const canvas = document.querySelector("svg");
                if (!canvas) return;
                const blob = new Blob([new XMLSerializer().serializeToString(canvas)], {
                  type: "image/svg+xml",
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "tankapp-labor.svg";
                link.click();
                URL.revokeObjectURL(url);
              }}
              className="font-semibold text-violet-300 underline underline-offset-4 hover:text-violet-200"
            >
              Erstes Diagramm als SVG exportieren
            </button>
          </div>
          <ForTheCurious>
            <p>
              Der Scan über ε ist eine reine Nachrechnung auf den
              Backtest-Zeilen: Für jeden Tag wird die Regel mit der neuen
              Schwelle neu ausgewertet. Deshalb ist er sofort da — und deshalb
              ändert er nichts an der Empfehlung der App.
            </p>
          </ForTheCurious>
          <SelfCheck
            question="Ist ein höheres ε automatisch sicherer?"
            answer="Nein. Ein höheres ε lässt die App seltener warten — sicherer wird die Aussage dadurch nicht, nur seltener. Ob es besser war, steht in der Bilanz, nicht im Gefühl."
          />
        </LabBlock>
      </div>

      <FreshnessLine
        text={`${h?.version ? `TankApp ${h.version} · ` : ""}Labor-Stand: ${
          statsSummaryRes.data?.generated_at
            ? timeLabel(statsSummaryRes.data.generated_at)
            : "Kennzahlen nicht geladen"
        }`}
        tone="ok"
        place={activeCity}
        extra={best ? ` · Vergleichsanker: ${best.name}` : ""}
      />
    </section>
  );
}
