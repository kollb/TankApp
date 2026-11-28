import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./mockApi";

async function navigateTo(page: Page, label: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) {
    const mobile = page.getByRole("navigation", { name: "Mobile Navigation" });
    if (label === "Übersicht" || label === "Stationen") {
      await mobile.getByRole("button", { name: label, exact: true }).click();
      return;
    }
    await mobile.getByRole("button", { name: "Menü", exact: true }).click();
    await page.getByRole("dialog", { name: "Bereiche" })
      .getByRole("button", { name: label, exact: true }).click();
    return;
  }
  await page.getByRole("complementary", { name: "Hauptnavigation" })
    .getByRole("button", { name: label, exact: true }).click();
}

test("current routes retain aliases, browser history, and active navigation", async ({ page }) => {
  await mockApi(page);
  await page.goto("/?tab=ich");
  await expect(page.getByRole("heading", { name: "Einstellungen", exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("einstellungen");

  await navigateTo(page, "Stationen");
  await expect(page.getByRole("heading", { level: 1, name: "Stationen", exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("stationen");
  const stationNav = (page.viewportSize()?.width ?? 1440) < 1024
    ? page.getByRole("navigation", { name: "Mobile Navigation" }).getByRole("button", { name: "Stationen", exact: true })
    : page.getByRole("complementary", { name: "Hauptnavigation" }).getByRole("button", { name: "Stationen", exact: true });
  await expect(stationNav).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Einstellungen", exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("einstellungen");
  const settingsNav = (page.viewportSize()?.width ?? 1440) < 1024
    ? page.getByRole("navigation", { name: "Mobile Navigation" }).getByRole("button", { name: "Menü", exact: true })
    : page.getByRole("complementary", { name: "Hauptnavigation" }).getByRole("button", { name: "Einstellungen", exact: true });
  await expect(settingsNav).toHaveAttribute("aria-current", "page");
});

test("the overview renders current prices and never releases a blocked action", async ({ page }) => {
  await mockApi(page, { blocked: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Übersicht", exact: true })).toBeVisible();
  await expect(page.locator(".decision-card h2")).toHaveText("Preisvergleich");
  await expect(page.locator(".decision-metric")).toHaveText("1,699 €/L");
  await expect(page.getByRole("status")).toContainText("Kalibrierungsfreigabe steht aus.");
  await expect(page.getByText(/Erwarteter Vorteil/)).toHaveCount(0);
  await expect(page.locator(".price-curve[role='img']")).toBeVisible();
});

test("activating a profile also updates the selected fuel for station requests", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/?tab=einstellungen");
  await page.getByRole("tab", { name: "Profile", exact: true }).click();
  await page.getByRole("combobox", { name: "Aktives Profil" }).selectOption("diesel-car");

  await expect(page.getByRole("combobox", { name: "Kraftstoff" }).first()).toHaveValue("diesel");
  await expect.poll(() => api.activeProfileId).toBe("diesel-car");
  await expect.poll(() => api.requests.some((request) => request.includes("stations?fuel=diesel"))).toBe(true);
  await expect(page.getByRole("status")).toContainText("Gespeichert.");

  await page.getByRole("combobox", { name: "Stadt" }).selectOption("Frankfurt");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tankapp.v2.city"))).toBe('"Frankfurt"');
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tankapp.v2.fuel"))).toBe('"diesel"');
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Stadt" })).toHaveValue("Frankfurt");
  await expect(page.getByRole("combobox", { name: "Kraftstoff" }).first()).toHaveValue("diesel");
  await page.getByRole("tab", { name: "Profile", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Aktives Profil" })).toHaveValue("diesel-car");
});

test("the lab renders the server reliability-bin contract", async ({ page }) => {
  await mockApi(page);
  await page.goto("/?tab=labor");
  await expect(page.getByRole("heading", { name: "Empirische Güte" })).toBeVisible();
  await expect(page.locator(".bin-chart > div").first()).toHaveAttribute(
    "title",
    "0,0–0,2: Prognose 0,1, gemessen 0,5, n=2",
  );
  await expect(page.getByText("Keine Kalibrierungs-Bins verfügbar.")).toHaveCount(0);
});

test("mobile navigation is labelled, keyboard-dismissible, and has no page overflow", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) >= 1024, "Responsive navigation is only shown below 1024 px.");
  await mockApi(page);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Mobile Navigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button")).toHaveText(["Übersicht", "Stationen", "Menü"]);

  const menu = nav.getByRole("button", { name: "Menü", exact: true });
  await menu.click();
  const sheet = page.getByRole("dialog", { name: "Bereiche" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(menu).toBeFocused();
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    offenders: Array.from(document.body.querySelectorAll("*"))
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className : "",
        text: (element.textContent ?? "").trim().replace(/\\s+/g, " ").slice(0, 60),
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
        overflowX: getComputedStyle(element).overflowX,
      }))
      .filter((element) => element.right > window.innerWidth + 1 && element.left >= 0)
      .slice(0, 12),
  }));
  expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
});

test("every current page fits the narrow mobile viewport", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) >= 1024, "Responsive layouts are only shown below 1024 px.");
  await mockApi(page);
  const views = [
    { tab: "overview", title: "Übersicht", ready: ".decision-card" },
    { tab: "stationen", title: "Stationen", ready: ".station-list-card" },
    { tab: "labor", title: "Labor", ready: ".feature-stack" },
    { tab: "system", title: "System", ready: ".feature-stack" },
    { tab: "einstellungen", title: "Einstellungen", ready: ".segmented" },
    { tab: "glossar", title: "Glossar", ready: ".table-scroll" },
  ];

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 720 : 844 });
    for (const view of views) {
      await page.goto(`/?tab=${view.tab}`);
      await expect(page.locator("h1.page-heading")).toHaveText(view.title);
      await expect(page.locator(view.ready).first()).toBeVisible();
      const overflow = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        layout: [".page-content", ".feature-stack", ".feature-grid", ".feature-grid > .panel", ".metric-grid"]
          .map((selector) => {
            const element = document.querySelector(selector);
            if (!element) return { selector, missing: true };
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return { selector, left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), minWidth: style.minWidth, gridColumns: style.gridTemplateColumns };
          }),
        offenders: Array.from(document.body.querySelectorAll("*"))
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === "string" ? element.className : "",
            text: (element.textContent ?? "").trim().replace(/\\s+/g, " ").slice(0, 60),
            left: Math.round(element.getBoundingClientRect().left),
            right: Math.round(element.getBoundingClientRect().right),
            overflowX: getComputedStyle(element).overflowX,
          }))
          .filter((element) => element.right > window.innerWidth + 1 && element.left >= 0)
          .slice(0, 8),
      }));
      expect(overflow.document, `${view.tab} overflows at ${width}px: ${JSON.stringify(overflow)}`)
        .toBeLessThanOrEqual(overflow.viewport);
    }
  }
});

test("refresh revalidates the cached overview with its ETag", async ({ page }) => {
  await mockApi(page);
  const responses: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/overview")) responses.push(response.status());
  });
  await page.goto("/");
  await expect(page.locator(".decision-card h2")).toHaveText("Jetzt tanken");
  await expect.poll(() => responses).toContain(200);
  await page.getByRole("button", { name: "Daten aktualisieren" }).click();
  await expect.poll(() => responses).toContain(304);
  await expect(page.locator(".decision-card h2")).toHaveText("Jetzt tanken");
});
