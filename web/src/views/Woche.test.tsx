// @vitest-environment happy-dom
// Woche: Render-Tests des Zeit-Planers (UI-NEUENTWURF §5.3).
//
// Geprüft wird, was der Nutzer tatsächlich bekommt: die Tank-Zeile, das
// 7-Tage-Raster mit Ehrlichkeits-Regeln (leere Tage, „noch unsicher“
// ab Tag 5) und die Zustände (S0, Laden, Fehler). Die Fachlogik selbst
// steht in `week.test.ts`.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DecideResult } from "../data";
import { WocheView, type WocheViewProps } from "./Woche";

const NOW = Date.parse("2026-09-14T12:00:00+02:00"); // Montag 14.09.
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

function decide(
  overrides: Partial<DecideResult> = {},
): DecideResult {
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
    ...overrides,
  };
}

const baseProps: WocheViewProps = {
  activeCity: "Frankfurt",
  stationsCount: 2,
  decideRes: {
    data: decide(),
    error: false,
    errorCode: null,
    pending: false,
    receivedAt: 0,
  },
  priceNow: 1.759,
  tankPercent: null,
  setTankPercent: () => {},
  tankCapacity: 50,
  consumption: 7,
  forecastAt: minutesAgo(30),
  pricesAt: minutesAgo(4),
  onRetry: () => {},
  onNavigate: () => {},
  now: NOW,
};

function render(overrides: Partial<WocheViewProps> = {}) {
  const props = { ...baseProps, ...overrides } as WocheViewProps;
  return renderToStaticMarkup(<WocheView {...props} />);
}

