"use client";

import React from "react";
import { Server, HardDrive, Cpu, Activity, Clock, ShieldCheck, Database, CheckCircle2 } from "lucide-react";

interface SystemHealthSectionProps {
  healthData?: {
    collectorStatus?: string;
    lastPollAt?: string | Date;
    windowStart?: string;
    windowEnd?: string;
    tmpfsBytesUsed?: number;
    tmpfsMaxBytes?: number;
    nasReachable?: boolean;
    coveragePct?: number;
    errorCount24h?: number;
  };
}

export function SystemHealthSection({ healthData }: SystemHealthSectionProps) {
  const tmpfsUsedMb = Number(((healthData?.tmpfsBytesUsed ?? 2621440) / (1024 * 1024)).toFixed(2));
  const tmpfsMaxMb = Number(((healthData?.tmpfsMaxBytes ?? 33554432) / (1024 * 1024)).toFixed(0));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              §6 System-Architektur Pi ↔ NAS
            </span>
            <span className="text-xs text-slate-400">
              Autark auf Raspberry Pi (1 GB) + Langzeit-TSM auf NAS
            </span>
          </div>
          <h3 className="text-lg md:text-xl font-bold text-white mt-1">
            Hardware- & Betriebs-Status (Pi 1 GB ↔ NAS InfluxDB)
          </h3>
          <p className="text-xs text-slate-400">
            Aufgabenteilung: Pi macht nur Inference & 24/7-Polls; rechenintensive Backtests & Fits laufen auf NAS
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Alle Komponenten online
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Raspberry Pi 1GB */}
        <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-slate-200 font-bold text-sm">
              <Cpu className="w-4 h-4 text-emerald-400" />
              Raspberry Pi (1 GB RAM)
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
              24/7 Online
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Rolle:</span>
              <span className="font-semibold text-slate-200">Collector + TankPuls API</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>RAM-Bedarf (RSS):</span>
              <span className="font-mono text-emerald-400">&lt; 180 MiB / ~390 MiB Reserve</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Polling-Fenster:</span>
              <span className="font-mono text-slate-200">06:00 – 24:00 Uhr (§4 Fix)</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>API-Rate:</span>
              <span className="font-mono text-slate-200">1 R / 300 s (216 Req/Tag)</span>
            </div>
          </div>
        </div>

        {/* Card 2: tmpfs Ring buffer */}
        <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-slate-200 font-bold text-sm">
              <HardDrive className="w-4 h-4 text-blue-400" />
              tmpfs /dev/shm/tankapp
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
              SD-Schonung
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Füllstand:</span>
              <span className="font-mono text-blue-400 font-bold">
                {tmpfsUsedMb} MB / {tmpfsMaxMb} MB ({((tmpfsUsedMb / tmpfsMaxMb) * 100).toFixed(1)}%)
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-blue-500 h-full rounded-full"
                style={{ width: `${(tmpfsUsedMb / tmpfsMaxMb) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Puffertiefe:</span>
              <span className="font-mono text-slate-200">7 Tage FIFO (Urlaubssicher)</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Schreibweise:</span>
              <span className="font-mono text-slate-200">JSONL idempotent mit Zeitstempel</span>
            </div>
          </div>
        </div>

        {/* Card 3: NAS Docker InfluxDB */}
        <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-slate-200 font-bold text-sm">
              <Database className="w-4 h-4 text-purple-400" />
              NAS (Docker InfluxDB v2)
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">
              J5040 / 16 GB
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Sync-Protokoll:</span>
              <span className="font-semibold text-slate-200">Line Protocol, Ack-Marker</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Tages-Ingest (F1):</span>
              <span className="font-mono text-slate-200">6.480 Datenpunkte/Tag (~0,3 MB)</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Engine-Fits:</span>
              <span className="font-mono text-purple-300">NAS (42 Refits Backtests)</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Retention Policy:</span>
              <span className="font-mono text-slate-200">5 Jahre TSM komprimiert</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
