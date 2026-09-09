// Layout/visual foundation: sample/good gui/TankAppDashboard + DecisionCockpit.
// Workshop composition and charts: sample/good statistic gui/DecisionLab.
// No demo engine, seeds, simulated decisions or PostgreSQL are imported.
import { useEffect, useState, type ReactNode } from "react";
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
} from "lucide-react";
import { LineChart } from "./components/LineChart";
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
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${warning ? "border-amber-500/25 bg-amber-500/10 text-amber-300" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"}`}
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
            title={tip}
            aria-label={`Erklärung: ${tip}`}
            className="cursor-help rounded-full p-1 text-slate-500 outline-none hover:bg-slate-800 hover:text-slate-300 focus:bg-slate-800 focus:text-slate-300"
          >
            <HelpCircle size={14} />
          </span>
        )}
      </div>
      <div className="my-2 text-2xl font-bold tracking-tight text-white tabular-nums">
        {value}
      </div>
      <div className="text-[11px] leading-relaxed text-slate-500">{detail}</div>
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
  const labels: Record<string, string> = {
    success: "Erfolgreich",
    partial: "Teilweise fertig",
    waiting: "Wartet auf Daten",
    running: "Läuft",
    failed: "Fehlgeschlagen",
  };
  return (
    <div className={`${panel} p-5`}>
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </div>
        <Badge warning={!enabled || job?.state !== "success"}>
          {enabled
            ? labels[job?.state || ""] || "Noch nicht gestartet"
            : "Zeitsteuerung aus"}
        </Badge>
      </div>
      <dl className="space-y-3 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Letzter erfolgreicher Lauf</dt>
          <dd>{timeLabel(job?.last_success_at)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Nächster geplanter Lauf</dt>
          <dd>{enabled ? timeLabel(job?.next_run_at) : "Nicht geplant"}</dd>
        </div>
      </dl>
      {job?.error_code && (
        <p className="mt-4 text-xs leading-relaxed text-amber-300">
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
  const isLevel = heatmap.kind === "level";
  const matrix = heatmap.matrix;
  // Determine min/max for color scaling
  const flat = matrix.flat().filter((v) => v !== null) as number[];
  const min = flat.length ? Math.min(...flat) : 0;
  const max = flat.length ? Math.max(...flat) : 1;
  const span = max - min || 1;

  const getColor = (val: number | null) => {
    if (val === null) return "bg-slate-950/40 border-slate-800 text-slate-600";
    if (isLevel) {
      // Level: cheap = emerald, expensive = rose, centered around median
      const norm = (val - min) / span; // 0 cheap, 1 expensive
      if (norm <= 0.2) return "bg-emerald-500 text-slate-950 font-bold";
      if (norm <= 0.4) return "bg-emerald-600/80 text-white";
      if (norm <= 0.6) return "bg-slate-700/80 text-slate-200";
      if (norm <= 0.8) return "bg-amber-600/70 text-slate-100";
      return "bg-rose-600/80 text-white";
    } else {
      // Probability: 0% red, 100% emerald
      if (val >= 80) return "bg-emerald-500 text-slate-950 font-bold";
      if (val >= 65) return "bg-emerald-600/80 text-white";
      if (val >= 45) return "bg-slate-700/80 text-slate-200";
      if (val >= 30) return "bg-amber-600/70 text-slate-100";
      return "bg-rose-600/80 text-white";
    }
  };

  return (
    <div className="overflow-x-auto pb-2">
      <div className="min-w-[720px]">
        <div className="flex items-center mb-1 text-[10px] text-slate-400 font-mono">
          <div className="w-10 flex-shrink-0 text-right pr-2">Tag</div>
          <div className="flex-1 grid grid-cols-24 gap-0.5">
            {heatmap.hours.map((h) => (
              <div
                key={h}
                className={`text-center ${
                  (h >= 6 && h <= 9) || (h >= 16 && h <= 20) ? "text-emerald-400 font-bold" : ""
                }`}
              >
                {h % 2 === 0 ? h : ""}
              </div>
            ))}
          </div>
        </div>
        {heatmap.days.map((day, dayIdx) => (
          <div key={dayIdx} className="flex items-center mb-1">
            <div className="w-10 flex-shrink-0 text-right pr-2 text-xs font-semibold text-slate-300">
              {day}
            </div>
            <div className="flex-1 grid grid-cols-24 gap-0.5">
              {heatmap.hours.map((h, hourIdx) => {
                const val = matrix[dayIdx]?.[hourIdx] ?? null;
                return (
                  <div
                    key={h}
                    title={`${day} ${h}:00 Uhr: ${val === null ? "–" : val + (isLevel ? " €/L" : "%")}`}
                    className={`h-7 rounded-[3px] text-[10px] flex items-center justify-center border ${getColor(val)}`}
                  >
                    {val === null
                      ? "–"
                      : isLevel
                        ? val.toFixed(2)
                        : `${Math.round(val)}`}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>
          {heatmap.points} Punkte · {heatmap.stations} Stationen · {heatmap.weeks} Wochen ·{" "}
          {isLevel ? "Median €/L" : "Cheap-Probability %"} · Stadt: {heatmap.city}
          {heatmap.station_id ? ` · Station: ${heatmap.station_id.slice(0, 8)}…` : ""}
        </span>
        <div className="flex items-center gap-2">
          <span>{isLevel ? "Günstig" : "Hohe Chance"}</span>
          <div className="flex h-3 w-28 rounded overflow-hidden">
            <div className="flex-1 bg-emerald-500" />
            <div className="flex-1 bg-emerald-600" />
            <div className="flex-1 bg-slate-700" />
            <div className="flex-1 bg-amber-600" />
            <div className="flex-1 bg-rose-600" />
          </div>
          <span>{isLevel ? "Teuer" : "Niedrig"}</span>
        </div>
      </div>
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
  const routeEval = useResource<RouteEvaluate>(
    tab === "daily" && activeCity && (routeAltId || detourOptions[0]?.row.station_id)
      ? `/api/v1/route/evaluate?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&station_id=${encodeURIComponent(routeAltId || detourOptions[0]?.row.station_id || "")}&ref_station_id=${encodeURIComponent(selected?.station_id || "")}&liters=${liters}&detour_km=${encodeURIComponent(String(detourOptions.find((o) => o.row.station_id === (routeAltId || detourOptions[0]?.row.station_id))?.km || 3))}&consumption=${consumption}&speed=${speed}&value_of_time=${timeValue}&mode=${detourMode}`
      : null,
    30000,
    refresh,
  );

  const connectionProblem = prices.error
    ? "Der App-Server ist nicht erreichbar. Angezeigte ältere Preise werden nicht als aktuell gewertet."
    : problem(data?.connection_error);
  const h = health.error ? null : health.data;
  const observations = history.data?.points || [];
  const f = forecast.data;
  const metrics = f?.metrics;
  const series = segments(observations);
  const obsWindow: [number, number] = [
    Date.now() - spanHours * 3600 * 1000,
    Date.now(),
  ];
  const spanLabel =
    spanHours === 24 ? "letzte 24 Stunden" : spanHours === 72 ? "letzte 3 Tage" : "letzte 7 Tage";
  const horizonPts =
    horizon === 3 && f?.points_3d?.length
      ? f.points_3d
      : horizon === 7 && f?.points_7d?.length
        ? f.points_7d
        : f?.points || [];
  const horizonDays =
    horizon === 3 && f?.points_3d?.length ? 3 : horizon === 7 && f?.points_7d?.length ? 7 : 1;
  const modelPts = horizonPts
    .filter((p) => p.q50 !== null)
    .map((p) => ({ x: Date.parse(p.timestamp), y: p.q50! }));
  const modelSeries = splitOnGap(modelPts, 20).map((pts, i) => ({
    name: i === 0 ? "Unkalibrierter Median" : undefined,
    color: "#38bdf8",
    dash: "5 4",
    pts,
  }));
  const fanBand95 = splitOnGap(
    (f?.points || [])
      .filter((p) => p.q025 !== null && p.q975 !== null)
      .map((p) => ({
        x: Date.parse(p.timestamp),
        yLow: p.q025!,
        yHigh: p.q975!,
      })),
    20,
  ).map((pts, i) => ({
    name: i === 0 ? "95-%-Band" : undefined,
    color: "#38bdf8",
    pts,
  }));
  const fanBand80 = splitOnGap(
    (f?.points || [])
      .filter(
        (p) =>
          p.q10 !== null &&
          p.q10 !== undefined &&
          p.q90 !== null &&
          p.q90 !== undefined,
      )
      .map((p) => ({
        x: Date.parse(p.timestamp),
        yLow: p.q10!,
        yHigh: p.q90!,
      })),
    20,
  ).map((pts, i) => ({
    name: i === 0 ? "80-%-Band" : undefined,
    color: "#34d399",
    pts,
  }));
  const forecastWindow: [number, number] | null =
    f?.origin && modelSeries.length
      ? [Date.parse(f.origin), Date.parse(f.origin) + horizonDays * 86_400_000]
      : null;
  const nowMs = Date.now();
  const extremeMarks = (() => {
    if (modelPts.length < 12) return [];
    let lo = modelPts[0];
    let hi = modelPts[0];
    for (const p of modelPts) {
      if (p.y < lo.y) lo = p;
      if (p.y > hi.y) hi = p;
    }
    if (!(hi.y > lo.y)) return [];
    return [
      { x: lo.x, color: "#34d399", label: `Tief ${clockLabel(new Date(lo.x).toISOString())}` },
      { x: hi.x, color: "#fb7185", label: `Hoch ${clockLabel(new Date(hi.x).toISOString())}` },
    ];
  })();
  const forecastMarks = [
    ...(forecastWindow && nowMs > forecastWindow[0] && nowMs < forecastWindow[1]
      ? [{ x: nowMs, color: "#f59e0b", label: "Jetzt" }]
      : []),
    ...extremeMarks,
  ];
  const openPrices = observations
    .filter(
      (p) =>
        p.status === "open" &&
        p.price !== null &&
        Number.isFinite(p.price) &&
        Number.isFinite(Date.parse(p.timestamp)),
    )
    .map((p) => p.price!);
  const dayStats = openPrices.length
    ? {
        n: openPrices.length,
        min: Math.min(...openPrices),
        max: Math.max(...openPrices),
      }
    : null;
  const modelWindows = (() => {
    const medians = horizonPts
      .filter((p) => p.q50 !== null && Number.isFinite(Date.parse(p.timestamp)))
      .map((p) => ({ x: Date.parse(p.timestamp), y: p.q50! }));
    if (medians.length < 4) return [];
    const blocks: { start: number; end: number; values: number[] }[] = [];
    const blockMs = 2 * 3600 * 1000;
    const first = Math.floor(medians[0].x / blockMs) * blockMs;
    for (const m of medians) {
      const start = Math.floor((m.x - first) / blockMs) * blockMs + first;
      let block = blocks.find((b) => b.start === start);
      if (!block) {
        block = { start, end: start + blockMs, values: [] };
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
      if (hour >= 6 && hour < 24) byHour.set(hour, p.price);
    }
    const values = [...byHour.values()];
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const span = max - min || 1;
    const nowHour = Math.floor(berlinHour());
    return Array.from({ length: 18 }, (_, i) => {
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
        current: hour === nowHour,
      };
    });
  })();
  const calibrationTip = f?.data_policy
    ? `Kalibrierung braucht nachgewiesene Live-Vorhersagen — keine Archiv-Historie: mindestens 21 bewertete Tage, Abdeckung ≥ 85 %, MASE < 0,95, 95-%-Abdeckung zwischen 90 und 98 %, dazu der noch ausstehende Abnahmetest. Bisher ${f.data_policy.good_complete_live_days} von ${f.data_policy.required_complete_live_days} guten Live-Tagen. Deshalb keine Handlungsempfehlung — nur transparente Kennzahlen.`
    : "Kalibrierung braucht nachgewiesene Live-Vorhersagen — keine Archiv-Historie: mindestens 21 bewertete Tage, Abdeckung ≥ 85 %, MASE < 0,95, 95-%-Abdeckung zwischen 90 und 98 %, dazu der noch ausstehende Abnahmetest. Deshalb keine Handlungsempfehlung — nur transparente Kennzahlen.";

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100 selection:bg-emerald-500 selection:text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <a
            href="/"
            className="flex items-center gap-3"
            aria-label="TankApp Startseite"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-sky-500 text-slate-950 shadow-lg shadow-emerald-500/20">
              <FuelIcon size={21} />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white">
                TankApp{" "}
                <span className="ml-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-400">
                  LIVE
                </span>
              </h1>
              <p className="text-[11px] text-slate-500">
                Dein Tank-Kompass. Ohne Rätselraten.
              </p>
            </div>
          </a>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
              <MapPin size={14} className="text-emerald-400" />
              <span className="sr-only">Stadt</span>
              <select
                aria-label="Stadt"
                value={activeCity}
                onChange={(e) => {
                  setCity(e.target.value);
                  setSelectedId("");
                }}
                disabled={!data?.cities.length}
                className="max-w-40 bg-slate-950 pr-1 text-slate-100"
              >
                {data?.cities.length ? (
                  data.cities.map((label) => (
                    <option key={label}>{label}</option>
                  ))
                ) : (
                  <option value="">Keine Stadt eingerichtet</option>
                )}
              </select>
            </label>
            <div
              role="group"
              aria-label="Kraftstoff"
              className="flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs font-bold"
            >
              {(["e10", "e5", "diesel"] as Fuel[]).map((value) => (
                <button
                  key={value}
                  aria-pressed={fuel === value}
                  onClick={() => setFuel(value)}
                  className={`rounded-lg px-3 py-1.5 transition-colors ${fuel === value ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"}`}
                >
                  {value === "diesel" ? "Diesel" : value.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              aria-label="Daten aktualisieren"
              title="Aktualisiert die NAS-Datenansicht, löst keinen Tankerkönig-Poll aus"
              onClick={() => setRefresh((value) => value + 1)}
              disabled={prices.pending}
              className="rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-300 hover:text-white"
            >
              <RefreshCw
                size={16}
                className={prices.pending ? "animate-spin" : ""}
              />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label="Ansichten"
            className="flex rounded-xl border border-slate-800 bg-slate-900/60 p-1"
          >
            {(
              [
                { id: "daily", label: "Alltag", icon: <Compass size={15} /> },
                {
                  id: "statistics",
                  label: "Statistik",
                  icon: <ChartIcon size={15} />,
                },
                { id: "system", label: "System", icon: <Server size={15} /> },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? "page" : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:px-5 ${tab === item.id ? "bg-slate-800 text-emerald-400 shadow" : "text-slate-500 hover:text-slate-200"}`}
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

        {tab === "daily" && (
          <>
            <div className="mb-6">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[.2em] text-emerald-500">
                Alltag / {activeCity || "Dein Standort"}
              </p>
              <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Ein guter Stopp beginnt hier.
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Aktuelle Preise deiner Stationen. Die richtige Entscheidung ohne
                Datenchaos.
              </p>
            </div>
            <section
              className={`${panel} relative overflow-hidden p-5 shadow-2xl sm:p-7`}
              aria-labelledby="compass-title"
            >
              <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
              <div className="relative mb-6 flex flex-wrap items-center justify-between gap-3">
                <Badge>
                  <Compass size={13} />
                  Entscheidungs-Kompass
                </Badge>
                <span className="text-xs text-slate-500">
                  {best
                    ? `Preismeldung ${timeLabel(best.observed_at)}`
                    : "Keine simulierten Preise"}
                </span>
              </div>
              <div
                className={`relative rounded-xl border p-5 sm:p-6 ${best ? "border-emerald-500/30 bg-gradient-to-br from-emerald-950/70 via-slate-900 to-slate-900 glow-emerald" : "border-amber-500/20 bg-gradient-to-br from-amber-950/30 via-slate-900 to-slate-900"}`}
              >
                <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
                  <div className="flex items-start gap-4">
                    <div
                      className={`rounded-2xl border p-3 ${best ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-amber-500/20 bg-amber-500/10 text-amber-400"}`}
                    >
                      {best ? <FuelIcon size={28} /> : <Clock size={28} />}
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-widest text-slate-400">
                        {best
                          ? "Aktuell am günstigsten"
                          : "Ehrlich statt geschätzt"}
                      </p>
                      <h3
                        id="compass-title"
                        className="mt-1 text-xl font-bold text-white sm:text-2xl"
                      >
                        {best ? best.name : "Noch kein frischer Preis."}
                      </h3>
                      <p className="mt-2 max-w-lg text-xs leading-relaxed text-slate-400">
                        {best
                          ? `Unter deinen ausgewählten Stationen in ${activeCity}. Das ist ein Preisvergleich, noch keine Empfehlung für eine Extra-Fahrt.`
                          : "Sobald der Pi Preise hochlädt und der NAS-Lesezugang eingerichtet ist, erscheinen sie hier automatisch."}
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
                    {best?.maps_url ? (
                      <a
                        href={best.maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                      >
                        Route öffnen
                        <ArrowUpRight size={15} />
                      </a>
                    ) : (
                      <span className="mt-3 block text-xs text-slate-500">
                        {best
                          ? "Keine Koordinaten hinterlegt"
                          : "Route erst mit Stationsdaten"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="relative mt-5 flex items-start gap-2.5 text-xs leading-relaxed text-slate-400">
                <ShieldCheck
                  size={17}
                  className="mt-0.5 shrink-0 text-sky-400"
                />
                <p>
                  <span className="font-medium text-slate-200">
                    Jetzt oder warten?
                  </span>{" "}
                  Eine belastbare Warteempfehlung ist noch nicht freigegeben.
                  Historie und Prognosen werden geprüft — bis dahin zählen hier
                  nur aktuelle Preismeldungen.
                </p>
              </div>
            </section>
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
                detail="Reiner Preisunterschied pro Füllung — Sprit- und Zeitkosten des Umwegs rechnet weiter unten „Rechnet sich der Umweg?“."
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
                  className="my-5 w-full"
                />
                <p className="text-[11px] text-slate-500">
                  Nur zur Berechnung. Keine Buchung, keine erfundene Ersparnis.
                </p>
              </div>
            </div>
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
                  <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
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
                            ? "z-10 scale-105 border-emerald-400 bg-emerald-950/80"
                            : cell.tone === "cheap"
                              ? "border-emerald-500/30 bg-emerald-900/30"
                              : cell.tone === "pricey"
                                ? "border-rose-500/30 bg-rose-950/30"
                                : cell.tone === "mid"
                                  ? "border-slate-700/40 bg-slate-800/40"
                                  : "border-slate-800 bg-slate-950/40"
                        }`}
                      >
                        <div className="font-mono text-[10px] text-slate-400">
                          {String(cell.hour).padStart(2, "0")}:00
                        </div>
                        <div
                          className={`mt-0.5 truncate font-mono text-[11px] font-bold sm:text-xs ${
                            cell.value === null
                              ? "text-slate-600"
                              : cell.tone === "cheap"
                                ? "text-emerald-300"
                                : cell.tone === "pricey"
                                  ? "text-rose-300"
                                  : "text-slate-200"
                          }`}
                        >
                          {cell.value === null ? "–" : euro(cell.value, 3)}
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
            <section
              className={`${panel} mb-6 p-5 sm:p-6`}
              aria-labelledby="detour-heading"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3
                  id="detour-heading"
                  className="flex items-center gap-2 text-sm font-semibold"
                >
                  <Route size={16} className="text-emerald-400" />
                  Rechnet sich der Umweg?
                </h3>
                <span className="font-mono text-[11px] text-slate-500">
                  K = d · (c/100) · p + (d/v) · z
                </span>
              </div>
              {detourOptions.length ? (
                <>
                  <p className="mb-4 text-xs leading-relaxed text-slate-400">
                    Gegenüber deiner Vergleichsstation (
                    <span className="font-medium text-slate-200">
                      {selected?.name}
                    </span>
                    ): günstigere frische Stationen in {activeCity}. Entfernung
                    als Luftlinie — der echte Straßenweg ist meist länger, der
                    Umweg rechnet sich also eher noch weniger.
                  </p>
                  {detourMode === "dedicated" && (
                    <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/40 p-3 text-xs leading-relaxed text-rose-200">
                      <span className="font-semibold">Extrafahrt:</span> Bei
                      12 €/h Zeitwert ist eine Extrafahrt von zuhause praktisch
                      nie wirtschaftlich — fahr nur hin, wenn du ohnehin an der
                      Station vorbeikommst.
                    </p>
                  )}
                  <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label
                      htmlFor="consumption"
                      className="text-xs text-slate-400"
                    >
                      Verbrauch{" "}
                      <span className="font-mono font-semibold text-emerald-400">
                        {consumption} L/100 km
                      </span>
                      <input
                        id="consumption"
                        type="range"
                        min={4}
                        max={15}
                        step={1}
                        value={consumption}
                        onChange={(e) => setConsumption(Number(e.target.value))}
                        className="mt-3 w-full"
                      />
                    </label>
                    <label htmlFor="speed" className="text-xs text-slate-400">
                      Stadt-/Pendel-Tempo{" "}
                      <span className="font-mono font-semibold text-emerald-400">
                        {speed} km/h
                      </span>
                      <input
                        id="speed"
                        type="range"
                        min={25}
                        max={80}
                        step={5}
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                        className="mt-3 w-full"
                      />
                    </label>
                    <label
                      htmlFor="timeValue"
                      className="text-xs text-slate-400"
                    >
                      Zeitwert{" "}
                      <span className="font-mono font-semibold text-emerald-400">
                        {timeValue > 0
                          ? `${timeValue} €/h`
                          : `Auto (${timeValueUsed} €/h ${autoZ.isPeak ? "Peak" : "offpeak"})`}
                      </span>
                      <input
                        id="timeValue"
                        type="range"
                        min={0}
                        max={30}
                        step={1}
                        value={timeValue}
                        onChange={(e) => setTimeValue(Number(e.target.value))}
                        className="mt-3 w-full"
                      />
                      <span className="mt-1 block text-[10px] text-slate-500">
                        0 = Auto: 16 €/h im Peak (16:30–20:00), sonst 10 €/h.
                      </span>
                    </label>
                    <label
                      htmlFor="detourMode"
                      className="text-xs text-slate-400"
                    >
                      Fahrtcharakter
                      <select
                        id="detourMode"
                        aria-label="Fahrtcharakter"
                        value={detourMode}
                        onChange={(e) =>
                          setDetourMode(
                            e.target.value as DetourMode,
                          )
                        }
                        className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-200"
                      >
                        <option value="onroute">
                          Auf dem Weg (nur Mehrweg)
                        </option>
                        <option value="dedicated">
                          Extrafahrt (Hin & Rück)
                        </option>
                      </select>
                    </label>
                  </div>
                  <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800">
                    {detourOptions.map((option) => {
                      const worth =
                        option.economics.verdict === "worth";
                      const borderline =
                        option.economics.verdict === "borderline";
                      return (
                        <div
                          key={option.row.station_id}
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-200">
                              {option.row.name}{" "}
                              <span className="font-mono text-emerald-400">
                                {euro(option.altPrice, 3)} €/L
                              </span>
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {option.km.toLocaleString("de-DE", {
                                maximumFractionDigits: 1,
                              })}{" "}
                              km Luftlinie · Ersparnis{" "}
                              {euro(option.economics.grossEur)} · Sprit{" "}
                              {euro(option.economics.fuelEur)} · Zeit{" "}
                              {euro(option.economics.timeEur)} · erst ab{" "}
                              {option.economics.criticalCtPerL.toLocaleString(
                                "de-DE",
                                { maximumFractionDigits: 1 },
                              )}{" "}
                              ct/L günstiger
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span
                              className={`font-mono text-lg font-bold tabular-nums ${worth ? "text-emerald-400" : borderline ? "text-amber-300" : "text-slate-400"}`}
                            >
                              {euro(option.economics.netEur)} € netto
                            </span>
                            <Badge warning={!worth}>
                              {worth
                                ? "lohnenswert"
                                : borderline
                                  ? "grenzwertig"
                                  : "lohnt sich nicht"}
                            </Badge>
                            <button
                              onClick={() => setRouteAltId(option.row.station_id)}
                              className={`rounded-lg border px-2 py-1 text-[11px] ${routeAltId === option.row.station_id ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-700 bg-slate-900 text-slate-400 hover:text-white"}`}
                            >
                              Server prüfen
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {routeEval.data && !routeEval.error && (
                    <div className="mt-5 rounded-xl border border-sky-500/25 bg-sky-950/30 p-4">
                      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold text-sky-300">
                        <Cpu size={14} /> Serverseitige Prüfung: /v1/route/evaluate
                      </h4>
                      <div className="grid gap-3 text-xs sm:grid-cols-3">
                        <div>
                          <p className="text-slate-500">Referenz → Ziel</p>
                          <p className="font-mono text-slate-200">
                            {euro(routeEval.data.ref_price, 3)} → {euro(routeEval.data.alt_price, 3)} €/L
                          </p>
                          <p className="text-slate-400">Δ {routeEval.data.delta_ct} ct/L</p>
                        </div>
                        <div>
                          <p className="text-slate-500">Kosten</p>
                          <p className="text-slate-200">
                            Brutto {euro(routeEval.data.gross_eur)} € · Umweg {euro(routeEval.data.detour_cost_eur)} €
                          </p>
                          <p className="text-slate-400">
                            Sprit {euro(routeEval.data.fuel_cost_eur)} · Zeit {euro(routeEval.data.time_cost_eur)} · z={routeEval.data.z_used} €/h {routeEval.data.z_auto ? "(auto)" : ""} {routeEval.data.is_peak ? "Peak" : "Offpeak"}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">Netto</p>
                          <p className={`font-mono text-lg font-bold ${routeEval.data.worth_it ? "text-emerald-400" : "text-amber-300"}`}>
                            {euro(routeEval.data.net_eur)} € {routeEval.data.verdict}
                          </p>
                          <p className="text-slate-400">Kritisch ab {routeEval.data.critical_delta_ct} ct/L</p>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        Modus {routeEval.data.mode} · {routeEval.data.detour_km_oneway} km einfach, {routeEval.data.detour_km_total} km gesamt · Liter {routeEval.data.liters} · Stadt {routeEval.data.city || "—"}
                      </p>
                    </div>
                  )}
                  {routeEval.error && (
                    <p className="mt-3 text-xs text-amber-300">
                      Server-Evaluierung fehlgeschlagen — lokale Rechnung bleibt gültig.
                    </p>
                  )}
                </>
              ) : (
                <Empty>
                  Kein günstigerer frischer Preis in {activeCity} — dann
                  rechnet sich aktuell kein Umweg. Die Rechnung erscheint
                  automatisch, sobald eine ausgewählte Stadt mehrere frische
                  Preise mit Entfernungen meldet.
                </Empty>
              )}
              <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
                Netto-Ersparnis = (Dein Preis − günstigerer Preis) × Tankmenge
                − Kraftstoff des Umwegs − Zeitwert der Umwegzeit. „Lohnenswert“
                ab 1,50 €, „grenzwertig“ ab 0,50 €. Reine Rechenhilfe über
                deine Angaben — keine Buchung, keine garantierte Ersparnis. Der
                Server-Endpunkt /v1/route/evaluate rechnet dieselbe Formel mit
                denselben Preisen serverseitig (optional, UI rechnet auch lokal).
              </p>
            </section>
            <section
              className={`${panel} overflow-hidden`}
              aria-labelledby="stations-heading"
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <div>
                  <h3 id="stations-heading" className="text-sm font-semibold">
                    Deine Stationen
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Station antippen, um sie als Vergleich zu wählen.
                  </p>
                </div>
                <span className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-400">
                  {stations.length} im Set
                </span>
              </div>
              {stations.length ? (
                <div className="divide-y divide-slate-800/80">
                  {stations.map((row) => {
                    const value = price(row);
                    const age =
                      row.age_minutes === null
                        ? null
                        : Math.max(0, row.age_minutes + elapsed);
                    const label = !row.observed_at
                      ? "Keine Meldung"
                      : !online || age! > 30
                        ? "Stand veraltet"
                        : row.status === "closed"
                          ? "Geschlossen"
                          : value === null
                            ? "Kein Kraftstoffpreis"
                            : "Offen";
                    return (
                      <div
                        key={row.station_id}
                        className={`flex w-full items-center justify-between gap-2 px-5 py-4 transition-colors hover:bg-slate-800/40 ${selected?.station_id === row.station_id ? "bg-emerald-500/[.04]" : ""}`}
                      >
                        <button
                          onClick={() => setSelectedId(row.station_id)}
                          aria-pressed={selected?.station_id === row.station_id}
                          aria-label={`${row.name} als Vergleich wählen`}
                          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${row.station_id === best?.station_id ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-slate-700 bg-slate-800 text-slate-500"}`}
                          >
                            <FuelIcon size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-200">
                              {row.name}
                            </p>
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                              <span
                                className={
                                  value !== null
                                    ? "text-emerald-400"
                                    : "text-amber-400"
                                }
                              >
                                {label}
                              </span>
                              <span>{row.brand || "Freie Station"}</span>
                              {row.dist_km != null && (
                                <span
                                  title={
                                    row.dist_mode === "road"
                                      ? "Fahrstrecke mit dem Auto vom Anker dieser Stadt"
                                      : "Luftlinie zum Anker — Straßenroute gerade nicht verfügbar"
                                  }
                                  className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                                >
                                  {row.dist_km.toLocaleString("de-DE", {
                                    maximumFractionDigits: 1,
                                  })}{" "}
                                  km{" "}
                                  {row.dist_mode === "road" ? "Fahrt" : "Luftlinie"}
                                </span>
                              )}
                              <span>
                                {age === null
                                  ? "Noch keine Daten"
                                  : `vor ${Math.floor(age)} Min.`}
                              </span>
                              {selected?.station_id === row.station_id && (
                                <span className="text-sky-400">
                                  Vergleichsstation
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                            <div className="flex shrink-0 items-center gap-3">
                              <div className="text-right">
                                <div
                                  className={`font-mono text-lg font-bold tabular-nums ${row.station_id === best?.station_id ? "text-emerald-400" : "text-slate-200"}`}
                                >
                                  {euro(value, 3)}{" "}
                                  <span className="text-[10px] font-normal text-slate-500">
                                    €/L
                                  </span>
                                </div>
                                {value === null && row.last_price !== null && (
                                  <div className="text-[10px] text-slate-500">
                                    Letzte Meldung: {euro(row.last_price, 3)} €
                                  </div>
                                )}
                              </div>
                              <ChevronRight
                                size={15}
                                className="text-slate-600"
                              />
                            </div>
                          </button>
                          {row.maps_url ? (
                            <a
                              href={row.maps_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Route zu ${row.name} öffnen`}
                              title="Route öffnen"
                              className="shrink-0 rounded-lg border border-slate-700 p-2 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400"
                            >
                              <ArrowUpRight size={15} />
                            </a>
                          ) : null}
                        </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-5">
                  <Empty>
                    Hier erscheinen die Stationen aus deinem gemeinsamen
                    Polling-Set. Für Gütersloh ist keine Preis-Historienanalyse
                    als Voraussetzung nötig.
                  </Empty>
                </div>
              )}
              {stations.length > 0 &&
                !stations.some((row) => row.dist_km != null) && (
                  <p className="border-t border-slate-800/80 px-5 py-3 text-[11px] leading-relaxed text-slate-500">
                    Kein km-Wert angezeigt: Für dieses Set ist noch kein
                    Referenzpunkt dieser Stadt hinterlegt. Einmal mit{" "}
                    <code className="text-slate-300">
                      tankapp.py add-city
                    </code>{" "}
                    setzen — danach erscheint die Autostrecke vom Anker.
                  </p>
                )}
            </section>
          </>
        )}

        {tab === "statistics" && (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[.2em] text-sky-400">
                  Werkstatt / Statistik
                </p>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Nachvollziehen statt blind vertrauen.
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  Beobachtungen, Modellstand und Güte — keine Beispielzahlen.
                </p>
              </div>
              <label className="text-xs text-slate-400">
                Station
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
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Backtest · mittlerer absoluter Fehler"
                value={
                  <>
                    {euro(metrics?.mae_ct)}{" "}
                    <span className="text-sm font-normal text-slate-500">
                      ct/L
                    </span>
                  </>
                }
                detail="Letzte 7 abgeschlossene Prüftage des Roll-Backtests; kein kalibrierter Live-Gütenachweis."
                tip="Mittlerer absoluter Fehler (MAE): der durchschnittliche Abstand zwischen Prognose und tatsächlichem Preis in Cent pro Liter. 1,0 ct/L heißt: über die letzten 7 Prüftage lag die Prognose im Schnitt 1 Cent daneben — Richtung (zu hoch/zu tief) wird nicht gemischt, nur die Größe zählt."
              />
              <Metric
                label="Vergleich zur saisonalen Naive · MASE"
                value={euro(metrics?.mase)}
                detail="Skalierte Vergleichszahl: kleiner als 1,0 = besser als die Vergleichsmethode."
                tip="Mean Absolute Scaled Error (MASE) = Backtest-MAE geteilt durch den MAE der saisonalen Naive, die einfach das Tagesprofil von gestern wiederholt. MASE 1,0 heißt: genau so gut wie 'gestern übernehmen'. Werte deutlich unter 1,0: das Modell liefert echten Zusatznutzen. Werte über 1,0: die einfache Vergleichsmethode war besser."
              />
              <Metric
                label="Beobachtete Vergleichspunkte"
                value={metrics?.points ?? "—"}
                detail="5-Minuten-Zeitpunkte, an denen Prognose und echter gemeldeter Preis verglichen wurden."
                tip="Nur hier gezählt: Zeitpunkte mit echten gemeldeten Preisen im Backtest-Fenster. Keine simulierten Trefferquoten, keine Füllwerte. Wenige Punkte machen MAE und MASE unsicherer — die Zahl zeigt, wie viel Material die Kennzahlen tragen."
              />
              <Metric
                label="95-%-Band-Trefferquote · PICP"
                value={
                  <>
                    {euro(metrics?.picp95_pct, 1)}{" "}
                    <span className="text-sm font-normal text-slate-500">
                      %
                    </span>
                  </>
                }
                detail="Anteil echter Preise im 95-%-Band des Backtests. Ziel: 90–98 %."
                tip="Prediction Interval Coverage Probability (PICP): Wie viel Prozent der echten Preise lagen im vorhergesagten 95-%-Band? Zielkorridor 90–98 %. Darunter: Band zu eng oder Markt zu unruhig. Darüber: Band zu breit, Aussage zu vage. Backtest-Wert, kein Live-Nachweis."
              />
            </div>
            <section className={`${panel} mb-6 p-5 sm:p-6`}>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Stations-Labor · {spanLabel}
                </h3>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-slate-500">
                    Zeitraum{" "}
                    <select
                      aria-label="Zeitraum des Stations-Labors"
                      value={spanHours}
                      onChange={(e) => setSpanHours(Number(e.target.value))}
                      className="ml-1 rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-200"
                    >
                      <option value={24}>24 Stunden</option>
                      <option value={72}>3 Tage</option>
                      <option value={168}>7 Tage</option>
                    </select>
                  </label>
                  <Badge warning={!observations.length}>
                    Echte Polling-Beobachtungen
                  </Badge>
                </div>
              </div>
              {history.error || history.data?.error_code ? (
                <Empty>
                  {problem(history.data?.error_code) ||
                    "Der Preisverlauf konnte nicht geladen werden."}
                </Empty>
              ) : series.length ? (
                <LineChart
                  series={series}
                  xDomain={obsWindow}
                  xTicks={autoTimeTicks(obsWindow[0], obsWindow[1])}
                  yFmt={(v) => euro(v, 3)}
                  gapMinutes={90}
                  gapLabel="Pause"
                  maxGapMinutes={40}
                />
              ) : (
                <Empty>
                  {history.pending
                    ? "Beobachtungen werden geladen …"
                    : "Noch kein Preisverlauf vorhanden. Lücken und geschlossene Zeiträume werden nicht mit erfundenen Preisen verbunden."}
                </Empty>
              )}
              {dayStats && (
                <p className="mt-4 text-xs text-slate-400">
                  {dayStats.n} offene Meldungen · Spanne{" "}
                  <span className="font-mono font-semibold text-slate-200">
                    {euro(dayStats.min, 3)}–{euro(dayStats.max, 3)} €/L
                  </span>
                </p>
              )}
              <p className="mt-2 text-[11px] text-slate-500">
                {spanLabel[0].toUpperCase() + spanLabel.slice(1)},
                Europe/Berlin · €/L. Der letzte offene Preis bleibt als Stufe
                stehen, bis die nächste Meldung kommt. Lange Pausen (Nacht,
                geschlossen) werden auf der Achse gestaucht — die Markierung
                „Pause · h“ zeigt die echte Dauer, der Verlauf behält den Platz.
              </p>
            </section>
            <section className={`${panel} p-5 sm:p-6`}>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Modell-Ausblick</h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Ab Fit-Zeitpunkt {timeLabel(f?.origin)} · 12-Uhr-Regel:
                    Erhöhungen nur um 12:00 Uhr, Median und Bänder sind darauf
                    projiziert
                  </p>
                </div>
                <div
                  role="group"
                  aria-label="Horizont des Modell-Ausblicks"
                  className="flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs font-bold"
                >
                  {(
                    [
                      { days: 0, label: "Heute" },
                      { days: 3, label: "+3 Tage" },
                      { days: 7, label: "+7 Tage" },
                    ] as const
                  ).map((entry) => {
                    const available =
                      entry.days === 0 ||
                      (entry.days === 3 && !!f?.points_3d?.length) ||
                      (entry.days === 7 && !!f?.points_7d?.length);
                    return (
                      <button
                        key={entry.days}
                        disabled={!available}
                        aria-pressed={horizon === entry.days}
                        title={
                          available
                            ? undefined
                            : "Dieser Horizont fehlt im NAS-Ergebnis"
                        }
                        onClick={() => setHorizon(entry.days)}
                        className={`rounded-lg px-3 py-1.5 transition-colors ${horizon === entry.days ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"}`}
                      >
                        {entry.label}
                      </button>
                    );
                  })}
                </div>
                <Badge warning>
                  <span className="cursor-help" title={calibrationTip}>
                    Unkalibriert · keine Handlungsempfehlung
                  </span>
                </Badge>
              </div>
              {f?.stale || f?.retained_previous || f?.stale_data_at_origin ? (
                <p className="mb-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">
                  {f.stale || f.retained_previous
                    ? "Älteres Modellergebnis: kein neuer erfolgreicher Fit für diese Station."
                    : "Am Fit-Zeitpunkt waren die Eingangsdaten nicht frisch."}{" "}
                  Nicht als aktuellen Tankzeitpunkt verwenden.
                </p>
              ) : null}
              {(horizon === 3 && horizonDays !== 3) ||
              (horizon === 7 && horizonDays !== 7) ? (
                <p className="mb-4 rounded-lg bg-slate-800/60 p-3 text-xs text-slate-400">
                  Der gewählte Horizont fehlt in diesem NAS-Ergebnis — gezeigt
                  werden 24 Stunden.
                </p>
              ) : null}
              {forecast.error ? (
                <Empty>Modellstand konnte nicht geladen werden.</Empty>
              ) : modelSeries.length ? (
                <LineChart
                  series={modelSeries}
                  bands={[...fanBand95, ...fanBand80]}
                  marks={forecastMarks}
                  xDomain={forecastWindow ?? undefined}
                  xTicks={
                    forecastWindow
                      ? autoTimeTicks(forecastWindow[0], forecastWindow[1])
                      : []
                  }
                  gapMinutes={90}
                  gapLabel="ohne Stütze"
                  maxGapMinutes={40}
                  yFmt={(v) => euro(v, 3)}
                />
              ) : (
                <Empty>
                  {problem(f?.error_code) ||
                    "Die NAS-Modellaktualisierung veröffentlicht hier ihr erstes erfolgreiches Ergebnis. Die Live-Preisansicht wartet nicht darauf."}
                </Empty>
              )}
              {f?.data_policy && (
                <p className="mt-4 text-xs text-slate-400">
                  Datenbasis am Fit:{" "}
                  <span className="font-semibold text-slate-200">
                    {f.data_policy.mode === "live_only"
                      ? "Nur Polling"
                      : "Archiv-Warmstart + Polling"}
                  </span>{" "}
                  · {f.data_policy.good_complete_live_days}/
                  {f.data_policy.required_complete_live_days} ausreichend
                  abgedeckte Live-Tage. Das NAS-Archiv bleibt erhalten.
                </p>
              )}
              <div className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-slate-400">
                <ShieldCheck size={16} className="shrink-0 text-sky-400" />
                <p>
                  Archiv und Polling stammen beide von Tankerkönig. Historische
                  Modelltests sind noch kein nachgewiesener
                  Echtzeit-Entscheidungserfolg. Die Freigabe von
                  Warteempfehlungen bleibt gesperrt.
                </p>
              </div>
            </section>
            <section className={`${panel} mt-6 p-5 sm:p-6`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Clock size={16} className="text-sky-400" />
                  Günstigste Modell-Fenster · {selected?.name || "—"}
                </h3>
                <Badge warning>Analyse, keine Empfehlung</Badge>
              </div>
              {modelWindows.length ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {modelWindows.map((window, i) => (
                      <div
                        key={window.start}
                        className={`rounded-xl border p-4 ${
                          i === 0
                            ? "border-emerald-500/30 bg-emerald-500/[.06]"
                            : "border-slate-800 bg-slate-950/40"
                        }`}
                      >
                        <p className="text-xs font-semibold text-slate-300">
                          {i === 0 ? "🏆 " : i === 1 ? "🥈 " : "🥉 "}
                          {clockLabel(new Date(window.start).toISOString())}–
                          {clockLabel(new Date(window.end).toISOString())} Uhr
                        </p>
                        <p className="mt-1 font-mono text-xl font-bold text-slate-100">
                          ~{euro(window.median, 3)} €/L
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Median des unkalibrierten Ausblicks in diesem
                          2-h-Block.
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                    Abgelesen aus der Medianlinie oben — ohne Prozent, ohne
                    Ersparnisversprechen, ohne Handlung. Erst nach
                    nachgewiesener Kalibrierung (Brier &lt; 0,25 bei ≥ 100
                    Empfehlungen) wird daraus eine Alltags-Empfehlung.
                  </p>
                </>
              ) : (
                <Empty>
                  Keine Modell-Fenster: Erst mit einem erfolgreichen
                  Modellergebnis lassen sich Blöcke ablesen. Es werden keine
                  Fenster erfunden.
                </Empty>
              )}
            </section>
            <section className={`${panel} mt-6 p-5 sm:p-6`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Scale size={16} className="text-emerald-400" />
                  Entscheidungs-Regel · Startwerte
                </h3>
                <Badge warning>M7-Kalibrierung steht aus</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="py-2 pr-3 font-medium">
                        Erwartete Ersparnis
                      </th>
                      <th className="py-2 pr-3 font-medium">P_besser</th>
                      <th className="py-2 font-medium">Regel-Antwort</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    <tr>
                      <td className="py-2 pr-3 font-mono">≥ 2,00 €</td>
                      <td className="py-2 pr-3 font-mono">≥ 70 %</td>
                      <td className="py-2">
                        <span className="font-semibold text-emerald-400">
                          WARTEN
                        </span>{" "}
                        bis zum besten Fenster
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-mono">≥ 1,00 €</td>
                      <td className="py-2 pr-3 font-mono">≥ 60 %</td>
                      <td className="py-2">Warten lohnt eher</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-mono">&lt; 1,00 €</td>
                      <td className="py-2 pr-3 font-mono">beliebig</td>
                      <td className="py-2">
                        <span className="font-semibold text-emerald-400">
                          JETZT
                        </span>{" "}
                        tanken
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-mono">beliebig</td>
                      <td className="py-2 pr-3 font-mono">&lt; 50 %</td>
                      <td className="py-2">
                        JETZT tanken (Prognose unsicher)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Signifikanzschwelle θ = 1 ct gegen Rauschen · Umweg lohnt ab
                1,50 € netto, grenzwertig ab 0,50 € · P_besser 40–60 % oder
                Band außerhalb Toleranz → „Keine klare Empfehlung“. Die
                Produktion entscheidet erst mit diesen Schwellen, wenn M7 sie
                an gemessenen Trefferquoten bestätigt hat.
              </p>
            </section>

            {/* B3: Heatmaps DoW×Stunde */}
            <section className={`${panel} mt-6 p-5 sm:p-6`}>
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
                    "Heatmap konnte nicht geladen werden. InfluxDB-Zugang prüfen und ausreichend Historie (≥2 Wochen) sammeln. Keine Muster erfinden."}
                </Empty>
              ) : heatmap.data && heatmap.data.matrix.length ? (
                <HeatmapGrid heatmap={heatmap.data} />
              ) : (
                <Empty>
                  {heatmap.pending
                    ? "Heatmap wird aus echten Polling-Daten berechnet …"
                    : "Noch keine Daten für Heatmap vorhanden. Erst nach einigen Tagen Live-Betrieb erscheinen hier Muster."}
                </Empty>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Niveau = Medianpreis je (Wochentag, Stunde) über {heatmapWeeks} Wochen, Europe/Berlin. Cheap-Probability =
                P(Station ≤ Stadtmedian zum gleichen Zeitpunkt). Grün = günstig/hohe Chance. Nur echte offene Meldungen, keine
                erfundenen Preise. Quelle: InfluxDB.
              </p>
            </section>

            {/* B3: Meine Stationen mit δ̂ */}
            <section className={`${panel} mt-6 p-5 sm:p-6`}>
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
                    "Selektions-Artefakte fehlen noch auf dem NAS. Nach Modell-Job (training/*.csv.gz) erscheint hier das Ranking mit δ̂, Bootstrap-KI, AV-Score und billigster Stunde."}
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
                        <th className="py-2 pr-3">σ ct</th>
                        <th className="py-2 pr-3">Coverage</th>
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
                          <td className="py-2 pr-3 font-mono">{s.vol_ct != null ? s.vol_ct.toFixed(2) : "—"}</td>
                          <td className="py-2 pr-3 font-mono">{s.coverage !== undefined ? `${(s.coverage * 100).toFixed(0)}%` : "—"}</td>
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
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                δ̂ = Median(p_i − LOO-Stadtmedian) in ct/L, negativ = günstiger als Umgebung. 95%-KI aus Tages-Block-Bootstrap (B=200),
                q = Benjamini-Hochberg-FDR, signifikant bei q&lt;0.05. AV-Score = Σ w_h·P(Top-3|h) mit Pendlerprofil Mo–Fr 06–09/16–20.
                Billigste Stunde = argmin Medianpreis je halbe Stunde (Berlin). Nur echte Trainingsdaten, keine Demo-Rankings.
              </p>
            </section>
          </>
        )}

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
            <div className="mb-6 grid gap-4 sm:grid-cols-3">
              <Metric
                label="NAS-Web-App / API"
                value={h ? "Erreichbar" : "—"}
                detail="Ein laufender Webserver beweist noch keine frischen InfluxDB-Daten."
              />
              <Metric
                label="Konfigurierte Stationen"
                value={h?.station_count ?? "—"}
                detail="UUID-getrennte Stadtsets. Keine zusätzlichen Tankerkönig-Requests durch diese GUI."
              />
              <Metric
                label="Letzte Modellveröffentlichung"
                value={
                  <span className="text-lg">
                    {timeLabel(h?.models.published_at)}
                  </span>
                }
                detail={`${h?.models.count ?? 0} vorhandene Ausblicke; Empfehlungen noch nicht kalibriert.`}
              />
            </div>
            <div className="mb-6 grid gap-4 lg:grid-cols-3">
              <JobCard
                title="Tankerkönig-Archiv"
                icon={<Database size={17} className="text-emerald-400" />}
                job={h?.jobs.archive}
                enabled={h?.jobs_enabled}
              />
              <JobCard
                title="Modellaktualisierung"
                icon={<ChartIcon size={17} className="text-sky-400" />}
                job={h?.jobs.models}
                enabled={h?.jobs_enabled}
              />
              <JobCard
                title="Selektion δ̂ Ranking"
                icon={<Activity size={17} className="text-emerald-400" />}
                job={h?.jobs.selection}
                enabled={h?.jobs_enabled}
              />
            </div>

            {/* B3: Pi/tmpfs Livestatus */}
            <section className={`${panel} mb-6 p-5 sm:p-6`}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Cpu size={17} className="text-emerald-400" />
                  Pi / tmpfs Livestatus · Collector-Herzschlag
                </h3>
                <Badge warning={!h?.collector?.available}>
                  {h?.collector?.fresh ? "Frisch" : h?.collector?.available ? "Veraltet" : "Kein Herzschlag"}
                </Badge>
              </div>
              {h?.collector?.available ? (
                <div className="grid gap-4 text-xs sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Letzter Poll (Pi)</span>
                      <span className="font-mono text-slate-200">{timeLabel(h.collector.last_poll_at)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Alter</span>
                      <span className="font-mono">{h.collector.age_minutes !== null ? `${h.collector.age_minutes} Min.` : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Letzter Herzschlag (Influx)</span>
                      <span className="font-mono text-slate-200">{timeLabel(h.collector.influx?.last_heartbeat_at || h.collector.last_poll_at)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Poll Count</span>
                      <span className="font-mono">{(h.collector.influx?.fields?.poll_count as number) ?? h.collector.local?.poll_count ?? "—"}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-500">tmpfs belegt</span>
                      <span className="font-mono">
                        {h.collector.tmpfs_used_bytes !== null && h.collector.tmpfs_used_bytes !== undefined
                          ? `${(Number(h.collector.tmpfs_used_bytes) / 1024 / 1024).toFixed(2)} MiB`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">tmpfs gesamt</span>
                      <span className="font-mono">
                        {h.collector.tmpfs_total_bytes
                          ? `${(Number(h.collector.tmpfs_total_bytes) / 1024 / 1024).toFixed(1)} MiB`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Älteste Datei</span>
                      <span className="font-mono">{h.collector.oldest_age_days !== null && h.collector.oldest_age_days !== undefined ? `${h.collector.oldest_age_days} Tage` : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Stadt (letzter Poll)</span>
                      <span className="font-mono">{(h.collector.local?.city as string) || (h.collector.influx?.fields?.city as string) || "—"}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <Empty>
                  {problem(h?.collector?.error_code || h?.collector?.influx?.error_code) ||
                    "Noch kein Collector-Herzschlag auf dem NAS. Der Pi muss meta/heartbeat.json schreiben und der Uploader collector_status nach InfluxDB liefern. Siehe docs/BETRIEB.md."}
                </Empty>
              )}
              <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
                Der Collector (Pi) schreibt jede 5 Min. einen Snapshot nach /dev/shm/tankapp und aktualisiert meta/heartbeat.json
                (tmpfs-Nutzung, älteste Datei). Der Uploader überträgt den Herzschlag als Measurement collector_status in InfluxDB
                (alle 60s). Das NAS liest den letzten Punkt und zeigt ihn hier. Frisch = ≤15 Min. alter Herzschlag.
              </p>
            </section>

            <section className={`${panel} mb-6 p-5 sm:p-6`}>
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                <Database size={17} className="text-emerald-400" />
                Langfristiges Archiv auf dem NAS
              </h3>
              <div className="grid gap-5 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">Gespeicherter Beginn</p>
                  <p className="mt-1 font-mono">
                    {h?.archive.archive_since || "Noch nicht begonnen"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">
                    Zuletzt vollständig bis
                  </p>
                  <p className="mt-1 font-mono">
                    {h?.archive.last_complete_until ||
                      "Noch kein vollständiger Zeitraum"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">
                    Fehlende Tagesdateien
                  </p>
                  <p className="mt-1 font-mono">
                    {h?.archive.missing_files ?? "Noch nicht geprüft"}
                  </p>
                </div>
              </div>
              <p className="mt-5 text-xs leading-relaxed text-slate-400">
                Ein Jahr oder mehr Preis- und Stationshistorie. Nach
                NAS-Auszeiten werden auch ältere Lücken nachgeladen. Das Archiv
                bleibt erhalten, wenn das Modell nur noch jüngste Polling-Daten
                verwendet.
              </p>
            </section>

            {/* Selection summary in System */}
            <section className={`${panel} mb-6 p-5 sm:p-6`}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Activity size={17} className="text-emerald-400" />
                  Meine Stationen · NAS Artefakte
                </h3>
                <Badge warning={!h?.selection || h.selection.count === 0}>
                  {h?.selection?.count ? `${h.selection.count} Stationen` : "Keine Artefakte"}
                </Badge>
              </div>
              {h?.selection?.count ? (
                <div className="text-xs text-slate-400">
                  <p>
                    Letzte Selektion: {timeLabel(h.selection.published_at)} · {h.selection.count} Stationen im Ranking.
                    Vollständige Tabelle in der Werkstatt (Tab Statistik).
                  </p>
                  {selection.data && (
                    <p className="mt-2">
                      Top-1: {selection.data.stations[0]?.name} (δ̂ {selection.data.stations[0]?.delta_ct} ct/L, AV {selection.data.stations[0]?.avail})
                    </p>
                  )}
                </div>
              ) : (
                <Empty>
                  {problem(h?.selection?.error_code) ||
                    "Selektions-Artefakte fehlen noch auf dem NAS. Der Job 'selection' baut sie aus training/*.csv.gz. Siehe docs/ANALYSE.md."}
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
                ohne Poll auszulösen. Neu in B3: heatmap, selection, collector/status, route/evaluate.
              </p>
              <ApiExplorer fuel={fuel} identity={identity} activeCity={activeCity} />
            </section>
            <section className={`${panel} p-5 sm:p-6`}>
              <h3 className="mb-4 text-sm font-semibold">
                Einrichtung & Betriebsgrenzen
              </h3>
              <ul className="space-y-3 text-sm text-slate-400">
                {h?.polling_error && (
                  <li className="flex gap-2 text-amber-300">
                    <AlertCircle size={17} className="shrink-0" />
                    {problem(h.polling_error)}
                  </li>
                )}
                {h && !h.influx_configured && (
                  <li className="flex gap-2 text-amber-300">
                    <AlertCircle size={17} className="shrink-0" />
                    Vorhandene private influx.env mit Lese-Token auf dem NAS
                    einbinden. Schlüssel gehören nicht in die GUI.
                  </li>
                )}
                {h && !h.archive_configured && (
                  <li className="flex gap-2 text-amber-300">
                    <AlertCircle size={17} className="shrink-0" />
                    Den vorhandenen Archivzugang als private netrc-Datei auf dem
                    NAS bereitstellen.
                  </li>
                )}
                {h && !h.jobs_enabled && (
                  <li>
                    Diese Instanz läuft ohne Hintergrundjobs. Der NAS-Start über{" "}
                    <code className="text-slate-200">tankapp.py nas-up</code>{" "}
                    schaltet die Zeitsteuerung ein.
                  </li>
                )}
                <li>
                  Für Gütersloh einmal den Anker lokal festlegen und das
                  gemeinsame Polling-Set auf Pi und NAS verwenden. Die GUI wählt
                  Städte aus diesem Set — keine fest eingebauten Beispielstädte.
                </li>
                <li>
                  Bei ausgeschaltetem NAS ist diese Web-App nicht erreichbar.
                  Der Pi puffert unabhängig weiter; der RAM-Puffer überlebt
                  keinen Pi-Stromausfall. Collector-Herzschlag: /dev/shm/tankapp/meta/heartbeat.json → InfluxDB collector_status.
                </li>
                <li>
                  Eine Anleitung, ein Einstieg:{" "}
                  <code className="text-slate-200">docs/README.md</code> mit
                  klickbarem Inhaltsverzeichnis.
                </li>
              </ul>
            </section>
          </>
        )}
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 pt-5 text-[10px] text-slate-600">
          <span>
            Daten: <strong>MTS-K via tankerkoenig.de (CC BY 4.0)</strong> ·
            Token-Bucket 1 R / 300 s · Fenster 06–24 Uhr · B3: heatmap/selection/collector/route
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
