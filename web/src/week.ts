// Woche — der Zeit-Planer (docs/produkt/UI.md, Bereiche;
// docs/planung/UX-NEUENTWURF.md §4).
//
// Frage: „Wann in den nächsten Tagen soll ich tanken?“ — Antwort: eine
// Bestenliste mit höchstens drei Einträgen, sortiert nach Ersparnis.
// Kein 7-Tage-Raster, keine Wochenlinie, keine zweite Liste: Der Server
// liefert maximal drei Fenster, vier Darstellungen dafür waren drei zu viel.
//
// Reine Logik, ohne DOM (D1): Tage, Ersparnis, Sicherheit als ein Wort und
// der Tank-Abgleich kommen hierher und sind hier getestet.
// Horizonte-Honesty: Die App zeigt die ganze Woche, verspricht aber nur, was
// die Engine liefert — ab Tag 5 steht der eine Satz „Ab Tag 5 wird die
// Prognose unsicher.“

import {
  centPerLiter,
  countLabel,
  deTrimmed,
  euro,
  euroPerLiter,
  windowTimeRangeLabel,
  kilometersLabel,
  percentLabel,
  type DecideResult,
  type TankInfo,
} from "./data";
import { labHint, type LabHint } from "./lab";
import { regimeDateLabel, windowPastRegimeEdge, type RegimeNotice } from "./regime";
import {
  dayLabel,
  hourApproxLabel,
  nowStage,
  wordFromPercent,
  windowSavingEur,
} from "./now";

export type WeekWindow = DecideResult["windows_week"][number];

/**
 * Ein Eintrag der Bestenliste (UX-NEUENTWURF §4). Genau eine Zeile je
 * Fenster: Tag + Uhrzeit, erwarteter Preis, Ersparnis in €, Sicherheit als
 * ein Wort. Kein Stern, kein Prozent, kein Kalibrierungs-Etikett.
 */
export type WeekEntry = {
  /** Fensterbeginn (ISO) — zugleich der Schlüssel der Liste. */
  id: string;
  /** 0 = heute … 6 (Berliner Kalendertag). */
  index: number;
  /** „Heute“ · „Morgen“ · „Freitag“. */
  dayLabel: string;
  /** „~19 Uhr“ — die genannte Stunde des Fensterbeginns. */
  timeLabel: string | null;
  /** „18–20 Uhr“ — das Fenster, wie der Server es liefert. */
  rangeLabel: string;
  /** „1,669 €/L“. */
  priceLabel: string;
  /** Ersparnis gegen den aktuellen Preis (€) — `null` = nicht belastbar. */
  savingEur: number | null;
  /** „spart ca. 3,60 €“ — `null` ohne belastbaren Abstand. */
  savingLabel: string | null;
  /** Ein Wort: „ziemlich sicher“ · „eher sicher“ · „unsicher“ ·
   *  „noch nicht messbar“. */
  security: string;
  /** `true` ab Tag 5 (Index 4) — die Prognose wird breiter. */
  uncertain: boolean;
  expectedPrice: number;
  start: string;
  end: string;
};

/**
 * Ab diesem Tag (Index, 0 = heute) trägt ein Fenster den Unsicherheits-
 * Hinweis. Die technische Wahrheit (PIT-Kalibrierung nur im 24-h-Pfad)
 * bleibt in System und Doku — der Alltag liest den einen Satz
 * (UX-NEUENTWURF §6, Vokabel-Diät).
 */
export const WEEK_UNCERTAIN_FROM_DAY = 4;

export const WEEK_UNCERTAIN_NOTE =
  "Ab Tag 5 wird die Prognose unsicher.";

/** Berliner Kalendertag als `YYYY-MM-DD` (en-CA) — die einzige Form, die
 *  `Date.parse` zuverlässig versteht. */
