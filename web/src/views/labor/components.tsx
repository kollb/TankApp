import type { ReactNode } from "react";
import {
  BookOpen,
  ChevronRight,
  FlaskConical,
  Gauge,
  ListChecks,
  MapPin,
  SlidersHorizontal,
  Sparkles,
  Target,
} from "lucide-react";
import { panel } from "../../components/ui";
import type { LabSectionId } from "../../lab";

export const LAB_ACCENT = "text-violet-300";
export const LAB_BORDER = "border-violet-500/30";
export const LAB_BG = "bg-violet-500/10";

export const SECTION_ICONS: Record<LabSectionId, ReactNode> = {
  prognose: <FlaskConical size={16} aria-hidden="true" />,
  sicherheit: <Gauge size={16} aria-hidden="true" />,
  stationen: <MapPin size={16} aria-hidden="true" />,
  lernen: <ListChecks size={16} aria-hidden="true" />,
  glossar: <BookOpen size={16} aria-hidden="true" />,
  spielplatz: <Sparkles size={16} aria-hidden="true" />,
};

export function LabBlock({
  id,
  open,
  onToggle,
  headline,
  question,
  children,
  blockRef,
}: {
  id: LabSectionId;
  open: boolean;
  onToggle: () => void;
  headline: string;
  question: string;
  children: ReactNode;
  blockRef?: (node: HTMLElement | null) => void;
}) {
  return (
    <section
      id={`labor-${id}`}
      ref={blockRef}
      aria-labelledby={`labor-${id}-title`}
      className={`${panel} scroll-mt-24 overflow-hidden`}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`labor-${id}-body`}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-violet-500/5"
      >
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${LAB_BORDER} ${LAB_BG} ${LAB_ACCENT}`}
        >
          {SECTION_ICONS[id]}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-xs font-bold uppercase tracking-[.2em] ${LAB_ACCENT}`}>
            {headline}
          </span>
          <span
            id={`labor-${id}-title`}
            role="heading"
            aria-level={2}
            className="mt-0.5 block text-base font-semibold text-white"
          >
            {question}
          </span>
        </span>
        <span className="mt-1 flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-500">
          <ChevronRight
            size={16}
            className={`transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
          <span className="sr-only">{open ? "zuklappen" : "aufklappen"}</span>
        </span>
      </button>
      {open && (
        <div id={`labor-${id}-body`} className="border-t border-slate-800 px-4 py-4">
          {children}
        </div>
      )}
    </section>
  );
}

export function ThreeSentences({ sentences }: { sentences: string[] }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3.5">
      <p className="text-xs font-bold uppercase tracking-[.2em] text-slate-500">
        In drei Sätzen
      </p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm leading-relaxed text-slate-200">
        {sentences.slice(0, 3).map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ol>
    </div>
  );
}

export function ForTheCurious({ children }: { children: ReactNode }) {
  return (
    <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200">
        Für Neugierige: Methode, Fachwort, Formel
      </summary>
      {/* [overflow-wrap:anywhere] — die Klappkästen tragen Fach-Token und
          Formeln (``inverse_mase_one_step_validation``); ohne Umbruchregel
          malen sie über die eigene Box und reißen den Mobil-Ratchet
          (Befund N1e, 23.09.2026, Runde 2). */}
      <div className="space-y-2 border-t border-slate-800/70 px-3 py-3 text-xs leading-relaxed text-slate-400 [overflow-wrap:anywhere]">
        {children}
      </div>
    </details>
  );
}

export function SelfCheck({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-violet-200">
        Selbst prüfen: {question}
      </summary>
      <p className="border-t border-violet-500/20 px-3 py-3 text-xs leading-relaxed text-slate-300">
        {answer}
      </p>
    </details>
  );
}

export function ReadingAid({ headline, text }: { headline: string; text: string }) {
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-slate-200">{headline}</p>
      <p className="text-xs leading-relaxed text-slate-500">{text}</p>
    </div>
  );
}

export function SketchNote({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs leading-relaxed text-amber-300/80">{children}</p>;
}

export function ParamCardShell({
  anchor,
  number,
  title,
  chain: _chain,
  sentence,
  expanded = true,
  onToggle,
  children,
}: {
  anchor: string;
  number: number;
  title: string;
  chain: string;
  sentence: string;
  expanded?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  return (
    <section
      id={anchor}
      className={`${panel} scroll-mt-28 overflow-hidden border-violet-500/20`}
      aria-labelledby={`${anchor}-title`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-violet-500/5"
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${LAB_BORDER} ${LAB_BG} ${LAB_ACCENT} text-xs font-bold`}>
          {number}
        </span>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <span className="block text-xs font-semibold text-violet-300">{`Karte ${number}`}</span>
          <span id={`${anchor}-title`} role="heading" aria-level={3} className="mt-0.5 block text-base font-semibold text-white">
            {title}
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-slate-300">{sentence}</span>
        </span>
      </button>
      {children && (
        <div className={expanded ? "border-t border-slate-800 px-4 py-4" : "hidden"}>
          {children}
        </div>
      )}
    </section>
  );
}
