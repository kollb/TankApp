// P3/P4: Schließzeit-Badge, Stabilitäts-Zeile und Feiertags-/Brückentag-
// Hinweise. Reine Logik — die Ansichten rendern nur diese Sätze.

import { describe, expect, it } from "vitest";
import { calendarHintLines } from "./week";
import { closingBadgeLabel, stabilityLine } from "./stations";

const NOW = Date.parse("2026-11-28T09:00:00+01:00");

describe("Feiertags- und Brückentag-Hinweise (P4)", () => {
  it("nennt Feiertage und Brückentage mit Namen in deutschen Anführungszeichen", () => {
    const lines = calendarHintLines(
      {
        source: "holidays:HE",
        subdiv: "HE",
        items: [
          { date: "2026-06-04", kind: "holiday", name: "Fronleichnam" },
          { date: "2026-06-05", kind: "bridge", name: "Fronleichnam" },
        ],
      },
      Date.parse("2026-06-04T09:00:00+02:00"),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Feiertag „Fronleichnam“");
    expect(lines[1]).toContain("Brückentag zu „Fronleichnam“");
    for (const line of lines) {
      expect(line).not.toMatch(/"/);
    }
  });

  it("zeigt nichts, wenn keine Tage in den nächsten 7 Tagen liegen oder die Angabe fehlt", () => {
    expect(calendarHintLines({ source: "holidays:HE", subdiv: "HE", items: [] }, NOW)).toEqual([]);
    expect(calendarHintLines(undefined, NOW)).toEqual([]);
    expect(calendarHintLines(null, NOW)).toEqual([]);
  });
});

describe("Schließzeit-Badge (P3)", () => {
  it("zeigt „Schließt bald“ nur bei Server-Urteil", () => {
    expect(closingBadgeLabel({ closingSoon: true })).toBe("Schließt bald");
    expect(closingBadgeLabel({ closingSoon: false })).toBeNull();
  });
});

describe("Stabilitäts-Zeile (P3)", () => {
  it("schweigt ohne gemessene Historie", () => {
    expect(stabilityLine(null)).toBeNull();
    expect(stabilityLine(undefined)).toBeNull();
    expect(
      stabilityLine({ status: "insufficient", phases: 1, held_share: null, avg_hold_min: null, flicker_share: null }),
    ).toBeNull();
  });

  it("beschreibt flackernde und gehaltene Preise dezent", () => {
    const flicker = stabilityLine({ status: "measured", phases: 12, held_share: 0.1, avg_hold_min: 5, flicker_share: 0.9 });
    const held = stabilityLine({ status: "measured", phases: 8, held_share: 0.9, avg_hold_min: 70, flicker_share: 0 });
    expect(flicker).toContain("Lockvogel");
    expect(held).toContain("halbe Stunde");
    expect(flicker).not.toMatch(/"/);
  });
});
