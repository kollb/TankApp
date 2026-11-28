// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api/client";
import { clearOutbox, listOutbox } from "./api/outbox";
import type { Fuel, VehicleProfile } from "./api/types";
import { SettingsPage } from "./features/settings/SettingsPage";
import { AppProvider } from "./state/AppContext";

const profiles: VehicleProfile[] = [
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

let activeProfileId = "commuter";
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function responseFor<T>(path: string): T {
  if (path === "profiles") return { profiles, active: activeProfileId } as T;
  if (path === "fills") return { count: 0, fills: [] } as T;
  if (path === "fills/summary") {
    return {
      n_fills_total: 0,
      months: [],
      years: [],
      overall: { key: "all", fills: 0, liters: 0, total_eur: 0, saved_eur: 0, baseline_eur: 0, saved_pct: null },
    } as T;
  }
  if (path.startsWith("stations?")) {
    const fuel = new URLSearchParams(path.split("?")[1]).get("fuel") as Fuel;
    return {
      generated_at: "2026-11-28T10:00:00Z",
      fuel,
      cities: ["Frankfurt"],
      stations: [{
        station_id: "station-1",
        city: "Frankfurt",
        name: "Test-Tankstelle",
        fuel,
        price: 1.72,
        observed_at: "2026-11-28T10:00:00Z",
        status: "open",
        fresh: true,
      }],
    } as T;
  }
  return {} as T;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function clickTab(name: string): void {
  const tab = [...(host?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
    .find((item) => item.textContent?.trim() === name);
  if (!tab) throw new Error(`Tab „${name}“ nicht gefunden`);
  tab.click();
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Native input value setter is unavailable");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Einstellungen der aktuellen Feature-Shell", () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  beforeEach(() => {
    localStorage.clear();
    activeProfileId = "commuter";
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string) => responseFor<T>(path));
    vi.spyOn(api, "post").mockImplementation(async (path: string) => {
      const match = path.match(/^profiles\/([^/]+)\/activate$/);
      if (match) activeProfileId = decodeURIComponent(match[1]);
      return undefined as never;
    });
    vi.spyOn(api, "put").mockImplementation(async () => undefined as never);
  });

  afterEach(async () => {
    if (root) act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;
    await clearOutbox();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("bietet Tankstand, Profile und Belege als die drei aktuellen Einstellungen-Bereiche", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<AppProvider><SettingsPage /></AppProvider>));
    await settle();

    expect(host.textContent).toContain("Fahrzeug & Tank");
    expect(host.textContent).toContain("Tankstand wird nur auf diesem Gerät gespeichert.");
    expect(host.querySelector('[role="tablist"][aria-label="Einstellungen"]')).not.toBeNull();
    expect([...host.querySelectorAll('[role="tab"]')].map((item) => item.textContent?.trim()))
      .toEqual(["Fahrzeug & Tank", "Profile", "Belege & Bilanz"]);
    expect(host.textContent).toContain("50 L");
    expect(api.get.mock.calls.some(([path]) => path === "stations?fuel=e5")).toBe(true);
  });

  it("speichert eine Tankstand-Bearbeitung lokal auf diesem Gerät", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<AppProvider><SettingsPage /></AppProvider>));
    await settle();

    const slider = host.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider).not.toBeNull();
    await act(async () => setInputValue(slider!, "64"));

    expect(host.textContent).toContain("64%");
    expect(localStorage.getItem("tankapp.tank.percent")).toBe("64");
  });

  it("schreibt Profiländerungen über die sichtbare Bearbeitungsmaske", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<AppProvider><SettingsPage /></AppProvider>));
    await settle();
    await act(async () => clickTab("Profile"));

    const form = host.querySelector<HTMLFormElement>("form.form-grid");
    const name = form?.querySelector<HTMLInputElement>("input");
    expect(form).not.toBeNull();
    expect(name?.value).toBe("Pendler");
    await act(async () => setInputValue(name!, "Pendler Plus"));
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settle();

    expect(api.put).toHaveBeenCalledWith("profiles/commuter", { name: "Pendler Plus" });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Profil gespeichert.");
  });

  it("synchronisiert beim Aktivieren eines Profils auch dessen Kraftstoff für die Stationenabfrage", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<AppProvider><SettingsPage /></AppProvider>));
    await settle();

    await act(async () => clickTab("Profile"));
    const select = host.querySelector<HTMLSelectElement>("select");
    expect(select).not.toBeNull();
    await act(async () => {
      select!.value = "diesel-car";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settle();

    expect(api.post).toHaveBeenCalledWith("profiles/diesel-car/activate", undefined);
    expect(api.get.mock.calls.some(([path]) => path === "stations?fuel=diesel")).toBe(true);
    expect(activeProfileId).toBe("diesel-car");
    await act(async () => clickTab("Fahrzeug & Tank"));
    expect(host.textContent).toContain("62 L");
  });

  it("queues a fill on retryable 503 but does not queue a rejected 400", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<AppProvider><SettingsPage /></AppProvider>));
    await settle();
    await act(async () => clickTab("Belege & Bilanz"));

    const station = host.querySelector<HTMLSelectElement>("select");
    const inputs = [...(host.querySelectorAll<HTMLInputElement>('form input[type="number"]'))];
    const form = host.querySelector<HTMLFormElement>("form");
    expect(station?.options.length).toBeGreaterThan(1);
    expect(inputs).toHaveLength(2);
    expect(form).not.toBeNull();

    await act(async () => {
      station!.value = "station-1";
      station!.dispatchEvent(new Event("change", { bubbles: true }));
      inputs[0].value = "37.5";
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      inputs[1].value = "1.777";
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });

    api.post.mockImplementationOnce(async () => {
      throw new ApiError("API-Anfrage fehlgeschlagen (503)", 503);
    });
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settle();
    expect(await listOutbox()).toHaveLength(1);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Beleg offline vorgemerkt");

    await clearOutbox();
    api.post.mockImplementationOnce(async () => {
      throw new ApiError("API-Anfrage fehlgeschlagen (400)", 400);
    });
    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await settle();
    expect(await listOutbox()).toHaveLength(0);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("API-Anfrage fehlgeschlagen (400)");
  });
});
