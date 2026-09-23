// B5 Sub-Tab: Überblick — Fan-Chart geführt + Vertrauens-Konto + Tagebuch
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Empty } from "../../components/ui";
import { DataReachNote } from "../../components/DataReach";
import { LoadError } from "../../components/LoadError";
import { SkeletonChart, SkeletonPanel } from "../../components/Skeleton";
import { LineChart } from "../../components/LineChart";
import { useChartPalette } from "../../chartTheme";
import { lineChartAlt } from "../../chartAlt";
import {
  autoTimeTicks,
  centPerLiter,
  countLabel,
  deNumber,
  deTrimmed,
  euro,
  euroPerLiter,
  percentLabel,
  timeLabel,
  type Point,
} from "../../data";
import {
  DIARY_FILTERS,
  diaryActionWord,
  diaryCountLabel,
  diaryEmptyNote,
  diaryOutcome,
  diaryStamp,
  groupDiaryEntries,
  labSection,
  type DiaryFilterId,
  type LabSectionId,
} from "../../lab";
import { useOverview } from "../../state/overview";
import { useLaborModel } from "../laborModel";
import {
  ForTheCurious,
  LabBlock,
  ReadingAid,
  SelfCheck,
  SketchNote,
  ThreeSentences,
} from "./components";
import { GlossaryView } from "../Glossary";

