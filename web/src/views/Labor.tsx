// Labor — drei Fragen statt Sammelakte (docs/planung/UX-NEUENTWURF.md §5,
// Batch 2 / 0.74.0). Frage des Bereichs: „Stimmt, was die App sagt — und
// kann ich ihr vertrauen?“
//
// Das Labor ist seit Batch 2 **ein** Blatt mit drei Blöcken, sonst nichts:
//   1 · Kann ich vertrauen?        — ein Satz Zählung + Tagebuch (filterbar)
//   2 · Wie gut ist die Prognose?  — eine Kurve (erwartet vs. echt) + ein Satz
//   3 · Wie rechnet die App?       — drei Schritte + „Details für Neugierige“
//
// Gestrichen bzw. verlagert (§5, §7): vier Sub-Tabs, acht offene
// Parameterkarten, Güte-Panel (PICP, MASE, CUSUM, Brier, Reliability),
// Heatmap-Schalter, Spielplatz, Experimente, Tankprofil-Rechner,
// Einflüsse-Balken und das eingebettete Glossar. Rohdaten, CSV-Exporte und
// der API-Explorer wohnen als Betreiber-Sicht in „System“; die Heatmap
// bleibt als einzige Grafik in den Details (Entscheidung 05.10.2026).
//
// Die View rendert, sie entscheidet nichts (D1): Zählung, Kurve, Sätze und
// Fachwerte kommen aus `laborModel.ts`, `guide.ts`, `lab.ts` und sind dort
// getestet. Zahlen laufen ausschließlich über die Formatter in `data.ts`.

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronRight } from "lucide-react";
import { FreshnessLine } from "../components/FreshnessLine";
import { HeatmapGrid } from "../components/HeatmapGrid";
import { LineChart } from "../components/LineChart";
import { LoadError } from "../components/LoadError";
import { SkeletonChart, SkeletonPanel } from "../components/Skeleton";
import { Empty, panel } from "../components/ui";
import {
  autoTimeTicks,
  centPerLiter,
  countLabel,
  euro,
  percentLabel,
  timeLabel,
} from "../data";
import { accuracySentence } from "../guide";
import {
  DIARY_FILTERS,
  PARAM_CARDS,
  diaryActionWord,
  diaryCountLabel,
  diaryEmptyNote,
  diaryOutcome,
  diaryStamp,
  groupDiaryEntries,
  labBlock,
  labBlockAnchor,
  labBlockForSection,
  type LabBlockId,
  type DiaryFilterId,
  type LabSectionId,
} from "../lab";
import { useOverview } from "../state/overview";
import { useLaborModel } from "./laborModel";

export interface LaborViewProps {
  focusSection: LabSectionId | null;
  onFocusHandled: () => void;
  onNavigate: (target: any) => void;
  onOpenGlossary: () => void;
}

/**
 * Ein Block: Nummer und Alltagsfrage kommen aus `LAB_BLOCKS` (eine Quelle
 * für den Wortlaut), Inhalt und Ref aus der Ansicht. Genau drei davon.
 */
