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
  forecastStamp,
  learningNote,
  nowBestNow,
  nowDayPanel,
  nowExplanation,
  nowFacts,
  nowFreshness,
  nowStage,
  nowSteps,
  nowVerdict,
  savingPerLiterCt,
  stageProgressNote,
  timeInputToBerlinIso,
  wordFromPercent,
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

describe("Wort und Zahl widersprechen sich nicht", () => {
  it("auf Stufe A kommt das Wort aus dem gemessenen Prozentwert", () => {
    // Der Server-Badge beschreibt die Lage, nicht die Trefferwahrscheinlichkeit:
    // badge „low“ bei 99 % ergäbe sonst „unsicher (99 %)“.
    const sicher = decide("refuel_now", {}, { p_correct: 0.9948, confidence_badge: "low" });
    const verdict = nowVerdict(input({ decide: sicher }));
    expect(verdict?.percent).toBe(99);
    expect(verdict?.word).toBe("ziemlich sicher");
    expect(verdict?.detail).toContain("ziemlich sicher (99 %)");

    const unsicher = decide("refuel_now", {}, { p_correct: 0.41 });
    expect(nowVerdict(input({ decide: unsicher }))?.word).toBe("unsicher");
  });

  it("übersetzt die Schwellen sauber", () => {
    expect(wordFromPercent(75)).toBe("ziemlich sicher");
    expect(wordFromPercent(74.9)).toBe("eher sicher");
    expect(wordFromPercent(55)).toBe("eher sicher");
    expect(wordFromPercent(54.9)).toBe("unsicher");
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
    expect(unknown[2].detail).toBe("Tankstand nicht angegeben");
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

  it("nennt ohne Empfehlung kein Prognose-Fenster (Stufe C)", () => {
    // Widerspruch aus dem Pixel-9-Check (18.09.2026): Die Karte sagte
    // „Keine Prognose — Preise vergleichen“, darunter stand „Freitag
    // 14:00–15:54 Uhr wäre noch besser (2,04 € weniger)“. Beides auf einem
    // Bildschirm — die zweite Zeile behauptet die Sicherheit, die die erste
    // gerade verneint (Konzept §0.4). Auf Stufe C bleibt der Schritt weg;
    // die Alternative aus echten Preisen darf bleiben.
    const blind = decide("no_advice");
    blind.windows_week = [
      {
        start: "2026-09-15T19:00:00+02:00",
        end: "2026-09-15T21:00:00+02:00",
        expected_price: 1.689,
        expected_saving_eur: 2.1,
        p: 0.7,
      },
    ];
    expect(nowSteps(input({ decide: blind })).map((s) => s.id)).not.toContain(
      "later-window",
    );
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
    // 3.2: Der Weg in die Tiefe zeigt auf den Labor-Abschnitt, nicht mehr
    // auf die alte Werkstatt.
    expect(explain?.labHint).toEqual({
      section: "sicherheit",
      label: "Im Labor vertiefen: Was „ziemlich sicher“ heißt",
    });
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

describe("Server-Fehlerpayload ohne primary (Regression)", () => {
  // Das Overview-Aggregat antwortet mit HTTP 200, aber einem `decide`-Feld
  // wie `{"error_code": "polling_missing"}`. Genau daran ist die Ansicht
  // einmal abgestürzt (leere Seite) — diese Fälle halten die Härtung fest.
  const broken = { error_code: "polling_missing" } as unknown as DecideResult;

  it("liefert Stufe C statt eines Absturzes", () => {
    expect(nowStage(broken)).toBe("C");
  });

  it("empfiehlt nichts und begründet nichts", () => {
    expect(nowVerdict(input({ decide: broken }))).toBeNull();
    expect(nowExplanation({ ...input({ decide: broken }), pricesAt: null })).toBeNull();
    expect(learningNote(broken)).toBeNull();
    expect(stageProgressNote(broken)).toBeNull();
  });

  it("liefert trotzdem die drei Fakten und keine Schritte", () => {
    const facts = nowFacts(input({ decide: broken }));
    expect(facts).toHaveLength(3);
    expect(facts[1].value).toBe("—");
    expect(facts[1].detail).toContain("Keine Prognose");
    expect(nowSteps(input({ decide: broken }))).toEqual([]);
  });
});

describe("Frische der Prognose (Regression)", () => {
  // Vorher stand in der Fußzeile `stats_summary.generated_at` — das ist der
  // Zeitpunkt der Antwortberechnung, also immer „gerade eben“. Der Modell-Lauf
  // datiert aus der Engine-Publikation bzw. dem Fit.
  it("nimmt die Engine-Publikation, sonst den Fit", () => {
    const withPublishing = decide("wait");
    withPublishing.quality = {
      rolling_picp_7d_pct: 94.2,
      rolling_picp_7d_points: 220,
      rolling_picp_7d_days: 7,
      rolling_picp_7d_badge: "green",
      rolling_picp_7d_as_of: "2026-09-14T09:25:00+02:00",
      rolling_picp_window_days: 7,
      rolling_picp_nominal_pct: 95,
      gate: null,
    };
    withPublishing.debug = { forecast_url: "/api/v1/forecast", fitted_at: "2026-09-14T09:25:00+02:00" };
    expect(forecastStamp(withPublishing)).toBe("2026-09-14T09:25:00+02:00");

    const onlyFit = decide("wait");
    onlyFit.debug = { forecast_url: "/api/v1/forecast", fitted_at: "2026-09-13T23:00:00+02:00" };
    expect(forecastStamp(onlyFit)).toBe("2026-09-13T23:00:00+02:00");
  });

  it("sagt ohne Lauf nichts, statt „gerade eben“ zu behaupten", () => {
    expect(forecastStamp(decide("wait"))).toBeNull();
    expect(forecastStamp(null)).toBeNull();
    expect(
      forecastStamp({ error_code: "polling_missing" } as unknown as DecideResult),
    ).toBeNull();
    expect(
      nowFreshness({ pricesAt: minutesAgo(4), forecastAt: null, now: NOW }).text,
    ).toBe("Preise vor 4 Minuten · Prognose ohne Stand");
  });
});

describe("Heute im Blick: Gleichstand als Spanne", () => {
  it("nennt 06–12 Uhr, wenn sechs Stunden denselben Bestpreis teilen", () => {
    const cells = [
      ...[6, 7, 8, 9, 10, 11].map((hour) => ({
        hour,
        value: 2.289,
        latest: 2.289,
        tone: "cheap" as const,
        current: hour === 9,
      })),
      { hour: 18, value: 2.349, latest: 2.349, tone: "pricey" as const, current: false },
    ];
    const panel = nowDayPanel(cells);
    expect(panel.bestLabel).toBe("06–12 Uhr");
    expect(panel.tied).toBe(true);
    expect(panel.bestHours).toEqual([6, 7, 8, 9, 10, 11]);
    expect(panel.headline).toContain("06–12 Uhr");
    expect(panel.headline).not.toContain("06–07 Uhr");
    expect(panel.headline).toContain("18–19 Uhr");
  });

  it("einzelne günstigste Stunde bleibt 12–13 Uhr", () => {
    const panel = nowDayPanel([
      { hour: 6, value: 1.759, latest: 1.759, tone: "pricey", current: false },
      { hour: 12, value: 1.709, latest: 1.709, tone: "cheap", current: true },
      { hour: 18, value: 1.729, latest: 1.729, tone: "mid", current: false },
    ]);
    expect(panel.bestLabel).toBe("12–13 Uhr");
    expect(panel.tied).toBe(false);
    expect(panel.headline).toContain("12–13 Uhr");
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

describe("B2: timeInputToBerlinIso (Spätestens-tanken → latest_by)", () => {
  // Feste „jetzt“-Zeitpunkte, damit die Tests nicht von der Uhr abhängen.
  const SUMMER = Date.parse("2026-09-14T12:00:00+02:00"); // CEST, UTC+2
  const WINTER = Date.parse("2026-12-14T12:00:00+01:00"); // CET, UTC+1

  it("wandelt Berlin-Wallclock in den korrekten UTC-Stempel um (Sommerzeit)", () => {
    // 10:00 Berlin bei CEST (UTC+2) = 08:00 UTC. Mit dem alten
    // „+ offsetMs“ wäre es 12:00 UTC (14:00 Berlin) gewesen.
    expect(timeInputToBerlinIso("10:00", SUMMER)).toBe(
      "2026-09-14T08:00:00.000Z",
    );
    expect(timeInputToBerlinIso("23:59", SUMMER)).toBe(
      "2026-09-14T21:59:00.000Z",
    );
  });

  it("benutzt das Winter-Offset (CET, UTC+1)", () => {
    // 10:00 Berlin bei CET (UTC+1) = 09:00 UTC.
    expect(timeInputToBerlinIso("10:00", WINTER)).toBe(
      "2026-12-14T09:00:00.000Z",
    );
  });

  it("Mitternacht rollt auf den Vorabend in UTC zurück", () => {
    // 00:00 Berlin am 14.09. (CEST) = 22:00 UTC am 13.09.
    expect(timeInputToBerlinIso("00:00", SUMMER)).toBe(
      "2026-09-13T22:00:00.000Z",
    );
    // 00:00 Berlin am 14.12. (CET) = 23:00 UTC am 13.12.
    expect(timeInputToBerlinIso("00:00", WINTER)).toBe(
      "2026-12-13T23:00:00.000Z",
    );
  });

  it("Rundtrip: der Stempel zeigt in Berlin wieder die eingegebene Zeit", () => {
    const iso = timeInputToBerlinIso("17:30", SUMMER);
    expect(iso).not.toBeNull();
    const parts = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso!));
    const hour = Number(parts.find((p) => p.type === "hour")?.value) % 24;
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    expect(hour).toBe(17);
    expect(minute).toBe(30);
  });

  it("lehnt ungültige Eingaben ab", () => {
    expect(timeInputToBerlinIso("25:00", SUMMER)).toBeNull();
    expect(timeInputToBerlinIso("10:60", SUMMER)).toBeNull();
    expect(timeInputToBerlinIso("kein-Format", SUMMER)).toBeNull();
  });
});

describe("O19: nowBestNow rechnet gegen die Entscheidung, nicht gegen das Maximum", () => {
  const stations = [
    station("aral", { price: 1.759 }),
    station("shell", { price: 1.709, name: "Shell Nord" }),
    station("esso", { price: 1.729, name: "Esso West" }),
  ];

  it("nennt die Referenz der Empfehlung im Satz und rechnet gegen sie", () => {
    const result = nowBestNow({
      // Entscheidungs-Station Aral Mitte, Jetzt-Preis 1,749 €/L.
      decide: decide("wait"),
      stations,
      liters: 45,
      now: NOW,
    });
    expect(result.reference.kind).toBe("nowcast");
    expect(result.reference.station).toBe("Aral Mitte");
    expect(result.reference.price).toBe(1.749);
    // 1,749 − 1,709 = 4,0 ct/L — nicht 5,0 ct/L gegen die teuerste Station.
    expect(result.saveCt).toBeCloseTo(4.0, 6);
    expect(result.saveEur).toBeCloseTo(1.8, 6);
    expect(result.sentence).toContain("4,0 ct/L");
    expect(result.sentence).toContain("Aral Mitte, 1,749 €/L");
    expect(result.sentence).toContain("1,80 € bei 45 L");
    // Gegen die teuerste Station wird nicht mehr gerechnet …
    expect(result.sentence).not.toContain("teuersten");
    // … die Spanne bleibt als Spanne erhalten.
    expect(result.spreadCt).toBeCloseTo(5.0, 6);
  });

  it("ohne Empfehlung gibt es keine persönliche Ersparnis, nur die Spanne", () => {
    const result = nowBestNow({ decide: null, stations, liters: 45, now: NOW });
    expect(result.reference.kind).toBe("none");
    expect(result.saveCt).toBeNull();
    expect(result.saveEur).toBeNull();
    expect(result.spreadCt).toBeCloseTo(5.0, 6);
    expect(result.sentence).toContain(
      "zwischen günstigster und teuerster Station",
    );
    expect(result.sentence).not.toContain("€ bei 45 L");
  });

  it("eine günstigere Referenz ergibt keine erfundene Ersparnis", () => {
    // Die Entscheidungs-Station ist selbst die günstigste: nichts zu sparen.
    const result = nowBestNow({
      decide: decide("wait", {}, {
        station: { id: "shell", name: "Shell Nord", price_now: 1.709 },
      }),
      stations,
      liters: 45,
      now: NOW,
    });
    expect(result.saveCt).toBeCloseTo(0, 6);
    expect(result.sentence).toContain("nicht unter dem Preis");
    expect(result.sentence).not.toContain("das sind");
  });
});
