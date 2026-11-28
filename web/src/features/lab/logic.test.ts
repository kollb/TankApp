import { describe, expect, it } from "vitest";
import { reliabilityBinView } from "./logic";

describe("Labor: Zuverlässigkeits-Bins aus dem Serververtrag", () => {
  it("übersetzt lo/hi, p/rate und n statt erfundene Fallback-Werte zu zeigen", () => {
    expect(reliabilityBinView({ lo: 0.2, hi: 0.4, p: 0.31, rate: 0.5, n: 12 }, 0)).toEqual({
      range: "0,2–0,4",
      predicted: 0.31,
      observed: 0.5,
      count: 12,
    });
  });

  it("fällt auf explizite Ersatzfelder zurück und lässt ungültige Werte leer", () => {
    expect(reliabilityBinView({ range: "0,4–0,6", predicted: 0.51, observed: Number.NaN, count: 3 }, 2)).toEqual({
      range: "0,4–0,6",
      predicted: 0.51,
      observed: null,
      count: 3,
    });
  });
});
