// „Was bringt Warten?“ — die Ersparnis als Betrag, nicht als Cent je Liter.
//
// Die Rechnung kommt aus `guide.ts` (`guideBenefit`): Cent je Liter ×
// Tankmenge des Profils → Euro pro Tankfüllung. Unter 0,50 € ist die
// Antwort nicht die Zeit, sondern der Weg — dann sagt das Widget das auch,
// statt eine Ersparnis aufzublasen, die an der Säule niemand merkt.

import { TrendingDown, TrendingUp, Equal } from "lucide-react";
import type { guideBenefit } from "../guide";

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
  // Eine Zeile, kein Block: die Zahl ist die Antwort auf „Was bringt
  // Warten?“ und bekommt ihren Rahmen durch die Karte darüber. Ein
  // eigener Kasten mit Überschrift hätte sie zur zweiten Karte gemacht —
  // und die Startseite um ~100 px verlängert (S1, KPI Scrolltiefe).
  return (
    <p className="flex items-center gap-2 text-sm leading-relaxed text-slate-300">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${tone.chip}`}
      >
        <Icon size={15} aria-hidden="true" />
      </span>
      <span className="min-w-0">{benefit.text}</span>
    </p>
  );
}
