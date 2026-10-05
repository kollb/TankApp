// Woche — der Zeit-Planer (docs/produkt/UI.md, Bereiche;
// docs/planung/UX-NEUENTWURF.md §4).
//
// Frage: „Wann in den nächsten Tagen soll ich tanken?“ Antwort: eine
// Bestenliste mit höchstens drei Einträgen, sortiert nach Ersparnis.
// Kein 7-Tage-Raster, keine Detailkarte, keine zweite Liste, keine
// Wochenlinie (deren Balken „höher = billiger“ gegen jede Lesegewohnheit
// lief): Der Server liefert maximal drei Fenster — vier Darstellungen
// dafür waren drei zu viel.
//
// Die View rendert, sie entscheidet nichts (D1): Einträge, Ersparnis,
// Sicherheit als ein Wort und die Tank-Zeile kommen aus `week.ts` und sind
// dort getestet. Der Tankstand wird hier nur **angezeigt** — gepflegt wird
// er an genau einem Ort („Ich“ → Fahrzeug, §6).

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Gauge } from "lucide-react";
import { BottomSheet } from "../components/BottomSheet";
import { DayCurve } from "../components/DayCurve";
import { FreshnessChip } from "../components/FreshnessChip";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { RegimeNotice } from "../components/RegimeNotice";
import { SkeletonPanel } from "../components/Skeleton";
import { Empty, panel } from "../components/ui";
import {
  fuelLabel,
  type DecideResult,
  type Fuel,
  type ResourceState,
} from "../data";
import type { LabSectionId } from "../lab";
import {
  learningNote,
  nowDayRow,
  nowFreshness,
  type NowTarget,
} from "../now";
import type { StripCell } from "../strip";
import {
  WEEK_UNCERTAIN_NOTE,
  weekEntryWhy,
  weekRanking,
  weekTankLine,
  type WeekEntry,
} from "../week";

export interface WocheViewProps {
  activeCity: string;
  fuel: Fuel | string | null;
  stationsCount: number;
  decideRes: ResourceState<DecideResult>;
  priceNow: number | null;
  /** Tankstand (A2) — hier nur Anzeige, Pflege in „Ich“. */
  tankPercent: number | null;
  /** Sprung dorthin, wo der Tankstand gepflegt wird (genau ein Ort). */
  onEditTank: () => void;
  tankCapacity: number;
  /** Tageskurve des heutigen Tages (Messwerte) — Detail des ersten Eintrags. */
  stripCells: StripCell[];
  forecastAt: string | null;
  pricesAt: string | null;
  onRetry: () => void;
  onNavigate: (target: NowTarget) => void;
  onDeepen: (section: LabSectionId) => void;
  /** Nur für Tests; sonst Date.now(). */
  now?: number;
}

