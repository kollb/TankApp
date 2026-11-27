// Bereichs-Routing: kanonische URLs und Abwärtskompatibilität für alte Links.

import { describe, expect, it } from "vitest";
import {
  queryWithTab,
  sectionFromUrlId,
  tabFromUrlId,
  tabToUrlId,
} from "./routing";

describe("Bereich in der URL", () => {
  it("kanonische Bereiche haben deutsche URL-Namen und zurück", () => {
    expect(tabToUrlId("jetzt")).toBe("jetzt");
    expect(tabToUrlId("stations")).toBe("stationen");
    expect(tabToUrlId("settings")).toBe("einstellungen");
    expect(tabToUrlId("glossary")).toBe("glossar");
    expect(tabFromUrlId("stationen")).toBe("stations");
    expect(tabFromUrlId("einstellungen")).toBe("settings");
    expect(tabFromUrlId("glossar")).toBe("glossary");
  });

  it("alte Woche- und Ich-Links landen auf den aktuellen Zielen", () => {
    expect(tabFromUrlId("woche")).toBe("jetzt");
    expect(tabFromUrlId("week")).toBe("jetzt");
    expect(tabFromUrlId("ich")).toBe("settings");
    expect(tabFromUrlId("settings")).toBe("settings");
    expect(tabFromUrlId("alltag")).toBe("jetzt");
    expect(tabFromUrlId("werkstatt")).toBe("labor");
  });

  it("fehlende und unbekannte Werte landen im Einstieg — nie im Fehler", () => {
    expect(tabFromUrlId(null)).toBe("jetzt");
    expect(tabFromUrlId(undefined)).toBe("jetzt");
    expect(tabFromUrlId("")).toBe("jetzt");
    expect(tabFromUrlId("unbekannt")).toBe("jetzt");
  });

  it("der Labor-Abschnitt wird nur akzeptiert, wenn es ihn gibt", () => {
    expect(sectionFromUrlId("sicherheit")).toBe("sicherheit");
    expect(sectionFromUrlId("prognose")).toBe("prognose");
    expect(sectionFromUrlId("unbekannt")).toBeNull();
    expect(sectionFromUrlId(null)).toBeNull();
  });

  it("der Bereichswechsel erhält die übrige Query und schreibt aktuelle Namen", () => {
    expect(queryWithTab("?city=Kiel&fuel=e10", "settings")).toBe(
      "city=Kiel&fuel=e10&tab=einstellungen",
    );
    expect(queryWithTab("?city=Kiel&tab=woche", "jetzt")).toBe("city=Kiel");
    expect(queryWithTab("?tab=ich", "settings")).toBe("tab=einstellungen");
    // `section` gilt nur im Labor; anderswo wird es abgeräumt.
    expect(queryWithTab("?tab=labor&section=prognose", "labor", "sicherheit")).toBe(
      "tab=labor&section=sicherheit",
    );
    expect(queryWithTab("?tab=labor&section=prognose", "settings")).toBe(
      "tab=einstellungen",
    );
  });
});
