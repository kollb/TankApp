// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RegimeNotice } from "./RegimeNotice";

const notice = {
  at: "2026-09-30T22:00:00+00:00",
  announced_local: "2026-10-01T00:00",
  announced_ct: -17,
  status: "announced",
  phase: "upcoming" as const,
  days: 0,
};

describe("RegimeNotice", () => {
  it("zeigt Titel und Erklärung als benannten Bereich", () => {
    const html = renderToStaticMarkup(<RegimeNotice notice={notice} />);
    expect(html).toContain('aria-label="Tankrabatt ab 01.10.: bis zu 17 ct/L weniger"');
    expect(html).toContain("Die Prognose kennt den Rabatt noch nicht");
  });

  it("bleibt ohne Termin unsichtbar", () => {
    expect(renderToStaticMarkup(<RegimeNotice notice={null} />)).toBe("");
    expect(renderToStaticMarkup(<RegimeNotice notice={undefined} />)).toBe("");
  });
});
