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

// B7: Decide- und Stats-Antworten je einmal definiert — bedienen sowohl die
// gemockten Einzelpfade als auch den /api/v1/overview-Payload, aus dem der
// Alltagstabs seit 0.19.0 liest.
function decideFixture(selectedId: string) {
  return {
    generated_at: new Date().toISOString(),
    primary: {
      action: "refuel_now",
      station: { id: selectedId, name: selectedId === "a" ? "F-Station" : "B-Station", brand: "Test", price_now: selectedId === "a" ? 1.759 : 1.689, maps_url: null },
      expected_saving_eur: 0,
      p_correct: 0.9,
      confidence_badge: "high",
      reason_short: "Günstigste frische Station.",
    },
    alternatives_nearby: [
      {
        station_id: "b",
        name: "B-Station",
        price: 1.689,
        detour_km: 1.2,
        detour_km_est: 1.2,
        dist_mode: "haversine",
        detour_mode: "haversine",
        trip_mode: "onroute",
        gross_eur: 2.8,
        fuel_cost_eur: 0.2,
        time_cost_eur: 0.3,
        detour_cost_eur: 0.5,
        net_eur: 2.3,
        critical_delta_ct: 1.2,
        worth_it: true,
        verdict: "worth",
        p_lohnt: 0.8,
      },
      {
        station_id: "a",
        name: "F-Station",
        price: 1.759,
        detour_km: 0.8,
        detour_km_est: 0.8,
        dist_mode: "haversine",
        detour_mode: "haversine",
        trip_mode: "onroute",
        gross_eur: -2.8,
        fuel_cost_eur: 0.15,
        time_cost_eur: 0.2,
        detour_cost_eur: 0.35,
        net_eur: -3.15,
        critical_delta_ct: 0.8,
        worth_it: false,
        verdict: "not_worth",
        p_lohnt: 0.1,
      },
    ],
    windows_today: [],
    windows_week: [],
    episode: { id: "ep-1", status: "open", intent: "none", opened_at: new Date().toISOString() },
    thresholds: {
      active: { elsewhere_net_eur: 1.5, elsewhere_borderline_eur: 0.5 },
      auto_apply: false,
      tuning: null,
    },
    quality: { rolling_picp_7d_pct: 95, rolling_picp_7d_badge: "green" },
    personal_stats: { advice: { last_30d_hits: 0, last_30d_total: 0, hit_rate: null, brier_30d: null }, wallet: { fills_30d: 0, followed: 0, saved_eur_30d: 0 } },
    calibrated: true,
    decision_ready: true,
    error_code: null,
  };
}

const STATS_FIXTURE = {
  generated_at: new Date().toISOString(),
  fuel: "e10",
  city: "Frankfurt",
  quality_metrics: { top3_hit_rate: 0.8, mase_sprungfrei: 0.6, picp_95: 95, cusum_drift: { status: "normal", max_cusum: 0.5 } },
  live_advice: { n: 10, calibrated: true, gate_status: "Kalibriert", brier_30d: 0.18, wait_hits: 5, wait_n: 6, now_hits: 4, now_n: 5, reliability: [], min_recommendations: 100, brier_threshold: 0.25 },
  wallet: { n_fills: 2, followed: 1, saved_eur: 3.5, wh_hours: [], last_fill: null },
  live_phase: null,
  backtest: { daysEval: 7, evalRows: {}, models: {}, stations: [{ id: "a", name: "F-Station", city: "Frankfurt" }], calibration: [] },
};

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
  // B6/H1: Server liefert detour_km_est + verdict/Schwellen — e2e muss decide mocken,
  // sonst zeigt die GUI keine Umweg-Sektion (und #timeValue fehlt).
  await page.route("**/api/v1/decide?*", async (route) => {
    const url = new URL(route.request().url());
    const selectedId = url.searchParams.get("station_id") || "b";
    // Zwei Stationen: a=1.759, b=1.689 → b günstiger. Wenn Vergleich a gewählt,
    // liefert Server b als Alternative mit Strecke.
    await route.fulfill({ json: decideFixture(selectedId) });
  });
  // Health + stats minimal für Werkstatt-Tab
  await page.route("**/api/v1/health", async (route) => {
    await route.fulfill({
      json: {
        app: "online",
        generated_at: new Date().toISOString(),
        version: "test",
        commit: "abc123",
        polling_error: null,
        station_count: 2,
        influx_configured: true,
        archive_configured: true,
        jobs_enabled: false,
        alarms: [],
        archive: {},
        jobs: {},
        models: { published_at: new Date().toISOString(), count: 1, calibrated: true, decision_ready: true },
        selection: { published_at: new Date().toISOString(), count: 2, error_code: null },
        collector: { available: true, fresh: true },
      },
    });
  });
  await page.route("**/api/v1/stats/summary?*", async (route) => {
    await route.fulfill({ json: STATS_FIXTURE });
  });
  // B7: der Alltagstabs liest aus /overview (decide + Wallet + Summary +
  // Due-Episoden + Tageskurve in einer Antwort) — dieselben Fixtures.
  await page.route("**/api/v1/overview?*", async (route) => {
    const selectedId =
      new URL(route.request().url()).searchParams.get("station_id") || "b";
    await route.fulfill({
      json: {
        generated_at: new Date().toISOString(),
        decide: decideFixture(selectedId),
        fills: { count: 0, fills: [], error_code: null },
        stats_summary: STATS_FIXTURE,
        episodes: { count: 0, episodes: [] },
        day: seriesFixture(24),
        error_code: null,
      },
    });
  });
  return seenHours;
}

test("Stations-Labor: Zeitraum steuert Abfrage und Horizont-Tabs", async ({ page }) => {
  const seenHours = await stubApi(page, { horizons: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Werkstatt", exact: true }).click();
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
  await page.getByRole("button", { name: "Werkstatt", exact: true }).click();
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
