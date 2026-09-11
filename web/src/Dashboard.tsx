// Layout/visual foundation: sample/good gui/TankAppDashboard + DecisionCockpit.
// Workshop composition and charts: sample/good statistic gui/DecisionLab.
// No demo engine, seeds, simulated decisions or PostgreSQL are imported.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  ScrollText,
  Play,
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
  epochLabel,
  euro,
  formatHour,
  haversineKm,
  problem,
  segments,
  timeLabel,
  triggerSkipLabel,
  useResource,
  usePreference,
  postIntent,
  postJobRun,
  jobRunMessage,
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
  type JobLog,
  type JobRunNote,
  JOB_LABELS,
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
  hint,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  tip?: string;
  hint?: ReactNode;
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
      <div className="my-2 text-2xl font-bold tracking-tight text-white tabular-nums sm:text-3xl">
        {value}
      </div>
      <div className="text-[11px] leading-relaxed text-slate-400">{detail}</div>
      {hint && (
        <div className="mt-2 text-[10px] leading-relaxed text-slate-500">
          {hint}
        </div>
      )}
    </div>
  );
}

function JobCard({
  title,
  icon,
  job,
  enabled,
  logKey,
  onShowLog,
  onStarted,
}: {
  title: string;
  icon: ReactNode;
  job?: Job;
  enabled?: boolean;
  /** Job-Name für Log-Sprung und Startknopf (siehe JOB_LABELS). */
  logKey?: string;
  onShowLog?: (job: string) => void;
  /** Nach einem Start: Status sofort neu laden. */
  onStarted?: () => void;
}) {
  const [note, setNote] = useState<JobRunNote | null>(null);
  const [busy, setBusy] = useState(false);
  // Eine neue Job-Phase macht die letzte Start-Meldung gegenstandslos.
  useEffect(() => setNote(null), [job?.state]);
  const startNow = async () => {
    if (!logKey || busy) return;
    setBusy(true);
    const result = await postJobRun(logKey);
    setNote(jobRunMessage(result));
    setBusy(false);
    if (result.status === "queued" || result.status === "running") onStarted?.();
  };
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
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${stateColor}`}>{state}</span>
          {logKey && enabled ? (
            <button
              type="button"
              onClick={() => void startNow()}
              disabled={busy}
              title={`${title} jetzt starten`}
              aria-label={`${title} jetzt starten`}
              className="rounded-md border border-emerald-600/50 p-1 text-emerald-300 transition-colors hover:border-emerald-500 hover:bg-emerald-500/10 disabled:opacity-40"
            >
              <Play size={13} />
            </button>
          ) : null}
          {logKey && onShowLog ? (
            <button
              type="button"
              onClick={() => onShowLog(logKey)}
              title={`Log von ${title} anzeigen`}
              aria-label={`Log von ${title} anzeigen`}
              className="rounded-md border border-slate-700 p-1 text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
            >
              <ScrollText size={13} />
            </button>
          ) : null}
        </div>
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
        {/* Issue 50: Ereignis-Pipeline — Datenstand des letzten erfolgreichen
            Webhook-Triggerlaufs (nur bei models/selection vorhanden). */}
        {job?.data_watermark != null && (
          <div className="flex justify-between">
            <span>Trigger-Datenstand</span>
            <span className="font-mono text-slate-200">
              {epochLabel(job.data_watermark)}
            </span>
          </div>
        )}
        {job?.triggers != null && job.triggers > 0 && (
          <div className="flex justify-between">
            <span>Webhook-Trigger</span>
            <span className="font-mono text-slate-200">
              {job.triggers}×
              {(() => {
                const skip = triggerSkipLabel(job?.last_trigger_skip);
                return skip ? ` · letzter Skip: ${skip}` : "";
              })()}
            </span>
          </div>
        )}
      </div>
      {job?.error_code && (
        <p className="mt-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-300">
          {problem(job.error_code)}
        </p>
      )}
      {/* Bereinigte Ursache (app/errors.py): „fehlgeschlagen“ allein hilft nicht. */}
      {job?.error_detail && (
        <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-rose-500/10 p-2 text-[11px] leading-relaxed text-rose-300">
          <span className="font-semibold">Ursache:</span> {job.error_detail}
        </p>
      )}
      {note && (
        <p
          className={`mt-2 rounded-lg p-2 text-[11px] leading-relaxed ${
            note.tone === "ok"
              ? "bg-emerald-500/10 text-emerald-300"
              : note.tone === "warn"
                ? "bg-amber-500/10 text-amber-300"
                : "bg-rose-500/10 text-rose-300"
          }`}
        >
          {note.text}
        </p>
      )}
      {job?.state === "running" && job.progress && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium text-sky-300">
              {job.progress.phase_label ||
                job.progress.phase ||
                "Arbeitet …"}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-slate-400">
              {job.progress.total
                ? `${job.progress.step}/${job.progress.total}`
                : `${Math.round(job.progress.pct)} %`}
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-valuenow={Math.round(job.progress.pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Fortschritt ${title}`}
          >
            <div
              className="h-full rounded-full bg-sky-400 transition-all duration-500"
              style={{ width: `${Math.max(2, job.progress.pct)}%` }}
            />
          </div>
          <p className="mt-1.5 truncate text-[11px] text-slate-500">
            {job.progress.label || job.progress.message || "…"}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">
            seit {Math.round(job.progress.elapsed_s / 60)} min
            {job.progress.eta_s
              ? ` · ca. ${Math.max(1, Math.round(job.progress.eta_s / 60))} min restlich`
              : ""}
          </p>
        </div>
      )}
      {job?.state === "running" && !job.progress && (
        <p className="mt-3 text-[11px] text-slate-500">
          Kein Fortschrittssignal — der Job schreibt erst nach der
          InfluxDB-/Archiv-Phase (Log:{" "}
          <code className="text-slate-400">docker logs -f tankapp-app</code>).
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
    { label: "health", path: "/api/v1/health" },
    {
      label: "decide",
      path: `/api/v1/decide?city=${encodeURIComponent(activeCity)}&fuel=${fuel}&liters=40`,
    },
    {
      label: "stats/summary",
      path: `/api/v1/stats/summary?city=${encodeURIComponent(activeCity)}&fuel=${fuel}`,
    },
    { label: "episodes?due", path: "/api/v1/episodes?status=due" },
    { label: `stations ${fuel}`, path: `/api/v1/stations?fuel=${fuel}` },
    { label: `selection ${fuel}`, path: `/api/v1/selection?fuel=${fuel}` },
    { label: "collector/status", path: "/api/v1/collector/status" },
    { label: "jobs/models/log", path: "/api/v1/jobs/models/log?lines=50" },
    { label: "last_forecasts", path: "/api/v1/last_forecasts" },
    { label: "day (Beispiel)", path: `/api/v1/day?station_id=${encodeURIComponent(identity ? new URLSearchParams(identity).get("station_id") || "" : "")}&day=${new Date().toISOString().slice(0, 10)}` },
    {
      label: "route/evaluate (deprecated)",
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
      <table className="w-full text-center text-[10px] font-mono">
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

  // Läuft ein NAS-Job, wird der Systemstatus dichter gepollt — ein
  // 20-Minuten-Modelllauf soll seinen Fortschritt zeigen, nicht raten lassen.
  const [healthInterval, setHealthInterval] = useState(60000);

  // B4 Pair Panel State (Umweg-Ökonomie in Werkstatt)
  const [pairAltId, setPairAltId] = useState("");
  const [pairDetourKm, setPairDetourKm] = useState(2.5);
  const [pairPeak, setPairPeak] = useState(true);

  // B4 Due-Prompt UI state
  const [dueDismissed, setDueDismissed] = useState(false);
  const [customFillOpen, setCustomFillOpen] = useState(false);
  const [customLiters, setCustomLiters] = useState(40);
  // Fix: kein erfundener Default-Preis (vorher 1.689) – 0 bedeutet "bitte eingeben", sync mit bestPrice wenn verfügbar
  const [customPrice, setCustomPrice] = useState<number>(0);
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
  const health = useResource<Health>("/api/v1/health", healthInterval, refresh);

  // Job-Log im System-Tab: welcher Job, wie viele Zeilen, wann neu laden.
  const [logJob, setLogJob] = useState("models");
  const [logLineCount, setLogLineCount] = useState(200);
  const [logReload, setLogReload] = useState(0);
  const logRef = useRef<HTMLElement | null>(null);
  const logBodyRef = useRef<HTMLPreElement | null>(null);
  const runningJob =
    Object.entries(health.data?.jobs || {}).find(
      ([, job]) => job?.state === "running",
    )?.[0] ?? null;

  useEffect(() => {
    const running = Object.values(health.data?.jobs || {}).some(
      (job) => job?.state === "running",
    );
    setHealthInterval(running ? 15000 : 60000);
  }, [health.data?.jobs]);

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

  // Wenn bester Live-Preis bekannt wird und Custom-Preis noch 0, vorbelegen (kein erfundener Fallback)
  useEffect(() => {
    if (bestPrice !== null && Number.isFinite(bestPrice) && customPrice === 0) {
      setCustomPrice(Math.round(bestPrice * 1000) / 1000);
    }
  }, [bestPrice, customPrice]);
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
  // Job-Log: nur im System-Tab, dichter gepollt, solange ein Job läuft.
  const jobLog = useResource<JobLog>(
    tab === "system"
      ? `/api/v1/jobs/${logJob}/log?lines=${logLineCount}`
      : null,
    runningJob ? 15000 : 120000,
    logReload,
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
  // Job-Log: neueste Zeile unten, beim Job-Wechsel automatisch ans Ende.
  const logLines = jobLog.data?.lines ?? [];
  // Fehlgeschlagene Jobs mit Ursache — Hinweis über allen Tabs (Alltag/Statistik).
  const failedJobs = Object.entries(h?.jobs || {}).filter(
    ([, job]) => job?.state === "failed",
  );
  const webhookCapable = logJob === "models" || logJob === "selection";
  const triggerCommand = `curl -X POST http://<nas>:1355/api/v1/jobs/trigger -H "Authorization: Bearer $TANKAPP_WEBHOOK_TOKEN" -H 'Content-Type: application/json' -d '{"job":"${logJob}"}'`;
  const workerCommand = `docker exec tankapp-app python3 -m app.worker ${logJob}`;
  // Nach einem Knopf-Start: Health sofort neu laden, nicht erst im Intervall.
  const refreshNow = () => setRefresh((count) => count + 1);
  const showJobLog = (name: string) => {
    setLogJob(name);
    setLogReload((count) => count + 1);
    requestAnimationFrame(() =>
      logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  useEffect(() => {
    const box = logBodyRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [logLines.length, logJob]);
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
      ? "letzte 24 Stunden"
      : spanHours === 72
        ? "letzte 3 Tage"
        : "letzte 7 Tage";

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
              yLow: p.q025!,
              yHigh: p.q975!,
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
              yLow: p.q10!,
              yHigh: p.q90!,
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

  // Dezente Hinweise zur Kalibrierung: aus data_policy (gut/benötigt) + gate_status
  // berechnen wir, wann ungefähr mit Werten zu rechnen ist. Tagessprung: 1 Live-Tag
  // ≈ 1 Kalendertag. Wir nehmen das heutige Datum (Europe/Berlin).
  const policy = f?.data_policy;
  const goodDays = policy?.good_complete_live_days ?? 0;
  const requiredDays = policy?.required_complete_live_days ?? 21;
  const daysMissing = Math.max(0, requiredDays - goodDays);
  const etaDate = (() => {
    if (!daysMissing) return null;
    const d = new Date();
    d.setDate(d.getDate() + daysMissing);
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  })();
  const calibrationHint = (() => {
    if (daysMissing === 0) {
      return "Live-Phase erreicht — Werte erscheinen mit den ersten empfohlenen Tankzeitpunkten.";
    }
    return `Wert erscheint, sobald die Live-Phase ${requiredDays} bewertete Tage erreicht hat (noch ${daysMissing} · voraussichtlich ab ${etaDate}).`;
  })();
  const brierHint = (() => {
    if (statsSummaryRes.data?.live_advice.brier_30d != null) return null;
    if (daysMissing === 0) {
      return "Noch keine 100 Empfehlungen im Live-Ledger — Wert erscheint automatisch.";
    }
    return `Wert erscheint mit den ersten Live-Empfehlungen (frühestens ${etaDate}).`;
  })();

  // --- B4 Workshop Dynamic Calculations ---
  const labData = statsSummaryRes.data?.backtest;
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
      bestVal = 0,
      always = 0,
      regretEur = 0,
      n = 0,
      sPos = 0,
      pSum = 0;
    for (const { score: sc } of labScores) {
      smart += sc.sum_smart_eur;
      commit += sc.sum_commit_eur;
      bestVal += sc.sum_best_eur;
      always += sc.sum_always_eur;
      regretEur += sc.avg_regret_eur * sc.n;
      n += sc.n;
      sPos += sc.n * sc.hit_freq;
      pSum += sc.p_avg * sc.n;
    }
    return {
      smart,
      commit,
      best: bestVal,
      always,
      regretEur: n ? regretEur / n : 0,
      n,
      hitFreq: n ? sPos / n : 0,
      pAvg: n ? pSum / n : 0,
      potShare: bestVal > 0 ? smart / bestVal : 0,
    };
  }, [labScores]);

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

  const labStationId = selected?.station_id || labData?.stations[0]?.id || "";
  const labRows = labData?.evalRows[labStationId] || [];
  const labModel = labData?.models[labStationId];
  const activeLabDayRow = labRows[Math.min(Math.max(labDayIdx, 0), Math.max(0, labRows.length - 1))];
  const activeLabOutcome = activeLabDayRow ? rowOutcome(activeLabDayRow, eps, liters) : null;

  const labDayClass = activeLabDayRow?.cls ?? 0;
  const labSaves = labModel ? (labDayClass === 0 ? labModel.savesWk : labModel.savesWe) : [];
  const labPredHour = labModel ? (labDayClass === 0 ? labModel.predWk : labModel.predWe) : 19;
  const labMu = labModel ? (labDayClass === 0 ? labModel.muWk : labModel.muWe) : 1.5;

  const pairAltStation = stations.find((s) => s.station_id === pairAltId) || stations.find((s) => s.station_id !== selected?.station_id);
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
    return nets;
  }, [labData, selected, pairAltStation, liters, pairEco]);

  const dueEpisode = dueEpisodesRes.data?.episodes?.[0] || (decideRes.data?.episode?.status === "due" ? decideRes.data.episode : null);

  const handleConfirmRecommendedFill = async (ep: any) => {
    if (!ep) return;
    const snap = ep.last_snapshot || decideRes.data?.primary;
    const targetPrice = snap?.expected_price ?? snap?.price_now ?? bestPrice ?? null;
    if (targetPrice == null || !Number.isFinite(targetPrice)) {
      setActionFeedback("! Kein Preis bekannt — bitte manuell erfassen.");
      setTimeout(() => setActionFeedback(null), 4000);
      return;
    }
    const fillStationId = snap?.station_id || selected?.station_id || null;
    if (!fillStationId) {
      setActionFeedback("! Keine Station bekannt — bitte manuell erfassen.");
      setTimeout(() => setActionFeedback(null), 4000);
      return;
    }
    const res = await postFill({
      station_id: fillStationId,
      station_name: snap?.station_name || selected?.name || "Station",
      liters,
      price_paid: targetPrice,
      fuel,
      source: "prompt",
      episode_id: ep.id,
    });
    if (res?.error_code) {
      setActionFeedback(`! Speichern fehlgeschlagen: ${problem(res.error_code) || res.error_code} – bitte erneut versuchen.`);
      setTimeout(() => setActionFeedback(null), 5000);
      return;
    }
    setActionFeedback("✓ Füllung im Wallet-Ledger verbucht!");
    setDueDismissed(true);
    setRefresh((r) => r + 1);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const handleCustomFill = async (ep: any) => {
    if (!Number.isFinite(customPrice) || customPrice <= 0) {
      setActionFeedback("! Bitte gültigen Preis eingeben (>0 €/L).");
      setTimeout(() => setActionFeedback(null), 4000);
      return;
    }
    const res = await postFill({
      station_id: selected?.station_id || "custom",
      station_name: selected?.name || "Station",
      liters: customLiters,
      price_paid: customPrice,
      fuel,
      source: "prompt",
      episode_id: ep?.id,
    });
    if (res?.error_code) {
      setActionFeedback(`! Speichern fehlgeschlagen: ${problem(res.error_code) || res.error_code} – bitte erneut versuchen.`);
      setTimeout(() => setActionFeedback(null), 5000);
      return;
    }
    setActionFeedback("✓ Angepasste Füllung im Wallet-Ledger gespeichert!");
    setCustomFillOpen(false);
    setDueDismissed(true);
    setRefresh((r) => r + 1);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const handleDismissDue = async (epId?: string) => {
    if (epId) {
      const res = await postIntent(epId, "dismiss");
      if (res?.error_code) {
        setActionFeedback(`! Verwerfen fehlgeschlagen: ${problem(res.error_code) || res.error_code}`);
        setTimeout(() => setActionFeedback(null), 5000);
        return;
      }
    }
    setDueDismissed(true);
    setRefresh((r) => r + 1);
  };

  const handleIntent = async (intent: string, mapsUrl?: string | null) => {
    const epId = decideRes.data?.episode?.id;
    if (epId) {
      const res = await postIntent(epId, intent);
      if (res?.error_code) {
        setActionFeedback(`! Auswahl speichern fehlgeschlagen: ${problem(res.error_code) || res.error_code} – Offline? 429?`);
        setTimeout(() => setActionFeedback(null), 5000);
        return;
      }
    }
    if (mapsUrl) window.open(mapsUrl, "_blank", "noopener,noreferrer");
    setActionFeedback("✓ Auswahl gespeichert!");
    setRefresh((r) => r + 1);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500 selection:text-slate-950">
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
                className={prices.pending ? "animate-spin text-emerald-400" : ""}
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

        {actionFeedback && (
          <div
            role="status"
            className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/15 p-4 text-sm font-semibold text-emerald-200 shadow-lg"
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

        {/* Fehlgeschlagene NAS-Jobs: in Alltag und Statistik sichtbar, nicht
            nur im System-Tab — sonst wirken veraltete Prognosen wie aktuelle. */}
        {failedJobs.length > 0 && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200"
          >
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p>
                {failedJobs.length === 1
                  ? "Ein NAS-Job ist fehlgeschlagen:"
                  : `${failedJobs.length} NAS-Jobs sind fehlgeschlagen:`}{" "}
                {failedJobs
                  .map(
                    ([name, job]) =>
                      `${JOB_LABELS[name] ?? name} — ${
                        job?.error_detail ??
                        problem(job?.error_code) ??
                        "unbekannte Ursache"
                      }`,
                  )
                  .join(" · ")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-rose-300/80">
                Angezeigte Prognosen und Rankings können veraltet sein; die
                letzten guten Ergebnisse bleiben erhalten.
              </p>
              <button
                onClick={() => {
                  setTab("system");
                  showJobLog(failedJobs[0][0]);
                }}
                className="mt-1 text-xs underline underline-offset-4"
              >
                Log ansehen
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB ALLTAG                                                   */}
        {/* ============================================================ */}
        {tab === "daily" && (
          <>
            {/* B4: Due-Prompt Banner */}
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
                        Rückmeldung nach Fensterende (Due-Prompt)
                      </span>
                      <h3 className="mt-0.5 text-lg font-bold text-white">
                        Hast du getankt?
                      </h3>
                      <p className="mt-1 text-xs text-slate-400 leading-relaxed max-w-xl">
                        Das empfohlene Zeitfenster ist vorüber. Ein kurzer Tap erfasst deinen Beleg im persönlichen Wallet-Ledger.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleConfirmRecommendedFill(dueEpisode)}
                      disabled={bestPrice === null}
                      title={bestPrice === null ? "Kein frischer Preis – bitte manuell erfassen" : `Wie empfohlen ${euro(bestPrice, 3)} €/L`}
                      className="rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ✓ Ja, wie empfohlen ({bestPrice !== null ? `${euro(bestPrice, 3)} €/L` : "Preis unbekannt"})
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
                  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
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
                <Badge warning={!decideRes.data?.calibrated}>
                  <Compass size={13} />
                  {decideRes.data?.calibrated ? "Kalibrierter Entscheidungs-Kompass" : "Entscheidungs-Kompass"}
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

              {/* F1/F2/F3 Empfehlung aus /v1/decide (Ampel + Fenster + Alternativen) */}
              {(() => {
                const rec = decideRes.data;
                if (decideRes.pending && !rec) {
                  return (
                    <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-500">
                      Empfehlung wird berechnet …
                    </div>
                  );
                }
                if (decideRes.error || rec?.error_code) {
                  return (
                    <div className="mt-5 rounded-xl border border-rose-500/25 bg-rose-950/20 p-4 text-xs text-rose-300">
                      {problem(rec?.error_code) || "Empfehlung derzeit nicht erreichbar."}
                    </div>
                  );
                }
                if (!rec) return null;
                const p = rec.primary;
                const meta = {
                  refuel_now: {
                    chip: "JETZT TANKEN",
                    cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                    Icon: FuelIcon,
                  },
                  wait: {
                    chip: "WARTEN",
                    cls: "border-amber-500/30 bg-amber-500/10 text-amber-300",
                    Icon: Clock,
                  },
                  refuel_elsewhere: {
                    chip: "WOANDERS TANKEN",
                    cls: "border-sky-500/30 bg-sky-500/10 text-sky-300",
                    Icon: Route,
                  },
                  no_advice: {
                    chip: "KEINE EMPFEHLUNG",
                    cls: "border-slate-700 bg-slate-800/60 text-slate-300",
                    Icon: ShieldCheck,
                  },
                }[p.action];
                const anchor = p.station.price_now;
                const bestAlt = [...rec.alternatives_nearby]
                  .sort((a, b) => b.net_eur - a.net_eur)
                  .find((a) => a.worth_it);
                const nearest3 = [...stations]
                  .sort((a, b) => (a.dist_km ?? 1e9) - (b.dist_km ?? 1e9))
                  .slice(0, 3);
                const savingVs = (expected: number | null | undefined) =>
                  anchor != null && expected != null
                    ? (anchor - expected) * liters
                    : null;
                return (
                  <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${meta.cls}`}>
                        <meta.Icon size={13} />
                        {meta.chip}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {p.p_correct != null
                          ? `${Math.round(p.p_correct * 100)} % sicher`
                          : "unkalibriert"}
                        {p.confidence_badge !== "low" ? ` · ${p.confidence_badge}` : ""}
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] leading-snug text-slate-200">{p.reason_short}</p>
                    {p.action === "wait" && p.recommended_window && (
                      <p className="mt-1 font-mono text-[11px] text-amber-300">
                        {clockLabel(p.recommended_window.start)}–{clockLabel(p.recommended_window.end)} Uhr ·{" "}
                        ~{euro(p.recommended_window.expected_price, 3)} €/L · −{euro(p.expected_saving_eur)} €
                      </p>
                    )}
                    {p.action === "refuel_elsewhere" && bestAlt && (
                      <p className="mt-1 font-mono text-[11px] text-sky-300">
                        {bestAlt.name} · {euro(bestAlt.price, 3)} €/L · +{euro(bestAlt.detour_km, 1)} km · netto +{euro(bestAlt.net_eur)} €
                      </p>
                    )}
                    {p.action === "refuel_now" && (
                      <p className="mt-1 font-mono text-[11px] text-emerald-300">
                        {p.station.name} · {anchor != null ? `${euro(anchor, 3)} €/L` : "Preis unbekannt"}
                      </p>
                    )}
                    {p.action === "no_advice" && (
                      <div className="mt-2 grid gap-1 font-mono text-[11px] text-slate-400">
                        {nearest3.map((s) => (
                          <div key={s.station_id} className="flex justify-between gap-2">
                            <span className="truncate">{s.name}</span>
                            <span>{price(s) != null ? `${euro(price(s), 3)} €/L` : "—"}</span>
                          </div>
                        ))}
                        {nearest3.length === 0 && <span>Keine Stationen im Polling-Set.</span>}
                      </div>
                    )}

                    {/* F3: Heute später / Diese Woche */}
                    {(rec.windows_today.length > 0 || rec.windows_week.length > 0) && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {rec.windows_today.length > 0 && (
                          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                            <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                              <Clock size={11} /> Heute später
                            </p>
                            {rec.windows_today.map((w) => {
                              const sv = savingVs(w.expected_price);
                              return (
                                <div key={w.start} className="flex items-center justify-between gap-2 py-0.5 font-mono text-[11px]">
                                  <span className="text-slate-300">
                                    {clockLabel(w.start)}–{clockLabel(w.end)}
                                  </span>
                                  <span className="text-slate-400">~{euro(w.expected_price, 3)}</span>
                                  <span className={sv != null && sv > 0 ? "text-emerald-300" : "text-slate-500"}>
                                    {sv != null ? `−${euro(sv)} €` : "—"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {rec.windows_week.length > 0 && (
                          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                            <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                              <CalendarDays size={11} /> Diese Woche
                            </p>
                            {rec.windows_week.map((w) => {
                              const sv = savingVs(w.expected_price);
                              return (
                                <div key={w.timestamp} className="flex items-center justify-between gap-2 py-0.5 font-mono text-[11px]">
                                  <span className="text-slate-300">
                                    {new Date(w.timestamp).toLocaleDateString("de-DE", {
                                      weekday: "short",
                                      timeZone: "Europe/Berlin",
                                    })}{" "}
                                    {clockLabel(w.timestamp)}
                                  </span>
                                  <span className="text-slate-400">~{euro(w.expected_price, 3)}</span>
                                  <span className={sv != null && sv > 0 ? "text-emerald-300" : "text-slate-500"}>
                                    {sv != null ? `−${euro(sv)} €` : "—"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* F2: Alternativen */}
                    {rec.alternatives_nearby.length > 0 && (
                      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                        <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          <Route size={11} /> Hier oder woanders?
                        </p>
                        {rec.alternatives_nearby.map((a) => (
                          <div key={a.station_id} className="flex items-center justify-between gap-2 py-0.5 font-mono text-[11px]">
                            <span className="truncate text-slate-300">{a.name}</span>
                            <span className="text-slate-400">
                              {euro(a.price, 3)} · +{euro(a.detour_km, 1)} km
                            </span>
                            <span className={a.worth_it ? "font-bold text-emerald-300" : "text-slate-500"}>
                              {a.net_eur >= 0 ? "+" : ""}{euro(a.net_eur)} €{a.worth_it ? " ✓" : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Intent-CTAs */}
                    {p.action !== "no_advice" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => handleIntent("wait")}
                          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20"
                        >
                          Ich warte
                        </button>
                        <button
                          onClick={() =>
                            handleIntent(
                              "navigate",
                              p.action === "refuel_elsewhere" && bestAlt?.maps_url
                                ? bestAlt.maps_url
                                : p.station.maps_url,
                            )
                          }
                          className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20"
                        >
                          Navigieren
                        </button>
                        <button
                          onClick={() => handleIntent("refuel_now")}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
                        >
                          Jetzt tanken
                        </button>
                        <button
                          onClick={() => handleIntent("dismiss")}
                          className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-[11px] font-semibold text-slate-400 hover:bg-slate-800"
                        >
                          Verwerfen
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* B4 Dual-Ledger Karten */}
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                      <Scale size={14} className="text-emerald-400" />
                      Modell-Trefferquote (Advice-Ledger)
                    </span>
                    <Badge warning={!statsSummaryRes.data?.live_advice.calibrated}>
                      {statsSummaryRes.data?.live_advice.gate_status || (statsSummaryRes.data?.live_advice.calibrated ? "Kalibriert" : "Vor-Kalibrierung")}
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
                    Auto-Settlement nach Fensterende. Brier-Score 30d:{" "}
                    <span className="font-mono text-slate-400">
                      {statsSummaryRes.data?.live_advice.brier_30d ?? "—"}
                    </span>
                  </p>
                  {brierHint && (
                    <p className="mt-1 text-[10px] text-slate-500 leading-snug">{brierHint}</p>
                  )}
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
                    Persönliche Ersparnis vs. immer sofort tanken (nur aus echten Tankbelegen).
                  </p>
                </div>
              </div>

              <div className="relative mt-5 flex items-start gap-2.5 text-xs leading-relaxed text-slate-400">
                <ShieldCheck
                  size={17}
                  className="mt-0.5 shrink-0 text-sky-400"
                />
                <p>
                  <span className="font-medium text-slate-200">
                    Einordnung
                  </span>{" "}
                  {decideRes.data?.calibrated
                    ? "Kalibrierte Empfehlung aktiv — Ampel oben beachten. Trefferquoten und Brier-Score stehen im Advice-Ledger."
                    : "Eine belastbare Warteempfehlung ist noch nicht freigegeben. Historie und Prognosen werden geprüft — bis dahin zählen hier nur aktuelle Preismeldungen."}
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
                  <span className={difference != null && difference > 0.01 ? "text-rose-300" : difference != null && difference < -0.01 ? "text-emerald-300" : "text-slate-200"}>
                    {euro(difference)}{" "}
                    <span className="text-sm font-normal text-slate-500">
                      €
                    </span>
                  </span>
                }
                detail="Reiner Preisunterschied pro Füllung — grün günstiger, dezent rot teurer. Sprit- und Zeitkosten des Umwegs rechnet weiter unten „Rechnet sich der Umweg?“."
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

            {/* Detour Section */}
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
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                worth
                                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                                  : borderline
                                    ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
                                    : "border-rose-500/25 bg-rose-500/10 text-rose-300"
                              }`}
                            >
                              {worth
                                ? "lohnenswert"
                                : borderline
                                  ? "grenzwertig"
                                  : "lohnt sich nicht"}
                            </span>
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
                deine Angaben — keine Buchung, keine garantierte Ersparnis.
              </p>
            </section>

            {/* Stations List */}
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
                    Polling-Set.
                  </Empty>
                </div>
              )}
            </section>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB STATISTIK / WERKSTATT                                    */}
        {/* ============================================================ */}
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
                <div className="mt-3">
                  <Badge warning>Unkalibriert · keine Handlungsempfehlung</Badge>
                </div>
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
                tip="Mittlerer absoluter Fehler (MAE): der durchschnittliche Abstand zwischen Prognose und tatsächlichem Preis in Cent pro Liter."
              />
              <Metric
                label="Vergleich zur saisonalen Naive · MASE"
                value={euro(metrics?.mase)}
                detail="Skalierte Vergleichszahl: kleiner als 1,0 = besser als die Vergleichsmethode."
                tip="Mean Absolute Scaled Error (MASE) = Backtest-MAE geteilt durch den MAE der saisonalen Naive."
              />
              <Metric
                label="Beobachtete Vergleichspunkte"
                value={metrics?.points ?? "—"}
                detail="5-Minuten-Zeitpunkte, an denen Prognose und echter gemeldeter Preis verglichen wurden."
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
              />
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
                    <strong className="text-slate-200">Warten</strong> bis zur vorhergesagten billigsten Stunde (μ ≥ ε) — sonst{" "}
                    <strong className="text-slate-200">jetzt tanken</strong>.
                    <span className="text-slate-500 block mt-1">
                      Die Produktion entscheidet weiterhin mit der kalibrierten Entscheidungstabelle; dieser interaktive Slider dient zur Was-wäre-wenn-Analyse.
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
                    Warten nur, wenn die Trainings-Ersparnis diese Schwelle verspricht.
                  </p>
                </div>
              </div>
              {labTotals.n === 0 ? (
                <div className="mt-5 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-xs leading-relaxed text-slate-400">
                  {problem((labData as any)?.error_code) ||
                    "Noch keine 08:00-Entscheidungszeilen — nach dem ersten Modell-Job erscheint hier das echte Regel-Ergebnis."}
                </div>
              ) : (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                  <p className="text-[11px] text-slate-500">Regel-Ergebnis ({labData?.daysEval ?? "–"} d out-of-sample)</p>
                  <p className="mt-1 text-xl font-bold text-emerald-300 font-mono">{euro(labTotals.smart)} €</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                  <p className="text-[11px] text-slate-500">Perfekte Sicht (Orakel)</p>
                  <p className="mt-1 text-xl font-bold text-slate-100 font-mono">{euro(labTotals.best)} €</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                  <p className="text-[11px] text-slate-500">Baseline „immer warten“</p>
                  <p className="mt-1 text-xl font-bold text-slate-100 font-mono">{euro(labTotals.always)} €</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                  <p className="text-[11px] text-slate-500">Geholtes Potenzial</p>
                  <p className="mt-1 text-xl font-bold text-amber-300 font-mono">{labTotals.best > 0 ? `${Math.round(labTotals.potShare * 100)} %` : "—"}</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                  <p className="text-[11px] text-slate-500">Ø Entscheidungsverlust</p>
                  <p className="mt-1 text-xl font-bold text-slate-100 font-mono">{euro(labTotals.regretEur)} €</p>
                </div>
              </div>
              )}
            </section>

            {/* Sektion 2: Entscheidungs-Scoreboard */}
            <section className="mb-8">
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
                  Entscheidungs-Scoreboard · Out-of-Sample ({labData?.daysEval ?? "–"} Tage)
                </p>
                <h3 className="mt-1 text-xl font-bold text-white">
                  Wurde die Empfehlung real belohnt?
                </h3>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-900 text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Station (Stadt)</th>
                      <th className="px-3 py-3">δ̂ vs. Stadt</th>
                      <th className="px-3 py-3 text-right hidden sm:table-cell">P behauptet</th>
                      <th className="px-3 py-3 text-right hidden sm:table-cell">S&gt;0 real</th>
                      <th className="px-3 py-3 text-right hidden md:table-cell">„Warten“</th>
                      <th className="px-3 py-3 text-right hidden md:table-cell">„Jetzt“</th>
                      <th className="px-3 py-3 text-right hidden lg:table-cell">Ø Regret</th>
                      <th className="px-3 py-3 text-right">Regel-€</th>
                      <th className="px-3 py-3 text-right hidden sm:table-cell">Orakel-€</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {labScores.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-6 text-center text-xs text-slate-500">
                          {problem((labData as any)?.error_code) || "Noch keine Entscheidungszeilen — der Modell-Job füllt dieses Scoreboard."}
                        </td>
                      </tr>
                    )}
                    {labScores.map(({ station_id: sid, score: sc }) => {
                      const stMeta = labData?.stations.find((s) => s.id === sid);
                      const active = sid === selected?.station_id;
                      const selDelta = selection.data?.stations.find((s) => s.station_id === sid)?.delta_ct;
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
                          </td>
                          <td className="px-3 py-2.5 font-mono">
                            {selDelta != null ? (
                              <span className={selDelta <= 0 ? "text-emerald-300 font-semibold" : "text-rose-300 font-semibold"}>
                                {selDelta > 0 ? "+" : ""}{selDelta.toFixed(1)} ct
                              </span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-300 hidden sm:table-cell">
                            {sc.p_known ? `${Math.round(sc.p_avg * 100)} %` : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-300 hidden sm:table-cell">
                            {Math.round(sc.hit_freq * 100)} %
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono hidden md:table-cell">
                            {sc.n_wait > 0 ? `${sc.n_wait} · ${Math.round((sc.hit_wait ?? 0) * 100)}%` : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono hidden md:table-cell">
                            {sc.n_now > 0 ? `${sc.n_now} · ${Math.round((sc.hit_now ?? 0) * 100)}%` : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-300 hidden lg:table-cell">
                            {euro(sc.avg_regret_eur)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-emerald-300">
                            {euro(sc.sum_smart_eur)} €
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-400 hidden sm:table-cell">
                            {euro(sc.sum_best_eur)} €
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Sektion 3: Kalibrierung */}
            <section className="mb-8">
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
                  Kalibrierung der Entscheidungs-Wahrscheinlichkeit
                </p>
                <h3 className="mt-1 text-xl font-bold text-white">
                  Stimmt „mit x % ist der Abend billiger“ mit der Realität überein?
                </h3>
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
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
                    <p className="text-slate-400">Kalibrierungs-Freigabe</p>
                    <p className="mt-1 text-base font-bold text-amber-300">
                      {statsSummaryRes.data?.live_advice.gate_status || "Kalibrierung steht aus"}
                    </p>
                    {daysMissing > 0 && (
                      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                        Noch {daysMissing} von {requiredDays} bewerteten Live-Tagen · voraussichtlich ab {etaDate}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Beobachtete Historie & Modell-Ausblick */}
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
                />
              ) : (
                <Empty>
                  {history.pending
                    ? "Historie wird geladen …"
                    : "Noch keine Beobachtungen für diese Station — leere Stunden werden nicht erfunden."}
                </Empty>
              )}
            </section>

            <section className={`${panel} mb-6 p-5 sm:p-6`}>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">
                    Modell-Ausblick · 12-Uhr-Regel
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Modellprognose mit 80-%- und 95-%-Band.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label="Prognose-Horizont"
                    className="flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs font-semibold"
                  >
                    <button
                      aria-pressed={horizonDays === 0}
                      onClick={() => setHorizon(0)}
                      className={`rounded px-2.5 py-1 transition-colors ${horizonDays === 0 ? "bg-slate-800 text-sky-400" : "text-slate-400 hover:text-white"}`}
                    >
                      24 Stunden
                    </button>
                    <button
                      aria-pressed={horizonDays === 3}
                      onClick={() => setHorizon(3)}
                      disabled={!f?.points_3d?.length}
                      className={`rounded px-2.5 py-1 transition-colors ${horizonDays === 3 ? "bg-slate-800 text-sky-400" : f?.points_3d?.length ? "text-slate-400 hover:text-white" : "cursor-not-allowed text-slate-600"}`}
                    >
                      +3 Tage
                    </button>
                    <button
                      aria-pressed={horizonDays === 7}
                      onClick={() => setHorizon(7)}
                      disabled={!f?.points_7d?.length}
                      className={`rounded px-2.5 py-1 transition-colors ${horizonDays === 7 ? "bg-slate-800 text-sky-400" : f?.points_7d?.length ? "text-slate-400 hover:text-white" : "cursor-not-allowed text-slate-600"}`}
                    >
                      +7 Tage
                    </button>
                  </div>
                </div>
              </div>
              {forecast.error || forecast.data?.error_code ? (
                <Empty>
                  {problem(forecast.data?.error_code) ||
                    "Der Modell-Ausblick konnte nicht geladen werden."}
                </Empty>
              ) : forecastWindow && modelSeries.length ? (
                <>
                  <LineChart
                    series={modelSeries}
                    bands={[...fanBand95, ...fanBand80]}
                    marks={forecastMarks}
                    xDomain={forecastWindow}
                    xTicks={autoTimeTicks(forecastWindow[0], forecastWindow[1])}
                    yFmt={(v) => euro(v, 3)}
                  />
                  {modelWindows.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2 text-xs">
                      <span className="text-slate-500">
                        Prognostizierte Tief- und Hoch-Phasen:
                      </span>
                      {modelWindows.map((w, i) => (
                        <span
                          key={i}
                          className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-slate-300"
                        >
                          {i === 0 ? "Tief" : "Hoch"}: {timeLabel(new Date(w.start).toISOString())} – {euro(w.median, 3)} €
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <Empty>
                  {forecast.pending
                    ? "Modell-Ausblick wird berechnet …"
                    : "Noch kein veröffentlichter Modell-Ausblick."}
                </Empty>
              )}
            </section>

            {/* Sektion 4: Stations-Labor Detail-Analyse */}
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
                    Billigste Stunde (Tr.):{" "}
                    <strong className="text-slate-200">
                      {labModel ? `${String(labPredHour).padStart(2, "0")}:00` : "—"}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-slate-500">Tag im Prüfstand:</span>
                {labRows.map((r, i) => {
                  const o = rowOutcome(r, eps, liters);
                  const active = i === labDayIdx;
                  return (
                    <button
                      key={r.day}
                      onClick={() => setLabDayIdx(i)}
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

              {activeLabDayRow && activeLabOutcome && (
                <div className="mt-5 grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Regel am Morgen ({activeLabDayRow.cls === 0 ? "Werktag" : "WE/Feiertag"})</p>
                    <p className="mt-1 text-sm leading-relaxed text-slate-300">
                      Training: <strong className="text-white">μ = {activeLabDayRow.mu.toFixed(1)} ct</strong>,{" "}
                      <strong className="text-white">P(S&gt;0) = {activeLabDayRow.p != null ? `${Math.round(activeLabDayRow.p * 100)} %` : "—"}</strong>. Regel (ε = {eps.toFixed(1)} ct):{" "}
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
                  </div>
                  <div className="rounded-xl bg-slate-900/80 p-3">
                    <p className="text-xs text-slate-500">Urteil</p>
                    <p className={`mt-1 text-lg font-bold ${activeLabOutcome.hit ? "text-emerald-300" : "text-rose-300"}`}>
                      {activeLabOutcome.hit ? "✓ Richtig entschieden" : "✗ Falsch entschieden"}
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-4 grid gap-4 xl:grid-cols-5">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 xl:col-span-3">
                  <p className="px-1 text-xs font-medium text-slate-400">
                    Tageskurve {activeLabDayRow?.day || "—"} (ct/L)
                  </p>
                  {(() => {
                    const dayPts: { x: number; y: number }[] =
                      activeLabDayRow?.curve && activeLabDayRow.curve.length
                        ? activeLabDayRow.curve
                        : [];
                    const rowPredHour = activeLabDayRow?.predHour;
                    return dayPts.length ? (
                      <LabLineChart
                        height={220}
                        series={[
                          {
                            name: "Erwartung vs. 08:00",
                            color: "#e2e8f0",
                            pts: dayPts,
                          },
                        ]}
                        marks={[
                          { x: 8, color: "#38bdf8", label: "08:00" },
                          ...(rowPredHour != null
                            ? [
                                {
                                  x: rowPredHour,
                                  color: "#34d399",
                                  label: `~${String(Math.floor(rowPredHour)).padStart(2, "0")}:${String(Math.round((rowPredHour % 1) * 60)).padStart(2, "0")}`,
                                },
                              ]
                            : []),
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
                    ) : (
                      <div className="flex h-[220px] items-center justify-center px-6 text-center text-xs leading-relaxed text-slate-500">
                        Keine Tageskurve für diesen Tag — wähle einen bewerteten Tag im Prüfstand.
                      </div>
                    );
                  })()}
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 xl:col-span-2">
                  <p className="px-1 text-xs font-medium text-slate-400">
                    Trainings-Verteilung S ({labDayClass === 0 ? "Werktag" : "WE"})
                  </p>
                  {labModel ? (
                    <HistogramBars
                      values={labSaves}
                      thresholds={[
                        { x: eps, color: "#fbbf24", label: `ε ${eps.toFixed(1)}` },
                        { x: labMu, color: "#38bdf8", label: `μ ${labMu.toFixed(1)}` },
                      ]}
                      height={220}
                    />
                  ) : (
                    <div className="flex h-[220px] items-center justify-center px-6 text-center text-xs leading-relaxed text-slate-500">
                      Noch kein Form-Modell veröffentlicht — die Engine liefert bisher Tageszeilen, aber keine Trainings-Verteilung.
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Sektion 5: Heatmaps */}
            <section className={`${panel} mb-8 p-5 sm:p-6`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <BarChart3 size={16} className="text-purple-400" />
                  Heatmaps · Wochentag × Stunde · {activeCity || "—"}
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
                </div>
              </div>
              {heatmap.data && heatmap.data.matrix.length ? (
                <HeatmapGrid heatmap={heatmap.data} />
              ) : (
                <Empty>
                  {heatmap.pending ? "Heatmap wird berechnet …" : "Noch keine Daten für Heatmap."}
                </Empty>
              )}
            </section>

            {/* Sektion 6: Meine Stationen Ranking */}
            <section className={`${panel} mb-8 p-5 sm:p-6`}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Activity size={16} className="text-emerald-400" />
                  Meine Stationen · δ̂ Ranking
                </h3>
              </div>
              {selection.data && selection.data.stations.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-500">
                        <th className="py-2 pr-2">#</th>
                        <th className="py-2 pr-3">Station</th>
                        <th className="py-2 pr-3">δ̂ ct/L</th>
                        <th className="py-2 pr-3 hidden sm:table-cell">95%-KI</th>
                        <th className="py-2 pr-3 hidden md:table-cell">q</th>
                        <th className="py-2 pr-3 hidden md:table-cell">AV-Score</th>
                        <th className="py-2 pr-3">Billigste Std</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {selection.data.stations.map((s) => (
                        <tr key={s.station_id}>
                          <td className="py-2 pr-2 font-mono">{s.rank}</td>
                          <td className="py-2 pr-3 font-semibold text-slate-200 truncate max-w-[180px]">{s.name}</td>
                          <td className={`py-2 pr-3 font-mono ${s.delta_ct != null && s.delta_ct < 0 ? "text-emerald-400" : "text-rose-300"}`}>
                            {s.delta_ct != null ? `${s.delta_ct > 0 ? "+" : ""}${s.delta_ct.toFixed(2)}` : "—"}
                          </td>
                          <td className="py-2 pr-3 font-mono text-slate-400 hidden sm:table-cell">
                            {s.ci_lo != null && s.ci_hi != null ? `[${s.ci_lo.toFixed(2)}, ${s.ci_hi.toFixed(2)}]` : "—"}
                          </td>
                          <td className="py-2 pr-3 font-mono hidden md:table-cell">{s.q_value != null ? s.q_value.toFixed(4) : "—"}</td>
                          <td className="py-2 pr-3 font-mono hidden md:table-cell">{s.avail != null ? s.avail.toFixed(2) : "—"}</td>
                          <td className="py-2 pr-3 font-mono">{formatHour(s.best_hour)}</td>
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

            {(!data?.stations.length && (data?.connection_error === "polling_missing" || !h?.jobs_enabled)) && (
              <div className="mb-6">
                <Empty>
                  Das gemeinsame Polling-Set fehlt auf diesem Server.
                </Empty>
              </div>
            )}

            {/* Güte-Kacheln */}
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Top-3-Trefferquote (30 d)"
                value={
                  statsSummaryRes.data?.quality_metrics.top3_hit_rate != null ? (
                    <span className="text-emerald-300 font-mono">{`${Math.round(statsSummaryRes.data.quality_metrics.top3_hit_rate * 100)} %`}</span>
                  ) : (
                    <span className="text-slate-500 font-mono">—</span>
                  )
                }
                detail="Tagesminimum in einem der 3 empfohlenen Zeitfenster. Ziel > 60 %."
                hint={
                  statsSummaryRes.data?.quality_metrics.top3_hit_rate == null
                    ? calibrationHint
                    : null
                }
              />
              <Metric
                label="MASE sprungfrei"
                value={
                  statsSummaryRes.data?.quality_metrics.mase_sprungfrei != null ? (
                    <span className="text-sky-300 font-mono">{statsSummaryRes.data.quality_metrics.mase_sprungfrei.toFixed(2)}</span>
                  ) : (
                    <span className="text-slate-500 font-mono">—</span>
                  )
                }
                detail="Skalierter Fehler an sprungfreien Tagen. Ziel < 0.80."
                hint={
                  statsSummaryRes.data?.quality_metrics.mase_sprungfrei == null
                    ? calibrationHint
                    : null
                }
              />
              <Metric
                label="95-%-Band PICP"
                value={
                  statsSummaryRes.data?.quality_metrics.picp_95 != null ? (
                    <span className="text-slate-100 font-mono">{statsSummaryRes.data.quality_metrics.picp_95.toFixed(1)} %</span>
                  ) : (
                    <span className="text-slate-500 font-mono">—</span>
                  )
                }
                detail="Anteil echter Preise im Konfidenzband. Ziel 90–98 %."
                hint={
                  statsSummaryRes.data?.quality_metrics.picp_95 == null
                    ? calibrationHint
                    : null
                }
              />
              <Metric
                label="CUSUM Drift-Status"
                value={
                  statsSummaryRes.data?.quality_metrics.cusum_drift ? (
                    <span
                      className={
                        statsSummaryRes.data.quality_metrics.cusum_drift.status === "normal"
                          ? "text-emerald-400 font-mono"
                          : "text-amber-400 font-mono"
                      }
                    >
                      {statsSummaryRes.data.quality_metrics.cusum_drift.status === "normal"
                        ? `STABIL${statsSummaryRes.data.quality_metrics.cusum_drift.max_cusum != null ? ` (${statsSummaryRes.data.quality_metrics.cusum_drift.max_cusum.toFixed(2)}σ)` : ""}`
                        : statsSummaryRes.data.quality_metrics.cusum_drift.status.toUpperCase()}
                    </span>
                  ) : (
                    <span className="text-slate-500 font-mono">—</span>
                  )
                }
                detail="Schranke |CUSUM| ≤ 3σ über 14 d zur Erkennung von Stationsumbau."
                hint={
                  !statsSummaryRes.data?.quality_metrics.cusum_drift
                    ? calibrationHint
                    : null
                }
              />
            </div>

            <div className="mb-6 grid gap-4 sm:grid-cols-4">
              <JobCard
                title="Archiv-Sync"
                icon={<Database size={17} className="text-emerald-400" />}
                job={h?.jobs.archive}
                enabled={h?.jobs_enabled}
                logKey="archive"
                onShowLog={showJobLog}
                onStarted={refreshNow}
              />
              <JobCard
                title="Modell-Update"
                icon={<ChartIcon size={17} className="text-sky-400" />}
                job={h?.jobs.models}
                enabled={h?.jobs_enabled}
                logKey="models"
                onShowLog={showJobLog}
                onStarted={refreshNow}
              />
              <JobCard
                title="Selektion Ranking"
                icon={<Activity size={17} className="text-emerald-400" />}
                job={h?.jobs.selection}
                enabled={h?.jobs_enabled}
                logKey="selection"
                onShowLog={showJobLog}
                onStarted={refreshNow}
              />
              <JobCard
                title="Beleg-Verarbeitung"
                icon={<Scale size={17} className="text-emerald-400" />}
                job={h?.jobs.settlement}
                enabled={h?.jobs_enabled}
                logKey="settlement"
                onShowLog={showJobLog}
                onStarted={refreshNow}
              />
            </div>

            {/* Job-Log: dieselben Zeilen wie `tail -f data/runtime/jobs/<job>.log` */}
            <section ref={logRef} className={`${panel} mb-6 p-5 sm:p-6`}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <ScrollText size={17} className="text-emerald-400" />
                    Job-Log · letzte Zeilen direkt vom NAS
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Dieselben Zeilen liegen als Datei unter{" "}
                    <code className="text-slate-400">
                      data/runtime/jobs/{logJob}.log
                    </code>{" "}
                    (die letzten 500). Beim Auslesen werden Pfade und
                    Zugangsdaten entfernt.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLogReload((n) => n + 1)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
                >
                  Aktualisieren
                </button>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {Object.keys(JOB_LABELS).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setLogJob(name)}
                    aria-pressed={logJob === name}
                    className={`rounded-lg border px-3 py-1.5 text-[11px] transition-colors ${
                      logJob === name
                        ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                    }`}
                  >
                    {JOB_LABELS[name]}
                  </button>
                ))}
                <select
                  aria-label="Anzahl Logzeilen"
                  value={logLineCount}
                  onChange={(e) => setLogLineCount(Number(e.target.value))}
                  className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-[11px] text-slate-200"
                >
                  <option value={100}>letzte 100</option>
                  <option value={200}>letzte 200</option>
                  <option value={500}>letzte 500</option>
                </select>
              </div>
              <pre
                ref={logBodyRef}
                className="max-h-80 overflow-auto rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[11px] leading-relaxed text-slate-300"
              >
                {logLines.length
                  ? logLines.join("\n")
                  : jobLog.pending
                    ? "Log wird geladen …"
                    : "Noch keine Logzeilen für diesen Job."}
              </pre>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  {jobLog.data?.available
                    ? `${jobLog.data.count} von ${jobLog.data.total} Zeilen im Log`
                    : jobLog.data
                      ? "Noch kein Log — der erste Lauf dieses Jobs schreibt es."
                      : ""}
                </span>
                {jobLog.data?.updated_at ? (
                  <span className="font-mono">
                    Stand {timeLabel(jobLog.data.updated_at)}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 break-words rounded-lg bg-slate-950/60 p-2.5 text-[11px] leading-relaxed text-slate-500">
                Starten: der Knopf{" "}
                <Play size={11} className="inline align-[-1px]" /> in der
                jeweiligen Job-Karte oben (ohne Passwort, wirkt nur im
                NAS-Webauftritt, nie zwei Läufe gleichzeitig). Auf der
                Kommandozeile stattdessen{" "}
                <code className="text-slate-400">{workerCommand}</code> —
                Details in{" "}
                <span className="text-slate-400">docs/BETRIEB.md</span>.
              </p>
              {webhookCapable ? (
                <p className="mt-2 break-words text-[11px] leading-relaxed text-slate-500">
                  Vom Pi aus kommt derselbe Lauf über den Uploader-Webhook:{" "}
                  <code className="text-slate-400">{triggerCommand}</code>
                </p>
              ) : null}
            </section>

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
                ohne Poll auszulösen. Aktuelle Endpunkte: decide, episodes, fills, stats/summary.
              </p>
              <ApiExplorer fuel={fuel} identity={identity} activeCity={activeCity} />
            </section>
          </>
        )}

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 pt-5 text-[10px] text-slate-600">
          <span>
            Daten: <strong>MTS-K via tankerkoenig.de (CC BY 4.0)</strong> ·
            Token-Bucket 1 R / 300 s · Fenster 06–24 Uhr · Entscheidungs-API: decide · episodes · fills · settlement · summary
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
