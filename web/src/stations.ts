// Stationen — der Preis-Atlas (docs/UI-NEUENTWURF.md §5.2).
//
// Reine Logik, ohne DOM (D1): Referenz-Wahl, die Netto-€-Zeilen,
// Einordnungs-Sätze, A-gegen-B-Vergleich und die Frische-Fußzeile.
// Die Ansicht `views/Stationen.tsx` rendert, `stations.ts` rechnet —
// und beide Ehrlichkeits-Regeln, die das Atlas-Konzept tragen:
//
//   * Referenz statt Rangliste: jede Zahl steht im Vergleich zu einer
//     sichtbaren Referenz (Standard: ausgewählte Station, sonst
//     Stamm-Station, sonst die nächste mit frischem Preis).
//   * Netto-€ ist die Leitwährung: sortiert und gefärbt wird nach
//     Netto-€ (Sprit + Zeit − Umweg). Wo der Server die Umweg-Ökonomie
//     liefert (decide → alternatives_nearby), steht die Server-Zahl;
//     wo nicht, steht der Preisunterschied × Tankmenge mit dem Label
//     „ohne Umweg“ — nie eine client-seitige Strecke (B6/H1).

import { labHint, type LabHint } from "./lab";
import {
  centPerLiter,
  deTrimmed,
  detourVerdict,
  euro,
  ageLabel,
  freshness,
  type DecideResult,
  type Point,
  type Station,
} from "./data";

export type AtlasSort = "net" | "price" | "distance";

export const ATLAS_SORTS: Array<{ value: AtlasSort; label: string }> = [
  { value: "net", label: "Netto-€" },
  { value: "price", label: "Preis (€/L)" },
  { value: "distance", label: "Entfernung" },
];

export type ServerAlt = DecideResult["alternatives_nearby"][number];

export type AtlasRow = {
  station: Station;
  /** Aktueller Preis (null = kein frischer Wert). */
  price: number | null;
  /** Minuten seit der Meldung (null = keine). */
  ageMinutes: number | null;
  /** Ist die Referenz, an der sich die Netto-Zahlen messen. */
  isReference: boolean;
  isPinned: boolean;
  /** Rang unter den frischen Stationen (1 = günstigste), null ohne Preis. */
  rank: number | null;
  freshCount: number;
  /**
   * Server-Netto-€ ggü. der Referenz (Umweg inklusive) — nur, wenn der
   * Server diese Station als Alternative zur Referenz berechnet hat.
   */
  netEur: number | null;
  /** Preisunterschied × Tankmenge — reine Preisrechnung, ohne Umweg. */
  fillEur: number | null;
  /** Server-Urteil, nur mit netEur. */
  verdict: "worth" | "borderline" | "not_worth" | null;
  /** Server-Umweg in km (nur mit netEur), sonst Distanz zum Anker. */
  detourKm: number | null;
  distKm: number | null;
};

export type AtlasInput = {
  stations: Station[];
  /** Aktuelle Preise je Station (null = keine frische Meldung). */
  priceOf: (row: Station) => number | null;
  /** Tankmenge — multipliziert den Preisunterschied. */
  liters: number;
  /** Ausgewählte Station (Vergleichsstation). */
  selectedId: string;
  /** Stamm-Stationen (Pin-Reihenfolge). */
  pinnedIds: string[];
  /** decide → alternatives_nearby: Server-Netto-€ je Station. */
  serverAlts: ServerAlt[];
  /** Schwellen für das Server-Urteil (decide → thresholds.active). */
  worthThreshold: number | null;
  borderlineThreshold: number | null;
};

/**
 * Die Referenz-Station (UI-NEUENTWURF §5.2): Standard ist die
 * ausgewählte Station, sonst die erste Stamm-Station mit frischem
 * Preis, sonst die nächste mit frischem Preis. `null` = es gibt keine
 * frische Station, an der sich messen ließe.
 */
