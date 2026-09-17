import { test, expect, type Page, type Response } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
// Mobil trägt das Raster vier Zeilen zu je fünf Zellen (styles.css
// `.daystrip-cells`) — fünf Zeichen „1,725“ brauchen ~36 px, darunter läuft
// die Zahl in die Nachbarzelle. Ursprünglich war der Streifen ein starres
// 19er-Raster mit ~15,7 px je Zelle (faktisch unlesbar), danach ein
// 10er-Raster mit ~27 px — dort ragten die Preise weiter heraus.
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

  // Kein Inhalt ragt aus seiner Zelle: `scrollWidth > clientWidth` heißt,
  // der Preis wird breiter gemalt als die Zelle und überschreibt die
  // Nachbarzelle (genau der Befund „Zahlenreihe ist schief“).
  const overflowing = await cells.evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const element = node as HTMLElement;
        return {
          label: element.getAttribute("aria-label") ?? "",
          scroll: element.scrollWidth,
          client: element.clientWidth,
        };
      })
      .filter((row) => row.scroll > row.client + 1),
  );
  expect(
    overflowing,
    `Zellen mit überlaufendem Inhalt: ${JSON.stringify(overflowing)}`,
  ).toEqual([]);

  // Balkenspur, Stunde und Wert liegen in jeder Zeile auf derselben Höhe:
  // der Balken wächst in einer festen 12-px-Spur von unten, statt Stunden-
  // und Wertzeile je Zelle zu verschieben.
  const geometry = await cells.evaluateAll((nodes) =>
    nodes.map((node) => {
      const element = node as HTMLElement;
      const box = element.getBoundingClientRect();
      // Direkte Kinder: [Balkenspur, Stunde, Wert] — der Balken selbst liegt
      // als Enkel in der Spur.
      const spans = Array.from(element.querySelectorAll(":scope > span"));
      return {
        row: Math.round(box.top),
        height: box.height,
        hourTop: spans[1]?.getBoundingClientRect().top ?? null,
        barBottom: spans[0]?.getBoundingClientRect().bottom ?? null,
      };
    }),
  );
  const rows = [...new Set(geometry.map((cell) => cell.row))];
  expect(rows.length).toBeGreaterThanOrEqual(1);
  for (const row of rows) {
    const inRow = geometry.filter((cell) => cell.row === row);
    const spread = (values: Array<number | null>) => {
      const numbers = values.filter((value): value is number => value !== null);
      return Math.max(...numbers) - Math.min(...numbers);
    };
    expect(
      spread(inRow.map((cell) => cell.height)),
      `Zeile ${row}: Zellen unterschiedlich hoch`,
    ).toBeLessThan(1);
    expect(
      spread(inRow.map((cell) => cell.hourTop)),
      `Zeile ${row}: Stundenzeile steht nicht auf einer Linie`,
    ).toBeLessThan(1);
    expect(
      spread(inRow.map((cell) => cell.barBottom)),
      `Zeile ${row}: Balken sitzen nicht auf derselben Basis`,
    ).toBeLessThan(1);
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
  const button = page.getByRole("button", { name: "Daten aktualisieren" });
  // Ein Layout ohne diesen Knopf (z. B. sehr schmale Ansicht) prüft die
  // Revalidierung in `tests/test_e2e_demo.py` statt hier.
  test.skip(
    !(await button.isVisible().catch(() => false)),
    "Aktualisieren-Knopf in diesem Layout nicht sichtbar",
  );
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

// O17: Der Ein-Tipp-Beleg („Ja, wie empfohlen“) bucht den frischen
// Live-Preis, nie den Prognose-Median — und ohne Live-Preis fragt die
// Maske nach, statt zu buchen. Der Seed liegt direkt im Feedback-Store des
// Demo-Servers (Datei, kein Mock): eine fällige Episode mit einem
// `expected_price`-Köder, der in keinem Request und keinem Beleg auftauchen
// darf. `record_snapshot` (jeder Decide-Aufruf) schreibt nur an die ERSTE
// offene Episode — deshalb steht eine Guard-Episode davor und der Seed
// dahinter bleibt unberührt. Der Demo-Seed ist bewusst dieselbe Episode für
// beide Projekte (update-or-append): Die Zusagen gelten je Anzeige,
// unabhängig davon, welches Projekt den Seed geschrieben hat.
const O17_STORE = fileURLToPath(
  new URL("../../.demo-e2e-data/runtime/feedback/store.json", import.meta.url),
);
const O17_EPISODE_ID = "ep_o17_demo_prompt";
const O17_GUARD_ID = "ep_o17_demo_guard";
const O17_DECOY_PRICE = 1.559;
const O17_KNOWN_STATION = "00000000-0000-0000-0000-0000000000d5";
const O17_KNOWN_NAME = "Demo-Tank Mitte";
const O17_UNKNOWN_STATION = "00000000-0000-0000-0000-00000000cafe";

function o17Snapshot(stationId: string, stationName: string) {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    id: "snap_o17_demo",
    emitted_at: iso(now - 3 * 3600_000),
    clock_hour: berlinHour(new Date(now - 3 * 3600_000)),
    action: "wait",
    city: "Demostadt",
    station_id: stationId,
    station_name: stationName,
    alt_station_id: null,
    alt_station_name: null,
    price_now: 1.749,
    window_start: iso(now - 2 * 3600_000),
    window_end: iso(now - 3600_000),
    window_start_hour: berlinHour(new Date(now - 2 * 3600_000)),
    window_end_hour: berlinHour(new Date(now - 3600_000)),
    expected_price: O17_DECOY_PRICE,
    expected_saving_eur: 2.4,
    decline_reason: null,
    p_besser: null,
    p_correct: 0.5,
    p_source: "basisrate",
    liters_assumed: 40,
    fuel: "e10",
    trip_mode: null,
    latest_by: null,
    tank_state: null,
  };
}

