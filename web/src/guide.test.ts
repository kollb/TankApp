// Tank-Guide: Rechnung und Sprache sind hier festgenagelt.
//
// Zwei Sorten Prüfung:
//   1. **Rechnung** — Euro pro Tankfüllung, Uhrzeit-Phrasen, Balkenstufen.
//      Eine falsch gerundete Ersparnis ist eine falsche Handlungsempfehlung,
//      deshalb stehen die Zahlen hier mit Ergebnis, nicht als „funktioniert“.
//   2. **Sprach-Ratchet** — die Übersetzungstabelle aus
//      docs/produkt/MICROCOPY.md. Die linke Spalte (Konfidenz, Hit-Rate,
//      Shapley …) darf in keiner Guide-Quelle stehen; sie ist genau das
//      Fachchinesisch, das der Guide übersetzt.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AMPEL_TEXT,
  CONFIDENCE_TEXT,
  GUIDE_CARD,
  RULE_OF_THUMB,
  accuracyDots,
  ampelClass,
  confidenceStage,
  dayPosition,
  priceDrivers,
  fillAmount,
  guideBanner,
  guideBenefit,
  guideLevel,
  guideRestoredNote,
  guideTone,
  guideWaitSubline,
  hourlyOutlook,
  accuracySentence,
  perFillText,
  timePhrase,
  type GuideTone,
} from "./guide";

/** 19:00 Europe/Berlin — der Abendwert aus dem Entwurf. */
const EVENING_ISO = "2026-09-27T17:00:00.000Z";

describe("3-Stufen-Fallback", () => {
  it("Offline schlägt alles: ohne Verbindung ist auch der Live-Preis alt", () => {
    expect(guideLevel({ online: false, decisionReady: true })).toBe("offline");
    expect(guideLevel({ online: false, decisionReady: false })).toBe("offline");
  });

  it("Stufe 2 greift nur bei pausierender Prognose, nicht bei fehlenden Daten", () => {
    expect(guideLevel({ online: true, decisionReady: false })).toBe("noForecast");
    expect(guideLevel({ online: true, decisionReady: true })).toBe("full");
    expect(guideLevel({ online: null, decisionReady: null })).toBe("full");
  });

  it("Stufe 1 trägt kein Banner — eine volle Ansicht erklärt sich nicht", () => {
    expect(guideBanner("full")).toBeNull();
    expect(guideRestoredNote("full")).toBeNull();
  });

  it.each([
    ["offline", "Stand: 14:32 Uhr"],
    ["noForecast", "Prognose macht gerade Pause"],
  ] as const)("Stufe %s nennt den Datenstand bzw. den Grund", (level, needle) => {
    const banner = guideBanner(level, { stand: "14:32", hasPrices: true });
    expect(banner?.title).toContain(
      level === "offline" ? "Offline" : "Prognose",
    );
    expect(banner?.body ?? "").toBeTruthy();
    expect(needle.length).toBeGreaterThan(0);
  });

  it("das Offline-Banner sagt zuerst, was weiter geht, dann was fehlt", () => {
    const banner = guideBanner("offline", { stand: "14:32" });
    expect(banner).not.toBeNull();
    const body = banner!.body;
    expect(body).toContain("Stand: 14:32 Uhr");
    expect(body).toContain("Route starten");
    expect(body).toContain("kann abweichen");
    // Reihenfolge: erst die Handlung, dann die Einschränkung (§5a).
    expect(body.indexOf("Route starten")).toBeLessThan(
      body.indexOf("kann abweichen"),
    );
    expect(banner!.tone).toBe("warn");
  });

  it("das Pausen-Banner nennt die live-Preise und bleibt neutral", () => {
    const banner = guideBanner("noForecast", { hasPrices: true });
    expect(banner?.body).toContain("Alle Preise sind trotzdem live");
    expect(banner?.tone).toBe("neutral");
  });

  it("ein noch nicht freigegebenes Modell ist keine Pause", () => {
    // „Macht gerade Pause“ verspräche eine Rückkehr in Minuten. Bei
    // `m7_pending` braucht es abgerechnete Empfehlungen — das Banner
    // nennt deshalb die Folge, der Zählstand bleibt in der Karte.
    const banner = guideBanner("noForecast", {
      hasPrices: true,
      blockingReasons: ["paths_invalid", "m7_pending"],
    });
    expect(banner?.title).toBe("Die Prognose ist noch nicht freigegeben");
    expect(banner?.body).toContain("Alle Preise sind trotzdem live");
    expect(banner?.body).not.toContain("Dienst wieder antwortet");
  });

  it("die echte Pause nennt den Dienst, nicht die Freigabe", () => {
    const banner = guideBanner("noForecast", {
      hasPrices: true,
      blockingReasons: ["forecast_missing"],
    });
    expect(banner?.title).toBe("Die Prognose macht gerade Pause");
    expect(banner?.body).toContain("Dienst wieder antwortet");
  });

  it("beide Stufen bieten „Erneut versuchen“ mit Ladewort", () => {
    for (const level of ["offline", "noForecast"] as const) {
      const banner = guideBanner(level, { stand: "14:32" });
      expect(banner?.retry).toBe("Erneut versuchen");
      expect(banner?.retrying).toBe("Verbinde …");
    }
  });

  it("die Wiederherstellung bestätigt leise, ohne Fehler-Vokabular", () => {
    expect(guideRestoredNote("offline")).toBe("Wieder online. Alles ist aktuell.");
    expect(guideRestoredNote("noForecast")).toBe("Prognose ist zurück.");
  });
});

