// Hinweis auf einen Preisniveau-Termin (Tankrabatt) — Inline-Banner, kein
// Modal (wie `GuideBanner`). Die Texte kommen aus `regime.ts`; diese Datei
// ist nur Darstellung und bleibt unsichtbar, solange kein Termin im Sichtfeld
// der Prognose liegt.

import { Info } from "lucide-react";
import { regimeNoticeCopy, type RegimeNotice as Notice } from "../regime";
import { radius } from "./ui";

export interface RegimeNoticeProps {
  notice: Notice | null | undefined;
  className?: string;
}

export function RegimeNotice({ notice, className = "" }: RegimeNoticeProps) {
  const copy = regimeNoticeCopy(notice);
  if (!copy) return null;
  return (
    <section
      aria-label={copy.title}
      data-regime-notice="true"
      className={`flex items-start gap-3 p-3 ${radius.card} m3-banner-neutral ${className}`}
    >
      <Info size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{copy.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed opacity-90">{copy.body}</p>
      </div>
    </section>
  );
}
