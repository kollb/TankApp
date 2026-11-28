import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { HealthResponse, OverviewResponse } from "../api/types";
import { useAppContext } from "./AppContext";

export interface OverviewState {
  overview: OverviewResponse | null;
  health: HealthResponse | null;
  loading: boolean;
  offline: boolean;
  error: string | null;
  updatedAt: number | null;
  refresh: () => void;
}

export function useOverview(): OverviewState {
  const { city, fuel, pollingInterval, refreshKey, refresh } = useAppContext();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const refreshNow = useCallback(() => refresh(), [refresh]);

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      setLoading(true);
      const query = new URLSearchParams({ fuel });
      if (city) query.set("city", city);
      const signal = controller.signal;
      const [result, healthResult] = await Promise.allSettled([
        api.get<OverviewResponse>(`overview?${query}`, signal),
        api.get<HealthResponse>("health", signal),
      ]);
      if (stopped || signal.aborted) return;
      if (result.status === "fulfilled") {
        setOverview(result.value);
        setOffline(false);
        setError(null);
        setUpdatedAt(Date.now());
      } else {
        const reason = result.reason;
        setOffline(true);
        setError(reason instanceof ApiError ? reason.message : "Backend nicht erreichbar");
      }
      if (healthResult.status === "fulfilled") setHealth(healthResult.value);
      setLoading(false);
    };
    void load();
    const timer = window.setInterval(() => void load(), Math.max(5_000, pollingInterval));
    return () => { stopped = true; controller?.abort(); window.clearInterval(timer); };
  }, [city, fuel, pollingInterval, refreshKey]);

  return { overview, health, loading, offline, error, updatedAt, refresh: refreshNow };
}
