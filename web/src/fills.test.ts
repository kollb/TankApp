// Belege: Anzeigezeilen für Liste (ab `sm` Tabelle) und Karte (mobil).
// Der Test hält fest, was „—“ heißt und wie das Vorzeichen gelesen wird.

import { describe, expect, it } from "vitest";
import { fillRow, fillRows, promptFillPrice } from "./fills";
import type { Fill, Station } from "./data";

function fill(overrides: Partial<Fill> = {}): Fill {
  return {
    id: "fill_1",
    station_id: "demo-nord",
    station_name: "Demo-Tank Nord",
    tanked_at: "2026-09-15T16:24:00+02:00",
    liters: 42.1,
    price_paid: 1.725,
    fuel: "e10",
    source: "manual",
    ...overrides,
  };
}

describe("Belegzeilen", () => {
  it("nennt Tankzeit, Station, Menge und Preis in de-DE", () => {
    const row = fillRow(fill());
    expect(row.time).toBe("15.09., 16:24");
    expect(row.station).toBe("Demo-Tank Nord");
    expect(row.volume).toBe("42,1 L · 1,725 €/L");
    expect(row.liters).toBe("42,1");
    expect(row.pricePerLiter).toBe("1,725 €/L");
  });

  it("liest die Ersparnis mit Vorzeichen als Wort", () => {
    expect(fillRow(fill({ saved_vs_always_now_eur: 3.2 })).savings).toBe(
      "3,20 € günstiger",
    );
    expect(fillRow(fill({ saved_vs_always_now_eur: 3.2 })).savingsTone).toBe(
      "good",
    );
    expect(fillRow(fill({ saved_vs_always_now_eur: -1.1 })).savings).toBe(
      "1,10 € teurer",
    );
    expect(fillRow(fill({ saved_vs_always_now_eur: -1.1 })).savingsTone).toBe(
      "bad",
    );
  });

  it("erfindet ohne Vergleichswert keine Null", () => {
    const row = fillRow(fill({ saved_vs_always_now_eur: undefined }));
    expect(row.savings).toBe("—");
    expect(row.savingsTone).toBe("none");
  });

  it("nimmt ohne Stationsnamen die Kennung", () => {
    expect(fillRow(fill({ station_name: "" })).station).toBe("demo-nord");
  });

  it("benennt Storno als Zustand, nicht als Löschung (A3)", () => {
    const row = fillRow(fill({ voided: true }));
    expect(row.status).toBe("storniert");
    expect(row.voided).toBe(true);
    expect(fillRow(fill()).status).toBe("gebucht");
  });

  it("hält die Reihenfolge der Belege", () => {
    const rows = fillRows([fill(), fill({ id: "fill_2" })]);
    expect(rows.map((row) => row.id)).toEqual(["fill_1", "fill_2"]);
  });

  it("kennzeichnet den Prognosepreis als keinen gezahlten Preis (O17)", () => {
    expect(fillRow(fill({ price_source: "prognose" })).priceNote).toBe(
      "Prognosepreis — kein gezahlter Preis",
    );
    expect(fillRow(fill({ price_source: "live" })).priceNote).toBeNull();
    expect(fillRow(fill({ price_source: "manuell" })).priceNote).toBeNull();
    expect(fillRow(fill()).priceNote).toBeNull();
  });
});

describe("Ein-Tipp-Beleg (O17)", () => {
  function station(overrides: Partial<Station> = {}): Station {
    return {
      station_id: "empfohlen",
      city: "Demostadt",
      name: "Empfohlene Station",
      brand: "Marke",
      fuel: "e10",
      maps_url: null,
      price: 1.719,
      last_price: 1.719,
      status: "open",
      fresh: true,
      observed_at: null,
      age_minutes: 2,
      ...overrides,
    };
  }
  const stations = [
    station(),
    station({ station_id: "billig", price: 1.629, last_price: 1.629 }),
  ];
  const priceOf = (row: Station) => row.price;

  it("nimmt den frischen Live-Preis der Beleg-Station", () => {
    expect(promptFillPrice("empfohlen", stations, priceOf)).toBe(1.719);
  });

  it("nimmt den Preis der Beleg-Station, nicht den billigsten des Sets", () => {
    // Der Knopf zeigte früher den Set-Bestpreis — gebucht wurde damit ein
    // fremder Preis. Jetzt gehören Knopf und Buchung zur selben Station.
    expect(promptFillPrice("empfohlen", stations, priceOf)).not.toBe(1.629);
  });

  it("fragt ohne frischen Preis nach, statt zu buchen", () => {
    expect(promptFillPrice("empfohlen", [station({ price: null })], priceOf)).toBeNull();
    expect(promptFillPrice("empfohlen", [station({ price: NaN })], priceOf)).toBeNull();
    expect(promptFillPrice("unbekannt", stations, priceOf)).toBeNull();
    expect(promptFillPrice(null, stations, priceOf)).toBeNull();
    expect(promptFillPrice(undefined, stations, priceOf)).toBeNull();
  });
});
