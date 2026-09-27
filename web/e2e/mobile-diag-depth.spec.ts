// TEMPORÄRE DIAGNOSE — wird entfernt, sobald die Scrolltiefe wieder greift.
//
// Der Ratchet „Jetzt: Scrolltiefe ≤ 1,5 Viewports“ schlug im Demo-Stack mit
// 2,05 fehl (PR-CI). In dieser Umgebung ist kein Browser installierbar, die
// Blockhöhen lassen sich also nicht lokal messen. Dieser Test vermisst den
// Entscheidungsbildschirm im echten Chromium und **scheitert absichtlich** —
// die Zahlen stehen dann in der Fehlermeldung bzw. in der Check-Annotation.

import { test, expect, type Page } from "@playwright/test";

type Row = { path: string; text: string; h: number };

async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

test("DIAG: Blockhöhen des Entscheidungsbildschirms", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "Die KPI gilt bei der Entwurfsbreite 390 px (mobile-Projekt).",
  );
  await page.goto("/");
  await settled(page);

  const data = await page.evaluate(() => {
    const section = document.querySelector(
      'section[aria-labelledby="jetzt-title"]',
    ) as HTMLElement | null;
    if (!section) return { error: "keine section[aria-labelledby=jetzt-title]" };

    const describe = (element: Element, depth: number): Row => {
      const cls = String(element.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .filter((c) => !/^(flex|grid|block|relative|min-w-0|w-full|mt-|mb-|pt-|pb-)/.test(c))
        .slice(0, 5)
        .join(".");
      const id = element.getAttribute("id");
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
      const box = element.getBoundingClientRect();
      return {
        path: `${"·".repeat(depth)}${element.tagName.toLowerCase()}${
          id ? "#" + id : ""
        }${cls ? "." + cls : ""}`,
        text,
        h: Math.round(box.height),
      };
    };

    const rows: Row[] = [];
    const walk = (element: Element, depth: number) => {
      rows.push(describe(element, depth));
      if (depth >= 3) return;
      for (const child of Array.from(element.children)) {
        // Dialoge sind zugeklappt — ihre Höhe zählt nicht mit.
        if (child.tagName.toLowerCase() === "dialog") continue;
        walk(child, depth + 1);
      }
    };
    walk(section, 0);

    const h = section.getBoundingClientRect().height;
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      sectionHeight: Math.round(h),
      depth: Number((h / window.innerHeight).toFixed(3)),
      rows: rows
        .filter((r) => r.h > 8)
        .sort((a, b) => b.h - a.h)
        .slice(0, 28),
    };
  });

  throw new Error(
    "DIAG " +
      JSON.stringify(data, null, 1)
        .replace(/\n\s*/g, " ")
        .slice(0, 3500),
  );
});
