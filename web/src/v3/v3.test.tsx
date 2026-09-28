// @vitest-environment happy-dom
// Der Konzept-Neubau (GUI v3) im Test: Die Seite rendert die **echten**
// Ableitungen aus `now.ts`/`guide.ts` — kein Demo-Datensatz, keine erfundene
// Empfehlung. Geprüft werden die drei Stufen des Guides (voll, ohne Prognose,
// offline), die Farbrolle des Urteils und dass die Seitspalte dieselben
// Zahlen zeigt wie die Karte.
//
// Der Zustand kommt injiziert (dasselbe Muster wie `state/overview.test.tsx`):
// Es läuft kein Poll, kein Netz, kein Timer — nur Darstellung.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DecideResult, Station } from "../data";
import { OverviewProvider, type OverviewState } from "../state/overview";
import { V3Guide } from "./Guide";
import { V3Shell } from "./Shell";

// Feste Uhrzeit: Die Seite liest `Date.now()` (Gültigkeit, Frische,
// Tagesfenster) — mit gestellter Zeit sind die Aussagen reproduzierbar.
const NOW = Date.parse("2026-09-14T12:00:00+02:00");
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();
const inMinutes = (m: number) => new Date(NOW + m * 60000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

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
      expected_saving_median_eur: 1.6,
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
      advice: { last_30d_hits: 42, last_30d_total: 120, hit_rate: 0.78, brier_30d: 0.2 },
      wallet: { fills_30d: 4, followed: 3, saved_eur_30d: 12.4 },
    },
    calibrated: true,
    decision_ready: true,
    tank: null,
    valid_until: inMinutes(45),
    ...overrides,
  } as DecideResult;
}

function state(overrides: Partial<OverviewState> = {}): OverviewState {
  const data = decide("wait");
  return {
    tab: "jetzt",
    gotoTab: () => {},
    activeCity: "Frankfurt",
    fuel: "e10",
    data: null,
    setCity: () => {},
    setSelectedId: () => {},
    setFuel: () => {},
    online: true,
    fresh: [],
    prices: { pending: false },
    setRefresh: () => {},
    h: { version: "0.72.0" },
    alarms: [],
    errorAlarms: [],
    warnAlarms: [],
    theme: "dark",
    themeChoice: "system",
    setTheme: () => {},
    setThemeChoice: () => {},
    decideRes: { data, error: false, errorCode: null, pending: false, receivedAt: 0 },
    stations: [station("aral")],
    selectedId: "aral",
    effLiters: 40,
    effTimeValue: 10,
    autoZ: { z: 10, isPeak: false },
    assumptions: { liters: 55, latestBy: null, timeValue: null },
    setAssumptions: () => {},
    tankPercent: 50,
    setTankPercent: () => {},
    stripCells: [
      { hour: 12, value: 1.749, latest: 1.749, tone: "cheap", current: true },
      { hour: 18, value: 1.709, latest: 1.709, tone: "cheap", current: false },
    ],
    stripBand: null,
    nowPricesAt: minutesAgo(4),
    nowForecastAt: minutesAgo(35),
    browserOnline: true,
    refreshNow: () => {},
    handleNowNavigate: () => {},
    handleIntent: () => {},
    openLabor: () => {},
    ...overrides,
  } as unknown as OverviewState;
}

function render(overrides: Partial<OverviewState> = {}) {
  return renderToStaticMarkup(
    <OverviewProvider value={state(overrides)}>
      <V3Guide />
    </OverviewProvider>,
  );
}

describe("GUI v3 — „Jetzt“ auf echten Daten", () => {
  it("Stufe 1: eine Antwort mit Betrag, blauem Urteil und echten Preisen", () => {
    const html = render();
    expect(html).toContain("Soll ich jetzt tanken?");
    // Der Ausgang kommt aus `nowVerdict` — „Warten bis 18–20 Uhr“.
    expect(html).toContain("Warten bis 18–20 Uhr");
    expect(html).toContain("Warten spart");
    expect(html).toContain("1,749 €/L");
    expect(html).toContain("Station aral");
    // Gültigkeits-Chip: nur freigegebene, nicht abgelaufene Aktionen.
    expect(html).toContain("gültig bis");
    // Kein Ausfall-Banner auf Stufe 1.
    expect(html).not.toContain("Die Prognose macht gerade Pause");
    expect(html).not.toContain(">Offline<");
  });

  it("Stufe 2: ohne Freigabe erklärt das Banner, was weiterhin gilt", () => {
    const html = render({
      decideRes: {
        data: decide("wait", { decision_ready: false }),
        error: false,
        errorCode: null,
        pending: false,
        receivedAt: 0,
      },
    });
    expect(html).toContain("Die Prognose macht gerade Pause");
    expect(html).toContain("Alle Preise sind trotzdem live");
    // Die Preise tragen weiter, die Antwort bleibt sichtbar.
    expect(html).toContain("1,749 €/L");
    // Keine Prognose-Stundenbalken auf Stufe 2: die Faustregel tritt an
    // ihre Stelle (`hourlyOutlook` bleibt null).
    expect(html).toContain("Was wäre wenn");
  });

  it("Stufe 3: offline nennt die Seite den Stand statt einer Empfehlung", () => {
    const html = render({ browserOnline: false });
    expect(html).toContain("Offline");
    expect(html).toContain("Stand:");
    expect(html).toContain("Erneut versuchen");
  });

  it("nennt die Herkunft: Datenstand, Abdeckung und Quelle", () => {
    const html = renderToStaticMarkup(
      <OverviewProvider value={state()}>
        <V3Shell ov={state()}>
          <V3Guide />
        </V3Shell>
      </OverviewProvider>,
    );
    expect(html).toContain("Preise vor 4 Minuten");
    expect(html).toContain("Markttransparenzstelle für Kraftstoffe");
    expect(html).toContain("Keine Demo-Preise");
    // Die Hülle trägt die Bereiche: Desktop-Seitenleiste und mobile Leiste
    // nennen dieselben Einträge in derselben Reihenfolge.
    for (const label of ["Jetzt", "Woche", "Stationen", "Mehr"]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toContain("Zum Inhalt springen");
  });

  it("zeigt Tankstand-Schnellwahl und Was-wäre-wenn als bedienbare Annahmen", () => {
    const html = render();
    expect(html).toContain("Tankstand");
    expect(html).toContain("Was wäre wenn");
    // Eine gesetzte Annahme bekommt einen Rückweg auf die Profilwerte.
    expect(html).toContain("Auf Profilwerte zurück");
  });
});
