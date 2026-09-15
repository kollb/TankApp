// C9: Formatierungs-Ratchet. Der Formatter-Satz in `data.ts` (`euro`,
// `euroPerLiter`, `centPerLiter`, `percentLabel`, `kilometersLabel`,
// `countLabel`, `hourRangeLabel`) ist die einzige erlaubte Art, Zahlen in
// der GUI zu schreiben — de-DE, also mit Komma. `toFixed` liefert einen Punkt („87.5 %“)
// und gehört nur dorthin, wo keine Anzeige entsteht: SVG-Koordinaten und die
// Preis-Eingabefelder (die normalisieren jede Eingabe mit `commaToDot`,
// Vorbelegung und Getipptes müssen gleich aussehen).
//
// Der Test zählt die Stellen je Datei. Wer eine neue `toFixed`-Anzeige baut,
// bekommt einen Fehler mit dem Hinweis auf den Formatter-Satz; bewusst
// erlaubt wird sie nur, indem die Zahl hier angehoben wird — dann steht die
// Begründung wenigstens im Diff.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Erlaubte `toFixed`-Stellen je Datei (Stand 0.15.0) — mit Grund. */
const ALLOWED: Record<string, { count: number; reason: string }> = {
  "Dashboard.tsx": {
    count: 1,
    reason:
      "Vorbelegung des Beleg-Preises (Ich → Belege): Punkt wie beim Tippen (commaToDot)",
  },
  "components/LabCharts.tsx": {
    count: 2,
    reason:
      "SVG-Pfad-Koordinaten (T13: die Prozent in <title> laufen über percentLabel)",
  },
  "components/LineChart.tsx": {
    count: 6,
    reason: "SVG-Pfad- und Band-Koordinaten",
  },
};

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** Dateien, die sichtbar formatieren und deshalb sauber sein müssen. */
const CLEAN = [
  "components/CellError.tsx",
  "components/JobCard.tsx",
  "data-resource.test.tsx",
  "components/DataAge.tsx",
  "components/DataReach.tsx",
  "components/HeatmapGrid.tsx",
  "components/LoadError.tsx",
  "components/PrecisionSlider.tsx",
  "components/ProfileManager.tsx",
  "components/ApiExplorer.tsx",
  "components/Skeleton.tsx",
  "components/StationMap.tsx",
  "components/Level1Sheet.tsx",
  "main.tsx",
  "now.ts",
  "strip.ts",
  "stations.ts",
  "week.ts",
  "views/Jetzt.tsx",
  "views/Stationen.tsx",
  "views/Woche.tsx",
  "views/Ich.tsx",
  "lab.ts",
  "views/Labor.tsx",
  "system.ts",
  "views/System.tsx",
];

function toFixedCount(relativePath: string): number {
  return (read(relativePath).match(/\.toFixed\(/g) ?? []).length;
}

/**
 * T4: `euro()` formatiert nur Euro. km/%/ct haben eigene Formatter
 * (`kilometersLabel` / `percentLabel` / `centPerLiter`). Die Builder in
 * `data.ts` selbst sind die Ausnahme.
 */
const EURO_MISUSE = [
  /\$\{euro\([^}]+\)\} km/,
  /\$\{euro\([^}]+\)\} %/,
  /\$\{euro\([^}]+\)\} ct/,
  /euro\([^)]+\)\} %/,
  /euro\([^)]+\)\} ct/,
];

const EURO_FILES = [
  ...CLEAN,
  "Dashboard.tsx",
  "components/LabCharts.tsx",
  "views/Settings.tsx",
  "views/Glossary.tsx",
];

describe("C9: Formatierungs-Konvention hält (keine neuen toFixed-Anzeigen)", () => {
  it.each(Object.entries(ALLOWED))(
    "%s bleibt bei den vereinbarten toFixed-Stellen",
    (relativePath, allowed) => {
      const found = toFixedCount(relativePath);
      expect(
        found,
        `${relativePath}: ${found} statt ${allowed.count} toFixed-Stellen ` +
          `(erlaubt: ${allowed.reason}). Neue Anzeige? Dann euro/percentLabel/` +
          `centPerLiter/countLabel aus data.ts nutzen — de-DE mit Komma.`,
      ).toBe(allowed.count);
    },
  );

  it.each(CLEAN)("%s formatiert ohne toFixed", (relativePath) => {
    expect(toFixedCount(relativePath), `${relativePath}: toFixed gefunden`).toBe(0);
  });
});

describe("T4: euro() nur für Euro, Prozent mit Leerzeichen", () => {
  it.each(EURO_FILES)("%s: euro() nicht für km, Prozent oder Cent", (relativePath) => {
    const source = read(relativePath);
    const hits = EURO_MISUSE.flatMap((pattern) => source.match(pattern) ?? []);
    expect(
      hits,
      `${relativePath}: ${hits.join(", ")} — km über kilometersLabel, % über percentLabel, ct über centPerLiter.`,
    ).toEqual([]);
  });

  it("CalibChart-Achse schreibt Prozent mit Leerzeichen", () => {
    const source = read("components/LabCharts.tsx");
    expect(source).not.toMatch(/Math\.round\(f \* 100\)%/);
    expect(source).toContain("percentLabel(f * 100)");
  });

  it("Tagebuch rechnet Cent über euroToCentPerLiter", () => {
    const source = read("lab.ts");
    expect(source).not.toMatch(/price_then - entry\.price_window\) \* 100/);
    expect(source).toContain("euroToCentPerLiter");
  });
});
