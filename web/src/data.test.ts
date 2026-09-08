import { describe, expect, it } from "vitest";
import { currentPrice, segments, type Station } from "./data";

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
  it("does not draw lines across closures or long outages", () => {
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
    expect(result.map((s) => s.pts.length)).toEqual([1, 1, 1]);
  });
  it("never invents an empty price history", () =>
    expect(segments([])).toEqual([]));
});
