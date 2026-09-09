import { describe, expect, it } from "vitest";
import {
  autoTimeTicks,
  currentPrice,
  detourEconomics,
  gapBands,
  gapCompressedAxis,
  haversineKm,
  segments,
  splitOnGap,
  type Station,
} from "./data";

const station: Station = {
  station_id: "station",
  city: "Frankfurt",
  name: "Station",
  brand: "",
  fuel: "e10",
  maps_url: null,
  price: 1.7,
  last_price: 1.7,
  status: "open",
  fresh: true,
  age_minutes: 5,
  observed_at: "2026-09-08T10:00:00Z",
};

describe("fresh price guard", () => {
  it("never ranks an offline, closed or expired observation", () => {
    expect(currentPrice(station, true, 0)).toBe(1.7);
    expect(currentPrice(station, false, 0)).toBeNull();
    expect(currentPrice(station, true, 26)).toBeNull();
    expect(currentPrice({ ...station, status: "closed" }, true, 0)).toBeNull();
    expect(currentPrice({ ...station, price: null }, true, 0)).toBeNull();
    expect(currentPrice({ ...station, price: NaN }, true, 0)).toBeNull();
  });
});

describe("observed chart segments", () => {
  it("does not draw lines across closures, but holds the last open price", () => {
    const point = (hour: string, price: number | null, status = "open") => ({
      timestamp: `2026-09-08T${hour}:00Z`,
      price,
      status,
    });
    const result = segments([
      point("10:00", 1.7),
      point("10:05", null, "closed"),
      point("10:10", 1.8),
      point("11:00", 1.6),
    ]);
    expect(result.map((s) => s.pts.map((p) => p.y))).toEqual([
      [1.7],
      [1.8, 1.8, 1.6],
    ]);
  });
  it("never invents an empty price history", () =>
    expect(segments([])).toEqual([]));
});

describe("chart gap bands", () => {
  const minute = 60000;
  it("marks the night window as one band instead of drawing a line", () => {
    // Dichte 5-Minuten-Beobachtungen bis 22:00, dann Nachtlücke bis 06:00.
    const day = Date.parse("2026-09-08T06:00:00Z");
    const pts = Array.from({ length: 193 }, (_, i) => ({
      x: day + i * 5 * minute,
      y: 1.7,
    }));
    const morning = Date.parse("2026-09-09T06:00:00Z");
    pts.push({ x: morning, y: 1.8 });
    expect(gapBands([{ pts }], 30)).toEqual([
      { from: day + 192 * 5 * minute, to: morning },
    ]);
  });
  it("ignores short interruptions and merges duplicate times across series", () => {
    const a = [
      { x: 0, y: 1 },
      { x: 10 * minute, y: 1 },
    ];
    const b = [
      { x: 0, y: 1 },
      { x: 32 * minute, y: 1 },
    ];
    expect(gapBands([{ pts: a }, { pts: b }], 30)).toEqual([]);
  });
  it("returns nothing without points", () => expect(gapBands([], 30)).toEqual([]));
  it("marks window edge gaps only when a fixed window is requested", () => {
    const day = Date.parse("2026-09-08T06:00:00Z");
    // 20 Minuten Abstand: innen keine Lücke, an beiden Fensterrändern schon.
    const pts = [{ x: day + 60 * minute }, { x: day + 80 * minute }];
    const window: [number, number] = [day, day + 24 * 60 * minute];
    expect(gapBands([{ pts }], 30)).toEqual([]);
    expect(gapBands([{ pts }], 30, window)).toEqual([
      { from: day, to: day + 60 * minute },
      { from: day + 80 * minute, to: day + 24 * 60 * minute },
    ]);
  });
});

