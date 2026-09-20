// Labor — die getrennte Mathematik (docs/produkt/UI.md, BereicheBEFUND B5).
//
// Diese Datei ist der **Adressraum** des Labors: die fünf alten Abschnitte
// plus Spielplatz (backward compat) und die vier neuen Sub-Tabs
// (Überblick, Modell & Parameter, Güte & Kalibrierung, Daten & Roh).
// Die Erklär-Treppe (Ebene 1) springt punktgenau: ?subtab=…&section=…#anchor.

/** Die Abschnitte einer Labor-Seite, in fester Reihenfolge (Alt, kompatibel). */
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

export function labSection(section: LabSectionId): LabSection {
  const found = LAB_SECTIONS.find((entry) => entry.id === section);
  return found ?? LAB_SECTIONS.find((entry) => entry.id === "glossar")!;
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
// B5: Vier Sub-Tabs — der neue Adressraum des Labors
// ---------------------------------------------------------------------------

export type LabSubTabId = "ueberblick" | "modell" | "guete" | "daten";

export type LabSubTab = {
  id: LabSubTabId;
  label: string;
  short: string;
  description: string;
};

export const LAB_SUBTABS: LabSubTab[] = [
  {
    id: "ueberblick",
    label: "Überblick",
    short: "Überblick",
    description:
      "Fan-Chart geführt: eine Prognose, drei Erklärstufen, Vertrauens-Konto + Tagebuch",
  },
  {
    id: "modell",
    label: "Modell & Parameter",
    short: "Modell",
    description:
      "Parameterschrank Karten 1–8 in Kettenreihenfolge Struktur→AR2→Bootstrap→12-Uhr→Ensemble→Selektion→Schwellen→Regime",
  },
  {
    id: "guete",
    label: "Güte & Kalibrierung",
    short: "Güte",
    description:
      "Rolling-PICP-Badges, Reliability/CalibChart, Brier-Verlauf, Backtest-Scoreboard, Heatmaps",
  },
  {
    id: "daten",
    label: "Daten & Rohdaten",
    short: "Daten",
    description: "Datenreichweite, Roh-Tabellen, CSV-Export, API-Explorer, 12-Uhr-Hinweis",
  },
];

export function labSubTab(id: LabSubTabId): LabSubTab {
  const found = LAB_SUBTABS.find((entry) => entry.id === id);
  return found ?? LAB_SUBTABS[0];
}

export const LAB_SECTION_TO_SUBTAB: Record<LabSectionId, LabSubTabId> = {
  prognose: "ueberblick",
  lernen: "ueberblick",
  sicherheit: "guete",
  stationen: "modell",
  glossar: "ueberblick",
  spielplatz: "modell",
};

export function labSubTabForSection(section: LabSectionId | null | undefined): LabSubTabId {
  if (!section) return "ueberblick";
  return LAB_SECTION_TO_SUBTAB[section] ?? "ueberblick";
}

export function labSubTabFromUrlId(value: string | null | undefined): LabSubTabId | null {
  if (!value) return null;
  const id = value.trim().toLowerCase();
  if (id === "ueberblick" || id === "überblick") return "ueberblick";
  if (id === "modell" || id === "model" || id === "parameter" || id === "parameterschrank")
    return "modell";
  if (id === "guete" || id === "güte" || id === "kalibrierung" || id === "sicherheit")
    return "guete";
  if (id === "daten" || id === "rohdaten" || id === "roh" || id === "data") return "daten";
  return null;
}

export function labSubTabButtonLabel(id: LabSubTabId): string {
  return labSubTab(id).label;
}

// ---------------------------------------------------------------------------
// B5: Parameterschrank — 8 Karten in Kettenreihenfolge
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
      "Das Strukturmodell beschreibt den üblichen Tages- und Wochenrhythmus — morgens teuer, abends billig, Sonntag anders — robust geschätzt mit Huber-IRLS, damit Ausreißer die Form nicht verbiegen.",
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
    chain: "Rohpfad → Segment [12:00–12:00) → isotone PAVA → Projektion",
    sentence:
      "Die 12-Uhr-Regel projiziert jeden Pfad auf nicht-steigend innerhalb eines [12:00–12:00)-Segments — nur an 12:00 darf er steigen, danach nur fallen, PAVA poolt Verstöße zu flachen Stufen.",
    anchor: "karte-4-projektion",
  },
  {
    id: "ensemble",
    number: 5,
    title: "Ensemble (Gewichte je Horizont)",
    chain: "Zwei Kerne → 14-Tage-Validierung → inverse-MASE-Gewichte → Spread",
    sentence:
      "Zwei Modellkerne (harmonisch + Tagesprofil) werden per inversem MASE auf 14 Validierungstagen gemischt — Gewichte je Horizont (24/72/168 h) im Backtest, weight_spread zeigt, ob das Mischverhältnis stabil ist.",
    anchor: "karte-5-ensemble",
  },
  {
    id: "selektion",
    number: 6,
    title: "Stations-Selektion δ̂",
    chain: "Vergleich → δ̂ → Bootstrap-CI → q-Wert → Ranking",
    sentence:
      "δ̂ ist der Preis-Abstand einer Station zum Stadt-Median derselben Stunde, über Wochen gemittelt — negatives δ̂ heißt günstiger als üblich, q-Wert korrigiert gegen falsche Entdeckungen.",
    anchor: "karte-6-selektion",
  },
  {
    id: "schwellen",
    number: 7,
    title: "Schwellen & Trefferquote (Beta-CI)",
    chain: "Empfehlungen → Trefferquote → Beta(5,5)-Posterior → CI → Tuning",
    sentence:
      "Neun Schwellen steuern „Warten/Jetzt/Woanders“ — ihre Trefferquote wird mit Beta(5,5)-Prior zu (hits+5)/(n+10) geglättet und als 95-%-Credible-Interval mit Beta-Quantilen ausgewiesen, nicht als Normal-Approximation.",
    anchor: "karte-7-schwellen",
  },
  {
    id: "regime",
    number: 8,
    title: "Regime & Rechtslagen",
    chain: "Kalender → δ̂/t̂-Schätzer → Dummy-Spalte → Projektions-Kante → Deckel → Zensierung",
    sentence:
      "Deklarierte Regime-Kanten (Config.regimes) laufen als Kalender → δ̂/t̂-Schätzer (slot-gematcht) → Dummy in features() → Projektions-Kante in _segment_bounds → Deckel cap(t) → Zensierung at_cap_points + p_at_cap — Status announced/detected/in_force, Quelle, Betrag je Sorte (§5.7/§5.12).",
    anchor: "karte-8-regime",
  },
];

