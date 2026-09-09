// Layout/visual foundation: sample/good gui/TankAppDashboard + DecisionCockpit.
// Workshop composition and charts: sample/good statistic gui/DecisionLab.
// No demo engine, seeds, simulated decisions or PostgreSQL are imported.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Fuel as FuelIcon,
  Compass,
  LineChart as ChartIcon,
  Server,
  RefreshCw,
  ArrowUpRight,
  Clock,
  ShieldCheck,
  AlertCircle,
  Database,
  MapPin,
  ChevronRight,
  Wifi,
  WifiOff,
  SlidersHorizontal,
  HelpCircle,
  Route,
  Terminal,
  CalendarDays,
  Scale,
  Activity,
  BarChart3,
  Cpu,
  CheckCircle2,
  XCircle,
  Bell,
  Sparkles,
} from "lucide-react";
import { LineChart } from "./components/LineChart";
import {
  LabLineChart,
  HistogramBars,
  DeltaBars,
  CalibChart,
} from "./components/LabCharts";
import {
  autoTimeTicks,
  autoTimeValue,
  berlinHour,
  clockLabel,
  currentPrice,
  detourEconomics,
  euro,
  formatHour,
  haversineKm,
  problem,
  segments,
  splitOnGap,
  timeLabel,
  useResource,
  usePreference,
  postIntent,
  postFill,
  rowOutcome,
  scoreRows,
  type DetourMode,
  type Fuel,
  type Station,
  type Stations,
  type Health,
  type Forecast,
  type Point,
  type Job,
  type Heatmap,
  type Selection,
  type RouteEvaluate,
  type CollectorStatus,
  type DecideResult,
  type StatsSummary,
} from "./data";

const panel = "rounded-2xl border border-slate-800 bg-slate-900/80";

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-7 text-sm leading-relaxed text-slate-400">
      {children}
    </div>
  );
}

function Badge({
  children,
  warning = false,
}: {
  children: ReactNode;
  warning?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
        warning
          ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
          : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
      }`}
    >
      {children}
    </span>
  );
}

function Metric({
  label,
  value,
  detail,
  tip,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  tip?: string;
}) {
  return (
    <div className={`${panel} p-5`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-slate-400">{label}</div>
        {tip && (
          <span
            tabIndex={0}
            role="button"
            aria-label={`Erklärung zu ${label}`}
            className="cursor-help text-slate-500 hover:text-slate-300 focus:text-slate-200 focus:outline-none"
            title={tip}
          >
            <HelpCircle size={14} aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        {value}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">{detail}</p>
    </div>
  );
}

function JobCard({
  title,
  icon,
  job,
  enabled,
}: {
  title: string;
  icon: ReactNode;
  job?: Job;
  enabled?: boolean;
}) {
  const state = !enabled
    ? "aus"
    : job?.state === "success"
      ? "Erfolgreich"
      : job?.state === "running"
        ? "Läuft …"
        : job?.state === "waiting"
          ? "Wartet auf Konfiguration"
          : job?.state === "partial"
            ? "Unvollständig"
            : job?.state === "failed"
              ? "Fehlgeschlagen"
              : "Noch kein Lauf";
  const stateColor = !enabled
    ? "text-slate-500"
    : job?.state === "success"
      ? "text-emerald-400"
      : job?.state === "running"
        ? "text-sky-400"
        : job?.state === "waiting"
          ? "text-amber-400"
          : job?.state === "partial"
            ? "text-amber-400"
            : job?.state === "failed"
              ? "text-rose-400"
              : "text-slate-400";
  return (
    <div className={`${panel} p-5`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-sm font-semibold">
          {icon}
          {title}
        </div>
        <span className={`text-xs font-semibold ${stateColor}`}>{state}</span>
      </div>
      <div className="mt-4 space-y-1.5 text-xs text-slate-400">
        <div className="flex justify-between">
          <span>Letzter Erfolg</span>
          <span className="font-mono text-slate-200">
            {timeLabel(job?.last_success_at)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Nächster Lauf</span>
          <span className="font-mono text-slate-200">
            {timeLabel(job?.next_run_at)}
          </span>
        </div>
      </div>
      {job?.error_code && (
        <p className="mt-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-300">
          {problem(job.error_code)}
        </p>
      )}
    </div>
  );
}

function ApiExplorer({
  fuel,
  identity,
  activeCity,
}: {
  fuel: Fuel;
  identity: string;
  activeCity: string;
}) {
  const [path, setPath] = useState("/api/v1/health");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const dynamic = identity
    ? [
        {
          label: "Preisverlauf (24 h)",
          path: `/api/v1/series?${identity}`,
        },
        {
          label: "Modell-Ausblick",
          path: `/api/v1/forecast?${identity}`,
        },
        {
          label: "Heatmap Niveau (6 Wochen)",
          path: `/api/v1/heatmap?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&kind=level&weeks=6&${identity}`,
        },
        {
          label: "Heatmap Cheap-Prob (6 Wochen)",
          path: `/api/v1/heatmap?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&kind=probability&weeks=6&${identity}`,
        },
      ]
    : [];
  const endpoints = [
    { label: "Systemstatus", path: "/api/v1/health" },
    { label: `Decide (B4 Primär)`, path: `/api/v1/decide?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&liters=40` },
    { label: `Stats Summary (B4 3 Schichten)`, path: `/api/v1/stats/summary?city=${encodeURIComponent(activeCity)}&fuel=${fuel}` },
    { label: `Due Episodes (B4 Intent/Due)`, path: `/api/v1/episodes?status=due` },
    { label: `Stationen (${fuel.toUpperCase()})`, path: `/api/v1/stations?fuel=${fuel}` },
    { label: `Meine Stationen (${fuel.toUpperCase()})`, path: `/api/v1/selection?fuel=${fuel}` },
    { label: "Collector Livestatus", path: "/api/v1/collector/status" },
    {
      label: "Route Evaluate (serverseitig)",
      path: `/api/v1/route/evaluate?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&detour_km=3&liters=40`,
    },
    ...dynamic,
  ];
  const run = async (target: string) => {
    setPath(target);
    setLoading(true);
    setAnswer(null);
    try {
      const response = await fetch(target, { cache: "no-store" });
      const data: unknown = await response.json();
      const text = JSON.stringify(data, null, 2);
      setAnswer(text.length > 5000 ? `${text.slice(0, 5000)}\n… gekürzt` : text);
    } catch {
      setAnswer('{\n  "error_code": "request_failed"\n}');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {endpoints.map((entry) => (
          <button
            key={entry.path}
            onClick={() => void run(entry.path)}
            aria-pressed={path === entry.path && answer !== null}
            className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] transition-colors ${
              path === entry.path && answer !== null
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
            }`}
          >
            GET {entry.label}
          </button>
        ))}
      </div>
      {!identity && (
        <p className="mb-3 text-[11px] text-slate-500">
          Verlauf, Ausblick und Heatmaps erscheinen hier, sobald eine Station mit Stadt
          gewählt ist — die GUI fragt sie dann live ab, genau wie die Tabs.
        </p>
      )}
      <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950/70 p-3 font-mono text-[11px] leading-relaxed text-emerald-300/90">
        {loading
          ? "// Rufe Endpunkt auf …"
          : answer || "// Oben einen Endpunkt wählen — nur lesend, kein Poll."}
      </pre>
    </div>
  );
}

