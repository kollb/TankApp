// Preisverlauf einer Station — derselbe Diagramm-Baustein für die klassische
// Ansicht (`views/Stationen.tsx`) und den Konzept-Neubau (`v3/Stations.tsx`).
//
// Zwei Hüllen, ein Diagramm: Achsen, beschriftete Zeitmarken und der
// Tagesmedian als gestrichelte „üblich“-Linie. Eine Mini-Grafik ohne Achse
// gab es hier früher (Nutzer-Feedback 14.09.2026: „niemand kann was mit dem
// Graphen anfangen“) — sie ist bewusst nicht zurückgekommen.

import { Empty } from "./ui";
import { LineChart } from "./LineChart";
import { useChartPalette } from "../chartTheme";
import {
  autoTimeTicks,
  countLabel,
  euro,
  euroPerLiter,
  timeLabel,
  timeSpanLabel,
  type Point,
} from "../data";
import { dayMedianPoints } from "../stations";

/** Zeitraum-Umschalter des Verlaufs — Wortlaut aus einer Quelle (V5). */
export const SPANS: Array<{ hours: number; label: string }> = [
  { hours: 24, label: timeSpanLabel(24) },
  { hours: 72, label: timeSpanLabel(72) },
  { hours: 168, label: timeSpanLabel(168) },
];

export function spanLabel(hours: number): string {
  return SPANS.find((span) => span.hours === hours)?.label ?? `${hours} Stunden`;
}

export function SeriesChart({
  points,
  spanHours,
}: {
  points: Point[];
  spanHours: number;
}) {
  const c = useChartPalette();
  const known = points
    .filter((p) => p.price !== null && Number.isFinite(Date.parse(p.timestamp)))
    .map((p) => ({ x: Date.parse(p.timestamp), y: p.price as number }));
  if (known.length < 2) {
    return (
      <Empty>
        Zu wenige offene Meldungen im gewählten Zeitraum — der Verlauf entsteht
        aus den Collector-Läufen, geschätzt wird nichts.
      </Empty>
    );
  }
  const xs = known.map((p) => p.x);
  const ys = known.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const band = dayMedianPoints(points);
  const last = known[known.length - 1];
  return (
    <div>
      <LineChart
        series={[
          { name: "Offene Meldungen (€/L)", color: c.accent, pts: known },
          {
            name: "Tagesmedian (üblich)",
            color: c.text,
            dash: "4 3",
            pts: band,
          },
        ]}
        marks={[{ x: last.x, color: c.positive, label: "jetzt" }]}
        xDomain={[minX, maxX]}
        xTicks={autoTimeTicks(minX, maxX)}
        yFmt={(value) => euro(value, 3)}
        ariaLabel="Preisverlauf der Station"
        ariaDescription={`Preisverlauf der letzten ${spanLabel(spanHours)} in €/L: Linie = offene Meldungen (${countLabel(known.length)} Punkte), gestrichelte Linie = Tagesmedian, grüne Marke = jüngste Meldung (${euroPerLiter(last.y)}), Spanne ${euroPerLiter(minY)} bis ${euroPerLiter(maxY)}.`}
      />
      <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
        Durchgezogen = offene Meldungen · gestrichelt = Tagesmedian („üblich“) ·
        grüne Marke = jüngste Meldung {timeLabel(new Date(last.x).toISOString())}.
        Leere Stunden bleiben leer — nichts wird interpoliert.
      </p>
    </div>
  );
}
