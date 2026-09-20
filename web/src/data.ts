import { useEffect, useRef, useState } from "react";
import type { WebhookState } from "./system";
import { enqueueWrite, isTransportError } from "./offline-queue";
import { authHeaders, onReadTokenChange } from "./readToken";

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
  /** Anker (Heimat-Startpunkt) je Stadt — nur die abgefragte Stadt ist enthalten. */
  anchors?: Record<string, { lat: number; lon: number }>;
  connection_error: string | null;
  fresh_prices: number;
  /**
   * Nur der RP2-Fallback setzt das: ``"offline"``, wenn der Pi antwortet,
   * weil das NAS nicht erreichbar ist (``rp2/fallback_gui.py``). Die Felder
   * ``cities``/``stations`` sind dort dieselben — die Herkunft ist damit
   * sichtbar, statt als NAS-Antwort durchzugehen.
   */
  nas_status?: "online" | "offline";
};

/**
 * O44: Ein Stations-Payload muss tragen, wofür es gehalten wird.
 *
 * Befund 17.09.2026: Im Betrieb antwortete der Pi-Fallback (`rp2/fallback_gui.py`,
 * Port 8000) auf eine SPA geladen hatte — dessen `/api/v1/stations` liefert
 * ``{fuel, stations, fresh_prices, nas_status}`` **ohne** ``cities``. Die
 * Ansicht las ``data?.cities.includes(city)``: ``data`` war gesetzt, ``cities``
 * nicht — ``TypeError: Cannot read properties of undefined (reading 'includes')``
 * und die ganze App blieb weiß. Ein einzelnes Fremd-Payload darf nie mehr als
 * eine leere Seite kosten.
 *
 * ``null`` heißt hier „kein Stations-Payload“ und wird von der Ansicht wie
 * „keine Daten“ behandelt (ehrlicher Zustand); ein fehlendes ``cities`` ist
 * genau das, kein leeres Set.
 */
export function usableStations(payload: Stations | null | undefined): Stations | null {
  if (!payload) return null;
  if (!Array.isArray(payload.cities) || !Array.isArray(payload.stations)) return null;
  return payload;
}
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
  /** B24: Abbruchzeitpunkt/-phase eines hart beendeten Laufs (state=aborted). */
  aborted_at?: string | null;
  aborted_phase?: string | null;
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
  // B8: Trigger Pi → NAS — kommt mit dem Herzschlag-Punkt des Uploaders.
  // ``null`` heißt „keine Angabe“, nicht „in Ordnung“.
  webhook?: WebhookState | null;
  webhook_source?: "influx" | null;
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
  /** O22: Größe der Veröffentlichung in Byte (nur `publication_*`). */
  bytes?: number | null;
  /** O22: Warn-Budget bzw. Leselimit in Byte (nur `publication_*`). */
  budget_bytes?: number;
  max_bytes?: number;
  /** O22: Grund der Unlesbarkeit — `too_large` oder `invalid`. */
  reason?: string | null;
};

/**
 * O22 (0.44.0): Größe und Lesbarkeit der Veröffentlichung der Prognosen
 * (`data/runtime/engine/current.json`). `bytes` über `budget_bytes` wird zu
 * `publication_large` (warn), über `max_bytes` zu `publication_unreadable`
 * (error) — vorher fiel eine zu große Datei still als „keine Prognose“ aus.
 */
export type PublicationStatus = {
  bytes: number | null;
  budget_bytes: number;
  max_bytes: number;
  over_budget: boolean;
  readable: boolean;
  error_code: string | null;
  /** `missing` · `too_large` · `invalid` · null */
  reason: string | null;
};

export type Health = {
  app: string;
  polling_error: string | null;
  // B21: erwarteter Pfad des Polling-Sets für die GUI-Diagnose
  polling_path?: string | null;
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
  /** O22: Größe und Lesbarkeit der Prognose-Veröffentlichung. */
  publication?: PublicationStatus | null;
  /**
   * O39: Ist der persönliche Datenbestand im LAN geschützt? `true` heißt:
   * die persönlichen Routen antworten nur mit `TANKAPP_READ_TOKEN`; `false`
   * = offen wie bisher (dokumentierte Entscheidung, docs/betrieb/BETRIEB.md).
   */
  personal_data?: { read_protected?: boolean } | null;
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
    /** B2: alle publizierten Pfade tragen eine aktive PIT-Kalibrierung. */
    calibrated: boolean;
    decision_ready: boolean;
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
  /** O10: local day count for this weekday/hour model slot. */
  support_days?: number | null;
  /** False/null means no forecast band; true with few days is visibly marked. */
  supported?: boolean | null;
};
export type Forecast = DataReach & {
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
  /** B2: aktiv angewandte PIT-Kurve, nie mit dem neuen Kandidaten vermischt. */
  calibrated?: boolean;
  calibration?: {
    status?: string;
    enabled?: boolean;
    by_horizon?: Record<string, { n_pit?: number; status?: string }>;
  } | null;
  calibration_candidate?: {
    status?: string;
    model_kind?: string;
    shared_draws?: boolean;
    "24h"?: {
      status?: string;
      n_pit?: number;
      validation?: {
        raw_picp95?: number | null;
        calibrated_picp95?: number | null;
        picp_release_gate?: boolean;
      };
    };
  } | null;
  /** H5: Zeitumstellung im Prüfzeitraum — ausgewiesen statt still. */
  dst?: DstReport | null;
  // B5: Parameterschrank diagnostics — from engine publication
  beta?: number[] | null;
  ar_phi?: number[] | null;
  ar_shrink_events?: number | null;
  ar_state_reset?: boolean | null;
  ar_detail?: Record<string, any> | null;
  ensemble?: {
    weights?: Record<string, number>;
    mase?: Record<string, number | null>;
    mae?: Record<string, number | null>;
    n_eval?: number;
    window_days?: number;
    method?: string;
    weight_spread?: {
      blocks?: number;
      harmonic_per_block?: number[];
      std?: number | null;
      min?: number | null;
      max?: number | null;
      range?: number | null;
      blocks_favouring?: Record<string, number>;
    } | null;
    horizon_weights?: {
      status?: string;
      note?: string;
      "24h"?: number | null;
      "72h"?: number | null;
      "168h"?: number | null;
    } | null;
  } | null;
  model_kind?: string | null;
  day_pair?: boolean | null;
  shared_draws?: boolean | null;
  pava_pool_stats?: any | null;
  pit?: any | null;
  regime_breaks_in_window?: any | null;
  ar_shrink?: any | null;
  law_floor?: string | null;
  law_floor_active?: boolean | null;
  pre_law_points_excluded?: number | null;
  law_rise_outside_noon?: number | null;
  rolling_picp_7d?: any | null;
  horizons?: Record<string, any> | null;
  training_start?: string | null;
  training_days?: number | null;
  training_points?: number | null;
  holiday_beta?: number | null;
  holiday_source?: string | null;
  jump_age_hours?: number | null;
};

export type DstReport = {
  timezone?: string;
  policy?: string;
  policy_note?: string;
  days?: string[];
  day_hours?: Record<string, number>;
  folds?: number;
  folds_scored?: number;
  anchors_missing_nat?: number;
  anchors_outside_series?: number;
  mase_none_reasons?: string[];
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
  /** B30: 12-Uhr-Bodenkante, auf die die Zellen geschnitten sind. */
  law_floor?: string | null;
  /** B30: ausgeblendete Preise vor der Kante. */
  points_before_law?: number | null;
  error_code?: string | null;
};

export type StationLifecycle = "active" | "dead" | "closed" | "no_fuel";
export type PriceTwin = {
  station_a: string;
  station_b: string;
  city: string;
  fuel: string;
  common_points: number;
  overlap_pct: number;
  qualifying_days: number;
  agreement_pct: number;
  mean_abs_delta_ct: number | null;
  p95_abs_delta_ct: number | null;
  max_abs_delta_ct: number | null;
  classification: string;
  auto_apply: boolean;
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
  lifecycle?: StationLifecycle;
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
  /**
   * O18: Diese Felder schreibt die Engine je Station
   * (`engine/selection.py`) — die Labor-Werkstätten lesen sie, statt auf
   * Kennzahlen zu warten, die niemand berechnet.
   */
  break_flag?: boolean | null;
  break_stat?: number | null;
  delta_ew_ct?: number | null;
  delta_recent5_ct?: number | null;
  dist_km?: number | null;
  dist_mode?: string | null;
  maps_url?: string | null;
  score?: number;
  rank?: number;
};

export type Selection = DataReach & {
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
  // A12/A13: Lebenszyklus-Bilanz und Preis-Zwillinge (Warnung, nie auto-apply)
  price_twins?: PriceTwin[];
  price_twin_count?: number;
  lifecycle_counts?: Record<StationLifecycle, number> | null;
  dead_stations?: string[];
  dead_count?: number;
  closed_stations?: string[];
  closed_count?: number;
  nofuel_stations?: string[];
  nofuel_count?: number;
  dead_after_days?: number | null;
  lifecycle_totals?: Record<StationLifecycle, number> | null;
  coverage_window?: string | null;
  coverage_reference?: number | null;
  coverage_threshold?: number | null;
  // B30: 12-Uhr-Bodenkante der Selektion (Schnitt vor δ̂, Coverage und
  // „billigste Stunde“). Ohne Feld ist die Kante unbekannt, nicht aus.
  law_floor?: string | null;
  points_before_law?: number | null;
  days_before_law?: number | null;
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
  /** O15: named automatic time-value rule; manual profiles say so explicitly. */
  time_value_rule?: string;
  consumption?: number;
  speed_kmh?: number;
  liters: number;
  generated_at?: string;
  error_code?: string | null;
};

// --- B4 M5/M7 Typen: /v1/decide, Episodes, Intent, Fills, Stats Summary ---

export type AdviceAction =
  "refuel_now" | "wait" | "refuel_elsewhere" | "no_advice";
export type EpisodeStatus = "open" | "waiting" | "due" | "resolved" | "expired";
export type Intent = "none" | "wait" | "navigate" | "refuel_now" | "dismiss";
export type Compliance = "followed" | "partial" | "ignored" | "unrelated";
/** O1: Herkunft der Tankuhrzeit eines Belegs (`app/feedback.py`). */
export type ClockHourSource = "beleg" | "server" | "abgeleitet" | "default";
/** O8: A receipt can be exact-window or only accepted under documented grace. */
export type WindowSettlement = "im_fenster" | "kulanz";
/**
 * O17: Herkunft des Belegpreises — live (frischer Poll zur Tipp-Zeit),
 * manuell (eingetragen), prognose (Altbestand, kein gezahlter Preis),
 * nowcast (Server-Nowcast bei fehlendem Preis).
 */
export type PriceSource = "live" | "manuell" | "prognose" | "nowcast";
export type AdviceOutcome = "win" | "loss" | "tie" | "void";

