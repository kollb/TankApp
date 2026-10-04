// Tank-Guide — Texte und Übersetzungsregeln (docs/produkt/MICROCOPY.md).
//
// Der Guide beantwortet genau eine Frage: „Soll ich jetzt tanken?“ Die
// Antwort steht in dieser Reihenfolge im Bild: Farbe der Karte,
// Handlungs-Headline, günstigster Preis in der Nähe, Handlung. Alles
// Statistische ordnet sich dem unter und wohnt im Labor.
//
// Dieses Modul ist die **Sprachschicht** des Guides: Es rechnet Modellgrößen
// in Nutzer-Einheiten um (Euro pro Tankfüllung statt Cent je Liter,
// konkrete Uhrzeit statt Wahrscheinlichkeitsdichte) und hält die Texte der
// drei Fallback-Stufen. Es entscheidet nichts — die Entscheidung kommt aus
// `now.ts`, die Daten aus `data.ts`.
//
// Anrede folgt §1: Possessiv ist erlaubt, die direkte Anrede nicht
// („deine Tankfüllung“, nicht „du sparst“). Geprüft von
// `microcopy.test.ts` (Regel 7) — diese Datei steht dort in der Liste.

import {
  berlinHour,
  deTrimmed,
  euro,
  euroPerLiter,
  timeOfDayLabel,
  type AdviceAction,
} from "./data";

// ---------------------------------------------------------------------------
// 3-Stufen-Fallback (Graceful Degradation)
//
// Stufe 1 „full“:        Live-Preise + Prognose + Zeit-Empfehlung.
// Stufe 2 „noForecast“:  Prognose pausiert, Preise live.
// Stufe 3 „offline“:     keine Verbindung, letzter Stand aus dem Cache.
//
// Wichtig ist die Reihenfolge der Prüfung: Offline schlägt alles, denn ohne
// Verbindung sind auch die Live-Preise alt. Die Stufe wird aus echten
// Zuständen abgeleitet (Verbindung, Freigabe der Entscheidung) — nie aus
// einer Vermutung über die Antwort.
// ---------------------------------------------------------------------------
export type GuideLevel = "full" | "noForecast" | "offline";

export function guideLevel(input: {
  /** `null` = unbekannt (erster Frame) — dann gilt Stufe 1, nichts wird behauptet. */
  online: boolean | null;
  /** `decision_ready` der API: Freigabe der Empfehlung (A21-B1.4). */
  decisionReady: boolean | null;
}): GuideLevel {
  if (input.online === false) return "offline";
  if (input.decisionReady === false) return "noForecast";
  return "full";
}

/**
 * Stufe 2 und 3: was fehlt, und was trotzdem geht — in dieser Reihenfolge.
 *
 * „Zuerst sagen, was weiterhin geht, erst danach, was fehlt“ (MICROCOPY §5a).
 * Deshalb steht die Route in beiden Texten vor dem fehlenden Modell.
 */
/**
 * Sperrgründe, die **keine** Pause sind, sondern ein noch nicht
 * freigegebenes Modell (A21-B1.4). „Die Prognose macht gerade Pause“
 * verspräche hier eine Rückkehr in Minuten — tatsächlich braucht es
 * abgerechnete Empfehlungen. Der Zählstand steht in der Karte
 * (`learningNote`); das Banner nennt die Folge, nicht dieselbe Zahl
 * noch einmal (Nutzer-Feedback 16.09.2026: doppelter Lernsatz).
 */
export const LEARNING_REASONS: readonly string[] = [
  "model_not_released",
  "m7_pending",
  "quality_missing",
];

