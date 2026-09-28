import { expect, type Locator, type Page } from "@playwright/test";

// B4 (Befund UX/Mathe 19.09.2026, §1.3): Die Studio-Bereiche liegen mobil
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
const STUDIO_AREAS = ["Labor", "Ich", "System", "Glossar"] as const;
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
    // Der accessible Name einer Blatt-Zeile ist „Name + Note“ (die Note ist
    // Teil der Zeile, Befund §1.4.4) — deshalb Vortrags-Match, und
    // ausschließlich im Dialog: Auf „Jetzt“ existiert daneben z. B. der
    // Intent-Button „Ich warte“, den ein ungeschörter „Ich“-Match treffe
    // würde.
    await sheet
      .getByRole("button", { name: new RegExp(`^${label}(?:\\s|$)`) })
      .click();
    return;
  }
  await page.getByRole("button", { name: label, exact: true }).click();
}

/** Name der Gruppe, die System · Dunkel · Hell anbietet (Settings.tsx). */
export const THEME_GROUP = "Darstellung (System, dunkel oder hell)";

/**
 * „Ich → Einstellungen → Darstellung“ öffnen und die Knopfgruppe liefern.
 *
 * Nach einem Reload baut sich die Ansicht neu auf: Der erste Tipp auf die
 * Unterseiten-Steuerung kann dabei ins Leere gehen, weil die Ansicht noch
 * ihren Chunk lädt. Statt einer festen Pause wird so lange getippt, bis die
 * Gruppe wirklich sichtbar ist — dieselbe Zusage, nur robuster geprüft.
 */
export async function openThemeChoices(page: Page): Promise<Locator> {
  const tab = page.getByRole("tab", { name: "Einstellungen", exact: true });
  const group = page.getByRole("group", { name: THEME_GROUP });
  await expect(async () => {
    await tab.click();
    await expect(group).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20000 });
  return group;
}
