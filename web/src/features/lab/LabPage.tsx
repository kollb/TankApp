import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { AdviceDiaryResponse, ForecastResponse, HeatmapResponse, StatsSummaryResponse, StationsResponse } from "../../api/types";
import { useAppContext } from "../../state/AppContext";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Sparkline } from "../../components/ui/Sparkline";
import { centsPerLiter, euroPerLiter, countLabel } from "../../utils/format";
import { reliabilityBinView } from "./logic";
import "../feature-pages.css";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const label = (v: unknown) => v == null || v === "" ? "—" : String(v);
const metric = (v: unknown, digits = 2) => num(v) == null ? "—" : num(v)!.toLocaleString("de-DE", { maximumFractionDigits: digits });

export function LabPage() {
  const { city, fuel, refreshKey } = useAppContext();
  const [stats, setStats] = useState<StatsSummaryResponse | null>(null);
  const [diary, setDiary] = useState<AdviceDiaryResponse | null>(null);
  const [heat, setHeat] = useState<HeatmapResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [horizon, setHorizon] = useState<"24h" | "3T" | "7T">("24h");
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ fuel }); if (city) query.set("city", city);
    const load = async <T,>(path: string, setter: (v: T | null) => void) => {
      try { setter(await api.get<T>(path, controller.signal)); } catch (e) { if (!controller.signal.aborted) { setter(null); setError(e instanceof Error ? e.message : "Daten nicht verfügbar"); } }
    };
    setError("");
    void load<StatsSummaryResponse>(`stats/summary?${query}`, setStats);
    void load<HeatmapResponse>(`heatmap?${query}&kind=level&weeks=6`, setHeat);
    void load<AdviceDiaryResponse>(`advice/diary?limit=50${outcome ? `&outcome=${outcome}` : ""}`, setDiary);
    return () => controller.abort();
  }, [city, fuel, refreshKey, outcome]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ fuel }); if (city) query.set("city", city);
    api.get<StationsResponse>(`stations?${query}`, controller.signal).then(v => { const station = v.stations?.find(s => s.fresh)?.station_id ?? v.stations?.[0]?.station_id; if (!station) { setForecast(null); return; } query.set("station_id",station); return api.get<ForecastResponse>(`forecast?${query}`, controller.signal).then(setForecast); }).catch(() => { if (!controller.signal.aborted) setForecast(null); });
    return () => controller.abort();
  }, [city, fuel, refreshKey]);
  const backtest = obj(stats?.backtest);
  const live = obj(stats?.live_advice ?? stats?.live ?? stats?.advice);
  const bins = Array.isArray(live.reliability)
    ? live.reliability as Obj[]
    : Array.isArray(live.gate_reliability_bins)
      ? live.gate_reliability_bins as Obj[]
      : [];
  const points = horizon === "3T" ? forecast?.points_3d : horizon === "7T" ? forecast?.points_7d : forecast?.points;
  return <div className="feature-stack">
    {error && <p role="status" className="feature-error">{error}</p>}
    <div className="feature-grid"><Card><h2>Empirische Güte</h2><div className="metric-grid">
      <div><small>Treffer / Tage</small><strong className="numeric">{metric(live.wins ?? backtest.wins, 0)} / {metric(live.n ?? backtest.daysEval, 0)}</strong></div>
      <div><small>Brier-Score</small><strong className="numeric">{metric(live.brier ?? backtest.brier, 3)}</strong></div>
      <div><small>MAE</small><strong className="numeric">{centsPerLiter(num(backtest.mae_ct))}</strong></div>
      <div><small>Stichprobe</small><strong className="numeric">{countLabel(num(live.n_brier ?? backtest.n))}</strong></div>
    </div></Card><Card><h2>Modell-Pipeline</h2><dl className="kv-list">{Object.entries({ Entscheidungsstunde: backtest.decisionHour, Modell: backtest.model, Regime: stats?.regime, Kalibrierung: live.gate_status, Kohorte: live.gate_context_key }).map(([k,v]) => <div key={k}><dt>{k}</dt><dd className="numeric">{label(v)}</dd></div>)}</dl></Card></div>
    <div className="feature-grid"><Card><h2>Kalibrierung</h2>{bins.length ? <div className="bin-chart" role="img" aria-label="Zuverlässigkeits-Bins von null bis eins; Balkenhöhe zeigt die gemessene Trefferquote.">{bins.map((bin,i) => {
      const view = reliabilityBinView(bin, i);
      return <div key={i} title={`${view.range}: Prognose ${metric(view.predicted, 3)}, gemessen ${metric(view.observed, 3)}, n=${countLabel(view.count)}`}><span style={{height: view.observed == null ? "0%" : `${Math.max(2, Math.min(100, view.observed * 100))}%`}} /></div>;
    })}</div> : <p className="muted-line">Keine Kalibrierungs-Bins verfügbar.</p>}</Card>
    <Card><h2>Prognose vs. Ist</h2><div className="segmented">{(["24h","3T","7T"] as const).map(h => <button key={h} className={horizon===h?"selected":""} onClick={() => setHorizon(h)}>{h}</button>)}</div>{points?.length ? <Sparkline values={points.map(p => p.q50)} /> : <p className="muted-line">Für diesen Horizont keine Prognose verfügbar.</p>}<p className="muted-line">Ist-Werte werden nur bei vorhandenen Messungen gezeigt.</p></Card></div>
    <Card><h2>Wochen-Heatmap · {heat?.kind === "level" ? "Preisniveau" : "—"}</h2>{heat?.matrix?.length ? <div className="heat-scroll"><div className="heat-grid" style={{gridTemplateColumns:`80px repeat(${heat.hours.length}, minmax(26px, 1fr))`}}><span />{heat.hours.map(h=><small key={h}>{h}</small>)}{heat.matrix.map((row,i) => <div className="heat-row" style={{display:"contents"}} key={i}><small>{heat.days[i] ?? i}</small>{row.map((v,j)=><span key={j} className="heat-cell" title={`${heat.days[i]} ${heat.hours[j]}:00 · ${euroPerLiter(v)}`} style={{background:v == null ? "var(--surface-2)" : `rgb(61 220 132 / ${Math.max(.12, Math.min(.8, (v-1)*.7))})`}} />)}</div>)}</div></div> : <p className="muted-line">Keine Messwerte verfügbar.</p>}</Card>
    <Card><h2>Prognose-Tagebuch</h2><label>Ergebnis <select value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="">Alle</option>{["win","loss","tie","void"].map(x=><option key={x}>{x}</option>)}</select></label><div className="table-scroll"><table><thead><tr><th>Datum</th><th>Empfehlung</th><th>Prognose</th><th>Ist</th><th>Status</th></tr></thead><tbody>{diary?.entries?.map((entry,i)=><tr key={String(entry.snapshot_id ?? i)}><td className="numeric">{label(entry.settled_at).slice(0,10)}</td><td>{label(entry.action)}</td><td className="numeric">{euroPerLiter(num(entry.price_then))}</td><td className="numeric">{euroPerLiter(num(entry.price_window))}</td><td><Badge tone={entry.outcome === "win" ? "go" : entry.outcome === "loss" ? "risk" : "neutral"}>{label(entry.outcome)}</Badge></td></tr>)}</tbody></table></div>{!diary?.entries?.length && <p className="muted-line">Keine abgerechneten Empfehlungen.</p>}</Card>
    <Card><details><summary>Rechenweg & Parameter</summary><dl className="kv-list">{Object.entries({ TANKAPP_DECISION_HOUR: backtest.decisionHour, law_floor: backtest.law_floor, "δ̂": backtest.delta_hat, Regime: stats?.regime, Modellvertrag: live.gate_context_key }).map(([k,v])=><div key={k}><dt>{k}</dt><dd className="numeric">{label(v)}</dd></div>)}</dl></details></Card>
  </div>;
}