function o17SeedStore(stationId: string, stationName: string) {
  mkdirSync(dirname(O17_STORE), { recursive: true });
  let store: any = {
    schema_version: 5,
    episodes: [],
    fills: [],
    settlements: [],
  };
  if (existsSync(O17_STORE)) {
    try {
      store = JSON.parse(readFileSync(O17_STORE, "utf8"));
    } catch {
      return; // Der Server schreibt gerade — der Aufrufer wiederholt.
    }
  }
  if (!Array.isArray(store.episodes)) store.episodes = [];
  const snap = o17Snapshot(stationId, stationName);
  const due = {
    id: O17_EPISODE_ID,
    opened_at: snap.emitted_at,
    closed_at: null,
    status: "due",
    intent: "none",
    first_snapshot: { ...snap, id: "snap_o17_demo_first" },
    last_snapshot: snap,
    snapshots: [snap],
  };
  const guard = {
    id: O17_GUARD_ID,
    opened_at: new Date().toISOString(),
    closed_at: null,
    status: "open",
    intent: "none",
    first_snapshot: { ...snap, id: "snap_o17_demo_guard" },
    last_snapshot: { ...snap, id: "snap_o17_demo_guard" },
    snapshots: [{ ...snap, id: "snap_o17_demo_guard" }],
  };
  // Guard immer an den Anfang (fängt die Decide-Snapshots), die fällige
  // Episode dahinter — update-or-append, damit parallele Projekte auf
  // denselben zwei Einträgen landen statt auf Duplikaten.
  const rest = store.episodes.filter(
    (entry: any) => entry.id !== O17_GUARD_ID && entry.id !== O17_EPISODE_ID,
  );
  store.episodes = [guard, ...rest, due];
  writeFileSync(O17_STORE, JSON.stringify(store));
}

