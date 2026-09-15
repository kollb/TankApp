// F3: Microcopy-Ratchet zum Regelwerk in docs/MICROCOPY.md.
//
// Mechanisch prüfbare Regeln — genau die laufen ohne Prüfung auseinander:
//   1. Anführungszeichen in Nutzertexten sind `„…“` — paarig, in dieser
//      Reihenfolge, nie gemischt mit dem geraden `"` (das im Quelltext die
//      String- und JSX-Attribut-Syntax ist und deshalb nicht zählt).
//   2. Typografische Zeichen stehen als UTF-8 im Quelltext, nicht als
//      HTML-Entity — `&bdquo;`/`&quot;`/`&ldquo;` liest im Diff niemand.
//   3. Ausgemusterte Wörter und Doppelbenennungen (TEXT-BEFUND T6/T7/T8):
//      §4 entscheidet, und die Entscheidung gilt in jeder View.
//   4. Ergebnis-Worte des Tagebuchs (§4c) — nie „Treffer“, nie „Fehler“.
//   5. Kein Ausrufezeichen und kein `✓`/`!`-Präfix in Nutzertexten (§1):
//      Das Icon sagt es bereits (TEXT-BEFUND T2).
//
// Der Test liest die Quelldateien als Text; er ersetzt kein Lektorat, hält
// aber die Fehler auf, die ohne Prüfung zuverlässig zurückkommen.
//
// Gezählt wird **Nutzertext**: Kommentare (Herkunftsangaben wie
// „Prüfstand §1.5“ meinen das Analyse-Dokument) und `title`-Tooltips
// (dort darf das Fachwort stehen, §1) werden vorher herausgeschnitten.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DIARY_FILTERS,
  DIARY_OUTCOME_WORDS,
  diaryActionWord,
  diaryOutcome,
} from "./lab";
import type { AdviceDiaryEntry } from "./data";

