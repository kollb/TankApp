// @vitest-environment happy-dom
// C4: Einstellungen-Tab — Schwellen-Tabelle (read-only aus
// /api/v1/stats/summary → thresholds) und Dark/Light-Umschaltung.
//
// Die Tabelle zeigt ausschließlich Server-Werte: die Tests prüfen, dass
// alle neun Schwellen der Engine (app/thresholds.py DEFAULT_THRESHOLDS)
// genau ein Mal vorkommen, dass Werte nur über die Formatter formatiert
// werden (€ mit euro(), Wahrscheinlichkeit mit percentLabel()) und dass
// der Status ehrlich sagt, womit die Engine rechnet.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsView, type SettingsViewProps } from "./views/Settings";
import {
  APP_THEME_META_COLOR,
  APP_THEMES,
  applyAppTheme,
  isAppTheme,
  THRESHOLD_ROWS,
  thresholdSampleLine,
  thresholdStatusLine,
  thresholdValueLabel,
  type StatsSummary,
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

function summary(
  overrides: Partial<StatsSummary> = {},
): StatsSummary {
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

const emptyResource = {
  data: null,
  error: false,
  errorCode: null,
  pending: false,
  receivedAt: 0,
};

function viewProps(
  overrides: Partial<SettingsViewProps> = {},
): SettingsViewProps {
  return {
    data: {
      generated_at: "2026-09-13T08:00:00+02:00",
      fuel: "e10",
      cities: ["Frankfurt", "Gütersloh"],
      stations: [],
      connection_error: null,
      fresh_prices: 0,
    },
    activeCity: "Frankfurt",
    setCity: () => {},
    fuel: "e10",
    setFuel: () => {},
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
    statsSummaryRes: { ...emptyResource, data: summary() },
    refreshNow: () => {},
    theme: "dark",
    setTheme: () => {},
    ...overrides,
  };
}

describe("C4: Schwellen-Tabelle (read-only aus /api/v1/stats/summary)", () => {
  it("kennt genau die neun Server-Schwellen, keine mehr und keine weniger", () => {
    const keys = THRESHOLD_ROWS.map((row) => row.key);
    expect([...keys].sort()).toEqual([...SERVER_THRESHOLD_KEYS].sort());
    expect(new Set(keys).size).toBe(SERVER_THRESHOLD_KEYS.length);
  });

  it("formatiert Werte über die Formatter (€/L-Ebene in €, P in %)", () => {
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
    const html = renderToStaticMarkup(<SettingsView {...viewProps()} />);
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
    expect(html).toContain("read-only · Quelle: /api/v1/stats/summary");
    expect(html).toContain(
      "M7-Nachzug aus — die Engine rechnet mit den Startwerten.",
    );
    // Kein einzles Eingabefeld in der Tabelle.
    const tableStart = html.indexOf("Entscheidungsschwellen (aktiv)");
    const tableEnd = html.indexOf("Darstellung");
    const tablePart = html.slice(tableStart, tableEnd);
    expect(tablePart).not.toContain("<input");
  });

  it("zeigt bei fehlender Statistik einen ehrlichen Leerstand statt Nullen", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        {...viewProps({
          statsSummaryRes: { ...emptyResource, data: null },
        })}
      />,
    );
    expect(html).toContain("Noch keine Statistik geladen");
    expect(html).not.toContain("2,00 €");
  });

  it("zeigt die Begründung des Nachzugs, wenn sich Werte ändern", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        {...viewProps({
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
          },
        })}
      />,
    );
    expect(html).toContain("Begründung des Nachzugs (Engine)");
    expect(html).toContain("WARTEN 60 % richtig — Gates angehoben.");
    expect(html).toContain("weicht von den Startwerten ab");
  });
});

describe("C4: alle Defaults an einem Ort", () => {
  it("bietet Kraftstoff, Stadt, Liter, Verbrauch, Zeitwert, Tempo, Tankgröße", () => {
    const html = renderToStaticMarkup(<SettingsView {...viewProps()} />);
    // Eingabeorte mit den Ids, die der Alltag bisher hatte (plus Stadt).
    expect(html).toContain('id="liters"');
    expect(html).toContain('id="consumption"');
    expect(html).toContain('id="tankCapacity"');
    expect(html).toContain('id="timeValue"');
    expect(html).toContain('id="speed"');
    expect(html).toContain('id="detourMode"');
    expect(html).toContain('id="settings-city"');
    // Stadt-Optionen aus den Daten.
    expect(html).toContain("Gütersloh");
    // Aktiver Zeitwert (manuell) und die Auto-Erklärung.
    expect(html).toContain("12 €/h");
    expect(html).toContain(
      "0 = Auto: 16 €/h im Peak (16:30–20:00), sonst 10 €/h.",
    );
    // Zeitwert 0 = Automatik zeigt den auto-berechneten Wert.
    const auto = renderToStaticMarkup(
      <SettingsView {...viewProps({ timeValue: 0, timeValueUsed: 16 })} />,
    );
    expect(auto).toContain("Auto (16 €/h offpeak)");
  });

  it("kennzeichnet Profil-Werte als haushaltsweit, wenn ein Profil aktiv ist", () => {
    const withProfile = renderToStaticMarkup(
      <SettingsView {...viewProps({ activeProfileName: "Mein Auto" })} />,
    );
    expect(withProfile).toContain("Profil „Mein Auto“ — gilt haushaltsweit");
    const without = renderToStaticMarkup(<SettingsView {...viewProps()} />);
    expect(without).toContain("gelten nur auf diesem Gerät");
  });
});

describe("C4: Dark/Light-Umschaltung", () => {
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
    document.head.innerHTML =
      '<meta name="theme-color" content="#020617" />';
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

  it("bietet beide Themen im Tab mit aria-pressed an", () => {
    const dark = renderToStaticMarkup(<SettingsView {...viewProps()} />);
    expect(dark).toContain("Dunkles Slate (Standard)");
    expect(dark).toContain("Hell (Slate)");
    // Genau zwei Buttons sind aktiv: Kraftstoff e10 + Theme dark.
    expect(dark.match(/aria-pressed="true"/g)?.length).toBe(2);
    // Im Theme-Block trägt der dunkle Button das aria-pressed.
    const darkGroup = dark.slice(
      dark.indexOf('aria-label="Darstellung (dunkel oder hell)"'),
    );
    expect(
      darkGroup.indexOf('aria-pressed="true"') <
        darkGroup.indexOf("Dunkles Slate"),
    ).toBe(true);
    expect(
      darkGroup.indexOf('aria-pressed="true"') >
        darkGroup.indexOf("Hell (Slate)"),
    ).toBe(false);

    const light = renderToStaticMarkup(
      <SettingsView {...viewProps({ theme: "light" })} />,
    );
    // Im Light-Stand trägt der helle Button das aria-pressed.
    const lightGroup = light.slice(
      light.indexOf('aria-label="Darstellung (dunkel oder hell)"'),
    );
    expect(
      lightGroup.indexOf('aria-pressed="true"') >
        lightGroup.indexOf("Dunkles Slate"),
    ).toBe(true);
    expect(
      lightGroup.indexOf('aria-pressed="false"') <
        lightGroup.indexOf("Dunkles Slate"),
    ).toBe(true);
  });
});
