// @vitest-environment happy-dom
// Einstellungen (0.78.0): **eine** Ansicht für Fahrzeug, Belege/Bilanz und
// App-Kontext. Fahrzeug-Felder wohnen in „Einstellungen → Fahrzeug“
// (VehiclePanel), Kontext/Schwellen/Darstellung/Daten in „Einstellungen → App“
// (SettingsPanel); die Buchhaltung liegt als eingeklapptes `<details>` darunter
// (Tests unten: „Einstellungen: Aufbau“ bis „O30“).
//
// Die Schwellen-Tabelle zeigt ausschließlich Server-Werte: die Tests
// prüfen, dass alle neun Schwellen der Engine (app/thresholds.py
// DEFAULT_THRESHOLDS) genau ein Mal vorkommen, dass Werte nur über die
// Formatter formatiert werden (€ mit euro()/deTrimmed, P in %) und dass
// der Status ehrlich sagt, womit die Engine rechnet.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  mostUsedStation,
  SettingsPanel,
  SettingsView,
  VehiclePanel,
  type SettingsPanelProps,
  type SettingsViewProps,
  type VehiclePanelProps,
} from "./views/Settings";
import {
  APP_THEME_META_COLOR,
  APP_THEMES,
  applyAppTheme,
  isAppTheme,
  PROFILE_BOUNDS,
  THRESHOLD_ROWS,
  thresholdHysteresisLine,
  thresholdSampleLine,
  thresholdStatusLine,
  thresholdValueLabel,
  type BalanceRow,
  type Fill,
  type FillDraftCheck,
  type FillsSummary,
  type Fuel,
  type Profiles,
  type ResourceState,
  type StatsSummary,
  type Station,
  type Stations,
  type ThresholdTuning,
} from "./data";

// Die neun Schwellen, die app/thresholds.py::DEFAULT_THRESHOLDS liefert —
// die GUI kennt sie nur über diese Liste; eine neue Schwelle auf dem
// Server ohne GUI-Eintrag darf nicht still verschwinden.
const SERVER_THRESHOLD_KEYS = [
  "wait_eur_high",
  "wait_p_high",
  "wait_eur_mid",
  "wait_p_mid",
  "elsewhere_net_eur",
  "elsewhere_p",
  "elsewhere_borderline_eur",
  "now_eur",
  "now_p",
];

function tuning(overrides: Partial<ThresholdTuning> = {}): ThresholdTuning {
  return {
    thresholds: {},
    base: {},
    targets: { hit_wait: 0.7, hit_now: 0.85, hit_elsewhere: 0.6 },
    sample: {
      n_wait: 30,
      hit_wait: 0.8,
      n_now: 20,
      hit_now: 0.9,
      n_elsewhere: 10,
      hit_elsewhere: null,
    },
    reasons: [],
    changed: false,
    min_n: 25,
    auto_apply: false,
    applied: false,
    ...overrides,
  };
}

function summary(overrides: Partial<StatsSummary> = {}): StatsSummary {
  return {
    generated_at: "2026-09-13T08:00:00+02:00",
    fuel: "e10",
    city: "Frankfurt",
    thresholds: {
      wait_eur_high: 2.0,
      wait_p_high: 0.7,
      wait_eur_mid: 1.0,
      wait_p_mid: 0.6,
      elsewhere_net_eur: 1.5,
      elsewhere_p: 0.5,
      elsewhere_borderline_eur: 0.5,
      now_eur: 1.0,
      now_p: 0.5,
    },
    threshold_tuning: tuning(),
    backtest: {} as StatsSummary["backtest"],
    live_advice: {} as StatsSummary["live_advice"],
    wallet: {} as StatsSummary["wallet"],
    quality_metrics: {} as StatsSummary["quality_metrics"],
    live_phase: null,
    calibrated: false,
    decision_ready: false,
    ...overrides,
  };
}

const emptyResource: ResourceState<never> = {
  data: null,
  error: false,
  errorCode: null,
  pending: false,
  receivedAt: 0,
};

