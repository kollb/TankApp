// V3 (GUI-TEXT-BEFUND): das Mitteilungs-Register als pure Funktion.
//
// Die DoD sagt: Rang (Störung > Zustand > Hinweis > Erfolg), höchstens eine
// sichtbare Meldung, Gleichrangige aneinandergereiht, eine gemeinsame Dauer
// (6 s, Störungen bleiben). Genau das hält `reduceNotices` fest — damit der
// alte Acht-Block-Stapel nicht wiederkommt, sobald jemand eine neunte Meldung
// braucht.

import { describe, expect, it } from "vitest";
import {
  NOTICE_RANKS,
  noticeDurationMs,
  noticeOrder,
  reduceNotices,
  type NoticeItem,
} from "./Notices";

function item(over: Partial<NoticeItem> & { id: string }): NoticeItem {
  return { rank: "hint", text: "x", ...over };
}

describe("V3: reduceNotices", () => {
  it("keine Meldung und leere Texte ergeben nichts", () => {
    expect(reduceNotices([])).toBeNull();
    expect(reduceNotices([item({ id: "a", text: "   " })])).toBeNull();
  });

  it("eine Meldung bleibt unverändert — Text und Zweitzeile", () => {
    const result = reduceNotices([
      item({
        id: "a",
        rank: "warn",
        text: "Browser ist offline.",
        note: "Kein Live-Preis.",
      }),
    ]);
    expect(result?.rank).toBe("warn");
    expect(result?.text).toBe("Browser ist offline.");
    expect(result?.note).toBe("Kein Live-Preis.");
    expect(result?.merged).toBe(false);
  });

  it("der höchste Rang gewinnt — error vor warn vor hint vor success", () => {
    const result = reduceNotices([
      item({ id: "ok", rank: "success", text: "Auswahl gespeichert." }),
      item({ id: "offline", rank: "warn", text: "Browser ist offline." }),
      item({ id: "jobs", rank: "error", text: "Ein NAS-Job ist fehlgeschlagen." }),
    ]);
    expect(result?.rank).toBe("error");
    expect(result?.text).toBe("Ein NAS-Job ist fehlgeschlagen.");
    expect(result?.merged).toBe(false);
  });

  it("Gleichrangige werden aneinandergereiht statt gestapelt", () => {
    const result = reduceNotices([
      item({
        id: "queue",
        rank: "warn",
        text: "Zwei Einträge sind lokal vorgemerkt.",
      }),
      item({ id: "offline", rank: "warn", text: "Browser ist offline." }),
    ]);
    expect(result?.rank).toBe("warn");
    expect(result?.merged).toBe(true);
    expect(result?.text).toBe(
      "Zwei Einträge sind lokal vorgemerkt. · Browser ist offline.",
    );
  });

  it("der Handlungs-Knopf kommt aus der gewinnenden Meldung", () => {
    const result = reduceNotices([
      item({ id: "hint", rank: "hint", text: "Nur ein Hinweis." }),
      item({
        id: "jobs",
        rank: "error",
        text: "Ein NAS-Job ist fehlgeschlagen.",
        actionLabel: "Log ansehen",
        onAction: () => {},
      }),
    ]);
    expect(result?.actionLabel).toBe("Log ansehen");
    expect(result?.onAction).toBeTypeOf("function");
  });
});

describe("V3: Rang und Dauer", () => {
  it("die Rangfolge ist vollständig und geordnet", () => {
    expect(NOTICE_RANKS).toEqual(["error", "warn", "hint", "success"]);
    const values = NOTICE_RANKS.map(noticeOrder);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it("nur Störungen bleiben stehen — alles andere endet nach 6 Sekunden", () => {
    expect(noticeDurationMs("error")).toBeNull();
    expect(noticeDurationMs("warn")).toBe(6000);
    expect(noticeDurationMs("hint")).toBe(6000);
    expect(noticeDurationMs("success")).toBe(6000);
  });
});
