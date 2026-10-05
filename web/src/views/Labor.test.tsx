// @vitest-environment happy-dom
// Labor (Batch 2 / 0.74.0): drei Blöcke, sonst nichts — Render-Tests + Ratchets.
//
//   Block 1  Kann ich vertrauen?        — Zählung (kein Prozent) + Tagebuch
//   Block 2  Wie gut ist die Prognose?  — eine Kurve + ein Satz in ct
//   Block 3  Wie rechnet die App?       — drei Schritte + Details für Neugierige
//
// Gestrichen (UX-NEUENTWURF §5/§7) und hier festgenagelt: Sub-Tabs,
// Spielplatz, Experimente, Tankprofil-Rechner, Einflüsse-Balken, Güte-Panel
// (Reliability, CUSUM, Brier) und das eingebettete Glossar.

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { LAB_BLOCKS, PARAM_CARDS } from "../lab";
import { OverviewProvider, type OverviewState } from "../state/overview";
import { LaborView, type LaborViewProps } from "./Labor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const res = <T,>(data: T | null, pending = false) => ({
  data,
  error: false,
  errorCode: null,
  pending,
  receivedAt: 0,
});

const noop = () => {};

const FORECAST_POINTS = [
  {
    timestamp: "2026-10-05T12:00:00.000Z",
    q50: 1.679,
    q10: 1.659,
    q90: 1.699,
    q025: 1.649,
    q975: 1.709,
    support_days: 30,
    supported: true,
  },
  {
    timestamp: "2026-10-05T13:00:00.000Z",
    q50: 1.669,
    q10: 1.649,
    q90: 1.689,
    q025: 1.639,
    q975: 1.699,
    support_days: 30,
    supported: true,
  },
];

const baseOverview = {
  activeCity: "Frankfurt",
  data: { stations: [] },
  decideRes: res(null),
  stations: [],
  selected: undefined,
  best: undefined,
  h: null,
  fuel: "e10",
  liters: 40,
  horizon: 0,
  history: res({ points: [], error_code: null }),
  forecast: res(null),
  heatmap: res(null),
  selection: res(null),
  statsSummaryRes: res(null),
  diary: res({
    generated_at: "2026-10-05T12:00:00+02:00",
    count: 0,
    entries: [],
    settled_total: 0,
    reason: "no_advice_history",
    error_code: null,
  }),
  refreshNow: noop,
  tab: "labor",
} as unknown as OverviewState;

const baseViewProps: LaborViewProps = {
  focusSection: null,
  onFocusHandled: noop,
  onNavigate: noop,
  onOpenGlossary: noop,
};

function withProvider(
  element: Parameters<typeof renderToStaticMarkup>[0],
  overview: Record<string, unknown> = {},
) {
  return (
    <OverviewProvider value={{ ...baseOverview, ...overview } as OverviewState}>
      {element}
    </OverviewProvider>
  );
}

function render(
  overrides: Partial<LaborViewProps> = {},
  overview: Record<string, unknown> = {},
): string {
  const props = { ...baseViewProps, ...overrides } as LaborViewProps;
  return renderToStaticMarkup(withProvider(<LaborView {...props} />, overview));
}

let mounted: { root: ReturnType<typeof createRoot>; host: HTMLDivElement } | null = null;

function mount(
  overrides: Partial<LaborViewProps> = {},
  overview: Record<string, unknown> = {},
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const props = { ...baseViewProps, ...overrides } as LaborViewProps;
  act(() => {
    root.render(withProvider(<LaborView {...props} />, overview));
  });
  mounted = { root, host };
  return host;
}

