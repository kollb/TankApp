import { describe, expect, it } from "vitest";
import {
  autoTimeTicks,
  autoTimeValue,
  berlinHour,
  brierGateHint,
  compressedAxis,
  currentPrice,
  dayAfterLabel,
  detourEconomics,
  epochLabel,
  gapBands,
  haversineKm,
  jobRunMessage,
  livePhaseCountdown,
  livePhaseHint,
  rowOutcome,
  scoreRows,
  segments,
  splitOnGap,
  triggerSkipLabel,
  type Station,
} from "./data";

const station: Station = {
  station_id: "station",
  city: "Frankfurt",
  name: "Station",
  brand: "",
  fuel: "e10",
  maps_url: null,
  price: 1.7,
  last_price: 1.7,
  status: "open",
  fresh: true,
  age_minutes: 5,
  observed_at: "2026-09-08T10:00:00Z",
};

describe("fresh price guard", () => {
  it("never ranks an offline, closed or expired observation", () => {
    expect(currentPrice(station, true, 0)).toBe(1.7);
    expect(currentPrice(station, false, 0)).toBeNull();
    expect(currentPrice(station, true, 26)).toBeNull();
    expect(currentPrice({ ...station, status: "closed" }, true, 0)).toBeNull();
    expect(currentPrice({ ...station, price: null }, true, 0)).toBeNull();
    expect(currentPrice({ ...station, price: NaN }, true, 0)).toBeNull();
  });
});

describe("observed chart segments", () => {
  it("does not draw lines across closures, but holds the last open price", () => {
    const point = (hour: string, price: number | null, status = "open") => ({
      timestamp: `2026-09-08T${hour}:00Z`,
      price,
      status,
    });
    const result = segments([
      point("10:00", 1.7),
      point("10:05", null, "closed"),
      point("10:10", 1.8),
      point("11:00", 1.6),
    ]);
    expect(result.map((s) => s.pts.map((p) => p.y))).toEqual([
      [1.7],
      [1.8, 1.8, 1.6],
    ]);
  });
  it("never invents an empty price history", () =>
    expect(segments([])).toEqual([]));
});

describe("chart gap bands", () => {
  const minute = 60000;
  it("marks the night window as one band instead of drawing a line", () => {
    // Dichte 5-Minuten-Beobachtungen bis 22:00, dann Nachtlücke bis 06:00.
    const day = Date.parse("2026-09-08T06:00:00Z");
    const pts = Array.from({ length: 193 }, (_, i) => ({
      x: day + i * 5 * minute,
      y: 1.7,
    }));
    const morning = Date.parse("2026-09-09T06:00:00Z");
    pts.push({ x: morning, y: 1.8 });
    expect(gapBands([{ pts }], 30)).toEqual([
      { from: day + 192 * 5 * minute, to: morning },
    ]);
  });
  it("ignores short interruptions and merges duplicate times across series", () => {
    const a = [
      { x: 0, y: 1 },
      { x: 10 * minute, y: 1 },
    ];
    const b = [
      { x: 0, y: 1 },
      { x: 32 * minute, y: 1 },
    ];
    expect(gapBands([{ pts: a }, { pts: b }], 30)).toEqual([]);
  });
  it("returns nothing without points", () => expect(gapBands([], 30)).toEqual([]));
  it("marks window edge gaps only when a fixed window is requested", () => {
    const day = Date.parse("2026-09-08T06:00:00Z");
    // 20 Minuten Abstand: innen keine Lücke, an beiden Fensterrändern schon.
    const pts = [{ x: day + 60 * minute }, { x: day + 80 * minute }];
    const window: [number, number] = [day, day + 24 * 60 * minute];
    expect(gapBands([{ pts }], 30)).toEqual([]);
    expect(gapBands([{ pts }], 30, window)).toEqual([
      { from: day, to: day + 60 * minute },
      { from: day + 80 * minute, to: day + 24 * 60 * minute },
    ]);
  });
});

