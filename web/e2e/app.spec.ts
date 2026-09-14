import { test, expect, type Page } from "@playwright/test";

// GUI-Neuentwurf (Phase 1+2): Der Einstieg ist „Jetzt“. Die alten Tabs
// „Alltag“ und „Einstellungen“ sind ersetzt — Stationen, Woche und Ich
// führen die jeweiligen Bereiche weiter.

test("honest setup state and all views", async ({ page }) => {
  // Auf einem frischen Server ohne Polling-Set zeigt der Einstieg „Jetzt“ den
  // grauen S0-Zustand: Grund plus nächster Schritt — kein erfundener Preis,
  // keine leere Fläche.
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Jetzt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Einrichten in drei Schritten" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Einrichtung starten" }),
  ).toBeVisible();
  // „Stationen“ (der ehemalige Alltag) zeigt auf dem frischen Server die
  // ehrliche Set-Karte — kein roter Fehler, obwohl /decide ohne Set einen
  // error_code zurückliefert (Konsequenz fehlender Daten, kein Defekt).
  await page.getByRole("button", { name: "Stationen", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Erst ein Set, dann der Atlas" }),
  ).toBeVisible();
  // „Labor“ (der ehemalige Werkstatt-Tab) ist die getrennte Welt für die
  // Mathematik: eine Seite, fünf Aufklapp-Abschnitte. Ohne Statistik-Lauf
  // bleibt sie ehrlich bei „kein Statistik-Lauf“ und nennt den Grund.
  await page.getByRole("button", { name: "Labor", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Verstehen, warum die App das sagt" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Was sagt die App eigentlich vorher?" }),
  ).toBeVisible();
  await expect(
    page.getByText("Kalibrierung steht aus", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Einmal einrichten. Weiterlaufen lassen.",
    }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Das gemeinsame Polling-Set fehlt auf diesem Server.")
      .first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("city/fuel changes never mix prices, closures never win", async ({
  page,
}) => {
  // Isolated request fixtures only; no test data is ever written to the running app or InfluxDB.
  await page.route("**/api/v1/stations?*", async (route) => {
    const fuel = new URL(route.request().url()).searchParams.get("fuel")!;
    const record = (
      id: string,
      city: string,
      name: string,
      value: number | null,
      status = "open",
    ) => ({
      station_id: id,
      city,
      name,
      brand: "Test",
      fuel,
      price: value,
      last_price: value,
      status,
      fresh: true,
      age_minutes: 2,
      observed_at: new Date().toISOString(),
      maps_url: null,
    });
    const rows =
      fuel === "e10"
        ? [
            record("a", "Frankfurt", "F-Station", 1.709),
            record("closed", "Frankfurt", "Closed-Station", null, "closed"),
            record("b", "Gütersloh", "G-Station", 1.689),
          ]
        : [
            record("a", "Frankfurt", "F-Station", null),
            record("b", "Gütersloh", "G-Station", null),
          ];
    await route.fulfill({
      json: {
        generated_at: new Date().toISOString(),
        cities: ["Frankfurt", "Gütersloh"],
        fuel,
        stations: rows,
        connection_error: null,
        fresh_prices: 2,
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Stationen", exact: true }).click();
  // Die offene F-Station ist die Referenz; die geschlossene Station verliert
  // nie die Auswahl.
  const fRow = page.getByRole("button", {
    name: "F-Station als Referenz und Detail wählen",
  });
  await expect(fRow).toBeVisible();
  await expect(fRow).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Stadt", { exact: true }).selectOption("Gütersloh");
  const gRow = page.getByRole("button", {
    name: "G-Station als Referenz und Detail wählen",
  });
  await expect(gRow).toBeVisible();
  await expect(page.getByText("F-Station", { exact: true })).toHaveCount(0);
  // C4 (weitergezogen): Die Tankmenge ist ein Default — der Eingabeort ist
  // jetzt „Ich → Fahrzeug“; die App rechnet haushaltsweit damit weiter.
  await page.getByRole("button", { name: "Ich", exact: true }).click();
  await page.locator("#liters").fill("55");
  await expect(page.locator("#liters")).toHaveAttribute(
    "aria-valuetext",
    "55 Liter",
  );
  await page.getByRole("button", { name: "Diesel", exact: true }).click();
  await page.getByRole("button", { name: "Stationen", exact: true }).click();
  await expect(page.getByText("Noch kein frischer Preis")).toBeVisible();
  await expect(page.getByText("1,689", { exact: false })).toHaveCount(0);
  await page.reload();
  // Nach dem Reload startet die App wieder in „Jetzt“ — für die Stationen-
  // Namen erneut dorthin wechseln.
  await page.getByRole("button", { name: "Stationen", exact: true }).click();
  await expect(page.getByLabel("Stadt", { exact: true })).toHaveValue(
    "Gütersloh",
  );
  await expect(page.getByText("Noch kein frischer Preis")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Diesel", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // Die Tankmenge übersteht den Reload (geräte-lokal gespeichert).
  await page.getByRole("button", { name: "Ich", exact: true }).click();
  await expect(page.locator("#liters")).toHaveValue("55");
});

test("Ich: Fahrzeug-Defaults, Schwellen read-only, Dark/Light", async ({
  page,
}) => {
  // Phase 2: „Einstellungen verschwindet als Tab“ (UI-NEUENTWURF §4.2) —
  // die Fahrzeug-Felder wohnen unter „Ich → Fahrzeug“, Kontext, Schwellen,
  // Darstellung und Daten unter „Ich → Einstellungen“.
  await page.goto("/");
  await page.getByRole("button", { name: "Ich", exact: true }).click();
  // Unterseiten-Segment-Steuerung: ARIA-Tabs (kein Button-Rollenspiel).
  await page.getByRole("tab", { name: "Fahrzeug", exact: true }).click();

  // Alle Defaults an einem Ort — die Eingabeorte, die im alten
  // Einstellungen-Tab verteilt lagen (Tankmenge, Verbrauch, Zeitwert,
  // Tempo, Fahrtcharakter) plus Tankgröße.
  await expect(page.locator("#liters")).toBeVisible();
  await expect(page.locator("#consumption")).toBeVisible();
  await expect(page.locator("#timeValue")).toBeVisible();
  await expect(page.locator("#speed")).toBeVisible();
  await expect(page.locator("#detourMode")).toBeVisible();
  await expect(page.locator("#tankCapacity")).toBeVisible();

  await page
    .getByRole("tab", { name: "Einstellungen", exact: true })
    .click();
  // Kontext: Stadt und Kraftstoff am Wirkungsort.
  await expect(page.locator("#settings-city")).toBeVisible();

  // Aktive Schwellen-Tabelle aus /api/v1/stats/summary — read-only,
  // Startwerte der Engine (ohne Daten keine Abweichung möglich).
  await expect(
    page.getByText("read-only · Quelle: /api/v1/stats/summary"),
  ).toBeVisible();
  const table = page.locator("table").filter({ hasText: "Mindest-Ersparnis" });
  await expect(
    table.locator("tr", { hasText: "Warten (grün)" }).first(),
  ).toContainText("2,00 €");
  await expect(
    table.locator("tr", { hasText: "wenn P(Warten) unter" }),
  ).toContainText("50 %");
  // Read-only: kein einziges Eingabefeld in der Schwellen-Tabelle.
  await expect(table.locator("input")).toHaveCount(0);

  // Dark/Light-Umschaltung — wird auf <html> angewendet und übersteht
  // einen Reload (Bootstrap-Script in index.html, localStorage).
  await page
    .getByRole("button", { name: "Hell (Slate)", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
  // Zurück auf den Default (dunkles Slate), damit andere Tests nicht
  // von dieser Ansicht abhängen. Nach dem Reload startet die App in
  // „Jetzt“ — der Theme-Knopf liegt unter „Ich → Einstellungen“.
  await page.getByRole("button", { name: "Ich", exact: true }).click();
  await page
    .getByRole("tab", { name: "Einstellungen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Dunkles Slate (Standard)", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