export function guideBanner(
  level: GuideLevel,
  options: {
    stand?: string | null;
    hasPrices?: boolean;
    /** `blocking_reasons` der API — entscheidet „Pause“ gegen „noch nicht freigegeben“. */
    blockingReasons?: string[] | null;
  } = {},
): {
  title: string;
  body: string;
  retry: string;
  retrying: string;
  tone: "neutral" | "warn";
} | null {
  if (level === "full") return null;
  const stand = options.stand ?? null;
  if (level === "offline") {
    return {
      title: "Offline",
      body:
        (stand ? `Stand: ${stand} Uhr. ` : "Keine Verbindung. ") +
        "Route starten und die Faustregel funktionieren weiter. " +
        "Der Preis an der Säule kann abweichen.",
      retry: "Erneut versuchen",
      retrying: "Verbinde …",
      tone: "warn",
    };
  }
  const learning = (options.blockingReasons ?? []).some((reason) =>
    LEARNING_REASONS.includes(reason),
  );
  if (learning) {
    return {
      title: "Die Prognose ist noch nicht freigegeben",
      body:
        (options.hasPrices === false
          ? "Der Preisvergleich trägt die Entscheidung."
          : "Alle Preise sind trotzdem live. ") +
        "Die Zeit-Empfehlung kommt nach der Freigabe.",
      retry: "Erneut versuchen",
      retrying: "Verbinde …",
      tone: "neutral",
    };
  }
  const tail = "Die Zeit-Empfehlung kommt zurück, sobald der Dienst wieder antwortet.";
  return {
    title: "Die Prognose macht gerade Pause",
    body:
      options.hasPrices === false ? tail : `Alle Preise sind trotzdem live. ${tail}`,
    retry: "Erneut versuchen",
    retrying: "Verbinde …",
    tone: "neutral",
  };
}


/**
 * Treffsicherheit als Zählung, nicht als Prozent: „An 26 von 30 Tagen lag
 * die Empfehlung richtig.“ Ohne Zählung wird nichts behauptet (§1: keine
 * Sicherheit, die nicht gemessen ist) — dann steht der Lernstand.
 */
export function accuracySentence(
  hits: number | null,
  days: number | null,
): string | null {
  if (hits === null || days === null || days <= 0) {
    return "Noch nicht gemessen — die ersten Empfehlungen sind Lern-Fälle.";
  }
  return `An ${hits} von ${days} Tagen lag die Empfehlung richtig.`;
}

// ---------------------------------------------------------------------------
// Geld in Nutzer-Einheiten: Euro pro Tankfüllung
//
// „−0,08 €/l“ ist eine Modellgröße. „ca. 3,60 € pro Tankfüllung“ ist die
// Antwort auf die Frage, die jemand an der Säule wirklich hat. Gerechnet
// wird mit der Tankmenge des Profils (10–100 L, `PROFILE_BOUNDS`).
// ---------------------------------------------------------------------------

/** Cent je Liter × Tankmenge → Euro pro Füllung. */
export function fillAmount(
  centDiff: number | null,
  liters: number,
): number | null {
  if (centDiff === null || !Number.isFinite(centDiff) || liters <= 0) {
    return null;
  }
  return (Math.abs(centDiff) * liters) / 100;
}

export function perFillText(amount: number | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  return `ca. ${euro(amount)} € pro Tankfüllung`;
}
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
export type DotState = "hit" | "tie" | "miss";

export function accuracyDots(input: {
  hits: number | null;
  ties?: number | null;
  total: number | null;
}): { dots: DotState[]; hits: number; ties: number; misses: number } | null {
  const total = input.total ?? 0;
  if (total <= 0) return null;
  const hits = Math.max(0, Math.min(input.hits ?? 0, total));
  const ties = Math.max(0, Math.min(input.ties ?? 0, total - hits));
  const misses = Math.max(0, total - hits - ties);
  return {
    dots: [
      ...Array.from({ length: hits }, () => "hit" as DotState),
      ...Array.from({ length: ties }, () => "tie" as DotState),
      ...Array.from({ length: misses }, () => "miss" as DotState),
    ],
    hits,
    ties,
    misses,
  };
}

// ---------------------------------------------------------------------------
// Was den Preis gerade bewegt
//
// Fachwort „Feature Importance“ → die Frage, die jemand wirklich hat.
// Die Balken tragen **nur**, was die App messen kann: Wo im Tagesspielraum
// der aktuelle Preis steht und wie weit die Stationen vor Ort auseinander
// liegen. Faktoren ohne Datenpfad (Ölpreis, Ferien) erscheinen deshalb
// **ohne** Balken und mit dem Grund — ein ausgedachter Balken wäre eine
// Erklärung, die keine ist.
// ---------------------------------------------------------------------------
export type DriverDirection = "down" | "up" | "flat";