/** Alles, was Nutzertexte enthält. Tests selbst bleiben außen vor. */
const FILES = [
  "Dashboard.tsx",
  "data-resource.test.tsx",
  "data.ts",
  "components/JobCard.tsx",
  "components/ApiExplorer.tsx",
  "components/CellError.tsx",
  "components/DataAge.tsx",
  "components/DataReach.tsx",
  "components/FeedbackBanner.tsx",
  "components/HeatmapGrid.tsx",
  "components/InstallHint.tsx",
  "install.ts",
  "components/LabCharts.tsx",
  "components/LineChart.tsx",
  "components/LoadError.tsx",
  "components/PrecisionSlider.tsx",
  "components/ProfileManager.tsx",
  "components/Skeleton.tsx",
  "components/StationMap.tsx",
  "components/ui.tsx",
  "components/Level1Sheet.tsx",
  "now.ts",
  "strip.ts",
  "stations.ts",
  "week.ts",
  "views/Jetzt.tsx",
  "views/Stationen.tsx",
  "views/Woche.tsx",
  "views/Ich.tsx",
  "lab.ts",
  "views/Labor.tsx",
  "system.ts",
  "views/System.tsx",
  "views/Settings.tsx",
  "views/Glossary.tsx",
];

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("F3: Microcopy-Regelwerk (docs/MICROCOPY.md)", () => {
  it.each(FILES)("%s: Anführungszeichen sind paarig „…“", (relativePath) => {
    const source = read(relativePath);
    const open = (source.match(/„/g) ?? []).length;
    const close = (source.match(/“/g) ?? []).length;
    expect(
      close,
      `${relativePath}: ${open}× „ aber ${close}× “ — jedes Zitat schließt mit “.`,
    ).toBe(open);
  });

  it.each(FILES)("%s: kein verirrtes ” (englisches Schlusszeichen)", (relativePath) => {
    expect((read(relativePath).match(/”/g) ?? []).length).toBe(0);
  });

  it.each(FILES)("%s: keine HTML-Entities für Anführungszeichen", (relativePath) => {
    const source = read(relativePath);
    for (const entity of ["&bdquo;", "&ldquo;", "&rdquo;", "&quot;", "&#34;"]) {
      expect(
        source.includes(entity),
        `${relativePath}: ${entity} gefunden — typografische Zeichen direkt als UTF-8 schreiben.`,
      ).toBe(false);
    }
  });

  // ── 3. Ausgemusterte Wörter und Doppelbenennungen (§4, TEXT-BEFUND T6–T8) ──

  /**
   * Wörter, die §4 ersetzt hat, und Synonyme, für die §4 **einen** Namen
   * festlegt. Der zweite Wert ist die Ansage im Fehler — ohne sie rät niemand,
   * was stattdessen hingehört.
   */
  const RETIRED: ReadonlyArray<{
    pattern: RegExp;
    instead: string;
  }> = [
    { pattern: /Prüfstand/g, instead: "Backtest" },
    { pattern: /Statistik/g, instead: "Kennzahlen der Engine" },
    { pattern: /\bBuchung/g, instead: "Beleg" },
    { pattern: /Tankbeleg/g, instead: "Beleg" },
    { pattern: /\bFüllung/g, instead: "Beleg" },
    { pattern: /Zurück zum Alltag/g, instead: "Zurück" },
    { pattern: /Cheap-Prob/g, instead: "Günstig-Chance (Fachwort in den title)" },
    { pattern: /\b(offpeak|Peak)\b/g, instead: "Nebenzeit / Stoßzeit" },
    { pattern: /out-of-sample/g, instead: "außerhalb der Stichprobe" },
    { pattern: /Hauspreis-Abstand/g, instead: "Preis-Abstand (δ̂)" },
    { pattern: /Entscheidungsverlust/g, instead: "Mehrkosten zum perfekten Timing" },
    { pattern: /Perfekte Sicht/g, instead: "Perfektes Timing (Orakel)" },
    { pattern: /Gleichstand/g, instead: "unentschieden" },
    { pattern: /\bTreffer\b/g, instead: "Trefferquote (Maßzahl) oder „richtig“ (Ergebnis)" },
  ];

  /** Kommentare und `title`-Tooltips zählen nicht als Nutzertext. */
  function userVisible(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(?<!:)\/\/[^\n]*/g, "")
      .replace(/title=(?:"[^"]*"|\{[^}]*\})/g, "");
  }

  it.each(FILES)("%s: keine ausgemusterten Wörter oder Synonyme", (relativePath) => {
    const text = userVisible(read(relativePath));
    for (const { pattern, instead } of RETIRED) {
      const hits = text.match(pattern);
      expect(
        hits,
        `${relativePath}: ${hits?.length}× ${pattern.source} — §4 sagt: ${instead}.`,
      ).toBeNull();
    }
  });

  // ── 4. Ergebnis-Worte des Tagebuchs (§4c) ──

  it("die Tagebuch-Filter sind die §4c-Ergebnis-Worte", () => {
    expect(DIARY_FILTERS.filter((option) => option.id !== "all").map((o) => o.label.toLowerCase())).toEqual([
      ...DIARY_OUTCOME_WORDS,
    ]);
  });

  it("jedes Tagebuch-Ergebnis nutzt ein Wort aus derselben Liste", () => {
    const entry = (outcome: string): AdviceDiaryEntry => ({
      snapshot_id: null,
      episode_id: null,
      settled_at: "2026-09-14T20:05:00Z",
      emitted_at: "2026-09-14T17:55:00Z",
      action: "wait",
      station_id: "a",
      station_name: "Station A",
      city: "Frankfurt",
      fuel: "e10",
      window_start: "2026-09-14T18:00:00Z",
      window_end: "2026-09-14T20:00:00Z",
      price_then: 1.7,
      price_window: 1.68,
      outcome,
      void_reason: null,
      decline_reason: null,
      refreshed_at: "2026-09-14T20:05:00Z",
      regret_eur: 0,
      p_correct: 0.8,
      p_besser: 0.7,
      liters: 40,
      intent: null,
    });
    for (const outcome of ["win", "loss", "tie", "void"]) {
      expect(
        DIARY_OUTCOME_WORDS as readonly string[],
        `Ergebnis „${outcome}“ fällt aus der §4c-Liste.`,
      ).toContain(diaryOutcome(entry(outcome)).word);
    }
  });

  it("der Grau-Zustand heißt überall „Keine klare Empfehlung“", () => {
    expect(diaryActionWord("no_advice")).toBe("Keine klare Empfehlung");
    const now = readFileSync(
      fileURLToPath(new URL("now.ts", import.meta.url)),
      "utf8",
    );
    expect(now).toContain('headline: "Keine klare Empfehlung"');
  });

  // ── 5. Tonfall: kein Ausrufezeichen, keine ✓/!-Präfixe (§1, T2) ──

  it.each(FILES)("%s: kein Ausrufezeichen am Satzende", (relativePath) => {
    // Nur `Wort!"` / `Wort!<` zählt — `!==` und `!pending` sind Code.
    const hits = read(relativePath).match(/[\wÄÖÜäöüß)\].…!?]!\s*["”<]/g) ?? [];
    expect(hits, `${relativePath}: Ausrufezeichen im Text — §1 verbietet es.`).toEqual(
      [],
    );
  });

  it.each(FILES)("%s: keine ✓/!-Präfixe vor Meldungen", (relativePath) => {
    const hits = read(relativePath).match(/["'`](?:✓|!)\s/g) ?? [];
    expect(
      hits,
      `${relativePath}: Ton gehört ins Icon (FeedbackBanner), nicht ins Wort.`,
    ).toEqual([]);
  });

  it("das Regelwerk selbst ist da und verlinkt", () => {
    const docs = readFileSync(
      fileURLToPath(new URL("../../docs/MICROCOPY.md", import.meta.url)),
      "utf8",
    );
    expect(docs).toMatch(/[Ee]hrlich, knapp, handlungsleitend/);
    const index = readFileSync(
      fileURLToPath(new URL("../../docs/README.md", import.meta.url)),
      "utf8",
    );
    expect(index).toContain("MICROCOPY.md");
  });
});
