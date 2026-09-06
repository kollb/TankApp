import { NextRequest, NextResponse } from "next/server";
import { getStations, getStationById } from "@/lib/data";
import { generateHeatmapMatrix } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const stationId = searchParams.get("station_id");
    const fuel = (searchParams.get("fuel") || "e10").toLowerCase() as "e10" | "e5" | "diesel";
    const kind = (searchParams.get("kind") || "probability").toLowerCase() as "level" | "probability";

    let station = stationId ? await getStationById(stationId) : null;
    if (!station) {
      const all = await getStations();
      station = all[0];
    }

    if (!station) {
      return NextResponse.json({ error: "No station available" }, { status: 404 });
    }

    const data = generateHeatmapMatrix(station, fuel, kind);

    return NextResponse.json({
      station_id: station.id,
      station_name: station.name,
      fuel: fuel.toUpperCase(),
      kind,
      weeks: 6,
      days: data.days,
      hours: data.hours,
      matrix: data.matrix,
      bounds: {
        min: data.minVal,
        max: data.maxVal,
        unit: data.unit,
      },
      legend:
        kind === "level"
          ? "Abweichung in ct/L vom Stadtmedian (Grün = unter Median, Rot = über Median)"
          : "Wahrscheinlichkeit P(p ≤ Stadtmedian) in % (Grün = sehr hohe Chance auf Tiefstpreis)",
    });
  } catch (error) {
    console.error("GET /v1/heatmap error:", error);
    return NextResponse.json({ error: "Failed to generate heatmap" }, { status: 500 });
  }
}
