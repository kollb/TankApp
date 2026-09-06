"use client";

import React, { useState } from "react";
import { StationData, generateHeatmapMatrix } from "@/lib/engine";
import { Calendar, Percent, DollarSign, Info } from "lucide-react";

interface HeatmapViewerProps {
  station: StationData;
  fuel: "e10" | "e5" | "diesel";
}

export function HeatmapViewer({ station, fuel }: HeatmapViewerProps) {
  const [kind, setKind] = useState<"probability" | "level">("probability");
  const [hoveredCell, setHoveredCell] = useState<{
    day: string;
    hour: number;
    value: number;
  } | null>(null);

  const heatmap = generateHeatmapMatrix(station, fuel, kind);

  // Color generator for heatmap cell
  const getCellColor = (val: number) => {
    if (kind === "probability") {
      // 0% (red) -> 50% (slate/yellow) -> 100% (emerald)
      if (val >= 80) return "bg-emerald-500 text-slate-950 font-bold";
      if (val >= 65) return "bg-emerald-600/80 text-white";
      if (val >= 45) return "bg-slate-700/80 text-slate-200";
      if (val >= 30) return "bg-amber-600/70 text-slate-100";
      return "bg-rose-600/80 text-white";
    } else {
      // Level in ct/L: negative is cheaper (emerald), positive is expensive (rose)
      if (val <= -4.0) return "bg-emerald-500 text-slate-950 font-bold";
      if (val <= -1.5) return "bg-emerald-600/80 text-white";
      if (val <= 1.5) return "bg-slate-700/80 text-slate-200";
      if (val <= 4.0) return "bg-amber-600/70 text-slate-100";
      return "bg-rose-600/80 text-white";
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl">
      {/* Header with Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
              6-Wochen Aggregation
            </span>
            <span className="text-xs text-slate-400">
              Station: <span className="text-slate-200 font-medium">{station.name}</span>
            </span>
          </div>
          <h3 className="text-lg md:text-xl font-bold text-white mt-1">
            Intraday & Wochentags-Heatmap
          </h3>
          <p className="text-xs text-slate-400">
            Zeigt wiederkehrende Muster im 24h-Zyklus und die wöchentliche Preiselastizität
          </p>
        </div>

        {/* Toggle between Cheap-Probability and Price-Level */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setKind("probability")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
              kind === "probability"
                ? "bg-emerald-500 text-slate-950 font-bold shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Percent className="w-3.5 h-3.5" />
            Cheap-Probability P(p ≤ Median)
          </button>
          <button
            onClick={() => setKind("level")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
              kind === "level"
                ? "bg-emerald-500 text-slate-950 font-bold shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            Preisniveau (ct/L Delta)
          </button>
        </div>
      </div>

      {/* Heatmap Table Grid */}
      <div className="overflow-x-auto pb-2">
        <div className="min-w-[680px]">
          {/* Hour labels header */}
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

          {/* Matrix Rows */}
          {heatmap.matrix.map((row, dayIdx) => (
            <div key={dayIdx} className="flex items-center mb-1">
              <div className="w-10 flex-shrink-0 text-right pr-2 text-xs font-semibold text-slate-300">
                {heatmap.days[dayIdx]}
              </div>
              <div className="flex-1 grid grid-cols-24 gap-0.5">
                {row.map((val, h) => (
                  <div
                    key={h}
                    onMouseEnter={() => setHoveredCell({ day: heatmap.days[dayIdx], hour: h, value: val })}
                    onMouseLeave={() => setHoveredCell(null)}
                    className={`h-7 rounded-[3px] text-[10px] flex items-center justify-center cursor-pointer transition-transform hover:scale-110 hover:z-20 ${getCellColor(
                      val
                    )}`}
                    title={`${heatmap.days[dayIdx]} ${h}:00 Uhr: ${val} ${
                      kind === "probability" ? "% Wahrscheinlichkeit" : "ct/L"
                    }`}
                  >
                    {kind === "level" ? (val > 0 ? `+${val.toFixed(0)}` : val.toFixed(0)) : `${val}`}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip & Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-800 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          {hoveredCell ? (
            <div className="bg-slate-800 px-3 py-1 rounded-lg text-slate-200 font-mono text-xs border border-slate-700">
              <span className="text-emerald-400 font-bold">{hoveredCell.day} {hoveredCell.hour}:00 Uhr:</span>{" "}
              {kind === "probability"
                ? `${hoveredCell.value}% Chance auf Tiefstpreis`
                : `${hoveredCell.value > 0 ? `+${hoveredCell.value}` : hoveredCell.value} ct/L vs. Stadtmedian`}
            </div>
          ) : (
            <span className="text-xs text-slate-400 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-slate-500" />
              Tipp: Fahre mit der Maus über die Kacheln für genaue Werte je Stunde.
            </span>
          )}
        </div>

        {/* Color Scale Legend */}
        <div className="flex items-center gap-2 text-[11px]">
          <span>{kind === "probability" ? "Niedrige Chance" : "Teuer (+ct)"}</span>
          <div className="flex h-3 w-28 rounded overflow-hidden">
            <div className="flex-1 bg-rose-600" />
            <div className="flex-1 bg-amber-600" />
            <div className="flex-1 bg-slate-700" />
            <div className="flex-1 bg-emerald-600" />
            <div className="flex-1 bg-emerald-500" />
          </div>
          <span>{kind === "probability" ? "Sehr hohe Chance (≥80%)" : "Günstig (-ct)"}</span>
        </div>
      </div>
    </div>
  );
}