const station = (id: string, name: string): Station => ({
  station_id: id,
  city: "Frankfurt",
  name,
  brand: "Shell",
  fuel: "e10",
  maps_url: null,
  dist_km: 1.2,
  dist_mode: "road",
  lat: null,
  lon: null,
  price: 1.699,
  last_price: 1.689,
  status: "open",
  fresh: true,
  observed_at: "2026-09-14T07:55:00+02:00",
  age_minutes: 5,
});

const cities: Stations = {
  generated_at: "2026-09-13T08:00:00+02:00",
  fuel: "e10",
  cities: ["Frankfurt", "Gütersloh"],
  stations: [station("st-1", "Shell Hauptstraße")],
  connection_error: null,
  fresh_prices: 1,
};

function vehicleProps(
  overrides: Partial<VehiclePanelProps> = {},
): VehiclePanelProps {
  return {
    liters: 40,
    setLiters: () => {},
    consumption: 7,
    setConsumption: () => {},
    tankCapacity: 50,
    setTankCapacity: () => {},
    tankPercent: null,
    setTankPercent: () => {},
    activeProfileName: null,
    speed: 45,
    setSpeed: () => {},
    timeValue: 12,
    setTimeValue: () => {},
    timeValueUsed: 12,
    autoZ: { z: 10, isPeak: false },
    detourMode: "onroute",
    setDetourMode: () => {},
    profilesRes: {
      ...emptyResource,
      data: { profiles: [], active: null } as Profiles,
    } as ResourceState<Profiles>,
    activeProfileId: "",
    onActivateProfile: () => {},
    profilesBusy: false,
    onOpenProfileManager: () => {},
    ...overrides,
  };
}

function settingsProps(
  overrides: Partial<SettingsPanelProps> = {},
): SettingsPanelProps {
  return {
    data: cities,
    activeCity: "Frankfurt",
    setCity: () => {},
    fuel: "e10",
    setFuel: () => {},
    statsSummaryRes: {
      ...emptyResource,
      data: summary(),
    } as ResourceState<StatsSummary>,
    refreshNow: () => {},
    theme: "dark",
    setTheme: () => {},
    pinnedStations: [{ station: station("st-1", "Shell Hauptstraße") }],
    togglePin: () => {},
    version: "0.35.0",
    onOpenGlossary: () => {},
    ...overrides,
  };
}

