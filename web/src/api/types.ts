export type Fuel = "e10" | "e5" | "diesel";
export type DecisionAction = "refuel_now" | "wait" | "no_advice";

export interface ApiErrorPayload {
  error_code?: string;
  detail?: string;
  message?: string;
}

export interface HealthResponse {
  app?: string;
  version?: string | null;
  commit?: string | null;
  generated_at?: string | null;
  polling_error?: string | null;
  station_count?: number;
  city_options?: Array<{ value: string; label: string }>;
  prices?: { fetched_at?: string | null; [key: string]: unknown };
  collector?: CollectorStatus;
  jobs?: Record<string, JobStatus>;
  alarms?: Array<{ code: string; severity: "error" | "warn"; message: string }>;
  [key: string]: unknown;
}

export interface DecisionStation {
  id: string;
  name: string;
  brand?: string;
  price_now: number | null;
  maps_url?: string | null;
}

export interface DecisionResponse {
  primary: {
    action: DecisionAction;
    station: DecisionStation;
    recommended_window: { start: string; end: string; expected_price: number | null; expected_min_price?: number | null } | null;
    expected_saving_eur: number | null;
    expected_saving_median_eur?: number | null;
    p_correct: number | null;
    confidence_badge: "high" | "medium" | "low";
    reason_short: string;
  };
  alternatives_nearby: Array<{
    station_id: string;
    name: string;
    brand: string;
    price: number | null;
    delta_ct: number | null;
    detour_km: number | null;
    [key: string]: unknown;
  }>;
  valid_until?: string | null;
  decision_ready?: boolean;
  blocking_reasons?: string[];
  [key: string]: unknown;
}

export interface DayPoint {
  timestamp: string;
  price: number | null;
  status: string;
  [key: string]: unknown;
}

export interface OverviewResponse {
  generated_at: string;
  data_version?: string;
  partial_errors?: Array<{ component: string; error_code: string }>;
  decide: DecisionResponse;
  fills: FillsResponse;
  stats_summary: StatsSummaryResponse;
  episodes: EpisodesResponse;
  day: { points: DayPoint[]; error_code: string | null; [key: string]: unknown } | null;
  error_code?: string | null;
}

export interface VehicleProfile {
  id: string;
  name: string;
  fuel: Fuel;
  liters: number;
  consumption: number;
  time_value_eur_h: number;
  speed_kmh: number;
  detour_mode: string;
  tank_capacity_l: number;
  created_at?: string;
  updated_at?: string;
}
export interface ProfilesResponse {
  profiles: VehicleProfile[];
  active: string | null;
  error_code?: string | null;
}

export interface Station {
  station_id: string;
  city: string;
  name: string;
  brand?: string;
  fuel?: Fuel;
  maps_url?: string | null;
  price: number | null;
  last_price?: number | null;
  observed_at: string | null;
  status?: string;
  fresh?: boolean;
  age_minutes?: number | null;
  dist_km?: number | null;
  [key: string]: unknown;
}
export interface StationsResponse {
  generated_at: string;
  fuel: Fuel;
  cities: string[];
  stations: Station[];
  anchors?: Record<string, { lat: number; lon: number }>;
  connection_error?: string | null;
  fresh_prices?: number;
  error_code?: string | null;
}

export interface SeriesResponse {
  generated_at?: string;
  station_id?: string;
  fuel?: Fuel;
  points?: DayPoint[];
  hours?: Array<{ hour: string; value: number | null }>;
  error_code?: string | null;
}
export interface ForecastPoint {
  timestamp: string;
  q50: number | null;
  q025: number | null;
  q975: number | null;
  q10?: number | null;
  q90?: number | null;
  support_days?: number | null;
  supported?: boolean | null;
}
export interface ForecastResponse {
  generated_at?: string;
  station_id?: string;
  fuel?: Fuel;
  points: ForecastPoint[];
  points_3d?: ForecastPoint[];
  points_7d?: ForecastPoint[];
  error_code?: string | null;
  [key: string]: unknown;
}
export interface HeatmapResponse {
  generated_at: string;
  city: string;
  fuel: Fuel;
  kind: "level" | "probability";
  weeks: number;
  days: string[];
  hours: number[];
  matrix: Array<Array<number | null>>;
  counts?: number[][];
  error_code?: string | null;
}
export interface SelectionResponse {
  generated_at?: string;
  fuel: Fuel;
  city?: string | null;
  count: number;
  stations: Array<Record<string, unknown> & { station_id: string; name: string }>;
  error_code?: string | null;
}

