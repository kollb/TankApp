import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { Fuel, ProfilesResponse } from "../api/types";

export interface AppContextValue {
  city: string;
  setCity: (value: string) => void;
  fuel: Fuel;
  setFuel: (value: Fuel) => void;
  activeProfile: string;
  setActiveProfile: (value: string) => Promise<void>;
  profiles: ProfilesResponse["profiles"];
  pollingInterval: number;
  setPollingInterval: (value: number) => void;
  refreshKey: number;
  refresh: () => void;
}

const Context = createContext<AppContextValue | null>(null);
function readPreference<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(`tankapp.v2.${key}`); return value === null ? fallback : JSON.parse(value) as T; }
  catch { return fallback; }
}
function useStored<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState(() => readPreference(key, initial));
  const update = useCallback((next: T) => {
    setValue(next);
    try { localStorage.setItem(`tankapp.v2.${key}`, JSON.stringify(next)); } catch { /* session-only preference */ }
  }, [key]);
  return [value, update];
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [city, setCity] = useStored("city", "");
  const [fuel, setFuel] = useStored<Fuel>("fuel", "e10");
  const [activeProfile, setActiveProfileStored] = useStored("profile", "");
  const [pollingInterval, setPollingInterval] = useStored("pollingInterval", 30_000);
  const [profiles, setProfiles] = useState<ProfilesResponse["profiles"]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api.get<ProfilesResponse>("profiles", controller.signal).then((result) => {
      setProfiles(Array.isArray(result.profiles) ? result.profiles : []);
      setActiveProfileStored(result.active ?? "");
    }).catch(() => { /* Profiles are optional for the shell. */ });
    return () => controller.abort();
  }, [refreshKey]);
  const setActiveProfile = useCallback(async (profileId: string) => {
    const path = profileId ? `profiles/${encodeURIComponent(profileId)}/activate` : "profiles/activate";
    await api.post(path, profileId ? undefined : { active: null });
    setActiveProfileStored(profileId);
  }, [setActiveProfileStored]);
  const value = useMemo<AppContextValue>(() => ({ city, setCity, fuel, setFuel, activeProfile, setActiveProfile, profiles, pollingInterval, setPollingInterval, refreshKey, refresh: () => setRefreshKey((n) => n + 1) }), [city, setCity, fuel, setFuel, activeProfile, setActiveProfile, profiles, pollingInterval, setPollingInterval, refreshKey]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppContext(): AppContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("useAppContext muss innerhalb von AppProvider verwendet werden");
  return value;
}
