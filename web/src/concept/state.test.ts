import { describe, expect, it } from "vitest";
import { profileSavings, routeUrl } from "./state";
import { labComponents, labStructure } from "./labConcept";
import { curves, hours, levelOf } from "./data";

describe("isolated prototype calculations", () => {
  it("keeps annotation numbers aligned across all laboratory data states", () => {
    for (const sections of Object.values(labStructure)) {
      expect(sections).toHaveLength(7);
      expect(sections[6].name).toBe("Für Technik-Fans");
    }
  });
  it("documents the twelve laboratory components", () => {
    expect(labComponents).toHaveLength(12);
  });
  it("scales a 45-liter filling and clearly assumed 24 annual fillings", () => {
    expect(profileSavings(45, 2).filling).toBeCloseTo(3.6);
    expect(profileSavings(45, 2).annual).toBeCloseTo(86.4);
    expect(profileSavings(80, 0)).toEqual({ filling: 0, annual: 0 });
    expect(profileSavings(20, 1).filling).toBeCloseTo(0.7);
  });
  it("retains eight future hours plus the current time for every verdict", () => {
    for (const values of Object.values(curves))
      expect(values).toHaveLength(hours.length);
    expect(hours).toHaveLength(9);
  });
  it("encodes an external navigation destination, never a write API", () => {
    const url = new URL(routeUrl("Frankfurter Ring 227"));
    expect(url.origin).toBe("https://www.google.com");
    expect(url.searchParams.get("destination")).toBe(
      "Frankfurter Ring 227, München",
    );
  });
  it("uses consistent traffic-light thresholds", () => {
    expect(levelOf(1.68, 1.679)).toBe("low");
    expect(levelOf(1.71, 1.679)).toBe("mid");
    expect(levelOf(1.75, 1.679)).toBe("high");
  });
});
