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

export function getDecisionView(overview: OverviewResponse | null, offline: boolean, stations: Station[] = []): DecisionView {
  if (offline) return { state: "offline", title: "Offline", detail: "Backend nicht erreichbar; letzter Stand ist möglicherweise veraltet.", price: null, stationName: null, validUntil: null, mapsUrl: null, saving: null };
  const decide: DecisionResponse | undefined = overview?.decide;
  const primary = decide?.primary;
  const station = primary?.station;
  const price = station?.price_now ?? null;
  const validUntil = decide?.valid_until ?? null;
  const saving = primary?.expected_saving_eur ?? null;
  if (!primary || !overview) return { state: "forecast", title: "Keine Prognose", detail: "Für diesen Ort und Kraftstoff liegt keine Entscheidung vor.", price: null, stationName: null, validUntil, mapsUrl: null, saving: null };
  if (primary.action === "refuel_now") return { state: "refuel", title: "Jetzt tanken", detail: primary.reason_short || "Der aktuelle Zeitpunkt ist günstig.", price, stationName: station?.name ?? null, validUntil, mapsUrl: station?.maps_url ?? null, saving };
  if (primary.action === "wait") return { state: "wait", title: "Warten", detail: primary.reason_short || "Ein späterer Zeitpunkt ist voraussichtlich günstiger.", price, stationName: station?.name ?? null, validUntil, mapsUrl: station?.maps_url ?? null, saving };
  const cheapest = stations.filter((item) => item.fresh && item.price != null && Number.isFinite(item.price)).sort((a, b) => a.price! - b.price!)[0];
  if (cheapest) {
    const range = stations.filter((item) => item.fresh && item.price != null).map((item) => item.price as number);
    const spread = range.length ? Math.max(...range) - Math.min(...range) : null;
    if (spread != null && spread <= 0.015) return { state: "close", title: "Kaum Unterschied", detail: "Die frischen Preise liegen eng beieinander.", price: cheapest.price, stationName: cheapest.name, validUntil, mapsUrl: cheapest.maps_url ?? null, saving };
    return { state: "compare", title: "Preisvergleich", detail: "Keine belastbare Tankempfehlung; günstigster frischer Preis im Vergleich.", price: cheapest.price, stationName: cheapest.name, validUntil, mapsUrl: cheapest.maps_url ?? null, saving };
  }
  return { state: "forecast", title: "Keine Prognose", detail: primary.reason_short || "Noch keine ausreichenden frischen Preise.", price, stationName: station?.name ?? null, validUntil, mapsUrl: station?.maps_url ?? null, saving };
}

export function validityLabel(validUntil: string | null | undefined, now = Date.now()): string {
  if (!validUntil || !Number.isFinite(Date.parse(validUntil))) return "—";
  const left = Date.parse(validUntil) - now;
  if (left <= 0) return "abgelaufen";
  const minutes = Math.ceil(left / 60_000);
  return minutes <= 30 ? `${minutes} Min. verbleibend` : `bis ${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(validUntil))}`;
}
