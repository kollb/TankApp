import { useMemo, useState } from "react";
import { ArrowUpRight, Clock3, Fuel, MapPin } from "lucide-react";
import type { DecisionResponse, OverviewResponse, Station } from "../../api/types";
import { euroPerLiter, centsPerLiter, euros, kilometers, clockLabel, ageLabel } from "../../utils/format";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import type { OverviewState } from "../../state/useOverview";
import { getDecisionView, validityLabel } from "./decision";

function StatusBanner({ overview, offline, error }: { overview: OverviewResponse | null; offline: boolean; error: string | null }) {
  const decision = overview?.decide;
  const blocked = decision?.decision_ready === false || decision?.primary?.action === "no_advice";
  const text = offline
    ? `Backend offline — ${error ?? "angezeigte Daten können veraltet sein."}`
    : blocked
      ? decision?.blocking_reasons?.[0] ?? "Modell derzeit ohne belastbare Empfehlung."
      : !decision?.primary
        ? "Keine Prognose verfügbar."
        : null;
  if (!text) return null;
  return <div className="status-banner" role="status" title={text}>{text}</div>;
}

function DecisionCard({ overview, state, offline, stations }: { overview: OverviewState; state: ReturnType<typeof getDecisionView>; offline: boolean; stations: Station[] }) {
  const [whyOpen, setWhyOpen] = useState(false);
  const tone = state.state === "refuel" ? "go" : state.state === "wait" ? "wait" : "neutral";
  const expiry = validityLabel(state.validUntil);
  return <Card tone={tone} className="decision-card">
    <div className="card-kicker"><span>Tankentscheidung</span><Badge tone={tone}>{state.state === "offline" ? "OFFLINE" : state.state === "forecast" ? "KEINE PROGNOSE" : state.state.toUpperCase()}</Badge></div>
    <h2>{state.title}</h2>
    <p className="decision-detail">{state.detail}</p>
    <div className="decision-metric numeric">{euroPerLiter(state.price)}</div>
    <div className="decision-meta">
      <span><MapPin size={14} />{state.stationName ?? "Station —"}</span>
      <span><Clock3 size={14} />{expiry}</span>
    </div>
    <div className="decision-actions">
      {state.mapsUrl ? <a className="primary-action" href={state.mapsUrl} target="_blank" rel="noreferrer">Route <ArrowUpRight size={15} /></a> : <button className="primary-action" type="button" aria-expanded={whyOpen} onClick={() => setWhyOpen((open) => !open)}>Warum?</button>}
      {state.saving != null && <span className="numeric">Erwarteter Vorteil {euros(state.saving)}</span>}
    </div>
    {whyOpen && <p className="decision-why">{overview.overview?.decide?.primary?.reason_short || state.detail}</p>}
    {stations.length === 0 && !offline && <span className="muted-line">Stationsdaten noch nicht verfügbar</span>}
  </Card>;
}