describe("Einstellungen → Fahrzeug (VehiclePanel)", () => {
  it("bietet Tankmenge, Verbrauch, Tankgröße, Zeitwert, Tempo, Fahrtcharakter", () => {
    const html = renderToStaticMarkup(<VehiclePanel {...vehicleProps()} />);
    // Eingabeorte mit den Ids, die der alte Einstellungen-Tab hatte.
    expect(html).toContain('id="liters"');
    expect(html).toContain('id="consumption"');
    expect(html).toContain('id="tankCapacity"');
    expect(html).toContain('id="timeValue"');
    expect(html).toContain('id="speed"');
    expect(html).toContain('id="detourMode"');
    // Aktiver Zeitwert (manuell).
    expect(html).toContain("12 €/h");
    // 0.55.0: Bei gesetztem Zeitwert beschreibt der Hinweis die Automatik im
    // Konjunktiv — vorher stand dort „0 = Auto: 10 €/h — gerade Nebenzeit.“
    // neben dem Feldwert „Auto (12 €/h · Nebenzeit)“: zwei Zahlen für
    // denselben Zustand, obwohl die Automatik gar nicht greift.
    expect(html).toContain("Fester Wert.");
    expect(html).toContain("gerade wären das");
    expect(html).not.toContain("0 = Auto:");
    // Zeitwert 0 = Automatik zeigt den auto-berechneten Wert. `timeValueUsed`
    // ist in diesem Zustand per Definition `autoZ.z` — die Vorgabe hielt hier
    // vorher 16 gegen autoZ.z = 10 und beschrieb damit einen Zustand, den es
    // nicht geben kann.
    const auto = renderToStaticMarkup(
      <VehiclePanel
        {...vehicleProps({
          timeValue: 0,
          timeValueUsed: 16,
          autoZ: { z: 16, isPeak: true },
        })}
      />,
    );
    expect(auto).toContain("Auto (16 €/h · Stoßzeit)");
    expect(auto).toContain("Automatik nach Uhrzeit");
  });

  it("nimmt die Fahrzeug-Grenzen aus PROFILE_BOUNDS (100-L-Tank)", () => {
    // Prüfbericht §5: Der Beleg erlaubt 5–100 L und `app/profiles.py`
    // prüft 10–100 L — die Slider dürfen die Tankmenge nicht bei 80 L
    // kappen. Eine Quelle für beide Seiten: PROFILE_BOUNDS.
    const html = renderToStaticMarkup(<VehiclePanel {...vehicleProps()} />);
    expect(html).toMatch(/id="liters"[^>]*max="100"/);
    expect(html).toContain(
      `Deine Tankmenge direkt eingeben (L, ${PROFILE_BOUNDS.liters.min}–${PROFILE_BOUNDS.liters.max})`,
    );
    // Die übrigen Felder tragen dieselben Zahlen wie das Profil.
    expect(html).toMatch(/id="consumption"[^>]*max="15"/);
    expect(html).toMatch(/id="tankCapacity"[^>]*max="120"/);
    expect(html).toMatch(/id="timeValue"[^>]*max="30"/);
    expect(html).toMatch(/id="speed"[^>]*max="80"/);
  });

  it("bietet Profile als Segment-Steuerung (+ Neu / verwalten)", () => {
    const html = renderToStaticMarkup(
      <VehiclePanel
        {...vehicleProps({
          profilesRes: {
            ...emptyResource,
            data: {
              profiles: [
                {
                  id: "p1",
                  name: "Mein Auto",
                  fuel: "e10",
                  liters: 40,
                  consumption: 7,
                  time_value_eur_h: 12,
                  speed_kmh: 45,
                  detour_mode: "onroute",
                  tank_capacity_l: 50,
                },
              ],
              active: "p1",
            } as Profiles,
          } as ResourceState<Profiles>,
          activeProfileId: "p1",
        })}
      />,
    );
    expect(html).toContain("Mein Auto");
    expect(html).toContain("+ Neu / verwalten");
    expect(html).toContain('role="group"');
  });

  it("kennzeichnet Profil-Werte als haushaltsweit, sonst gerätelokal", () => {
    const withProfile = renderToStaticMarkup(
      <VehiclePanel {...vehicleProps({ activeProfileName: "Mein Auto" })} />,
    );
    expect(withProfile).toContain("Profil „Mein Auto“ — gilt haushaltsweit");
    const without = renderToStaticMarkup(<VehiclePanel {...vehicleProps()} />);
    expect(without).toContain("nur dieses Gerät");
  });
});

