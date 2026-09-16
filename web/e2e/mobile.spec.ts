import { test, expect, type Page } from "@playwright/test";

// Mobil-Robustheit (Nutzer-Feedback 16.09.2026: „TankApp an sich ist nicht
// mobilrobust. Da sind verschiedene Dinge die scrollen müssen oder aus dem
// Bild ragen“).
//
// Diese Suite läuft gegen den Demo-Stack (`playwright.demo.config.ts`, echte
// Server-Antworten) und nur im `mobile`-Projekt (390 × 844). Sie prüft drei
// Zusagen, die sich nur im Browser messen lassen:
//
//   1. Das Dokument scrollt nicht seitlich (`scrollWidth <= innerWidth`).
//   2. Nichts ragt über den Viewport hinaus, was nicht in einem bewusst
//      scrollbaren Kasten liegt.
//   3. Nichts malt über seine eigene Box hinaus (`scrollWidth > clientWidth`
//      bei `overflow: visible`) — genau das ließ die Zahlenreihe „schief“
//      aussehen, als „1,725“ breiter war als seine Zelle.
//
// Gemessen wird nicht nur der Einstieg: alle sechs Bereiche, die vier
// Ich-Unterseiten, die sechs Labor-Abschnitte und jeder Dialog
// (`aria-haspopup="dialog"`) eines Bereichs. Die Belege werden vorher über die
// echte API angelegt (kein `page.route`) — sonst bliebe genau die Liste
// ungemessen, die auf dem Handy am längsten war.
//
// Die letzte Prüfung hält die Liste der bewusst scrollbaren Kästen fest:
// Ein neuer Querlauf kann nicht still dazukommen.

type Finding = { label: string; detail: string };

type Measurement = {
  docOverflow: number;
  outside: Finding[];
  painted: Finding[];
  scrollers: Finding[];
};

