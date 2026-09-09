import { useEffect, useState } from "react";

export type Fuel = "e10" | "e5" | "diesel";
export type Station = {
  station_id: string;
  city: string;
  name: string;
  brand: string;
  fuel: Fuel;
  maps_url: string | null;
  dist_km?: number | null;
  dist_mode?: "road" | "air" | null;
  lat?: number | null;
  lon?: number | null;
  price: number | null;
  last_price: number | null;
  status: string;
  fresh: boolean;
  observed_at: string | null;
  age_minutes: number | null;
};
export type Stations = {
  generated_at: string;
  cities: string[];
  fuel: Fuel;
  stations: Station[];
  connection_error: string | null;
  fresh_prices: number;
};
export type Job = {
  state: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_success_at: string | null;
  next_run_at: string | null;
  error_code: string | null;
};
export type CollectorStatus = {
  available: boolean;
  last_poll_at?: string | null;
  age_minutes?: number | null;
  fresh?: boolean;
  source?: "influx" | "nas" | "local" | null;
  tmpfs_used_bytes?: number | null;
  tmpfs_total_bytes?: number | null;
  tmpfs_free_bytes?: number | null;
  oldest_age_days?: number | null;
  city?: string | null;
  open_count?: number | null;
  total_count?: number | null;
  generated_at?: string;
  error_code?: string | null;
  influx?: {
    available: boolean;
    last_heartbeat_at?: string | null;
    age_minutes?: number | null;
    fresh?: boolean;
    error_code?: string | null;
    fields?: Record<string, unknown>;
  } | null;
  nas?: {
    timestamp?: string | null;
    city?: string | null;
    open_count?: number | null;
    total_count?: number | null;
    poll_interval_s?: number | null;
    tmpfs_used_bytes?: number | null;
    tmpfs_total_bytes?: number | null;
    oldest_age_days?: number | null;
  } | null;
  local?: {
    last_poll_at?: string;
    city?: string;
    poll_count?: number;
    tmpfs?: { total_bytes?: number; used_bytes?: number; free_bytes?: number };
    oldest_file?: { name?: string; age_days?: number };
  } | null;
};
export type Health = {
  app: string;
  polling_error: string | null;
  influx_configured: boolean;
  archive_configured: boolean;
  jobs_enabled: boolean;
  station_count: number;
  generated_at?: string;
  archive: {
    status: string | null;
    archive_since: string | null;
    requested_until: string | null;
    missing_files: number | null;
    last_complete_until: string | null;
  };
  jobs: { archive: Job; models: Job; selection?: Job };
  models: {
    published_at: string | null;
    count: number;
    calibrated: false;
    decision_ready: false;
  };
  selection?: {
    published_at: string | null;
    count: number;
    error_code?: string | null;
  };
  collector?: CollectorStatus;
};
export type Point = { timestamp: string; price: number | null; status: string };
export type ForecastPoint = {
  timestamp: string;
  q50: number | null;
  q10?: number | null;
  q90?: number | null;
  q025: number | null;
  q975: number | null;
};
export type Forecast = {
  points: ForecastPoint[];
  points_3d?: ForecastPoint[];
  points_7d?: ForecastPoint[];
  origin?: string;
  error_code?: string;
  stale?: boolean;
  retained_previous?: boolean;
  stale_data_at_origin?: boolean;
  data_age_minutes_at_origin?: number;
  data_policy?: {
    mode: string;
    good_complete_live_days: number;
    required_complete_live_days: number;
  };
  metrics?: {
    points: number;
    mae_ct: number | null;
    mase: number | null;
    picp95_pct: number | null;
  };
};

export type Heatmap = {
  generated_at: string;
  city: string;
  fuel: Fuel;
  kind: "level" | "probability";
  weeks: number;
  station_id?: string | null;
  days: string[];
  hours: number[];
  matrix: (number | null)[][];
  points?: number;
  stations?: number;
  error_code?: string | null;
};

export type SelectionStation = {
  station_id: string;
  city: string;
  fuel: string;
  name: string;
  brand: string;
  lat?: number | null;
  lon?: number | null;
  coverage?: number;
  delta_ct?: number | null;
  ci_lo?: number | null;
  ci_hi?: number | null;
  p_value?: number | null;
  q_value?: number | null;
  significant?: boolean;
  avail?: number;
  best_hour?: number | null;
  vol_ct?: number | null;
  rank_std?: number | null;
  dist_km?: number | null;
  dist_mode?: string | null;
  maps_url?: string | null;
  score?: number;
  rank?: number;
};

