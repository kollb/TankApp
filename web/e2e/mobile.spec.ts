import { test, expect, type Page } from "@playwright/test";

// Mobil-Robustheit der sechs Bereiche (Nutzer-Feedback 16.09.2026: „TankApp an
// sich ist nicht mobilrobust. Da sind verschiedene Dinge die scrollen müssen
// oder aus dem Bild ragen“).
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
// Zusätzlich hält die letzte Prüfung die Liste der bewusst scrollbaren
// Kästen fest (Kopfzeile, Heatmap-Matrix, JSON-/Log-Blöcke): Ein neuer
// Querlauf kann nicht still dazukommen.

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

  const rect = (element: Element) => element.getBoundingClientRect();
  const viewport = window.innerWidth;

  const outside: Finding[] = [];
  const painted: Finding[] = [];
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    const box = rect(element);
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
    const section = element.closest("section, main, nav, footer, header");
    scrollers.push({
      label: describe(element),
      detail: `${element.scrollWidth} px in ${element.clientWidth} px${
        section ? ` · ${section.getAttribute("aria-label") ?? section.tagName.toLowerCase()}` : ""
      }`,
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

/** Die Befunde als Text — im CI-Log lesbar, ohne DOM-Schnappschuss. */
function report(name: string, result: Measurement) {
  console.log(`[mobil] ${name}:`, JSON.stringify(result, null, 1));
}

const AREAS = [
  { id: "jetzt", label: "Jetzt" },
  { id: "stations", label: "Stationen" },
  { id: "week", label: "Woche" },
  { id: "ich", label: "Ich" },
  { id: "labor", label: "Labor" },
  { id: "system", label: "System" },
] as const;

test.describe("Mobil: kein Querlauf in den sechs Bereichen", () => {
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
      const result = await measure(page);
      report(area.label, result);

      expect(
        result.docOverflow,
        `Das Dokument scrollt seitlich (${area.label}):\n${result.outside
          .map((finding) => ` · ${finding.label} — ${finding.detail}`)
          .join("\n")}`,
      ).toBeLessThanOrEqual(1);
      expect(
        result.outside,
        `Ragt aus dem Bild (${area.label}):\n${JSON.stringify(result.outside, null, 1)}`,
      ).toEqual([]);
      expect(
        result.painted,
        `Malt über die eigene Box (${area.label}):\n${JSON.stringify(result.painted, null, 1)}`,
      ).toEqual([]);
    });
  }

  test("bewusst scrollbare Kästen bleiben die kurze, benannte Ausnahme", async ({
    page,
  }) => {
    const seen = new Set<string>();
    for (const area of AREAS) {
      await page.goto(`/?tab=${area.id}`);
      await settled(page);
      const result = await measure(page);
      for (const finding of result.scrollers) {
        seen.add(`${area.label}: ${finding.label} (${finding.detail})`);
      }
    }
    const list = [...seen].sort();
    console.log("[mobil] scrollbare Kästen:", JSON.stringify(list, null, 1));

    // Erlaubt sind nur: die Bedienleiste der Kopfzeile (Stadt/Kraftstoff/
    // Profil, eine Zeile, bewusst ziehbar), die Heatmap-Matrix im Labor
    // (19–24 Spalten sind keine Kartenfrage) und JSON-/Log-Ausgaben, die
    // zeilenweise nicht umbrechen dürfen. Alles andere wäre ein Querlauf.
    const allowed = [
      /relative flex min-w-0 items-center gap-2 overflow-x-auto/,
      /Heatmap|heatmap/,
      /ApiExplorer|log|json/i,
    ];
    const unexpected = list.filter(
      (entry) => !allowed.some((pattern) => pattern.test(entry)),
    );
    expect(
      unexpected,
      `Neue seitliche Scroll-Kästen:\n${unexpected.join("\n")}`,
    ).toEqual([]);
  });
});
