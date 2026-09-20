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
// B4 (Befund UX/Mathe 2026-09-19): Die Hauptnavigation ist 3+1 — die
// Studio-Bereiche (Labor, Ich, System, Glossar) liegen hinter dem
// „Mehr“-Blatt. Die URL-Kennungen sind weiter gültig (`?tab=labor` usw.),
// und die Ratchets unten halten das: `expectArea` beweist pro Bereich den
// Landing-Ort (Leiste + Überschrift), der Scrolltiefe-Test die Verdichtung
// des Entscheidungsbildschirms (≤ 1,5 Viewports), und der Verdichtungs-
// Test zusätzlich, dass der Tagesstreifen default-eingeklappt ist.
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
// `heading` (nur Studio-Bereiche): B4 (Befund UX/Mathe 2026-09-19) hat die
// Studio-Bereiche hinter das „Mehr“-Blatt gelegt — in der Bottom-Leiste
// trägt dann der „Mehr“-Eintrag `aria-current`, nicht der Bereich selbst.
// Zwei Studio-Bereiche wären beide hinter „Mehr“; der Ratchet prüft daher
// zusätzlich die Bereichs-Überschrift, damit ein schweigsamer Fallback
// (z. B. labor → ich) weiter rot wird.
const AREAS = [
  { id: "jetzt", label: "Jetzt" },
  { id: "stationen", label: "Stationen" },
  { id: "woche", label: "Woche" },
  { id: "ich", label: "Ich", heading: "Ich" },
  { id: "labor", label: "Labor", heading: "Verstehen, warum die App das sagt" },
  { id: "system", label: "System", heading: "Einmal einrichten. Weiterlaufen lassen." },
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
 * fatal: Sie meldet grün, ohne den Bereich je gesehen zu haben.
 *
 * Hauptbereiche (B4, Befund UX/Mathe 2026-09-19): Der Beleg ist die
 * Bottom-Leiste — genau ein Knopf trägt `aria-current="page"`, und das muss
 * der gemeinte sein.
 *
 * Studio-Bereiche (B4): Sie liegen hinter dem „Mehr“-Blatt, in der Leiste
 * trägt der „Mehr“-Eintrag `aria-current`. Das genügt allein nicht, weil
 * alle vier Studio-Bereiche denselben Eintrag markieren — der Beleg ist
 * deshalb zusätzlich die Bereichs-Überschrift im Inhalt.
 */
async function expectArea(
  page: Page,
  area: (typeof AREAS)[number],
): Promise<void> {
  if (area.heading) {
    const more = page.getByRole("button", { name: "Mehr", exact: true });
    await expect(
      more,
      `Im Studio-Bereich „${area.label}“ fehlt der aktive „Mehr“-Eintrag.`,
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: area.heading, exact: true }),
      `Nicht im Studio-Bereich „${area.label}“ gelandet — zeigt die ` +
        `URL-Kennung auf einen anderen Bereich? (routing.ts nutzt ` +
        `alltagsdeutsche Kennungen.)`,
    ).toBeVisible();
    return;
  }
  await expect(
    page.locator(`nav [aria-current="page"]`).first(),
    `Nicht im Bereich „${area.label}“ gelandet — zeigt die URL-Kennung auf ` +
      `einen anderen Bereich? (routing.ts nutzt alltagsdeutsche Kennungen.)`,
  ).toHaveText(area.label);
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
      await expectArea(page, area);
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
    // B4 (Befund UX/Mathe 2026-09-19, §1.4.1): Der Tagesstreifen ist die
    // einzige Visualisierung des Bildschirms und standardmäßig
    // eingeklappt — „die Entscheidung braucht ihn nicht“. Der Ratchet
    // hält genau das: Auslöser sichtbar, Profilsatz nicht gemalt.
    const strip = page.locator("#jetzt-daystrip");
    await expect(strip.locator("summary")).toBeVisible();
    await expect(strip.locator(".daystrip-cells")).toBeHidden();
  });

  test("Jetzt: Scrolltiefe ≤ 1,5 Viewports (B4-Ratchet)", async ({
    page,
  }, testInfo) => {
    // UX-KPI aus dem Befund (§1.7, übernommen aus UI-NEUENTWURF §15):
    // „Scrolltiefe ‚Jetzt‘ ≤ 1,5 Viewports mobil“. Gemessen wird der
    // Entscheidungsbildschirm selbst — die `section` vom „Jetzt“-H1 bis zur
    // Frische-Fußzeile — gegen das Viewport (844 px im Mobile-Projekt).
    //
    // Warum die Section und nicht das ganze Dokument: Die globale Kopfzeile
    // (mobil 3 Steuerreihen) und der globale Fuß sind Shell — die
    // Einzeilen-Kopfzeile ist ausweislich des Befund-Wireframes
    // „C13-Folge“ (LUECKEN: bewusst offener Arbeitspunkt C13) und gehört
    // nicht zu B4. B4 ist parallel zu B2/B3 angelegt und darf an keinen
    // späteren Batch koppeln; der Ratchet hält deshalb genau das, wofür
    // B4 zeichnet: den Entscheidungsbildschirm. Die Dokumenttiefe wird
    // weiterhin geloggt — ab C13 darf dieser Test auf die
    // Dokument-Scrollhöhe verschärft werden.
    //
    // Gemessen wird bei der Wireframe-Entwurfsbreite (Befund §1.4:
    // „390 px gedacht“), nicht im `narrow`-Projekt: 320 px ist die
    // Störbreite der Überlauf-Prüfung (0.55.2), dort wird dasselbe Layout
    // naturgemäß um Zeilenumbrüche tiefer.
    test.skip(
      testInfo.project.name !== "mobile",
      "Die KPI gilt bei der Entwurfsbreite 390 px (mobile-Projekt).",
    );
    await page.goto("/");
    await settled(page);
    await expectArea(page, AREAS[0]);
    const { depth, docDepth, promptPx } = await page.evaluate(() => {
      const section = document.querySelector(
        'section[aria-labelledby="jetzt-title"]',
      );
      // Das Fensterende-Feedback („Gerade getankt?“) ist transientes
      // Episoden-UI: Es erscheint, bis der Beleg gebucht oder verworfen
      // ist, und ist Teil keiner festen Ansicht — die Messung des
      // Entscheidungsbildschirms zählt es deshalb nicht mit.
      const prompt = section
        ? section.querySelector(
            '[aria-label="Rückmeldung nach Fensterende"]',
          )
        : null;
      const promptH = prompt
        ? prompt.getBoundingClientRect().height + 16 // + `mb-4`
        : 0;
      const h = section
        ? section.getBoundingClientRect().height - promptH
        : Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
          );
      return {
        depth: h / window.innerHeight,
        docDepth:
          Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
          ) / window.innerHeight,
        promptPx: Math.round(promptH),
      };
    });
    console.log(
      `[mobil] Jetzt-Scrolltiefe: ${depth.toFixed(2)} Viewports (Dokument: ${docDepth.toFixed(
        2,
      )}, Fensterende-Feedback: ${promptPx} px)`,
    );
    expect(
      depth,
      `„Jetzt“ scrollt tiefer als 1,5 Viewports (gemessen ${depth.toFixed(
        2,
      )}). Der Entscheidungsbildschirm trägt zu viel: Entscheidung, ` +
        `Fakten, Streifen und Rückmeldung dürfen nicht alle vier auf ` +
        `einem Scroll stehen (Befund §1.2: „1 + 3 + 1“).`,
    ).toBeLessThanOrEqual(1.5 + 1e-6);
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
      // die kurzen Demo-Namen und ist wertlos. Seit B4 zeigt „Jetzt“ keine
      // Stationsliste mehr (die lebt in „Stationen“): Hier muss ein langer
      // Name sichtbar sein (Fakt „Jetzt hier“ oder Umweg-Zeile), in
      // „Stationen“ steht er in der vollständigen Liste — LONG[0]
      // garantiert, weil die Umleitung die JSON-Reihenfolge abbildet.
      if (area === "stationen") {
        await expect(
          page.getByText(LONG[0].slice(0, 28), { exact: false }).first(),
          "Kein langer Stationsname in „Stationen“ — greift die Umleitung?",
        ).toBeVisible();
      } else {
        const found = await Promise.all(
          LONG.map(
            async (name) =>
              (await page
                .getByText(name.slice(0, 28), { exact: false })
                .count()) > 0,
          ),
        );
        expect(
          found.some(Boolean),
          `Kein langer Stationsname in „${area}“ — greift die Umleitung?`,
        ).toBeTruthy();
      }
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

  test("Labor: lange Bezeichner umbrechen in der Parameterkarte", async ({ page }) => {
    await page.goto("/?tab=labor&subtab=modell");
    await settled(page);
    const sentence = page
      .locator("#karte-8-regime")
      .getByText(/^Deklarierte Regime-Kanten/);
    await expect(sentence).toBeVisible();
    // Auch mit schmaleren CI-Schriften erzwingt der ungetrennte Bezeichner
    // einen Umbruch. Der echte Kartentext bleibt vollständig erhalten.
    const identifier = "RegimeProvenienzOhneTrennzeichen".repeat(4);
    await sentence.evaluate((element, value) => element.append(` ${value}`), identifier);
    await expect(sentence).toContainText(identifier);
    await expect(sentence).toHaveCSS("overflow-x", "visible");
    await check(page, "Labor → Regime-Karte mit langem Bezeichner");
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