export type Selection = {
  generated_at?: string;
  fuel: string;
  city?: string | null;
  cities?: string[];
  count: number;
  total_count?: number;
  stations: SelectionStation[];
  error_code?: string | null;
  calibrated?: boolean;
  decision_ready?: boolean;
};

export type RouteEvaluate = {
  city?: string;
  fuel?: string;
  station_id?: string | null;
  station_name?: string | null;
  ref_station_id?: string | null;
  ref_station_name?: string | null;
  ref_price: number;
  alt_price: number;
  delta_ct: number;
  gross_eur: number;
  detour_km_oneway: number;
  detour_km_total: number;
  mode: string;
  fuel_cost_eur: number;
  time_cost_eur: number;
  detour_cost_eur: number;
  net_eur: number;
  critical_delta_ct: number;
  worth_it: boolean;
  verdict: "worth" | "borderline" | "not_worth";
  z_used: number;
  z_auto?: boolean;
  is_peak?: boolean | null;
  consumption?: number;
  speed_kmh?: number;
  liters: number;
  generated_at?: string;
  error_code?: string | null;
};

// --- B4 M5/M7 Typen: /v1/decide, Episodes, Intent, Fills, Stats Summary ---

export type AdviceAction =
  | "refuel_now"
  | "wait"
  | "refuel_elsewhere"
  | "no_advice";
export type EpisodeStatus = "open" | "waiting" | "due" | "resolved" | "expired";
export type Intent = "none" | "wait" | "navigate" | "refuel_now" | "dismiss";
export type Compliance = "followed" | "partial" | "ignored" | "unrelated";
export type AdviceOutcome = "win" | "loss" | "tie";

export type DecideResult = {
  primary: {
    action: AdviceAction;
    station: {
      id: string;
      name: string;
      brand?: string;
      price_now: number | null;
      maps_url?: string | null;
    };
    recommended_window: {
      start: string;
      end: string;
      expected_price: number;
    } | null;
    expected_saving_eur: number;
    p_correct: number | null;
    confidence_badge: "high" | "medium" | "low";
    reason_short: string;
  };
  alternatives_nearby: Array<{
    station_id: string;
    name: string;
    brand: string;
    price: number;
    delta_ct: number;
    detour_km: number;
    net_eur: number;
    worth_it: boolean;
    maps_url?: string | null;
  }>;
  windows_today: Array<{
    start: string;
    end: string;
    expected_price: number;
  }>;
  windows_week: Array<{
    timestamp: string;
    expected_price: number;
  }>;
  episode: {
    id: string;
    status: EpisodeStatus;
    intent: Intent;
    opened_at?: string;
  };
  personal_stats: {
    advice: {
      last_30d_hits: number;
      last_30d_total: number;
      hit_rate: number | null;
      brier_30d: number | null;
    };
    wallet: {
      fills_30d: number;
      followed: number;
      saved_eur_30d: number;
    };
  };
  calibrated: boolean;
  decision_ready: boolean;
  debug?: {
    forecast_url: string;
    fitted_at?: string | null;
  };
  error_code?: string | null;
};

export type EvalRowDto = {
  day: string;
  cls: number; // 0 Werktag | 1 Wochenende
  mu: number; // E[S] ct/L
  p: number; // P(S>0)
  s: number; // realisierte Ersparnis ct/L
  best: number; // perfekte Sicht ct/L
  predHour: number;
};

export type StationModelLab = {
  predWk: number;
  predWe: number;
  shapeWk: number[];
  shapeWe: number[];
  savesWk: number[];
  savesWe: number[];
  muWk: number;
  muWe: number;
  pWk: number;
  pWe: number;
};

export type BacktestStationScore = {
  station_id: string;
  name: string;
  brand: string;
  city: string;
  delta_ct: number;
  n: number;
  n_wait: number;
  hit_wait: number | null;
  n_now: number;
  hit_now: number | null;
  sum_smart_eur: number;
  sum_commit_eur: number;
  sum_best_eur: number;
  sum_always_eur: number;
  avg_regret_ct: number;
  avg_regret_eur: number;
  p_avg: number;
  hit_freq: number;
  pot_share: number;
};

export type CalibPoint = {
  p: number;
  hit: number;
  n: number;
  stationId: string;
  cls: number;
};

