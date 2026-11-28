import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/client";
import { enqueueFill, listOutbox } from "../../api/outbox";
import type {
  FillsResponse,
  FillsSummaryResponse,
  Fuel,
  ProfilesResponse,
  StationsResponse,
  VehicleProfile,
} from "../../api/types";
import { useAppContext } from "../../state/AppContext";
import { Card } from "../../components/ui/Card";
import { euros, euroPerLiter } from "../../utils/format";
import "../feature-pages.css";

const PROFILE_FIELDS: Array<{
  key: "tank_capacity_l" | "consumption" | "liters" | "time_value_eur_h" | "speed_kmh";
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "tank_capacity_l", label: "Tankvolumen (L)", min: 20, max: 120, step: 0.1 },
  { key: "consumption", label: "Verbrauch (L/100 km)", min: 4, max: 15, step: 0.1 },
  { key: "liters", label: "Tankmenge (L)", min: 10, max: 100, step: 0.5 },
  { key: "time_value_eur_h", label: "Zeitwert (€/h; 0 = Automatik)", min: 0, max: 30, step: 0.5 },
  { key: "speed_kmh", label: "Durchschnittstempo (km/h)", min: 25, max: 80, step: 1 },
];

function readTankPercent(): number {
  try {
    const value = Number(localStorage.getItem("tankapp.tank.percent") ?? 50);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
  } catch {
    return 50;
  }
}

function saveTankPercent(value: number): void {
  try {
    localStorage.setItem("tankapp.tank.percent", String(value));
  } catch {
    // The slider remains useful for this session when storage is unavailable.
  }
}

