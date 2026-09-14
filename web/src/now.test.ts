// Jetzt (UI-NEUENTWURF §5.1, §7, §10): die reine Logik der ersten Ansicht.
//
// Der Test hält die drei Versprechen des Entwurfs fest, die man später still
// brechen würde: immer vier mögliche Ausgänge, immer genau drei Fakten in
// derselben Reihenfolge, und Prozent ausschließlich auf Stufe A (≥ 100
// abgeschlossene Empfehlungen, Brier unter der Schwelle).

import { describe, expect, it } from "vitest";
import type { DecideResult, Station } from "./data";
import { M7_MIN_RECOMMENDATIONS } from "./data";
import {
  confidenceWord,
  dayLabel,
  learningNote,
  nowExplanation,
  nowFacts,
  nowFreshness,
  nowStage,
  nowSteps,
  nowVerdict,
  savingPerLiterCt,
  stageProgressNote,
} from "./now";

const NOW = Date.parse("2026-09-14T12:00:00+02:00");
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

function station(id: string, overrides: Partial<Station> = {}): Station {
  return {
    station_id: id,
    city: "Frankfurt",
    name: `Station ${id}`,
    brand: "ARAL",
    fuel: "e10",
    maps_url: null,
    dist_km: 1,
    dist_mode: "road",
    price: 1.749,
    last_price: 1.749,
    status: "open",
    fresh: true,
    observed_at: minutesAgo(4),
    age_minutes: 4,
    ...overrides,
  };
}

function decide(
  action: DecideResult["primary"]["action"],
  overrides: Partial<DecideResult> = {},
  primary: Partial<DecideResult["primary"]> = {},
): DecideResult {
  return {
    primary: {
      action,
      station: {
        id: "aral",
        name: "Aral Mitte",
        price_now: 1.749,
        maps_url: null,
      },
      recommended_window: {
        start: "2026-09-14T18:00:00+02:00",
        end: "2026-09-14T20:00:00+02:00",
        expected_price: 1.709,
      },
      expected_saving_eur: 1.6,
      p_correct: 0.82,
      confidence_badge: "high",
      reason_short: "Der Preis fällt hier abends meist.",
      ...primary,
    },
    alternatives_nearby: [],
    windows_today: [
      {
        start: "2026-09-14T18:00:00+02:00",
        end: "2026-09-14T20:00:00+02:00",
        expected_price: 1.709,
        expected_saving_eur: 1.6,
        p: 0.82,
      },
    ],
    windows_week: [],
    episode: { id: "e1", status: "open", intent: "none" },
    personal_stats: {
      advice: {
        last_30d_hits: 42,
        last_30d_total: 120,
        hit_rate: 0.78,
        brier_30d: 0.2,
      },
      wallet: { fills_30d: 4, followed: 3, saved_eur_30d: 12.4 },
    },
    calibrated: true,
    decision_ready: true,
    tank: null,
    ...overrides,
  };
}

const input = (overrides: Partial<Parameters<typeof nowVerdict>[0]> = {}) => ({
  decide: decide("wait"),
  stations: [station("aral"), station("shell", { price: 1.689, brand: "SHELL" })],
  selectedId: "aral",
  liters: 40,
  now: NOW,
  ...overrides,
});

describe("Stufen der Sicherheit (§10)", () => {
  it("Stufe A nur mit Kalibrierung, Stufe C ohne Empfehlung", () => {
    expect(nowStage(decide("wait"))).toBe("A");
    expect(nowStage(decide("wait", { calibrated: false }))).toBe("B");
    expect(nowStage(decide("no_advice", { calibrated: false }))).toBe("C");
    expect(nowStage(null)).toBe("C");
  });

  it("Worte kommen aus dem Badge, nie geraten", () => {
    expect(confidenceWord("high")).toBe("ziemlich sicher");
    expect(confidenceWord("medium")).toBe("eher sicher");
    expect(confidenceWord("low")).toBe("unsicher");
    expect(confidenceWord(null)).toBeNull();
  });

  it("Stufe B nennt den Fortschritt, ohne Prozent zu zeigen", () => {
    const schenke = decide("wait", { calibrated: false });
    schenke.personal_stats.advice.last_30d_total = 12;
    const note = stageProgressNote(schenke);
    expect(note).toContain(`Noch ${M7_MIN_RECOMMENDATIONS - 12} abgeschlossene`);
    const verdict = nowVerdict(input({ decide: schenke }));
    expect(verdict?.percent).toBeNull();
    expect(verdict?.word).toBe("ziemlich sicher");
    expect(verdict?.stageNote).toBe(note);
  });

  it("der graue Anfangszustand nennt den Zählstand statt eines Versprechens", () => {
    const learning = decide("no_advice", { calibrated: false });
    learning.personal_stats.advice.last_30d_total = 12;
    expect(learningNote(learning)).toContain("Das Modell lernt noch");
    const verdict = nowVerdict(input({ decide: learning }));
    expect(verdict?.detail).toContain("Das Modell lernt noch");
    expect(verdict?.percent).toBeNull();
  });
});

