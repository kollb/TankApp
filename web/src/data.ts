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
/** Fortschritt eines laufenden NAS-Jobs (app/progress.py → /api/v1/health). */
export type JobProgress = {
  job: string;
  state: string;
  phase: string;
  phase_label: string;
  step: number;
  total: number;
  label: string;
  pct: number;
  started_at: string;
  updated_at: string;
  elapsed_s: number;
  eta_s: number | null;
  message: string;
  done: boolean;
};

export type Job = {
  state: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_success_at: string | null;
  next_run_at: string | null;
  /** Nur während eines Laufs gesetzt: Phase, Schritt x/y, Restschätzung. */
  progress?: JobProgress | null;
  /** Issue 50: Datenstand (Epochensekunden) des letzten erfolgreichen Webhook-Triggerlaufs. */
  data_watermark?: string | null;
  /** Issue 50: Webhook-Trigger des laufenden App-Prozesses (nur models/selection). */
  triggers?: number | null;
  /** Issue 50: letzter übersprungener Trigger („debounced“ | „duplicate“). */
  last_trigger_skip?: string | null;
  error_code: string | null;
  /** Bereinigte Ursache des letzten Fehlschlags (app/errors.py, ohne Pfade/Token). */
  error_detail?: string | null;
};
/** Letzte Zeilen von `runtime/jobs/<job>.log` (GET /api/v1/jobs/<job>/log). */
export type JobLog = {
  job: string;
  available: boolean;
  count: number;
  total: number;
  lines: string[];
  updated_at: string | null;
  error_code?: string | null;
};
/** Anzeigenamen der vier NAS-Jobs (wie die Job-Karten im System-Tab). */
export const JOB_LABELS: Record<string, string> = {
  archive: "Archiv-Sync",
  models: "Modell-Update",
  selection: "Selektion Ranking",
  settlement: "Beleg-Verarbeitung",
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
  jobs: { archive: Job; models: Job; selection?: Job; settlement?: Job };
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
  ref_price_source?: string | null;
  target_price?: number;
  target_price_source?: string | null;
  alt_price: number;
  delta_ct: number;
  gross_eur: number;
  detour_km_oneway: number;
  detour_km_total: number;
  detour_km_source?: string | null;
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
export type AdviceOutcome = "win" | "loss" | "tie" | "void";

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
    detour_mode?: string | null;
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
  p: number | null; // P(S>0) — null, solange die Engine kein P-Modell hat
  s: number; // realisierte Ersparnis ct/L
  best: number; // perfekte Sicht ct/L
  predHour: number;
  curve?: Array<{ x: number; y: number }>; // Erwartungskurve ct vs. Anker
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
  p_known: boolean;
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

/**
 * Bewertete Live-Tage (Übergangsregel) — ausschließlich aus der
 * Engine-Veröffentlichung (runtime/engine/current.json → policies).
 *
 * Die Zahlen zählen vollständige Kalendertage mit Tagesabdeckung ≥ Zielwert
 * je Station/Kraftstoff; der angebrochene heutige Tag zählt nicht mit.
 * `as_of` ist der Datenstand des Modell-Laufs, nicht „heute“.
 */
export type LivePhase = {
  as_of: string | null;
  stations: number;
  good_complete_days: number;
  best_complete_days: number;
  required_complete_days: number;
  days_missing: number;
  min_daily_coverage: number | null;
  live_only_stations: number;
  complete: boolean;
};

export type StatsSummary = {
  generated_at: string;
  fuel: Fuel;
  city: string | null;
  backtest: {
    daysTrain: number | null;
    daysEval: number | null;
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
      smart: number | null;
      commit: number | null;
      best: number | null;
      always: number | null;
      regretEur: number | null;
      n: number;
      hitFreq: number | null;
      pAvg: number | null;
      potShare: number | null;
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
    n_void?: number;
    n_brier?: number;
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
    top3_hit_rate: number | null;
    mase_sprungfrei: number | null;
    picp_95: number | null;
    cusum_drift: {
      status: string;
      max_cusum: number | null;
      threshold: number;
    };
  };
  /** null = die Engine hat noch keine Policies publiziert (kein Modell-Lauf). */
  live_phase: LivePhase | null;
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
    nP = 0,
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
    if (r.p != null && Number.isFinite(r.p)) {
      sumP += r.p;
      nP++;
    }
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
    p_avg: nP ? sumP / nP : 0,
    p_known: nP > 0,
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

/** Antwort des Startknopfs: POST /api/v1/jobs/{job}/run (B6, ohne Passwort). */
export type JobRunResult = {
  status?: "queued" | "running" | "debounced" | "rejected";
  job?: string;
  /** Sekunden bis zum nächsten möglichen Start (nur bei „debounced“). */
  retry_after?: number;
  error_code?: string | null;
};
export type JobRunNote = { tone: "ok" | "warn" | "error"; text: string };

/** Übersetzt die Start-Antwort ehrlich — „läuft schon“ ist kein Fehler. */
export function jobRunMessage(result: JobRunResult | null): JobRunNote {
  if (!result) return { tone: "error", text: "Keine Antwort vom Server." };
  if (result.error_code === "not_found")
    return {
      tone: "error",
      text: "Start ist hier nicht freigegeben (Hintergrundjobs aus oder abgeschaltet).",
    };
  if (result.error_code === "rate_limited")
    return {
      tone: "warn",
      text: "Zu viele Anfragen — kurz warten und erneut versuchen.",
    };
  if (result.error_code === "request_failed")
    return { tone: "error", text: "App-Server nicht erreichbar." };
  if (result.error_code)
    return {
      tone: "error",
      text: problem(result.error_code) || "Start nicht möglich.",
    };
  switch (result.status) {
    case "queued":
      return { tone: "ok", text: "Gestartet — der Lauf beginnt sofort." };
    case "running":
      return { tone: "ok", text: "Läuft bereits; Fortschritt steht in dieser Karte." };
    case "debounced":
      return {
        tone: "warn",
        text: `Gerade erst gelaufen — in ${result.retry_after ?? 60} s erneut möglich.`,
      };
    default:
      return { tone: "error", text: "Start abgelehnt." };
  }
}

export async function postJobRun(job: string): Promise<JobRunResult> {
  try {
    const res = await fetch(`/api/v1/jobs/${job}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return (await res.json()) as JobRunResult;
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
  // An Berliner Wanduhr ausrichten (nicht an UTC-Epoche): sonst stünden bei
  // 24-h-Spannen krumme Labels wie 01:00/04:00 statt 00:00/03:00.
  const berlinWall = (x: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(x)
      .reduce<Record<string, string>>((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
  };
  const offset = berlinWall((from + to) / 2) - (from + to) / 2;
  for (
    let x = Math.ceil((from + offset) / step) * step - offset;
    x <= to;
    x += step
  ) {
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
  invalid_fuel: "Unbekannter Kraftstoff (e10, e5 oder diesel erwartet).",
  invalid_liters: "Tankmenge außerhalb 5–100 Liter.",
  invalid_consumption: "Verbrauch außerhalb 3–20 L/100 km.",
  invalid_speed: "Tempo außerhalb 10–130 km/h.",
  invalid_when: "Zeitpunkt nicht parsebar (ISO, HH:MM oder Stunde erwartet).",
  invalid_value_of_time: "Zeitwert außerhalb 0–100 €/h.",
  invalid_mode: "Unbekannter Trip-Modus (onroute oder dedicated erwartet).",
  invalid_detour: "Umweg außerhalb 0–100 km.",
  unknown_station: "Station nicht im Polling-Set.",
  unknown_city: "Stadt nicht im Polling-Set.",
  price_not_available:
    "Kein Preis bestimmbar — weder live noch als Referenz. Später erneut versuchen.",
  decide_failed: "Empfehlung konnte nicht berechnet werden.",
  episode_not_found: "Episode unbekannt oder abgelaufen.",
  episodes_read_failed: "Episoden konnten nicht gelesen werden.",
  set_intent_failed: "Intent konnte nicht gespeichert werden.",
  record_fill_failed: "Tankbeleg konnte nicht gespeichert werden.",
  settlement_failed: "Settlement-Lauf ist fehlgeschlagen.",
  stats_summary_failed: "Statistik konnte nicht berechnet werden.",
  backtest_not_available:
    "Noch kein Engine-Backtest veröffentlicht. Nach dem Modell-Job erscheinen hier echte 08:00-Entscheidungszeilen.",
  payload_too_large: "Anfrage zu groß (max. 100 KB).",
  invalid_json: "Anfrage ist kein gültiges JSON.",
  invalid_request: "Ungültige Anfrage.",
  server_error: "Serverfehler. Erneuter Versuch folgt.",
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
// Issue 50: Daten-Watermark der Ereignis-Pipeline ist Epochensekunde —
// als Berliner de-DE-Zeit anzeigen, ungültige/fehlende Werte ehrlich „—“.
export function epochLabel(stamp?: string | number | null) {
  if (stamp === null || stamp === undefined || stamp === "") return "—";
  const seconds = Number(stamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return new Date(seconds * 1000).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
// Issue 50: letzte Trigger-Entscheidung des Schedulers als Kurzkopie.
export function triggerSkipLabel(skip?: string | null) {
  if (skip === "debounced") return "Debounce (Mindestabstand)";
  if (skip === "duplicate") return "Idempotenz (gleiche Daten)";
  return null;
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

// Berliner Kalenderdatum (Jahr, Monat, Tag) zu einem Zeitpunkt. Die Live-Tage
// zählt die Engine in Europe/Berlin — die UI darf dafür nicht die Zeitzone des
// Browsers benutzen (sonst rutscht das Datum an Randstunden um einen Tag).
export function berlinDay(ms: number): [number, number, number] | null {
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const day = [get("year"), get("month"), get("day")];
  return day.every(Number.isFinite)
    ? [day[0], day[1], day[2]]
    : null;
}

// „Datum des Datenstands + n Tage“ als dd.MM.yyyy. Ohne Datenstand (as_of fehlt)
// gibt es kein Datum — die UI verspricht dann kein Datum, statt eines zu raten.
export function dayAfterLabel(days: number, stamp?: string | null): string | null {
  if (!stamp || !Number.isFinite(days) || days < 0) return null;
  const day = berlinDay(Date.parse(stamp));
  if (!day) return null;
  const ms = Date.UTC(day[0], day[1] - 1, day[2] + days);
  return utcDayLabel(ms);
}

// Kalenderblatt dd.MM.yyyy (hier bewusst UTC: der Wert kommt aus dayAfterLabel
// und ist schon auf einen Berliner Kalendertag gerundet).
export function utcDayLabel(ms: number): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(ms));
}

// Countdown-Zeile für die Kalibrierungs-Freigabe. null = nichts anmerken
// (keine Daten oder Live-Phase erreicht) — nie „0 von N“ erfinden.
export function livePhaseCountdown(phase?: LivePhase | null): string | null {
  if (!phase || phase.complete) return null;
  const eta = dayAfterLabel(phase.days_missing, phase.as_of);
  const coverage =
    phase.min_daily_coverage == null
      ? ""
      : ` · Tagesabdeckung ≥ ${Math.round(phase.min_daily_coverage * 100)} %`;
  const weakest =
    phase.stations > 1 ? `, schwächste von ${phase.stations} Stationen` : "";
  return (
    `Noch ${phase.days_missing} von ${phase.required_complete_days} bewerteten Live-Tagen` +
    ` (${phase.good_complete_days}/${phase.required_complete_days}${weakest})${coverage}` +
    (phase.as_of ? ` · Datenstand ${dayLabel(phase.as_of)}` : "") +
    (eta ? ` · voraussichtlich ab ${eta}` : "")
  );
}

// Berliner Kalenderblatt dd.MM.yyyy aus einem Zeitstempel; „—“ ohne Wert.
export function dayLabel(stamp?: string | null): string {
  if (!stamp) return "—";
  const day = berlinDay(Date.parse(stamp));
  if (!day) return "—";
  return utcDayLabel(Date.UTC(day[0], day[1] - 1, day[2]));
}


// Hinweis unter Kacheln, die noch keinen Wert zeigen: erklärt den Grund, ohne
// eine Kalenderzahl vorzugeben, die niemand gemessen hat.
export function livePhaseHint(phase?: LivePhase | null): string {
  if (!phase) {
    return "Noch keine Live-Abdeckungsdaten: Die Zählung vollständiger Live-Tage beginnt mit dem ersten Modell-Lauf der Engine.";
  }
  if (phase.complete) {
    return "Live-Phase erreicht — Werte erscheinen mit den ersten empfohlenen Tankzeitpunkten.";
  }
  const eta = dayAfterLabel(phase.days_missing, phase.as_of);
  return (
    `Wert erscheint, sobald jede Station ${phase.required_complete_days} vollständige ` +
    `Live-Tage erreicht hat (noch ${phase.days_missing}${
      eta ? ` · voraussichtlich ab ${eta}` : ""
    }).`
  );
}

// §0.4 ist ein Zähl-Gate, kein Datum: Brier braucht ≥ 100 abgeschlossene
// Empfehlungen. Die Live-Tage sind nur die Vorbedingung der Übergangsregel.
export const M7_MIN_RECOMMENDATIONS = 100;

export function brierGateHint(
  phase: LivePhase | null | undefined,
  advice?: { n?: number; brier_30d?: number | null } | null,
): string | null {
  if (advice?.brier_30d != null) return null;
  const n = advice?.n ?? 0;
  const open = `Wert erscheint ab ${M7_MIN_RECOMMENDATIONS} abgeschlossenen Empfehlungen im Live-Ledger (aktuell ${n}).`;
  if (!phase) {
    return `${open} Zur Live-Phase liegen noch keine Engine-Daten vor.`;
  }
  if (phase.complete) return open;
  const eta = dayAfterLabel(phase.days_missing, phase.as_of);
  return `${open} Übergangsregel: noch ${phase.days_missing} vollständige Live-Tage${
    eta ? ` (frühestens am ${eta})` : ""
  }.`;
}
