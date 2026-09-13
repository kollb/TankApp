import { test, expect } from "@playwright/test";

test("honest setup state and all three views", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Noch kein frischer Preis." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Werkstatt", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Nachvollziehen statt blind vertrauen.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Unkalibriert · keine Handlungsempfehlung"),
  ).toBeVisible();
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Einmal einrichten. Weiterlaufen lassen.",
    }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Das gemeinsame Polling-Set fehlt auf diesem Server.")
      .first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("city/fuel changes never mix prices, closures never win", async ({
  page,
}) => {
  // Isolated request fixtures only; no test data is ever written to the running app or InfluxDB.
  await page.route("**/api/v1/stations?*", async (route) => {
    const fuel = new URL(route.request().url()).searchParams.get("fuel")!;
    const record = (
      id: string,
      city: string,
      name: string,
      value: number | null,
      status = "open",
    ) => ({
      station_id: id,
      city,
      name,
      brand: "Test",
      fuel,
      price: value,
      last_price: value,
      status,
      fresh: true,
      age_minutes: 2,
      observed_at: new Date().toISOString(),
      maps_url: null,
    });
    const rows =
      fuel === "e10"
        ? [
            record("a", "Frankfurt", "F-Station", 1.709),
            record("closed", "Frankfurt", "Closed-Station", null, "closed"),
            record("b", "Gütersloh", "G-Station", 1.689),
          ]
        : [
            record("a", "Frankfurt", "F-Station", null),
            record("b", "Gütersloh", "G-Station", null),
          ];
    await route.fulfill({
      json: {
        generated_at: new Date().toISOString(),
        cities: ["Frankfurt", "Gütersloh"],
        fuel,
        stations: rows,
        connection_error: null,
        fresh_prices: 2,
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "F-Station", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Geschlossen", { exact: true })).toBeVisible();
  await page.getByLabel("Stadt", { exact: true }).selectOption("Gütersloh");
  await expect(
    page.getByRole("heading", { name: "G-Station", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("F-Station", { exact: true })).toHaveCount(0);
  // C4: Die Tankmenge ist ein Default — der Eingabeort ist jetzt der
  // Einstellungen-Tab; der Alltag zeigt den Wert read-only.
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
  await page.locator("#liters").fill("55");
  await page.getByRole("button", { name: "Alltag", exact: true }).click();
  await expect(page.getByText("Füllung mit 55 Litern")).toBeVisible();
  await page.getByRole("button", { name: "Diesel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Noch kein frischer Preis." }),
  ).toBeVisible();
  await expect(page.getByText("1,689", { exact: false })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Stadt", { exact: true })).toHaveValue(
    "Gütersloh",
  );
  await expect(page.getByText("Füllung mit 55 Litern")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Noch kein frischer Preis." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Diesel", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("C4: Einstellungen-Tab centralisiert Defaults, zeigt Schwellen read-only", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Alle Defaults an einer Stelle." }),
  ).toBeVisible();

  // C4: Alle Defaults an einem Ort — die Eingabeorte, die im Alltagstabs
  // verteilt lagen (Tankmenge, Verbrauch, Zeitwert, Tempo, Fahrtcharakter)
  // plus Stadt, Kraftstoff und Tankgröße.
  await expect(page.locator("#liters")).toBeVisible();
  await expect(page.locator("#consumption")).toBeVisible();
  await expect(page.locator("#timeValue")).toBeVisible();
  await expect(page.locator("#speed")).toBeVisible();
  await expect(page.locator("#detourMode")).toBeVisible();
  await expect(page.locator("#tankCapacity")).toBeVisible();
  await expect(page.locator("#settings-city")).toBeVisible();

  // C4: Aktive Schwellen-Tabelle aus /api/v1/stats/summary — read-only,
  // Startwerte der Engine (ohne Daten keine Abweichung möglich).
  await expect(
    page.getByText("read-only · Quelle: /api/v1/stats/summary"),
  ).toBeVisible();
  const table = page.locator("table").filter({ hasText: "Mindest-Ersparnis" });
  await expect(
    table.locator("tr", { hasText: "Warten (grün)" }).first(),
  ).toContainText("2,00 €");
  await expect(
    table.locator("tr", { hasText: "wenn P(Warten) unter" }),
  ).toContainText("50 %");
  // Read-only: kein einziges Eingabefeld in der Schwellen-Tabelle.
  await expect(table.locator("input")).toHaveCount(0);

  // C4: Dark/Light-Umschaltung — wird auf <html> angewendet und übersteht
  // einen Reload (Bootstrap-Script in index.html, localStorage).
  await page
    .getByRole("button", { name: "Hell (Slate)", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
  // Zurück auf den Default (dunkles Slate), damit andere Tests nicht
  // von dieser Ansicht abhängen. Nach dem Reload startet die App im
  // Alltagstabs — der Theme-Button liegt im Einstellungen-Tab.
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
  await page
    .getByRole("button", { name: "Dunkles Slate (Standard)", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
