import { NextResponse } from "next/server";
import { getSystemHealth, getStations } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await getSystemHealth();
    const allStations = await getStations();

    const top10Stations = allStations.filter((s) => s.isTop10);
    const quotaHe = top10Stations.filter((s) => s.subdiv === "HE").length;
    const quotaBy = top10Stations.filter((s) => s.subdiv === "BY").length;
    const quotaNw = top10Stations.filter((s) => s.subdiv === "NW").length;

    const tmpfsMbUsed = Number(((health.tmpfsBytesUsed ?? 2621440) / (1024 * 1024)).toFixed(2));
    const tmpfsMbMax = Number(((health.tmpfsMaxBytes ?? 33554432) / (1024 * 1024)).toFixed(1));

    return NextResponse.json(
      {
        status: "ok",
        collector: {
          state: health.collectorStatus,
          last_poll_at: health.lastPollAt,
          window: `${health.windowStart} - ${health.windowEnd}`,
          poll_interval_sec: 300,
          requests_per_day: 216,
          token_bucket: "1 R / 300s",
        },
        nas_storage: {
          reachable: health.nasReachable,
          endpoint: "tcp://192.168.1.100:8086 (InfluxDB v2)",
          synced_until: health.nasSyncedUntil,
          sync_mode: "batch idempotent ack",
        },
        buffer_tmpfs: {
          path: "/dev/shm/tankapp",
          used_mb: tmpfsMbUsed,
          max_mb: tmpfsMbMax,
          utilization_pct: Number(((tmpfsMbUsed / tmpfsMbMax) * 100).toFixed(1)),
          retention_days: 7,
        },
        monitoring: {
          coverage_pct: health.coveragePct,
          error_count_24h: health.errorCount24h,
          tracked_stations_total: allStations.length,
          top10_polled_ids: top10Stations.length,
          quota_distribution: {
            hessen_frankfurt: quotaHe,
            bayern_muenchen: quotaBy,
            nrw_koeln: quotaNw,
            target_quota: "6 / 2 / 2",
          },
        },
        system_time: new Date().toISOString(),
        version: "TankPuls API v4 (2026-09-06)",
        license: "Daten: MTS-K via tankerkoenig.de (CC BY 4.0)",
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("GET /v1/health error:", error);
    return NextResponse.json({ status: "error", message: "Health check failed" }, { status: 500 });
  }
}
