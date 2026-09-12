// D1: Job-Karte (Startknopf + Status + Hinweis) aus Dashboard.tsx
// ausgelagert — System-Tab-Baustein mit eigener Start-Meldung.
import { useEffect, useState, type ReactNode } from "react";
import { Play, ScrollText } from "lucide-react";
import {
  epochLabel,
  jobRunMessage,
  postJobRun,
  problem,
  timeLabel,
  triggerSkipLabel,
  type Job,
  type JobRunNote,
} from "../data";
import { panel } from "./ui";

export function JobCard({

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
    if (result.status === "queued" || result.status === "running")
      onStarted?.();
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
            : job?.state === "aborted"
              ? "Abgebrochen"
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
            : job?.state === "aborted"
              ? "text-rose-400"
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
        {/* B24: Abbruchzeitpunkt und -phase eines hart beendeten Laufs. */}
        {job?.state === "aborted" && job.aborted_at && (
          <div className="flex justify-between">
            <span>Abgebrochen</span>
            <span className="font-mono text-slate-200">
              {timeLabel(job.aborted_at)}
              {job.aborted_phase ? ` · Phase ${job.aborted_phase}` : ""}
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
              {job.progress.phase_label || job.progress.phase || "Arbeitet …"}
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
