// Labor — der Adressraum der drei Beweis-Fragen
// (docs/planung/UX-NEUENTWURF.md §5, Batch 2 / 0.74.0).
//
// Das Labor hat seit Batch 2 **drei Blöcke, sonst nichts**:
//   1 · Kann ich vertrauen?        → #labor-sicherheit
//   2 · Wie gut ist die Prognose?  → #labor-prognose
//   3 · Wie rechnet die App?       → #labor-rechenweg
//
// Die alten Abschnitts- und Sub-Tab-Kennungen bleiben als URL-Aliase
// gültig (`?tab=labor&section=…` und `?subtab=…`), damit Lesezeichen und
// die Erklär-Treppe nicht brechen. `LAB_BLOCK_ANCHOR` ist die einzige
// Übersetzung von Abschnitt auf Block.

/** Die Abschnitte einer Labor-Seite — Reihenfolge = Reihenfolge der Blöcke. */
export type LabSectionId =
  | "prognose"
  | "sicherheit"
  | "stationen"
  | "lernen"
  | "glossar";

export type LabSection = {
  id: LabSectionId;
  /** Nummer des Blocks, in dem der Abschnitt wohnt; Glossar trägt keine. */
  number: number | null;
  /**
   * Kurzform für „Zurück zu: …“ und „Im Labor vertiefen: …“. Die
   * Alltagsfrage des Blocks steht genau einmal in {@link LAB_BLOCKS}.
   */
  short: string;
};

export const LAB_SECTIONS: LabSection[] = [
  {
    id: "sicherheit",
    number: 1,
    short: "Ob die Empfehlung stimmt",
  },
  {
    id: "prognose",
    number: 2,
    short: "Wie gut die Prognose ist",
  },
  {
    id: "stationen",
    number: 3,
    short: "Wie die App rechnet",
  },
  {
    id: "lernen",
    number: 1,
    short: "Wie die App aus Fehlern lernt",
  },
  {
    id: "glossar",
    number: null,
    short: "Glossar von A–Z",
  },
];

export function labSection(section: LabSectionId): LabSection {
  const found = LAB_SECTIONS.find((entry) => entry.id === section);
  return found ?? LAB_SECTIONS[0];
}

export function labSectionButtonLabel(section: LabSectionId): string {
  const entry = labSection(section);
  return entry.number ? `${entry.number} · ${entry.short}` : entry.short;
}

export type LabHint = { section: LabSectionId; label: string };

export function labHint(section: LabSectionId): LabHint {
  return {
    section,
    label: `Im Labor vertiefen: ${labSection(section).short}`,
  };
}

// ---------------------------------------------------------------------------
// Drei Blöcke — die einzigen Ziele im Labor
// ---------------------------------------------------------------------------

export type LabBlockId = "sicherheit" | "prognose" | "rechenweg";

export type LabBlock = {
  id: LabBlockId;
  number: number;
  /** Alltagsfrage (Ebene 1) und kurze Antwort darauf. */
  question: string;
  lead: string;
};

export const LAB_BLOCKS: LabBlock[] = [
  {
    id: "sicherheit",
    number: 1,
    question: "Kann ich vertrauen?",
    lead: "Jede Empfehlung wird nach ihrem Fenster gegen den echten Preis abgerechnet — gezählt, nicht geschätzt.",
  },
  {
    id: "prognose",
    number: 2,
    question: "Wie gut ist die Prognose?",
    lead: "Erwarteter Preis und echte Preise über sieben Tage — ein Bild, ein Satz.",
  },
  {
    id: "rechenweg",
    number: 3,
    question: "Wie rechnet die App?",
    lead: "Drei Schritte in Alltagssprache. Formeln und Fachwerte stehen darunter für Neugierige.",
  },
];

export function labBlock(id: LabBlockId): LabBlock {
  const found = LAB_BLOCKS.find((entry) => entry.id === id);
  return found ?? LAB_BLOCKS[0];
}

