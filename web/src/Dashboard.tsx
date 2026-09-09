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
} from "lucide-react";
import { LineChart } from "./components/LineChart";
import {
  currentPrice,
  euro,
  problem,
  segments,
  timeLabel,
  useResource,
  usePreference,
  type Fuel,
  type Station,
  type Stations,
  type Health,
  type Forecast,
  type Point,
  type Job,
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
}: {
  label: string;
  value: ReactNode;
  detail: string;
}) {
  return (
    <div className={`${panel} p-5`}>
      <div className="text-xs text-slate-400">{label}</div>
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
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(performance.now());
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
  const difference =
    bestPrice !== null && selectedPrice !== null
      ? (selectedPrice - bestPrice) * liters
      : null;
  const identity = selected
    ? new URLSearchParams({
        city: activeCity,
        station_id: selected.station_id,
        fuel,
      }).toString()
    : "";
  const history = useResource<{ points: Point[]; error_code: string | null }>(
    tab === "statistics" && identity ? `/api/v1/series?${identity}` : null,
    60000,
    refresh,
  );
  const forecast = useResource<Forecast>(
    tab === "statistics" && identity ? `/api/v1/forecast?${identity}` : null,
    300000,
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
  const ticks = observations.length
    ? [
        observations[0],
        observations[Math.floor(observations.length / 2)],
        observations[observations.length - 1],
      ].map((p) => ({
        x: Date.parse(p.timestamp),
        label: new Date(p.timestamp).toLocaleTimeString("de-DE", {
          timeZone: "Europe/Berlin",
          hour: "2-digit",
          minute: "2-digit",
        }),
      }))
    : [];
  const modelSeries =
    f?.points
      .filter((p) => p.q50 !== null)
      .map((p) => ({ x: Date.parse(p.timestamp), y: p.q50! })) || [];

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
                ? `${fresh.length} frische Preise · ${activeCity}`
                : prices.pending && !data
                  ? "Daten werden geladen …"
                  : "Kein bestätigter Live-Preis"}
            </span>
          </div>
        </div>
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
                detail="Reiner Preisunterschied pro Füllung, ohne Sprit- und Zeitkosten des Umwegs."
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
                      <button
                        key={row.station_id}
                        onClick={() => setSelectedId(row.station_id)}
                        aria-pressed={selected?.station_id === row.station_id}
                        className={`flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-800/40 ${selected?.station_id === row.station_id ? "bg-emerald-500/[.04]" : ""}`}
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
                                  title="Luftlinie zum Anker dieser Stadt"
                                  className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                                >
                                  {row.dist_km.toLocaleString("de-DE", {
                                    maximumFractionDigits: 1,
                                  })}{" "}
                                  km
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
                          <ChevronRight size={15} className="text-slate-600" />
                        </div>
                      </button>
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
            <div className="mb-6 grid gap-4 sm:grid-cols-3">
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
                detail="Letzte 7 abgeschlossene Prüftage; kein kalibrierter Live-Gütenachweis."
              />
              <Metric
                label="Vergleich zur saisonalen Naive · MASE"
                value={euro(metrics?.mase)}
                detail="Kleiner als 1 ist im ausgewerteten Zeitraum besser als die Vergleichsmethode."
              />
              <Metric
                label="Beobachtete Vergleichspunkte"
                value={metrics?.points ?? "—"}
                detail="Keine simulierten Trefferquoten und keine als Live-Polls gezählten Füllwerte."
              />
            </div>
            <section className={`${panel} mb-6 p-5 sm:p-6`}>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Stations-Labor · letzte 24 Stunden
                </h3>
                <Badge warning={!observations.length}>
                  Echte Polling-Beobachtungen
                </Badge>
              </div>
              {history.error || history.data?.error_code ? (
                <Empty>
                  {problem(history.data?.error_code) ||
                    "Der Preisverlauf konnte nicht geladen werden."}
                </Empty>
              ) : series.length ? (
                <LineChart
                  series={series}
                  yFmt={(v) => euro(v, 3)}
                  xTicks={ticks}
                  gapMinutes={30}
                  gapLabel="keine Meldung"
                />
              ) : (
                <Empty>
                  {history.pending
                    ? "Beobachtungen werden geladen …"
                    : "Noch kein Preisverlauf vorhanden. Lücken und geschlossene Zeiträume werden nicht mit erfundenen Preisen verbunden."}
                </Empty>
              )}
              <p className="mt-4 text-[11px] text-slate-500">
                Zeit in Europe/Berlin · Preis in €/L · Unterbrechungen über 30
                Minuten werden als Band markiert, nicht mit Preisen überbrückt.
              </p>
            </section>
            <section className={`${panel} p-5 sm:p-6`}>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Modell-Ausblick</h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Ab Fit-Zeitpunkt {timeLabel(f?.origin)}
                  </p>
                </div>
                <Badge warning>Unkalibriert · keine Handlungsempfehlung</Badge>
              </div>
              {f?.stale || f?.retained_previous || f?.stale_data_at_origin ? (
                <p className="mb-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">
                  {f.stale || f.retained_previous
                    ? "Älteres Modellergebnis: kein neuer erfolgreicher Fit für diese Station."
                    : "Am Fit-Zeitpunkt waren die Eingangsdaten nicht frisch."}{" "}
                  Nicht als aktuellen Tankzeitpunkt verwenden.
                </p>
              ) : null}
              {forecast.error ? (
                <Empty>Modellstand konnte nicht geladen werden.</Empty>
              ) : modelSeries.length ? (
                <LineChart
                  series={[
                    {
                      name: "Unkalibrierter Median",
                      color: "#38bdf8",
                      dash: "5 4",
                      pts: modelSeries,
                    },
                  ]}
                  gapMinutes={30}
                  gapLabel="keine Prognose"
                  yFmt={(v) => euro(v, 3)}
                  xTicks={
                    modelSeries.length
                      ? [modelSeries[0], modelSeries.at(-1)!].map((p) => ({
                          x: p.x,
                          label: timeLabel(new Date(p.x).toISOString()),
                        }))
                      : []
                  }
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
            <div className="mb-6 grid gap-4 lg:grid-cols-2">
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
            </div>
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
                  keinen Pi-Stromausfall.
                </li>
                <li>
                  Eine Anleitung, ein Einstieg:{" "}
                  <code className="text-slate-200">docs/INSTALL.md</code> im
                  TankApp-Repository.
                </li>
              </ul>
            </section>
          </>
        )}
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 pt-5 text-[10px] text-slate-600">
          <span>TankApp · Tankerkönig-Marktdaten / Live-Polling & Archiv</span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={12} />
            Keine Demo-Preise. Keine erfundene Sicherheit.
          </span>
        </footer>
      </main>
    </div>
  );
}
