// @vitest-environment happy-dom
// Woche: Render-Tests des Zeit-Planers (UX-NEUENTWURF §4).
//
// Geprüft wird, was der Nutzer tatsächlich bekommt: die Tank-Zeile als
// **Anzeige** (Pflege an genau einem Ort), die Bestenliste mit höchstens
// drei Einträgen, Sicherheit als ein Wort, der eine Satz zur
// Prognosebreite — und alles, was nicht mehr auf dem Schirm steht
// (7-Tage-Raster, Sterne, Prozentwerte, Wochenlinie, Detailkarte,
// zweite Liste, Tankstands-Schieber). Die Fachlogik steht in `week.test.ts`.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DecideResult } from "../data";
import { WocheView, type WocheViewProps } from "./Woche";

const NOW = Date.parse("2026-09-14T12:00:00+02:00"); // Montag 14.09.
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

function decide(overrides: Partial<DecideResult> = {}): DecideResult {
  return {
    primary: {
      action: "no_advice",
      station: { id: "a", name: "A-Station", brand: "Test", price_now: 1.759, maps_url: null },
      recommended_window: null,
      expected_saving_eur: 0,
      p_correct: null,
      confidence_badge: "low",
      reason_short: "Kein Fenster mit Vorsprung.",
    },
    alternatives_nearby: [],
    windows_today: [],
    windows_week: [],
    episode: { id: "e1", status: "open", intent: "none" },
    personal_stats: {
      advice: { last_30d_hits: 94, last_30d_total: 120, hit_rate: 0.78, brier_30d: 0.2 },
      wallet: { fills_30d: 0, followed: 0, saved_eur_30d: 0 },
    },
    calibrated: true,
    decision_ready: true,
    tank: null,
    ...overrides,
  };
}

const idle = (data: DecideResult | null) => ({
  data,
  error: false,
  errorCode: null,
  pending: false,
  receivedAt: 0,
});

const baseProps: WocheViewProps = {
  activeCity: "Frankfurt",
  fuel: "e10",
  stationsCount: 2,
  decideRes: idle(decide()),
  priceNow: 1.759,
  tankPercent: null,
  onEditTank: () => {},
  tankCapacity: 50,
  stripCells: [],
  forecastAt: minutesAgo(30),
  pricesAt: minutesAgo(4),
  onRetry: () => {},
  onNavigate: () => {},
  onDeepen: () => {},
  now: NOW,
};

function render(overrides: Partial<WocheViewProps> = {}) {
  const props = { ...baseProps, ...overrides } as WocheViewProps;
  return renderToStaticMarkup(<WocheView {...props} />);
}

const windows = (list: Array<Record<string, unknown>>) =>
  list.map((w) => ({
    start: "2026-09-15T19:00:00+02:00",
    end: "2026-09-15T21:00:00+02:00",
    expected_price: 1.709,
    expected_saving_eur: 2,
    p: 0.8,
    ...w,
  })) as DecideResult["windows_week"];

