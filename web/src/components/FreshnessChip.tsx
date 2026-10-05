// Frische-Chip — der eine Ort für das Datenalter (UX-NEUENTWURF §6).
//
// Bis 0.72.2 trug jeder Bereich seine eigene Frische-Fußzeile; dieselbe
// Minute stand damit mehrfach auf einem Schirm. Jetzt sitzt das Alter als
// Chip im Kopf der Ansicht (`vor 4 Minuten` oder `alt`), die Fußzeile bleibt
// den Bereichen, die sie brauchen (Stationen, Labor, System).
//
// Der Text kommt aus den Frische-Funktionen (`nowFreshness`,
// `stationsFreshness`, `systemFreshness`) — die Ansichten formulieren ihn
// nicht selbst (T8).

export type FreshnessChipTone = "ok" | "warn" | "bad";

export interface FreshnessChipProps {
  /** „vor 4 Minuten“ · „alt“ · „kein Stand“. */
  label: string;
  tone?: FreshnessChipTone;
  className?: string;
}

const CHIP_TONE: Record<FreshnessChipTone, string> = {
  ok: "border-outline-variant text-on-surface-variant",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  bad: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

export function FreshnessChip({
  label,
  tone = "ok",
  className = "",
}: FreshnessChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CHIP_TONE[tone]} ${className}`}
      title="Alter der jüngsten Preismeldung"
    >
      {label}
    </span>
  );
}
