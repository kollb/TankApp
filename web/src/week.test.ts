// Woche: die Bestenliste (UX-NEUENTWURF §4) — die reine Logik.
//
// Getestet werden die Ehrlichkeits-Grenzen der Liste:
//   * Höchstens drei Einträge, sortiert nach Ersparnis (§4).
//   * Fenster nur aus `decide.windows_week` — Tage ohne Fenster bleiben leer.
//   * Sicherheit als **ein Wort**; ohne messbares p „noch nicht messbar“.
//   * Der Tank ist Anzeige: Reichweite, nie „reicht bis Do“ (keine
//     Routen-Daten für kommende Tage).

import { describe, expect, it } from "vitest";
import type { DecideResult, TankInfo } from "./data";
import {
  WEEK_UNCERTAIN_FROM_DAY,
  WEEK_UNCERTAIN_NOTE,
  weekEntryWhy,
  weekRanking,
  weekTankLine,
  type WeekWindow,
} from "./week";

// Fester Zeitpunkt: Montag, 12:00 Uhr Berlin (UTC+2).
const NOW = Date.parse("2026-09-14T12:00:00+02:00");

function window(
  start: string,
  overrides: Partial<WeekWindow> = {},
): WeekWindow {
  return {
    start,
    end: start,
    expected_price: 1.7,
    expected_saving_eur: null,
    p: null,
    ...overrides,
  };
}

function decide(overrides: Partial<DecideResult> = {}): DecideResult {
  return {
    primary: {
      action: "wait",
      station: {
        id: "a",
        name: "A-Station",
        brand: "Test",
        price_now: 1.759,
        maps_url: null,
      },
      recommended_window: null,
      expected_saving_eur: 0,
      p_correct: 0.8,
      confidence_badge: "high",
      reason_short: "Warten lohnt sich voraussichtlich.",
    },
    alternatives_nearby: [],
    windows_today: [],
    windows_week: [],
    episode: { id: "e1", status: "open", intent: "none" },
    personal_stats: {
      advice: { last_30d_hits: 8, last_30d_total: 10, hit_rate: 0.8, brier_30d: 0.2 },
      wallet: { fills_30d: 1, followed: 1, saved_eur_30d: 1.2 },
    },
    calibrated: true,
    decision_ready: true,
    ...overrides,
  };
}

const tank = (overrides: Partial<TankInfo> = {}): TankInfo => ({
  input: "input",
  tank_percent: 50,
  tank_capacity_l: 50,
  range_km: 200,
  reserve_range_km: 190,
  state: "ok",
  blocks_wait: false,
  message: null,
  ...overrides,
});

const ranking = (
  windows: WeekWindow[] | null,
  overrides: Partial<Parameters<typeof weekRanking>[0]> = {},
) =>
  weekRanking({
    windows,
    decide: decide(),
    now: NOW,
    ...overrides,
  });

