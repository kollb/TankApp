import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import {
  StationMap,
  RadarView,
  OSM_TILE_URL,
  OSM_ATTRIBUTION,
  boundsCenteredOn,
} from "./StationMap";
import { Station, DecideResult } from "../data";

type RadarInfo = Parameters<typeof RadarView>[0]["stationInfos"][number];

function radarInfo(
  station: Station,
  extra: Partial<RadarInfo> = {},
): RadarInfo {
  const isCurrentSelected = station.station_id === "s1";
  return {
    station,
    isCurrentSelected,
    netEur: isCurrentSelected ? 0 : null,
    verdict: isCurrentSelected ? "selected" : "none",
    worthIt: false,
    detourKm: station.dist_km ?? null,
    distMode: station.dist_mode ?? null,
    mapsUrl: station.maps_url ?? null,
    price: station.price ?? station.last_price ?? null,
    ...extra,
  };
}

const mockStations: Station[] = [
  {
    station_id: "s1",
    city: "Münster",
    name: "Aral Weseler Str.",
    brand: "ARAL",
    fuel: "e10",
    maps_url: "https://maps.google.com/?q=51.95,7.62",
    dist_km: 1.2,
    dist_mode: "road",
    lat: 51.95,
    lon: 7.62,
    price: 1.729,
    last_price: 1.729,
    status: "open",
    fresh: true,
    observed_at: "2026-09-13T10:00:00Z",
    age_minutes: 5,
  },
  {
    station_id: "s2",
    city: "Münster",
    name: "Shell Steinfurter Str.",
    brand: "SHELL",
    fuel: "e10",
    maps_url: "https://maps.google.com/?q=51.97,7.61",
    dist_km: 2.5,
    dist_mode: "road",
    lat: 51.97,
    lon: 7.61,
    price: 1.689,
    last_price: 1.689,
    status: "open",
    fresh: true,
    observed_at: "2026-09-13T10:00:00Z",
    age_minutes: 5,
  },
  {
    station_id: "s3",
    city: "Münster",
    name: "JET Grevener Str.",
    brand: "JET",
    fuel: "e10",
    maps_url: "https://maps.google.com/?q=51.98,7.63",
    dist_km: 3.8,
    dist_mode: "air",
    lat: 51.98,
    lon: 7.63,
    price: 1.759,
    last_price: 1.759,
    status: "open",
    fresh: true,
    observed_at: "2026-09-13T10:00:00Z",
    age_minutes: 5,
  },
];

const mockAlternatives: DecideResult["alternatives_nearby"] = [
  {
    station_id: "s2",
    name: "Shell Steinfurter Str.",
    brand: "SHELL",
    price: 1.689,
    delta_ct: -4.0,
    detour_km: 0.8,
    detour_km_est: 0.8,
    dist_mode: "road",
    net_eur: 0.85,
    worth_it: true,
    verdict: "worth",
    p_lohnt: 0.82,
    maps_url: "https://maps.google.com/?q=51.97,7.61",
  },
];

