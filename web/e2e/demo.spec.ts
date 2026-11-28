import { expect, test, type Response } from "@playwright/test";

// Current-shell integration tests against the real demo stack. There is no
// page.route here: browser requests go to ops/quality/demo_server.py and its
// generated data, so these specs cover the server-to-GUI contract.

test("overview renders the live decision and an honest unscoped day state", async ({ page }) => {
  const overviewResponse = page.waitForResponse((response) =>
    response.url().includes("/api/v1/overview") && response.status() === 200,
  );
  await page.goto("/");
  await expect(page.locator("h1.page-heading")).toHaveText("Übersicht");
  await expect(page.locator(".decision-card h2")).toBeVisible();
  const response = await overviewResponse;
  const payload = await response.json();
  expect(response.status()).toBe(200);
  expect(payload.error_code).toBeNull();

  // The current shell has no selected station while the city is unscoped, so
  // the server deliberately returns no day series. Keep that honest state in
  // the UI instead of accepting a fabricated or stale chart.
  expect(payload.day).toBeNull();
  await expect(page.locator(".day-curve-card .empty-state")).toHaveText("Noch kein Tagesverlauf vorhanden.");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("stations shows names from the real demo API", async ({ page }) => {
  const stationsResponse = page.waitForResponse((response) =>
    response.url().includes("/api/v1/stations") && response.status() === 200,
  );
  await page.goto("/?tab=stationen");
  await expect(page.locator("h1.page-heading")).toHaveText("Stationen");
  const response = await stationsResponse;
  const payload = await response.json();
  const name = payload.stations?.find((station: { name?: unknown }) => typeof station.name === "string")?.name;
  expect(name, "Demo-API liefert keine Stationen.").toBeTruthy();
  await expect(page.locator(".station-row").first()).toBeVisible();
  await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("refresh revalidates the real overview ETag with a 304", async ({ page }) => {
  const responses: Response[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/overview")) responses.push(response);
  });
  await page.goto("/");
  await expect(page.locator(".decision-card")).toBeVisible();
  await expect.poll(() => responses.some((response) => response.status() === 200)).toBe(true);
  const initial = responses.find((response) => response.status() === 200)!;
  const etag = initial.headers()["etag"];
  expect(etag, "Demo-Server liefert kein ETag.").toBeTruthy();

  await page.getByRole("button", { name: "Daten aktualisieren" }).click();
  await expect.poll(() => responses.some((response) => response.status() === 304)).toBe(true);
  const revalidated = responses.find((response) => response.status() === 304)!;
  expect(revalidated.request().headers()["if-none-match"]).toBe(etag);
  await expect(page.locator(".decision-card")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
