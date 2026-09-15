// System — Anlage & Daten (docs/UI-NEUENTWURF.md §5.5, Phase 4).
//
// Feste Reihenfolge, nie anders:
//   ① Zustand (4 Bausteine, je eine Zeile: Collector, Datenbank, Modelle, App)
//   ② Daten (Abdeckung je Stadt/Kraftstoff, Stationen-Zustände & Zwillinge, Güte)
//   ③ Läufe & Protokolle (Job-Karten + Job-Log)
//   ④ Störungen (Alarme, Alarm-Zustellung, Checkliste)
//   ⑤ Diagnose (API-Explorer, Export)
//   — darunter die Frische-Fußzeile (fester Platz, jede Ansicht)
//
// Die View rendert, sie entscheidet nichts (D1): Zustand, Abdeckung, Frische
// und Begründungen kommen aus `system.ts` und sind dort getestet.

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BellRing,
  Cpu,
  Database,
  FileJson,
  Gauge,
  LineChart as ChartIcon,
  Play,
  Scale,
  ScrollText,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { ApiExplorer } from "../components/ApiExplorer";
import { JobCard } from "../components/JobCard";
import { Level1Sheet } from "../components/Level1Sheet";
import { LoadError } from "../components/LoadError";
import { Badge, Empty, InfoTooltip, Metric, panel } from "../components/ui";
import { SkeletonPanel } from "../components/Skeleton";
import {
  GLOSSARY,
  JOB_LABELS,
  M7_BRIER_THRESHOLD,
  M7_MIN_RECOMMENDATIONS,
  countLabel,
  deNumber,
  deTrimmed,
  euro,
  lifecycleTip,
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
import {
  systemDataCoverage,
  systemExplanationDaten,
  systemExplanationLaeufe,
  systemExplanationStoerungen,
  systemExplanationZustand,
  systemFreshness,
  systemOverallLabel,
  webhookLine,
  systemOverallTone,
  systemDiagnosticExport,
  systemDiagnosticFilename,
  systemSetupSteps,
  systemStatusRows,
  type SystemStatusRow,
} from "../system";
import type { LabSectionId } from "../lab";
import { useOverview } from "../state/overview";

// U8: Die System-View holt sich ihre Daten aus dem OverviewContext. Von der
// Root kommt nur noch der Ebene-2-Sprung (onDeepen). Das Log-Terminal ist
// Bereichszustand: Die DOM-Referenzen, das Scrollverhalten und die
// Start-Kommandos besitzt diese View; die Job-Auswahl (logJob/Zeilen/Reload)
// bleibt im Context, weil der Hinweisblock fehlgeschlagener Jobs in der Root
// „Log ansehen“ anbietet.
export interface SystemViewProps {
  /** Ebene 2: der Labor-Abschnitt, der diese Zahl beweist (§7). */
  onDeepen: (section: LabSectionId) => void;
}

const TONE_DOT: Record<string, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  error: "bg-rose-400",
  unknown: "bg-slate-500",
};

const TONE_BORDER: Record<string, string> = {
  ok: "border-emerald-500/20 bg-emerald-950/10",
  warn: "border-amber-500/20 bg-amber-950/10",
  error: "border-rose-500/20 bg-rose-950/20",
  unknown: "border-slate-700 bg-slate-900/40",
};

function StatusDot({ tone }: { tone: SystemStatusRow["tone"] }) {
  return <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${TONE_DOT[tone] ?? "bg-slate-500"}`} />;
}

function StatusRowCard({ row }: { row: SystemStatusRow }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${TONE_BORDER[row.tone] ?? "border-slate-800 bg-slate-900/40"}`}>
      <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-700/60 bg-slate-950/60">
        <StatusDot tone={row.tone} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-semibold text-slate-200">{row.label}</span>
          <span className="text-xs font-bold text-white">{row.headline}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{row.detail}</p>
        {row.meta && <p className="mt-1 font-mono text-xs text-slate-500">{row.meta}</p>}
      </div>
    </div>
  );
}

