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

/**
 * M3-Flächenklasse je Ton (styles.css) — ein Ton, eine Klasse.
 *
 * Noch nicht an der Entscheidungskarte verdrahtet: Die Karte trägt ihre
 * bewährten Ton-Klassen (`CARD_TONE` in `views/Jetzt.tsx`). Ein Wechsel
 * färbt auch alle Kindelemente um und braucht eine Sichtprüfung im
 * Browser (dokumentierte Grenze: LUECKEN, „M3-Kartenflächen der
 * Entscheidung“). Banner, Chips und Balken nutzen die Rollen bereits.
 */
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

// Seit dem 01.04.2026 darf der Preis nur noch um 12:00 Uhr steigen, Senkungen
// sind jederzeit erlaubt (`app/law.py`). Der Tag hat deshalb ein festes Muster:
// bis 12 Uhr fällt der Preis, um 12 Uhr springt er, danach schmilzt er wieder.
// Das alte „abends ist es am günstigsten“ beschrieb die Zeit davor — belegt in
// `analysis/noon_rule_check.py`. Die Faustregel behauptet nur dieses
// gesetzlich erzwungene Muster, keine gemessene Zahl.
export const RULE_OF_THUMB = {
  title: "Faustregel für heute",
  text: "Kurz vor 12 Uhr ist Tanken meist am günstigsten, direkt nach 12 Uhr am teuersten — danach sinken die Preise wieder.",
  note: "Seit 01.04.2026 dürfen Tankstellen nur noch um 12 Uhr erhöhen. Typischer Verlauf. Keine Prognose für heute — gilt auch ohne Verbindung.",
  parts: [
    { label: "Vormittag", level: "low" as DayPartLevel },
    { label: "Nach 12", level: "high" as DayPartLevel },
    { label: "Nachmittag", level: "mid" as DayPartLevel },
    { label: "Abend", level: "mid" as DayPartLevel },
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

// ---------------------------------------------------------------------------
// „Heute im Überblick“ — die nächsten Stunden als Balken
//
// Acht Stunden, acht Balken: Grün = Tiefpreis, Gelb = Mittel, Rot =
// Hochpreis. Keine Achse, kein Gitter, keine Kurve — die Frage ist nicht
// „Wie genau ist der Verlauf?“, sondern „Wann ist es günstig?“.
//
// Die Preise kommen aus den **Fenstern der Entscheidung** (`windows_today`):
// jede Stunde trägt den erwarteten Preis des Fensters, in dem sie liegt.
// Damit bleibt die Prognose eine einzige Quelle und der Guide braucht
// keinen zweiten Aufruf — die 1-Sekunden-Regel gilt auch fürs Laden.
//
// Die Ampel bewertet die Höhe **im gezeigten Zeitraum** und nennt ihre
// Grenzen darunter. Eine absolute Skala würde an einem ruhigen Tag aus
// 0,3 Cent Unterschied ein rot-grünes Drama machen.
// ---------------------------------------------------------------------------
export type HourBar = {
  /** Berliner Stunde (0–24, „24“ = Mitternacht). */
  hour: number;
  /** Achsen-Text: „Jetzt“ für die laufende Stunde, sonst die Stunde. */
  label: string;
  /** Erwarteter Preis in €/L — `null`, wenn die Stunde nicht belegt ist. */
  price: number | null;
  level: DayPartLevel;
  isNow: boolean;
};

export type HourOutlook = {
  bars: HourBar[];
  /** Nennt die Grenzen der Ampel — sonst ist die Farbe eine Behauptung. */
  note: string | null;
  /** Stunde mit dem niedrigsten erwarteten Preis (für die Hervorhebung). */
  bestHour: number | null;
};

export function hourlyOutlook(input: {
  windows:
    | Array<{ start: string; end: string; expected_price: number | null }>
    | null
    | undefined;
  now: number;
  hours?: number;
}): HourOutlook {
  const hours = input.hours ?? 8;
  const windows = (input.windows ?? []).filter(
    (w) => w.expected_price !== null && Number.isFinite(w.expected_price),
  );
  const nowHour = berlinHour(new Date(input.now));
  const bars: HourBar[] = Array.from({ length: hours }, (_, i) => {
    const hour = Math.floor(nowHour) + i;
    const clock = hour % 24;
    const price = priceForHour(windows, hour);
    return {
      hour: clock,
      label: i === 0 ? "Jetzt" : String(clock).padStart(2, "0"),
      price,
      level: "mid" as DayPartLevel,
      isNow: i === 0,
    };
  });
  const values = bars
    .map((b) => b.price)
    .filter((p): p is number => p !== null);
  if (values.length === 0) return { bars, note: null, bestHour: null };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  // `spread` ist €/L, die Schwelle liegt bei einem **Cent**: Unter einem
  // Cent Unterschied ist „teuer“ eine Erfindung — dann tragen alle Balken
  // dieselbe mittlere Stufe, und der Text sagt warum.
  const flat = spread * 100 < 1;
  for (const bar of bars) {
    if (bar.price === null) continue;
    bar.level = flat
      ? "mid"
      : bar.price <= min + spread / 3
        ? "low"
        : bar.price >= min + (spread * 2) / 3
          ? "high"
          : "mid";
  }
  const best = bars.reduce<HourBar | null>((acc, bar) => {
    if (bar.price === null) return acc;
    if (acc === null || acc.price === null) return bar;
    return bar.price < acc.price ? bar : acc;
  }, null);
  return {
    bars,
    note: flat
      ? "Alle Balken gleich: die nächsten Stunden liegen unter einem Cent auseinander."
      : `Ampel im gezeigten Zeitraum: grün bis ${euroPerLiter(min)}, rot ab ${euroPerLiter(max)}.`,
    bestHour: best?.hour ?? null,
  };
}

/**
 * Erwarteter Preis der Stunde — aus dem Fenster, in dem die Stunde liegt.
 *
 * Stunden zählen fortlaufend (23, 24, 25 …), damit ein Fenster über
 * Mitternacht nicht auseinanderfällt; der Fenstervergleich rechnet deshalb
 * beide Grenzen in „Stunden seit Berliner Tagesbeginn“ um.
 */
function priceForHour(
  windows: Array<{ start: string; end: string; expected_price: number | null }>,
  hour: number,
): number | null {
  for (const w of windows) {
    const start = berlinHour(new Date(w.start));
    let end = berlinHour(new Date(w.end));
    if (end <= start) end += 24;
    const h = hour < start ? hour + 24 : hour;
    if (h >= start && h < end) return w.expected_price;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Treffsicherheit — ein Punkt je Empfehlung
//
// „Backtest Hit-Rate 86,7 %“ ist eine Kennzahl für ein Paper. Ein Punkt
// je Empfehlung ist ein Bild: grün = richtig, grau = daneben, hellgrau =
// unentschieden. Die Zahlen kommen aus dem Advice-Ledger
// (`personal_stats.advice`) — ohne Zählung gibt es keine Punkte und
// stattdessen den Lernstand (O18: kein Dauertext ohne Datenpfad).
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
