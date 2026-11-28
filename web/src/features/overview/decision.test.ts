import { describe, expect, it } from "vitest";
import type { OverviewResponse, Station } from "../../api/types";
import { getDecisionView, validityLabel } from "./decision";

const stations: Station[] = [
  { station_id: "a", city: "Frankfurt", name: "A", price: 1.70, fresh: true, observed_at: null },
  { station_id: "b", city: "Frankfurt", name: "B", price: 1.75, fresh: true, observed_at: null },
];
function response(action: "refuel_now" | "wait" | "no_advice", overrides: Record<string, unknown> = {}): OverviewResponse {
  return {
    generated_at: "2026-11-28T10:00:00Z",
    decide: {
      primary: { action, station: { id: "a", name: "A", price_now: 1.70, maps_url: "https://maps.example/a" }, recommended_window: null, expected_saving_eur: 2.5, p_correct: null, confidence_badge: "medium", reason_short: "Serverbegründung" },
      alternatives_nearby: [], valid_until: "2026-11-28T10:30:00Z", ...overrides,
    },
    fills: { count: 0, fills: [] }, stats_summary: {}, episodes: { count: 0, episodes: [] }, day: null,
  } as OverviewResponse;
}

describe("Übersicht: Entscheidungszustände", () => {
  it("priorisiert Offline vor vorhandenen Daten", () => {
    expect(getDecisionView(response("refuel_now"), true, stations).state).toBe("offline");
  });
  it("bildet Jetzt tanken und Warten direkt aus der API ab", () => {
    expect(getDecisionView(response("refuel_now"), false).state).toBe("refuel");
    expect(getDecisionView(response("wait"), false).state).toBe("wait");
  });
  it("unterscheidet engen Preisbereich von Preisvergleich", () => {
    expect(getDecisionView(response("no_advice"), false, stations).state).toBe("compare");
    const close = stations.map((station) => ({ ...station, price: 1.70 }));
    expect(getDecisionView(response("no_advice"), false, close).state).toBe("close");
  });
  it("zeigt fehlende Daten als Prognosezustand statt erfundenem Nullpreis", () => {
    expect(getDecisionView(null, false).state).toBe("forecast");
    expect(getDecisionView(response("no_advice"), false, []).price).toBe(1.70);
  });
});

describe("Entscheidungsgültigkeit", () => {
  it("zeigt Ablaufzeit, Countdown im letzten 30-Minuten-Fenster und Ablauf", () => {
    const until = "2026-11-28T10:30:00Z";
    expect(validityLabel(until, Date.parse("2026-11-28T09:00:00Z"))).toBe("bis 11:30");
    expect(validityLabel(until, Date.parse("2026-11-28T10:20:00Z"))).toBe("10 Min. verbleibend");
    expect(validityLabel(until, Date.parse("2026-11-28T10:30:01Z"))).toBe("abgelaufen");
  });
  it("gibt bei null oder ungültiger Frist einen Gedankenstrich aus", () => {
    expect(validityLabel(null)).toBe("—");
    expect(validityLabel("keine Zeit")).toBe("—");
  });
});
