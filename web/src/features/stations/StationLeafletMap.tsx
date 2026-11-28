import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Station, StationsResponse } from "../../api/types";
import { euroPerLiter, kilometers } from "../../utils/format";

export function StationLeafletMap({ stations, anchors, city, selectedId, referenceId, onSelect }: {
  stations: Station[];
  anchors?: StationsResponse["anchors"];
  city: string;
  selectedId: string;
  referenceId: string;
  onSelect: (stationId: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const locations = stations.filter((station) => typeof station.lat === "number" && typeof station.lon === "number");
  useEffect(() => {
    const element = host.current;
    if (!element || locations.length === 0) return;
    const anchor = anchors?.[city];
    const center: L.LatLngExpression = anchor ? [anchor.lat, anchor.lon] : [locations[0].lat as number, locations[0].lon as number];
    const map = L.map(element, { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView(center, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap-Mitwirkende" }).addTo(map);
    const bounds: L.LatLngExpression[] = [];
    locations.forEach((station) => {
      const position: L.LatLngExpression = [station.lat as number, station.lon as number];
      bounds.push(position);
      const role = station.station_id === referenceId ? "Referenz" : station.station_id === selectedId ? "Ausgewählt" : "Station";
      const marker = L.marker(position, { icon: L.divIcon({ className: `tank-map-pin ${station.station_id === referenceId ? "is-reference" : ""} ${station.station_id === selectedId ? "is-selected" : ""}`, html: "•", iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(map);
      const popup = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = station.name;
      const price = document.createElement("div"); price.textContent = euroPerLiter(station.price);
      const meta = document.createElement("small"); meta.textContent = `${role} · ${station.dist_km == null || !Number.isFinite(station.dist_km) ? "Entfernung —" : kilometers(station.dist_km)}`;
      popup.append(name, price, meta); marker.bindPopup(popup);
      marker.on("click", () => onSelect(station.station_id));
    });
    if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 14 });
    const resize = window.setTimeout(() => map.invalidateSize(), 80);
    return () => { window.clearTimeout(resize); map.remove(); };
  }, [locations, anchors, city, selectedId, referenceId, onSelect]);
  return <div className="station-leaflet-map" ref={host} role="application" aria-label="Interaktive Stationskarte">
    {locations.length === 0 && <span className="map-empty">Koordinaten nicht verfügbar</span>}
  </div>;
}
