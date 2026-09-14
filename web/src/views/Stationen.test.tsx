// @vitest-environment happy-dom
// Stationen: Render-Tests des Preis-Atlas (UI-NEUENTWURF §5.2).
//
// Geprüft wird, was der Nutzer tatsächlich bekommt: die feste Reihenfolge
// Karte → Liste → Detail → Vergleich → Frische-Fußzeile, die Referenz als
// sichtbaren Bezugspunkt, die ehrlichen Zustände (S0, Laden, Leere, Fehler)
// und — wichtig — dass ein decide-`error_code` (Datenfolge) KEIN roter
// Fehler ist. Die Fachlogik selbst steht in `stations.test.ts`.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DecideResult, Stations, Station } from "../data";
import { StationenView, type StationenViewProps } from "./Stationen";
import type { Point } from "../data";
import type { StripCell } from "../strip";

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

function decide(overrides: Partial<DecideResult> = {}): DecideResult {
  return {
    primary: {
      action: "no_advice",
      station: { id: "aral", name: "Station aral", price_now: 1.749, maps_url: null },
      recommended_window: null,
      expected_saving_eur: 0,
      p_correct: null,
      confidence_badge: "low",
      reason_short: "Keine klare Empfehlung.",
    },
    alternatives_nearby: [],
    windows_today: [],
    windows_week: [],
    episode: { id: "e1", status: "open", intent: "none" },
    personal_stats: {
      advice: { last_30d_hits: 0, last_30d_total: 0, hit_rate: null, brier_30d: null },
      wallet: { fills_30d: 0, followed: 0, saved_eur_30d: 0 },
    },
    calibrated: false,
    decision_ready: false,
    ...overrides,
  };
}

function stationsPayload(rows: Station[]): Stations {
  return {
    generated_at: minutesAgo(4),
    cities: ["Frankfurt"],
    fuel: "e10",
    stations: rows,
    connection_error: null,
    fresh_prices: rows.filter((r) => r.price !== null).length,
  };
}

const noop = () => {};
const priceOf = (row: Station) => (row.fresh ? row.price : null);

const baseProps: StationenViewProps = {
  activeCity: "Frankfurt",
  data: stationsPayload([station("aral")]),
  stations: [station("aral")],
  price: priceOf,
  elapsed: 0,
  online: true,
  selectedId: "",
  setSelectedId: noop,
  pinnedIds: [],
  togglePin: noop,
  pinNote: null,
  decideRes: {
    data: decide(),
    error: false,
    errorCode: null,
    pending: false,
    receivedAt: 0,
  },
  stripCells: [] as StripCell[],
  series7d: {
    data: { points: [] as Point[], error_code: null },
    error: false,
    errorCode: null,
    pending: false,
    receivedAt: 0,
  },
  liters: 40,
  timeValue: 0,
  timeValueUsed: 10,
  autoZ: { z: 10, isPeak: false },
  onTimeValue: noop,
  pricesAt: minutesAgo(4),
  onRetry: noop,
  onNavigate: noop,
  searchFocusSignal: 0,
  now: NOW,
};

function render(overrides: Partial<StationenViewProps> = {}) {
  const props = { ...baseProps, ...overrides } as StationenViewProps;
  return renderToStaticMarkup(<StationenView {...props} />);
}

describe("Stationen: Aufbau", () => {
  it("hält die feste Reihenfolge ein und zeigt die Frische-Fußzeile", () => {
    const html = render();
    const map = html.indexOf("Karte — Pin = Netto-€");
    const list = html.indexOf("1 Stationen");
    const fresh = html.indexOf("vor 4 Min.");
    expect(map).toBeGreaterThanOrEqual(0);
    expect(list).toBeGreaterThan(map);
    expect(fresh).toBeGreaterThan(list);
  });

  it("markiert die Referenz als sichtbaren Bezugspunkt", () => {
    const html = render({
      stations: [station("aral", { price: 1.749 }), station("b", { price: 1.689 })],
      data: stationsPayload([
        station("aral", { price: 1.749 }),
        station("b", { price: 1.689 }),
      ]),
    });
    expect(html).toContain("Station b als Referenz und Detail wählen");
    expect(html).toContain("Referenz");
  });
});

describe("Stationen: Zustände", () => {
  it("S0: ohne Stationen führt die Karte zur Einrichtung", () => {
    const html = render({ stations: [], data: stationsPayload([]) });
    expect(html).toContain("Erst ein Set, dann der Atlas");
    expect(html).toContain("Einrichtung ansehen");
  });

  it("Leere: frische Stationen ohne Preis — ehrlicher Hinweis, kein Fehler", () => {
    const rows = [station("aral", { price: null, fresh: false, observed_at: null, age_minutes: null })];
    const html = render({ stations: rows, data: stationsPayload(rows) });
    expect(html).toContain("Noch kein frischer Preis");
    expect(html).not.toContain('role="alert"');
  });

  it("Laden: der 7-Tage-Verlauf der gewählten Station zeigt sein Skelett", () => {
    const html = render({
      series7d: { data: null, error: false, errorCode: null, pending: true, receivedAt: 0 },
    });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Verlauf wird geladen");
  });

  it("Fehler: nur eine tote Datenquelle ist ein roter Fehler", () => {
    const html = render({
      data: null,
      stations: [],
      decideRes: {
        data: null,
        error: true,
        errorCode: "request_failed",
        pending: false,
        receivedAt: 0,
      },
    });
    expect(html).toContain('role="alert"');
  });
});

describe("Stationen: Datenfolge ist kein Defekt (Regression)", () => {
  // Auf einem frischen Server liefert /decide einen `error_code`
  // (z. B. „polling_missing“) mit HTTP 200 — eine Konsequenz fehlender
  // Daten, kein Transportfehler. Die Liste darf dann nicht rot werden.
  it("zeigt den Leerzustand, obwohl decide einen error_code trägt", () => {
    const broken = { error_code: "polling_missing" } as unknown as DecideResult;
    const html = render({
      stations: [],
      data: stationsPayload([]),
      decideRes: {
        data: broken,
        error: false,
        errorCode: null,
        pending: false,
        receivedAt: 0,
      },
    });
    expect(html).toContain("Erst ein Set, dann der Atlas");
    expect(html).not.toContain('role="alert"');
  });
});
