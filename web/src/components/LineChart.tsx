// Adapted from sample/good statistic gui: retain SVG geometry, palette and axes.

import React, { useId, useState } from "react";
import { gapBands, gapCompressedAxis } from "../data";

const AXIS = "#334155";
const TXT = "#94a3b8";

export interface SeriesPts {
  name?: string;
  color: string;
  dash?: string;
  pts: { x: number; y: number }[];
}

export interface BandPts {
  name?: string;
  color: string;
  pts: { x: number; yLow: number; yHigh: number }[];
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
  bands = [],
  marks = [],
  xDomain,
  height = 220,
  yFmt = (v: number) => v.toFixed(1),
  xFmt = defaultXFmt,
  ySuffix = " €/L",
  xTicks = [],
  gapMinutes = 0,
  gapLabel = "keine Daten",
  maxGapMinutes = 45,
}: {
  series: SeriesPts[];
  bands?: BandPts[];
  marks?: Mark[];
  xDomain?: [number, number];
  height?: number;
  yFmt?: (v: number) => string;
  xFmt?: (x: number) => string;
  ySuffix?: string;
  xTicks?: { x: number; label: string }[];
  gapMinutes?: number;
  gapLabel?: string;
  maxGapMinutes?: number;
}) {
  const [hover, setHover] = useState<{ si: number; pi: number } | null>(null);
  const hatchId = useId().replace(/:/g, "");
  const W = 720;
  const H = height;
  const padL = 46;
  const padR = 12;
  const padT = 18;
  const padB = 24;
  const iw = W - padL - padR;
  const ih = H - padT - padB;

  // Optionales festes Zeitfenster (z. B. 24 h): Daten außerhalb werden
  // ausgeschnitten, die Achse bleibt stabil statt an den Daten klebend.
  const hasDomain =
    xDomain !== undefined &&
    Number.isFinite(xDomain[0]) &&
    Number.isFinite(xDomain[1]) &&
    xDomain[1] > xDomain[0];
  const clip = <T extends { x: number }>(pts: T[]) =>
    hasDomain ? pts.filter((p) => p.x >= xDomain![0] && p.x <= xDomain![1]) : pts;
  const clipped = series.map((s) => ({ ...s, pts: clip(s.pts) }));
  const clippedBands = bands.map((b) => ({ ...b, pts: clip(b.pts) }));

  let xMin = hasDomain ? xDomain![0] : Infinity;
  let xMax = hasDomain ? xDomain![1] : -Infinity;
  let yMin = Infinity,
    yMax = -Infinity;
  for (const s of clipped) {
    for (const p of s.pts) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }
  for (const b of clippedBands) {
    for (const p of b.pts) {
      if (p.yLow < yMin) yMin = p.yLow;
      if (p.yHigh > yMax) yMax = p.yHigh;
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
  const yPad = (yMax - yMin) * 0.05;
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

  // Nur Innenlücken: ein schmaler Achsenstrich, keine Vollflächen.
  // Randlücken zum 24h-Fenster bleiben leer — die Achse ist das Fenster.
  const bandGaps =
    gapMinutes > 0 ? gapBands(clipped, gapMinutes) : [];
  const hoursLabel = (ms: number) => {
    const hours = ms / 3600000;
    const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
    return `${rounded}`.replace(".", ",");
  };

  const hovered =
    hover && clipped[hover.si]?.pts[hover.pi]
      ? { ...clipped[hover.si].pts[hover.pi], color: clipped[hover.si].color }
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

  const legendItems: { name: string; color: string; band: boolean }[] = [
    ...series.filter((s) => s.name).map((s) => ({
      name: s.name!,
      color: s.color,
      band: false,
    })),
    ...bands.filter((b) => b.name).map((b) => ({
      name: b.name!,
      color: b.color,
      band: true,
    })),
  ];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Diagramm"
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <pattern
          id={hatchId}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="6" stroke="#475569" strokeWidth="2" />
        </pattern>
      </defs>
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
      {xTicks
        .filter((t, i, all) => {
          if (t.x < xMin || t.x > xMax) return false;
          if (i === 0) return true;
          return X(t.x) - X(all[i - 1].x) >= 36;
        })
        .map((t, i) => (
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
      {bandGaps.map((band, i) => {
        const x1 = X(band.from);
        const x2 = X(band.to);
        const width = Math.max(1, x2 - x1);
        const barH = 7;
        const barY = H - padB - barH;
        const label =
          gapLabel && width >= 44
            ? `${gapLabel} · ${hoursLabel(band.to - band.from)} h`
            : null;
        return (
          <g key={`gap-${i}`}>
            <rect
              x={x1}
              y={barY}
              width={width}
              height={barH}
              rx={3}
              fill="#1e293b"
            />
            <rect
              x={x1}
              y={barY}
              width={width}
              height={barH}
              rx={3}
              fill={`url(#${hatchId})`}
              opacity={0.55}
            />
            {label && (
              <text
                x={(x1 + x2) / 2}
                y={barY - 3}
                textAnchor="middle"
                fontSize={8}
                fill="#64748b"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
      {clippedBands.map((b, i) => {
        if (b.pts.length < 2) return null;
        const top = b.pts
          .map((p) => `${X(p.x).toFixed(1)},${Y(p.yHigh).toFixed(1)}`)
          .join(" ");
        const bottom = [...b.pts]
          .reverse()
          .map((p) => `${X(p.x).toFixed(1)},${Y(p.yLow).toFixed(1)}`)
          .join(" ");
        return (
          <path
            key={`band-${i}`}
            d={`M${top} L${bottom} Z`}
            fill={b.color}
            opacity={0.16}
          />
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
      {clipped.map((s, i) => (
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
      {legendItems.length > 0 && (
        <g>
          {legendItems.map((item, i) => (
            <g key={i} transform={`translate(${padL + i * 130}, 6)`}>
              {item.band ? (
                <rect
                  x={0}
                  y={0}
                  width={8}
                  height={8}
                  rx={1.5}
                  fill={item.color}
                  opacity={0.4}
                />
              ) : (
                <circle cx={4} cy={4} r={4} fill={item.color} />
              )}
              <text x={12} y={8} fontSize={10.5} fill={TXT}>
                {item.name}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
