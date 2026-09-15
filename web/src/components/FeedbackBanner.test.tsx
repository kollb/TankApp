// @vitest-environment happy-dom
// TEXT-BEFUND T2: Der Aktions-Kanal zeigte jede Meldung grün mit Häkchen —
// auch „Speichern fehlgeschlagen“. Diese Prüfung hält die Töne fest.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackBanner } from "./FeedbackBanner";

const render = (tone: "ok" | "warn" | "error", text: string) =>
  renderToStaticMarkup(<FeedbackBanner feedback={{ tone, text }} />);

describe("FeedbackBanner: Ton entscheidet, nicht der Kanal", () => {
  it("ohne Meldung rendert es nichts", () => {
    expect(renderToStaticMarkup(<FeedbackBanner feedback={null} />)).toBe("");
  });

  it("ok: Häkchen, grün, role=status", () => {
    const html = render("ok", "Beleg in deiner Bilanz verbucht.");
    expect(html).toContain('role="status"');
    expect(html).toContain("emerald");
    expect(html).toContain("Beleg in deiner Bilanz verbucht.");
  });

  it("error: Warnzeichen, rose, role=alert — kein Erfolgs-Gewand", () => {
    const html = render("error", "Speichern fehlgeschlagen: Store belegt — bitte erneut versuchen.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("rose");
    expect(html).not.toContain("emerald");
  });

  it("warn: vorgemerkt ist nicht gespeichert", () => {
    const html = render("warn", "Beleg lokal vorgemerkt — er geht raus, sobald die Verbindung steht.");
    expect(html).toContain('role="status"');
    expect(html).toContain("amber");
  });

  it("der Text trägt kein ✓/! mehr — das Icon kodiert den Ton", () => {
    for (const tone of ["ok", "warn", "error"] as const) {
      expect(render(tone, "Auswahl gespeichert.")).not.toMatch(/[✓!]/);
    }
  });
});
