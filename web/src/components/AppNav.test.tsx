// @vitest-environment happy-dom
// U3 (GUI-UX-BEFUND): die Bereichs-Navigation folgt den Geräte-Rastern des
// Entwurfs (UI-NEUENTWURF §13) — sechs Aufgaben-Bereiche, mobil unten,
// desktop links. Das Glossar ist kein Hauptbereich mehr.
//
// CI-Fix 0.40.0: `SideNav` und `MobileNav` sind zwei Bausteine über derselben
// Liste; welche Variante sichtbar ist, entscheidet allein CSS (`hidden`/
// `lg:`-Varianten). `MobileNav` wird in Dashboard.tsx als letztes Element
// der App-Hülle montiert, damit der Inhalt ihre Klicks nie abfangen kann.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileNav, NAV_ITEMS, SideNav } from "./AppNav";

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

  for (const [name, Nav] of [
    ["MobileNav", MobileNav],
    ["SideNav", SideNav],
  ] as const) {
    it(`${name}: zeigt alle sechs Bereiche mit 44-px-Zielen und dem aktiven Stand`, () => {
      const html = renderToStaticMarkup(<Nav tab="week" onSelect={() => {}} />);
      for (const item of NAV_ITEMS) {
        expect(html, `Bereich „${item.label}“ fehlt`).toContain(item.label);
      }
      expect(html).toContain("min-h-11");
      // Der aktive Bereich trägt aria-current, die anderen nicht.
      expect(html.match(/aria-current="page"/g)?.length ?? 0).toBe(1);
      expect(html).toContain('aria-label="Bereiche"');
    });
  }

  it("die mobile Leiste ist fixiert und liegt über dem Inhalt (z-50)", () => {
    const html = renderToStaticMarkup(
      <MobileNav tab="jetzt" onSelect={() => {}} />,
    );
    expect(html).toContain("fixed");
    expect(html).toContain("bottom-0");
    expect(html).toContain("z-50");
    expect(html).toContain("lg:hidden");
  });

  it("die Seitenleiste ist nur ab Desktop sichtbar", () => {
    const html = renderToStaticMarkup(
      <SideNav tab="jetzt" onSelect={() => {}} />,
    );
    expect(html).toContain("hidden");
    expect(html).toContain("lg:flex");
    expect(html).toContain("sticky");
  });
});
