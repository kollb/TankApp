// @vitest-environment happy-dom
// Labor: Render-Tests der Phase-3-Seite (docs/UI-NEUENTWURF.md §6/§7).
//
// Geprüft wird, was die Checkliste zusagt:
//   3.1 Alle fünf Abschnitte plus Spielplatz existieren als Aufklapp-Blöcke.
//   3.2 Der Sprung aus Ebene 1 öffnet den passenden Abschnitt. Die gemerkte
//       Herkunft ist seit U5 abgeschafft — der Rückweg ist das
//       Browser-Zurück (U4-Routing).
//   Ehrlichkeit: Das Tagebuch erfindet keine Zeile — ohne Abrechnung nennt
//   es den Grund statt einer leeren Fläche.
//
// U8: Die View hängt am OverviewContext — die Tests injizieren einen
// fertigen Zustand über <OverviewProvider value={…}> und rechnen das Modell
// (useLaborModel) aus denselben Ressourcen wie die App.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { LAB_SECTIONS } from "../lab";
import { OverviewProvider, type OverviewState } from "../state/overview";
import { LaborView, type LaborViewProps } from "./Labor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const res = <T,>(data: T | null, pending = false) => ({
  data,
  error: false,
  errorCode: null,
  pending,
  receivedAt: 0,
});

const noop = () => {};

// Gemeinsamer Overview-Zustand der Labor-Tests: minimal, aber vollständig
// genug, dass View + useLaborModel rendern. Alles Weitere überschreiben die
// einzelnen Tests gezielt.
const baseOverview = {
  activeCity: "Frankfurt",
  stations: [],
  selected: undefined,
  best: undefined,
  h: null,
  fuel: "e10",
  liters: 40,
  spanHours: 24,
  setSpanHours: noop,
  horizon: 0,
  setHorizon: noop,
  horizonDays: 0,
  heatmapKind: "level",
  heatmapWeeks: 2,
  heatmapBasis: "overall",
  heatmapBasisActive: false,
  setHeatmapKind: noop,
  setHeatmapWeeks: noop,
  setHeatmapBasis: noop,
  setSelectedId: noop,
  history: res({ points: [], error_code: null }),
  forecast: res(null),
  heatmap: res(null),
  selection: res(null),
  statsSummaryRes: res(null),
  diary: res({
    generated_at: "2026-09-14T12:00:00+02:00",
    count: 0,
    entries: [],
    reason: "no_advice_history",
    error_code: null,
  }),
  gateStatus: "kein Statistik-Lauf",
  m7Line: null,
  transitionLine: "",
  stationPhase: null,
  observations: [],
  spanLabel: "letzte 24 Stunden",
  refreshNow: noop,
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
  return renderToStaticMarkup(
    withProvider(<LaborView {...props} />, overview),
  );
}

let mounted: { root: ReturnType<typeof createRoot>; host: HTMLDivElement } | null =
  null;

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

describe("Labor: Aufbau (§6.2)", () => {
  it("führt alle fünf Abschnitte plus Spielplatz als Aufklapp-Blöcke", () => {
    const html = render();
    for (const section of LAB_SECTIONS) {
      expect(html).toContain(section.question);
      expect(html).toContain(`id="labor-${section.id}"`);
      expect(html).toContain(`aria-controls="labor-${section.id}-body"`);
      // Die Frage ist eine Überschrift (h2-Ebene) — der Aufklapp-Knopf
      // bleibt Schalter, `getByRole("heading")` findet den Abschnitt trotzdem
      // (die Browser-Suite prüft genau das).
    }
    expect(html).toContain("Spielplatz");
    expect(html).toContain('id="labor-spielplatz"');
  });

  it("zeigt das Vertrauens-Konto ehrlich, wenn noch nichts abgerechnet ist", () => {
    const html = render();
    expect(html).toContain("Vertrauens-Konto");
    expect(html).toContain("noch nichts zu zählen");
    expect(html).toContain("kein Statistik-Lauf");
    expect(html).toContain("Wie wird das gezählt?");
  });

  it("verlinkt ohne Modell keine erfundene Kachel, sondern nennt den Grund", () => {
    const html = render({}, { forecast: res(null) });
    expect(html).toContain("Prinzip-Skizze — nicht deine Daten.");
    expect(html).toContain("Ohne veröffentlichten Modell-Lauf");
  });

  it("nennt im Tagebuch den Grund statt einer leeren Fläche (§10)", () => {
    const host = mount(
      { focusSection: "lernen" },
      {
        diary: res({
          generated_at: "2026-09-14T12:00:00+02:00",
          count: 0,
          entries: [],
          reason: "no_settlements",
          error_code: null,
        }),
      },
    );
    const text = host.textContent ?? "";
    expect(text).toContain("Noch kein Eintrag abgerechnet");
    // Und keinen Demo-Eintrag „zur Anschauung“.
    expect(text).not.toContain("Beispiel-Eintrag");
  });
});

