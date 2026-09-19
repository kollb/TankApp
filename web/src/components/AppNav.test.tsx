// @vitest-environment happy-dom
// B4 (Befund UX/Mathe 19.09.2026, §1.3): Die Hauptnavigation ist 3+1 —
// drei Kernfragen (Jetzt, Woche, Stationen) plus ein Studio-Eingang
// (Labor, Ich, System, Glossar). Mobil ist das Studio hinter dem
// „Mehr“-Blatt, desktop steht es direkt in der Seitenleiste.
//
// Was diese Tests halten (Ratchet):
//   * genau die drei Kernfragen in der Hauptliste, in Konzepts-Reihenfolge;
//   * die Studio-Bereiche existieren weiter — sie sind versunken, nicht
//     gelöscht (keine Feature-Verluste);
//   * das mobile Blatt ist dialogartig (role="dialog", aria-haspopup/
//     expanded am „Mehr“-Eintrag) und listet alle vier Studio-Bereiche;
//   * im Studio-Bereich trägt der „Mehr“-Eintrag mobil `aria-current`,
//     desktop die Studio-Karte — der Bereichsstand bleibt in der
//     Navigation lesbar.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isStudioTab,
  MAIN_NAV_ITEMS,
  MobileNav,
  SideNav,
  STUDIO_NAV_ITEMS,
} from "./AppNav";

describe("B4: Navigation 3+1", () => {
  it("hat genau drei Kernfragen in Konzepts-Reihenfolge — kein Glossar mehr als Haupttab", () => {
    expect(MAIN_NAV_ITEMS.map((item) => item.id)).toEqual([
      "jetzt",
      "week",
      "stations",
    ]);
    expect(MAIN_NAV_ITEMS.some((item) => item.label === "Glossar")).toBe(false);
  });

  it("das Studio trägt alle vier Bereiche — ein Eingang, keine Löcher", () => {
    expect(STUDIO_NAV_ITEMS.map((item) => item.id)).toEqual([
      "labor",
      "ich",
      "system",
      "glossary",
    ]);
    // Jedes Studio-Element benennt, was dort wartet (Wireframe §1.4.4).
    for (const item of STUDIO_NAV_ITEMS) {
      expect(item.note, `„${item.label}“ trägt keine Erklärzeile`).toBeTruthy();
    }
  });

  it("zusammen ist die komplette alte Navigation da — nichts wurde gelöscht", () => {
    const all = [...MAIN_NAV_ITEMS, ...STUDIO_NAV_ITEMS].map((item) => item.id);
    expect(all).toEqual([
      "jetzt",
      "week",
      "stations",
      "labor",
      "ich",
      "system",
      "glossary",
    ]);
    expect(isStudioTab("labor")).toBe(true);
    expect(isStudioTab("week")).toBe(false);
  });

  it("MobileNav: drei Kernfragen plus „Mehr“ — 44-px-Ziele, aktiver Stand", () => {
    const html = renderToStaticMarkup(<MobileNav tab="week" onSelect={() => {}} />);
    for (const item of MAIN_NAV_ITEMS) {
      expect(html, `Hauptbereich „${item.label}“ fehlt`).toContain(item.label);
    }
    expect(html).toContain(">Mehr</span>");
    expect(html).toContain("min-h-11");
    // Aktiv ist genau die Woche — „Mehr“ trägt kein aria-current.
    expect(html.match(/aria-current="page"/g)?.length ?? 0).toBe(1);
    expect(html).toContain('aria-label="Bereiche"');
    // Das Blatt ist zu: keine Studio-Zeile im Dokument.
    expect(html).not.toContain("role=\"dialog\"");
    // „Mehr“ ist der Dialog-Trigger.
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("MobileNav im Studio-Bereich: „Mehr“ ist die aktive Markierung", () => {
    const html = renderToStaticMarkup(<MobileNav tab="labor" onSelect={() => {}} />);
    // Kein Hauptbereich ist aktiv — der Studio-Eingang trägt es.
    expect(html.match(/aria-current="page"/g)?.length ?? 0).toBe(1);
    expect(html).toContain('aria-expanded="false"');
  });

  it("die mobile Leiste ist fixiert und liegt über dem Inhalt (z-50)", () => {
    const html = renderToStaticMarkup(
      <MobileNav tab="jetzt" onSelect={() => {}} />,
    );
    expect(html).toContain("fixed");
    expect(html).toContain("bottom-0");
    expect(html).toContain("z-50");
    expect(html).toContain("lg:hidden");
    // Vier Zellen — das 6er-Raster von U3 ist weg.
    expect(html).toContain("grid-cols-4");
    expect(html).not.toContain("grid-cols-6");
  });

  it("die Seitenleiste zeigt drei Kernfragen plus Studio-Gruppe", () => {
    const html = renderToStaticMarkup(<SideNav tab="jetzt" onSelect={() => {}} />);
    for (const item of MAIN_NAV_ITEMS) {
      expect(html, `Hauptbereich „${item.label}“ fehlt`).toContain(item.label);
    }
    expect(html).toContain(">Studio<");
    for (const item of STUDIO_NAV_ITEMS) {
      expect(html, `Studio-Bereich „${item.label}“ fehlt`).toContain(item.label);
    }
    expect(html.match(/aria-current="page"/g)?.length ?? 0).toBe(1);
    expect(html).toContain('aria-label="Bereiche"');
    // Nur ab Desktop sichtbar.
    expect(html).toContain("hidden");
    expect(html).toContain("lg:flex");
    expect(html).toContain("sticky");
  });

  it("die Seitenleiste markiert den aktiven Studio-Bereich direkt", () => {
    const html = renderToStaticMarkup(<SideNav tab="system" onSelect={() => {}} />);
    expect(html.match(/aria-current="page"/g)?.length ?? 0).toBe(1);
    // Das System ist in der Studio-Gruppe — der Knopf trägt die Markierung.
    const markedButton = html.match(
      /<button[^>]*aria-current="page"[^>]*>[\s\S]*?<\/button>/,
    );
    expect(markedButton?.[0] ?? "").toContain("System");
  });
});
