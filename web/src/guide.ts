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
