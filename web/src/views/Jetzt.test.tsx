// @vitest-environment happy-dom
// Jetzt: Render-Tests der ersten Ansicht (UI-NEUENTWURF §5.1).
//
// Geprüft wird, was der Nutzer tatsächlich bekommt: die feste Reihenfolge
// ① Entscheidung → ② Drei Fakten → ③ Nächste Schritte → ④ Heute im Blick,
// die vier Ausgänge der Karte, die Frische-Fußzeile und das Begründungs-Sheet
// der Ebene 1. Die Fachlogik selbst steht in `now.test.ts`.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Level1Sheet } from "../components/Level1Sheet";
import type { DecideResult, Station } from "../data";
import { JetztView, type JetztViewProps } from "./Jetzt";

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
  calibrated = true,
): DecideResult {
  return {
    primary: {
      action,
      station: { id: "aral", name: "Aral Mitte", price_now: 1.749, maps_url: null },
      recommended_window: {
        start: "2026-09-14T18:00:00+02:00",
        end: "2026-09-14T20:00:00+02:00",
        expected_price: 1.709,
      },
      expected_saving_eur: 1.6,
      p_correct: 0.82,
      confidence_badge: "high",
      reason_short: "Der Preis fällt hier abends meist.",
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
    calibrated,
    decision_ready: true,
    tank: null,
  };
}

const baseProps: JetztViewProps = {
  activeCity: "Frankfurt",
  decideRes: {
    data: decide("wait"),
    error: false,
    errorCode: null,
    pending: false,
    receivedAt: 0,
  },
  liters: 40,
  selectedId: "aral",
  stations: [station("aral")],
  stripCells: [
    { hour: 6, value: null, tone: "none", current: false },
    { hour: 12, value: 1.749, tone: "cheap", current: true },
  ],
  pricesAt: minutesAgo(4),
  forecastAt: minutesAgo(35),
  onNavigate: () => {},
  onDeepen: () => {},
  onOpenSettings: () => {},
  onRetry: () => {},
  now: NOW,
};

function render(overrides: Partial<JetztViewProps> = {}) {
  const props = { ...baseProps, ...overrides } as JetztViewProps;
  return renderToStaticMarkup(<JetztView {...props} />);
}

describe("Jetzt: Aufbau", () => {
  it("hält die feste Reihenfolge ein", () => {
    const html = render({
      decideRes: { data: decide("wait"), error: false, errorCode: null, pending: false, receivedAt: 0 },
    });
    const decision = html.indexOf("Warten bis 18–20 Uhr");
    const facts = html.indexOf("Bestes Fenster heute");
    const steps = html.indexOf("Nächste Schritte");
    const day = html.indexOf("Heute im Blick");
    const fresh = html.indexOf("Preise vor 4 Minuten");
    expect(decision).toBeGreaterThanOrEqual(0);
    expect(facts).toBeGreaterThan(decision);
    expect(steps === -1 || steps > facts).toBe(true);
    expect(day).toBeGreaterThan(facts);
    expect(fresh).toBeGreaterThan(day);
  });

  it("nennt genau drei Fakten in fester Reihenfolge", () => {
    const html = render({
      decideRes: { data: decide("wait"), error: false, errorCode: null, pending: false, receivedAt: 0 },
    });
    for (const label of ["Jetzt hier", "Bestes Fenster heute", "Tank reicht?"]) {
      expect(html).toContain(label);
    }
  });

  it("zeigt die Frische-Fußzeile mit Ort und Alter", () => {
    const html = render({
      decideRes: { data: decide("wait"), error: false, errorCode: null, pending: false, receivedAt: 0 },
    });
    expect(html).toContain("Preise vor 4 Minuten · Prognose vor 35 Minuten");
    expect(html).toContain("Frankfurt");
  });
});

describe("Jetzt: Zustände", () => {
  it("S0: ohne Daten führt die Karte zur Einrichtung", () => {
    const html = render({
      decideRes: { data: null, error: false, errorCode: null, pending: false, receivedAt: 0 },
      stations: [],
      stripCells: [],
    });
    expect(html).toContain("Einrichten in drei Schritten");
    expect(html).toContain("Einrichtung starten");
  });

  it("S1: das lerndende Modell bekommt die graue Karte mit Zählstand", () => {
    const learning = decide("no_advice", false);
    learning.personal_stats.advice.last_30d_total = 12;
    const html = render({
      decideRes: { data: learning, error: false, errorCode: null, pending: false, receivedAt: 0 },
    });
    expect(html).toContain("Keine klare Empfehlung");
    expect(html).toContain("Das Modell lernt noch");
    expect(html).not.toContain("% sicher");
  });

  it("Fehler: Klartext-Karte mit erneutem Versuch", () => {
    const html = render({
      decideRes: {
        data: null,
        error: true,
        errorCode: "influx_read_failed",
        pending: false,
        receivedAt: 0,
      },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("InfluxDB konnte nicht gelesen werden");
  });

  it("Laden: Skelett meldet sich als beschäftigt", () => {
    const html = render({
      decideRes: { data: null, error: false, errorCode: null, pending: true, receivedAt: 0 },
    });
    expect(html).toContain('aria-busy="true"');
  });
});

describe("Jetzt: Server-Fehlerpayload (Regression: keine leere Seite)", () => {
  // Vorher stürzte die Ansicht hier ab (`decide.primary.action` ohne `primary`)
  // und die App blieb weiß. Beide Wege müssen stehen: Einrichtung als
  // nächster Schritt, wenn nichts da ist — und ein benannter Fehler, wenn es
  // Stationen gibt, die Empfehlung aber nicht berechnet werden konnte.
  const broken = { error_code: "polling_missing" } as unknown as DecideResult;
  const brokenRes = {
    data: broken,
    error: false,
    errorCode: null,
    pending: false,
    receivedAt: 0,
  };

  it("S0 gewinnt, wenn noch keine Stationen da sind", () => {
    const html = render({ decideRes: brokenRes, stations: [], stripCells: [] });
    expect(html).toContain("Einrichten in drei Schritten");
    expect(html).not.toContain('role="alert"');
  });

  it("unerreichbare Anlage ist ein Fehler, keine Einrichtungs-Aufforderung", () => {
    const html = render({
      decideRes: {
        data: null,
        error: true,
        errorCode: "request_failed",
        pending: false,
        receivedAt: 0,
      },
      stations: [],
      stripCells: [],
    });
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Einrichten in drei Schritten");
  });

  it("mit Stationen steht der Grund im Klartext, mit Rohcode", () => {
    const html = render({ decideRes: brokenRes });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Polling-Set fehlt");
    expect(html).toContain("polling_missing");
  });
});

describe("Ebene 1: Begründungs-Sheet", () => {
  it("ist geschlossen nicht im Dokument", () => {
    const html = renderToStaticMarkup(
      <Level1Sheet
        open={false}
        title="Warum?"
        sentences={["eins"]}
        source="Quelle"
        labHint="Weiter"
        onDeepen={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toBe("");
  });

  it("zeigt höchstens drei Sätze, die Herkunft und den Weg in die Tiefe", () => {
    const html = renderToStaticMarkup(
      <Level1Sheet
        open
        title="Warum diese Empfehlung?"
        sentences={["eins", "zwei", "drei", "vier"]}
        source="Grundlage: die geladenen Preismeldungen."
        labHint="In der Werkstatt vertiefen"
        onDeepen={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Warum diese Empfehlung?");
    expect(html).toContain("eins");
    expect(html).toContain("drei");
    expect(html).not.toContain("vier");
    expect(html).toContain("Grundlage: die geladenen Preismeldungen.");
    expect(html).toContain("In der Werkstatt vertiefen");
  });
});