function berlinDateKey(value: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

/**
 * Die Bestenliste: höchstens drei Einträge, sortiert nach Ersparnis
 * (unbekannte Ersparnis nach hinten, dann der frühere Tag zuerst).
 * Tage ohne Fenster bleiben leer, nichts wird erfunden.
 */
export function weekRanking(input: {
  windows: WeekWindow[] | null | undefined;
  /** Preisniveau-Termin (Tankrabatt) — er entwertet Abstände hinter der Kante. */
  notice?: RegimeNotice | null;
  decide?: DecideResult | null;
  now?: number;
}): WeekEntry[] {
  const now = input.now ?? Date.now();
  const notice = input.notice ?? null;
  const stage = nowStage(input.decide ?? null);
  const startOfToday = berlinDateKey(now);

  // Je Kalendertag das beste Fenster (niedrigster Erwartungs-Preis) —
  // derselbe Tag kann mehrere Fenster tragen, gezeigt wird das beste.
  const byDay = new Map<string, WeekWindow>();
  for (const window of input.windows ?? []) {
    const ms = Date.parse(window.start);
    if (!Number.isFinite(ms)) continue;
    const key = berlinDateKey(ms);
    const current = byDay.get(key);
    if (!current || window.expected_price < current.expected_price) {
      byDay.set(key, window);
    }
  }

  const entries: WeekEntry[] = [];
  for (const [key, window] of byDay) {
    const index = Math.round(
      (Date.parse(`${key}T12:00:00Z`) - Date.parse(`${startOfToday}T12:00:00Z`)) /
        86400000,
    );
    if (!Number.isFinite(index) || index < 0 || index > 6) continue;
    const pastEdge = windowPastRegimeEdge(window, notice);
    const saving = pastEdge ? null : windowSavingEur(window);
    const percent =
      stage === "A" && window.p !== null && window.p !== undefined
        ? Math.round(window.p * 100)
        : null;
    // Befund A5 (23.09.2026): ohne gemessene Zahl heißt die Sicherheit
    // ehrlich „noch nicht messbar“ statt „wird noch gemessen“.
    const security =
      percent !== null ? wordFromPercent(percent) : "noch nicht messbar";
    entries.push({
      id: window.start,
      index,
      // „Heute“/„Morgen“ hängt am Referenzzeitpunkt — nicht an der realen
      // Uhr im Moment des Renderns (sonst kippt das Wort um Mitternacht).
      dayLabel: dayLabel(window.start, now),
      timeLabel: hourApproxLabel(window.start),
      rangeLabel: windowTimeRangeLabel(window.start, window.end),
      priceLabel: euroPerLiter(window.expected_price),
      savingEur: saving,
      savingLabel:
        saving != null && saving > 0
          ? `spart ca. ${euro(saving)} €`
          : null,
      security,
      uncertain: index >= WEEK_UNCERTAIN_FROM_DAY,
      expectedPrice: window.expected_price,
      start: window.start,
      end: window.end,
    });
  }

  entries.sort((a, b) => {
    const sa = a.savingEur;
    const sb = b.savingEur;
    if (sa == null && sb == null) return a.index - b.index;
    if (sa == null) return 1;
    if (sb == null) return -1;
    if (sb !== sa) return sb - sa;
    return a.index - b.index;
  });
  return entries.slice(0, 3);
}

/**
 * Der Tank als **Anzeige** (UX-NEUENTWURF §4/§6): gepflegt wird der Stand an
 * genau einem Ort („Ich“ → Fahrzeug); hier steht nur, was er bedeutet.
 * „Reicht bis Do“ wäre eine Behauptung ohne Routen-Daten — deshalb nennt die
 * Zeile die Reichweite, nicht ein Datum.
 */
export function weekTankLine(
  tank: TankInfo | null,
  tankPercent: number | null,
  tankCapacity: number,
): { text: string; detail: string | null } {
  if (tankPercent == null && !tank) {
    return {
      text: "Tank: keine Angabe",
      detail: "Mit dem Stand prüft die App, ob Warten riskant ist.",
    };
  }
  const percent = tankPercent !== null ? `${deTrimmed(tankPercent, 0)} %` : "—";
  const range = tank
    ? `Restreichweite ≈ ${kilometersLabel(tank.range_km)}`
    : `≈ ${deTrimmed(tankCapacity, 0)} L Tank`;
  return {
    text: `Tank: ${percent} · ${range}`,
    detail: tank
      ? `davon Reserve ≈ ${kilometersLabel(tank.reserve_range_km)}`
      : null,
  };
}

/**
 * Das Detail eines Eintrags — ein Tipp entfernt (Ebene 2). Höchstens fünf
 * Zeilen, Alltagssprache, mit dem Weg in die Tiefe.
 */
export function weekEntryWhy(
  entry: WeekEntry,
  decide: DecideResult | null,
  priceNow: number | null,
  now = Date.now(),
): { lines: string[]; source: string; labHint: LabHint | null } | null {
  const stage = nowStage(decide);
  const lines: string[] = [];

  lines.push(
    `Fenster ${entry.rangeLabel} — erwartet ${entry.priceLabel}.`,
  );

  const window = (decide?.windows_week ?? []).find(
    (item) => item.start === entry.id,
  );
  if (window && windowPastRegimeEdge(window, decide?.regime_notice ?? null)) {
    lines.push(
      `Zwischen jetzt und diesem Fenster liegt der Stichtag ${
        decide?.regime_notice ? regimeDateLabel(decide.regime_notice) : ""
      } — ein Abstand zum aktuellen Preis wäre nicht belastbar.`,
    );
  } else if (priceNow !== null) {
    const deltaCt = (priceNow - entry.expectedPrice) * 100;
    lines.push(
      deltaCt >= 0.05
        ? `Das sind ${centPerLiter(deltaCt)} unter dem aktuellen Preis.`
        : deltaCt <= -0.05
          ? `Das Fenster liegt ${centPerLiter(Math.abs(deltaCt))} über dem aktuellen Preis — Warten wäre teurer.`
          : "Der Vorsprung gegenüber dem aktuellen Preis ist klein.",
    );
  } else {
    lines.push("Der aktuelle Preis fehlt, deshalb steht kein Abstand.");
  }

  const advice = decide?.personal_stats?.advice;
  if (stage === "A" && advice && advice.last_30d_total > 0) {
    // Befund A3 (23.09.2026): Trefferzahl mit halben Unentschieden —
    // dieselbe Abrechnung wie die Quote dahinter.
    const hits = advice.last_30d_hits + (advice.last_30d_ties ?? 0) / 2;
    lines.push(
      `${entry.security} — an ${deTrimmed(hits, hits % 1 ? 1 : 0)} von ${countLabel(advice.last_30d_total)} Tagen richtig` +
        `${advice.hit_rate == null ? "" : ` (${percentLabel(advice.hit_rate * 100, 0)})`}.`,
    );
  } else {
    lines.push(entry.security);
  }

  if (entry.uncertain) lines.push(WEEK_UNCERTAIN_NOTE);

  const liters = decide?.quantity?.used_liters;
  if (entry.savingEur != null && liters != null) {
    lines.push(`Bei ${deTrimmed(liters, 0)} L spart das ca. ${euro(entry.savingEur)} €.`);
  }

  return {
    lines: lines.slice(0, 5),
    source: "Grundlage: der Modell-Lauf der Engine (Fenster und Erwartungs-Preise).",
    labHint: labHint("prognose"),
  };
}
