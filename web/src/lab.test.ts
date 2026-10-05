// Labor: die reine Logik (UX-NEUENTWURF §5, Batch 2 / 0.74.0) — drei
// Blöcke, der Adressraum der alten Abschnitte und die Tagebuch-Sprache.
//
// Getestet werden die Zusagen, die der Umbau einklagt:
//   * Drei Blöcke in fester Reihenfolge — kein Sub-Tab, kein vierter Block.
//   * Jede alte Abschnitts-Kennung (`?section=…`) zeigt auf genau einen
//     dieser Blöcke; die acht Bausteine bleiben in Kettenreihenfolge.
//   * Ebene 2 findet ihr Ziel: `labHint` nennt den Abschnitt.
//   * Das Tagebuch spricht Alltag: Ergebnis-Wort, Grund und Formatter-Zahlen
//     — nie Fachsprache, nie eine Zahl ohne Einheit.

import { describe, expect, it } from "vitest";
import { timeLabel } from "./data";
import type { AdviceDiaryEntry } from "./data";
import {
  LAB_BLOCKS,
  LAB_SECTIONS,
  PARAM_CARDS,
  diaryActionWord,
  diaryCountLabel,
  diaryEmptyNote,
  diaryOutcome,
  diaryStamp,
  groupDiaryEntries,
  labBlockAnchor,
  labBlockForSection,
  labHint,
  labSection,
  labSectionButtonLabel,
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
    station_name: null,
    city: "Frankfurt",
    fuel: "e10",
    window_start: "2026-09-13T16:00:00Z",
    window_end: "2026-09-13T18:00:00Z",
    price_then: 1.789,
    price_window: 1.749,
    outcome: "win",
    void_reason: null,
    decline_reason: null,
    regret_eur: null,
    p_correct: 0.82,
    p_besser: null,
    liters: 40,
    intent: null,
    ...overrides,
  };
}

