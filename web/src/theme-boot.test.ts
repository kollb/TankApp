import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readRoot = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");
const indexHtml = readRoot("web/index.html");
const boot = readRoot("web/public/theme-boot.js");
const styles = readRoot("web/src/styles.css");

describe("Theme-Bootstrap der aktuellen App", () => {
  it("bindet ein externes Skript ein, damit die CSP keinen Inline-Block sperrt", () => {
    const scripts = indexHtml.replace(/<!--[\s\S]*?-->/g, "").match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toMatch(/src=/);
    expect(indexHtml).toMatch(/<script src="\/theme-boot\.js"><\/script>/);
  });

  it("setzt das dunkle App-Theme vor dem ersten Paint und stimmt mit den CSS-Tokens überein", () => {
    expect(boot).toContain('document.documentElement.classList.remove("light")');
    expect(boot).toContain('document.documentElement.classList.add("dark")');
    expect(boot).toContain('content", "#0E1113"');
    expect(boot).not.toContain("localStorage");
    expect(styles).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/s);
    expect(styles).toContain("--surface-bg: #0E1113");
  });
});
