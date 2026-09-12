// F3: Microcopy-Ratchet zum Regelwerk in docs/MICROCOPY.md.
//
// Zwei Regeln lassen sich mechanisch prüfen, und genau die sind bisher immer
// wieder auseinandergelaufen:
//   1. Anführungszeichen in Nutzertexten sind `„…“` — paarig, in dieser
//      Reihenfolge, nie gemischt mit dem geraden `"` (das im Quelltext die
//      String- und JSX-Attribut-Syntax ist und deshalb nicht zählt).
//   2. Typografische Zeichen stehen als UTF-8 im Quelltext, nicht als
//      HTML-Entity — `&bdquo;`/`&quot;`/`&ldquo;` liest im Diff niemand.
//
// Der Test liest die Quelldateien als Text; er ersetzt kein Lektorat, hält
// aber die beiden Fehler auf, die ohne Prüfung zuverlässig zurückkommen.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Alles, was Nutzertexte enthält. Tests selbst bleiben außen vor. */
const FILES = [
  "Dashboard.tsx",
  "data.ts",
  "components/ApiExplorer.tsx",
  "components/HeatmapGrid.tsx",
  "components/LabCharts.tsx",
  "components/LineChart.tsx",
  "components/LoadError.tsx",
  "components/PrecisionSlider.tsx",
  "components/ui.tsx",
];

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("F3: Microcopy-Regelwerk (docs/MICROCOPY.md)", () => {
  it.each(FILES)("%s: Anführungszeichen sind paarig „…“", (relativePath) => {
    const source = read(relativePath);
    const open = (source.match(/„/g) ?? []).length;
    const close = (source.match(/“/g) ?? []).length;
    expect(
      close,
      `${relativePath}: ${open}× „ aber ${close}× “ — jedes Zitat schließt mit “.`,
    ).toBe(open);
  });

  it.each(FILES)("%s: kein verirrtes ” (englisches Schlusszeichen)", (relativePath) => {
    expect((read(relativePath).match(/”/g) ?? []).length).toBe(0);
  });

  it.each(FILES)("%s: keine HTML-Entities für Anführungszeichen", (relativePath) => {
    const source = read(relativePath);
    for (const entity of ["&bdquo;", "&ldquo;", "&rdquo;", "&quot;", "&#34;"]) {
      expect(
        source.includes(entity),
        `${relativePath}: ${entity} gefunden — typografische Zeichen direkt als UTF-8 schreiben.`,
      ).toBe(false);
    }
  });

  it("das Regelwerk selbst ist da und verlinkt", () => {
    const docs = readFileSync(
      fileURLToPath(new URL("../../docs/MICROCOPY.md", import.meta.url)),
      "utf8",
    );
    expect(docs).toMatch(/[Ee]hrlich, knapp, handlungsleitend/);
    const index = readFileSync(
      fileURLToPath(new URL("../../docs/README.md", import.meta.url)),
      "utf8",
    );
    expect(index).toContain("MICROCOPY.md");
  });
});
