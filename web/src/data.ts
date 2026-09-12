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
/** B4: aggregierter System-Alarm aus /api/v1/health → alarms[]. */
export type Alarm = {
  code: string;
  severity: "error" | "warn";
  message: string;
  job?: string | null;
};

export type Health = {
  app: string;
  polling_error: string | null;
  influx_configured: boolean;
  archive_configured: boolean;
  jobs_enabled: boolean;
  station_count: number;
  generated_at?: string;
  /** B9: App-Version und Commit-Hash (app/version.py). */
  version?: string | null;
  commit?: string | null;
  /** B4: aggregierte Alarme (Heartbeat, Jobs, Store, Polling). */
  alarms?: Alarm[];
  /**
   * B4: Zustand der Alarm-Zustellung (ntfy). Die Webhook-URL steht hier
   * bewusst nicht — nur ob ein Endpunkt konfiguriert ist, welche Error-Codes
   * als gemeldet gelten und wann zuletzt etwas rausging.
   */
  notify?: {
    configured: boolean;
    open_errors: string[];
    last_ok_at?: string | null;
    last_sent_at?: string | null;
  };
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
  /** B12: Vergleichs-Basis der Cheap-Probability ohne Station. */
  basis?: HeatmapBasis;
  days: string[];
  hours: number[];
  matrix: (number | null)[][];
  /** Stichprobe je Zelle — Zellen unter MIN_HEATMAP_POINTS zählen nicht. */
  counts?: number[][];
  /**
   * P0: Stichprobe der **Vergleichs-Basis** je Zelle (nur `probability`,
   * sonst `null`). Eine Zelle kann genug eigene Preise haben und trotzdem
   * ein Artefakt sein — liegt der Stunden-Median selbst auf 16 Preisen, sind
   * „100 % günstig“ Mechanik, keine Aussage. Fehlt das Feld (alte API), gilt
   * die Basis als unbekannt, nicht als dünn.
   */
  reference_counts?: (number | null)[][] | null;
  /** P0: echte Reichweite der verwendeten Preise (ISO-8601, UTC). */
  range_from?: string | null;
  range_to?: string | null;
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

/** Ein Tankbeleg (Wallet-Ledger), wie ihn GET /api/v1/fills liefert. */
export type Fill = {
  id: string;
  episode_id?: string | null;
  station_id: string;
  station_name?: string;
  tanked_at?: string | null;
  clock_hour?: number | null;
  liters: number;
  price_paid: number;
  price_source?: string;
  fuel: Fuel;
  source?: string;
  compliance?: Compliance;
  saved_vs_always_now_eur?: number;
  /** A3: storniert (voided) statt gelöscht — zählt nicht in die Bilanz. */
  voided?: boolean;
  voided_at?: string | null;
};

export type Fills = {
  generated_at?: string;
  count: number;
  fills: Fill[];
  error_code?: string | null;
};

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
    detour_km_est?: number;
    detour_mode?: string | null;
    dist_mode?: string | null;
    trip_mode?: string;
    fuel_cost_eur?: number;
    time_cost_eur?: number;
    detour_cost_eur?: number;
    gross_eur?: number;
    net_eur: number;
    critical_delta_ct?: number;
    worth_it: boolean;
    verdict: "worth" | "borderline" | "not_worth";
    p_lohnt?: number | null;
    maps_url?: string | null;
  }>;
  thresholds?: {
    active: Record<string, number>;
    auto_apply: boolean;
    tuning: {
      changed: boolean;
      reasons: string[];
      sample: Record<string, unknown>;
      targets: Record<string, number>;
      min_n?: number;
    };
  };
  windows_today: Array<{
    start: string;
    end: string;
    expected_price: number;
    expected_saving_eur: number | null;
    p: number | null;
  }>;
  windows_week: Array<{
    start: string;
    end: string;
    expected_price: number;
    expected_saving_eur: number | null;
    p: number | null;
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
  // Engine-Qualität der ausgewählten Station (Konzept §3.3.3): Rolling-PICP
  // 7 d aus dem Backtest. null = nicht veröffentlicht (Altpublikation).
  quality?: {
    rolling_picp_7d_pct: number | null;
    rolling_picp_7d_points: number | null;
    rolling_picp_7d_badge: "green" | "yellow" | "red" | null;
    rolling_picp_7d_as_of?: string | null;
    rolling_picp_window_days: number;
    rolling_picp_nominal_pct: number;
    gate: string | null;
  };
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
    /** Ausgespielte vs. noch offene Empfehlungen (Zähl-Ehrlichkeit). */
    snapshots_total?: number;
    n_pending?: number;
    wins: number;
    losses: number;
    ties: number;
    hit_rate: number | null;
    hit_wait: number | null;
    hit_now: number | null;
    hit_elsewhere?: number | null;
    wait_n: number;
    wait_hits: number;
    now_n: number;
    now_hits: number;
    elsewhere_n?: number;
    elsewhere_hits?: number;
    brier_30d: number | null;
    calibrated: boolean;
    gate_status: string;
    // Schwellen des M7-Zähl-Gates, wie app/feedback.py sie rechnet. Optional:
    // ältere Statistik-Stände liefern sie nicht, dann gilt der Fallback unten.
    min_recommendations?: number;
    brier_threshold?: number;
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

/** A3: Beleg stornieren (DELETE /api/v1/fills/{id} → voided-Flag, kein Löschen). */
export async function voidFill(fillId: string) {
  try {
    const res = await fetch(`/api/v1/fills/${encodeURIComponent(fillId)}`, {
      method: "DELETE",
    });
    return await res.json();
  } catch {
    return { error_code: "request_failed" };
  }
}

/**
 * E2: deutsche Dezimaleingabe „1,689“ → Zahl 1.689.
 *
 * ``type="number"``-Eingaben liefern auf deutschen Mobil-Tastaturen ein
 * Komma; ``Number("1,689")`` wäre NaN. Diese Funktion normalisiert das
 * Komma zuerst und lehnt alles Nicht-Numerische ab.
 */
export function germanDecimalToNumber(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized || !/^[0-9]*([.][0-9]*)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** E2: „,,“ → „.“ für die Anzeige/Normalisierung der Dezimaleingabe. */
export function commaToDot(value: string): string {
  return value.replace(/,/g, ".");
}

/**
 * E3: Grenzen der Beleg-Eingabe — Spiegel der Server-Validierung
 * (`app/feedback.py`: `MIN_LITERS`/`MAX_LITERS`, `MIN_PRICE_PAID`/
 * `MAX_PRICE_PAID`). Die GUI prüft damit *vor* dem Roundtrip, der Server prüft
 * weiterhin selbst (Defensive in Depth: defekte Clients, Doppelführung).
 *
 * Bewusst keine `min`/`max`/`step`-Attribute am Feld: die Eingaben sind seit E2
 * `type="text"` mit `inputMode="decimal"` (Komma!), und bei Textfeldern sind
 * diese Attribute wirkungslos. Die Grenzen leben deshalb in dieser Konstante,
 * die Feld-Hinweis und Prüfung gemeinsam nutzen — eine Zahl, eine Wahrheit.
 */
export const FILL_LIMITS = {
  liters: {
    label: "Liter",
    min: 5,
    max: 100,
    step: 0.5,
    decimals: 0,
    example: "45,5",
  },
  price: {
    label: "Preis",
    min: 0.4,
    max: 5,
    step: 0.001,
    decimals: 2,
    example: "1,629",
  },
} as const;

export type FillField = keyof typeof FILL_LIMITS;

/** Kurztext der erlaubten Spanne in deutscher Schreibweise („5–100 L“). */
export function fillLimitHint(field: FillField): string {
  const limit = FILL_LIMITS[field];
  const unit = field === "liters" ? "L" : "€/L";
  return `${deNumber(limit.min, limit.decimals)}–${deNumber(limit.max, limit.decimals)} ${unit}`;
}

/**
 * E3: Fehlermeldung eines Beleg-Felds oder `null`, wenn die Eingabe dem Server
 * genügen würde. Leeres Feld ist ein Hinweis, kein Fehler im Sinne von
 * „abgelehnt“ — deshalb hier ebenfalls eine Meldung (der Dialog bleibt zu).
 */
export function fillFieldError(
  field: FillField,
  raw: string,
): string | null {
  const limit = FILL_LIMITS[field];
  if (raw.trim() === "") return `Bitte ${limit.label} eingeben.`;
  const value = germanDecimalToNumber(raw);
  if (value === null) return `Zahl eingeben (z. B. ${limit.example}).`;
  // Wie der Server: offene Grenzen? Nein — `MIN <= x <= MAX` (app/feedback.py).
  if (value < limit.min || value > limit.max)
    return `${fillLimitHint(field)} erlaubt.`;
  return null;
}

export type FillDraftCheck = {
  litersError: string | null;
  priceError: string | null;
  /** E4: ohne gewählte Station kann die GUI keinen Beleg senden. */
  stationMissing: boolean;
  /** Erst wenn alles paßt, lohnt der Roundtrip zum Server. */
  ok: boolean;
};

/**
 * E3/E4: vollständige Vorprüfung des Beleg-Entwurfs. `stationId` fehlt, wenn
 * keine Station gewählt ist — dann buchbar ist der Beleg erst nach der
 * Stationswahl, statt beim Server mit `unknown_station` abzuprallen.
 */
export function checkFillDraft(input: {
  liters: string;
  price: string;
  stationId?: string | null;
}): FillDraftCheck {
  const litersError = fillFieldError("liters", input.liters);
  const priceError = fillFieldError("price", input.price);
  const stationMissing = !input.stationId;
  return {
    litersError,
    priceError,
    stationMissing,
    ok: !litersError && !priceError && !stationMissing,
  };
}

/** E5: wählbare Zeiträume der Heatmap (Wochen). 6 ist der Default. */
export const HEATMAP_WEEKS = [4, 6, 12] as const;
export type HeatmapWeeks = (typeof HEATMAP_WEEKS)[number];
export const HEATMAP_DEFAULT_WEEKS: HeatmapWeeks = 6;
export function isHeatmapWeeks(value: unknown): value is HeatmapWeeks {
  return (
    typeof value === "number" &&
    (HEATMAP_WEEKS as readonly number[]).includes(value)
  );
}

/**
 * Mindest-Stichprobe je Heatmap-Zelle: Bei 6 Wochen und 5-Minuten-Takt hat
 * eine normale Zelle Dutzende Preise — alles unter 8 ist ein Artefakt
 * (z. B. 1–2 Nacht-Preise mit 100 % Cheap-Probability) und wird
 * ausgeblendet statt zur „günstigsten Stunde“ gekürt.
 */
export const MIN_HEATMAP_POINTS = 8;
/** Mindest-Zellen je Wochentag, sonst bleibt die Tages-Zeile leer. */
export const MIN_HEATMAP_CELLS_PER_DAY = 3;
/**
 * P0 (12.09.2026): Mindest-Stichprobe der **Vergleichs-Basis**. Eine Zelle mit
 * 8 eigenen Preisen kann trotzdem ein Artefakt zeigen: Lag der Tracking-Start
 * vier Tage zurück, bestand der Stunden-Median aus 16 Preisen und jeder
 * Dienstagswert darunter → „100 % Chance günstig“ für zwölf Stunden am Stück.
 * Der Wert bleibt im Payload ehrlich stehen, aber die GUI kürt daraus keine
 * „typisch günstigste Stunde“ mehr, sondern sagt, warum die Basis dünn ist.
 * Im Dauerbetrieb (6 Wochen × 5-Minuten-Takt) ist die Schwelle leicht erfüllt.
 */
export const MIN_HEATMAP_REFERENCE = 30;

/**
 * C9/P0: Eine Heatmap-Spalte ist ein **1-Stunden-Kasten** (06:00–06:59).
 * „06–08 Uhr“ las sich wie ein Zweistundenfenster, das es im Raster nicht gab
 * — der Nutzer suchte die Spalten 06, 07, 08 und fand die Aussage nicht wieder.
 */
export function hourBucketLabel(hour: number | null | undefined): string {
  if (hour == null || !Number.isFinite(hour)) return "—";
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  return hourRunsLabel([{ start: h, end: h + 1 }]);
}

/** Zusammenhängender Stundenbereich; `end` ist exklusiv (06–07 Uhr = 6→7). */
export type HourRun = { start: number; end: number };

/**
 * Stundenliste zu Bereichen bündeln. Ein Sprung über Mitternacht trennt
 * (23, 0 → zwei Bereiche) — lieber ehrlich zwei Fenster als „23–01“ raten.
 */
export function hourRunsOf(hours: number[]): HourRun[] {
  const sorted = [...hours]
    .filter((h) => Number.isFinite(h))
    .map((h) => ((Math.floor(h) % 24) + 24) % 24)
    .sort((a, b) => a - b);
  const unique = [...new Set(sorted)];
  const runs: HourRun[] = [];
  for (const hour of unique) {
    const last = runs[runs.length - 1];
    if (last && last.end === hour) last.end = hour + 1;
    else runs.push({ start: hour, end: hour + 1 });
  }
  return runs;
}

/**
 * Bereiche als Uhrzeit-Label: „06–07 Uhr“, „06–18 Uhr“, „06–07 und 12–13 Uhr“.
 * Das Ende bleibt ohne Modulo („22–24 Uhr“, nicht „22–00 Uhr“), damit ein
 * Bereich nie rückwärts läuft; `maxRuns` kürzt Aufzählungen für schmale
 * Tabellenspalten — die volle Liste steht dann im `title`.
 */
export function hourRunsLabel(runs: HourRun[], maxRuns = 2): string {
  if (!runs.length) return "—";
  const parts = runs.map((run) => `${pad2(run.start)}–${pad2(run.end)}`);
  if (parts.length <= maxRuns) return `${joinGerman(parts)} Uhr`;
  const rest = parts.length - maxRuns;
  return `${joinGerman(parts.slice(0, maxRuns))} Uhr (+${rest} weitere)`;
}

function pad2(value: number): string {
  return String(Math.trunc(value)).padStart(2, "0");
}

/** Kleinster bekannter Wert; null, wenn alles unbekannt (nie Infinity zeigen). */
function minOrNull(values: (number | null | undefined)[]): number | null {
  const known = values.filter(
    (v): v is number => v !== null && v !== undefined && Number.isFinite(v),
  );
  return known.length ? Math.min(...known) : null;
}

/** Deutsche Aufzählung: „a“, „a und b“, „a, b und c“. */
function joinGerman(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}

/** Gleiche Werte erkennen: Der Server rundet (Level 3, Probability 1 Stelle). */
const HEATMAP_TIE_EPS = { level: 0.0005, probability: 0.05 } as const;

export type HeatmapBest = {
  /** Bester Wert der Zeile (Probability in %, Level in €/L). */
  value: number;
  /** Alle belastbaren Stunden, die gleichauf am besten sind — nicht nur eine. */
  hours: number[];
  runs: HourRun[];
  /** Mehr als eine Stunde teilt sich den Bestwert. */
  tied: boolean;
  /** Kleinste eigene Stichprobe unter den besten Zellen. */
  minCount: number | null;
  /** Kleinste Stichprobe der Vergleichs-Basis unter den besten Zellen. */
  minReference: number | null;
  /** Vergleichs-Basis unter MIN_HEATMAP_REFERENCE → Aussage ist Mechanik. */
  thinReference: boolean;
};

export type HeatmapDaySummary = {
  day: string;
  index: number;
  /** Belastbare Zellen der Zeile (n ≥ MIN_HEATMAP_POINTS). */
  cells: number;
  median: number;
  best: HeatmapBest | null;
};

/** Stichprobe der Zelle; null = Payload ohne Zähler (alte API) → unbekannt. */
export function heatmapCellCount(
  heatmap: Heatmap,
  dayIndex: number,
  hour: number,
): number | null {
  return heatmap.counts?.[dayIndex]?.[hour] ?? null;
}

/** Stichprobe der Vergleichs-Basis; null = unbekannt (alte API, kind=level). */
export function heatmapReferenceCount(
  heatmap: Heatmap,
  dayIndex: number,
  hour: number,
): number | null {
  return heatmap.reference_counts?.[dayIndex]?.[hour] ?? null;
}

/**
 * Belastbar heißt: Wert vorhanden **und** eigene Stichprobe groß genug.
 * Ohne Zähler im Payload (alte API) zählt der Wert wie bisher.
 */
export function heatmapCellOk(
  heatmap: Heatmap,
  value: number | null | undefined,
  dayIndex: number,
  hour: number,
): value is number {
  if (value == null || !Number.isFinite(value)) return false;
  const n = heatmapCellCount(heatmap, dayIndex, hour);
  return n === null || n >= MIN_HEATMAP_POINTS;
}

/**
 * Tages-Zusammenfassungen (C10) — als reine Funktion, damit Gleichstand,
 * dünne Zellen und dünne Vergleichs-Basis testbar sind statt nur klickbar.
 */
export function heatmapDaySummaries(heatmap: Heatmap): HeatmapDaySummary[] {
  const isProb = heatmap.kind === "probability";
  const eps = HEATMAP_TIE_EPS[isProb ? "probability" : "level"];
  const hours = heatmap.hours?.length ? heatmap.hours : [...Array(24).keys()];
  const out: HeatmapDaySummary[] = [];
  (heatmap.days ?? []).forEach((day, dayIndex) => {
    const row = heatmap.matrix?.[dayIndex] ?? [];
    const solid: {
      hour: number;
      value: number;
      n: number | null;
      ref: number | null;
    }[] = [];
    row.forEach((value, col) => {
      const hour = hours[col] ?? col;
      if (!heatmapCellOk(heatmap, value, dayIndex, hour)) return;
      solid.push({
        hour,
        value,
        n: heatmapCellCount(heatmap, dayIndex, hour),
        ref: heatmapReferenceCount(heatmap, dayIndex, hour),
      });
    });
    // Unter drei belastbaren Zellen bleibt die Zeile ehrlich leer — kein Median
    // und keine „günstigste Stunde“ aus ein, zwei Nacht-Zellen.
    if (solid.length < MIN_HEATMAP_CELLS_PER_DAY) return;
    const sorted = solid.map((c) => c.value).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const bestValue = sorted.reduce((acc, v) =>
      isProb ? Math.max(acc, v) : Math.min(acc, v),
    );
    const best = solid.filter((c) => Math.abs(c.value - bestValue) <= eps);
    const refs = best.map((c) => c.ref).filter((v): v is number => v !== null);
    const minReference = refs.length ? Math.min(...refs) : null;
    out.push({
      day,
      index: dayIndex,
      cells: solid.length,
      median,
      best: {
        value: bestValue,
        hours: best.map((c) => c.hour),
        runs: hourRunsOf(best.map((c) => c.hour)),
        tied: best.length > 1,
        minCount: minOrNull(best.map((c) => c.n)),
        minReference,
        thinReference:
          minReference !== null && minReference < MIN_HEATMAP_REFERENCE,
      },
    });
  });
  return out;
}

/**
 * „Typisch am günstigsten“: Probability → höchster Tages-Median, Level →
 * niedrigster. Zeilen ohne belastbare Zellen treten nicht an.
 */
export function heatmapBestDay(
  summaries: HeatmapDaySummary[],
  kind: Heatmap["kind"],
): HeatmapDaySummary | null {
  if (!summaries.length) return null;
  return summaries.reduce((acc, s) =>
    kind === "probability"
      ? s.median > acc.median
        ? s
        : acc
      : s.median < acc.median
        ? s
        : acc,
  );
}

export type HeatmapCoverage = {
  fromMs: number;
  toMs: number;
  /** Kalendertage (Europe/Berlin), die der Bestand abdeckt. */
  days: number;
  /** Tage des angefragten Fensters (weeks × 7). */
  windowDays: number;
  /** Bestand deckt das Fenster ab — keine „wo sind die Zahlen?“-Frage offen. */
  complete: boolean;
};

/**
 * P0: Fenster ≠ Bestand. Seit dem Tracking-Start am Dienstag bleibt die
 * Mo-Zeile leer, weil es schlicht keinen Montag im Bestand gibt — das darf
 * nicht wie Datenverlust aussehen.
 */
export function heatmapCoverage(heatmap: Heatmap): HeatmapCoverage | null {
  const fromMs = Date.parse(heatmap.range_from ?? "");
  const toMs = Date.parse(heatmap.range_to ?? "");
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return null;
  }
  const from = berlinDay(fromMs);
  const to = berlinDay(toMs);
  const days =
    from && to
      ? Math.round(
          (Date.UTC(to[0], to[1] - 1, to[2]) - Date.UTC(from[0], from[1] - 1, from[2])) /
            86_400_000,
        ) + 1
      : null;
  const weeks = Number.isFinite(heatmap.weeks) ? heatmap.weeks : 0;
  const windowDays = Math.max(0, Math.round(weeks * 7));
  return {
    fromMs,
    toMs,
    days: days ?? Math.ceil((toMs - fromMs) / 86_400_000) + 1,
    windowDays,
    complete: days === null ? false : days >= windowDays,
  };
}

/** „Di 08.09. 05:10 – Sa 12.09. 07:55 Uhr“ — Berliner Zeit, wie der Nutzer. */
export function heatmapRangeLabel(heatmap: Heatmap): string | null {
  const coverage = heatmapCoverage(heatmap);
  if (!coverage) return null;
  return `${berlinStamp(coverage.fromMs)} – ${berlinStamp(coverage.toMs)} Uhr`;
}

function berlinStamp(ms: number): string {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // de-DE hängt ans Kürzel einen Punkt („Di.“) — im Fließtext ohne lesbarer.
  const weekday = get("weekday").replace(/\.$/, "");
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${weekday} ${get("day")}.${get("month")}. ${hour}:${get("minute")}`;
}

/** Bestand + Reichweite in einem Satz; null, wenn der Payload nichts hergibt. */
export function heatmapSampleLabel(heatmap: Heatmap): string | null {
  const points = heatmap.points;
  if (points == null || !Number.isFinite(points)) return null;
  const stations =
    heatmap.stations != null && Number.isFinite(heatmap.stations)
      ? ` von ${countLabel(heatmap.stations)} Stationen`
      : "";
  return `${countLabel(points)} Preise${stations}`;
}

/**
 * Erklärt leere Zeilen, bevor der Nutzer Datenverlust vermutet: nur wenn das
 * Fenster größer ist als der Bestand.
 */
export function heatmapCoverageNote(heatmap: Heatmap): string | null {
  const coverage = heatmapCoverage(heatmap);
  if (!coverage || coverage.complete || coverage.windowDays <= 0) return null;
  const label = heatmapRangeLabel(heatmap);
  return (
    `Fenster ${coverage.windowDays} Tage (${heatmap.weeks} Wochen), Bestand aber nur ` +
    `${coverage.days} ${coverage.days === 1 ? "Tag" : "Tage"}${label ? ` — ${label}` : ""}. ` +
    "Wochentage, die in dieser Zeit nicht vorkamen, bleiben leer: Das sind fehlende Tage, kein Datenverlust."
  );
}


/**
 * B12: Vergleichs-Basis der Cheap-Probability ohne Station.
 * `hour` = Median **derselben Stunde** (Spalten-Basis) — rechnet den Tagesgang
 * heraus, damit die Wochentage untereinander vergleichbar sind.
 * `overall` = Gesamtmedian des Zeitfensters (wie vor B12).
 */
export type HeatmapBasis = "overall" | "hour";
export const HEATMAP_BASES: HeatmapBasis[] = ["hour", "overall"];
export const HEATMAP_DEFAULT_BASIS: HeatmapBasis = "hour";
export function isHeatmapBasis(value: unknown): value is HeatmapBasis {
  return (
    typeof value === "string" && (HEATMAP_BASES as string[]).includes(value)
  );
}

/**
 * Anfrage-Pfad der Heatmap — als reine Funktion, damit die Verdrahtung von
 * Wochen (E5) und Basis (B12) testbar ist und GUI und API-Explorer dieselbe
 * URL bauen.
 */
export function heatmapPath(input: {
  city: string;
  fuel: string;
  kind: "level" | "probability";
  weeks: number;
  basis?: HeatmapBasis;
  stationId?: string | null;
}): string {
  const params = new URLSearchParams({
    city: input.city,
    fuel: input.fuel,
    kind: input.kind,
    weeks: String(input.weeks),
  });
  if (input.basis) params.set("basis", input.basis);
  if (input.stationId) params.set("station_id", input.stationId);
  return `/api/v1/heatmap?${params.toString()}`;
}

/**
 * A6: Share-URL für die eigene Sicht — reine Funktionen, damit Lesen und
 * Bauen testbar sind (dasselbe Muster wie heatmapPath).
 *
 * Beim Start gelesen (`readShareParams`) übernimmt die GUI Stadt, Kraftstoff,
 * Station, Tankmenge — und seit 0.11 auch heatmapWeeks/heatmapBasis, denn
 * beides ist inzwischen eine echte Preference: Ohne Übernahme würde eine
 * geteilte Ansicht auf dem fremden Gerät mit dessen localStorage-Werten
 * falsch wiederhergestellt. Ungültige/feindliche Parameter werden still
 * weggelassen (die GUI fällt auf ihre Defaults zurück), nie als Fehler.
 */

/** Parameter, die eine geteilte Ansicht belegen darf. */
export type ShareConfig = {
  city?: string;
  fuel?: Fuel;
  stationId?: string;
  liters?: number;
  heatmapWeeks?: HeatmapWeeks;
  heatmapBasis?: HeatmapBasis;
};

/** Aktuelle Sicht als Share-Parameter — kommt aus readShareParams heraus. */
export type ShareView = {
  city: string;
  fuel: Fuel;
  stationId: string | null;
  liters: number;
  heatmapWeeks: number;
  heatmapBasis: HeatmapBasis;
};

/** Dieselben Grenzen wie die localStorage-Preferences der GUI. */
const SHARE_LITERS_MIN = 10;
const SHARE_LITERS_MAX = 80;

export function readShareParams(search: string): ShareConfig {
  const params = new URLSearchParams(search);
  const out: ShareConfig = {};
  const city = params.get("city")?.trim();
  if (city && city.length <= 60) out.city = city;
  const fuel = params.get("fuel");
  if (fuel === "e10" || fuel === "e5" || fuel === "diesel") out.fuel = fuel;
  const stationId = params.get("station_id")?.trim();
  if (stationId && stationId.length <= 64) out.stationId = stationId;
  const litersRaw = params.get("liters");
  if (litersRaw !== null) {
    const liters = germanDecimalToNumber(litersRaw);
    if (
      liters !== null &&
      Number.isFinite(liters) &&
      liters >= SHARE_LITERS_MIN &&
      liters <= SHARE_LITERS_MAX
    ) {
      out.liters = liters;
    }
  }
  const weeks = Number(params.get("weeks"));
  if (isHeatmapWeeks(weeks)) out.heatmapWeeks = weeks;
  const basis = params.get("basis");
  if (isHeatmapBasis(basis)) out.heatmapBasis = basis;
  return out;
}

/** Baut die Query einer geteilten Ansicht; Defaults bleiben außen vor. */
export function shareQuery(view: ShareView): string {
  const params = new URLSearchParams();
  if (view.city) params.set("city", view.city);
  params.set("fuel", view.fuel);
  if (view.stationId) params.set("station_id", view.stationId);
  if (view.liters !== 40) params.set("liters", String(view.liters));
  if (isHeatmapWeeks(view.heatmapWeeks) && view.heatmapWeeks !== HEATMAP_DEFAULT_WEEKS) {
    params.set("weeks", String(view.heatmapWeeks));
  }
  if (isHeatmapBasis(view.heatmapBasis) && view.heatmapBasis !== HEATMAP_DEFAULT_BASIS) {
    params.set("basis", view.heatmapBasis);
  }
  return params.toString();
}

/**
 * E6: Wert aus einem Begleit-Zahlenfeld — deutsche Dezimaleingabe, in den
 * Bereich des zugehörigen Sliders geklemmt. `null`, wenn noch keine Zahl
 * drinsteht (das Feld behält dann seinen alten Wert, statt ihn zu erfinden).
 */
export function sliderCommit(
  raw: string,
  bounds: { min: number; max: number },
): number | null {
  const value = germanDecimalToNumber(raw);
  if (value === null) return null;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

// Browser-only convenience; no credentials, fill records or server writes.
// A6: `initial` setzt eine geteilte Ansicht (Share-URL) **vor** den
// localStorage-Wert — sonst würde die geteilte Sicht vom gespeicherten Stand
// des fremden Geräts überschrieben. Danach gilt sie wie jede Preference.
export function usePreference<T>(
  key: string,
  fallback: T,
  valid: (value: unknown) => boolean,
  initial?: T,
) {
  const [value, setValue] = useState<T>(() => {
    if (initial !== undefined && valid(initial)) return initial;
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
    errorCode: string | null;
    pending: boolean;
    receivedAt: number;
  }>({
    key: null,
    data: null,
    error: false,
    errorCode: null,
    pending: false,
    receivedAt: 0,
  });
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
        if (!response.ok) {
          // Fehlerantworten tragen ein error_code (z. B. "unknown_station"
          // bei 404). Wir heben es hoch, damit die GUI eine verständliche
          // Meldung zeigen kann statt des nackten Codes.
          let errorCode: string | null = null;
          try {
            const body = (await response.json()) as {
              error_code?: string | null;
            };
            errorCode = body?.error_code ?? null;
          } catch {
            errorCode = null;
          }
          if (active)
            setState((prev) => ({
              ...prev,
              error: true,
              errorCode,
              pending: false,
            }));
          return;
        }
        const data: T = await response.json();
        if (active)
          setState({
            key: url,
            data,
            error: false,
            errorCode: null,
            pending: false,
            receivedAt: performance.now(),
          });
      } catch {
        if (active)
          setState((prev) => ({
            ...prev,
            error: true,
            errorCode: null,
            pending: false,
          }));
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
};

// Umweg-Konvention (Prüfstand §1.5): Die Luftlinie zwischen Stationskoordinaten
// ist keine Straßenstrecke. Server (app/route.py, app/decide.py) und
// data-tools/road_route.py rechnen mit Luftlinie × 1,3 — die GUI schickt
// und rechnet mit derselben Größe, damit „Server prüfen“ und die lokale
// Rechnung denselben km-Wert vergleichen.
export const CIRCUITY = 1.3;

// K = d·(c/100)·p + (d/v)·z (Konzept §10). onroute: nur der Mehrweg zählt
// (einmalig); dedicated: Extrafahrt, Hin und Rück.
// H1/B6: keine hart kodierten Schwellen mehr — Verdict kommt ausschließlich vom Server.
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
  return { km, grossEur, fuelEur, timeEur, netEur, criticalCtPerL };
}

// H1/B6: reines Verdict-Mapping ohne Konstanten — Schwellen kommen vom Server (thresholds.active).
export function detourVerdict(
  netEur: number,
  worthEur: number,
  borderlineEur: number,
): "worth" | "borderline" | "not_worth" {
  if (netEur >= worthEur) return "worth";
  if (netEur >= borderlineEur) return "borderline";
  return "not_worth";
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
    "Noch keine Selektions-Artefakte vorhanden. Nach dem Modell-Lauf erscheint hier das Ranking nach Preis-Abstand (δ̂).",
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
  invalid_price: "Preis außerhalb 0,40–5,00 €/L.",
  store_too_large:
    "Persönlicher Speicher ist voll. Bitte den Betreiber informieren (Store zu groß).",
  not_implemented: "Dieser Endpunkt ist (bewusst) nicht implementiert.",
  invalid_consumption: "Verbrauch außerhalb 3–20 L/100 km.",
  invalid_speed: "Tempo außerhalb 10–130 km/h.",
  invalid_when: "Zeitpunkt nicht parsebar (ISO, HH:MM oder Stunde erwartet).",
  invalid_value_of_time: "Zeitwert außerhalb 0–100 €/h.",
  invalid_mode: "Unbekannter Trip-Modus (onroute oder dedicated erwartet).",
  invalid_detour: "Umweg außerhalb 0–100 km.",
  invalid_basis: "Unbekannte Vergleichs-Basis (overall oder hour erwartet).",
  unknown_station: "Station nicht im Polling-Set.",
  unknown_city: "Stadt nicht im Polling-Set.",
  price_not_available:
    "Kein Preis bestimmbar — weder live noch als Referenz. Später erneut versuchen.",
  decide_failed: "Empfehlung konnte nicht berechnet werden.",
  episode_not_found: "Episode unbekannt oder abgelaufen.",
  episodes_read_failed: "Episoden konnten nicht gelesen werden.",
  set_intent_failed: "Intent konnte nicht gespeichert werden.",
  record_fill_failed: "Tankbeleg konnte nicht gespeichert werden.",
  fills_read_failed: "Tankbelege konnten nicht gelesen werden.",
  void_fill_failed: "Beleg konnte nicht storniert werden.",
  fill_not_found: "Beleg nicht gefunden (oder bereits abgelaufen).",
  settlement_failed: "Settlement-Lauf ist fehlgeschlagen.",
  stats_summary_failed: "Statistik konnte nicht berechnet werden.",
  backtest_not_available:
    "Noch kein Prüfstand-Ergebnis veröffentlicht. Sobald der tägliche Modell-Lauf genug echte Preishistorie auswerten konnte, erscheinen hier die echten Tages-Entscheidungen (Tages-Anker, Standard 12:00 Uhr).",
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

/**
 * C9: Formatierungs-Konventionen als reine Funktionen — überall de-DE,
 * €/L mit drei Nachkommastellen, ct/L mit einer, Prozent ohne Dezimalstelle
 * (eine, wo der Server eine liefert). Panels sollen runden, nicht raten; die
 * vitest-Fälle in `data.test.ts` halten die Konvention fest.
 */
export function euroPerLiter(value: number | null | undefined, decimals = 3) {
  return value == null || !Number.isFinite(value) ? "—" : `${euro(value, decimals)} €/L`;
}

export function centPerLiter(value: number | null | undefined, decimals = 1) {
  return value == null || !Number.isFinite(value) ? "—" : `${euro(value, decimals)} ct/L`;
}

/** €/L → ct/L (Vorzeichen behalten, Rundung erst beim Formatieren). */
export function euroToCentPerLiter(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : value * 100;
}

export function percentLabel(value: number | null | undefined, decimals = 0) {
  return value == null || !Number.isFinite(value) ? "—" : `${euro(value, decimals)} %`;
}

/** Tausender-Trennung de-DE („12.345“) — Zählerstände, nie Preise. */
export function countLabel(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : Math.round(value).toLocaleString("de-DE");
}

/**
 * Uhrzeit-**Bereich** über ganze Stunden: „18–20 Uhr“ (Konzept-Sprechweise der
 * Entscheidung). Einzelne Rasterzellen heißen dagegen `hourBucketLabel`.
 */
export function hourRangeLabel(
  fromHour: number | null | undefined,
  toHour: number | null | undefined,
) {
  if (fromHour == null || toHour == null) return "—";
  if (!Number.isFinite(fromHour) || !Number.isFinite(toHour)) return "—";
  const from = ((Math.floor(fromHour) % 24) + 24) % 24;
  const to = ((Math.floor(toHour) % 24) + 24) % 24;
  return `${String(from).padStart(2, "0")}–${String(to).padStart(2, "0")} Uhr`;
}
/**
 * B4 (GUI): Ein Satz zum Zustand der Alarm-Zustellung für den System-Tab.
 *
 * Reine Funktion über `/api/v1/health` → `notify`, damit der Text testbar
 * bleibt und die Panels nicht jeweils eigene Formulierungen erfinden. Der
 * Ton folgt der Ehrlichkeits-Regel: „nicht eingerichtet“ ist kein Fehler,
 * sondern eine Tatsache — und „keine offenen Fehler“ heißt nicht „getestet“.
 */
export type NotifyState = NonNullable<Health["notify"]>;

export function notifyTone(
  notify?: NotifyState | null,
): "off" | "ok" | "alert" {
  if (!notify?.configured) return "off";
  return (notify.open_errors?.length ?? 0) > 0 ? "alert" : "ok";
}

export function notifyStatusLine(notify?: NotifyState | null) {
  const tone = notifyTone(notify);
  if (tone === "off") {
    return "Keine Push-Zustellung eingerichtet — Alarme stehen nur hier in der GUI.";
  }
  const open = notify?.open_errors?.length ?? 0;
  if (open > 0) {
    return open === 1
      ? "1 Alarm ist als gemeldet vermerkt — er gilt weiter als offen."
      : `${open} Alarme sind als gemeldet vermerkt — sie gelten weiter als offen.`;
  }
  return "Zustellung eingerichtet, gerade ist kein Fehler offen.";
}

export function notifyLastLine(notify?: NotifyState | null) {
  if (!notify?.configured) return null;
  if (notify.last_sent_at) {
    return `Zuletzt gemeldet: ${timeLabel(notify.last_sent_at)}`;
  }
  if (notify.last_ok_at) {
    return `Zuletzt „wieder betriebsbereit“: ${timeLabel(notify.last_ok_at)}`;
  }
  return "Seit dem Start wurde noch nichts verschickt.";
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

/**
 * C6 (Rest): „Datenstand älter als X“ — eine Regel für alle Panels.
 *
 * Bis jetzt entschied jedes Panel selbst, ob ein Stand noch frisch ist (oder
 * sagte gar nichts). Das ist genau die Stelle, an der die App unehrlich wird:
 * Eine Zahl von gestern sieht aus wie eine Zahl von jetzt. Die Schwellen
 * hängen an der Natur der Daten, nicht am Panel — deshalb stehen sie hier.
 *
 * `stale` = älter als der Erwartungswert, aber noch brauchbar (gelb).
 * `old` = so alt, dass die Aussage nicht mehr trägt (rot, doppelte Schwelle).
 */
export type Freshness = "fresh" | "stale" | "old" | "unknown";

/** Minuten, ab denen ein Datenstand als veraltet gilt — je Datenart. */
export const STALE_AFTER_MINUTES = {
  /** Preise: der Collector pollt alle 5 min, ab 30 min stimmt etwas nicht. */
  prices: 30,
  /** Prognosen/Heatmaps: Modell-Lauf im 30-min-/Stunden-Takt. */
  model: 180,
  /** Selektion: läuft täglich, ein Tag Verzug ist normal. */
  selection: 36 * 60,
} as const;

export type DataKind = keyof typeof STALE_AFTER_MINUTES;

/** Alter eines Zeitstempels in Minuten (null = nicht bestimmbar). */
export function ageMinutes(stamp?: string | null, now: number = Date.now()) {
  if (!stamp) return null;
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, (now - ms) / 60000);
}

export function freshness(
  stamp: string | null | undefined,
  kind: DataKind,
  now: number = Date.now(),
): Freshness {
  const age = ageMinutes(stamp, now);
  if (age == null) return "unknown";
  const limit = STALE_AFTER_MINUTES[kind];
  if (age >= limit * 2) return "old";
  if (age >= limit) return "stale";
  return "fresh";
}

/** Alter in Worten: „vor 4 Minuten“, „vor 3 Stunden“, „vor 2 Tagen“. */
export function ageLabel(stamp?: string | null, now: number = Date.now()) {
  const age = ageMinutes(stamp, now);
  if (age == null) return "—";
  const minutes = Math.round(age);
  if (minutes < 1) return "gerade eben";
  if (minutes === 1) return "vor 1 Minute";
  if (minutes < 60) return `vor ${minutes} Minuten`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "vor 1 Stunde";
  if (hours < 24) return `vor ${hours} Stunden`;
  const days = Math.round(hours / 24);
  return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

/**
 * Der Banner-Satz — oder `null`, wenn der Stand frisch genug ist.
 *
 * Bewusst ohne Schuldzuweisung und ohne Handlungsbefehl: Der Satz nennt das
 * Alter und die Folge. Was zu tun ist, steht im System-Tab, nicht über jedem
 * Panel.
 */
export function dataAgeNote(
  stamp: string | null | undefined,
  kind: DataKind,
  now: number = Date.now(),
): { tone: "warn" | "error"; text: string } | null {
  const state = freshness(stamp, kind, now);
  if (state === "fresh" || state === "unknown") return null;
  const when = ageLabel(stamp, now);
  const at = timeLabel(stamp);
  if (kind === "prices") {
    return {
      tone: state === "old" ? "error" : "warn",
      text: `Datenstand ${when} (${at} Uhr) — der Collector hat länger nichts geliefert, die Preise können eingefroren sein.`,
    };
  }
  if (kind === "model") {
    return {
      tone: state === "old" ? "error" : "warn",
      text: `Datenstand ${when} (${at} Uhr) — seitdem lief kein Modell-Update, die Prognose kann veraltet sein.`,
    };
  }
  return {
    tone: state === "old" ? "error" : "warn",
    text: `Datenstand ${when} (${at} Uhr) — das Ranking stammt aus einem älteren Selektions-Lauf.`,
  };
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
// (keine Daten oder Freigabe erfüllt) — nie „0 von N“ erfinden.
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
    return "Noch keine Zählung: Sie beginnt mit dem ersten Modell-Lauf — erst dann ist bekannt, welche Tage vollständig live beobachtet wurden.";
  }
  if (phase.complete) {
    return "Erfüllt: Alle Stationen rechnen nur noch mit eigenen Live-Beobachtungen — das Archiv ist aus dem Training raus.";
  }
  const eta = dayAfterLabel(phase.days_missing, phase.as_of);
  return (
    `Noch ${phase.days_missing} vollständige Live-Tage, bis jede Station ` +
    `${phase.required_complete_days} erreicht hat${
      eta ? ` (voraussichtlich ab ${eta})` : ""
    }.`
  );
}

// §0.4 ist ein Zähl-Gate, kein Datum: Brier < 0,25 bei ≥ 100 abgeschlossenen
// Empfehlungen. Maßgeblich sind die Schwellen des Backends
// (app/feedback.py → live_advice.min_recommendations / brier_threshold); die
// Konstanten hier sind nur der Rückfall für Statistik-Stände, die sie nicht
// mitschicken. Die 90-Tage-Übergangsregel (live_only_days der Engine) gehört
// bewusst nicht in diesen Zähler: 90 Übergangs-Tage sind keine 100
// Empfehlungen, bei ~1 Empfehlung/Tag wäre das ein Nenner von ~100 Tagen.
export const M7_MIN_RECOMMENDATIONS = 100;
export const M7_BRIER_THRESHOLD = 0.25;

export type M7Advice = {
  n?: number | null;
  brier_30d?: number | null;
  min_recommendations?: number | null;
  brier_threshold?: number | null;
  /** Noch laufende Empfehlungen (Fenster nicht vorbei, zählen erst nach Abrechnung). */
  n_pending?: number | null;
};

// Kurze deutsche Schreibweise ohne erzwungene Nullen (6,5 statt 6,50) — für
// Werte, die direkt aus einem Eingabefeld kommen und nicht gerundet werden
// sollen (E6: Begleitfeld am Slider).
export function deTrimmed(value: number, maxDecimals = 2): string {
  return !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("de-DE", { maximumFractionDigits: maxDecimals });
}

// Kurzer Schwellwert in deutscher Schreibweise (0,25 statt 0.25).
export function deNumber(value: number, decimals = 2): string {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Fortschrittszeile des M7-Gates: Zählstand abgeschlossener Empfehlungen und
 * Brier gegen Schwellwert — ohne Tageszahl. Die Übergangsregel (Datenhygiene)
 * hat mit {@link transitionRuleLine} ihre eigene Zeile und ihren eigenen
 * Nenner. `null` ohne Statistik-Lauf: dann gibt es keinen Zähler zu zeigen.
 */
export function m7GateLine(advice?: M7Advice | null): string | null {
  if (!advice) return null;
  const n = advice.n ?? 0;
  const need = advice.min_recommendations ?? M7_MIN_RECOMMENDATIONS;
  const limit = deNumber(advice.brier_threshold ?? M7_BRIER_THRESHOLD);
  const pending = advice.n_pending ?? 0;
  const pendingNote =
    pending > 0
      ? ` ${pending} Empfehlung${pending > 1 ? "en" : ""} läuft${pending > 1 ? "en" : ""} noch und zählt erst nach der Abrechnung.`
      : "";
  if (n < need) {
    return (
      `Freigabe offen: ${n} von ${need} abgeschlossenen Empfehlungen ` +
      `(Brier-Schwelle < ${limit}).${pendingNote}`
    );
  }
  if (advice.brier_30d == null) {
    return (
      `Freigabe erfüllt (${n} Empfehlungen) — Brier noch nicht messbar ` +
      `(keine P-Schätzung im Ledger).${pendingNote}`
    );
  }
  return (
    `Freigabe erfüllt: ${n} Empfehlungen, Brier ${deNumber(advice.brier_30d)} ` +
    `(Schwelle < ${limit}).${pendingNote}`
  );
}

/**
 * Übergangsregel der Datenhygiene: Archiv → Live-Polling, Schwelle ist
 * `live_only_days` der Engine (bootstrap/CLI, Default 90). Eigene Zeile, weil
 * es eine eigene Freigabe ist — diese Tage zählen nicht auf das M7-Gate.
 */
export function transitionRuleLine(phase?: LivePhase | null): string {
  const head = "Datenumstellung Archiv → Live-Polling";
  if (!phase) {
    return `${head}: Noch keine Zählung — sie beginnt mit dem ersten Modell-Lauf. Erst dann ist bekannt, welche Tage vollständig live beobachtet wurden.`;
  }
  if (phase.complete) {
    return (
      `${head}: erfüllt — ${phase.live_only_stations} von ${phase.stations} ` +
      `Stationen rechnen nur noch mit eigenen Live-Beobachtungen.`
    );
  }
  return `${head}: ${livePhaseCountdown(phase) ?? livePhaseHint(phase)}`;
}
