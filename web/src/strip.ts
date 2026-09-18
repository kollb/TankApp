// „Heute im Blick“ — der kompakte Tagesstreifen 06–24 Uhr
// (UI-NEUENTWURF §5.1 ④, §8 Tagesstreifen).
//
// „Heute im Blick“ — der kompakte Tagesstreifen 06–24 Uhr
// (UI-NEUENTWURF §5.1 ④, §8 Tagesstreifen).
//
// Der Streifen ist reine Anzeige-Logik: Stunden-Minimum der offenen
// Preismeldungen **des heutigen Berliner Kalendertags**, in drei Tonlagen
// und mit „jetzt“-Markierung. Keine Prognose, keine Empfehlung — das ist
// seine Ehrlichkeits-Zusage (vorher Stand im Alltagstab, jetzt geteilter
// Baustein von „Jetzt“ und „Stationen“).
//
// Zwei Korrektur-Lagen liegen übereinander:
//   - **0.49.3 — strikt Kalendertag.** Der Server liefert ein rollierendes
//     24-h-Fenster; ohne den Schnitt standen in den Zellen 18–24 Uhr am
//     Nachmittag die Meldungen von **gestern Abend** — „Günstigste Stunde
//     20–22 Uhr“ war dann buchstäblich eine Vergangenheits-Beobachtung,
//     die wie eine Planungsgröße aussah (Nutzer-Feedback 17.09.2026).
//     Zukünftige Stunden bleiben ehrlich leer.
//   - **O20 (0.50.0) — feste Farbskala + Stunden-Minimum.** Die Tonlagen
//     kamen aus Minimum/Maximum des Tages: Eine neue, günstigere Meldung
//     um 18 Uhr färbte den ganzen bisherigen Tag um — dieselbe Zahl,
//     abends eine andere Farbe. Jetzt kommt die Skala vom Server als
//     Band über einen festen Bezugszeitraum (`StripBand`, 25./75.
//     Perzentil der letzten 7 Tage). Ohne Band gibt es **kein**
//     Farburteil (`tone: "unrated"`) statt einer Skala aus zwei
//     Messwerten. Die Fenstersuche bewertet das Minimum einer Stunde;
//     der Streifen zeigte den Stand am Stundenende. Beide zeigen jetzt
//     dieselbe Größe (`value`), der letzte Preis der Stunde bleibt für
//     „jetzt“ erhalten (`latest`).

import {
  berlinDay,
  berlinHour,
  countLabel,
  euroPerLiter,
  type Point,
  type StripBand,
} from "./data";

// Die Skala ist in `data.ts` definiert (Server-Feld `day.band`); hier nur
// weitergereicht, damit `strip.ts` die einzige Anzeige-Logik bleibt.
export type { StripBand };

export type StripCell = {
  hour: number;
  /** Günstigste offene Meldung der Stunde — dieselbe Größe wie die Fenstersuche. */
  value: number | null;
  /** Letzte offene Meldung der Stunde; „jetzt“ ist ein Zeitpunkt, kein Minimum. */
  latest: number | null;
  tone: "empty" | "unrated" | "cheap" | "mid" | "pricey";
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
 * Werte). Die Tonlagen sind feste Grenzen des Bezugsbands; ohne Band
 * bleibt alles `unrated` (Zahl ja, Farburteil nein).
 */
export function buildStripCells(
  points: Point[] | null | undefined,
  now = Date.now(),
  band: StripBand | null = null,
): StripCell[] {
  const today = berlinDay(now);
  const todayKey = today ? today.join("-") : null;
  const byHour = new Map<number, { min: number; last: number }>();
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
    const cell = hour === 0 ? 24 : hour >= 6 && hour <= 23 ? hour : null;
    if (cell === null) continue;
    // O20: Minimum je Stunde (wie die Fenstersuche), dazu der letzte Preis
    // der Stunde für die „jetzt“-Zelle. `set` allein überschrieb den
    // Stundenwert mit der letzten Meldung.
    const known = byHour.get(cell);
    byHour.set(cell, {
      min: known === undefined ? p.price : Math.min(known.min, p.price),
      last: p.price,
    });
  }
  const nowHour = Math.floor(berlinHour(new Date(now)));
  const usable =
    band !== null && Number.isFinite(band.lo) && Number.isFinite(band.hi) && band.lo < band.hi
      ? band
      : null;
  return Array.from({ length: 19 }, (_, i) => {
    const hour = 6 + i;
    const entry = byHour.get(hour);
    const value = entry?.min ?? null;
    return {
      hour,
      value,
      latest: entry?.last ?? null,
      tone:
        value === null
          ? "empty"
          : usable === null
            ? "unrated"
            : value <= usable.lo
              ? "cheap"
              : value >= usable.hi
                ? "pricey"
                : "mid",
      current: hour === nowHour,
    };
  });
}

/**
 * O20: Benennt die Skala im Kleingedruckten — mit den Grenzen in €/L und der
 * Zahl der Tage, aus denen sie stammt. Ohne Band sagt der Satz ehrlich, dass
 * die Zahlen ohne Farburteil dastehen (und warum).
 */
export function stripBandNote(band: StripBand | null): string {
  if (
    band === null ||
    !Number.isFinite(band.lo) ||
    !Number.isFinite(band.hi) ||
    band.lo >= band.hi
  ) {
    return "Ohne Verlauf der letzten Tage keine Farbskala — die Zahlen stehen ohne Grün/Rot-Urteil.";
  }
  const days =
    typeof band.days === "number" && band.days > 0 ? countLabel(band.days) : null;
  const span = days ? `der letzten ${days} Tage` : "des Bezugszeitraums";
  return `Farbskala ${span}: grün bis ${euroPerLiter(band.lo)}, rot ab ${euroPerLiter(band.hi)}.`;
}
