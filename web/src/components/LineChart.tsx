// Adapted from sample/good statistic gui: retain SVG geometry, palette and axes.

import React, { useState } from "react";
import { gapBands } from "../data";

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

const defaultXFmt = (x: number) =>
  new Date(x).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Kompakter SVG-Liniendiagramm-Baustein (dunkles Theme), mit Hover-Tooltip. */
export function LineChart({
  series,
  marks = [],
  height = 220,
  yFmt = (v: number) => v.toFixed(1),
  xFmt = defaultXFmt,
  ySuffix = " €/L",
  xTicks = [],
  gapMinutes = 0,
  gapLabel = "keine Daten",
}: {
  series: SeriesPts[];
  marks?: Mark[];
  height?: number;
  yFmt?: (v: number) => string;
  xFmt?: (x: number) => string;
  ySuffix?: string;
  xTicks?: { x: number; label: string }[];
  gapMinutes?: number;
  gapLabel?: string;
}) {
  const [hover, setHover] = useState<{ si: number; pi: number } | null>(null);
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

  // Lücken bleiben Lücken: sie werden als Band markiert, nie überbrückt.
  const bands = gapMinutes > 0 ? gapBands(series, gapMinutes) : [];
  const hoursLabel = (ms: number) => {
    const hours = ms / 3600000;
    const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
    return `${rounded}`.replace(".", ",");
  };

  const hovered =
    hover && series[hover.si]?.pts[hover.pi]
      ? { ...series[hover.si].pts[hover.pi], color: series[hover.si].color }
      : null;
  const tipLines = hovered
    ? [xFmt(hovered.x), `${yFmt(hovered.y)}${ySuffix}`]
    : [];
  const tipW =
    Math.max(...tipLines.map((l) => l.length), 0) * 6.4 + 18;
  const tipH = 40;
  let tipX = hovered ? X(hovered.x) + 10 : 0;
  tipX = Math.min(Math.max(tipX, padL), W - padR - tipW);
  const above = hovered ? Y(hovered.y) - tipH - 12 >= padT - 14 : true;
  const tipY = hovered
    ? above
      ? Y(hovered.y) - tipH - 10
      : Y(hovered.y) + 12
    : 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Diagramm"
      onMouseLeave={() => setHover(null)}
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
      {bands.map((band, i) => {
        const x1 = X(band.from);
        const x2 = X(band.to);
        const width = x2 - x1;
        return (
          <g key={`gap-${i}`}>
            <rect
              x={x1}
              y={padT - 4}
              width={width}
              height={ih + 8}
              rx={4}
              fill="#020617"
              opacity={0.55}
            />
            {width >= 90 && (
              <text
                x={(x1 + x2) / 2}
                y={padT + ih / 2}
                textAnchor="middle"
                fontSize={10}
                fill="#64748b"
              >
                {gapLabel} · {hoursLabel(band.to - band.from)} h
              </text>
            )}
          </g>
        );
      })}
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
          {s.pts.map((p, j) => (
            <circle
              key={`hit-${j}`}
              cx={X(p.x)}
              cy={Y(p.y)}
              r={9}
              fill="transparent"
              style={{ cursor: "crosshair" }}
              onMouseEnter={() => setHover({ si: i, pi: j })}
              onClick={() => setHover({ si: i, pi: j })}
            />
          ))}
        </g>
      ))}
      {hovered && (
        <g pointerEvents="none">
          <line
            x1={X(hovered.x)}
            x2={X(hovered.x)}
            y1={padT - 4}
            y2={H - padB}
            stroke={hovered.color}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.7}
          />
          <circle
            cx={X(hovered.x)}
            cy={Y(hovered.y)}
            r={4.5}
            fill={hovered.color}
            stroke="#fff"
            strokeWidth={1.5}
          />
          <rect
            x={tipX}
            y={tipY}
            width={tipW}
            height={tipH}
            rx={6}
            fill="#0f172a"
            stroke="#334155"
            strokeWidth={1}
          />
          {tipLines.map((line, i) => (
            <text
              key={i}
              x={tipX + 9}
              y={tipY + 16 + i * 15}
              fontSize={11}
              fill={i === 0 ? TXT : "#f1f5f9"}
              fontWeight={i === 0 ? 400 : 700}
            >
              {line}
            </text>
          ))}
        </g>
      )}
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