describe("Labor: Erklär-Treppe Ebene 2 (§7)", () => {
  it("klappt bei einem Sprung den passenden Abschnitt auf", () => {
    const onFocusHandled = vi.fn();
    const host = mount({
      focusSection: "sicherheit",
      onFocusHandled,
    });
    expect(host.querySelector("#labor-sicherheit-body")).not.toBeNull();
    expect(onFocusHandled).toHaveBeenCalledTimes(1);
    // Ein nicht angesprungener Abschnitt bleibt zu (Abschnitt 1 ist die
    // voreingestellte Übersicht, Abschnitt 4 bleibt geschlossen).
    expect(host.querySelector("#labor-lernen-body")).toBeNull();
  });

  it("zeigt aktive PIT-Kurve und zeitverzögerten Kandidaten getrennt", () => {
    const host = mount(
      { focusSection: "sicherheit" },
      {
        statsSummaryRes: res({
          live_advice: {
            brier_all_by_calibration: {
              raw: { brier: 0.21, n: 30 },
              pit_24h: { brier: 0.18, n: 20 },
            },
          },
        }),
        forecast: res({
          points: [],
          calibrated: false,
          calibration: { status: "not_available" },
          calibration_candidate: {
            "24h": {
              status: "accepted",
              n_pit: 500,
              validation: {
                raw_picp95: 0.95,
                calibrated_picp95: 0.94,
                picp_release_gate: true,
              },
            },
          },
        }),
      },
    );
    const text = host.textContent ?? "";
    expect(text).toContain("PIT-Rekalibrierung der Prognose");
    expect(text).toContain("PICP 95: roh 95,0 %, geprüft 94,0 %");
    expect(text).toContain("frühestens im nächsten Modell-Lauf");
    expect(text).toContain("roh 0,210 (n=30) · 24-h-PIT 0,180 (n=20)");
  });

  it("bleibt ohne Sprung bei der Übersicht und zeigt den Glossar-Eingang", () => {
    const host = mount();
    const text = host.textContent ?? "";
    // U5: keine gemerkte Herkunft mehr — der Rückweg ist das Browser-Zurück.
    expect(text).not.toContain("Zurück zu:");
    // U3: das Glossar hat seinen Eingang im Labor-Kopf.
    expect(text).toContain("Glossar");
    // Nur Abschnitt 1 ist voreingestellt offen — alle anderen sind zu.
    for (const id of ["sicherheit", "stationen", "lernen", "glossar", "spielplatz"]) {
      expect(host.querySelector(`#labor-${id}-body`)).toBeNull();
    }
  });
});

describe("Labor: Fensterbilanz (O38)", () => {
  it("zeigt „x von y Fenstern genutzt“ im Vertrauens-Konto", () => {
    const host = mount(
      {},
      {
        statsSummaryRes: res({
          live_advice: {
            n: 12,
            wins: 8,
            losses: 3,
            ties: 1,
            hit_rate: 0.7,
            reliability: [],
            brier_30d: null,
            calibrated: false,
            gate_status: "offen",
            episodes_used_7d: 1,
            episodes_expired_7d: 1,
            episodes_used_30d: 3,
            episodes_expired_30d: 2,
          },
        } as any),
      },
    );
    const text = host.textContent ?? "";
    expect(text).toContain("3 von 5 Fenstern genutzt");
    expect(text).toContain("12 Empfehlungen abgerechnet");
    expect(text).toContain("2 Fenster verstrichen");
  });

  it("erfindet ohne O38-Zähler keine Bilanz", () => {
    const host = mount(
      {},
      {
        statsSummaryRes: res({
          live_advice: {
            n: 12,
            wins: 8,
            losses: 3,
            ties: 1,
            hit_rate: 0.7,
            reliability: [],
            brier_30d: null,
            calibrated: false,
            gate_status: "offen",
          },
        } as any),
      },
    );
    expect(host.textContent ?? "").not.toContain("Fensterbilanz");
  });
});

