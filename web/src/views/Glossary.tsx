// C7: Hilfe/Glossar-Layer — „Was heißt das?“ für die Werkstatt.
// Einfache Seite mit deutschen Primärlabeln und Fachwort im Tooltip.
// Begriffe konsistent zu docs/referenz/ANALYSE.md, MICROCOPY §4.
//
// Kein englischer Hook, kein Demo — jede Zeile erklärt, was zu tun ist.

import { BookOpen, Info } from "lucide-react";
import { panel } from "../components/ui";
import { GLOSSARY } from "../data";

export function GlossaryView() {
  return (
    <>
      <div className="mb-6">
        <p className="mb-1 text-xs font-bold uppercase tracking-[.2em] text-sky-400">
          Hilfe · Nachschlagen
        </p>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Glossar
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Was heißt das? Das Labor spricht deutsch zuerst — das Fachwort steht
          in Klammern und im Tooltip. Keine Rechnung, nur Sprache: Was bedeutet
          die Zahl, woran erkennt man den Zustand, was folgt daraus?
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {GLOSSARY.map((entry) => (
          <section
            key={entry.id}
            id={`glossar-${entry.id}`}
            className={`${panel} p-5 sm:p-6`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-white">
                  {entry.de}{" "}
                  <span className="font-normal text-slate-400">
                    — {entry.term}
                  </span>
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">
                  {entry.short}
                </p>
              </div>
              <span
                title={entry.term}
                className="hidden sm:inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-slate-400"
                aria-label={`Fachwort: ${entry.term}`}
              >
                <Info size={14} aria-hidden="true" />
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              {entry.long}
            </p>
            {entry.anchor && (
              <p
                className="mt-2 text-xs text-slate-500"
                title={`docs/referenz/ANALYSE.md#${entry.anchor}`}
              >
                Mehr dazu steht in der Analyse (Doku).
              </p>
            )}
          </section>
        ))}
      </div>

      <section className={`${panel} mt-6 p-5 sm:p-6`}>
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-sky-400" />
          <h3 className="text-sm font-semibold text-white">
            Noch Fragen?
          </h3>
        </div>
        <p
          className="mt-2 text-sm leading-relaxed text-slate-400"
          title="docs/README.md · Methodik, Produktkonzept und Textregeln"
        >
          Die vollständige Methodik steht in der Analyse und im Konzept — dort
          mit Formeln und Quellen. Das Regelwerk für alle Texte liegt im
          Microcopy-Dokument.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Sprache vor Rechnung: Jeder i-Punkt im Labor verweist hierher
          — ein Klick zeigt die Kurzerklärung, diese Seite die Einordnung.
        </p>
      </section>
    </>
  );
}
