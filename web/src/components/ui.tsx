// D1 (zweiter Schnitt): die geteilten UI-Bausteine. `Dashboard.tsx` war eine
// Datei mit über 4 000 Zeilen; bevor sie tab-weise zerlegt wird
// (`views/Daily.tsx`, `views/Statistics.tsx`, `views/System.tsx`), brauchen die
// künftigen Module eine gemeinsame Basis — sonst baut jede View ihre eigenen
// Karten und die App sieht an drei Stellen anders aus.
//
// Hier stehen bewusst nur Bausteine ohne Fachwissen: keine Datenhaltung, keine
// Requests, keine Entscheidungslogik. `panel` ist die Karten-Grundklasse,
// `Empty` der Leer-/Hinweis-Zustand, `Badge` die Ampel-Kapsel, `Metric` die
// Kennzahlen-Karte mit Erklärung (`tip`) und Zusatz-Hinweis (`hint`).
// Fehler-Zustände gehören nicht hierher, sondern zu `LoadError` (C6).

import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";

/** Karten-Grundklasse aller Panels — eine Stelle für Rand, Radius, Hintergrund. */
export const panel = "rounded-2xl border border-slate-800 bg-slate-900/80";

/** Leerer Bereich / Hinweis: gestrichelter Rand, kein Alarm-Ton. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-7 text-sm leading-relaxed text-slate-400">
      {children}
    </div>
  );
}

/** Ampel-Kapsel: `warning` = amber, sonst emerald. Farbe trägt nie allein eine Bedeutung. */
export function Badge({
  children,
  warning = false,
}: {
  children: ReactNode;
  warning?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
        warning
          ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
          : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Kennzahlen-Karte: `label` (oben), `value` (groß, darf JSX sein), `detail`
 * (Erklärzeile, Pflicht — keine nackte Zahl), `tip` (Tooltip am i-Symbol, auch
 * per Tastatur erreichbar) und `hint` (Zusatz, z. B. „noch nicht kalibriert“).
 */
export function Metric({
  label,
  value,
  detail,
  tip,
  hint,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  tip?: string;
  hint?: ReactNode;
}) {
  return (
    <div className={`${panel} p-5`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-slate-400">{label}</div>
        {tip && (
          <span
            tabIndex={0}
            role="button"
            aria-label={`Erklärung zu ${label}`}
            className="cursor-help text-slate-500 hover:text-slate-300 focus:text-slate-200"
            title={tip}
          >
            <HelpCircle size={14} aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="my-2 text-2xl font-bold tracking-tight text-white tabular-nums sm:text-3xl">
        {value}
      </div>
      <div className="text-[11px] leading-relaxed text-slate-400">{detail}</div>
      {hint && (
        <div className="mt-2 text-[10px] leading-relaxed text-slate-500">
          {hint}
        </div>
      )}
    </div>
  );
}