export function referenceStation(
  stations: Station[],
  priceOf: (row: Station) => number | null,
  selectedId: string,
  pinnedIds: string[],
): { station: Station; reason: "selected" | "pinned" | "nearest" } | null {
  const withPrice = (row: Station) => priceOf(row) !== null;
  const selected = stations.find((row) => row.station_id === selectedId);
  if (selected && withPrice(selected)) return { station: selected, reason: "selected" };
  const pinned = pinnedIds
    .map((id) => stations.find((row) => row.station_id === id))
    .find((row): row is Station => !!row && withPrice(row));
  if (pinned) return { station: pinned, reason: "pinned" };
  const nearest = [...stations]
    .filter(withPrice)
    .sort(
      (a, b) => (a.dist_km ?? Number.POSITIVE_INFINITY) - (b.dist_km ?? Number.POSITIVE_INFINITY),
    )[0];
  if (nearest) return { station: nearest, reason: "nearest" };
  return null;
}

/**
 * Die Atlas-Zeilen: je Station Preis, Rang, Pinned-Status und die
 * beiden €-Größen — Server-Netto (wo vorhanden) und Preisdiff ×
 * Tankmenge (immer, wenn beide Preise bekannt sind).
 */
export function atlasRows(input: AtlasInput): AtlasRow[] {
  const ref = referenceStation(
    input.stations,
    input.priceOf,
    input.selectedId,
    input.pinnedIds,
  );
  const refPrice = ref ? input.priceOf(ref.station) : null;
  const fresh = input.stations
    .map((row) => ({ row, price: input.priceOf(row) }))
    .filter((entry): entry is { row: Station; price: number } => entry.price !== null);
  fresh.sort((a, b) => a.price - b.price || a.row.name.localeCompare(b.row.name, "de"));

  return input.stations.map((station) => {
    const price = input.priceOf(station);
    const rank =
      price !== null
        ? fresh.findIndex((entry) => entry.row.station_id === station.station_id) + 1
        : null;
    const serverAlt = input.serverAlts.find((alt) => alt.station_id === station.station_id) ?? null;
    // Server-Netto gilt nur, wenn die Alternative zur *Referenz*
    // berechnet wurde (sonst mischen wir Bezugspunkte).
    const netEur =
      serverAlt && ref && serverAlt.station_id !== ref.station.station_id
        ? serverAlt.net_eur
        : null;
    const fillEur =
      price !== null && refPrice !== null
        ? (price - refPrice) * input.liters
        : null;
    const verdict =
      netEur !== null
        ? input.worthThreshold !== null && input.borderlineThreshold !== null
          ? detourVerdict(netEur, input.worthThreshold, input.borderlineThreshold)
          : serverAlt
            ? (serverAlt.verdict as "worth" | "borderline" | "not_worth")
            : null
        : null;
    // Server-Age zum Antwortzeitpunkt — die View addiert das Alter der
    // Antwort selbst (elapsed), wie im Alltagstab bisher.
    const age = station.observed_at ? (station.age_minutes ?? null) : null;
    return {
      station,
      price,
      ageMinutes: age,
      isReference: !!ref && ref.station.station_id === station.station_id,
      isPinned: input.pinnedIds.includes(station.station_id),
      rank,
      freshCount: fresh.length,
      netEur,
      fillEur,
      verdict,
      detourKm: netEur !== null ? (serverAlt?.detour_km_est ?? serverAlt?.detour_km ?? null) : null,
      distKm: station.dist_km ?? null,
    };
  });
}

/**
 * Sortierung der Atlas-Liste. Netto-€-Sortierung bevorzugt die
 * Server-Zahl und fällt auf Preisdiff × Tankmenge zurück — beides ist
 * eine €-Größe mit derselben Richtung (negativ = günstiger). Unbekannt
 * sortiert nach hinten, nie mit 0 verkleidet.
 */
export function sortAtlasRows(rows: AtlasRow[], sort: AtlasSort): AtlasRow[] {
  const value = (row: AtlasRow): number | null =>
    sort === "net" ? (row.netEur ?? row.fillEur) : sort === "price" ? row.price : row.distKm;
  const ordered = [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null)
      return a.station.name.localeCompare(b.station.name, "de");
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va !== vb) return va - vb;
    // Pinnen zuerst (in Pin-Reihenfolge) — dann Name.
    const pa = a.isPinned ? a.rank ?? 0 : Number.POSITIVE_INFINITY;
    const pb = b.isPinned ? b.rank ?? 0 : Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    return a.station.name.localeCompare(b.station.name, "de");
  });
  return ordered;
}

