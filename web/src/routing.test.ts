import { describe, expect, it } from "vitest";
import { routeFromSearch, urlForTab } from "./routing";

describe("App-Bereichs-Routing", () => {
  it("öffnet ohne tab, bei unbekannten Werten und bei alten Wochenlinks die Übersicht", () => {
    expect(routeFromSearch("")).toBe("overview");
    expect(routeFromSearch("?tab=unknown")).toBe("overview");
    expect(routeFromSearch("?tab=woche")).toBe("overview");
    expect(routeFromSearch("?tab=week")).toBe("overview");
  });

  it("führt den alten Ich-Link zu Einstellungen und akzeptiert aktuelle Bereiche", () => {
    expect(routeFromSearch("?tab=ich")).toBe("einstellungen");
    expect(routeFromSearch("?tab=stationen")).toBe("stationen");
    expect(routeFromSearch("?tab=LABOR")).toBe("labor");
    expect(routeFromSearch("?tab=system")).toBe("system");
    expect(routeFromSearch("?tab=glossar")).toBe("glossar");
  });

  it("ändert nur den Bereich und erhält Filter, Abschnitt und Hash", () => {
    expect(urlForTab("/?fuel=e5&section=prognose#details", "labor"))
      .toBe("/?fuel=e5&section=prognose&tab=labor#details");
    expect(urlForTab("/?tab=ich&fuel=diesel", "einstellungen"))
      .toBe("/?tab=einstellungen&fuel=diesel");
  });

  it("lässt die kanonische Übersichts-Startseite ohne überflüssigen tab", () => {
    expect(urlForTab("/tankapp?fuel=e10#oben", "overview")).toBe("/tankapp?fuel=e10#oben");
    expect(urlForTab("/?tab=week", "overview")).toBe("/?tab=overview");
  });
});