describe("Einstellungen → App (SettingsPanel)", () => {
  it("bietet Stadt und Kraftstoff (Kontext — gilt für alle Ansichten)", () => {
    const html = renderToStaticMarkup(<SettingsPanel {...settingsProps()} />);
    expect(html).toContain('id="settings-city"');
    // Stadt-Optionen aus den Daten.
    expect(html).toContain("Gütersloh");
    // Kraftstoff-Schnellwahl mit den drei Werten.
    expect(html).toContain("E10");
    expect(html).toContain("E5");
    expect(html).toContain("Diesel");
  });

  it("kennt genau die neun Server-Schwellen, keine mehr und keine weniger", () => {
    const keys = THRESHOLD_ROWS.map((row) => row.key);
    expect([...keys].sort()).toEqual([...SERVER_THRESHOLD_KEYS].sort());
    expect(new Set(keys).size).toBe(SERVER_THRESHOLD_KEYS.length);
  });

  it("formatiert Schwellen-Werte über die Formatter (€ in €, P in %)", () => {
    expect(thresholdValueLabel("eur", 1.5)).toBe("1,50 €");
    expect(thresholdValueLabel("eur", 0.5)).toBe("0,50 €");
    expect(thresholdValueLabel("percent", 0.7)).toBe("70 %");
    expect(thresholdValueLabel("percent", 0.5)).toBe("50 %");
    // Fehlender Server-Wert bleibt ehrlich „—“ statt 0,00 €.
    expect(thresholdValueLabel("eur", undefined)).toBe("—");
    expect(thresholdValueLabel("percent", null)).toBe("—");
  });

  it("sagt im Status, womit die Engine rechnet", () => {
    expect(thresholdStatusLine(null)).toContain("Startwerte");
    expect(thresholdStatusLine(tuning({ auto_apply: false }))).toBe(
      "M7-Nachzug aus — die Engine rechnet mit den Startwerten.",
    );
    expect(
      thresholdStatusLine(tuning({ auto_apply: true, applied: true })),
    ).toContain("weicht von den Startwerten ab");
    expect(
      thresholdStatusLine(tuning({ auto_apply: true, applied: false })),
    ).toContain("keine Abweichung");
  });

  it("benennt die Stichprobe je Aktion", () => {
    expect(thresholdSampleLine(null)).toBeNull();
    expect(thresholdSampleLine(tuning())).toContain("Warten n=30");
    expect(thresholdSampleLine(tuning())).toContain("Jetzt n=20");
    expect(thresholdSampleLine(tuning())).toContain("Woanders n=10");
    expect(thresholdSampleLine(tuning())).toContain("Mindest je Aktion: 25");
  });

  it("rendert alle neun Zeilen mit Server-Werten und read-only-Quelle", () => {
    const html = renderToStaticMarkup(<SettingsPanel {...settingsProps()} />);
    for (const key of SERVER_THRESHOLD_KEYS) {
      const row = THRESHOLD_ROWS.find((r) => r.key === key);
      expect(row, `Zeile für ${key} fehlt`).toBeDefined();
    }
    expect(html).toContain("Warten (blau)");
    expect(html).toContain("Warten — „Eher warten“");
    expect(html).toContain("Woanders tanken");
    expect(html).toContain("Jetzt tanken");
    // Server-Werte, formatiert.
    expect(html).toContain("2,00 €");
    expect(html).toContain("70 %");
    expect(html).toContain("0,50 €");
    // Read-only-Ausweis und Status.
    expect(html).toContain("schreibgeschützt");
    expect(html).toContain(
      "M7-Nachzug aus — die Engine rechnet mit den Startwerten.",
    );
    // Kein einzelnes Eingabefeld in der Tabelle.
    const tableStart = html.indexOf("Entscheidungsschwellen (aktiv)");
    const tableEnd = html.indexOf("Darstellung");
    const tablePart = html.slice(tableStart, tableEnd);
    expect(tablePart).not.toContain("<input");
  });

  it("zeigt bei fehlender Statistik einen ehrlichen Leerstand statt Nullen", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        {...settingsProps({
          statsSummaryRes: {
            ...emptyResource,
            data: null,
          } as ResourceState<StatsSummary>,
        })}
      />,
    );
    expect(html).toContain("Noch kein Engine-Lauf ausgewertet");
    expect(html).not.toContain("2,00 €");
  });

  it("zeigt die Begründung des Nachzugs, wenn sich Werte ändern", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        {...settingsProps({
          statsSummaryRes: {
            ...emptyResource,
            data: summary({
              threshold_tuning: tuning({
                changed: true,
                auto_apply: true,
                applied: true,
                reasons: ["WARTEN 60 % richtig — Gates angehoben."],
              }),
            }),
          } as ResourceState<StatsSummary>,
        })}
      />,
    );
    expect(html).toContain("Begründung des Nachzugs (Engine)");
    expect(html).toContain("WARTEN 60 % richtig — Gates angehoben.");
    expect(html).toContain("weicht von den Startwerten ab");
  });

  it("nennt das Rauschband des M7-Nachzugs (H3)", () => {
    expect(thresholdHysteresisLine(null)).toBeNull();
    expect(thresholdHysteresisLine(tuning())).toBeNull(); // alte Engine
    const line = thresholdHysteresisLine(
      tuning({
        hysteresis: {
          noise_band: { wait: 0.172, now: 0.09, elsewhere: null },
          deadband_p: 0.02,
          deadband_eur: 0.05,
        },
      }),
    );
    expect(line).toContain("Rauschband");
    expect(line).toContain("Warten ±17 pp");
    expect(line).toContain("Jetzt ±9 pp");
    expect(line).not.toContain("Woanders");
    expect(line).toContain("ziehen die Schwellen nicht");
  });

  it("erklärt auch ohne Änderung, warum nicht nachgezogen wird", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        {...settingsProps({
          statsSummaryRes: {
            ...emptyResource,
            data: summary({
              threshold_tuning: tuning({
                changed: false,
                auto_apply: true,
                reasons: ["WARTEN 68 % richtig — Lücke liegt im Rauschband."],
                hysteresis: { noise_band: { wait: 0.17 } },
              }),
            }),
          } as ResourceState<StatsSummary>,
        })}
      />,
    );
    expect(html).toContain("Warum nicht nachgezogen wird (Engine)");
    expect(html).toContain("Lücke liegt im Rauschband");
    expect(html).toContain("Rauschband");
  });

  it("bietet beide Themen mit aria-pressed", () => {
    // Seit der neuen GUI (Material You) lautet das helle Thema
    // „Hell (Standard)“ und ist der Default; „Dunkel“ bleibt auswählbar.
    // Test-Default props: theme = "dark" — dann trägt der erste Button
    // (Dunkel) das aria-pressed; bei theme = "light" der zweite (Hell).
    const dark = renderToStaticMarkup(<SettingsPanel {...settingsProps()} />);
    expect(dark).toContain("Hell (Standard)");
    expect(dark).toContain("Dunkel");
    const darkGroup = dark.slice(
      dark.indexOf('aria-label="Darstellung (dunkel oder hell)"'),
    );
    expect(
      darkGroup.indexOf('aria-pressed="true"') < darkGroup.indexOf("Dunkel"),
    ).toBe(true);

    const light = renderToStaticMarkup(
      <SettingsPanel {...settingsProps({ theme: "light" })} />,
    );
    const lightGroup = light.slice(
      light.indexOf('aria-label="Darstellung (dunkel oder hell)"'),
    );
    expect(
      lightGroup.indexOf('aria-pressed="true"') > lightGroup.indexOf("Dunkel"),
    ).toBe(true);
  });

  it("listet angepinnte Stationen mit lösen-Button und zeigt die Version", () => {
    const html = renderToStaticMarkup(<SettingsPanel {...settingsProps()} />);
    expect(html).toContain("Shell Hauptstraße");
    expect(html).toContain("lösen");
    expect(html).toContain("0.35.0");
    // Beleg-Export.
    expect(html).toContain("Belege als Datei laden");
  });
});