/**
 * Die €-Größe, die in der Zeile steht: Server-Netto, sonst
 * Preisdiff × Tankmenge. `label` benennt die Art, damit „netto“
 * nie mit einem bloßen Preisunterschied verwechselt wird.
 */
export function atlasEur(
  row: Pick<AtlasRow, "netEur" | "fillEur" | "isReference">,
): { text: string; tone: "save" | "cost" | "neutral" } | null {
  if (row.isReference) return null;
  const value = row.netEur ?? row.fillEur;
  if (value === null || !Number.isFinite(value)) return null;
  const tone: "save" | "cost" | "neutral" =
    value < -0.005 ? "save" : value > 0.005 ? "cost" : "neutral";
  return {
    text: `${value >= 0 ? "+" : "−"}${euro(Math.abs(value))} €`,
    tone,
  };
}

/**
 * Die drei Einordnungs-Zeilen einer Station (UI-NEUENTWURF §5.2
 * Station-Detail) — Alltagssprache, nur Server-/Set-Zahlen:
 *   1. Rang heute im eigenen Set (nicht Stadt-Median — den gibt es
 *      hier nicht; der historische Stadt-Vergleich steht in der
 *      Labor).
 *   2. Abstand zur Referenz (ct/L).
 *   3. Umweg (Server) oder Distanz zu Zuhause (Luftlinie/Fahrt).
 */
export function stationContextLines(
  row: AtlasRow,
  reference: AtlasRow | null,
): string[] {
  const lines: string[] = [];
  if (row.rank !== null && row.freshCount > 0) {
    lines.push(
      row.rank === 1
        ? `Gerade die günstigste deiner ${deTrimmed(row.freshCount, 0)} Stationen.`
        : `Gerade ${ordinals(row.rank)}-günstigste deiner ${deTrimmed(row.freshCount, 0)} Stationen.`,
    );
  } else {
    lines.push("Kein frischer Preis — die Einordnung steht erst mit der nächsten Meldung.");
  }
  if (reference && !row.isReference && row.price !== null && reference.price !== null) {
    const deltaCt = (row.price - reference.price) * 100;
    lines.push(
      Math.abs(deltaCt) < 0.05
        ? `Gleichauf mit der Referenz (${reference.station.name}).`
        : `${centPerLiter(Math.abs(deltaCt))} ${deltaCt > 0 ? "über" : "unter"} der Referenz (${reference.station.name}).`,
    );
  }
  if (row.detourKm !== null) {
    lines.push(`Umweg zur Referenz: +${euro(row.detourKm, 1)} km (Server-Route).`);
  } else if (row.distKm !== null) {
    lines.push(
      `${euro(row.distKm, 1)} km ab Zuhause ${
        
        row.station.dist_mode === "road" ? "(Fahrtstrecke)" : "(Luftlinie)"
      } — eine Umweg-Rechnung dazu liegt nicht vor.`,
    );
  }
  return lines;
}

/** „1.“ / „2.“ / „3.“ / „4.“ — nur für die Ränge, die es hier geben kann. */
function ordinals(n: number): string {
  return `${n}.`;
}

export type CompareResult = {
  a: Station;
  b: Station;
  priceA: number | null;
  priceB: number | null;
  /** ct/L: B minus A (negativ = B günstiger). */
  deltaCt: number | null;
  /** € pro Füllung: B minus A (negativ = B günstiger). */
  fillDeltaEur: number | null;
  /** Server-Umweg A→B (null = keine Route-Data). */
  detourKm: number | null;
  /** Server-Netto-€ für B ggü. A (null = keine Route-Data). */
  netEur: number | null;
  verdict: "worth" | "borderline" | "not_worth" | null;
  /** Ein Satz, der den Vergleich zusammenfasst — oder warum nicht. */
  sentence: string;
};

/**
 * A gegen B (UI-NEUENTWURF §5.2 „Vergleich ist ein eigener Modus“).
 * `serverAlt` ist die decide-Alternative, die B *gegen A* beschreibt —
 * vorhanden, wenn A die Vergleichsstation der Übersicht ist. Ohne
 * Server-Route bleibt der Vergleich ehrlich Preis-gegen-Preis.
 */
