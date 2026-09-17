// @vitest-environment happy-dom

import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LineChart } from "./components/LineChart";

describe("O10 thin forecast support marker", () => {
  it("marks a seven-day supported slot in the forecast band", () => {
    const html = renderToStaticMarkup(
      <LineChart
        series={[{ name: "Median", color: "#38bdf8", pts: [{ x: 1, y: 1.7 }, { x: 2, y: 1.71 }] }]}
        bands={[{
          name: "80-%-Band",
          color: "#38bdf8",
          pts: [
            { x: 1, yLow: 1.68, yHigh: 1.72, thin: true, supportDays: 7 },
            { x: 2, yLow: 1.69, yHigh: 1.73 },
          ],
        }]}
      />,
    );
    expect(html).toContain("Dünn gestützter Prognose-Slot: 7 Tage");
  });
});
