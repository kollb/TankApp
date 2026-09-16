// C9: Formatierungs-Ratchet. Der Formatter-Satz in `data.ts` (`euro`,
// `euroPerLiter`, `centPerLiter`, `percentLabel`, `countLabel`,
// `hourRangeLabel`) ist die einzige erlaubte Art, Zahlen in der GUI zu
// schreiben — de-DE, also mit Komma. `toFixed` liefert einen Punkt („87.5 %“)
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
  // U8: Die Vorbelegung ist mit dem Beleg-State in den OverviewContext
  // gewandert (state/overview.tsx) — die Ausnahme wandert mit.
  "state/overview.tsx": {
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

/** Dateien, die sichtbar formatieren und deshalb sauber sein müssen. */
const CLEAN = [
  "Dashboard.tsx",
  "components/AppHeader.tsx",
  "components/CellError.tsx",
  "components/JobCard.tsx",
  "data-resource.test.tsx",
  "components/DataAge.tsx",
  "components/DataReach.tsx",
  "components/HeatmapGrid.tsx",
  "components/LoadError.tsx",
  "components/Notices.tsx",
  "components/NoticesView.tsx",
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

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function toFixedCount(relativePath: string): number {
  return (read(relativePath).match(/\.toFixed\(/g) ?? []).length;
}

/**
 * GUI-TEXT-BEFUND T4: `euro()` formatiert **Geld** — Kilometer, Prozent und
 * Cent haben eigene Formatter (`kilometersLabel`, `percentLabel`,
 * `centPerLiter`). `${euro(km, 1)} km` sieht korrekt aus und ist es nicht:
 * Der Geldformatter rundet auf zwei Stellen, die Einheit hängt am Wort.
 *
 * Erlaubt sind die beiden Stellen in `data.ts`, an denen die Formatter selbst
 * stehen — jede weitere muss hier begründet werden.
 */
const EURO_WITH_UNIT = /euro\((?:[^()]|\([^()]*\))*\)\s*\}?\s*(?:km|ct\/L|ct(?!\/L)|%(?![-\w]))/g;
const EURO_ALLOWED: Record<string, number> = {
  "data.ts": 3, // centPerLiter, percentLabel und kilometersLabel — die Formatter selbst
};

/**
 * Prozent trägt ein Leerzeichen vor dem Zeichen (§3): `93 %`. Geklebte
 * Prozente in JSX-Text zählen; CSS (`style={{ width: … }}`) ist keine Anzeige.
 */
function gluedPercentCount(relativePath: string): number {
  const source = read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "")
    .replace(/style=\{\{[^}]*\}\}/g, "");
  let count = 0;
  for (const run of source.matchAll(/>([^<>]*)</g)) {
    count += (run[1].match(/[\w)}]%(?![\w/-])/g) ?? []).length;
  }
  return count;
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

  it.each(CLEAN)("%s nutzt euro() nur für Geld", (relativePath) => {
    const hits = read(relativePath).match(EURO_WITH_UNIT) ?? [];
    const allowed = EURO_ALLOWED[relativePath] ?? 0;
    expect(
      hits.length,
      `${relativePath}: ${hits.length} statt ${allowed} × „euro() + fremde Einheit“ ` +
        `(gefunden: ${hits.join(" · ") || "—"}). Kilometer → kilometersLabel, ` +
        `Prozent → percentLabel, Cent → centPerLiter.`,
    ).toBe(allowed);
  });

  it.each(CLEAN)("%s schreibt Prozent mit Leerzeichen", (relativePath) => {
    expect(
      gluedPercentCount(relativePath),
      `${relativePath}: Prozent ohne Leerzeichen — §3 verlangt „93 %“ (percentLabel).`,
    ).toBe(0);
  });
});
