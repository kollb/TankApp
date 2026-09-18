// Belege: Anzeigezeilen für Liste (ab `sm` Tabelle) und Karte (mobil).
// Der Test hält fest, was „—“ heißt und wie das Vorzeichen gelesen wird.

import { describe, expect, it } from "vitest";
import { fillPriceHint, fillRow, fillRows, promptFillPrice } from "./fills";
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

// O32 — Die Belegmaske zeigt den Live-Preis.
//
// Befund: Das Feld wurde aus dem Snapshot vorbefüllt, der Nutzer sah eine
// Zahl, die alt sein konnte, ohne Vergleich. Der Test hält fest, was die
// Maske sagt — und was sie ohne Deckung verschweigt.
describe("O32: Live-Preis neben dem Preisfeld", () => {
  function station(overrides: Partial<Station> = {}): Station {
    return {
      station_id: "empfohlen",
      city: "Frankfurt",
      name: "Demo-Tank Nord",
      brand: "Demo",
      fuel: "e10",
      maps_url: null,
      price: 1.719,
      last_price: 1.719,
      status: "open",
      fresh: true,
      observed_at: "2026-09-18T18:57:00+02:00",
      age_minutes: 3,
      ...overrides,
    };
  }
  // 19:00 Berliner Zeit — drei Minuten nach der Meldung oben.
  const now = Date.parse("2026-09-18T19:00:00+02:00");

  it("nennt Preis und Alter der Meldung", () => {
    const hint = fillPriceHint({
      station: station(),
      livePrice: 1.719,
      typed: "1,719",
      now,
    });
    expect(hint?.price).toBe("1,719 €/L");
    expect(hint?.age).toBe("vor 3 Minuten");
    expect(hint?.text).toBe("Jetzt an der Station: 1,719 €/L, gemeldet vor 3 Minuten.");
  });

  it("markiert eine Abweichung über der Schwelle mit Richtung", () => {
    const hint = fillPriceHint({
      station: station(),
      livePrice: 1.719,
      typed: "1,749",
      now,
    });
    expect(hint?.drifted).toBe(true);
    expect(hint?.driftCt).toBeCloseTo(3.0, 6);
    expect(hint?.driftText).toContain("3,0 ct/L über dem gemeldeten Preis");
    // Gebucht wird, was getippt wurde — die Maske korrigiert nichts.
    expect(hint?.driftText).toContain("gebucht wird, was du eingibst");
  });

  it("schweigt unterhalb der Schwelle", () => {
    const hint = fillPriceHint({
      station: station(),
      livePrice: 1.719,
      typed: "1,725",
      now,
    });
    expect(hint?.drifted).toBe(false);
    expect(hint?.driftText).toBeNull();
  });

  it("erkennt die Abweichung auch nach unten", () => {
    const hint = fillPriceHint({
      station: station(),
      livePrice: 1.719,
      typed: "1,659",
      now,
    });
    expect(hint?.driftText).toContain("6,0 ct/L unter dem gemeldeten Preis");
  });

  it("fällt auf age_minutes zurück, wenn der Zeitstempel fehlt", () => {
    const hint = fillPriceHint({
      station: station({ observed_at: null, age_minutes: 90 }),
      livePrice: 1.719,
      typed: "",
      now,
    });
    expect(hint?.age).toBe("vor 2 Stunden");
  });

  it("nennt ohne jedes Alter nur den Preis, statt eines zu erfinden", () => {
    const hint = fillPriceHint({
      station: station({ observed_at: null, age_minutes: null }),
      livePrice: 1.719,
      typed: "",
      now,
    });
    expect(hint?.age).toBeNull();
    expect(hint?.text).toBe("Jetzt an der Station: 1,719 €/L.");
  });

  it("schweigt ganz ohne frischen Preis und ohne Station", () => {
    expect(
      fillPriceHint({ station: station(), livePrice: null, typed: "1,7", now }),
    ).toBeNull();
    expect(
      fillPriceHint({ station: null, livePrice: 1.7, typed: "1,7", now }),
    ).toBeNull();
    expect(
      fillPriceHint({ station: station(), livePrice: NaN, typed: "", now }),
    ).toBeNull();
  });

  it("vergleicht nichts, solange das Feld keine Zahl trägt", () => {
    const hint = fillPriceHint({
      station: station(),
      livePrice: 1.719,
      typed: "",
      now,
    });
    expect(hint?.driftCt).toBeNull();
    expect(hint?.drifted).toBe(false);
  });
});
