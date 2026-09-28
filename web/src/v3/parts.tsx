// Gemeinsame Bausteine der Konzept-Seiten (`v3/Guide.tsx`, `v3/Week.tsx`, …).
//
// Karten sehen auf allen Seiten gleich aus: Tonfläche, Rand, keine Schatten.
// Elevation hat genau **eine** Karte je Seite — die Antwort. Deshalb stehen
// hier nur die ruhigen Teile; die Antwortkarte bringt jede Seite selbst mit.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { radius } from "../components/ui";

/** Ruhige Karte: Rand und Tonfläche, kein Schatten. */
export function SectionCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border border-outline-variant bg-sc-lowest p-5 ${radius.card} ${className}`}
    >
      {children}
    </section>
  );
}

/** Überschrift einer Karte: klein, ruhig, nie lauter als die Antwort. */
export function CardTitle({
  icon: Icon,
  children,
  right,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {Icon && <Icon size={15} aria-hidden="true" />}
        {children}
      </h2>
      {right}
    </div>
  );
}

/** Seitenkopf: Bereich, Frage, Herkunft — dieselbe Form auf jeder Seite. */
export function PageHeader({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle: ReactNode;
}) {
  return (
    <div className="mb-4">
      <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
        {kicker}
      </p>
      <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
        {title}
      </h1>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-on-surface-variant">
        {subtitle}
      </p>
    </div>
  );
}
