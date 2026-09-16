// V3 (GUI-TEXT-BEFUND): die Sicht auf das Mitteilungs-Register.
//
// Hier wird gerendert, was `reduceNotices` zurückgibt: genau einer der acht
// früheren Blöcke, in der Ton-Farbe seines Rangs. Gleiche Semantik wie vorher,
// nur eben gebündelt:
//   * error → role="alert" (Screenreader dürfen unterbrechen),
//   * alles andere → role="status" (Information, kein Unterbrechen).
//
// Der Baustein ersetzt die acht `mb-6`-Banner der Root nicht optisch 1:1 —
// er ist der eine Block, den die DoD für V3 verlangt: ein Rang, höchstens eine
// sichtbare Meldung, eine Dauer, `role="status"`/`aria-live`.

import { AlertCircle, CloudOff, Info, RefreshCw } from "lucide-react";
import type { NoticesResult } from "./Notices";

const TONE = {
  error: "border-rose-500/30 bg-rose-500/10 text-rose-100",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  hint: "border-sky-500/30 bg-sky-500/10 text-sky-100",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
} as const;

function IconFor({ rank }: { rank: NoticesResult["rank"] }) {
  if (rank === "error") return <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />;
  if (rank === "warn") return <CloudOff size={17} className="mt-0.5 shrink-0" aria-hidden="true" />;
  if (rank === "success") return <RefreshCw size={17} className="mt-0.5 shrink-0" aria-hidden="true" />;
  return <Info size={17} className="mt-0.5 shrink-0" aria-hidden="true" />;
}

/**
 * Die gebündelte Meldung — `result` kommt aus `reduceNotices`; ohne Meldung
 * rendert der Baustein nichts.
 */
export function NoticesView({
  result,
}: {
  result: NoticesResult | null;
}) {
  if (!result) return null;
  const role = result.rank === "error" ? "alert" : "status";
  return (
    <div
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      className={`mb-4 flex items-start gap-3 rounded-lg border p-4 text-sm leading-relaxed ${TONE[result.rank]}`}
    >
      <IconFor rank={result.rank} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{result.text}</p>
        {result.note && (
          <p className="mt-0.5 text-xs opacity-80">{result.note}</p>
        )}
      </div>
      {result.onAction && (
        <button
          onClick={result.onAction}
          className="shrink-0 self-center rounded-lg border border-current px-3 py-1.5 text-xs font-bold opacity-90 transition hover:opacity-100"
        >
          {result.actionLabel}
        </button>
      )}
    </div>
  );
}