/** Ein Beleg (Wallet-Ledger), wie ihn GET /api/v1/fills liefert. */
export type Fill = {
  id: string;
  episode_id?: string | null;
  station_id: string;
  station_name?: string;
  tanked_at?: string | null;
  clock_hour?: number | null;
  /** O1 (0.44.0): Woher die Tankuhrzeit kommt — gemessen, rekonstruiert oder
   *  die erfundene 12-Uhr-Projektion (Beleg ohne Zeitstempel). */
  clock_hour_source?: ClockHourSource | null;
  liters: number;
  price_paid: number;
  price_source?: PriceSource;
  fuel: Fuel;
  source?: string;
  compliance?: Compliance;
  /** Strict window (`im_fenster`) vs. accepted matching grace (`kulanz`). */
  settled?: WindowSettlement | null;
  saved_vs_always_now_eur?: number;
  /** O9: actual/estimated net saving of a matched refuel-elsewhere receipt. */
  elsewhere_net_eur?: number | null;
  elsewhere_net_provenance?: {
    distance_source: "actual_receipt" | "estimated_snapshot";
    detour_km_total: number;
    reference_price: number;
    consumption_l_100km: number;
    speed_kmh: number;
    time_value_eur_h: number;
  } | null;
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

/**
 * A2: Tankstand-Bewertung aus /api/v1/decide — Restreichweite plus
 * Warte-Risiko. Die Aufteilung (empty/low/ok) und die Reichweite rechnet der
 * Server aus Füllstand (Prozent × Tankgröße ÷ Verbrauch) oder Rest-km; die
 * GUI zeigt die Server-Zahlen, sie rechnet keine eigene Physik.
 */
export type TankInfo = {
  input: "input" | "computed";
  tank_percent: number | null;
  tank_capacity_l: number | null;
  range_km: number;
  reserve_range_km: number;
  state: "empty" | "low" | "ok";
  blocks_wait: boolean;
  message: string | null;
};

/**
 * A1: Fahrzeug-/Haushaltsprofil — serverseitig gespeichert (ohne Login,
 * LAN-only). Dieselben Felder wie die GUI-Preferences; ``city``/``station``
 * bleiben bewusst Gerätesache (die Stadt gehört zur Sicht, nicht zum Auto).
 */
export type VehicleProfile = {
  id: string;
  name: string;
  fuel: Fuel;
  liters: number;
  consumption: number;
  time_value_eur_h: number;
  speed_kmh: number;
  detour_mode: DetourMode;
  tank_capacity_l: number;
  created_at?: string;
  updated_at?: string;
};

/** Dieselben Grenzen wie die Slider der GUI (app/profiles.py prüft dieselben). */
export const PROFILE_BOUNDS = {
  // max 100 = Beleg-Obergrenze (FILL_LIMITS) und Pi-Fallback (5–100 L):
  // ein 100-L-Tank (Transporter/Diesel) muss im Profil darstellbar sein,
  // sonst deckt der Was-wäre-wenn-Bereich den buchbaren nicht ab.
  liters: { min: 10, max: 100 },
  consumption: { min: 4, max: 15 },
  timeValue: { min: 0, max: 30 },
  speed: { min: 25, max: 80 },
  tankCapacity: { min: 20, max: 120 },
} as const;

/** Die fahrzeugspezifischen Felder eines Profils (PUT-Body, Sync-Vergleich). */
export type ProfileFields = Pick<
  VehicleProfile,
  | "fuel"
  | "liters"
  | "consumption"
  | "time_value_eur_h"
  | "speed_kmh"
  | "detour_mode"
  | "tank_capacity_l"
>;

/** A1: Antwort von GET /api/v1/profiles — Liste plus aktives Profil. */
export type Profiles = {
  profiles: VehicleProfile[];
  active: string | null;
  error_code?: string | null;
};

/** Setzt die GUI-Preferences in die Profil-Feldform (PUT-Body / Vergleich). */
export function profileFields(
  prefs: {
    fuel: Fuel;
    liters: number;
    consumption: number;
    timeValue: number;
    speed: number;
    detourMode: DetourMode;
    tankCapacity: number;
  },
): ProfileFields {
  return {
    fuel: prefs.fuel,
    liters: prefs.liters,
    consumption: prefs.consumption,
    time_value_eur_h: prefs.timeValue,
    speed_kmh: prefs.speed,
    detour_mode: prefs.detourMode,
    tank_capacity_l: prefs.tankCapacity,
  };
}

/** Ob sich ein Profil von den aktuellen GUI-Werten unterscheidet (Sync-Loop-Schutz). */
export function profileFieldsDiffer(
  a: ProfileFields,
  b: ProfileFields,
): boolean {
  const keys: Array<keyof ProfileFields> = [
    "fuel",
    "liters",
    "consumption",
    "time_value_eur_h",
    "speed_kmh",
    "detour_mode",
    "tank_capacity_l",
  ];
  return keys.some((key) => a[key] !== b[key]);
}

/**
 * A4: Eine Zeile der Monats-/Jahresbilanz (GET /api/v1/fills/summary).
 * ``baseline_eur`` ist die „immer sofort getankt“-Referenz: total + saved.
 */
export type BalanceRow = {
  key: string;
  fills: number;
  liters: number;
  total_eur: number;
  avg_eur_per_fill: number | null;
  avg_eur_per_liter: number | null;
  saved_eur: number;
  /**
   * O30: dieselbe Ersparnis nach den bekannten Umwegkosten (Sprit +
   * Zeitwert, dieselbe Formel wie die Entscheidung). Die Entscheidungen
   * waren netto — die Bilanz weist jetzt beide Zeilen aus.
   */
  saved_net_eur?: number;
  /** O30: abgezogene Umwegkosten in €. */
  detour_cost_eur?: number;
  /** O30: Belege mit bekanntem Umweg (davon `n_detour_estimated` geschätzt). */
  n_detour_fills?: number;
  n_detour_estimated?: number;
  /** O17: Ersparnis ohne Prognosepreis-Belege — die zweite, verifizierte Spalte. */
  saved_verified_eur: number;
  /** O17: Belege mit Prognosepreis (Altbestand, kein gezahlter Preis). */
  n_prognosis_price: number;
  baseline_eur: number;
};

export type FillsSummary = {
  generated_at?: string;
  n_fills_total: number;
  months: BalanceRow[];
  years: BalanceRow[];
  overall: BalanceRow & { n_without_date: number; saved_pct: number | null };
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
    /** O14: only `road` is a driven road distance; estimated_* names its basis. */
    detour_km_source?: string | null;
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
    /** O12: normalized against the actual surrounding-window baseline. */
    p: number | null;
    /** Auditable raw P before edge/baseline normalization. */
    p_raw?: number | null;
    p_competitors?: number | null;
    /** A9: Anteil des persönlichen Tankzeit-Profils w(h) an diesem Fenster
     *  (null = nicht personalisiert, Reihenfolge ist reine Preisreihenfolge). */
    wh_weight?: number | null;
  }>;
  windows_week: Array<{
    start: string;
    end: string;
    expected_price: number;
    expected_saving_eur: number | null;
    /** O12: normalized against the actual surrounding-window baseline. */
    p: number | null;
    p_raw?: number | null;
    p_competitors?: number | null;
    /** O12: random-choice chance among the available comparison windows. */
    p_baseline?: number | null;
    wh_weight?: number | null;
  }>;
  /** O2/O3: cautiously shrunk receipt profile; min_fills is its prior strength. */
  personalization?: {
    active: boolean;
    n_fills: number;
    min_fills: number;
    missing_fills: number;
    /** O1: Belege mit gemessener oder rekonstruierter Tankzeit. */
    measured_fills?: number;
    /** Legacy rows without a usable timestamp; new records use the server time. */
    default_fills?: number;
  } | null;
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
  // A2: Tankstand-Bewertung (Physik, unabhängig von der Ampel) — null ohne
  // Tankstand-Eingabe (dann sagt die App nichts über den Tankstand).
  tank?: TankInfo | null;
  // Engine-Qualität der ausgewählten Station (Konzept §3.3.3): Rolling-PICP
  // 7 d aus dem Backtest. null = nicht veröffentlicht (Altpublikation).
  quality?: {
    rolling_picp_7d_pct: number | null;
    rolling_picp_7d_points: number | null;
    // O4: Fallzahl der Kennzahl in Tagen (Tage mit bewerteten Punkten).
    rolling_picp_7d_days: number | null;
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
  /**
   * O44: Bereinigte Ursache eines Fehlerpayloads (app/errors.py, ohne Pfade
   * und Token). Gesetzt statt ``undefined``, wenn der Server die Empfehlung
   * nicht berechnen konnte — dieselbe Sprache wie ``error_detail`` der Jobs.
   */
  detail?: string | null;
};

/**
 * B7: Alltags-Aggregat — /api/v1/overview. Eine Antwort statt der sechs
 * Parallel-Polls (decide, fills, stats/summary, due-Episoden, Tageskurve):
 * weniger Last auf der NAS (File-Locks, HDD) und ein Refresh, der nicht
 * 5–10 s dauert, während die Ansicht tot wirkt.
 */
/**
 * O20: Tonlagen-Skala des Tagesstreifens — vom Server gerechnet
 * (`app/data.py::price_band`), damit GUI und Fallback dieselbe Skala lesen
 * und keine zweite Implementierung entsteht. `lo`/`hi` sind 25. und 75.
 * Perzentil der Preise mit Meldung im Bezugszeitraum; `days` nennt, aus wie
 * vielen Tagen die Skala wirklich stammt.
 */
export type StripBand = {
  lo: number;
  hi: number;
  basis?: string;
  hours?: number;
  n_points?: number;
  days?: number | null;
};

export type Overview = {
  generated_at: string;
  decide: DecideResult;
  fills: Fills;
  stats_summary: StatsSummary;
  episodes: { count: number; episodes: any[] };
  day: {
    points: Point[];
    error_code: string | null;
    /**
     * O20: feste Tonlagen-Skala des Tagesstreifens (25./75. Perzentil der
     * letzten 7 Tage, `app/data.py::price_band`). `null` = zu dünner
     * Bestand — die GUI zeigt die Zahlen dann ohne Farburteil.
     */
    band?: StripBand | null;
  } | null;
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

/** O16: δ̂ ist eine Selektions-Größe (`SelectionStation.delta_ct`) und kein
 * Backtest-Ergebnis — der Score-Typ trägt das Feld nicht mehr (vorher stand
 * hier eine Pflicht, die der Server nie füllt). */
export type BacktestStationScore = {
  station_id: string;
  name: string;
  brand: string;
  city: string;
  /**
   * O21: Die Parameter gehören zur Zahl. Ein Euro-Wert ohne Tankmenge und
   * Schwelle beantwortet keine Frage — beide stehen je Score-Block dabei.
   */
  eps?: number;
  liters?: number;
  n: number;
  n_wait: number;
  hit_wait: number | null;
  n_now: number;
  hit_now: number | null;
  sum_smart_eur: number;
  sum_commit_eur: number;
  sum_best_eur: number;
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
    /** O21: „profile“ = Tankmenge aus dem Profil, „default“ = Platzhalter. */
    litersSource?: string;
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
    /** O38: Fensterbilanz — genutzte vs. verstrichene Fenster je Woche/Monat. */
    episodes_used_7d?: number;
    episodes_expired_7d?: number;
    episodes_used_30d?: number;
    episodes_expired_30d?: number;
    episodes_open?: number;
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
    /** O5: Brier je P-Quelle (30 Tage und Allzeit) — getrennt statt gemischt. */
    brier_by_source?: Record<string, { brier: number | null; n: number }>;
    brier_all_by_source?: Record<string, { brier: number | null; n: number }>;
    /** B2-A/B: Roh- und 24-h-PIT-Zustand beim damaligen Advice-Emit. */
    brier_by_calibration?: Record<string, { brier: number | null; n: number }>;
    brier_all_by_calibration?: Record<string, { brier: number | null; n: number }>;
    p_source_counts?: Record<string, number>;
    p_source_counts_all?: Record<string, number>;
    /** O5: Gate-Grundgesamtheit — Verteilungs-P allein (Allzeit). */
    gate_n?: number;
    gate_brier?: number | null;
    /** O6: Block-Bootstrap-Intervall des Gate-Briers — null bei zu wenigen Tagesblöcken. */
    gate_brier_ci?: [number, number] | null;
    /** O6: naive Referenzen auf der Gate-Grundgesamtheit (Basisrate, Klimatologie). */
    gate_ref_base?: number | null;
    gate_ref_climate?: number | null;
    /** B2: zweites M7-Kriterium, Tagesblock-KI der Reliability-Steigung. */
    gate_reliability_slope?: number | null;
    gate_reliability_slope_ci?: [number, number] | null;
    gate_reliability_target?: number | null;
    gate_reliability_ok?: boolean | null;
    /** O6: Tagesblöcke des Intervalls (Europe/Berlin) + Mindestzahl. */
    n_day_blocks?: number;
    min_day_blocks?: number;
    /** O6: Fenstergröße (Tage je Block) + Ziehungen des Bootstraps. */
    block_days?: number;
    bootstrap_samples?: number;
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
    /** O30: Ersparnis nach den bekannten Umwegkosten (dieselbe Formel). */
    saved_net_eur?: number;
    detour_cost_eur?: number;
    n_detour_fills?: number;
    n_detour_estimated?: number;
    /** O17: Ersparnis ohne Prognosepreis-Belege — die zweite, verifizierte Spalte. */
    saved_verified_eur: number;
    /** O17: Belege mit Prognosepreis (Altbestand, kein gezahlter Preis). */
    n_prognosis_price: number;
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
  /**
   * C4: aktive Entscheidungsschwellen (read-only) — dieselben Werte, mit
   * denen die Engine entscheidet. Fehlt nur bei sehr alten Ständen.
   */
  thresholds?: Record<string, number>;
  /** C4: M7-Nachzug (read-only) — Vorschlag, Ziele, Stichprobe, Status. */
  threshold_tuning?: ThresholdTuning;
  calibrated: boolean;
  decision_ready: boolean;
  error_code?: string | null;
};

/**
 * Prognose-Tagebuch (GUI-Neuentwurf §6.2 Abschnitt 4, Konzept §12):
 * `GET /api/v1/advice/diary` — echte Settlements des Advice-Ledgers,
 * verbunden mit dem Snapshot, der sie ausgelöst hat.
 *
 * Ehrlichkeits-Zusage: Es gibt keine Demo-Einträge. Ist die Liste leer,
 * nennt `reason` den Grund (`no_settlements` = es wurde noch nichts
 * abgerechnet, `no_advice_history` = es gibt keine Episoden).
 */
export type AdviceDiaryEntry = {
  snapshot_id: string | null;
  episode_id: string | null;
  settled_at: string | null;
  emitted_at: string | null;
  action: string | null;
  station_id: string | null;
  /** Stationsname aus dem Snapshot — der Rückfall, wenn die Station nicht
   *  mehr im aktuellen Set liegt (vorher stand dort die rohe UUID). */
  station_name: string | null;
  city: string | null;
  fuel: string | null;
  window_start: string | null;
  window_end: string | null;
  /** Preis beim Aussprechen der Empfehlung (€/L). */
  price_then: number | null;
  /** Realisierter Fensterpreis (€/L); null bei `void`. */
  price_window: number | null;
  outcome: string | null;
  void_reason: string | null;
  /** Grund der Tabelle, wenn die Empfehlung „keine“ war (sonst null). */
  decline_reason: string | null;
  regret_eur: number | null;
  p_correct: number | null;
  p_besser: number | null;
  liters: number | null;
  intent: string | null;
};

export type AdviceDiary = {
  generated_at: string;
  count: number;
  entries: AdviceDiaryEntry[];
  settled_total?: number;
  reason?: "no_settlements" | "no_advice_history" | null;
  error_code?: string | null;
};

/**
 * C4: Rückgabe von app/thresholds.py `active_thresholds`/`suggest_thresholds`
 * — der Nachzug rechnet aus dem Advice-Ledger einen Vorschlag, der nur mit
 * `auto_apply` wirksam wird. Die GUI zeigt alles nur an, sie ändert nichts.
 */
export type ThresholdTuning = {
  thresholds: Record<string, number>;
  base: Record<string, number>;
  targets: Record<string, number>;
  sample: {
    n_wait: number | null;
    hit_wait: number | null;
    n_now: number | null;
    hit_now: number | null;
    n_elsewhere: number | null;
    hit_elsewhere: number | null;
  };
  reasons: string[];
  changed: boolean;
  min_n: number;
  auto_apply?: boolean;
  applied?: boolean;
  /** H3 (0.31.0): Oszillationsschutz des Nachzugs — Rauschband je Aktion
   *  und Totband. Fehlt das Feld, läuft eine ältere Engine. */
  hysteresis?: {
    sigma?: number;
    min_n?: number;
    deadband_p?: number;
    deadband_eur?: number;
    noise_band?: {
      wait?: number | null;
      now?: number | null;
      elsewhere?: number | null;
    } | null;
  } | null;
};

/**
 * O21: Runden wie der Server (`round(x, n)` in Python). Ohne gemeinsame
 * Rundung weichen Labor (Server) und Werkstatt (GUI) in der letzten Stelle
 * ab — und genau daraus entstand der `pot_share`-Einheitenfehler.
 */
function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

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
    sumRegretCt += o.regretCt;
    if (r.p != null && Number.isFinite(r.p)) {
      sumP += r.p;
      nP++;
    }
    if (r.s > 0) sPos++;
  }
  const n = rows.length;
  const toEur = (ct: number) => round((ct / 100) * liters, 2);
  const sumSmartEur = toEur(sumSmart);
  return {
    station_id: stationId,
    name: stationId,
    brand: "",
    city: "",
    // O21: Die Parameter gehören zur Zahl — dieselben Felder wie im
    // Server-Score (`app/stats_summary.py::_score_rows`).
    eps,
    liters,
    n,
    n_wait: nWait,
    hit_wait: nWait ? round(hitWait / nWait, 4) : null,
    n_now: nNow,
    hit_now: nNow ? round(hitNow / nNow, 4) : null,
    sum_smart_eur: sumSmartEur,
    sum_commit_eur: toEur(sumCommit),
    sum_best_eur: toEur(sumBest),
    avg_regret_ct: n ? round(sumRegretCt / n, 3) : 0,
    avg_regret_eur: n ? round(toEur(sumRegretCt) / n, 3) : 0,
    p_avg: nP ? round(sumP / nP, 4) : 0,
    p_known: nP > 0,
    hit_freq: n ? round(sPos / n, 4) : 0,
    // O21-Fix: vorher `sumSmartEur / sumBest` — Euro durch Cent. Der Anteil
    // am Potenzial ist ein Verhältnis **gleicher** Einheiten (ct/ct), genau
    // wie im Server. `tests/fixtures/score_parity.json` hält beide fest.
    pot_share: sumBest > 0 ? round(sumSmart / sumBest, 4) : n ? 0 : 0,
  };
}

