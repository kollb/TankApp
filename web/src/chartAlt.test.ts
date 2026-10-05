// O40 — die Textalternativen selbst: Werte statt Reihennamen.
//
// Der Ratchet in `a11y.test.ts` prüft das gerenderte Markup („jedes Diagramm
// hat eine Beschreibung mit einer formatierten Zahl“). Hier stehen die Regeln
// der Sätze: welche Zahl genannt wird, welche weggelassen, und was passiert,
// wenn keine Daten da sind — kein Satz darf eine Zahl erfinden.

import { describe, expect, it } from "vitest";
import { lineChartAlt, seriesTrend } from "./chartAlt";
import { euroPerLiter } from "./data";

const eurL = (v: number) => euroPerLiter(v);

describe("seriesTrend", () => {
  it("nennt Anfang, Ende und Richtung", () => {
    const trend = seriesTrend(
      [
        { x: 0, y: 1.78 },
        { x: 1, y: 1.74 },
        { x: 2, y: 1.71 },
      ],
      eurL,
    );
    expect(trend).toBe("fällt von 1,780 €/L auf 1,710 €/L");
  });

  it("nennt Tief und Hoch nur, wenn sie nicht die Endpunkte sind", () => {
    const withDip = seriesTrend(
      [
        { x: 0, y: 1.78 },
        { x: 1, y: 1.6 },
        { x: 2, y: 1.8 },
      ],
      eurL,
    );
    expect(withDip).toContain("Tief 1,600 €/L");
    // 1,80 ist gleichzeitig Endwert — „Hoch“ wäre dieselbe Zahl doppelt.
    expect(withDip).not.toContain("Hoch");
  });

  it("benennt die Stelle des Tiefs, wenn ein x-Formatter mitkommt", () => {
    const trend = seriesTrend(
      [
        { x: 8, y: 1.78 },
        { x: 20, y: 1.6 },
        { x: 22, y: 1.79 },
      ],
      eurL,
      (x) => `${x} Uhr`,
    );
    expect(trend).toContain("Tief 1,600 €/L um 20 Uhr");
  });

  it("bleibt ehrlich bei einem Wert und bei gar keinem", () => {
    expect(seriesTrend([{ x: 0, y: 1.71 }], eurL)).toBe("ein Wert: 1,710 €/L");
    expect(seriesTrend([], eurL)).toBeNull();
    expect(seriesTrend([{ x: 0, y: Number.NaN }], eurL)).toBeNull();
  });

  it("sagt „bleibt“ statt eine Richtung zu erfinden", () => {
    const flat = seriesTrend(
      [
        { x: 0, y: 1.7 },
        { x: 1, y: 1.7 },
      ],
      eurL,
    );
    expect(flat).toBe("bleibt bei 1,700 €/L");
  });
});

describe("lineChartAlt", () => {
  it("beschreibt jede Reihe mit ihrem Namen und den Werten", () => {
    const text = lineChartAlt({
      series: [
        {
          name: "Erwarteter Preis",
          pts: [
            { x: 0, y: 1.78 },
            { x: 1, y: 1.71 },
          ],
        },
      ],
      fmtY: eurL,
    });
    expect(text).toContain("Erwarteter Preis fällt von 1,780 €/L auf 1,710 €/L");
    expect(text).toContain("2 Punkte");
  });

  it("nennt ein Band als Spanne, nicht als Verlauf", () => {
    const text = lineChartAlt({
      series: [{ name: "Median", pts: [{ x: 0, y: 1.7 }, { x: 1, y: 1.72 }] }],
      bands: [
        {
          name: "80-%-Band",
          pts: [
            { x: 0, yLow: 1.66, yHigh: 1.74 },
            { x: 1, yLow: 1.67, yHigh: 1.79 },
          ],
        },
      ],
      fmtY: eurL,
    });
    expect(text).toContain("80-%-Band von 1,660 €/L bis 1,790 €/L");
  });

  it("nennt die Einheit, wenn eine mitkommt", () => {
    const text = lineChartAlt({
      series: [{ pts: [{ x: 0, y: 1.7 }, { x: 1, y: 1.8 }] }],
      unit: " €/L",
    });
    expect(text).toContain("Werte in €/L.");
  });

  it("erfindet ohne Punkte nichts", () => {
    expect(lineChartAlt({ series: [] })).toBe("Liniendiagramm ohne Werte.");
    expect(lineChartAlt({ series: [{ name: "Leer", pts: [] }] })).toBe(
      "Liniendiagramm ohne Werte.",
    );
  });
});
