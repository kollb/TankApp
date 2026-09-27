// Inline-Banner des Tank-Guides (Stufe 2 und 3).
//
// Ein anhaltender Zustand bekommt **kein** Modal und keinen Alert-Dialog:
// Wer morgens an der Säule steht, will nicht erst „OK“ tippen, um den
// Preis zu sehen. Das Banner sitzt deshalb über der Karte, erklärt in zwei
// Sätzen, was fehlt und was trotzdem geht, und bietet genau eine Handlung
// („Erneut versuchen“) mit Inline-Ladeindikator (M3: Inline Banner).
//
// Die Texte kommen aus `guide.ts`; diese Datei ist nur Darstellung.

import { Loader2, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { guideBanner, type GuideLevel } from "../guide";
import { radius } from "./ui";

export interface GuideBannerProps {
  level: GuideLevel;
  /** Berliner Stand der Daten als „HH:MM“ — nur Stufe 3. */
  stand?: string | null;
  /** Ob aktuell Preise vorliegen (Stufe 2: „trotzdem live“). */
  hasPrices?: boolean;
  retrying?: boolean;
  onRetry: () => void;
}

export function GuideBanner({
  level,
  stand = null,
  hasPrices = true,
  retrying = false,
  onRetry,
}: GuideBannerProps) {
  const banner = guideBanner(level, { stand, hasPrices });
  if (!banner) return null;
  const Icon = level === "offline" ? WifiOff : TriangleAlert;
  return (
    <section
      aria-label={banner.title}
      className={`mb-4 flex flex-col gap-3 p-4 ${radius.card} ${
        banner.tone === "warn" ? "m3-banner-warn" : "m3-banner-neutral"
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{banner.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed opacity-90">
            {banner.body}
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="tap-44 inline-flex items-center gap-2 px-3 text-sm font-semibold underline-offset-4 hover:underline disabled:no-underline"
        >
          {retrying ? (
            <Loader2 size={16} aria-hidden="true" className="animate-spin" />
          ) : (
            <RefreshCw size={16} aria-hidden="true" />
          )}
          {retrying ? banner.retrying : banner.retry}
        </button>
      </div>
    </section>
  );
}