/**
 * B10: Vorsatz speichern. Ohne Verbindung wird er vorgemerkt und beim nächsten
 * Kontakt nachgereicht — die Antwort trägt dann `queued` (kein Fehler).
 */
export async function postIntent(episodeId: string, intent: string) {
  const path = `/api/v1/episodes/${episodeId}/intent`;
  const body = JSON.stringify({ intent });
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (isTransportError(res.status)) {
      const list = enqueueWrite({ kind: "intent", path, body });
      return { queued: true, queue_length: list.length };
    }
    return await res.json();
  } catch {
    const list = enqueueWrite({ kind: "intent", path, body });
    return { queued: true, queue_length: list.length };
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

/**
 * A1: Schreibende Profil-Requests (POST/PUT/DELETE) — Fach-Codes aus der
 * Antwort, Transportfehler als „request_failed“ (dasselbe Muster wie
 * postIntent). Pfad relativ zu ``/api/v1/profiles`` (z. B. ``""``,
 * ``"/prof_…/activate"``).
 */
export async function profileRequest(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(`/api/v1/profiles${path}`, {
      method,
      headers:
        body !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data: Record<string, unknown> | null = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error_code: "request_failed" } };
  }
}

/** Klartext zu Profil-Fehlercodes — die GUI zeigt den Satz, nicht den Code. */
export function profileErrorText(
  code: string | null | undefined,
  fallback = "Das hat nicht geklappt.",
): string {
  switch (code) {
    case null:
    case undefined:
    case "":
      return "";
    case "request_failed":
      return "Server nicht erreichbar — Änderung gilt nur auf diesem Gerät.";
    case "invalid_profile_name":
      return "Profilname fehlt oder ist zu lang (höchstens 40 Zeichen).";
    case "profile_limit":
      return "Höchstens 8 Profile — erst eines löschen.";
    case "profile_not_found":
      return "Profil nicht gefunden — vielleicht auf einem anderen Gerät gelöscht.";
    case "invalid_fuel":
    case "invalid_liters":
    case "invalid_consumption":
    case "invalid_time_value_eur_h":
    case "invalid_speed_kmh":
    case "invalid_tank_capacity_l":
    case "invalid_mode":
      return `Wert außerhalb des zulässigen Bereichs (${code}).`;
    default:
      return fallback;
  }
}

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
      return {
        tone: "ok",
        text: "Läuft bereits; Fortschritt steht in dieser Karte.",
      };
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

/**
 * B10: Beleg speichern — mit Offline-Queue (§5.4).
 *
 * Der `id` wird hier erzeugt, damit ein nachgereichter Beleg nie doppelt im
 * Ledger landet (der Server ist über `id` idempotent). Wird ohne Verbindung
 * vorgemerkt, trägt die Antwort `queued: true` — die Ansicht sagt das dann.
 */
export async function postFill(payload: {
  id?: string;
  station_id: string;
  station_name: string;
  tanked_at?: string;
  liters: number;
  price_paid: number;
  /** O17: Herkunft des Preises — live (Ein-Tipp-Beleg) oder manuell (Maske). */
  price_source?: "live" | "manuell";
  fuel: string;
  source: string;
  episode_id?: string | null;
  /** O9: observed complete detour in km; omission retains the snapshot estimate. */
  actual_detour_km_total?: number;
}) {
  // Der Tankzeitpunkt ist der Zeitpunkt des Tankens, nicht der des Nachreichens.
  const record = {
    ...payload,
    id: payload.id ?? newFillId(),
    tanked_at: payload.tanked_at ?? new Date().toISOString(),
  };
  const body = JSON.stringify(record);
  try {
    const res = await fetch("/api/v1/fills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (isTransportError(res.status)) {
      const list = enqueueWrite({ kind: "fill", path: "/api/v1/fills", body });
      return { queued: true, queue_length: list.length };
    }
    return await res.json();
  } catch {
    const list = enqueueWrite({ kind: "fill", path: "/api/v1/fills", body });
    return { queued: true, queue_length: list.length };
  }
}

/**
 * B10: Versand eines vorgemerkten Eintrags. `permanent` unterscheidet die
 * Ablehnung (4xx → nicht wiederholen, melden) vom Verbindungsproblem.
 */
export async function postQueued(entry: {
  path: string;
  body: string;
}): Promise<{ ok: boolean; permanent?: boolean; error?: string | null }> {
  try {
    const res = await fetch(entry.path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: entry.body,
    });
    if (res.ok) return { ok: true };
    if (res.status >= 400 && res.status < 500) {
      return { ok: false, permanent: true, error: `http_${res.status}` };
    }
    return { ok: false, error: `http_${res.status}` };
  } catch {
    return { ok: false, error: "offline" };
  }
}

