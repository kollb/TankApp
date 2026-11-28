import { expect, type Page } from "@playwright/test";

// Die Studio-Bereiche (Einstellungen, Labor, System, Glossar) liegen mobil
// einen Tipper tiefer — hinter dem „Mehr“-Blatt der Bottom-Leiste.
// Desktop stehen sie direkt in der Seitenleiste. Der Helfer führt zu
// einem Bereich, unabhängig vom Raster; damit beweisen die Specs weiter
// dasselbe (die Ansicht wechselt), ohne zwei Navigationspfade zu
// hartkodieren.
//
// Die Rastergrenze ist `lg` bei 1024 px (AppNav: `hidden … lg:flex` /
// `lg:hidden`) — geprüft wird an der Viewport-Breite, nicht am
// Projekt-Namen, weil die Demosuite zusätzlich ein 320-px-„narrow“-
// Projekt führt, das dasselbe schmale Raster prüft.
const STUDIO_AREAS = ["Labor", "System", "Einstellungen", "Glossar"] as const;
const LG_BREAKPOINT = 1024;

/** Klickt den Bereich in der Navigation — öffnet vorab das Studio-Blatt. */
export async function clickArea(page: Page, label: string): Promise<void> {
  const viewport = page.viewportSize();
  const narrow = (viewport?.width ?? 1440) < LG_BREAKPOINT;
  if (narrow && (STUDIO_AREAS as readonly string[]).includes(label)) {
    const more = page.getByRole("button", { name: "Mehr", exact: true });
    await more.click();
    const sheet = page.getByRole("dialog", { name: "Studio" });
    await expect(
      sheet,
      `Das Studio-Blatt öffnet sich nicht (Bereich „${label}“).`,
    ).toBeVisible();
    // Der accessible Name einer Blatt-Zeile ist „Name + Note“ — deshalb
    // Vortrags-Match und ausschließlich im Dialog; Seitentreffer außerhalb
    // der Studio-Navigation können den Bereich nicht versehentlich wählen.
    await sheet
      .getByRole("button", { name: new RegExp(`^${label}(?:\\s|$)`) })
      .click();
    return;
  }
  await page.getByRole("button", { name: label, exact: true }).click();
}

/**
 * Öffnet „Einstellungen → Belege und Bilanz“ (0.78.0).
 *
 * Seit der UI-Konsolidierung ist die Buchhaltung kein eigener Tab mehr,
 * sondern ein eingeklapptes `<details>` am Wirkungsort. Der Bereich heißt
 * weiter „Tanken erfassen“; die Legacy-URL `?tab=ich` führt auf dieselbe
 * Seite. Der Beleg-Poll startet erst mit dem geöffneten Blatt.
 */
export async function openReceipts(page: Page): Promise<void> {
  const summary = page.getByText("Belege und Bilanz", { exact: true });
  await expect(
    summary,
    "„Belege und Bilanz“ steht nicht in den Einstellungen.",
  ).toBeVisible();
  const region = page.getByRole("region", { name: "Tanken erfassen" });
  if (!(await region.isVisible().catch(() => false))) {
    await summary.click();
  }
  await expect(
    region,
    "Das Belegformular („Tanken erfassen“) öffnet sich nicht.",
  ).toBeVisible();
  return;
}
