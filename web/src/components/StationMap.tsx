import React, { useEffect, useRef, useState } from "react";
import {
  MapPin,
  Home,
  Navigation,
  Route,
  WifiOff,
  Info,
  Layers,
  Check,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { Station, DecideResult, DetourMode, euro, kilometersLabel } from "../data";
import { useChartPalette } from "../chartTheme";

/** T5: Ein Label, eine Stelle — Marker, alt-Text und aria-label sagen dasselbe. */
const HOME_LABEL = "Zuhause, Startpunkt der Stadt";
import { usePtrOff } from "../usePtrOff";
import { panel } from "./ui";

export interface MapAnchor {
  lat: number;
  lon: number;
}

export interface StationMapProps {
  stations: Station[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  alternatives?: DecideResult["alternatives_nearby"];
  primaryStation?: DecideResult["primary"]["station"];
  /** Anker = Heimat-Startpunkt der Stadt (aus /api/v1/stations anchors). */
  anchor?: MapAnchor | null;
  tripMode?: DetourMode | string;
  onNavigate?: (mapsUrl: string) => void;
  title?: string;
  className?: string;
}

export type MapMode = "osm" | "radar";

/**
 * Bounding-Box, deren geometrische Mitte `center` ist — alle `points`
 * bleiben sichtbar, die Referenz rutscht nicht an den Rand.
 *
 * `fitBounds` über den Stations-Centroid zentriert die Karte auf dem
 * Mittelwert aller Pins; liegt die Referenz am Rand des Sets, sitzt sie
 * nicht mittig. Diese Box spiegelt den weitesten Punkt an der Referenz.
 */
export function boundsCenteredOn(
  center: { lat: number; lon: number },
  points: Array<{ lat: number; lon: number }>,
): [[number, number], [number, number]] {
  let maxDlat = 0;
  let maxDlon = 0;
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    maxDlat = Math.max(maxDlat, Math.abs(point.lat - center.lat));
    maxDlon = Math.max(maxDlon, Math.abs(point.lon - center.lon));
  }
  // Einzelner Punkt: ~1 km Spanne, sonst zoomt Leaflet auf Gebäudeebene.
  const minHalf = 0.005;
  maxDlat = Math.max(maxDlat, minHalf);
  maxDlon = Math.max(maxDlon, minHalf);
  return [
    [center.lat - maxDlat, center.lon - maxDlon],
    [center.lat + maxDlat, center.lon + maxDlon],
  ];
}

/** Kachel-Quelle der Kartenansicht (OSM-Standardstil, nur über https). */
export const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
/** Pflicht-Zuordnung der OSM-Tile-Usage-Policy — deutsch, weil die App
 *  deutsch ist; der Link führt auf die Copyright-Seite der Mitwirkenden. */
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';

interface StationMapInfo {
  station: Station;
  isCurrentSelected: boolean;
  netEur: number | null;
  verdict: "selected" | "worth" | "borderline" | "not_worth" | "none";
  worthIt: boolean;
  detourKm: number | null;
  distMode: string | null;
  mapsUrl: string | null;
  price: number | null;
}

function formatNetBadge(info: StationMapInfo): string {
  // Die Referenzstation ist der Nullpunkt der Netto-Rechnung — ein Pin
  // „0,00 €“ wäre als Spritpreis misslesbar, deshalb zeigt der Pin ihre
  // Rolle. Die 0 € Differenz stehen in der Detail-Karte und im Hinweistext.
  // Das Wort ist „Referenz“ (wie in Liste und Detailkarte), nicht „Vergleich“:
  // „Vergleich“ beschreibt eine Handlung, der Pin benennt eine Rolle.
  if (info.isCurrentSelected) return "Referenz";
  if (info.netEur === null) return "-- €";
  const sign = info.netEur >= 0 ? "+" : "−";
  return `${sign}${euro(Math.abs(info.netEur))} €`;
}

/**
 * Marker-HTML für den Heimat-Startpunkt (Haus-Symbol).
 *
 * Wortregel (0.36.0): Der Pin trägt das **Haus-Symbol** statt des Wortes
 * „Anker“. „Anker“ ist Fachsprache aus dem Polling-Set; im Alltag ist es
 * schlicht der Punkt, von dem die Entfernungen ausgehen. Das Symbol ist in
 * beiden Breiten gleich breit und bricht die Pin-Reihe nicht auf.
 */
function anchorPinHtml(): string {
  return `<div role="img" aria-label="${HOME_LABEL}" class="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-slate-900 shadow-md cursor-pointer whitespace-nowrap"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>`;
}

function getVerdictBadgeStyle(verdict: StationMapInfo["verdict"]): {
  pinBg: string;
  textClass: string;
  label: string;
} {
  switch (verdict) {
    case "selected":
      return {
        pinBg: "bg-sky-500 border-sky-200 text-slate-950 font-bold shadow-lg shadow-sky-500/30 ring-2 ring-sky-400/50",
        textClass: "text-sky-300",
        label: "Referenz dieser Stadt",
      };
    case "worth":
      return {
        pinBg: "bg-emerald-500 border-emerald-200 text-slate-950 font-bold shadow-md shadow-emerald-500/20",
        textClass: "text-emerald-300",
        label: "Lohnt sich",
      };
    case "borderline":
      return {
        pinBg: "bg-amber-500 border-amber-200 text-slate-950 font-bold shadow-md shadow-amber-500/20",
        textClass: "text-amber-300",
        label: "Grenzwertig",
      };
    case "not_worth":
      return {
        pinBg: "bg-slate-800 border-slate-600 text-slate-300",
        textClass: "text-slate-400",
        label: "Rechnet sich nicht",
      };
    case "none":
    default:
      return {
        pinBg: "bg-slate-900 border-slate-700 text-slate-400",
        textClass: "text-slate-500",
        label: "Kein Server-Netto",
      };
  }
}

export function StationMap({
  stations,
  selectedId,
  setSelectedId,
  alternatives = [],
  primaryStation,
  anchor = null,
  tripMode = "onroute",
  onNavigate,
  title = "Karte: Hier oder woanders?",
  className = "",
}: StationMapProps) {
  // C8: Ziehen an Karte/Radar darf kein Pull-to-Refresh der Seite auslösen.
  const ptrRef = usePtrOff<HTMLElement>();
  const [mapMode, setMapMode] = useState<MapMode>("osm");
  const [tileError, setTileError] = useState(false);
  const [activeStationId, setActiveStationId] = useState<string | null>(null);
  const [anchorActive, setAnchorActive] = useState(false);

  const validAnchor =
    anchor &&
    Number.isFinite(anchor.lat) &&
    Number.isFinite(anchor.lon) &&
    anchor.lat >= -90 &&
    anchor.lat <= 90 &&
    anchor.lon >= -180 &&
    anchor.lon <= 180
      ? anchor
      : null;

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);

  // Filter stations with valid coordinates
  const validStations = stations.filter(
    (s) =>
      typeof s.lat === "number" &&
      typeof s.lon === "number" &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lon) &&
      s.lat >= -90 &&
      s.lat <= 90 &&
      s.lon >= -180 &&
      s.lon <= 180,
  );

  // Map station details with server Netto-€
  const stationInfos: StationMapInfo[] = validStations.map((station) => {
    const isCurrentSelected = station.station_id === selectedId;
    const alt = alternatives.find((a) => a.station_id === station.station_id);

    let netEur: number | null = null;
    let verdict: StationMapInfo["verdict"] = "none";
    let worthIt = false;
    let detourKm: number | null = station.dist_km ?? null;
    let distMode: string | null = station.dist_mode ?? null;

    if (isCurrentSelected) {
      netEur = 0;
      verdict = "selected";
    } else if (alt) {
      netEur = alt.net_eur;
      worthIt = alt.worth_it;
      if (alt.verdict) {
        verdict =
          alt.verdict === "worth"
            ? "worth"
            : alt.verdict === "borderline"
              ? "borderline"
              : "not_worth";
      } else {
        verdict = alt.worth_it ? "worth" : "not_worth";
      }
      detourKm = alt.detour_km_est ?? alt.detour_km ?? station.dist_km ?? null;
      distMode = alt.dist_mode ?? station.dist_mode ?? null;
    }

    const price = station.price ?? station.last_price;

    return {
      station,
      isCurrentSelected,
      netEur,
      verdict,
      worthIt,
      detourKm,
      distMode,
      mapsUrl: alt?.maps_url || station.maps_url,
      price,
    };
  });

  const activeInfo = stationInfos.find(
    (info) => info.station.station_id === activeStationId,
  );

  // Check offline status
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  // Render Leaflet Map in OSM Mode
  useEffect(() => {
    if (
      mapMode !== "osm" ||
      !mapContainerRef.current ||
      typeof window === "undefined" ||
      !validStations.length
    ) {
      return;
    }

    let isMounted = true;

    // Dynamically load leaflet and its CSS in browser
    Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")])
      .then(([leafletModule]) => {
        if (!isMounted || !mapContainerRef.current) return;
        const L = leafletModule.default || leafletModule;

        try {
          if (mapInstanceRef.current) {
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
          }

          // Mitte = Referenzstation (Pins = Netto-€ gegenüber ihr), nicht
          // der Centroid aller Stationen — sonst sitzt die Referenz am Rand.
          const reference =
            validStations.find((s) => s.station_id === selectedId) ??
            validStations[0];
          const centerLat = (reference?.lat as number) ?? 51.16;
          const centerLon = (reference?.lon as number) ?? 10.45;

          const map = L.map(mapContainerRef.current, {
            center: [centerLat, centerLon],
            zoom: 13,
            zoomControl: true,
            // 0.31.0: Zuordnung bleibt sichtbar. Die OSM-Tile-Usage-Policy
            // verlangt sie, ohne Zuordnung ist die Nutzung der Kachel-Server
            // ein Verstoß (403 „not following the usage policy“).
            attributionControl: true,
          });

          mapInstanceRef.current = map;

          const tileLayer = L.tileLayer(
            OSM_TILE_URL,
            {
              maxZoom: 19,
              attribution: OSM_ATTRIBUTION,
              // 0.31.0: Die Kachel-Server identifizieren Anwendungen über den
              // Referer; `strict-origin-when-cross-origin` sendet genau den
              // Ursprung (kein Pfad). Ohne Referer → 403, Karte leer.
              referrerPolicy: "strict-origin-when-cross-origin",
            },
          );

          tileLayer.on("tileerror", () => {
            setTileError(true);
          });

          tileLayer.addTo(map);

          const fitPoints: { lat: number; lon: number }[] = [];

          // Zuhause (Heimat-Startpunkt) als eigener Pin — die Karte „geht von
          // ihm aus“, wie die Stations-km-Angaben.
          if (validAnchor) {
            const anchorCoords: [number, number] = [
              validAnchor.lat,
              validAnchor.lon,
            ];
            fitPoints.push({ lat: validAnchor.lat, lon: validAnchor.lon });
            const anchorIcon = L.divIcon({
              className: "custom-anchor-pin",
              html: anchorPinHtml(),
              // Nur das Haus-Symbol (kein Wort mehr) — der Pin ist so breit
              // wie hoch, damit das Symbol mittig auf der Koordinate sitzt.
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            });
            const anchorMarker = L.marker(anchorCoords, {
              icon: anchorIcon,
              keyboard: true,
              title: "Zuhause — Startpunkt der Stadt",
              alt: HOME_LABEL,
              zIndexOffset: 200,
            }).addTo(map);
            anchorMarker.on("click", () => {
              setActiveStationId(null);
              setAnchorActive(true);
            });
          }

          stationInfos.forEach((info) => {
            const { station } = info;
            if (
              typeof station.lat !== "number" ||
              typeof station.lon !== "number"
            ) {
              return;
            }

            const coords: [number, number] = [station.lat, station.lon];
            fitPoints.push({ lat: station.lat, lon: station.lon });

            const badgeText = formatNetBadge(info);
            const style = getVerdictBadgeStyle(info.verdict);

            const customIcon = L.divIcon({
              className: "custom-net-pin",
              html: `<div class="px-2 py-1 rounded-full border text-xs font-mono whitespace-nowrap shadow-md cursor-pointer transition-transform hover:scale-105 ${style.pinBg}">${badgeText}</div>`,
              iconSize: [60, 26],
              iconAnchor: [30, 13],
            });

            const marker = L.marker(coords, {
              icon: customIcon,
              // C5: Pin ist per Tab erreichbar; Enter/Space wählt die Station
              // (Leaflet setzt tabindex und löst bei Tastendruck click aus).
              keyboard: true,
              title: `${station.name} — ${badgeText}`,
              alt: `${station.name}, ${badgeText}`,
            }).addTo(map);

            marker.on("click", () => {
              setAnchorActive(false);
              setActiveStationId(station.station_id);
            });
          });

          // Box um die Referenz: alle Pins bleiben sichtbar, die Mitte
          // bleibt die Referenzstation — nicht der Stations-Centroid.
          if (fitPoints.length) {
            map.fitBounds(
              boundsCenteredOn(
                { lat: centerLat, lon: centerLon },
                fitPoints,
              ),
              { padding: [30, 30], maxZoom: 15 },
            );
          }
        } catch (e) {
          console.warn("Leaflet map init fallback to radar:", e);
          if (isMounted) setMapMode("radar");
        }
      })
      .catch((err) => {
        console.warn("Leaflet import failed:", err);
        if (isMounted) setMapMode("radar");
      });

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (_) {}
        mapInstanceRef.current = null;
      }
    };
  }, [
    mapMode,
    validStations.length,
    selectedId,
    validAnchor?.lat,
    validAnchor?.lon,
    JSON.stringify(alternatives),
  ]);

  const selectedStationObj = validStations.find((s) => s.station_id === selectedId);

  return (
    <section
      ref={ptrRef}
      className={`no-ptr ${panel} p-4 sm:p-5 shadow-xl ${className}`}
      aria-label="Karten-/Umgebungsansicht"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Route size={16} className="text-emerald-400" />
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-0.5 text-xs">
          <button
            onClick={() => {
              setMapMode("osm");
              setTileError(false);
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${
              mapMode === "osm"
                ? "bg-emerald-500/20 text-emerald-300 font-medium"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Layers size={13} />
            Karte (OSM)
          </button>
          <button
            onClick={() => setMapMode("radar")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${
              mapMode === "radar"
                ? "bg-emerald-500/20 text-emerald-300 font-medium"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <WifiOff size={13} />
            Luftlinie (Radar)
          </button>
        </div>
      </div>

      {/* Offline / Tile error warning */}
      {(isOffline || tileError) && mapMode === "osm" && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          <span className="flex items-center gap-1.5">
            <WifiOff size={14} className="shrink-0 text-amber-400" />
            {isOffline
              ? "Keine Internetverbindung — OSM-Kacheln geladen aus Puffer oder wechseln auf Radar."
              : "OSM-Kacheln derzeit nicht erreichbar. Luftlinien-Radar zeigt Standorte offline."}
          </span>
          <button
            onClick={() => setMapMode("radar")}
            className="shrink-0 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/30"
          >
            Radar nutzen
          </button>
        </div>
      )}

      {/* Empty State when no station coordinates */}
      {!validStations.length ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center text-xs text-slate-400">
          <MapPin size={24} className="mb-2 text-slate-600" />
          <p className="font-medium text-slate-300">Keine Kartendaten verfügbar</p>
          <p className="mt-1 text-slate-500">
            Für die gewählte Stadt sind keine Geokoordinaten der Stationen hinterlegt.
          </p>
        </div>
      ) : mapMode === "osm" ? (
        /* OSM Map Container */
        <div className="relative isolate overflow-hidden rounded-lg border border-slate-800 bg-slate-950 h-[320px] w-full">
          <div ref={mapContainerRef} className="h-full w-full z-0" />
        </div>
      ) : (
        /* Radar Vector View */
        <RadarView
          stationInfos={stationInfos}
          selectedStation={selectedStationObj}
          anchor={validAnchor}
          anchorActive={anchorActive}
          activeStationId={activeStationId}
          setActiveStationId={(id) => {
            setAnchorActive(false);
            setActiveStationId(id);
          }}
          setAnchorActive={setAnchorActive}
        />
      )}

      {/* Legend & Explanations */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-3">
          {validAnchor && (
            <span className="flex items-center gap-1 font-mono">
              <span className="flex h-2.5 w-2.5 items-center justify-center rounded-full bg-slate-100 ring-2 ring-slate-300/50">
                <Home size={8} className="text-slate-900" />
              </span>
              Zuhause
            </span>
          )}
          <span className="flex items-center gap-1 font-mono">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-400 ring-2 ring-sky-400/40" />
            Referenz
          </span>
          <span className="flex items-center gap-1 font-mono">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            Lohnt sich
          </span>
          <span className="flex items-center gap-1 font-mono">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            Grenzwertig
          </span>
          <span className="flex items-center gap-1 font-mono">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
            Lohnt nicht / Leerstand
          </span>
        </div>

        <span className="font-mono text-xs text-slate-500">
          Server-Netto-€ (decide) · d = detour_km_est
        </span>
      </div>

      {/* Was die Karte bedeutet — die 0-€-Frage: der „Referenz“-Pin ist die
          Vergleichsstation (0 € Unterschied), nicht ein Spritpreis von 0 €. */}
      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs leading-snug text-slate-400">
        <p className="flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 shrink-0 text-slate-500" />
          <span>
            Die €-Pins nennen die Netto-Ersparnis gegenüber der
            Referenzstation; deren eigener Pin heißt „Referenz“ und steht auf
            0 € Unterschied, nicht auf 0 € Spritpreis. Die Karte hält die
            Referenz in der Mitte.
            {validAnchor
              ? tripMode === "dedicated"
                ? " Das Haus ist Zuhause — der Startpunkt der Stadt: Von dort gehen die Stationsentfernungen und der ganze Hin- und Rückweg der Extrafahrt aus."
                : " Das Haus ist Zuhause — der Startpunkt der Stadt: Von dort messen die Stationsentfernungen; der Fahrtcharakter „Auf dem Weg“ zählt nur den Mehrweg gegenüber der Referenzstation."
              : " Die Stationsentfernungen (km Fahrt/Luftlinie) gehen von Zuhause aus; ohne diese Koordinate im Polling-Set erscheint kein Haus-Symbol."}
          </span>
        </p>
      </div>

      {/* Zuhause-Detailkarte bei Klick/Tap auf den Haus-Pin */}
      {anchorActive && validAnchor && (
        <div className="mt-3 rounded-lg border border-slate-300/40 bg-slate-950/80 p-3.5 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-300/50 bg-slate-100 text-slate-900">
                <Home size={15} />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  Zuhause · Startpunkt dieser Stadt
                </p>
                <p className="mt-1 max-w-prose text-xs leading-snug text-slate-400">
                  Die Entfernungsangaben der Stationen (Fahrt oder Luftlinie)
                  und die Umweg-Rechnung im Fahrtcharakter „Extrafahrt“ gehen
                  von diesem Punkt aus. Die €-Pins vergleichen trotzdem gegen
                  die Referenzstation — das Haus ist selbst keine Tankstelle.
                </p>
              </div>
            </div>
            <button
              onClick={() => setAnchorActive(false)}
              aria-label="Zuhause-Erklärung schließen"
              className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            >
              <XCircle size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Selected/Clicked Station Details Card */}
      {activeInfo && (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-200">
                  {activeInfo.station.name}
                </span>
                {activeInfo.station.brand && (
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-mono text-slate-400">
                    {activeInfo.station.brand}
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-xs text-slate-400">
                Preis:{" "}
                <span className="font-bold text-slate-200">
                  {activeInfo.price !== null
                    ? `${euro(activeInfo.price, 3)} €/L`
                    : "Keine Preismeldung"}
                </span>
                {activeInfo.detourKm !== null && (
                  <span>
                    {" · "}
                    +{kilometersLabel(activeInfo.detourKm, 1)} Umweg
                    {activeInfo.distMode ? ` (${activeInfo.distMode === "air" ? "Luftlinie" : activeInfo.distMode === "road" ? "Straße" : activeInfo.distMode})` : ""}
                  </span>
                )}
              </p>
            </div>

            <div className="text-right font-mono">
              <span
                className={`text-sm font-bold ${getVerdictBadgeStyle(activeInfo.verdict).textClass}`}
              >
                {activeInfo.isCurrentSelected
                  ? "0,00 € Unterschied"
                  : activeInfo.netEur !== null
                    ? `${activeInfo.netEur >= 0 ? "+" : "−"}${euro(Math.abs(activeInfo.netEur))} € Netto`
                    : "-- € (Leerstand)"}
              </span>
              <p className="text-xs text-slate-500">
                {getVerdictBadgeStyle(activeInfo.verdict).label}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {!activeInfo.isCurrentSelected && (
              <button
                onClick={() => setSelectedId(activeInfo.station.station_id)}
                className="rounded-lg bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-300 border border-sky-500/30 hover:bg-sky-500/30 transition-colors"
              >
                Als Referenz wählen
              </button>
            )}

            {activeInfo.mapsUrl && (
              <a
                href={activeInfo.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (onNavigate) {
                    e.preventDefault();
                    onNavigate(activeInfo.mapsUrl!);
                  }
                }}
                className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors"
              >
                <Navigation size={12} />
                Navigieren
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// Offline Vector Radar View Component (exported for Komponenten-Tests)
export interface RadarViewProps {
  stationInfos: StationMapInfo[];
  selectedStation?: Station;
  anchor?: MapAnchor | null;
  anchorActive: boolean;
  activeStationId: string | null;
  setActiveStationId: (id: string | null) => void;
  setAnchorActive: (v: boolean) => void;
}

export function RadarView({
  stationInfos,
  selectedStation,
  anchor,
  anchorActive,
  activeStationId,
  setActiveStationId,
  setAnchorActive,
}: RadarViewProps) {
  const c = useChartPalette();
  // Das Radar geht von Zuhause aus (Haus-Symbol, Heimat-Startpunkt,
  // „müsste es nicht von Zuhause aus losgehen?“). Ohne diese Koordinate
  // bleibt die Referenzstation das Zentrum — der Rahmen wird dann explizit
  // beschriftet.
  const centerLat =
    anchor?.lat ??
    selectedStation?.lat ??
    stationInfos.reduce((sum, s) => sum + (s.station.lat as number), 0) /
      (stationInfos.length || 1);
  const centerLon =
    anchor?.lon ??
    selectedStation?.lon ??
    stationInfos.reduce((sum, s) => sum + (s.station.lon as number), 0) /
      (stationInfos.length || 1);

  // Convert lat/lon offset to approximate km offsets
  // 1 deg lat ≈ 111 km, 1 deg lon ≈ 111 * cos(lat) km
  const cosLat = Math.cos((centerLat * Math.PI) / 180);

  const points = stationInfos.map((info) => {
    const lat = info.station.lat as number;
    const lon = info.station.lon as number;
    const dy = (lat - centerLat) * 111.0; // North-South km
    const dx = (lon - centerLon) * 111.0 * cosLat; // East-West km
    const dist = Math.sqrt(dx * dx + dy * dy);
    return { info, dx, dy, dist };
  });

  const maxDist = Math.max(
    ...points.map((p) => p.dist),
    3.0, // Minimum 3 km radius
  );

  // Scale to fit SVG viewport (width=320, height=280)
  const width = 320;
  const height = 280;
  const padding = 40;
  const radius = Math.min(width, height) / 2 - padding;

  return (
    <div className="relative flex h-[320px] w-full items-center justify-center overflow-hidden rounded-lg border border-slate-800 bg-slate-950 p-2">
      <span className="absolute left-2 top-2 z-10 rounded bg-slate-900/80 px-1.5 py-0.5 font-mono text-xs text-slate-400">
        {anchor
          ? "Mitte: Zuhause · Ringe = km Luftlinie ab Zuhause"
          : "Mitte: Referenz · Ringe = km Luftlinie ab ihr"}
      </span>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full max-w-[400px]"
      >
        {/* Distance Rings */}
        {[0.33, 0.66, 1.0].map((frac, idx) => {
          const r = radius * frac;
          const kmVal = (maxDist * frac).toLocaleString("de-DE", {
            maximumFractionDigits: 1,
          });
          return (
            <g key={idx}>
              <circle
                cx={width / 2}
                cy={height / 2}
                r={r}
                fill="none"
                stroke={c.axis}
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={width / 2 + r - 12}
                y={height / 2 - 4}
                fill={c.muted}
                fontSize="8"
                fontFamily="monospace"
              >
                {kmVal} km
              </text>
            </g>
          );
        })}

        {/* Compass Crosshairs */}
        <line
          x1={width / 2}
          y1={padding / 2}
          x2={width / 2}
          y2={height - padding / 2}
          stroke={c.grid}
          strokeWidth="1"
        />
        <line
          x1={padding / 2}
          y1={height / 2}
          x2={width - padding / 2}
          y2={height / 2}
          stroke={c.grid}
          strokeWidth="1"
        />

        {/* N / S / O / W Direction Labels */}
        <text
          x={width / 2}
          y={14}
          textAnchor="middle"
          fill={c.tick}
          fontSize="9"
          fontWeight="bold"
        >
          N
        </text>
        <text
          x={width / 2}
          y={height - 4}
          textAnchor="middle"
          fill={c.tick}
          fontSize="9"
          fontWeight="bold"
        >
          S
        </text>
        <text
          x={width - 8}
          y={height / 2 + 3}
          textAnchor="end"
          fill={c.tick}
          fontSize="9"
          fontWeight="bold"
        >
          O
        </text>
        <text
          x={8}
          y={height / 2 + 3}
          textAnchor="start"
          fill={c.tick}
          fontSize="9"
          fontWeight="bold"
        >
          W
        </text>

        {/* Zentrum: Zuhause (Heimat-Startpunkt) oder Referenzstation */}
        {anchor ? (
          <g
            className="cursor-pointer focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
            role="button"
            tabIndex={0}
            aria-label={HOME_LABEL}
            aria-pressed={anchorActive}
            onClick={() => {
              setActiveStationId(null);
              setAnchorActive(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setActiveStationId(null);
                setAnchorActive(true);
              }
            }}
          >
            <circle cx={width / 2} cy={height / 2} r={22} fill="transparent" />
            <circle
              cx={width / 2}
              cy={height / 2}
              r={8}
              fill={c.textStrong}
              stroke={c.border}
              strokeWidth="2"
            />
            <g
              transform={`translate(${width / 2 - 6.6},${height / 2 - 7}) scale(0.55)`}
            >
              <path
                d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                fill="none"
                stroke={c.surface}
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points="9 22 9 12 15 12 15 22"
                fill="none"
                stroke={c.surface}
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
            <text
              x={width / 2}
              y={height / 2 + 22}
              textAnchor="middle"
              fill={c.border}
              fontSize="9"
              fontWeight="bold"
            >
              Zuhause
            </text>
          </g>
        ) : (
          <circle
            cx={width / 2}
            cy={height / 2}
            r={6}
            fill={c.accent}
            stroke={c.accentEdge}
            strokeWidth="2"
          />
        )}

        {/* Plot Stations */}
        {points.map(({ info, dx, dy }) => {
          const scale = radius / maxDist;
          const cx = width / 2 + dx * scale;
          const cy = height / 2 - dy * scale; // invert y for SVG coordinates

          const badgeText = formatNetBadge(info);
          const style = getVerdictBadgeStyle(info.verdict);
          const isActive = info.station.station_id === activeStationId;
          // Breite nach Textlänge — „Referenz“ ist länger als „+0,85 €“.
          const badgeW = Math.max(34, badgeText.length * 5.4 + 8);

          let colorFill = c.muted;
          if (info.verdict === "selected") colorFill = c.accent;
          else if (info.verdict === "worth") colorFill = c.positive;
          else if (info.verdict === "borderline") colorFill = c.warnSoft;

          return (
            <g
              key={info.station.station_id}
              className="cursor-pointer transition-transform hover:scale-110 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
              role="button"
              tabIndex={0}
              aria-label={`${info.station.name} — ${badgeText}`}
              onClick={() => setActiveStationId(info.station.station_id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveStationId(info.station.station_id);
                }
              }}
            >
              {/* C5: unsichtbare 44-px-Trefferfläche für Finger */}
              <circle cx={cx} cy={cy} r={22} fill="transparent" />
              {/* Connection line to center */}
              <line
                x1={width / 2}
                y1={height / 2}
                x2={cx}
                y2={cy}
                stroke={colorFill}
                strokeOpacity="0.25"
                strokeWidth="1"
              />

              {/* Station Dot */}
              <circle
                cx={cx}
                cy={cy}
                r={isActive ? 7 : 5}
                fill={colorFill}
                stroke={c.surface}
                strokeWidth="1.5"
              />

              {/* Station Label Badge */}
              <rect
                x={cx - badgeW / 2}
                y={cy - 18}
                width={badgeW}
                height={13}
                rx={6}
                fill={c.surface}
                fillOpacity="0.9"
                stroke={colorFill}
                strokeWidth="1"
              />
              <text
                x={cx}
                y={cy - 9}
                textAnchor="middle"
                fill={colorFill}
                fontSize="8"
                fontFamily="monospace"
                fontWeight="bold"
              >
                {badgeText}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