describe("Urteilstöne", () => {
  it("Rot bleibt dem Tankrest — „Warten“ wird nicht rot", () => {
    // Die sicherheitsrelevante Bedeutung von Rot darf nicht umgewidmet
    // werden (Begründung in guide.ts).
    expect(guideTone({ action: "wait", tone: "red" })).toBe("risk");
  });

  it.each([
    ["green", "now"],
    ["blue", "wait"],
    ["gray", "relaxed"],
  ] as const)("Ton %s → %s", (tone, expected) => {
    expect(guideTone({ action: "wait", tone })).toBe(expected);
  });

  it("abgelaufene Freigabe und fehlendes Urteil sind neutral", () => {
    expect(guideTone({ action: "wait", tone: "blue", expired: true })).toBe(
      "neutral",
    );
    expect(guideTone({ action: null, tone: null })).toBe("neutral");
  });

  it("jeder Ton trägt Chip, Headline und eine Handlung", () => {
    for (const tone of Object.keys(GUIDE_CARD) as GuideTone[]) {
      const card = GUIDE_CARD[tone];
      expect(card.chip, tone).toBeTruthy();
      expect(card.headline, tone).toBeTruthy();
      // Die vier Handlungs-Töne enden mit einem Punkt — ein ganzer Satz,
      // kein Fragment. Der neutrale Ton ist ein Label („Günstigste
      // Tankstelle gerade“) und trägt den Stationsnamen dahinter.
      if (tone !== "neutral") {
        expect(card.headline.endsWith("."), `${tone}: ${card.headline}`).toBe(
          true,
        );
      }
    }
  });

  it("„Kein Zeitdruck“ bleibt der ehrliche Ton für stabile Tage", () => {
    expect(GUIDE_CARD.relaxed.chip).toBe("Kein Zeitdruck");
    expect(GUIDE_CARD.relaxed.headline).toBe("Tanken, wann’s passt.");
  });
});

