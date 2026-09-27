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
  deTrimmed,
  euro,
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
export function guideBanner(
  level: GuideLevel,
  options: { stand?: string | null; hasPrices?: boolean } = {},
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

/** Wiederherstellung: leise zurück in Stufe 1, eine Zeile Bestätigung. */
export function guideRestoredNote(level: GuideLevel): string | null {
  if (level === "offline") return "Wieder online. Alles ist aktuell.";
  if (level === "noForecast") return "Prognose ist zurück.";
  return null;
}

// ---------------------------------------------------------------------------
// Urteilstöne der Entscheidungskarte
//
// **Eine Farbe, eine Bedeutung — und die bestehende Bedeutung gewinnt.**
// Der Entwurf ordnet „Warten“ Rot zu. In dieser App trägt Rot bereits eine
// andere, sicherheitsrelevante Aussage: „Warten ist riskant, die Reserve
// reicht nicht bis zum Fenster“ (UI-Neugestaltung 2026-09-26). „Warten,
// weil es günstiger wird“ ist blau. Wer Rot umwidmet, verliert den einzigen
// Ton, der vor einer leeren Reserve warnt. Deshalb bleibt die Tabelle der
// Töne, wie sie ist, und der Entwurf wird darauf abgebildet:
//
//   Entwurf „Rot = besser warten“   → Ton `wait` (blau): „Besser warten.“
//   Entwurf „Blau = kein Zeitdruck“ → Ton `relaxed` (grau): „Tanken, wann’s passt.“
//   Ton `risk` (rot) bleibt unangetastet.
// ---------------------------------------------------------------------------
export type GuideTone = "now" | "wait" | "relaxed" | "risk" | "neutral";

export function guideTone(input: {
  action: AdviceAction | null | undefined;
  tone: "green" | "blue" | "red" | "gray" | null | undefined;
  expired?: boolean;
}): GuideTone {
  if (input.expired) return "neutral";
  if (input.tone === "red") return "risk";
  if (input.tone === "green") return "now";
  if (input.tone === "blue") return "wait";
  if (input.tone === "gray") return "relaxed";
  return "neutral";
}

/** M3-Flächenklasse je Ton (styles.css) — ein Ton, eine Klasse. */
export const GUIDE_TONE_CLASS: Record<
  GuideTone,
  { card: string; chip: string; button: string }
> = {
  now: { card: "m3-now", chip: "m3-chip-now", button: "m3-btn-now" },
  wait: { card: "m3-relaxed", chip: "m3-chip-relaxed", button: "m3-btn-relaxed" },
  relaxed: { card: "m3-neutral", chip: "m3-chip-neutral", button: "m3-btn-tonal" },
  risk: { card: "m3-wait", chip: "m3-chip-wait", button: "m3-btn-wait" },
  neutral: { card: "m3-neutral", chip: "m3-chip-neutral", button: "m3-btn-tonal" },
};

/** Sprachebene der 3-Stufen-Fallback: Stufe 2 macht die Karte neutral. */
export function guideCardClass(tone: GuideTone, level: GuideLevel): string {
  if (level !== "full") return "m3-neutral";
  return GUIDE_TONE_CLASS[tone].card;
}

export const GUIDE_CARD: Record<
  GuideTone,
  { chip: string; headline: string; sub: string | null }
> = {
  now: {
    chip: "Beste Zeit heute",
    headline: "Jetzt tanken.",
    sub: "Günstiger wird’s heute nicht mehr.",
  },
  wait: {
    chip: "Geduld lohnt sich",
    headline: "Besser warten.",
    // Die Subline rechnet die Uhrzeit und den Cent-Betrag ein
    // (`guideWaitSubline`) — zwei Zahlen, ein Satz, keine Spanne.
    sub: null,
  },
  relaxed: {
    chip: "Kein Zeitdruck",
    headline: "Tanken, wann’s passt.",
    sub: "Die Preise bewegen sich heute kaum. Der kürzere Weg spart mehr als das Warten.",
  },
  risk: {
    chip: "Reserve wird knapp",
    headline: "Jetzt tanken.",
    sub: "Warten ist heute keine Option: Die Reserve reicht nicht bis zum günstigen Fenster.",
  },
  neutral: {
    chip: "Keine Zeit-Empfehlung",
    headline: "Günstigste Tankstelle gerade",
    sub: null,
  },
};

/**
 * „Gegen 19 Uhr wird’s ca. 8 Cent günstiger.“ — eine Uhrzeit, ein Betrag.
 *
 * Keine Spanne („18–20 Uhr“) und keine Wahrscheinlichkeitsdichte: Beides
 * beantwortet die Frage „Soll ich jetzt tanken?“ nicht in einer Sekunde.
 * Fehlt eines der beiden Stücke, fällt der Satz weg, statt zu raten.
 */
export function guideWaitSubline(
  centDiff: number | null,
  atIso: string | null,
): string | null {
  if (centDiff === null || !Number.isFinite(centDiff)) return null;
  const time = timeOfDayLabel(atIso);
  const amount = deTrimmed(Math.abs(centDiff), 0);
  if (!time) return `Ca. ${amount} Cent günstiger.`;
  return `Gegen ${timePhrase(time)} ca. ${amount} Cent günstiger.`;
}

/** „14:32“ → „14:32 Uhr“; die Minute bleibt, wenn sie gesetzt ist. */
export function timePhrase(timeOfDay: string): string {
  return `${timeOfDay} Uhr`;
}

// ---------------------------------------------------------------------------
// Sicherheit: drei Balken statt einer Prozentzahl
//
// „Prognose-Konfidenz: 87 %“ liest niemand und prüft niemand nach. Drei
// Balken mit einem Wort sind in derselben Sekunde erfasst. Die Stufe kommt
// aus der gemessenen Zahl, das Wort ist bewusst grob — feiner wäre eine
// Genauigkeit, die das Modell nicht hat.
// ---------------------------------------------------------------------------
export type ConfidenceStage = 1 | 2 | 3;

export function confidenceStage(percent: number | null): ConfidenceStage {
  if (percent === null || !Number.isFinite(percent)) return 1;
  if (percent >= 80) return 3;
  if (percent >= 60) return 2;
  return 1;
}

export const CONFIDENCE_TEXT: Record<ConfidenceStage, string> = {
  3: "Sehr sicher",
  2: "Ziemlich sicher",
  1: "Kaum einschätzbar",
};

/**
 * Treffsicherheit als Zählung, nicht als Prozent: „An 26 von 30 Tagen lag
 * die Empfehlung richtig.“ Ohne Zählung wird nichts behauptet (§1: keine
 * Sicherheit, die nicht gemessen ist) — dann steht der Lernhinweis.
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

/**
 * „Was bringt Warten?“ — dieselbe Zahl in beiden Richtungen: Sparen beim
 * Warten, Mehrkosten beim sofortigen Tanken. Unter einem Euro pro Füllung
 * ist die Antwort nicht die Zeit, sondern der Weg — das sagt der Text dann
 * auch, statt eine Ersparnis aufzublasen, die niemand merkt.
 */
export function guideBenefit(input: {
  tone: GuideTone;
  /** Erwartete Differenz zum Zielzeitpunkt in Cent je Liter (positiv = teurer). */
  centDiff: number | null;
  liters: number;
  atIso?: string | null;
}): { text: string; tone: "good" | "bad" | "neutral" } | null {
  const amount = fillAmount(input.centDiff, input.liters);
  if (amount === null) return null;
  if (amount < 0.5) {
    return {
      text: "Heute bringt Warten kaum etwas: unter 0,50 € pro Tankfüllung. Der kürzere Weg zählt mehr.",
      tone: "neutral",
    };
  }
  const money = `ca. ${euro(amount)} €`;
  const time = input.atIso ? timeOfDayLabel(input.atIso) : null;
  if (input.tone === "wait") {
    return {
      text: time
        ? `Bis ${timePhrase(time)}: ${money} gespart · ${deTrimmed(input.liters, 0)} L`
        : `${money} gespart · ${deTrimmed(input.liters, 0)} L`,
      tone: "good",
    };
  }
  return {
    text: time
      ? `Warten kostet bis ${timePhrase(time)} ${money} mehr · ${deTrimmed(input.liters, 0)} L`
      : `Warten kostet ${money} mehr · ${deTrimmed(input.liters, 0)} L`,
    tone: "bad",
  };
}

// ---------------------------------------------------------------------------
// Faustregel (Stufe 2 und 3)
//
// Fehlt die Prognose, bleibt eine Karte sichtbar, die immer gilt: der
// typische Tagesverlauf. Sie ist ausdrücklich als „typisch“ beschriftet —
// eine Faustregel ist keine Prognose und darf nie so aussehen.
// ---------------------------------------------------------------------------
export type DayPartLevel = "low" | "mid" | "high";

export const RULE_OF_THUMB = {
  title: "Faustregel für heute",
  text: "Abends zwischen 18 und 22 Uhr ist Tanken meist am günstigsten, morgens am teuersten.",
  note: "Typischer Verlauf der letzten 8 Wochen. Keine Prognose für heute — gilt auch ohne Verbindung.",
  parts: [
    { label: "Morgens", level: "high" as DayPartLevel },
    { label: "Mittags", level: "mid" as DayPartLevel },
    { label: "Nachmittags", level: "mid" as DayPartLevel },
    { label: "Abends", level: "low" as DayPartLevel },
  ],
};

/** Ampel-Klasse eines Stunden- oder Tageszeit-Balkens (styles.css). */
export function ampelClass(level: DayPartLevel): string {
  if (level === "low") return "m3-bar-low";
  if (level === "mid") return "m3-bar-mid";
  return "m3-bar-high";
}

export const AMPEL_TEXT: Record<DayPartLevel, string> = {
  low: "Tiefpreis",
  mid: "Mittel",
  high: "Hochpreis",
};

// ---------------------------------------------------------------------------
// „Warum?“ — drei Sätze, kein Fachwort
// ---------------------------------------------------------------------------
export const WHY_SHEET = {
  title: (headline: string) => `Warum „${headline}“?`,
  intro: "Kurz erklärt — ohne Fachwörter.",
  confidenceLabel: "So sicher ist die Empfehlung",
  open: "Warum?",
};
