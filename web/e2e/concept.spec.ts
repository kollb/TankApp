import { expect, test, type Page } from "@playwright/test";

async function controls(page: Page, mobile: boolean) {
  if (mobile)
    await page.getByRole("button", { name: "Konzept & Steuerung" }).click();
  return page.getByRole("main", { name: "UX-Konzept und Szenariosteuerung" });
}
async function phone(page: Page, mobile: boolean) {
  if (mobile)
    await page.getByRole("button", { name: "Zur App", exact: true }).click();
  return page.getByRole("region", { name: "Interaktive Smartphone-Vorschau" });
}
test.beforeEach(async ({ page }) => {
  await page.goto("/?konzept=1");
  await expect(
    page.getByRole("link", { name: "Live-App öffnen" }),
  ).toBeVisible();
});
test("Guide: all verdicts, explanations, fallbacks, retry and concept tabs", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile";
  const mockup = page.getByRole("region", {
    name: "Interaktive Smartphone-Vorschau",
  });
  await expect(
    mockup.getByRole("heading", { name: "Jetzt tanken", exact: true }),
  ).toBeVisible();
  await mockup.getByRole("button", { name: "Warum?", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".concept-panel")).toHaveAttribute("inert", "");
  await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let panel = await controls(page, mobile);
  await panel
    .getByRole("button", { name: "Besser warten", exact: true })
    .click();
  await phone(page, mobile);
  await expect(
    mockup.getByRole("heading", { name: "Besser warten", exact: true }),
  ).toBeVisible();
  await mockup
    .getByRole("button", { name: "Erinnere mich um 19 Uhr", exact: true })
    .click();
  await expect(mockup.getByRole("status")).toContainText("Demo-Erinnerung");
  await mockup.getByRole("button", { name: "Rückgängig", exact: true }).click();
  panel = await controls(page, mobile);
  await panel
    .getByRole("button", { name: "Kein Zeitdruck", exact: true })
    .click();
  await phone(page, mobile);
  await expect(
    mockup.getByRole("heading", { name: "Tanken, wann’s passt", exact: true }),
  ).toBeVisible();
  panel = await controls(page, mobile);
  await panel.getByRole("button", { name: /Stufe 2/ }).click();
  await expect(
    panel.getByRole("button", { name: "Besser warten", exact: true }),
  ).toBeDisabled();
  await phone(page, mobile);
  await expect(
    mockup.getByText("Die Prognose macht gerade Pause", { exact: true }),
  ).toBeVisible();
  await expect(
    mockup.getByRole("heading", { name: "Günstigste Tankstelle gerade" }),
  ).toBeVisible();
  panel = await controls(page, mobile);
  await panel.getByRole("button", { name: /Stufe 3/ }).click();
  await phone(page, mobile);
  await expect(
    mockup.getByRole("heading", { name: "Zuletzt am günstigsten" }),
  ).toBeVisible();
  await mockup.getByRole("button", { name: "Erneut versuchen" }).click();
  await expect(
    mockup.getByRole("button", { name: "Verbinde …" }),
  ).toBeDisabled();
  await expect(
    mockup.getByRole("heading", { name: "Tanken, wann’s passt" }),
  ).toBeVisible();
  panel = await controls(page, mobile);
  await panel
    .getByRole("switch", { name: "Bereiche im Mockup nummerieren" })
    .click();
  await expect(panel.getByRole("switch")).toBeChecked();
  for (const name of ["Texte", "Komponenten", "Fallback-Logik", "Aufbau"]) {
    await panel.getByRole("tab", { name, exact: true }).click();
    await expect(panel.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  await expect(
    panel.getByRole("link", { name: /^Live-Labor/ }),
  ).toHaveAttribute("href", "/?tab=labor");
});
test("Labor: chart, profile persistence, real undo, accordion and offline switches", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile";
  const mockup = page.getByRole("region", {
    name: "Interaktive Smartphone-Vorschau",
  });
  await mockup.getByRole("button", { name: "Labor", exact: true }).click();
  await expect(
    mockup.getByRole("heading", { name: "Prognose mit Spielraum" }),
  ).toBeVisible();
  await mockup.getByRole("button", { name: /^19 Uhr:/ }).click();
  const slider = mockup.getByRole("slider", { name: /Tankmenge/ });
  await slider.fill("60");
  await expect(mockup.getByText("4,80 €", { exact: true })).toBeVisible();
  await mockup.getByRole("button", { name: "Nie", exact: true }).click();
  await expect(mockup.getByText("0,00 €", { exact: true })).toBeVisible();
  const experiment = mockup.getByRole("switch", {
    name: "Wochenprognose",
    exact: true,
  });
  await experiment.click();
  await expect(experiment).toBeChecked();
  await mockup.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(experiment).not.toBeChecked();
  await mockup.getByText("Für Technik-Fans", { exact: true }).click();
  await expect(
    mockup.getByText("Gradient Boosting", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await mockup.getByRole("button", { name: "Labor", exact: true }).click();
  await expect(slider).toHaveValue("60");
  await expect(
    mockup.getByRole("button", { name: "Nie", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const panel = await controls(page, mobile);
  await panel.getByRole("button", { name: /Stufe 3/ }).click();
  await phone(page, mobile);
  await expect(experiment).toBeDisabled();
});
test("Map, alarms, fuel, sorting and narrow layout remain interactive", async ({
  page,
}) => {
  const mockup = page.getByRole("region", {
    name: "Interaktive Smartphone-Vorschau",
  });
  await mockup.getByRole("radio", { name: "Diesel", exact: true }).click();
  await expect(
    mockup.getByRole("radio", { name: "Diesel", exact: true }),
  ).toBeChecked();
  await mockup.getByRole("radio", { name: "Nähe", exact: true }).click();
  await expect(mockup.getByRole("listitem").first()).toContainText("ARAL");
  await mockup.getByRole("button", { name: "Karte", exact: true }).click();
  await expect(
    mockup.getByRole("heading", { name: "Karte", exact: true }),
  ).toBeVisible();
  await mockup.getByRole("button", { name: /^Shell,/ }).click();
  await expect(
    mockup.getByRole("link", { name: "Route in Google Maps öffnen" }),
  ).toHaveAttribute("href", /Schlei/);
  await mockup.getByRole("button", { name: "Alarme", exact: true }).click();
  await mockup.getByRole("spinbutton").fill("1.659");
  await mockup.getByRole("button", { name: "Demo-Alarm speichern" }).click();
  await expect(
    mockup.getByRole("heading", { name: "Demo-Alarm aktiv" }),
  ).toBeVisible();
  await mockup.getByRole("button", { name: "Alarm löschen" }).click();
  await expect(mockup.getByText("Noch kein Demo-Alarm aktiv.")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Keyboard navigation and retry cancellation do not change a newer scenario", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile";
  const panel = await controls(page, mobile);
  const guide = panel.getByRole("radio", { name: "Guide", exact: true });
  await guide.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    panel.getByRole("radio", { name: "Labor", exact: true }),
  ).toBeChecked();
  await panel.getByRole("tab", { name: "Aufbau", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(
    panel.getByRole("tab", { name: "Fallback-Logik", exact: true }),
  ).toBeFocused();
  await expect(
    panel.getByRole("tab", { name: "Fallback-Logik", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("button", { name: /Stufe 3/ }).click();
  const mockup = await phone(page, mobile);
  await mockup.getByRole("button", { name: "Erneut versuchen" }).click();
  await controls(page, mobile);
  await panel.getByRole("button", { name: /Stufe 2/ }).click();
  await phone(page, mobile);
  // Longer than the simulated retry: a cancelled old request must not override Stufe 2.
  await expect(
    mockup.getByRole("heading", { name: "Typischer Verlauf", exact: true }),
  ).toBeVisible();
  await expect(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expect(
      mockup.getByRole("heading", { name: "Typischer Verlauf", exact: true }),
    ).toBeVisible();
  }).toPass({ timeout: 3000 });
});