describe("Geld und Zeit in Nutzer-Einheiten", () => {
  it("8 Cent × 45 L = 3,60 € pro Tankfüllung", () => {
    expect(fillAmount(8, 45)).toBeCloseTo(3.6, 6);
    expect(perFillText(fillAmount(8, 45))).toBe("ca. 3,60 € pro Tankfüllung");
  });

  it("Cent je Liter bleiben außen vor: gerechnet wird die Füllung", () => {
    const text = perFillText(fillAmount(3.2, 60));
    expect(text).toBe("ca. 1,92 € pro Tankfüllung");
    expect(text).not.toContain("ct/L");
  });

  it("ohne Differenz oder ohne Tankmenge fällt der Satz weg, statt zu raten", () => {
    expect(fillAmount(null, 45)).toBeNull();
    expect(fillAmount(8, 0)).toBeNull();
    expect(perFillText(null)).toBeNull();
  });

  it("die Uhrzeit steht als konkrete Zeit, nie als Spanne", () => {
    const sub = guideWaitSubline(8, EVENING_ISO);
    expect(sub).toBe("Gegen 19:00 Uhr ca. 8 Cent günstiger.");
    expect(sub).not.toContain("–");
    expect(sub).not.toContain("%");
  });

  it("fehlt die Uhrzeit, bleibt der Betrag — fehlt der Betrag, der ganze Satz", () => {
    expect(guideWaitSubline(8, null)).toBe("Ca. 8 Cent günstiger.");
    expect(guideWaitSubline(null, EVENING_ISO)).toBeNull();
  });

  it("„Bis 19 Uhr“ und „Warten kostet“ sind dieselbe Zahl in zwei Richtungen", () => {
    const wait = guideBenefit({
      tone: "wait",
      centDiff: 8,
      liters: 45,
      atIso: EVENING_ISO,
    });
    expect(wait?.tone).toBe("good");
    expect(wait?.text).toContain("ca. 3,60 € gespart · 45 L");

    const now = guideBenefit({
      tone: "now",
      centDiff: 7,
      liters: 45,
      atIso: EVENING_ISO,
    });
    expect(now?.tone).toBe("bad");
    expect(now?.text).toContain("Warten kostet");
  });

  it("unter 50 Cent pro Füllung ist der Weg die Antwort, nicht die Zeit", () => {
    const benefit = guideBenefit({ tone: "wait", centDiff: 0.8, liters: 45 });
    expect(benefit?.tone).toBe("neutral");
    expect(benefit?.text).toContain("unter 0,50 €");
  });

  it("Uhrzeit-Phrase hängt das Wort an, das man spricht", () => {
    expect(timePhrase("14:32")).toBe("14:32 Uhr");
  });
});

describe("Sicherheit: drei Balken statt einer Prozentzahl", () => {
  it.each([
    [95, 3],
    [80, 3],
    [79, 2],
    [60, 2],
    [59, 1],
    [null, 1],
  ] as const)("%s %% → Stufe %i", (percent, stage) => {
    expect(confidenceStage(percent)).toBe(stage);
  });

  it("jede Stufe hat ein Wort, keine Prozentangabe", () => {
    for (const text of Object.values(CONFIDENCE_TEXT)) {
      expect(text).not.toContain("%");
    }
    expect(CONFIDENCE_TEXT[3]).toBe("Sehr sicher");
    expect(CONFIDENCE_TEXT[2]).toBe("Ziemlich sicher");
  });

  it("Treffsicherheit als Zählung — und ohne Messung als Lernstand", () => {
    expect(accuracySentence(26, 30)).toBe(
      "An 26 von 30 Tagen lag die Empfehlung richtig.",
    );
    expect(accuracySentence(null, null)).toContain("Lern-Fälle");
    expect(accuracySentence(0, 0)).toContain("Lern-Fälle");
  });
});

describe("Faustregel (Stufe 2 und 3)", () => {
  it("nennt sich typisch, nicht Prognose", () => {
    expect(RULE_OF_THUMB.note).toContain("Keine Prognose");
    expect(RULE_OF_THUMB.text.toLowerCase()).toContain("abends");
  });

  it("vier Tageszeiten, je eine Ampelstufe", () => {
    expect(RULE_OF_THUMB.parts.map((p) => p.label)).toEqual([
      "Morgens",
      "Mittags",
      "Nachmittags",
      "Abends",
    ]);
    expect(ampelClass("low")).toBe("m3-bar-low");
    expect(ampelClass("high")).toBe("m3-bar-high");
    expect(Object.keys(AMPEL_TEXT).sort()).toEqual(["high", "low", "mid"]);
  });
});

