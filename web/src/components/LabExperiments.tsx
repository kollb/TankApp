// Experimente — Beta-Ideen zum Ausprobieren.
//
// Jeder Schalter hat eine sichtbare Wirkung: Er schaltet seinen Bereich im
// Labor ein und legt den Weg dorthin frei. Was eine Verbindung braucht,
// bleibt **sichtbar** und ist ausgegraut mit dem Grund — statt zu
// verschwinden oder erst beim Antippen einen Fehler zu zeigen
// („Deaktivieren statt verstecken“).

import { FlaskConical } from "lucide-react";
import { panel, radius } from "./ui";

export type ExperimentId = "weekOutlook" | "detourCalc" | "smartAlarm";

export type Experiment = {
  id: ExperimentId;
  label: string;
  description: string;
  /** Bereich, in dem die Idee heute schon steckt. */
  target: string;
};

export const EXPERIMENTS: readonly Experiment[] = [
  {
    id: "weekOutlook",
    label: "Wochenprognose",
    description: "Die günstigsten Fenster der nächsten Tage im Blick.",
    target: "Woche",
  },
  {
    id: "detourCalc",
    label: "Umweg-Rechner",
    description: "Ob der Weg zur günstigeren Station netto wirklich lohnt.",
    target: "Stationen",
  },
  {
    id: "smartAlarm",
    label: "Smarter Preisalarm",
    description: "Meldung, sobald der Preis unter die eigene Schwelle fällt.",
    target: "Alarme",
  },
];

export interface LabExperimentsProps {
  active: Record<ExperimentId, boolean>;
  onToggle: (id: ExperimentId, next: boolean) => void;
  /** Ohne Verbindung brauchen die Experimente Netz — Begründung im Text. */
  online?: boolean;
}

export function LabExperiments({
  active,
  onToggle,
  online = true,
}: LabExperimentsProps) {
  return (
    <section className={`${panel} p-4`} aria-labelledby="lab-exp-title">
      <div className="flex items-center gap-2">
        <FlaskConical size={15} className="text-violet-300" aria-hidden="true" />
        <h2 id="lab-exp-title" className="text-sm font-semibold text-white">
          Experimente
        </h2>
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
        Neue Ideen zum Ausprobieren. Jederzeit abschaltbar.
      </p>
      <ul className="mt-3 divide-y divide-slate-800">
        {EXPERIMENTS.map((experiment) => {
          const on = active[experiment.id] === true;
          return (
            <li key={experiment.id} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-200">
                  {experiment.label}
                </p>
                <p className="text-xs leading-relaxed text-slate-400">
                  {experiment.description}
                </p>
                {on && (
                  <p className="mt-1 text-xs text-emerald-300">
                    Eingeschaltet — zu finden im Bereich „{experiment.target}“.
                  </p>
                )}
                {!online && (
                  <p className="mt-1 text-xs text-amber-300">
                    Braucht eine Verbindung.
                  </p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={experiment.label}
                disabled={!online}
                onClick={() => onToggle(experiment.id, !on)}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${
                  on ? "bg-emerald-500" : "bg-slate-700"
                } ${radius.control} ${online ? "" : "opacity-50"}`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    on ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