function newFillId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `fill_${Date.now().toString(36)}_${random}`;
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
export function fillFieldError(field: FillField, raw: string): string | null {
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
          (Date.UTC(to[0], to[1] - 1, to[2]) -
            Date.UTC(from[0], from[1] - 1, from[2])) /
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

export type DataReach = {
  range_from?: string | null;
  range_to?: string | null;
  n_points?: number | null;
  n_days?: number | null;
};

/**
 * C11: Dieselbe Frage wie bei der Heatmap, nur für Preisverlauf, Modell-Ausblick
 * und Ranking — worauf beruht das hier eigentlich? Eine Kurve über 24 Stunden
 * aus vier Punkten und „Rang 1“ aus zehn Tagen sehen sonst genauso solide aus
 * wie ihre gut belegten Gegenstücke. Gibt der Payload nichts her (Altbestand,
 * leeres Ergebnis), liefert die Funktion null und die GUI zeigt keine Zeile —
 * lieber schweigen als eine Reichweite behaupten.
 */
export function dataReachLabel(
  reach: DataReach,
  noun = "Preise",
): string | null {
  const parts: string[] = [];
  const points = reach.n_points;
  if (points != null && Number.isFinite(points)) {
    parts.push(`${countLabel(points)} ${noun}`);
  }
  const days = reach.n_days;
  if (days != null && Number.isFinite(days) && days > 0) {
    parts.push(`${countLabel(days)} ${days === 1 ? "Tag" : "Tage"}`);
  }
  const fromMs = Date.parse(reach.range_from ?? "");
  const toMs = Date.parse(reach.range_to ?? "");
  if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs >= fromMs) {
    parts.push(`${berlinStamp(fromMs)} – ${berlinStamp(toMs)} Uhr`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/**
 * B30: Bodenkante der 12-Uhr-Regel in den Beobachtungs-Payloads.
 *
 * Seit dem 01.04.2026, 12:00 Uhr darf ein Preis zur Tagesmitte nur einmal
 * steigen und danach bis zum nächsten Mittag nur noch fallen. Davor galt der
 * alte Rhythmus mit dem Hoch am Abend. Ein Bestand, der beide Welten mischt,
 * zeigt deshalb ein Muster, das es so nie gab — die Panels zählen nur
 * Beobachtungen ab der Kante (docs/archiv/BEFUND-12-UHR-REGEL-2026-09-18.md).
 */
export type LawFloorPayload = {
  /** ISO-8601 (UTC) der Kante; `null` = Kante abgeschaltet. */
  law_floor?: string | null;
  /** Beobachtungen vor der Kante, die nicht mitzählen. */
  points_before_law?: number | null;
};

export type LawFloorNote = {
  text: string;
  /** `warn` hebt ab: Hier ist etwas ausgeblendet oder bewusst gemischt. */
  tone: "info" | "warn";
};

/** „01.04.2026, 14:00 Uhr“ — Berliner Zeit wie jeder andere Zeitpunkt. */
function lawFloorStamp(ms: number): string | null {
  if (!Number.isFinite(ms)) return null; // unlesbarer Zeitstempel → schweigen
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  if (!get("day") || !get("month") || !get("year")) return null;
  return `${get("day")}.${get("month")}.${get("year")}, ${hour}:${get("minute")} Uhr`;
}

/**
 * Ein Satz zur Bodenkante — oder null, wenn es nichts zu sagen gibt.
 *
 * Drei Zustände, drei Sätze: Die Kante blendet etwas aus (dann steht die Zahl
 * im Text, sonst ist der kürzere Bestand unerklärlich), die Kante ist
 * abgeschaltet (dann mischt der Bestand zwei Rechtslagen — das gehört
 * sichtbar), oder der Payload kennt das Feld nicht (alte API — dann schweigt
 * die Zeile, statt eine Kante zu behaupten).
 */
export function lawFloorNote(
  payload: LawFloorPayload | null | undefined,
  noun = "Preise",
): LawFloorNote | null {
  if (!payload || payload.law_floor === undefined) return null;
  if (payload.law_floor === null) {
    return {
      text:
        `Bodenkante der 12-Uhr-Regel abgeschaltet — der Bestand mischt ` +
        `${noun} von vor und nach der Änderung. Tagesmuster aus diesem ` +
        "Bestand gelten für keine der beiden Regeln.",
      tone: "warn",
    };
  }
  const stamp = lawFloorStamp(Date.parse(payload.law_floor));
  if (!stamp) return null;
  const before = payload.points_before_law;
  if (before == null) {
    return {
      text: `Nur ${noun} ab ${stamp} — Bodenkante der 12-Uhr-Regel.`,
      tone: "info",
    };
  }
  if (before > 0) {
    return {
      text:
        `${countLabel(before)} ${noun} vor ${stamp} zählen nicht — davor galt ` +
        "ein anderer Tagesrhythmus.",
      tone: "warn",
    };
  }
  return {
    text: `Alle ${noun} liegen nach der Bodenkante ${stamp}.`,
    tone: "info",
  };
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

/** Bereiche, die eine eigene URL haben (GUI-UX-BEFUND U4). */
export const SHARE_TABS = [
  "jetzt",
  "stationen",
  "woche",
  "ich",
  "labor",
  "system",
  "glossar",
] as const;
export type ShareTab = (typeof SHARE_TABS)[number];

/** Ausgemusterte Bereichsnamen landen bei ihrem Nachfolger. */
const LEGACY_TABS: Record<string, ShareTab> = {
  alltag: "jetzt",
  werkstatt: "labor",
  statistik: "labor",
};

/** Parameter, die eine geteilte Ansicht belegen darf. */
export type ShareConfig = {
  city?: string;
  fuel?: Fuel;
  stationId?: string;
  liters?: number;
  heatmapWeeks?: HeatmapWeeks;
  heatmapBasis?: HeatmapBasis;
  /** U4: der Bereich als Teil der URL (`?tab=woche`). */
  tab?: ShareTab;
  /** U4: Labor-Abschnitt als Anker der geteilten Antwort (`?section=…`). */
  section?: string;
  /** B5: Labor Sub-Tab (`?subtab=…`). */
  subtab?: string;
};

/** Aktuelle Sicht als Share-Parameter — kommt aus readShareParams heraus. */
export type ShareView = {
  city: string;
  fuel: Fuel;
  stationId: string | null;
  liters: number;
  heatmapWeeks: number;
  heatmapBasis: HeatmapBasis;
  tab?: ShareTab;
  section?: string | null;
  subtab?: string | null;
};

/** Dieselben Grenzen wie die localStorage-Preferences der GUI. */
const SHARE_LITERS_MIN = 10;
const SHARE_LITERS_MAX = 100;

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
  // U4: der Bereich gehört in die URL — für Browser-Zurück, Lesezeichen und
  // ehrliche Share-Links. Ungültige Werte fallen still auf den Einstieg.
  const tab = params.get("tab");
  if (tab && (SHARE_TABS as readonly string[]).includes(tab)) {
    out.tab = tab as ShareTab;
  } else if (tab && tab in LEGACY_TABS) {
    out.tab = LEGACY_TABS[tab];
  }
  const section = params.get("section");
  if (section && /^[a-z0-9_-]{1,32}$/.test(section)) out.section = section;
  const subtab = params.get("subtab");
  if (subtab && /^[a-z0-9_-]{1,32}$/.test(subtab)) out.subtab = subtab;
  return out;
}

/** Baut die Query einer geteilten Ansicht; Defaults bleiben außen vor. */
export function shareQuery(view: ShareView): string {
  const params = new URLSearchParams();
  if (view.city) params.set("city", view.city);
  params.set("fuel", view.fuel);
  if (view.stationId) params.set("station_id", view.stationId);
  if (view.liters !== 40) params.set("liters", String(view.liters));
  if (
    isHeatmapWeeks(view.heatmapWeeks) &&
    view.heatmapWeeks !== HEATMAP_DEFAULT_WEEKS
  ) {
    params.set("weeks", String(view.heatmapWeeks));
  }
  if (
    isHeatmapBasis(view.heatmapBasis) &&
    view.heatmapBasis !== HEATMAP_DEFAULT_BASIS
  ) {
    params.set("basis", view.heatmapBasis);
  }
  // U4: Bereich und Labor-Abschnitt reisen mit — der Link teilt die
  // Antwort, nicht nur die Filter. Der Einstieg („jetzt“) bleibt als
  // Default außen vor.
  if (view.tab && view.tab !== "jetzt") params.set("tab", view.tab);
  if (view.section) params.set("section", view.section);
  if (view.subtab) params.set("subtab", view.subtab);
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

/**
 * Die Form eines useResource-Ergebnisses, die Views über Props brauchen —
 * data plus Zustände, ohne interne Felder (key, failStreak). Strukturell
 * vereinbar mit dem vollständigen Hook-Rückgabewert.
 */
export type ResourceState<T> = {
  data: T | null;
  error: boolean;
  errorCode: string | null;
  pending: boolean;
  receivedAt: number;
};

/**
 * B7: Wann ein fehlgeschlagener Poll sichtbar wird.
 *
 * Ohne anzeigbare Daten ist der erste Fehlversuch schon ein Fehler (es gäbe
 * sonst gar nichts zu sehen). Solange Daten angezeigt werden, ist ein
 * einzelner fehlgeschlagener Poll eine kurze Unterbrechung zwischen zwei
 * Polls — kein Ausfall: Die Zahlen bleiben stehen (MICROCOPY §5: „lädt
 * (Aktualisierung): nichts“), erst der zweite aufeinanderfolgende
 * Fehlversuch macht den Fehler sichtbar.
 */
export function resourceErrorVisible(failStreak: number, hasData: boolean) {
  return failStreak >= (hasData ? 2 : 1);
}

export function useResource<T>(
  url: string | null,
  interval: number,
  refresh: number,
) {
  const [state, setState] = useState<{
    key: string | null;
    data: T | null;
    errorCode: string | null;
    pending: boolean;
    receivedAt: number;
    failStreak: number;
  }>({
    key: null,
    data: null,
    errorCode: null,
    pending: false,
    receivedAt: 0,
    failStreak: 0,
  });
  // B7: „Refresh“ bricht ein laufendes Laden nie ab. Auf der NAS dauerte ein
  // Refresh 5–10 s; jeder Klick dazwischen würde die Requests sonst
  // abbrechen und neu starten — die Ansicht würde nie fertig werden.
  // Stattdessen: ein Reload wird hinter das laufende Ladereignis eingereiht
  // (z. B. um gerade gebuchte Belege sofort zu zeigen).
  const loadRef = useRef<() => void>(() => {});
  const busyRef = useRef(false);
  const queuedReloadRef = useRef(false);
  // B7-Revalidierung: letztes ETag pro URL (Datenstand + Parameter). Beim
  // nächsten Laden als If-None-Match mitschicken; antwortet der Server mit
  // 304, hat sich der Datenstand nicht geändert — die Anzeige bleibt, der
  // Refresh kostet Millisekunden statt einer 5–10-s-Neuberechnung.
  const etagRef = useRef<{ key: string | null; etag: string | null }>({
    key: null,
    etag: null,
  });
  // Stale-while-revalidate: URL-Wechsel erkennt nur dieser Ref, nicht der
  // Interval. Damit flackert die System-Seite nicht, wenn healthInterval
  // zwischen 60000↔15000 wechselt (Job läuft ↔ fertig).
  const prevUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!url) {
      queuedReloadRef.current = false;
      if (prevUrlRef.current !== url) {
        prevUrlRef.current = url;
        etagRef.current = { key: null, etag: null };
      }
      // Inaktiv (Tab-Wechsel): kein „lädt …“ zurücklassen, aber Daten
      // bewusst behalten — initial ist data ohnehin null (Test: false|null|false).
      setState((prev) => (prev.pending ? { ...prev, pending: false } : prev));
      return;
    }
    const urlChanged = prevUrlRef.current !== url;
    if (urlChanged) {
      prevUrlRef.current = url;
      etagRef.current = { key: null, etag: null };
      // Fuel-Switch E10→Diesel: altes Material nicht nullen (verhindert
      // „Ehrlich statt geschätzt / Noch kein frischer Preis.“), nur Fehlerzähler
      // zurücksetzen und sofort pending zeigen, damit die GUI Skeleton statt
      // Empty rendern kann (isStaleFuel = data.fuel!==fuel && pending).
      setState((prev) => ({
        ...prev,
        errorCode: null,
        failStreak: 0,
        pending: true,
      }));
    }
    let active = true,
      busy = false;
    let controller: AbortController | null = null;
    async function load() {
      if (!active || busy) return;
      busy = true;
      busyRef.current = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 20000);
      setState((prev) => ({ ...prev, pending: true }));
      try {
        const etag = etagRef.current.key === url ? etagRef.current.etag : null;
        // O39: Lese-Token für den persönlichen Datenbestand, wenn eines
        // gesetzt ist (leer = offen, wie bisher).
        const headers: Record<string, string> = { ...authHeaders() };
        if (etag) headers["If-None-Match"] = etag;
        const response = await fetch(url!, {
          signal: controller.signal,
          cache: "no-store",
          headers,
        });
        if (response.status === 304) {
          etagRef.current = { key: url, etag };
          if (active)
            setState((prev) => ({
              ...prev,
              key: url,
              errorCode: null,
              pending: false,
              receivedAt: performance.now(),
              failStreak: 0,
            }));
          return;
        }
        if (!response.ok) {
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
              errorCode,
              pending: false,
              failStreak: prev.failStreak + 1,
            }));
          return;
        }
        const data: T = await response.json();
        if (active) {
          etagRef.current = { key: url, etag: response.headers.get("ETag") };
          setState({
            key: url,
            data,
            errorCode: null,
            pending: false,
            receivedAt: performance.now(),
            failStreak: 0,
          });
        }
      } catch {
        if (active)
          setState((prev) => ({
            ...prev,
            errorCode: null,
            pending: false,
            failStreak: prev.failStreak + 1,
          }));
      } finally {
        clearTimeout(timeout);
        busy = false;
        busyRef.current = false;
        if (active && queuedReloadRef.current) {
          queuedReloadRef.current = false;
          void load();
        }
      }
    }
    loadRef.current = load;
    // Nur bei URL-Wechsel (inkl. erstem Mount) sofort laden; reiner
    // Interval-Wechsel (System-Tab: 60s↔15s) startet nur den Timer neu und
    // löst kein zusätzliches pending aus — verhindert System-Flicker.
    if (urlChanged) {
      void load();
    }
    const timer = setInterval(() => void load(), interval);
    return () => {
      active = false;
      busyRef.current = false;
      queuedReloadRef.current = false;
      loadRef.current = () => {};
      clearInterval(timer);
      controller?.abort();
    };
  }, [url, interval]);
  // B7: Refresh-Zähler — bei laufendem Laden einreihen (siehe oben),
  // sonst sofort laden. Nicht auf URL-Wechsel reagieren, nur auf den Zähler.
  const lastRefresh = useRef(refresh);
  useEffect(() => {
    if (lastRefresh.current === refresh) return;
    lastRefresh.current = refresh;
    if (!url) return;
    if (busyRef.current) queuedReloadRef.current = true;
    else loadRef.current();
  }, [refresh, url]);
  // O39: Ein neu eingetragenes Lese-Token muss die persönlichen Ansichten
  // sofort neu laden — sonst bleibt „Zugang gesperrt“ stehen, obwohl das
  // Secret passt. Derselbe Weg wie der Refresh-Zähler (einreihen statt
  // abbrechen); das ETag gilt für die alte Anfrage und wird verworfen.
  useEffect(
    () =>
      onReadTokenChange(() => {
        if (!url) return;
        etagRef.current = { key: null, etag: null };
        if (busyRef.current) queuedReloadRef.current = true;
        else loadRef.current();
      }),
    [url],
  );
  const hasData = state.data != null;
  return {
    ...state,
    data: state.data,
    error: resourceErrorVisible(state.failStreak, hasData),
  };
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

/**
 * Stations-Labor: Fenster für den Preisverlauf — die letzten ``spanHours``
 * Stunden in **Wandzeit**.
 *
 * Die x-Koordinaten der Punkte sind Epoch-Millisekunden (``Date.parse`` der
 * Server-Zeitstempel). Das Fenster muss daher ebenfalls Epoch-Millisekunden
 * sein (`Date.now()`), niemals Seitenlaufzeit (`performance.now()`): Letztere
 * zählt Sekunden seit Seitenaufruf und läge mit ~10³ immer „in der
 * Vergangenheit“ von echtem Datenbestand (~10¹²) — jeder Punkt wäre
 * fensterfremd und das Labor renderte „keine Daten“, obwohl 108 Preise
 * vorliegen (Regressionsfall 13.09.2026).
 */
export function historyWindowMs(
  spanHours: number,
  nowMs: number = Date.now(),
): [number, number] {
  return [nowMs - spanHours * 3600000, nowMs];
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
  const total = Math.max(
    1,
    xMax - xMin - merged.reduce((s, g) => s + cut(g), 0),
  );
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
    if (times[0] - window[0] > min)
      bands.push({ from: window[0], to: times[0] });
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
  polling_missing:
    "Polling-Set fehlt — keine Stadt eingerichtet. Die Schritte zum Einrichten stehen im Bereich „System“ unter „Daten“.",
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
  aborted:
    "Der Lauf wurde abgebrochen (z. B. durch einen Container-Neustart). Letzte Ergebnisse bleiben erhalten.",
  selection_not_available:
    "Noch keine Selektions-Artefakte vorhanden. Nach dem Modell-Lauf erscheint hier das Ranking nach Preis-Abstand (δ̂).",
  selection_failed:
    "Selektion konnte nicht berechnet werden. Trainingsdaten prüfen.",
  collector_no_heartbeat:
    "Noch kein Collector-Herzschlag — der Pi hat nichts gemeldet. Die Schritte zum Prüfen stehen im Bereich „System“ unter „Daten“.",
  collector_check_failed: "Collector-Status konnte nicht geprüft werden.",
  too_many_points:
    "Zu viele Punkte für die Heatmap. Kleineres Zeitfenster wählen.",
  invalid_query: "Ungültige Anfrageparameter.",
  invalid_fuel: "Unbekannter Kraftstoff (e10, e5 oder diesel erwartet).",
  invalid_liters: "Getankte Liter außerhalb 5–100 L.",
  invalid_price: "Preis außerhalb 0,40–5,00 €/L.",
  store_too_large:
    "Persönlicher Speicher ist voll. Bitte den Betreiber informieren (Store zu groß).",
  store_locked:
    "Speicher ist gerade belegt — in ein paar Sekunden erneut versuchen.",
  unauthorized:
    "Zugang gesperrt — der Server verlangt ein Lese-Token für persönliche Daten. Im Bereich „System“ unter „Persönliche Daten im Netz“ eintragen.",
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
  invalid_price_source: "Unbekannte Preis-Herkunft (live oder manuell erwartet).",
  prompt_price_not_live:
    "Ohne frischen Live-Preis kein Ein-Tipp-Beleg — bitte manuell erfassen.",
  price_not_available:
    "Kein Preis bestimmbar — weder live noch als Referenz. Später erneut versuchen.",
  decide_failed: "Empfehlung konnte nicht berechnet werden.",
  episode_not_found: "Episode unbekannt oder abgelaufen.",
  episodes_read_failed: "Episoden konnten nicht gelesen werden.",
  diary_read_failed:
    "Das Prognose-Tagebuch konnte nicht gelesen werden (Ledger im Feedback-Store).",
  set_intent_failed: "Intent konnte nicht gespeichert werden.",
  record_fill_failed: "Beleg konnte nicht gespeichert werden.",
  fills_read_failed: "Belege konnten nicht gelesen werden.",
  void_fill_failed: "Beleg konnte nicht storniert werden.",
  fill_not_found: "Beleg nicht gefunden (oder bereits abgelaufen).",
  settlement_failed: "Settlement-Lauf ist fehlgeschlagen.",
  stats_summary_failed: "Kennzahlen der Engine konnten nicht berechnet werden.",
  backtest_not_available:
    "Noch kein Backtest-Ergebnis veröffentlicht. Sobald der tägliche Modell-Lauf genug echte Preishistorie auswerten konnte, erscheinen hier die echten Tages-Entscheidungen (Tages-Anker, Standard 12:00 Uhr).",
  payload_too_large: "Anfrage zu groß (max. 100 KB).",
  invalid_json: "Anfrage ist kein gültiges JSON.",
  invalid_request: "Ungültige Anfrage.",
  server_error: "Serverfehler. Erneuter Versuch folgt.",
  not_found: "Endpunkt nicht gefunden.",
};
/**
 * T5 (GUI-TEXT-BEFUND): Dieselbe Aussage steht an **einer** Stelle. Dubletten
 * sind kein Stilproblem — beim nächsten Wortwechsel wird eine der beiden
 * Stellen vergessen, und genau so entstanden „.“ hier und kein Punkt dort.
 */
