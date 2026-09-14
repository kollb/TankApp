// Erklär-Treppe, Ebene 1 (docs/UI-NEUENTWURF.md §7): das Begründungs-Sheet.
//
// „Warum?“ steht überall an derselben Stelle — hier ist der Ort, an dem die
// Antwort erscheint: höchstens drei Sätze in Alltagssprache, die Herkunft der
// Zahlen und genau ein Weg in die Tiefe (Ebene 2, im Labor-Zeitalter ein
// Abschnitt statt einer Seite). Keine Formel, keine zweite Ebene im selben
// Fenster.
//
// Aufbau wie `ProfileManager`: Overlay, `role="dialog"`, `aria-modal`,
// Escape schließt, Klick auf den Hintergrund schließt. Mobil sitzt das Sheet
// unten am Rand (Daumen), ab `sm` in der Mitte — dieselbe Fläche, dieselbe
// Reihenfolge, nur anders verankert.

import { useEffect, useRef } from "react";
import { ArrowRight, X } from "lucide-react";

export function Level1Sheet({
  open,
  title,
  sentences,
  source,
  labHint,
  onDeepen,
  onClose,
}: {
  open: boolean;
  /** Die Frage, die beantwortet wird — z. B. „Warum warten?“. */
  title: string;
  /** Ebene-1-Regel: maximal drei Sätze. Mehr wird hier abgeschnitten. */
  sentences: string[];
  /** Woher die Zahlen kommen (Frische), eine Zeile. */
  source: string;
  /** Beschriftung des Wegs in die Tiefe. */
  labHint: string;
  onDeepen: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const shown = sentences.slice(0, 3);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="level1-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="level1-title" className="text-base font-bold text-white">
            {title}
          </h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Begründung schließen"
            className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <ol className="mt-4 space-y-2 text-sm leading-relaxed text-slate-200">
          {shown.map((sentence) => (
            <li key={sentence} className="rounded-xl bg-slate-950/60 p-3">
              {sentence}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          {source}
        </p>
        <button
          onClick={onDeepen}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-xs font-semibold text-sky-200 hover:border-sky-400/50"
        >
          {labHint}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