describe("Woche: Aufbau (§4 — Bestenliste statt Raster)", () => {
  it("hält die Reihenfolge ein: Tank-Anzeige → Bestenliste → Detail", () => {
    const html = render({
      decideRes: idle(decide({ windows_week: windows([{}]) })),
    });
    const tank = html.indexOf("Tank: keine Angabe");
    const list = html.indexOf('id="woche-liste"');
    const detail = html.indexOf('id="woche-detail"');
    expect(tank).toBeGreaterThanOrEqual(0);
    expect(list).toBeGreaterThan(tank);
    expect(detail).toBeGreaterThan(list);
  });

  it("nennt Kopf, Ort, Kraftstoff und Frische-Chip", () => {
    const html = render();
    expect(html).toContain("Frankfurt");
    expect(html).toContain("E10");
    expect(html).toContain("vor 4 Minuten");
  });

  it("jeder Eintrag trägt Tag, Zeit, Preis, Ersparnis und Sicherheit als Wort", () => {
    const html = render({
      decideRes: idle(
        decide({
          // Eine freigegebene Empfehlung: erst dann trägt die Prognose einen
          // gemessenen Prozentwert — und das Sicherheitwort kommt aus ihm.
          primary: { ...decide().primary, action: "wait" },
          windows_week: windows([
            { start: "2026-09-15T19:00:00+02:00", end: "2026-09-15T21:00:00+02:00" },
            { start: "2026-09-16T08:00:00+02:00", end: "2026-09-16T10:00:00+02:00", expected_price: 1.729, expected_saving_eur: 0.8 },
          ]),
        }),
      ),
    });
    expect(html).toContain("<ol");
    expect(html).toContain("Morgen");
    expect(html).toContain("19–21 Uhr");
    expect(html).toContain("1,709 €/L");
    expect(html).toContain("spart ca. 2,00 €");
    expect(html).toContain("ziemlich sicher");
  });

  it("höchstens drei Einträge — selbst bei sieben Fenstern", () => {
    const many = [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
      start: `2026-09-1${5 + offset}T19:00:00+02:00`,
      end: `2026-09-1${5 + offset}T21:00:00+02:00`,
      expected_price: 1.7 - offset * 0.01,
      expected_saving_eur: 2 - offset * 0.2,
      p: 0.8,
    }));
    const html = render({
      decideRes: idle(decide({ windows_week: windows(many) })),
    });
    const items = html.split("<li>").slice(1);
    expect(items).toHaveLength(3);
  });

  it("der eine Satz zur Prognosebreite steht unter der Liste", () => {
    const html = render({
      decideRes: idle(decide({ windows_week: windows([{}]) })),
    });
    expect(html).toContain("Ab Tag 5 wird die Prognose unsicher.");
    expect(html.split("Ab Tag 5 wird die Prognose unsicher.").length - 1).toBe(
      1,
    );
  });

  it("kein Fenster: ehrliche Leere statt erfundener Tage", () => {
    const html = render();
    expect(html).toContain("Keine Fenster mit Vorsprung in den nächsten 7 Tagen");
    expect(html).not.toContain("<ol");
  });

  it("unkalibriert: die Lern-Notiz steht statt der Leere", () => {
    const html = render({
      decideRes: idle(
        decide({
          calibrated: false,
          decision_ready: false,
          personal_stats: {
            advice: { last_30d_hits: 0, last_30d_total: 0, hit_rate: null, brier_30d: null },
            wallet: { fills_30d: 0, followed: 0, saved_eur_30d: 0 },
          },
        }),
      ),
    });
    expect(html).toContain("Das Modell lernt noch");
  });
});

