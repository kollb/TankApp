// @vitest-environment happy-dom
// U3 (GUI-UX-BEFUND): die Bereichs-Navigation folgt den Geräte-Rastern des
// Entwurfs (UI-NEUENTWURF §13) — sechs Aufgaben-Bereiche, mobil unten,
// desktop links. Das Glossar ist kein Hauptbereich mehr.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppNav, NAV_ITEMS } from "./AppNav";

describe("U3: Bereichs-Navigation", () => {
  it("hat genau die sechs Aufgaben-Bereiche — kein Glossar", () => {
    expect(NAV_ITEMS.map((item) => item.id)).toEqual([
      "jetzt",
      "stations",
      "week",
      "ich",
      "labor",
      "system",
    ]);
    expect(NAV_ITEMS.some((item) => item.label === "Glossar")).toBe(false);
  });

  it("zeigt alle sechs Bereiche mit 44-px-Zielen und dem aktiven Stand", () => {
    const html = renderToStaticMarkup(
      <AppNav tab="week" onSelect={() => {}} />,
    );
    for (const item of NAV_ITEMS) {
      expect(html, `Bereich „${item.label}“ fehlt`).toContain(item.label);
    }
    expect(html).toContain("min-h-11");
    // Der aktive Bereich trägt aria-current, die anderen nicht.
    expect(html.match(/aria-current="page"/g)?.length ?? 0).toBe(1);
    expect(html).toContain('aria-label="Bereiche"');
  });
});
