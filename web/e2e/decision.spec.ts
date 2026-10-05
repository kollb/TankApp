import { test, expect, type Page } from "@playwright/test";

// GUI-Neuentwurf (Phase 1+2): Der Einstieg ist „Jetzt“ — der komplette
// Entscheidungs-Fluss „decide → intent → fill → due“ lebt dort.

// D2: Entscheidungs-Fluss „decide → intent → fill → due“ mit Mocks.
// Schützt die V3-Fixes: Erfolgsmeldung nur bei Erfolg, Due-Prompt nach
// „Ich warte“, Fill verbucht den Beleg, Serverfehler erzeugt keine Erfolgsmeldung.

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

// B7: „Jetzt“ und „Woche“ holen decide + fills + stats/summary + due-Episoden
// + Tageskurve als EINE Anfrage aus /api/v1/overview — die Tests mocken
// deshalb zusätzlich den Overview-Payload, zusammengesetzt aus denselben
// Fixtures, die auch die (weiterhin gemockten) Einzelpfade bedienen.
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const DECIDE_FIXTURE = {
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
  tank: null,
};

const STATS_FIXTURE = {
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
};

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
    await route.fulfill({ json: STATS_FIXTURE });
  });
  await page.route("**/api/v1/decide?*", async (route) => {
    await route.fulfill({ json: DECIDE_FIXTURE });
  });
}

test("Jetzt: eine Antwort, eine Handlung — kein Intent-Kanal mehr", async ({
  page,
}) => {
  // D2 bleibt die Zusage („Erfolg nur bei Erfolg“), aber der Weg ist seit
  // dem UX-NEUENTWURF §3/§7 ein anderer: Die Antwortkarte trägt genau eine
  // Handlung (Route) und ein „Warum?“; die Feedback-Intents („Ich warte“)
  // und der Fällig-Prompt sind gestrichen. Der **Vertrag** bleibt: Der
  // Server liefert Intents und Episoden weiter — die GUI zeigt sie nur
  // nicht mehr (kein API-Bruch).
  const intents: string[] = [];
  await stubBase(page);
  await page.route("**/api/v1/episodes/*/intent", async (route) => {
    const body = route.request().postDataJSON() as { intent?: string };
    intents.push(body.intent ?? "");
    await route.fulfill({ json: { id: "ep-1", status: "waiting", intent: body.intent } });
  });
  await page.route("**/api/v1/overview?*", async (route) => {
    await route.fulfill({
      json: {
        generated_at: iso(0),
        decide: { ...DECIDE_FIXTURE, calibrated: true },
        fills: { count: 0, fills: [], error_code: null },
        stats_summary: STATS_FIXTURE,
        episodes: { count: 0, episodes: [] },
        day: { points: [], error_code: null },
        error_code: null,
      },
    });
  });

  await page.goto("/");
  // Die Antwort selbst: Chip, Überschrift und der Euro-Betrag (§3).
  await expect(page.locator("#jetzt-headline")).toContainText("Warten bis");
  await expect(page.getByText("spart ca. 1,60 €")).toBeVisible();

  // §7: keine Intents mehr in der Ansicht — der Kanal wird nicht benutzt.
  await expect(
    page.getByRole("button", { name: "Ich warte", exact: true }),
    "Die Feedback-Intents sind zurück.",
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Verwerfen/ })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Gerade getankt?" }),
    "Der Fällig-Prompt ist zurück (Entscheidung 04.10.2026: ersatzlos streichen).",
  ).toHaveCount(0);
  expect(intents, "kein Intent-Request aus der Antwortkarte").toEqual([]);

  // „Warum?“ ist der einzige Weg in die Tiefe — mit höchstens fünf Zeilen.
  await page.getByRole("button", { name: "Warum?", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const lines = dialog.locator("ol > li");
  const count = await lines.count();
  expect(count, "Das „Warum?“ -Blatt trägt mehr als fünf Zeilen.").toBeLessThanOrEqual(5);
  expect(count, "Das „Warum?“ -Blatt ist leer.").toBeGreaterThan(0);
});