describe("weekRanking: Bestenliste statt Raster (§4)", () => {
  const windows = [
    // Dienstag, 19–21 Uhr Berlin.
    window("2026-09-15T19:00:00+02:00", {
      end: "2026-09-15T21:00:00+02:00",
      expected_price: 1.72,
      p: 0.8,
      expected_saving_eur: 1.4,
    }),
    // Dasselbe Fenster, günstigerer Nachbar — beide Dienstag, der
    // günstigere Erwartungspreis gewinnt den Tag (kein zweiter Eintrag).
    window("2026-09-15T19:30:00+02:00", {
      end: "2026-09-15T20:30:00+02:00",
      expected_price: 1.7,
      p: 0.6,
      expected_saving_eur: 1.6,
    }),
    // Freitag, 8–10 Uhr (Index 4 → unsicher).
    window("2026-09-18T08:00:00+02:00", {
      end: "2026-09-18T10:00:00+02:00",
      expected_price: 1.68,
      p: null,
      expected_saving_eur: null,
    }),
  ];

  it("nennt je Tag höchstens ein Fenster — das günstigste", () => {
    const list = ranking(windows);
    expect(list).toHaveLength(2);
    expect(list[0].dayLabel).toBe("Morgen");
    expect(list[0].expectedPrice).toBe(1.7);
    expect(list[0].timeLabel).toBe("~19 Uhr");
    expect(list[0].rangeLabel).toBe("19:30–20:30 Uhr");
    expect(list[0].priceLabel).toBe("1,700 €/L");
    expect(list[0].savingLabel).toBe("spart ca. 1,60 €");
    expect(list[0].uncertain).toBe(false);
  });

  it("sortiert nach Ersparnis, Unbekanntes nach hinten", () => {
    const list = ranking([
      window("2026-09-14T19:00:00+02:00", { expected_saving_eur: 0.5 }),
      window("2026-09-15T19:00:00+02:00", { expected_saving_eur: 2.1 }),
      window("2026-09-16T19:00:00+02:00", { expected_saving_eur: null }),
    ]);
    expect(list.map((entry) => entry.savingEur)).toEqual([2.1, 0.5, null]);
    expect(list.map((entry) => entry.dayLabel)).toEqual([
      "Morgen",
      "Heute",
      "Mittwoch",
    ]);
  });

  it("begrenzt auf drei Einträge — der Server liefert nicht mehr", () => {
    const list = ranking([
      window("2026-09-14T19:00:00+02:00", { expected_saving_eur: 3 }),
      window("2026-09-15T19:00:00+02:00", { expected_saving_eur: 2 }),
      window("2026-09-16T19:00:00+02:00", { expected_saving_eur: 1 }),
      window("2026-09-17T19:00:00+02:00", { expected_saving_eur: 0.5 }),
    ]);
    expect(list).toHaveLength(3);
    expect(list.map((entry) => entry.savingEur)).toEqual([3, 2, 1]);
  });

  it("ohne Server-Fenster bleibt die Liste leer (keine Erfindung)", () => {
    expect(ranking(null)).toEqual([]);
    expect(ranking([])).toEqual([]);
  });

  it("ignoriert Fenster außerhalb der sieben Tage", () => {
    expect(ranking([window("2026-10-01T19:00:00+02:00")])).toEqual([]);
  });

  it("O45: die Ersparnis folgt dem angezeigten Fensterpreis", () => {
    // Die Zeile nennt `expected_price` €/L — die Ersparnis daneben muss aus
    // demselben Preis folgen, nicht aus dem Median der Fensterminima.
    const list = ranking([
      window("2026-09-15T19:00:00+02:00", {
        expected_price: 2.221,
        expected_saving_eur: 2.09,
        expected_saving_median_eur: 0.44,
      }),
    ]);
    expect(list[0].savingEur).toBe(0.44);
  });

  it("hinter einem Preisniveau-Termin steht keine Ersparnis", () => {
    const notice = {
      phase: "upcoming" as const,
      at: "2026-09-16T00:00:00+02:00",
      announced_local: "16.09.2026 00:00",
      announced_ct: -8,
      status: "announced" as const,
      days: 2,
    };
    const list = ranking(
      [
        window("2026-09-15T19:00:00+02:00", { expected_saving_eur: 1.2 }),
        window("2026-09-18T08:00:00+02:00", {
          end: "2026-09-18T10:00:00+02:00",
          expected_saving_eur: 2.4,
        }),
      ],
      { notice },
    );
    // Das Fenster hinter der Kante trägt keine Zahl, rutscht aber nicht vor.
    expect(list.map((entry) => entry.savingEur)).toEqual([1.2, null]);
  });
});

describe("Sicherheit: ein Wort, kein Stern (§4)", () => {
  it("Stufe A: das Wort kommt aus dem gemessenen p", () => {
    const sure = ranking(
      [window("2026-09-15T19:00:00+02:00", { p: 0.8 })],
      { decide: decide() },
    );
    expect(sure[0].security).toBe("ziemlich sicher");
    const mid = ranking([window("2026-09-15T19:00:00+02:00", { p: 0.6 })]);
    expect(mid[0].security).toBe("eher sicher");
    const low = ranking([window("2026-09-15T19:00:00+02:00", { p: 0.3 })]);
    expect(low[0].security).toBe("unsicher");
  });

  it("ohne messbares p ehrlich „noch nicht messbar“ — kein erfundenes Wort", () => {
    const list = ranking([window("2026-09-15T19:00:00+02:00", { p: null })]);
    expect(list[0].security).toBe("noch nicht messbar");
  });

  it("A5: ohne kalibriertes Gate bleibt die Sicherheit ungemessen", () => {
    // Befund A5 (23.09.2026): ohne M7-Gate antwortet der Server mit
    // „no_advice“ — eine Zwischenstufe „wird noch gemessen“ gab es nie.
    const list = ranking(
      [window("2026-09-15T19:00:00+02:00", { p: 0.8 })],
      { decide: decide({ calibrated: false }) },
    );
    expect(list[0].security).toBe("noch nicht messbar");
  });
});

