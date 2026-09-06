import { NextRequest, NextResponse } from "next/server";
import { getStationById } from "@/lib/data";
import { generateStationForecast } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(req.url);
    const fuelParam = (searchParams.get("fuel") || "E10").toLowerCase() as "e10" | "e5" | "diesel";
    const horizonParam = parseInt(searchParams.get("horizon") || "0", 10) as 0 | 3 | 7;

    const station = await getStationById(id);
    if (!station) {
      return NextResponse.json({ error: `Station ${id} not found` }, { status: 404 });
    }

    const validHorizon: 0 | 3 | 7 = horizonParam === 3 ? 3 : horizonParam === 7 ? 7 : 0;
    const forecast = generateStationForecast(station, fuelParam, validHorizon);

    return NextResponse.json({
      station_id: station.id,
      station_name: station.name,
      fuel: fuelParam.toUpperCase(),
      horizon_days: validHorizon,
      points: forecast.points,
      mase_24h: forecast.mase24h,
      picp_7d: forecast.picp7d,
      confidence_badge: forecast.confidenceBadge,
      fitted_at: new Date().toISOString(),
      cheapest_hour: forecast.cheapestHour,
      cheapest_price: forecast.cheapestPrice,
      highest_hour: forecast.highestHour,
      highest_price: forecast.highestPrice,
      license: "Daten: MTS-K via tankerkoenig.de (CC BY 4.0)",
    });
  } catch (error) {
    console.error("GET /v1/stations/[id]/forecast error:", error);
    return NextResponse.json({ error: "Failed to generate forecast" }, { status: 500 });
  }
}