describe("Ampel-Karte 2.0: vier Ausgänge", () => {
  it("Warten nennt Fenster, Ersparnis und Sicherheit", () => {
    const verdict = nowVerdict(input());
    expect(verdict?.action).toBe("wait");
    expect(verdict?.tone).toBe("green");
    expect(verdict?.headline).toBe("Warten bis 18–20 Uhr");
    expect(verdict?.amount).toContain("günstiger");
    expect(verdict?.amount).toContain("4,0 ct/L");
    expect(verdict?.amount).toContain("1,60 €");
    expect(verdict?.detail).toContain("bei 40 L");
    expect(verdict?.detail).toContain("ziemlich sicher (82 %)");
  });

  it("Jetzt tanken zeigt den Preis, ohne Sicherheit zu erfinden", () => {
    const verdict = nowVerdict(
      input({
        decide: decide("refuel_now", { calibrated: false }, { p_correct: null }),
      }),
    );
    expect(verdict?.headline).toBe("Jetzt tanken");
    expect(verdict?.amount).toBe("1,749 €/L");
    expect(verdict?.percent).toBeNull();
    expect(verdict?.detail).not.toContain("%");
  });

  it("Woanders tanken nennt die beste lohnende Alternative", () => {
    const withAlt = decide("refuel_elsewhere");
    withAlt.alternatives_nearby = [
      {
        station_id: "free",
        name: "Freie Nord",
        brand: "",
        price: 1.679,
        delta_ct: 7,
        detour_km: 2.4,
        net_eur: 0.8,
        worth_it: true,
        verdict: "worth",
      },
      {
        station_id: "far",
        name: "Weit weg",
        brand: "",
        price: 1.6,
        delta_ct: 14.9,
        detour_km: 12,
        net_eur: -1.2,
        worth_it: false,
        verdict: "not_worth",
      },
    ];
    const verdict = nowVerdict(input({ decide: withAlt }));
    expect(verdict?.tone).toBe("blue");
    expect(verdict?.headline).toContain("Freie Nord");
    expect(verdict?.headline).not.toContain("Weit weg");
    expect(verdict?.amount).toContain("netto 0,80 € günstiger");
  });

  it("Keine Empfehlung bleibt grau und behauptet keine Sicherheit", () => {
    const verdict = nowVerdict(
      input({
        decide: decide("no_advice", {}, { reason_short: "Die Preise springen." }),
      }),
    );
    expect(verdict?.tone).toBe("gray");
    expect(verdict?.headline).toBe("Keine klare Empfehlung");
    expect(verdict?.amount).toBeNull();
    expect(verdict?.percent).toBeNull();
  });

  it("ohne Daten gibt es nichts zu sagen", () => {
    expect(nowVerdict(input({ decide: null }))).toBeNull();
  });
});

describe("Drei Fakten, feste Reihenfolge", () => {
  it("nennt genau Jetzt hier · Bestes Fenster heute · Tank reicht?", () => {
    const facts = nowFacts(input());
    expect(facts.map((f) => f.label)).toEqual([
      "Jetzt hier",
      "Bestes Fenster heute",
      "Tank reicht?",
    ]);
  });

  it("Jetzt hier folgt der Auswahl, sonst dem günstigsten Preis", () => {
    const chosen = nowFacts(input()).at(0);
    expect(chosen?.detail).toContain("Station aral");
    expect(chosen?.value).toBe("1,749 €/L");
    const cheapest = nowFacts(input({ selectedId: "unbekannt" })).at(0);
    expect(cheapest?.value).toBe("1,689 €/L");
  });

  it("ohne Preis steht „—“ mit Grund statt einer Null", () => {
    const facts = nowFacts(input({ stations: [] }));
    expect(facts[0].value).toBe("—");
    expect(facts[0].detail).toContain("Kein bestätigter Preis");
  });

  it("Tankstand ist ein Fakt, kein Formular", () => {
    const empty = nowFacts(
      input({
        decide: decide("wait", {
          tank: {
            input: "input",
            tank_percent: 10,
            tank_capacity_l: 50,
            range_km: 71,
            reserve_range_km: 0,
            state: "low",
            blocks_wait: true,
            message: null,
          },
        }),
      }),
    );
    expect(empty[2].value).toBe("Nein");
    expect(empty[2].detail).toContain("71 km");
    const unknown = nowFacts(input());
    expect(unknown[2].value).toBe("—");
    expect(unknown[2].detail).toBe("Tankstand nicht gepflegt");
  });

  it("ohne Prognose bleibt das Fenster leer, nicht bunt", () => {
    const facts = nowFacts(
      input({ decide: decide("no_advice", { windows_today: [], calibrated: false }) }),
    );
    expect(facts[1].value).toBe("—");
    expect(facts[1].detail).toContain("Keine Prognose");
  });
});

