// „Heute im Überblick“ — acht Stunden, acht Balken, eine Ampel.
//
// Die Frage hinter diesem Diagramm ist nicht „Wie genau ist der Verlauf?“,
// sondern „Wann ist es günstig?“. Darum: keine Achse, kein Gitter, keine
// Kurve, keine Beschriftung an der Seite. Die Höhe trägt den Preis, die
// Farbe das Urteil, ein Tipp auf den Balken nennt den cent-genauen Wert.
//
// Fehlt die Prognose (Stufe 2 und 3), tritt an dieselbe Stelle die
// **Faustregel**: vier Tageszeiten mit typischem Trend. Sie ist immer
// gültig, braucht keine Verbindung und ist ausdrücklich als „typisch“
// beschriftet — nie als Prognose (`guide.ts`, RULE_OF_THUMB).

import { Lightbulb } from "lucide-react";
import { useState } from "react";
import {
  AMPEL_TEXT,
  RULE_OF_THUMB,
  ampelClass,
  type DayPartLevel,
  type HourOutlook,
} from "../guide";
import { euroPerLiter } from "../data";
import { panel, radius } from "./ui";

/** Feste Höhe je Tageszeit — die Faustregel kennt keine Preise. */
const PART_HEIGHT: Record<DayPartLevel, string> = {
  high: "h-10",
  mid: "h-6",
  low: "h-3",
};

export interface HourBarsProps {
  /** Aufbereitete Stunden (`hourlyOutlook`) — `null` ohne Prognose. */
  outlook: HourOutlook | null;
  /** Überschrift der Karte. */
  title?: string;
}

export function HourBars({ outlook, title = "Heute im Überblick" }: HourBarsProps) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!outlook || outlook.bars.every((bar) => bar.price === null)) {
    return <RuleOfThumb />;
  }
  const values = outlook.bars
    .map((bar) => bar.price)
    .filter((price): price is number => price !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const active = outlook.bars.find((bar) => bar.hour === selected) ?? null;

  return (
    <section className={`${panel} p-4`} aria-labelledby="hourbars-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="hourbars-title" className="text-sm font-semibold text-white">
          {title}
        </h2>
        <span className="text-xs text-slate-500">Nächste 8 Stunden</span>
      </div>

      {/* Balkenfeld: ein Knopf je Stunde. Die Höhe ist relativ zur Spanne
          des gezeigten Zeitraums — bei flachem Tag tragen alle Balken
          dieselbe Höhe, damit 0,3 Cent nicht wie ein Gebirge aussehen. */}
      <div className="mt-3 flex items-end gap-1.5">
        {outlook.bars.map((bar) => {
          const height =
            bar.price === null || span <= 0
              ? 24
              : 24 + ((bar.price - min) / span) * 56;
          const isActive = bar.hour === selected;
          return (
            <div key={`${bar.hour}-${bar.label}`} className="relative flex-1">
              {isActive && bar.price !== null && (
                <span className="absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[0.6875rem] font-semibold text-white shadow-lg">
                  {euroPerLiter(bar.price)}
                </span>
              )}
              <button
                type="button"
                aria-pressed={isActive}
                aria-label={`${bar.label === "Jetzt" ? "Jetzt" : `${bar.hour} Uhr`}: ${
                  bar.price === null ? "keine Prognose" : euroPerLiter(bar.price)
                }${bar.price === null ? "" : ` · ${AMPEL_TEXT[bar.level]}`}`}
                onClick={() => setSelected(isActive ? null : bar.hour)}
                className="flex w-full flex-col items-center gap-1.5 rounded-md py-1 hover:bg-slate-800/50"
              >
                <span className="flex h-20 w-full items-end">
                  <span
                    aria-hidden="true"
                    className={`w-full rounded-md ${ampelClass(bar.level)} ${
                      bar.isNow ? "ring-2 ring-emerald-400 ring-offset-1 ring-offset-slate-900" : ""
                    } ${bar.hour === outlook.bestHour ? "shadow-[0_0_0_1px_rgba(255,255,255,0.35)]" : ""}`}
                    style={{ height: `${height}%` }}
                  />
                </span>
                <span
                  className={`text-[0.6875rem] tabular-nums ${
                    bar.isNow ? "font-bold text-emerald-300" : "text-slate-500"
                  }`}
                >
                  {bar.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Der getippte Balken spricht seine Zahl auch für den Screenreader
          aus; ohne Auswahl steht hier die Skala der Ampel. */}
      <p role="status" className="mt-2 text-xs leading-relaxed text-slate-400">
        {active && active.price !== null
          ? `${active.label === "Jetzt" ? "Jetzt" : `${active.hour} Uhr`}: ${euroPerLiter(
              active.price,
            )} · ${AMPEL_TEXT[active.level]}`
          : (outlook.note ?? "Keine Prognose für die nächsten Stunden.")}
      </p>
    </section>
  );
}

/** Stufe 2 und 3: die Faustregel tritt an die Stelle der Prognose. */
export function RuleOfThumb() {
  return (
    <section className={`${panel} p-4`} aria-labelledby="rule-title">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center ${radius.chip} bg-slate-800 text-emerald-300`}
        >
          <Lightbulb size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="rule-title" className="text-sm font-semibold text-white">
            {RULE_OF_THUMB.title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
            {RULE_OF_THUMB.text}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-end gap-1.5">
        {RULE_OF_THUMB.parts.map((part) => (
          <div key={part.label} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="flex h-10 w-full items-end">
              <span
                aria-hidden="true"
                className={`w-full rounded-md ${ampelClass(part.level)} ${PART_HEIGHT[part.level]}`}
              />
            </span>
            <span className="text-[0.6875rem] text-slate-500">{part.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        {RULE_OF_THUMB.note}
      </p>
    </section>
  );
}