describe("Theme-Logik (data.ts)", () => {
  it("kennt genau zwei Themen und lehnt alles andere ab", () => {
    expect([...APP_THEMES]).toEqual(["dark", "light"]);
    expect(isAppTheme("dark")).toBe(true);
    expect(isAppTheme("light")).toBe(true);
    expect(isAppTheme("system")).toBe(false);
    expect(isAppTheme("")).toBe(false);
    expect(isAppTheme(null)).toBe(false);
  });

  it("wendet das Thema auf <html> und das theme-color-Meta an", () => {
    // happy-dom liefert ein leeres Dokument — Meta-Element anlegen.
    document.head.innerHTML = '<meta name="theme-color" content="#020617" />';
    document.documentElement.className = "dark";

    applyAppTheme("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe(APP_THEME_META_COLOR.light);

    applyAppTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe(APP_THEME_META_COLOR.dark);
  });
});

// ---- Fixtures für die Buchhaltung (aus `views/Ich.test.tsx`) --------------
const noop = () => {};

const vehicle: VehiclePanelProps = {
  liters: 40,
  setLiters: noop,
  consumption: 7,
  setConsumption: noop,
  tankCapacity: 50,
  setTankCapacity: noop,
  tankPercent: null,
  setTankPercent: noop,
  activeProfileName: null,
  speed: 45,
  setSpeed: noop,
  timeValue: 0,
  setTimeValue: noop,
  timeValueUsed: 10,
  autoZ: { z: 10, isPeak: false },
  detourMode: "onroute",
  setDetourMode: noop,
  profilesRes: {
    data: { profiles: [], active: null },
    error: false,
    errorCode: null,
    pending: false,
    receivedAt: 0,
  } as ResourceState<Profiles>,
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
  statsSummaryRes: {
    data: null,
    error: false,
    errorCode: null,
    pending: false,
    receivedAt: 0,
  },
  refreshNow: noop,
  theme: "dark",
  setTheme: noop,
  pinnedStations: [],
  togglePin: noop,
  version: "0.78.0",
  onOpenGlossary: noop,
};

// Übernommen aus `views/Ich.test.tsx` (0.78.0: der Bereich ist aufgegangen).
// Die Buchhaltung liegt hinter einem `<details>`; die Tests rendern sie offen.
// ======================================================================

const quickDraft: FillDraftCheck = {
  litersError: null,
  priceError: null,
  stationMissing: true,
  ok: false,
};

const baseProps: SettingsViewProps = {
  vehicle,
  settings,
  fillsOpen: true,
  onFillsOpenChange: noop,
  balance: {
    fillsSummary: {
      data: null,
      error: false,
      errorCode: null,
      pending: false,
      receivedAt: 0,
    },
    onRetry: noop,
  },
  fills: {
    pinnedFirstStations: [],
    quickStationId: "",
    setQuickStationId: noop,
    quickLitersStr: "40",
    setQuickLitersStr: noop,
    quickPriceStr: "",
    setQuickPriceStr: noop,
    quickDraft,
    priceOf: () => null,
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
  },
};

function render(overrides: Partial<SettingsViewProps> = {}) {
  const props = { ...baseProps, ...overrides } as SettingsViewProps;
  return renderToStaticMarkup(<SettingsView {...props} />);
}

describe("Einstellungen: Aufbau", () => {
  it("steuert die Unterseiten als ARIA-Tabs", () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    // Zwei dauerhafte Teile — die Buchhaltung ist ein `<details>`, kein Tab.
    expect(html).toContain("Fahrzeug");
    expect(html).toContain("App");
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
    // Kraftstoff/Stadt liegen im App-Kontext.
    expect(html).toContain("Kraftstoff und Stadt liegen unter „App“");
  });
});

