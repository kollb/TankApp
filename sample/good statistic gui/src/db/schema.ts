import {
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  date,
  timestamp,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";

/** Kampagnen-Städte (Konzept v4: HE / BY / NW) */
export const cities = pgTable("cities", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  state: text("state").notNull(), // HE | BY | NW
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  baseCt: real("base_ct").notNull(), // Basis-Preisniveau E10 in ct/L
});

/** Stationen mit Masterdaten + Selektions-Kennzahl δ̂ (Median vs. City-LOO-Median, Trainingszeitraum) */
export const stations = pgTable("stations", {
  id: text("id").primaryKey(),
  cityId: integer("city_id").notNull(),
  name: text("name").notNull(),
  brand: text("brand").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  profile: text("profile").notNull(), // std | aggr | disc | flat | riser
  is24h: boolean("is_24h").notNull(),
  baseOffsetCt: real("base_offset_ct").notNull(),
  pb: real("pb").notNull(), // Wahrscheinlichkeit „Nachmittags-Sprung-Tag" (nur Trainings-Realität)
  deltaCt: real("delta_ct").notNull(), // δ̂ in ct/L (Median über Trainingszeitraum, Leave-One-Out-City-Median)
});

/** 5-min-Preisraster (Poll-Fenster 06:00–23:55, UTC gespeichert, Preise in €/L) */
export const pricePoints = pgTable(
  "price_points",
  {
    stationId: text("station_id").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    price: real("price").notNull(),
    open: boolean("open").notNull(),
  },
  (t) => [primaryKey({ columns: [t.stationId, t.ts] })],
);

/** Tages-Aggregate je Station (Grundlage der Entscheidungs-Engine) */
export const dailyStats = pgTable(
  "daily_stats",
  {
    id: serial("id").primaryKey(),
    stationId: text("station_id").notNull(),
    day: date("day").notNull(),
    dow: integer("dow").notNull(),
    weekday: boolean("weekday").notNull(),
    isHoliday: boolean("is_holiday").notNull(),
    cls: integer("cls").notNull(), // 0 = Werktag, 1 = Wochenende/Feiertag
    p8: real("p8").notNull(), // Preis 08:00 in ct/L
    minPrice: real("min_price").notNull(), // Minimum nach 08:00 (offene Punkte) in ct/L
    minHour: real("min_hour").notNull(),
    bestCt: real("best_ct").notNull(), // p8 − minPrice (perfekte Sicht) in ct/L
    meanPrice: real("mean_price").notNull(),
  },
  (t) => [{ name: "daily_stats_station_day_idx", columns: [t.stationId, t.day] }],
);

/** Pro Station geschätztes „Verhalten" aus dem Trainingszeitraum (nur Trainingsdaten!) */
export const stationModels = pgTable("station_models", {
  stationId: text("station_id").primaryKey(),
  predWk: integer("pred_wk").notNull(), // vorhergesagte billigste Stunde (Werktag)
  predWe: integer("pred_we").notNull(),
  shapeWk: jsonb("shape_wk").notNull(), // number[] Stundenprofil ct (6..23) Werktag
  shapeWe: jsonb("shape_we").notNull(),
  savesWk: jsonb("saves_wk").notNull(), // number[] realisierte Ersparnisse S (Trainings-Werktage) ct/L
  savesWe: jsonb("saves_we").notNull(),
  muWk: real("mu_wk").notNull(), // E[S] Trainings-Werktage
  muWe: real("mu_we").notNull(),
  pWk: real("p_wk").notNull(), // P(S>0)
  pWe: real("p_we").notNull(),
});

/** Out-of-Sample-Entscheidungs-Protokoll (eval-Window, 14 Tage) */
export const decisionRows = pgTable(
  "decision_rows",
  {
    id: serial("id").primaryKey(),
    stationId: text("station_id").notNull(),
    day: date("day").notNull(),
    cls: integer("cls").notNull(),
    mu: real("mu").notNull(), // E[S] aus Training (ct/L)
    p: real("p").notNull(), // P(S>0) aus Training
    sCt: real("s_ct").notNull(), // realisierte Ersparnis „Warten bis Fenster" (ct/L, kann negativ sein)
    bestCt: real("best_ct").notNull(), // perfekte Sicht (ct/L)
    predHour: integer("pred_hour").notNull(),
  },
  (t) => [{ name: "decision_rows_station_day_idx", columns: [t.stationId, t.day] }],
);
