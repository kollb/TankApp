// Belege (Wallet-Ledger): eine Quelle für die Werte, die Liste und Karte
// zeigen („Ich → Belege“, docs/UI-NEUENTWURF.md §5.4).
//
// Warum getrennt von der View: Die Belegliste steht mobil als Karte, ab `sm`
// als Tabelle. Beide lesen dieselben Felder aus `fillRow()` — vorher hätte die
// Kartenfassung Formatierung und Vorzeichen-Logik ein zweites Mal getragen,
// und die beiden Fassungen wären auseinandergelaufen (D1: die View rendert,
// sie entscheidet nichts).

import {
  ageWord,
  centPerLiter,
  euro,
  euroPerLiter,
  germanDecimalToNumber,
  timeLabel,
  type Fill,
  type Station,
} from "./data";

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
  /** O8: strict window timing remains distinct from matching grace. */
  timing: string | null;
  /** O9: receipt-based detour net result and whether its km were actual/estimated. */
  elsewhereNet: string | null;
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
    timing:
      fill.settled === "im_fenster"
        ? "im empfohlenen Fenster"
        : fill.settled === "kulanz"
          ? "Kulanz: außerhalb des Fensters"
          : null,
    elsewhereNet:
      fill.elsewhere_net_eur == null
        ? null
        : `${euro(Math.abs(fill.elsewhere_net_eur))} € netto ${
            fill.elsewhere_net_eur >= 0 ? "günstiger" : "teurer"
          } (${fill.elsewhere_net_provenance?.distance_source === "actual_receipt" ? "gefahrene Strecke" : "Streckenschätzung"})`,
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

/**
 * O32 — Was neben dem Preisfeld der Belegmaske steht.
 *
 * Befund (docs/OPTIMIERUNGS-BEFUND.md O32): Das Feld wird aus dem Snapshot
 * vorbefüllt, und zwischen Empfehlung und Erfassung vergehen Minuten bis
 * Stunden (Offline-Queue). Der Nutzer sah eine Zahl, die alt sein konnte,
 * ohne Vergleich — also entweder blind abtippen oder die Stationsanzeige
 * suchen. Jetzt nennt die Maske den Live-Preis **mit Alter**, und eine
 * Abweichung über der Schwelle ist markiert.
 *
 * Bewusst ohne Automatik: Der getippte Wert wird nie überschrieben. Was hier
 * entsteht, ist eine Aussage, keine Korrektur — gezahlt hat der Nutzer, was
 * an der Säule stand, nicht was die App weiß.
 */
export const PRICE_DRIFT_CT = 1.0;

export type FillPriceHint = {
  /** „1,719 €/L“ — der frische Live-Preis der gewählten Station. */
  price: string;
  /** „vor 3 Minuten“ — Alter der Meldung, nie geraten. */
  age: string | null;
  /** Der Satz neben dem Feld, fertig formatiert. */
  text: string;
  /** Abweichung der Eingabe zum Live-Preis in ct/L (null: kein Vergleich). */
  driftCt: number | null;
  /** True, sobald die Abweichung die Schwelle überschreitet. */
  drifted: boolean;
  /** Der Hinweis zur Abweichung — nur gesetzt, wenn `drifted`. */
  driftText: string | null;
};

/**
 * Live-Preis, Alter und Abweichung für die Belegmaske. `null`, wenn die
 * Station keinen frischen Preis hat: Dann steht neben dem Feld nichts statt
 * einer Zahl ohne Deckung (die Ehrlichkeits-Regel gilt auch hier).
 *
 * `typed` ist der Rohtext des Feldes — verglichen wird nur, wenn er eine
 * Zahl ergibt. Die Schwelle ist bewusst grob (1 ct/L): Sie soll das echte
 * Auseinanderlaufen zeigen, nicht die dritte Nachkommastelle.
 */
export function fillPriceHint(input: {
  station: Station | null | undefined;
  livePrice: number | null;
  typed: string;
  now?: number;
}): FillPriceHint | null {
  const { station, livePrice, typed, now = Date.now() } = input;
  if (!station) return null;
  if (livePrice === null || !Number.isFinite(livePrice)) return null;

  const price = euroPerLiter(livePrice);
  // Das Alter kommt aus der Meldung selbst (`observed_at`); `age_minutes` ist
  // der Serverstand derselben Größe und springt ein, wenn der Zeitstempel
  // fehlt. Ohne beides bleibt das Alter ungenannt statt geschätzt.
  const observedMs = station.observed_at
    ? Date.parse(station.observed_at)
    : Number.NaN;
  const minutes = Number.isFinite(observedMs)
    ? Math.max(0, (now - observedMs) / 60000)
    : station.age_minutes !== null && Number.isFinite(station.age_minutes)
      ? station.age_minutes
      : null;
  const age = minutes === null ? null : ageWord(minutes);

  const value = germanDecimalToNumber(typed);
  const driftCt =
    value === null || !Number.isFinite(value)
      ? null
      : (value - livePrice) * 100;
  const drifted = driftCt !== null && Math.abs(driftCt) >= PRICE_DRIFT_CT;

  return {
    price,
    age,
    text: age
      ? `Jetzt an der Station: ${price}, gemeldet ${age}.`
      : `Jetzt an der Station: ${price}.`,
    driftCt,
    drifted,
    driftText: drifted
      ? `Deine Eingabe liegt ${centPerLiter(Math.abs(driftCt as number))} ` +
        `${(driftCt as number) > 0 ? "über" : "unter"} dem gemeldeten Preis — ` +
        `gebucht wird, was du eingibst.`
      : null,
  };
}