export function WocheView(props: WocheViewProps) {
  const {
    activeCity,
    decideRes,
    fuel,
    forecastAt,
    now,
    onDeepen,
    onEditTank,
    onNavigate,
    onRetry,
    pricesAt,
    stationsCount,
    stripCells,
    tankCapacity,
    tankPercent,
  } = props;
  const decide = decideRes.data ?? null;
  const problemCode =
    decide?.error_code ?? (decideRes.error ? decideRes.errorCode : null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ranking = useMemo(
    () =>
      weekRanking({
        windows: decide?.windows_week ?? null,
        notice: decide?.regime_notice ?? null,
        decide,
        now,
      }),
    [decide, now],
  );
  // Auswahl zurücksetzen, wenn das gewählte Fenster verschwindet — sonst
  // zeigt das Detail eine Leere.
  useEffect(() => {
    if (
      selectedId !== null &&
      !ranking.some((entry) => entry.id === selectedId)
    ) {
      setSelectedId(null);
    }
  }, [selectedId, ranking]);

  const selected: WeekEntry | null =
    ranking.find((entry) => entry.id === selectedId) ?? ranking[0] ?? null;
  const tankLine = weekTankLine(decide?.tank ?? null, tankPercent, tankCapacity);
  const freshness = nowFreshness({ pricesAt, forecastAt, now });
  const day = nowDayRow(stripCells);
  const setup = stationsCount === 0 && !decideRes.error;
  const learning = learningNote(decide);
  const why = selected
    ? weekEntryWhy(selected, decide, props.priceNow, now)
    : null;
  /** Die Tageskurve gehört zum heutigen Eintrag — weiter voraus gibt es
   *  keine Messwerte, und geschätzt wird nichts (§8). */
  const dayForEntry = selected && selected.index === 0 ? day : null;

  return (
    <section aria-labelledby="woche-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1
          id="woche-title"
          className="text-2xl font-bold tracking-tight text-slate-100"
        >
          Woche
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {activeCity ? <span>{activeCity}</span> : null}
          {fuel ? <span>· {fuelLabel(fuel)}</span> : null}
          <FreshnessChip label={freshness.chip} tone={freshness.tone} />
        </p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Wann in den nächsten Tagen — als Nachschlagewerk, kein Wecker.
      </p>

      {/* ① Tank: nur Anzeige. Die Pflege liegt an genau einem Ort („Ich“). */}
      <div className={`${panel} mt-4 flex flex-wrap items-center justify-between gap-2 p-4`}>
        <div className="flex min-w-0 items-center gap-2 text-xs text-slate-300">
          <Gauge size={15} className="shrink-0 text-emerald-400" aria-hidden="true" />
          <span className="font-semibold">{tankLine.text}</span>
        </div>
        <button
          onClick={onEditTank}
          className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-600"
        >
          Ändern
        </button>
      </div>

      {/* Preisniveau-Termin (Tankrabatt): ordnet die Zahlen darunter ein. */}
      <RegimeNotice notice={decide?.regime_notice} className="mt-4" />

      {/* ② Bestenliste — höchstens drei Einträge, sortiert nach Ersparnis. */}
      <div className="mt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <CalendarDays size={15} className="text-emerald-400" aria-hidden="true" />
          Wann tanken?
        </h2>
        {setup ? (
          <div className={`${panel} mt-2 p-5`}>
            <p className="text-sm leading-relaxed text-slate-300">
              Noch keine Stationen — erst das Polling-Set, dann die Fenster.
            </p>
            <button
              onClick={() => onNavigate("system")}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
            >
              Einrichtung ansehen
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        ) : decideRes.pending && !decide ? (
          <div className="mt-2">
            <SkeletonPanel lines={3} label="Fenster werden berechnet" />
          </div>
        ) : problemCode ? (
          <div className="mt-2">
            <LoadError
              errorCode={problemCode}
              detail={decide?.detail ?? null}
              fallback="Die Wochen-Fenster sind derzeit nicht erreichbar."
              onRetry={onRetry}
            />
          </div>
        ) : ranking.length === 0 ? (
          <div className={`${panel} mt-2 p-5`}>
            <Empty>
              {learning ??
                "Keine Fenster mit Vorsprung in den nächsten 7 Tagen — die App rät nicht. Die aktuellen Preise stehen in „Stationen“."}
            </Empty>
          </div>
        ) : (
          <>
            <ol id="woche-liste" className={`${panel} mt-2 divide-y divide-slate-800/80`}>
              {ranking.map((entry, position) => (
                <li key={entry.id}>
                  <button
                    onClick={() => setSelectedId(entry.id)}
                    aria-expanded={selected?.id === entry.id}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800/40"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 w-4 shrink-0 font-mono text-xs font-bold text-slate-500"
                    >
                      {position + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-100">
                        {entry.dayLabel} {entry.timeLabel ?? entry.rangeLabel}
                      </span>
                      <span className="mt-0.5 block font-mono text-xs text-slate-300 tabular-nums">
                        {entry.priceLabel}
                        {entry.savingLabel ? ` · ${entry.savingLabel}` : ""}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {entry.security}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              {WEEK_UNCERTAIN_NOTE} Leere Tage haben kein Fenster mit
              Vorsprung — die App erfindet keins. Ein Tipp auf einen Eintrag
              zeigt die Begründung.
            </p>
          </>
        )}
      </div>

      {/* ③ Das Detail des gewählten Eintrags — ein Tipp entfernt (Ebene 2). */}
      {selected && ranking.length > 0 && (
        <div className={`${panel} mt-4 p-4 sm:p-5`} id="woche-detail">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            Ausgewählt
          </p>
          <h3 className="mt-1 text-lg font-bold text-slate-100">
            {selected.dayLabel} {selected.timeLabel ?? selected.rangeLabel}
          </h3>
          <p className="mt-1 font-mono text-sm text-slate-200 tabular-nums">
            Erwartet {selected.priceLabel}
            {selected.savingLabel ? ` · ${selected.savingLabel}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Fenster {selected.rangeLabel} · {selected.security}
            {selected.uncertain ? ` · ${WEEK_UNCERTAIN_NOTE}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => onNavigate("stations")}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-slate-600"
            >
              Stationen ansehen
            </button>
            <button
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-slate-600"
            >
              Warum?
            </button>
            {dayForEntry && (
              <button
                onClick={() => setDayOpen(true)}
                aria-haspopup="dialog"
                className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-slate-600"
              >
                Tagesverlauf
              </button>
            )}
          </div>
        </div>
      )}

      {why && (
        <Level1Sheet
          open={sheetOpen}
          title={`Warum ${selected?.dayLabel ?? "dieses Fenster"}?`}
          sentences={why.lines}
          source={why.source}
          labHint={why.labHint}
          onDeepen={(section) => {
            setSheetOpen(false);
            onDeepen?.(section);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {dayForEntry && (
        <BottomSheet
          open={dayOpen}
          title={`Tagesverlauf — ${selected?.dayLabel ?? "heute"}`}
          onClose={() => setDayOpen(false)}
        >
          <div className="mt-3">
            <DayCurve
              cells={dayForEntry.cells}
              label={`Tagesverlauf 06–24 Uhr — ${dayForEntry.sentence}`}
            />
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              {dayForEntry.sentence}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {dayForEntry.coverage} Höhe = Preis, oben teurer — leere Stunden
              bleiben Lücken, sie werden nicht geschätzt.
            </p>
          </div>
        </BottomSheet>
      )}
    </section>
  );
}
