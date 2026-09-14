// @vitest-environment happy-dom
// C5 + C8: Die Regeln aus styles.css, die die Bedienung tragen, sind hier
// festgenagelt — Kontrast (AA), Touch-Ziele (44 px), Pull-to-Refresh-Sperre,
// Querformat und Installationshinweis. Der Test liest die Quelle als Text:
// Er prüft die Zusagen, nicht die Optik.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  INSTALL_SNOOZE_KEY,
  installHintKind,
  installHintText,
  iosSafari,
  readSnooze,
  snoozeUntil,
  writeSnooze,
} from "./install";
import { PTR_OFF_CLASS, setPtrOff } from "./ptr";

function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

const STYLES = read("styles.css");
const DASHBOARD = read("Dashboard.tsx");
const SLIDER = read("components/PrecisionSlider.tsx");
const MAP = read("components/StationMap.tsx");
const MANIFEST = JSON.parse(read("../public/manifest.json")) as {
  display?: string;
  orientation?: string;
};

/** Alle --color-* Übersteuerungen eines CSS-Blocks. */
function colorTokens(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(
    /--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g,
  )) {
    tokens[name] = value.toLowerCase();
  }
  return tokens;
}

function block(selector: string): string {
  const start = STYLES.indexOf(selector);
  expect(start, `${selector} fehlt in styles.css`).toBeGreaterThanOrEqual(0);
  return STYLES.slice(start, STYLES.indexOf("}", start));
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("C5: Kontrast AA der gedämpften Texttöne", () => {
  const dark = colorTokens(block(":root {"));
  const light = colorTokens(block("html.light {"));

  // Flächen, auf denen gedämpfter Text wirklich liegt.
  const darkSurfaces = ["#0b0f19", "#020617", "#0f172a", "#1e293b"];
  const lightSurfaces = ["#eef2f7", "#ffffff", "#e2e8f0"];

  it.each(["slate-500", "slate-600"])(
    "dunkel: --color-%s hält 4,5:1 auf allen dunklen Flächen",
    (name) => {
      const value = dark[name];
      expect(value, `${name} wird in :root nicht angehoben`).toBeDefined();
      for (const surface of darkSurfaces) {
        expect(
          contrast(value, surface),
          `${value} auf ${surface} ist zu blass`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(["slate-500", "slate-600"])(
    "hell: --color-%s hält 4,5:1 auf Seite und Karte",
    (name) => {
      const value = light[name];
      expect(value, `${name} wird unter html.light nicht angehoben`).toBeDefined();
      for (const surface of lightSurfaces) {
        expect(
          contrast(value, surface),
          `${value} auf ${surface} ist zu blass`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("die übrigen Texttöne der Skala bleiben lesbar", () => {
    const palette: Record<string, string> = {
      "#f8fafc": "#0b0f19", // slate-50
      "#f1f5f9": "#0b0f19", // slate-100
      "#e2e8f0": "#0f172a", // slate-200
      "#cbd5e1": "#1e293b", // slate-300
      "#94a3b8": "#1e293b", // slate-400
      "#6ee7b7": "#1e293b", // emerald-300
      "#34d399": "#1e293b", // emerald-400
      "#fcd34d": "#1e293b", // amber-300
      "#fbbf24": "#1e293b", // amber-400
      "#fda4af": "#1e293b", // rose-300
      "#38bdf8": "#1e293b", // sky-400
    };
    for (const [color, surface] of Object.entries(palette)) {
      expect(contrast(color, surface), `${color} auf ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("C5: Touch-Ziele", () => {
  it("44 px gelten bei grober Zeigerart — und nur dort", () => {
    const coarse = STYLES.indexOf(
      "@media (pointer: coarse), (any-pointer: coarse)",
    );
    expect(coarse).toBeGreaterThanOrEqual(0);
    const rule = STYLES.slice(coarse, STYLES.indexOf("\n}", coarse));
    expect(rule).toContain("min-height: 44px");
    expect(rule).toContain("min-width: 44px");
    for (const hook of ['button', '[role="button"]', "select", "input"]) {
      expect(rule, `${hook} fehlt im 44-px-Block`).toContain(hook);
    }
  });

  it("die Karten-Pins sind per Tastatur erreichbar", () => {
    expect(MAP).toContain("tabIndex={0}");
    expect(MAP).toContain('role="button"');
    expect(MAP).toContain('event.key === "Enter"');
  });
});

describe("C8: Pull-to-Refresh", () => {
  it("wird nur während der Berührung an der Wurzel gesperrt", () => {
    expect(STYLES).toContain("html.ptr-off");
    expect(STYLES).toContain("overscroll-behavior-y: none");
    expect(STYLES).toContain(".no-ptr");
    expect(STYLES).toContain("overscroll-behavior: contain");
    expect(STYLES).toContain(".leaflet-container");
    expect(SLIDER).toContain("usePtrOff");
    expect(MAP).toContain("usePtrOff");
    expect(PTR_OFF_CLASS).toBe("ptr-off");
  });

  it("setzt und räumt die Wurzelklasse", () => {
    setPtrOff(true);
    expect(document.documentElement.classList.contains("ptr-off")).toBe(true);
    setPtrOff(false);
    expect(document.documentElement.classList.contains("ptr-off")).toBe(false);
  });
});

describe("C8: Querformat", () => {
  it("die Layout-Haken stehen in CSS und Markup", () => {
    const landscape = STYLES.indexOf(
      "@media (orientation: landscape) and (max-height: 620px)",
    );
    expect(landscape).toBeGreaterThanOrEqual(0);
    const rule = STYLES.slice(
      landscape,
      STYLES.indexOf("\n}\n", STYLES.indexOf(".daystrip-cells", landscape)),
    );
    for (const hook of [".app-header", ".app-tagline", ".app-main", ".daystrip-cells"]) {
      expect(rule, `${hook} fehlt im Querformat-Block`).toContain(hook);
    }
    for (const hook of ["app-header", "app-tagline", "app-main"]) {
      expect(DASHBOARD, `${hook} fehlt in Dashboard.tsx`).toContain(hook);
    }
  });

  it("die Installation darf drehen (Hoch- und Querformat)", () => {
    expect(MANIFEST.display).toBe("standalone");
    expect(MANIFEST.orientation).toBe("any");
  });
});

describe("C8: Installationshinweis", () => {
  const base = {
    standalone: false,
    hasPrompt: false,
    manualPossible: false,
    snoozedUntil: 0,
    now: 1_000,
  };

  it("zeigt den nativen Knopf nur mit beforeinstallprompt", () => {
    expect(installHintKind({ ...base, hasPrompt: true })).toBe("native");
  });

  it("fällt auf den iOS-Handgriff zurück, wo es kein Ereignis gibt", () => {
    expect(installHintKind({ ...base, manualPossible: true })).toBe("manual");
  });

  it("schweigt in der installierten App, nach „Nicht jetzt“ und ohne Weg", () => {
    expect(installHintKind({ ...base, standalone: true })).toBe("hidden");
    expect(
      installHintKind({ ...base, hasPrompt: true, snoozedUntil: 2_000 }),
    ).toBe("hidden");
    expect(installHintKind(base)).toBe("hidden");
    expect(installHintText("hidden")).toBeNull();
  });

  it("nennt im iOS-Text den Weg über das Teilen-Menü", () => {
    const manual = installHintText("manual");
    expect(manual?.action).toBeNull();
    expect(manual?.body).toContain("Zum Home-Bildschirm");
  });

  it("merkt sich das Verschieben 30 Tage", () => {
    expect(snoozeUntil(0) - 0).toBe(30 * 24 * 60 * 60 * 1000);
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    writeSnooze(storage, 4_200);
    expect(store.get(INSTALL_SNOOZE_KEY)).toBe("4200");
    expect(readSnooze(storage)).toBe(4_200);
    expect(readSnooze(null)).toBe(0);
    store.set(INSTALL_SNOOZE_KEY, "kaputt");
    expect(readSnooze(storage)).toBe(0);
  });

  it("erkennt iOS-Safari und nicht Chrome/Firefox darauf", () => {
    expect(
      iosSafari(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(true);
    expect(
      iosSafari(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148",
      ),
    ).toBe(false);
    expect(
      iosSafari(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
      ),
    ).toBe(false);
  });
});

afterEach(() => {
  setPtrOff(false);
});
