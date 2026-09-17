// Stationen: der Preis-Atlas (UI-NEUENTWURF §5.2) — die reine Logik.
//
// Getestet werden die zwei Ehrlichkeits-Regeln des Atlas:
//   * Referenz statt Rangliste — jede €-Zahl steht im Vergleich zu einer
//     sichtbaren Referenz (gewählt → gepinnt → nächste frische).
//   * Server-Netto wo vorhanden, sonst Preisdiff × Tankmenge mit dem
//     Label „ohne Umweg“ — nie eine client-seitige Strecke.

import { describe, expect, it } from "vitest";
import type { DecideResult, Station } from "./data";
import {
  atlasEur,
  atlasMatchesFilter,
  atlasRows,
  compareStationsPair,
  dayRhythmLine,
  referenceStation,
  sortAtlasRows,
  stationContextLines,
  stationsFreshness,
  type AtlasRow,
} from "./stations";

type ServerAlt = DecideResult["alternatives_nearby"][number];

function serverAlt(overrides: Partial<ServerAlt>): ServerAlt {
  return {
    station_id: "a",
    name: "A-Station",
    brand: "Test",
    price: 1.759,
    delta_ct: 7,
    detour_km: 1.2,
    detour_km_est: 1.2,
    dist_mode: "haversine",
    detour_mode: "haversine",
    trip_mode: "onroute",
    gross_eur: 2.8,
    fuel_cost_eur: 0.2,
    time_cost_eur: 0.3,
    detour_cost_eur: 0.5,
    net_eur: 2.3,
    critical_delta_ct: 1.2,
    worth_it: true,
    verdict: "worth",
    p_lohnt: 0.8,
    ...overrides,
  };
}

const NOW = Date.parse("2026-09-14T12:00:00+02:00");
const stamp = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60000).toISOString();

function station(
  id: string,
  overrides: Partial<Station> = {},
): Station {
  return {
    station_id: id,
    city: "Frankfurt",
    name: `Station ${id.toUpperCase()}`,
    brand: "Test",
    fuel: "e10",
    maps_url: null,
    dist_km: null,
    dist_mode: null,
    lat: null,
    lon: null,
    price: null,
    last_price: null,
    status: "open",
    fresh: true,
    observed_at: stamp(4),
    age_minutes: 4,
    ...overrides,
  };
}

const A = station("a", { name: "A-Station", price: 1.759, dist_km: 2.5 });
const B = station("b", { name: "B-Station", price: 1.689, dist_km: 1.2 });
const C = station("c", {
  name: "C-Station",
  price: null,
  fresh: false,
  observed_at: null,
  age_minutes: null,
  dist_km: 0.5,
  dist_mode: "air",
});

const priceOf = (row: Station) => (row.fresh ? row.price : null);

function rows(
  overrides: Partial<Parameters<typeof atlasRows>[0]> = {},
): AtlasRow[] {
  return atlasRows({
    stations: [A, B, C],
    priceOf,
    liters: 40,
    selectedId: "",
    pinnedIds: [],
    serverAlts: [],
    worthThreshold: null,
    borderlineThreshold: null,
    ...overrides,
  });
}

describe("referenceStation", () => {
  it("gewählte Station mit Preis schlägt alles", () => {
    const ref = referenceStation([A, B, C], priceOf, "a", ["b"]);
    expect(ref?.reason).toBe("selected");
    expect(ref?.station.station_id).toBe("a");
  });

  it("gewählte Station ohne Preis fällt auf die Stamm-Station zurück", () => {
    const ref = referenceStation([A, B, C], priceOf, "c", ["b"]);
    expect(ref?.reason).toBe("pinned");
    expect(ref?.station.station_id).toBe("b");
  });

  it("sonst die nächste mit frischem Preis", () => {
    const ref = referenceStation([A, B, C], priceOf, "", []);
    expect(ref?.reason).toBe("nearest");
    expect(ref?.station.station_id).toBe("b"); // 1,2 km < 2,5 km
  });

  it("ohne jede frische Station: null — kein erfundener Bezugspunkt", () => {
    expect(referenceStation([C], priceOf, "", [])).toBeNull();
  });
});

