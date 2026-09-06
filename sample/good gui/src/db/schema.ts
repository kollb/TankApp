import { pgTable, text, varchar, real, boolean, integer, timestamp, serial } from "drizzle-orm/pg-core";

export const stations = pgTable("stations", {
  id: varchar("id", { length: 64 }).primaryKey(), // UUID from MTS-K / Tankerkönig
  name: varchar("name", { length: 255 }).notNull(),
  brand: varchar("brand", { length: 100 }).notNull(),
  street: varchar("street", { length: 255 }).notNull(),
  houseNumber: varchar("house_number", { length: 50 }),
  place: varchar("place", { length: 100 }).notNull(),
  postCode: varchar("post_code", { length: 20 }),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  campaign: varchar("campaign", { length: 50 }).notNull(), // Frankfurt am Main, München-Nord, Köln-Bonn
  subdiv: varchar("subdiv", { length: 10 }).notNull(), // HE, BY, NW
  distHome: real("dist_home").notNull(), // km from home reference
  isTop10: boolean("is_top10").default(false).notNull(),
  quotaRank: integer("quota_rank"), // 1-6 for HE, 1-2 for BY, 1-2 for NW
  isOpen: boolean("is_open").default(true).notNull(),
  lastPriceE10: real("last_price_e10"),
  lastPriceE5: real("last_price_e5"),
  lastPriceDiesel: real("last_price_diesel"),
  deltaHat: real("delta_hat"), // Relative price delta vs LOO baseline (ct/L, negative is cheaper)
  ciLo: real("ci_lo"), // 95% Bootstrap CI low
  ciHi: real("ci_hi"), // 95% Bootstrap CI high
  qValue: real("q_value"), // Benjamini-Hochberg FDR
  avScore: real("av_score"), // Availability score in commuter windows (0..1)
  cheapestHour: real("cheapest_hour"), // e.g. 18.5 => 18:30
  madSigma: real("mad_sigma"), // Robust risk measure (1.4826 * MAD)
  coveragePct: real("coverage_pct"), // Data coverage gate
  mase24h: real("mase_24h"), // MASE vs seasonal naive
  picp7d: real("picp_7d"), // 7-day rolling prediction interval coverage %
  cusumDrift: real("cusum_drift"), // CUSUM drift statistic
  status: varchar("status", { length: 20 }).default("open"), // open, closed, no prices
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const pricePoints = pgTable("price_points", {
  id: serial("id").primaryKey(),
  stationId: varchar("station_id", { length: 64 }).notNull(),
  fuel: varchar("fuel", { length: 10 }).notNull(), // e10, e5, diesel
  price: real("price").notNull(),
  isOpen: boolean("is_open").default(true).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
});

export const systemHealth = pgTable("system_health", {
  id: serial("id").primaryKey(),
  collectorStatus: varchar("collector_status", { length: 50 }).default("healthy").notNull(),
  lastPollAt: timestamp("last_poll_at", { withTimezone: true }).defaultNow(),
  windowStart: varchar("window_start", { length: 10 }).default("06:00").notNull(),
  windowEnd: varchar("window_end", { length: 10 }).default("24:00").notNull(),
  tmpfsBytesUsed: integer("tmpfs_bytes_used").default(2621440).notNull(), // ~2.5 MB used
  tmpfsMaxBytes: integer("tmpfs_max_bytes").default(33554432).notNull(), // 32 MB max
  nasReachable: boolean("nas_reachable").default(true).notNull(),
  nasSyncedUntil: timestamp("nas_synced_until", { withTimezone: true }).defaultNow(),
  coveragePct: real("coverage_pct").default(99.4).notNull(),
  errorCount24h: integer("error_count_24h").default(0).notNull(),
  activeNightIds: text("active_night_ids").default(""),
});

export const fillups = pgTable("fillups", {
  id: serial("id").primaryKey(),
  stationId: varchar("station_id", { length: 64 }).notNull(),
  fuel: varchar("fuel", { length: 10 }).default("e10").notNull(),
  liters: real("liters").notNull(),
  pricePerLiter: real("price_per_liter").notNull(),
  totalCost: real("total_cost").notNull(),
  savedVsMedian: real("saved_vs_median"),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
});
