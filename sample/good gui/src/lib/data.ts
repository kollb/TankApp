import { db } from "@/db";
import { stations, systemHealth, pricePoints, fillups } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { eq, desc } from "drizzle-orm";
import { StationData, getGoogleMapsUrl } from "./engine";

let isSeeding = false;

export async function ensureDataLoaded(): Promise<void> {
  const all = await db.select().from(stations);
  if (all.length === 0 && !isSeeding) {
    isSeeding = true;
    try {
      await seedDatabase();
    } finally {
      isSeeding = false;
    }
  }
}

export async function getStations(campaign?: string): Promise<StationData[]> {
  await ensureDataLoaded();
  let results = await db.select().from(stations);
  if (campaign) {
    results = results.filter((s) => s.campaign.toLowerCase() === campaign.toLowerCase());
  }

  return results.map((s) => ({
    ...s,
    mapsUrl: getGoogleMapsUrl(s.lat, s.lng),
  }));
}

export async function getStationById(id: string): Promise<StationData | null> {
  await ensureDataLoaded();
  const rows = await db.select().from(stations).where(eq(stations.id, id));
  if (rows.length === 0) return null;
  const s = rows[0];
  return {
    ...s,
    mapsUrl: getGoogleMapsUrl(s.lat, s.lng),
  };
}

export async function getSystemHealth() {
  await ensureDataLoaded();
  const rows = await db.select().from(systemHealth).orderBy(desc(systemHealth.id)).limit(1);
  if (rows.length === 0) {
    return {
      collectorStatus: "healthy",
      lastPollAt: new Date().toISOString(),
      windowStart: "06:00",
      windowEnd: "24:00",
      tmpfsBytesUsed: 2621440,
      tmpfsMaxBytes: 33554432,
      nasReachable: true,
      nasSyncedUntil: new Date().toISOString(),
      coveragePct: 99.4,
      errorCount24h: 0,
      activeNightIds: "uuid-he-ref-autobahn-taunus",
    };
  }
  return rows[0];
}

export async function addFillup(data: {
  stationId: string;
  fuel: string;
  liters: number;
  pricePerLiter: number;
  totalCost: number;
  savedVsMedian?: number;
}) {
  await ensureDataLoaded();
  return await db.insert(fillups).values(data);
}

export async function getFillups() {
  await ensureDataLoaded();
  return await db.select().from(fillups).orderBy(desc(fillups.timestamp)).limit(20);
}