describe("Einstellungen: Leerzustände", () => {
  it("Belege: ohne Buchungen der ehrliche Hinweis statt leeren Fläche", () => {
    const html = render();
    expect(html).toContain("Noch keine Belege");
    expect(html).toContain("Noch keine Station eingerichtet");
  });

  it("Bilanz: ohne Belege füllt sie sich mit der Buchung", () => {
    const html = render();
    expect(html).toContain(
      "Noch keine Belege — die Bilanz füllt sich mit jedem erfassten",
    );
  });
});

// O32 — Die Belegmaske zeigt den Live-Preis neben dem Feld.
//
// Befund: Zwischen Empfehlung und Erfassung vergehen Minuten bis Stunden
// (Offline-Queue). Der Nutzer sah eine vorbefüllte Zahl ohne Vergleich. Der
// Render-Test hält fest, dass die Zeile wirklich in der Maske steht — die
// Regeln des Satzes selbst liegen in `fills.test.ts`.
describe("Einstellungen → Belege und Bilanz: Live-Preis an der Maske (O32)", () => {
  function station(overrides: Partial<Station> = {}): Station {
    return {
      station_id: "nord",
      city: "Frankfurt",
      name: "Demo-Tank Nord",
      brand: "Demo",
      fuel: "e10" as Fuel,
      maps_url: null,
      price: 1.719,
      last_price: 1.719,
      status: "open",
      fresh: true,
      observed_at: "2026-09-18T18:57:00+02:00",
      age_minutes: 3,
      ...overrides,
    };
  }
  const maskProps = {
    pinnedFirstStations: [station()],
    quickStationId: "nord",
    priceOf: (row: Station) => row.price,
    now: Date.parse("2026-09-18T19:00:00+02:00"),
  };

  it("nennt Live-Preis und Alter neben dem Preisfeld", () => {
    const html = render({
      fills: { ...baseProps.fills, ...maskProps, quickPriceStr: "1,719" },
    });
    expect(html).toContain(
      "Jetzt an der Station: 1,719 €/L, gemeldet vor 3 Minuten.",
    );
  });

  it("markiert eine Abweichung über der Schwelle", () => {
    const html = render({
      fills: { ...baseProps.fills, ...maskProps, quickPriceStr: "1,769" },
    });
    expect(html).toContain("5,0 ct/L über dem gemeldeten Preis");
  });

  it("schweigt, wenn die Station keinen frischen Preis hat", () => {
    const html = render({
      fills: {
        ...baseProps.fills,
        ...maskProps,
        pinnedFirstStations: [station({ price: null })],
        quickPriceStr: "1,719",
      },
    });
    expect(html).not.toContain("Jetzt an der Station:");
  });
});

