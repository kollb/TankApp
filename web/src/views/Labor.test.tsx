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

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { LAB_SECTIONS } from "../lab";
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

const baseProps = {
  activeCity: "Frankfurt",
  stations: [],
  selected: undefined,
  best: undefined,
  h: null,
  liters: 40,
  spanHours: 24,
  horizon: 0,
  horizonDays: 0,
  eps: 1,
  labDayIdx: 0,
  heatmapKind: "level",
  heatmapWeeks: 2,
  heatmapBasis: "overall",
  heatmapBasisActive: false,
  setSpanHours: () => {},
  setHorizon: () => {},
  setEps: () => {},
  setLabDayIdx: () => {},
  setHeatmapKind: () => {},
  setHeatmapWeeks: () => {},
  setHeatmapBasis: () => {},
  setSelectedId: () => {},
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
  f: null,
  metrics: null,
  modelSeries: [],
  observations: [],
  spanLabel: "letzte 24 Stunden",
  livePointsForChart: [],
  fanBand80: [],
  fanBand95: [],
  forecastMarks: [],
  forecastWindow: null,
  anchorHour: 12,
  anchorLabel: "12:00",
  labData: undefined,
  labRows: [],
  labTotals: {
    n: 0,
    smart: 0,
    commit: 0,
    best: 0,
    always: 0,
    regretEur: 0,
    hitFreq: 0,
    pAvg: 0,
    potShare: 0,
  },
  labSaves: [],
  labMu: 1.5,
  labModel: null,
  labDayClass: 0,
  activeLabDayRow: null,
  activeLabOutcome: null,
  calibPoints: [],
  calibErr: Number.NaN,
  refreshNow: () => {},
  focusSection: null,
  onFocusHandled: () => {},
  onNavigate: () => {},
  onOpenGlossary: () => {},
} as unknown as LaborViewProps;

function render(overrides: Partial<LaborViewProps> = {}): string {
  const props = { ...baseProps, ...overrides } as LaborViewProps;
  return renderToStaticMarkup(<LaborView {...props} />);
}

let mounted: { root: ReturnType<typeof createRoot>; host: HTMLElement } | null =
  null;

function mount(overrides: Partial<LaborViewProps> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const props = { ...baseProps, ...overrides } as LaborViewProps;
  act(() => {
    root.render(<LaborView {...props} />);
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
      expect(html).toContain(
        `<span id="labor-${section.id}-title" role="heading" aria-level="2"`,
      );
    }
    // Sprungleiste: nummerierte Knöpfe, Spielplatz ohne Nummer.
    expect(html).toContain("1 · Was die App vorhersagt");
    expect(html).toContain("5 · Glossar von A–Z");
    expect(html).toContain(">Spielplatz<");
    // Kein Pfad, kein Fortschritt, keine Häkchen (§6.2).
    expect(html).not.toContain("Kapitel");
    expect(html).not.toContain("% geschafft");
  });

  it("beginnt mit dem Vertrauens-Konto und lässt den Prozentwert weg, solange nichts gezählt ist", () => {
    const html = render();
    expect(html).toContain("Vertrauens-Konto");
    expect(html).toContain("noch nichts zu zählen");
    expect(html).toContain("kein Statistik-Lauf");
    expect(html).toContain("Wie wird das gezählt?");
  });

  it("verlinkt ohne Modell keine erfundene Kachel, sondern nennt den Grund", () => {
    const html = render({ forecast: res(null) });
    expect(html).toContain("Prinzip-Skizze — nicht deine Daten.");
    expect(html).toContain("Ohne veröffentlichten Modell-Lauf");
  });

  it("nennt im Tagebuch den Grund statt einer leeren Fläche (§10)", () => {
    const host = mount({
      focusSection: "lernen",
      diary: res({
        generated_at: "2026-09-14T12:00:00+02:00",
        count: 0,
        entries: [],
        reason: "no_settlements",
        error_code: null,
      }),
    });
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

describe("Labor: Spielplatz und Tagebuch-Kennzahlen", () => {
  it("rechnet das Was-wäre-gewesen mit der eingestellten Schwelle nach", () => {
    const host = mount({
      focusSection: "spielplatz",
      labRows: [
        { day: "2026-09-07", cls: 0, mu: 2.5, p: 0.8, s: 2.1, best: 2.4, predHour: 18 },
        { day: "2026-09-08", cls: 0, mu: -0.5, p: 0.3, s: -1.2, best: 0.4, predHour: 19 },
      ],
    });
    const text = host.textContent ?? "";
    expect(text).toContain("2 von 2 Tagen richtig");
    expect(text).toContain("2026-09-07".slice(5));
  });
});