export const LAB_BLOCK_ANCHOR: Record<LabSectionId, LabBlockId> = {
  sicherheit: "sicherheit",
  lernen: "sicherheit",
  prognose: "prognose",
  stationen: "rechenweg",
  glossar: "rechenweg",
};

export function labBlockForSection(section: LabSectionId): LabBlockId {
  return LAB_BLOCK_ANCHOR[section] ?? "sicherheit";
}

export function labBlockAnchor(block: LabBlockId): string {
  return `labor-${block}`;
}

// ---------------------------------------------------------------------------
// Die acht Bausteine — hinter „Details für Neugierige“ gebündelt
// ---------------------------------------------------------------------------

export type ParamCardId =
  | "struktur"
  | "ar2"
  | "bootstrap"
  | "projektion"
  | "ensemble"
  | "selektion"
  | "schwellen"
  | "regime";

export type ParamCard = {
  id: ParamCardId;
  number: number;
  title: string;
  chain: string;
  sentence: string;
  anchor: string;
};

export const PARAM_CARDS: ParamCard[] = [
  {
    id: "struktur",
    number: 1,
    title: "Strukturmodell (Huber-IRLS)",
    chain: "Kalender → Huber-β → Tagesform",
    sentence:
      "Das Strukturmodell beschreibt den üblichen Tages- und Wochenrhythmus — Sprung um 12 Uhr, danach fallend, Sonntag anders — robust geschätzt mit Huber-IRLS, damit Ausreißer die Form nicht verbiegen.",
    anchor: "karte-1-struktur",
  },
  {
    id: "ar2",
    number: 2,
    title: "AR(2)-Rest & Stabilität",
    chain: "Residuen → φ₁/φ₂ → Wurzel-Check → Stauchung",
    sentence:
      "Der AR(2) fängt die kurzfristige Trägheit auf: War der Preis eben hoch, bleibt er meist noch kurz hoch — φ₁/φ₂ quantifizieren das, der Wurzel-Check staucht bei Instabilität.",
    anchor: "karte-2-ar2",
  },
  {
    id: "bootstrap",
    number: 3,
    title: "Bootstrap (Tagesblöcke)",
    chain: "Tagesblöcke → EW-Gewichte → shared/daily-pair → Ziehung",
    sentence:
      "Statt einzelner Punkte zieht der Bootstrap ganze Tage: So bleibt die Tagesform erhalten, neuere Tage zählen per EW-HWZ mehr, shared_draws koppelt Stationen, day_pair koppelt aufeinanderfolgende Tage.",
    anchor: "karte-3-bootstrap",
  },
  {
    id: "projektion",
    number: 4,
    title: "12-Uhr-Projektion (PAVA)",
    chain: "Rohpfad → Segment [12:00–12:00) + Regime-Kanten → isotone PAVA → Projektion",
    sentence:
      "Die 12-Uhr-Regel projiziert jeden Pfad auf nicht-steigend innerhalb eines [12:00–12:00)-Segments und zusätzlicher Regime-Kanten — nur an 12:00 und an deklarierten Regime-Kanten darf er steigen, danach nur fallen, PAVA poolt Verstöße zu flachen Stufen.",
    anchor: "karte-4-projektion",
  },
  {
    id: "ensemble",
    number: 5,
    title: "Ensemble (inverse MASE 1 Schritt, global)",
    chain: "Zwei Kerne → 14-Tage-Validierung → inverse-MASE-Gewichte → Spread",
    sentence:
      "Zwei Modellkerne (harmonisch + Tagesprofil) werden per inverser MASE 1 Schritt auf dem Validierungsfenster des Fits gemischt — global (one_step), horizon_weights 24/72/168 h derzeit not_estimated, weight_spread zeigt die Stabilität des Mischverhältnisses.",
    anchor: "karte-5-ensemble",
  },
  {
    id: "selektion",
    number: 6,
    title: "Stations-Selektion δ̂",
    chain: "Vergleich → δ̂ → Bootstrap-CI → q-Wert → Ranking",
    sentence:
      "δ̂ ist der Preis-Abstand einer Station zum Stadt-Median derselben Stunde, über Wochen gemittelt — negatives δ̂ heißt günstiger als üblich, q-Wert korrigiert gegen falsche Entdeckungen. Der Beleg steht in „Stationen“.",
    anchor: "karte-6-selektion",
  },
  {
    id: "schwellen",
    number: 7,
    title: "Schwellen & Trefferquote (Beta-CI)",
    chain: "Empfehlungen → Trefferquote → Beta(5,5)-Posterior → CI → Tuning",
    sentence:
      "Neun Schwellen steuern „Warten/Jetzt/Woanders“ — ihre Trefferquote wird mit Beta(5,5)-Prior geglättet und als 95-%-Interval mit Beta-Quantilen ausgewiesen, nicht als Normal-Approximation.",
    anchor: "karte-7-schwellen",
  },
  {
    id: "regime",
    number: 8,
    title: "Regime & Rechtslagen",
    chain: "Kalender → δ̂/t̂-Schätzer → Dummy-Spalte → Projektions-Kante → Deckel → Zensierung",
    sentence:
      "Deklarierte Regime-Kanten laufen als Kalender → δ̂/t̂-Schätzer (slot-gematcht) → Dummy in features() → Projektions-Kante → Deckel cap(t) → Zensierung at_cap_points + p_at_cap — Status announced/detected/in_force, Quelle und Betrag je Sorte.",
    anchor: "karte-8-regime",
  },
];

