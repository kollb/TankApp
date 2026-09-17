// Belege (Wallet-Ledger): eine Quelle für die Werte, die Liste und Karte
// zeigen („Ich → Belege“, docs/UI-NEUENTWURF.md §5.4).
//
// Warum getrennt von der View: Die Belegliste steht mobil als Karte, ab `sm`
// als Tabelle. Beide lesen dieselben Felder aus `fillRow()` — vorher hätte die
// Kartenfassung Formatierung und Vorzeichen-Logik ein zweites Mal getragen,
// und die beiden Fassungen wären auseinandergelaufen (D1: die View rendert,
// sie entscheidet nichts).

import { euro, timeLabel, type Fill, type Station } from "./data";

export type FillRow = {
  id: string;
  /** Tankzeitpunkt als de-DE-Zeit (Europe/Berlin). */
  time: string;
  /** Name der Station, sonst ihre Kennung — nie leer. */
  station: string;
  /** „42,1 L · 1,725 €/L“ — Menge und gezahlter Preis in einer Zeile. */
  volume: string;
  /** Menge allein („42,1“) — für die Liter-Spalte der Tabelle. */
  liters: string;
  /** Gezahlter Preis allein („1,725 €/L“) — für die €/L-Spalte. */
  pricePerLiter: string;
  /**
   * Herkunftshinweis zum Preis — nur bei Prognosepreis gesetzt (O17, kein
   * gezahlter Preis): „Prognosepreis — kein gezahlter Preis“. Sonst null.
   */
  priceNote: string | null;
  /** „3,20 € günstiger“ / „1,10 € teurer“ / „—“ ohne Vergleichswert. */
  savings: string;
  /** Tonlage zur Ersparnis: positiv, negativ oder kein Vergleichswert. */
  savingsTone: "good" | "bad" | "none";
  /** „gebucht“ oder „storniert“ (A3: storniert statt gelöscht). */
  status: string;
  voided: boolean;
};

/**
 * Ein Beleg als fertige Anzeigezeile. `saved_vs_always_now_eur` ist der
 * Vergleich gegen „immer sofort tanken“ — fehlt er, steht „—“ statt einer
 * erfundenen Null.
 */
export function fillRow(fill: Fill): FillRow {
  const saved = fill.saved_vs_always_now_eur;
  return {
    id: fill.id,
    time: timeLabel(fill.tanked_at),
    station: fill.station_name || fill.station_id,
    volume: `${euro(fill.liters, 1)} L · ${euro(fill.price_paid, 3)} €/L`,
    liters: euro(fill.liters, 1),
    pricePerLiter: `${euro(fill.price_paid, 3)} €/L`,
    priceNote:
      fill.price_source === "prognose"
        ? "Prognosepreis — kein gezahlter Preis"
        : null,
    savings:
      saved == null
        ? "—"
        : `${euro(Math.abs(saved))} € ${saved >= 0 ? "günstiger" : "teurer"}`,
    savingsTone: saved == null ? "none" : saved >= 0 ? "good" : "bad",
    status: fill.voided ? "storniert" : "gebucht",
    voided: Boolean(fill.voided),
  };
}

export function fillRows(fills: Fill[]): FillRow[] {
  return fills.map(fillRow);
}

/**
 * O17: Preis für den Ein-Tipp-Beleg („Ja, wie empfohlen“) — ausschließlich
 * der frische Live-Preis der Beleg-Station, nie der Prognose-Median.
 * `null` ohne frischen Preis: Dann fragt die Erfassungs-Maske nach, statt
 * zu buchen. `priceOf` ist derselbe Helfer wie in der Stationsliste.
 */
export function promptFillPrice(
  stationId: string | null | undefined,
  stations: Station[],
  priceOf: (row: Station) => number | null,
): number | null {
  if (!stationId) return null;
  const row = stations.find((entry) => entry.station_id === stationId);
  if (!row) return null;
  const live = priceOf(row);
  return live !== null && Number.isFinite(live) ? live : null;
}
