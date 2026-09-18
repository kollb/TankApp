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
export function histogramAlt(input: {
  values: number[];
  fmt?: (v: number) => string;
  thresholds?: { label: string; x: number }[];
}): string {
  const { values, fmt = plain, thresholds = [] } = input;
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length === 0) return "Histogramm ohne Werte.";
  const sorted = [...usable].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const marks = thresholds.length
    ? ` Schwellen: ${thresholds.map((t) => `${t.label} bei ${fmt(t.x)}`).join(", ")}.`
    : "";
  return (
    `Histogramm über ${countLabel(usable.length)} Werte: ` +
    `von ${fmt(sorted[0])} bis ${fmt(sorted[sorted.length - 1])}, ` +
    `Mitte ${fmt(median)}.${marks}`
  );
}

/**
 * Beschreibung eines Balkendiagramms um die Nulllinie: wie viele Balken je
 * Seite, und die beiden Ausreißer mit ihrem Namen. Blasse (nicht
 * signifikante) Balken werden als solche gezählt — die Farbe allein ist
 * keine Information für eine Vorleserin.
 */
export function deltaBarsAlt(input: {
  values: number[];
  labels?: string[];
  fmt?: (v: number) => string;
  muted?: boolean[];
}): string {
  const { values, labels = [], fmt = plain, muted = [] } = input;
  const usable = values
    .map((v, i) => ({ v, label: labels[i], muted: muted[i] === true }))
    .filter((row) => Number.isFinite(row.v));
  if (usable.length === 0) return "Balkendiagramm ohne Werte.";
  const below = usable.filter((row) => row.v < 0).length;
  const above = usable.filter((row) => row.v > 0).length;
  const lowest = usable.reduce((m, row) => (row.v < m.v ? row : m), usable[0]);
  const highest = usable.reduce((m, row) => (row.v > m.v ? row : m), usable[0]);
  const named = (row: { v: number; label?: string }) =>
    row.label ? `${row.label} mit ${fmt(row.v)}` : fmt(row.v);
  const mutedCount = usable.filter((row) => row.muted).length;
  const mutedNote = mutedCount
    ? ` ${countLabel(mutedCount)} davon statistisch nicht signifikant (blass).`
    : "";
  return (
    `Balkendiagramm um die Nulllinie: ${countLabel(usable.length)} Balken, ` +
    `${countLabel(below)} unter null, ${countLabel(above)} über null. ` +
    `Größter Ausschlag nach unten ${named(lowest)}, nach oben ${named(highest)}.` +
    mutedNote
  );
}

/**
 * Beschreibung des Kalibrierungs-Plots: wie viele Punkte, wie weit sie im
 * Mittel von der Diagonalen liegen und in welche Richtung. „Über der
 * Diagonalen“ heißt: die App war zu vorsichtig, darunter: zu siegessicher —
 * genau die Leseregel, die daneben im Text steht.
 */
export function calibChartAlt(input: {
  points: { p: number; hit: number; n: number }[];
  livePoints?: { p: number; hit: number; n: number }[];
}): string {
  const { points, livePoints = [] } = input;
  const all = [...points, ...livePoints].filter(
    (p) => Number.isFinite(p.p) && Number.isFinite(p.hit),
  );
  if (all.length === 0) return "Kalibrierungsdiagramm ohne Punkte.";
  const gap =
    all.reduce((sum, p) => sum + (p.hit - p.p), 0) / all.length;
  const observations = all.reduce(
    (sum, p) => sum + (Number.isFinite(p.n) ? p.n : 0),
    0,
  );
  const side =
    Math.abs(gap) < 0.005
      ? "im Mittel auf der Diagonalen"
      : gap > 0
        ? `im Mittel ${percentLabel(Math.abs(gap) * 100, 1)} über der Diagonalen (zu vorsichtig versprochen)`
        : `im Mittel ${percentLabel(Math.abs(gap) * 100, 1)} unter der Diagonalen (zu viel versprochen)`;
  const live = livePoints.length
    ? ` Davon ${countLabel(livePoints.length)} aus echten Live-Empfehlungen.`
    : "";
  return (
    `Kalibrierungsdiagramm: versprochene Wahrscheinlichkeit waagerecht, ` +
    `eingetroffene Trefferquote senkrecht. ${countLabel(all.length)} Punkte ` +
    `über ${countLabel(observations)} Fälle, ${side}. Die Diagonale ist die ` +
    `perfekte Kalibrierung.${live}`
  );
}

/** ct/L-Formatter für Tageskurven und Abstände — eine Stelle, ein Format. */
export const altCt = (value: number) => centPerLiter(value);
