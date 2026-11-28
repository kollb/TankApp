import type { DecisionResponse, OverviewResponse, Station } from "../../api/types";

export type DecisionState = "refuel" | "wait" | "close" | "compare" | "offline" | "forecast";

export interface DecisionView {
  state: DecisionState;
  title: string;
  detail: string;
  price: number | null;
  stationName: string | null;
  validUntil: string | null;
  mapsUrl: string | null;
  saving: number | null;
}

function comparisonView(
  decide: DecisionResponse | undefined,
  stations: Station[],
): DecisionView {
  const cheapest = stations
    .filter((item) => item.fresh && item.price != null && Number.isFinite(item.price))
    .sort((a, b) => a.price! - b.price!)[0];
  if (!cheapest) {
    return {
      state: "forecast",
      title: "Keine Prognose",
      detail: decide?.blocking_reasons?.[0] ?? "Noch keine ausreichenden frischen Preise.",
      price: null,
      stationName: null,
      validUntil: null,
      mapsUrl: null,
      saving: null,
    };
  }

  const currentPrices = stations
    .filter((item) => item.fresh && item.price != null && Number.isFinite(item.price))
    .map((item) => item.price as number);
  const spread = currentPrices.length
    ? Math.max(...currentPrices) - Math.min(...currentPrices)
    : null;
  const close = spread != null && spread <= 0.015;
  return {
    state: close ? "close" : "compare",
    title: close ? "Kaum Unterschied" : "Preisvergleich",
    detail: close
      ? "Die frischen Preise liegen eng beieinander."
      : decide?.blocking_reasons?.[0] ?? "Keine belastbare Tankempfehlung; günstigster frischer Preis im Vergleich.",
    price: cheapest.price,
    stationName: cheapest.name,
    validUntil: null,
    mapsUrl: cheapest.maps_url ?? null,
    saving: null,
  };
}

export function getDecisionView(
  overview: OverviewResponse | null,
  offline: boolean,
  stations: Station[] = [],
): DecisionView {
  const decide: DecisionResponse | undefined = overview?.decide;
  const primary = decide?.primary;
  const station = primary?.station;

  if (offline) {
    return {
      state: "offline",
      title: "Offline",
      detail: "Backend nicht erreichbar; angezeigte Daten können veraltet sein.",
      price: station?.price_now ?? null,
      stationName: station?.name ?? null,
      validUntil: null,
      mapsUrl: null,
      saving: null,
    };
  }
  if (!primary || !station || !overview) {
    return {
      state: "forecast",
      title: "Keine Prognose",
      detail: "Für diesen Ort und Kraftstoff liegt keine Entscheidung vor.",
      price: null,
      stationName: null,
      validUntil: null,
      mapsUrl: null,
      saving: null,
    };
  }

  // The server's explicit release gate is authoritative. Never present a
  // wait/refuel action or expected saving from a blocked decision payload.
  if (decide.decision_ready === false || primary.action === "no_advice") {
    return comparisonView(decide, stations);
  }

  const validUntil = decide.valid_until ?? null;
  const saving = primary.expected_saving_eur ?? null;
  if (primary.action === "refuel_now") {
    return {
      state: "refuel",
      title: "Jetzt tanken",
      detail: primary.reason_short || "Der aktuelle Zeitpunkt ist günstig.",
      price: station.price_now,
      stationName: station.name,
      validUntil,
      mapsUrl: station.maps_url ?? null,
      saving,
    };
  }
  if (primary.action === "wait") {
    return {
      state: "wait",
      title: "Warten",
      detail: primary.reason_short || "Ein späterer Zeitpunkt ist voraussichtlich günstiger.",
      price: station.price_now,
      stationName: station.name,
      validUntil,
      mapsUrl: station.maps_url ?? null,
      saving,
    };
  }
  return comparisonView(decide, stations);
}

export function validityLabel(validUntil: string | null | undefined, now = Date.now()): string {
  if (!validUntil || !Number.isFinite(Date.parse(validUntil))) return "—";
  const left = Date.parse(validUntil) - now;
  if (left <= 0) return "abgelaufen";
  const minutes = Math.ceil(left / 60_000);
  return minutes <= 30
    ? `${minutes} Min. verbleibend`
    : `bis ${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(validUntil))}`;
}