export function paramCard(id: ParamCardId): ParamCard {
  const found = PARAM_CARDS.find((entry) => entry.id === id);
  return found ?? PARAM_CARDS[0];
}

// ---------------------------------------------------------------------------
// B5 M6b: Beta(5,5)-Credible-Interval der Trefferquote
// ---------------------------------------------------------------------------

function gammaln(x: number): number {
  const cof = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - gammaln(1 - x);
  }
  x -= 1;
  let a = cof[0];
  const t = x + cof.length - 1.5;
  for (let i = 1; i < cof.length; i++) a += cof[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 100;
  const EPS = 3e-7;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function betainc(x: number, a: number, b: number): number {
  if (x < 0 || x > 1) return NaN;
  if (x === 0 || x === 1) return x;
  const bt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  } else {
    return 1 - (bt * betacf(b, a, 1 - x)) / b;
  }
}

export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let low = 0;
  let high = 1;
  let mid = 0.5;
  for (let i = 0; i < 80; i++) {
    mid = (low + high) / 2;
    const inc = betainc(mid, a, b);
    if (!Number.isFinite(inc)) break;
    if (inc < p) low = mid;
    else high = mid;
    if (high - low < 1e-12) break;
  }
  return mid;
}

export type BetaCI = {
  hits: number;
  n: number;
  alpha: number;
  beta: number;
  mean: number;
  lo: number;
  hi: number;
  seNormal: number | null;
  loNormal: number | null;
  hiNormal: number | null;
};

export function betaCredibleInterval(
  hits: number,
  n: number,
  priorA = 5,
  priorB = 5,
): BetaCI | null {
  if (!Number.isFinite(hits) || !Number.isFinite(n) || n <= 0) return null;
  if (hits < 0 || hits > n) return null;
  const alpha = hits + priorA;
  const beta = n - hits + priorB;
  const mean = alpha / (alpha + beta);
  const lo = betaQuantile(0.025, alpha, beta);
  const hi = betaQuantile(0.975, alpha, beta);
  const pHat = n > 0 ? hits / n : null;
  const se =
    pHat !== null && n > 0 ? Math.sqrt((pHat * (1 - pHat)) / n) : null;
  const loN = se !== null && pHat !== null ? pHat - 1.96 * se : null;
  const hiN = se !== null && pHat !== null ? pHat + 1.96 * se : null;
  return {
    hits,
    n,
    alpha,
    beta,
    mean,
    lo,
    hi,
    seNormal: se,
    loNormal: loN !== null ? Math.max(0, Math.min(1, loN)) : null,
    hiNormal: hiN !== null ? Math.max(0, Math.min(1, hiN)) : null,
  };
}

// ---------------------------------------------------------------------------
// Tagebuch-Helpers (unchanged)
// ---------------------------------------------------------------------------

import {
  centPerLiter,
  euro,
  euroToCentPerLiter,
  percentLabel,
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

export function trustSentence(input: { promises: number | null; hits: number | null }): string {
  if (input.promises === null || input.hits === null || input.promises === 0) {
    return "Noch keine abgeschlossene Empfehlung — die Trefferquote entsteht aus abgerechneten Fällen, nicht aus Schätzungen.";
  }
  return `Versprochen waren die genannten Sicherheiten — eingetroffen sind ${percentLabel((input.hits / input.promises) * 100, 0)} davon.`;
}