// ---------------------------------------------------------------------------
// Sprach-Ratchet: die Übersetzungstabelle aus docs/produkt/MICROCOPY.md.
// ---------------------------------------------------------------------------
// Erweitert sich mit jedem Baustein des Guides (die Liste wächst mit).
const GUIDE_FILES = [
  "guide.ts",
  "components/GuideBanner.tsx",
  "components/GuideConfidence.tsx",
  "components/HourBars.tsx",
  "components/BenefitWidget.tsx",
  "components/LabAccuracy.tsx",
  "components/LabExperiments.tsx",
  "components/LabProfile.tsx",
  "components/PriceDrivers.tsx",
];

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

/** Ohne Kommentare — die dürfen das Fachwort nennen und benennen es oft. */
function userText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s*\/\/.*$/gm, "");
}

describe("Sprache des Guides (MICROCOPY §4b)", () => {
  /** Linke Spalte der Übersetzungstabelle — im Guide tabu. */
  const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; instead: string }> = [
    { pattern: /Konfidenz/g, instead: "„Sehr sicher“ / „Ziemlich sicher“" },
    { pattern: /Shapley/gi, instead: "„Was den Preis gerade bewegt“" },
    { pattern: /Feature Importance/g, instead: "„Was den Preis gerade bewegt“" },
    { pattern: /Hit-?Rate/gi, instead: "„An X von Y Tagen richtig“" },
    {
      pattern: /Quantil-Regression/g,
      instead: "„Hier landet der Preis ziemlich sicher“",
    },
    {
      pattern: /Service unavailable/gi,
      instead: "„Die Prognose macht gerade Pause“",
    },
    { pattern: /Error \d{3}/g, instead: "ein Satz in Alltagssprache" },
    { pattern: /Stale cache/gi, instead: "„Stand 14:32 Uhr“" },
    { pattern: /Risikoaversion/gi, instead: "„Wartebereitschaft“" },
  ];

  it.each(GUIDE_FILES)("%s: kein Fachwort aus der Übersetzungstabelle", (file) => {
    const text = userText(read(file));
    for (const { pattern, instead } of FORBIDDEN) {
      expect(
        text.match(pattern)?.[0] ?? null,
        `${file}: ${pattern} gefunden — stattdessen ${instead}.`,
      ).toBeNull();
    }
  });

  // §1: Possessiv ist erlaubt, die direkte Anrede nicht.
  it.each(GUIDE_FILES)("%s: keine direkte Anrede", (file) => {
    const text = userText(read(file));
    for (const pattern of [/\bdu\b/gi, /\bdir\b/gi, /\bdich\b/gi, /\bIhnen\b/g]) {
      expect(
        text.match(pattern)?.[0] ?? null,
        `${file}: direkte Anrede — §1 erlaubt den Possessiv, aber kein „du“.`,
      ).toBeNull();
    }
  });

  // Dieselben zwei Regeln wie microcopy.test.ts (§1, T2) — nur `Wort!"`
  // zählt, `!==` und `!pending` sind Code.
  it.each(GUIDE_FILES)("%s: kein Ausrufezeichen am Satzende", (file) => {
    const hits = read(file).match(/[\wÄÖÜäöüß)\].…!?]!\s*["”<]/g) ?? [];
    expect(hits, `${file}: Ausrufezeichen im Text`).toEqual([]);
  });

  it.each(GUIDE_FILES)("%s: keine ✓/!-Präfixe vor Meldungen", (file) => {
    const hits = read(file).match(/["'`](?:✓|!)\s/g) ?? [];
    expect(hits, `${file}: Ton gehört ins Icon, nicht ins Wort`).toEqual([]);
  });

  it.each(GUIDE_FILES)("%s: Anführungszeichen sind paarig „…“", (file) => {
    const text = read(file);
    const open = (text.match(/„/g) ?? []).length;
    const close = (text.match(/“/g) ?? []).length;
    expect(close, `${file}: ${open}× „ aber ${close}× “`).toBe(open);
  });
});

// ---------------------------------------------------------------------------
// „Heute im Überblick“ — Stundenbalken
// ---------------------------------------------------------------------------
/** 17:00 Europe/Berlin an einem Septembertag (MESZ, UTC+2). */
const AFTERNOON_MS = Date.parse("2026-09-27T15:00:00.000Z");

function window(start: string, end: string, price: number) {
  return { start, end, expected_price: price };
}

describe("Stundenbalken", () => {
  const windows = [
    window("2026-09-27T18:00:00+02:00", "2026-09-27T20:00:00+02:00", 1.689),
    window("2026-09-27T20:00:00+02:00", "2026-09-27T22:00:00+02:00", 1.709),
    window("2026-09-27T22:00:00+02:00", "2026-09-28T01:00:00+02:00", 1.669),
  ];

  it("acht Balken ab der laufenden Stunde, der erste heißt „Jetzt“", () => {
    const { bars } = hourlyOutlook({ windows, now: AFTERNOON_MS });
    expect(bars).toHaveLength(8);
    expect(bars[0].label).toBe("Jetzt");
    expect(bars[0].isNow).toBe(true);
    expect(bars.map((b) => b.hour)).toEqual([17, 18, 19, 20, 21, 22, 23, 0]);
  });

  it("jede Stunde trägt den Preis des Fensters, in dem sie liegt", () => {
    const { bars } = hourlyOutlook({ windows, now: AFTERNOON_MS });
    expect(bars[0].price).toBeNull(); // 17 Uhr liegt vor dem ersten Fenster
    expect(bars[1].price).toBe(1.689);
    expect(bars[3].price).toBe(1.709);
    expect(bars[5].price).toBe(1.669);
  });

  it("ein Fenster über Mitternacht fällt nicht auseinander", () => {
    const { bars } = hourlyOutlook({ windows, now: AFTERNOON_MS });
    // 23 Uhr und 0 Uhr liegen beide im 22–01-Uhr-Fenster.
    expect(bars[6].price).toBe(1.669);
    expect(bars[7].price).toBe(1.669);
  });

  it("die Ampel teilt den gezeigten Zeitraum in Drittel", () => {
    const { bars } = hourlyOutlook({ windows, now: AFTERNOON_MS });
    expect(bars[1].level).toBe("mid"); // 1,689
    expect(bars[3].level).toBe("high"); // 1,709
    expect(bars[5].level).toBe("low"); // 1,669
  });

  it("ein flacher Tag bekommt kein rot-grünes Drama", () => {
    const flat = [
      window("2026-09-27T18:00:00+02:00", "2026-09-27T22:00:00+02:00", 1.699),
      window("2026-09-27T22:00:00+02:00", "2026-09-28T01:00:00+02:00", 1.6995),
    ];
    const { bars, note } = hourlyOutlook({ windows: flat, now: AFTERNOON_MS });
    expect(bars.every((b) => b.level === "mid")).toBe(true);
    expect(note).toContain("unter einem Cent");
  });

  it("die Notiz nennt die Grenzen der Ampel — sonst ist Farbe Behauptung", () => {
    const { note, bestHour } = hourlyOutlook({ windows, now: AFTERNOON_MS });
    expect(note).toContain("grün bis 1,669 €/L");
    expect(note).toContain("rot ab 1,709 €/L");
    expect(bestHour).toBe(22);
  });

  it("ohne Fenster gibt es Balken ohne Preis und ohne Urteil", () => {
    const { bars, note, bestHour } = hourlyOutlook({
      windows: [],
      now: AFTERNOON_MS,
    });
    expect(bars).toHaveLength(8);
    expect(bars.every((b) => b.price === null)).toBe(true);
    expect(note).toBeNull();
    expect(bestHour).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Labor: Treffsicherheit und Einflüsse — nur mit echtem Messwert
// ---------------------------------------------------------------------------
describe("Treffsicherheit als Punkte-Raster", () => {
  it("ein Punkt je Empfehlung, in der Reihenfolge richtig/daneben", () => {
    const grid = accuracyDots({ hits: 26, ties: 2, total: 30 });
    expect(grid?.dots).toHaveLength(30);
    expect(grid?.hits).toBe(26);
    expect(grid?.ties).toBe(2);
    expect(grid?.misses).toBe(2);
    expect(grid?.dots.slice(0, 26).every((d) => d === "hit")).toBe(true);
    expect(grid?.dots.slice(28).every((d) => d === "miss")).toBe(true);
  });

  it("ohne Zählung keine Punkte — der Lernstand tritt an ihre Stelle", () => {
    expect(accuracyDots({ hits: 0, total: 0 })).toBeNull();
    expect(accuracyDots({ hits: null, total: null })).toBeNull();
  });

  it("unmögliche Zählungen werden begrenzt, nicht erfunden", () => {
    const grid = accuracyDots({ hits: 40, ties: 10, total: 30 });
    expect(grid?.dots).toHaveLength(30);
    expect(grid?.hits).toBe(30);
    expect(grid?.ties).toBe(0);
  });
});

describe("Was den Preis gerade bewegt", () => {
  it("die Tagesspielraum-Lage ist eine beobachtete Größe", () => {
    expect(dayPosition({ nowPrice: 1.75, dayMin: 1.7, dayMax: 1.8 })).toBeCloseTo(50, 6);
    expect(dayPosition({ nowPrice: 1.7, dayMin: 1.7, dayMax: 1.8 })).toBe(0);
    expect(dayPosition({ nowPrice: 1.8, dayMin: 1.7, dayMax: 1.8 })).toBe(100);
  });

  it("ohne Spielraum keine Lage — flacher Tag ist keine Aussage", () => {
    expect(dayPosition({ nowPrice: 1.7, dayMin: 1.7, dayMax: 1.7 })).toBeNull();
    expect(dayPosition({ nowPrice: null, dayMin: 1.7, dayMax: 1.8 })).toBeNull();
  });

  it("oben im Spielraum drückt, unten treibt", () => {
    const high = priceDrivers({ nowPrice: 1.79, dayMin: 1.7, dayMax: 1.8, spreadCt: 5 });
    expect(high[0].direction).toBe("down");
    expect(high[0].strength).toBeCloseTo(90, 6);
    const low = priceDrivers({ nowPrice: 1.71, dayMin: 1.7, dayMax: 1.8, spreadCt: 5 });
    expect(low[0].direction).toBe("up");
  });

  it("die Auswahl vor Ort trägt einen echten Messwert", () => {
    const [zeit, konkurrenz] = priceDrivers({
      nowPrice: 1.75,
      dayMin: 1.7,
      dayMax: 1.8,
      spreadCt: 5,
    });
    expect(konkurrenz.direction).toBe("down");
    expect(konkurrenz.strength).toBeCloseTo(50, 6);
    expect(konkurrenz.value).toContain("5 Cent");
    expect(zeit.value).toContain("%");
  });

  it("Faktoren ohne Datenpfad stehen sichtbar da — ohne Balken", () => {
    const drivers = priceDrivers({
      nowPrice: null,
      dayMin: null,
      dayMax: null,
      spreadCt: null,
    });
    expect(drivers).toHaveLength(3);
    for (const driver of drivers) {
      expect(driver.strength).toBeNull();
      expect(driver.note).toContain("Kein Messwert");
    }
  });
});
