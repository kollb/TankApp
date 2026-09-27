import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { clickArea } from "./nav";

// Real NAS and Pi handlers. The Python controller only cuts/restores their
// transport. No page.route, API response stubs, browser online event or remount.
let controller: ChildProcessWithoutNullStreams;
let pi: string;
let output: string[];

test.beforeEach(async () => {
  output = [];
  controller = spawn("python3", [
    "../tests/fixtures/failover_stack.py",
    process.env.TANKAPP_DEMO_URL || "http://127.0.0.1:1357",
  ]);
  createInterface({ input: controller.stdout }).on("line", (line) => output.push(line));
  controller.stderr.on("data", (chunk) => output.push(String(chunk)));
  await expect.poll(() => output.find((line) => line.startsWith("READY ")), {
    timeout: 30_000, message: "Pi-Testserver startet mit echten NAS-Daten",
  }).toBeTruthy();
  pi = output.find((line) => line.startsWith("READY "))!.slice(6);
});

test.afterEach(async () => {
  if (controller) {
    controller.stdin.end();
    controller.kill("SIGTERM");
  }
});

async function link(mode: "online" | "offline") {
  const before = output.length;
  controller.stdin.write(mode + "\n");
  await expect.poll(() => output.slice(before).includes("ACK " + mode)).toBe(true);
}

async function recover(page: Page) {
  await link("online");
  await expect.poll(async () => (await (await page.request.get(pi + "/api/v1/nas-check")).json()).online).toBe(true);
}

async function entries(page: Page) {
  return page.evaluate(() => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open("tankapp.outbox.v1", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("entries", "readonly");
      const read = transaction.objectStore("entries").getAll();
      read.onsuccess = () => resolve(read.result);
      transaction.oncomplete = () => db.close();
    };
  }));
}

test("Pi-Tab bleibt beim Vertrag; Rückwechsel erhält Kraftstoff, Ort und Eingabe", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await link("offline");
  await page.goto(pi + "/?fallback=1");
  await expect(page.locator("#answer-title")).toContainText("Preisvergleich");
  await page.locator("#city").selectOption("Demostadt");
  await page.locator('#fuel-tabs button[data-fuel="e5"]').click();
  // Still focused/uncommitted: the explicit handoff must save the input,
  // not just whatever the last change handler happened to store.
  await page.locator("#liters").fill("95");
  await recover(page);
  await page.locator("#refresh-btn").click();
  await expect(page.locator("#nas-text")).toContainText("NAS bereit");
  await expect(page.locator("#answer-title")).toContainText("Preisvergleich");
  await expect(page.locator("#liters")).toHaveValue("95");
  expect(page.url()).toContain("fallback=1");
  const response = await page.request.get(pi + "/api/v1/decide", { headers: { "X-TankApp-UI": "pi-v1" } });
  expect((await response.json()).f1.recommendation).toBe("no_advice");
  await page.locator("#nas-pill").click();
  await expect(page.locator("#jetzt-headline")).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tankapp.liters")!))).toBe(95);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tankapp.city")!))).toBe("Demostadt");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tankapp.fuel")!))).toBe("e5");
  expect(errors).toEqual([]);
});

test("NAS-Tab überlebt Ausfall mit Beleg-Outbox und ungesendetem Entwurf", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Refresh-Knopf ist im Desktop-Header; Pi-Rückwechsel läuft in allen Breiten.");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Freeze periodic retries: only recognition of NAS recovery can flush this
  // outbox. No navigator online event, timer tick, reload or mount is involved.
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto(pi);
  await expect(page.locator("#jetzt-headline")).toBeVisible();
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await clickArea(page, "Ich");
  await page.getByRole("tab", { name: "Belege", exact: true }).click();
  const form = page.getByRole("region", { name: "Tanken erfassen" });
  await link("offline");
  await page.getByRole("button", { name: "Daten aktualisieren" }).click();
  await expect(page.getByText(/Antwort kommt vom Pi-Fallback/)).toBeVisible();
  await form.getByRole("textbox").nth(0).fill("37.5");
  await form.getByRole("textbox").nth(1).fill("1.777");
  await form.getByRole("button", { name: "Beleg buchen", exact: true }).click();
  await expect.poll(() => entries(page)).toHaveLength(1);
  const queued = (await entries(page))[0];
  const fill = JSON.parse(queued.body);
  await form.getByRole("textbox").nth(0).fill("23.5");
  await form.getByRole("textbox").nth(1).fill("1.888");
  // A second tab must not change the NAS tab's contract (no shared mode cookie).
  const other = await page.context().newPage();
  await other.goto(pi + "/?fallback=1");
  await expect(other.locator("#answer-title")).toContainText("Preisvergleich");
  expect((await entries(page))[0].id).toBe(queued.id);
  await recover(page);
  const sent = page.waitForResponse((response) => response.url().endsWith("/api/v1/fills") && response.request().method() === "POST" && response.ok());
  await page.getByRole("button", { name: "Daten aktualisieren" }).click();
  await sent;
  await expect.poll(() => entries(page)).toHaveLength(0);
  await expect(form.getByRole("textbox").nth(0)).toHaveValue("23.5");
  await expect(form.getByRole("textbox").nth(1)).toHaveValue("1.888");
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  const fills = await (await page.request.get(pi + "/api/v1/fills")).json();
  expect(fills.fills.filter((row: any) => row.id === fill.id)).toHaveLength(1);
  expect(errors).toEqual([]);
  await other.close();
});

test("React-Leseausgabe lädt lokale Assets, bleibt lesend und zeigt echte Pufferwerte", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", r => { if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url()); });
  await link("offline");
  await page.goto(pi + "/?fallback=1");
  await expect(page.getByText("Lesemodus · RP2", { exact: true })).toBeVisible();
  expect(await page.locator('script[type="module"]').getAttribute("src")).toMatch(/^\/pi-assets\//);
  await page.getByRole("button", { name: "Stationen", exact: true }).click();
  await expect(page.getByText(/Stationen · gemeldete Preise/)).toBeVisible();
  // The list is fed by the real Pi handler, not a client-side fixture.
  const rows = page.locator("li button");
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  const detail = page.getByRole("dialog");
  await expect(detail).toBeVisible();
  await expect(detail.getByText(/Verlauf wird geladen/)).toHaveCount(0);
  await expect(detail.getByText(/Uhr/)).toHaveCount(19);
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await recover(page);
  // The NAS must never take over the Pi asset namespace after recovery.
  const asset = await page.locator('script[type="module"]').getAttribute("src");
  const response = await page.request.get(pi + asset);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("javascript");
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
