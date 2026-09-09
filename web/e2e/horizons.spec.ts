import { test, expect, type Page } from "@playwright/test";

// B1/B2-Akzeptanz auf Browser-Ebene: Zeitraum-Select, Horizont-Tabs,
// Zeitwert-Automatik und Tief/Hoch-Marker. Alle API-Antworten sind
// isolierte Request-Fixtures; in App oder InfluxDB wird nichts geschrieben.

function stationsFixture(fuel: string) {
  return {
    generated_at: new Date().toISOString(),
    cities: ["Frankfurt"],
    fuel,
    stations: [
      {
        station_id: "a",
        city: "Frankfurt",
        name: "F-Station",
        brand: "Test",
        fuel,
        price: 1.759,
        last_price: 1.759,
        status: "open",
        fresh: true,
        age_minutes: 2,
        observed_at: new Date().toISOString(),
        maps_url: "https://www.google.com/maps/dir/?api=1&destination=1,2",
        lat: 50.1,
        lon: 8.6,
      },
      {
        station_id: "b",
        city: "Frankfurt",
        name: "B-Station",
        brand: "Test",
        fuel,
        price: 1.689,
        last_price: 1.689,
        status: "open",
        fresh: true,
        age_minutes: 2,
        observed_at: new Date().toISOString(),
        maps_url: "https://www.google.com/maps/dir/?api=1&destination=3,4",
        lat: 50.12,
        lon: 8.65,
      },
    ],
    connection_error: null,
    fresh_prices: 2,
  };
}

function seriesFixture(hours: number) {
  const now = Date.now();
  const points = [];
  for (let i = hours; i >= 0; i--) {
    points.push({
      timestamp: new Date(now - i * 3600_000).toISOString(),
      price: 1.65 + (i % 7) * 0.01,
      status: "open",
    });
  }
  return { points, error_code: null };
}

function forecastSeries(startMs: number, stepMs: number, count: number, base: number) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const median = base + Math.sin(i / 6) * 0.05 + (i % 5) * 0.004;
    points.push({
      timestamp: new Date(startMs + i * stepMs).toISOString(),
      q50: Number(median.toFixed(3)),
      q10: Number((median - 0.03).toFixed(3)),
      q90: Number((median + 0.03).toFixed(3)),
      q025: Number((median - 0.06).toFixed(3)),
      q975: Number((median + 0.06).toFixed(3)),
    });
  }
  return points;
}

async function stubApi(page: Page, opts: { horizons: boolean }) {
  const seenHours: number[] = [];
  await page.route("**/api/v1/stations?*", async (route) => {
    const fuel = new URL(route.request().url()).searchParams.get("fuel")!;
    await route.fulfill({ json: stationsFixture(fuel) });
  });
  await page.route("**/api/v1/series?*", async (route) => {
    const hours = Number(new URL(route.request().url()).searchParams.get("hours") || 24);
    seenHours.push(hours);
    await route.fulfill({ json: seriesFixture(Math.min(hours, 48)) });
  });
  await page.route("**/api/v1/forecast?*", async (route) => {
    const origin = new Date().toISOString();
    await route.fulfill({
      json: {
        origin,
        points: forecastSeries(Date.now(), 900_000, 96, 1.7),
        ...(opts.horizons
          ? {
              points_3d: forecastSeries(Date.now(), 3_600_000, 72, 1.72),
              points_7d: forecastSeries(Date.now(), 3_600_000, 168, 1.74),
            }
          : {}),
      },
    });
  });
  return seenHours;
}

test("Stations-Labor: Zeitraum steuert Abfrage und Horizont-Tabs", async ({ page }) => {
  const seenHours = await stubApi(page, { horizons: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Statistik", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Stations-Labor · letzte 24 Stunden" }),
  ).toBeVisible();

  await page.getByLabel("Zeitraum des Stations-Labors").selectOption("72");
  await expect(
    page.getByRole("heading", { name: "Stations-Labor · letzte 3 Tage" }),
  ).toBeVisible();
  await expect.poll(() => seenHours.includes(72), { timeout: 5000 }).toBeTruthy();

  // Modell-Ausblick: 12-Uhr-Regel, Tief/Hoch-Marker, Horizont-Tabs.
  await expect(page.getByText("12-Uhr-Regel", { exact: false })).toBeVisible();
  await expect(page.getByText("Tief", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Hoch", { exact: false }).first()).toBeVisible();
  const tab3 = page.getByRole("button", { name: "+3 Tage", exact: true });
  const tab7 = page.getByRole("button", { name: "+7 Tage", exact: true });
  await expect(tab3).toBeEnabled();
  await expect(tab7).toBeEnabled();
  await tab3.click();
  await expect(tab3).toHaveAttribute("aria-pressed", "true");
  await tab7.click();
  await expect(tab7).toHaveAttribute("aria-pressed", "true");
});

test("Modell-Ausblick ohne Mehrtage-Horizonte sperrt die Tabs", async ({ page }) => {
  await stubApi(page, { horizons: false });
  await page.goto("/");
  await page.getByRole("button", { name: "Statistik", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Stations-Labor · letzte 24 Stunden" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "+3 Tage", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "+7 Tage", exact: true }),
  ).toBeDisabled();
});

test("Zeitwert-Automatik zeigt Peak oder Offpeak", async ({ page }) => {
  await stubApi(page, { horizons: true });
  await page.goto("/");
  // Der Kompass zeigt die günstigste Station (B); als Vergleich dient F,
  // damit der Umweg-Rechner mit Zeitwert-Slider erscheint.
  await expect(
    page.getByRole("heading", { name: "B-Station", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "F-Station als Vergleich wählen" })
    .click();
  await expect(page.locator("#timeValue")).toBeVisible();
  await page.locator("#timeValue").fill("0");
  await expect(page.getByText(/Auto \(1[06] €\/h (Peak|offpeak)\)/)).toBeVisible();
  await expect(
    page.getByText("0 = Auto: 16 €/h im Peak (16:30–20:00), sonst 10 €/h."),
  ).toBeVisible();
});
