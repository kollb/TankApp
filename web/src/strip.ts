// „Heute im Blick“ — der kompakte Tagesstreifen 06–24 Uhr
// (UI-NEUENTWURF §5.1 ④, §8 Tagesstreifen).
//
// Der Streifen ist reine Anzeige-Logik: letzte offene Preismeldung je
// Stunde, in drei Tonlagen (eher günstig / Mitte / eher teuer) und mit
// „jetzt“-Markierung. Keine Prognose, keine Empfehlung — das ist seine
// Ehrlichkeits-Zusage (vorher Stand im Alltagstab, jetzt geteilter
// Baustein von „Jetzt“ und „Stationen“).

import { berlinHour, type Point } from "./data";

export type StripCell = {
  hour: number;
  value: number | null;
  tone: "empty" | "cheap" | "mid" | "pricey";
  current: boolean;
};

/**
 * Baut die 19 Zellen (06–24 Uhr) aus der Tageskurve — dieselbe Achse wie
 * der Pi-Fallback (Parität, B11): Zelle „24“ trägt die Mitternachtsmeldung
 * (00:00–00:59), Stunden 1–5 liegen außerhalb des 06–24-Fensters.
 *
 * Nur `status === "open"` mit finitem Preis zählt — leere Stunden
 * bleiben leer (keine erfundenen Werte). Die Tonlagen sind relative
 * Drittel des Tages-Extremwerts; ohne Messwerte bleibt alles „empty“.
 */
export function buildStripCells(
  points: Point[] | null | undefined,
  now = Date.now(),
): StripCell[] {
  const byHour = new Map<number, number>();
  for (const p of points ?? []) {
    const ms = Date.parse(p.timestamp);
    if (
      p.status !== "open" ||
      p.price === null ||
      !Number.isFinite(p.price) ||
      !Number.isFinite(ms)
    )
      continue;
    const hour = Math.floor(berlinHour(new Date(ms)));
    // Mitternacht ist die Tagesgrenze des Streifens — nicht verloren.
    if (hour === 0) byHour.set(24, p.price);
    else if (hour >= 6 && hour <= 23) byHour.set(hour, p.price);
  }
  const values = [...byHour.values()];
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const span = max - min || 1;
  const nowHour = Math.floor(berlinHour(new Date(now)));
  return Array.from({ length: 19 }, (_, i) => {
    const hour = 6 + i;
    const value = byHour.get(hour);
    return {
      hour,
      value: value ?? null,
      tone:
        value === undefined
          ? "empty"
          : value <= min + span / 3
            ? "cheap"
            : value >= max - span / 3
              ? "pricey"
              : "mid",
      current: hour === nowHour,
    };
  });
}

/**
 * Sparkline-Daten für die Stationsliste (UI-NEUENTWURF §5.2 „Verlauf
 * schlägt Moment“): die 19 Zellen als Werte-Reihe (null = keine
 * Meldung). Ohne Daten `null` — die Zeile zeigt dann ehrlich kein
 * Mini-Verlauf, statt eine flache Linie zu erfinden.
 */
export function stripSparkline(cells: StripCell[]): number[] | null {
  const values = cells.map((cell) => cell.value).filter(
    (value): value is number => value !== null,
  );
  if (values.length < 3) return null;
  return cells.map((cell) => cell.value ?? Number.NaN);
}