describe("Labor: drei Blöcke und ihr Adressraum (§5)", () => {
  it("hat genau drei Blöcke in fester Reihenfolge", () => {
    expect(LAB_BLOCKS.map((block) => block.id)).toEqual([
      "sicherheit",
      "prognose",
      "rechenweg",
    ]);
    expect(LAB_BLOCKS.map((block) => block.number)).toEqual([1, 2, 3]);
    for (const block of LAB_BLOCKS) {
      expect(block.question.length).toBeGreaterThan(0);
      expect(block.lead.length).toBeGreaterThan(0);
      expect(labBlockAnchor(block.id)).toBe(`labor-${block.id}`);
    }
  });

  it("übersetzt jede alte Abschnitts-Kennung auf genau einen Block", () => {
    expect(labBlockForSection("sicherheit")).toBe("sicherheit");
    expect(labBlockForSection("lernen")).toBe("sicherheit");
    expect(labBlockForSection("prognose")).toBe("prognose");
    expect(labBlockForSection("stationen")).toBe("rechenweg");
    expect(labBlockForSection("glossar")).toBe("rechenweg");
  });

  it("führt fünf URL-Abschnitte — der Spielplatz ist keiner mehr", () => {
    expect(LAB_SECTIONS.map((section) => section.id)).toEqual([
      "sicherheit",
      "prognose",
      "stationen",
      "lernen",
      "glossar",
    ]);
    expect(LAB_SECTIONS.map((section) => section.short)).not.toContain("Spielplatz");
    for (const section of LAB_SECTIONS) {
      expect(labBlockForSection(section.id)).toBeTruthy();
    }
  });

  it("liefert zu jeder Id eine Kurzform — und zu Unbekanntem keinen Absturz", () => {
    expect(labSection("lernen").short).toBe("Wie die App aus Fehlern lernt");
    expect(labSection("sicherheit").short).toBe("Ob die Empfehlung stimmt");
    // Durchgereichte Zeichenkette (nicht im Typ): die Ansicht bleibt bedienbar.
    expect(labSection("gibtsnicht" as LabSectionId).id).toBe("sicherheit");
  });

  it("beschriftet Sprungknöpfe mit Nummer, das Glossar ohne", () => {
    expect(labSectionButtonLabel("prognose")).toBe("2 · Wie gut die Prognose ist");
    expect(labSectionButtonLabel("stationen")).toBe("3 · Wie die App rechnet");
    expect(labSectionButtonLabel("glossar")).toBe("Glossar von A–Z");
  });

  it("nennt in Ebene 2 den Block, der die Zahl beweist (§7)", () => {
    expect(labHint("sicherheit")).toEqual({
      section: "sicherheit",
      label: "Im Labor vertiefen: Ob die Empfehlung stimmt",
    });
    expect(labHint("stationen").section).toBe("stationen");
  });

  it("hält die acht Bausteine in Kettenreihenfolge", () => {
    expect(PARAM_CARDS.map((card) => card.id)).toEqual([
      "struktur",
      "ar2",
      "bootstrap",
      "projektion",
      "ensemble",
      "selektion",
      "schwellen",
      "regime",
    ]);
    expect(PARAM_CARDS.map((card) => card.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    for (const card of PARAM_CARDS) {
      expect(card.anchor).toBe(`karte-${card.number}-${card.id}`);
    }
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

  it("nennt bei einer Ablehnung den Grund der Tabelle (nicht nur „keine“)", () => {
    const reason =
      "Preislage unentschieden — weder Warten noch Sofort-Tanken hat einen " +
      "Vorsprung. Die App rät nicht.";
    const result = diaryOutcome(
      entry({
        outcome: "void",
        action: "no_advice",
        void_reason: "no_advice",
        decline_reason: reason,
      }),
    );
    expect(result.word).toBe("nicht bewertbar");
    expect(result.detail).toBe(
      `Kein Vergleichspreis — die App hatte hier keine Empfehlung: ${reason}`,
    );
    // Ohne gespeicherten Grund (Altbestand) bleibt der Void-Code im Klartext.
    expect(
      diaryOutcome(
        entry({ outcome: "void", action: "no_advice", void_reason: "no_advice" }),
      ).detail,
    ).toBe(
      "Kein Vergleichspreis — Grund: die Empfehlung war selbst schon „keine“.",
    );
  });

  it("fasst gleiche Ablehnungen zu einer Zeile zusammen", () => {
    expect(timeLabel("2026-09-15T19:59:00Z")).toBe("15.09., 21:59");
    const decline = (emitted_at: string, settled_at: string) =>
      entry({
        outcome: "void",
        action: "no_advice",
        void_reason: "no_advice",
        decline_reason: "Preislage unentschieden.",
        emitted_at,
        settled_at,
      });
    // Die Liste kommt neueste zuerst: drei gleiche Zeilen (Altbestand aus der
    // Zeit vor dem Schreibverzicht), dazwischen nichts.
    const entries = [
      decline("2026-09-15T19:30:00Z", "2026-09-15T20:59:00Z"),
      decline("2026-09-15T19:00:00Z", "2026-09-15T20:01:00Z"),
      decline("2026-09-15T18:30:00Z", "2026-09-15T19:03:00Z"),
      entry({ outcome: "win", settled_at: "2026-09-14T20:05:00Z" }),
    ];
    const rows = groupDiaryEntries(entries);
    expect(rows.length).toBe(2);
    expect(rows[0].count).toBe(3);
    // Linke Kante: der erste Emit der Gruppe; rechte: die Abrechnung oben.
    expect(rows[0].oldest).toBe("2026-09-15T18:30:00Z");
    expect(diaryStamp(rows[0].entry)).toBe("2026-09-15T20:59:00Z");
    expect(rows[1].count).toBe(1);
    expect(rows[1].oldest).toBe("2026-09-13T16:00:00Z");
  });

  it("gruppiert nur Aufeinanderfolgendes und nur dieselbe Aussage", () => {
    const decline = (settled_at: string, reason: string) =>
      entry({
        outcome: "void",
        action: "no_advice",
        void_reason: "no_advice",
        decline_reason: reason,
        settled_at,
      });
    // Ein Treffer dazwischen trennt die Gruppen; ein anderer Grund auch.
    const rows = groupDiaryEntries([
      decline("2026-09-15T20:59:00Z", "Preislage unentschieden."),
      decline("2026-09-15T20:29:00Z", "Preislage unentschieden."),
      entry({ outcome: "tie", settled_at: "2026-09-15T18:05:00Z" }),
      decline("2026-09-15T17:59:00Z", "Preislage unentschieden."),
      decline("2026-09-15T17:29:00Z", "Keine Prognose verfügbar."),
    ]);
    expect(rows.map((row) => row.count)).toEqual([2, 1, 1, 1]);
    expect(rows[0].oldest).toBe("2026-09-13T16:00:00Z");
  });

  it("nennt die Anzahl nur, wenn die Liste sie hergibt", () => {
    // Gekürzte Liste: Jede Zahl wäre zu klein — „mehrfach“ ist die Untergrenze.
    expect(diaryCountLabel(49, true)).toBe("mehrfach");
    expect(diaryCountLabel(386, false)).toBe("386×");
    expect(diaryCountLabel(1, false)).toBeNull();
  });

  it("nimmt für den Zeitstempel einer Zeile die Abrechnung", () => {
    expect(diaryStamp(entry({ settled_at: "2026-09-15T20:59:00Z" }))).toBe(
      "2026-09-15T20:59:00Z",
    );
    // Altdaten ohne Abrechnungszeit: der eigene Emit-Zeitpunkt bleibt ehrlich.
    expect(diaryStamp(entry({ settled_at: null }))).toBe("2026-09-13T16:00:00Z");
  });
});
