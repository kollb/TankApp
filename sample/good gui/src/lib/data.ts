/**
 * Lade-Schicht: liest die Lab-Daten aus PostgreSQL (nur Server).
 */
import { db } from "@/db";
import { and, eq, gte, lt } from "drizzle-orm";
import { cities, stations, dailyStats, stationModels, decisionRows, pricePoints } from "@/db/schema";
import { DAYS_TRAIN, DAYS_EVAL, TRAIN_START, DECISION_HOUR, DEFAULT_EPS, DEFAULT_LITERS, allDayStrings } from "@/lib/engine/config";
import type { LabData, StationInfo, StationModel, EvalRowDto } from "@/lib/types";

export async function loadLabData(): Promise<LabData> {
  const dayList = allDayStrings();
  const evalStart = dayList[DAYS_TRAIN];
  const end = dayList[dayList.length - 1];

  const cityRows = await db.select().from(cities).orderBy(cities.id);
  const stationRows = await db.select().from(stations).orderBy(stations.id);
  const modelRows = await db.select().from(stationModels);
  const decisionRowsAll = await db
    .select()
    .from(decisionRows)
    .orderBy(decisionRows.stationId, decisionRows.day);
  const dailyRows = await db
    .select()
    .from(dailyStats)
    .orderBy(dailyStats.stationId, dailyStats.day);

  const cityMap = new Map(cityRows.map((c) => [c.id, c]));
  const dayIdx = new Map(dayList.map((d, i) => [d, i]));

  const stationsOut: StationInfo[] = stationRows.map((s) => {
    const city = cityMap.get(s.cityId)!;
    return {
      id: s.id,
      citySlug: city.slug,
      name: s.name,
      brand: s.brand,
      lat: s.lat,
      lon: s.lon,
      profile: s.profile as StationInfo["profile"],
      is24h: s.is24h,
      deltaCt: s.deltaCt,
    };
  });

  const models: Record<string, StationModel> = {};
  for (const m of modelRows) {
    models[m.stationId] = {
      predWk: m.predWk,
      predWe: m.predWe,
      shapeWk: m.shapeWk as number[],
      shapeWe: m.shapeWe as number[],
      savesWk: m.savesWk as number[],
      savesWe: m.savesWe as number[],
      muWk: m.muWk,
      muWe: m.muWe,
      pWk: m.pWk,
      pWe: m.pWe,
    };
  }

  const p8Series: Record<string, number[]> = {};
  const decisions: Record<string, EvalRowDto[]> = {};
  for (const sid of stationRows.map((s) => s.id)) {
    p8Series[sid] = new Array(dayList.length).fill(NaN);
    decisions[sid] = [];
  }
  for (const d of dailyRows) {
    const idx = dayIdx.get(d.day);
    if (idx !== undefined) p8Series[d.stationId][idx] = d.p8;
  }
  for (const d of decisionRowsAll) {
    decisions[d.stationId].push({
      day: d.day,
      cls: d.cls,
      mu: d.mu,
      p: d.p,
      s: d.sCt,
      best: d.bestCt,
      predHour: d.predHour,
    });
  }

  return {
    meta: {
      trainStart: TRAIN_START,
      evalStart,
      end,
      daysTrain: DAYS_TRAIN,
      daysEval: DAYS_EVAL,
      decisionHour: DECISION_HOUR,
      defaultEps: DEFAULT_EPS,
      defaultLiters: DEFAULT_LITERS,
      tsLabel: "MEZ",
    },
    cities: cityRows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, state: c.state })),
    stations: stationsOut,
    days: dayList,
    models,
    p8Series,
    decisions,
  };
}

/** Tageskurve (ct/L + offen) für das Diagramm — schlanke Query über den 5-min-Punkte-Primärschlüssel. */
export async function loadDaySeries(
  stationId: string,
  day: string,
): Promise<{ h: number; ct: number; open: boolean }[]> {
  const dayUtc0 = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  const start = new Date(dayUtc0 + 5 * 3600_000);
  const end = new Date(dayUtc0 + 5 * 3600_000 + 216 * 300_000 - 1);
  const pts = await db
    .select({ ts: pricePoints.ts, price: pricePoints.price, open: pricePoints.open })
    .from(pricePoints)
    .where(and(eq(pricePoints.stationId, stationId), gte(pricePoints.ts, start), lt(pricePoints.ts, end)))
    .orderBy(pricePoints.ts);
  return pts.map((p) => {
    // MEZ (Winterzeit): lokale Stunde = UTC + 1
    const utcH = p.ts.getUTCHours() + p.ts.getUTCMinutes() / 60;
    return { h: Math.round((utcH + 1) * 100) / 100, ct: p.price * 100, open: p.open };
  });
}
