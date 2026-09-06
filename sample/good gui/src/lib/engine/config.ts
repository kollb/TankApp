/**
 * Konfiguration des Entscheidungs-Labors (Demo).
 * Synthetische, aber realistisch modellierte 5-min-Preisdaten nach dem Muster von KONZEPT v4:
 *  - 3 Kampagnen: Frankfurt am Main (HE), München (BY), Köln (NW)
 *  - E10, Poll-Fenster 06:00–23:55 (MEZ), UTC gespeichert
 *  - Trainingsfenster 6 Wochen, Out-of-Sample-Evaluation 2 Wochen
 *  - Preissprünge („Betreiber-Sprünge") als Regime: Nachmittags-Sprung => Abendtief entfällt
 */

export const DAYS_TRAIN = 42; // 6 Wochen
export const DAYS_EVAL = 14; // 2 Wochen Out-of-Sample
export const TRAIN_START = "2025-12-01"; // Montag
export const POINTS_PER_DAY = 216; // 06:00–23:55 im 5-min-Raster (18 h × 12)

export const DEFAULT_LITERS = 40;
export const DEFAULT_EPS = 1.0; // Handlungsschwelle ε in ct/L
export const DECISION_HOUR = 8; // Entscheidung morgens um 08:00

export type ProfileKind = "std" | "aggr" | "disc" | "flat" | "riser";

export interface CityDef {
  slug: string;
  name: string;
  state: "HE" | "BY" | "NW";
  lat: number;
  lon: number;
  baseCt: number; // Basis E10-Niveau in ct/L
}

export interface StationDef {
  id: string;
  city: string;
  name: string;
  brand: string;
  lat: number;
  lon: number;
  profile: ProfileKind;
  close22: boolean; // false => 24 h
  baseOffsetCt: number; // Niveau-Offset vs. Stadtbasis
  pb: number; // Sprung-Tage-Wahrscheinlichkeit (Werktag)
}

export const CITIES: CityDef[] = [
  { slug: "ffm", name: "Frankfurt am Main", state: "HE", lat: 50.1109, lon: 8.6821, baseCt: 169.9 },
  { slug: "muc", name: "München", state: "BY", lat: 48.1351, lon: 11.582, baseCt: 170.9 },
  { slug: "cgn", name: "Köln", state: "NW", lat: 50.9375, lon: 6.9603, baseCt: 168.9 },
];

export const STATIONS: StationDef[] = [
  // Frankfurt am Main (HE) — Heimatkampagne
  { id: "ffm01", city: "ffm", name: "Aral Bockenheim", brand: "Aral", lat: 50.1236, lon: 8.6539, profile: "aggr", close22: true, baseOffsetCt: 1.6, pb: 0.35 },
  { id: "ffm02", city: "ffm", name: "Shell Westend", brand: "Shell", lat: 50.1192, lon: 8.6673, profile: "std", close22: true, baseOffsetCt: 0.9, pb: 0.18 },
  { id: "ffm03", city: "ffm", name: "JET Gallusviertel", brand: "JET", lat: 50.1062, lon: 8.6418, profile: "disc", close22: false, baseOffsetCt: -3.0, pb: 0.06 },
  { id: "ffm04", city: "ffm", name: "HEM Sachsenhausen", brand: "HEM", lat: 50.0964, lon: 8.6889, profile: "flat", close22: false, baseOffsetCt: -3.8, pb: 0.12 },
  { id: "ffm05", city: "ffm", name: "Esso Nordend", brand: "Esso", lat: 50.1308, lon: 8.6913, profile: "std", close22: true, baseOffsetCt: 0.5, pb: 0.13 },
  { id: "ffm06", city: "ffm", name: "TotalEnergies Rödelheim", brand: "TotalEnergies", lat: 50.1242, lon: 8.6117, profile: "riser", close22: false, baseOffsetCt: 1.9, pb: 0.0 },
  // München (BY)
  { id: "muc01", city: "muc", name: "Aral Schwabing", brand: "Aral", lat: 48.1621, lon: 11.5704, profile: "aggr", close22: true, baseOffsetCt: 1.5, pb: 0.32 },
  { id: "muc02", city: "muc", name: "Shell Sendling", brand: "Shell", lat: 48.1163, lon: 11.5439, profile: "std", close22: true, baseOffsetCt: 0.8, pb: 0.15 },
  { id: "muc03", city: "muc", name: "JET Giesing", brand: "JET", lat: 48.1112, lon: 11.5934, profile: "disc", close22: false, baseOffsetCt: -3.2, pb: 0.05 },
  // Köln (NW)
  { id: "cgn01", city: "cgn", name: "Shell Ehrenfeld", brand: "Shell", lat: 50.949, lon: 6.915, profile: "std", close22: true, baseOffsetCt: 0.9, pb: 0.15 },
  { id: "cgn02", city: "cgn", name: "HEM Mülheim", brand: "HEM", lat: 50.9613, lon: 7.0091, profile: "disc", close22: false, baseOffsetCt: -3.4, pb: 0.09 },
  { id: "cgn03", city: "cgn", name: "Aral Sülz", brand: "Aral", lat: 50.9228, lon: 6.9267, profile: "aggr", close22: true, baseOffsetCt: 1.4, pb: 0.28 },
];

export const PROFILE_LABEL: Record<ProfileKind, string> = {
  std: "Klassiker · Abendtief",
  aggr: "Volatil · Mittagssprünge",
  disc: "Discounter · flach",
  flat: "Preisstabil · 24 h",
  riser: "Steigender Tagesverlauf",
};

/** Feiertage je Bundesland (inkl. 24.12. als Quasi-Feiertag). Demo-Zeitfenster Dez 2025 – Jan 2026. */
const HOLIDAYS: Record<"HE" | "BY" | "NW", string[]> = {
  HE: ["2025-12-24", "2025-12-25", "2025-12-26", "2026-01-01"],
  BY: ["2025-12-24", "2025-12-25", "2025-12-26", "2026-01-01", "2026-01-06"], // Heilige Drei Könige: nur BY
  NW: ["2025-12-24", "2025-12-25", "2025-12-26", "2026-01-01"],
};

export function isHoliday(dateStr: string, state: "HE" | "BY" | "NW"): boolean {
  return HOLIDAYS[state].includes(dateStr);
}

/** Alle lokalen Tage (YYYY-MM-DD) des Demo-Zeitfensters. */
export function allDayStrings(): string[] {
  const out: string[] = [];
  const start = new Date(Date.UTC(2025, 11, 1));
  const total = DAYS_TRAIN + DAYS_EVAL;
  for (let i = 0; i < total; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Klasse: 0 = Werktag, 1 = Wochenende/Feiertag */
export function classOf(dateStr: string, dow: number, state: "HE" | "BY" | "NW"): number {
  if (isHoliday(dateStr, state) || dow === 0 || dow === 6) return 1;
  return 0;
}