/** Kurzbeschreibung eines Elements für die Fehlermeldung. */
const MEASURE = () => {
  const describe = (element: Element): string => {
    const classes = String(element.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join(".");
    const text = (element.textContent ?? "").trim().replace(/\s+/g, " ");
    return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}${
      text ? ` „${text.slice(0, 40)}${text.length > 40 ? "…" : ""}“` : ""
    }`;
  };

  const overflowX = (element: Element) =>
    getComputedStyle(element).overflowX || "visible";

  /** Liegt das Element in einem Kasten, der seitlich scrollen darf? */
  const inScroller = (element: Element): boolean => {
    for (
      let node = element.parentElement;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      if (/(auto|scroll)/.test(overflowX(node))) return true;
    }
    return false;
  };

  const viewport = window.innerWidth;
  const outside: Finding[] = [];
  const painted: Finding[] = [];
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    const box = element.getBoundingClientRect();
    // sr-only-Hilfen (1 × 1 px, geclippt) und Dekoration ohne Fläche.
    if (box.width < 3 || box.height < 3) continue;
    // SVG-Inhalt wird vom SVG-Viewport beschnitten; gemessen wird das SVG.
    if (element.closest("svg")) continue;
    if (inScroller(element)) continue;

    if (box.right > viewport + 1 || box.left < -1) {
      outside.push({
        label: describe(element),
        detail: `${box.left.toFixed(1)} … ${box.right.toFixed(1)} px bei ${viewport} px`,
      });
      continue;
    }
    // Eigene Box überschrieben? Nur bei sichtbarem Überlauf (bei
    // hidden/clip/auto übernimmt der Kasten selbst die Kontrolle).
    if (
      overflowX(element) === "visible" &&
      element.scrollWidth > element.clientWidth + 1
    ) {
      painted.push({
        label: describe(element),
        detail: `Inhalt ${element.scrollWidth} px in ${element.clientWidth} px`,
      });
    }
  }

  // Bewusst scrollbare Kästen (Gegenprobe: sie sollen die Ausnahme bleiben).
  const scrollers: Finding[] = [];
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (!/(auto|scroll)/.test(overflowX(element))) continue;
    if (element.scrollWidth <= element.clientWidth + 1) continue;
    scrollers.push({
      label: describe(element),
      detail: `${element.scrollWidth} px in ${element.clientWidth} px`,
    });
  }

  return {
    docOverflow: document.documentElement.scrollWidth - viewport,
    outside: outside.slice(0, 25),
    painted: painted.slice(0, 25),
    scrollers: scrollers.slice(0, 25),
  };
};

async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(MEASURE);
}

/** Wartet, bis die Bereichs-Skelette weg sind (Daten sind da). */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, {
    timeout: 30_000,
  });
  // Lazy-Chunks und Nachmessungen (z. B. der Streifen) dürfen noch landen.
  await page.waitForTimeout(300);
}

/** Ein Zustand der Oberfläche: Bereich plus optionaler Aufbau davor. */
async function check(page: Page, state: string): Promise<Measurement> {
  const result = await measure(page);
  const line = (result: Measurement) =>
    JSON.stringify(
      {
        docOverflow: result.docOverflow,
        outside: result.outside.map((f) => `${f.label} — ${f.detail}`),
        painted: result.painted.map((f) => `${f.label} — ${f.detail}`),
        scrollers: result.scrollers.map((f) => `${f.label} — ${f.detail}`),
      },
      null,
      1,
    );
  console.log(`[mobil] ${state}: ${line(result)}`);
  expect(
    result.docOverflow,
    `Das Dokument scrollt seitlich (${state}):\n${line(result)}`,
  ).toBeLessThanOrEqual(1);
  expect(
    result.outside,
    `Ragt aus dem Bild (${state}):\n${line(result)}`,
  ).toEqual([]);
  expect(
    result.painted,
    `Malt über die eigene Box (${state}):\n${line(result)}`,
  ).toEqual([]);
  return result;
}

/**
 * Zwei echte Belege über die API des Demo-Servers (dieselbe Route, die die
 * „Beleg buchen“-Maske benutzt). Feste IDs machen den Aufbau idempotent —
 * ein zweiter Lauf derselben Suite legt nichts doppelt an.
 */
async function seedReceipts(page: Page): Promise<void> {
  const response = await page.request.get("/api/v1/stations");
  const data = (await response.json()) as {
    stations?: Array<{ station_id: string; name: string; fuel: string }>;
  };
  const stations = (data.stations ?? []).slice(0, 2);
  for (const [index, station] of stations.entries()) {
    await page.request.post("/api/v1/fills", {
      data: {
        id: `e2e-mobil-beleg-${index}`,
        station_id: station.station_id,
        station_name: station.name,
        liters: 38.4 + index,
        price_paid: 1.729,
        fuel: "e10",
        source: "e2e-mobil",
        tanked_at: "2026-09-14T17:30:00+02:00",
      },
    });
  }
}

const AREAS = [
  { id: "jetzt", label: "Jetzt" },
  { id: "stations", label: "Stationen" },
  { id: "week", label: "Woche" },
  { id: "ich", label: "Ich" },
  { id: "labor", label: "Labor" },
  { id: "system", label: "System" },
] as const;

const ICH_TABS = ["Fahrzeug", "Belege", "Bilanz", "Einstellungen"];
const LAB_SECTIONS = [
  "prognose",
  "sicherheit",
  "stationen",
  "lernen",
  "spielplatz",
  "glossar",
];

test.describe("Mobil: kein Querlauf", () => {
  test.beforeEach(async ({ viewport }) => {
    test.skip(
      (viewport?.width ?? 0) > 640,
      "Die Suite prüft das schmale Raster (Mobil-Viewport).",
    );
  });

  for (const area of AREAS) {
    test(`${area.label}: Dokument, Ränder und Boxen bleiben im Bild`, async ({
      page,
    }) => {
      await page.goto(`/?tab=${area.id}`);
      await settled(page);
      await check(page, area.label);
    });
  }

  test("Ich: alle vier Unterseiten mit Belegen tragen ohne Querlauf", async ({
    page,
  }) => {
    await seedReceipts(page);
    await page.goto("/?tab=ich");
    await settled(page);
    for (const tab of ICH_TABS) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await settled(page);
      // Die Belegliste ist der Prüfgegenstand — sie muss stehen. Der
      // Stationsname steckt auch in der (verdeckten) Auswahlliste des
      // Fahrzeug-Reiters, deshalb ausdrücklich auf Sichtbares eingrenzen.
      if (tab === "Belege") {
        await expect(
          page
            .getByText("Demo-Tank", { exact: false })
            .filter({ visible: true })
            .first(),
        ).toBeVisible();
      }
      await check(page, `Ich → ${tab}`);
    }
  });

  test("Labor: alle sechs Abschnitte tragen ohne Querlauf", async ({ page }) => {
    for (const section of LAB_SECTIONS) {
      await page.goto(`/?tab=labor&section=${section}`);
      await settled(page);
      await check(page, `Labor → ${section}`);
    }
  });

  test("Dialoge bleiben im Bild", async ({ page }) => {
    for (const area of ["jetzt", "system"] as const) {
      await page.goto(`/?tab=${area}`);
      await settled(page);
      const openers = page.locator('button[aria-haspopup="dialog"]');
      const count = Math.min(await openers.count(), 6);
      for (let index = 0; index < count; index += 1) {
        const opener = openers.nth(index);
        if (!(await opener.isVisible().catch(() => false))) continue;
        await opener.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await check(page, `${area} → Dialog ${index + 1}`);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      }
    }
  });

  test("bewusst scrollbare Kästen bleiben die kurze, benannte Ausnahme", async ({
    page,
  }) => {
    const seen = new Set<string>();
    const collect = (state: string, result: Measurement) => {
      for (const finding of result.scrollers) {
        seen.add(`${state}: ${finding.label} (${finding.detail})`);
      }
    };
    for (const area of AREAS) {
      await page.goto(`/?tab=${area.id}`);
      await settled(page);
      collect(area.label, await measure(page));
    }
    for (const section of LAB_SECTIONS) {
      await page.goto(`/?tab=labor&section=${section}`);
      await settled(page);
      collect(`Labor → ${section}`, await measure(page));
    }
    const list = [...seen].sort();
    console.log("[mobil] scrollbare Kästen:", JSON.stringify(list, null, 1));

    // Erlaubt ist nur die Heatmap-Matrix (Wochentage × 24 Stunden — eine
    // Matrix lässt sich nicht stapeln; sie trägt ihren Hinweis im Text).
    // Alles andere wäre ein Querlauf: Kopfzeilen-Steuerung, Belegliste,
    // Zwilling-Tabelle und JSON-/Log-Blöcke sind umgebaut bzw. umbrechend.
    const allowed = [/TagMedian|Heatmap|heatmap/];
    const unexpected = list.filter(
      (entry) => !allowed.some((pattern) => pattern.test(entry)),
    );
    expect(
      unexpected,
      `Neue seitliche Scroll-Kästen:\n${unexpected.join("\n")}`,
    ).toEqual([]);
  });
});
