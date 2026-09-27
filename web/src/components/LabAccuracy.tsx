// Treffsicherheit im Rückblick — ein Punkt je Empfehlung.
//
// „An 26 von 30 Tagen lagen wir richtig“ versteht man sofort; „Hit-Rate
// 86,7 %“ muss man erst einordnen. Das Punkte-Raster zeigt die echten
// Settlements des Advice-Ledgers: grün = richtig, grau = daneben, hell =
// unentschieden (`guide.ts`, `accuracyDots`).
//
// Ohne Zählung gibt es kein Raster, sondern den Lernstand — ein erfundenes
// Pünktchen wäre genau die Sicherheit, die §1 verbietet.

import { accuracyDots, accuracySentence } from "../guide";
import { euro } from "../data";
import { panel } from "./ui";

export interface LabAccuracyProps {
  hits: number | null;
  ties?: number | null;
  total: number | null;
  /** Realisierte Ersparnis der gefolgten Empfehlungen (€, aus dem Ledger). */
  savedEur30d?: number | null;
  fills30d?: number | null;
}

const DOT_CLASS = {
  hit: "bg-emerald-400",
  tie: "bg-slate-500",
  miss: "bg-slate-700",
} as const;

const DOT_WORD = {
  hit: "richtig",
  tie: "unentschieden",
  miss: "daneben",
} as const;

export function LabAccuracy({
  hits,
  ties = null,
  total,
  savedEur30d = null,
  fills30d = null,
}: LabAccuracyProps) {
  const grid = accuracyDots({ hits, ties, total });
  return (
    <section className={`${panel} p-4`} aria-labelledby="lab-accuracy-title">
      <h2 id="lab-accuracy-title" className="text-sm font-semibold text-white">
        Wie oft lag die Empfehlung richtig?
      </h2>

      {grid === null ? (
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          {accuracySentence(null, null)}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-300">
            {accuracySentence(grid.hits, grid.dots.length)}
          </p>

          {/* Ein Punkt je Empfehlung. `flex-wrap` statt Grid: die Zahl der
              Punkte kommt aus dem Ledger und ist nicht vorhersagbar. */}
          <ul className="mt-3 flex flex-wrap gap-1" aria-hidden="true">
            {grid.dots.map((state, index) => (
              <li
                key={index}
                className={`h-2.5 w-2.5 rounded-full ${DOT_CLASS[state]}`}
              />
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            {grid.hits} richtig · {grid.misses} daneben
            {grid.ties > 0 ? ` · ${grid.ties} unentschieden` : ""} — ein Punkt
            je abgerechnete Empfehlung.
            <span className="sr-only">
              {" "}
              Legende: {DOT_WORD.hit}, {DOT_WORD.tie}, {DOT_WORD.miss}.
            </span>
          </p>

          {savedEur30d !== null && Number.isFinite(savedEur30d) && (
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              Wer den Empfehlungen gefolgt ist, hat in den letzten 30 Tagen{" "}
              {euro(savedEur30d)} € gespart
              {fills30d !== null && fills30d > 0
                ? ` — bei ${fills30d} ${fills30d === 1 ? "Beleg" : "Belegen"}.`
                : "."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