describe("Woche: Streichliste (§4/§7)", () => {
  const html = render({
    decideRes: idle(decide({ windows_week: windows([{}]) })),
  });

  it("kein 7-Tage-Raster, keine Sterne, keine Prozentwerte", () => {
    expect(html).not.toContain("Beste Fenster (7 Tage)");
    expect(html).not.toContain("von 3 Sternen");
    expect(html).not.toContain("% sicher");
    expect(html).not.toMatch(/\d+ %/);
  });

  it("keine Wochenlinie mit „höher = günstiger“", () => {
    // Die Balken liefen gegen jede Lesegewohnheit (§4) — weg.
    expect(html).not.toContain("höher = günstiger");
    expect(html).not.toContain("Wochenlinie");
    expect(html).not.toMatch(/style="height:\d/);
  });

  it("keine Detailkarte, keine zweite Liste, keine Kalibrierungs-Etiketten", () => {
    expect(html).not.toContain("Szenarioprognose (unkalibriert)");
    expect(html.split("<ol").length - 1).toBe(1);
  });

  it("der Tankstand wird angezeigt, nicht gepflegt (§6 — ein Ort: „Ich“)", () => {
    expect(html).toContain("Tank: keine Angabe");
    expect(html).toContain("Ändern");
    // Kein Schieber, keine Schnellauswahl in dieser Ansicht.
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain(">¼<");
  });
});

describe("Woche: Zustände", () => {
  it("S0: ohne Stationen führt die Karte zur Einrichtung", () => {
    const html = render({ stationsCount: 0 });
    expect(html).toContain("Noch keine Stationen — erst das Polling-Set");
    expect(html).toContain("Einrichtung ansehen");
  });

  it("Laden: Skelett meldet sich als beschäftigt", () => {
    const html = render({
      decideRes: { data: null, error: false, errorCode: null, pending: true, receivedAt: 0 },
    });
    expect(html).toContain("Fenster werden berechnet");
  });

  it("Fehler: Klartext-Karte statt leerer Fläche", () => {
    const html = render({
      decideRes: { data: null, error: true, errorCode: "influx_read_failed", pending: false, receivedAt: 0 },
    });
    expect(html).toContain('role="alert"');
  });
});

describe("Woche: Zeitstempel als Uhrzeit, nie als Dezimalstunden", () => {
  it("zeigt das Samstag-Fenster 07:40–07:55 mit Minuten", () => {
    const now = Date.parse("2026-10-03T06:00:00+02:00");
    const html = render({
      now,
      priceNow: 2.119,
      decideRes: idle(
        decide({
          windows_week: windows([
            {
              start: "2026-10-03T05:40:00Z",
              end: "2026-10-03T05:55:00Z",
              expected_price: 2.269,
              expected_saving_eur: null,
              p: null,
            },
          ]),
        }),
      ),
    });
    expect(html).toContain("07:40–07:55 Uhr");
    expect(html).toContain("2,269 €/L");
    expect(html).not.toContain("7.666666666666667");
    expect(html).not.toContain("7.916666666666667");
  });
});

describe("Woche: Tankrabatt am Stichtag (01.10.)", () => {
  // Mittwoch 30.09. 12:00 — morgen um 00:00 gilt der Rabatt.
  const RABATT_NOW = Date.parse("2026-09-30T12:00:00+02:00");
  const windowMorning = {
    start: "2026-10-01T06:10:00+02:00",
    end: "2026-10-01T07:55:00+02:00",
    expected_price: 2.272,
    expected_saving_eur: 0.3,
    expected_saving_median_eur: 0.29,
    p: 0.6,
  };
  const notice = {
    at: "2026-09-30T22:00:00+00:00",
    announced_local: "2026-10-01T00:00",
    announced_ct: -17,
    status: "announced",
    phase: "upcoming" as const,
    days: 0,
  };
  const rabatt = (regime_notice: typeof notice | null) =>
    render({
      now: RABATT_NOW,
      priceNow: 2.279,
      decideRes: idle(decide({ windows_week: windows([windowMorning]), regime_notice })),
    });

  it("Uhrzeit steht mit Minuten, nie als Dezimalzahl", () => {
    const html = rabatt(notice);
    expect(html).toContain("06:10–07:55 Uhr");
    expect(html).not.toContain("06–07 Uhr");
    expect(html).not.toMatch(/\d\.\d{6,}/);
  });

  it("der Hinweis ordnet die Zahlen ein und die Ersparnis fehlt hinter der Kante", () => {
    const html = rabatt(notice);
    expect(html).toContain("Tankrabatt ab 01.10.: bis zu 17 ct/L weniger");
    expect(html.indexOf("Tankrabatt ab 01.10.")).toBeLessThan(
      html.indexOf("<ol"),
    );
    // Kein Abstand über den Stichtag: statt einer Zahl das Fenster allein.
    expect(html).not.toContain("spart ca. 0,29 €");
    expect(html).toContain("2,272 €/L");
  });

  it("ohne Termin bleibt der Abstand stehen", () => {
    const html = rabatt(null);
    expect(html).not.toContain("Tankrabatt");
    expect(html).toContain("spart ca. 0,29 €");
  });
});

describe("Woche: Tagesverlauf als Detail (§4, ein Tipp)", () => {
  it("steht nur für den heutigen Eintrag — geschätzt wird nichts", () => {
    const cells = [
      { hour: 6, value: 1.789, latest: 1.789, tone: "pricey" as const, current: false },
      { hour: 12, value: 1.759, latest: 1.759, tone: "mid" as const, current: true },
      { hour: 18, value: 1.709, latest: 1.709, tone: "cheap" as const, current: false },
    ];
    const today = render({
      stripCells: cells,
      decideRes: idle(
        decide({
          windows_week: windows([
            { start: "2026-09-14T19:00:00+02:00", end: "2026-09-14T21:00:00+02:00" },
          ]),
        }),
      ),
    });
    expect(today).toContain("Tagesverlauf");
    expect(today).toContain("Heute");

    // Fenster erst übermorgen: keine Messwerte, also kein Knopf.
    const later = render({
      stripCells: cells,
      decideRes: idle(decide({ windows_week: windows([{}]) })),
    });
    expect(later).not.toContain(">Tagesverlauf</button>");
  });

  it("die Kurve hat eine Textalternative (M8)", () => {
    const html = render({
      stripCells: [
        { hour: 6, value: 1.789, latest: 1.789, tone: "pricey" as const, current: false },
        { hour: 12, value: 1.759, latest: 1.759, tone: "mid" as const, current: true },
      ],
      decideRes: idle(
        decide({
          windows_week: windows([
            { start: "2026-09-14T19:00:00+02:00", end: "2026-09-14T21:00:00+02:00" },
          ]),
        }),
      ),
    });
    // Das Blatt ist zu — die Kurve wird erst auf Tipp gemalt.
    expect(html).not.toMatch(/<dialog[^>]* open/);
    expect(html).toContain('aria-haspopup="dialog"');
  });
});
