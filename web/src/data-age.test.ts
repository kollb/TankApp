/**
 * C6 (Rest): Schwellen und Sätze für „Datenstand älter als X“.
 *
 * Die Regel gehört in eine Funktion, nicht in fünf Panels: Sonst entscheidet
 * jede Ansicht selbst, ab wann eine Zahl alt ist — und die App wird genau an
 * der Stelle unehrlich, an der sie es nicht sein darf (Konzept §0.4).
 */
import { describe, expect, it } from "vitest";
import {
  ageLabel,
  ageMinutes,
  dataAgeNote,
  freshness,
  STALE_AFTER_MINUTES,
} from "./data";

/** Fester Bezugspunkt, damit die Tests nicht von der Uhr abhängen. */
const NOW = Date.parse("2026-09-12T12:00:00+02:00");
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

describe("C6: Datenstand-Alter", () => {
  it("Alter in Minuten, robust gegen Müll und Zukunft", () => {
    expect(ageMinutes(minutesAgo(30), NOW)).toBeCloseTo(30, 5);
    expect(ageMinutes(null, NOW)).toBeNull();
    expect(ageMinutes("kein Datum", NOW)).toBeNull();
    // Ein Stand „aus der Zukunft“ (Uhren-Versatz) ist kein negatives Alter.
    expect(ageMinutes(new Date(NOW + 60000).toISOString(), NOW)).toBe(0);
  });

  it("Frische je Datenart: frisch / veraltet / alt", () => {
    const limit = STALE_AFTER_MINUTES.prices;
    expect(freshness(minutesAgo(limit - 1), "prices", NOW)).toBe("fresh");
    expect(freshness(minutesAgo(limit), "prices", NOW)).toBe("stale");
    expect(freshness(minutesAgo(limit * 2), "prices", NOW)).toBe("old");
    expect(freshness(null, "prices", NOW)).toBe("unknown");
  });

  it("Prognosen und Selektion dürfen älter sein als Preise", () => {
    // Zwei Stunden: für Preise längst alt, für den Modell-Lauf noch frisch.
    expect(freshness(minutesAgo(120), "prices", NOW)).toBe("old");
    expect(freshness(minutesAgo(120), "model", NOW)).toBe("fresh");
    expect(freshness(minutesAgo(120), "selection", NOW)).toBe("fresh");
  });

  it("Alter in Worten, deutsch und gerundet", () => {
    expect(ageLabel(minutesAgo(0.2), NOW)).toBe("gerade eben");
    expect(ageLabel(minutesAgo(1), NOW)).toBe("vor 1 Minute");
    expect(ageLabel(minutesAgo(42), NOW)).toBe("vor 42 Minuten");
    expect(ageLabel(minutesAgo(60), NOW)).toBe("vor 1 Stunde");
    expect(ageLabel(minutesAgo(300), NOW)).toBe("vor 5 Stunden");
    expect(ageLabel(minutesAgo(60 * 24), NOW)).toBe("vor 1 Tag");
    expect(ageLabel(minutesAgo(60 * 24 * 3), NOW)).toBe("vor 3 Tagen");
    expect(ageLabel(null, NOW)).toBe("—");
  });

  it("kein Banner bei frischen oder unbekannten Ständen", () => {
    expect(dataAgeNote(minutesAgo(5), "prices", NOW)).toBeNull();
    // Unbekannt heißt: nichts behaupten — weder „frisch“ noch „alt“.
    expect(dataAgeNote(null, "prices", NOW)).toBeNull();
    expect(dataAgeNote("kaputt", "model", NOW)).toBeNull();
  });

  it("Banner nennt Alter, Uhrzeit und Folge — je Datenart anders", () => {
    const prices = dataAgeNote(minutesAgo(45), "prices", NOW);
    expect(prices?.tone).toBe("warn");
    expect(prices?.text).toMatch(/vor 45 Minuten/);
    expect(prices?.text).toMatch(/eingefroren/);

    const model = dataAgeNote(minutesAgo(60 * 5), "model", NOW);
    expect(model?.tone).toBe("warn");
    expect(model?.text).toMatch(/kein Modell-Update/);

    const selection = dataAgeNote(minutesAgo(60 * 24 * 2), "selection", NOW);
    expect(selection?.text).toMatch(/Selektions-Lauf/);
  });

  it("doppelte Schwelle verschärft den Ton auf error", () => {
    expect(dataAgeNote(minutesAgo(31), "prices", NOW)?.tone).toBe("warn");
    expect(dataAgeNote(minutesAgo(61), "prices", NOW)?.tone).toBe("error");
  });
});
