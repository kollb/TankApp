// @vitest-environment happy-dom
// C5 + C8: Die Regeln aus styles.css, die die Bedienung tragen, sind hier
// festgenagelt — Kontrast (AA), Touch-Ziele (44 px), Pull-to-Refresh-Sperre,
// Querformat und Installationshinweis. Der Test liest die Quelle als Text:
// Er prüft die Zusagen, nicht die Optik.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DARK_CHART, LIGHT_CHART } from "./chartTheme";
import { CalibChart, DeltaBars } from "./components/LabCharts";
import { LineChart } from "./components/LineChart";
import { centPerLiter, euroPerLiter } from "./data";
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

/**
 * Alle Quelldateien unter src/ (ohne Tests). Wird von mehreren Ratchets
 * benutzt (U1, U6, M1, C5) — eine Fassung statt drei Kopien.
 */
function sourceFiles(dir: string, pattern = /\.tsx?$/): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path, pattern));
    else if (pattern.test(entry) && !entry.includes(".test.")) out.push(path);
  }
  return out;
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
      expect(
        value,
        `${name} wird unter html.light nicht angehoben`,
      ).toBeDefined();
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
  ] as const)(
    "Diagrammpalette %s: Texttöne halten 4,5:1 auf der Diagrammfläche",
    (_name, palette, surface) => {
      // Text im Diagramm: AA verlangt 4,5:1.
      for (const role of [
        "text",
        "textStrong",
        "accent",
        "positive",
        "negative",
        "warn",
      ] as const) {
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
    },
  );

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
    expect(Object.keys(LIGHT_CHART).sort()).toEqual(
      Object.keys(DARK_CHART).sort(),
    );
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
      expect(
        contrast(color, surface),
        `${color} auf ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
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

// ---------------------------------------------------------------------------
// M1 — Jede `grid`-Fläche nennt ihre Spalten auch für das schmale Raster.
//
// Tailwinds `grid` setzt nur `display: grid`. Ohne `grid-cols-*` legt der
// Browser eine **implizite** Spur an, und deren Größe ist `auto` — sie wächst
// auf den breitesten Eintrag, statt sich an die Karte zu binden. Für eine
// Liste mit langen Inhalten heißt das: `truncate`/`min-w-0` greifen nie, weil
// es formal nichts zu kürzen gibt, und die Zeile malt über die Karte hinaus.
//
// Genau so entstand der Pixel-9-Befund vom 18.09.2026 („Die Anzeige der 3
// Stationen auf Jetzt sind zu breit und ragen aus dem Bild“): Die Rangliste
// stand in `grid gap-1.5`, ein echter Stationsname („Aral Tankstelle
// Frankfurt am Main Hanauer Landstraße 128“) machte daraus 496 px in einer
// 330-px-Karte. Auffällig wird das nur mit echten Namen — der Demo-Stack
// heißt „Demo-Tank Nord“, deshalb blieb die Browser-Suite grün.
//
// Der Ratchet verlangt eine **unpräfigierte** Spaltenangabe: `sm:grid-cols-2`
// allein hilft dem Handy nicht, dort gilt weiter die implizite Spur.
// Ausgenommen ist nur, was seine Spalten in styles.css bekommt
// (`daystrip-cells`) oder erst ab einer Breite überhaupt `grid` wird
// (`sm:grid`).
// ---------------------------------------------------------------------------
describe("M1: Grid-Spalten im schmalen Raster", () => {
  /** Spalten kommen aus dem Stylesheet, nicht aus der Klassenliste. */
  const CSS_DRIVEN = ["daystrip-cells"];

  it("jede grid-Fläche hat eine Spaltenangabe ohne Breiten-Präfix", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) {
        const classes = match[1];
        const tokens = classes.split(/\s+/).filter(Boolean);
        // Nur das Display-Utility selbst: `sm:grid` schaltet erst ab 640 px
        // auf Grid und ist bis dahin gar keine Grid-Fläche.
        if (!tokens.includes("grid")) continue;
        if (CSS_DRIVEN.some((marker) => classes.includes(marker))) continue;
        if (tokens.some((token) => token.startsWith("grid-cols-"))) continue;
        const line = content.slice(0, match.index ?? 0).split("\n").length;
        offenders.push(
          `${file.slice(SRC_ROOT.length + 1)}:${line} — „${classes}“`,
        );
      }
    }
    expect(
      offenders,
      "grid ohne unpräfigierte Spaltenangabe (implizite auto-Spur wächst " +
        `auf den breitesten Eintrag und sprengt mobil die Karte):\n${offenders.join(
          "\n",
        )}`,
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
    for (const hook of ["button", '[role="button"]', "select", "input"]) {
      expect(rule, `${hook} fehlt im 44-px-Block`).toContain(hook);
    }
  });

  it("die Karten-Pins sind per Tastatur erreichbar", () => {
    expect(MAP).toContain("tabIndex={0}");
    expect(MAP).toContain('role="button"');
    expect(MAP).toContain('event.key === "Enter"');
  });

  // 0.55.0: Der Preis-Pin trug `iconSize: [60, 26]`, „Referenz“ braucht in
  // 12-px-Monospace aber 57,8 px plus Polsterung — die Schrift lief über die
  // Pille aufs Kartenbild. Eine feste Kachel kann den Text prinzipiell nicht
  // halten, sobald die Systemschrift größer steht; deshalb ist sie verboten.
  it("Karten-Pins bekommen keine feste Kachelgröße", () => {
    // Kommentare ausblenden: Der Begründungstext nennt die alten Maße.
    const code = MAP.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /(^|\s)\/\/.*$/gm,
      "",
    );
    const fixedSizes = [...code.matchAll(/icon(?:Size|Anchor):\s*\[/g)];
    expect(
      fixedSizes.length,
      "iconSize/iconAnchor zwingt den Pin auf feste Maße — der Text passt " +
        "dann nicht mehr hinein. Größe kommt aus dem Inhalt (width: max-content).",
    ).toBe(0);
    expect(STYLES).toContain(".custom-net-pin");
    expect(STYLES).toContain("width: max-content");
    // Zentriert wird per `translate` (eigene Eigenschaft): Leaflet schreibt
    // die Position selbst als `transform` ins style-Attribut und würde ein
    // `transform` aus dieser Datei überschreiben.
    expect(STYLES).toContain("translate: -50% -50%");
  });

  // Die 44-px-Regel in styles.css greift bei `a` nur über die Klasse
  // `tap-44` — ein nacktes `a` bliebe sonst überall auf Textzeilenhöhe, auch
  // dort, wo es wie ein Knopf aussieht. Gemeint sind Links, die als Fläche
  // gestaltet sind (runde Ecken **und** Hintergrund oder Rahmen); reine
  // Textlinks im Fließtext bleiben ausgenommen, für sie gilt die Regel nicht.
  it("knopfartige Links tragen tap-44", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_ROOT).filter((f) =>
      f.endsWith(".tsx"),
    )) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/<a\s[^>]*>/gs)) {
        const tag = match[0];
        const className = /className=(?:"([^"]*)"|\{`([^`]*)`\})/s.exec(tag);
        const classes = className?.[1] ?? className?.[2] ?? "";
        const looksLikeButton =
          /rounded-(lg|full|md|xl)/.test(classes) &&
          /(^|\s)(bg-|border)/.test(classes);
        if (!looksLikeButton || classes.includes("tap-44")) continue;
        const line = content.slice(0, match.index).split("\n").length;
        offenders.push(`${file.replace(SRC_ROOT, "src")}:${line}`);
      }
    }
    expect(
      offenders,
      "Diese Links sehen aus wie Knöpfe, bekommen ohne `tap-44` aber nicht " +
        `die 44-px-Trefferfläche:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// U1 — Formularelemente dürfen ihre Größenklasse behalten.
//
// Bis 0.54.0 stand in styles.css ein ungeschichtetes
// `button,select,input { font: inherit }`. Ungeschichtetes CSS gewinnt gegen
// jede `@layer` — also auch gegen Tailwinds `utilities` — und die Kurzform
// `font:` setzt `font-size` mit zurück. Damit war auf Knöpfen, Auswahlfeldern
// und Eingaben **jede** Größenklasse wirkungslos: am Demo-Stand 122
// Bedienelemente, die statt `text-xs`/`text-sm`/`text-[0.625rem]` die
// geerbten 16 px zeigten. Sichtbar war das unten in der Leiste, wo
// „Stationen“ mit 70 px in eine 64-px-Zelle sollte und als „Statio…“
// abgeschnitten wurde.
// ---------------------------------------------------------------------------
describe("U1: Größenklassen auf Bedienelementen", () => {
  // Kommentare zitieren die alten, falschen Regeln als Begründung — geprüft
  // wird deshalb ausschließlich der wirksame Teil der Datei.
  const CSS = STYLES.replace(/\/\*[\s\S]*?\*\//g, "");

  it("kein ungeschichtetes font-Kürzel auf button/select/input", () => {
    // Alles außerhalb eines `@layer … { }` ist ungeschichtet und gewinnt
    // gegen jede Utility. Blockgrenzen werden über die Klammertiefe
    // bestimmt — ein Regex verzählt sich an den verschachtelten Media-Blöcken.
    const layerSpans: Array<[number, number]> = [];
    for (const match of CSS.matchAll(/@layer[^{;]*\{/g)) {
      const start = match.index ?? 0;
      let depth = 0;
      for (let i = start + match[0].length - 1; i < CSS.length; i++) {
        if (CSS[i] === "{") depth++;
        else if (CSS[i] === "}") {
          depth--;
          if (depth === 0) {
            layerSpans.push([start, i]);
            break;
          }
        }
      }
    }
    const inLayer = (index: number) =>
      layerSpans.some(([from, to]) => index > from && index < to);

    const offenders = [...CSS.matchAll(/font:\s*[^;}]*inherit/g)]
      .filter((match) => !inLayer(match.index ?? 0))
      .map((match) => match[0]);
    expect(
      offenders,
      "`font: inherit` ungeschichtet überschreibt text-* auf jedem Knopf " +
        "(die Kurzform setzt font-size mit zurück). Gehört in @layer base " +
        "und sollte font-family statt font: setzen.",
    ).toEqual([]);
  });

  // iOS Safari zoomt beim Fokus in jedes Tippfeld unter 16 px. Bis 0.54.0
  // verdeckte das `font: inherit` diesen Fall (alles war 16 px); seit die
  // Größenklassen wirken, muss die Untergrenze ausdrücklich dastehen.
  it("Tippfelder halten auf Touch-Geräten 16 px (kein iOS-Zoom)", () => {
    const coarse = CSS.indexOf(
      "@media (pointer: coarse), (any-pointer: coarse)",
    );
    const rule = CSS.slice(coarse, CSS.indexOf("\n}\n", coarse));
    expect(rule).toContain("font-size: max(16px, 1rem)");
    expect(rule).toContain("textarea");
    // Knöpfe und Auswahlfelder lösen den Zoom nicht aus und bleiben kompakt:
    // Der Selektorkopf (ohne die :not()-Ausschlüsse) nennt sie nicht.
    const head = rule
      .slice(rule.indexOf("input:not("))
      .split("{")[0]
      .replace(/:not\([^)]*\)/g, "");
    for (const tag of ["button", "select", "a."]) {
      expect(head, `${tag} gehört nicht in die 16-px-Regel`).not.toContain(tag);
    }
  });

  it("die Erbregel steht in @layer base und lässt die Größe frei", () => {
    const base = CSS.slice(CSS.indexOf("@layer base {"));
    expect(base).toContain("font-family: inherit");
    // font-size fehlt bewusst: sie gehört der Utility-Klasse.
    const rule = base.slice(
      base.indexOf("button,"),
      base.indexOf("}", base.indexOf("font-family: inherit")),
    );
    expect(rule).not.toContain("font-size");
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

// ---------------------------------------------------------------------------
// U2b — Tagesstreifen: die Spaltenzahl hängt an der Breite, die eine Zelle
// zum Lesen braucht.
//
// Der Wert steht als „1,725“ in 0,625 rem Monospace (~30 px) plus Rand und
// Rahmen — rund 36 px je Zelle. Der Ratchet hält die drei Stufen fest, damit
// die Zahlenreihe nicht wieder in die Nachbarzelle läuft („Zahlenreihe ist
// schief“, Nutzer-Feedback 16.09.2026).
// ---------------------------------------------------------------------------
describe("U2b: Tagesstreifen-Spalten", () => {
  /**
   * Alle `.daystrip-cells`-Regeln mit ihrer einschließenden Media-Bedingung.
   * Die Bedingung wird rückwärts gesucht (Klammer-Zählung), damit auch
   * Regeln mitten in einem größeren `@media`-Block ihre Bedingung behalten.
   */
  function daystripRules(): Array<{ query: string; columns: number }> {
    const rules: Array<{ query: string; columns: number }> = [];
    for (const match of STYLES.matchAll(/\.daystrip-cells\s*\{([^}]*)\}/g)) {
      let depth = 0;
      let query = "";
      for (let i = (match.index ?? 0) - 1; i >= 0; i -= 1) {
        if (STYLES[i] === "}") depth += 1;
        else if (STYLES[i] === "{") {
          if (depth > 0) {
            depth -= 1;
            continue;
          }
          const before = STYLES.slice(Math.max(0, i - 200), i);
          const at = before.lastIndexOf("@media");
          query = at >= 0 ? before.slice(at) : "";
          break;
        }
      }
      rules.push({
        query: query.replace(/@media|[\s{]/g, ""),
        columns: Number(match[1].match(/repeat\((\d+)/)?.[1] ?? 0),
      });
    }
    return rules;
  }

  it("fünf Spalten als Grundraster, zehn ab 640 px, neunzehn ab 1280 px", () => {
    const rules = daystripRules();
    const byQuery = (needle: string) =>
      rules.find((rule) => rule.query.includes(needle));
    expect(rules.find((rule) => rule.query === "")?.columns).toBe(5);
    expect(byQuery("min-width:640px")?.columns).toBe(10);
    expect(byQuery("min-width:1280px")?.columns).toBe(19);
  });

  it("im Querformat zwei Reihen, eine Reihe erst ab 880 px Breite", () => {
    const landscape = daystripRules().filter((rule) =>
      rule.query.includes("orientation:landscape"),
    );
    expect(landscape).toHaveLength(2);
    expect(landscape[0].columns).toBe(10);
    expect(landscape[1].query).toContain("min-width:880px");
    expect(landscape[1].columns).toBe(19);
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
    for (const hook of [
      ".app-header",
      ".app-tagline",
      ".app-main",
      ".daystrip-cells",
    ]) {
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

// ---------------------------------------------------------------------------
// O40 — Die Textalternative eines Diagramms nennt Werte.
//
// Befund (docs/archiv/OPTIMIERUNGS-BEFUND-2026-09-18.md O40): Die Beschreibung entstand aus den
// Reihennamen („Liniendiagramm: Erwarteter Preis, Band.“), das `aria-label`
// war überall dasselbe Wort „Diagramm“. Ein Screenreader erfuhr, **welche**
// Reihen ein Diagramm zeigt, nicht wohin sie laufen — und in „Labor“ liegen
// vier Diagramme in einer Ansicht.
//
// Der Ratchet prüft echtes Markup: Jede gerenderte Diagramm-Instanz trägt
// eine Beschreibung mit mindestens einer de-DE-formatierten Zahl, und die
// Labels einer Ansicht sind verschieden.
// ---------------------------------------------------------------------------
describe("O40: Diagramme beschreiben ihre Werte", () => {
  /** Eine de-DE-Zahl mit Dezimalkomma oder Tausenderpunkt — nie „1.75“. */
  const GERMAN_NUMBER = /\d+(?:\.\d{3})*(?:,\d+)?/;

  function charts(html: string): { label: string; desc: string }[] {
    const out: { label: string; desc: string }[] = [];
    for (const svg of html.matchAll(/<svg[^>]*role="img"[\s\S]*?<\/svg>/g)) {
      const markup = svg[0];
      const label = markup.match(/aria-label="([^"]*)"/)?.[1] ?? "";
      const desc = markup.match(/<desc[^>]*>([\s\S]*?)<\/desc>/)?.[1] ?? "";
      out.push({ label, desc });
    }
    return out;
  }

  const priceSeries = [
    {
      name: "Erwarteter Preis",
      color: "#38bdf8",
      pts: [
        { x: 1, y: 1.789 },
        { x: 2, y: 1.742 },
        { x: 3, y: 1.711 },
      ],
    },
  ];

  it("das Liniendiagramm nennt Anfang, Ende und Richtung mit Zahlen", () => {
    const [chart] = charts(
      renderToStaticMarkup(
        React.createElement(LineChart, {
          series: priceSeries,
          yFmt: (v: number) => euroPerLiter(v),
        }),
      ),
    );
    expect(chart.desc).toMatch(GERMAN_NUMBER);
    expect(chart.desc).toContain("1,789 €/L");
    expect(chart.desc).toContain("1,711 €/L");
    expect(chart.desc).toContain("fällt");
    // Der alte Rückfall nannte nur die Reihe und sonst nichts.
    expect(chart.desc).not.toBe("Liniendiagramm: Erwarteter Preis.");
  });

  it("die Balken nennen Ausschlag und Namen statt der Farbregel", () => {
    const [chart] = charts(
      renderToStaticMarkup(
        React.createElement(DeltaBars, {
          values: [-2.4, 0.8],
          labels: ["Demo-Tank Nord", "Demo-Tank Ost"],
          fmt: (v: number) => centPerLiter(v),
        }),
      ),
    );
    expect(chart.desc).toMatch(GERMAN_NUMBER);
    expect(chart.desc).toContain("Demo-Tank Nord mit -2,4 ct/L");
    expect(chart.desc).not.toContain("grün = positiv");
  });

  it("die Kalibrierung nennt die Abweichung von der Diagonalen", () => {
    const [chart] = charts(
      renderToStaticMarkup(
        React.createElement(CalibChart, {
          points: [
            { p: 0.6, hit: 0.7, n: 40, cls: 0 },
            { p: 0.8, hit: 0.86, n: 25, cls: 1 },
          ],
        }),
      ),
    );
    expect(chart.desc).toMatch(GERMAN_NUMBER);
    expect(chart.desc).toContain("über der Diagonalen");
  });

  it("jede Diagramm-Instanz einer Ansicht hat ein eigenes Label", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        "div",
        null,
        React.createElement(LineChart, {
          series: priceSeries,
          ariaLabel: "Prognose-Fächer",
        }),
        React.createElement(LineChart, {
          series: priceSeries,
          ariaLabel: "Beobachtete Preise der gewählten Station",
        }),
        React.createElement(DeltaBars, {
          values: [1, -1],
          ariaLabel: "Preis-Abstand je Station",
        }),
      ),
    );
    const labels = charts(html).map((chart) => chart.label);
    expect(labels).toHaveLength(3);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain("Diagramm");
  });

  it("kein Diagramm-Baustein trägt das alte Sammel-Label", () => {
    for (const file of [
      "components/LineChart.tsx",
      "components/LabCharts.tsx",
    ]) {
      const content = read(file);
      expect(content, `${file} labelt noch pauschal`).not.toContain(
        'aria-label="Diagramm"',
      );
    }
  });
});

afterEach(() => {
  setPtrOff(false);
});
