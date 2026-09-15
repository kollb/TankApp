// Labor: die reine Logik (UI-NEUENTWURF §6/§7) — Abschnitte, Sprung,
// Tagebuch-Sprache.
//
// Getestet werden die drei Zusagen, die die Checkliste 3.1/3.2 einklagt:
//   * Fünf Abschnitte in fester Reihenfolge plus Spielplatz ohne Nummer —
//     diese Liste ist der Adressraum der Sprungleiste.
//   * Ebene 2 findet ihr Ziel: `labHint` nennt den Abschnitt, `labOriginLine`
//     die gemerkte Herkunft („Zurück zu: …“).
//   * Das Tagebuch spricht Alltag: Ergebnis-Wort, Grund und Formatter-Zahlen
//     — nie Fachsprache, nie eine Zahl ohne Einheit.

import { describe, expect, it } from "vitest";
import type { AdviceDiaryEntry } from "./data";
import {
  LAB_SECTIONS,
  diaryActionWord,
  diaryEmptyNote,
  diaryOutcome,
  labHint,
  labOriginLine,
  labSection,
  labSectionButtonLabel,
  trustSentence,
  voidReasonWord,
  type LabSectionId,
} from "./lab";

function entry(overrides: Partial<AdviceDiaryEntry>): AdviceDiaryEntry {
  return {
    snapshot_id: "snap-1",
    episode_id: "ep-1",
    settled_at: "2026-09-13T19:35:00Z",
    emitted_at: "2026-09-13T16:00:00Z",
    action: "wait",
    station_id: "st-1",
    city: "Frankfurt",
    fuel: "e10",
    window_start: "2026-09-13T16:00:00Z",
    window_end: "2026-09-13T18:00:00Z",
    price_then: 1.789,
    price_window: 1.749,
    outcome: "win",
    void_reason: null,
    regret_eur: null,
    p_correct: 0.82,
    p_besser: null,
    liters: 40,
    intent: null,
    ...overrides,
  };
}

describe("Labor: Abschnitte und Sprung (§6)", () => {
  it("führt fünf nummerierte Abschnitte in fester Reihenfolge plus Spielplatz", () => {
    expect(LAB_SECTIONS.map((section) => section.id)).toEqual([
      "prognose",
      "sicherheit",
      "stationen",
      "lernen",
      "glossar",
      "spielplatz",
    ]);
    expect(LAB_SECTIONS.map((section) => section.number)).toEqual([
      1, 2, 3, 4, 5, null,
    ]);
  });

  it("fragt in jeder Überschrift nach dem Alltag, nicht nach dem Fachwort", () => {
    for (const section of LAB_SECTIONS) {
      expect(section.question.length).toBeGreaterThan(0);
      expect(section.short.length).toBeGreaterThan(0);
      // Der Spielplatz ist ein Werkzeug; alle fünf Abschnitte sind Fragen.
      if (section.id !== "spielplatz" && section.id !== "glossar") {
        expect(section.question.endsWith("?")).toBe(true);
      }
    }
  });

  it("hält die Kurzform je Abschnitt eindeutig (Sprungleiste ist adressierbar)", () => {
    const shorts = LAB_SECTIONS.map((section) => section.short);
    expect(new Set(shorts).size).toBe(shorts.length);
  });

  it("liefert zu jeder Id die Überschrift — und zu Unbekanntem keinen Absturz", () => {
    expect(labSection("lernen").question).toBe("Wie lernt die App aus Fehlern?");
    // Durchgereichte Zeichenkette (nicht im Typ): die Ansicht bleibt bedienbar.
    expect(labSection("gibtsnicht" as LabSectionId).id).toBe("glossar");
  });

  it("beschriftet die Sprungleiste mit Nummer, der Spielplatz ohne", () => {
    expect(labSectionButtonLabel("prognose")).toBe("1 · Was die App vorhersagt");
    expect(labSectionButtonLabel("spielplatz")).toBe("Spielplatz");
  });

  it("nennt in Ebene 2 den Abschnitt, der die Zahl beweist (§7)", () => {
    expect(labHint("sicherheit")).toEqual({
      section: "sicherheit",
      label: "Im Labor vertiefen: Was „ziemlich sicher“ heißt",
    });
    expect(labHint("stationen").section).toBe("stationen");
  });

  it("merkt die Herkunft als „Zurück zu: …“ — und schweigt ohne Herkunft", () => {
    expect(labOriginLine(null)).toBeNull();
    expect(
      labOriginLine({ label: "Jetzt · Warum?", section: "sicherheit" }),
    ).toBe("Zurück zu: Jetzt · Warum?");
  });
});