describe("atlasRows", () => {
  it("setzt die Referenz und rechnet Rang unter den frischen", () => {
    const rs = rows();
    const b = rs.find((row) => row.station.station_id === "b")!;
    const a = rs.find((row) => row.station.station_id === "a")!;
    const c = rs.find((row) => row.station.station_id === "c")!;
    expect(b.isReference).toBe(true);
    expect(b.rank).toBe(1); // 1,689 günstigste
    expect(a.rank).toBe(2);
    expect(c.rank).toBeNull();
    expect(rs.every((row) => row.freshCount === 2)).toBe(true);
  });

  it("Fill-€ = Preisdiff zur Referenz × Tankmenge (Referenz: 0)", () => {
    const rs = rows();
    const a = rs.find((row) => row.station.station_id === "a")!;
    const b = rs.find((row) => row.station.station_id === "b")!;
    expect(b.fillEur).toBe(0);
    expect(a.fillEur).toBeCloseTo((1.759 - 1.689) * 40, 6); // +2,80 €
    expect(
      rs.find((row) => row.station.station_id === "c")!.fillEur,
    ).toBeNull(); // kein Preis → keine Rechnung
  });

  it("Server-Netto gilt nur gegen die aktuelle Referenz", () => {
    const serverAlts = [serverAlt({})];
    // Referenz = B → A trägt das Server-Netto gegen B.
    const withB = rows({ serverAlts, selectedId: "b" });
    const a = withB.find((row) => row.station.station_id === "a")!;
    expect(a.netEur).toBe(2.3);
    expect(a.detourKm).toBe(1.2);
    expect(a.verdict).toBe("worth");
    // Referenz = A → das Alt beschreibt A gegen sich selbst: kein Netto.
    const withA = rows({ serverAlts, selectedId: "a" });
    expect(
      withA.find((row) => row.station.station_id === "a")!.netEur,
    ).toBeNull();
  });

  it("verwendet die Schwellen für das Urteil, wenn der Server sie liefert", () => {
    const serverAlts = [
      serverAlt({ net_eur: 0.3, worth_it: false, verdict: "not_worth", p_lohnt: 0.2 }),
    ];
    const rs = rows({
      serverAlts,
      selectedId: "b",
      worthThreshold: 1.5,
      borderlineThreshold: 0.5,
    });
    const a = rs.find((row) => row.station.station_id === "a")!;
    // netEur 0,3 < borderline 0,5 → „not_worth“ trotz Server-Urteilsfeld.
    expect(a.verdict).toBe("not_worth");
  });

  it("übernimmt das Server-Alter nur bei vorhandener Meldung", () => {
    const rs = rows();
    expect(
      rs.find((row) => row.station.station_id === "a")!.ageMinutes,
    ).toBe(4);
    expect(
      rs.find((row) => row.station.station_id === "c")!.ageMinutes,
    ).toBeNull();
  });
});

