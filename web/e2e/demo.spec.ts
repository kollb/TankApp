import { test, expect, type Response } from "@playwright/test";

// E2E **ohne Mocks** gegen den Demo-Stack (`ops/quality/demo_server.py`).
//
// Diese Datei enthält bewusst kein `page.route`: Sie beweist die Integration
// Server ↔ GUI, nicht das Rendering von Attrappen. Genau diese Lücke nannte
// docs/LUECKEN.md als Grund, warum B1 (NaN brach `/last_forecasts`), B3 (UTC
// statt Ortszeit) und der defekte Demo-Stack erst im Sanity-Check auffielen.
//
// Die Server-Verträge (Overview, Tageskurve, ETag/304) prüft zusätzlich
// `tests/test_e2e_demo.py` — dort ohne Browser, hier mit DOM.
//
// Konfiguration: `playwright.demo.config.ts`, Start über
// `npm --prefix web run test:e2e:demo` (braucht `npm run build`).

const DEMO_STATIONS = [
  "Demo-Tank Nord",
  "Demo-Tank Ost",
  "Demo-Tank Süd",
  "Demo-Tank West",
  "Demo-Tank Mitte",
  "Demo-Tank Außen",
];

/** Stunde in Berliner Zeit — die App rechnet in Ortszeit, nicht in UTC. */
function berlinHour(date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      hour12: false,
    }).format(date),
  );
}

test("overview → „Jetzt“ und „Heute im Blick“ mit echten Zahlen", async ({
  page,
}) => {
  const overviewResponses: Response[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/overview")) {
      overviewResponses.push(response);
    }
  });

  await page.goto("/");

  // ① Eine echte Antwort, keine Attrappe: 200 vom Demo-Server.
  await expect
    .poll(() => overviewResponses.length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  expect(overviewResponses.map((response) => response.status())).toContain(200);

  // Kein Fehlerzustand: LoadError/Verbindungsbanner tragen `role="alert"`.
  // (B1 hätte hier gestanden: die Antwort brach mit 400 ab.)
  await expect(page.getByRole("alert")).toHaveCount(0);

  // ② Die Entscheidung zeigt eine echte Station aus dem Demo-Set und einen
  //    Preis im Format 1,725 €/L. Ohne Kalibrierung bleibt es beim grauen
  //    Zweig „Jetzt am günstigsten: …“ (§0.4 — keine erfundene Empfehlung).
  const headline = page.locator("#jetzt-headline");
  await expect(headline).toBeVisible();
  await expect(headline).toContainText("Jetzt am günstigsten: Demo-Tank");
  const cardPrice = page.getByText(/^\d,\d{3} €\/L$/).first();
  await expect(cardPrice).toBeVisible();

  // ③ „Heute im Blick“: 19 Zellen (06–24 Uhr), jede beschriftet — mit Preis
  //    oder als leere Stunde, nie als NaN/„null“.
  await expect(
    page.getByRole("heading", { name: "Heute im Blick" }),
  ).toBeVisible();
  const cells = page.locator(".daystrip-cells [role=img]");
  await expect(cells).toHaveCount(19);
  const labels = await cells.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-label") ?? ""),
  );
  for (const label of labels) {
    expect(label).toMatch(
      /^([0-2]\d):00 — (keine offene Meldung|\d,\d{3} €\/L)$/,
    );
  }
  const prices = labels
    .map((label) => label.match(/(\d),(\d{3}) €\/L$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => Number(`${match[1]}.${match[2]}`));
  expect(prices.length).toBeGreaterThanOrEqual(6);
  // Plausible Demo-Preise — ein NaN oder eine Einheit ohne Umrechnung fiele auf.
  expect(Math.min(...prices)).toBeGreaterThan(1.0);
  expect(Math.max(...prices)).toBeLessThan(3.0);

  // ④ Ortszeit: die als „jetzt“ markierte Zelle trägt die Berliner Stunde.
  //    Eine in UTC geschnittene Kurve (B3-Klasse) steht hier zwei Stunden
  //    daneben. Zwischen 00:00 und 06:00 liegt die Stunde außerhalb des
  //    Streifens — dann gibt es keine markierte Zelle.
  const expectedHour = berlinHour();
  const current = page.locator(".daystrip-cells [role=img].border-emerald-400");
  if (expectedHour >= 6) {
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute(
      "aria-label",
      new RegExp(`^${String(expectedHour).padStart(2, "0")}:00 — `),
    );
  } else {
    // Nachtstunden: keine markierte Zelle (der Streifen beginnt erst 06:00).
    await expect(current).toHaveCount(0);
  }
});

