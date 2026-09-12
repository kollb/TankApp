/**
 * B4 (GUI): Texte der Alarm-Zustellung im System-Tab.
 *
 * Die Kachel darf nichts behaupten, was `/api/v1/health → notify` nicht
 * hergibt: „nicht eingerichtet“ ist kein Fehler, „keine offenen Fehler“ kein
 * Beweis für eine funktionierende Zustellung.
 */
import { describe, expect, it } from "vitest";
import { notifyLastLine, notifyStatusLine, notifyTone } from "./data";

describe("Alarm-Zustellung (B4)", () => {
  it("ohne Konfiguration: neutral, kein Alarm-Ton", () => {
    expect(notifyTone(undefined)).toBe("off");
    expect(notifyTone({ configured: false, open_errors: [] })).toBe("off");
    expect(notifyStatusLine(undefined)).toMatch(/nur hier in der GUI/);
    expect(notifyLastLine(undefined)).toBeNull();
  });

  it("eingerichtet und ruhig: kein Versprechen über Zustellbarkeit", () => {
    const notify = { configured: true, open_errors: [] };
    expect(notifyTone(notify)).toBe("ok");
    expect(notifyStatusLine(notify)).toMatch(/kein Fehler offen/);
    expect(notifyLastLine(notify)).toMatch(/noch nichts verschickt/);
  });

  it("offene Fehler werden gezählt, Singular und Plural getrennt", () => {
    expect(notifyStatusLine({ configured: true, open_errors: ["job_failed"] })).toMatch(
      /^1 Alarm /,
    );
    expect(
      notifyStatusLine({
        configured: true,
        open_errors: ["job_failed", "collector_no_heartbeat"],
      }),
    ).toMatch(/^2 Alarme /);
    expect(notifyTone({ configured: true, open_errors: ["job_failed"] })).toBe("alert");
  });

  it("Zeitstempel: gemeldet schlägt Entwarnung, beides Europe/Berlin", () => {
    const sent = notifyLastLine({
      configured: true,
      open_errors: ["job_failed"],
      last_sent_at: "2026-09-12T06:00:00+00:00",
      last_ok_at: "2026-09-11T06:00:00+00:00",
    });
    expect(sent).toMatch(/Zuletzt gemeldet: 12\.09\., 08:00/);
    expect(
      notifyLastLine({
        configured: true,
        open_errors: [],
        last_ok_at: "2026-09-11T06:00:00+00:00",
      }),
    ).toMatch(/wieder betriebsbereit“: 11\.09\., 08:00/);
  });
});
