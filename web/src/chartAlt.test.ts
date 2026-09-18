// O40 — die Textalternativen selbst: Werte statt Reihennamen.
//
// Der Ratchet in `a11y.test.ts` prüft das gerenderte Markup („jedes Diagramm
// hat eine Beschreibung mit einer formatierten Zahl“). Hier stehen die Regeln
// der Sätze: welche Zahl genannt wird, welche weggelassen, und was passiert,
// wenn keine Daten da sind — kein Satz darf eine Zahl erfinden.

import { describe, expect, it } from "vitest";
import {
  calibChartAlt,
  deltaBarsAlt,
  histogramAlt,
  lineChartAlt,
  seriesTrend,
} from "./chartAlt";
import { centPerLiter, euroPerLiter } from "./data";

const ct = (v: number) => centPerLiter(v);
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

describe("histogramAlt", () => {
  it("nennt Umfang, Spanne und Mitte", () => {
    const text = histogramAlt({
      values: [1, 2, 3, 4, 100],
      fmt: ct,
    });
    expect(text).toContain("über 5 Werte");
    expect(text).toContain("von 1,0 ct/L bis 100,0 ct/L");
    expect(text).toContain("Mitte 3,0 ct/L");
  });

  it("nennt gesetzte Schwellen mit ihrem Wert", () => {
    const text = histogramAlt({
      values: [1, 2, 3],
      fmt: ct,
      thresholds: [{ label: "ε", x: 1.5 }],
    });
    expect(text).toContain("Schwellen: ε bei 1,5 ct/L");
  });

  it("erfindet ohne Werte keine Verteilung", () => {
    expect(histogramAlt({ values: [] })).toBe("Histogramm ohne Werte.");
  });
});

describe("deltaBarsAlt", () => {
  it("zählt beide Seiten und nennt die Ausreißer mit Namen", () => {
    const text = deltaBarsAlt({
      values: [-2.4, -0.3, 1.8],
      labels: ["Nord", "Mitte", "Ost"],
      fmt: ct,
    });
    expect(text).toContain("3 Balken, 2 unter null, 1 über null");
    expect(text).toContain("nach unten Nord mit -2,4 ct/L");
    expect(text).toContain("nach oben Ost mit 1,8 ct/L");
  });

  it("zählt die blassen Balken statt sich auf die Farbe zu verlassen", () => {
    const text = deltaBarsAlt({
      values: [-1, 2],
      labels: ["A", "B"],
      fmt: ct,
      muted: [true, false],
    });
    expect(text).toContain("1 davon statistisch nicht signifikant");
  });

  it("kommt ohne Namen aus", () => {
    const text = deltaBarsAlt({ values: [-1, 2], fmt: ct });
    expect(text).toContain("nach unten -1,0 ct/L");
  });

  it("erfindet ohne Balken nichts", () => {
    expect(deltaBarsAlt({ values: [] })).toBe("Balkendiagramm ohne Werte.");
  });
});

describe("calibChartAlt", () => {
  it("nennt die Richtung der Abweichung von der Diagonalen", () => {
    const over = calibChartAlt({
      points: [
        { p: 0.6, hit: 0.7, n: 40 },
        { p: 0.8, hit: 0.9, n: 20 },
      ],
    });
    expect(over).toContain("über der Diagonalen (zu vorsichtig versprochen)");
    expect(over).toContain("2 Punkte über 60 Fälle");

    const under = calibChartAlt({
      points: [{ p: 0.8, hit: 0.5, n: 10 }],
    });
    expect(under).toContain("unter der Diagonalen (zu viel versprochen)");
  });

  it("nennt eine treffende Kalibrierung als solche", () => {
    const text = calibChartAlt({ points: [{ p: 0.6, hit: 0.6, n: 30 }] });
    expect(text).toContain("im Mittel auf der Diagonalen");
  });

  it("weist die Live-Punkte getrennt aus", () => {
    const text = calibChartAlt({
      points: [{ p: 0.6, hit: 0.6, n: 30 }],
      livePoints: [{ p: 0.7, hit: 0.7, n: 5 }],
    });
    expect(text).toContain("1 aus echten Live-Empfehlungen");
  });

  it("erfindet ohne Punkte keine Güte", () => {
    expect(calibChartAlt({ points: [] })).toBe(
      "Kalibrierungsdiagramm ohne Punkte.",
    );
  });
});
