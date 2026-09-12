// D1: Views-Schnitt — System-Tab. Gemeinsamer Zustand aus der
// Dashboard-Root per typisierten Props; die View rendert, sie entscheidet
// nichts.
import {
  Activity,
  BellRing,
  LineChart as ChartIcon,
  Cpu,
  Database,
  Play,
  Scale,
  ScrollText,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { ApiExplorer } from "../components/ApiExplorer";
import { JobCard } from "../components/JobCard";
import { LoadError } from "../components/LoadError";
import { Badge, Empty, Metric, panel } from "../components/ui";
import {
  JOB_LABELS,
  M7_BRIER_THRESHOLD,
  M7_MIN_RECOMMENDATIONS,
  deNumber,
  euro,
  notifyLastLine,
  notifyStatusLine,
  notifyTone,
  percentLabel,
  problem,
  timeLabel,
  type CollectorStatus,
  type DecideResult,
  type Fuel,
  type Health,
  type JobLog,
  type ResourceState,
  type Selection,
  type Station,
  type Stations,
  type StatsSummary,
} from "../data";
export interface SystemViewProps {
  activeCity: string;
  fuel: Fuel;
  heatmapWeeks: number;
  data: Stations | null;
  stations: Station[];
  fresh: Station[];
  h: Health | null;
  // Ressourcen (Einzelpolls des System-Tabs)
  health: ResourceState<Health>;
  collector: CollectorStatus | undefined;
  selection: ResourceState<Selection>;
  statsSummaryRes: ResourceState<StatsSummary>;
  decideRes: ResourceState<DecideResult>;
  jobLog: ResourceState<JobLog>;
  // Job-Log-Steuerung
  logJob: string;
  logLineCount: number;
  logLines: string[];
  logBodyRef: React.RefObject<HTMLPreElement | null>;
  logRef: React.RefObject<HTMLElement | null>;
  setLogJob: (v: string) => void;
  setLogLineCount: (v: number) => void;
  setLogReload: (v: number | ((prev: number) => number)) => void;
  showJobLog: (job: string) => void;
  // Abgeleitete Werte
  calibrationHint: string;
  m7Line: string | null;
  liveAdvice: StatsSummary["live_advice"] | null;
  identity: string;
  span: number | null;
  webhookCapable: boolean;
  triggerCommand: string;
  workerCommand: string;
  refreshNow: () => void;
}
export function SystemView(props: SystemViewProps) {
  const { activeCity, calibrationHint, collector, data, decideRes, fresh, h, fuel, heatmapWeeks, health, identity, jobLog, liveAdvice, logBodyRef, logJob, logLineCount, logLines, logRef, m7Line, refreshNow, selection, setLogJob, setLogLineCount, setLogReload, showJobLog, span, stations, statsSummaryRes, triggerCommand, webhookCapable, workerCommand, } = props;
  return (
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

  {!data?.stations.length &&
    (data?.connection_error === "polling_missing" ||
      !h?.jobs_enabled) && (
      <div className="mb-6">
        <Empty>
          Das gemeinsame Polling-Set fehlt auf diesem Server.
        </Empty>
      </div>
    )}

  {/* C1: geführte Einrichtungs-Checkliste — Status aus vorhandenen
      Endpunkten, jeder Schritt mit Fix-Hinweis. */}
  <section
    className={`${panel} mb-6 p-5 sm:p-6`}
    aria-labelledby="setup-heading"
  >
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h3
        id="setup-heading"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <ShieldCheck size={16} className="text-emerald-400" />
        Einrichtung &amp; eigene Daten
      </h3>
      <a
        href="/api/v1/fills.csv"
        className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
        title="Deine Tankbelege als CSV herunterladen"
      >
        Belege als CSV herunterladen
      </a>
    </div>
    {(() => {
      const steps = [
        {
          label: "Polling-Set",
          done: (h?.station_count ?? 0) > 0,
          hint: h?.station_count
            ? `${h.station_count} Stationen eingebunden.`
            : "Gemeinsames Polling-Set fehlt — docs/INSTALL.md, Abschnitt „Polling-Set“.",
        },
        {
          label: "Collector-Herzschlag",
          done: !!collector?.available,
          hint: collector?.available
            ? collector.fresh
              ? "Der Pi meldet regelmäßig Preise."
              : "Herzschlag vorhanden, aber veraltet."
            : "Noch kein Herzschlag — Pi-Uploader prüfen.",
        },
        {
          label: "InfluxDB-Lesezugang",
          done: !!h?.influx_configured,
          hint: h?.influx_configured
            ? "Lesezugang eingebunden."
            : "influx.env fehlt — docs/INSTALL.md, Abschnitt „InfluxDB“.",
        },
        {
          label: "Erster Modell-Lauf",
          done: (h?.models.count ?? 0) > 0,
          hint: h?.models.count
            ? `${h.models.count} Prognosen veröffentlicht.`
            : "Noch kein Modell-Lauf — Job „Modell-Update“ starten.",
        },
        {
          label: "Erste Empfehlung",
          done: decideRes.data?.decision_ready === true,
          hint:
            decideRes.data?.decision_ready === true
              ? "Der Kompass gibt eine belastbare Empfehlung."
              : "Noch nicht freigegeben — bis dahin zählen nur aktuelle Preise.",
        },
      ];
      return (
        <ol className="divide-y divide-slate-800/60">
          {steps.map((step, i) => (
            <li
              key={step.label}
              className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                  step.done
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-slate-700 bg-slate-900 text-slate-500"
                }`}
              >
                {step.done ? "✓" : i + 1}
              </span>
              <span className="text-xs leading-relaxed">
                <span
                  className={
                    step.done
                      ? "font-semibold text-slate-200"
                      : "font-semibold text-slate-400"
                  }
                >
                  {step.label}
                </span>{" "}
                <span className="text-slate-500">{step.hint}</span>
              </span>
            </li>
          ))}
        </ol>
      );
    })()}
  </section>

  {/* Güte-Kacheln */}
  <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
    <Metric
      label="Top-3-Trefferquote (30 Tage)"
      value={
        statsSummaryRes.data?.quality_metrics.top3_hit_rate !=
        null ? (
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
      label="Sprungfreie Tage · MASE"
      value={
        statsSummaryRes.data?.quality_metrics.mase_sprungfrei !=
        null ? (
          <span className="text-sky-300 font-mono">
            {euro(
              statsSummaryRes.data.quality_metrics.mase_sprungfrei,
              2,
            )}
          </span>
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
      label="95-%-Band-Trefferquote · PICP"
      value={
        statsSummaryRes.data?.quality_metrics.picp_95 != null ? (
          <span className="text-slate-100 font-mono">
            {percentLabel(
              statsSummaryRes.data.quality_metrics.picp_95,
              1,
            )}
          </span>
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
      label="Drift-Status · CUSUM"
      value={
        statsSummaryRes.data?.quality_metrics.cusum_drift ? (
          <span
            className={
              statsSummaryRes.data.quality_metrics.cusum_drift
                .status === "normal"
                ? "text-emerald-400 font-mono"
                : "text-amber-400 font-mono"
            }
          >
            {statsSummaryRes.data.quality_metrics.cusum_drift
              .status === "normal"
              ? `STABIL${statsSummaryRes.data.quality_metrics.cusum_drift.max_cusum != null ? ` (${euro(statsSummaryRes.data.quality_metrics.cusum_drift.max_cusum, 2)}σ)` : ""}`
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
    {/* A7: M7-Fortschritt — n/100 Empfehlungen + Brier gegen Ziel. */}
    <Metric
      label="M7-Kalibrierung"
      value={
        <span className="text-amber-300 font-mono">
          {liveAdvice?.n ?? 0}/
          {liveAdvice?.min_recommendations ?? M7_MIN_RECOMMENDATIONS}
        </span>
      }
      detail={
        liveAdvice?.brier_30d != null
          ? `Brier ${deNumber(liveAdvice.brier_30d)} (Ziel < ${deNumber(liveAdvice.brier_threshold ?? M7_BRIER_THRESHOLD)})`
          : "Brier noch nicht messbar — braucht bewertete Empfehlungen."
      }
      hint={m7Line ?? calibrationHint}
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
        {collector?.fresh
          ? "Frisch"
          : collector?.available
            ? "Veraltet"
            : "Kein Herzschlag"}
      </Badge>
    </div>
    {collector?.available ? (
      <div className="grid gap-4 text-xs sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-500">Letzter Poll (Pi)</span>
            <span className="font-mono text-slate-200">
              {timeLabel(collector.last_poll_at)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Alter</span>
            <span className="font-mono">
              {collector.age_minutes !== null &&
              collector.age_minutes !== undefined
                ? `${collector.age_minutes} Min.`
                : "—"}
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-500">tmpfs belegt</span>
            <span className="font-mono">
              {collector.tmpfs_used_bytes !== null &&
              collector.tmpfs_used_bytes !== undefined
                ? `${euro(Number(collector.tmpfs_used_bytes) / 1024 / 1024, 2)} MiB`
                : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Älteste Datei</span>
            <span className="font-mono">
              {collector.oldest_age_days !== null &&
              collector.oldest_age_days !== undefined
                ? `${collector.oldest_age_days} Tage`
                : "—"}
            </span>
          </div>
        </div>
      </div>
    ) : (
      <LoadError
        errorCode={
          collector?.error_code ||
          collector?.influx?.error_code ||
          health.errorCode
        }
        fallback="Noch kein Collector-Herzschlag auf dem NAS."
        onRetry={refreshNow}
        retryLabel="Status neu laden"
      />
    )}
  </section>

  {/* B4 (Rest): Zustellung sichtbar machen. Die Daten liegen in
      /api/v1/health → notify; ohne diese Kachel war nur per
      API-Abruf erkennbar, ob Alarme überhaupt jemanden erreichen. */}
  <section
    className={`${panel} mb-6 p-5 sm:p-6`}
    aria-labelledby="notify-heading"
  >
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3
        id="notify-heading"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <BellRing size={17} className="text-emerald-400" />
        Alarm-Zustellung · Push aufs Handy
      </h3>
      <Badge warning={notifyTone(h?.notify) !== "ok"}>
        {notifyTone(h?.notify) === "off"
          ? "Nicht eingerichtet"
          : notifyTone(h?.notify) === "alert"
            ? "Fehler gemeldet"
            : "Eingerichtet"}
      </Badge>
    </div>
    <p className="text-xs leading-relaxed text-slate-300">
      {notifyStatusLine(h?.notify)}
    </p>
    <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
      <div className="flex justify-between gap-3">
        <dt className="text-slate-500">Zuletzt gemeldet</dt>
        <dd className="font-mono text-slate-200">
          {h?.notify?.last_sent_at
            ? timeLabel(h.notify.last_sent_at)
            : "—"}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-slate-500">Zuletzt Entwarnung</dt>
        <dd className="font-mono text-slate-200">
          {h?.notify?.last_ok_at
            ? timeLabel(h.notify.last_ok_at)
            : "—"}
        </dd>
      </div>
    </dl>
    {(h?.notify?.open_errors?.length ?? 0) > 0 && (
      <ul className="mt-3 flex flex-wrap gap-2">
        {h?.notify?.open_errors?.map((code) => (
          <li
            key={code}
            title={problem(code) ?? code}
            className="rounded-md bg-amber-500/10 px-2 py-1 font-mono text-[11px] text-amber-300"
          >
            {code}
          </li>
        ))}
      </ul>
    )}
    <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
      {notifyLastLine(h?.notify) ??
        "Einrichtung: TANKAPP_NTFY_URL setzen (docs/BETRIEB.md, Abschnitt „Alarm-Zustellung über ntfy“). Verschickt werden nur Alarme mit Schweregrad „Fehler“ — ohne Preise, Stationen oder Pfade."}
    </p>
  </section>

  <section className={`${panel} mb-6 p-5 sm:p-6`}>
    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
      <Terminal size={17} className="text-emerald-400" />
      API-Explorer · nur lesend
    </h3>
    <p className="mb-4 text-[11px] text-slate-500">
      Dieselben Endpunkte, die diese GUI nutzt — live abgerufen, ohne
      Poll auszulösen. Aktuelle Endpunkte: decide, episodes, fills,
      stats/summary.
    </p>
    <ApiExplorer
      fuel={fuel}
      identity={identity}
      activeCity={activeCity}
      heatmapWeeks={heatmapWeeks}
    />
  </section>
</>
  );
}
