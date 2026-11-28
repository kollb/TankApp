import type { Page, Route } from "@playwright/test";

type MockOptions = { blocked?: boolean };

export interface MockApiState {
  requests: string[];
  activeProfileId: string;
}

const profiles = [
  {
    id: "commuter",
    name: "Pendler",
    fuel: "e5",
    liters: 40,
    consumption: 7,
    time_value_eur_h: 0,
    speed_kmh: 45,
    detour_mode: "onroute",
    tank_capacity_l: 50,
  },
  {
    id: "diesel-car",
    name: "Diesel-Fahrzeug",
    fuel: "diesel",
    liters: 45,
    consumption: 6,
    time_value_eur_h: 12,
    speed_kmh: 50,
    detour_mode: "dedicated",
    tank_capacity_l: 62,
  },
];

function stations(fuel: string) {
  return [
    {
      station_id: "station-nord",
      city: "Frankfurt",
      name: "Test-Tankstelle Nord",
      brand: "Test",
      fuel,
      price: 1.699,
      last_price: 1.709,
      status: "open",
      fresh: true,
      age_minutes: 2,
      observed_at: "2026-11-28T10:00:00Z",
      dist_km: 2.3,
      lat: null,
      lon: null,
      maps_url: null,
    },
    {
      station_id: "station-west",
      city: "Frankfurt",
      name: "Test-Tankstelle West",
      brand: "Test",
      fuel,
      price: 1.749,
      last_price: 1.749,
      status: "open",
      fresh: true,
      age_minutes: 4,
      observed_at: "2026-11-28T09:58:00Z",
      dist_km: 3.1,
      lat: null,
      lon: null,
      maps_url: null,
    },
  ];
}

function decision(blocked: boolean) {
  const action = blocked ? "wait" : "refuel_now";
  return {
    primary: {
      action,
      station: { id: "station-nord", name: "Test-Tankstelle Nord", price_now: 1.699, maps_url: null },
      recommended_window: null,
      expected_saving_eur: 4.25,
      p_correct: 0.8,
      confidence_badge: "medium",
      reason_short: "Frischer Beispielpreis.",
    },
    alternatives_nearby: [
      { station_id: "station-nord", name: "Test-Tankstelle Nord", brand: "Test", price: 1.699, delta_ct: 0, detour_km: 0, net_eur: 1.2, ref_price_fresh: true, price_fresh: true },
      { station_id: "station-west", name: "Test-Tankstelle West", brand: "Test", price: 1.749, delta_ct: 5, detour_km: 0, net_eur: 2.1, ref_price_fresh: true, price_fresh: true },
    ],
    valid_until: "2099-01-01T12:00:00Z",
    decision_ready: !blocked,
    blocking_reasons: blocked ? ["Kalibrierungsfreigabe steht aus."] : [],
    tank: { range_km: 520, reserve_range_km: 70, state: "normal" },
  };
}

async function fulfillJson(route: Route, payload: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

export async function mockApi(page: Page, options: MockOptions = {}): Promise<MockApiState> {
  const state: MockApiState = { requests: [], activeProfileId: "commuter" };
  const decide = decision(options.blocked ?? false);
  const now = new Date().toISOString();

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1\//, "");
    const method = request.method();
    state.requests.push(`${method} ${path}${url.search}`);

    if (method === "GET" && path === "overview") {
      if (request.headers()["if-none-match"] === '"overview-v1"') {
        await route.fulfill({ status: 304, headers: { ETag: '"overview-v1"' } });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: '"overview-v1"' },
        body: JSON.stringify({
          generated_at: now,
          data_version: "mock-v1",
          decide,
          fills: { count: 0, fills: [] },
          stats_summary: {},
          episodes: { count: 0, episodes: [] },
          day: {
            points: [
              { timestamp: "2026-11-28T09:00:00Z", price: 1.729, status: "observed" },
              { timestamp: "2026-11-28T10:00:00Z", price: 1.699, status: "observed" },
            ],
            error_code: null,
          },
        }),
      });
      return;
    }

    if (method === "GET" && path === "health") {
      await fulfillJson(route, {
        app: "TankApp",
        version: "0.79.0",
        commit: "test",
        station_count: 2,
        city_options: [{ value: "Frankfurt", label: "Frankfurt" }],
        prices: { fetched_at: now },
        collector: { available: true, last_poll_at: now },
        jobs: {},
      });
      return;
    }

    if (method === "GET" && path === "stations") {
      const fuel = url.searchParams.get("fuel") ?? "e10";
      await fulfillJson(route, {
        generated_at: now,
        cities: ["Frankfurt"],
        fuel,
        stations: stations(fuel),
        anchors: { Frankfurt: { lat: 50.1109, lon: 8.6821 } },
        connection_error: null,
        fresh_prices: 2,
      });
      return;
    }

    if (method === "GET" && path === "decide") {
      await fulfillJson(route, decide);
      return;
    }

    if (method === "GET" && path === "profiles") {
      await fulfillJson(route, { profiles, active: state.activeProfileId });
      return;
    }
    const activate = path.match(/^profiles\/([^/]+)\/activate$/);
    if (method === "POST" && activate) {
      state.activeProfileId = decodeURIComponent(activate[1]);
      await fulfillJson(route, { active: state.activeProfileId });
      return;
    }

    if (method === "GET" && path === "fills") {
      await fulfillJson(route, { generated_at: now, count: 0, fills: [] });
      return;
    }
    if (method === "GET" && path === "fills/summary") {
      await fulfillJson(route, {
        generated_at: now,
        n_fills_total: 0,
        months: [],
        years: [],
        overall: { key: "all", fills: 0, liters: 0, total_eur: 0, saved_eur: 0, saved_verified_eur: 0, baseline_eur: 0, saved_pct: null },
      });
      return;
    }

    if (method === "GET" && path === "stats/summary") {
      await fulfillJson(route, {
        generated_at: now,
        city: "Frankfurt",
        fuel: url.searchParams.get("fuel") ?? "e10",
        backtest: { wins: 4, daysEval: 8, brier: 0.15, mae_ct: 3.2, decisionHour: 10, model: "demo" },
        live_advice: {
          wins: 3,
          n: 6,
          brier: 0.14,
          n_brier: 6,
          gate_status: "Diagnosewerte verfügbar",
          gate_context_key: "demo",
          gate_reliability_bins: [{ lo: 0, hi: 0.2, p: 0.1, rate: 0.5, n: 2 }],
        },
      });
      return;
    }

    if (method === "GET" && path === "heatmap") {
      await fulfillJson(route, {
        generated_at: now,
        city: "Frankfurt",
        fuel: url.searchParams.get("fuel") ?? "e10",
        kind: "level",
        weeks: 6,
        days: ["Mo", "Di"],
        hours: [8, 9],
        matrix: [[1.719, 1.729], [1.739, null]],
      });
      return;
    }
    if (method === "GET" && path === "advice/diary") {
      await fulfillJson(route, { generated_at: now, count: 0, entries: [] });
      return;
    }
    if (method === "GET" && path === "forecast") {
      await fulfillJson(route, {
        generated_at: now,
        points: [{ timestamp: now, q50: 1.72, q025: 1.68, q975: 1.76 }],
        points_3d: [],
        points_7d: [],
      });
      return;
    }

    await fulfillJson(route, { ok: true });
  });

  return state;
}
