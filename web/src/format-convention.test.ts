import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ageLabel,
  centsPerLiter,
  countLabel,
  euroPerLiter,
  euros,
  kilometers,
} from "./utils/format";

const activeDisplayFiles = [
  "components/layout/AppShell.tsx",
  "components/layout/TopBar.tsx",
  "features/overview/OverviewPage.tsx",
  "features/stations/StationsPage.tsx",
  "features/stations/StationLeafletMap.tsx",
  "features/lab/LabPage.tsx",
  "features/settings/SettingsPage.tsx",
  "features/system/SystemPage.tsx",
  "features/glossary/GlossaryPage.tsx",
];

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("Aktuelle Formatter: de-DE, passende Einheit, ehrliche Leerwerte", () => {
  it("formatiert Preis, Geld, Cent, Strecke und Anzahl mit deutschem Zahlenbild", () => {
    expect(euroPerLiter(1.719)).toBe("1,719 €/L");
    expect(euros(1234.5)).toBe("1.234,50 €");
    expect(centsPerLiter(2.5)).toBe("2,5 ct/L");
    expect(kilometers(1234.5)).toBe("1.234,5 km");
    expect(countLabel(1234)).toBe("1.234");
  });

  it("erfindet für fehlende oder nicht endliche Werte keine Null", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(euroPerLiter(value)).toBe("—");
      expect(euros(value)).toBe("—");
      expect(centsPerLiter(value)).toBe("—");
      expect(kilometers(value)).toBe("—");
      expect(countLabel(value)).toBe("—");
    }
  });

  it("berechnet Alterslabels aus einem festen Zeitpunkt", () => {
    const now = Date.parse("2026-11-28T12:00:00Z");
    expect(ageLabel("2026-11-28T11:59:00Z", now)).toBe("vor 1 Minute");
    expect(ageLabel("not-a-date", now)).toBe("—");
  });
});

describe("Formatierungs-Ratchet für die aktive GUI", () => {
  it.each(activeDisplayFiles)("%s formatiert ohne toFixed-Anzeigen", (relativePath) => {
    expect(read(relativePath), `${relativePath}: toFixed gefunden`).not.toMatch(/\.toFixed\s*\(/);
  });

  it.each(activeDisplayFiles)("%s hängt fremde Einheiten nicht an den Geld-Formatter", (relativePath) => {
    const misuse = read(relativePath).match(/\beuros?\([^)]*\)\s*(?:km|ct\/?L|ct\b|%(?!\s))/g) ?? [];
    expect(misuse, `${relativePath}: ${misuse.join(" · ")}`).toEqual([]);
  });
});
