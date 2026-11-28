import { describe, expect, it } from "vitest";
import type { Station } from "../../api/types";
import { referenceStationId } from "./logic";

function station(id: string, price: number | null, fresh: boolean): Station {
  return {
    station_id: id,
    city: "Frankfurt",
    name: id,
    price,
    fresh,
    observed_at: null,
  };
}

describe("Stations-Referenz", () => {
  const rows = [
    station("selected-fresh", 1.82, true),
    station("pinned-fresh", 1.79, true),
    station("cheapest-fresh", 1.65, true),
    station("stale-cheapest", 1.50, false),
    station("missing", null, true),
    station("invalid", Number.NaN, true),
  ];

  it("behält eine gültige Auswahl vor einem günstigeren Preis", () => {
    expect(referenceStationId(rows, "selected-fresh", "pinned-fresh")).toBe("selected-fresh");
  });

  it("fällt bei veralteter Auswahl auf eine frische angeheftete Station zurück", () => {
    expect(referenceStationId(rows, "stale-cheapest", "pinned-fresh")).toBe("pinned-fresh");
  });

  it("wählt sonst den günstigsten endlichen frischen Preis, nie den alten oder fehlenden", () => {
    expect(referenceStationId(rows, "stale-cheapest", "missing")).toBe("cheapest-fresh");
  });

  it("meldet keine Referenz, wenn nur fehlende oder veraltete Preise vorliegen", () => {
    expect(referenceStationId([station("old", 1.3, false), station("none", null, true)], "", "")).toBe("");
  });
});
