// @vitest-environment happy-dom
// C5 + C8: Die Regeln aus styles.css, die die Bedienung tragen, sind hier
// festgenagelt — Kontrast (AA), Touch-Ziele (44 px), Pull-to-Refresh-Sperre,
// Querformat und Installationshinweis. Der Test liest die Quelle als Text:
// Er prüft die Zusagen, nicht die Optik.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DARK_CHART, LIGHT_CHART } from "./chartTheme";
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
// U1-Ratchet: alle Quelldateien einlesen. Wie `read` über einen variablen
// Pfad, damit Vite den Ausdruck nicht als Asset-URL umschreibt.
function dirOf(relativePath: string): string {
  return dirname(fileURLToPath(new URL(relativePath, import.meta.url)));
}
const SRC_ROOT = dirOf("styles.css");
const UI_FILE = `${SRC_ROOT}/components/ui.tsx`;
const DASHBOARD = read("Dashboard.tsx");
// U8: Die Kopfzeile (app-header/app-tagline) wohnt in components/AppHeader.
const APP_HEADER = read("components/AppHeader.tsx");
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

  // V1 (GUI-TEXT-BEFUND): Diagramme kennen beide Themen. Vorher waren 64 feste
  // Hexwerte verdrahtet — Achsentext #94a3b8 auf weißer Karte ≈ 2,4:1.
  it.each([
    ["dunkel", DARK_CHART, "#0f172a"],
    ["hell", LIGHT_CHART, "#ffffff"],
  ] as const)("Diagrammpalette %s: Texttöne halten 4,5:1 auf der Diagrammfläche", (_name, palette, surface) => {
    // Text im Diagramm: AA verlangt 4,5:1.
    for (const role of ["text", "textStrong", "accent", "positive", "negative", "warn"] as const) {
      expect(
        contrast(palette[role], surface),
        `${role} (${palette[role]}) auf ${surface} ist zu blass`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // Achsen-Ticks sind Striche, kein Text: 3:1 (WCAG 1.4.11) reichen.
    expect(
      contrast(palette.tick, surface),
      `tick (${palette.tick}) auf ${surface} hebt sich zu wenig ab`,
    ).toBeGreaterThanOrEqual(3);
  });

  it("keine Diagramm-Datei trägt mehr feste Hexfarben", () => {
    const chartFiles = [
      "components/LineChart.tsx",
      "components/LabCharts.tsx",
      "components/StationMap.tsx",
      "views/Labor.tsx",
      "views/Stationen.tsx",
    ];
    for (const file of chartFiles) {
      const hexes = read(file).match(/#[0-9a-fA-F]{6}\b/g) ?? [];
      expect(hexes, `${file} verdrahtet noch ${hexes.join(", ")}`).toEqual([]);
    }
  });

  it("beide Diagrammpaletten bedienen dieselben Rollen", () => {
    expect(Object.keys(LIGHT_CHART).sort()).toEqual(Object.keys(DARK_CHART).sort());
  });

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

// ---------------------------------------------------------------------------
// U1 — Typografie: keine px-fixierte Kleinschrift.
//
// UI-NEUENTWURF §14: „System-Schriftgröße wird respektiert (keine
// px-Fixierung der Fließtexte)“. Gemessen waren ~430 Stellen auf 8–11 px —
// Lesegröße unter der Wahrnehmungsschwelle und am Browser-Einstellung vorbei.
// Das Ratchet verbietet jede px-fixierte Textgröße unter 12 px; Ausnahmen in
// rem (z. B. der Tagesstreifen, dessen Zellen schmal sind und dessen Werte
// zusätzlich im `title`/`aria-label` stehen) bleiben möglich, weil sie mit
// der Systemschrift skalieren.
// ---------------------------------------------------------------------------
describe("U1: Typografie-Ratchet", () => {
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
      else if (/\.tsx?$/.test(entry) && !entry.includes(".test."))
        out.push(path);
    }
    return out;
  }

  const files = sourceFiles(SRC_ROOT);

  it("keine Textgröße unter 12 px als px-Fixierung", () => {
    const offenses: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        if (Number(match[1]) < 12) {
          offenses.push(`${file}: text-[${match[1]}px]`);
        }
      }
    }
    expect(
      offenses,
      `px-fixierte Kleinschrift gefunden:\n${offenses.join("\n")}`,
    ).toEqual([]);
  });

  it("die 8/9-px-Klassen des Erstbefunds sind ausdrücklich verboten", () => {
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      expect(content, `${file} nutzt text-[8px]`).not.toContain("text-[8px]");
      expect(content, `${file} nutzt text-[9px]`).not.toContain("text-[9px]");
    }
  });
});

// ---------------------------------------------------------------------------
// U6 — Designsystem: Kartenradien kommen aus **einer** Stelle.
//
// Vorher stand an ~90 Panels je ein eigenes rounded-xl/-2xl; die Radien
// unterschieden sich von Panel zu Panel („weiß nicht wieso“). Jetzt liefert
// components/ui.tsx die Rampe (panel/dialog/radius), und außerhalb dieser
// Datei sind große Kartenradien verboten — kleine (rounded-lg/-md/-full)
// bleiben erlaubt, sie sind keine Kartenfrage.
// ---------------------------------------------------------------------------
describe("U6: Radius-Rampe", () => {
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = `${dir}/${entry}`;
      if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
      else if (/\.tsx?$/.test(entry) && !entry.includes(".test."))
        out.push(path);
    }
    return out;
  }

  it("rounded-xl/-2xl steht nur in components/ui.tsx", () => {
    const files = sourceFiles(SRC_ROOT).filter((f) => f !== UI_FILE);
    const banned = /rounded-(xl|2xl)\b/;
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (banned.test(content)) offenders.push(file);
    }
    expect(
      offenders,
      `Kartenradius außerhalb von components/ui.tsx gefunden:\n${offenders.join("\n")}`,
    ).toEqual([]);
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
    for (const hook of ["app-header", "app-tagline"]) {
      expect(APP_HEADER, `${hook} fehlt in AppHeader.tsx`).toContain(hook);
    }
    expect(DASHBOARD, "app-main fehlt in Dashboard.tsx").toContain("app-main");
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
