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

/** Kompakter SVG-Liniendiagramm-Baustein für das Stationslabor & Scan. */
export function LabLineChart({
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
    return <div className="rounded-lg bg-slate-900/60 p-3 text-xs text-slate-500">keine Daten</div>;
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
    s.pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Diagramm">
      {gridYs.map((gy, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={Y(gy)} y2={Y(gy)} stroke={AXIS} strokeWidth={0.6} strokeDasharray="3 4" />
          <text x={padL - 6} y={Y(gy) + 3.5} textAnchor="end" fontSize={10.5} fill={TXT}>
            {yFmt(gy)}
          </text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={X(t.x)} y={H - 7} textAnchor="middle" fontSize={10.5} fill={TXT}>
          {t.label}
        </text>
      ))}
      {marks.map((m, i) => (
        <g key={i}>
          <line x1={X(m.x)} x2={X(m.x)} y1={padT - 4} y2={H - padB} stroke={m.color} strokeWidth={1.4} strokeDasharray="5 3" />
          <text x={X(m.x)} y={padT - 8} textAnchor="middle" fontSize={10.5} fill={m.color}>
            {m.label}
          </text>
        </g>
      ))}
      {series.map((s, i) => (
        <path key={i} d={path(s)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} />
      ))}
      {series.length > 1 && (
        <g>
          {series.map((s, i) => (
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

/** Histogramm einer Verteilung mit Schwellen-Markern (S-Histogramm). */
export function HistogramBars({
  values,
  color = "#34d399",
  thresholds = [],
  height = 190,
  fmt = (v: number) => v.toFixed(1) + " ct",
}: {
  values: number[];
  color?: string;
  thresholds?: { x: number; color: string; label: string }[];
  height?: number;
  fmt?: (v: number) => string;
}) {
  const W = 720;
  const H = height;
  const padL = 40;
  const padR = 10;
  const padT = 20;
  const padB = 24;
  const iw = W - padL - padR;
  const ih = H - padT - padB;

  if (values.length === 0) {
    return <div className="rounded-lg bg-slate-900/60 p-3 text-xs text-slate-500">keine Daten</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lo = min - span * 0.08;
  const hi = max + span * 0.08;
  const bins = 18;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)));
    counts[b]++;
  }
  const cMax = Math.max(...counts, 1);
  const X = (x: number) => padL + ((x - lo) / (hi - lo)) * iw;
  const Y = (c: number) => padT + ih - (c / cMax) * ih;
  const bw = iw / bins;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Verteilung">
      {[0, 0.5, 1].map((f, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={Y(cMax * f)} y2={Y(cMax * f)} stroke={AXIS} strokeWidth={0.6} strokeDasharray="3 4" />
          <text x={padL - 6} y={Y(cMax * f) + 3.5} textAnchor="end" fontSize={10.5} fill={TXT}>
            {f === 0 ? "0" : f === 0.5 ? Math.round(cMax / 2) : cMax}
          </text>
        </g>
      ))}
      {counts.map((c, i) => (
        <rect
          key={i}
          x={X(lo + ((i + 0.06) / bins) * (hi - lo))}
          y={Y(c)}
          width={bw * 0.86}
          height={Math.max(Y(c) ? padT + ih - Y(c) : 0, 0)}
          fill={color}
          opacity={0.75}
          rx={1.5}
        />
      ))}
      {thresholds.map((t, i) => (
        <g key={i}>
          <line x1={X(t.x)} x2={X(t.x)} y1={padT - 6} y2={H - padB} stroke={t.color} strokeWidth={1.5} strokeDasharray="5 3" />
          <text x={X(t.x)} y={padT - 10} textAnchor="middle" fontSize={10.5} fill={t.color}>
            {t.label}
          </text>
        </g>
      ))}
      <text x={padL} y={H - 7} fontSize={10.5} fill={TXT}>
        {fmt(lo)}
      </text>
      <text x={W - padR} y={H - 7} textAnchor="end" fontSize={10.5} fill={TXT}>
        {fmt(hi)}
      </text>
    </svg>
  );
}

/** Balken um die Nulllinie (z. B. Netto-Ergebnis je Tag für Paarvergleich). */
export function DeltaBars({
  values,
  labels,
  height = 170,
  fmt = (v: number) => v.toFixed(2) + " €",
}: {
  values: number[];
  labels?: string[];
  height?: number;
  fmt?: (v: number) => string;
}) {
  const W = 720;
  const H = height;
  const padL = 46;
  const padR = 10;
  const padT = 16;
  const padB = 22;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  if (values.length === 0) return null;
  const vMax = Math.max(...values.map((v) => Math.abs(v)), 0.01);
  const Y = (v: number) => padT + ih / 2 - (v / vMax) * (ih / 2);
  const n = values.length;
  const bw = Math.min((iw / n) * 0.66, 34);
  const step = iw / n;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Tagesergebnisse">
      <line x1={padL} x2={W - padR} y1={padT + ih / 2} y2={padT + ih / 2} stroke="#475569" strokeWidth={1} />
      {values.map((v, i) => {
        const x = padL + i * step + (step - bw) / 2;
        const y = Math.min(Y(v), Y(0));
        const h = Math.abs(Y(v) - Y(0));
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(h, 0.5)} rx={2} fill={v >= 0 ? "#34d399" : "#fb7185"} opacity={0.85} />
            {labels && labels[i] && (
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={9.5} fill={TXT}>
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
      <text x={padL - 6} y={Y(vMax) + 3.5} textAnchor="end" fontSize={10.5} fill={TXT}>
        {fmt(vMax)}
      </text>
      <text x={padL - 6} y={Y(-vMax) + 3.5} textAnchor="end" fontSize={10.5} fill={TXT}>
        {fmt(-vMax)}
      </text>
      <text x={padL - 6} y={Y(0) + 3.5} textAnchor="end" fontSize={10.5} fill={TXT}>
        0
      </text>
    </svg>
  );
}

/** Kalibrierungs-Plot (Reliability Diagramm mit Diagonale & Live-Punkten). */
export function CalibChart({
  points,
  livePoints = [],
}: {
  points: { p: number; hit: number; n: number; cls: number }[];
  livePoints?: { p: number; hit: number; n: number }[];
}) {
  const W = 720;
  const H = 300;
  const padL = 46;
  const padR = 16;
  const padT = 18;
  const padB = 30;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const X = (v: number) => padL + v * iw;
  const Y = (v: number) => padT + ih - v * ih;
  const maxN = Math.max(...points.map((p) => p.n), 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Kalibrierung">
      {/* Diagonale */}
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="#475569" strokeWidth={1.4} strokeDasharray="6 4" />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={X(0)} x2={X(1)} y1={Y(f)} y2={Y(f)} stroke="#1e293b" strokeWidth={0.6} />
          <line x1={X(f)} x2={X(f)} y1={Y(0)} y2={Y(1)} stroke="#1e293b" strokeWidth={0.6} />
          <text x={padL - 6} y={Y(f) + 3.5} textAnchor="end" fontSize={10.5} fill="#64748b">
            {Math.round(f * 100)}%
          </text>
          <text x={X(f)} y={H - 9} textAnchor="middle" fontSize={10.5} fill="#64748b">
            {Math.round(f * 100)}%
          </text>
        </g>
      ))}
      <text x={padL} y={H - 18} fontSize={10} fill="#64748b">
        behauptet P(S&gt;0)
      </text>
      <text x={W - padR} y={padT - 4} textAnchor="end" fontSize={10} fill="#64748b">
        real beobachtet
      </text>

      {/* Backtest Punkte */}
      {points.map((p, i) => {
        const color = p.cls === 0 ? "#34d399" : "#38bdf8";
        return (
          <g key={i}>
            <circle cx={X(p.p)} cy={Y(p.hit)} r={3.5 + (p.n / maxN) * 5} fill={color} opacity={0.85} />
            <title>{`P=${(p.p * 100).toFixed(0)}% real=${(p.hit * 100).toFixed(0)}% n=${p.n} ${p.cls === 0 ? "Werktag" : "WE/Feiertag"}`}</title>
          </g>
        );
      })}

      {/* Live Punkte (Schicht B, bernsteinfarben / amber) */}
      {livePoints.map((p, i) => (
        <g key={`live-${i}`}>
          <circle cx={X(p.p)} cy={Y(p.hit)} r={5} fill="#f59e0b" stroke="#ffffff" strokeWidth={1.5} opacity={0.95} />
          <title>{`Live · P=${(p.p * 100).toFixed(0)}% real=${(p.hit * 100).toFixed(0)}% n=${p.n}`}</title>
        </g>
      ))}

      <g transform={`translate(${padL}, ${H - 14})`}>
        <circle cx={4} cy={0} r={4} fill="#34d399" />
        <text x={12} y={4} fontSize={10.5} fill="#94a3b8">
          Werktag
        </text>
        <circle cx={90} cy={0} r={4} fill="#38bdf8" />
        <text x={98} y={4} fontSize={10.5} fill="#94a3b8">
          Wochenende
        </text>
        {livePoints.length > 0 && (
          <>
            <circle cx={200} cy={0} r={4} fill="#f59e0b" stroke="#ffffff" strokeWidth={1} />
            <text x={208} y={4} fontSize={10.5} fill="#f59e0b">
              Live (Schicht B)
            </text>
          </>
        )}
      </g>
    </svg>
  );
}
