// @vitest-environment happy-dom
// C4 (weitergezogen, Phase 2): „Einstellungen verschwindet als eigener Tab“
// (UI-NEUENTWURF §4.2) — die Fahrzeug-Felder wohnen in „Ich → Fahrzeug“
// (VehiclePanel), Kontext/Schwellen/Darstellung/Daten in „Ich →
// Einstellungen“ (SettingsPanel).
//
// Die Schwellen-Tabelle zeigt ausschließlich Server-Werte: die Tests
// prüfen, dass alle neun Schwellen der Engine (app/thresholds.py
// DEFAULT_THRESHOLDS) genau ein Mal vorkommen, dass Werte nur über die
// Formatter formatiert werden (€ mit euro()/deTrimmed, P in %) und dass
// der Status ehrlich sagt, womit die Engine rechnet.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SettingsPanel,
  VehiclePanel,
  type SettingsPanelProps,
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

describe("Ich → Fahrzeug (VehiclePanel)", () => {
  it("bietet Tankmenge, Verbrauch, Tankgröße, Zeitwert, Tempo, Fahrtcharakter", () => {
    const html = renderToStaticMarkup(<VehiclePanel {...vehicleProps()} />);
    // Eingabeorte mit den Ids, die der alte Einstellungen-Tab hatte.
    expect(html).toContain('id="liters"');
    expect(html).toContain('id="consumption"');
    expect(html).toContain('id="tankCapacity"');
    expect(html).toContain('id="timeValue"');
    expect(html).toContain('id="speed"');
    expect(html).toContain('id="detourMode"');
    // Aktiver Zeitwert (manuell) und die Auto-Erklärung (verbatim).
    expect(html).toContain("12 €/h");
    expect(html).toContain("0 = Auto: 10 €/h — gerade Nebenzeit.");
    // Zeitwert 0 = Automatik zeigt den auto-berechneten Wert.
    const auto = renderToStaticMarkup(
      <VehiclePanel {...vehicleProps({ timeValue: 0, timeValueUsed: 16 })} />,
    );
    expect(auto).toContain("Auto (16 €/h · Nebenzeit)");
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
    const without = renderToStaticMarkup(
      <VehiclePanel {...vehicleProps()} />,
    );
    expect(without).toContain("nur dieses Gerät");
  });
});

describe("Ich → Einstellungen (SettingsPanel)", () => {
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
    expect(html).toContain("Warten (grün)");
    expect(html).toContain("Warten (gelb)");
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
    const dark = renderToStaticMarkup(<SettingsPanel {...settingsProps()} />);
    expect(dark).toContain("Dunkel (Standard)");
    expect(dark).toContain("Hell");
    // Im Theme-Block trägt der dunkle Button das aria-pressed.
    const darkGroup = dark.slice(
      dark.indexOf('aria-label="Darstellung (dunkel oder hell)"'),
    );
    expect(
      darkGroup.indexOf('aria-pressed="true"') <
        darkGroup.indexOf("Dunkel (Standard)"),
    ).toBe(true);

    const light = renderToStaticMarkup(
      <SettingsPanel {...settingsProps({ theme: "light" })} />,
    );
    const lightGroup = light.slice(
      light.indexOf('aria-label="Darstellung (dunkel oder hell)"'),
    );
    expect(
      lightGroup.indexOf('aria-pressed="true"') >
        lightGroup.indexOf("Dunkles Slate"),
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
