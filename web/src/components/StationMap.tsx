import React, { useEffect, useRef, useState } from "react";
import {
  MapPin,
  Navigation,
  Route,
  WifiOff,
  Info,
  Layers,
  Check,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { Station, DecideResult, euro } from "../data";
import { usePtrOff } from "../usePtrOff";

export interface StationMapProps {
  stations: Station[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  alternatives?: DecideResult["alternatives_nearby"];
  primaryStation?: DecideResult["primary"]["station"];
  onNavigate?: (mapsUrl: string) => void;
  title?: string;
  className?: string;
}

export type MapMode = "osm" | "radar";

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
  if (info.isCurrentSelected) return "0,00 €";
  if (info.netEur === null) return "-- €";
  const sign = info.netEur >= 0 ? "+" : "−";
  return `${sign}${euro(Math.abs(info.netEur))} €`;
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
        label: "Vergleichsstation",
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
  onNavigate,
  title = "Karte: Hier oder woanders?",
  className = "",
}: StationMapProps) {
  // C8: Ziehen an Karte/Radar darf kein Pull-to-Refresh der Seite auslösen.
  const ptrRef = usePtrOff<HTMLElement>();
  const [mapMode, setMapMode] = useState<MapMode>("osm");
  const [tileError, setTileError] = useState(false);
  const [activeStationId, setActiveStationId] = useState<string | null>(null);

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

          const centerLat =
            validStations.reduce((sum, s) => sum + (s.lat as number), 0) /
            validStations.length;
          const centerLon =
            validStations.reduce((sum, s) => sum + (s.lon as number), 0) /
            validStations.length;

          const map = L.map(mapContainerRef.current, {
            center: [centerLat, centerLon],
            zoom: 13,
            zoomControl: true,
            attributionControl: false,
          });

          mapInstanceRef.current = map;

          const tileLayer = L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
              maxZoom: 19,
            },
          );

          tileLayer.on("tileerror", () => {
            setTileError(true);
          });

          tileLayer.addTo(map);

          const bounds = L.latLngBounds([]);

          stationInfos.forEach((info) => {
            const { station } = info;
            if (
              typeof station.lat !== "number" ||
              typeof station.lon !== "number"
            ) {
              return;
            }

            const coords: [number, number] = [station.lat, station.lon];
            bounds.extend(coords);

            const badgeText = formatNetBadge(info);
            const style = getVerdictBadgeStyle(info.verdict);

            const customIcon = L.divIcon({
              className: "custom-net-pin",
              html: `<div class="px-2 py-1 rounded-full border text-[11px] font-mono whitespace-nowrap shadow-md cursor-pointer transition-transform hover:scale-105 ${style.pinBg}">${badgeText}</div>`,
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
              setActiveStationId(station.station_id);
            });
          });

          if (validStations.length > 1) {
            map.fitBounds(bounds, { padding: [30, 30] });
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
    JSON.stringify(alternatives),
  ]);

  const selectedStationObj = validStations.find((s) => s.station_id === selectedId);

  return (
    <section
      ref={ptrRef}
      className={`no-ptr rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5 shadow-xl ${className}`}
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
            className="shrink-0 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/30"
          >
            Radar nutzen
          </button>
        </div>
      )}

      {/* Empty State when no station coordinates */}
      {!validStations.length ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center text-xs text-slate-400">
          <MapPin size={24} className="mb-2 text-slate-600" />
          <p className="font-medium text-slate-300">Keine Kartendaten verfügbar</p>
          <p className="mt-1 text-slate-500">
            Für die gewählte Stadt sind keine Geokoordinaten der Stationen hinterlegt.
          </p>
        </div>
      ) : mapMode === "osm" ? (
        /* OSM Map Container */
        <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 h-[320px] w-full">
          <div ref={mapContainerRef} className="h-full w-full z-0" />
        </div>
      ) : (
        /* Radar Vector View */
        <RadarView
          stationInfos={stationInfos}
          selectedStation={selectedStationObj}
          activeStationId={activeStationId}
          setActiveStationId={setActiveStationId}
        />
      )}

      {/* Legend & Explanations */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[11px] text-slate-400">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1 font-mono">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-400 ring-2 ring-sky-400/40" />
            Vergleich
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

        <span className="font-mono text-[10px] text-slate-500">
          Server-Netto-€ (decide) · d = detour_km_est
        </span>
      </div>

      {/* Selected/Clicked Station Details Card */}
      {activeInfo && (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-200">
                  {activeInfo.station.name}
                </span>
                {activeInfo.station.brand && (
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
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
                    +{euro(activeInfo.detourKm, 1)} km Umweg
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
                  ? "0,00 € (Vergleich)"
                  : activeInfo.netEur !== null
                    ? `${activeInfo.netEur >= 0 ? "+" : "−"}${euro(Math.abs(activeInfo.netEur))} € Netto`
                    : "-- € (Leerstand)"}
              </span>
              <p className="text-[10px] text-slate-500">
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
                Als Vergleichsstation wählen
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

// Offline Vector Radar View Component
interface RadarViewProps {
  stationInfos: StationMapInfo[];
  selectedStation?: Station;
  activeStationId: string | null;
  setActiveStationId: (id: string | null) => void;
}

function RadarView({
  stationInfos,
  selectedStation,
  activeStationId,
  setActiveStationId,
}: RadarViewProps) {
  const centerLat =
    selectedStation?.lat ??
    stationInfos.reduce((sum, s) => sum + (s.station.lat as number), 0) /
      (stationInfos.length || 1);
  const centerLon =
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
    <div className="relative flex h-[320px] w-full items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950 p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full max-w-[400px]"
      >
        {/* Distance Rings */}
        {[0.33, 0.66, 1.0].map((frac, idx) => {
          const r = radius * frac;
          const kmVal = (maxDist * frac).toFixed(1);
          return (
            <g key={idx}>
              <circle
                cx={width / 2}
                cy={height / 2}
                r={r}
                fill="none"
                stroke="#334155"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={width / 2 + r - 12}
                y={height / 2 - 4}
                fill="#64748b"
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
          stroke="#1e293b"
          strokeWidth="1"
        />
        <line
          x1={padding / 2}
          y1={height / 2}
          x2={width - padding / 2}
          y2={height / 2}
          stroke="#1e293b"
          strokeWidth="1"
        />

        {/* N / S / O / W Direction Labels */}
        <text
          x={width / 2}
          y={14}
          textAnchor="middle"
          fill="#475569"
          fontSize="9"
          fontWeight="bold"
        >
          N
        </text>
        <text
          x={width / 2}
          y={height - 4}
          textAnchor="middle"
          fill="#475569"
          fontSize="9"
          fontWeight="bold"
        >
          S
        </text>
        <text
          x={width - 8}
          y={height / 2 + 3}
          textAnchor="end"
          fill="#475569"
          fontSize="9"
          fontWeight="bold"
        >
          O
        </text>
        <text
          x={8}
          y={height / 2 + 3}
          textAnchor="start"
          fill="#475569"
          fontSize="9"
          fontWeight="bold"
        >
          W
        </text>

        {/* Center Station (Comparison) */}
        <circle
          cx={width / 2}
          cy={height / 2}
          r={6}
          fill="#38bdf8"
          stroke="#0284c7"
          strokeWidth="2"
        />

        {/* Plot Stations */}
        {points.map(({ info, dx, dy }) => {
          const scale = radius / maxDist;
          const cx = width / 2 + dx * scale;
          const cy = height / 2 - dy * scale; // invert y for SVG coordinates

          const badgeText = formatNetBadge(info);
          const style = getVerdictBadgeStyle(info.verdict);
          const isActive = info.station.station_id === activeStationId;

          let colorFill = "#64748b"; // slate
          if (info.verdict === "selected") colorFill = "#38bdf8";
          else if (info.verdict === "worth") colorFill = "#34d399";
          else if (info.verdict === "borderline") colorFill = "#fbbf24";

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
                stroke="#0f172a"
                strokeWidth="1.5"
              />

              {/* Station Label Badge */}
              <rect
                x={cx - 22}
                y={cy - 18}
                width={44}
                height={13}
                rx={6}
                fill="#0f172a"
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
