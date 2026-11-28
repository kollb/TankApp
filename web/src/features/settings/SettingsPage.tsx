import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { enqueueFill, listOutbox } from "../../api/outbox";
import type { FillsResponse, FillsSummaryResponse, ProfilesResponse, StationsResponse, VehicleProfile } from "../../api/types";
import { useAppContext } from "../../state/AppContext";
import { Card } from "../../components/ui/Card";
import { euros, euroPerLiter } from "../../utils/format";
import "../feature-pages.css";

export function SettingsPage() {
  const { fuel, activeProfile, setActiveProfile, refresh, refreshKey } = useAppContext();
  const [tab,setTab] = useState<"tank"|"profile"|"fills">("tank");
  const [profiles,setProfiles] = useState<VehicleProfile[]>([]);
  const [fills,setFills] = useState<FillsResponse | null>(null);
  const [summary,setSummary] = useState<FillsSummaryResponse | null>(null);
  const [stations,setStations] = useState<StationsResponse["stations"]>([]);
  const [newProfile,setNewProfile] = useState(false);
  const [draft,setDraft] = useState<Partial<VehicleProfile>>({});
  const [tank,setTank] = useState(() => { const n = Number(localStorage.getItem("tankapp.tank.percent") ?? 50); return Number.isFinite(n) ? Math.max(0,Math.min(100,n)) : 50; });
  const [station,setStation] = useState("");
  const [liters,setLiters] = useState(40);
  const [price,setPrice] = useState("");
  const [message,setMessage] = useState("");
  useEffect(() => {
    const c = new AbortController();
    api.get<ProfilesResponse>("profiles",c.signal).then(v=>setProfiles(v.profiles ?? [])).catch(()=>{});
    api.get<FillsResponse>("fills",c.signal).then(setFills).catch(()=>{});
    api.get<FillsSummaryResponse>("fills/summary",c.signal).then(setSummary).catch(()=>{});
    api.get<StationsResponse>(`stations?fuel=${fuel}`,c.signal).then(v=>setStations(v.stations ?? [])).catch(()=>{});
    return ()=>c.abort();
  },[fuel,refreshKey]);
  const selected = profiles.find(p=>p.id===activeProfile);
  const notify = async (operation:()=>Promise<unknown>) => { try { await operation(); setMessage("Gespeichert."); refresh(); } catch(e) { setMessage(e instanceof Error ? e.message : "Speichern fehlgeschlagen"); } };
  const saveProfile = (e:FormEvent) => { e.preventDefault(); void notify(()=> selected && !newProfile ? api.put(`profiles/${encodeURIComponent(selected.id)}`,draft) : api.post("profiles",{name:draft.name, fuel, ...draft})); };
  const saveFill = (e:FormEvent) => { e.preventDefault(); const payload = {station_id:station, station_name:stations.find(s=>s.station_id===station)?.name, liters, price_paid:price ? Number(price) : undefined, fuel, source:"manual", tanked_at:new Date().toISOString()}; void notify(async()=>{ try { await api.post("fills",payload); } catch(err) { if (!navigator.onLine || (err instanceof Error && err.message === "Backend nicht erreichbar")) { await enqueueFill(payload); setMessage("Beleg offline gespeichert."); return; } throw err; } }); };
  return <div className="feature-stack"><div className="segmented" role="tablist">{([["tank","Fahrzeug & Tank"],["profile","Profile"],["fills","Belege & Bilanz"]] as const).map(([id,name])=><button key={id} role="tab" aria-selected={tab===id} className={tab===id?"selected":""} onClick={()=>setTab(id)}>{name}</button>)}</div>{message && <p role="status">{message}</p>}
    {tab==="tank" && <Card><h2>Fahrzeug & Tank</h2><label>Tankstand · <span className="numeric">{tank}%</span><input type="range" min="0" max="100" value={tank} onChange={e=>{ const v=Number(e.target.value); setTank(v); localStorage.setItem("tankapp.tank.percent",String(v)); }} /></label><p className="muted-line">Tankstand wird nur auf diesem Gerät gespeichert.</p><dl className="kv-list"><div><dt>Tankvolumen</dt><dd className="numeric">{selected?.tank_capacity_l ?? "—"} L</dd></div><div><dt>Verbrauch</dt><dd className="numeric">{selected?.consumption ?? "—"} L/100 km</dd></div><div><dt>Umweg-Kostenfaktor</dt><dd>{selected?.detour_mode ?? "—"}</dd></div></dl><button onClick={()=>setTab("profile")}>Profil bearbeiten</button></Card>}
    {tab==="profile" && <Card><h2>Profile</h2><label>Aktives Profil <select value={activeProfile} onChange={e=>void notify(()=>setActiveProfile(e.target.value))}><option value="">Keins</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button type="button" onClick={()=>{setNewProfile(true);setDraft({});}}>Neues Profil</button><form className="form-grid" onSubmit={saveProfile}><label>Name<input required maxLength={40} value={draft.name ?? (newProfile ? "" : selected?.name) ?? ""} onChange={e=>setDraft({...draft,name:e.target.value})} /></label>{([["tank_capacity_l","Tankvolumen (L)"],["consumption","Verbrauch (L/100 km)"],["liters","Tankmenge (L)"],["time_value_eur_h","Zeitwert (€/h)"]] as const).map(([key,name])=><label key={key}>{name}<input type="number" min="0" step="0.1" value={draft[key] ?? (newProfile ? "" : selected?.[key]) ?? ""} onChange={e=>setDraft({...draft,[key]:e.target.value ? Number(e.target.value) : undefined})} /></label>)}<label>Umweg<select value={draft.detour_mode ?? (newProfile ? "" : selected?.detour_mode) ?? ""} onChange={e=>setDraft({...draft,detour_mode:e.target.value})}><option value="">Standard</option><option value="fast">Schnell</option><option value="short">Kurz</option></select></label><button type="submit">{selected && !newProfile ? "Änderungen speichern" : "Profil anlegen"}</button></form>{selected && <button className="danger-button" onClick={()=>{ if(window.confirm("Profil wirklich löschen?")) void notify(()=>api.delete(`profiles/${encodeURIComponent(selected.id)}`)); }}>Profil löschen</button>}</Card>}
    {tab==="fills" && <div className="feature-grid"><Card><h2>Bilanz</h2><p className="numeric metric-value">{euros(summary?.overall?.saved_verified_eur ?? null)}</p><p className="muted-line">Verifizierte Ersparnis · {summary?.n_fills_total ?? "—"} Belege</p><div className="table-scroll"><table><thead><tr><th>Datum</th><th>Station</th><th>Liter</th><th>Preis</th></tr></thead><tbody>{fills?.fills?.map(f=><tr key={f.id}><td>{f.tanked_at?.slice(0,10) ?? "—"}</td><td>{f.station_name ?? f.station_id}</td><td className="numeric">{f.liters}</td><td className="numeric">{euroPerLiter(f.price_paid)}</td></tr>)}</tbody></table></div></Card><Card><h2>Beleg erfassen</h2><form className="form-grid" onSubmit={saveFill}><label>Station<select required value={station} onChange={e=>setStation(e.target.value)}><option value="">Station wählen</option>{stations.map(s=><option key={s.station_id} value={s.station_id}>{s.name}</option>)}</select></label><label>Liter<input required type="number" min="5" max="100" step="0.1" value={liters} onChange={e=>setLiters(Number(e.target.value))} /></label><label>Gezahlter Preis (€/L)<input type="number" min="0.4" max="5" step="0.001" value={price} onChange={e=>setPrice(e.target.value)} placeholder="Live-Preis verwenden" /></label><button type="submit">Beleg speichern</button></form><button onClick={()=>void listOutbox().then(v=>setMessage(`${v.length} Belege in der Outbox`))}>Offline-Belege prüfen</button></Card></div>}
  </div>;
}
