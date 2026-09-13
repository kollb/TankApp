import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Die App liefert `Content-Security-Policy: script-src 'self'` ohne
 *  'unsafe-inline'. Ein Inline-Block im <head> wäre damit gesperrt — genau so
 *  war der C4-Theme-Bootstrap bis 0.30.0 verbaut: die Umschaltung flackerte
 *  beim Laden, im Konsolenprotokoll stand die CSP-Meldung. Dieses Ratchet
 *  hält den Bootstrap in der eigenen Datei. */
const readRoot = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const indexHtml = readRoot("web/index.html");
const boot = readRoot("web/public/theme-boot.js");

describe("Theme-Bootstrap vor dem ersten Paint", () => {
  it("hat kein Inline-Skript in index.html", () => {
    const scripts = indexHtml.replace(/<!--[\s\S]*?-->/g, "").match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toMatch(/src=/);
    }
  });

  it("bindet den Bootstrap als eigene Datei ein", () => {
    expect(indexHtml).toMatch(/<script src="\/theme-boot\.js"><\/script>/);
  });

  it("liest denselben Schalter, den Dashboard.tsx schreibt", () => {
    expect(boot).toContain("tankapp.theme");
    expect(boot).toContain('"light"');
    expect(boot).toContain("theme-color");
  });
});
