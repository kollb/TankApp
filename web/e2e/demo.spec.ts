import { test, expect, type Response } from "@playwright/test";

// E2E **ohne Mocks** gegen den Demo-Stack (`ops/quality/demo_server.py`).
//
// Diese Datei enthält bewusst kein `page.route`: Sie beweist die Integration
// Server ↔ GUI, nicht das Rendering von Attrappen. Genau diese Lücke nannte
// docs/planung/LUECKEN.md als Grund, warum B1 (NaN brach `/last_forecasts`), B3 (UTC
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

/** Wieviele Zellen des Tagesstreifens jetzt bepreist sein MÜSSEN.
 *
 * Seit 0.49.3 zählt nur der Berliner Kalendertag (kein rollierendes
 * 24-h-Fenster, in dem gestrige Abendstunden als „heute" standen). Die
 * Demo-Stationen sind 06–22 Uhr offen: morgens sind unmittelbar nach
 * Öffnung legitimerweise nur wenige Zellen befüllt — die Zahl ist eine
 * Funktion der Uhrzeit, nicht eine Konstante. Eine Takt-Kante darf eine
 * Stunde kosten, deshalb lassen die Tests eine Stunde Toleranz zu. */
function expectedPricedCells(date = new Date()): number {
  const hour = berlinHour(date);
  if (hour < 6) return 0;
  if (hour > 22) return 17;
  return hour - 5;
}