afterEach(() => {
  if (mounted) {
    const { root, host } = mounted;
    act(() => root.unmount());
    host.remove();
    mounted = null;
  }
});

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("Labor: drei Blöcke", () => {
  it("zeigt genau die drei Fragen — keine Sub-Tab-Leiste", () => {
    const host = mount();
    const text = host.textContent ?? "";
    for (const block of LAB_BLOCKS) {
      expect(text).toContain(block.question);
    }
    expect(host.querySelector('[role="tablist"]')).toBeNull();
  });

  it("erzählt die Zählung als Satz, nicht als Prozent (Block 1)", () => {
    const html = render(
      {},
      {
        statsSummaryRes: res({
          live_advice: {
            wins: 26,
            losses: 3,
            ties: 1,
            n: 30,
            n_void: 0,
            reliability: [],
          },
        } as any),
      },
    );
    expect(html).toContain("An 26 von 30 Tagen lag die Empfehlung richtig.");
    expect(html).toContain("26 richtig · 3 daneben · 1 unentschieden");
    expect(html).not.toContain("%");
  });

  it("spricht ohne Abrechnung den Lernstand aus (Block 1)", () => {
    const html = render();
    expect(html).toContain(
      "Noch nicht gemessen — die ersten Empfehlungen sind Lern-Fälle.",
    );
  });

  it("führt das Tagebuch als filterbare Liste (Block 1)", () => {
    const html = render(
      {},
      {
        statsSummaryRes: res({
          live_advice: { wins: 1, losses: 1, ties: 0, n: 2, reliability: [] },
        } as any),
        diary: res({
          generated_at: "2026-10-05T12:00:00+02:00",
          count: 2,
          settled_total: 2,
          entries: [
            {
              snapshot_id: "s1",
              episode_id: "e1",
              settled_at: "2026-09-13T19:35:00Z",
              emitted_at: "2026-09-13T16:00:00Z",
              action: "wait",
              station_id: "st-1",
              station_name: null,
              city: "Frankfurt",
              fuel: "e10",
              window_start: "2026-09-13T16:00:00Z",
              window_end: "2026-09-13T18:00:00Z",
              price_then: 1.789,
              price_window: 1.749,
              outcome: "win",
              void_reason: null,
              decline_reason: null,
              regret_eur: null,
              p_correct: 0.82,
              p_besser: null,
              liters: 40,
              intent: null,
            },
            {
              snapshot_id: "s2",
              episode_id: "e2",
              settled_at: "2026-09-12T19:35:00Z",
              emitted_at: "2026-09-12T16:00:00Z",
              action: "refuel_now",
              station_id: "st-1",
              station_name: null,
              city: "Frankfurt",
              fuel: "e10",
              window_start: "2026-09-12T16:00:00Z",
              window_end: "2026-09-12T18:00:00Z",
              price_then: 1.719,
              price_window: 1.759,
              outcome: "loss",
              void_reason: null,
              decline_reason: null,
              regret_eur: 1.6,
              p_correct: 0.7,
              p_besser: null,
              liters: 40,
              intent: null,
            },
          ],
          reason: null,
          error_code: null,
        }),
      },
    );
    expect(html).toContain("Prognose-Tagebuch");
    for (const label of ["Alle", "Richtig", "Daneben", "Unentschieden", "Nicht bewertbar"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("richtig");
    expect(html).toContain("daneben");
    expect(html).toContain("1,749 €/L");
  });

  it("trägt eine Kurve und einen Fehlersatz in ct (Block 2)", () => {
    const html = render(
      {},
      {
        forecast: res({
          points: FORECAST_POINTS,
          points_3d: FORECAST_POINTS,
          points_7d: FORECAST_POINTS,
          metrics: { points: 12, mae_ct: 1.8, mase: 0.9, picp95_pct: 95 },
        } as any),
      },
    );
    expect(html).toContain("Im Schnitt 1,8 ct/L daneben.");
    expect(html).toContain('aria-label="Erwarteter und echter Preis"');
  });

  it("erfindet ohne Metriken keine Fehlerzahl (Block 2)", () => {
    const html = render(
      {},
      { forecast: res({ points: FORECAST_POINTS } as any) },
    );
    expect(html).not.toContain("Im Schnitt");
    expect(html).toContain("die Zahl dazu entsteht mit dem ersten echten Abgleich");
  });

  it("sperrt die Blickweiten, die der Server nicht liefert (Block 2)", () => {
    const host = mount({}, { forecast: res({ points: FORECAST_POINTS } as any) });
    const buttons = Array.from(host.querySelectorAll("button"));
    const three = buttons.find((button) => button.textContent === "+3 Tage");
    const seven = buttons.find((button) => button.textContent === "+7 Tage");
    expect(three?.hasAttribute("disabled")).toBe(true);
    expect(seven?.hasAttribute("disabled")).toBe(true);
  });
});

describe("Labor: Details für Neugierige (Block 3)", () => {
  it("bündelt die acht Bausteine erst auf Klick", () => {
    const closed = render();
    expect(closed).not.toContain(PARAM_CARDS[0].title);

    const host = mount();
    const toggle = Array.from(host.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes("Details für Neugierige"),
    );
    expect(toggle).toBeTruthy();
    act(() => {
      toggle!.click();
    });
    const html = host.innerHTML;
    for (const card of PARAM_CARDS) {
      // Titel mit `&` landen escaped im Markup („AR(2)-Rest &amp; Stabilität“).
      expect(html).toContain(card.title.replace(/&/g, "&amp;"));
    }
    expect(html).toContain("karte-8-regime");
    expect(html).toContain("Fachwerte");
    expect(html).toContain("Wochenrhythmus");
  });

  it("öffnet die Details, wenn ein Abschnitt sie verlangt", () => {
    const host = mount({ focusSection: "stationen" });
    expect(host.textContent ?? "").toContain(PARAM_CARDS[0].title);
  });

  it("behält die drei Schritte in Alltagssprache", () => {
    const html = render();
    expect(html).toContain("Tagesmuster der Stadt");
    expect(html).toContain("Aktuelle Lage");
    expect(html).toContain("12-Uhr-Regel");
  });
});

describe("Labor: Ratchets der Streichliste (§5/§7)", () => {
  it("zeigt keinen der gestrichenen Blöcke", () => {
    const html = render();
    for (const removed of [
      "Spielplatz",
      "Experimente",
      "Tankprofil",
      "Einflüsse",
      "Reliability",
      "CUSUM",
      "Brier",
      "Versprochen gegen eingetroffen",
      "Vertrauens-Konto",
    ]) {
      expect(html).not.toContain(removed);
    }
  });

  it("die Ansicht kennt keine Sub-Tabs und keine Werkstatt-Importe mehr", () => {
    const view = source("./Labor.tsx");
    expect(view).not.toContain('role="tablist"');
    expect(view).not.toContain("LAB_SUBTABS");
    expect(view).not.toContain("labSubTab");
    expect(view).not.toContain("views/labor/");
  });

  it("der Rohdatenraum wohnt nicht mehr im Labor", () => {
    const view = source("./Labor.tsx");
    for (const moved of [
      'data-testid="rohdaten-section"',
      'data-testid="csv-export-section"',
      'data-testid="api-explorer-section"',
      "ApiExplorer",
      "DeltaBars",
      "CalibChart",
    ]) {
      expect(view).not.toContain(moved);
    }
  });
});
