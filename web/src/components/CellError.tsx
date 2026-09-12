// C6 (Rest): Fehler-Zustände **in** Tabellen.
//
// `LoadError` ist eine Karte — in einer Tabellenzelle oder als Tabellen-Body
// wäre sie falsch. Genau dort standen bisher eigene Texte: das
// Entscheidungs-Scoreboard und die Tages-Entscheidungen formulierten jeweils
// ihren eigenen Satz, mit eigener Fallback-Logik. Hier ist dieselbe Sprache
// in Tabellenform: eine Zeile über die volle Breite, Klartext aus
// `problem(error_code)`, Rohcode daneben, derselbe „Erneut laden“-Knopf.

import { AlertTriangle, RotateCw } from "lucide-react";
import { problem } from "../data";

/**
 * Eine Tabellenzeile, die den ganzen Tabellen-Body ersetzt.
 *
 * `colSpan` muss der Spaltenzahl der Tabelle entsprechen — sonst bricht das
 * Layout. `empty` unterscheidet die beiden Fälle, die sich für den Nutzer
 * gleich anfühlen, aber verschieden sind: „noch nichts da“ (kein Alarm-Ton,
 * kein Knopf) und „Abruf fehlgeschlagen“ (Warnfarbe, Knopf).
 */
export function CellError({
  colSpan,
  errorCode = null,
  fallback,
  onRetry,
  retryLabel = "Erneut laden",
  empty = false,
}: {
  colSpan: number;
  errorCode?: string | null;
  fallback: string;
  onRetry?: () => void;
  retryLabel?: string;
  empty?: boolean;
}) {
  const failed = !empty || !!errorCode;
  const text = problem(errorCode) || fallback;
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-6">
        <div
          role={failed ? "alert" : undefined}
          className={`flex flex-wrap items-start gap-3 text-xs leading-relaxed ${
            failed ? "text-amber-200" : "text-slate-400"
          }`}
        >
          {failed && (
            <AlertTriangle
              size={14}
              className="mt-0.5 shrink-0 text-amber-400"
              aria-hidden="true"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="m-0">{text}</p>
            {errorCode ? (
              <p className="m-0 mt-1 font-mono text-[11px] text-slate-500">
                Code: {errorCode}
              </p>
            ) : null}
          </div>
          {failed && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            >
              <RotateCw size={13} aria-hidden="true" />
              {retryLabel}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
