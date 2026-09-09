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
export type Health = {
  app: string;
  polling_error: string | null;
  influx_configured: boolean;
  archive_configured: boolean;
  jobs_enabled: boolean;
  station_count: number;
  archive: {
    status: string | null;
    archive_since: string | null;
    requested_until: string | null;
    missing_files: number | null;
    last_complete_until: string | null;
  };
  jobs: { archive: Job; models: Job };
  models: {
    published_at: string | null;
    count: number;
    calibrated: false;
    decision_ready: false;
  };
};
export type Point = { timestamp: string; price: number | null; status: string };
export type Forecast = {
  points: {
    timestamp: string;
    q50: number | null;
    q025: number | null;
    q975: number | null;
  }[];
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

// Real gaps and status barriers split the line; do not interpolate over a closed station/outage.
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
    if (group.length && x - group[group.length - 1].x > 30 * 60000) flush();
    group.push({ x, y: point.price });
  }
  flush();
  return result;
}

// Zeitliche Lücken zwischen allen Punkten einer Diagrammserie; das Diagramm
// markiert sie als Band, statt Linien über geschlossene Zeiträume zu ziehen.
export function gapBands(
  series: { pts: { x: number }[] }[],
  minMinutes: number,
): { from: number; to: number }[] {
  const times = [...new Set(series.flatMap((s) => s.pts.map((p) => p.x)))].sort(
    (a, b) => a - b,
  );
  const bands: { from: number; to: number }[] = [];
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > minMinutes * 60000)
      bands.push({ from: times[i - 1], to: times[i] });
  }
  return bands;
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
