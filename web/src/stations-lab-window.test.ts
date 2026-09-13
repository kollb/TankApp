// Regressionsfall 13.09.2026 — Stations-Labor „keine Daten“ trotz 108 Preise.
//
// Der Preisverlauf schneidet Punkte gegen ein Fenster zu. Die Punkte liegen
// in Epoch-Millisekunden (Date.parse der Server-Zeitstempel, ~10¹²). Das
// Fenster wurde aus performance.now() gebildet (Seitenlaufzeit, ~10³) — es
// lag damit vollständig „vor“ jedem echten Punkt, und das Labor renderte
// „keine Daten“, während die Datenreichweite-Notiz weiter 108 Preise zählte.
//
// historyWindowMs() fixiert den Vertrag: Fensterende ≈ Date.now()
// (Wandzeit/Epoch-Millisekunden), Fensterlänge = gewählter Zeitraum.
import { describe, expect, it } from "vitest";
import { historyWindowMs } from "./data";

describe("historyWindowMs (Stations-Labor)", () => {
  it("Fenster ist Wandzeit (Epoch-Millisekunden), nicht Seitenlaufzeit", () => {
    const nowMs = Date.now();
    const [from, to] = historyWindowMs(24);
    // Fensterende liegt auf Wandzeit: Größenordnung 10¹² und ≈ jetzt —
    // performance.now() läge dagegen bei Sekunden seit Seitenaufruf (< 10⁶).
    expect(to).toBeGreaterThan(1_000_000_000_000);
    expect(Math.abs(to - nowMs)).toBeLessThan(5000);
    expect(to - from).toBe(24 * 3600000);
  });

  it("Punkt von vor 1 h liegt im 24-h-Fenster, 48 h alt erst im 72-h-Fenster", () => {
    const nowMs = Date.now();
    const hourAgo = Date.parse(new Date(nowMs - 3600e3).toISOString());
    const twoDaysAgo = Date.parse(
      new Date(nowMs - 48 * 3600e3).toISOString(),
    );
    const win24 = historyWindowMs(24, nowMs);
    const win72 = historyWindowMs(72, nowMs);
    expect(hourAgo >= win24[0] && hourAgo <= win24[1]).toBe(true);
    expect(twoDaysAgo >= win24[0] && twoDaysAgo <= win24[1]).toBe(false);
    expect(twoDaysAgo >= win72[0] && twoDaysAgo <= win72[1]).toBe(true);
  });

  it("Deckt einen vollen Beobachtungs-Tag wie im Live-Betrieb ab", () => {
    // Muster aus dem Regressionsfall: Preise über den ganzen letzten Tag
    // („gestern 12:25“ bis „heute 12:15“) — jeder Punkt muss im 24-h-Fenster
    // landen, sonst schneidet das Labor die Kurve weg.
    const nowMs = Date.now();
    const win = historyWindowMs(24, nowMs);
    for (const offsetMin of [5, 60, 720, 1325, 1365, 1439]) {
      const stamp = Date.parse(
        new Date(nowMs - offsetMin * 60e3).toISOString(),
      );
      expect(stamp >= win[0] && stamp <= win[1]).toBe(true);
    }
  });
});
