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

  /**
   * Liegt das Element in einem Kasten, der es **abschneidet**? Dann ist es
   * kein Fund: Die Kartenkacheln von Leaflet liegen bauartbedingt weit
   * außerhalb des Rahmens und werden vom `overflow: hidden` des Containers
   * beschnitten — sichtbar ist nur der Ausschnitt. Ohne diese Ausnahme
   * meldet die Messung Kacheln bei „−180 … 76 px“ als „ragt aus dem Bild“,
   * obwohl kein Pixel davon je gemalt wird (0.55.0).
   */
  const inClipper = (element: Element): boolean => {
    for (
      let node = element.parentElement;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      if (/(hidden|clip|auto|scroll)/.test(overflowX(node))) return true;
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

    if ((box.right > viewport + 1 || box.left < -1) && !inClipper(element)) {
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
async function seedReceipts(page: Page): Promise<string> {
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
  // Der Name des zuerst angelegten Belegs: der Test sucht genau ihn in der
  // Liste — kein Literal aus den Demo-Daten, der Aufbau liefert ihn selbst.
  return stations[0]?.name ?? "";
}

// Die URL-Kennungen sind **alltagsdeutsch** (`routing.ts`: `stationen`,
// `woche`) — nicht die internen `TabId`s (`stations`, `week`). Bis 0.55.0
// stand hier die interne Schreibweise: `tabFromUrlId` kennt sie nicht und
// liefert stillschweigend „Jetzt“. Die Suite maß deshalb zweimal den
// Einstieg und nie „Stationen“ oder „Woche“ — genau dort lag der Querlauf,
// den der Pixel-9-Check fand. `expectArea` unten verhindert die Wiederkehr.
const AREAS = [
  { id: "jetzt", label: "Jetzt" },
  { id: "stationen", label: "Stationen" },
  { id: "woche", label: "Woche" },
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

/**
 * Zusage, dass wirklich der gemeinte Bereich gemessen wird.
 *
 * `tabFromUrlId` fällt bei unbekannten Werten still auf „Jetzt“ zurück — für
 * die App richtig (ein kaputter Link zeigt den Einstieg), für eine Messung
 * fatal: Sie meldet grün, ohne den Bereich je gesehen zu haben. Der Beleg
 * ist die Bereichs-Navigation selbst: genau ein Knopf trägt
 * `aria-current="page"`, und das muss der gemeinte sein.
 */
async function expectArea(page: Page, label: string): Promise<void> {
  await expect(
    page.locator(`nav [aria-current="page"]`).first(),
    `Nicht im Bereich „${label}“ gelandet — zeigt die URL-Kennung auf einen ` +
      `anderen Bereich? (routing.ts nutzt alltagsdeutsche Kennungen.)`,
  ).toHaveText(label);
}

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
      await expectArea(page, area.label);
      await check(page, area.label);
    });
  }

  test("Jetzt: die Verdichtung ist aktiv — kein Zurück zur langen Fassung", async ({
    page,
  }) => {
    // Nutzer-Feedback 18.09.2026: „Zu lang auf mobil“. Der Einstieg maß auf
    // 390 × 844 2 530 px gegen 1 223 px des Entwurfs
    // (`ui-neuentwurf-mockup`) — die drei Fakten standen als drei Karten
    // (409 px), die drei Kennzahlen von „Heute im Blick“ als drei Kacheln
    // (260 px statt 88 px). Beides ist seit 0.53.0 verdichtet. Geprüft wird
    // die Struktur, nicht eine Pixelzahl: dieselben drei Fakten in EINER
    // Reihe, die Kennzahlen als sichtbare Zeilenliste, die Desktop-Karten
    // ausgeblendet (keine doppelte Anzeige).
    await page.goto("/");
    await settled(page);
    const labels = ["Jetzt hier", "Bestes Fenster heute", "Tank reicht?"];
    const tops: number[] = [];
    for (const label of labels) {
      const el = page.getByText(label, { exact: true }).first();
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box, `Keine Box für „${label}“`).not.toBeNull();
      tops.push(Math.round(box!.y));
    }
    // Fakt 1 und 2 teilen sich die erste Reihe; der Tank-Fakt steht darunter
    // über die volle Breite (seine Schnellauswahl bräuchte in einer halben
    // Spalte fünf Zeilen). Die Zusage ist deshalb: höchstens ZWEI kompakte
    // Reihen — die drei gestapelten Karten von vorher lagen bei je ~110 px
    // plus Abständen, also deutlich darüber.
    expect(
      Math.abs(tops[0] - tops[1]),
      `„${labels[0]}“ und „${labels[1]}“ stehen nicht in einer Reihe: ${tops.join(", ")}`,
    ).toBeLessThan(4);
    expect(
      tops[2] - tops[0],
      `Die Fakten brauchen mehr als zwei Reihen: ${tops.join(", ")}`,
    ).toBeLessThan(140);

    // Kennzahlen: die Zeilenliste ist da, die drei Desktop-Karten nicht.
    await expect(page.locator("dt", { hasText: "Tagesmedian" })).toBeVisible();
    await expect(
      page.locator('p:has-text("Günstigste Stunde")').first(),
    ).toBeHidden();
  });

  test("Echte Stationsnamen sprengen kein Raster (Pixel 9, 0.55.0)", async ({
    page,
  }) => {
    // Nutzer-Feedback 18.09.2026: „Die Anzeige der 3 Stationen auf Jetzt sind
    // zu breit und ragen aus dem Bild.“ Der Demo-Stack heißt „Demo-Tank Nord“
    // (14 Zeichen) — der echte MTS-K-Bestand trägt Namen wie „Aral Tankstelle
    // Frankfurt am Main Hanauer Landstraße 128“ (56 Zeichen). Die Suite maß
    // deshalb nur kurze Namen und blieb grün, während die Liste bei echten
    // Daten 496 px in einer 330-px-Karte belegte.
    //
    // Ursache war nicht die Länge, sondern `grid` **ohne** Spaltenangabe: Die
    // implizite Spur ist `auto` und wächst auf den breitesten Eintrag, statt
    // sich an die Karte zu binden — `truncate` bekam nie etwas zu kürzen.
    // Der Test hängt lange Namen in jede Server-Antwort und misst erneut.
    const LONG = [
      "Aral Tankstelle Frankfurt am Main Hanauer Landstraße 128",
      "ESSO STATION FRANKFURT MAIN FRIEDBERGER LANDSTR. 244",
      "Shell Frankfurt Am Main Eschersheimer Landstrasse 297",
      "TotalEnergies Frankfurt Am Main Mainzer Landstraße 251",
      "JET FRANKFURT AM MAIN OFFENBACHER LANDSTRASSE 366",
      "Supermarkt-Tankstelle am real Frankfurt Borsigallee 26",
    ];
    await page.route("**/api/v1/**", async (route) => {
      const response = await route.fetch();
      const type = response.headers()["content-type"] ?? "";
      if (!type.includes("json")) return route.fulfill({ response });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return route.fulfill({ response });
      }
      // Jeder echte Stationsname wird stabil auf einen langen abgebildet —
      // gleiche Station, gleicher Ersatz, damit Ranking und Karte zusammen
      // passen.
      const seen = new Map<string, string>();
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== "object") return;
        for (const [key, value] of Object.entries(node)) {
          if (
            (key === "name" || key === "station_name") &&
            typeof value === "string" &&
            value !== ""
          ) {
            if (!seen.has(value)) {
              seen.set(value, LONG[seen.size % LONG.length]);
            }
            (node as Record<string, unknown>)[key] = seen.get(value);
          } else walk(value);
        }
      };
      walk(body);
      return route.fulfill({ response, body: JSON.stringify(body) });
    });

    for (const area of ["jetzt", "stationen"] as const) {
      await page.goto(`/?tab=${area}`);
      await settled(page);
      // Der lange Name ist wirklich in der Ansicht — sonst misst der Test
      // die kurzen Demo-Namen und ist wertlos.
      await expect(
        page.getByText(LONG[0].slice(0, 28), { exact: false }).first(),
        `Kein langer Stationsname in „${area}“ — greift die Umleitung?`,
      ).toBeVisible();
      await check(page, `${area} mit echten Stationsnamen`);
    }
  });

  test("Ich: alle vier Unterseiten mit Belegen tragen ohne Querlauf", async ({
    page,
  }) => {
    const stationName = await seedReceipts(page);
    expect(stationName, "Keine Station für die Belege geliefert.").not.toBe("");
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
            .getByText(stationName, { exact: false })
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
