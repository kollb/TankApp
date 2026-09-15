// Woche — der Zeit-Planer (docs/UI-NEUENTWURF.md §5.3, Phase 2).
//
// Feste Reihenfolge, nie anders:
//   ① Tank-Zeile (Füllstand + Reichweite, „Ändern“ öffnet die Pflege)
//   ② Beste Fenster (7-Tage-Raster, Sterne, Tage 5–7 „noch unsicher“)
//   ③ Ausgewählt (Fenster-Detail: Preis, Abstand, Sicherheit, Tank-Abgleich)
//   ④ Wochenlinie (Tagesbestwerte) + alle Fenster nach Ersparnis
//   — darunter die Frische-Fußzeile (fester Platz, jede Ansicht)
//
// Die View rendert, sie entscheidet nichts (D1): Tage, Sterne,
// Tank-Abgleich, Zusammenfassung und Begründung kommen aus `week.ts`
// und sind dort getestet. Horizonte-Honesty: Die App zeigt die ganze
// Woche, verspricht aber nur, was die Engine liefert (Tage 5–7
// entsättigt, Sterne nur mit messbarem P).

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Gauge,
  Star,
} from "lucide-react";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { PrecisionSlider } from "../components/PrecisionSlider";
import { SkeletonPanel } from "../components/Skeleton";
import { Empty, panel } from "../components/ui";
import {
  berlinHour,
  deTrimmed,
  hourRangeLabel,
  type DecideResult,
  type ResourceState,
} from "../data";
import { type LabSectionId } from "../lab";
import { learningNote, nowFreshness, TANK_QUICK } from "../now";
import {
  weekDays,
  weekExplanation,
  weekLine,
  weekTankLine,
  weekWindowList,
  weekWindowSummary,
  windowStars,
  type WeekDay,
} from "../week";

export interface WocheViewProps {
  activeCity: string;
  stationsCount: number;
  decideRes: ResourceState<DecideResult>;
  priceNow: number | null;
  /** Tankstand (A2): Pflege lebt hier, Schnellauswahl in „Jetzt“. */
  tankPercent: number | null;
  setTankPercent: (v: number | null) => void;
  tankCapacity: number;
  consumption: number;
  forecastAt: string | null;
  pricesAt: string | null;
  onRetry: () => void;
  onNavigate: (target: "stations" | "ich" | "system") => void;
  onDeepen?: (section: LabSectionId) => void;
  /** Nur für Tests; sonst Date.now(). */
  now?: number;
}

