// @vitest-environment happy-dom
// Navigation: Übersicht und Stationen plus ein Studio-Eingang
// (Labor, System, Einstellungen, Glossar). Mobil ist das Studio hinter dem
// „Mehr“-Blatt, desktop steht es direkt in der Seitenleiste.
//
// Was diese Tests halten (Ratchet):
//   * genau die zwei Alltagsbereiche in der Hauptliste;
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

describe("Navigation: Übersicht + Stationen, Studio dahinter", () => {
  it("hat genau die zwei Alltagsbereiche — kein Studio-Eintrag in der Hauptliste", () => {
    expect(MAIN_NAV_ITEMS.map((item) => item.id)).toEqual([
      "jetzt",
      "stations",
    ]);
    expect(MAIN_NAV_ITEMS.some((item) => item.label === "Glossar")).toBe(false);
  });

  it("das Studio trägt Labor, System, Einstellungen und Glossar", () => {
    expect(STUDIO_NAV_ITEMS.map((item) => item.id)).toEqual([
      "labor",
      "system",
      "settings",
      "glossary",
    ]);
    // Jedes Studio-Element benennt, was dort wartet (Wireframe §1.4.4).
    for (const item of STUDIO_NAV_ITEMS) {
      expect(item.note, `„${item.label}“ trägt keine Erklärzeile`).toBeTruthy();
    }
  });

  it("zusammen bilden die Einträge die komplette aktuelle Navigation", () => {
    const all = [...MAIN_NAV_ITEMS, ...STUDIO_NAV_ITEMS].map((item) => item.id);
    expect(all).toEqual([
      "jetzt",
      "stations",
      "labor",
      "system",
      "settings",
      "glossary",
    ]);
    expect(isStudioTab("labor")).toBe(true);
    expect(isStudioTab("settings")).toBe(true);
    expect(isStudioTab("stations")).toBe(false);
  });

  it("MobileNav: zwei Kernbereiche plus „Mehr“ — 44-px-Ziele, aktiver Stand", () => {
    const html = renderToStaticMarkup(<MobileNav tab="jetzt" onSelect={() => {}} />);
    for (const item of MAIN_NAV_ITEMS) {
      expect(html, `Hauptbereich „${item.label}“ fehlt`).toContain(item.label);
    }
    expect(html).toContain(">Mehr</span>");
    expect(html).toContain("min-h-11");
    // Aktiv ist genau die Übersicht — „Mehr“ trägt kein aria-current.
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
    // Drei Zellen: Übersicht, Stationen, Mehr.
    expect(html).toContain("grid-cols-3");
    expect(html).not.toContain("grid-cols-4");
  });

  it("die Seitenleiste zeigt beide Alltagsbereiche plus Studio-Gruppe", () => {
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