async function o17SeedDue(page: Page, stationId: string, stationName: string) {
  // Seed + Verifizierung über die echte API: Ein paralleler
  // Snapshot-Schreibvorgang kann den Seed überholen (Lesen–Schreiben
  // außerhalb der Store-Sperre) — dann läuft der Seed erneut.
  for (let attempt = 0; attempt < 10; attempt++) {
    o17SeedStore(stationId, stationName);
    const res = await page.request.get("/api/v1/episodes?status=due");
    if (res.ok()) {
      const body = await res.json();
      const mine = (body.episodes ?? []).find(
        (entry: any) => entry.id === O17_EPISODE_ID,
      );
      if (mine?.last_snapshot?.station_id === stationId) return mine;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("O17-Seed wurde nicht sichtbar");
}

test("O17: „Ja, wie empfohlen“ bucht den Live-Preis, nie den Median", async ({
  page,
}) => {
  await o17SeedDue(page, O17_KNOWN_STATION, O17_KNOWN_NAME);
  await page.goto("/");
  await expect(page.getByText("Fenster vorbei")).toBeVisible({
    timeout: 30_000,
  });

  const button = page.getByRole("button", { name: /Ja, wie empfohlen/ });
  await expect(button).toBeEnabled();
  const label = (await button.textContent()) ?? "";
  const match = label.match(/(\d+,\d+)\s*€\/L/);
  expect(match, `Knopf nennt den Live-Preis (Label: ${label})`).not.toBeNull();
  const liveShown = Number(match![1].replace(",", "."));
  expect(liveShown).not.toBe(O17_DECOY_PRICE);

  // Auf die ANTWORT warten, nicht auf den Versand: `waitForRequest` löst beim
  // Abschicken aus — das folgende `GET /api/v1/fills` überholte dann den
  // noch laufenden POST-Handler und der Beleg „fehlte im Ledger“ (Flake).
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/fills") &&
        res.request().method() === "POST",
    ),
    button.click(),
  ]);
  expect(response.ok(), "POST /api/v1/fills wird angenommen").toBe(true);
  const body = response.request().postDataJSON();
  expect(body.source).toBe("prompt");
  expect(body.station_id).toBe(O17_KNOWN_STATION);
  expect(body.price_source).toBe("live");
  expect(body.price_paid).toBeCloseTo(liveShown, 3);
  expect(body.price_paid).not.toBe(O17_DECOY_PRICE);

  // Der gespeicherte Beleg trägt den Live-Preis mit Herkunft.
  const fills = await page.request.get("/api/v1/fills");
  expect(fills.ok()).toBe(true);
  const stored = (await fills.json()).fills ?? [];
  const mine = stored.find(
    (fill: any) =>
      fill.episode_id === O17_EPISODE_ID &&
      fill.source === "prompt" &&
      !fill.voided,
  );
  expect(mine, "gebuchter Beleg steht im Ledger").toBeTruthy();
  expect(mine.price_paid).toBeCloseTo(liveShown, 3);
  expect(mine.price_source).toBe("live");
});

test("O17: ohne Live-Preis fragt die Maske, statt zu buchen", async ({
  page,
}) => {
  await o17SeedDue(page, O17_UNKNOWN_STATION, "Ehemalige Station");
  const posts: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/v1/fills") && req.method() === "POST") {
      posts.push(req.url());
    }
  });
  await page.goto("/");
  await expect(page.getByText("Fenster vorbei")).toBeVisible({
    timeout: 30_000,
  });

  const button = page.getByRole("button", { name: /Ja, wie empfohlen/ });
  await expect(button).toBeDisabled();
  await expect(button).toContainText("Preis unbekannt");

  await page.getByRole("button", { name: "Anders buchen" }).click();
  await expect(
    page.getByRole("heading", { name: "Tanken erfassen" }),
  ).toBeVisible();
  expect(posts, "kein Beleg ohne Live-Preis").toHaveLength(0);
});
