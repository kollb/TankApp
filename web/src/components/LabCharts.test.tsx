// Nutzer-Feedback 17.09.2026: „Preis-Abstand je Station · Frankfurt“ — bei
// einem großen Stationsset standen die Stationsnamen der X-Achse übereinander
// und waren nicht mehr lesbar. Die Achse kippt seither um 45°, sobald der
// längste Name breiter ist als eine Balkenspur, kürzt mit „…“ und hält den
// vollen Namen per <title> bereit. Festgehalten gegen echtes SVG-Markup.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeltaBars } from "./LabCharts";

describe("DeltaBars-X-Achse", () => {
  it("lässt wenige kurze Namen waagrecht und ungekürzt stehen", () => {
    const html = renderToStaticMarkup(
      <DeltaBars
        values={[-1.2, 0.4, 2.1]}
        labels={["Aral", "Shell", "HEM"]}
      />,
    );
    expect(html).not.toContain("rotate(");
    expect(html).toContain(">Aral<");
    expect(html).toContain(">Shell<");
    expect(html).toContain(">HEM<");
  });

  it("kippt viele lange Stationsnamen um 45° und kürzt mit „…“", () => {
    const count = 30;
    const values = Array.from({ length: count }, (_, i) => (i % 5) - 2);
    const labels = Array.from(
      { length: count },
      (_, i) => `Autohof an der Bundesstraße ${i + 10}`,
    );
    const html = renderToStaticMarkup(
      <DeltaBars values={values} labels={labels} />,
    );
    // Gekippte Achse …
    expect(html).toContain("rotate(-45");
    // … und der Name steht gekürzt mit „…“ in der Achse …
    expect(html).toContain(">Autohof an der Bunde…<");
    // … bleibt aber vollständig per <title> erreichbar.
    expect(html).toContain("<title>Autohof an der Bundesstraße 10</title>");
  });

  it("wächst im gekippten Fall in die Höhe, damit der Fußraum reicht", () => {
    const count = 10;
    const values = Array.from({ length: count }, () => 1);
    const small = renderToStaticMarkup(
      <DeltaBars values={values} labels={values.map((_, i) => `S${i}`)} />,
    );
    const big = renderToStaticMarkup(
      <DeltaBars
        values={values}
        labels={values.map((_, i) => `Autohof an der Bundesstraße ${i}`)}
      />,
    );
    const heightOf = (html: string) =>
      Number(html.match(/viewBox="0 0 720 (\d+)"/)?.[1] ?? 0);
    expect(heightOf(big)).toBeGreaterThan(heightOf(small));
  });
});
