import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Pin, RefreshCw, Route } from "lucide-react";
import { api } from "../../api/client";
import type { DecisionResponse, Fuel, Station, StationsResponse } from "../../api/types";
import { useAppContext } from "../../state/AppContext";
import { useOverview } from "../../state/useOverview";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { euroPerLiter, centsPerLiter, euros, kilometers, ageLabel } from "../../utils/format";
import { StationLeafletMap } from "./StationLeafletMap";
import { referenceStationId } from "./logic";

type NearbyAlternative = NonNullable<DecisionResponse["alternatives_nearby"]>[number] & { net_eur?: number; ref_price_fresh?: boolean; price_fresh?: boolean };
const selectedKey = "tankapp.v2.stations.selected";
const pinnedKey = "tankapp.v2.stations.pinned";
const stored = (key: string) => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } };

function queryString(city: string, fuel: Fuel, stationId?: string, liters = 40): string {
  const params = new URLSearchParams({ fuel, liters: String(liters) });
  if (city) params.set("city", city);
  if (stationId) params.set("station_id", stationId);
  return params.toString();
}

export function StationsPage() {
  const { city, fuel, refreshKey, activeProfile, profiles, refresh } = useAppContext();
  const active = profiles.find((profile) => profile.id === activeProfile);
  const liters = active?.liters ?? 40;
  const [payload, setPayload] = useState<StationsResponse | null>(null);
  const [decision, setDecision] = useState<DecisionResponse | null>(null);
  const [selected, setSelected] = useState(stored(selectedKey));
  const [pinned, setPinned] = useState(stored(pinnedKey));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyFresh, setOnlyFresh] = useState(false);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError(null);
    setDecisionError(null);
    setPayload(null);
    setDecision(null);
    const query = queryString(city, fuel);
    void Promise.allSettled([
      api.get<StationsResponse>(`stations?${query}`, controller.signal),
      api.get<DecisionResponse>(`decide?${query}`, controller.signal),
    ]).then(([stationsResult, decisionResult]) => {
      if (controller.signal.aborted) return;
      if (stationsResult.status === "fulfilled") {
        setPayload(stationsResult.value);
      } else {
        setError(stationsResult.reason instanceof Error
          ? stationsResult.reason.message
          : "Stationen konnten nicht geladen werden");
      }
      if (decisionResult.status === "fulfilled") {
        setDecision(decisionResult.value);
      } else {
        setDecisionError("Nettovergleich gerade nicht verfügbar.");
      }
      setBusy(false);
    });
    return () => controller.abort();
  }, [city, fuel, refreshKey]);

  const stations = payload?.stations ?? [];
  const referenceId = referenceStationId(stations, selected, pinned);
  const reference = stations.find((station) => station.station_id === referenceId) ?? null;
  const nearby = useMemo(() => stations.filter((station) => (!onlyFresh || (station.fresh && station.price != null)) && `${station.name} ${station.brand ?? ""}`.toLowerCase().includes(search.toLowerCase())), [stations, onlyFresh, search]);
  const alternatives = (decision?.alternatives_nearby ?? []) as NearbyAlternative[];
  const refMatches = decision?.primary?.station?.id === referenceId;
  const selectedAlternative = alternatives.find((alternative) => alternative.station_id === referenceId);
  const onSelect = useCallback((id: string) => { setSelected(id); try { localStorage.setItem(selectedKey, id); } catch { /* memory only */ } }, []);
  const togglePin = () => { const next = pinned === referenceId ? "" : referenceId; setPinned(next); try { localStorage.setItem(pinnedKey, next); } catch { /* memory only */ } };

  useEffect(() => {
    if (!referenceId) { setDecision(null); setDecisionError(null); return; }
    const controller = new AbortController();
    void api.get<DecisionResponse>(`decide?${queryString(city, fuel, referenceId, liters)}`, controller.signal)
      .then((result) => { setDecision(result); setDecisionError(null); })
      .catch(() => {
        if (!controller.signal.aborted) setDecisionError("Nettovergleich gerade nicht verfügbar.");
      });
    return () => controller.abort();
  }, [referenceId, city, fuel, liters, refreshKey]);

  const first = stations.find((station) => station.station_id === compareA) ?? null;
  const second = stations.find((station) => station.station_id === compareB) ?? null;
  const priceDelta = first?.price != null && second?.price != null ? (second.price - first.price) * 100 : null;
  const advantage = priceDelta == null ? null : (first?.price! - second?.price!) * liters;

  return <div className="stations-page">
    {error && <div className="status-banner" role="alert">{error}</div>}
    {decisionError && <p className="muted-line" role="status">{decisionError}</p>}
    <div className="stations-toolbar"><label className="sr-only" htmlFor="station-search">Station suchen</label><input id="station-search" className="text-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Station suchen" />
      <button type="button" className={`filter-button ${onlyFresh ? "selected" : ""}`} aria-pressed={onlyFresh} onClick={() => setOnlyFresh((value) => !value)}>Nur frische Preise</button>
      <button type="button" className="icon-button" onClick={refresh} aria-label="Stationen aktualisieren"><RefreshCw size={16} /></button>
      <span className="muted-line">{busy ? "Lädt …" : `${nearby.length} Stationen`}</span>
    </div>
    <div className="stations-layout">
      <Card className="station-list-card">
        <div className="section-title"><div><span className="eyebrow">Preis-Atlas</span><h2>Stationen</h2></div><Badge tone={reference?.fresh ? "go" : "neutral"}>Referenz {reference?.name ?? "—"}</Badge></div>
        {nearby.length ? <div className="station-list" role="list">{nearby.map((station) => {
          const alternative = alternatives.find((item) => item.station_id === station.station_id);
          const netAllowed = Boolean(refMatches && alternative?.ref_price_fresh === true && alternative.price_fresh === true && Number.isFinite(alternative.net_eur));
          return <button type="button" key={station.station_id} role="listitem" className={`station-row ${station.station_id === selected ? "chosen" : ""}`} onClick={() => onSelect(station.station_id)}>
            <span className="station-row-main"><strong>{station.name}</strong><small>{station.brand ?? station.city} · {kilometers(station.dist_km)}</small></span>
            <span className="station-row-price"><strong className="numeric">{euroPerLiter(station.price)}</strong><small>{station.fresh ? ageLabel(station.observed_at) : "Preis nicht frisch"}</small></span>
            <span className="station-net">{netAllowed ? <><strong className="numeric">{euros(alternative?.net_eur)}</strong><small>Server-Netto</small></> : <><strong className="numeric">{station.price == null ? euroPerLiter(station.last_price) : "—"}</strong><small>{station.price == null ? "Letzter Preis · Vergleich" : "Preisvergleich"}</small></>}</span>
          </button>;
        })}</div> : <div className="empty-state">{busy ? "Stationen werden geladen …" : "Keine Stationen gefunden."}</div>}
      </Card>
      <div className="stations-side">
        <Card className="station-map-card">
          <div className="section-title"><div><span className="eyebrow">Standorte</span><h2>Karte</h2></div><span className="muted-line">{city || "Alle Städte"}</span></div>
          <StationLeafletMap stations={stations} anchors={payload?.anchors} city={city} selectedId={selected} referenceId={referenceId} onSelect={onSelect} />
          <div className="map-caption">OpenStreetMap · Pins öffnen Stationsdetails; Auswahl wird als Referenz gesetzt.</div>
        </Card>
        <Card className="station-detail-card">
          <div className="section-title"><div><span className="eyebrow">Detail</span><h2>{reference?.name ?? "Station wählen"}</h2></div><button type="button" className="filter-button" onClick={togglePin} disabled={!referenceId}><Pin size={14} />{pinned === referenceId && referenceId ? "Angeheftet" : "Anheften"}</button></div>
          {reference ? <><div className="detail-kpis"><div><small>Preis</small><strong className="numeric">{euroPerLiter(reference.price)}</strong></div><div><small>Entfernung</small><strong className="numeric">{kilometers(reference.dist_km)}</strong></div><div><small>Stand</small><strong>{ageLabel(reference.observed_at)}</strong></div></div>
            <div className="detail-actions">{reference.maps_url && <a className="text-action" href={reference.maps_url} target="_blank" rel="noreferrer"><Route size={14} /> Route</a>}{selectedAlternative?.ref_price_fresh === true && selectedAlternative.price_fresh === true && Number.isFinite(selectedAlternative.net_eur) ? <Badge tone="go">{euros(selectedAlternative.net_eur)} Server-Netto inkl. Umweg</Badge> : <Badge tone="neutral">Reiner Preisvergleich</Badge>}</div>
          </> : <div className="empty-state">Kein Referenzpreis verfügbar.</div>}
        </Card>
        <Card className="compare-card">
          <div className="section-title"><div><span className="eyebrow">Direktvergleich</span><h2>A gegen B</h2></div></div>
          <div className="compare-selects"><label>A<select value={compareA} onChange={(event) => setCompareA(event.target.value)}><option value="">Station wählen</option>{stations.map((station) => <option key={station.station_id} value={station.station_id}>{station.name}</option>)}</select></label><label>B<select value={compareB} onChange={(event) => setCompareB(event.target.value)}><option value="">Station wählen</option>{stations.map((station) => <option key={station.station_id} value={station.station_id}>{station.name}</option>)}</select></label></div>
          <div className="compare-results"><span>Preisdifferenz B−A</span><strong className="numeric">{centsPerLiter(priceDelta)}</strong><span>Vorteil bei {liters} L (vor Umweg)</span><strong className="numeric">{euros(advantage)}</strong><span>Umweg B</span><strong className="numeric">{typeof second?.detour_km === "number" ? kilometers(second.detour_km) : "—"}</strong></div>
        </Card>
      </div>
    </div>
  </div>;
}
