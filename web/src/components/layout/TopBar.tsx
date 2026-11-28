import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { ageLabel } from "../../utils/format";
import type { HealthResponse } from "../../api/types";
import { useAppContext } from "../../state/AppContext";

function cityOptions(health: HealthResponse | null): Array<{ value: string; label: string }> {
  const items = health?.city_options;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = (item as { value?: unknown }).value;
    const label = (item as { label?: unknown }).label;
    return typeof value === "string" ? [{ value, label: typeof label === "string" ? label : value }] : [];
  });
}

export function TopBar({ health, generatedAt, offline, refresh }: { health: HealthResponse | null; generatedAt?: string | null; offline: boolean; refresh: () => void }) {
  const app = useAppContext();
  const [profileError, setProfileError] = useState(false);
  const cities = cityOptions(health);
  return <header className="topbar">
    <a className="mobile-brand" href="/?tab=overview" aria-label="TankApp Übersicht"><span className="brand-mark">T</span>TankApp</a>
    <div className="topbar-controls">
      <label className="sr-only" htmlFor="city-select">Stadt</label>
      <select id="city-select" className="select-control" aria-label="Stadt" value={app.city} onChange={(event) => app.setCity(event.target.value)}>
        <option value="">Alle Städte</option>
        {cities.map((city) => <option key={city.value} value={city.value}>{city.label}</option>)}
      </select>
      <label className="sr-only" htmlFor="fuel-select">Kraftstoff</label>
      <select id="fuel-select" className="select-control" aria-label="Kraftstoff" value={app.fuel} onChange={(event) => app.setFuel(event.target.value as typeof app.fuel)}>
        <option value="e10">E10</option><option value="e5">E5</option><option value="diesel">Diesel</option>
      </select>
    </div>
    <div className="topbar-meta">
      <label className="sr-only" htmlFor="profile-select">Profil</label>
      <select id="profile-select" className="select-control profile-select" aria-label="Profil" value={app.activeProfile} onChange={(event) => { setProfileError(false); void app.setActiveProfile(event.target.value).catch(() => setProfileError(true)); }}>
        <option value="">Profil</option>
        {app.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select>
      {profileError && <span role="alert" className="age-chip">Profil nicht gespeichert</span>}
      <span className="age-chip" title={generatedAt ? `Datenstand ${generatedAt}` : "Kein Datenstand"}>{offline ? "Offline" : generatedAt ? ageLabel(generatedAt) : "—"}</span>
      <button className="icon-button" type="button" onClick={refresh} aria-label="Daten aktualisieren" title="Aktualisieren"><RefreshCw size={16} /></button>
    </div>
  </header>;
}