export const NO_DATA_LINE = "Kein Datenstand — noch nichts gemeldet";

/** Rückmeldung nach dem Buchen; die Einordnung hängt `fillPositionNote` an. */
export const FILL_BOOKED_LINE = "Beleg in deiner Bilanz verbucht.";

/**
 * O17: Ein-Tipp-Beleg ohne frischen Live-Preis — die Maske fragt nach,
 * statt den Prognose-Median zu buchen.
 */
export const NO_LIVE_PRICE_LINE =
  "Kein frischer Preis für diese Station — bitte den Preis an der Säule eintragen.";

/** Hinweis des „Ansicht teilen“-Knopfs, wenn die Zwischenablage fehlt. */
export const SHARE_URL_LINE = "URL steht jetzt in der Adresszeile — zum Teilen kopieren.";

/**
 * Offline-Queue: Der Eintrag liegt lokal und geht raus, sobald die Verbindung
 * steht — für Belege wie für Vorsätze, nur das Fürwort unterscheidet sich.
 */
export function queuedNote(subject: "Beleg" | "Auswahl"): string {
  return subject === "Beleg"
    ? "Beleg lokal vorgemerkt — er geht raus, sobald die Verbindung steht."
    : "Auswahl lokal vorgemerkt — sie geht raus, sobald die Verbindung steht.";
}

/** Gescheitertes Speichern — derselbe Satz an jeder Schreibstelle. */
export function saveFailedNote(detail: string | null | undefined): string {
  return `Speichern fehlgeschlagen: ${detail || "unbekannter Grund"} — bitte erneut versuchen.`;
}

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
  return value == null || !Number.isFinite(value)
    ? "—"
    : `${euro(value, decimals)} €/L`;
}

export function centPerLiter(value: number | null | undefined, decimals = 1) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : `${euro(value, decimals)} ct/L`;
}

/** €/L → ct/L (Vorzeichen behalten, Rundung erst beim Formatieren). */
export function euroToCentPerLiter(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : value * 100;
}

/**
 * Zeitwert in Euro je Stunde — das Symbol „€/h“ ist die Kurzform, die
 * Langform läuft über denselben Formatter statt „€/h“ und „Euro pro Stunde“
 * an zwei Stellen zu schreiben (GUI-TEXT-BEFUND V5).
 */
export function euroPerHour(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${deTrimmed(value)} €/h`;
}

/**
 * Tempo in Kilometern je Stunde — Symbol „km/h“ in der Zahl, Langform
 * („<x> Kilometer pro Stunde“, deutsch, ausgeschrieben) für Screenreader.
 * Eine Stelle statt der zwei Schreibweisen aus dem V5-Befund.
 */
export function kilometersPerHour(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Number.isInteger(value) ? deTrimmed(value, 0) : deTrimmed(value, 1)} km/h`;
}

export function kilometersPerHourSpeech(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "keine Angabe";
  const word = Number.isInteger(value) ? deTrimmed(value, 0) : deTrimmed(value, 1);
  return `${word} Kilometer pro Stunde`;
}

export type SpanHours = 24 | 72 | 168;

/**
 * Zeitraum-Label für 24 h / 3 Tage / 7 Tage — eine Wortform für Schalter,
 * Verlaufstitel und `aria-label` (GUI-TEXT-BEFUND V5: vorher wechselten
 * „24 Stunden“, „letzte 24 Stunden“, „+3 Tage“ und „3 Tage“ je nach Stelle).
 * In Sätzen gehört davor „(die) letzten“; die Schalter-Tabs sind reine Nomen
 * ohne „letzte“, weil der Kontext „Verlauf der …“ die Richtung bereits nennt.
 */
export function timeSpanLabel(hours: SpanHours): string {
  if (hours === 24) return "24 Stunden";
  if (hours === 72) return "3 Tage";
  if (hours === 168) return "7 Tage";
  return `${hours} Stunden`;
}

/**
 * Einordnung nach dem Buchen (MICROCOPY: kurze Bestätigung mit
 * Einordnung): der gezahlte Preis gegen den Median der frischen
 * Set-Preise zu dem Moment — eine berechenbare, ehrliche Größe.
 * `null` ohne genug Messwerte (keine Einordnung, kein Lob).
 *
 * U7: lebt hier (nicht in `views/Ich.tsx`), weil die Root den Wert für die
 * Schnell-Erfassung braucht, ohne die Ich-View statisch zu importieren —
 * die Views laden seit U7 als eigene Chunks (`React.lazy`).
 */
export function fillPositionNote(
  pricePaid: number,
  freshPrices: number[],
): string | null {
  const values = freshPrices.filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const deltaCt = (pricePaid - median) * 100;
  if (Math.abs(deltaCt) < 0.05)
    return "Gleichauf mit dem Median deines Sets.";
  return deltaCt < 0
    ? `${centPerLiter(Math.abs(deltaCt))} unter dem Median deines Sets (heute).`
    : `${centPerLiter(Math.abs(deltaCt))} über dem Median deines Sets (heute) — der nächste Beleg ist der bessere Vergleich.`;
}

export function percentLabel(value: number | null | undefined, decimals = 0) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : `${euro(value, decimals)} %`;
}

/**
 * T8: Zählwörter mit ihrer Zahl — „1 frischer Preis“, „12 frische Preise“.
 * Der Plural steht hier, nicht in der Ansicht: „1 frische Preise“ war gebaut.
 */
