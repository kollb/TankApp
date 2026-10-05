// O40 — Textalternativen der Diagramme nennen Werte, nicht nur Reihennamen.
//
// Befund (docs/archiv/OPTIMIERUNGS-BEFUND-2026-09-18.md O40): Die Beschreibung entstand aus den
// Reihennamen („Liniendiagramm: Erwarteter Preis, Band.“) und das `aria-label`
// war in allen Bausteinen dasselbe Wort „Diagramm“. Ein Screenreader erfuhr
// damit, **welche** Reihen ein Diagramm zeigt, aber nicht wohin sie laufen —
// und in einer Ansicht mit mehreren Charts waren sie nicht unterscheidbar.
//
// Hier stehen die reinen Funktionen, die aus denselben Punkten, die gezeichnet
// werden, einen Satz mit Zahlen bauen. Regeln wie überall (MICROCOPY §3): Die
// Zahlen laufen über die Formatter aus `data.ts` (de-DE, Komma), Niveaus in
// €/L, Differenzen in ct/L. Keine Funktion erfindet einen Wert: Ohne Punkte
// gibt es keinen Satz, sondern den ehrlichen Kurztext.

import { centPerLiter, countLabel, deTrimmed, percentLabel } from "./data";

export type AltPoint = { x: number; y: number };

export type AltSeries = {
  name?: string;
  pts: AltPoint[];
};

/** Zahl ohne Einheit, de-DE — der Rückfall, wenn kein Formatter mitkommt. */
const plain = (value: number) => deTrimmed(value, 3);

/**
 * Tendenz einer Reihe in einem Satz: erster Wert, letzter Wert, Richtung,
 * dazu Tief und Hoch. `fmtX` benennt die Stelle (Uhrzeit, Stunde, Index) —
 * fehlt er, bleibt die Position ungenannt statt geraten.
 */
export function seriesTrend(
  pts: AltPoint[],
  fmtY: (v: number) => string = plain,
  fmtX?: (x: number) => string,
): string | null {
  const usable = pts.filter((p) => Number.isFinite(p.y));
  if (usable.length === 0) return null;
  const first = usable[0];
  const last = usable[usable.length - 1];
  if (usable.length === 1) return `ein Wert: ${fmtY(first.y)}`;
  let low = usable[0];
  let high = usable[0];
  for (const p of usable) {
    if (p.y < low.y) low = p;
    if (p.y > high.y) high = p;
  }
  const direction =
    last.y > first.y ? "steigt" : last.y < first.y ? "fällt" : "bleibt";
  const course =
    direction === "bleibt"
      ? `bleibt bei ${fmtY(first.y)}`
      : `${direction} von ${fmtY(first.y)} auf ${fmtY(last.y)}`;
  const at = (p: AltPoint) => (fmtX ? ` um ${fmtX(p.x)}` : "");
  // Tief und Hoch nur nennen, wenn sie nicht ohnehin die Endpunkte sind —
  // sonst steht dieselbe Zahl dreimal im Satz.
  const extremes: string[] = [];
  if (low.y < Math.min(first.y, last.y))
    extremes.push(`Tief ${fmtY(low.y)}${at(low)}`);
  if (high.y > Math.max(first.y, last.y))
    extremes.push(`Hoch ${fmtY(high.y)}${at(high)}`);
  return extremes.length ? `${course}, ${extremes.join(", ")}` : course;
}

/**
 * Beschreibung eines Liniendiagramms: je Reihe ihr Verlauf, dazu die Zahl der
 * Punkte. Bänder werden als Spanne genannt, nicht als Linie — sie haben zwei
 * Ränder und keinen Verlauf.
 */
export function lineChartAlt(input: {
  series: AltSeries[];
  bands?: { name?: string; pts: { x: number; yLow: number; yHigh: number }[] }[];
  fmtY?: (v: number) => string;
  fmtX?: (x: number) => string;
  unit?: string;
}): string {
  const { series, bands = [], fmtY = plain, fmtX, unit } = input;
  const parts: string[] = [];
  for (const s of series) {
    const trend = seriesTrend(s.pts, fmtY, fmtX);
    if (!trend) continue;
    parts.push(s.name ? `${s.name} ${trend}` : trend);
  }
  for (const b of bands) {
    const lows = b.pts.map((p) => p.yLow).filter(Number.isFinite);
    const highs = b.pts.map((p) => p.yHigh).filter(Number.isFinite);
    if (!lows.length || !highs.length) continue;
    const name = b.name ?? "Band";
    parts.push(
      `${name} von ${fmtY(Math.min(...lows))} bis ${fmtY(Math.max(...highs))}`,
    );
  }
  if (parts.length === 0) return "Liniendiagramm ohne Werte.";
  const points = series.reduce(
    (sum, s) => sum + s.pts.filter((p) => Number.isFinite(p.y)).length,
    0,
  );
  const scale = unit?.trim() ? ` Werte in ${unit.trim()}.` : "";
  const count = points > 0 ? ` ${countLabel(points)} Punkte.` : "";
  return `Liniendiagramm: ${parts.join("; ")}.${scale}${count}`;
}

/**
 * Beschreibung eines Histogramms: Umfang, Spanne, Schwerpunkt (Median) und
 * die Schwellen-Marker, sofern gesetzt.
 */
