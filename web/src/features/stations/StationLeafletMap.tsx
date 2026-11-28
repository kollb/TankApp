import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import type { Station, StationsResponse } from "../../api/types";
import { euroPerLiter, kilometers } from "../../utils/format";

function popupContent(station: Station, role: string): HTMLDivElement {
  const popup = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = station.name;
  const price = document.createElement("div");
  price.textContent = euroPerLiter(station.price);
  const meta = document.createElement("small");
  meta.textContent = `${role} · ${station.dist_km == null || !Number.isFinite(station.dist_km) ? "Entfernung —" : kilometers(station.dist_km)}`;
  popup.append(name, price, meta);
  return popup;
}

function markerIcon(station: Station, selectedId: string, referenceId: string): L.DivIcon {
  const classes = [
    "tank-map-pin",
    station.station_id === referenceId ? "is-reference" : "",
    station.station_id === selectedId ? "is-selected" : "",
  ].filter(Boolean).join(" ");
  return L.divIcon({
    className: classes,
    html: "•",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export function StationLeafletMap({
  stations,
  anchors,
  city,
  selectedId,
  referenceId,
  onSelect,
}: {
  stations: Station[];
  anchors?: StationsResponse["anchors"];
  city: string;
  selectedId: string;
  referenceId: string;
  onSelect: (stationId: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const locations = useMemo(
    () => stations.filter((station) =>
      typeof station.lat === "number" && Number.isFinite(station.lat) &&
      typeof station.lon === "number" && Number.isFinite(station.lon),
    ),
    [stations],
  );

  // The map and its markers follow the data, not the selection state. Rebuilding
  // Leaflet on every click discarded zoom, pan, and the marker's open popup.
  useEffect(() => {
    const element = host.current;
    if (!element || locations.length === 0) return;

    const anchor = anchors?.[city];
    const center: L.LatLngExpression = anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lon)
      ? [anchor.lat, anchor.lon]
      : [locations[0].lat as number, locations[0].lon as number];
    const map = L.map(element, {
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true,
    }).setView(center, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap-Mitwirkende",
    }).addTo(map);

    const bounds: L.LatLngExpression[] = [];
    for (const station of locations) {
      const position: L.LatLngExpression = [station.lat as number, station.lon as number];
      bounds.push(position);
      const role = station.station_id === referenceId
        ? "Referenz"
        : station.station_id === selectedId
          ? "Ausgewählt"
          : "Station";
      const marker = L.marker(position, {
        icon: markerIcon(station, selectedId, referenceId),
      }).addTo(map);
      marker.bindPopup(popupContent(station, role));
      marker.on("click", () => onSelect(station.station_id));
      markers.current.set(station.station_id, marker);
    }
    if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 14 });
    const resize = window.setTimeout(() => map.invalidateSize(), 80);

    return () => {
      window.clearTimeout(resize);
      map.remove();
      markers.current.clear();
    };
  }, [locations, anchors, city, onSelect]);

  useEffect(() => {
    for (const station of locations) {
      const marker = markers.current.get(station.station_id);
      if (!marker) continue;
      marker.setIcon(markerIcon(station, selectedId, referenceId));
      const role = station.station_id === referenceId
        ? "Referenz"
        : station.station_id === selectedId
          ? "Ausgewählt"
          : "Station";
      marker.setPopupContent(popupContent(station, role));
    }
  }, [locations, selectedId, referenceId]);

  return (
    <div className="station-leaflet-map" ref={host} role="application" aria-label="Interaktive Stationskarte">
      {locations.length === 0 && <span className="map-empty">Koordinaten nicht verfügbar</span>}
    </div>
  );
}