describe("Labor: Tagebuch in Alltagssprache (§7.4)", () => {
  it("übersetzt die Aktionen wie „Jetzt“", () => {
    expect(diaryActionWord("wait")).toBe("Warten");
    expect(diaryActionWord("refuel_now")).toBe("Jetzt tanken");
    expect(diaryActionWord("refuel_elsewhere")).toBe("Woanders tanken");
    expect(diaryActionWord("no_advice")).toBe("Keine klare Empfehlung");
    expect(diaryActionWord(null)).toBe("Unbekannte Aktion");
    expect(diaryActionWord("irgendwas")).toBe("Unbekannte Aktion");
  });

  it("nennt einen Treffer „richtig“ und rechnet die Zahlen über die Formatter", () => {
    const result = diaryOutcome(entry({ outcome: "win" }));
    expect(result.word).toBe("richtig");
    expect(result.tone).toBe("good");
    expect(result.detail).toContain("1,749 €/L");
    expect(result.detail).toContain("1,789 €/L");
    expect(result.detail).toContain("4,0 ct/L");
  });

  it("sagt ohne Vergleichspreise nur das Ergebnis — ohne erfundene Zahl", () => {
    const result = diaryOutcome(
      entry({ outcome: "win", price_window: null, price_then: null }),
    );
    expect(result.detail).toBe("Die Empfehlung traf ein.");
  });

  it("nennt eine verpasste Empfehlung „daneben“ samt Mehrkosten", () => {
    const result = diaryOutcome(
      entry({ outcome: "loss", price_then: 1.719, price_window: 1.759, regret_eur: 1.6 }),
    );
    expect(result.word).toBe("daneben");
    expect(result.tone).toBe("bad");
    expect(result.detail).toContain("1,60 € teurer als sofort tanken");
    expect(diaryOutcome(entry({ outcome: "loss", price_window: null })).detail).toBe(
      "Die Empfehlung traf nicht ein.",
    );
  });

  it("wertet Gleichstand als „unentschieden“ statt als Sieg", () => {
    const result = diaryOutcome(entry({ outcome: "tie" }));
    expect(result.word).toBe("unentschieden");
    expect(result.tone).toBe("neutral");
    expect(result.detail).toContain("1 ct/L");
  });

  it("tadelt einen nicht bewertbaren Fall nicht, sondern nennt den Grund", () => {
    const result = diaryOutcome(
      entry({ outcome: "void", void_reason: "no_realized_price" }),
    );
    expect(result.word).toBe("nicht bewertbar");
    expect(result.tone).toBe("neutral");
    expect(result.detail).toBe(
      "Kein Vergleichspreis — Grund: keine offene Meldung im Fenster.",
    );
  });

  it("übersetzt jeden Void-Code aus app/feedback.py", () => {
    expect(voidReasonWord("no_advice")).toBe("die Empfehlung war selbst schon „keine“");
    expect(voidReasonWord("no_emit_price")).toBe("kein Ankerpreis beim Aussprechen");
    expect(voidReasonWord("legacy_no_window")).toBe("Altdaten ohne Fensterzeit");
    expect(voidReasonWord("beyond_series_range")).toBe(
      "Zeitpunkt außerhalb der Preis-Reihe",
    );
    expect(voidReasonWord("no_alt_station")).toBe("Ausweichstation fehlt");
    expect(voidReasonWord("no_station")).toBe("Station fehlt");
    expect(voidReasonWord("no_city")).toBe("Stadt fehlt");
    expect(voidReasonWord("no_realized_price")).toBe("keine offene Meldung im Fenster");
    expect(voidReasonWord("neu")).toBe("unbekannter Grund");
    expect(voidReasonWord(null)).toBe("unbekannter Grund");
  });

  it("erklärt ein leeres Tagebuch mit dem Server-Grund (§10)", () => {
    expect(diaryEmptyNote("no_settlements")).toContain("Worker „settlement“");
    expect(diaryEmptyNote("no_advice_history")).toContain(
      "beginnt mit der ersten Empfehlung aus „Jetzt“",
    );
    expect(diaryEmptyNote(null)).toBe("Noch keine Einträge im Tagebuch.");
  });

  it("spricht die Trefferquote erst aus, wenn Fälle abgerechnet sind", () => {
    expect(trustSentence({ promises: null, hits: null })).toContain(
      "Noch keine abgeschlossene Empfehlung",
    );
    expect(trustSentence({ promises: 0, hits: 0 })).toContain(
      "Noch keine abgeschlossene Empfehlung",
    );
    expect(trustSentence({ promises: 3, hits: 2 })).toContain("67 % davon");
  });
});