describe("StationMap (C3 Karten-/Umgebungsansicht)", () => {
  it("renders map header and mode buttons (OSM Karte / Luftlinie Radar)", () => {
    const html = renderToStaticMarkup(
      <StationMap
        stations={mockStations}
        selectedId="s1"
        setSelectedId={() => {}}
        alternatives={mockAlternatives}
      />,
    );

    expect(html).toContain("Karte: Hier oder woanders?");
    expect(html).toContain("Karte (OSM)");
    expect(html).toContain("Luftlinie (Radar)");
  });

  it("contains legend for Netto-€ pins and server source note", () => {
    const html = renderToStaticMarkup(
      <StationMap
        stations={mockStations}
        selectedId="s1"
        setSelectedId={() => {}}
        alternatives={mockAlternatives}
      />,
    );

    expect(html).toContain("Referenz");
    expect(html).toContain("Lohnt sich");
    expect(html).toContain("Grenzwertig");
    expect(html).toContain("Server-Netto-€ (decide)");
  });

  it("renders honest empty state when no station coordinates exist", () => {
    const html = renderToStaticMarkup(
      <StationMap
        stations={[]}
        selectedId="s1"
        setSelectedId={() => {}}
        alternatives={[]}
      />,
    );

    expect(html).toContain("Keine Kartendaten verfügbar");
    expect(html).toContain(
      "Für die gewählte Stadt sind keine Geokoordinaten der Stationen hinterlegt.",
    );
  });

  it("erklärt den Referenz-Pin und die 0-€-Frage", () => {
    const html = renderToStaticMarkup(
      <StationMap
        stations={mockStations}
        selectedId="s1"
        setSelectedId={() => {}}
        alternatives={mockAlternatives}
      />,
    );

    // Der Pin der Referenzstation zeigt ihre Rolle, keinen 0-€-Preis.
    // Wortwahl: „Referenz“ statt „Vergleich“ — der Pin benennt eine Rolle,
    // keine Handlung (0.36.0).
    expect(html).toContain("Referenz");
    expect(html).not.toContain(">Vergleich<");
    expect(html).toContain("0 € Unterschied, nicht auf 0 € Spritpreis");
  });

  it("zeigt Zuhause als Haus-Symbol, wenn die Koordinate vorliegt", () => {
    const html = renderToStaticMarkup(
      <StationMap
        stations={mockStations}
        selectedId="s1"
        setSelectedId={() => {}}
        alternatives={mockAlternatives}
        anchor={{ lat: 50.11, lon: 8.68 }}
      />,
    );

    // Der Pin trägt das Haus-Symbol, kein Wort „Anker“ mehr.
    expect(html).toContain("Zuhause");
    expect(html).not.toContain(">Anker<");
    expect(html).toContain("Startpunkt der Stadt");
    // Koordinaten selbst bleiben im Nutzertext unsichtbar (MICROCOPY §6).
    expect(html).not.toContain("50.11");
    expect(html).not.toContain("8.68");
  });

  it("Radar zentriert auf Zuhause und zeichnet die Stationen relativ dazu", () => {
    const infos = mockStations.map((s) => radarInfo(s));
    const html = renderToStaticMarkup(
      <RadarView
        stationInfos={infos}
        selectedStation={mockStations[0]}
        anchor={{ lat: 50.0, lon: 8.5 }}
        anchorActive={false}
        activeStationId={null}
        setActiveStationId={() => {}}
        setAnchorActive={() => {}}
      />,
    );

    expect(html).toContain("Mitte: Zuhause");
    expect(html).toContain("Ringe = km Luftlinie ab Zuhause");
    // Die Referenzstation ist ein normaler Pin mit Rollen-Label, kein 0 €.
    expect(html).toContain(">Referenz<");
    expect(html).not.toContain(">0,00 €<");
  });

  it("Radar ohne Zuhause-Koordinate zentriert auf der Referenz und sagt das", () => {
    const infos = mockStations.map((s) => radarInfo(s));
    const html = renderToStaticMarkup(
      <RadarView
        stationInfos={infos}
        selectedStation={mockStations[0]}
        anchor={null}
        anchorActive={false}
        activeStationId={null}
        setActiveStationId={() => {}}
        setAnchorActive={() => {}}
      />,
    );

    expect(html).toContain("Mitte: Referenz");
    expect(html).toContain("Ringe = km Luftlinie ab ihr");
  });

  it("boundsCenteredOn hält die Referenz geometrisch in der Mitte", () => {
    const center = { lat: 51.95, lon: 7.62 };
    const bounds = boundsCenteredOn(center, [
      { lat: 51.95, lon: 7.62 },
      { lat: 51.98, lon: 7.63 },
      { lat: 51.94, lon: 7.61 },
    ]);
    const midLat = (bounds[0][0] + bounds[1][0]) / 2;
    const midLon = (bounds[0][1] + bounds[1][1]) / 2;
    expect(midLat).toBeCloseTo(center.lat, 8);
    expect(midLon).toBeCloseTo(center.lon, 8);
    expect(bounds[0][0]).toBeLessThanOrEqual(51.94);
    expect(bounds[1][0]).toBeGreaterThanOrEqual(51.98);
  });

  it("erklärt, dass die Karte die Referenz in der Mitte hält", () => {
    const html = renderToStaticMarkup(
      <StationMap
        stations={mockStations}
        selectedId="s1"
        setSelectedId={() => {}}
        alternatives={mockAlternatives}
      />,
    );
    expect(html).toContain("Referenz in der Mitte");
  });

  it("nutzt OSM-Kacheln nur über https und mit Zuordnung (Tile-Policy)", () => {
    // Ohne Zuordnung und ohne Referer antworten die OSM-Kachel-Server mit
    // 403 „Access blocked — App is not following the Usage Policy“.
    expect(OSM_TILE_URL.startsWith("https://")).toBe(true);
    expect(OSM_TILE_URL).toContain("tile.openstreetmap.org");
    expect(OSM_ATTRIBUTION).toContain("OpenStreetMap");
    expect(OSM_ATTRIBUTION).toContain("openstreetmap.org/copyright");
  });

  it("erwähnt das fehlende Haus-Symbol ehrlich ohne Koordinate", () => {
    const html = renderToStaticMarkup(
      <StationMap
        stations={mockStations}
        selectedId="s1"
        setSelectedId={() => {}}
        alternatives={mockAlternatives}
      />,
    );

    expect(html).toContain(
      "ohne diese Koordinate im Polling-Set erscheint kein Haus-Symbol",
    );
  });
});