function LabBlockCard({
  block,
  children,
  blockRef,
}: {
  block: LabBlockId;
  children: React.ReactNode;
  blockRef?: (node: HTMLElement | null) => void;
}) {
  const entry = labBlock(block);
  const id = labBlockAnchor(block);
  return (
    <section
      id={id}
      ref={blockRef}
      aria-labelledby={`${id}-title`}
      className={`${panel} scroll-mt-24 p-4 sm:p-5`}
    >
      <h2 id={`${id}-title`} className="text-sm font-semibold text-slate-100">
        {/* Die Nummer ist Dekoration: Sie ordnet die drei Fragen, gehört
            aber nicht in den vorgelesenen Namen des Abschnitts. */}
        <span className="mr-1.5 font-mono text-violet-300" aria-hidden="true">
          {entry.number} ·
        </span>
        {entry.question}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function LaborView(props: LaborViewProps) {
  const { focusSection, onFocusHandled, onOpenGlossary } = props;
  const ov = useOverview();
  const {
    activeCity,
    diary,
    forecast,
    fuel,
    heatmap,
    refreshNow,
    selection,
    stations,
    statsSummaryRes,
  } = ov;

  // Schwellen-Anker des Backtests — dieselbe Zahl, mit der die Empfehlung
  // rechnet (`defaultEps`), nie ein zweiter Hardcode.
  const eps = statsSummaryRes.data?.backtest?.defaultEps ?? 1;
  const {
    f,
    metrics,
    observations,
    modelSeries,
    fanBand80,
    forecastWindow,
    forecastMarks,
    labData,
    anchorHour,
    labTotals,
  } = useLaborModel(ov, eps);

  const [diaryFilter, setDiaryFilter] = useState<DiaryFilterId>("all");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [horizonDays, setHorizonDays] = useState<number | null>(null);
  const blockRefs = useRef<Record<string, HTMLElement | null>>({});

  // Erklär-Treppe: ?section=… springt punktgenau auf den Block, der die Zahl
  // beweist. Alte Karten-Anker (karte-6-selektion) öffnen die Details.
  useEffect(() => {
    if (!focusSection) return;
    const raw = String(focusSection);
    if (raw.startsWith("karte-")) {
      setDetailsOpen(true);
      const card = PARAM_CARDS.find((entry) => entry.anchor === raw);
      setTimeout(() => {
        document.getElementById(card?.anchor ?? "karte-1-struktur")?.scrollIntoView?.({
          behavior: "smooth",
          block: "start",
        });
      }, 60);
      onFocusHandled();
      return;
    }
    const block = labBlockForSection(focusSection as LabSectionId);
    if (block === "rechenweg") setDetailsOpen(true);
    blockRefs.current[block]?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    onFocusHandled();
  }, [focusSection, onFocusHandled]);

  const horizon = horizonDays ?? ov.horizon;
  const currentHorizon = ov.horizon;
  const points =
    (horizon === 3 ? f?.points_3d : horizon === 7 ? f?.points_7d : f?.points) ?? [];
  const outOfRange =
    horizonDays !== null && horizonDays !== currentHorizon && points.length === 0;

  const fuelLabel = fuel === "diesel" ? "Diesel" : (fuel ?? "").toUpperCase();

  // ---- Block 1: Zählung -----------------------------------------------------
  const personal = ov.decideRes?.data?.personal_stats?.advice ?? null;
  const advice = statsSummaryRes.data?.live_advice ?? null;
  const hits = personal?.last_30d_hits ?? advice?.wins ?? null;
  const total =
    personal?.last_30d_total ??
    (advice ? (advice.wins ?? 0) + (advice.losses ?? 0) + (advice.ties ?? 0) : null);
  const counts = advice
    ? `${countLabel(advice.wins)} richtig · ${countLabel(advice.losses)} daneben · ${countLabel(advice.ties)} unentschieden`
    : null;

  const diaryEntries = diary.data?.entries ?? [];
  const shownDiary = groupDiaryEntries(
    diaryEntries.filter((entry) =>
      diaryFilter === "all"
        ? true
        : diaryFilter === "void"
          ? entry.outcome !== "win" && entry.outcome !== "loss" && entry.outcome !== "tie"
          : entry.outcome === diaryFilter,
    ),
  );
  const diaryTotal = diary.data?.settled_total;
  const diaryCapped = diaryTotal == null || diaryTotal > diaryEntries.length;

  // ---- Block 2: Kurve + ein Satz -------------------------------------------
  // `segments` liefert die echten Preise bereits als Reihen (Lücken bleiben
  // Lücken) — dieselbe Quelle wie die Tageskurve in „Jetzt“.
  const realSeries = useMemo(
    () => (observations ?? []).filter((segment) => segment.pts.length > 0),
    [observations],
  );
  const chartSeries = [...modelSeries, ...realSeries];
  const maeCt = metrics?.mae_ct ?? null;
  const forecastSentence =
    maeCt !== null
      ? `Im Schnitt ${centPerLiter(maeCt)} daneben.`
      : "Wie genau die Prognose ist, zeigt der Vergleich — die Zahl dazu entsteht mit dem ersten echten Abgleich.";

  const horizonOptions: Array<{ days: number; label: string; enabled: boolean }> = [
    { days: 0, label: "24 Stunden", enabled: true },
    { days: 3, label: "+3 Tage", enabled: !!f?.points_3d?.length },
    { days: 7, label: "+7 Tage", enabled: !!f?.points_7d?.length },
  ];

  // ---- Block 3: Fachwerte + Heatmap ---------------------------------------
  const deltas = (selection.data?.stations ?? []).filter((row) =>
    Number.isFinite(row.delta_ct ?? Number.NaN),
  );
  const deltaSpan = deltas.length
    ? `${centPerLiter(Math.min(...deltas.map((row) => row.delta_ct as number)))} bis ${centPerLiter(
        Math.max(...deltas.map((row) => row.delta_ct as number)),
      )}`
    : null;
  const reach = labData
    ? [labData.daysTrain, labData.daysEval].filter((value) => value != null).join(" + ")
    : null;
  const gauges: Array<{ label: string; value: string }> = [
    { label: "Punkte im Vergleich", value: metrics?.points ? countLabel(metrics.points) : "—" },
    { label: "Fehler im Schnitt", value: centPerLiter(maeCt) },
    { label: "Backtest-Tage (Training + Prüfung)", value: reach ?? "—" },
    {
      label: "Regel richtig / Vorteil vorhanden",
      value:
        labTotals.hitRate != null && labTotals.hitFreq != null
          ? `${percentLabel(labTotals.hitRate * 100, 0)} / ${percentLabel(labTotals.hitFreq * 100, 0)}`
          : "—",
    },
    { label: "Preis-Abstand der Stationen", value: deltaSpan ?? "—" },
  ];

  return (
    <section aria-labelledby="labor-title" className="pb-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="labor-title" className="text-2xl font-bold tracking-tight text-slate-100">
            Stimmt das?
          </h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
            Drei Fragen, mehr nicht. Wer nur tanken will, braucht keine davon —
            die Antwort in „Jetzt“ funktioniert ohne.
          </p>
        </div>
        <button
          onClick={onOpenGlossary}
          className="tap-44 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-500/40"
        >
          <BookOpen size={14} aria-hidden="true" />
          Glossar
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {/* 1 · Kann ich vertrauen? */}
        <LabBlockCard
          block="sicherheit"
          blockRef={(node) => {
            blockRefs.current.sicherheit = node;
          }}
        >
          <p className="text-sm leading-relaxed text-slate-200">
            {accuracySentence(hits, total)}
          </p>
          {counts && (
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {counts}
              {advice?.n_void ? ` · ${countLabel(advice.n_void)} nicht bewertbar` : ""} ·
              gezählt wird nach dem Fensterende, nicht geschätzt.
            </p>
          )}

          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-200">
                Prognose-Tagebuch · {activeCity || "kein Ort"}
              </p>
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
                    stations.find((station) => station.station_id === entry.station_id)?.name ??
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
        </LabBlockCard>

        {/* 2 · Wie gut ist die Prognose? */}
        <LabBlockCard
          block="prognose"
          blockRef={(node) => {
            blockRefs.current.prognose = node;
          }}
        >
          <p className="text-sm leading-relaxed text-slate-200">{forecastSentence}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Blau ist der erwartete Preis, gelb die echten Messwerte, das Band ist
            „meistens drin“.{" "}
            {forecastWindow
              ? `Zeitraum: ${timeLabel(new Date(forecastWindow[0]).toISOString())} bis ${timeLabel(new Date(forecastWindow[1]).toISOString())}.`
              : ""}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Blickweite:</span>
            {horizonOptions.map((option) => {
              const active = horizon === option.days;
              return (
                <button
                  key={option.days}
                  disabled={!option.enabled}
                  aria-pressed={active}
                  onClick={() => setHorizonDays(option.days)}
                  className={`rounded-lg border px-2.5 py-1 font-semibold transition-colors ${
                    active
                      ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
                      : option.enabled
                        ? "border-slate-700 text-slate-400 hover:text-slate-200"
                        : "cursor-not-allowed border-slate-800 text-slate-600"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
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
          ) : forecast.pending && !forecast.data ? (
            <div className="mt-3">
              <SkeletonChart height="h-56" label="Modell-Ausblick wird berechnet" />
            </div>
          ) : forecastWindow && chartSeries.length ? (
            <div className="mt-3">
              <LineChart
                series={chartSeries}
                bands={fanBand80}
                marks={forecastMarks}
                xDomain={forecastWindow}
                xTicks={autoTimeTicks(forecastWindow[0], forecastWindow[1])}
                yFmt={(value) => euro(value, 3)}
                ariaLabel="Erwarteter und echter Preis"
                ariaDescription={`Erwarteter Preis (blau) und echte Messwerte (gelb) über ${
                  horizon === 7 ? "sieben Tage" : horizon === 3 ? "drei Tage" : "24 Stunden"
                }.${realSeries.length === 0 ? " Noch keine echten Messwerte im Fenster." : ""}`}
              />
            </div>
          ) : outOfRange ? (
            <div className="mt-3">
              <SkeletonChart height="h-56" label="Ausblick wird geladen" />
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-xs leading-relaxed text-slate-300">
                Ohne veröffentlichten Modell-Lauf gibt es keinen Ausblick zu
                zeigen. Die Linie entsteht mit dem ersten Modell-Update; bis
                dahin gilt der Preisvergleich in „Jetzt“.
              </p>
            </div>
          )}
        </LabBlockCard>

        {/* 3 · Wie rechnet die App? */}
        <LabBlockCard
          block="rechenweg"
          blockRef={(node) => {
            blockRefs.current.rechenweg = node;
          }}
        >
          <ol className="list-decimal space-y-2 pl-4 text-sm leading-relaxed text-slate-200">
            <li>
              <strong className="font-semibold">Tagesmuster der Stadt.</strong> Der
              übliche Rhythmus: Sprung um 12 Uhr, danach fallend, Sonntag anders.
            </li>
            <li>
              <strong className="font-semibold">Aktuelle Lage.</strong> Die letzten
              gemessenen Preise verschieben den erwarteten Verlauf.
            </li>
            <li>
              <strong className="font-semibold">
                12-Uhr-Regel ({anchorHour}:00).
              </strong>{" "}
              Nach dem Mittagssprung darf der Preis bis zum nächsten Mittag nur
              noch fallen.
            </li>
          </ol>

          <button
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            aria-controls="labor-details"
            className="tap-44 mt-3 inline-flex items-center gap-1 text-xs font-semibold text-violet-200 hover:text-violet-100"
          >
            Details für Neugierige
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={`transition-transform ${detailsOpen ? "rotate-90" : ""}`}
            />
          </button>

          {detailsOpen && (
            <div id="labor-details" className="mt-3 space-y-4 border-t border-slate-800 pt-3">
              <div>
                <p className="text-xs font-semibold text-slate-200">
                  Die acht Bausteine — in der Reihenfolge, in der sie rechnen
                </p>
                <ol className="mt-2 space-y-2">
                  {PARAM_CARDS.map((card) => (
                    <li
                      key={card.id}
                      id={card.anchor}
                      className="scroll-mt-24 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                    >
                      <p className="text-xs font-semibold text-slate-200">
                        <span className="mr-1.5 font-mono text-violet-300">
                          {card.number}
                        </span>
                        {card.title}
                      </p>
                      <p className="mt-1 font-mono text-[0.6875rem] leading-relaxed text-slate-500 [overflow-wrap:anywhere]">
                        {card.chain}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-300 [overflow-wrap:anywhere]">
                        {card.sentence}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-200">Fachwerte</p>
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                  {gauges.map((gauge) => (
                    <div key={gauge.label} className="flex items-baseline justify-between gap-3">
                      <dt className="text-slate-400">{gauge.label}</dt>
                      <dd className="font-mono tabular-nums text-slate-200">{gauge.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-200">
                  Wochenrhythmus · {activeCity || "kein Ort"} · {fuelLabel}
                </p>
                {heatmap.error || heatmap.data?.error_code ? (
                  <div className="mt-2">
                    <LoadError
                      errorCode={heatmap.data?.error_code || heatmap.errorCode}
                      fallback="Der Wochenrhythmus konnte nicht geladen werden."
                      onRetry={refreshNow}
                      retryLabel="Wochenrhythmus neu laden"
                      compact
                    />
                  </div>
                ) : heatmap.pending && !heatmap.data ? (
                  <div className="mt-2">
                    <SkeletonChart height="h-40" label="Wochenrhythmus wird geladen" />
                  </div>
                ) : heatmap.data ? (
                  <div className="mt-2">
                    <HeatmapGrid
                      heatmap={heatmap.data}
                      livePhase={statsSummaryRes.data?.live_phase ?? null}
                    />
                  </div>
                ) : (
                  <div className="mt-2">
                    <Empty>Noch kein Wochenrhythmus geladen.</Empty>
                  </div>
                )}
              </div>

              <p className="text-xs leading-relaxed text-slate-500">
                Rohdaten, CSV-Exporte und der API-Explorer stehen in „System“;
                Rohpreise und Fachwerte dieser Ansicht kommen aus denselben
                Antworten der App.
              </p>
            </div>
          )}
        </LabBlockCard>
      </div>

      {/* Frische-Fußzeile — fester Platz in dieser Ansicht */}
      <FreshnessLine
        text={ov.data ? `Preise vor Ort` : "Preise werden geladen"}
        tone={ov.data ? "ok" : "warn"}
        place={activeCity}
      />
    </section>
  );
}
