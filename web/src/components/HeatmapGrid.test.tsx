// P0 12.09.2026 — die Heatmap muss ihre „günstigste Stunde“ so nennen, dass
// sie im Raster wiederzufinden ist, und bei jungem Bestand sagen, warum Zeilen
// leer bleiben. Render-Test gegen echtes Komponenten-Markup (react-dom/server),
// damit Label-Logik und Anzeige nicht auseinanderlaufen können.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HeatmapGrid } from "./HeatmapGrid";
import type { Heatmap } from "../data";

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Der gemeldete Bestand: Tracking seit Dienstag, Di 06–17 Uhr durchgehend
 * „100 % günstig“, Di 18–23 Uhr und die übrigen Tage zu dünn für eine Zelle.
 * `reference` steuert die Stichprobe der Vergleichs-Basis — 16 ist der
 * Originalzustand (dünn), 240 derselbe Befund im Dauerbetrieb (belastbar).
 */
function startupHeatmap(reference = 16): Heatmap {
  const matrix = DAYS.map((): (number | null)[] => HOURS.map(() => null));
  const counts = DAYS.map(() => HOURS.map(() => 0));
  const refs = DAYS.map(() => HOURS.map(() => 0));
  for (let h = 6; h <= 17; h += 1) {
    matrix[1][h] = 100;
    counts[1][h] = 9;
    refs[1][h] = reference;
  }
  for (let h = 18; h <= 23; h += 1) {
    matrix[1][h] = 100;
    counts[1][h] = 2; // „·“ — unter MIN_HEATMAP_POINTS
    refs[1][h] = 4;
  }
  for (const day of [2, 3, 4, 5]) {
    for (let h = 6; h <= 17; h += 1) {
      matrix[day][h] = 0;
      counts[day][h] = 2;
      refs[day][h] = reference;
    }
  }
  return {
    generated_at: "2026-09-12T06:00:00+00:00",
    city: "Frankfurt",
    fuel: "e10",
    kind: "probability",
    weeks: 6,
    station_id: null,
    basis: "hour",
    days: DAYS,
    hours: HOURS,
    matrix,
    counts,
    reference_counts: refs,
    range_from: "2026-09-08T03:10:00+00:00",
    range_to: "2026-09-12T05:55:00+00:00",
    points: 12345,
    stations: 18,
    error_code: null,
  };
}

/** Text ohne Markup — so liest ihn auch ein Screenreader. */
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("HeatmapGrid (P0: günstige Stunde wiederfindbar)", () => {
  it("nennt den ganzen Gleichstands-Bereich statt einer erfundenen Spanne", () => {
    const plain = text(
      renderToStaticMarkup(<HeatmapGrid heatmap={startupHeatmap(240)} />),
    );
    // Vorher: „Typisch am günstigsten: Di 06–08 Uhr — 100 % Chance günstig“ —
    // 06–08 war im Raster nicht wiederzufinden (eine Spalte = eine Stunde),
    // und zwölf Stunden lagen gleichauf.
    expect(plain).not.toContain("06–08 Uhr");
    expect(plain).toContain("Typisch am günstigsten");
    expect(plain).toContain("Di 06–18 Uhr");
    expect(plain).toContain("12 Stunden gleichauf");
    expect(plain).not.toContain("Noch keine belastbare");
  });

  it("warnt, wenn die Vergleichs-Basis zu dünn für eine Empfehlung ist", () => {
    const markup = renderToStaticMarkup(<HeatmapGrid heatmap={startupHeatmap()} />);
    expect(markup).toContain("Noch keine belastbare");
    expect(markup).toContain("06–18 Uhr");
    expect(markup).toContain("n=16");
    expect(markup).toContain("dünn");
    expect(markup).toContain("Mechanik");
    // Der Wert bleibt ehrlich stehen — nur die Empfehlung wird zurückgenommen.
    expect(markup).toContain("100 %");
  });

  it("erklärt leere Wochentage mit der Reichweite des Bestands", () => {
    const plain = text(
      renderToStaticMarkup(<HeatmapGrid heatmap={startupHeatmap()} />),
    );
    expect(plain).toContain("Datenreichweite");
    expect(plain).toContain("12.345 Preise von 18 Stationen");
    expect(plain).toContain("Di 08.09. 05:10 – Sa 12.09. 07:55 Uhr");
    expect(plain).toContain("Fenster 42 Tage (6 Wochen)");
    expect(plain).toContain("kein Datenverlust");
    // Eine Spalte ist eine Stunde — das sagt die Erklärzeile jetzt selbst.
    expect(plain).toContain("Eine Spalte ist genau eine Stunde");
    expect(plain).toContain("„06–07 Uhr“");
  });

  it("nennt beim Niveau die Stunde und trennt sie vom Tagesmedian", () => {
    const matrix = DAYS.map((): (number | null)[] => HOURS.map(() => null));
    const counts = DAYS.map(() => HOURS.map(() => 60));
    const levels = [
      2.239, 2.239, 2.239, 2.239, 2.239, 2.239, 2.389, 2.309, 2.269, 2.239,
      2.239, 2.219,
    ];
    levels.forEach((value, i) => {
      matrix[1][6 + i] = value;
    });
    const heatmap: Heatmap = {
      ...startupHeatmap(),
      kind: "level",
      matrix,
      counts,
      reference_counts: null,
      // Bestand deckt das Fenster → keine „wo sind die Zahlen?“-Zeile.
      range_from: "2026-08-01T00:00:00+00:00",
      range_to: "2026-09-12T05:55:00+00:00",
    };
    const plain = text(renderToStaticMarkup(<HeatmapGrid heatmap={heatmap} />));
    // Vorher: „Di 17–19 Uhr — Median 2.219 €/L“, obwohl Stunde 18 ein „·“ war
    // und der Punkt sich als Tausender-Trennzeichen las.
    expect(plain).not.toContain("17–19 Uhr");
    expect(plain).toContain("Di 17–18 Uhr");
    expect(plain).toContain("2,219 €/L in dieser Stunde");
    expect(plain).toContain("Tagesmedian 2,239 €/L");
    expect(plain).not.toContain("2.219");
    expect(plain).not.toContain("kein Datenverlust");
    expect(plain).toContain("Fenster 6 Wochen abgedeckt");
  });
});
