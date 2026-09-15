// Labor — die getrennte Mathematik (docs/UI-NEUENTWURF.md §6, §7).
//
// Diese Datei ist der **Adressraum** des Labors: die fünf Abschnitte plus
// Spielplatz, ihre Reihenfolge, ihre Überschriften und der Sprung von der
// Erklär-Treppe (Ebene 1) in den passenden Abschnitt (Ebene 2).
//
// Warum das hier steht und nicht in der View: Die Ansichten „Jetzt“,
// „Stationen“ und „Woche“ tragen je eine Ebene-1-Begründung, und jede nennt
// ihr Ziel. Läge die Zuordnung in den Views, gäbe es drei Listen, die
// auseinanderlaufen — genau der Fehler, den die Checkliste (3.2) vermeiden
// will: „Sprung klappt den passenden Abschnitt auf, scrollt hin und merkt
// sich die Herkunft“.

/** Die Abschnitte einer Labor-Seite, in fester Reihenfolge. */
export type LabSectionId =
  | "prognose"
  | "sicherheit"
  | "stationen"
  | "lernen"
  | "glossar"
  | "spielplatz";

export type LabSection = {
  id: LabSectionId;
  /** Nummer der Sprungleiste („1.“ … „5.“); Spielplatz trägt keine. */
  number: number | null;
  /** Aufklapp-Überschrift: die Alltagsfrage, nicht das Fachwort (§6.2). */
  question: string;
  /** Kurzform für Sprungleiste, Ebene-1-Knopf und „Zurück zu: …“. */
  short: string;
};

export const LAB_SECTIONS: LabSection[] = [
  {
    id: "prognose",
    number: 1,
    question: "Was sagt die App eigentlich vorher?",
    short: "Was die App vorhersagt",
  },
  {
    id: "sicherheit",
    number: 2,
    question: "Was heißt „ziemlich sicher“?",
    short: "Was „ziemlich sicher“ heißt",
  },
  {
    id: "stationen",
    number: 3,
    question: "Warum ist eine Station „meist günstig“?",
    short: "Warum eine Station meist günstig ist",
  },
  {
    id: "lernen",
    number: 4,
    question: "Wie lernt die App aus Fehlern?",
    short: "Wie die App aus Fehlern lernt",
  },
  {
    id: "glossar",
    number: 5,
    question: "Alle Begriffe von A–Z (Glossar)",
    short: "Glossar von A–Z",
  },
  {
    id: "spielplatz",
    number: null,
    question: "Spielplatz: Was wäre gewesen, wenn …?",
    short: "Spielplatz",
  },
];

/** Überschrift-Zeile der Sprungleiste: „1 · Prognose“-Form für Knöpfe. */
export function labSection(section: LabSectionId): LabSection {
  const found = LAB_SECTIONS.find((entry) => entry.id === section);
  // Kann nicht passieren (Id ist ein Typ) — der Fallback hält die Ansicht
  // aber auch dann bedienbar, wenn jemand eine Zeichenkette durchreicht.
  return (
    found ?? {
      id: "glossar",
      number: null,
      question: "Alle Begriffe von A–Z (Glossar)",
      short: "Glossar von A–Z",
    }
  );
}

/** Knopftext der Sprungleiste: „1 · Prognose“ bzw. „Spielplatz“. */
export function labSectionButtonLabel(section: LabSectionId): string {
  const entry = labSection(section);
  return entry.number ? `${entry.number} · ${entry.short}` : entry.short;
}

/**
 * Die Erklär-Treppe (Ebene 1 → 2): Ziel-Abschnitt plus Knopftext.
 *
 * `null` heißt: Diese Zahl hat (noch) keinen Beweis — dann zeigt das Sheet
 * ehrlich keinen Weg in die Tiefe, statt ins Leere zu führen.
 */
export type LabHint = { section: LabSectionId; label: string };

export function labHint(section: LabSectionId): LabHint {
  return {
    section,
    label: `Im Labor vertiefen: ${labSection(section).short}`,
  };
}

import { centPerLiter, euro, percentLabel, type AdviceDiaryEntry } from "./data";

/**
 * Wort zur Aktion eines Tagebuch-Eintrags — dieselben Wörter wie in „Jetzt“,
 * damit das Tagebuch nicht in Fachsprache abrutscht. Der Grau-Zustand heißt
 * hier wie in der Ampel-Karte (`now.ts`) „Keine klare Empfehlung“ — ein Label
 * für dieselbe Sache (TEXT-BEFUND T6).
 */
export function diaryActionWord(action: string | null | undefined): string {
  if (action === "wait") return "Warten";
  if (action === "refuel_now") return "Jetzt tanken";
  if (action === "refuel_elsewhere") return "Woanders tanken";
  if (action === "no_advice") return "Keine klare Empfehlung";
  return "Unbekannte Aktion";
}

/**
 * Die Ergebnis-Worte des Tagebuchs (MICROCOPY §4c) — die einzige erlaubte
 * Liste: `richtig` · `daneben` · `unentschieden` · `nicht bewertbar`. Nie
 * „Treffer“, nie „Fehler“, nie „Gleichstand“.
 */
