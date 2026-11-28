import { describe, expect, it } from "vitest";
import { GLOSSARY, glossaryById } from "./terms";

describe("Glossar", () => {
  it("has unique ids, German primary explanations, and nonempty detail", () => {
    const ids = GLOSSARY.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const term of GLOSSARY) {
      expect(term.term.trim()).not.toBe("");
      expect(term.de.trim()).not.toBe("");
      expect(term.short.trim()).not.toBe("");
      expect(term.long.trim()).not.toBe("");
    }
  });

  it("keeps the documented core terms and stable lookup semantics", () => {
    const ids = new Set(GLOSSARY.map(({ id }) => id));
    for (const id of ["delta", "mase", "picp", "brier", "eps", "regret", "qvalue", "avscore", "lifecycle", "twins"]) {
      expect(ids.has(id), `Pflichtbegriff ${id} fehlt`).toBe(true);
    }
    expect(glossaryById("mase-24h")?.de).toBe("MASE 24 Stunden");
    expect(glossaryById("twins")?.long).toContain("Warnung");
    expect(glossaryById("missing")).toBeUndefined();
  });
});