describe("sortAtlasRows", () => {
  it("Netto-€: Server-Zahl, sonst Fill-€; Unbekannt nach hinten", () => {
    const ordered = sortAtlasRows(rows(), "net");
    expect(ordered.map((row) => row.station.station_id)).toEqual([
      "b", // Referenz: 0 €
      "a", // +2,80 € (teurer)
      "c", // unbekannt — nie mit 0 verkleidet
    ]);
  });

  it("Preis: frische aufsteigend, ohne Preis nach hinten", () => {
    const ordered = sortAtlasRows(rows(), "price");
    expect(ordered.map((row) => row.station.station_id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("Entfernung: kürzeste zuerst, Unbekannt nach hinten", () => {
    const ordered = sortAtlasRows(rows(), "distance");
    expect(ordered.map((row) => row.station.station_id)).toEqual([
      "c", // 0,5 km (obwohl ohne Preis)
      "b",
      "a",
    ]);
  });
});

describe("atlasMatchesFilter", () => {
  const visible = (
    filter: { query: string; brand: string; openOnly: boolean },
    all = rows(),
  ) =>
    all
      .filter((row) => atlasMatchesFilter(row, filter))
      .map((row) => row.station.station_id);

  it("leerer Filter lässt alles stehen", () => {
    expect(visible({ query: "", brand: "", openOnly: false })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("M1: „nur offene“ versteckt Stationen ohne frischen Preis", () => {
    // C hat keinen frischen Preis — die ehrliche „—“-Zeile, kein Fehler.
    expect(visible({ query: "", brand: "", openOnly: true })).toEqual([
      "a",
      "b",
    ]);
  });

  it("Suche trifft Name und Marke, unabhängig von Groß-/Kleinschreibung", () => {
    expect(
      visible({ query: "  b-station ", brand: "", openOnly: false }),
    ).toEqual(["b"]);
    expect(visible({ query: "TEST", brand: "", openOnly: false })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("Marke filtert exakt, nicht ähnlich", () => {
    const mitJet = rows({
      stations: [
        A,
        station("d", { name: "D-Station", price: 1.699, brand: "Jet" }),
      ],
    });
    expect(
      visible({ query: "", brand: "Jet", openOnly: false }, mitJet),
    ).toEqual(["d"]);
    // „J“ als Marke trifft nichts — exakter Vergleich, kein Prefix.
    expect(visible({ query: "", brand: "J", openOnly: false }, mitJet)).toEqual(
      [],
    );
  });

  it("die drei Regeln greifen zusammen", () => {
    const mitJet = rows({
      stations: [
        A,
        station("d", { name: "D-Station", price: 1.699, brand: "Jet" }),
        C,
      ],
    });
    expect(
      visible({ query: "station", brand: "Jet", openOnly: true }, mitJet),
    ).toEqual(["d"]);
    // C fällt am fehlenden Preis durch, A an der Marke.
    expect(
      visible({ query: "D-Station", brand: "Test", openOnly: true }, mitJet),
    ).toEqual([]);
  });
});

describe("atlasEur", () => {
  it("Referenz zeigt keine €-Zahl (man misst sich nicht an sich)", () => {
    expect(atlasEur({ netEur: null, fillEur: 0, isReference: true })).toBeNull();
  });

  it("formatiert Richtung, Betrag und Ton", () => {
    const save = atlasEur({ netEur: -2.3, fillEur: null, isReference: false });
    expect(save?.text).toBe("−2,30 €");
    expect(save?.tone).toBe("save");
    const cost = atlasEur({ netEur: null, fillEur: 2.8, isReference: false });
    expect(cost?.text).toBe("+2,80 €");
    expect(cost?.tone).toBe("cost");
    const flat = atlasEur({ netEur: 0, fillEur: null, isReference: false });
    expect(flat?.tone).toBe("neutral");
    expect(atlasEur({ netEur: null, fillEur: null, isReference: false })).toBeNull();
  });
});

describe("stationContextLines", () => {
  it("benennt Rang, Abstand zur Referenz und die Distanz zum Anker", () => {
    const rs = rows();
    const b = rs.find((row) => row.station.station_id === "b")!;
    const a = rs.find((row) => row.station.station_id === "a")!;
    const refB = rs.find((row) => row.isReference)!;
    const linesB = stationContextLines(b, refB);
    expect(linesB[0]).toContain("günstigste");
    // Referenz selbst: kein Abstand zu sich selbst.
    expect(linesB.some((line) => line.includes("der Referenz"))).toBe(false);
    const linesA = stationContextLines(a, refB);
    expect(linesA[0]).toContain("die Zweitgünstigste");
    expect(linesA[1]).toContain("7,0 ct/L über der Referenz (B-Station)");
    // Wortregel 0.36.0: Im Alltag heißt der Heimat-Startpunkt „Zuhause“.
    expect(linesA[2]).toContain("2,5 km ab Zuhause");
  });

  it("benennt eine als Straßenstrecke belegte Server-Distanz", () => {
    const serverAlts = [serverAlt({ detour_km_source: "road" })];
    const rs = rows({ serverAlts, selectedId: "b" });
    const a = rs.find((row) => row.station.station_id === "a")!;
    const lines = stationContextLines(a, rs.find((row) => row.isReference)!);
    expect(lines.at(-1)).toBe("Umweg zur Referenz: +1,2 km (Straßenstrecke).");
  });

  it("ohne frischen Preis steht der ehrliche Satz", () => {
    const rs = rows();
    const c = rs.find((row) => row.station.station_id === "c")!;
    expect(stationContextLines(c, null)[0]).toContain("Kein frischer Preis");
  });
});

describe("compareStationsPair", () => {
  it("ohne Server-Route bleibt der Vergleich Preis gegen Preis", () => {
    const result = compareStationsPair(A, B, 1.759, 1.689, 40, null);
    expect(result.deltaCt).toBeCloseTo(-7, 6);
    expect(result.fillDeltaEur).toBeCloseTo(-2.8, 6);
    expect(result.netEur).toBeNull();
    expect(result.sentence).toContain("7,0 ct/L günstiger");
    expect(result.sentence).toContain("ohne Umweg — zu diesem Paar liegt keine Route vor");
  });

  it("mit Server-Route steht das Netto-Urteil", () => {
    const alt = serverAlt({ station_id: "b", name: "B-Station", price: 1.689 });
    const result = compareStationsPair(A, B, 1.759, 1.689, 40, alt);
    expect(result.netEur).toBe(2.3);
    expect(result.sentence).toContain("2,30 € netto pro Beleg");
    expect(result.sentence).toContain("Der Umweg rechnet sich.");
  });

  it("fehlender Preis verhindert den Vergleich — ehrlich, nicht mit 0", () => {
    const result = compareStationsPair(A, C, 1.759, null, 40, null);
    expect(result.deltaCt).toBeNull();
    // T4: Der Satz nennt die Seite, die wirklich leer ist — nicht „beide“.
    expect(result.sentence).toContain(`${C.name} hat keinen frischen Preis`);
    expect(result.sentence).not.toContain("auf beiden Seiten");
  });

  it("fehlen beide Preise, sagt der Satz das auch (T4)", () => {
    const result = compareStationsPair(A, C, null, null, 40, null);
    expect(result.sentence).toContain(
      "Noch kein frischer Preis auf beiden Seiten",
    );
  });

  it("aufeinanderliegende Preise sind Gleichauf", () => {
    const result = compareStationsPair(A, B, 1.7, 1.7, 40, null);
    expect(result.sentence).toContain("Gleichauf");
  });
});

describe("stationsFreshness", () => {
  it("ohne Datenstand: ehrliche Leerzeile statt Null", () => {
    expect(stationsFreshness(null, NOW).text).toBe(
      "Kein Datenstand — noch nichts gemeldet",
    );
  });

  it("frisch (unter 30 min): ok", () => {
    const state = stationsFreshness(stamp(4), NOW);
    expect(state.tone).toBe("ok");
    expect(state.text).toContain("vor 4 Minuten");
  });

  it("älter als 30 min: warn", () => {
    expect(stationsFreshness(stamp(45), NOW).tone).toBe("warn");
  });

  it("älter als 60 min: bad", () => {
    expect(stationsFreshness(stamp(90), NOW).tone).toBe("bad");
  });
});

describe("dayRhythmLine", () => {
  const cells = (values: Array<[number, number | null]>) =>
    values.map(([hour, value]) => ({ hour, value }));

  it("unter sechs Messstunden: null (kein Muster erfunden)", () => {
    expect(
      dayRhythmLine(cells([[8, 1.7], [10, 1.8], [14, 1.75]])),
    ).toBeNull();
  });

  it("abends günstiger → Abend-Muster mit Stunden", () => {
    const line = dayRhythmLine(
      cells([
        [7, 1.85],
        [8, 1.9],
        [9, 1.88],
        [10, 1.87],
        [18, 1.7],
        [19, 1.68],
        [20, 1.72],
      ]),
    );
    expect(line).toContain("Eher günstig am Abend (ca. 19:00)");
    expect(line).toContain("eher teuer am Morgen (ca. 08:00)");
  });

  it("morgens günstiger → Morgen-Muster", () => {
    const line = dayRhythmLine(
      cells([
        [7, 1.68],
        [8, 1.7],
        [9, 1.71],
        [10, 1.69],
        [18, 1.85],
        [19, 1.87],
        [20, 1.86],
      ]),
    );
    expect(line).toContain("Eher günstig am Morgen (ca. 07:00)");
    expect(line).toContain("eher teuer am Abend (ca. 19:00)");
  });

  it("kein klares Muster → beide günstigsten Stunden nennen", () => {
    const line = dayRhythmLine(
      cells([
        [7, 1.75],
        [8, 1.75],
        [9, 1.75],
        [10, 1.75],
        [18, 1.75],
        [19, 1.75],
        [20, 1.75],
      ]),
    );
    expect(line).toContain("Kein starker Tag-Nacht-Unterschied");
  });

  it("nur ein Teil des Tages gemessen → günstigste Stunde, kein Tag-Nacht-Satz", () => {
    const line = dayRhythmLine(
      cells([
        [7, 1.7],
        [8, 1.72],
        [9, 1.71],
        [10, 1.73],
        [11, 1.7],
        [12, 1.74],
      ]),
    );
    expect(line).toContain("Günstigste offene Stunde heute: ca. 07:00");
  });
});
