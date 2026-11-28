export function Sparkline({ values, label = "Verlauf", color = "var(--accent-wait)", height = 42 }: { values: Array<number | null | undefined>; label?: string; color?: string; height?: number }) {
  const points = values.map((value, index) => ({ value, index })).filter((point): point is { value: number; index: number } => point.value != null && Number.isFinite(point.value));
  if (points.length < 2) return <span className="sparkline-empty" aria-label={`${label}: keine ausreichenden Daten`}>—</span>;
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const range = max - min || 1;
  const lastIndex = Math.max(values.length - 1, 1);
  const path = points.map(({ value, index }, pointIndex) => `${pointIndex ? "L" : "M"}${(index / lastIndex) * 100},${height - 3 - ((value - min) / range) * (height - 6)}`).join(" ");
  return <svg className="sparkline" viewBox={`0 0 100 ${height}`} role="img" aria-label={label} preserveAspectRatio="none"><path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