test("overview → „Jetzt“ mit echten Zahlen", async ({ page }) => {
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
  //    Zweig „Günstigste gerade: …“ (§0.4 — keine erfundene Empfehlung).
  //    UX-NEUENTWURF §3: die Antwort ist EINE Zeile aus einer festen Liste
  //    von fünf Ausgängen — kein sechster Wortlaut.
  const headline = page.locator("#jetzt-headline");
  await expect(headline).toBeVisible();
  await expect(headline).toHaveText(
    /^(Günstigste gerade|Warten bis|Jetzt tanken|Tanken, wann’s passt|Letzter Stand)/,
  );
  const cardPrice = page.getByText(/^\d,\d{3} €\/L$/).first();
  await expect(cardPrice).toBeVisible();

  // ③ Die Tageszeile (Mini-Kurve + Tief) ist der einzige Weg in die Tiefe —
  //    das 19-Zellen-Raster von „Heute im Blick“ ist mit 0.73.0 gestrichen.
  //    Vor sechs Uhr gibt es noch keine bepreiste Stunde: dann fehlt die
  //    Zeile, statt eine Kurve zu erfinden (`now.ts`, §8).
  const row = page.locator("#jetzt-tagzeile");
  if (expectedPricedCells() > 0) {
    await expect(row).toBeVisible();
    await expect(row).toContainText("Heute:");
  } else {
    await expect(row).toHaveCount(0);
  }
  await expect(
    page.getByRole("heading", { name: "Heute im Blick" }),
    "„Heute im Blick“ ist zurück — §7 hat es gestrichen.",
  ).toHaveCount(0);
  await expect(
    page.locator(".daystrip-cells"),
    "Das 19-Zellen-Raster ist zurück.",
  ).toHaveCount(0);

  // ④ Die Kurve hat eine Textalternative (M8: kein Bild ohne Text) — das
  //    Blatt ist zu, bis jemand tippt.
  if (expectedPricedCells() > 0) {
    const curve = row.locator("[role=img]").first();
    const label = await curve.getAttribute("aria-label");
    expect(label ?? "", "Die Tageskurve ist nicht beschriftet.").toMatch(
      /^Tagesverlauf 06–24 Uhr — /,
    );
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// UX-NEUENTWURF §9 (Abnahme): „Details ein Tipp entfernt.“ Wo bis 0.72.2 der
// Tagesstreifen mit 19 Zellen stand (Befund U2: „1,725“ lief in die
// Nachbarzelle), steht heute eine Zeile mit Mini-Kurve; die große Kurve liegt
// im Blatt dahinter. Geprüft wird, dass beides bei 390 px im Bild bleibt.
test("U2: Die Tageszeile bleibt bei 390 px lesbar", async ({ page }) => {
  await page.goto("/");
  const row = page.locator("#jetzt-tagzeile");
  await expect(row).toBeVisible();

  // Die Zeile selbst: sie bleibt in der Viewport-Breite, nichts ragt
  // seitlich heraus (U2: „1,725“ lief in die Nachbarzelle).
  const box = await row.boundingBox();
  expect(box, "Keine Box für die Tageszeile.").not.toBeNull();
  const viewportWidth = page.viewportSize()?.width ?? 390;
  expect(box!.width).toBeLessThanOrEqual(viewportWidth);
  const rowOverflow = await row.evaluate(
    (node) => node.scrollWidth - node.clientWidth,
  );
  expect(rowOverflow, "Die Tageszeile läuft seitlich über.").toBeLessThanOrEqual(1);

  // Ein Tipp öffnet die große Kurve — beschriftet und ohne Querlauf.
  await row.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const curve = dialog.locator("[role=img]").first();
  await expect(curve).toBeVisible();
  const label = await curve.getAttribute("aria-label");
  expect(label ?? "", "Die Tageskurve im Blatt ist nicht beschriftet.").toMatch(
    /^Tagesverlauf 06–24 Uhr — /,
  );
  const dialogOverflow = await dialog.evaluate(
    (node) => node.scrollWidth - node.clientWidth,
  );
  expect(dialogOverflow, "Das Tagesblatt läuft seitlich über.").toBeLessThanOrEqual(1);
  // Das Tief ist beziffert, nicht nur gemalt (§8: keine Farbe allein) —
  // mit Uhrzeit und Preis im Satz, nicht als Farbe in der Kurve.
  await expect(
    dialog.getByText(/^Tiefster Preis heute ~/),
  ).toBeVisible();
  // Und als bezifferte Zeile im Kurzblock (Wert, nicht nur Farbe).
  await expect(
    dialog.locator("dt", { hasText: "Tiefster Preis" }),
  ).toBeVisible();
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
  expect(
    responses[0].headers()["etag"],
    "der Demo-Server liefert kein ETag",
  ).toBeTruthy();

  // B7 ohne Mock: „Daten aktualisieren“ lädt dieselbe Ansicht neu — die GUI
  // schickt dabei das ETag mit (`If-None-Match`), der Server antwortet mit
  // 304 ohne Body. Ein bestätigender Aufruf schreibt den Ledger nicht neu,
  // das ETag der letzten Antwort bleibt also gültig. Nur das 60-s-Uhrzeit-
  // Fenster kann dazwischenfunken: fällt der Refresh genau auf dessen Grenze,
  // antwortet der Server korrekt mit 200 — deshalb bis zu fünf Versuche, aber
  // die Zusage „304“ muss fallen. (Fünf statt drei: Auf langsamen Läufern
  // dauert ein Versuch länger, die Trefferfläche der Fenstergrenze wächst.)
  // Unter 1280 px liegt Aktualisieren im kompakten Profil-und-Aktionen-Blatt.
  if ((page.viewportSize()?.width ?? 1440) < 1280) {
    await page.getByRole("button", { name: "Fahrzeug-Profil und Aktionen" }).click();
  }
  const button = page.getByRole("button", { name: "Daten aktualisieren" });
  await expect(button).toBeVisible();
  let revalidated = false;
  let carriedEtag = false;
  for (let attempt = 0; attempt < 5 && !revalidated; attempt += 1) {
    await expect(button).toBeEnabled();
    const before = responses.length;
    // Der Stand, den die App hält: das ETag der letzten Antwort. Genau das
    // muss die nächste Anfrage mitschicken — nach einem 304 bleibt es gleich.
    const held = responses[before - 1].headers()["etag"];
    await button.click();
    await expect
      .poll(() => responses.length, { timeout: 30_000 })
      .toBeGreaterThan(before);
    const answer = responses[before];
    expect(
      answer.request().headers()["if-none-match"] ??
        answer.request().headers()["If-None-Match"],
    ).toBe(held);
    carriedEtag = true;
    revalidated = answer.status() === 304;
  }
  expect(carriedEtag).toBe(true);
  expect(revalidated, "kein 304 nach fünf Aktualisierungen").toBe(true);
  // Ein 304 ersetzt die Anzeige nicht durch einen Leerzustand.
  await expect(page.locator("#jetzt-headline")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// O17: Gebucht wird der Preis an der Säule — nie ein Prognose-Median.
//
// Der Ein-Tipp-Beleg des Fällig-Prompts („Ja, wie empfohlen“) ist mit 0.73.0
// ersatzlos gestrichen (Entscheidung 04.10.2026). Die Zusage bleibt, nur ihr
// Ort wechselt: Bestätigt wird dort, wo Belege gepflegt werden — „Ich →
// Belege → Tanken erfassen“. Geprüft wird am echten Demo-Server, dass der
// eingetragene Preis unverändert im Beleg landet (`price_source:
// „manuell“`) und keine Prognose ihn ersetzt.
test("O17: der Beleg trägt den eingetragenen Preis, nie die Prognose", async ({
  page,
}) => {
  await page.goto("/?tab=ich");
  await page.getByRole("tab", { name: "Belege", exact: true }).click();
  const form = page.getByRole("region", { name: "Tanken erfassen" });
  await form.getByRole("textbox").nth(0).fill("37.5");
  await form.getByRole("textbox").nth(1).fill("1.777");

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/fills") && res.request().method() === "POST",
    ),
    form.getByRole("button", { name: "Beleg buchen", exact: true }).click(),
  ]);
  expect(response.ok(), "POST /api/v1/fills wird angenommen").toBe(true);
  const body = response.request().postDataJSON();
  expect(body.liters).toBeCloseTo(37.5, 3);
  expect(body.price_paid).toBeCloseTo(1.777, 3);
  // Aus der Maske kommt ein eingetragener Preis — nie „live“, nie Prognose.
  expect(body.price_source).toBe("manuell");
  expect(body.source).toBe("manual");

  // Der gespeicherte Beleg trägt denselben Preis (kein Median im Ledger).
  const fills = await page.request.get("/api/v1/fills");
  expect(fills.ok()).toBe(true);
  const stored = (await fills.json()).fills ?? [];
  const mine = stored.find(
    (fill: any) => Math.abs(fill.liters - 37.5) < 0.001 && !fill.voided,
  );
  expect(mine, "gebuchter Beleg steht im Ledger").toBeTruthy();
  expect(mine.price_paid).toBeCloseTo(1.777, 3);
  expect(mine.price_source).toBe("manuell");
});

test("O16: Labor rechnet den Preis-Abstand aus der Selektion", async ({ page }) => {
  // Der δ̂-Beweis wohnt seit Batch 2 in „Stationen“ (eine Zeile im Detail);
  // das Labor nennt die Spanne in seinen Fachwerten. Beide lesen
  // /api/v1/selection — vor 0.46.0 blieb die Angabe dauerhaft leer, weil das
  // Feld im Backtest-Block nie gesendet wurde. Der Demo-Stapel bringt ein
  // echtes Selektions-Artefakt mit.
  await page.goto("/?tab=labor&section=stationen");
  const details = page.locator("#labor-details");
  await expect(details).toBeVisible({ timeout: 30_000 });
  // Die Fachwert-Zeile rendert nur mit geladener Selektion als Zahl.
  await expect(details).toContainText("Preis-Abstand der Stationen", {
    timeout: 30_000,
  });
  await expect(details).toContainText(/ct\/L/, { timeout: 30_000 });

  // Der sichtbare Beleg steht im Stations-Detail (Einordnung): δ̂ zum
  // Stadt-Median derselben Stunde, nie eine erfundene Zahl.
  await page.goto("/?tab=stationen");
  await expect(page.getByText("Preis-Abstand zum Stadt-Median", { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
});
