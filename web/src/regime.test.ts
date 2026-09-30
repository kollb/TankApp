// Preisniveau-Hinweis (Tankrabatt): Text und Fensterregel.

import { describe, expect, it } from "vitest";
import {
  regimeDateLabel,
  regimeNoticeCopy,
  windowPastRegimeEdge,
  type RegimeNotice,
} from "./regime";

const upcoming: RegimeNotice = {
  at: "2026-09-30T22:00:00+00:00", // 01.10. 00:00 Berlin
  announced_local: "2026-10-01T00:00",
  announced_ct: -17,
  status: "announced",
  phase: "upcoming",
  days: 0,
};

describe("regimeNoticeCopy", () => {
  it("nennt Stichtag in Berliner Zeit und Betrag in ct/L", () => {
    expect(regimeDateLabel(upcoming)).toBe("01.10.");
    const copy = regimeNoticeCopy(upcoming)!;
    expect(copy.title).toBe("Tankrabatt ab 01.10.: bis zu 17 ct/L weniger");
    expect(copy.direction).toBe("down");
  });

  it("sagt, was die Prognose nicht weiß, und was stattdessen zählt", () => {
    const body = regimeNoticeCopy(upcoming)!.body;
    expect(body).toContain("kennt den Rabatt noch nicht");
    expect(body).toContain("Preis an der Säule");
    expect(body).toContain("nicht jede Station");
  });

  it("nach der Kante: lernt das neue Niveau, Preise in „Stationen“ prüfen", () => {
    const copy = regimeNoticeCopy({ ...upcoming, phase: "recent", days: 2 })!;
    expect(copy.title).toBe("Tankrabatt seit 01.10.: bis zu 17 ct/L weniger");
    expect(copy.body).toContain("lernt das neue Preisniveau");
    expect(copy.body).toContain("„Stationen“");
  });

  it("Anhebung (Rabatt-Ende) warnt in die andere Richtung", () => {
    const copy = regimeNoticeCopy({
      ...upcoming,
      at: "2026-12-31T23:00:00+00:00",
      announced_local: "2027-01-01T00:00",
      announced_ct: 17,
    })!;
    expect(copy.direction).toBe("up");
    expect(copy.title).toBe("Preissprung ab 01.01.: bis zu 17 ct/L mehr");
    expect(copy.body).toContain("lieber vorher tanken");
  });

  it("ohne Termin, ohne Betrag oder mit Unsinn: kein Hinweis", () => {
    expect(regimeNoticeCopy(null)).toBeNull();
    expect(regimeNoticeCopy(undefined)).toBeNull();
    expect(regimeNoticeCopy({ ...upcoming, announced_ct: 0 })).toBeNull();
    expect(regimeNoticeCopy({ ...upcoming, announced_ct: Number.NaN })).toBeNull();
    expect(
      regimeNoticeCopy({ ...upcoming, phase: "later" as unknown as "recent" }),
    ).toBeNull();
  });
});

describe("windowPastRegimeEdge", () => {
  const win = (end: string) => ({ end });

  it("Fenster, das den Stichtag berührt oder danach liegt, bekommt keinen Abstand", () => {
    expect(windowPastRegimeEdge(win("2026-10-01T05:55:00+00:00"), upcoming)).toBe(true);
    expect(windowPastRegimeEdge(win("2026-09-30T22:00:00+00:00"), upcoming)).toBe(true);
  });

  it("Fenster davor bleibt vergleichbar", () => {
    expect(windowPastRegimeEdge(win("2026-09-30T20:00:00+00:00"), upcoming)).toBe(false);
  });

  it("nach der Kante oder ohne Hinweis gilt der Vergleich wieder", () => {
    const after = { ...upcoming, phase: "recent" as const };
    expect(windowPastRegimeEdge(win("2026-10-05T05:55:00+00:00"), after)).toBe(false);
    expect(windowPastRegimeEdge(win("2026-10-05T05:55:00+00:00"), null)).toBe(false);
    expect(windowPastRegimeEdge(null, upcoming)).toBe(false);
    expect(windowPastRegimeEdge(win("kaputt"), upcoming)).toBe(false);
  });
});