describe("Labor: Spielplatz und Tagebuch-Kennzahlen", () => {
  it("rechnet das Was-wäre-gewesen mit der eingestellten Schwelle nach", () => {
    // U8: Die Tagesreihen kommen nicht mehr als fertiges Prop, sondern als
    // Backtest-Rohstoff (stats/summary) — das Modell rechnet die View.
    const host = mount(
      { focusSection: "spielplatz" },
      {
        statsSummaryRes: res({
          backtest: {
            decisionHour: 12,
            stations: [],
            models: {},
            calibration: [],
            evalRows: {
              "": [
                { day: "2026-09-07", cls: 0, mu: 2.5, p: 0.8, s: 2.1, best: 2.4, predHour: 18 },
                { day: "2026-09-08", cls: 0, mu: -0.5, p: 0.3, s: -1.2, best: 0.4, predHour: 19 },
              ],
            },
          },
        } as any),
      },
    );
    const text = host.textContent ?? "";
    expect(text).toContain("2 von 2 Tagen richtig");
    expect(text).toContain("2026-09-07".slice(5));
  });
});

describe("Labor: Preis-Abstand aus der Selektion (O16)", () => {
  const selectionWithDeltas = {
    fuel: "e10",
    count: 2,
    stations: [
      {
        station_id: "uuid-nord",
        city: "Frankfurt",
        fuel: "e10",
        name: "Demo-Tank Nord",
        brand: "",
        delta_ct: -4.2,
        ci_lo: -6.1,
        ci_hi: -2.3,
        q_value: 0.02,
        significant: true,
      },
      {
        station_id: "uuid-sued",
        city: "Frankfurt",
        fuel: "e10",
        name: "Demo-Tank Süd",
        brand: "",
        delta_ct: 3.1,
        ci_lo: -1.2,
        ci_hi: 7.4,
        q_value: 0.31,
        significant: false,
      },
    ],
  };

  it("zeichnet δ̂-Balken mit Konfidenzintervall und Signifikanz-Hinweis", () => {
    const host = mount(
      { focusSection: "stationen" },
      { selection: res(selectionWithDeltas) },
    );
    const text = host.textContent ?? "";
    // Die Werte kommen aus der Selektion — beide Stationen sind im Diagramm.
    expect(text).toContain("Demo-Tank Nord");
    expect(text).toContain("Demo-Tank Süd");
    expect(text).toContain("Konfidenzintervall");
    expect(text).toContain("nicht signifikant");
    // Whisker und Balken sind gezeichnet (SVG-Linien für das Intervall).
    const svg = host.querySelector("#labor-stationen-body svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("rect").length).toBe(2);
    expect(svg!.querySelectorAll("line").length).toBeGreaterThanOrEqual(7);
    // Der dauerhafte Leer-Zustand von vor 0.46.0 ist weg.
    expect(text).not.toContain("Noch kein Preis-Abstand messbar");
  });

  it("zeigt ohne Selektions-Artefakt den ehrlichen Leerzustand", () => {
    const host = mount({ focusSection: "stationen" }, { selection: res(null) });
    expect(host.textContent ?? "").toContain("Noch kein Preis-Abstand messbar");
    expect(host.querySelector("#labor-stationen-body svg rect")).toBeNull();
  });

  it("lässt Stationen ohne δ̂ aus, statt Null-Balken zu erfinden", () => {
    const host = mount(
      { focusSection: "stationen" },
      {
        selection: res({
          ...selectionWithDeltas,
          stations: [
            selectionWithDeltas.stations[0],
            { ...selectionWithDeltas.stations[1], delta_ct: null },
          ],
        }),
      },
    );
    const text = host.textContent ?? "";
    expect(text).toContain("Demo-Tank Nord");
    expect(text).not.toContain("Demo-Tank Süd");
  });

  it("nennt die 12-Uhr-Bodenkante, aus der δ̂ stammt (B30)", () => {
    const host = mount(
      { focusSection: "stationen" },
      {
        selection: res({
          ...selectionWithDeltas,
          law_floor: "2026-04-01T10:00:00+00:00",
          points_before_law: 1234,
        }),
      },
    );
    expect(host.textContent ?? "").toContain(
      "1.234 Preise vor 01.04.2026, 12:00 Uhr zählen nicht",
    );
  });

  it("behauptet ohne Kante im Payload keine (alte API)", () => {
    const host = mount(
      { focusSection: "stationen" },
      { selection: res(selectionWithDeltas) },
    );
    expect(host.textContent ?? "").not.toContain("Bodenkante");
  });
});

describe("Labor: O18 — Werkstätten haben Daten oder einen ehrlichen Text", () => {
  const rows = [
    { day: "2026-09-01", cls: 0, mu: 2.4, p: 0.8, s: 3.1, best: 3.1, predHour: 19, curve: [] },
    { day: "2026-09-02", cls: 0, mu: 0.4, p: 0.6, s: -1.2, best: 2.0, predHour: 18, curve: [] },
    { day: "2026-09-03", cls: 1, mu: 1.5, p: null, s: 2.2, best: 2.2, predHour: 17, curve: [] },
  ];
  const backtest = {
    daysEval: 3,
    decisionHour: 12,
    defaultEps: 1,
    defaultLiters: 40,
    litersSource: "default",
    stations: [{ id: "s1", city: "Frankfurt", name: "Aral Mitte", brand: "Aral" }],
    stationScores: [],
    totals: { smart: 0, commit: 0, best: 0, regretEur: 0, n: 3, hitFreq: 0, pAvg: null, potShare: null },
    calibration: [],
    evalRows: { s1: rows },
    models: {},
    p8Series: {},
    // O18: Der Server publiziert dieses Feld dauerhaft leer — die Werkstatt
    // rechnet den Scan selbst nach, statt darauf zu warten.
    scan: { eps: [], commitEur: [], smartEur: [], waits: [] },
  };

  it("ε-Scan: rechnet auf den Backtest-Zeilen statt auf ein leeres Feld zu warten", () => {
    const host = mount(
      { focusSection: "spielplatz", onFocusHandled: noop },
      { statsSummaryRes: res({ backtest } as any) },
    );
    const text = host.textContent ?? "";
    expect(text).toContain("Dieselbe Regel, andere Vorsicht");
    expect(text).toContain("ε = 0,50 ct/L");
    expect(text).toContain("ε = 3,00 ct/L");
    expect(text).toContain("warten an");
    expect(text).not.toContain("sobald genug Tage da sind");
  });

  it("ε-Scan: ohne Backtest-Tage steht der Grund, kein Versprechen", () => {
    const host = mount({ focusSection: "spielplatz", onFocusHandled: noop });
    const text = host.textContent ?? "";
    expect(text).toContain("Ohne Backtest-Tage gibt es nichts nachzurechnen");
    expect(text).not.toContain("sobald genug Tage da sind");
  });

  it("CUSUM und Rang-Streuung kommen aus dem Selektions-Artefakt", () => {
    const host = mount(
      { focusSection: "sicherheit", onFocusHandled: noop },
      {
        selection: res({
          fuel: "e10",
          count: 3,
          stations: [
            { station_id: "a", name: "A", rank_std: 0.8, break_flag: true, break_stat: 2.7 },
            { station_id: "b", name: "B", rank_std: 1.2, break_flag: false, break_stat: 0.9 },
            { station_id: "c", name: "C", rank_std: 1.0, break_flag: false, break_stat: 1.4 },
          ],
        } as any),
        statsSummaryRes: res({
          quality_metrics: { cusum_drift: { status: "unknown", max_cusum: null, threshold: 2 } },
        } as any),
      },
    );
    const text = host.textContent ?? "";
    expect(text).toContain("1 von 3 Stationen mit Bruch-Flag");
    expect(text).toContain("höchste CUSUM-Kennzahl 2,70");
    expect(text).toContain("Schwelle 2,00");
    expect(text).toContain("1,00 Plätze im Schnitt");
    // Vorher stand hier dauerhaft „noch nicht messbar“.
    expect(text).not.toContain("noch nicht messbar");
  });

  it("Modellvergleich: Dauerzustand statt erfundener Trainings-Erwartung", () => {
    // Die Zeile steht im Abschnitt „4 · Lernen“, nicht im Spielplatz.
    const host = mount(
      { focusSection: "lernen", onFocusHandled: noop },
      { statsSummaryRes: res({ backtest } as any) },
    );
    const text = host.textContent ?? "";
    expect(text).toContain("kein Form-Modell je Station");
    // Der alte Platzhalterwert (μ = 1,5 ct) sah aus wie ein Messwert.
    expect(text).not.toContain("μ = 1,50 ct/L");
  });

});