export function compareStationsPair(
  a: Station,
  b: Station,
  priceA: number | null,
  priceB: number | null,
  liters: number,
  serverAlt: ServerAlt | null,
): CompareResult {
  const deltaCt =
    priceA !== null && priceB !== null ? (priceB - priceA) * 100 : null;
  const fillDeltaEur = deltaCt !== null ? (deltaCt / 100) * liters : null;
  const netEur = serverAlt?.station_id === b.station_id ? serverAlt.net_eur : null;
  const detourKm =
    serverAlt?.station_id === b.station_id
      ? (serverAlt.detour_km_est ?? serverAlt.detour_km ?? null)
      : null;
  const verdict = serverAlt?.station_id === b.station_id ? serverAlt.verdict : null;

  let sentence: string;
  if (priceA === null || priceB === null) {
    sentence =
      "Noch kein frischer Preis auf beiden Seiten — der Vergleich steht mit der nächsten Meldung.";
  } else if (deltaCt === null) {
    sentence = "Keine Vergleichsbasis — Preise fehlen.";
  } else if (netEur !== null) {
    const worth = verdict === "worth";
    const borderline = verdict === "borderline";
    sentence = `${b.name} ist ${centPerLiter(Math.abs(deltaCt))} ${deltaCt > 0 ? "teurer" : "günstiger"}. ` +
      (detourKm !== null
        ? `Bei ${euro(detourKm, 1)} km Umweg: ${euro(netEur)} € netto pro Füllung. `
        : "") +
      (worth
        ? "Der Umweg rechnet sich."
        : borderline
          ? "Der Umweg ist grenzwertig."
          : "Der Umweg rechnet sich nicht.");
  } else if (Math.abs(deltaCt) < 0.05) {
    sentence = "Gleichauf — die Preise liegen aufeinander.";
  } else {
    sentence = `${b.name} ist ${centPerLiter(Math.abs(deltaCt))} ${deltaCt > 0 ? "teurer" : "günstiger"}. ` +
      `Pro ${deTrimmed(liters, 0)} L: ${fillDeltaEur !== null ? `${fillDeltaEur >= 0 ? "+" : "−"}${euro(Math.abs(fillDeltaEur))} €` : "—"} ` +
      "(ohne Umweg — zu diesem Paar liegt keine Route vor).";
  }

  return {
    a,
    b,
    priceA,
    priceB,
    deltaCt,
    fillDeltaEur,
    detourKm,
    netEur,
    verdict,
    sentence,
  };
}

/**
 * Ebene 1 für den Atlas (Erklär-Treppe §7): wofür die Netto-€-Zahlen
 * gut sind und was die Referenz ist — max. drei Sätze, mit Frische.
 */
export function atlasExplanation(input: {
  reference: { name: string } | null;
  reason: "selected" | "pinned" | "nearest" | null;
  liters: number;
  timeValueLabel: string;
  pricesAt: string | null;
  now?: number;
}): { sentences: string[]; source: string; labHint: LabHint | null } {
  const reasonText =
    input.reason === "pinned"
      ? "deiner Stamm-Station"
      : input.reason === "nearest"
        ? "der nächsten Station mit frischem Preis"
        : "der ausgewählten Station";
  const sentences: string[] = [];
  if (input.reference) {
    sentences.push(
      `Alle €-Zahlen messen sich an ${input.reference.name} — ${reasonText}.`,
    );
  } else {
    sentences.push(
      "Ohne frische Referenz steht kein €-Vergleich — erst die Preise, dann die Einordnung.",
    );
  }
  sentences.push(
    `„Netto“ rechnet Sprit + Zeit − Umweg (Zeitwert: ${input.timeValueLabel}); ` +
      `wo keine Route vorliegt, steht nur der Preisunterschied × ${deTrimmed(input.liters, 0)} L — als „ohne Umweg“ gekennzeichnet.`,
  );
  sentences.push(
    "Sortiert und gefärbt wird nach dieser €-Größe — der Literpreis ist die zweite Größe daneben.",
  );
  return {
    sentences: sentences.slice(0, 3),
    source: input.pricesAt
      ? `Grundlage: die geladenen Preismeldungen, jüngste ${ageLabel(input.pricesAt, input.now ?? Date.now())}.`
      : "Grundlage: die geladenen Preismeldungen.",
    labHint: labHint("stationen"),
  };
}