describe("Nächste Schritte: höchstens drei", () => {
  it("nimmt Alternative, besseres Fenster und Tankwarnung", () => {
    const rich = decide("wait", {
      tank: {
        input: "input",
        tank_percent: 10,
        tank_capacity_l: 50,
        range_km: 60,
        reserve_range_km: 0,
        state: "low",
        blocks_wait: true,
        message: null,
      },
    });
    rich.alternatives_nearby = [
      {
        station_id: "free",
        name: "Freie Nord",
        brand: "",
        price: 1.679,
        delta_ct: 7,
        detour_km: 2.4,
        net_eur: 0.8,
        worth_it: true,
        verdict: "worth",
      },
    ];
    rich.windows_week = [
      {
        start: "2026-09-15T19:00:00+02:00",
        end: "2026-09-15T21:00:00+02:00",
        expected_price: 1.689,
        expected_saving_eur: 2.1,
        p: 0.7,
      },
    ];
    const steps = nowSteps(input({ decide: rich }));
    expect(steps.map((s) => s.id)).toEqual(["alternative", "later-window", "tank"]);
    expect(steps[1].text).toContain("Morgen 19–21 Uhr");
    expect(steps[2].target).toBe("tank");
  });

  it("schweigt, wenn es nichts zu tun gibt", () => {
    expect(nowSteps(input())).toEqual([]);
  });
});

describe("Frische-Fußzeile", () => {
  it("zählt Alter in Worten und färbt erst bei Schwellen", () => {
    const fresh = nowFreshness({
      pricesAt: minutesAgo(4),
      forecastAt: minutesAgo(35),
      now: NOW,
    });
    expect(fresh.text).toBe("Preise vor 4 Minuten · Prognose vor 35 Minuten");
    expect(fresh.tone).toBe("ok");

    const stale = nowFreshness({ pricesAt: minutesAgo(45), forecastAt: null, now: NOW });
    expect(stale.tone).toBe("warn");

    const old = nowFreshness({ pricesAt: minutesAgo(90), forecastAt: null, now: NOW });
    expect(old.tone).toBe("bad");
  });

  it("ohne jeden Stand sagt sie das, statt „gerade eben“ zu behaupten", () => {
    const none = nowFreshness({ now: NOW });
    expect(none.text).toContain("Kein Datenstand");
    expect(none.tone).toBe("warn");
  });
});

describe("Ebene 1: höchstens drei Sätze", () => {
  it("nennt Muster, Abstand und Trefferquote — ohne Formel", () => {
    const explain = nowExplanation({ ...input(), pricesAt: minutesAgo(4) });
    expect(explain?.sentences).toHaveLength(3);
    expect(explain?.sentences[0]).toContain("18–20 Uhr");
    expect(explain?.sentences[1]).toContain("4,0 ct/L über");
    expect(explain?.sentences[2]).toContain("Von 120");
    expect(explain?.source).toContain("vor 4 Minuten");
    expect(explain?.labHint).toBe("In der Werkstatt vertiefen");
  });

  it("schneidet bei mehr Material auf drei Sätze", () => {
    const explain = nowExplanation({ ...input(), pricesAt: minutesAgo(4) });
    expect((explain?.sentences ?? []).length).toBeLessThanOrEqual(3);
  });

  it("bleibt auf Stufe B und C ehrlich", () => {
    const learning = decide("no_advice", { calibrated: false });
    learning.personal_stats.advice.last_30d_total = 12;
    const stageC = nowExplanation({ ...input({ decide: learning }), pricesAt: null });
    // Stufe C übernimmt den Servergrund, wenn es einen gibt …
    expect(stageC?.sentences[2]).toBe("Der Preis fällt hier abends meist.");
    // … und sagt sonst ehrlich, dass es keinen belastbaren Grund gibt.
    const withoutReason = decide("no_advice", { calibrated: false }, { reason_short: "" });
    expect(
      nowExplanation({ ...input({ decide: withoutReason }), pricesAt: null })?.sentences[2],
    ).toContain("belastbare Empfehlung");
    const learnB = decide("wait", { calibrated: false });
    learnB.personal_stats.advice.last_30d_total = 12;
    const stageB = nowExplanation({
      ...input({ decide: learnB }),
      pricesAt: minutesAgo(4),
    });
    expect(stageB?.sentences[2]).toContain("12 von 100");
  });
});

describe("Hilfsfunktionen", () => {
  it("rechnet den Abstand in ct/L, auch wenn eine Seite fehlt", () => {
    expect(savingPerLiterCt(1.75, 1.71)).toBeCloseTo(4, 5);
    expect(savingPerLiterCt(null, 1.71)).toBeNull();
    expect(savingPerLiterCt(1.75, null)).toBeNull();
  });

  it("beschriftet Tage in Berliner Zeit", () => {
    expect(dayLabel("2026-09-14T18:00:00+02:00", NOW)).toBe("Heute");
    expect(dayLabel("2026-09-15T19:00:00+02:00", NOW)).toBe("Morgen");
    expect(dayLabel("2026-09-17T19:00:00+02:00", NOW)).toBe("Donnerstag");
    expect(dayLabel(null, NOW)).toBe("Später");
  });
});
