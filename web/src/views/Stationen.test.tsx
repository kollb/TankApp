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
  seriesSpan: 168,
  onSeriesSpan: noop,
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
    const fresh = html.indexOf("vor 4 Minuten");
    expect(map).toBeGreaterThanOrEqual(0);
    expect(list).toBeGreaterThan(map);
    expect(fresh).toBeGreaterThan(list);
  });

  it("M1: der Filter-Chip „nur offene“ steht bereit und nennt seine Regel", () => {
    const html = render();
    expect(html).toContain("alle Stationen");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Filter: nur offene Stationen");
    // V2: Die Regel steht im Text, nicht nur im Tooltip.
    expect(html).toContain(
      "„offen“ zeigt nur Stationen mit aktuellem Preis für den gewählten",
    );
  });

  it("trägt keinen Mini-Verlauf in der Zeile — der Verlauf ist ein Knopf", () => {
    // 0.53.0: Die Mini-Sparkline der gewählten Zeile ist entfallen
    // (Nutzer-Urteil 18.09.2026: „niemand kann was mit dem Graphen
    // anfangen“). Die 96 × 24 px ohne Achse, Zeitbezug und y-Skala trugen
    // keine lesbare Aussage; der Verlauf steht als eigener Knopf je Zeile im
    // Stations-Detail. Dieser Ratchet verhindert, dass die Linie als
    // „Dekoration“ zurückkommt — eine Linie ohne Achsen gibt es hier nicht
    // mehr.
    const html = render({
      stations: [station("aral", { price: 1.749 })],
      stripCells: [
        { hour: 6, value: 1.759, latest: 1.759, tone: "pricey", current: false },
        { hour: 12, value: 1.709, latest: 1.709, tone: "cheap", current: true },
        { hour: 18, value: 1.729, latest: 1.729, tone: "mid", current: false },
      ],
    });
    const list = html.slice(html.indexOf("1 Stationen"), html.indexOf("Station-Nr-1"));
    expect(list).not.toContain("<polyline");
    expect(list).not.toContain("Preisverlauf der letzten 24 Stunden");
    // Der Weg zum lesbaren Verlauf bleibt: ein Knopf je Zeile.
    expect(list).toContain("Verlauf von Station aral ansehen");
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

  // O44 (Befund 17.09.2026): Mit Stationen rendert der Vergleich — und der
  // las `decide.alternatives_nearby.find(...)` ohne Klammer-Zusatz. Ein
  // Fehlerpayload (`{error_code, detail}`) hat keine Alternativen: Die
  // Ansicht stürzte komplett ab („Cannot read properties of undefined“),
  // obwohl sie laut Entwurf nur den Vergleich ohne Server-Netto zeigen soll.
  it("stürzt mit Stationen nicht am Fehlerpayload ab und vergleicht ohne Server-Netto", () => {
    const broken = {
      error_code: "decide_failed",
      detail: "TypeError: unsupported operand type(s) for -: 'float' and 'NoneType'",
    } as unknown as DecideResult;
    const rows = [station("aral", { price: 1.749 }), station("b", { price: 1.689 })];
    const html = render({
      stations: rows,
      data: stationsPayload(rows),
      decideRes: {
        data: broken,
        error: false,
        errorCode: null,
        pending: false,
        receivedAt: 0,
      },
    });
    // Der Preisseiten-Vergleich steht weiter da — ohne Quelle-Zeile, weil der
    // Server nichts gerechnet hat (kein Server-Netto, ehrlich „ohne Umweg“).
    expect(html).toContain("A gegen B");
    expect(html).toContain("ohne Umweg");
    expect(html).not.toContain("Quelle: die Umweg-Rechnung des Servers");
    // Der Grund bleibt der Datenfolge-Zustand der Liste, kein roter Fehler.
    expect(html).not.toContain('role="alert"');
  });
});