export type StatsSummary = {
  generated_at: string;
  fuel: Fuel;
  city: string | null;
  backtest: {
    daysTrain: number;
    daysEval: number;
    decisionHour: number;
    defaultEps: number;
    defaultLiters: number;
    days: string[];
    stations: Array<{
      id: string;
      city: string;
      name: string;
      brand: string;
      lat: number;
      lon: number;
      delta_ct: number;
      dist_km?: number | null;
    }>;
    stationScores: BacktestStationScore[];
    totals: {
      smart: number;
      commit: number;
      best: number;
      always: number;
      regretEur: number;
      n: number;
      hitFreq: number;
      pAvg: number;
      potShare: number;
    };
    calibration: CalibPoint[];
    evalRows: Record<string, EvalRowDto[]>;
    models: Record<string, StationModelLab>;
    p8Series: Record<string, number[]>;
    scan: {
      eps: number[];
      commitEur: number[];
      smartEur: number[];
      waits: number[];
    };
  };
  live_advice: {
    n: number;
    wins: number;
    losses: number;
    ties: number;
    hit_rate: number | null;
    hit_wait: number | null;
    hit_now: number | null;
    wait_n: number;
    wait_hits: number;
    now_n: number;
    now_hits: number;
    brier_30d: number | null;
    calibrated: boolean;
    gate_status: string;
    reliability: Array<{
      bin: number;
      range: string;
      count: number;
      mean_p: number;
      empirical_hit_rate: number | null;
    }>;
  };
  wallet: {
    n_fills: number;
    followed: number;
    partial: number;
    ignored: number;
    unrelated: number;
    saved_eur: number;
    wh_hours: number[];
    last_fill?: any;
  };
  quality_metrics: {
    top3_hit_rate: number;
    mase_sprungfrei: number;
    picp_95: number;
    cusum_drift: {
      status: string;
      max_cusum: number;
      threshold: number;
    };
  };
  calibrated: boolean;
  decision_ready: boolean;
  error_code?: string | null;
};

export function rowOutcome(r: EvalRowDto, eps: number, liters = 40) {
  const wait = r.mu >= eps;
  const s = r.s;
  const hit = wait ? s > 0 : s <= 0;
  const smartCt = wait ? Math.max(s, 0) : 0;
  const committedCt = wait ? s : 0;
  const regretCt = Math.max(r.best - smartCt, 0);
  return {
    wait,
    hit,
    smartCt,
    committedCt,
    regretCt,
    regretEur: (regretCt / 100) * liters,
  };
}

export function scoreRows(
  rows: EvalRowDto[],
  eps: number,
  liters = 40,
  stationId = "",
): BacktestStationScore {
  let nWait = 0,
    hitWait = 0,
    nNow = 0,
    hitNow = 0,
    sumSmart = 0,
    sumCommit = 0,
    sumBest = 0,
    sumAlways = 0,
    sumRegretCt = 0,
    sumP = 0,
    sPos = 0;
  for (const r of rows) {
    const o = rowOutcome(r, eps, liters);
    if (o.wait) {
      nWait++;
      if (o.hit) hitWait++;
    } else {
      nNow++;
      if (o.hit) hitNow++;
    }
    sumSmart += o.smartCt;
    sumCommit += o.committedCt;
    sumBest += Math.max(r.best, 0);
    sumAlways += Math.max(r.s, 0);
    sumRegretCt += o.regretCt;
    sumP += r.p;
    if (r.s > 0) sPos++;
  }
  const n = rows.length;
  const toEur = (ct: number) => (ct / 100) * liters;
  const sumSmartEur = toEur(sumSmart);
  const pot = Math.max(sumBest, 1e-9);
  return {
    station_id: stationId,
    name: stationId,
    brand: "",
    city: "",
    delta_ct: 0,
    n,
    n_wait: nWait,
    hit_wait: nWait ? hitWait / nWait : null,
    n_now: nNow,
    hit_now: nNow ? hitNow / nNow : null,
    sum_smart_eur: sumSmartEur,
    sum_commit_eur: toEur(sumCommit),
    sum_best_eur: toEur(sumBest),
    sum_always_eur: toEur(sumAlways),
    avg_regret_ct: n ? sumRegretCt / n : 0,
    avg_regret_eur: n ? toEur(sumRegretCt) / n : 0,
    p_avg: n ? sumP / n : 0,
    hit_freq: n ? sPos / n : 0,
    pot_share: sumSmartEur / pot,
  };
}

