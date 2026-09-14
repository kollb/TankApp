// „Heute im Blick“: der kompakte Tagesstreifen (UI-NEUENTWURF §5.1 ④).
// Geprüft wird die Ehrlichkeits-Zusage: nur offene Meldungen zählen,
// leere Stunden bleiben leer, Tonlagen sind relative Drittel und die
// Sparkline existiert erst ab drei Werten.

import { describe, expect, it } from "vitest";
import type { Point } from "./data";
import { buildStripCells, stripSparkline } from "./strip";

// Fester Zeitpunkt: 12:00 Uhr Berlin (Sommerzeit, UTC+2).
const NOW = Date.parse("2026-09-14T12:00:00+02:00");

function point(
  price: number | null,
  timestamp: string,
  status = "open",
): Point {
  return { timestamp, price, status };
}

const points: Point[] = [
  // 07:30 Berlin — günstigste gemessene Stunde.
  point(1.7, "2026-09-14T05:30:00Z"),
  // 11:00 Berlin.
  point(1.9, "2026-09-14T09:00:00Z"),
  // 12:00 Berlin — die aktuelle Stunde.
  point(1.8, "2026-09-14T10:00:00Z"),
  // 20:30 Berlin — teuerste gemessene Stunde.
  point(1.95, "2026-09-14T18:30:00Z"),
  // Geschlossen — zählt nicht, auch wenn der Preis schön günstig ist.
  point(1.6, "2026-09-14T06:00:00Z", "closed"),
  // Null-Preis — keine Meldung.
  point(null, "2026-09-14T07:00:00Z"),
  // 01:00 Berlin — außerhalb des 06–24-Fensters.
  point(1.65, "2026-09-13T23:00:00Z"),
];

describe("buildStripCells", () => {
  it("liefert immer 18 Zellen (06–24 Uhr)", () => {
    const cells = buildStripCells(points, NOW);
    expect(cells).toHaveLength(18);
    expect(cells[0].hour).toBe(6);
    // Letzte Zelle = die 23-Uhr-Stunde (23:00 bis Mitternacht).
    expect(cells[17].hour).toBe(23);
  });

  it("ohne Meldungen bleibt alles empty — keine erfundenen Werte", () => {
    for (const cells of [buildStripCells(null, NOW), buildStripCells([], NOW)]) {
      for (const cell of cells) {
        expect(cell.value).toBeNull();
        expect(cell.tone).toBe("empty");
      }
    }
  });

  it("zählt nur offene Meldungen mit finitem Preis im 06–24-Fenster", () => {
    const cells = buildStripCells(points, NOW);
    expect(cells[1].value).toBe(1.7); // 07:00
    expect(cells[5].value).toBe(1.9); // 11:00
    expect(cells[6].value).toBe(1.8); // 12:00
    expect(cells[14].value).toBe(1.95); // 20:00
    // Geschlossen, null-Preis und vor 06 Uhr sind leer.
    expect(cells[2].value).toBeNull(); // 08:00 (nur closed)
    expect(cells[3].value).toBeNull(); // 09:00 (nur null)
    expect(cells[0].value).toBeNull(); // 06:00
  });

  it("rechnet die Tonlagen aus relativen Dritteln des Tages", () => {
    const cells = buildStripCells(points, NOW);
    expect(cells[1].tone).toBe("cheap"); // 1.70 = Minimum
    expect(cells[6].tone).toBe("mid"); // 1.80 liegt in der Mitte
    expect(cells[5].tone).toBe("pricey"); // 1.90 nahe Maximum
    expect(cells[14].tone).toBe("pricey"); // 1.95 = Maximum
  });

  it("markiert die aktuelle Berliner Stunde", () => {
    const cells = buildStripCells(points, NOW);
    const current = cells.filter((cell) => cell.current);
    expect(current).toHaveLength(1);
    expect(current[0].hour).toBe(12);
  });
});

describe("stripSparkline", () => {
  it("unter drei Werten steht ehrlich null (keine flache Linie)", () => {
    const cells = buildStripCells(
      [point(1.7, "2026-09-14T05:30:00Z"), point(1.9, "2026-09-14T09:00:00Z")],
      NOW,
    );
    expect(stripSparkline(cells)).toBeNull();
  });

  it("ab drei Werten liefert sie die Reihe (NaN für leere Stunden)", () => {
    const cells = buildStripCells(points, NOW);
    const series = stripSparkline(cells);
    expect(series).not.toBeNull();
    expect(series).toHaveLength(18);
    expect(series?.[1]).toBe(1.7);
    expect(Number.isNaN(series?.[7]!)).toBe(true); // 13:00 leer
  });
});