describe("Einstellungen: App-Kontext am Wirkungsort", () => {
  it("Stadt, Darstellung und Über — ohne Eingabefelder für die Schwellen", () => {
    const html = render({ initialSection: "app" });
    expect(html).toContain('id="settings-city"');
    // Seit der neuen GUI ist „Hell (Standard)“ der Default, „Dunkel“ die Option.
    expect(html).toContain("Hell (Standard)");
    expect(html).toContain("Dunkel");
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
      mostUsedStation([fill("a"), fill("a"), fill("a", { voided: true })]),
    ).toEqual({ name: "Station a", count: 2 });
  });

  it("erscheint als Maßstab-Zeile unter der Beleg-Tabelle", () => {
    const fills = [fill("a"), fill("b"), fill("a")];
    const html = render({
      fills: { ...baseProps.fills, fillList: fills, visibleFills: fills },
    });
    expect(html).toContain("Maßstab: der Median deines Sets (Standard)");
    expect(html).toContain("meistgenutzte Station: Station a");
  });

  it("trägt die Belege mobil als Karte und ab sm als Tabelle", () => {
    // Nutzer-Feedback 16.09.2026 („verschiedene Dinge die scrollen müssen“):
    // Die Belegliste war eine Tabelle mit 560 px Mindestbreite und musste auf
    // dem Handy seitlich geschoben werden. Mobil trägt sie jetzt eine Karte
    // (zwei Zeilen, kein Querlauf), ab `sm` unverändert die Tabelle. Beide
    // Fassungen lesen dieselben Werte aus `fillRows()`.
    const fills = [
      fill("a", { saved_vs_always_now_eur: 3.2 }),
      fill("b", { voided: true }),
    ];
    const html = render({
      fills: { ...baseProps.fills, fillList: fills, visibleFills: fills },
    });
    expect(html).toContain('class="divide-y divide-slate-800/60 sm:hidden"');
    expect(html).toContain('class="hidden overflow-x-auto sm:block"');
    // Karte und Tabelle zeigen dieselben Werte — je zweimal im Markup.
    expect(html.split("3,20 € günstiger").length - 1).toBe(2);
    expect(html.split("Station a").length - 1).toBe(2);
    // Der Storno-Knopf steht nur beim nicht stornierten Beleg.
    expect(html.split(">Stornieren<").length - 1).toBe(2);
  });
});

