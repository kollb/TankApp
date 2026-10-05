// Tageskurve — die eine Grafik des Tagesverlaufs (UX-NEUENTWURF §3/§4).
//
// Kompakt als Mini-Kurve in der Tageszeile („Heute: Tief ~19 Uhr“) und groß
// im Detail-Blatt. Oben = teurer, unten = günstiger — die Lesegewohnheit,
// gegen die die alte Wochenlinie verstoßen hat (höher = billiger).
// Leere Stunden bleiben Lücken: nichts wird geschätzt (§8, Datenwahrheit).
//
// Die Grafik ist nie allein: `label` trägt dieselbe Aussage als Text, die
// Stundenwerte stehen zusätzlich in `aria-label` und `title` (M8: keine
// Information nur per Farbe und nur per Hover).

import { euroPerLiter } from "../data";

export type DayCurveCell = {
  /** 6–24 (Polling-Fenster). */
  hour: number;
  /** Stunden-Minimum in €/L — `null` = keine offene Meldung. */
  value: number | null;
  /** Die laufende Stunde. */
  current?: boolean;
};

export interface DayCurveProps {
  cells: DayCurveCell[];
  /** Textalternative — dieselbe Aussage wie die Kurve. */
  label: string;
  /** Kompakte Fassung für die Tageszeile (ohne Stunden-Zahlen). */
  compact?: boolean;
  className?: string;
}

/** Höhe der Zeichenfläche in SVG-Einheiten (Breite = Stunden − 1). */
const VIEW_H = 30;

function hourText(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function DayCurve({
  cells,
  label,
  compact = false,
  className,
}: DayCurveProps) {
  if (cells.length < 2) return null;
  const values = cells
    .map((cell) => cell.value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const x = (index: number) =>
    (index / (cells.length - 1)) * 100;
  const y = (value: number) =>
    // Bei Gleichstand (ein Wert im ganzen Tag) liegt die Linie in der Mitte.
    span === 0 ? VIEW_H / 2 : VIEW_H - 2 - ((value - min) / span) * (VIEW_H - 4);

  // Lücken: mehrere Teilpfade statt einer Linie durch geschätzte Werte.
  const paths: string[] = [];
  let open = false;
  cells.forEach((cell, index) => {
    if (cell.value === null) {
      open = false;
      return;
    }
    const point = `${x(index).toFixed(2)} ${y(cell.value).toFixed(2)}`;
    if (!open) {
      paths.push(`M ${point}`);
      open = true;
    } else {
      paths.push(`L ${point}`);
    }
  });

  const points = cells
    .map((cell, index) => ({ cell, index }))
    .filter((entry) => entry.cell.value !== null);

  return (
    <svg
      viewBox={`0 0 100 ${VIEW_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={className ?? (compact ? "h-6 w-full" : "h-20 w-full")}
    >
      <path
        d={paths.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={compact ? 1.5 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="text-emerald-400"
      />
      {!compact &&
        points.map(({ cell, index }) => (
          <circle
            key={cell.hour}
            cx={x(index)}
            cy={y(cell.value as number)}
            r={cell.current ? 2.2 : 1.2}
            className={
              cell.current ? "fill-emerald-300" : "fill-emerald-500/70"
            }
          >
            <title>{`${hourText(cell.hour)} — ${euroPerLiter(cell.value)}`}</title>
          </circle>
        ))}
    </svg>
  );
}
