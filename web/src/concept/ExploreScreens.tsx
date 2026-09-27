import { radius } from "../components/ui";
import { Bell, Check, MapPin, Navigation, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { euroPerLiter } from "../data";
import { stations, fuelOffset, type Fuel, type Level } from "./data";
import { BrandAvatar, Price } from "./ui";
import { routeUrl, usePrototypeState } from "./state";

export function MapScreen({ fuel, level }: { fuel: Fuel; level: Level }) {
  const [selected, setSelected] = useState("jet");
  const station = stations.find(s => s.id === selected)!;
  return <div className="px-4 pt-4">
    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">In deiner Nähe</p><h1 className="text-3xl font-semibold">Karte</h1><p className="mt-2 text-sm text-on-surface-variant">München-Schwabing · {level === "offline" ? "Stand: 14:32 Uhr" : "4 Beispiel-Tankstellen"}</p>
    <div className="relative mt-5 overflow-hidden rounded-3xl border border-outline-variant bg-[#e5eddf]">
      <svg viewBox="0 0 340 340" className="w-full" role="img" aria-label="Schematische Karte von Schwabing, keine maßstabsgetreue Navigation">
        <path d="M230 0H340V340H280L240 220Z" fill="#d1e3c4" /><path d="M298 0Q265 110 317 340" fill="none" stroke="#b9dce6" strokeWidth="15" />
        <g fill="none" stroke="white" strokeWidth="16"><path d="M50 0L110 340" /><path d="M0 95L340 60" /><path d="M0 230L340 185" /><path d="M210 0L195 340" /><path d="M0 310L250 140" /></g>
        <g fill="#737d70" fontSize="9"><text x="100" y="80" transform="rotate(-6 100 80)">Frankfurter Ring</text><text x="16" y="213">Schleißheimer Str.</text><text x="244" y="266">Englischer</text><text x="249" y="279">Garten</text><text x="128" y="306" fontSize="12" fontWeight="600">SCHWABING</text></g>
        <circle cx="144" cy="194" r="15" fill="#006c4c" opacity=".12" /><circle cx="144" cy="194" r="6" fill="#006c4c" stroke="white" strokeWidth="3" />
      </svg>
      {stations.map((s, i) => <button key={s.id} onClick={() => setSelected(s.id)} aria-label={`${s.brand}, ${euroPerLiter(s.base + fuelOffset[fuel])}`} aria-pressed={selected === s.id} style={{ left: `${[52, 22, 15, 60][i]}%`, top: `${[19, 38, 64, 56][i]}%` }} className={`absolute -translate-x-1/2 rounded-full border-2 px-3 py-2 text-xs font-bold shadow-md ${selected === s.id ? "border-white bg-primary text-white" : "border-white bg-white text-on-surface"}`}><Price value={s.base + fuelOffset[fuel]} /></button>)}
      <span className="absolute bottom-2 left-3 text-xs text-on-surface-variant">Schematische Demo-Karte</span>
    </div>
    <section className="mt-4 rounded-3xl bg-sc-lowest p-4 elev-1"><div className="flex items-center gap-3"><BrandAvatar {...station} /><div className="flex-1"><h2 className="font-semibold">{station.brand} · {station.km}</h2><p className="text-xs text-on-surface-variant">{station.street}</p></div><Price value={station.base + fuelOffset[fuel]} className="text-xl font-semibold" /></div><a href={routeUrl(station.street)} target="_blank" rel="noreferrer" className="tap-44 mt-4 flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary p-3 text-sm font-semibold text-white"><Navigation size={16} /> Route in Google Maps öffnen</a><p className="mt-2 text-xs text-on-surface-variant">{level === "offline" ? "Externe Navigation benötigt ggf. eine Verbindung." : "Öffnet einen externen Kartendienst."}</p></section>
    <a href="/?tab=stationen" className="tap-44 mt-4 flex items-center gap-2 py-3 text-sm font-semibold text-primary"><MapPin size={16} /> Echte Tankstellen & Karten öffnen →</a>
  </div>;
}
export function AlarmScreen({ active, setActive, level, fuel }: { active: boolean; setActive: (active: boolean) => void; level: Level; fuel: Fuel }) {
  const [target, setTarget] = useState("1.70");
  const [savedTarget, setSavedTarget] = usePrototypeState("alarm-target", "1.70", (x): x is string => typeof x === "string" && Number(x) >= 0.5 && Number(x) <= 4);
  const valid = Number.isFinite(Number(target)) && Number(target) >= 0.5 && Number(target) <= 4;
  return <div className="space-y-5 px-4 pt-4">
    <header><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">Den Moment nicht verpassen</p><h1 className="text-3xl font-semibold">Alarme</h1><p className="mt-2 text-sm leading-5 text-on-surface-variant">Dein Wunschpreis. Dein Zeitpunkt.</p></header>
    <div className={`${radius.card} bg-tertiary-container p-3 text-xs leading-5 text-on-tertiary-container`}>Demo: Alarme bleiben in diesem Prototyp. Es werden keine Push-Nachrichten versendet. Echte Benachrichtigungen verwaltest du in der Live-App.</div>
    {level === "offline" && <p className={`${radius.card} bg-warn-container p-3 text-sm text-warn`}>Du bist offline. Neue Alarme sind gerade nicht verfügbar.</p>}
    <form onSubmit={e => { e.preventDefault(); if (valid && level !== "offline") { setSavedTarget(target); setActive(true); } }} className="rounded-3xl bg-sc-lowest p-4 elev-1">
      <h2 className="mb-4 flex items-center gap-2 font-semibold"><Bell size={18} className="text-primary" /> Neuer Preisalarm</h2>
      <label htmlFor="alarm-target" className="mb-2 block text-sm">Informiere mich unter (€/L)</label><input id="alarm-target" type="number" min="0.5" max="4" step="0.001" required value={target} onChange={e => setTarget(e.target.value)} className={`w-full ${radius.inset} border border-outline-variant bg-sc-low p-3 text-lg`} />
      <p className="mt-2 text-xs text-on-surface-variant">{fuel} · Umkreis München-Schwabing</p>
      <button disabled={!valid || level === "offline"} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"><Plus size={16} /> Demo-Alarm speichern</button>
    </form>
    {active ? <section className="rounded-3xl border border-primary/30 bg-primary-container/30 p-4" aria-live="polite"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><Check size={16} className="text-primary" /> Demo-Alarm aktiv</h2><button aria-label="Alarm löschen" onClick={() => setActive(false)} className="rounded-full p-3 text-on-surface-variant"><Trash2 size={18} /></button></div><p className="mt-1 text-sm">Wunschpreis unter {euroPerLiter(Number(savedTarget))}</p><p className="mt-2 text-xs text-on-surface-variant">Erinnerung um 19 Uhr · nur zur Vorschau</p></section> : <div className="py-3 text-center text-sm text-on-surface-variant"><Bell className="mx-auto mb-3 text-outline" size={28} />Noch kein Demo-Alarm aktiv.</div>}
    <a href="/?tab=ich" className="tap-44 inline-block py-3 text-sm font-semibold text-primary">Echte Alarme & Tankprofile verwalten →</a>
  </div>;
}
