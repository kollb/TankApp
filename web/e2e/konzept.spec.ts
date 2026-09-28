import { expect, test } from "@playwright/test";

import { clickArea } from "./nav";

// Der Konzept-Neubau (`/?konzept=1`) — die **echte** Oberfläche:
// dieselben Endpunkte, dieselben Freigabegates, aber die Gestaltung aus dem
// Konzept und der Desktop als Grundform.
//
// Geprüft wird, was ein Mockup nicht hätte: dass die Ansicht ohne
// Beispiel-Datenquelle lädt (die Tests laufen gegen den echten Server),
// dass die Bereiche in der Adresse reisen, dass das Handy dieselbe
// Reihenfolge in einer Spalte bekommt, und dass die Darstellung dem
// Betriebssystem folgt (Dunkel als Rückfall).

test("echte Ansicht: keine Vorschau-Attrappe, Bereiche reisen in der Adresse", async ({
  page,
}) => {
  await page.goto("/?konzept=1");

  // Die Frage der Startseite steht als Überschrift — und der frühere
  // Handy-Rahmen samt Steuerpanel existiert nicht mehr.
  await expect(
    page.getByRole("heading", { level: 1, name: "Soll ich jetzt tanken?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Interaktive Smartphone-Vorschau" }),
  ).toHaveCount(0);

  // Die klassische Ansicht bleibt erreichbar und ist verlinkt.
  await expect(
    page.getByRole("link", { name: /Klassische Ansicht/ }),
  ).toHaveAttribute("href", "/");

  // Bereichswechsel: der Parameter bleibt, der Bereich kommt dazu.
  await page.getByRole("button", { name: "Woche", exact: true }).click();
  await expect(page).toHaveURL(/konzept=1/);
  await expect(page).toHaveURL(/tab=woche/);
  await expect(
    page.getByText("läuft noch in der bisherigen Gestaltung", {
      exact: false,
    }),
  ).toBeVisible();

  // Zurück über den Browser — die Adresse ist die Wahrheit (U4).
  await page.goBack();
  await expect(page).toHaveURL(/tab=jetzt|konzept=1$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Soll ich jetzt tanken?" }),
  ).toBeVisible();
});

test("Handy: eine Spalte, untere Leiste, Studio hinter „Mehr“", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?konzept=1");
  await expect(
    page.getByRole("heading", { level: 1, name: "Soll ich jetzt tanken?" }),
  ).toBeVisible();

  // Kein Querlauf in schmalen Rastern.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  // Studio liegt einen Tipp tiefer, die drei Alltagsfragen sind direkt da.
  const nav = page.getByRole("navigation", { name: "Bereiche" });
  await expect(nav.getByRole("button", { name: "Jetzt", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "Mehr", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Studio" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /^Labor/ }).click();
  await expect(page).toHaveURL(/tab=labor/);
  await expect(sheet).toHaveCount(0);
});

test("Darstellung folgt dem System, Rückfall ist dunkel", async ({ page }) => {
  // Ausdrückliche Systemeinstellung „hell“.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/?konzept=1");
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  // Ohne Angabe des Geräts bleibt es dunkel (der Rückfall).
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);

  // Eine ausdrückliche Wahl sticht das System und überlebt das Neuladen.
  // Der Weg ist derselbe wie in der klassischen Ansicht (Ich →
  // Einstellungen → Darstellung); der Neubau hat keinen zweiten Schalter,
  // der etwas anderes behaupten könnte.
  const themeGroup = () =>
    page.getByRole("group", { name: "Darstellung (System, dunkel oder hell)" });
  await clickArea(page, "Ich");
  await page.getByRole("tab", { name: "Einstellungen", exact: true }).click();
  await themeGroup().getByRole("button", { name: "Hell", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  expect(
    await page.evaluate(() => localStorage.getItem("tankapp.theme")),
  ).toBe('"light"');

  // „System“ nimmt die Wahl zurück: der Schlüssel verschwindet, das Gerät
  // entscheidet wieder — und das ist hier dunkel.
  await page.getByRole("tab", { name: "Einstellungen", exact: true }).click();
  await themeGroup().getByRole("button", { name: "System", exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("tankapp.theme")),
  ).toBe(null);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("Stufen des Guides: ohne Verbindung erklärt die Seite den Ausfall", async ({
  page,
  context,
}) => {
  await page.goto("/?konzept=1");
  await expect(
    page.getByRole("heading", { level: 1, name: "Soll ich jetzt tanken?" }),
  ).toBeVisible();
  // Gerät offline: Stufe 3 — Banner statt erfundener Empfehlung.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(
    page.getByRole("region", { name: /Keine Verbindung|Offline/ }),
  ).toBeVisible({ timeout: 15000 });
  await context.setOffline(false);
});
