// Woche: der Zeit-Planer (UI-NEUENTWURF §5.3) — die reine Logik.
//
// Getestet werden die drei Ehrlichkeits-Grenzen des Wochenrasters:
//   * Sterne nur aus Server-p (ohne p: null Sterne, nicht erfundene).
//   * Fenster nur aus decide.windows_week (Tage ohne Fenster bleiben leer).
//   * Tank-Prüfung nur für heute (kommende Tage: Reichweite, kein „reicht
//     bis Do“); Prozent nur auf Stufe A.

import { describe, expect, it } from "vitest";
import type { DecideResult, TankInfo } from "./data";
import { wordFromPercent } from "./now";
import {
  tankReach,
  weekDays,
  weekExplanation,
  weekLine,
  weekTankLine,
  weekWindowList,
  weekWindowSummary,
  windowStars,
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

function decide(
  overrides: Partial<DecideResult> = {},
): DecideResult {
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

describe("windowStars", () => {
  it("verwandelt p in drei, zwei oder ein Stern — Stufen der Ampel-Karte", () => {
    expect(windowStars(0.8)).toBe(3);
    expect(windowStars(0.75)).toBe(3);
    expect(windowStars(0.7)).toBe(2);
    expect(windowStars(0.55)).toBe(2);
    expect(windowStars(0.5)).toBe(1);
    expect(windowStars(0.35)).toBe(1);
    expect(windowStars(0.3)).toBe(0);
  });

  it("ohne Server-p stehen ehrlich null Sterne", () => {
    expect(windowStars(null)).toBe(0);
    expect(windowStars(undefined)).toBe(0);
    expect(windowStars(Number.NaN)).toBe(0);
  });

  it("Stern- und Wortklassen unterscheiden sich nur unter 55 %", () => {
    // Befund §6 des Prüfberichts (PR #121): Sterne (75/55/35) und Worte
    // (75/55) sind absichtlich nicht deckungsgleich — unter 55 % heißt beides
    // „unsicher“, und der 35-%-Schnitt trennt nur die Sterne. Der Test hält
    // den Vertrag fest, damit der Kommentar in week.ts nicht wieder driftet.
    expect(wordFromPercent(75)).toBe("ziemlich sicher");
    expect(wordFromPercent(55)).toBe("eher sicher");
    expect(wordFromPercent(50)).toBe("unsicher");
    expect(wordFromPercent(34)).toBe("unsicher");
    expect(windowStars(0.75)).toBe(3);
    expect(windowStars(0.55)).toBe(2);
    expect(windowStars(0.5)).toBe(1);
    expect(windowStars(0.34)).toBe(0);
  });
});

describe("weekDays", () => {
  const windows = [
    // Dienstag, 19–21 Uhr Berlin.
    window("2026-09-15T19:00:00+02:00", {
      end: "2026-09-15T21:00:00+02:00",
      expected_price: 1.72,
      p: 0.8,
      expected_saving_eur: 1.4,
    }),
    // Dasselbe Fenster, günstigerer Nachbar — beide Dienstag, günstiger
    // erwartet → der günstigere gewinnt den Tag.
    window("2026-09-15T19:30:00+02:00", {
      end: "2026-09-15T20:30:00+02:00",
      expected_price: 1.7,
      p: 0.6,
      expected_saving_eur: 1.6,
    }),
    // Freitag, 8–10 Uhr (Index 4 → „noch unsicher“).
    window("2026-09-18T08:00:00+02:00", {
      end: "2026-09-18T10:00:00+02:00",
      expected_price: 1.68,
      p: null,
      expected_saving_eur: null,
    }),
  ];

  it("legt heute bis +6 als Berliner Kalendertage an", () => {
    const days = weekDays(windows, NOW);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({
      shortDay: "Mo",
      date: "14.09.",
      isToday: true,
    });
    expect(days[1].shortDay).toBe("Di");
    expect(days[6].date).toBe("20.09.");
    // Horizont-Ehrlichkeit: Tage 5–7 (Index 4–6).
    expect(days.filter((day) => day.uncertain).map((day) => day.index)).toEqual([
      4,
      5,
      6,
    ]);
  });

  it("gibt je Tag das günstigste Fenster (niedrigster Erwartungs-Preis)", () => {
    const days = weekDays(windows, NOW);
    expect(days[0].window).toBeNull();
    expect(days[1].window?.expected_price).toBe(1.7); // der günstigere
    expect(days[1].stars).toBe(2); // p 0.6 → zwei Sterne
    expect(days[4].window?.expected_price).toBe(1.68);
    expect(days[4].stars).toBe(0); // p null → null Sterne
    expect(days[5].window).toBeNull();
  });

  it("ohne Server-Fenster bleibt die Woche leer (keine Erfindung)", () => {
    const days = weekDays(null, NOW);
    expect(days.every((day) => day.window === null)).toBe(true);
    expect(days.every((day) => day.stars === 0)).toBe(true);
  });
});

describe("weekWindowList", () => {
  it("sortiert nach Ersparnis absteigend, Unbekannt nach hinten", () => {
    const days = weekDays(
      [
        window("2026-09-14T19:00:00+02:00", { expected_saving_eur: 0.5 }),
        window("2026-09-15T19:00:00+02:00", { expected_saving_eur: 2.1 }),
        window("2026-09-16T19:00:00+02:00", { expected_saving_eur: null }),
      ],
      NOW,
    );
    const list = weekWindowList(days);
    expect(list.map((entry) => entry.savingEur)).toEqual([2.1, 0.5, null]);
  });
});

describe("tankReach", () => {
  const todayWindow = window("2026-09-14T19:00:00+02:00");

  it("ohne Tankstand prüft die App nur heute (und sagt es)", () => {
    expect(
      tankReach(null, 0, todayWindow)?.text,
    ).toContain("Tankstand nicht angegeben");
    expect(tankReach(null, 2, todayWindow)).toBeNull();
  });

  it("leerer Tank ist der bad-Fall — egal an welchem Tag", () => {
    const result = tankReach(tank({ state: "empty" }), 2, null);
    expect(result?.tone).toBe("bad");
    expect(result?.text).toContain("Tank leer");
  });

  it("heute: Server-Prüfung blocks_wait (Physik schlägt Statistik)", () => {
    expect(tankReach(tank({ blocks_wait: true }), 0, todayWindow)?.tone).toBe(
      "bad",
    );
    expect(tankReach(tank({ blocks_wait: false }), 0, todayWindow)?.text).toBe(
      "Reicht bis zum Fenster — Restreichweite ≈ 200 km.",
    );
  });

  it("kommende Tage: Reichweite statt „reicht bis Do“", () => {
    expect(tankReach(tank({ state: "low" }), 3, null)?.tone).toBe("warn");
    const neutral = tankReach(tank(), 3, null);
    expect(neutral?.tone).toBe("neutral");
    expect(neutral?.text).toContain("hängt von der Strecke ab");
  });
});

describe("weekWindowSummary", () => {
  const day = weekDays(
    [
      window("2026-09-15T19:00:00+02:00", {
        end: "2026-09-15T21:00:00+02:00",
        expected_price: 1.709,
        p: 0.8,
        expected_saving_eur: 2,
      }),
    ],
    NOW,
  )[1];

  it("liefert null ohne Fenster", () => {
    const empty = weekDays([], NOW)[0];
    expect(weekWindowSummary(empty, decide(), 1.759)).toBeNull();
  });

  it("Stufe A: Sicherheit in Worten mit Prozent", () => {
    // now = NOW (14.09.) explizit: „Morgen“ hängt am Referenzzeitpunkt,
    // nicht an der realen Uhr im Moment des Tests.
    const summary = weekWindowSummary(day, decide(), 1.759, NOW);
    // 15.09. bei „heute“ am 14.09. → dayLabel: „Morgen“.
    expect(summary?.headline).toContain("Morgen");
    expect(summary?.headline).toContain("19–21 Uhr");
    expect(summary?.savingLine).toContain("5,0 ct/L günstiger erwartet");
    expect(summary?.savingLine).toContain("2,00 €");
    expect(summary?.security).toBe("ziemlich sicher (80 %)");
  });

  it("Stufe B: Wort ohne Prozent, mit dem M7-Ansatz", () => {
    const summary = weekWindowSummary(day, decide({ calibrated: false }), 1.759);
    expect(summary?.security).toBe(
      "wird noch gemessen — Prozent ab 100 Empfehlungen",
    );
  });

  it("Stufe C (kein primary): noch nicht messbar", () => {
    const summary = weekWindowSummary(
      day,
      { error_code: "polling_missing" } as unknown as DecideResult,
      1.759,
    );
    expect(summary?.security).toBe("noch nicht messbar");
  });

  it("ohne aktuellen Preis steht kein Abstand", () => {
    const summary = weekWindowSummary(day, decide(), null);
    expect(summary?.savingLine).toBeNull();
  });
});

describe("weekExplanation", () => {
  const day = weekDays(
    [
      window("2026-09-18T08:00:00+02:00", {
        end: "2026-09-18T10:00:00+02:00",
        expected_price: 1.689,
        p: null,
        expected_saving_eur: null,
      }),
    ],
    NOW,
  )[4];

  it("max. drei Sätze, mit Hinweis auf die breitere Prognose", () => {
    const result = weekExplanation(day, decide(), 1.759, NOW);
    expect(result).not.toBeNull();
    expect(result!.sentences.length).toBeLessThanOrEqual(3);
    expect(result!.sentences.join(" ")).toContain("noch unsicher");
  });

  it("ohne Fenster: null", () => {
    const empty = weekDays([], NOW)[0];
    expect(weekExplanation(empty, decide(), 1.759, NOW)).toBeNull();
  });
});

describe("weekLine / weekTankLine", () => {
  it("weekLine: bester Erwartungs-Preis je Tag, null ohne Fenster", () => {
    const days = weekDays(
      [window("2026-09-15T19:00:00+02:00", { expected_price: 1.7 })],
      NOW,
    );
    const line = weekLine(days);
    expect(line).toHaveLength(7);
    expect(line[0].value).toBeNull();
    expect(line[1]).toEqual({ label: "Di", value: 1.7 });
  });

  it("weekTankLine: ehrlich ohne Angabe", () => {
    expect(weekTankLine(null, null, 50).text).toBe("Tankstand nicht angegeben");
    expect(weekTankLine(null, 50, 50).text).toBe(
      "Tank: 50 % · ≈ 50 L Tank",
    );
    expect(weekTankLine(tank(), 50, 50).text).toBe(
      "Tank: 50 % · Restreichweite ≈ 200 km",
    );
    expect(weekTankLine(tank(), 50, 50).detail).toContain(
      "inkl. Reserve ≈ 190 km",
    );
  });
});
