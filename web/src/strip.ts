// „Heute im Blick“ — der kompakte Tagesstreifen 06–24 Uhr
// (UI-NEUENTWURF §5.1 ④, §8 Tagesstreifen).
//
// Der Streifen ist reine Anzeige-Logik: letzte offene Preismeldung je
// Stunde **des heutigen Berliner Kalendertags**, in drei Tonlagen (eher
// günstig / Mitte / eher teuer) und mit „jetzt“-Markierung. Keine
// Prognose, keine Empfehlung — das ist seine Ehrlichkeits-Zusage (vorher
// Stand im Alltagstab, jetzt geteilter Baustein von „Jetzt“ und
// „Stationen“).
//
// Seit 0.49.3 strikt Kalendertag: Der Server liefert ein rollierendes
// 24-h-Fenster; ohne den Schnitt standen in den Zellen 18–24 Uhr am
// Nachmittag die Meldungen von **gestern Abend** — „Günstigste Stunde
// 20–22 Uhr“ war dann buchstäblich eine Vergangenheits-Beobachtung, die
// wie eine Planungsgröße aussah (Nutzer-Feedback 17.09.2026). Zukünftige
// Stunden bleiben jetzt ehrlich leer.

import { berlinDay, berlinHour, type Point } from "./data";

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
 * Nur `status === "open"` mit finitem Preis **vom heutigen Berliner
 * Kalendertag** zählt — Meldungen von gestern (das Server-Fenster rolliert
 * 24 h) fallen heraus, leere Stunden bleiben leer (keine erfundenen
 * Werte). Die Tonlagen sind relative Drittel des Tages-Extremwerts; ohne
 * Messwerte bleibt alles „empty“.
 */
export function buildStripCells(
  points: Point[] | null | undefined,
  now = Date.now(),
): StripCell[] {
  const today = berlinDay(now);
  const todayKey = today ? today.join("-") : null;
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
    // Kalendertag-Schnitt (0.49.3): Gestern ist keine „heutige“ Stunde.
    const pointDay = berlinDay(ms);
    if (!todayKey || !pointDay || pointDay.join("-") !== todayKey) continue;
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
