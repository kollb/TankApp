// @vitest-environment happy-dom
// O44: Die gebaute App gegen den Pi-Fallback (rp2/fallback_gui.py, Port 8000).
//
// Befund 17.09.2026, 20:25: Im Browser lief die gebaute App (der Index-Chunk
// aus `web/dist`), während die Anfragen die Pi beantwortete — ihr Proxy hielt
// das NAS für offline. Der Fallback kennt nur sechs Pfade (health, stations,
// forecasts, decide, series, nas-check), alles andere antwortet 404; und sein
// `/api/v1/stations` lieferte `{fuel, stations, fresh_prices}` **ohne**
// `cities`. Die Ansicht las `data?.cities.includes(city)` — `data` war gesetzt,
// `cities` nicht: `TypeError: Cannot read properties of undefined (reading
// 'includes')`, und die ganze App blieb weiß.
//
// Hier wird genau das gefahren: der echte Provider gegen einen Fetch-Stub, der
// wie der Pi antwortet. Zwei Zusagen: (1) ein fremdes Stations-Payload kostet
// nie mehr die Seite — es gilt als „kein Payload“ (ehrlicher Leerzustand), und
// (2) wenn der Fallback mit `nas_status: "offline"` antwortet, sagt die App,
// woher die Zahlen kommen.

import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { OverviewProvider, useOverview, type OverviewState } from "./overview";

// Wie in `views/Labor.test.tsx`: React 19 warnt sonst bei jedem `act`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Eine Zeile, wie sie der Pi-Puffer führt (inkl. `observed_at`-Alias). */
const STATION = {
  station_id: "6a7fe9a1-e30d-422e-a6a9-00bea6621c6f",
  name: "Station Alpha",
  brand: "Aral",
  city: "Frankfurt",
  status: "open",
  e10: 1.699,
  fuel: "e10",
  price: 1.699,
  lat: 50.11,
  lon: 8.68,
  dist_km: 4.2,
  maps_url: null,
  fetched_at: "2026-09-17T18:25:00+00:00",
  observed_at: "2026-09-17T18:25:00+00:00",
  age_minutes: 2.0,
  fresh: true,
};

/** Die Antwort des Pi-Fallbacks auf `/api/v1/stations`. */
const FALLBACK_STATIONS = {
  generated_at: "2026-09-17T18:25:00+00:00",
  fuel: "e10",
  cities: ["Frankfurt"],
  fresh_minutes: 30,
  stations: [STATION],
  fresh_prices: 1,
  nas_status: "offline",
  calibrated: false,
  decision_ready: false,
};

/** Dieselbe Antwort **vor** der Kompatibilitäts-Änderung: ohne `cities`. */
const FALLBACK_STATIONS_WITHOUT_CITIES = {
  generated_at: "2026-09-17T18:25:00+00:00",
  fuel: "e10",
  fresh_minutes: 30,
  stations: [STATION],
  fresh_prices: 1,
  nas_status: "offline",
};

function installPiFetch(stationsPayload: unknown) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    const payload = url.startsWith("/api/v1/stations")
      ? stationsPayload
      : { error_code: "not_found" };
    const status = url.startsWith("/api/v1/stations") ? 200 : 404;
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function Probe() {
  const ov = useOverview();
  return (
    <p>
      {[
        `cities=${ov.data?.cities.join(",") ?? "-"}`,
        `activeCity=${ov.activeCity || "-"}`,
        `stations=${ov.stations.length}`,
        `notice=${ov.fallbackNotice ? "yes" : "no"}`,
      ].join("|")}
    </p>
  );
}

async function mountWithPi(stationsPayload: unknown) {
  const restore = installPiFetch(stationsPayload);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <OverviewProvider>
          <Probe />
        </OverviewProvider>,
      );
    });
  } catch (error) {
    restore();
    throw error;
  }
  return {
    text: container.textContent ?? "",
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      restore();
    },
  };
}

describe("O44: App gegen den Pi-Fallback", () => {
  it("zeigt die Stationen des Pi und sagt, dass das NAS fehlt", async () => {
    const mounted = await mountWithPi(FALLBACK_STATIONS);
    try {
      expect(mounted.text).toContain("cities=Frankfurt");
      expect(mounted.text).toContain("stations=1");
      expect(mounted.text).toContain("notice=yes");
    } finally {
      await mounted.unmount();
    }
  });

  it("stürzt an einer Antwort ohne `cities` nicht ab (Regression)", async () => {
    // Das ist der Produktionsabsturz: `data` ohne `cities` ließ
    // `data.cities.includes(...)` werfen und die Seite weiß zurück.
    const mounted = await mountWithPi(FALLBACK_STATIONS_WITHOUT_CITIES);
    try {
      // Kein Stations-Payload → Leerzustand, keine geratene Stadt.
      expect(mounted.text).toContain("cities=-");
      expect(mounted.text).toContain("activeCity=-");
      expect(mounted.text).toContain("stations=0");
      // Ohne vollständiges Payload gibt es auch keine Herkunfts-Zusage.
      expect(mounted.text).toContain("notice=no");
    } finally {
      await mounted.unmount();
    }
  });

  it("hält auch ein fremdes Fehler-Objekt aus", async () => {
    const mounted = await mountWithPi(
      JSON.stringify({ error_code: "decide_failed", detail: "TypeError" }),
    );
    try {
      expect(mounted.text).toContain("stations=0");
    } finally {
      await mounted.unmount();
    }
  });
});


describe("NP3: keine alte Aktionsfreigabe im degradierten NAS-Tab", () => {
  it.each(["overview_503", "pi_prices"])("sperrt sofort bei %s, ohne Eingaben zu verlieren", async (failure) => {
    const original = globalThis.fetch;
    let degraded = false;
    let view!: OverviewState;
    const contracts: string[] = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      contracts.push(new Headers(init?.headers).get("X-TankApp-UI") ?? "missing");
      if (url.startsWith("/api/v1/stations")) {
        return new Response(JSON.stringify({
          ...FALLBACK_STATIONS,
          nas_status: degraded && failure === "pi_prices" ? "offline" : "online",
        }));
      }
      if (url.startsWith("/api/v1/overview")) {
        if (degraded && failure === "overview_503")
          return new Response('{}', { status: 503 });
        return new Response(JSON.stringify({
          decide: { primary: { action: "wait" }, windows_today: [], windows_week: [] },
        }));
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    function ActionProbe() {
      view = useOverview();
      return <span>{view.decideRes.data?.primary?.action ?? "no_action"}</span>;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<OverviewProvider><ActionProbe /></OverviewProvider>));
      expect(container.textContent).toBe("wait");
      await act(async () => {
        view.setQuickLitersStr("23.5");
        view.setQuickPriceStr("1.888");
      });
      degraded = true;
      await act(async () => view.setRefresh((n) => n + 1));
      expect(container.textContent).toBe("no_action");
      if (failure === "overview_503") {
        expect(view.overview.failStreak).toBe(1);
        expect(view.overview.error).toBe(false); // banner debounce is independent
      }
      expect(view.quickLitersStr).toBe("23.5");
      expect(view.quickPriceStr).toBe("1.888");
      degraded = false;
      await act(async () => view.setRefresh((n) => n + 1));
      expect(container.textContent).toBe("wait");
      expect(view.quickLitersStr).toBe("23.5");
      expect(contracts.every((contract) => contract === "nas-v1")).toBe(true);
    } finally {
      await act(async () => root.unmount());
      globalThis.fetch = original;
    }
  });
});
