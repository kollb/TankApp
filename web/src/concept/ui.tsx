import { euro, euroPerLiter } from "../data";
import type { ReactNode } from "react";

export function Price({ value, className = "" }: { value: number; className?: string }) {
  const s = euro(value, 3);
  return (
    <span aria-label={euroPerLiter(value)} className={`tabular-nums whitespace-nowrap ${className}`}>
      {s.slice(0, -1)}
      <sup className="relative -top-[0.1em] text-[0.55em]">{s.slice(-1)}</sup>
      <span className="ml-0.5 text-[0.55em] font-medium">€</span>
    </span>
  );
}

export function Anno({ n, show }: { n: number; show: boolean }) {
  if (!show) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -left-2 -top-2 z-20 grid grid-cols-1 h-6 w-6 place-items-center rounded-full bg-[#7d2ae8] text-xs font-bold text-white ring-2 ring-white"
    >
      {n}
    </span>
  );
}

export function BrandAvatar({ brand, bg, fg, size = 40 }: { brand: string; bg: string; fg: string; size?: number }) {
  return (
    <span
      className="grid grid-cols-1 shrink-0 place-items-center rounded-full text-xs font-black tracking-tight"
      style={{ background: bg, color: fg, width: size, height: size }}
    >
      {brand.slice(0, 4)}
    </span>
  );
}

export function Confidence({ level, text, onDark = false }: { level: 1 | 2 | 3; text: string; onDark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" title="So sicher sind wir uns">
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map(i => (
          <span
            key={i}
            className={`w-[4px] rounded-full ${i <= level ? "bg-current" : onDark ? "bg-current opacity-25" : "bg-current opacity-20"}`}
            style={{ height: 5 + i * 3 }}
          />
        ))}
      </span>
      {text}
    </span>
  );
}

export function SectionTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold leading-6 text-on-surface">{title}</h2>
        {sub && <p className="text-sm text-on-surface-variant">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