export const DIARY_OUTCOME_WORDS = [
  "richtig",
  "daneben",
  "unentschieden",
  "nicht bewertbar",
] as const;

/** Filter-Kennung des Prognose-Tagebuchs. */
export type DiaryFilterId = "all" | "win" | "loss" | "tie" | "void";

/**
 * Filter-Chips des Tagebuchs — dieselben Worte wie die Einträge darunter
 * (TEXT-BEFUND T5), damit ein Panel sich nicht selbst widerspricht.
 */
export const DIARY_FILTERS: ReadonlyArray<{
  id: DiaryFilterId;
  label: string;
}> = [
  { id: "all", label: "Alle" },
  { id: "win", label: "Richtig" },
  { id: "loss", label: "Daneben" },
  { id: "tie", label: "Unentschieden" },
  { id: "void", label: "Nicht bewertbar" },
];

export type DiaryOutcome = {
  /** „richtig“ / „daneben“ / „unentschieden“ / „nicht bewertbar“. */
  word: string;
  tone: "good" | "bad" | "neutral";
  /** Zweite Zeile: Preisvergleich oder der Void-Grund im Klartext. */
  detail: string;
};

/**
 * Ein Tagebuch-Eintrag in Alltagssprache: Vorhersage → Wirklichkeit.
 *
 * Ton-Regel: Der Eintrag tadelt nicht und lobt nicht — er nennt Ergebnis und
 * Zahlen. Ein `void` ist kein Fehler des Nutzers, sondern eine ehrliche
 * Absage („nicht bewertbar“) mit Grund.
 */
export function diaryOutcome(entry: AdviceDiaryEntry): DiaryOutcome {
  if (entry.outcome === "win") {
    return {
      word: "richtig",
      tone: "good",
      detail: entry.price_window !== null && entry.price_then !== null
        ? `Preis im Fenster ${euro(entry.price_window, 3)} €/L statt ${euro(entry.price_then, 3)} €/L — ${centPerLiter(Math.abs((entry.price_then - entry.price_window) * 100))} Unterschied.`
        : "Die Empfehlung traf ein.",
    };
  }
  if (entry.outcome === "loss") {
    return {
      word: "daneben",
      tone: "bad",
      detail:
        entry.price_window !== null && entry.price_then !== null
          ? `Preis im Fenster ${euro(entry.price_window, 3)} €/L statt ${euro(entry.price_then, 3)} €/L` +
            (entry.regret_eur ? ` — ${euro(entry.regret_eur)} € teurer als sofort tanken.` : ".")
          : "Die Empfehlung traf nicht ein.",
    };
  }
  if (entry.outcome === "tie") {
    return {
      word: "unentschieden",
      tone: "neutral",
      detail: "Der Unterschied lag innerhalb der Schwelle für unentschieden (1 ct/L).",
    };
  }
  return {
    word: "nicht bewertbar",
    tone: "neutral",
    detail: `Kein Vergleichspreis — Grund: ${voidReasonWord(entry.void_reason)}.`,
  };
}

/** Void-Grund im Klartext (Codes aus app/feedback.py `_void_settlement`). */
export function voidReasonWord(reason: string | null | undefined): string {
  switch (reason) {
    case "no_advice":
      return "die Empfehlung war selbst schon „keine“";
    case "no_emit_price":
      return "kein Ankerpreis beim Aussprechen";
    case "legacy_no_window":
      return "Altdaten ohne Fensterzeit";
    case "beyond_series_range":
      return "Zeitpunkt außerhalb der Preis-Reihe";
    case "no_alt_station":
      return "Ausweichstation fehlt";
    case "no_station":
      return "Station fehlt";
    case "no_city":
      return "Stadt fehlt";
    case "no_realized_price":
      return "keine offene Meldung im Fenster";
    default:
      return "unbekannter Grund";
  }
}

/** Erklärzeile für ein leeres Tagebuch — Grund statt Leere (§10). */
export function diaryEmptyNote(reason: string | null | undefined): string {
  if (reason === "no_settlements") {
    return "Noch kein Eintrag abgerechnet: Die App rechnet jede Empfehlung erst nach Fensterende gegen die echten Preise ab (Worker „settlement“).";
  }
  if (reason === "no_advice_history") {
    return "Noch keine Empfehlung abgegeben — das Tagebuch beginnt mit der ersten Empfehlung aus „Jetzt“.";
  }
  return "Noch keine Einträge im Tagebuch.";
}

/** Gewicht einer Trefferquote in Worten — für die Vertrauens-Zeile. */
export function trustSentence(input: {
  promises: number | null;
  hits: number | null;
}): string {
  if (input.promises === null || input.hits === null || input.promises === 0) {
    return "Noch keine abgeschlossene Empfehlung — die Trefferquote entsteht aus abgerechneten Fällen, nicht aus Schätzungen.";
  }
  return `Versprochen waren die genannten Sicherheiten — eingetroffen sind ${percentLabel((input.hits / input.promises) * 100, 0)} davon.`;
}