export function SystemView(props: SystemViewProps) {
  const { onDeepen } = props;
  const ov = useOverview();
  const {
    activeCity,
    calibrationHint,
    collector,
    data,
    decideRes,
    fresh,
    fuel,
    h,
    health,
    heatmapWeeks,
    identity,
    jobLog,
    liveAdvice,
    logJob,
    logLineCount,
    logLines,
    m7Line,
    refreshNow,
    selection,
    setLogJob,
    setLogLineCount,
    setLogReload,
    showJobLog,
    stations,
    statsSummaryRes,
  } = ov;

  // U8: Das Terminal besitzt sein DOM selbst — neueste Zeile unten, beim
  // Job-Wechsel automatisch ans Ende; ein explicit angezeigtes Log
  // („Log ansehen“) scrollt zusätzlich in den Blick.
  const logRef = useRef<HTMLElement | null>(null);
  const logBodyRef = useRef<HTMLPreElement | null>(null);
  const firstLogRender = useRef(true);
  useEffect(() => {
    const box = logBodyRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [logLines.length, logJob]);
  useEffect(() => {
    if (firstLogRender.current) {
      firstLogRender.current = false;
      return;
    }
    requestAnimationFrame(() =>
      logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, [logJob]);
  // Start-Kommandos sind Ansichtssache (abhängig vom gewählten Job).
  const webhookCapable = logJob === "models" || logJob === "selection";
  const triggerCommand = `curl -X POST http://<nas>:1355/api/v1/jobs/trigger -H "Authorization: Bearer $TANKAPP_WEBHOOK_TOKEN" -H 'Content-Type: application/json' -d '{"job":"${logJob}"}'`;
  const workerCommand = `docker exec tankapp-app python3 -m app.worker ${logJob}`;

  const [sheet, setSheet] = useState<"zustand" | "daten" | "laeufe" | "stoerungen" | null>(null);

  const statusRows = systemStatusRows({ health: h, collector: collector ?? h?.collector });
  // B8: Zustand des Triggers Pi → NAS (kommt mit dem Herzschlag-Punkt).
  const hook = webhookLine((collector ?? h?.collector)?.webhook ?? null);
  const overallTone = systemOverallTone(statusRows);
  const overallLabel = systemOverallLabel(overallTone);
  const coverage = systemDataCoverage({ data, stations, freshCount: fresh.length, selection: selection.data ?? null });
  const freshnessInfo = systemFreshness({
    healthAt: h?.generated_at ?? health.data?.generated_at ?? null,
    collectorAt: collector?.last_poll_at ?? h?.collector?.last_poll_at ?? null,
    modelsAt: h?.models?.published_at ?? null,
    selectionAt: selection.data?.generated_at ?? null,
  });

  const setupSteps = systemSetupSteps({ health: h, collector: collector ?? h?.collector, decideReady: decideRes.data?.decision_ready === true });
  const alarms = h?.alarms ?? [];
  const errorAlarms = alarms.filter((a) => a.severity === "error");
  const warnAlarms = alarms.filter((a) => a.severity !== "error");

  const isLoadingHealth = health.pending && !h;
  const isErrorHealth = health.error && !h;
  const isEmptyData = !data?.stations.length && (data?.connection_error === "polling_missing" || !h?.jobs_enabled);

  const FRESHNESS_TONE = {
    ok: "text-slate-500",
    warn: "text-amber-300",
    bad: "text-rose-300",
  } as const;

  return (
    <section aria-labelledby="system-title">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[.2em] text-emerald-500">System · Anlage &amp; Daten</p>
          <h1 id="system-title" className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Einmal einrichten. Weiterlaufen lassen.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Der Pi sammelt. Das NAS speichert, rechnet und stellt diese Oberfläche bereit. Vier Bausteine, vier Sätze — alles andere eine Ebene tiefer.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
            overallTone === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : overallTone === "warn"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : overallTone === "error"
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  : "border-slate-700 bg-slate-900 text-slate-400"
          }`}
        >
          <StatusDot tone={overallTone} />
          {overallLabel}
        </span>
      </div>

      {/* ① Zustand — vier Bausteine, je eine Zeile */}
      <div className={`${panel} mb-4 p-5 sm:p-6`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Server size={16} className="text-emerald-400" aria-hidden="true" />
            Zustand — vier Bausteine
          </h2>
          <button
            onClick={() => setSheet("zustand")}
            aria-haspopup="dialog"
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-600"
          >
            Warum?
          </button>
        </div>

        {isLoadingHealth ? (
          <SkeletonPanel lines={4} label="Systemzustand wird geladen" />
        ) : isErrorHealth ? (
          <LoadError
            errorCode={health.errorCode}
            fallback="Systemzustand derzeit nicht erreichbar."
            onRetry={refreshNow}
            retryLabel="Status neu laden"
          />
        ) : (
          <>
            <div className="grid gap-2">
              {statusRows.map((row) => (
                <StatusRowCard key={row.id} row={row} />
              ))}
            </div>

            {(collector?.available || h?.collector?.available) && (
              <div className="mt-4 grid gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                    <Cpu size={12} aria-hidden="true" /> Collector-Details
                  </p>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Letzter Poll (Pi)</span>
                    <span className="font-mono text-slate-200">{timeLabel((collector ?? h?.collector)?.last_poll_at)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Alter</span>
                    <span className="font-mono text-slate-200">
                      {(collector ?? h?.collector)?.age_minutes != null ? `${deTrimmed((collector ?? h?.collector)?.age_minutes ?? 0, 0)} Min.` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">tmpfs belegt</span>
                    <span className="font-mono text-slate-200">
                      {(collector ?? h?.collector)?.tmpfs_used_bytes != null
                        ? `${deTrimmed(Number((collector ?? h?.collector)?.tmpfs_used_bytes) / 1024 / 1024, 1)} MiB`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Älteste Datei</span>
                    <span className="font-mono text-slate-200">
                      {(collector ?? h?.collector)?.oldest_age_days != null ? `${(collector ?? h?.collector)?.oldest_age_days} Tage` : "—"}
                    </span>
                  </div>
                  {/* B8: Trigger Pi → NAS. Der Uploader meldet mit jedem
                      Herzschlag, ob eine Quittierung offen ist — vorher war
                      ein verlorener Trigger unsichtbar (nur noch Intervall). */}
                  <div className="flex items-start justify-between gap-3 text-xs">
                    <span className="shrink-0 text-slate-500">Trigger Pi → NAS</span>
                    <span className="flex items-start gap-1.5 text-right">
                      <span className="mt-1">
                        <StatusDot tone={hook.tone} />
                      </span>
                      <span className="text-slate-200">{hook.text}</span>
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Offene Preise im Set</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Stadt</span>
                    <span className="font-mono text-slate-200">{(collector ?? h?.collector)?.city ?? activeCity ?? "—"}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Offen / Gesamt</span>
                    <span className="font-mono text-slate-200">
                      {(collector ?? h?.collector)?.open_count != null
                        ? `${(collector ?? h?.collector)?.open_count} / ${(collector ?? h?.collector)?.total_count ?? "—"}`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Frische Preise (GUI)</span>
                    <span className="font-mono text-slate-200">
                      {fresh.length} · {activeCity || "—"}
                    </span>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-500 sm:col-span-2">
                  {hook.note}
                </p>
              </div>
            )}

            <div className="mt-4">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-300">
                <ShieldCheck size={14} className="text-emerald-400" aria-hidden="true" />
                Einrichtung &amp; eigene Daten
              </h3>
              <ol className="divide-y divide-slate-800/60 rounded-lg border border-slate-800">
                {setupSteps.map((step, i) => (
                  <li key={step.label} className="flex items-start gap-3 px-3 py-2.5 first:rounded-t-xl last:rounded-b-xl">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                        step.done ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-700 bg-slate-900 text-slate-500"
                      }`}
                    >
                      {step.done ? "✓" : i + 1}
                    </span>
                    <span className="text-xs leading-relaxed">
                      <span className={step.done ? "font-semibold text-slate-200" : "font-semibold text-slate-400"}>{step.label}</span> <span className="text-slate-500">{step.hint}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href="/api/v1/fills.csv"
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
                >
                  Belege als CSV herunterladen
                </a>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ② Daten — Abdeckung, Lebenszyklus, Zwillinge, Güte */}
      <div className={`${panel} mb-4 p-5 sm:p-6`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Database size={16} className="text-emerald-400" aria-hidden="true" />
            Daten — Abdeckung &amp; Qualität
          </h2>
          <button
            onClick={() => setSheet("daten")}
            aria-haspopup="dialog"
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-600"
          >
            Warum?
          </button>
        </div>

        {isEmptyData && (
          <div className="mb-4">
            <Empty>Das gemeinsame Polling-Set fehlt auf diesem Server.</Empty>
            {data?.connection_error === "polling_missing" && (
              <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-950/20 p-4 text-xs leading-relaxed text-amber-200/80 break-words">
                Keine Stadt eingerichtet. Collector-Herzschlag {collector?.available ? "ok" : "fehlt"} und InfluxDB-Lesezugang {h?.influx_configured ? "ok" : "fehlt"} nutzen ohne Polling-Set nichts. Auf dem Pi{" "}
                <code className="break-all">{h?.polling_path || "data/analysis/stations/polling.json"}</code>{" "}
                erzeugen (Anleitung: Abschnitt Polling-Set, danach activate-polling), auf dem NAS{" "}
                <code className="break-all">TANKAPP_POLLING_FILE</code> prüfen (compose.yml → /config/polling.json, nur lesend) und{" "}
                <code className="break-all">ops/nas/preflight.sh</code> ausführen.
              </div>
            )}
          </div>
        )}

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">Stationen im Set</p>
            <p className="mt-1 text-lg font-bold text-white">{countLabel(coverage.stationCount)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {coverage.cities.length ? coverage.cities.join(" · ") : "Keine Stadt"} · {coverage.fuel.toUpperCase()}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">Frische Preise</p>
            <p className="mt-1 text-lg font-bold text-emerald-300">{countLabel(coverage.freshCount)}</p>
            <p className="mt-1 text-xs text-slate-500">Offen, Preis vorhanden, höchstens 30 Minuten alt — zählt für „Jetzt“.</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">Coverage-Gate</p>
            <p className="mt-1 font-mono text-sm font-bold text-slate-100">{coverage.coverageWindow ?? "—"}</p>
            <p className="mt-1 text-xs text-slate-500">
              {coverage.coverageReference != null
                ? `Bestwert ${percentLabel(coverage.coverageReference * 100)} · Schwelle ${coverage.coverageThreshold != null ? percentLabel(coverage.coverageThreshold * 100) : "—"}`
                : "Misst im Polling-Fenster relativ zum Stadt-Bestwert."}
            </p>
          </div>
        </div>

        <div className="mb-4">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Activity size={14} className="text-amber-400" aria-hidden="true" />
            Stationen: Zustände &amp; Preis-Zwillinge
          </h3>
          {selection.data ? (
            <>
              <div className="grid gap-3 text-xs sm:grid-cols-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Ohne Preis seit Tagen — tot <InfoTooltip label="tot" text={lifecycleTip("dead")} />
                  </p>
                  <p className="mt-1 text-lg font-bold text-rose-300">{countLabel(selection.data.dead_count ?? 0)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Fällt aus dem Ranking — kein Vergleichsplatz mehr. Das Polling-Set ändert sich erst nach Bestätigung.
                    {selection.data.dead_stations?.length ? ` Beispiel: ${selection.data.dead_stations.slice(0, 2).join(", ")}` : ""}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Temporär geschlossen / führt nicht{" "}
                    <InfoTooltip label="Unterschied" text="geschlossen = Status geschlossen · führt nicht = offen, aber Sorte als false gemeldet" />
                  </p>
                  <p className="mt-1 text-lg font-bold text-amber-300">
                    {countLabel((selection.data.closed_count ?? 0) + (selection.data.nofuel_count ?? 0))}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {selection.data.closed_count ?? 0} geschlossen · {selection.data.nofuel_count ?? 0} ohne diese Sorte. Bleiben unterscheidbar — nur „tot“ fällt raus.
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Preis-Zwillinge{" "}
                    <InfoTooltip
                      label="Preis-Zwillinge"
                      text="Identische Verläufe über 28 Tage bei 90 % Überlappung und 99 % Übereinstimmung — Warnung, nie automatische Entfernung."
                    />
                  </p>
                  <p className="mt-1 text-lg font-bold text-amber-300">{countLabel(selection.data.price_twin_count ?? 0)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {(selection.data.price_twin_count ?? 0) > 0 ? "Prüfen und bestätigen — dann ggf. Polling-Set bereinigen." : "Keine identischen Verläufe erkannt."}
                  </p>
                </div>
              </div>
              {(selection.data.price_twins?.length ?? 0) > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-500">
                        <th className="py-2 pr-3">Paar</th>
                        <th className="py-2 pr-3">Stadt</th>
                        <th className="py-2 pr-3">Tage · Punkte</th>
                        <th className="py-2 pr-3">Übereinstimmung</th>
                        <th className="py-2 pr-3">Ø Abweichung</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {selection.data.price_twins!.slice(0, 10).map((t) => (
                        <tr key={`${t.station_a}-${t.station_b}`}>
                          <td className="py-2 pr-3 font-mono text-slate-200">
                            {t.station_a} · {t.station_b}
                          </td>
                          <td className="py-2 pr-3 text-slate-300">{t.city}</td>
                          <td className="py-2 pr-3 font-mono">
                            {t.qualifying_days} · {t.common_points}
                          </td>
                          <td className="py-2 pr-3 font-mono">{euro(t.agreement_pct, 1)} %</td>
                          <td className="py-2 pr-3 font-mono">{t.mean_abs_delta_ct != null ? `${euro(t.mean_abs_delta_ct, 2)} ct/L` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    Schwellen: ≥ 28 Tage mit je ≥ 12 gemeinsamen Punkten · ≥ 90 % Überlappung · ≥ 99 % innerhalb 0,1 ct/L. Mehr im Glossar —{" "}
                    {GLOSSARY.find((g) => g.id === "twins")?.de ?? "Preis-Zwillinge"}.
                  </p>
                </div>
              )}
            </>
          ) : selection.pending ? (
            <p className="text-xs text-slate-500">Ranking wird geladen …</p>
          ) : (
            <p className="text-xs text-slate-500">Noch kein Ranking — Zwilling- und Zustandsprüfung folgen mit dem nächsten Selektionslauf.</p>
          )}
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Gauge size={14} className="text-emerald-400" aria-hidden="true" />
            Güte &amp; Kalibrierung
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric
              label="Top-3-Trefferquote (30 Tage)"
              value={
                statsSummaryRes.data?.quality_metrics.top3_hit_rate != null ? (
                  <span className="font-mono text-emerald-300">
                    {percentLabel(statsSummaryRes.data.quality_metrics.top3_hit_rate * 100)}
                  </span>
                ) : (
                  <span className="font-mono text-slate-500">—</span>
                )
              }
              detail="Tagesminimum in einem der 3 empfohlenen Zeitfenster. Ziel > 60 %."
              hint={statsSummaryRes.data?.quality_metrics.top3_hit_rate == null ? calibrationHint : null}
            />
            <Metric
              label="Sprungfreie Tage · MASE"
              value={
                statsSummaryRes.data?.quality_metrics.mase_sprungfrei != null ? (
                  <span className="font-mono text-sky-300">{euro(statsSummaryRes.data.quality_metrics.mase_sprungfrei, 2)}</span>
                ) : (
                  <span className="font-mono text-slate-500">—</span>
                )
              }
              detail="Skalierter Fehler an sprungfreien Tagen. Ziel < 0.80."
              hint={statsSummaryRes.data?.quality_metrics.mase_sprungfrei == null ? calibrationHint : null}
            />
            <Metric
              label="95-%-Band-Trefferquote · PICP"
              value={
                statsSummaryRes.data?.quality_metrics.picp_95 != null ? (
                  <span className="font-mono text-slate-100">{percentLabel(statsSummaryRes.data.quality_metrics.picp_95, 1)}</span>
                ) : (
                  <span className="font-mono text-slate-500">—</span>
                )
              }
              detail="Anteil echter Preise im Konfidenzband. Ziel 90–98 %."
              hint={statsSummaryRes.data?.quality_metrics.picp_95 == null ? calibrationHint : null}
            />
            <Metric
              label="Drift-Status · CUSUM"
              value={
                statsSummaryRes.data?.quality_metrics.cusum_drift ? (
                  <span
                    className={
                      statsSummaryRes.data.quality_metrics.cusum_drift.status === "normal"
                        ? "font-mono text-emerald-400"
                        : "font-mono text-amber-400"
                    }
                  >
                    {statsSummaryRes.data.quality_metrics.cusum_drift.status === "normal"
                      ? `STABIL${
                          statsSummaryRes.data.quality_metrics.cusum_drift.max_cusum != null
                            ? ` (${euro(statsSummaryRes.data.quality_metrics.cusum_drift.max_cusum, 2)}σ)`
                            : ""
                        }`
                      : statsSummaryRes.data.quality_metrics.cusum_drift.status.toUpperCase()}
                  </span>
                ) : (
                  <span className="font-mono text-slate-500">—</span>
                )
              }
              detail="Schranke |CUSUM| ≤ 3σ über 14 d zur Erkennung von Stationsumbau."
              hint={!statsSummaryRes.data?.quality_metrics.cusum_drift ? calibrationHint : null}
            />
            <Metric
              label="M7-Kalibrierung"
              value={
                <span className="font-mono text-amber-300">
                  {liveAdvice?.n ?? 0}/{liveAdvice?.min_recommendations ?? M7_MIN_RECOMMENDATIONS}
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
        </div>
      </div>

      {/* ③ Läufe & Protokolle */}
      <div className={`${panel} mb-4 p-5 sm:p-6`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <ChartIcon size={16} className="text-sky-400" aria-hidden="true" />
            Läufe &amp; Protokolle
          </h2>
          <button
            onClick={() => setSheet("laeufe")}
            aria-haspopup="dialog"
            className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-600"
          >
            Warum?
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

        <section ref={logRef} className="mt-6 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <ScrollText size={14} className="text-emerald-400" />
                Job-Log · letzte Zeilen direkt vom NAS
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Dieselben Zeilen liegen als Datei unter <code className="text-slate-400">data/runtime/jobs/{logJob}.log</code> (die letzten 500). Beim Auslesen
                werden Pfade und Zugangsdaten entfernt.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLogReload((n) => n + 1)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
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
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
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
              className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-200"
            >
              <option value={100}>letzte 100</option>
              <option value={200}>letzte 200</option>
              <option value={500}>letzte 500</option>
            </select>
          </div>
          <pre ref={logBodyRef} className="max-h-80 overflow-auto rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-xs leading-relaxed text-slate-300">
            {logLines.length ? logLines.join("\n") : jobLog.pending ? "Log wird geladen …" : "Noch keine Logzeilen für diesen Job."}
          </pre>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-500">
            <span>
              {jobLog.data?.available
                ? `${jobLog.data.count} von ${jobLog.data.total} Zeilen im Log`
                : jobLog.data
                  ? "Noch kein Log — der erste Lauf dieses Jobs schreibt es."
                  : ""}
            </span>
            {jobLog.data?.updated_at ? <span className="font-mono">Stand {timeLabel(jobLog.data.updated_at)}</span> : null}
          </div>
          <p className="mt-3 break-words rounded-lg bg-slate-950/60 p-2.5 text-xs leading-relaxed text-slate-500">
            Starten: der Knopf <Play size={11} className="inline align-[-1px]" /> in der jeweiligen Job-Karte oben (ohne Passwort, wirkt nur im NAS-Webauftritt,
            nie zwei Läufe gleichzeitig). Auf der Kommandozeile stattdessen <code className="text-slate-400">{workerCommand}</code> — Details in{" "}
            <span className="text-slate-400">docs/BETRIEB.md</span>.
          </p>
          {webhookCapable && (
            <p className="mt-2 break-words text-xs leading-relaxed text-slate-500">
              Vom Pi aus kommt derselbe Lauf über den Uploader-Webhook: <code className="text-slate-400">{triggerCommand}</code>
            </p>
          )}
        </section>
      </div>

      {/* ④ Störungen */}
      <div className={`${panel} mb-4 p-5 sm:p-6`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <BellRing size={16} className="text-amber-400" aria-hidden="true" />
            Störungen — Verlauf &amp; Checkliste
          </h2>
          <div className="flex items-center gap-2">
            <Badge warning={errorAlarms.length > 0 || warnAlarms.length > 0}>
              {errorAlarms.length ? `${errorAlarms.length} Fehler` : warnAlarms.length ? `${warnAlarms.length} Hinweise` : "Keine aktiven Störungen"}
            </Badge>
            <button
              onClick={() => setSheet("stoerungen")}
              aria-haspopup="dialog"
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-600"
            >
              Warum?
            </button>
          </div>
        </div>

        {alarms.length === 0 ? (
          <p className="text-xs leading-relaxed text-slate-400">
            Keine aktiven Störungen — die Anlage meldet keine Alarme. Der Header-Punkt zeigt denselben Stand als grünen Punkt.
          </p>
        ) : (
          <div className="grid gap-2">
            {alarms.map((alarm) => (
              <div
                key={`${alarm.code}-${alarm.job ?? ""}`}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  alarm.severity === "error" ? "border-rose-500/20 bg-rose-950/20" : "border-amber-500/20 bg-amber-950/20"
                }`}
              >
                <span
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${alarm.severity === "error" ? "bg-rose-400" : "bg-amber-400"}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-100">
                    {alarm.code}
                    {alarm.job ? <span className="ml-2 font-mono text-xs font-normal text-slate-500">{JOB_LABELS[alarm.job] ?? alarm.job}</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-300">{alarm.message}</p>
                  <p className="mt-1 font-mono text-xs text-slate-500">{problem(alarm.code) ?? alarm.code}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <BellRing size={14} className="text-emerald-400" />
              Alarm-Zustellung · Push aufs Handy
            </h3>
            <Badge warning={notifyTone(h?.notify) !== "ok"}>
              {notifyTone(h?.notify) === "off" ? "Nicht eingerichtet" : notifyTone(h?.notify) === "alert" ? "Fehler gemeldet" : "Eingerichtet"}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-slate-300">{notifyStatusLine(h?.notify)}</p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Zuletzt gemeldet</dt>
              <dd className="font-mono text-slate-200">{h?.notify?.last_sent_at ? timeLabel(h.notify.last_sent_at) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Zuletzt Entwarnung</dt>
              <dd className="font-mono text-slate-200">{h?.notify?.last_ok_at ? timeLabel(h.notify.last_ok_at) : "—"}</dd>
            </div>
          </dl>
          {(h?.notify?.open_errors?.length ?? 0) > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {h?.notify?.open_errors?.map((code) => (
                <li key={code} title={problem(code) ?? code} className="rounded-md bg-amber-500/10 px-2 py-1 font-mono text-xs text-amber-300">
                  {code}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            {notifyLastLine(h?.notify) ??
              "Einrichtung: TANKAPP_NTFY_URL setzen (docs/BETRIEB.md, Abschnitt „Alarm-Zustellung über ntfy“). Verschickt werden nur Alarme mit Schweregrad „Fehler“ — ohne Preise, Stationen oder Pfade."}
          </p>
        </div>
      </div>

      {/* ⑤ Diagnose */}
      <div className={`${panel} p-5 sm:p-6`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <FileJson size={16} className="text-slate-400" aria-hidden="true" />
            Diagnose &amp; Export
          </h2>
          <span className="font-mono text-xs text-slate-500">LAN-only · nichts verlässt die Anlage</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold text-slate-200">Belege, Version, Diagnose</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Alle Belege als CSV — für die Steuer oder den eigenen Notizzettel. Der Diagnose-Export bündelt Version, Zustand, Coverage und die letzten Log-Zeilen in einer Datei — ohne Tokens.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="/api/v1/fills.csv"
                className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-600"
              >
                /api/v1/fills.csv
              </a>
              <button
                type="button"
                onClick={() => {
                  const body = systemDiagnosticExport({
                    version: h?.version ?? null,
                    commit: h?.commit ?? null,
                    generatedAt: h?.generated_at ?? null,
                    overall: { tone: overallTone, label: overallLabel },
                    rows: statusRows,
                    coverage,
                    alarms,
                    logJob,
                    logLines,
                  });
                  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = systemDiagnosticFilename(h?.generated_at ?? null);
                  link.click();
                  URL.revokeObjectURL(url);
                }}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 hover:border-emerald-400/60"
              >
                Diagnose als Datei
              </button>
              <span className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-400">
                {h?.version ? `v${h.version}` : "—"} {h?.commit ? `(${h.commit})` : ""}
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold text-slate-200">Jobs manuell starten</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Der Knopf <Play size={11} className="inline align-[-1px]" /> in jeder Job-Karte startet denselben Lauf wie auf der Kommandozeile:{" "}
              <code className="text-slate-400">{workerCommand}</code>. Webhook: <code className="text-slate-400">{triggerCommand}</code>.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Terminal size={16} className="text-emerald-400" />
            API-Explorer · nur lesend
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            Dieselben Endpunkte, die diese GUI nutzt — live abgerufen, ohne Poll auszulösen. Aktuelle Endpunkte: decide, episodes, fills, stats/summary. Die API bleibt <code className="text-slate-400">/api/v1</code> — ein v2-Baum wird nicht erfunden.
          </p>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">
            PWA: der Service-Worker liegt unter <code className="text-slate-400">/sw.js</code> und hält die Oberfläche offline. Die Shell trägt die App-Version; steht eine neue bereit, sagt die App es („Neue Version verfügbar“). Belege und Vorsätze, die ohne Verbindung anfallen, warten lokal und werden nachgereicht (B10).
          </p>
          <ApiExplorer fuel={fuel} identity={identity} activeCity={activeCity} heatmapWeeks={heatmapWeeks} />
        </div>
      </div>

      {/* Frische-Fußzeile — fester Platz, jede Ansicht */}
      <p role="status" className={`mt-4 text-xs leading-relaxed ${FRESHNESS_TONE[freshnessInfo.tone]}`}>
        {freshnessInfo.text} · {activeCity || "kein Ort gewählt"}
      </p>

      <Level1Sheet
        open={sheet === "zustand"}
        title="Warum diese vier Bausteine?"
        sentences={systemExplanationZustand().sentences}
        source={systemExplanationZustand().source}
        labHint={systemExplanationZustand().labHint}
        onDeepen={(section) => {
          setSheet(null);
          onDeepen(section);
        }}
        onClose={() => setSheet(null)}
      />
      <Level1Sheet
        open={sheet === "daten"}
        title="Warum diese Daten?"
        sentences={systemExplanationDaten(coverage).sentences}
        source={systemExplanationDaten(coverage).source}
        labHint={systemExplanationDaten(coverage).labHint}
        onDeepen={(section) => {
          setSheet(null);
          onDeepen(section);
        }}
        onClose={() => setSheet(null)}
      />
      <Level1Sheet
        open={sheet === "laeufe"}
        title="Warum diese Läufe?"
        sentences={systemExplanationLaeufe(h?.jobs ?? null).sentences}
        source={systemExplanationLaeufe(h?.jobs ?? null).source}
        labHint={systemExplanationLaeufe(h?.jobs ?? null).labHint}
        onDeepen={(section) => {
          setSheet(null);
          onDeepen(section);
        }}
        onClose={() => setSheet(null)}
      />
      <Level1Sheet
        open={sheet === "stoerungen"}
        title="Warum diese Störungen?"
        sentences={systemExplanationStoerungen(alarms.length).sentences}
        source={systemExplanationStoerungen(alarms.length).source}
        labHint={systemExplanationStoerungen(alarms.length).labHint}
        onDeepen={(section) => {
          setSheet(null);
          onDeepen(section);
        }}
        onClose={() => setSheet(null)}
      />
    </section>
  );
}