export type PriceDriver = {
  id: string;
  label: string;
  direction: DriverDirection;
  /** Balkenlänge 0–100; `null` = kein Messwert, dann kein Balken. */
  strength: number | null;
  /** Der gemessene Wert in Alltagssprache. */
  value: string | null;
  /** Warum dieser Faktor drückt oder treibt — oder warum er fehlt. */
  note: string;
};

export const DRIVER_DIRECTION_TEXT: Record<DriverDirection, string> = {
  down: "drückt den Preis",
  up: "treibt den Preis",
  flat: "bewegt ihn kaum",
};

export const NO_MEASUREMENT_NOTE =
  "Kein Messwert in dieser Installation — die App zeigt den Faktor, aber keinen Balken.";

/**
 * Tageszeit: Wo im heutigen Spielraum liegt der Preis gerade?
 *
 * 0 % = am Tagestief (Luft ist nach oben), 100 % = am Tageshoch (Luft ist
 * nach unten). Das ist eine beobachtete Lage, keine Prognose — gerechnet
 * aus den Stunden-Minima des Tagesstreifens.
 */
export function dayPosition(input: {
  nowPrice: number | null;
  dayMin: number | null;
  dayMax: number | null;
}): number | null {
  const { nowPrice, dayMin, dayMax } = input;
  if (nowPrice === null || dayMin === null || dayMax === null) return null;
  if (![nowPrice, dayMin, dayMax].every((v) => Number.isFinite(v))) return null;
  if (dayMax <= dayMin) return null;
  const share = ((nowPrice - dayMin) / (dayMax - dayMin)) * 100;
  return Math.max(0, Math.min(100, share));
}

export function priceDrivers(input: {
  nowPrice: number | null;
  dayMin: number | null;
  dayMax: number | null;
  /** Spanne günstigste bis teuerste Station in Cent je Liter. */
  spreadCt: number | null;
}): PriceDriver[] {
  const position = dayPosition(input);
  const spread = input.spreadCt;
  return [
    {
      id: "tageszeit",
      label: "Tageszeit",
      // Oben im Spielraum heißt: Luft nach unten → drückt.
      direction:
        position === null ? "flat" : position >= 66 ? "down" : position <= 33 ? "up" : "flat",
      strength: position,
      value:
        position === null
          ? null
          : `Aktueller Preis bei ${deTrimmed(position, 0)} % des heutigen Spielraums`,
      note:
        position === null
          ? NO_MEASUREMENT_NOTE
          : position >= 66
            ? "Oben im Tagesspielraum — nach dem 12-Uhr-Sprung sinken die Preise meist wieder."
            : position <= 33
              ? "Unten im Tagesspielraum — viel tiefer ging es heute selten."
              : "Mitten im Tagesspielraum — die Uhrzeit allein bewegt gerade wenig.",
    },
    {
      id: "konkurrenz",
      label: "Auswahl vor Ort",
      direction: spread !== null && spread > 0 ? "down" : "flat",
      // 10 Cent Spanne = voller Balken; mehr Auswahl drückt den Preis.
      strength:
        spread === null || !Number.isFinite(spread) ? null : Math.min(100, (spread / 10) * 100),
      value:
        spread === null || !Number.isFinite(spread)
          ? null
          : `Günstigste bis teuerste Station: ${deTrimmed(spread, 1)} Cent auseinander`,
      note:
        spread === null || !Number.isFinite(spread)
          ? NO_MEASUREMENT_NOTE
          : "Mehr Auswahl in der Nähe drückt den Preis — der Umweg entscheidet, was netto bleibt.",
    },
    {
      id: "wochentag",
      label: "Wochentag",
      direction: "flat",
      strength: null,
      value: null,
      note: NO_MEASUREMENT_NOTE,
    },
  ];
}
