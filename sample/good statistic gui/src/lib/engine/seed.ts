/**
 * Seed & Schema-Bootstrap für das Entscheidungs-Labor.
 * Läuft idempotent: ensureSchema() legt Tabellen an (IF NOT EXISTS), seedDatabase()
 * erzeugt nur dann Daten, wenn noch keine vorhanden sind (oder force=true).
 */
import { db } from "@/db";
import { sql, count } from "drizzle-orm";
import { cities, stations, pricePoints, dailyStats, stationModels, decisionRows } from "@/db/schema";
import { runSimulation } from "./sim";
import { DAYS_TRAIN, POINTS_PER_DAY } from "./config";

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS cities (
    id serial PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL,
    state text NOT NULL, lat real NOT NULL, lon real NOT NULL, base_ct real NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS stations (
    id text PRIMARY KEY, city_id integer NOT NULL REFERENCES cities(id),
    name text NOT NULL, brand text NOT NULL, lat real NOT NULL, lon real NOT NULL,
    profile text NOT NULL, is_24h boolean NOT NULL, base_offset_ct real NOT NULL,
    pb real NOT NULL, delta_ct real NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS price_points (
    station_id text NOT NULL REFERENCES stations(id),
    ts timestamptz NOT NULL, price real NOT NULL, open boolean NOT NULL,
    PRIMARY KEY (station_id, ts))`,
  `CREATE TABLE IF NOT EXISTS daily_stats (
    id serial PRIMARY KEY, station_id text NOT NULL, day date NOT NULL,
    dow integer NOT NULL, weekday boolean NOT NULL, is_holiday boolean NOT NULL,
    cls integer NOT NULL, p8 real NOT NULL, min_price real NOT NULL,
    min_hour real NOT NULL, best_ct real NOT NULL, mean_price real NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS daily_stats_station_day_idx ON daily_stats (station_id, day)`,
  `CREATE TABLE IF NOT EXISTS station_models (
    station_id text PRIMARY KEY, pred_wk integer NOT NULL, pred_we integer NOT NULL,
    shape_wk jsonb NOT NULL, shape_we jsonb NOT NULL, saves_wk jsonb NOT NULL,
    saves_we jsonb NOT NULL, mu_wk real NOT NULL, mu_we real NOT NULL,
    p_wk real NOT NULL, p_we real NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS decision_rows (
    id serial PRIMARY KEY, station_id text NOT NULL, day date NOT NULL,
    cls integer NOT NULL, mu real NOT NULL, p real NOT NULL,
    s_ct real NOT NULL, best_ct real NOT NULL, pred_hour integer NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS decision_rows_station_day_idx ON decision_rows (station_id, day)`,
];

export async function ensureSchema(): Promise<void> {
  for (const d of DDL) {
    await db.execute(sql.raw(d));
  }
}

export async function getSeedState(): Promise<{
  seeded: boolean;
  stations: number;
  points: number;
  decisions: number;
}> {
  try {
    await ensureSchema();
    const [c] = await db.select({ n: count() }).from(cities);
    const [s] = await db.select({ n: count() }).from(stations);
    const [p] = await db.select({ n: count() }).from(pricePoints);
    const [d] = await db.select({ n: count() }).from(decisionRows);
    return {
      seeded: c.n > 0 && s.n > 0 && p.n > 0,
      stations: s.n,
      points: p.n,
      decisions: d.n,
    };
  } catch {
    return { seeded: false, stations: 0, points: 0, decisions: 0 };
  }
}

export async function seedDatabase(force = false): Promise<{
  cities: number;
  stations: number;
  points: number;
  daily: number;
  models: number;
  decisions: number;
  ms: number;
}> {
  const t0 = Date.now();
  await ensureSchema();
  if (force) {
    await db.execute(sql`DELETE FROM price_points`);
    await db.execute(sql`DELETE FROM daily_stats`);
    await db.execute(sql`DELETE FROM station_models`);
    await db.execute(sql`DELETE FROM decision_rows`);
    await db.execute(sql`DELETE FROM stations`);
    await db.execute(sql`DELETE FROM cities`);
  }
  const state = await getSeedState();
  if (state.seeded && !force) {
    return { cities: 0, stations: 0, points: 0, daily: 0, models: 0, decisions: 0, ms: Date.now() - t0 };
  }

  const sim = runSimulation();

  await db.insert(cities).values(
    sim.cities.map((c) => ({
      slug: c.slug,
      name: c.name,
      state: c.state,
      lat: c.lat,
      lon: c.lon,
      baseCt: c.baseCt,
    })),
  );
  const cityRows = await db
    .select({ id: cities.id, slug: cities.slug })
    .from(cities);
  const cityId = new Map(cityRows.map((r) => [r.slug, r.id]));

  await db.insert(stations).values(
    sim.stations.map((r) => ({
      id: r.def.id,
      cityId: cityId.get(r.def.city)!,
      name: r.def.name,
      brand: r.def.brand,
      lat: r.def.lat,
      lon: r.def.lon,
      profile: r.def.profile,
      is24h: !r.def.close22,
      baseOffsetCt: r.def.baseOffsetCt,
      pb: r.def.pb,
      deltaCt: Math.round(r.deltaCt * 100) / 100,
    })),
  );

  // 5-min-Punkte: lokale Stunde h = UTC h+1 (MEZ, Winter). i=0 => 06:00 MEZ = 05:00 UTC.
  const pointRows: { stationId: string; ts: Date; price: number; open: boolean }[] = [];
  for (const r of sim.stations) {
    for (let k = 0; k < r.days.length; k++) {
      const d = r.days[k];
      const dayUtc0 = Date.UTC(
        +d.date.slice(0, 4),
        +d.date.slice(5, 7) - 1,
        +d.date.slice(8, 10),
      );
      for (let i = 0; i < POINTS_PER_DAY; i++) {
        pointRows.push({
          stationId: r.def.id,
          ts: new Date(dayUtc0 + 5 * 3600_000 + i * 300_000),
          price: Math.round(d.pts[i] * 10) / 1000, // ct → €/L
          open: d.open[i] === 1,
        });
      }
    }
  }
  for (let i = 0; i < pointRows.length; i += 4000) {
    await db.insert(pricePoints).values(pointRows.slice(i, i + 4000));
  }

  await db.insert(dailyStats).values(
    sim.stations.flatMap((r) =>
      r.days.map((d) => ({
        stationId: r.def.id,
        day: d.date,
        dow: d.dow,
        weekday: d.cls === 0,
        isHoliday: d.holiday,
        cls: d.cls,
        p8: Math.round(d.p8 * 100) / 100,
        minPrice: Math.round((d.p8 - d.bestCt) * 100) / 100,
        minHour: Math.round(d.minHour * 100) / 100,
        bestCt: Math.round(d.bestCt * 100) / 100,
        meanPrice: Math.round(d.mean * 100) / 100,
      })),
    ),
  );

  const modelRows: (typeof stationModels.$inferInsert)[] = [];
  const evalRows: (typeof decisionRows.$inferInsert)[] = [];
  for (const r of sim.stations) {
    const m = sim.models.get(r.def.id)!;
    modelRows.push({
      stationId: r.def.id,
      predWk: m.predWk,
      predWe: m.predWe,
      shapeWk: m.shapeWk,
      shapeWe: m.shapeWe,
      savesWk: m.savesWk,
      savesWe: m.savesWe,
      muWk: m.muWk,
      muWe: m.muWe,
      pWk: m.pWk,
      pWe: m.pWe,
    });
    for (const e of sim.evals.get(r.def.id) ?? []) {
      evalRows.push({
        stationId: r.def.id,
        day: e.day,
        cls: e.cls,
        mu: e.mu,
        p: e.p,
        sCt: e.s,
        bestCt: e.best,
        predHour: e.predHour,
      });
    }
  }
  await db.insert(stationModels).values(modelRows);
  await db.insert(decisionRows).values(evalRows);

  return {
    cities: sim.cities.length,
    stations: sim.stations.length,
    points: pointRows.length,
    daily: sim.stations.length * sim.stations[0].days.length,
    models: modelRows.length,
    decisions: evalRows.length,
    ms: Date.now() - t0,
  };
}

export { DAYS_TRAIN };
