import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const styles = source("styles.css");
const shell = source("components/layout/AppShell.tsx");
const root = styles.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? "";
const lightTheme = styles.match(/html\.light\s*\{([\s\S]*?)\}/)?.[1] ?? "";

function color(name: string, variables = root): string {
  const match = variables.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`CSS-Farbrolle --${name} fehlt`);
  return match[1].toLowerCase();
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe("Aktuelle Shell: Barrierefreiheits-Basics", () => {
  it("hält primäre, sekundäre und zurückhaltende Textfarben auf den M3-Flächen lesbar", () => {
    const surfaces = ["surface-bg", "surface-1", "surface-2", "surface-3"];
    for (const text of ["text-primary", "text-secondary"]) {
      for (const surface of surfaces) {
        expect(
          contrast(color(text), color(surface)),
          `${text} auf ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const [theme, variables] of [["dark", root], ["light", lightTheme]] as const) {
      for (const surface of surfaces) {
        expect(
          contrast(color("text-muted", variables), color(surface, variables)),
          `${theme}: text-muted auf ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("hält Zustandsfarben auf ihren Containerflächen unterscheidbar", () => {
    for (const [text, background] of [
      ["accent-go", "accent-go-container"],
      ["accent-wait", "accent-wait-container"],
      ["accent-risk", "accent-risk-container"],
      ["accent-neutral", "accent-neutral-container"],
    ]) {
      expect(
        contrast(color(text), color(background)),
        `${text} auf ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("zeigt Tastaturfokus sichtbar und bietet mobil mindestens 44 px hohe Nav-Ziele", () => {
    expect(styles).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-wait\)/);
    expect(styles).toMatch(/\.mobile-nav \.nav-link\s*\{[^}]*min-height:\s*50px/s);
  });

  it("beschriftet Navigation und kennzeichnet den aktiven Bereich semantisch", () => {
    expect(shell).toContain('aria-label="Hauptnavigation"');
    expect(shell).toContain('aria-label="Mobile Navigation"');
    expect(shell).toContain('aria-current={active ? "page" : undefined}');
  });
});
