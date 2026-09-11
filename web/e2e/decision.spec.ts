import { test, expect, type Page } from "@playwright/test";

// D2: Entscheidungs-Fluss „decide → intent → fill → due“ mit Mocks.
// Schützt die V3-Fixes: Erfolgsmeldung nur bei Erfolg, Due-Prompt nach
// „Ich warte“, Fill verbucht den Beleg, 429/Fehler erzeugt keine Erfolgsmeldung.

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function stationRow() {
  return {
    station_id: "a",
    city: "Frankfurt",
    name: "F-Station",
    brand: "Test",
    fuel: "e10",
    price: 1.759,
    last_price: 1.759,
    status: "open",
    fresh: true,
    age_minutes: 2,
    observed_at: iso(0),
    maps_url: null,
  };
}

async function stubBase(page: Page) {
  await page.route("**/api/v1/stations?*", async (route) => {
    await route.fulfill({
      json: {
        generated_at: iso(0),
        cities: ["Frankfurt"],
        fuel: "e10",
        stations: [stationRow()],
        connection_error: null,
        fresh_prices: 1,
      },
    });
  });
  await page.route("**/api/v1/health", async (route) => {
    await route.fulfill({
      json: {
        app: "online",
        generated_at: iso(0),
        version: "test",
        commit: null,
        polling_error: null,
        station_count: 1,
        influx_configured: true,
        archive_configured: false,
        jobs_enabled: true,
        alarms: [],
        archive: {},
        jobs: {},
        models: { published_at: iso(0), count: 0, calibrated: false, decision_ready: false },
        selection: { published_at: null, count: 0, error_code: "selection_not_available" },
        collector: { available: true, fresh: true },
      },
    });
  });
  await page.route("**/api/v1/series?*", async (route) => {
    await route.fulfill({ json: { points: [], error_code: null } });
  });
  await page.route("**/api/v1/stats/summary?*", async (route) => {
    await route.fulfill({
      json: {
        generated_at: iso(0),
        fuel: "e10",
        city: null,
        live_advice: {
          n: 0,
          calibrated: false,
          gate_status: "Kalibrierung steht aus",
          brier_30d: null,
          wait_hits: 0,
          wait_n: 0,
          now_hits: 0,
          now_n: 0,
          reliability: [],
          min_recommendations: 100,
          brier_threshold: 0.25,
        },
        wallet: { n_fills: 0, followed: 0, saved_eur: 0, wh_hours: [], last_fill: null },
        live_phase: null,
        calibrated: false,
        decision_ready: false,
      },
    });
  });
  await page.route("**/api/v1/decide?*", async (route) => {
    await route.fulfill({
      json: {
        primary: {
          action: "wait",
          station: { id: "a", name: "F-Station", brand: "Test", price_now: 1.759, maps_url: null },
          recommended_window: { start: iso(3600_000), end: iso(3 * 3600_000), expected_price: 1.719 },
          expected_saving_eur: 1.6,
          p_correct: 0.82,
          confidence_badge: "high",
          reason_short: "Warten lohnt sich voraussichtlich bis zum Abend.",
        },
        alternatives_nearby: [],
        windows_today: [],
        windows_week: [],
        episode: { id: "ep-1", status: "open", intent: "none", opened_at: iso(0) },
        personal_stats: {
          advice: { last_30d_hits: 0, last_30d_total: 0, hit_rate: null, brier_30d: null },
          wallet: { fills_30d: 0, followed: 0, saved_eur_30d: 0 },
        },
        calibrated: false,
        decision_ready: false,
        error_code: null,
      },
    });
  });
}

test("decide → intent → fill → due: Erfolg nur bei Erfolg", async ({ page }) => {
  const intents: string[] = [];
  let due = false;
  const fillsPosted: Record<string, unknown>[] = [];

  await stubBase(page);

  await page.route("**/api/v1/episodes?status=due", async (route) => {
    await route.fulfill({
      json: due
        ? {
            count: 1,
            episodes: [
              {
                id: "ep-1",
                status: "due",
                intent: "wait",
                last_snapshot: {
                  station_id: "a",
                  station_name: "F-Station",
                  expected_price: 1.719,
                },
              },
            ],
          }
        : { count: 0, episodes: [] },
    });
  });
  await page.route("**/api/v1/episodes/*/intent", async (route) => {
    const body = route.request().postDataJSON() as { intent?: string };
    intents.push(body.intent ?? "");
    await route.fulfill({ json: { id: "ep-1", status: "waiting", intent: body.intent } });
  });
  await page.route("**/api/v1/fills", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      fillsPosted.push(body);
      await route.fulfill({ json: { ...body, id: "fill-1", voided: false } });
      return;
    }
    await route.fulfill({ json: { count: fillsPosted.length, fills: fillsPosted, error_code: null } });
  });

  await page.goto("/");
  await expect(page.getByText("WARTEN").first()).toBeVisible();

  // 1) Intent „Ich warte“ setzen.
  await page.getByRole("button", { name: "Ich warte", exact: true }).click();
  await expect(page.getByText("Auswahl gespeichert!")).toBeVisible();
  expect(intents).toContain("wait");

  // 2) Fenster vorbei → Due-Prompt erscheint nach dem nächsten Reload.
  due = true;
  await page.getByRole("button", { name: "Daten aktualisieren" }).click();
  await expect(
    page.getByRole("heading", { name: "Hast du getankt?" }),
  ).toBeVisible();

  // 3) Beleg verbuchen → Erfolgsmeldung.
  await page.getByRole("button", { name: /Ja, wie empfohlen/ }).click();
  await expect(page.getByText("Füllung in deiner Tank-Bilanz verbucht!")).toBeVisible();
  expect(fillsPosted.length).toBe(1);
  expect(fillsPosted[0].liters).toBe(40);
});

test("429 beim Buchen zeigt keinen Erfolg", async ({ page }) => {
  await stubBase(page);
  await page.route("**/api/v1/episodes?status=due", async (route) => {
    await route.fulfill({
      json: {
        count: 1,
        episodes: [
          {
            id: "ep-1",
            status: "due",
            intent: "wait",
            last_snapshot: { station_id: "a", station_name: "F-Station", expected_price: 1.719 },
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/episodes/*/intent", async (route) => {
    await route.fulfill({ json: { id: "ep-1", status: "waiting", intent: "wait" } });
  });
  await page.route("**/api/v1/fills", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error_code: "rate_limited" }),
      });
      return;
    }
    await route.fulfill({ json: { count: 0, fills: [], error_code: null } });
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Hast du getankt?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Ja, wie empfohlen/ }).click();
  await expect(page.getByText(/Speichern fehlgeschlagen/)).toBeVisible();
  await expect(page.getByText("Füllung in deiner Tank-Bilanz verbucht!")).toHaveCount(0);
});