describe("Woche: Aufbau", () => {
  it("steht über der Tank-Zeile und dem Raster, mit Frische-Fußzeile", () => {
    const html = render();
    const tank = html.indexOf("Tankstand nicht angegeben");
    const grid = html.indexOf("Beste Fenster (7 Tage)");
    const fresh = html.indexOf("Preise vor 4 Minuten");
    expect(tank).toBeGreaterThanOrEqual(0);
    expect(grid).toBeGreaterThan(tank);
    expect(fresh).toBeGreaterThan(grid);
  });

  it("ohne Fenster: ehrliche Leere statt erfundener Tage", () => {
    const html = render();
    expect(html).toContain(
      "Keine Fenster mit Vorsprung in den nächsten 7 Tagen",
    );
    expect(html).not.toContain('role="listbox"');
  });

  it("unkalibriert: die Lern-Notiz steht vor der Leere (Stufe B, ehrlich)", () => {
    const html = render({
      decideRes: {
        data: decide({
          calibrated: false,
          decision_ready: false,
          personal_stats: {
            advice: { last_30d_hits: 0, last_30d_total: 0, hit_rate: null, brier_30d: null },
            wallet: { fills_30d: 0, followed: 0, saved_eur_30d: 0 },
          },
        }),
        error: false,
        errorCode: null,
        pending: false,
        receivedAt: 0,
      },
    });
    expect(html).toContain("Das Modell lernt noch");
  });

  it("mit Fenstern: Raster mit Tag, Uhrzeit, Sternen — Tage 5–7 „noch unsicher“", () => {
    const html = render({
      decideRes: {
        data: decide({
          windows_week: [
            {
              start: "2026-09-15T19:00:00+02:00",
              end: "2026-09-15T21:00:00+02:00",
              expected_price: 1.709,
              expected_saving_eur: 2,
              p: 0.8,
            },
            {
              start: "2026-09-18T08:00:00+02:00",
              end: "2026-09-18T10:00:00+02:00",
              expected_price: 1.689,
              expected_saving_eur: null,
              p: null,
            },
          ],
        }),
        error: false,
        errorCode: null,
        pending: false,
        receivedAt: 0,
      },
    });
    expect(html).toContain('role="listbox"');
    // Heute (Mo 14.09.) ohne Fenster: der Tag bleibt sichtbar, ohne Wert.
    expect(html).toContain("Mo · heute");
    // Bestes Fenster: Dienstag 19–21 Uhr mit drei Sternen (p 0,8).
    expect(html).toContain("19–21 Uhr");
    expect(html).toContain("3 von 3 Sternen — ziemlich sicher");
    // Freitag (Index 4) ist Horizont: „noch unsicher“.
    expect(html).toContain("noch unsicher");
    // Auswahl-Detail: der günstigste Tag gewinnt.
    expect(html).toContain("Morgen");
  });

  // T1: Bild und Legende müssen dieselbe Richtung haben — sonst hält man den
  // teuersten Tag für den besten.
  it("Wochenlinie: der günstigste Tag bekommt den höchsten Balken", () => {
    const html = render({
      decideRes: {
        data: decide({
          windows_week: [
            {
              start: "2026-09-14T19:00:00+02:00",
              end: "2026-09-14T21:00:00+02:00",
              expected_price: 1.799, // teuerster Tag der Woche
              expected_saving_eur: null,
              p: 0.8,
            },
            {
              start: "2026-09-15T19:00:00+02:00",
              end: "2026-09-15T21:00:00+02:00",
              expected_price: 1.659, // günstigster Tag der Woche
              expected_saving_eur: null,
              p: 0.8,
            },
          ],
        }),
        error: false,
        errorCode: null,
        pending: false,
        receivedAt: 0,
      },
    });
    const heights = [...html.matchAll(/style="height:(\d+(?:\.\d+)?)px"/g)].map(
      (match) => Number(match[1]),
    );
    // Balken 1 = Montag (teuer), Balken 2 = Dienstag (günstig).
    expect(heights.length).toBeGreaterThanOrEqual(2);
    expect(heights[1]).toBeGreaterThan(heights[0]);
    // Legende und aria-label nennen dieselbe Richtung.
    expect(html).toContain("höher = günstiger");
    expect(html).toContain("höherer Balken ist der günstigere Tag");
    expect(html).toContain("günstigster Tag der Woche");
  });

  // T11: „Ersparnis“ ohne Vorzeichen — die Richtung steht im Wort.
  it("Fensterliste nennt die Ersparnis als Betrag mit Richtung", () => {
    const html = render({
      decideRes: {
        data: decide({
          windows_week: [
            {
              start: "2026-09-15T19:00:00+02:00",
              end: "2026-09-15T21:00:00+02:00",
              expected_price: 1.659,
              expected_saving_eur: 1.6,
              p: 0.8,
            },
          ],
        }),
        error: false,
        errorCode: null,
        pending: false,
        receivedAt: 0,
      },
    });
    expect(html).toContain("1,60 € günstiger");
    expect(html).not.toContain("−1,60 €");
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

describe("Woche: Kalibrierungsstand (A70, M2)", () => {
  it("spätere Tage heißen Szenarioprognose, nicht kalibriert", () => {
    const html = render({
      decideRes: {
        data: decide({
          windows_week: [
            {
              start: "2026-09-15T19:00:00+02:00",
              end: "2026-09-15T21:00:00+02:00",
              expected_price: 1.709,
              expected_saving_eur: 2,
              p: 0.8,
            },
          ],
        }),
        error: false,
        errorCode: null,
        pending: false,
        receivedAt: 0,
      },
    });
    expect(html).toContain("Szenarioprognose (unkalibriert)");
  });
});

describe("Woche: Tankrabatt am Stichtag (01.10.)", () => {
  // Dienstag 29.09. 12:00 — morgen um 00:00 gilt der Rabatt.
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
      decideRes: {
        data: decide({ windows_week: [windowMorning], regime_notice }),
        error: false,
        errorCode: null,
        pending: false,
        receivedAt: 0,
      },
    });

  it("Uhrzeit steht mit Minuten, nicht als „06–07 Uhr“ und nie als Dezimalzahl", () => {
    const html = rabatt(notice);
    expect(html).toContain("06:10–07:55 Uhr");
    expect(html).not.toContain("06–07 Uhr");
    expect(html).not.toMatch(/\d\.\d{6,}/);
  });

  it("zeigt den Hinweis vor den Fenstern und rechnet keinen Abstand über den Stichtag", () => {
    const html = rabatt(notice);
    expect(html).toContain("Tankrabatt ab 01.10.: bis zu 17 ct/L weniger");
    expect(html.indexOf("Tankrabatt ab 01.10.")).toBeLessThan(
      html.indexOf("Beste Fenster (7 Tage)"),
    );
    expect(html).toContain("Abstand zu jetzt nicht belastbar");
    expect(html).not.toContain("ct/L günstiger als jetzt");
    // Liste „nach Ersparnis“: keine Ersparnis-Zahl für das Fenster hinter dem Stichtag.
    expect(html).not.toContain("0,29 € günstiger");
  });

  it("ohne Termin bleibt alles wie vorher", () => {
    const html = rabatt(null);
    expect(html).not.toContain("Tankrabatt");
    expect(html).toContain("ct/L günstiger als jetzt");
  });
});