export interface FillRecord {
  id: string;
  station_id: string;
  station_name?: string;
  tanked_at?: string | null;
  liters: number;
  price_paid: number;
  fuel: Fuel;
  voided?: boolean;
  [key: string]: unknown;
}
export interface FillsResponse {
  generated_at?: string;
  count: number;
  fills: FillRecord[];
  error_code?: string | null;
}
export interface BalanceRow {
  key: string;
  fills: number;
  liters: number;
  total_eur: number;
  saved_eur: number;
  saved_verified_eur?: number;
  baseline_eur: number;
  [key: string]: unknown;
}
export interface FillsSummaryResponse {
  generated_at?: string;
  n_fills_total: number;
  months: BalanceRow[];
  years: BalanceRow[];
  overall: BalanceRow & { n_without_date?: number; saved_pct: number | null };
  error_code?: string | null;
}
export interface EpisodesResponse {
  count: number;
  episodes: Array<Record<string, unknown>>;
  error_code?: string | null;
}
export interface AdviceDiaryResponse {
  generated_at: string;
  count: number;
  entries: Array<Record<string, unknown>>;
  settled_total?: number;
  reason?: string | null;
  error_code?: string | null;
}
export interface StatsSummaryResponse {
  generated_at?: string;
  fuel?: Fuel;
  city?: string | null;
  backtest?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface CollectorStatus {
  available: boolean;
  last_poll_at?: string | null;
  age_minutes?: number | null;
  fresh?: boolean;
  source?: string | null;
  error_code?: string | null;
  [key: string]: unknown;
}
export interface JobStatus {
  state?: string;
  started_at?: string | null;
  finished_at?: string | null;
  error_code?: string | null;
  [key: string]: unknown;
}
export interface JobLogResponse {
  job: string;
  available: boolean;
  count: number;
  total: number;
  lines: string[];
  updated_at: string | null;
  error_code?: string | null;
}
export interface RouteEvaluateResponse {
  city?: string;
  fuel?: Fuel;
  station_id?: string | null;
  [key: string]: unknown;
}

/** Response contracts for the current /api/v1 routes; CSV routes return text, not JSON. */
export interface ApiResponseMap {
  "/api/v1/overview": OverviewResponse;
  "/api/v1/health": HealthResponse;
  "/api/v1/decide": DecisionResponse;
  "/api/v1/stations": StationsResponse;
  "/api/v1/series": SeriesResponse;
  "/api/v1/forecast": ForecastResponse;
  "/api/v1/last_forecasts": { generated_at?: string; forecasts: ForecastResponse[]; error_code?: string | null };
  "/api/v1/heatmap": HeatmapResponse;
  "/api/v1/selection": SelectionResponse;
  "/api/v1/fills": FillsResponse;
  "/api/v1/fills/summary": FillsSummaryResponse;
  "/api/v1/profiles": ProfilesResponse;
  "/api/v1/episodes": EpisodesResponse;
  "/api/v1/advice/diary": AdviceDiaryResponse;
  "/api/v1/stats/summary": StatsSummaryResponse;
  "/api/v1/collector/status": CollectorStatus;
  "/api/v1/route/evaluate": RouteEvaluateResponse;
  "/api/v1/jobs/:job/log": JobLogResponse;
  "/api/v1/fills.csv": string;
}
