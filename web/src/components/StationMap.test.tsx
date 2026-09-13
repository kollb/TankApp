import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { StationMap } from "./StationMap";
import { Station, DecideResult } from "../data";

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

    expect(html).toContain("Vergleich");
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
});