describe("Horizont-Ehrlichkeit", () => {
  it("ab Tag 5 trägt der Eintrag den Hinweis — ein Satz, keine Etiketten", () => {
    const list = ranking([
      window("2026-09-18T08:00:00+02:00", { expected_saving_eur: 1.2 }),
    ]);
    expect(list[0].index).toBe(4);
    expect(list[0].uncertain).toBe(true);
    expect(WEEK_UNCERTAIN_FROM_DAY).toBe(4);
    expect(WEEK_UNCERTAIN_NOTE).toBe("Ab Tag 5 wird die Prognose unsicher.");
  });

  it("die ersten vier Tage tragen ihn nicht", () => {
    const list = ranking([
      window("2026-09-17T08:00:00+02:00", { expected_saving_eur: 1.2 }),
    ]);
    expect(list[0].index).toBe(3);
    expect(list[0].uncertain).toBe(false);
  });
});

describe("weekTankLine: Anzeige, keine Behauptung (§4/§6)", () => {
  it("ehrlich ohne Angabe", () => {
    expect(weekTankLine(null, null, 50).text).toBe("Tank: keine Angabe");
    expect(weekTankLine(null, null, 50).detail).toContain(
      "Mit dem Stand prüft die App",
    );
  });

  it("nennt Reichweite statt „reicht bis Do“", () => {
    // Für kommende Fenster gibt es keine Routen-Daten — die App belegt kein
    // Datum, sondern nennt, was der Server wirklich geliefert hat.
    expect(weekTankLine(null, 50, 50).text).toBe("Tank: 50 % · ≈ 50 L Tank");
    expect(weekTankLine(tank(), 50, 50).text).toBe(
      "Tank: 50 % · Restreichweite ≈ 200 km",
    );
    expect(weekTankLine(tank(), 50, 50).detail).toContain("davon Reserve ≈ 190 km");
  });
});

describe("weekEntryWhy: höchstens fünf Zeilen (§4/§7)", () => {
  const entry = ranking(
    [
      window("2026-09-15T19:00:00+02:00", {
        end: "2026-09-15T21:00:00+02:00",
        expected_price: 1.709,
        p: 0.8,
        expected_saving_eur: 2,
      }),
    ],
    { decide: decide() },
  )[0];

  it("nennt Fenster, Abstand und Sicherheit", () => {
    const why = weekEntryWhy(entry, decide(), 1.759, NOW);
    expect(why?.lines.length).toBeLessThanOrEqual(5);
    expect(why?.lines[0]).toContain("19–21 Uhr");
    expect(why?.lines[1]).toContain("5,0 ct/L unter dem aktuellen Preis");
    expect(why?.lines[2]).toContain("ziemlich sicher");
    expect(why?.labHint?.section).toBe("prognose");
    expect(why?.source).toContain("Modell-Lauf");
  });

  it("nennt die Stunden in Berliner Zeit, nicht als Dezimalstunden", () => {
    const sampleNow = Date.parse("2026-10-03T06:00:00+02:00");
    const sampleEntry = ranking(
      [
        window("2026-10-03T05:40:00Z", {
          end: "2026-10-03T05:55:00Z",
          expected_price: 2.269,
        }),
      ],
      { now: sampleNow },
    )[0];
    const why = weekEntryWhy(sampleEntry, decide(), 2.119, sampleNow);
    expect(why?.lines[0]).toContain("07:40–07:55 Uhr");
    expect(why?.lines[0]).not.toMatch(/7\.666666666666667|7\.916666666666667/);
  });

  it("ohne aktuellen Preis steht kein Abstand", () => {
    const why = weekEntryWhy(entry, decide(), null, NOW);
    expect(why?.lines[1]).toContain("Der aktuelle Preis fehlt");
  });

  it("ab Tag 5 steht der eine Satz zur Prognosebreite", () => {
    const late = ranking(
      [window("2026-09-18T08:00:00+02:00", { p: 0.8, expected_saving_eur: 1 })],
      { decide: decide() },
    )[0];
    expect(weekEntryWhy(late, decide(), 1.759, NOW)?.lines.join(" ")).toContain(
      WEEK_UNCERTAIN_NOTE,
    );
  });
});
