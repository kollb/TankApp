import React, { useId } from "react";
// C9: Zahlenformate kommen aus einem Satz — Achsen/Tooltips sind keine Ausnahme.
import { centPerLiter, countLabel, euro, percentLabel } from "../data";
// O40: Die Textalternative nennt Werte, nicht nur Reihennamen.
import {
  calibChartAlt,
  deltaBarsAlt,
  histogramAlt,
  lineChartAlt,
} from "../chartAlt";
import { useChartPalette } from "../chartTheme";

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
  yFmt = (v: number) => euro(v, 1),
  xTicks = [],
  ariaDescription,
  ariaLabel = "Liniendiagramm",
}: {
  series: SeriesPts[];
  marks?: Mark[];
  height?: number;
  yFmt?: (v: number) => string;
  xTicks?: { x: number; label: string }[];
  ariaDescription?: string;
  /** O40: unterscheidbar, wenn eine Ansicht mehrere Diagramme trägt. */
  ariaLabel?: string;
}) {
  const c = useChartPalette();
  // C5: role="img" trägt eine beschreibende Textfassung (aria-describedby),
  // nicht nur ein Label — Screenreader bekommen sagen, was das Diagramm zeigt.
  // O40: Ohne eigenen Text beschreibt der Rückfall den **Verlauf** mit Zahlen
  // (Anfang, Ende, Tief, Hoch) statt nur die Reihennamen aufzuzählen.
  const descId = useId();
  const desc =
    ariaDescription ?? lineChartAlt({ series, fmtY: yFmt });
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
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={ariaLabel}
      aria-describedby={descId}
    >
      <desc id={descId}>{desc}</desc>
      {gridYs.map((gy, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={Y(gy)} y2={Y(gy)} stroke={c.axis} strokeWidth={0.6} strokeDasharray="3 4" />
          <text x={padL - 6} y={Y(gy) + 3.5} textAnchor="end" fontSize={10.5} fill={c.text}>
            {yFmt(gy)}
          </text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={X(t.x)} y={H - 7} textAnchor="middle" fontSize={10.5} fill={c.text}>
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
              <text x={12} y={8} fontSize={10.5} fill={c.text}>
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
  color,
  thresholds = [],
  height = 190,
  fmt = (v: number) => centPerLiter(v),
  ariaDescription,
  ariaLabel = "Histogramm",
}: {
  values: number[];
  color?: string;
  thresholds?: { x: number; color: string; label: string }[];
  height?: number;
  fmt?: (v: number) => string;
  ariaDescription?: string;
  /** O40: unterscheidbar, wenn eine Ansicht mehrere Diagramme trägt. */
  ariaLabel?: string;
}) {
  const c = useChartPalette();
  // C5: beschreibende Textfassung für Screenreader (aria-describedby).
  // O40: mit Spanne und Mitte statt nur der Anzahl — die Zahl allein sagt
  // nichts über die Verteilung, die das Bild zeigt.
  const descId = useId();
  const desc = ariaDescription ?? histogramAlt({ values, fmt, thresholds });
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
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={ariaLabel}
      aria-describedby={descId}
    >
      <desc id={descId}>{desc}</desc>
      {[0, 0.5, 1].map((f, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={Y(cMax * f)} y2={Y(cMax * f)} stroke={c.axis} strokeWidth={0.6} strokeDasharray="3 4" />
          <text x={padL - 6} y={Y(cMax * f) + 3.5} textAnchor="end" fontSize={10.5} fill={c.text}>
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
          fill={color ?? c.positive}
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
      <text x={padL} y={H - 7} fontSize={10.5} fill={c.text}>
        {fmt(lo)}
      </text>
      <text x={W - padR} y={H - 7} textAnchor="end" fontSize={10.5} fill={c.text}>
        {fmt(hi)}
      </text>
    </svg>
  );
}

/** Balken um die Nulllinie (z. B. Netto-Ergebnis je Tag für Paarvergleich).
 *
 * O16: Optional tragen die Balken einen Konfidenz-Whisker (``whiskers``) und
 * einen Bedeutungs-Zustand (``muted`` — nicht signifikant = blasser). Die
 * Skala spannt sich über Balken **und** Whisker, damit kein Intervall
 * abgeschnitten wird.
 */
export function DeltaBars({
  values,
  labels,
  whiskers,
  muted,
  height = 170,
  fmt = (v: number) => `${euro(v, 2)} €`,
  ariaDescription,
  ariaLabel = "Balkendiagramm",
}: {
  values: number[];
  labels?: string[];
  whiskers?: Array<{ lo: number; hi: number } | null>;
  muted?: boolean[];
  height?: number;
  fmt?: (v: number) => string;
  ariaDescription?: string;
  /** O40: unterscheidbar, wenn eine Ansicht mehrere Diagramme trägt. */
  ariaLabel?: string;
}) {
  const c = useChartPalette();
  // C5: beschreibende Textfassung für Screenreader (aria-describedby).
  // O40: Die Farbregel („grün = positiv“) ist für eine Vorleserin keine
  // Information — der Rückfall nennt stattdessen Verteilung und Ausreißer.
  const descId = useId();
  const desc = ariaDescription ?? deltaBarsAlt({ values, labels, fmt, muted });
  const W = 720;
  const padL = 46;
  const padR = 10;
  const padT = 16;
  const BASE_PAD_B = 22;
  const iw = W - padL - padR;
  if (values.length === 0) return null;
  const n = values.length;
  const step = iw / n;
  const bw = Math.min(step * 0.66, 34);
  // X-Beschriftung: Solange die Namen nebeneinander passen, stehen sie
  // waagrecht unter dem Balken. Sobald der längste Name breiter ist als
  // eine Balkenspur, kippt die Achse um 45° und der Fußraum wächst mit —
  // die Plotfläche selbst bleibt gleich groß (H wächst mit dem Fußraum).
  // Zu lange Namen werden mit „…“ gekürzt; der volle Name bleibt per
  // <title> (Hover) lesbar. (Feedback 17.09.2026: „Preis-Abstand je
  // Station · Frankfurt“ — bei einem großen Stationsset standen alle
  // Namen übereinander, die Achse war nicht mehr lesbar.)
  const CHAR_W = 5.3; // mittlere Zeichenbreite der 9,5-px-Achsschrift
  const PAD_B_MAX = 96;
  const widest = (labels ?? []).reduce(
    (m, l) => Math.max(m, (l ?? "").length),
    0,
  );
  const rotated = widest * CHAR_W > step + 6;
  const padB = rotated
    ? Math.min(PAD_B_MAX, 16 + widest * CHAR_W * Math.SQRT1_2)
    : BASE_PAD_B;
  // Kürzung so, dass der gekippte Text im (gedeckelten) Fußraum bleibt.
  const maxChars = rotated
    ? Math.max(8, Math.floor(((PAD_B_MAX - 16) * Math.SQRT2) / CHAR_W))
    : Number.POSITIVE_INFINITY;
  const shortLabel = (l: string) =>
    l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l;
  const H = height + padB - BASE_PAD_B;
  const ih = H - padT - padB;
  const vMax = Math.max(
    ...values.map((v) => Math.abs(v)),
    ...(whiskers ?? []).flatMap((w) =>
      w && Number.isFinite(w.lo) && Number.isFinite(w.hi)
        ? [Math.abs(w.lo), Math.abs(w.hi)]
        : [0],
    ),
    0.01,
  );
  const Y = (v: number) => padT + ih / 2 - (v / vMax) * (ih / 2);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={ariaLabel}
      aria-describedby={descId}
    >
      <desc id={descId}>{desc}</desc>
      <line x1={padL} x2={W - padR} y1={padT + ih / 2} y2={padT + ih / 2} stroke={c.tick} strokeWidth={1} />
      {values.map((v, i) => {
        const x = padL + i * step + (step - bw) / 2;
        const y = Math.min(Y(v), Y(0));
        const h = Math.abs(Y(v) - Y(0));
        const whisker = whiskers?.[i] ?? null;
        const isMuted = muted?.[i] === true;
        const opacity = isMuted ? 0.38 : 0.85;
        const cx = x + bw / 2;
        const capW = Math.min(bw * 0.7, 16);
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(h, 0.5)} rx={2} fill={v >= 0 ? c.positive : c.negative} opacity={opacity} />
            {whisker && Number.isFinite(whisker.lo) && Number.isFinite(whisker.hi) && (
              <g stroke={c.text} strokeWidth={1} opacity={isMuted ? 0.45 : 0.9}>
                <line x1={cx} x2={cx} y1={Y(whisker.lo)} y2={Y(whisker.hi)} />
                <line x1={cx - capW / 2} x2={cx + capW / 2} y1={Y(whisker.lo)} y2={Y(whisker.lo)} />
                <line x1={cx - capW / 2} x2={cx + capW / 2} y1={Y(whisker.hi)} y2={Y(whisker.hi)} />
              </g>
            )}
            {labels && labels[i] && (
              <text
                x={x + bw / 2}
                y={rotated ? padT + ih + 10 : H - 8}
                textAnchor={rotated ? "end" : "middle"}
                fontSize={9.5}
                fill={c.text}
                transform={
                  rotated
                    ? `rotate(-45 ${x + bw / 2} ${padT + ih + 10})`
                    : undefined
                }
              >
                {shortLabel(labels[i])}
                <title>{labels[i]}</title>
              </text>
            )}
          </g>
        );
      })}
      <text x={padL - 6} y={Y(vMax) + 3.5} textAnchor="end" fontSize={10.5} fill={c.text}>
        {fmt(vMax)}
      </text>
      <text x={padL - 6} y={Y(-vMax) + 3.5} textAnchor="end" fontSize={10.5} fill={c.text}>
        {fmt(-vMax)}
      </text>
      <text x={padL - 6} y={Y(0) + 3.5} textAnchor="end" fontSize={10.5} fill={c.text}>
        0
      </text>
    </svg>
  );
}

/** Kalibrierungs-Plot (Reliability Diagramm mit Diagonale & Live-Punkten). */
export function CalibChart({
  points,
  livePoints = [],
  ariaDescription,
  ariaLabel = "Kalibrierungsdiagramm",
}: {
  points: { p: number; hit: number; n: number; cls: number }[];
  livePoints?: { p: number; hit: number; n: number }[];
  ariaDescription?: string;
  /** O40: unterscheidbar, wenn eine Ansicht mehrere Diagramme trägt. */
  ariaLabel?: string;
}) {
  const c = useChartPalette();
  // C5: beschreibende Textfassung für Screenreader (aria-describedby).
  // O40: Der Rückfall nennt die mittlere Abweichung von der Diagonalen mit
  // Richtung — das ist die Aussage des Bildes, nicht die Achsenbelegung.
  const descId = useId();
  const desc = ariaDescription ?? calibChartAlt({ points, livePoints });
  if (points.length === 0 && livePoints.length === 0) {
    return (
      <div className="rounded-lg bg-slate-900/60 p-4 text-xs leading-relaxed text-slate-500">
        Noch keine Kalibrierungsdaten — die Punkte erscheinen mit den ersten
        ausgewerteten Empfehlungen (Backtest) bzw. Live-Entscheidungen.
      </div>
    );
  }

  const W = 720;
  const H = 340;
  const padL = 52;
  const padR = 20;
  const padT = 22;
  const padB = 58;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const X = (v: number) => padL + v * iw;
  const Y = (v: number) => padT + ih - v * ih;
  const maxN = Math.max(...points.map((p) => p.n), 1);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={ariaLabel}
      aria-describedby={descId}
    >
      <desc id={descId}>{desc}</desc>
      {/* Diagonale */}
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke={c.tick} strokeWidth={1.4} strokeDasharray="6 4" />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={X(0)} x2={X(1)} y1={Y(f)} y2={Y(f)} stroke={c.grid} strokeWidth={0.6} />
          <line x1={X(f)} x2={X(f)} y1={Y(0)} y2={Y(1)} stroke={c.grid} strokeWidth={0.6} />
          <text x={padL - 6} y={Y(f) + 4} textAnchor="end" fontSize={11} fill={c.muted}>
            {percentLabel(f * 100)}
          </text>
          <text x={X(f)} y={H - 36} textAnchor="middle" fontSize={11} fill={c.muted}>
            {percentLabel(f * 100)}
          </text>
        </g>
      ))}
      <text x={padL} y={H - 22} fontSize={10.5} fill={c.muted}>
        versprochen: Wette in %
      </text>
      <text x={W - padR} y={padT - 4} textAnchor="end" fontSize={10.5} fill={c.muted}>
        eingetroffen in %
      </text>

      {/* Backtest Punkte */}
      {points.map((p, i) => {
        const color = p.cls === 0 ? c.positive : c.accent;
        return (
          <g key={i}>
            <circle cx={X(p.p)} cy={Y(p.hit)} r={3.5 + (p.n / maxN) * 5} fill={color} opacity={0.85} />
            <title>{`P = ${percentLabel(p.p * 100, 0)} · realisiert ${percentLabel(p.hit * 100, 0)} · n = ${countLabel(p.n)} · ${p.cls === 0 ? "Werktag" : "Wochenende/Feiertag"}`}</title>
          </g>
        );
      })}

      {/* Live Punkte (Schicht B, bernsteinfarben / amber) */}
      {livePoints.map((p, i) => (
        <g key={`live-${i}`}>
          <circle cx={X(p.p)} cy={Y(p.hit)} r={5} fill={c.warn} stroke={c.onSurface} strokeWidth={1.5} opacity={0.95} />
          <title>{`Live · P = ${percentLabel(p.p * 100, 0)} · realisiert ${percentLabel(p.hit * 100, 0)} · n = ${countLabel(p.n)}`}</title>
        </g>
      ))}

      <g transform={`translate(${padL}, ${H - 10})`}>
        <circle cx={4} cy={0} r={4} fill={c.positive} />
        <text x={12} y={4} fontSize={11} fill={c.text}>
          Werktag
        </text>
        <circle cx={96} cy={0} r={4} fill={c.accent} />
        <text x={104} y={4} fontSize={11} fill={c.text}>
          Wochenende
        </text>
        {livePoints.length > 0 && (
          <>
            <circle cx={216} cy={0} r={4} fill={c.warn} stroke={c.onSurface} strokeWidth={1} />
            <text x={224} y={4} fontSize={11} fill={c.warn}>
              Echte Live-Empfehlungen
            </text>
          </>
        )}
      </g>
    </svg>
  );
}
