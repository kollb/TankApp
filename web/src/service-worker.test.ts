// B10: Die Entscheidungen des Service-Worker-Hinweises — rein, ohne Browser.
import { describe, expect, it } from "vitest";
import {
  readDismissed,
  UPDATE_CHECK_MS,
  UPDATE_DISMISS_KEY,
  updateNotice,
  writeDismissed,
} from "./service-worker";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

describe("Service-Worker-Update (B10)", () => {
  it("sagt, auf welchem Stand die Ansicht läuft", () => {
    expect(updateNotice("0.37.2").text).toContain("0.37.2");
    expect(updateNotice("").text).toContain("alten Stand");
    expect(updateNotice("dev").text).toContain("alten Stand");
  });

  it("verspricht nichts über die Eingaben: sie bleiben gespeichert", () => {
    expect(updateNotice("0.37.2").note).toContain("Eingaben bleiben gespeichert");
  });

  it("„Später“ gilt für die Sitzung und lässt sich zurücksetzen", () => {
    const storage = fakeStorage();
    expect(readDismissed(storage)).toBe(false);
    writeDismissed(storage);
    expect(storage.getItem(UPDATE_DISMISS_KEY)).toBe("1");
    expect(readDismissed(storage)).toBe(true);
    writeDismissed(storage, false);
    expect(readDismissed(storage)).toBe(false);
  });

  it("ohne Storage (privater Modus) bleibt alles still statt zu werfen", () => {
    expect(readDismissed(null)).toBe(false);
    expect(() => writeDismissed(null)).not.toThrow();
  });

  it("fragt nicht dauernd nach: Prüftakt ist eine halbe Stunde", () => {
    expect(UPDATE_CHECK_MS).toBe(30 * 60 * 1000);
  });
});
