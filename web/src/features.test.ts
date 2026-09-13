// A1/A2/A4/C2: reine Funktionen der neuen Features — Tankstand-Rechnung,
// Pin-Liste, Stationsordnung, Bilanz-Labels und Profil-Sync. Die Panel
// zeigen ausschließlich Server-Zahlen (/decide → tank, /fills/summary);
// diese Helfer sind die Vorschau am Slider, die Listenordnung und die
// Formulierungen — genau dort, wo ein Fehler still wäre.

import { describe, expect, it } from "vitest";
import {
  PINNED_MAX,
  kilometersLabel,
  monthBalanceLabel,
  orderedStationList,
  profileErrorText,
  profileFields,
  profileFieldsDiffer,
  tankPreviewLine,
  tankRangeKm,
  togglePinnedStation,
  type Station,
} from "./data";

function station(
  id: string,
  overrides: Partial<Station> = {},
): Station {
  return {
    station_id: id,
    city: "Frankfurt",
    name: `Station ${id}`,
    brand: "",
    fuel: "e10",
    maps_url: null,
    dist_km: null,
    dist_mode: null,
    price: null,
    last_price: null,
    status: "open",
    fresh: true,
    observed_at: "2026-09-12T08:00:00+02:00",
    age_minutes: 5,
    ...overrides,
  };
}

describe("A2: Tankstand-Rechnung (Vorschau am Slider)", () => {
  it("übersetzt Füllstand × Tankgröße ÷ Verbrauch in Kilometer", () => {
    // 50 l × 25 % = 12,5 l bei 7 l/100 km → ~178,6 km.
    expect(tankRangeKm(25, 50, 7)).toBeCloseTo(178.57, 1);
    expect(tankRangeKm(0, 50, 7)).toBe(0);
    expect(tankRangeKm(100, 50, 7)).toBeCloseTo(714.29, 1);
  });

  it("lehnt unsinnige Eingaben ab statt sie zu runden", () => {
    expect(tankRangeKm(null, 50, 7)).toBeNull();
    expect(tankRangeKm(150, 50, 7)).toBeNull();
    expect(tankRangeKm(25, 0, 7)).toBeNull();
    expect(tankRangeKm(25, 50, 0)).toBeNull();
  });

  it("formuliert die Vorschau mit Reserve-Angabe, deutsch formatiert", () => {
    const line = tankPreviewLine(25, 50, 7);
    expect(line).toContain("≈");
    expect(line).toContain("179 km");
    expect(line).toContain("71 km");
    expect(kilometersLabel(1234.4)).toBe("1.234 km");
    expect(kilometersLabel(null)).toBe("—");
  });
});

describe("C2: Stamm-Stationen pinnen", () => {
  it("pinnt und löst dedupliziert", () => {
    const first = togglePinnedStation([], "a");
    expect(first).toEqual({ ids: ["a"], note: null });
    expect(togglePinnedStation(["a"], "a").ids).toEqual([]);
    // Doppelt gepinnt (alter Speicherstand) → Lösen räumt beide Einträge weg.
    expect(togglePinnedStation(["a", "a"], "a").ids).toEqual([]);
  });

  it("kappt bei der Obergrenze mit ehrlichem Hinweis", () => {
    const full = Array.from({ length: PINNED_MAX }, (_, i) => `s${i}`);
    const result = togglePinnedStation(full, "neu");
    expect(result.ids).toEqual(full);
    expect(result.note).toContain(`Maximal ${PINNED_MAX}`);
  });
});

describe("C2: Suche, Filter, Sortierung", () => {
  const priceOf = (row: Station) => row.price;
  const rows: Station[] = [
    station("shell", { name: "Shell West", brand: "SHELL", price: 1.749, dist_km: 3.2 }),
    station("aral", { name: "Aral Mitte", brand: "ARAL", price: 1.689, dist_km: 1.1 }),
    station("frei", { name: "Freie Tankstelle Nord", brand: "", price: 1.799, dist_km: 0.4 }),
    station("esso", { name: "Esso Süd", brand: "ESSO", price: null, dist_km: 2.0 }),
  ];

  it("stellt Stamm-Stationen immer nach vorn — in Pin-Reihenfolge", () => {
    const ordered = orderedStationList(rows, ["esso", "shell"], "price", priceOf);
    expect(ordered.map((row) => row.station_id)).toEqual([
      "esso",
      "shell",
      "aral",
      "frei",
    ]);
  });

  it("sortiert nach Preis, Distanz und Netto-€ (Preis × Tankmenge)", () => {
    const byPrice = orderedStationList(rows, [], "price", priceOf);
    expect(byPrice.map((row) => row.station_id)).toEqual([
      "aral",
      "shell",
      "frei",
      "esso",
    ]);
    const byDistance = orderedStationList(rows, [], "distance", priceOf);
    expect(byDistance.map((row) => row.station_id)).toEqual([
      "frei",
      "aral",
      "esso",
      "shell",
    ]);
    // Netto-€ für dieselbe Tankmenge = Preis-Reihenfolge; Stationen ohne
    // Preis rutschen ans Ende, statt die Sortierung zu sprengen.
    const byFill = orderedStationList(rows, [], "fill", priceOf);
    expect(byFill.map((row) => row.station_id)).toEqual([
      "aral",
      "shell",
      "frei",
      "esso",
    ]);
  });

  it("filtert nach Suchtext und Marke", () => {
    const found = orderedStationList(rows, [], "price", priceOf, "west");
    expect(found.map((row) => row.station_id)).toEqual(["shell"]);
    const brand = orderedStationList(rows, [], "price", priceOf, "", "ARAL");
    expect(brand.map((row) => row.station_id)).toEqual(["aral"]);
    const nothing = orderedStationList(rows, [], "price", priceOf, "gibt es nicht");
    expect(nothing).toEqual([]);
    // Pin auf einer gefilterten Station erscheint trotzdem nicht im Filter.
    const pinnedButFiltered = orderedStationList(
      rows,
      ["esso"],
      "price",
      priceOf,
      "",
      "ARAL",
    );
    expect(pinnedButFiltered.map((row) => row.station_id)).toEqual(["aral"]);
  });
});

describe("A4: Bilanz-Labels", () => {
  it("übersetzt Monats-Schlüssel in deutsche Labels", () => {
    expect(monthBalanceLabel("2026-09")).toBe("September 2026");
    expect(monthBalanceLabel("2025-01")).toBe("Januar 2025");
    expect(monthBalanceLabel("kaputt")).toBe("kaputt");
  });
});

describe("A1: Profil-Sync-Helfer", () => {
  it("bildet GUI-Werte auf Profil-Felder ab und vergleicht sie", () => {
    const prefs = profileFields({
      fuel: "e10",
      liters: 40,
      consumption: 7,
      timeValue: 0,
      speed: 45,
      detourMode: "onroute",
      tankCapacity: 50,
    });
    expect(prefs).toEqual({
      fuel: "e10",
      liters: 40,
      consumption: 7,
      time_value_eur_h: 0,
      speed_kmh: 45,
      detour_mode: "onroute",
      tank_capacity_l: 50,
    });
    expect(profileFieldsDiffer(prefs, { ...prefs })).toBe(false);
    expect(profileFieldsDiffer(prefs, { ...prefs, consumption: 6.5 })).toBe(true);
  });

  it("übersetzt Fehlercodes in Klartext", () => {
    expect(profileErrorText("profile_limit")).toContain("Höchstens 8");
    expect(profileErrorText("request_failed")).toContain("nur auf diesem Gerät");
    expect(profileErrorText(null)).toBe("");
  });
});
