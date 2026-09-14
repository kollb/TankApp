// C7: Glossar-Tabelle („Was heißt das?“) — Invarianten der Hilfe-Seite.
// Die Doku-Anker selbst prüft tests/test_glossary.py gegen docs/ANALYSE.md;
// hier steht, was die Tabelle aus sich heraus garantiert: Pflichtbegriffe,
// vollständige Einträge, ehrliche Lebenszyklus-Texte (kein Kontingent-
// Versprechen — tote Stationen werden weiter gepollt, bis das Polling-Set
// per Tausch-Anleitung bereinigt ist).

import { describe, expect, it } from "vitest";
import {
  GLOSSARY,
  glossaryById,
  lifecycleLabel,
  lifecycleTip,
  lifecycleTone,
} from "./data";

describe("C7: Glossar-Tabelle ist vollständig", () => {
  it("enthält die Pflichtbegriffe des Labors", () => {
    const ids = new Set(GLOSSARY.map((g) => g.id));
    for (const id of [
      "delta",
      "mase",
      "picp",
      "brier",
      "eps",
      "regret",
      "qvalue",
      "avscore",
      "lifecycle",
      "twins",
    ]) {
      expect(ids.has(id), `Glossar ohne ${id}`).toBe(true);
    }
  });

  it("hat eindeutige IDs und keine leeren Felder", () => {
    const ids = GLOSSARY.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of GLOSSARY) {
      for (const field of ["term", "de", "short", "long", "anchor"] as const) {
        expect(entry[field]?.length ?? 0, `${entry.id}: ${field} fehlt`).toBeGreaterThan(0);
      }
    }
  });

  it("findet Einträge per glossaryById", () => {
    expect(glossaryById("twins")?.de).toBe("Stationen mit identischem Preisverlauf");
    expect(glossaryById("gibtesnicht")).toBeUndefined();
  });
});

describe("A12: Lebenszyklus-Texte versprechen kein Kontingent", () => {
  it.each(["active", "dead", "closed", "no_fuel"] as const)(
    "label/tip/tone für %s",
    (lc) => {
      expect(lifecycleLabel(lc).length).toBeGreaterThan(0);
      expect(lifecycleTip(lc).length).toBeGreaterThan(0);
      expect(["neutral", "warn", "error"]).toContain(lifecycleTone(lc));
    },
  );

  it("sagt ehrlich, was mit toten Stationen passiert", () => {
    expect(lifecycleTip("dead")).toContain("Ranking");
    expect(lifecycleTip("dead")).not.toContain("Kontingent");
    expect(lifecycleLabel("unbekannt" as never)).toBe("unbekannt");
  });
});