// GUI-UX-BEFUND U2: Der Tagesstreifen darf auf dem Handy nicht brechen.
// Mobil trägt das Raster zwei Zeilen zu je zehn Zellen
// (styles.css `.daystrip-cells`); jede Zelle bleibt breit genug, um den
// Stundenwert zu zeigen. Auf 390 px war der Streifen vorher ein starres
// 19er-Raster mit ~15,7 px je Zelle — faktisch unlesbar.
test("U2: Tagesstreifen bleibt bei 390 px lesbar", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Heute im Blick" }),
  ).toBeVisible();
  const cells = page.locator(".daystrip-cells [role=img]");
  await expect(cells).toHaveCount(19);

  // Die 19 Zellen stehen sofort (leer) im DOM, die Preise kommen erst mit
  // der Overview-Antwort — vor dem Vermessen auf echte Werte warten, sonst
  // misst dieser Test den Ladezustand statt des Streifens.
  await expect
    .poll(
      () =>
        cells
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("aria-label") ?? ""),
          )
          .then(
            (labels) =>
              labels.filter((label) => /\d,\d{3} €\/L$/.test(label)).length,
          ),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(6);

  // DoD: Zellenbreite ≥ 26 px — darunter ist der Stundenwert nicht lesbar.
  const boxes = await cells.evaluateAll((nodes) =>
    nodes.map((node) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        label: element.getAttribute("aria-label") ?? "",
        text: (element.textContent ?? "").trim(),
      };
    }),
  );
  for (const box of boxes) {
    expect(
      box.width,
      `Zelle „${box.label}“ ist nur ${box.width.toFixed(1)} px breit`,
    ).toBeGreaterThanOrEqual(26);
  }

  // DoD: sichtbarer Werttext. Die Demo-Daten haben mehrere offene Stunden —
  // mindestens sechs Zellen zeigen einen Preis, und der Text ist echt
  // gerendert (nicht leer, nicht abgeschnitten versteckt).
  const withPrice = boxes.filter((box) => /\d,\d{3} €\/L$/.test(box.label));
  expect(withPrice.length).toBeGreaterThanOrEqual(6);
  for (const box of withPrice.slice(0, 3)) {
    const cell = cells.filter({ hasText: box.text }).first();
    await expect(cell).toBeVisible();
  }
});

test("„Stationen“ zeigt die Stationen des Demo-Sets", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Stationen", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Stationen", exact: true }),
  ).toBeVisible();
  // Echter Bestand aus `/api/v1/stations` — als Liste, nicht als Leerzustand.
  const visible = page.getByText(DEMO_STATIONS[0], { exact: false });
  await expect(visible.first()).toBeVisible();
  const names = await page
    .locator("text=/Demo-Tank (Nord|Ost|Süd|West|Mitte|Außen)/")
    .allTextContents();
  expect(new Set(names).size).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Revalidierung im Browser: Aktualisieren schickt das ETag mit", async ({
  page,
}) => {
  const responses: Response[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/overview")) {
      responses.push(response);
    }
  });

  await page.goto("/");
  await expect(page.locator("#jetzt-headline")).toBeVisible();
  await expect.poll(() => responses.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const etag = responses[0].headers()["etag"];
  expect(etag, "der Demo-Server liefert kein ETag").toBeTruthy();

  // B7 ohne Mock: „Daten aktualisieren“ lädt dieselbe Ansicht neu — die GUI
  // schickt dabei das ETag mit (`If-None-Match`), der Server antwortet mit
  // 304 ohne Body. Der Datenstand trägt ein 60-s-Uhrzeit-Fenster: fällt der
  // Refresh genau auf dessen Grenze, antwortet der Server korrekt mit 200 —
  // deshalb bis zu drei Versuche, aber die Zusage „304“ muss fallen.
  const button = page.getByRole("button", { name: "Daten aktualisieren" });
  // Ein Layout ohne diesen Knopf (z. B. sehr schmale Ansicht) prüft die
  // Revalidierung in `tests/test_e2e_demo.py` statt hier.
  test.skip(
    !(await button.isVisible().catch(() => false)),
    "Aktualisieren-Knopf in diesem Layout nicht sichtbar",
  );
  let revalidated = false;
  let carriedEtag = false;
  for (let attempt = 0; attempt < 3 && !revalidated; attempt += 1) {
    await expect(button).toBeEnabled();
    const before = responses.length;
    await button.click();
    await expect
      .poll(() => responses.length, { timeout: 30_000 })
      .toBeGreaterThan(before);
    const answer = responses[before];
    expect(answer.request().headers()["if-none-match"] ?? answer.request().headers()["If-None-Match"]).toBe(etag);
    carriedEtag = true;
    revalidated = answer.status() === 304;
  }
  expect(carriedEtag).toBe(true);
  expect(revalidated, "kein 304 nach drei Aktualisierungen").toBe(true);
  // Ein 304 ersetzt die Anzeige nicht durch einen Leerzustand.
  await expect(page.locator("#jetzt-headline")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