describe("Ich: Prognosepreis (O17)", () => {
  const fill = (id: string, overrides: Partial<Fill> = {}): Fill => ({
    id: `f-${id}`,
    station_id: id,
    station_name: `Station ${id}`,
    liters: 40,
    price_paid: 1.7,
    fuel: "e10",
    ...overrides,
  });

  it("kennzeichnet Prognosepreis-Belege in Karte und Tabelle", () => {
    const fills = [
      fill("a", { price_source: "prognose" }),
      fill("b", { price_source: "live" }),
    ];
    const html = render({
      fills: { ...baseProps.fills, fillList: fills, visibleFills: fills },
    });
    // Karte und Tabelle zeigen denselben Hinweis — je einmal im Markup.
    expect(html.split("Prognosepreis — kein gezahlter Preis").length - 1).toBe(
      2,
    );
  });

  it("zeigt die verifizierte Ersparnis als zweite, benannte Spalte", () => {
    const row: BalanceRow = {
      key: "2026-09",
      fills: 2,
      liters: 80,
      total_eur: 136,
      avg_eur_per_fill: 68,
      avg_eur_per_liter: 1.7,
      saved_eur: 8,
      saved_verified_eur: 2,
      n_prognosis_price: 1,
      baseline_eur: 144,
    };
    const summary: FillsSummary = {
      n_fills_total: 2,
      months: [row],
      years: [],
      overall: { ...row, n_without_date: 0, saved_pct: 5.5 },
    };
    const html = render({
      balance: {
        fillsSummary: {
          data: summary,
          error: false,
          errorCode: null,
          pending: false,
          receivedAt: 1,
        },
        onRetry: noop,
      },
    });
    expect(html).toContain("Ohne Prognosepreis:");
    expect(html).toContain("+2,00 €");
    expect(html).toContain("1 Beleg zählt nicht mit");
    expect(html).toContain("verifiziert +2,00 € (ohne Prognosepreis-Belege)");
  });

  it("schweigt ohne Prognosepreis-Belege (keine zweite Spalte)", () => {
    const row: BalanceRow = {
      key: "2026-09",
      fills: 1,
      liters: 40,
      total_eur: 68,
      avg_eur_per_fill: 68,
      avg_eur_per_liter: 1.7,
      saved_eur: 2,
      saved_verified_eur: 2,
      n_prognosis_price: 0,
      baseline_eur: 70,
    };
    const summary: FillsSummary = {
      n_fills_total: 1,
      months: [row],
      years: [],
      overall: { ...row, n_without_date: 0, saved_pct: 2.8 },
    };
    const html = render({
      balance: {
        fillsSummary: {
          data: summary,
          error: false,
          errorCode: null,
          pending: false,
          receivedAt: 1,
        },
        onRetry: noop,
      },
    });
    expect(html).not.toContain("Ohne Prognosepreis:");
    expect(html).not.toContain("ohne Prognosepreis-Belege");
  });

  it("O30: nennt netto nach Umweg neben dem Brutto-Wert", () => {
    const row: BalanceRow = {
      key: "2026-09",
      fills: 2,
      liters: 80,
      total_eur: 136,
      avg_eur_per_fill: 68,
      avg_eur_per_liter: 1.7,
      saved_eur: 8,
      saved_net_eur: 6.34,
      detour_cost_eur: 1.66,
      n_detour_fills: 1,
      n_detour_estimated: 1,
      saved_verified_eur: 8,
      n_prognosis_price: 0,
      baseline_eur: 144,
    };
    const summary: FillsSummary = {
      n_fills_total: 2,
      months: [row],
      years: [],
      overall: { ...row, n_without_date: 0, saved_pct: 5.5 },
    };
    const html = render({
      balance: {
        fillsSummary: {
          data: summary,
          error: false,
          errorCode: null,
          pending: false,
          receivedAt: 1,
        },
        onRetry: noop,
      },
    });
    // Beide Zeilen benannt: brutto …
    expect(html).toContain("· brutto");
    expect(html).toContain("+8,00 €");
    // … und netto nach den bekannten Umwegkosten.
    expect(html).toContain("Nach Umweg:");
    expect(html).toContain("+6,34 €");
    expect(html).toContain("Umwegkosten 1,66 € bei 1 Beleg");
    expect(html).toContain("davon 1 mit geschätzter Strecke");
  });

  it("O30: ohne Umweg bleibt die Zahl gleich und sagt das", () => {
    const row: BalanceRow = {
      key: "2026-09",
      fills: 1,
      liters: 40,
      total_eur: 68,
      avg_eur_per_fill: 68,
      avg_eur_per_liter: 1.7,
      saved_eur: 2,
      saved_net_eur: 2,
      detour_cost_eur: 0,
      n_detour_fills: 0,
      n_detour_estimated: 0,
      saved_verified_eur: 2,
      n_prognosis_price: 0,
      baseline_eur: 70,
    };
    const summary: FillsSummary = {
      n_fills_total: 1,
      months: [row],
      years: [],
      overall: { ...row, n_without_date: 0, saved_pct: 2.8 },
    };
    const html = render({
      balance: {
        fillsSummary: {
          data: summary,
          error: false,
          errorCode: null,
          pending: false,
          receivedAt: 1,
        },
        onRetry: noop,
      },
    });
    expect(html).toContain("Nach Umweg: dieselbe Zahl — kein Beleg mit Umweg.");
    expect(html).not.toContain("Umwegkosten");
  });
});