export type StationsFreshness = { text: string; tone: "ok" | "warn" | "bad" };

/** Frische-Fußzeile des Atlas: nur Preise (keine Prognose im Spiel). */
export function stationsFreshness(
  pricesAt: string | null,
  now = Date.now(),
): StationsFreshness {
  if (!pricesAt) return { text: "Kein Datenstand — noch nichts gemeldet", tone: "warn" };
  const state = freshness(pricesAt, "prices", now);
  const tone: StationsFreshness["tone"] =
    state === "old" ? "bad" : state === "stale" ? "warn" : "ok";
  return { text: `Preise ${ageLabel(pricesAt, now)}`, tone };
}

/**
 * Tagesprofil einer Station als Einordnungs-Zeile (Station-Detail):
 * aus den Messstunden des Tages die günstigste und teuerste offene
 * Stunde — „morgens meist teuer · abends meist günstig“ (§5.2
 * Tagesrhythmus). `null` ohne genug Messwerte (keine Muster-Erfindung).
 */
export function dayRhythmLine(cells: Array<{ hour: number; value: number | null }>): string | null {
  const known = cells.filter(
    (cell): cell is { hour: number; value: number } => cell.value !== null,
  );
  if (known.length < 6) return null;
  const morning = known.filter((c) => c.hour < 12);
  const evening = known.filter((c) => c.hour >= 12);
  const extremum = (
    list: Array<{ hour: number; value: number }>,
    pick: "min" | "max",
  ) =>
    list.reduce((best, c) =>
      pick === "min"
        ? c.value < best.value
          ? c
          : best
        : c.value > best.value
          ? c
          : best,
      list[0],
    );
  const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
  if (morning.length >= 3 && evening.length >= 3) {
    const cheapM = extremum(morning, "min");
    const cheapE = extremum(evening, "min");
    const priceyM = extremum(morning, "max");
    const priceyE = extremum(evening, "max");
    if (cheapE.value <= cheapM.value - 0.0005)
      return `Eher günstig am Abend (ca. ${hourLabel(cheapE.hour)}) · eher teuer am Morgen (ca. ${hourLabel(priceyM.hour)}).`;
    if (cheapM.value <= cheapE.value - 0.0005)
      return `Eher günstig am Morgen (ca. ${hourLabel(cheapM.hour)}) · eher teuer am Abend (ca. ${hourLabel(priceyE.hour)}).`;
    return `Kein starker Tag-Nacht-Unterschied — die günstigsten Stunden liegen bei ca. ${hourLabel(cheapM.hour)} und ${hourLabel(cheapE.hour)}.`;
  }
  const best = extremum(known, "min");
  return `Günstigste offene Stunde heute: ca. ${hourLabel(best.hour)}.`;
}

/**
 * Tagesmediane eines Verlaufs („üblich“ statt Moment, §5.2): je Berliner
 * Kalendertag der Median der offenen Meldungen, gesetzt auf den ersten
 * Messzeitpunkt des Tages.
 *
 * Geteilt zwischen dem Stations-Detail und dem Labor-Verlauf — beide zeigen
 * dieselbe Linie, und beide dürfen sie nicht unterschiedlich rechnen.
 */
export function dayMedianPoints(points: Point[]): Array<{ x: number; y: number }> {
  const active = points.filter(
    (point) =>
      point.price !== null &&
      Number.isFinite(point.price) &&
      Number.isFinite(Date.parse(point.timestamp)),
  );
  const byDay = new Map<string, { firstX: number; values: number[] }>();
  for (const point of active) {
    const ms = Date.parse(point.timestamp);
    const key = new Date(ms).toLocaleDateString("de-DE", {
      timeZone: "Europe/Berlin",
    });
    const entry = byDay.get(key);
    if (entry) {
      entry.values.push(point.price as number);
      if (ms < entry.firstX) entry.firstX = ms;
    } else {
      byDay.set(key, { firstX: ms, values: [point.price as number] });
    }
  }
  return [...byDay.values()]
    .map((entry) => {
      const sorted = [...entry.values].sort((a, b) => a - b);
      return { x: entry.firstX, y: sorted[Math.floor(sorted.length / 2)] };
    })
    .sort((a, b) => a.x - b.x);
}
