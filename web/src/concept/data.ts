export type Verdict = "now" | "wait" | "relaxed";
export type Level = "full" | "noForecast" | "offline";
export type Fuel = "E10" | "E5" | "Diesel";

export const fuels: Fuel[] = ["E10", "E5", "Diesel"];
export const fuelOffset: Record<Fuel, number> = { E10: 0, E5: 0.06, Diesel: -0.06 };

export const hours = ["Jetzt", "15", "16", "17", "18", "19", "20", "21", "22"];

/** Prognostizierte Preise (E10) für die nächsten Stunden je Empfehlung */
export const curves: Record<Verdict, number[]> = {
  now: [1.679, 1.689, 1.709, 1.729, 1.739, 1.729, 1.749, 1.749, 1.739],
  wait: [1.749, 1.745, 1.729, 1.709, 1.679, 1.669, 1.679, 1.709, 1.729],
  relaxed: [1.699, 1.695, 1.701, 1.699, 1.697, 1.699, 1.703, 1.699, 1.701],
};

export type PriceLevel = "low" | "mid" | "high";
export function levelOf(price: number, min: number): PriceLevel {
  const diff = price - min;
  if (diff < 0.015) return "low";
  if (diff < 0.05) return "mid";
  return "high";
}

export const stations = [
  { id: "jet", brand: "JET", street: "Frankfurter Ring 227", km: "1,2 km", open: "offen bis 22 Uhr", base: 1.679, bg: "#FFD200", fg: "#C8102E" },
  { id: "bft", brand: "bft", street: "Ingolstädter Str. 43", km: "2,0 km", open: "24 h geöffnet", base: 1.689, bg: "#004B93", fg: "#FFFFFF" },
  { id: "shell", brand: "Shell", street: "Schleißheimer Str. 310", km: "2,4 km", open: "24 h geöffnet", base: 1.709, bg: "#FFD500", fg: "#DD1D21" },
  { id: "aral", brand: "ARAL", street: "Leopoldstraße 184", km: "0,7 km", open: "offen bis 23 Uhr", base: 1.719, bg: "#0066B2", fg: "#FFFFFF" },
];

export const verdictCopy: Record<Verdict, {
  label: string; title: string; sub: string; cta: string; secondary: string;
  confidence: 1 | 2 | 3; confidenceText: string;
  stripTitle: string; bestIndex: number;
  waitTitle: string; waitText: string; waitTone: "good" | "bad" | "neutral";
  reasons: { title: string; text: string }[];
  snackbar: string;
}> = {
  now: {
    label: "Beste Zeit heute",
    title: "Jetzt tanken",
    sub: "Günstiger wird’s heute nicht mehr. Ab 16 Uhr ziehen die Preise an.",
    cta: "Route zu JET",
    secondary: "Warum?",
    confidence: 3, confidenceText: "Sehr sicher",
    stripTitle: "Gerade ist der günstigste Moment.",
    bestIndex: 0,
    waitTitle: "Warten kostet",
    waitText: "Bis 20 Uhr zahlst du ca. 3,15 € mehr pro Tankfüllung.",
    waitTone: "bad",
    reasons: [
      { title: "Preis am Tagestief", text: "Rund 7 Cent unter dem heutigen Höchststand." },
      { title: "Anstieg ab 16 Uhr", text: "An vergleichbaren Tagen zogen die Preise am Nachmittag an." },
      { title: "Viele Tankstellen im Trend", text: "Die Preise in deiner Umgebung bewegen sich gemeinsam." },
    ],
    snackbar: "Route zu JET wird geöffnet …",
  },
  wait: {
    label: "Geduld lohnt sich",
    title: "Besser warten",
    sub: "Gegen 19 Uhr wird’s voraussichtlich 8 Cent günstiger.",
    cta: "Erinnere mich um 19 Uhr",
    secondary: "Warum?",
    confidence: 2, confidenceText: "Ziemlich sicher",
    stripTitle: "Am günstigsten gegen 19 Uhr.",
    bestIndex: 5,
    waitTitle: "Warten spart",
    waitText: "Um 19 Uhr sparst du ca. 3,60 € pro Tankfüllung.",
    waitTone: "good",
    reasons: [
      { title: "Preis gerade hoch", text: "Aktuell rund 8 Cent über dem erwarteten Abendpreis." },
      { title: "Abendtief erwartet", text: "Zwischen 18 und 20 Uhr fallen die Preise meist deutlich." },
      { title: "Genug Zeit", text: "Bis dahin sind es noch rund 4 Stunden." },
    ],
    snackbar: "Erinnerung für 19:00 Uhr gestellt.",
  },
  relaxed: {
    label: "Kein Zeitdruck",
    title: "Tanken, wann’s passt",
    sub: "Die Preise bleiben heute stabil. Nimm einfach die nächste günstige Tankstelle.",
    cta: "Route zu JET",
    secondary: "Warum?",
    confidence: 3, confidenceText: "Sehr sicher",
    stripTitle: "Kaum Schwankungen bis zum Abend.",
    bestIndex: 1,
    waitTitle: "Macht kaum Unterschied",
    waitText: "Unter 0,50 € pro Tankfüllung. Heute zählt eher der kürzeste Weg.",
    waitTone: "neutral",
    reasons: [
      { title: "Ruhiger Tag", text: "Die Preise schwanken heute um weniger als 1 Cent." },
      { title: "Kein Anstieg in Sicht", text: "Auch für den Abend erwarten wir keine Sprünge." },
      { title: "Weg schlägt Zeit", text: "Ein kurzer Umweg spart mehr als das Warten." },
    ],
    snackbar: "Route zu JET wird geöffnet …",
  },
};

export const LITERS = 45;