function PriceCurve({ points, median }: { points: Array<{ timestamp: string; price: number | null }>; median: number | null }) {
  const valid = points.map((point, index) => ({ ...point, index })).filter((point): point is typeof point & { price: number } => point.price != null && Number.isFinite(point.price));
  if (!valid.length) return <div className="empty-state">Noch kein Tagesverlauf vorhanden.</div>;
  const min = Math.min(...valid.map((point) => point.price));
  const max = Math.max(...valid.map((point) => point.price));
  const range = max - min || 1;
  const x = (index: number) => 8 + (index / Math.max(1, points.length - 1)) * 984;
  const y = (value: number) => 68 - ((value - min) / range) * 56;
  const segments: string[] = [];
  let open = false;
  points.forEach((point, index) => {
    if (point.price == null || !Number.isFinite(point.price)) { open = false; return; }
    segments.push(`${open ? "L" : "M"}${x(index)},${y(point.price)}`);
    open = true;
  });
  const medianY = median == null ? null : y(median);
  return <svg className="price-curve" viewBox="0 0 1000 76" preserveAspectRatio="none" role="img" aria-label={`Gemessener Tagesverlauf mit ${valid.length} Preiswerten; Tief ${euroPerLiter(min)}, Höchst ${euroPerLiter(max)}`}>
    {medianY != null && <line x1="0" x2="1000" y1={medianY} y2={medianY} stroke="var(--text-muted)" strokeDasharray="4 5" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
    {segments.length > 0 && <path d={segments.join(" ")} fill="none" stroke="var(--accent-wait)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
    {valid.map((point) => <circle key={`${point.timestamp}-${point.index}`} cx={x(point.index)} cy={y(point.price)} r="2.5" fill="var(--accent-wait)"><title>{`${clockLabel(point.timestamp)} — ${euroPerLiter(point.price)}`}</title></circle>)}
  </svg>;
}

function DayCurveCard({ overview }: { overview: OverviewResponse | null }) {
  const points = overview?.day?.points ?? [];
  const valid = points.map((point) => point.price).filter((value): value is number => value != null && Number.isFinite(value));
  const low = valid.length ? Math.min(...valid) : null;
  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted.length ? sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : null;
  const current = [...points].reverse().find((point) => point.price != null)?.price ?? null;
  const count = valid.length;
  return <Card className="day-curve-card">
    <div className="section-title"><div><span className="eyebrow">Heute</span><h2>Tagesverlauf</h2></div><span className="numeric">{count} Messpunkte</span></div>
    {count ? <><PriceCurve points={points} median={median} />
      <div className="chart-legend"><span>Letzter Messwert <b className="numeric">{euroPerLiter(current)}</b></span><span>Tief <b className="numeric">{euroPerLiter(low)}</b></span><span>Median <b className="numeric">{euroPerLiter(median)}</b></span></div>
      <div className="curve-times"><span>{clockLabel(points[0]?.timestamp)}</span><span>{clockLabel(points.at(-1)?.timestamp)}</span></div>
    </> : <div className="empty-state">Noch kein Tagesverlauf vorhanden.</div>}
  </Card>;
}

function TopStationsTable({ stations, decision, navigate }: { stations: Station[]; decision: DecisionResponse | undefined; navigate: (tab: "stationen") => void }) {
  const rows = useMemo(() => stations.filter((station) => station.fresh && station.price != null && Number.isFinite(station.price)).sort((a, b) => a.price! - b.price!).slice(0, 5), [stations]);
  const baseline = rows[0]?.price ?? null;
  return <Card className="top-stations-card">
    <div className="section-title"><div><span className="eyebrow">Live-Preise</span><h2>Günstigste Stationen</h2></div><Fuel size={18} /></div>
    {rows.length ? <div className="table-scroll"><table className="compact-table"><thead><tr><th>Station</th><th>km</th><th>Preis</th><th>Δ</th><th>Netto</th></tr></thead><tbody>{rows.map((station) => {
      const delta = baseline == null ? null : (station.price! - baseline) * 100;
      const offer = decision?.alternatives_nearby.find((item) => item.station_id === station.station_id) as { net_eur?: number; ref_price_fresh?: boolean; price_fresh?: boolean } | undefined;
      const net = offer?.ref_price_fresh === true && offer.price_fresh === true && typeof offer.net_eur === "number" ? euros(offer.net_eur) : "—";
      return <tr key={station.station_id}><td><strong>{station.name}</strong><small>{station.brand ?? station.city}</small></td><td className="numeric">{kilometers(station.dist_km)}</td><td className="numeric">{euroPerLiter(station.price)}</td><td className="numeric">{centsPerLiter(delta)}</td><td className="numeric">{net}</td></tr>;
    })}</tbody></table></div> : <div className="empty-state">Keine frischen Preise.</div>}
    <button className="text-action" type="button" onClick={() => navigate("stationen")}>Alle Stationen ansehen <ArrowUpRight size={14} /></button>
  </Card>;
}

export function OverviewPage({ data, stations, navigate }: { data: OverviewState; stations: Station[]; navigate: (tab: "stationen") => void }) {
  const decision = getDecisionView(data.overview, data.offline, stations);
  const generatedAt = data.overview?.generated_at;
  return <div className="overview-page">
    <StatusBanner overview={data.overview} offline={data.offline} error={data.error} />
    <div className="overview-grid">
      <div className="overview-primary"><DecisionCard overview={data} state={decision} offline={data.offline} stations={stations} /><DayCurveCard overview={data.overview} /></div>
      <div className="overview-secondary"><TopStationsTable stations={stations} decision={data.overview?.decide} navigate={navigate} />
        <Card className="tank-status-card"><div className="section-title"><div><span className="eyebrow">Datenstatus</span><h2>Tank & Aktualität</h2></div></div>
          <div className="stat-pairs"><span>Tankreichweite</span><strong className="numeric">{data.overview?.decide?.tank?.range_km != null && Number.isFinite(data.overview.decide.tank.range_km) ? kilometers(data.overview.decide.tank.range_km) : "—"}</strong><span>Letzter Stand</span><strong>{generatedAt ? ageLabel(generatedAt) : "—"}</strong><span>Frische Preise</span><strong className="numeric">{stations.filter((station) => station.fresh && station.price != null).length || "—"}</strong></div>
        </Card>
      </div>
    </div>
  </div>;
}