describe("compressed gap axis", () => {
  const hour = 3600000;
  it("shrinks an 8 h night gap to the configured display width", () => {
    const from = 0;
    const to = 24 * hour;
    const gaps = [{ from: 14 * hour, to: 22 * hour }];
    const axis = compressedAxis(from, to, gaps, 40);
    // 24 h minus 8 h Lücke plus 40 min Restbreite = 16 h 40 min.
    expect(axis.total).toBe(24 * hour - 8 * hour + 40 * 60000);
    expect(axis.map(from)).toBe(0);
    expect(axis.map(to)).toBe(axis.total);
    // Punkte vor der Lücke behalten ihren Abstand, Punkte danach rücken auf.
    expect(axis.map(14 * hour) - axis.map(10 * hour)).toBe(4 * hour);
    expect(axis.map(23 * hour) - axis.map(22 * hour)).toBe(hour);
    // Die Lücke selbst ist nur noch 40 Minuten breit.
    expect(axis.map(22 * hour) - axis.map(14 * hour)).toBe(40 * 60000);
    // Innerhalb der Lücke läuft die Abbildung linear weiter.
    expect(axis.map(18 * hour) - axis.map(14 * hour)).toBe(20 * 60000);
  });
  it("merges overlaps, clips to the window and keeps order", () => {
    const axis = compressedAxis(0, 10 * hour, [
      { from: 8 * hour, to: 20 * hour },
      { from: 1 * hour, to: 3 * hour },
      { from: 2 * hour, to: 4 * hour },
    ], 30);
    expect(axis.gaps).toEqual([
      { from: 1 * hour, to: 4 * hour },
      { from: 8 * hour, to: 10 * hour },
    ]);
    let prev = -1;
    for (let x = 0; x <= 10 * hour; x += 30 * 60000) {
      const value = axis.map(x);
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });
  it("passes small gaps through unchanged", () => {
    const axis = compressedAxis(0, 4 * hour, [{ from: hour, to: 1.5 * hour }], 40);
    expect(axis.total).toBe(4 * hour);
    expect(axis.map(3 * hour)).toBe(3 * hour);
  });
});

describe("air distance between stations", () => {
  it("measures Frankfurt–Gütersloh as roughly 200 km", () => {
    const km = haversineKm(50.11, 8.68, 51.9, 8.4);
    expect(km).toBeGreaterThan(195);
    expect(km).toBeLessThan(205);
  });
  it("is zero for identical points and symmetric", () => {
    expect(haversineKm(50.11, 8.68, 50.11, 8.68)).toBe(0);
    expect(haversineKm(50.11, 8.68, 48.14, 11.58)).toBeCloseTo(
      haversineKm(48.14, 11.58, 50.11, 8.68),
    );
  });
});

describe("automatic axis ticks", () => {
  it("covers a 12 h window with at most nine aligned ticks", () => {
    const from = Date.parse("2026-09-09T06:00:00Z");
    const to = from + 12 * 3600 * 1000;
    const ticks = autoTimeTicks(from, to);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(9);
    expect(ticks[0].x).toBeGreaterThanOrEqual(from);
    expect(ticks.at(-1)!.x).toBeLessThanOrEqual(to);
    // Gleichmäßiger, an vollen Stunden/Tagen ausgerichteter Abstand.
    const step = ticks[1].x - ticks[0].x;
    for (let i = 2; i < ticks.length; i++)
      expect(ticks[i].x - ticks[i - 1].x).toBe(step);
    expect(ticks.every((t) => /^\d{2}:\d{2}$/.test(t.label))).toBe(true);
  });
  it("prefixes midnight with the local date", () => {
    // 23:00 Berlin bis 05:00 Berlin am nächsten Morgen, Schritt 60 min.
    const from = Date.parse("2026-09-09T21:00:00Z");
    const to = from + 8 * 3600 * 1000;
    const ticks = autoTimeTicks(from, to);
    const midnight = ticks.find((t) => t.x === Date.parse("2026-09-09T22:00:00Z"));
    expect(midnight?.label).toBe("10.09. 00:00");
  });
  it("returns nothing for invalid windows", () => {
    expect(autoTimeTicks(10, 5)).toEqual([]);
    expect(autoTimeTicks(NaN, 5)).toEqual([]);
  });
  it("aligns ticks to Berlin wall clock, not UTC epoch", () => {
    // 24 h ab 08:00 Berlin, Schritt 180 min → Raster 09:00, 12:00, … (Berlin).
    const from = Date.parse("2026-09-09T06:00:00Z");
    const to = from + 24 * 3600 * 1000;
    const ticks = autoTimeTicks(from, to);
    expect(ticks[0].label).toBe("09:00");
    expect(ticks[1].label).toBe("12:00");
  });
});

describe("berlinHour/autoTimeValue", () => {
  it("meldet Berliner Stunde und Peak-Fenster", () => {
    // 18:00 UTC = 20:00 CEST (Sommerzeit) → Peak; 12:00 UTC = 14:00 CEST → offpeak.
    expect(berlinHour(new Date("2026-07-01T18:00:00Z"))).toBeCloseTo(20, 0);
    expect(autoTimeValue(new Date("2026-07-01T18:00:00Z"))).toEqual({
      z: 16,
      isPeak: true,
    });
    expect(autoTimeValue(new Date("2026-07-01T12:00:00Z"))).toEqual({
      z: 10,
      isPeak: false,
    });
  });
});

describe("detour economics", () => {
  const base = {
    refPrice: 2.12,
    altPrice: 2.04,
    liters: 40,
    km: 20,
    consumption: 7,
    speedKmh: 45,
    timeValueEurH: 12,
  };
  it("splits the gross saving into fuel and time costs", () => {
    const r = detourEconomics({ ...base, mode: "onroute" });
    expect(r.grossEur).toBeCloseTo(3.2, 10);
    expect(r.fuelEur).toBeCloseTo(2.856, 10);
    expect(r.timeEur).toBeCloseTo(16 / 3, 9);
    expect(r.netEur).toBeCloseTo(3.2 - 2.856 - 16 / 3, 9);
    expect(r.verdict).toBe("not_worth");
    // Preisvorteil müsste 20,47 ct/L betragen, um den Umweg zu refinanzieren.
    expect(r.criticalCtPerL).toBeCloseTo(20.47, 1);
  });
  it("counts a dedicated trip both ways", () => {
    const onroute = detourEconomics({ ...base, mode: "onroute" });
    const dedicated = detourEconomics({ ...base, mode: "dedicated" });
    expect(dedicated.fuelEur).toBeCloseTo(onroute.fuelEur * 2, 10);
    expect(dedicated.timeEur).toBeCloseTo(onroute.timeEur * 2, 10);
    expect(dedicated.km).toBe(onroute.km);
  });
  it("flags clearly profitable detours and borderline ones", () => {
    expect(
      detourEconomics({
        refPrice: 2.12,
        altPrice: 2.0,
        liters: 50,
        km: 5,
        mode: "onroute",
        consumption: 7,
        speedKmh: 45,
        timeValueEurH: 12,
      }).verdict,
    ).toBe("worth");
    expect(
      detourEconomics({
        refPrice: 2.12,
        altPrice: 2.06,
        liters: 40,
        km: 8,
        mode: "onroute",
        consumption: 5,
        speedKmh: 45,
        timeValueEurH: 5,
      }).verdict,
    ).toBe("borderline");
  });
});

describe("B4 decision scoring and lab outcomes", () => {
  const sampleRow = {
    day: "2026-09-01",
    cls: 0,
    mu: 2.4,
    p: 0.82,
    predHour: 19,
    p8: 173.9,
    predPrice: 169.5,
    s: 4.4,
    best: 5.2,
  };

  it("evaluates a wait outcome when mu >= eps", () => {
    const outcome = rowOutcome(sampleRow, 1.0, 40);
    expect(outcome.wait).toBe(true);
    expect(outcome.hit).toBe(true);
    expect(outcome.regretEur).toBeCloseTo(0.32, 2);
  });

  it("evaluates a now outcome when mu < eps", () => {
    const outcome = rowOutcome(sampleRow, 3.0, 40);
    expect(outcome.wait).toBe(false);
    expect(outcome.hit).toBe(false); // since s > 0, waiting would have been better
    expect(outcome.regretEur).toBeCloseTo(2.08, 2);
  });

  it("scores a collection of eval rows correctly", () => {
    const rows = [
      sampleRow,
      {
        day: "2026-09-02",
        cls: 0,
        mu: 1.2,
        p: 0.65,
        predHour: 18,
        p8: 172.0,
        predPrice: 174.0,
        s: -2.0, // price jump afternoon
        best: 0.0,
      },
    ];
    const score = scoreRows(rows, 1.5, 40, "test-station");
    expect(score.n).toBe(2);
    expect(score.n_wait).toBe(1);
    expect(score.n_now).toBe(1);
    expect(score.hit_wait).toBe(1.0);
    expect(score.hit_now).toBe(1.0); // day 2 had s < 0, so "now" was correct!
    expect(score.p_known).toBe(true);
    expect(score.p_avg).toBeCloseTo((0.82 + 0.65) / 2, 4);
  });

  it("treats null p as unknown, not as 0 %", () => {
    const rows = [
      { ...sampleRow, p: null },
      { ...sampleRow, day: "2026-09-02", p: 0.6 },
    ];
    const score = scoreRows(rows, 1.5, 40, "test-station");
    expect(score.p_known).toBe(true);
    expect(score.p_avg).toBeCloseTo(0.6, 4);
    const none = scoreRows([{ ...sampleRow, p: null }], 1.5, 40, "s");
    expect(none.p_known).toBe(false);
    expect(none.p_avg).toBe(0);
  });
});


describe("issue 50 trigger labels (Ereignis-Pipeline)", () => {
  it("formats epoch seconds as Berlin time and hides invalid values", () => {
    expect(epochLabel(1767268800)).toBe("01.01., 13:00");
    expect(epochLabel("1767268800")).toBe("01.01., 13:00");
    expect(epochLabel(null)).toBe("—");
    expect(epochLabel(undefined)).toBe("—");
    expect(epochLabel("")).toBe("—");
    expect(epochLabel("x")).toBe("—");
    expect(epochLabel(-5)).toBe("—");
    expect(epochLabel(NaN)).toBe("—");
  });

  it("maps scheduler skip decisions to honest copy", () => {
    expect(triggerSkipLabel("debounced")).toBe("Debounce (Mindestabstand)");
    expect(triggerSkipLabel("duplicate")).toBe("Idempotenz (gleiche Daten)");
    expect(triggerSkipLabel(null)).toBeNull();
    expect(triggerSkipLabel(undefined)).toBeNull();
    expect(triggerSkipLabel("other")).toBeNull();
  });
});

describe("job start button (Startknopf ohne Passwort)", () => {
  it("translates scheduler answers into honest copy", () => {
    expect(jobRunMessage({ status: "queued", job: "models" })).toEqual({
      tone: "ok",
      text: "Gestartet — der Lauf beginnt sofort.",
    });
    expect(jobRunMessage({ status: "running", job: "models" }).tone).toBe("ok");
    expect(jobRunMessage({ status: "debounced", retry_after: 42 }).text).toBe(
      "Gerade erst gelaufen — in 42 s erneut möglich.",
    );
    // Unbekannte Antwort ist ein Fehler, kein stilles „ok“.
    expect(jobRunMessage({ status: "rejected" }).tone).toBe("error");
    expect(jobRunMessage(null).tone).toBe("error");
  });

  it("explains refused starts instead of blaming the user", () => {
    expect(jobRunMessage({ error_code: "not_found" }).text).toContain(
      "nicht freigegeben",
    );
    expect(jobRunMessage({ error_code: "rate_limited" }).tone).toBe("warn");
    expect(jobRunMessage({ error_code: "request_failed" }).text).toContain(
      "nicht erreichbar",
    );
  });
});

describe("live phase hints (Kalibrierungs-Freigabe)", () => {
  const phase = {
    as_of: "2026-09-11T01:00:00+00:00",
    stations: 2,
    good_complete_days: 2,
    best_complete_days: 7,
    required_complete_days: 90,
    days_missing: 88,
    min_daily_coverage: 0.95,
    live_only_stations: 0,
    complete: false,
  };

  it("never invents a countdown when the engine published nothing", () => {
    // Regression: ohne data_policy zeigte die Kachel „Noch 21 von 21 …“ —
    // eine Frontend-Erfindung, die zwei Tage nach Live-Schaltung nicht sinkt.
    expect(livePhaseCountdown(null)).toBeNull();
    expect(livePhaseCountdown(undefined)).toBeNull();
    expect(livePhaseHint(null)).toContain("keine Live-Abdeckungsdaten");
    expect(livePhaseHint(null)).not.toMatch(/\d+ von \d+/);
  });

  it("quotes the engine threshold instead of a made-up 21 days", () => {
    const line = livePhaseCountdown(phase);
    expect(line).toContain("Noch 88 von 90 bewerteten Live-Tagen");
    expect(line).toContain("(2/90, schwächste von 2 Stationen)");
    expect(line).toContain("Tagesabdeckung ≥ 95 %");
    expect(line).toContain("Datenstand 11.09.2026");
    expect(line).toContain("voraussichtlich ab 08.12.2026");
  });

  it("stays silent once the live phase is reached", () => {
    const done = { ...phase, days_missing: 0, good_complete_days: 90, complete: true };
    expect(livePhaseCountdown(done)).toBeNull();
    expect(livePhaseHint(done)).toContain("Live-Phase erreicht");
  });

  it("derives the ETA from the engine data date in Berlin days", () => {
    // 22:00 UTC ist bereits Mitternacht Berlin → anderer Kalendertag als der
    // des Browsers/UTC; ein Datum ohne Datenstand wird nicht erfunden.
    expect(dayAfterLabel(1, "2026-09-11T22:00:00Z")).toBe("13.09.2026");
    expect(dayAfterLabel(1, "2026-09-11T21:00:00Z")).toBe("12.09.2026");
    expect(dayAfterLabel(5, null)).toBeNull();
  });

  it("explains the Brier gate as a count of recommendations, not a date", () => {
    const hint = brierGateHint(phase, { n: 3, brier_30d: null });
    expect(hint).toContain("100 abgeschlossenen Empfehlungen");
    expect(hint).toContain("aktuell 3");
    expect(hint).toContain("noch 88 vollständige Live-Tage");
    expect(brierGateHint(null, { n: 3, brier_30d: null })).toContain(
      "keine Engine-Daten",
    );
    expect(brierGateHint(phase, { n: 120, brier_30d: 0.18 })).toBeNull();
  });
});
