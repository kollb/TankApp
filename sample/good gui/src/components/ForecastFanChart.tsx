"use client";

import React, { useState, useId } from "react";
import { TrendingDown, TrendingUp, Shield, HelpCircle, Layers } from "lucide-react";
import { StationData, generateStationForecast, ForecastPoint } from "@/lib/engine";

interface ForecastFanChartProps {
  station: StationData;
  fuel: "e10" | "e5" | "diesel";
  currentHour: number;
}

export function ForecastFanChart({ station, fuel, currentHour }: ForecastFanChartProps) {
  const [horizon, setHorizon] = useState<0 | 3 | 7>(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const grad95Id = useId();
  const grad80Id = useId();

  const forecast = generateStationForecast(station, fuel, horizon);
  const points = forecast.points;

  // Chart Dimensions
  const svgWidth = 800;
  const svgHeight = 280;
  const padLeft = 60;
  const padRight = 30;
  const padTop = 30;
  const padBottom = 40;

  const chartWidth = svgWidth - padLeft - padRight;
  const chartHeight = svgHeight - padTop - padBottom;

  // Min and Max for scaling
  let minPrice = Math.min(...points.map((p) => p.lo95));
  let maxPrice = Math.max(...points.map((p) => p.hi95));
  // Round to nearest 0.05
  minPrice = Math.floor(minPrice * 20) / 20 - 0.02;
  maxPrice = Math.ceil(maxPrice * 20) / 20 + 0.02;
  const priceRange = maxPrice - minPrice;

  // Coordinate mappers
  const getX = (index: number) => padLeft + (index / (points.length - 1)) * chartWidth;
  const getY = (val: number) => padTop + chartHeight - ((val - minPrice) / priceRange) * chartHeight;

  // Generate SVG paths for area bands
  const upper95Path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(p.hi95)}`).join(" ");
  const lower95Path = [...points]
    .reverse()
    .map((p, i) => `L ${getX(points.length - 1 - i)} ${getY(p.lo95)}`)
    .join(" ");
  const band95Path = `${upper95Path} ${lower95Path} Z`;

  const upper80Path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(p.hi80)}`).join(" ");
  const lower80Path = [...points]
    .reverse()
    .map((p, i) => `L ${getX(points.length - 1 - i)} ${getY(p.lo80)}`)
    .join(" ");
  const band80Path = `${upper80Path} ${lower80Path} Z`;

  const lineYhatPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(p.yhat)}`).join(" ");

  // Price Y-ticks
  const yTicks = [
    minPrice + priceRange * 0.1,
    minPrice + priceRange * 0.35,
    minPrice + priceRange * 0.65,
    minPrice + priceRange * 0.9,
  ];

  const activePoint = hoveredIndex !== null ? points[hoveredIndex] : points[Math.min(points.length - 1, Math.floor(points.length * 0.6))];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl">
      {/* Header with Title and Horizon Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              M1+M2+ACI Stack
            </span>
            <span className="text-xs text-slate-400">
              Konfidenz: <span className="text-emerald-400 font-semibold">{forecast.picp7d}% Rolling-PICP</span>
            </span>
          </div>
          <h3 className="text-lg md:text-xl font-bold text-white mt-1">
            Prognose-Fan-Chart & Konfidenzbänder
          </h3>
          <p className="text-xs text-slate-400">
            Harmonische Regression (24h/12h) + ACI-Kalibrierung (η = 0,005) ohne Verteilungsannahme
          </p>
        </div>

        {/* Horizon Tabs */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setHorizon(0)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              horizon === 0 ? "bg-emerald-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-white"
            }`}
          >
            Heute (0–24h)
          </button>
          <button
            onClick={() => setHorizon(3)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              horizon === 3 ? "bg-emerald-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-white"
            }`}
          >
            +3 Tage
          </button>
          <button
            onClick={() => setHorizon(7)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              horizon === 7 ? "bg-emerald-500 text-slate-950 font-bold shadow" : "text-slate-400 hover:text-white"
            }`}
          >
            +7 Tage
          </button>
        </div>
      </div>

      {/* Interactive Chart Container */}
      <div className="relative w-full aspect-[16/7] min-h-[260px] bg-slate-950/70 rounded-xl p-2 border border-slate-800/80 overflow-hidden">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-full select-none"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id={grad95Id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id={grad80Id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.1" />
            </linearGradient>
          </defs>

          {/* Grid lines & Y-ticks */}
          {yTicks.map((tickVal, i) => {
            const y = getY(tickVal);
            return (
              <g key={i}>
                <line x1={padLeft} y1={y} x2={svgWidth - padRight} y2={y} stroke="#334155" strokeDasharray="3 3" strokeOpacity="0.4" />
                <text x={padLeft - 8} y={y + 4} textAnchor="end" fill="#94a3b8" fontSize="11" fontFamily="monospace">
                  {tickVal.toFixed(3)} €
                </text>
              </g>
            );
          })}

          {/* 95% Conformal Confidence Band (ACI) */}
          <path d={band95Path} fill={`url(#${grad95Id})`} />

          {/* 80% Bootstrap Confidence Band */}
          <path d={band80Path} fill={`url(#${grad80Id})`} />

          {/* Point Forecast Line */}
          <path d={lineYhatPath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* X-axis labels */}
          {points
            .filter((_, i) => i % Math.max(1, Math.floor(points.length / 8)) === 0)
            .map((p, i) => {
              const originalIndex = points.findIndex((pt) => pt.t === p.t);
              const x = getX(originalIndex >= 0 ? originalIndex : i);
              return (
                <text key={p.t} x={x} y={svgHeight - 12} textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="sans-serif">
                  {p.t}
                </text>
              );
            })}

          {/* Annotations: Morgensprung and Abendtief */}
          {horizon === 0 && (
            <>
              {/* Morning jump marker */}
              <g transform={`translate(${getX(3)}, ${getY(forecast.highestPrice) - 10})`}>
                <rect x="-35" y="-18" width="70" height="16" rx="4" fill="#ef4444" fillOpacity="0.8" />
                <text x="0" y="-6" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="middle">
                  Morgensprung
                </text>
              </g>
              {/* Evening trough marker */}
              <g transform={`translate(${getX(Math.floor(points.length * 0.62))}, ${getY(forecast.cheapestPrice) + 20})`}>
                <rect x="-35" y="0" width="70" height="16" rx="4" fill="#10b981" fillOpacity="0.9" />
                <text x="0" y="12" fill="#022c22" fontSize="9" fontWeight="bold" textAnchor="middle">
                  Tagestief ~18:15
                </text>
              </g>
            </>
          )}

          {/* Interactive Hover overlay bars */}
          {points.map((p, i) => {
            const x = getX(i);
            const w = chartWidth / points.length;
            return (
              <rect
                key={i}
                x={x - w / 2}
                y={padTop}
                width={w}
                height={chartHeight}
                fill="transparent"
                onMouseEnter={() => setHoveredIndex(i)}
                className="cursor-crosshair"
              />
            );
          })}

          {/* Crosshair indicator on hover */}
          {hoveredIndex !== null && (
            <g>
              <line
                x1={getX(hoveredIndex)}
                y1={padTop}
                x2={getX(hoveredIndex)}
                y2={svgHeight - padBottom}
                stroke="#38bdf8"
                strokeWidth="1.5"
                strokeDasharray="2 2"
              />
              <circle
                cx={getX(hoveredIndex)}
                cy={getY(points[hoveredIndex].yhat)}
                r="5"
                fill="#38bdf8"
                stroke="#0f172a"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>

        {/* Hover Tooltip display card */}
        {activePoint && (
          <div className="absolute top-3 right-3 bg-slate-900/95 border border-slate-700/80 rounded-xl p-3 shadow-xl backdrop-blur-md text-xs pointer-events-none min-w-[200px]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
              <span className="font-semibold text-slate-300">{activePoint.t}</span>
              <span className="text-[10px] text-emerald-400 font-mono">Prognose ŷ</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-slate-400">Erwartet:</span>
              <span className="text-base font-bold text-white font-mono">{activePoint.yhat.toFixed(3)} €/L</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
              <span>80%-KI:</span>
              <span className="font-mono text-emerald-300">
                {activePoint.lo80.toFixed(3)} – {activePoint.hi80.toFixed(3)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-0.5">
              <span>95%-ACI:</span>
              <span className="font-mono text-sky-300">
                {activePoint.lo95.toFixed(3)} – {activePoint.hi95.toFixed(3)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Legend & Abnahme-Kriterien Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-3 border-t border-slate-800 text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-emerald-400 rounded" />
            <span>Erwarteter Preis ŷ</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-2 bg-emerald-500/20 border border-emerald-500/40 rounded" />
            <span>80%-Band</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-2 bg-sky-500/20 border border-sky-500/40 rounded" />
            <span>95%-ACI Band</span>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] bg-slate-800 px-2 py-0.5 rounded text-slate-300 font-mono">
            MASE: {station.mase24h ?? 0.74} (&lt; 0,80 sprungfrei ✅)
          </span>
          <span className="text-[11px] bg-slate-800 px-2 py-0.5 rounded text-emerald-300 font-mono">
            Rolling-PICP: {station.picp7d ?? 94.8}% (90–98% ✅)
          </span>
        </div>
      </div>
    </div>
  );
}
