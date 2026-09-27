// „Was bringt Warten?“ — die Ersparnis als Betrag, nicht als Cent je Liter.
//
// Die Rechnung kommt aus `guide.ts` (`guideBenefit`): Cent je Liter ×
// Tankmenge des Profils → Euro pro Tankfüllung. Unter 0,50 € ist die
// Antwort nicht die Zeit, sondern der Weg — dann sagt das Widget das auch,
// statt eine Ersparnis aufzublasen, die an der Säule niemand merkt.

import { PiggyBank, TrendingDown, TrendingUp, Equal } from "lucide-react";
import type { guideBenefit } from "../guide";
import { panel } from "./ui";

export interface BenefitWidgetProps {
  /** Ergebnis von `guideBenefit` — `null` ohne belastbare Differenz. */
  benefit: ReturnType<typeof guideBenefit> | null;
}

const TONE = {
  good: {
    icon: TrendingDown,
    chip: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  },
  bad: {
    icon: TrendingUp,
    chip: "border-rose-500/25 bg-rose-500/10 text-rose-300",
  },
  neutral: {
    icon: Equal,
    chip: "border-slate-700 bg-slate-800/60 text-slate-300",
  },
} as const;

export function BenefitWidget({ benefit }: BenefitWidgetProps) {
  if (!benefit) return null;
  const tone = TONE[benefit.tone];
  const Icon = tone.icon;
  return (
    <section className={`${panel} p-4`} aria-labelledby="benefit-title">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${tone.chip}`}
        >
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="benefit-title" className="text-sm font-semibold text-white">
            Was bringt Warten?
          </h2>
          <p className="mt-0.5 text-sm leading-relaxed text-slate-300">
            {benefit.text}
          </p>
        </div>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
        <PiggyBank size={13} aria-hidden="true" />
        Gerechnet mit der Tankmenge des Profils.
      </p>
    </section>
  );
}