export function freshCountLabel(count: number): string {
  const n = countLabel(count);
  return count === 1 ? "1 frischer Preis" : `${n} frische Preise`;
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
  // B6: Engine-Fenster haben 5-Minuten-Granularität — ein Fenster 22:00–22:55
  // floor-t beide Seiten auf 22 und renderte „22–22 Uhr“. Liegt eine End-
  // zeit innerhalb der Stunde, wird sie mit Minuten angegeben (22–22:55 Uhr),
  // ein entartetes Null-Fenster als Einzelschicht („22 Uhr“).
  const frac = (hour: number) => Math.floor((hour - Math.floor(hour)) * 60);
  const from = ((Math.floor(fromHour) % 24) + 24) % 24;
  const to = ((Math.floor(toHour) % 24) + 24) % 24;
  if (frac(fromHour) === 0 && frac(toHour) === 0) {
    if (from === to) return `${String(from).padStart(2, "0")} Uhr`;
    return `${String(from).padStart(2, "0")}–${String(to).padStart(2, "0")} Uhr`;
  }
  const full = (hour: number, base: number) =>
    `${String(base).padStart(2, "0")}:${String(frac(hour)).padStart(2, "0")}`;
  return `${full(fromHour, from)}–${full(toHour, to)} Uhr`;
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
  /** Prognosen/Heatmaps: Modell-Lauf täglich (worker INTERVALS: 86 400 s).
   *  B5: vorher 180 min — das markierte ein gesundes System stur „alt“
   *  (Modell 3–24 h alt ist normal), die System-Fußzeile war fast immer rot. */
  model: 24 * 60,
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

/**
 * Alter in Worten aus Minuten: „vor 4 Minuten“, „vor 3 Stunden“, „vor 2
 * Tagen“. Die **eine** Wortform der App (TEXT-BEFUND T11) — jede Ansicht,
 * die ein Alter zeigt, geht durch diese Funktion, nicht durch ein eigenes
 * „vor 12 Min.“.
 */
export function ageWord(age: number): string {
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

/** Alter in Worten: „vor 4 Minuten“, „vor 3 Stunden“, „vor 2 Tagen“. */
export function ageLabel(stamp?: string | null, now: number = Date.now()) {
  const age = ageMinutes(stamp, now);
  if (age == null) return "—";
  return ageWord(age);
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
  return day.every(Number.isFinite) ? [day[0], day[1], day[2]] : null;
}

// „Datum des Datenstands + n Tage“ als dd.MM.yyyy. Ohne Datenstand (as_of fehlt)
// gibt es kein Datum — die UI verspricht dann kein Datum, statt eines zu raten.
export function dayAfterLabel(
  days: number,
  stamp?: string | null,
): string | null {
  if (!stamp || !Number.isFinite(days) || days < 0) return null;
  const day = berlinDay(Date.parse(stamp));
  if (!day) return null;
  const ms = Date.UTC(day[0], day[1] - 1, day[2] + days);
  return utcDayLabel(ms);
}

// H5: Ein Satz zur Zeitumstellung im Backtest-Prüfzeitraum. null = nichts
// anmerken (kein Bericht oder keine 23/25-h-Tage) — nie „keine DST-Tage“
// behaupten, wenn der Bericht fehlt.
export function dstLabel(dst?: DstReport | null): string | null {
  const days = (dst?.days ?? []).filter((day) => typeof day === "string");
  if (!dst || !days.length) return null;
  const described = days
    .map((day) => {
      const hours = dst.day_hours?.[day];
      const stamp = Date.parse(`${day}T00:00:00Z`);
      const calendar = Number.isFinite(stamp) ? utcDayLabel(stamp) : day;
      return hours === 23 || hours === 25
        ? `${calendar} (${deTrimmed(hours, 0)} h)`
        : calendar;
    })
    .join(", ");
  const anchors = dst.anchors_missing_nat ?? 0;
  const anchorNote =
    anchors > 0
      ? ` ${anchors} Vortages-Anker ohne Wanduhr-Zeitpunkt fallen aus der MASE-Skala.`
      : "";
  const policyNote =
    dst.policy === "flagged_not_excluded"
      ? " Die Tage bleiben im Backtest und sind je Tag gekennzeichnet."
      : "";
  return `Zeitumstellung im Prüfzeitraum: ${described}.${policyNote}${anchorNote}`;
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
      : ` · Tagesabdeckung ≥ ${percentLabel(phase.min_daily_coverage * 100)}`;
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

// §0.4 ist ein Zähl-Gate, kein Datum: ≥ 100 abgeschlossene Empfehlungen,
// die Obergrenze des Brier-Intervalls liegt unter beiden Referenzen **und**
// das Tagesblock-Intervall der Reliability-Steigung enthält 1 (B2; 0,25 ist
// nur noch das dokumentierte Münz-Niveau, kein Kriterium).
// Maßgeblich sind die Schwellen des Backends (app/feedback.py →
// live_advice.min_recommendations / brier_threshold); die Konstanten hier
// sind nur der Rückfall für Statistik-Stände, die sie nicht mitschicken.
// Die 90-Tage-Übergangsregel (live_only_days der Engine) gehört bewusst
// nicht in diesen Zähler: 90 Übergangs-Tage sind keine 100 Empfehlungen,
// bei ~1 Empfehlung/Tag wäre das ein Nenner von ~100 Tagen.
export const M7_MIN_RECOMMENDATIONS = 100;
export const M7_BRIER_THRESHOLD = 0.25;

/**
 * Zielwert für MASE an sprungfreien Tagen (docs/referenz/ENGINE.md) — angezeigt über
 * `deNumber`, damit im Text „0,80“ steht und nicht „0.80“ (GUI-TEXT-BEFUND T4).
 */
export const MASE_TARGET = 0.8;

/** B2: Eine Stelle für die Zustände der technischen PIT-Kalibrierung. */
export function pitCalibrationStatus(
  active: boolean,
  calibrationStatus?: string | null,
): string {
  if (active) {
    return "Aktiv: Die 24-h-Bootstrap-Pfade dieser Station werden mit einer zuvor zeitlich getrennt geprüften PIT-Kurve neu quantiliert.";
  }
  if (calibrationStatus === "disabled") {
    return "Ausgeschaltet: Der Kalibrierungs-Schalter ist für diesen Modell-Lauf deaktiviert; die Pfade bleiben roh.";
  }
  return "Noch nicht aktiv: Diese Prognose bleibt roh, bis ein früherer Backtest-Kandidat geprüft und mit gleicher Modellherkunft übernommen wurde.";
}

export function pitCalibrationCandidateLine(input: {
  status?: string | null;
  nPit?: number | null;
  rawPicp95?: number | null;
  calibratedPicp95?: number | null;
  picpReleaseGate?: boolean | null;
  active: boolean;
}): string {
  const status = input.status ?? "unbekannt";
  const sample = input.nPit != null ? ` (${input.nPit} Lern-PITs)` : "";
  const validation =
    input.rawPicp95 != null && input.calibratedPicp95 != null
      ? ` · PICP 95: roh ${percentLabel(input.rawPicp95 * 100, 1)}, geprüft ${percentLabel(input.calibratedPicp95 * 100, 1)}${input.picpReleaseGate ? " (≤ 2 pp Verschlechterung)" : " (Freigabe nicht erfüllt)"}.`
      : ".";
  const lag =
    status === "accepted" && !input.active
      ? " Er wird frühestens im nächsten Modell-Lauf angewandt, damit der Test nicht seine eigene Prognose kalibriert."
      : "";
  return `Neuer 24-h-Kandidat: ${status}${sample}${validation}${lag}`;
}

export const PIT_CALIBRATION_NO_CANDIDATE =
  "Noch kein PIT-Kandidat aus dem Rolling-Backtest veröffentlicht.";

/** B2: Klarer, nicht kausaler A/B-Vergleich aus dem Advice-Ledger. */
export function pitCalibrationLedgerBrierLine(
  groups?: Record<string, { brier: number | null; n: number }> | null,
): string {
  const raw = groups?.raw;
  const pit = groups?.pit_24h;
  const show = (group?: { brier: number | null; n: number }) =>
    group?.brier != null ? `${deNumber(group.brier, 3)} (n=${group.n})` : null;
  const rawText = show(raw);
  const pitText = show(pit);
  if (rawText && pitText) {
    return `Ledger-Brier (alle Abrechnungen): roh ${rawText} · 24-h-PIT ${pitText}. Das ist eine zeitgetrennte A/B-Messung, kein Kausalbeweis.`;
  }
  if (rawText || pitText) {
    return `Ledger-Brier (alle Abrechnungen): ${rawText ? `roh ${rawText}` : `24-h-PIT ${pitText}`}. Die Gegenmessung braucht noch abgerechnete Empfehlungen.`;
  }
  return "Ledger-Brier vor/nach PIT: Noch keine abgerechneten Empfehlungen in den A/B-Gruppen.";
}

export type M7Advice = {
  n?: number | null;
  brier_30d?: number | null;
  min_recommendations?: number | null;
  brier_threshold?: number | null;
  /** Noch laufende Empfehlungen (Fenster nicht vorbei, zählen erst nach Abrechnung). */
  n_pending?: number | null;
  /** O5: Gate-Grundgesamtheit (Verteilungs-P, Allzeit) — gewinnt gegen n/brier_30d. */
  gate_n?: number | null;
  gate_brier?: number | null;
  /** O6: Intervall, Referenzen, Blöcke und Ausgang — alles vom Server. */
  gate_brier_ci?: [number, number] | null;
  gate_ref_base?: number | null;
  gate_ref_climate?: number | null;
  /** B2-A/B: Ledger-Brier getrennt nach technischem Forecast-Zustand. */
  brier_by_calibration?: Record<string, { brier: number | null; n: number }>;
  brier_all_by_calibration?: Record<string, { brier: number | null; n: number }>;
  /** B2: zweites M7-Kriterium, Tagesblock-KI der Reliability-Steigung. */
  gate_reliability_slope?: number | null;
  gate_reliability_slope_ci?: [number, number] | null;
  gate_reliability_target?: number | null;
  gate_reliability_ok?: boolean | null;
  n_day_blocks?: number | null;
  min_day_blocks?: number | null;
  calibrated?: boolean | null;
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
 * Brier mit Intervall gegen beide Referenzen und Reliability-Steigung gegen
 * die Referenz 1 — ohne Tageszahl. Die Übergangsregel (Datenhygiene) hat mit {@link transitionRuleLine} ihre
 * eigene Zeile und ihren eigenen Nenner. `null` ohne Statistik-Lauf: dann
 * gibt es keinen Zähler zu zeigen.
 */
export function m7GateLine(advice?: M7Advice | null): string | null {
  if (!advice) return null;
  // O5: Das Gate zählt Verteilungs-P-Zeilen (Allzeit) — diese Zahlen stehen
  // in gate_n/gate_brier; n/brier_30d bleiben Fallback für Alt-Payloads.
  const gated = advice.gate_n != null;
  const n = gated ? (advice.gate_n as number) : (advice.n ?? 0);
  const need = advice.min_recommendations ?? M7_MIN_RECOMMENDATIONS;
  const pending = advice.n_pending ?? 0;
  // 0.55.0: Die Mehrzahl wurde als Suffix an den Singular gehängt
  // (`läuft` + `en`) — heraus kam „4 Empfehlungen läuften noch und zählt
  // erst nach der Abrechnung“: ein erfundenes Verb und ein Numerus-Bruch im
  // selben Satz. Unregelmäßige Verben brauchen die ganze Form.
  const pendingNote =
    pending > 0
      ? pending === 1
        ? " 1 Empfehlung läuft noch und zählt erst nach der Abrechnung."
        : ` ${pending} Empfehlungen laufen noch und zählen erst nach der Abrechnung.`
      : "";
  // O6: Das Gate vergleicht die Obergrenze des Brier-Intervalls gegen Basis-
  // und Klima-Referenz — der Ausgang kommt vom Server (`calibrated`), die
  // Zeile nennt nur Zahlen und erfindet keine zweite Wahrheit. Alt-Payloads
  // ohne Gate-Grundgesamtheit behalten die alte Regel (eigener Wortlaut).
  const brier = gated ? advice.gate_brier : advice.brier_30d;
  if (n < need) {
    if (!gated) {
      const limit = deNumber(advice.brier_threshold ?? M7_BRIER_THRESHOLD);
      return (
        `Freigabe offen: ${n} von ${need} abgeschlossenen Empfehlungen ` +
        `(Brier-Schwelle < ${limit}).${pendingNote}`
      );
    }
    return (
      `Freigabe offen: ${n} von ${need} abgeschlossenen Empfehlungen mit Verteilungs-P ` +
      `(Freigabe: Obergrenze des Brier-Intervalls unter beiden Referenzen und Steigungsintervall enthält 1).${pendingNote}`
    );
  }
  if (brier == null) {
    // T5: ein Satz, eine Stelle — nur die Grundgesamtheit unterscheidet sich.
    return (
      `Freigabe erfüllt (${n} Empfehlungen) — Brier noch nicht messbar ` +
      `(keine ${gated ? "Verteilungs-P" : "P-Schätzung"} im Ledger).${pendingNote}`
    );
  }
  if (!gated) {
    const limit = deNumber(advice.brier_threshold ?? M7_BRIER_THRESHOLD);
    return (
      `Freigabe erfüllt: ${n} Empfehlungen, Brier ${deNumber(brier)} ` +
      `(Schwelle < ${limit}).${pendingNote}`
    );
  }
  const ci = advice.gate_brier_ci ?? null;
  const slopeCi = advice.gate_reliability_slope_ci ?? null;
  const slopeTarget = advice.gate_reliability_target ?? 1;
  const refs =
    advice.gate_ref_base != null && advice.gate_ref_climate != null
      ? ` gegen Basis ${deNumber(advice.gate_ref_base)} / Klima ${deNumber(advice.gate_ref_climate)}`
      : "";
  if (!ci || !slopeCi || advice.calibrated == null) {
    const blocks = advice.n_day_blocks;
    const needBlocks = advice.min_day_blocks;
    const blockNote =
      blocks != null && needBlocks != null
        ? ` (${blocks} von min. ${needBlocks} Tagesblöcken)`
        : "";
    return (
      `Freigabe noch nicht messbar: ${n} Empfehlungen, Brier ${deNumber(brier)}${blockNote}.${pendingNote}`
    );
  }
  const verdict = advice.calibrated ? "erfüllt" : "nicht erreicht";
  const slope =
    advice.gate_reliability_slope != null
      ? `Steigung ${deNumber(advice.gate_reliability_slope)} `
      : "Steigung ";
  return (
    `Freigabe ${verdict}: ${n} Empfehlungen, Brier ${deNumber(brier)} ` +
    `[${deNumber(ci[0])}–${deNumber(ci[1])}]${refs}; ${slope}` +
    `[${deNumber(slopeCi[0])}–${deNumber(slopeCi[1])}] enthält Ziel ${deNumber(slopeTarget)}.${pendingNote}`
  );
}

/**
 * O6: Kompaktzeile des Gate-Briers für die System-Metrik — Punkt, Intervall
 * und beide Referenzen. Alt-Payloads ohne Gate-Felder behalten die alte
 * Ziel-Formulierung; zu wenige Tagesblöcke nennen den Blockstand.
 */
export function m7BrierDetail(advice?: M7Advice | null): string {
  const brier = advice?.gate_brier ?? advice?.brier_30d ?? null;
  if (brier == null) {
    return "Brier noch nicht messbar — braucht bewertete Empfehlungen.";
  }
  const ci = advice?.gate_brier_ci ?? null;
  const refs =
    advice?.gate_ref_base != null && advice?.gate_ref_climate != null
      ? `Basis ${deNumber(advice.gate_ref_base)} / Klima ${deNumber(advice.gate_ref_climate)}`
      : null;
  const slopeCi = advice?.gate_reliability_slope_ci ?? null;
  const slopeTarget = advice?.gate_reliability_target ?? 1;
  const slope = advice?.gate_reliability_slope;
  if (ci && refs) {
    const slopeDetail = slopeCi
      ? `; Steigung ${slope != null ? deNumber(slope) : "—"} ` +
        `[${deNumber(slopeCi[0])}–${deNumber(slopeCi[1])}] (Ziel: enthält ${deNumber(slopeTarget)})`
      : "; Steigung noch nicht messbar";
    return (
      `Brier ${deNumber(brier)} [${deNumber(ci[0])}–${deNumber(ci[1])}] ` +
      `(Ziel: Obergrenze < ${refs})${slopeDetail}`
    );
  }
  if (advice?.gate_n != null && advice?.n_day_blocks != null) {
    return (
      `Brier ${deNumber(brier)} (Intervall: ${advice.n_day_blocks} von min. ` +
      `${advice.min_day_blocks ?? 10} Tagesblöcken)`
    );
  }
  const limit = deNumber(advice?.brier_threshold ?? M7_BRIER_THRESHOLD);
  return `Brier ${deNumber(brier)} (Ziel < ${limit})`;
}

export type WindowsAdvice = {
  /** Abgerechnete Empfehlungen im 30-Tage-Fenster (Gegenprobe-Nenner). */
  n?: number | null;
  /** O38: genutzte vs. verstrichene Fenster je Woche/Monat. */
  episodes_used_7d?: number | null;
  episodes_expired_7d?: number | null;
  episodes_used_30d?: number | null;
  episodes_expired_30d?: number | null;
};

/**
 * Fensterbilanz (O38): „x von y Fenstern genutzt“ plus die Aufschlüsselung
 * abgerechneter Empfehlungen gegen verstrichene Fenster — die Gegenprobe
 * zur Trefferquote. `null` ohne Statistik-Lauf oder ohne O38-Zähler
 * (Alt-Payloads erfinden keine Bilanz).
 */
export function windowsUsedLine(advice?: WindowsAdvice | null): string | null {
  const used30 = advice?.episodes_used_30d ?? null;
  const expired30 = advice?.episodes_expired_30d ?? null;
  if (used30 == null || expired30 == null) return null;
  const total30 = used30 + expired30;
  if (total30 === 0) {
    return "Fensterbilanz (30 Tage): noch keine Fenster geschlossen.";
  }
  const settled = advice?.n ?? 0;
  const settledWord = `Empfehlung${settled === 1 ? "" : "en"}`;
  const used7 = advice?.episodes_used_7d ?? 0;
  const expired7 = advice?.episodes_expired_7d ?? 0;
  const week =
    used7 + expired7 > 0
      ? ` — 7 Tage: ${countLabel(used7)} von ${countLabel(used7 + expired7)} genutzt`
      : "";
  return (
    `Fensterbilanz (30 Tage): ${countLabel(used30)} von ${countLabel(total30)} ` +
    `Fenstern genutzt (${countLabel(settled)} ${settledWord} abgerechnet · ` +
    `${countLabel(expired30)} Fenster verstrichen)${week}.`
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

// --- A2: Tankstand als Eingabe für F3 („Tank bei ¼ — kann ich warten?“) -----

/** Spiegel der Server-Konstanten (app/decide.py) — nur für die Vorschau-Anzeige. */
export const TANK_RESERVE_LITERS = 5;
export const TANK_CAPACITY_DEFAULT_L = 50;

/**
 * Restreichweite aus Füllstand: Kapazität × Prozent ÷ Verbrauch. Die
 * verbindliche Bewertung (leer/knapp/ok) kommt aus /decide → ``tank``; diese
 * Funktion ist nur die Live-Vorschau am Slider, damit die Zahl nicht erst
 * nach dem nächsten Poll erscheint.
 */
export function tankRangeKm(
  tankPercent: number | null | undefined,
  capacityL: number,
  consumption: number,
): number | null {
  if (
    tankPercent == null ||
    !Number.isFinite(tankPercent) ||
    tankPercent < 0 ||
    tankPercent > 100 ||
    !Number.isFinite(capacityL) ||
    capacityL <= 0 ||
    !Number.isFinite(consumption) ||
    consumption <= 0
  ) {
    return null;
  }
  return (capacityL * (tankPercent / 100)) / consumption * 100;
}

/** Kilometer deutsch: „1.234 km“ (ganzzahlig, de-DE). */
/**
 * Strecke in km — der einzige Weg, Kilometer anzuzeigen (MICROCOPY §3).
 * `decimals` nur, wo die Nachkommastelle trägt (Umweg „2,4 km“); Zählerstände
 * bleiben ganzzahlig.
 */
export function kilometersLabel(
  value: number | null | undefined,
  decimals = 0,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return decimals > 0
    ? `${euro(value, decimals)} km`
    : `${Math.round(value).toLocaleString("de-DE")} km`;
}

/** Live-Vorschau-Satz am Tankstand-Slider — die Bewertung selbst liefert /decide. */
export function tankPreviewLine(
  tankPercent: number | null,
  capacityL: number,
  consumption: number,
): string | null {
  const km = tankRangeKm(tankPercent, capacityL, consumption);
  if (km === null) return null;
  const reserveKm = (TANK_RESERVE_LITERS / consumption) * 100;
  return `Restreichweite ≈ ${kilometersLabel(km)} · Reserve ab ≈ ${kilometersLabel(reserveKm)}`;
}

// --- C2: Stamm-Stationen pinnen + Suche/Filter/Sortierung -------------------

/**
 * Obergrenze der Stamm-Stationen. Zwei bis drei sind der Normalfall; die
 * Grenze hält den Kopf der Liste lesbar — der Zähler „N im Set“ bleibt die
 * volle Anzahl, das Pinnen sortiert nur.
 */
export const PINNED_MAX = 8;
export type StationSort = "price" | "distance" | "fill";
export const STATION_SORTS: Array<{
  value: StationSort;
  label: string;
  title: string;
}> = [
  {
    value: "price",
    label: "Preis (€/L)",
    title: "Billigster frischer Preis zuerst",
  },
  {
    value: "distance",
    label: "Distanz",
    title: "Nächste Station zum Anker der Stadt zuerst",
  },
  {
    value: "fill",
    label: "Netto-€ (Beleg)",
    title: "Preis × Tankmenge — was ein Beleg dort kostet",
  },
];

/**
 * Pinnen/Umpinnen als reine Funktion: Dedupliziert, kappt bei
 * {@link PINNED_MAX} (wer mehr probiert, bekommt die Meldung „maximal N“).
 */
export function togglePinnedStation(
  ids: string[],
  stationId: string,
): { ids: string[]; note: string | null } {
  if (ids.includes(stationId)) {
    return { ids: ids.filter((id) => id !== stationId), note: null };
  }
  if (ids.length >= PINNED_MAX) {
    return {
      ids,
      note: `Maximal ${PINNED_MAX} Stamm-Stationen — erst eine lösen.`,
    };
  }
  return { ids: [...ids, stationId], note: null };
}

/** Suche über Name/Marke (Groß-/Kleinschreibung egal, Teilstring). */
export function stationMatchesQuery(
  row: Pick<Station, "name" | "brand">,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    row.name.toLowerCase().includes(needle) ||
    row.brand.toLowerCase().includes(needle)
  );
}

/** Markenfilter: nur Zeilen der gewählten Marke („Alle“ = leerer String). */
export function stationMatchesBrand(
  row: Pick<Station, "brand">,
  brand: string,
): boolean {
  return !brand || row.brand === brand;
}

/** Sortierung der Stationsliste; „fill“ = Preis × Tankmenge (Netto-€). */
export function compareStations(
  a: Station,
  b: Station,
  sort: StationSort,
  priceOf: (row: Station) => number | null,
): number {
  if (sort === "distance") {
    const da = a.dist_km ?? Number.POSITIVE_INFINITY;
    const db = b.dist_km ?? Number.POSITIVE_INFINITY;
    return da - db;
  }
  if (sort === "fill") {
    const fa = priceOf(a);
    const fb = priceOf(b);
    const ca = fa == null ? Number.POSITIVE_INFINITY : fa;
    const cb = fb == null ? Number.POSITIVE_INFINITY : fb;
    if (ca !== cb) return ca - cb;
  }
  // Default „price“ (und Fallback für gleichwertige Zeilen): Preis, dann Name.
  const pa = priceOf(a);
  const pb = priceOf(b);
  const va = pa == null ? Number.POSITIVE_INFINITY : pa;
  const vb = pb == null ? Number.POSITIVE_INFINITY : pb;
  if (va !== vb) return va - vb;
  return a.name.localeCompare(b.name, "de");
}

/**
 * Die fertige Liste: Stamm-Stationen zuerst (in Pin-Reihenfolge), dann der
 * Rest nach gewählter Sortierung. Ohne Pin bleibt alles beim alten Verhalten.
 */
export function orderedStationList(
  rows: Station[],
  pinnedIds: string[],
  sort: StationSort,
  priceOf: (row: Station) => number | null,
  query = "",
  brand = "",
): Station[] {
  const filtered = rows.filter(
    (row) => stationMatchesQuery(row, query) && stationMatchesBrand(row, brand),
  );
  const pinned = pinnedIds
    .map((id) => filtered.find((row) => row.station_id === id))
    .filter((row): row is Station => row !== undefined);
  const rest = filtered.filter((row) => !pinnedIds.includes(row.station_id));
  rest.sort((a, b) => compareStations(a, b, sort, priceOf));
  return [...pinned, ...rest];
}

/** A4: Monats-Schlüssel „2026-09“ als deutsches Label („September 2026“). */
export function monthBalanceLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const months = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ];
  const idx = Number(match[2]) - 1;
  if (idx < 0 || idx > 11) return key;
  return `${months[idx]} ${match[1]}`;
}

/** A4: Jahres-Schlüssel „2026“ bleibt Jahr (mit „Gesamt“-Angabe im Panel). */
export function yearBalanceLabel(key: string): string {
  return `Gesamtjahr ${key}`;
}

/**
 * C4: Dark/Light-Umschaltung der NAS-GUI.
 *
 * Dunkel (Slate-950) ist die Design-Basis (docs/produkt/GUI-VORLAGEN.md) und bleibt
 * der Default. „Hell (Slate)“ ist eine helle Variante derselben Skala:
 * dieselben Tailwind-Klassen, andere Token-Werte unter `html.light` in
 * styles.css — abgeleitet von der Light-Palette der Fallback-GUI
 * (rp2/fallback_gui.py), damit beide Oberflächen beieinander liegen. Die
 * Wahl gilt gerätelokal (localStorage), wie alle anderen Einstellungen.
 */
export type AppTheme = "dark" | "light";
export const APP_THEMES = ["dark", "light"] as const;
export function isAppTheme(value: unknown): value is AppTheme {
  return value === "dark" || value === "light";
}
/** theme-color-Meta je Thema (Browser-UI/Adressleiste). */
export const APP_THEME_META_COLOR: Record<AppTheme, string> = {
  dark: "#020617",
  light: "#eef2f7",
};
/**
 * Wendet das Thema auf <html> an: Klasse `light` (dunkel ist die
 * Default-Klasse `dark` in index.html) plus theme-color-Meta. Idempotent —
 * der Bootstrap-Script in index.html macht vor dem ersten Paint dasselbe
 * ohne React, damit kein Theme-Flash sichtbar wird.
 */
export function applyAppTheme(theme: AppTheme): void {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (meta) meta.setAttribute("content", APP_THEME_META_COLOR[theme]);
}

/**
 * C4: Zeilen der Schwellen-Tabelle im Einstellungen-Tab (read-only).
 *
 * Reihenfolge und Bedingungen folgen der Entscheidungstabelle (Konzept
 * §4.1/§4.2) und den Startwert-Kommentaren in app/thresholds.py — keine
 * erfundenen Bedeutungen. `kind` wählt den Formatter: €-Beträge über
 * euro(), Wahrscheinlichkeiten über percentLabel() (MICROCOPY).
 */
export type ThresholdRowDef = {
  key: string;
  action: string;
  condition: string;
  kind: "eur" | "percent";
};
export const THRESHOLD_ROWS: readonly ThresholdRowDef[] = [
  {
    key: "wait_eur_high",
    action: "Warten (grün)",
    condition: "Mindest-Ersparnis",
    kind: "eur",
  },
  {
    key: "wait_p_high",
    action: "Warten (grün)",
    condition: "Mindest-Trefferquote",
    kind: "percent",
  },
  {
    key: "wait_eur_mid",
    action: "Warten (gelb)",
    condition: "Mindest-Ersparnis",
    kind: "eur",
  },
  {
    key: "wait_p_mid",
    action: "Warten (gelb)",
    condition: "Mindest-Trefferquote",
    kind: "percent",
  },
  {
    key: "elsewhere_net_eur",
    action: "Woanders tanken",
    condition: "Mindest-Nettoersparnis",
    kind: "eur",
  },
  {
    key: "elsewhere_p",
    action: "Woanders tanken",
    condition: "Mindest-Trefferquote",
    kind: "percent",
  },
  {
    key: "elsewhere_borderline_eur",
    action: "Woanders tanken",
    condition: "Grenze der Grauzone",
    kind: "eur",
  },
  {
    key: "now_eur",
    action: "Jetzt tanken",
    condition: "unterhalb dieser Ersparnis",
    kind: "eur",
  },
  {
    key: "now_p",
    action: "Jetzt tanken",
    condition: "wenn P(Warten) unter",
    kind: "percent",
  },
];

/**
 * Ein Tabellenwert — ehrlich „—“, wenn der Server keinen Wert liefert.
 * €-Beträge über euro() mit angehängtem „€“ (Formatter-Satz in data.ts);
 * Wahrscheinlichkeiten liefert der Server als Anteil (0.7 = 70 %),
 * percentLabel() erwartet die Prozentzahl.
 */
export function thresholdValueLabel(
  kind: "eur" | "percent",
  value: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return kind === "eur" ? `${euro(value)} €` : percentLabel(value * 100);
}

/**
 * C4: Statuszeile der Schwellen-Tabelle aus dem M7-Nachzug (read-only).
 * Sagt, womit die Engine rechnet: Startwerte (Nachzug aus) oder nachgezogene
 * Werte (Nachzug aktiv, nur dann, wenn sich etwas geändert hat).
 */
export function thresholdStatusLine(
  tuning: ThresholdTuning | null | undefined,
): string {
  if (!tuning) {
    return "Nachzug-Status nicht geladen — es gelten die Startwerte der Engine.";
  }
  if (!tuning.auto_apply) {
    return "M7-Nachzug aus — die Engine rechnet mit den Startwerten.";
  }
  return tuning.applied
    ? "M7-Nachzug aktiv — die Tabelle weicht von den Startwerten ab."
    : "M7-Nachzug aktiv — aktuell keine Abweichung von den Startwerten.";
}

/**
 * C4: Stichprobe-Zeile — auf wie vielen abgeschlossenen Empfehlungen pro
 * Aktion der Nachzug beruht (min_n = Mindest-Stichprobe je Aktion).
 */
export function thresholdSampleLine(
  tuning: ThresholdTuning | null | undefined,
): string | null {
  if (!tuning?.sample) return null;
  const { n_wait, n_now, n_elsewhere, min_n } = {
    ...tuning.sample,
    min_n: tuning.min_n,
  };
  return (
    `Stichprobe (Mindest je Aktion: ${min_n}): ` +
    `Warten n=${n_wait ?? "—"} · Jetzt n=${n_now ?? "—"} · ` +
    `Woanders n=${n_elsewhere ?? "—"}`
  );
}

/**
 * A9 (0.31.0): Hinweis unter den F3-Fenstern, ob die Reihenfolge schon
 * persönlich gewichtet ist — und wie viele Belege dazu fehlen. Das Profil
 * selbst ist ein Langzeitprofil über alle Belege (Konzept §5.5 Schicht C);
 * vor `min_fills` Belegen führt die App die reine Preisreihenfolge, weil ein
 * Profil aus zwei Belegen erfunden wäre.
 */
export function personalizationNote(
  personalization: DecideResult["personalization"],
): string | null {
  if (!personalization) return null;
  const { active, n_fills, min_fills, default_fills } = personalization;
  const legacy =
    default_fills && default_fills > 0
      ? ` ${default_fills === 1 ? "1 älterer Beleg ohne Zeitstempel bleibt" : `${default_fills} ältere Belege ohne Zeitstempel bleiben`} als 12-Uhr-Projektion markiert.`
      : "";
  if (active) {
    return (
      `Reihenfolge berücksichtigt deine Tankzeiten vorsichtig (${n_fills} ${
        n_fills === 1 ? "Beleg" : "Belege"
      }) und ist weiter gegen das Standardprofil geglättet (Stärke ${min_fills}).` + legacy
    );
  }
  return `Noch reine Preisreihenfolge — sobald der erste Beleg mit Zeit vorliegt, wirkt er vorsichtig gegen das Standardprofil geglättet.` + legacy;
}

/**
 * H3 (0.31.0): Rauschband-Zeile der Schwellen-Tabelle. Der M7-Nachzug zieht
 * erst außerhalb der Zufallsschwankung der Trefferquote — sonst würde der
 * Regler bei kleinen Stichproben pendeln. Die Zeile sagt, wie breit das Band
 * gerade ist, damit „kein Nachzug“ nicht nach Defekt aussieht.
 */
export function thresholdHysteresisLine(
  tuning: ThresholdTuning | null | undefined,
): string | null {
  const band = tuning?.hysteresis?.noise_band;
  if (!band) return null;
  const share = (value: number) => `${Math.round(value * 100)} pp`;
  const parts = [
    band.wait != null ? `Warten ±${share(band.wait)}` : null,
    band.now != null ? `Jetzt ±${share(band.now)}` : null,
    band.elsewhere != null ? `Woanders ±${share(band.elsewhere)}` : null,
  ].filter((part): part is string => part !== null);
  if (!parts.length) return null;
  return (
    `Rauschband (${parts.join(" · ")}) — kleinere Abweichungen vom Ziel ` +
    `gelten als Zufall und ziehen die Schwellen nicht.`
  );
}

// --- C7: Glossar & A12/A13: Lebenszyklus & Preis-Zwillinge ---------------

/** A12: Deutscher Klartext je Lebenszyklus (Zustände benennen, nicht bewerten). */
export function lifecycleLabel(lc: StationLifecycle | string | null | undefined): string {
  switch (lc) {
    case "active":
      return "aktiv";
    case "dead":
      return "ohne Preis seit Tagen — tot";
    case "closed":
      return "temporär geschlossen";
    case "no_fuel":
      return "führt diesen Kraftstoff nicht";
    default:
      return "unbekannt";
  }
}

/** Kurze Badge-Farbe je Lebenszyklus (nur Zusatz, Farbe trägt nie allein). */
export function lifecycleTone(lc: StationLifecycle | string | null | undefined): "neutral" | "warn" | "error" {
  switch (lc) {
    case "dead":
      return "error";
    case "closed":
    case "no_fuel":
      return "warn";
    default:
      return "neutral";
  }
}

/** Tooltip-Text je Lebenszyklus — eine Zeile, woran man den Zustand erkennt. */
export function lifecycleTip(lc: StationLifecycle | string | null | undefined): string {
  switch (lc) {
    case "active":
      return "In den letzten Tagen lag mindestens ein verwertbarer Preis vor.";
    case "dead":
      return "Seit Tagen kein verwertbarer Preis (Status „no prices“) — die Station fällt aus dem Ranking; das Polling-Set ändert sich erst nach Bestätigung.";
    case "closed":
      return "Status „geschlossen“ — die Station ist vorübergehend geschlossen, der Preis fehlt deshalb.";
    case "no_fuel":
      return "Offen, aber dieser Kraftstoff wurde als „false“ gemeldet — die Sorte wird hier nicht geführt.";
    default:
      return "Lebenszyklus unbekannt.";
  }
}

/** A13: Ein-Satz-Zusammenfassung eines Preis-Zwillings (für System-Tab). */
export function priceTwinLabel(twin: PriceTwin): string {
  const a = twin.station_a;
  const b = twin.station_b;
  const agree = Number.isFinite(twin.agreement_pct) ? percentLabel(twin.agreement_pct, 1) : "—";
  return `${a} und ${b} — ${twin.qualifying_days} Tage, ${agree} der gemeinsamen Preise innerhalb 0,1 ct/L`;
}

/** C7: Glossar-Eintrag — deutscher Primärlabel, Fachwort im Tooltip, Kurz- und Langform. */
export type GlossaryTerm = {
  id: string;
  term: string;
  de: string;
  short: string;
  long: string;
  anchor?: string;
};

/** C7: Fachbegriffe ohne Erklärung in der App — hier mit deutscher Primärzeile. */
export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    id: "delta",
    term: "δ̂ (delta-hat)",
    de: "Preis-Abstand",
    short: "Median der Differenz einer Station zum Median der übrigen Stationen der Stadt — in ct/L, negativ heißt günstiger als die Umgebung.",
    long: "Für jeden 5-Minuten-Zeitpunkt wird der Median der Vergleichsstationen (Leave-One-Out) abgezogen; über alle Zeitpunkte gemittelt ergibt das δ̂. Ein Wert von −4,2 ct/L bedeutet: Die Station lag im Mittel 4,2 ct/L unter dem Stadtmedian. Das Konfidenzintervall kommt aus dem Tages-Block-Bootstrap (B=2000, 95 %, Benjamini-Hochberg-korrigierter q-Wert).",
    anchor: "relative-preislage-δ",
  },
  {
    id: "mase",
    term: "MASE",
    de: "Vergleich zur saisonalen Naive",
    short: "MASE = Backtest-MAE geteilt durch den MAE der saisonalen Naive. Unter 1,0 heißt besser als die einfache Vergleichsmethode.",
    long: "Mean Absolute Scaled Error: Der Backtest-Fehler des Modells geteilt durch den Fehler der 24-Stunden-Naive (Vor-Tages-Preis zur selben Stunde). MASE 0,7 heißt 30 % besser als die Naive. Im Roll-Backtest letzte 7 abgeschlossene Prüftage, Daten aus echten Beobachtungen, keine Prognose.",
    anchor: "mase-fehler-gegen-die-naive",
  },
  {
    id: "picp",
    term: "PICP 95 %",
    de: "Trefferquote des 95-%-Bandes",
    short: "Anteil echter Preise, die im 95-%-Band des Backtests lagen. Zielbereich 90–98 %.",
    long: "Prediction Interval Coverage Probability: Wie oft liegt der echte Preis im vorhergesagten 95-%-Band? Bei perfekter Kalibrierung etwa 95 % der Zeit. Darunter ist das Band zu schmal (zu siegessicher), darüber zu breit (zu vorsichtig). Gezählt werden nur Zeitpunkte mit echtem Preis, geschlossene Meldungen zählen nicht als Bandverfehlung.",
    anchor: "picp-band-trefferquote",
  },
  {
    id: "brier",
    term: "Brier",
    de: "Treffergenauigkeit der Prozentzahlen",
    short: "Mittlerer quadratischer Abstand zwischen behaupteter Prozentzahl P und eingetretenem Ergebnis (0/1). Kleiner heißt ehrlicher.",
    long: "Der Brier-Score vergleicht jede Empfehlungs-Prozentzahl P(„Warten lohnt“) mit dem tatsächlich eingetretenen „hat Warten einen Vorteil gebracht?“ (Ja=1, Nein=0). 0 wäre perfekt, 0,25 entspricht Raten. Die Freigabe des Kalibrierungs-Gates fordert mindestens 100 abgeschlossene Empfehlungen, deren Brier-Intervall (Obergrenze) unter Basis- und Klima-Referenz liegt (§0.4); 0,25 ist nur das Münz-Niveau zum Einordnen.",
    anchor: "brier-score-treffergenauigkeit-der-prozentzahlen",
  },
  {
    id: "eps",
    term: "ε (epsilon)",
    de: "Handlungsschwelle",
    short: "Mindest-Ersparnis in ct/L, ab der die Regel „Warten“ empfiehlt statt „Jetzt tanken“. Schalter im Labor, Produktion rechnet mit kalibrierter Entscheidungstabelle.",
    long: "Die Labor-Regel des Backtests: Warten nur, wenn die im Training geschätzte erwartete Ersparnis μ mindestens ε erreicht. ε = 1,0 ct/L heißt: Erwarte ich weniger als einen Cent Vorteil, bleibe ich bei „Jetzt“. Die Produktion nutzt die kalibrierte Entscheidungstabelle (§4.1/§4.2), der Slider dient nur der Was-wäre-wenn-Analyse.",
    anchor: "epsilon-schwelle-des-labor-vergleichs",
  },
  {
    id: "regret",
    term: "Regret / Mehrkosten",
    de: "Mehrkosten zum perfekten Timing",
    short: "Durchschnittlicher Abstand der Regel zum Orakel — wie viel Cent je Liter die Regel mehr kostet als der beste Zeitpunkt im Fenster.",
    long: "Regret = (Preis der Regel − Preis des Orakels) je Entscheidung, gemittelt. Das Orakel kennt den ganzen Tagesverlauf vorher und tankt immer im günstigsten Fenster — es ist die unerreichbare Referenz. Die Regel-€ (smart), Orakel-€ (best) und „immer warten“-€ (always) stehen daneben: Geholtes Potenzial = Regel-€ / Orakel-€.",
    anchor: "regret-mehrkosten-zum-perfekten-timing",
  },
  {
    id: "qvalue",
    term: "q-Wert",
    de: "Falscher-Alarm-korrigiert",
    short: "Benjamini-Hochberg-korrigierter p-Wert über alle Stationen der Stadt. Signifikant günstiger bei q < 0,05.",
    long: "Der q-Wert korrigiert die vielen Einzeltests (jede Station gegen ihre Stadt) gegen falsche Entdeckungen. q = 0,03 heißt: Unter allen als signifikant markierten Stationen sind höchstens 3 % Fehlalarme erwartet. 95-%-KI und q-Wert kommen aus demselben Tages-Block-Bootstrap.",
    anchor: "bootstrap-ki--fdr",
  },
  {
    id: "avscore",
    term: "AV-Score / Ampel-Stärke",
    de: "Gewichtete Verfügbarkeit bei 3 günstigsten",
    short: "Gewichtete Wahrscheinlichkeit, dass die Station zu den drei günstigsten der Stadt gehört — gewichtet mit dem Tankzeitprofil.",
    long: "Für jede Stunde wird gemessen, wie oft die Station unter den drei günstigsten Preisen lag; über die 24 Stunden gewichtet mit dem Tankzeitprofil w(h) (Default Pendlerprofil, ab 8 Belegen personalisiert). Eine hohe Ampel-Stärke sagt: Zu den typischen Tankzeiten liegt die Station oft unter den drei günstigsten.",
    anchor: "av-score--billigste-stunde",
  },
  {
    id: "lifecycle",
    term: "Lebenszyklus",
    de: "Zustand der Station für diesen Kraftstoff",
    short: "aktiv, temporär geschlossen, führt den Kraftstoff nicht oder tot (seit Tagen kein Preis) — nur tote verlieren den Vergleichsplatz.",
    long: "Die API liefert je Station „open“, „closed“ oder „false“ (Sorte nicht geführt). Kein verwertbarer Preis in den letzten 7 Kalendertagen (Europe/Berlin, konfigurierbar) gilt als „tot“ und verliert den Vergleichsplatz im Ranking — anders als „geschlossen“ (vorübergehend) oder „führt nicht“ (offen, aber Sorte fehlt). Gepollt wird weiter, bis das Polling-Set per Tausch-Anleitung bereinigt ist.",
    anchor: "lebenszyklus-der-stationen",
  },
  {
    id: "twins",
    term: "Preis-Zwillinge",
    de: "Stationen mit identischem Preisverlauf",
    short: "Zwei Stationen, deren Preise über 28 Tage bei ≥ 90 % Überlappung zu ≥ 99 % innerhalb 0,1 ct/L übereinstimmen — Warnung, nie automatische Entfernung.",
    long: "Kriterien: mind. 28 Tage mit je ≥ 12 gemeinsamen Zeitpunkten, ≥ 90 % Überlappung, ≥ 99 % Übereinstimmung innerhalb 0,1 ct/L. Solche Paare sind oft Doppel-Source oder Franchise-Überlappung. Die Warnung steht im Selektions-Artefakt und im System-Tab; das Polling-Set wird nie automatisch umgebaut — das braucht Bestätigung.",
    anchor: "preis-zwillinge",
  },
] as const;

export function glossaryById(id: string): GlossaryTerm | undefined {
  return GLOSSARY.find((g) => g.id === id);
}

// --- V3: eine Meldung, ein Rang -------------------------------------------------

/**
 * Rang einer Meldung — je höher, desto wichtiger (0.43.0, GUI-TEXT-BEFUND V3).
 * Solange mehrere Quellen gleichzeitig etwas melden, gewinnt der höchste Rang;
 * gleichrangige Meldungen werden mit „·“ aneinandergereiht, sodass nie mehr
 * als **ein** Block über dem Inhalt steht.
 */
export const NOTICE_RANK = {
  error: 4, // app-weit nicht verarbeitet — role="alert"
  warn: 3, // app-weit eingeschränkt (offline, Queue, Alt-Daten) — role="status"/"alert"
  hint: 2, // app-weiter Hinweis (Installation, Update, E5-Hinweis)
  success: 1, // reine Bestätigung einer Aktion (Beleg verbucht, Link kopiert, …)
} as const;

export type NoticeRank = keyof typeof NOTICE_RANK;

/** Höher gewinnt. Die Meldung (als Block) gewinnt gegen den schlichten Rang. */
export function noticeRankKey(rank: NoticeRank | number): number {
  return typeof rank === "number" ? rank : NOTICE_RANK[rank];
}

/** Eine gemeinsame Anzeigedauer für Rückmeldungen (DoD V3: 6 s, Störungen bleiben). */
export const NOTICE_NORMAL_MS = 6000;
