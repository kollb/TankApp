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
  // T5: Der Fallback ist der Glossar-Abschnitt selbst — kein zweiter Text.
  return found ?? LAB_SECTIONS.find((entry) => entry.id === "glossar")!;
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

import {
  centPerLiter,
  euro,
  euroToCentPerLiter,
  percentLabel,
  type AdviceDiaryEntry,
} from "./data";

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
        ? `Preis im Fenster ${euro(entry.price_window, 3)} €/L statt ${euro(entry.price_then, 3)} €/L — ${centPerLiter(Math.abs(euroToCentPerLiter(entry.price_then - entry.price_window) ?? 0))} Unterschied.`
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
    // Zwei Fälle, zwei Sätze: Bei einer Ablehnung nennt der Ledger seit
    // 0.40.0 den Grund der Tabelle („warum nichts vorgeschlagen wurde“);
    // Altbestände tragen nur den Void-Code.
    detail: entry.decline_reason
      ? `Kein Vergleichspreis — die App hatte hier keine Empfehlung: ${entry.decline_reason}`
      : `Kein Vergleichspreis — Grund: ${voidReasonWord(entry.void_reason)}.`,
  };
}

/**
 * Eine Zeile der Tagebuch-Liste: ein Eintrag — oder mehrere gleiche.
 *
 * Warum gruppiert wird: Solange ein Fenster offen ist, bestätigt die App die
 * Entscheidung „keine Empfehlung“ bei jeder Abfrage. Vor 0.40.0 wurde daraus
 * alle 30 Minuten ein eigener Ledger-Eintrag; alte Bestände tragen diese
 * Zeilen weiter, und im Tagebuch stand dann 50-mal derselbe Satz — die vier
 * echten Empfehlungen fielen aus der Liste. Seit 0.40.0 schreibt eine
 * Bestätigung nichts mehr in den Ledger (siehe `app/feedback.py`), und
 * vorhandene Wiederholungen bleiben hier **eine** Zeile: Wort, Station,
 * Zeitspanne, Anzahl.
 */
export type DiaryRow = {
  entry: AdviceDiaryEntry;
  /** Wie viele Einträge der Liste zu dieser Zeile gehören (mindestens 1). */
  count: number;
  /**
   * Erste Bestätigung der Gruppe (ISO, `emitted_at`) — die linke Kante der
   * Zeitspanne; bei `count === 1` ist sie der eigene Emit-Zeitpunkt.
   */
  oldest: string | null;
};

/** Zeitstempel einer Zeile: die Abrechnung des Falls. */
export function diaryStamp(entry: AdviceDiaryEntry): string | null {
  return entry.settled_at ?? entry.emitted_at;
}

/** Zwei Einträge sind dieselbe Aussage: gleiche Ablehnung, gleiche Station. */
function sameDiaryRow(a: AdviceDiaryEntry, b: AdviceDiaryEntry): boolean {
  const decline = (entry: AdviceDiaryEntry) =>
    entry.outcome !== "win" && entry.outcome !== "loss" && entry.outcome !== "tie";
  return (
    decline(a) &&
    decline(b) &&
    a.action === b.action &&
    a.station_id === b.station_id &&
    a.void_reason === b.void_reason &&
    a.decline_reason === b.decline_reason
  );
}

/**
 * Fasst aufeinanderfolgende gleiche Einträge zusammen (die Liste kommt
 * neueste zuerst). Die Gruppierung läuft **nur** über die geladenen
 * Einträge — deshalb nennt die Anzeige die Anzahl nur dann als Zahl, wenn
 * die Liste vollständig ist (`diaryCountLabel`).
 *
 * Die Zeitspanne wird aus den echten Zeitstempeln gebildet: `emitted_at` der
 * ältesten Zeile (erste Bestätigung) bis `diaryStamp` der neuesten
 * (Abrechnung). `emitted_at` bleibt beim Kollabieren der erste Emit — genau
 * der Zeitpunkt, seit dem die App dasselbe sagt.
 */
export function groupDiaryEntries(entries: AdviceDiaryEntry[]): DiaryRow[] {
  const rows: DiaryRow[] = [];
  for (const entry of entries) {
    const previous = rows[rows.length - 1];
    if (previous && sameDiaryRow(previous.entry, entry)) {
      previous.count += 1;
      previous.oldest = entry.emitted_at ?? previous.oldest;
      continue;
    }
    rows.push({ entry, count: 1, oldest: entry.emitted_at ?? diaryStamp(entry) });
  }
  return rows;
}

/**
 * Anzahl-Spanne einer Zeile. `capped` heißt: Der Server hat die Liste
 * gekürzt (mehr Settlements als geladene Einträge) — dann ist jede Zahl aus
 * der Liste eine Untergrenze, und „mehrfach“ ist die ehrliche Aussage.
 */
export function diaryCountLabel(count: number, capped: boolean): string | null {
  if (count <= 1) return null;
  return capped ? "mehrfach" : `${count.toLocaleString("de-DE")}×`;
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