describe("air distance between stations", () => {
  it("measures Frankfurt–Gütersloh as roughly 200 km", () => {
    const km = haversineKm(50.11, 8.68, 51.9, 8.4);
    expect(km).toBeGreaterThan(195);
    expect(km).toBeLessThan(205);
  });
  it("is zero for identical points and symmetric", () => {
    expect(haversineKm(50.11, 8.68, 50.11, 8.68)).toBe(0);
    expect(haversineKm(50.11, 8.68, 48.14, 11.58)).toBeCloseTo(
      haversineKm(48.14, 11.58, 50.11, 8.68),
    );
  });
});

describe("automatic axis ticks", () => {
  it("covers a 24 h window with at most nine aligned ticks", () => {
    const from = Date.parse("2026-09-09T06:00:00Z");
    const to = from + 24 * 3600 * 1000;
    const ticks = autoTimeTicks(from, to);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(9);
    expect(ticks[0].x).toBeGreaterThanOrEqual(from);
    expect(ticks.at(-1)!.x).toBeLessThanOrEqual(to);
    // Gleichmäßiger, an vollen Stunden/Tagen ausgerichteter Abstand.
    const step = ticks[1].x - ticks[0].x;
    for (let i = 2; i < ticks.length; i++)
      expect(ticks[i].x - ticks[i - 1].x).toBe(step);
    expect(ticks.every((t) => /^\d{2}:\d{2}$/.test(t.label))).toBe(true);
  });
  it("prefixes midnight with the local date", () => {
    // 23:00 Berlin bis 05:00 Berlin am nächsten Morgen, Schritt 60 min.
    const from = Date.parse("2026-09-09T21:00:00Z");
    const to = from + 8 * 3600 * 1000;
    const ticks = autoTimeTicks(from, to);
    const midnight = ticks.find((t) => t.x === Date.parse("2026-09-09T22:00:00Z"));
    expect(midnight?.label).toBe("10.09. 00:00");
  });
  it("returns nothing for invalid windows", () => {
    expect(autoTimeTicks(10, 5)).toEqual([]);
    expect(autoTimeTicks(NaN, 5)).toEqual([]);
  });
});

describe("detour economics", () => {
  const base = {
    refPrice: 2.12,
    altPrice: 2.04,
    liters: 40,
    km: 20,
    consumption: 7,
    speedKmh: 45,
    timeValueEurH: 12,
  };
  it("splits the gross saving into fuel and time costs", () => {
    const r = detourEconomics({ ...base, mode: "onroute" });
    expect(r.grossEur).toBeCloseTo(3.2, 10);
    expect(r.fuelEur).toBeCloseTo(2.856, 10);
    expect(r.timeEur).toBeCloseTo(16 / 3, 9);
    expect(r.netEur).toBeCloseTo(3.2 - 2.856 - 16 / 3, 9);
    expect(r.verdict).toBe("not_worth");
    // Preisvorteil müsste 20,47 ct/L betragen, um den Umweg zu refinanzieren.
    expect(r.criticalCtPerL).toBeCloseTo(20.47, 1);
  });
  it("counts a dedicated trip both ways", () => {
    const onroute = detourEconomics({ ...base, mode: "onroute" });
    const dedicated = detourEconomics({ ...base, mode: "dedicated" });
    expect(dedicated.fuelEur).toBeCloseTo(onroute.fuelEur * 2, 10);
    expect(dedicated.timeEur).toBeCloseTo(onroute.timeEur * 2, 10);
    expect(dedicated.km).toBe(onroute.km);
  });
  it("flags clearly profitable detours and borderline ones", () => {
    expect(
      detourEconomics({
        refPrice: 2.12,
        altPrice: 2.0,
        liters: 50,
        km: 5,
        mode: "onroute",
        consumption: 7,
        speedKmh: 45,
        timeValueEurH: 12,
      }).verdict,
    ).toBe("worth");
    expect(
      detourEconomics({
        refPrice: 2.12,
        altPrice: 2.06,
        liters: 40,
        km: 8,
        mode: "onroute",
        consumption: 5,
        speedKmh: 45,
        timeValueEurH: 5,
      }).verdict,
    ).toBe("borderline");
  });
});
