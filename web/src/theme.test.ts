// @vitest-environment happy-dom
// Theme-Wahl: „System“ ist die Voreinstellung, Dunkel der Rückfall.
//
// Der Test prüft die Regeln, die vorher in zwei Zuständen steckten (hell war
// immer der Start) — und die Kopplung an den Speicher: nur eine
// ausdrückliche Wahl liegt in `tankapp.theme`, „System“ entfernt den
// Schlüssel wieder. Sonst könnte der Bootstrap vor dem ersten Paint nicht
// unterscheiden, ob er dem Betriebssystem folgen soll.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isThemeChoice,
  readThemeChoice,
  resolveTheme,
  storeThemeChoice,
  systemTheme,
  THEME_CHOICES,
  THEME_STORAGE_KEY,
} from "./theme";

/** matchMedia-Attrappe mit steuerbarem Ergebnis. */
function fakeMatchMedia(light: boolean) {
  const listeners: Array<() => void> = [];
  const media = {
    matches: light,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: () => {},
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  return {
    media,
    flip(next: boolean) {
      media.matches = next;
      listeners.forEach((fn) => fn());
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  // happy-dom antwortet auf jede Media Query mit „passt“ — für die
  // Voreinstellung „System“ wird das Ergebnis deshalb je Test gestellt.
  fakeMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Theme-Wahl (src/theme.ts)", () => {
  it("kennt genau drei Wahlen", () => {
    expect([...THEME_CHOICES]).toEqual(["system", "dark", "light"]);
    expect(isThemeChoice("system")).toBe(true);
    expect(isThemeChoice("dark")).toBe(true);
    expect(isThemeChoice("light")).toBe(true);
    expect(isThemeChoice("Hell")).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
    expect(isThemeChoice(undefined)).toBe(false);
  });

  it("fällt auf Dunkel zurück, wenn das System nicht abfragbar ist", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => {
        throw new Error("kein matchMedia");
      }),
    );
    expect(systemTheme()).toBe("dark");
  });

  it("folgt nur einem ausdrücklichen System-Hell", () => {
    fakeMatchMedia(false);
    expect(systemTheme()).toBe("dark");
    fakeMatchMedia(true);
    expect(systemTheme()).toBe("light");
  });

  it("löst Wahl und Systemzustand zusammen auf", () => {
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("dark", "light")).toBe("dark");
    expect(resolveTheme("light", "dark")).toBe("light");
  });

  it("liest ohne gespeicherten Wert „System“", () => {
    expect(readThemeChoice()).toBe("system");
  });

  it("akzeptiert alte und neue gespeicherte Werte, verwirft Unsinn", () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify("dark"));
    expect(readThemeChoice()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify("light"));
    expect(readThemeChoice()).toBe("light");
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify("neon"));
    expect(readThemeChoice()).toBe("system");
    localStorage.setItem(THEME_STORAGE_KEY, "{kein json");
    expect(readThemeChoice()).toBe("system");
  });

  it("entfernt den Schlüssel bei „System“ und schreibt sonst die Wahl", () => {
    storeThemeChoice("light");
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toBe("light");
    storeThemeChoice("dark");
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toBe("dark");
    storeThemeChoice("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
