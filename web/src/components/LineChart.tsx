// Adapted from sample/good statistic gui: retain SVG geometry, palette and axes.

import React from "react";

const AXIS = "#334155";
const TXT = "#94a3b8";

export interface SeriesPts {
  name?: string;
  color: string;
  dash?: string;
  pts: { x: number; y: number }[];
}

export interface Mark {
  x: number;
  color: string;
  label: string;
}

/** Kompakter SVG-Liniendiagramm-Baustein (dunkles Theme). */
export function LineChart({
  series,
  marks = [],
  height = 220,
  yFmt = (v: number) => v.toFixed(1),
  xTicks = [],
}: {
  series: SeriesPts[];
  marks?: Mark[];
  height?: number;
  yFmt?: (v: number) => string;
  xTicks?: { x: number; label: string }[];
}) {
  const W = 720;
  const H = height;
  const padL = 46;
  const padR = 12;
  const padT = 18;
  const padB = 24;
  const iw = W - padL - padR;
  const ih = H - padT - padB;

  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (const s of series) {
    for (const p of s.pts) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }
  for (const m of marks) {
    if (m.x < xMin) xMin = m.x;
    if (m.x > xMax) xMax = m.x;
  }
  if (!isFinite(xMin) || !isFinite(yMin)) {
    return (
      <div className="rounded-lg bg-slate-900/60 p-3 text-xs text-slate-500">
        keine Daten
      </div>
    );
  }
  if (xMax === xMin) xMax = xMin + 1;
  if (yMax === yMin) {
    yMax += 1;
    yMin -= 1;
  }
  const yPad = (yMax - yMin) * 0.12;
  yMin -= yPad;
  yMax += yPad;

  const X = (x: number) => padL + ((x - xMin) / (xMax - xMin)) * iw;
  const Y = (y: number) => padT + ih - ((y - yMin) / (yMax - yMin)) * ih;

  const path = (s: SeriesPts) =>
    s.pts
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`,
      )
      .join(" ");

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Diagramm"
    >
      {gridYs.map((gy, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={W - padR}
            y1={Y(gy)}
            y2={Y(gy)}
            stroke={AXIS}
            strokeWidth={0.6}
            strokeDasharray="3 4"
          />
          <text
            x={padL - 6}
            y={Y(gy) + 3.5}
            textAnchor="end"
            fontSize={10.5}
            fill={TXT}
          >
            {yFmt(gy)}
          </text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text
          key={i}
          x={X(t.x)}
          y={H - 7}
          textAnchor="middle"
          fontSize={10.5}
          fill={TXT}
        >
          {t.label}
        </text>
      ))}
      {marks.map((m, i) => (
        <g key={i}>
          <line
            x1={X(m.x)}
            x2={X(m.x)}
            y1={padT - 4}
            y2={H - padB}
            stroke={m.color}
            strokeWidth={1.4}
            strokeDasharray="5 3"
          />
          <text
            x={X(m.x)}
            y={padT - 8}
            textAnchor="middle"
            fontSize={10.5}
            fill={m.color}
          >
            {m.label}
          </text>
        </g>
      ))}
      {series.map((s, i) => (
        <g key={i}>
          <path
            d={path(s)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dash}
          />
          {s.pts.map((p, j) => (
            <circle key={j} cx={X(p.x)} cy={Y(p.y)} r={1.8} fill={s.color} />
          ))}
        </g>
      ))}
      {series.some((s) => s.name) && (
        <g>
          {series
            .filter((s) => s.name)
            .map((s, i) => (
              <g key={i} transform={`translate(${padL + i * 110}, 6)`}>
                <circle cx={4} cy={4} r={4} fill={s.color} />
                <text x={12} y={8} fontSize={10.5} fill={TXT}>
                  {s.name}
                </text>
              </g>
            ))}
        </g>
      )}
    </svg>
  );
}
