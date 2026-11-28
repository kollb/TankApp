import { expect, test } from "@playwright/test";

// Browser-only responsive audit of the current application shell. Run against
// the real demo server so populated stations, lab and settings views are all
// included; the mocked shell test covers the same routes independently.
const VIEWS = [
  { tab: "overview", title: "Übersicht", ready: ".decision-card" },
  { tab: "stationen", title: "Stationen", ready: ".station-row" },
  { tab: "labor", title: "Labor", ready: "h2" },
  { tab: "system", title: "System", ready: "h2" },
  { tab: "einstellungen", title: "Einstellungen", ready: "h2" },
  { tab: "glossar", title: "Glossar", ready: ".table-scroll" },
] as const;

test.describe("mobile shell: current views fit the viewport", () => {
  test.beforeEach(async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) > 640, "Nur schmale Viewports werden hier geprüft.");
  });

  test("all routes and settings subtabs have no document-level horizontal overflow", async ({ page }) => {
    const width = page.viewportSize()?.width ?? 390;
    for (const view of VIEWS) {
      await page.goto(`/?tab=${view.tab}`);
      await expect(page.locator("h1.page-heading")).toHaveText(view.title);
      await expect(page.locator(view.ready).first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${view.tab} overflows at ${width}px`).toBeLessThanOrEqual(1);
    }

    await page.goto("/?tab=einstellungen");
    for (const label of ["Fahrzeug & Tank", "Profile", "Belege & Bilanz"]) {
      await page.getByRole("tab", { name: label, exact: true }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `Einstellungen → ${label} overflows at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test("the mobile areas sheet closes on Escape and returns focus", async ({ page }) => {
    await page.goto("/");
    const navigation = page.getByRole("navigation", { name: "Mobile Navigation" });
    const menu = navigation.getByRole("button", { name: "Menü", exact: true });
    await menu.click();
    const sheet = page.getByRole("dialog", { name: "Bereiche" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(menu).toBeFocused();
  });
});
