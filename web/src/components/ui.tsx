// D1 (zweiter Schnitt): die geteilten UI-Bausteine. `Dashboard.tsx` war eine
// Datei mit über 4 000 Zeilen; bevor sie tab-weise zerlegt wird
// (die heutigen `views/*`), brauchen die künftigen Module eine gemeinsame
// Basis — sonst baut jede View ihre eigenen Karten und die App sieht an
// mehreren Stellen anders aus.
//
// Hier stehen bewusst nur Bausteine ohne Fachwissen: keine Datenhaltung, keine
// Requests, keine Entscheidungslogik. `panel` ist die Karten-Grundklasse,
// `Empty` der Leer-/Hinweis-Zustand, `Badge` die Ampel-Kapsel, `Metric` die
// Kennzahlen-Karte mit Erklärung (`tip`) und Zusatz-Hinweis (`hint`).
// Fehler-Zustände gehören nicht hierher, sondern zu `LoadError` (C6).
// C7: `InfoTooltip` ist das einheitliche „i“ für Fachwörter — Tastatur- und
// Screenreader-erreichbar, in jedem Bereich identisch.

import { useId, useState, type ReactNode } from "react";
import { HelpCircle, Info } from "lucide-react";

/**
 * U6 — Radius-Rampe: die **einzige** Stelle für Kartenradien. Vorher stand
 * an ~90 Panels je ein eigenes `rounded-xl/-2xl`; das Ergebnis waren
 * Kartenradien, die von Panel zu Panel unterschieden, ohne dass ein Element
 * falsch war („weiß nicht wieso“). Jetzt gilt eine Rampe, und das Ratchet in
 * `a11y.test.ts` verbietet `rounded-xl`/`rounded-2xl` außerhalb dieser Datei:
 *
 *   radius.card    — freie Karten, Modale, großflächige Callouts (16 px)
 *   radius.chip    — Chips, Buttons, Inset-Boxen (8 px)
 *   radius.control — Eingaben, kleine Schalter (6 px)
 *   rounded-full   — Pills/Kreise bleiben, wo sie sind (keine Kartenfrage)
 */
export const radius = {
  card: "rounded-2xl",
  chip: "rounded-lg",
  control: "rounded-md",
} as const;

/**
 * Karten-Grundklasse aller Panels — eine Stelle für Rand, Radius, Hintergrund.
 */
export const panel = `${radius.card} border border-slate-800 bg-slate-900/80`;

/** Modale Dialoge (Level-1-Sheet, Profil-Verwaltung) — Card-Optik, deckend. */
export const dialog = `${radius.card} border border-slate-800 bg-slate-900 shadow-2xl`;

/** Leerer Bereich / Hinweis: gestrichelter Rand, kein Alarm-Ton. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/40 p-7 text-sm leading-relaxed text-slate-400 break-words">
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
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
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
 * C7: Einheitliches „i“ für Fachwörter — hover, focus und Tastatur erreichbar.
 * Der Tooltip ist zugleich `title` (Hover) und `aria-describedby` (Screenreader).
 * `label` ist die Kurzbeschreibung für `aria-label`, `text` der Tooltip-Text.
 */
export function InfoTooltip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        title={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-700 bg-slate-800/80 text-slate-400 hover:border-slate-600 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        <Info size={11} aria-hidden="true" />
        <span className="sr-only">Info</span>
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-left text-xs leading-relaxed text-slate-200 shadow-xl sm:w-72"
        >
          {text}
        </span>
      )}
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
      <div className="text-xs leading-relaxed text-slate-400">{detail}</div>
      {hint && (
        <div className="mt-2 text-xs leading-relaxed text-slate-500">
          {hint}
        </div>
      )}
    </div>
  );
}
