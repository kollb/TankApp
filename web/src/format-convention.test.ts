// C9: Formatierungs-Ratchet. Der Formatter-Satz in `data.ts` (`euro`,
// `euroPerLiter`, `centPerLiter`, `percentLabel`, `countLabel`,
// `hourRangeLabel`) ist die einzige erlaubte Art, Zahlen in der GUI zu
// schreiben — de-DE, also mit Komma. `toFixed` liefert einen Punkt („87.5 %“)
// und gehört nur dorthin, wo keine Anzeige entsteht: SVG-Koordinaten und die
// beiden Preis-Eingabefelder (die normalisieren jede Eingabe mit `commaToDot`,
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
    count: 2,
    reason:
      "Vorbelegung der Preis-Eingabefelder: Punkt wie beim Tippen (commaToDot)",
  },
  "components/LabCharts.tsx": {
    count: 6,
    reason: "SVG-Pfad-Koordinaten + ganzzahlige Prozent in <title>",
  },
  "components/LineChart.tsx": {
    count: 6,
    reason: "SVG-Pfad- und Band-Koordinaten",
  },
};

/** Dateien, die sichtbar formatieren und deshalb sauber sein müssen. */
const CLEAN = [
  "components/HeatmapGrid.tsx",
  "components/LoadError.tsx",
  "components/PrecisionSlider.tsx",
  "components/ApiExplorer.tsx",
  "main.tsx",
];

function toFixedCount(relativePath: string): number {
  const file = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = readFileSync(file, "utf8");
  return (source.match(/\.toFixed\(/g) ?? []).length;
}

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
