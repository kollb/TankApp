// @vitest-environment happy-dom
// Ich: Render-Tests des Bereichs (UI-NEUENTWURF §5.4).
//
// Geprüft wird der Aufbau: die Segment-Steuerung als ARIA-Tabs, alle
// Fahrzeug-Fields an einem Ort (der alte Einstellungen-Tab ist ersetzt),
// die ehrlichen Leerzustände von Belegen und Bilanz und die Einstellungen
// am Wirkungsort. Die Fahrzeug-/Einstellungs-Panels selbst sind in
// `settings.test.tsx` getestet.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Fill, FillDraftCheck, Fuel } from "../data";
import {
  ICH_SECTIONS,
  IchView,
  mostUsedStation,
  type IchViewProps,
} from "./Ich";
import type { SettingsPanelProps, VehiclePanelProps } from "./Settings";

const noop = () => {};
const idle = {
  data: null,
  error: false,
  errorCode: null,
  pending: false,
  receivedAt: 0,
};

const vehicle: VehiclePanelProps = {
  liters: 40,
  setLiters: noop,
  consumption: 7,
  setConsumption: noop,
  tankCapacity: 50,
  setTankCapacity: noop,
  activeProfileName: null,
  speed: 45,
  setSpeed: noop,
  timeValue: 0,
  setTimeValue: noop,
  timeValueUsed: 10,
  autoZ: { z: 10, isPeak: false },
  detourMode: "onroute",
  setDetourMode: noop,
  profilesRes: { ...idle, data: { profiles: [], active: null } },
  activeProfileId: "",
  onActivateProfile: noop,
  profilesBusy: false,
  onOpenProfileManager: noop,
};

const settings: SettingsPanelProps = {
  data: null,
  activeCity: "Frankfurt",
  setCity: noop,
  fuel: "e10" as Fuel,
  setFuel: noop,
  statsSummaryRes: { ...idle },
  refreshNow: noop,
  theme: "dark",
  setTheme: noop,
  pinnedStations: [],
  togglePin: noop,
  version: "0.35.0",
  onOpenGlossary: noop,
};

const quickDraft: FillDraftCheck = {
  litersError: null,
  priceError: null,
  stationMissing: true,
  ok: false,
};

const baseProps: IchViewProps = {
  vehicle,
  settings,
  pinnedFirstStations: [],
  quickStationId: "",
  setQuickStationId: noop,
  quickLitersStr: "40",
  setQuickLitersStr: noop,
  quickPriceStr: "",
  setQuickPriceStr: noop,
  quickDraft,
  priceOf: () => null,
  freshPrices: [],
  fillSubmitting: false,
  onQuickFill: noop,
  actionFeedback: null,
  fillList: [],
  visibleFills: [],
  voidedCount: 0,
  showVoidedFills: false,
  setShowVoidedFills: noop,
  voidNote: null,
  voidBusy: false,
  onVoidFill: noop,
  fillsSummary: { data: null, error: false, errorCode: null, pending: false, receivedAt: 0 },
  onRetry: noop,
};

function render(overrides: Partial<IchViewProps> = {}) {
  const props = { ...baseProps, ...overrides } as IchViewProps;
  return renderToStaticMarkup(<IchView {...props} />);
}

describe("Ich: Aufbau", () => {
  it("steuert die Unterseiten als ARIA-Tabs", () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    for (const section of ICH_SECTIONS) {
      expect(html).toContain(section.label);
    }
    // Default ist „Fahrzeug“ — es ist ausgewählt.
    const vehicleTab = html.match(
      /<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>[\s\S]*?<\/button>/,
    );
    expect(vehicleTab?.[0]).toContain("Fahrzeug");
  });

  it("alle Fahrzeug-Fields stehen an einem Ort (Einstellungen ist ersetzt)", () => {
    const html = render();
    for (const id of [
      "liters",
      "consumption",
      "timeValue",
      "speed",
      "detourMode",
      "tankCapacity",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    // Kraftstoff/Stadt wohnen bewusst unter „Einstellungen“.
    expect(html).toContain(
      "Kraftstoff und Stadt liegen unter „Einstellungen“",
    );
  });
});

describe("Ich: Leerzustände", () => {
  it("Belege: ohne Buchungen der ehrliche Hinweis statt leeren Fläche", () => {
    const html = render({ initialSection: "fills" });
    expect(html).toContain("Noch keine Belege");
    expect(html).toContain("Keine Station im Set");
  });

  it("Bilanz: ohne Belege füllt sie sich mit der Buchung", () => {
    const html = render({ initialSection: "balance" });
    expect(html).toContain(
      "Noch keine Belege — die Bilanz füllt sich mit jedem erfassten",
    );
  });
});

describe("Ich: Einstellungen am Wirkungsort", () => {
  it("Stadt, Darstellung und Über — ohne Eingabefelder für die Schwellen", () => {
    const html = render({ initialSection: "settings" });
    expect(html).toContain('id="settings-city"');
    expect(html).toContain("Hell");
    expect(html).toContain("Dunkel (Standard)");
  });
});

describe("mostUsedStation (zweiter Maßstab unter dem Median)", () => {
  const fill = (id: string, overrides: Partial<Fill> = {}): Fill => ({
    id: `f-${id}`,
    station_id: id,
    station_name: `Station ${id}`,
    liters: 40,
    price_paid: 1.7,
    fuel: "e10",
    ...overrides,
  });

  it("zählt die Station mit den meisten (nicht stornierten) Belegen", () => {
    expect(mostUsedStation([fill("a"), fill("b"), fill("a")])).toEqual({
      name: "Station a",
      count: 2,
    });
  });

  it("unter zwei Belegen an derselben Station: null (keine Erfindung)", () => {
    expect(mostUsedStation([fill("a"), fill("b")])).toBeNull();
    expect(mostUsedStation([])).toBeNull();
  });

  it("stornierte Belege zählen nicht", () => {
    expect(
      mostUsedStation([fill("a"), fill("a", { voided: true })]),
    ).toBeNull();
    expect(
      mostUsedStation([
        fill("a"),
        fill("a"),
        fill("a", { voided: true }),
      ]),
    ).toEqual({ name: "Station a", count: 2 });
  });

  it("erscheint als Maßstab-Zeile unter der Beleg-Tabelle", () => {
    const fills = [fill("a"), fill("b"), fill("a")];
    const html = render({
      initialSection: "fills",
      fillList: fills,
      visibleFills: fills,
    });
    expect(html).toContain(
      "Maßstab: der Median deines Sets (Standard)",
    );
    expect(html).toContain("meistgenutzte Station: Station a");
  });
});