export function SettingsPage() {
  const { fuel, setFuel, activeProfile, setActiveProfile, refresh, refreshKey } = useAppContext();
  const [tab, setTab] = useState<"tank" | "profile" | "fills">("tank");
  const [profiles, setProfiles] = useState<VehicleProfile[]>([]);
  const [fills, setFills] = useState<FillsResponse | null>(null);
  const [summary, setSummary] = useState<FillsSummaryResponse | null>(null);
  const [stations, setStations] = useState<StationsResponse["stations"]>([]);
  const [newProfile, setNewProfile] = useState(false);
  const [draft, setDraft] = useState<Partial<VehicleProfile>>({});
  const [tank, setTank] = useState(readTankPercent);
  const [station, setStation] = useState("");
  const [liters, setLiters] = useState(40);
  const [price, setPrice] = useState("");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const results = await Promise.allSettled([
        api.get<ProfilesResponse>("profiles", controller.signal),
        api.get<FillsResponse>("fills", controller.signal),
        api.get<FillsSummaryResponse>("fills/summary", controller.signal),
        api.get<StationsResponse>(`stations?fuel=${fuel}`, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const problems: string[] = [];
      const [profileResult, fillsResult, summaryResult, stationsResult] = results;
      if (profileResult.status === "fulfilled") {
        setProfiles(profileResult.value.profiles ?? []);
      } else problems.push("Profile");
      if (fillsResult.status === "fulfilled") {
        setFills(fillsResult.value);
      } else problems.push("Belege");
      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value);
      } else problems.push("Bilanz");
      if (stationsResult.status === "fulfilled") {
        setStations(stationsResult.value.stations ?? []);
      } else problems.push("Stationen");
      setLoadError(problems.length ? `${problems.join(", ")} konnten nicht geladen werden.` : null);
    };
    void load();
    return () => controller.abort();
  }, [fuel, refreshKey]);

  const selected = profiles.find((profile) => profile.id === activeProfile);
  const notify = async (operation: () => Promise<unknown>, success = "Gespeichert.") => {
    try {
      const result = await operation();
      setMessage(typeof result === "string" ? result : success);
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speichern fehlgeschlagen");
    }
  };

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    const creating = newProfile || !selected;
    void notify(async () => {
      if (creating) {
        await api.post("profiles", { name: draft.name, fuel: draft.fuel ?? fuel, ...draft });
        setNewProfile(false);
        setDraft({});
      } else {
        await api.put(`profiles/${encodeURIComponent(selected.id)}`, draft);
        if (selected.id === activeProfile && draft.fuel) setFuel(draft.fuel as Fuel);
      }
      return "Profil gespeichert.";
    });
  };

  const saveFill = (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      station_id: station,
      station_name: stations.find((item) => item.station_id === station)?.name,
      liters,
      price_paid: price ? Number(price) : undefined,
      fuel,
      source: "manual",
      tanked_at: new Date().toISOString(),
    };
    void notify(async () => {
      try {
        await api.post("fills", payload);
        return "Beleg gespeichert.";
      } catch (error) {
        const retryableStatus = error instanceof ApiError && [0, 429, 502, 503, 504].includes(error.status);
        if (!navigator.onLine || retryableStatus) {
          await enqueueFill(payload);
          return "Beleg offline vorgemerkt — wird bei Verbindung nachgereicht.";
        }
        throw error;
      }
    }, "Beleg gespeichert.");
  };

  return (
    <div className="feature-stack">
      <div className="segmented" role="tablist" aria-label="Einstellungen">
        {([["tank", "Fahrzeug & Tank"], ["profile", "Profile"], ["fills", "Belege & Bilanz"]] as const).map(([id, name]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "selected" : ""} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </div>
      {loadError && <p role="alert" className="feature-error">{loadError}</p>}
      {message && <p role="status">{message}</p>}

      {tab === "tank" && (
        <Card>
          <h2>Fahrzeug & Tank</h2>
          <label>Tankstand · <span className="numeric">{tank}%</span>
            <input type="range" min="0" max="100" value={tank} onChange={(event) => {
              const value = Number(event.target.value);
              setTank(value);
              saveTankPercent(value);
            }} />
          </label>
          <p className="muted-line">Tankstand wird nur auf diesem Gerät gespeichert.</p>
          <dl className="kv-list">
            <div><dt>Tankvolumen</dt><dd className="numeric">{selected?.tank_capacity_l ?? "—"} L</dd></div>
            <div><dt>Verbrauch</dt><dd className="numeric">{selected?.consumption ?? "—"} L/100 km</dd></div>
            <div><dt>Durchschnittstempo</dt><dd className="numeric">{selected?.speed_kmh ?? "—"} km/h</dd></div>
            <div><dt>Umweg-Modus</dt><dd>{selected?.detour_mode ?? "—"}</dd></div>
          </dl>
          <button type="button" onClick={() => setTab("profile")}>Profil bearbeiten</button>
        </Card>
      )}

      {tab === "profile" && (
        <Card>
          <h2>Profile</h2>
          <label>Aktives Profil
            <select value={activeProfile} onChange={(event) => {
              void notify(() => setActiveProfile(event.target.value));
            }}>
              <option value="">Keins</option>
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => { setNewProfile(true); setDraft({ fuel }); }}>Neues Profil</button>
          <form className="form-grid" onSubmit={saveProfile}>
            <label>Name
              <input required maxLength={40} value={draft.name ?? (newProfile ? "" : selected?.name) ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label>Kraftstoff
              <select value={draft.fuel ?? (newProfile ? fuel : selected?.fuel ?? fuel)} onChange={(event) => setDraft({ ...draft, fuel: event.target.value as Fuel })}>
                <option value="e10">E10</option><option value="e5">E5</option><option value="diesel">Diesel</option>
              </select>
            </label>
            {PROFILE_FIELDS.map((field) => {
              const value = draft[field.key] ?? (newProfile ? undefined : selected?.[field.key]);
              return (
                <label key={field.key}>{field.label}
                  <input
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={value ?? ""}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value ? Number(event.target.value) : undefined })}
                  />
                </label>
              );
            })}
            <label>Umweg-Modus
              <select value={draft.detour_mode ?? (newProfile ? "onroute" : selected?.detour_mode ?? "onroute")} onChange={(event) => setDraft({ ...draft, detour_mode: event.target.value })}>
                <option value="onroute">Station liegt auf dem Weg</option>
                <option value="dedicated">Eigene Fahrt zur Station</option>
              </select>
            </label>
            <button type="submit">{selected && !newProfile ? "Änderungen speichern" : "Profil anlegen"}</button>
            {newProfile && <button type="button" onClick={() => { setNewProfile(false); setDraft({}); }}>Abbrechen</button>}
          </form>
          {selected && !newProfile && (
            <button className="danger-button" type="button" onClick={() => {
              if (window.confirm("Profil wirklich löschen?")) {
                void notify(() => api.delete(`profiles/${encodeURIComponent(selected.id)}`), "Profil gelöscht.");
              }
            }}>Profil löschen</button>
          )}
        </Card>
      )}

      {tab === "fills" && (
        <div className="feature-grid">
          <Card>
            <h2>Bilanz</h2>
            <p className="numeric metric-value">{euros(summary?.overall?.saved_verified_eur ?? null)}</p>
            <p className="muted-line">Verifizierte Ersparnis · {summary?.n_fills_total ?? "—"} Belege</p>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Datum</th><th>Station</th><th>Liter</th><th>Preis</th></tr></thead>
                <tbody>{fills?.fills?.map((fill) => (
                  <tr key={fill.id}>
                    <td>{fill.tanked_at?.slice(0, 10) ?? "—"}</td>
                    <td>{fill.station_name ?? fill.station_id}</td>
                    <td className="numeric">{fill.liters}</td>
                    <td className="numeric">{euroPerLiter(fill.price_paid)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
          <Card>
            <h2>Beleg erfassen</h2>
            <form className="form-grid" onSubmit={saveFill}>
              <label>Station
                <select required value={station} onChange={(event) => setStation(event.target.value)}>
                  <option value="">Station wählen</option>
                  {stations.map((item) => <option key={item.station_id} value={item.station_id}>{item.name}</option>)}
                </select>
              </label>
              <label>Liter
                <input required type="number" min="5" max="100" step="0.1" value={liters} onChange={(event) => setLiters(Number(event.target.value))} />
              </label>
              <label>Gezahlter Preis (€/L)
                <input type="number" min="0.4" max="5" step="0.001" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Live-Preis verwenden" />
              </label>
              <button type="submit">Beleg speichern</button>
            </form>
            <button type="button" onClick={() => void listOutbox().then((entries) => setMessage(`${entries.length} Belege in der Outbox`)).catch(() => setMessage("Outbox konnte nicht gelesen werden"))}>
              Offline-Belege prüfen
            </button>
          </Card>
        </div>
      )}
    </div>
  );
}
