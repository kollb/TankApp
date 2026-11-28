import { expect, type Page } from "@playwright/test";

const STUDIO_AREAS = ["Labor", "System", "Einstellungen", "Glossar"] as const;
const MOBILE_BREAKPOINT = 1024;

/** Navigate using the current desktop shell or its mobile areas sheet. */
export async function clickArea(page: Page, label: string): Promise<void> {
  const narrow = (page.viewportSize()?.width ?? 1440) < MOBILE_BREAKPOINT;
  if (narrow && (STUDIO_AREAS as readonly string[]).includes(label)) {
    const menu = page.getByRole("navigation", { name: "Mobile Navigation" })
      .getByRole("button", { name: "Menü", exact: true });
    await menu.click();
    const sheet = page.getByRole("dialog", { name: "Bereiche" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: label, exact: true }).click();
    return;
  }
  await page.getByRole("complementary", { name: "Hauptnavigation" })
    .getByRole("button", { name: label, exact: true }).click();
}

/** Open the current settings subtab that contains receipt entry. */
export async function openReceipts(page: Page): Promise<void> {
  const tab = page.getByRole("tab", { name: "Belege & Bilanz", exact: true });
  await expect(tab, "Die Belege-Unterseite fehlt in den Einstellungen.").toBeVisible();
  await tab.click();
  await expect(page.getByRole("heading", { name: "Beleg erfassen", exact: true })).toBeVisible();
}
