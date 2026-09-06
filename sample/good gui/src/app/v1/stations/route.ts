import { NextRequest, NextResponse } from "next/server";
import { getStations } from "@/lib/data";

export const dynamic = "force-dynamic";

// Calculate approximate great-circle distance between two coords in km
function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const latParam = searchParams.get("lat");
    const lonParam = searchParams.get("lon");
    const radiusParam = searchParams.get("radius");
    const fuelParam = (searchParams.get("fuel") || "E10").toLowerCase();
    const sortParam = (searchParams.get("sort") || "price").toLowerCase();
    const campaignParam = searchParams.get("campaign");

    // Default to Frankfurt city center if coordinates not passed
    const lat = latParam ? parseFloat(latParam) : 50.1109;
    const lon = lonParam ? parseFloat(lonParam) : 8.6821;
    const radius = radiusParam ? Math.min(25, Math.max(1, parseFloat(radiusParam))) : 15;

    const allStations = await getStations(campaignParam || undefined);

    const mapped = allStations
      .map((s) => {
        const dist = Number(haversineDistanceKm(lat, lon, s.lat, s.lng).toFixed(2));
        let price = s.lastPriceE10;
        if (fuelParam === "diesel") price = s.lastPriceDiesel;
        else if (fuelParam === "e5") price = s.lastPriceE5;

        return {
          id: s.id,
          name: s.name,
          brand: s.brand,
          lat: s.lat,
          lon: s.lng,
          dist,
          price: price ?? 1.719,
          is_open: s.isOpen,
          stale_minutes: 3, // within 5-min poll loop
          maps_url: s.mapsUrl,
          campaign: s.campaign,
          subdiv: s.subdiv,
          delta_hat: s.deltaHat,
          ci_lo: s.ciLo,
          ci_hi: s.ciHi,
          q_value: s.qValue,
          av_score: s.avScore,
          cheapest_hour: s.cheapestHour,
          picp_7d: s.picp7d,
          is_top10: s.isTop10,
          quota_rank: s.quotaRank,
        };
      })
      .filter((s) => s.dist <= radius);

    if (sortParam === "distance") {
      mapped.sort((a, b) => a.dist - b.dist);
    } else {
      mapped.sort((a, b) => a.price - b.price);
    }

    return NextResponse.json(mapped, {
      headers: {
        "X-Data-Source": "MTS-K via tankerkoenig.de (CC BY 4.0)",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=180",
      },
    });
  } catch (error) {
    console.error("GET /v1/stations error:", error);
    return NextResponse.json({ error: "Failed to fetch stations" }, { status: 500 });
  }
}