// ---------------------------------------------------------------------------
// Tagebuch-Helpers
// ---------------------------------------------------------------------------

import {
  centPerLiter,
  euro,
  euroToCentPerLiter,
  type AdviceDiaryEntry,
} from "./data";

export function diaryActionWord(action: string | null | undefined): string {
  if (action === "wait") return "Warten";
  if (action === "refuel_now") return "Jetzt tanken";
  if (action === "refuel_elsewhere") return "Woanders tanken";
  if (action === "no_advice") return "Keine klare Empfehlung";
  return "Unbekannte Aktion";
}

export const DIARY_OUTCOME_WORDS = [
  "richtig",
  "daneben",
  "unentschieden",
  "nicht bewertbar",
] as const;

export type DiaryFilterId = "all" | "win" | "loss" | "tie" | "void";

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
  word: string;
  tone: "good" | "bad" | "neutral";
  detail: string;
};

export function diaryOutcome(entry: AdviceDiaryEntry): DiaryOutcome {
  if (entry.outcome === "win") {
    return {
      word: "richtig",
      tone: "good",
      detail:
        entry.price_window !== null && entry.price_then !== null
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
    detail: entry.decline_reason
      ? `Kein Vergleichspreis — die App hatte hier keine Empfehlung: ${entry.decline_reason}`
      : `Kein Vergleichspreis — Grund: ${voidReasonWord(entry.void_reason)}.`,
  };
}

export type DiaryRow = {
  entry: AdviceDiaryEntry;
  count: number;
  oldest: string | null;
};

export function diaryStamp(entry: AdviceDiaryEntry): string | null {
  return entry.settled_at ?? entry.emitted_at;
}

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

export function diaryCountLabel(count: number, capped: boolean): string | null {
  if (count <= 1) return null;
  return capped ? "mehrfach" : `${count.toLocaleString("de-DE")}×`;
}

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

export function diaryEmptyNote(reason: string | null | undefined): string {
  if (reason === "no_settlements") {
    return "Noch kein Eintrag abgerechnet: Die App rechnet jede Empfehlung erst nach Fensterende gegen die echten Preise ab (Worker „settlement“).";
  }
  if (reason === "no_advice_history") {
    return "Noch keine Empfehlung abgegeben — das Tagebuch beginnt mit der ersten Empfehlung aus „Jetzt“.";
  }
  return "Noch keine Einträge im Tagebuch.";
}
