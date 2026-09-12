// C6 (kleinster Schnitt): ein gemeinsamer Fehler-Zustand für alle Panels.
// Vorher unterschieden sich die Panels — Spinner, nackter Text, nichts — und
// ein Fehler bot keinen Weg zurück außer „Tab wechseln und hoffen“. Hier gilt:
// dieselbe Karte, dieselbe Sprache, derselbe Knopf. Der Text kommt aus dem
// Problem-Mapping in `data.ts` (`problem(error_code)`), der Rohcode steht
// zusätzlich darunter, damit eine Meldung an den Betrieb eindeutig bleibt.

import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { problem } from "../data";

const BOX =
  "rounded-xl border border-dashed border-slate-700 bg-slate-950/40 text-sm leading-relaxed text-slate-400";
const BOX_COMPACT =
  "rounded-xl border border-rose-500/25 bg-rose-950/20 text-xs leading-relaxed text-rose-200";
const BUTTON =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400";

/**
 * Fehler-Zustand eines Panels.
 *
 * - `errorCode`: `error_code` aus der Antwort **oder** der Transport-Fehler;
 *   ohne Code gilt der Panel-Text `fallback` (z. B. „Der Tagesverlauf konnte
 *   nicht geladen werden.“).
 * - `onRetry`: lädt die Ressource neu (in der GUI `refreshNow()` — ein
 *   gemeinsamer Zähler, den alle `useResource`-Aufrufe als Abhängigkeit haben).
 *   Ohne `onRetry` erscheint kein Knopf, statt ihn tot zu rendern.
 * - `compact`: schmale Variante für Inline-Boxen (z. B. die Empfehlungs-Zeile
 *   im Alltag), die nicht wie ein leeres Panel aussehen sollen.
 */
export function LoadError({
  errorCode = null,
  fallback,
  onRetry,
  retryLabel = "Erneut laden",
  compact = false,
  className,
  children,
}: {
  errorCode?: string | null;
  fallback: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const text = problem(errorCode) || fallback;
  return (
    <div
      role="alert"
      className={className ?? (compact ? `${BOX_COMPACT} p-4` : `${BOX} p-7`)}
    >
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle
          size={compact ? 14 : 16}
          className={`mt-0.5 shrink-0 ${compact ? "text-rose-300" : "text-amber-400"}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="m-0">{text}</p>
          {children}
          {errorCode ? (
            <p
              className={`m-0 mt-1.5 font-mono text-[11px] ${
                compact ? "text-rose-300/70" : "text-slate-500"
              }`}
            >
              Code: {errorCode}
            </p>
          ) : null}
        </div>
        {onRetry ? (
          <button type="button" className={BUTTON} onClick={onRetry}>
            <RotateCw size={13} aria-hidden="true" />
            {retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
