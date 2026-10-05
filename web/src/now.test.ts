// Jetzt (UX-NEUENTWURF §3): die reine Logik der ersten Ansicht.
//
// Der Test hält die Versprechen des Neuentwurfs fest, die man später still
// brechen würde: eine Karte mit höchstens einer Zahl und einer Handlung,
// Unsicherheit als ein Wort (Prozent nur auf Stufe A), die Begründung in
// höchstens fünf Zeilen und das Datenalter in einem Chip.

import { describe, expect, it } from "vitest";
import type { DecideResult, Station } from "./data";
import {
  ANYTIME_SAVING_EUR,
  confidenceWord,
  dayLabel,
  forecastStamp,
  hourApproxLabel,
  learningNote,
  nowAnswer,
  nowBestNow,
  nowCoverage,
  nowDayRow,
  nowFreshness,
  nowNetBest,
  nowStage,
  nowValidity,
  nowWhy,
  savingPerLiterCt,
  windowSavingEur,
  wordFromPercent,
  type NowInput,
} from "./now";
import type { StripCell } from "./strip";

const NOW = Date.parse("2026-09-14T12:00:00+02:00");
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

function station(id: string, overrides: Partial<Station> = {}): Station {
  return {
    station_id: id,
    city: "Frankfurt",
    name: `Station ${id}`,
    brand: "ARAL",
    fuel: "e10",
    maps_url: `https://maps.example/${id}`,
    dist_km: 1.2,
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
        maps_url: "https://maps.example/aral",
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

const input = (overrides: Partial<NowInput> = {}): NowInput => ({
  decide: decide("wait"),
  stations: [station("aral"), station("shell", { price: 1.689, brand: "SHELL" })],
  selectedId: "aral",
  liters: 40,
  now: NOW,
  pricesAt: minutesAgo(4),
  forecastAt: minutesAgo(35),
  ...overrides,
});

/** Alle Wörter eines Karten-Textes — der 25-Wörter-Ratchet aus §3. */
function cardWords(answer: NonNullable<ReturnType<typeof nowAnswer>>): number {
  return [answer.chip, answer.headline, answer.subline]
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

describe("Stufen der Sicherheit (§10)", () => {
  it("Stufe A nur mit Kalibrierung, Stufe C ohne Freigabekette", () => {
    expect(nowStage(decide("wait"))).toBe("A");
    // A5: Ohne M7-Gate („calibrated: false“) gibt es keine Zwischenstufe —
    // der Server würde ohnehin „no_advice“ liefern; die GUI bleibt grau.
    expect(nowStage(decide("wait", { calibrated: false }))).toBe("C");
    expect(nowStage(decide("no_advice", { calibrated: false }))).toBe("C");
  });

  it("Worte kommen aus dem Badge, nie geraten", () => {
    expect(confidenceWord("high")).toBe("ziemlich sicher");
    expect(confidenceWord("medium")).toBe("eher sicher");
    expect(confidenceWord("low")).toBe("unsicher");
    expect(confidenceWord(null)).toBeNull();
  });

  it("A5: ohne kalibriertes Gate gibt es keine Stufe B — die Karte bleibt Stufe C", () => {
    expect(nowStage(decide("refuel_now", { calibrated: false }))).toBe("C");
    expect(nowStage(decide("wait", { calibrated: false }))).toBe("C");
  });

  it("die Lernphase benennt, was schon funktioniert (S1, UI-Neugestaltung)", () => {
    // Die App ist in der Lernphase keine tote Fläche: Vergleich und
    // Umweg-Rechnung tragen sich mit Live-Preisen — der Satz sagt es.
    const learning = decide("no_advice", { calibrated: false }, { reason_short: "" });
    learning.personal_stats.advice.last_30d_total = 12;
    expect(learningNote(learning)).toContain(
      "Vergleich und Umweg-Rechnung funktionieren bereits.",
    );
  });

  it("A3: der Lernstand zählt den M7-Vertragsschnitt, nicht das 30-Tage-Fenster", () => {
    // Befund A3 (23.09.2026): „X von 100 abgeschlossenen Empfehlungen“ lief
    // auf dem 30-Tage-Fenster (last_30d_total) — volatil und falsch. Der
    // Server meldet dank A3-Fix den Gate-Schnitt mit; die 30-Tage-Zahl ist
    // nur noch Fallback für Alt-Payloads.
    const learning = decide("no_advice", { calibrated: false }, { reason_short: "" });
    learning.personal_stats.advice.last_30d_total = 3;
    learning.personal_stats.advice.gate_n = 42;
    learning.personal_stats.advice.min_recommendations = 100;
    expect(learningNote(learning)).toContain("42 von 100");
    delete learning.personal_stats.advice.gate_n;
    expect(learningNote(learning)).toContain("3 von 100");
  });
});

describe("Wort und Zahl widersprechen sich nicht", () => {
  it("auf Stufe A kommt das Wort aus dem gemessenen Prozentwert", () => {
    // Der Server-Badge beschreibt die Lage, nicht die Trefferwahrscheinlichkeit:
    // badge „low“ bei 99 % ergäbe sonst „unsicher (99 %)“.
    const sicher = decide(
      "refuel_now",
      {},
      { p_correct: 0.9948, confidence_badge: "low" },
    );
    expect(nowWhy(input({ decide: sicher }))?.lines.join(" ")).toContain(
      "ziemlich sicher",
    );
    const unsicher = decide("refuel_now", {}, { p_correct: 0.41 });
    expect(nowWhy(input({ decide: unsicher }))?.lines.join(" ")).toContain(
      "unsicher",
    );
  });

  it("übersetzt die Schwellen sauber", () => {
    expect(wordFromPercent(75)).toBe("ziemlich sicher");
    expect(wordFromPercent(74.9)).toBe("eher sicher");
    expect(wordFromPercent(55)).toBe("eher sicher");
    expect(wordFromPercent(54.9)).toBe("unsicher");
  });
});

describe("Antwortkarte: eine Frage, eine Antwort (§3)", () => {
  it("Warten nennt Uhrzeit und Ersparnis in € — und bleibt unter 25 Wörtern", () => {
    const answer = nowAnswer(input());
    expect(answer?.variant).toBe("wait");
    // „Warten“ ist die Geld sparende, geplante Empfehlung — Blau. Grün
    // bleibt „jetzt handeln“, Rot dem Tankrest-Risiko (Urteilstöne).
    expect(answer?.tone).toBe("blue");
    expect(answer?.headline).toBe("Warten bis ~18 Uhr");
    expect(answer?.lead).toBe("spart ca. 1,60 €");
    expect(answer?.action?.label).toBe("Route");
    expect(cardWords(answer!)).toBeLessThanOrEqual(25);
  });

  it("Jetzt tanken zeigt den Preis und die Station", () => {
    const answer = nowAnswer(
      input({ decide: decide("refuel_now", {}, { p_correct: null }) }),
    );
    expect(answer?.variant).toBe("refuel_now");
    expect(answer?.tone).toBe("green");
    expect(answer?.headline).toBe("Jetzt tanken");
    expect(answer?.lead).toBe("1,689 €/L");
    expect(answer?.subline).toContain("Station shell");
  });

  it("Woanders tanken führt zur netto besten Alternative", () => {
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
    const answer = nowAnswer(input({ decide: withAlt }));
    expect(answer?.headline).toBe("Jetzt tanken");
    expect(answer?.subline).toContain("Freie Nord");
    expect(answer?.subline).not.toContain("Weit weg");
  });

  it("kaum Unterschied heißt „Tanken, wann’s passt“", () => {
    const knapp = decide("wait", {}, { expected_saving_eur: 0.2 });
    const answer = nowAnswer(input({ decide: knapp }));
    expect(answer?.variant).toBe("anytime");
    expect(answer?.headline).toBe("Tanken, wann’s passt");
    expect(answer?.tone).toBe("gray");
    // Die Schwelle ist benannt und im Code eine Stelle (kein Streuwert).
    expect(ANYTIME_SAVING_EUR).toBeGreaterThan(0);
  });

  it("ohne Prognose trägt die Karte die Tatsache: der günstigste Preis jetzt", () => {
    const answer = nowAnswer(
      input({
        decide: decide("no_advice", {}, { reason_short: "Die Preise springen." }),
      }),
    );
    expect(answer?.variant).toBe("no_forecast");
    expect(answer?.tone).toBe("gray");
    expect(answer?.headline).toBe("Günstigste gerade: Station shell");
    expect(answer?.lead).toBe("1,689 €/L");
    expect(answer?.subline).toContain("Stand");
  });

  it("offline schlägt alles — der Preis an der Säule zählt", () => {
    const answer = nowAnswer(input({ online: false }));
    expect(answer?.variant).toBe("offline");
    expect(answer?.tone).toBe("gray");
    expect(answer?.headline).toBe("Letzter Stand: Station shell");
    expect(answer?.subline).toBe("Der Preis an der Säule zählt.");
    // Ohne Verbindung keine Handlung, die eine Entscheidung vorspielt.
    expect(answer?.action).toBeNull();
  });

  it("ohne Antwort und ohne Preis gibt es nichts zu sagen", () => {
    expect(nowAnswer(input({ decide: null, stations: [] }))).toBeNull();
    expect(
      nowAnswer(input({ decide: null, stations: [station("aral", { price: null })] })),
    ).toBeNull();
  });
});

describe("Urteilstöne und Gültigkeit (UI-Neugestaltung, §3/§7)", () => {
  it("Jetzt tanken bleibt grün, solange der Tank das Warten nicht blockiert", () => {
    const answer = nowAnswer(
      input({ decide: decide("refuel_now", {}, { p_correct: null }) }),
    );
    expect(answer?.tone).toBe("green");
    expect(answer?.expired).toBe(false);
  });

  it("Tankrest, der das Warten blockiert, macht die Karte rot", () => {
    // Die eine echte Risikolage: Warten ist physisch riskant — Rot, nicht
    // Grün. Der Server meldet das über `tank.blocks_wait`.
    const blocked = decide("refuel_now", {}, { p_correct: null });
    blocked.tank = {
      input: "input",
      tank_percent: 15,
      tank_capacity_l: 50,
      range_km: 60,
      reserve_range_km: 30,
      state: "low",
      blocks_wait: true,
      message: "Der Tankrest reicht für etwa 60 km.",
    };
    const answer = nowAnswer(input({ decide: blocked }));
    expect(answer?.tone).toBe("red");
    // … und der Grund steht im „Warum?“ -Blatt, nicht im Weg der Antwort.
    expect(nowWhy(input({ decide: blocked }))?.lines.join(" ")).toContain(
      "Der Tankrest reicht für etwa 60 km.",
    );
  });

  it("valid_until fließt als „bis 17:45“ in die Karte", () => {
    const released = decide("wait", { valid_until: "2026-09-14T17:45:00+02:00" });
    const answer = nowAnswer(input({ decide: released }));
    expect(nowValidity(answer, NOW)?.label).toBe("bis 17:45");
    const denied = nowAnswer(
      input({ decide: decide("no_advice", {}, { reason_short: "Preise springen." }) }),
    );
    expect(nowValidity(denied, NOW)).toBeNull();
  });

  it("abgelaufene Freigabe wechselt den Karteninhalt — kein Fehler, kein Rot", () => {
    // Der Vertrag: ab `valid_until` darf der Cache die Aktion nicht mehr
    // zeigen. Die Karte zeigt die Tatsache (Preisvergleich), nicht die alte
    // Handlung (A21-B1.4).
    const stale = decide("wait", { valid_until: "2026-09-14T11:00:00+02:00" });
    const answer = nowAnswer(input({ decide: stale }));
    expect(answer?.expired).toBe(true);
    expect(answer?.tone).toBe("gray");
    expect(answer?.variant).toBe("no_forecast");
    expect(nowValidity(answer, NOW)).toBeNull();
  });

  it("gültige Freigabe läuft erst ab, wenn die Zeit vergangen ist", () => {
    const fresh = decide("wait", { valid_until: "2026-09-14T17:45:00+02:00" });
    expect(nowAnswer(input({ decide: fresh }))?.expired).toBe(false);
  });
});

describe("O45: der €-Betrag folgt dem angezeigten Fensterpreis", () => {
  // Befund 21.09.2026: „erwartet ~2,221 €/L“ stand neben „~2,09 € Ersparnis
  // für 55 L“ — 2,229 − 2,221 sind aber 0,44 €. Die 2,09 € gehören zu
  // 2,191 €/L (Median der Fensterminima), einem Preis, den die Karte nie
  // gezeigt hat. Der €-Betrag muss deshalb aus demselben Preis folgen wie
  // der Abstand, den die App nennt.
  const window = {
    start: "2026-09-21T10:00:00+02:00",
    end: "2026-09-21T11:50:00+02:00",
    expected_price: 2.221,
    expected_min_price: 2.191,
  };

  const befund = decide(
    "wait",
    { windows_today: [{ ...window, expected_saving_eur: 2.09, p: 0.71 }] },
    {
      station: { id: "aral", name: "Aral Mitte", price_now: 2.229, maps_url: null },
      recommended_window: window,
      expected_saving_eur: 2.09,
      expected_saving_median_eur: 0.44,
    },
  );

  it("die Karte nennt nie das Draw-Potenzial", () => {
    const answer = nowAnswer(input({ decide: befund, liters: 55 }));
    // Die 2,09 € gehören zum Median der Fensterminima (2,191 €/L) — einem
    // Preis, den die Karte nie zeigt. Sie stehen deshalb an keiner Stelle.
    expect(answer?.lead).not.toContain("2,09");
    // 0,44 € liegen unter der Schwelle (§3 „Kaum Unterschied“) — die Antwort
    // ist dann „Tanken, wann’s passt“, nicht „Warten“.
    expect(answer?.variant).toBe("anytime");
  });

  it("über der Schwelle trägt die Karte den Medianbetrag", () => {
    const lohnend = decide(
      "wait",
      {},
      { expected_saving_eur: 2.09, expected_saving_median_eur: 1.7 },
    );
    expect(nowAnswer(input({ decide: lohnend, liters: 55 }))?.lead).toBe(
      "spart ca. 1,70 €",
    );
  });

  it("das „Warum?“ -Blatt nennt Liter und Abstand", () => {
    const why = nowWhy(input({ decide: befund, liters: 55 }));
    expect(why?.lines.join(" ")).toContain("Bei 55 L spart das ca. 0,44 €");
    expect(why?.lines.join(" ")).toContain("0,8 ct/L");
  });

  it("ohne Median-Feld bleibt die Server-Zahl stehen — nichts erfunden", () => {
    const legacy = decide("wait", {}, { expected_saving_median_eur: null });
    expect(windowSavingEur(legacy.primary)).toBe(1.6);
  });
});

describe("„Warum?“ — höchstens fünf Zeilen (§3)", () => {
  it("nennt Fenster, Ersparnis, Sicherheit und Stand", () => {
    const why = nowWhy(input());
    expect(why?.lines.length).toBeLessThanOrEqual(5);
    expect(why?.lines[0]).toContain("18–20 Uhr");
    expect(why?.lines[1]).toContain("Bei 40 L spart das ca. 1,60 €");
    expect(why?.lines[2]).toContain("an 42 von 120 Tagen richtig");
    expect(why?.lines.at(-1)).toContain("beobachteten Stationen");
    // §8: Unsicherheit ist ein Wort — das Prozent steht nur in der Klammer.
    expect(why?.lines[2]).toContain("ziemlich sicher");
    // Der Weg in die Tiefe bleibt derselbe wie überall (Ebene 2 → Labor).
    expect(why?.labHint?.section).toBe("sicherheit");
    expect(why?.source).toContain("vor 4 Minuten");
  });

  it("bleibt in Stufe C ehrlich: kein Wort, das nicht gemessen ist", () => {
    const learning = decide("no_advice", { calibrated: false });
    learning.personal_stats.advice.last_30d_total = 12;
    const why = nowWhy(input({ decide: learning }));
    expect(why?.lines[2]).not.toContain("%");
    expect(why?.lines[2]).toContain("ziemlich sicher");
  });

  it("nennt den Tank nur, wenn er die Entscheidung trägt", () => {
    const blocking = decide("wait");
    blocking.tank = {
      input: "input",
      tank_percent: 10,
      tank_capacity_l: 50,
      range_km: 40,
      reserve_range_km: 20,
      state: "low",
      blocks_wait: true,
      message: "Die Reserve reicht nicht bis 18 Uhr.",
    };
    const withTank = nowWhy(input({ decide: blocking }))?.lines ?? [];
    expect(withTank.join(" ")).toContain("Die Reserve reicht nicht bis 18 Uhr.");
    const ohne = nowWhy(input())?.lines ?? [];
    expect(ohne.join(" ")).not.toContain("Reserve");
  });

  it("A3: Trefferzahl und Quote rechnen Unentschieden gleich (halbes Gewicht)", () => {
    // Befund A3 (23.09.2026): „Von X Empfehlungen trafen Y zu (Z %)“
    // mischte Zählweisen — Y ohne Ties, Z mit Ties × 0,5.
    const decideA = decide("wait");
    decideA.personal_stats.advice.last_30d_total = 30;
    decideA.personal_stats.advice.last_30d_hits = 25;
    decideA.personal_stats.advice.last_30d_ties = 2;
    decideA.personal_stats.advice.hit_rate = 0.867;
    const why = nowWhy(input({ decide: decideA }));
    expect(why?.lines[2]).toContain("an 26 von 30 Tagen richtig");
  });
});

describe("Frische: ein Chip im Kopf (§6)", () => {
  it("zählt Alter in Worten und färbt erst bei Schwellen", () => {
    const fresh = nowFreshness({
      pricesAt: minutesAgo(4),
      forecastAt: minutesAgo(35),
      now: NOW,
    });
    expect(fresh.chip).toBe("vor 4 Minuten");
    expect(fresh.text).toBe("Preise vor 4 Minuten · Prognose vor 35 Minuten");
    expect(fresh.tone).toBe("ok");

    const stale = nowFreshness({ pricesAt: minutesAgo(45), forecastAt: null, now: NOW });
    expect(stale.tone).toBe("warn");

    const old = nowFreshness({ pricesAt: minutesAgo(90), forecastAt: null, now: NOW });
    expect(old.tone).toBe("bad");
    expect(old.chip).toBe("alt");
  });

  it("ohne jeden Stand sagt sie das, statt „gerade eben“ zu behaupten", () => {
    const none = nowFreshness({ now: NOW });
    expect(none.text).toContain("Kein Datenstand");
    expect(none.chip).toBe("kein Stand");
    expect(none.tone).toBe("warn");
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
    expect(nowWhy(input({ decide: broken }))).toBeNull();
    expect(learningNote(broken)).toBeNull();
  });

  it("trägt die Tatsache, wenn Preise da sind", () => {
    const answer = nowAnswer(input({ decide: broken }));
    expect(answer?.variant).toBe("no_forecast");
    expect(answer?.lead).toBe("1,689 €/L");
  });
});

describe("Frische der Prognose (Regression)", () => {
  // Vorher stand in der Fußzeile `stats_summary.generated_at` — das ist der
  // Zeitpunkt der Antwortberechnung, also immer „gerade eben“. Der Modell-Lauf
  // (`debug.fitted_at`) datiert die Prognose wirklich.
  it("nimmt den Fit-Zeitpunkt der Veröffentlichung, sonst den Kalibrier-Stand", () => {
    const withFit = decide("wait", {
      debug: { fitted_at: minutesAgo(35) },
    } as Partial<DecideResult>);
    expect(forecastStamp(withFit)).toBe(minutesAgo(35));

    const legacy = decide("wait", {
      quality: { rolling_picp_7d_as_of: "2026-09-13" },
    } as Partial<DecideResult>);
    expect(forecastStamp(legacy)).toBe("2026-09-13");
  });

  it("sagt ohne Lauf nichts, statt „gerade eben“ zu behaupten", () => {
    expect(forecastStamp(decide("wait"))).toBeNull();
    expect(forecastStamp(null)).toBeNull();
  });
});

describe("Tageszeile: eine Zeile, eine Kurve (§3)", () => {
  function cells(
    values: Array<number | null>,
    currentHour = 12,
  ): StripCell[] {
    return values.map((value, index) => ({
      hour: 6 + index,
      value,
      latest: value,
      current: 6 + index === currentHour,
      tone: "mid" as const,
    }));
  }

  it("nennt den Tiefpunkt und den aktuellen Preis", () => {
    const row = nowDayRow(cells([1.75, 1.74, 1.73, 1.72, 1.71, 1.7, 1.69]));
    expect(row?.label).toBe("Tief ~12 Uhr");
    expect(row?.low).toEqual({ hour: 12, value: 1.69 });
    expect(row?.now).toBe(1.69);
    expect(row?.sentence).toContain("1,690 €/L");
  });

  it("leere Stunden bleiben leer — keine Schätzung", () => {
    const row = nowDayRow(cells([1.75, null, null, 1.7]));
    expect(row?.cells.filter((cell) => cell.value === null)).toHaveLength(2);
    expect(row?.coverage).toContain("2 von 4 Stunden mit offener Meldung");
  });

  it("ohne Messung gibt es keine Zeile — keine leere Kurve", () => {
    expect(nowDayRow(cells([null, null]))).toBeNull();
    expect(nowDayRow([])).toBeNull();
  });

  it("A4-Regression: der Median ist der Mittelwert, nicht der obere Rand", () => {
    // Bei gerader Stichprobe lag der obere der beiden Mittelwerte drin —
    // der „Tagesmedian“ zeigte systematisch zu hoch.
    const row = nowDayRow(cells([1.7, 1.72, 1.74, 1.76]));
    expect(row?.median).toBeCloseTo(1.73, 5);
  });
});

describe("Hilfsfunktionen", () => {
  it("rechnet den Abstand in ct/L, auch wenn eine Seite fehlt", () => {
    expect(savingPerLiterCt(1.749, 1.709)).toBeCloseTo(4, 5);
    expect(savingPerLiterCt(null, 1.709)).toBeNull();
    expect(savingPerLiterCt(1.749, null)).toBeNull();
  });

  it("nennt die Stunde eines Fensters ungefähr, in Berliner Zeit", () => {
    expect(hourApproxLabel("2026-09-14T18:30:00+02:00")).toBe("~18 Uhr");
    expect(hourApproxLabel("unsinn")).toBeNull();
  });

  it("beschriftet Tage in Berliner Zeit", () => {
    expect(dayLabel("2026-09-14T12:00:00+02:00", NOW)).toBe("Heute");
    expect(dayLabel("2026-09-15T12:00:00+02:00", NOW)).toBe("Morgen");
    expect(dayLabel("2026-09-18T12:00:00+02:00", NOW)).toBe("Freitag");
  });
});

describe("O19: nowBestNow rechnet gegen die Entscheidung, nicht gegen das Maximum", () => {
  it("nennt die Referenz der Empfehlung im Satz und rechnet gegen sie", () => {
    const best = nowBestNow(input());
    expect(best.station?.station_id).toBe("shell");
    expect(best.saveCt).toBeCloseTo(6, 5);
    expect(best.saveEur).toBeCloseTo(2.4, 5);
    expect(best.sentence).toContain("unter dem Preis");
  });

  it("ohne Empfehlung gibt es keine persönliche Ersparnis, nur die Spanne", () => {
    const best = nowBestNow(input({ decide: null }));
    expect(best.saveCt).toBeNull();
    expect(best.spreadCt).toBeCloseTo(6, 5);
  });

  it("eine günstigere Referenz ergibt keine erfundene Ersparnis", () => {
    const cheaperAnchor = decide("wait", {}, {
      station: { id: "aral", name: "Aral Mitte", price_now: 1.6, maps_url: null },
    });
    const best = nowBestNow(input({ decide: cheaperAnchor }));
    expect(best.saveCt).toBeLessThan(0);
    expect(best.sentence).toContain("aber nicht unter dem Preis");
  });
});

describe("Priorität 1: Abdeckung und Netto-Vergleich (A70)", () => {
  it("nowCoverage nennt beobachtete vs. frische Stationen", () => {
    const coverage = nowCoverage(
      [station("aral"), station("shell", { price: null })],
      minutesAgo(4),
      NOW,
    );
    expect(coverage.line).toBe(
      "1 von 2 beobachteten Stationen mit frischem Preis",
    );
    expect(coverage.ageLine).toBe("Preise vor 4 Minuten");
  });

  it("nowNetBest trennt netto Wahl von nicht vergleichbar", () => {
    const withAlt = decide("wait");
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
    ];
    const net = nowNetBest(input({ decide: withAlt }));
    expect(net.kind).toBe("net");
    expect(net.text).toContain("Freie Nord");
    expect(nowNetBest(input())).toMatchObject({ kind: "not_comparable" });
  });
});

describe("Gültigkeits-Countdown", () => {
  const answerWith = (validUntil: string | null) =>
    nowAnswer(input({ decide: decide("wait", { valid_until: validUntil }) }));

  it("zeigt vor den letzten 30 Minuten nur die Berliner Uhrzeit", () => {
    expect(nowValidity(answerWith("2026-09-14T17:45:00+02:00"), NOW)).toEqual({
      label: "bis 17:45",
      endingSoon: false,
    });
  });

  it("warnt ab genau 30 Minuten und rundet Restminuten auf", () => {
    const validity = nowValidity(answerWith("2026-09-14T12:20:00+02:00"), NOW);
    expect(validity?.endingSoon).toBe(true);
    expect(validity?.label).toBe("bis 12:20 · noch 20 min");
  });

  it("endet exakt an der Freigabegrenze", () => {
    expect(nowValidity(answerWith("2026-09-14T12:00:00+02:00"), NOW)).toBeNull();
  });

  it("erfindet keinen Countdown für fehlende oder abgelehnte Freigaben", () => {
    expect(nowValidity(answerWith(null), NOW)).toBeNull();
    expect(nowValidity(null, NOW)).toBeNull();
  });
});