/** 0–3 Sterne als Symbole + Wort (Barrierefreiheit: nie Farbe/Symbol allein). */
function Stars({ value, withWord = false }: { value: number; withWord?: boolean }) {
  const word =
    value >= 3
      ? "ziemlich sicher"
      : value === 2
        ? "eher sicher"
        : value === 1
          ? "unsicher"
          : "noch nicht messbar";
  if (value === 0)
    return withWord ? (
      <span className="text-[10px] text-slate-500">{word}</span>
    ) : (
      <span className="text-[10px] text-slate-600" aria-label={word}>
        ···
      </span>
    );
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${value} von 3 Sternen — ${word}`}
    >
      {[0, 1, 2].map((i) => (
        <Star
          key={i}
          size={11}
          fill={i < value ? "currentColor" : "none"}
          className={i < value ? "text-amber-300" : "text-slate-600"}
          aria-hidden="true"
        />
      ))}
      {withWord && <span className="ml-1 text-[10px] text-slate-400">{word}</span>}
    </span>
  );
}

/** Wochenlinie: Tagesbestwerte als Mini-Balken (null = kein Fenster). */
function WeekLine({ days }: { days: WeekDay[] }) {
  const values = days
    .map((day) => day.window?.expected_price ?? null)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return (
    <div className="flex items-end gap-1.5" role="img" aria-label="Wochenlinie: beste erwartete Preise je Tag">
      {days.map((day) => {
        const value = day.window?.expected_price ?? null;
        const height =
          value === null ? 4 : 10 + ((value - min) / span) * 34;
        return (
          <div key={day.index} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={`w-full rounded-t ${
                value === null
                  ? "bg-slate-800"
                  : day.uncertain
                    ? "bg-slate-600/60"
                    : "bg-emerald-500/70"
              }`}
              style={{ height: `${height}px` }}
              title={
                value === null
                  ? `${day.shortDay} ${day.date} — kein Fenster`
                  : `${day.shortDay} ${day.date} — erwartet ${deTrimmed(value, 3)} €/L`
              }
            />
            <span className="text-[9px] font-semibold text-slate-500">
              {day.shortDay}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function WocheView(props: WocheViewProps) {
  const {
    activeCity,
    consumption,
    decideRes,
    forecastAt,
    onDeepen,
    onNavigate,
    onRetry,
    pricesAt,
    setTankPercent,
    stationsCount,
    tankCapacity,
    tankPercent,
    now,
  } = props;
  const decide = decideRes.data ?? null;
  const problemCode =
    decide?.error_code ?? (decideRes.error ? decideRes.errorCode : null);
  const [tankOpen, setTankOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const days = useMemo(
    () => weekDays(decide?.windows_week ?? null, now),
    [decide?.windows_week, now],
  );
  const defaultIdx = useMemo(() => {
    const withWindow = days.find((day) => day.window);
    return withWindow ? withWindow.index : 0;
  }, [days]);
  const selected: WeekDay =
    days[
      selectedIdx !== null && days[selectedIdx] ? selectedIdx : defaultIdx
    ] ?? days[0];
  const summary = weekWindowSummary(selected, decide, props.priceNow, now);
  const list = weekWindowList(days);
  const line = weekLine(days);
  const tankLine = weekTankLine(decide?.tank ?? null, tankPercent, tankCapacity);
  const freshness = nowFreshness({ pricesAt, forecastAt, now });
  const FRESHNESS_TONE = {
    ok: "text-slate-500",
    warn: "text-amber-300",
    bad: "text-rose-300",
  } as const;

  // Auswahl zurücksetzen, wenn sich die Fenster ändern und der gewählte
  // Tag kein Fenster (mehr) hat — sonst zeigt das Detail eine Leere.
  useEffect(() => {
    if (selectedIdx !== null && !days[selectedIdx]?.window) {
      setSelectedIdx(null);
    }
  }, [selectedIdx, days]);

  const setup = stationsCount === 0 && !decideRes.error;
  const explanation = selected?.window
    ? weekExplanation(selected, decide, props.priceNow, now)
    : null;
  const learning = learningNote(decide);

  return (
    <section aria-labelledby="woche-title">
      <h1 id="woche-title" className="text-2xl font-bold tracking-tight text-white">
        Woche
      </h1>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Wann in den nächsten Tagen — als Nachschlagewerk, kein Wecker.
      </p>

      {/* ① Tank-Zeile */}
      <div className={`${panel} mt-4 p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Gauge size={15} className="text-emerald-400" aria-hidden="true" />
            <span className="font-semibold">{tankLine.text}</span>
          </div>
          <button
            onClick={() => setTankOpen((value) => !value)}
            aria-expanded={tankOpen}
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-slate-600"
          >
            Ändern
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">{tankLine.detail}</p>
        {tankOpen && (
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-400">
                Schnellauswahl:
              </span>
              {TANK_QUICK.map((item) => (
                <button
                  key={item.percent}
                  onClick={() => setTankPercent(item.percent)}
                  aria-pressed={tankPercent === item.percent}
                  className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold ${
                    tankPercent === item.percent
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
                  }`}
                >
                  {item.label}
                </button>
              ))}
              {tankPercent !== null && (
                <button
                  onClick={() => setTankPercent(null)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-500 hover:text-slate-300"
                >
                  Keine Angabe
                </button>
              )}
            </div>
            {tankPercent !== null && (
              <div className="mt-3">
                <PrecisionSlider
                  id="woche-tankPercent"
                  label="Füllstand"
                  icon={<Gauge size={14} />}
                  value={tankPercent}
                  onChange={(value) => setTankPercent(value)}
                  min={0}
                  max={100}
                  step={5}
                  unit="%"
                  valueText={`${deTrimmed(tankPercent, 0)} % Füllstand`}
                  valueSpeech={`${deTrimmed(tankPercent, 0)} Prozent Füllstand`}
                />
                <p className="mt-2 text-[10px] text-slate-500">
                  Tankgröße {deTrimmed(tankCapacity, 0)} L · Verbrauch{" "}
                  {deTrimmed(consumption, 1)} L/100 km — geändert wird beides
                  unter „Ich“.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ② Beste Fenster (7-Tage-Raster) */}
      <div className="mt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <CalendarDays size={15} className="text-emerald-400" aria-hidden="true" />
          Beste Fenster (7 Tage)
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
              fallback="Die Wochen-Fenster sind derzeit nicht erreichbar."
              onRetry={onRetry}
            />
          </div>
        ) : list.length === 0 ? (
          <div className={`${panel} mt-2 p-5`}>
            <Empty>
              {learning ??
                "Keine Fenster mit Vorsprung in den nächsten 7 Tagen — die App rät nicht. Die aktuellen Preise stehen in „Stationen“."}
            </Empty>
          </div>
        ) : (
          <>
            <div
              className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7"
              role="listbox"
              aria-label="Beste Fenster je Tag der nächsten 7 Tage"
            >
              {days.map((day) => {
                const isSelected = selected.index === day.index;
                const hasWindow = !!day.window;
                return (
                  <button
                    key={day.index}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => setSelectedIdx(day.index)}
                    disabled={!hasWindow}
                    className={`flex min-h-24 flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition-colors ${
                      isSelected
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : hasWindow
                          ? "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                          : "cursor-default border-slate-800/60 bg-slate-950/40"
                    } ${day.uncertain && hasWindow ? "opacity-70" : ""}`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {day.shortDay}
                      {day.isToday ? " · heute" : ""}{" "}
                      <span className="font-normal normal-case text-slate-600">
                        {day.date}
                      </span>
                    </span>
                    {hasWindow && day.window ? (
                      <>
                        <span className="font-mono text-[11px] font-bold text-emerald-300">
                          {formatWindowRange(day.window)}
                        </span>
                        <Stars value={day.stars} />
                        {day.uncertain && (
                          <span className="text-[9px] text-slate-500">
                            noch unsicher
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[11px] text-slate-600">—</span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
              ★ = Sicherheit des Fensters (Prozent im Detail, Schwellen in
              des Labors). Leere Tage: kein Fenster mit Vorsprung — keine
              Erfindung. Tage 5–7 sind „noch unsicher“ (entsättigt).
            </p>
          </>
        )}
      </div>

      {/* ③ Ausgewählt */}
      {selected.window && summary && list.length > 0 && (
        <div className={`${panel} mt-4 p-4 sm:p-5`}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            Ausgewählt
          </p>
          <h3 className="mt-1 text-lg font-bold text-white">{summary.headline}</h3>
          <p className="mt-1 font-mono text-sm text-slate-200">
            Erwartet {deTrimmed(selected.window.expected_price, 3)} €/L
            {summary.savingLine ? ` · ${summary.savingLine}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-300">{summary.security}</p>
          {summary.tank && (
            <p
              className={`mt-2 text-xs ${
                summary.tank.tone === "bad"
                  ? "text-rose-300"
                  : summary.tank.tone === "warn"
                    ? "text-amber-300"
                    : summary.tank.tone === "ok"
                      ? "text-emerald-300"
                      : "text-slate-400"
              }`}
            >
              Tank: {summary.tank.text}
            </p>
          )}
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
          </div>
        </div>
      )}

      {/* ④ Wochenlinie + Liste */}
      {list.length > 0 && (
        <>
          <div className={`${panel} mt-4 p-4`}>
            <p className="mb-3 text-[10px] uppercase tracking-wider text-slate-500">
              Wochenlinie (Tagesbestwerte)
            </p>
            <WeekLine days={days} />
            <p className="mt-2 text-[10px] text-slate-500">
              Balken = günstigster erwarteter Preis des Tages (höher =
              günstiger) · grau = kein Fenster.
            </p>
          </div>
          <div className={`${panel} mt-4 overflow-hidden`}>
            <p className="border-b border-slate-800 px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-500">
              Alle Fenster nach Ersparnis
            </p>
            <div className="divide-y divide-slate-800/80">
              {list.map((entry) => (
                <button
                  key={entry.window.start}
                  onClick={() => setSelectedIdx(entry.day.index)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition-colors hover:bg-slate-800/40"
                >
                  <span className="text-slate-300">
                    {dayShort(entry.day)} {formatWindowRange(entry.window)}
                    {entry.day.uncertain ? " · noch unsicher" : ""}
                  </span>
                  <span className="flex items-center gap-3">
                    <Stars value={windowStars(entry.window.p)} />
                    <span className="font-mono text-slate-400">
                      {deTrimmed(entry.window.expected_price, 3)} €/L
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        entry.savingEur != null && entry.savingEur > 0
                          ? "text-emerald-300"
                          : "text-slate-500"
                      }`}
                    >
                      {entry.savingEur != null && entry.savingEur > 0
                        ? `−${deTrimmed(entry.savingEur)} €`
                        : "—"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Frische-Fußzeile */}
      <p
        role="status"
        className={`mt-4 text-[11px] leading-relaxed ${FRESHNESS_TONE[freshness.tone]}`}
      >
        {freshness.text} · {activeCity || "kein Ort gewählt"}
        {line.length > 0
          ? " · ab Tag 5 wird die Prognose breiter"
          : ""}
      </p>

      {explanation && (
        <Level1Sheet
          open={sheetOpen}
          title={`Warum ${summary?.headline ?? "dieses Fenster"}?`}
          sentences={explanation.sentences}
          source={explanation.source}
          labHint={explanation.labHint}
          onDeepen={(section) => {
            setSheetOpen(false);
            onDeepen?.(section);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  );
}

function formatWindowRange(window: { start: string; end: string }): string {
  const from = berlinHour(new Date(window.start));
  const to = berlinHour(new Date(window.end));
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "—";
  return hourRangeLabel(Math.floor(from), Math.floor(to));
}

function dayShort(day: WeekDay): string {
  return day.isToday ? "Heute" : day.shortDay;
}