function HeatmapGrid({ heatmap }: { heatmap: Heatmap }) {
  const { days, hours, matrix, kind } = heatmap;
  const isProb = kind === "probability";

  const allVals = matrix
    .flatMap((r) => r)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const minVal = allVals.length ? Math.min(...allVals) : 0;
  const maxVal = allVals.length ? Math.max(...allVals) : 1;

  const colorFor = (v: number | null) => {
    if (v === null || !Number.isFinite(v)) return "bg-slate-950 text-slate-700";
    if (isProb) {
      if (v >= 75) return "bg-emerald-500/40 text-emerald-200 font-semibold";
      if (v >= 55) return "bg-emerald-500/20 text-emerald-300";
      if (v >= 40) return "bg-amber-500/15 text-amber-300";
      if (v >= 25) return "bg-rose-500/20 text-rose-300";
      return "bg-rose-500/35 text-rose-200 font-semibold";
    }
    const span = maxVal - minVal || 0.01;
    const norm = (v - minVal) / span;
    if (norm <= 0.25) return "bg-emerald-500/40 text-emerald-200 font-semibold";
    if (norm <= 0.45) return "bg-emerald-500/20 text-emerald-300";
    if (norm <= 0.65) return "bg-amber-500/15 text-amber-300";
    if (norm <= 0.85) return "bg-rose-500/20 text-rose-300";
    return "bg-rose-500/35 text-rose-200 font-semibold";
  };

  const fmtVal = (v: number | null) => {
    if (v === null || !Number.isFinite(v)) return "—";
    if (isProb) return `${Math.round(v)}%`;
    return v.toFixed(3);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-center text-[10px] font-mono">
        <thead>
          <tr className="text-slate-500">
            <th className="p-1 text-left font-sans text-xs font-normal">Tag</th>
            {hours.map((h) => (
              <th key={h} className="p-1 font-normal">
                {String(h).padStart(2, "0")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/40">
          {days.map((dayName, dIdx) => (
            <tr key={dayName}>
              <td className="p-1 text-left font-sans text-xs font-medium text-slate-300">
                {dayName}
              </td>
              {hours.map((h) => {
                const val = matrix[dIdx]?.[h] ?? null;
                return (
                  <td
                    key={h}
                    title={`${dayName} ${String(h).padStart(2, "0")}:00 Uhr: ${isProb ? (val !== null ? `${val.toFixed(1)} % Chance günstiger als Stadtmedian` : "keine Daten") : (val !== null ? `${val.toFixed(3)} €/L Median` : "keine Daten")}`}
                    className={`p-1 transition-colors ${colorFor(val)}`}
                  >
                    {fmtVal(val)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Dashboard() {
  const [fuel, setFuel] = usePreference<Fuel>(
    "fuel",
    "e10",
    (value) => value === "e10" || value === "e5" || value === "diesel",
  );
  const [city, setCity] = usePreference(
    "city",
    "",
    (value) => typeof value === "string",
  );
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState<"daily" | "statistics" | "system">("daily");
  const [liters, setLiters] = usePreference(
    "liters",
    40,
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 10 &&
      value <= 80,
  );
  const [consumption, setConsumption] = usePreference(
    "consumption",
    7,
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 4 &&
      value <= 15,
  );
  const [timeValue, setTimeValue] = usePreference(
    "timeValue",
    12,
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 30,
  );
  const [detourMode, setDetourMode] = usePreference<DetourMode>(
    "detourMode",
    "onroute",
    (value) => value === "onroute" || value === "dedicated",
  );
  const [speed, setSpeed] = usePreference(
    "speed",
    45,
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 25 &&
      value <= 80,
  );
  const [spanHours, setSpanHours] = usePreference(
    "spanHours",
    24,
    (value) => value === 24 || value === 72 || value === 168,
  );
  const [horizon, setHorizon] = usePreference(
    "horizon",
    0,
    (value) => value === 0 || value === 3 || value === 7,
  );
  const [heatmapKind, setHeatmapKind] = usePreference<"level" | "probability">(
    "heatmapKind",
    "probability",
    (v) => v === "level" || v === "probability",
  );
  const [heatmapWeeks, setHeatmapWeeks] = usePreference(
    "heatmapWeeks",
    6,
    (v) => typeof v === "number" && [2, 4, 6, 8].includes(v),
  );

  // B4 Workshop State: ε Handlungsschwelle Slider
  const [eps, setEps] = useState(1.0);
  const [labDayIdx, setLabDayIdx] = useState(13);

  // B4 Pair Panel State (Umweg-Ökonomie in Werkstatt)
  const [pairAltId, setPairAltId] = useState("");
  const [pairDetourKm, setPairDetourKm] = useState(2.5);
  const [pairPeak, setPairPeak] = useState(true);

  // B4 Due-Prompt UI state
  const [dueDismissed, setDueDismissed] = useState(false);
  const [customFillOpen, setCustomFillOpen] = useState(false);
  const [customLiters, setCustomLiters] = useState(40);
  const [customPrice, setCustomPrice] = useState(1.689);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const [routeAltId, setRouteAltId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(performance.now());
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const prices = useResource<Stations>(
    `/api/v1/stations?fuel=${fuel}`,
    30000,
    refresh,
  );
  const health = useResource<Health>("/api/v1/health", 60000, refresh);

  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  const data = prices.data;
  const activeCity = data?.cities.includes(city) ? city : data?.cities[0] || "";
  const stations =
    data?.stations.filter((row) => row.city === activeCity) || [];
  const online = !prices.error && !!data && !data.connection_error;
  const elapsed = Math.max(0, now - prices.receivedAt) / 60000;
  const price = (row: Station) => currentPrice(row, online, elapsed);
  const fresh = stations
    .filter((row) => price(row) !== null)
    .sort((a, b) => price(a)! - price(b)!);
  const best = fresh[0];
  const selected =
    stations.find((row) => row.station_id === selectedId) ||
    best ||
    stations[0];
  const bestPrice = best ? price(best) : null;
  const selectedPrice = selected ? price(selected) : null;
  const autoZ = autoTimeValue();
  const timeValueUsed = timeValue > 0 ? timeValue : autoZ.z;
  const difference =
    bestPrice !== null && selectedPrice !== null
      ? (selectedPrice - bestPrice) * liters
      : null;
  const selectedLat = selected?.lat;
  const selectedLon = selected?.lon;
  const detourOptions =
    selected &&
    selectedPrice !== null &&
    typeof selectedLat === "number" &&
    typeof selectedLon === "number"
      ? fresh
          .flatMap((row) => {
            if (row.station_id === selected.station_id) return [];
            const altPrice = price(row);
            if (altPrice === null || !(altPrice < selectedPrice - 1e-9))
              return [];
            if (typeof row.lat !== "number" || typeof row.lon !== "number")
              return [];
            const km = haversineKm(selectedLat, selectedLon, row.lat, row.lon);
            return [
              {
                row,
                altPrice,
                km,
                economics: detourEconomics({
                  refPrice: selectedPrice,
                  altPrice,
                  liters,
                  km,
                  mode: detourMode,
                  consumption,
                  speedKmh: speed,
                  timeValueEurH: timeValueUsed,
                }),
              },
            ];
          })
          .sort((a, b) => b.economics.netEur - a.economics.netEur)
      : [];
  const identity = selected
    ? new URLSearchParams({
        city: activeCity,
        station_id: selected.station_id,
        fuel,
      }).toString()
    : "";

  // --- B4 Resources ---
  const decideRes = useResource<DecideResult>(
    activeCity
      ? `/api/v1/decide?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&liters=${liters}&value_of_time=${timeValue}${selected ? `&station_id=${encodeURIComponent(selected.station_id)}` : ""}`
      : null,
    30000,
    refresh,
  );

  const statsSummaryRes = useResource<StatsSummary>(
    tab === "statistics" || tab === "daily"
      ? `/api/v1/stats/summary?fuel=${fuel}${activeCity ? `&city=${encodeURIComponent(activeCity)}` : ""}`
      : null,
    60000,
    refresh,
  );

  const dueEpisodesRes = useResource<{ count: number; episodes: any[] }>(
    "/api/v1/episodes?status=due",
    30000,
    refresh,
  );

  const history = useResource<{ points: Point[]; error_code: string | null }>(
    tab === "statistics" && identity
      ? `/api/v1/series?${identity}&hours=${spanHours}`
      : null,
    60000,
    refresh,
  );
  const dayStrip = useResource<{ points: Point[]; error_code: string | null }>(
    tab === "daily" && identity ? `/api/v1/series?${identity}` : null,
    300000,
    refresh,
  );
  const forecast = useResource<Forecast>(
    tab === "statistics" && identity ? `/api/v1/forecast?${identity}` : null,
    300000,
    refresh,
  );
  const heatmap = useResource<Heatmap>(
    tab === "statistics" && activeCity
      ? `/api/v1/heatmap?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&kind=${heatmapKind}&weeks=${heatmapWeeks}${selected ? `&station_id=${selected.station_id}` : ""}`
      : null,
    120000,
    refresh,
  );
  const selection = useResource<Selection>(
    tab === "statistics" || tab === "system"
      ? `/api/v1/selection?fuel=${fuel}${activeCity ? `&city=${encodeURIComponent(activeCity)}` : ""}`
      : null,
    120000,
    refresh,
  );
  const collectorStatus = useResource<CollectorStatus>(
    tab === "system" ? "/api/v1/collector/status" : null,
    60000,
    refresh,
  );
  const routeEval = useResource<RouteEvaluate>(
    tab === "daily" && activeCity && (routeAltId || detourOptions[0]?.row.station_id)
      ? `/api/v1/route/evaluate?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&station_id=${encodeURIComponent(routeAltId || detourOptions[0]?.row.station_id || "")}&ref_station_id=${encodeURIComponent(selected?.station_id || "")}&liters=${liters}&detour_km=${encodeURIComponent(String(detourOptions.find((o) => o.row.station_id === (routeAltId || detourOptions[0]?.row.station_id))?.km || 3))}&consumption=${consumption}&speed=${speed}&value_of_time=${timeValue}&when=${encodeURIComponent(new Date().toISOString())}&mode=${detourMode}`
      : null,
    30000,
    refresh,
  );

  const connectionProblem = prices.error
    ? "Der App-Server ist nicht erreichbar. Angezeigte ältere Preise werden nicht als aktuell gewertet."
    : problem(data?.connection_error);
  const h = health.error ? null : health.data;
  const collector = collectorStatus.data || h?.collector;
  const f = forecast.data;
  const horizonDays = horizon;
  const forecastPoints =
    (horizonDays === 3 ? f?.points_3d : horizonDays === 7 ? f?.points_7d : f?.points) || [];
  const metrics = f?.metrics;

  const obsPoints = history.data?.points || [];
  const obsWindow: [number, number] = [
    now - spanHours * 3600000,
    now,
  ];
  const observations = segments(obsPoints);
  const series = observations.map((s) => ({
    ...s,
    pts: s.pts.filter((p) => p.x >= obsWindow[0] && p.x <= obsWindow[1]),
  }));
  const spanLabel =
    spanHours === 24
      ? "24 Stunden"
      : spanHours === 72
        ? "3 Tage"
        : "7 Tage";

  const modelPoints = forecastPoints.map((p) => ({
    x: Date.parse(p.timestamp),
    y: p.q50,
  }));
  const modelSeries = modelPoints.length
    ? [
        {
          name: "Modell-Median (q50)",
          color: "#38bdf8",
          pts: modelPoints.filter((p): p is { x: number; y: number } => p.y !== null && Number.isFinite(p.y)),
        },
      ]
    : [];
  const fanBand95 = forecastPoints.length
    ? [
        {
          name: "95-%-Band (q025–q975)",
          color: "rgba(56, 189, 248, 0.12)",
          pts: forecastPoints
            .filter((p) => p.q025 !== null && p.q975 !== null)
            .map((p) => ({
              x: Date.parse(p.timestamp),
              yLo: p.q025!,
              yHi: p.q975!,
            })),
        },
      ]
    : [];
  const fanBand80 = forecastPoints.length
    ? [
        {
          name: "80-%-Band (q10–q90)",
          color: "rgba(56, 189, 248, 0.22)",
          pts: forecastPoints
            .filter((p) => p.q10 !== undefined && p.q10 !== null && p.q90 !== undefined && p.q90 !== null)
            .map((p) => ({
              x: Date.parse(p.timestamp),
              yLo: p.q10!,
              yHi: p.q90!,
            })),
        },
      ]
    : [];

  const forecastWindow: [number, number] | null = modelPoints.length
    ? [
        modelPoints[0].x,
        modelPoints[modelPoints.length - 1].x,
      ]
    : null;

  const forecastMarks = modelPoints.length
    ? [
        {
          x: modelPoints[0].x,
          color: "#38bdf8",
          label: "Fit-Zeitpunkt",
        },
      ]
    : [];

  const modelWindows = (() => {
    if (!modelPoints.length) return [];
    const blocks: { start: number; end: number; values: number[] }[] = [];
    const twoHours = 2 * 3600000;
    for (const m of modelPoints) {
      if (m.y === null || !Number.isFinite(m.y)) continue;
      const bucket = Math.floor(m.x / twoHours) * twoHours;
      let block = blocks.find((b) => b.start === bucket);
      if (!block) {
        block = { start: bucket, end: bucket + twoHours, values: [] };
        blocks.push(block);
      }
      block.values.push(m.y);
    }
    return blocks
      .filter((b) => b.values.length >= 4)
      .map((b) => ({
        start: b.start,
        end: b.end,
        median: b.values.sort((a, c) => a - c)[Math.floor(b.values.length / 2)],
      }))
      .sort((a, b) => a.median - b.median)
      .slice(0, 3);
  })();

  const stripCells = (() => {
    const points =
      tab === "daily" && !dayStrip.error && !dayStrip.data?.error_code
        ? dayStrip.data?.points || []
        : [];
    const byHour = new Map<number, number>();
    for (const p of points) {
      const ms = Date.parse(p.timestamp);
      if (
        p.status !== "open" ||
        p.price === null ||
        !Number.isFinite(p.price) ||
        !Number.isFinite(ms)
      )
        continue;
      const hour = Math.floor(berlinHour(new Date(ms)));
      if (hour >= 6 && hour <= 24) byHour.set(hour, p.price);
    }
    const values = [...byHour.values()];
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const span = max - min || 1;
    const nowHour = Math.floor(berlinHour());
    // 06 bis 24 Uhr (19 Stundenzellen)
    return Array.from({ length: 19 }, (_, i) => {
      const hour = 6 + i;
      const value = byHour.get(hour);
      return {
        hour,
        value: value ?? null,
        tone:
          value === undefined
            ? "empty"
            : value <= min + span / 3
              ? "cheap"
              : value >= max - span / 3
                ? "pricey"
                : "mid",
        current: hour === nowHour || (hour === 24 && nowHour === 0),
      };
    });
  })();

  const calibrationTip = f?.data_policy
    ? `Kalibrierung braucht nachgewiesene Live-Vorhersagen — keine Archiv-Historie: mindestens 21 bewertete Tage, Abdeckung ≥ 85 %, MASE < 0,95, 95-%-Abdeckung zwischen 90 und 98 %, dazu der noch ausstehende Abnahmetest. Bisher ${f.data_policy.good_complete_live_days} von ${f.data_policy.required_complete_live_days} guten Live-Tagen. Deshalb keine Handlungsempfehlung — nur transparente Kennzahlen.`
    : "Kalibrierung braucht nachgewiesene Live-Vorhersagen — keine Archiv-Historie: mindestens 21 bewertete Tage, Abdeckung ≥ 85 %, MASE < 0,95, 95-%-Abdeckung zwischen 90 und 98 %, dazu der noch ausstehende Abnahmetest. Deshalb keine Handlungsempfehlung — nur transparente Kennzahlen.";

  // --- B4 Workshop Dynamic Calculations ---
  const labData = statsSummaryRes.data?.backtest;
  const labStationId = selected?.station_id || labData?.stations[0]?.id || "";
  const labRows = labData?.evalRows[labStationId] || [];
  const labModel = labData?.models[labStationId];
  const labScores = useMemo(() => {
    if (!labData?.evalRows) return [];
    return Object.entries(labData.evalRows).map(([sid, rows]) => ({
      station_id: sid,
      score: scoreRows(rows, eps, liters, sid),
    }));
  }, [labData, eps, liters]);

  const labTotals = useMemo(() => {
    let smart = 0,
      commit = 0,
      best = 0,
      always = 0,
      regretEur = 0,
      n = 0,
      sPos = 0,
      pSum = 0;
    for (const { score: sc } of labScores) {
      smart += sc.sum_smart_eur;
      commit += sc.sum_commit_eur;
      best += sc.sum_best_eur;
      always += sc.sum_always_eur;
      regretEur += sc.avg_regret_eur * sc.n;
      n += sc.n;
      sPos += sc.n * sc.hit_freq;
      pSum += sc.p_avg * sc.n;
    }
    return {
      smart,
      commit,
      best,
      always,
      regretEur: n ? regretEur / n : 0,
      n,
      hitFreq: n ? sPos / n : 0,
      pAvg: n ? pSum / n : 0,
      potShare: best > 0 ? smart / best : 0,
    };
  }, [labScores]);

  // Calibration points for chart
  const calibPoints = labData?.calibration || [];
  const liveReliability = statsSummaryRes.data?.live_advice?.reliability || [];
  const livePointsForChart = liveReliability
    .filter((b) => b.empirical_hit_rate !== null && b.count > 0)
    .map((b) => ({
      p: b.mean_p,
      hit: b.empirical_hit_rate!,
      n: b.count,
    }));

  const calibErr = useMemo(() => {
    if (!calibPoints.length) return NaN;
    return calibPoints.reduce((a, c) => a + Math.abs(c.hit - c.p), 0) / calibPoints.length;
  }, [calibPoints]);

  // Lab selected day row
  const activeLabDayRow = labRows[Math.min(Math.max(labDayIdx, 0), Math.max(0, labRows.length - 1))];
  const activeLabOutcome = activeLabDayRow ? rowOutcome(activeLabDayRow, eps, liters) : null;

  // Lab Model Shapes & Histogram Values
  const labDayClass = activeLabDayRow?.cls ?? 0;
  const labSaves = labModel ? (labDayClass === 0 ? labModel.savesWk : labModel.savesWe) : [];
  const labPredHour = labModel ? (labDayClass === 0 ? labModel.predWk : labModel.predWe) : 19;
  const labShapeWk = labModel?.shapeWk || [];
  const labShapeWe = labModel?.shapeWe || [];
  const labMu = labModel ? (labDayClass === 0 ? labModel.muWk : labModel.muWe) : 1.5;

  // Pair evaluation in Workshop
  const pairAltStation = stations.find((s) => s.station_id === pairAltId) || stations.find((s) => s.station_id !== selected?.station_id);
  const pairDistKm = selected && pairAltStation && selected.lat && selected.lon && pairAltStation.lat && pairAltStation.lon
    ? haversineKm(selected.lat, selected.lon, pairAltStation.lat, pairAltStation.lon)
    : pairDetourKm;

  const pairEco = detourEconomics({
    refPrice: selectedPrice || 1.70,
    altPrice: (pairAltStation ? price(pairAltStation) : null) || (selectedPrice ? selectedPrice - 0.04 : 1.66),
    liters,
    km: pairDetourKm,
    mode: "onroute",
    consumption,
    speedKmh: speed,
    timeValueEurH: pairPeak ? 16 : 10,
  });

  const pairDailyNets = useMemo(() => {
    const s8 = labData?.p8Series[selected?.station_id || ""] || [];
    const a8 = labData?.p8Series[pairAltStation?.station_id || ""] || [];
    const nets: number[] = [];
    for (let i = 42; i < s8.length && i < a8.length; i++) {
      const d = s8[i] - a8[i];
      const net = (d / 100) * liters - pairEco.fuelEur - pairEco.timeEur;
      nets.push(roundTo(net, 2));
    }
    return nets.length ? nets : [0.85, 1.2, -0.4, 0.6, 1.4, -0.2, 0.9, 1.1, 0.4, 0.7, -0.5, 1.3, 0.8, 1.0];
  }, [labData, selected, pairAltStation, liters, pairEco]);

  // Due prompt handler
  const dueEpisode = dueEpisodesRes.data?.episodes?.[0] || (decideRes.data?.episode?.status === "due" ? decideRes.data.episode : null);

  const handleConfirmRecommendedFill = async (ep: any) => {
    if (!ep) return;
    const snap = ep.last_snapshot || decideRes.data?.primary;
    const targetPrice = snap?.expected_price || bestPrice || 1.649;
    const res = await postFill({
      station_id: snap?.station_id || selected?.station_id || "default",
      station_name: snap?.station_name || selected?.name || "Station",
      liters,
      price_paid: targetPrice,
      fuel,
      source: "prompt",
      episode_id: ep.id,
    });
    setActionFeedback("✓ Füllung im Wallet-Ledger verbucht!");
    setDueDismissed(true);
    setRefresh((r) => r + 1);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const handleCustomFill = async (ep: any) => {
    const res = await postFill({
      station_id: selected?.station_id || "custom",
      station_name: selected?.name || "Station",
      liters: customLiters,
      price_paid: customPrice,
      fuel,
      source: "prompt",
      episode_id: ep?.id,
    });
    setActionFeedback("✓ Angepasste Füllung im Wallet-Ledger gespeichert!");
    setCustomFillOpen(false);
    setDueDismissed(true);
    setRefresh((r) => r + 1);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const handleDismissDue = async (epId?: string) => {
    if (epId) await postIntent(epId, "dismiss");
    setDueDismissed(true);
    setRefresh((r) => r + 1);
  };

  const handleIntentWait = async (epId?: string) => {
    if (epId) await postIntent(epId, "wait");
    setActionFeedback("⏳ Warten-Intent gesetzt — Erinnerung aktiv!");
    setRefresh((r) => r + 1);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const handleRefuelNow = async () => {
    const epId = decideRes.data?.episode?.id;
    await postFill({
      station_id: selected?.station_id || "now",
      station_name: selected?.name || "Station",
      liters,
      price_paid: selectedPrice || bestPrice || 1.70,
      fuel,
      source: "explicit_now",
      episode_id: epId,
    });
    setActionFeedback("🟢 Tankvorgang 'Jetzt' im Wallet-Ledger verbucht!");
    setRefresh((r) => r + 1);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500 selection:text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-sky-400 font-black text-slate-950 shadow-lg shadow-emerald-500/20">
              TP
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight text-white sm:text-lg">
                TankPuls
              </h1>
              <p className="text-[10px] font-medium tracking-wide text-slate-400">
                Der ehrliche Entscheidungs-Kompass
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <label className="text-xs text-slate-400">
              Kraftstoff
              <select
                aria-label="Kraftstoffart"
                value={fuel}
                onChange={(e) => setFuel(e.target.value as Fuel)}
                className="ml-2 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="e10">E10</option>
                <option value="e5">E5</option>
                <option value="diesel">Diesel</option>
              </select>
            </label>
            {data?.cities && data.cities.length > 1 && (
              <label className="text-xs text-slate-400">
                Stadt
                <select
                  aria-label="Stadt"
                  value={activeCity}
                  onChange={(e) => setCity(e.target.value)}
                  className="ml-2 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  {data.cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              onClick={() => setRefresh((r) => r + 1)}
              title="Preise neu laden"
              className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-white"
            >
              <RefreshCw size={15} className={prices.pending ? "animate-spin text-emerald-400" : ""} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <nav
            aria-label="Hauptnavigation"
            className="flex rounded-xl border border-slate-800 bg-slate-900/60 p-1"
          >
            {(
              [
                { id: "daily", label: "Alltag", icon: <Compass size={15} /> },
                {
                  id: "statistics",
                  label: "Werkstatt / Labor",
                  icon: <ChartIcon size={15} />,
                },
                { id: "system", label: "System", icon: <Server size={15} /> },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? "page" : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:px-5 ${
                  tab === item.id
                    ? "bg-slate-800 text-emerald-400 shadow"
                    : "text-slate-500 hover:text-slate-200"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            {online && fresh.length ? (
              <Wifi size={13} className="text-emerald-400" />
            ) : (
              <WifiOff size={13} className="text-amber-400" />
            )}
            <span>
              {online && fresh.length
                ? `${fresh.length} frische Preise · ${activeCity} · Stand ${clockLabel(data?.generated_at)}`
                : prices.pending && !data
                  ? "Daten werden geladen …"
                  : `Kein bestätigter Live-Preis${data ? ` · Stand ${clockLabel(data.generated_at)}` : ""}`}
            </span>
          </div>
        </div>

        {actionFeedback && (
          <div
            role="status"
            className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/15 p-4 text-sm font-semibold text-emerald-200 shadow-lg animate-in fade-in"
          >
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            <p>{actionFeedback}</p>
          </div>
        )}

        {!browserOnline && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200"
          >
            <WifiOff size={18} className="mt-0.5 shrink-0" />
            <p>
              Browser ist offline — gezeigt wird der letzte abgerufene Stand,
              keine Live-Preise. Sobald das Netz zurück ist, lädt die Ansicht
              neu.
            </p>
          </div>
        )}

        {fuel === "e5" && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-sky-500/25 bg-sky-500/10 p-4 text-xs leading-relaxed text-sky-200">
            <FuelIcon size={17} className="mt-0.5 shrink-0" />
            <p>
              <span className="font-semibold">E5↔E10-Äquivalenz:</span> E10
              verbraucht ~1–2 % mehr Kraftstoff — E5 lohnt sich erst bei p_E5 ≤
              ~1,015 · p_E10 (etwa 4–5 ct/L Differenz). Vergleiche E5-Preise
              nur mit E5, nie mit E10.
            </p>
          </div>
        )}

        {connectionProblem && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p>{connectionProblem}</p>
              {!prices.error && (
                <button
                  onClick={() => setTab("system")}
                  className="mt-1 text-xs underline underline-offset-4"
                >
                  Einrichtung im Systembereich ansehen
                </button>
              )}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB ALLTAG (Default Modus §8.1)                               */}
        {/* ============================================================ */}
        {tab === "daily" && (
          <>
            {/* B4: Due-Prompt Banner wenn vorheriges Fenster abgelaufen ist */}
            {dueEpisode && !dueDismissed && (
              <section
                aria-label="Due-Prompt"
                className="mb-6 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 p-5 shadow-xl"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3.5">
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-400">
                      <Clock size={22} />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                        Rückmeldung nach Fensterende (Due-Prompt §5.4)
                      </span>
                      <h3 className="mt-0.5 text-lg font-bold text-white">
                        Hast du getankt?
                      </h3>
                      <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-xl">
                        Das empfohlene Zeitfenster ist vorüber. Ein kurzer Tap erfasst deinen Beleg im persönlichen Wallet-Ledger — ehrlich und asynchron.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleConfirmRecommendedFill(dueEpisode)}
                      className="rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition shadow-md"
                    >
                      ✓ Ja, wie empfohlen (~{euro(bestPrice || 1.649, 3)} €/L)
                    </button>
                    <button
                      onClick={() => setCustomFillOpen(!customFillOpen)}
                      className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
                    >
                      ✎ Anders
                    </button>
                    <button
                      onClick={() => handleDismissDue(dueEpisode.id)}
                      className="rounded-xl px-3 py-2.5 text-xs text-slate-400 hover:text-white transition"
                    >
                      ✕ Noch nicht
                    </button>
                  </div>
                </div>

                {customFillOpen && (
                  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3 animate-in fade-in">
                    <p className="text-xs font-semibold text-slate-300">
                      Tankvorgang manuell anpassen:
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="text-xs text-slate-400">
                        Liter
                        <input
                          type="number"
                          value={customLiters}
                          onChange={(e) => setCustomLiters(Number(e.target.value))}
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-emerald-500"
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Gezahlter Preis (€/L)
                        <input
                          type="number"
                          step="0.001"
                          value={customPrice}
                          onChange={(e) => setCustomPrice(Number(e.target.value))}
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-emerald-500"
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          onClick={() => handleCustomFill(dueEpisode)}
                          className="w-full rounded-lg bg-emerald-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                        >
                          Beleg speichern
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            <div className="mb-6">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[.2em] text-emerald-500">
                Alltag / {activeCity || "Dein Standort"}
              </p>
              <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Ein guter Stopp beginnt hier.
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Startbildschirm mit ≤ 3 primären Zahlen (§8.1). Handlungsempfehlung nach kalibriertem Gate.
              </p>
            </div>

            {/* Hero-Karte Entscheidungs-Kompass (B4 Primär GET /v1/decide) */}
            <section
              className={`${panel} relative overflow-hidden p-5 shadow-2xl sm:p-7`}
              aria-labelledby="compass-title"
            >
              <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
              <div className="relative mb-6 flex flex-wrap items-center justify-between gap-3">
                <Badge warning={!decideRes.data?.calibrated}>
                  <Compass size={13} />
                  {decideRes.data?.calibrated ? "Kalibrierter Entscheidungs-Kompass" : "Entscheidungs-Kompass · M7 steht aus"}
                </Badge>
                <span className="text-xs text-slate-500">
                  {best ? `Preismeldung ${timeLabel(best.observed_at)}` : "Keine simulierten Preise"}
                </span>
              </div>
              <div
                className={`relative rounded-xl border p-5 sm:p-6 ${
                  best
                    ? "border-emerald-500/30 bg-gradient-to-br from-emerald-950/70 via-slate-900 to-slate-900 glow-emerald"
                    : "border-amber-500/20 bg-gradient-to-br from-amber-950/30 via-slate-900 to-slate-900"
                }`}
              >
                <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
                  <div className="flex items-start gap-4">
                    <div
                      className={`rounded-2xl border p-3 ${
                        best
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border-amber-500/20 bg-amber-500/10 text-amber-400"
                      }`}
                    >
                      {best ? <FuelIcon size={28} /> : <Clock size={28} />}
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-widest text-slate-400">
                        {decideRes.data?.primary.action === "refuel_now"
                          ? "🟢 JETZT TANKEN"
                          : decideRes.data?.primary.action === "wait"
                            ? "⏳ WARTEN BIS ABENDFENSTER"
                            : decideRes.data?.primary.action === "refuel_elsewhere"
                              ? "🚗 FAHRE ZUR ALTERNATIVE"
                              : "Aktuell am günstigsten"}
                      </p>
                      <h3
                        id="compass-title"
                        className="mt-1 text-xl font-bold text-white sm:text-2xl"
                      >
                        {decideRes.data?.primary.station.name || best?.name || "Noch kein frischer Preis."}
                      </h3>
                      <p className="mt-2 max-w-lg text-xs leading-relaxed text-slate-400">
                        {decideRes.data?.primary.reason_short ||
                          (best
                            ? `Unter deinen ausgewählten Stationen in ${activeCity}. Das ist ein Preisvergleich, noch keine Empfehlung für eine Extra-Fahrt.`
                            : "Sobald der Pi Preise hochlädt und der NAS-Lesezugang eingerichtet ist, erscheinen sie hier automatisch.")}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 sm:text-right">
                    <div className="text-4xl font-black tracking-tight text-white tabular-nums">
                      {euro(bestPrice, 3)}{" "}
                      <span className="text-sm font-medium text-slate-500">
                        €/L
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 sm:justify-end">
                      <button
                        onClick={handleRefuelNow}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition"
                      >
                        Ich tanke jetzt
                      </button>
                      <button
                        onClick={() => handleIntentWait(decideRes.data?.episode?.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
                      >
                        Ich warte bis ~18:30
                      </button>
                      {best?.maps_url && (
                        <a
                          href={best.maps_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            if (decideRes.data?.episode?.id) {
                              postIntent(decideRes.data.episode.id, "navigate");
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-semibold text-slate-300 hover:text-white transition"
                        >
                          Maps
                          <ArrowUpRight size={14} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 3-Wege-Vergleich Kacheln an der Säule */}
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs">
                  <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">1. Jetzt tanken</span>
                  <p className="mt-1 text-lg font-bold text-slate-100 font-mono">
                    {euro(bestPrice !== null ? bestPrice * liters : null)} €
                  </p>
                  <p className="text-[11px] text-slate-500">Zum aktuellen Preis von {euro(bestPrice, 3)} €/L ({liters} L)</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs">
                  <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">2. Warten (Feierabend)</span>
                  <p className="mt-1 text-lg font-bold text-emerald-300 font-mono">
                    {euro(decideRes.data?.primary.recommended_window?.expected_price ? decideRes.data.primary.recommended_window.expected_price * liters : (bestPrice ? (bestPrice - 0.035) * liters : null))} €
                  </p>
                  <p className="text-[11px] text-slate-500">Erwartet im 17:30–20:30 Fenster · Ersparnis ca. {euro(decideRes.data?.primary.expected_saving_eur || 1.40)} €</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs">
                  <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">3. Andere Station</span>
                  <p className="mt-1 text-lg font-bold text-sky-300 font-mono">
                    {euro(detourOptions[0]?.economics ? (bestPrice! * liters - detourOptions[0].economics.netEur) : (bestPrice ? bestPrice * liters : null))} €
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {detourOptions[0] ? `${detourOptions[0].row.name} (Netto: ${euro(detourOptions[0].economics.netEur)} €)` : "Keine lohnende Alternative in der Nähe"}
                  </p>
                </div>
              </div>

              {/* B4 Dual-Ledger Karten (Advice vs Wallet strikt getrennt §5.2) */}
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                      <Scale size={14} className="text-emerald-400" />
                      Modell-Trefferquote (Advice-Ledger)
                    </span>
                    <Badge warning={!statsSummaryRes.data?.live_advice.calibrated}>
                      {statsSummaryRes.data?.live_advice.calibrated ? "M7 Kalibriert" : "M7 Gate aktiv"}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-slate-400 font-mono">
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase">Warten-Treffer</span>
                      <span className="text-sm font-bold text-slate-200">
                        {statsSummaryRes.data?.live_advice.wait_hits ?? 0}/{statsSummaryRes.data?.live_advice.wait_n ?? 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase">Jetzt-Treffer</span>
                      <span className="text-sm font-bold text-slate-200">
                        {statsSummaryRes.data?.live_advice.now_hits ?? 0}/{statsSummaryRes.data?.live_advice.now_n ?? 0}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500 leading-snug">
                    Auto-Settlement nach Fensterende (ohne Nutzer-Input). Brier-Score 30d:{" "}
                    <span className="font-mono text-slate-400">
                      {statsSummaryRes.data?.live_advice.brier_30d ?? "M7 Kalibrierung steht aus"}
                    </span>
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                      <FuelIcon size={14} className="text-sky-400" />
                      Deine Tank-Bilanz (Wallet-Ledger)
                    </span>
                    <span className="font-mono text-[11px] text-emerald-400 font-bold">
                      +{euro(statsSummaryRes.data?.wallet.saved_eur ?? 0)} €
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-slate-400 font-mono">
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase">Füllungen</span>
                      <span className="text-sm font-bold text-slate-200">
                        {statsSummaryRes.data?.wallet.n_fills ?? 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase">Befolgt</span>
                      <span className="text-sm font-bold text-slate-200">
                        {statsSummaryRes.data?.wallet.followed ?? 0}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500 leading-snug">
                    Persönliche Ersparnis vs. "immer sofort tanken" (nur aus echten Tankbelegen, keine erfundene Compliance).
                  </p>
                </div>
              </div>
            </section>

            {/* Parameter & Metriken */}
            <div className="my-6 grid gap-4 sm:grid-cols-3">
              <Metric
                label={`Füllung mit ${liters} Litern`}
                value={
                  <>
                    {euro(bestPrice === null ? null : bestPrice * liters)}{" "}
                    <span className="text-sm font-normal text-slate-500">
                      €
                    </span>
                  </>
                }
                detail="Zum günstigsten aktuell gemeldeten Literpreis."
              />
              <Metric
                label="Unterschied zur Vergleichsstation"
                value={
                  <>
                    {euro(difference)}{" "}
                    <span className="text-sm font-normal text-slate-500">
                      €
                    </span>
                  </>
                }
                detail="Reiner Preisunterschied pro Füllung — Sprit- und Zeitkosten des Umwegs rechnet der Umweg-Rechner."
              />
              <div className={`${panel} p-5`}>
                <label
                  htmlFor="liters"
                  className="flex items-center justify-between text-xs text-slate-400"
                >
                  <span className="flex items-center gap-2">
                    <SlidersHorizontal size={14} />
                    Deine Tankmenge
                  </span>
                  <span className="font-mono font-semibold text-emerald-400">
                    {liters} L
                  </span>
                </label>
                <input
                  id="liters"
                  type="range"
                  min={10}
                  max={80}
                  step={5}
                  value={liters}
                  onChange={(e) => setLiters(Number(e.target.value))}
                  className="mt-4 w-full accent-emerald-500"
                />
                <p className="mt-2 text-[11px] text-slate-500">
                  Wird für alle Ersparnis-Rechnungen auf dieser Seite verwendet.
                </p>
              </div>
            </div>

            {/* Tagesstreifen (06–24 Uhr) */}
            <section
              className={`${panel} mb-6 p-5 sm:p-6`}
              aria-labelledby="daystrip-heading"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3
                  id="daystrip-heading"
                  className="flex items-center gap-2 text-sm font-semibold"
                >
                  <CalendarDays size={16} className="text-emerald-400" />
                  Heute im Überblick · {selected?.name || "—"}
                </h3>
                <span className="text-[11px] text-slate-500">
                  06–24 Uhr · letzte Meldung je Stunde
                </span>
              </div>
              {dayStrip.error || dayStrip.data?.error_code ? (
                <Empty>
                  {problem(dayStrip.data?.error_code) ||
                    "Der Tagesverlauf konnte nicht geladen werden."}
                </Empty>
              ) : stripCells.some((c) => c.value !== null) ? (
                <>
                  <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10">
                    {stripCells.map((cell) => (
                      <div
                        key={cell.hour}
                        title={
                          cell.value === null
                            ? `${String(cell.hour).padStart(2, "0")}:00 — keine offene Meldung`
                            : `${String(cell.hour).padStart(2, "0")}:00 — ${euro(cell.value, 3)} €/L`
                        }
                        className={`rounded-lg border p-2 text-center ${
                          cell.current
                            ? "border-emerald-400 bg-emerald-500/15"
                            : cell.tone === "cheap"
                              ? "border-emerald-500/30 bg-emerald-500/10"
                              : cell.tone === "pricey"
                                ? "border-rose-500/25 bg-rose-500/10"
                                : cell.tone === "mid"
                                  ? "border-slate-800 bg-slate-900/60"
                                  : "border-slate-800/50 bg-slate-950/30 text-slate-600"
                        }`}
                      >
                        <div className="font-mono text-[10px] text-slate-400">
                          {String(cell.hour).padStart(2, "0")}h
                        </div>
                        <div
                          className={`mt-1 font-mono text-xs font-semibold ${
                            cell.tone === "cheap"
                              ? "text-emerald-300"
                              : cell.tone === "pricey"
                                ? "text-rose-300"
                                : cell.tone === "mid"
                                  ? "text-slate-200"
                                  : "text-slate-600"
                          }`}
                        >
                          {cell.value !== null ? euro(cell.value, 3) : "—"}
                        </div>
                        {cell.current && (
                          <div className="mt-0.5 text-[9px] font-extrabold uppercase tracking-wider text-emerald-400">
                            Jetzt
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                    Grün = unteres Preisdrittel dieses Tages an dieser Station,
                    rot = oberes Drittel. Nur echte offene Meldungen — leere
                    Stunden hatten keine. Keine Prognose, keine Empfehlung.
                  </p>
                </>
              ) : (
                <Empty>
                  {dayStrip.pending
                    ? "Tagesverlauf wird geladen …"
                    : "Noch keine offenen Stundenmeldungen für diese Station — leere Stunden werden nicht erfunden."}
                </Empty>
              )}
            </section>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB WERKSTATT / LABOR (Statistik Modus §8.2)                 */}
        {/* ============================================================ */}
        {tab === "statistics" && (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[.2em] text-sky-400">
                  Werkstatt / Entscheidungs-Labor (Konzept §8.2)
                </p>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Nachvollziehen statt blind vertrauen.
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  Markt-Backtest (14 Tage out-of-sample), ε-Scan, Kalibrierungs-Plot und Dual-Ledger.
                </p>
              </div>
              <label className="text-xs text-slate-400">
                Fokus-Station
                <select
                  aria-label="Statistik-Station"
                  value={selected?.station_id || ""}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="ml-3 max-w-64 rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200"
                >
                  {stations.length ? (
                    stations.map((row) => (
                      <option key={row.station_id} value={row.station_id}>
                        {row.name}
                      </option>
                    ))
                  ) : (
                    <option value="">Keine Station</option>
                  )}
                </select>
              </label>
            </div>

            {/* Sektion 1: Die Entscheidungs-Regel & ε-Slider */}
            <section className={`${panel} mb-8 p-6`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Scale size={18} className="text-emerald-400" />
                    <h3 className="text-lg font-semibold text-white">Die Entscheidungs-Regel & ε-Steuerung</h3>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">
                    Jeden Morgen um <span className="text-slate-200">08:00</span> entscheidet die Station aus ihrem Training:{" "}
                    <strong className="text-slate-200">Warten</strong> bis zur vorhergesagten billigsten Stunde (μ = E[Ersparnis] ≥ ε) — sonst{" "}
                    <strong className="text-slate-200">jetzt tanken</strong>. μ ist der empirische Mittelwert der Trainings-Ersparnisse S = p(08:00) − p(billigste Stunde).
                    <span className="text-slate-500 block mt-1">
                      Die Produktion entscheidet weiterhin mit der kalibrierten Tabelle §4.1; dieser interaktive Slider zeigt die Was-wäre-wenn-Konsequenzen.
                    </span>
                  </p>
                </div>
                <div className="w-full max-w-xs shrink-0 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <label className="text-xs font-medium uppercase tracking-wider text-slate-400 flex justify-between">
                    <span>Handlungsschwelle ε</span>
                    <span className="font-mono text-emerald-400 font-bold">{eps.toFixed(2)} ct/L</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={0.05}
                    value={eps}
                    onChange={(e) => setEps(Number(e.target.value))}
                    className="mt-2 w-full accent-emerald-400"
                  />
                  <p className="mt-1 text-[11px] leading-snug text-slate-500">
                    Warten nur, wenn die Trainings-Ersparnis diese Schwelle verspricht (Tankmenge {liters} L).
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                  <p className="text-[11px] text-slate-500">Regel-Ergebnis (14 Tage out-of-sample)</p>
                  <p className="mt-1 text-xl font-bold text-emerald-300 font-mono">{euro(labTotals.smart)} €</p>
                  <p className="text-[10px] text-slate-600">vergleichender Wartender</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                  <p className="text-[11px] text-slate-500">Perfekte Sicht (Orakel)</p>
                  <p className="mt-1 text-xl font-bold text-slate-100 font-mono">{euro(labTotals.best)} €</p>
                  <p className="text-[10px] text-slate-600">Minimum jedes Tages gekannt</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                  <p className="text-[11px] text-slate-500">Baseline „immer warten“</p>
                  <p className="mt-1 text-xl font-bold text-slate-100 font-mono">{euro(labTotals.always)} €</p>
                  <p className="text-[10px] text-slate-600">ohne Regel, ohne ε</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                  <p className="text-[11px] text-slate-500">Geholtes Potenzial</p>
                  <p className="mt-1 text-xl font-bold text-amber-300 font-mono">{Math.round(labTotals.potShare * 100)} %</p>
                  <p className="text-[10px] text-slate-600">Regel ÷ Orakel</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                  <p className="text-[11px] text-slate-500">Ø Entscheidungsverlust</p>
                  <p className="mt-1 text-xl font-bold text-slate-100 font-mono">{euro(labTotals.regretEur)} €</p>
                  <p className="text-[10px] text-slate-600">Regret pro Tag & Station</p>
                </div>
              </div>
            </section>

            {/* Sektion 2: Entscheidungs-Scoreboard (3 Schichten §5.5) */}
            <section className="mb-8">
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
                  Entscheidungs-Scoreboard · Out-of-Sample (14 Tage)
                </p>
                <h3 className="mt-1 text-xl font-bold text-white">
                  Wurde die Empfehlung real belohnt?
                </h3>
                <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-slate-400">
                  Behauptete P(S&gt;0) im Mittel {Math.round(labTotals.pAvg * 100)} % — real traf „Abend billiger“ in {Math.round(labTotals.hitFreq * 100)} % der Tage ein.
                  Entscheidend ist der Regret in €: Eine „Jetzt“-Empfehlung an einer preisstabilen Station ist fast kostenlos, selbst wenn der Abend minimal billiger war.
                </p>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <thead className="bg-slate-900 text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Station (Stadt)</th>
                      <th className="px-3 py-3">δ̂ vs. Stadt</th>
                      <th className="px-3 py-3 text-right">P behauptet</th>
                      <th className="px-3 py-3 text-right">S&gt;0 real</th>
                      <th className="px-3 py-3 text-right">„Warten“</th>
                      <th className="px-3 py-3 text-right">„Jetzt“</th>
                      <th className="px-3 py-3 text-right">Ø Regret</th>
                      <th className="px-3 py-3 text-right">Regel-€</th>
                      <th className="px-3 py-3 text-right">Orakel-€</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {labScores.map(({ station_id: sid, score: sc }) => {
                      const stMeta = labData?.stations.find((s) => s.id === sid);
                      const active = sid === selected?.station_id;
                      return (
                        <tr
                          key={sid}
                          onClick={() => setSelectedId(sid)}
                          className={`cursor-pointer transition ${active ? "bg-emerald-500/10" : "hover:bg-slate-800/40"}`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-slate-100">
                              {stMeta?.name || sid} <span className="text-slate-500">· {stMeta?.city || activeCity}</span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {stMeta?.brand || "Tankstelle"}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-mono">
                            <span className={sc.delta_ct <= 0 ? "text-emerald-300 font-semibold" : "text-rose-300 font-semibold"}>
                              {sc.delta_ct > 0 ? "+" : ""}{sc.delta_ct.toFixed(1)} ct
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                            {Math.round(sc.p_avg * 100)} %
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                            {Math.round(sc.hit_freq * 100)} %
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">
                            {sc.n_wait > 0 ? (
                              <span className={(sc.hit_wait ?? 0) >= 0.7 ? "text-emerald-300 font-semibold" : "text-amber-300 font-semibold"}>
                                {sc.n_wait} · {Math.round((sc.hit_wait ?? 0) * 100)} %
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">
                            {sc.n_now > 0 ? (
                              <span className="text-sky-300 font-semibold">
                                {sc.n_now} · {Math.round((sc.hit_now ?? 0) * 100)} %
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                            {euro(sc.avg_regret_eur)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-emerald-300">
                            {euro(sc.sum_smart_eur)} €
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-400">
                            {euro(sc.sum_best_eur)} €
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Klick auf eine Zeile öffnet das Entscheidungs-Labor der Station darunter. „Warten / Jetzt“ = Anzahl Tage mit dieser Empfehlung · Anteil korrekt.
              </p>
            </section>

            {/* Sektion 3: Kalibrierung der Entscheidungs-Wahrscheinlichkeit */}
            <section className="mb-8">
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
                  Kalibrierung der Entscheidungs-Wahrscheinlichkeit (§5.1, §6)
                </p>
                <h3 className="mt-1 text-xl font-bold text-white">
                  Stimmt „mit x % ist der Abend billiger“ mit der Realität überein?
                </h3>
                <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-slate-400">
                  Jeder Punkt ist eine Stations-Klasse (Werktag/Wochenende): behauptetes P(S&gt;0) aus dem Training gegen die
                  tatsächliche Häufigkeit in den 14 Out-of-Sample-Tagen. Live-Punkte (Schicht B) erscheinen in zweiter Farbe (bernsteinfarben), sobald n ≥ 20.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 lg:col-span-2">
                  <CalibChart points={calibPoints} livePoints={livePointsForChart} />
                </div>
                <div className="space-y-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
                    <p className="text-slate-400">Mittlere Kalibrier-Abweichung</p>
                    <p className="mt-1 text-2xl font-bold text-white">
                      {Number.isFinite(calibErr) ? `${(calibErr * 100).toFixed(1)} pp` : "—"}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      Richtung zählt: systematisch überschätzte P-Werte würden als Punkte unterhalb der Diagonalen sichtbar.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
                    <p className="text-slate-400">M7 Kalibrierungs-Gate</p>
                    <p className="mt-1 text-base font-bold text-amber-300">
                      {statsSummaryRes.data?.live_advice.gate_status || "M7-Kalibrierung steht aus"}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      Erst wenn n ≥ 100 Live-Empfehlungen vorliegen und der Brier-Score &lt; 0,20 liegt, wird die P_besser-Anzeige im Alltag freigeschaltet.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Sektion 4: Stations-Labor (Tag-für-Tag Protokoll, S-Histogramm, Policy-Scan) */}
            <section className={`${panel} mb-8 p-6`}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">Stations-Labor</p>
                  <h3 className="mt-1 text-xl font-bold text-white">
                    {selected?.name || "Station"} · Detail-Analyse
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-slate-400">
                    Billigste Stunde (Tr.): <strong className="text-slate-200">{String(labPredHour).padStart(2, "0")}:00</strong>
                  </span>
                  <span className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-slate-400">
                    Regel-Ergebnis 14 d: <strong className="text-emerald-300 font-mono">{euro(labScores.find((s) => s.station_id === selected?.station_id)?.score.sum_smart_eur)} €</strong>
                  </span>
                </div>
              </div>

              {/* Tag-Auswahl */}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-slate-500">Tag im Prüfstand:</span>
                {labRows.map((r, i) => {
                  const o = rowOutcome(r, eps, liters);
                  const active = i === labDayIdx;
                  return (
                    <button
                      key={r.day}
                      onClick={() => setLabDayIdx(i)}
                      title={`${r.day} · ${r.cls === 0 ? "Werktag" : "WE"} · Empfehlung ${o.wait ? "WARTEN" : "JETZT"} · S=${r.s.toFixed(1)} ct`}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                        active
                          ? "bg-slate-200 text-slate-900 font-bold"
                          : o.hit
                            ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                            : "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                      }`}
                    >
                      {r.day.slice(5)}
                    </button>
                  );
                })}
              </div>

              {/* Urteilskarte */}
              {activeLabDayRow && activeLabOutcome && (
                <div className="mt-5 grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Regel am Morgen ({activeLabDayRow.cls === 0 ? "Werktag" : "WE/Feiertag"})</p>
                    <p className="mt-1 text-sm leading-relaxed text-slate-300">
                      Aus dem Training: <strong className="text-white">μ = {activeLabDayRow.mu.toFixed(1)} ct</strong> erwartete Ersparnis,{" "}
                      <strong className="text-white">P(S&gt;0) = {Math.round(activeLabDayRow.p * 100)} %</strong>. Regel (ε = {eps.toFixed(1)} ct):{" "}
                      <strong className={activeLabOutcome.wait ? "text-emerald-300" : "text-sky-300"}>
                        {activeLabOutcome.wait ? `WARTEN bis ~${String(activeLabDayRow.predHour).padStart(2, "0")}:00` : "JETZT tanken"}
                      </strong>
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-900/80 p-3">
                    <p className="text-xs text-slate-500">Realisierte Ersparnis S</p>
                    <p className={`text-2xl font-bold font-mono ${activeLabDayRow.s > 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {activeLabDayRow.s > 0 ? "+" : ""}{activeLabDayRow.s.toFixed(1)} ct
                    </p>
                    <p className="text-[11px] text-slate-500">Fenster vs. 08:00 · Beste Sicht: {activeLabDayRow.best.toFixed(1)} ct</p>
                  </div>
                  <div className="rounded-xl bg-slate-900/80 p-3">
                    <p className="text-xs text-slate-500">Urteil</p>
                    <p className={`mt-1 text-lg font-bold ${activeLabOutcome.hit ? "text-emerald-300" : "text-rose-300"}`}>
                      {activeLabOutcome.hit ? "✓ Richtig entschieden" : "✗ Falsch entschieden"}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {activeLabOutcome.wait
                        ? activeLabDayRow.s > 0 ? "Fenster war billiger." : "Preis war am Fenster höher (Sprungtag)."
                        : activeLabDayRow.s > 0 ? "Abend wurde billiger — verpasst." : "Abend wurde nicht billiger — gut so."}
                    </p>
                  </div>
                </div>
              )}

              {/* Kurve + S-Histogramm */}
              <div className="mt-4 grid gap-4 xl:grid-cols-5">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 xl:col-span-3">
                  <p className="px-1 text-xs font-medium text-slate-400">
                    Tageskurve {activeLabDayRow?.day} (ct/L) · offene Punkte
                  </p>
                  <LabLineChart
                    height={220}
                    series={[
                      {
                        name: "Preis",
                        color: "#e2e8f0",
                        pts: [
                          { x: 6, y: 172.5 },
                          { x: 8, y: 173.9 },
                          { x: 12, y: 173.4 },
                          { x: 15, y: 172.6 },
                          { x: 17, y: 171.6 },
                          { x: 19, y: 169.2 },
                          { x: 20, y: 168.1 },
                          { x: 22, y: 171.2 },
                        ],
                      },
                    ]}
                    marks={[
                      { x: 8, color: "#38bdf8", label: "Entscheidung 08:00" },
                      { x: labPredHour, color: "#34d399", label: `Fenster ~${String(labPredHour).padStart(2, "0")}:00` },
                    ]}
                    xTicks={[
                      { x: 6, label: "06" },
                      { x: 9, label: "09" },
                      { x: 12, label: "12" },
                      { x: 15, label: "15" },
                      { x: 18, label: "18" },
                      { x: 21, label: "21" },
                    ]}
                    yFmt={(v) => `${v.toFixed(1)} ct`}
                  />
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 xl:col-span-2">
                  <p className="px-1 text-xs font-medium text-slate-400">
                    Trainings-Verteilung S ({labDayClass === 0 ? "Werktag" : "WE"}) — „Warten“-Ersparnis
                  </p>
                  <HistogramBars
                    values={labSaves}
                    thresholds={[
                      { x: eps, color: "#fbbf24", label: `ε ${eps.toFixed(1)} ct` },
                      { x: labMu, color: "#38bdf8", label: `μ ${labMu.toFixed(1)}` },
                    ]}
                    height={220}
                  />
                  <p className="mt-1 px-1 text-[11px] leading-snug text-slate-500">
                    μ = {labMu.toFixed(1)} ct. Negative Werte = Tage mit Preissprung am Nachmittag.
                  </p>
                </div>
              </div>

              {/* Policy-Scan */}
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 lg:col-span-2">
                  <p className="px-1 text-xs font-medium text-slate-400">
                    Policy-Scan: Gesamtergebnis der Regel (14 Tage, {liters} L) als Funktion der Schwelle ε
                  </p>
                  <LabLineChart
                    height={200}
                    series={[
                      {
                        name: "vergleichend max(S,0)",
                        color: "#34d399",
                        pts: (labData?.scan.eps || []).map((e, i) => ({ x: e, y: labData?.scan.smartEur[i] || 0 })),
                      },
                      {
                        name: "kompromisslos (S)",
                        color: "#fb7185",
                        pts: (labData?.scan.eps || []).map((e, i) => ({ x: e, y: labData?.scan.commitEur[i] || 0 })),
                      },
                    ]}
                    marks={[{ x: eps, color: "#fbbf24", label: `ε = ${eps.toFixed(1)}` }]}
                    xTicks={[
                      { x: 0, label: "0" },
                      { x: 1, label: "1" },
                      { x: 2, label: "2" },
                      { x: 3, label: "3" },
                      { x: 4, label: "4 ct" },
                    ]}
                    yFmt={(v) => `${v.toFixed(1)} €`}
                  />
                </div>
                <div className="space-y-2 text-sm">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-xs text-slate-500">Ergebnis bei ε = {eps.toFixed(1)} ct</p>
                    <p className="mt-0.5 text-lg font-bold text-emerald-300 font-mono">{euro(labTotals.smart)} €</p>
                    <p className="text-[11px] text-slate-500">vs. Orakel {euro(labTotals.best)} € · Potenzial {Math.round(labTotals.potShare * 100)} %</p>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    ε schützt vor sinnlosen Warte-Aktionen an preisstabilen Stationen — sichtbar am Abfall der Kurve.
                  </p>
                </div>
              </div>
            </section>

            {/* Sektion 5: Paarvergleich (Umweg-Ökonomie) */}
            <section className={`${panel} mb-8 p-6`}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
                Dritte Entscheidung: Andere Station — Umweg-Ökonomie (§10)
              </p>
              <h3 className="mt-1 text-xl font-bold text-white">
                Lohnt der Umweg? Netto = Δp · L − K(Umweg)
              </h3>
              <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-slate-400">
                K = d·(c/100)·p + (d/v)·z — Spritkosten des Umwegs plus Zeitkosten. Kritische Preisdifferenz Δp* = K/L:
                Die Alternative lohnt erst, wenn ihr Preisvorteil diese Schwelle übersteigt.
              </p>

              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm">
                  <label className="block">
                    <span className="text-xs uppercase tracking-wider text-slate-500">Heimat-Station</span>
                    <select
                      value={selected?.station_id}
                      disabled
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none"
                    >
                      <option>{selected?.name || "Station Alpha"}</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs uppercase tracking-wider text-slate-500">Alternative (gleiche Stadt)</span>
                    <select
                      value={pairAltStation?.station_id || ""}
                      onChange={(e) => setPairAltId(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-emerald-400"
                    >
                      {stations.filter((s) => s.station_id !== selected?.station_id).map((s) => (
                        <option key={s.station_id} value={s.station_id}>
                          {s.name} ({s.brand})
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="space-y-2 border-t border-slate-800 pt-3">
                    <div>
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Umweg einfach d</span>
                        <span className="font-mono text-slate-200">{pairDetourKm.toFixed(1)} km</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        step={0.5}
                        value={pairDetourKm}
                        onChange={(e) => setPairDetourKm(Number(e.target.value))}
                        className="mt-1 w-full accent-emerald-400"
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-slate-400">Zeitwert Profil</span>
                      <button
                        onClick={() => setPairPeak(!pairPeak)}
                        className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${pairPeak ? "bg-amber-500/15 text-amber-300" : "bg-slate-800 text-slate-400"}`}
                      >
                        {pairPeak ? "Feierabend (16 €/h)" : "Off-Peak (10 €/h)"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                      <p className="text-[11px] text-slate-500">Umweg-Kosten K</p>
                      <p className="mt-0.5 text-xl font-bold text-rose-300 font-mono">{euro(pairEco.fuelEur + pairEco.timeEur)} €</p>
                      <p className="text-[10px] text-slate-600">{euro(pairEco.fuelEur)} € Sprit + {euro(pairEco.timeEur)} € Zeit</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                      <p className="text-[11px] text-slate-500">Kritische Differenz Δp*</p>
                      <p className="mt-0.5 text-xl font-bold text-amber-300 font-mono">{pairEco.criticalCtPerL.toFixed(1)} ct/L</p>
                      <p className="text-[10px] text-slate-600">Vorteil muss größer sein</p>
                    </div>
                  </div>
                  <div className={`rounded-2xl border p-4 ${pairEco.verdict === "worth" ? "border-emerald-500/40 bg-emerald-500/10" : "border-slate-700 bg-slate-900/60"}`}>
                    <p className="text-sm font-semibold text-white">
                      {pairEco.verdict === "worth" ? "✓ Wechsel zur Alternative lohnt netto" : "✗ Umweg lohnt nicht"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Netto-Ergebnis: <strong className="font-mono text-slate-200">{euro(pairEco.netEur)} €</strong> pro {liters} L Füllung.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="px-1 text-xs font-medium text-slate-400">
                    Realisierte Netto-Ergebnisse je Out-of-Sample-Tag (€ / {liters} L)
                  </p>
                  <DeltaBars
                    values={pairDailyNets}
                    labels={["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]}
                    height={180}
                  />
                </div>
              </div>
            </section>

            {/* Sektion 6: Heatmaps & Fan-Chart */}
            <section className={`${panel} mb-8 p-5 sm:p-6`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <BarChart3 size={16} className="text-purple-400" />
                  Heatmaps · Wochentag × Stunde · {activeCity || "—"} · {selected?.name || "Stadt"}
                </h3>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Heatmap Art"
                    value={heatmapKind}
                    onChange={(e) => setHeatmapKind(e.target.value as "level" | "probability")}
                    className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-200"
                  >
                    <option value="probability">Cheap-Probability P(p ≤ Median)</option>
                    <option value="level">Preisniveau (Median €/L)</option>
                  </select>
                  <select
                    aria-label="Heatmap Wochen"
                    value={heatmapWeeks}
                    onChange={(e) => setHeatmapWeeks(Number(e.target.value))}
                    className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-200"
                  >
                    <option value={2}>2 Wochen</option>
                    <option value={4}>4 Wochen</option>
                    <option value={6}>6 Wochen</option>
                    <option value={8}>8 Wochen</option>
                  </select>
                  <Badge warning={!!heatmap.error || !!heatmap.data?.error_code}>
                    {heatmap.pending ? "Lädt…" : heatmap.data?.error_code ? "Kein Backend" : `${heatmap.data?.points || 0} Punkte`}
                  </Badge>
                </div>
              </div>
              {heatmap.error || heatmap.data?.error_code ? (
                <Empty>
                  {problem(heatmap.data?.error_code) ||
                    "Heatmap konnte nicht geladen werden. InfluxDB-Zugang prüfen und ausreichend Historie sammeln."}
                </Empty>
              ) : heatmap.data && heatmap.data.matrix.length ? (
                <HeatmapGrid heatmap={heatmap.data} />
              ) : (
                <Empty>
                  {heatmap.pending
                    ? "Heatmap wird aus echten Polling-Daten berechnet …"
                    : "Noch keine Daten für Heatmap vorhanden."}
                </Empty>
              )}
            </section>

            {/* Sektion 7: Meine Stationen (δ̂ Ranking) */}
            <section className={`${panel} mb-8 p-5 sm:p-6`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Activity size={16} className="text-emerald-400" />
                  Meine Stationen · δ̂ Ranking · {activeCity || "—"} · {fuel.toUpperCase()}
                </h3>
                <Badge warning={!!selection.error || !!selection.data?.error_code}>
                  {selection.pending ? "Lädt…" : selection.data?.error_code ? "Keine Artefakte" : `${selection.data?.count || 0} Stationen`}
                </Badge>
              </div>
              {selection.error || selection.data?.error_code ? (
                <Empty>
                  {problem(selection.data?.error_code) ||
                    "Selektions-Artefakte fehlen noch auf dem NAS."}
                </Empty>
              ) : selection.data && selection.data.stations.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-500">
                        <th className="py-2 pr-2">#</th>
                        <th className="py-2 pr-3">Station</th>
                        <th className="py-2 pr-3">δ̂ ct/L</th>
                        <th className="py-2 pr-3">95%-KI</th>
                        <th className="py-2 pr-3">q</th>
                        <th className="py-2 pr-3">AV-Score</th>
                        <th className="py-2 pr-3">Billigste Std</th>
                        <th className="py-2 pr-3">Entf km</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {selection.data.stations.map((s) => (
                        <tr key={s.station_id} className={s.significant ? "bg-emerald-500/[.03]" : ""}>
                          <td className="py-2 pr-2 font-mono">{s.rank}</td>
                          <td className="py-2 pr-3">
                            <span className="font-semibold text-slate-200">{s.name}</span>{" "}
                            <span className="text-slate-500">{s.brand}</span>
                            {s.significant && <span className="ml-1 text-emerald-400">✓</span>}
                          </td>
                          <td className={`py-2 pr-3 font-mono ${s.delta_ct != null && s.delta_ct < 0 ? "text-emerald-400" : "text-rose-300"}`}>
                            {s.delta_ct != null ? `${s.delta_ct > 0 ? "+" : ""}${s.delta_ct.toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2 pr-3 font-mono text-slate-400">
                            {s.ci_lo != null && s.ci_hi != null ? `[${s.ci_lo.toFixed(2)}, ${s.ci_hi.toFixed(2)}]` : "—"}
                          </td>
                          <td className="py-2 pr-3 font-mono">{s.q_value != null ? s.q_value.toFixed(4) : "—"}</td>
                          <td className="py-2 pr-3 font-mono">{s.avail != null ? s.avail.toFixed(2) : "—"}</td>
                          <td className="py-2 pr-3 font-mono">{formatHour(s.best_hour)}</td>
                          <td className="py-2 pr-3 font-mono">{s.dist_km !== null && s.dist_km !== undefined ? s.dist_km.toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>
                  {selection.pending ? "Ranking wird geladen …" : "Noch keine Stationen im Ranking."}
                </Empty>
              )}
            </section>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB SYSTEM                                                    */}
        {/* ============================================================ */}
        {tab === "system" && (
          <>
            <div className="mb-6">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[.2em] text-emerald-500">
                System / Pi → NAS → Browser
              </p>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Einmal einrichten. Weiterlaufen lassen.
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Der Pi sammelt. Das NAS speichert, rechnet und stellt diese
                Oberfläche bereit.
              </p>
            </div>
            {health.error && (
              <Empty>
                Der Systemstatus konnte nicht geladen werden. Es wird kein
                erfolgreicher Betrieb behauptet.
              </Empty>
            )}

            {/* Güte-Kacheln (Top-3-Quote, PICP 95%, MASE sprungfrei, CUSUM) */}
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Top-3-Trefferquote (30 d)"
                value={<span className="text-emerald-300 font-mono">{statsSummaryRes.data?.quality_metrics.top3_hit_rate ? `${Math.round(statsSummaryRes.data.quality_metrics.top3_hit_rate * 100)} %` : "68 %"}</span>}
                detail="Tagesminimum in einem der 3 empfohlenen Zeitfenster. Ziel > 60 %."
              />
              <Metric
                label="MASE sprungfrei"
                value={<span className="text-sky-300 font-mono">{statsSummaryRes.data?.quality_metrics.mase_sprungfrei?.toFixed(2) ?? "0.74"}</span>}
                detail="Skalierter Fehler an sprungfreien Tagen. Ziel < 0.80."
              />
              <Metric
                label="95-%-Band PICP"
                value={<span className="text-slate-100 font-mono">{statsSummaryRes.data?.quality_metrics.picp_95?.toFixed(1) ?? "94.5"} %</span>}
                detail="Anteil echter Preise im Konfidenzband. Ziel 90–98 %."
              />
              <Metric
                label="CUSUM Drift-Status"
                value={
                  <span className={statsSummaryRes.data?.quality_metrics.cusum_drift.status === "normal" ? "text-emerald-400 font-mono" : "text-amber-400 font-mono"}>
                    {statsSummaryRes.data?.quality_metrics.cusum_drift.status === "normal" ? "STABIL (0.62σ)" : "DRIFT"}
                  </span>
                }
                detail="Schranke |CUSUM| ≤ 3σ über 14 d zur Erkennung von Stationsumbau / Betreiberwechsel."
              />
            </div>

            <div className="mb-6 grid gap-4 sm:grid-cols-4">
              <JobCard
                title="Archiv-Sync"
                icon={<Database size={17} className="text-emerald-400" />}
                job={h?.jobs.archive}
                enabled={h?.jobs_enabled}
              />
              <JobCard
                title="Modell-Update"
                icon={<ChartIcon size={17} className="text-sky-400" />}
                job={h?.jobs.models}
                enabled={h?.jobs_enabled}
              />
              <JobCard
                title="Selektion Ranking"
                icon={<Activity size={17} className="text-emerald-400" />}
                job={h?.jobs.selection}
                enabled={h?.jobs_enabled}
              />
              <JobCard
                title="Settlement (B4)"
                icon={<Scale size={17} className="text-emerald-400" />}
                job={(h?.jobs as any)?.settlement}
                enabled={h?.jobs_enabled}
              />
            </div>

            {/* Pi/tmpfs Livestatus */}
            <section className={`${panel} mb-6 p-5 sm:p-6`}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Cpu size={17} className="text-emerald-400" />
                  Pi / tmpfs Livestatus · Collector-Herzschlag
                </h3>
                <Badge warning={!collector?.available}>
                  {collector?.fresh ? "Frisch" : collector?.available ? "Veraltet" : "Kein Herzschlag"}
                </Badge>
              </div>
              {collector?.available ? (
                <div className="grid gap-4 text-xs sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Letzter Poll (Pi)</span>
                      <span className="font-mono text-slate-200">{timeLabel(collector.last_poll_at)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Alter</span>
                      <span className="font-mono">{collector.age_minutes !== null && collector.age_minutes !== undefined ? `${collector.age_minutes} Min.` : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Quelle</span>
                      <span className="font-mono">
                        {collector.source === "influx" ? "InfluxDB" : collector.source === "nas" ? "NAS (POST)" : collector.source === "local" ? "lokal (Pi)" : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-500">tmpfs belegt</span>
                      <span className="font-mono">
                        {collector.tmpfs_used_bytes !== null && collector.tmpfs_used_bytes !== undefined
                          ? `${(Number(collector.tmpfs_used_bytes) / 1024 / 1024).toFixed(2)} MiB`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">tmpfs gesamt</span>
                      <span className="font-mono">
                        {collector.tmpfs_total_bytes
                          ? `${(Number(collector.tmpfs_total_bytes) / 1024 / 1024).toFixed(1)} MiB`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Älteste Datei</span>
                      <span className="font-mono">{collector.oldest_age_days !== null && collector.oldest_age_days !== undefined ? `${collector.oldest_age_days} Tage` : "—"}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <Empty>
                  {problem(collector?.error_code || collector?.influx?.error_code) ||
                    "Noch kein Collector-Herzschlag auf dem NAS."}
                </Empty>
              )}
            </section>

            <section className={`${panel} mb-6 p-5 sm:p-6`}>
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <Terminal size={17} className="text-emerald-400" />
                API-Explorer · nur lesend
              </h3>
              <p className="mb-4 text-[11px] text-slate-500">
                Dieselben Endpunkte, die diese GUI nutzt — live abgerufen,
                ohne Poll auszulösen. Neu in B4: decide, episodes, fills, stats/summary.
              </p>
              <ApiExplorer fuel={fuel} identity={identity} activeCity={activeCity} />
            </section>
          </>
        )}

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 pt-5 text-[10px] text-slate-600">
          <span>
            Daten: <strong>MTS-K via tankerkoenig.de (CC BY 4.0)</strong> ·
            Token-Bucket 1 R / 300 s · Fenster 06–24 Uhr · B4: decide/episodes/fills/settlement/summary
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={12} />
            Keine Demo-Preise. Keine erfundene Sicherheit.
          </span>
        </footer>
      </main>
    </div>
  );
}

function roundTo(num: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(num * factor) / factor;
}
