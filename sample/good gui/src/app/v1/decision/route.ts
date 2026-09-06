import { NextRequest, NextResponse } from "next/server";
import { getStations, getStationById } from "@/lib/data";
import { evaluateRefuelingDecision } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const stationId = searchParams.get("station_id");
    const campaign = searchParams.get("campaign") || "Frankfurt am Main";
    const fuel = (searchParams.get("fuel") || "e10").toLowerCase() as "e10" | "e5" | "diesel";
    const liters = parseFloat(searchParams.get("liters") || "40");
    const hourParam = searchParams.get("hour");
    const timeValueParam = searchParams.get("value_of_time");
    const consumptionParam = searchParams.get("consumption");

    const all = await getStations();
    let currentStation = stationId ? await getStationById(stationId) : null;

    if (!currentStation) {
      // Pick top-1 station in current campaign
      const inCampaign = all.filter((s) => s.campaign.toLowerCase() === campaign.toLowerCase());
      currentStation = inCampaign[0] || all[0];
    }

    if (!currentStation) {
      return NextResponse.json({ error: "No station found" }, { status: 404 });
    }

    let currentHour = 14.5; // default around 14:30
    if (hourParam) {
      currentHour = parseFloat(hourParam);
    } else {
      const now = new Date();
      currentHour = now.getHours() + now.getMinutes() / 60;
    }

    const userTimeValue = timeValueParam ? parseFloat(timeValueParam) : undefined;
    const consumption = consumptionParam ? parseFloat(consumptionParam) : 7.0;

    const decision = evaluateRefuelingDecision({
      station: currentStation,
      allStations: all,
      currentHour,
      fuel,
      liters,
      userTimeValue,
      consumptionPer100Km: consumption,
    });

    return NextResponse.json(decision, {
      headers: {
        "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    console.error("GET /v1/decision error:", error);
    return NextResponse.json({ error: "Failed to evaluate decision" }, { status: 500 });
  }
}
