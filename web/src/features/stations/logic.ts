import type { Station } from "../../api/types";

function hasFreshPrice(station: Station | undefined): station is Station & { price: number } {
  return Boolean(station?.fresh && station.price != null && Number.isFinite(station.price));
}

/** Prefer a valid explicit selection, then a pinned station, then the cheapest fresh price. */
export function referenceStationId(
  stations: Station[],
  selectedId: string,
  pinnedId: string,
): string {
  const selected = stations.find((station) => station.station_id === selectedId);
  if (hasFreshPrice(selected)) return selected.station_id;

  const pinned = stations.find((station) => station.station_id === pinnedId);
  if (hasFreshPrice(pinned)) return pinned.station_id;

  return [...stations]
    .filter(hasFreshPrice)
    .sort((a, b) => a.price - b.price)[0]?.station_id ?? "";
}
