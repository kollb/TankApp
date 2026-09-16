// GUI-UX-BEFUND U4: Bereichs-Routing — jede Ansicht ist eine URL.
//
// Vorher: kein `tab` in der Query, kein Browser-Zurück, Lesezeichen landen
// immer auf „Jetzt“. Jetzt: Bereich und Labor-Abschnitt stehen in der
// Query; die Helfer hier sind reine Funktionen (lesen, mappen, Query bauen),
// die Root (Dashboard) hängt sie an `pushState`/`popstate`.

import { describe, expect, it } from "vitest";
import {
  queryWithTab,
  sectionFromUrlId,
  tabFromUrlId,
  tabToUrlId,
} from "./routing";

describe("U4: Bereich in der URL", () => {
  it("jeder Bereich hat einen alltagsdeutschen URL-Namen und zurück", () => {
    expect(tabToUrlId("stations")).toBe("stationen");
    expect(tabToUrlId("week")).toBe("woche");
    expect(tabToUrlId("glossary")).toBe("glossar");
    expect(tabFromUrlId("stationen")).toBe("stations");
    expect(tabFromUrlId("woche")).toBe("week");
    expect(tabFromUrlId("glossar")).toBe("glossary");
  });

  it("fehlende und unbekannte Werte landen im Einstieg — nie im Fehler", () => {
    expect(tabFromUrlId(null)).toBe("jetzt");
    expect(tabFromUrlId(undefined)).toBe("jetzt");
    expect(tabFromUrlId("")).toBe("jetzt");
    expect(tabFromUrlId("statistik")).toBe("jetzt");
  });

  it("der Labor-Abschnitt wird nur akzeptiert, wenn es ihn gibt", () => {
    expect(sectionFromUrlId("sicherheit")).toBe("sicherheit");
    expect(sectionFromUrlId("prognose")).toBe("prognose");
    expect(sectionFromUrlId("unbekannt")).toBeNull();
    expect(sectionFromUrlId(null)).toBeNull();
  });

  it("der Bereichswechsel erhält die übrige Query", () => {
    expect(queryWithTab("?city=Kiel&fuel=e10", "week")).toBe(
      "city=Kiel&fuel=e10&tab=woche",
    );
    // Der Einstieg ist der Default — er steht nicht in der URL.
    expect(queryWithTab("?city=Kiel&tab=woche", "jetzt")).toBe("city=Kiel");
    // `section` gilt nur im Labor; anderswo wird es abgeräumt.
    expect(queryWithTab("?tab=labor&section=prognose", "labor", "sicherheit")).toBe(
      "tab=labor&section=sicherheit",
    );
    expect(queryWithTab("?tab=labor&section=prognose", "week")).toBe(
      "tab=woche",
    );
  });
});