export async function postIntent(episodeId: string, intent: string) {
  try {
    const res = await fetch(`/api/v1/episodes/${episodeId}/intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent }),
    });
    return await res.json();
  } catch {
    return { error_code: "request_failed" };
  }
}

export async function postFill(payload: {
  station_id: string;
  station_name: string;
  tanked_at?: string;
  liters: number;
  price_paid: number;
  fuel: string;
  source: string;
  episode_id?: string | null;
}) {
  try {
    const res = await fetch("/api/v1/fills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch {
    return { error_code: "request_failed" };
  }
}

// Browser-only convenience; no credentials, fill records or server writes.
export function usePreference<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => boolean,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(`tankapp.${key}`) || "null",
      );
      return valid(saved) ? (saved as T) : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`tankapp.${key}`, JSON.stringify(value));
    } catch {
      /* Storage may be disabled; the app still works. */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export function useResource<T>(
  url: string | null,
  interval: number,
  refresh: number,
) {
  const [state, setState] = useState<{
    key: string | null;
    data: T | null;
    error: boolean;
    pending: boolean;
    receivedAt: number;
  }>({ key: null, data: null, error: false, pending: false, receivedAt: 0 });
  useEffect(() => {
    if (!url) return;
    let active = true,
      busy = false;
    let controller: AbortController | null = null;
    async function load() {
      if (!active || busy) return;
      busy = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 20000);
      setState((prev) => ({ ...prev, pending: true }));
      try {
        const response = await fetch(url!, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("request_failed");
        const data: T = await response.json();
        if (active)
          setState({
            key: url,
            data,
            error: false,
            pending: false,
            receivedAt: performance.now(),
          });
      } catch {
        if (active)
          setState((prev) => ({ ...prev, error: true, pending: false }));
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), interval);
    return () => {
      active = false;
      clearInterval(timer);
      controller?.abort();
    };
  }, [url, interval, refresh]);
  return { ...state, data: state.key === url ? state.data : null };
}

// Elapsed freshness uses a monotonic browser clock, not its wall-clock timezone/settings.
export function currentPrice(
  station: Station,
  online: boolean,
  elapsedMinutes: number,
) {
  return online &&
    station.fresh &&
    station.status === "open" &&
    station.age_minutes !== null &&
    station.age_minutes + elapsedMinutes <= 30 &&
    station.price !== null &&
    Number.isFinite(station.price)
    ? station.price
    : null;
}

// Geschlossen/fehlend trennt die Linie. Offene Preise bleiben stehen
// (Treppenstufe), bis die nächste Meldung kommt — Polling-Pausen sind
// kein unbekannter Preis.
export function segments(points: Point[]) {
  const result: {
    name?: string;
    color: string;
    pts: { x: number; y: number }[];
  }[] = [];
  let group: { x: number; y: number }[] = [];
  const flush = () => {
    if (group.length) {
      result.push({
        color: "#34d399",
        pts: group,
        name: result.length ? undefined : "Beobachteter Preis",
      });
      group = [];
    }
  };
  for (const point of points) {
    const x = Date.parse(point.timestamp);
    if (
      point.status !== "open" ||
      point.price === null ||
      !Number.isFinite(x) ||
      !Number.isFinite(point.price)
    ) {
      flush();
      continue;
    }
    if (group.length) {
      const prev = group[group.length - 1];
      if (x > prev.x && prev.y !== point.price) group.push({ x, y: prev.y });
    }
    group.push({ x, y: point.price });
  }
  flush();
  return result;
}

export function splitOnGap<T extends { x: number }>(
  pts: T[],
  maxMinutes: number,
): T[][] {
  const max = maxMinutes * 60000;
  const groups: T[][] = [];
  let group: T[] = [];
  for (const p of pts) {
    if (group.length && p.x - group[group.length - 1].x > max) {
      groups.push(group);
      group = [];
    }
    group.push(p);
  }
  if (group.length) groups.push(group);
  return groups;
}

export type GapBand = { from: number; to: number };

// Lange Datenlöcher bekommen auf der Achse nur noch maxMinutes Breite,
// damit der tatsächliche Verlauf den Chart füllt statt in einer Ecke zu kleben.
// map(x) rechnet echte Zeit in komprimierte Achsenposition (ms-Einheiten),
// total ist die komprimierte Gesamtspanne. Innerhalb einer Lücke läuft die
// Abbildung linear weiter, damit Marker und Bänder dort nicht kollabieren.
export function compressedAxis(
  xMin: number,
  xMax: number,
  gaps: GapBand[],
  maxMinutes: number,
) {
  const maxGapMs = Math.max(0, maxMinutes * 60000);
  const merged: GapBand[] = [];
  for (const gap of [...gaps].sort((a, b) => a.from - b.from)) {
    if (!Number.isFinite(gap.from) || !Number.isFinite(gap.to)) continue;
    const from = Math.max(gap.from, xMin);
    const to = Math.min(gap.to, xMax);
    if (!(to > from)) continue;
    const last = merged[merged.length - 1];
    if (last && from <= last.to) last.to = Math.max(last.to, to);
    else merged.push({ from, to });
  }
  const cut = (gap: GapBand) => Math.max(0, gap.to - gap.from - maxGapMs);
  const total = Math.max(1, xMax - xMin - merged.reduce((s, g) => s + cut(g), 0));
  const map = (x: number) => {
    if (x <= xMin) return 0;
    if (x >= xMax) return total;
    let removed = 0;
    for (const gap of merged) {
      if (x >= gap.to) removed += cut(gap);
      else if (x > gap.from) {
        const span = gap.to - gap.from || 1;
        return x - xMin - removed - ((x - gap.from) / span) * cut(gap);
      } else break;
    }
    return x - xMin - removed;
  };
  return { total, map, gaps: merged };
}

// Zeitliche Lücken zwischen allen Punkten einer Diagrammserie; das Diagramm
// markiert sie als Band, statt Linien über geschlossene Zeiträume zu ziehen.
// Mit `window` (festes Zeitfenster) zählen auch die Randlücken vor dem ersten
// bzw. nach dem letzten Punkt als Lücke — sonst verschwände z. B. „keine
// Meldung seit 6 h“ am Fensterende einfach.
export function gapBands(
  series: { pts: { x: number }[] }[],
  minMinutes: number,
  window?: [number, number],
): { from: number; to: number }[] {
  const times = [...new Set(series.flatMap((s) => s.pts.map((p) => p.x)))].sort(
    (a, b) => a - b,
  );
  const min = minMinutes * 60000;
  const bands: { from: number; to: number }[] = [];
  if (window && times.length) {
    if (times[0] - window[0] > min) bands.push({ from: window[0], to: times[0] });
    const last = times[times.length - 1];
    if (window[1] - last > min) bands.push({ from: last, to: window[1] });
  }
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > min)
      bands.push({ from: times[i - 1], to: times[i] });
  }
  return bands;
}

// Luftlinie zwischen zwei Stationen (WGS84). Nur für die Umweg-Ökonomie;
// Straßenkilometer sind meist länger — das weist die UI aus.
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type TimeTick = { x: number; label: string };

// Gleichmäßige, an die Berliner Uhrzeit ausgerichtete X-Achsen-Ticks für ein
// festes Fenster (Default: 24 h). Schritt 30 min … 6 h, max. neun Ticks.
export function autoTimeTicks(from: number, to: number): TimeTick[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const span = to - from;
  const candidates = [30, 60, 120, 180, 360, 720, 1440].map((m) => m * 60000);
  const step = candidates.find((s) => span / s <= 9) ?? candidates.at(-1)!;
  const ticks: TimeTick[] = [];
  const clock = (x: number) =>
    new Date(x).toLocaleTimeString("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
    });
  for (let x = Math.ceil(from / step) * step; x <= to; x += step) {
    const label =
      clock(x) === "00:00"
        ? `${new Date(x).toLocaleDateString("de-DE", {
            timeZone: "Europe/Berlin",
            day: "2-digit",
            month: "2-digit",
          })} 00:00`
        : clock(x);
    ticks.push({ x, label });
  }
  return ticks;
}

export type DetourMode = "onroute" | "dedicated";
export type DetourResult = {
  km: number;
  grossEur: number;
  fuelEur: number;
  timeEur: number;
  netEur: number;
  criticalCtPerL: number;
  verdict: "worth" | "borderline" | "not_worth";
};

// K = d·(c/100)·p + (d/v)·z (Konzept §10). onroute: nur der Mehrweg zählt
// (einmalig); dedicated: Extrafahrt, Hin und Rück.
export function detourEconomics(input: {
  refPrice: number;
  altPrice: number;
  liters: number;
  km: number;
  mode: DetourMode;
  consumption: number;
  speedKmh: number;
  timeValueEurH: number;
}): DetourResult {
  const { refPrice, altPrice, liters, km, mode } = input;
  const d = km * (mode === "dedicated" ? 2 : 1);
  const fuelEur = (d / 100) * input.consumption * altPrice;
  const timeEur = (d / Math.max(1, input.speedKmh)) * input.timeValueEurH;
  const grossEur = (refPrice - altPrice) * liters;
  const netEur = grossEur - fuelEur - timeEur;
  const criticalCtPerL = liters > 0 ? ((fuelEur + timeEur) / liters) * 100 : 0;
  const verdict =
    netEur >= 1.5 ? "worth" : netEur >= 0.5 ? "borderline" : "not_worth";
  return { km, grossEur, fuelEur, timeEur, netEur, criticalCtPerL, verdict };
}

export const messages: Record<string, string> = {
  polling_missing: "Das gemeinsame Polling-Set fehlt auf diesem Server.",
  polling_invalid: "Das Polling-Set ist ungültig. Es wurde nichts ersetzt.",
  influx_not_configured:
    "Der vorhandene InfluxDB-Lesezugang ist noch nicht eingebunden.",
  influx_read_failed:
    "InfluxDB konnte nicht gelesen werden. Zugang oder NAS-Verbindung prüfen.",
  archive_not_configured:
    "Der private Archivzugang fehlt. Live-Preise funktionieren unabhängig davon.",
  archive_incomplete:
    "Das Archiv hat noch Lücken. Der nächste Lauf lädt fehlende Tage nach.",
  insufficient_history:
    "Noch nicht genug nutzbare Historie. Das letzte gute Ergebnis bleibt erhalten.",
  some_models_unavailable:
    "Einige Stationen haben noch kein neues Modell. Vorige Ergebnisse sind gekennzeichnet.",
  model_not_available:
    "Für diese Station und diesen Kraftstoff liegt noch kein Modell vor.",
  dependencies_missing:
    "Die Rechenpakete fehlen. Das NAS-App-Image enthält sie bereits.",
  job_start_failed:
    "Der NAS-Job konnte nicht ausgeführt werden. Schreibrechte des Datenverzeichnisses und App-Dienst prüfen; erneuter Versuch folgt.",
  job_failed:
    "Der Lauf ist fehlgeschlagen. Letzte Ergebnisse bleiben erhalten; erneuter Versuch folgt.",
  selection_not_available:
    "Noch keine Selektions-Artefakte vorhanden. Nach Modell-Job erscheint hier das Ranking mit δ̂.",
  selection_failed:
    "Selektion konnte nicht berechnet werden. Trainingsdaten prüfen.",
  collector_no_heartbeat:
    "Noch kein Collector-Herzschlag in InfluxDB. Pi-Uploader muss heartbeat.json liefern.",
  collector_check_failed:
    "Collector-Status konnte nicht geprüft werden.",
  too_many_points:
    "Zu viele Punkte für die Heatmap. Kleineres Zeitfenster wählen.",
  invalid_query: "Ungültige Anfrageparameter.",
  not_found: "Endpunkt nicht gefunden.",
};
export function problem(code?: string | null) {
  return code
    ? messages[code] || "Daten konnten nicht vollständig geladen werden."
    : null;
}
export function euro(value: number | null | undefined, decimals = 2) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("de-DE", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
}
export function timeLabel(stamp?: string | null) {
  return stamp
    ? new Date(stamp).toLocaleString("de-DE", {
        timeZone: "Europe/Berlin",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Noch kein Stand";
}
// Berliner Stunde als Dezimalzahl (z. B. 18,5) — für Peak-Erkennung und
// Tagesraster, unabhängig von der Zeitzone des Browsers.
export function berlinHour(when: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(when);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) + get("minute") / 60;
}

// Zeitwert-Automatik (Konzept §10, Sample computeValueOfTime): Peak
// 16:30–20:00 Uhr zu 16 €/h, sonst 10 €/h. Schalterwert 0 = Auto.
export function autoTimeValue(when: Date = new Date()) {
  const hour = berlinHour(when);
  const isPeak = hour >= 16.5 && hour <= 20;
  return { z: isPeak ? 16 : 10, isPeak };
}

export function clockLabel(stamp?: string | null) {
  if (!stamp) return "—";
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatHour(h: number | null | undefined) {
  if (h == null || !Number.isFinite(h)) return "—";
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
