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
  // GUI-TEXT-BEFUND T1: Auch die Stellen, die außerhalb der Views Texte
  // setzen, gehören in die Prüfung — Kopfzeile, Navigation, der Aktions-Kanal
  // der Root und der Service Worker waren bis 0.41.1 ungeprüft.
  "components/AppHeader.tsx",
  "components/AppNav.tsx",
  "components/UpdateBanner.tsx",
  "service-worker.ts",
  "state/overview.tsx",
];

/**
 * Der Bereich „System“ ist die einzige Fläche, auf der Datei- und
 * Endpunkt-Namen stehen dürfen (MICROCOPY §6, Ausnahme T9) — ein Betreiber
 * richtet dort ein und diagnostiziert dort. `ApiExplorer` ist per Auftrag
 * technisch (er zeigt die API), `system.ts` liefert die Ebene-1-Texte des
 * System-Bereichs.
 */
const TECH_TEXT_ALLOWED = new Set([
  "system.ts",
  "views/System.tsx",
  "components/ApiExplorer.tsx",
]);

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

  // ── 6. Technik im Satz: Pfade, Dateien, Endpunkte (§6, GUI-TEXT-BEFUND T6) ──

  /**
   * §6 verbietet Pfade, Umgebungsvariablen und Endpunkte im Nutzertext; die
   * Ausnahme T9 ist der System-Bereich (`TECH_TEXT_ALLOWED`). Geprüft werden
   * Sätze, nicht Code: Ein Literal zählt als Satz, wenn es aus mindestens drei
   * Wörtern besteht und nicht mit `/`, `?` oder `#` anfängt — damit fallen
   * `fetch`-Pfade und CSS-Klassen heraus, aber „… (docs/INSTALL.md …)“ nicht.
   */
  const TECH_PATTERNS: ReadonlyArray<RegExp> = [
    /\/api\/v\d/,
    /\bTANKAPP_[A-Z_]+/,
    /\b[\w./-]+\.(?:md|json|log|env|py|ya?ml|csv|sh)\b/,
    /\b(?:data|ops|app|engine|docs|web|rp2)\/[\w./-]+/,
    /<job>/,
  ];

  function sentences(source: string): string[] {
    return [...userVisible(source).matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/gs)]
      .map((match) => match[2])
      .filter((value) => value.split(/\s+/).length >= 3 && !/^[/?#]/.test(value));
  }

  it.each(FILES)("%s: nennt keine Pfade, Dateien oder Umgebungsvariablen", (relativePath) => {
    if (TECH_TEXT_ALLOWED.has(relativePath)) return;
    const hits: string[] = [];
    for (const sentence of sentences(read(relativePath))) {
      for (const pattern of TECH_PATTERNS) {
        const match = sentence.match(pattern);
        if (match) hits.push(match[0]);
      }
    }
    expect(
      hits,
      `${relativePath}: Technik gehört in den System-Bereich oder in einen title (§6), nicht in diesen Satz.`,
    ).toEqual([]);
  });

  // ── 7. Anrede: Possessiv ja, direkte Anrede nein (§1, GUI-TEXT-BEFUND T1) ──

  /**
   * §1 (T10) lässt den Possessiv („deine Bilanz“) stehen und verbietet die
   * Anrede. Geprüft werden deshalb nur die Pronomen, die jemanden ansprechen:
   * `du`/`dir`/`dich` und die Höflichkeitsformen. „Sie“ als Pronomen der Sache
   * („Noch keine Zählung: Sie beginnt …“) ist erlaubt — es steht am Satzanfang,
   * die Anrede mitten im Satz.
   */
  const ADDRESS_PRONOUNS = [/\bdu\b/gi, /\bdir\b/gi, /\bdich\b/gi, /\bIhnen\b/g, /\bIhre[smnr]?\b/g];
  const SENTENCE_START = /[\s.:!?—–„„»({>["']*$/;

  function politeAddress(text: string): string[] {
    const hits: string[] = [];
    for (const match of text.matchAll(/Sie\b/g)) {
      const before = text.slice(Math.max(0, match.index - 60), match.index);
      if (!SENTENCE_START.test(before)) hits.push(before.slice(-24) + "Sie");
    }
    return hits;
  }

  it.each(FILES)("%s: spricht über die Sache, nicht den Nutzer an", (relativePath) => {
    const text = userVisible(read(relativePath));
    const hits: string[] = [];
    for (const pattern of ADDRESS_PRONOUNS) {
      for (const match of text.matchAll(pattern)) hits.push(match[0]);
    }
    hits.push(...politeAddress(text));
    expect(
      hits,
      `${relativePath}: direkte Anrede — §1 erlaubt den Possessiv, aber kein „du“/„Sie“.`,
    ).toEqual([]);
  });

  // ── 8. Dubletten: ein Satz, eine Stelle (§5, GUI-TEXT-BEFUND T5) ──

  /**
   * Prosa, keine Klassenliste: lang genug, mit Großbuchstabe oder
   * Satzzeichen, zwei Wörtern nebeneinander und ohne Markup. Was hier
   * übrig bleibt, ist ein Satz — und ein Satz steht genau einmal im Code.
   */
  const CLASSISH = /^[\sA-Za-z0-9:\-\/[\](){}$.%]+$/;

  function proseLiterals(source: string): string[] {
    return [...userVisible(source).matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/gs)]
      .map((match) => match[2].replace(/\s+/g, " ").trim())
      .filter((value) => value.length >= 25)
      .filter((value) => !/[<>]/.test(value))
      .filter((value) => !CLASSISH.test(value))
      .filter((value) => /[A-ZÄÖÜäöüß„“—]/.test(value))
      .filter((value) => /[a-zäöüß]{3}\s[a-zäöüß]{3}/.test(value));
  }

  it("dieselbe Aussage steht nicht zweimal im Code", () => {
    const seen = new Map<string, string[]>();
    for (const relativePath of FILES) {
      for (const literal of proseLiterals(read(relativePath))) {
        seen.set(literal, [...(seen.get(literal) ?? []), relativePath]);
      }
    }
    const duplicates = [...seen]
      .filter(([, files]) => files.length > 1)
      .map(([literal, files]) => `${files.join(" + ")}: „${literal.slice(0, 70)}“`);
    expect(
      duplicates,
      "Dublette — beim nächsten Wortwechsel wird eine Stelle vergessen. " +
        "Gemeinsame Konstante/Funktion in data.ts anlegen (T5).",
    ).toEqual([]);
  });

  // ── 9. Zustände: eine Formulierung je Zustand (§5, GUI-TEXT-BEFUND T8) ──

  /**
   * §5 (T8): Lädt „<Sache> wird geladen/berechnet“, der Retry-Knopf heißt
   * „Erneut laden“ oder „<Sache> neu laden“. Vier Verben und acht Knopftexte
   * für denselben Vorgang waren der Befund — die beiden Muster stehen hier.
   */
  it("Ladetexte nutzen „wird/werden geladen|berechnet“", () => {
    const allowed = /^[A-ZÄÖÜ][\wÄÖÜäöüß /-]*(wird|werden) (geladen|berechnet)$/;
    const offenders: string[] = [];
    for (const relativePath of FILES) {
      for (const match of read(relativePath).matchAll(/label="([^"]{4,})"/g)) {
        const label = match[1];
        if (!/geladen|berechnet/.test(label)) continue;
        if (!allowed.test(label)) {
          offenders.push(`${relativePath}: „${label}“`);
        }
      }
    }
    expect(offenders, "§5: „<Sache> wird geladen“ (Daten) / „wird berechnet“ (Rechnung).").toEqual([]);
  });

  it("Retry-Knöpfe haben eine von zwei Formen", () => {
    const allowed = /^(Erneut laden|[A-ZÄÖÜ][\wÄÖÜäöüß -]* neu laden)$/;
    const offenders: string[] = [];
    for (const relativePath of FILES) {
      for (const match of read(relativePath).matchAll(/retryLabel="([^"]+)"/g)) {
        if (!allowed.test(match[1])) offenders.push(`${relativePath}: „${match[1]}“`);
      }
    }
    expect(offenders, "§5: „Erneut laden“ oder „<Sache> neu laden“ — nichts drittes.").toEqual([]);
  });

  it("die Frische-Zeile kommt aus einem Baustein", () => {
    // T8: Fünf Ansichten bauten die Zeile selbst, jede mit eigener Ton-Tabelle
    // und eigenem `· kein Ort gewählt`. Der Baustein ist `FreshnessLine`.
    for (const relativePath of ["views/Jetzt.tsx", "views/Stationen.tsx", "views/Woche.tsx", "views/System.tsx", "views/Labor.tsx"]) {
      const source = read(relativePath);
      expect(source, `${relativePath}: Frische-Zeile ohne FreshnessLine.`).toContain("FreshnessLine");
      expect(
        source.includes('"kein Ort gewählt"'),
        `${relativePath}: „kein Ort gewählt“ steht im Baustein, nicht in der Ansicht.`,
      ).toBe(false);
    }
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
