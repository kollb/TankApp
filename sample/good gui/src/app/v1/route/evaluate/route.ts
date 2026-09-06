import { NextRequest, NextResponse } from "next/server";
import { getStations, getStationById } from "@/lib/data";
import { evaluateDetourEconomics, computeValueOfTime } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const stationId = searchParams.get("station_id");
    const liters = parseFloat(searchParams.get("liters") || "40");
    const detourKm = parseFloat(searchParams.get("detour_km") || "6");
    const consumption = parseFloat(searchParams.get("consumption") || "7.0");
    const valueOfTimeParam = searchParams.get("value_of_time");
    const whenParam = searchParams.get("when");
    const fuel = (searchParams.get("fuel") || "e10").toLowerCase() as "e10" | "e5" | "diesel";

    const all = await getStations();
    let targetStation = stationId ? await getStationById(stationId) : null;
    if (!targetStation) {
      targetStation = all[0];
    }

    if (!targetStation) {
      return NextResponse.json({ error: "No station available" }, { status: 404 });
    }

    // Reference baseline price: compare against median station in same campaign
    const campaignStations = all.filter((s) => s.campaign === targetStation?.campaign);
    const prices = campaignStations.map((s) =>
      fuel === "diesel" ? (s.lastPriceDiesel ?? 1.619) : fuel === "e5" ? (s.lastPriceE5 ?? 1.769) : (s.lastPriceE10 ?? 1.709)
    );
    prices.sort((a, b) => a - b);
    const medianBasePrice = prices[Math.floor(prices.length / 2)] || 1.749;

    const targetPrice =
      fuel === "diesel"
        ? (targetStation.lastPriceDiesel ?? 1.619)
        : fuel === "e5"
        ? (targetStation.lastPriceE5 ?? 1.769)
        : (targetStation.lastPriceE10 ?? 1.709);

    let hourOfEvaluation = 18.0;
    if (whenParam) {
      const parsedDate = new Date(whenParam);
      if (!isNaN(parsedDate.getTime())) {
        hourOfEvaluation = parsedDate.getHours() + parsedDate.getMinutes() / 60;
      } else {
        const floatHour = parseFloat(whenParam);
        if (!isNaN(floatHour)) hourOfEvaluation = floatHour;
      }
    }

    const valueOfTime = valueOfTimeParam ? parseFloat(valueOfTimeParam) : undefined;
    const { z, isPeak } = computeValueOfTime(hourOfEvaluation, valueOfTime);

    const evalResult = evaluateDetourEconomics({
      liters,
      detourKm,
      consumptionPer100Km: consumption,
      currentStationPrice: medianBasePrice,
      targetStationPrice: targetPrice,
      valuePerHour: z,
      when: hourOfEvaluation,
    });

    return NextResponse.json({
      station_id: targetStation.id,
      station_name: targetStation.name,
      delta_ct: evalResult.priceDeltaCt,
      gross_eur: evalResult.grossSavingsEur,
      detour_cost_eur: evalResult.totalDetourCostEur,
      fuel_cost_eur: evalResult.fuelCostEur,
      time_cost_eur: evalResult.timeCostEur,
      time_lost_minutes: evalResult.timeMinutes,
      net_eur: evalResult.netBenefitEur,
      worth_it: evalResult.worthIt,
      critical_delta_ct: evalResult.criticalDeltaCt,
      z_used: evalResult.zUsed,
      is_peak: isPeak,
      evaluated_at_hour: hourOfEvaluation,
    });
  } catch (error) {
    console.error("GET /v1/route/evaluate error:", error);
    return NextResponse.json({ error: "Failed to evaluate route" }, { status: 500 });
  }
}