// B10: Aus dem „Serverfehler“ wurden zwei Fälle. Ein 503 heißt „niemand
// erreichbar“ — der Beleg wird vorgemerkt und nachgereicht, und die App
// behauptet **keinen** Erfolg. Eine echte Ablehnung (400) bleibt ein Fehler
// mit Klartext.
// B10: Aus dem „Serverfehler“ wurden zwei Fälle. Ein 503 heißt „niemand
// erreichbar“ — der Beleg wird vorgemerkt und nachgereicht, und die App
// behauptet **keinen** Erfolg. Eine echte Ablehnung (400) bleibt ein Fehler
// mit Klartext.
//
// Der Weg dorthin war bis 0.72.2 der Fällig-Prompt („Ja, wie empfohlen“).
// Er ist ersatzlos gestrichen; Belege entstehen in „Ich → Belege → Tanken
// erfassen“. Die Outbox-Zusage (B10) bleibt und wird hier am neuen Ort
// geprüft.
async function openReceiptForm(page: Page) {
  await page.goto("/?tab=ich");
  await page.getByRole("tab", { name: "Belege", exact: true }).click();
  const form = page.getByRole("region", { name: "Tanken erfassen" });
  await form.getByRole("textbox").nth(0).fill("37.5");
  await form.getByRole("textbox").nth(1).fill("1.777");
  return form;
}

test("NAS nicht erreichbar (503): Beleg wird vorgemerkt, kein Erfolg behauptet", async ({
  page,
}) => {
  await stubBase(page);
  await page.route("**/api/v1/fills", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({ json: { count: 0, fills: [], error_code: null } });
      return;
    }
    await route.fulfill({ status: 503, json: { detail: "NAS nicht erreichbar" } });
  });
  const form = await openReceiptForm(page);
  await form.getByRole("button", { name: "Beleg buchen", exact: true }).click();
  await expect(page.getByText(/Beleg lokal vorgemerkt/)).toBeVisible();
  await expect(page.getByText("Beleg in deiner Bilanz verbucht.")).toHaveCount(0);
  // Die Queue sagt selbst, dass etwas wartet (B10) — sichtbar, nicht still.
  // Genau ein Eintrag ist vorgemerkt → Singular („geht raus“); der Plural
  // („gehen raus“) steht erst ab zwei Einträgen.
  await expect(
    page.getByText(/lokal vorgemerkt und geht raus, sobald die Verbindung steht/),
  ).toBeVisible();
});

test("Abgelehnter Beleg (400) bleibt ein Fehler", async ({ page }) => {
  await stubBase(page);
  await page.route("**/api/v1/fills", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({ json: { count: 0, fills: [], error_code: null } });
      return;
    }
    // Der Server lehnt mit einem benannten Code ab (`invalid_liters`) —
    // nur daran erkennt die Maske die Ablehnung.
    await route.fulfill({ status: 400, json: { error_code: "invalid_liters" } });
  });
  const form = await openReceiptForm(page);
  await form.getByRole("button", { name: "Beleg buchen", exact: true }).click();
  await expect(page.getByText(/Speichern fehlgeschlagen/)).toBeVisible();
  await expect(page.getByText(/lokal vorgemerkt/)).toHaveCount(0);
});

// UI-Neugestaltung: eine offen gehaltene Seite darf keine abgelaufene
// Empfehlung behalten, auch wenn der Server denselben Cache liefert.
test("Gültigkeits-Countdown wechselt ohne neue Freigabe zur Ablaufkarte", async ({ page }) => {
  const now = new Date("2026-09-27T10:00:00Z");
  await page.clock.install({ time: now });
  await stubBase(page);
  await page.route("**/api/v1/overview?*", async (route) => {
    await route.fulfill({ json: {
      generated_at: now.toISOString(),
      decide: { ...DECIDE_FIXTURE, calibrated: true, decision_ready: true,
        valid_until: "2026-09-27T10:01:30Z" },
      fills: { count: 0, fills: [], error_code: null },
      stats_summary: STATS_FIXTURE,
      episodes: { count: 0, episodes: [] },
      day: { points: [], error_code: null },
      error_code: null,
    } });
  });
  await page.goto("/");
  // §3: Die Gültigkeit steht in kleiner Schrift als `bis HH:MM` — und erst
  // in den letzten 30 Minuten mit dem Zusatz „noch N min“.
  await expect(page.getByText("bis 12:01 · noch 2 min", { exact: true })).toBeVisible();
  await page.clock.runFor(60000);
  await expect(page.getByText("bis 12:01 · noch 1 min", { exact: true })).toBeVisible();
  await page.clock.runFor(30000);
  // Abgelaufen heißt seit 0.73.0: **kein** Urteil mehr. Die Karte fällt auf
  // die Tatsache zurück (Chip „Preisvergleich“, günstigster bekannter
  // Preis) — eine eigene „abgelaufen“-Karte würde eine Freigabe behaupten,
  // die es nicht mehr gibt (A21-B1.4, UX-NEUENTWURF §3).
  await expect(page.getByText("Preisvergleich", { exact: true })).toBeVisible();
  await expect(page.locator("#jetzt-headline")).toContainText("Günstigste gerade: F-Station");
  await expect(page.getByText(/bis 12:01/)).toHaveCount(0);
  await expect(page.getByText("Empfehlung abgelaufen")).toHaveCount(0);
});