export function UeberblickView({
  focusSection,
  onFocusHandled,
}: {
  focusSection: LabSectionId | null;
  onFocusHandled: () => void;
}) {
  const c = useChartPalette();
  const ov = useOverview();
  const {
    activeCity,
    best,
    diary,
    forecast,
    fuel,
    gateStatus,
    h,
    history,
    horizon,
    horizonDays,
    m7Line,
    m7ScopeLine,
    observations,
    refreshNow,
    selection,
    selected,
    setHorizon,
    stations,
    statsSummaryRes,
    transitionLine,
  } = ov;

  const [eps] = useState(1.0);
  const [labDayIdx] = useState(13);
  const {
    f,
    fanBand80,
    fanBand95,
    forecastMarks,
    forecastWindow,
    labData,
    labTotals,
    modelSeries,
    thinSupportPoints,
    livePointsForChart,
  } = useLaborModel(ov, eps, labDayIdx);

  const fuelLabel = fuel === "diesel" ? "Diesel" : fuel.toUpperCase();

  const [open, setOpen] = useState<Record<LabSectionId, boolean>>({
    prognose: true,
    sicherheit: false,
    stationen: false,
    lernen: true,
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
    blockRefs.current[id]?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (!focusSection) return;
    if (focusSection === "prognose" || focusSection === "lernen" || focusSection === "glossar") {
      jumpTo(focusSection);
      onFocusHandled();
    }
  }, [focusSection, onFocusHandled]);

  const advice = statsSummaryRes.data?.live_advice ?? null;
  const wins = Number(advice?.wins ?? 0);
  const losses = Number(advice?.losses ?? 0);
  const ties = Number(advice?.ties ?? 0);
  const settled = wins + losses + ties || Number(advice?.n ?? 0);
  const trustPercent =
    advice && settled > 0 ? ((wins + ties * 0.5) / settled) * 100 : null;
  const promised = useMemo(() => {
    const rows = (advice?.reliability ?? []).filter(
      (b) => b.count > 0 && Number.isFinite(b.mean_p),
    );
    if (!rows.length) return null;
    const n = rows.reduce((sum, b) => sum + b.count, 0);
    if (!n) return null;
    return (rows.reduce((sum, b) => sum + b.mean_p * b.count, 0) / n) * 100;
  }, [advice]);

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

  const observationPts = useMemo(
    () =>
      (history.data?.points ?? []).filter(
        (p): p is Point & { price: number } =>
          Number.isFinite(Date.parse(p.timestamp)) && p.price !== null,
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
    <div className="grid grid-cols-1 gap-3">
      {/* Vertrauens-Konto — immer sichtbar */}
      <div className="rounded-lg border border-violet-500/20 bg-slate-900/70 p-4 sm:p-5">
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
              {settled > 0 ? ` aus ${settled} abgerechneten Empfehlungen` : " — noch nichts zu zählen"}
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
              `)`
            : "Das Konto füllt sich mit der ersten abgerechneten Empfehlung — gezählt wird, nicht geschätzt. Solange die Liste leer ist, steht hier kein Prozentwert."}
        </p>
        {m7Line && <p className="mt-1 text-xs leading-relaxed text-slate-500">{m7Line}</p>}
        {m7ScopeLine && (
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{m7ScopeLine}</p>
        )}
        {transitionLine && (
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{transitionLine}</p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          {h?.version ? `TankApp ${h.version} · ` : ""}
          Labor-Stand:{" "}
          {statsSummaryRes.data?.generated_at
            ? timeLabel(statsSummaryRes.data.generated_at)
            : "Kennzahlen nicht geladen"}
          {best ? ` · Vergleichsanker: ${best.name}` : ""}
        </p>
      </div>

      {/* Prognose */}
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
            {["1 Linie", "2 + 80 %-Band", "3 + 95 %-Band", "4 echte Preise"].map((label, index) => (
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
            ))}
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
                Die echten Punkte sind gemessene Preise aus dem gewählten Zeitraum — kein Modell, keine
                Schätzung.
              </SketchNote>
            )}
            {fanStep >= 1 && thinSupportPoints.length > 0 && (
              <p className="mb-2 flex items-center gap-1.5 text-xs leading-relaxed text-amber-200">
                <span aria-hidden="true" className="inline-block size-2 rounded-full border border-amber-300" />
                Hohle Punkte im Band: dünn gestützte Zeit-Slots (mindestens einer hat nur{" "}
                {Math.min(...thinSupportPoints.map((p) => p.support_days ?? Infinity))} Tage). Das Band bleibt
                sichtbar, ist aber weniger belastbar.
              </p>
            )}
            <LineChart
              series={forecastSeries}
              bands={forecastBands}
              marks={fanStep >= 1 ? forecastMarks : []}
              xDomain={forecastWindow}
              xTicks={autoTimeTicks(forecastWindow[0], forecastWindow[1])}
              yFmt={(value) => euro(value, 3)}
              ariaLabel="Prognose-Fächer"
              ariaDescription={`Prognose-Fächer, Schritt ${fanStep + 1} von 4${
                fanStep >= 1 && thinSupportPoints.length
                  ? ` (${countLabel(thinSupportPoints.length)} hohle Markierungen)`
                  : ""
              }. ${lineChartAlt({
                series: forecastSeries,
                bands: forecastBands,
                fmtY: (value) => euroPerLiter(value),
                fmtX: (x) => `${timeLabel(new Date(x).toISOString())} Uhr`,
              })}`}
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
              Ohne veröffentlichten Modell-Lauf gibt es keinen Ausblick zu zeigen. Die Linie entsteht erst mit
              dem ersten Modell-Update; bis dahin gilt der Preisvergleich in „Jetzt“.
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
            Je Station schätzt ein Strukturmodell (Tages-/Wochenform) plus AR(2)-Rest die Verteilung der nächsten
            Stunden; die Bänder sind Quantile der Bootstrap-Verteilung.
          </p>
          <div className="rounded-lg bg-slate-950/70 p-2 font-mono text-xs text-slate-300">
            q̂(τ, h) mit τ ∈ {"{"}.005, .025, .10, .50, .90, .975, .995{"}"} · Band₈₀ = [q̂.₁₀, q̂.₉₀] · Band₉₅ =
            [q̂.₀₂₅, q̂.₉₇₅]
          </div>
        </ForTheCurious>
        <SelfCheck
          question="An welchem Tag lag der echte Preis außerhalb des Bandes?"
          answer="Schritt 4 zeigt die echten Punkte über dem Band. Punkte außerhalb des hellen Bandes kommen vor — sie sind der Grund, warum vor dem Prozentwert die Kalibrierung geprüft wird (Abschnitt 2)."
        />
      </LabBlock>

      {/* Lernen */}
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
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs font-semibold text-slate-200">Bilanz der Ratschläge</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {labTotals.n === 0
              ? "Ohne Backtest-Tage keine Bilanz: Die App rechnet sie erst, wenn genug echte Preishistorie da ist."
              : `Regel-Ergebnis ${euro(labTotals.smart)} € · Orakel ${euro(labTotals.best)} € · Ø Mehrkosten ${euro(labTotals.regretEur)} € bei ${deTrimmed(ov.liters, 0)} L.`}
          </p>
        </div>
        <ForTheCurious>
          <p>
            Das <strong className="text-slate-300">Advice-Ledger</strong> zählt Ratschläge gegen die Realität —
            es braucht keine Tankung. Das <strong className="text-slate-300">Wallet-Ledger</strong> zählt deine
            Euro gegen den Median und braucht Belege. Beide getrennt: Können der App und Nutzen im Geldbeutel.
          </p>
        </ForTheCurious>
      </LabBlock>

      {/* Glossar */}
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
          Jeder Begriff in drei Stufen: ein Satz für alle, ein Beispiel und die exakte Definition mit Formel.
          Deutsch zuerst, Fachwort in Klammern — nie umgekehrt.
        </p>
        <GlossaryView />
      </LabBlock>
    </div>
  );
}
